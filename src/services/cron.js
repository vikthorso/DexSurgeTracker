import { Stats } from '../models/Stats.js';
import { runMonitor } from './monitor.js';
import { runTrendingCycle } from './trendingMonitor.js';

// --- Monitor Scheduler (existing token alerts) ---
let isRunning = false;
let isStopped = false;
let currentIntervalMs = 60000;

/**
 * Guarded scheduler: only schedules the next monitor cycle AFTER
 * the current one completes. This prevents overlapping monitor
 * cycles from starving the event loop and blocking Telegram updates.
 */
const scheduleNext = (bot) => {
  if (isStopped) return;

  setTimeout(async () => {
    if (isStopped) return;

    // Skip if the previous cycle is still running
    if (isRunning) {
      console.log('[Monitor] Previous cycle still running, skipping this tick...');
      scheduleNext(bot);
      return;
    }

    isRunning = true;
    try {
      await runMonitor(bot);
    } catch (err) {
      console.error('[Monitor] Top-level cycle error:', err.message);
    } finally {
      isRunning = false;
    }

    // Always schedule the next tick regardless of success/failure
    scheduleNext(bot);
  }, currentIntervalMs);
};

export const setupCron = async (bot) => {
  // Try to load interval from stats
  try {
    const stats = await Stats.findOne();
    if (stats && stats.globalIntervalMs) {
      currentIntervalMs = stats.globalIntervalMs;
    }
  } catch (err) {
    console.error('[Monitor] Error loading interval stats:', err.message);
  }

  isStopped = false;
  scheduleNext(bot);
  console.log(`[Monitor] Logic started with interval: ${currentIntervalMs / 1000}s`);
};

export const updateMonitorInterval = (bot, newIntervalMs) => {
  currentIntervalMs = newIntervalMs;
  // The next scheduled tick will use the updated interval
  console.log(`[Monitor] Interval updated to ${currentIntervalMs / 1000}s (effective next cycle)`);
};

/**
 * Stop the monitor scheduler (for graceful shutdown).
 */
export const stopMonitor = () => {
  isStopped = true;
  console.log('[Monitor] Scheduler stopped.');
};

// --- Trending Scheduler (CoinGecko niche discovery) ---
let trendingIsRunning = false;
let trendingIsStopped = false;
let trendingIntervalMs = 14400000; // 4 hours default

const scheduleTrending = (bot) => {
  if (trendingIsStopped) return;

  setTimeout(async () => {
    if (trendingIsStopped) return;

    if (trendingIsRunning) {
      console.log('[TrendingCron] Previous cycle still running, skipping this tick...');
      scheduleTrending(bot);
      return;
    }

    trendingIsRunning = true;
    try {
      await runTrendingCycle(bot);
    } catch (err) {
      console.error('[TrendingCron] Cycle error:', err.message);
    } finally {
      trendingIsRunning = false;
    }

    scheduleTrending(bot);
  }, trendingIntervalMs);
};

export const setupTrendingCron = async (bot) => {
  try {
    const stats = await Stats.findOne();
    if (stats && stats.trendingIntervalMs) {
      trendingIntervalMs = stats.trendingIntervalMs;
    }
  } catch (err) {
    console.error('[TrendingCron] Error loading interval:', err.message);
  }

  trendingIsStopped = false;
  scheduleTrending(bot);
  console.log(`[TrendingCron] Started with interval: ${trendingIntervalMs / 3600000}h`);
};

export const updateTrendingInterval = (newIntervalMs) => {
  trendingIntervalMs = newIntervalMs;
  console.log(`[TrendingCron] Interval updated to ${trendingIntervalMs / 3600000}h (effective next cycle)`);
};

export const stopTrending = () => {
  trendingIsStopped = true;
  console.log('[TrendingCron] Scheduler stopped.');
};
