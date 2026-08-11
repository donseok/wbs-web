import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const dir = 'supabase/migrations/'
const migration = readFileSync(`${dir}0074_notification_inbox.sql`, 'utf8')
const rollback = readFileSync(`${dir}0074_notification_inbox_rollback.sql`, 'utf8')

describe('0074 notification inbox', () => {
  it('테이블 2개를 멱등 생성한다', () => {
    expect((migration.match(/create table if not exists public\.notification_/g) ?? []).length).toBe(2)
  })
  it('recipients는 수신자 축 CHECK — member_id 또는 user_id', () => {
    expect(migration).toMatch(/check \(member_id is not null or user_id is not null\)/)
  })
  it('이벤트 dedupe·수신자 멱등 부분 유니크가 있다', () => {
    expect(migration).toMatch(/unique index if not exists notification_events_dedupe/)
    expect(migration).toMatch(/unique index if not exists notification_recipients_by_member/)
    expect(migration).toMatch(/unique index if not exists notification_recipients_by_user/)
  })
  it('배지 인덱스는 unseen 기준 부분 인덱스다', () => {
    expect(migration).toMatch(/where seen_at is null/)
  })
  it('쓰기 정책은 만들지 않는다 — select 정책 2개만', () => {
    expect(migration).not.toMatch(/for\s+(insert|update|delete)\s+to\s+authenticated/i)
    expect((migration.match(/for select to authenticated/gi) ?? []).length).toBe(2)
  })
  it('revoke/grant 잠금 세트가 테이블마다 있다', () => {
    expect((migration.match(/revoke all on table public\.notification_/g) ?? []).length).toBe(2)
    expect((migration.match(/grant all on table public\.notification_\w+ to service_role/g) ?? []).length).toBe(2)
  })
  it('purge 함수는 authenticated 실행 불가', () => {
    expect(migration).toMatch(/create or replace function public\.purge_read_notifications/)
    expect(migration).toMatch(/revoke execute on function public\.purge_read_notifications\(int\) from public, anon, authenticated/)
  })
  it('트랜잭션으로 감싼다', () => {
    expect(migration.trim()).toMatch(/^--/)
    expect(migration).toMatch(/\nbegin;/)
    expect(migration).toMatch(/\ncommit;/)
  })
  it('롤백은 자식→부모 순서로 지운다', () => {
    const ri = rollback.indexOf('notification_recipients')
    const ei = rollback.indexOf('notification_events')
    expect(ri).toBeGreaterThan(-1)
    expect(ri).toBeLessThan(ei)
    expect(rollback).toMatch(/drop function if exists public\.purge_read_notifications/)
  })
})
