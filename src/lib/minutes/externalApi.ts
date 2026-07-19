import { createHash, timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { displayNameFrom } from '@/lib/domain/display-name'
import { validateMinuteInput } from '@/lib/domain/minutes'
import { splitMinuteBlocks } from '@/lib/minutes/blocks'
import { rematchHighlights, type HighlightRow } from '@/lib/minutes/rematch'
import { ingestMinute } from '@/lib/ai/minutes-ingest'
import { generateMinuteInsights } from '@/lib/ai/minutes-insights'
import type { TeamCode } from '@/lib/domain/types'

/**
 * 회의록 외부 업로드 API(/api/v1/minutes*) 공용 유틸 — 또박또박 연동.
 * 계약: docs/design/dflow-minutes-upload-api-spec.md (§3 인증, §4 upsert, §6 에러 규격).
 * 이 경로는 세션 인증이 아니라 서버 시크릿 + user_email 매칭 2계층이며, DB 접근은 전부
 * service_role(createAdminClient)이다 — RLS insert_own_minutes 가 세션 없는 insert 를 막기 때문.
 */

export type AdminClient = ReturnType<typeof createAdminClient>

export const EXTERNAL_ID_MAX = 128
/** Vercel serverless 바디 한도(~4.5MB) 이내의 공표용 제한값 — meta 응답에 노출. */
export const MINUTES_API_MAX_REQUEST_BYTES = 4_194_304

/** D'Flow 자신의 uuid PK 참조(meeting_id·minute_id·project_id) 형식 검증 — 비형식은 DB에서
 *  22P02(500)가 되므로 계약 §6 '형식 오류=400'에 맞게 사전 거절한다. external_id는 불투명(§4.6) — 적용 금지. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/** env 2단 게이트 — 미설정이면 라우트 존재 자체를 숨긴다(404). worker route 관례. */
export function minutesApiEnabled(): boolean {
  return process.env.MINUTES_API_ENABLED === 'true' && !!process.env.MINUTES_API_SECRET
}

/** 시크릿 비교는 길이 노출·타이밍 채널을 피하기 위해 해시 후 상수시간으로 비교한다. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/** `Authorization: Bearer <MINUTES_API_SECRET>` 검증 — 계약 §3.2 (스펙이 401을 정의: worker 선례 403과 다른 신규 결정). */
export function verifyApiSecret(req: Request): boolean {
  const expected = process.env.MINUTES_API_SECRET
  if (!expected) return false
  const header = req.headers.get('authorization')
  const provided = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
  return secretMatches(provided, expected)
}

export const apiNotFound = () =>
  NextResponse.json({ error: 'Not Found' }, { status: 404 })
export const apiUnauthorized = () =>
  NextResponse.json({ error: '인증이 필요합니다.', code: 'unauthorized' }, { status: 401 })
export const apiBadRequest = (error: string) =>
  NextResponse.json({ error, code: 'validation_failed' }, { status: 400 })
export const apiFail = (status: number, code: string, error: string) =>
  NextResponse.json({ error, code }, { status })
export const apiInternalError = (error = '서버 오류가 발생했습니다.') =>
  NextResponse.json({ error, code: 'internal_error' }, { status: 500 })

/** 전 라우트 공통 선두 게이트 — 실패 시 응답, 통과 시 null. */
export function gateMinutesApi(req: Request): NextResponse | null {
  if (!minutesApiEnabled()) return apiNotFound()
  if (!verifyApiSecret(req)) return apiUnauthorized()
  return null
}

export interface ResolvedUser {
  id: string
  name: string | null
}

/**
 * user_email → D'Flow 계정 매칭 — 계약 §3.3. lower(trim()) 정규화(0019 관례),
 * deleted_at 계정 제외, listUsers 페이지 순회(actions/accounts.ts 관례).
 * 조회 실패는 '사용자 없음(403)'과 구별해야 하므로 throw(fail-loud) — 호출부가 500으로 변환.
 */
export async function resolveUserByEmail(admin: AdminClient, email: string): Promise<ResolvedUser | null> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null
  const perPage = 200
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error || !data) {
      throw new Error(`사용자 목록 조회 실패(page=${page}): ${error?.message ?? 'unknown'}`)
    }
    for (const u of data.users) {
      const deletedAt = (u as { deleted_at?: string | null }).deleted_at
      if (deletedAt) continue
      if ((u.email ?? '').toLowerCase() === normalized) {
        return { id: u.id, name: displayNameFrom(u.user_metadata, u.email) }
      }
    }
    if (data.users.length < perPage) return null
  }
}

/** 바디에서 user_email만 선추출 — 계약 §9.3 흐름(사용자 매칭 403이 필드 검증 400보다 먼저). */
export function parseUserEmail(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = (raw as Record<string, unknown>).user_email
  const email = typeof v === 'string' ? v.trim() : ''
  return email || null
}

export interface ExternalMinutePayload {
  minuteDate: string
  teamCode: TeamCode
  title: string
  bodyMd: string
  externalId: string
  meetingId: string | null
  /** §0 D3(v2.2): meeting_id 필드 부재=기존 값 유지, 명시적 null=해제 — replace 갱신 범위 판정용. */
  meetingIdProvided: boolean
  onConflict: 'replace' | 'skip' | 'error'
}

/**
 * POST /minutes 페이로드 검증 — 수동 타입가드(레포 관례) + validateMinuteInput 재사용.
 * §0 D4: 이 경로는 correctMinuteBodyTime(+9h)을 적용하지 않는다 — 또박또박이 이미 KST를
 * 보내므로 기존 UI 경로의 보정을 재사용하면 이중 보정으로 시간이 밀린다(§1.4).
 */
export function parseMinutePayload(raw: unknown): { payload: ExternalMinutePayload } | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: '잘못된 요청입니다.' }
  const b = raw as Record<string, unknown>

  const externalId = b.external_id
  if (typeof externalId !== 'string' || !externalId) return { error: 'external_id가 필요합니다.' }
  if (externalId.length > EXTERNAL_ID_MAX) return { error: `external_id는 ${EXTERNAL_ID_MAX}자 이하여야 합니다.` }

  if (
    typeof b.date !== 'string' || typeof b.team !== 'string' ||
    typeof b.title !== 'string' || typeof b.body_markdown !== 'string'
  ) return { error: 'date, team, title, body_markdown은 필수입니다.' }

  let meetingId: string | null = null
  const meetingIdProvided = b.meeting_id !== undefined
  if (meetingIdProvided && b.meeting_id !== null) {
    if (typeof b.meeting_id !== 'string' || !isUuid(b.meeting_id)) return { error: 'meeting_id 형식이 올바르지 않습니다.' }
    meetingId = b.meeting_id
  }

  let onConflict: ExternalMinutePayload['onConflict'] = 'replace'
  if (b.on_conflict !== undefined) {
    if (b.on_conflict !== 'replace' && b.on_conflict !== 'skip' && b.on_conflict !== 'error') {
      return { error: 'on_conflict는 replace, skip, error 중 하나여야 합니다.' }
    }
    onConflict = b.on_conflict
  }

  const err = validateMinuteInput({
    minuteDate: b.date, teamCode: b.team as TeamCode, title: b.title, bodyMd: b.body_markdown, meetingId,
  })
  if (err) return { error: err }

  return {
    payload: {
      minuteDate: b.date, teamCode: b.team as TeamCode, title: b.title.trim(),
      bodyMd: b.body_markdown, externalId, meetingId, meetingIdProvided, onConflict,
    },
  }
}

/**
 * actions/minutes.ts rematchMinuteHighlights 의 복제 — 스펙 §9.2의 '복제' 선택지.
 * export 승격 대안은 기각: actions 파일은 'use server' 라 export 하는 순간 인증 검사 없는
 * 공개 Server Action 엔드포인트(service_role 로 minute_highlights delete/insert)가 된다.
 */
async function rematchExternalMinuteHighlights(minuteId: string, newBodyMd: string): Promise<void> {
  try {
    if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return
    const admin = createAdminClient()
    const { data: rows, error: rowsErr } = await admin.from('minute_highlights')
      .select('id, created_by, created_by_name, block_index, block_hash, created_at')
      .eq('minute_id', minuteId)
    if (rowsErr) { console.error('[minutes-api] 재매칭 대상 하이라이트 조회 실패:', rowsErr.message); return }
    if (!rows || rows.length === 0) return
    const { reinserts, deleteIds } = rematchHighlights(rows as unknown as HighlightRow[], splitMinuteBlocks(newBodyMd))
    if (deleteIds.length === 0 && reinserts.length === 0) return
    // delete 선실행 → insert — unique (minute_id, created_by, block_index) 충돌 원천 차단
    if (deleteIds.length) {
      const { error } = await admin.from('minute_highlights').delete().in('id', deleteIds)
      if (error) { console.error('[minutes-api] 재매칭 삭제 실패:', error.message); return }
    }
    if (reinserts.length) {
      const { error } = await admin.from('minute_highlights').insert(
        reinserts.map(r => ({ ...r, minute_id: minuteId })),
      )
      if (error) console.error('[minutes-api] 재매칭 삽입 실패:', error.message)
    }
  } catch (e) {
    console.error('[minutes-api] 재매칭 실패(무시):', e instanceof Error ? e.message : e)
  }
}

/**
 * 저장 후처리 파이프라인 — 계약 §4.5-7. 누락 시 검색·AI 챗·인사이트가 낡은 본문을 참조한다.
 * 신규: ingest → insights / replace: rematch → ingest → insights (actions/minutes.ts 순서 그대로).
 * 세 함수 모두 내부 try/catch 로 절대 throw 하지 않는 계약이라 순차 await 만 한다.
 */
export async function runMinutePostProcessing(
  minuteId: string, bodyMd: string, opts: { rematch: boolean },
): Promise<void> {
  if (opts.rematch) await rematchExternalMinuteHighlights(minuteId, bodyMd)
  await ingestMinute(minuteId, bodyMd)
  await generateMinuteInsights(minuteId, bodyMd)
}
