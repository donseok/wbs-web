import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/0059_level_uncheck_owner_split.sql', 'utf8')
const rollback = readFileSync('supabase/migrations/0059_level_uncheck_owner_split_rollback.sql', 'utf8')

describe('0059 level_uncheck_owner_split 계약', () => {
  it('멱등·트랜잭션', () => {
    expect(sql).toMatch(/^begin;/m)
    expect(sql).toMatch(/^commit;/m)
    expect(rollback).toMatch(/^begin;/m)
    expect(rollback).toMatch(/^commit;/m)
  })

  it('CHECK 제약 해제', () => {
    expect(sql).toContain('drop constraint if exists wbs_items_level_check')
  })

  it('level NOT NULL 해제', () => {
    expect(sql).toContain('alter column level drop not null')
  })

  it('DEPRECATED 코멘트 추가', () => {
    expect(sql).toContain('comment on column public.wbs_items.level is')
    expect(sql).toContain('DEPRECATED')
    expect(sql).toContain('parent_id 트리다')
  })

  it('is_owner_split 컬럼 추가 (멱등)', () => {
    expect(sql).toContain('add column if not exists is_owner_split boolean not null default false')
  })

  it('백필: 부모-자식 activity 구분 (§5.2)', () => {
    expect(sql).toContain('update public.wbs_items c set is_owner_split = true')
    expect(sql).toContain('from public.wbs_items p')
    expect(sql).toContain("where c.parent_id = p.id and c.level = 'activity' and p.level = 'activity'")
    expect(sql).toContain('and c.is_owner_split = false')
  })

  it('롤백: level 값 검증 — 위반 행 중단', () => {
    expect(rollback).toContain('select count(*) into bad from public.wbs_items')
    expect(rollback).toContain("where level is null or level not in ('phase','task','activity')")
    expect(rollback).toContain("raise exception '0059 롤백 중단")
  })

  it('롤백: NOT NULL 복원 + CHECK 제약 복원', () => {
    expect(rollback).toContain('alter column level set not null')
    expect(rollback).toContain('add constraint wbs_items_level_check')
    expect(rollback).toContain("check (level in ('phase','task','activity'))")
  })

  it('롤백: is_owner_split 컬럼 제거 (멱등)', () => {
    expect(rollback).toContain('drop column if exists is_owner_split')
  })
})
