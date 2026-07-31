import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/0060_import_wbs_owner_split.sql', 'utf8')
const rollback = readFileSync('supabase/migrations/0060_import_wbs_owner_split_rollback.sql', 'utf8')

describe('0060 import_wbs_owner_split 계약', () => {
  it('멱등(create or replace)·트랜잭션', () => {
    expect(sql).toMatch(/^begin;/m)
    expect(sql).toMatch(/^commit;/m)
    expect(sql).toContain('create or replace function import_wbs(')
    expect(rollback).toMatch(/^begin;/m)
    expect(rollback).toMatch(/^commit;/m)
    expect(rollback).toContain('create or replace function import_wbs(')
  })

  it('시그니처(인자·반환형)는 0006 과 동일 — 호출부 변경 불필요', () => {
    expect(sql).toContain('p_project_id uuid,')
    expect(sql).toContain('p_items jsonb,')
    expect(sql).toContain('p_holidays jsonb')
    expect(sql).toContain(') returns integer')
  })

  it('insert 컬럼 화이트리스트에 is_owner_split 추가', () => {
    expect(sql).toContain(
      'insert into wbs_items (\n      project_id, parent_id, level, code, sort_order, name, biz, deliverable,\n      planned_start, planned_end, weight, actual_pct, is_owner_split\n    )',
    )
  })

  it('isOwnerSplit jsonb 키를 boolean 캐스트 + 기본값 false 로 읽는다', () => {
    expect(sql).toContain("coalesce((v_item->>'isOwnerSplit')::boolean, false)")
  })

  it('owners 순회·holidays upsert 로직은 0006 과 동일하게 보존', () => {
    expect(sql).toContain("for v_owner in select value from jsonb_array_elements(coalesce(v_item->'owners', '[]'::jsonb)) as t(value)")
    expect(sql).toContain('on conflict (project_id, date) do update set name = excluded.name')
  })

  it('롤백: is_owner_split 을 다시 빼 0006 원문으로 복원', () => {
    // 함수 본문(create or replace 블록)에는 is_owner_split 이 없어야 한다 — 설명 주석은 예외.
    const body = rollback.slice(rollback.indexOf('create or replace function'))
    expect(body).not.toContain('is_owner_split')
    expect(rollback).toContain(
      'insert into wbs_items (\n      project_id, parent_id, level, code, sort_order, name, biz, deliverable,\n      planned_start, planned_end, weight, actual_pct\n    )',
    )
  })
})
