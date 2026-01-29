// MongoDB 인덱스 생성 스크립트
require('dotenv').config();
const mongoose = require('mongoose');

const QUIZ_DB_URI = process.env.QUIZ_DB_URI;

async function createIndexes() {
  try {
    console.log('📊 QuizDB 연결 중...');
    const quizDb = await mongoose.createConnection(QUIZ_DB_URI).asPromise();
    console.log('✅ QuizDB 연결 성공\n');

    const Quiz = quizDb.collection('quizzes');

    console.log('🔧 기존 인덱스 확인...');
    const existingIndexes = await Quiz.indexes();
    console.log('기존 인덱스:');
    existingIndexes.forEach((idx, i) => {
      console.log(`  ${i + 1}. ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    console.log('\n🔨 새 인덱스 생성 중...\n');

    // 1. 퀴즈 목록 조회용 복합 인덱스 (가장 중요! - 인기순)
    await Quiz.createIndex(
      { isComplete: 1, completedGameCount: -1, createdAt: -1 },
      { name: 'quiz_list_popular', background: true }
    );
    console.log('✅ 인덱스 생성: { isComplete: 1, completedGameCount: -1, createdAt: -1 }');

    // 2. 최신순 정렬용
    await Quiz.createIndex(
      { isComplete: 1, createdAt: -1 },
      { name: 'quiz_list_latest', background: true }
    );
    console.log('✅ 인덱스 생성: { isComplete: 1, createdAt: -1 }');

    // 3. 추천순 정렬용
    await Quiz.createIndex(
      { isComplete: 1, recommendationCount: -1, createdAt: -1 },
      { name: 'quiz_list_recommended', background: true }
    );
    console.log('✅ 인덱스 생성: { isComplete: 1, recommendationCount: -1, createdAt: -1 }');

    // 4. creatorId 검색용
    await Quiz.createIndex(
      { creatorId: 1, isComplete: 1, createdAt: -1 },
      { name: 'quiz_by_creator', background: true }
    );
    console.log('✅ 인덱스 생성: { creatorId: 1, isComplete: 1, createdAt: -1 }');

    console.log('\n🎉 모든 인덱스 생성 완료!\n');
    console.log('📊 최종 인덱스 목록:');
    const finalIndexes = await Quiz.indexes();
    finalIndexes.forEach((idx, i) => {
      console.log(`  ${i + 1}. ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    await quizDb.close();
    console.log('\n✅ 연결 종료');
    process.exit(0);
  } catch (err) {
    console.error('❌ 인덱스 생성 실패:', err);
    process.exit(1);
  }
}

createIndexes();
