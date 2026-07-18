// ============================================================================
// AI 브리핑 공용 데이터 로더(C3) — 주간 브리핑과 위험 AI 해설이 같은 소스를
// 각자 로드하지 않도록 대시보드 page.tsx 와 동일한 데이터 계층 호출을 1곳으로 모은다.
// 서버 액션 전용: 클라이언트 입력을 믿지 않고 항상 서버에서 재로드/재계산하는 진입점.
// getComputedWbs 는 부분 구조분해로만 소비한다(dependencies 등 확장 필드 비결합).
// 실패는 여기서 삼키지 않는다 — 호출측(액션)이 잡아 로깅 + 'unavailable' 강등한다.
// ============================================================================
import { getComputedWbs } from '@/lib/data/wbs'
import { getSnapshots } from '@/lib/data/snapshots'
import { getProjectMeetingData } from '@/lib/data/meetings'
import { getProjectMinuteSignals } from '@/lib/data/minutes'
import { createServerClient } from '@/lib/supabase/server'
import type { ComputedItem, Meeting, MeetingException } from '@/lib/domain/types'
import type { SnapshotPoint } from '@/lib/domain/trend'
import type { MinuteSignal } from '@/components/dashboard/MinuteSignals'

/** 위험 신호 탐지(회의 액션 경과)가 최근 8건보다 넓은 창을 본다 — dashboard/page.tsx 와 동일 값. */
export const MINUTE_SIGNAL_FETCH = 30

export interface ProjectFactsSource {
  projectId: string
  projectName: string
  startDate: string | null
  endDate: string | null
  items: ComputedItem[]
  holidays: string[]
  /** getComputedWbs 의 '오늘'(projects.base_date 우선) — 진척·리스크 판정 기준일. */
  todayWbs: string
  /** 실제 오늘(Asia/Seoul) — 회의·회의록 경과일 기준(이중 시계 계약). */
  realToday: string
  snapshots: SnapshotPoint[]
  minuteSignals: MinuteSignal[]
  meetings: Meeting[]
  meetingExceptions: MeetingException[]
}

export function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

/** 대시보드와 동일 소스 1회 병렬 로드. 프로젝트 행이 없으면(비멤버 RLS 포함) null. */
export async function loadProjectFacts(projectId: string): Promise<ProjectFactsSource | null> {
  const sb = await createServerClient()
  const [{ items, holidays, today }, snapshots, meetingData, minuteSignals, project] = await Promise.all([
    getComputedWbs(projectId),
    getSnapshots(projectId),
    getProjectMeetingData(projectId),
    getProjectMinuteSignals(projectId, MINUTE_SIGNAL_FETCH),
    sb.from('projects').select('name, start_date, end_date').eq('id', projectId).maybeSingle(),
  ])
  if (project.error) throw new Error(`[projectFacts] 프로젝트 조회 실패: ${project.error.message}`)
  if (!project.data) return null
  return {
    projectId,
    projectName: (project.data.name as string) ?? '',
    startDate: (project.data.start_date as string | null) ?? null,
    endDate: (project.data.end_date as string | null) ?? null,
    items,
    holidays,
    todayWbs: today,
    realToday: seoulToday(),
    snapshots,
    minuteSignals,
    meetings: meetingData.meetings,
    meetingExceptions: meetingData.exceptions,
  }
}
