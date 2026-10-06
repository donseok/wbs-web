import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const dir = join(process.cwd(), 'supabase/migrations/')
const UP_PATH = join(dir, '0111_agent_console_keys.sql')
const DOWN_PATH = join(dir, '0111_agent_console_keys_rollback.sql')
const BASE_PATH = join(dir, '0109_agent_console.sql')
const up = readFileSync(UP_PATH, 'utf8')
const down = readFileSync(DOWN_PATH, 'utf8')
/** 공백을 하나로 접은 본문 — 줄바꿈·들여쓰기가 바뀌어도 검사가 깨지지 않게. */
const flat = up.replace(/\s+/g, ' ')
const flatDown = down.replace(/\s+/g, ' ')

const ALLOWED = "'1', '2', '3', '4', '5', '6', '7', '8', '9', 'Enter', 'Esc', 'Up', 'Down', 'Tab'"
const ENQ_KEYS = 'agent_console_enqueue_keys(uuid, text, text, text, text[], text, timestamptz, text)'

describe('0111 — 콘솔 키 입력 정적 검사', () => {
  it('열 다섯 개를 더하고 기존 행은 text 행이 된다', () => {
    expect(flat).toContain("add column if not exists input_kind text not null default 'text'")
    for (const c of ['keys text[]', 'req_kind text', 'req_since timestamptz', 'req_sha text']) expect(flat).toContain(c)
    expect(flat).toContain("check (input_kind in ('text', 'keys'))")
    expect(flat).toContain("req_sha ~ '^[0-9a-f]{64}$'")
  })
  it('행 모양 제약: keys 행은 키 1~4개·허용 목록·req_* 세 칸 모두, text 행은 모두 null', () => {
    expect(flat).toContain("input_kind = 'text' and keys is null and req_kind is null and req_since is null and req_sha is null")
    expect(flat).toContain("input_kind = 'keys' and keys is not null and array_ndims(keys) = 1 and cardinality(keys) between 1 and 4")
    expect(flat).toContain(`keys <@ array[${ALLOWED}]::text[]`)
    expect(flat).toContain('req_kind is not null and req_since is not null and req_sha is not null')
  })
  it('키 순서 규칙: Up·Down 0~3개 + 마지막 한 개(Tab·확정 포함)를 쉼표로 이은 문자열 정규식 — 표 제약과 함수에 같다', () => {
    const re = "'^((Up|Down),){0,3}(Up|Down|Tab|[1-9]|Enter|Esc)$'"
    expect(flat).toContain(`array_to_string(keys, ',') ~ ${re}`)
    expect(flat).toContain(`array_to_string(p_keys, ',') !~ ${re}`)
    // 구분자 쉼표는 키 이름에 없다(허용 목록 검사가 쉼표가 든 원소를 먼저 막는다)
    expect(ALLOWED).not.toContain(',Enter')
    for (const k of ALLOWED.replace(/'/g, '').split(', ')) expect(k).not.toContain(',')
  })
  it('허용 키 목록은 함수 안에도 같다(도메인 CONSOLE_KEYS 와 일치)', () => {
    expect(flat.split(`array[${ALLOWED}]::text[]`)).toHaveLength(3) // 제약 + 함수
  })
  it('reason 제약과 ack 허용 목록에 prompt_changed 를 더하고 기존 값은 유지하며, refused 와만 쓴다', () => {
    const reasons = "'compacting', 'stale', 'target-not-found', 'ambiguous', 'bang-in-text', 'prompt-open', 'draft-in-input', 'error', 'prompt_changed'"
    expect(flat.split(reasons)).toHaveLength(3) // 제약 + ack 함수
    expect(flat).toContain("p_reason = 'prompt_changed' and p_result <> 'refused'")
    expect(flat).toContain("p_reason <> 'compacting'")
  })
  it('재전송 방지: 함수 안 검사와 부분 유니크 인덱스, 거절·만료는 풀린다', () => {
    expect(flat).toContain('create unique index if not exists agent_console_prompts_keys_once_idx')
    expect(flat).toContain('(owner, host, target_kind, target_ref, req_since, req_sha)')
    expect(flat).toContain("where input_kind = 'keys' and status in ('pending', 'claimed', 'sent', 'unknown')")
    expect(flat).toContain("p.input_kind = 'keys' and p.req_since = p_req_since and p.req_sha = p_req_sha and p.status in ('pending', 'claimed', 'sent', 'unknown')")
    expect(flat).toContain("'already_sent'::text")
    expect(flat).toContain('exception when unique_violation')
  })
  it('enqueue_keys: 한도는 기존과 같고 만료만 60초, 대상은 coord_lane 뿐, 입력 요청 종류는 셋만', () => {
    expect(flat).toMatch(/interval '1 minute'\) >= 5\b/)
    expect(flat).toMatch(/status in \('pending', 'claimed'\)\) >= 3\b/)
    expect(flat).toContain("now() + interval '60 seconds'")
    expect(flat).not.toContain("interval '10 minutes'")
    expect(flat).toContain("p_kind is distinct from 'coord_lane'")
    expect(flat).toContain("p_req_kind not in ('permission', 'question', 'choice')")
    expect(flat).toContain("pg_advisory_xact_lock(hashtextextended('agent_console:' || p_owner::text, 0))")
    expect(flat).toContain("'키: ' || array_to_string(p_keys, ' ')")
  })
  it('claim: 인자 넷(p_accept_keys 기본 false), 글 행만 기본으로 집고 키 행은 accept 일 때만', () => {
    expect(flat).toContain('p_owner uuid, p_host text, p_token_hashes text[], p_accept_keys boolean default false')
    expect(flat).toContain("and (p.input_kind = 'text' or coalesce(p_accept_keys, false))")
    expect(flat).toContain('drop function if exists public.agent_console_claim(uuid, text, text[]);')
    expect(flat).toContain('drop function if exists public.agent_console_claim(uuid, text, text[], boolean);')
  })
  it('claim 은 지우고 다시 만들며 반환 표에 새 칸을 싣고, 새 서명에 권한을 다시 건다', () => {
    expect(flat).toContain('drop function if exists public.agent_console_claim(uuid, text, text[])')
    expect(flat).toContain('input_kind text, keys text[], req_kind text, req_since timestamptz, req_sha text)')
    for (const f of [ENQ_KEYS, 'agent_console_claim(uuid, text, text[], boolean)', 'agent_console_ack(uuid, uuid, text, text, text, text)']) {
      expect(flat).toContain(`revoke all on function public.${f} from public, anon, authenticated`)
      expect(flat).toContain(`grant execute on function public.${f} to service_role`)
    }
  })
  it('함수는 search_path 를 비워 고정한다(새 함수·claim·ack)', () => {
    expect(flat.match(/set search_path = ''/g)).toHaveLength(3)
  })
  it('정책은 두지 않는다 — 0109 의 RLS 설정 그대로', () => {
    expect(flat).not.toMatch(/create policy/i)
  })
  it('rollback: 키 행을 지우고 새 함수·인덱스·제약·열을 걷고 0109 의 claim·ack 정의로 되돌린다', () => {
    expect(flatDown).toContain('이 롤백은 코드(main)를 먼저 되돌린 뒤에 돌린다')
    expect(flatDown).toContain('begin; -- 롤백 중')
    expect(flatDown).toContain('lock table public.agent_console_prompts in access exclusive mode;')
    expect(flatDown.indexOf('lock table')).toBeLessThan(flatDown.indexOf("input_kind = 'keys'"))
    expect(flatDown).toContain('drop function if exists public.agent_console_claim(uuid, text, text[], boolean);')
    expect(flatDown).toContain("input_kind = 'keys'")
    expect(flatDown).toContain("reason = 'prompt_changed'")
    expect(flatDown).toContain(`drop function if exists public.${ENQ_KEYS}`)
    expect(flatDown).toContain('drop index if exists public.agent_console_prompts_keys_once_idx')
    expect(flatDown).toContain('drop constraint if exists agent_console_prompts_input_shape')
    for (const c of ['req_sha', 'req_since', 'req_kind', 'keys', 'input_kind']) expect(flatDown).toContain(`drop column if exists ${c}`)
    expect(flatDown).toContain("returns table (id uuid, target_kind text, target_ref text, text text, expires_at timestamptz, token_index integer) language")
    expect(flatDown).not.toContain('prompt_changed\')') // 사유 목록에서 빠진다
    expect(flatDown.split("'draft-in-input', 'error'")).toHaveLength(3) // 제약 + ack 함수
  })
  it('rollback 의 claim·ack 본문은 0109 와 같다(함수 본문 비교)', () => {
    const base = readFileSync(BASE_PATH, 'utf8').replace(/\s+/g, ' ')
    const body = (src: string, name: string) => {
      const m = new RegExp(`create (?:or replace )?function public\\.${name}\\(`).exec(src)
      if (!m) return ''
      return src.slice(m.index, src.indexOf('end $$;', m.index) + 'end $$;'.length).replace(/^create or replace function/, 'create function')
    }
    expect(body(base, 'agent_console_claim')).not.toBe('')
    expect(body(flatDown, 'agent_console_claim')).toBe(body(base, 'agent_console_claim'))
    expect(body(flatDown, 'agent_console_ack')).toBe(body(base, 'agent_console_ack'))
  })
})

/**
 * 실제 Postgres 동작 시험 — TEST_PG_URL(슈퍼유저로 접속하는 로컬 서버, 예 postgres://postgres@127.0.0.1:55439/postgres)과
 * psql 이 있을 때만 돈다. 임시 데이터베이스를 만들어 바탕 → 0109 → 글 행 한 건 → 0111 두 번(멱등) → 시나리오 → rollback 두 번
 * → 0109 시나리오(글 행 동작이 그대로인지)를 돌린 뒤 지운다. 원격(스테이징·운영) 주소를 넣지 않는다.
 */
const PG = process.env.TEST_PG_URL
describe.skipIf(!PG)('0111 — 로컬 Postgres 동작', () => {
  const psql = (url: string, args: string[]) =>
    execFileSync('psql', [url, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  it('적용 두 번 · 시나리오 · rollback 두 번 · 0109 시나리오', () => {
    const db = `t0111_${randomBytes(4).toString('hex')}`
    const url = new URL(PG!)
    url.pathname = `/${db}`
    const u = url.toString()
    psql(PG!, ['-c', `create database ${db}`])
    try {
      psql(u, ['-f', join(process.cwd(), 'tests/migrations/sql/supabase-base.sql')])
      psql(u, ['-f', BASE_PATH])
      psql(u, ['-c', "insert into public.agent_console_prompts (owner, host, target_kind, target_ref, text) values ('11111111-1111-1111-1111-111111111111','mbp','team_lead','lead','pre')"])
      psql(u, ['-f', UP_PATH])
      psql(u, ['-f', UP_PATH])
      expect(psql(u, ['-f', join(process.cwd(), 'tests/migrations/sql/0111-scenario.sql')])).toContain('SCENARIO_OK')
      psql(u, ['-f', DOWN_PATH])
      psql(u, ['-f', DOWN_PATH])
      expect(psql(u, ['-c', "select count(*) from information_schema.columns where table_name = 'agent_console_prompts' and column_name in ('input_kind','keys','req_kind','req_since','req_sha')"]).trim()).toBe('0')
      expect(psql(u, ['-c', "select count(*) from pg_proc where proname = 'agent_console_enqueue_keys'"]).trim()).toBe('0')
      // 되돌린 뒤 0109 의 동작이 그대로다 — 시나리오는 빈 대기열을 전제하므로 글 행을 비운다.
      psql(u, ['-c', 'delete from public.agent_console_prompts'])
      expect(psql(u, ['-f', join(process.cwd(), 'tests/migrations/sql/0109-scenario.sql')])).toContain('SCENARIO_OK')
    } finally {
      psql(PG!, ['-c', `drop database if exists ${db} with (force)`])
    }
  }, 60_000)
})
