// 기존 공개된 퀴즈들을 위한 QuizRecord 생성 스크립트
// 사용법: node scripts/createQuizRecords.js

const mongoose = require('mongoose');
require('dotenv').config();

async function createQuizRecords() {
  try {
    // MongoDB 연결
    const quizDbConnection = await mongoose.createConnection(process.env.MONGO_URI_QUIZ).asPromise();
    console.log('✅ Quiz DB 연결 성공');

    // 모델 로드
    const Quiz = require('../models/Quiz')(quizDbConnection);
    const QuizRecord = require('../models/QuizRecord')(quizDbConnection);

    // 모든 공개된 퀴즈 조회
    const publicQuizzes = await Quiz.find({ isComplete: true })
      .select('_id title')
      .lean();

    console.log(`📊 공개된 퀴즈 수: ${publicQuizzes.length}`);

    let created = 0;
    let alreadyExists = 0;
    let errors = 0;

    for (const quiz of publicQuizzes) {
      try {
        const result = await QuizRecord.findOneAndUpdate(
          { quizId: quiz._id },
          {
            $setOnInsert: {
              records: [],
              totalCount: 0,
              percentileThresholds: {
                top1: null,
                top3: null,
                top5: null,
                top10: null,
                top30: null,
                top50: null
              }
            }
          },
          { upsert: true, new: true }
        );

        // upsert가 실제로 생성했는지 확인
        const wasCreated = result.records.length === 0 && result.totalCount === 0;

        if (wasCreated) {
          console.log(`✅ 생성: ${quiz.title} (${quiz._id})`);
          created++;
        } else {
          console.log(`⏭️  이미 존재: ${quiz.title} (${quiz._id})`);
          alreadyExists++;
        }
      } catch (err) {
        console.error(`❌ 오류: ${quiz.title} (${quiz._id}):`, err.message);
        errors++;
      }
    }

    console.log('\n📊 마이그레이션 결과:');
    console.log(`   - 새로 생성: ${created}개`);
    console.log(`   - 이미 존재: ${alreadyExists}개`);
    console.log(`   - 오류: ${errors}개`);

    await quizDbConnection.close();
    console.log('\n✅ 마이그레이션 완료');
    process.exit(0);

  } catch (error) {
    console.error('❌ 마이그레이션 실패:', error);
    process.exit(1);
  }
}

createQuizRecords();
