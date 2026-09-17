// src/components/agents/Sprite.tsx
import type React from 'react'
import type { AnimName, CharacterName } from '@/lib/domain/seatState'
import css from './seatmap.module.css'

/**
 * 프레임 수는 public/sprites/manifest.json 과 같은 값이다(2026-09-16 새 시트에서 실측).
 * 런타임 fetch 대신 상수로 둔다 — 스프라이트를 다시 자르면 manifest 와 이 표를 같이 고친다.
 * 원화에 등간격 격자가 없어 프레임 수가 시트마다 다르다: 기지개는 강아지만 6장, 나머지 넷은 5장.
 */
const BASE_FRAMES: Record<AnimName, number> = {
  design: 4, typing: 4, verify: 4, refactor: 4,
  idle_coffee: 6, idle_stretch: 5, idle_look: 6,
  blocked: 4, stale: 4, rejected: 4, empty: 1,
}
const FRAME_OVERRIDE: Partial<Record<CharacterName, Partial<Record<AnimName, number>>>> = {
  dog: { idle_stretch: 6 },
}

/** 동작마다 다른 재생 속도. 캐릭터와 무관하다. */
const BASE_FPS: Record<AnimName, number> = {
  design: 6, typing: 8, verify: 4, refactor: 6,
  idle_coffee: 4, idle_stretch: 4, idle_look: 3,
  blocked: 4, stale: 2, rejected: 6, empty: 1,
}
/** 전체 재생 속도 배율 — 사용자 요청(2026-09-17)으로 절반으로 늦췄다. 한 숫자만 만지면 전부 따라온다. */
const SPEED = 0.5

/** 글자·기호가 그려진 동작 — 오른쪽 줄에서 좌우를 뒤집으면 거꾸로 읽힌다. CSS 가 이 표시를 보고 되돌린다. */
const HAS_GLYPH: ReadonlySet<AnimName> = new Set<AnimName>(['blocked', 'stale', 'rejected'])

/**
 * 되감아 재생하는 동작(1 2 3 4 4 3 2 1) — 마지막에서 처음으로 튀는 이음매가 없어진다.
 * stale 만이다. 엎드렸다 일어나며 zzz 가 커지는 한 방향 동작이라 4→1 이 그 스트립에서 가장 큰
 * 이음매이고(다섯 시트 −15~−29%), 1번과 4번이 서로 가장 먼 두 장이라 양 끝에서 한 번 더
 * 머무는 것이 동작에 맞는다. 다른 아홉은 양 끝이 극단이 아니라 얻는 것 없이 주기만 두 배가 된다
 * — 특히 blocked 는 없앨 이음매가 아예 없고 말풍선이 나타났다 사라지는 흐름만 되풀이된다.
 */
const ALTERNATE: ReadonlySet<AnimName> = new Set<AnimName>(['stale'])

export function framesOf(character: CharacterName, anim: AnimName): number {
  return FRAME_OVERRIDE[character]?.[anim] ?? BASE_FRAMES[anim]
}

export function Sprite({ character, anim, reduceMotion = false }: { character: CharacterName; anim: AnimName; reduceMotion?: boolean }) {
  const frames = framesOf(character, anim)
  const src = anim === 'empty' ? '/sprites/empty.png' : `/sprites/${character}/${anim}.png`
  return (
    <span
      data-sprite="" data-frames={String(frames)} data-still={reduceMotion ? '1' : undefined}
      data-glyph={HAS_GLYPH.has(anim) ? '1' : undefined}
      data-alt={ALTERNATE.has(anim) ? '1' : undefined}
      className={css.sprite} aria-hidden="true"
      style={{ backgroundImage: `url(${src})`, '--frames': String(frames), '--fps': String(BASE_FPS[anim] * SPEED) } as React.CSSProperties}
    />
  )
}
