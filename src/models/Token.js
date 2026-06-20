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
  isActive: { type: Boolean, default: true },
  isLiveTracking: { type: Boolean, default: false },
  lastLiveMc: { type: Number, default: 0 },
  livePeakMc: { type: Number, default: 0 },
  liveTroughMc: { type: Number, default: 0 },
  lastLiveMessageId: { type: Number },
  liveConsecutiveCount: { type: Number, default: 0 },
  liveConsecutiveType: { type: String, enum: ['bullish', 'bearish', null], default: null },
  lastReportedType: { type: String, enum: ['bullish', 'bearish', null], default: null },

  // --- Stagnation & Crash Detection ---

  // Rolling high tracking (MC + price captured together at the extreme)
  stagnationHighMc: { type: Number, default: 0 },
  stagnationHighPrice: { type: Number, default: 0 },
  stagnationHighTime: { type: Date, default: null },

  // Rolling low tracking (MC + price captured together at the extreme)
  stagnationLowMc: { type: Number, default: 0 },
  stagnationLowPrice: { type: Number, default: 0 },
  stagnationLowTime: { type: Date, default: null },

  // Crash detection state machine
  crashState: {
    type: String,
    enum: [null, 'monitoring', 'wave1', 'wave1_failed', 'wave2', 'completed'],
    default: null
  },
  crashPeakMc: { type: Number, default: 0 },
  crashPeakPrice: { type: Number, default: 0 },
  crashTroughMc: { type: Number, default: 0 },
  crashTroughPrice: { type: Number, default: 0 },
  crashDetectedAt: { type: Date, default: null },

  // Bounce confirmation tracking (price-action based, not clock-based)
  bounceConfirmationScans: { type: Number, default: 0 },

  // Dead cat bounce wave tracking
  deadCatWave1EntryMc: { type: Number, default: 0 },
  deadCatWave1EntryPrice: { type: Number, default: 0 },
  deadCatWave1TargetMc: { type: Number, default: 0 },
  deadCatWave1TargetPrice: { type: Number, default: 0 },
  deadCatWave1TpHit: { type: Boolean, default: false },

  // General stagnation alert cooldown
  stagnationAlertedAt: { type: Date, default: null },
  stagnationLastType: { type: String, enum: ['long', 'short', null], default: null },

  // Per-token stagnation toggle
  isStagnationTracking: { type: Boolean, default: false }
}, { timestamps: true });

export const Token = mongoose.model('Token', tokenSchema);
