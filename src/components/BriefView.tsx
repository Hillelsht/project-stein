import type { Brief, BriefContent } from '@/lib/repositories/briefRepo'
import type { Recommendation } from '@/lib/repositories/recommendationRepo'
import type { ContextPack } from '@/lib/services/contextPackService'

/** Server component: renders a stored brief. Mirrors the email layout. */

const ACTION_STYLE: Record<string, string> = {
  HOLD: 'bg-zinc-800 text-zinc-300',
  ADD: 'bg-emerald-500/15 text-emerald-400',
  TRIM: 'bg-amber-500/15 text-amber-400',
  CLOSE: 'bg-red-500/15 text-red-400',
  WATCH: 'bg-indigo-500/15 text-indigo-400',
}

const DECISION_STYLE: Record<string, string> = {
  MAINTAIN: 'bg-zinc-800 text-zinc-300',
  CLOSE: 'bg-red-500/15 text-red-400',
  TIGHTEN_INVALIDATION: 'bg-amber-500/15 text-amber-400',
}

function pct(value: number | null | undefined, dp = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(dp)}%`
}

function num(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toFixed(2)
}

function signClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'text-zinc-400'
  return value > 0 ? 'text-emerald-400' : 'text-red-400'
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-zinc-500">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">{children}</div>
  )
}

export default function BriefView({
  brief,
  recommendations,
}: {
  brief: Brief
  recommendations: Recommendation[]
}) {
  const content = brief.content as BriefContent | null
  if (!content) {
    return <p className="mt-6 text-sm text-zinc-500">This brief has no content.</p>
  }

  const pack = brief.context_pack as unknown as ContextPack | null

  return (
    <div>
      {pack?.macro?.length ? (
        <div className="grid grid-cols-4 gap-2">
          {pack.macro.map((m) => (
            <div
              key={m.ticker}
              className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-3 text-center"
            >
              <div className="text-[10px] font-semibold text-zinc-500">{m.ticker}</div>
              <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                {num(m.last)}
              </div>
              <div className={`text-[11px] tabular-nums ${signClass(m.change_1d_pct)}`}>
                {pct(m.change_1d_pct, 2)}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {content.macro_bullets.length > 0 && (
        <Section title="Market">
          <Card>
            <ul className="space-y-1.5">
              {content.macro_bullets.map((b, i) => (
                <li key={i} className="text-sm leading-relaxed text-zinc-200">
                  • {b}
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      {content.holdings_reviews.length > 0 && (
        <Section title="Your positions">
          {content.holdings_reviews.map((h, i) => {
            const pos = pack?.positions?.find((p) => p.ticker === h.ticker)
            return (
              <Card key={`${h.ticker}-${i}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-sm font-bold">{h.ticker}</span>
                  <span className="flex items-center gap-2">
                    {pos && (
                      <span className={`text-xs tabular-nums ${signClass(pos.unrealized_pnl_pct)}`}>
                        {pct(pos.unrealized_pnl_pct)}
                      </span>
                    )}
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${
                        ACTION_STYLE[h.action] ?? 'bg-zinc-800 text-zinc-300'
                      }`}
                    >
                      {h.action}
                    </span>
                  </span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">{h.rationale}</p>
              </Card>
            )
          })}
        </Section>
      )}

      {content.rec_updates.length > 0 && (
        <Section title="Open ideas">
          {content.rec_updates.map((u, i) => {
            const rec = pack?.open_recommendations?.find((r) => r.id === u.recommendation_id)
            return (
              <Card key={`${u.recommendation_id}-${i}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-sm font-bold">
                    {u.ticker}
                    {rec && (
                      <span className="ml-1.5 text-[10px] font-medium text-zinc-500">
                        {rec.direction}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    {rec && (
                      <span className={`text-xs tabular-nums ${signClass(rec.return_pct)}`}>
                        {pct(rec.return_pct)}
                      </span>
                    )}
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${
                        DECISION_STYLE[u.decision] ?? 'bg-zinc-800 text-zinc-300'
                      }`}
                    >
                      {u.decision.replace(/_/g, ' ')}
                    </span>
                  </span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">{u.note}</p>
              </Card>
            )
          })}
        </Section>
      )}

      <Section title="New ideas">
        {content.new_ideas.length === 0 ? (
          <p className="text-sm italic text-zinc-500">No new trade ideas today.</p>
        ) : (
          content.new_ideas.map((idea, i) => {
            const saved = recommendations.find(
              (r) => r.ticker_symbol === idea.ticker && r.direction === idea.direction
            )
            return (
              <Card key={`${idea.ticker}-${i}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-base font-bold">
                    {idea.ticker}
                    <span
                      className={`ml-1.5 text-[11px] font-bold ${
                        idea.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {idea.direction}
                    </span>
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    conviction {idea.conviction}/5
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-zinc-200">{idea.thesis}</p>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-zinc-500">Entry</dt>
                  <dd className="font-mono tabular-nums text-zinc-200">
                    {num(idea.entry_zone_low)} – {num(idea.entry_zone_high)}
                  </dd>
                  <dt className="text-zinc-500">Invalidation</dt>
                  <dd className="font-mono tabular-nums text-red-400">
                    {num(idea.invalidation_price)}
                  </dd>
                  <dt className="text-zinc-500">Horizon</dt>
                  <dd className="font-mono tabular-nums text-zinc-200">
                    {idea.horizon_trading_days} trading days
                    {saved ? ` (to ${saved.horizon_date})` : ''}
                  </dd>
                </dl>
              </Card>
            )
          })
        )}
      </Section>

      {content.calendar.length > 0 && (
        <Section title="Ahead">
          <Card>
            {content.calendar.map((c, i) => (
              <div key={i} className="py-0.5 text-[13px] text-zinc-200">
                <span className="font-mono text-xs text-zinc-500">{c.date}</span>{' '}
                {c.label}
                {c.ticker ? <span className="text-zinc-500"> ({c.ticker})</span> : null}
              </div>
            ))}
          </Card>
        </Section>
      )}
    </div>
  )
}
