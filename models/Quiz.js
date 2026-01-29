const mongoose = require('mongoose');
const { Schema } = mongoose;

// 신고 스키마
const reportSchema = new Schema({
  reporterId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  reason: {
    type: String,
    required: true,
    maxlength: 500,
  },
  reportedAt: {
    type: Date,
    default: Date.now,
  },
});

const questionSchema = new Schema({
  text: { type: String, maxlength: 80 },
  questionType: { type: String, enum: ['text', 'image', 'video', 'audio'], required: true, default: 'text' },
  imageBase64: { type: String },
  youtubeUrl: { type: String },
  youtubeStartTime: { type: Number, default: 0 },
  youtubeEndTime: { type: Number, default: 0 },
  youtubeLoop: { type: Boolean, default: false },
  answerYoutubeUrl: { type: String },
  answerYoutubeStartTime: { type: Number, default: 0 },
  answerYoutubeEndTime: { type: Number, default: 0 },
  answers: {
    type: [String],
    required: true,
    validate: [v => v.length <= 20, '정답은 최대 20개까지 등록할 수 있습니다.'],
  },
  incorrectAnswers: {
    type: [String],
    validate: [v => v.length <= 4, '오답은 최대 4개까지 등록할 수 있습니다.'],
  },
  isChoice: { type: Boolean, default: false },
  answerImageBase64: { type: String },
  order: { type: Number, required: true },
  timeLimit: {type: Number, default: 30 , min: 5, max: 1800 },
  hint: { type: String, maxlength: 30, default: null }, // 힌트 텍스트 (선택)
  hintShowTime: { type: Number, default: 10, min: 1, max: 1800 }, // 힌트 표시 시간 (초, 남은 시간)
});

const quizSchema = new Schema({
  title: {
    type: String,
    required: true,
    maxlength: 40,
  },
  titleImageBase64: {
    type: String,
    required: true, // 썸네일은 필수값 (임시 placeholder 허용 후 실제 URL로 교체)
  },
  description: {
    type: String,
    maxlength: 100,
  },
  creatorId: {
    type: String, // ObjectId 또는 'seized'
    required: true,
  },
  creatorNickname: {
    type: String, // 퀴즈 공개 시점의 제작자 닉네임 (성능 최적화)
    default: null,
  },
  originalCreatorId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  seizedAt: {
    type: Date,
    default: null,
  },
  seizedById: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  seizedReason: {
    type: String,
    default: null,
  },
  reports: {
    type: [reportSchema],
    default: [],
  },
  questions: {
    type: [questionSchema],
    validate: [v => v.length <= 50, '퀴즈의 문제 개수는 최대 50개까지 등록할 수 있습니다.'],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  isComplete: {
  type: Boolean,
  default: false,
  },
  completedGameCount: { 
  type: Number,
  default: 0
  },
  isRandomOrder: {
    type: Boolean,
    default: false
  },
  recommendationCount: {
    type: Number,
    default: 0
  },
});

// ========== 성능 최적화를 위한 인덱스 ==========

// 1. 작성자 조회용 (관리자 페이지에서 자주 사용)
quizSchema.index({ creatorId: 1 });

// 2. 압수된 퀴즈 조회용
quizSchema.index({ originalCreatorId: 1 });

// 3. 압수자 조회용
quizSchema.index({ seizedById: 1 });

// 4. 생성일 정렬용 (내림차순)
quizSchema.index({ createdAt: -1 });

// 5. 공개/비공개 필터 + 작성자 복합 인덱스
quizSchema.index({ isComplete: 1, creatorId: 1 });

// 6. 신고가 있는 퀴즈 조회용 (sparse: 신고가 있는 문서만 인덱싱)
quizSchema.index({ 'reports.0': 1 }, { sparse: true });

// 7. 제목 검색용 (text 인덱스)
quizSchema.index({ title: 'text' });

// 8. 압수 상태별 조회 최적화
quizSchema.index({ creatorId: 1, isComplete: 1, createdAt: -1 });

// 9. 추천순 정렬 최적화
quizSchema.index({ recommendationCount: -1, createdAt: -1 });

// 10. 인기순 정렬 최적화
quizSchema.index({ completedGameCount: -1, createdAt: -1 });

// 11. 공개 퀴즈 목록 조회 최적화 (isComplete 필터 + 정렬 조건)
quizSchema.index({ isComplete: 1, completedGameCount: -1, createdAt: -1 });

// 12. 공개 퀴즈 추천순 조회 최적화
quizSchema.index({ isComplete: 1, recommendationCount: -1, createdAt: -1 });

// 13. 공개 퀴즈 최신순 조회 최적화
quizSchema.index({ isComplete: 1, createdAt: -1 });

module.exports = (quizDb) => quizDb.model('Quiz', quizSchema);