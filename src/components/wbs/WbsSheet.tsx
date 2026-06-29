'use client'
import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { ComputedItem } from '@/lib/domain/types'
import { updateActual, updateWeight } from '@/app/actions/wbs'
import { StatusChip, LevelBadge, OwnerBadges, fmtDate } from './shared'

type Membership = { role: string; teamCode: string; teamId: string } | null

/* 컬럼 정의 — width 합으로 가로 스크롤 발생. 좌측 4컬럼은 sticky(고정). */
type Col = { key: string; w: number; sticky?: number }
const COLS: Col[] = [
  { key: 'no', w: 46, sticky: 0 },
  { key: 'level', w: 84, sticky: 46 },
  { key: 'biz', w: 56, sticky: 130 },
  { key: 'name', w: 300, sticky: 186 },
  { key: 'owners', w: 132 },
  { key: 'status', w: 84 },
  { key: 'deliverable', w: 210 },
  { key: 'pstart', w: 92 },
  { key: 'pend', w: 92 },
  { key: 'weight', w: 84 },
  { key: 'pplan', w: 70 },
  { key: 'pactual', w: 78 },
  { key: 'achieve', w: 74 },
]
const TOTAL_W = COLS.reduce((a, c) => a + c.w, 0)
const SK = (i: number) => COLS[i].sticky ?? 0

const CELL = 'box-border h-8 border-b border-r border-grid px-2 align-middle'
const HEAD =
  'box-border h-10 border-b-2 border-r border-grid-strong bg-sheet-head px-2 align-middle text-[11px] font-semibold uppercase tracking-wide text-ink-muted'

function stickyStyle(left: number): React.CSSProperties {
  return { position: 'sticky', left, zIndex: 5 }
}

export function WbsSheet({
  items,
  membership,
}: {
  items: ComputedItem[]
  membership: Membership
}) {
  const router = useRouter()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [edit, setEdit] = useState<{ id: string; field: 'weight' | 'actual' } | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const toggle = (id: string) =>
    setCollapsed(s => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const isPmo = membership?.role === 'pmo_admin'
  const canEditActual = useCallback(
    (n: ComputedItem) =>
      n.children.length === 0 &&
      (isPmo || (!!membership && n.owners.some(o => o.team === membership.teamCode))),
    [isPmo, membership],
  )

  const startEdit = (id: string, field: 'weight' | 'actual', current: string) => {
    setEdit({ id, field })
    setDraft(current)
  }
  const cancel = () => {
    setEdit(null)
    setDraft('')
  }
  const commit = async () => {
    if (!edit || busy) return
    const { id, field } = edit
    setBusy(true)
    try {
      let res: { ok: boolean; error?: string }
      if (field === 'actual') {
        const pct = Number(draft)
        if (draft.trim() === '' || Number.isNaN(pct)) return cancel()
        res = await updateActual(id, pct)
      } else {
        const w = draft.trim() === '' ? null : Number(draft)
        if (w != null && Number.isNaN(w)) return cancel()
        res = await updateWeight(id, w)
      }
      if (res.ok) {
        setToast({ kind: 'ok', msg: '저장되었습니다' })
        router.refresh()
      } else {
        setToast({ kind: 'err', msg: res.error ?? '저장 실패' })
      }
    } finally {
      setBusy(false)
      setEdit(null)
      setDraft('')
    }
  }

  const editInput = (current: string) => (
    <input
      autoFocus
      type="number"
      value={draft}
      disabled={busy}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') cancel()
      }}
      placeholder={current}
      className="h-6 w-full rounded border border-brand bg-surface px-1 text-right text-[13px] tabular-nums text-ink outline-none focus:ring-2 focus:ring-brand-ring"
    />
  )

  const ctr = { n: 0 }
  const render = (nodes: ComputedItem[], depth: number): React.ReactNode[] =>
    nodes.flatMap(n => {
      const hasChildren = n.children.length > 0
      const isCollapsed = collapsed.has(n.id)
      const rowNo = ++ctr.n

      const rowBg =
        n.level === 'phase'
          ? 'bg-sheet-head'
          : n.level === 'task'
            ? 'bg-surface-2'
            : rowNo % 2 === 0
              ? 'bg-zebra'
              : 'bg-surface'
      const nameWeight =
        n.level === 'phase'
          ? 'font-semibold text-ink'
          : n.level === 'task'
            ? 'font-medium text-ink'
            : 'text-ink'

      const editingWeight = edit?.id === n.id && edit.field === 'weight'
      const editingActual = edit?.id === n.id && edit.field === 'actual'
      const editableW = isPmo
      const editableA = canEditActual(n)
      const weightLabel = n.weight == null ? '균등' : String(n.weight)

      const row = (
        <tr key={n.id} className={`group ${rowBg} hover:bg-brand-weak/40`}>
          {/* # */}
          <td
            className={`${CELL} bg-sheet-gutter px-0 text-center text-[11px] tabular-nums text-ink-subtle`}
            style={stickyStyle(SK(0))}
          >
            {rowNo}
          </td>
          {/* 구분 */}
          <td
            className={`${CELL} ${rowBg} text-center`}
            style={stickyStyle(SK(1))}
          >
            <LevelBadge level={n.level} />
          </td>
          {/* Biz */}
          <td
            className={`${CELL} ${rowBg} text-center text-[12px] text-ink-muted`}
            style={stickyStyle(SK(2))}
          >
            {n.biz ?? '-'}
          </td>
          {/* 작업명 */}
          <td className={`${CELL} ${rowBg} border-r-grid-strong`} style={stickyStyle(SK(3))}>
            <div className="flex items-center" style={{ paddingLeft: depth * 14 }}>
              {hasChildren ? (
                <button
                  onClick={() => toggle(n.id)}
                  className="mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] text-ink-subtle hover:bg-line hover:text-ink"
                  aria-label={isCollapsed ? '펼치기' : '접기'}
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
              ) : (
                <span className="mr-1 w-4 shrink-0" />
              )}
              <span className={`truncate ${nameWeight}`} title={n.name}>
                {n.name}
              </span>
            </div>
          </td>
          {/* 담당 */}
          <td className={CELL}>
            <OwnerBadges owners={n.owners} />
          </td>
          {/* 상태 */}
          <td className={`${CELL} text-center`}>
            <StatusChip status={n.status} />
          </td>
          {/* 산출물 */}
          <td className={`${CELL} text-[12px] text-ink-muted`}>
            <span className="block truncate" title={n.deliverable ?? undefined}>
              {n.deliverable ?? '-'}
            </span>
          </td>
          {/* 계획시작 */}
          <td className={`${CELL} text-center text-[12px] tabular-nums text-ink-muted`}>
            {fmtDate(n.plannedStart)}
          </td>
          {/* 계획종료 */}
          <td className={`${CELL} text-center text-[12px] tabular-nums text-ink-muted`}>
            {fmtDate(n.plannedEnd)}
          </td>
          {/* 가중치 (PMO 인라인 편집) */}
          <td
            className={`${CELL} text-right tabular-nums ${
              editableW ? 'cursor-pointer hover:bg-brand-weak' : ''
            } ${n.weight == null ? 'text-ink-subtle' : 'text-ink'}`}
            onClick={() => editableW && !editingWeight && startEdit(n.id, 'weight', n.weight == null ? '' : String(n.weight))}
            title={editableW ? '클릭하여 가중치 편집 (비우면 균등)' : undefined}
          >
            {editingWeight ? editInput(weightLabel) : weightLabel}
          </td>
          {/* 계획% */}
          <td className={`${CELL} text-right tabular-nums text-ink-muted`}>{n.plannedPct}%</td>
          {/* 실적% (담당/PMO leaf 인라인 편집) */}
          <td
            className={`${CELL} text-right font-medium tabular-nums ${
              editableA ? 'cursor-pointer hover:bg-brand-weak' : ''
            } ${n.status === 'delayed' ? 'text-delayed' : 'text-ink'}`}
            onClick={() => editableA && !editingActual && startEdit(n.id, 'actual', String(n.rolledActualPct))}
            title={editableA ? '클릭하여 실적% 입력' : hasChildren ? '하위에서 자동 집계' : undefined}
          >
            {editingActual ? editInput(String(n.rolledActualPct)) : `${n.rolledActualPct}%`}
          </td>
          {/* 달성율 */}
          <td
            className={`${CELL} text-right tabular-nums ${
              n.achievement == null
                ? 'text-ink-subtle'
                : n.achievement >= 100
                  ? 'text-done'
                  : n.status === 'delayed'
                    ? 'text-delayed'
                    : 'text-ink'
            }`}
          >
            {n.achievement == null ? '-' : `${n.achievement}%`}
          </td>
        </tr>
      )
      return isCollapsed ? [row] : [row, ...render(n.children, depth + 1)]
    })

  return (
    <div className="relative">
      <div className="card overflow-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
        <table
          className="border-separate border-spacing-0 border-l border-t border-grid text-sm"
          style={{ width: TOTAL_W, tableLayout: 'fixed' }}
        >
          <colgroup>
            {COLS.map(c => (
              <col key={c.key} style={{ width: c.w }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr>
              <th className={`${HEAD} text-center`} style={{ ...stickyStyle(SK(0)), zIndex: 25 }}>
                #
              </th>
              <th className={`${HEAD} text-center`} style={{ ...stickyStyle(SK(1)), zIndex: 25 }}>
                구분
              </th>
              <th className={`${HEAD} text-center`} style={{ ...stickyStyle(SK(2)), zIndex: 25 }}>
                Biz
              </th>
              <th
                className={`${HEAD} border-r-grid-strong text-left`}
                style={{ ...stickyStyle(SK(3)), zIndex: 25 }}
              >
                작업명
              </th>
              <th className={`${HEAD} text-left`}>담당</th>
              <th className={`${HEAD} text-center`}>상태</th>
              <th className={`${HEAD} text-left`}>산출물</th>
              <th className={`${HEAD} text-center`}>계획시작</th>
              <th className={`${HEAD} text-center`}>계획종료</th>
              <th className={`${HEAD} text-right`}>가중치</th>
              <th className={`${HEAD} text-right`}>계획%</th>
              <th className={`${HEAD} text-right`}>실적%</th>
              <th className={`${HEAD} text-right`}>달성율</th>
            </tr>
          </thead>
          <tbody>{render(items, 0)}</tbody>
        </table>
      </div>

      {/* 범례 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-ink-subtle">
        <span>구분: PHASE / TASK / ACT</span>
        <span>담당 ● 주관 · △ 지원</span>
        <span className="text-ink-muted">
          {isPmo
            ? '가중치·실적% 셀을 클릭해 편집 (가중치 비우면 균등)'
            : '담당 작업의 실적% 셀을 클릭해 편집'}
        </span>
      </div>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${
            toast.kind === 'ok'
              ? 'bg-done text-white'
              : 'bg-delayed text-white'
          }`}
          role="status"
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
