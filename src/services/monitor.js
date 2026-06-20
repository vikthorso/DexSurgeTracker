import { Alert } from '../models/Alert.js';
import { Stats } from '../models/Stats.js';
import { Token } from '../models/Token.js';
import { fetchTokenData } from './dexScreener.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Stagnation & Crash Detection Constants ---
const WAVE1_TP_MIN = 10;      // 10% minimum TP from trough
const WAVE1_TP_MAX = 30;      // 30% maximum TP (beyond this = overshoot warning)
const WAVE1_TP_DEFAULT = 20;  // Default TP suggestion (20%)

/**
 * Generates a sentiment bar and summary stats for a token.
 */
export const getSentimentInfo = async (tokenId, windowHours = 4) => {
  const now = new Date();
  const getStats = async (hours) => {
    const since = new Date(now - hours * 60 * 60 * 1000);
    const alerts = await Alert.find({ tokenId, timestamp: { $gte: since } });
    const bullish = alerts.filter(a => a.marketCapChange > 0).length;
    const bearish = alerts.filter(a => a.marketCapChange < 0).length;
    const total = bullish + bearish;
    return { bullish, bearish, total };
  };

  const s4h = await getStats(windowHours);
  const s24h = await getStats(24);
  const s7d = await getStats(24 * 7);

  let bar = '⚪️⚪️⚪️⚪️⚪️⚪️⚪️⚪️⚪️⚪️';
  let ratioText = 'No recent data';

  if (s4h.total > 0) {
    const bullPercent = (s4h.bullish / s4h.total) * 100;
    const greenBlocks = Math.round(bullPercent / 10);
    const redBlocks = 10 - greenBlocks;
    bar = '🟩'.repeat(greenBlocks) + '🟥'.repeat(redBlocks);
    ratioText = `${bullPercent.toFixed(0)}% Bullish`;
  }

  return `📊 *Sentiment (${windowHours}h):*\n` +
         `${bar} ${ratioText}\n\n` +
         `📅 *Historical Summary:*\n` +
         `• 24h: ${s24h.bullish} 🟩 | ${s24h.bearish} 🟥\n` +
         `• 7d:  ${s7d.bullish} 🟩 | ${s7d.bearish} 🟥`;
};

export const runMonitor = async (bot) => {
  try {
    const activeTokens = await Token.find({ isActive: true });
    
    // Fetch or create global stats
    let globalStats = await Stats.findOne();
    if (!globalStats) globalStats = new Stats();

    console.log(`[Monitor] [${new Date().toLocaleTimeString()}] Checking ${activeTokens.length} active tokens...`);

    for (const token of activeTokens) {
      try {
      const now = new Date();
      const tokenId = token.symbol || token.tokenId;
      console.log(`[Monitor] [${now.toLocaleTimeString()}] Starting scan for ${tokenId}...`);

      // Respect inter-token delay to avoid rate limits
      if (globalStats.tokenDelayMs > 0) {
        await sleep(globalStats.tokenDelayMs);
      }

      const data = await fetchTokenData(token.chain, token.tokenAddress);
      
      // Increment scan counts
      token.scanCount = (token.scanCount || 0) + 1;
      globalStats.totalScans += 1;

      if (!data.success) {
        console.warn(`[Monitor] Scan failed for ${tokenId}: ${data.error}`);
        await token.save();
        continue;
      }

      console.log(`[Monitor] Scan successful for ${tokenId}. Price: $${data.priceUsd}. Total scans: ${token.scanCount}`);

      const currentMarketCap = data.marketCap;
      const currentM5 = data.volumeM5;
      const currentH1 = data.volumeH1;

      // Skip if it's the first time we fetch data (prev values are 0)
      if (token.lastMarketCap === 0 && token.lastVolumeM5 === 0 && token.lastVolumeH1 === 0) {
        token.lastMarketCap = currentMarketCap;
        token.lastLiveMc = currentMarketCap; // Initialize live MC baseline
        token.lastVolumeM5 = currentM5;
        token.lastVolumeH1 = currentH1;
        await token.save();
        continue;
      }

      // --- LIVE TRACKING LOGIC ---
      if (token.isLiveTracking && token.lastLiveMc > 0) {
        // Update Peak and Trough
        if (currentMarketCap > token.livePeakMc) token.livePeakMc = currentMarketCap;
        if (token.liveTroughMc === 0 || currentMarketCap < token.liveTroughMc) token.liveTroughMc = currentMarketCap;

        const liveMcChange = ((currentMarketCap - token.lastLiveMc) / token.lastLiveMc) * 100;
        const absLiveChange = Math.abs(liveMcChange);

        // Diagnostic log
        console.log(`[LiveTracking] ${tokenId}: ${liveMcChange.toFixed(2)}% move. Streak: ${token.liveConsecutiveCount || 0}/${globalStats.liveConsecutiveThreshold || 2} ${token.liveConsecutiveType || 'none'}`);

        if (absLiveChange >= (globalStats.liveTrackThreshold || 10)) {
          const type = liveMcChange > 0 ? 'bullish' : 'bearish';
          
          // Consecutive Logic
          if (token.liveConsecutiveType === type) {
            token.liveConsecutiveCount = (token.liveConsecutiveCount || 0) + 1;
          } else {
            // Direction flip resets streak for the NEW direction
            token.liveConsecutiveType = type;
            token.liveConsecutiveCount = 1;
          }

          console.log(`[LiveTracking] ${tokenId}: THRESHOLD MET! Streak now: ${token.liveConsecutiveCount} ${type}`);

          // Reset baseline for next comparison
          token.lastLiveMc = currentMarketCap; 

          // Only proceed with alert if threshold is met
          if (token.liveConsecutiveCount >= (globalStats.liveConsecutiveThreshold || 2)) {
            const isBullish = type === 'bullish';
            const statusEmoji = isBullish ? '📈 Bullish' : '📉 Bearish';
            const directionText = isBullish ? 'making progress' : 'falling';
            
            // Add to Alert DB for sentiment tracking
            const alertSnapshot = new Alert({
              tokenId: token.tokenId,
              chain: token.chain,
              tokenAddress: token.tokenAddress,
              priceUsd: data.priceUsd,
              marketCap: currentMarketCap,
              volumeM5: currentM5,
              volumeH1: currentH1,
              marketCapChange: liveMcChange,
              volumeChange: 0,
              triggerSource: 'm5',
              timestamp: now
            });
            await alertSnapshot.save();

            // Prepare Message Content
            let peakInfo = '';
            if (token.livePeakMc > 0) {
              const drawdown = ((currentMarketCap - token.livePeakMc) / token.livePeakMc) * 100;
              if (currentMarketCap >= token.livePeakMc) {
                peakInfo = `🚀 *NEW PEAK ACHIEVED!*`;
              } else {
                peakInfo = `🏔 *Last Peak:* $${token.livePeakMc.toLocaleString()}\n` +
                           `📉 *Drawdown:* ${drawdown.toFixed(2)}%`;
              }
            }

            const recovery = ((currentMarketCap - token.liveTroughMc) / token.liveTroughMc) * 100;
            const troughInfo = token.liveTroughMc > 0 ? `\n⤴️ *Recovery from Trough:* +${recovery.toFixed(2)}%` : '';

            const sentimentStats = await getSentimentInfo(token.tokenId, globalStats.sentimentWindowHours || 4);

            const fullMessage = `${statusEmoji} *LIVE: ${data.symbol}* ${statusEmoji}\n\n` +
                                `The token is *${directionText}*!\n` +
                                `*Market Cap:* $${currentMarketCap.toLocaleString()} (${liveMcChange.toFixed(2)}%)\n` +
                                `*Price:* $${data.priceUsd}\n\n` +
                                `${peakInfo}${troughInfo}\n\n` +
                                `${sentimentStats}\n\n` +
                                `_Updated at: ${now.toLocaleTimeString()} | Streak: ${token.liveConsecutiveCount} ${type}_`;

            const keyboard = [
              [{ text: '📈 View on DexScreener', url: data.dexUrl || `https://dexscreener.com/${token.chain}/${token.tokenAddress}` }],
              [{ text: '⏸ Stop Live Tracking', callback_data: `toggle_live:${token._id}` }]
            ];

            const isTrendFlip = token.lastReportedType && token.lastReportedType !== type;
            let mainMsgId = token.lastLiveMessageId;

            try {
              if (mainMsgId && !isTrendFlip) {
                // Try editing existing message
                await bot.telegram.editMessageText(token.userId, mainMsgId, null, fullMessage, {
                  parse_mode: 'Markdown',
                  reply_markup: { inline_keyboard: keyboard }
                });
              } else {
                // Trend flip or first message - Send New
                const msg = await bot.telegram.sendMessage(token.userId, fullMessage, {
                  parse_mode: 'Markdown',
                  reply_markup: { inline_keyboard: keyboard }
                });
                mainMsgId = msg.message_id;
                token.lastLiveMessageId = mainMsgId;
                token.lastReportedType = type;
              }

              // Send Summary Ping (Notification) replying to the main message
              const summaryText = `${statusEmoji} *${type.toUpperCase()}* update for *${data.symbol}* (+${liveMcChange.toFixed(1)}%)`;
              await bot.telegram.sendMessage(token.userId, summaryText, {
                parse_mode: 'Markdown',
                reply_to_message_id: mainMsgId
              });

            } catch (err) {
              console.error(`[Monitor] Telegram error for ${tokenId}:`, err.message);
              // If edit fails (message deleted/old), send a fresh one next time
              if (err.description?.includes('message to edit not found') || err.description?.includes('message is not modified')) {
                token.lastLiveMessageId = null;
              }
            }
          }
        }
      }

      // --- STAGNATION & CRASH DETECTION ---
      if (token.isStagnationTracking) {

        // ---- Update rolling high/low with MC + price ----
        const currentPrice = parseFloat(data.priceUsd) || 0;

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

        // ---- Crash Detection: Dual MC + price confirmation ----
        const crashPct = globalStats.crashPercentThreshold || 40;
        const crashWindow = globalStats.crashWindowMs || 86400000;
        const bounceConfirmPct = globalStats.bounceConfirmPercent || 8;
        const bounceMinScans = globalStats.bounceConfirmMinScans || 3;

        if (token.crashState === null && token.stagnationHighMc > 0 && token.stagnationHighPrice > 0) {
          const highAge = now - new Date(token.stagnationHighTime);

          if (highAge <= crashWindow) {
            const mcDropPct = ((currentMarketCap - token.stagnationHighMc) / token.stagnationHighMc) * 100;
            const priceDropPct = ((currentPrice - token.stagnationHighPrice) / token.stagnationHighPrice) * 100;

            const mcCrashed = mcDropPct <= -crashPct;
            const priceCrashed = priceDropPct <= -crashPct;

            if (mcCrashed && priceCrashed) {
              // TIER 1: CRASH DETECTED
              token.crashState = 'monitoring';
              token.crashPeakMc = token.stagnationHighMc;
              token.crashPeakPrice = token.stagnationHighPrice;
              token.crashTroughMc = currentMarketCap;
              token.crashTroughPrice = currentPrice;
              token.crashDetectedAt = now;
              token.bounceConfirmationScans = 0;  // Start at 0 — first qualifying scan sets to 1

              console.log(`[Stagnation] CRASH DETECTED for ${tokenId}: MC ${mcDropPct.toFixed(1)}%, Price ${priceDropPct.toFixed(1)}%`);

              // Send Tier 1 Crash Alert
              const targetMc = currentMarketCap * (1 + WAVE1_TP_DEFAULT / 100);
              const crashMsg = `🚨 <b>CRASH DETECTED: ${data.symbol}</b> 🚨\n` +
                `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
                `📉 <b>MC:</b> ${mcDropPct.toFixed(1)}% | <b>Price:</b> ${priceDropPct.toFixed(1)}%\n` +
                `🏔 <b>Peak:</b> $${token.crashPeakMc.toLocaleString()} MC at $${token.crashPeakPrice}\n` +
                `📉 <b>Trough:</b> $${currentMarketCap.toLocaleString()} MC at $${currentPrice}\n` +
                `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
                `🔍 Monitoring for dead cat bounce...\n` +
                `✅ Entry triggers when: bounce ≥${bounceConfirmPct}% and holds for ${bounceMinScans} consecutive scans\n` +
                `🎯 Wave 1 TP target: +${WAVE1_TP_DEFAULT}% from trough = $${targetMc.toLocaleString()}`;

              bot.telegram.sendMessage(token.userId, crashMsg, { parse_mode: 'HTML' }).catch(() => {});
            }
          }
        }

        // ---- Bounce Confirmation (monitoring state) ----
        if (token.crashState === 'monitoring') {
          // Auto-recovery: MC recovers above 80% of crash peak
          if (currentMarketCap >= token.crashPeakMc * 0.80) {
            token.crashState = 'completed';
            token.bounceConfirmationScans = 0;
            console.log(`[Stagnation] ${tokenId}: Crash recovered — MC above 80% of peak`);
            bot.telegram.sendMessage(token.userId,
              `✅ <b>Crash Recovered: ${data.symbol}</b>\nMC recovered above 80% of crash peak — monitoring cleared.`,
              { parse_mode: 'HTML' }
            ).catch(() => {});
          }

          // New low made — reset everything
          if (currentMarketCap < token.crashTroughMc) {
            token.crashTroughMc = currentMarketCap;
            token.crashTroughPrice = currentPrice;
            token.crashDetectedAt = now;
            token.bounceConfirmationScans = 0;  // reset: next qualifying scan increments to 1
            console.log(`[Stagnation] ${tokenId}: New crash low at ${currentMarketCap}`);
          }

          // Price above trough — count consecutive qualifying scans
          if (currentMarketCap >= token.crashTroughMc) {
            const bouncePct = ((currentMarketCap - token.crashTroughMc) / token.crashTroughMc) * 100;

            if (bouncePct >= bounceConfirmPct) {
              token.bounceConfirmationScans = (token.bounceConfirmationScans || 0) + 1;
            } else {
              token.bounceConfirmationScans = 0;
            }

            console.log(`[Stagnation] ${tokenId}: Bounce ${bouncePct.toFixed(1)}% | Scans: ${token.bounceConfirmationScans}/${bounceMinScans}`);

            // CHECK: bounce confirmed?
            if (bouncePct >= bounceConfirmPct && token.bounceConfirmationScans >= bounceMinScans) {
              // TIER 2: WAVE 1 ENTRY
              token.crashState = 'wave1';
              token.deadCatWave1EntryMc = token.crashTroughMc;
              token.deadCatWave1EntryPrice = token.crashTroughPrice;
              token.deadCatWave1TargetMc = token.crashTroughMc * (1 + WAVE1_TP_DEFAULT / 100);
              token.deadCatWave1TargetPrice = token.crashTroughPrice * (1 + WAVE1_TP_DEFAULT / 100);

              if (bouncePct >= WAVE1_TP_MIN) {
                token.deadCatWave1TpHit = true;
              }

              const remainingPct = (WAVE1_TP_DEFAULT - bouncePct).toFixed(1);

              let wave1Msg;
              if (token.deadCatWave1TpHit) {
                // Bounce already past TP at confirmation time
                wave1Msg = `🐱 <b>WAVE 1 ENTRY: ${data.symbol}</b> 🐱\n` +
                  `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
                  `✅ Bounce confirmed: +${bouncePct.toFixed(1)}% from trough\n` +
                  `📉 <b>Crash Trough:</b> $${token.crashTroughMc.toLocaleString()}\n` +
                  `🎯 <b>TP target:</b> $${token.deadCatWave1TargetMc.toLocaleString()} — <b>REACHED</b> (+${WAVE1_TP_DEFAULT}%)\n` +
                  `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
                  `⚠️ Bounce already extended past TP zone\n` +
                  `📊 Watch for retest of $${token.crashTroughMc.toLocaleString()} for Wave 2 entry`;
              } else {
                wave1Msg = `🐱 <b>WAVE 1 ENTRY: ${data.symbol}</b> 🐱\n` +
                  `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
                  `✅ Bounce confirmed: +${bouncePct.toFixed(1)}% from trough\n` +
                  `📉 <b>Crash Trough:</b> $${token.crashTroughMc.toLocaleString()} MC at $${token.crashTroughPrice}\n` +
                  `💰 <b>Entry Zone:</b> $${token.deadCatWave1EntryMc.toLocaleString()} (entry reference = crash trough)\n` +
                  `🎯 <b>TP Target:</b> $${token.deadCatWave1TargetMc.toLocaleString()} (+${WAVE1_TP_DEFAULT}%)\n` +
                  `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
                  `📊 Bounce held for ${token.bounceConfirmationScans} consecutive scans\n` +
                  `⚡ Remaining upside to TP: +${remainingPct}%`;
              }

              console.log(`[Stagnation] ${tokenId}: WAVE 1 ENTRY! Bounce ${bouncePct.toFixed(1)}% | TP hit: ${token.deadCatWave1TpHit}`);
              bot.telegram.sendMessage(token.userId, wave1Msg, { parse_mode: 'HTML' }).catch(() => {});
            }
          }
        }

        // ---- Wave 1 Management (TP, Failure, Retest) ----
        if (token.crashState === 'wave1') {
          const gain = ((currentMarketCap - token.deadCatWave1EntryMc) / token.deadCatWave1EntryMc) * 100;

          // TP HIT
          if (gain >= WAVE1_TP_MIN && !token.deadCatWave1TpHit) {
            token.deadCatWave1TpHit = true;
            const tpMsg = `🎯 <b>TP ZONE REACHED: ${data.symbol}</b> 🎯\n` +
              `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
              `📈 <b>Gain:</b> +${gain.toFixed(1)}% from trough $${token.crashTroughMc.toLocaleString()}\n` +
              `💰 <b>Entry:</b> $${token.deadCatWave1EntryMc.toLocaleString()} → <b>Current:</b> $${currentMarketCap.toLocaleString()}\n` +
              `🎯 TP target $${token.deadCatWave1TargetMc.toLocaleString()} reached\n` +
              `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
              `📊 Manage position — consider partial TP\n` +
              `📉 Watch for retest of $${token.crashTroughMc.toLocaleString()} for Wave 2 entry`;

            console.log(`[Stagnation] ${tokenId}: TP ZONE REACHED +${gain.toFixed(1)}%`);
            bot.telegram.sendMessage(token.userId, tpMsg, { parse_mode: 'HTML' }).catch(() => {});
          }

          // FAILED BOUNCE: broke below original crash trough
          if (currentMarketCap < token.crashTroughMc) {
            const oldTroughMc = token.crashTroughMc;
            const oldTroughPrice = token.crashTroughPrice;

            token.crashState = 'wave1_failed';
            token.crashTroughMc = currentMarketCap;
            token.crashTroughPrice = currentPrice;
            token.crashDetectedAt = now;
            token.bounceConfirmationScans = 0;
            token.deadCatWave1TpHit = false;

            const failMsg = `💀 <b>DEAD CAT BOUNCE FAILED: ${data.symbol}</b> 💀\n` +
              `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
              `⚠️ Price broke below crash trough\n` +
              `📉 <b>Old Trough:</b> $${oldTroughMc.toLocaleString()} MC at $${oldTroughPrice}\n` +
              `📉 <b>New Trough:</b> $${currentMarketCap.toLocaleString()} MC at $${currentPrice}\n` +
              `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
              `🔄 New entry zone at $${currentMarketCap.toLocaleString()}\n` +
              `🔍 Monitoring for new bounce confirmation...\n` +
              `✅ Entry triggers: bounce ≥${bounceConfirmPct}% + ${bounceMinScans} scans`;

            console.log(`[Stagnation] ${tokenId}: BOUNCE FAILED. New trough: ${currentMarketCap}`);
            bot.telegram.sendMessage(token.userId, failMsg, { parse_mode: 'HTML' }).catch(() => {});
          }

          // Legitimate retest: within 3% above crash trough (not below)
          if (currentMarketCap <= token.crashTroughMc * 1.03 && currentMarketCap >= token.crashTroughMc) {
            token.crashState = 'wave2';
            const retestMsg = `📊 <b>WAVE 2 SETUP: ${data.symbol}</b>\n` +
              `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
              `🔄 Retesting crash low $${token.crashTroughMc.toLocaleString()}\n` +
              `📊 If holds, potential Wave 2 bounce opportunity`;
            console.log(`[Stagnation] ${tokenId}: Retesting trough — Wave 2 setup`);
            bot.telegram.sendMessage(token.userId, retestMsg, { parse_mode: 'HTML' }).catch(() => {});
          }
        }

        // ---- wave1_failed → transition back to monitoring ----
        if (token.crashState === 'wave1_failed') {
          token.crashState = 'monitoring';
        }

        // ---- Wave 2: track for new lows ----
        if (token.crashState === 'wave2') {
          if (currentMarketCap < token.crashTroughMc) {
            token.crashState = 'monitoring';
            token.crashTroughMc = currentMarketCap;
            token.crashTroughPrice = currentPrice;
            token.crashDetectedAt = now;
            token.bounceConfirmationScans = 0;
            console.log(`[Stagnation] ${tokenId}: New low during wave2, resetting to monitoring`);
          }
        }

        // ---- General Stagnation (non-crash tokens) ----
        if (token.crashState === null) {
          const stagWindow = globalStats.stagnationWindowMs || 14400000;
          const stagPct = globalStats.stagnationPercent || 5;
          const stagCooldown = globalStats.stagnationCooldownMs || 3600000;
          const cooldownOK = !token.stagnationAlertedAt || (now - new Date(token.stagnationAlertedAt) > stagCooldown);

          if (cooldownOK) {
            // LONG SIGNAL: no new low in stagnation window
            if (token.stagnationLowTime) {
              const timeSinceLow = now - new Date(token.stagnationLowTime);
              if (timeSinceLow >= stagWindow) {
                const pctFromLow = ((currentMarketCap - token.stagnationLowMc) / token.stagnationLowMc) * 100;
                if (pctFromLow >= stagPct) {
                  token.stagnationAlertedAt = now;
                  token.stagnationLastType = 'long';

                  const hoursSince = Math.floor(timeSinceLow / 3600000);
                  const longMsg = `📈 <b>STAGNATION LONG SIGNAL: ${data.symbol}</b>\n` +
                    `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
                    `⏰ ${hoursSince}hrs since last low\n` +
                    `📉 <b>Last Low:</b> $${token.stagnationLowMc.toLocaleString()} MC at $${token.stagnationLowPrice}\n` +
                    `📊 <b>Now:</b> $${currentMarketCap.toLocaleString()} MC (+${pctFromLow.toFixed(1)}% MC)\n` +
                    `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
                    `💡 Price stabilizing above recent low — potential reversal`;

                  console.log(`[Stagnation] ${tokenId}: LONG stagnation signal (+${pctFromLow.toFixed(1)}% from low, ${hoursSince}hrs)`);
                  bot.telegram.sendMessage(token.userId, longMsg, { parse_mode: 'HTML' }).catch(() => {});
                }
              }
            }

            // SHORT SIGNAL: no new high in stagnation window
            if (token.stagnationHighTime && (!token.stagnationAlertedAt || (now - new Date(token.stagnationAlertedAt) > stagCooldown))) {
              const timeSinceHigh = now - new Date(token.stagnationHighTime);
              if (timeSinceHigh >= stagWindow) {
                const pctFromHigh = ((currentMarketCap - token.stagnationHighMc) / token.stagnationHighMc) * 100;
                if (pctFromHigh <= -stagPct) {
                  token.stagnationAlertedAt = now;
                  token.stagnationLastType = 'short';

                  const hoursSince = Math.floor(timeSinceHigh / 3600000);
                  const shortMsg = `📉 <b>STAGNATION SHORT SIGNAL: ${data.symbol}</b>\n` +
                    `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
                    `⏰ ${hoursSince}hrs since last high\n` +
                    `📈 <b>Last High:</b> $${token.stagnationHighMc.toLocaleString()} MC at $${token.stagnationHighPrice}\n` +
                    `📊 <b>Now:</b> $${currentMarketCap.toLocaleString()} MC (${pctFromHigh.toFixed(1)}% MC)\n` +
                    `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
                    `💡 Price fading from recent high — potential short opportunity`;

                  console.log(`[Stagnation] ${tokenId}: SHORT stagnation signal (${pctFromHigh.toFixed(1)}% from high, ${hoursSince}hrs)`);
                  bot.telegram.sendMessage(token.userId, shortMsg, { parse_mode: 'HTML' }).catch(() => {});
                }
              }
            }
          }
        }
      }

      // 1. Calculate Market Cap Change
      let marketCapChange = 0;
      if (token.lastMarketCap > 0) {
        marketCapChange = ((currentMarketCap - token.lastMarketCap) / token.lastMarketCap) * 100;
      }

      // 2. Calculate Volume Change
      let m5Change = 0;
      if (token.lastVolumeM5 > 0) {
        m5Change = ((currentM5 - token.lastVolumeM5) / token.lastVolumeM5) * 100;
      }

      let h1Change = 0;
      if (token.lastVolumeH1 > 0) {
        h1Change = ((currentH1 - token.lastVolumeH1) / token.lastVolumeH1) * 100;
      }

      let volumeChange = 0;
      let triggerSource = 'm5';

      if (token.lastVolumeM5 === 0) {
        volumeChange = h1Change;
        triggerSource = 'h1';
      } else {
        if (m5Change >= h1Change) {
          volumeChange = m5Change;
          triggerSource = 'm5';
        } else {
          volumeChange = h1Change;
          triggerSource = 'h1';
        }
      }

      // 3. Check Cooldown
      const onCooldown = token.lastAlertAt && (now - new Date(token.lastAlertAt) < token.cooldownMs);

      // 4. Evaluate Alert Conditions
      const marketCapTriggered = marketCapChange >= token.marketCapThreshold;
      const volumeTriggered = volumeChange >= token.volumeThreshold;

      // Apply Strategy: Any (Either), Both, Mcap Only, or Vol Only
      let isTriggered = false;
      if (globalStats.alertStrategy === 'both') {
        isTriggered = marketCapTriggered && volumeTriggered;
      } else if (globalStats.alertStrategy === 'mcap') {
        isTriggered = marketCapTriggered;
      } else if (globalStats.alertStrategy === 'volume') {
        isTriggered = volumeTriggered;
      } else {
        isTriggered = marketCapTriggered || volumeTriggered;
      }

      if (isTriggered && !onCooldown) {
        console.log(`[Monitor] [${now.toLocaleTimeString()}] ALERT for ${data.symbol} (${token.chain})`);
        globalStats.globalAlerts += 1;
        
        // Save Snapshot
        const alert = new Alert({
          tokenId: token.tokenId,
          chain: token.chain,
          tokenAddress: token.tokenAddress,
          priceUsd: data.priceUsd,
          marketCap: currentMarketCap,
          volumeM5: currentM5,
          volumeH1: currentH1,
          marketCapChange,
          volumeChange,
          triggerSource,
          timestamp: now
        });
        await alert.save();

        // Send Telegram Alert
        const message = `🚨 *SURGE ALERT: ${data.symbol}* 🚨\n\n` +
                        `*Chain:* ${token.chain.toUpperCase()}\n` +
                        `*Price:* $${data.priceUsd}\n\n` +
                        `📈 *Market Cap:* +${marketCapChange.toFixed(2)}%\n` +
                        `🔊 *Volume Spike:* +${volumeChange.toFixed(2)}% (${triggerSource})\n\n` +
                        `💰 *Current MC:* $${currentMarketCap.toLocaleString()}\n` +
                        `📊 *Current Vol (1h):* $${currentH1.toLocaleString()}\n`;
        
        const keyboard = [
          [{ text: '📈 View on DexScreener', url: data.dexUrl || `https://dexscreener.com/${token.chain}/${token.tokenAddress}` }],
          [{ text: '⏸ Disable Alert', callback_data: `disable:${token._id}` }],
          [{ text: '📊 Set New Thresholds', callback_data: `new_threshold:${token._id}` }]
        ];

        await bot.telegram.sendMessage(token.userId, message, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard }
        });

        // Update lastAlertAt
        token.lastAlertAt = now;
      }

      // 5. Update last values regardless of alert
      token.lastMarketCap = currentMarketCap;
      token.lastVolumeM5 = currentM5;
      token.lastVolumeH1 = currentH1;
      await token.save();
      } catch (tokenError) {
        console.error(`[Monitor] Error processing token ${token.symbol || token.tokenId}:`, tokenError.message);
        // Continue with next token — don't let a single failure stall the whole loop
        continue;
      }
    }
    
    await globalStats.save();
  } catch (error) {
    console.error('[Monitor] Loop Error:', error.message);
  }
};
