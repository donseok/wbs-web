import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/0076_minute_folders_project.sql', import.meta.url), 'utf8')
const rollback = readFileSync(
  new URL('../../supabase/migrations/0076_minute_folders_project_rollback.sql', import.meta.url), 'utf8')

describe('0076 minute_folders 프로젝트 소속 migration 계약', () => {
  it('project_id 컬럼과 스코프별 루트 유니크 인덱스를 만든다', () => {
    expect(migration).toContain('add column if not exists project_id uuid')
    expect(migration).toContain('references projects(id) on delete cascade')
    // 기존 전역 루트 유니크는 시드 삽입 전에 반드시 해체돼야 한다(프로젝트 루트가 전역 루트와 동명)
    expect(migration.indexOf('drop index if exists minute_folders_root_name_uniq'))
      .toBeLessThan(migration.indexOf('insert into minute_folders'))
    expect(migration).toContain('minute_folders_root_name_null_proj_uniq')
    expect(migration).toContain('minute_folders_root_name_proj_uniq')
  })

  it('시드는 유효 팀 마스터(프로젝트 팀 있으면 그것, 없으면 전역 활성 팀)를 따른다', () => {
    expect(migration).toMatch(/where\s+active\s+and\s+project_id\s*=\s*p\.id/)
    expect(migration).toMatch(/where\s+active\s+and\s+project_id\s+is\s+null/)
    expect(migration).toContain('not exists (select 1 from teams t2 where t2.project_id = p.id')
    // 시드 표식: created_by 미지정(null) — 0043 스쿼팅 방어 관례
    expect(migration).not.toMatch(/insert into minute_folders[^;]*created_by/s)
  })

  it('롤백은 프로젝트 루트 삭제 → 인덱스 원복 → 컬럼 drop 순서다(동명 충돌 방지)', () => {
    const delAt = rollback.indexOf('delete from minute_folders where project_id is not null')
    const uniqAt = rollback.indexOf('create unique index if not exists minute_folders_root_name_uniq')
    const dropColAt = rollback.indexOf('drop column if exists project_id')
    expect(delAt).toBeGreaterThan(-1)
    expect(uniqAt).toBeGreaterThan(delAt)
    expect(dropColAt).toBeGreaterThan(uniqAt)
  })
})
