import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/0051_usage_events.sql', import.meta.url),
  'utf8',
)
const rollback = readFileSync(
  new URL('../../supabase/migrations/0051_usage_events_rollback.sql', import.meta.url),
  'utf8',
)

/**
 * 주석을 걷어낸 실행 SQL. "이 헬퍼에 의존하지 않는다" 류의 단언은 실행문만 봐야 한다 —
 * 왜 안 쓰는지 설명하는 주석까지 걸리면 설명을 지우게 만드는 잘못된 압력이 생긴다.
 */
const executable = migration.replace(/^\s*--.*$/gm, '')

describe('0051 사용 현황 수집 migration 계약', () => {
  it('이벤트 테이블과 조회 인덱스 3종을 만든다', () => {
    expect(migration).toContain('create table if not exists public.usage_events')
    expect(migration).toContain('references auth.users(id) on delete cascade')
    expect(migration).toContain('references public.projects(id) on delete set null')
    expect(migration).toContain('usage_events_occurred_idx')
    expect(migration).toContain('usage_events_user_idx')
    expect(migration).toContain('usage_events_menu_idx')
  })

  it('읽기만 authenticated 에 열고 쓰기 정책은 만들지 않는다(service_role 전용)', () => {
    expect(migration).toContain('alter table public.usage_events enable row level security')
    expect(migration).toContain('create policy read_usage_events on public.usage_events')
    expect(migration).toMatch(/for select\s+to authenticated\s+using \(true\)/)
    expect(migration).not.toMatch(/create policy \w+ on public\.usage_events\s+for (insert|update|delete)/)
    // RLS 는 TRUNCATE 를 막지 못한다 — 기본 GRANT 를 통째로 회수하고 SELECT 만 되돌려준다.
    expect(migration).toContain('revoke all on public.usage_events from anon, authenticated')
    expect(migration).toContain('grant select on public.usage_events to authenticated')
  })

  it('진행 중인 권한 재설계와 충돌하지 않도록 app_role() 에 의존하지 않는다', () => {
    expect(executable).not.toContain('app_role()')
    expect(executable).not.toContain('current_team()')
  })

  it('집계 RPC 5종은 KST 일자 기준이며 인덱스를 쓸 수 있는 범위 조건을 쓴다', () => {
    for (const fn of ['usage_summary', 'usage_daily_actives', 'usage_menu_ranking', 'usage_user_rollup', 'usage_sessions']) {
      expect(migration).toContain(`create or replace function public.${fn}(`)
      expect(migration).toContain(`grant execute on function public.${fn}(`)
    }
    expect(migration).toContain("at time zone 'Asia/Seoul'")
    // 날짜 함수를 컬럼에 씌운 술어는 occurred_at 인덱스를 못 쓴다 — 범위 비교로 쓴다.
    expect(migration).not.toMatch(/where \(occurred_at at time zone 'Asia\/Seoul'\)::date/)
    expect(migration).toContain('occurred_at >= (p_from::timestamp at time zone')
  })

  it('RPC 는 security definer 가 아니다 — 호출자의 RLS 가 그대로 적용돼야 한다', () => {
    expect(executable).not.toContain('security definer')
  })

  it('접속 횟수는 사용자별로 끊는다 — 한 줄로 섞으면 동시 사용 시 1로 붕괴한다', () => {
    expect(executable).toContain('lag(occurred_at) over (partition by user_id order by occurred_at)')
    expect(executable).toContain('make_interval(mins => p_gap_minutes)')
    // 세션 시작 행 = 앞 이벤트가 없거나 간격이 임계를 넘은 행
    expect(executable).toContain('where prev_at is null')
  })

  it('롤백은 RPC·정책·테이블을 멱등하게 제거한다', () => {
    for (const fn of ['usage_summary', 'usage_daily_actives', 'usage_menu_ranking', 'usage_user_rollup', 'usage_sessions']) {
      expect(rollback).toContain(`drop function if exists public.${fn}(`)
    }
    expect(rollback).toContain('drop table if exists public.usage_events')
    expect(rollback).toMatch(/데이터 소실|경고/)
  })
})
