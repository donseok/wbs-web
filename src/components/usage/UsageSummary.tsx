import { Activity, CalendarCheck, MousePointerClick, Users } from 'lucide-react'
import { KpiCard } from '@/components/ui/KpiCard'
import { SESSION_GAP_MINUTES, type UsageSummary as Summary } from '@/lib/domain/usage'

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(iso))
}

/**
 * 요약 + 수집 상태.
 * '수집 상태'가 이 화면의 자기진단이다 — 비콘이 조용히 끊겨도 마지막 이벤트 시각이
 * 멈춘 채로 보이므로 "데이터 0"과 "수집 중단"이 구별된다.
 */
export function UsageSummary({ summary, days, sessions }: {
  summary: Summary; days: number; sessions: number
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="TODAY" value={summary.todayUsers} sub="오늘 접속한 사용자" icon={CalendarCheck} tone="brand" />
        <KpiCard label={`ACTIVE ${days}D`} value={summary.activeUsers} sub={`최근 ${days}일 접속 사용자`} icon={Users} tone="success" />
        <KpiCard label="SESSIONS" value={sessions} sub={`표시된 로그 기준 · ${SESSION_GAP_MINUTES}분 무활동 유도값`} icon={Activity} />
        <KpiCard label={`VIEWS ${days}D`} value={summary.totalEvents.toLocaleString('ko-KR')} sub="화면 열람 건수" icon={MousePointerClick} />
      </div>
      <p className="text-[11px] text-ink-subtle">
        {summary.lastEventAt
          ? `수집 상태 · 마지막 기록 ${fmtDateTime(summary.lastEventAt)}`
          : '수집 상태 · 아직 기록이 없습니다. 수집은 프로덕션 배포 환경에서만 동작합니다.'}
      </p>
    </div>
  )
}
