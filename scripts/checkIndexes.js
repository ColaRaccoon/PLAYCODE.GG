// MongoDB 인덱스 확인 및 쿼리 성능 테스트
require('dotenv').config();
const mongoose = require('mongoose');

const QUIZ_DB_URI = process.env.QUIZ_DB_URI;

async function checkPerformance() {
  try {
    console.log('📊 QuizDB 연결 중...');
    const quizDb = await mongoose.createConnection(QUIZ_DB_URI).asPromise();
    console.log('✅ QuizDB 연결 성공\n');

    const Quiz = quizDb.collection('quizzes');

    // 1. 현재 인덱스 확인
    console.log('📋 현재 인덱스 목록:');
    const indexes = await Quiz.indexes();
    indexes.forEach((idx, i) => {
      console.log(`  ${i + 1}. ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    // 2. 문서 개수 확인
    const totalCount = await Quiz.countDocuments({});
    const publicCount = await Quiz.countDocuments({ isComplete: true });
    console.log(`\n📊 전체 퀴즈: ${totalCount}개`);
    console.log(`📊 공개 퀴즈: ${publicCount}개\n`);

    // 3. 실제 쿼리 성능 테스트 (explain 사용)
    console.log('🔬 쿼리 성능 분석 중 (인기순 정렬)...\n');

    const t1 = Date.now();
    const result = await Quiz.find({ isComplete: true })
      .sort({ completedGameCount: -1, createdAt: -1 })
      .limit(20)
      .explain('executionStats');
    const t2 = Date.now();

    console.log('⏱️  쿼리 실행 시간:', `${t2 - t1}ms`);
    console.log('📊 검사한 문서 수:', result.executionStats.totalDocsExamined);
    console.log('📊 반환한 문서 수:', result.executionStats.nReturned);

    const winningPlan = result.queryPlanner.winningPlan;
    const indexName = winningPlan.inputStage?.indexName ||
                      winningPlan.stage === 'COLLSCAN' ? '❌ 없음 (전체 스캔!)' :
                      JSON.stringify(winningPlan);
    console.log('📊 사용된 인덱스:', indexName);

    if (result.executionStats.totalDocsExamined > result.executionStats.nReturned * 2) {
      console.log('\n⚠️  경고: 인덱스가 효율적으로 사용되지 않고 있습니다!');
      console.log('💡 원인: MongoDB가 잘못된 인덱스를 선택했거나 인덱스가 없습니다.');
      console.log('💡 해결: 필요 없는 인덱스를 삭제하고 올바른 인덱스만 유지하세요.');
    } else {
      console.log('\n✅ 인덱스가 정상적으로 사용되고 있습니다.');
    }

    // 4. 실제 데이터 크기 확인
    console.log('\n📦 데이터 크기 분석 중...');
    const sampleDocs = await Quiz.find({ isComplete: true })
      .limit(3)
      .toArray();

    if (sampleDocs.length > 0) {
      const avgSize = sampleDocs.reduce((sum, doc) => {
        return sum + JSON.stringify(doc).length;
      }, 0) / sampleDocs.length;

      console.log(`📦 평균 문서 크기: ${(avgSize / 1024).toFixed(2)} KB`);

      // titleImageBase64 크기 확인
      const hasImages = sampleDocs.filter(d => d.titleImageBase64).length;
      if (hasImages > 0) {
        const avgImageSize = sampleDocs
          .filter(d => d.titleImageBase64)
          .reduce((sum, doc) => sum + (doc.titleImageBase64?.length || 0), 0) / hasImages;
        console.log(`🖼️  평균 이미지 크기: ${(avgImageSize / 1024).toFixed(2)} KB`);
        console.log(`🖼️  18개 이미지 총 크기: ${(avgImageSize * 18 / 1024 / 1024).toFixed(2)} MB`);

        if (avgImageSize > 100000) {
          console.log('\n⚠️  경고: titleImageBase64가 크네요!');
          console.log(`💡 현재: ${(avgImageSize / 1024).toFixed(0)}KB → 목표: 50KB 이하`);
        }
      }
    }

    await quizDb.close();
    console.log('\n✅ 분석 완료');
    process.exit(0);
  } catch (err) {
    console.error('❌ 에러 발생:', err);
    process.exit(1);
  }
}

checkPerformance();
