const jwt = require('jsonwebtoken');
const { verifyAndRefreshToken } = require('./AuthMiddleware');
const JWT_SECRET = process.env.JWT_SECRET;

// 관리자 권한 체크 미들웨어 (admin 또는 superadmin)
async function checkAdmin(req, res, next) {
  try {
    // 1. 토큰 검증 및 갱신 (AuthMiddleware의 공통 함수 사용)
    const authResult = await verifyAndRefreshToken(req, res);

    if (!authResult.success) {
      return res.status(authResult.status).json({
        success: false,
        message: authResult.message
      });
    }

    // 2. DB에서 최신 사용자 정보 가져오기
    const User = require('../models/User')(req.app.get('userDb'));
    const user = await User.findById(authResult.user.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    // 3. 관리자 권한 확인 (admin 또는 superadmin)
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: '관리자 권한이 필요합니다.'
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('Admin middleware error:', err);
    return res.status(401).json({
      success: false,
      message: '인증에 실패했습니다.'
    });
  }
}

// 최고 관리자 권한 체크 미들웨어 (superadmin만)
async function checkSuperAdmin(req, res, next) {
  try {
    // 1. 토큰 검증 및 갱신 (AuthMiddleware의 공통 함수 사용)
    const authResult = await verifyAndRefreshToken(req, res);

    if (!authResult.success) {
      return res.status(authResult.status).json({
        success: false,
        message: authResult.message
      });
    }

    // 2. DB에서 최신 사용자 정보 가져오기
    const User = require('../models/User')(req.app.get('userDb'));
    const user = await User.findById(authResult.user.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    // 3. 최고 관리자 권한 확인
    if (user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: '최고 관리자 권한이 필요합니다.'
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('SuperAdmin middleware error:', err);
    return res.status(401).json({
      success: false,
      message: '인증에 실패했습니다.'
    });
  }
}

module.exports = { checkAdmin, checkSuperAdmin };
