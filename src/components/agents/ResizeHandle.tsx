'use client'
// 끌기 손잡이 — 포인터로 끌거나 키보드 방향키로 크기를 바꾼다(role="separator", WAI-ARIA 창 분리자 패턴).
// axis 'x' 는 세로 막대(폭 조절), 'y' 는 가로 막대(높이 조절)다. grow 는 값이 커지는 방향이다.
// 끄는 동안은 commit=false 로 값만 바꾸고, 놓거나 키를 누르면 commit=true 로 확정한다(저장은 부모가 확정 때만 한다).
import { useRef } from 'react'
import type React from 'react'

type Grow = 'left' | 'right' | 'up' | 'down'

const GROW_KEYS: Record<Grow, { grow: string; shrink: string }> = {
  left: { grow: 'ArrowLeft', shrink: 'ArrowRight' },
  right: { grow: 'ArrowRight', shrink: 'ArrowLeft' },
  up: { grow: 'ArrowUp', shrink: 'ArrowDown' },
  down: { grow: 'ArrowDown', shrink: 'ArrowUp' },
}

export function ResizeHandle({ grow, value, min, max, step, label, getStart, onChange, onReset, className }: {
  grow: Grow
  value: number; min: number; max: number; step: number
  label: string
  /** 끌기를 시작할 때의 기준 크기. 없으면 value 를 쓴다(기본 크기가 자동일 때 실제 크기를 재서 넘긴다). */
  getStart?: () => number
  onChange: (next: number, commit: boolean) => void
  onReset?: () => void
  className?: string
}) {
  const horizontal = grow === 'left' || grow === 'right' // 폭 조절 — 구분선은 세로로 선다
  const drag = useRef<{ from: number; origin: number; last: number } | null>(null)
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)))
  const delta = (e: React.PointerEvent, origin: number) => {
    const d = horizontal ? e.clientX - origin : e.clientY - origin
    return grow === 'left' || grow === 'up' ? -d : d
  }
  return (
    <div role="separator" tabIndex={0} aria-label={label} aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(value)} aria-valuemin={min} aria-valuemax={max}
      className={`touch-none select-none transition-colors hover:bg-brand-weak focus-visible:bg-brand-weak ${className ?? ''}`}
      onPointerDown={e => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture?.(e.pointerId)
        const from = getStart?.() ?? value
        drag.current = { from, origin: horizontal ? e.clientX : e.clientY, last: from }
      }}
      onPointerMove={e => {
        const d = drag.current
        if (!d) return
        d.last = clamp(d.from + delta(e, d.origin))
        onChange(d.last, false)
      }}
      onPointerUp={e => {
        const d = drag.current
        if (!d) return
        drag.current = null
        e.currentTarget.releasePointerCapture?.(e.pointerId)
        onChange(d.last, true)
      }}
      onPointerCancel={() => {
        const d = drag.current
        if (!d) return
        drag.current = null
        onChange(d.last, true)
      }}
      onDoubleClick={() => onReset?.()}
      onKeyDown={e => {
        const keys = GROW_KEYS[grow]
        const next = e.key === keys.grow ? value + step
          : e.key === keys.shrink ? value - step
            : e.key === 'Home' ? min
              : e.key === 'End' ? max
                : null
        if (next === null) return
        e.preventDefault()
        onChange(clamp(next), true)
      }}
    />
  )
}
