import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 계약 출처: docs/superpowers/specs/2026-09-16-wbs-realtime-push-design.md §7·§8·§9
const dir = 'supabase/migrations/'
const migration = readFileSync(`${dir}0098_wbs_realtime.sql`, 'utf8')
const rollback = readFileSync(`${dir}0098_wbs_realtime_rollback.sql`, 'utf8')

/** 실행되는 SQL 만 남긴다 — 주석은 위험한 형태를 "쓰지 말라"고 예시로 적으므로 금지 검사에 걸린다. */
const code = (sql: string) => sql.replace(/--[^\n]*/g, '')

describe('0098 WBS 실시간 broadcast', () => {
  it('realtime.send 를 쓴다 — postgres_changes(publication) 아님', () => {
    expect(migration).toMatch(/realtime\.send/)
    expect(migration).not.toMatch(/alter publication supabase_realtime/)
  })

  it('토픽은 프로젝트 단위 private 채널이다', () => {
    expect(migration).toMatch(/'project-' \|\| new\.project_id::text \|\| '-wbs'/)
    expect(migration).toMatch(/'wbs_changed'/)
  })

  it('페이로드는 설계 §5 의 다섯 필드다 — 순서 판정용 updated_at 포함', () => {
    for (const key of ['id', 'project_id', 'stage', 'actual_pct', 'updated_at']) {
      expect(migration).toMatch(new RegExp(`'${key}'`))
    }
  })

  it('송신 실패가 본 UPDATE 를 되돌리지 않는다 — 예외 삼킴', () => {
    expect(migration).toMatch(/exception when others then/i)
  })

  it('트리거는 of 절과 when 절을 둘 다 둔다', () => {
    // of: 무관한 컬럼 수정에서 트리거 자체를 깨우지 않는다.
    expect(migration).toMatch(/after update of stage, actual_pct on public\.wbs_items/)
    // when: 같은 값 재기록을 걸러낸다.
    expect(migration).toMatch(/old\.stage is distinct from new\.stage/)
    expect(migration).toMatch(/old\.actual_pct is distinct from new\.actual_pct/)
  })

  it('수신 인가는 realtime.messages 정책이고 판정을 is_project_member 에 위임한다', () => {
    expect(migration).toMatch(/on realtime\.messages/)
    expect(migration).toMatch(/public\.is_project_member\(/)
    // 멤버십 서브쿼리를 정책에 인라인하면 0052·0053 과 규칙이 갈라진다.
    expect(migration).not.toMatch(/from public\.project_roles/)
  })

  it('토픽의 uuid 캐스트가 RLS 안에서 예외를 던지지 않는다', () => {
    // substring(... from 9 for 36)::uuid 는 형식이 어긋난 토픽에서 예외를 낸다.
    // RLS 정책 안의 예외는 false 가 아니라 오류다 — 정규식 substring(불일치 시 NULL)을 쓴다.
    expect(code(migration)).not.toMatch(/substring\(realtime\.topic\(\) from \d+ for \d+\)/)
    expect(code(migration)).toMatch(/substring\(realtime\.topic\(\) from\s*'\^project-\(/)
    // 플래너가 조건 순서를 바꿔도 결과가 흔들리지 않도록 null 검사를 함께 둔다.
    expect(code(migration)).toMatch(/is not null/)
  })

  it('멱등하게 쓰였다', () => {
    expect(migration).toMatch(/create or replace function public\.wbs_items_broadcast/)
    expect(migration).toMatch(/drop trigger if exists wbs_items_broadcast on public\.wbs_items/)
    expect(migration).toMatch(/drop policy if exists receive_project_wbs_channel on realtime\.messages/)
  })

  it('롤백은 트리거→함수→정책을 모두 제거한다', () => {
    expect(rollback).toMatch(/drop trigger if exists wbs_items_broadcast on public\.wbs_items/)
    expect(rollback).toMatch(/drop function if exists public\.wbs_items_broadcast/)
    expect(rollback).toMatch(/drop policy if exists receive_project_wbs_channel on realtime\.messages/)
  })

  it('롤백이 저장·조회 경로를 건드리지 않는다 — 실시간만 꺼진다', () => {
    expect(rollback).not.toMatch(/alter table public\.wbs_items/)
    expect(rollback).not.toMatch(/drop (table|column)/)
  })
})
