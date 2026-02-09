require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/DB');
const authRoutes = require('./routes/AuthRoutes');
const naverAuthRoutes = require('./routes/NaverAuthRoutes');
const googleAuthRoutes = require('./routes/GoogleAuthRoutes');
const quizRoutes = require('./routes/QuizRoutes');
const gameRoutes = require('./routes/GameRoutes');
const adminRoutes = require('./routes/AdminRoutes');
const adminSetupRoutes = require('./routes/AdminSetupRoutes');
const commentRoutes = require('./routes/CommentRoutes');
const contactRoutes = require('./routes/ContactRoutes');
const s3Routes = require('./routes/S3Routes');
const portfolioRoutes = require('./routes/PortfolioRoutes');
const authenticateToken = require('./middlewares/AuthMiddleware');
const quizApiRoutesFactory = require('./routes/QuizApiRoutes');
const { register, metricsMiddleware, websocketConnectionsGauge } = require('./utils/metrics');
const { logger, httpLogger } = require('./utils/logger');


const app = express();
const http = require('http');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
const server = http.createServer(app);

// Socket.IO 서버 설정 (CORS 포함)
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? ['https://playcode.gg', 'https://www.playcode.gg']
      : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST'],
    credentials: true
  },
  // 연결 안정성을 위한 추가 설정
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

// 🔥 Redis Adapter 설정 (클러스터 모드용)
const pubClient = createClient({
  url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`
});
const subClient = pubClient.duplicate();

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
  io.adapter(createAdapter(pubClient, subClient));
  logger.info('Redis adapter connected');
}).catch((err) => {
  logger.error({ err }, 'Redis connection failed');
  logger.warn('Running without Redis adapter (single process mode)');
});

// WebSocket 연결 수 메트릭 추적
io.on('connection', (socket) => {
  websocketConnectionsGauge.inc();
  socket.on('disconnect', () => {
    websocketConnectionsGauge.dec();
  });
});

const PORT = process.env.PORT || 3000;

// Trust proxy 설정 (Nginx 등 리버스 프록시 뒤에서 실행될 때 필요)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1); // 첫 번째 프록시를 신뢰
}

// HTTPS 강제 리다이렉트 (프로덕션)
// ⚠️ EC2에 SSL 인증서가 없어서 임시 비활성화
// TODO: SSL 인증서 추가하면 다시 활성화
/*
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(301, `https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}
*/

// View engine 설정
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public'), {
  index: false // index.html 자동 제공 비활성화 (명시적 라우트 사용)
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Prometheus 메트릭 미들웨어 (Rate Limiter보다 먼저 적용하여 모든 요청 측정)
app.use(metricsMiddleware);

// 구조화된 HTTP 요청 로깅 (Loki 수집용)
app.use(httpLogger);

// Prometheus 메트릭 엔드포인트
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Rate Limiting 설정
// 1. 전역 제한: 모든 요청에 적용 (느슨하게)
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1분
  max: 100, // 1분당 최대 100개 요청
  message: '너무 많은 요청을 보냈습니다. 잠시 후 다시 시도해주세요.',
  standardHeaders: true, // RateLimit-* 헤더 반환
  legacyHeaders: false, // X-RateLimit-* 헤더 비활성화
});

// 2. API 제한: 일반 API 엔드포인트 (중간)
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1분
  max: 60, // 1분당 최대 60개 요청
  message: 'API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
  standardHeaders: true,
  legacyHeaders: false,
});

// 3. 인증 제한: 로그인/회원가입 (엄격하게)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 5, // 15분당 최대 5개 요청
  message: '로그인 시도가 너무 많습니다. 15분 후 다시 시도해주세요.',
  standardHeaders: true,
  legacyHeaders: false,
});

// 전역 limiter 적용
app.use(globalLimiter);

app.use(session({
  secret: process.env.JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || process.env.USER_DB_URI,
    dbName: 'userdb',
    collectionName: 'sessions',
    ttl: 30 * 60, // 30분 (초 단위)
    autoRemove: 'native' // MongoDB TTL 인덱스로 자동 삭제
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production', // 프로덕션에서만 true
    httpOnly: true,
    sameSite: 'lax', // OAuth 리다이렉트 시 쿠키 전송 허용
    maxAge: 30 * 60 * 1000 // 30분
  },
  proxy: process.env.NODE_ENV === 'production' // 프로덕션에서만 true
}));

// ✅ MongoDB 연결
connectDB().then(({ userDb, quizDb }) => {
  app.set('userDb', userDb);  // User DB를 전역에서 사용 가능하도록 설정
  app.set('quizDb', quizDb);  // Chat DB를 전역에서 사용 가능하도록 설정
  app.set('io', io); // app 전체에서 io 접근 가능하도록 저장

  // 🛡️ 봇 차단 미들웨어 적용 (Rate Limiter 다음, 다른 미들웨어보다 먼저)
  const botBlocker = require('./middlewares/BotBlocker');
  app.use(botBlocker(userDb));

  // 접속 로그 수집 미들웨어 (실제 페이지 조회만 카운트)
  const AccessLog = require('./models/AccessLog')(userDb);
  app.use((req, res, next) => {
    // ✅ quiz-edit API 요청은 현재 접속자 집계를 위해 로그에 기록
    const isQuizEditAPI =
      (req.method === 'PUT' || req.method === 'POST') &&
      (req.path.match(/^\/api\/quiz\/[^\/]+\/question/) ||
       req.path.match(/^\/api\/quiz\/[^\/]+\/questions$/));

    // quiz-edit API가 아니면 기존 로직 적용
    if (!isQuizEditAPI) {
      // ✅ 페이지뷰 = 실제 HTML 페이지를 조회한 경우만 카운트
      // GET 요청이 아니면 제외
      if (req.method !== 'GET') {
        return next();
      }

      // 정적 파일, API, 관리자 페이지 등은 제외
      if (
        req.path.startsWith('/css') ||
        req.path.startsWith('/js') ||
        req.path.startsWith('/images') ||
        req.path.startsWith('/socket.io') ||
        req.path.startsWith('/api/') ||
        req.path.startsWith('/auth/') ||
        req.path.startsWith('/game/') ||
        req.path.startsWith('/admin') ||
        req.path === '/favicon.ico'
      ) {
        return next();
      }
    }

    // ✅ 화이트리스트: 실제 페이지만 카운트 (또는 quiz-edit API)
    const isPageView =
      isQuizEditAPI ||                                       // quiz-edit API 요청
      req.path === '/' ||                                    // 메인 페이지
      req.path === '/my-page' ||                             // 마이페이지
      req.path === '/edit-profile' ||                        // 내 정보 수정
      req.path === '/quiz/my-list' ||                        // 나의 퀴즈 목록
      req.path === '/quiz/edit' ||                           // 퀴즈 편집
      req.path === '/quiz/init' ||                           // 퀴즈 생성
      req.path.match(/^\/quiz\/[a-f0-9]{24}$/) ||           // 게임 세션 (/quiz/:sessionId)
      req.path.endsWith('.html');                            // 기타 HTML 페이지

    if (!isPageView) {
      return next();
    }

    // 🔒 응답이 완료되었을 때 로그 저장 (중복 방지)
    res.on('finish', () => {
      // 이미 처리된 요청은 건너뛰기
      if (req._accessLogProcessed) {
        return;
      }
      req._accessLogProcessed = true;

      // 비동기로 로그 저장
      const ip = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '').split(',')[0].trim();

      AccessLog.create({
        ip,
        path: req.path,
        method: req.method,
        userAgent: req.headers['user-agent'],
        userId: req.user?.id || null
      }).catch(error => {
        logger.error({ err: error }, 'Access log error');
      });
    });

    next();
  });
  
  const { publicRouter, privateRouter } = quizApiRoutesFactory(quizDb);

  // authLimiter를 라우트에서 사용할 수 있도록 app에 저장
  app.set('authLimiter', authLimiter);
  app.set('apiLimiter', apiLimiter);

  // 라우트 설정
  app.use('/auth', authRoutes);
  app.use('/auth', naverAuthRoutes);
  app.use('/auth', googleAuthRoutes);
  app.use('/', authRoutes);
  app.use('/', quizRoutes);
  app.use('/api', apiLimiter, publicRouter); // API에 중간 제한
  app.use('/api', apiLimiter, commentRoutes); // 댓글 라우트 (GET은 인증 불필요, POST는 인증 필요) - privateRouter보다 먼저 등록
  app.use('/api', apiLimiter, authenticateToken, privateRouter);
  app.use('/api', contactRoutes); // 문의하기 (자체 Rate Limiter 사용)
  app.use('/api/s3', apiLimiter, authenticateToken, s3Routes); // S3 Presigned URL (인증 필요)
  app.use('/game', apiLimiter, gameRoutes); // 인증은 각 라우트에서 개별 처리 (게스트 지원)
  app.use('/admin-setup', adminSetupRoutes); // 관리자 권한 부여 (authenticateToken으로 보호)
  app.use('/admin', adminRoutes); // 관리자 페이지 (checkAdmin 미들웨어로 보호)
  app.use('/', portfolioRoutes); // 포트폴리오 페이지 (토큰 기반 접근 제어)

  app.get('/', async (req, res) => {
    const quizId = req.query.quiz;

    // 퀴즈 ID가 없으면 기본 HTML 제공
    if (!quizId) {
      return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }

    // 퀴즈 정보 조회하여 동적 메타 태그 생성
    try {
      const Quiz = require('./models/Quiz')(quizDb);
      const quiz = await Quiz.findById(quizId).select('title description titleImageBase64 completedGameCount');

      // 퀴즈를 찾지 못한 경우 기본 HTML 제공
      if (!quiz) {
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
      }

      // index.html 읽기
      const fs = require('fs').promises;
      const htmlPath = path.join(__dirname, 'public', 'index.html');
      let html = await fs.readFile(htmlPath, 'utf-8');

      // 동적 메타 태그 생성
      const quizUrl = `https://playcode.gg/?quiz=${quizId}`;
      const quizTitle = `${quiz.title} - PLAYCODE.GG`;
      const quizDescription = quiz.description || '이 퀴즈에 도전해보세요!';
      const quizImage = quiz.titleImageBase64 || 'https://playcode.gg/images/Logo.png';

      // 메타 태그 교체
      html = html.replace(
        /<meta property="og:title" content="[^"]*">/,
        `<meta property="og:title" content="${quizTitle}">`
      );
      html = html.replace(
        /<meta property="og:description" content="[^"]*">/,
        `<meta property="og:description" content="${quizDescription}">`
      );
      html = html.replace(
        /<meta property="og:image" content="[^"]*">/,
        `<meta property="og:image" content="${quizImage}">`
      );
      html = html.replace(
        /<meta property="og:url" content="[^"]*">/,
        `<meta property="og:url" content="${quizUrl}">`
      );

      // Twitter 카드 메타 태그도 교체
      html = html.replace(
        /<meta property="twitter:title" content="[^"]*">/,
        `<meta property="twitter:title" content="${quizTitle}">`
      );
      html = html.replace(
        /<meta property="twitter:description" content="[^"]*">/,
        `<meta property="twitter:description" content="${quizDescription}">`
      );
      html = html.replace(
        /<meta property="twitter:image" content="[^"]*">/,
        `<meta property="twitter:image" content="${quizImage}">`
      );
      html = html.replace(
        /<meta property="twitter:url" content="[^"]*">/,
        `<meta property="twitter:url" content="${quizUrl}">`
      );

      // 페이지 타이틀도 교체
      html = html.replace(
        /<title>[^<]*<\/title>/,
        `<title>${quizTitle}</title>`
      );

      // description 메타 태그 교체
      html = html.replace(
        /<meta name="description" content="[^"]*">/,
        `<meta name="description" content="${quizDescription}">`
      );

      res.send(html);

    } catch (error) {
      logger.error({ err: error, quizId }, '퀴즈 메타 태그 생성 실패');
      // 에러 발생 시 기본 HTML 제공
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
  });

  // 헬스체크 엔드포인트 (Docker, 로드밸런서 등에서 사용)
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // 소켓 로직 파일 연결 (Redis client 추가 전달)
  const gameSocketMonitor = require('./sockets/GameSocket')(io, app, pubClient);

  // ===== 에러 핸들러 (모든 라우트 정의 후 마지막에 배치) =====

  // 404 핸들러 - 정의되지 않은 모든 라우트 처리
  app.use((req, res, next) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  });

  // 500 핸들러 - 서버 에러 처리
  app.use((err, req, res, next) => {
    logger.error({ err, path: req.path, method: req.method }, 'Server error');

    if (process.env.NODE_ENV === 'production') {
      // 프로덕션: 에러 정보 숨김
      res.status(500).sendFile(path.join(__dirname, 'public', '500.html'));
    } else {
      // 개발 모드: 에러 메시지를 URL 파라미터로 전달
      const errorMsg = encodeURIComponent(err.message || 'Unknown error');
      res.status(500).redirect(`/500.html?error=${errorMsg}`);
    }
  });

  // 서버 시작
  server.listen(PORT, () => {
    logger.info({ port: PORT }, `Server is running on http://localhost:${PORT}`);
  });

}).catch(err => {
  logger.fatal({ err }, 'DB 연결 실패');
  process.exit(1);
});