function parse(d: string): Date {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day))
}
function fmt(dt: Date): string {
  return dt.toISOString().slice(0, 10)
}

export function isBusinessDay(date: string, holidays: Set<string>): boolean {
  const dow = parse(date).getUTCDay() // 0=일,6=토
  if (dow === 0 || dow === 6) return false
  return !holidays.has(date)
}

export function businessDaysBetween(start: string, end: string, holidays: Set<string>): number {
  const s = parse(start), e = parse(end)
  if (e < s) return 0
  let count = 0
  for (let cur = new Date(s); cur <= e; cur.setUTCDate(cur.getUTCDate() + 1)) {
    if (isBusinessDay(fmt(cur), holidays)) count++
  }
  return count
}

/** 창 [start, end] 안에서 O(1) 업무일 계산. 창 밖은 businessDaysBetween으로 폴백. */
export interface BizDayIndex {
  /** a..b 양끝 포함 업무일 수. b < a 이면 0. */
  between(a: string, b: string): number
}

export function makeBizDayIndex(start: string, end: string, holidays: Set<string>): BizDayIndex {
  // cum[d] = start..d(포함) 업무일 수
  const cum = new Map<string, number>()
  let n = 0
  const endDt = parse(end)
  for (const cur = parse(start); cur <= endDt; cur.setUTCDate(cur.getUTCDate() + 1)) {
    const d = fmt(cur)
    if (isBusinessDay(d, holidays)) n++
    cum.set(d, n)
  }
  const first = start, last = end
  return {
    between(a: string, b: string): number {
      if (b < a) return 0
      if (a < first || b > last) return businessDaysBetween(a, b, holidays)
      // between(a,b) = cum(b) − cum(a) + (a가 업무일이면 1)
      return cum.get(b)! - cum.get(a)! + (isBusinessDay(a, holidays) ? 1 : 0)
    },
  }
}
