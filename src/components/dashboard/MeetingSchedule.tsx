import Link from 'next/link'
import { CalendarDays, ArrowRight } from 'lucide-react'
import type { Meeting, MeetingException } from '@/lib/domain/types'
import { buildMeetingRowExtras, expandMeetings, occurrencesByDate, sortOccurrences, summarizeMeetings } from '@/lib/domain/meetings'
import { getMeetingRowExtras } from '@/lib/data/meetings'
import { SectionCard } from '@/components/ui/SectionCard'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { CountBadge, MiniEmpty, addDaysIso } from './bits'
import { MeetingScheduleList } from './MeetingScheduleList'

/** 리스트 표시 상한 — 카드 높이를 근태 카드와 비슷하게 유지한다. */
const MAX_ROWS = 10
/** 전개 범위(오늘 포함 14일) — 근태 카드와 동일 창. */
const WINDOW_DAYS = 14

/** 향후 2주 회의 일정 — 날짜순 리스트. */
export async function MeetingSchedule({ projectId, meetings, exceptions, today, currentUserId = null, role = null }: {
  projectId: string
  meetings: Meeting[]
  exceptions: MeetingException[]
  today: string
  /** 작성자 본인(또는 pmo_admin)에게 상세 모달의 수정·삭제를 열기 위한 식별자. */
  currentUserId?: string | null
  role?: string | null
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  const windowEnd = addDaysIso(today, WINDOW_DAYS - 1)
  const occ = expandMeetings(meetings, exceptions, today, windowEnd)
  const sorted = Object.entries(occurrencesByDate(occ))
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, dayOcc]) => sortOccurrences(dayOcc))
  const s = summarizeMeetings(occ, today)
  const rows = sorted.slice(0, MAX_ROWS)

  // 참석자 이름·메모는 목록 조회에 실리지 않는다(body 는 상세 전용) — 표시 행의 시리즈만 추가 조회.
  // 행 폭이 넓어 제목·시간만 두면 절반이 비므로(2026-08-28 사용자 피드백) 참석자·메모 열을 채운다.
  const seriesIds = [...new Set(rows.map(r => r.seriesId))]
  const byId = new Map(meetings.map(m => [m.id, m]))
  const memberIds = [...new Set(seriesIds.flatMap(id => byId.get(id)?.attendeeIds ?? []))]
  const { bodies, memberNames } = await getMeetingRowExtras(seriesIds, memberIds)
  const extras = buildMeetingRowExtras(seriesIds, meetings, bodies, memberNames)

  return (
    <SectionCard
      eyebrow="MEETINGS" title={tr('dash.meet.title')} icon={CalendarDays}
      actions={<CountBadge n={s.total} unit={tr('dash.unitCount')} />}
    >
      <div className="space-y-4">
        {rows.length === 0 ? (
          <MiniEmpty text={tr('dash.meet.empty')} />
        ) : (
          <MeetingScheduleList rows={rows} extras={extras} today={today} currentUserId={currentUserId} role={role} />
        )}
        <Link href={`/p/${projectId}/meetings`} className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline">
          {tr('dash.viewAll')} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </SectionCard>
  )
}
