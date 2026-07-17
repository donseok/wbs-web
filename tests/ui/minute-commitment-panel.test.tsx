// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MinuteCommitment } from '@/lib/domain/types'
import { fnv1a64, splitMinuteBlocks } from '@/lib/minutes/blocks'
import { commitmentContextHash } from '@/lib/ai/minutes-commitments'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  extract: vi.fn(),
  review: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (key: string) => key }),
}))
vi.mock('@/app/actions/minute-commitments', () => ({
  extractMinuteCommitmentsAction: mocks.extract,
  reviewMinuteCommitmentAction: mocks.review,
}))

import { MinuteCommitmentPanel } from '@/components/minutes/MinuteCommitmentPanel'

const bodyMd = 'ERP 김철수가 API 명세를 2026-07-20까지 확정한다.'
const minuteDate = '2026-07-17'
const blocks = splitMinuteBlocks(bodyMd)
const bodyHash = fnv1a64(bodyMd)
const contextHash = commitmentContextHash(bodyMd, minuteDate)

function fixture(overrides: Partial<MinuteCommitment> = {}): MinuteCommitment {
  return {
    id: 'c1', minuteId: 'm1', bodyHash, contextHash, sourceRevision: 0, commitmentHash: 'h1',
    commitmentText: 'API 명세 확정', sourceQuote: blocks[0].text,
    blockIndex: 0, blockHash: blocks[0].hash,
    ownerName: null, ownerTeam: null, ownerUnassigned: false,
    dueText: '2026-07-20', dueDate: null, dueUndecided: false,
    reviewStatus: 'pending', reviewedBy: null, reviewedByName: null, reviewedAt: null,
    createdAt: '2026-07-17T00:00:00Z', updatedAt: '2026-07-17T00:00:00Z',
    ...overrides,
  }
}

describe('MinuteCommitmentPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.refresh.mockReset()
    mocks.extract.mockReset().mockResolvedValue({ ok: true, count: 1 })
    mocks.review.mockReset().mockResolvedValue({ ok: true })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(item: MinuteCommitment, onJump = vi.fn()) {
    await act(async () => root.render(
      <MinuteCommitmentPanel
        minuteId="m1" commitments={[item]} blocks={blocks}
        bodyHash={bodyHash} contextHash={contextHash} sourceRevision={0}
        canManage onJump={onJump}
      />,
    ))
    return onJump
  }

  function button(label: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')]
      .find(node => node.textContent?.includes(label))
    if (!found) throw new Error(`button not found: ${label}`)
    return found
  }

  it('누락 담당·기한을 표시하고 정확한 원문으로 이동한다', async () => {
    const onJump = await render(fixture())

    expect(container.textContent).toContain('min.commit.missing.owner')
    expect(container.textContent).toContain('min.commit.missing.due')
    expect(button('min.commit.action.confirm').disabled).toBe(true)
    await act(async () => button('min.commit.source.open').click())
    expect(onJump).toHaveBeenCalledWith(0)
  })

  it('stale 후보는 원문 이동·확인을 막지만 제외는 허용한다', async () => {
    await render(fixture({ contextHash: 'stale-context' }))

    expect(button('min.commit.source.unavailable').disabled).toBe(true)
    expect(button('min.commit.action.confirm').disabled).toBe(true)
    expect(button('min.commit.action.reject').disabled).toBe(false)
    expect(container.textContent).toContain('min.commit.stale.title')
  })

  it('보완된 필드를 확인 액션에 전달하고 새 데이터를 요청한다', async () => {
    await render(fixture({ ownerName: '김철수', ownerTeam: 'ERP', dueDate: '2026-07-20' }))

    await act(async () => button('min.commit.action.confirm').click())

    expect(mocks.review).toHaveBeenCalledWith({
      commitmentId: 'c1', status: 'confirmed', commitmentText: 'API 명세 확정',
      ownerName: '김철수', ownerTeam: 'ERP', ownerUnassigned: false,
      dueDate: '2026-07-20', dueUndecided: false,
    })
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('처리된 약속을 다시 검토 대기로 되돌릴 수 있다', async () => {
    await render(fixture({ reviewStatus: 'confirmed', reviewedAt: '2026-07-17T01:00:00Z' }))
    await act(async () => button('min.commit.tab.completed').click())
    await act(async () => button('min.commit.action.reopen').click())

    expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({
      commitmentId: 'c1', status: 'pending',
    }))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
})
