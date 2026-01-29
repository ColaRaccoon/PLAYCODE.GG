const mongoose = require('mongoose');
const { Schema } = mongoose;

// 퀴즈 추천 스키마
const recommendationSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  quizId: {
    type: Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// 복합 인덱스: 한 사용자는 한 퀴즈를 한 번만 추천 가능
recommendationSchema.index({ userId: 1, quizId: 1 }, { unique: true });

// 퀴즈별 추천인 조회를 위한 인덱스
recommendationSchema.index({ quizId: 1 });

// 사용자별 추천 목록 조회를 위한 인덱스
recommendationSchema.index({ userId: 1 });

module.exports = (quizDb) => quizDb.model('Recommendation', recommendationSchema);
