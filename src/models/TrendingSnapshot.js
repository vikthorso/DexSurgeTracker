import mongoose from 'mongoose';

const trendingSnapshotSchema = new mongoose.Schema({
  fetchedAt: { type: Date, default: Date.now, index: true },

  // Trending niches (top gainers by 24h mcap change)
  trendingCategories: [{
    name: { type: String, required: true },
    marketCap: { type: Number },
    marketCapChange24h: { type: Number },               // percentage
    top3Coins: [{ type: String }],                      // top 3 coin slug names
    // Legacy fields from the old ratio-based approach — kept optional for existing docs
    coinCount: { type: Number },
    ratio: { type: Number },
    coins: [{ type: String }]
  }],

  // Rising categories (alias, same structure)
  risingCategories: [{
    name: { type: String, required: true },
    marketCap: { type: Number },
    marketCapChange24h: { type: Number },               // percentage
    top3Coins: [{ type: String }]                       // top 3 coin slug names
  }],

  // Falling categories (top losers by 24h mcap change)
  fallingCategories: [{
    name: { type: String, required: true },
    marketCap: { type: Number },
    marketCapChange24h: { type: Number },               // percentage
    top3Coins: [{ type: String }]                       // top 3 coin slug names
  }],

  totalTrendingCoins: { type: Number, default: 0 }
}, { timestamps: true });

export const TrendingSnapshot = mongoose.model('TrendingSnapshot', trendingSnapshotSchema);
