import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/0064_drop_wbs_level.sql', 'utf8')
const rollback = readFileSync('supabase/migrations/0064_drop_wbs_level_rollback.sql', 'utf8')

describe('0064 drop_wbs_level 계약', () => {
  it('트랜잭션으로 감싼다', () => {
    expect(sql).toMatch(/^begin;/m)
    expect(sql).toMatch(/^commit;/m)
    expect(rollback).toMatch(/^begin;/m)
    expect(rollback).toMatch(/^commit;/m)
  })

  it('wbs_items.level 컬럼을 drop 한다(멱등)', () => {
    expect(sql).toMatch(/alter table public\.wbs_items\s+drop column if exists level/)
  })

  it('level 외 다른 컬럼을 건드리지 않는다', () => {
    // 주석을 제거한 실제 DDL 만 검사한다(주석엔 parent_id·is_owner_split 설명이 있음).
    const ddl = sql.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n')
    // drop 문은 단 하나여야 한다 — 인접 컬럼(is_owner_split 등) 오drop 방지
    const drops = ddl.match(/drop column/g) ?? []
    expect(drops).toHaveLength(1)
    expect(ddl).not.toMatch(/is_owner_split|parent_id|actual_pct/)
  })

  it('롤백은 level 컬럼을 nullable 로 되살린다', () => {
    expect(rollback).toMatch(/alter table public\.wbs_items\s+add column if not exists level text/)
    // NOT NULL 로 되살리면 안 된다 — 데이터가 없어 기존 행이 위반한다
    expect(rollback).not.toMatch(/level text\s+not null/i)
  })

  it('롤백은 데이터 복원을 시도하지 않는다(값 소실은 비가역)', () => {
    expect(rollback).not.toMatch(/update .*wbs_items.*set level/i)
  })
})
