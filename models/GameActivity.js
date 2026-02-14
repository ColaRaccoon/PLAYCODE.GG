const mongoose = require('mongoose');

const gameActivitySchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['session_created', 'session_joined', 'game_completed']
  },
  ip: {
    type: String,
    default: null
  },
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

// TTL: keep data for up to 366 days so 365-day stats are queryable.
gameActivitySchema.index({ timestamp: 1 }, { expireAfterSeconds: 366 * 24 * 60 * 60 });

// Compound index for activity type filtering within a period.
gameActivitySchema.index({ type: 1, timestamp: 1 });

module.exports = (connection) => {
  return connection.model('GameActivity', gameActivitySchema);
};
