# Project Stein — Data Model

All tables live in the Supabase `public` schema. All use `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` and `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` unless noted.

Migration file: `supabase/migrations/0001_initial_schema.sql`

## Tables

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

## Enum

```sql
CREATE TYPE sentiment_enum AS ENUM ('BULLISH', 'BEARISH', 'NEUTRAL');
```

## Row Level Security

| Table | Policy |
|---|---|
| sources, articles, ai_analyses, market_signals, signal_outcomes, tickers_master, dedup_hashes | SELECT for `authenticated` role; no client writes |
| watchlist | ALL ops for `authenticated` where `auth.uid() = user_id` |
| push_subscriptions | ALL ops for `authenticated` where `auth.uid() = user_id` |

All backend writes go through the `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS. Client never holds the service role key.
