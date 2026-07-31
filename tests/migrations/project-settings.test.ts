import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/0058_project_settings.sql', 'utf8')
const rollback = readFileSync('supabase/migrations/0058_project_settings_rollback.sql', 'utf8')

describe('0058 project_settings 계약', () => {
  it('멱등·트랜잭션', () => {
    expect(sql).toMatch(/^begin;/m)
    expect(sql).toMatch(/^commit;/m)
    expect(sql).toContain('create table if not exists public.project_settings')
  })

  it('현행 재현 시드 — 회귀 0 의 근거', () => {
    expect(sql).toContain("array['Phase','Task','Activity']")
    expect(sql).toContain('on conflict (project_id) do nothing')
    expect(sql).toContain("'legacy-dcube'")
  })

  it('기본값 3종 고정', () => {
    expect(sql).toContain("default array['Phase','Task','Activity']")
    expect(sql).toContain("default '{}'::jsonb")
    expect(sql).toContain("default array[]::text[]")
  })

  it('쓰기 정책 없음 + 하드닝', () => {
    expect(sql).not.toMatch(/for (insert|update|delete)/)
    expect(sql).toContain('revoke all on table public.project_settings')
    expect(sql).toContain('grant select on table public.project_settings to authenticated')
    expect(sql).toContain('grant all on table public.project_settings to service_role')
  })

  it('롤백은 신규 테이블만', () => {
    expect(rollback).toContain('drop table if exists public.project_settings')
    expect(rollback).not.toContain('alter table')
  })
})
