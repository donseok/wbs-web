import { round1 } from './format'
// 사본 정리 — addDaysIso 정본은 dates.ts. 기존 import 경로가 살아 있도록 re-export 유지(내부 사용도 이 바인딩).
import { addDaysIso } from './dates'
export { addDaysIso }

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

/** 쿼리스트링은 신뢰할 수 없다 — 허용 목록에 없으면 기본 30일. */
export function parsePeriodDays(raw: string | undefined): number {
  const n = Number(raw)
  return (PERIOD_OPTIONS as readonly number[]).includes(n) ? n : 30
}

/**
 * 쿼리스트링 필터값을 허용 목록에 대조한다. 모르는 값은 조용히 버린다(=필터 없음).
 * 검증 없이 넘기면 존재하지 않는 값으로 영원히 빈 표가 나오고, 그게 '기록 없음'과
 * 구별되지 않는다.
 */
export function pickAllowed(raw: string | undefined, allowed: Iterable<string>): string | undefined {
  if (!raw) return undefined
  for (const a of allowed) if (a === raw) return raw
  return undefined
}

/** 현재 쿼리를 유지한 채 일부만 바꾼 /usage 링크. 값이 undefined 면 그 파라미터를 뺀다. */
export function usageHref(
  current: { days: number; user?: string; menu?: string },
  patch: Partial<{ days: number; user?: string; menu?: string }>,
): string {
  const next = { ...current, ...patch }
  const q = new URLSearchParams()
  if (next.days !== 30) q.set('days', String(next.days))
  if (next.user) q.set('user', next.user)
  if (next.menu) q.set('menu', next.menu)
  const s = q.toString()
  return s ? `/usage?${s}` : '/usage'
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

// 접속 횟수 계산은 여기 두지 않는다. 반드시 사용자별로 끊어야 하는데(섞으면 동시 사용
// 중 간격이 사라져 1로 붕괴한다) 그러려면 기간 전체 이벤트가 필요하고, 90일이면 수십만
// 행이라 JS 로 끌어올 수 없다. SQL 의 lag() 로 옮겼다 — usage_sessions RPC(0051).

/** 최대값 대비 막대 길이(%). 최대가 0이면 0 — 0으로 나누지 않는다. */
export function barPct(value: number, max: number): number {
  return max <= 0 ? 0 : round1((value / max) * 100)
}
