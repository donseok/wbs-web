import { describe, it, expect } from 'vitest'
import { composeAnnouncementFromMeeting } from '@/lib/domain/announcements'

const base = {
  title: '주간 동기화',
  occurrenceDate: '2026-07-20',
  startTime: '14:00',
  endTime: '15:00',
  location: '3F 회의실',
  body: '안건: 릴리스 점검',
}

describe('composeAnnouncementFromMeeting', () => {
  it('시간 범위·장소·본문이 모두 있으면 라벨 줄 + 본문을 조합한다', () => {
    const r = composeAnnouncementFromMeeting(base, '2026-07-17')
    expect(r.title).toBe('주간 동기화')
    expect(r.body).toBe('일시: 2026-07-20 14:00–15:00\n장소: 3F 회의실\n\n안건: 릴리스 점검')
    expect(r.category).toBe('general')
    expect(r.isPinned).toBe(false)
    expect(r.publishFrom).toBe('2026-07-17')
    expect(r.publishTo).toBe('2026-07-20') // max(오늘, 회차일)
  })

  it('종일 회의는 시간 대신 (종일)로 표기', () => {
    const r = composeAnnouncementFromMeeting({ ...base, startTime: null, endTime: null }, '2026-07-17')
    expect(r.body.startsWith('일시: 2026-07-20 (종일)')).toBe(true)
  })

  it('시작만 있고 종료 없으면 시작 시각만', () => {
    const r = composeAnnouncementFromMeeting({ ...base, endTime: null }, '2026-07-17')
    expect(r.body.startsWith('일시: 2026-07-20 14:00\n')).toBe(true)
  })

  it('장소 없으면 장소 줄 생략', () => {
    const r = composeAnnouncementFromMeeting({ ...base, location: null }, '2026-07-17')
    expect(r.body).toBe('일시: 2026-07-20 14:00–15:00\n\n안건: 릴리스 점검')
  })

  it('본문 없으면 라벨 줄만 남기고 뒤 공백 없음', () => {
    const r = composeAnnouncementFromMeeting({ ...base, body: '   ' }, '2026-07-17')
    expect(r.body).toBe('일시: 2026-07-20 14:00–15:00\n장소: 3F 회의실')
  })

  it('회차일이 과거면 publishTo는 오늘로 클램프', () => {
    const r = composeAnnouncementFromMeeting({ ...base, occurrenceDate: '2026-07-10' }, '2026-07-17')
    expect(r.publishFrom).toBe('2026-07-17')
    expect(r.publishTo).toBe('2026-07-17')
  })
})
