import OpenAI from 'openai';

/**
 * Grok Research Service — powers 3 research features:
 * 1. FUD check on X/Twitter (social sentiment analysis)
 * 2. Upcoming token unlock research
 * 3. Investor backers & market maker research (fixed watch-list check)
 *
 * Uses the xAI Responses API with the web_search tool for real-time grounding.
 */

const GROK_API_URL = 'https://api.x.ai/v1';

const RESEARCH_SYSTEM_PROMPT = "You are a crypto research analyst. Be concise, factual, and hyper-focused on actionable data. \n" +
  "Use web search to find current, real-time information. Cite specific sources when possible.\n" +
  "Structure your response exactly as instructed in each user prompt. No fluff. No disclaimers. No intro/outro paragraphs.";

const getClient = () => {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey || apiKey === 'your_grok_api_key_here') {
    return null;
  }
  return new OpenAI({ apiKey, baseURL: GROK_API_URL });
};

const callGrokResearch = async (userPrompt) => {
  const client = getClient();
  if (!client) {
    return { success: false, error: 'Grok API key not configured. Set GROK_API_KEY in .env' };
  }

  try {
    const response = await client.responses.create({
      model: 'grok-4.6',
      input: [
        { role: 'system', content: RESEARCH_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      tools: [{ type: 'web_search' }],
      max_output_tokens: 3000,
      store: false
    });

    const result = (response.output || [])
      .filter((item) => item.type === 'message')
      .flatMap((item) => (item.content || []))
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text)
      .join('')
      .trim();

    if (!result) {
      return { success: false, error: 'Empty response from Grok API.' };
    }

    return { success: true, result, model: 'grok-4.6' };
  } catch (error) {
    console.error('[GrokResearch] API error:', error.message);
    return { success: false, error: 'Grok API error: ' + error.message };
  }
};

// ============================================================================
// FEATURE 1: FUD Check on X (Social Sentiment)
// ============================================================================

export const checkFUD = async (tokenName, tokenSymbol, chain, marketCap, priceUsd, tokenAddress = '') => {
  const addressLine = tokenAddress ? '\nCONTRACT ADDRESS: ' + tokenAddress + '\n' : '';
  const prompt = 'Research the current social media sentiment for the token below. Search X (Twitter) for mentions by name, symbol ($' + tokenSymbol + '), and contract address. Also search Reddit and recent crypto news.\n' +
    '\n' +
    'TOKEN: ' + tokenName + ' ($' + tokenSymbol + ')\n' +
    'CHAIN: ' + chain.toUpperCase() + '\n' +
    addressLine +
    'MARKET CAP: $' + ((marketCap || 0).toLocaleString()) + '\n' +
    'PRICE: ' + (priceUsd || 'N/A') + '\n' +
    '\n' +
    'IMPORTANT: Search X/Twitter specifically for the contract address, token name, and $' + tokenSymbol + ' cashtag. Look for any FUD, scam warnings, or negative sentiment. Check if any prominent crypto accounts have warned about this token.\n' +
    '\n' +
    'Search for and report on:\n' +
    '1. Negative sentiment or FUD \u2014 criticism, scam accusations, rug-pull concerns, exploit fears\n' +
    '2. Recent controversies, team drama, or community backlash\n' +
    '3. Red flags in tokenomics, smart contract, or liquidity\n' +
    '4. Coordinated FUD campaigns, competitor attacks, or bot-driven negativity\n' +
    '5. Any positive sentiment or bullish catalysts that counter the FUD\n' +
    '\n' +
    'Output in this EXACT format:\n' +
    '\n' +
    '[CONFIDENCE]: LOW / MEDIUM / HIGH\n' +
    '(How reliable the FUD claims appear to be)\n' +
    '\n' +
    '[FUD SUMMARY]: 2-3 sentence summary of the main concerns\n' +
    '\n' +
    '[KEY CONCERNS]:\n' +
    '\u2022 Concern 1 (with source if found)\n' +
    '\u2022 Concern 2\n' +
    '\u2022 Concern 3\n' +
    '...(3-5 specific concerns)\n' +
    '\n' +
    '[COUNTER-NARRATIVE]:\n' +
    '\u2022 Any bullish points or debunked FUD\n' +
    '...(1-3 points, or "None found")\n' +
    '\n' +
    '[OVERALL]: BULLISH / NEUTRAL / BEARISH\n' +
    '(One-word verdict with brief justification)\n' +
    '\n' +
    'Be specific. Cite sources like X posts, news articles, or community threads when found.';

  return callGrokResearch(prompt);
};

// ============================================================================
// FEATURE 2: Upcoming Token Unlocks
// ============================================================================

export const checkUpcomingUnlocks = async (tokenName, tokenSymbol, chain, tokenAddress = '') => {
  const addressLine = tokenAddress ? '\nCONTRACT: ' + tokenAddress : '';

  const prompt = 'Research upcoming token unlock events for the project below. Search tokenunlocks.app, vestlab, coinmarketcal, and official project announcements.\n' +
    '\n' +
    'PROJECT: ' + tokenName + ' ($' + tokenSymbol + ')\n' +
    'CHAIN: ' + chain.toUpperCase() + addressLine + '\n' +
    '\n' +
    'Search for and report on:\n' +
    '1. Next scheduled unlock \u2014 date, amount, type (team/VC/foundation/community/ecosystem)\n' +
    '2. Upcoming unlocks within the next 90 days \u2014 list each with date and estimated value\n' +
    '3. Seed/private round vesting schedules and cliff periods\n' +
    '4. Any recent large unlocks (last 30 days) and their market impact\n' +
    '5. Total locked vs circulating supply \u2014 how much is still to unlock\n' +
    '6. Unlock concentration \u2014 are most unlocks to VCs, team, or community?\n' +
    '\n' +
    'Output in this EXACT format:\n' +
    '\n' +
    '[NEXT UNLOCK]: {date or \"None found\"} \u2014 {amount} tokens (~{estimated USD value})\n' +
    '{type of unlock \u2014 team/VC/foundation/etc}\n' +
    '{cliff or linear vesting details if available}\n' +
    '\n' +
    '[UPCOMING (90 days)]:\n' +
    '\u2022 {date}: {amount} ({type}) \u2014 ~{USD value}\n' +
    '\u2022 {date}: {amount} ({type}) \u2014 ~{USD value}\n' +
    '...(list all known, or \"No known upcoming unlocks\")\n' +
    '\n' +
    '[RECENT UNLOCKS]: (Past 30 days)\n' +
    '\u2022 {date}: {amount} ({type}) \u2014 market reaction: {brief note}\n' +
    '...(or \"None\")\n' +
    '\n' +
    '[TOKENOMICS OVERVIEW]:\n' +
    '\u2022 Circulating Supply: {amount or % if known}\n' +
    '\u2022 Still Locked: {amount or % if known}\n' +
    '\u2022 Fully Diluted: {estimated amount}\n' +
    '\n' +
    '[UNLOCK RISK]: LOW / MEDIUM / HIGH / CRITICAL\n' +
    '(Based on size, proximity, and concentration of unlocks)\n' +
    '\n' +
    '[NOTES]: 1-2 sentence verdict on unlock health and timing risk\n' +
    '\n' +
    'Be specific with dates and amounts. Use ? when uncertain.';

  return callGrokResearch(prompt);
};

// ============================================================================
// FEATURE 3: Investor Backers & Market Makers (Fixed Watch-List Check)
// ============================================================================

export const researchInvestorsMM = async (tokenName, tokenSymbol, tokenAddress, chain = '') => {
  const chainLine = chain ? `\n- Chain: ${chain.toUpperCase()}` : '';
  const prompt = 'Token research request. Inputs:\n' +
    '- Name: ' + tokenName + '\n' +
    '- Symbol: ' + tokenSymbol + '\n' +
    '- Contract: ' + tokenAddress + chainLine + '\n' +
    '\n' +
    'Check ONLY against this fixed list:\n' +
    '\n' +
    'Backers:\n' +
    'YZi Labs (formerly Binance Labs), TRON DAO (TRON Foundation), HTX Ventures (formerly Huobi Ventures), HashKey Capital, Symbolic Capital / Symbolic VC, KR1, Continue Capital, Vessel Capital, DECOM (Switzerland AG), DWF Labs, Mucker Capital, Gate Labs, Selini Capital\n' +
    '\n' +
    'Market Makers:\n' +
    'GSR, DWF Labs, Wintermute, Jump Crypto / Jump Trading, Jane Street, B2C2, Flow Traders, Cumberland (DRW), Amber Group, Kairon Labs, Galaxy Digital, FalconX\n' +
    '\n' +
    'Output rules (strict):\n' +
    '- Extremely brief and compact. No fluff.\n' +
    '- Use this exact structure:\n' +
    '\n' +
    '**[SYMBOL] – [NAME]**\n' +
    'Contract: [ADDRESS]\n' +
    '\n' +
    '**Funding**\n' +
    '- Total raised: $X\n' +
    '- Rounds: [list key rounds with amounts/dates if available]\n' +
    '\n' +
    '**Backers (from list)**\n' +
    '- Present: [names only]\n' +
    '- Absent: all others (or “None from list”)\n' +
    '\n' +
    '**Market Makers (from list)**\n' +
    '- Confirmed / Linked: [names only]\n' +
    '- None confirmed: [if applicable]\n' +
    '\n' +
    '**Other notable investments by the matched companies**\n' +
    '- [Company]: [2–4 other tokens they backed, brief]\n' +
    '(Only list for companies that matched on this token. Keep ultra-short.)\n' +
    '\n' +
    'If data is incomplete or not public, state “Not publicly disclosed” in one line. Prioritize official announcements, funding trackers (CryptoRank, RootData, PitchBook, etc.), and on-chain reports. Do not invent connections.';

  return callGrokResearch(prompt);
};

// ============================================================================
// Formatting helpers for Telegram HTML output
// ============================================================================

export const escapeForHTML = (text) => {
  if (!text) return '';
  return text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>');
};

export const formatFUDResult = (text, tokenSymbol) => {
  if (!text) return '<b>No results returned.</b>';

  let formatted = escapeForHTML(text);

  formatted = formatted
    .replace(/\[CONFIDENCE\]/gi, '<b>[CONFIDENCE]</b>')
    .replace(/\[FUD SUMMARY\]/gi, '<b>[FUD SUMMARY]</b>')
    .replace(/\[KEY CONCERNS\]/gi, '<b>[KEY CONCERNS]</b>')
    .replace(/\[COUNTER-NARRATIVE\]/gi, '<b>[COUNTER-NARRATIVE]</b>')
    .replace(/\[OVERALL\]/gi, '<b>[OVERALL]</b>');

  const header = '<b>\u{1F426} FUD CHECK: ' + tokenSymbol + '</b>\n' +
    '<b>\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501</b>\n\n';
  const footer = '\n\n<b>\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501</b>\n' +
    '<b>Source:</b> Grok 4.1 Research | <i>Verify independently</i>';

  return header + formatted + footer;
};

export const formatUnlocksResult = (text, tokenSymbol) => {
  if (!text) return '<b>No unlock data found.</b>';

  let formatted = escapeForHTML(text);

  formatted = formatted
    .replace(/\[NEXT UNLOCK\]/gi, '<b>[NEXT UNLOCK]</b>')
    .replace(/\[UPCOMING \(90 days\)\]/gi, '<b>[UPCOMING (90 days)]</b>')
    .replace(/\[RECENT UNLOCKS\]/gi, '<b>[RECENT UNLOCKS]</b>')
    .replace(/\[TOKENOMICS OVERVIEW\]/gi, '<b>[TOKENOMICS OVERVIEW]</b>')
    .replace(/\[UNLOCK RISK\]/gi, '<b>[UNLOCK RISK]</b>')
    .replace(/\[NOTES\]/gi, '<b>[NOTES]</b>');

  const header = '<b>\u{1F513} UPCOMING UNLOCKS: ' + tokenSymbol + '</b>\n' +
    '<b>\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501</b>\n\n';
  const footer = '\n\n<b>\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501</b>\n' +
    '<b>Source:</b> Grok 4.1 Research | <i>Verify independently</i>';

  return header + formatted + footer;
};

export const formatInvestorsMMResult = (text, tokenSymbol) => {
  if (!text) return '<b>No investor data found.</b>';

  let formatted = escapeForHTML(text);

  // Convert **bold** markdown markers to <b> tags for Telegram HTML rendering
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

  const header = '<b>\u{1F4B0} INVESTOR BACKERS: ' + tokenSymbol + '</b>\n' +
    '<b>\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501</b>\n\n';
  const footer = '\n\n<b>\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501</b>\n' +
    '<b>Source:</b> Grok 4.1 Research | <i>Verify independently</i>';

  return header + formatted + footer;
};
