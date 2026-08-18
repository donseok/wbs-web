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
  return seoulYmd(new Date())
}

/** 임의 시각의 서울 기준 'YYYY-MM-DD'. seoulToday 와 같은 관용구의 인자 버전 — 사본 금지(P7). */
export function seoulYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(date)
}

/**
 * 서울 기준 'YYYY-MM-DD HH:mm' 스탬프 — 보고서/메일 공용. "(한국 시간)" 등 접미는 호출부가 붙인다.
 * 로케일 'en-CA' 는 통합 전 사본들이 쓰던 값 그대로다 — 조합은 formatToParts 로 직접 하므로
 * 로케일이 바꾸는 건 리터럴이 아니라 시간주기뿐이고, 그래서 취향으로 갈아끼우면 안 된다.
 * 자정이 '00:00' 이냐 '24:00' 이냐가 hour12:false → h23 이라는 ICU 해석에 걸려 있다
 * (tests/domain/dates.test.ts 자정 경계 테스트가 안전망). 명시하고 싶으면 hour12 를 빼고
 * hourCycle:'h23' 하나만 줄 것 — 둘을 같이 주면 서로 덮어써 결과가 환경 의존이 된다.
 */
export function seoulStamp(at: Date | string = new Date()): string {
  const d = typeof at === 'string' ? new Date(at) : at
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/** 'YYYY-MM-DD' + n일. Date.UTC 가 월/연 경계를 자동 처리. (사본 5벌 흡수 — 이 파일이 단일 출처) */
export function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  const pad2 = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`
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
