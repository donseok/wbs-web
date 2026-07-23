// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ toast: vi.fn() }))

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (key: string) => key, locale: 'ko' }),
}))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: vi.fn() }))
vi.mock('@/components/minutes/MinutesCalendar', () => ({ MinutesCalendar: () => <div /> }))
vi.mock('@/components/minutes/MinuteUploadModal', () => ({ MinuteUploadModal: () => null }))
vi.mock('@/components/minutes/ArchiveChatPanel', () => ({ ArchiveChatPanel: () => null }))
vi.mock('@/app/actions/minutes', () => ({
  fetchMinutesRange: vi.fn(async () => []),
  fetchMinutesSearch: vi.fn(async () => []),
  fetchMinutesTree: vi.fn(async () => ({ groups: [], total: 0, truncated: false })),
}))

import { MinutesView } from '@/components/minutes/MinutesView'

describe('MinutesView 전체 회의록 내려받기', () => {
  let container: HTMLDivElement
  let root: Root
  let fetchMock: ReturnType<typeof vi.fn>
  let createObjectUrl: ReturnType<typeof vi.fn>
  let revokeObjectUrl: ReturnType<typeof vi.fn>
  let downloadedName = ''

  beforeEach(async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    createObjectUrl = vi.fn(() => 'blob:minutes-export')
    revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl })
    downloadedName = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download
    })
    mocks.toast.mockReset()
    await act(async () => root.render(
      <MinutesView initialMinutes={[]} todayIso="2026-07-23" initialView="list"
        projects={[]} currentUserId="u1" role="pmo_admin" defaultTeam={null} />,
    ))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function exportButton(): HTMLButtonElement {
    const button = [...container.querySelectorAll('button')]
      .find(node => node.textContent?.includes('min.export.all'))
    if (!button) throw new Error('export button not found')
    return button
  }

  async function flushClick(button: HTMLButtonElement) {
    await act(async () => {
      button.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }

  it('ZIP 응답의 UTF-8 파일명으로 blob 다운로드하고 URL을 정리한다', async () => {
    const blob = new Blob(['zip'], { type: 'application/zip' })
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({
        'Content-Disposition': "attachment; filename=minutes.zip; filename*=UTF-8''%ED%9A%8C%EC%9D%98%EB%A1%9D_%EC%A0%84%EC%B2%B4.zip",
      }),
      blob: vi.fn(async () => blob),
    } as unknown as Response)

    await flushClick(exportButton())

    expect(fetchMock).toHaveBeenCalledWith('/api/minutes/export')
    expect(createObjectUrl).toHaveBeenCalledWith(blob)
    expect(downloadedName).toBe('회의록_전체.zip')
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:minutes-export')
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('JSON 오류 메시지를 Toast로 표시하고 blob을 만들지 않는다', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn(async () => ({ error: 'ZIP 생성 실패' })),
    } as unknown as Response)

    await flushClick(exportButton())

    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'min.export.failed',
      description: 'ZIP 생성 실패',
      variant: 'error',
    })
    expect(createObjectUrl).not.toHaveBeenCalled()
  })
})
