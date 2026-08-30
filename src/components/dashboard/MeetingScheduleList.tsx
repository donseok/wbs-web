'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Users, NotebookText } from 'lucide-react'
import type { MeetingOccurrence } from '@/lib/domain/types'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'
import { MEETING_META, meetingEditHref, type MeetingRowExtra } from '@/lib/domain/meetings'
import { MeetingDetailModal } from '@/components/meetings/MeetingDetailModal'
import { DateCell, weekdayKey } from './bits'

/** 대시보드 회의 리스트 — 행 클릭 시 상세 모달을 띄운다.
 *  작성자(또는 pmo_admin)면 상세에서 수정·삭제가 열린다. 수정 폼은 프로젝트 멤버 목록이 필요하므로
 *  여기서 띄우지 않고 회의 페이지로 딥링크(?focus=&date=&edit=1)해 폼을 바로 연다. */
/** 참석자 이름을 이만큼만 보이고 나머지는 '외 N명'으로 접는다 — 한 줄 폭 안에서 끝나게. */
const MAX_NAMES = 3
const EMPTY_EXTRA: MeetingRowExtra = { attendees: [], memo: '' }

export function MeetingScheduleList({ rows, extras, today, currentUserId = null, role = null }: {
  rows: MeetingOccurrence[]
  /** 시리즈 id → 참석자 이름·메모 요약. 조회 실패로 비면 빈 상태 문구가 나온다. */
  extras: Record<string, MeetingRowExtra>
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
          const extra = extras[o.seriesId] ?? EMPTY_EXTRA
          const shownNames = extra.attendees.slice(0, MAX_NAMES).join(', ')
          const moreNames = extra.attendees.length - MAX_NAMES
          return (
            <li key={o.occurrenceId} onClick={() => setDetailOcc(o)} role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') setDetailOcc(o) }}
              className="flex cursor-pointer items-center gap-3 py-2.5 first:pt-0 last:pb-0 transition hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2">
              <DateCell date={o.occurrenceDate} isToday={o.occurrenceDate === today}
                todayLabel={t('dash.today')} weekday={t(weekdayKey(o.occurrenceDate) as DictKey)} />
              <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
              {/* 좁은 폭은 세로 쌓기, md 이상은 제목:참석자:메모 = 5:4:6 세 열. 행 폭이 넓어 제목만 두면
                  절반이 빈다. flex-direction/grid 는 반응형 display 안전망과 무관하다. */}
              <div className="min-w-0 flex-1 md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,6fr)] md:items-center md:gap-x-4">
                <div className="min-w-0">
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
                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] md:mt-0"
                  title={extra.attendees.length ? extra.attendees.join(', ') : undefined}>
                  <Users className="h-3 w-3 shrink-0 text-ink-subtle" aria-hidden />
                  {extra.attendees.length === 0 ? (
                    <span className="text-ink-subtle">{t('dash.meet.noAttendees')}</span>
                  ) : (
                    <>
                      <span className="truncate text-ink-muted">{shownNames}</span>
                      {moreNames > 0 && (
                        <span className="shrink-0 text-ink-subtle">{t('dash.meet.attendeesMore').replace('{n}', String(moreNames))}</span>
                      )}
                    </>
                  )}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] md:mt-0"
                  title={extra.memo || undefined}>
                  <NotebookText className="h-3 w-3 shrink-0 text-ink-subtle" aria-hidden />
                  {extra.memo ? (
                    <span className="truncate text-ink-muted">{extra.memo}</span>
                  ) : (
                    <span className="text-ink-subtle">{t('dash.meet.noMemo')}</span>
                  )}
                </div>
              </div>
              <span className={`badge shrink-0 ${meta.chip}`}>{t(meta.labelKey as DictKey)}</span>
            </li>
          )
        })}
      </ul>
      {/* 대시보드는 프로젝트 하나에 고정된 화면이라 role 이 이미 그 프로젝트 스코프 shim 이다. */}
      <MeetingDetailModal open={!!detailOcc} occurrence={detailOcc}
        currentUserId={currentUserId} isAdmin={role === 'pmo_admin'}
        onClose={() => setDetailOcc(null)}
        onEditSeries={m => router.push(meetingEditHref(m.projectId, m.id, detailOcc?.occurrenceDate))}
        onChanged={() => router.refresh()} />
    </>
  )
}
