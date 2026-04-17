import { runMonitor } from './monitor.js';
import { Stats } from '../models/Stats.js';

let monitorInterval;
let currentIntervalMs = 60000;

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

  startInterval(bot);
};

export const startInterval = (bot) => {
  if (monitorInterval) clearInterval(monitorInterval);
  
  monitorInterval = setInterval(() => {
    runMonitor(bot);
  }, currentIntervalMs);
  
  console.log(`[Monitor] Logic started with interval: ${currentIntervalMs / 1000}s`);
};

export const updateMonitorInterval = (bot, newIntervalMs) => {
  currentIntervalMs = newIntervalMs;
  startInterval(bot);
};
