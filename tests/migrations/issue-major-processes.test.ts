import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/0062_issue_major_processes.sql', import.meta.url),
  'utf8',
)
const rollback = readFileSync(
  new URL('../../supabase/migrations/0062_issue_major_processes_rollback.sql', import.meta.url),
  'utf8',
)

describe('0062 이슈 Major Process 기준정보 migration 계약', () => {
  it('기준정보 테이블을 번호·이름·복합 FK 참조용 3중 유니크로 고정한다', () => {
    expect(migration).toContain('create table if not exists public.issue_major_processes')
    expect(migration).toContain('unique (project_id, mega_code, major_seq)')
    expect(migration).toContain('unique (project_id, mega_code, name)')
    expect(migration).toContain('unique (id, project_id, mega_code)')
  })

  it('체번은 advisory xact lock으로 직렬화한 뒤의 MAX+1이다', () => {
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toMatch(
      /pg_advisory_xact_lock\([\s\S]*?coalesce\(max\(mp\.major_seq\), 0\) \+ 1/,
    )
    expect(migration).toMatch(
      /create trigger trg_assign_issue_major_seq\s*before insert or update on public\.issue_major_processes/,
    )
  })

  it('번호 직접 주입을 거부하고 발급된 project/mega/seq를 불변으로 만든다', () => {
    expect(migration).toContain("raise exception 'ISSUE_MAJOR_SEQ_MANAGED'")
    expect(migration).toContain("raise exception 'ISSUE_MAJOR_IMMUTABLE'")
    expect(migration).toMatch(/new\.major_seq is distinct from old\.major_seq/)
  })

  it('issues.major_id는 복합 FK와 mega 선행 check로 정합을 보장한다', () => {
    expect(migration).toContain(
      'alter table public.issues add column if not exists major_id uuid',
    )
    expect(migration).toMatch(
      /foreign key \(major_id, project_id, mega_code\)\s*references public\.issue_major_processes \(id, project_id, mega_code\)/,
    )
    expect(migration).toMatch(/check \(\s*major_id is null or mega_code is not null\s*\)/)
  })

  it('pi 코드 체번은 major 분류를 요구하되 업무키 형식은 유지한다', () => {
    expect(migration).toMatch(
      /create or replace function public\.assign_issue_analysis_code\(\)[\s\S]*raise exception 'ISSUE_MAJOR_REQUIRED'/,
    )
    expect(migration).toMatch(
      /if new\.major_id is null then\s*raise exception 'ISSUE_MAJOR_REQUIRED'/,
    )
    expect(migration).toContain(
      "'PI-I-' || new.mega_code || '-' || pg_catalog.lpad(v_seq::text, 2, '0')",
    )
  })

  it('회의록 RPC는 구 시그니처를 제거하고 p_major_name을 Mega 다음 인자로 받는다', () => {
    expect(migration).toMatch(
      /drop function if exists public\.create_issue_from_minute_block\(\s*uuid, text, text, text, uuid\[\], date, date,\s*text, text, text, text\[\], text, text,\s*uuid, text, uuid, uuid, text, integer, text, text, text, text\s*\)/,
    )
    expect(migration).toMatch(/p_mega_code text,\s*p_major_name text,\s*p_sub_process text,/)
    expect(migration).toContain(
      'create or replace function public.create_issue_from_minute_block(',
    )
    expect(migration).toContain("raise exception 'ISSUE_MAJOR_NAME_INVALID'")
  })

  it('RPC는 on conflict 대신 unique_violation 예외로 resolve-or-create 한다', () => {
    expect(migration).toMatch(
      /insert into public\.issue_major_processes \(project_id, mega_code, name\)\s*values \(p_project_id, p_mega_code, v_major_name\)\s*returning id into v_major_id;\s*exception when unique_violation then/,
    )
    expect(migration).toMatch(
      /exception when unique_violation then\s*select mp\.id\s*into v_major_id/,
    )
    expect(migration).toMatch(/major_id,\s*sub_process/)
  })

  it('신 RPC는 service_role에만 실행 권한을 준다', () => {
    expect(migration).toMatch(
      /grant execute on function public\.create_issue_from_minute_block\(\s*uuid, text, text, text, uuid\[\], date, date,\s*text, text, text, text, text\[\], text, text,\s*uuid, text, uuid, uuid, text, integer, text, text, text, text\s*\) to service_role/,
    )
    expect(migration).not.toMatch(
      /grant execute on function public\.create_issue_from_minute_block\([\s\S]{0,320}\) to authenticated/,
    )
  })

  it('RLS는 select=authenticated·insert=해당 프로젝트 멤버이고 update/delete는 열지 않는다', () => {
    expect(migration).toContain(
      'alter table public.issue_major_processes enable row level security',
    )
    expect(migration).toMatch(
      /create policy read_all_issue_major_processes on public\.issue_major_processes\s*for select to authenticated using \(true\)/,
    )
    expect(migration).toMatch(
      /create policy insert_issue_major_processes on public\.issue_major_processes\s*for insert to authenticated\s*with check \(public\.is_project_member\(project_id\)\)/,
    )
    expect(migration).not.toMatch(/on public\.issue_major_processes\s*for update/)
    expect(migration).not.toMatch(/on public\.issue_major_processes\s*for delete/)
    expect(migration).toContain(
      'revoke all on table public.issue_major_processes from public, anon, authenticated',
    )
    expect(migration).toContain(
      'grant select, insert on table public.issue_major_processes to authenticated',
    )
    expect(migration).not.toMatch(
      /grant[^;]*(update|delete)[^;]*on table public\.issue_major_processes/,
    )
  })

  it('롤백은 데이터 소실을 경고하고 신 RPC를 지운 뒤 0055 시그니처를 복원한다', () => {
    expect(rollback).toMatch(/경고/)
    expect(rollback).toMatch(
      /drop function if exists public\.create_issue_from_minute_block\(\s*uuid, text, text, text, uuid\[\], date, date,\s*text, text, text, text, text\[\], text, text,\s*uuid, text, uuid, uuid, text, integer, text, text, text, text\s*\)/,
    )
    expect(rollback).toMatch(/p_mega_code text,\s*p_sub_process text,/)
    // 헤더 주석의 "p_major_name 없음" 언급은 허용하고, 인자 선언만 금지한다.
    expect(rollback).not.toMatch(/p_major_name text/)
    expect(rollback).toMatch(
      /grant execute on function public\.create_issue_from_minute_block\(\s*uuid, text, text, text, uuid\[\], date, date,\s*text, text, text, text\[\], text, text,\s*uuid, text, uuid, uuid, text, integer, text, text, text, text\s*\) to service_role/,
    )
  })

  it('롤백은 pi 체번의 major 요구를 걷어내고 major 객체를 전부 제거한다', () => {
    expect(rollback).toContain(
      'create or replace function public.assign_issue_analysis_code()',
    )
    expect(rollback).not.toContain('ISSUE_MAJOR_REQUIRED')
    expect(rollback).toContain('drop constraint if exists issues_major_process_fk')
    expect(rollback).toContain('drop constraint if exists issues_major_requires_mega_check')
    expect(rollback).toContain('alter table public.issues drop column if exists major_id')
    expect(rollback).toContain(
      'drop trigger if exists trg_assign_issue_major_seq on public.issue_major_processes',
    )
    expect(rollback).toContain('drop function if exists public.assign_issue_major_seq()')
    expect(rollback).toContain('drop table if exists public.issue_major_processes')
  })
})
