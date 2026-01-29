# PLAYCODE.GG

> 실시간 멀티플레이어 퀴즈 플랫폼 - 누구나 쉽게 퀴즈를 만들고, 공유하고, 함께 즐길 수 있습니다

**Live Service:** [https://playcode.gg](https://playcode.gg)

---

## 목차
- [주요 기능](#주요-기능)
- [기술 스택](#기술-스택)
- [기술적 도전과 해결](#기술적-도전과-해결)
- [성능 최적화](#성능-최적화)
- [프로젝트 하이라이트](#프로젝트-하이라이트)

---

## 주요 기능

### 핵심 기능
- **실시간 멀티플레이어 퀴즈** - 최대 12명이 동시에 참여하고 경쟁
- **다양한 문제 유형** - 주관식, 객관식, 이미지, 유튜브 영상, 오디오 문제 지원
- **게스트 모드** - 회원가입 없이 바로 플레이 가능
- **실시간 채팅** - 게임 중 다른 플레이어와 소통
- **동적 스코어보드** - 순위와 점수를 실시간으로 확인
- **퍼센타일 랭킹** - 게임 종료 시 상위 몇 %인지 표시

### 퀴즈 제작
- **드래그 앤 드롭** 이미지 업로드
- **유튜브 API 연동** - 특정 구간 재생, 영상/오디오 모드
- **자동 저장** - 문제별 즉시 저장으로 작업 손실 방지
- **공개/비공개** 설정
- **문제 순서 랜덤화**

### 커뮤니티
- 댓글 및 추천 시스템
- 신고 기능 (관리자 검토)
- 관리자 대시보드 (통계, 신고 관리, 유저 관리)

---

## 기술 스택

### Backend
- **Node.js** + **Express.js** - RESTful API 및 웹 서버
- **MongoDB** (Mongoose) - 유저, 퀴즈, 세션 데이터 저장
- **Redis** - 실시간 동시성 제어 및 캐싱
  - 첫 번째 정답자 원자적 판정 (SET NX)
  - 접속 인원 카운터 관리
- **Socket.IO** - 실시간 양방향 통신

### Frontend
- **EJS** - 서버 사이드 렌더링
- **TailwindCSS** - 반응형 UI
- **Vanilla JavaScript** - 클라이언트 로직

### Infrastructure & DevOps
- **AWS S3** - 이미지 저장 (Presigned URL)
- **JWT** - httpOnly 쿠키 기반 인증
- **OAuth 2.0** - 소셜 로그인 (구글, 네이버)
- **YouTube IFrame API** - 동기화된 영상 재생

---

## 기술적 도전과 해결

실제 서비스를 운영하며 마주한 기술적 문제들과 해결 과정을 기록했습니다.

---

### 1. 확장성: 클라이언트 측 타이머 전략

**문제**
- 초기에는 모든 게임 세션의 제한시간 타이머를 서버에서 `setTimeout`으로 관리
- 세션 수가 증가할수록 타이머 관리 오버헤드와 메모리 사용량 증가
- 타이머 누수 위험 및 서버 부하 시 타이머 지연 발생 가능성

**해결**

하이브리드 접근 방식으로 전환:
```javascript
// 서버: 타이머 값만 전송
io.to(sessionId).emit('question-start', {
    timeLimit: 90,              // 클라이언트 카운트다운용
    questionStartAt: new Date(), // 재접속 시 계산용
});

// 클라이언트: 직접 타이머 관리
setTimeout(() => revealAnswer(), timeLimit * 1000);

// 재접속: 경과 시간 계산
const elapsed = Date.now() - questionStartAt.getTime();
const remaining = Math.max(0, timeLimit * 1000 - elapsed);
```

**결과**
- 타이머 관련 서버 부하 제거로 확장성 대폭 개선
- 동시 처리 가능한 세션 수 증가
- 재접속 시에도 정확한 남은 시간 복원

---

### 2. 성능: Base64 → AWS S3 이미지 저장 방식 전환

**문제**
- 초기에는 이미지를 Base64로 인코딩하여 MongoDB에 직접 저장
- 이미지가 포함된 퀴즈 목록 로딩 시 **매우 느린 응답 속도**
- MongoDB 문서 크기 증가로 인한 쿼리 성능 저하

**해결**

AWS S3 Presigned URL 방식으로 전환:
```javascript
// 이미지 업로드 시
const s3Key = `quiz-images/${quizId}/${timestamp}.${ext}`;
await s3.upload({ Bucket, Key: s3Key, Body: imageBuffer });

// 조회 시: Presigned URL 생성 (1시간 유효)
const imageUrl = s3.getSignedUrl('getObject', {
    Bucket, Key: s3Key, Expires: 3600
});
```

**결과**
- 퀴즈 목록 로딩 속도 대폭 개선
- MongoDB 문서 크기 대폭 감소 (이미지당 ~1MB → ~100 bytes)
- 이미지 로딩을 S3에 분산하여 서버 부담 감소

---

### 3. 동시성: Redis로 첫 번째 정답자 Race Condition 해결

**문제**
- 여러 플레이어가 동시에 정답 제출 시 첫 번째 정답자 판정에서 Race Condition 발생
- 두 명 이상이 동시에 2점(첫 정답 보너스)을 받는 버그

**해결**

Redis의 원자적 연산(`SET NX`) 활용:
```javascript
// Redis로 첫 번째 정답자 원자적 판정
const redisKey = `first:${sessionId}:${questionIndex}`;
const result = await redisClient.set(redisKey, userId, {
    NX: true,  // key가 없을 때만 설정 (원자적!)
    EX: 3600   // 1시간 후 자동 삭제
});

const isFirstCorrectUser = (result === 'OK');
const scoreIncrement = isFirstCorrectUser ? 2 : 1;
```

**결과**
- Race Condition 완전 해결
- 밀리초 단위 동시 제출에도 정확한 첫 번째 정답자 판정
- 클러스터 모드에서도 정상 작동

---

### 4. 성능: 쿼리 최적화 (Projection + N+1 해결 + 인덱스)

**문제**
- 퀴즈 목록 조회 시 응답이 느림
- 불필요한 questions 배열을 함께 조회 (각 퀴즈당 수십 개 문제 데이터)
- 각 퀴즈마다 제작자 정보를 개별 쿼리로 조회하는 N+1 문제
- 정렬 조건에 인덱스 누락

**해결**

1. **Projection으로 불필요한 필드 제외**
```javascript
// 목록에서는 questions 배열 불필요
const quizzes = await QuizCollection.find({ isComplete: true })
  .project({
    questions: 0,  // 제외
    reports: 0,
  });
```

2. **제작자 닉네임을 Quiz 스키마에 비정규화**
```javascript
// Quiz 생성 시 제작자 닉네임 저장
const quiz = new Quiz({
    title, description,
    creatorId: user._id,
    creatorNickname: user.nickname
});
```

3. **복합 인덱스 추가**
```javascript
quizSchema.index({ isComplete: 1, completedGameCount: -1, createdAt: -1 });
```

**결과**
- 퀴즈 목록 로딩 속도 대폭 개선
- API 응답 크기 대폭 감소 (questions 배열 제외)
- DB 쿼리 횟수 감소 (N+1 해결)

---

### 5. 실시간 동기화: 유튜브 동시 재생 문제

**문제**
- 모든 플레이어가 정확히 같은 시점에 유튜브 영상을 시청해야 공정한 게임 진행
- 네트워크 지연과 로딩 시간으로 인해 플레이어마다 재생 시점이 달랐음

**해결**

준비 완료 확인 + 동시 재생 방식:
```javascript
// 1. 모든 클라이언트가 유튜브 로딩 완료 후 서버에 알림
socket.emit('client-ready', { sessionId });

// 2. 서버: 모든 플레이어 준비 완료 시 동시 시작 신호
if (allPlayersReady) {
    io.to(sessionId).emit('question-start', {
        timeLimit: 90,
        questionStartAt: new Date()
    });
}

// 3. 클라이언트: 동시에 영상 재생 + 타이머 시작
youtubePlayer.playVideo();
startCountdown(timeLimit);
```

**결과**
- 모든 플레이어가 동시에 영상 시청 시작
- 2~3초의 로딩 시간 대신 "준비 중..." UI로 사용자 경험 개선
- 공정한 게임 진행 보장

---

### 6. 보안: JWT httpOnly 쿠키 + 해시 기반 정답 검증

**문제**
- 초기에는 JWT 토큰을 localStorage에 저장 → XSS 공격에 취약
- 정답을 평문으로 클라이언트에 전송 → 개발자 도구로 확인 가능

**해결**

1. **JWT를 httpOnly 쿠키로 전환**
```javascript
res.cookie('accessToken', token, {
    httpOnly: true,  // JavaScript 접근 불가
    secure: true,    // HTTPS만
    sameSite: 'strict'
});
```

2. **정답을 SHA-256 해시로 전송**
```javascript
// 서버: 정답 해시화
const hashedAnswers = quiz.answers.map(ans =>
    crypto.createHash('sha256')
        .update(ans.replace(/\s+/g, '').toLowerCase())
        .digest('hex')
);

// 클라이언트: 사용자 입력도 해시화하여 비교
const userAnswerHash = sha256(userInput);
if (hashedAnswers.includes(userAnswerHash)) {
    socket.emit('correct', { sessionId, answer: userInput });
}

// 서버: 재검증
const isCorrect = hashedAnswers.includes(hashAnswer(answer));
```

**결과**
- XSS 공격으로부터 인증 토큰 보호
- 클라이언트에서 정답 유출 불가능
- 서버에서 이중 검증으로 치팅 방지

---

### 7. 데이터 관리: MongoDB TTL + 퍼센타일 캐싱

**문제**
- 게임 세션이 종료되어도 DB에 계속 쌓여 저장 공간 낭비
- 게임 종료 시 "상위 몇 %"를 계산하기 위해 매번 전체 기록 조회

**해결**

1. **MongoDB TTL Index로 자동 정리**
```javascript
gameSessionSchema.index({
    startedAt: 1
}, {
    expireAfterSeconds: 10800  // 3시간 후 자동 삭제
});
```

2. **퍼센타일 임계값 캐싱**
```javascript
// 게임 종료 시 한 번만 계산하여 저장
const percentileThresholds = {
    top1: allScores[Math.floor(totalPlayers * 0.01)],
    top3: allScores[Math.floor(totalPlayers * 0.03)],
    top10: allScores[Math.floor(totalPlayers * 0.10)],
    top30: allScores[Math.floor(totalPlayers * 0.30)],
};

await QuizRecord.findByIdAndUpdate(quizRecordId, {
    $set: { percentileThresholds }
});

// 각 플레이어는 임계값과 비교만 (O(1))
const userPercentile = calculatePercentile(userScore, percentileThresholds);
```

**결과**
- 세션 데이터 자동 정리로 DB 용량 관리 불필요
- 퍼센타일 계산 최적화: 한 번만 계산 후 캐싱하여 재사용
- 게임 종료 응답 속도 개선

---

### 8. 비동기 처리: 재접속 시 데이터 일관성 문제

**문제**
- 게임 세션 생성자가 재접속 시 정답 인정이 안 되는 버그 발생
- 재접속 로직에서 퀴즈 데이터를 해시화하는 도중, 다른 비동기 로직이 평문 데이터로 덮어씀

**해결**

```javascript
// 잘못된 코드: 비동기 처리 순서 미보장
const hashedQuiz = hashQuizData(quiz);  // 해시화
session.cachedQuizData = hashedQuiz;
// ... 다른 로직이 평문으로 덮어씀

// 수정: 캐시 검증 후 재생성 방지
if (session.cachedQuizData &&
    session.cachedQuizData.questions[0].answers[0].length === 64) {
    // 이미 해시화된 데이터 → 그대로 사용
    quizDataToSend = session.cachedQuizData;
} else {
    // 평문 또는 없음 → 재생성
    quizDataToSend = hashQuizData(quiz);
    session.cachedQuizData = quizDataToSend;
    await session.save();
}
```

**결과**
- 재접속 시 데이터 일관성 보장
- 불필요한 재해시화 방지로 성능 개선

---

## 성능 최적화

### 주요 개선 사항

|          항목                | Before    | After        | 개선         |
|---------------------------|-----------|-------------|--------------|
| 퀴즈 목록 로딩             | 느림     | 빠름    | 대폭 개선 |
| API 응답 크기            | 수 MB        | 수백 KB       | 대폭 감소   |
| DB 쿼리 수 (N+1)         | 21개      | 1개          | 95% 감소 |
| 타이머 관련 서버 부하 | 높음   | 없음  | 제거    |
| 동시 처리 가능 세션      | 제한적 | 대폭 증가 | 확장성 개선 |

### 최적화 전략

1. **이미지 저장 방식 전환** - Base64 → AWS S3 Presigned URL
2. **쿼리 최적화** - N+1 문제 해결, 인덱스 추가, 비정규화
3. **부하 분산** - 타이머 계산을 클라이언트로 이동
4. **동시성 제어** - Redis 원자적 연산 활용
5. **캐싱 전략** - 퍼센타일 임계값 캐싱, 퀴즈 데이터 캐싱
6. **자동 정리** - MongoDB TTL Index로 불필요한 데이터 자동 삭제

---

## 프로젝트 하이라이트

### 확장 가능한 아키텍처
- 클라이언트 측 타이머로 서버 부담 최소화
- Redis 기반 동시성 제어로 분산 환경 대응
- MongoDB TTL Index로 자동 데이터 정리 (운영 부담 감소)

### 실시간 동기화 & 공정성
- Socket.IO 기반 실시간 양방향 통신
- 모든 플레이어가 정확히 같은 시점에 유튜브 영상 시청
- Redis SET NX로 밀리초 단위 정답 판정의 정확성 보장

### 보안 & 치팅 방지
- JWT httpOnly 쿠키로 XSS 공격 차단
- SHA-256 해시 기반 정답 검증 (클라이언트 유출 불가)
- 서버 측 이중 검증으로 치팅 완벽 차단

### 성능 중심 설계
- 이미지 저장 최적화 (Base64 → S3)
- 쿼리 최적화 (Projection + N+1 해결 + 인덱스)
- 서버 부하 최적화 (클라이언트 측 타이머)

### 사용자 경험 개선
- 게스트 모드로 즉시 플레이 가능 (회원가입 장벽 제거)
- 드래그 앤 드롭으로 직관적인 퀴즈 제작
- 문제별 자동 저장으로 작업 손실 방지
- 재접속 시 게임 상태 완벽 복원

---

## 라이선스

All rights reserved. This code is provided for portfolio demonstration purposes only.

모든 권리 보유. 이 코드는 포트폴리오 시연 목적으로만 제공됩니다.

---

**개발자: 이성현**
