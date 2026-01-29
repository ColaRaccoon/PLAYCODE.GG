const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongoose').Types; // ObjectId 추가
const jwt = require('jsonwebtoken');
const path = require('path');

// JWT 인증 미들웨어 (GameRoutes.js와 중복되므로, 별도 파일로 분리하는 것을 권장합니다)
const authenticateToken = require('../middlewares/AuthMiddleware');
const { optionalAuthenticateToken } = require('../middlewares/AuthMiddleware');

router.get('/quiz/my-list', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/quiz-my-list.html'))
});

router.get('/quiz/init', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/quiz-init.html'))
});

router.get('/quiz/edit', authenticateToken, async (req, res) => {
  const { quizId } = req.query;
  if (!quizId) {
    return res.status(400).send('<h1>잘못된 접근입니다.</h1><p>퀴즈 ID가 필요합니다. <a href="/">홈으로 돌아가기</a></p>');
  }

  try {
    const quizDb = req.app.get('quizDb');
    const Quiz = require('../models/Quiz')(quizDb);
    const quiz = await Quiz.findById(quizId);

    if (!quiz) {
      return res.status(404).send('<h1>퀴즈를 찾을 수 없습니다.</h1><p><a href="/">홈으로 돌아가기</a></p>');
    }

    // 작성자이거나 관리자인지 확인
    const isCreator = quiz.creatorId.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';

    if (!isCreator && !isAdmin) {
      return res.status(403).send('<h1>접근 권한이 없습니다.</h1><p>자신이 만든 퀴즈만 수정할 수 있습니다. <a href="/">홈으로 돌아가기</a></p>');
    }

    res.sendFile(path.join(__dirname, '../public/quiz-edit.html'));
  } catch (error) {
    console.error('Error in /quiz/edit route:', error);
    res.status(500).send('<h1>서버 오류</h1><p>페이지를 불러오는 중 문제가 발생했습니다. <a href="/">홈으로 돌아가기</a></p>');
  }
});

// 세션 만료 페이지 라우트
router.get('/quiz/session-expired', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/session-expired.html'));
});

// 퀴즈 세션 페이지 라우트 (게스트 지원)
router.get('/quiz/:sessionId', optionalAuthenticateToken, async (req, res) => {
  const { sessionId } = req.params;

  if (!ObjectId.isValid(sessionId)) {
    return res.status(400).send('Invalid session ID format');
  }

  const quizDb = req.app.get('quizDb');
  const GameSession = require('../models/GameSession')(quizDb);

  try {
    const session = await GameSession.findById(sessionId).lean();

    if (!session) {
      // 세션이 없으면 세션 만료 페이지로 리다이렉트
      return res.redirect('/quiz/session-expired');
    }

    // 로그인한 사용자인 경우 권한 확인
    if (req.user) {
      const userId = req.user.id;
      const isHost = session.host && session.host.toString() === userId;
      const isParticipant = session.players.some(p => p.userId && p.userId.toString() === userId);

      if (!isHost && !isParticipant) {
        return res.status(403).send('<h1>접근 권한이 없습니다.</h1><p>초대코드로 게임에 입장하시길 바랍니다. <a href="/">홈으로 돌아가기</a></p>');
      }
    }
    // 게스트는 세션 참여 여부를 WebSocket 연결 시 확인

    // 퀴즈 세션 페이지를 보냄
    res.sendFile(path.join(__dirname, '../public/quiz-session.html'));
  } catch (err) {
    console.error('Error authorizing session access:', err);
    res.status(500).send('Server error while checking session access.');
  }
});

// 퀴즈 제목/설명/썸네일 수정
router.put('/quiz/:id', authenticateToken, async (req, res) => {
  const quizDb = req.app.get('quizDb');
  const Quiz = require('../models/Quiz')(quizDb);
  const { title, description, titleImageBase64 } = req.body;

  try {
    // 업데이트할 필드 준비
    const updateFields = {};

    if (title !== undefined) {
      updateFields.title = title;
    }

    if (description !== undefined) {
      updateFields.description = description;
    }

    if (titleImageBase64 !== undefined) {
      updateFields.titleImageBase64 = titleImageBase64;
    }

    const quiz = await Quiz.findOneAndUpdate(
      { _id: req.params.id, creatorId: req.user.id },
      updateFields,
      { new: true }
    );

    if (!quiz) {
      return res.status(404).json({ message: '퀴즈를 찾을 수 없습니다.' });
    }

    res.json({ message: '퀴즈 수정 완료', quiz });
  } catch (err) {
    console.error('퀴즈 수정 실패:', err);
    res.status(500).json({ message: '퀴즈 수정 실패', error: err.message });
  }
});

// 퀴즈 추천 토글 (추천/추천 취소)
router.post('/quiz/:quizId/recommend', authenticateToken, async (req, res) => {
  const { quizId } = req.params;
  const userId = req.user.id;

  if (!ObjectId.isValid(quizId)) {
    return res.status(400).json({ message: '유효하지 않은 퀴즈 ID입니다.' });
  }

  try {
    const quizDb = req.app.get('quizDb');
    const Quiz = require('../models/Quiz')(quizDb);
    const Recommendation = require('../models/Recommendation')(quizDb);

    const quiz = await Quiz.findById(quizId);

    if (!quiz) {
      return res.status(404).json({ message: '퀴즈를 찾을 수 없습니다.' });
    }

    // 자신이 만든 퀴즈는 추천할 수 없음
    if (quiz.creatorId.toString() === userId) {
      return res.status(403).json({ message: '자신이 만든 퀴즈는 추천할 수 없습니다.' });
    }

    // ObjectId로 변환
    const userObjectId = new ObjectId(userId);
    const quizObjectId = new ObjectId(quizId);

    // 이미 추천했는지 확인 (O(1) 인덱스 검색)
    const existingRecommendation = await Recommendation.findOne({
      userId: userObjectId,
      quizId: quizObjectId
    });

    let recommended;
    if (existingRecommendation) {
      // 추천 취소
      await Recommendation.deleteOne({ _id: existingRecommendation._id });
      quiz.recommendationCount = Math.max(0, quiz.recommendationCount - 1);
      recommended = false;
    } else {
      // 추천 추가
      await Recommendation.create({
        userId: userObjectId,
        quizId: quizObjectId
      });
      quiz.recommendationCount += 1;
      recommended = true;
    }

    await quiz.save();

    res.json({
      success: true,
      recommended,
      recommendationCount: quiz.recommendationCount,
      message: recommended ? '퀴즈를 추천했습니다.' : '추천을 취소했습니다.',
    });
  } catch (err) {
    console.error('퀴즈 추천 처리 실패:', err);
    res.status(500).json({ message: '추천 처리 중 오류가 발생했습니다.', error: err.message });
  }
});

module.exports = router;