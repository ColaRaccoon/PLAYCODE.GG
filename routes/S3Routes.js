const express = require('express');
const router = express.Router();
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-northeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'playcode-quiz-images';

// Presigned URL 발급 API
router.post('/presigned-url', async (req, res) => {
  try {
    const { folder, fileName, contentType } = req.body;

    if (!folder || !fileName) {
      return res.status(400).json({ error: '폴더명과 파일명이 필요합니다.' });
    }

    // 고유한 파일명 생성 (해시 추가)
    const hash = crypto.randomBytes(8).toString('hex');
    let extension = 'jpg';
    if (contentType === 'image/png') extension = 'png';
    else if (contentType === 'image/webp') extension = 'webp';
    const s3Key = `${folder}/${fileName}_${hash}.${extension}`;

    // Presigned URL 생성 (15분 유효)
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      ContentType: contentType || 'image/webp',
      CacheControl: 'max-age=31536000' // 1년 캐싱
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 }); // 15분

    // 업로드 후 접근할 파일 URL
    const fileUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-northeast-2'}.amazonaws.com/${s3Key}`;

    res.json({
      uploadUrl,
      fileUrl,
      s3Key
    });
  } catch (error) {
    console.error('❌ Presigned URL 생성 실패:', error);
    res.status(500).json({ error: 'Presigned URL 생성 실패' });
  }
});

module.exports = router;
