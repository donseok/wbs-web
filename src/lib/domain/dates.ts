function parse(d: string): Date {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day))
}
function fmt(dt: Date): string {
  return dt.toISOString().slice(0, 10)
}

/** 주말 판정의 단일 출처(스펙 §10.12 — 정의 2벌 금지). 소비: isBusinessDay·ganttScale. 요일 규칙 설정화는 P7. */
export function isWeekendDow(dow: number): boolean {
  return dow === 0 || dow === 6
}

/** '오늘'의 단일 출처(스펙 §10.19 — 15벌 흩어짐 금지). 타임존 설정화는 P7 — 지금은 Asia/Seoul 고정. */
export function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

export function isBusinessDay(date: string, holidays: Set<string>): boolean {
  const dow = parse(date).getUTCDay() // 0=일,6=토
  if (isWeekendDow(dow)) return false
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
