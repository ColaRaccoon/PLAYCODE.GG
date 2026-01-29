// S3 이미지 업로드 유틸리티
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

// AWS S3 클라이언트 설정 (v3)
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-northeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'playcode-quiz-images';

/**
 * Base64 문자열을 Buffer로 변환
 */
function base64ToBuffer(base64String) {
  if (!base64String) return null;

  // 이미 URL이면 null 반환 (업로드 불필요)
  if (base64String.startsWith('http://') || base64String.startsWith('https://')) {
    return null;
  }

  // data:image/png;base64, 부분 제거
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(base64Data, 'base64');
}

/**
 * 이미지 타입 감지
 */
function detectImageType(base64String) {
  if (base64String.startsWith('data:image/png')) return 'png';
  if (base64String.startsWith('data:image/jpeg') || base64String.startsWith('data:image/jpg')) return 'jpeg';
  if (base64String.startsWith('data:image/gif')) return 'gif';
  if (base64String.startsWith('data:image/webp')) return 'webp';
  return 'webp'; // 기본값 (WebP로 변경)
}

/**
 * S3에 이미지 업로드
 * @param {string} base64String - Base64 인코딩된 이미지 문자열
 * @param {string} folder - S3 폴더 경로 (예: 'thumbnails', 'questions')
 * @param {string} fileName - 파일 이름 (확장자 제외)
 * @returns {Promise<string>} S3 URL
 */
async function uploadImageToS3(base64String, folder, fileName) {
  // Base64가 아니거나 이미 URL이면 그대로 반환
  if (!base64String) {
    return null;
  }

  if (base64String.startsWith('http://') || base64String.startsWith('https://')) {
    return base64String;
  }

  try {
    const buffer = base64ToBuffer(base64String);
    if (!buffer) {
      return base64String; // 변환 실패 시 원본 반환
    }

    const imageFormat = detectImageType(base64String);
    const hash = crypto.createHash('md5').update(buffer).digest('hex').substring(0, 8);
    const s3Key = `${folder}/${fileName}_${hash}.${imageFormat}`;

    const params = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: buffer,
      ContentType: `image/${imageFormat}`,
      CacheControl: 'max-age=31536000' // 1년 캐싱
    };

    const command = new PutObjectCommand(params);
    await s3Client.send(command);

    // S3 URL 생성
    const s3Url = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-northeast-2'}.amazonaws.com/${s3Key}`;
    return s3Url;
  } catch (error) {
    console.error(`❌ S3 업로드 실패:`, error);
    throw new Error(`S3 업로드 실패: ${error.message}`);
  }
}

/**
 * 퀴즈 썸네일 이미지 업로드
 * @param {string} base64String - Base64 인코딩된 이미지
 * @param {string} quizId - 퀴즈 ID
 * @returns {Promise<string>} S3 URL
 */
async function uploadQuizThumbnail(base64String, quizId) {
  return uploadImageToS3(base64String, 'thumbnails', quizId);
}

/**
 * 퀴즈 문제 이미지 업로드
 * @param {string} base64String - Base64 인코딩된 이미지
 * @param {string} quizId - 퀴즈 ID
 * @param {number} questionOrder - 문제 순서
 * @returns {Promise<string>} S3 URL
 */
async function uploadQuestionImage(base64String, quizId, questionOrder) {
  return uploadImageToS3(base64String, `questions/${quizId}`, `q${questionOrder}`);
}

/**
 * 퀴즈 정답 이미지 업로드
 * @param {string} base64String - Base64 인코딩된 이미지
 * @param {string} quizId - 퀴즈 ID
 * @param {number} questionOrder - 문제 순서
 * @returns {Promise<string>} S3 URL
 */
async function uploadAnswerImage(base64String, quizId, questionOrder) {
  return uploadImageToS3(base64String, `answers/${quizId}`, `a${questionOrder}`);
}

/**
 * S3에서 이미지 삭제 (선택적)
 * @param {string} s3Url - 삭제할 S3 URL
 * @returns {Promise<boolean>} 삭제 성공 여부
 */
async function deleteImageFromS3(s3Url) {
  if (!s3Url || !s3Url.includes(BUCKET_NAME)) {
    return false;
  }

  try {
    // URL에서 Key 추출
    const url = new URL(s3Url);
    const key = decodeURIComponent(url.pathname.substring(1)); // 앞의 '/' 제거

    const params = {
      Bucket: BUCKET_NAME,
      Key: key
    };

    const command = new DeleteObjectCommand(params);
    await s3Client.send(command);
    return true;
  } catch (error) {
    console.error(`❌ S3 삭제 실패:`, error);
    return false;
  }
}

/**
 * 프로필 이미지 업로드
 * @param {string} base64String - Base64 인코딩된 이미지
 * @param {string} userId - 사용자 ID
 * @returns {Promise<string>} S3 URL
 */
async function uploadProfileImage(base64String, userId) {
  return uploadImageToS3(base64String, 'profiles', userId);
}

/**
 * 퀴즈의 모든 이미지를 S3로 업로드
 * @param {Object} quizData - 퀴즈 데이터 (titleImageBase64, questions 포함)
 * @param {string} quizId - 퀴즈 ID
 * @returns {Promise<Object>} S3 URL로 변환된 퀴즈 데이터
 */
async function uploadQuizImagesToS3(quizData, quizId) {
  const updatedQuizData = { ...quizData };

  // 1. 썸네일 이미지 업로드
  if (updatedQuizData.titleImageBase64) {
    updatedQuizData.titleImageBase64 = await uploadQuizThumbnail(
      updatedQuizData.titleImageBase64,
      quizId
    );
  }

  // 2. 문제 이미지 업로드
  if (updatedQuizData.questions && Array.isArray(updatedQuizData.questions)) {
    for (let i = 0; i < updatedQuizData.questions.length; i++) {
      const question = updatedQuizData.questions[i];

      // 문제 이미지
      if (question.imageBase64) {
        question.imageBase64 = await uploadQuestionImage(
          question.imageBase64,
          quizId,
          question.order || i
        );
      }

      // 정답 이미지
      if (question.answerImageBase64) {
        question.answerImageBase64 = await uploadAnswerImage(
          question.answerImageBase64,
          quizId,
          question.order || i
        );
      }
    }
  }

  return updatedQuizData;
}

module.exports = {
  uploadImageToS3,
  uploadQuizThumbnail,
  uploadQuestionImage,
  uploadAnswerImage,
  uploadProfileImage,
  deleteImageFromS3,
  uploadQuizImagesToS3
};
