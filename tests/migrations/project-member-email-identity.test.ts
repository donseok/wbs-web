import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/0070_project_member_email_identity.sql', import.meta.url),
  'utf8',
)
const rollback = readFileSync(
  new URL(
    '../../supabase/migrations/0070_project_member_email_identity_rollback.sql',
    import.meta.url,
  ),
  'utf8',
)

function sqlOnly(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n')
    .replace(/[ \t]+/g, ' ')
}

const sql = sqlOnly(migration)

describe('0070 프로젝트 멤버 email→name 정본 migration 계약', () => {
  it('email PK 정본과 복합 참조 키를 만들되 로스터 email 전역 UNIQUE는 만들지 않는다', () => {
    expect(migration).toContain('create table if not exists public.project_member_identities')
    expect(migration).toMatch(/email\s+text primary key/)
    expect(migration).toMatch(
      /project_member_identities_email_name_uidx[\s\S]*?\(email, name\)/,
    )
    expect(sql).not.toMatch(/unique[^;]*on public\.project_members \(email\)/)
  })

  it('기존 충돌은 행 삭제·병합 없이 동일 email의 확인된 정본 이름으로 교정한다', () => {
    expect(migration).toContain('159d4ed9-aeaa-4c39-b40b-8d9d863faf83')
    expect(migration).toContain('a97cab77-9092-44ed-a83a-a91d4be7e03e')
    expect(migration).toMatch(/set name = canonical\.name/)
    expect(sql).not.toMatch(/delete from public\.project_members/)
  })

  it('알려지지 않은 기존 충돌은 임의 정본으로 덮지 않고 적용을 중단한다', () => {
    expect(migration).toMatch(/having count\(distinct pm\.name\) > 1/)
    expect(migration).toContain('0070_PRECONDITION_FAILED')
    expect(migration).not.toContain('known conflicting member was not corrected')
    expect(migration).toMatch(/pm\.email !~ '\^\[\^\\s@\]/)
  })

  it('동시 최초 등록은 identity email PK의 insert/on conflict로 직렬화한다', () => {
    const functionBody = migration.slice(
      migration.indexOf('create or replace function public.enforce_project_member_email_identity'),
      migration.indexOf('revoke all on function public.enforce_project_member_email_identity'),
    )
    expect(functionBody).toMatch(
      /insert into public\.project_member_identities \(email, name\)[\s\S]*on conflict \(email\) do nothing/,
    )
    expect(functionBody).toContain('PROJECT_MEMBER_EMAIL_NAME_MISMATCH')
    expect(functionBody).toContain("errcode = '23514'")
    expect(functionBody).toContain('pg_advisory_xact_lock')
    expect(functionBody).toMatch(
      /if not exists \([\s\S]*from public\.project_members pm[\s\S]*update public\.project_member_identities/,
    )
  })

  it('null email은 예외이고, 이름·이메일은 저장 전에 정규화한다', () => {
    expect(migration).toMatch(/new\.name := pg_catalog\.btrim\(new\.name\)/)
    expect(migration).toMatch(/if new\.email is null then\s*return new;/)
    expect(migration).toMatch(
      /new\.email := pg_catalog\.lower\(pg_catalog\.btrim\(new\.email\)\)/,
    )
  })

  it('기존 0019 normalize/link 뒤에 실행되며 명시 user_id 계약을 건드리지 않는다', () => {
    expect(migration).toContain('zz_project_member_email_identity_trg')
    expect(migration).toMatch(
      /before insert or update of email, name on public\.project_members/,
    )
    expect(sql).not.toMatch(/new\.user_id\s*:=/)
    expect(sql).not.toMatch(/auth\.users/)
  })

  it('복합 FK가 email은 여러 프로젝트에 허용하면서 다른 name만 차단한다', () => {
    expect(migration).toMatch(
      /foreign key \(email, name\)\s*references public\.project_member_identities \(email, name\)/,
    )
    expect(migration).toContain('on update cascade')
    expect(migration).toContain('on delete restrict')
  })

  it('정본 테이블은 앱에 노출하지 않고 definer 함수의 search_path를 잠근다', () => {
    expect(migration).toContain('alter table public.project_member_identities enable row level security')
    expect(migration).toContain(
      'revoke all on table public.project_member_identities from public, anon, authenticated',
    )
    expect(migration).toContain('grant all on table public.project_member_identities to service_role')
    expect(migration).toMatch(/security definer\s*set search_path = ''/)
  })

  it('이름 교정 RPC는 프로젝트 속성과 정본 변경을 한 트랜잭션으로 처리한다', () => {
    const rpc = migration.slice(
      migration.indexOf('create or replace function public.update_project_member_with_identity'),
      migration.indexOf('revoke all on function public.update_project_member_with_identity'),
    )
    expect(rpc).toContain('public.is_project_admin(v_current.project_id)')
    expect(rpc).toMatch(/v_refs > 1 and not public\.is_superuser\(\)/)
    expect(rpc).toMatch(/update public\.project_member_identities identity[\s\S]*set name = v_name/)
    expect(rpc).toMatch(/update public\.project_members[\s\S]*team_id = p_team_id/)
    expect(migration).toMatch(
      /grant execute on function public\.update_project_member_with_identity\([\s\S]*?\) to authenticated/,
    )
  })

  it('전역 rename은 행 잠금 전에 로스터 쓰기를 직렬화해 FK cascade 교착을 막는다', () => {
    const rpc = migration.slice(
      migration.indexOf('create or replace function public.update_project_member_with_identity'),
      migration.indexOf('revoke all on function public.update_project_member_with_identity'),
    )
    const tableLockAt = rpc.indexOf(
      'lock table public.project_members in exclusive mode',
    )
    const rowLockAt = rpc.indexOf('for update;')

    expect(tableLockAt).toBeGreaterThan(-1)
    expect(rowLockAt).toBeGreaterThan(tableLockAt)
    expect(rpc).not.toContain('lock table public.project_members in share row exclusive mode')
    expect(rpc).toContain('PROJECT_MEMBER_RETRY')
  })

  it('정방향과 롤백은 각각 한 트랜잭션이다', () => {
    for (const body of [migration, rollback]) {
      expect(body.trimStart()).toMatch(/^--[\s\S]*?\bbegin;/)
      expect(body.trimEnd().endsWith('commit;')).toBe(true)
    }
  })
})

describe('0070 롤백 계약', () => {
  it('복합 FK와 trigger/function을 먼저 제거한 뒤 정본 표를 제거한다', () => {
    const fkAt = rollback.indexOf('drop constraint if exists project_members_email_name_fkey')
    const rpcAt = rollback.indexOf('drop function if exists public.update_project_member_with_identity')
    const triggerAt = rollback.indexOf('drop trigger if exists zz_project_member_email_identity_trg')
    const functionAt = rollback.indexOf('drop function if exists public.enforce_project_member_email_identity')
    const tableAt = rollback.indexOf('drop table if exists public.project_member_identities')

    expect(fkAt).toBeGreaterThan(-1)
    expect(rpcAt).toBeGreaterThan(fkAt)
    expect(triggerAt).toBeGreaterThan(rpcAt)
    expect(functionAt).toBeGreaterThan(triggerAt)
    expect(tableAt).toBeGreaterThan(functionAt)
  })

  it('정본으로 교정된 이름을 다시 불일치 상태로 되돌리지 않는다', () => {
    expect(rollback).toMatch(/경고/)
    expect(sqlOnly(rollback)).not.toMatch(/update public\.project_members/)
  })

  it('앱을 먼저 롤백한 뒤 DB 제약을 제거하도록 순서를 명시한다', () => {
    expect(rollback).toContain('앱을 0070 이전 버전으로 먼저 롤백')
  })
})
