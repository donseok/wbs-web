// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Minute, MinuteFolder } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko' }),
}))
const toast = vi.fn<(t: { title: string; variant?: string }) => void>()
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast }) }))
// 인자 시그니처를 제네릭으로 명시 — 인자 없는 vi.fn 은 mock.calls 가 빈 튜플로 추론돼 tsc(TS2493)가 깨진다
const updateMinuteMeta = vi.fn<(id: string, patch: unknown, folderId?: string) => Promise<{ ok: boolean }>>(
  async () => ({ ok: true }))
const clearMinuteExternalId = vi.fn<(id: string) => Promise<{ ok: boolean; error?: string }>>(
  async () => ({ ok: true }))
const fetchMinuteFoldersLite = vi.fn<() => Promise<MinuteFolder[]>>(async () => tree)
vi.mock('@/app/actions/minutes', () => ({
  updateMinuteMeta: (...a: unknown[]) => updateMinuteMeta(...(a as [string, unknown, string?])),
  clearMinuteExternalId: (id: string) => clearMinuteExternalId(id),
  fetchMinuteFoldersLite: () => fetchMinuteFoldersLite(),
  fetchProjectMeetingsLite: vi.fn(async () => []),
}))

import { MinuteMetaModal } from '@/components/minutes/MinuteMetaModal'

const F = (
  id: string, name: string, parentId: string | null = null,
  createdBy: string | null = null, sort = 0,
): MinuteFolder => ({ id, name, parentId, sort, createdBy })

// 시드 루트(createdBy=null)가 팀 루트 — teamSubOfFolder 가 여기까지 올라가 team 을 파생한다.
// g-weekly/m-202607 은 folder_path 로 들어오는 3·4단 — 저장 후에도 이 깊이가 유지돼야 한다(§6.8)
const tree: MinuteFolder[] = [
  F('r-pmo', 'PMO', null, null, 0),
  F('r-erp', 'ERP', null, null, 1),
  F('c-sales', '영업', 'r-erp', null, 0), F('c-buy', '구매', 'r-erp', null, 1),
  F('r-mes', 'MES', null, null, 2),
  F('c-q', '품질', 'r-mes', null, 0), F('c-log', '물류', 'r-mes', null, 3),
  F('g-weekly', '주간정례', 'c-q', 'u1', 100),
  F('m-202607', '2026-07', 'g-weekly', 'u1', 100),
]

const baseMinute = {
  id: 'm1', minuteDate: '2026-07-24', teamCode: 'MES', title: '주간회의', bodyMd: '',
  meetingId: null, createdBy: 'u1', createdByName: '홍길동', createdAt: 't', updatedAt: 't',
  fileCount: 0, bodyPreview: '', meetingCategory: null, folderId: 'c-q', meetingProjectId: null,
  externalId: null, archivedAt: null,
} as Minute

describe('MinuteMetaModal — 폴더 기준 수정 + 연동 식별자', () => {
  let container: HTMLDivElement, root: Root
  const onSaved = vi.fn()
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    updateMinuteMeta.mockClear(); clearMinuteExternalId.mockClear(); onSaved.mockClear(); toast.mockClear()
    clearMinuteExternalId.mockImplementation(async () => ({ ok: true }))
    fetchMinuteFoldersLite.mockImplementation(async () => tree)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(minute: Minute = baseMinute) {
    await act(async () => root.render(
      <MinuteMetaModal open onClose={() => {}} onSaved={onSaved} minute={minute} projects={[]} />,
    ))
  }
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
  const buttons = () => [...dialog().querySelectorAll<HTMLButtonElement>('button')]
  const byText = (label: string) => buttons().find(b => b.textContent === label)
  const options = () => [...dialog().querySelectorAll<HTMLButtonElement>('[role="option"]')]
  const pickFolder = async (name: string) => {
    const opt = options().find(b => b.textContent === name)!
    await act(async () => opt.click())
  }
  const save = async () => { await act(async () => byText('min.meta.save')!.click()) }
  const patchOf = (i = 0) => updateMinuteMeta.mock.calls[i][1] as { teamCode: string; title: string }

  it('담당·하위 구분 탭이 없고 폴더 트리로 대체된다', async () => {
    await mount()
    expect(dialog().querySelectorAll('[role="tablist"]').length).toBe(0)
    expect(dialog().querySelector('[role="listbox"]')).toBeTruthy()
    // 현 소속 폴더가 선택 상태로 초기화
    expect(options().find(b => b.getAttribute('aria-selected') === 'true')?.textContent).toBe('품질')
  })

  it('4단 폴더 편철분을 저장해도 그 폴더 그대로 전달(2단 강등 없음) — §6.8', async () => {
    await mount({ ...baseMinute, folderId: 'm-202607' })
    expect(options().find(b => b.getAttribute('aria-selected') === 'true')?.textContent).toBe('2026-07')
    await save()
    expect(updateMinuteMeta.mock.calls[0][2]).toBe('m-202607')
    expect(patchOf().teamCode).toBe('MES')          // 4단에서도 팀 파생은 시드 루트까지 올라간다
    expect(onSaved).toHaveBeenCalled()
  })

  it('폴더를 바꾸면 그 폴더 id 와 파생 팀이 함께 실린다', async () => {
    await mount()
    await pickFolder('구매')                        // MES/품질 → ERP/구매 (팀 교차)
    await save()
    expect(updateMinuteMeta.mock.calls[0][2]).toBe('c-buy')
    expect(patchOf().teamCode).toBe('ERP')
  })

  it('3단 폴더 선택도 팀 파생 후 그대로 전달', async () => {
    await mount()
    await pickFolder('주간정례')
    await save()
    expect(updateMinuteMeta.mock.calls[0][2]).toBe('g-weekly')
    expect(patchOf().teamCode).toBe('MES')
  })

  it('폴더 미선택(미분류)이면 저장 차단 + 안내', async () => {
    await mount({ ...baseMinute, folderId: null })
    await save()
    expect(updateMinuteMeta).not.toHaveBeenCalled()
    expect(dialog().textContent).toContain('min.form.folderRequired')
    await pickFolder('물류')                        // 고르면 저장된다
    await save()
    expect(updateMinuteMeta.mock.calls[0][2]).toBe('c-log')
  })

  it('팀 파생 불가 폴더(시드 체인 밖)는 선택 자체가 막힌다', async () => {
    fetchMinuteFoldersLite.mockImplementation(async () => [
      ...tree, F('x-root', '떠돌이', null, 'u1', 100),
    ])
    await mount()
    expect(options().find(b => b.textContent === '떠돌이')?.disabled).toBe(true)
  })

  it('폴더 조회 실패는 표시한다(조용한 빈 화면 금지)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMinuteFoldersLite.mockImplementation(async () => { throw new Error('boom') })
    await mount()
    expect(dialog().textContent).toContain('min.fold.error')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('ddobak 연동은 uuid 만 보이고 초기화 버튼이 살아 있다', async () => {
    await mount({ ...baseMinute, externalId: 'ddobak:abc-123' })
    expect(dialog().textContent).toContain('min.ext.label')
    expect(dialog().querySelector('code')?.textContent).toBe('abc-123')   // 프리픽스 제외
    expect(byText('min.ext.reset')?.disabled).toBe(false)
  })

  it('ddobak 이 아닌 값은 원문 그대로 + 다른 라벨', async () => {
    await mount({ ...baseMinute, externalId: 'legacy-77' })
    expect(dialog().textContent).toContain('min.ext.other')
    expect(dialog().querySelector('code')?.textContent).toBe('legacy-77')
  })

  it('연동 없음이면 초기화 버튼 비활성', async () => {
    await mount()
    expect(dialog().textContent).toContain('min.ext.none')
    expect(dialog().querySelector('code')).toBeNull()
    expect(byText('min.ext.reset')?.disabled).toBe(true)
  })

  it('보관 회의록은 연동이 있어도 초기화 비활성(재연결 불가 편도 방지)', async () => {
    await mount({ ...baseMinute, externalId: 'ddobak:abc-123', archivedAt: '2026-07-01' })
    expect(byText('min.ext.reset')?.disabled).toBe(true)
  })

  it('초기화는 확인 다이얼로그를 거쳐야 호출된다', async () => {
    await mount({ ...baseMinute, externalId: 'ddobak:abc-123' })
    await act(async () => byText('min.ext.reset')!.click())
    expect(clearMinuteExternalId).not.toHaveBeenCalled()          // 확인 전에는 호출 0
    expect(dialog().textContent).toContain('min.ext.resetWarn1')  // 3가지 경고를 모두 담는다
    expect(dialog().textContent).toContain('min.ext.resetWarn2')
    expect(dialog().textContent).toContain('min.ext.resetWarn3')
    await act(async () => byText('min.ext.resetConfirm')!.click())
    expect(clearMinuteExternalId).toHaveBeenCalledWith('m1')
    expect(toast.mock.calls[0][0].title).toBe('min.ext.resetDone')
    expect(onSaved).toHaveBeenCalled()
  })

  it('확인 다이얼로그 취소는 초기화하지 않는다', async () => {
    await mount({ ...baseMinute, externalId: 'ddobak:abc-123' })
    await act(async () => byText('min.ext.reset')!.click())
    await act(async () => byText('common.cancel')!.click())
    expect(clearMinuteExternalId).not.toHaveBeenCalled()
    expect(byText('min.ext.reset')).toBeTruthy()                  // 본 모달로 복귀
  })

  it('초기화 실패는 에러 토스트로 표시(삼키지 않는다)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    clearMinuteExternalId.mockImplementation(async () => ({ ok: false, error: '권한이 없습니다.' }))
    await mount({ ...baseMinute, externalId: 'ddobak:abc-123' })
    await act(async () => byText('min.ext.reset')!.click())
    await act(async () => byText('min.ext.resetConfirm')!.click())
    expect(toast.mock.calls[0][0]).toEqual({ title: '권한이 없습니다.', variant: 'error' })
    expect(onSaved).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('저장 실패는 문구로 표시하고 onSaved 를 부르지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    updateMinuteMeta.mockImplementation(async () => ({ ok: false, error: '저장 실패' }))
    await mount()
    await save()
    expect(dialog().textContent).toContain('저장 실패')
    expect(onSaved).not.toHaveBeenCalled()
    updateMinuteMeta.mockImplementation(async () => ({ ok: true }))
    spy.mockRestore()
  })
})
