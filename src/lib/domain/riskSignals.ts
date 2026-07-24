/**
 * 위험 신호 엔진 — 규칙 기반 탐지기 5종 + 안정적 신호 지문(fingerprint).
 *
 * 왜 순수함수인가: 신호는 "예측"이 아니라 기존 단일 출처 지표(statusOf 기반 status,
 * delayAging·dueSoonLeaves·progressSignal·SPI 시계열)를 재조합한 "검증 가능한 사실"이다.
 * 임계값·판정을 여기서 재정의하면 대시보드(ExecSummary·RiskWorklist·SpiPanel)와 모순되므로,
 * 기존 도메인 함수를 재사용하고 신규 임계값(팀 과부하·액션 경과일)은 이 모듈에만 둔다.
 *
 * '오늘' 이원화: WBS 신호는 getComputedWbs의 today(base_date 우선 — ExecSummary와 동일 판정),
 * 회의 액션 경과일은 realToday(seoulToday) — base_date가 과거로 고정된 프로젝트에서
 * 경과일이 왜곡되지 않게 한다.
 *
 * fingerprint: AI 해설 캐시(project_ai_briefs) 재생성 키. 소수점 노이즈·단순 날짜 경과로
 * 지문이 바뀌면 열람마다 LLM이 재호출되므로, 정수화 지표 화이트리스트 + evidence id 집합만
 * 해시에 넣는다(경과일 등 매일 변하는 값은 표시 전용 metrics에만 존재).
 */
import type { ComputedItem, InsightKind, TeamCode } from './types'
import type { HygieneModel, Signal } from './dashboard'
import {
  ALL_TEAMS, dataHygiene, delayAging, diffDaysCal, dueSoonLeaves, overallSignal, progressSignal,
} from './dashboard'
import { round1 } from './format'
import { collectLeaves } from './tree'
import type { SnapshotPoint } from './trend'
import { fnv1a64 } from '@/lib/minutes/blocks'

export type RiskSignalKind =
  | 'delay_trend'            // SPI 시계열 연속 하락 지속
  | 'deadline_stall'         // 마감 임박 + 진척 정체
  | 'owner_overload'         // 담당 팀 과부하(지연 집중 또는 활성 편중)
  | 'overdue_accumulation'   // 예정일 경과 미완료 누적(에이징)
  | 'meeting_action_stale'   // 회의 액션·기한 항목 경과(이행 미확인)

export type RiskSeverity = 'amber' | 'red'

/** 신호의 검증 근거 — 사용자가 원문으로 확인 가능한 참조(WBS 항목 딥링크 / 회의록 블록 앵커). */
export interface EvidenceRef {
  type: 'wbs_item' | 'minute_block'
  itemId?: string       // wbs_item — /p/{projectId}/wbs?focus={itemId}
  minuteId?: string     // minute_block — minuteSourceHref 조합용
  blockIndex?: number
  blockHash?: string
  label: string
}

export interface RiskSignal {
  id: string                                // kind 또는 `${kind}:${한정자}` — 지문 정렬 키
  kind: RiskSignalKind
  severity: RiskSeverity
  title: string
  detail: string
  metrics: Record<string, number | string>  // 표시용 — 경과일 등 휘발 값 포함 가능(지문은 화이트리스트만)
  evidence: EvidenceRef[]
}

/**
 * 회의록 인사이트 신호 입력 — components/dashboard/MinuteSignals의 MinuteSignal과 구조 동일.
 * 도메인 계층이 컴포넌트 파일을 임포트하지 않도록 여기 로컬로 재선언한다(구조적 타이핑으로 호환).
 */
export interface MinuteActionSignal {
  id: string
  minuteId: string
  bodyHash: string
  kind: InsightKind | 'none'
  label: string
  blockIndex: number
  blockHash: string
  minuteTitle: string
  minuteDate: string    // 'YYYY-MM-DD'
}

export interface RiskSignalInput {
  items: ComputedItem[]
  today: string        // getComputedWbs 기준일(base_date 우선) — WBS 신호 전용
  realToday: string    // seoulToday() — 회의 액션 경과일 전용(base_date 왜곡 차단)
  snapshots: SnapshotPoint[]
  startDate: string | null   // 설계 시그니처 유지(일정 문맥 확장 예약) — 현 탐지기는 미사용
  endDate: string | null
  minuteSignals: MinuteActionSignal[]
  /** 팀 집계 대상(활성 팀) — 미주입 시 기본 5팀(ALL_TEAMS). */
  teams?: readonly TeamCode[]
}

export interface RiskSignalReport {
  signals: RiskSignal[]
  overall: Signal          // worst-of(overallSignal 재사용) — 신호 없으면 green
  hygiene: HygieneModel    // '이력 부족·데이터 품질' 캐비앗 표기용(조용한 무신호 위장 방지)
  /** SPI 표본이 SPI_TAIL 미만 — delay_trend 판정이 구조적으로 불가. 캐비앗 판정도 엔진이
   *  자기 시계열로 소유한다: 외부(buildTrend.spiSeries — 축 유효성 게이트 있음)로 판정하면
   *  축이 깨진 프로젝트에서 '판정 불가' 캐비앗과 delay_trend 신호가 동시 표기될 수 있다. */
  trendSparse: boolean
  fingerprint: string
  today: string
}

/* ── 이 모듈이 소유하는 유일한 신규 임계값(테스트로 고정) ──
 * 나머지 경계(진척 -2/-10, 에이징 15일·4건, SPI 0.9, planned≥5)는 전부 기존 소유자 미러다. */
export const OVERLOAD_DELAYED_FIRE = 3   // 한 팀에 지연 리프 3건 집중 → 발화
export const OVERLOAD_ACTIVE_RATIO = 2   // 활성 리프가 배정 팀 평균의 2배 → 발화
export const OVERLOAD_ACTIVE_MIN = 4     // 표본 극소(활성 3건 이하) 팀의 비율 오탐 바닥
export const STALE_ACTION_DAYS = 7       // 회의 액션·기한 항목 경과 기준일

export const SPI_TAIL = 3          // 연속 하락 판정 표본 수 — RiskSignalCard 캐비앗 문구 보간에 공유
const SPI_DELAYED_FLOOR = 0.9      // SpiPanel 'delayed' 경계 미러(재정의 아님)
const SPI_PLANNED_GUARD = 5        // trend.ts spiSeries 조기 불안정 가드 미러
const OVERLOAD_DELAYED_RED = 4     // riskModel red 경계(지연 4+) 미러
const EVIDENCE_LIMIT = 8           // delayAging list limit 관례 미러

const wbsRef = (l: ComputedItem): EvidenceRef => ({ type: 'wbs_item', itemId: l.id, label: l.name })

/* SPI 시계열 관례(today 이전·planned≥5 가드·소수 2자리)의 단일 계산 —
 * buildTrend 재호출 대신 동일식 복제(plannedAt 재샘플링은 성능 미해결이라 절대 하지 않는다).
 * delay_trend 판정과 trendSparse 캐비앗이 반드시 같은 표본을 보게 하는 소유 지점. */
function spiSeriesOf(snapshots: SnapshotPoint[], today: string): number[] {
  return snapshots
    .filter(s => s.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .filter(s => s.planned >= SPI_PLANNED_GUARD)
    .map(s => Math.round((s.actual / s.planned) * 100) / 100)
}

/* ── ① 지연 추세 지속 — SPI 꼬리 3점 연속 하락 + 현재 SPI < 0.9 ── */
function detectDelayTrend(spiSeries: number[]): RiskSignal | null {
  if (spiSeries.length < SPI_TAIL) return null
  const tail = spiSeries.slice(-SPI_TAIL)
  const strictlyFalling = tail.every((v, i) => i === 0 || v < tail[i - 1])
  const current = tail[tail.length - 1]
  if (!strictlyFalling || current >= SPI_DELAYED_FLOOR) return null
  return {
    id: 'delay_trend', kind: 'delay_trend',
    severity: 'red',   // 발화 조건 자체가 SpiPanel red 구간(SPI<0.9) — 항상 red
    title: '지연 추세 지속',
    detail: `SPI가 최근 ${SPI_TAIL}회 연속 하락해 ${current.toFixed(2)}까지 내려왔습니다(기준 0.90 미만).`,
    metrics: { spiPct: Math.round(current * 100), spiTail: tail.map(v => v.toFixed(2)).join(' → ') },
    evidence: [],      // 프로젝트 수준 지표 — 항목 단위 근거 없음(원문은 트렌드 패널의 스냅샷 시계열)
  }
}

/* ── ② 마감임박 + 진척 정체 — dueSoonLeaves 중 계획 대비 갭>0 ──
 * 갭은 round1로 감싼다(FP 노이즈가 >0 판정을 오염시키는 실버그 관례).
 * 심각도는 progressSignal 경계 재사용: 갭을 편차(-갭)로 뒤집어 red(>10%p) 여부만 본다. */
function detectDeadlineStall(leaves: ComputedItem[], today: string): RiskSignal | null {
  const stalled = dueSoonLeaves(leaves, today)
    .map(l => ({ item: l, gap: round1(l.plannedPct - l.rolledActualPct) }))
    .filter(e => e.gap > 0)
  if (stalled.length === 0) return null
  const maxGap = stalled.reduce((m, e) => Math.max(m, e.gap), 0)
  const severity: RiskSeverity =
    stalled.some(e => progressSignal(round1(-e.gap)) === 'red') ? 'red' : 'amber'
  return {
    id: 'deadline_stall', kind: 'deadline_stall', severity,
    title: '마감 임박 작업 진척 정체',
    detail: `7일 내 마감 ${stalled.length}건이 계획 대비 뒤처져 있습니다(최대 ${Math.round(maxGap)}%p 갭).`,
    metrics: { count: stalled.length, maxGapPp: maxGap, nearestEnd: stalled[0].item.plannedEnd! },
    evidence: stalled.slice(0, EVIDENCE_LIMIT).map(e => wbsRef(e.item)),
  }
}

/* ── ③ 담당 팀 과부하 — teamProgress와 동일한 소유 판정(primary·support 모두)으로 팀별 집계 ──
 * 발화: 지연 리프 ≥3 집중 또는 활성(미완료) 리프가 배정 팀 평균의 2배(표본 바닥 4건).
 * 심각도: 팀 내 지연 ≥4면 red(riskModel red 경계 미러), 그 외 amber. */
function detectOwnerOverload(leaves: ComputedItem[], teams: readonly TeamCode[]): RiskSignal[] {
  const perTeam = teams.map(team => {
    const assigned = leaves.filter(l => l.owners.some(o => o.team === team))
    return {
      team,
      assigned,
      active: assigned.filter(l => l.status !== 'done'),
      delayed: assigned.filter(l => l.status === 'delayed'),
    }
  })
  const withWork = perTeam.filter(t => t.assigned.length > 0)
  const avgActive = withWork.length
    ? withWork.reduce((sum, t) => sum + t.active.length, 0) / withWork.length
    : 0
  const signals: RiskSignal[] = []
  for (const t of perTeam) {
    const delayedFire = t.delayed.length >= OVERLOAD_DELAYED_FIRE
    const ratioFire =
      avgActive > 0 &&
      t.active.length >= OVERLOAD_ACTIVE_MIN &&
      t.active.length >= avgActive * OVERLOAD_ACTIVE_RATIO
    if (!delayedFire && !ratioFire) continue
    const nonDelayedActive = t.active.filter(l => l.status !== 'delayed')
    signals.push({
      id: `owner_overload:${t.team}`, kind: 'owner_overload',
      severity: t.delayed.length >= OVERLOAD_DELAYED_RED ? 'red' : 'amber',
      title: `담당 팀 과부하 — ${t.team}`,
      detail: `${t.team} 팀에 지연 ${t.delayed.length}건·활성 ${t.active.length}건이 집중돼 있습니다(배정 팀 평균 활성 ${round1(avgActive)}건).`,
      metrics: {
        team: t.team as TeamCode,
        delayedCount: t.delayed.length,
        activeCount: t.active.length,
        avgActive: round1(avgActive),
      },
      // 지연 리프 우선, 남는 자리는 그 외 활성 리프 — 사용자가 부하 실체를 원문으로 검증
      evidence: [...t.delayed, ...nonDelayedActive].slice(0, EVIDENCE_LIMIT).map(wbsRef),
    })
  }
  return signals
}

/* ── ④ 예정일 경과 누적 — delayAging 결과를 그대로 판정(경계 재정의 금지) ──
 * d15plus ≥1 → red, total ≥4 → red(riskModel 경계 미러), 그 외 total ≥1 → amber. */
function detectOverdueAccumulation(leaves: ComputedItem[], today: string): RiskSignal | null {
  const aging = delayAging(leaves, today)
  if (aging.total === 0) return null
  const severity: RiskSeverity = aging.d15plus >= 1 || aging.total >= 4 ? 'red' : 'amber'
  return {
    id: 'overdue_accumulation', kind: 'overdue_accumulation', severity,
    title: '예정일 경과 작업 누적',
    detail: `기한이 지난 미완료 작업이 ${aging.total}건 쌓여 있습니다(15일 이상 경과 ${aging.d15plus}건).`,
    metrics: {
      total: aging.total, d1_7: aging.d1_7, d8_14: aging.d8_14, d15plus: aging.d15plus,
      maxOverdueDays: aging.list[0]?.overdue ?? 0,  // 표시 전용 — 매일 변하므로 지문 제외
    },
    evidence: aging.list.map(e => wbsRef(e.item)),  // delayAging이 이미 limit 8 정렬 제공
  }
}

/* ── ⑤ 회의 액션 경과 — action·deadline 인사이트가 realToday 기준 7일 이상 경과 ──
 * minute_insights에는 완료 상태가 없어 '이행 여부'를 알 수 없다 — 문구는 확인 필요로 제한(단정 금지). */
function detectMeetingActionStale(minuteSignals: MinuteActionSignal[], realToday: string): RiskSignal | null {
  const stale = minuteSignals.filter(s =>
    (s.kind === 'action' || s.kind === 'deadline') &&
    diffDaysCal(s.minuteDate, realToday) >= STALE_ACTION_DAYS)
  if (stale.length === 0) return null
  const oldest = stale.reduce((m, s) => (s.minuteDate < m.minuteDate ? s : m))
  return {
    id: 'meeting_action_stale', kind: 'meeting_action_stale',
    severity: 'amber',   // 이행 미확인 상태의 알림 — 단정 불가라 red로 올리지 않는다
    title: '회의 액션 기한 경과',
    detail: `회의에서 나온 액션·기한 항목 ${stale.length}건이 ${STALE_ACTION_DAYS}일 이상 경과했습니다 — 이행 여부 확인이 필요합니다.`,
    metrics: {
      count: stale.length,
      oldestDate: oldest.minuteDate,
      oldestDays: diffDaysCal(oldest.minuteDate, realToday),  // 표시 전용 — 지문 제외
    },
    evidence: stale.slice(0, EVIDENCE_LIMIT).map(s => ({
      type: 'minute_block' as const,
      minuteId: s.minuteId, blockIndex: s.blockIndex, blockHash: s.blockHash,
      label: s.label,
    })),
  }
}

/* ── 지문(fingerprint) — AI 해설 캐시 재생성 키 ──
 * 화이트리스트 지표만 포함: 경과일·평균 같은 휘발/파생 값이 들어가면 데이터 무변경에도
 * 매일 지문이 바뀌어 LLM 재호출이 폭주한다(무료 쿼터 소진). 숫자는 Math.round로 정수화해
 * 소수점 노이즈(FP·round1 1자리 변동)로는 지문이 바뀌지 않게 한다. */
const FP_METRIC_KEYS: Record<RiskSignalKind, readonly string[]> = {
  delay_trend: ['spiPct'],
  deadline_stall: ['count', 'maxGapPp'],
  owner_overload: ['team', 'delayedCount', 'activeCount'],
  overdue_accumulation: ['total', 'd1_7', 'd8_14', 'd15plus'],
  meeting_action_stale: ['count'],
}

const evidenceKey = (e: EvidenceRef): string =>
  e.type === 'wbs_item' ? `w:${e.itemId ?? ''}` : `m:${e.minuteId ?? ''}#${e.blockIndex ?? -1}`

export function riskFingerprint(signals: RiskSignal[]): string {
  const canon = [...signals]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(s => [
      s.id,
      s.severity,
      FP_METRIC_KEYS[s.kind]
        .map(k => {
          const v = s.metrics[k]
          return `${k}=${typeof v === 'number' ? Math.round(v) : String(v ?? '')}`
        })
        .join(','),
      s.evidence.map(evidenceKey).sort().join('|'),
    ].join(';'))
  return fnv1a64(JSON.stringify(canon))
}

/** 탐지기 5종 종합 — I/O 전무. 입력은 대시보드가 이미 들고 있는 계산 결과만 받는다. */
export function detectRiskSignals(input: RiskSignalInput): RiskSignalReport {
  const { items, today, realToday, snapshots, minuteSignals } = input
  const leaves = collectLeaves(items)
  const spiSeries = spiSeriesOf(snapshots, today)

  const signals: RiskSignal[] = []
  const trend = detectDelayTrend(spiSeries)
  if (trend) signals.push(trend)
  const stall = detectDeadlineStall(leaves, today)
  if (stall) signals.push(stall)
  signals.push(...detectOwnerOverload(leaves, input.teams ?? ALL_TEAMS))
  const overdue = detectOverdueAccumulation(leaves, today)
  if (overdue) signals.push(overdue)
  const staleActions = detectMeetingActionStale(minuteSignals, realToday)
  if (staleActions) signals.push(staleActions)

  return {
    signals,
    overall: overallSignal(signals.map(s => s.severity)),
    hygiene: dataHygiene(items),
    trendSparse: spiSeries.length < SPI_TAIL,
    fingerprint: riskFingerprint(signals),
    today,
  }
}
