import axios from 'axios';

const MORALIS_BASE_URL = 'https://deep-index.moralis.io/api/v2.2';

/**
 * Maps chain names to Moralis chain IDs (hex format).
 * Only EVM chains supported; Solana is not supported by this service.
 */
const CHAIN_ID_MAP = {
  ethereum: '0x1',
  bsc: '0x38',
  base: '0x2105',
  solana: null,  // explicitly unsupported
  hyperliquid: null,  // Hyperliquid L1 — not EVM
  sui: null  // Sui L1 — not EVM
};

/**
 * Lightweight sleep for inter-request rate limiting.
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Builds the standard Moralis headers.
 */
const getHeaders = () => {
  const apiKey = process.env.MORALIS_API_KEY;
  if (!apiKey || apiKey === 'your_moralis_api_key_here') {
    return null;
  }
  return {
    'accept': 'application/json',
    'x-api-key': apiKey
  };
};

/**
 * Fetches ERC-20 token metadata (name, symbol, decimals, total supply) from Moralis.
 *
 * @param {string} chain - Chain name (ethereum, bsc, base)
 * @param {string} contractAddress - Token contract address
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export const getTokenMetadata = async (chain, contractAddress) => {
  const headers = getHeaders();
  if (!headers) {
    return { success: false, error: 'Moralis API key not configured. Set MORALIS_API_KEY in .env' };
  }

  const chainId = CHAIN_ID_MAP[chain?.toLowerCase()];
  if (!chainId) {
    return { success: false, error: `Moralis EVM API does not support chain: ${chain}. Only Ethereum, BSC, and Base are supported.` };
  }

  try {
    const url = `${MORALIS_BASE_URL}/erc20/${contractAddress}`;
    const response = await axios.get(url, {
      headers,
      params: { chain: chainId },
      timeout: 30000
    });

    const data = response.data;
    if (!data) {
      return { success: false, error: 'Token not found on Moralis. It may not be indexed yet.' };
    }

    return {
      success: true,
      data: {
        name: data.name || 'Unknown',
        symbol: data.symbol || 'Unknown',
        decimals: data.decimals || 18,
        totalSupply: data.total_supply_formatted || data.total_supply || 'N/A',
        tokenType: data.contract_type || 'ERC-20',
        possibleSpam: data.possible_spam || false,
        verifiedContract: data.verified_contract !== false
      }
    };
  } catch (error) {
    if (error.response?.status === 429) {
      console.warn('[Moralis] Rate limited, retrying after 3s...');
      await sleep(3000);
      try {
        const retryResponse = await axios.get(`${MORALIS_BASE_URL}/erc20/${contractAddress}`, {
          headers,
          params: { chain: chainId },
          timeout: 30000
        });
        const data = retryResponse.data;
        return {
          success: true,
          data: {
            name: data.name || 'Unknown',
            symbol: data.symbol || 'Unknown',
            decimals: data.decimals || 18,
            totalSupply: data.total_supply_formatted || data.total_supply || 'N/A',
            tokenType: data.contract_type || 'ERC-20',
            possibleSpam: data.possible_spam || false,
            verifiedContract: data.verified_contract !== false
          }
        };
      } catch (retryError) {
        console.error('[Moralis] Retry failed:', retryError.message);
        return { success: false, error: `Moralis rate limited. Try again in 30s.` };
      }
    }

    console.error(`[Moralis] Error fetching token metadata for ${chain}:${contractAddress}:`, error.message);
    if (error.response?.status === 404) {
      return { success: false, error: 'Token not indexed on Moralis. Try again later.' };
    }
    return { success: false, error: `Moralis API error: ${error.message}` };
  }
};

/**
 * Fetches the top 10 token holders by balance from Moralis.
 *
 * @param {string} chain - Chain name (ethereum, bsc, base)
 * @param {string} contractAddress - Token contract address
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export const getTopHolders = async (chain, contractAddress) => {
  const headers = getHeaders();
  if (!headers) {
    return { success: false, error: 'Moralis API key not configured. Set MORALIS_API_KEY in .env' };
  }

  const chainId = CHAIN_ID_MAP[chain?.toLowerCase()];
  if (!chainId) {
    return { success: false, error: `Moralis EVM API does not support chain: ${chain}. Only Ethereum, BSC, and Base are supported.` };
  }

  try {
    const url = `${MORALIS_BASE_URL}/erc20/${contractAddress}/owners`;
    const response = await axios.get(url, {
      headers,
      params: {
        chain: chainId,
        limit: 10,
        order: 'DESC'
      },
      timeout: 30000
    });

    const holders = response.data?.result || [];
    if (holders.length === 0) {
      return {
        success: true,
        data: {
          holders: [],
          totalHolders: response.data?.total || 0,
          top10Concentration: 0,
          riskLevel: 'HIGH' // no holders = suspicious or very new token
        }
      };
    }

    const totalHolders = response.data?.total || holders.length;
    let top10Concentration = 0;

    const formattedHolders = holders.map((h) => {
      const pct = parseFloat(h.percentage_relative_to_total_supply || '0');
      top10Concentration += pct;
      return {
        address: h.owner_address || 'Unknown',
        balance: h.balance_formatted || h.balance || '0',
        percentOfSupply: parseFloat(pct.toFixed(4))
      };
    });

    // Cap total concentration at 100%
    top10Concentration = Math.min(top10Concentration, 100);

    let riskLevel = 'LOW';
    if (top10Concentration > 50) {
      riskLevel = 'HIGH';
    } else if (top10Concentration > 30) {
      riskLevel = 'MEDIUM';
    }

    return {
      success: true,
      data: {
        holders: formattedHolders,
        totalHolders,
        top10Concentration: parseFloat(top10Concentration.toFixed(2)),
        riskLevel
      }
    };
  } catch (error) {
    if (error.response?.status === 429) {
      console.warn('[Moralis] Rate limited on holders, retrying after 3s...');
      await sleep(3000);
      try {
        const retryResponse = await axios.get(`${MORALIS_BASE_URL}/erc20/${contractAddress}/owners`, {
          headers,
          params: { chain: chainId, limit: 10, order: 'DESC' },
          timeout: 30000
        });
        const holders = retryResponse.data?.result || [];
        let top10Concentration = 0;
        const formattedHolders = holders.map((h) => {
          const pct = parseFloat(h.percentage_relative_to_total_supply || '0');
          top10Concentration += pct;
          return {
            address: h.owner_address || 'Unknown',
            balance: h.balance_formatted || h.balance || '0',
            percentOfSupply: parseFloat(pct.toFixed(4))
          };
        });
        top10Concentration = Math.min(top10Concentration, 100);
        let riskLevel = 'LOW';
        if (top10Concentration > 50) riskLevel = 'HIGH';
        else if (top10Concentration > 30) riskLevel = 'MEDIUM';
        return {
          success: true,
          data: {
            holders: formattedHolders,
            totalHolders: retryResponse.data?.total || formattedHolders.length,
            top10Concentration: parseFloat(top10Concentration.toFixed(2)),
            riskLevel
          }
        };
      } catch (retryError) {
        console.error('[Moralis] Retry failed:', retryError.message);
        return { success: false, error: 'Moralis rate limited. Try again in 30s.' };
      }
    }

    console.error(`[Moralis] Error fetching holders for ${chain}:${contractAddress}:`, error.message);
    return { success: false, error: `Moralis API error: ${error.message}` };
  }
};

/**
 * Returns whether Moralis EVM API supports a given chain.
 */
export const isEVMChain = (chain) => {
  return !!CHAIN_ID_MAP[chain?.toLowerCase()];
};
