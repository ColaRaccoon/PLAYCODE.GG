// utils/emailService.js

const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
require('dotenv').config();

// AWS SES 클라이언트 설정
const sesClient = new SESClient({
  region: process.env.AWS_REGION || 'ap-northeast-2', // 서울 리전
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * 이메일 인증 코드 전송
 * @param {string} toEmail - 수신자 이메일
 * @param {string} verificationCode - 6자리 인증 코드
 * @returns {Promise<boolean>} 전송 성공 여부
 */
async function sendVerificationEmail(toEmail, verificationCode) {
  const params = {
    Source: process.env.AWS_SES_FROM_EMAIL, // 발신자 이메일 (SES에서 인증된 이메일)
    Destination: {
      ToAddresses: [toEmail],
    },
    Message: {
      Subject: {
        Data: '[PlayCode] 이메일 인증 코드',
        Charset: 'UTF-8',
      },
      Body: {
        Html: {
          Data: `
            <!DOCTYPE html>
            <html lang="ko">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>이메일 인증</title>
            </head>
            <body style="margin: 0; padding: 0; font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; background-color: #f4f4f4;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 40px 0;">
                <tr>
                  <td align="center">
                    <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                      <!-- 헤더 -->
                      <tr>
                        <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; text-align: center; border-radius: 12px 12px 0 0;">
                          <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold;">PlayCode</h1>
                          <p style="margin: 10px 0 0 0; color: #ffffff; font-size: 16px;">이메일 인증</p>
                        </td>
                      </tr>

                      <!-- 본문 -->
                      <tr>
                        <td style="padding: 40px;">
                          <h2 style="margin: 0 0 20px 0; color: #333333; font-size: 22px;">안녕하세요!</h2>
                          <p style="margin: 0 0 30px 0; color: #666666; font-size: 16px; line-height: 1.6;">
                            PlayCode 회원가입을 위한 이메일 인증 코드입니다.<br>
                            아래 인증 코드를 입력하여 이메일 인증을 완료해주세요.
                          </p>

                          <!-- 인증 코드 박스 -->
                          <table width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                              <td align="center" style="padding: 30px; background-color: #f8f9fa; border-radius: 8px;">
                                <p style="margin: 0 0 10px 0; color: #666666; font-size: 14px;">인증 코드</p>
                                <p style="margin: 0; color: #667eea; font-size: 36px; font-weight: bold; letter-spacing: 8px;">${verificationCode}</p>
                              </td>
                            </tr>
                          </table>

                          <p style="margin: 30px 0 0 0; color: #999999; font-size: 14px; line-height: 1.6;">
                            ⏱️ 이 인증 코드는 <strong>10분간 유효</strong>합니다.<br>
                            ⚠️ 본인이 요청하지 않은 경우, 이 이메일을 무시하셔도 됩니다.
                          </p>
                        </td>
                      </tr>

                      <!-- 푸터 -->
                      <tr>
                        <td style="padding: 30px; text-align: center; background-color: #f8f9fa; border-radius: 0 0 12px 12px;">
                          <p style="margin: 0; color: #999999; font-size: 12px;">
                            © 2025 PlayCode. All rights reserved.<br>
                            이 이메일은 발신 전용입니다.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </body>
            </html>
          `,
          Charset: 'UTF-8',
        },
      },
    },
  };

  try {
    const command = new SendEmailCommand(params);
    const response = await sesClient.send(command);
    console.log('이메일 전송 성공:', response.MessageId);
    return true;
  } catch (error) {
    console.error('이메일 전송 실패:', error);
    throw error;
  }
}

/**
 * 6자리 랜덤 인증 코드 생성
 * @returns {string} 6자리 숫자 코드
 */
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = {
  sendVerificationEmail,
  generateVerificationCode,
};
