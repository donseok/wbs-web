import { describe, expect, it } from 'vitest'
import {
  addDaysIso, parsePeriodDays, fillDailySeries, mergeUserRows, countSessions, barPct,
  SESSION_GAP_MINUTES, type AccountRecord, type UserRollup,
} from '@/lib/domain/usage'

describe('addDaysIso', () => {
  it('월·연 경계를 넘는다', () => {
    expect(addDaysIso('2026-07-30', 3)).toBe('2026-08-02')
    expect(addDaysIso('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDaysIso('2026-07-30', 0)).toBe('2026-07-30')
  })
})

describe('parsePeriodDays — 신뢰할 수 없는 쿼리스트링', () => {
  it('허용된 값만 통과', () => {
    expect(parsePeriodDays('7')).toBe(7)
    expect(parsePeriodDays('90')).toBe(90)
  })
  it('그 외는 기본 30일', () => {
    for (const v of [undefined, '', '31', 'abc', '-7', '99999']) {
      expect(parsePeriodDays(v)).toBe(30)
    }
  })
})

describe('fillDailySeries — 빈 날짜를 0으로 메운다', () => {
  it('구간 전체 길이를 보장하고 순서를 맞춘다', () => {
    const out = fillDailySeries(
      [{ d: '2026-07-30', activeUsers: 3, events: 12 }],
      '2026-07-28', '2026-07-31',
    )
    expect(out.map(r => r.d)).toEqual(['2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'])
    expect(out.map(r => r.activeUsers)).toEqual([0, 0, 3, 0])
    expect(out.map(r => r.events)).toEqual([0, 0, 12, 0])
  })

  it('데이터가 하나도 없어도 구간 길이만큼 0을 만든다', () => {
    expect(fillDailySeries([], '2026-07-30', '2026-07-31')).toHaveLength(2)
  })

  it('구간 밖 데이터는 버린다', () => {
    const out = fillDailySeries(
      [{ d: '2026-01-01', activeUsers: 9, events: 9 }],
      '2026-07-30', '2026-07-30',
    )
    expect(out).toEqual([{ d: '2026-07-30', activeUsers: 0, events: 0 }])
  })
})

const ACC = (id: string, name: string): AccountRecord => ({
  id, email: `${id}@x.com`, name, teamCode: 'PMO', role: 'team_editor',
  createdAt: '2026-01-01T00:00:00Z', lastSignInAt: null,
})

describe('mergeUserRows — 활동이 0인 계정도 사라지지 않는다', () => {
  const accounts = [ACC('u1', '가나'), ACC('u2', '다라'), ACC('u3', '마바')]
  const rollups: UserRollup[] = [
    { userId: 'u2', events: 40, activeDays: 5, lastAt: '2026-07-30T01:00:00Z' },
    { userId: 'u1', events: 10, activeDays: 2, lastAt: '2026-07-29T01:00:00Z' },
  ]

  it('계정 전체를 유지하고 활동 없는 계정은 0/null 로 채운다', () => {
    const rows = mergeUserRows(accounts, rollups)
    expect(rows).toHaveLength(3)
    const u3 = rows.find(r => r.id === 'u3')!
    expect(u3.events).toBe(0)
    expect(u3.activeDays).toBe(0)
    expect(u3.lastActivityAt).toBeNull()
  })

  it('조회수 내림차순, 동률이면 이름순', () => {
    expect(mergeUserRows(accounts, rollups).map(r => r.id)).toEqual(['u2', 'u1', 'u3'])
  })

  it('계정 목록에 없는 롤업(탈퇴 직후 등)은 버리지 않고 무시한다 — 행 수는 계정 수', () => {
    const rows = mergeUserRows(accounts, [
      ...rollups, { userId: 'ghost', events: 999, activeDays: 9, lastAt: null },
    ])
    expect(rows).toHaveLength(3)
    expect(rows.some(r => r.id === 'ghost')).toBe(false)
  })
})

describe('countSessions — 로그인 이벤트가 없으므로 무활동 간격으로 유도한다', () => {
  it('기본 간격은 30분', () => {
    expect(SESSION_GAP_MINUTES).toBe(30)
  })

  it('간격 이내 연속 이벤트는 한 접속', () => {
    expect(countSessions([
      '2026-07-30T01:00:00Z', '2026-07-30T01:20:00Z', '2026-07-30T01:45:00Z',
    ])).toBe(1)
  })

  it('간격을 넘으면 새 접속', () => {
    expect(countSessions([
      '2026-07-30T01:00:00Z', '2026-07-30T02:00:00Z', '2026-07-30T02:10:00Z',
    ])).toBe(2)
  })

  it('정확히 경계값(30분)은 같은 접속으로 본다', () => {
    expect(countSessions(['2026-07-30T01:00:00Z', '2026-07-30T01:30:00Z'])).toBe(1)
  })

  it('순서가 뒤섞여 들어와도 정렬해서 센다', () => {
    expect(countSessions(['2026-07-30T02:00:00Z', '2026-07-30T01:00:00Z'])).toBe(2)
  })

  it('빈 입력은 0', () => {
    expect(countSessions([])).toBe(0)
  })
})

describe('barPct — 막대 길이', () => {
  it('최대값 대비 비율(소수 1자리)', () => {
    expect(barPct(5, 20)).toBe(25)
    expect(barPct(1, 3)).toBe(33.3)
  })
  it('최대가 0이면 0 (0으로 나누지 않는다)', () => {
    expect(barPct(0, 0)).toBe(0)
  })
})
