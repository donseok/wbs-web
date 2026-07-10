'use client'
import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bot, CalendarDays, ChevronLeft, ChevronRight, List, Paperclip, Plus, Search } from 'lucide-react'
import type { Minute, TeamCode } from '@/lib/domain/types'
import { TEAM_CODES } from '@/lib/domain/minutes'
import { fetchMinutesRange, fetchMinutesSearch } from '@/app/actions/minutes'
import { queueUiPref } from '@/lib/prefs/debouncedSave'
import { useLocale } from '@/components/providers/LocaleProvider'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { TEAM } from '@/components/wbs/shared'
import { MinutesCalendar } from './MinutesCalendar'
import { MinuteUploadModal } from './MinuteUploadModal'
import { ArchiveChatPanel } from './ArchiveChatPanel'

type ViewKey = 'list' | 'calendar'
type TeamKey = 'ALL' | TeamCode

function monthRangeOf(year: number, month0: number): [string, string] {
  const last = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
  const mm = String(month0 + 1).padStart(2, '0')
  return [`${year}-${mm}-01`, `${year}-${mm}-${String(last).padStart(2, '0')}`]
}

export function MinutesView({
  initialMinutes, todayIso, initialView, projects, currentUserId, role,
}: {
  initialMinutes: Minute[]
  todayIso: string
  initialView: ViewKey
  projects: { id: string; name: string }[]
  currentUserId: string | null
  role: string | null
}) {
  const router = useRouter()
  const { t, locale } = useLocale()
  const [initY, initM] = useMemo(() => todayIso.split('-').map(Number), [todayIso])
  const [year, setYear] = useState(initY)
  const [month0, setMonth0] = useState((initM || 1) - 1)
  const [view, setView] = useState<ViewKey>(initialView)
  const [team, setTeam] = useState<TeamKey>('ALL')
  const [minutes, setMinutes] = useState<Minute[]>(initialMinutes)
  const [query, setQuery] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [searching, setSearching] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const reqRef = useRef(0)

  const teamOrNull = team === 'ALL' ? null : team
  const isSearch = query.trim().length > 0

  async function loadMonth(y: number, m0: number, tk: TeamKey) {
    const gen = ++reqRef.current
    const [rs, re] = monthRangeOf(y, m0)
    const rows = await fetchMinutesRange(rs, re, tk === 'ALL' ? null : tk)
    if (reqRef.current === gen) setMinutes(rows)
  }
  function shift(delta: number) {
    if (isSearch) return
    const base = new Date(Date.UTC(year, month0 + delta, 1))
    const y = base.getUTCFullYear(); const m0 = base.getUTCMonth()
    setYear(y); setMonth0(m0)
    setSelectedDate(null)
    void loadMonth(y, m0, team)
  }
  function changeTeam(tk: TeamKey) {
    setTeam(tk)
    setSelectedDate(null)
    if (isSearch) void runSearch(query, tk)
    else void loadMonth(year, month0, tk)
  }
  async function runSearch(q: string, tk: TeamKey) {
    const gen = ++reqRef.current
    if (!q.trim()) { void loadMonth(year, month0, tk); return }
    setSearching(true)
    const rows = await fetchMinutesSearch(q, tk === 'ALL' ? null : tk)
    if (reqRef.current === gen) { setMinutes(rows); setSearching(false) }
  }
  function changeView(v: ViewKey) {
    setView(v)
    queueUiPref({ minutesView: v })
  }

  // 일자별 그룹(내림차순)
  const groups = useMemo(() => {
    const map = new Map<string, Minute[]>()
    for (const mi of minutes) {
      const arr = map.get(mi.minuteDate) ?? []
      arr.push(mi); map.set(mi.minuteDate, arr)
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [minutes])

  const ymLabel = `${year}-${String(month0 + 1).padStart(2, '0')}`
  const kpiByTeam = useMemo(() => {
    const c: Record<string, number> = {}
    for (const tk of TEAM_CODES) c[tk] = 0
    for (const mi of minutes) c[mi.teamCode] = (c[mi.teamCode] ?? 0) + 1
    return c
  }, [minutes])

  return (
    <div className="space-y-4">
      {/* 필터 바 + 카운트 요약 (스크롤 시 상단 고정) */}
      <div className="sticky top-0 z-20 -mx-1 space-y-3 bg-canvas/95 px-1 pb-3 pt-1 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedTabs<TeamKey>
            tabs={[{ key: 'ALL', label: t('min.team.all') }, ...TEAM_CODES.map(tk => ({ key: tk, label: tk }))]}
            value={team} onChange={changeTeam} size="sm" />
          <div className="flex items-center gap-1">
            <button onClick={() => shift(-1)} disabled={isSearch} className="chrome-icon disabled:opacity-40" aria-label="prev month">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[84px] text-center text-sm font-semibold tabular-nums">{ymLabel}</span>
            <button onClick={() => shift(1)} disabled={isSearch} className="chrome-icon disabled:opacity-40" aria-label="next month">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
            <input value={query}
              onChange={e => { setQuery(e.target.value); void runSearch(e.target.value, team) }}
              placeholder={t('min.search.placeholder')}
              className="app-input h-9 w-56 pl-8" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SegmentedTabs<ViewKey>
              tabs={[{ key: 'list', label: t('min.view.list'), icon: List },
                     { key: 'calendar', label: t('min.view.calendar'), icon: CalendarDays }]}
              value={isSearch ? 'list' : view} onChange={changeView} size="sm" />
            <button onClick={() => setChatOpen(true)} className="btn">
              <Bot className="h-4 w-4" />{t('min.chat.archive.title')}
            </button>
            <button onClick={() => setUploadOpen(true)} className="btn btn-primary">
              <Plus className="h-4 w-4" />{t('min.upload')}
            </button>
          </div>
        </div>

        {/* 담당별 카운트 요약 */}
        <div className="flex flex-wrap gap-3 text-xs text-ink-muted">
          <span className="font-medium text-ink">{t('min.team.all')} {minutes.length}</span>
          {TEAM_CODES.map(tk => (
            <span key={tk} className="inline-flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${TEAM[tk].bar}`} />
              {tk} {kpiByTeam[tk]}
            </span>
          ))}
        </div>
      </div>

      {isSearch && minutes.length >= 100 && (
        <p className="text-xs text-ink-subtle">{t('min.search.truncated')}</p>
      )}

      {/* 리스트 뷰 (검색 중에는 강제 리스트) */}
      {(view === 'list' || isSearch) && (
        groups.length === 0 ? (
          <EmptyState title={t('min.empty.title')} description={t('min.empty.desc')} />
        ) : (
          <div className="space-y-4">
            {groups.map(([date, rows]) => (
              <section key={date} className="card p-3">
                <h3 className="mb-2 px-1 text-sm font-semibold text-ink-muted">{date}</h3>
                <ul className="divide-y divide-line/70">
                  {rows.map(mi => (
                    <li key={mi.id}>
                      <Link href={`/minutes/${mi.id}`}
                        className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2">
                        <span className={`inline-flex w-12 shrink-0 justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${TEAM[mi.teamCode].bar}`}>
                          {mi.teamCode}
                        </span>
                        <span className="flex-1 truncate text-sm font-medium text-ink">{mi.title}</span>
                        {(mi.fileCount ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs text-ink-subtle">
                            <Paperclip className="h-3.5 w-3.5" />{mi.fileCount}
                          </span>
                        )}
                        <span className="w-24 truncate text-right text-xs text-ink-subtle">{mi.createdByName ?? ''}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )
      )}

      {/* 달력 뷰 */}
      {view === 'calendar' && !isSearch && (
        <div className="space-y-3">
          <MinutesCalendar year={year} month0={month0} todayIso={todayIso}
            minutes={minutes} onSelectDate={d => setSelectedDate(prev => (prev === d ? null : d))}
            selectedDate={selectedDate} />
          {selectedDate && (
            <section className="card p-3">
              <h3 className="mb-2 px-1 text-sm font-semibold text-ink-muted">{selectedDate}</h3>
              <ul className="divide-y divide-line/70">
                {minutes.filter(mi => mi.minuteDate === selectedDate).map(mi => (
                  <li key={mi.id}>
                    <Link href={`/minutes/${mi.id}`}
                      className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2">
                      <span className={`inline-flex w-12 shrink-0 justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${TEAM[mi.teamCode].bar}`}>
                        {mi.teamCode}
                      </span>
                      <span className="flex-1 truncate text-sm font-medium text-ink">{mi.title}</span>
                      <span className="w-24 truncate text-right text-xs text-ink-subtle">{mi.createdByName ?? ''}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* 업로드 모달 — 열 때마다 리마운트해 이전 입력(첨부·제목)이 잔존하지 않게 함 */}
      {uploadOpen && (
        <MinuteUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)}
          onSaved={() => {
            setUploadOpen(false)
            if (isSearch) void runSearch(query, team); else void loadMonth(year, month0, team)
            router.refresh()
          }}
          todayIso={todayIso} projects={projects} />
      )}
      <ArchiveChatPanel open={chatOpen} onClose={() => setChatOpen(false)}
        team={teamOrNull}
        from={isSearch ? null : monthRangeOf(year, month0)[0]}
        to={isSearch ? null : monthRangeOf(year, month0)[1]} />
      {void currentUserId} {void role} {void locale}
    </div>
  )
}
