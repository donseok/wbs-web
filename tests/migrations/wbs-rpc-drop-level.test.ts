import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/0062_wbs_rpc_drop_level.sql', 'utf8')
const rollback = readFileSync('supabase/migrations/0062_wbs_rpc_drop_level_rollback.sql', 'utf8')

describe('0062 wbs_rpc_drop_level 계약', () => {
  it('멱등(create or replace)·트랜잭션', () => {
    expect(sql).toMatch(/^begin;/m)
    expect(sql).toMatch(/^commit;/m)
    expect(rollback).toMatch(/^begin;/m)
    expect(rollback).toMatch(/^commit;/m)
  })

  it('import_wbs·replace_wbs 둘 다 재정의한다', () => {
    expect(sql).toContain('create or replace function import_wbs(')
    expect(sql).toContain('create or replace function public.replace_wbs(')
  })

  it('두 INSERT 모두 level 컬럼·v_item->>\'level\' 값을 제거했다', () => {
    const bodies = [
      sql.slice(
        sql.indexOf('create or replace function import_wbs('),
        sql.indexOf('create or replace function public.replace_wbs('),
      ),
      sql.slice(sql.indexOf('create or replace function public.replace_wbs(')),
    ]
    for (const body of bodies) {
      const insertBlock = body.slice(body.indexOf('insert into wbs_items ('), body.indexOf('returning id into v_id;'))
      expect(insertBlock).not.toMatch(/[^_]\blevel\b/) // "level" 단독 토큰 부재(sort_order 등 다른 식별자는 제외)
      expect(insertBlock).not.toContain("v_item->>'level'")
    }
  })

  it('is_owner_split 컬럼·isOwnerSplit 캐스트는 두 함수 모두 유지', () => {
    expect(sql).toContain(
      'insert into wbs_items (\n      project_id, parent_id, code, sort_order, name, biz, deliverable,\n      planned_start, planned_end, weight, actual_pct, is_owner_split\n    )',
    )
    const occurrences = sql.split("coalesce((v_item->>'isOwnerSplit')::boolean, false)").length - 1
    expect(occurrences).toBe(2)
  })

  it('replace_wbs 는 선행 delete 를 그대로 유지한다', () => {
    const body = sql.slice(sql.indexOf('create or replace function public.replace_wbs('))
    const deleteIdx = body.indexOf('delete from public.wbs_items where project_id = p_project_id;')
    const loopIdx = body.indexOf('for v_item in')
    expect(deleteIdx).toBeGreaterThan(-1)
    expect(loopIdx).toBeGreaterThan(deleteIdx)
  })

  it('project_settings.excel_profile 백필을 재실행하지 않는다', () => {
    expect(sql).not.toMatch(/update\s+public\.project_settings/i)
    expect(sql).not.toMatch(/set\s+excel_profile\s*=/i)
  })

  it('롤백은 두 함수 모두 level insert 를 복원한다', () => {
    expect(rollback).toContain('create or replace function import_wbs(')
    expect(rollback).toContain('create or replace function public.replace_wbs(')
    expect(rollback).toContain(
      'insert into wbs_items (\n      project_id, parent_id, level, code, sort_order, name, biz, deliverable,\n      planned_start, planned_end, weight, actual_pct, is_owner_split\n    )',
    )
    const valuesOccurrences = rollback.split("p_project_id, v_parent, v_item->>'level', v_item->>'code',").length - 1
    expect(valuesOccurrences).toBe(2)
  })

  it('롤백도 project_settings 백필은 건드리지 않는다', () => {
    expect(rollback).not.toMatch(/update\s+public\.project_settings/i)
  })
})
