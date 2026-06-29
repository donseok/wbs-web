import type { AttendanceRecord, AttendanceType } from '@/lib/domain/types'

/**
 * 근태 타입별 메타데이터 — 라벨(한글) + 짧은 라벨 + 색상 클래스(점/칩).
 * 색상은 status/team 팔레트를 재사용해 라이트·다크 모두 자동 대응한다.
 */
export const ATTENDANCE_META: Record<AttendanceType, { label: string; short: string; dot: string; chip: string }> = {
  work:     { label: '정상근무', short: '근무', dot: 'bg-done',             chip: 'bg-done-weak text-done' },
  remote:   { label: '재택',     short: '재택', dot: 'bg-brand',            chip: 'bg-brand-weak text-brand' },
  annual:   { label: '연차',     short: '연차', dot: 'bg-progress',         chip: 'bg-progress-weak text-progress' },
  half:     { label: '반차',     short: '반차', dot: 'bg-progress',         chip: 'bg-progress-weak text-progress' },
  sick:     { label: '병가',     short: '병가', dot: 'bg-delayed',          chip: 'bg-delayed-weak text-delayed' },
  trip:     { label: '출장',     short: '출장', dot: 'bg-accent-secondary', chip: 'bg-accent-secondary/15 text-accent-secondary' },
  official: { label: '공가',     short: '공가', dot: 'bg-pending',          chip: 'bg-pending-weak text-pending' },
  absent:   { label: '결근',     short: '결근', dot: 'bg-delayed',          chip: 'bg-delayed-weak text-delayed' },
}

/** 근태 타입 표시 순서 (등록 셀렉트/범례용) */
export const ATTENDANCE_TYPES: AttendanceType[] = [
  'work', 'remote', 'annual', 'half', 'sick', 'trip', 'official', 'absent',
]

/**
 * 기록 집계 — total=전체, leave=연차·반차·병가, trip=출장, remote=재택.
 */
export function summarize(records: AttendanceRecord[]): { total: number; leave: number; trip: number; remote: number } {
  let leave = 0
  let trip = 0
  let remote = 0
  for (const r of records) {
    if (r.type === 'annual' || r.type === 'half' || r.type === 'sick') leave++
    else if (r.type === 'trip') trip++
    else if (r.type === 'remote') remote++
  }
  return { total: records.length, leave, trip, remote }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function fmtUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/**
 * month0(0-based) 월을 덮는 6×7 'YYYY-MM-DD' 그리드. 주 시작은 일요일.
 * UTC 날짜 연산으로 타임존 영향을 받지 않게 계산한다.
 */
export function monthMatrix(year: number, month0: number): string[][] {
  const first = new Date(Date.UTC(year, month0, 1))
  const startDow = first.getUTCDay() // 0=일요일
  const weeks: string[][] = []
  for (let w = 0; w < 6; w++) {
    const row: string[] = []
    for (let d = 0; d < 7; d++) {
      // 그리드 시작(첫 주 일요일) 기준 day 오프셋 — Date.UTC가 월/연 경계를 자동 처리
      const cell = new Date(Date.UTC(year, month0, 1 - startDow + w * 7 + d))
      row.push(fmtUTC(cell))
    }
    weeks.push(row)
  }
  return weeks
}

/** 날짜('YYYY-MM-DD')별로 기록을 묶는다. */
export function recordsByDate(records: AttendanceRecord[]): Record<string, AttendanceRecord[]> {
  const out: Record<string, AttendanceRecord[]> = {}
  for (const r of records) {
    const bucket = out[r.date] ?? (out[r.date] = [])
    bucket.push(r)
  }
  return out
}
