/**
 * Resend over plain fetch. The official SDK is a thin wrapper around this one
 * endpoint, so it would be a dependency with nothing to do.
 */

const RESEND_URL = 'https://api.resend.com/emails'

// Resend lets you send from this address to the account owner's own inbox
// without verifying a domain, which keeps setup to one API key.
const DEFAULT_FROM = 'Project Stein <onboarding@resend.dev>'

export type SendEmailArgs = {
  to: string
  subject: string
  html: string
}

export class EmailNotConfiguredError extends Error {
  constructor(missing: string) {
    super(`${missing} not set — email delivery skipped`)
    this.name = 'EmailNotConfiguredError'
  }
}

export async function sendEmail(args: SendEmailArgs): Promise<string> {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new EmailNotConfiguredError('RESEND_API_KEY')

  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      from: process.env.BRIEF_FROM_EMAIL || DEFAULT_FROM,
      to: [args.to],
      subject: args.subject,
      html: args.html,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`)
  }

  const json = await res.json()
  return json?.id ?? 'unknown'
}

export function getRecipient(): string | null {
  return process.env.BRIEF_RECIPIENT_EMAIL || null
}
