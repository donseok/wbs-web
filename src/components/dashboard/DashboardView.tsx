import { BarChart3 } from 'lucide-react'
import type { Announcement, ComputedItem, Meeting, MeetingException } from '@/lib/domain/types'
import type { SnapshotPoint } from '@/lib/domain/trend'
import { buildTrend } from '@/lib/domain/trend'
import { milestoneTimeline } from '@/lib/domain/dashboard'
import { round1 } from '@/lib/domain/format'
import { overallProgress } from '@/lib/domain/rollup'
import { briefFactsHash, buildBriefFacts } from '@/lib/ai/brief'
import { sanitizeRiskItems } from '@/lib/ai/risk-brief'
import type { AiBriefRow } from '@/lib/data/aiBriefs'
import { EmptyState } from '@/components/ui/EmptyState'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { ExecSummary } from './ExecSummary'
import { TrendChart } from './TrendChart'
import { SpiPanel } from './SpiPanel'
import { MilestoneTimeline } from './MilestoneTimeline'
import { MeetingSchedule } from './MeetingSchedule'
import { RiskSignalCard } from './RiskSignalCard'
import { RiskWorklist } from './RiskWorklist'
import { TeamProgress } from './TeamProgress'
import { MinuteSignals, type MinuteSignal } from './MinuteSignals'

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

// 회의 인사이트 카드 표시 상한 — 페치는 위험 신호 탐지 겸용으로 상향됐지만(page.tsx),
// 협업 2열 카드의 기존 '최근 8건' 밀도는 유지한다.
const MINUTE_SIGNAL_DISPLAY = 8

/** 경영진/PMO 대시보드 — ExecSummary 아래를 타임라인·트렌드·회의·근태로 구성.
 *  모든 집계는 도메인 함수가 담당하고 여기서는 조립만 한다. */
export async function DashboardView({
  items,
  projectId,
  projectName,
  projectDescription = null,
  startDate = null,
  endDate = null,
  today = seoulToday(),
  holidays = [],
  snapshots = [],
  announcements = [],
  meetings = [],
  meetingExceptions = [],
  minuteSignals = [],
  weeklyBriefRow = null,
  riskBriefRow = null,
  currentUserId = null,
  role = null,
}: {
  items: ComputedItem[]
  projectId: string
  projectName: string
  projectDescription?: string | null
  startDate?: string | null
  endDate?: string | null
  today?: string
  holidays?: string[]
  snapshots?: SnapshotPoint[]
  announcements?: Announcement[]
  meetings?: Meeting[]
  meetingExceptions?: MeetingException[]
  minuteSignals?: MinuteSignal[]
  /** AI 브리핑 캐시 행(page.tsx 페치, 읽기 전용 RLS) — 신선도 판정은 여기서 해시 대조로 수행. */
  weeklyBriefRow?: AiBriefRow | null
  riskBriefRow?: AiBriefRow | null
  /** 회의 카드에서 작성자 본인/pmo_admin 에게 수정·삭제를 열기 위한 식별자. */
  currentUserId?: string | null
  role?: string | null
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  if (items.length === 0) {
    return <EmptyState icon={BarChart3} title={tr('dash.emptyTitle')} description={tr('dash.emptyDesc')} />
  }

  const { actual, planned } = overallProgress(items)
  const trend = buildTrend({ items, snapshots, holidays: new Set(holidays), startDate, endDate, today })
  const milestones = milestoneTimeline(items, today)
  // 팩트 컨텍스트 — 기존 props 재조합만(신규 페치 없음). 위험 신호(detectRiskSignals)는
  // buildBriefFacts 내부에서 계산돼 riskReport 로 재사용된다(C3 — 브리핑·신호 카드 근거 단일화).
  // WBS 신호는 today(base_date 우선 — ExecSummary와 동일 판정), 회의·회의록은 실제 오늘(이중 시계).
  const realToday = seoulToday()
  const facts = buildBriefFacts({
    projectName, items, startDate, endDate, todayWbs: today, realToday,
    holidays, snapshots, minuteSignals, meetings, meetingExceptions,
  })
  const riskReport = facts.riskReport
  const factsHash = briefFactsHash(facts)
  // 캐시 신선도 — weekly 는 팩트 해시, risk 는 신호 지문이 각자의 단일 근거(0030 계약).
  const weeklyBrief = weeklyBriefRow && weeklyBriefRow.status === 'ready' ? {
    headline: weeklyBriefRow.headline,
    bodyMd: weeklyBriefRow.bodyMd,
    updatedAt: weeklyBriefRow.updatedAt,
    model: weeklyBriefRow.model,
    fresh: weeklyBriefRow.inputHash === factsHash,
  } : null
  const riskBrief = riskBriefRow ? {
    headline: riskBriefRow.headline,
    items: sanitizeRiskItems(riskBriefRow.items),
    fresh: riskBriefRow.inputHash === riskReport.fingerprint,
    status: riskBriefRow.status,
  } : null

  return (
    <div className="space-y-5">
      {/* A. 경영진 요약 — 게이지 + 신호등 3 + 공지 + 리포트 (현행 유지) */}
      <ExecSummary
        items={items} projectId={projectId} projectName={projectName}
        projectDescription={projectDescription} startDate={startDate} endDate={endDate}
        today={today} announcements={announcements}
      />

      {/* B. 마일스톤 여정 */}
      <MilestoneTimeline points={milestones} startDate={startDate} endDate={endDate} today={today} />

      {/* C. 진척현황 — S-Curve + SPI/velocity. lg부터 2열 — xl(1280px) 기준이면 배율 확대
          노트북에서 세로로 쌓여 페이지 스크롤이 길어진다(사용자 요청 2026-07-19). */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TrendChart model={trend} today={today} />
        <SpiPanel model={trend} variance={round1(actual - planned)} />
      </div>

      {/* 팀별 진척 — 실행 큐로 내려가기 전에 팀 단위 진행 현황을 한눈에 */}
      <TeamProgress items={items} />

      {/* 실행 큐 — 진척 트렌드 아래에서 숫자형 리스크를 담당자가 바로 열어볼 수 있는 WBS 작업으로 연결 */}
      <RiskWorklist items={items} projectId={projectId} today={today} />

      {/* D. 협업 현황 — 회의 일정 + 근태(좌우 균형).
          today 프롭은 base_date(공정율 기준일)로 고정될 수 있으므로(getComputedWbs) 쓰지 않는다 —
          회의·근태는 진척 산정이 아니라 실제 달력이므로 항상 실제 오늘 기준. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <MeetingSchedule projectId={projectId} meetings={meetings} exceptions={meetingExceptions} today={seoulToday()}
          currentUserId={currentUserId} role={role} />
        <MinuteSignals projectId={projectId} signals={minuteSignals.slice(0, MINUTE_SIGNAL_DISPLAY)} />
      </div>

      {/* E. AI 브리핑 & 위험 신호(D1 통합) — 회의 일정 아래에 배치(사용자 요청 2026-07-23).
          minuteSignals는 bodyHash 앵커 복원용. */}
      <RiskSignalCard
        report={riskReport} projectId={projectId} minuteSignals={minuteSignals}
        kpiLine={facts.kpiLine} baseDate={today} realToday={realToday}
        weeklyBrief={weeklyBrief} riskBrief={riskBrief}
      />
    </div>
  )
}
