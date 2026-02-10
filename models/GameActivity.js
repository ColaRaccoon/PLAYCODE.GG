const mongoose = require('mongoose');

const gameActivitySchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['session_created', 'session_joined', 'game_completed']
  },
  ip: {
    type: String,
    default: null
  },
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

// 31일 TTL (30일 + 1일 여유)
gameActivitySchema.index({ timestamp: 1 }, { expireAfterSeconds: 31 * 24 * 60 * 60 });

// 쿼리 최적화 (타입 + 기간 검색)
gameActivitySchema.index({ type: 1, timestamp: 1 });

module.exports = (connection) => {
  return connection.model('GameActivity', gameActivitySchema);
};
