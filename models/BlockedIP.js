const mongoose = require('mongoose');
const { Schema } = mongoose;

const blockedIPSchema = new Schema({
  ip: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  reason: {
    type: String,
    required: true,
    enum: [
      'malicious_user_agent',    // 악의적인 User-Agent
      'suspicious_path',          // 의심스러운 경로 접근
      'repeated_404',             // 반복된 404 에러
      'manual_block',             // 관리자가 수동으로 차단
      'rate_limit_abuse',         // Rate limit 남용
      'other'                     // 기타
    ]
  },
  details: {
    type: String,
    default: ''
  },
  blockedAt: {
    type: Date,
    default: Date.now
  },
  blockedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null  // null이면 자동 차단, ObjectId가 있으면 관리자가 차단
  },
  expiresAt: {
    type: Date,
    default: null  // null이면 영구 차단, 날짜가 있으면 임시 차단
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // 차단 전 활동 기록
  suspiciousActivities: [{
    path: String,
    userAgent: String,
    timestamp: Date
  }]
});

// TTL 인덱스: expiresAt이 설정된 경우 자동으로 문서 삭제
blockedIPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = (userDb) => userDb.model('BlockedIP', blockedIPSchema);
