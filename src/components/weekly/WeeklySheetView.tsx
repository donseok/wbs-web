'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronLeft, ChevronRight, Download, Plus, Trash2, ArrowUp, ArrowDown, FileSpreadsheet } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import {
  applyServerRow, moduleOptions, WEEKLY_CELL_KEYS, WEEKLY_SECTIONS,
  CELL_FIELD, type WeeklyCellKey, type WeeklySheetRow, type WeeklyCellEdit,
} from '@/lib/domain/weeklySheet'
import { type CellAddr } from '@/lib/domain/sheetSelection'
import { emptyUndo, pushUndo, undo as undoOp, redo as redoOp, type UndoState } from '@/lib/domain/sheetUndo'
import {
  addWeeklyRow, createWeeklyReport, deleteWeeklyRow, moveWeeklyRow,
  renameWeeklyModule, renameWeeklySection, saveWeeklyCell, saveWeeklyCells, saveWeeklyTitle,
  type WeeklyActionResult, type WeeklyBatchResult,
} from '@/app/actions/weekly'
import { shiftWeeks } from '@/lib/report/week'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { avatarLabel, buildPresenceMap, onlinePeers, presenceColor } from '@/lib/domain/sheetPresence'
import { useSheetGrid } from './useSheetGrid'
import { usePresence } from './usePresence'
import { SheetCell, type BatchChip } from './SheetCell'

type CellStatus = 'saving' | 'saved' | 'error'
const DEBOUNCE_MS = 1500
const CELL_MAX = 20000   // 셀 1개 상한(BE와 동일) — 배치 로컬 클램프용
const BATCH_MAX = 500    // 한 배치 최대 edit 수(BE와 동일) — 사전 검사용
const CUSTOM = '__custom__' // 콤보박스 '직접 입력…' 센티널

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
  projectId, weekStart, weekLabel, weekTitle, thisRange, nextRange, projectName,
  report, initialRows, hasCarrySource, me,
}: {
  projectId: string
  weekStart: string
  weekLabel: string
  weekTitle: string   // '7월 2주차' — 시트 제목 행용
  thisRange: string   // '7/6~7/10' — 금주실적 헤더
  nextRange: string   // '7/13~7/17' — 차주계획 헤더
  projectName: string
  report: { id: string; title: string } | null
  initialRows: WeeklySheetRow[]
  hasCarrySource: boolean
  me: { id: string; name: string } | null // 프레즌스 신원 — 서버(getSession)에서 전달
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
  const reportId = report?.id ?? null

  // ── 멀티셀 편집 레이어 상태 ──
  const cellRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map())  // `${rowId}:${col}` → 활성 포커스 관리(Design B)
  const undoRef = useRef<UndoState>(emptyUndo)                          // 셀 값 undo/redo(D3 — 구조 변경 제외)
  const editSessionRef = useRef<{ key: string; baseline: string; wasDirty: boolean } | null>(null) // 편집 세션 원값 스냅샷
  const batchInFlightRef = useRef(0)                                    // 진행 중 배치 수(0이면 칩 정리)
  const batchShowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // 진행 칩 300ms delayed-show
  const lastFailedBatchRef = useRef<WeeklyCellEdit[] | null>(null)      // 칩 '재시도'용 마지막 실패 배치
  const [batchChip, setBatchChip] = useState<BatchChip | null>(null)   // 활성 셀 집계 칩(§5)
  const [batchActive, setBatchActive] = useState(false)                // true면 per-cell 배지 억제

  const registerCell = useCallback((key: string, el: HTMLTextAreaElement | null) => {
    if (el) cellRefs.current.set(key, el)
    else cellRefs.current.delete(key)
  }, [])

  // 삭제된 행의 dirty 키·디바운스 타이머·저장 상태 정리 — 잔류하면 flushPendingSaves가
  // 영영 비지 않아 주간보고 PPT 내보내기가 세션 내내 차단된다(리뷰 확정 결함).
  const cleanupRowKeys = useCallback((rowId: string) => {
    for (const key of WEEKLY_CELL_KEYS) {
      const k = `${rowId}:${key}`
      dirtyRef.current.delete(k)
      retriedRef.current.delete(k)
      const t = timersRef.current.get(k)
      if (t) { clearTimeout(t); timersRef.current.delete(k) }
    }
    setStatus(s => {
      if (!WEEKLY_CELL_KEYS.some(key => `${rowId}:${key}` in s)) return s
      const next = { ...s }
      for (const key of WEEKLY_CELL_KEYS) delete next[`${rowId}:${key}`]
      return next
    })
  }, [])

  // 서버 refetch(라우터 refresh) 반영 — dirty 셀은 로컬 유지(스펙 §5), 사라진 행은 상태 정리
  useEffect(() => {
    const serverIds = new Set(initialRows.map(r => r.id))
    for (const l of rowsRef.current) if (!serverIds.has(l.id)) cleanupRowKeys(l.id)
    setRows(local => initialRows.map(sv => {
      const lc = local.find(l => l.id === sv.id)
      return lc ? applyServerRow(lc, sv, dirtyRef.current) : sv
    }))
  }, [initialRows, cleanupRowKeys])

  // 주차/프로젝트 전환(reportId 변경) 시 편집 레이어 세션 초기화 — 컴포넌트가 key 없이 유지되므로
  // 잔존 시 주차 B에서 Ctrl+Z가 주차 A의 rowId를 서버로 되돌려 화면 밖 데이터를 파괴한다(F1, 블로킹).
  useEffect(() => {
    undoRef.current = emptyUndo
    lastFailedBatchRef.current = null
    editSessionRef.current = null
    setBatchChip(null)
    setBatchActive(false)
  }, [reportId])

  // Realtime 구독 — 행 단위 이벤트를 셀 단위 병합
  // 의존성은 reportId(원시값)만 사용한다. report는 서버 렌더마다 새 객체라
  // 그걸 deps에 넣으면 SUBSCRIBED → refresh → 새 report 참조 → effect 재실행 → …
  // 무한 재구독 루프에 빠진다.
  useEffect(() => {
    if (!reportId) return
    const sb = createBrowserClient()
    let subscribedOnce = false
    const channel = sb
      .channel(`weekly-rows-${reportId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'weekly_report_rows', filter: `report_id=eq.${reportId}` },
        payload => {
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string }).id
            if (oldId) { cleanupRowKeys(oldId); setRows(rs => rs.filter(r => r.id !== oldId)) }
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
        if (st !== 'SUBSCRIBED') return
        // 최초 구독은 SSR props로 이미 최신 상태라 refetch 불필요.
        // 두 번째 이후(연결 끊김→재연결)에만 누락분을 보정한다(스펙 §5).
        if (!subscribedOnce) { subscribedOnce = true; return }
        router.refresh()
      })
    return () => { sb.removeChannel(channel) }
  }, [reportId, router, cleanupRowKeys])

  const commit = useCallback((rowId: string, key: WeeklyCellKey) => {
    const k = `${rowId}:${key}`
    const timer = timersRef.current.get(k)
    if (timer) { clearTimeout(timer); timersRef.current.delete(k) }
    const row = rowsRef.current.find(r => r.id === rowId)
    if (!row) { cleanupRowKeys(rowId); return } // 삭제된 행 — dirty 잔류 시 PPT flush가 영구 차단됨
    if (!dirtyRef.current.has(k)) return
    const sent = row[CELL_FIELD[key]]
    setStatus(s => ({ ...s, [k]: 'saving' }))
    // .catch: 오프라인·전송 계층 예외를 ok:false로 흡수 → 아래 error/재시도 경로로 합류(미포착 시 dirty·상태 영구 잔류, F2).
    saveWeeklyCell(projectId, rowId, key, sent)
      .catch((): WeeklyActionResult => ({ ok: false, error: '네트워크 오류로 저장하지 못했습니다.' }))
      .then(res => {
      const now = rowsRef.current.find(r => r.id === rowId)?.[CELL_FIELD[key]]
      if (!res.ok) {
        if (res.gone) { // 서버가 '행 삭제됨' 확정 — 재시도 대신 로컬 행·상태 정리
          cleanupRowKeys(rowId)
          setRows(rs => rs.filter(r => r.id !== rowId))
          return
        }
        setStatus(s => ({ ...s, [k]: 'error' }))
        if (!retriedRef.current.has(k)) {
          retriedRef.current.add(k)
          const prev = timersRef.current.get(k)
          if (prev) clearTimeout(prev)
          timersRef.current.set(k, setTimeout(() => commit(rowId, key), 2000)) // 자동 재시도 1회
        } else toast({ title: '저장 실패', description: res.error, variant: 'error' })
        return
      }
      retriedRef.current.delete(k)
      if (now === sent) { dirtyRef.current.delete(k); setStatus(s => ({ ...s, [k]: 'saved' })) }
      else commit(rowId, key) // 전송 중 재수정 — dirty 유지한 채 재저장
    })
  }, [projectId, toast, cleanupRowKeys])

  // PPT 내보내기 직전 미저장 셀 flush — export fetch와 blur commit이 경합하면 서버가
  // 저장 전 스냅샷으로 PPT를 만들 수 있다. 남은 dirty 키를 즉시 commit(디바운스 우회)하고
  // 전부 저장될 때까지 폴링. 5초를 넘기면 중단(false)하고 안내 — 불완전 PPT 방지가 목적.
  const flushPendingSaves = useCallback((): Promise<boolean> => {
    for (const k of dirtyRef.current) {
      const [rowId, key] = k.split(':') as [string, WeeklyCellKey]
      commit(rowId, key)
    }
    if (!dirtyRef.current.size) return Promise.resolve(true)
    return new Promise(resolve => {
      const start = Date.now()
      const poll = () => {
        if (!dirtyRef.current.size) { resolve(true); return }
        if (Date.now() - start >= 5000) {
          toast({ title: '내보내기 중단', description: '일부 셀이 아직 저장 중입니다. 저장 완료 후 다시 내보내 주세요.', variant: 'error' })
          resolve(false)
          return
        }
        setTimeout(poll, 100)
      }
      poll()
    })
  }, [commit, toast])

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

  // 구분(그룹)·모듈 rename — 콤보 선택 즉시 낙관 반영, 실패 시 refresh가 서버 값으로 복구.
  const onRenameSection = (groupRowIds: string[], section: string) => {
    setRows(rs => rs.map(r => (groupRowIds.includes(r.id) ? { ...r, section } : r)))
    runAction(() => renameWeeklySection(projectId, groupRowIds, section))
  }
  const onRenameModule = (rowId: string, module: string) => {
    setRows(rs => rs.map(r => (r.id === rowId ? { ...r, module } : r)))
    runAction(() => renameWeeklyModule(projectId, rowId, module))
  }

  // 재시도 직전 edits 재구성 — 여전히 dirty이고 행이 존재하는 키만 유지, content는 rowsRef 현재값으로 재스냅샷.
  // 그 사이 성공한 단건 저장을 stale 값으로 역전하지 않게(F4). 결과가 비면 되돌릴 것 없음 → 호출측이 성공 처리.
  const rebuildForRetry = useCallback((edits: WeeklyCellEdit[]): WeeklyCellEdit[] => {
    const out: WeeklyCellEdit[] = []
    for (const e of edits) {
      const k = `${e.rowId}:${e.cellKey}`
      if (!dirtyRef.current.has(k)) continue
      const row = rowsRef.current.find(r => r.id === e.rowId)
      if (!row) continue
      out.push({ rowId: e.rowId, cellKey: e.cellKey, content: row[CELL_FIELD[e.cellKey]] })
    }
    return out
  }, [])

  // ── 배치 실행기(계약 §2 ①~⑥) — 붙여넣기/범위삭제/채우기/undo·redo가 공유. 단건 commit과 동일한
  //    dirty/status/timer/flush/Realtime 시맨틱 유지(회귀 #1·#2·#3의 핵심). ──
  const runBatch = useCallback((editsRaw: WeeklyCellEdit[], opts: { undoable: boolean }) => {
    if (editsRaw.length === 0) return
    if (editsRaw.length > BATCH_MAX) { // §6-E 사전 검사(로컬 클램프 전 원본 크기)
      toast({ title: '붙여넣기 범위가 너무 큽니다', variant: 'error',
        description: `한 번에 처리할 수 있는 셀 수(${BATCH_MAX}개)를 초과했습니다. 범위를 나눠 붙여넣어 주세요.` })
      return
    }
    let clamped = false // §6-D 로컬 CELL_MAX 클램프
    const edits = editsRaw.map(e => (e.content.length > CELL_MAX ? (clamped = true, { ...e, content: e.content.slice(0, CELL_MAX) }) : e))
    if (clamped) toast({ title: '내용이 잘렸습니다', variant: 'info', description: '일부 셀 내용이 최대 길이(20,000자)를 넘어 잘라냈습니다.' })

    // undo용 before 스냅샷(③ 낙관 적용 전 현재 값). 사라진 행은 스킵.
    const before: WeeklyCellEdit[] = []
    if (opts.undoable) {
      for (const e of edits) {
        const row = rowsRef.current.find(r => r.id === e.rowId)
        if (row) before.push({ rowId: e.rowId, cellKey: e.cellKey, content: row[CELL_FIELD[e.cellKey]] })
      }
    }
    // ① per-cell 디바운스/재시도 타이머 클리어(회귀 #1)
    for (const e of edits) {
      const k = `${e.rowId}:${e.cellKey}`
      const t = timersRef.current.get(k)
      if (t) { clearTimeout(t); timersRef.current.delete(k) }
      retriedRef.current.delete(k)
    }
    // ② dirty 마킹(반드시 ③ 낙관 적용보다 먼저 — 인바운드 Realtime 클로버링 방지, 회귀 #2)
    for (const e of edits) dirtyRef.current.add(`${e.rowId}:${e.cellKey}`)
    // ③ 로컬 rows 낙관 적용 + status 'saving'(textarea 자동 높이는 value 변화로 재계산, 회귀 #7)
    setRows(rs => rs.map(r => {
      const mine = edits.filter(e => e.rowId === r.id)
      if (mine.length === 0) return r
      const next = { ...r }
      for (const e of mine) next[CELL_FIELD[e.cellKey]] = e.content
      return next
    }))
    setStatus(s => { const n = { ...s }; for (const e of edits) n[`${e.rowId}:${e.cellKey}`] = 'saving'; return n })
    // ④ undo 스택 push(undoable만 — undo/redo 유발 배치는 생략, 계약 §2-④)
    if (opts.undoable && before.length) {
      const keys = new Set(before.map(b => `${b.rowId}:${b.cellKey}`))
      const after = edits.filter(e => keys.has(`${e.rowId}:${e.cellKey}`))
      undoRef.current = pushUndo(undoRef.current, { before, after })
    }
    // 배치 칩(§5): 진행 칩 300ms delayed-show, per-cell 배지 억제
    batchInFlightRef.current += 1
    setBatchActive(true)
    if (batchShowTimerRef.current) clearTimeout(batchShowTimerRef.current)
    batchShowTimerRef.current = setTimeout(() => {
      if (batchInFlightRef.current > 0) setBatchChip({ phase: 'saving', count: edits.length })
    }, 300)

    // ⑤ 서버 호출 + 전송 시점 값 스냅샷(sent). send는 재시도마다 edits/sent를 새로 받는다(F4).
    const settle = () => {
      batchInFlightRef.current = Math.max(0, batchInFlightRef.current - 1)
      if (batchInFlightRef.current === 0 && batchShowTimerRef.current) { clearTimeout(batchShowTimerRef.current); batchShowTimerRef.current = null }
    }
    const send = (sendEdits: WeeklyCellEdit[], attempt: number) => {
      const sent = new Map(sendEdits.map(e => [`${e.rowId}:${e.cellKey}`, e.content]))
      // .catch: 오프라인·전송 계층 예외를 ok:false로 흡수 → 실패 경로(재시도·에러 칩)로 합류. 미포착 시
      // batchInFlightRef 미복귀·batchActive 영구 true·dirty 영구 잔류로 flush가 매번 타임아웃(F2).
      saveWeeklyCells(projectId, sendEdits)
        .catch((): WeeklyBatchResult => ({ ok: false, error: '네트워크 오류로 저장하지 못했습니다.' }))
        .then(res => {
          // ⑥ 응답 처리
          if (res.ok) {
            settle()
            lastFailedBatchRef.current = null
            const gone = new Set(res.goneRowIds ?? [])
            for (const g of gone) cleanupRowKeys(g)
            if (gone.size) setRows(rs => rs.filter(r => !gone.has(r.id)))
            for (const [k, sv] of sent) {
              const [rowId, key] = k.split(':') as [string, WeeklyCellKey]
              if (gone.has(rowId)) continue
              const now = rowsRef.current.find(r => r.id === rowId)?.[CELL_FIELD[key]]
              if (now === sv) { dirtyRef.current.delete(k); setStatus(s => ({ ...s, [k]: 'saved' })) }
              // 다르면(비행 중 재편집) dirty 유지 — per-cell 타이머가 마저 저장(단건 commit과 동형)
            }
            if (batchInFlightRef.current === 0) {
              setBatchChip({ phase: 'saved', count: sendEdits.length }) // 저장됨 최소 800ms 유지 후 정리
              setTimeout(() => {
                setBatchChip(c => (c && c.phase === 'saved' ? null : c))
                if (batchInFlightRef.current === 0) setBatchActive(false)
              }, 800)
            }
          } else {
            setStatus(s => { const n = { ...s }; for (const k of sent.keys()) n[k] = 'error'; return n }) // dirty 유지
            if (attempt === 0) { // 자동 재시도 1회 — 그 사이 성공한 단건 저장을 stale 값으로 역전하지 않게 현재값 재스냅샷(F4)
              setTimeout(() => {
                const next = rebuildForRetry(sendEdits)
                if (next.length === 0) { settle(); setBatchChip(null); if (batchInFlightRef.current === 0) setBatchActive(false); return }
                send(next, 1)
              }, 2000)
              return
            }
            settle()
            lastFailedBatchRef.current = sendEdits
            setBatchChip({ phase: 'error', count: sendEdits.length })
            setBatchActive(false) // 억제 해제 — per-cell 재시도 배지 재개(칩은 활성 셀에 배치 재시도로 상주). batchActive 영구 true 방지.
            toast({ title: '저장 실패', variant: 'error', description: "일부 셀을 저장하지 못했습니다. 상태 표시의 '재시도'를 눌러 주세요." })
          }
        })
    }
    send(edits, 0)
  }, [projectId, toast, cleanupRowKeys, rebuildForRetry])

  const retryBatch = useCallback(() => {
    const failed = lastFailedBatchRef.current
    if (!failed) return
    lastFailedBatchRef.current = null
    setBatchChip(null)
    const next = rebuildForRetry(failed) // 현재값 재스냅샷 + 이미 저장된/사라진 셀 제외(F4)
    if (next.length === 0) { setBatchActive(false); return } // 되돌릴 것 없음 → 성공 처리
    runBatch(next, { undoable: false }) // 재시도는 새 undo 엔트리를 만들지 않음
  }, [runBatch, rebuildForRetry])

  const requestUndo = useCallback((): boolean => {
    const r = undoOp(undoRef.current)
    if (!r) return false
    undoRef.current = r.state
    runBatch(r.apply, { undoable: false })
    return true
  }, [runBatch])
  const requestRedo = useCallback((): boolean => {
    const r = redoOp(undoRef.current)
    if (!r) return false
    undoRef.current = r.state
    runBatch(r.apply, { undoable: false })
    return true
  }, [runBatch])

  // 편집 세션 진입 — baseline/wasDirty 스냅샷(Esc 복원·undo push 판정용). 덮어쓰기 초기화는 훅이 담당.
  const beginEdit = useCallback((addr: CellAddr) => {
    const k = `${addr.rowId}:${addr.col}`
    if (editSessionRef.current?.key === k) return // 같은 셀에 진행 중 세션 — baseline 재캡처 금지(R-1: IME 폴백 등 재진입 레이스 구조적 차단)
    const row = rowsRef.current.find(r => r.id === addr.rowId)
    editSessionRef.current = { key: k, baseline: row ? row[CELL_FIELD[addr.col]] : '', wasDirty: dirtyRef.current.has(k) }
  }, [])

  // 편집 세션 종료 — cancel=원값 복원(회귀 #12), commit=변경 시 undo 크기1 push(AC6.5) + 즉시 저장.
  const endEdit = useCallback((addr: CellAddr, opts: { cancel: boolean }) => {
    const k = `${addr.rowId}:${addr.col}`
    const sess = editSessionRef.current
    if (!sess || sess.key !== k) return // 이미 소비됨/다른 셀
    editSessionRef.current = null
    const cur = rowsRef.current.find(r => r.id === addr.rowId)?.[CELL_FIELD[addr.col]] ?? ''
    if (opts.cancel) {
      if (cur !== sess.baseline) {
        // 로컬 원값 복원 + 서버 재영속화(AC3.2). 편집 세션 중 1.5s 디바운스 commit이 이미 입력값을 서버에
        // 저장했을 수 있고, 그러면 자기 Realtime 에코가 dirty 없음으로 입력값을 재채택해 취소가 무효화된다.
        setRows(rs => rs.map(r => (r.id === addr.rowId ? { ...r, [CELL_FIELD[addr.col]]: sess.baseline } : r)))
        dirtyRef.current.add(k) // 재영속화 우선 — wasDirty=false여도 dirty를 지우지 않는다
        const t = timersRef.current.get(k); if (t) clearTimeout(t)
        // 0ms 지연: 위 setRows 플러시 후 rowsRef가 baseline을 반영한 다음 commit이 그 값을 전송하게 하는 장치.
        // 서버에 저장분이 없어도 동일 값 멱등 재저장 1회라 무해.
        timersRef.current.set(k, setTimeout(() => commit(addr.rowId, addr.col), 0))
      } else if (!sess.wasDirty) { // 변경 없음 + 진입 시 clean → dirty/타이머/상태 흔적 제거(회귀 #12)
        dirtyRef.current.delete(k)
        const t = timersRef.current.get(k); if (t) { clearTimeout(t); timersRef.current.delete(k) }
        setStatus(s => { if (!(k in s)) return s; const n = { ...s }; delete n[k]; return n })
      }
      return
    }
    if (cur !== sess.baseline) {
      undoRef.current = pushUndo(undoRef.current, {
        before: [{ rowId: addr.rowId, cellKey: addr.col, content: sess.baseline }],
        after: [{ rowId: addr.rowId, cellKey: addr.col, content: cur }],
      })
    }
    commit(addr.rowId, addr.col) // 디바운스 우회 즉시 저장
  }, [commit])

  const handleCellBlur = useCallback((addr: CellAddr) => {
    const k = `${addr.rowId}:${addr.col}`
    if (editSessionRef.current && editSessionRef.current.key === k) endEdit(addr, { cancel: false })
    else commit(addr.rowId, addr.col)
  }, [endEdit, commit])

  const grid = useSheetGrid({
    rows, enabled: !!report && rows.length > 0, cellRefs,
    runBatch, requestUndo, requestRedo, beginEdit, endEdit, toast,
  })

  // 프레즌스 — 같은 주차 문서를 보는 다른 사용자의 위치/편집 상태(구글시트의 색상 커서 대응).
  // 훅 규칙: 아래 EmptyState 조기 return보다 반드시 먼저 호출(렌더마다 훅 순서 고정).
  const presencePeers = usePresence({
    reportId, me,
    active: rows.length ? grid.sel.active : null,
    editing: grid.sel.editing,
    enabled: !!report && !!me,
  })
  const presenceByCell = useMemo(
    () => buildPresenceMap(presencePeers, me?.id ?? ''),
    [presencePeers, me?.id],
  )
  const online = useMemo(() => {
    // 본인 포함 전원 표시(사용자 결정). 본인은 presence 동기화 전에도 즉시 보이게 로컬로 선두 고정.
    const others = onlinePeers(presencePeers).filter(o => o.userId !== me?.id)
    return me ? [{ userId: me.id, name: me.name }, ...others] : others
  }, [presencePeers, me?.id, me?.name]) // eslint-disable-line react-hooks/exhaustive-deps -- me는 원시값으로 구독(객체 참조는 렌더마다 새것)

  // 언마운트 시 디바운스/재시도 타이머 정리 — 정리 안 하면 사라진 컴포넌트에 setState 호출됨.
  // 훅 규칙: 아래 EmptyState 조기 return보다 반드시 먼저 호출(렌더마다 훅 순서 고정).
  useEffect(() => () => {
    for (const t of timersRef.current.values()) clearTimeout(t)
    timersRef.current.clear()
    if (batchShowTimerRef.current) clearTimeout(batchShowTimerRef.current)
  }, [])

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
        <WeekNav projectId={projectId} weekStart={weekStart} weekLabel={weekLabel} exportDisabled onBeforeExport={flushPendingSaves} />
        <EmptyState
          icon={FileSpreadsheet}
          title={`${weekLabel} 시트가 없습니다`}
          description="이전 주차에서 이월하거나 기본 시트(공통·ERP·MES 모듈)로 시작하세요. 이월하면 이전 주의 차주계획이 이번 주 금주실적 초안으로 들어옵니다."
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
                기본 시트로 시작
              </button>
            </div>
          }
        />
      </div>
    )
  }

  // ── 구글시트 복제 룩: 흰 종이 + 검정 얇은 테두리 + 회색 2단 헤더 + 병합 셀.
  //    시트는 '문서'라 다크모드에서도 항상 밝게(고정 색상, 앱 토큰 미사용).
  const HDR = 'border border-neutral-500 bg-[#d9d9d9] px-1 py-1.5 text-center text-[13px] font-bold text-black'

  // 선택/채우기 사각 — 셀 단위 틴트·외곽선·핸들을 선언적으로 그린다(측정 없음, 회귀 #7).
  const gr = grid.rect
  const fp = grid.fillPreview
  const isMulti = !!gr && (gr.bottom > gr.top || gr.right > gr.left)

  // 온라인 스트립 — 같은 주차를 보는 다른 사용자를 구글 문서식 원형 아바타(이름 2자)로 겹쳐 표시.
  // 혼자면 아무것도 표시하지 않는다. 전체 이름은 각 원의 title(툴팁)로.
  const presenceStrip = online.length > 0 ? (
    <div className="flex items-center" title={`함께 보는 중: ${online.map(o => o.name).join(', ')}`}>
      {online.slice(0, 5).map(o => (
        <span key={o.userId} title={o.userId === me?.id ? `${o.name} (나)` : o.name}
          className="-ml-1.5 flex h-7 w-7 select-none items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-canvas first:ml-0"
          style={{ background: presenceColor(o.userId) }}>
          {avatarLabel(o.name)}
        </span>
      ))}
      {online.length > 5 && (
        <span className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-neutral-500 text-[10px] font-bold text-white ring-2 ring-canvas">
          +{online.length - 5}
        </span>
      )}
    </div>
  ) : null

  return (
    <div className="space-y-3">
      <WeekNav projectId={projectId} weekStart={weekStart} weekLabel={weekLabel} exportDisabled={false} onBeforeExport={flushPendingSaves} presence={presenceStrip} />
      <div className="overflow-x-auto">
        <div className={`min-w-[1240px] bg-white p-1.5 shadow-sm ring-1 ring-neutral-300 ${grid.dragging === 'fill' ? 'cursor-crosshair select-none' : grid.dragging === 'select' ? 'cursor-cell select-none' : ''}`}>
          {/* 제목 행 — 레퍼런스 시트의 B1. 자유 편집(''이면 기본 제목 합성). key로 주차 전환 시 초기화 */}
          <TitleEditor
            key={report.id}
            initial={report.title}
            fallback={`▣ 주간업무보고 - ${projectName}(${weekTitle})`}
            onSave={async t => {
              const res = await saveWeeklyTitle(projectId, report.id, t)
              if (!res.ok) { toast({ title: '제목 저장 실패', description: res.error, variant: 'error' }); return false }
              router.refresh()
              return true
            }}
          />
          {/* 열 비율은 레퍼런스 실측(B8.38/C13.5/D58.63/E39.75/F41.13/G36)의 백분율 — 내용 열이 전폭을 쓴다 */}
          <table className="w-full table-fixed border-collapse bg-white text-[13px] text-black">
            <colgroup>
              <col className="w-[4.5%]" />   {/* 구분 */}
              <col className="w-[7%]" />     {/* 모듈 */}
              <col className="w-[29.5%]" />  {/* 금주 내용 */}
              <col className="w-[20%]" />    {/* 금주 이슈 */}
              <col className="w-[21%]" />    {/* 차주 내용 */}
              <col className="w-[18%]" />    {/* 차주 이슈 */}
              <col className="w-8" />        {/* 행 액션(시트 밖 여백처럼 무테두리) */}
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} className={HDR}>구분</th>
                <th rowSpan={2} className={HDR}>모듈</th>
                <th colSpan={2} className={HDR}>금주실적({thisRange})</th>
                <th colSpan={2} className={HDR}>차주계획({nextRange})</th>
                <th rowSpan={2} className="border-0 bg-white" />
              </tr>
              <tr>
                <th className={HDR}>내용</th>
                <th className={HDR}>이슈 및 주요 이벤트</th>
                <th className={HDR}>내용</th>
                <th className={HDR}>이슈 및 주요 이벤트</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="group">
                  {spans[i] > 0 && (
                    <td rowSpan={spans[i]} className="border border-neutral-500 p-0 align-middle">
                      <NameCombo
                        value={r.section}
                        options={[...WEEKLY_SECTIONS]}
                        onCommit={v => onRenameSection(rows.slice(i, i + spans[i]).map(x => x.id), v)}
                      />
                    </td>
                  )}
                  <td className="border border-neutral-500 p-0 align-middle">
                    <NameCombo
                      value={r.module}
                      options={moduleOptions(r.section)}
                      onCommit={v => onRenameModule(r.id, v)}
                    />
                  </td>
                  {COLS.map((c, j) => {
                    const addr: CellAddr = { rowId: r.id, col: c.key }
                    const active = grid.sel.active.rowId === r.id && grid.sel.active.col === c.key
                    const inRange = !!gr && i >= gr.top && i <= gr.bottom && j >= gr.left && j <= gr.right
                    const inFill = !!fp && i >= fp.top && i <= fp.bottom && j >= fp.left && j <= fp.right
                    const bg = fp && inFill && !inRange ? 'bg-[#e8f0fe]/60'
                      : isMulti && inRange && !active ? 'bg-[#e8f0fe]' : 'bg-white'
                    return (
                      // h-px: td에 명시 높이를 줘야 내부 h-full/min-h-full이 행 실제 높이로 해석된다(표 셀 스트레치 관례).
                      // 없으면 입력창이 자기 내용만큼만 높아져, 옆 셀이 큰 행에서 포커스 링이 셀 일부만 감싼다.
                      <td key={c.key} className={`h-px border border-neutral-500 p-0 align-top ${bg}`}>
                        <SheetCell
                          addr={addr}
                          value={r[CELL_FIELD[c.key]]}
                          ariaLabel={`${c.label}, ${r.section} ${r.module}`}
                          status={status[`${r.id}:${c.key}`]}
                          isActive={active}
                          editing={active && grid.sel.editing}
                          showBorder={isMulti && inRange}
                          edgeTop={!!gr && i === gr.top} edgeRight={!!gr && j === gr.right}
                          edgeBottom={!!gr && i === gr.bottom} edgeLeft={!!gr && j === gr.left}
                          showFillBorder={!!fp && inFill}
                          fillTop={!!fp && i === fp.top} fillRight={!!fp && j === fp.right}
                          fillBottom={!!fp && i === fp.bottom} fillLeft={!!fp && j === fp.left}
                          showFillHandle={!!gr && i === gr.bottom && j === gr.right && !grid.sel.editing && grid.dragging !== 'fill'}
                          batchActive={batchActive}
                          chip={active ? batchChip : null}
                          peers={presenceByCell.get(`${r.id}:${c.key}`) ?? null}
                          register={registerCell}
                          onChange={v => onCellChange(r.id, c.key, v)}
                          onBlur={e => { handleCellBlur(addr); grid.onCellBlurEvent(e) }}
                          onRetry={() => commit(r.id, c.key)}
                          onChipRetry={retryBatch}
                          onMouseDown={e => grid.onCellMouseDown(e, addr)}
                          onMouseEnter={() => grid.onCellMouseEnter(addr)}
                          onFocus={() => grid.onCellFocus(addr)}
                          onDoubleClick={grid.onCellDoubleClick}
                          onKeyDown={grid.onCellKeyDown}
                          onCopy={grid.onCellCopy}
                          onCut={grid.onCellCut}
                          onPaste={grid.onCellPaste}
                          onCompositionStart={grid.onCompositionStart}
                          onCompositionEnd={grid.onCompositionEnd}
                          onFillHandleMouseDown={grid.onFillHandleMouseDown}
                        />
                      </td>
                    )
                  })}
                  <td className="border-0 bg-white pl-1 align-top">
                    <div className="flex flex-col gap-1 pt-1 text-neutral-300 opacity-0 transition group-hover:opacity-100">
                      <button title="위로" className="hover:text-neutral-700" onClick={() => runAction(() => moveWeeklyRow(projectId, r.id, 'up'))}><ArrowUp className="h-4 w-4" /></button>
                      <button title="아래로" className="hover:text-neutral-700" onClick={() => runAction(() => moveWeeklyRow(projectId, r.id, 'down'))}><ArrowDown className="h-4 w-4" /></button>
                      <button title="행 삭제" className="hover:text-red-600"
                        onClick={() => { if (confirm(`'${r.module || r.section || '이'}' 행을 삭제할까요? 셀 내용도 함께 지워집니다.`)) runAction(() => deleteWeeklyRow(projectId, r.id)) }}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <AddRowForm disabled={isPending} onAdd={(section, module) => runAction(() => addWeeklyRow(projectId, report.id, section, module))} />
          {/* 선택/배치 결과 방송(§7) — 시각적 숨김 */}
          <div aria-live="polite" className="sr-only">{grid.live}</div>
        </div>
      </div>
    </div>
  )
}

function WeekNav({ projectId, weekStart, weekLabel, exportDisabled, onBeforeExport, presence }: {
  projectId: string; weekStart: string; weekLabel: string; exportDisabled: boolean
  onBeforeExport: () => Promise<boolean>
  presence?: React.ReactNode // 온라인 사용자 스트립(프레즌스) — 내보내기 버튼 왼쪽
}) {
  const base = `/p/${projectId}/weekly`
  return (
    // 근태현황·회의일정과 동일한 스크롤 상단 고정. z-40: 시트 셀 오버레이(배지/핸들 z-30)보다 위.
    <div className="sticky top-0 z-40 -mx-1 flex items-center justify-between bg-canvas/95 px-1 pb-3 pt-1 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <Link href={`${base}?week=${shiftWeeks(weekStart, -1)}`} className="btn btn-ghost px-2" aria-label="이전 주">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <span className="min-w-40 text-center text-sm font-semibold text-ink">{weekLabel}</span>
        <Link href={`${base}?week=${shiftWeeks(weekStart, 1)}`} className="btn btn-ghost px-2" aria-label="다음 주">
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="flex items-center gap-3">
        {presence}
        <ExportPptButton projectId={projectId} weekStart={weekStart} disabled={exportDisabled} onBeforeExport={onBeforeExport} />
      </div>
    </div>
  )
}

/** 주간보고 PPT — 프로젝트 PPT 양식(weekly-template.pptx: 디자인·폰트·글꼴)을 채워 다운로드.
 *  fetch로 받아 400(빈 시트 등)을 Toast로 안내(스펙 §7). onBeforeExport로 미저장 셀을 먼저
 *  flush — false(중단)면 fetch 없이 종료. */
function ExportPptButton({ projectId, weekStart, disabled, onBeforeExport }: {
  projectId: string; weekStart: string; disabled: boolean; onBeforeExport: () => Promise<boolean>
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const onExport = async () => {
    setBusy(true)
    try {
      const canExport = await onBeforeExport()
      if (!canExport) return
      const res = await fetch(`/api/report?projectId=${projectId}&format=pptx&source=sheet&week=${weekStart}`)
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null
        toast({ title: 'PPT 생성 실패', description: err?.error ?? `오류 (${res.status})`, variant: 'error' })
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
      <Download className="mr-1 h-4 w-4" />주간보고상세 (PPT)
    </button>
  )
}

/** 시트 제목 편집기 — 레퍼런스 B1 룩(볼드·검정)의 borderless input. blur 시 변경분만 저장.
 *  기본 제목과 같은 값은 ''로 저장해 주차가 바뀌어도 기본 제목이 자연히 따라오게 한다.
 *  savedRef는 저장 '성공' 후에만 전진 — 실패 시 같은 값 blur로 재시도가 가능해야 한다(리뷰 확정).
 *  서버 제목 변경(타 사용자)은 router.refresh로 내려온 initial을 비포커스 상태에서만 채택. */
function TitleEditor({ initial, fallback, onSave }: {
  initial: string; fallback: string; onSave: (title: string) => Promise<boolean>
}) {
  const [v, setV] = useState(initial || fallback)
  const savedRef = useRef(initial || fallback)
  const focusedRef = useRef(false)
  useEffect(() => {
    const server = initial || fallback
    if (!focusedRef.current && server !== savedRef.current) { savedRef.current = server; setV(server) }
  }, [initial, fallback])
  const onBlur = async () => {
    focusedRef.current = false
    const t = v.trim()
    if (t === '') setV(fallback)
    const next = t === '' || t === fallback ? fallback : t
    if (next === savedRef.current) return
    if (await onSave(next === fallback ? '' : next)) savedRef.current = next
  }
  return (
    <input
      value={v} onChange={e => setV(e.target.value)} onBlur={onBlur}
      onFocus={() => { focusedRef.current = true }}
      maxLength={200} aria-label="시트 제목"
      className="w-full border-0 bg-white px-0.5 pb-1.5 pt-0.5 text-[15px] font-extrabold text-black outline-none placeholder:text-neutral-400 focus:outline focus:outline-2 focus:-outline-offset-1 focus:outline-[#1a73e8]"
    />
  )
}

/** 구분·모듈 콤보박스 — 시트 셀 룩의 select. 목록 밖 현재값은 선두 옵션으로 노출하고,
 *  '직접 입력…' 선택 시 인라인 input으로 전환(Enter/blur 커밋, Esc 취소)해 자유 값도 허용. */
function NameCombo({ value, options, onCommit, fieldClassName }: {
  value: string; options: string[]; onCommit: (v: string) => void
  fieldClassName?: string // 폼 등 셀 밖에서 쓸 때의 추가 스타일(테두리 등)
}) {
  const [custom, setCustom] = useState<string | null>(null) // null=select 모드, 문자열=직접 입력 중
  const base = 'h-full min-h-9 w-full rounded-none bg-white text-center text-[13px] font-bold text-black outline-none focus:outline focus:outline-2 focus:-outline-offset-1 focus:outline-[#1a73e8]'
  if (custom !== null) {
    const commit = () => {
      const t = custom.trim()
      setCustom(null)
      if (t && t !== value) onCommit(t)
    }
    return (
      <input
        autoFocus value={custom} onChange={e => setCustom(e.target.value)} onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
          if (e.key === 'Escape') setCustom(null)
        }}
        className={`${base} border-0 px-1 ${fieldClassName ?? ''}`}
      />
    )
  }
  return (
    <div className="group/combo relative h-full">
      <select
        value={value}
        onChange={e => {
          if (e.target.value === CUSTOM) setCustom(value)
          else if (e.target.value !== value) onCommit(e.target.value)
        }}
        className={`${base} cursor-pointer appearance-none border-0 ${fieldClassName ?? ''}`}
      >
        {!options.includes(value) && <option value={value}>{value}</option>}
        {options.map(o => <option key={o} value={o}>{o}</option>)}
        <option value={CUSTOM}>직접 입력…</option>
      </select>
      <ChevronDown className="pointer-events-none absolute right-0.5 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400 opacity-0 transition group-hover/combo:opacity-100" />
    </div>
  )
}

function AddRowForm({ disabled, onAdd }: { disabled: boolean; onAdd: (section: string, module: string) => void }) {
  const [section, setSection] = useState<string>(WEEKLY_SECTIONS[1]) // ERP — 모듈이 가장 많은 구분
  const [module, setModule] = useState<string>(moduleOptions(WEEKLY_SECTIONS[1])[0])
  const field = 'border border-neutral-400'
  const pickSection = (v: string) => {
    setSection(v)
    const opts = moduleOptions(v)
    if (!opts.includes(module)) setModule(opts[0] ?? '')
  }
  return (
    <div className="flex items-center gap-2 pt-1.5 text-[13px]">
      <Plus className="h-4 w-4 text-neutral-400" />
      <div className="w-28"><NameCombo value={section} options={[...WEEKLY_SECTIONS]} onCommit={pickSection} fieldClassName={field} /></div>
      <div className="w-40"><NameCombo value={module} options={moduleOptions(section, module)} onCommit={setModule} fieldClassName={field} /></div>
      <button
        className="h-9 border border-neutral-400 bg-white px-2 text-[13px] text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-40"
        disabled={disabled || !module.trim()}
        onClick={() => onAdd(section, module)}>
        모듈 추가
      </button>
    </div>
  )
}

