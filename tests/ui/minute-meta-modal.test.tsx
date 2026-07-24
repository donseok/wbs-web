// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Minute, MinuteFolder } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko' }),
}))
// 인자 시그니처를 제네릭으로 명시 — 인자 없는 vi.fn 은 mock.calls 가 빈 튜플로 추론돼 tsc(TS2493)가 깨진다
const updateMinuteMeta = vi.fn<(id: string, patch: unknown, folderId?: string) => Promise<{ ok: boolean }>>(
  async () => ({ ok: true }))
const fetchMinuteFoldersLite = vi.fn<() => Promise<MinuteFolder[]>>(async () => tree)
vi.mock('@/app/actions/minutes', () => ({
  updateMinuteMeta: (...a: unknown[]) => updateMinuteMeta(...(a as [string, unknown, string?])),
  fetchMinuteFoldersLite: () => fetchMinuteFoldersLite(),
  fetchProjectMeetingsLite: vi.fn(async () => []),
}))

import { MinuteMetaModal } from '@/components/minutes/MinuteMetaModal'

const F = (
  id: string, name: string, parentId: string | null = null,
  createdBy: string | null = null, sort = 0,
): MinuteFolder => ({ id, name, parentId, sort, createdBy })

const tree: MinuteFolder[] = [
  F('r-pmo', 'PMO'),
  F('r-erp', 'ERP'), F('c-sales', '영업', 'r-erp'), F('c-buy', '구매', 'r-erp'), F('c-acc', '관리회계', 'r-erp'),
  F('r-mes', 'MES'), F('c-q', '품질', 'r-mes'), F('c-plan', '생산계획', 'r-mes'),
  F('c-ops', '조업및표준화', 'r-mes'), F('c-log', '물류', 'r-mes'), F('c-fac', '설비및L2', 'r-mes'),
  F('r-gk', '가공'), F('r-mdm', 'MDM'),
]

const baseMinute = {
  id: 'm1', minuteDate: '2026-07-24', teamCode: 'MES', title: '주간회의', bodyMd: '',
  meetingId: null, createdBy: 'u1', createdByName: '홍길동', createdAt: 't', updatedAt: 't',
  fileCount: 0, bodyPreview: '', meetingCategory: null, folderId: 'c-q', meetingProjectId: null,
} as Minute

describe('MinuteMetaModal — 담당 하위 구분(수정)', () => {
  let container: HTMLDivElement, root: Root
  const onSaved = vi.fn()
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    updateMinuteMeta.mockClear(); onSaved.mockClear()
    fetchMinuteFoldersLite.mockImplementation(async () => tree)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(minute: Minute = baseMinute) {
    await act(async () => root.render(
      <MinuteMetaModal open onClose={() => {}} onSaved={onSaved} minute={minute} projects={[]} />,
    ))
  }
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
  const tablists = () => [...dialog().querySelectorAll<HTMLElement>('[role="tablist"]')]
  const tabsOf = (i: number) => [...tablists()[i].querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const clickTab = async (i: number, label: string) => {
    const tab = tabsOf(i).find(b => b.textContent === label)!
    await act(async () => tab.click())
  }
  const save = async () => {
    const btn = [...dialog().querySelectorAll<HTMLButtonElement>('button')]
      .find(b => b.textContent === 'min.meta.save')!
    await act(async () => btn.click())
  }

  it('현 소속 폴더(품질)로 하위 구분 초기화', async () => {
    await mount()
    expect(tabsOf(1).find(b => b.getAttribute('aria-selected') === 'true')?.textContent).toBe('품질')
  })

  it('하위 구분 변경(물류) 저장 → 해당 시드 폴더로 이동 전달', async () => {
    await mount()
    await clickTab(1, '물류')
    await save()
    expect(updateMinuteMeta.mock.calls[0][2]).toBe('c-log')
    expect(onSaved).toHaveBeenCalled()
  })

  it('무변경 저장은 폴더 무접촉(undefined) — 커스텀 편철 존중', async () => {
    await mount()
    await save()
    expect(updateMinuteMeta.mock.calls[0][2]).toBeUndefined()
  })

  it('팀 전환(ERP)은 하위 미지정 — 저장 시 ERP 루트로, 하위를 고르면 그 시드 자식으로', async () => {
    await mount()
    await clickTab(0, 'ERP')
    expect(tabsOf(1).map(b => b.textContent)).toEqual(['영업', '구매', '관리회계'])
    expect(tabsOf(1).some(b => b.getAttribute('aria-selected') === 'true')).toBe(false)  // 미지정
    await save()
    expect((updateMinuteMeta.mock.calls[0][1] as { teamCode: string }).teamCode).toBe('ERP')
    expect(updateMinuteMeta.mock.calls[0][2]).toBe('r-erp')
    updateMinuteMeta.mockClear()
    await clickTab(1, '구매')
    await save()
    expect(updateMinuteMeta.mock.calls[0][2]).toBe('c-buy')
  })

  it('팀 왕복(MES→ERP→MES)은 열림 시점 하위로 복원 — 저장해도 폴더 무접촉', async () => {
    await mount()
    await clickTab(0, 'ERP')
    await clickTab(0, 'MES')
    expect(tabsOf(1).find(b => b.getAttribute('aria-selected') === 'true')?.textContent).toBe('품질')
    await save()
    expect(updateMinuteMeta.mock.calls[0][2]).toBeUndefined()
  })

  it('같은 팀 탭 재클릭은 하위 선택을 리셋하지 않는다', async () => {
    await mount()
    await clickTab(1, '물류')
    await clickTab(0, 'MES')   // 이미 선택된 탭 재클릭
    expect(tabsOf(1).find(b => b.getAttribute('aria-selected') === 'true')?.textContent).toBe('물류')
  })

  it('팀 루트 편철(r-mes)은 하위 미지정으로 초기화 — 대표 하위(품질) 선택이 변경으로 판정돼 이동 가능', async () => {
    await mount({ ...baseMinute, folderId: 'r-mes' })
    expect(tabsOf(1).some(b => b.getAttribute('aria-selected') === 'true')).toBe(false)  // 허위 선택 없음
    await save()
    expect(updateMinuteMeta.mock.calls[0][2]).toBeUndefined()   // 무변경=무접촉
    updateMinuteMeta.mockClear()
    await clickTab(1, '품질')
    await save()
    expect(updateMinuteMeta.mock.calls[0][2]).toBe('c-q')       // 루트→대표 하위 이동 가능
  })

  it('미분류 회의록은 무변경 저장 시 담당 팀 루트로 편철(자기 치유)', async () => {
    await mount({ ...baseMinute, folderId: null })
    await save()
    expect(updateMinuteMeta.mock.calls[0][2]).toBe('r-mes')
  })

  it('폴더 응답 전 팀 전환은 초기화가 덮지 않는다(경합 가드)', async () => {
    let resolveFs!: (v: MinuteFolder[]) => void
    fetchMinuteFoldersLite.mockImplementation(() => new Promise<MinuteFolder[]>(r => { resolveFs = r }))
    await mount()
    await clickTab(0, 'ERP')                       // 응답 전 팀 전환
    await act(async () => { resolveFs(tree) })     // 이제 응답 도착
    expect(tabsOf(0).find(b => b.getAttribute('aria-selected') === 'true')?.textContent).toBe('ERP')
    expect(tabsOf(1).some(b => b.getAttribute('aria-selected') === 'true')).toBe(false)  // '품질'로 덮이지 않음
  })

  it('폴더 목록 미확보(빈 배열)면 하위 구분 숨김 + 폴더 무접촉', async () => {
    fetchMinuteFoldersLite.mockImplementation(async () => [])
    await mount()
    expect(tablists().length).toBe(1)
    await save()
    expect(updateMinuteMeta.mock.calls[0][2]).toBeUndefined()
  })
})
