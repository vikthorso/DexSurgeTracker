import OpenAI from 'openai';

/**
 * Grok Research Service — powers 3 research features:
 * 1. FUD check on X/Twitter (social sentiment analysis)
 * 2. Upcoming token unlock research
 * 3. Investor & backer research
 *
 * Reuses the existing xAI Grok API via OpenAI-compatible endpoint.
 * Uses grok-4-1-fast model with web search capability for real-time data.
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
    const response = await client.chat.completions.create({
      model: 'grok-4-1-fast-reasoning',
      messages: [
        { role: 'system', content: RESEARCH_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 2000,
      stream: false
    });

    const result = response.choices?.[0]?.message?.content;
    if (!result) {
      return { success: false, error: 'Empty response from Grok API.' };
    }

    return { success: true, result };
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
// FEATURE 3: Investor & Backer Research
// ============================================================================

export const researchInvestors = async (tokenName, tokenSymbol, chain, marketCap, customPrompt = '') => {
  const defaultPrompt = 'Research the investors, backers, and funding history for the project below. Search Crunchbase, CryptoRank, Cryptorank, RootData, official announcements, and VC portfolio pages.\n' +
    '\n' +
    'PROJECT: ' + tokenName + ' ($' + tokenSymbol + ')\n' +
    'CHAIN: ' + chain.toUpperCase() + '\n' +
    'CURRENT MARKET CAP: $' + ((marketCap || 0).toLocaleString()) + '\n' +
    '\n' +
    'Search for and report on:\n' +
    '1. All known funding rounds \u2014 seed, private, strategic, Series A/B, IDO/IEO, etc. Include dates, amounts, and valuations\n' +
    '2. Notable VC funds and institutional investors \u2014 who led, who participated\n' +
    '3. Angel investors and prominent individual backers\n' +
    '4. Exchange/market maker relationships \u2014 which exchanges are investors?\n' +
    '5. Total raised across all rounds\n' +
    '6. Investor track record \u2014 have these VCs backed winners before?\n' +
    '7. Any red flags \u2014 VC dumping, unfavorable token terms for retail, misaligned incentives\n' +
    '\n' +
    'Output in this EXACT format:\n' +
    '\n' +
    '[FUNDING SUMMARY]:\n' +
    'Total Raised: {amount} across {N} rounds\n' +
    'Valuation at Last Round: {amount if known}\n' +
    '\n' +
    '[FUNDING ROUNDS]:\n' +
    '\u2022 {Round Type} ({date}): {amount} at {valuation} \u2014 Led by {lead investor}\n' +
    '\u2022 {Round Type} ({date}): {amount} \u2014 {key participants}\n' +
    '...(list all found)\n' +
    '\n' +
    '[NOTABLE INVESTORS]:\n' +
    '\u2022 {Investor Name} \u2014 {type}: {role/round}, {brief note on track record}\n' +
    '\u2022 {Investor Name} \u2014 {type}: {role/round}\n' +
    '...(5-10 top investors)\n' +
    '\n' +
    '[EXCHANGE RELATIONS]:\n' +
    '\u2022 {exchange name}: {relationship \u2014 investor/partner/listed}\n' +
    '...(or \"None found / No public exchange investment\")\n' +
    '\n' +
    '[INVESTOR QUALITY]: STRONG / MODERATE / WEAK / UNKNOWN\n' +
    '(Based on VC tier, track record, and alignment)\n' +
    '\n' +
    '[RED FLAGS]:\n' +
    '\u2022 {any concerns about investors, vesting, or token terms}\n' +
    '...(or \"None identified\")\n' +
    '\n' +
    '[NOTES]: 1-2 sentence verdict on backing quality and what it means for the token';

  const prompt = customPrompt || defaultPrompt;

  const finalPrompt = customPrompt
    ? prompt
        .replace(/\{PROJECT\}/g, tokenName + ' ($' + tokenSymbol + ')')
        .replace(/\{CHAIN\}/g, chain.toUpperCase())
        .replace(/\{MARKET_CAP\}/g, (marketCap || 0).toLocaleString())
    : prompt;

  return callGrokResearch(finalPrompt);
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

export const formatInvestorsResult = (text, tokenSymbol) => {
  if (!text) return '<b>No investor data found.</b>';

  let formatted = escapeForHTML(text);

  formatted = formatted
    .replace(/\[FUNDING SUMMARY\]/gi, '<b>[FUNDING SUMMARY]</b>')
    .replace(/\[FUNDING ROUNDS\]/gi, '<b>[FUNDING ROUNDS]</b>')
    .replace(/\[NOTABLE INVESTORS\]/gi, '<b>[NOTABLE INVESTORS]</b>')
    .replace(/\[EXCHANGE RELATIONS\]/gi, '<b>[EXCHANGE RELATIONS]</b>')
    .replace(/\[INVESTOR QUALITY\]/gi, '<b>[INVESTOR QUALITY]</b>')
    .replace(/\[RED FLAGS\]/gi, '<b>[RED FLAGS]</b>')
    .replace(/\[NOTES\]/gi, '<b>[NOTES]</b>');

  const header = '<b>\u{1F4B0} INVESTORS & BACKERS: ' + tokenSymbol + '</b>\n' +
    '<b>\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501</b>\n\n';
  const footer = '\n\n<b>\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501</b>\n' +
    '<b>Source:</b> Grok 4.1 Research | <i>Verify independently</i>';

  return header + formatted + footer;
};
