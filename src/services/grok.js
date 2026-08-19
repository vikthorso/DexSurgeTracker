import OpenAI from 'openai';
import { buildUserMessage, getSystemTemplate } from './levTemplate.js';

export const getGrokStrategy = async (params) => {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey || apiKey === 'your_grok_api_key_here') {
    return { success: false, error: 'Grok API key not configured. Set GROK_API_KEY in .env' };
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.x.ai/v1'
  });

  try {
    const [systemTemplate, userMessage] = await Promise.all([
      getSystemTemplate(),
      Promise.resolve(buildUserMessage(params))
    ]);

    const response = await client.chat.completions.create({
      model: 'grok-4.6',
      messages: [
        { role: 'system', content: systemTemplate },
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
