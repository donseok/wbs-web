import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsDir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
const sql = readFileSync(`${migrationsDir}0078_agent_runners.sql`, 'utf8')
const rollback = readFileSync(`${migrationsDir}0078_agent_runners_rollback.sql`, 'utf8')

describe('0078 agent_runners', () => {
  it('테이블·핵심 컬럼·제약이 선언된다', () => {
    expect(sql).toContain('create table if not exists public.agent_runners')
    expect(sql).toMatch(/kind text not null default 'user_pat'\s+check \(kind in \('user_pat','runner'\)\)/)
    expect(sql).toContain('owner_user_id uuid not null references auth.users(id) on delete cascade')
    expect(sql).toContain('token_prefix text not null unique')
    expect(sql).toContain('token_hash text not null')
    expect(sql).toMatch(/scopes text\[\] not null default '\{work:read\}'/)
    expect(sql).toContain('expires_at timestamptz not null')
    expect(sql).toContain('unique (owner_user_id, name)')
  })
  it('RLS 켜고 authenticated 접근을 전면 차단한다(token_hash 비노출)', () => {
    expect(sql).toContain('alter table public.agent_runners enable row level security')
    expect(sql).not.toMatch(/create policy .* on public\.agent_runners/)
    expect(sql).toContain('revoke all on table public.agent_runners from public, anon, authenticated')
    expect(sql).toContain('grant all on table public.agent_runners to service_role')
    expect(sql).not.toContain('grant select on table public.agent_runners to authenticated')
  })
  it('rollback이 테이블을 제거한다', () => {
    expect(rollback).toContain('drop table if exists public.agent_runners')
  })
})
