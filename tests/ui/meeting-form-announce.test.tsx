// @vitest-environment jsdom
// 회의 등록 폼의 '공지사항으로도 등록' 배선 — 게이트(생성+pmo_admin)와 액션 호출 인자를 고정한다.
// 실제 LocaleProvider/dict/Modal 로 구동, 서버 액션만 목킹.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  createMeeting: vi.fn(async () => ({ ok: true, id: 'm-new' })),
  updateMeeting: vi.fn(async () => ({ ok: true, id: 'm-old' })),
  notifyMeetingSaved: vi.fn(async () => ({ ok: true, sentTo: [], skipped: [] })),
  createAnnouncementFromMeeting: vi.fn(async () => ({ ok: true })),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/app/actions/meetings', () => ({
  createMeeting: mocks.createMeeting,
  updateMeeting: mocks.updateMeeting,
}))
vi.mock('@/app/actions/meetingNotify', () => ({
  notifyMeetingSaved: mocks.notifyMeetingSaved,
}))
vi.mock('@/app/actions/announcements', () => ({
  createAnnouncementFromMeeting: mocks.createAnnouncementFromMeeting,
}))

import { LocaleProvider } from '@/components/providers/LocaleProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { MeetingFormModal } from '@/components/meetings/MeetingFormModal'
import type { Meeting } from '@/lib/domain/types'

const LABEL = '이 회의를 공지사항으로도 등록'

const MEETING: Meeting = {
  id: 'm-old', projectId: 'p1', title: '주간 점검', meetingDate: '2026-07-25',
  startTime: '10:00', endTime: '11:00', location: null, category: 'routine',
  body: '', recurrence: 'none', recurrenceUntil: null, createdBy: 'u1',
  createdByName: '김철수', createdAt: '2026-07-24T00:00:00Z', updatedAt: '2026-07-24T00:00:00Z',
  attendeeIds: [],
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('MeetingFormModal — 공지사항으로도 등록', () => {
  let container: HTMLDivElement
  let root: Root
  const onSaved = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function renderForm(role: string | null, initial: Meeting | null = null) {
    await act(async () => root.render(
      <LocaleProvider>
        <ToastProvider>
          <MeetingFormModal
            open projectId="p1" members={[]} initial={initial} todayIso="2026-07-24"
            role={role} onClose={() => {}} onSaved={onSaved}
          />
        </ToastProvider>
      </LocaleProvider>,
    ))
  }

  function announceCheckbox(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>('#announce-meeting')
  }

  async function fillTitleAndSave() {
    await act(async () => {
      type(document.querySelectorAll<HTMLInputElement>('input')[0], '주간 점검')
    })
    const save = [...document.querySelectorAll('button')].find(b => b.textContent === '저장')!
    await act(async () => { (save as HTMLButtonElement).click() })
  }

  it('pmo_admin 의 새 회의 폼에만 체크박스가 보인다', async () => {
    await renderForm('pmo_admin')
    expect(announceCheckbox()).not.toBeNull()
    expect(document.body.textContent).toContain(LABEL)
    expect(announceCheckbox()!.checked).toBe(false) // 기본 꺼짐(옵트인)
  })

  it('pmo_admin 이 아니면 체크박스가 없다', async () => {
    await renderForm('team_editor')
    expect(announceCheckbox()).toBeNull()
  })

  it('수정 폼에는 pmo_admin 이어도 체크박스가 없다 — 공지는 생성 전용', async () => {
    await renderForm('pmo_admin', MEETING)
    expect(announceCheckbox()).toBeNull()
  })

  it('체크하고 저장하면 새 회의 id 와 첫 회차 날짜로 공지 액션을 부른다', async () => {
    await renderForm('pmo_admin')
    await act(async () => { announceCheckbox()!.click() })
    await fillTitleAndSave()

    expect(mocks.createMeeting).toHaveBeenCalledTimes(1)
    expect(mocks.createAnnouncementFromMeeting).toHaveBeenCalledWith('m-new', '2026-07-24')
    expect(onSaved).toHaveBeenCalled() // 참석자 없음 → 메일 생략, 정상 종료
    expect(document.body.textContent).toContain('회의가 공지사항으로 등록되었습니다.')
  })

  it('체크하지 않으면 공지 액션을 부르지 않는다', async () => {
    await renderForm('pmo_admin')
    await fillTitleAndSave()
    expect(mocks.createMeeting).toHaveBeenCalledTimes(1)
    expect(mocks.createAnnouncementFromMeeting).not.toHaveBeenCalled()
  })

  it('반복 회의로 체크하면 첫 회차만 공지된다는 힌트가 보인다', async () => {
    await renderForm('pmo_admin')
    await act(async () => { announceCheckbox()!.click() })
    expect(document.body.textContent).not.toContain('첫 회차 1건만 공지됩니다')

    const recurrence = [...document.querySelectorAll<HTMLSelectElement>('select')]
      .find(s => [...s.options].some(o => o.value === 'weekly'))!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!
      setter.call(recurrence, 'weekly')
      recurrence.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(document.body.textContent).toContain('반복 회의는 첫 회차 1건만 공지됩니다.')
  })

  it('공지 등록이 실패해도 회의 저장은 정상 종료하고 실패를 토스트로 알린다', async () => {
    mocks.createAnnouncementFromMeeting.mockResolvedValueOnce({ ok: false, error: '권한 없음' } as never)
    await renderForm('pmo_admin')
    await act(async () => { announceCheckbox()!.click() })
    await fillTitleAndSave()

    expect(onSaved).toHaveBeenCalled()
    expect(document.body.textContent).toContain('회의는 저장되었으나 공지 등록에 실패했습니다')
  })
})
