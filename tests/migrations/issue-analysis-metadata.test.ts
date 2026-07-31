import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/0055_issue_analysis_metadata.sql', import.meta.url),
  'utf8',
)
const rollback = readFileSync(
  new URL('../../supabase/migrations/0055_issue_analysis_metadata_rollback.sql', import.meta.url),
  'utf8',
)

describe('0055 이슈 분석 메타 + PI 업무키 migration 계약', () => {
  it('PPT Mega 기준 00~07을 기준정보로 시드한다', () => {
    for (const [code, name] of [
      ['00', '기준관리'],
      ['01', '손익관리'],
      ['02', '영업'],
      ['03', '품질·설계'],
      ['04', '생산계획'],
      ['05', '조업'],
      ['06', '출하'],
      ['07', '원가'],
    ]) {
      expect(migration).toContain(`('${code}', '${name}'`)
    }
  })

  it('UUID/issue_no를 유지한 채 분석 메타 컬럼과 하위호환 기본값을 추가한다', () => {
    expect(migration).not.toMatch(/alter table public\.issues\s+drop column.*\bid\b/i)
    expect(migration).not.toMatch(/alter table public\.issues\s+drop column.*issue_no/i)
    expect(migration).toContain('add column if not exists mega_code text')
    expect(migration).toContain('add column if not exists mega_seq bigint')
    expect(migration).toContain('add column if not exists pi_issue_code text')
    expect(migration).toContain("add column if not exists sub_process text not null default ''")
    expect(migration).toContain("add column if not exists owner_department text not null default ''")
    expect(migration).toContain("related_systems text[] not null default '{}'::text[]")
    expect(migration).toContain('add column if not exists source_type text')
    expect(migration).toContain("add column if not exists source_detail text not null default ''")
  })

  it('프로젝트+Mega 카운터를 원자 upsert하고 MAX+1을 사용하지 않는다', () => {
    expect(migration).toMatch(
      /primary key \(project_id, mega_code\)[\s\S]*insert into public\.issue_number_counters as counter/,
    )
    expect(migration).toMatch(
      /on conflict \(project_id, mega_code\) do update[\s\S]*counter\.last_no \+ 1[\s\S]*returning last_no into v_seq/,
    )
    expect(migration).not.toMatch(/select\s+max\s*\(/i)
    expect(migration).toContain(
      "'PI-I-' || new.mega_code || '-' || pg_catalog.lpad(v_seq::text, 2, '0')",
    )
  })

  it('최초 분류 시 발급하고 발급된 프로젝트/Mega/순번/업무키를 불변으로 만든다', () => {
    expect(migration).toContain('before insert or update on public.issues')
    expect(migration).toContain("raise exception 'ISSUE_CODE_MANAGED'")
    expect(migration).toContain("raise exception 'ISSUE_CODE_IMMUTABLE'")
    expect(migration).toMatch(/new\.project_id is distinct from old\.project_id/)
    expect(migration).toMatch(/new\.mega_code is distinct from old\.mega_code/)
    expect(migration).toMatch(/new\.mega_seq is distinct from old\.mega_seq/)
    expect(migration).toMatch(/new\.pi_issue_code is distinct from old\.pi_issue_code/)
    expect(migration).toContain('where area.code = new.mega_code')
  })

  it('업무키 충돌을 두 partial unique index로 이중 방어한다', () => {
    expect(migration).toMatch(
      /create unique index if not exists issues_project_mega_seq_uidx[\s\S]*where mega_code is not null and mega_seq is not null/,
    )
    expect(migration).toMatch(
      /create unique index if not exists issues_project_pi_code_uidx[\s\S]*where pi_issue_code is not null/,
    )
  })

  it('카운터는 authenticated에서 숨기고 trigger 함수만 security definer로 쓴다', () => {
    expect(migration).toContain(
      'revoke all on table public.issue_number_counters from public, anon, authenticated',
    )
    expect(migration).toMatch(
      /function public\.assign_issue_analysis_code\(\)[\s\S]*security definer[\s\S]*set search_path = ''/,
    )
    expect(migration).toContain(
      'revoke all on function public.assign_issue_analysis_code()',
    )
  })

  it('회의록 RPC를 메타 인자로 교체하고 minutes를 DB에서 강제해 PI 업무키를 반환한다', () => {
    expect(migration).toContain('p_mega_code text')
    expect(migration).toContain('p_sub_process text')
    expect(migration).toContain('p_owner_department text')
    expect(migration).toContain('p_related_systems text[]')
    expect(migration).toContain('p_source_type text')
    expect(migration).toContain('p_source_detail text')
    expect(migration).toMatch(/returns table \(\s*issue_id uuid,\s*issue_no bigint,\s*pi_issue_code text/)
    expect(migration).toContain("if p_source_type is distinct from 'minutes'")
    expect(migration).toMatch(/v_related_systems,\s*'minutes',\s*btrim\(p_source_detail\)/)
    expect(migration).toContain('created_issue.pi_issue_code')
    expect(migration).toMatch(
      /grant execute on function public\.create_issue_from_minute_block\([\s\S]{0,320}\) to service_role/,
    )
    expect(migration).not.toMatch(
      /grant execute on function public\.create_issue_from_minute_block\([\s\S]{0,320}\) to authenticated/,
    )
  })

  it('롤백은 데이터 소실을 경고하고 분석 객체를 제거한 뒤 0049 RPC를 복원한다', () => {
    expect(rollback).toMatch(/경고\(데이터 소실\)/)
    expect(rollback).toContain('drop table if exists public.issue_number_counters')
    expect(rollback).toContain('drop table if exists public.issue_mega_areas')
    expect(rollback).toContain('drop column if exists pi_issue_code')
    expect(rollback).toContain('drop column if exists mega_code')
    expect(rollback).toMatch(
      /create or replace function public\.create_issue_from_minute_block\([\s\S]*p_actor_id uuid/,
    )
    expect(rollback).toMatch(/returns table \(\s*issue_id uuid,\s*issue_no bigint\s*\)/)
    expect(rollback).not.toMatch(/returns table \([\s\S]{0,100}pi_issue_code/)
  })
})
