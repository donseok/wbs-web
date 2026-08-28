// @vitest-environment jsdom
// 공지 폼의 '마일스톤 타임라인에 표시' 체크 — 체크 시 날짜 입력(기본 게시 종료일)이 열리고 액션 입력에 실린다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Announcement } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  createAnnouncement: vi.fn(async () => ({ ok: true })),
  updateAnnouncement: vi.fn(async () => ({ ok: true })),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/app/actions/announcements', () => ({
  createAnnouncement: mocks.createAnnouncement,
  updateAnnouncement: mocks.updateAnnouncement,
}))
vi.mock('@/components/chat/BotPageContextProvider', () => ({ useBotPageContext: () => {} }))

import { LocaleProvider } from '@/components/providers/LocaleProvider'
import { AnnouncementFormModal } from '@/components/announcements/AnnouncementsView'

const LABEL = '마일스톤 타임라인에 표시'
const ANN: Announcement = {
  id: 'a1', projectId: 'p1', title: '본사 현업 설명회', body: '일시: 2026-09-10', category: 'general', isPinned: false,
  publishFrom: '2026-08-28', publishTo: '2026-09-10', milestoneDate: null,
  createdAt: '2026-08-27T00:00:00Z', updatedAt: '2026-08-27T00:00:00Z',
}

describe('공지 폼 — 마일스톤 표시 체크', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); mocks.updateAnnouncement.mockClear() })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  const render = (initial: Announcement) => act(async () => root.render(
    <LocaleProvider initialLocale="ko"><AnnouncementFormModal open onClose={() => {}} projectId="p1" initial={initial} /></LocaleProvider>,
  ))
  const checkbox = () => [...document.querySelectorAll('label')].find(l => l.textContent?.includes(LABEL))!.querySelector('input[type=checkbox]') as HTMLInputElement
  const dateInputs = () => [...document.querySelectorAll('input[type=date]')] as HTMLInputElement[]
  const clickSave = () => act(async () => { ([...document.querySelectorAll('button')].find(b => b.textContent === '저장') as HTMLButtonElement).click() })

  it('기본은 체크 해제 + 날짜 입력 없음(게시 기간 2개뿐)', async () => {
    await render(ANN)
    expect(checkbox().checked).toBe(false)
    expect(dateInputs()).toHaveLength(2)
  })

  it('체크하면 마일스톤 일자 입력이 열리고 기본값은 게시 종료일 — 저장 시 milestoneDate 로 실린다', async () => {
    await render(ANN)
    await act(async () => { checkbox().click() })
    expect(dateInputs()).toHaveLength(3)
    expect(dateInputs()[2].value).toBe('2026-09-10')
    await clickSave()
    expect(mocks.updateAnnouncement).toHaveBeenCalledWith('a1', expect.objectContaining({ milestoneDate: '2026-09-10' }))
  })

  it('이미 날짜가 있는 공지는 체크된 채 열리고, 체크를 풀면 null 로 저장된다', async () => {
    await render({ ...ANN, milestoneDate: '2026-09-02' })
    expect(checkbox().checked).toBe(true)
    expect(dateInputs()[2].value).toBe('2026-09-02')
    await act(async () => { checkbox().click() })
    await clickSave()
    expect(mocks.updateAnnouncement).toHaveBeenCalledWith('a1', expect.objectContaining({ milestoneDate: null }))
  })
})
