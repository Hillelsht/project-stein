# Project Stein — Overview

## What it is

A personalized financial news filter and signal tracker for a small family of traders (≤5 users). It ingests free public RSS feeds and SEC filings, uses an LLM to produce structured sentiment signals, and tracks whether those signals correlate with actual price movement over time.

## What it is NOT

- Not a tool to beat HFT firms. RSS feeds are seconds-to-minutes behind co-located pipelines.
- Not licensed financial advice.
- Not an auto-trader or broker integration.

## Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend + API | Next.js 15 (App Router) + TypeScript | Familiar, good tooling |
| Styling | Tailwind CSS v4 | Utility-first |
| Database | Supabase (Postgres) free tier | Free, managed, auth included |
| Hosting | Vercel Hobby | Free, native Next.js |
| Cron | GitHub Actions | Vercel Hobby only allows 1 cron/day; GH Actions is free and allows every 5 min |
| Primary LLM | Google Gemini 2.5 Flash-Lite | Best free tier: 15 RPM, 1,000 RPD, 250K TPM |
| Fallback LLM | Groq (Llama 3.3 70B) | ~1,000 RPD free, fast |
| Price data | `yahoo-finance2` npm package | Free, no API key |
| Ticker master | NASDAQ Trader CSVs | Free, refreshed weekly |
| Push | Web Push API + service worker | Free, works on iOS 16.4+ PWAs |

## High-level architecture

```
GitHub Actions (cron)
  └─ every 10 min (market hours) → hits Next.js API routes on Vercel
       ├─ /api/cron/ingest   → rssService → articles table
       ├─ /api/cron/analyze  → filterService → llmService → ai_analyses + market_signals
       ├─ /api/cron/validate → priceService + validationService → signal_outcomes
       └─ /api/cron/refresh-tickers → tickerMasterService → tickers_master

Supabase (Postgres)
  └─ all persistent state

Next.js Frontend (Vercel)
  ├─ /           → signal feed (filtered to watchlist)
  ├─ /watchlist  → manage tickers
  └─ /stats      → validation results (does our LLM actually work?)
```

## The critical pipeline design: pre-filter BEFORE LLM

Raw feeds produce 5,000–10,000 articles/day. Gemini free tier allows 1,000 LLM calls/day. Without pre-filtering, the budget is blown before 10am.

The pipeline (see `docs/pipeline.md` for detail):
1. Ticker regex extraction + validation against tickers_master
2. Material keyword filter (M&A, earnings, FDA, legal, leadership, capital, operations)
3. SEC 8-K item code filter (only material items)
4. Deduplication (SHA-256 hash, 48hr window)
5. Watchlist priority (watchlist matches always survive)
6. Daily LLM budget check (≤800 calls/day)
7. LLM call → response validation → insert to DB
8. Push notification if score ≥ 8 and ticker is watched

This pipeline reduces raw articles by ~85–95% before any LLM call.

## MVP success criteria

1. System runs end-to-end without manual intervention for 30 consecutive days.
2. After 60 days: can state with numbers whether Bullish score-8+ signals have positive mean 1-day return.
3. False-positive ticker rate < 5%.
4. Push notifications arrive within 2 minutes of source feed update.
5. Monthly infrastructure cost: $0.
