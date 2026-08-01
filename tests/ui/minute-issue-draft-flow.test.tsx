// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Minute } from '@/lib/domain/types'
import { fnv1a64, splitMinuteBlocks } from '@/lib/minutes/blocks'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const mocks = vi.hoisted(() => ({
  prepareMinuteIssueDraft: vi.fn(),
  fetchIssueProjectMembers: vi.fn(),
  createIssueFromMinuteBlock: vi.fn(),
  toast: vi.fn(),
  issueFormProps: [] as Array<Record<string, unknown>>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (key: string) => key }),
}))
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))
vi.mock('@/app/actions/issues', () => ({
  prepareMinuteIssueDraft: mocks.prepareMinuteIssueDraft,
  fetchIssueProjectMembers: mocks.fetchIssueProjectMembers,
  createIssueFromMinuteBlock: mocks.createIssueFromMinuteBlock,
}))
vi.mock('@/components/minutes/useMinuteTocSpy', () => ({
  useMinuteTocSpy: () => ({ activeToc: null, jumpTo: vi.fn() }),
}))
vi.mock('@/components/minutes/MarkdownView', () => ({
  // 문단 경계(\n\n)로 나눠 실제 splitMinuteBlocks 인덱스와 맞춘다 — 단일 문단 본문은
  // 기존처럼 data-mblock="0" 하나만 렌더된다(문단만 있는 픽스처 전제).
  MarkdownView: ({ content }: { content: string }) => (
    <div>
      {content.split('\n\n').map((segment, index) => (
        <p key={index} data-mblock={index} data-testid="minute-source-block">{segment}</p>
      ))}
    </div>
  ),
}))
vi.mock('@/components/minutes/MinuteInsightCard', () => ({ MinuteInsightCard: () => null }))
vi.mock('@/components/minutes/MinuteToc', () => ({ MinuteToc: () => null }))
vi.mock('@/components/minutes/MinuteChatPanel', () => ({ MinuteChatPanel: () => null }))
vi.mock('@/components/minutes/MinuteMetaModal', () => ({ MinuteMetaModal: () => null }))
vi.mock('@/components/minutes/MinuteShareModal', () => ({ MinuteShareModal: () => null }))
vi.mock('@/components/minutes/MinuteVersionPanel', () => ({ MinuteVersionPanel: () => null }))
vi.mock('@/components/minutes/MinuteWikiImpactCard', () => ({ MinuteWikiImpactCard: () => null }))
vi.mock('@/components/minutes/MinuteFontSizeControl', () => ({ MinuteFontSizeControl: () => null }))
vi.mock('@/components/minutes/MinuteBlockPopover', () => ({
  MinuteBlockPopover: ({
    issueBusy, onCreateIssue, onClose,
  }: {
    issueBusy?: boolean
    onCreateIssue: () => void
    onClose: () => void
  }) => (
    <div data-testid="minute-block-popover">
      <span data-testid="issue-draft-busy">{issueBusy ? 'busy' : 'idle'}</span>
      <button data-testid="create-minute-issue" onClick={onCreateIssue}>create</button>
      <button data-testid="close-minute-popover" onClick={onClose}>close</button>
    </div>
  ),
}))
vi.mock('@/components/issues/IssueModals', () => ({
  IssueFormModal: (props: Record<string, unknown>) => {
    mocks.issueFormProps.push(props)
    if (!props.open) return null
    return <div data-testid="minute-issue-form">issue form</div>
  },
}))

import { MinuteViewer } from '@/components/minutes/MinuteViewer'

const originalExcerpt = [
  '재고 인터페이스 전송 누락으로 월 마감 집계가 지연되고 있으며,',
  '재처리 여부 확인과 인터페이스 보완 방안 협의가 필요합니다.',
].join(' ')
const blocks = splitMinuteBlocks(originalExcerpt)
const bodyHash = fnv1a64(originalExcerpt)

const minute: Minute = {
  id: 'minute-1',
  minuteDate: '2026-07-31',
  teamCode: 'PMO',
  title: '현재 회의록 제목',
  bodyMd: originalExcerpt,
  meetingId: null,
  projectId: 'project-1',
  createdBy: 'user-1',
  createdByName: '작성자',
  createdAt: '2026-07-31T00:00:00Z',
  updatedAt: '2026-07-31T00:00:00Z',
}

const versions = [
  {
    id: 'version-2',
    versionNo: 2,
    title: '불변 버전 제목',
    minuteDate: '2026-07-30',
    createdAt: '2026-07-30T09:00:00Z',
  },
  {
    id: 'version-1',
    versionNo: 1,
    title: '이전 제목',
    minuteDate: '2026-07-29',
    createdAt: '2026-07-29T09:00:00Z',
  },
]

const organizedDraft = {
  title: '재고 인터페이스 누락에 따른 월 마감 지연',
  body: [
    '[현황]',
    '- 재고 인터페이스 전송이 누락됨',
    '',
    '[문제/영향]',
    '- 월 마감 집계가 지연됨',
    '- 재고 수량과 마감 자료의 정합성을 확인하기 어려움',
    '',
    '[필요 조치]',
    '- 재처리 여부와 보완 방안을 협의해야 함',
    '- 동일 누락의 재발 방지 기준을 확인해야 함',
  ].join('\n'),
  megaCode: '00' as const,
  subProcess: '재고정보 연계',
  mode: 'ai' as const,
}

describe('MinuteViewer 회의록 → 이슈 정리 초안', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.prepareMinuteIssueDraft.mockReset()
    mocks.fetchIssueProjectMembers.mockReset()
    mocks.createIssueFromMinuteBlock.mockReset()
    mocks.toast.mockReset()
    mocks.issueFormProps.length = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function mountAndOpenPopover(minuteValue: Minute = minute) {
    await act(async () => {
      root.render(
        <MinuteViewer
          minute={minuteValue}
          files={[]}
          canManage={false}
          annotations={{ highlights: [], insights: [] }}
          userId="user-1"
          projects={[]}
          versions={versions}
        />,
      )
    })
    act(() => {
      container.querySelector<HTMLParagraphElement>('[data-testid="minute-source-block"]')!.click()
    })
    expect(container.querySelector('[data-testid="minute-block-popover"]')).not.toBeNull()
  }

  function clickCreate() {
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="create-minute-issue"]')!.click()
    })
  }

  function openFormProps(): Record<string, unknown> {
    const props = [...mocks.issueFormProps].reverse().find(candidate => candidate.open)
    if (!props) throw new Error('열린 이슈 폼 props를 찾지 못했습니다')
    return props
  }

  it('불변 원문 앵커로 초안을 요청하고, 완료 전에는 busy만 보인 뒤 정리된 폼을 연다', async () => {
    const pending = deferred<{ ok: true; draft: typeof organizedDraft }>()
    mocks.prepareMinuteIssueDraft.mockReturnValueOnce(pending.promise)
    await mountAndOpenPopover()

    clickCreate()
    await act(async () => { await Promise.resolve() })

    expect(mocks.prepareMinuteIssueDraft).toHaveBeenCalledTimes(1)
    expect(mocks.prepareMinuteIssueDraft).toHaveBeenCalledWith('project-1', {
      minuteId: 'minute-1',
      minuteVersionId: 'version-2',
      bodyHash,
      blockIndex: 0,
      blockHash: blocks[0].hash,
      kind: 'manual',
    })
    expect(container.querySelector('[data-testid="issue-draft-busy"]')?.textContent).toBe('busy')
    expect(container.querySelector('[data-testid="minute-issue-form"]')).toBeNull()

    await act(async () => {
      pending.resolve({ ok: true, draft: organizedDraft })
      await pending.promise
    })

    expect(container.querySelector('[data-testid="minute-issue-form"]')).not.toBeNull()
    const props = openFormProps()
    expect(props.draft).toMatchObject(organizedDraft)
    expect(props.draft).toMatchObject({ megaCode: '00', subProcess: '재고정보 연계' })
    expect(props.sourcePreview).toMatchObject({
      title: '불변 버전 제목',
      date: '2026-07-30',
      excerpt: originalExcerpt,
      organizedDraft: true,
      classificationRecommended: true,
    })
    expect((props.draft as { title: string }).title).not.toContain(originalExcerpt)

    act(() => {
      (props.onCreated as (id: string, result: Record<string, unknown>) => void)(
        'issue-1',
        { ok: true, id: 'issue-1', piIssueCode: 'PI-I-00-04' },
      )
    })
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'min.issue.created',
      description: 'min.issue.createdCode',
      variant: 'success',
    })
  })

  it('초안 호출이 reject되면 원문을 잃지 않고 정돈된 로컬 폴백으로 폼을 연다', async () => {
    mocks.prepareMinuteIssueDraft.mockRejectedValueOnce(new Error('network disconnected'))
    await mountAndOpenPopover()

    clickCreate()
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    expect(container.querySelector('[data-testid="minute-issue-form"]')).not.toBeNull()
    const props = openFormProps()
    const draft = props.draft as { title: string; body: string; mode: string }
    expect(draft.mode).toBe('fallback')
    expect(Array.from(draft.title).length).toBeLessThanOrEqual(200)
    expect(draft.body).toContain('[현황]')
    expect(draft.body).toContain('[문제/영향]')
    expect(draft.body).toContain('[필요 조치]')
    expect(`${draft.title}\n${draft.body}`).not.toMatch(/…|\.{3,}/)
    expect(props.sourcePreview).toMatchObject({
      excerpt: originalExcerpt,
      organizedDraft: true,
      classificationRecommended: false,
    })
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'min.issue.fallbackUsed',
      variant: 'info',
    })
  })

  it('팝오버를 닫은 뒤 도착한 stale 초안 응답은 이슈 폼을 다시 열지 않는다', async () => {
    const pending = deferred<{ ok: true; draft: typeof organizedDraft }>()
    mocks.prepareMinuteIssueDraft.mockReturnValueOnce(pending.promise)
    await mountAndOpenPopover()

    clickCreate()
    await act(async () => { await Promise.resolve() })
    expect(container.querySelector('[data-testid="issue-draft-busy"]')?.textContent).toBe('busy')

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="close-minute-popover"]')!.click()
    })
    expect(container.querySelector('[data-testid="minute-block-popover"]')).toBeNull()

    await act(async () => {
      pending.resolve({ ok: true, draft: organizedDraft })
      await pending.promise
    })

    expect(container.querySelector('[data-testid="minute-issue-form"]')).toBeNull()
    expect(mocks.issueFormProps.some(props => props.open === true)).toBe(false)
  })

  it('긴 원문에서 서버 호출도 실패하면 불완전한 로컬 초안을 열지 않는다', async () => {
    const longMinute = {
      ...minute,
      bodyMd: `처리 지연 문제가 ${'가'.repeat(21_000)}`,
    }
    mocks.prepareMinuteIssueDraft.mockRejectedValueOnce(new Error('network disconnected'))
    await mountAndOpenPopover(longMinute)

    clickCreate()
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    expect(container.querySelector('[data-testid="minute-issue-form"]')).toBeNull()
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'min.issue.draftUnavailable',
      variant: 'error',
    })
  })
})

describe('MinuteViewer 드래그 선택 → 이슈 등록', () => {
  let container: HTMLDivElement
  let root: Root

  const selectionBody = [
    '첫 번째 문단은 전송 누락 위험을 다룬다.',
    '두 번째 문단은 재처리 확인이 필요하다.',
  ].join('\n\n')
  const selectionBlocks = splitMinuteBlocks(selectionBody)
  const selectionBodyHash = fnv1a64(selectionBody)
  const selectionMinute: Minute = { ...minute, bodyMd: selectionBody }

  type RectCarrier = { getBoundingClientRect?: () => DOMRect }
  const RECT = {
    top: 100, bottom: 120, left: 40, right: 240, width: 200, height: 20, x: 40, y: 100,
    toJSON: () => ({}),
  } as DOMRect

  beforeEach(() => {
    mocks.prepareMinuteIssueDraft.mockReset()
    mocks.fetchIssueProjectMembers.mockReset()
    mocks.createIssueFromMinuteBlock.mockReset()
    mocks.toast.mockReset()
    mocks.issueFormProps.length = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    ;(Range.prototype as RectCarrier).getBoundingClientRect = () => RECT
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.getSelection()?.removeAllRanges()
    delete (Range.prototype as RectCarrier).getBoundingClientRect
  })

  async function mountViewer(extraProps: Partial<Parameters<typeof MinuteViewer>[0]> = {}) {
    await act(async () => {
      root.render(
        <MinuteViewer
          minute={selectionMinute}
          files={[]}
          canManage={false}
          annotations={{ highlights: [], insights: [] }}
          userId="user-1"
          projects={[]}
          versions={versions}
          {...extraProps}
        />,
      )
    })
  }

  function makeSelection() {
    const paragraphs = Array.from(container.querySelectorAll('[data-mblock]'))
    const range = document.createRange()
    range.setStart(paragraphs[0].firstChild!, 8)
    range.setEnd(paragraphs[1].firstChild!, 12)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    act(() => { document.dispatchEvent(new Event('pointerup')) })
  }

  function bubbleButton(): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>('button.btn-primary')
  }

  it('선택 → 버블 → AI 초안 → 모달이 selection 페이로드로 이어진다', async () => {
    const pending = deferred<{ ok: true; draft: typeof organizedDraft }>()
    mocks.prepareMinuteIssueDraft.mockReturnValueOnce(pending.promise)
    await mountViewer()

    makeSelection()
    const button = bubbleButton()
    expect(button?.textContent).toContain('min.sel.create')
    await act(async () => { button!.click() })

    expect(mocks.prepareMinuteIssueDraft).toHaveBeenCalledTimes(1)
    const source = mocks.prepareMinuteIssueDraft.mock.calls[0][1] as Record<string, unknown>
    expect(source.minuteVersionId).toBe('version-2')
    expect(source.bodyHash).toBe(selectionBodyHash)
    expect(source.blockIndex).toBe(0)
    expect(source.blockHash).toBe(selectionBlocks[0].hash)
    expect(source.kind).toBe('manual')
    const selection = source.selection as Record<string, unknown>
    expect(selection.endBlockIndex).toBe(1)
    expect(selection.endBlockHash).toBe(selectionBlocks[1].hash)
    expect(String(selection.text).replace(/\s+/g, '')).toContain('전송누락위험을다룬다')

    await act(async () => {
      pending.resolve({ ok: true, draft: organizedDraft })
      await pending.promise
    })

    expect(container.querySelector('[data-testid="minute-issue-form"]')).not.toBeNull()
    const props = [...mocks.issueFormProps].reverse().find(candidate => candidate.open)!
    const preview = props.sourcePreview as { excerpt: string; label: string }
    // jsdom Selection.toString() 은 블록 경계 개행을 넣지 않으므로 개행에 의존하지 않고 비교한다.
    expect(preview.excerpt.replace(/\s+/g, '')).toBe('전송누락위험을다룬다.두번째문단은재처리')
    expect(preview.label).toContain('min.sel.sourceLabel')
  })

  it('과거 버전 열람 중에는 선택 버블이 뜨지 않는다', async () => {
    await mountViewer({ historicalVersion: { id: 'version-1', versionNo: 1 } })
    makeSelection()
    expect(bubbleButton()).toBeNull()
  })
})
