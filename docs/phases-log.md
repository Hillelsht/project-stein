# Project Stein — Phases Log

This file is updated at the end of every phase. It is the authoritative record of what has been built and what decisions were made during implementation.

---

## Phase 0 — Project scaffold ✅

**Goal:** Empty Next.js app deployed to Vercel with Supabase connected.

**What was built:**
- Next.js 16.2.4 (App Router, TypeScript, Tailwind v4, ESLint) scaffolded into `project-stein/`
- App Router pages live in `src/app/` (not root-level `app/` — moved during setup)
- `tsconfig.json` path alias `@/*` → `./src/*`
- Dependencies installed: `@supabase/supabase-js`, `@supabase/ssr`, `rss-parser`, `yahoo-finance2`, `web-push`, `@types/web-push`
- `src/lib/supabase/client.ts` — browser client using anon key
- `src/lib/supabase/server.ts` — two exports:
  - `createServerClient()` (async, cookie-based, for Server Components reading auth user)
  - `createServiceClient()` (sync, service role, for cron API routes — bypasses RLS)
- `.env.local` with all 11 env vars (placeholders); `.env.example` committed
- `.gitignore` fixed to exclude `.env.local` but allow `.env.example`
- Minimal landing page: "Project Stein — coming soon"

**Manual steps performed by user:**
- Created Supabase project; filled Supabase keys into `.env.local`
- Pushed repo to private GitHub
- Connected to Vercel; added all env vars in Vercel dashboard
- Fixed Supabase Data API "API DISABLED" issue by exposing `public` schema in Project Settings → Data API

**Commit:** `phase-0: Next.js scaffold, Supabase clients, env placeholders`

---

## Phase 1 — Database schema ✅

**Goal:** All tables created via a single SQL migration.

**What was built:**
- `supabase/migrations/0001_initial_schema.sql` — applied via Supabase SQL Editor
- `CREATE EXTENSION IF NOT EXISTS pgcrypto`
- `sentiment_enum` type: `BULLISH | BEARISH | NEUTRAL`
- 9 tables: `sources`, `articles`, `ai_analyses`, `market_signals`, `watchlist`, `signal_outcomes`, `tickers_master`, `dedup_hashes`, `push_subscriptions`
- Indexes: `market_signals(ticker_symbol, created_at DESC)`, `market_signals(sentiment_score DESC, created_at DESC)`, `dedup_hashes(created_at)`
- RLS enabled on all tables
  - Shared tables: `SELECT` for `authenticated` role
  - `watchlist`, `push_subscriptions`: full CRUD for owner only (`auth.uid() = user_id`)
- 3 sources seeded: SEC EDGAR 8-K (tier 1), PR Newswire All (tier 1), Yahoo Finance Top (tier 2)

**Commit:** `phase-1: initial schema migration`

---

## Phase 2 — Repository layer ✅

**Goal:** All DB access in `src/lib/repositories/*.ts`. Zero Supabase calls outside this folder.

**What was built:**

| File | Exports |
|---|---|
| `sourceRepo.ts` | `Source` type, `getActiveSources()`, `updateLastPolled(sourceId)` |
| `articleRepo.ts` | `Article`, `NewArticle` types, `saveArticle()`, `getArticleByUrl()`, `getUnanalyzedArticles(limit)`, `markFilterPass()`, `markFilterReject()` |
| `analysisRepo.ts` | `AiAnalysis`, `NewAnalysis` types, `saveAnalysis()`, `countAnalysesToday()` |
| `signalRepo.ts` | `MarketSignal`, `NewSignal`, `SignalFilters` types, `saveSignal()`, `getRecentSignals(filters)`, `getSignalsNeedingOutcomes(cutoffDays)` |
| `watchlistRepo.ts` | `WatchlistEntry` type, `getWatchlist(userId)`, `addTicker()`, `removeTicker()`, `getAllWatchlistTickers()` |
| `outcomeRepo.ts` | `SignalOutcome`, `HorizonData` types, `upsertOutcome()`, `getOutcomeBySignalId()`, `getStats(days)` |
| `tickerMasterRepo.ts` | `TickerRow` type, `isValidTicker(symbol)` (with in-code blocklist), `bulkUpsertTickers(rows)` |
| `dedupRepo.ts` | `hashExists(hash)`, `saveHash(hash, articleId)`, `purgeOlderThan(hours)` |
| `pushRepo.ts` | `PushSubscription`, `NewPushSubscription` types, `getSubscriptionsForUser()`, `getSubscriptionsForUsers()`, `saveSubscription()`, `deleteSubscription()` |

**Key decisions:**
- All repos use `createServiceClient()` (service role). User-specific filtering is done by passing `userId` explicitly, not relying on RLS. This keeps the repos simple and predictable.
- `saveArticle()` treats duplicate-URL postgres errors (code `23505`) as a non-error and returns `null` — callers don't need to handle it.
- `tickerMasterRepo` has an in-code blocklist (`CEO`, `SEC`, `FDA`, `USA`, etc.) that short-circuits the DB lookup for common false positives.
- `bulkUpsertTickers` batches in groups of 500 to stay within Supabase request size limits.

**Acceptance verified:**
- No `createClient` calls in `src/lib/services/` or `src/app/api/`
- `npm run build` clean, no TypeScript errors

**Commit:** `phase-2: repository layer (9 repos, typed, service-role only)`

---

## Phase 3 — Ingestion service

_Not yet started._

---

## Phase 4 — Ticker master seed

_Not yet started._

---

## Phase 5 — Pre-filter pipeline

_Not yet started._

---

## Phase 6 — LLM service

_Not yet started._

---

## Phase 7 — GitHub Actions cron

_Not yet started._

---

## Phase 8 — Price validation loop

_Not yet started._

---

## Phase 9 — Auth + Watchlist UI

_Not yet started._

---

## Phase 10 — Signal feed UI

_Not yet started._

---

## Phase 11 — PWA + Push notifications

_Not yet started._

---

## Phase 12 — Stats page

_Not yet started._

---

## Phase 13 — Ops / monitoring

_Not yet started._
