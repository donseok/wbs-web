'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft, ChevronRight, CalendarDays, List, Plus, CalendarX2,
} from 'lucide-react'
import type { AttendanceRecord, AttendanceType, ProjectMember } from '@/lib/domain/types'
import { Modal } from '@/components/ui/Modal'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { fmtDate } from '@/components/wbs/shared'
import {
  ATTENDANCE_META, ATTENDANCE_TYPES, monthMatrix, recordsByDate,
} from '@/lib/domain/attendance'
import { upsertAttendance, removeAttendance } from '@/app/actions/attendance'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
type ViewKey = 'calendar' | 'list'

function dowClass(dow: number, base = 'text-ink') {
  if (dow === 0) return 'text-delayed'
  if (dow === 6) return 'text-progress'
  return base
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
  const [initY, initM] = useMemo(() => initialDate.split('-').map(Number), [initialDate])
  const [year, setYear] = useState(initY)
  const [month0, setMonth0] = useState((initM || 1) - 1)
  const [memberFilter, setMemberFilter] = useState<string>('all')
  const [view, setView] = useState<ViewKey>('calendar')

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

  const filtered = useMemo(
    () => (memberFilter === 'all' ? records : records.filter(r => r.memberId === memberFilter)),
    [records, memberFilter],
  )
  const byDate = useMemo(() => recordsByDate(filtered), [filtered])
  const matrix = useMemo(() => monthMatrix(year, month0), [year, month0])
  const ym = `${year}-${String(month0 + 1).padStart(2, '0')}`

  const listRows = useMemo(
    () => [...filtered].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.memberId.localeCompare(b.memberId))),
    [filtered],
  )

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
    if (!res.ok) { setFormErr(res.error ?? '삭제에 실패했습니다.'); return }
    setOpen(false)
    router.refresh()
  }

  async function submit() {
    if (!form.memberId) { setFormErr('멤버를 선택하세요.'); return }
    if (!form.date) { setFormErr('날짜를 선택하세요.'); return }
    setSaving(true)
    setFormErr(null)
    const res = await upsertAttendance(projectId, {
      memberId: form.memberId,
      date: form.date,
      type: form.type,
      note: form.note.trim() || null,
    })
    setSaving(false)
    if (!res.ok) { setFormErr(res.error ?? '저장에 실패했습니다.'); return }
    setOpen(false)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {/* 툴바 */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="chrome-icon" aria-label="이전 달"><ChevronLeft className="h-4 w-4" /></button>
          <div className="min-w-[116px] text-center text-base font-bold tabular-nums text-ink">{year}년 {month0 + 1}월</div>
          <button onClick={() => shift(1)} className="chrome-icon" aria-label="다음 달"><ChevronRight className="h-4 w-4" /></button>
          <button onClick={goToday} className="btn btn-ghost h-10">오늘</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={memberFilter}
            onChange={e => setMemberFilter(e.target.value)}
            className="app-input h-10 w-auto min-w-[140px]"
            aria-label="멤버 필터"
          >
            <option value="all">전체 멤버</option>
            {members.map(m => (
              <option key={m.id} value={m.id}>{m.name}{m.teamCode ? ` · ${m.teamCode}` : ''}</option>
            ))}
          </select>
          <SegmentedTabs<ViewKey>
            tabs={[
              { key: 'calendar', label: '캘린더', icon: CalendarDays },
              { key: 'list', label: '리스트', icon: List },
            ]}
            value={view}
            onChange={setView}
            size="sm"
          />
          {canEdit && (
            <button onClick={openCreate} className="btn btn-primary"><Plus className="h-4 w-4" />근태 등록</button>
          )}
        </div>
      </div>

      {/* 범례 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {ATTENDANCE_TYPES.map(t => (
          <span key={t} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
            <span className={`h-2 w-2 rounded-full ${ATTENDANCE_META[t].dot}`} />
            {ATTENDANCE_META[t].label}
          </span>
        ))}
      </div>

      {view === 'calendar' ? (
        <div className="card overflow-hidden p-0">
          <div className="grid grid-cols-7 gap-px bg-line">
            {WEEKDAYS.map((w, i) => (
              <div key={w} className={`bg-surface-2 py-2 text-center text-[11px] font-semibold ${dowClass(i, 'text-ink-muted')}`}>{w}</div>
            ))}
            {matrix.flat().map((cell, idx) => {
              const dow = idx % 7
              const inMonth = cell.startsWith(ym)
              const isToday = cell === initialDate
              const dayNum = Number(cell.slice(8, 10))
              const dayRecs = byDate[cell] ?? []
              return (
                <div key={cell} className={`min-h-[96px] bg-surface p-1.5 ${inMonth ? '' : 'opacity-40'}`}>
                  <div className="flex items-center justify-between px-0.5">
                    <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums ${isToday ? 'bg-brand text-white' : dowClass(dow)}`}>
                      {dayNum}
                    </span>
                  </div>
                  <div className="mt-1 space-y-1">
                    {dayRecs.slice(0, 3).map(r => {
                      const meta = ATTENDANCE_META[r.type]
                      const mem = memberMap.get(r.memberId)
                      return (
                        <div
                          key={r.id}
                          onClick={canEdit ? () => openEdit(r) : undefined}
                          role={canEdit ? 'button' : undefined}
                          tabIndex={canEdit ? 0 : undefined}
                          onKeyDown={canEdit ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(r) } } : undefined}
                          className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ${meta.chip} ${canEdit ? 'cursor-pointer hover:ring-1 hover:ring-brand-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring' : ''}`}
                          title={`${mem?.name ?? '?'} · ${meta.label}${r.note ? ` · ${r.note}` : ''}${canEdit ? ' · 클릭하여 수정' : ''}`}
                        >
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                          <span className="truncate">{mem?.name ?? '?'}</span>
                          <span className="ml-auto shrink-0 opacity-75">{meta.short}</span>
                        </div>
                      )
                    })}
                    {dayRecs.length > 3 && (
                      <div className="px-1 text-[10px] font-medium text-ink-subtle">+{dayRecs.length - 3}건</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : listRows.length === 0 ? (
        <EmptyState
          icon={CalendarX2}
          title="근태 기록이 없습니다"
          description={memberFilter === 'all' ? '아직 등록된 근태가 없습니다.' : '선택한 멤버의 근태 기록이 없습니다.'}
        />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                  <th className="px-4 py-3">날짜</th>
                  <th className="px-4 py-3">멤버</th>
                  <th className="px-4 py-3">팀</th>
                  <th className="px-4 py-3">근태</th>
                  <th className="px-4 py-3">비고</th>
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
                        <div className="font-medium text-ink">{mem?.name ?? '알 수 없음'}</div>
                        {mem?.title && <div className="text-xs text-ink-subtle">{mem.title}</div>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{mem?.teamCode ?? '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`chip ${meta.chip}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
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
        title={editingId ? '근태 수정' : '근태 등록'}
        footer={
          <>
            {editingId && (
              <button onClick={() => setConfirmingDelete(true)} disabled={deleting || saving} className="btn btn-ghost mr-auto text-delayed hover:bg-delayed-weak">
                {deleting ? '삭제 중…' : '삭제'}
              </button>
            )}
            <button onClick={() => setOpen(false)} className="btn btn-ghost">취소</button>
            <button onClick={submit} disabled={saving || deleting} className="btn btn-primary">{saving ? '저장 중…' : '저장'}</button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">멤버</span>
            <select
              value={form.memberId}
              onChange={e => setForm(f => ({ ...f, memberId: e.target.value }))}
              disabled={!!editingId}
              className="app-input disabled:opacity-60"
            >
              {members.length === 0 && <option value="">멤버 없음</option>}
              {members.map(m => (
                <option key={m.id} value={m.id}>{m.name}{m.teamCode ? ` · ${m.teamCode}` : ''}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">날짜</span>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                disabled={!!editingId}
                className="app-input px-2 text-xs disabled:opacity-60"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">근태 유형</span>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as AttendanceType }))}
                className="app-input"
              >
                {ATTENDANCE_TYPES.map(t => (
                  <option key={t} value={t}>{ATTENDANCE_META[t].label}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">비고 (선택)</span>
            <textarea
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              rows={2}
              placeholder="예: 부산공장 현장 점검"
              className="app-textarea"
            />
          </label>
          {editingId && (
            <p className="text-[11px] leading-5 text-ink-subtle">멤버·날짜는 수정할 수 없습니다. 변경하려면 삭제 후 다시 등록하세요.</p>
          )}
          {formErr && <p className="text-xs font-medium text-delayed">{formErr}</p>}
        </div>
      </Modal>

      {/* 근태 삭제 확인 모달 — 취소 시 수정 모달로 복귀 */}
      <Modal
        open={open && confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        size="sm"
        eyebrow="Remove attendance"
        title="근태 삭제"
        footer={
          <>
            <button onClick={() => setConfirmingDelete(false)} className="btn btn-ghost" disabled={deleting}>
              취소
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="btn bg-delayed text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? '삭제 중…' : '삭제'}
            </button>
          </>
        }
      >
        <p className="text-sm leading-6 text-ink-muted">
          <strong className="text-ink">{memberMap.get(form.memberId)?.name ?? '알 수 없음'}</strong> 님의 {fmtDate(form.date)} 근태 기록을 삭제할까요? 이 작업은 되돌릴 수 없습니다.
        </p>
      </Modal>
    </div>
  )
}
