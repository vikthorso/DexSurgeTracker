import mongoose from 'mongoose';

const tokenSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  chain: { type: String, required: true },
  tokenAddress: { type: String, required: true },
  tokenId: { type: String, required: true, unique: true }, // Format "chain:address"
  name: { type: String },
  symbol: { type: String },
  marketCapThreshold: { type: Number, required: true },
  volumeThreshold: { type: Number, required: true },
  scanCount: { type: Number, default: 0 },
  startPrice: { type: Number },
  startMarketCap: { type: Number },
  startVolumeH1: { type: Number },
  lastMarketCap: { type: Number, default: 0 },
  lastVolumeM5: { type: Number, default: 0 },
  lastVolumeH1: { type: Number, default: 0 },
  lastAlertAt: { type: Date, default: null },
  cooldownMs: { type: Number, default: 180000 }, // 3 minutes
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

export const Token = mongoose.model('Token', tokenSchema);
