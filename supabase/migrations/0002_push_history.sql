-- ============================================================
-- Project Stein — Phase 11: push_history
-- Tracks every push notification sent so we can enforce:
--   * max 10 pushes per user per day
--   * no duplicate ticker push to same user within 30 minutes
-- ============================================================

CREATE TABLE push_history (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker_symbol  TEXT        NOT NULL,
  signal_id      UUID        REFERENCES market_signals(id) ON DELETE SET NULL,
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX push_history_user_sent_idx ON push_history (user_id, sent_at DESC);
CREATE INDEX push_history_user_ticker_sent_idx ON push_history (user_id, ticker_symbol, sent_at DESC);

ALTER TABLE push_history ENABLE ROW LEVEL SECURITY;

-- Users can read their own send history (useful for a "recent notifications" view later);
-- writes only happen via the service role from the analyze cron.
CREATE POLICY push_history_self_select ON push_history
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
