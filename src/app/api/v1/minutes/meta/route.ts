import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  MINUTE_ATTACHMENT_MAX, MINUTE_ATTACHMENTS_MAX_COUNT, MINUTE_BODY_MAX, TEAM_CODES,
} from '@/lib/domain/minutes'
import {
  apiBadRequest, apiInternalError, apiNotFound, gateMinutesApi, isUuid, MINUTES_API_MAX_REQUEST_BYTES,
} from '@/lib/minutes/externalApi'

/**
 * GET /api/v1/minutes/meta — 구분·프로젝트(·회의) 목록 + 제한값. 계약 §5.2.
 * 또박또박이 teams 를 최상위 폴더명 자동 판정 기준으로 쓰므로(§0 D10) 하드코딩 없이 이 응답을 추종한다.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = gateMinutesApi(req)
  if (gate) return gate

  const projectId = req.nextUrl.searchParams.get('project_id')
  if (projectId && !isUuid(projectId)) return apiBadRequest('project_id 형식이 올바르지 않습니다.')

  try {
    const admin = createAdminClient()
    const { data: projects, error } = await admin.from('projects').select('id, name').order('name')
    if (error) { console.error('[minutes-api] 프로젝트 목록 조회 실패:', error.message); return apiInternalError() }

    const body: Record<string, unknown> = {
      teams: TEAM_CODES,
      projects: projects ?? [],
      limits: {
        max_body_chars: MINUTE_BODY_MAX,
        max_request_bytes: MINUTES_API_MAX_REQUEST_BYTES,
        max_attachments: MINUTE_ATTACHMENTS_MAX_COUNT,
        max_attachment_bytes: MINUTE_ATTACHMENT_MAX,
      },
    }

    // 회의 목록은 프로젝트 종속 — project_id 지정 시에만 포함(계약 §5.2)
    if (projectId) {
      const { data: meetings, error: mErr } = await admin.from('meetings')
        .select('id, title, meeting_date').eq('project_id', projectId)
        .order('meeting_date', { ascending: false })
      if (mErr) { console.error('[minutes-api] 회의 목록 조회 실패:', mErr.message); return apiInternalError() }
      body.meetings = ((meetings ?? []) as Record<string, unknown>[]).map(m => ({
        id: m.id as string, title: m.title as string, date: m.meeting_date as string,
      }))
    }

    return NextResponse.json(body)
  } catch (e) {
    console.error('[minutes-api] meta 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

// 미정의 메서드도 404 — 405 + Allow 응답이 비활성 라우트의 존재를 노출하지 않게(§3.4 존재 은닉 보강).
export const POST = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
