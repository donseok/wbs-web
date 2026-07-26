import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/0049_issue_minute_links.sql', import.meta.url),
  'utf8',
)
const rollback = readFileSync(
  new URL('../../supabase/migrations/0049_issue_minute_links_rollback.sql', import.meta.url),
  'utf8',
)

describe('0049 회의록 블록 이슈 연결 migration 계약', () => {
  it('이슈기간 시작일과 날짜 순서 제약을 추가한다', () => {
    expect(migration).toContain('add column if not exists start_date date')
    expect(migration).toContain('start_date <= due_date')
  })

  it('이슈 프로젝트와 불변 회의록 버전을 복합 FK로 고정한다', () => {
    expect(migration).toContain('constraint issue_links_issue_project_fk')
    expect(migration).toContain('foreign key (issue_id, project_id)')
    expect(migration).toContain('constraint issue_links_version_minute_fk')
    expect(migration).toContain('foreign key (minute_version_id, minute_id)')
    expect(migration).toContain('minute_title_snapshot')
    expect(migration).toContain('minute_date_snapshot')
    expect(migration).toContain('excerpt_snapshot')
  })

  it('출처 프로젝트는 target 제약이 아닌 과거 버전의 nullable 스냅샷으로 보존한다', () => {
    expect(migration).toMatch(/source_project_id\s+uuid,/)
    expect(migration).toContain('alter column source_project_id drop not null')
    expect(migration).toContain('drop constraint if exists issue_links_project_match_check')
    expect(migration).not.toMatch(
      /constraint issue_links_project_match_check\s+check\s*\(project_id = source_project_id\)/,
    )
    expect(migration).toContain('set source_project_id = version.project_id')
    expect(migration).toContain('v_version_project_id')
  })

  it('같은 수동 블록에서 별도 이슈를 허용하고 source_key는 조회 인덱스로만 쓴다', () => {
    expect(migration).toContain('create index if not exists issue_links_source_key_idx')
    expect(migration).not.toMatch(/unique index[\s\S]{0,120}issue_links_source_key/i)
    expect(migration).toContain('issue_links_issue_source_unique')
  })

  it('인증 사용자는 읽기만 가능하고 직접 INSERT·UPDATE·DELETE를 열지 않는다', () => {
    expect(migration).toContain('create policy read_all_issue_links')
    expect(migration).toContain('drop policy if exists member_insert_issue_links')
    expect(migration).not.toContain('create policy member_insert_issue_links')
    expect(migration).not.toMatch(/create policy[\s\S]{0,80}issue_links[\s\S]{0,80}for update/i)
    expect(migration).not.toMatch(/create policy[\s\S]{0,80}issue_links[\s\S]{0,80}for delete/i)
    expect(migration).toContain('grant select on table public.issue_links to authenticated')
    expect(migration).not.toContain('grant select, insert on table public.issue_links to authenticated')
  })

  it('service_role RPC가 actor·현재 회의록·버전·담당자를 검증하고 세 레코드를 원자 생성한다', () => {
    expect(migration).toContain('security invoker')
    expect(migration).toContain('p_actor_id uuid')
    expect(migration).not.toContain('auth.uid()')
    expect(migration).not.toContain('public.app_role()')
    expect(migration).toContain('p_actor_id,')
    expect(migration).toMatch(/from public\.minutes minute[\s\S]{0,160}for share/)
    expect(migration).toContain('MINUTE_ARCHIVED')
    expect(migration).toContain('MINUTE_PROJECT_MISMATCH')
    expect(migration).toContain('MINUTE_BODY_STALE')
    expect(migration).toContain('ISSUE_ASSIGNEE_PROJECT_MISMATCH')
    expect(migration).toContain('insert into public.issues')
    expect(migration).toContain('insert into public.issue_assignees')
    expect(migration).toContain('insert into public.issue_links')
    expect(migration).toMatch(
      /grant execute on function public\.create_issue_from_minute_block\([\s\S]{0,220}\) to service_role/,
    )
    expect(migration).not.toMatch(
      /grant execute on function public\.create_issue_from_minute_block\([\s\S]{0,220}\) to authenticated/,
    )
    expect(migration).toMatch(
      /drop function if exists public\.create_issue_from_minute_block\(\s*uuid, text, text, text, uuid\[\], date, date, text,/,
    )
  })

  it('롤백은 RPC·링크·기간 컬럼을 명시적으로 제거하고 데이터 손실을 경고한다', () => {
    expect(
      rollback.match(/drop function if exists public\.create_issue_from_minute_block/g),
    ).toHaveLength(2)
    expect(rollback).toMatch(/uuid\[\], date, date, uuid, text,/)
    expect(rollback).toMatch(/uuid\[\], date, date, text,/)
    expect(rollback).toContain('drop table if exists public.issue_links')
    expect(rollback).toContain('drop column if exists start_date')
    expect(rollback).toContain('데이터 소실')
  })
})
