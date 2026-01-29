const mongoose = require('mongoose');
const { Schema } = mongoose;

const playerSchema = new Schema({
  userId: { type: Schema.Types.Mixed, required: true }, // ObjectId 또는 String (게스트)
  isGuest: { type: Boolean, default: false }, // 게스트 여부
  username: String,
  nickname: { type: String, default: null },
  profileImage: { type: String, default: null },
  score: { type: Number, default: 0 },
  correctAnswersCount: { type: Number, default: 0 },
  choiceQuestionCorrect : { type: Boolean, default : false },
  answered: { type: Schema.Types.Mixed, default: {} },
  connected: { type: Boolean, default: true },
  lastSeen: { type: Date, default: Date.now },
  socketId: { type: String, default: null },
  lastCorrectTime: { type: Date, default: null }, // 마지막 정답을 맞춘 시간
});

const gameSessionSchema = new Schema({
  quizId: { type: Schema.Types.ObjectId, ref: 'Quiz' },
  players: [playerSchema],
  currentQuestionIndex: { type: Number, default: 0 },
  correctUsers: { type: Schema.Types.Mixed, default: {} },
  choiceQuestionCorrectUsers: {type: Schema.Types.Mixed, default: {}},
  startedAt: { type: Date, default: Date.now, index: { expires: '3h' }},
  questionStartAt: { type: Date, default: null },
  revealedAt: { type: Date, default: null },
  isActive: { type: Boolean, default: true },
  inviteCode: { type: String, unique: true },
  isStarted: { type: Boolean, default: false },
  host: { type: Schema.Types.Mixed }, // ObjectId 또는 String (게스트)
  skipVotes: {type: [String], default: []},
  endedAt: { type: Date, default: null, },
  questionOrder: { type: [Number], default: [] },
  readyPlayers: { type: [String], default: [] }, // 문제 로딩 완료한 플레이어 userId 배열
  cachedQuizData: { type: Schema.Types.Mixed, default: null }, // Quiz 데이터 캐싱 (성능 최적화)
});

module.exports = (quizDb) => {
  return quizDb.models.GameSession || quizDb.model('GameSession', gameSessionSchema, 'game_sessions');
};
