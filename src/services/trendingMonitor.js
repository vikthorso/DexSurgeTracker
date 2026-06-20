import { Markup } from 'telegraf';
import { Stats } from '../models/Stats.js';
import { TrendingSnapshot } from '../models/TrendingSnapshot.js';
import { fetchCategories } from './coinGecko.js';

const TRENDING_N = 10;
const FALLING_N = 10;
let manualCooldownUntil = null;
const MANUAL_COOLDOWN_MS = 120000;

// Simple in-memory cache: chatId -> { data, ts }
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 min

/**
 * Escapes HTML special characters so category/coin names don't break parsing.
 */
const esc = (text) => {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
};

/**
 * Formats a category line: <b>Name</b> (+12.3%) with optional top coins.
 */
const formatCategoryLine = (cat, showSign = true) => {
  const sign = showSign && cat.marketCapChange24h > 0 ? '+' : '';
  let line = `<b>${esc(cat.name)}</b>  ${sign}${cat.marketCapChange24h}%`;
  if (cat.top3Coins && cat.top3Coins.length > 0) {
    line += `\n     <i>${cat.top3Coins.slice(0, 3).map(esc).join(', ')}</i>`;
  }
  return line;
};

/**
 * Format a niche change line (for new/fallen-off).
 */
const formatNicheLine = (niche, prefix) => {
  const sign = niche.change > 0 ? '+' : '';
  return `${prefix} <b>${esc(niche.name)}</b>  ${sign}${niche.change}%`;
};

/**
 * Fetches CoinGecko data, analyses it, caches it, and returns the structured result.
 * Does NOT send any messages — that's the caller's job.
 */
const getTrendingData = async () => {
  console.log('[Trending] Fetching CoinGecko category data...');

  const categoriesResult = await fetchCategories();
  if (!categoriesResult.success) {
    return { success: false, error: 'Unable to fetch trending data right now.' };
  }

  const allCategories = categoriesResult.categories;

  // Split into bullish (gainers) and bearish (losers)
  const bullish = allCategories
    .filter(c => c.marketCapChange24h > 0)
    .slice(0, TRENDING_N)
    .map(c => ({
      name: c.name,
      marketCap: c.marketCap,
      marketCapChange24h: Math.round(c.marketCapChange24h * 10) / 10,
      top3Coins: c.top3Coins || []
    }));

  const negatives = allCategories.filter(c => c.marketCapChange24h < 0);
  const bearish = negatives
    .slice(-FALLING_N)
    .reverse()
    .map(c => ({
      name: c.name,
      marketCap: c.marketCap,
      marketCapChange24h: Math.round(c.marketCapChange24h * 10) / 10,
      top3Coins: c.top3Coins || []
    }));

  // Diff against previous snapshot
  const prevSnapshot = await TrendingSnapshot.findOne().sort({ fetchedAt: -1 });

  let newNiches = [];
  let fallenOffNiches = [];

  if (prevSnapshot) {
    const prevNames = new Set(prevSnapshot.trendingCategories.map(c => c.name));
    const currNames = new Set(bullish.map(c => c.name));
    newNiches = bullish.filter(c => !prevNames.has(c.name)).map(c => ({ name: c.name, change: c.marketCapChange24h }));
    fallenOffNiches = prevSnapshot.trendingCategories
      .filter(c => !currNames.has(c.name))
      .map(c => ({ name: c.name, change: c.marketCapChange24h }));
  }

  // Store snapshot
  const now = new Date();
  const snapshot = new TrendingSnapshot({
    fetchedAt: now,
    trendingCategories: bullish,
    risingCategories: bullish,
    fallingCategories: bearish,
    totalTrendingCoins: allCategories.length
  });
  await snapshot.save();

  // Cleanup old snapshots
  const excessSnapshots = await TrendingSnapshot.countDocuments() - 180;
  if (excessSnapshots > 0) {
    const old = await TrendingSnapshot.find().sort({ fetchedAt: 1 }).limit(excessSnapshots);
    if (old.length > 0) {
      await TrendingSnapshot.deleteMany({ _id: { $in: old.map(s => s._id) } });
    }
  }

  const stats = await Stats.findOne();
  const intervalLabel = stats?.trendingIntervalMs
    ? `${stats.trendingIntervalMs / 3600000}h`
    : '4h';

  console.log('[Trending] Data fetched and analysed.');

  return {
    success: true,
    bullish,
    bearish,
    newNiches,
    fallenOffNiches,
    intervalLabel,
    fetchedAt: now
  };
};

// ── PUBLIC API ────────────────────────────────────────────────────────

/**
 * Sends the "Choose direction" prompt with two inline buttons.
 * Data is fetched (or served from cache) and stored in cache keyed by chatId.
 */
export const showTrendingMenu = async (bot, chatId) => {
  const now = Date.now();
  const cached = cache.get(chatId);

  let data;
  if (cached && (now - cached.ts) < CACHE_TTL) {
    data = cached.data;
  } else {
    data = await getTrendingData();
    cache.set(chatId, { data, ts: now });
  }

  if (!data.success) {
    await bot.telegram.sendMessage(chatId, data.error);
    return;
  }

  const timeStr = data.fetchedAt.toLocaleString();
  const message = `<b>🌊 TRENDING NICHES</b>\n` +
    `<i>${esc(timeStr)}</i>\n\n` +
    `Choose a direction to view:\n` +
    `📈 <b>Bullish</b> — top rising niches\n` +
    `📉 <b>Bearish</b> — top falling niches`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(`📈 Bullish (${data.bullish.length})`, 'trending_bullish'),
      Markup.button.callback(`📉 Bearish (${data.bearish.length})`, 'trending_bearish')
    ],
    [Markup.button.callback('🔄 Refresh Now', 'trending_refresh')],
    [Markup.button.callback('🗑 Dismiss', 'dismiss')]
  ]);

  await bot.telegram.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: keyboard.reply_markup
  });
};

/**
 * Sends the BULLISH (rising niches) report to the given chat.
 * Reads from cache; falls back to fresh fetch if cache is missing.
 */
export const sendBullishReport = async (bot, chatId) => {
  const cached = cache.get(chatId);
  let data = cached?.data;
  if (!data || !data.success) {
    data = await getTrendingData();
    cache.set(chatId, { data, ts: Date.now() });
  }
  if (!data.success) {
    await bot.telegram.sendMessage(chatId, data.error);
    return;
  }

  let report = `<b>📈 BULLISH NICHES</b>\n`;
  report += `<i>Top rising categories by 24h market cap change</i>\n\n`;

  if (data.bullish.length > 0) {
    for (const cat of data.bullish) {
      report += formatCategoryLine(cat, true) + '\n\n';
    }
  } else {
    report += `⚪ No bullish niches right now\n\n`;
  }

  if (data.newNiches.length > 0) {
    report += `<b>🆕 New on the radar:</b>\n`;
    for (const n of data.newNiches) {
      report += formatNicheLine(n, '🆕') + '\n';
    }
    report += '\n';
  }

  report += `<i>Next auto-update in ~${data.intervalLabel}</i>`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Refresh Now', 'trending_refresh')],
    [Markup.button.callback('🗑 Dismiss', 'dismiss')]
  ]);

  await bot.telegram.sendMessage(chatId, report, {
    parse_mode: 'HTML',
    reply_markup: keyboard.reply_markup
  });
};

/**
 * Sends the BEARISH (falling niches) report to the given chat.
 */
export const sendBearishReport = async (bot, chatId) => {
  const cached = cache.get(chatId);
  let data = cached?.data;
  if (!data || !data.success) {
    data = await getTrendingData();
    cache.set(chatId, { data, ts: Date.now() });
  }
  if (!data.success) {
    await bot.telegram.sendMessage(chatId, data.error);
    return;
  }

  let report = `<b>📉 BEARISH NICHES</b>\n`;
  report += `<i>Top falling categories by 24h market cap change</i>\n\n`;

  if (data.bearish.length > 0) {
    for (const cat of data.bearish) {
      report += formatCategoryLine(cat, false) + '\n\n';
    }
  } else {
    report += `⚪ No bearish niches right now\n\n`;
  }

  if (data.fallenOffNiches.length > 0) {
    report += `<b>⬇️ Fallen off since last snapshot:</b>\n`;
    for (const n of data.fallenOffNiches) {
      report += formatNicheLine(n, '⬇️') + '\n';
    }
    report += '\n';
  }

  report += `<i>Next auto-update in ~${data.intervalLabel}</i>`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Refresh Now', 'trending_refresh')],
    [Markup.button.callback('🗑 Dismiss', 'dismiss')]
  ]);

  await bot.telegram.sendMessage(chatId, report, {
    parse_mode: 'HTML',
    reply_markup: keyboard.reply_markup
  });
};

// ── SCHEDULER WRAPPER ─────────────────────────────────────────────────

/**
 * Called by the 4h cron scheduler. Fetches data and invalidates caches.
 * The cron does NOT auto-send to TG — it just keeps the data fresh.
 */
export const runTrendingCycle = async (_bot) => {
  const data = await getTrendingData();
  if (data.success) {
    // Invalidate all caches so next manual request fetches fresh data
    cache.clear();
    // Store fresh data under the authorized chat ID so the cron report
    // can be viewed on demand (optional — currently no auto-send)
  }
};

/**
 * Manual trigger (from /trending) — shows the menu with buttons.
 */
export const manualTrending = async (bot, chatId) => {
  const now = Date.now();
  if (manualCooldownUntil && now < manualCooldownUntil) {
    const remaining = Math.ceil((manualCooldownUntil - now) / 1000);
    await bot.telegram.sendMessage(
      chatId,
      `⏳ Please wait ${remaining}s before refreshing again.`
    );
    return;
  }
  manualCooldownUntil = now + MANUAL_COOLDOWN_MS;
  await showTrendingMenu(bot, chatId);
};
