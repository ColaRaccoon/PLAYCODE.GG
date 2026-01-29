const mongoose = require('mongoose');

const accessLogSchema = new mongoose.Schema({
  ip: {
    type: String,
    required: true,
    index: true
  },
  path: {
    type: String,
    required: true
  },
  method: {
    type: String,
    default: 'GET'
  },
  userAgent: {
    type: String
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now
    // index는 TTL 인덱스로 대체 (아래 참조)
  }
});

// 7일 이상 지난 로그는 자동 삭제 (TTL 인덱스)
accessLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = (connection) => {
  return connection.model('AccessLog', accessLogSchema);
};
