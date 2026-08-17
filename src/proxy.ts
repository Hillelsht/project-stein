import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/** Paths reachable without a session. Everything else redirects to /login. */
const PUBLIC_PATHS = new Set(['/login'])

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() refreshes the session if needed — do not remove.
  // This is what keeps the session alive indefinitely between visits.
  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname

  if (!user && !PUBLIC_PATHS.has(path)) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && path === '/login') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return supabaseResponse
}

export const config = {
  // Exclude static assets, PWA assets (must load unauthenticated so the service
  // worker and manifest work), and API routes (cron routes carry their own auth).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icon.svg|api/).*)',
    '/',
  ],
}
