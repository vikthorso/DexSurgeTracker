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
  crashWindowMs: 86400000,
  stagnationWindowMs: 14400000,
  stagnationPercent: 5,
  stagnationCooldownMs: 3600000,
  bounceConfirmPercent: 8,
  bounceConfirmMinScans: 3,
  deadCatBounceEnabled: true,
};

// ============================================================================
// Mock: Token state
// ============================================================================
function createMockToken() {
  return {
    symbol: 'TEST', tokenId: 'solana:TEST123', chain: 'solana',
    tokenAddress: 'TEST123', userId: 'test-user',
    isActive: true, isStagnationTracking: true, scanCount: 0,
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
    sendMessage: function(chatId, text) {
      messageCount++;
      const tier = text.includes('CRASH') ? 'TIER 1'
        : text.includes('WAVE 1') ? 'TIER 2'
        : text.includes('TP ZONE') || text.includes('FAILED') ? 'TIER 3'
        : 'INFO';
      capturedMessages.push({ tier, text: text.replace(/<[^>]+>/g, '').substring(0, 130) });
      return Promise.resolve({ message_id: messageCount });
    },
  },
};

// ============================================================================
// Core Logic (mirrors monitor.js exactly)
// ============================================================================
const WAVE1_TP_MIN = 10;
const WAVE1_TP_DEFAULT = 20;

function runScan(token, priceUsd, marketCap) {
  const now = new Date();
  const symbol = token.symbol;
  const currentPrice = priceUsd;
  const currentMarketCap = marketCap;
  const crashPct = mockStats.crashPercentThreshold;
  const crashWindow = mockStats.crashWindowMs;
  const bounceConfirmPct = mockStats.bounceConfirmPercent;
  const bounceMinScans = mockStats.bounceConfirmMinScans;

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
        token.bounceConfirmationScans = 0;  // start at 0
        mockBot.telegram.sendMessage('test', `CRASH: ${symbol} | MC ${mcDropPct.toFixed(1)}%`);
        return { alert: 'TIER 1: CRASH', mcDropPct };
      }
    }
  }

  // Monitoring state
  if (token.crashState === 'monitoring') {
    if (currentMarketCap >= token.crashPeakMc * 0.80) {
      token.crashState = 'completed';
      token.bounceConfirmationScans = 0;
      mockBot.telegram.sendMessage('test', `Recovered: ${symbol}`);
      return { alert: 'INFO: Recovered' };
    }
    if (currentMarketCap < token.crashTroughMc) {
      token.crashTroughMc = currentMarketCap;
      token.crashTroughPrice = currentPrice;
      token.crashDetectedAt = now;
      token.bounceConfirmationScans = 0;  // reset
      return { alert: null, newLow: true };
    }
    if (currentMarketCap >= token.crashTroughMc) {
      const bouncePct = ((currentMarketCap - token.crashTroughMc) / token.crashTroughMc) * 100;
      if (bouncePct >= bounceConfirmPct) {
        token.bounceConfirmationScans = (token.bounceConfirmationScans || 0) + 1;
      } else {
        token.bounceConfirmationScans = 0;
      }
      if (bouncePct >= bounceConfirmPct && token.bounceConfirmationScans >= bounceMinScans) {
        token.crashState = 'wave1';
        token.deadCatWave1EntryMc = token.crashTroughMc;
        token.deadCatWave1EntryPrice = token.crashTroughPrice;
        token.deadCatWave1TargetMc = token.crashTroughMc * (1 + WAVE1_TP_DEFAULT / 100);
        token.deadCatWave1TargetPrice = token.crashTroughPrice * (1 + WAVE1_TP_DEFAULT / 100);
        if (bouncePct >= WAVE1_TP_MIN) token.deadCatWave1TpHit = true;
        const pastTp = token.deadCatWave1TpHit ? ' (TP ALREADY HIT)' : '';
        mockBot.telegram.sendMessage('test', `WAVE 1: ${symbol} | +${bouncePct.toFixed(1)}%${pastTp}`);
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
      mockBot.telegram.sendMessage('test', `TP ZONE: ${symbol} | +${gain.toFixed(1)}%`);
      return { alert: 'TIER 3: TP ZONE', gain };
    }
    if (currentMarketCap < token.crashTroughMc) {
      const oldTrough = token.crashTroughMc;
      token.crashState = 'wave1_failed';
      token.crashTroughMc = currentMarketCap;
      token.crashTroughPrice = currentPrice;
      token.crashDetectedAt = now;
      token.bounceConfirmationScans = 0;
      token.deadCatWave1TpHit = false;
      mockBot.telegram.sendMessage('test', `FAILED: ${symbol} | ${oldTrough} -> ${currentMarketCap}`);
      return { alert: 'TIER 3: FAILED', oldTrough, newTrough: currentMarketCap };
    }
    if (currentMarketCap <= token.crashTroughMc * 1.03 && currentMarketCap >= token.crashTroughMc) {
      token.crashState = 'wave2';
      mockBot.telegram.sendMessage('test', `WAVE 2: ${symbol} retesting`);
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
      token.bounceConfirmationScans = 0;
    }
  }

  return { alert: null };
}

// ============================================================================
// Test Runner
// ============================================================================
function reset() { capturedMessages.length = 0; messageCount = 0; }

function runScenario(name, priceSequence, description, expect) {
  console.log(`\n${'='.repeat(65)}`);
  console.log(`SCENARIO: ${name}`);
  console.log(`  ${description}`);
  console.log(`${'='.repeat(65)}`);

  const token = createMockToken();
  const alertsFired = [];

  runScan(token, priceSequence[0].price, priceSequence[0].mc);

  for (let i = 1; i < priceSequence.length; i++) {
    const { price, mc } = priceSequence[i];
    const result = runScan(token, price, mc);
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
      console.log(`  [Scan ${scanNum}] MC=${mc} state=${token.crashState || 'null'} | ${info.join(' | ') || '(ok)'}`);
    }
  }

  console.log(`\n  Final: state=${token.crashState} trough=${token.crashTroughMc} peak=${token.crashPeakMc}`);

  // Verify
  const results = {};
  results.crash = alertsFired.some(a => a.alert.includes('CRASH'));
  results.wave1 = alertsFired.some(a => a.alert && a.alert.includes('WAVE 1') && !a.alert.includes('WAVE 2'));
  results.tp = alertsFired.some(a => a.alert && a.alert.includes('TP ZONE'));
  results.fail = alertsFired.some(a => a.alert && a.alert.includes('FAILED'));

  if (expect) {
    const passed = Object.entries(expect).every(([k, v]) => results[k] === v);
    const verdict = passed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED';
    console.log(`  ${verdict}`);
    Object.entries(expect).forEach(([k, v]) => {
      console.log(`    ${k}: expected=${v} got=${results[k]} ${results[k] === v ? '✅' : '❌'}`);
    });
  }

  reset();
  return { alertsFired, token, results };
}

// ============================================================================
// RUN
// ============================================================================
console.log('STAGNATION & CRASH DETECTION TEST SUITE');
console.log(`Config: crash=${mockStats.crashPercentThreshold}% bounce=${mockStats.bounceConfirmPercent}% scans=${mockStats.bounceConfirmMinScans}\n`);

// A: Beat Token - full lifecycle
runScenario(
  'Beat Token: 11.41 -> 6.23 crash -> bounce to 9.47 -> fail to 5.8',
  [
    { price: 0.0114, mc: 11.4153 },
    { price: 0.0090, mc: 9.0 },
    { price: 0.0062, mc: 6.2315 },     // CRASH 45.4%
    { price: 0.0068, mc: 6.85 },       // Bounce +10% scan 1
    { price: 0.0069, mc: 6.92 },       // Bounce +11% scan 2
    { price: 0.0071, mc: 7.05 },       // Bounce +13% scan 3 -> WAVE 1
    { price: 0.0085, mc: 8.5 },        // TP HIT
    { price: 0.0058, mc: 5.8 },        // FAILED
  ],
  'Crash -> 3 scan bounce -> Wave1 -> TP -> fail',
  { crash: true, wave1: true, fail: true }  // TP was already hit at Wave1 confirmation — no separate alert expected
);

// B: Fake bounce trap
runScenario(
  'Fake Bounce Trap: 2 qualifying scans then new low',
  [
    { price: 0.010, mc: 10.0 },
    { price: 0.005, mc: 5.0 },        // CRASH
    { price: 0.0055, mc: 5.5 },       // +10% scan 1
    { price: 0.0056, mc: 5.6 },       // +12% scan 2
    { price: 0.0048, mc: 4.8 },       // NEW LOW! reset
  ],
  'Bounce holds 2 qualifying scans then new low. Should NOT fire Wave 1.',
  { crash: true, wave1: false, fail: false }
);

// C: Slow bleed then bounce
runScenario(
  'Slow Consolidation: 3 slow qualifying scans',
  [
    { price: 0.010, mc: 10.0 },
    { price: 0.005, mc: 5.0 },        // CRASH
    { price: 0.0051, mc: 5.1 },       // +2% (not qualifying) -> scans=0
    { price: 0.0053, mc: 5.3 },       // +6% (not qualifying) -> scans=0
    { price: 0.00545, mc: 5.45 },     // +9% (qualifying) -> scans=1
    { price: 0.0055, mc: 5.5 },       // +10% -> scans=2
    { price: 0.00552, mc: 5.52 },     // +10.4% -> scans=3 -> WAVE 1
  ],
  '3 slow scans confirming bounce after failed attempts.',
  { crash: true, wave1: true, tp: false }
);

// D: Ultra-fast V-bounce past TP
runScenario(
  'Ultra-Fast V: 40% bounce past TP at confirmation',
  [
    { price: 0.010, mc: 10.0 },
    { price: 0.003, mc: 3.0 },        // CRASH 70%
    { price: 0.0035, mc: 3.5 },       // +17% scan 1
    { price: 0.0038, mc: 3.8 },       // +27% scan 2
    { price: 0.0042, mc: 4.2 },       // +40% scan 3 -> ENTRY with TP ALREADY HIT
  ],
  'Bounce past TP at confirmation — entry fires with warning.',
  { crash: true, wave1: true }
);

// E: Auto-recovery
runScenario(
  'Auto-Recovery: above 80% of peak',
  [
    { price: 0.010, mc: 10.0 },
    { price: 0.005, mc: 5.0 },        // CRASH
    { price: 0.0081, mc: 8.1 },       // 81% -> recovered
  ],
  'MC above 80% of peak clears crash state.',
  { crash: true }
);

console.log(`\nAll scenarios complete. Messages captured: ${messageCount}`);
