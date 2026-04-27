@AGENTS.md

# Project Stein

AI-powered financial news filter. Before writing any code, read these docs in order:

1. `docs/overview.md` — what the project is, tech stack, key design decisions
2. `docs/phases-log.md` — what has been built phase by phase (start here to understand current state)
3. `docs/code-structure.md` — folder layout, hard rules, conventions
4. `docs/data-model.md` — all 9 DB tables, relationships, RLS
5. `docs/pipeline.md` — the pre-filter + LLM pipeline in detail

## Hard rules (never break these)

- No Supabase calls outside `src/lib/repositories/`
- No React/Next.js imports in `src/lib/`
- `createServiceClient()` is server-side only — never in client components
- All cron routes require `Authorization: Bearer ${CRON_SECRET}` — return 401 otherwise
- Daily LLM budget cap: 800 calls/day (never raise without a paid tier)
- Update `docs/phases-log.md` at the end of every phase
