import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiBadRequest, apiFail, apiInternalError } from '@/lib/agent/externalApi'
import { isUuidLike } from '@/lib/domain/agentWork'
import { consoleAckIssue } from '@/lib/domain/agentConsole'
import { apiNotFound, consoleCall, consoleQueueKinds, hashClaimToken, rpcInputError } from '../_shared'

/**
 * ack — 폴러가 집은 프롬프트의 결과를 돌려준다(계약 §2.12). sent·refused 는 최종, retry 는 만료 전이면 pending 으로 되돌린다.
 * 토큰 불일치·남의 행은 404(존재 비구분), claimed 가 아닌 행에 다른 결과는 409 conflict, 같은 결과를 다시 ack 하면 200 already.
 * 120초가 지난 claimed 는 함수가 먼저 unknown 으로 닫는다 — 늦은 ack 는 409 이고 되살리지 않는다.
 * 키 입력 행(0111)은 보내기 직전 재판정에서 입력 창이 바뀌었으면 보내지 않고 refused + reason prompt_changed 로 ack 한다
 * 프로젝트 한정 PAT 는 조정 세션 칸(프로젝트 없는 보조 대상) 행만 ack 한다.
 * (사유 검사는 consoleAckIssue 와 agent_console_ack 가 같은 규칙으로 한다 — prompt_changed 는 refused 와만).
 */
export const dynamic = 'force-dynamic'

const TOKEN_RE = /^[0-9a-f]{32}$/

export async function POST(req: NextRequest) {
  try {
    const admin = createAdminClient()
    const call = await consoleCall(req, admin)
    if (call instanceof NextResponse) return call
    const { owner, body } = call
    if (typeof body.id !== 'string' || !isUuidLike(body.id)) return apiBadRequest('id 형식이 올바르지 않습니다.')
    // 토큰 형식이 다르면 어떤 행과도 맞지 않는다 — 존재를 드러내지 않도록 404 로 답한다.
    if (typeof body.claim_token !== 'string' || !TOKEN_RE.test(body.claim_token)) {
      return apiFail(404, 'not_found', '프롬프트를 찾을 수 없습니다.')
    }
    // 프로젝트 한정 PAT 는 조정 세션 칸 행만 ack 한다 — 그 밖의 행(team 대상·없는 행)은 남의 행과 같이 404 로 존재를 드러내지 않는다.
    const queueKinds = consoleQueueKinds(call)
    if (queueKinds) {
      const { data: row, error: rowErr } = await admin.from('agent_console_prompts').select('target_kind').eq('id', body.id).eq('owner', owner).maybeSingle()
      if (rowErr) { console.error('[agent-api] console ack 대상 조회 실패:', rowErr.message); return apiInternalError() }
      if (!row || !(queueKinds as readonly string[]).includes((row as { target_kind: string }).target_kind)) {
        return apiFail(404, 'not_found', '프롬프트를 찾을 수 없습니다.')
      }
    }
    const issue = consoleAckIssue({ result: body.result, reason: body.reason, detail: body.detail })
    if (issue) return apiBadRequest(issue)
    const { data, error } = await admin.rpc('agent_console_ack', {
      p_owner: owner, p_id: body.id, p_token_hash: hashClaimToken(body.claim_token), p_result: body.result,
      p_reason: body.reason ?? null, p_detail: body.detail ?? null,
    })
    if (error) {
      const bad = rpcInputError(error, 'console ack')
      if (bad) return bad
      console.error('[agent-api] console ack 실패:', error.message)
      return apiInternalError()
    }
    const row = ((data ?? []) as Array<{ outcome: string; status: string | null }>)[0]
    switch (row?.outcome) {
      case 'ok': return NextResponse.json({ ok: true, status: row.status })
      case 'already': return NextResponse.json({ ok: true, status: row.status, already: true })
      case 'conflict': return apiFail(409, 'conflict', `이미 ${row.status} 상태입니다.`)
      case 'not_found': return apiFail(404, 'not_found', '프롬프트를 찾을 수 없습니다.')
      default:
        console.error('[agent-api] console ack 응답 이상:', JSON.stringify(data))
        return apiInternalError()
    }
  } catch (e) {
    console.error('[agent-api] console ack 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
