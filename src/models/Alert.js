import mongoose from 'mongoose';

const alertSchema = new mongoose.Schema({
  tokenId: { type: String, required: true },
  chain: { type: String, required: true },
  tokenAddress: { type: String, required: true },
  priceUsd: { type: String, required: true },
  marketCap: { type: Number, required: true },
  volumeM5: { type: Number, required: true },
  volumeH1: { type: Number, required: true },
  marketCapChange: { type: Number, required: true },
  volumeChange: { type: Number, required: true },
  triggerSource: { type: String, enum: ['m5', 'h1'], required: true },
  timestamp: { type: Date, default: Date.now }
});

export const Alert = mongoose.model('Alert', alertSchema);
