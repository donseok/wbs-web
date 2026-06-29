'use client'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { ComputedItem, Membership } from '@/lib/domain/types'
import { updateActual, updateWeight } from '@/app/actions/wbs'
import { StatusChip, LevelBadge, OwnerBadges, STATUS, TEAM, fmtDate } from './shared'

/* ── 컬럼 메타 (좌→우). frozen=true면 sticky 동결, sk=누적 left offset ── */
type Col = { key: string; w: number; frozen?: boolean; sk?: number }
const COLS: Col[] = [
  { key: 'no', w: 44, frozen: true, sk: 0 },
  { key: 'level', w: 60, frozen: true, sk: 44 },
  { key: 'name', w: 300, frozen: true, sk: 104 },
  { key: 'biz', w: 64 },
  { key: 'owners', w: 128 },
  { key: 'status', w: 76 },
  { key: 'deliverable', w: 150 },
  { key: 'pstart', w: 80 },
  { key: 'pend', w: 80 },
  { key: 'weight', w: 64 },
  { key: 'pplan', w: 60 },
  { key: 'pactual', w: 72 },
  { key: 'achieve', w: 76 },
]
const LEFT_W = COLS.reduce((a, c) => a + c.w, 0) // 1254
const W = (k: string) => COLS.find(c => c.key === k)!.w

function iso(d: Date) {
  return d.toISOString().slice(0, 10)
}
function flatten(items: ComputedItem[], collapsed: Set<string>): ComputedItem[] {
  const out: ComputedItem[] = []
  const walk = (ns: ComputedItem[]) =>
    ns.forEach(n => {
      out.push(n)
      if (!collapsed.has(n.id)) walk(n.children)
    })
  walk(items)
  return out
}
/* 검색: 매칭 노드 + 조상 id 집합 */
function buildMatch(items: ComputedItem[], q: string): Set<string> {
  const keep = new Set<string>()
  const walk = (n: ComputedItem, anc: string[]): boolean => {
    const self = n.name.toLowerCase().includes(q)
    let child = false
    n.children.forEach(c => {
      if (walk(c, [...anc, n.id])) child = true
    })
    if (self || child) {
      keep.add(n.id)
      anc.forEach(a => keep.add(a))
      return true
    }
    return false
  }
  items.forEach(n => walk(n, []))
  return keep
}

export function WbsGanttSheet({
  items,
  holidays,
  today,
  membership,
}: {
  items: ComputedItem[]
  holidays: string[]
  today: string
  membership: Membership | null
}) {
  const router = useRouter()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [dayPx, setDayPx] = useState(24)
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

  /* ── 계층 평탄화 + 깊이 + 검색 ── */
  const depthMap = useMemo(() => {
    const m = new Map<string, number>()
    const walk = (ns: ComputedItem[], d: number) =>
      ns.forEach(n => {
        m.set(n.id, d)
        walk(n.children, d + 1)
      })
    walk(items, 0)
    return m
  }, [items])

  const collapsibleIds = useMemo(() => {
    const s = new Set<string>()
    const walk = (ns: ComputedItem[]) =>
      ns.forEach(n => {
        if (n.children.length) {
          s.add(n.id)
          walk(n.children)
        }
      })
    walk(items)
    return s
  }, [items])

  const q = query.trim().toLowerCase()
  const matchKeep = useMemo(() => (q ? buildMatch(items, q) : null), [items, q])
  const flatRows = useMemo(
    () =>
      matchKeep ? flatten(items, new Set()).filter(n => matchKeep.has(n.id)) : flatten(items, collapsed),
    [items, collapsed, matchKeep],
  )

  const allCollapsed = collapsibleIds.size > 0 && [...collapsibleIds].every(id => collapsed.has(id))
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(collapsibleIds))

  /* ── 날짜 스케일 ── */
  const allDates = items.flatMap(function dates(n): string[] {
    return [n.plannedStart, n.plannedEnd, ...n.children.flatMap(dates)].filter(Boolean) as string[]
  })
  const rangeStart = allDates.length ? allDates.reduce((a, b) => (a < b ? a : b)) : today
  const rangeEnd = allDates.length ? allDates.reduce((a, b) => (a > b ? a : b)) : today
  const start = new Date(rangeStart + 'T00:00:00Z')
  const end = new Date(rangeEnd + 'T00:00:00Z')
  const days: string[] = []
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(iso(d))
  const holSet = new Set(holidays)
  const xOf = (date: string) =>
    ((new Date(date + 'T00:00:00Z').getTime() - start.getTime()) / 86400000) * dayPx
  const isWeekend = (d: string) => {
    const dow = new Date(d + 'T00:00:00Z').getUTCDay()
    return dow === 0 || dow === 6
  }
  const ganttW = days.length * dayPx

  const months: { ym: string; label: string; left: number; width: number }[] = []
  days.forEach((d, i) => {
    const ym = d.slice(0, 7)
    const last = months[months.length - 1]
    if (last && last.ym === ym) {
      last.width += dayPx
    } else {
      months.push({ ym, label: `${Number(d.slice(5, 7))}월`, left: i * dayPx, width: dayPx })
    }
  })
  const weeks: { label: string; sub: string; left: number; width: number }[] = []
  for (let i = 0; i < days.length; i += 7) {
    const w = Math.min(7, days.length - i)
    const dd = days[i]
    weeks.push({
      label: 'W' + String(weeks.length + 1).padStart(2, '0'),
      sub: `${Number(dd.slice(5, 7))}/${Number(dd.slice(8, 10))}`,
      left: i * dayPx,
      width: w * dayPx,
    })
  }
  const todayX = days.length && today >= rangeStart && today <= rangeEnd ? xOf(today) + dayPx / 2 : null
  const rowsH = flatRows.length * 36

  /* ── 편집 (WbsSheet 이식) ── */
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
        if (draft.trim() === '') {
          setToast({ kind: 'err', msg: '빈 값은 입력할 수 없습니다' })
          return cancel()
        }
        const pct = Number(draft)
        if (Number.isNaN(pct)) {
          setToast({ kind: 'err', msg: '숫자만 입력하세요' })
          return cancel()
        }
        if (pct < 0 || pct > 100) {
          setToast({ kind: 'err', msg: '0~100 범위로 입력하세요' })
          return cancel()
        }
        res = await updateActual(id, pct)
      } else {
        const wv = draft.trim() === '' ? null : Number(draft)
        if (wv != null && (Number.isNaN(wv) || wv < 0)) {
          setToast({ kind: 'err', msg: '가중치는 0 이상이어야 합니다' })
          return cancel()
        }
        res = await updateWeight(id, wv)
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
  const editInput = (current: string, field: 'weight' | 'actual') => (
    <input
      autoFocus
      type="number"
      value={draft}
      disabled={busy}
      aria-label={field === 'weight' ? '가중치 편집' : '실적% 편집'}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') cancel()
      }}
      placeholder={current}
      className="h-6 w-full rounded border border-brand bg-surface px-1 text-right text-[12px] tabular-nums text-ink outline-none focus:ring-2 focus:ring-brand-ring"
    />
  )

  /* ── 셀 helpers ── */
  const headBase =
    'box-border flex h-[var(--wbs-head-h)] shrink-0 items-center bg-sheet-head px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted border-b-2 border-grid-strong'
  const cellBase = 'box-border flex h-full shrink-0 items-center border-b border-grid px-2'

  const headCell = (col: Col, label: string, align = 'justify-start', extra = '') => {
    const frozen = col.frozen
    const isName = col.key === 'name'
    return (
      <div
        key={col.key}
        className={`${headBase} ${align} ${isName ? 'freeze-edge' : 'border-r border-grid-strong'} ${extra}`}
        style={{ width: col.w, ...(frozen ? { position: 'sticky', left: col.sk, zIndex: 50 } : {}) }}
      >
        {label}
      </div>
    )
  }

  return (
    <div
      className="relative"
      style={
        {
          '--wbs-row-h': '36px',
          '--wbs-head-h': '54px',
          '--wbs-left-w': `${LEFT_W}px`,
          '--gantt-day': `${dayPx}px`,
        } as React.CSSProperties
      }
    >
      {/* ── 툴바 ── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="mr-1 text-sm font-semibold text-ink">WBS · 간트 통합</div>
        <span className="rounded-md bg-surface-2 px-2 py-1 text-[11px] tabular-nums text-ink-muted">
          {fmtDate(rangeStart)} – {fmtDate(rangeEnd)} · {flatRows.length}행
        </span>
        <div className="relative">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="작업명 검색…"
            aria-label="작업명 검색"
            className="app-input h-8 w-44 pl-7 text-[13px]"
          />
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-ink-subtle">
            ⌕
          </span>
        </div>
        <button onClick={toggleAll} className="btn btn-ghost h-8 px-3 text-[13px]">
          {allCollapsed ? '전체 펼치기' : '전체 접기'}
        </button>
        <div className="seg ml-auto h-8 gap-0.5 p-0.5">
          <button
            onClick={() => setDayPx(16)}
            className={`seg-item px-2.5 py-1 text-[12px] ${dayPx === 16 ? 'seg-item-active' : ''}`}
          >
            주
          </button>
          <button
            onClick={() => setDayPx(24)}
            className={`seg-item px-2.5 py-1 text-[12px] ${dayPx === 24 ? 'seg-item-active' : ''}`}
          >
            일
          </button>
        </div>
      </div>

      {/* ── 단일 스크롤 컨테이너 ── */}
      <div className="card overflow-auto" style={{ maxHeight: 'calc(100vh - 340px)' }}>
        <div className="relative" style={{ width: LEFT_W + ganttW }}>
          {/* 배경 격자 + 주말/공휴일 (행 뒤) */}
          <div
            className="pointer-events-none absolute z-0"
            style={{ left: LEFT_W, top: 'var(--wbs-head-h)', width: ganttW, height: rowsH }}
          >
            {days.map((d, i) => {
              const hol = holSet.has(d)
              const off = hol || isWeekend(d)
              return (
                <div
                  key={d}
                  className="absolute top-0 box-border border-r border-grid"
                  style={{
                    left: i * dayPx,
                    width: dayPx,
                    height: rowsH,
                    background: hol
                      ? 'var(--color-holiday-band)'
                      : off
                        ? 'var(--color-weekend)'
                        : undefined,
                  }}
                />
              )
            })}
          </div>

          {/* 헤더 행 (sticky top) */}
          <div className="sticky top-0 z-40 flex w-max">
            {headCell(COLS[0], '#', 'justify-center')}
            {headCell(COLS[1], '구분', 'justify-center')}
            {headCell(COLS[2], '작업명', 'justify-start')}
            {headCell(COLS[3], 'BIZ', 'justify-center')}
            {headCell(COLS[4], '담당', 'justify-start')}
            {headCell(COLS[5], '상태', 'justify-center')}
            {headCell(COLS[6], '산출물', 'justify-start')}
            {headCell(COLS[7], '계획시작', 'justify-center')}
            {headCell(COLS[8], '계획종료', 'justify-center')}
            {headCell(COLS[9], '가중치', 'justify-end')}
            {headCell(COLS[10], '계획%', 'justify-end')}
            {headCell(COLS[11], '실적%', 'justify-end')}
            {headCell(COLS[12], '달성율', 'justify-center')}
            {/* 간트 헤더 (월/주/일 3단) */}
            <div
              className="relative box-border h-[var(--wbs-head-h)] shrink-0 border-b-2 border-grid-strong bg-sheet-head"
              style={{ width: ganttW }}
            >
              {months.map(m => (
                <div
                  key={m.left}
                  className="absolute top-0 box-border flex h-[18px] items-center border-r border-grid px-1.5 text-[10px] font-semibold text-ink-muted"
                  style={{ left: m.left, width: m.width }}
                >
                  {m.label}
                </div>
              ))}
              {weeks.map(w => (
                <div
                  key={w.left}
                  className="absolute box-border flex h-[18px] items-center gap-1 border-r border-grid px-1.5 text-[9.5px] font-medium text-ink-subtle"
                  style={{ top: 18, left: w.left, width: w.width }}
                >
                  <span className="font-semibold text-ink-muted">{w.label}</span>
                  <span>{w.sub}</span>
                </div>
              ))}
              {/* 일자 숫자 행 — '주' 줌(16px)에서는 폭이 좁아 숫자가 넘쳐 깨지므로 숨김 */}
              {dayPx >= 24 &&
                days.map((d, i) => (
                  <div
                    key={d}
                    className={`absolute box-border border-r border-grid text-center text-[9px] leading-[18px] ${
                      holSet.has(d) || isWeekend(d) ? 'text-delayed/70' : 'text-ink-subtle'
                    }`}
                    style={{
                      top: 36,
                      left: i * dayPx,
                      width: dayPx,
                      height: 18,
                      background: holSet.has(d)
                        ? 'var(--color-holiday-band)'
                        : isWeekend(d)
                          ? 'var(--color-weekend)'
                          : undefined,
                    }}
                  >
                    {new Date(d + 'T00:00:00Z').getUTCDate()}
                  </div>
                ))}
            </div>
          </div>

          {/* 본문 행 */}
          {flatRows.map((n, idx) => {
            const depth = depthMap.get(n.id) ?? 0
            const hasChildren = n.children.length > 0
            const isCollapsed = collapsed.has(n.id)
            const rowNo = idx + 1
            const rowBg =
              n.level === 'phase'
                ? 'bg-sheet-head'
                : n.level === 'task'
                  ? 'bg-surface-2'
                  : rowNo % 2 === 0
                    ? 'bg-zebra'
                    : 'bg-surface'
            const cellBg = `${rowBg} group-hover:bg-brand-weak`
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

            const frozen = (key: string, z = 20): React.CSSProperties => {
              const c = COLS.find(x => x.key === key)!
              return { width: c.w, position: 'sticky', left: c.sk, zIndex: z }
            }

            return (
              <div
                key={n.id}
                className="group relative z-10 box-border flex h-[var(--wbs-row-h)] w-max"
              >
                {/* # */}
                <div
                  className={`${cellBase} border-r border-grid-strong justify-center text-[11px] tabular-nums text-ink-subtle ${cellBg}`}
                  style={frozen('no')}
                >
                  {rowNo}
                </div>
                {/* 구분 */}
                <div
                  className={`${cellBase} border-r border-grid-strong justify-center ${cellBg}`}
                  style={frozen('level')}
                >
                  <LevelBadge level={n.level} />
                </div>
                {/* 작업명 */}
                <div className={`${cellBase} freeze-edge ${cellBg}`} style={frozen('name')}>
                  <div className="flex min-w-0 items-center" style={{ paddingLeft: depth * 14 }}>
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
                </div>
                {/* BIZ */}
                <div
                  className={`${cellBase} border-r border-grid justify-center text-[12px] text-ink-muted ${cellBg}`}
                  style={{ width: W('biz') }}
                >
                  {n.biz ?? '-'}
                </div>
                {/* 담당 */}
                <div
                  className={`${cellBase} border-r border-grid ${cellBg}`}
                  style={{ width: W('owners') }}
                >
                  <OwnerBadges owners={n.owners} />
                </div>
                {/* 상태 */}
                <div
                  className={`${cellBase} border-r border-grid justify-center ${cellBg}`}
                  style={{ width: W('status') }}
                >
                  <StatusChip status={n.status} />
                </div>
                {/* 산출물 */}
                <div
                  className={`${cellBase} border-r border-grid text-[12px] text-ink-muted ${cellBg}`}
                  style={{ width: W('deliverable') }}
                >
                  <span className="block truncate" title={n.deliverable ?? undefined}>
                    {n.deliverable ?? '-'}
                  </span>
                </div>
                {/* 계획시작 */}
                <div
                  className={`${cellBase} border-r border-grid justify-center text-[12px] tabular-nums text-ink-muted ${cellBg}`}
                  style={{ width: W('pstart') }}
                >
                  {fmtDate(n.plannedStart)}
                </div>
                {/* 계획종료 */}
                <div
                  className={`${cellBase} border-r border-grid justify-center text-[12px] tabular-nums text-ink-muted ${cellBg}`}
                  style={{ width: W('pend') }}
                >
                  {fmtDate(n.plannedEnd)}
                </div>
                {/* 가중치 */}
                <div
                  className={`${cellBase} border-r border-grid justify-end tabular-nums ${
                    editableW ? 'cursor-pointer' : ''
                  } ${n.weight == null ? 'text-ink-subtle' : 'text-ink'} ${cellBg}`}
                  style={{ width: W('weight') }}
                  onClick={() =>
                    editableW &&
                    !editingWeight &&
                    startEdit(n.id, 'weight', n.weight == null ? '' : String(n.weight))
                  }
                  role={editableW ? 'button' : undefined}
                  tabIndex={editableW ? 0 : undefined}
                  onKeyDown={
                    editableW
                      ? e => {
                          if ((e.key === 'Enter' || e.key === ' ') && !editingWeight) {
                            e.preventDefault()
                            startEdit(n.id, 'weight', n.weight == null ? '' : String(n.weight))
                          }
                        }
                      : undefined
                  }
                  title={editableW ? '클릭하여 가중치 편집 (비우면 균등)' : undefined}
                >
                  {editingWeight ? editInput(weightLabel, 'weight') : weightLabel}
                </div>
                {/* 계획% */}
                <div
                  className={`${cellBase} border-r border-grid justify-end tabular-nums text-ink-muted ${cellBg}`}
                  style={{ width: W('pplan') }}
                >
                  {n.plannedPct}%
                </div>
                {/* 실적% (데이터바) */}
                <div
                  className={`${cellBase} relative justify-end overflow-hidden border-r border-grid font-medium tabular-nums ${
                    editableA ? 'cursor-pointer' : ''
                  } ${n.status === 'delayed' ? 'text-delayed' : 'text-ink'} ${cellBg}`}
                  style={{ width: W('pactual') }}
                  onClick={() =>
                    editableA && !editingActual && startEdit(n.id, 'actual', String(n.rolledActualPct))
                  }
                  role={editableA ? 'button' : undefined}
                  tabIndex={editableA ? 0 : undefined}
                  onKeyDown={
                    editableA
                      ? e => {
                          if ((e.key === 'Enter' || e.key === ' ') && !editingActual) {
                            e.preventDefault()
                            startEdit(n.id, 'actual', String(n.rolledActualPct))
                          }
                        }
                      : undefined
                  }
                  title={
                    editableA ? '클릭하여 실적% 입력' : hasChildren ? '하위에서 자동 집계' : undefined
                  }
                >
                  {!editingActual && (
                    <span
                      className={`pointer-events-none absolute inset-y-0 left-0 z-0 ${STATUS[n.status].bar} opacity-[0.16]`}
                      style={{ width: `${n.rolledActualPct}%` }}
                    />
                  )}
                  <span className="relative z-10">
                    {editingActual ? editInput(String(n.rolledActualPct), 'actual') : `${n.rolledActualPct}%`}
                  </span>
                </div>
                {/* 달성율 (미니바) */}
                <div
                  className={`${cellBase} flex-col items-end justify-center gap-0.5 border-r border-grid tabular-nums ${cellBg}`}
                  style={{ width: W('achieve') }}
                >
                  <span
                    className={`text-[12px] leading-none ${
                      n.achievement == null
                        ? 'text-ink-subtle'
                        : n.achievement >= 100
                          ? 'text-done'
                          : n.achievement >= 80
                            ? 'text-progress'
                            : 'text-delayed'
                    }`}
                  >
                    {n.achievement == null ? '—' : `${n.achievement}%`}
                  </span>
                  {n.achievement != null && (
                    <span className="h-1 w-full overflow-hidden rounded-full bg-line">
                      <span
                        className={`block h-full rounded-full ${STATUS[n.status].bar}`}
                        style={{ width: `${Math.min(100, n.achievement)}%` }}
                      />
                    </span>
                  )}
                </div>
                {/* 간트 셀 */}
                <div className="relative box-border h-full shrink-0 border-b border-grid" style={{ width: ganttW }}>
                  {n.plannedStart && n.plannedEnd && <Bar n={n} xOf={xOf} dayPx={dayPx} />}
                </div>
              </div>
            )
          })}

          {/* 빈 상태 — 항목 없음 / 검색 결과 없음 (가로 스크롤에도 좌측 고정) */}
          {flatRows.length === 0 && (
            <div
              className="sticky left-0 z-10 flex flex-col items-center justify-center gap-1.5 py-20 text-center"
              style={{ width: 'min(560px, 100vw)' }}
              role="status"
            >
              <span className="text-2xl opacity-60" aria-hidden>
                {items.length === 0 ? '🗂' : '⌕'}
              </span>
              <span className="text-sm font-medium text-ink-muted">
                {items.length === 0 ? '작업 항목이 없습니다' : `‘${query.trim()}’에 대한 결과가 없습니다`}
              </span>
              <span className="text-[12px] text-ink-subtle">
                {items.length === 0 ? 'WBS 엑셀을 업로드하면 작업이 표시됩니다.' : '검색어를 바꾸거나 지워보세요.'}
              </span>
            </div>
          )}

          {/* 오늘 세로선 (행 위) */}
          {todayX != null && (
            <div
              className="pointer-events-none absolute z-30"
              style={{ left: LEFT_W, top: 'var(--wbs-head-h)', width: ganttW, height: rowsH }}
            >
              <div className="absolute top-0 w-0.5 -translate-x-1/2 bg-today" style={{ left: todayX, height: rowsH }} />
              <div
                className="absolute -translate-x-1/2 rounded-sm bg-today px-1 py-0.5 text-[8px] font-bold leading-none text-white"
                style={{ left: todayX, top: 0 }}
              >
                오늘
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 범례 ── */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] text-ink-subtle">
        <span className="inline-flex items-center gap-2">
          {(['done', 'in_progress', 'delayed', 'not_started'] as const).map(s => (
            <span key={s} className="inline-flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${STATUS[s].dot}`} />
              {STATUS[s].label}
            </span>
          ))}
        </span>
        <span className="inline-flex items-center gap-2">
          {(['PMO', 'DT', 'ERP', 'MES'] as const).map(t => (
            <span key={t} className="inline-flex items-center gap-0.5">
              <span className={`${TEAM[t].fg} text-[9px]`}>●</span>
              {t}
            </span>
          ))}
          <span>· ● 주관 △ 지원</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-4 rounded-full bg-plan-track ring-1 ring-grid" />
          계획
          <span className="ml-1 h-2 w-4 rounded-full bg-progress" />
          실적
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded-sm" style={{ background: 'var(--color-weekend)' }} />
          주말
          <span className="ml-1 h-3 w-3 rounded-sm" style={{ background: 'var(--color-holiday-band)' }} />
          공휴일
        </span>
        <span className="text-ink-muted">
          {isPmo ? '가중치·실적% 셀 클릭해 편집' : '담당 작업의 실적% 셀 클릭해 편집'}
        </span>
      </div>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${
            toast.kind === 'ok' ? 'bg-done text-white' : 'bg-delayed text-white'
          }`}
          role="status"
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}

/* ── 간트 바 ── */
function Bar({
  n,
  xOf,
  dayPx,
}: {
  n: ComputedItem
  xOf: (d: string) => number
  dayPx: number
}) {
  const left = xOf(n.plannedStart!)
  const width = Math.max(dayPx * 0.5, xOf(n.plannedEnd!) + dayPx - left)
  const pct = Math.min(100, Math.max(0, n.rolledActualPct))
  const showInside = width >= 40 && n.status !== 'done'
  const showOutside = width < 40 && n.status !== 'done'

  if (n.level === 'phase') {
    return (
      <div
        className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[3px] bg-phasebar"
        style={{ left, width }}
      >
        <div
          className="h-full rounded-[3px] bg-phasebar-fill opacity-60"
          style={{ width: `${pct}%` }}
        />
        {showOutside && (
          <span
            className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-1 text-[9px] tabular-nums text-ink-muted"
            style={{ left: width }}
          >
            {pct}%
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      className="absolute top-1/2 h-3.5 -translate-y-1/2 overflow-visible rounded-full"
      style={{ left, width }}
    >
      <div className="h-full overflow-hidden rounded-full bg-plan-track ring-1 ring-grid">
        <div
          className={`h-full rounded-full ${STATUS[n.status].bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showInside && (
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] font-medium tabular-nums text-white/95">
          {pct}%
        </span>
      )}
      {showOutside && (
        <span
          className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-1 text-[9px] tabular-nums text-ink-muted"
          style={{ left: width }}
        >
          {pct}%
        </span>
      )}
    </div>
  )
}
