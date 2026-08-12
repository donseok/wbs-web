import { createHash, timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) return new Response('cron secret not configured', { status: 503 })

  const authHeader = req.headers.get('authorization')
  const providedSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!secretMatches(providedSecret, secret)) {
    return new Response('unauthorized', { status: 401 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('purge_read_notifications', { retention_days: 90 })
  if (error) {
    console.error('[inbox] retention purge 실패', error.message)
    return new Response('purge failed', { status: 500 })
  }
  return Response.json({ ok: true, result: data })
}
