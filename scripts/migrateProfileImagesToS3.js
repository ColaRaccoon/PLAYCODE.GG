// 프로필 Base64 이미지를 S3로 마이그레이션하는 스크립트
require('dotenv').config();
const mongoose = require('mongoose');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

const USER_DB_URI = process.env.USER_DB_URI;
const DRY_RUN = process.argv.includes('--dry-run'); // --dry-run 플래그로 테스트 모드 실행
const BATCH_SIZE = 10; // 한 번에 처리할 사용자 개수

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
async function uploadToS3(base64String, userId) {
  if (!base64String || base64String.startsWith('http')) {
    return base64String; // 이미 URL이면 스킵
  }

  try {
    const buffer = base64ToBuffer(base64String);
    const imageFormat = detectImageType(base64String);
    const hash = crypto.createHash('md5').update(buffer).digest('hex').substring(0, 8);
    const fileName = `profiles/${userId}_${hash}.${imageFormat}`;

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

// 사용자 프로필 마이그레이션
async function migrateUserProfile(user, User) {
  console.log(`\n👤 사용자: ${user.nickname} (${user._id})`);

  if (!user.profileImage) {
    console.log(`  ⏭️  프로필 이미지 없음 (스킵)`);
    return { success: true, changedCount: 0 };
  }

  if (user.profileImage.startsWith('http')) {
    console.log(`  ⏭️  프로필 이미지는 이미 URL (스킵)`);
    return { success: true, changedCount: 0 };
  }

  if (!user.profileImage.startsWith('data:image')) {
    console.log(`  ⏭️  프로필 이미지가 Base64가 아님 (스킵)`);
    return { success: true, changedCount: 0 };
  }

  try {
    const s3Url = await uploadToS3(user.profileImage, user._id);

    if (DRY_RUN) {
      console.log(`  [DRY-RUN] Would update profileImage in DB`);
    } else {
      await User.findByIdAndUpdate(user._id, { profileImage: s3Url });
      console.log(`  ✅ 프로필 이미지 업로드 완료`);
    }

    return { success: true, changedCount: 1 };
  } catch (error) {
    console.error(`  ❌ 프로필 이미지 업로드 실패:`, error.message);
    return { success: false, error: error.message };
  }
}

// 메인 마이그레이션 함수
async function migrateAllProfiles() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 프로필 Base64 → S3 이미지 마이그레이션 시작');
  if (DRY_RUN) {
    console.log('⚠️  DRY-RUN 모드: 실제로 변경하지 않습니다');
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // UserDB 연결
    console.log('📡 UserDB 연결 중...');
    const userDb = await mongoose.createConnection(USER_DB_URI, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 3600000,
      maxPoolSize: 10
    }).asPromise();
    console.log('✅ UserDB 연결 성공\n');

    const User = userDb.model('User', new mongoose.Schema({}, { strict: false }));

    // 프로필 이미지가 있는 사용자 조회
    console.log('🔍 프로필 이미지가 있는 사용자 조회 중...');
    const usersWithProfileImage = await User.find({
      profileImage: { $exists: true, $ne: null, $ne: '' }
    })
      .select('_id nickname profileImage')
      .lean();

    console.log(`📊 총 ${usersWithProfileImage.length}명의 사용자에게 프로필 이미지가 있음\n`);

    // Base64 프로필 이미지만 필터링
    const usersWithBase64 = usersWithProfileImage.filter(user =>
      user.profileImage && user.profileImage.startsWith('data:image')
    );

    console.log(`📊 총 ${usersWithBase64.length}명의 사용자가 Base64 프로필 이미지 사용 중\n`);

    if (usersWithBase64.length === 0) {
      console.log('✅ 마이그레이션할 프로필 이미지가 없습니다!');
      await userDb.close();
      return;
    }

    // 통계 변수
    let successCount = 0;
    let failedCount = 0;
    let totalImagesChanged = 0;
    const failedUsers = [];

    // 배치 처리
    for (let i = 0; i < usersWithBase64.length; i += BATCH_SIZE) {
      const batch = usersWithBase64.slice(i, i + BATCH_SIZE);

      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📦 배치 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(usersWithBase64.length / BATCH_SIZE)} (${i + 1}-${Math.min(i + BATCH_SIZE, usersWithBase64.length)}/${usersWithBase64.length})`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      for (const user of batch) {
        const result = await migrateUserProfile(user, User);

        if (result.success) {
          successCount++;
          totalImagesChanged += result.changedCount;
        } else {
          failedCount++;
          failedUsers.push({ id: user._id, nickname: user.nickname, error: result.error });
        }
      }

      // 다음 배치 전 1초 대기
      if (i + BATCH_SIZE < usersWithBase64.length) {
        console.log('\n⏳ 1초 대기 중...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // 최종 결과 출력
    console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 마이그레이션 완료!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ 성공: ${successCount}명`);
    console.log(`❌ 실패: ${failedCount}명`);
    console.log(`🖼️  총 ${totalImagesChanged}개 프로필 이미지 마이그레이션 완료`);

    if (failedUsers.length > 0) {
      console.log('\n❌ 실패한 사용자 목록:');
      failedUsers.forEach(user => {
        console.log(`  - ${user.nickname} (${user.id}): ${user.error}`);
      });
    }

    if (DRY_RUN) {
      console.log('\n⚠️  DRY-RUN 모드였으므로 실제로 변경되지 않았습니다.');
      console.log('💡 실제 마이그레이션을 실행하려면 --dry-run 플래그 없이 실행하세요:');
      console.log('   node scripts/migrateProfileImagesToS3.js');
    }

    console.log('\n✅ 마이그레이션 스크립트 종료');
    await userDb.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 마이그레이션 중 치명적 오류 발생:', error);
    process.exit(1);
  }
}

// 스크립트 실행
migrateAllProfiles();
