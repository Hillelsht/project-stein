# Project Stein — Pipeline

## The inversion

Stein 1.0: **many small LLM calls, no context.** Every article that survived a
regex filter got its own Gemini Flash-Lite call — up to 800 a day — asking for a
sentiment score on 4,000 truncated characters.

Stein 2.0: **two large LLM calls, maximum context.** The regex filter survives
as the *news selector*; nothing else about 1.0's LLM stage does. Twice a day one
frontier-model call receives the whole picture and returns decisions.

```
1.0:  article → filter → LLM → score        (×800/day, no memory, no portfolio)
2.0:  news + positions + technicals + macro + open ideas → LLM → decisions  (×2/day)
```

## Ingest → select (news, no model)

```
RSS (SEC EDGAR 8-K, PR Newswire, Yahoo Finance)
  → rssService.fetchAndStoreAll()      articles.url UNIQUE dedupes at DB level
  → /api/cron/select
      Stage 1  ticker extraction, validated against tickers_master
      Stage 2  material keyword regex        → reject no_material_keyword
      Stage 3  SEC 8-K item allowlist        → reject immaterial_sec_item
      Stage 4  SHA-256 dedup, 48h window     → reject duplicate
      → articles.passed_filter = true
```

**The dedup hash is saved last, after every rejection stage.** 1.0 saved it
before its LLM budget check, so a budget-dropped article left its hash behind
and that story could never be seen again — the news was lost, not deferred.
There is no budget stage now, but the invariant stands: a hash must only ever
record something that actually passed.

## The context pack

`contextPackService.buildContextPack(briefType)` assembles everything the model
is allowed to reason from. Target ≤ ~25K tokens; `approx_tokens` is reported so
the budget is observable.

| Section | Source |
|---|---|
| `macro` | SPY, QQQ, ^VIX, ^TNX — last + 1d change |
| `positions` | `positions` table + technicals + P&L% + next earnings |
| `watchlist` | watched tickers not already held (no duplicate token spend) |
| `open_recommendations` | every OPEN ledger row with live P&L, **distance to invalidation**, trading days left |
| `news` | last 24h `passed_filter = true`, ranked, capped at 60, 240-char snippets |
| `earnings_calendar` | next 14 days for held + watched tickers |

**Technicals are computed in code, never asked of the model:** Wilder RSI(14),
SMA 20/50/200 and % distance, 52-week range proximity, volume vs 30-day average,
1d/5d/1mo changes. An LLM cannot reliably compute an RSI from a list of closes,
but it reasons well about "RSI 28, 12% below the 50-day, earnings in 3 days".

**News ranking:** touches a holding (3) > touches a watchlist or open-idea name
(2) > general market (1); newest first within a tier.

**Open recommendations are in the pack on purpose.** The model must confront its
own prior calls before proposing new ones — that is what makes the ledger
self-correcting instead of an ever-growing pile of forgotten ideas.

## Generation

Two runners, because the owner's frontier-model access is a subscription rather
than an API key:

| Runner | Models | Path |
|---|---|---|
| `vercel` | Gemini 2.5 Pro / Flash, Groq Llama | REST from the brief route, inline (~30–60s) |
| `actions` | Claude Opus 5 / Sonnet 5 | `brief-worker.yml` runs `claude -p` on the owner's Pro/Max subscription, POSTs back (~2–3 min) |

Fallback chain on failure: chosen model → Gemini Pro → Gemini Flash → Groq
(compact pack, since Groq's free TPM cannot fit the full one). A provider error
returns `null` and moves to the next model; 1.0 threw and aborted the batch.

## Validation — the gate that matters

`briefService.validateBrief` refuses to store anything that could not later be
scored. Every drop is logged with its reason.

| Rule | Why |
|---|---|
| Idea ticker must be held or in `tickers_master` | hallucinated symbols |
| **Invalidation must be on the correct side of the entry** (below for LONG, above for SHORT) | a wrong-side stop can *never* trigger, so a broken thesis would ride to its horizon unchallenged |
| Holding review must name a current position | commentary about stock you don't own |
| `rec_update` must reference an actually-OPEN recommendation | phantom updates |
| `horizon_trading_days` → 1–20, `conviction` → 1–5 | clamped |
| Parse failure | one repair retry with the **full** prompt, then FAILED |

## Ledger and scoring

New ideas become `recommendations` rows with `entry_price` and
`benchmark_entry_price` (SPY) snapshotted at creation, so returns are always
measured from a fixed basis.

Nightly (`02:00 UTC Tue–Sat`), `scoringService`:

1. Prices every OPEN row and SPY (one fetch per distinct ticker).
2. Computes direction-aware return — a SHORT that falls is a gain.
3. **Close-based invalidation** → `CLOSED_INVALIDATED`. Intraday wicks are
   deliberately ignored: free EOD data has no reliable intraday series, and
   closing on a wick that recovered would record exits the owner never took.
4. Past `horizon_date` → `CLOSED_HORIZON`.
5. **A missing price skips the row** rather than closing it — a data outage must
   never auto-close a trade or freeze a stale return as final.

**Alpha vs SPY is the headline metric, not hit rate.** A hit rate alone flatters
any system in a rising market. Only closed rows count; open ones are excluded so
unrealized winners cannot inflate the record while losers quietly close.

## Delivery

Email (Resend) + Web Push, both individually try/caught — a brief that generated
correctly but could not be emailed is still a good brief, and the retry cron
firing re-attempts only what has not succeeded. The subject line carries the
decision (`Stein Pre-market · 2026-08-17 · 1 new idea, 2 position actions`, or
`· no action`) so the notification alone is triageable.

## Self-healing

Each brief slot fires **twice** (`0 11` + `45 11`; `30 21` + `15 22` UTC). The
second pass carries `heal=1`:

- A `GENERATED` brief → no-op, but delivery is re-attempted.
- A missing or `FAILED` brief → regenerated.
- Anything stuck `PENDING` > 30 min (the Actions worker never reported) →
  regenerated inline with the Gemini chain.

So a transient provider outage costs a delay, not a brief.
