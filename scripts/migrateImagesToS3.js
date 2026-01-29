// Base64 이미지를 S3로 마이그레이션하는 스크립트
require('dotenv').config();
const mongoose = require('mongoose');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

const QUIZ_DB_URI = process.env.QUIZ_DB_URI;
const DRY_RUN = process.argv.includes('--dry-run'); // --dry-run 플래그로 테스트 모드 실행
const BATCH_SIZE = 5; // 한 번에 처리할 퀴즈 개수

// AWS S3 클라이언트 설정 (v3)
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-northeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'playcode-quiz-images';

// Base64를 Buffer로 변환
function base64ToBuffer(base64String) {
  // data:image/png;base64, 부분 제거
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(base64Data, 'base64');
}

// 이미지 타입 감지
function detectImageType(base64String) {
  if (base64String.startsWith('data:image/png')) return 'png';
  if (base64String.startsWith('data:image/jpeg') || base64String.startsWith('data:image/jpg')) return 'jpeg';
  if (base64String.startsWith('data:image/gif')) return 'gif';
  if (base64String.startsWith('data:image/webp')) return 'webp';
  return 'jpeg'; // 기본값
}

// S3에 이미지 업로드
async function uploadToS3(base64String, quizId, imageType = 'quiz') {
  if (!base64String || base64String.startsWith('http')) {
    return base64String; // 이미 URL이면 스킵
  }

  try {
    const buffer = base64ToBuffer(base64String);
    const imageFormat = detectImageType(base64String);
    const hash = crypto.createHash('md5').update(buffer).digest('hex').substring(0, 8);
    const fileName = `${imageType}/${quizId}/${hash}.${imageFormat}`;

    const params = {
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: buffer,
      ContentType: `image/${imageFormat}`,
      CacheControl: 'max-age=31536000' // 1년 캐싱
    };

    if (DRY_RUN) {
      console.log(`  [DRY-RUN] Would upload: ${fileName} (${(buffer.length / 1024).toFixed(2)} KB)`);
      return `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-northeast-2'}.amazonaws.com/${fileName}`;
    }

    const command = new PutObjectCommand(params);
    await s3Client.send(command);

    // S3 URL 생성
    const s3Url = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-northeast-2'}.amazonaws.com/${fileName}`;
    return s3Url;
  } catch (error) {
    console.error(`  ❌ S3 업로드 실패:`, error.message);
    throw error;
  }
}

// 퀴즈 마이그레이션
async function migrateQuiz(quiz, Quiz) {
  const updates = {};
  let changeCount = 0;

  console.log(`\n📦 퀴즈: ${quiz.title} (${quiz._id})`);

  // 1. 썸네일 이미지 마이그레이션
  if (quiz.titleImageBase64 && !quiz.titleImageBase64.startsWith('http')) {
    try {
      const s3Url = await uploadToS3(quiz.titleImageBase64, quiz._id, 'thumbnails');
      updates.titleImageBase64 = s3Url;
      changeCount++;
      console.log(`  ✅ 썸네일 이미지 업로드 완료`);
    } catch (error) {
      console.error(`  ❌ 썸네일 업로드 실패:`, error.message);
      return { success: false, error: error.message };
    }
  } else if (quiz.titleImageBase64?.startsWith('http')) {
    console.log(`  ⏭️  썸네일 이미지는 이미 S3에 있음 (스킵)`);
  }

  // 2. 문제 이미지 마이그레이션
  if (quiz.questions && quiz.questions.length > 0) {
    const updatedQuestions = [];

    for (let i = 0; i < quiz.questions.length; i++) {
      const question = quiz.questions[i];
      const updatedQuestion = { ...question };
      let questionChanged = false;

      // 문제 이미지
      if (question.imageBase64 && !question.imageBase64.startsWith('http')) {
        try {
          const s3Url = await uploadToS3(question.imageBase64, quiz._id, `questions/${question.order || i}`);
          updatedQuestion.imageBase64 = s3Url;
          changeCount++;
          questionChanged = true;
          console.log(`  ✅ 문제 ${question.order || i + 1} 이미지 업로드 완료`);
        } catch (error) {
          console.error(`  ❌ 문제 ${question.order || i + 1} 이미지 업로드 실패:`, error.message);
        }
      }

      // 정답 이미지
      if (question.answerImageBase64 && !question.answerImageBase64.startsWith('http')) {
        try {
          const s3Url = await uploadToS3(question.answerImageBase64, quiz._id, `answers/${question.order || i}`);
          updatedQuestion.answerImageBase64 = s3Url;
          changeCount++;
          questionChanged = true;
          console.log(`  ✅ 문제 ${question.order || i + 1} 정답 이미지 업로드 완료`);
        } catch (error) {
          console.error(`  ❌ 문제 ${question.order || i + 1} 정답 이미지 업로드 실패:`, error.message);
        }
      }

      updatedQuestions.push(updatedQuestion);
    }

    if (updatedQuestions.length > 0) {
      updates.questions = updatedQuestions;
    }
  }

  // 3. DB 업데이트
  if (changeCount > 0) {
    if (DRY_RUN) {
      console.log(`  [DRY-RUN] Would update ${changeCount} images in DB`);
    } else {
      try {
        await Quiz.findByIdAndUpdate(quiz._id, updates);
        console.log(`  💾 DB 업데이트 완료 (${changeCount}개 이미지)`);
      } catch (error) {
        console.error(`  ❌ DB 업데이트 실패:`, error.message);
        return { success: false, error: error.message };
      }
    }
    return { success: true, changedCount: changeCount };
  } else {
    console.log(`  ⏭️  변경사항 없음 (이미 마이그레이션 완료)`);
    return { success: true, changedCount: 0 };
  }
}

// 메인 마이그레이션 함수
async function migrateAllQuizzes() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Base64 → S3 이미지 마이그레이션 시작');
  if (DRY_RUN) {
    console.log('⚠️  DRY-RUN 모드: 실제로 변경하지 않습니다');
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // QuizDB 연결 (타임아웃 설정 추가)
    console.log('📡 QuizDB 연결 중...');
    const quizDb = await mongoose.createConnection(QUIZ_DB_URI, {
      serverSelectionTimeoutMS: 30000, // 30초
      socketTimeoutMS: 3600000, // 1시간 (충분히 길게)
      maxPoolSize: 10
    }).asPromise();
    console.log('✅ QuizDB 연결 성공\n');

    const Quiz = quizDb.model('Quiz', new mongoose.Schema({}, { strict: false }));

    // 🔥 2단계 조회: 먼저 ID와 썸네일만 가져오기 (빠름!)
    console.log('🔍 1단계: 퀴즈 목록 조회 중 (썸네일만)...');
    const allQuizzes = await Quiz.find({})
      .select('_id title titleImageBase64')
      .lean();

    console.log(`📊 총 ${allQuizzes.length}개 퀴즈 조회 완료`);
    console.log('🔍 2단계: Base64 이미지가 있는 퀴즈 찾는 중...');

    // 썸네일이 Base64인 퀴즈 ID 수집
    const quizIdsWithBase64Thumbnail = allQuizzes
      .filter(q => q.titleImageBase64 && q.titleImageBase64.startsWith('data:image'))
      .map(q => q._id);

    console.log(`  - 썸네일 Base64: ${quizIdsWithBase64Thumbnail.length}개 퀴즈`);

    // questions 배열에 Base64가 있는지 확인 (count만)
    console.log('🔍 3단계: 문제 이미지 Base64 확인 중...');
    const quizzesWithBase64Questions = await Quiz.countDocuments({
      $or: [
        { 'questions.imageBase64': { $exists: true, $ne: null, $ne: '' } },
        { 'questions.answerImageBase64': { $exists: true, $ne: null, $ne: '' } }
      ]
    });

    console.log(`  - 문제 이미지 포함: ${quizzesWithBase64Questions}개 퀴즈 (예상)`);

    // 실제로 questions 가져오기 (필요한 퀴즈만)
    console.log('🔍 4단계: 전체 데이터 조회 중...');
    const quizzesWithBase64 = await Quiz.find({
      $or: [
        { _id: { $in: quizIdsWithBase64Thumbnail } },
        { 'questions.imageBase64': { $exists: true, $ne: null, $ne: '' } },
        { 'questions.answerImageBase64': { $exists: true, $ne: null, $ne: '' } }
      ]
    }).lean();

    console.log(`📊 총 ${quizzesWithBase64.length}개 퀴즈에서 Base64 이미지 발견\n`);

    if (quizzesWithBase64.length === 0) {
      console.log('✅ 마이그레이션할 퀴즈가 없습니다!');
      await quizDb.close();
      return;
    }

    // 통계 변수
    let successCount = 0;
    let failedCount = 0;
    let totalImagesChanged = 0;
    const failedQuizzes = [];

    // 배치 처리
    for (let i = 0; i < quizzesWithBase64.length; i += BATCH_SIZE) {
      const batch = quizzesWithBase64.slice(i, i + BATCH_SIZE);

      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📦 배치 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(quizzesWithBase64.length / BATCH_SIZE)} (${i + 1}-${Math.min(i + BATCH_SIZE, quizzesWithBase64.length)}/${quizzesWithBase64.length})`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      for (const quiz of batch) {
        const result = await migrateQuiz(quiz, Quiz);

        if (result.success) {
          successCount++;
          totalImagesChanged += result.changedCount;
        } else {
          failedCount++;
          failedQuizzes.push({ id: quiz._id, title: quiz.title, error: result.error });
        }
      }

      // 다음 배치 전 1초 대기 (서버 부담 감소)
      if (i + BATCH_SIZE < quizzesWithBase64.length) {
        console.log('\n⏳ 1초 대기 중...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // 최종 결과 출력
    console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 마이그레이션 완료!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ 성공: ${successCount}개 퀴즈`);
    console.log(`❌ 실패: ${failedCount}개 퀴즈`);
    console.log(`🖼️  총 ${totalImagesChanged}개 이미지 마이그레이션 완료`);

    if (failedQuizzes.length > 0) {
      console.log('\n❌ 실패한 퀴즈 목록:');
      failedQuizzes.forEach(quiz => {
        console.log(`  - ${quiz.title} (${quiz.id}): ${quiz.error}`);
      });
    }

    if (DRY_RUN) {
      console.log('\n⚠️  DRY-RUN 모드였으므로 실제로 변경되지 않았습니다.');
      console.log('💡 실제 마이그레이션을 실행하려면 --dry-run 플래그 없이 실행하세요:');
      console.log('   node scripts/migrateImagesToS3.js');
    }

    console.log('\n✅ 마이그레이션 스크립트 종료');
    await quizDb.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 마이그레이션 중 치명적 오류 발생:', error);
    process.exit(1);
  }
}

// 스크립트 실행
migrateAllQuizzes();
