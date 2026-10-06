// tests/domain/panel-size.test.ts — 상세 카드 폭·최근 화면 높이 규칙(2026-10-06).
import { describe, it, expect } from 'vitest'
import {
  PANEL_WIDTH, SCREEN_HEIGHT, clampPanelWidth, clampScreenHeight, isPanelStacked, readStoredPanelWidth, writeStoredPanelWidth,
} from '@/lib/domain/panelSize'

function memoryStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
    dump: () => Object.fromEntries(m),
  }
}
const throwing = {
  getItem: () => { throw new Error('blocked') },
  setItem: () => { throw new Error('blocked') },
  removeItem: () => { throw new Error('blocked') },
}

describe('clampPanelWidth', () => {
  it('하한 280 아래는 280 으로 올린다', () => {
    expect(clampPanelWidth(100, 1600, 1400)).toBe(PANEL_WIDTH.min)
  })
  it('상한은 화면 폭의 60% 다', () => {
    // 화면 1000 → 600. 보드가 넉넉(2000)하면 보드 쪽 상한은 걸리지 않는다.
    expect(clampPanelWidth(900, 1000, 2000)).toBe(600)
  })
  it('왼쪽 열이 한 줄에 남도록 보드 폭 − 536 도 상한이다', () => {
    expect(clampPanelWidth(900, 1920, 1000)).toBe(1000 - 520 - 16)
  })
  it('상한이 하한보다 작아져도 하한이 이긴다', () => {
    expect(clampPanelWidth(500, 400, 600)).toBe(PANEL_WIDTH.min)
  })
  it('범위 안의 값과 소수는 반올림해 그대로 둔다', () => {
    expect(clampPanelWidth(412.6, 1600, 1500)).toBe(413)
  })
  it('Infinity 를 넣으면 현재 허용 최대를 돌려준다', () => {
    expect(clampPanelWidth(Infinity, 1000, 2000)).toBe(600)
  })
})

describe('isPanelStacked', () => {
  it('보드 폭이 520 + 16 + 카드 폭보다 좁으면 내려간 배치다', () => {
    expect(isPanelStacked(875, PANEL_WIDTH.default)).toBe(true)
    expect(isPanelStacked(876, PANEL_WIDTH.default)).toBe(false)
  })
})

describe('저장된 폭', () => {
  it('쓴 값을 그대로 읽는다', () => {
    const s = memoryStorage()
    writeStoredPanelWidth(420, s)
    expect(s.dump()).toEqual({ [PANEL_WIDTH.storageKey]: '420' })
    expect(readStoredPanelWidth(s)).toBe(420)
  })
  it('null 을 쓰면 지워 기본 폭(null)으로 돌아간다', () => {
    const s = memoryStorage({ [PANEL_WIDTH.storageKey]: '420' })
    writeStoredPanelWidth(null, s)
    expect(readStoredPanelWidth(s)).toBeNull()
  })
  it('없거나 숫자가 아니거나 0 이하면 null 이다', () => {
    expect(readStoredPanelWidth(memoryStorage())).toBeNull()
    for (const bad of ['abc', '', '0', '-5', 'NaN', 'Infinity']) {
      expect(readStoredPanelWidth(memoryStorage({ [PANEL_WIDTH.storageKey]: bad }))).toBeNull()
    }
  })
  it('저장소가 막혀 던져도 읽기는 null, 쓰기는 조용히 넘어간다', () => {
    expect(readStoredPanelWidth(throwing)).toBeNull()
    expect(() => writeStoredPanelWidth(400, throwing)).not.toThrow()
    expect(() => writeStoredPanelWidth(null, throwing)).not.toThrow()
  })
  it('저장소 자체가 없어도(null) 던지지 않는다', () => {
    expect(readStoredPanelWidth(null)).toBeNull()
    expect(() => writeStoredPanelWidth(400, null)).not.toThrow()
  })
})

describe('clampScreenHeight', () => {
  it('하한 96, 상한 화면 높이의 80%', () => {
    expect(clampScreenHeight(10, 1000)).toBe(SCREEN_HEIGHT.min)
    expect(clampScreenHeight(5000, 1000)).toBe(800)
    expect(clampScreenHeight(400, 1000)).toBe(400)
    expect(clampScreenHeight(300, 50)).toBe(SCREEN_HEIGHT.min)
  })
})
