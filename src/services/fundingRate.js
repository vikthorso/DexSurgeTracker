import axios from 'axios';

const TIMEOUT = 4000;
const TTL_MS = 60000;
const cache = new Map();

const normalize = (s) => (s || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const parseRate = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

const nextBoundary = (intervalHours, now = Date.now()) => {
  const intervalMs = intervalHours * 3600000;
  return now - (now % intervalMs) + intervalMs;
};

const fetchBybit = async (symbol) => {
  const { data } = await axios.get('https://api.bybit.com/v5/market/tickers', {
    params: { category: 'linear', symbol: `${symbol}USDT` },
    timeout: TIMEOUT
  });
  const ticker = data?.result?.list?.[0];
  if (!ticker) return null;
  const rate = parseRate(ticker.fundingRate);
  if (rate === null) return null;
  return {
    rate,
    nextFundingTime: ticker.nextFundingTime ? parseInt(ticker.nextFundingTime) : null,
    intervalHours: 8
  };
};

const fetchMexc = async (symbol) => {
  const { data } = await axios.get('https://contract.mexc.com/api/v1/contract/ticker', {
    params: { symbol: `${symbol}_USDT` },
    timeout: TIMEOUT
  });
  if (!data?.success || !data?.data) return null;
  const rate = parseRate(data.data.fundingRate);
  if (rate === null) return null;
  return {
    rate,
    nextFundingTime: nextBoundary(8),
    intervalHours: 8
  };
};

const fetchBinance = async (symbol) => {
  const { data } = await axios.get('https://fapi.binance.com/fapi/v1/premiumIndex', {
    params: { symbol: `${symbol}USDT` },
    timeout: TIMEOUT
  });
  const rate = parseRate(data?.lastFundingRate);
  if (rate === null) return null;
  return {
    rate,
    nextFundingTime: data.nextFundingTime ? parseInt(data.nextFundingTime) : null,
    intervalHours: 8
  };
};

const fetchHyperliquid = async (symbol) => {
  const { data } = await axios.post('https://api.hyperliquid.xyz/info', { type: 'metaAndAssetCtxs' }, { timeout: TIMEOUT });
  if (!Array.isArray(data) || data.length !== 2) return null;
  const [universe, assetCtxs] = data;
  if (!Array.isArray(universe) || !Array.isArray(assetCtxs)) return null;
  const index = universe.findIndex((u) => u.name === symbol);
  if (index === -1 || !assetCtxs[index]) return null;
  const rate = parseRate(assetCtxs[index].funding);
  if (rate === null) return null;
  return { rate, nextFundingTime: null, intervalHours: 1 };
};

const ADAPTERS = [
  { key: 'bybit', name: 'Bybit', fetch: fetchBybit },
  { key: 'mexc', name: 'MEXC', fetch: fetchMexc },
  { key: 'binance', name: 'Binance', fetch: fetchBinance },
  { key: 'hyperliquid', name: 'Hyperliquid', fetch: fetchHyperliquid }
];

const getCached = (key) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.value;
  return undefined;
};

export const getFundingRate = async (symbol) => {
  const sym = normalize(symbol);
  if (!sym) return null;

  const cached = getCached(sym);
  if (cached !== undefined) return cached;

  for (const adapter of ADAPTERS) {
    try {
      const result = await adapter.fetch(sym);
      if (result) {
        const value = { ...result, exchange: adapter.name, symbol: sym };
        cache.set(sym, { value, fetchedAt: Date.now() });
        return value;
      }
    } catch (err) {
      // Adapter failed (unlisted / unreachable) — try next exchange
    }
  }

  cache.set(sym, { value: null, fetchedAt: Date.now() });
  return null;
};

const formatPct = (rate) => `${rate > 0 ? '+' : ''}${(rate * 100).toFixed(4)}%`;

export const formatFundingLine = (funding) => {
  if (!funding) return null;
  const next = funding.nextFundingTime
    ? new Date(funding.nextFundingTime).toISOString().slice(11, 16)
    : 'continuous';
  return `💸 Funding: ${formatPct(funding.rate)} (/${funding.intervalHours}h) | Next: ${next} UTC · ${funding.exchange}`;
};

export const interpretFunding = (funding, direction) => {
  if (!funding) return null;
  const perHour = funding.rate / funding.intervalHours;
  const bearish = direction === 'bearish' || direction === 'short';

  let state;
  if (perHour >= 0.0002) state = 'extremeLong';
  else if (perHour >= 0.00005) state = 'elevatedLong';
  else if (perHour <= -0.0001) state = 'extremeShort';
  else if (perHour <= -0.00001) state = 'negative';
  else return null;

  const pct = formatPct(funding.rate);

  if (state === 'extremeLong' || state === 'elevatedLong') {
    return bearish
      ? `✅ Funding ${pct} — longs crowded, aligns with short bias`
      : `⚠️ Funding ${pct} — longs crowded, overextended / long-squeeze risk`;
  }

  if (state === 'extremeShort' || state === 'negative') {
    return bearish
      ? `⚠️ Funding ${pct} — shorts crowded, short-squeeze risk`
      : `✅ Funding ${pct} — shorts crowded, squeeze fuel for pumps`;
  }

  return null;
};
