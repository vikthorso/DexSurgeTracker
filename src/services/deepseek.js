import OpenAI from 'openai';
import { SYSTEM_TEMPLATE, buildUserMessage } from './levTemplate.js';

/**
 * Calls DeepSeek API (OpenAI-compatible) with the leverage grid trading prompt.
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
export const getLeverageStrategy = async (params) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey === 'your_deepseek_api_key_here') {
    return { success: false, error: 'DeepSeek API key not configured. Set DEEPSEEK_API_KEY in .env' };
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.deepseek.com'
  });

  const userMessage = buildUserMessage(params);

  try {
    const response = await client.chat.completions.create({
      model: 'deepseek-chat',
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
      return { success: false, error: 'Empty response from DeepSeek API' };
    }

    return { success: true, result, model: 'deepseek-chat' };
  } catch (error) {
    console.error('DeepSeek API error:', error.message);
    return { success: false, error: `DeepSeek API error: ${error.message}` };
  }
};
