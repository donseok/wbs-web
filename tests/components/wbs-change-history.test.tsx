// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 더보기 라벨만 실제 사전 문구를 흉내낸다 — {n} 치환이 계약의 일부라 키만 돌려주면 검증이 안 된다.
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => (k === 'wbs.historyExpand' ? '{n}건 더 보기' : k) }),
}))

import { ChangeHistoryList } from '@/components/wbs/ChangeHistoryList'
import type { ChangeLogEntry } from '@/app/actions/wbs'

function log(id: number, over: Partial<ChangeLogEntry> = {}): ChangeLogEntry {
  return {
    id, field: 'actual_pct', oldValue: '40', newValue: '100',
    at: `2026-08-2${id} 09:00:00+09`, actorTeam: 'MES' as ChangeLogEntry['actorTeam'], actorRole: 'pmo_admin',
    ...over,
  }
}

/**
 * 변경 이력은 항목당 카드 3줄이라 이력이 쌓이면 패널 대부분을 먹었다(2026-08-28).
 * 한 줄 + 최근 3건 접기가 계약이다.
 */
describe('ChangeHistoryList — 한 줄 표시 + 최근 3건', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(logs: ChangeLogEntry[] | null) {
    act(() => { root.render(<ChangeHistoryList logs={logs} />) })
  }
  const rows = () => container.querySelectorAll('[data-history-row]')
  const more = () => container.querySelector<HTMLButtonElement>('[data-history-more]')

  it('3건 이하는 전부 보이고 더보기 버튼이 없다', () => {
    render([log(1), log(2), log(3)])
    expect(rows()).toHaveLength(3)
    expect(more()).toBeNull()
  })

  it('4건 이상이면 최근 3건만 보이고 나머지는 접힌다', () => {
    render([log(1), log(2), log(3), log(4), log(5)])
    expect(rows()).toHaveLength(3)
    expect(more()).not.toBeNull()
    expect(more()!.textContent).toBe('2건 더 보기')
  })

  it('더보기를 누르면 전부 펼쳐지고, 다시 누르면 접힌다', () => {
    render([log(1), log(2), log(3), log(4), log(5)])
    act(() => { more()!.click() })
    expect(rows()).toHaveLength(5)
    act(() => { more()!.click() })
    expect(rows()).toHaveLength(3)
  })

  it('한 행에 시각·필드·이전→이후·행위자가 모두 들어간다', () => {
    render([log(1, { field: 'weight', oldValue: null, newValue: '0.25' })])
    const row = rows()[0]
    expect(row.textContent).toContain('wbs.colWeight')      // 필드 라벨(사전 키)
    expect(row.textContent).toContain('wbs.weightEqual')    // null → 균등
    expect(row.textContent).toContain('25%')                // 가중치 표기
    expect(row.textContent).toContain('MES')                // 행위자
  })

  it('목록이 바뀌면 펼침 상태가 초기화된다 — 다른 항목을 열었는데 펼쳐진 채면 안 된다', () => {
    render([log(1), log(2), log(3), log(4), log(5)])
    act(() => { more()!.click() })
    expect(rows()).toHaveLength(5)
    render([log(6), log(7), log(8), log(9)])
    expect(rows()).toHaveLength(3)
  })

  it('로딩(null)·빈 목록은 안내 문구만', () => {
    render(null)
    expect(rows()).toHaveLength(0)
    expect(container.textContent).toContain('common.loading')
    render([])
    expect(container.textContent).toContain('wbs.noHistory')
  })
})
