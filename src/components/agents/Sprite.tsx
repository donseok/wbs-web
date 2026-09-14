// src/components/agents/Sprite.tsx
import type React from 'react'
import type { AnimName, CharacterName } from '@/lib/domain/seatState'
import css from './seatmap.module.css'

/** public/sprites/<char>/manifest.json 과 같은 값. 런타임 fetch 대신 상수 — 4캐릭터가 전부 동일하다. */
const FRAMES: Record<AnimName, { frames: number; fps: number }> = {
  typing: { frames: 4, fps: 8 }, design: { frames: 4, fps: 6 }, verify: { frames: 4, fps: 4 }, refactor: { frames: 4, fps: 6 },
  stale: { frames: 4, fps: 2 }, idle_coffee: { frames: 6, fps: 4 }, idle_stretch: { frames: 6, fps: 4 }, idle_look: { frames: 6, fps: 3 },
  rejected: { frames: 4, fps: 6 }, empty: { frames: 1, fps: 1 },
}

export function Sprite({ character, anim, reduceMotion = false }: { character: CharacterName; anim: AnimName; reduceMotion?: boolean }) {
  const { frames, fps } = FRAMES[anim]
  const src = anim === 'empty' ? '/sprites/empty.png' : `/sprites/${character}/${anim}.png`
  return (
    <span
      data-sprite="" data-frames={String(frames)} data-still={reduceMotion ? '1' : undefined}
      className={css.sprite} aria-hidden="true"
      style={{ backgroundImage: `url(${src})`, '--frames': String(frames), '--fps': String(fps) } as React.CSSProperties}
    />
  )
}
