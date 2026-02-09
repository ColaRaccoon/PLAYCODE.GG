const client = require('prom-client');

// 기본 Node.js/프로세스 메트릭 수집 (CPU, 메모리, 이벤트 루프 등)
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// ============================================
// HTTP 요청 메트릭
// ============================================

// HTTP 요청 총 수 (method, route, status_code 라벨)
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'HTTP 요청 총 수',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// HTTP 요청 처리 시간 (히스토그램)
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP 요청 처리 시간 (초)',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// ============================================
// WebSocket 메트릭
// ============================================

// 현재 WebSocket 연결 수
const websocketConnectionsGauge = new client.Gauge({
  name: 'websocket_connections_active',
  help: '현재 활성 WebSocket 연결 수',
  registers: [register],
});

// WebSocket 이벤트 총 수
const websocketEventsTotal = new client.Counter({
  name: 'websocket_events_total',
  help: 'WebSocket 이벤트 처리 총 수',
  labelNames: ['event'],
  registers: [register],
});

// ============================================
// 게임 세션 메트릭
// ============================================

// 현재 활성 게임 세션 수
const activeGameSessionsGauge = new client.Gauge({
  name: 'game_sessions_active',
  help: '현재 활성 게임 세션 수',
  registers: [register],
});

// 게임 세션 생성 총 수
const gameSessionsCreatedTotal = new client.Counter({
  name: 'game_sessions_created_total',
  help: '게임 세션 생성 총 수',
  registers: [register],
});

// 현재 게임 참여 플레이어 수
const activePlayersGauge = new client.Gauge({
  name: 'game_players_active',
  help: '현재 게임에 참여 중인 플레이어 수',
  registers: [register],
});

// ============================================
// 인증 메트릭
// ============================================

// 로그인 시도 총 수
const authAttemptsTotal = new client.Counter({
  name: 'auth_attempts_total',
  help: '인증 시도 총 수',
  labelNames: ['method', 'result'], // method: local/naver/google, result: success/failure
  registers: [register],
});

// ============================================
// 데이터베이스 메트릭
// ============================================

// DB 쿼리 처리 시간
const dbQueryDuration = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: '데이터베이스 쿼리 처리 시간 (초)',
  labelNames: ['operation', 'collection'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

// ============================================
// Express 미들웨어
// ============================================

/**
 * HTTP 요청 메트릭을 수집하는 Express 미들웨어
 * /metrics, /health 등 내부 엔드포인트는 제외
 */
function metricsMiddleware(req, res, next) {
  // 메트릭/헬스체크 엔드포인트는 측정에서 제외
  if (req.path === '/metrics' || req.path === '/health') {
    return next();
  }

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    // 라우트 정규화: 동적 파라미터를 :id로 치환하여 라벨 카디널리티 제한
    const route = normalizeRoute(req.route?.path || req.path);
    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode,
    };

    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, duration);
  });

  next();
}

/**
 * 라우트 경로 정규화
 * MongoDB ObjectId, UUID 등 동적 세그먼트를 :id로 치환
 */
function normalizeRoute(path) {
  return path
    .replace(/\/[a-f0-9]{24}/g, '/:id')     // MongoDB ObjectId
    .replace(/\/[0-9a-f-]{36}/g, '/:uuid')   // UUID
    .replace(/\/\d+/g, '/:num');              // 숫자 ID
}

module.exports = {
  register,
  metricsMiddleware,
  // 개별 메트릭 내보내기 (다른 모듈에서 직접 사용 가능)
  httpRequestsTotal,
  httpRequestDuration,
  websocketConnectionsGauge,
  websocketEventsTotal,
  activeGameSessionsGauge,
  gameSessionsCreatedTotal,
  activePlayersGauge,
  authAttemptsTotal,
  dbQueryDuration,
};
