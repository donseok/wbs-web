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
})
