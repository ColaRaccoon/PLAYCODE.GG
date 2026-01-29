const mongoose = require('mongoose');
const { Schema } = mongoose;

const messageSchema = new Schema({
  nickname: { type: String, required: true },
  message: String,
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const chatSchema = new Schema({
  sessionId: { type: Schema.Types.ObjectId, required: true, unique: true },
  messages: [messageSchema],
  createdAt: { type: Date, default: Date.now, index: { expires: '12h' } },
});

module.exports = (quizDb) => quizDb.model('ChatLog', chatSchema, 'chat_logs');