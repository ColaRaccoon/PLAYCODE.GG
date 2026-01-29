// 기존 Quiz.recommendedBy 배열 데이터를 Recommendation 컬렉션으로 마이그레이션
// 사용법: node scripts/migrate-recommendations.js

const mongoose = require('mongoose');
require('dotenv').config();

async function migrateRecommendations() {
  try {
    // MongoDB 연결
    const quizDbConnection = await mongoose.createConnection(process.env.MONGO_URI_QUIZ).asPromise();
    console.log('✅ Quiz DB 연결 성공');

    // 모델 로드
    const Quiz = require('../models/Quiz')(quizDbConnection);
    const Recommendation = require('../models/Recommendation')(quizDbConnection);

    // recommendedBy 필드가 있는 모든 퀴즈 조회
    const quizzes = await Quiz.find({
      recommendedBy: { $exists: true, $ne: [] }
    }).lean();

    console.log(`📊 마이그레이션할 퀴즈 수: ${quizzes.length}`);

    let totalRecommendations = 0;
    let errors = 0;

    for (const quiz of quizzes) {
      if (!quiz.recommendedBy || quiz.recommendedBy.length === 0) {
        continue;
      }

      console.log(`\n🔄 퀴즈 "${quiz.title}" (${quiz._id}) 마이그레이션 중...`);
      console.log(`   추천인 수: ${quiz.recommendedBy.length}`);

      for (const userId of quiz.recommendedBy) {
        try {
          // 중복 방지를 위해 upsert 사용
          await Recommendation.updateOne(
            { userId, quizId: quiz._id },
            {
              $setOnInsert: {
                userId,
                quizId: quiz._id,
                createdAt: new Date() // 원래 날짜는 알 수 없으므로 현재 날짜 사용
              }
            },
            { upsert: true }
          );
          totalRecommendations++;
        } catch (err) {
          console.error(`   ❌ 오류: userId ${userId} 추가 실패:`, err.message);
          errors++;
        }
      }

      console.log(`   ✅ 완료`);
    }

    console.log('\n📊 마이그레이션 결과:');
    console.log(`   - 총 추천 수: ${totalRecommendations}`);
    console.log(`   - 오류 수: ${errors}`);

    // 선택사항: 마이그레이션 후 recommendedBy 필드 제거
    console.log('\n⚠️  recommendedBy 필드를 제거하시겠습니까?');
    console.log('   이 작업은 되돌릴 수 없습니다!');
    console.log('   제거하려면 아래 주석을 해제하고 다시 실행하세요:');
    console.log('   // await Quiz.updateMany({}, { $unset: { recommendedBy: "" } });');

    await quizDbConnection.close();
    console.log('\n✅ 마이그레이션 완료');
    process.exit(0);

  } catch (error) {
    console.error('❌ 마이그레이션 실패:', error);
    process.exit(1);
  }
}

migrateRecommendations();
