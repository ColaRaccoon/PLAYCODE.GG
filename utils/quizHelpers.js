const { ObjectId } = require('mongoose').Types;

async function safeFindQuizById(Quiz, quizId) {
  try {
    const quiz = await Quiz.findById(quizId).lean();
    return quiz || null;
  } catch (err) {
    console.error('❌ Quiz 조회 실패:', err.message);
    return null;
  }
}

module.exports = { safeFindQuizById };