const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/AuthMiddleware');

// 관리자 권한 부여 (인증된 사용자만 접근 가능)
router.post('/grant-admin', authenticateToken, async (req, res) => {
  try {
    const { email, secretKey } = req.body;

    // 보안을 위한 비밀키 확인 (환경변수에 설정된 키와 비교)
    if (secretKey !== process.env.ADMIN_SECRET_KEY) {
      return res.status(403).json({
        success: false,
        message: '잘못된 비밀키입니다.'
      });
    }

    const User = require('../models/User')(req.app.get('userDb'));

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '해당 이메일의 사용자를 찾을 수 없습니다.'
      });
    }

    // 이미 관리자인 경우
    if (user.role === 'admin') {
      return res.json({
        success: true,
        message: '이미 관리자 권한을 가지고 있습니다.'
      });
    }

    // 관리자 권한 부여
    user.role = 'admin';
    await user.save();

    res.json({
      success: true,
      message: `${user.nickname}님에게 관리자 권한이 부여되었습니다.`
    });
  } catch (err) {
    console.error('Grant admin error:', err);
    res.status(500).json({
      success: false,
      message: '관리자 권한 부여 중 오류가 발생했습니다.'
    });
  }
});

// 내 계정에 관리자 권한 부여 (본인만 가능)
router.post('/make-me-admin', authenticateToken, async (req, res) => {
  try {
    const { secretKey } = req.body;

    // 보안을 위한 비밀키 확인
    if (secretKey !== process.env.ADMIN_SECRET_KEY) {
      return res.status(403).json({
        success: false,
        message: '잘못된 비밀키입니다.'
      });
    }

    const User = require('../models/User')(req.app.get('userDb'));
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    if (user.role === 'admin' || user.role === 'superadmin') {
      return res.json({
        success: true,
        message: `이미 ${user.role === 'superadmin' ? '최고 관리자' : '관리자'} 권한을 가지고 있습니다.`
      });
    }

    user.role = 'admin';
    await user.save();

    res.json({
      success: true,
      message: '관리자 권한이 부여되었습니다. 페이지를 새로고침하세요.'
    });
  } catch (err) {
    console.error('Make me admin error:', err);
    res.status(500).json({
      success: false,
      message: '관리자 권한 부여 중 오류가 발생했습니다.'
    });
  }
});

// 내 계정에 최고 관리자 권한 부여 (본인만 가능)
router.post('/make-me-superadmin', authenticateToken, async (req, res) => {
  try {
    const { secretKey } = req.body;

    // 보안을 위한 비밀키 확인 (슈퍼어드민 전용 키)
    if (secretKey !== process.env.SUPERADMIN_SECRET_KEY) {
      return res.status(403).json({
        success: false,
        message: '잘못된 비밀키입니다.'
      });
    }

    const User = require('../models/User')(req.app.get('userDb'));
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    if (user.role === 'superadmin') {
      return res.json({
        success: true,
        message: '이미 최고 관리자 권한을 가지고 있습니다.'
      });
    }

    user.role = 'superadmin';
    await user.save();

    res.json({
      success: true,
      message: '최고 관리자 권한이 부여되었습니다. 페이지를 새로고침하세요.'
    });
  } catch (err) {
    console.error('Make me superadmin error:', err);
    res.status(500).json({
      success: false,
      message: '최고 관리자 권한 부여 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;
