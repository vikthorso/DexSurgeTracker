# Dex Volume Monitor

A production-ready MVP Telegram bot that monitors Solana, Base, Ethereum, and BSC tokens for market cap and volume spikes using the DexScreener API.

## Features

- **Token Management**: Add tokens via contract address or DexScreener URL.
- **Monitoring Engine**: Runs every 60 seconds to track 5m and 1h volume changes.
- **Smart Alerts**: Triggers alerts based on percentage thresholds for Market Cap or Volume Spikes.
- **Cooldown System**: Prevents alert fatigue with a 3-minute cooldown between alerts for the same token.
- **Snapshot Storage**: Automatically saves alert data to MongoDB for historical tracking.
- **Interactive Bot UX**: Disable alerts or update thresholds directly from the Telegram message.

## Tech Stack

- **Node.js** with Babel
- **Express.js** for API access
- **MongoDB** (Mongoose) for storage
- **Telegraf** for Telegram Bot API
- **node-cron** for scheduling

## Getting Started

1.  **Clone the repository**.
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Configure environment**:
    Copy `.env.example` to `.env` and fill in your details:
    - `TELEGRAM_BOT_TOKEN`: Your bot token from @BotFather.
    - `MONGODB_URI`: Your MongoDB connection string.
4.  **Run the application**:
    - Development mode (with nodemon): `npm run dev`
    - Production mode: `npm start`

## API Endpoints

- `GET /api/alerts`: Retrieve last 100 alert snapshots.
- `POST /api/tokens`: Add a token to monitor.
- `DELETE /api/tokens/:id`: Remove a token from monitor.

## Telegram Bot Commands

- `/start`: Welcome and basic info.
- `/add`: Start the wizard to add a new token.
- `/list`: See all tokens you are currently monitoring.
- `/remove`: Select a token to remove from monitoring.

## Design Rules

- Uses the FIRST object returned from DexScreener's `token-pairs` API.
- Calculates `volumeChange` as the maximum of `m5` and `h1` percentage changes.
- Cooldown: 3 minutes (180,000 ms).
