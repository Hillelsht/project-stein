-- ============================================================
-- Project Stein — Initial Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Sentiment enum used by market_signals
CREATE TYPE sentiment_enum AS ENUM ('BULLISH', 'BEARISH', 'NEUTRAL');

-- ============================================================
-- Tables
-- ============================================================

CREATE TABLE sources (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL,
  rss_url        TEXT        NOT NULL,
  priority_tier  INT         NOT NULL CHECK (priority_tier IN (1, 2)),
  active         BOOL        NOT NULL DEFAULT true,
  last_polled_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE articles (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id            UUID        NOT NULL REFERENCES sources(id),
  title                TEXT        NOT NULL,
  url                  TEXT        NOT NULL UNIQUE,
  published_at         TIMESTAMPTZ,
  fetched_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_content          TEXT,
  passed_filter        BOOL,
  filter_reject_reason TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_analyses (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id      UUID        NOT NULL UNIQUE REFERENCES articles(id),
  summary         TEXT,
  economic_impact TEXT,
  material        BOOL,
  confidence      INT         CHECK (confidence BETWEEN 0 AND 10),
  provider        TEXT,
  raw_response    JSONB,
  cost_tokens_in  INT,
  cost_tokens_out INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE market_signals (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id     UUID           NOT NULL REFERENCES ai_analyses(id),
  ticker_symbol   TEXT           NOT NULL,
  sentiment       sentiment_enum NOT NULL,
  sentiment_score INT            NOT NULL CHECK (sentiment_score BETWEEN 0 AND 10),
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX market_signals_ticker_created ON market_signals (ticker_symbol, created_at DESC);
CREATE INDEX market_signals_score_created  ON market_signals (sentiment_score DESC, created_at DESC);

CREATE TABLE watchlist (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker_symbol TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, ticker_symbol)
);

CREATE TABLE signal_outcomes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id        UUID        NOT NULL REFERENCES market_signals(id),
  ticker_symbol    TEXT        NOT NULL,
  price_at_signal  NUMERIC,
  price_1h         NUMERIC,
  price_1d         NUMERIC,
  price_3d         NUMERIC,
  price_7d         NUMERIC,
  return_1h        NUMERIC,
  return_1d        NUMERIC,
  return_3d        NUMERIC,
  return_7d        NUMERIC,
  last_updated_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tickers_master (
  ticker_symbol    TEXT        PRIMARY KEY,
  company_name     TEXT,
  exchange         TEXT,
  active           BOOL        NOT NULL DEFAULT true,
  last_refreshed_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dedup_hashes (
  hash       TEXT        PRIMARY KEY,
  article_id UUID        NOT NULL REFERENCES articles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX dedup_hashes_created ON dedup_hashes (created_at);

CREATE TABLE push_subscriptions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   TEXT        NOT NULL UNIQUE,
  p256dh     TEXT        NOT NULL,
  auth       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE sources           ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_analyses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_signals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist         ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_outcomes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickers_master    ENABLE ROW LEVEL SECURITY;
ALTER TABLE dedup_hashes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Shared read-only tables: any authenticated user can SELECT
CREATE POLICY "auth read sources"         ON sources         FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read articles"        ON articles        FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read ai_analyses"     ON ai_analyses     FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read market_signals"  ON market_signals  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read signal_outcomes" ON signal_outcomes FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read tickers_master"  ON tickers_master  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read dedup_hashes"    ON dedup_hashes    FOR SELECT TO authenticated USING (true);

-- Personal tables: users own only their own rows
CREATE POLICY "users own watchlist" ON watchlist
  FOR ALL TO authenticated
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users own push_subscriptions" ON push_subscriptions
  FOR ALL TO authenticated
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- Seed data
-- ============================================================

INSERT INTO sources (name, rss_url, priority_tier, active) VALUES
  ('SEC EDGAR 8-K',   'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&output=atom', 1, true),
  ('PR Newswire All', 'https://www.prnewswire.com/rss/news-releases-list.rss',                           1, true),
  ('Yahoo Finance Top','https://finance.yahoo.com/news/rssindex',                                         2, true);
