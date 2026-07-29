// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Minute } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko' }),
}))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
const updateMinuteMeta = vi.fn<
  (id: string, patch: Record<string, unknown>, folderId?: string | null) => Promise<{ ok: boolean }>
>(async () => ({ ok: true }))
vi.mock('@/app/actions/minutes', () => ({
  updateMinuteMeta: (...a: unknown[]) =>
    updateMinuteMeta(...(a as [string, Record<string, unknown>, string | null | undefined])),
  fetchMinuteFoldersLite: vi.fn(async () => []),
  fetchProjectMeetingsLite: vi.fn(async () => []),
  resetMinuteExternalId: vi.fn(async () => ({ ok: true })),
}))

import { MinuteMetaModal } from '@/components/minutes/MinuteMetaModal'

const base: Minute = {
  id: 'm1', minuteDate: '2026-07-24', teamCode: 'MES', title: '회의록',
  bodyMd: '', meetingId: null, createdBy: 'u1', createdByName: '홍길동',
  createdAt: '2026-07-24T00:00:00Z', updatedAt: '2026-07-24T00:00:00Z',
  projectId: null, folderId: 'f1',
}
const projects = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }]

describe('MinuteMetaModal — 소속 기반 프로젝트 기본 선택', () => {
  let container: HTMLDivElement, root: Root

  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    updateMinuteMeta.mockClear()
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(minute: Minute, myProjectIds: string[] | null) {
    await act(async () => root.render(
      <MinuteMetaModal open onClose={() => {}} onSaved={() => {}} minute={minute}
        projects={projects} myProjectIds={myProjectIds} />,
    ))
  }
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
  const save = async () => {
    const btn = [...dialog().querySelectorAll('button')].find(b => b.textContent?.includes('min.meta.save'))!
    await act(async () => btn.click())
  }
  const savedProjectId = () => updateMinuteMeta.mock.calls[0][1].projectId

  it('프로젝트가 비어 있으면 내 소속으로 채운다', async () => {
    await mount(base, ['p2'])
    await save()
    expect(savedProjectId()).toBe('p2')
  })

  it('이미 귀속이 있으면 내 소속이 달라도 건드리지 않는다 — 남의 회의록이 조용히 옮겨지면 안 된다', async () => {
    await mount({ ...base, projectId: 'p1' }, ['p2'])
    await save()
    expect(savedProjectId()).toBe('p1')
  })

  it('회의를 통한 귀속(meetingProjectId)도 기존 값으로 존중한다', async () => {
    await mount({ ...base, projectId: null, meetingProjectId: 'p1' }, ['p2'])
    await save()
    expect(savedProjectId()).toBe('p1')
  })

  it('내 소속이 여럿이면 채우지 않는다 — 사람이 고른다', async () => {
    await mount(base, ['p1', 'p2'])
    await save()
    expect(savedProjectId()).toBeNull()
  })

  it('소속 조회 실패(null)여도 화면은 정상 동작한다', async () => {
    await mount(base, null)
    await save()
    expect(savedProjectId()).toBeNull()
  })

  it('내 프로젝트가 셀렉트 앞쪽에 온다', async () => {
    await mount(base, ['p2'])
    const opts = [...dialog().querySelectorAll('option')].map(o => o.value).filter(Boolean)
    expect(opts).toEqual(['p2', 'p1'])
  })
})
