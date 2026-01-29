// BotBlocker.js - 악의적인 봇 차단 미들웨어

// 알려진 해킹 도구 및 악의적인 봇 User-Agent 패턴
const MALICIOUS_USER_AGENTS = [
  /sqlmap/i,
  /nikto/i,
  /nmap/i,
  /masscan/i,
  /acunetix/i,
  /netsparker/i,
  /metasploit/i,
  /burp/i,
  /havij/i,
  /w3af/i,
  /nessus/i,
  /openvas/i,
  /dirbuster/i,
  /gobuster/i,
  /wpscan/i,
  /joomla.*scanner/i,
  /drupal.*scanner/i,
  /wordpress.*scanner/i,
  /python-requests/i,  // 대부분 스크립트 봇
  /go-http-client/i,   // Go 기반 스캐너
  /zgrab/i,            // 대규모 스캐너
  /masscan/i,
  /paros/i,
  /zap/i,              // OWASP ZAP
  /arachni/i,
  /curl\/7\./i,        // curl 도구 (정상 사용도 있지만 의심)
  /wget/i,             // wget 도구
  /scanner/i,
  /bot.*scan/i,
  /security.*test/i,
  /penetration.*test/i,
  /vulnerability.*scanner/i
];

// 의심스러운 경로 패턴 (한국 웹사이트에서 절대 사용하지 않는 경로)
const SUSPICIOUS_PATHS = [
  // 중국/해외 특정 파일명
  /\/shouye\.html$/i,
  /\/mindex\.html$/i,
  /\/360\.html$/i,
  /\/ay-\d+\.html$/i,
  /\/code\d+\.html$/i,

  // 일반적인 스캐닝 경로
  /\/\d{3}\/index\.html$/i,  // /067/index.html 같은 패턴
  /\/admin\.php$/i,
  /\/wp-admin/i,
  /\/wp-login/i,
  /\/phpmyadmin/i,
  /\/mysql/i,
  /\/cgi-bin/i,
  /\/phpinfo\.php$/i,
  /\/test\.php$/i,
  /\/shell\.php$/i,
  /\/upload\.php$/i,
  /\/config\.php$/i,
  /\/\.env$/i,
  /\/\.git/i,
  /\/\.svn/i,
  /\/backup/i,
  /\/admin\/login/i,
  /\/adminer/i,
  /\/xmlrpc\.php$/i,

  // SQL Injection 시도
  /union.*select/i,
  /concat.*char/i,
  /'.*or.*1=1/i,

  // Path Traversal 시도
  /\.\.[\/\\]/,
  /etc[\/\\]passwd/i,
  /windows[\/\\]system32/i
];

// 404 추적을 위한 메모리 캐시 (IP별 404 카운트)
const notFoundTracker = new Map();
const MAX_TRACKER_SIZE = 1000; // 🛡️ 최대 1,000개로 제한 (메모리 누수 방지 - 10,000→1,000 축소)
const MAX_PATH_ARRAY_SIZE = 10; // 🛡️ IP당 경로 배열 최대 10개로 제한 (50→10 축소)

// ⚡ 차단된 IP 메모리 캐시 (성능 최적화)
const blockedIPCache = new Set();
let lastCacheUpdate = 0;
const CACHE_TTL = 60 * 1000; // 1분마다 갱신
let isCacheReady = false; // 🛡️ 초기 캐시 로드 완료 여부
let isUpdatingCache = false; // 🛡️ 캐시 갱신 중 플래그 (중복 호출 방지)

// 정리 주기 (10분마다 오래된 기록 삭제)
setInterval(() => {
  const now = Date.now();

  // 🛡️ 메모리 고갈 방지: 10,000개 초과 시 오래된 것부터 삭제
  if (notFoundTracker.size > MAX_TRACKER_SIZE) {
    const sortedEntries = Array.from(notFoundTracker.entries())
      .sort((a, b) => a[1].lastAttempt - b[1].lastAttempt);

    const toDelete = sortedEntries.slice(0, notFoundTracker.size - MAX_TRACKER_SIZE);
    toDelete.forEach(([ip]) => notFoundTracker.delete(ip));

    console.warn(`⚠️ notFoundTracker 크기 제한 초과: ${toDelete.length}개 항목 삭제됨`);
  }

  // 10분 이상 활동이 없으면 삭제
  for (const [ip, data] of notFoundTracker.entries()) {
    if (now - data.lastAttempt > 10 * 60 * 1000) {
      notFoundTracker.delete(ip);
    }
  }
}, 10 * 60 * 1000);

// IP 추출 헬퍼 함수
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.connection?.remoteAddress ||
         req.socket?.remoteAddress ||
         req.ip ||
         'unknown';
}

// 악의적인 User-Agent 확인
function isMaliciousUserAgent(userAgent) {
  if (!userAgent) return false;
  return MALICIOUS_USER_AGENTS.some(pattern => pattern.test(userAgent));
}

// 의심스러운 경로 확인
function isSuspiciousPath(path) {
  return SUSPICIOUS_PATHS.some(pattern => pattern.test(path));
}

// ⚡ 차단된 IP 캐시 갱신 (1분마다)
async function updateBlockedIPCache(BlockedIP) {
  // 🛡️ 이미 갱신 중이면 중복 실행 방지
  if (isUpdatingCache) {
    return;
  }

  isUpdatingCache = true; // 락 설정

  try {
    const blockedIPs = await BlockedIP.find({
      isActive: true,
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: new Date() } }
      ]
    })
      .select('ip')
      .lean();

    blockedIPCache.clear();
    blockedIPs.forEach(doc => blockedIPCache.add(doc.ip));
    lastCacheUpdate = Date.now();
    isCacheReady = true; // 🛡️ 초기 로드 완료
  } catch (err) {
    console.error('❌ IP 캐시 갱신 실패:', err);
    // 🛡️ 에러 발생 시에도 계속 작동 (fail-open)
    isCacheReady = true;
  } finally {
    isUpdatingCache = false; // 락 해제
  }
}

// IP 차단 (블랙리스트에 추가)
async function blockIP(userDb, ip, reason, details = '', expiresIn = null) {
  try {
    const BlockedIP = require('../models/BlockedIP')(userDb);

    const blockData = {
      ip,
      reason,
      details,
      blockedAt: new Date(),
      isActive: true,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn) : null
    };

    // 이미 차단된 IP면 업데이트, 없으면 생성
    await BlockedIP.findOneAndUpdate(
      { ip },
      blockData,
      { upsert: true, new: true }
    );

    // 캐시에 즉시 추가
    blockedIPCache.add(ip);

    console.log(`🚫 IP 차단: ${ip} (사유: ${reason})`);
  } catch (err) {
    console.error('IP 차단 실패:', err);
  }
}

// 404 추적 및 자동 차단
function track404(req, ip, userDb) {
  // 🛡️ 메모리 고갈 방지: 최대 크기 도달 시 추적 스킵
  if (!notFoundTracker.has(ip) && notFoundTracker.size >= MAX_TRACKER_SIZE) {
    console.warn(`⚠️ 404 추적 제한 도달: ${ip} 추적 스킵`);
    return;
  }

  if (!notFoundTracker.has(ip)) {
    notFoundTracker.set(ip, {
      count: 1,
      lastAttempt: Date.now(),
      paths: [req.path]
    });
  } else {
    const data = notFoundTracker.get(ip);
    data.count++;
    data.lastAttempt = Date.now();

    // 🛡️ 경로 배열 크기 제한 (메모리 절약 - 50→10으로 축소)
    if (data.paths.length < MAX_PATH_ARRAY_SIZE) {
      data.paths.push(req.path);
    }

    // 5분 내에 10번 이상 404 발생 시 자동 차단
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    if (data.count >= 10 && data.lastAttempt > fiveMinutesAgo) {
      blockIP(
        userDb,
        ip,
        'repeated_404',
        `5분 내 ${data.count}회 404 에러 발생`,
        24 * 60 * 60 * 1000  // 24시간 임시 차단
      );
      console.warn(`⚠️ 반복된 404 감지: ${ip} (${data.count}회)`);
      notFoundTracker.delete(ip); // 🛡️ 차단 후 추적 중단
    }
  }
}

// 봇 차단 미들웨어
function botBlocker(userDb) {
  const BlockedIP = require('../models/BlockedIP')(userDb);

  // 🛡️ 초기 캐시 로드 (동기화)
  updateBlockedIPCache(BlockedIP).catch(err => {
    console.error('초기 IP 캐시 로드 실패:', err);
  });

  return async (req, res, next) => {
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    const path = req.path;

    // 🛡️ 로컬호스트는 차단하지 않음 (개발 환경)
    const isLocalhost = ip === '127.0.0.1' ||
                        ip === '::1' ||
                        ip === '::ffff:127.0.0.1' ||
                        ip === 'localhost';

    if (isLocalhost) {
      return next();
    }

    try {
      // 🛡️ 초기 캐시 로드 대기 (서버 재시작 직후 보호)
      if (!isCacheReady) {
        // 캐시 로드 중에는 DB로 직접 확인 (안전 우선)
        const blocked = await BlockedIP.findOne({
          ip,
          isActive: true,
          $or: [
            { expiresAt: null },
            { expiresAt: { $gt: new Date() } }
          ]
        }).lean();

        if (blocked) {
          console.warn(`🚫 차단된 IP 접근 시도 (캐시 로드 중): ${ip}`);
          return res.status(403).json({
            message: '접근이 차단되었습니다.',
            reason: 'blocked_ip'
          });
        }
      }

      // ⚡ 성능 최적화: 정적 파일은 User-Agent만 체크 후 통과
      const isStaticFile =
        path.startsWith('/css/') ||
        path.startsWith('/js/') ||
        path.startsWith('/images/') ||
        path.startsWith('/fonts/') ||
        path.endsWith('.css') ||
        path.endsWith('.js') ||
        path.endsWith('.png') ||
        path.endsWith('.jpg') ||
        path.endsWith('.jpeg') ||
        path.endsWith('.gif') ||
        path.endsWith('.svg') ||
        path.endsWith('.ico') ||
        path.endsWith('.woff') ||
        path.endsWith('.woff2') ||
        path.endsWith('.ttf');

      // 🛡️ 정적 파일도 악의적 User-Agent는 차단
      if (isStaticFile) {
        if (isMaliciousUserAgent(userAgent)) {
          await blockIP(
            userDb,
            ip,
            'malicious_user_agent',
            `User-Agent: ${userAgent} (정적 파일 요청)`,
            7 * 24 * 60 * 60 * 1000
          );
          console.warn(`🚫 정적 파일에서 악의적 User-Agent 감지: ${ip}`);
          return res.status(403).json({
            message: '접근이 거부되었습니다.',
            reason: 'malicious_user_agent'
          });
        }
        return next(); // 정상 정적 파일 요청은 통과
      }

      // ⚡ 캐시 갱신 (1분마다, 백그라운드)
      const now = Date.now();
      if (now - lastCacheUpdate > CACHE_TTL && !isUpdatingCache) {
        updateBlockedIPCache(BlockedIP); // 비동기 실행 (기다리지 않음, 락으로 중복 방지)
      }

      // 1. ⚡ 메모리 캐시로 블랙리스트 확인 (MongoDB 쿼리 없음!)
      if (blockedIPCache.has(ip)) {
        console.warn(`🚫 차단된 IP 접근 시도: ${ip}`);
        return res.status(403).json({
          message: '접근이 차단되었습니다.',
          reason: 'blocked_ip'
        });
      }

      // 2. 악의적인 User-Agent 확인
      if (isMaliciousUserAgent(userAgent)) {
        await blockIP(
          userDb,
          ip,
          'malicious_user_agent',
          `User-Agent: ${userAgent}`,
          7 * 24 * 60 * 60 * 1000  // 7일 차단
        );
        console.warn(`🚫 악의적인 User-Agent 감지: ${ip} - ${userAgent}`);
        return res.status(403).json({
          message: '접근이 거부되었습니다.',
          reason: 'malicious_user_agent'
        });
      }

      // 3. 의심스러운 경로 확인
      if (isSuspiciousPath(path)) {
        await blockIP(
          userDb,
          ip,
          'suspicious_path',
          `경로: ${path}`,
          3 * 24 * 60 * 60 * 1000  // 3일 차단
        );
        console.warn(`🚫 의심스러운 경로 접근: ${ip} - ${path}`);
        return res.status(403).json({
          message: '접근이 거부되었습니다.',
          reason: 'suspicious_path'
        });
      }

      // 4. 응답이 끝난 후 404 추적 (404가 너무 많으면 차단)
      res.on('finish', () => {
        if (res.statusCode === 404) {
          track404(req, ip, userDb);
        }
      });

      next();
    } catch (err) {
      console.error('Bot blocker 에러:', err);
      // 에러가 나도 서비스는 계속 진행
      next();
    }
  };
}

module.exports = botBlocker;
