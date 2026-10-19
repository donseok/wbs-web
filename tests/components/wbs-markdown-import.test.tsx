// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const previewWbsUpload = vi.fn()
const applyWbsUpload = vi.fn()
const refresh = vi.fn()

vi.mock('@/app/actions/wbsMarkdown', () => ({
  previewWbsUpload: (...a: unknown[]) => previewWbsUpload(...(a as [])),
  applyWbsUpload: (...a: unknown[]) => applyWbsUpload(...(a as [])),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

import { WbsMarkdownImport } from '@/components/import/WbsMarkdownImport'

const PREVIEW_OK = {
  ok: true, mode: 'pl', module: 'mes-qa', attach: 'PH-03/SYS-QA',
  attachRef: 'mes-skel/SYS-QA', attachFound: true, levelsStatus: 'match',
  serverLevels: ['Phase', 'Task'], fileLevels: ['Phase', 'Task'],
  counts: { Subsystem: 1, Task: 2 }, newCount: 2, updateCount: 1, foldCount: 1,
  errors: [], warnings: ['W1'], canApply: true,
}

async function selectFile(container: HTMLElement, content = '---\nmodule: mes-qa\n---\n') {
  const input = container.querySelector<HTMLInputElement>('input[data-md-file]')!
  const file = new File([content], 'wbs.md', { type: 'text/markdown' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
}

describe('WbsMarkdownImport', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    previewWbsUpload.mockReset()
    applyWbsUpload.mockReset()
    refresh.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<WbsMarkdownImport projectId="proj-1" />) })
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('파일 선택 → 미리보기 액션 호출 + 부착점·신규/갱신 카드 표시', async () => {
    previewWbsUpload.mockResolvedValue(PREVIEW_OK)
    await selectFile(container)
    expect(previewWbsUpload).toHaveBeenCalledWith('proj-1', expect.stringContaining('mes-qa'))
    const card = container.querySelector('[data-md-preview]')!
    expect(card.textContent).toContain('mes-skel/SYS-QA')
    expect(card.textContent).toContain('mes-qa')
    // 신규/갱신/fold 건수 노출
    expect(card.textContent).toContain('2')
    expect(card.textContent).toContain('1')
    // 경고 전량 나열
    expect(card.textContent).toContain('W1')
  })

  it('canApply:false → 적용 버튼 비활성 + 에러 전량 표시', async () => {
    previewWbsUpload.mockResolvedValue({
      ...PREVIEW_OK, attachFound: false, canApply: false,
      errors: ['attach 노드가 서버에 없습니다: PH-03/SYS-QA — 골격을 먼저 업로드하세요.'],
    })
    await selectFile(container)
    expect(container.querySelector<HTMLButtonElement>('button[data-md-apply]')!.disabled).toBe(true)
    expect(container.textContent).toContain('골격을 먼저 업로드')
  })

  it('적용 → applyWbsUpload 호출 + 결과 표시 + refresh', async () => {
    previewWbsUpload.mockResolvedValue(PREVIEW_OK)
    applyWbsUpload.mockResolvedValue({ ok: true, upserted: 3, ordersCreated: 2, unmatched: [] })
    await selectFile(container)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[data-md-apply]')!.click()
      await Promise.resolve()
    })
    expect(applyWbsUpload).toHaveBeenCalledWith('proj-1', expect.any(String))
    expect(container.textContent).toContain('3')
    expect(refresh).toHaveBeenCalled()
  })

  it('취소 → 카드 제거(초기 상태 복귀)', async () => {
    previewWbsUpload.mockResolvedValue(PREVIEW_OK)
    await selectFile(container)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[data-md-cancel]')!.click()
    })
    expect(container.querySelector('[data-md-preview]')).toBeNull()
  })

  it('미리보기 실패(ok:false) → 에러 메시지 표시, 적용 버튼 없음', async () => {
    previewWbsUpload.mockResolvedValue({ ok: false, error: '권한이 없습니다.' })
    await selectFile(container)
    expect(container.textContent).toContain('권한이 없습니다.')
    expect(container.querySelector('button[data-md-apply]')).toBeNull()
  })

  // L7(리뷰 수정 1회차) — 위임 표식 제거로 인한 주문 취소 건수·실패 ref 를 적용 결과 카드에 보여준다.
  it('적용 결과에 L7 취소 건수·실패 ref 목록을 보여준다', async () => {
    previewWbsUpload.mockResolvedValue(PREVIEW_OK)
    applyWbsUpload.mockResolvedValue({
      ok: true, upserted: 3, ordersCreated: 2, unmatched: [],
      delegationCancelled: 2, delegationCancelFailed: ['TSK-01'],
    })
    await selectFile(container)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[data-md-apply]')!.click()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('위임 표식이 빠진 작업 2건의 에이전트 주문을 취소했습니다')
    expect(container.textContent).toContain('주문 취소에 실패한 작업이 있습니다')
    expect(container.textContent).toContain('TSK-01')
  })

  it('L7 취소·실패가 없으면 관련 문구를 보여주지 않는다', async () => {
    previewWbsUpload.mockResolvedValue(PREVIEW_OK)
    applyWbsUpload.mockResolvedValue({ ok: true, upserted: 3, ordersCreated: 2, unmatched: [] })
    await selectFile(container)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[data-md-apply]')!.click()
      await Promise.resolve()
    })
    expect(container.textContent).not.toContain('에이전트 주문을 취소했습니다')
    expect(container.textContent).not.toContain('주문 취소에 실패한 작업이 있습니다')
  })
})

// ── 기존 3~4단(classic) 형식 — module 입력·재계산·적용 인자 ─────────────────────────────
describe('WbsMarkdownImport — classic(기존 3~4단)', () => {
  let container: HTMLDivElement
  let root: Root

  const PREVIEW_CLASSIC = {
    ok: true, format: 'classic', module: 'oranda', moduleSuggested: 'oranda',
    counts: { WP: 11, TSK: 49 }, newCount: 60, updateCount: 0,
    errors: [], warnings: [], canApply: true,
  }
  const moduleInput = () => container.querySelector<HTMLInputElement>('input[data-md-module-input]')!
  const applyButton = () => container.querySelector<HTMLButtonElement>('button[data-md-apply]')!

  async function typeModule(value: string) {
    const input = moduleInput()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  beforeEach(() => {
    previewWbsUpload.mockReset()
    applyWbsUpload.mockReset()
    refresh.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<WbsMarkdownImport projectId="proj-1" />) })
  })
  afterEach(() => {
    vi.useRealTimers()
    act(() => root.unmount())
    container.remove()
  })

  it('형식을 표시하고 module 입력칸을 제안값으로 채운다 + 중복 트리 경고', async () => {
    previewWbsUpload.mockResolvedValue(PREVIEW_CLASSIC)
    await selectFile(container, '## WP-01: a\n### TSK-01-01: b\n')
    expect(previewWbsUpload).toHaveBeenCalledWith('proj-1', expect.any(String)) // 첫 미리보기는 module 없이(서버 제안)
    const card = container.querySelector('[data-md-preview]')!
    expect(card.textContent).toContain('기존 3~4단')
    expect(card.textContent).toContain('WP 11 · TSK 49')
    expect(moduleInput().value).toBe('oranda')
    expect(moduleInput().required).toBe(true)
    expect(card.textContent).toContain('같은 트리가 하나 더 생깁니다')
    expect(card.textContent).not.toContain('acceptance 로 접힘') // N단 전용 칸은 숨긴다
  })

  it('module 을 바꾸면 미리보기를 다시 계산하고, 다시 계산될 때까지 적용을 막는다', async () => {
    vi.useFakeTimers()
    previewWbsUpload.mockResolvedValueOnce(PREVIEW_CLASSIC)
    await selectFile(container, '## WP-01: a\n### TSK-01-01: b\n')
    previewWbsUpload.mockResolvedValueOnce({ ...PREVIEW_CLASSIC, module: 'other', newCount: 58, updateCount: 2 })
    await typeModule('other')
    expect(applyButton().disabled).toBe(true) // 미리보기가 낡았다
    expect(previewWbsUpload).toHaveBeenCalledTimes(1) // 디바운스 전
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(previewWbsUpload).toHaveBeenLastCalledWith('proj-1', expect.any(String), { module: 'other' })
    expect(container.querySelector('[data-md-preview]')!.textContent).toContain('58 / 2')
    expect(applyButton().disabled).toBe(false)
  })

  it('module 을 비우면 필수 에러 미리보기 → 적용 불가', async () => {
    vi.useFakeTimers()
    previewWbsUpload.mockResolvedValueOnce(PREVIEW_CLASSIC)
    await selectFile(container, '## WP-01: a\n### TSK-01-01: b\n')
    previewWbsUpload.mockResolvedValueOnce({
      ...PREVIEW_CLASSIC, module: '', newCount: undefined, updateCount: undefined, canApply: false,
      errors: ['module 을 입력하세요 — 기존 형식 파일에는 module 이 없어 external_ref(module/ID)를 만들 수 없습니다.'],
    })
    await typeModule('')
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(container.textContent).toContain('module 을 입력하세요')
    expect(container.textContent).toContain('— (module 필요)')
    expect(applyButton().disabled).toBe(true)
  })

  it('적용 → 미리보기에서 확인한 module 을 넘긴다', async () => {
    previewWbsUpload.mockResolvedValue(PREVIEW_CLASSIC)
    applyWbsUpload.mockResolvedValue({ ok: true, upserted: 60, ordersCreated: 49, unmatched: [], taskCount: 49 })
    await selectFile(container, '## WP-01: a\n### TSK-01-01: b\n')
    await act(async () => {
      applyButton().click()
      await Promise.resolve()
    })
    expect(applyWbsUpload).toHaveBeenCalledWith('proj-1', expect.any(String), { module: 'oranda' })
    expect(container.textContent).toContain('60건 반영')
    expect(container.querySelector('[data-md-module]')).toBeNull() // 적용 뒤엔 입력칸을 거둔다
  })

  it('unknown 형식 → 판정 불가 표시 + 안내 에러, N단 칸은 그리지 않는다', async () => {
    previewWbsUpload.mockResolvedValue({
      ok: true, format: 'unknown', mode: 'skeleton', counts: {}, errors: ['받는 형식은 두 가지입니다 — …', 'levels 검증 실패: …'],
      warnings: [], canApply: false,
    })
    await selectFile(container, '# 메모\n')
    const card = container.querySelector('[data-md-preview]')!
    expect(card.textContent).toContain('판정 불가')
    expect(card.textContent).toContain('받는 형식은 두 가지입니다')
    expect(card.textContent).not.toContain('골격(PMO)')
    expect(container.querySelector('[data-md-module]')).toBeNull()
  })
})
