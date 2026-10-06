import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiBadRequest, apiInternalError } from '@/lib/agent/externalApi'
import { CONSOLE_HOST_RE, parseConsoleKeys } from '@/lib/domain/agentConsole'
import { apiNotFound, consoleCall, hashClaimToken, rejectProjectLimited } from '../_shared'

/**
 * poll — 폴러가 도는 PC(host)로 갈 이 사용자의 대기 프롬프트를 오래된 순으로 limit 건 claimed 로 바꿔 가져간다(계약 §2.12).
 * 같은 행을 두 폴러가 받을 수 없다(agent_console_claim: skip locked 한 문장). 부를 때마다 만료 pending → expired,
 * 120초 무응답 claimed → unknown 정리가 먼저 돈다. claim_token 은 응답에 한 번만 싣고 DB 에는 해시만 둔다.
 *
 * 키 입력 행(input_kind='keys', 0111)은 `kind:'keys'`·`keys`·`input_request{kind,since,sha}` 가 더 실린다. 글 행의 모양은 그대로다.
 * 키 행을 이해하는 폴러만 받는다 — 요청 본문에 `accepts:['keys']` 가 없으면(옛 폴러) 집힌 키 행을 서버가 곧바로 refused(error)로
 * 닫고 응답에서 뺀다. 옛 폴러가 사람이 읽는 표기(`키: 1 Enter`)를 글 프롬프트로 입력창에 넣는 일을 막는다.
 */
export const dynamic = 'force-dynamic'

const LIMIT_DEFAULT = 5
const LIMIT_MAX = 10

const ACCEPTS_MAX = 10

type ClaimRow = {
  id: string; target_kind: string; target_ref: string; text: string; expires_at: string; token_index: number
  input_kind: string; keys: string[] | null; req_kind: string | null; req_since: string | null; req_sha: string | null
}

export async function POST(req: NextRequest) {
  try {
    const admin = createAdminClient()
    const call = await consoleCall(req, admin)
    if (call instanceof NextResponse) return call
    const limited = rejectProjectLimited(call)
    if (limited) return limited
    const { owner, body } = call
    if (typeof body.host !== 'string' || !CONSOLE_HOST_RE.test(body.host)) return apiBadRequest('host 는 PC 슬러그([a-z0-9-])여야 합니다.')
    const limit = body.limit === undefined || body.limit === null ? LIMIT_DEFAULT : body.limit
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > LIMIT_MAX) {
      return apiBadRequest(`limit 은 1~${LIMIT_MAX} 정수여야 합니다.`)
    }
    const accepts = body.accepts === undefined || body.accepts === null ? [] : body.accepts
    if (!Array.isArray(accepts) || accepts.length > ACCEPTS_MAX || accepts.some(a => typeof a !== 'string')) {
      return apiBadRequest(`accepts 는 문자열 ${ACCEPTS_MAX}개 이하 배열이어야 합니다.`)
    }
    const acceptsKeys = accepts.includes('keys')
    // 128비트 무작위 토큰을 limit 개 만들고 해시만 넘긴다 — 함수가 행마다 token_index(1부터)로 짝을 돌려준다.
    const tokens = Array.from({ length: limit }, () => randomBytes(16).toString('hex'))
    const { data, error } = await admin.rpc('agent_console_claim', {
      p_owner: owner, p_host: body.host, p_token_hashes: tokens.map(hashClaimToken),
    })
    if (error) { console.error('[agent-api] console poll 실패:', error.message); return apiInternalError() }
    // 돌려받는 행의 순서는 정해지지 않았다 — token_index 가 오래된 순 번호다.
    const rows = ((data ?? []) as ClaimRow[]).slice().sort((a, b) => a.token_index - b.token_index)
    const prompts: Array<Record<string, unknown>> = []
    for (const r of rows) {
      const base = {
        id: r.id, target_kind: r.target_kind, target_ref: r.target_ref, text: r.text,
        claim_token: tokens[r.token_index - 1], expires_at: r.expires_at,
      }
      if (r.input_kind !== 'keys') { prompts.push(base); continue }
      const keys = parseConsoleKeys(r.keys)
      const sinceMs = r.req_since === null ? NaN : Date.parse(r.req_since)
      if (acceptsKeys && keys && r.req_kind !== null && r.req_sha !== null && !Number.isNaN(sinceMs)) {
        prompts.push({ ...base, kind: 'keys', keys, input_request: { kind: r.req_kind, since: new Date(sinceMs).toISOString(), sha: r.req_sha } })
        continue
      }
      // 키 행을 이해하지 못하는 폴러이거나 행이 깨졌다 — 보내지 않고 닫는다(error 로 거절).
      const { error: refuseErr } = await admin.rpc('agent_console_ack', {
        p_owner: owner, p_id: r.id, p_token_hash: hashClaimToken(tokens[r.token_index - 1]),
        p_result: 'refused', p_reason: 'error', p_detail: null,
      })
      if (refuseErr) console.error('[agent-api] console poll 키 행 거절 실패:', refuseErr.message)
    }
    return NextResponse.json({ ok: true, prompts })
  } catch (e) {
    console.error('[agent-api] console poll 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
