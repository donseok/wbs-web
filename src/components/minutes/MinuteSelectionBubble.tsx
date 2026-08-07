'use client'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { CircleAlert, LoaderCircle } from 'lucide-react'
import { isMarkableBlock, type MinuteBlock } from '@/lib/minutes/blocks'
import {
  MINUTE_SELECTION_MAX_BLOCK_SPAN, MINUTE_SELECTION_MAX_CHARS, MINUTE_SELECTION_MIN_CHARS,
  matchMinuteSelection, stripSelectionWhitespace,
} from '@/lib/minutes/selection'
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
  /**
   * 같은 원문 대조 함수(matchMinuteSelection)를 클라에서 미리 실행해 얻은 서버 파생
   * 발췌 — 미리보기·폴백 초안이 저장될 발췌와 정확히 일치한다. 서버는 이 값을 신뢰하지
   * 않고 독립적으로 재계산한다.
   */
  excerpt: string
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

/** range 가 요소 안에서 실제로 덮는 텍스트 — 경계 앵커가 부풀린 블록(0자 기여)을 가려낸다. */
function rangeTextWithin(range: Range, el: HTMLElement): string {
  const scoped = range.cloneRange()
  const bounds = document.createRange()
  bounds.selectNodeContents(el)
  if (scoped.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) {
    scoped.setStart(bounds.startContainer, bounds.startOffset)
  }
  if (scoped.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) {
    scoped.setEnd(bounds.endContainer, bounds.endOffset)
  }
  return scoped.toString()
}

/**
 * 본문 드래그 선택 근처에 뜨는 '이슈로 등록' 버블 — 블록 팝오버(클릭)와 상보적인 진입점.
 * 선택 확정은 pointerup/keyup 에서만 판정해 드래그 중 재배치 깜빡임을 피하고,
 * 스크롤·리사이즈는 rAF 로 위치만 추적한다. 선택 해제 시 즉시 소멸.
 */
export function MinuteSelectionBubble({
  bodyRef, blocks, disabled, busy, onCreateIssue, onDismiss, onTargetChange,
}: {
  bodyRef: RefObject<HTMLDivElement | null>
  blocks: MinuteBlock[]
  disabled: boolean
  busy: boolean
  onCreateIssue: (target: MinuteSelectionTarget) => void
  /** 현재 선택된 블록 범위를 본문에 임시 하이라이트로 반영한다. */
  onTargetChange?: (target: MinuteSelectionTarget | null) => void
  /** 표출 중이던 버블이 바깥 클릭·선택 해제로 사라질 때 — 진행 중 요청 취소의 신호. */
  onDismiss?: () => void
}) {
  const { t } = useLocale()
  const [state, setState] = useState<BubbleState | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const visibleRef = useRef(false)
  const onDismissRef = useRef(onDismiss)
  const onTargetChangeRef = useRef(onTargetChange)
  useEffect(() => {
    visibleRef.current = state !== null
  }, [state])
  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])
  useEffect(() => {
    onTargetChangeRef.current = onTargetChange
  }, [onTargetChange])

  const readTarget = useCallback((): BubbleState | null => {
    const selection = window.getSelection()
    // Firefox 는 표 열 드래그 등에서 다중 Range 를 만든다 — 비연속 선택은 지원하지 않는다.
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null
    const range = selection.getRangeAt(0)
    const body = bodyRef.current
    if (!body || !body.contains(range.commonAncestorContainer)) return null
    const startEl = closestBlockElement(range.startContainer)
    const endEl = closestBlockElement(range.endContainer)
    if (!startEl || !endEl) return null
    let startIndex = Number(startEl.dataset.mblock)
    let endIndex = Number(endEl.dataset.mblock)
    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || endIndex < startIndex) {
      return null
    }
    const text = selection.toString()
    if (text.length > MINUTE_SELECTION_MAX_CHARS) return null
    if (stripSelectionWhitespace(text).length < MINUTE_SELECTION_MIN_CHARS) return null

    // 트리플클릭·문단 끝 넘김 드래그는 끝 앵커를 다음 블록의 offset 0 에 두는데(Chrome 계열
    // 통상 동작), 그 블록은 선택 문자를 1자도 기여하지 않아 서버 걸침 판정에서 거절된다.
    // 문자를 실제로 기여하는 블록까지 양 끝을 당겨서 보낸다.
    const contributionAt = (index: number): string => {
      const el = body.querySelector<HTMLElement>(`[data-mblock="${index}"]`)
      return el ? rangeTextWithin(range, el) : ''
    }
    while (endIndex > startIndex && !stripSelectionWhitespace(contributionAt(endIndex))) {
      endIndex -= 1
    }
    while (startIndex < endIndex && !stripSelectionWhitespace(contributionAt(startIndex))) {
      startIndex += 1
    }
    if (endIndex - startIndex > MINUTE_SELECTION_MAX_BLOCK_SPAN) return null

    const start = blocks[startIndex]
    const end = blocks[endIndex]
    if (!start || !end || !isMarkableBlock(start) || !isMarkableBlock(end)) return null
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
    // 서버와 같은 대조를 미리 실행 — 렌더 전용 텍스트(머메이드·이미지 alt 등)가 낀 선택은
    // 어차피 서버가 거절하므로 버블 자체를 띄우지 않고, 통과하면 저장될 발췌를 얻는다.
    const match = matchMinuteSelection(blocks, startIndex, start.hash, endIndex, end.hash, text)
    if (!match.ok) return null
    const rect = range.getBoundingClientRect()
    return {
      target: {
        startIndex, endIndex, startHash: start.hash, endHash: end.hash, text,
        excerpt: match.excerpt,
      },
      rect: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
    }
  }, [blocks, bodyRef])

  useEffect(() => {
    if (disabled) {
      setState(null)
      onTargetChangeRef.current?.(null)
      return
    }
    let frame = 0
    const evaluate = () => {
      const next = readTarget()
      setState(next)
      onTargetChangeRef.current?.(next?.target ?? null)
    }
    const evaluateSoon = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(evaluate)
    }
    const dismiss = () => {
      if (visibleRef.current) onDismissRef.current?.()
      setState(null)
      onTargetChangeRef.current?.(null)
    }
    const onPointerDown = (event: Event) => {
      // 버블 내부 pointerdown(버튼 클릭)은 선택을 유지해야 하므로 숨기지 않는다.
      if (event.target instanceof Node && boxRef.current?.contains(event.target)) return
      dismiss()
    }
    const onSelectionChange = () => {
      const selection = document.getSelection()
      if (!selection || selection.isCollapsed) dismiss()
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
