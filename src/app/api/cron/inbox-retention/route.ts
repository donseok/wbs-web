// src/app/api/cron/inbox-retention/route.ts — 읽음 90일 경과 알림 purge (안읽음 보존).
// Vercel Cron 이 Authorization: Bearer <CRON_SECRET> 으로 호출한다. 시크릿 없으면 실행 거부(fail-closed).
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) return new Response('cron secret not configured', { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
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
