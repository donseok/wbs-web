'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MeetingOccurrence } from '@/lib/domain/types'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'
import { MEETING_META, meetingEditHref } from '@/lib/domain/meetings'
import { MeetingDetailModal } from '@/components/meetings/MeetingDetailModal'
import { DateCell, weekdayKey } from './bits'

/** 대시보드 회의 리스트 — 행 클릭 시 상세 모달을 띄운다.
 *  작성자(또는 pmo_admin)면 상세에서 수정·삭제가 열린다. 수정 폼은 프로젝트 멤버 목록이 필요하므로
 *  여기서 띄우지 않고 회의 페이지로 딥링크(?focus=&date=&edit=1)해 폼을 바로 연다. */
export function MeetingScheduleList({ rows, today, currentUserId = null, role = null }: {
  rows: MeetingOccurrence[]
  today: string
  currentUserId?: string | null
  role?: string | null
}) {
  const router = useRouter()
  const { t } = useLocale()
  const [detailOcc, setDetailOcc] = useState<MeetingOccurrence | null>(null)

  return (
    <>
      <ul className="divide-y divide-line">
        {rows.map(o => {
          const meta = MEETING_META[o.category]
          return (
            <li key={o.occurrenceId} onClick={() => setDetailOcc(o)} role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') setDetailOcc(o) }}
              className="flex cursor-pointer items-center gap-3 py-2.5 first:pt-0 last:pb-0 transition hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2">
              <DateCell date={o.occurrenceDate} isToday={o.occurrenceDate === today}
                todayLabel={t('dash.today')} weekday={t(weekdayKey(o.occurrenceDate) as DictKey)} />
              <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink" title={o.title}>{o.title}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-muted">
                  {o.startTime && (
                    <span className="tabular-nums">
                      {o.startTime.slice(0, 5)}{o.endTime ? `–${o.endTime.slice(0, 5)}` : ''}
                    </span>
                  )}
                  {o.location && <span className="truncate">{o.location}</span>}
                </div>
              </div>
              <span className={`badge shrink-0 ${meta.chip}`}>{t(meta.labelKey as DictKey)}</span>
            </li>
          )
        })}
      </ul>
      <MeetingDetailModal open={!!detailOcc} occurrence={detailOcc}
        currentUserId={currentUserId} role={role}
        onClose={() => setDetailOcc(null)}
        onEditSeries={m => router.push(meetingEditHref(m.projectId, m.id, detailOcc?.occurrenceDate))}
        onChanged={() => router.refresh()} />
    </>
  )
}
