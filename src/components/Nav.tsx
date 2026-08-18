import Link from 'next/link'
import { signOutAction } from '@/app/actions'

const LINKS = [
  { href: '/', label: 'Brief' },
  { href: '/briefs', label: 'Archive' },
  { href: '/scoreboard', label: 'Scoreboard' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/setup', label: 'Setup' },
] as const

export default function Nav({ active }: { active: string }) {
  return (
    <header className="border-b border-zinc-800 bg-zinc-950 px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
        <span className="text-sm font-semibold tracking-tight">Stein</span>
        <nav className="flex items-center gap-4 text-xs">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={
                active === link.href
                  ? 'font-semibold text-white'
                  : 'text-zinc-400 transition-colors hover:text-white'
              }
            >
              {link.label}
            </Link>
          ))}
          <form action={signOutAction}>
            <button
              type="submit"
              className="text-zinc-400 transition-colors hover:text-white"
            >
              Sign out
            </button>
          </form>
        </nav>
      </div>
    </header>
  )
}
