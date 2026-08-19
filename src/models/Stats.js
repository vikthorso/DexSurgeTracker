import mongoose from 'mongoose';

const statsSchema = new mongoose.Schema({
  totalScans: { type: Number, default: 0 },
  globalAlerts: { type: Number, default: 0 },
  globalIntervalMs: { type: Number, default: 60000 },
  globalCooldownMs: { type: Number, default: 180000 },
  tokenDelayMs: { type: Number, default: 100 }, // Default 100ms between tokens
  alertStrategy: { type: String, enum: ['any', 'mcap', 'volume', 'both'], default: 'any' },
  liveTrackThreshold: { type: Number, default: 10 },
  liveConsecutiveThreshold: { type: Number, default: 2 },
  sentimentWindowHours: { type: Number, default: 4 },
  trendingIntervalMs: { type: Number, default: 14400000 }, // 4 hours

  // Stagnation & Crash Detection defaults
  stagnationWindowMs: { type: Number, default: 14400000 },      // 4 hours (configurable 1-48 hrs)
  stagnationPercent: { type: Number, default: 5 },              // 5% move from extreme
  stagnationCooldownMs: { type: Number, default: 3600000 },     // 1 hour between alerts

  // Crash detection
  crashPercentThreshold: { type: Number, default: 40 },         // 40% drop = crash (configurable 30-80%)
  crashWindowMs: { type: Number, default: 86400000 },           // 24 hours crash window (configurable 4-48 hrs)

  // Bounce confirmation (price-action based entry trigger)
  bounceConfirmPercent: { type: Number, default: 8 },           // 8% bounce from trough to confirm
  bounceConfirmMinScans: { type: Number, default: 3 },          // 3 consecutive scans above trough

  // Dead cat bounce master toggle
  deadCatBounceEnabled: { type: Boolean, default: true },

  // Dynamic account types for leverage strategy context — JSON array
  // Each object: { id, label, type (HLA/LLA), balance, leverage, capitalMax, capitalPct, goal }
  accountTypes: {
    type: String,
    default: JSON.stringify([
      {
        "id": "bybit",
        "label": "Day trading (Bybit)",
        "type": "HLA",
        "balance": 100,
        "leverage": 20,
        "capitalMax": 4,
        "capitalPct": 4,
        "goal": "maximum profit from top or bottom"
      },
      {
        "id": "mexc",
        "label": "Scalping (Mexc)",
        "type": "HLA",
        "balance": 500,
        "leverage": 20,
        "capitalMax": 50,
        "capitalPct": 10,
        "goal": "20% RIO for $5 daily, 1:1 tp:sl, trending market only, must go with the market"
      },
      {
        "id": "binance",
        "label": "Day trading (Binance)",
        "type": "LLA",
        "balance": 1000,
        "leverage": 5,
        "capitalMax": 100,
        "capitalPct": 10,
        "goal": "10-20% move (1-2x return)"
      }
    ])
  }
});

export const Stats = mongoose.model('Stats', statsSchema);
