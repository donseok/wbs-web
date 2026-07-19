'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ChevronLeft, ChevronRight, CalendarDays, List, Plus, CalendarX2,
} from 'lucide-react'
import type { AttendanceRecord, AttendanceType, ProjectMember, TeamCode } from '@/lib/domain/types'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { DayPopover, type DayPopoverAnchor } from '@/components/ui/DayPopover'
import { fmtDate } from '@/components/wbs/shared'
import {
  ATTENDANCE_META, ATTENDANCE_TYPES, monthMatrix, recordsByDate,
} from '@/lib/domain/attendance'
import { krSpecialDayMap } from '@/lib/domain/holidays'
import { upsertAttendance, removeAttendance } from '@/app/actions/attendance'
import { useBotPageContext } from '@/components/chat/BotPageContextProvider'

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
type ViewKey = 'calendar' | 'list'
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const FILTER_TEAMS: readonly TeamCode[] = ['PMO', 'ERP', 'MES', '가공', 'MDM']

function dowClass(dow: number, base = 'text-ink') {
  if (dow === 0) return 'text-delayed'
  if (dow === 6) return 'text-progress'
  return base
}

interface BotDeepLinkFilter {
  from: string | null
  to: string | null
  team: TeamCode | null
  type: AttendanceType | null
}

/** 챗봇 딥링크(?from&to&team&type) 초기 필터 — 유효값만 채택, 아무 것도 없으면 null. */
function readBotFilter(params: { get(name: string): string | null }): BotDeepLinkFilter | null {
  const rawFrom = params.get('from')
  const rawTo = params.get('to')
  // 기간은 from·to가 함께 유효할 때만 적용한다(도구 조회 계약과 동일).
  const rangeValid = !!rawFrom && !!rawTo
    && ISO_DAY_RE.test(rawFrom) && ISO_DAY_RE.test(rawTo) && rawFrom <= rawTo
  const rawTeam = params.get('team')
  const team = rawTeam && (FILTER_TEAMS as readonly string[]).includes(rawTeam)
    ? (rawTeam as TeamCode)
    : null
  const rawType = params.get('type')
  const type = rawType && (ATTENDANCE_TYPES as readonly string[]).includes(rawType)
    ? (rawType as AttendanceType)
    : null
  if (!rangeValid && !team && !type) return null
  return { from: rangeValid ? rawFrom : null, to: rangeValid ? rawTo : null, team, type }
}

export function AttendanceView({
  projectId, records, members, initialDate, canEdit,
}: {
  projectId: string
  records: AttendanceRecord[]
  members: ProjectMember[]
  initialDate: string // 'YYYY-MM-DD' (오늘, Asia/Seoul)
  canEdit: boolean
}) {
  const router = useRouter()
  const { t, locale } = useLocale()
  // 근태 타입 라벨 — 원본 상수(ATTENDANCE_META)는 로직 키로 유지하고 표시 지점에서만 매핑.
  const typeLabel = (ty: AttendanceType) => t(`att.type.${ty}` as DictKey)
  const typeShort = (ty: AttendanceType) => t(`att.typeShort.${ty}` as DictKey)
  const searchParams = useSearchParams()
  // 챗봇 딥링크 필터는 최초 마운트에서 한 번만 읽고, 해제 전까지 달력·목록에 적용한다.
  const [botFilter, setBotFilter] = useState(() => readBotFilter(searchParams))
  const [initY, initM] = useMemo(() => initialDate.split('-').map(Number), [initialDate])
  const [year, setYear] = useState(botFilter?.from ? Number(botFilter.from.slice(0, 4)) : initY)
  const [month0, setMonth0] = useState(
    botFilter?.from ? Number(botFilter.from.slice(5, 7)) - 1 : (initM || 1) - 1,
  )
  const [memberFilter, setMemberFilter] = useState<string>('all')
  const [view, setView] = useState<ViewKey>('calendar')
  const [more, setMore] = useState<DayPopoverAnchor | null>(null)

  // 등록/수정 모달
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [form, setForm] = useState<{ memberId: string; date: string; type: AttendanceType; note: string }>({
    memberId: members[0]?.id ?? '',
    date: initialDate,
    type: 'work',
    note: '',
  })

  const memberMap = useMemo(() => {
    const map = new Map<string, ProjectMember>()
    members.forEach(m => map.set(m.id, m))
    return map
  }, [members])

  const filtered = useMemo(() => {
    const base = memberFilter === 'all' ? records : records.filter(r => r.memberId === memberFilter)
    if (!botFilter) return base
    return base.filter(r => {
      if (botFilter.from && r.date < botFilter.from) return false
      if (botFilter.to && r.date > botFilter.to) return false
      if (botFilter.type && r.type !== botFilter.type) return false
      if (botFilter.team && memberMap.get(r.memberId)?.teamCode !== botFilter.team) return false
      return true
    })
  }, [records, memberFilter, botFilter, memberMap])
  const byDate = useMemo(() => recordsByDate(filtered), [filtered])
  const matrix = useMemo(() => monthMatrix(year, month0), [year, month0])
  // 법정 공휴일·국경일 조회 맵 — 그리드가 연도 경계를 넘을 수 있어 셀에 등장하는 모든 연도를 모은다.
  const specialDays = useMemo(
    () => krSpecialDayMap(matrix.flat().map(cell => Number(cell.slice(0, 4)))),
    [matrix],
  )
  const ym = `${year}-${String(month0 + 1).padStart(2, '0')}`
  const monthEnd = `${ym}-${String(new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()).padStart(2, '0')}`
  useBotPageContext({
    domain: 'attendance',
    projectId,
    selectedEntity: editingId ? { type: 'attendance_record', id: editingId } : null,
    view,
    range: { from: `${ym}-01`, to: monthEnd },
    filters: {
      ...(memberFilter === 'all' ? {} : { memberId: memberFilter }),
      ...(botFilter?.team ? { team: botFilter.team } : {}),
    },
  })

  const listRows = useMemo(
    () => [...filtered].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.memberId.localeCompare(b.memberId))),
    [filtered],
  )

  // 셀·팝오버가 공유하는 근태 칩 — canEdit일 때만 클릭/키보드로 수정 진입
  function renderRecChip(r: AttendanceRecord, onOpen?: () => void) {
    const meta = ATTENDANCE_META[r.type]
    const mem = memberMap.get(r.memberId)
    const open = canEdit ? () => { onOpen?.(); openEdit(r) } : undefined
    return (
      <div
        key={r.id}
        onClick={open}
        role={canEdit ? 'button' : undefined}
        tabIndex={canEdit ? 0 : undefined}
        onKeyDown={open ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } } : undefined}
        className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ${meta.chip} ${canEdit ? 'cursor-pointer hover:ring-1 hover:ring-brand-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring' : ''}`}
        title={`${mem?.name ?? '?'} · ${typeLabel(r.type)}${r.note ? ` · ${r.note}` : ''}${canEdit ? ` · ${t('att.clickToEdit')}` : ''}`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
        <span className="truncate">{mem?.name ?? '?'}</span>
        <span className="ml-auto shrink-0 opacity-75">{typeShort(r.type)}</span>
      </div>
    )
  }

  function shift(delta: number) {
    const base = new Date(Date.UTC(year, month0 + delta, 1))
    setYear(base.getUTCFullYear())
    setMonth0(base.getUTCMonth())
  }
  function goToday() {
    setYear(initY)
    setMonth0((initM || 1) - 1)
  }

  function openCreate() {
    setEditingId(null)
    setForm({ memberId: members[0]?.id ?? '', date: initialDate, type: 'work', note: '' })
    setFormErr(null)
    setConfirmingDelete(false)
    setOpen(true)
  }

  function openEdit(r: AttendanceRecord) {
    if (!canEdit) return
    setEditingId(r.id)
    setForm({ memberId: r.memberId, date: r.date, type: r.type, note: r.note ?? '' })
    setFormErr(null)
    setConfirmingDelete(false)
    setOpen(true)
  }

  async function handleDelete() {
    if (!editingId) return
    setDeleting(true)
    const res = await removeAttendance(editingId)
    setDeleting(false)
    setConfirmingDelete(false)
    if (!res.ok) { setFormErr(res.error ?? t('att.err.deleteFailed')); return }
    setOpen(false)
    router.refresh()
  }

  async function submit() {
    if (!form.memberId) { setFormErr(t('att.err.selectMember')); return }
    if (!form.date) { setFormErr(t('att.err.selectDate')); return }
    setSaving(true)
    setFormErr(null)
    const res = await upsertAttendance(projectId, {
      memberId: form.memberId,
      date: form.date,
      type: form.type,
      note: form.note.trim() || null,
    })
    setSaving(false)
    if (!res.ok) { setFormErr(res.error ?? t('att.err.saveFailed')); return }
    setOpen(false)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {/* 툴바 + 범례 (스크롤 시 상단 고정) */}
      <div className="sticky top-0 z-20 -mx-1 space-y-3 bg-canvas/95 px-1 pb-3 pt-1 backdrop-blur-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => shift(-1)} className="chrome-icon" aria-label={t('att.prevMonth')}><ChevronLeft className="h-4 w-4" /></button>
            <div className="min-w-[116px] text-center text-base font-bold tabular-nums text-ink">
              {new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: locale === 'ko' ? 'numeric' : 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month0, 1)))}
            </div>
            <button onClick={() => shift(1)} className="chrome-icon" aria-label={t('att.nextMonth')}><ChevronRight className="h-4 w-4" /></button>
            <button onClick={goToday} className="btn btn-ghost h-10">{t('att.today')}</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={memberFilter}
              onChange={e => setMemberFilter(e.target.value)}
              className="app-input h-10 w-auto min-w-[140px]"
              aria-label={t('att.memberFilter')}
            >
              <option value="all">{t('att.allMembers')}</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>{m.name}{m.teamCode ? ` · ${m.teamCode}` : ''}</option>
              ))}
            </select>
            <SegmentedTabs<ViewKey>
              tabs={[
                { key: 'calendar', label: t('att.view.calendar'), icon: CalendarDays },
                { key: 'list', label: t('att.view.list'), icon: List },
              ]}
              value={view}
              onChange={setView}
              size="sm"
            />
            {canEdit && (
              <button onClick={openCreate} className="btn btn-primary"><Plus className="h-4 w-4" />{t('att.addRecord')}</button>
            )}
          </div>
        </div>

        {/* 범례 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {ATTENDANCE_TYPES.map(ty => (
            <span key={ty} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
              <span className={`h-2 w-2 rounded-full ${ATTENDANCE_META[ty].dot}`} />
              {typeLabel(ty)}
            </span>
          ))}
        </div>

        {/* 챗봇 딥링크 필터 — 해제 전까지 달력·목록에 적용 (신규 문구는 dict 미보유라 locale 분기) */}
        {botFilter && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-ink-muted">
            <span className="text-ink-subtle">{locale === 'en' ? 'DK Bot filter' : 'DK Bot 필터'}</span>
            {botFilter.from && botFilter.to && (
              <span className="chip bg-surface-2 tabular-nums text-ink-muted">{botFilter.from} ~ {botFilter.to}</span>
            )}
            {botFilter.team && <span className="chip bg-surface-2 text-ink-muted">{botFilter.team}</span>}
            {botFilter.type && <span className="chip bg-surface-2 text-ink-muted">{typeLabel(botFilter.type)}</span>}
            <button onClick={() => setBotFilter(null)} className="btn btn-ghost h-7 px-2 text-[11px]">
              {locale === 'en' ? 'Clear' : '해제'}
            </button>
          </div>
        )}
      </div>

      {view === 'calendar' ? (
        <div className="card overflow-hidden p-0">
          <div className="grid grid-cols-7 gap-px bg-line">
            {WEEKDAY_KEYS.map((w, i) => (
              <div key={w} className={`bg-surface-2 py-2 text-center text-[11px] font-semibold ${dowClass(i, 'text-ink-muted')}`}>{t(`att.weekday.${w}` as DictKey)}</div>
            ))}
            {matrix.flat().map((cell, idx) => {
              const dow = idx % 7
              const inMonth = cell.startsWith(ym)
              const isToday = cell === initialDate
              const dayNum = Number(cell.slice(8, 10))
              const dayRecs = byDate[cell] ?? []
              const special = specialDays.get(cell)
              // 쉬는 날(공휴일·대체공휴일)만 날짜를 빨간색으로 — 제헌절·근로자의날(anniversary)은 이름만 표시
              const isRestDay = !!special && special.kind !== 'anniversary'
              const specialName = special ? t(`hol.${special.name}` as DictKey) : null
              return (
                <div key={cell} className={`min-h-[96px] bg-surface p-1.5 ${inMonth ? '' : 'opacity-40'}`}>
                  <div className="flex items-center justify-between gap-1 px-0.5">
                    <span className={`inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums ${isToday ? 'bg-brand text-white' : isRestDay ? 'text-delayed' : dowClass(dow)}`}>
                      {dayNum}
                    </span>
                    {specialName && (
                      <span
                        className={`min-w-0 truncate text-[10px] font-medium ${isRestDay ? 'text-delayed' : 'text-ink-subtle'}`}
                        title={specialName}
                      >
                        {specialName}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 space-y-1">
                    {dayRecs.slice(0, 3).map(r => renderRecChip(r))}
                    {dayRecs.length > 3 && (
                      <button
                        onClick={e => {
                          const r = e.currentTarget.getBoundingClientRect()
                          setMore({ date: cell, rect: { top: r.top, bottom: r.bottom, left: r.left } })
                        }}
                        className="w-full rounded-md px-1 py-0.5 text-left text-[10px] font-medium text-ink-subtle transition hover:bg-surface-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                      >
                        +{dayRecs.length - 3}{t('att.moreSuffix')}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {more && (
            <DayPopover anchor={more} count={(byDate[more.date] ?? []).length} onClose={() => setMore(null)}>
              {(byDate[more.date] ?? []).map(r => renderRecChip(r, () => setMore(null)))}
            </DayPopover>
          )}
        </div>
      ) : listRows.length === 0 ? (
        <EmptyState
          icon={CalendarX2}
          title={t('att.empty.title')}
          description={memberFilter === 'all' ? t('att.empty.all') : t('att.empty.member')}
        />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                  <th className="px-4 py-3">{t('att.col.date')}</th>
                  <th className="px-4 py-3">{t('att.col.member')}</th>
                  <th className="px-4 py-3">{t('att.col.team')}</th>
                  <th className="px-4 py-3">{t('att.col.type')}</th>
                  <th className="px-4 py-3">{t('att.col.note')}</th>
                </tr>
              </thead>
              <tbody>
                {listRows.map(r => {
                  const meta = ATTENDANCE_META[r.type]
                  const mem = memberMap.get(r.memberId)
                  return (
                    <tr
                      key={r.id}
                      onClick={canEdit ? () => openEdit(r) : undefined}
                      role={canEdit ? 'button' : undefined}
                      tabIndex={canEdit ? 0 : undefined}
                      onKeyDown={canEdit ? e => { if (e.key === 'Enter') openEdit(r) } : undefined}
                      className={`border-b border-line/70 last:border-0 transition hover:bg-surface-2 ${canEdit ? 'cursor-pointer focus:outline-none focus-visible:bg-surface-2' : ''}`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums text-ink">{fmtDate(r.date)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink">{mem?.name ?? t('att.unknown')}</div>
                        {mem?.title && <div className="text-xs text-ink-subtle">{mem.title}</div>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{mem?.teamCode ?? '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`chip ${meta.chip}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                          {typeLabel(r.type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{r.note || '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 근태 등록 모달 — 삭제 확인 모달과 상호배타로 렌더(포커스 트랩/Escape 충돌 방지) */}
      <Modal
        open={open && !confirmingDelete}
        onClose={() => setOpen(false)}
        eyebrow="ATTENDANCE"
        title={editingId ? t('att.editRecord') : t('att.addRecord')}
        footer={
          <>
            {editingId && (
              <button onClick={() => setConfirmingDelete(true)} disabled={deleting || saving} className="btn btn-ghost mr-auto text-delayed hover:bg-delayed-weak">
                {deleting ? t('att.deleting') : t('common.delete')}
              </button>
            )}
            <button onClick={() => setOpen(false)} className="btn btn-ghost">{t('common.cancel')}</button>
            <button onClick={submit} disabled={saving || deleting} className="btn btn-primary">{saving ? t('att.saving') : t('common.save')}</button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('att.form.member')}</span>
            <select
              value={form.memberId}
              onChange={e => setForm(f => ({ ...f, memberId: e.target.value }))}
              disabled={!!editingId}
              className="app-input disabled:opacity-60"
            >
              {members.length === 0 && <option value="">{t('att.form.noMembers')}</option>}
              {members.map(m => (
                <option key={m.id} value={m.id}>{m.name}{m.teamCode ? ` · ${m.teamCode}` : ''}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('att.form.date')}</span>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                disabled={!!editingId}
                className="app-input px-2 text-xs disabled:opacity-60"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('att.form.type')}</span>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as AttendanceType }))}
                className="app-input"
              >
                {ATTENDANCE_TYPES.map(ty => (
                  <option key={ty} value={ty}>{typeLabel(ty)}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('att.form.note')}</span>
            <textarea
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              rows={2}
              placeholder={t('att.form.notePlaceholder')}
              className="app-textarea"
            />
          </label>
          {editingId && (
            <p className="text-[11px] leading-5 text-ink-subtle">{t('att.form.lockedHint')}</p>
          )}
          {formErr && <p className="text-xs font-medium text-delayed">{formErr}</p>}
        </div>
      </Modal>

      {/* 근태 삭제 확인 모달 — 취소 시 수정 모달로 복귀 */}
      <Modal
        open={open && confirmingDelete}
        onClose={() => { if (!deleting) setConfirmingDelete(false) }}
        size="sm"
        eyebrow="Remove attendance"
        title={t('att.deleteTitle')}
        footer={
          <>
            <button onClick={() => setConfirmingDelete(false)} className="btn btn-ghost" disabled={deleting}>
              {t('common.cancel')}
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="btn bg-delayed text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? t('att.deleting') : t('common.delete')}
            </button>
          </>
        }
      >
        <p className="text-sm leading-6 text-ink-muted">
          {/* 이름·날짜가 문장 중간에 끼고 어순이 달라 t() 파라미터 치환 없이 locale 분기로 조합 */}
          {locale === 'en' ? (
            <>Delete the {fmtDate(form.date)} attendance record for <strong className="text-ink">{memberMap.get(form.memberId)?.name ?? t('att.unknown')}</strong>? This action cannot be undone.</>
          ) : (
            <><strong className="text-ink">{memberMap.get(form.memberId)?.name ?? t('att.unknown')}</strong> 님의 {fmtDate(form.date)} 근태 기록을 삭제할까요? 이 작업은 되돌릴 수 없습니다.</>
          )}
        </p>
      </Modal>
    </div>
  )
}
