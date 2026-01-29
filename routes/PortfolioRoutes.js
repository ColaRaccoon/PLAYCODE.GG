const express = require('express');
const path = require('path');
const router = express.Router();

// 환경변수에서 토큰 가져오기
const PORTFOLIO_TOKEN = process.env.PORTFOLIO_TOKEN || 'default-token-please-change';

/**
 * 포트폴리오 페이지
 * URL: /portfolio/:token
 *
 * 보안:
 * - 토큰을 아는 사람만 접근 가능
 * - 토큰이 일치하지 않으면 404 반환
 * - 접속 로그 기록
 */
router.get('/portfolio/:token', (req, res) => {
    const { token } = req.params;

    // 토큰 검증
    if (token !== PORTFOLIO_TOKEN) {
        console.log(`❌ Invalid portfolio token attempt: ${token} from IP: ${req.ip}`);
        return res.status(404).send('404 - Page Not Found');
    }

    // 접속 로그 기록 (면접관이 언제 봤는지 확인 가능)
    console.log('✅ Portfolio viewed');
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log(`   IP: ${req.ip}`);
    console.log(`   User-Agent: ${req.headers['user-agent']}`);

    // 포트폴리오 HTML 파일 전송
    res.sendFile(path.join(__dirname, '../public/portfolio.html'));
});

module.exports = router;
