import { Markup, Telegraf, session } from 'telegraf';
import { Stats } from '../models/Stats.js';
import { Token } from '../models/Token.js';
import { updateMonitorInterval } from '../services/cron.js';
import { fetchTokenData } from '../services/dexScreener.js';

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
    { command: 'config', description: 'System status & configuration' },
    { command: 'remove', description: 'Stop monitoring a token' }
  ]);

  bot.start((ctx) => {
    ctx.reply('🚀 Welcome to Dex Volume Monitor!\n\nUse /add to start monitoring a new token.\nCommands: /add, /remove, /list, /config');
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
      `🔊 Vol Threshold: *${ctx.session.volThreshold}%*\n`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📈 Set MC Threshold', 'set_mc_btn'), Markup.button.callback('🔊 Set Vol Threshold', 'set_vol_btn')],
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

      let message = `📋 *Your Monitored Tokens (Page ${page})*\n\n`;
      const keyboardButtons = [];

      tokens.forEach((t, i) => {
        const nameDisplay = t.name ? `${t.name} (${t.symbol})` : t.tokenId;
        message += `*${skip + i + 1}.* ${nameDisplay}\n`;
        message += `   📡 Scans: ${t.scanCount || 0} | MC: ${t.marketCapThreshold}% | Vol: ${t.volumeThreshold}% | ${t.isActive ? '✅' : '⏸'}\n\n`;

        keyboardButtons.push([Markup.button.callback(`🔍 Detail: ${t.symbol || t.tokenId}`, `load_details:${t._id}`)]);
      });

      const navButtons = [];
      if (page > 1) navButtons.push(Markup.button.callback('◀️ Prev', `list_page:${page - 1}`));
      if (total > skip + limit) navButtons.push(Markup.button.callback('Next ▶️', `list_page:${page + 1}`));

      if (navButtons.length > 0) keyboardButtons.push(navButtons);
      keyboardButtons.push([Markup.button.callback('🗑 Dismiss', 'dismiss')]);

      const keyboard = Markup.inlineKeyboard(keyboardButtons);

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

  bot.command('config', async (ctx) => {
    try {
      let stats = await Stats.findOne();
      if (!stats) stats = await Stats.create({});

      const uptime = Math.floor(process.uptime() / 60);
      const message = `⚙️ *System Configuration & Status*\n\n` +
        `⏱ *Uptime:* ${uptime} minutes\n` +
        `🔍 *Total Scans:* ${stats.totalScans}\n` +
        `🚨 *Total Alerts:* ${stats.globalAlerts}\n\n` +
        `📡 *Scan Interval:* ${stats.globalIntervalMs / 1000}s\n` +
        `⏳ *Check Delay:* ${stats.tokenDelayMs}ms\n` +
        `❄️ *Default Cooldown:* ${stats.globalCooldownMs / 60000}m\n` +
        `🎯 *Alert Logic:* ${stats.alertStrategy === 'both' ? 'BOTH met' : 'EITHER met'}\n\n` +
        `Use buttons below to update global settings:`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📡 30s Scan', 'cfg_int:30000'), Markup.button.callback('📡 1m Scan', 'cfg_int:60000')],
        [Markup.button.callback('⏳ 0ms Delay', 'cfg_delay:0'), Markup.button.callback('⏳ 100ms Delay', 'cfg_delay:100')],
        [Markup.button.callback('💎 MC Only', 'cfg_strat:mcap'), Markup.button.callback('📊 Vol Only', 'cfg_strat:volume')],
        [Markup.button.callback('🤝 Both Met', 'cfg_strat:both'), Markup.button.callback('🍭 Either Met', 'cfg_strat:any')],
        [Markup.button.callback('❄️ 1m CD', 'cfg_cd:60000'), Markup.button.callback('❄️ 3m CD', 'cfg_cd:180000'), Markup.button.callback('❄️ 10m CD', 'cfg_cd:600000')],
        [Markup.button.callback('🗑 Dismiss', 'dismiss')]
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
  });

  bot.on('callback_query', async (ctx) => {
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
      const { chain, address, mcThreshold, volThreshold, tokenData } = ctx.session;
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
          lastVolumeM5: tokenData.volumeM5,
          lastVolumeH1: tokenData.volumeH1,
          isActive: true
        });

        await token.save();
        ctx.session = null;
        ctx.answerCbQuery('Monitoring started!');
        ctx.reply(`✅ *Success!* Started monitoring *${tokenData.name}* (${tokenData.symbol}).\nThresholds: MC: ${mcThreshold}% | Vol: ${volThreshold}%`, { parse_mode: 'Markdown' });
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
        `🔊 Vol Threshold: *${token.volumeThreshold}%*\n`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.url('📈 View on DexScreener', `https://dexscreener.com/${token.chain}/${token.tokenAddress}`)],
        [Markup.button.callback('📉 Update MC', `new_threshold:${token._id}`), Markup.button.callback('🔊 Update Vol', `new_threshold:${token._id}`)],
        [
          token.isActive
            ? Markup.button.callback('⏸ Pause Monitoring', `disable:${token._id}`)
            : Markup.button.callback('▶️ Resume Monitoring', `enable:${token._id}`),
          Markup.button.callback('🔔 Test Alert', `test_alert:${token._id}`)
        ],
        [Markup.button.callback('🔄 Reset Baseline', `reset_base:${token._id}`)],
        [Markup.button.callback('⬅️ Back to List', 'list_page:1'), Markup.button.callback('🗑 Dismiss', 'dismiss')]
      ]);

      await ctx.editMessageText(card, { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup });
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
        lastAlertAt: null
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
      // Overwrite the step in session to handle update logic
      ctx.session.step = 'awaiting_update_mc';
      ctx.answerCbQuery();
      ctx.reply('Enter the NEW Market Cap Change Threshold (%):');
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
