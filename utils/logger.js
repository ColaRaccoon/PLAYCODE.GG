const pino = require('pino');

// 환경별 로그 레벨 설정
const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const logger = pino({
  level,
  // 프로덕션: JSON 포맷 (Loki/Promtail 파싱에 최적화)
  // 개발: 읽기 쉬운 포맷
  ...(process.env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }),
  // 기본 필드
  base: {
    service: 'playcode-app',
    env: process.env.NODE_ENV || 'development',
  },
  // 타임스탬프 포맷
  timestamp: pino.stdTimeFunctions.isoTime,
  // 민감 정보 필터링
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'token',
      'refreshToken',
      'accessToken',
    ],
    censor: '[REDACTED]',
  },
});

/**
 * Express HTTP 요청 로깅 미들웨어
 * pino-http 대신 직접 구현하여 의존성 최소화
 */
function httpLogger(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const duration = Number(process.hrtime.bigint() - start) / 1e6; // ms

    const logData = {
      req: {
        method: req.method,
        url: req.originalUrl,
        ip: (req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '').split(',')[0].trim(),
        userAgent: req.headers['user-agent'],
      },
      res: {
        statusCode: res.statusCode,
      },
      responseTime: duration,
    };

    if (res.statusCode >= 500) {
      logger.error(logData, `${req.method} ${req.originalUrl} ${res.statusCode}`);
    } else if (res.statusCode >= 400) {
      logger.warn(logData, `${req.method} ${req.originalUrl} ${res.statusCode}`);
    } else {
      logger.info(logData, `${req.method} ${req.originalUrl} ${res.statusCode}`);
    }
  });

  next();
}

module.exports = { logger, httpLogger };
