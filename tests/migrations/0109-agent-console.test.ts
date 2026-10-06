import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const dir = join(process.cwd(), 'supabase/migrations/')
const UP_PATH = join(dir, '0109_agent_console.sql')
const DOWN_PATH = join(dir, '0109_agent_console_rollback.sql')
const up = readFileSync(UP_PATH, 'utf8')
const down = readFileSync(DOWN_PATH, 'utf8')
/** 공백을 하나로 접은 본문 — 줄바꿈·들여쓰기가 바뀌어도 검사가 깨지지 않게. */
const flat = up.replace(/\s+/g, ' ')

const FNS = [
  'agent_console_sweep(uuid)',
  'agent_console_enqueue(uuid, text, text, text, text)',
  'agent_console_claim(uuid, text, text[])',
  'agent_console_ack(uuid, uuid, text, text, text, text)',
]

describe('0109 — 에이전트 콘솔(계약 §2.12) 정적 검사', () => {
  it('두 테이블을 만들고 RLS 를 켜되 정책은 두지 않으며, 기본 테이블 권한도 거둔다(0095 선례)', () => {
    expect(flat).toContain('create table if not exists public.agent_console_prompts')
    expect(flat).toContain('create table if not exists public.agent_console_screens')
    expect(flat).toContain('alter table public.agent_console_prompts enable row level security')
    expect(flat).toContain('alter table public.agent_console_screens enable row level security')
    expect(flat).not.toMatch(/create policy/i)
    expect(flat).toContain('revoke all on table public.agent_console_prompts from public, anon, authenticated')
    expect(flat).toContain('revoke all on table public.agent_console_screens from public, anon, authenticated')
  })
  it('claim 토큰은 원문이 아니라 sha256 hex 만 둔다', () => {
    expect(flat).toContain('claim_token_hash text')
    expect(flat).not.toMatch(/\bclaim_token\s+text/)
  })
  it('함수는 search_path 를 비워 고정하고, 실행은 service_role 에게만 연다', () => {
    expect(flat.match(/set search_path = ''/g)).toHaveLength(FNS.length)
    for (const f of FNS) {
      expect(flat).toContain(`revoke all on function public.${f} from public, anon, authenticated`)
      expect(flat).toContain(`grant execute on function public.${f} to service_role`)
    }
  })
  // 계약 상수 — 로컬 Postgres 가 없는 기본 실행에서도 값이 바뀌면 잡히도록 본문에서 직접 본다(동작은 아래 Postgres 시험이 본다).
  it('계약 상수: 만료 10분 · 응답 창 120초 · 1분 5건 · 대상당 3건 · 2000자·느낌표 · 7일 정리', () => {
    expect(flat).toContain("expires_at timestamptz not null default now() + interval '10 minutes'")
    expect(flat.match(/interval '120 seconds'/g)?.length).toBeGreaterThanOrEqual(1)
    expect(flat).toMatch(/interval '1 minute'\) >= 5\b/)
    expect(flat).toMatch(/status in \('pending', 'claimed'\)\) >= 3\b/)
    expect(flat).toContain("char_length(text) between 1 and 2000 and position('!' in text) = 0")
    expect(flat).toContain("interval '7 days'")
    expect(flat).toContain('cardinality(lines) <= 40')
    expect(flat).toContain('<= 8192')
  })
  it('계약 목록: 대상 종류 · 상태 · 사유 8개 · detail 3개', () => {
    expect(flat.match(/'coord_lead', 'coord_lane', 'team_lead', 'team_worker'/g)).toHaveLength(2)
    expect(flat).toContain("status in ('pending', 'claimed', 'sent', 'refused', 'expired', 'unknown')")
    const reasons = "'compacting', 'stale', 'target-not-found', 'ambiguous', 'bang-in-text', 'prompt-open', 'draft-in-input', 'error'"
    expect(flat.split(reasons)).toHaveLength(3) // 테이블 검사 + ack 함수
    expect(flat).toContain("'turn_started', 'submitted', 'accepted'")
    expect(flat).toContain("p_reason <> 'compacting'")
  })
  it('rollback 은 함수 넷과 테이블 둘을 지운다', () => {
    for (const f of FNS) expect(down).toContain(`drop function if exists public.${f}`)
    expect(down).toContain('drop table if exists public.agent_console_screens')
    expect(down).toContain('drop table if exists public.agent_console_prompts')
  })
})

/**
 * 실제 Postgres 동작 시험 — TEST_PG_URL(슈퍼유저로 접속하는 로컬 서버, 예 postgres://postgres@127.0.0.1:55439/postgres)과
 * psql 이 있을 때만 돈다. 임시 데이터베이스를 만들어 바탕 → 0109 두 번(멱등) → 시나리오(기대와 다르면 예외) → rollback → 객체 0개를
 * 확인하고 지운다. 원격(스테이징·운영) 주소를 넣지 않는다 — 데이터베이스를 만들고 지운다.
 */
const PG = process.env.TEST_PG_URL
describe.skipIf(!PG)('0109 — 로컬 Postgres 동작', () => {
  const psql = (url: string, args: string[]) =>
    execFileSync('psql', [url, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  it('적용 두 번 · 시나리오 · rollback 뒤 객체 0개', () => {
    const db = `t0109_${randomBytes(4).toString('hex')}`
    const url = new URL(PG!)
    url.pathname = `/${db}`
    psql(PG!, ['-c', `create database ${db}`])
    try {
      psql(url.toString(), ['-f', join(process.cwd(), 'tests/migrations/sql/supabase-base.sql')])
      psql(url.toString(), ['-f', UP_PATH])
      psql(url.toString(), ['-f', UP_PATH])
      expect(psql(url.toString(), ['-f', join(process.cwd(), 'tests/migrations/sql/0109-scenario.sql')])).toContain('SCENARIO_OK')
      psql(url.toString(), ['-f', DOWN_PATH])
      expect(psql(url.toString(), ['-c', "select (select count(*) from pg_class where relname like 'agent_console%') + (select count(*) from pg_proc where proname like 'agent_console%')"]).trim()).toBe('0')
    } finally {
      psql(PG!, ['-c', `drop database if exists ${db} with (force)`])
    }
  }, 60_000)
})
