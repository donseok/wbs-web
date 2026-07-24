// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MinuteFolder } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko' }),
}))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
// 인자 시그니처를 제네릭으로 명시 — 인자 없는 vi.fn 은 mock.calls 가 빈 튜플로 추론돼 tsc(TS2493)가 깨진다
const createMinute = vi.fn<(input: unknown, folderId: string | null) => Promise<{ ok: boolean; id: string }>>(
  async () => ({ ok: true, id: 'm-new' }))
const recordMinuteFile = vi.fn<(...a: unknown[]) => Promise<{ ok: boolean }>>(async () => ({ ok: true }))
const fetchMinuteFoldersLite = vi.fn<() => Promise<MinuteFolder[]>>(async () => tree)
vi.mock('@/app/actions/minutes', () => ({
  createMinute: (...a: unknown[]) => createMinute(...(a as [unknown, string | null])),
  recordMinuteFile: (...a: unknown[]) => recordMinuteFile(...a),
  fetchProjectMeetingsLite: vi.fn(async () => []),
  fetchMinuteFoldersLite: () => fetchMinuteFoldersLite(),
}))
const upload = vi.fn(async () => ({ error: null }))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ storage: { from: () => ({ upload, remove: vi.fn(async () => ({})) }) } }),
}))

import { MinuteUploadModal } from '@/components/minutes/MinuteUploadModal'

const F = (
  id: string, name: string, parentId: string | null = null,
  createdBy: string | null = null, sort = 0,
): MinuteFolder => ({ id, name, parentId, sort, createdBy })

// sort 는 프로덕션 시드값(0043) — 하위 구분이 실폴더(sort→이름순)에서 동적 유도되므로 순서가 계약
const tree: MinuteFolder[] = [
  F('r-pmo', 'PMO', null, null, 0),
  F('r-erp', 'ERP', null, null, 1),
  F('c-sales', '영업', 'r-erp', null, 0), F('c-buy', '구매', 'r-erp', null, 1), F('c-acc', '관리회계', 'r-erp', null, 2),
  F('r-mes', 'MES', null, null, 2),
  F('c-q', '품질', 'r-mes', null, 0), F('c-plan', '생산계획', 'r-mes', null, 1),
  F('c-ops', '조업및표준화', 'r-mes', null, 2), F('c-log', '물류', 'r-mes', null, 3), F('c-fac', '설비및L2', 'r-mes', null, 4),
  F('r-gk', '가공', null, null, 3), F('r-mdm', 'MDM', null, null, 4),
]

describe('MinuteUploadModal — 담당 하위 구분(실폴더 트리 연동)', () => {
  let container: HTMLDivElement, root: Root
  const onSaved = vi.fn()
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    createMinute.mockClear(); recordMinuteFile.mockClear(); upload.mockClear(); onSaved.mockClear()
    fetchMinuteFoldersLite.mockImplementation(async () => tree)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(over: Partial<Parameters<typeof MinuteUploadModal>[0]> = {}) {
    await act(async () => root.render(
      <MinuteUploadModal open onClose={() => {}} onSaved={onSaved} todayIso="2026-07-24"
        projects={[]} folders={tree} defaultFolderId={null} {...over} />,
    ))
  }
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
  // 탭리스트 0 = 담당, 1 = 하위 구분 (렌더 순서 계약)
  const tablists = () => [...dialog().querySelectorAll<HTMLElement>('[role="tablist"]')]
  const tabsOf = (i: number) => [...tablists()[i].querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const clickTab = async (i: number, label: string) => {
    const tab = tabsOf(i).find(b => b.textContent === label)!
    await act(async () => tab.click())
  }

  it('단독 팀(PMO)은 하위 구분이 자기 자신 1개', async () => {
    await mount()
    expect(tabsOf(1).map(b => b.textContent)).toEqual(['PMO'])
  })

  it('ERP 선택 시 세부(영업/구매/관리회계), MES 선택 시 5구분 — 팀 전환마다 대표로 재설정', async () => {
    await mount()
    await clickTab(0, 'ERP')
    expect(tabsOf(1).map(b => b.textContent)).toEqual(['영업', '구매', '관리회계'])
    expect(tabsOf(1)[0].getAttribute('aria-selected')).toBe('true')
    await clickTab(0, 'MES')
    expect(tabsOf(1).map(b => b.textContent)).toEqual(['품질', '생산계획', '조업및표준화', '물류', '설비및L2'])
    expect(tabsOf(1)[0].getAttribute('aria-selected')).toBe('true')
  })

  it('저장 시 (팀, 하위) → 시드 폴더로 편철 — createMinute 에 하위 폴더 id 전달', async () => {
    await mount()
    await clickTab(0, 'ERP')
    await clickTab(1, '구매')
    const file = new File(['# 회의록 본문'], '구매정례.md', { type: 'text/markdown' })
    const input = dialog().querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    const saveBtn = [...dialog().querySelectorAll<HTMLButtonElement>('button')]
      .find(b => b.textContent === 'min.form.save')!
    await act(async () => saveBtn.click())
    expect(createMinute).toHaveBeenCalledTimes(1)
    expect(createMinute.mock.calls[0][0]).toMatchObject({ teamCode: 'ERP' })
    expect(createMinute.mock.calls[0][1]).toBe('c-buy')
    expect(onSaved).toHaveBeenCalled()
  })

  it('탐색기에서 시드 하위 폴더(품질)를 보며 열면 (MES, 품질)로 초기화', async () => {
    await mount({ defaultFolderId: 'c-q' })
    expect(tabsOf(0).find(b => b.getAttribute('aria-selected') === 'true')?.textContent).toBe('MES')
    expect(tabsOf(1).find(b => b.getAttribute('aria-selected') === 'true')?.textContent).toBe('품질')
  })

  it('폴더 목록 미확보(빈 배열)면 하위 구분을 숨긴다 — 허위 선택 방지(리뷰 반영)', async () => {
    fetchMinuteFoldersLite.mockImplementation(async () => [])   // 재조회도 실패(빈 폴백)
    await mount({ folders: [] })
    expect(tablists().length).toBe(1)                 // 담당 탭만
    expect(dialog().textContent).not.toContain('min.form.subTeam')
  })

  it('열림 시 재조회가 stale prop 을 대체 — 타 세션이 삭제한 폴더 탭이 사라지고 대표로 재설정(리뷰 반영)', async () => {
    // prop(stale)에는 MES 아래 '임시' 폴더가 있고 그 폴더를 보며 열었지만, 서버에는 이미 삭제됨
    const stale = [...tree, F('c-x', '임시', 'r-mes', 'u1', 100)]
    await mount({ folders: stale, defaultFolderId: 'c-x' })
    expect(tabsOf(1).map(b => b.textContent)).toEqual(['품질', '생산계획', '조업및표준화', '물류', '설비및L2'])
    expect(tabsOf(1).find(b => b.getAttribute('aria-selected') === 'true')?.textContent).toBe('품질')
  })

  it('재조회 응답의 신규 폴더가 탭에 반영 — 유효한 현재 선택은 무접촉', async () => {
    fetchMinuteFoldersLite.mockImplementation(async () => [...tree, F('u-new', '신규구분', 'r-mes', 'u1', 100)])
    await mount({ defaultFolderId: 'c-q' })           // (MES, 품질)로 열림
    expect(tabsOf(1).map(b => b.textContent))
      .toEqual(['품질', '생산계획', '조업및표준화', '물류', '설비및L2', '신규구분'])
    expect(tabsOf(1).find(b => b.getAttribute('aria-selected') === 'true')?.textContent).toBe('품질')
  })
})
