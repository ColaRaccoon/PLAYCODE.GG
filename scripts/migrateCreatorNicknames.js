// 기존 퀴즈에 creatorNickname 필드를 채우는 마이그레이션 스크립트
// 사용법: node scripts/migrateCreatorNicknames.js

const mongoose = require('mongoose');
require('dotenv').config();

async function migrateCreatorNicknames() {
  let quizDbConnection = null;
  let userDbConnection = null;

  try {
    // MongoDB 연결
    quizDbConnection = await mongoose.createConnection(process.env.QUIZ_DB_URI).asPromise();
    userDbConnection = await mongoose.createConnection(process.env.USER_DB_URI).asPromise();
    console.log('✅ DB 연결 성공');

    // 모델 로드
    const Quiz = require('../models/Quiz')(quizDbConnection);
    const User = require('../models/User')(userDbConnection);

    // creatorNickname이 없는 공개 퀴즈만 조회
    const quizzesWithoutNickname = await Quiz.find({
      isComplete: true,
      $or: [
        { creatorNickname: null },
        { creatorNickname: { $exists: false } }
      ]
    }).select('_id title creatorId').lean();

    console.log(`📊 업데이트할 퀴즈 수: ${quizzesWithoutNickname.length}`);

    if (quizzesWithoutNickname.length === 0) {
      console.log('✅ 모든 퀴즈에 creatorNickname이 이미 설정되어 있습니다.');
      await quizDbConnection.close();
      await userDbConnection.close();
      process.exit(0);
      return;
    }

    // 고유한 creatorId 목록 추출 (seized 제외)
    const creatorIds = [...new Set(
      quizzesWithoutNickname
        .map(q => q.creatorId?.toString ? q.creatorId.toString() : q.creatorId)
        .filter(id => id !== 'seized' && id != null)
    )];

    console.log(`👥 조회할 사용자 수: ${creatorIds.length}`);

    // User DB에서 닉네임 일괄 조회
    const creators = await User.find({ _id: { $in: creatorIds } })
      .select('_id nickname')
      .lean();

    console.log(`✅ User DB에서 ${creators.length}명의 닉네임 조회 완료`);

    // creatorId -> nickname 매핑
    const creatorMap = new Map(creators.map(c => [c._id.toString(), c.nickname]));

    // 각 퀴즈 업데이트
    let updated = 0;
    let errors = 0;

    for (const quiz of quizzesWithoutNickname) {
      try {
        const creatorIdStr = quiz.creatorId?.toString ? quiz.creatorId.toString() : quiz.creatorId;
        let nickname;

        if (creatorIdStr === 'seized') {
          nickname = '관리자';
        } else {
          nickname = creatorMap.get(creatorIdStr) || '알 수 없음';
        }

        await Quiz.findByIdAndUpdate(quiz._id, {
          $set: { creatorNickname: nickname }
        });

        updated++;

        if (updated % 100 === 0) {
          console.log(`   진행 중... ${updated}/${quizzesWithoutNickname.length}`);
        }
      } catch (err) {
        console.error(`❌ 퀴즈 ${quiz._id} 업데이트 실패:`, err.message);
        errors++;
      }
    }

    console.log('\n📊 마이그레이션 결과:');
    console.log(`   - 성공: ${updated}개`);
    console.log(`   - 실패: ${errors}개`);

    await quizDbConnection.close();
    await userDbConnection.close();
    console.log('\n✅ 마이그레이션 완료');
    process.exit(0);

  } catch (error) {
    console.error('❌ 마이그레이션 실패:', error);
    if (quizDbConnection) await quizDbConnection.close();
    if (userDbConnection) await userDbConnection.close();
    process.exit(1);
  }
}

migrateCreatorNicknames();
