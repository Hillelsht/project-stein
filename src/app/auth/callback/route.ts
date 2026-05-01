import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')

  if (!code && !token_hash) {
    return NextResponse.redirect(`${origin}/login?error=missing_token`)
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  let authError: { message: string } | null = null

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    authError = error
  } else if (token_hash && type) {
    // type is always an email OTP type for magic links (not SMS)
    const emailType = type as 'email' | 'recovery' | 'invite' | 'signup' | 'email_change' | 'magiclink'
    const { error } = await supabase.auth.verifyOtp({ token_hash, type: emailType })
    authError = error
  }

  if (authError) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(authError.message)}`)
  }

  return NextResponse.redirect(`${origin}/watchlist`)
}
