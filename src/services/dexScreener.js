import axios from 'axios';

/**
 * Fetches token data from DexScreener API.
 * Always returns the first object from the response array.
 */
export const fetchTokenData = async (chain, tokenAddress) => {
  try {
    const url = `https://api.dexscreener.com/token-pairs/v1/${chain}/${tokenAddress}`;
    const response = await axios.get(url);
    
    if (response.data && Array.isArray(response.data) && response.data.length > 0) {
      const pair = response.data[0];
      return {
        priceUsd: pair.priceUsd,
        marketCap: pair.marketCap || 0,
        volumeM5: pair.volume?.m5 || 0,
        volumeH1: pair.volume?.h1 || 0,
        symbol: pair.baseToken?.symbol || 'UNKNOWN',
        name: pair.baseToken?.name || 'UNKNOWN',
        success: true
      };
    }
    
    return { success: false, error: 'No pair data found' };
  } catch (error) {
    console.error(`Error fetching DexScreener data for ${chain}:${tokenAddress}:`, error.message);
    return { success: false, error: error.message };
  }
};
