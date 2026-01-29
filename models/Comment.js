const mongoose = require('mongoose');
const { Schema } = mongoose;

// 프로필 이미지 신고 스키마
const profileReportSchema = new Schema({
  reporterId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  reporterNickname: {
    type: String,
    required: true,
  },
  reason: {
    type: String,
    enum: ['gore', 'nsfw', 'other'],
    required: true,
  },
  description: {
    type: String,
    maxlength: 200,
  },
  reportedAt: {
    type: Date,
    default: Date.now,
  },
});

// 댓글 신고 스키마
const commentReportSchema = new Schema({
  reporterId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  reporterNickname: {
    type: String,
    required: true,
  },
  reason: {
    type: String,
    enum: ['spam', 'abuse', 'inappropriate', 'other'],
    required: true,
  },
  description: {
    type: String,
    maxlength: 200,
  },
  reportedAt: {
    type: Date,
    default: Date.now,
  },
});

const commentSchema = new Schema({
  quizId: {
    type: Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true,
    index: true,
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  nickname: {
    type: String,
    required: true,
    maxlength: 11,
  },
  profileImage: {
    type: String,
    default: null,
  },
  content: {
    type: String,
    required: true,
    maxlength: 500,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  // 프로필 이미지 신고 관련 필드
  profileReports: {
    type: [profileReportSchema],
    default: [],
  },
  isProfileHidden: {
    type: Boolean,
    default: false,
  },
  profileHiddenReason: {
    type: String,
    default: null,
  },
  profileHiddenAt: {
    type: Date,
    default: null,
  },
  // 댓글 신고 관련 필드
  commentReports: {
    type: [commentReportSchema],
    default: [],
  },
  isCommentHidden: {
    type: Boolean,
    default: false,
  },
  commentHiddenReason: {
    type: String,
    default: null,
  },
  commentHiddenAt: {
    type: Date,
    default: null,
  },
});

// ========== 성능 최적화를 위한 인덱스 ==========

// 1. 퀴즈별 댓글 조회용 (생성일 내림차순)
commentSchema.index({ quizId: 1, createdAt: -1 });

// 2. 사용자별 댓글 조회용
commentSchema.index({ userId: 1, createdAt: -1 });

// 3. 프로필 신고가 있는 댓글 조회용 (sparse: 신고가 있는 문서만 인덱싱)
commentSchema.index({ 'profileReports.0': 1 }, { sparse: true });

// 4. 댓글 신고가 있는 댓글 조회용 (sparse: 신고가 있는 문서만 인덱싱)
commentSchema.index({ 'commentReports.0': 1 }, { sparse: true });

module.exports = (mainDb) => mainDb.model('Comment', commentSchema);
