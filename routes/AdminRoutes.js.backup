const express = require('express');
const router = express.Router();
const path = require('path');
const { checkAdmin, checkSuperAdmin } = require('../middlewares/AdminMiddleware');

// 모든 admin 라우트에 권한 검증 적용 (대시보드, 조회, 압수, 복구는 admin도 가능)
router.use((req, res, next) => {
  // 삭제 API만 superadmin 권한 필요
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

// 퀴즈 검색 API (비공개 포함) - 페이지네이션 지원
router.get('/quizzes/search', async (req, res) => {
  try {
    const searchTerm = req.query.q || '';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 40;
    const skip = (page - 1) * limit;
    const filterStatus = req.query.status || 'all'; // all, public, private

    const Quiz = require('../models/Quiz')(req.app.get('quizDb'));
    const User = require('../models/User')(req.app.get('userDb'));

    // 검색 조건 구성
    let searchQuery = {};

    if (searchTerm) {
      // 1. 작성자 검색 (닉네임, 이메일)
      const matchingUsers = await User.find({
        $or: [
          { nickname: { $regex: searchTerm, $options: 'i' } },
          { email: { $regex: searchTerm, $options: 'i' } }
        ]
      }).select('_id');

      const userIds = matchingUsers.map(user => user._id);

      // 2. 제목 또는 작성자로 검색
      searchQuery.$or = [
        { title: { $regex: searchTerm, $options: 'i' } },
        { creatorId: { $in: userIds } },
        { originalCreatorId: { $in: userIds } } // 압수된 퀴즈도 원작성자로 검색
      ];
    }

    // 상태 필터 추가
    if (filterStatus === 'public') {
      searchQuery.isComplete = true;
      searchQuery.creatorId = { $ne: 'seized' }; // 압수되지 않은 것만
    } else if (filterStatus === 'private') {
      searchQuery.isComplete = false;
      searchQuery.creatorId = { $ne: 'seized' }; // 압수되지 않은 것만
    } else if (filterStatus === 'seized') {
      searchQuery.creatorId = 'seized'; // 압수된 것만
    }

    // 전체 퀴즈 개수
    const totalCount = await Quiz.countDocuments(searchQuery);

    // 페이지별 퀴즈 조회
    const quizzes = await Quiz.find(searchQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // 작성자 및 압수자 정보 추가
    const quizzesWithCreator = await Promise.all(
      quizzes.map(async (quiz) => {
        let creator = null;
        let seizedBy = null;

        if (quiz.creatorId === 'seized' && quiz.originalCreatorId) {
          creator = await User.findById(quiz.originalCreatorId).select('username nickname email');
          if (quiz.seizedById) {
            seizedBy = await User.findById(quiz.seizedById).select('username nickname email');
          }
        } else if (quiz.creatorId !== 'seized') {
          creator = await User.findById(quiz.creatorId).select('username nickname email');
        }

        return {
          ...quiz,
          creator: creator || { username: 'Unknown', nickname: 'Unknown', email: 'N/A' },
          seizedBy: seizedBy || null
        };
      })
    );

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

// 모든 퀴즈 조회 (비공개 포함) - 페이지네이션 지원
router.get('/quizzes', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 40;
    const skip = (page - 1) * limit;
    const filterStatus = req.query.status || 'all'; // all, public, private, seized

    const Quiz = require('../models/Quiz')(req.app.get('quizDb'));
    const User = require('../models/User')(req.app.get('userDb'));

    // 상태 필터 조건 구성
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

    // 전체 퀴즈 개수
    const totalCount = await Quiz.countDocuments(filterQuery);

    // 페이지별 퀴즈 조회
    const quizzes = await Quiz.find(filterQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // 작성자 및 압수자 정보 추가
    const quizzesWithCreator = await Promise.all(
      quizzes.map(async (quiz) => {
        let creator = null;
        let seizedBy = null;

        // creatorId가 'seized'인 경우 originalCreatorId에서 원래 작성자 조회
        if (quiz.creatorId === 'seized' && quiz.originalCreatorId) {
          creator = await User.findById(quiz.originalCreatorId).select('username nickname email');
          // 압수자 정보도 조회
          if (quiz.seizedById) {
            seizedBy = await User.findById(quiz.seizedById).select('username nickname email');
          }
        } else if (quiz.creatorId !== 'seized') {
          creator = await User.findById(quiz.creatorId).select('username nickname email');
        }

        return {
          ...quiz,
          creator: creator || { username: 'Unknown', nickname: 'Unknown', email: 'N/A' },
          seizedBy: seizedBy || null
        };
      })
    );

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
    await Quiz.findByIdAndUpdate(quizId, { isComplete });

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
    const quiz = await Quiz.findById(quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: '퀴즈를 찾을 수 없습니다.'
      });
    }

    await Quiz.findByIdAndDelete(quizId);

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

// 신고된 퀴즈 목록 조회 (신고 있는 퀴즈만)
router.get('/reported-quizzes', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 40;
    const skip = (page - 1) * limit;

    const Quiz = require('../models/Quiz')(req.app.get('quizDb'));
    const User = require('../models/User')(req.app.get('userDb'));

    // 신고가 있는 퀴즈만 조회
    const totalCount = await Quiz.countDocuments({ 'reports.0': { $exists: true } });

    const quizzes = await Quiz.find({ 'reports.0': { $exists: true } })
      .sort({ 'reports.0.reportedAt': -1 }) // 최신 신고순
      .skip(skip)
      .limit(limit)
      .lean();

    // 작성자, 압수자 및 신고자 정보 추가
    const quizzesWithDetails = await Promise.all(
      quizzes.map(async (quiz) => {
        let creator = null;
        let seizedBy = null;

        // creatorId가 'seized'인 경우 originalCreatorId에서 원래 작성자 조회
        if (quiz.creatorId === 'seized' && quiz.originalCreatorId) {
          creator = await User.findById(quiz.originalCreatorId).select('username nickname email');
          // 압수자 정보도 조회
          if (quiz.seizedById) {
            seizedBy = await User.findById(quiz.seizedById).select('username nickname email');
          }
        } else if (quiz.creatorId !== 'seized') {
          creator = await User.findById(quiz.creatorId).select('username nickname email');
        }

        // 신고자 정보 추가
        const reportsWithReporter = await Promise.all(
          quiz.reports.map(async (report) => {
            const reporter = await User.findById(report.reporterId).select('nickname email');
            return {
              ...report,
              reporter: reporter || { nickname: 'Unknown', email: 'N/A' }
            };
          })
        );

        return {
          ...quiz,
          creator: creator || { username: 'Unknown', nickname: 'Unknown', email: 'N/A' },
          seizedBy: seizedBy || null,
          reports: reportsWithReporter,
          reportCount: quiz.reports.length
        };
      })
    );

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

// 신고 삭제 (조치 없이 신고만 삭제)
router.delete('/quizzes/:quizId/reports', async (req, res) => {
  try {
    const { quizId } = req.params;
    const { reportIds } = req.body; // 삭제할 신고 ID 배열

    const Quiz = require('../models/Quiz')(req.app.get('quizDb'));
    const quiz = await Quiz.findById(quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: '퀴즈를 찾을 수 없습니다.'
      });
    }

    if (reportIds && Array.isArray(reportIds)) {
      // 특정 신고만 삭제 - $pull 사용
      await Quiz.findByIdAndUpdate(quizId, {
        $pull: {
          reports: { _id: { $in: reportIds } }
        }
      });
    } else {
      // 모든 신고 삭제 - $set 사용
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

module.exports = router;
