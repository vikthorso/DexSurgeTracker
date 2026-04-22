import { Token } from '../models/Token.js';
import { Alert } from '../models/Alert.js';
import { Stats } from '../models/Stats.js';
import { fetchTokenData } from './dexScreener.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const runMonitor = async (bot) => {
  try {
    const activeTokens = await Token.find({ isActive: true });
    
    // Fetch or create global stats
    let globalStats = await Stats.findOne();
    if (!globalStats) globalStats = new Stats();

    console.log(`[Monitor] [${new Date().toLocaleTimeString()}] Checking ${activeTokens.length} active tokens...`);

    for (const token of activeTokens) {
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

        if (absLiveChange >= (globalStats.liveTrackThreshold || 10)) {
          const isBullish = liveMcChange > 0;
          const statusEmoji = isBullish ? '📈 Bullish' : '📉 Bearish';
          const directionText = isBullish ? 'making progress' : 'falling';
          
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

          let troughInfo = '';
          if (!isBullish && token.liveTroughMc > 0 && currentMarketCap > token.liveTroughMc) {
             const recovery = ((currentMarketCap - token.liveTroughMc) / token.liveTroughMc) * 100;
             troughInfo = `\n⤴️ *Recovery from Trough:* +${recovery.toFixed(2)}%`;
          } else if (isBullish && token.liveTroughMc > 0) {
             const recovery = ((currentMarketCap - token.liveTroughMc) / token.liveTroughMc) * 100;
             troughInfo = `\n⤴️ *Recovery from Trough:* +${recovery.toFixed(2)}%`;
          }

          const liveMessage = `${statusEmoji} *UPDATE: ${data.symbol}* ${statusEmoji}\n\n` +
                              `The token is *${directionText}*!\n` +
                              `*Market Cap:* $${currentMarketCap.toLocaleString()} (${liveMcChange.toFixed(2)}%)\n` +
                              `*Price:* $${data.priceUsd}\n\n` +
                              `${peakInfo}${troughInfo}\n\n` +
                              `_Tracking movement relative to last alert._`;

          const liveKeyboard = [
            [{ text: '📈 View on DexScreener', url: data.dexUrl || `https://dexscreener.com/${token.chain}/${token.tokenAddress}` }],
            [{ text: '⏸ Stop Live Tracking', callback_data: `toggle_live:${token._id}` }]
          ];

          await bot.telegram.sendMessage(token.userId, liveMessage, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: liveKeyboard }
          });

          token.lastLiveMc = currentMarketCap;
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
    }
    
    await globalStats.save();
  } catch (error) {
    console.error('[Monitor] Loop Error:', error.message);
  }
};
