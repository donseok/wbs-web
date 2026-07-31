import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsDir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
const migration = readFileSync(`${migrationsDir}0057_agent_work_loop.sql`, 'utf8')
const rollback = readFileSync(`${migrationsDir}0057_agent_work_loop_rollback.sql`, 'utf8')

describe('0057 agent_work_loop', () => {
  it('신규 테이블 3개를 추가 전용(if not exists)으로 만든다', () => {
    expect(migration).toContain('create table if not exists public.agent_projects')
    expect(migration).toContain('create table if not exists public.agent_work_orders')
    expect(migration).toContain('create table if not exists public.agent_work_reports')
    expect((migration.match(/create table if not exists/g) ?? []).length).toBe(3)
  })

  it('항목 삭제 후에도 원장을 보존한다 — cascade 가 아니라 set null', () => {
    expect(migration).toMatch(/wbs_item_id uuid references public\.wbs_items\(id\) on delete set null/)
  })

  it('status CHECK 에 rejected 상태가 없다 — 반려는 review_action 으로만 표현', () => {
    const statusCheck = migration.match(/status text not null default 'ready'\s*\n\s*check \(status in \(([^)]+)\)\)/)
    expect(statusCheck).not.toBeNull()
    expect(statusCheck?.[1]).not.toContain('rejected')
    expect(migration).not.toContain("'rejected'")
  })

  it('percent CHECK 0~100', () => {
    expect(migration).toContain('percent int not null check (percent between 0 and 100)')
  })

  it('쓰기 정책은 만들지 않는다 — select 정책 3개만 존재', () => {
    expect(migration).not.toMatch(/for\s+(insert|update|delete)\s+to\s+authenticated/i)
    expect((migration.match(/for select to authenticated/gi) ?? []).length).toBe(3)
  })

  it('테이블 3개 모두 revoke/grant 3세트 — 클라이언트는 select 만, 쓰기는 service_role 전용', () => {
    expect((migration.match(/revoke all on table public\.\w+ from public, anon, authenticated/g) ?? []).length).toBe(3)
    expect((migration.match(/grant select on table public\.\w+ to authenticated/g) ?? []).length).toBe(3)
    expect((migration.match(/grant all on table public\.\w+ to service_role/g) ?? []).length).toBe(3)
  })

  it('forward/rollback 모두 트랜잭션이다', () => {
    expect(migration).toMatch(/^--[\s\S]*\nbegin;/)
    expect(migration).toContain('set search_path = public, extensions')
    expect(migration.trimEnd()).toMatch(/commit;$/)
    expect(rollback).toMatch(/^--[\s\S]*\nbegin;/)
    expect(rollback.trimEnd()).toMatch(/commit;$/)
  })

  it('롤백은 정책 없이 테이블만, 생성 역순(자식 → 부모)으로 제거한다', () => {
    expect(rollback).not.toContain('drop policy')
    const posReports = rollback.indexOf('drop table if exists public.agent_work_reports')
    const posOrders = rollback.indexOf('drop table if exists public.agent_work_orders')
    const posProjects = rollback.indexOf('drop table if exists public.agent_projects')
    expect(posReports).toBeGreaterThanOrEqual(0)
    expect(posOrders).toBeGreaterThan(posReports)
    expect(posProjects).toBeGreaterThan(posOrders)
  })
})
