// 터미널 글 표시용 치환 — 보이지 않거나 글자 순서를 뒤집는 문자를 눈에 보이는 기호로 바꾼다(정상 글자는 그대로).
import { describe, expect, it } from 'vitest'
import { showableTerminalLine } from '@/lib/domain/safeDisplay'

const sym = (cp: number) => `⟨U+${cp.toString(16).toUpperCase().padStart(4, '0')}⟩`
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

describe('showableTerminalLine — 치환표', () => {
  const HIDDEN: number[] = [
    ...range(0x202A, 0x202E), ...range(0x2066, 0x2069), 0x200E, 0x200F, 0x061C, // 양방향 제어
    0x200B, 0x200C, ...range(0x2060, 0x2064), 0xFEFF, 0x00AD, 0x034F, 0x180E, // 폭 없는·숨는 문자
    0x2028, 0x2029, // 줄 구분
  ]
  it.each(HIDDEN)('U+%i 는 기호로 바뀐다', cp => {
    const c = String.fromCodePoint(cp)
    expect(showableTerminalLine(`a${c}b`)).toBe(`a${sym(cp)}b`)
  })
  it('태그 문자 U+E0000–E007F(아스트랄)는 코드포인트 16진 5자리 기호로 바뀐다', () => {
    for (const cp of [0xE0000, 0xE0020, 0xE0041, 0xE007F]) expect(showableTerminalLine(`x${String.fromCodePoint(cp)}y`)).toBe(`x${sym(cp)}y`)
    expect(showableTerminalLine('\u{E0041}')).toBe('⟨U+E0041⟩')
    expect(showableTerminalLine('\u{E0080}')).toBe('\u{E0080}') // 범위 밖
  })
  it('기호는 대문자 16진 4자리 이상이다', () => {
    expect(showableTerminalLine('­')).toBe('⟨U+00AD⟩')
    expect(showableTerminalLine('‮')).toBe('⟨U+202E⟩')
    expect(showableTerminalLine('﻿')).toBe('⟨U+FEFF⟩')
  })
  it('연속된 숨는 문자도 하나씩 바꾼다', () => {
    expect(showableTerminalLine('​​‮')).toBe('⟨U+200B⟩⟨U+200B⟩⟨U+202E⟩')
  })
})

describe('showableTerminalLine — 정상 글자는 바꾸지 않는다', () => {
  it.each([
    '', 'Allow Bash(git push)? [y/N]', '계속하시겠습니까? 1. 예  2. 아니오', 'こんにちは', 'ñandú café',
    '\u{1F600} 😀 ✅', '👍🏽', '❤️', '🇰🇷', '1️⃣', 'tab\there',
  ])('%j', line => {
    expect(showableTerminalLine(line)).toBe(line)
  })
})

describe('showableTerminalLine — ZWJ(U+200D) 규칙: 이모지 시퀀스 안의 ZWJ 만 남긴다', () => {
  it('ZWJ 로 이은 이모지 시퀀스는 그대로 둔다', () => {
    for (const seq of ['👨‍👩‍👧', '👩‍💻', '🏳️‍🌈', '👩🏽‍🚀', '❤️‍\u{1F525}']) {
      expect(showableTerminalLine(seq), seq).toBe(seq)
    }
  })
  it('단독·글자 사이·줄 머리와 끝·이모지 앞뒤 한쪽만 이모지인 ZWJ 는 기호로 바꾼다', () => {
    const z = '‍'
    expect(showableTerminalLine(z)).toBe('⟨U+200D⟩')
    expect(showableTerminalLine(`rm${z}-rf`)).toBe('rm⟨U+200D⟩-rf')
    expect(showableTerminalLine(`가${z}나`)).toBe('가⟨U+200D⟩나')
    expect(showableTerminalLine(`👨${z}`)).toBe('👨⟨U+200D⟩')
    expect(showableTerminalLine(`${z}👨`)).toBe('⟨U+200D⟩👨')
    expect(showableTerminalLine(`👨${z}x`)).toBe('👨⟨U+200D⟩x')
    expect(showableTerminalLine(`👨${z}${z}👩`)).toBe('👨⟨U+200D⟩⟨U+200D⟩👩')
  })
  it('같은 줄의 다른 위험 문자는 시퀀스 옆에서도 바뀐다', () => {
    expect(showableTerminalLine('👩‍💻‮x')).toBe('👩‍💻⟨U+202E⟩x')
  })
})
