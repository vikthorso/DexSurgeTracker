import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { setupBot } from './bot/bot.js';
import { setupCron } from './services/cron.js';
import apiRoutes from './api/routes.js';

console.log('🏁 Starting Dex Volume Monitor...');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!MONGO_URI || !BOT_TOKEN) {
  console.error('CRITICAL ERROR: MONGODB_URI and TELEGRAM_BOT_TOKEN must be defined in .env');
  process.exit(1);
}

// Middleware
app.use(express.json());

// Routes
app.use('/api', apiRoutes);

console.log('🔌 Connecting to MongoDB...');

// Database Connection
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    
    // 1. Initialize Bot
    console.log('🤖 Initializing Bot...');
    const bot = setupBot(BOT_TOKEN);
    
    // 2. Start Monitoring Engine IMMEDIATELY
    console.log('📡 Starting Monitoring Engine...');
    setupCron(bot);
    
    // 3. Launch Bot (Async)
    bot.launch()
      .then(() => {
        console.log('✅ Telegram Bot is LIVE');
      })
      .catch(err => {
        console.error('❌ Error launching Telegram Bot:', err.message);
      });

    // 4. Start Express Server
    app.listen(PORT, () => {
      console.log(`✅ API server listening on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB Connection Error:', err.message);
    process.exit(1);
  });

// Handle graceful shutdown
process.once('SIGINT', () => {
  console.log('Stopping...');
  mongoose.connection.close();
  process.exit();
});
process.once('SIGTERM', () => {
  console.log('Stopping...');
  mongoose.connection.close();
  process.exit();
});
