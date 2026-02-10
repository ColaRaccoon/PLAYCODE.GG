const express = require('express');
const router = express.Router();
const path = require('path');
const { checkAdmin, checkSuperAdmin } = require('../middlewares/AdminMiddleware');

// 모든 admin 라우트에 권한 검증 적용
router.use((req, res, next) => {
  if (req.method === 'DELETE') {
    return checkSuperAdmin(req, res, next);
  }
  return checkAdmin(req, res, next);
});

// 관리자 대시보드 페이지
router.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-dashboard.html'));
});

// 신고 관리 페이지
router.get('/reports.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-reports.html'));
});

// 통계 페이지
router.get('/stats.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-stats.html'));
});

// 문의 관리 페이지
router.get('/contacts.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-contacts.html'));
});

// 유저 관리 페이지
router.get('/users.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/users.html'));
});

// ========== 최적화된 공통 함수 ==========

/**
 * 퀴즈 목록에 작성자/압수자 정보를 한 번에 추가 (N+1 문제 해결)
 */
async function enrichQuizzesWithUserInfo(quizzes, User) {
  if (quizzes.length === 0) return [];

  // 1. 모든 User ID 수집
  const userIds = new Set();
  quizzes.forEach(quiz => {
    if (quiz.creatorId && quiz.creatorId !== 'seized') {
      userIds.add(quiz.creatorId.toString());
    }
    if (quiz.originalCreatorId) {
      userIds.add(quiz.originalCreatorId.toString());
    }
    if (quiz.seizedById) {
      userIds.add(quiz.seizedById.toString());
    }
    // 신고자 ID도 수집
    if (quiz.reports && quiz.reports.length > 0) {
      quiz.reports.forEach(report => {
        if (report.reporterId) {
          userIds.add(report.reporterId.toString());
        }
      });
    }
  });

  // 2. 한 번에 모든 User 조회 (단 1번의 쿼리!)
  const users = await User.find({
    _id: { $in: Array.from(userIds) }
  })
    .select('_id username nickname email')
    .lean(); // Mongoose 오버헤드 제거

  // 3. User ID를 키로 하는 Map 생성 (O(1) 조회)
  const userMap = new Map();
  users.forEach(user => {
    userMap.set(user._id.toString(), user);
  });

  // 4. 각 퀴즈에 User 정보 매핑
  return quizzes.map(quiz => {
    let creator = null;
    let seizedBy = null;

    if (quiz.creatorId === 'seized' && quiz.originalCreatorId) {
      creator = userMap.get(quiz.originalCreatorId.toString()) || { username: 'Unknown', nickname: 'Unknown', email: 'N/A' };
      if (quiz.seizedById) {
        seizedBy = userMap.get(quiz.seizedById.toString()) || null;
      }
    } else if (quiz.creatorId !== 'seized') {
      creator = userMap.get(quiz.creatorId.toString()) || { username: 'Unknown', nickname: 'Unknown', email: 'N/A' };
    } else {
      creator = { username: 'Unknown', nickname: 'Unknown', email: 'N/A' };
    }

    // 신고자 정보 추가 (있는 경우)
    let reportsWithReporter = null;
    if (quiz.reports && quiz.reports.length > 0) {
      reportsWithReporter = quiz.reports.map(report => ({
        ...report,
        reporter: userMap.get(report.reporterId?.toString()) || { nickname: 'Unknown', email: 'N/A' }
      }));
    }

    // questions 필드가 있으면 문제 수만 포함 (이미지는 호버링 시 별도 API로 로드)
    let questionCount = quiz.questionCount || 0; // aggregate에서 계산된 값 사용
    if (!quiz.questionCount && quiz.questions && Array.isArray(quiz.questions)) {
      questionCount = quiz.questions.length; // 혹시 questions 배열이 있으면 길이 계산
    }

    return {
      _id: quiz._id,
      title: quiz.title,
      description: quiz.description,
      titleImageBase64: quiz.titleImageBase64,
      isComplete: quiz.isComplete,
      createdAt: quiz.createdAt,
      creatorId: quiz.creatorId,
      originalCreatorId: quiz.originalCreatorId,
      seizedById: quiz.seizedById,
      seizedAt: quiz.seizedAt,
      seizedReason: quiz.seizedReason,
      creator,
      seizedBy,
      reports: reportsWithReporter || quiz.reports,
      reportCount: quiz.reports?.length || 0,
      questionCount // 문제 수만 포함
    };
  });
}

// ========== API 엔드포인트 ==========

// 퀴즈 검색 API (최적화됨)
router.get('/quizzes/search', async (req, res) => {
  try {
    const searchTerm = req.query.q || '';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const filterStatus = req.query.status || 'all';

    const Quiz = require('../models/Quiz')(req.app.get('quizDb'));
    const User = require('../models/User')(req.app.get('userDb'));

    let searchQuery = {};

    if (searchTerm) {
      // 작성자 검색 (인덱스 사용)
      const matchingUsers = await User.find({
        $or: [
          { nickname: { $regex: searchTerm, $options: 'i' } },
          { email: { $regex: searchTerm, $options: 'i' } }
        ]
      })
        .select('_id')
        .lean(); // lean() 추가

      const userIds = matchingUsers.map(user => user._id);

      searchQuery.$or = [
        { title: { $regex: searchTerm, $options: 'i' } },
        { creatorId: { $in: userIds } },
        { originalCreatorId: { $in: userIds } }
      ];
    }

    // 상태 필터
    if (filterStatus === 'public') {
      searchQuery.isComplete = true;
      searchQuery.creatorId = { $ne: 'seized' };
    } else if (filterStatus === 'private') {
      searchQuery.isComplete = false;
      searchQuery.creatorId = { $ne: 'seized' };
    } else if (filterStatus === 'seized') {
      searchQuery.creatorId = 'seized';
    }

    // 병렬로 카운트와 데이터 조회
    const [totalCount, quizzes] = await Promise.all([
      Quiz.countDocuments(searchQuery),
      Quiz.aggregate([
        { $match: searchQuery },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            title: 1,
            description: 1,
            titleImageBase64: 1,
            isComplete: 1,
            createdAt: 1,
            creatorId: 1,
            originalCreatorId: 1,
            seizedById: 1,
            seizedAt: 1,
            seizedReason: 1,
            questionCount: { $size: { $ifNull: ['$questions', []] } } // questions 배열의 길이만 계산
          }
        }
      ])
    ]);

    // 한 번에 User 정보 추가
    const quizzesWithCreator = await enrichQuizzesWithUserInfo(quizzes, User);

    res.json({
      success: true,
      quizzes: quizzesWithCreator,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        hasMore: skip + quizzes.length < totalCount
      }
    });
  } catch (err) {
    console.error('Admin quiz search error:', err);
    res.status(500).json({
      success: false,
      message: '퀴즈 검색에 실패했습니다.'
    });
  }
});

// 모든 퀴즈 조회 (최적화됨)
router.get('/quizzes', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const filterStatus = req.query.status || 'all';

    const Quiz = require('../models/Quiz')(req.app.get('quizDb'));
    const User = require('../models/User')(req.app.get('userDb'));

    let filterQuery = {};
    if (filterStatus === 'public') {
      filterQuery.isComplete = true;
      filterQuery.creatorId = { $ne: 'seized' };
    } else if (filterStatus === 'private') {
      filterQuery.isComplete = false;
      filterQuery.creatorId = { $ne: 'seized' };
    } else if (filterStatus === 'seized') {
      filterQuery.creatorId = 'seized';
    }

    // 병렬로 카운트와 데이터 조회
    const [totalCount, quizzes] = await Promise.all([
      Quiz.countDocuments(filterQuery),
      Quiz.aggregate([
        { $match: filterQuery },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            title: 1,
            description: 1,
            titleImageBase64: 1,
            isComplete: 1,
            createdAt: 1,
            creatorId: 1,
            originalCreatorId: 1,
            seizedById: 1,
            seizedAt: 1,
            seizedReason: 1,
            questionCount: { $size: { $ifNull: ['$questions', []] } } // questions 배열의 길이만 계산
          }
        }
      ])
    ]);

    // 한 번에 User 정보 추가
    const quizzesWithCreator = await enrichQuizzesWithUserInfo(quizzes, User);

    res.json({
      success: true,
      quizzes: quizzesWithCreator,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        hasMore: skip + quizzes.length < totalCount
      }
    });
  } catch (err) {
    console.error('Admin quizzes load error:', err);
    res.status(500).json({
      success: false,
      message: '퀴즈 목록을 불러오는데 실패했습니다.'
    });
  }
});

// 퀴즈 공개/비공개 처리
router.patch('/quizzes/:quizId/visibility', async (req, res) => {
  try {
    const { quizId } = req.params;
    const { isComplete } = req.body;

    const Quiz = require('../models/Quiz')(req.app.get('quizDb'));
    const User = require('../models/User')(req.app.get('userDb'));

    // 공개로 전환 시 제작자 닉네임 저장 (성능 최적화)
    const updateData = { isComplete };

    if (isComplete) {
      const quiz = await Quiz.findById(quizId);
      if (quiz) {
        if (quiz.creatorId === 'seized') {
          updateData.creatorNickname = '관리자';
        } else {
          try {
            const creator = await User.findById(quiz.creatorId).select('nickname');
            updateData.creatorNickname = creator?.nickname || '알 수 없음';
          } catch (err) {
            console.error('제작자 정보 조회 실패:', err);
            updateData.creatorNickname = '알 수 없음';
          }
        }
      }
    }

    await Quiz.findByIdAndUpdate(quizId, updateData);

    res.json({
      success: true,
      message: `퀴즈가 ${isComplete ? '공개' : '비공개'} 처리되었습니다.`
    });
  } catch (err) {
    console.error('Quiz visibility update error:', err);
    res.status(500).json({
      success: false,
      message: '처리 중 오류가 발생했습니다.'
    });
  }
});

// 퀴즈 압수 (작성자를 관리자로 변경하고 원본 작성자 백업)
router.post('/quizzes/:quizId/seize', async (req, res) => {
  try {
    const { quizId } = req.params;
    const { reason } = req.body;

    const Quiz = require('../models/Quiz')(req.app.get('quizDb'));
    const quiz = await Quiz.findById(quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: '퀴즈를 찾을 수 없습니다.'
      });
    }

    // 이미 압수된 퀴즈인지 확인
    if (quiz.originalCreatorId) {
      return res.status(400).json({
        success: false,
        message: '이미 압수된 퀴즈입니다.'
      });
    }

    // 원본 작성자 백업 후 creatorId를 'seized'로 변경
    await Quiz.findByIdAndUpdate(quizId, {
      originalCreatorId: quiz.creatorId,
      creatorId: 'seized', // 압수된 퀴즈 표시
      seizedAt: new Date(),
      seizedById: req.user.id, // 압수한 관리자 ID 저장
      seizedReason: reason || '관리자 조치',
      isComplete: false // 압수 시 자동으로 비공개 처리
    });

    res.json({
      success: true,
      message: '퀴즈가 압수되었습니다. 원본 작성자는 더 이상 이 퀴즈에 접근할 수 없습니다.'
    });
  } catch (err) {
    console.error('Quiz seize error:', err);
    res.status(500).json({
      success: false,
      message: '압수 처리 중 오류가 발생했습니다.'
    });
  }
});

// 퀴즈 복구 (원본 작성자에게 되돌리기)
router.post('/quizzes/:quizId/restore', async (req, res) => {
  try {
    const { quizId } = req.params;

    const Quiz = require('../models/Quiz')(req.app.get('quizDb'));
    const quiz = await Quiz.findById(quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: '퀴즈를 찾을 수 없습니다.'
      });
    }

    // 압수된 퀴즈가 아니면 복구 불가
    if (!quiz.originalCreatorId) {
      return res.status(400).json({
        success: false,
        message: '압수되지 않은 퀴즈는 복구할 수 없습니다.'
      });
    }

    // 원본 작성자로 복구
    await Quiz.findByIdAndUpdate(quizId, {
      creatorId: quiz.originalCreatorId, // 원본 작성자로 복구
      originalCreatorId: null,
      seizedAt: null,
      seizedById: null,
      seizedReason: null
    });

    res.json({
      success: true,
      message: '퀴즈가 원본 작성자에게 복구되었습니다.'
    });
  } catch (err) {
    console.error('Quiz restore error:', err);
    res.status(500).json({
      success: false,
      message: '복구 처리 중 오류가 발생했습니다.'
    });
  }
});

// 퀴즈 영구 삭제 (superadmin만 가능)
router.delete('/quizzes/:quizId', async (req, res) => {
  try {
    const { quizId } = req.params;
    const Quiz = require('../models/Quiz')(req.app.get('quizDb'));

    const quiz = await Quiz.findByIdAndDelete(quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: '퀴즈를 찾을 수 없습니다.'
      });
    }

    res.json({
      success: true,
      message: '퀴즈가 영구 삭제되었습니다.'
    });
  } catch (err) {
    console.error('Quiz delete error:', err);
    res.status(500).json({
      success: false,
      message: '삭제 중 오류가 발생했습니다.'
    });
  }
});

// 신고된 퀴즈 목록 조회 (최적화됨)
router.get('/reported-quizzes', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 40;
    const skip = (page - 1) * limit;

    const Quiz = require('../models/Quiz')(req.app.get('quizDb'));
    const User = require('../models/User')(req.app.get('userDb'));

    // 병렬로 카운트와 데이터 조회
    const [totalCount, quizzes] = await Promise.all([
      Quiz.countDocuments({ 'reports.0': { $exists: true } }),
      Quiz.find({ 'reports.0': { $exists: true } })
        .select('-questions') // 🔥 큰 필드 제외! (reports는 필요하므로 유지)
        .sort({ 'reports.0.reportedAt': -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    // 한 번에 User 정보 추가 (신고자 포함)
    const quizzesWithDetails = await enrichQuizzesWithUserInfo(quizzes, User);

    res.json({
      success: true,
      quizzes: quizzesWithDetails,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        hasMore: skip + quizzes.length < totalCount
      }
    });
  } catch (err) {
    console.error('Reported quizzes load error:', err);
    res.status(500).json({
      success: false,
      message: '신고된 퀴즈 목록을 불러오는데 실패했습니다.'
    });
  }
});

// 신고 삭제
router.delete('/quizzes/:quizId/reports', async (req, res) => {
  try {
    const { quizId } = req.params;
    const { reportIds } = req.body;

    const Quiz = require('../models/Quiz')(req.app.get('quizDb'));

    if (reportIds && Array.isArray(reportIds)) {
      await Quiz.findByIdAndUpdate(quizId, {
        $pull: {
          reports: { _id: { $in: reportIds } }
        }
      });
    } else {
      await Quiz.findByIdAndUpdate(quizId, {
        $set: { reports: [] }
      });
    }

    res.json({
      success: true,
      message: '신고가 삭제되었습니다.'
    });
  } catch (err) {
    console.error('Report delete error:', err);
    res.status(500).json({
      success: false,
      message: '신고 삭제 중 오류가 발생했습니다.'
    });
  }
});

// 신고된 댓글 목록 조회
router.get('/reported-comments', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 40;
    const skip = (page - 1) * limit;

    const Comment = require('../models/Comment')(req.app.get('userDb'));
    const User = require('../models/User')(req.app.get('userDb'));

    // 병렬로 카운트와 데이터 조회
    const [totalCount, comments] = await Promise.all([
      Comment.countDocuments({ 'commentReports.0': { $exists: true } }),
      Comment.find({ 'commentReports.0': { $exists: true } })
        .sort({ 'commentReports.0.reportedAt': -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    // 사용자 ID 수집
    const userIds = new Set();
    comments.forEach(comment => {
      if (comment.userId) userIds.add(comment.userId.toString());
      comment.commentReports?.forEach(report => {
        if (report.reporterId) userIds.add(report.reporterId.toString());
      });
    });

    // 한 번에 모든 사용자 정보 조회
    const users = await User.find({ _id: { $in: Array.from(userIds) } })
      .select('_id username nickname email')
      .lean();

    const userMap = new Map();
    users.forEach(user => {
      userMap.set(user._id.toString(), user);
    });

    // 댓글에 사용자 정보 추가
    const commentsWithDetails = comments.map(comment => ({
      ...comment,
      author: userMap.get(comment.userId?.toString()) || { nickname: 'Unknown', email: 'N/A' },
      commentReports: comment.commentReports?.map(report => ({
        ...report,
        reporter: userMap.get(report.reporterId?.toString()) || { nickname: 'Unknown', email: 'N/A' }
      }))
    }));

    res.json({
      success: true,
      comments: commentsWithDetails,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        hasMore: skip + comments.length < totalCount
      }
    });
  } catch (err) {
    console.error('Reported comments load error:', err);
    res.status(500).json({
      success: false,
      message: '신고된 댓글 목록을 불러오는데 실패했습니다.'
    });
  }
});

// 댓글 신고 삭제
router.delete('/comments/:commentId/reports', async (req, res) => {
  try {
    const { commentId } = req.params;
    const { reportIds } = req.body;

    const Comment = require('../models/Comment')(req.app.get('userDb'));

    if (reportIds && Array.isArray(reportIds)) {
      await Comment.findByIdAndUpdate(commentId, {
        $pull: {
          commentReports: { _id: { $in: reportIds } }
        }
      });
    } else {
      await Comment.findByIdAndUpdate(commentId, {
        $set: { commentReports: [] }
      });
    }

    res.json({
      success: true,
      message: '댓글 신고가 삭제되었습니다.'
    });
  } catch (err) {
    console.error('Comment report delete error:', err);
    res.status(500).json({
      success: false,
      message: '댓글 신고 삭제 중 오류가 발생했습니다.'
    });
  }
});

// 댓글 숨김 처리
router.patch('/comments/:commentId/hide', async (req, res) => {
  try {
    const { commentId } = req.params;
    const { reason } = req.body;

    const Comment = require('../models/Comment')(req.app.get('userDb'));

    await Comment.findByIdAndUpdate(commentId, {
      isCommentHidden: true,
      commentHiddenReason: reason || '관리자 조치',
      commentHiddenAt: new Date()
    });

    res.json({
      success: true,
      message: '댓글이 숨김 처리되었습니다.'
    });
  } catch (err) {
    console.error('Comment hide error:', err);
    res.status(500).json({
      success: false,
      message: '댓글 숨김 처리 중 오류가 발생했습니다.'
    });
  }
});

// 댓글 영구 삭제
router.delete('/comments/:commentId', async (req, res) => {
  try {
    const { commentId } = req.params;
    const Comment = require('../models/Comment')(req.app.get('userDb'));

    const comment = await Comment.findByIdAndDelete(commentId);

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: '댓글을 찾을 수 없습니다.'
      });
    }

    res.json({
      success: true,
      message: '댓글이 영구 삭제되었습니다.'
    });
  } catch (err) {
    console.error('Comment delete error:', err);
    res.status(500).json({
      success: false,
      message: '댓글 삭제 중 오류가 발생했습니다.'
    });
  }
});

// ========== 사용자 정지 관리 API ==========

// 사용자 정지 처리
router.post('/users/:userId/suspend', async (req, res) => {
  try {
    const { userId } = req.params;
    const { days, reason } = req.body; // days: null이면 영구 정지, 숫자면 일수

    const User = require('../models/User')(req.app.get('userDb'));

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    // 관리자는 정지할 수 없음
    if (user.role === 'admin' || user.role === 'superadmin') {
      return res.status(403).json({
        success: false,
        message: '관리자는 정지할 수 없습니다.'
      });
    }

    // 정지 종료일 계산
    let suspendedUntil = null;
    if (days && days > 0) {
      suspendedUntil = new Date();
      suspendedUntil.setDate(suspendedUntil.getDate() + parseInt(days));
    }

    // 사용자 정지 처리
    await User.findByIdAndUpdate(userId, {
      isSuspended: true,
      suspendedUntil,
      suspendReason: reason || '관리자 조치',
      suspendedAt: new Date(),
      suspendedBy: req.user.id
    });

    const suspendMessage = days
      ? `사용자가 ${days}일간 정지되었습니다.`
      : '사용자가 영구 정지되었습니다.';

    res.json({
      success: true,
      message: suspendMessage
    });
  } catch (err) {
    console.error('User suspend error:', err);
    res.status(500).json({
      success: false,
      message: '사용자 정지 처리 중 오류가 발생했습니다.'
    });
  }
});

// 사용자 정지 해제
router.post('/users/:userId/unsuspend', async (req, res) => {
  try {
    const { userId } = req.params;

    const User = require('../models/User')(req.app.get('userDb'));

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    // 정지 해제
    await User.findByIdAndUpdate(userId, {
      isSuspended: false,
      suspendedUntil: null,
      suspendReason: null,
      suspendedAt: null,
      suspendedBy: null
    });

    res.json({
      success: true,
      message: '사용자 정지가 해제되었습니다.'
    });
  } catch (err) {
    console.error('User unsuspend error:', err);
    res.status(500).json({
      success: false,
      message: '사용자 정지 해제 중 오류가 발생했습니다.'
    });
  }
});

// 사용자 닉네임 수정 (관리자 전용)
router.patch('/users/:userId/nickname', async (req, res) => {
  try {
    const { userId } = req.params;
    const { nickname } = req.body;

    if (!nickname || nickname.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: '닉네임을 입력해주세요.'
      });
    }

    const trimmedNickname = nickname.trim();

    // 닉네임 길이 검증
    if (trimmedNickname.length < 2 || trimmedNickname.length > 20) {
      return res.status(400).json({
        success: false,
        message: '닉네임은 2자 이상 20자 이하로 입력해주세요.'
      });
    }

    const User = require('../models/User')(req.app.get('userDb'));

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    // 관리자는 닉네임 변경 불가
    if (user.role === 'admin' || user.role === 'superadmin') {
      return res.status(403).json({
        success: false,
        message: '관리자의 닉네임은 변경할 수 없습니다.'
      });
    }

    // 닉네임 중복 확인 (자신 제외)
    const existingUser = await User.findOne({
      nickname: trimmedNickname,
      _id: { $ne: userId }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: '이미 사용 중인 닉네임입니다.'
      });
    }

    // 닉네임 업데이트
    await User.findByIdAndUpdate(userId, {
      nickname: trimmedNickname
    });

    res.json({
      success: true,
      message: '닉네임이 성공적으로 변경되었습니다.',
      nickname: trimmedNickname
    });
  } catch (err) {
    console.error('User nickname update error:', err);
    res.status(500).json({
      success: false,
      message: '닉네임 변경 중 오류가 발생했습니다.'
    });
  }
});

// ========== 게임 활동 통계 API ==========

// 게임 활동 통계 조회
router.get('/stats/game', async (req, res) => {
  try {
    const GameActivity = require('../models/GameActivity')(req.app.get('quizDb'));

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const cutoffs = [
      { key: 'daily', since: oneDayAgo },
      { key: 'threeDays', since: threeDaysAgo },
      { key: 'weekly', since: weekAgo },
      { key: 'monthly', since: monthAgo }
    ];

    // 4개 기간 x 3개 쿼리 = 12개 쿼리 병렬 실행
    const queries = cutoffs.flatMap(({ since }) => [
      GameActivity.countDocuments({ type: 'session_created', timestamp: { $gte: since } }),
      GameActivity.countDocuments({ type: 'game_completed', timestamp: { $gte: since } }),
      GameActivity.distinct('ip', {
        type: { $in: ['session_created', 'session_joined'] },
        timestamp: { $gte: since },
        ip: { $ne: null }
      })
    ]);

    const results = await Promise.all(queries);

    const gameStats = {};
    cutoffs.forEach(({ key }, i) => {
      const base = i * 3;
      gameStats[key] = {
        sessionsCreated: results[base],
        gamesCompleted: results[base + 1],
        uniquePlayers: results[base + 2].length
      };
    });

    res.json({ success: true, gameStats });
  } catch (err) {
    console.error('Game stats load error:', err);
    res.status(500).json({
      success: false,
      message: '게임 활동 통계를 불러오는데 실패했습니다.'
    });
  }
});

// ========== 접속 통계 API ==========

// 퀴즈 이미지 조회 (호버링 시 사용)
router.get('/quizzes/:quizId/images', async (req, res) => {
  try {
    const { quizId } = req.params;
    const Quiz = require('../models/Quiz')(req.app.get('quizDb'));

    const quiz = await Quiz.findById(quizId)
      .select('questions')
      .lean();

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: '퀴즈를 찾을 수 없습니다.'
      });
    }

    // 이미지가 있는 문제만 필터링하여 전송
    const images = quiz.questions
      .filter(q => q.imageBase64 || q.answerImageBase64)
      .map(q => ({
        order: q.order,
        imageBase64: q.imageBase64 || null,
        answerImageBase64: q.answerImageBase64 || null
      }));

    res.json({
      success: true,
      images
    });
  } catch (err) {
    console.error('Quiz images load error:', err);
    res.status(500).json({
      success: false,
      message: '이미지를 불러오는데 실패했습니다.'
    });
  }
});

// 디버그: 오늘 저장된 IP 목록 확인
router.get('/stats/debug-ips', async (req, res) => {
  try {
    const AccessLog = require('../models/AccessLog')(req.app.get('userDb'));

    const now = new Date();
    const koreaOffset = 9 * 60 * 60 * 1000;
    const todayKorea = new Date(now.getTime() + koreaOffset);
    todayKorea.setUTCHours(0, 0, 0, 0);
    const today = new Date(todayKorea.getTime() - koreaOffset);

    // 봇 필터 패턴 (User-Agent 기반)
    const botPattern = /bot|crawler|spider|crawling|googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|sogou|exabot|facebot|facebookexternalhit|ia_archiver|curl|wget|python-requests|ahrefsbot|semrushbot|dotbot|petalbot/i;

    // 알려진 악성 IP 블랙리스트
    const knownBotIPs = [
      '3.94.205.55',      // AWS - .git 공격
      '185.244.104.2',    // 러시아 - 악성 스캔
      '89.248.168.222'    // 감지된 봇
    ];

    // AWS 내부 IP 확인 함수 (172.16.0.0/12 대역)
    function isAWSInternalIP(ip) {
      // IPv4-mapped IPv6 주소에서 IPv4 추출 (::ffff:172.31.x.x)
      const ipv4 = ip.replace(/^::ffff:/i, '');
      const parts = ipv4.split('.').map(Number);

      if (parts.length !== 4) return false;

      // 172.16.0.0/12 = 172.16.0.0 ~ 172.31.255.255
      // 10.0.0.0/8 = 10.0.0.0 ~ 10.255.255.255 (AWS VPC 사설 IP)
      return (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
             (parts[0] === 10);
    }

    // 봇 판별 함수 (User-Agent + IP + 행동 패턴)
    function isBotRequest(log) {
      // 1. User-Agent 기반
      if (botPattern.test(log.userAgent || '')) {
        return true;
      }

      // 2. IP 블랙리스트
      if (knownBotIPs.includes(log.ip)) {
        return true;
      }

      // 3. AWS 내부 IP (헬스 체크 등)
      if (isAWSInternalIP(log.ip)) {
        return true;
      }

      // 4. 행동 패턴 (공격 시도)
      if (log.path && (
        log.path.includes('/.git') ||
        log.path.includes('/.env') ||
        log.path.includes('/admin-console') ||
        log.path.includes('/adminpanel') ||
        log.path.includes('/wp-admin') ||
        log.path.includes('.php') ||
        log.path.includes('/config.')
      )) {
        return true;
      }

      return false;
    }

    // 오늘 로그 조회 (User-Agent 포함)
    const logs = await AccessLog.find({ timestamp: { $gte: today } })
      .select('ip path timestamp userAgent')
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    // 봇과 실제 사용자 구분 (개선된 필터 사용)
    const logsWithBotFlag = logs.map(log => ({
      ...log,
      isBot: isBotRequest(log)
    }));

    // 고유 IP 집계 (전체)
    const uniqueIpsAll = await AccessLog.distinct('ip', { timestamp: { $gte: today } });

    // 고유 IP 집계 (봇 제외) - 모든 로그를 가져와서 필터링
    const allLogs = await AccessLog.find({ timestamp: { $gte: today } })
      .select('ip path userAgent')
      .lean();

    const realUserIPs = new Set(
      allLogs
        .filter(log => !isBotRequest(log))
        .map(log => log.ip)
    );

    const uniqueIpsReal = Array.from(realUserIPs);

    res.json({
      success: true,
      uniqueIpCount: uniqueIpsAll.length,
      uniqueIpCountReal: uniqueIpsReal.length, // 봇 제외
      uniqueIps: uniqueIpsAll,
      uniqueIpsReal, // 봇 제외한 실제 사용자 IP
      recentLogs: logsWithBotFlag
    });
  } catch (err) {
    console.error('Debug IPs error:', err);
    res.status(500).json({
      success: false,
      message: '디버그 정보를 불러오는데 실패했습니다.'
    });
  }
});

// 접속 통계 조회
router.get('/stats', async (req, res) => {
  try {
    const AccessLog = require('../models/AccessLog')(req.app.get('userDb'));

    // 한국 시간대 (UTC+9) 기준으로 오늘 자정 계산
    const now = new Date();
    const koreaOffset = 9 * 60 * 60 * 1000; // 9시간을 밀리초로
    const todayKorea = new Date(now.getTime() + koreaOffset);
    todayKorea.setUTCHours(0, 0, 0, 0); // UTC 기준 자정으로 설정
    const today = new Date(todayKorea.getTime() - koreaOffset); // 다시 UTC로 변환

    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000); // 현재 접속자 계산용

    // 봇 필터 패턴 (User-Agent 기반)
    const botPattern = /bot|crawler|spider|crawling|googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|sogou|exabot|facebot|facebookexternalhit|ia_archiver|curl|wget|python-requests|ahrefsbot|semrushbot|dotbot|petalbot/i;

    // 알려진 악성 IP 블랙리스트
    const knownBotIPs = [
      '3.94.205.55',      // AWS - .git 공격
      '185.244.104.2',    // 러시아 - 악성 스캔
      '89.248.168.222'    // 감지된 봇
    ];

    // AWS 내부 IP 확인 함수 (172.16.0.0/12 대역)
    function isAWSInternalIP(ip) {
      // IPv4-mapped IPv6 주소에서 IPv4 추출 (::ffff:172.31.x.x)
      const ipv4 = ip.replace(/^::ffff:/i, '');
      const parts = ipv4.split('.').map(Number);

      if (parts.length !== 4) return false;

      // 172.16.0.0/12 = 172.16.0.0 ~ 172.31.255.255
      // 10.0.0.0/8 = 10.0.0.0 ~ 10.255.255.255 (AWS VPC 사설 IP)
      return (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
             (parts[0] === 10);
    }

    // 봇 판별 함수 (User-Agent + IP + 행동 패턴)
    function isBotRequest(log) {
      // 1. User-Agent 기반
      if (botPattern.test(log.userAgent || '')) {
        return true;
      }

      // 2. IP 블랙리스트
      if (knownBotIPs.includes(log.ip)) {
        return true;
      }

      // 3. AWS 내부 IP (헬스 체크 등)
      if (isAWSInternalIP(log.ip)) {
        return true;
      }

      // 4. 행동 패턴 (공격 시도)
      if (log.path && (
        log.path.includes('/.git') ||
        log.path.includes('/.env') ||
        log.path.includes('/admin-console') ||
        log.path.includes('/adminpanel') ||
        log.path.includes('/wp-admin') ||
        log.path.includes('.php') ||
        log.path.includes('/config.')
      )) {
        return true;
      }

      return false;
    }

    // MongoDB에서 IP 블랙리스트 제외 조건
    const ipBlacklistFilter = {
      ip: { $nin: knownBotIPs }
    };

    // AWS 내부 IP 필터 (172.16.0.0/12, 10.0.0.0/8)
    // MongoDB에서 IP 범위를 직접 필터링하기 위한 정규식
    const awsInternalIPFilter = {
      ip: {
        $not: /^::ffff:(172\.(1[6-9]|2[0-9]|3[0-1])\.|10\.)/i
      }
    };

    // 기본 봇 필터 (User-Agent + IP 블랙리스트 + AWS 내부 IP)
    const botFilter = {
      userAgent: { $not: botPattern },
      ...ipBlacklistFilter,
      ...awsInternalIPFilter
    };

    // 게임 플레이 중인 유저 집계
    const GameSession = require('../models/GameSession')(req.app.get('quizDb'));
    const activeSessions = await GameSession.find({ isActive: true }).lean();

    // 플레이 중인 고유 사용자 ID 수집 (중복 제거)
    const playingUserIds = new Set();
    activeSessions.forEach(session => {
      session.players
        .filter(p => p.connected)
        .forEach(p => playingUserIds.add(p.userId.toString()));
    });

    // 병렬로 모든 통계 조회 (봇 제외)
    const [dailyVisitors, weeklyVisitors, monthlyVisitors, onlineVisitors, dailyPageviews, weeklyPageviews, monthlyPageviews] = await Promise.all([
      // 일일 순 방문자 (고유 IP, 봇 제외)
      AccessLog.distinct('ip', { timestamp: { $gte: today }, ...botFilter }),
      // 주간 순 방문자
      AccessLog.distinct('ip', { timestamp: { $gte: weekAgo }, ...botFilter }),
      // 월간 순 방문자
      AccessLog.distinct('ip', { timestamp: { $gte: monthAgo }, ...botFilter }),
      // 현재 접속자 (최근 5분 이내 활동한 고유 IP, 봇 제외)
      AccessLog.distinct('ip', { timestamp: { $gte: fiveMinutesAgo }, ...botFilter }),
      // 일일 페이지뷰 (봇 제외)
      AccessLog.countDocuments({ timestamp: { $gte: today }, ...botFilter }),
      // 주간 페이지뷰
      AccessLog.countDocuments({ timestamp: { $gte: weekAgo }, ...botFilter }),
      // 월간 페이지뷰
      AccessLog.countDocuments({ timestamp: { $gte: monthAgo }, ...botFilter })
    ]);

    // 동시 접속자 수 (최근 5분 이내 활동한 실제 사용자)
    const onlineUsers = onlineVisitors.length;

    // 게임 플레이 중인 유저 수
    const playingUsers = playingUserIds.size;

    // 시간대별 접속 통계 (오늘, 한국 시간 기준, 봇 제외)
    const hourlyStats = await AccessLog.aggregate([
      {
        $match: {
          timestamp: { $gte: today },
          userAgent: { $not: botPattern },
          ip: {
            $nin: knownBotIPs,
            $not: /^::ffff:(172\.(1[6-9]|2[0-9]|3[0-1])\.|10\.)/i  // AWS 내부 IP 제외
          }
        }
      },
      {
        $addFields: {
          koreaHour: {
            $hour: {
              date: '$timestamp',
              timezone: '+09:00' // 한국 시간대
            }
          }
        }
      },
      {
        $group: {
          _id: '$koreaHour',
          count: { $sum: 1 },
          uniqueIps: { $addToSet: '$ip' }
        }
      },
      {
        $project: {
          hour: '$_id',
          pageviews: '$count',
          visitors: { $size: '$uniqueIps' }
        }
      },
      {
        $sort: { hour: 1 }
      }
    ]);

    // 일주일 일별 통계 (한국 시간 기준, 봇 제외)
    const dailyStats = await AccessLog.aggregate([
      {
        $match: {
          timestamp: { $gte: weekAgo },
          userAgent: { $not: botPattern },
          ip: {
            $nin: knownBotIPs,
            $not: /^::ffff:(172\.(1[6-9]|2[0-9]|3[0-1])\.|10\.)/i  // AWS 내부 IP 제외
          }
        }
      },
      {
        $addFields: {
          koreaDate: {
            $dateToString: {
              date: '$timestamp',
              format: '%Y-%m-%d',
              timezone: '+09:00' // 한국 시간대
            }
          }
        }
      },
      {
        $group: {
          _id: '$koreaDate',
          count: { $sum: 1 },
          uniqueIps: { $addToSet: '$ip' }
        }
      },
      {
        $project: {
          date: { $dateFromString: { dateString: '$_id' } },
          pageviews: '$count',
          visitors: { $size: '$uniqueIps' }
        }
      },
      {
        $sort: { date: 1 }
      }
    ]);

    res.json({
      success: true,
      stats: {
        daily: {
          visitors: dailyVisitors.length,
          pageviews: dailyPageviews
        },
        weekly: {
          visitors: weeklyVisitors.length,
          pageviews: weeklyPageviews
        },
        monthly: {
          visitors: monthlyVisitors.length,
          pageviews: monthlyPageviews
        },
        online: onlineUsers,
        playing: playingUsers, // 게임 플레이 중인 유저 수
        hourlyStats,
        dailyStats
      }
    });
  } catch (err) {
    console.error('Stats load error:', err);
    res.status(500).json({
      success: false,
      message: '통계를 불러오는데 실패했습니다.'
    });
  }
});

// 서버 리소스 정보 조회 (CPU, 메모리, 디스크)
router.get('/server-resources', async (req, res) => {
  try {
    const si = require('systeminformation');

    // 병렬로 모든 시스템 정보 수집
    const [cpuLoad, memInfo, fsSize, osInfo, currentLoad] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.osInfo(),
      si.currentLoad()
    ]);

    // CPU 사용률
    const cpuUsage = currentLoad.currentLoad.toFixed(2);

    // 메모리 사용률 (buff/cache 제외한 실제 사용량)
    const totalMem = memInfo.total;
    const usedMem = memInfo.active || memInfo.used; // active = 실제 사용 중인 메모리 (buff/cache 제외)
    const freeMem = memInfo.available || memInfo.free; // available = 실제 사용 가능한 메모리
    const memUsagePercent = ((usedMem / totalMem) * 100).toFixed(2);

    // 디스크 사용률 (첫 번째 파티션)
    const disk = fsSize[0] || {};
    const diskUsagePercent = disk.use ? disk.use.toFixed(2) : 0;

    res.json({
      success: true,
      resources: {
        cpu: {
          usage: parseFloat(cpuUsage),
          cores: currentLoad.cpus?.length || 0
        },
        memory: {
          total: totalMem,
          used: usedMem,
          free: freeMem,
          usagePercent: parseFloat(memUsagePercent)
        },
        disk: {
          size: disk.size || 0,
          used: disk.used || 0,
          available: disk.available || 0,
          usagePercent: parseFloat(diskUsagePercent)
        },
        os: {
          platform: osInfo.platform,
          distro: osInfo.distro,
          release: osInfo.release,
          arch: osInfo.arch
        },
        uptime: process.uptime() // Node.js 프로세스 실행 시간 (초)
      }
    });
  } catch (err) {
    console.error('Server resources error:', err);
    res.status(500).json({
      success: false,
      message: '서버 리소스 정보를 불러오는데 실패했습니다.'
    });
  }
});

// ========== IP 차단 관리 API ==========

// 차단된 IP 목록 조회
router.get('/blocked-ips', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const BlockedIP = require('../models/BlockedIP')(req.app.get('userDb'));
    const User = require('../models/User')(req.app.get('userDb'));

    // 병렬로 카운트와 데이터 조회
    const [totalCount, blockedIPs] = await Promise.all([
      BlockedIP.countDocuments({ isActive: true }),
      BlockedIP.find({ isActive: true })
        .sort({ blockedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    // 차단한 관리자 정보 추가
    const adminIds = blockedIPs
      .filter(ip => ip.blockedBy)
      .map(ip => ip.blockedBy);

    const admins = await User.find({ _id: { $in: adminIds } })
      .select('_id username nickname email')
      .lean();

    const adminMap = new Map();
    admins.forEach(admin => {
      adminMap.set(admin._id.toString(), admin);
    });

    const blockedIPsWithAdmin = blockedIPs.map(ip => ({
      ...ip,
      admin: ip.blockedBy ? adminMap.get(ip.blockedBy.toString()) : null
    }));

    res.json({
      success: true,
      blockedIPs: blockedIPsWithAdmin,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        hasMore: skip + blockedIPs.length < totalCount
      }
    });
  } catch (err) {
    console.error('Blocked IPs load error:', err);
    res.status(500).json({
      success: false,
      message: '차단 IP 목록을 불러오는데 실패했습니다.'
    });
  }
});

// IP 수동 차단
router.post('/blocked-ips', async (req, res) => {
  try {
    const { ip, reason, details, days } = req.body;

    if (!ip || !reason) {
      return res.status(400).json({
        success: false,
        message: 'IP와 차단 사유는 필수입니다.'
      });
    }

    const BlockedIP = require('../models/BlockedIP')(req.app.get('userDb'));

    // 이미 차단된 IP인지 확인
    const existing = await BlockedIP.findOne({ ip, isActive: true });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: '이미 차단된 IP입니다.'
      });
    }

    // 차단 기간 계산
    let expiresAt = null;
    if (days && days > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + parseInt(days));
    }

    // IP 차단 생성
    await BlockedIP.create({
      ip,
      reason: 'manual_block',
      details: details || reason,
      blockedBy: req.user.id,
      expiresAt,
      isActive: true
    });

    const blockMessage = days
      ? `IP가 ${days}일간 차단되었습니다.`
      : 'IP가 영구 차단되었습니다.';

    res.json({
      success: true,
      message: blockMessage
    });
  } catch (err) {
    console.error('IP block error:', err);
    res.status(500).json({
      success: false,
      message: 'IP 차단 중 오류가 발생했습니다.'
    });
  }
});

// IP 차단 해제
router.delete('/blocked-ips/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const BlockedIP = require('../models/BlockedIP')(req.app.get('userDb'));

    const blocked = await BlockedIP.findById(id);
    if (!blocked) {
      return res.status(404).json({
        success: false,
        message: '차단 기록을 찾을 수 없습니다.'
      });
    }

    // 차단 해제 (삭제하지 않고 비활성화)
    await BlockedIP.findByIdAndUpdate(id, {
      isActive: false
    });

    res.json({
      success: true,
      message: 'IP 차단이 해제되었습니다.'
    });
  } catch (err) {
    console.error('IP unblock error:', err);
    res.status(500).json({
      success: false,
      message: 'IP 차단 해제 중 오류가 발생했습니다.'
    });
  }
});

// 최근 악의적인 접근 시도 조회 (AccessLog 기반)
router.get('/suspicious-activities', async (req, res) => {
  try {
    const AccessLog = require('../models/AccessLog')(req.app.get('userDb'));

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // 의심스러운 경로 패턴
    const suspiciousPathPattern = /shouye\.html|mindex\.html|360\.html|wp-admin|phpmyadmin|\.env|\.git|admin\.php|config\.php/i;

    // 최근 1시간 내 의심스러운 접근 조회
    const suspiciousLogs = await AccessLog.find({
      timestamp: { $gte: oneHourAgo },
      $or: [
        { path: { $regex: suspiciousPathPattern } },
        { userAgent: { $regex: /sqlmap|nikto|nmap|masscan|acunetix|metasploit/i } }
      ]
    })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    // IP별로 그룹화
    const ipGroups = {};
    suspiciousLogs.forEach(log => {
      if (!ipGroups[log.ip]) {
        ipGroups[log.ip] = {
          ip: log.ip,
          count: 0,
          paths: [],
          userAgent: log.userAgent,
          lastSeen: log.timestamp
        };
      }
      ipGroups[log.ip].count++;
      ipGroups[log.ip].paths.push(log.path);
      if (new Date(log.timestamp) > new Date(ipGroups[log.ip].lastSeen)) {
        ipGroups[log.ip].lastSeen = log.timestamp;
      }
    });

    const activities = Object.values(ipGroups).sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      activities,
      totalCount: activities.length
    });
  } catch (err) {
    console.error('Suspicious activities load error:', err);
    res.status(500).json({
      success: false,
      message: '의심스러운 활동 조회 중 오류가 발생했습니다.'
    });
  }
});

// ========== 문의 관리 API ==========

// 문의 목록 조회
router.get('/contacts', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const status = req.query.status || 'all'; // all, pending, in_progress, resolved, closed

    const Contact = require('../models/Contact')(req.app.get('userDb'));
    const User = require('../models/User')(req.app.get('userDb'));

    let query = {};
    if (status !== 'all') {
      query.status = status;
    }

    // 병렬로 카운트와 데이터 조회
    const [totalCount, contacts] = await Promise.all([
      Contact.countDocuments(query),
      Contact.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    // 사용자 정보 추가
    const userIds = contacts
      .filter(c => c.userId)
      .map(c => c.userId);

    const respondedByIds = contacts
      .filter(c => c.respondedBy)
      .map(c => c.respondedBy);

    const allUserIds = [...new Set([...userIds, ...respondedByIds])];

    const users = await User.find({ _id: { $in: allUserIds } })
      .select('_id username nickname email')
      .lean();

    const userMap = new Map();
    users.forEach(user => {
      userMap.set(user._id.toString(), user);
    });

    const contactsWithDetails = contacts.map(contact => ({
      ...contact,
      user: contact.userId ? userMap.get(contact.userId.toString()) : null,
      respondedByUser: contact.respondedBy ? userMap.get(contact.respondedBy.toString()) : null
    }));

    res.json({
      success: true,
      contacts: contactsWithDetails,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        hasMore: skip + contacts.length < totalCount
      }
    });
  } catch (err) {
    console.error('Contacts load error:', err);
    res.status(500).json({
      success: false,
      message: '문의 목록을 불러오는데 실패했습니다.'
    });
  }
});

// 문의 상태 변경
router.patch('/contacts/:contactId/status', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'in_progress', 'resolved', 'closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: '유효하지 않은 상태입니다.'
      });
    }

    const Contact = require('../models/Contact')(req.app.get('userDb'));

    await Contact.findByIdAndUpdate(contactId, {
      status,
      updatedAt: new Date()
    });

    res.json({
      success: true,
      message: '문의 상태가 변경되었습니다.'
    });
  } catch (err) {
    console.error('Contact status update error:', err);
    res.status(500).json({
      success: false,
      message: '상태 변경 중 오류가 발생했습니다.'
    });
  }
});

// 문의 답변 작성
router.post('/contacts/:contactId/respond', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { response } = req.body;

    if (!response || response.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: '답변 내용을 입력해주세요.'
      });
    }

    const Contact = require('../models/Contact')(req.app.get('userDb'));

    await Contact.findByIdAndUpdate(contactId, {
      adminResponse: response.trim(),
      respondedBy: req.user.id,
      respondedAt: new Date(),
      status: 'resolved',
      updatedAt: new Date()
    });

    res.json({
      success: true,
      message: '답변이 저장되었습니다.'
    });
  } catch (err) {
    console.error('Contact response error:', err);
    res.status(500).json({
      success: false,
      message: '답변 저장 중 오류가 발생했습니다.'
    });
  }
});

// 문의 삭제
router.delete('/contacts/:contactId', async (req, res) => {
  try {
    const { contactId } = req.params;
    const Contact = require('../models/Contact')(req.app.get('userDb'));

    const contact = await Contact.findByIdAndDelete(contactId);

    if (!contact) {
      return res.status(404).json({
        success: false,
        message: '문의를 찾을 수 없습니다.'
      });
    }

    res.json({
      success: true,
      message: '문의가 삭제되었습니다.'
    });
  } catch (err) {
    console.error('Contact delete error:', err);
    res.status(500).json({
      success: false,
      message: '문의 삭제 중 오류가 발생했습니다.'
    });
  }
});

// ========== 유저 관리 API ==========

// 유저 목록 조회
router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const role = req.query.role || 'all';

    const User = require('../models/User')(req.app.get('userDb'));

    // 역할 필터링 조건
    let roleFilter = {};
    if (role !== 'all') {
      roleFilter.role = role;
    }

    // 전체 개수 조회
    const totalCount = await User.countDocuments(roleFilter);

    // 유저 목록 조회
    const users = await User.find(roleFilter)
      .select('username nickname email profileImage googleId kakaoId role createdAt isSuspended suspendedUntil suspendReason')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      success: true,
      users,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        hasMore: skip + users.length < totalCount
      }
    });
  } catch (err) {
    console.error('Users list error:', err);
    res.status(500).json({
      success: false,
      message: '유저 목록 조회 중 오류가 발생했습니다.'
    });
  }
});

// 유저 검색
router.get('/users/search', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const searchTerm = req.query.q || '';
    const role = req.query.role || 'all';

    const User = require('../models/User')(req.app.get('userDb'));

    // 검색 조건 (이름, 닉네임, 이메일)
    const searchQuery = {
      $or: [
        { username: { $regex: searchTerm, $options: 'i' } },
        { nickname: { $regex: searchTerm, $options: 'i' } },
        { email: { $regex: searchTerm, $options: 'i' } }
      ]
    };

    // 역할 필터 추가
    if (role !== 'all') {
      searchQuery.role = role;
    }

    // 전체 개수 조회
    const totalCount = await User.countDocuments(searchQuery);

    // 유저 목록 조회
    const users = await User.find(searchQuery)
      .select('username nickname email profileImage googleId kakaoId role createdAt isSuspended suspendedUntil suspendReason')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      success: true,
      users,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        hasMore: skip + users.length < totalCount
      }
    });
  } catch (err) {
    console.error('Users search error:', err);
    res.status(500).json({
      success: false,
      message: '유저 검색 중 오류가 발생했습니다.'
    });
  }
});

// 특정 유저 정보 조회
router.get('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const User = require('../models/User')(req.app.get('userDb'));

    const user = await User.findById(userId)
      .select('username nickname email profileImage googleId kakaoId role createdAt isSuspended suspendedUntil suspendReason')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    res.json(user);
  } catch (err) {
    console.error('User info error:', err);
    res.status(500).json({
      success: false,
      message: '사용자 정보 조회 중 오류가 발생했습니다.'
    });
  }
});

// 유저 프로필 이미지 변경
router.patch('/users/:userId/profile-image', async (req, res) => {
  try {
    const { userId } = req.params;
    const { profileImageBase64 } = req.body;

    if (!profileImageBase64) {
      return res.status(400).json({
        success: false,
        message: '프로필 이미지가 필요합니다.'
      });
    }

    // S3 URL인지 Base64인지 확인
    const isS3Url = profileImageBase64.startsWith('http://') || profileImageBase64.startsWith('https://');
    const isBase64 = profileImageBase64.startsWith('data:image/');

    if (!isS3Url && !isBase64) {
      return res.status(400).json({
        success: false,
        message: '유효하지 않은 이미지 형식입니다.'
      });
    }

    const User = require('../models/User')(req.app.get('userDb'));
    const { uploadProfileImage, deleteImageFromS3 } = require('../utils/s3Uploader');

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    try {
      let finalImageUrl;

      if (isS3Url) {
        // 클라이언트에서 이미 S3에 업로드한 경우 - URL만 저장
        finalImageUrl = profileImageBase64;
      } else {
        // Base64 이미지인 경우 - 서버에서 S3에 업로드
        finalImageUrl = await uploadProfileImage(profileImageBase64, userId);
      }

      // 이전 S3 이미지 삭제 (우리 버킷의 이미지인 경우만)
      if (user.profileImage && user.profileImage.includes(process.env.S3_BUCKET_NAME || 'playcode-quiz-images')) {
        await deleteImageFromS3(user.profileImage);
      }

      // 프로필 이미지 URL 업데이트
      await User.findByIdAndUpdate(userId, {
        profileImage: finalImageUrl
      });

      res.json({
        success: true,
        message: '프로필 이미지가 변경되었습니다.'
      });
    } catch (s3Error) {
      console.error('프로필 이미지 S3 업로드 실패:', s3Error);
      return res.status(500).json({
        success: false,
        message: '프로필 이미지 업로드에 실패했습니다.'
      });
    }
  } catch (err) {
    console.error('Profile image update error:', err);
    res.status(500).json({
      success: false,
      message: '프로필 이미지 변경 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;
