'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CONTENT_COLS, rectFromAddrs, valuesInRect, moveActive, advanceActive,
  pasteEdits, fillEdits, clearEdits, reconcileSelection,
  type CellAddr, type GridRect, type SelectionState,
} from '@/lib/domain/sheetSelection'
import { serializeTsv, parseTsv } from '@/lib/domain/sheetClipboard'
import { isNewlineChord } from '@/lib/domain/sheetChords'
import { type WeeklyCellKey, type WeeklySheetRow, type WeeklyCellEdit } from '@/lib/domain/weeklySheet'

/** aria-live 방송용 열 라벨(§7). */
const COL_LABEL: Record<WeeklyCellKey, string> = {
  this_content: '금주실적 내용', this_issue: '금주 이슈·이벤트',
  next_content: '차주계획 내용', next_issue: '차주 이슈·이벤트',
}

const keyOf = (a: CellAddr): string => `${a.rowId}:${a.col}`
const addrEq = (a: CellAddr, b: CellAddr): boolean => a.rowId === b.rowId && a.col === b.col

/** 인쇄 가능한 단일 문자(편집 진입 트리거) 판정. Alt 수식(macOS Option)·AltGr(Ctrl+Alt) 문자도 포함해
 *  세션 없이 네이티브 삽입되는 경로를 차단(F9). 순수 Ctrl/Meta 조합만 제외. */
function isPrintableKey(e: React.KeyboardEvent): boolean {
  return e.key.length === 1 && !e.metaKey && (!e.ctrlKey || e.altKey)
}

/** React 제어 textarea에 값 변경을 주입 — 네이티브 value setter 후 input 이벤트로 onChange 유발.
 *  덮어쓰기 초기화(''), Alt+Enter 줄바꿈 삽입에 사용(캐럿 처리는 브라우저에 위임). */
function nativeSet(el: HTMLTextAreaElement, next: string, caret?: number): void {
  const proto = Object.getPrototypeOf(el) as object
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(el, next)
  if (caret != null) el.selectionStart = el.selectionEnd = caret
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

export interface SheetGridApi {
  sel: SelectionState
  rect: GridRect | null
  /** 채우기 드래그 중 미리보기 대상 사각(원본 포함). 비드래그 시 null. */
  fillPreview: GridRect | null
  dragging: 'select' | 'fill' | null
  live: string
  onCellMouseDown: (e: React.MouseEvent, addr: CellAddr) => void
  onCellMouseEnter: (addr: CellAddr) => void
  onCellFocus: (addr: CellAddr) => void
  onCellBlurEvent: (e: React.FocusEvent) => void
  onCellDoubleClick: () => void
  /** Design B — 활성 셀 textarea만 포커스되므로 대상 셀은 항상 active. 별도 addr 불필요. */
  onCellKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onCellCopy: (e: React.ClipboardEvent) => void
  onCellCut: (e: React.ClipboardEvent) => void
  onCellPaste: (e: React.ClipboardEvent) => void
  onCompositionStart: () => void
  onCompositionEnd: () => void
  onFillHandleMouseDown: (e: React.MouseEvent) => void
}

interface UseSheetGridArgs {
  rows: WeeklySheetRow[]
  enabled: boolean
  cellRefs: React.MutableRefObject<Map<string, HTMLTextAreaElement>>
  /** §2 배치 프로토콜 실행기(부모 소유). undoable=false면 undo 스택 push 생략(undo/redo 유발 배치). */
  runBatch: (edits: WeeklyCellEdit[], opts: { undoable: boolean }) => void
  requestUndo: () => boolean // 적용됐으면 true(aria-live 방송용)
  requestRedo: () => boolean
  /** 편집 세션 시작 — 부모가 baseline/wasDirty 스냅샷. 덮어쓰기(값 비우기)는 훅이 DOM에서 직접 처리. */
  beginEdit: (addr: CellAddr, overwrite?: boolean) => void
  /** 편집 세션 종료 — commit(저장+undo push) 또는 cancel(원값 복원). */
  endEdit: (addr: CellAddr, opts: { cancel: boolean }) => void
  toast: (t: { title: string; description?: string; variant?: 'success' | 'error' | 'info' }) => void
}

export function useSheetGrid({
  rows, enabled, cellRefs, runBatch, requestUndo, requestRedo, beginEdit, endEdit, toast,
}: UseSheetGridArgs): SheetGridApi {
  const rowIds = useMemo(() => rows.map(r => r.id), [rows])
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const rowIdsRef = useRef(rowIds)
  rowIdsRef.current = rowIds

  const first: CellAddr = { rowId: rowIds[0] ?? '', col: CONTENT_COLS[0] }
  const [sel, setSel] = useState<SelectionState>({ active: first, anchor: first, editing: false })
  const selRef = useRef(sel)
  selRef.current = sel
  const [fillPreview, setFillPreview] = useState<GridRect | null>(null)
  const [dragging, setDragging] = useState<'select' | 'fill' | null>(null)
  const [live, setLive] = useState('')

  const composingRef = useRef(false)
  const pendingImeEditRef = useRef(false) // 229 keydown이 IME 편집 진입을 이미 처리했음을 compositionstart에 신호(폴백 중복 진입 방지)
  const armedRef = useRef(false)         // 사용자 상호작용 전에는 포커스를 훔치지 않음(초기 로드 스크롤 방지)
  const dragModeRef = useRef<null | 'select' | 'fill'>(null)
  const fillSourceRef = useRef<GridRect | null>(null)

  const isCoarse = useCallback(
    () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches,
    [],
  )

  const rect = useMemo(() => rectFromAddrs(rowIds, sel.anchor, sel.active), [rowIds, sel.anchor, sel.active])

  // 선택 변경 방송(§7 aria-live). 단일 셀은 위치, 범위는 규모.
  useEffect(() => {
    if (!enabled) return
    const r = rectFromAddrs(rowIdsRef.current, sel.anchor, sel.active)
    if (!r) return
    const rowsN = r.bottom - r.top + 1
    const colsN = r.right - r.left + 1
    setLive(rowsN * colsN <= 1 ? `셀 선택: ${COL_LABEL[sel.active.col]}` : `${rowsN}행 × ${colsN}열 선택`)
  }, [sel.active, sel.anchor, enabled])

  // 활성 셀 실 포커스(Design B). 사용자 상호작용(armed) 후에만 — 초기 마운트/리렌더가 포커스를 앗지 않게.
  useEffect(() => {
    if (!enabled || !armedRef.current) return
    // 그리드 밖(TitleEditor 등)에 실제 포커스가 있으면 강탈 금지 — Realtime 리렌더가 타 입력의
    // 포커스를 도둑질하지 않게(F7). 포커스 없음(body/null)일 때만 그리드로 이동.
    const ae = document.activeElement
    if (ae && ae !== document.body && !(ae instanceof HTMLElement && ae.dataset.sheetCell)) return
    const el = cellRefs.current.get(keyOf(sel.active))
    if (el && document.activeElement !== el) el.focus()
  }, [sel.active, enabled, cellRefs])

  // 행 변경(refresh/Realtime) 시 선택 재조정(회귀 #5) — 사라진 rowId 드롭, active 클램프.
  useEffect(() => {
    // 드래그 중 rows 변경(Realtime INSERT/DELETE)이면 인덱스 기반 rect가 어긋나므로 진행 중 드래그 중단(F6).
    if (dragModeRef.current) { dragModeRef.current = null; fillSourceRef.current = null; setFillPreview(null); setDragging(null) }
    const next = reconcileSelection(rowIdsRef.current, selRef.current)
    if (next && next !== selRef.current) setSel(next)
  }, [rowIds])

  const setSingle = useCallback((addr: CellAddr, editing = false) => {
    setSel({ active: addr, anchor: addr, editing })
  }, [])

  // ── 배치 오퍼레이션(선택 기하 + 도메인 fn → runBatch) ──
  const doClear = useCallback((r: GridRect) => {
    const edits = clearEdits(rowsRef.current, rowIdsRef.current, r)
    if (edits.length === 0) return // 이미 빈 셀만 — no-op(AC5.4)
    runBatch(edits, { undoable: true })
    setLive(`${edits.length}개 셀 지움`)
  }, [runBatch])

  const doPasteText = useCallback((text: string, anchor: CellAddr) => {
    const values = parseTsv(text)
    const { edits, clippedRows, clippedCols } = pasteEdits(rowIdsRef.current, anchor, values)
    // 시트는 업무영역 구분 10행 고정이라 행을 늘릴 수단이 없다 — 실행 가능한 대안(위쪽 행부터
    // 붙여넣기 / 셀 안에서 줄바꿈)을 안내한다. '모듈 추가'를 안내하면 없는 버튼을 찾게 된다.
    const rowsMsg = `${clippedRows}개 행이 시트 범위를 넘어 붙여넣지 못했습니다. 시트는 구분 10행 고정입니다 — 위쪽 행에서 시작하거나, 한 구분에 여러 항목을 넣으려면 셀 안에서 Alt+Enter로 줄을 나눠 주세요.`
    if (clippedRows > 0 && clippedCols > 0) {
      toast({ title: '붙여넣기 일부 생략', variant: 'info',
        description: `${rowsMsg} 내용 4개 열을 넘는 오른쪽 데이터는 붙여넣지 않았습니다.` })
    } else if (clippedRows > 0) {
      toast({ title: '붙여넣기 일부 생략', variant: 'info', description: rowsMsg })
    } else if (clippedCols > 0) {
      toast({ title: '붙여넣기 일부 생략', variant: 'info', description: '내용 4개 열을 넘는 오른쪽 데이터는 붙여넣지 않았습니다.' })
    }
    if (edits.length === 0) return
    runBatch(edits, { undoable: true })
    // 선택을 붙여넣은 범위로 확장(앵커 기준 실제 반영된 폭/높이)
    const ids = rowIdsRef.current
    const aRow = ids.indexOf(anchor.rowId)
    const aCol = CONTENT_COLS.indexOf(anchor.col)
    const rowsN = Math.min(values.length, ids.length - aRow)
    const maxW = values.slice(0, rowsN).reduce((m, l) => Math.max(m, l.length), 0) // 행-클립으로 버려진 라인 제외(F5)
    const colsN = Math.min(maxW, CONTENT_COLS.length - aCol)
    if (aRow >= 0 && aCol >= 0 && rowsN >= 1 && colsN >= 1) {
      const endAddr: CellAddr = {
        rowId: ids[Math.min(aRow + rowsN - 1, ids.length - 1)],
        col: CONTENT_COLS[Math.min(aCol + colsN - 1, CONTENT_COLS.length - 1)],
      }
      setSel({ active: endAddr, anchor, editing: false })
    }
    setLive(`${edits.length}개 셀 붙여넣음`)
  }, [runBatch, toast])

  const doFill = useCallback((source: GridRect, target: GridRect) => {
    const edits = fillEdits(rowsRef.current, rowIdsRef.current, source, target)
    if (edits.length === 0) return
    runBatch(edits, { undoable: true })
    // 선택 = 원본 ∪ 대상(§2.3) — target이 원본을 포함하도록 계산됨.
    const ids = rowIdsRef.current
    const anchorAddr: CellAddr = { rowId: ids[target.top], col: CONTENT_COLS[target.left] }
    const activeAddr: CellAddr = { rowId: ids[target.bottom], col: CONTENT_COLS[target.right] }
    setSel({ active: activeAddr, anchor: anchorAddr, editing: false })
    setLive(`${edits.length}개 셀 채움`)
  }, [runBatch])

  // ── 드래그(select/fill) 전역 종료 리스너 ── (doFill 정의 후 배선 — mouseup에 최신 fillPreview 반영)
  useEffect(() => {
    if (!dragging) return
    const end = () => {
      if (dragModeRef.current === 'fill') {
        const source = fillSourceRef.current
        if (source && fillPreview) doFill(source, fillPreview)
      }
      dragModeRef.current = null
      fillSourceRef.current = null
      setFillPreview(null)
      setDragging(null)
    }
    window.addEventListener('mouseup', end)
    return () => window.removeEventListener('mouseup', end)
  }, [dragging, fillPreview, doFill])

  // ── 클립보드 이벤트(권한 프롬프트 없이 동작하는 1차 경로) ──
  const onCellCopy = useCallback((e: React.ClipboardEvent) => {
    if (selRef.current.editing) return // 편집 모드: 셀 내 텍스트 네이티브 복사에 양보
    const r = rectFromAddrs(rowIdsRef.current, selRef.current.anchor, selRef.current.active)
    if (!r) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', serializeTsv(valuesInRect(rowsRef.current, r)))
  }, [])

  const onCellCut = useCallback((e: React.ClipboardEvent) => {
    if (selRef.current.editing) return
    const r = rectFromAddrs(rowIdsRef.current, selRef.current.anchor, selRef.current.active)
    if (!r) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', serializeTsv(valuesInRect(rowsRef.current, r)))
    doClear(r) // 복사 + 원본 비우기 = 하나의 undo 엔트리(AC4.6)
  }, [doClear])

  const onCellPaste = useCallback((e: React.ClipboardEvent) => {
    if (selRef.current.editing) return
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (!text) { toast({ title: '붙여넣기 실패', description: '클립보드를 읽지 못했습니다. 브라우저 권한을 확인해 주세요.', variant: 'error' }); return }
    // 앵커 = 선택 범위 좌상단(구글시트 동일) — 드래그 방향(active 위치)과 무관.
    const ids = rowIdsRef.current
    const r = rectFromAddrs(ids, selRef.current.anchor, selRef.current.active)
    const anchor: CellAddr = r ? { rowId: ids[r.top], col: CONTENT_COLS[r.left] } : selRef.current.active
    doPasteText(text, anchor)
  }, [doPasteText, toast])

  // ── 마우스 ──
  const onCellMouseDown = useCallback((e: React.MouseEvent, addr: CellAddr) => {
    const cur = selRef.current
    if (cur.editing && addrEq(cur.active, addr)) return // 편집 중 자기 셀 클릭 — 네이티브 캐럿 이동 허용
    armedRef.current = true
    if (e.detail >= 2) { // 더블클릭 — preventDefault 없이 네이티브가 캐럿(클릭 위치/단어 선택)을 배치(F10)
      setSingle(addr, true)
      beginEdit(addr)
      return
    }
    if (isCoarse()) { // 터치: 탭=바로 편집(회귀 #11)
      setSingle(addr, true)
      beginEdit(addr)
      return
    }
    e.preventDefault() // 네이티브 포커스/캐럿 억제 — 포커스는 아래 명시 포커스 + effect가 관리
    cellRefs.current.get(keyOf(addr))?.focus() // 그리드 밖(TitleEditor 등)에서 클릭해도 셀로 포커스 이동(F7 가드 우회)
    if (e.shiftKey) { setSel({ active: addr, anchor: cur.anchor, editing: false }); return }
    setSingle(addr, false)
    dragModeRef.current = 'select'
    setDragging('select')
  }, [isCoarse, setSingle, beginEdit, cellRefs])

  const onCellMouseEnter = useCallback((addr: CellAddr) => {
    const mode = dragModeRef.current
    if (mode === 'select') {
      setSel(s => (addrEq(s.active, addr) ? s : { active: addr, anchor: s.anchor, editing: false }))
    } else if (mode === 'fill') {
      const source = fillSourceRef.current
      if (!source) return
      const ids = rowIdsRef.current
      const er = ids.indexOf(addr.rowId)
      const ec = CONTENT_COLS.indexOf(addr.col)
      if (er < 0 || ec < 0) return
      // 축 고정: source 밖으로의 이동 우세축만 채움(AC7.2)
      const dRow = er < source.top ? source.top - er : er > source.bottom ? er - source.bottom : 0
      const dCol = ec < source.left ? source.left - ec : ec > source.right ? ec - source.right : 0
      let target: GridRect
      if (dRow >= dCol) {
        target = { top: Math.min(source.top, er), bottom: Math.max(source.bottom, er), left: source.left, right: source.right }
      } else {
        target = { top: source.top, bottom: source.bottom, left: Math.min(source.left, ec), right: Math.max(source.right, ec) }
      }
      setFillPreview(target)
    }
  }, [])

  const onCellDoubleClick = useCallback(() => {
    // 편집 진입·캐럿 배치는 onCellMouseDown(e.detail>=2)가 네이티브로 처리(F10) — 여기선 드래그 잔여만 정리.
    dragModeRef.current = null
    setDragging(null)
  }, [])

  const onFillHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const r = rectFromAddrs(rowIdsRef.current, selRef.current.anchor, selRef.current.active)
    if (!r) return
    fillSourceRef.current = r
    setFillPreview(r)
    dragModeRef.current = 'fill'
    setDragging('fill')
  }, [])

  // 키보드/Tab로 그리드에 진입 시 active를 실제 포커스 셀로 동기화(§7 포커스 관리).
  // 프로그램 포커스(active 이동)로 인한 focus는 addr==active라 no-op → 루프 없음.
  const onCellFocus = useCallback((addr: CellAddr) => {
    armedRef.current = true
    setSel(s => (addrEq(s.active, addr) || s.editing ? s : { active: addr, anchor: addr, editing: false }))
  }, [])

  // 편집 중 그리드 밖(TitleEditor 등)으로 blur되면 편집 모드 해제(F8). handleCellBlur가 세션은 이미 커밋하지만
  // sel.editing이 남으면 같은 셀 재클릭이 beginEdit를 조기 return시켜 Esc/undo가 누락된다. 타 셀로의 이동은 무간섭.
  const onCellBlurEvent = useCallback((e: React.FocusEvent) => {
    const rt = e.relatedTarget
    if (!(rt instanceof HTMLElement && rt.dataset.sheetCell)) {
      setSel(s => (s.editing ? { ...s, editing: false } : s))
    }
  }, [])

  // ── 키보드 라우팅 ──
  // IME 조합은 keydown이 keyCode 229라 라우팅에서 걸러진다. nav 모드에서 조합이 시작되면
  // 그건 '문자 입력 시작'(D5)이므로 편집 모드로 진입시켜 캐럿을 켜고 이후 키를 편집으로 라우팅한다.
  // (조합 중 값 비우기는 자모 유실 위험이 커 하지 않음 — 덮어쓰기는 비-IME 문자 경로만.)
  const onCompositionStart = useCallback(() => {
    composingRef.current = true
    // 229 keydown 경로가 이미 편집 진입 + 덮어쓰기를 처리했으면 폴백을 건너뛴다.
    // (setSel editing이 아직 flush되지 않아 selRef.current.editing이 stale-false여도 baseline 재캡처를 막음.)
    if (pendingImeEditRef.current) { pendingImeEditRef.current = false; return }
    if (!selRef.current.editing) { // 229 없이 조합이 시작된 IME 폴백 — 진입만(덮어쓰기 없음, 값 유지)
      beginEdit(selRef.current.active)
      setSel(s => ({ active: s.active, anchor: s.active, editing: true })) // 편집 진입 = 선택을 활성 1셀로 축소(§1.4)
    }
  }, [beginEdit])
  const onCompositionEnd = useCallback(() => { composingRef.current = false; pendingImeEditRef.current = false }, [])

  const onCellKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 가드 최상단(D5) — 조합 중 keydown은 절대 탐색/편집 전환으로 해석하지 않음.
    if (composingRef.current || e.nativeEvent.isComposing) return
    if (e.keyCode === 229) {
      // 조합 '시작' keydown — compositionstart 전이라 값 클리어가 안전(자모 유실 없음).
      // 탐색 모드의 한글 첫 입력도 라틴과 동일하게 덮어쓰기로 편집 진입(D5).
      if (!selRef.current.editing) {
        armedRef.current = true
        pendingImeEditRef.current = true // 뒤이을 compositionstart 폴백이 baseline을 재캡처하지 않게 신호
        beginEdit(selRef.current.active, true)
        setSel(s => ({ active: s.active, anchor: s.active, editing: true })) // 편집 진입 = 선택을 활성 1셀로 축소(§1.4)
        nativeSet(e.currentTarget, '')
      }
      return
    }
    // 실키(비-229) 도달 = 직전 229 뒤에 조합이 따라오지 않았음이 확정 → 잔류 플래그 리셋(R-1b: 비정상 IME 방어).
    pendingImeEditRef.current = false
    armedRef.current = true
    const cur = selRef.current
    const ids = rowIdsRef.current
    const mod = e.ctrlKey || e.metaKey

    if (cur.editing) {
      // ── 편집 모드 ──
      if (isNewlineChord(e)) { // 셀 내 줄바꿈 — Alt/⌥·Ctrl·⌘ + Enter 모두 허용
        e.preventDefault()
        const el = e.currentTarget
        const s = el.selectionStart, en = el.selectionEnd
        nativeSet(el, el.value.slice(0, s) + '\n' + el.value.slice(en), s + 1)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        endEdit(cur.active, { cancel: false })
        setSingle(moveActive(ids, cur.active, e.shiftKey ? -1 : 1, 0), false)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        endEdit(cur.active, { cancel: false })
        setSingle(advanceActive(ids, cur.active, e.shiftKey ? 'prev' : 'next'), false)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        endEdit(cur.active, { cancel: true })
        setSel(s => ({ ...s, editing: false }))
        return
      }
      // 그 외(문자·방향키·Backspace/Delete·Ctrl+A/C/X/V/Z)는 네이티브 textarea에 위임.
      return
    }

    // ── 탐색 모드 ──
    if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) { if (requestRedo()) setLive('다시 실행') } else if (requestUndo()) setLive('실행 취소'); return }
    if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); if (requestRedo()) setLive('다시 실행'); return }
    // Ctrl/Cmd+C·X·V는 preventDefault하지 않음 → 네이티브 copy/cut/paste 이벤트가 onCellCopy/Cut/Paste로 처리.
    if (mod && 'cxv'.includes(e.key.toLowerCase())) return
    if (mod && (e.key === 'a' || e.key === 'A')) { // 전체 내용 셀 선택(v1)
      e.preventDefault()
      if (ids.length) {
        setSel({ anchor: { rowId: ids[0], col: CONTENT_COLS[0] },
          active: { rowId: ids[ids.length - 1], col: CONTENT_COLS[CONTENT_COLS.length - 1] }, editing: false })
      }
      return
    }
    if (mod && e.key === 'Home') { e.preventDefault(); setSingle({ rowId: ids[0], col: CONTENT_COLS[0] }); return }
    if (mod && e.key === 'End') { e.preventDefault(); setSingle({ rowId: ids[ids.length - 1], col: CONTENT_COLS[CONTENT_COLS.length - 1] }); return }

    switch (e.key) {
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': {
        e.preventDefault()
        const d = e.key === 'ArrowUp' ? [-1, 0] : e.key === 'ArrowDown' ? [1, 0] : e.key === 'ArrowLeft' ? [0, -1] : [0, 1]
        const nextActive = moveActive(ids, cur.active, d[0], d[1])
        if (e.shiftKey) setSel({ active: nextActive, anchor: cur.anchor, editing: false })
        else setSingle(nextActive)
        return
      }
      case 'Tab':
        e.preventDefault()
        setSingle(advanceActive(ids, cur.active, e.shiftKey ? 'prev' : 'next'))
        return
      case 'Enter':
        // 오케스트레이터 판정: Nav Enter = 편집 진입(값 유지, 캐럿 끝) — 구글시트 파리티.
        // Shift+Enter는 위로 이동 유지.
        e.preventDefault()
        if (e.shiftKey) { setSingle(moveActive(ids, cur.active, -1, 0)); return }
        beginEdit(cur.active, false)
        setSel(s => ({ active: s.active, anchor: s.active, editing: true })) // 편집 진입 = 선택을 활성 1셀로 축소(§1.4)
        {
          const el = cellRefs.current.get(keyOf(cur.active))
          if (el) { el.focus(); const n = el.value.length; el.setSelectionRange(n, n) }
        }
        return
      case 'F2':
        e.preventDefault()
        beginEdit(cur.active, false)
        setSel(s => ({ active: s.active, anchor: s.active, editing: true })) // 편집 진입 = 선택을 활성 1셀로 축소(§1.4)
        {
          const el = cellRefs.current.get(keyOf(cur.active))
          if (el) { el.focus(); const n = el.value.length; el.setSelectionRange(n, n) }
        }
        return
      case 'Backspace': case 'Delete': {
        e.preventDefault()
        const r = rectFromAddrs(ids, cur.anchor, cur.active)
        if (r) doClear(r)
        return
      }
      case 'Escape':
        e.preventDefault()
        setSel(s => ({ ...s, anchor: s.active })) // 범위를 활성 1셀로 축소
        return
      default:
        break
    }

    // 인쇄 가능 문자 → 편집 진입 + 덮어쓰기(D5). preventDefault 안 함(문자 자연 착지).
    if (isPrintableKey(e)) {
      beginEdit(cur.active, true)
      setSel(s => ({ active: s.active, anchor: s.active, editing: true })) // 편집 진입 = 선택을 활성 1셀로 축소(§1.4)
      const el = e.currentTarget
      nativeSet(el, '') // 기존 값 비움 — 이어질 네이티브 문자가 빈 셀에 착지(덮어쓰기)
    }
  }, [setSingle, beginEdit, endEdit, doClear, requestUndo, requestRedo, cellRefs])

  return {
    sel, rect, fillPreview, dragging, live,
    onCellMouseDown, onCellMouseEnter, onCellFocus, onCellBlurEvent, onCellDoubleClick, onCellKeyDown,
    onCellCopy, onCellCut, onCellPaste, onCompositionStart, onCompositionEnd, onFillHandleMouseDown,
  }
}
