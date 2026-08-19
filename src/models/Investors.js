import mongoose from 'mongoose';

const investorsSchema = new mongoose.Schema({
  tokenId: { type: String, required: true, unique: true }, // Format "chain:address" — links to Token.tokenId
  token: { type: mongoose.Schema.Types.ObjectId, ref: 'Token' },
  symbol: { type: String },
  name: { type: String },
  chain: { type: String },
  tokenAddress: { type: String },
  result: { type: String },
  marketCapAtResearch: { type: Number },
  model: { type: String, default: 'grok-4.6' }
}, { timestamps: true });

export const Investors = mongoose.model('Investors', investorsSchema);
