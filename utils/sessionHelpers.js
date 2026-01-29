// utils/sessionHelpers.js
const { ObjectId } = require('mongoose').Types;

async function safeFindSessionById(GameSession, sessionId) {
  if (!ObjectId.isValid(sessionId)) return null;

  try {
    return await GameSession.findById(sessionId);
  } catch (err) {
    console.error('❌ GameSession 조회 실패:', err.message);
    return null;
  }
}

async function safeSaveSession(session) {
  if (!session) return false;

  try {
    await session.save();
    return true;
  } catch (err) {
    console.error('❌ GameSession 저장 실패:', err.message);
    return false;
  }
}

module.exports = { safeFindSessionById, safeSaveSession, };