'use client'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { CircleAlert, LoaderCircle } from 'lucide-react'
import { isMarkableBlock, type MinuteBlock } from '@/lib/minutes/blocks'
import { MINUTE_SELECTION_MIN_CHARS, stripSelectionWhitespace } from '@/lib/minutes/selection'
import { useLocale } from '@/components/providers/LocaleProvider'

export interface MinuteSelectionTarget {
  startIndex: number
  endIndex: number
  startHash: string
  endHash: string
  /**
   * Selection.toString() 원본 — Range.toString() 과 달리 블록 경계 개행을 보존하는
   * 렌더 텍스트 근사라 여러 블록 발췌가 한 줄로 붙지 않는다. 정규화·검증은
   * 서버 계약(selection.ts)이 담당한다.
   */
  text: string
}

interface BubbleState {
  target: MinuteSelectionTarget
  rect: { top: number; bottom: number; left: number; width: number }
}

function closestBlockElement(node: Node | null): HTMLElement | null {
  if (!node) return null
  const el = node instanceof Element ? node : node.parentElement
  return el?.closest<HTMLElement>('[data-mblock]') ?? null
}

/**
 * 본문 드래그 선택 근처에 뜨는 '이슈로 등록' 버블 — 블록 팝오버(클릭)와 상보적인 진입점.
 * 선택 확정은 pointerup/keyup 에서만 판정해 드래그 중 재배치 깜빡임을 피하고,
 * 스크롤·리사이즈는 rAF 로 위치만 추적한다. 선택 해제 시 즉시 소멸.
 */
export function MinuteSelectionBubble({ bodyRef, blocks, disabled, busy, onCreateIssue }: {
  bodyRef: RefObject<HTMLDivElement | null>
  blocks: MinuteBlock[]
  disabled: boolean
  busy: boolean
  onCreateIssue: (target: MinuteSelectionTarget) => void
}) {
  const { t } = useLocale()
  const [state, setState] = useState<BubbleState | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const readTarget = useCallback((): BubbleState | null => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
    const range = selection.getRangeAt(0)
    const body = bodyRef.current
    if (!body || !body.contains(range.commonAncestorContainer)) return null
    const startEl = closestBlockElement(range.startContainer)
    const endEl = closestBlockElement(range.endContainer)
    if (!startEl || !endEl) return null
    const startIndex = Number(startEl.dataset.mblock)
    const endIndex = Number(endEl.dataset.mblock)
    const start = blocks[startIndex]
    const end = blocks[endIndex]
    if (!start || !end || endIndex < startIndex || !isMarkableBlock(start) || !isMarkableBlock(end)) {
      return null
    }
    const text = selection.toString()
    if (stripSelectionWhitespace(text).length < MINUTE_SELECTION_MIN_CHARS) return null
    // 제목만의 선택은 이슈가 될 수 없다 — 서버 규칙(선택 범위에 non-heading 필요)과 동일 게이트.
    let hasBody = false
    for (let index = startIndex; index <= endIndex; index += 1) {
      const candidate = blocks[index]
      if (candidate && isMarkableBlock(candidate) && !candidate.headingDepth) {
        hasBody = true
        break
      }
    }
    if (!hasBody) return null
    const rect = range.getBoundingClientRect()
    return {
      target: { startIndex, endIndex, startHash: start.hash, endHash: end.hash, text },
      rect: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
    }
  }, [blocks, bodyRef])

  useEffect(() => {
    if (disabled) {
      setState(null)
      return
    }
    let frame = 0
    const evaluate = () => setState(readTarget())
    const evaluateSoon = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(evaluate)
    }
    const onPointerDown = (event: Event) => {
      // 버블 내부 pointerdown(버튼 클릭)은 선택을 유지해야 하므로 숨기지 않는다.
      if (event.target instanceof Node && boxRef.current?.contains(event.target)) return
      setState(null)
    }
    const onSelectionChange = () => {
      const selection = document.getSelection()
      if (!selection || selection.isCollapsed) setState(null)
    }
    document.addEventListener('pointerup', evaluate)
    document.addEventListener('keyup', evaluate)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('scroll', evaluateSoon, true)
    window.addEventListener('resize', evaluateSoon)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerup', evaluate)
      document.removeEventListener('keyup', evaluate)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('scroll', evaluateSoon, true)
      window.removeEventListener('resize', evaluateSoon)
    }
  }, [disabled, readTarget])

  if (!state) return null
  const W = 180
  const H = 44
  const center = state.rect.left + state.rect.width / 2
  const left = Math.min(Math.max(8, center - W / 2), window.innerWidth - W - 8)
  const below = state.rect.bottom + 6 + H < window.innerHeight
  const top = below ? state.rect.bottom + 6 : Math.max(8, state.rect.top - 6 - H)
  return (
    <div
      ref={boxRef}
      style={{ position: 'fixed', top, left, width: W }}
      className="z-[95]"
      // 버튼 mousedown 이 브라우저 기본 동작으로 선택을 해제하는 것을 막는다.
      onPointerDown={event => event.preventDefault()}
    >
      <button
        onClick={() => onCreateIssue(state.target)}
        disabled={busy}
        className="btn btn-primary h-9 w-full shadow-[var(--shadow-lg)]"
      >
        {busy
          ? <LoaderCircle className="h-4 w-4 animate-spin" />
          : <CircleAlert className="h-4 w-4" />}
        {busy ? t('min.issue.summarizing') : t('min.sel.create')}
      </button>
    </div>
  )
}
