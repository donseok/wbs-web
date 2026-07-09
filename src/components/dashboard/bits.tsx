import type { ReactNode } from 'react'

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/** 'YYYY-MM-DD' → att.weekday.* 사전 키. UTC 산술로 타임존 무관(도메인 관례). */
export function weekdayKey(dateIso: string): `att.weekday.${(typeof WEEKDAYS)[number]}` {
  return `att.weekday.${WEEKDAYS[new Date(`${dateIso}T00:00:00Z`).getUTCDay()]}`
}

/** 'YYYY-MM-DD' + n일. Date.UTC 가 월/연 경계를 자동 처리. */
export function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  const pad2 = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`
}

/** 회의/근태 리스트 공용 날짜 셀 — 오늘이면 브랜드 배지로 강조. */
export function DateCell({ date, isToday, todayLabel, weekday }: {
  date: string; isToday: boolean; todayLabel: string; weekday: string
}) {
  return (
    <div className="w-14 shrink-0">
      {isToday ? (
        <span className="badge bg-brand text-white">{todayLabel}</span>
      ) : (
        <>
          <div className="tabular-nums text-xs font-semibold text-ink">{date.slice(5).replace('-', '.')}</div>
          <div className="mt-0.5 text-[10px] text-ink-subtle">{weekday}</div>
        </>
      )}
    </div>
  )
}

/** 카드 우상단 건수 배지 */
export function CountBadge({ n, unit, tone = 'bg-brand-weak text-brand' }: { n: number; unit: string; tone?: string }) {
  return <span className={`badge ${tone}`}>{n}{unit}</span>
}

/** 카드 내부 소형 빈 상태 */
export function MiniEmpty({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-xl border border-dashed border-line bg-surface-2/40 px-4 py-8 text-center text-xs text-ink-subtle">
      {text}
    </div>
  )
}

/** 라벨+큰 숫자 스탯 타일. tone 으로 값 색상 오버라이드(예: text-done). */
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/50 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums leading-none ${tone ?? 'text-ink'}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-ink-muted">{sub}</div>}
    </div>
  )
}
