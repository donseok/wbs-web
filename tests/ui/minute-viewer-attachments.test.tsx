// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Minute, MinuteFile } from '@/lib/domain/types'
import { MINUTE_ATTACHMENTS_MAX_COUNT, MINUTE_ATTACHMENT_MAX } from '@/lib/domain/minutes'

/**
 * 상세 화면의 첨부 추가·삭제.
 *
 * 등록 시점에만 첨부를 올릴 수 있던 동안에는 recordMinuteFile(role:'attachment') 과
 * removeMinuteFile 이 서버에만 있고 화면에서 아무도 부르지 않았다. 또박또박 API 로 들어온
 * 회의록(운영 72건)은 첨부를 붙일 길이 아예 없었다.
 *
 * 권한은 기존 canManage(작성자 또는 프로젝트 관리자)를 그대로 쓴다 — 서버의 checkOwner 와
 * 같은 규칙이라 화면과 서버가 어긋날 여지를 만들지 않는다.
 */

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (key: string) => key, locale: 'ko' }),
}))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/minutes/MarkdownView', () => ({ MarkdownView: () => null }))
vi.mock('@/components/minutes/MinuteInsightCard', () => ({ MinuteInsightCard: () => null }))
vi.mock('@/components/minutes/MinuteToc', () => ({ MinuteToc: () => null }))
vi.mock('@/components/minutes/MinuteChatPanel', () => ({ MinuteChatPanel: () => null }))
vi.mock('@/components/minutes/MinuteMetaModal', () => ({ MinuteMetaModal: () => null }))
vi.mock('@/components/minutes/MinuteShareModal', () => ({ MinuteShareModal: () => null }))
vi.mock('@/components/minutes/MinuteBlockPopover', () => ({ MinuteBlockPopover: () => null }))
vi.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({}) }))

const uploadMinuteFile = vi.fn()
vi.mock('@/lib/minutes/uploadMinuteFile', () => ({
  uploadMinuteFile: (...a: unknown[]) => uploadMinuteFile(...(a as [])),
}))

const removeMinuteFile = vi.fn()
const getMinuteFileUrl = vi.fn(async () => ({ ok: false as const, error: '' }))
vi.mock('@/app/actions/minutes', () => ({
  removeMinuteFile: (...a: unknown[]) => removeMinuteFile(...(a as [])),
  getMinuteFileUrl: (...a: unknown[]) => getMinuteFileUrl(...(a as [])),
  replaceMinuteBody: vi.fn(),
  deleteMinute: vi.fn(),
  toggleMinuteHighlight: vi.fn(),
}))
vi.mock('@/app/actions/issues', () => ({
  createIssueFromMinuteBlock: vi.fn(),
  fetchIssueProjectMembers: vi.fn(),
  prepareMinuteIssueDraft: vi.fn(),
}))

import { MinuteViewer } from '@/components/minutes/MinuteViewer'

const base: Minute = {
  id: 'm1', minuteDate: '2026-09-24', teamCode: 'MES', title: '생산계획 회의',
  bodyMd: '본문', meetingId: null, createdBy: 'u1', createdByName: '작성자',
  createdAt: '2026-09-24T00:00:00Z', updatedAt: '2026-09-24T00:00:00Z',
}

const attachment = (n: number): MinuteFile => ({
  id: `f${n}`, minuteId: 'm1', role: 'attachment', fileName: `자료${n}.pdf`,
  filePath: `m1/${n}-file.pdf`, size: 1024, mime: 'application/pdf',
  createdAt: '2026-09-24T01:00:00Z',
})

class IntersectionObserverStub { observe() {} disconnect() {} }

function fileOf(name: string, size: number): File {
  return { name, size, type: 'application/pdf' } as File
}

describe('MinuteViewer 첨부 추가·삭제', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    uploadMinuteFile.mockResolvedValue({ ok: true, filePath: 'm1/1-a.pdf' })
    removeMinuteFile.mockResolvedValue({ ok: true })
    ;(globalThis as Record<string, unknown>).IntersectionObserver = IntersectionObserverStub
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(files: MinuteFile[], canManage: boolean) {
    act(() => {
      root.render(
        <MinuteViewer minute={base} files={files} canManage={canManage}
          annotations={{ highlights: [], insights: [] }} userId="u1" projects={[]}
          folderPath={null} />,
      )
    })
  }

  const addInput = () =>
    container.querySelector<HTMLInputElement>('input[data-testid="attach-add"]')
  const removeButtons = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('button[data-testid^="attach-remove-"]'))
  // 확인 모달은 document.body 로 포털된다(Modal) — container 밖에서 찾는다.
  const confirmButton = () =>
    document.body.querySelector<HTMLButtonElement>('button[data-testid="attach-remove-confirm"]')

  it('관리 권한이 없으면 추가·삭제 조작이 없다 — 다운로드만 남는다', () => {
    render([attachment(1)], false)

    expect(addInput()).toBeNull()
    expect(removeButtons()).toHaveLength(0)
    expect(container.textContent).toContain('자료1.pdf')
  })

  it('관리 권한이 있으면 첨부마다 삭제 버튼이 붙는다', () => {
    render([attachment(1), attachment(2)], true)

    expect(removeButtons()).toHaveLength(2)
  })

  it('첨부가 없어도 추가 컨트롤은 보인다 — 없으면 나중에 붙일 길이 없다', () => {
    render([], true)

    expect(addInput()).not.toBeNull()
  })

  it('고른 파일을 업로드하고 화면을 새로 받는다', async () => {
    render([], true)
    const input = addInput()!

    await act(async () => {
      Object.defineProperty(input, 'files', { value: [fileOf('견적서.xlsx', 2048)] })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(uploadMinuteFile).toHaveBeenCalledTimes(1)
    const [, minuteId, role, file] = uploadMinuteFile.mock.calls[0]!
    expect([minuteId, role, (file as File).name]).toEqual(['m1', 'attachment', '견적서.xlsx'])
    expect(refresh).toHaveBeenCalled()
  })

  it('여러 개를 고르면 순차로 올린다', async () => {
    render([], true)
    const input = addInput()!

    await act(async () => {
      Object.defineProperty(input, 'files', {
        value: [fileOf('a.pdf', 10), fileOf('b.pdf', 10)],
      })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(uploadMinuteFile).toHaveBeenCalledTimes(2)
  })

  // 상한은 서버도 보지만, 20MB 를 올려놓고 거부당하는 왕복을 사용자에게 시키지 않는다.
  it('개당 용량을 넘는 파일은 올리지 않는다', async () => {
    render([], true)
    const input = addInput()!

    await act(async () => {
      Object.defineProperty(input, 'files', {
        value: [fileOf('거대.zip', MINUTE_ATTACHMENT_MAX + 1)],
      })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(uploadMinuteFile).not.toHaveBeenCalled()
    expect(container.textContent).toContain('min.err.attachMax')
  })

  it('남은 칸보다 많이 고르면 올리지 않는다', async () => {
    render([attachment(1), attachment(2)], true)  // 남은 칸 = 상한 - 2
    const input = addInput()!
    const tooMany = Array.from(
      { length: MINUTE_ATTACHMENTS_MAX_COUNT - 1 },
      (_, i) => fileOf(`f${i}.pdf`, 10),
    )

    await act(async () => {
      Object.defineProperty(input, 'files', { value: tooMany })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(uploadMinuteFile).not.toHaveBeenCalled()
    expect(container.textContent).toContain('min.err.attachCount')
  })

  it('상한에 도달하면 추가 입력이 잠긴다', () => {
    render(
      Array.from({ length: MINUTE_ATTACHMENTS_MAX_COUNT }, (_, i) => attachment(i + 1)),
      true,
    )

    expect(addInput()?.disabled).toBe(true)
  })

  // 스토리지 삭제는 되돌릴 수 없다. 한 번의 오클릭으로 첨부가 사라지지 않게 확인을 거친다.
  it('삭제 버튼만 눌러서는 지워지지 않는다 — 확인을 거친다', async () => {
    render([attachment(1)], true)

    await act(async () => { removeButtons()[0]!.click() })

    expect(removeMinuteFile).not.toHaveBeenCalled()
  })

  it('확인하면 해당 첨부만 삭제하고 화면을 새로 받는다', async () => {
    render([attachment(1), attachment(2)], true)

    await act(async () => { removeButtons()[1]!.click() })
    const confirm = confirmButton()
    expect(confirm).not.toBeNull()
    await act(async () => { confirm!.click() })

    expect(removeMinuteFile).toHaveBeenCalledWith('f2')
    expect(refresh).toHaveBeenCalled()
  })

  it('업로드가 실패하면 사유를 보여주고 새로 받지 않는다', async () => {
    uploadMinuteFile.mockResolvedValue({ ok: false, reason: 'upload', error: '용량 초과' })
    render([], true)
    const input = addInput()!

    await act(async () => {
      Object.defineProperty(input, 'files', { value: [fileOf('a.pdf', 10)] })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(container.textContent).toContain('용량 초과')
    expect(refresh).not.toHaveBeenCalled()
  })

  // 앞의 파일은 이미 스토리지·메타에 들어갔다. 새로 받지 않으면 올라간 첨부가 화면에서
  // 누락돼 사용자는 유실됐다고 읽는다(에러 3원칙 ① 표시 = 사실).
  it('여러 개 중 일부만 올라간 뒤 실패하면 사유를 보여주고 화면도 새로 받는다', async () => {
    uploadMinuteFile
      .mockResolvedValueOnce({ ok: true, filePath: 'm1/1-a.pdf' })
      .mockResolvedValueOnce({ ok: false, reason: 'record', error: '권한 없음' })
    render([], true)
    const input = addInput()!

    await act(async () => {
      Object.defineProperty(input, 'files', {
        value: [fileOf('a.pdf', 10), fileOf('b.pdf', 10)],
      })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(container.textContent).toContain('권한 없음')
    expect(refresh).toHaveBeenCalled()
  })

  it('삭제가 실패하면 사유를 보여준다', async () => {
    removeMinuteFile.mockResolvedValue({ ok: false, error: '권한 없음' })
    render([attachment(1)], true)

    await act(async () => { removeButtons()[0]!.click() })
    await act(async () => { confirmButton()!.click() })

    expect(container.textContent).toContain('권한 없음')
  })
})
