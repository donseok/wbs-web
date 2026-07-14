'use client'

import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

type Side = 'top' | 'right' | 'bottom' | 'left'

/** 버블을 트리거 기준으로 정렬하기 위한 transform 원점 보정. */
const ANCHOR: Record<Side, string> = {
  top: '-translate-x-1/2 -translate-y-full',
  bottom: '-translate-x-1/2',
  left: '-translate-x-full -translate-y-1/2',
  right: '-translate-y-1/2',
}

type TooltipProps = {
  /** 버블에 표시할 내용. 비어 있으면 툴팁이 뜨지 않는다. */
  label: ReactNode
  /** 트리거 기준 방향 (기본 top). 접힌 사이드바는 right 권장. */
  side?: Side
  /** 표시 지연(ms). 네이티브 title(~1s)보다 빠르게. */
  delay?: number
  /** true면 툴팁을 완전히 끈다(예: 라벨이 이미 보이는 펼침 상태). */
  disabled?: boolean
  /** 단일 자식 엘리먼트(Link/button 등). 래퍼 없이 핸들러만 주입한다. */
  children: ReactElement
}

/**
 * 풍선 도움말(툴팁). 래퍼 DOM 없이 자식에 이벤트만 얹고, 버블은 body 포털로
 * fixed 렌더한다 — 사이드바의 overflow 클리핑을 피하기 위함. hover와 keyboard
 * focus 모두에서 뜨며, 색상은 ink/surface 토큰을 반전해 라이트·다크에서 대비를 유지한다.
 */
export function Tooltip({ label, side = 'top', delay = 350, disabled = false, children }: TooltipProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = useId()

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  if (!isValidElement(children)) return children

  const active = !disabled && label != null && label !== ''

  const open = (node: HTMLElement) => {
    if (!active || !node) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const r = node.getBoundingClientRect()
      const gap = 10
      let x: number, y: number
      switch (side) {
        case 'right': x = r.right + gap; y = r.top + r.height / 2; break
        case 'left': x = r.left - gap; y = r.top + r.height / 2; break
        case 'bottom': x = r.left + r.width / 2; y = r.bottom + gap; break
        default: x = r.left + r.width / 2; y = r.top - gap; break
      }
      setPos({ x, y })
    }, delay)
  }

  const close = () => {
    if (timer.current) clearTimeout(timer.current)
    setPos(null)
  }

  const props = children.props as Record<string, unknown> & {
    onMouseEnter?: (e: unknown) => void
    onMouseLeave?: (e: unknown) => void
    onFocus?: (e: unknown) => void
    onBlur?: (e: unknown) => void
    'aria-describedby'?: string
  }

  const trigger = cloneElement(children, {
    onMouseEnter: (e: { currentTarget: HTMLElement }) => { props.onMouseEnter?.(e); open(e.currentTarget) },
    onMouseLeave: (e: unknown) => { props.onMouseLeave?.(e); close() },
    onFocus: (e: { currentTarget: HTMLElement }) => { props.onFocus?.(e); open(e.currentTarget) },
    onBlur: (e: unknown) => { props.onBlur?.(e); close() },
    'aria-describedby': pos ? id : props['aria-describedby'],
  } as Record<string, unknown>)

  return (
    <>
      {trigger}
      {active && pos && typeof document !== 'undefined' && createPortal(
        <span
          role="tooltip"
          id={id}
          style={{ left: pos.x, top: pos.y }}
          className={`pointer-events-none fixed z-[200] ${ANCHOR[side]} max-w-[16rem] whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs font-semibold leading-tight text-surface shadow-lg ring-1 ring-black/10`}
        >
          {label}
        </span>,
        document.body,
      )}
    </>
  )
}
