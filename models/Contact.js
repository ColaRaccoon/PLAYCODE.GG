// Contact.js - 문의하기 모델

const { Schema } = require('mongoose');

const contactSchema = new Schema({
  // 문의자 정보
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 255
  },

  // 문의 내용
  subject: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  message: {
    type: String,
    required: true,
    maxlength: 2000
  },

  // 문의 카테고리
  category: {
    type: String,
    enum: ['general', 'bug', 'feature', 'account', 'other'],
    default: 'general'
  },

  // 처리 상태
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'resolved', 'closed'],
    default: 'pending'
  },

  // 관리자 응답
  adminResponse: {
    type: String,
    default: null
  },
  respondedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  respondedAt: {
    type: Date,
    default: null
  },

  // 사용자 ID (로그인한 경우)
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  // IP 주소 (스팸 방지)
  ipAddress: {
    type: String,
    required: true
  },

  // 타임스탬프
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// 업데이트 시 자동으로 updatedAt 갱신
contactSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// 인덱스 설정
contactSchema.index({ status: 1, createdAt: -1 }); // 상태별 최신순 조회
contactSchema.index({ email: 1 }); // 이메일로 조회
contactSchema.index({ userId: 1 }); // 사용자별 조회

module.exports = function(db) {
  return db.model('Contact', contactSchema);
};
