import OpenAI from 'openai';
import { getSystemTemplate, buildUserMessage } from './levTemplate.js';

export const getLeverageStrategy = async (params) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey === 'your_deepseek_api_key_here') {
    return { success: false, error: 'DeepSeek API key not configured. Set DEEPSEEK_API_KEY in .env' };
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.deepseek.com'
  });

  try {
    const [systemTemplate, userMessage] = await Promise.all([
      getSystemTemplate(),
      Promise.resolve(buildUserMessage(params))
    ]);

    const response = await client.chat.completions.create({
      model: 'deepseek-chat',
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
      return { success: false, error: 'Empty response from DeepSeek API' };
    }

    return { success: true, result, model: 'deepseek-chat' };
  } catch (error) {
    console.error('DeepSeek API error:', error.message);
    return { success: false, error: `DeepSeek API error: ${error.message}` };
  }
};
