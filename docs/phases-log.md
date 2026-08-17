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

## Phase 11 — PWA + Push notifications ✅

**Goal:** Logged-in users can install Project Stein as a PWA and receive a Web Push when a watchlist ticker generates a signal of score ≥ 8.

**What was built:**

- `supabase/migrations/0002_push_history.sql` — new `push_history` table tracking every push sent. Two indexes: `(user_id, sent_at DESC)` for daily-cap counts, `(user_id, ticker_symbol, sent_at DESC)` for per-ticker dedup. RLS lets a user select only their own rows; writes only via service role from the cron.

- `src/lib/repositories/pushHistoryRepo.ts` — `recordPushSent`, `countSentToday(userId)`, `wasTickerPushedRecently(userId, ticker, withinMinutes)`.

- `src/lib/repositories/watchlistRepo.ts` — added `getUsersWatchingTicker(tickerSymbol)` so the push trigger can find which users (if any) watch a freshly-scored ticker.

- `src/lib/services/pushService.ts` — `notifyForSignal(signal, summary)`. Implements the trigger spec from `docs/pipeline.md`:
  - Bails if `sentiment_score < 8`.
  - Bails if VAPID env vars are missing (warn-and-skip, never throws).
  - Loads watchers via `getUsersWatchingTicker`.
  - Per-user gate: skip if pushed same ticker within 30 min, or already received 10 pushes today.
  - Loads each user's subscriptions and calls `webpush.sendNotification`. On 404/410 the subscription is treated as expired and deleted from the DB.
  - On any successful delivery, records a `push_history` row for that user/ticker/signal.
  - Payload: `{ title: "TSLA · BULLISH · 9/10", body: <summary, 200-char cap>, url: "/?highlight=<signal_id>", tag: <ticker> }`. The `tag` collapses repeated alerts for the same ticker into one OS notification.

- `src/lib/services/llmService.ts` — `analyzeArticle()` now captures the saved signal from `saveSignal` and calls `notifyForSignal` on it inside a try/catch (push is a side effect; failures are logged but never abort the pipeline).

- `src/app/api/push/subscribe/route.ts` (POST) — validates auth, parses `{ endpoint, keys: { p256dh, auth } }`, upserts via `pushRepo.saveSubscription`. Returns 401 if not logged in, 400 on malformed body.

- `src/app/api/push/unsubscribe/route.ts` (POST) — validates auth, deletes by endpoint via `pushRepo.deleteSubscription`.

- `src/components/PushToggle.tsx` — client component used on the watchlist page. State machine: `unsupported | denied | unavailable | idle | busy | subscribed`. Registers `/sw.js` on mount, requests `Notification.permission`, calls `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, POSTs the subscription JSON to `/api/push/subscribe`. The Disable button calls the inverse path. Shows tailored copy for the iOS Add-to-Home-Screen requirement.

- `public/manifest.json` — PWA manifest (standalone display, dark background, references `/icon.svg`).
- `public/icon.svg` — minimal app icon (dark rounded square with indigo `$` glyph). Used by manifest, apple-touch-icon, and the service-worker notification.
- `public/sw.js` — service worker. Skips waiting/claims clients on install/activate. `push` event reads `event.data.json()` (falls back to text), shows a notification with title/body/icon/tag. `notificationclick` focuses an existing window and navigates it to `payload.url`, or opens a new one.

- `src/app/layout.tsx` — added `manifest`, `appleWebApp`, and `icons` to the `metadata` export, and a separate `viewport` export with `themeColor: "#09090b"` (Next.js 16 requires `themeColor` to live in `viewport`, not `metadata`).

- `src/app/watchlist/page.tsx` — added a "Notifications" section under the watchlist with `<PushToggle />`.

**Manual steps the user must perform once before push works in production:**
1. Run `npx web-push generate-vapid-keys` locally to get a VAPID keypair.
2. Add three env vars to Vercel + `.env.local`:
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT=mailto:hishtein@gmail.com`
3. Apply the migration `0002_push_history.sql` in Supabase SQL editor.
4. After deploy, open the site, go to `/watchlist`, click **Enable push notifications**, accept the browser prompt.
5. **iOS only**: Add the site to the Home Screen first (Safari → Share → Add to Home Screen, iOS 16.4+), then open the installed PWA before clicking Enable.

**Key decisions:**
- **`push_history` table over in-memory rate limiting.** Vercel serverless functions are stateless across invocations; only DB-backed counters work.
- **Score threshold 8, daily cap 10, ticker dedup 30 min** — per `docs/pipeline.md` spec. Encoded as constants at the top of `pushService.ts` so they're easy to find/tune.
- **Push hooked into `llmService.analyzeArticle`, not the analyze route.** The signal is created inside the LLM service so the push needs to fire there. The route layer stays a thin transport.
- **Push errors are swallowed** (logged, not thrown). The analyze pipeline must keep processing other articles even if one user's subscription is broken.
- **Expired subscriptions auto-purge** (404/410 → `deleteSubscription`). Avoids accumulating dead endpoints from uninstalled PWAs.
- **VAPID keys loaded lazily** (`configureVapid()` runs on first send). If the keys aren't set, `notifyForSignal` warns and returns; the rest of the pipeline is unaffected. This means push silently does nothing in any environment that hasn't completed the manual VAPID setup — including local dev.
- **SVG icon** in manifest. Chrome accepts it for installable PWAs. iOS Add-to-Home-Screen prefers PNG, but the SVG works as a fallback while we don't have proper PNG assets generated.

**Acceptance verified:**
- `npm run build` clean. Routes table includes `/api/push/subscribe` and `/api/push/unsubscribe`. Existing routes still build.
- TypeScript: had to switch the VAPID-key helper return type to `Uint8Array<ArrayBuffer>` (constructed explicitly via `new ArrayBuffer(len)`) to satisfy Next.js's stricter `pushManager.subscribe` signature, which rejects `SharedArrayBuffer`-backed views.

**Not verified live:** End-to-end push delivery requires the manual steps above. The first real test will be when a watchlist ticker scores 8+ — this may take days depending on news flow.

**Commit:** `phase-11: PWA + Web Push (manifest, sw, pushService, push_history, subscribe/unsubscribe routes, PushToggle)`

_Not yet started._

---

## Phase 12 — Stats page ✅

**Goal:** A `/stats` page that lets logged-in users see whether the LLM's signals actually correlate with price movement.

**What was built:**

- `src/app/stats/page.tsx` — async server component, auth-gated.
  - Window selector via search param: `?days=7|30|60|90` (defaults to 30, anything else snaps to 30).
  - Calls `computeStats(days)` directly — no HTTP round-trip through `/api/stats` (which is `CRON_SECRET`-protected anyway).
  - Renders bucketed results in a table: rows = `(sentiment × score_bucket)`, columns = N, Mean 1d %, Mean 3d %, Hit 1d %.
  - Sentiment cell colored (emerald/red/zinc); return cells colored by sign; missing data renders as `—`.
  - Header row shows `{N} signals in the last {D} days · {M} have a 1-day return` so the user sees the data-density gap between fresh and ripened signals.
  - Empty state when there are zero signals in the window.
  - Standard nav (Feed | Watchlist | Stats | Sign out), reuses `signOutAction` and `<LegalFooter />`.
  - Short "How to read" caption at the bottom that names the BULLISH-8-10 hit rate as the MVP success criterion (matches `docs/overview.md`).

- `src/app/page.tsx`, `src/app/watchlist/page.tsx` — added a `Stats` link to both navs.

**Key decisions:**
- **Direct service call, not the API route.** The page is a server component running with the same trust as the cron route, so going through `/api/stats` would only add latency and require duplicating `CRON_SECRET`. The API route still exists for ops/external callers.
- **Window snapping.** Accepting arbitrary `?days=N` would let users request unbounded scans of `signal_outcomes`. Restricting to `[7, 30, 60, 90]` keeps the query cheap and matches the four buttons in the UI.
- **`tabular-nums` on numeric columns** so values line up across rows.
- **Hit rate is raw "% positive returns"** (matches `validationService.computeStats`). The caption explains how to interpret it for BEARISH rows ("a *low* hit rate means the LLM was right") rather than rewriting the metric to be direction-aware. Refining this is Phase 14 territory.

**Acceptance verified:**
- `npm run build` clean. Route table now includes `/stats` (dynamic, server-rendered) — 16 routes total.

**Not verified live:** the table has not been viewed against real data. With only 3 signals in the DB and most outcomes still un-validated, the table will likely render mostly `—` until both ingest is consistently producing signals and the validate cron has had a few cycles to populate prices.

**Commit:** `phase-12: stats page (validation dashboard with window selector + bucket table)`

_Not yet started._

---

## Phase 13 — Ops / monitoring ✅

**Goal:** Detect pipeline staleness without having to manually run SQL queries every time something looks off. Surface problems both as a JSON endpoint (for external uptime monitors) and as an inline banner on every authed page.

**What was built:**

- `src/lib/repositories/articleRepo.ts` — added `getLatestFetchedAt()` (returns `string | null`).
- `src/lib/repositories/signalRepo.ts` — added `getLatestSignalCreatedAt()`.
- (`countAnalysesToday` from `analysisRepo.ts` was already there from Phase 6.)

- `src/lib/services/opsService.ts` — `getPipelineHealth()` aggregates the three queries above (in parallel via `Promise.all`) and applies thresholds:
  - `STALE_INGEST_MINUTES = 90` — last article older than 90 min flags a stale-ingest issue.
  - `QUIET_SIGNAL_HOURS = 36` — no new signal in 36 h flags a quiet-pipeline issue. Picked larger than 24 h to absorb weekends and natural news droughts without false-positives.
  - `LLM_DAILY_BUDGET = 800` (mirrors the constant in `llmService`); warn at 80%, alarm at 100%.
  - Returns `{ status: 'ok' | 'degraded' | 'unknown', issues: string[], ...metrics }`.

- `src/app/api/health/route.ts` — public GET endpoint (no auth) returning the `PipelineHealth` JSON. HTTP status mirrors health: `200` when ok, `503` otherwise — so external monitors can alert on a non-200 without parsing the body. Errors return `503` with `{ status: 'unknown', error }`.

- `src/components/OpsBanner.tsx` — async server component. Calls `getPipelineHealth()`. Renders `null` when status is `ok` (so it costs nothing on healthy days). When degraded, renders an amber banner with a bulleted list of `health.issues`. Wraps the call in try/catch so a Supabase outage never breaks page render — it just hides the banner.

- Mounted `<OpsBanner />` on `src/app/page.tsx`, `src/app/watchlist/page.tsx`, and `src/app/stats/page.tsx`. All three render it above the existing main content.

**Key decisions:**
- **Public health endpoint, sensitive content stripped.** Counts and timestamps only — no signal contents, no user data. Safe to point UptimeRobot or BetterStack at without leaking anything.
- **HTTP 503 on degraded.** Lets external monitors alert without reading the body. Simpler than rolling a custom status field for everything.
- **Banner is server-rendered, no polling.** Each page load re-runs the health check. Cheap (3 small queries) and avoids the complexity of a client component with `setInterval`.
- **Banner self-suppresses on errors.** If the health check itself fails (Supabase down, etc.), the banner returns `null` rather than rendering a meta-error. The page renders normally; the user notices something's off when their normal data is missing. The `/api/health` endpoint is the right place to surface a hard failure, not the in-page banner.
- **Thresholds tuned conservatively.** 90 min for ingest staleness covers off-hours pacing (overnight cron is hourly, not every 10 min). 36 h for signal quietness covers weekends + slow news days without firing every Monday morning. Easy to tighten later when we have more data on real cadence.
- **Repositories own all DB access** (consistent with the Phase 2 rule). `opsService` calls three repos and aggregates — never touches Supabase directly.

**Acceptance verified:**
- `npm run build` clean. Routes table now includes `/api/health` (17 routes total).

**How to use after deploy:**
1. Hit `https://project-stein.vercel.app/api/health` — should return JSON with `status: "ok"` (HTTP 200) or `status: "degraded"` (HTTP 503). No auth header needed.
2. Optionally point an external uptime monitor at that URL on a 5-minute interval. UptimeRobot's free tier (50 monitors, 5-min checks) is enough.
3. Inside the app: any of `/`, `/watchlist`, `/stats` will show the amber banner if `health.issues` is non-empty.

**Commit:** `phase-13: ops monitoring (health endpoint, OpsBanner, opsService)`

**Phase 13 follow-up — false alarm fix.**

The first deploy reported `degraded` on Saturday because the staleness check used `articles.fetched_at`, which only updates when *new* articles are saved. On weekends and slow news days that metric naturally goes hours without movement even when the cron is firing fine — so it conflated cron health with news flow.

We also discovered a Phase 7 schedule gap: weekends 14:00-21:00 UTC matched neither the `*/10 14-21 * * 1-5` (Mon-Fri only) nor the `0 0-13,22-23 * * *` (off-hours) schedule, leaving an 8-hour weekend daytime window with no cron at all.

Two changes:
- `cron.yml` — added `'0 14-21 * * 0,6'` to fill the weekend daytime band with hourly runs. The existing `if:` condition on the `ingest-analyze` job already routes any non-excluded schedule through it, so no job changes were needed.
- `src/lib/repositories/sourceRepo.ts` — added `getLatestPolledAt()` (most recent `last_polled_at` across active sources). `rssService.fetchSource` was already calling `updateLastPolled` after every successful poll, so this is a true measure of "did the cron run".
- `src/lib/services/opsService.ts` — replaced the `latest_article_fetched_at` field with `latest_source_polled_at` and renamed the threshold (`STALE_INGEST_MINUTES → STALE_POLL_MINUTES`, still 90 min). The `/api/health` JSON shape changed to match.
- `src/lib/repositories/articleRepo.ts` — removed the now-unused `getLatestFetchedAt()` (per the no-dead-code rule).

The new metric measures cron health independent of news volume, which is what we actually want to alert on.

---

# Stein 2.0 — Portfolio-aware decision briefs

Stein 1.0 (Phases 0–13) shipped a per-article sentiment feed. It was judged not
valuable: per-article scores are not tradeable, the LLM economics were wrong
(800 tiny Flash-Lite calls on truncated snippets), auth friction was high, and
the system was blind to the owner's actual portfolio. The GitHub Actions cron
had also been auto-disabled after 60 days of repo inactivity, so the pipeline
had been dead for months.

Stein 2.0 inverts the pipeline: **few large LLM calls with rich context**
instead of many small calls with none. The product is a twice-daily,
portfolio-aware decision brief (plus on-demand runs) delivered by email and
push, where every recommendation is logged, priced against SPY, and scored on
an honest scoreboard.

---

## Phase 14 — Auth rework: password sign-in, one protection layer ✅

**Goal:** Kill magic links. Sign in with a password once and stay signed in;
protect every page in exactly one place.

**What was built:**

- `src/app/(auth)/login/page.tsx` — rewritten. `signInWithPassword` replaces
  `signInWithOtp`; the "check your email" state is gone. On success:
  `router.replace('/')` + `router.refresh()` so the proxy sees the new session
  cookie before the redirect lands. Auth errors are rendered inline (1.0
  declared a `searchParams.error` prop and never read it, so expired links
  showed a blank form).
- `src/proxy.ts` — inverted from an allowlist of protected paths to a
  `PUBLIC_PATHS` denylist: any path that is not `/login` redirects to `/login`
  when unauthenticated; authenticated users on `/login` bounce to `/`. Matcher
  now also excludes `manifest.json`, `sw.js`, and `icon.svg` — PWA assets must
  load without a session or the service worker fails to register.
- Deleted `src/app/auth/callback/route.ts` (and the `src/app/auth/` directory).
  The dual PKCE / token-hash handling existed only to absorb Supabase email
  template differences; with password auth there is no callback at all.
- `src/app/page.tsx`, `src/app/watchlist/page.tsx`, `src/app/stats/page.tsx` —
  removed the per-page `redirect('/login')` blocks. Pages still call
  `getUser()` where they need the user id and `return null` defensively, but
  the proxy is now the single source of auth truth.

**Key decisions:**

- **Session longevity is a dashboard setting, not code.** JWT expiry stays 1h;
  refresh tokens do not expire as long as "time-boxed sessions" and "inactivity
  timeout" are off in Supabase → Authentication → Sessions. The proxy's
  `getUser()` call refreshes the session cookie on every request, so any visit
  inside the refresh window keeps the session alive indefinitely.
- **No signup, no password reset UI.** Single-user app: the password is set once
  from the Supabase dashboard, and dashboard reset is the recovery path. Adding
  a reset flow would re-introduce the transactional-email dependency that made
  magic links painful.
- **`return null` instead of `redirect()` in pages.** The proxy already
  guarantees a user; the check is defence-in-depth for a misconfigured matcher,
  and returning null avoids a second redirect hop.

**Manual steps required by the owner:**
1. Supabase dashboard → Authentication → Users → set a password on the account.
2. Supabase dashboard → Authentication → Sessions → confirm "time-boxed
   sessions" and "inactivity timeout" are disabled.

**Acceptance verified:**
- `npm run build` clean. Route table no longer contains `/auth/callback`;
  `/login` still prerenders as static.
- TypeScript clean (`tsc --noEmit`).

**Not verified live:** actual sign-in requires the password to be set in the
Supabase dashboard first (manual step above).

---

## Phase 15 — Schema: positions, briefs, recommendations, settings ✅

**Goal:** Every 2.0 table exists. The 1.0 pipeline keeps running untouched.

**What was built:**

- `supabase/migrations/0004_stein2_schema.sql` — four tables, four enums, RLS.

| Table | Purpose |
|---|---|
| `positions` | The portfolio the briefs reason over |
| `briefs` | One row per generated (or attempted) brief |
| `recommendations` | The accountability ledger — one row per trade idea |
| `settings` | Key/value owner preferences (e.g. `default_brief_model`) |

- `.env.example` — added the 2.0 block: `IBKR_FLEX_TOKEN`, `IBKR_FLEX_QUERY_ID`,
  `RESEND_API_KEY`, `BRIEF_RECIPIENT_EMAIL`, `BRIEF_FROM_EMAIL`,
  `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO`.
- `docs/data-model.md` — documented the new tables and **fixed the long-standing
  count error**: the doc claimed "9 tables" while the DB had 10 (`push_history`
  from `0002` was never documented). Now 14, with the migration list and the
  frozen-table note spelled out.

**Key decisions:**

- **`recommendations` carries its own outcome columns; no `recommendation_outcomes`
  table.** 1.0's `signal_outcomes` existed because each signal fanned out into
  four horizons (1h/1d/3d/7d). A recommendation has exactly one lifecycle: the
  nightly job overwrites `current_*` while OPEN and stamps `closed_*` once. A
  join table would add nothing and make the scoreboard a two-table query.
- **Per-holding reviews live in `briefs.content`, not a table.** HOLD/TRIM/ADD/
  WATCH lines are commentary about existing positions, not new bets — they have
  no entry price, no invalidation, and nothing to score. Only new trade ideas
  enter the ledger, which keeps the scoreboard honest: it measures what the
  model actually proposed, not how often it said "hold".
- **Partial unique index on `briefs`** — `(brief_date, brief_type) WHERE
  brief_type IN ('PREMARKET','EVENING')`. This is the idempotency key that lets
  the brief cron fire twice per slot (on time + retry) without duplicating a
  row, while leaving `ON_DEMAND` runs unconstrained so the Run Now button can be
  pressed repeatedly.
- **`PENDING` status from day one.** The Claude-on-subscription path (Phase 22)
  is asynchronous: the app creates the row, a GitHub Actions worker fills it in.
  Adding the state now avoids a status migration later.
- **`invalidation_price` is NOT NULL.** An idea without a stop cannot be scored
  or auto-closed, so the schema refuses to store one. `briefService` drops ideas
  whose invalidation is on the wrong side of the entry zone rather than
  persisting an unfalsifiable call.
- **`positions.broker` + `source`.** `broker` makes a second brokerage a new sync
  adapter rather than a schema change. `source` separates synced rows (safe to
  replace wholesale on each sync) from hand-entered rows (never touched).
- **Enums over CHECK constraints** for the status/direction/type columns, matching
  the 1.0 `sentiment_enum` convention.

**Manual step required by the owner:**
Run `supabase/migrations/0004_stein2_schema.sql` in the Supabase SQL editor
(the established convention — there is no Supabase CLI link for this project).

**Acceptance:** after applying the migration, `select * from positions;`,
`select * from briefs;`, `select * from recommendations;`, and
`select * from settings;` all return empty sets, and the 1.0 pipeline is
unaffected (`/api/health` unchanged).

---

## Phase 16 — flexService: IBKR positions sync ✅

**Goal:** `positions` mirrors the real IBKR account, refreshed before each brief.

**What was built:**

- `src/lib/repositories/positionRepo.ts` — `Position`/`NewPosition` types,
  `getPositions`, `getPositionTickers`, `countBySource`, `upsertPositions`
  (upsert on `(broker, ticker_symbol)`), `deleteMissingSyncedPositions`,
  `upsertManualPosition`, `deletePosition`, `getLatestSyncedAt` (for Phase 24 ops).
- `src/lib/services/flexService.ts` — the Flex Web Service client:
  - `sendRequest()` → `SendRequest?t=&q=&v=3` returns a `ReferenceCode` + the
    GetStatement base URL.
  - `getStatement()` → polls with backoff. Error **1019** ("generation in
    progress") retries on a `[3s, 5s, 5s, 10s, 10s, 10s]` schedule (~43s total,
    inside the route's 60s `maxDuration`). Error **1018** (throttled) gets one
    30s back-off. Any other `ErrorCode` throws a typed `FlexError`.
  - `parseOpenPositions()` — regex over `<OpenPosition …/>` elements plus an
    attribute splitter. Aggregates multiple lots of the same symbol (quantity
    summed, cost basis weighted by quantity), preserves negative quantities for
    shorts, drops closed lots (`position="0"`), and skips non-`STK` asset
    categories with a count.
  - `syncPositions()` — upsert everything parsed, then delete `source='flex'`
    rows whose ticker is absent from the statement.
- `src/app/api/cron/sync-positions/route.ts` — `maxDuration = 60`, standard
  `CRON_SECRET` bearer check.
- `.github/workflows/cron.yml` — two new schedules, `30 10 * * 1-5` and
  `0 21 * * 1-5` (each ~30 min before a brief), routed to a `sync-positions` job.

**Key decisions:**

- **No XML parser dependency.** Flex position XML is flat and attribute-only, so
  a regex over `<OpenPosition …/>` plus an attribute splitter covers it. Adding
  a parser package would be a dependency with nothing to do.
- **Empty-statement guard.** If the statement parses to zero positions while
  synced rows already exist, the sync aborts with
  `{ ok: false, reason: 'empty_statement_guard' }` instead of deleting. A
  truncated or failed statement would otherwise wipe the portfolio the brief
  model reasons over — one stale sync is far cheaper than a brief that thinks
  the account is empty.
- **`source` separates synced from manual rows.** Sync replaces `flex` rows
  wholesale but never touches `manual` ones, so hand-entered holdings (assets
  IBKR does not report, or a second broker before its adapter exists) survive.
- **Only `STK` is synced.** Options and futures need different context
  (greeks, expiry, margin) than the brief prompt is built for; syncing them
  would put rows in front of the model it cannot reason about properly. They
  are counted and logged, not silently dropped.
- **Unknown tickers are kept, not filtered.** A holding absent from
  `tickers_master` (foreign listing, recent IPO) is still a real position; the
  model should see it. Validation against `tickers_master` belongs on *model
  output*, not on the owner's actual account.

**Manual steps required by the owner (~10 min, one time):**
1. IBKR Client Portal → Performance & Reports → Flex Queries → new **Activity
   Flex Query** with the *Open Positions* section, format **XML**, period
   **Last Business Day**. Note the query ID.
2. Settings → Account Settings → Flex Web Service → **generate token**.
3. Add `IBKR_FLEX_TOKEN` and `IBKR_FLEX_QUERY_ID` to Vercel env.

**Acceptance verified:**
- `npm run build` clean; `/api/cron/sync-positions` in the route table.
- `parseOpenPositions` exercised against a realistic multi-lot statement:
  two AAPL lots aggregate to 150 shares with a quantity-weighted cost basis of
  186.83 (from 100 @ 180.25 and 50 @ 200.00), a short NVDA keeps `-40`, an `OPT`
  row is skipped (`skipped: 1`), a `position="0"` lot is dropped, and
  `reportDate="20260814"` converts to `2026-08-14T00:00:00Z`. An empty
  statement parses to `[]` rather than throwing.

**Not verified live:** the round trip against IBKR needs the owner's token and
query ID (manual steps above).

---

## Phase 17 — marketDataService + contextPackService + dry-run preview ✅

**Goal:** Assemble, in code, everything the brief model is allowed to reason
from — and make it inspectable before a single LLM call is spent.

**What was built:**

- `src/lib/marketCalendar.ts` — framework-free NYSE calendar. `isTradingDay`,
  `addTradingDays`, `previousTradingDay`, `toDateKey`, plus
  `assertCalendarCoverage()` which warns when the hardcoded holiday list nears
  its end (currently through 2028). **Fixes the 1.0 defect** where
  `addTradingDays` counted any Mon–Fri, drifting every time a horizon spanned a
  holiday. `priceService` now imports from here instead of its own local copy.
- `src/lib/services/marketDataService.ts` — all numbers computed in code:
  - `rsi(closes, 14)` — Wilder smoothing, and `sma(values, period)`. Both pure
    and exported so they can be checked against a reference series.
  - `computeTechnicals()` — last close, 1d/5d/1mo change, RSI(14), SMA 20/50/200
    and % distance from each, 52-week high/low and proximity, last volume vs
    30-day average. Split from the fetch so it is testable without network.
  - `getTechnicalsBatch()`, `getMacroSnapshot()` (SPY, QQQ, ^VIX, ^TNX),
    `getEarningsDates()`, `getLastClose()`. Sequential with a 300 ms gap —
    Yahoo is unauthenticated and rate-sensitive.
- `src/lib/repositories/briefRepo.ts` — `Brief`/`BriefContent` types, `getBrief`
  (by date+type), `getBriefById`, `getLatestGeneratedBrief`, `listBriefs`,
  `createBrief`, `updateBrief`, `getStalePendingBriefs`,
  `purgeContextPacksOlderThan`.
- `src/lib/repositories/recommendationRepo.ts` — ledger types and
  `createRecommendations`, `getOpenRecommendations` (status-indexed),
  `applyPricing`, `closeRecommendation`, `updateInvalidation`,
  `getRecommendationHistory`, `getRecommendationsSince`, `getStalestOpenPricedAt`.
- `src/lib/repositories/articleRepo.ts` — added `getFilteredArticlesSince()`
  (passed-filter articles in the last N hours, joined to source name).
- `src/lib/services/contextPackService.ts` — `buildContextPack(briefType)` and
  `toCompactPack()`; `approxTokens()` for the size budget.
- `src/app/api/cron/brief/route.ts` — `maxDuration = 300`, `CRON_SECRET`
  protected, infers `PREMARKET`/`EVENING` from UTC hour. In Phase 17 every call
  is a dry run returning the pack; `?compact=1` returns the compact variant.

**Key decisions:**

- **The model does synthesis; the code does arithmetic.** An LLM cannot reliably
  compute an RSI from a list of closes, but it reasons well about "RSI 28, 12%
  below the 50-day, earnings in 3 days". Every number in the pack is
  deterministic, so the brief cannot invent a technical level.
- **Wilder's RSI specifically**, not a simple-average variant. A different
  smoothing yields visibly different numbers, and the brief would then disagree
  with whatever chart the owner is looking at.
- **Open recommendations are part of the pack**, with live P&L, distance to
  invalidation, and trading days left. The model must confront its own past
  calls before proposing new ones — this is what makes the ledger
  self-correcting rather than an ever-growing pile of forgotten ideas.
- **The 1.0 regex filter survives as the news *selector*.** It still decides
  which articles are material; what it no longer does is trigger an LLM call per
  article. News is then ranked — touches a holding (3) > touches a watchlist or
  open-rec name (2) > general market (1), newest first within a tier — and
  capped at 60 items with 240-char snippets.
- **Watchlist entries already held are dropped from the watchlist section**, since
  the positions section covers them with more detail. Avoids paying tokens twice
  for the same ticker.
- **Market-data failures degrade, never throw.** A ticker whose fetch fails gets
  `technicals: null` and the brief still generates. One dead symbol must not
  cost the owner a whole brief.
- **The compact pack exists for Groq only.** Its free-tier tokens-per-minute
  ceiling cannot fit the full pack, so the last-resort fallback trims news to 15
  items, shortens theses, and keeps only the three technicals fields that
  actually drive a decision.

**Acceptance verified:**
- `npm run build` clean; `/api/cron/brief` in the route table. `tsc --noEmit` clean.
- `rsi()` checked against Wilder's reference series: returns **70.46**, which
  matches hand-computation on that data (gains 3.34/14, losses 1.40/14 → RS
  2.3857 → 70.46). Continuing the series one bar gives 66.25, confirming the
  smoothing recurrence. Edge cases: all-gains → 100, flat → 50, too-short → null.
- `computeTechnicals` over a 260-bar synthetic ramp returns coherent values
  (SMA20 224.75, SMA200 179.75, +27.68% vs SMA200, at 52-week high, volume ratio
  1.01); empty input → `null`.
- `marketCalendar`: Wed 2026-11-25 + 1 trading day → **2026-11-27** (skips
  Thanksgiving), Thu 2026-12-24 + 1 → **2026-12-28** (skips Christmas and the
  weekend), `isTradingDay('2026-12-25')` → false, previous trading day from
  Sunday 2026-08-16 → 2026-08-14.

**Not verified live:** `query2.finance.yahoo.com` is not in this sandbox's
network egress allowlist, so live technicals could not be fetched here. The
attempt did confirm the degradation path — each failure logged a warning and
returned `null`/`[]` rather than throwing. Run the dry-run curl after deploy to
confirm real data:
`curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/brief?dry_run=1" | jq '.pack.approx_tokens, .pack.counts'`

---

## Phase 18 — briefService: generation, structured output, self-healing ✅

**Goal:** Turn the context pack into a validated, persisted brief with a
recommendation ledger — and make a failed brief heal itself.

**What was built:**

- `src/lib/services/modelRegistry.ts` — every model that can write a brief, with
  its `runner`. Two runners exist because the owner's frontier-model access comes
  from subscriptions, not API keys:
  - `vercel` — called directly over REST (Gemini 2.5 Pro / Flash, Groq Llama).
  - `actions` — Claude Opus 5 / Sonnet 5, run headlessly on the owner's Claude
    subscription inside GitHub Actions (built in Phase 22).
  Also `DEFAULT_MODEL_ID` and `VERCEL_FALLBACK_CHAIN`.
- `src/lib/prompts/briefPrompt.ts` — `SYSTEM_PROMPT`, `RESPONSE_SCHEMA`
  (provider-neutral JSON Schema), `buildBriefPrompt(pack)`, `REPAIR_PROMPT`. The
  prompt is per-slot: pre-market frames actions "at the open", the evening wrap
  frames them "at tomorrow's open".
- `src/lib/services/llmClient.ts` — `callModel`, `callModelForJson`, `stripFences`,
  `parseJson`. Gemini gets `responseSchema` for enforced structured output; Groq
  gets `response_format: json_object`.
- `src/lib/repositories/settingsRepo.ts` — `getSetting`/`setSetting`.
- `src/lib/services/briefService.ts` — `validateBrief`, `applyBriefToLedger`,
  `generateBrief`, `completeBriefFromRawOutput` (the entry point the Phase 22
  Claude worker posts back to).
- `src/app/api/cron/brief/route.ts` — real generation, with `?dry_run=1` kept.
  Accepts `?type=`, `?model=`, `?force=1`.

**Key decisions:**

- **Validation is deliberately unforgiving.** A brief is only worth something if
  its recommendations can be scored later, so anything unscoreable is dropped
  rather than stored:
  - An idea whose ticker isn't held and isn't in `tickers_master` — dropped.
  - **An invalidation on the wrong side of the entry** (a LONG stop *above* the
    entry zone) — dropped. Such a stop can never trigger, so the position would
    quietly ride to its horizon no matter how wrong the thesis got. This is the
    single most important gate in the system.
  - A holding review for a ticker not actually held, or a `rec_update` naming a
    recommendation that isn't open — dropped.
  - `horizon_trading_days` clamped to 1–20, `conviction` to 1–5.
  Every drop is logged with its reason, so a model that starts drifting is
  visible rather than silently degrading.
- **Idempotent, self-healing route.** An existing `GENERATED` brief for a
  scheduled slot returns `already: true` and does nothing. A missing or `FAILED`
  brief regenerates and bumps `attempt_count`. That is what lets the cron fire
  twice per slot — once on time, once as a retry — so a transient provider
  failure heals with no extra machinery, and a manual retry is one curl.
- **Provider failure falls through instead of throwing.** `callModel` returns
  `null` on any failure and the chain tries the next model. In 1.0 a single
  non-429 error threw and aborted the whole batch.
- **The Gemini API key moved from the URL to the `x-goog-api-key` header**, so it
  cannot leak into request logs or error strings (1.0 put it in the query string).
- **Repair retries send the full prompt.** 1.0's repair path sent only the first
  500 characters of the original prompt, so a repair silently re-analyzed a
  truncated input.
- **Entry basis is snapshotted at creation** (`entry_price` from the pack's last
  close, `benchmark_entry_price` from SPY), so returns are always measured from a
  fixed point regardless of when the scoring job first sees the row.
- **ON_DEMAND briefs bypass the idempotency check**, so the Run Now button can be
  pressed repeatedly.

**Acceptance verified:**
- `npm run build` + `tsc --noEmit` clean; `/api/cron/brief` in the route table.
- `validateBrief` exercised against a crafted model response containing five
  deliberate defects. Results: hallucinated ticker `ZZZZ` dropped; a LONG idea
  with invalidation 240 above its 228 entry dropped; a holding review for an
  unheld `GOOG` dropped; an unknown action `YOLO` dropped; a `rec_update` naming
  a nonexistent recommendation dropped. Clamping confirmed (horizon 99 → 20,
  conviction 9 → 5), an empty macro bullet stripped, and the valid SHORT idea
  (invalidation *above* entry) correctly kept.

**Not verified live:** an end-to-end generation needs `GEMINI_API_KEY` and
network egress to the provider, neither of which this sandbox has. After deploy:
`curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/brief?type=premarket"`

---

## Phase 19 — Email + push delivery ✅

**Goal:** The brief comes to the owner. The website becomes the archive, not the
thing he has to remember to open.

**What was built:**

- `src/lib/services/emailService.ts` — `sendEmail()` posting to
  `api.resend.com/emails` over plain `fetch`, plus `getRecipient()` and a typed
  `EmailNotConfiguredError` so a missing key is distinguishable from a send failure.
- `src/lib/briefHtml.ts` — `renderBriefHtml()` and `briefSubject()`. Table
  layout, inline CSS, dark palette. Sections: macro strip (SPY/QQQ/VIX/10Y with
  moves), market bullets, positions with action badges and live P&L, open-idea
  updates with return and decision, new ideas with entry zone / invalidation /
  horizon, and the two-week calendar. Everything is escaped via `esc()`.
- `src/lib/repositories/pushRepo.ts` — added `getAllSubscriptions()`.
- `src/lib/services/pushService.ts` — extracted the send-and-purge loop into
  `deliver()`, added `sendPushToAllSubscriptions(payload)`. `notifyForSignal`
  now rides on the same helper (it is deleted in Phase 23).
- `src/lib/services/briefService.ts` — `deliverBrief(briefId)`, called from both
  generation paths and from the already-generated branch.

**Key decisions:**

- **Delivery never fails a brief.** Email and push are each wrapped in their own
  try/catch. A brief that generated correctly but could not be emailed is still
  a good brief — `emailed_at` simply stays null.
- **The retry firing doubles as an email retry.** When the second cron firing
  finds an already-`GENERATED` brief, it still calls `deliverBrief()`, which
  re-attempts only the parts that have not succeeded. A transient Resend outage
  costs a delay, not the email.
- **The subject line carries the decision.** `Stein Pre-market · 2026-08-17 · 1
  new idea, 2 position actions` — or `· no action` on a quiet day. The owner can
  triage from the notification without opening anything.
- **Push tap URL is `/`.** 1.0 sent `/?highlight=<signal_id>`, which no page ever
  read, so every notification tap landed on an unchanged feed.
- **`onboarding@resend.dev` is the default sender.** Resend allows it to reach
  the account owner's own inbox with no domain verification, so setup is one API
  key. `BRIEF_FROM_EMAIL` overrides it once a domain is verified.
- **The disclaimer points at the scoreboard** rather than being generic legal
  boilerplate — the useful version of "not financial advice" here is "check
  whether these calls have actually worked".

**Manual steps required by the owner:**
1. Create a free Resend account, generate an API key.
2. Add `RESEND_API_KEY` and `BRIEF_RECIPIENT_EMAIL` to Vercel env.

**Acceptance verified:**
- `npm run build` + `tsc --noEmit` clean.
- `renderBriefHtml` rendered against a realistic brief (4 macro bullets, 3
  holdings with P&L, 2 open-idea updates, 1 new idea, 2 calendar items) →
  13.3 KB of valid HTML, well under any clipping threshold.
- **Escaping verified:** a macro bullet containing `<script>alert(1)</script> &
  "quotes"` renders as `&lt;script&gt;…` with no executable tag in the output.
- **Empty-state verified:** a brief with no ideas and no reviews renders the
  "No new trade ideas today." line and produces the subject
  `Stein Pre-market · 2026-08-17 · no action`.

**Not verified live:** actual delivery needs `RESEND_API_KEY` and a registered
push subscription. After deploy, trigger a brief and check the Resend dashboard.

---

## Phase 20 — Recommendation scoring + scoreboard ✅

**Goal:** Every recommendation gets priced, judged, and closed automatically —
so the owner can answer "does this thing actually work?" with a number.

**What was built:**

- `src/lib/services/scoringService.ts`:
  - `directionalReturn(entry, current, direction)` — sign-flipped for SHORT.
  - `isInvalidated(rec, close)` / `isPastHorizon(rec, now)`.
  - `scoreOpenRecommendations()` — prices every OPEN row against its entry and
    against SPY, auto-closes on invalidation or horizon.
  - `computeScoreboard(sinceDays)` — overall, by direction, by conviction, plus
    the recent history rows.
- `src/app/api/cron/score/route.ts` — `maxDuration = 60`, CRON_SECRET.
- `.github/workflows/cron.yml` — `0 2 * * 2-6` (02:00 UTC Tue–Sat, i.e. after
  each weekday US close) routed to a `score` job.

**Key decisions:**

- **Alpha vs SPY is the headline metric, not hit rate.** A hit rate alone is
  flattering and nearly meaningless in a rising market — a system can be right
  two times out of three and still leave the owner worse off than buying the
  index. Every closed recommendation stores the benchmark's return over the same
  holding period, and the scoreboard reports the difference.
- **Open recommendations never count toward hit rate.** Only rows with a
  terminal status are scored. Otherwise an unrealized winner would inflate the
  record indefinitely while losers quietly closed — the classic way a track
  record lies.
- **Close-based invalidation, not intraday.** Free EOD data has no reliable
  intraday series, and closing a trade on a wick that fully recovered would
  record exits the owner would never have taken. The tradeoff is documented: a
  spike straight through the stop and back is not counted as a stop-out.
- **A missing price skips the row rather than closing it.** If Yahoo returns
  nothing for a ticker, the recommendation is left untouched — a data outage
  must never auto-close a trade or freeze a stale return as its final result.
- **One fetch per distinct ticker**, not per recommendation, and
  `getOpenRecommendations()` is status-indexed. 1.0's validate job re-walked
  every signal in a 30-day window every night.

**Acceptance verified (unit-level, no network needed):**
- Directional returns: LONG 100→110 = +10, LONG 100→90 = −10, **SHORT 100→90 =
  +10** (profits on a fall), SHORT 100→110 = −10, null entry → null.
- Invalidation: LONG stop 90 → false at 95, **true at exactly 90**, true at 85;
  SHORT stop 110 → false at 105, true at 115.
- Horizon: false the day before, true on the horizon date and after.
- Scoreboard over 4 recommendations (3 closed, 1 open): hit rate **66.7%**
  (the open +20% correctly excluded), avg return **+1.0%**, avg alpha
  **−1.67%**. That divergence is the point — the system won two of three and
  still trailed SPY, which is exactly what the scoreboard exists to surface.

**Not verified live:** needs real open recommendations and Yahoo access. After
deploy, insert a synthetic OPEN row with a tight invalidation, run
`curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/score"`,
confirm it transitions to `CLOSED_INVALIDATED`, then delete the row.

---

## Phase 21 — UI rebuild ✅

**Goal:** The site becomes the brief, its archive, and the scoreboard. The
signal feed is gone.

**What was built:**

- `src/components/Nav.tsx` — Brief | Archive | Scoreboard | Portfolio | Sign out.
  Replaces the nav that was copy-pasted into three pages.
- `src/app/actions.ts` — app-level server actions: `signOutAction` (moved out of
  the watchlist), `runBriefNowAction`, `setDefaultModelAction`.
- `src/components/BriefView.tsx` — server component rendering a stored brief:
  macro strip, market bullets, positions with action badges and live P&L,
  open-idea updates, new ideas with entry/invalidation/horizon, calendar.
- `src/components/RunNowPanel.tsx` — **the one client component.** Model picker
  plus Run button. A `vercel` model generates inline; an `actions` model returns
  `pending` and the panel polls `/api/briefs/[id]/status` until it flips.
- `src/app/api/briefs/[id]/status/route.ts` — session-authenticated status poll.
- `src/app/page.tsx` — today's brief, falling back to the most recent with an
  amber "not today's" notice.
- `src/app/briefs/page.tsx` + `src/app/briefs/[id]/page.tsx` — archive and detail.
- `src/app/scoreboard/page.tsx` — four stat tiles (**alpha vs SPY first**),
  breakdown by direction and conviction, and the full recommendation history.
- `src/app/portfolio/page.tsx` — positions with totals and sync age, manual
  entry (`ManualPositionForm.tsx`), watchlist, and push toggle in one place.
- `src/lib/services/dispatchService.ts` — builds the pack, parks a PENDING brief,
  fires the GitHub Actions workflow. (Its worker lands in Phase 22.)

**Deleted:** `src/app/stats/page.tsx`, `src/app/watchlist/page.tsx`,
`src/components/SignalCard.tsx`, `src/components/FeedToggle.tsx`.
`WatchlistManager` moved under `/portfolio` and **lost its unused `userEmail`
prop**, dead since Phase 10.

**Key decisions:**

- **Alpha vs SPY is the first tile on the scoreboard**, ahead of hit rate. The
  page also explains in plain language why: a good hit rate with negative alpha
  means the ideas made money but the index would have made more.
- **`/watchlist` → `/portfolio` and `/stats` → `/scoreboard` redirect in the
  proxy.** Bookmarks and any 1.0 push notification still resolve. The auth check
  runs first, so an unauthenticated hit on a legacy path lands on `/login`.
- **One client component only.** Everything else stays a server component with
  URL state (the Phase 10/12 philosophy). `RunNowPanel` has to be a client
  component because subscription-backed models finish asynchronously.
- **The brief page links to the scoreboard** with "Has any of this worked?" —
  the accountability loop should be one click from the recommendations.
- **globals.css Geist fix.** The scaffold hardcoded `font-family: Arial` on
  `body`, silently overriding the Geist fonts `layout.tsx` has loaded since
  Phase 0. Now uses `var(--font-geist-sans)`; light-mode variables dropped since
  the app is deliberately dark-only.

**Acceptance verified:**
- `npm run build` + `tsc --noEmit` clean. Route table: `/`, `/briefs`,
  `/briefs/[id]`, `/scoreboard`, `/portfolio`, `/login`,
  `/api/briefs/[id]/status` — no `/stats` or `/watchlist` pages.
- **Ran the dev server and probed it live:** `/login` returns 200 and renders the
  email+password form (no magic-link copy); `/` unauthenticated returns 307 to
  `/login`; `/watchlist` and `/stats` return 307 rather than 404.
- Screenshotted `/login` — renders correctly in Geist, confirming the font fix.
