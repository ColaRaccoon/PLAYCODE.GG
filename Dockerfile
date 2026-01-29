# ========================================
# 멀티 스테이지 빌드: 빌드 단계
# ========================================
FROM node:20-alpine AS builder

WORKDIR /app

# 패키지 파일 복사 (package.json + package-lock.json)
COPY package*.json ./

# 모든 의존성 설치 (빌드에 devDependencies 필요)
RUN npm ci

# 소스 코드 복사
COPY . .

# Tailwind CSS 빌드
RUN npm run build-css-prod

# ========================================
# 프로덕션 단계
# ========================================
FROM node:20-alpine

# 보안 및 안정성을 위한 non-root 유저 생성
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# package.json 복사 후 production 의존성만 설치
COPY package*.json ./
RUN npm ci --omit=dev

# 빌드 결과물 복사
COPY --from=builder --chown=nodejs:nodejs /app/public ./public
COPY --chown=nodejs:nodejs . .

# PM2를 글로벌로 설치 (프로세스 관리용)
RUN npm install -g pm2

# 로그 디렉토리 생성 및 권한 설정
RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app/logs

# non-root 유저로 전환
USER nodejs

# 애플리케이션 포트
EXPOSE 3000

# 헬스체크 (쿠버네티스에서도 활용 가능)
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); })"

# PM2로 애플리케이션 실행
CMD ["pm2-runtime", "start", "ecosystem.config.js"]
