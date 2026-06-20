import { Markup, Telegraf, session } from 'telegraf';
import { Stats } from '../models/Stats.js';
import { Token } from '../models/Token.js';
import { updateMonitorInterval, updateTrendingInterval } from '../services/cron.js';
import { getLeverageStrategy } from '../services/deepseek.js';
import { fetchTokenData } from '../services/dexScreener.js';
import { getGrokStrategy } from '../services/grok.js';
import { checkFUD, checkUpcomingUnlocks, formatFUDResult, formatInvestorsResult, formatUnlocksResult, researchInvestors } from '../services/grokResearch.js';
import { formatLeverageOutput } from '../services/levTemplate.js';
import { getSentimentInfo } from '../services/monitor.js';
import { getTokenMetadata, getTopHolders, isEVMChain } from '../services/moralis.js';
import { manualTrending, sendBearishReport, sendBullishReport } from '../services/trendingMonitor.js';

// Helper for percentage change
const getPercentChange = (base, current) => {
  if (!base || !current) return '0.00';
  const change = ((current - base) / base) * 100;
  return change.toFixed(2);
};

export const setupBot = (token) => {
  const bot = new Telegraf(token);

  // Use session to track "add" flow state
  bot.use(session());

  // Authorization Middleware
  bot.use(async (ctx, next) => {
    const authorizedId = process.env.TELEGRAM_CHAT_ID;
    if (authorizedId && ctx.from?.id.toString() !== authorizedId.toString()) {
      return ctx.reply('⚠️ Unauthorized access. This bot is private.');
    }
    return next();
  });

  // Register Command Menu
  bot.telegram.setMyCommands([
    { command: 'start', description: 'Start the bot' },
    { command: 'add', description: 'Monitor a new token' },
    { command: 'list', description: 'View your monitored tokens' },
    { command: 'trending', description: 'Discover trending niches' },
    { command: 'config', description: 'System status & configuration' },
    { command: 'remove', description: 'Stop monitoring a token' },
    { command: 'leverage', description: 'Leverage grid DCA strategy calculator' },
    { command: 'research', description: 'Research a token (tokenomics, holders, FUD, unlocks, investors)' }
  ]);

  bot.start((ctx) => {
    ctx.reply('🚀 Welcome to Dex Volume Monitor!\n\nUse /add to start monitoring a new token.\nUse /trending to discover trending niches.\nUse /leverage for grid DCA strategy calc.\nUse /research to analyze tokenomics, holders, FUD, unlocks & investors.\nCommands: /add, /remove, /list, /trending, /config, /leverage, /research');
  });

  // --- LEVERAGE STRATEGY FLOW ---
  bot.command('leverage', async (ctx) => {
    // Delete previous question if any
    if (ctx.session?.lastLevQuestionId) {
      ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.lastLevQuestionId).catch(() => {});
    }
    const msg = await ctx.reply('⚙️ *Leverage Grid DCA Strategy Calculator*\n\nPlease enter your *Leverage* (e.g. 5 for 5x):', { parse_mode: 'Markdown' });
    ctx.session = { step: 'awaiting_leverage', lastLevQuestionId: msg.message_id, levTriggerMsgId: ctx.message.message_id };
  });

  // Helper to handle address/URL input
  const processAddress = async (ctx, input) => {
    let address = input.trim();
    let chain = '';

    // Simple URL parsing
    if (address.includes('dexscreener.com')) {
      const parts = address.split('/');
      const chainIdx = parts.findIndex(p => ['solana', 'base', 'ethereum', 'bsc'].includes(p.toLowerCase()));
      if (chainIdx !== -1) {
        chain = parts[chainIdx];
        address = parts[chainIdx + 1];
      }
    }

    if (chain) {
      await setupConfigurator(ctx, chain, address);
    } else {
      ctx.session.address = address;
      ctx.session.step = 'selecting_chain';
      await ctx.reply('Select the chain:', Markup.inlineKeyboard([
        [Markup.button.callback('Solana', 'chain:solana'), Markup.button.callback('Base', 'chain:base')],
        [Markup.button.callback('Ethereum', 'chain:ethereum'), Markup.button.callback('BSC', 'chain:bsc')]
      ]));
    }
  };

  // Helper to show the Token Card and Configuration Buttons
  const setupConfigurator = async (ctx, chain, address) => {
    ctx.session.loading = true;
    const msg = await ctx.reply('🔍 Fetching token data...');

    const data = await fetchTokenData(chain, address);
    if (!data.success) {
      return ctx.reply(`❌ Error: ${data.error}`);
    }

    ctx.session.tokenData = data;
    ctx.session.chain = chain;
    ctx.session.address = address;
    ctx.session.mcThreshold = ctx.session.mcThreshold || 5;
    ctx.session.volThreshold = ctx.session.volThreshold || 10;
    ctx.session.isLiveTracking = ctx.session.isLiveTracking ?? false;
    ctx.session.step = 'configuring';

    const card = `💎 *TOKEN IDENTIFIED* 💎\n\n` +
      `*Name:* ${data.name}\n` +
      `*Symbol:* ${data.symbol}\n` +
      `*Chain:* ${chain.toUpperCase()}\n\n` +
      `💰 *Price:* $${data.priceUsd}\n` +
      `📊 *Mkt Cap:* $${data.marketCap.toLocaleString()}\n` +
      `🔄 *1h Volume:* $${data.volumeH1.toLocaleString()}\n\n` +
      `--------------------------\n` +
      `*Current Config:*\n` +
      `📈 MC Threshold: *${ctx.session.mcThreshold}%*\n` +
      `🔊 Vol Threshold: *${ctx.session.volThreshold}%*\n` +
      `🔥 Live Tracking: *${ctx.session.isLiveTracking ? 'ENABLED ✅' : 'DISABLED ❌'}*\n`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📈 Set MC Threshold', 'set_mc_btn'), Markup.button.callback('🔊 Set Vol Threshold', 'set_vol_btn')],
      [Markup.button.callback(ctx.session.isLiveTracking ? '⏸ Disable Live Update' : '🔥 Enable Live Update', 'toggle_live_init')],
      [Markup.button.callback('✅ Confirm & Start Monitoring', 'confirm_cfg')],
      [Markup.button.callback('🗑 Dismiss', 'dismiss')]
    ]);

    await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
    await ctx.replyWithMarkdown(card, keyboard);
  };

  // --- ADD FLOW ---
  bot.command('add', async (ctx) => {
    const payload = ctx.payload;
    ctx.session = { step: 'awaiting_address' };

    if (payload) {
      await processAddress(ctx, payload);
    } else {
      ctx.reply('Please enter the Token Contract Address or DexScreener URL:');
    }
  });

  const handleList = async (ctx, page) => {
    const limit = 10;
    const skip = (page - 1) * limit;

    try {
      const total = await Token.countDocuments({ userId: ctx.from.id.toString() });
      const tokens = await Token.find({ userId: ctx.from.id.toString() })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      if (tokens.length === 0) {
        return ctx.reply('You are not monitoring any tokens.');
      }

      const totalPages = Math.ceil(total / limit);
      let message = `📋 *Monitored Tokens*  (Page ${page}/${totalPages})\n\n`;

      // Compact token summary in the message text
      tokens.forEach((t, i) => {
        const status = t.isActive ? '✅' : '⏸';
        const label = t.name ? `${t.symbol} — ${t.name}` : t.symbol;
        message += `${status} *${label}* | 📡 ${t.scanCount || 0} scans\n`;
      });

      message += `\n_Tap a button below for full details_`;

      // Build grid rows: 3 buttons per row, symbol-only labels
      const COLS = 3;
      const gridRows = [];
      for (let i = 0; i < tokens.length; i += COLS) {
        const row = tokens.slice(i, i + COLS).map(t => {
          const label = t.isActive ? `${t.symbol}` : `⏸ ${t.symbol}`;
          return Markup.button.callback(label, `load_details:${t._id}`);
        });
        gridRows.push(row);
      }

      // Navigation row
      const navRow = [];
      if (page > 1) navRow.push(Markup.button.callback('◀️ Prev', `list_page:${page - 1}`));
      if (navRow.length > 0) navRow.push(Markup.button.callback(`📋 ${page}/${totalPages}`, 'noop'));
      if (page < totalPages) navRow.push(Markup.button.callback('Next ▶️', `list_page:${page + 1}`));
      if (navRow.length > 0) gridRows.push(navRow);

      // Dismiss row
      gridRows.push([Markup.button.callback('🗑 Dismiss', 'dismiss')]);

      const keyboard = Markup.inlineKeyboard(gridRows);

      if (ctx.updateType === 'callback_query') {
        await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup });
      } else {
        await ctx.replyWithMarkdown(message, keyboard);
      }
    } catch (error) {
      ctx.reply('Error fetching tokens: ' + error.message);
    }
  };

  bot.command('list', async (ctx) => {
    const page = parseInt(ctx.payload) || 1;
    await handleList(ctx, page);
  });

  bot.command('trending', async (ctx) => {
    const msg = await ctx.reply('🔍 Fetching trending data from CoinGecko...');
    await manualTrending(bot, ctx.chat.id);
    // Clean up the "fetching..." message if possible
    ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
  });

  bot.command('config', async (ctx) => {
    try {
      let stats = await Stats.findOne();
      if (!stats) stats = await Stats.create({});

      const uptime = Math.floor(process.uptime() / 60);
      const trendingH = (stats.trendingIntervalMs || 14400000) / 3600000;
      const stagH = (stats.stagnationWindowMs || 14400000) / 3600000;
      const stagCD = (stats.stagnationCooldownMs || 3600000) / 3600000;
      const message = `⚙️ *System Configuration & Status*\n\n` +
        `⏱ *Uptime:* ${uptime} minutes\n` +
        `🔍 *Total Scans:* ${stats.totalScans}\n` +
        `🚨 *Total Alerts:* ${stats.globalAlerts}\n\n` +
        `📡 *Scan Interval:* ${stats.globalIntervalMs / 1000}s\n` +
        `⏳ *Check Delay:* ${stats.tokenDelayMs}ms\n` +
        `❄️ *Default Cooldown:* ${stats.globalCooldownMs / 60000}m\n` +
        `🎯 *Alert Logic:* ${stats.alertStrategy === 'both' ? 'BOTH met' : 'EITHER met'}\n` +
        `📈 *Live track %:* ${stats.liveTrackThreshold || 10}%\n` +
        `🔢 *Consecutive:* ${stats.liveConsecutiveThreshold || 2} confirmed\n` +
        `🕒 *Sent. Window:* ${stats.sentimentWindowHours || 4}h\n` +
        `🌊 *Trending Interval:* ${trendingH}h\n\n` +
        `📊 *Stag. Window:* ${stagH}h | *Stag. %:* ${stats.stagnationPercent || 5}%\n` +
        `⏰ *Stag. Cooldown:* ${stagCD}h\n` +
        `📉 *Crash %:* ${stats.crashPercentThreshold || 40}% | *Crash Win:* ${((stats.crashWindowMs || 86400000) / 3600000)}h\n` +
        `📈 *Bounce Confirm:* >=${stats.bounceConfirmPercent || 8}% for ${stats.bounceConfirmMinScans || 3} scans\n` +
        `🐱 *Dead Cat Bounce:* ${stats.deadCatBounceEnabled !== false ? 'ON' : 'OFF'}\n\n` +
        `Use buttons below to update global settings:`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📡 30s Scan', 'cfg_int:30000'), Markup.button.callback('📡 1m Scan', 'cfg_int:60000')],
        [Markup.button.callback('⏳ 0ms Delay', 'cfg_delay:0'), Markup.button.callback('⏳ 100ms Delay', 'cfg_delay:100')],
        [Markup.button.callback('💎 MC Only', 'cfg_strat:mcap'), Markup.button.callback('📊 Vol Only', 'cfg_strat:volume')],
        [Markup.button.callback('🤝 Both Met', 'cfg_strat:both'), Markup.button.callback('🍭 Either Met', 'cfg_strat:any')],
        [Markup.button.callback('❄️ 1m CD', 'cfg_cd:60000'), Markup.button.callback('❄️ 3m CD', 'cfg_cd:180000'), Markup.button.callback('❄️ 10m CD', 'cfg_cd:600000')],
        [Markup.button.callback('📈 Live Track %', 'cfg_live_th'), Markup.button.callback('🔢 Consecutive', 'cfg_cons_th')],
        [Markup.button.callback('🕒 Sent. Window', 'cfg_sent_win'), Markup.button.callback('🌊 Trending 2h', 'cfg_trend:7200000'), Markup.button.callback('🌊 Trending 4h', 'cfg_trend:14400000')],
        [Markup.button.callback('📊 Stag. Win', 'cfg_stag_win'), Markup.button.callback('📈 Stag. %', 'cfg_stag_pct'), Markup.button.callback('⏰ Stag. CD', 'cfg_stag_cd')],
        [Markup.button.callback('📉 Crash %', 'cfg_crash_pct'), Markup.button.callback('🕐 Crash Win', 'cfg_crash_win')],
        [Markup.button.callback('📈 Bounce %', 'cfg_bounce_pct'), Markup.button.callback('🔢 Bounce Scans', 'cfg_bounce_scans'), Markup.button.callback('🐱 DCB Toggle', 'cfg_dcb_toggle')],
        [Markup.button.callback('� Dismiss', 'dismiss')]
      ]);

      await ctx.replyWithMarkdown(message, keyboard);
    } catch (err) {
      ctx.reply('Error loading config: ' + err.message);
    }
  });

  bot.command('remove', async (ctx) => {
    try {
      const tokens = await Token.find({ userId: ctx.from.id.toString() });
      if (tokens.length === 0) {
        return ctx.reply('No tokens to remove.');
      }

      const buttons = tokens.map(t => {
        const label = t.name ? `${t.name} (${t.chain.toUpperCase()})` : `${t.tokenId}`;
        return [Markup.button.callback(`❌ Remove: ${label}`, `remove:${t._id}`)];
      });

      ctx.reply('Select a token to remove from monitoring:', Markup.inlineKeyboard(buttons));
    } catch (error) {
      ctx.reply('Error: ' + error.message);
    }
  });

  bot.command('research', async (ctx) => {
    try {
      const payload = ctx.payload?.trim();
      const tokens = await Token.find({ userId: ctx.from.id.toString() });

      if (tokens.length === 0) {
        return ctx.reply('No tokens to research. Use /add to start monitoring a token, then /research to analyze it.');
      }

      // If payload is a token ID, jump straight to research menu
      if (payload) {
        const token = await Token.findById(payload);
        if (!token) return ctx.reply('Token not found.');
        // Simulate the research_menu callback
        ctx.callbackQuery = { data: `research_menu:${token._id}`, message: ctx.message };
        return bot.handleUpdate(ctx.update);
      }

      // Otherwise show token picker
      const buttons = tokens.map(t => {
        const label = t.name ? `${t.symbol} — ${t.name}` : t.symbol;
        return [Markup.button.callback(`🔍 ${label}`, `research_menu:${t._id}`)];
      });

      ctx.reply('🔍 <b>Research a Token</b>\n\nSelect a token to research:\n\n<i>Tokenomics & Holders via Moralis (EVM) | FUD, Unlocks & Investors via Grok</i>', {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
      });
    } catch (error) {
      ctx.reply('Error: ' + error.message);
    }
  });

  // --- ACTIONS ---
  bot.on('text', async (ctx) => {
    const state = ctx.session || {};

    if (state.step === 'awaiting_address') {
      await processAddress(ctx, ctx.message.text);
      return;
    }

    if (state.step === 'awaiting_mc_btn') {
      const val = parseFloat(ctx.message.text);
      if (isNaN(val)) return ctx.reply('Invalid number. Please enter a percentage:');
      ctx.session.mcThreshold = val;
      await setupConfigurator(ctx, state.chain, state.address);
      return;
    }

    if (state.step === 'awaiting_vol_btn') {
      const val = parseFloat(ctx.message.text);
      if (isNaN(val)) return ctx.reply('Invalid number. Please enter a percentage:');
      ctx.session.volThreshold = val;
      await setupConfigurator(ctx, state.chain, state.address);
      return;
    }

    if (state.step === 'awaiting_live_th') {
      const val = parseFloat(ctx.message.text);
      if (isNaN(val)) return ctx.reply('Invalid number. Please enter a percentage:');
      try {
        await Stats.findOneAndUpdate({}, { liveTrackThreshold: val }, { upsert: true });
        ctx.session = null;
        ctx.reply(`✅ *Success:* Live Tracking threshold changed to *${val}%*`, { parse_mode: 'Markdown' });
      } catch (err) {
        ctx.reply('Error updating threshold: ' + err.message);
      }
      return;
    }

    if (state.step === 'awaiting_cons_th') {
      const val = parseInt(ctx.message.text);
      if (isNaN(val) || val < 1) return ctx.reply('Invalid number. Enter a threshold (min 1):');
      try {
        await Stats.findOneAndUpdate({}, { liveConsecutiveThreshold: val }, { upsert: true });
        ctx.session = null;
        ctx.reply(`✅ *Success:* Consecutive confirmation threshold set to *${val}*`, { parse_mode: 'Markdown' });
      } catch (err) {
        ctx.reply('Error: ' + err.message);
      }
      return;
    }

    if (state.step === 'awaiting_sent_win') {
      const val = parseInt(ctx.message.text);
      if (isNaN(val) || val < 1) return ctx.reply('Invalid number. Enter hours (min 1):');
      try {
        await Stats.findOneAndUpdate({}, { sentimentWindowHours: val }, { upsert: true });
        ctx.session = null;
        ctx.reply(`✅ *Success:* Sentiment analysis window set to *${val} hours*`, { parse_mode: 'Markdown' });
      } catch (err) {
        ctx.reply('Error: ' + err.message);
      }
      return;
    }

    // --- Stagnation & Crash Detection Config Inputs ---

    if (state.step === 'awaiting_stag_win') {
      const val = parseInt(ctx.message.text);
      if (isNaN(val) || val < 1 || val > 48) return ctx.reply('Invalid. Enter hours (1-48):');
      await Stats.findOneAndUpdate({}, { stagnationWindowMs: val * 3600000 }, { upsert: true });
      ctx.session = null;
      ctx.reply(`✅ *Success:* Stagnation window set to *${val} hours*`, { parse_mode: 'Markdown' });
      return;
    }

    if (state.step === 'awaiting_stag_pct') {
      const val = parseFloat(ctx.message.text);
      if (isNaN(val) || val <= 0) return ctx.reply('Invalid. Enter a percentage:');
      await Stats.findOneAndUpdate({}, { stagnationPercent: val }, { upsert: true });
      ctx.session = null;
      ctx.reply(`✅ *Success:* Stagnation threshold set to *${val}%*`, { parse_mode: 'Markdown' });
      return;
    }

    if (state.step === 'awaiting_stag_cd') {
      const val = parseInt(ctx.message.text);
      if (isNaN(val) || val < 1) return ctx.reply('Invalid. Enter hours (min 1):');
      await Stats.findOneAndUpdate({}, { stagnationCooldownMs: val * 3600000 }, { upsert: true });
      ctx.session = null;
      ctx.reply(`✅ *Success:* Stagnation cooldown set to *${val} hours*`, { parse_mode: 'Markdown' });
      return;
    }

    if (state.step === 'awaiting_crash_pct') {
      const val = parseFloat(ctx.message.text);
      if (isNaN(val) || val < 30 || val > 80) return ctx.reply('Invalid. Enter a percentage (30-80):');
      await Stats.findOneAndUpdate({}, { crashPercentThreshold: val }, { upsert: true });
      ctx.session = null;
      ctx.reply(`✅ *Success:* Crash threshold set to *${val}%*`, { parse_mode: 'Markdown' });
      return;
    }

    if (state.step === 'awaiting_crash_win') {
      const val = parseInt(ctx.message.text);
      if (isNaN(val) || val < 4 || val > 48) return ctx.reply('Invalid. Enter hours (4-48):');
      await Stats.findOneAndUpdate({}, { crashWindowMs: val * 3600000 }, { upsert: true });
      ctx.session = null;
      ctx.reply(`✅ *Success:* Crash window set to *${val} hours*`, { parse_mode: 'Markdown' });
      return;
    }

    if (state.step === 'awaiting_bounce_pct') {
      const val = parseFloat(ctx.message.text);
      if (isNaN(val) || val < 5 || val > 15) return ctx.reply('Invalid. Enter a percentage (5-15):');
      await Stats.findOneAndUpdate({}, { bounceConfirmPercent: val }, { upsert: true });
      ctx.session = null;
      ctx.reply(`✅ *Success:* Bounce confirmation set to *${val}%*`, { parse_mode: 'Markdown' });
      return;
    }

    if (state.step === 'awaiting_bounce_scans') {
      const val = parseInt(ctx.message.text);
      if (isNaN(val) || val < 2 || val > 5) return ctx.reply('Invalid. Enter scans (2-5):');
      await Stats.findOneAndUpdate({}, { bounceConfirmMinScans: val }, { upsert: true });
      ctx.session = null;
      ctx.reply(`✅ *Success:* Bounce confirmation scans set to *${val}*`, { parse_mode: 'Markdown' });
      return;
    }

    // --- LEVERAGE WIZARD STEPS ---
    if (state.step === 'awaiting_leverage') {
      const val = parseFloat(ctx.message.text);
      if (isNaN(val) || val < 1) return ctx.reply('Invalid. Enter a leverage value (e.g. 5 for 5x, min 1):');
      if (val > 5) return ctx.reply('⚠️ Max 5x leverage allowed. Please enter 5 or lower:');
      ctx.session.leverage = val;
      ctx.session.step = 'awaiting_lev_amount';
      // Delete previous question
      if (ctx.session.lastLevQuestionId) {
        ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.lastLevQuestionId).catch(() => {});
      }
      const msg = await ctx.reply(`✅ Leverage: *${val}x*\n\nNow enter your *Trade Amount* (total allocated risk capital in USD, e.g. $100):`, { parse_mode: 'Markdown' });
      ctx.session.lastLevQuestionId = msg.message_id;
      return;
    }

    if (state.step === 'awaiting_lev_amount') {
      const val = parseFloat(ctx.message.text);
      if (isNaN(val) || val <= 0) return ctx.reply('Invalid. Enter a trade amount (e.g. 100):');
      ctx.session.levAmount = val;

      // Delete previous question
      if (ctx.session.lastLevQuestionId) {
        ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.lastLevQuestionId).catch(() => {});
      }

      let msg;
      // If pre-filled from token button, skip entry price
      if (ctx.session.prefillEntryPrice) {
        ctx.session.levEntryPrice = ctx.session.prefillEntryPrice;
        if (ctx.session.prefillMarketCap) {
          ctx.session.levMarketCap = ctx.session.prefillMarketCap;
          ctx.session.step = 'awaiting_lev_account_balance';
          msg = await ctx.reply(`✅ Amount: *$${val}*\n📋 *Auto-filled Entry Price:* $${ctx.session.prefillEntryPrice}\n📋 *Auto-filled Market Cap:* $${ctx.session.prefillMarketCap.toLocaleString()}\n\nNow enter your *Current Account Balance / Capital* (e.g. 1000):`, { parse_mode: 'Markdown' });
        } else {
          ctx.session.step = 'awaiting_lev_market_cap';
          msg = await ctx.reply(`✅ Amount: *$${val}*\n📋 *Auto-filled Entry Price:* $${ctx.session.prefillEntryPrice}\n\nNow enter the *Current Market Cap* (e.g. 500000 for $500k):`, { parse_mode: 'Markdown' });
        }
      } else {
        ctx.session.step = 'awaiting_lev_entry_price';
        msg = await ctx.reply(`✅ Amount: *$${val}*\n\nNow enter the *Entry Price* (e.g. 0.0001):`, { parse_mode: 'Markdown' });
      }
      ctx.session.lastLevQuestionId = msg.message_id;
      return;
    }

    if (state.step === 'awaiting_lev_entry_price') {
      const val = parseFloat(ctx.message.text);
      if (isNaN(val) || val <= 0) return ctx.reply('Invalid. Enter a price (e.g. 0.0001):');
      ctx.session.levEntryPrice = val;

      // Delete previous question
      if (ctx.session.lastLevQuestionId) {
        ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.lastLevQuestionId).catch(() => {});
      }

      let msg;
      if (ctx.session.prefillMarketCap) {
        ctx.session.levMarketCap = ctx.session.prefillMarketCap;
        ctx.session.step = 'awaiting_lev_account_balance';
        msg = await ctx.reply(`✅ Entry Price: *$${val}*\n📋 *Auto-filled Market Cap:* $${ctx.session.prefillMarketCap.toLocaleString()}\n\nNow enter your *Current Account Balance / Capital* (e.g. 1000):`, { parse_mode: 'Markdown' });
      } else {
        ctx.session.step = 'awaiting_lev_market_cap';
        msg = await ctx.reply(`✅ Entry Price: *$${val}*\n\nNow enter the *Current Market Cap* (e.g. 500000 for $500k):`, { parse_mode: 'Markdown' });
      }
      ctx.session.lastLevQuestionId = msg.message_id;
      return;
    }

    if (state.step === 'awaiting_lev_market_cap') {
      const val = parseFloat(ctx.message.text);
      if (isNaN(val) || val <= 0) return ctx.reply('Invalid. Enter market cap (e.g. 500000):');
      ctx.session.levMarketCap = val;
      ctx.session.step = 'awaiting_lev_account_balance';
      // Delete previous question
      if (ctx.session.lastLevQuestionId) {
        ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.lastLevQuestionId).catch(() => {});
      }
      const msg = await ctx.reply(`✅ Market Cap: *$${val.toLocaleString()}*\n\nNow enter your *Current Account Balance / Capital* (e.g. 1000):`, { parse_mode: 'Markdown' });
      ctx.session.lastLevQuestionId = msg.message_id;
      return;
    }

    if (state.step === 'awaiting_lev_account_balance') {
      const val = parseFloat(ctx.message.text);
      if (isNaN(val) || val <= 0) return ctx.reply('Invalid. Enter your account balance (e.g. 1000):');
      ctx.session.levAccountBalance = val;
      ctx.session.step = 'awaiting_lev_mode';
      // Delete previous question
      if (ctx.session.lastLevQuestionId) {
        ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.lastLevQuestionId).catch(() => {});
      }
      const msg = await ctx.reply(`✅ Balance: *$${val.toLocaleString()}*\n\nNow choose *Leverage Mode*:`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔒 Isolated', 'lev_mode:isolated'), Markup.button.callback('🔗 Cross', 'lev_mode:cross')]
        ])
      });
      ctx.session.lastLevQuestionId = msg.message_id;
      return;
    }

    if (state.step === 'awaiting_lev_direction') {
      ctx.session.levDirection = ctx.message.text.toLowerCase();
      if (!['long', 'short'].includes(ctx.session.levDirection)) {
        return ctx.reply('Please reply "long" or "short":');
      }
      ctx.session.step = 'awaiting_lev_context';
      // Delete previous question (the mode-selection message)
      if (ctx.session.lastLevQuestionId) {
        ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.lastLevQuestionId).catch(() => {});
      }
      const msg = await ctx.reply(`✅ Direction: *${ctx.session.levDirection.toUpperCase()}*\n\n(Optional) Enter *Token Category/Niche Context* (e.g. "low cap meme, pump fun", or type "skip" to skip):`, { parse_mode: 'Markdown' });
      ctx.session.lastLevQuestionId = msg.message_id;
      return;
    }

    if (state.step === 'awaiting_lev_context') {
      const input = ctx.message.text.trim();
      const tokenContext = input.toLowerCase() === 'skip' ? '' : input;
      ctx.session.levContext = tokenContext;
      ctx.session.step = 'awaiting_lev_model';

      // Delete previous question
      if (ctx.session.lastLevQuestionId) {
        ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.lastLevQuestionId).catch(() => {});
      }

      const msg = await ctx.reply('🤖 *Select AI Model for Analysis*\n\nChoose which model to analyze your strategy:', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🧠 DeepSeek (Chat)', 'lev_model:deepseek'), Markup.button.callback('⚡ Grok 4.1 Fast', 'lev_model:grok')],
          [Markup.button.callback('🗑 Dismiss', 'lev_model_cancel')]
        ])
      });
      ctx.session.lastLevQuestionId = msg.message_id;
      ctx.session.levModelMsgId = msg.message_id;
      return;
    }
  });

  bot.on('callback_query', async (ctx) => {
    // Wrap answerCbQuery to silently swallow transient Telegram API errors
    // (ECONNRESET, ETIMEDOUT, etc.) — prevents network blips from crashing the bot
    const originalAnswer = ctx.answerCbQuery.bind(ctx);
    ctx.answerCbQuery = (...args) => originalAnswer(...args).catch(err => {
      console.warn('[Bot] answerCbQuery failed:', err.message?.substring(0, 80));
    });

    const data = ctx.callbackQuery.data;

    if (data.startsWith('chain:')) {
      const chain = data.split(':')[1];
      ctx.answerCbQuery();
      await setupConfigurator(ctx, chain, ctx.session.address);
      return;
    }

    if (data === 'set_mc_btn') {
      ctx.session.step = 'awaiting_mc_btn';
      ctx.answerCbQuery();
      ctx.reply('Please enter the Market Cap Change Threshold (%):');
      return;
    }

    if (data === 'set_vol_btn') {
      ctx.session.step = 'awaiting_vol_btn';
      ctx.answerCbQuery();
      ctx.reply('Please enter the Volume Change Threshold (%):');
      return;
    }

    if (data === 'confirm_cfg') {
      const { chain, address, mcThreshold, volThreshold, isLiveTracking, tokenData } = ctx.session;
      const tokenId = `${chain}:${address}`;

      try {
        const existing = await Token.findOne({ userId: ctx.from.id.toString(), tokenId });
        if (existing) {
          ctx.session = null;
          return ctx.reply(`You are already monitoring ${tokenId}.`);
        }

        const token = new Token({
          userId: ctx.from.id.toString(),
          chain,
          tokenAddress: address,
          tokenId,
          name: tokenData.name,
          symbol: tokenData.symbol,
          marketCapThreshold: mcThreshold,
          volumeThreshold: volThreshold,
          startPrice: tokenData.priceUsd,
          startMarketCap: tokenData.marketCap,
          startVolumeH1: tokenData.volumeH1,
          lastMarketCap: tokenData.marketCap,
          lastLiveMc: isLiveTracking ? tokenData.marketCap : 0,
          livePeakMc: isLiveTracking ? tokenData.marketCap : 0,
          liveTroughMc: isLiveTracking ? tokenData.marketCap : 0,
          lastVolumeM5: tokenData.volumeM5,
          lastVolumeH1: tokenData.volumeH1,
          isLiveTracking: isLiveTracking,
          isActive: true
        });

        await token.save();
        ctx.session = null;
        ctx.answerCbQuery('Monitoring started!');
        ctx.reply(`✅ *Success!* Started monitoring *${tokenData.name}* (${tokenData.symbol}).\nThresholds: MC: ${mcThreshold}% | Vol: ${volThreshold}%${isLiveTracking ? ' | Live: YES' : ''}`, { parse_mode: 'Markdown' });
      } catch (error) {
        ctx.reply('Error saving: ' + error.message);
      }
      return;
    }

    if (data.startsWith('list_page:')) {
      const page = parseInt(data.split(':')[1]);
      ctx.answerCbQuery();
      await handleList(ctx, page);
      return;
    }

    if (data.startsWith('load_details:')) {
      const id = data.split(':')[1];
      const token = await Token.findById(id);
      if (!token) return ctx.answerCbQuery('Token not found');

      ctx.answerCbQuery('Loading live data...');
      const freshData = await fetchTokenData(token.chain, token.tokenAddress);

      const card = `💎 *LIVE TOKEN VIEW* 💎\n\n` +
        `*Name:* ${freshData.name}\n` +
        `*Symbol:* ${freshData.symbol}\n` +
        `*Chain:* ${token.chain.toUpperCase()}\n\n` +
        `💰 *Price:* $${freshData.priceUsd} (${getPercentChange(token.startPrice, freshData.priceUsd)}%)\n` +
        `📊 *Mkt Cap:* $${freshData.marketCap.toLocaleString()} (${getPercentChange(token.startMarketCap, freshData.marketCap)}%)\n` +
        `🔄 *1h Volume:* $${freshData.volumeH1.toLocaleString()}\n\n` +
        `--------------------------\n` +
        `📅 *Since:* ${new Date(token.createdAt).toLocaleString()}\n\n` +
        `*Baseline (At Start):*\n` +
        `💰 Price: *$${token.startPrice || '?'}*\n` +
        `📊 MC: *$${(token.startMarketCap || 0).toLocaleString()}*\n\n` +
        `*Stats:*\n` +
        `📡 Total Scans: *${token.scanCount || 0}*\n` +
        `📈 MC Threshold: *${token.marketCapThreshold}%*\n` +
        `🔊 Vol Threshold: *${token.volumeThreshold}%*\n` +
        `🔥 Live Tracking: *${token.isLiveTracking ? 'ENABLED ✅' : 'DISABLED ❌'}*\n` +
        (token.isLiveTracking ? `🏔 Live Peak: *$${(token.livePeakMc || 0).toLocaleString()}*\n` : '') +
        (token.isLiveTracking ? `⤴️ Live Trough: *$${(token.liveTroughMc || 0).toLocaleString()}*\n` : '') +
        (token.isLiveTracking ? `🔢 Streak: *${token.liveConsecutiveCount || 0}* (${token.liveConsecutiveType || 'none'})\n` : '') +
        `📊 Stagnation: *${token.isStagnationTracking ? 'TRACKING ✅' : 'DISABLED ❌'}*\n` +
        (token.isStagnationTracking && token.stagnationLowMc > 0 ? `📉 Last Low: *$${token.stagnationLowMc.toLocaleString()} MC | $${token.stagnationLowPrice || 0} price*\n` : '') +
        (token.isStagnationTracking && token.stagnationHighMc > 0 ? `📈 Last High: *$${token.stagnationHighMc.toLocaleString()} MC | $${token.stagnationHighPrice || 0} price*\n` : '') +
        (token.isStagnationTracking && token.crashState ? `🐱 Crash: *${token.crashState.toUpperCase()}* | Bounce scans: ${token.bounceConfirmationScans || 0}\n` : '');

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.url('📈 View on DexScreener', `https://dexscreener.com/${token.chain}/${token.tokenAddress}`)],
        [Markup.button.callback('📉 Update MC', `new_threshold:${token._id}`), Markup.button.callback('🔊 Update Vol', `new_threshold:${token._id}`)],
        [
          token.isLiveTracking
            ? Markup.button.callback('⏸ Disable Live Update', `toggle_live:${token._id}`)
            : Markup.button.callback('🔥 Enable Live Update', `toggle_live:${token._id}`)
        ],
        [
          token.isActive
            ? Markup.button.callback('⏸ Pause Monitoring', `disable:${token._id}`)
            : Markup.button.callback('▶️ Resume Monitoring', `enable:${token._id}`),
          Markup.button.callback('🔔 Surge Alert', `test_alert:${token._id}`)
        ],
        [
          Markup.button.callback('🧪 Test Live Update', `test_live:${token._id}`),
          Markup.button.callback('🔄 Reset Baseline', `reset_base:${token._id}`),
          Markup.button.callback('💥 Test Crash', `test_crash:${token._id}`)
        ],
        [
          token.isStagnationTracking
            ? Markup.button.callback('📊 Disable Stagnation', `toggle_stagnation:${token._id}`)
            : Markup.button.callback('📊 Enable Stagnation', `toggle_stagnation:${token._id}`)
        ],
        [
          Markup.button.callback('⚖️ Lev Strategy', `lev_strategy:${token._id}`),
          Markup.button.callback('🔍 Research', `research_menu:${token._id}`),
          Markup.button.callback('🐦 FUD on X', `research:fud:${token._id}`)
        ],
        [Markup.button.callback('⬅️ Back to List', 'list_page:1'), Markup.button.callback('🗑 Dismiss', 'dismiss')]
      ]);

      await ctx.editMessageText(card, { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup });
      return;
    }

    // ====================================================================
    // RESEARCH MENU — Show research sub-menu for a token
    // ====================================================================
    if (data.startsWith('research_menu:')) {
      const id = data.split(':')[1];
      const token = await Token.findById(id);
      if (!token) return ctx.answerCbQuery('Token not found');

      ctx.answerCbQuery();
      const symbol = token.symbol || token.tokenId;
      const isEVM = isEVMChain(token.chain);

      let menuText = `🔍 <b>Research: ${symbol}</b>\nWhat would you like to research?\n\n`;

      let buttons;
      if (isEVM) {
        menuText += `<i>Moralis (on-chain) + Grok (web research)</i>`;
        buttons = [
          [Markup.button.callback('📊 Tokenomics', `research:tokenomics:${token._id}`), Markup.button.callback('👥 Top 10 Holders', `research:holders:${token._id}`)],
          [Markup.button.callback('🔓 Upcoming Unlocks', `research:unlocks:${token._id}`), Markup.button.callback('🐦 FUD on X', `research:fud:${token._id}`)],
          [Markup.button.callback('💰 Investor Backers', `research:investors:${token._id}`)],
          [Markup.button.callback('⬅️ Back to Detail', `load_details:${token._id}`), Markup.button.callback('🗑 Dismiss', 'dismiss')]
        ];
      } else {
        menuText += `<i>⚠️ Tokenomics & holder data unavailable for Solana via Moralis.</i>\n\n<i>Grok web research available:</i>`;
        buttons = [
          [Markup.button.callback('🔓 Upcoming Unlocks', `research:unlocks:${token._id}`), Markup.button.callback('🐦 FUD on X', `research:fud:${token._id}`)],
          [Markup.button.callback('💰 Investor Backers', `research:investors:${token._id}`)],
          [Markup.button.callback('⬅️ Back to Detail', `load_details:${token._id}`), Markup.button.callback('🗑 Dismiss', 'dismiss')]
        ];
      }

      try {
        await ctx.editMessageText(menuText, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buttons }
        });
      } catch (err) {
        // If edit fails (e.g. from command context), send new
        ctx.replyWithHTML(menuText, Markup.inlineKeyboard(buttons));
      }
      return;
    }

    // ====================================================================
    // RESEARCH: Tokenomics (Moralis)
    // ====================================================================
    if (data.startsWith('research:tokenomics:')) {
      const id = data.split(':')[2];
      const token = await Token.findById(id);
      if (!token) return ctx.answerCbQuery('Token not found');

      ctx.answerCbQuery('Fetching tokenomics from Moralis...');
      const loadingMsg = await ctx.reply(`📊 <b>Loading tokenomics for ${token.symbol || token.tokenId}...</b>`, { parse_mode: 'HTML' });

      const result = await getTokenMetadata(token.chain, token.tokenAddress);

      // Clean up loading
      ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});

      if (!result.success) {
        ctx.reply(`❌ <b>Tokenomics Error:</b> ${result.error}`, { parse_mode: 'HTML' });
        return;
      }

      const d = result.data;
      const totalSupplyNum = parseFloat(d.totalSupply?.replace(/,/g, '') || '0');
      const supplyLabel = totalSupplyNum > 0 ? totalSupplyNum.toLocaleString() : d.totalSupply;

      const output = `<b>📊 TOKENOMICS: ${d.symbol || token.symbol}</b>\n` +
        `<b>━━━━━━━━━━━━━━━━━━</b>\n\n` +
        `<b>Name:</b> ${d.name}\n` +
        `<b>Symbol:</b> $${d.symbol}\n` +
        `<b>Decimals:</b> ${d.decimals}\n` +
        `<b>Total Supply:</b> ${supplyLabel}\n` +
        `<b>Token Type:</b> ${d.tokenType}\n` +
        `<b>Verified Contract:</b> ${d.verifiedContract ? '✅ Yes' : '⚠️ No'}\n` +
        `<b>Possible Spam:</b> ${d.possibleSpam ? '⚠️ YES — flagged by Moralis' : '✅ No'}\n\n` +
        `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
        `<b>Source:</b> Moralis EVM API | <i>Powered by DexSurgeTracker</i>`;

      ctx.replyWithHTML(output);
      return;
    }

    // ====================================================================
    // RESEARCH: Top 10 Holders (Moralis)
    // ====================================================================
    if (data.startsWith('research:holders:')) {
      const id = data.split(':')[2];
      const token = await Token.findById(id);
      if (!token) return ctx.answerCbQuery('Token not found');

      ctx.answerCbQuery('Fetching holder data from Moralis...');
      const loadingMsg = await ctx.reply(`👥 <b>Loading holders for ${token.symbol || token.tokenId}...</b>`, { parse_mode: 'HTML' });

      const result = await getTopHolders(token.chain, token.tokenAddress);

      // Clean up loading
      ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});

      if (!result.success) {
        ctx.reply(`❌ <b>Holders Error:</b> ${result.error}`, { parse_mode: 'HTML' });
        return;
      }

      const d = result.data;
      const riskEmoji = { LOW: '🟢', MEDIUM: '🟡', HIGH: '🔴' };
      const riskIcon = riskEmoji[d.riskLevel] || '⚪';

      let output = `<b>👥 TOP HOLDERS: ${token.symbol}</b>\n` +
        `<b>━━━━━━━━━━━━━━━━━━</b>\n\n` +
        `<b>Total Holders:</b> ${d.totalHolders.toLocaleString()}\n` +
        `<b>Top 10 Concentration:</b> ${d.top10Concentration}% ${riskIcon} <b>${d.riskLevel} RISK</b>\n\n`;

      if (d.holders.length === 0) {
        output += `<i>No holder data available — this may be a very new or unindexed token.</i>\n`;
      } else {
        d.holders.forEach((h, i) => {
          const shortAddr = h.address?.slice(0, 6) + '...' + h.address?.slice(-4);
          const balShort = parseFloat(h.balance).toLocaleString(undefined, { maximumFractionDigits: 2 });
          output += `<b>${i + 1}.</b> <code>${shortAddr}</code> — ${balShort} (${h.percentOfSupply}%)\n`;
        });
      }

      output += `\n`;

      if (d.riskLevel === 'HIGH' && d.holders.length > 0) {
        output += `<b>⚠️ Whale Alert:</b> Top 10 holders control ${d.top10Concentration}% of supply — highly concentrated.\n\n`;
      }

      output += `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
        `<b>Source:</b> Moralis EVM API | <i>Powered by DexSurgeTracker</i>`;

      ctx.replyWithHTML(output);
      return;
    }

    // ====================================================================
    // RESEARCH: Upcoming Unlocks (Grok)
    // ====================================================================
    if (data.startsWith('research:unlocks:')) {
      const id = data.split(':')[2];
      const token = await Token.findById(id);
      if (!token) return ctx.answerCbQuery('Token not found');

      ctx.answerCbQuery('Researching unlock schedule via Grok...');
      const loadingMsg = await ctx.reply(`🔓 <b>Researching unlock schedule for ${token.symbol || token.tokenId}...</b>`, { parse_mode: 'HTML' });

      const result = await checkUpcomingUnlocks(token.name || token.symbol, token.symbol, token.chain, token.tokenAddress);

      // Clean up loading
      ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});

      if (!result.success) {
        ctx.reply(`❌ <b>Unlock Research Error:</b> ${result.error}`, { parse_mode: 'HTML' });
        return;
      }

      const formatted = formatUnlocksResult(result.result, token.symbol);
      ctx.replyWithHTML(formatted);
      return;
    }

    // ====================================================================
    // RESEARCH: FUD on X (Grok)
    // ====================================================================
    if (data.startsWith('research:fud:')) {
      const id = data.split(':')[2];
      const token = await Token.findById(id);
      if (!token) return ctx.answerCbQuery('Token not found');

      ctx.answerCbQuery('Scanning social sentiment via Grok...');
      const loadingMsg = await ctx.reply(`🐦 <b>Scanning FUD & sentiment for ${token.symbol || token.tokenId}...</b>`, { parse_mode: 'HTML' });

      // Fetch fresh price data
      const freshData = await fetchTokenData(token.chain, token.tokenAddress);
      const marketCap = freshData.success ? freshData.marketCap : token.lastMarketCap;
      const priceUsd = freshData.success ? freshData.priceUsd : token.startPrice;

      const result = await checkFUD(token.name || token.symbol, token.symbol, token.chain, marketCap, priceUsd, token.tokenAddress);

      // Clean up loading
      ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});

      if (!result.success) {
        ctx.reply(`❌ <b>FUD Research Error:</b> ${result.error}`, { parse_mode: 'HTML' });
        return;
      }

      const formatted = formatFUDResult(result.result, token.symbol);
      ctx.replyWithHTML(formatted);
      return;
    }

    // ====================================================================
    // RESEARCH: Investor Backers (Grok)
    // ====================================================================
    if (data.startsWith('research:investors:')) {
      const id = data.split(':')[2];
      const token = await Token.findById(id);
      if (!token) return ctx.answerCbQuery('Token not found');

      ctx.answerCbQuery('Researching investors via Grok...');
      const loadingMsg = await ctx.reply(`💰 <b>Researching investors & backers for ${token.symbol || token.tokenId}...</b>`, { parse_mode: 'HTML' });

      const freshData = await fetchTokenData(token.chain, token.tokenAddress);
      const marketCap = freshData.success ? freshData.marketCap : token.lastMarketCap;

      const result = await researchInvestors(token.name || token.symbol, token.symbol, token.chain, marketCap);

      // Clean up loading
      ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});

      if (!result.success) {
        ctx.reply(`❌ <b>Investor Research Error:</b> ${result.error}`, { parse_mode: 'HTML' });
        return;
      }

      const formatted = formatInvestorsResult(result.result, token.symbol);
      ctx.replyWithHTML(formatted);
      return;
    }

    if (data.startsWith('cfg_int:')) {
      const ms = parseInt(data.split(':')[1]);
      await Stats.findOneAndUpdate({}, { globalIntervalMs: ms }, { upsert: true });
      updateMonitorInterval(bot, ms);
      ctx.answerCbQuery(`Interval set to ${ms / 1000}s`);
      ctx.reply(`✅ *System update:* Scan interval changed to *${ms / 1000}s*`, { parse_mode: 'Markdown' });
      return;
    }

    if (data.startsWith('cfg_cd:')) {
      const ms = parseInt(data.split(':')[1]);
      await Stats.findOneAndUpdate({}, { globalCooldownMs: ms }, { upsert: true });
      ctx.answerCbQuery(`Default cooldown set to ${ms / 60000}m`);
      ctx.reply(`✅ *System update:* Default cooldown changed to *${ms / 60000}m*`, { parse_mode: 'Markdown' });
      return;
    }

    if (data.startsWith('cfg_delay:')) {
      const ms = parseInt(data.split(':')[1]);
      await Stats.findOneAndUpdate({}, { tokenDelayMs: ms }, { upsert: true });
      ctx.answerCbQuery(`Token delay set to ${ms}ms`);
      ctx.reply(`✅ *System update:* Inter-token delay changed to *${ms}ms*`, { parse_mode: 'Markdown' });
      return;
    }

    if (data === 'cfg_live_th') {
      ctx.session = { step: 'awaiting_live_th' };
      ctx.answerCbQuery();
      ctx.reply('Please enter the NEW Live Track Movement Threshold (%):');
      return;
    }

    if (data === 'cfg_cons_th') {
      ctx.session = { step: 'awaiting_cons_th' };
      ctx.answerCbQuery();
      ctx.reply('Enter the consecutive scans threshold required to trigger a live update (default 2):');
      return;
    }

    if (data === 'cfg_sent_win') {
      ctx.session = { step: 'awaiting_sent_win' };
      ctx.answerCbQuery();
      ctx.reply('Enter the sentiment calculation window in hours (default 4):');
      return;
    }

    if (data.startsWith('cfg_trend:')) {
      const ms = parseInt(data.split(':')[1]);
      await Stats.findOneAndUpdate({}, { trendingIntervalMs: ms }, { upsert: true });
      updateTrendingInterval(ms);
      ctx.answerCbQuery(`Trending interval set to ${ms / 3600000}h`);
      ctx.reply(`✅ *System update:* Trending interval changed to *${ms / 3600000}h*`, { parse_mode: 'Markdown' });
      return;
    }

    // --- Stagnation & Crash Detection Config Callbacks ---

    if (data === 'cfg_stag_win') {
      ctx.session = { step: 'awaiting_stag_win' };
      ctx.answerCbQuery();
      ctx.reply('Enter stagnation window in hours (1-48, default 4):');
      return;
    }

    if (data === 'cfg_stag_pct') {
      ctx.session = { step: 'awaiting_stag_pct' };
      ctx.answerCbQuery();
      ctx.reply('Enter stagnation % threshold (default 5):');
      return;
    }

    if (data === 'cfg_stag_cd') {
      ctx.session = { step: 'awaiting_stag_cd' };
      ctx.answerCbQuery();
      ctx.reply('Enter stagnation alert cooldown in hours (default 1):');
      return;
    }

    if (data === 'cfg_crash_pct') {
      ctx.session = { step: 'awaiting_crash_pct' };
      ctx.answerCbQuery();
      ctx.reply('Enter crash % threshold (30-80, default 40):');
      return;
    }

    if (data === 'cfg_crash_win') {
      ctx.session = { step: 'awaiting_crash_win' };
      ctx.answerCbQuery();
      ctx.reply('Enter crash window in hours (4-48, default 24):');
      return;
    }

    if (data === 'cfg_bounce_pct') {
      ctx.session = { step: 'awaiting_bounce_pct' };
      ctx.answerCbQuery();
      ctx.reply('Enter bounce confirmation % threshold (5-15, default 8):');
      return;
    }

    if (data === 'cfg_bounce_scans') {
      ctx.session = { step: 'awaiting_bounce_scans' };
      ctx.answerCbQuery();
      ctx.reply('Enter bounce confirmation consecutive scans (2-5, default 3):');
      return;
    }

    if (data === 'cfg_dcb_toggle') {
      const stats = await Stats.findOne();
      const newVal = !(stats?.deadCatBounceEnabled !== false);
      await Stats.findOneAndUpdate({}, { deadCatBounceEnabled: newVal }, { upsert: true });
      ctx.answerCbQuery(`Dead Cat Bounce: ${newVal ? 'ON' : 'OFF'}`);
      ctx.reply(`✅ *System update:* Dead Cat Bounce monitoring *${newVal ? 'ENABLED' : 'DISABLED'}*`, { parse_mode: 'Markdown' });
      return;
    }

    // --- Per-Token Stagnation Toggle ---
    if (data.startsWith('toggle_stagnation:')) {
      const id = data.split(':')[1];
      const token = await Token.findById(id);
      if (!token) return ctx.answerCbQuery('Token not found');

      const newState = !token.isStagnationTracking;
      await Token.findByIdAndUpdate(id, {
        isStagnationTracking: newState,
        crashState: null,
        bounceConfirmationScans: 0,
        stagnationAlertedAt: null,
        stagnationLastType: null
      });

      ctx.answerCbQuery(`Stagnation ${newState ? 'enabled' : 'disabled'}`);
      ctx.callbackQuery.data = `load_details:${id}`;
      return bot.handleUpdate(ctx.update);
    }

    if (data.startsWith('test_alert:')) {
      const id = data.split(':')[1];
      const token = await Token.findById(id);
      if (!token) return ctx.answerCbQuery('Token not found');

      ctx.answerCbQuery('Sending mock alert...');
      const message = `🔔 *TEST ALERT: Surging Volume Detected* 🔔\n\n` +
        `*Token:* ${token.name || token.symbol} (${token.chain.toUpperCase()})\n` +
        `*Price:* $${token.startPrice || '0.00'}\n\n` +
        `📈 *Market Cap:* +${(Math.random() * 5 + 5).toFixed(2)}%\n` +
        `🔊 *Volume Spike:* +${(Math.random() * 20 + 10).toFixed(2)}% (m5)\n\n` +
        `_Note: This is a test notification generated manually._`;

      const keyboard = [
        [{ text: '📈 View on DexScreener', url: `https://dexscreener.com/${token.chain}/${token.tokenAddress}` }],
        [{ text: '⏸ Disable Alert', callback_data: `disable:${token._id}` }],
        [{ text: '📊 Set New Thresholds', callback_data: `new_threshold:${token._id}` }],
        [{ text: '🗑 Dismiss', callback_data: 'dismiss' }]
      ];

      await ctx.replyWithMarkdown(message, { reply_markup: { inline_keyboard: keyboard } });
      return;
    }

    if (data.startsWith('test_live:')) {
      const id = data.split(':')[1];
      const token = await Token.findById(id);
      if (!token) return ctx.answerCbQuery('Token not found');

      ctx.answerCbQuery('Simulating Live Update...');
      
      const stats = await Stats.findOne() || {};
      const sentiment = await getSentimentInfo(token.tokenId, stats.sentimentWindowHours || 4);
      
      const mockMc = (token.lastMarketCap || 100000) * 1.15;
      const mockChange = 15.0;

      const fullMessage = `📈 *LIVE: ${token.symbol}* 📈\n\n` +
                          `The token is *making progress*!\n` +
                          `*Market Cap:* $${mockMc.toLocaleString()} (+${mockChange.toFixed(2)}%)\n` +
                          `*Price:* $${token.startPrice || '0.00'}\n\n` +
                          `🚀 *NEW PEAK ACHIEVED!*\n\n` +
                          `${sentiment}\n\n` +
                          `_Updated at: ${new Date().toLocaleTimeString()} | Streak: ${token.liveConsecutiveCount + 1} bullish_\n\n` +
                          `⚠️ *TEST NOTIFICATION*`;

      const keyboard = [
        [{ text: '📈 View on DexScreener', url: `https://dexscreener.com/${token.chain}/${token.tokenAddress}` }],
        [{ text: '⏸ Stop Live Tracking', callback_data: `toggle_live:${token._id}` }]
      ];

      // Send the "Main" message
      const msg = await ctx.replyWithMarkdown(fullMessage, { reply_markup: { inline_keyboard: keyboard } });
      
      // Store it so you can see it edit later if you trigger again
      token.lastLiveMessageId = msg.message_id;
      await token.save();

      // Send the Summary Ping
      const summaryText = `📈 *BULLISH* update for *${token.symbol}* (+${mockChange.toFixed(1)}%) [TEST]`;
      await bot.telegram.sendMessage(token.userId, summaryText, {
        parse_mode: 'Markdown',
        reply_to_message_id: msg.message_id
      });

      return;
    }

    // --- Test Crash Button ---
    if (data.startsWith('test_crash:')) {
      const id = data.split(':')[1];
      const token = await Token.findById(id);
      if (!token) return ctx.answerCbQuery('Token not found');
      if (!token.isStagnationTracking) {
        ctx.answerCbQuery('Enable stagnation tracking first');
        return ctx.reply('⚠️ Enable stagnation tracking first before testing crash detection.');
      }

      ctx.answerCbQuery('Simulating crash detection...');

      const fresh = await fetchTokenData(token.chain, token.tokenAddress);
      if (!fresh.success) return ctx.reply('❌ Failed to fetch live data for test.');

      const peakMc = fresh.marketCap;
      const peakPrice = parseFloat(fresh.priceUsd) || 0;
      const troughMc = Math.round(peakMc * 0.55);
      const troughPrice = peakPrice * 0.55;

      const crashMsg = `💥 <b>CRASH DETECTED [TEST]: ${fresh.symbol}</b> 💥\n` +
        `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
        `📉 <b>MC:</b> -45.0% | <b>Price:</b> -45.0%\n` +
        `🏔 <b>Peak (live):</b> $${peakMc.toLocaleString()} MC at $${peakPrice}\n` +
        `📉 <b>Trough (simulated):</b> $${troughMc.toLocaleString()} MC at $${troughPrice.toFixed(8)}\n` +
        `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
        `🔍 [TEST] This is a simulated crash alert — no real data changed.\n` +
        `✅ In production: ≥8% bounce + 3 consecutive scans = Wave 1 entry.`;

      ctx.replyWithHTML(crashMsg);
      return;
    }

    if (data.startsWith('reset_base:')) {
      const id = data.split(':')[1];
      const token = await Token.findById(id);
      if (!token) return ctx.answerCbQuery('Token not found');

      const live = await fetchTokenData(token.chain, token.tokenAddress);
      if (!live.success) return ctx.answerCbQuery('Failed to fetch live data');

      await Token.findByIdAndUpdate(id, {
        startPrice: live.priceUsd,
        startMarketCap: live.marketCap,
        startVolumeH1: live.volumeH1,
        lastMarketCap: live.marketCap,
        lastVolumeM5: live.volumeM5,
        lastVolumeH1: live.volumeH1,
        lastAlertAt: null,
        lastLiveMc: live.marketCap,
        livePeakMc: live.marketCap,
        liveTroughMc: live.marketCap,
        liveConsecutiveCount: 0,
        liveConsecutiveType: null,
        lastLiveMessageId: null,
        lastReportedType: null
      });

      ctx.answerCbQuery('✅ Baseline reset!');
      ctx.reply(`✅ *Baseline Reset:* ${token.symbol} baseline updated to current price ($${live.priceUsd}). Cooldown cleared.`);
      return;
    }

    if (data.startsWith('cfg_strat:')) {
      const strat = data.split(':')[1];
      await Stats.findOneAndUpdate({}, { alertStrategy: strat }, { upsert: true });
      ctx.answerCbQuery(`Strategy set to ${strat}`);
      const labels = { any: 'EITHER met', both: 'BOTH met', mcap: 'MC ONLY', volume: 'VOLUME ONLY' };
      ctx.reply(`✅ *System update:* Alert logic changed to *${labels[strat]}*`, { parse_mode: 'Markdown' });
      return;
    }

    if (data === 'trending_refresh') {
      ctx.answerCbQuery('Refreshing trending data...');
      await manualTrending(bot, ctx.chat.id);
      return;
    }

    if (data === 'trending_bullish') {
      ctx.answerCbQuery('Loading bullish niches...');
      await sendBullishReport(bot, ctx.chat.id);
      return;
    }

    if (data === 'trending_bearish') {
      ctx.answerCbQuery('Loading bearish niches...');
      await sendBearishReport(bot, ctx.chat.id);
      return;
    }

    if (data === 'noop') {
      ctx.answerCbQuery();
      return;
    }

    if (data === 'dismiss') {
      ctx.answerCbQuery();
      ctx.deleteMessage().catch(() => {});
      return;
    }

    if (data.startsWith('remove:')) {
      const id = data.split(':')[1];
      await Token.findByIdAndDelete(id);
      ctx.answerCbQuery('Token removed');
      ctx.editMessageText('✅ Token removed from monitor.');
      return;
    }

    if (data.startsWith('disable:')) {
      const id = data.split(':')[1];
      await Token.findByIdAndUpdate(id, { isActive: false });
      ctx.answerCbQuery('Alert disabled');
      ctx.reply('Alert monitoring for this token has been disabled.');
      return;
    }

    if (data.startsWith('enable:')) {
      const id = data.split(':')[1];
      await Token.findByIdAndUpdate(id, { isActive: true, lastAlertAt: null }); // Reset cooldown on re-enable
      ctx.answerCbQuery('Alert enabled');
      ctx.reply('✅ Alert monitoring has been re-enabled and cooldown reset.');
      return;
    }

    if (data.startsWith('new_threshold:')) {
      const id = data.split(':')[1];
      const token = await Token.findById(id);
      if (!token) return ctx.answerCbQuery('Token not found');

      ctx.session = {
        step: 'awaiting_update_mc',
        chain: token.chain,
        address: token.tokenAddress,
        isUpdate: true,
        tokenId: token.tokenId,
        _id: token._id
      };
      ctx.answerCbQuery();
      ctx.reply('Enter the NEW Market Cap Change Threshold (%):');
      return;
    }

    if (data === 'toggle_live_init') {
      ctx.session.isLiveTracking = !ctx.session.isLiveTracking;
      ctx.answerCbQuery();
      await setupConfigurator(ctx, ctx.session.chain, ctx.session.address);
      return;
    }

    if (data.startsWith('toggle_live:')) {
      const id = data.split(':')[1];
      const token = await Token.findById(id);
      if (!token) return ctx.answerCbQuery('Token not found');

      const newState = !token.isLiveTracking;
      await Token.findByIdAndUpdate(id, { 
        isLiveTracking: newState,
        lastLiveMc: newState ? token.lastMarketCap : 0, // Set baseline if enabling
        livePeakMc: newState ? token.lastMarketCap : 0, // Reset peak if enabling
        liveTroughMc: newState ? token.lastMarketCap : 0, // Reset trough if enabling
        liveConsecutiveCount: 0,
        liveConsecutiveType: null,
        lastLiveMessageId: null,
        lastReportedType: null
      });

      ctx.answerCbQuery(`Live update ${newState ? 'enabled' : 'disabled'}`);
      // Refresh details view
      ctx.callbackQuery.data = `load_details:${id}`;
      return bot.handleUpdate(ctx.update);
    }

    if (data.startsWith('lev_strategy:')) {
      const id = data.split(':')[1];
      const token = await Token.findById(id);
      if (!token) return ctx.answerCbQuery('Token not found');

      ctx.answerCbQuery('Pre-filling leverage wizard...');

      // Fetch fresh token data to pre-fill
      const freshData = await fetchTokenData(token.chain, token.tokenAddress);

      // Delete previous question if any
      if (ctx.session?.lastLevQuestionId) {
        ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.lastLevQuestionId).catch(() => {});
      }

      const msg = await ctx.reply(
        `⚖️ *Leverage Grid DCA Strategy*\n\n` +
        `📋 *Pre-filled from ${token.symbol}:*\n` +
        `💰 Entry Price: $${freshData.priceUsd}\n` +
        `📊 Market Cap: $${(freshData.marketCap || 0).toLocaleString()}\n\n` +
        `Please enter your *Leverage* (e.g. 5 for 5x):`,
        { parse_mode: 'Markdown' }
      );

      ctx.session = {
        step: 'awaiting_leverage',
        levTokenId: id,
        prefillEntryPrice: parseFloat(freshData.priceUsd || '0'),
        prefillMarketCap: freshData.marketCap || 0,
        lastLevQuestionId: msg.message_id,
        levTriggerMsgId: ctx.callbackQuery.message.message_id
      };
      return;
    }

    if (data.startsWith('lev_mode:')) {
      const mode = data.split(':')[1]; // 'isolated' or 'cross'
      ctx.session.levMode = mode;
      ctx.answerCbQuery(`Mode: ${mode}`);
      ctx.session.step = 'awaiting_lev_direction';
      // Delete the mode-selection keyboard message
      ctx.deleteMessage().catch(() => {});
      const msg = await ctx.reply(`✅ Mode: *${mode.toUpperCase()}*\n\nNow enter *Direction* — reply "long" or "short":`, { parse_mode: 'Markdown' });
      ctx.session.lastLevQuestionId = msg.message_id;
      return;
    }

    if (data.startsWith('lev_model:')) {
      const model = data.split(':')[1]; // 'deepseek' or 'grok'
      ctx.answerCbQuery(`Using ${model === 'grok' ? 'Grok 4.1 Fast' : 'DeepSeek Chat'}...`);

      // Don't delete the model selection message — keep it so user can retry with other model
      // Just show a loading message
      const loadingMsg = await ctx.reply(`🧠 *Calculating leverage grid DCA strategy via ${model === 'grok' ? 'Grok 4.1 Fast' : 'DeepSeek Chat'}...*`, { parse_mode: 'Markdown' });

      const {
        leverage, levAmount, levEntryPrice, levMarketCap,
        levAccountBalance, levMode, levDirection, levContext
      } = ctx.session;

      const params = {
        leverage,
        amount: levAmount,
        entryPrice: levEntryPrice,
        marketCap: levMarketCap,
        accountBalance: levAccountBalance,
        leverageMode: levMode,
        gridOrders: 5,
        direction: levDirection || 'long',
        tokenContext: levContext || ''
      };

      const response = model === 'grok'
        ? await getGrokStrategy(params)
        : await getLeverageStrategy(params);

      // Clean up loading message
      ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});

      if (!response.success) {
        // Don't clear session — let user retry with other model
        ctx.reply(`❌ ${model === 'grok' ? 'Grok' : 'DeepSeek'} Error: ${response.error}\n\nTry the other model or check your API key.`);
        return;
      }

      // Success! Delete the model selection message and clear session
      if (ctx.session.levModelMsgId) {
        ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.levModelMsgId).catch(() => {});
      }

      const formattedOutput = formatLeverageOutput(response.result);
      const modelLabel = response.model || (model === 'grok' ? 'grok-4.1-fast' : 'deepseek-chat');
      const triggerMsgId = ctx.session.levTriggerMsgId;

      const header = `<b>⚖️ LEVERAGE GRID DCA STRATEGY</b>\n` +
        `<b>━━━━━━━━━━━━━━━━━━</b>\n` +
        `<b>Inputs:</b> ${leverage}x ${(levDirection || 'long').toUpperCase()} | $${levAmount} | Entry $${levEntryPrice} | MC $${levMarketCap.toLocaleString()} | ${levMode?.toUpperCase()}\n` +
        `<b>Model:</b> ${modelLabel}\n` +
        `<b>━━━━━━━━━━━━━━━━━━</b>\n\n` +
        formattedOutput;

      ctx.session = null;

      const replyParams = { parse_mode: 'HTML' };
      if (triggerMsgId) {
        replyParams.reply_to_message_id = triggerMsgId;
      }
      ctx.replyWithHTML(header, replyParams);
      return;
    }

    if (data === 'lev_model_cancel') {
      ctx.answerCbQuery('Cancelled');
      if (ctx.session.levModelMsgId) {
        ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.levModelMsgId).catch(() => {});
      }
      ctx.session = null;
      ctx.reply('⚖️ Leverage strategy cancelled.');
      return;
    }
  });

  // Handle update logic
  bot.on('text', async (ctx, next) => {
    if (ctx.session?.step === 'awaiting_update_mc') {
      const val = parseFloat(ctx.message.text);
      if (isNaN(val)) return ctx.reply('Invalid number.');
      ctx.session.mcThreshold = val;
      ctx.session.step = 'awaiting_update_vol';
      ctx.reply('Enter the NEW Volume Change Threshold (%):');
      return;
    }

    if (ctx.session?.step === 'awaiting_update_vol') {
      const val = parseFloat(ctx.message.text);
      if (isNaN(val)) return ctx.reply('Invalid number.');

      try {
        await Token.findByIdAndUpdate(ctx.session._id, {
          marketCapThreshold: ctx.session.mcThreshold,
          volumeThreshold: val,
          isActive: true,
          lastAlertAt: null // Reset cooldown on threshold update
        });
        ctx.session = null;
        ctx.reply('✅ Thresholds updated successfully and cooldown reset!');
      } catch (error) {
        ctx.reply('Error updating: ' + error.message);
      }
      return;
    }
    return next();
  });

  return bot;
};
