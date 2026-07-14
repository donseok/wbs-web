import { describe, it, expect } from 'vitest'
import { isNewlineChord } from '@/lib/domain/sheetChords'

const k = (key: string, mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) =>
  ({ key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods })

describe('isNewlineChord — 셀 안에서 한 줄 내려 계속 쓰기', () => {
  it('Windows: Alt+Enter, Ctrl+Enter', () => {
    expect(isNewlineChord(k('Enter', { altKey: true }))).toBe(true)
    expect(isNewlineChord(k('Enter', { ctrlKey: true }))).toBe(true)
  })
  it('macOS: Option(⌥)+Enter, Command(⌘)+Enter', () => {
    expect(isNewlineChord(k('Enter', { altKey: true }))).toBe(true)  // ⌥ = altKey
    expect(isNewlineChord(k('Enter', { metaKey: true }))).toBe(true) // ⌘ = metaKey
  })
  it('맨 Enter는 줄바꿈이 아니다 — 저장하고 아래 칸으로 이동', () => {
    expect(isNewlineChord(k('Enter'))).toBe(false)
  })
  it('Shift+Enter도 줄바꿈이 아니다 — 저장하고 위 칸으로 이동(엑셀 관례)', () => {
    expect(isNewlineChord(k('Enter', { shiftKey: true }))).toBe(false)
  })
  it('Enter가 아닌 키는 수식어가 있어도 아니다', () => {
    expect(isNewlineChord(k('a', { altKey: true }))).toBe(false)
    expect(isNewlineChord(k('Tab', { metaKey: true }))).toBe(false)
  })
})
