-- ============================================================
-- Project Stein 2.0 — Portfolio-aware decision briefs
--
-- Adds: positions, briefs, recommendations, settings.
-- Leaves 1.0 tables untouched. market_signals / ai_analyses /
-- signal_outcomes become frozen history after the Phase 23 cutover.
-- ============================================================

-- ============================================================
-- Enums
-- ============================================================

-- ON_DEMAND briefs are produced by the "Run Now" button and may repeat
-- any number of times per day; the scheduled kinds are unique per day.
CREATE TYPE brief_type_enum AS ENUM ('PREMARKET', 'EVENING', 'ON_DEMAND');

CREATE TYPE brief_status_enum AS ENUM ('PENDING', 'GENERATED', 'FAILED');

CREATE TYPE rec_direction_enum AS ENUM ('LONG', 'SHORT');

-- CLOSED_TARGET is reserved: briefs currently express targets inside the
-- thesis/entry zone rather than as a machine-checkable price, so nothing
-- sets it yet. Declared now so adding an explicit target field later is
-- a column addition rather than an enum migration.
CREATE TYPE rec_status_enum AS ENUM (
  'OPEN',
  'CLOSED_TARGET',
  'CLOSED_INVALIDATED',
  'CLOSED_HORIZON',
  'CLOSED_BY_MODEL'
);

-- ============================================================
-- positions — the portfolio the briefs reason over
--
-- Broker-agnostic by design: `broker` is a plain text discriminator so a
-- second brokerage is a new sync adapter, not a schema change. `source`
-- separates synced rows (safe to replace wholesale) from hand-entered
-- rows (never touched by a sync).
-- ============================================================

CREATE TABLE positions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  broker         TEXT        NOT NULL DEFAULT 'ibkr',
  ticker_symbol  TEXT        NOT NULL,
  quantity       NUMERIC     NOT NULL,
  avg_cost       NUMERIC,
  currency       TEXT        NOT NULL DEFAULT 'USD',
  market_value   NUMERIC,
  unrealized_pnl NUMERIC,
  asset_class    TEXT,
  source         TEXT        NOT NULL DEFAULT 'flex' CHECK (source IN ('flex', 'manual')),
  as_of          TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (broker, ticker_symbol)
);

-- ============================================================
-- briefs — one row per generated (or attempted) brief
-- ============================================================

CREATE TABLE briefs (
  id              UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_date      DATE              NOT NULL,
  brief_type      brief_type_enum   NOT NULL,
  status          brief_status_enum NOT NULL DEFAULT 'PENDING',
  content         JSONB,
  context_pack    JSONB,
  requested_model TEXT,
  model           TEXT,
  tokens_in       INT,
  tokens_out      INT,
  error           TEXT,
  attempt_count   INT               NOT NULL DEFAULT 1,
  generated_at    TIMESTAMPTZ,
  emailed_at      TIMESTAMPTZ,
  pushed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ       NOT NULL DEFAULT now()
);

-- Idempotency key for the scheduled slots: the brief cron fires twice per
-- slot (once on time, once as a retry) and must not create a second row.
-- Partial so ON_DEMAND runs stay unconstrained.
CREATE UNIQUE INDEX briefs_scheduled_slot
  ON briefs (brief_date, brief_type)
  WHERE brief_type IN ('PREMARKET', 'EVENING');

CREATE INDEX briefs_created ON briefs (created_at DESC);

-- ============================================================
-- recommendations — the accountability ledger
--
-- One row per trade idea, carrying its whole lifecycle. Unlike 1.0's
-- signal_outcomes there is no per-horizon fan-out: the nightly scoring job
-- overwrites current_* and stamps closed_* exactly once.
--
-- Per-holding reviews (HOLD/TRIM/ADD/CLOSE/WATCH) are commentary, not
-- tracked bets, and live inside briefs.content instead.
-- ============================================================

CREATE TABLE recommendations (
  id                     UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id               UUID               NOT NULL REFERENCES briefs(id),
  ticker_symbol          TEXT               NOT NULL,
  direction              rec_direction_enum NOT NULL,
  thesis                 TEXT               NOT NULL,
  entry_zone_low         NUMERIC,
  entry_zone_high        NUMERIC,
  invalidation_price     NUMERIC            NOT NULL,
  horizon_trading_days   INT                NOT NULL CHECK (horizon_trading_days BETWEEN 1 AND 20),
  horizon_date           DATE               NOT NULL,
  conviction             INT                NOT NULL CHECK (conviction BETWEEN 1 AND 5),
  status                 rec_status_enum    NOT NULL DEFAULT 'OPEN',

  -- Snapshotted at creation so returns are measured from a fixed basis.
  entry_price            NUMERIC,
  benchmark_entry_price  NUMERIC,

  -- Refreshed by the nightly scoring job while the rec is OPEN.
  current_price          NUMERIC,
  current_return_pct     NUMERIC,
  benchmark_return_pct   NUMERIC,
  last_priced_at         TIMESTAMPTZ,

  -- Frozen once when the rec closes.
  closed_at              TIMESTAMPTZ,
  close_price            NUMERIC,
  closed_by_brief_id     UUID               REFERENCES briefs(id),
  close_note             TEXT,

  created_at             TIMESTAMPTZ        NOT NULL DEFAULT now()
);

-- The scoring job walks only OPEN rows (1.0 re-walked every signal nightly).
CREATE INDEX recommendations_status ON recommendations (status);
CREATE INDEX recommendations_ticker ON recommendations (ticker_symbol, created_at DESC);
CREATE INDEX recommendations_brief  ON recommendations (brief_id);

-- ============================================================
-- settings — tiny key/value store for owner preferences
-- (e.g. default_brief_model). Avoids a migration per preference.
-- ============================================================

CREATE TABLE settings (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Row Level Security
--
-- Same posture as the 1.0 shared tables: authenticated users may read,
-- all writes go through SUPABASE_SERVICE_ROLE_KEY (which bypasses RLS).
-- ============================================================

ALTER TABLE positions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE briefs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read positions"       ON positions       FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read briefs"          ON briefs          FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read recommendations" ON recommendations FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read settings"        ON settings        FOR SELECT TO authenticated USING (true);
