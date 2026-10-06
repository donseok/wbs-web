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
 * 키 입력 행(input_kind='keys', 0111)은 claim 이 기본으로 집지 않는다 — 요청 본문에 `accepts:['keys']` 가 있을 때만 p_accept_keys=true 를
 * 인자로 실어 집는다(없으면 인자를 싣지 않는다). 키 행을 모르는 옛 폴러는 키 행을 받지 못하고(그 행은 pending 으로 남아 60초 뒤 만료), 사람이 읽는 표기(`키: 1 Enter`)가
 * 글 프롬프트로 입력창에 들어가는 일이 없다. 키 행 응답은 `kind:'keys'`·`keys`·`input_request{kind,since,sha}` 를 싣고 text 는 싣지 않는다.
 * 글 행의 모양은 그대로다.
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
    // accepts 에 keys 가 없으면 p_accept_keys 인자를 아예 싣지 않는다 — 옛 3인자 호출과 같은 모양이라, 코드만 먼저 배포되거나 DB 만
    // 0111 이전으로 롤백돼도 글 프롬프트 전달은 멈추지 않는다(키 행을 모르는 폴러는 어차피 키 행을 받지 않는다).
    const { data, error } = await admin.rpc('agent_console_claim', {
      p_owner: owner, p_host: body.host, p_token_hashes: tokens.map(hashClaimToken), ...(acceptsKeys ? { p_accept_keys: true } : {}),
    })
    if (error) { console.error('[agent-api] console poll 실패:', error.message); return apiInternalError() }
    // 돌려받는 행의 순서는 정해지지 않았다 — token_index 가 오래된 순 번호다.
    const rows = ((data ?? []) as ClaimRow[]).slice().sort((a, b) => a.token_index - b.token_index)
    const prompts: Array<Record<string, unknown>> = []
    for (const r of rows) {
      const common = { id: r.id, target_kind: r.target_kind, target_ref: r.target_ref, claim_token: tokens[r.token_index - 1], expires_at: r.expires_at }
      if (r.input_kind !== 'keys') { prompts.push({ ...common, text: r.text }); continue }
      // 응답을 만들 때 한 번 더 검사한다(DB CHECK 가 이미 보장 — 깨진 행이 있어도 키를 내보내지 않는다). 집힌 뒤라 claimed 로 남아 120초 뒤 unknown 이 된다.
      const keys = parseConsoleKeys(r.keys)
      const sinceMs = r.req_since === null ? NaN : Date.parse(r.req_since)
      if (!acceptsKeys || !keys || r.req_kind === null || r.req_sha === null || Number.isNaN(sinceMs)) {
        console.error('[agent-api] console poll 키 행 이상:', r.id)
        continue
      }
      prompts.push({ ...common, kind: 'keys', keys, input_request: { kind: r.req_kind, since: new Date(sinceMs).toISOString(), sha: r.req_sha } })
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
