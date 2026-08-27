import type { Brief, BriefContent } from '@/lib/repositories/briefRepo'
import type { Recommendation } from '@/lib/repositories/recommendationRepo'
import type { ContextPack } from '@/lib/services/contextPackService'

/**
 * Email rendering. Table layout with inline CSS, because email clients strip
 * <style> blocks, ignore flex/grid, and mangle class selectors.
 *
 * Framework-free so it stays inside src/lib/ — this is string building, not JSX.
 */

const C = {
  bg: '#0b0b0f',
  card: '#16161d',
  border: '#2a2a35',
  text: '#e8e8ee',
  dim: '#9a9aa8',
  green: '#34d399',
  red: '#f87171',
  amber: '#fbbf24',
  indigo: '#818cf8',
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function pct(value: number | null | undefined, dp = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(dp)}%`
}

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toFixed(2)
}

function signColor(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return C.dim
  return value > 0 ? C.green : C.red
}

const ACTION_COLOR: Record<string, string> = {
  HOLD: C.dim,
  ADD: C.green,
  TRIM: C.amber,
  CLOSE: C.red,
  WATCH: C.indigo,
}

function section(title: string, inner: string): string {
  if (!inner.trim()) return ''
  return `
    <tr><td style="padding:22px 24px 6px;">
      <div style="font:600 11px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:${C.dim};">${esc(title)}</div>
    </td></tr>
    <tr><td style="padding:0 24px 4px;">${inner}</td></tr>`
}

function card(inner: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.border};border-radius:10px;margin:8px 0;">
    <tr><td style="padding:14px 16px;">${inner}</td></tr>
  </table>`
}

export function renderBriefHtml(args: {
  brief: Brief
  content: BriefContent
  recommendations: Recommendation[]
  pack?: ContextPack | null
  appUrl?: string | null
}): string {
  const { brief, content, recommendations, pack, appUrl } = args

  const titleByType: Record<string, string> = {
    PREMARKET: 'Pre-market brief',
    EVENING: 'Evening wrap',
    ON_DEMAND: 'On-demand brief',
  }
  const heading = titleByType[brief.brief_type] ?? 'Brief'

  // ── Macro ──
  const macro = content.macro_bullets.length
    ? card(
        content.macro_bullets
          .map(
            (b) =>
              `<div style="font:400 14px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:${C.text};padding:3px 0;">• ${esc(b)}</div>`
          )
          .join('')
      )
    : ''

  // ── Macro snapshot strip (facts, straight from the pack) ──
  const macroStrip = pack?.macro?.length
    ? card(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
          pack.macro
            .map(
              (m) => `<td style="text-align:center;padding:2px 6px;">
                <div style="font:600 11px/1.3 -apple-system,sans-serif;color:${C.dim};">${esc(m.ticker)}</div>
                <div style="font:600 15px/1.4 -apple-system,sans-serif;color:${C.text};">${money(m.last)}</div>
                <div style="font:500 12px/1.3 -apple-system,sans-serif;color:${signColor(m.change_1d_pct)};">${pct(m.change_1d_pct)}</div>
              </td>`
            )
            .join('') +
          `</tr></table>`
      )
    : ''

  // ── Holdings ──
  const holdings = content.holdings_reviews
    .map((h) => {
      const pos = pack?.positions?.find((p) => p.ticker === h.ticker)
      const pnl = pos
        ? `<span style="font:500 12px/1.4 -apple-system,sans-serif;color:${signColor(pos.unrealized_pnl_pct)};">${pct(pos.unrealized_pnl_pct)}</span>`
        : ''
      return card(`
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font:700 15px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:${C.text};">${esc(h.ticker)}</td>
          <td align="right">
            <span style="font:700 11px/1.4 -apple-system,sans-serif;letter-spacing:.05em;color:${ACTION_COLOR[h.action] ?? C.dim};">${esc(h.action)}</span>
            ${pnl ? ` &nbsp;${pnl}` : ''}
          </td>
        </tr></table>
        <div style="font:400 13px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:${C.dim};padding-top:6px;">${esc(h.rationale)}</div>`)
    })
    .join('')

  // ── Open recommendation updates ──
  const updates = content.rec_updates
    .map((u) => {
      const rec = pack?.open_recommendations?.find((r) => r.id === u.recommendation_id)
      const ret = rec
        ? `<span style="font:500 12px/1.4 -apple-system,sans-serif;color:${signColor(rec.return_pct)};">${pct(rec.return_pct)}</span>`
        : ''
      const decisionColor =
        u.decision === 'CLOSE' ? C.red : u.decision === 'TIGHTEN_INVALIDATION' ? C.amber : C.dim
      return card(`
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font:700 15px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:${C.text};">
            ${esc(u.ticker)} ${rec ? `<span style="font:500 11px/1.4 -apple-system,sans-serif;color:${C.dim};">${esc(rec.direction)}</span>` : ''}
          </td>
          <td align="right">
            <span style="font:700 11px/1.4 -apple-system,sans-serif;color:${decisionColor};">${esc(u.decision.replace(/_/g, ' '))}</span>
            ${ret ? ` &nbsp;${ret}` : ''}
          </td>
        </tr></table>
        <div style="font:400 13px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:${C.dim};padding-top:6px;">${esc(u.note)}</div>`)
    })
    .join('')

  // ── New ideas ──
  const ideas = content.new_ideas
    .map((idea) => {
      const saved = recommendations.find(
        (r) => r.ticker_symbol === idea.ticker && r.direction === idea.direction
      )
      const dirColor = idea.direction === 'LONG' ? C.green : C.red
      const row = (label: string, value: string) =>
        `<tr>
          <td style="font:500 12px/1.7 -apple-system,sans-serif;color:${C.dim};padding-right:12px;white-space:nowrap;">${esc(label)}</td>
          <td style="font:600 12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;color:${C.text};">${value}</td>
        </tr>`

      return card(`
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font:700 16px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:${C.text};">
            ${esc(idea.ticker)}
            <span style="font:700 11px/1.4 -apple-system,sans-serif;color:${dirColor};">&nbsp;${esc(idea.direction)}</span>
          </td>
          <td align="right" style="font:500 11px/1.4 -apple-system,sans-serif;color:${C.dim};">
            conviction ${esc(idea.conviction)}/5
          </td>
        </tr></table>
        <div style="font:400 13px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:${C.text};padding:8px 0 10px;">${esc(idea.thesis)}</div>
        <table role="presentation" cellpadding="0" cellspacing="0">
          ${row('Entry', `${money(idea.entry_zone_low)} – ${money(idea.entry_zone_high)}`)}
          ${row('Invalidation', `<span style="color:${C.red};">${money(idea.invalidation_price)}</span>`)}
          ${row('Horizon', `${esc(idea.horizon_trading_days)} trading days${saved ? ` (to ${esc(saved.horizon_date)})` : ''}`)}
        </table>`)
    })
    .join('')

  // ── Calendar ──
  const calendar = content.calendar.length
    ? card(
        content.calendar
          .map(
            (c) =>
              `<div style="font:400 13px/1.7 -apple-system,Segoe UI,Roboto,sans-serif;color:${C.text};">
                <span style="font:600 12px/1.7 ui-monospace,Menlo,monospace;color:${C.dim};">${esc(c.date)}</span>
                &nbsp;${esc(c.label)}${c.ticker ? ` <span style="color:${C.dim};">(${esc(c.ticker)})</span>` : ''}
              </div>`
          )
          .join('')
      )
    : ''

  const site = appUrl ? appUrl.replace(/\/$/, '') : null

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(heading)} — ${esc(brief.brief_date)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:20px 0;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.bg};">

  <tr><td style="padding:8px 24px 0;">
    <div style="font:700 20px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:${C.text};">${esc(heading)}</div>
    <div style="font:400 13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:${C.dim};padding-top:2px;">
      ${esc(brief.brief_date)}${brief.model ? ` · ${esc(brief.model)}` : ''}
    </div>
  </td></tr>

  ${macroStrip ? `<tr><td style="padding:12px 24px 0;">${macroStrip}</td></tr>` : ''}
  ${section('Market', macro)}
  ${section('Your positions', holdings)}
  ${section('Open ideas', updates)}
  ${section('New ideas', ideas)}
  ${section('Ahead', calendar)}

  ${
    content.new_ideas.length === 0
      ? `<tr><td style="padding:4px 24px;">
          <div style="font:400 13px/1.6 -apple-system,sans-serif;color:${C.dim};font-style:italic;">No new trade ideas today.</div>
        </td></tr>`
      : ''
  }

  <tr><td style="padding:24px;">
    ${
      site
        ? `<a href="${esc(site)}" style="display:inline-block;background:${C.indigo};color:#0b0b0f;font:600 13px/1 -apple-system,sans-serif;text-decoration:none;padding:11px 18px;border-radius:8px;">Open Stein</a>`
        : ''
    }
    <div style="font:400 11px/1.6 -apple-system,sans-serif;color:${C.dim};padding-top:16px;border-top:1px solid ${C.border};margin-top:20px;">
      Project Stein is an automated research tool, not licensed financial advice.
      Every recommendation here is tracked and scored against SPY — check the
      scoreboard before acting on any of it.
    </div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`
}

export function briefSubject(brief: Brief, content: BriefContent): string {
  const label =
    brief.brief_type === 'EVENING'
      ? 'Evening wrap'
      : brief.brief_type === 'ON_DEMAND'
        ? 'Brief'
        : 'Pre-market'
  const ideas = content.new_ideas.length
  const actions = content.holdings_reviews.filter((h) => h.action !== 'HOLD').length

  const parts: string[] = []
  if (ideas > 0) parts.push(`${ideas} new idea${ideas > 1 ? 's' : ''}`)
  if (actions > 0) parts.push(`${actions} position action${actions > 1 ? 's' : ''}`)

  const summary = parts.length > 0 ? parts.join(', ') : 'no action'
  return `Stein ${label} · ${brief.brief_date} · ${summary}`
}
