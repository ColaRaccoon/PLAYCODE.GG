const GameSession = require('../models/GameSession');

async function getSession(quizDb, sessionId) {
  const GameSessionModel = GameSession(quizDb);
  return await GameSessionModel.findById(sessionId);
}

async function getValidSession(quizDb, sessionId, options = {}) {
  const session = await getSession(quizDb, sessionId);
  if (!session) return null;

  if (options.mustBeActive && !session.isActive) return null;
  if (options.mustNotBeStarted && session.started) return null;

  return session;
}

module.exports = { getSession, getValidSession };
