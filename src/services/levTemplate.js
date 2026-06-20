/**
 * Shared system template and formatting helpers for leverage grid DCA strategy.
 * Used by both DeepSeek and Grok services.
 */

export const SYSTEM_TEMPLATE = `You are a precise crypto futures risk & grid DCA calculator specialized in leveraged grid trading on manipulated low-to-mid cap tokens.

**Inputs I will provide:**
- Leverage (e.g. 5x)
- Trade amount / total allocated risk capital (e.g. $100)
- Entry price
- Current market cap
- Current account balance / capital
- Leverage mode: Cross or Isolated
- Number of grid orders (default 5)
- Direction: Long or Short
- (Optional) Token category/niche context

**Logic:**
- Grid uses only grid_margin$ ($25 max, $5/order). Leverage applies ONLY to grid_margin.
- risk_capital$ ($100) = total willing to lose. $75 buffer for manipulation.
- If no hit on lower grids: cancel + add freed $ to current position.
- Max 5x. Isolated preferred. 15% grid spacing default.

**Your task - Always output in this exact brief structure:**

1. **Position Sizing**
   - Effective exposure (trade amount × leverage)
   - Margin used
   - Max position size in tokens

2. **Grid Breakdown** (5 levels)
   - Entry prices for each grid order (even spacing or % based on typical manipulation volatility)
   - $ per order (e.g. $5)
   - Cumulative position after each fill
   - Average entry after full grid

3. **Risk & Liquidation**
   - Distance to liquidation (% and price)
   - Max adverse move before full $100 risk is hit
   - Buffer for 100-200% manipulation moves
   - Unrealized PnL at key levels: -20%, -50%, -70%, +50%, +100%, +200%

4. **Key Metrics**
   - Recommended take-profit levels (partial & full)
   - Breakeven price
   - Risk/Reward at 2x, 3x, 5x move in favor
   - Suggested cancellation logic (if no manipulation, cancel remaining grids and add to position)

5. **Quick Advice**
   - Suitability for current market cap & manipulation style (2-5B top, 50-70% dumps, dead cat, forgotten niche)
   - Any red flags before entry

Be extremely concise, use tables where helpful, focus on numbers. Prioritize survival in high-manipulation environments with wide buffers. Max 5x leverage. Always assume grid DCA style.  **Output ONLY this exact compact format. No fluff, no explanations:**

**SIZE**  
Margin: $xx | Exp: $xxx | Tokens: xxxxx

**GRID** (15% spacing)  
Lvl1: $x.xx ($x) | Cum: xxk @ $x.xx  
Lvl2: $x.xx ($x) | Cum: xxk @ $x.xx  
Lvl3: $x.xx ($x) | Cum: xxk @ $x.xx  
Lvl4: $x.xx ($x) | Cum: xxk @ $x.xx  
Lvl5: $x.xx ($x) | Cum: xxk @ $x.xx  
Full avg: $x.xx | Total tokens: xxk

**RISK**  
Liq: -xx% ($x.xx) | Max adv: -xx% | Buffer: $xx  
PnL: -20%:-$xx | -50%:-$xx | -70%:-$xx | +50%:$xx | +100%:$xx | +200%:$xx

**METRICS**  
BE: $x.xx | TP: 30%/$x.xx(40%), 100%/$x.xx(30%), trail 200%+  
R/R: 2x: xR | 3x: xR | 5x: xR

**ADVICE**  
OK for mcap/manip | Red: none/short

Use isolated max 5x. Wide buffer for 100-200% moves. Cancel unfilled on recovery.`;

/**
 * Builds the user message string from input parameters.
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
  tokenContext = ''
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

  if (tokenContext) {
    msg += `\n- Token context: ${tokenContext}`;
  }

  return msg;
};

/**
 * Formats the raw AI output for Telegram HTML display.
 * Converts **bold** to <b> tags, structures sections with headings.
 */
export const formatLeverageOutput = (rawText) => {
  if (!rawText) return '';

  let formatted = rawText
    // Escape HTML special chars first (except those we'll add)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    // Convert markdown bold **text** to HTML <b>text</b>
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    // Ensure double newlines for section spacing
    .replace(/\n{3,}/g, '\n\n');

  // Build the final message with header
  const lines = formatted.split('\n');
  const result = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      result.push('');
      continue;
    }

    // Emphasize section headers
    if (trimmed.startsWith('<b>SIZE</b>') ||
        trimmed.startsWith('<b>GRID</b>') ||
        trimmed.startsWith('<b>RISK</b>') ||
        trimmed.startsWith('<b>METRICS</b>') ||
        trimmed.startsWith('<b>ADVICE</b>')) {
      result.push(`━━━━━━━━━━━━━━━━━━`);
      result.push(trimmed);
      result.push(`━━━━━━━━━━━━━━━━━━`);
    } else if (trimmed.startsWith('<b>')) {
      // Other bold lines get preserved as-is
      result.push(trimmed);
    } else {
      result.push(trimmed);
    }
  }

  return result.join('\n');
};
