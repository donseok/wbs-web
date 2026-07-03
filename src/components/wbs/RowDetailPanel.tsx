'use client'
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { X, Clock, FileText, CalendarRange, Scale, History, User, Pencil, Plus, ChevronUp, ChevronDown, Trash2, Paperclip, Upload } from 'lucide-react'
import type { ComputedItem, DeliverableAttachment, Level, TeamCode } from '@/lib/domain/types'
import {
  getChangeLogs, updateWbsFields, addWbsItem, deleteWbsItem, moveWbsItem, type ChangeLogEntry,
} from '@/app/actions/wbs'
import { listAttachments, recordAttachment, removeAttachment } from '@/app/actions/attachments'
import { createBrowserClient } from '@/lib/supabase/client'
import { roundWeight } from '@/lib/domain/format'
import { LevelBadge, OwnerBadges, STATUS, fmtDate } from './shared'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'

type Tr = (k: DictKey) => string
const ROLE_KEY: Record<string, DictKey> = { pmo_admin: 'wbs.rolePmoAdmin', team_editor: 'wbs.roleTeamEditor' }
const FIELD_KEY: Record<string, DictKey> = {
  actual_pct: 'wbs.colActualPct', weight: 'wbs.colWeight', name: 'wbs.fieldName', planned_start: 'wbs.colPlannedStart',
  planned_end: 'wbs.colPlannedEnd', deliverable: 'wbs.colDeliverable', biz: 'wbs.fieldBiz', created: 'wbs.fieldCreated',
}
const CHILD_LEVEL: Record<Level, Level | null> = { phase: 'task', task: 'activity', activity: null }

function fmtValue(field: string, v: string | null, t: Tr): string {
  if (v == null || v === '') return field === 'weight' ? t('wbs.weightEqual') : '—'
  if (field === 'weight' && !Number.isNaN(Number(v))) return String(roundWeight(Number(v)))
  return field === 'actual_pct' ? `${v}%` : v
}
function fmtAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function actorLabel(team: TeamCode | null, role: string | null, t: Tr): string {
  const r = role ? (ROLE_KEY[role] ? t(ROLE_KEY[role]) : role) : null
  if (team && r) return `${team} · ${r}`
  return r ?? team ?? t('wbs.unknownActor')
}

/** WBS 행 상세 패널 — 읽기(개요/담당/일정/진척/산출물 + 변경 이력)
 *  + PMO 편집(이름·일정·산출물 수정, 하위 추가, 순서 이동, 삭제). */
export function RowDetailPanel({
  item, onClose, editable = false, canAttach = false, projectId,
}: {
  item: ComputedItem
  onClose: () => void
  editable?: boolean
  canAttach?: boolean
  projectId: string
}) {
  const router = useRouter()
  const { t } = useLocale()
  const [logs, setLogs] = useState<ChangeLogEntry[] | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [addName, setAddName] = useState<string | null>(null) // null=닫힘
  const [form, setForm] = useState({
    name: item.name, start: item.plannedStart ?? '', end: item.plannedEnd ?? '', deliverable: item.deliverable ?? '',
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let alive = true
    setLogs(null)
    setEditing(false); setConfirmDel(false); setAddName(null); setErr(null)
    setForm({ name: item.name, start: item.plannedStart ?? '', end: item.plannedEnd ?? '', deliverable: item.deliverable ?? '' })
    getChangeLogs(item.id).then(r => { if (alive) setLogs(r) }).catch(() => { if (alive) setLogs([]) })
    return () => { alive = false }
  }, [item.id, item.name, item.plannedStart, item.plannedEnd, item.deliverable])

  const childLevel = CHILD_LEVEL[item.level]

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setBusy(true); setErr(null)
    const res = await fn()
    setBusy(false)
    if (!res.ok) { setErr(res.error ?? t('wbs.errGeneric')); return }
    after?.()
    router.refresh()
  }

  const saveFields = () =>
    run(() => updateWbsFields(item.id, {
      name: form.name,
      plannedStart: form.start || null,
      plannedEnd: form.end || null,
      deliverable: form.deliverable || null,
    }), () => setEditing(false))

  const addChild = () => {
    if (!childLevel || !addName?.trim()) return
    run(() => addWbsItem(projectId, item.id, childLevel, addName.trim()), () => setAddName(null))
  }
  const doDelete = () => run(() => deleteWbsItem(item.id), () => onClose())

  return (
    <div className="fixed inset-0 z-[110]" role="dialog" aria-modal="true" aria-label={`${item.name} ${t('wbs.detailSuffix')}`}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-surface shadow-[var(--shadow-xl)] animate-[slidein_.18s_ease-out]">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <LevelBadge level={item.level} />
              {item.code && <span className="text-[11px] font-semibold tabular-nums text-ink-subtle">{item.code}</span>}
            </div>
            <h2 className="mt-1.5 break-words text-[16px] font-bold leading-snug text-ink">{item.name}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {editable && !editing && (
              <button onClick={() => setEditing(true)} aria-label={t('common.edit')} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-surface-2 hover:text-ink"><Pencil className="h-4 w-4" /></button>
            )}
            <button onClick={onClose} aria-label={t('common.close')} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-surface-2 hover:text-ink"><X className="h-4 w-4" /></button>
          </div>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {editing ? (
            <section className="space-y-3">
              <label className="block"><span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('wbs.fieldName')}</span>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="app-input" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('wbs.colPlannedStart')}</span>
                  <input type="date" value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} className="app-input px-2 text-xs" /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('wbs.colPlannedEnd')}</span>
                  <input type="date" value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} className="app-input px-2 text-xs" /></label>
              </div>
              <label className="block"><span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('wbs.colDeliverable')}</span>
                <input value={form.deliverable} onChange={e => setForm(f => ({ ...f, deliverable: e.target.value }))} className="app-input" placeholder={t('wbs.deliverablePlaceholder')} /></label>
              {err && <p className="text-xs font-medium text-delayed">{err}</p>}
              <div className="flex gap-2">
                <button onClick={saveFields} disabled={busy} className="btn btn-primary flex-1">{busy ? t('wbs.saving') : t('common.save')}</button>
                <button onClick={() => { setEditing(false); setErr(null) }} className="btn btn-ghost">{t('common.cancel')}</button>
              </div>
            </section>
          ) : (
            <>
              <section className="grid grid-cols-3 gap-2">
                <Stat label={t('wbs.colPlannedPct')} value={`${item.plannedPct}%`} />
                <Stat label={t('wbs.colActualPct')} value={`${item.rolledActualPct}%`} />
                <Stat label={t('wbs.colAchievement')} value={item.achievement == null ? '—' : `${item.achievement}%`} />
              </section>
              <div className="flex items-center gap-2"><span className="text-xs text-ink-subtle">{t('wbs.colStatus')}</span><span className={`chip ${STATUS[item.status].chip}`}><span className={`h-1.5 w-1.5 rounded-full ${STATUS[item.status].dot}`} />{t(`status.${item.status}` as DictKey)}</span></div>
              <Field icon={User} label={t('wbs.colOwners')}>
                {item.owners.length ? <OwnerBadges owners={item.owners} /> : <span className="text-ink-subtle">{t('wbs.unassigned')}</span>}
              </Field>
              <Field icon={CalendarRange} label={t('wbs.plannedSchedule')}><span className="tabular-nums">{fmtDate(item.plannedStart)} ~ {fmtDate(item.plannedEnd)}</span></Field>
              <Field icon={Scale} label={t('wbs.colWeight')}><span className="tabular-nums">{item.weight == null ? t('wbs.weightEqualSiblings') : roundWeight(item.weight)}</span></Field>
              <Field icon={FileText} label={t('wbs.colDeliverable')}>{item.deliverable ? <span>{item.deliverable}</span> : <span className="text-ink-subtle">{t('common.none')}</span>}</Field>
              {item.biz && <Field icon={FileText} label="Biz"><span>{item.biz}</span></Field>}
            </>
          )}

          {/* PMO 구조 편집 */}
          {editable && !editing && (
            <section className="rounded-xl border border-line bg-surface-2/50 p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{t('wbs.structureEdit')}</div>
              <div className="flex flex-wrap gap-2">
                {childLevel && (
                  <button onClick={() => setAddName(addName == null ? '' : null)} disabled={busy} className="btn btn-ghost h-8 px-2.5 text-xs">
                    <Plus className="h-3.5 w-3.5" /> {t('wbs.addChild')}
                  </button>
                )}
                <button onClick={() => run(() => moveWbsItem(item.id, 'up'))} disabled={busy} className="btn btn-ghost h-8 px-2.5 text-xs" aria-label={t('wbs.moveUp')}><ChevronUp className="h-3.5 w-3.5" /></button>
                <button onClick={() => run(() => moveWbsItem(item.id, 'down'))} disabled={busy} className="btn btn-ghost h-8 px-2.5 text-xs" aria-label={t('wbs.moveDown')}><ChevronDown className="h-3.5 w-3.5" /></button>
                <button onClick={() => setConfirmDel(true)} disabled={busy} className="btn btn-ghost h-8 px-2.5 text-xs text-delayed hover:bg-delayed-weak"><Trash2 className="h-3.5 w-3.5" /> {t('common.delete')}</button>
              </div>
              {addName != null && childLevel && (
                <div className="mt-2 flex gap-2">
                  <input autoFocus value={addName} onChange={e => setAddName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addChild() }} placeholder={`${childLevel === 'task' ? 'Task' : 'Activity'} ${t('wbs.namePlaceholderSuffix')}`} className="app-input h-8 text-xs" />
                  <button onClick={addChild} disabled={busy || !addName.trim()} className="btn btn-primary h-8 px-3 text-xs">{t('common.add')}</button>
                </div>
              )}
              {confirmDel && (
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-delayed-weak px-3 py-2 text-xs text-delayed">
                  <span className="flex-1">{t('wbs.deleteConfirm')}</span>
                  <button onClick={doDelete} disabled={busy} className="btn h-7 bg-delayed px-2.5 text-xs text-white">{t('common.delete')}</button>
                  <button onClick={() => setConfirmDel(false)} className="btn btn-ghost h-7 px-2.5 text-xs">{t('common.cancel')}</button>
                </div>
              )}
              {err && !editing && <p className="mt-2 text-xs font-medium text-delayed">{err}</p>}
            </section>
          )}

          {/* 산출물 첨부 */}
          <AttachmentSection itemId={item.id} canAttach={canAttach} />

          {/* 변경 이력 */}
          <section>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle"><History className="h-3.5 w-3.5" /> {t('wbs.changeHistory')}</div>
            {logs == null ? (
              <p className="text-sm text-ink-subtle">{t('common.loading')}</p>
            ) : logs.length === 0 ? (
              <p className="text-sm text-ink-subtle">{t('wbs.noHistory')}</p>
            ) : (
              <ol className="space-y-2.5">
                {logs.map(log => (
                  <li key={log.id} className="rounded-xl border border-line bg-surface-2/60 p-3">
                    <div className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="font-semibold text-ink">{FIELD_KEY[log.field] ? t(FIELD_KEY[log.field]) : log.field}</span>
                      <span className="inline-flex items-center gap-1 tabular-nums text-ink-subtle"><Clock className="h-3 w-3" />{fmtAt(log.at)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[13px] tabular-nums">
                      <span className="text-ink-muted line-through decoration-ink-subtle/50">{fmtValue(log.field, log.oldValue, t)}</span>
                      <span className="text-ink-subtle">→</span>
                      <span className="font-semibold text-ink">{fmtValue(log.field, log.newValue, t)}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-ink-subtle">{actorLabel(log.actorTeam, log.actorRole, t)}</div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </aside>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">{label}</div>
      <div className="mt-0.5 text-[15px] font-bold tabular-nums text-ink">{value}</div>
    </div>
  )
}

function fmtSize(n: number | null): string {
  if (n == null) return ''
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

/** 산출물 파일 첨부 — 목록/다운로드(모두) + 업로드/삭제(담당팀·PMO). */
function AttachmentSection({ itemId, canAttach }: { itemId: string; canAttach: boolean }) {
  const router = useRouter()
  const { t } = useLocale()
  const [list, setList] = useState<DeliverableAttachment[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    listAttachments(itemId).then(setList).catch(() => setList([]))
  }, [itemId])
  useEffect(() => { setList(null); load() }, [load])

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setErr(null)
    try {
      const safe = file.name.replace(/[^\w.\-가-힣]+/g, '_')
      const path = `${itemId}/${new Date().getTime()}-${safe}`
      const sb = createBrowserClient()
      const up = await sb.storage.from('deliverables').upload(path, file, { upsert: false })
      if (up.error) { setErr(t('wbs.uploadFail') + ': ' + up.error.message); return }
      const res = await recordAttachment(itemId, {
        fileName: file.name, filePath: path, size: file.size, mime: file.type || 'application/octet-stream',
      })
      if (!res.ok) {
        await sb.storage.from('deliverables').remove([path]) // 메타 기록 실패 시 객체 정리
        setErr(res.error ?? t('wbs.attachRecordFail')); return
      }
      load(); router.refresh()
    } catch {
      setErr(t('wbs.uploadError'))
    } finally { setBusy(false) }
  }

  async function del(id: string) {
    setBusy(true); setErr(null)
    const res = await removeAttachment(id)
    setBusy(false)
    if (!res.ok) { setErr(res.error ?? t('wbs.deleteFail')); return }
    load(); router.refresh()
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle"><Paperclip className="h-3.5 w-3.5" /> {t('wbs.attachments')}</div>
        {canAttach && (
          <label className="btn btn-ghost h-7 cursor-pointer px-2.5 text-xs">
            <Upload className="h-3.5 w-3.5" /> {busy ? t('wbs.processing') : t('wbs.addFile')}
            <input type="file" className="hidden" onChange={onFile} disabled={busy} />
          </label>
        )}
      </div>
      {err && <p className="mb-2 text-xs font-medium text-delayed">{err}</p>}
      {list == null ? (
        <p className="text-sm text-ink-subtle">{t('common.loading')}</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-ink-subtle">{canAttach ? t('wbs.noAttachmentsAdd') : t('wbs.noAttachments')}</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map(a => (
            <li key={a.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-2.5 py-2">
              <FileText className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
              <a href={a.url ?? '#'} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[13px] text-brand hover:underline" title={a.fileName}>{a.fileName}</a>
              {a.size != null && <span className="shrink-0 text-[11px] tabular-nums text-ink-subtle">{fmtSize(a.size)}</span>}
              {canAttach && <button onClick={() => del(a.id)} disabled={busy} aria-label={t('wbs.deleteAttachmentAria')} className="shrink-0 text-ink-subtle transition hover:text-delayed"><Trash2 className="h-3.5 w-3.5" /></button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Field({ icon: Icon, label, children }: { icon: typeof Clock; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-muted"><Icon className="h-3.5 w-3.5" /></span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{label}</div>
        <div className="mt-0.5 text-sm text-ink">{children}</div>
      </div>
    </div>
  )
}
