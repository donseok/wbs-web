import { round1 } from './format'

/** 원시 이벤트 보존 기간(일). 이 값을 넘긴 행은 /usage 조회 시 정리된다. */
export const USAGE_RETAIN_DAYS = 90

/**
 * 접속 1회로 묶는 무활동 간격(분).
 * 로그인은 클라이언트에서 signInWithPassword() 로 처리돼 서버에 기록이 남지 않는다.
 * 그래서 '접속 횟수'는 관측값이 아니라 이 간격으로 유도한 값이며, 화면에 그 사실을 밝힌다.
 */
export const SESSION_GAP_MINUTES = 30

/** 기간 선택지(일). */
export const PERIOD_OPTIONS = [7, 30, 90] as const

export interface UsageSummary {
  totalEvents: number
  activeUsers: number
  todayUsers: number
  /** 전체 기간 기준 마지막 이벤트 — 수집이 끊겼는지 판정하는 근거. */
  lastEventAt: string | null
}

export interface DailyActive { d: string; activeUsers: number; events: number }
export interface MenuRank { menuKey: string; events: number; activeUsers: number }
export interface UserRollup { userId: string; events: number; activeDays: number; lastAt: string | null }

export interface AccountRecord {
  id: string
  email: string
  name: string
  teamCode: string | null
  role: string | null
  createdAt: string
  /** auth.users.last_sign_in_at — 수집 시작 이전까지 소급되는 유일한 데이터. */
  lastSignInAt: string | null
}

export interface UsageUserRow extends AccountRecord {
  events: number
  activeDays: number
  lastActivityAt: string | null
}

/** 'YYYY-MM-DD' + n일. Date.UTC 가 월/연 경계를 자동 처리. */
export function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  const pad2 = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`
}

/** 쿼리스트링은 신뢰할 수 없다 — 허용 목록에 없으면 기본 30일. */
export function parsePeriodDays(raw: string | undefined): number {
  const n = Number(raw)
  return (PERIOD_OPTIONS as readonly number[]).includes(n) ? n : 30
}

/**
 * 구간의 모든 날짜를 만들고 데이터가 없는 날은 0으로 채운다.
 * 채우지 않으면 접속이 없던 날이 차트에서 사라져 추세선이 실제보다 촘촘해 보인다.
 */
export function fillDailySeries(rows: DailyActive[], from: string, to: string): DailyActive[] {
  const byDate = new Map(rows.map(r => [r.d, r]))
  const out: DailyActive[] = []
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    out.push(byDate.get(d) ?? { d, activeUsers: 0, events: 0 })
  }
  return out
}

/**
 * 계정 목록(좌) + 활동 롤업(우) 좌외부조인.
 * 계정 기준이라 활동이 0인 휴면 계정도 표에서 사라지지 않는다 — "안 쓰는 사람"이
 * 이 화면의 핵심 정보이기 때문이다. 계정에 없는 롤업(탈퇴 직후 등)은 무시한다.
 */
export function mergeUserRows(accounts: AccountRecord[], rollups: UserRollup[]): UsageUserRow[] {
  const byUser = new Map(rollups.map(r => [r.userId, r]))
  return accounts
    .map<UsageUserRow>(a => {
      const r = byUser.get(a.id)
      return {
        ...a,
        events: r?.events ?? 0,
        activeDays: r?.activeDays ?? 0,
        lastActivityAt: r?.lastAt ?? null,
      }
    })
    .sort((x, y) => y.events - x.events || x.name.localeCompare(y.name, 'ko'))
}

/** 무활동 간격이 gapMinutes 를 넘을 때마다 새 접속으로 센다. 경계값은 같은 접속. */
export function countSessions(timestampsIso: string[], gapMinutes = SESSION_GAP_MINUTES): number {
  if (timestampsIso.length === 0) return 0
  const ms = timestampsIso.map(t => new Date(t).getTime()).sort((a, b) => a - b)
  const gap = gapMinutes * 60_000
  let sessions = 1
  for (let i = 1; i < ms.length; i++) {
    if (ms[i] - ms[i - 1] > gap) sessions++
  }
  return sessions
}

/** 최대값 대비 막대 길이(%). 최대가 0이면 0 — 0으로 나누지 않는다. */
export function barPct(value: number, max: number): number {
  return max <= 0 ? 0 : round1((value / max) * 100)
}
