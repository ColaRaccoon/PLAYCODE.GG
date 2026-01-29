// ContactRoutes.js - 문의하기 API 라우트

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authenticateToken = require('../middlewares/AuthMiddleware');

// 문의 제출 Rate Limiting (스팸 방지)
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1시간
  max: 3, // 1시간당 최대 3개 문의
  message: '문의 전송 횟수를 초과했습니다. 1시간 후 다시 시도해주세요.',
  standardHeaders: true,
  legacyHeaders: false,
});

// IP 추출 헬퍼 함수
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.connection?.remoteAddress ||
         req.socket?.remoteAddress ||
         req.ip ||
         'unknown';
}

// 이메일 유효성 검사
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// 내 문의 목록 조회 (로그인 필요)
router.get('/contacts/my', authenticateToken, async (req, res) => {
  try {

    const userDb = req.app.get('userDb');
    const Contact = require('../models/Contact')(userDb);

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // 사용자의 문의만 조회
    const [totalCount, contacts] = await Promise.all([
      Contact.countDocuments({ userId: req.user.id }),
      Contact.find({ userId: req.user.id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    res.json({
      success: true,
      contacts,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        hasMore: skip + contacts.length < totalCount
      }
    });

  } catch (error) {
    console.error('내 문의 조회 오류:', error);
    res.status(500).json({
      message: '문의 목록을 불러오는 중 오류가 발생했습니다.'
    });
  }
});

// 문의 제출 API
router.post('/contact', contactLimiter, async (req, res) => {
  try {
    const userDb = req.app.get('userDb');
    const Contact = require('../models/Contact')(userDb);

    const { name, email, category, subject, message } = req.body;

    // 유효성 검사
    if (!name || !email || !category || !subject || !message) {
      return res.status(400).json({
        message: '모든 필수 항목을 입력해주세요.'
      });
    }

    // 이름 길이 검사
    if (name.length > 100) {
      return res.status(400).json({
        message: '이름은 100자를 초과할 수 없습니다.'
      });
    }

    // 이메일 유효성 검사
    if (!isValidEmail(email) || email.length > 255) {
      return res.status(400).json({
        message: '유효한 이메일 주소를 입력해주세요.'
      });
    }

    // 카테고리 검사
    const validCategories = ['general', 'bug', 'feature', 'account', 'other'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({
        message: '유효하지 않은 문의 유형입니다.'
      });
    }

    // 제목 길이 검사
    if (subject.length > 200) {
      return res.status(400).json({
        message: '제목은 200자를 초과할 수 없습니다.'
      });
    }

    // 내용 길이 검사
    if (message.length > 2000) {
      return res.status(400).json({
        message: '내용은 2000자를 초과할 수 없습니다.'
      });
    }

    // IP 주소 추출
    const ipAddress = getClientIp(req);

    // 사용자 ID (로그인한 경우)
    const userId = req.user?.id || null;

    // 문의 생성
    const contact = await Contact.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      category,
      subject: subject.trim(),
      message: message.trim(),
      ipAddress,
      userId,
      status: 'pending'
    });

    console.log(`📧 새로운 문의 접수: ${contact._id} (${email})`);

    res.status(201).json({
      message: '문의가 성공적으로 접수되었습니다.',
      contactId: contact._id
    });

  } catch (error) {
    console.error('문의 제출 오류:', error);
    res.status(500).json({
      message: '문의 전송 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
    });
  }
});

module.exports = router;
