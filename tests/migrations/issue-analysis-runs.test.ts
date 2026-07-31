import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsDir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
const migration = readFileSync(`${migrationsDir}0056_issue_analysis_runs.sql`, 'utf8')
const rollback = readFileSync(`${migrationsDir}0056_issue_analysis_runs_rollback.sql`, 'utf8')

describe('0056 issue_analysis_runs', () => {
  it('입력 해시/프롬프트 버전 캐시와 hard-delete 감사 스냅샷을 보존한다', () => {
    expect(migration).toContain('input_hash text not null')
    expect(migration).toContain('prompt_version text not null')
    expect(migration).toContain('analysis_json jsonb not null')
    expect(migration).toContain('input_snapshot jsonb not null')
    expect(migration).toContain('issue_count integer not null')
    expect(migration).toContain('unique (project_id, input_hash, prompt_version)')
    expect(migration).toContain("check (input_hash ~ '^[0-9a-f]{64}$')")
  })

  it('프로젝트 멤버 read/service_role write 경계를 강제한다', () => {
    expect(migration).toContain('alter table public.issue_analysis_runs enable row level security')
    expect(migration).toContain('using (public.is_project_member(project_id))')
    expect(migration).toContain(
      'revoke all on table public.issue_analysis_runs from public, anon, authenticated',
    )
    expect(migration).toContain('grant select on table public.issue_analysis_runs to authenticated')
    expect(migration).toContain('grant all on table public.issue_analysis_runs to service_role')
    expect(migration).not.toMatch(/for\s+(insert|update|delete)\s+to\s+authenticated/i)
  })

  it('forward/rollback 모두 트랜잭션이며 롤백은 테이블 부재에도 멱등하다', () => {
    expect(migration).toMatch(/^--[\s\S]*\nbegin;/)
    expect(migration).toContain('set search_path = public, extensions')
    expect(migration.trimEnd()).toMatch(/commit;$/)
    expect(rollback).toContain('drop table if exists public.issue_analysis_runs')
    expect(rollback).not.toContain('drop policy')
    expect(rollback.trimEnd()).toMatch(/commit;$/)
  })
})
