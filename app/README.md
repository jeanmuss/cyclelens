# Risk Asset Cycle Map

Interactive return tables for risk assets:

- Crypto cycle map: monthly BTC, ETH, SOL, and HYPE returns.
- Equity macro map: weekly QQQ/SPY relative strength with FRED macro context from January 20, 2025 onward.

The interface follows the visual and technical idea of the original Bitcoin four-year cycle map: semantic HTML tables, CSS heat classes, and JavaScript-driven calculations.

## Commands

```bash
npm run dev
npm run build
npm run update-data
npm run update-equity-data
```

## Data flow

`scripts/update-market-data.mjs` retrieves public monthly data and writes a normalized static cache to `public/data/market-monthly.json`. The browser only reads that cache and never receives provider credentials.

- BTC: Blockchain.info market-price chart for the established open/close series; Binance Spot daily candles provide exchange highs/lows and their order from 2017 onward
- ETH and SOL: Binance Spot daily candles
- HYPE: Hyperliquid daily candles

If an upstream source fails, the updater preserves the last-known-good cached asset. The checked-in JSON lets the site continue working during an outage. Once directional history has been backfilled, later updates request only the latest two months instead of downloading the full history again.

The monthly return formula is `(close - open) / open * 100%`. For the still-open current month, `close` is replaced by the latest cached spot price so the current-month return does not stay stuck on yesterday's daily candle.

The directional extreme move is `(second extreme - first extreme) / first extreme * 100%`: low-before-high produces a positive potential gain, while high-before-low produces a negative potential loss. Daily candles establish the order; only same-day collisions are refined with hourly and then one-minute public candles. UTC month boundaries are used throughout.

Current spot prices are fetched by the backend/CI updater and cached into the same static JSON:

- BTC, ETH, and SOL: Binance Spot ticker, with multiple public endpoint fallbacks.
- HYPE: Hyperliquid public mid price.

This keeps the frontend free of provider credentials and avoids browser-side scraping. The GitHub Pages workflow refreshes the deployed static cache hourly; GitHub's scheduler can run a few minutes late, so this is near-hourly rather than tick-level realtime.

Hyperliquid's public API exposes the HYPE launch month as a monthly candle but does not retain intramonth candles for that month. Its high and low remain visible, while the directional extreme move is explicitly cached as unavailable instead of being inferred.

`scripts/update-equity-data.py` retrieves weekly equity-macro data and writes `public/data/equity-weekly.json`.

- QQQ and SPY: AKShare/Sina U.S. daily data by default, grouped into Friday-ending weeks. `EQUITY_PRICE_SOURCE=yfinance` can be used when Yahoo access is healthy.
- FRED: `DGS10`, `VIXCLS`, and `DFF`, read with `FRED_API_KEY` from the local environment or deployment secrets.
- Events: the `events` array is reserved in each weekly row, but no automatic event source or editor is enabled yet.

Only derived weekly data is cached. API keys, cookies, sessions, raw tick data, and personal data are never written to frontend files.

For CI or deployment, install Python dependencies with:

```bash
python -m pip install -r requirements-equity.txt
```

On GitHub Actions, store `FRED_API_KEY` in repository secrets. Do not put it in `.env`, frontend code, checked-in JSON, logs, screenshots, or chat.

## Deployment notes

GitHub Pages is the preferred static-share path for this repo. `.github/workflows/deploy-pages.yml` builds the Vite app, refreshes the crypto cache, uploads `app/dist`, and deploys it on:

- every push to `main`
- manual workflow dispatch
- an hourly schedule for current spot refreshes

Hourly Pages refreshes do not create hourly commits. The separate `update-market-data.yml` workflow can still be used for auditable checked-in cache updates on a lower-frequency schedule.

The repository root includes `vercel.json` for Vercel preview deployments from this workspace:

- install: `npm --prefix app ci`
- build: `npm --prefix app run build`
- output: `app/dist`
- SPA rewrite: all routes fall back to `index.html`, so `/equity-macro` can be opened directly.

The frontend is intentionally static. It should not call FRED, CoinMarketCap, AKShare, Yahoo, or any other provider from the browser. Scheduled backend/CI jobs refresh checked-in JSON caches, and the deployed site serves those static cache files.

For mainland China users, treat Vercel as the first preview host, not the only production host. If real-user testing shows unstable access, the same `app/dist` build can be mirrored to a China-friendly static host such as Alibaba Cloud OSS + CDN or Tencent Cloud COS + CDN. No data relay is required as long as the browser continues to read only static JSON.
