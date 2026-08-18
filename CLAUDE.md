@AGENTS.md

# Project Stein

A private, portfolio-aware trading brief: twice a trading day it reads the
owner's real IBKR positions plus computed technicals, macro, filtered news, and
its own open recommendations, and asks a frontier model what to open or close.
Every idea is logged to a ledger and scored against SPY.

Before writing any code, read these docs in order:

1. `docs/overview.md` — what the project is, the stack, and why 2.0 replaced 1.0
2. `docs/phases-log.md` — what has been built phase by phase (start here for current state)
3. `docs/code-structure.md` — folder layout, hard rules, cron schedule, env vars
4. `docs/data-model.md` — all 14 tables (4 frozen from 1.0), relationships, RLS
5. `docs/pipeline.md` — ingest → context pack → brief → ledger → scoreboard

## Hard rules (never break these)

- No Supabase calls outside `src/lib/repositories/`
- No React/Next.js imports in `src/lib/`
- `createServiceClient()` is server-side only — never in client components
- All cron routes require `Authorization: Bearer ${CRON_SECRET}` — return 401 otherwise
- **LLM budget: ≤2 large brief calls per scheduled day** (plus on-demand runs the
  owner triggers). Stein 1.0 made up to 800 tiny per-article calls; undoing that
  is the entire point of 2.0. Never reintroduce a per-article model call.
- **Never persist a recommendation that cannot be scored.** Validation drops
  unknown tickers and invalidation prices on the wrong side of the entry zone —
  a wrong-side stop can never trigger, so a broken thesis would ride to its
  horizon unchallenged.
- `ai_analyses`, `market_signals`, `signal_outcomes`, and `push_history` are
  **frozen 1.0 history**. Nothing writes to them and their repos are deleted;
  do not add code that depends on them.
- Update `docs/phases-log.md` at the end of every phase
