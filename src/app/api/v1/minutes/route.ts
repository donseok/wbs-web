import { after, NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TEAM_CODES } from '@/lib/domain/minutes'
import {
  apiBadRequest, apiFail, apiInternalError, apiNotFound, gateMinutesApi,
  parseMinutePayload, parseUserEmail, resolveUserByEmail, runMinutePostProcessing,
  type AdminClient, type ExternalMinutePayload, type ResolvedUser,
} from '@/lib/minutes/externalApi'

/**
 * POST /api/v1/minutes — 회의록 생성/갱신(upsert by external_id), GET — 목록/존재 확인.
 * 계약: docs/design/dflow-minutes-upload-api-spec.md §4·§5.1. 또박또박 서버가 호출한다.
 */

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const MINUTE_SELECT = 'id, minute_date, team_code, title, meeting_id, external_id, created_by_name, created_at, updated_at'

interface ExistingRow {
  id: string
  minute_date: string
  team_code: string
  title: string
  meeting_id: string | null
  external_id: string
  created_by_name: string | null
  created_at: string
  updated_at: string
}

function respondMinute(req: NextRequest, status: number, args: {
  id: string; action: 'created' | 'replaced' | 'skipped'
  title: string; date: string; team: string; meetingId: string | null
  externalId: string; createdByName: string | null; createdAt: string; updatedAt: string
}) {
  return NextResponse.json({
    ok: true, id: args.id, action: args.action,
    title: args.title, date: args.date, team: args.team,
    meeting_id: args.meetingId, external_id: args.externalId,
    created_by_name: args.createdByName,
    url: `${req.nextUrl.origin}/minutes/${args.id}`,
    created_at: args.createdAt, updated_at: args.updatedAt,
  }, { status })
}

/** 동일 external_id 레코드가 이미 있을 때의 on_conflict 분기 — 계약 §4.2. */
async function handleExisting(
  req: NextRequest, admin: AdminClient, p: ExternalMinutePayload, existing: ExistingRow,
): Promise<NextResponse> {
  if (p.onConflict === 'error') return apiFail(409, 'conflict', '이미 존재하는 external_id 입니다.')
  if (p.onConflict === 'skip') {
    return respondMinute(req, 200, {
      id: existing.id, action: 'skipped', title: existing.title, date: existing.minute_date,
      team: existing.team_code, meetingId: existing.meeting_id, externalId: existing.external_id,
      createdByName: existing.created_by_name, createdAt: existing.created_at, updatedAt: existing.updated_at,
    })
  }
  // replace — §0 D3: created_by/created_by_name/external_id 는 갱신 범위 밖(소유권·멱등키 불변).
  // meeting_id 는 필드가 전송된 경우에만 갱신(부재=유지, null=해제 — v2.2) — 또박또박 v1은
  // 미전송이 기본이라 무조건 갱신하면 수동 연결분(E4)의 프로젝트 연관이 소리 없이 끊긴다.
  const nowIso = new Date().toISOString()
  const patch: Record<string, unknown> = {
    minute_date: p.minuteDate, team_code: p.teamCode, title: p.title,
    body_md: p.bodyMd, updated_at: nowIso,
  }
  if (p.meetingIdProvided) patch.meeting_id = p.meetingId
  const { data: updated, error } = await admin.from('minutes').update(patch)
    .eq('id', existing.id).select('id, created_at, updated_at').single()
  if (error || !updated) {
    console.error('[minutes-api] replace 갱신 실패:', error?.message ?? 'no row')
    return apiInternalError()
  }
  after(async () => { await runMinutePostProcessing(existing.id, p.bodyMd, { rematch: true }) })
  return respondMinute(req, 200, {
    id: existing.id, action: 'replaced', title: p.title, date: p.minuteDate,
    team: p.teamCode, meetingId: p.meetingIdProvided ? p.meetingId : existing.meeting_id,
    externalId: p.externalId,
    createdByName: existing.created_by_name,
    createdAt: (updated.created_at as string | null) ?? existing.created_at,
    updatedAt: (updated.updated_at as string | null) ?? nowIso,
  })
}

async function insertNew(
  req: NextRequest, admin: AdminClient, p: ExternalMinutePayload, user: ResolvedUser,
): Promise<NextResponse> {
  const { data, error } = await admin.from('minutes').insert({
    minute_date: p.minuteDate, team_code: p.teamCode, title: p.title, body_md: p.bodyMd,
    meeting_id: p.meetingId, external_id: p.externalId,
    created_by: user.id, created_by_name: user.name,
  }).select('id, created_at, updated_at').single()
  if (error || !data) {
    // 동시 전송 경합: 부분 unique 인덱스 위반(23505)이면 그 사이 생긴 레코드 기준으로 재분기.
    if (error?.code === '23505') {
      const { data: raced, error: reErr } = await admin.from('minutes')
        .select(MINUTE_SELECT).eq('external_id', p.externalId).maybeSingle()
      if (!reErr && raced) return handleExisting(req, admin, p, raced as ExistingRow)
    }
    console.error('[minutes-api] insert 실패:', error?.message ?? 'no row')
    return apiInternalError()
  }
  after(async () => { await runMinutePostProcessing(data.id as string, p.bodyMd, { rematch: false }) })
  return respondMinute(req, 201, {
    id: data.id as string, action: 'created', title: p.title, date: p.minuteDate,
    team: p.teamCode, meetingId: p.meetingId, externalId: p.externalId,
    createdByName: user.name,
    createdAt: data.created_at as string, updatedAt: data.updated_at as string,
  })
}

export async function POST(req: NextRequest) {
  const gate = gateMinutesApi(req)
  if (gate) return gate

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return apiBadRequest('잘못된 요청입니다.')
  }
  const userEmail = parseUserEmail(raw)
  if (!userEmail) return apiBadRequest('user_email이 필요합니다.')

  try {
    const admin = createAdminClient()
    const user = await resolveUserByEmail(admin, userEmail)
    if (!user) return apiFail(403, 'unknown_user', "해당 이메일의 D'Flow 사용자가 없습니다.")

    const parsed = parseMinutePayload(raw)
    if ('error' in parsed) return apiBadRequest(parsed.error)
    const p = parsed.payload

    if (p.meetingId) {
      const { data: mt, error: mtErr } = await admin.from('meetings')
        .select('id').eq('id', p.meetingId).maybeSingle()
      // 쓰기 선행조회 실패를 '회의 없음'으로 오인하면 정상 요청이 400으로 거짓 거절된다 — 실패는 실패로.
      if (mtErr) { console.error('[minutes-api] 회의 존재 확인 실패:', mtErr.message); return apiInternalError() }
      if (!mt) return apiBadRequest('연결할 회의를 찾을 수 없습니다.')
    }

    // upsert 는 사전 select 후 insert/update 분기 — DB ON CONFLICT 구문은 부분 unique 인덱스가
    // conflict 대상 추론에 매칭되지 않아 42P10 으로 실패한다(계약 §12 주의).
    const { data: existing, error: selErr } = await admin.from('minutes')
      .select(MINUTE_SELECT).eq('external_id', p.externalId).maybeSingle()
    if (selErr) { console.error('[minutes-api] 기존 레코드 조회 실패:', selErr.message); return apiInternalError() }

    if (existing) return await handleExisting(req, admin, p, existing as ExistingRow)
    return await insertNew(req, admin, p, user)
  } catch (e) {
    console.error('[minutes-api] POST 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

function clampInt(v: string | null, min: number, max: number, def: number): number {
  const n = v === null ? Number.NaN : Number.parseInt(v, 10)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, n))
}

export async function GET(req: NextRequest) {
  const gate = gateMinutesApi(req)
  if (gate) return gate

  const sp = req.nextUrl.searchParams
  const team = sp.get('team')
  if (team && !(TEAM_CODES as string[]).includes(team)) return apiBadRequest('잘못된 담당입니다.')
  const dateFrom = sp.get('date_from')
  const dateTo = sp.get('date_to')
  if ((dateFrom && !DATE_RE.test(dateFrom)) || (dateTo && !DATE_RE.test(dateTo))) {
    return apiBadRequest('날짜 형식이 올바르지 않습니다.')
  }
  const linked = sp.get('linked')
  if (linked && linked !== 'true' && linked !== 'false') return apiBadRequest('linked는 true 또는 false여야 합니다.')
  const page = clampInt(sp.get('page'), 1, Number.MAX_SAFE_INTEGER, 1)
  const perPage = clampInt(sp.get('per_page'), 1, 100, 20)

  try {
    const admin = createAdminClient()
    let q = admin.from('minutes').select(
      'id, minute_date, team_code, title, external_id, created_by_name, created_at, updated_at',
      { count: 'exact' },
    )
    const externalId = sp.get('external_id')
    if (externalId) q = q.eq('external_id', externalId)
    if (linked === 'true') q = q.not('external_id', 'is', null)
    if (linked === 'false') q = q.is('external_id', null)
    if (team) q = q.eq('team_code', team)
    if (dateFrom) q = q.gte('minute_date', dateFrom)
    if (dateTo) q = q.lte('minute_date', dateTo)

    const offset = (page - 1) * perPage
    const { data, error, count } = await q
      .order('minute_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + perPage - 1)
    if (error) {
      // 범위 초과 페이지는 PostgREST 가 416(PGRST103)을 에러로 넘긴다 — 정상 순회의 일부이므로
      // 같은 필터의 head 카운트로 total 만 채워 빈 페이지로 응답한다(500 아님).
      if (error.code === 'PGRST103') {
        let cq = admin.from('minutes').select('id', { count: 'exact', head: true })
        if (externalId) cq = cq.eq('external_id', externalId)
        if (linked === 'true') cq = cq.not('external_id', 'is', null)
        if (linked === 'false') cq = cq.is('external_id', null)
        if (team) cq = cq.eq('team_code', team)
        if (dateFrom) cq = cq.gte('minute_date', dateFrom)
        if (dateTo) cq = cq.lte('minute_date', dateTo)
        const { count: totalCount, error: cntErr } = await cq
        if (!cntErr) return NextResponse.json({ items: [], total: totalCount ?? 0, page, per_page: perPage })
      }
      console.error('[minutes-api] 목록 조회 실패:', error.message)
      return apiInternalError()
    }

    // 본문(body_md) 제외 — 연결 후보 화면용 최소 집합(계약 §5.1)
    const items = ((data ?? []) as Record<string, unknown>[]).map(row => ({
      id: row.id as string,
      title: row.title as string,
      date: row.minute_date as string,
      team: row.team_code as string,
      external_id: (row.external_id as string | null) ?? null,
      created_by_name: (row.created_by_name as string | null) ?? null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      url: `${req.nextUrl.origin}/minutes/${row.id as string}`,
    }))
    return NextResponse.json({ items, total: count ?? 0, page, per_page: perPage })
  } catch (e) {
    console.error('[minutes-api] GET 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

// 미정의 메서드도 404 — 405 + Allow 응답이 비활성 라우트의 존재를 노출하지 않게(§3.4 존재 은닉 보강).
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
