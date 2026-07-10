'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronLeft, ChevronRight, Download, Plus, Trash2, ArrowUp, ArrowDown, FileSpreadsheet, RefreshCw } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import {
  applyServerRow, moduleOptions, WEEKLY_CELL_KEYS, WEEKLY_SECTIONS,
  CELL_FIELD, type WeeklyCellKey, type WeeklySheetRow,
} from '@/lib/domain/weeklySheet'
import {
  addWeeklyRow, createWeeklyReport, deleteWeeklyRow, moveWeeklyRow,
  renameWeeklyModule, renameWeeklySection, saveWeeklyCell, saveWeeklyTitle,
} from '@/app/actions/weekly'
import { shiftWeeks } from '@/lib/report/week'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'

type CellStatus = 'saving' | 'saved' | 'error'
const DEBOUNCE_MS = 1500
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
  report, initialRows, hasCarrySource,
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
    saveWeeklyCell(projectId, rowId, key, sent).then(res => {
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

  // 언마운트 시 디바운스/재시도 타이머 정리 — 정리 안 하면 사라진 컴포넌트에 setState 호출됨.
  // 훅 규칙: 아래 EmptyState 조기 return보다 반드시 먼저 호출(렌더마다 훅 순서 고정).
  useEffect(() => () => {
    for (const t of timersRef.current.values()) clearTimeout(t)
    timersRef.current.clear()
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

  return (
    <div className="space-y-3">
      <WeekNav projectId={projectId} weekStart={weekStart} weekLabel={weekLabel} exportDisabled={false} onBeforeExport={flushPendingSaves} />
      <div className="overflow-x-auto">
        <div className="min-w-[1240px] bg-white p-1.5 shadow-sm ring-1 ring-neutral-300">
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
                  {COLS.map(c => (
                    <td key={c.key} className="border border-neutral-500 p-0 align-top">
                      <CellEditor
                        value={r[CELL_FIELD[c.key]]}
                        status={status[`${r.id}:${c.key}`]}
                        onChange={v => onCellChange(r.id, c.key, v)}
                        onBlur={() => commit(r.id, c.key)}
                        onRetry={() => commit(r.id, c.key)}
                      />
                    </td>
                  ))}
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
        </div>
      </div>
    </div>
  )
}

function WeekNav({ projectId, weekStart, weekLabel, exportDisabled, onBeforeExport }: {
  projectId: string; weekStart: string; weekLabel: string; exportDisabled: boolean
  onBeforeExport: () => Promise<boolean>
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
      <ExportPptButton projectId={projectId} weekStart={weekStart} disabled={exportDisabled} onBeforeExport={onBeforeExport} />
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
      <Download className="mr-1 h-4 w-4" />주간보고 (PPT)
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
      {/* 구글시트 셀 감각: 흰 배경·검정 글자·둥근모서리 없음, 포커스 시 파란 셀 테두리 */}
      <textarea
        ref={ref} value={value} rows={3}
        className="block min-h-24 w-full resize-none rounded-none border-0 bg-white p-1.5 text-[13px] leading-[1.5] text-black outline-none focus:relative focus:z-10 focus:outline focus:outline-2 focus:-outline-offset-1 focus:outline-[#1a73e8]"
        onChange={e => onChange(e.target.value)} onBlur={onBlur}
      />
      <span className="absolute right-1 top-0.5 text-[10px]">
        {status === 'saving' && <span className="text-[#9aa0a6]">저장 중…</span>}
        {status === 'saved' && <span className="text-[#188038]">저장됨</span>}
        {status === 'error' && (
          <button className="flex items-center gap-0.5 text-[#d93025]" onClick={onRetry} title="다시 저장">
            <RefreshCw className="h-3 w-3" />재시도
          </button>
        )}
      </span>
    </div>
  )
}
