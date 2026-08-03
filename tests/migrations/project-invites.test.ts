import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsDir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
const migration = readFileSync(`${migrationsDir}0065_project_invites.sql`, 'utf8')
const rollback = readFileSync(`${migrationsDir}0065_project_invites_rollback.sql`, 'utf8')

/**
 * 주석을 걷어낸 실행 SQL. "정책을 만들지 않는다" 류의 단언은 실행문만 봐야 한다 —
 * 왜 안 만드는지 설명하는 주석까지 걸리면 설명을 지우게 만드는 잘못된 압력이 생긴다(0051 선례).
 */
const executable = migration.replace(/^\s*--.*$/gm, '')

describe('0065 project_invites migration 계약', () => {
  it('1회용 초대 테이블을 멱등하게 만든다', () => {
    expect(migration).toContain('create table if not exists public.project_invites')
    expect(migration).toContain('references public.projects(id) on delete cascade')
    // 팀이 사라진 채 남은 초대가 소비돼 소속 없는 합류가 생기지 않게 한다.
    expect(migration).toContain('references public.teams(id) on delete restrict')
    expect(migration).toContain('references auth.users(id) on delete set null')
    expect(migration).toContain('token       uuid not null unique')
    expect(migration).toContain('expires_at  timestamptz not null')
    // use_count/max_uses 가 없는 것이 1회용 계약이다 — redeemed_at is null 이 곧 미사용.
    expect(executable).not.toContain('max_uses')
    expect(executable).not.toContain('use_count')
  })

  it('이메일 정규화와 합류 기록 쌍을 CHECK 로 고정한다', () => {
    expect(migration).toContain(
      "constraint project_invites_email_normalized check (email = lower(btrim(email)) and email <> '')",
    )
    // 한 방향만 금지한다 — (uuid, null) 만 거부하고 (null, ts) 는 허용.
    expect(migration).toContain(
      'constraint project_invites_redeem_pair check (redeemed_by is null or redeemed_at is not null)',
    )
  })

  /**
   * 이 제약은 "깔끔하게" 양방향 등가로 되돌리고 싶어지는 모양이다. 되돌리면 안 되는 이유가
   * 스키마 한 줄에 안 보이므로 테스트에 박아 둔다.
   *
   * redeemed_by 는 on delete set null 이다. 초대로 합류한 계정을 auth.users 에서 지우면 DB 가
   * (redeemed_by, redeemed_at) = (null, timestamp) 를 만든다. 등가 CHECK 는 그 상태를 거부해
   * **계정 삭제 트랜잭션 자체를 실패**시키고, 가입 후 후속 단계가 깨졌을 때 되돌리는 보상
   * 경로(deleteUser)까지 막는다. 헤더 6항("계정이 지워져도 감사 기록은 남는다")이 스키마로
   * 지켜지지 않게 되는 것이다.
   */
  it('redeem 쌍 CHECK 는 한 방향만 금지한다 — 등가로 되돌리면 계정 삭제가 막힌다', () => {
    const redeemPair = migration.match(/constraint project_invites_redeem_pair check \(([^\n]*)\)\n/)
    expect(redeemPair?.[1]).toBe('redeemed_by is null or redeemed_at is not null')

    // 양방향 등가(= / is not distinct from / and 조합)로 되돌아간 흔적이 실행문에 없어야 한다.
    expect(executable).not.toContain('(redeemed_by is null) = (redeemed_at is null)')
    expect(executable).not.toMatch(/redeemed_by is null\s+and\s+redeemed_at is null/i)
    expect(executable).not.toMatch(/redeemed_by is (not )?distinct from/i)

    // 술어를 (redeemed_by, redeemed_at) 네 조합에 직접 돌려 허용/거부를 못 박는다.
    const holds = (by: string | null, at: string | null) => by === null || at !== null
    expect(holds(null, null)).toBe(true) // 미사용
    expect(holds('u1', '2026-08-03T00:00:00Z')).toBe(true) // 사용됨
    expect(holds(null, '2026-08-03T00:00:00Z')).toBe(true) // 소비자 계정이 지워진 감사 기록
    expect(holds('u1', null)).toBe(false) // 유일한 모순 — 이것만 막는다

    // "redeemed_at is null 이 곧 미사용" 계약은 그대로다(부분 유니크·소비 함수가 그 위에 선다).
    expect(migration).toContain('where redeemed_at is null and revoked_at is null')
    expect(migration).toContain('and pi.redeemed_at is null')

    // 되돌리려는 사람이 헤더에서 이유를 찾을 수 있어야 한다.
    expect(migration).toMatch(/on delete set null/)
    expect(migration).toMatch(/등가/)
  })

  it('활성 초대만 유일하게 잡는 부분 유니크 인덱스와 목록 조회 인덱스를 만든다', () => {
    expect(migration).toContain(
      'create unique index if not exists project_invites_active_email_uidx',
    )
    expect(migration).toContain('on public.project_invites (project_id, email)')
    expect(migration).toContain('where redeemed_at is null and revoked_at is null')
    expect(migration).toContain(
      'create index if not exists project_invites_project_created_idx',
    )
    expect(migration).toContain('on public.project_invites (project_id, created_at desc)')
  })

  it('RLS 를 켜되 정책을 0개 둔다 — 정책 0개가 곧 토큰 비노출 계약이다', () => {
    expect(migration).toContain('alter table public.project_invites enable row level security')
    // token 은 그 자체로 가입 자격이다. authenticated 에게도 한 줄을 열지 않는다.
    expect(executable).not.toContain('create policy')
    expect(migration).toContain(
      'revoke all on table public.project_invites from public, anon, authenticated',
    )
    expect(migration).toContain('grant all on table public.project_invites to service_role')
    // RLS 는 TRUNCATE 를 막지 못하므로 기본 GRANT 회수 뒤 authenticated 에 아무것도 되돌려주지 않는다.
    expect(executable).not.toMatch(/grant[^;]*to\s+(anon|authenticated)/i)
  })

  it('소비 함수는 이메일 일치까지 단일 UPDATE 로 강제하고 service_role 에만 열린다', () => {
    expect(migration).toContain('create or replace function public.consume_project_invite(')
    expect(migration).toMatch(/language sql\s+volatile\s+security invoker/)
    expect(migration).toContain('set search_path = public, extensions')
    expect(migration).toContain('and pi.email = lower(btrim(p_email))')
    expect(migration).toContain('and pi.redeemed_at is null')
    expect(migration).toContain('and pi.revoked_at is null')
    expect(migration).toContain('and pi.expires_at > now()')
    expect(migration).toContain(
      'revoke all on function public.consume_project_invite(uuid, text, uuid) from public, anon, authenticated',
    )
    expect(migration).toContain(
      'grant execute on function public.consume_project_invite(uuid, text, uuid) to service_role',
    )
    // 호출자(service_role) 권한으로 도는 것이 계약이다 — definer 로 승격하지 않는다.
    expect(executable).not.toContain('security definer')
  })

  it('트랜잭션 + 끝단 검증 블록으로 반쪽 적용을 남기지 않는다', () => {
    expect(migration).toMatch(/^--[\s\S]*\nbegin;/)
    expect(migration.trimEnd()).toMatch(/commit;$/)
    expect(migration).toContain("to_regclass('public.project_invites')")
    expect(migration).toContain(
      "to_regprocedure('public.consume_project_invite(uuid, text, uuid)')",
    )
    expect(migration).toContain("to_regclass('public.project_invites_active_email_uidx')")
    expect(migration).toContain("to_regclass('public.project_invites_project_created_idx')")
    expect(migration).toMatch(/raise exception '0065 검증 실패/)
  })

  it('헤더가 적용 경로·적용 순서·롤백 파일을 명시한다', () => {
    expect(migration).toContain('Management API')
    expect(migration).toContain('db push 금지')
    expect(migration).toMatch(/적용 순서: 이 마이그레이션을 먼저 적용한 뒤/)
    expect(migration).toContain('0065_project_invites_rollback.sql')
  })

  it('롤백은 함수·테이블을 역순으로 멱등하게 제거하고 데이터 소실을 경고한다', () => {
    expect(rollback).toContain('drop function if exists public.consume_project_invite(uuid, text, uuid)')
    expect(rollback).toContain('drop table if exists public.project_invites')
    expect(rollback.indexOf('drop function')).toBeLessThan(rollback.indexOf('drop table'))
    expect(rollback).toMatch(/경고|데이터 소실/)
    expect(rollback.trimEnd()).toMatch(/commit;$/)
  })
})
