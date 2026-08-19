// @vitest-environment jsdom
// RTL 은 이 리포에 없다(설치돼 있지 않고, 다른 UI 테스트도 전부 이 패턴이다) — house 패턴으로 쓴다.
// 골격은 tests/ui/issue-form-draft.test.tsx:1-40 복제(jsdom pragma·IS_REACT_ACT_ENVIRONMENT·
// container+root 라이프사이클·LocaleProvider mock).
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

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
import { MIGRATED_AUTHOR_NAME, type IssueUpdate } from '@/lib/domain/issueUpdates'
import type { ProjectMember } from '@/lib/domain/types'

function entry(over: Partial<IssueUpdate> = {}): IssueUpdate {
  return {
    id: 'u1', issueId: 'i1', kind: 'note', category: 'action', body: '첫 조치',
    mentionedMemberIds: [], authorUserId: 'me', authorName: '나',
    createdAt: '2026-08-19T01:00:00.000Z', archivedAt: null, archivedByName: null,
    ...over,
  }
}

const BASE = { issueId: 'i1', canWrite: true, currentUserId: 'me', isProjectAdmin: false, members: [] as ProjectMember[] }

async function flush() {
  await act(async () => { await Promise.resolve() })
}

function textNode(c: HTMLElement, text: string): HTMLElement | null {
  // 가장 안쪽 요소를 집는다 — 조상까지 textContent 가 일치하기 때문이다.
  return [...c.querySelectorAll<HTMLElement>('*')].reverse()
    .find(el => el.textContent?.trim() === text) ?? null
}

function buttonBy(c: HTMLElement, label: string): HTMLButtonElement | null {
  return [...c.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label) ?? null
}

function click(el: Element) {
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

// 제어 컴포넌트라 value 를 그냥 대입하면 React 가 못 본다 — 네이티브 setter 를 거쳐야 한다.
function typeInto(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  act(() => { el.dispatchEvent(new Event('input', { bubbles: true })) })
}

describe('IssueUpdates', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    listIssueUpdates.mockResolvedValue({ ok: true, items: [] })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  describe('목록', () => {
    it('비어 있으면 안내 문구를 보여준다', async () => {
      act(() => root.render(<IssueUpdates {...BASE} />))
      await flush()
      expect(textNode(container, 'issue.update.empty')).not.toBeNull()
    })

    it('조회 실패를 빈 목록으로 위장하지 않는다', async () => {
      listIssueUpdates.mockResolvedValue({ ok: false, error: 'boom' })
      act(() => root.render(<IssueUpdates {...BASE} />))
      await flush()
      expect(textNode(container, 'issue.err.updateLoadFailed')).not.toBeNull()
    })

    it('취소선 항목은 line-through 로 남고 내용이 지워지지 않는다', async () => {
      listIssueUpdates.mockResolvedValue({
        ok: true,
        items: [entry({ body: '철회된 조치', archivedAt: '2026-08-19T02:00:00.000Z', archivedByName: '나' })],
      })
      act(() => root.render(<IssueUpdates {...BASE} />))
      await flush()
      const body = textNode(container, '철회된 조치')
      expect(body).not.toBeNull()
      expect(body!.className).toContain('line-through')
    })

    it('6건이 넘으면 최신 5건만 펴고 더보기를 준다', async () => {
      listIssueUpdates.mockResolvedValue({
        ok: true,
        items: Array.from({ length: 7 }, (_, i) => entry({ id: `u${i}`, body: `내용${i}` })),
      })
      act(() => root.render(<IssueUpdates {...BASE} />))
      await flush()
      expect(textNode(container, '내용6')).not.toBeNull()
      expect(textNode(container, '내용0')).toBeNull()
      click(buttonBy(container, 'issue.update.more')!)
      await flush()
      expect(textNode(container, '내용0')).not.toBeNull()
    })

    it('상태 자동 기록은 본문 대신 상태 라벨로 렌더한다', async () => {
      listIssueUpdates.mockResolvedValue({
        ok: true, items: [entry({ kind: 'status', category: null, body: 'open>resolved' })],
      })
      act(() => root.render(<IssueUpdates {...BASE} />))
      await flush()
      // 원문 'open>resolved' 가 그대로 노출되면 안 된다.
      expect(textNode(container, 'issue.update.statusChange')).not.toBeNull()
      expect(textNode(container, 'open>resolved')).toBeNull()
    })

    it('이관된 행은 추정 안내를 보여준다', async () => {
      listIssueUpdates.mockResolvedValue({
        ok: true, items: [entry({ authorName: MIGRATED_AUTHOR_NAME })],
      })
      act(() => root.render(<IssueUpdates {...BASE} />))
      await flush()
      expect(textNode(container, 'issue.update.migrated')).not.toBeNull()
    })

    it('일반 행은 이관 안내를 보여주지 않는다', async () => {
      listIssueUpdates.mockResolvedValue({ ok: true, items: [entry()] })
      act(() => root.render(<IssueUpdates {...BASE} />))
      await flush()
      expect(textNode(container, 'issue.update.migrated')).toBeNull()
    })
  })

  describe('권한 어포던스', () => {
    it('조회 전용에게는 입력창이 없다', async () => {
      act(() => root.render(<IssueUpdates {...BASE} canWrite={false} />))
      await flush()
      expect(textNode(container, 'issue.update.empty')).not.toBeNull()
      expect(container.querySelector('textarea')).toBeNull()
    })

    it('멤버에게는 입력창이 있다', async () => {
      act(() => root.render(<IssueUpdates {...BASE} />))
      await flush()
      expect(container.querySelector('textarea')).not.toBeNull()
    })

    it('남의 이력에는 취소선 버튼이 없다', async () => {
      listIssueUpdates.mockResolvedValue({ ok: true, items: [entry({ authorUserId: 'other' })] })
      act(() => root.render(<IssueUpdates {...BASE} />))
      await flush()
      expect(textNode(container, '첫 조치')).not.toBeNull()
      expect(buttonBy(container, 'issue.update.archive')).toBeNull()
    })

    it('관리자에게는 남의 이력에도 취소선·완전삭제가 보인다', async () => {
      listIssueUpdates.mockResolvedValue({ ok: true, items: [entry({ authorUserId: 'other' })] })
      act(() => root.render(<IssueUpdates {...BASE} isProjectAdmin />))
      await flush()
      expect(textNode(container, '첫 조치')).not.toBeNull()
      expect(buttonBy(container, 'issue.update.archive')).not.toBeNull()
      expect(buttonBy(container, 'issue.update.purge')).not.toBeNull()
    })

    it('멤버에게는 자기 이력에도 완전삭제가 없다', async () => {
      listIssueUpdates.mockResolvedValue({ ok: true, items: [entry()] })
      act(() => root.render(<IssueUpdates {...BASE} />))
      await flush()
      expect(textNode(container, '첫 조치')).not.toBeNull()
      expect(buttonBy(container, 'issue.update.purge')).toBeNull()
    })
  })

  describe('등록', () => {
    it('등록 성공 후 입력창을 비우고 목록을 다시 읽는다', async () => {
      addIssueUpdate.mockResolvedValue({ ok: true })
      act(() => root.render(<IssueUpdates {...BASE} />))
      await flush()
      const box = container.querySelector('textarea')!
      typeInto(box, '새 조치')
      click(buttonBy(container, 'issue.update.add')!)
      await flush()
      expect(addIssueUpdate).toHaveBeenCalledWith('i1', {
        body: '새 조치', category: null, mentionedMemberIds: [],
      })
      expect(box.value).toBe('')
      expect(listIssueUpdates).toHaveBeenCalledTimes(2)
    })

    it('부분 실패를 성공으로 뭉개지 않는다', async () => {
      addIssueUpdate.mockResolvedValue({ ok: true, partial: '요약 반영 실패' })
      act(() => root.render(<IssueUpdates {...BASE} />))
      await flush()
      const box = container.querySelector('textarea')!
      typeInto(box, 'x')
      click(buttonBy(container, 'issue.update.add')!)
      await flush()
      expect(textNode(container, '요약 반영 실패')).not.toBeNull()
    })

    it('빈 본문으로는 등록 버튼이 눌리지 않는다', async () => {
      act(() => root.render(<IssueUpdates {...BASE} />))
      await flush()
      expect(buttonBy(container, 'issue.update.add')!.disabled).toBe(true)
    })

    it('액션 호출이 거부되면 아무 일도 없었던 것처럼 삼키지 않는다', async () => {
      addIssueUpdate.mockRejectedValue(new Error('boom'))
      act(() => root.render(<IssueUpdates {...BASE} />))
      await flush()
      const box = container.querySelector('textarea')!
      typeInto(box, '새 조치')
      click(buttonBy(container, 'issue.update.add')!)
      await flush()
      expect(textNode(container, 'issue.err.updateSaveFailed')).not.toBeNull()
    })
  })

  describe('멘션 입력', () => {
    const MEMBERS = [
      { id: 'm1', name: '김준기', hasAccount: true },
      { id: 'm2', name: '남순혁', hasAccount: true },
      { id: 'm3', name: '계정없음', hasAccount: false },
    ] as never[]

    it('@ 를 치면 계정이 연결된 멤버만 후보로 뜬다', async () => {
      act(() => root.render(<IssueUpdates {...BASE} members={MEMBERS} />))
      await flush()
      typeInto(container.querySelector('textarea')!, '@')
      expect(buttonBy(container, '김준기')).not.toBeNull()
      // 계정이 없으면 알림이 갈 수 없다 — 후보에서 뺀다.
      expect(buttonBy(container, '계정없음')).toBeNull()
    })

    it('후보를 고르면 본문에 이름이 들어가고 등록 시 member id 로 전송된다', async () => {
      addIssueUpdate.mockResolvedValue({ ok: true })
      act(() => root.render(<IssueUpdates {...BASE} members={MEMBERS} />))
      await flush()
      const box = container.querySelector('textarea')!
      typeInto(box, '@김준')
      click(buttonBy(container, '김준기')!)
      expect(box.value).toBe('@김준기 ')
      typeInto(box, '@김준기 확인 부탁드립니다')
      click(buttonBy(container, 'issue.update.add')!)
      await flush()
      expect(addIssueUpdate).toHaveBeenCalledWith('i1', {
        body: '@김준기 확인 부탁드립니다', category: null, mentionedMemberIds: ['m1'],
      })
    })

    it('골랐다가 본문에서 지운 멘션은 전송되지 않는다', async () => {
      addIssueUpdate.mockResolvedValue({ ok: true })
      act(() => root.render(<IssueUpdates {...BASE} members={MEMBERS} />))
      await flush()
      const box = container.querySelector('textarea')!
      typeInto(box, '@김준')
      click(buttonBy(container, '김준기')!)
      typeInto(box, '그냥 메모')
      click(buttonBy(container, 'issue.update.add')!)
      await flush()
      expect(addIssueUpdate).toHaveBeenCalledWith('i1', {
        body: '그냥 메모', category: null, mentionedMemberIds: [],
      })
    })

    it('후보는 입력한 검색어로 걸러진다', async () => {
      act(() => root.render(<IssueUpdates {...BASE} members={MEMBERS} />))
      await flush()
      typeInto(container.querySelector('textarea')!, '@남')
      expect(buttonBy(container, '남순혁')).not.toBeNull()
      expect(buttonBy(container, '김준기')).toBeNull()
    })

    it('등록에 성공하면 고른 멘션도 비워진다 — 다음 글에 손으로 같은 이름을 써도 전송되지 않는다', async () => {
      addIssueUpdate.mockResolvedValue({ ok: true })
      act(() => root.render(<IssueUpdates {...BASE} members={MEMBERS} />))
      await flush()
      const box = container.querySelector('textarea')!
      typeInto(box, '@김준')
      click(buttonBy(container, '김준기')!)
      typeInto(box, '@김준기 첫 글')
      click(buttonBy(container, 'issue.update.add')!)
      await flush()
      // 후보에서 다시 고르지 않고 손으로 같은 이름을 쓴다 — picked 가 안 비워졌다면
      // parseMentions 가 본문의 '@김준기' 를 이전에 고른 id 와 다시 짝지어 버린다.
      typeInto(box, '@김준기 두 번째 글')
      click(buttonBy(container, 'issue.update.add')!)
      await flush()
      expect(addIssueUpdate).toHaveBeenLastCalledWith('i1', {
        body: '@김준기 두 번째 글', category: null, mentionedMemberIds: [],
      })
    })
  })
})
