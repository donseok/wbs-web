import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LEGACY_DCUBE_PROFILE } from '@/lib/excel/profile'

const sql = readFileSync('supabase/migrations/0061_replace_wbs_and_profile.sql', 'utf8')
const rollback = readFileSync('supabase/migrations/0061_replace_wbs_and_profile_rollback.sql', 'utf8')

describe('0061 replace_wbs + excel_profile 백필 계약', () => {
  it('멱등(create or replace)·트랜잭션', () => {
    expect(sql).toMatch(/^begin;/m)
    expect(sql).toMatch(/^commit;/m)
    expect(sql).toContain('create or replace function public.replace_wbs(')
    expect(rollback).toMatch(/^begin;/m)
    expect(rollback).toMatch(/^commit;/m)
  })

  it('시그니처(인자·반환형) — replace_wbs(uuid, jsonb, jsonb) returns integer', () => {
    expect(sql).toContain('p_project_id uuid,')
    expect(sql).toContain('p_items jsonb,')
    expect(sql).toContain('p_holidays jsonb')
    expect(sql).toContain(') returns integer')
  })

  it('서두에 해당 프로젝트 wbs_items 전량 delete — "교체" 시맨틱', () => {
    const body = sql.slice(sql.indexOf('create or replace function public.replace_wbs('))
    const deleteIdx = body.indexOf('delete from public.wbs_items where project_id = p_project_id;')
    const beginIdx = body.indexOf('\nbegin\n')
    expect(deleteIdx).toBeGreaterThan(-1)
    // delete 는 함수 본문의 최초 실행문이어야 한다(루프 이전).
    expect(deleteIdx).toBeGreaterThan(beginIdx)
    expect(body.indexOf('for v_item in')).toBeGreaterThan(deleteIdx)
  })

  it('import_wbs 는 무접촉 — 이 마이그레이션이 재정의하지 않는다', () => {
    expect(sql).not.toContain('create or replace function public.import_wbs')
    expect(sql).not.toContain('create or replace function import_wbs')
  })

  it('insert 컬럼 화이트리스트에 is_owner_split 포함(0060 계약 승계)', () => {
    expect(sql).toContain(
      'insert into wbs_items (\n      project_id, parent_id, level, code, sort_order, name, biz, deliverable,\n      planned_start, planned_end, weight, actual_pct, is_owner_split\n    )',
    )
    expect(sql).toContain("coalesce((v_item->>'isOwnerSplit')::boolean, false)")
  })

  it('owners 순회·holidays upsert 로직은 import_wbs 와 동일하게 보존', () => {
    expect(sql).toContain("for v_owner in select value from jsonb_array_elements(coalesce(v_item->'owners', '[]'::jsonb)) as t(value)")
    expect(sql).toContain('on conflict (project_id, date) do update set name = excluded.name')
  })

  it('change_logs cascade 삭제·백업 무책임을 함수 주석에 명시(Q1)', () => {
    expect(sql).toMatch(/change_logs[\s\S]*cascade/)
    expect(sql).toMatch(/백업/)
  })

  it('권한 게이트 — 관리자 검사·SECURITY DEFINER 없이 import_wbs 와 동일 방식(RLS 위임)', () => {
    const body = sql.slice(sql.indexOf('create or replace function public.replace_wbs('))
    expect(body).not.toContain('security definer')
    expect(body).not.toMatch(/if\s+.*app_role|is_project_admin\(/)
  })

  it('excel_profile 백필 — 이중 조건(preset_applied + excel_profile 미커스텀)', () => {
    expect(sql).toContain("where preset_applied = 'legacy-dcube' and excel_profile = '{}'::jsonb;")
  })

  it('백필 JSON 은 LEGACY_DCUBE_PROFILE 을 그대로 직렬화한 값과 일치한다(키 순서 무관)', () => {
    const m = sql.match(/set excel_profile = '(.+?)'::jsonb/)
    expect(m).not.toBeNull()
    const backfilled = JSON.parse(m![1])
    expect(backfilled).toEqual(LEGACY_DCUBE_PROFILE)
  })

  it('롤백은 함수 drop 만 — 백필 원복 없음(설정 파괴 방지 사유 주석 포함)', () => {
    expect(rollback).toContain('drop function if exists public.replace_wbs(uuid, jsonb, jsonb);')
    // 백필을 되돌리는 실행문(project_settings UPDATE)이 없어야 한다 — 사유를 설명하는 주석의 존재는 허용.
    expect(rollback).not.toMatch(/update\s+public\.project_settings/i)
    expect(rollback).not.toMatch(/set\s+excel_profile\s*=/i)
    expect(rollback).toMatch(/원복하지 않는다|백필.*(없|않)/)
  })
})
