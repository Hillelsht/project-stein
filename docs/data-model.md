# Project Stein — Data Model

All tables live in the Supabase `public` schema. All use `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` and `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` unless noted.

Migrations (applied by hand in the Supabase SQL editor):

| File | Contents |
|---|---|
| `0001_initial_schema.sql` | The 9 original 1.0 tables |
| `0002_push_history.sql` | `push_history` |
| `0003_signal_outcomes_unique_signal_id.sql` | `UNIQUE (signal_id)` bugfix for the validate cron's upsert |
| `0004_stein2_schema.sql` | Stein 2.0: `positions`, `briefs`, `recommendations`, `settings` |

**14 tables total.** Ten from 1.0, four from 2.0. Of the 1.0 set,
`ai_analyses`, `market_signals`, and `signal_outcomes` are **frozen** after the
Phase 23 cutover — retained as read-only history, never written to again.

## Stein 1.0 tables

### `sources`
RSS feed sources. Seeded manually; not written to by the frontend.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| name | text | e.g. "SEC EDGAR 8-K" |
| rss_url | text | |
| priority_tier | int | 1 = primary (wires, EDGAR), 2 = secondary |
| active | bool | toggle off noisy sources without deleting |
| last_polled_at | timestamptz | updated after each successful ingest |

Seeded rows: SEC EDGAR 8-K (tier 1), PR Newswire All (tier 1), Yahoo Finance Top (tier 2).

### `articles`
Every fetched RSS item, whether it passed downstream filters or not. Audit trail.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| source_id | uuid | FK sources |
| title | text | |
| url | text | UNIQUE — deduplicates at DB level |
| published_at | timestamptz | nullable; some feeds lie — use fetched_at for recency |
| fetched_at | timestamptz | when we first saw it |
| raw_content | text | truncated to 10,000 chars |
| passed_filter | bool | null = not yet processed; true = went to LLM; false = rejected |
| filter_reject_reason | text | e.g. "no_valid_ticker", "no_material_keyword", "duplicate", "daily_budget" |

### `ai_analyses`
One row per article that reached the LLM stage. UNIQUE on article_id.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| article_id | uuid | FK articles, UNIQUE |
| summary | text | 2 sentences from LLM |
| economic_impact | text | 1-2 sentences or "None" |
| material | bool | LLM's own assessment |
| confidence | int | 0-10 |
| provider | text | "gemini-2.5-flash-lite" or "groq-llama" |
| raw_response | jsonb | full LLM response for debugging |
| cost_tokens_in | int | for daily budget monitoring |
| cost_tokens_out | int | |

### `market_signals`
One row per (analysis, ticker) pair. An article about AAPL and MSFT produces 2 signals.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| analysis_id | uuid | FK ai_analyses |
| ticker_symbol | text | validated against tickers_master before insert |
| sentiment | sentiment_enum | BULLISH / BEARISH / NEUTRAL |
| sentiment_score | int | 0-10, clamped |

Indexes: `(ticker_symbol, created_at DESC)`, `(sentiment_score DESC, created_at DESC)`

### `watchlist`
Per-user list of tickers to follow. RLS: users see and write only their own rows.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK auth.users |
| ticker_symbol | text | |

UNIQUE on `(user_id, ticker_symbol)`.

### `signal_outcomes`
The validation loop. Populated nightly by the validate cron job.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| signal_id | uuid | FK market_signals |
| ticker_symbol | text | denormalized for query speed |
| price_at_signal | numeric | close/last price at signal time |
| price_1h | numeric | nullable until 1h has elapsed |
| price_1d | numeric | nullable; uses market time (Friday → Monday) |
| price_3d | numeric | |
| price_7d | numeric | |
| return_1h | numeric | (price_1h - price_at_signal) / price_at_signal |
| return_1d | numeric | |
| return_3d | numeric | |
| return_7d | numeric | |
| last_updated_at | timestamptz | |

### `tickers_master`
Master list of valid US-listed symbols. Seeded from NASDAQ Trader CSVs weekly.
Used to reject hallucinated tickers from LLM output.

| Column | Type | Notes |
|---|---|---|
| ticker_symbol | text | PK |
| company_name | text | |
| exchange | text | 'NASDAQ' or 'NYSE' |
| active | bool | |
| last_refreshed_at | timestamptz | |

~8,000–10,000 rows. Refreshed Sundays 04:00 UTC.

### `dedup_hashes`
48-hour sliding window of SHA-256 hashes. Prevents the same story from being LLM-analyzed twice.

| Column | Type | Notes |
|---|---|---|
| hash | text | PK; SHA-256 of normalized_title + first 200 chars of body |
| article_id | uuid | FK articles |

Index on `created_at` for efficient purge. Purged nightly (03:00 UTC).

### `push_subscriptions`
Web Push API subscriptions. RLS: users see and write only their own rows.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK auth.users |
| endpoint | text | UNIQUE |
| p256dh | text | Web Push key |
| auth | text | Web Push key |

### `push_history`
Every push sent. Powers the daily cap and per-ticker dedup. Added in `0002`.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK auth.users |
| ticker_symbol | text | |
| signal_id | uuid | nullable |
| sent_at | timestamptz | |

Indexes: `(user_id, sent_at DESC)`, `(user_id, ticker_symbol, sent_at DESC)`.

## Stein 2.0 tables

### `positions`
The portfolio the briefs reason over. Broker-agnostic: `broker` is a plain text
discriminator so a second brokerage is a new sync adapter, not a schema change.

| Column | Type | Notes |
|---|---|---|
| broker | text | default `'ibkr'` |
| ticker_symbol | text | UNIQUE together with `broker` |
| quantity | numeric | |
| avg_cost, market_value, unrealized_pnl | numeric | from the Flex statement |
| currency | text | default `'USD'` |
| asset_class | text | only `STK` is synced today |
| source | text | `'flex'` (replaced wholesale by each sync) or `'manual'` (never touched by a sync) |
| as_of | timestamptz | statement date |

### `briefs`
One row per generated or attempted brief.

| Column | Type | Notes |
|---|---|---|
| brief_date | date | |
| brief_type | brief_type_enum | PREMARKET / EVENING / ON_DEMAND |
| status | brief_status_enum | PENDING (dispatched to the Actions worker) / GENERATED / FAILED |
| content | jsonb | the validated structured output |
| context_pack | jsonb | audit copy of the model's input; nulled after 30 days by the cleanup cron |
| requested_model, model | text | what was asked for vs. what actually answered |
| tokens_in, tokens_out | int | |
| error, attempt_count | text, int | |
| generated_at, emailed_at, pushed_at | timestamptz | delivery tracking |

Unique index `(brief_date, brief_type) WHERE brief_type IN ('PREMARKET','EVENING')` —
the idempotency key that lets the brief cron fire twice per slot (once on time,
once as a retry) without creating a duplicate. `ON_DEMAND` runs are unconstrained.

### `recommendations`
The accountability ledger — one row per trade idea, carrying its whole
lifecycle. No per-horizon fan-out (unlike 1.0's `signal_outcomes`): the nightly
scoring job overwrites `current_*` and stamps `closed_*` exactly once.

| Column | Type | Notes |
|---|---|---|
| brief_id | uuid | FK briefs — the brief that proposed it |
| ticker_symbol | text | validated against `tickers_master` or `positions` before insert |
| direction | rec_direction_enum | LONG / SHORT |
| thesis | text | |
| entry_zone_low / entry_zone_high | numeric | |
| invalidation_price | numeric | NOT NULL — an idea without a stop is not tracked |
| horizon_trading_days | int | 1–20 |
| horizon_date | date | computed via `marketCalendar.addTradingDays` |
| conviction | int | 1–5 |
| status | rec_status_enum | indexed; scoring walks only OPEN |
| entry_price, benchmark_entry_price | numeric | snapshotted at creation (SPY is the benchmark) |
| current_price, current_return_pct, benchmark_return_pct, last_priced_at | | refreshed nightly while OPEN |
| closed_at, close_price, closed_by_brief_id, close_note | | frozen once on close |

Per-holding reviews (HOLD/TRIM/ADD/CLOSE/WATCH) are commentary, not tracked
bets, so they live inside `briefs.content` rather than in this table.

### `settings`
Tiny key/value store for owner preferences (e.g. `default_brief_model`), so a
new preference is a row rather than a migration.

| Column | Type | Notes |
|---|---|---|
| key | text | PK |
| value | jsonb | |
| updated_at | timestamptz | |

## Enums

```sql
CREATE TYPE sentiment_enum    AS ENUM ('BULLISH', 'BEARISH', 'NEUTRAL');   -- 1.0, frozen
CREATE TYPE brief_type_enum   AS ENUM ('PREMARKET', 'EVENING', 'ON_DEMAND');
CREATE TYPE brief_status_enum AS ENUM ('PENDING', 'GENERATED', 'FAILED');
CREATE TYPE rec_direction_enum AS ENUM ('LONG', 'SHORT');
CREATE TYPE rec_status_enum   AS ENUM (
  'OPEN', 'CLOSED_TARGET', 'CLOSED_INVALIDATED', 'CLOSED_HORIZON', 'CLOSED_BY_MODEL'
);
```

`CLOSED_TARGET` is reserved — briefs express targets inside the thesis and entry
zone rather than as a machine-checkable price, so nothing sets it yet.

## Row Level Security

| Table | Policy |
|---|---|
| sources, articles, ai_analyses, market_signals, signal_outcomes, tickers_master, dedup_hashes, positions, briefs, recommendations, settings | SELECT for `authenticated` role; no client writes |
| watchlist, push_subscriptions, push_history | owner-only (`auth.uid() = user_id`) |

All backend writes go through the `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS. Client never holds the service role key.
