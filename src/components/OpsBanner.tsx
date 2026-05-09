import { getPipelineHealth } from '@/lib/services/opsService'

export default async function OpsBanner() {
  let health
  try {
    health = await getPipelineHealth()
  } catch {
    return null
  }

  if (health.status === 'ok' || health.issues.length === 0) return null

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
      <p className="font-semibold">Pipeline degraded</p>
      <ul className="mt-1 list-disc list-inside space-y-0.5 text-amber-200/90">
        {health.issues.map((issue, i) => (
          <li key={i}>{issue}</li>
        ))}
      </ul>
    </div>
  )
}
