const jwt = require('jsonwebtoken');
const cookieParser = require('socket.io-cookie-parser');
const crypto = require('crypto'); // 정답 해시화용
const JWT_SECRET = process.env.JWT_SECRET;

const handleSocketError = (socket, error, eventName) => {
  console.error(`❌ Socket Error in ${eventName}:`, error);
  socket.emit('socket-error', {
    success: false,
    message: `An error occurred in ${eventName}.`,
    error: error.message,
  });
};

// 🛡️ 정답 해시화 함수 (SHA-256)
function hashAnswer(answer) {
  // 정답을 정규화: 공백 제거 + 소문자 변환
  const normalized = answer.replace(/\s+/g, '').toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

module.exports = (io, app, redisClient) => {
    /**
   * 스코어보드 업데이트 emit 함수
   * @param {Object} io - Socket.IO 인스턴스
   * @param {string} sessionId - 세션 ID
   * @param {Array} players - 플레이어 배열
   */
    function emitScoreboard(io, sessionId, players) {
    // 순위 정렬: 1차 점수 내림차순, 2차 맞춘 문제 수 내림차순, 3차 정답 시간 오름차순
    const sortedPlayers = [...players].sort((a, b) => {
      // 1차 정렬: 점수 내림차순
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      // 2차 정렬: 점수가 같으면 맞춘 문제 수 내림차순
      const countDiff = (b.correctAnswersCount || 0) - (a.correctAnswersCount || 0);
      if (countDiff !== 0) {
        return countDiff;
      }
      // 3차 정렬: 맞춘 문제 수도 같으면 정답을 빨리 맞춘 사람이 높은 순위
      // lastCorrectTime이 없는 경우(정답을 하나도 못 맞춘 경우) 가장 낮은 순위로
      if (!a.lastCorrectTime && !b.lastCorrectTime) return 0;
      if (!a.lastCorrectTime) return 1; // a가 정답 없음 -> b가 더 높은 순위
      if (!b.lastCorrectTime) return -1; // b가 정답 없음 -> a가 더 높은 순위
      return a.lastCorrectTime - b.lastCorrectTime; // 빠른 시간(작은 값)이 더 높은 순위
    });

    io.to(sessionId).emit('scoreboard', {
      success: true,
      data: {
        players: sortedPlayers.map(p => ({
          nickname: p.nickname,
          score: p.score,
          correctAnswersCount: p.correctAnswersCount || 0,
          connected: p.connected,
          profileImage: p.profileImage
        }))
      }
    });
  }

  /**
   * ⚡ Redis에서 접속 인원 수 가져오기 (헬퍼 함수)
   * @param {string} sessionId - 세션 ID
   * @param {Object} session - 세션 객체 (fallback용)
   * @returns {Promise<number>} 접속 인원 수
   */
  async function getConnectedCount(sessionId, session) {
    const actualCount = session.players.filter(p => p.connected).length;

    if (redisClient && redisClient.isOpen) {
      try {
        const cachedCount = await redisClient.get(`session:${sessionId}:connected`);
        if (cachedCount !== null) {
          const redisCount = parseInt(cachedCount, 10);

          // ⚠️ Redis 값이 음수거나 실제 값과 크게 다르면 동기화
          if (redisCount < 0 || Math.abs(redisCount - actualCount) > 0) {
            await redisClient.set(`session:${sessionId}:connected`, actualCount);
            return actualCount;
          }

          return redisCount;
      }
      } catch (redisErr) {
        console.error('Redis 카운터 조회 실패:', redisErr);
      }
    }

    // Redis 실패 시 또는 값이 없을 때 fallback
    return actualCount;
  }

  const quizDb = app.get('quizDb');
  const userDb = app.get('userDb');
  const GameSession = require('../models/GameSession')(quizDb);
  const Quiz = require('../models/Quiz')(quizDb);
  const QuizRecord = require('../models/QuizRecord')(quizDb);
  const User = require('../models/User')(userDb);
  const Recommendation = require('../models/Recommendation')(quizDb);
  const sessionUserCache = new Map();
  const sessionUserCacheTouchedAt = new Map();
  const sessionRevealCache = new Map();
  const disconnectTimers = new Map(); // 사용자별 disconnect 타이머 저장
  const { safeFindSessionById, safeSaveSession } = require('../utils/sessionHelpers');
  const { ObjectId } = require('mongoose').Types;

  function touchSessionCache(sessionId) {
    sessionUserCacheTouchedAt.set(sessionId, Date.now());
  }

  function clearSessionRuntimeCaches(sessionId) {
    sessionUserCache.delete(sessionId);
    sessionUserCacheTouchedAt.delete(sessionId);
    sessionRevealCache.delete(sessionId);
  }

  function buildRevealCacheFromQuiz(quiz) {
    if (!quiz) return null;
    const quizObj = quiz.toObject ? quiz.toObject() : quiz;
    return {
      creatorNickname: quizObj.creatorNickname || 'Unknown',
      questions: (quizObj.questions || []).map((q) => ({
        answers: q.answers || [],
        answerImage: q.answerImageBase64 || null
      }))
    };
  }

  async function getRevealData(sessionId, quizId, questionIndex) {
    let cache = sessionRevealCache.get(sessionId);

    if (!cache) {
      const quiz = await Quiz.findById(quizId)
        .select('creatorNickname questions.answers questions.answerImageBase64')
        .lean();
      if (!quiz) return null;
      cache = buildRevealCacheFromQuiz(quiz);
      sessionRevealCache.set(sessionId, cache);
    }

    const question = cache.questions?.[questionIndex];
    if (!question) return null;

    return {
      creatorNickname: cache.creatorNickname,
      answers: question.answers,
      answerImage: question.answerImage
    };
  }

  // 🛡️ 30분마다 오래된 세션 캐시 정리 (메모리 누수 방지)
  setInterval(() => {
    const now = Date.now();
    const SESSION_CACHE_TTL_MS = 3 * 60 * 60 * 1000;

    for (const [sessionId, touchedAt] of sessionUserCacheTouchedAt.entries()) {
      // 세션이 DB에 없거나 3시간 TTL로 만료되었다면 캐시에서 삭제
      if (now - touchedAt > SESSION_CACHE_TTL_MS) {
        clearSessionRuntimeCaches(sessionId);
        }
        // DB 조회 실패 시 무시
    }

  }, 30 * 60 * 1000); // 30분마다 실행

  io.use(cookieParser());

  // 선택적 인증 미들웨어 (게스트 접근 허용)
  io.use(async (socket, next) => {
    try {
      const token = socket.request.cookies.accessToken;

      if (!token) {
        // 게스트: 토큰 없으면 handshake query에서 guestId 확인
        const guestId = socket.handshake.query.guestId;
        const guestNickname = socket.handshake.query.guestNickname;

        if (guestId && guestNickname) {
          socket.userId = guestId;
          socket.guestNickname = guestNickname;
          socket.isGuest = true;
          return next();
        }

        console.warn('Socket.IO: No authentication provided (neither token nor guestId).');
        return next(new Error('Authentication error: No credentials provided.'));
      }

      // 로그인 사용자: 토큰 검증
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.id;
      socket.isGuest = false;
      next();
    } catch (err) {
      console.error('Socket.IO: JWT verification failed:', err.message);
      return next(new Error('Authentication error: Invalid token.'));
    }
  });

  io.on('connection', (socket) => {

    socket.on('joinSession', async ({ sessionId }) => {
      try {
        const quizDb = app.get('quizDb');
        const userDb = app.get('userDb');
        const GameSession = require('../models/GameSession')(quizDb);
        const User = require('../models/User')(userDb);

        const userId = socket.userId;

        if (!ObjectId.isValid(sessionId)) return;

        // ⚡ 재접속 시 disconnect 타이머 취소
        const timerKey = `${sessionId}:${userId}`;
        if (disconnectTimers.has(timerKey)) {
          clearTimeout(disconnectTimers.get(timerKey));
          disconnectTimers.delete(timerKey);
        }

        let session = await safeFindSessionById(GameSession, sessionId);
        if (!session) return;
        touchSessionCache(sessionId);

        // 최대 인원 체크 (12명)
        const MAX_PLAYERS = 12;
        const existingPlayer = session.players.find(p => p.userId.toString() === userId.toString());
        const connectedPlayers = session.players.filter(p => p.connected);

        // 기존 플레이어가 아니고, 이미 12명이 접속 중이면 거부
        if (!existingPlayer && connectedPlayers.length >= MAX_PLAYERS) {
          socket.emit('join-error', {
            success: false,
            message: '게임 세션에 정원이 다 찼습니다!'
          });
          return;
        }

        // ⚡ 게스트 또는 로그인 사용자 구분
        let userInfo;

        if (socket.isGuest) {
          // 게스트: handshake에서 닉네임 가져오기
          userInfo = {
            nickname: socket.guestNickname,
            profileImage: null
          };

          // 게스트도 캐시에 저장 (일반 채팅에서 사용)
          if (!sessionUserCache.has(sessionId)) {
            sessionUserCache.set(sessionId, new Map());
          }
          sessionUserCache.get(sessionId).set(socket.userId, userInfo);
        } else {
          // 로그인 사용자: 캐시 먼저 확인, 없으면 DB 조회
          userInfo = sessionUserCache.get(sessionId)?.get(socket.userId);

          if (!userInfo) {
            const user = await User.findById(userId).select('nickname profileImage');
            userInfo = {
              nickname: user?.nickname || null,
              profileImage: user?.profileImage || null
            };

            if (!sessionUserCache.has(sessionId)) {
              sessionUserCache.set(sessionId, new Map());
            }
            sessionUserCache.get(sessionId).set(socket.userId, userInfo);
          }
        }


        let player = session.players.find(p => {
          const playerUserId = p.userId ? p.userId.toString() : p.userId;
          return playerUserId === userId.toString();
        });

        let updatedSession = session;

        if (!player) {
          // ✅ 신규 플레이어: 원자적 업데이트로 추가
          // userId 타입 정규화 (게스트는 String, 로그인 사용자는 ObjectId)
          const normalizedUserId = socket.isGuest ? userId : (ObjectId.isValid(userId) ? new ObjectId(userId) : userId);

          const updateOps = {
            $push: {
              players: {
                userId: normalizedUserId,
                nickname: userInfo.nickname,
                profileImage: userInfo.profileImage,
                score: 0,
                correctAnswersCount: 0,
                answered: {},
                connected: true,
                lastSeen: new Date(),
                socketId: socket.id,
              }
            }
          };

          // host가 없으면 이 사용자를 host로 설정
          if (!session.host || session.host.toString() === '__NONE__') {
            updateOps.$set = { host: normalizedUserId };
          }

          updatedSession = await GameSession.findByIdAndUpdate(
            sessionId,
            updateOps,
            { new: true }
          );

          if (!updatedSession) {
            console.error('❌ 세션 업데이트 실패 - joinSession (신규 플레이어)');
            return;
          }

          // ⚡ Redis 접속 인원 카운터 증가
          if (redisClient && redisClient.isOpen) {
            try {
              await redisClient.incr(`session:${sessionId}:connected`);
            } catch (redisErr) {
              console.error('Redis 카운터 증가 실패:', redisErr);
            }
          }
        } else {
          // ✅ 재접속: 원자적 업데이트로 상태 갱신
          const wasDisconnected = !player.connected;

          // 기존 플레이어의 userId를 그대로 사용 (타입 일치 보장)
          const playerUserId = player.userId;

          const updateOps = {
            $set: {
              'players.$.connected': true,
              'players.$.socketId': socket.id,
              'players.$.lastSeen': new Date(),
              'players.$.nickname': userInfo.nickname,
              'players.$.profileImage': userInfo.profileImage
            }
          };

          updatedSession = await GameSession.findOneAndUpdate(
            { _id: sessionId, 'players.userId': playerUserId },
            updateOps,
            { new: true }
          );

          if (!updatedSession) {
            console.error('❌ 세션 업데이트 실패 - joinSession (재접속)', {
              sessionId,
              playerUserId,
              userIdType: typeof playerUserId
            });
            return;
          }

          // ⚡ Redis 접속 인원 카운터 증가 (재접속인 경우만)
          if (wasDisconnected && redisClient && redisClient.isOpen) {
            try {
              await redisClient.incr(`session:${sessionId}:connected`);
            } catch (redisErr) {
              console.error('Redis 카운터 증가 실패:', redisErr);
            }
          }
        }

        // 업데이트된 세션으로 교체
        session = updatedSession;

        const hostUser = session.players.find(p => {
          if (!session.host) return false;
          return p.userId.toString() === session.host.toString();
        });

        socket.join(sessionId);
        socket.sessionId = sessionId;
        socket.userId = userId;
        socket.firstCorrectUser = null;

        // ⚡ Redis에서 접속 인원 가져오기
        const connectedCount = await getConnectedCount(sessionId, session);

        // ✅ 캐시된 퀴즈 정보 사용 (DB 조회 최소화)
        let quizData = session.cachedQuizData;
        let quiz = null;
        let hasRecommended = false;

        // cachedQuizData가 없으면 DB 조회 (fallback)
        if (!quizData) {
          quiz = await Quiz.findById(session.quizId).select('title description titleImageBase64 creatorId creatorNickname completedGameCount questions recommendationCount');
          quizData = {
            title: quiz?.title || '제목 없음',
            description: quiz?.description || '',
            titleImageBase64: quiz?.titleImageBase64 || null,
            creatorId: quiz?.creatorId,
            creatorNickname: quiz?.creatorNickname || '알 수 없음',
            completedGameCount: quiz?.completedGameCount || 0,
            questionCount: quiz?.questions?.length || 0,
            recommendationCount: quiz?.recommendationCount || 0
          };
        }

        // 추천 여부 확인 (로그인한 경우만, Quiz 문서가 필요함)
        if (!socket.isGuest) {
          if (ObjectId.isValid(userId)) {
            hasRecommended = !!(await Recommendation.exists({
              userId: new ObjectId(userId),
              quizId: session.quizId
            }));
          }
        }

        const joinSuccessData = {
          success: true,
          data: {
            sessionId: sessionId,
            host: session.host?.toString() || '__NONE__',
            inviteCode: session.inviteCode || null, // ⚡ GameSession에서 가져오기
            quiz: {
              _id: session.quizId,
              title: quizData.title,
              description: quizData.description,
              titleImageBase64: quizData.titleImageBase64,
              completedGameCount: quizData.completedGameCount,
              questions: [], // ⚡ 빈 배열 (문제 수만 필요하므로)
              recommendationCount: quizData.recommendationCount,
              hasRecommended: hasRecommended,
              creatorNickname: quizData.creatorNickname
            },
            questionCount: quizData.questionCount,
            players: session.players.map(p => ({
              nickname: p.nickname,
              userId: p.userId.toString(),
              connected: p.connected,
              profileImage: p.profileImage,
              score: p.score,
              correctAnswersCount: p.correctAnswersCount || 0
            })),
            isStarted: session.isStarted || false,
            skipVotes: session.skipVotes.length,
            totalPlayers: connectedCount
          }
        };

        // ✅ 한 번에 모든 초기 데이터 전송 (HTTP 요청 불필요)
        socket.emit('join-success', joinSuccessData);

        // 점수판 전송 (메모리의 session 상태 사용 - DB 저장 완료 후이므로 최신 데이터)
        if (session.isStarted && session.isActive) {
          emitScoreboard(io, sessionId, session.players);

        // 스킵투표 인원수 공개
        io.to(sessionId).emit('voteSkipUpdate', {
          success: true,
          data: {
            votes: session.skipVotes.length,
            total: connectedCount
          }
        });

        // 대기 상태 알림
        } else {
          io.to(sessionId).emit('waiting-room', {
          success: true,
          type: 'waiting-room',
          data: {
            host: session.host?.toString() || '__NONE__',
            players: session.players.map(p => ({
              nickname: p.nickname,
              userId: p.userId.toString(),
              connected: p.connected,
              profileImage: p.profileImage
            })),
            isStarted: session.isStarted || false
          }
        });
        }


        socket.emit('host-updated', {
          success: true,
          data: {
          host: hostUser?.userId?.toString() || '__NONE__'
          }
        });

        // 🔄 재접속 시 게임 진행 중이면 퀴즈 데이터 재전송
        if (session.isStarted && session.isActive) {
          let quizDataToSend = session.cachedQuizData;

          // ✅ cachedQuizData 검증: 없거나 answers가 비어있거나 평문이면 재생성
          const needsRegeneration = !quizDataToSend ||
            !quizDataToSend.questions ||
            quizDataToSend.questions.length === 0 ||
            !quizDataToSend.questions[0]?.answers ||
            quizDataToSend.questions[0].answers.length === 0 ||
            // ✅ 평문 체크: 해시는 64자여야 함 (SHA256)
            (typeof quizDataToSend.questions[0].answers[0] === 'string' &&
             quizDataToSend.questions[0].answers[0].length !== 64);

          if (needsRegeneration) {
            const quizDb = app.get('quizDb');
            const Quiz = require('../models/Quiz')(quizDb);
            const quiz = await Quiz.findById(session.quizId);

            if (quiz) {
              const quizObj = quiz.toObject();
              sessionRevealCache.set(sessionId, buildRevealCacheFromQuiz(quizObj));

              quizDataToSend = {
                ...quizObj,
                questions: quizObj.questions.map(q => {
                  // ✅ Mongoose document를 plain object로 변환
                  const questionObj = q.toObject ? q.toObject() : q;

                  return {
                    ...questionObj,
                    answers: questionObj.answers ? questionObj.answers.map(a => hashAnswer(a)) : []
                  };
                })
              };

              // 캐시 복원
              session.cachedQuizData = quizDataToSend;
              session.markModified('cachedQuizData');
              await safeSaveSession(session);
            } else {
              console.error('❌ 퀴즈를 찾을 수 없음:', session.quizId);
              return;
            }
          }

          // 재접속한 플레이어의 answered 정보 조회
          const reconnectPlayer = session.players.find(p => p.userId.toString() === userId.toString());
          const playerAnswered = reconnectPlayer?.answered || {};

          socket.emit('game-started', {
            success: true,
            data: {
              quiz: quizDataToSend, // 해시화된 퀴즈
              host: session.host?.toString() || '__NONE__',
              questionOrder: session.questionOrder,
              currentQuestionIndex: session.questionOrder[session.currentQuestionIndex],
              isReconnect: true, // 재접속 플래그
              currentIndex: session.currentQuestionIndex, // questionOrder 배열의 인덱스
              playerAnswered: playerAnswered, // 플레이어의 answered 상태
              revealedAt: session.revealedAt // ✅ 정답 공개 시간 전송
            }
          });

          // 타이머 시작 정보도 전송 (클라이언트가 타이머 복원할 수 있도록)
          if (session.questionStartAt) {
            // 현재 문제의 timeLimit 가져오기 (재접속 시 경과시간 계산용)
            const actualQuestionIndex = session.questionOrder[session.currentQuestionIndex];
            const currentQuestion = quizDataToSend?.questions?.[actualQuestionIndex];
            const timeLimit = currentQuestion?.timeLimit || 90;

            socket.emit('question-start', {
              success: true,
              data: {
                questionStartAt: session.questionStartAt,
                timeLimit: timeLimit,
                isReconnect: true // 재접속 플래그 추가
              }
            });
          }
        }
      } catch (error) {
        handleSocketError(socket, error, 'joinSession');
      }
    });

    socket.on('disconnect', async () => {
      try {
        const { sessionId, userId } = socket;
        if (!sessionId || !userId) return;

        const quizDb = app.get('quizDb');
        const GameSession = require('../models/GameSession')(quizDb);

        // ⚡ 타이머 키를 sessionId:userId로 관리 (세션별로 독립적)
        const timerKey = `${sessionId}:${userId}`;

        // 기존 타이머가 있으면 취소 (빠른 재접속 시 중복 방지)
        if (disconnectTimers.has(timerKey)) {
          clearTimeout(disconnectTimers.get(timerKey));
          disconnectTimers.delete(timerKey);
        }

        // 3초 후에도 같은 사용자가 다시 접속해 있지 않다면 제거
        const timer = setTimeout(async () => {
          try {
            let socketsInRoom;
            try {
              socketsInRoom = await io.in(sessionId).fetchSockets();
            } catch (err) {
              console.error('❌ disconnect - fetchSockets 실패:', err.message)
            }

            const stillConnected = socketsInRoom.some(s => s.userId === userId);

            if (stillConnected) {
              return;
            }

            let session = await safeFindSessionById(GameSession, sessionId);
            if (!session) {
              return;
            }

            // 해당 유저 처리: 게임 시작 전이면 배열에서 제거, 시작 후면 connected: false로 마킹
            const player = session.players.find(p => p.userId.toString() === userId.toString());
            if (player && player.connected) {
              if (!session.isStarted) {
                // 게임 시작 전: 완전히 제거
                session.players = session.players.filter(p => p.userId.toString() !== userId.toString());
              } else {
                // 게임 시작 후: 재접속 가능하도록 connected만 false로 마킹
                player.connected = false;
                player.lastSeen = new Date();
                player.socketId = null;
              }
              session.markModified('players');

              // ⚡ Redis 접속 인원 카운터 감소 (0 이하로 내려가지 않도록)
              if (redisClient && redisClient.isOpen) {
                try {
                  const currentCount = await redisClient.get(`session:${sessionId}:connected`);
                  const currentCountInt = currentCount ? parseInt(currentCount, 10) : 0;

                  if (currentCountInt > 0) {
                    await redisClient.decr(`session:${sessionId}:connected`);
                  }
                } catch (redisErr) {
                  console.error('Redis 카운터 감소 실패:', redisErr);
                }
              }
            }

            // host였으면 새로 지정
            if (session.host?.toString() === userId.toString()) {
              const nextHost = session.players.find(p => p.connected);
              session.host = nextHost ? new ObjectId(nextHost.userId) : null;
              session.markModified('host');
            }

            const success2 = await safeSaveSession(session);
            if (!success2) {
              console.error('❌ 세션 저장 중 에러 발생 - disconnect2');
              return;
            }

            // 최신 세션 다시 조회 (DB에 저장된 상태)
            session = await safeFindSessionById(GameSession, sessionId);
            if (!session) return;

            // ⚡ Redis에서 접속 인원 가져오기
            const connectedCount = await getConnectedCount(sessionId, session);

            // 🛡️ 모든 플레이어가 나간 경우 즉시 메모리 정리
            if (connectedCount === 0) {
              clearSessionRuntimeCaches(sessionId);
              return;
            }

            // 분기 처리
            if (session.isStarted) {
              // 게임 중: 점수판 갱신
              emitScoreboard(io, sessionId, session.players);

              io.to(sessionId).emit('host-updated', {
                success: true,
                data: {
                  host: session.host?.toString() || '__NONE__'
                }
              });

              io.to(sessionId).emit('voteSkipUpdate', {
                success: true,
                data: {
                  votes: session.skipVotes.length,
                  total: connectedCount
                }
              });

              // 나간 유저의 ready 상태 제거
              const removedKeys = session.readyPlayers.filter(
                key => key.includes(`_${userId}`)
              );

              if (removedKeys.length > 0) {
                // 원자적 업데이트로 해당 유저의 ready 상태 제거
                await GameSession.findByIdAndUpdate(
                  sessionId,
                  { $pull: { readyPlayers: { $in: removedKeys } } },
                  { new: true }
                );
              }

            } else {
              // 대기 상태: 대기룸 갱신
              io.to(sessionId).emit('waiting-room', {
                success: true,
                type: 'waiting-room',
                data: {
                  host: session.host?.toString() || '__NONE__',
                  players: session.players.map(p => ({
                    nickname: p.nickname,
                    userId: p.userId.toString(),
                    connected: p.connected,
                    profileImage: p.profileImage // 추가!
                  })),
                  isStarted: session.isStarted || false
                }
              });

              // 대기실에도 스코어보드가 표시되므로 업데이트 필요
              emitScoreboard(io, sessionId, session.players);
            }
          } catch (error) {
            handleSocketError(socket, error, 'disconnect:setTimeout');
          } finally {
            // 타이머 정리
            disconnectTimers.delete(timerKey);
          }
        }, 3000); // 3초 후에도 접속 안 되어 있으면 제거

        // 타이머를 Map에 저장 (세션별로 독립적)
        disconnectTimers.set(timerKey, timer);

        // 모든 소켓 이벤트 리스너 제거 (메모리 누수 방지)
        socket.removeAllListeners('joinSession');
        socket.removeAllListeners('startGame');
        socket.removeAllListeners('client-ready');
        socket.removeAllListeners('chatMessage');
        socket.removeAllListeners('correct');
        socket.removeAllListeners('choiceQuestionCorrect');
        socket.removeAllListeners('choiceQuestionIncorrect');
        socket.removeAllListeners('voteSkip');
        socket.removeAllListeners('forceSkip');
        socket.removeAllListeners('revealAnswer');
        socket.removeAllListeners('nextQuestion');
      } catch (error) {
        handleSocketError(socket, error, 'disconnect');
      }
    });

    socket.on('startGame', async ({ sessionId }) => {
      try {
        if (!ObjectId.isValid(sessionId)) return;
        const session = await safeFindSessionById(GameSession, sessionId);
        if (!session || session.isStarted) return;

        if (session.host?.toString() !== socket.userId) return; // 방장만 시작 가능

        const quiz = await Quiz.findById(session.quizId);
        if (!quiz) return;

        // ✅ 문제 순서 생성 로직
        const questionCount = quiz.questions.length;
        let questionOrder = Array.from(Array(questionCount).keys()); // [0, 1, 2, ...]

        if (quiz.isRandomOrder) {
          // Fisher-Yates (aka Knuth) Shuffle
          let currentIndex = questionOrder.length, randomIndex;
          while (currentIndex !== 0) {
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex--;
            [questionOrder[currentIndex], questionOrder[randomIndex]] = [
              questionOrder[randomIndex], questionOrder[currentIndex]];
          }
        }

        session.isStarted = true;
        session.isActive = true;
        session.questionOrder = questionOrder; // 세션에 문제 순서 저장
        session.currentQuestionIndex = 0; // currentQuestionIndex는 questionOrder 배열의 위치(0부터 시작)
        session.readyPlayers = []; // 준비 상태 초기화

        // 🛡️ 정답 해시화: 캐시 + 클라이언트 전송용
        const quizData = quiz.toObject();
        sessionRevealCache.set(sessionId, buildRevealCacheFromQuiz(quizData));
        const hashedQuiz = {
          ...quizData,
          questions: quizData.questions.map(q => {
            // 객관식 문제인 경우
            if (q.incorrectAnswers && q.incorrectAnswers.length > 0) {
              // 선택지 생성: 정답 + 오답 섞기 (원본 텍스트)
              const allChoices = [...q.answers, ...q.incorrectAnswers];

              // Fisher-Yates 셔플 (클라이언트에서 같은 순서 보장)
              for (let i = allChoices.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [allChoices[i], allChoices[j]] = [allChoices[j], allChoices[i]];
              }

              return {
                ...q,
                choices: allChoices, // 원본 선택지 (화면 표시용)
                answers: q.answers.map(a => hashAnswer(a)), // 해시화된 정답 (검증용)
                incorrectAnswers: undefined // 불필요한 데이터 제거
              };
            }

            // 주관식 문제인 경우
            return {
              ...q,
              answers: q.answers ? q.answers.map(a => hashAnswer(a)) : [] // 해시화된 정답만
            };
          })
        };

        // 🚀 Quiz 데이터 캐싱 (해시된 데이터 저장 - 정답 검증용)
        session.cachedQuizData = hashedQuiz;
        session.markModified('cachedQuizData');

        // ⚡ Redis 접속 인원 카운터 초기화
        const connectedCount = session.players.filter(p => p.connected).length;
        if (redisClient && redisClient.isOpen) {
          try {
            await redisClient.set(`session:${sessionId}:connected`, connectedCount);
          } catch (redisErr) {
            console.error('Redis 카운터 초기화 실패:', redisErr);
          }
        }

        const success = await safeSaveSession(session);
        if (!success) {
            console.error('❌ 세션 저장 중 에러 발생 - startGame');
            return;
        }

        // 게스트가 아닌 경우만 플레이 기록 저장 (게스트는 User DB에 없음)
        if (!socket.isGuest) {
          await addPlayedQuizzes(quiz._id, socket.userId, app);
        }

        // 문제 데이터만 전송 (타이머는 아직 시작하지 않음)
        io.to(sessionId).emit('game-started', {
          success: true,
          data: {
            quiz: hashedQuiz, // 해시화된 퀴즈 전송
            host: session.host?.toString() || '__NONE__',
            questionOrder: session.questionOrder,
            currentQuestionIndex: session.questionOrder[0],
            players: session.players.map(p => ({
              nickname: p.nickname,
              score: p.score,
              correctAnswersCount: p.correctAnswersCount || 0,
              connected: p.connected,
              profileImage: p.profileImage
            }))
          }
        });

        // connectedCount는 이미 659줄에서 선언됨

        io.to(sessionId).emit('voteSkipUpdate', {
          success: true,
          data: {
            votes: session.skipVotes.length,
            total: connectedCount
          }
        });
      } catch (error) {
        handleSocketError(socket, error, 'startGame');
      }
    });

    // 클라이언트 준비 완료 이벤트
    socket.on('client-ready', async ({ sessionId }) => {
      try {
        if (!ObjectId.isValid(sessionId)) return;

        const userId = socket.userId;

        // 먼저 현재 세션 상태 확인
        let session = await safeFindSessionById(GameSession, sessionId);
        if (!session || !session.isActive) return;

        const currentQuestionIndex = session.currentQuestionIndex;
        const readyKey = `${currentQuestionIndex}_${userId}`;

        // 원자적 업데이트: $addToSet으로 중복 없이 추가
        const updateResult = await GameSession.findByIdAndUpdate(
          sessionId,
          { $addToSet: { readyPlayers: readyKey } },
          { new: true } // 업데이트된 문서 반환
        );

        if (!updateResult) {
          console.error('❌ 세션 업데이트 실패 - client-ready');
          return;
        }

        session = updateResult;

        // 현재 문제 인덱스에 대한 준비 완료 카운트
        const readyForThisQuestion = session.readyPlayers.filter(
          key => key.startsWith(`${currentQuestionIndex}_`)
        );

        const connectedPlayers = session.players.filter(p => p.connected);
        const readyCount = readyForThisQuestion.length;
        const totalCount = connectedPlayers.length;

        // 모든 플레이어가 준비 완료했는지 확인
        const allReady = readyCount >= totalCount;

        if (allReady) {
          // ✅ 문제 시작 시간 설정 (이미 시작되지 않은 경우만 - 타이머 초기화 방지)
          const startResult = await GameSession.findOneAndUpdate(
            {
              _id: sessionId,
              $or: [
                { questionStartAt: null },
                { questionStartAt: { $exists: false } }
              ]
            },
            { $set: { questionStartAt: new Date() } },
            { new: true }
          );

          if (!startResult) {
            // 이미 시작되었거나 세션이 없음 (에러가 아니라 정상)
            return;
          }

          // 현재 문제의 timeLimit 가져오기
          const actualQuestionIndex = session.questionOrder[session.currentQuestionIndex];
          const quizData = session.cachedQuizData;
          const currentQuestion = quizData?.questions?.[actualQuestionIndex];
          const timeLimit = currentQuestion?.timeLimit || 90;

          // 모든 클라이언트에게 시작 신호 전송
          io.to(sessionId).emit('question-start', {
            success: true,
            data: {
              questionStartAt: startResult.questionStartAt,
              timeLimit: timeLimit // 클라이언트가 타이머를 직접 카운트다운하도록 전송
            }
          });
        }
      } catch (error) {
        handleSocketError(socket, error, 'client-ready');
      }
    });

    // 일반 채팅은 DB에 로그 저장
    socket.on('chatMessage', async ({ sessionId, message }) => {
        touchSessionCache(sessionId);
        // 캐시에서 사용자 정보 조회 (DB 조회 없음!)
        const userInfo = sessionUserCache.get(sessionId)?.get(socket.userId) || {
            nickname: null,
            profileImage: null
        };

        // 즉시 브로드캐스트 (userId 추가)
        io.to(sessionId).emit('chat', {
            user: socket.userId,  // ← 추가: 클라이언트에서 isMyMessage 판단용
            nickname: userInfo.nickname || 'Unknown',
            profileImage: userInfo.profileImage,
            message
        });
    });

    // 클라이언트에서 정답을 전송하면 서버에서 검증하는 이벤트
    socket.on('correct', async ({ sessionId, questionIndex, currentIndex, timestamp, answer }) => {
      try {
        if (!ObjectId.isValid(sessionId)) return;
        let session = await safeFindSessionById(GameSession, sessionId);
        if (!session || !session.isActive) return;

        const userId = socket.userId;
        const playerIndex = session.players.findIndex(p => p.userId.toString() === userId.toString());
        if (playerIndex === -1) return;

        const player = session.players[playerIndex];
        if (!player) return;

        // 클라이언트에서 받은 문제 인덱스 사용 (네트워크 지연 대응)
        const actualQuestionIndex = questionIndex !== undefined ? questionIndex : session.questionOrder[session.currentQuestionIndex];
        const qIndex = String(actualQuestionIndex);

        // 중복 정답 방지 (DB에서 확인)
        if (player.answered?.[qIndex]) {
          return;
        }

        // 🛡️ 서버에서 정답 검증
        if (!answer) {
          return;
        }

        // 🚀 캐시된 Quiz 데이터 사용 (DB 조회 없음!)
        const quizData = session.cachedQuizData;
        if (!quizData || !quizData.questions || !quizData.questions[actualQuestionIndex]) {
          console.error(`❌ 캐시된 퀴즈 데이터 없음: 문제 ${actualQuestionIndex}`);
          return;
        }

        const question = quizData.questions[actualQuestionIndex];
        const userAnswerHash = hashAnswer(answer);
        const correctAnswerHashes = question.answers; // 이미 해시된 값이므로 그대로 사용
        const isCorrect = correctAnswerHashes.includes(userAnswerHash);

        // 정답이 아니면 처리 중단
        if (!isCorrect) {
          return;
        }

        const displayName = player.nickname || 'Unknown';

        // ⚡ Redis로 첫 번째 정답자 판정 (userId 사용)
        const redisKey = `first:${sessionId}:${qIndex}`;
        let isFirstCorrectUser = false;

        try {
          // SET NX: key가 없을 때만 설정 (원자적 연산!)
          const result = await redisClient.set(redisKey, userId, {
            NX: true,  // key가 없을 때만 설정
            EX: 3600   // 1시간 후 자동 삭제
          });
          isFirstCorrectUser = result === 'OK';
        } catch (redisError) {
          console.error('❌ Redis 에러:', redisError);
          socket.emit('socket-error', {
            success: false,
            message: 'Redis 연결 오류가 발생했습니다.'
          });
          return;
        }

        const userInfo = sessionUserCache.get(sessionId)?.get(socket.userId) || {
            nickname: null,
            profileImage: null
        };

        const scoreIncrement = isFirstCorrectUser ? 2 : 1;

        // 즉시 채팅 emit
        io.to(sessionId).emit('correct', {
          success: true,
          data: {
            nickname: displayName,
            profileImage: userInfo.profileImage,
            isFirst: isFirstCorrectUser
          }
        });

        // DB 업데이트 (백그라운드) - correctUsers에 userId 저장
        GameSession.findOneAndUpdate(
          {
            _id: sessionId,
            [`players.${playerIndex}.answered.${qIndex}`]: { $ne: true }
          },
          {
            $set: {
              [`players.${playerIndex}.answered.${qIndex}`]: true,
              [`players.${playerIndex}.lastCorrectTime`]: new Date()
            },
            $inc: {
              [`players.${playerIndex}.score`]: scoreIncrement,
              [`players.${playerIndex}.correctAnswersCount`]: 1
            },
            $push: {
              [`correctUsers.${qIndex}`]: userId  // userId 저장 (닉네임 대신)
            }
          },
          { new: true }
        ).then(updateResult => {
          if (!updateResult) {
            return;
          }
          session = updateResult;
          emitScoreboard(io, sessionId, session.players);
          handleSubjectiveQuestionCompletion(sessionId, io, app);
        }).catch(err => {
          console.error('❌ DB 업데이트 실패:', err);
        });
      } catch (error) {
        handleSocketError(socket, error, 'correct');
      }
    });

    //객관식 문제 정답처리
    socket.on('choiceQuestionCorrect', async ({ sessionId, questionIndex, currentIndex, timestamp, answer }) => {
      try {
        if (!ObjectId.isValid(sessionId)) return;
        let session = await safeFindSessionById(GameSession, sessionId);
        if (!session || !session.isActive) return;

        const userId = socket.userId;
        const playerIndex = session.players.findIndex(p => p.userId.toString() === userId.toString());
        if (playerIndex === -1) return;

        const player = session.players[playerIndex];
        if (!player) return;

        // 클라이언트에서 받은 문제 인덱스 사용 (네트워크 지연 대응)
        const actualQuestionIndex = questionIndex !== undefined ? questionIndex : session.questionOrder[session.currentQuestionIndex];
        const qIndex = String(actualQuestionIndex);

        if (player.answered?.[qIndex]) return;

        // 🛡️ 서버에서 정답 검증
        if (!answer) {
          return;
        }

        // 🚀 캐시된 Quiz 데이터 사용 (DB 조회 없음!)
        const quizData = session.cachedQuizData;
        if (!quizData || !quizData.questions || !quizData.questions[actualQuestionIndex]) {
          console.error(`❌ 캐시된 퀴즈 데이터 없음: 문제 ${actualQuestionIndex}`);
          return;
        }

        const question = quizData.questions[actualQuestionIndex];
        const userAnswerHash = hashAnswer(answer);
        const correctAnswerHashes = question.answers; // 이미 해시된 값이므로 그대로 사용
        const isCorrect = correctAnswerHashes.includes(userAnswerHash);

        // 정답이 아니면 처리 중단
        if (!isCorrect) {
          return;
        }

        const displayName = player.nickname || 'Unknown';

        // ⚡ Redis로 첫 번째 정답자 판정 (userId 사용)
        const redisKey = `first:${sessionId}:${qIndex}`;
        let isFirstCorrectUser = false;

        try {
          // SET NX: key가 없을 때만 설정 (원자적 연산!)
          const result = await redisClient.set(redisKey, userId, {
            NX: true,  // key가 없을 때만 설정
            EX: 3600   // 1시간 후 자동 삭제
          });
          isFirstCorrectUser = result === 'OK';
        } catch (redisError) {
          console.error('❌ Redis 에러 (객관식):', redisError);
          socket.emit('socket-error', {
            success: false,
            message: 'Redis 연결 오류가 발생했습니다.'
          });
          return;
        }

        const scoreIncrement = isFirstCorrectUser ? 2 : 1;

        // DB 업데이트 (백그라운드) - choiceQuestionCorrectUsers에 userId 저장
        GameSession.findOneAndUpdate(
          {
            _id: sessionId,
            [`players.${playerIndex}.answered.${qIndex}`]: { $ne: true }
          },
          {
            $set: {
              [`players.${playerIndex}.answered.${qIndex}`]: true
            },
            $inc: {
              [`players.${playerIndex}.score`]: scoreIncrement,
              [`players.${playerIndex}.correctAnswersCount`]: 1
            },
            $push: {
              [`choiceQuestionCorrectUsers.${qIndex}`]: userId  // userId 저장 (닉네임 대신)
            }
          },
          { new: true }
        ).then(updateResult => {
          if (!updateResult) {
            return;
          }
          session = updateResult;
          handleChoiceQuestionCompletion(sessionId, io, app, 'all_answered');
        }).catch(err => {
          console.error('❌ 객관식 DB 업데이트 실패:', err);
        });

      } catch (error) {
        handleSocketError(socket, error, 'correct');
      }
    });

    socket.on('choiceQuestionIncorrect', async ({sessionId, questionIndex, currentIndex, timestamp, answer}) => {
      try {
        if (!ObjectId.isValid(sessionId)) return;
        let session = await safeFindSessionById(GameSession, sessionId);
        if (!session || !session.isActive) return;

        const userId = socket.userId;
        const playerIndex = session.players.findIndex(p => p.userId.toString() === userId.toString());
        if (playerIndex === -1) return;

        const player = session.players[playerIndex];
        if (!player) return;

        // 클라이언트에서 받은 문제 인덱스 사용 (네트워크 지연 대응)
        const actualQuestionIndex = questionIndex !== undefined ? questionIndex : session.questionOrder[session.currentQuestionIndex];
        const qIndex = String(actualQuestionIndex);

        if (player.answered?.[qIndex]) return;

        // 🛡️ 서버에서 정답 검증 (클라이언트가 정답을 오답으로 속이는 것 방지)
        if (answer) {
          const quizData = session.cachedQuizData;
          if (quizData && quizData.questions && quizData.questions[actualQuestionIndex]) {
            const question = quizData.questions[actualQuestionIndex];
            const userAnswerHash = hashAnswer(answer);
            const correctAnswerHashes = question.answers; // 이미 해시된 값이므로 그대로 사용
            const isActuallyCorrect = correctAnswerHashes.includes(userAnswerHash);

            // 만약 실제로는 정답인데 오답으로 속이려 하면 차단
            if (isActuallyCorrect) {
              return;
            }
          }
        }

        // 원자적 업데이트로 중복 방지
        const updateResult = await GameSession.findOneAndUpdate(
          {
            _id: sessionId,
            [`players.${playerIndex}.answered.${qIndex}`]: { $ne: true }
          },
          {
            $set: {
              [`players.${playerIndex}.answered.${qIndex}`]: true
            }
          },
          { new: true }
        );

        if (!updateResult) {
          return;
        }

        session = updateResult;

        await handleChoiceQuestionCompletion(sessionId, io, app, 'all_answered');

      } catch (error) {
        handleSocketError(socket, error, 'choiceQuestionIncorrect');
      }
    });

  // 스킵투표
  socket.on('voteSkip', async ({ sessionId }) => {
    try {
      if (!ObjectId.isValid(sessionId)) return;
      const session = await safeFindSessionById(GameSession, sessionId);
      if (!session || !session.isActive) return;

      const userId = socket.userId;
      const player = session.players.find(p => p.userId.toString() === userId.toString());

      // userId로 중복 체크 (닉네임 대신)
      if (!session.skipVotes.includes(userId)) {
        session.skipVotes.push(userId);
        const success = await safeSaveSession(session);
          if (!success) {
            console.error('❌ 세션 저장 중 에러 발생 - voteSkip');
            return;
          }

        // ⚡ Redis에서 접속 인원 가져오기
        const connectedCount = await getConnectedCount(sessionId, session);

        io.to(sessionId).emit('voteSkipUpdate', {
          success: true,
          data: {
            votes: session.skipVotes.length,
            total: connectedCount
          }
        });

        // 스킵 투표는 현재 접속 중인 플레이어만 기준으로 계산
        const voteRatio = session.skipVotes.length / connectedCount;

        if (voteRatio >= 0.5 && connectedCount > 0) {

          if (session.revealedAt) {
            return;
          }

          const actualQuestionIndex = session.questionOrder[session.currentQuestionIndex];
          const qIndex = String(actualQuestionIndex);
          const hasChoiceQuestionData = session.choiceQuestionCorrectUsers && 
                                        session.choiceQuestionCorrectUsers[qIndex] && 
                                        session.choiceQuestionCorrectUsers[qIndex].length > 0;

          if (hasChoiceQuestionData) {
            await handleChoiceQuestionCompletion(sessionId, io, app, 'vote_skip');
          } else {
            await revealAnswer(sessionId, io, app)();
          }
        }
      }
    } catch (error) {
      handleSocketError(socket, error, 'voteSkip');
    }
  });

  // //방장 강제스킵
  socket.on('forceSkip', async ({ sessionId }) => {
    try {
      if (!ObjectId.isValid(sessionId)) return;
      const session = await safeFindSessionById(GameSession, sessionId);
      if (!session || session.host?.toString() !== socket.userId) return;

      if (session.revealedAt) {
        return;
      }

      const actualQuestionIndex = session.questionOrder[session.currentQuestionIndex];
      const qIndex = String(actualQuestionIndex);
      const hasChoiceQuestionData = session.choiceQuestionCorrectUsers && 
                                    session.choiceQuestionCorrectUsers[qIndex] && 
                                    session.choiceQuestionCorrectUsers[qIndex].length > 0;

      if (hasChoiceQuestionData) {
        // 객관식: 통합 함수 사용
        await handleChoiceQuestionCompletion(sessionId, io, app, 'force_skip');
      } else {
        // 주관식: 기존 로직
        await revealAnswer(sessionId, io, app)();
      }
    } catch (error) {
      handleSocketError(socket, error, 'forceSkip');
    }
  });


  socket.on('revealAnswer', async ({ sessionId, questionIndex }) => {
    try {
      if (!ObjectId.isValid(sessionId)) return;
      let session = await safeFindSessionById(GameSession, sessionId);
      if (!session) return;

      // ✅ 문제 인덱스 검증 (지연된 요청 방지)
      const actualQuestionIndex = session.questionOrder[session.currentQuestionIndex];
      if (questionIndex !== undefined && questionIndex !== actualQuestionIndex) {
        return;
      }

      // 호스트가 없거나 연결이 끊긴 경우 자동으로 새로운 호스트 할당
      if (!session.host || !session.players.find(p => p.userId.toString() === session.host.toString() && p.connected)) {
        session = await ensureHostExists(sessionId, io);
        if (!session) {
          console.error('❌ 호스트 재할당 실패 - revealAnswer');
          return;
        }
      }

      // ✅ 호스트 검증 (호스트만 정답 공개 가능)
      const userId = socket.userId;
      if (!userId || session.host.toString() !== userId.toString()) {
        return;
      }

      if (session.revealedAt) return;

      const orderIndex = session.currentQuestionIndex;
      const actualIndex = session.questionOrder[orderIndex];
      const qIndex = String(actualIndex);
      const revealData = await getRevealData(sessionId, session.quizId, actualIndex);
      if (!revealData) return;

      const revealedAt = new Date();

      // choiceQuestionCorrectUsers → correctUsers로 데이터 이동 준비
      const updateOps = {
        $set: {
          revealedAt: revealedAt
        }
      };

      // 객관식 정답자 데이터가 있으면 이동
      if (session.choiceQuestionCorrectUsers && session.choiceQuestionCorrectUsers[qIndex]) {
        updateOps.$set[`correctUsers.${qIndex}`] = [...session.choiceQuestionCorrectUsers[qIndex]];
        updateOps.$unset = { [`choiceQuestionCorrectUsers.${qIndex}`]: "" };
      }

      // 원자적 업데이트
      const updateResult = await GameSession.findOneAndUpdate(
        {
          _id: sessionId,
          revealedAt: null
        },
        updateOps,
        { new: true }
      );

      if (!updateResult) {
        return;
      }

      session = updateResult;

      // 현재 문제의 정답자 목록 가져오기 (userId 배열)
      const correctUserIds = session.correctUsers?.[qIndex] || [];

      // userId를 nickname으로 변환
      const correctUsers = correctUserIds.map(uid => {
        const player = session.players.find(p => p.userId.toString() === uid.toString());
        return player?.nickname || 'Unknown';
      });

      // 모든 참가자에게 정답 전송
      io.to(sessionId).emit('revealAnswer_Emit', {
        success: true,
        data: {
          answers: revealData.answers,
          answerImage: revealData.answerImage,
          index: actualIndex,
          revealedAt: session.revealedAt,
          correctUsers: correctUsers
        }
      });

      // 2. 스코어보드 업데이트
      emitScoreboard(io, sessionId, session.players);

    } catch (error) {
      handleSocketError(socket, error, 'revealAnswer');
    }
  });

  // 정답공개후 다음 문제로 넘기기
  socket.on('nextQuestion', async ({ sessionId, questionIndex }) => {
    try {
      if (!ObjectId.isValid(sessionId)) return;
      let session = await safeFindSessionById(GameSession, sessionId);
      if (!session) return;

      // ✅ 문제 인덱스 검증 (지연된 요청 방지)
      if (questionIndex !== undefined && questionIndex !== session.currentQuestionIndex) {
        return;
      }

      // 호스트가 없거나 연결이 끊긴 경우 자동으로 새로운 호스트 할당
      if (!session.host || !session.players.find(p => p.userId.toString() === session.host.toString() && p.connected)) {
        session = await ensureHostExists(sessionId, io);
        if (!session) {
          console.error('❌ 호스트 재할당 실패 - nextQuestion');
          return;
        }
      }

      // ✅ 호스트 검증 (호스트만 다음 문제로 넘기기 가능)
      const userId = socket.userId;
      if (!userId || session.host.toString() !== userId.toString()) {
        return;
      }

      // ⚡ Redis 키 정리 (이전 문제의 첫 번째 정답자 정보 삭제)
      if (redisClient && redisClient.isOpen) {
        try {
          const redisKey = `first:${sessionId}:${questionIndex}`;
          await redisClient.del(redisKey);
        } catch (redisError) {
          console.error('⚠️ Redis 키 삭제 실패:', redisError);
        }
      }

      await goToNextQuestion(sessionId, io, app, redisClient);
    } catch (error) {
      handleSocketError(socket, error, 'nextQuestion');
    }
  });
  
  });

  // 호스트 자동 재할당 함수
  async function ensureHostExists(sessionId, io) {
    try {
      const session = await safeFindSessionById(GameSession, sessionId);
      if (!session) return null;

      // 호스트가 이미 있고 연결되어 있으면 그대로 반환
      if (session.host) {
        const hostPlayer = session.players.find(p =>
          p.userId.toString() === session.host.toString() && p.connected
        );
        if (hostPlayer) {
          return session;
        }
      }

      // 호스트가 없거나 연결이 끊겼으면 새로운 호스트 할당
      const connectedPlayer = session.players.find(p => p.connected);
      if (!connectedPlayer) {
        return session;
      }

      const newHostId = new ObjectId(connectedPlayer.userId);
      session.host = newHostId;
      session.markModified('host');

      const success = await safeSaveSession(session);
      if (!success) {
        console.error('❌ 호스트 재할당 중 세션 저장 실패');
        return session;
      }

      // 모든 클라이언트에게 호스트 변경 알림
      io.to(sessionId).emit('host-updated', {
        success: true,
        data: {
          host: newHostId.toString()
        }
      });

      return session;
    } catch (error) {
      console.error('❌ ensureHostExists 에러:', error);
      return null;
    }
  }

  async function addPlayedQuizzes(quizId, userId, app) {
    try {
      if (!quizId || !userId) return;

      // 게스트 사용자는 User DB에 없으므로 건너뛰기
      if (typeof userId === 'string' && userId.startsWith('guest_')) {
        return;
      }

      // ObjectId 유효성 검증
      if (!ObjectId.isValid(userId)) {
        console.warn('⚠️ 유효하지 않은 userId 형식:', userId);
        return;
      }

      const User = require('../models/User')(userDb);

      // 최적화: $addToSet는 이미 중복을 방지하므로 별도 체크 불필요
      // 인덱스가 있으면 MongoDB가 효율적으로 처리
      const result = await User.findByIdAndUpdate(
        userId,
        { $addToSet: { playedQuizzes: quizId } },
        { new: false } // 업데이트 전 문서 반환 (변경 여부 확인용, 선택사항)
      );

      if (!result) {
        // 사용자가 존재하지 않는 경우
        return;
      }

    } catch (error) {
      // 데이터베이스의 playedQuizzes 필드가 문자열이면 여전히 이 오류가 발생할 수 있습니다.
      console.error('퀴즈 플레이 기록 실패', error);
      throw error; // startGame 핸들러가 오류를 인지하도록 다시 던집니다.
    }
  }

  // 문제 종료 후 정답 공개
  function revealAnswer(sessionId, io, app) {
    return async () => {
      try {
        if (!ObjectId.isValid(sessionId)) return;
        let session = await safeFindSessionById(GameSession, sessionId);
        if (!session || !session.isActive) return;

        // 호스트가 없거나 연결이 끊긴 경우 자동으로 새로운 호스트 할당
        if (!session.host || !session.players.find(p => p.userId.toString() === session.host.toString() && p.connected)) {
          session = await ensureHostExists(sessionId, io);
          if (!session) {
            console.error('❌ 호스트 재할당 실패 - revealAnswer (internal)');
            return;
          }
        }

        // 중복투표 방지
        if (session.revealedAt) return;

        const orderIndex = session.currentQuestionIndex;
        const actualIndex = session.questionOrder[orderIndex];
        const qIndex = String(actualIndex);
        const revealData = await getRevealData(sessionId, session.quizId, actualIndex);
        if (!revealData) return;

        const revealedAt = new Date();

        // choiceQuestionCorrectUsers → correctUsers로 데이터 이동 준비
        const updateOps = {
          $set: {
            revealedAt: revealedAt
          }
        };

        // 객관식 정답자 데이터가 있으면 이동
        if (session.choiceQuestionCorrectUsers && session.choiceQuestionCorrectUsers[qIndex]) {
          updateOps.$set[`correctUsers.${qIndex}`] = [...session.choiceQuestionCorrectUsers[qIndex]];
          updateOps.$unset = { [`choiceQuestionCorrectUsers.${qIndex}`]: "" };
        }

        // 원자적 업데이트 + 중복 방지 (revealedAt이 없는 경우만)
        const updateResult = await GameSession.findOneAndUpdate(
          {
            _id: sessionId,
            revealedAt: null // 아직 정답이 공개되지 않은 경우만
          },
          updateOps,
          { new: true }
        );

        if (!updateResult) {
          return;
        }

        session = updateResult;

        // 현재 문제의 정답자 목록 가져오기 (userId 배열)
        const correctUserIds = session.correctUsers?.[qIndex] || [];

        // userId를 nickname으로 변환
        const correctUsers = correctUserIds.map(uid => {
          const player = session.players.find(p => p.userId.toString() === uid.toString());
          return player?.nickname || 'Unknown';
        });

        io.to(sessionId).emit('revealAnswer_Emit', {
          success: true,
          data: {
            answers: revealData.answers,
            answerImage: revealData.answerImage,
            index: actualIndex,
            revealedAt,
            correctUsers: correctUsers
          }
        });

        emitScoreboard(io, sessionId, session.players);

      } catch (error) {
        console.error('❌ Error in revealAnswer:', error);
      }
    };
  }

  // 퀴즈 기록 저장 및 퍼센타일 임계값 계산
  async function saveQuizRecordsAndCalculateThresholds(quizId, players) {
    try {
      // 1. 게스트가 아닌 플레이어만 필터링 (게스트는 User DB에 없음)
      const registeredPlayers = players.filter(p => {
        const uid = p.userId.toString();
        return !uid.startsWith('guest_') && ObjectId.isValid(uid);
      });

      const userIds = registeredPlayers.map(p => p.userId);
      const users = await User.find({ _id: { $in: userIds } }).select('_id playedQuizzes').lean();

      const userPlayedQuizzesMap = new Map();
      users.forEach(user => {
        const playedQuizIds = (user.playedQuizzes || []).map(id => id.toString());
        userPlayedQuizzesMap.set(user._id.toString(), playedQuizIds);
      });

      // playedQuizzes에 없는 플레이어만 필터링 (registeredPlayers에서만)
      const newPlayers = registeredPlayers.filter(player => {
        const playedQuizzes = userPlayedQuizzesMap.get(player.userId.toString()) || [];
        return !playedQuizzes.includes(quizId.toString());
      });

      // 2. 새로운 플레이어들의 점수 추출
      const newScores = newPlayers.map(p => ({
        score: p.correctAnswersCount || 0,
        userId: p.userId
      }));

      // 3. QuizRecord 업데이트 (upsert)
      let quizRecord = await QuizRecord.findOne({ quizId });

      if (!quizRecord) {
        // 처음 플레이되는 퀴즈
        quizRecord = await QuizRecord.create({
          quizId,
          records: newScores.map(s => ({ score: s.score })),
          totalCount: newScores.length
        });
      } else if (newScores.length > 0) {
        // 기존 기록에 추가 (신규 플레이어가 있을 때만)
        await QuizRecord.findByIdAndUpdate(
          quizRecord._id,
          {
            $push: { records: { $each: newScores.map(s => ({ score: s.score })) } },
            $inc: { totalCount: newScores.length }
          }
        );
        // 업데이트된 데이터 다시 조회
        quizRecord = await QuizRecord.findById(quizRecord._id);
      }

      // 4. playedQuizzes에 퀴즈 추가 (한 번에 처리, 신규 플레이어가 있을 때만)
      if (newScores.length > 0) {
        await User.updateMany(
          { _id: { $in: newScores.map(s => s.userId) } },
          { $addToSet: { playedQuizzes: quizId } }
        );
      }

      // 5. 퍼센타일 임계값 계산 (한 번만 계산!)
      const allScores = quizRecord.records.map(r => r.score).sort((a, b) => b - a);
      const totalPlayers = allScores.length;

      let percentileThresholds = null;

      // 10회 이상일 때만 임계값 계산
      if (totalPlayers >= 10) {
        // 각 퍼센타일의 인덱스 계산
        const top1Index = Math.floor(totalPlayers * 0.01);
        const top3Index = Math.floor(totalPlayers * 0.03);
        const top5Index = Math.floor(totalPlayers * 0.05);
        const top10Index = Math.floor(totalPlayers * 0.10);
        const top30Index = Math.floor(totalPlayers * 0.30);
        const top50Index = Math.floor(totalPlayers * 0.50);

        percentileThresholds = {
          top1: allScores[top1Index] || 0,
          top3: allScores[top3Index] || 0,
          top5: allScores[top5Index] || 0,
          top10: allScores[top10Index] || 0,
          top30: allScores[top30Index] || 0,
          top50: allScores[top50Index] || 0
        };

        // DB에 임계값 저장
        await QuizRecord.findByIdAndUpdate(
          quizRecord._id,
          { $set: { percentileThresholds } }
        );
      }

      // 6. 플레이어 데이터와 임계값 반환 (퍼센트 계산은 클라이언트에서!)
      return {
        players: players.map(p => ({
          nickname: p.nickname,
          profileImage: p.profileImage,
          score: p.score,
          correctAnswersCount: p.correctAnswersCount || 0,
          connected: p.connected
        })),
        percentileThresholds
      };

    } catch (error) {
      console.error('❌ 퀴즈 기록 저장 실패:', error);
      // 에러 발생 시 임계값 없이 반환
      return {
        players: players.map(p => ({
          nickname: p.nickname,
          profileImage: p.profileImage,
          score: p.score,
          correctAnswersCount: p.correctAnswersCount || 0,
          connected: p.connected
        })),
        percentileThresholds: null
      };
    }
  }

  //문제 타이머 함수
  async function goToNextQuestion(sessionId, io, app, redisClient) {
    try {
      const quizDb = app.get('quizDb');
      const GameSession = require('../models/GameSession')(quizDb);
      const Quiz = require('../models/Quiz')(quizDb);

      if (!ObjectId.isValid(sessionId)) return;
      let session = await safeFindSessionById(GameSession, sessionId);
      if (!session) return;

      const nextQuestionIndex = session.currentQuestionIndex + 1;

      // 모든 문제를 완료한 경우
      if (nextQuestionIndex >= session.questionOrder.length) {
        // 원자적 업데이트로 게임 종료 처리
        const updateResult = await GameSession.findByIdAndUpdate(
          sessionId,
          {
            $set: {
              isActive: false,
              endedAt: new Date(),
              revealedAt: null,
              currentQuestionIndex: nextQuestionIndex
            },
            $unset: {
              skipVotes: "",
              readyPlayers: ""
            }
          },
          { new: true }
        );

        if (!updateResult) {
          console.error('❌ 세션 저장 중 에러 발생 - goToNextQuestion');
          return;
        }

        session = updateResult;

        // 완료된 게임 수 증가
        await Quiz.findByIdAndUpdate(
          session.quizId,
          { $inc: { completedGameCount: 1 } }
        );

        // 게임 활동 기록 (실패해도 게임 로직에 영향 없음)
        try {
          const GameActivity = require('../models/GameActivity')(quizDb);
          await GameActivity.create({ type: 'game_completed', sessionId });
        } catch (activityErr) {
          console.error('GameActivity 기록 실패 (game_completed):', activityErr.message);
        }

        // 세션 관련 캐시 정리 (메모리 누수 방지)
        clearSessionRuntimeCaches(sessionId);

        // ⚡ Redis 키 정리 (모든 문제의 첫 번째 정답자 정보 + 접속 인원 카운터 삭제)
        if (redisClient && redisClient.isOpen) {
          try {
            const questionCount = session.questionOrder.length;
            const deletePromises = [];
            for (let i = 0; i < questionCount; i++) {
              const redisKey = `first:${sessionId}:${i}`;
              deletePromises.push(redisClient.del(redisKey));
            }
            // 접속 인원 카운터도 삭제
            deletePromises.push(redisClient.del(`session:${sessionId}:connected`));
            await Promise.all(deletePromises);
          } catch (redisError) {
            console.error('⚠️ Redis 키 정리 실패:', redisError);
          }
        }

        // 📊 점수 기록 저장 및 퍼센타일 임계값 계산
        const { players: playersData, percentileThresholds } = await saveQuizRecordsAndCalculateThresholds(
          session.quizId,
          session.players
        );

        // 제작자 닉네임 (Quiz에 저장된 값 사용 - DB 조회 불필요)
        const creatorNickname = session.cachedQuizData?.creatorNickname || '알 수 없음';

        io.to(sessionId).emit('end', {
          success: true,
          message: '퀴즈 종료!',
          data: {
            players: playersData,
            percentileThresholds, // 클라이언트에서 비교할 임계값 전송
            creatorNickname: creatorNickname // 제작자 닉네임 추가
          }
        });
        return;
      }

      // 다음 문제로 이동 (원자적 업데이트로 중복 방지)
      const updateResult = await GameSession.findOneAndUpdate(
        {
          _id: sessionId,
          isActive: true, // 활성 세션만 업데이트
          currentQuestionIndex: nextQuestionIndex - 1 // ✅ 아직 이전 문제인 경우만 업데이트 (중복 방지)
        },
        {
          $set: {
            revealedAt: null,
            questionStartAt: null, // ✅ 다음 문제의 타이머를 위해 리셋
            currentQuestionIndex: nextQuestionIndex,
            skipVotes: [],
            readyPlayers: []
          }
        },
        { new: true }
      );

      if (!updateResult) {
        return;
      }

      session = updateResult;

      // ⚡ Redis에서 접속 인원 가져오기
      const connectedCount = await getConnectedCount(sessionId, session);

      // 문제 데이터만 전송 (타이머 시작 X)
      io.to(sessionId).emit('next', {
        success: true,
        data: {
          currentIndex: session.currentQuestionIndex,
          totalPlayers: connectedCount,
        }
      });
    } catch (error) {
      console.error('❌ Error in goToNextQuestion:', error);
    }
  };

  // 주관식 문제 완료 체크 함수
  async function handleSubjectiveQuestionCompletion(sessionId, io, app) {
    try {
      const GameSession = require('../models/GameSession')(app.get('quizDb'));
      const session = await safeFindSessionById(GameSession, sessionId);
      if (!session || !session.isActive) return;

      const orderIndex = session.currentQuestionIndex;
      const actualIndex = session.questionOrder[orderIndex];
      const qIndex = String(actualIndex);
      const connectedPlayers = session.players.filter(p => p.connected);
      
      // 모든 플레이어가 답변 완료했는지 체크
      const allAnswered = connectedPlayers.every(player => 
        player.answered && player.answered[qIndex] === true
      );

      if (allAnswered) {
        
        // 정답 공개
        await revealAnswer(sessionId, io, app)();
      }
    } catch (error) {
      console.error('❌ 주관식 완료 체크 에러:', error);
    }
  }

  async function handleChoiceQuestionCompletion(sessionId, io, app, triggerType = 'all_answered') {
    try {
      const GameSession = require('../models/GameSession')(app.get('quizDb'));
      let session = await safeFindSessionById(GameSession, sessionId);
      if (!session || !session.isActive) return;

      // 호스트가 없거나 연결이 끊긴 경우 자동으로 새로운 호스트 할당
      if (!session.host || !session.players.find(p => p.userId.toString() === session.host.toString() && p.connected)) {
        session = await ensureHostExists(sessionId, io);
        if (!session) {
          console.error('❌ 호스트 재할당 실패 - handleChoiceQuestionCompletion');
          return;
        }
      }

      const orderIndex = session.currentQuestionIndex;
      const actualIndex = session.questionOrder[orderIndex];
      const qIndex = String(actualIndex);
      const connectedPlayers = session.players.filter(p => p.connected);
      
      // 완료 조건 확인
      let shouldComplete = false;
      
      switch (triggerType) {
        case 'all_answered':
          // 모든 플레이어가 답변 완료
          shouldComplete = connectedPlayers.every(player => 
            player.answered && player.answered[qIndex] === true
          );
          break;
          
        case 'vote_skip':
          // 스킵 투표 통과 (이미 외부에서 확인됨)
          shouldComplete = true;
          break;
          
        case 'force_skip':
          // 강제 스킵 (이미 외부에서 확인됨)
          shouldComplete = true;
          break;
          
        default:
          shouldComplete = false;
      }

      if (shouldComplete) {
        const correctUserIds = session.choiceQuestionCorrectUsers[qIndex] || [];

        // userId를 nickname으로 변환
        const correctUsers = correctUserIds.map(uid => {
          const player = session.players.find(p => p.userId.toString() === uid.toString());
          return player?.nickname || 'Unknown';
        });

        // ✅ 점수는 이미 정답 제출 시 즉시 증가시켰으므로 여기서는 계산하지 않음
        // (이전에는 forEach로 점수를 계산했지만, race condition 때문에 즉시 처리로 변경)

        // 정답 공개 상태로 변경
        const revealedAt = new Date();
        const updateResult = await GameSession.findOneAndUpdate(
          {
            _id: sessionId,
            revealedAt: null
          },
          {
            $set: { revealedAt }
          },
          { new: true }
        );

        if (!updateResult) {
          return;
        }
        session = updateResult;

        const revealData = await getRevealData(sessionId, session.quizId, actualIndex);
        if (!revealData) return;

        io.to(sessionId).emit('revealAnswer_Emit', {
          success: true,
          data: {
            answers: revealData.answers,
            answerImage: revealData.answerImage,
            index: actualIndex,
            revealedAt,
            correctUsers: correctUsers
          }
        });

        // 스코어보드 업데이트 이벤트 발생
        emitScoreboard(io, sessionId, session.players);
      }
    } catch (error) {
      console.error('handleChoiceQuestionCompletion 에러:', error);
    }
  }

  // 📊 메모리 모니터링을 위해 캐시 크기 반환
  return {
    getSessionUserCacheSize: () => sessionUserCache.size,
    getDisconnectTimersSize: () => disconnectTimers.size
  };
};
