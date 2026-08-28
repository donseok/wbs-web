// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SpecLinkItem, WbsSpecLinks } from '@/app/actions/wbsSpec'
import { t as realT } from '@/lib/i18n/dict'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const getWbsSpecLinks = vi.fn()
const getWbsSpec = vi.fn()
const updateWbsSpecFields = vi.fn()
const updateAgentPrompt = vi.fn()
const setAgentDelegation = vi.fn()
const updateWbsSpec = vi.fn()

vi.mock('@/app/actions/wbsSpec', () => ({
  getWbsSpecLinks: (...a: unknown[]) => getWbsSpecLinks(...(a as [])),
  getWbsSpec: (...a: unknown[]) => getWbsSpec(...(a as [])),
  updateWbsSpecFields: (...a: unknown[]) => updateWbsSpecFields(...(a as [])),
  updateAgentPrompt: (...a: unknown[]) => updateAgentPrompt(...(a as [])),
  setAgentDelegation: (...a: unknown[]) => setAgentDelegation(...(a as [])),
  updateWbsSpec: (...a: unknown[]) => updateWbsSpec(...(a as [])),
}))
vi.mock('@/app/actions/agentWork', () => ({
  getAgentOrderForItem: vi.fn().mockResolvedValue({ ok: true, order: null }),
  approveAgentCompletion: vi.fn(), rejectAgentCompletion: vi.fn(),
  unapproveAgentCompletion: vi.fn(), requestAgentRework: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (k: string) => realT('ko', k as Parameters<typeof realT>[1]) }),
}))

import { WbsSpecLinksPanel } from '@/components/wbs/WbsSpecLinksPanel'
import { WbsSpecPanel } from '@/components/wbs/WbsSpecPanel'

function link(over: Partial<SpecLinkItem> = {}): SpecLinkItem {
  return { ref: 'mod/TSK-01-01', itemId: 'pred-1', code: 'TSK-01-01', name: '선행 작업', stage: 'im', actualPct: 0, ...over }
}

function links(over: Partial<WbsSpecLinks> = {}): WbsSpecLinks {
  return { predecessors: [], successors: [], ...over }
}

describe('WbsSpecLinksPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    getWbsSpecLinks.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  // onSelectItem 이 없으면 항목 이름이 클릭 불가 텍스트로 대체된다(구현 관례) — 이름 기반
  // 단언이 흔들리지 않도록 기본 렌더에는 늘 콜백을 채워 준다. 콜백 자체를 검증하는 테스트는
  // 자신의 스파이를 명시적으로 넘긴다.
  async function render(itemId = 'item-1', onSelectItem: (id: string) => void = vi.fn()) {
    await act(async () => { root.render(<WbsSpecLinksPanel itemId={itemId} onSelectItem={onSelectItem} />) })
    await act(async () => {})
  }

  it('선행 중 하나가 미도달이면 각 배지가 충족/대기로 갈리고 헤더 배너는 대기 건수를 보여준다', async () => {
    getWbsSpecLinks.mockResolvedValue(links({
      predecessors: [
        link({ ref: 'mod/PRED-1', itemId: 'pred-1', code: 'PRED-1', name: '선행 완료됨', stage: 'xx' }),
        link({ ref: 'mod/PRED-2', itemId: 'pred-2', code: 'PRED-2', name: '선행 진행중', stage: 'ip' }),
      ],
    }))
    await render()

    expect(container.textContent).toContain('선행 1건 대기 중')
    const doneRow = [...container.querySelectorAll('li')].find(li => li.textContent?.includes('선행 완료됨'))
    const waitingRow = [...container.querySelectorAll('li')].find(li => li.textContent?.includes('선행 진행중'))
    expect(doneRow!.textContent).toContain('충족')
    expect(waitingRow!.textContent).toContain('대기')
  })

  it('선행이 전부 im 이상이면 배너가 "선행 충족 — 시작 가능"이다', async () => {
    getWbsSpecLinks.mockResolvedValue(links({
      predecessors: [
        link({ ref: 'mod/PRED-A', itemId: 'pred-1', code: 'PRED-A', name: '선행 A', stage: 'im' }),
        link({ ref: 'mod/PRED-B', itemId: 'pred-2', code: 'PRED-B', name: '선행 B', stage: 'xx' }),
      ],
    }))
    await render()

    expect(container.textContent).toContain('선행 충족 — 시작 가능')
  })

  it('itemId 해석에 실패한 선행은 "확인 불가" 배지와 "확인할 수 없음" 배너를 띄운다', async () => {
    getWbsSpecLinks.mockResolvedValue(links({
      predecessors: [link({ itemId: null, name: null, ref: 'mod/UNKNOWN-1', stage: null })],
    }))
    await render()

    expect(container.textContent).toContain('선행 1건을 확인할 수 없음')
    const row = [...container.querySelectorAll('li')].find(li => li.textContent?.includes('UNKNOWN-1'))
    expect(row!.textContent).toContain('확인 불가')
  })

  it('선행 이름을 클릭하면 onSelectItem 이 그 항목 itemId 로 호출된다', async () => {
    const onSelectItem = vi.fn()
    getWbsSpecLinks.mockResolvedValue(links({
      predecessors: [link({ itemId: 'pred-9', name: '선행 클릭용', stage: 'ip' })],
    }))
    await render('item-1', onSelectItem)

    const nameButton = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('선행 클릭용'))
    expect(nameButton).toBeTruthy()
    await act(async () => { nameButton!.click() })
    expect(onSelectItem).toHaveBeenCalledWith('pred-9')
  })

  it('조회가 실패하면 role=alert 로 실패 문구가 뜨고 "선행 항목 없음"으로 위장하지 않는다', async () => {
    getWbsSpecLinks.mockResolvedValue(null)
    await render()

    const alertEl = container.querySelector('[role="alert"]')
    expect(alertEl).not.toBeNull()
    expect(alertEl!.textContent).toContain('선행·후행 항목을 불러오지 못했습니다')
    expect(container.textContent).not.toContain('선행 항목 없음')
  })

  it('후행이 0건이면 "후행 항목 없음"이 뜬다', async () => {
    getWbsSpecLinks.mockResolvedValue(links({ successors: [] }))
    await render()

    expect(container.textContent).toContain('후행 항목 없음')
  })
})

const SPEC_DETAIL = {
  category: 'dev', domain: null, priority: 'high', model: null,
  tags: [], depends: [], prdRef: null, entryPoint: null,
  acceptance: [], spec: '# 명세 내용', externalRef: 'mod/TSK-01-01', agentPrompt: null,
}

describe('WbsSpecPanel 접기', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    getWbsSpec.mockReset()
    getWbsSpec.mockResolvedValue(SPEC_DETAIL)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(editable = false) {
    await act(async () => { root.render(<WbsSpecPanel itemId="item-1" editable={editable} />) })
    await act(async () => {})
  }
  const toggle = () => container.querySelector<HTMLButtonElement>('button[aria-expanded]')

  it('기본은 펼침 — 명세 본문 영역이 보인다', async () => {
    await render()
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('명세 본문')
  })

  it('제목 버튼을 누르면 접히고 본문이 사라지며, 다시 누르면 돌아온다', async () => {
    await render()
    await act(async () => { toggle()!.click() })
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('명세 본문')

    await act(async () => { toggle()!.click() })
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('명세 본문')
  })
})
