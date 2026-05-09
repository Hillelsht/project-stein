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

## Phase 6 — LLM service ✅

**Goal:** Passed articles get sent to Gemini, parsed, validated, saved to `ai_analyses` + `market_signals`.

**What was built:**
- `src/lib/prompts/sentimentPrompt.ts`
  - `SYSTEM_PROMPT` — verbatim from PRD §7
  - `REPAIR_PROMPT` — used when first JSON parse fails
  - `buildPrompt(title, rawContent)` — strips `[SEC_ITEMS:...]` prefix before sending to LLM, truncates body to 4,000 chars
- `src/lib/services/llmService.ts`
  - `callGemini(prompt)` — POST to Gemini REST API (`gemini-2.5-flash-lite`), `responseMimeType: application/json`, returns null on 429/5xx (signals fallback)
  - `callGroq(prompt)` — OpenAI-compatible Groq endpoint (`llama-3.3-70b-versatile`), `response_format: {type: "json_object"}`, returns null on 429/5xx
  - `fetchParsedResponse(prompt)` — tries Gemini, falls back to Groq, one JSON repair attempt on parse failure
  - `analyzeArticle(article)` — full flow: budget check → prompt → LLM → validate → save
    - `validateTickerBatch` drops hallucinated tickers, logs them
    - `clamp()` enforces 0–10 on sentiment_score and confidence
    - `normaliseSentiment()` uppercases and defaults to NEUTRAL if invalid
    - Primary ticker gets the scored sentiment; additional tickers get NEUTRAL/0 (Phase 14 refines this)
    - Token counts stored in `cost_tokens_in/out` for daily budget monitoring
- `src/app/api/cron/analyze/route.ts` — extended: filter pass → `markFilterPass` → `analyzeArticle`; response now includes `analyzed` count

**Acceptance verified (live test on 106 fresh articles):**
- 11 passed filter, 11 analyzed (100% LLM success rate on this run)
- 3 market_signals created (8 articles had no valid tickers after LLM validation)
- Token costs recorded: ~450–570 tokens in, ~97–133 tokens out per call
- Provider mix: Gemini primary for most, Groq fallback triggered for at least 1
- Summaries are 2 sentences, scores are calibrated (BMY: score 2 low-vol dividend; ERIC: score 0 correction notice)
- `material=false` correctly assigned to non-price-moving articles (no signals created)

**Bug caught:** provider string was `gemini-gemini-2.5-flash-lite` (doubled prefix). Fixed to just `gemini-2.5-flash-lite`.

**Commit:** `phase-6: llmService (Gemini + Groq fallback) + extend analyze route`

---

## Phase 7 — GitHub Actions cron ✅

**Goal:** Scheduled runs without human intervention.

**What was built:**
- `.github/workflows/cron.yml` — 4 jobs, 5 schedules:

| Schedule | Cron | Job |
|---|---|---|
| Market hours Mon-Fri 14:00-21:59 UTC | `*/10 14-21 * * 1-5` | ingest-analyze |
| Extended/overnight hourly | `0 0-13,22-23 * * *` | ingest-analyze |
| Daily 02:00 UTC | `0 2 * * *` | validate (Phase 8) |
| Daily 03:00 UTC | `0 3 * * *` | dedup-cleanup |
| Sunday 04:00 UTC | `0 4 * * 0` | refresh-tickers |

- `workflow_dispatch` trigger for manual testing
- `if` conditions route each schedule to exactly one job; `workflow_dispatch` runs `ingest-analyze`
- `src/app/api/cron/dedup-cleanup/route.ts` — calls `purgeOlderThan(48)`, returns `{ ok, deleted }`

**Manual steps required by user:**
1. Go to GitHub repo → Settings → Secrets and variables → Actions
2. Add secret `CRON_SECRET` — same value as in `.env.local`
3. Add secret `APP_URL` — your Vercel deployment URL (e.g. `https://project-stein.vercel.app`), no trailing slash
4. Push this commit to trigger the workflow file to appear in Actions tab
5. Run workflow manually via Actions → "Project Stein Cron" → "Run workflow" to verify ingest-analyze works

**Key decisions:**
- `validate` job references `/api/cron/validate` which doesn't exist until Phase 8 — job will fail at 02:00 UTC until then; that's intentional (signals unfinished work)
- Extended hours use hourly cadence (`0 0-13,22-23`) not every 10 min — news volume is low overnight and GitHub Actions minutes are finite (free tier: 2,000/month; this schedule uses ~1,500)
- dedup-cleanup purges at 48h (matching the `hashExists` window); keeps the table small without losing any dedup protection

**Commit:** `phase-7: GitHub Actions cron + dedup-cleanup route`

---

## Phase 8 — Price validation loop ✅

**Goal:** Fill `signal_outcomes` from real price data; expose a stats endpoint.

**What was built:**
- `src/lib/services/priceService.ts`
  - `getClosingPriceAt(ticker, targetDate)` — uses `yf.historical()`, looks up to 10 days forward to skip weekends/holidays; returns the first close on or after targetDate
  - `getPriceAtHorizon(signal, horizon)` — ripeness check first, then for `1h` uses `yf.chart()` with hourly interval (returns null if market was closed), for `1d/3d/7d` calls `getClosingPriceAt` with `addTradingDays` offset
  - `addTradingDays(date, n)` — Mon–Fri only, no holiday calendar
  - `isHorizonRipe(signalTime, horizon)` — 1h: 90 min buffer; 1d/3d/7d: target trading day at 22:00 UTC
  - **Bug fixed during implementation:** `yahoo-finance2` v2+ exports a class, not a singleton. Static methods (old API) are marked `@deprecated` and typed as returning `never`. Fix: `const yf = new YahooFinance(); yf.historical(...)` instead of `yahooFinance.historical(...)`
- `src/lib/services/validationService.ts`
  - `fillOutcomesForRecentSignals()` — fetches last 10 days of signals, checks existing outcomes, fills null fields that have ripened, computes `return_*` as `(horizonPrice - base) / base * 100`, upserts via `outcomeRepo`
  - `computeStats(days)` — joins outcomes with signals via `getStatsWithSignals`, groups by (sentiment × score_bucket), returns `StatsBucket[]` with mean_return_1d, mean_return_3d, hit_rate_1d
- `src/lib/repositories/outcomeRepo.ts` — added `OutcomeWithSignal` type and `getStatsWithSignals(days)` (Supabase embedded relation: `signal_outcomes` ← `market_signals(sentiment, sentiment_score)`)
- `src/app/api/cron/validate/route.ts` — calls `fillOutcomesForRecentSignals()`; now activates the Phase 7 cron job that was previously 404-ing
- `src/app/api/stats/route.ts` — calls `computeStats(days)` where `days` comes from `?days=N` query param (default 30); protected by `CRON_SECRET`

**Key decisions:**
- `price_at_signal` = closing price on or after signal.created_at date (not real-time bid/ask — we don't have a paid data feed)
- `price_1h` uses `chart` with hourly bars; returns null if signal was generated after market close (no bar available) — null is the honest answer, not a fabricated price
- Score buckets: 0–4, 5–7, 8–10 (matches Phase 12 stats display)
- `getStatsWithSignals` uses Supabase PostgREST embedded relation (FK: `signal_outcomes.signal_id → market_signals.id`) — one query instead of N+1
- `/api/stats` accepts `?days=N` so Phase 12 UI can request different windows

**Acceptance:**
- `npm run build` clean, all 7 routes listed: `/api/cron/analyze`, `/api/cron/dedup-cleanup`, `/api/cron/ingest`, `/api/cron/refresh-tickers`, `/api/cron/validate`, `/api/stats`, `/`
- After signals are 1+ day old, running `/api/cron/validate` will fill `signal_outcomes` rows; `/api/stats` will return bucketed returns

**Commit:** `phase-8: price validation loop (priceService, validationService, validate + stats routes)`

---

## Phase 9 — Auth + Watchlist UI ✅

**Goal:** Family members can log in and manage their watchlist.

**What was built:**
- `src/proxy.ts` — Next.js 16 route proxy (replaces `middleware.ts` — breaking rename in v16): protects `/watchlist` (redirects to `/login`), redirects authenticated users away from `/login`
- `src/app/(auth)/login/page.tsx` — client component: email form → `signInWithOtp({ shouldCreateUser: false })` → "check your email" state. `shouldCreateUser: false` means only pre-created users can authenticate (no open signup)
- `src/app/auth/callback/route.ts` — handles both PKCE (`?code=`) and token-hash (`?token_hash=&type=`) flows; exchanges for session cookie; redirects to `/watchlist`
- `src/app/watchlist/page.tsx` — server component: gets user from cookie, fetches their watchlist, renders `WatchlistManager`
- `src/app/watchlist/WatchlistManager.tsx` — client component: autocomplete add (250ms debounce, calls `searchTickersAction`), remove buttons, error display; pressing Enter adds top suggestion
- `src/app/watchlist/actions.ts` — server actions: `addTickerAction` (validates format → BLOCKLIST → DB lookup → insert, handles 23505 gracefully), `removeTickerAction`, `searchTickersAction`, `signOutAction` (calls `auth.signOut()` + redirects to `/login`)
- `src/lib/repositories/tickerMasterRepo.ts` — added `searchTickers(prefix, limit)`: `ilike` prefix match on `ticker_symbol`, ordered, max 10 results
- `src/app/layout.tsx` — updated title to "Project Stein"

**Bugs fixed during implementation:**
- Next.js 16.2.4 deprecates `middleware.ts` in favour of `proxy.ts` with `export function proxy()` — build fails with a clear error message; renamed and updated the export
- `verifyOtp` with `token_hash` requires `EmailOtpType` (not `MobileOtpType | EmailOtpType`); fixed with explicit email-type cast

**Manual steps required by user:**
1. Go to Supabase dashboard → Authentication → Users → **Add user** for each family member (email + password — password is irrelevant, they'll use magic link)
2. Verify that "Confirm email" is disabled under Authentication → Settings, OR that users are pre-confirmed

**Acceptance:**
- `npm run build` clean: `/login`, `/watchlist`, `/auth/callback` all listed
- After adding family member emails in Supabase, they can: receive magic link → click → land on `/watchlist` → add/remove tickers

**Commit:** `phase-9: auth + watchlist UI (proxy, login, callback, watchlist page)`

---

## Phase 10 — Signal feed UI ✅

**Goal:** Authenticated home page (`/`) shows recent market signals, watchlist-filtered by default with an "All signals" toggle.

**What was built:**

- `src/lib/repositories/signalRepo.ts`
  - Added `SignalWithContext` type — `MarketSignal` extended with embedded `ai_analyses(summary, economic_impact, articles(title, url, published_at, sources(name)))`.
  - Added `getRecentSignalsWithContext(filters)` — uses Supabase nested embedded relations (`!inner` joins) to fetch a signal plus its analysis, article, and source in one query. Orders by `created_at DESC`, default limit 50. Reuses `SignalFilters` (`tickers`, `minScore`, `limit`).

- `src/components/SignalCard.tsx`
  - Server component. Renders ticker badge, sentiment badge (color-coded: emerald/red/zinc for BULLISH/BEARISH/NEUTRAL with score `/10`), article title (links to source URL in new tab), LLM summary, economic impact (italicized, hidden if "None"), source name + relative time.
  - `relativeTime()` helper renders "just now", "Nm ago", "Nh ago", "Nd ago", or `toLocaleDateString()` for >7 days.

- `src/components/FeedToggle.tsx`
  - Server component. Two `<Link>` tabs: "Watchlist" → `/`, "All signals" → `/?view=all`. Active tab styled with `bg-zinc-800`.

- `src/components/LegalFooter.tsx`
  - Static disclaimer: "Project Stein is an automated news aggregator and is not licensed financial advice…"

- `src/app/page.tsx` (replaced placeholder landing page)
  - Async server component. Reads `searchParams` (Promise in Next.js 16) for `view`.
  - Auth-gated: `createServerClient().auth.getUser()` → `redirect('/login')` if no user (page-level redirect; proxy was not modified).
  - Fetches user's watchlist; default view filters signals to those tickers, `?view=all` shows all signals.
  - Empty state when watchlist view + empty watchlist: prompts to add tickers or switch to "All signals".
  - Header has nav: Feed | Watchlist | Sign out (reuses `signOutAction` from watchlist actions).
  - Renders `<FeedToggle>`, signal cards, then `<LegalFooter>`.

- `src/app/watchlist/page.tsx`
  - Added matching nav (Feed | Watchlist | Sign out) for symmetry. Removed the user-email span from the header (was unused information for a 5-user app).

**Key decisions:**
- Auth protection is at the page level (`redirect('/login')` in server component) rather than in the proxy. The proxy still only protects `/watchlist` explicitly. This avoids the risk of accidentally locking out `/login` or `/auth/callback` when extending the proxy matcher.
- View state is encoded in the URL (`?view=all`) rather than client state — keeps the page a server component, makes the toggle shareable/bookmarkable, and means no client JS for the feed itself.
- Used Supabase `!inner` joins so signals without an article/analysis are filtered out at the DB level (defensive — should not happen given FK constraints).
- Default limit is 50 signals. No pagination yet — at the current ingest volume this is well under one screen of scroll for a heavy day.
- Post-login destination remains `/watchlist` (set by the proxy in Phase 9). For new users with empty watchlists this is more useful than landing on an empty feed.

**Acceptance verified:**
- `npm run build` clean — 11 routes including `/` (dynamic, server-rendered).
- TypeScript clean across the new repo function and components.

**Commit:** `phase-10: signal feed UI (page, SignalCard, FeedToggle, LegalFooter, joined repo query)`

---

## Phase 11 — PWA + Push notifications

_Not yet started._

---

## Phase 12 — Stats page

_Not yet started._

---

## Phase 13 — Ops / monitoring

_Not yet started._
