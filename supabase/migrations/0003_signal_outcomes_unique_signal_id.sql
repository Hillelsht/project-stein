-- ============================================================
-- Project Stein — Bugfix: signal_outcomes upsert constraint
--
-- The validate cron uses upsert(..., { onConflict: 'signal_id' })
-- to repeatedly fill horizon prices as they ripen. That call requires
-- a UNIQUE/PK constraint on signal_id. The original schema (Phase 1)
-- only had a foreign-key reference, so the upsert raised
-- 42P10 ("there is no unique or exclusion constraint matching the ON
-- CONFLICT specification") the first time it ever fired.
--
-- This migration adds the missing UNIQUE constraint. The functional
-- contract was always one-row-per-signal — this is just enforcing it.
-- ============================================================

ALTER TABLE signal_outcomes
  ADD CONSTRAINT signal_outcomes_signal_id_unique UNIQUE (signal_id);
