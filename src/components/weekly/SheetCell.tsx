'use client'

import { useEffect, useRef } from 'react'
import { RefreshCw } from 'lucide-react'
import type { CellAddr } from '@/lib/domain/sheetSelection'

export type CellStatus = 'saving' | 'saved' | 'error'
/** 배치 변이 중 활성 셀에 뜨는 집계 칩(§5) — 개별 배지 대신 하나만. */
export interface BatchChip { phase: 'saving' | 'saved' | 'error'; count: number }

export interface SheetCellProps {
  addr: CellAddr
  value: string
  ariaLabel: string
  status?: CellStatus
  isActive: boolean
  editing: boolean // isActive && 편집 모드
  // L2 실선 외곽(선택 범위) — 다중 선택 시 가장자리별.
  showBorder: boolean
  edgeTop: boolean; edgeRight: boolean; edgeBottom: boolean; edgeLeft: boolean
  // L2 점선 외곽(채우기 드래그 미리보기).
  showFillBorder: boolean
  fillTop: boolean; fillRight: boolean; fillBottom: boolean; fillLeft: boolean
  showFillHandle: boolean
  batchActive: boolean // true면 per-cell 배지 억제(활성 셀 칩만 노출)
  chip: BatchChip | null // 활성 셀에만 전달
  register: (key: string, el: HTMLTextAreaElement | null) => void
  onChange: (v: string) => void
  onBlur: (e: React.FocusEvent) => void
  onRetry: () => void // per-cell 단건 재시도
  onChipRetry: () => void // 배치 재시도
  onMouseDown: (e: React.MouseEvent) => void
  onMouseEnter: () => void
  onFocus: () => void
  onDoubleClick: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onCopy: (e: React.ClipboardEvent) => void
  onCut: (e: React.ClipboardEvent) => void
  onPaste: (e: React.ClipboardEvent) => void
  onCompositionStart: () => void
  onCompositionEnd: () => void
  onFillHandleMouseDown: (e: React.MouseEvent) => void
}

export function SheetCell(p: SheetCellProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const k = `${p.addr.rowId}:${p.addr.col}`
  const { register } = p

  useEffect(() => { // 활성 셀 포커스 관리를 위해 부모 맵에 DOM 등록/해제
    register(k, ref.current)
    return () => register(k, null)
  }, [k, register])

  useEffect(() => { // 자동 높이(회귀 #7 — rows 값 변화를 그대로 추종)
    const el = ref.current
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }
  }, [p.value])

  return (
    <div className="relative h-full" onMouseDown={p.onMouseDown} onMouseEnter={p.onMouseEnter} onDoubleClick={p.onDoubleClick}>
      {/* 배경(L0)은 <td>가 담당 → textarea는 bg-transparent라 틴트가 비쳐 보임(§0). */}
      <textarea
        ref={ref} value={p.value} rows={3} aria-label={p.ariaLabel} data-sheet-cell="1"
        style={{ caretColor: p.editing ? '#000' : 'transparent' }}
        className={`block min-h-24 w-full resize-none select-text rounded-none border-0 bg-transparent p-1.5 text-[13px] leading-[1.5] text-black outline-none focus:relative focus:z-10 focus:outline focus:outline-2 focus:-outline-offset-1 focus:outline-[#1a73e8] ${p.editing ? 'cursor-text' : 'cursor-cell'} ${p.editing ? 'shadow-[0_2px_6px_rgba(60,64,67,0.28)]' : ''}`}
        onChange={e => p.onChange(e.target.value)}
        onBlur={p.onBlur}
        onFocus={p.onFocus}
        onKeyDown={p.onKeyDown}
        onCopy={p.onCopy}
        onCut={p.onCut}
        onPaste={p.onPaste}
        onCompositionStart={p.onCompositionStart}
        onCompositionEnd={p.onCompositionEnd}
      />
      {p.showBorder && (
        <div className="pointer-events-none absolute inset-0 z-20 border-solid border-[#1a73e8]"
          style={{ borderTopWidth: p.edgeTop ? 2 : 0, borderRightWidth: p.edgeRight ? 2 : 0, borderBottomWidth: p.edgeBottom ? 2 : 0, borderLeftWidth: p.edgeLeft ? 2 : 0 }} />
      )}
      {p.showFillBorder && (
        <div className="pointer-events-none absolute inset-0 z-20 border-dashed border-[#1a73e8]"
          style={{ borderTopWidth: p.fillTop ? 2 : 0, borderRightWidth: p.fillRight ? 2 : 0, borderBottomWidth: p.fillBottom ? 2 : 0, borderLeftWidth: p.fillLeft ? 2 : 0 }} />
      )}
      {p.showFillHandle && (
        <div
          className="absolute bottom-0 right-0 z-30 hidden translate-x-1/2 translate-y-1/2 cursor-crosshair p-1 [@media(pointer:fine)]:block"
          onMouseDown={p.onFillHandleMouseDown}
          aria-hidden
        >
          <div className="h-1.5 w-1.5 border border-white bg-[#1a73e8]" />
        </div>
      )}
      <span className="absolute right-1 top-0.5 z-30 text-[10px]">
        {p.chip ? (
          p.chip.phase === 'saving' ? <span className="text-[#9aa0a6]">{p.chip.count}개 셀 저장 중…</span>
            : p.chip.phase === 'saved' ? <span className="text-[#188038]">저장됨</span>
              : <button className="flex items-center gap-0.5 text-[#d93025]" onClick={p.onChipRetry} title="다시 저장"><RefreshCw className="h-3 w-3" />{p.chip.count}개 셀 저장 실패 · 재시도</button>
        ) : (!p.batchActive && (
          <>
            {p.status === 'saving' && <span className="text-[#9aa0a6]">저장 중…</span>}
            {p.status === 'saved' && <span className="text-[#188038]">저장됨</span>}
            {p.status === 'error' && (
              <button className="flex items-center gap-0.5 text-[#d93025]" onClick={p.onRetry} title="다시 저장"><RefreshCw className="h-3 w-3" />재시도</button>
            )}
          </>
        ))}
      </span>
    </div>
  )
}
