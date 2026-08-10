import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIG = readFileSync(join(process.cwd(), 'supabase/migrations/0071_project_teams.sql'), 'utf8')
const ROLLBACK = readFileSync(join(process.cwd(), 'supabase/migrations/0071_project_teams_rollback.sql'), 'utf8')

describe('0071 project teams', () => {
  it('teams.project_id 컬럼과 프로젝트 인덱스를 추가한다', () => {
    expect(MIG).toMatch(/alter table public\.teams add column if not exists project_id uuid references public\.projects\(id\) on delete cascade/)
    expect(MIG).toMatch(/create index if not exists idx_teams_project on public\.teams\(project_id\)/)
  })
  it('코드 유니크를 (project_id, code) nulls not distinct 로 교체하고 위키 FK 2건을 선행 제거한다', () => {
    expect(MIG).toMatch(/wiki_topics drop constraint if exists wiki_topics_owner_team_fkey/)
    expect(MIG).toMatch(/wiki_items drop constraint if exists wiki_items_owner_team_fkey/)
    expect(MIG).toMatch(/teams drop constraint if exists teams_code_key/)
    expect(MIG).toMatch(/unique nulls not distinct \(project_id, code\)/)
    // 위키 FK drop 이 teams_code_key drop 보다 먼저여야 한다(의존 객체 에러 방지)
    expect(MIG.indexOf('wiki_topics_owner_team_fkey')).toBeLessThan(MIG.indexOf('teams_code_key'))
  })
  it('프로젝트 행 한정 관리자 쓰기 RLS 를 추가한다(전역 행은 su_* 유지)', () => {
    expect(MIG).toMatch(/create policy pa_insert_project_teams on public\.teams for insert to authenticated/)
    expect(MIG).toMatch(/create policy pa_update_project_teams on public\.teams for update to authenticated/)
    // 두 정책 모두 project_id is not null 과 is_project_admin 을 요구
    const pa = MIG.slice(MIG.indexOf('pa_insert_project_teams'))
    expect(pa).toMatch(/project_id is not null and public\.is_project_admin\(project_id\)/)
  })
  it('member_update_actual 과 can_attach 가 명단 팀 합집합을 갖는다(기존 memberships 판정 유지)', () => {
    // 합집합 = 기존 memberships 서브쿼리 + project_members 서브쿼리 (빼기 없음 — D-CUBE 회귀 0)
    const policy = MIG.slice(MIG.indexOf('create policy member_update_actual'))
    expect(policy).toMatch(/select m\.team_id from memberships m where m\.user_id = auth\.uid\(\)/)
    expect(policy).toMatch(/from project_members pm[\s\S]*?pm\.project_id = wbs_items\.project_id[\s\S]*?pm\.user_id = auth\.uid\(\)[\s\S]*?pm\.team_id is not null/)
    const attach = MIG.slice(MIG.indexOf('create or replace function public.can_attach'))
    expect(attach).toMatch(/public\.project_members pm[\s\S]*?pm\.project_id = w\.project_id/)
  })
  it('임포트 RPC 팀 해석이 프로젝트 우선·전역 폴백 스코프다', () => {
    for (const fn of ['function import_wbs', 'function public.replace_wbs']) {
      const body = MIG.slice(MIG.indexOf(fn))
      expect(body).toMatch(/where code = v_owner->>'team'\s+and \(project_id = p_project_id or project_id is null\)\s+order by \(project_id is not null\) desc\s+limit 1/)
    }
  })
  it('role_label 컬럼과 7-인자 update_project_member_with_identity 를 추가한다', () => {
    expect(MIG).toMatch(/alter table public\.project_members add column if not exists role_label text/)
    expect(MIG).toMatch(/drop function if exists public\.update_project_member_with_identity\(\s*uuid, text, text, uuid, text, text\s*\)/)
    expect(MIG).toMatch(/p_role_label text default null/)
    expect(MIG).toMatch(/role_label = p_role_label/)
  })
  it('롤백 파일이 존재하고 프로젝트 팀 행 선행 삭제 전제를 명시한다', () => {
    expect(ROLLBACK).toMatch(/코드 롤백 선배포/)
    expect(ROLLBACK).toMatch(/project_id is not null/) // 잔존 프로젝트 팀 행 처리
    expect(ROLLBACK).toMatch(/teams_code_key/)         // 전역 유니크 원복
    expect(ROLLBACK).toMatch(/wiki_topics[\s\S]*references public\.teams\(code\)/) // 위키 FK 재추가
  })
})
