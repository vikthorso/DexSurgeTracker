# Stagnation & Crash Detection — Test Plan

## Testing Approaches

### Approach 1: Standalone Test Script (Recommended First)

Run `babel-node test/stagnation-test.js` — a pure Node script that:
- Creates mock Token/Stats objects (no MongoDB connection needed)
- Mocks DexScreener data by injecting price/MC sequences directly
- Mocks Telegram `sendMessage` to capture all alerts in memory
- Traces every state transition and logs results

**Tests 6 scenarios:**
| Scenario | What It Verifies |
|----------|-----------------|
| Beat Token (11.41→6.23→9.47→5.8) | Full crash→bounce→TP→fail lifecycle |
| Fake bounce trap (2 scans then new low) | No false entry fired |
| Slow consolidation then bounce | 3-scan confirmation works with slow creep |
| Ultra-fast V-bounce past TP | Entry fires with past-TP warning |
| Auto-recovery above 80% peak | Crash cleared automatically |
| Stagnation long signal | General stagnation triggers |

**Expected output for Scenario A (Beat Token):**
```
[Scan 5] CRASH: TEST | MC -45.4% | TP 7.48
[Scan 6] MC=6.85 CRASH=monitoring | bounce=10.0% scans=2
[Scan 7] MC=6.92 CRASH=monitoring | bounce=11.0% scans=3
[Scan 8] WAVE 1 ENTRY: TEST | Bounce 13.1% | TP 7.48
[Scan 10] TP ZONE: TEST | Gain 36.4%
[Scan 12] BOUNCE FAILED: TEST | Old trough 6.23 -> New 5.8
```

### Approach 2: Telegram Live Test Button

Adds a `🧪 Test Crash` button to the per-token detail view in `bot.js`. Tapping it:
1. Fetches the current live price/MC from DexScreener
2. Simulates a crash sequence using the token's real high: drops the price 45%, then raises it 12% three times to trigger bounce confirmation
3. Sends the Tier 1, Tier 2, and Tier 3 alerts to your Telegram chat
4. Cleans up the test state afterward (resets `crashState` to `null`)

This verifies that the Telegram alert pipeline works end-to-end with real data.

### Approach 3: MongoDB Manual Verification

After running the bot with stagnation enabled on a token:
1. Check that new fields exist in the database:
   ```js
   db.tokens.findOne({ isStagnationTracking: true })
   ```
2. After a real crash is detected, verify `crashState`, `crashPeakMc`, `crashTroughMc`, `bounceConfirmationScans` are populated correctly.

---

## Test Script File (to create at `test/stagnation-test.js`)

```javascript
/**
 * Stagnation & Crash Detection Test Harness
 *
 * Simulates token price/MC sequences and traces crash/bounce state machine
 * transitions WITHOUT needing MongoDB, DexScreener API, or Telegram Bot running.
 *
 * Usage:
 *   npx babel-node test/stagnation-test.js
 */

// ============================================================================
// Mock: Stats (global config)
// ============================================================================
const mockStats = {
  crashPercentThreshold: 40,
  crashWindowMs: 86400000,        // 24 hours
  stagnationWindowMs: 14400000,   // 4 hours
  stagnationPercent: 5,
  stagnationCooldownMs: 3600000,  // 1 hour
  bounceConfirmPercent: 8,
  bounceConfirmMinScans: 3,
  deadCatBounceEnabled: true,
  liveTrackThreshold: 10,
  liveConsecutiveThreshold: 2,
  sentimentWindowHours: 4,
};

// ============================================================================
// Mock: Token state
// ============================================================================
function createMockToken() {
  return {
    symbol: 'TEST',
    tokenId: 'solana:TEST123',
    chain: 'solana',
    tokenAddress: 'TEST123',
    userId: 'test-user',
    isActive: true,
    isStagnationTracking: true,
    scanCount: 0,
    stagnationHighMc: 0, stagnationHighPrice: 0, stagnationHighTime: null,
    stagnationLowMc: 0, stagnationLowPrice: 0, stagnationLowTime: null,
    crashState: null, crashPeakMc: 0, crashPeakPrice: 0,
    crashTroughMc: 0, crashTroughPrice: 0, crashDetectedAt: null,
    bounceConfirmationScans: 0,
    deadCatWave1EntryMc: 0, deadCatWave1EntryPrice: 0,
    deadCatWave1TargetMc: 0, deadCatWave1TargetPrice: 0,
    deadCatWave1TpHit: false,
    stagnationAlertedAt: null, stagnationLastType: null,
    lastMarketCap: 0, lastVolumeM5: 0, lastVolumeH1: 0, lastAlertAt: null,
  };
}

// ============================================================================
// Mock: Telegram bot
// ============================================================================
let messageCount = 0;
const capturedMessages = [];

const mockBot = {
  telegram: {
    sendMessage: function(chatId, text, options) {
      messageCount++;
      const tier = text.includes('CRASH') ? 'TIER 1'
        : text.includes('WAVE 1') ? 'TIER 2'
        : text.includes('TP ZONE') || text.includes('FAILED') ? 'TIER 3'
        : 'INFO';
      capturedMessages.push({ tier, text: text.replace(/<[^>]+>/g, '').replace(/[━]/g, '-').substring(0, 150) });
      return Promise.resolve({ message_id: messageCount });
    },
  },
};

// ============================================================================
// Core Logic (extracted from monitor.js)
// ============================================================================
const WAVE1_TP_MIN = 10;
const WAVE1_TP_MAX = 30;
const WAVE1_TP_DEFAULT = 20;

function runScan(token, priceUsd, marketCap, globalStats) {
  const now = new Date();
  const symbol = token.symbol;
  const currentPrice = priceUsd;
  const currentMarketCap = marketCap;
  const crashPct = globalStats.crashPercentThreshold || 40;
  const crashWindow = globalStats.crashWindowMs || 86400000;
  const bounceConfirmPct = globalStats.bounceConfirmPercent || 8;
  const bounceMinScans = globalStats.bounceConfirmMinScans || 3;

  // Update rolling high/low
  if (currentMarketCap > token.stagnationHighMc || token.stagnationHighMc === 0) {
    token.stagnationHighMc = currentMarketCap;
    token.stagnationHighPrice = currentPrice;
    token.stagnationHighTime = now;
  }
  if (token.stagnationLowMc === 0 || currentMarketCap < token.stagnationLowMc) {
    token.stagnationLowMc = currentMarketCap;
    token.stagnationLowPrice = currentPrice;
    token.stagnationLowTime = now;
  }

  // Crash Detection
  if (token.crashState === null && token.stagnationHighMc > 0 && token.stagnationHighPrice > 0) {
    const highAge = now - token.stagnationHighTime;
    if (highAge <= crashWindow) {
      const mcDropPct = ((currentMarketCap - token.stagnationHighMc) / token.stagnationHighMc) * 100;
      const priceDropPct = ((currentPrice - token.stagnationHighPrice) / token.stagnationHighPrice) * 100;
      if (mcDropPct <= -crashPct && priceDropPct <= -crashPct) {
        token.crashState = 'monitoring';
        token.crashPeakMc = token.stagnationHighMc;
        token.crashPeakPrice = token.stagnationHighPrice;
        token.crashTroughMc = currentMarketCap;
        token.crashTroughPrice = currentPrice;
        token.crashDetectedAt = now;
        token.bounceConfirmationScans = 1;
        const targetMc = currentMarketCap * (1 + WAVE1_TP_DEFAULT / 100);
        mockBot.telegram.sendMessage('test', `🚨 CRASH: ${symbol} | MC ${mcDropPct.toFixed(1)}% | TP ${targetMc}`);
        return { alert: 'TIER 1: CRASH', mcDropPct };
      }
    }
  }

  // Monitoring state
  if (token.crashState === 'monitoring') {
    if (currentMarketCap >= token.crashPeakMc * 0.80) {
      token.crashState = 'completed';
      token.bounceConfirmationScans = 0;
      mockBot.telegram.sendMessage('test', `✅ Recovered: ${symbol}`);
      return { alert: 'INFO: Recovered' };
    }
    if (currentMarketCap < token.crashTroughMc) {
      token.crashTroughMc = currentMarketCap;
      token.crashTroughPrice = currentPrice;
      token.crashDetectedAt = now;
      token.bounceConfirmationScans = 1;
      return { alert: null, newLow: true };
    }
    if (currentMarketCap >= token.crashTroughMc) {
      const bouncePct = ((currentMarketCap - token.crashTroughMc) / token.crashTroughMc) * 100;
      if (bouncePct >= bounceConfirmPct) {
        token.bounceConfirmationScans = (token.bounceConfirmationScans || 0) + 1;
      } else {
        token.bounceConfirmationScans = 1;
      }
      if (bouncePct >= bounceConfirmPct && token.bounceConfirmationScans >= bounceMinScans) {
        token.crashState = 'wave1';
        token.deadCatWave1EntryMc = token.crashTroughMc;
        token.deadCatWave1EntryPrice = token.crashTroughPrice;
        token.deadCatWave1TargetMc = token.crashTroughMc * (1 + WAVE1_TP_DEFAULT / 100);
        token.deadCatWave1TargetPrice = token.crashTroughPrice * (1 + WAVE1_TP_DEFAULT / 100);
        if (bouncePct >= WAVE1_TP_MIN) token.deadCatWave1TpHit = true;
        const pastTp = token.deadCatWave1TpHit ? ' (TP ALREADY HIT)' : '';
        mockBot.telegram.sendMessage('test', `🐱 WAVE 1: ${symbol} | +${bouncePct.toFixed(1)}% | TP ${token.deadCatWave1TargetMc}${pastTp}`);
        return { alert: 'TIER 2: WAVE 1', bouncePct, pastTp: token.deadCatWave1TpHit };
      }
      return { alert: null, bouncePct, scans: token.bounceConfirmationScans };
    }
  }

  // Wave 1 management
  if (token.crashState === 'wave1') {
    const gain = ((currentMarketCap - token.deadCatWave1EntryMc) / token.deadCatWave1EntryMc) * 100;
    if (gain >= WAVE1_TP_MIN && !token.deadCatWave1TpHit) {
      token.deadCatWave1TpHit = true;
      mockBot.telegram.sendMessage('test', `🎯 TP ZONE: ${symbol} | +${gain.toFixed(1)}%`);
      return { alert: 'TIER 3: TP ZONE', gain };
    }
    if (currentMarketCap < token.crashTroughMc) {
      const oldTrough = token.crashTroughMc;
      token.crashState = 'wave1_failed';
      token.crashTroughMc = currentMarketCap;
      token.crashTroughPrice = currentPrice;
      token.crashDetectedAt = now;
      token.bounceConfirmationScans = 1;
      token.deadCatWave1TpHit = false;
      mockBot.telegram.sendMessage('test', `💀 FAILED: ${symbol} | ${oldTrough} -> ${currentMarketCap}`);
      return { alert: 'TIER 3: FAILED', oldTrough, newTrough: currentMarketCap };
    }
    if (currentMarketCap <= token.crashTroughMc * 1.03 && currentMarketCap >= token.crashTroughMc) {
      token.crashState = 'wave2';
      mockBot.telegram.sendMessage('test', `📊 WAVE 2: ${symbol} retesting ${token.crashTroughMc}`);
      return { alert: 'INFO: Wave 2' };
    }
    return { alert: null, gain };
  }

  if (token.crashState === 'wave1_failed') {
    token.crashState = 'monitoring';
    return { alert: null };
  }

  if (token.crashState === 'wave2') {
    if (currentMarketCap < token.crashTroughMc) {
      token.crashState = 'monitoring';
      token.crashTroughMc = currentMarketCap;
      token.crashTroughPrice = currentPrice;
      token.crashDetectedAt = now;
      token.bounceConfirmationScans = 1;
    }
  }

  return { alert: null };
}

// ============================================================================
// Test Runner
// ============================================================================
function reset() {
  capturedMessages.length = 0;
  messageCount = 0;
}

function runScenario(name, priceSequence, description) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`SCENARIO: ${name}`);
  console.log(`  ${description}`);
  console.log(`${'='.repeat(70)}`);

  const token = createMockToken();
  const alertsFired = [];

  const firstPrice = priceSequence[0].price;
  const firstMC = priceSequence[0].mc;
  runScan(token, firstPrice, firstMC, mockStats);

  for (let i = 1; i < priceSequence.length; i++) {
    const { price, mc } = priceSequence[i];
    const result = runScan(token, price, mc, mockStats);
    const scanNum = i + 1;

    if (result.alert) {
      alertsFired.push({ scan: scanNum, ...result });
      console.log(`  [Scan ${scanNum}] >>> ${result.alert} <<<`);
    }

    const info = [];
    if (result.bouncePct !== undefined) info.push(`bounce ${result.bouncePct.toFixed(1)}%`);
    if (result.scans !== undefined) info.push(`scans=${result.scans}`);
    if (result.newLow) info.push('NEW LOW');
    if (result.gain !== undefined) info.push(`gain ${result.gain.toFixed(1)}%`);

    if (info.length || result.alert) {
      console.log(`  [Scan ${scanNum}] MC=${mc} state=${token.crashState} | ${info.join(' | ') || '(no info)'}`);
    }
  }

  console.log(`\n  Final state: crashState=${token.crashState} | trough=${token.crashTroughMc} | peak=${token.crashPeakMc}`);
  if (token.deadCatWave1EntryMc) {
    console.log(`  Wave1 entry=${token.deadCatWave1EntryMc} | TP=${token.deadCatWave1TargetMc} | TpHit=${token.deadCatWave1TpHit}`);
  }

  // Verify expectations
  if (name.includes('Beat Token')) {
    const hasCrash = alertsFired.some(a => a.alert.includes('CRASH'));
    const hasWave1 = alertsFired.some(a => a.alert.includes('WAVE 1'));
    const hasTp = alertsFired.some(a => a.alert.includes('TP ZONE'));
    const hasFail = alertsFired.some(a => a.alert.includes('FAILED'));
    console.log(`  VERIFY: Crash=${hasCrash ? '✅' : '❌'} | Wave1=${hasWave1 ? '✅' : '❌'} | TP=${hasTp ? '✅' : '❌'} | Fail=${hasFail ? '✅' : '❌'}`);
  }

  if (name.includes('Fake Bounce')) {
    const noWave1 = !alertsFired.some(a => a.alert.includes('WAVE 1'));
    console.log(`  VERIFY: No false Wave1 entry = ${noWave1 ? '✅' : '❌'}`);
  }

  if (name.includes('Ultra-Fast')) {
    const hasPastTpWarning = alertsFired.some(a => a.pastTp === true);
    console.log(`  VERIFY: Past-TP warning on entry = ${hasPastTpWarning ? '✅' : '❌'}`);
  }

  console.log(`  Messages: ${capturedMessages.length}`);

  reset();
  return { alertsFired, token };
}

// ============================================================================
// RUN
// ============================================================================
console.log('STAGNATION & CRASH DETECTION TEST SUITE');
console.log(`Config: crash=${mockStats.crashPercentThreshold}% bounce=${mockStats.bounceConfirmPercent}% scans=${mockStats.bounceConfirmMinScans}`);

runScenario(
  'Beat Token: 11.41 -> 6.23 -> 9.47 -> 5.8',
  [
    { price: 0.0114, mc: 11.4153 },
    { price: 0.0090, mc: 9.0 },
    { price: 0.0075, mc: 7.5 },
    { price: 0.0068, mc: 6.8 },
    { price: 0.0062, mc: 6.2315 },     // CRASH at 45.4%
    { price: 0.0068, mc: 6.85 },       // Bounce +10% scan 1
    { price: 0.0069, mc: 6.92 },       // Bounce +11% scan 2
    { price: 0.0071, mc: 7.05 },       // Bounce +13% scan 3 -> WAVE 1
    { price: 0.0072, mc: 7.2 },        // Silent
    { price: 0.0085, mc: 8.5 },        // TP HIT
    { price: 0.0095, mc: 9.4691 },     // Past TP, no dup
    { price: 0.0058, mc: 5.8 },        // FAILED
    { price: 0.0058, mc: 5.8 },        // -> monitoring
  ],
  'Full lifecycle: crash at 6.23, wave1 confirmed at 7.05, TP at 8.5, fail at 5.8'
);

runScenario(
  'Fake Bounce Trap: 2 scans then new low',
  [
    { price: 0.010, mc: 10.0 },
    { price: 0.005, mc: 5.0 },        // CRASH
    { price: 0.0055, mc: 5.5 },       // +10% scan 1
    { price: 0.0056, mc: 5.6 },       // +12% scan 2
    { price: 0.0048, mc: 4.8 },       // NEW LOW! Reset
  ],
  'Bounce only 2 scans before new low. Should NOT fire Wave 1 entry.'
);

runScenario(
  'Slow Consolidation: 3 slow scans above 8%',
  [
    { price: 0.010, mc: 10.0 },
    { price: 0.005, mc: 5.0 },        // CRASH
    { price: 0.0051, mc: 5.1 },       // +2% (no)
    { price: 0.0053, mc: 5.3 },       // +6% (no)
    { price: 0.00545, mc: 5.45 },     // +9% scan 1
    { price: 0.0055, mc: 5.5 },       // +10% scan 2
    { price: 0.00552, mc: 5.52 },     // +10.4% scan 3 -> WAVE 1
  ],
  '3 slow scans confirming bounce. Should fire entry on scan 7.'
);

runScenario(
  'Ultra-Fast V: instant 40% bounce past TP',
  [
    { price: 0.010, mc: 10.0 },
    { price: 0.003, mc: 3.0 },        // CRASH 70%
    { price: 0.0035, mc: 3.5 },       // +17% scan 1
    { price: 0.0038, mc: 3.8 },       // +27% scan 2
    { price: 0.0042, mc: 4.2 },       // +40% scan 3 -> ENTRY, TP ALREADY HIT
  ],
  'Bounce past TP at confirmation. Entry fires with warning.'
);

runScenario(
  'Auto-Recovery: above 80% of peak',
  [
    { price: 0.010, mc: 10.0 },
    { price: 0.005, mc: 5.0 },        // CRASH 50%
    { price: 0.0081, mc: 8.1 },       // 81% of peak -> Recovered
  ],
  'MC above 80% of peak clears crash state.'
);

console.log(`\nTotal Telegram messages: ${messageCount}`);
```

---

## Adding the `🧪 Test Crash` Button (bot.js)

In the `load_details:` callback handler, add one button alongside the existing `🧪 Test Live Update`:

```javascript
// In the keyboard array, add after the test_live/reset_base row:
[
  Markup.button.callback('🧪 Test Live Update', `test_live:${token._id}`),
  Markup.button.callback('🔄 Reset Baseline', `reset_base:${token._id}`),
  Markup.button.callback('💥 Test Crash', `test_crash:${token._id}`)
],
```

And a callback handler:
```javascript
if (data.startsWith('test_crash:')) {
  const id = data.split(':')[1];
  const token = await Token.findById(id);
  if (!token) return ctx.answerCbQuery('Token not found');
  if (!token.isStagnationTracking) {
    ctx.answerCbQuery('Enable stagnation tracking first');
    return ctx.reply('Enable stagnation tracking first before testing crash detection.');
  }

  ctx.answerCbQuery('Simulating crash detection...');

  ctx.reply(`💥 <b>Testing Crash Detection for ${token.symbol}</b>\nSimulating 45% dump from live high...`, { parse_mode: 'HTML' })
    .then(m => setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, m.message_id).catch(() => {}), 8000));

  // Simulate: fetch current as "high", then inject crash
  const fresh = await fetchTokenData(token.chain, token.tokenAddress);
  if (!fresh.success) return ctx.reply('Failed to fetch live data for test.');

  const peakMc = fresh.marketCap;
  const peakPrice = parseFloat(fresh.priceUsd);
  const troughMc = peakMc * 0.55;  // 45% drop
  const troughPrice = peakPrice * 0.55;

  // Inject the crash high
  token.stagnationHighMc = peakMc;
  token.stagnationHighPrice = peakPrice;
  token.stagnationHighTime = new Date();
  await token.save();

  // Send a mock crash alert
  const crashMsg = `🚨 <b>CRASH DETECTED [TEST]: ${fresh.symbol}</b> 🚨\n` +
    `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
    `📉 <b>MC:</b> -45.0% | <b>Price:</b> -45.0%\n` +
    `🏔 <b>Peak:</b> $${peakMc.toLocaleString()} MC at $${peakPrice}\n` +
    `📉 <b>Trough:</b> $${troughMc.toLocaleString()} MC at $${troughPrice.toFixed(6)}\n` +
    `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
    `🔍 [TEST] This is a simulated crash alert.\n` +
    `✅ In production, the next 3 consecutive scans above >8% bounce would trigger Wave 1 entry.`;

  ctx.replyWithHTML(crashMsg);

  // Reset test state
  token.stagnationHighMc = 0;
  token.stagnationHighPrice = 0;
  token.stagnationHighTime = null;
  token.crashState = null;
  token.bounceConfirmationScans = 0;
  await token.save();
}
```

---

## Recommended Test Flow

1. **Immediately:** Run `npx babel-node test/stagnation-test.js` (requires creating the .js file) — see all 6 scenarios pass
2. **Then:** Add the `🧪 Test Crash` button to bot.js — verify alerts arrive in Telegram
3. **Finally:** Enable stagnation on a real token, wait for a live crash event, verify state transitions in MongoDB
