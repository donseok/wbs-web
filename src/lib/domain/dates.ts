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
