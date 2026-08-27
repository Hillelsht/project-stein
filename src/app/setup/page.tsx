import Nav from '@/components/Nav'
import { runPreflight, type Check } from '@/lib/services/preflightService'
import DemoControls from './DemoControls'

export const dynamic = 'force-dynamic'

const STATE_STYLE: Record<Check['state'], string> = {
  ok: 'bg-emerald-500/15 text-emerald-400',
  missing: 'bg-zinc-700/40 text-zinc-300',
  error: 'bg-red-500/15 text-red-400',
  skipped: 'bg-indigo-500/15 text-indigo-400',
}

const STATE_LABEL: Record<Check['state'], string> = {
  ok: 'OK',
  missing: 'NOT SET',
  error: 'ERROR',
  skipped: 'DEFERRED',
}

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ deep?: string }>
}) {
  const { deep } = await searchParams
  const result = await runPreflight(deep === '1')

  const required = result.checks.filter((c) => c.required)
  const optional = result.checks.filter((c) => !c.required)

  const renderCheck = (c: Check) => (
    <div key={c.name} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{c.name}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${STATE_STYLE[c.state]}`}>
          {STATE_LABEL[c.state]}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-zinc-400">{c.detail}</p>
      {c.fix && <p className="mt-1.5 text-xs text-amber-300/90">→ {c.fix}</p>}
    </div>
  )

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Nav active="/setup" />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-xl font-semibold tracking-tight">Setup</h1>
        <p className="mt-1 text-xs text-zinc-500">
          Every integration Stein needs, checked live. Re-run this page after each
          credential you add.
        </p>

        <div
          className={`mt-4 rounded-lg border p-4 ${
            result.ready
              ? 'border-emerald-500/30 bg-emerald-500/10'
              : 'border-amber-500/30 bg-amber-500/10'
          }`}
        >
          <p className={`text-sm font-semibold ${result.ready ? 'text-emerald-300' : 'text-amber-300'}`}>
            {result.ready ? 'Ready to run.' : 'Not ready yet.'}
          </p>
          <p className="mt-1 text-xs text-zinc-300">
            {result.summary.ok} ok · {result.summary.missing} not set ·{' '}
            {result.summary.error} error
            {result.summary.skipped > 0 ? ` · ${result.summary.skipped} deferred` : ''}
          </p>
        </div>

        <section className="mt-6">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-zinc-500">
            Required
          </h2>
          <div className="space-y-2">{required.map(renderCheck)}</div>
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-zinc-500">
            Try it without credentials
          </h2>
          <DemoControls />
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-zinc-500">
            Optional
          </h2>
          <div className="space-y-2">{optional.map(renderCheck)}</div>
        </section>

        <p className="mt-6 text-xs text-zinc-500">
          The IBKR check only verifies that credentials exist by default, because a
          real statement request takes ~45s.{' '}
          <a href="/setup?deep=1" className="text-indigo-400 hover:text-indigo-300">
            Run the full check
          </a>{' '}
          to actually talk to IBKR.
        </p>
      </main>
    </div>
  )
}
