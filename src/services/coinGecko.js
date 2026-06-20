import axios from 'axios';

const BASE_URL = 'https://api.coingecko.com/api/v3';
const TIMEOUT = 30000; // 30s timeout to prevent hung requests

let lastCallTime = 0;
const MIN_CALL_INTERVAL = 2000; // 2s between calls (free tier: ~30/min, this is conservative)

/**
 * Rate-limit helper: waits if needed to maintain min interval between calls.
 */
const rateLimit = async () => {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < MIN_CALL_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_CALL_INTERVAL - elapsed));
  }
  lastCallTime = Date.now();
};

/**
 * Extracts a readable coin name from a CoinGecko image URL.
 * Example: "https://...coins/images/68773/small/pieverse.png" → "Pieverse"
 * If extraction fails, returns a cleaned fallback.
 */
const extractCoinSlug = (url) => {
  if (!url || typeof url !== 'string') return '?';
  try {
    // Match the filename slug before the extension
    // e.g. ".../small/pieverse.png" → "pieverse"
    const match = url.match(/\/small\/([^./]+)\.\w+$/);
    if (match) {
      const slug = match[1];
      // Capitalize first letter, handle hyphens -> spaces for readability
      return slug
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
    }
    // Fallback: try any path segment before an extension
    const fallback = url.match(/\/([^/]+)\.\w+$/);
    if (fallback) {
      return fallback[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
  } catch (e) { /* ignore */ }
  return '?';
};

/**
 * Fetches top trending coins from CoinGecko.
 * Endpoint: GET /search/trending
 *
 * Returns { success: true, coins: [...] } or { success: false, error: '...' }
 */
export const fetchTrendingCoins = async () => {
  try {
    await rateLimit();
    const response = await axios.get(`${BASE_URL}/search/trending`, {
      timeout: TIMEOUT
    });

    if (response.data && response.data.coins && Array.isArray(response.data.coins)) {
      const coins = response.data.coins.map(entry => {
        const item = entry.item;
        return {
          id: item.id,
          symbol: item.symbol,
          name: item.name,
          marketCapRank: item.market_cap_rank
        };
      });
      return { success: true, coins };
    }

    return { success: false, error: 'No trending coin data returned' };
  } catch (error) {
    console.error('[CoinGecko] Error fetching trending coins:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Fetches all category data sorted by 24h market cap change.
 * Endpoint: GET /coins/categories
 *
 * Returns { success: true, categories: [...] } or { success: false, error: '...' }
 * Each category includes top3Coins as readable slug strings (extracted from image URLs).
 */
export const fetchCategories = async () => {
  try {
    await rateLimit();
    const response = await axios.get(`${BASE_URL}/coins/categories`, {
      timeout: TIMEOUT
    });

    if (response.data && Array.isArray(response.data)) {
      const categories = response.data.map(cat => ({
        name: cat.name,
        marketCap: cat.market_cap || 0,
        marketCapChange24h: cat.market_cap_change_24h || 0,
        volume24h: cat.volume_24h || 0,
        top3Coins: (cat.top_3_coins || [])
          .map(extractCoinSlug)
          .filter(s => s && s !== '?')
      }));

      // Sort by market_cap_change_24h descending (most positive first)
      categories.sort((a, b) => b.marketCapChange24h - a.marketCapChange24h);

      return { success: true, categories };
    }

    return { success: false, error: 'No category data returned' };
  } catch (error) {
    console.error('[CoinGecko] Error fetching categories:', error.message);
    return { success: false, error: error.message };
  }
};
