# DexSurgeTracker

A production-ready Telegram bot that monitors Solana, Base, Ethereum, BSC, Hyperliquid, and Sui tokens for market cap and volume spikes using the DexScreener API, CoinGecko-powered trending niche discovery, AI-powered leverage grid DCA strategy calculation via DeepSeek and Grok, tokenomics/holder analysis via Moralis, and real-time token research (FUD, unlocks, investors) via Grok web search.

---

## Features

### Token Research & Analysis (NEW)
- **`/research`** command — pick any monitored token, then choose from 5 research actions.
- **"🔍 Research" button** on every token detail view — opens a 5-option sub-menu (or 3 for Solana tokens).
- **"🐦 FUD on X" button** on every token detail view — one-tap instant FUD check (name, symbol, AND contract address searched on X).
- **📊 Tokenomics** (Moralis) — token name, symbol, decimals, total supply, contract verification, spam flags.
- **👥 Top 10 Holders** (Moralis) — wallet addresses, balances, percentage of supply, whale concentration risk (LOW/MED/HIGH).
- **🐦 FUD on X** (Grok 4.1 Fast) — social sentiment scan across X/Twitter, Reddit, and crypto news with confidence rating. Searches by token name, $SYMBOL cashtag, and contract address for maximum coverage.
- **🔓 Upcoming Unlocks** (Grok 4.1 Fast) — next unlock date/amount, 90-day schedule, tokenomics overview, unlock risk level.
- **💰 Investor Backers** (Grok 4.1 Fast) — funding rounds, notable VCs/angels, exchange relations, investor quality rating.
- **Chain-aware**: EVM tokens (ETH/BSC/Base) get all 5 options via Moralis + Grok. Solana tokens get 3 Grok-only research options.
- **Loading states**: each research action shows a spinner message that auto-deletes when results arrive.
- **HTML-formatted output**: bold section headers, structured tables, source attribution on every result.

### Token Monitoring
- **Add tokens** via contract address or DexScreener URL — interactive wizard with inline buttons and live token preview.
- **Per-token thresholds**: Market Cap (%) and Volume (%) independently configurable.
- **Live tracking** with consecutive-scan confirmation, peak/trough tracking, and trend-flip detection.
- **Smart alerts** using configurable strategies (MC only, Volume only, Both met, Either met).
- **Cooldown system** (default 3 min, adjustable) to prevent alert fatigue.
- **Snapshot storage** to MongoDB for historical alert analysis.

### Stagnation & Crash Detection (NEW)
- **Crash Detection** — dual MC+price confirmation. Detects tokens that have dumped >40% (configurable 30-80%) within a configurable window (4-48hrs). Sends immediate Tier 1 informational crash alert.
- **Dead Cat Bounce Monitoring** — three-tier alert system using price-action bounce confirmation:
  - **Tier 1 (Crash Alert)** — informational: "token crashed, monitoring for bounce"
  - **Tier 2 (Wave 1 Entry)** — actionable long signal: fires when bounce is confirmed (>=8% bounce + 3 consecutive scans above trough). Entry reference is the crash trough.
  - **Tier 3 (TP Hit / Failed / Retest)** — trade management: TP zone reached (>=10% from trough), bounce failed (broke below trough), Wave 2 setup.
- **General Stagnation Signals** — LONG when no new low in 4-48hrs + up X% from that low; SHORT when no new high in 4-48hrs + down X%.
- **Fake bounce protection** — consecutive scan requirement prevents wick traps and false entries.
- **Per-token toggle** — enable/disable stagnation tracking per token via the detail view.
- **Full `/config` panel** — adjustable bounce %, scan count, crash threshold, stagnation window, cooldown, and DCB master toggle.

### CoinGecko Trending Discovery
- **`/trending`** command with split Bullish / Bearish buttons — no single giant wall of text.
- Fetches `/coins/categories` every 4 hours (configurable) — ranks the top 10 rising and top 10 falling niches by 24h market cap change.
- Each category shows **top 3 coin names** extracted from image URLs for quick identification.
- **Historical diffing**: highlights niches that are "new on the radar" or have "fallen off" since the last snapshot.
- **5-minute in-memory cache** so tapping both bullish and bearish buttons doesn't re-hit the API.
- **HTML formatting** (`<b>`, `<i>`) for safe, clean rendering — no Markdown entity breakage from special characters in category names.

### AI-Powered Leverage Grid DCA Strategy
- **`/leverage`** command — interactive 8-step wizard to calculate a full leveraged grid DCA strategy:
  1. Leverage (max 5x)
  2. Trade Amount
  3. Entry Price
  4. Market Cap
  5. Account Balance
  6. Leverage Mode (Isolated / Cross via inline buttons)
  7. Direction (Long / Short)
  8. Token Context (optional)
- **"⚖️ Lev Strategy" button** on every monitored token detail view — pre-fills entry price and market cap from DexScreener live data, skipping manual input.
- **Multi-model support**: after entering all parameters, choose between:
  - `🧠 DeepSeek (Chat)` — DeepSeek API via OpenAI-compatible endpoint
  - `⚡ Grok 4.1 Fast` — xAI Grok via OpenAI-compatible endpoint
- **Retry-friendly**: if one model fails, the model selection remains visible so you can tap the other model.
- **Output format**: compact, numbers-focused HTML output with bold section headers (SIZE, GRID, RISK, METRICS, ADVICE), section dividers (`━━━`), and clean spacing.
- **Reply-quoting**: the final result quotes the original command or button message in a Telegram thread.
- **Question cleanup**: each wizard step deletes the previous bot question for a clutter-free chat experience.
- **Dismiss button**: available on the model selection screen to cancel at any time.

### Bot UX
- **`/list`** — 3-column grid of symbol buttons + compact per-token scan-count summary.
- **`/config`** — full system status panel with inline buttons to adjust scan intervals, cooldowns, alert strategy, live-track thresholds, sentiment windows, and trending interval.
- **`/remove`** — pick a token to stop monitoring via inline buttons.
- **`/research`** — pick a token to research: tokenomics, holders, FUD, unlocks, or investors.
- **Per-token detail view** with inline buttons: DexScreener link, Update MC/Vol, Toggle Live, Pause/Resume, Surge Alert, Test Live Update, Reset Baseline, **Lev Strategy**, **Research**, **FUD on X**.
- **Callback buttons** on all alert and live-update messages for quick disable/config/reset.

### Reliability
- **Guarded recursive `setTimeout` scheduler** instead of `setInterval` — prevents overlapping monitor cycles from starving the Node.js event loop (fixes the "commands ignored but updates still arrive" bug).
- **Per-token try/catch** — a single failing token never stalls the whole monitor loop.
- **30-second axios timeouts** on DexScreener, CoinGecko, and AI API calls.
- **CoinGecko rate limiting**: 2s minimum interval between calls, 2-min cooldown on manual `/trending`.
- **Snapshot auto-cleanup**: keeps only the last 180 trending snapshots (~30 days at 4h intervals).
- **Global unhandled rejection handler** — catches any unhandled promise rejection (e.g. ECONNRESET from Telegram API) and logs it instead of crashing the Node process.
- **Wrapped `answerCbQuery`** — all 53 callback acknowledgment calls in [`bot.js`](src/bot/bot.js:585) are automatically protected against transient network errors. Silently logged, never crashes.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js with Babel |
| Telegram API | Telegraf v4 |
| Database | MongoDB via Mongoose |
| HTTP Client | Axios |
| API Sources | DexScreener, CoinGecko, Moralis, DeepSeek, xAI (Grok) |
| AI SDK | OpenAI (compatible with DeepSeek & Grok endpoints) |
| Scheduler | Custom guarded `setTimeout` loops |
| Server | Express.js (API endpoints) |

---

## Project Structure

```
src/
├── index.js              # Entry point — connects DB, launches bot, starts schedulers
├── api/
│   └── routes.js         # REST API: GET /alerts, POST /tokens, DELETE /tokens/:id
├── bot/
│   └── bot.js            # Telegram bot commands, callback handlers, leverage wizard, add/remove/list/config/trending/research
├── models/
│   ├── Alert.js          # Alert snapshot schema
│   ├── Stats.js          # Global stats & config (intervals, cooldowns, thresholds)
│   ├── Token.js          # Monitored token schema (thresholds, live-tracking state, baselines)
│   └── TrendingSnapshot.js  # CoinGecko trending analysis snapshot
├── services/
│   ├── coinGecko.js       # CoinGecko API client (/coins/categories) with rate limiting & slug extraction
│   ├── cron.js            # Dual guarded schedulers: monitor (token alerts) + trending (niche discovery)
│   ├── deepseek.js        # DeepSeek API client (leverage grid DCA strategy)
│   ├── dexScreener.js     # DexScreener API client with 30s timeout
│   ├── grok.js            # Grok (xAI) API client (leverage grid DCA strategy)
│   ├── grokResearch.js    # Grok research prompts: FUD check, unlock schedules, investor analysis
│   ├── levTemplate.js     # Shared system template, user message builder, HTML output formatter
│   ├── monitor.js         # Token monitoring: scan, live-tracking, alerts, sentiment, stagnation/crash/dead-cat-bounce
│   ├── moralis.js         # Moralis EVM API client: token metadata + top 10 holders
│   └── trendingMonitor.js # Trending analysis: fetch, split bullish/bearish, cache, format HTML reports
├── test/
│   └── stagnation-test.js # Crash/bounce state machine test harness (5 scenarios, no DB/bot needed)
```

---

## Getting Started

1. **Clone the repository**.
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Configure environment**:
   Copy `.env.example` to `.env` and fill in:
   - `TELEGRAM_BOT_TOKEN` — from @BotFather
   - `MONGODB_URI` — your MongoDB connection string
   - `TELEGRAM_CHAT_ID` — (optional) authorized user ID for private mode
   - `DEEPSEEK_API_KEY` — DeepSeek API key (for leverage strategy)
   - `GROK_API_KEY` — xAI Grok API key (for leverage strategy & token research)
   - `MORALIS_API_KEY` — Moralis API key (for tokenomics & holder analysis on EVM chains)
4. **Run**:
   ```bash
   npm run dev    # Development with nodemon
   npm start      # Production
   ```

---

## Telegram Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and command overview |
| `/add` | Interactive wizard to add a token for monitoring |
| `/list` | Grid of monitored tokens with scan counts, tap any symbol for live details |
| `/trending` | CoinGecko niche discovery — pick Bullish or Bearish to see top movers |
| `/config` | System status & inline controls for all intervals, thresholds, and strategies |
| `/remove` | Stop monitoring a token via inline button |
| `/leverage` | Interactive wizard for AI-powered leverage grid DCA strategy calculation |
| `/research` | Research a token: tokenomics, holders, FUD on X, upcoming unlocks, investor backers |

---

## Per-Token Detail Buttons

| Button | Action |
|--------|--------|
| `📈 View on DexScreener` | Open token on DexScreener |
| `📉 Update MC` / `🔊 Update Vol` | Change thresholds |
| `⏸ Disable Live Update` / `🔥 Enable Live Update` | Toggle live tracking |
| `⏸ Pause Monitoring` / `▶️ Resume Monitoring` | Pause/resume alerts |
| `🔔 Surge Alert` | Send a test surge alert |
| `🧪 Test Live Update` | Simulate a live update message |
| `🔄 Reset Baseline` | Reset baseline price/MC to current values |
| `💥 Test Crash` | Simulate a crash alert using live token data |
| `📊 Enable/Disable Stagnation` | Toggle stagnation/crash/dead-cat-bounce tracking |
| `⚖️ Lev Strategy` | Pre-fill leverage wizard with token data |
| `🔍 Research` | Open research sub-menu: tokenomics, holders, FUD, unlocks, investors |
| `🐦 FUD on X` | One-tap FUD check — searches X/Twitter by name, symbol, and contract address |

---

## Token Research Design Rules

### Moralis (On-Chain)
- **Data source**: Moralis EVM API (`deep-index.moralis.io/api/v2.2`).
- **Supported chains**: Ethereum (`0x1`), BSC (`0x38`), Base (`0x2105`). Solana is **not supported**.
- **Endpoints used**: `GET /erc20/{address}` (token metadata), `GET /erc20/{address}/owners` (top holders, `limit=10`, `order=DESC`).
- **Rate limiting**: 30s timeout, 3s retry on 429 responses, 2s inter-request delay.
- **Output**: HTML-formatted inline messages with bold section headers and source attribution.
- **Edge cases**: Unverified contracts flagged; possible spam flagged; token not indexed shown as error.

### Grok Research (Web + AI)
- **Data source**: xAI Grok 4.1 Fast via `api.x.ai/v1` (OpenAI-compatible).
- **Research types**: Social sentiment/FUD, upcoming token unlocks, investor & backer analysis.
- **FUD search strategy**: Searches X/Twitter for token name, $SYMBOL cashtag, AND contract address for comprehensive FUD detection.
- **Prompt design**: Each research type has a structured output format with labeled sections (e.g. `[CONFIDENCE]`, `[UNLOCK RISK]`, `[INVESTOR QUALITY]`).
- **Web search**: Grok performs real-time web search for current data. Output includes disclaimer to verify independently.
- **Timeouts**: 30s axios timeout on all calls.
- **Error handling**: Empty responses, API key missing, and API errors all surfaced with clear messages.
- **Output**: HTML-formatted with bold section labels, structured bullet points, and source attribution.
- **Retry**: Not automatic — user can re-tap the research button to re-run.
- **Future**: `researchInvestors()` accepts an optional `customPrompt` parameter for user-provided templates.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/alerts` | Last 100 alert snapshots |
| `POST` | `/api/tokens` | Add a token to monitor (JSON body) |
| `DELETE` | `/api/tokens/:id` | Remove a token from monitoring |

---

## Design Rules

### DexScreener Monitoring
- Uses the **first** object returned from DexScreener's `token-pairs` API.
- `volumeChange` = max of `m5` and `h1` percentage changes.
- Default cooldown: 3 minutes (180,000 ms) — adjustable from `/config`.
- Alert strategy: configurable (any, both, mcap-only, volume-only).

### CoinGecko Trending
- Data source: `GET /coins/categories` sorted by 24h market cap change.
- Top 10 positive = Bullish niches; top 10 negative = Bearish niches.
- Top-3 coin names extracted from image URL slugs (e.g. `pieverse.png` → `Pieverse`).
- Diffed against previous snapshot stored in MongoDB to detect new/fallen-off niches.
- 5-minute in-memory cache prevents redundant API calls within a single user session.
- Cron interval: 4 hours (configurable from `/config` → 2h or 4h).

### Grok Research Strategy
- Uses dedicated prompt templates in [`grokResearch.js`](src/services/grokResearch.js) — separate from the leverage trading system prompt.
- Each research type (FUD, unlocks, investors) has its own `check*()` function with structured output format.
- Output is formatted by `formatFUDResult()`, `formatUnlocksResult()`, `formatInvestorsResult()` for Telegram HTML.
- `max_tokens`: 2000, `temperature`: 0.3 for all research calls.
- Model: `grok-4-1-fast-non-reasoning` for quick, factual results.

### Leverage Grid DCA Strategy
- Uses a shared system prompt template (`levTemplate.js`) consumed by both DeepSeek and Grok.
- Prompt is a specialized grid DCA calculator focused on low-to-mid cap manipulated tokens.
- Max 5x leverage, isolated preferred, 15% grid spacing default, 5 grid levels.
- Output format: SIZE → GRID → RISK → METRICS → ADVICE (compact, table-style).
- Model selection persists after error so users can retry with the alternate model.
- Final output is sent as a Telegram reply (threaded quote) to the triggering message.
- `max_tokens`: 1500, `temperature`: 0.3 for both models.
- DeepSeek endpoint: `https://api.deepseek.com`, model: `deepseek-chat`.
- Grok endpoint: `https://api.x.ai/v1`, model: `grok-4.1-fast`.

### Stagnation & Crash Detection
- **Dual MC+price confirmation** — a crash is only detected when both market cap AND price drop below the threshold (default 40%, configurable 30-80%). Prevents supply-change false positives (e.g. token burn drops MC but not price).
- **Price-action bounce confirmation** — Wave 1 entry fires when price bounces ≥8% from the crash trough AND holds for 3 consecutive qualifying scans. No fixed clock delay — entry fires in 5 minutes or 3 hours depending on price behavior.
- **Entry reference = crash trough** — the long entry is always calculated from the crash trough, never from the current price at confirmation time.
- **Fake bounce protection** — `bounceConfirmationScans` resets to 0 on any scan where the bounce dips below the confirmation %. A fake bounce of 2 scans followed by a new low never fires a false entry.
- **Bounce confirmation %** is configurable (5-15%, default 8%) via `/config`.
- **Consecutive scan count** is configurable (2-5 scans, default 3) via `/config`.
- **Crash auto-recovery**: if MC recovers above 80% of the crash peak during monitoring, the crash state clears automatically (`crashState = 'completed'`).
- **State machine**: `null` → `monitoring` → `wave1` → `wave1_failed`/`wave2`/`completed`. Each transition has a dedicated alert (Tier 1/2/3).
- **Stagnation signals**: operate independently of crash monitoring. LONG when no new low in 4-48hrs + moved up X% from that low. SHORT when no new high + moved down X%.
- **Stagnation cooldown**: separate from surge alert cooldown (default 1 hour, configurable).
- **test/ directory**: contains [`stagnation-test.js`](test/stagnation-test.js) — a standalone test harness that runs 5 scenarios with mock data (no MongoDB, DexScreener API, or Telegram Bot needed). Run via `npx babel-node test/stagnation-test.js`.
