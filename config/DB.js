// config/DB.js
require('dotenv').config();  // .env 파일 불러오기
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // 🚀 Flex 티어 최적화 설정
    const connectionOptions = {
      autoIndex: true, // 🔧 인덱스 자동 생성
      maxPoolSize: 20, // 🔧 연결 풀 크기 (100→20으로 감소, 안정성 향상)
      minPoolSize: 5,  // 🔧 최소 연결 유지 (20→5로 감소)
      serverSelectionTimeoutMS: 10000, // 🔧 서버 선택 타임아웃 (5초→10초로 증가)
      socketTimeoutMS: 60000, // 🔧 소켓 타임아웃 (30초→60초로 증가)
      connectTimeoutMS: 10000, // 🔧 초기 연결 타임아웃 (5초→10초로 증가)
      heartbeatFrequencyMS: 5000, // 🔧 하트비트 주기 (3초→5초로 조정)
      retryWrites: true, // 🔧 쓰기 작업 재시도
      retryReads: true, // 🔧 읽기 작업 재시도
      bufferCommands: true, // 🔧 버퍼링 활성화 (false→true로 변경, 연결 완료까지 쿼리 대기)
      maxIdleTimeMS: 60000, // 🔧 유휴 연결 타임아웃 (30초→60초로 증가)
      waitQueueTimeoutMS: 10000, // 🔧 연결 대기 큐 타임아웃 (2초→10초로 증가)
      compressors: ['zlib'], // 🔧 네트워크 압축
      maxConnecting: 5, // 🔧 동시 연결 시도 수 (10→5로 감소)
    };

    // 사용자 DB 연결
    const userDb = await mongoose.createConnection(process.env.USER_DB_URI, connectionOptions);
    console.log('✅ UserDB 연결 성공');

    // 퀴즈 DB 연결
    const quizDb = await mongoose.createConnection(process.env.QUIZ_DB_URI, connectionOptions);
    console.log('✅ QuizDB 연결 성공');

    // 🔄 연결 끊김 감지 및 재연결 처리
    userDb.on('disconnected', () => {
      console.warn('⚠️ UserDB 연결 끊김 - 재연결 시도 중...');
    });

    userDb.on('reconnected', () => {
      console.log('✅ UserDB 재연결 성공');
    });

    userDb.on('error', (err) => {
      console.error('❌ UserDB 에러:', err.message);
    });

    quizDb.on('disconnected', () => {
      console.warn('⚠️ QuizDB 연결 끊김 - 재연결 시도 중...');
    });

    quizDb.on('reconnected', () => {
      console.log('✅ QuizDB 재연결 성공');
    });

    quizDb.on('error', (err) => {
      console.error('❌ QuizDB 에러:', err.message);
    });

    return { userDb, quizDb };
  } catch (err) {
    console.error('❌ MongoDB 연결 오류:', err.message);
    console.error('상세:', err);
    process.exit(1);
  }
};

module.exports = connectDB;
