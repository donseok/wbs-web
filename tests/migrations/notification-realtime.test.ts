import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const dir = 'supabase/migrations/'
const migration = readFileSync(`${dir}0075_notification_realtime.sql`, 'utf8')
const rollback = readFileSync(`${dir}0075_notification_realtime_rollback.sql`, 'utf8')

describe('0075 notification realtime', () => {
  it('realtime.send 를 쓴다 — postgres_changes(publication) 아님', () => {
    expect(migration).toMatch(/realtime\.send/)
    expect(migration).not.toMatch(/alter publication supabase_realtime/)
  })
  it('user_id 없는 행(미링크 로스터)은 송신 생략', () => {
    expect(migration).toMatch(/new\.user_id is not null/)
  })
  it('송신 실패가 insert 를 실패시키지 않는다 — 예외 삼킴', () => {
    expect(migration).toMatch(/exception when others then/i)
  })
  it('private 채널 수신 정책 — 본인 토픽 한정', () => {
    expect(migration).toMatch(/on realtime\.messages/)
    expect(migration).toMatch(/realtime\.topic\(\) = 'user-' \|\| \(select auth\.uid\(\)\)::text \|\| '-notifications'/)
  })
  it('롤백은 트리거→함수→정책 순 제거', () => {
    expect(rollback).toMatch(/drop trigger if exists notify_recipient_broadcast/)
    expect(rollback).toMatch(/drop function if exists public\.notify_recipient_broadcast/)
    expect(rollback).toMatch(/drop policy if exists receive_own_notification_channel on realtime\.messages/)
  })
})
