import mongoose from 'mongoose';

const statsSchema = new mongoose.Schema({
  totalScans: { type: Number, default: 0 },
  globalAlerts: { type: Number, default: 0 },
  globalIntervalMs: { type: Number, default: 60000 },
  globalCooldownMs: { type: Number, default: 180000 },
  tokenDelayMs: { type: Number, default: 100 }, // Default 100ms between tokens
  alertStrategy: { type: String, enum: ['any', 'mcap', 'volume', 'both'], default: 'any' },
  liveTrackThreshold: { type: Number, default: 10 }
});

export const Stats = mongoose.model('Stats', statsSchema);
