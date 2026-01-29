const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { signup, login, getUserInfo, logout, refreshToken, updateProfile, deleteAccount, sendVerificationCode, verifyEmailCode } = require('../controllers/AuthController');
const authenticateToken = require('../middlewares/AuthMiddleware');

// 인증 요청 제한 (로그인/회원가입만)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 5, // 15분당 최대 5개 요청
  message: '로그인 시도가 너무 많습니다. 15분 후 다시 시도해주세요.',
  standardHeaders: true,
  legacyHeaders: false,
});

// 이메일 인증 코드 요청 제한
const emailLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1분
  max: 3, // 1분당 최대 3개 요청
  message: '인증 코드 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
  standardHeaders: true,
  legacyHeaders: false,
});

// 로그인 페이지 라우팅
router.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

// 회원가입 페이지 라우팅 (필요 시)
router.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/signup.html'));
});

// ✅ 로그인된 사용자 정보 요청 (GET /my-info)
router.get('/my-info', authenticateToken, getUserInfo);

// 마이페이지 라우팅
router.get('/my-page', authenticateToken, (req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'public', 'my-page.html'));
});

// 내 정보 수정 페이지
router.get('/edit-profile', authenticateToken, (req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'public', 'edit-profile.html'));
});

// 프로필 업데이트 API
router.put('/update-profile', authenticateToken, updateProfile);

router.post('/login', authLimiter, login); // 로그인만 제한
router.post('/signup', authLimiter, signup); // 회원가입만 제한
router.get('/me', authenticateToken, getUserInfo); // 세션 확인은 제한 없음
router.post('/logout', logout);
router.post('/refresh', refreshToken);
router.delete('/delete-account', authenticateToken, deleteAccount);

// 이메일 인증 관련 라우트
router.post('/send-verification-code', emailLimiter, sendVerificationCode); // 이메일 전송 제한
router.post('/verify-email-code', authLimiter, verifyEmailCode); // 인증 시도 제한

module.exports = router;