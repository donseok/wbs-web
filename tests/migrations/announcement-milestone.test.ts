import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const dir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
const migration = readFileSync(`${dir}0091_announcement_milestone.sql`, 'utf8')
const rollback = readFileSync(`${dir}0091_announcement_milestone_rollback.sql`, 'utf8')

describe('0091 공지 마일스톤 일자', () => {
  it('additive · 멱등 — null 허용 date 컬럼 하나만 더한다(문장 기준, 주석 제외)', () => {
    const stmt = migration.match(/alter table public\.announcements\s+add column if not exists milestone_date date[^;]*;/)
    expect(stmt).not.toBeNull()
    expect(stmt![0]).not.toMatch(/not null|default/i)
    expect((migration.match(/alter table/g) ?? []).length).toBe(1)
  })
  it('컬럼 주석으로 계약(null = 타임라인 미표시)을 남긴다', () => {
    expect(migration).toContain('comment on column public.announcements.milestone_date')
    expect(migration).toMatch(/null/)
  })
  it('롤백은 컬럼을 지우고 데이터 소실을 경고한다', () => {
    expect(rollback).toMatch(/alter table public\.announcements\s+drop column if exists milestone_date;/)
    expect(rollback).toMatch(/경고|지워진다/)
  })
})
