// @vitest-environment jsdom
// vitest.config.ts 의 기본 environment 는 'node' 다 — RTL 은 DOM 이 필요해 파일 단위로 override 한다
// (tests/ui/deep-link-params.test.tsx 의 관례와 같다).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// jest-dom 매처(toBeInTheDocument 등)를 expect 에 등록한다. 이 리포에서 RTL 을 쓰는 첫 테스트라
// 전역 setupFiles 가 없다 — 여기서 파일 단위로 로드한다.
import '@testing-library/jest-dom/vitest'

const { listIssueUpdates, addIssueUpdate, archiveIssueUpdate, unarchiveIssueUpdate, purgeIssueUpdate } = vi.hoisted(() => ({
  listIssueUpdates: vi.fn(), addIssueUpdate: vi.fn(), archiveIssueUpdate: vi.fn(),
  unarchiveIssueUpdate: vi.fn(), purgeIssueUpdate: vi.fn(),
}))
vi.mock('@/app/actions/issueUpdates', () => ({
  listIssueUpdates, addIssueUpdate, archiveIssueUpdate, unarchiveIssueUpdate, purgeIssueUpdate,
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (k: string) => k }),
}))

import { IssueUpdates } from '@/components/issues/IssueUpdates'
import type { IssueUpdate } from '@/lib/domain/issueUpdates'

function entry(over: Partial<IssueUpdate> = {}): IssueUpdate {
  return {
    id: 'u1', issueId: 'i1', kind: 'note', category: 'action', body: '첫 조치',
    mentionedMemberIds: [], authorUserId: 'me', authorName: '나',
    createdAt: '2026-08-19T01:00:00.000Z', archivedAt: null, archivedByName: null,
    ...over,
  }
}

const BASE = { issueId: 'i1', canWrite: true, currentUserId: 'me', isProjectAdmin: false }

beforeEach(() => {
  vi.clearAllMocks()
  listIssueUpdates.mockResolvedValue({ ok: true, items: [] })
})

// vitest.config.ts 는 test.globals 를 켜지 않는다 — RTL 의 자동 cleanup 은 전역 afterEach 를
// 감지하는 방식이라 여기선 조용히 동작하지 않는다. 명시적으로 부르지 않으면 이전 render() 의
// DOM 이 남아 다음 테스트에서 '여러 개 찾음' 오류가 난다.
afterEach(() => cleanup())

describe('IssueUpdates 목록', () => {
  it('비어 있으면 안내 문구를 보여준다', async () => {
    render(<IssueUpdates {...BASE} />)
    expect(await screen.findByText('issue.update.empty')).toBeInTheDocument()
  })

  it('조회 실패를 빈 목록으로 위장하지 않는다', async () => {
    listIssueUpdates.mockResolvedValue({ ok: false, error: 'boom' })
    render(<IssueUpdates {...BASE} />)
    expect(await screen.findByText('issue.err.updateLoadFailed')).toBeInTheDocument()
  })

  it('취소선 항목은 line-through 로 남고 내용이 지워지지 않는다', async () => {
    listIssueUpdates.mockResolvedValue({
      ok: true,
      items: [entry({ body: '철회된 조치', archivedAt: '2026-08-19T02:00:00.000Z', archivedByName: '나' })],
    })
    render(<IssueUpdates {...BASE} />)
    const body = await screen.findByText('철회된 조치')
    expect(body.className).toContain('line-through')
  })

  it('6건이 넘으면 최신 5건만 펴고 더보기를 준다', async () => {
    listIssueUpdates.mockResolvedValue({
      ok: true,
      items: Array.from({ length: 7 }, (_, i) => entry({ id: `u${i}`, body: `내용${i}` })),
    })
    render(<IssueUpdates {...BASE} />)
    expect(await screen.findByText('내용6')).toBeInTheDocument()
    expect(screen.queryByText('내용0')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /issue\.update\.more/ }))
    expect(screen.getByText('내용0')).toBeInTheDocument()
  })

  it('상태 자동 기록은 본문 대신 상태 라벨로 렌더한다', async () => {
    listIssueUpdates.mockResolvedValue({
      ok: true, items: [entry({ kind: 'status', category: null, body: 'open>resolved' })],
    })
    render(<IssueUpdates {...BASE} />)
    // 원문 'open>resolved' 가 그대로 노출되면 안 된다.
    expect(await screen.findByText(/issue\.update\.statusChange/)).toBeInTheDocument()
    expect(screen.queryByText('open>resolved')).not.toBeInTheDocument()
  })
})

describe('IssueUpdates 권한 어포던스', () => {
  it('조회 전용에게는 입력창이 없다', async () => {
    render(<IssueUpdates {...BASE} canWrite={false} />)
    await screen.findByText('issue.update.empty')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('멤버에게는 입력창이 있다', async () => {
    render(<IssueUpdates {...BASE} />)
    expect(await screen.findByRole('textbox')).toBeInTheDocument()
  })

  it('남의 이력에는 취소선 버튼이 없다', async () => {
    listIssueUpdates.mockResolvedValue({ ok: true, items: [entry({ authorUserId: 'other' })] })
    render(<IssueUpdates {...BASE} />)
    await screen.findByText('첫 조치')
    expect(screen.queryByRole('button', { name: 'issue.update.archive' })).not.toBeInTheDocument()
  })

  it('관리자에게는 남의 이력에도 취소선·완전삭제가 보인다', async () => {
    listIssueUpdates.mockResolvedValue({ ok: true, items: [entry({ authorUserId: 'other' })] })
    render(<IssueUpdates {...BASE} isProjectAdmin />)
    await screen.findByText('첫 조치')
    expect(screen.getByRole('button', { name: 'issue.update.archive' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'issue.update.purge' })).toBeInTheDocument()
  })

  it('멤버에게는 자기 이력에도 완전삭제가 없다', async () => {
    listIssueUpdates.mockResolvedValue({ ok: true, items: [entry()] })
    render(<IssueUpdates {...BASE} />)
    await screen.findByText('첫 조치')
    expect(screen.queryByRole('button', { name: 'issue.update.purge' })).not.toBeInTheDocument()
  })
})

describe('IssueUpdates 등록', () => {
  it('등록 성공 후 입력창을 비우고 목록을 다시 읽는다', async () => {
    addIssueUpdate.mockResolvedValue({ ok: true })
    render(<IssueUpdates {...BASE} />)
    const box = await screen.findByRole('textbox')
    await userEvent.type(box, '새 조치')
    await userEvent.click(screen.getByRole('button', { name: 'issue.update.add' }))
    await waitFor(() => expect(addIssueUpdate).toHaveBeenCalledWith('i1', {
      body: '새 조치', category: null, mentionedMemberIds: [],
    }))
    await waitFor(() => expect(box).toHaveValue(''))
    expect(listIssueUpdates).toHaveBeenCalledTimes(2)
  })

  it('부분 실패를 성공으로 뭉개지 않는다', async () => {
    addIssueUpdate.mockResolvedValue({ ok: true, partial: '요약 반영 실패' })
    render(<IssueUpdates {...BASE} />)
    await userEvent.type(await screen.findByRole('textbox'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'issue.update.add' }))
    expect(await screen.findByText('요약 반영 실패')).toBeInTheDocument()
  })

  it('빈 본문으로는 등록 버튼이 눌리지 않는다', async () => {
    render(<IssueUpdates {...BASE} />)
    await screen.findByRole('textbox')
    expect(screen.getByRole('button', { name: 'issue.update.add' })).toBeDisabled()
  })
})
