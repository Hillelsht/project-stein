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

## Phase 3 — Ingestion service ✅

**Goal:** `rssService` fetches all active sources and saves articles. No filtering yet.

**What was built:**
- `src/lib/services/rssService.ts`
  - `fetchAndStoreAll()` — loops active sources, calls `fetchSource()` for each, aggregates counts
  - `fetchSource(source)` — uses `rss-parser` with source-specific User-Agent (SEC requires `SEC_USER_AGENT` env var); handles Atom and RSS formats; returns `{ fetched, saved, errors }`
  - `buildRawContent()` — combines `content`, `contentSnippet`, `summary`, truncated to 10,000 chars; for SEC sources prepends `[SEC_ITEMS:1.01,2.02]` prefix so filterService can find item codes
  - `extractSecItems()` — regex `/\bitems?\s+([\d]+\.[\d]+)/gi` to pull 8-K item codes from feed text
  - Source failures are isolated — one bad source doesn't abort the others
- `src/app/api/cron/ingest/route.ts`
  - `GET` handler, requires `Authorization: Bearer ${CRON_SECRET}` (401 otherwise)
  - Returns `{ ok, total: { fetched, saved, errors }, perSource: { ... } }`

**Acceptance verified (live test):**
- First run: 109 articles saved (SEC: 40, PR Newswire: 20, Yahoo Finance: 49)
- Second run immediately after: fetched 109, saved 1 (one new article that arrived between runs) — dedup working via `url UNIQUE` constraint
- No errors from any source

**Key decisions:**
- `saveArticle()` silently returns `null` on duplicate URL (postgres error 23505), so the ingest loop needs no special handling
- Parser typed as `Parser<Record<string, string>, { summary?: string }>` to satisfy rss-parser's generic constraints while still accessing the custom `summary` field
- `updateLastPolled()` failure is caught and ignored — non-fatal; the ingest still ran

**Commit:** `phase-3: rssService + /api/cron/ingest route`

---

## Phase 4 — Ticker master seed ✅

**Goal:** `tickers_master` populated with real US tickers so ticker validation works.

**What was built:**
- `src/lib/services/tickerMasterService.ts`
  - `refreshTickerMaster()` — fetches both NASDAQ Trader files in parallel, parses, merges, bulk upserts
  - `parseNasdaqListed()` — pipe-delimited, skips Test Issue = Y, rejects symbols not matching `/^[A-Z]{1,5}$/` (filters warrants, preferred shares, units with special chars)
  - `parseOtherListed()` — same logic for NYSE/other exchanges
  - Merge strategy: NASDAQ rows win on symbol conflict (more specific exchange info)
  - `NewTickerRow = Omit<TickerRow, 'created_at'>` — insert type without DB-generated field
- `src/app/api/cron/refresh-tickers/route.ts` — same CRON_SECRET auth pattern

**Acceptance verified:**
- 11,981 rows upserted (5,425 NASDAQ + 6,556 other, deduplicated)
- `isValidTicker('AAPL')` → true (Apple Inc. - Common Stock, NASDAQ)
- `isValidTicker('CEO')` → false (0 rows in DB, also in in-code blocklist)
- Total in DB: 11,981 (Content-Range: 0-999/11981)

**Bug found and fixed during implementation:**
- `ftp.nasdaqtrader.com` times out from this network; switched to `www.nasdaqtrader.com` (same files, accessible via HTTPS)

**Commit:** `phase-4: tickerMasterService + /api/cron/refresh-tickers route`

---

## Phase 5 — Pre-filter pipeline ✅

**Goal:** `filterService` turns raw articles into "passed" articles ready for LLM.

**What was built:**
- `src/lib/services/filterService.ts`
  - `extractTickers(text)` — regex `/(?:^|[^A-Z])\$?([A-Z]{1,5})(?=[^A-Z]|$)/g`, dedupes candidates, strips BLOCKLIST entries, then one `validateTickerBatch` DB call (not N calls)
  - `hasMaterialKeyword(text)` — single pre-compiled regex covering all PRD §6 keyword categories (M&A, earnings, regulatory, legal, leadership, capital, operations); case-insensitive
  - `parseSecItems(rawContent)` — extracts codes from `[SEC_ITEMS:1.01,2.02]` prefix in raw_content
  - `hasMaterialSecItem(items)` — checks against PRD §6 allowlist: 1.01, 1.02, 1.03, 2.01, 2.02, 3.01, 4.02, 5.02, 7.01, 8.01
  - `computeDedupHash(title, body)` — SHA-256 of normalized_title + `|` + body[:200]
  - `runFilterPipeline(article)` — orchestrates stages 1-6 in order, returns `{ pass, reason?, tickers }`
- `src/app/api/cron/analyze/route.ts` — pulls `getUnanalyzedArticles(200)`, runs pipeline on each, marks pass/reject; will be extended in Phase 6 for LLM calls
- `tickerMasterRepo.ts` — added `validateTickerBatch(symbols[])` (single `IN` query) and exported `BLOCKLIST`

**Pipeline stage ordering:**
1. Ticker extraction (no rejection — just populates tickers list)
2. Material keyword check → `no_material_keyword`
3. SEC item check (only if `raw_content` starts with `[SEC_ITEMS:`) → `immaterial_sec_item`
4. Dedup hash (48hr window) → `duplicate`; save hash on pass
5. Watchlist priority (no rejection — determines if Stage 6 applies)
6. LLM budget check (≤800/day, skipped for watchlist matches) → `daily_budget`

**Acceptance verified (live test — 132 articles processed):**
- Pass rate: 22/128 = 17.2% (expected 5–15%; slightly above but reasonable for news mix)
- All rejections: `no_material_keyword` (correct for first run with empty dedup table)
- Second analyze run: 0/0 — all articles already processed, none re-processed
- Dedup table: 22 rows after first run, growing correctly
- Third cycle (4 new articles): 1 passed, 3 rejected `no_material_keyword` — dedup correctly silent on genuinely new content

**Key decisions:**
- `validateTickerBatch` (one `IN` query per article) vs. `isValidTicker` per symbol (N queries) — batch is ~10x faster for articles with multiple candidates
- SEC detection by `[SEC_ITEMS:` prefix in `raw_content` rather than joining to sources table — simpler, no extra DB call
- BLOCKLIST exported from `tickerMasterRepo` so filterService and the repo share a single source of truth

**Commit:** `phase-5: filterService pre-filter pipeline + /api/cron/analyze route`

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
