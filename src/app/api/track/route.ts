import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { trackingEnabled, usageEventDimensionsMissing } from '@/lib/domain/usageTracking'
import { extractProjectId, normalizeUsagePath, resolveMenuKey } from '@/lib/domain/usageMenu'
import {
  isWikiAnalyticsEvent,
  normalizeWikiAnalyticsMetadata,
} from '@/lib/domain/wikiAnalytics'

export const dynamic = 'force-dynamic'

/** 경로 길이 상한 — 정상 라우트는 200자를 넘지 않는다. 그 이상은 잡음이거나 공격이다. */
const MAX_PATH_LEN = 512

/**
 * 사용 기록 수집 — 라우트 전환 1건당 1행.
 *
 * /api/** 는 middleware matcher 밖이라 여기서 직접 인증한다.
 * 본문은 경로만 받는다: 사용자 id·메뉴 키·프로젝트 id 는 전부 서버가 판정한다.
 * 클라이언트가 보낸 식별자를 그대로 쓰면 남의 이름으로 기록을 남길 수 있다.
 */
export async function POST(req: NextRequest) {
  if (!trackingEnabled(process.env)) {
    return NextResponse.json({ ok: true, skipped: 'disabled' })
  }

  const sb = await createServerClient()
  const { data } = await sb.auth.getClaims()
  const uid = data?.claims?.sub as string | undefined
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as {
    path?: unknown
    eventName?: unknown
    metadata?: unknown
  } | null
  const path = typeof body?.path === 'string' ? body.path : null
  if (!path || !path.startsWith('/') || path.length > MAX_PATH_LEN) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
  const eventName = body?.eventName === undefined ? 'page_view' : body.eventName
  if (eventName !== 'page_view' && !isWikiAnalyticsEvent(eventName)) {
    return NextResponse.json({ error: 'bad event' }, { status: 400 })
  }
  // 제품 이벤트는 Wiki 경로에서만 받는다. 임의 메뉴의 사용량을 Wiki 이벤트로 오염시키지 않는다.
  if (eventName !== 'page_view' && resolveMenuKey(path) !== 'wiki') {
    return NextResponse.json({ error: 'bad event path' }, { status: 400 })
  }

  const admin = createAdminClient()
  const legacyRow = {
    user_id: uid,
    menu_key: resolveMenuKey(path),
    path: normalizeUsagePath(path),
    project_id: extractProjectId(path),
  }
  const { error } = await admin.from('usage_events').insert({
    ...legacyRow,
    event_name: eventName,
    metadata: eventName === 'page_view' ? {} : normalizeWikiAnalyticsMetadata(body?.metadata),
  })
  if (usageEventDimensionsMissing(error)) {
    // 앱이 DB보다 먼저 배포돼도 전역 page-view 수집은 0079 이전 형식으로 유지한다.
    // Wiki 행동 이벤트를 page view로 둔갑시킬 수는 없으므로 스키마 준비 전에는 건너뛴다.
    if (eventName !== 'page_view') {
      return NextResponse.json({ ok: true, skipped: 'schema_missing' })
    }
    const { error: legacyError } = await admin.from('usage_events').insert(legacyRow)
    if (!legacyError) return NextResponse.json({ ok: true, compatibility: 'legacy' })
    console.error('[usage] 레거시 이벤트 기록 실패:', legacyError.message)
    return NextResponse.json({ error: 'insert failed' }, { status: 500 })
  }
  if (error) {
    // 조용히 삼키면 수집이 끊긴 것을 아무도 모른다. 화면의 '수집 상태'와 이 로그가 짝이다.
    console.error('[usage] 이벤트 기록 실패:', error.message)
    return NextResponse.json({ error: 'insert failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
