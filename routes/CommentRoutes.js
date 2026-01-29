const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/AuthMiddleware');
const { optionalAuthenticateToken } = require('../middlewares/AuthMiddleware');
const { ObjectId } = require('mongoose').Types;

// GET /api/quiz/:quizId/comments - 퀴즈의 댓글 조회 (페이지네이션)
// 로그인 없이도 조회 가능
router.get('/quiz/:quizId/comments', optionalAuthenticateToken, async (req, res) => {
  const { quizId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  if (!ObjectId.isValid(quizId)) {
    return res.status(400).json({ message: '유효하지 않은 퀴즈 ID입니다.' });
  }

  try {
    const mainDb = req.app.get('userDb'); // Comment는 userDb에 저장
    const Comment = require('../models/Comment')(mainDb);

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // 전체 댓글 수 조회
    const totalCount = await Comment.countDocuments({
      quizId,
      isCommentHidden: { $ne: true }
    });

    // 퀴즈별 댓글 조회 (최신순) - 페이지네이션 적용
    const comments = await Comment.find({
      quizId,
      isCommentHidden: { $ne: true }
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    // 프로필 이미지가 숨겨진 경우 null로 처리
    const sanitizedComments = comments.map(comment => ({
      ...comment,
      profileImage: comment.isProfileHidden ? null : comment.profileImage,
    }));

    res.json({
      success: true,
      comments: sanitizedComments,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalCount / limitNum),
        totalCount,
        hasMore: skip + comments.length < totalCount
      }
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ message: '댓글 조회 중 오류가 발생했습니다.', error: error.message });
  }
});

// POST /api/quiz/:quizId/comment - 새 댓글 작성
router.post('/quiz/:quizId/comment', authenticateToken, async (req, res) => {
  const { quizId } = req.params;
  const { content } = req.body;

  if (!ObjectId.isValid(quizId)) {
    return res.status(400).json({ message: '유효하지 않은 퀴즈 ID입니다.' });
  }

  if (!content || content.trim().length === 0) {
    return res.status(400).json({ message: '댓글 내용을 입력해주세요.' });
  }

  if (content.length > 500) {
    return res.status(400).json({ message: '댓글은 최대 500자까지 작성할 수 있습니다.' });
  }

  try {
    const quizDb = req.app.get('quizDb');
    const mainDb = req.app.get('userDb');

    const Quiz = require('../models/Quiz')(quizDb);
    const User = require('../models/User')(mainDb);
    const Comment = require('../models/Comment')(mainDb);

    // 퀴즈 존재 여부 확인
    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ message: '퀴즈를 찾을 수 없습니다.' });
    }

    // 사용자 정보 조회
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
    }

    // 댓글 생성
    const newComment = await Comment.create({
      quizId,
      userId: req.user.id,
      nickname: user.nickname,
      profileImage: user.profileImage || null,
      content: content.trim(),
    });

    res.status(201).json({
      success: true,
      message: '댓글이 작성되었습니다.',
      comment: {
        _id: newComment._id,
        quizId: newComment.quizId,
        userId: newComment.userId,
        nickname: newComment.nickname,
        profileImage: newComment.profileImage,
        content: newComment.content,
        createdAt: newComment.createdAt,
      }
    });
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ message: '댓글 작성 중 오류가 발생했습니다.', error: error.message });
  }
});

// PUT /api/quiz/:quizId/comment/:commentId - 댓글 수정
router.put('/quiz/:quizId/comment/:commentId', authenticateToken, async (req, res) => {
  const { quizId, commentId } = req.params;
  const { content } = req.body;

  if (!ObjectId.isValid(quizId) || !ObjectId.isValid(commentId)) {
    return res.status(400).json({ message: '유효하지 않은 ID입니다.' });
  }

  if (!content || content.trim().length === 0) {
    return res.status(400).json({ message: '댓글 내용을 입력해주세요.' });
  }

  if (content.length > 500) {
    return res.status(400).json({ message: '댓글은 최대 500자까지 작성할 수 있습니다.' });
  }

  try {
    const mainDb = req.app.get('userDb');
    const Comment = require('../models/Comment')(mainDb);

    // 댓글 조회
    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ message: '댓글을 찾을 수 없습니다.' });
    }

    // 권한 확인 (댓글 작성자만 수정 가능)
    if (comment.userId.toString() !== req.user.id) {
      return res.status(403).json({ message: '댓글을 수정할 권한이 없습니다.' });
    }

    // 댓글 수정
    comment.content = content.trim();
    await comment.save();

    res.json({
      success: true,
      message: '댓글이 수정되었습니다.',
      comment: {
        _id: comment._id,
        quizId: comment.quizId,
        userId: comment.userId,
        nickname: comment.nickname,
        profileImage: comment.profileImage,
        content: comment.content,
        createdAt: comment.createdAt,
      }
    });
  } catch (error) {
    console.error('Error updating comment:', error);
    res.status(500).json({ message: '댓글 수정 중 오류가 발생했습니다.', error: error.message });
  }
});

// DELETE /api/quiz/:quizId/comment/:commentId - 댓글 삭제
router.delete('/quiz/:quizId/comment/:commentId', authenticateToken, async (req, res) => {
  const { quizId, commentId } = req.params;

  if (!ObjectId.isValid(quizId) || !ObjectId.isValid(commentId)) {
    return res.status(400).json({ message: '유효하지 않은 ID입니다.' });
  }

  try {
    const mainDb = req.app.get('userDb');
    const Comment = require('../models/Comment')(mainDb);

    // 댓글 조회
    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ message: '댓글을 찾을 수 없습니다.' });
    }

    // 권한 확인 (댓글 작성자만 삭제 가능)
    if (comment.userId.toString() !== req.user.id) {
      return res.status(403).json({ message: '댓글을 삭제할 권한이 없습니다.' });
    }

    // 댓글 삭제
    await Comment.findByIdAndDelete(commentId);

    res.json({
      success: true,
      message: '댓글이 삭제되었습니다.',
    });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ message: '댓글 삭제 중 오류가 발생했습니다.', error: error.message });
  }
});

// POST /api/quiz/:quizId/comment/:commentId/report - 댓글 신고
router.post('/quiz/:quizId/comment/:commentId/report', authenticateToken, async (req, res) => {
  const { quizId, commentId } = req.params;
  const { reason, description } = req.body;

  if (!ObjectId.isValid(quizId) || !ObjectId.isValid(commentId)) {
    return res.status(400).json({ message: '유효하지 않은 ID입니다.' });
  }

  if (!reason) {
    return res.status(400).json({ message: '신고 사유를 선택해주세요.' });
  }

  const validReasons = ['spam', 'abuse', 'inappropriate', 'other'];
  if (!validReasons.includes(reason)) {
    return res.status(400).json({ message: '유효하지 않은 신고 사유입니다.' });
  }

  try {
    const mainDb = req.app.get('userDb');
    const Comment = require('../models/Comment')(mainDb);
    const User = require('../models/User')(mainDb);

    // 댓글 조회
    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ message: '댓글을 찾을 수 없습니다.' });
    }

    // 자신의 댓글은 신고할 수 없음
    if (comment.userId.toString() === req.user.id) {
      return res.status(403).json({ message: '자신의 댓글은 신고할 수 없습니다.' });
    }

    // 이미 신고했는지 확인
    const alreadyReported = comment.commentReports.some(
      report => report.reporterId.toString() === req.user.id
    );

    if (alreadyReported) {
      return res.status(400).json({ message: '이미 신고한 댓글입니다.' });
    }

    // 사용자 정보 조회
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
    }

    // 신고 추가
    comment.commentReports.push({
      reporterId: req.user.id,
      reporterNickname: user.nickname,
      reason,
      description: description?.trim() || '',
      reportedAt: new Date(),
    });

    await comment.save();

    res.json({
      success: true,
      message: '댓글이 신고되었습니다.',
    });
  } catch (error) {
    console.error('Error reporting comment:', error);
    res.status(500).json({ message: '댓글 신고 중 오류가 발생했습니다.', error: error.message });
  }
});

module.exports = router;
