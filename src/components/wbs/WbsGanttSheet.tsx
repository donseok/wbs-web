'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { ComputedItem, Membership } from '@/lib/domain/types'
import { canEditActual, canEditWeight } from '@/lib/domain/permissions'
import { updateActual, updateWeight, addWbsItem } from '@/app/actions/wbs'
import { queueWbsCollapse } from '@/lib/prefs/debouncedSave'
import { Maximize2, Minimize2, FileText } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { roundWeight } from '@/lib/domain/format'
import { LevelBadge, OwnerBadges, STATUS, TEAM, fmtDate } from './shared'
import { RowDetailPanel } from './RowDetailPanel'
import { ReportModal } from '@/components/report/ReportModal'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'

/* ── 컬럼 메타 (좌→우). frozen=true면 sticky 동결, sk=누적 left offset ── */
type Col = { key: string; w: number; frozen?: boolean; sk?: number; detail?: boolean }
const COLS: Col[] = [
  { key: 'no', w: 44, frozen: true, sk: 0 },
  { key: 'level', w: 60, frozen: true, sk: 44 },
  { key: 'name', w: 300, frozen: true, sk: 104 },
  { key: 'owners', w: 128 },
  { key: 'status', w: 76 },
  { key: 'deliverable', w: 150, detail: true },
  { key: 'pstart', w: 80, detail: true },
  { key: 'pend', w: 80, detail: true },
  { key: 'weight', w: 64, detail: true },
  { key: 'pplan', w: 60 },
  { key: 'pactual', w: 72 },
  { key: 'achieve', w: 76 },
]
const W = (k: string) => COLS.find(c => c.key === k)!.w
/* 타임라인 집중 모드에서 보이는 컬럼(나머지 수치/상세 열은 숨겨 간트 폭을 확보) */
const TIMELINE_COLS = new Set(['no', 'level', 'name', 'owners', 'status'])
/* 본문 행 높이(px) — CSS 변수(--wbs-row-h)와 배경 격자/오늘선 높이(rowsH)의 단일 진실원본.
   과거 rowsH 가 36 으로 하드코딩돼 실제 40px 행과 어긋나면서, 아래쪽 행들의 타임라인 격자·
   주말/공휴일 밴드·붉은 기준일선이 끝까지 그려지지 않던 버그가 있었다. 반드시 함께 움직여야 한다. */
const ROW_H = 40

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
/* 담당별 분리 부모(자식 있는 activity) id — 기본 접힘 대상 */
function splitParentIds(items: ComputedItem[]): Set<string> {
  const s = new Set<string>()
  const walk = (ns: ComputedItem[]) =>
    ns.forEach(n => {
      if (n.level === 'activity' && n.children.length) s.add(n.id)
      walk(n.children)
    })
  walk(items)
  return s
}
/* sub-act 트리 표시명 — 저장 이름 "{부모명} ({팀} 주관/지원)"에서 부모명 접두를 벗겨
   팀 부분만 남긴다(트리에선 부모가 바로 위에 보여 접두가 중복). 접두가 없으면(개명된
   경우) 풀네임 그대로. 저장 이름·검색·챗봇·보고서는 풀네임을 유지한다. */
function subActLabel(name: string, parentName: string): string {
  if (name.startsWith(parentName)) {
    const rest = name.slice(parentName.length).trim()
    const m = rest.match(/^\((.*)\)$/)
    if (m && m[1]) return m[1]
    if (rest) return rest
  }
  return name
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
  projectId,
  projectName = '',
  projectDescription,
  startDate,
  endDate,
  readOnly = false,
  defaultView = 'sheet',
  initialCollapsed,
}: {
  items: ComputedItem[]
  holidays: string[]
  today: string
  membership: Membership | null
  projectId: string
  /** 주간 보고서 모달용 프로젝트 메타 */
  projectName?: string
  projectDescription?: string | null
  startDate?: string | null
  endDate?: string | null
  /** 데모 모드 등에서 인라인 편집 비활성화 */
  readOnly?: boolean
  /** 'timeline'이면 타임라인 집중 모드로 시작(통합된 간트 메뉴 진입용) */
  defaultView?: 'sheet' | 'timeline'
  /** 계정에 저장된 접힘 id 목록. 있으면 기본 접힘 대신 이 값으로 초기화. */
  initialCollapsed?: string[]
}) {
  const router = useRouter()
  const { t } = useLocale()
  // 담당별 분리 부모는 기본 접힘 — 첫 화면이 엑셀 원본과 같은 행 구성이 된다.
  // 계정에 저장된 접힘 상태가 있으면(initialCollapsed) 그 값을 우선한다.
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => (initialCollapsed ? new Set(initialCollapsed) : splitParentIds(items)),
  )
  // 사용자 토글 시에만 개인 뷰 상태를 계정에 저장. 초기 렌더(마운트, StrictMode 이중 호출 포함)는
  // collapsed 참조가 초기값 그대로라 저장하지 않는다. setCollapsed 는 변경 시 항상 새 Set 을 만든다.
  const savedCollapsedRef = useRef(collapsed)
  useEffect(() => {
    if (collapsed === savedCollapsedRef.current) return
    savedCollapsedRef.current = collapsed
    queueWbsCollapse(projectId, [...collapsed])
  }, [collapsed, projectId])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addPhase, setAddPhase] = useState<string | null>(null) // null=닫힘
  const [addBusy, setAddBusy] = useState(false)
  const [dayPx, setDayPx] = useState(24)
  const [showDetails, setShowDetails] = useState(true)
  // 타임라인 집중 모드는 대시보드 '간트' 링크(?view=timeline) 진입 시에만 활성.
  // 툴바 토글 버튼은 제거됨 — 값은 defaultView에서 파생.
  const timelineFocus = defaultView === 'timeline'
  const [fullscreen, setFullscreen] = useState(false) // 팝업(전체화면 모달)로 크게 보기
  const [reportOpen, setReportOpen] = useState(false) // 주간 보고서 모달
  const [edit, setEdit] = useState<{ id: string; field: 'weight' | 'actual' } | null>(null)
  const [draft, setDraft] = useState('')
  const [editOriginal, setEditOriginal] = useState('') // 편집 시작 시 값(낙관적 잠금용)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const visibleCols = useMemo(
    () => COLS.filter(col => (timelineFocus ? TIMELINE_COLS.has(col.key) : showDetails || !col.detail)),
    [showDetails, timelineFocus],
  )
  const showCol = (key: string) => visibleCols.some(c => c.key === key)
  const LEFT_W = visibleCols.reduce((sum, col) => sum + col.w, 0)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  // 전체화면 팝업: Escape 로 닫기 + 배경 스크롤 잠금.
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [fullscreen])

  const toggle = (id: string) =>
    setCollapsed(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
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

  // act 하위의 담당자별 분리 항목(sub-act) — 구분 배지 SUB-ACT + 트리 축약 표시명
  const subActLabels = useMemo(() => {
    const m = new Map<string, string>()
    const walk = (ns: ComputedItem[]) =>
      ns.forEach(n => {
        if (n.level === 'activity') n.children.forEach(c => m.set(c.id, subActLabel(c.name, n.name)))
        walk(n.children)
      })
    walk(items)
    return m
  }, [items])

  // 접기/펼치기는 sub-act 를 가진 act 에만 허용 — phase/task 는 항상 펼친 채 고정
  const collapsibleIds = useMemo(() => splitParentIds(items), [items])

  const q = query.trim().toLowerCase()
  const matchKeep = useMemo(() => (q ? buildMatch(items, q) : null), [items, q])
  const flatRows = useMemo(
    () =>
      matchKeep ? flatten(items, new Set()).filter(n => matchKeep.has(n.id)) : flatten(items, collapsed),
    [items, collapsed, matchKeep],
  )

  const allCollapsed = collapsibleIds.size > 0 && [...collapsibleIds].every(id => collapsed.has(id))
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(collapsibleIds))

  // 선택된 행(상세 패널). items가 갱신돼도 id로 다시 찾아 최신값 표시.
  const selectedItem = useMemo<ComputedItem | null>(() => {
    if (!selectedId) return null
    const find = (ns: ComputedItem[]): ComputedItem | null => {
      for (const n of ns) {
        if (n.id === selectedId) return n
        const c = find(n.children)
        if (c) return c
      }
      return null
    }
    return find(items)
  }, [selectedId, items])

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
      months.push({ ym, label: t(`wbs.month${Number(d.slice(5, 7))}` as DictKey), left: i * dayPx, width: dayPx })
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
  const rowsH = flatRows.length * ROW_H

  /* ── 편집 (WbsSheet 이식) ── */
  const isPmo = membership?.role === 'pmo_admin'
  const canEditW = canEditWeight(membership) && !readOnly
  const startEdit = (id: string, field: 'weight' | 'actual', current: string) => {
    setEdit({ id, field })
    setDraft(current)
    setEditOriginal(current)
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
      let res: { ok: boolean; error?: string; conflict?: boolean }
      if (field === 'actual') {
        if (draft.trim() === '') {
          setToast({ kind: 'err', msg: t('wbs.toastEmpty') })
          return cancel()
        }
        const pct = Number(draft)
        if (Number.isNaN(pct)) {
          setToast({ kind: 'err', msg: t('wbs.toastNumbersOnly') })
          return cancel()
        }
        if (pct < 0 || pct > 100) {
          setToast({ kind: 'err', msg: t('wbs.toastRange') })
          return cancel()
        }
        res = await updateActual(id, pct, Number(editOriginal))
      } else {
        const wv = draft.trim() === '' ? null : Number(draft)
        if (wv != null && (Number.isNaN(wv) || wv < 0)) {
          setToast({ kind: 'err', msg: t('wbs.toastWeightMin') })
          return cancel()
        }
        res = await updateWeight(id, wv, editOriginal.trim() === '' ? null : Number(editOriginal))
      }
      if (res.ok) {
        setToast({ kind: 'ok', msg: t('wbs.toastSaved') })
        router.refresh()
      } else if (res.conflict) {
        // 충돌: 최신 값으로 새로고침하고 안내.
        setToast({ kind: 'err', msg: res.error ?? t('wbs.toastConflict') })
        router.refresh()
      } else {
        setToast({ kind: 'err', msg: res.error ?? t('wbs.toastSaveFail') })
      }
    } finally {
      setBusy(false)
      setEdit(null)
      setDraft('')
    }
  }
  async function submitAddPhase() {
    if (!addPhase?.trim() || addBusy) return
    setAddBusy(true)
    const res = await addWbsItem(projectId, null, 'phase', addPhase.trim())
    setAddBusy(false)
    if (res.ok) { setAddPhase(null); setToast({ kind: 'ok', msg: t('wbs.toastPhaseAdded') }); router.refresh() }
    else setToast({ kind: 'err', msg: res.error ?? t('wbs.toastAddFail') })
  }

  const editInput = (current: string, field: 'weight' | 'actual') => (
    <input
      autoFocus
      type="number"
      value={draft}
      disabled={busy}
      aria-label={field === 'weight' ? t('wbs.ariaEditWeight') : t('wbs.ariaEditActual')}
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
    'box-border flex h-[var(--wbs-head-h)] shrink-0 items-center bg-sheet-head px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted border-b border-grid-strong'
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
      className={
        fullscreen
          ? 'fixed inset-0 z-[125] overflow-auto app-backdrop px-3 py-3 sm:px-6 sm:py-5'
          : 'relative w-full min-w-0 max-w-full'
      }
      role={fullscreen ? 'dialog' : undefined}
      aria-modal={fullscreen || undefined}
      aria-label={fullscreen ? t('wbs.ariaFullscreen') : undefined}
      style={
        {
          '--wbs-row-h': `${ROW_H}px`,
          '--wbs-head-h': '58px',
          '--wbs-left-w': `${LEFT_W}px`,
          '--gantt-day': `${dayPx}px`,
        } as React.CSSProperties
      }
    >
      {/* ── 툴바 ── */}
      <div className="card mb-3 grid w-full min-w-0 max-w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 overflow-hidden p-2.5 sm:flex sm:flex-wrap">
        <div className="mr-2 flex items-center gap-2 px-1 text-sm font-semibold text-ink">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-weak text-brand"><Icon name="grid" className="h-4 w-4" /></span>
          <span>{t('wbs.board')}</span>
        </div>
        <div className="relative min-w-0 sm:flex-none">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('wbs.searchPlaceholder')}
            aria-label={t('wbs.searchAria')}
            className="app-input h-9 w-full pl-9 text-[13px] sm:w-52"
          />
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
        </div>
        <button onClick={toggleAll} className="btn btn-ghost h-9 px-3 text-xs">
          {allCollapsed ? t('wbs.expandAll') : t('wbs.collapseAll')}
        </button>
        <button onClick={() => setFullscreen(v => !v)} aria-pressed={fullscreen} title={fullscreen ? t('wbs.exitFullscreenTitle') : t('wbs.enterFullscreenTitle')} className={`btn h-9 px-3 text-xs ${fullscreen ? 'border border-brand-ring bg-brand-weak text-brand' : 'btn-ghost'}`}>
          {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />} {fullscreen ? t('wbs.viewSmaller') : t('wbs.viewLarger')}
        </button>
        {!timelineFocus && (
          <button onClick={() => setShowDetails(value => !value)} aria-pressed={showDetails} className={`btn h-9 px-3 text-xs ${showDetails ? 'border border-brand-ring bg-brand-weak text-brand' : 'btn-ghost'}`}>
            <Icon name="layers" className="h-3.5 w-3.5" /> {showDetails ? t('wbs.hideDetailCols') : t('wbs.showDetailCols')}
          </button>
        )}
        {isPmo && !readOnly && (
          <button onClick={() => setAddPhase(p => (p == null ? '' : null))} className="btn btn-ghost h-9 px-3 text-xs">
            <Icon name="plus" className="h-3.5 w-3.5" /> {t('wbs.addPhase')}
          </button>
        )}
        <button onClick={() => setReportOpen(true)} className="btn btn-ghost h-9 px-3 text-xs">
          <FileText className="h-3.5 w-3.5" /> 주간 보고서
        </button>
        <span className="hidden rounded-lg bg-surface-2 px-2.5 py-2 text-[10px] tabular-nums text-ink-muted xl:inline">
          {fmtDate(rangeStart)} – {fmtDate(rangeEnd)} · {flatRows.length}{t('wbs.unitRows')}
        </span>
        <div className="seg ml-auto hidden h-9 gap-0.5 p-0.5 sm:inline-flex" aria-label={t('wbs.ganttZoomAria')}>
          <button
            onClick={() => setDayPx(16)}
            aria-pressed={dayPx === 16}
            className={`seg-item px-2.5 py-1 text-[12px] ${dayPx === 16 ? 'seg-item-active' : ''}`}
          >
            {t('wbs.zoomOut')}
          </button>
          <button
            onClick={() => setDayPx(24)}
            aria-pressed={dayPx === 24}
            className={`seg-item px-2.5 py-1 text-[12px] ${dayPx === 24 ? 'seg-item-active' : ''}`}
          >
            {t('wbs.zoomDefault')}
          </button>
        </div>
      </div>

      {/* 새 Phase 입력 (PMO) */}
      {addPhase != null && (
        <div className="card mb-3 flex items-center gap-2 p-2.5">
          <input
            autoFocus
            value={addPhase}
            onChange={e => setAddPhase(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitAddPhase(); else if (e.key === 'Escape') setAddPhase(null) }}
            placeholder={t('wbs.newPhasePlaceholder')}
            aria-label={t('wbs.newPhaseAria')}
            className="app-input h-9 flex-1 text-sm"
          />
          <button onClick={submitAddPhase} disabled={addBusy || !addPhase.trim()} className="btn btn-primary h-9 px-4 text-xs">{addBusy ? t('wbs.adding') : t('common.add')}</button>
          <button onClick={() => setAddPhase(null)} className="btn btn-ghost h-9 px-3 text-xs">{t('common.cancel')}</button>
        </div>
      )}

      {/* 주간 보고서 모달 (대시보드 히어로의 보고서 버튼과 동일 기능) */}
      <ReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        projectId={projectId}
        items={items}
        projectName={projectName}
        projectDescription={projectDescription}
        today={today}
        startDate={startDate}
        endDate={endDate}
      />

      {/* ── 단일 스크롤 컨테이너 ── */}
      <div className="card w-full max-w-full overflow-auto" style={{ maxHeight: fullscreen ? 'calc(100dvh - 150px)' : 'max(440px, calc(100dvh - 390px))' }}>
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
            {headCell(COLS[1], t('wbs.colLevel'), 'justify-center')}
            {headCell(COLS[2], t('wbs.colName'), 'justify-start')}
            {headCell(COLS[3], t('wbs.colOwners'), 'justify-start')}
            {headCell(COLS[4], t('wbs.colStatus'), 'justify-center')}
            {showCol('deliverable') && headCell(COLS[5], t('wbs.colDeliverable'), 'justify-start')}
            {showCol('pstart') && headCell(COLS[6], t('wbs.colPlannedStart'), 'justify-center')}
            {showCol('pend') && headCell(COLS[7], t('wbs.colPlannedEnd'), 'justify-center')}
            {showCol('weight') && headCell(COLS[8], t('wbs.colWeight'), 'justify-end')}
            {showCol('pplan') && headCell(COLS[9], t('wbs.colPlannedPct'), 'justify-end')}
            {showCol('pactual') && headCell(COLS[10], t('wbs.colActualPct'), 'justify-end')}
            {showCol('achieve') && headCell(COLS[11], t('wbs.colAchievement'), 'justify-center')}
            {/* 간트 헤더 (월/주/일 3단) */}
            <div
              className="relative box-border h-[var(--wbs-head-h)] shrink-0 border-b-2 border-grid-strong bg-sheet-head"
              style={{ width: ganttW }}
            >
              {months.map(m => (
                <div
                  key={m.left}
                  className="absolute top-0 box-border flex h-5 items-center border-r border-grid px-1.5 text-[10px] font-semibold text-ink-muted"
                  style={{ left: m.left, width: m.width }}
                >
                  {m.label}
                </div>
              ))}
              {weeks.map(w => (
                <div
                  key={w.left}
                  className="absolute box-border flex h-[19px] items-center gap-1 border-r border-grid px-1.5 text-[9.5px] font-medium text-ink-subtle"
                  style={{ top: 20, left: w.left, width: w.width }}
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
                      top: 39,
                      left: i * dayPx,
                      width: dayPx,
                      height: 19,
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
            const canToggle = collapsibleIds.has(n.id)
            const isCollapsed = collapsed.has(n.id)
            const rowNo = idx + 1
            const rowBg =
              n.level === 'phase'
                ? 'bg-[#f1f4f9]'
                : n.level === 'task'
                  ? 'bg-[#f8faff]'
                  : rowNo % 2 === 0
                    ? 'bg-zebra'
                    : 'bg-surface'
            const cellBg = `${rowBg} group-hover:bg-brand-weak`
            const subLabel = subActLabels.get(n.id)
            const nameWeight =
              n.level === 'phase'
                ? 'font-semibold text-ink'
                : n.level === 'task'
                  ? 'font-medium text-ink'
                  : subLabel != null
                    ? 'text-ink-muted'
                    : 'text-ink'

            const editingWeight = edit?.id === n.id && edit.field === 'weight'
            const editingActual = edit?.id === n.id && edit.field === 'actual'
            const editableW = canEditW
            const editableA = canEditActual(n, membership) && !readOnly
            const weightLabel = n.weight == null ? t('wbs.weightEqual') : String(roundWeight(n.weight))

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
                  <LevelBadge level={n.level} sub={subLabel != null} />
                </div>
                {/* 작업명 */}
                <div className={`${cellBase} freeze-edge text-[12px] ${cellBg}`} style={frozen('name')}>
                  <div className="flex min-w-0 items-center" style={{ paddingLeft: depth * 14 }}>
                    {canToggle ? (
                      <button
                        onClick={() => toggle(n.id)}
                        className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10px] text-ink-subtle hover:bg-line hover:text-ink"
                        aria-label={isCollapsed ? t('wbs.expand') : t('wbs.collapse')}
                        aria-expanded={!isCollapsed}
                      >
                        {isCollapsed ? '▸' : '▾'}
                      </button>
                    ) : (
                      <span className="mr-1 w-4 shrink-0" />
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedId(n.id)}
                      className={`truncate text-left ${nameWeight} hover:text-brand hover:underline`}
                      title={`${n.name} · ${t('wbs.rowDetailTitle')}`}
                    >
                      {subLabel != null ? (
                        <>
                          <span aria-hidden className="mr-1 text-ink-subtle">└</span>
                          {subLabel}
                        </>
                      ) : (
                        n.name
                      )}
                    </button>
                  </div>
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
                  <span className={`chip ${STATUS[n.status].chip}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS[n.status].dot}`} />
                    {t(`status.${n.status}` as DictKey)}
                  </span>
                </div>
                {/* 산출물 */}
                {showCol('deliverable') && (
                  <div
                    className={`${cellBase} border-r border-grid text-[12px] text-ink-muted ${cellBg}`}
                    style={{ width: W('deliverable') }}
                  >
                    <span className="block truncate" title={n.deliverable ?? undefined}>
                      {n.deliverable ?? '-'}
                    </span>
                  </div>
                )}
                {/* 계획시작 */}
                {showCol('pstart') && (
                  <div
                    className={`${cellBase} border-r border-grid justify-center text-[12px] tabular-nums text-ink-muted ${cellBg}`}
                    style={{ width: W('pstart') }}
                  >
                    {fmtDate(n.plannedStart)}
                  </div>
                )}
                {/* 계획종료 */}
                {showCol('pend') && (
                  <div
                    className={`${cellBase} border-r border-grid justify-center text-[12px] tabular-nums text-ink-muted ${cellBg}`}
                    style={{ width: W('pend') }}
                  >
                    {fmtDate(n.plannedEnd)}
                  </div>
                )}
                {/* 가중치 — overflow-hidden: 표시 반올림을 우회하는 긴 값이 이웃 날짜 칸을 덮지 않게 */}
                {showCol('weight') && <div
                  className={`${cellBase} overflow-hidden border-r border-grid justify-end text-[12px] tabular-nums ${
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
                  title={editableW ? t('wbs.editWeightTitle') : undefined}
                >
                  {editingWeight ? editInput(weightLabel, 'weight') : weightLabel}
                </div>}
                {/* 계획% */}
                {showCol('pplan') && (
                <div
                  className={`${cellBase} border-r border-grid justify-end text-[12px] tabular-nums text-ink-muted ${cellBg}`}
                  style={{ width: W('pplan') }}
                >
                  {n.plannedPct}%
                </div>
                )}
                {/* 실적% (데이터바) */}
                {showCol('pactual') && (
                <div
                  className={`${cellBase} relative justify-end overflow-hidden border-r border-grid text-[12px] font-medium tabular-nums ${
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
                    editableA ? t('wbs.editActualTitle') : hasChildren ? t('wbs.autoRollupTitle') : undefined
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
                )}
                {/* 달성율 (미니바) */}
                {showCol('achieve') && (
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
                )}
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
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-weak text-brand" aria-hidden>
                <Icon name={items.length === 0 ? 'folder' : 'search'} />
              </span>
              <span className="text-sm font-medium text-ink-muted">
                {items.length === 0
                  ? t('wbs.emptyNoItems')
                  : `${t('wbs.noResultsPrefix')}${query.trim()}${t('wbs.noResultsSuffix')}`}
              </span>
              <span className="text-[12px] text-ink-subtle">
                {items.length === 0 ? t('wbs.emptyNoItemsHint') : t('wbs.noResultsHint')}
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
                {t('wbs.today')}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 범례 ── */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-line/70 bg-surface/70 px-3 py-2 text-[11px] text-ink-subtle">
        <span className="inline-flex items-center gap-2">
          {(['done', 'in_progress', 'delayed', 'not_started'] as const).map(s => (
            <span key={s} className="inline-flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${STATUS[s].dot}`} />
              {t(`status.${s}` as DictKey)}
            </span>
          ))}
        </span>
        <span className="inline-flex items-center gap-2">
          {(['PMO', 'ERP', 'MES', '가공'] as const).map(t => (
            <span key={t} className="inline-flex items-center gap-0.5">
              <span className={`${TEAM[t].fg} text-[9px]`}>●</span>
              {t}
            </span>
          ))}
          <span>{t('wbs.legendOwnerMarks')}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-4 rounded-full bg-plan-track ring-1 ring-grid" />
          {t('wbs.legendPlanned')}
          <span className="ml-1 h-2 w-4 rounded-full bg-progress" />
          {t('wbs.legendActual')}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded-sm" style={{ background: 'var(--color-weekend)' }} />
          {t('wbs.legendWeekend')}
          <span className="ml-1 h-3 w-3 rounded-sm" style={{ background: 'var(--color-holiday-band)' }} />
          {t('wbs.legendHoliday')}
        </span>
        <span className="text-ink-muted">
          {timelineFocus
            ? t('wbs.legendHintTimeline')
            : isPmo
              ? t('wbs.legendHintPmo')
              : t('wbs.legendHintOwner')}
        </span>
      </div>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${
            toast.kind === 'ok' ? 'bg-done text-white' : 'bg-delayed text-white'
          }`}
          role={toast.kind === 'err' ? 'alert' : 'status'}
        >
          {toast.msg}
        </div>
      )}

      {selectedItem && (
        <RowDetailPanel
          item={selectedItem}
          subAct={subActLabels.has(selectedItem.id)}
          onClose={() => setSelectedId(null)}
          editable={isPmo && !readOnly}
          canAttach={!readOnly && !!membership && (isPmo || selectedItem.owners.some(o => o.team === membership.teamCode))}
          projectId={projectId}
        />
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
  const showInside = width >= 54 && pct >= 45 && n.status !== 'done'
  const showOutside = !showInside && n.status !== 'done'

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
        <span className="absolute top-1/2 -translate-x-full -translate-y-1/2 pr-1 text-[9px] font-medium tabular-nums text-white/95" style={{ left: `${pct}%` }}>
          {pct}%
        </span>
      )}
      {showOutside && (
        <span
          className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-1 text-[9px] tabular-nums text-ink-muted"
          style={{ left: Math.min(width, Math.max(0, width * pct / 100)) }}
        >
          {pct}%
        </span>
      )}
    </div>
  )
}
