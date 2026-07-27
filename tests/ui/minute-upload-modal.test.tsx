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

// sort 는 프로덕션 시드값(0043). created_by = null 이 시드 팀 루트의 표식이고, 팀 파생(teamSubOfFolder)이
// 이 루트에 닿는지로 선택 가능 여부가 갈리므로 트리 모양 자체가 계약이다
const tree: MinuteFolder[] = [
  F('r-pmo', 'PMO', null, null, 0),
  F('r-erp', 'ERP', null, null, 1),
  F('c-sales', '영업', 'r-erp', null, 0), F('c-buy', '구매', 'r-erp', null, 1), F('c-acc', '관리회계', 'r-erp', null, 2),
  F('r-mes', 'MES', null, null, 2),
  F('c-q', '품질', 'r-mes', null, 0), F('c-plan', '생산계획', 'r-mes', null, 1),
  F('c-ops', '조업및표준화', 'r-mes', null, 2), F('c-log', '물류', 'r-mes', null, 3), F('c-fac', '설비및L2', 'r-mes', null, 4),
  F('r-gk', '가공', null, null, 3), F('r-mdm', 'MDM', null, null, 4),
]

describe('MinuteUploadModal — 폴더 기준 업로드(§6.1-1 W19)', () => {
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
  const options = () => [...dialog().querySelectorAll<HTMLButtonElement>('[role="option"]')]
  const optionOf = (label: string) => options().find(b => b.textContent === label)!
  const selectedOption = () => options().find(b => b.getAttribute('aria-selected') === 'true')
  const pick = async (label: string) => { await act(async () => optionOf(label).click()) }
  const saveBtn = () => [...dialog().querySelectorAll<HTMLButtonElement>('button')]
    .find(b => b.textContent === 'min.form.save' || b.textContent === 'min.form.saving')!
  /** 본문 .md 첨부 — 폴더 조건만 남기기 위해 모든 저장 테스트가 공유 */
  async function attachBody(name = '구매정례.md') {
    const file = new File(['# 회의록 본문'], name, { type: 'text/markdown' })
    const input = dialog().querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  }

  it('담당·하위 구분 탭이 사라지고 폴더 트리 하나로 대체된다', async () => {
    await mount()
    expect(dialog().querySelectorAll('[role="tablist"]').length).toBe(0)
    expect(dialog().textContent).not.toContain('min.form.team')
    expect(dialog().textContent).not.toContain('min.form.subTeam')
    expect(dialog().querySelectorAll('[role="listbox"]').length).toBe(1)
    // 팀 루트와 하위 폴더가 한 트리에 함께 — 2단계로 나뉘어 있지 않다
    expect(options().map(b => b.textContent)).toContain('ERP')
    expect(options().map(b => b.textContent)).toContain('구매')
  })

  it('폴더 미선택이면 본문을 붙여도 저장 버튼이 비활성 — 필수 안내 표시', async () => {
    await mount()
    await attachBody()
    expect(saveBtn().disabled).toBe(true)
    expect(dialog().textContent).toContain('min.form.folderRequired')
  })

  it('폴더를 고르면 활성화되고, createMinute 에 (파생 team, 선택 폴더 id)가 전달된다', async () => {
    await mount()
    await attachBody()
    await pick('구매')
    expect(saveBtn().disabled).toBe(false)
    expect(dialog().textContent).not.toContain('min.form.folderRequired')
    await act(async () => saveBtn().click())
    expect(createMinute).toHaveBeenCalledTimes(1)
    expect(createMinute.mock.calls[0][0]).toMatchObject({ teamCode: 'ERP' })
    expect(createMinute.mock.calls[0][1]).toBe('c-buy')
    expect(onSaved).toHaveBeenCalled()
  })

  it('3단 이상 폴더를 보며 열면 그 폴더가 초기 선택이고 그대로 저장 — 2단 강등 없음(§6.2)', async () => {
    const deep = [...tree, F('g-week', '주간정례', 'c-q', 'u1', 100), F('g-m', '2026-07', 'g-week', 'u1', 100)]
    fetchMinuteFoldersLite.mockImplementation(async () => deep)
    await mount({ folders: deep, defaultFolderId: 'g-m' })
    expect(selectedOption()?.textContent).toBe('2026-07')
    await attachBody()
    await act(async () => saveBtn().click())
    expect(createMinute.mock.calls[0][0]).toMatchObject({ teamCode: 'MES' })
    expect(createMinute.mock.calls[0][1]).toBe('g-m')
  })

  it('팀 파생 불가 폴더(시드 체인 밖)면 저장이 막히고 안내가 뜬다 — 기본 팀 폴백 금지(§6.3)', async () => {
    const orphan = [...tree, F('u-root', '임시자료', null, 'u1', 100)]
    fetchMinuteFoldersLite.mockImplementation(async () => orphan)
    await mount({ folders: orphan, defaultFolderId: 'u-root' })
    await attachBody()
    expect(saveBtn().disabled).toBe(true)
    expect(dialog().textContent).toContain('min.form.folderNoTeam')
    expect(optionOf('임시자료').disabled).toBe(true)   // 고를 수조차 없어야 한다(허위 어포던스 방지)
    expect(createMinute).not.toHaveBeenCalled()
  })

  it('폴더 목록 미확보(빈 배열)면 고를 것이 없고 저장 불가 — 조용한 자동 편철 금지', async () => {
    fetchMinuteFoldersLite.mockImplementation(async () => [])   // 재조회도 실패(빈 폴백)
    await mount({ folders: [] })
    await attachBody()
    expect(options().length).toBe(0)
    expect(saveBtn().disabled).toBe(true)
  })

  it('열림 시 재조회가 stale prop 을 대체 — 타 세션이 삭제한 폴더는 선택 해제(리뷰 반영)', async () => {
    // prop(stale)에는 MES 아래 '임시' 폴더가 있고 그 폴더를 보며 열었지만, 서버에는 이미 삭제됨
    const stale = [...tree, F('c-x', '임시', 'r-mes', 'u1', 100)]
    await mount({ folders: stale, defaultFolderId: 'c-x' })
    expect(options().map(b => b.textContent)).not.toContain('임시')
    expect(selectedOption()).toBeUndefined()
    await attachBody()
    expect(saveBtn().disabled).toBe(true)     // 죽은 폴더로 저장 시도하다 반복 실패하지 않는다
  })

  it('재조회 응답의 신규 폴더가 트리에 반영 — 유효한 현재 선택은 무접촉', async () => {
    fetchMinuteFoldersLite.mockImplementation(async () => [...tree, F('u-new', '신규구분', 'r-mes', 'u1', 100)])
    await mount({ defaultFolderId: 'c-q' })
    expect(options().map(b => b.textContent)).toContain('신규구분')
    expect(selectedOption()?.textContent).toBe('품질')
  })
})
