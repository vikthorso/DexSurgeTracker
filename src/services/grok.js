import OpenAI from 'openai';
import { SYSTEM_TEMPLATE, buildUserMessage } from './levTemplate.js';

/**
 * Calls Grok (xAI) API (OpenAI-compatible) with the leverage grid trading prompt.
 * Uses grok-4.1-fast model for quick thinking responses.
 * @param {Object} params
 * @param {number} params.leverage - e.g. 5
 * @param {number} params.amount - Trade amount in USD e.g. 100
 * @param {number} params.entryPrice - Entry price
 * @param {number} params.marketCap - Current market cap
 * @param {number} params.accountBalance - Current account balance
 * @param {string} params.leverageMode - 'cross' or 'isolated'
 * @param {number} [params.gridOrders=5] - Number of grid orders
 * @param {string} [params.direction='long'] - 'long' or 'short'
 * @param {string} [params.tokenContext=''] - Optional token category/niche context
 * @returns {Promise<{success: boolean, result?: string, error?: string, model?: string}>}
 */
export const getGrokStrategy = async (params) => {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey || apiKey === 'your_grok_api_key_here') {
    return { success: false, error: 'Grok API key not configured. Set GROK_API_KEY in .env' };
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.x.ai/v1'
  });

  const userMessage = buildUserMessage(params);

  try {
    const response = await client.chat.completions.create({
      model: 'grok-4-1-fast-non-reasoning',
      messages: [
        { role: 'system', content: SYSTEM_TEMPLATE },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 1500,
      stream: false
    });

    const result = response.choices?.[0]?.message?.content;
    if (!result) {
      return { success: false, error: 'Empty response from Grok API' };
    }

    return { success: true, result, model: 'grok-4.1-fast' };
  } catch (error) {
    console.error('Grok API error:', error.message);
    return { success: false, error: `Grok API error: ${error.message}` };
  }
};
