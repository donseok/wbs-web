'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Download, Plus, Trash2, ArrowUp, ArrowDown, FileSpreadsheet, RefreshCw } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import {
  applyServerRow, CELL_FIELD, type WeeklyCellKey, type WeeklySheetRow,
} from '@/lib/domain/weeklySheet'
import {
  addWeeklyRow, createWeeklyReport, deleteWeeklyRow, moveWeeklyRow, saveWeeklyCell,
} from '@/app/actions/weekly'
import { shiftWeeks } from '@/lib/report/week'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'

type CellStatus = 'saving' | 'saved' | 'error'
const DEBOUNCE_MS = 1500

const COLS: { key: WeeklyCellKey; label: string }[] = [
  { key: 'this_content', label: '금주실적 내용' },
  { key: 'this_issue', label: '금주 이슈·이벤트' },
  { key: 'next_content', label: '차주계획 내용' },
  { key: 'next_issue', label: '차주 이슈·이벤트' },
]

/** DB 행 payload(snake) → WeeklySheetRow. Realtime payload 매핑용. */
function fromRecord(r: Record<string, unknown>): WeeklySheetRow {
  return {
    id: String(r.id), reportId: String(r.report_id), section: String(r.section ?? ''),
    module: String(r.module ?? ''), sortOrder: Number(r.sort_order ?? 0),
    thisContent: String(r.this_content ?? ''), thisIssue: String(r.this_issue ?? ''),
    nextContent: String(r.next_content ?? ''), nextIssue: String(r.next_issue ?? ''),
  }
}

export function WeeklySheetView({
  projectId, weekStart, weekLabel, report, initialRows, hasCarrySource,
}: {
  projectId: string
  weekStart: string
  weekLabel: string
  report: { id: string } | null
  initialRows: WeeklySheetRow[]
  hasCarrySource: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [rows, setRows] = useState<WeeklySheetRow[]>(initialRows)
  const [status, setStatus] = useState<Record<string, CellStatus>>({}) // key = `${rowId}:${cellKey}`
  const dirtyRef = useRef<Set<string>>(new Set())
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const retriedRef = useRef<Set<string>>(new Set())
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const [isPending, startTransition] = useTransition()

  // 서버 refetch(라우터 refresh) 반영 — dirty 셀은 로컬 유지(스펙 §5)
  useEffect(() => {
    setRows(local => initialRows.map(sv => {
      const lc = local.find(l => l.id === sv.id)
      return lc ? applyServerRow(lc, sv, dirtyRef.current) : sv
    }))
  }, [initialRows])

  // Realtime 구독 — 행 단위 이벤트를 셀 단위 병합
  useEffect(() => {
    if (!report) return
    const sb = createBrowserClient()
    const channel = sb
      .channel(`weekly-rows-${report.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'weekly_report_rows', filter: `report_id=eq.${report.id}` },
        payload => {
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string }).id
            if (oldId) setRows(rs => rs.filter(r => r.id !== oldId))
            return
          }
          const server = fromRecord(payload.new as Record<string, unknown>)
          setRows(rs => {
            const i = rs.findIndex(r => r.id === server.id)
            if (i < 0) return [...rs, server].sort((a, b) => a.sortOrder - b.sortOrder)
            const next = [...rs]
            next[i] = applyServerRow(rs[i], server, dirtyRef.current)
            return next.sort((a, b) => a.sortOrder - b.sortOrder)
          })
        })
      .subscribe(st => {
        if (st === 'SUBSCRIBED') router.refresh() // 재연결 누락분 보정(스펙 §5)
      })
    return () => { sb.removeChannel(channel) }
  }, [report, router])

  const commit = useCallback((rowId: string, key: WeeklyCellKey) => {
    const k = `${rowId}:${key}`
    const timer = timersRef.current.get(k)
    if (timer) { clearTimeout(timer); timersRef.current.delete(k) }
    const row = rowsRef.current.find(r => r.id === rowId)
    if (!row || !dirtyRef.current.has(k)) return
    const sent = row[CELL_FIELD[key]]
    setStatus(s => ({ ...s, [k]: 'saving' }))
    saveWeeklyCell(projectId, rowId, key, sent).then(res => {
      const now = rowsRef.current.find(r => r.id === rowId)?.[CELL_FIELD[key]]
      if (!res.ok) {
        setStatus(s => ({ ...s, [k]: 'error' }))
        if (!retriedRef.current.has(k)) { retriedRef.current.add(k); setTimeout(() => commit(rowId, key), 2000) } // 자동 재시도 1회
        else toast({ title: '저장 실패', description: res.error, variant: 'error' })
        return
      }
      retriedRef.current.delete(k)
      if (now === sent) { dirtyRef.current.delete(k); setStatus(s => ({ ...s, [k]: 'saved' })) }
      else commit(rowId, key) // 전송 중 재수정 — dirty 유지한 채 재저장
    })
  }, [projectId, toast])

  const onCellChange = (rowId: string, key: WeeklyCellKey, value: string) => {
    const k = `${rowId}:${key}`
    dirtyRef.current.add(k)
    setRows(rs => rs.map(r => (r.id === rowId ? { ...r, [CELL_FIELD[key]]: value } : r)))
    const prev = timersRef.current.get(k)
    if (prev) clearTimeout(prev)
    timersRef.current.set(k, setTimeout(() => commit(rowId, key), DEBOUNCE_MS))
  }

  const runAction = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) toast({ title: '실패', description: res.error, variant: 'error' })
      router.refresh()
    })

  // section 시각 병합: 연속 같은 section의 첫 행에만 rowSpan.
  // 훅 규칙: 아래 EmptyState 조기 return보다 반드시 먼저 호출(렌더마다 훅 순서 고정).
  const spans = useMemo(() => rows.map((r, i) => {
    if (i > 0 && rows[i - 1].section === r.section) return 0
    let n = 1
    while (i + n < rows.length && rows[i + n].section === r.section) n += 1
    return n
  }), [rows])

  // ── 문서 없음: EmptyState + 시작 버튼 2종(스펙 §3 — 자동 생성 금지) ──
  if (!report) {
    return (
      <div className="space-y-4">
        <WeekNav projectId={projectId} weekStart={weekStart} weekLabel={weekLabel} exportDisabled />
        <EmptyState
          icon={FileSpreadsheet}
          title={`${weekLabel} 시트가 없습니다`}
          description="이전 주차에서 이월하거나 빈 시트로 시작하세요. 이월하면 이전 주의 차주계획이 이번 주 금주실적 초안으로 들어옵니다."
          action={
            <div className="flex gap-2">
              {hasCarrySource && (
                <button className="btn btn-primary" disabled={isPending}
                  onClick={() => runAction(() => createWeeklyReport(projectId, weekStart, true))}>
                  이전 주차에서 이월해 시작
                </button>
              )}
              <button className="btn btn-ghost" disabled={isPending}
                onClick={() => runAction(() => createWeeklyReport(projectId, weekStart, false))}>
                빈 시트로 시작
              </button>
            </div>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <WeekNav projectId={projectId} weekStart={weekStart} weekLabel={weekLabel} exportDisabled={false} />
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left">
              <th className="w-20 px-3 py-2 font-semibold text-ink">구분</th>
              <th className="w-28 px-3 py-2 font-semibold text-ink">모듈</th>
              {COLS.map(c => <th key={c.key} className="px-3 py-2 font-semibold text-ink">{c.label}</th>)}
              <th className="w-24 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-b border-line align-top">
                {spans[i] > 0 && (
                  <td rowSpan={spans[i]} className="border-r border-line px-3 py-2 text-center font-semibold text-ink">
                    {r.section}
                  </td>
                )}
                <td className="border-r border-line px-3 py-2 text-center font-medium text-ink">{r.module}</td>
                {COLS.map(c => (
                  <td key={c.key} className="border-r border-line p-1">
                    <CellEditor
                      value={r[CELL_FIELD[c.key]]}
                      status={status[`${r.id}:${c.key}`]}
                      onChange={v => onCellChange(r.id, c.key, v)}
                      onBlur={() => commit(r.id, c.key)}
                      onRetry={() => commit(r.id, c.key)}
                    />
                  </td>
                ))}
                <td className="px-2 py-2">
                  <div className="flex gap-1 text-ink-subtle">
                    <button title="위로" className="hover:text-ink" onClick={() => runAction(() => moveWeeklyRow(projectId, r.id, 'up'))}><ArrowUp className="h-4 w-4" /></button>
                    <button title="아래로" className="hover:text-ink" onClick={() => runAction(() => moveWeeklyRow(projectId, r.id, 'down'))}><ArrowDown className="h-4 w-4" /></button>
                    <button title="행 삭제" className="hover:text-delayed"
                      onClick={() => { if (confirm(`'${r.module}' 행을 삭제할까요? 셀 내용도 함께 지워집니다.`)) runAction(() => deleteWeeklyRow(projectId, r.id)) }}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <AddRowForm disabled={isPending} onAdd={(section, module) => runAction(() => addWeeklyRow(projectId, report.id, section, module))} />
      </div>
    </div>
  )
}

function WeekNav({ projectId, weekStart, weekLabel, exportDisabled }: {
  projectId: string; weekStart: string; weekLabel: string; exportDisabled: boolean
}) {
  const base = `/p/${projectId}/weekly`
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Link href={`${base}?week=${shiftWeeks(weekStart, -1)}`} className="btn btn-ghost px-2" aria-label="이전 주">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <span className="min-w-40 text-center text-sm font-semibold text-ink">{weekLabel}</span>
        <Link href={`${base}?week=${shiftWeeks(weekStart, 1)}`} className="btn btn-ghost px-2" aria-label="다음 주">
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      <ExportPptButton projectId={projectId} weekStart={weekStart} disabled={exportDisabled} />
    </div>
  )
}

/** PPT 내보내기 — fetch로 받아 400(빈 시트 등)을 Toast로 안내(스펙 §7). 성공 시 blob 다운로드. */
function ExportPptButton({ projectId, weekStart, disabled }: {
  projectId: string; weekStart: string; disabled: boolean
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const onExport = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/report?projectId=${projectId}&format=pptx&source=sheet&week=${weekStart}`)
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null
        toast({ title: 'PPT 내보내기 실패', description: err?.error ?? `오류 (${res.status})`, variant: 'error' })
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const name = decodeURIComponent(cd.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? `weekly_${weekStart}.pptx`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button className="btn btn-primary" disabled={disabled || busy} onClick={onExport}>
      <Download className="mr-1 h-4 w-4" />PPT 내보내기
    </button>
  )
}

function CellEditor({ value, status, onChange, onBlur, onRetry }: {
  value: string; status?: CellStatus
  onChange: (v: string) => void; onBlur: () => void; onRetry: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { // 자동 높이
    const el = ref.current
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }
  }, [value])
  return (
    <div className="relative">
      <textarea
        ref={ref} value={value} rows={3}
        className="app-textarea min-h-20 w-full resize-none border-0 bg-transparent text-sm leading-5"
        onChange={e => onChange(e.target.value)} onBlur={onBlur}
      />
      <span className="absolute right-1 top-1 text-[10px]">
        {status === 'saving' && <span className="text-ink-subtle">저장 중…</span>}
        {status === 'saved' && <span className="text-done">저장됨</span>}
        {status === 'error' && (
          <button className="flex items-center gap-0.5 text-delayed" onClick={onRetry} title="다시 저장">
            <RefreshCw className="h-3 w-3" />재시도
          </button>
        )}
      </span>
    </div>
  )
}

function AddRowForm({ disabled, onAdd }: { disabled: boolean; onAdd: (section: string, module: string) => void }) {
  const [section, setSection] = useState('')
  const [module, setModule] = useState('')
  return (
    <div className="flex items-center gap-2 border-t border-line px-3 py-2">
      <Plus className="h-4 w-4 text-ink-subtle" />
      <input className="app-input h-8 w-28 text-sm" placeholder="구분 (ERP)" value={section} onChange={e => setSection(e.target.value)} />
      <input className="app-input h-8 w-36 text-sm" placeholder="모듈 (SD/LE)" value={module} onChange={e => setModule(e.target.value)} />
      <button className="btn btn-ghost h-8 text-sm" disabled={disabled || !module.trim()}
        onClick={() => { onAdd(section, module); setSection(''); setModule('') }}>
        모듈 추가
      </button>
    </div>
  )
}
