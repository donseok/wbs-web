import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/0068_issue_attachments.sql', import.meta.url),
  'utf8',
)
const rollback = readFileSync(
  new URL('../../supabase/migrations/0068_issue_attachments_rollback.sql', import.meta.url),
  'utf8',
)

/**
 * 실제로 실행되는 SQL 만 남긴다 — 주석에 든 설명·예시 문구가 계약 검사에 걸리지 않게.
 * "app_role() 을 쓰지 않는다" 같은 주석은 금지어 검사의 대상이 아니다.
 * 정렬용 연속 공백도 하나로 접어 인용 문자열이 정렬에 흔들리지 않게 한다.
 */
function sqlOnly(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n')
    .replace(/[ \t]+/g, ' ')
}

const sql = sqlOnly(migration)
const rollbackSql = sqlOnly(rollback)

describe('0068 이슈 첨부 migration 계약', () => {
  it('버킷 상한을 명시한다 — null 로 두면 전역 설정이 바뀔 때 조용히 따라 움직인다', () => {
    expect(migration).toContain("insert into storage.buckets")
    expect(migration).toMatch(/'issue-attachments'/)
    expect(migration).toContain('52428800')
    // 비공개 버킷 — 다운로드는 서명 URL 로만.
    expect(migration).toMatch(/values\s*\(\s*'issue-attachments'\s*,\s*'issue-attachments'\s*,\s*false\s*,\s*52428800\s*\)/)
  })

  it('버킷 재적용이 상한으로 수렴한다 — do nothing 이면 잘못 만들어진 버킷을 고칠 수 없다', () => {
    expect(migration).toMatch(/on conflict \(id\) do update set/)
    expect(migration).toContain('file_size_limit = excluded.file_size_limit')
    expect(sql).not.toMatch(/on conflict \(id\) do nothing/)
  })

  it('확장자를 제한하지 않는다 — allowed_mime_types 를 건드리지 않는다', () => {
    expect(sql).not.toContain('allowed_mime_types')
  })

  it('메타 테이블은 (issue_id, project_id) 복합 FK 로 project_id 위조를 막는다', () => {
    expect(migration).toContain('create table if not exists public.issue_attachments')
    expect(migration).toMatch(
      /foreign key \(issue_id, project_id\)\s*references public\.issues \(id, project_id\)\s*on delete cascade/,
    )
  })

  it('같은 스토리지 객체가 두 메타 행에 붙지 못하게 file_path 를 유니크로 둔다', () => {
    expect(migration).toMatch(/file_path\s+text not null unique/)
  })

  it('목록 배지 쿼리와 이슈별 조회를 위한 인덱스를 만든다', () => {
    expect(migration).toContain('issue_attachments_issue_idx')
    expect(migration).toContain('issue_attachments_project_idx')
    expect(migration).toMatch(/on public\.issue_attachments \(project_id\)/)
  })

  it('업로더 계정이 지워져도 첨부는 남는다', () => {
    expect(migration).toMatch(/uploaded_by\s+uuid references auth\.users\(id\) on delete set null/)
  })

  it('테이블 권한은 update 를 주지 않는다 — 교체는 삭제 + 재업로드다', () => {
    expect(migration).toContain(
      'revoke all on table public.issue_attachments from public, anon, authenticated',
    )
    expect(migration).toContain(
      'grant select, insert, delete on table public.issue_attachments to authenticated',
    )
    expect(migration).toContain('grant all on table public.issue_attachments to service_role')
    expect(sql).not.toMatch(/grant[^;]*update[^;]*on table public\.issue_attachments/)
  })

  it('권한 헬퍼는 pg_temp 가로채기를 차단한 definer 함수다', () => {
    expect(migration).toContain('create or replace function public.can_edit_issue(iid uuid)')
    expect(migration).toMatch(/language sql stable security definer set search_path = ''/)
  })

  it('definer 본문은 스키마를 전부 정규화한다 — search_path 가 빈 문자열이라 생략하면 깨진다', () => {
    const body = sql.slice(
      sql.indexOf('create or replace function public.can_edit_issue'),
      sql.indexOf('revoke all on function public.can_edit_issue'),
    )
    expect(body).toContain('public.issues')
    expect(body).toContain('public.is_project_admin')
    expect(body).not.toMatch(/from issues\b/)
  })

  it('편집 게이트는 작성자 또는 프로젝트 관리자다 — app_role() 을 쓰지 않는다', () => {
    expect(migration).toMatch(/i\.created_by = auth\.uid\(\)\s*or public\.is_project_admin\(i\.project_id\)/)
    // app_role() 은 프로젝트 무관 shim 이라 타 프로젝트 첨부를 쓰는 구멍이 열린다.
    expect(sql).not.toContain('app_role()')
  })

  it('헬퍼 실행 권한을 authenticated 로 좁힌다', () => {
    expect(migration).toContain(
      'revoke all on function public.can_edit_issue(uuid) from public, anon, authenticated',
    )
    expect(migration).toContain(
      'grant execute on function public.can_edit_issue(uuid) to authenticated',
    )
  })

  it('메타 RLS 는 조회 개방 · 쓰기는 편집 게이트이며 update 정책이 없다', () => {
    expect(migration).toContain('alter table public.issue_attachments enable row level security')
    expect(migration).toMatch(/create policy read_issue_attachments[\s\S]*?for select to authenticated\s*using \(true\)/)
    expect(migration).toMatch(/create policy insert_issue_attachments[\s\S]*?with check \(public\.can_edit_issue\(issue_id\)\)/)
    expect(migration).toMatch(/create policy delete_issue_attachments[\s\S]*?for delete to authenticated\s*using \(public\.can_edit_issue\(issue_id\)\)/)
    expect(sql).not.toMatch(/create policy \w+ on public\.issue_attachments\s*for update/)
  })

  it('스토리지 정책은 경로 첫 세그먼트가 issue_id 라는 규약을 쓴다', () => {
    expect(migration).toMatch(/public\.can_edit_issue\(split_part\(name, '\/', 1\)::uuid\)/)
    expect(migration).toContain(`create policy "issue-attachments insert" on storage.objects`)
    expect(migration).toContain(`create policy "issue-attachments delete" on storage.objects`)
  })

  it('스토리지 read 는 넓다 — 다운로드는 로그인 전체이고 remove() 가 select 를 함께 요구한다', () => {
    expect(migration).toMatch(
      /create policy "issue-attachments read" on storage\.objects for select to authenticated\s*using \(bucket_id = 'issue-attachments'\)/,
    )
  })

  it('정책은 drop if exists 로 멱등하다', () => {
    for (const p of ['read', 'insert', 'delete']) {
      expect(sql).toContain(`drop policy if exists "issue-attachments ${p}" on storage.objects`)
      expect(sql).toContain(`drop policy if exists ${p}_issue_attachments on public.issue_attachments`)
    }
  })

  it('search_path 를 열고 닫으며 트랜잭션으로 감싼다', () => {
    expect(migration).toContain('set search_path = public, extensions;')
    expect(migration).toContain('reset search_path;')
    expect(migration.trimStart()).toMatch(/^--[\s\S]*?\bbegin;/)
    expect(migration.trimEnd().endsWith('commit;')).toBe(true)
  })
})

describe('0068 롤백 계약', () => {
  it('스토리지 정책을 함수보다 먼저 지운다 — 순서가 뒤바뀌면 의존성으로 실패한다', () => {
    const policyAt = rollback.indexOf('drop policy if exists "issue-attachments insert"')
    const funcAt = rollback.indexOf('drop function if exists public.can_edit_issue')
    expect(policyAt).toBeGreaterThan(-1)
    expect(funcAt).toBeGreaterThan(-1)
    expect(policyAt).toBeLessThan(funcAt)
  })

  it('메타 테이블과 헬퍼 함수를 되돌린다', () => {
    expect(rollback).toContain('drop table if exists public.issue_attachments')
    expect(rollback).toContain('drop function if exists public.can_edit_issue(uuid)')
  })

  it('업로드된 파일은 지우지 않는다 — 되돌릴 수 없는 사용자 데이터다', () => {
    expect(rollbackSql).not.toMatch(/delete from storage\.objects/)
    expect(rollbackSql).not.toMatch(/delete from storage\.buckets/)
  })
})
