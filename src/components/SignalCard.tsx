import type { SignalWithContext } from '@/lib/repositories/signalRepo'

const sentimentColors: Record<string, string> = {
  BULLISH: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  BEARISH: 'bg-red-500/15 text-red-400 border-red-500/30',
  NEUTRAL: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function SignalCard({ signal }: { signal: SignalWithContext }) {
  const article = signal.ai_analyses?.articles
  const sourceName = article?.sources?.name ?? 'Unknown source'
  const summary = signal.ai_analyses?.summary
  const impact = signal.ai_analyses?.economic_impact
  const sentClass = sentimentColors[signal.sentiment] ?? sentimentColors.NEUTRAL

  return (
    <article className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-base font-bold text-white">
          {signal.ticker_symbol}
        </span>
        <span
          className={`rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${sentClass}`}
        >
          {signal.sentiment} {signal.sentiment_score}/10
        </span>
      </div>

      {article && (
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block text-sm font-medium text-white hover:text-indigo-400 transition-colors"
        >
          {article.title}
        </a>
      )}

      {summary && (
        <p className="mt-2 text-sm text-zinc-300 leading-relaxed">{summary}</p>
      )}

      {impact && impact !== 'None' && (
        <p className="mt-2 text-xs text-zinc-400 italic">{impact}</p>
      )}

      <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
        <span>{sourceName}</span>
        <span>{relativeTime(signal.created_at)}</span>
      </div>
    </article>
  )
}
