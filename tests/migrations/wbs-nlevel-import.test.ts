import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const s = () => readFileSync('supabase/migrations/0089_wbs_nlevel_import.sql', 'utf8')
const r = () => readFileSync('supabase/migrations/0089_wbs_nlevel_import_rollback.sql', 'utf8')

describe('0089 nlevel import v2.2 — level_idx·milestone·credit_key·if_id + RPC p_attach_id', () => {
  it('v2.2 컬럼 4개가 additive 로 추가된다 (weight 는 0001 기존 컬럼 재사용 — 추가 없음)', () => {
    const body = s()
    expect(body).toContain('add column if not exists level_idx smallint')
    expect(body).toContain('add column if not exists milestone boolean not null default false')
    expect(body).toContain('add column if not exists credit_key text')
    expect(body).toContain('add column if not exists if_id text')
    expect(body).not.toMatch(/add column if not exists weight/)
  })

  it('구 2인자 시그니처를 drop 한다 — PostgREST 오버로드 모호성 방지', () => {
    expect(s()).toContain('drop function if exists public.import_wbs_upsert(uuid, jsonb)')
  })

  it('RPC 시그니처에 p_attach_id uuid default null 이 있다', () => {
    expect(s()).toMatch(/p_attach_id uuid default null/)
  })

  it('parent 없는 노드는 p_attach_id 아래로 들어간다 (null 이면 종전대로 루트)', () => {
    // v_parent_ref 가 null 인 분기에서 p_attach_id 를 부모로 쓴다.
    expect(s()).toMatch(/v_parent_id := p_attach_id/)
  })

  it('RPC 가 v2.2 필드 5종을 insert 하고 재업로드 시 갱신한다(파일 소유 명세 필드)', () => {
    const body = s()
    for (const col of ['weight', 'level_idx', 'milestone', 'credit_key', 'if_id']) {
      expect(body.split('do update set')[1]?.split('returning')[0]).toContain(`${col} = excluded.${col}`)
    }
    expect(body).toContain("nullif(v_node->>'weight','')::numeric")
    expect(body).toContain("nullif(v_node->>'level_idx','')::smallint")
    expect(body).toContain("coalesce((v_node->>'milestone')::boolean, false)")
  })

  it('RPC 갱신 시 stage·assignee·actual_pct 는 여전히 덮지 않는다(필드 소유권 ⑫ 유지)', () => {
    const updateClause = s().split('do update set')[1] ?? ''
    for (const kept of ['stage', 'assignee_member_id', 'actual_pct']) {
      expect(updateClause.split('returning')[0]).not.toContain(`${kept} =`)
    }
  })

  it('rollback 이 3인자 함수를 drop 하고 0082 2인자 본문을 복원하며 컬럼 4개를 제거한다', () => {
    const body = r()
    expect(body).toContain('drop function if exists public.import_wbs_upsert(uuid, jsonb, uuid)')
    expect(body).toContain('create or replace function public.import_wbs_upsert(')
    expect(body).not.toContain('p_attach_id')
    for (const col of ['level_idx', 'milestone', 'credit_key', 'if_id']) {
      expect(body).toContain(`drop column if exists ${col}`)
    }
    expect(body).not.toMatch(/drop column if exists weight/)
  })
})
