'use client'
import { useEffect, useState } from 'react'
import { X, Clock, FileText, CalendarRange, Scale, History, User } from 'lucide-react'
import type { ComputedItem, TeamCode } from '@/lib/domain/types'
import { getChangeLogs, type ChangeLogEntry } from '@/app/actions/wbs'
import { StatusChip, LevelBadge, OwnerBadges, fmtDate } from './shared'

const ROLE_LABEL: Record<string, string> = { pmo_admin: 'PMO 관리자', team_editor: '팀 편집자' }
const FIELD_LABEL: Record<string, string> = { actual_pct: '실적%', weight: '가중치' }

function fmtValue(field: string, v: string | null): string {
  if (v == null || v === '') return field === 'weight' ? '균등' : '—'
  return field === 'actual_pct' ? `${v}%` : v
}

function fmtAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function actorLabel(team: TeamCode | null, role: string | null): string {
  const r = role ? ROLE_LABEL[role] ?? role : null
  if (team && r) return `${team} · ${r}`
  return r ?? team ?? '알 수 없음'
}

/** WBS 행 클릭 시 우측 상세 패널 — 개요/담당/일정/진척/산출물 + 변경 이력 타임라인. */
export function RowDetailPanel({ item, onClose }: { item: ComputedItem; onClose: () => void }) {
  const [logs, setLogs] = useState<ChangeLogEntry[] | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let alive = true
    setLogs(null)
    getChangeLogs(item.id).then(r => { if (alive) setLogs(r) }).catch(() => { if (alive) setLogs([]) })
    return () => { alive = false }
  }, [item.id])

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={`${item.name} 상세`}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-surface shadow-[var(--shadow-xl)] animate-[slidein_.18s_ease-out]">
        {/* 헤더 */}
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <LevelBadge level={item.level} />
              {item.code && <span className="text-[11px] font-semibold tabular-nums text-ink-subtle">{item.code}</span>}
            </div>
            <h2 className="mt-1.5 break-words text-[16px] font-bold leading-snug text-ink">{item.name}</h2>
          </div>
          <button onClick={onClose} aria-label="닫기" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-surface-2 hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* 진척 */}
          <section className="grid grid-cols-3 gap-2">
            <Stat label="계획%" value={`${item.plannedPct}%`} />
            <Stat label="실적%" value={`${item.rolledActualPct}%`} />
            <Stat label="달성율" value={item.achievement == null ? '—' : `${item.achievement}%`} />
          </section>
          <div className="flex items-center gap-2"><span className="text-xs text-ink-subtle">상태</span><StatusChip status={item.status} /></div>

          {/* 담당 */}
          <Field icon={User} label="담당">
            {item.owners.length ? <OwnerBadges owners={item.owners} /> : <span className="text-ink-subtle">미배정</span>}
          </Field>

          {/* 일정 */}
          <Field icon={CalendarRange} label="계획 일정">
            <span className="tabular-nums">{fmtDate(item.plannedStart)} ~ {fmtDate(item.plannedEnd)}</span>
          </Field>

          {/* 가중치 */}
          <Field icon={Scale} label="가중치">
            <span className="tabular-nums">{item.weight == null ? '균등(형제 1/n)' : item.weight}</span>
          </Field>

          {/* 산출물 */}
          <Field icon={FileText} label="산출물">
            {item.deliverable ? <span>{item.deliverable}</span> : <span className="text-ink-subtle">없음</span>}
          </Field>

          {item.biz && (
            <Field icon={FileText} label="Biz">
              <span>{item.biz}</span>
            </Field>
          )}

          {/* 변경 이력 */}
          <section>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              <History className="h-3.5 w-3.5" /> 변경 이력
            </div>
            {logs == null ? (
              <p className="text-sm text-ink-subtle">불러오는 중…</p>
            ) : logs.length === 0 ? (
              <p className="text-sm text-ink-subtle">아직 변경 기록이 없습니다. 실적%·가중치를 수정하면 여기에 남습니다.</p>
            ) : (
              <ol className="space-y-2.5">
                {logs.map(log => (
                  <li key={log.id} className="rounded-xl border border-line bg-surface-2/60 p-3">
                    <div className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="font-semibold text-ink">{FIELD_LABEL[log.field] ?? log.field}</span>
                      <span className="inline-flex items-center gap-1 tabular-nums text-ink-subtle"><Clock className="h-3 w-3" />{fmtAt(log.at)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[13px] tabular-nums">
                      <span className="text-ink-muted line-through decoration-ink-subtle/50">{fmtValue(log.field, log.oldValue)}</span>
                      <span className="text-ink-subtle">→</span>
                      <span className="font-semibold text-ink">{fmtValue(log.field, log.newValue)}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-ink-subtle">{actorLabel(log.actorTeam, log.actorRole)}</div>
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
