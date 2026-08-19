/**
 * Shared system template and formatting helpers for leverage grid DCA strategy.
 * Used by both DeepSeek and Grok services.
 *
 * getSystemTemplate() reads dynamic account types from Stats config so the
 * user can edit "Accounts Types Context" from Telegram and have it reflected
 * immediately in the AI system prompt.
 */

import { Stats } from '../models/Stats.js';

export const DEFAULT_ACCOUNT_TYPES = JSON.stringify([
  {
    "id": "bybit",
    "label": "Day trading (Bybit)",
    "type": "HLA",
    "balance": 100,
    "leverage": 20,
    "capitalMax": 4,
    "capitalPct": 4,
    "goal": "maximum profit from top or bottom"
  },
  {
    "id": "mexc",
    "label": "Scalping (Mexc)",
    "type": "HLA",
    "balance": 500,
    "leverage": 20,
    "capitalMax": 50,
    "capitalPct": 10,
    "goal": "20% RIO for $5 daily, 1:1 tp:sl, trending market only, must go with the market"
  },
  {
    "id": "binance",
    "label": "Day trading (Binance)",
    "type": "LLA",
    "balance": 1000,
    "leverage": 5,
    "capitalMax": 100,
    "capitalPct": 10,
    "goal": "10-20% move (1-2x return)"
  }
]);

/**
 * Parse a JSON array of account type objects and render them as readable text
 * for the AI system prompt. Returns the raw JSON string on parse failure.
 */
const renderAccountTypes = (raw) => {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return raw;
    return arr.map(a =>
      `${a.label}\n${a.type} ($${a.balance})\nLev - ${a.leverage}x\nCapital Max - $${a.capitalMax} (${a.capitalPct}% of account for total exposure)\nGoal: ${a.goal}`
    ).join('\n\n');
  } catch {
    return raw;
  }
};

/**
 * Helper to parse the JSON array and return structured account defaults,
 * used by bot.js to pre-fill wizard values when an account is selected.
 */
export const parseAccountTypes = (raw) => {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch {
    return [];
  }
};

/**
 * Builds the full system prompt dynamically, injecting the current account
 * types config from the database so edits via /config are reflected immediately.
 */
export const getSystemTemplate = async () => {
  let accountTypesRaw = DEFAULT_ACCOUNT_TYPES;
  try {
    const stats = await Stats.findOne();
    if (stats?.accountTypes) {
      accountTypesRaw = stats.accountTypes;
    }
  } catch {
    // Fall through to default
  }
  const accountTypesText = renderAccountTypes(accountTypesRaw);

  return `You are a precise crypto futures risk & grid DCA calculator specialized in leveraged grid trading on manipulated low-to-mid cap tokens.

**Trading Context**
—
HLA - High Leverage Account
LLA - Low Leverage Account

**Accounts Types Context**
—
${accountTypesText}

**Theories to be aware of**

Manipulative funding game (Mexc in particular):
When its extremely bullish the height funding is 0.02 - 0.08% / 4hr (properly long) as token as experienced over 1x growth the idea usually is to trap sellers.
The moment it starts to collapse and has peaked it goes to -0.2 to -2% / 1hr to suck short traders dry.

Day-of-week patterns:
* Friday: Often a pump (position squaring / optimism into weekend)
* Saturday: Dump or chop
* Sunday: Pump (retail FOMO or recovery)
* Monday: Strong pump (traditional markets reopen, institutions/algos come back, positive sentiment carryover)
* Tuesday: Dump (profit-taking after Monday's move, reality sets in)

Hour-of-day patterns / sessions:
* 1:00-4:00 — Late night (low liquidity, easily manipulated)
* 4:00-7:00 — Asia session (slow, range-bound)
* 7:00-9:00 — Europe pre-market (building volume)
* 9:00-11:00 — RTH Open (high volume, directional)
* 11:00-14:00 — Midday (chop / consolidation)
* 14:00-16:00 — Afternoon (continuation / reversal)
* 16:00-18:00 — Europe close (volatile)
* 18:00-21:00 — US after hours (low liq, manip prone)
* 21:00-1:00 — Late night (low liq, easily manipulated)

Cross-reference day + hour: e.g. Monday RTH open is high confidence for continuation pump; Saturday late night is extremely risky for entries.

**Inputs I will provide:**
- Leverage (1x-50x)
- Trade amount / total allocated risk capital
- Entry price
- Current market cap
- Current account balance / capital
- Leverage mode: Cross or Isolated
- Number of grid orders (default 5)
- Direction: Long or Short
- Day of week (auto-detected)
- Hour of day with session label (auto-detected)
- (Optional) Account type selected
- (Optional) Token category/niche context
- (Optional) Candlestick sweep, funding fee, retracement entry observations

**Pre-Trade Checks to Evaluate:**
Self-reflect on each check below and assign pass/warn/fail before giving final strategy:
1. Clear candlestick sweep of lows (long) or highs (short) — user will describe if present
2. Weekday vs weekend — auto-detected day provided; weekend + early week volatility loop (Friday - Tuesday)
3. Funding fee currently — user provides rate if known
4. Retracement entry quality — user describes FVG close, wick touch, or other setup
5. Account type suitability — match strategy to the selected account type context
6. Bias alignment — does the setup align with the user's long/short bias?
7. Token niche — does the niche align with current market conditions?
8. Hour + day cross-reference — does the current session align with the direction bias?

**Logic:**
- Grid uses only grid_margin$ ($25 max, $5/order). Leverage applies ONLY to grid_margin.
- risk_capital$ = total willing to lose. Buffer of 75% of risk capital for manipulation.
- If no hit on lower grids: cancel + add freed $ to current position.
- Max 50x. Isolated preferred. 15% grid spacing default unless volatility demands wider.

**Your task - Always output in this exact brief friendly structure. Use emojis as shown:**

<b>📏 SIZE</b>
Margin: $xx | Exposure: $xxx | Tokens: x,xxx 🪙

<b>🪜 GRID</b> (15% spacing)
Lvl 1: $x.xxxxxx ($5) → Cum: x,xxx @ $x.xxxxxx
Lvl 2: $x.xxxxxx ($5) → Cum: x,xxx @ $x.xxxxxx
Lvl 3: $x.xxxxxx ($5) → Cum: x,xxx @ $x.xxxxxx
Lvl 4: $x.xxxxxx ($5) → Cum: x,xxx @ $x.xxxxxx
Lvl 5: $x.xxxxxx ($5) → Cum: x,xxx @ $x.xxxxxx 🔥
Full Avg: $x.xxxxxx | Total Tokens: x,xxx

<b>⚠️ RISK</b>
Liq: -xx% ($x.xxxxxx)
Max Drawdown: -xx% ($x.xxxxxx)
Buffer: $75
PnL Scenarios:
-20% → -$xx
-50% → -$xx
-70% → -$xx
+50% → +$xx
+100% → +$xx
+200% → +$xx 💸

<b>📊 METRICS</b>
Break Even: $x.xxxxxx
Take Profit:
• 30% → $x.xxxxxx (40%)
• 100% → $x.xxxxxx (30%)
• Trail 200%+ 🚀
R/R: 2x = x.xR | 3x = x.xR | 5x = x.xR

<b>💡 QUICK ADVICE</b>
✅ Sweep: [pass/warn/fail] — comment
✅ Day: [pass/warn/fail] — comment
✅ Time: [pass/warn/fail] — comment (session + pattern alignment)
✅ Funding: [pass/warn/fail] — comment
✅ Retrace: [pass/warn/fail] — comment
✅ Account: [pass/warn/fail] — comment
✅ Bias: [pass/warn/fail] — comment
Rating: X/10

<b>FINAL VERDICT:</b> LONG ✅ / SHORT ✅ / PASS ❌
[1-2 sentence explanation justifying the verdict based on hour + day + all checks above]

Be extremely concise, focus on numbers and check results. Prioritize survival in high-manipulation environments with wide buffers. Max 50x leverage, but always consider if the account type and session justify the chosen leverage. Always assume grid DCA style. Output ONLY this exact format. No fluff, no extra explanations outside the structure.`;
};

/**
 * Builds the user message string from input parameters.
 * Supports optional trade context fields (candlestick sweep, funding fee,
 * retracement entry, account type, and auto-detected day of week).
 */
export const buildUserMessage = ({
  leverage,
  amount,
  entryPrice,
  marketCap,
  accountBalance,
  leverageMode,
  gridOrders = 5,
  direction = 'long',
  tokenContext = '',
  accountType = '',
  candlestickSweep = '',
  fundingFee = '',
  retracementEntry = '',
  dayOfWeek = '',
  hourOfDay = ''
}) => {
  let msg = `Calculate leverage grid strategy for:
- Leverage: ${leverage}x
- Trade amount: $${amount}
- Entry price: $${entryPrice}
- Current market cap: $${marketCap.toLocaleString()}
- Account balance: $${accountBalance.toLocaleString()}
- Leverage mode: ${leverageMode}
- Grid orders: ${gridOrders}
- Direction: ${direction}`;

  if (dayOfWeek) {
    msg += `\n- Day of week: ${dayOfWeek}`;
  }

  if (hourOfDay) {
    msg += `\n- Hour of day: ${hourOfDay}`;
  }

  if (accountType) {
    msg += `\n- Account type: ${accountType}`;
  }

  if (tokenContext) {
    msg += `\n- Token context: ${tokenContext}`;
  }

  if (candlestickSweep) {
    msg += `\n- Candlestick sweep: ${candlestickSweep}`;
  }

  if (fundingFee) {
    msg += `\n- Funding fee: ${fundingFee}`;
  }

  if (retracementEntry) {
    msg += `\n- Retracement entry: ${retracementEntry}`;
  }

  return msg;
};

/**
 * Formats the raw AI output for Telegram HTML display.
 * Converts **bold** to <b> tags, structures sections with headings.
 */
/*
 * NOTE: formatLeverageOutput is deprecated since the AI now outputs directly
 * in HTML format with emoji styling. Raw output is sent as-is from the model.
 *
 * Kept as a passthrough in case we want to re-enable formatting later.
 */
export const formatLeverageOutput = (rawText) => {
  return rawText || '';
};
