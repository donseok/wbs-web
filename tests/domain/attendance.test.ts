import { describe, it, expect } from 'vitest'
import { summarize, monthMatrix, recordsByDate, ATTENDANCE_META } from '@/lib/domain/attendance'
import type { AttendanceRecord, AttendanceType } from '@/lib/domain/types'

function rec(id: string, date: string, type: AttendanceType, memberId = 'm1'): AttendanceRecord {
  return { id, projectId: 'p1', memberId, date, type, note: null }
}

describe('summarize', () => {
  it('counts total / leave(annual+half+sick) / trip / remote', () => {
    const records = [
      rec('1', '2026-09-01', 'annual'),
      rec('2', '2026-09-02', 'half'),
      rec('3', '2026-09-03', 'sick'),
      rec('4', '2026-09-04', 'trip'),
      rec('5', '2026-09-05', 'remote'),
      rec('6', '2026-09-06', 'work'),
      rec('7', '2026-09-07', 'official'),
    ]
    expect(summarize(records)).toEqual({ total: 7, leave: 3, trip: 1, remote: 1 })
  })

  it('returns zeros for empty input', () => {
    expect(summarize([])).toEqual({ total: 0, leave: 0, trip: 0, remote: 0 })
  })
})

describe('monthMatrix', () => {
  it('returns a 6×7 grid', () => {
    const m = monthMatrix(2026, 8) // 2026-09
    expect(m).toHaveLength(6)
    m.forEach(week => expect(week).toHaveLength(7))
  })

  it('starts the grid on the Sunday on/before the 1st', () => {
    // 2026-09-01 is a Tuesday -> grid starts Sun 2026-08-30
    const m = monthMatrix(2026, 8)
    expect(m[0][0]).toBe('2026-08-30')
    expect(m[0][2]).toBe('2026-09-01')
  })

  it('contains every day of the month', () => {
    const flat = monthMatrix(2026, 8).flat()
    expect(flat).toContain('2026-09-15')
    expect(flat).toContain('2026-09-30')
  })

  it('handles January (month0=0) with year rollover at the start', () => {
    const m = monthMatrix(2026, 0) // 2026-01, Jan 1 2026 is Thursday
    expect(m[0][0]).toBe('2025-12-28')
    expect(m.flat()).toContain('2026-01-31')
  })

  it('handles December (month0=11) with year rollover at the end', () => {
    const flat = monthMatrix(2026, 11).flat()
    expect(flat).toContain('2026-12-31')
    expect(flat).toContain('2027-01-01')
  })
})

describe('recordsByDate', () => {
  it('groups records by their date key', () => {
    const a = rec('1', '2026-09-15', 'trip', 'm3')
    const b = rec('2', '2026-09-15', 'remote', 'm4')
    const c = rec('3', '2026-09-16', 'annual', 'm1')
    const grouped = recordsByDate([a, b, c])
    expect(grouped['2026-09-15']).toEqual([a, b])
    expect(grouped['2026-09-16']).toEqual([c])
    expect(grouped['2026-09-17']).toBeUndefined()
  })

  it('returns an empty object for no records', () => {
    expect(recordsByDate([])).toEqual({})
  })
})

describe('ATTENDANCE_META', () => {
  it('has an entry with korean label for every attendance type', () => {
    const types: AttendanceType[] = ['work', 'remote', 'annual', 'half', 'sick', 'trip', 'official', 'absent']
    for (const t of types) {
      expect(ATTENDANCE_META[t]).toBeTruthy()
      expect(ATTENDANCE_META[t].label.length).toBeGreaterThan(0)
      expect(ATTENDANCE_META[t].dot).toMatch(/^bg-/)
    }
  })
})
