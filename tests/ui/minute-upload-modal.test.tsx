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
): MinuteFolder => ({ id, name, parentId, sort, createdBy, projectId: null })

// sort 는 프로덕션 시드값(0043) — 트리 표시 순서가 이 값에서 유도되므로 순서가 계약
const tree: MinuteFolder[] = [
  F('r-pmo', 'PMO', null, null, 0),
  F('r-erp', 'ERP', null, null, 1),
  F('c-sales', '영업', 'r-erp', null, 0), F('c-buy', '구매', 'r-erp', null, 1), F('c-acc', '관리회계', 'r-erp', null, 2),
  F('r-mes', 'MES', null, null, 2),
  F('c-q', '품질', 'r-mes', null, 0), F('c-plan', '생산계획', 'r-mes', null, 1),
]

describe('MinuteUploadModal — 폴더 직접 선택', () => {
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
  const dialogs = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
  const mainDialog = () => dialogs()[0]
  const pickerDialog = () => dialogs()[dialogs().length - 1]
  const folderFieldBtn = () =>
    [...mainDialog().querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('type') === 'button')!
  const openPicker = async () => { await act(async () => folderFieldBtn().click()) }
  const pickFolder = async (label: string) => {
    const btn = [...pickerDialog().querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label)!
    await act(async () => btn.click())
  }
  const attachBodyFile = async (name = '구매정례.md') => {
    const file = new File(['# 회의록 본문'], name, { type: 'text/markdown' })
    const input = mainDialog().querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  const clickSave = async () => {
    const saveBtn = [...mainDialog().querySelectorAll<HTMLButtonElement>('button')]
      .find(b => b.textContent === 'min.form.save')!
    await act(async () => saveBtn.click())
  }

  it('탐색기에서 보던 폴더(품질)를 보며 열면 폴더 필드가 그 이름으로 초기화', async () => {
    await mount({ defaultFolderId: 'c-q' })
    expect(folderFieldBtn().textContent).toContain('품질')
  })

  it('defaultFolderId 없으면 미분류로 초기화', async () => {
    await mount()
    expect(folderFieldBtn().textContent).toContain('min.fold.unfiled')
  })

  it('폴더 필드 클릭 → 트리 픽커가 뜨고, 하위 폴더 선택 시 필드에 반영되며 픽커가 닫힌다', async () => {
    await mount()
    await openPicker()
    expect(dialogs().length).toBe(2)
    await pickFolder('구매')
    expect(dialogs().length).toBe(1)
    expect(folderFieldBtn().textContent).toContain('구매')
  })

  it('저장 시 createMinute 에 선택한 폴더 id 그대로 전달, 담당은 그 폴더 소속 팀으로 파생', async () => {
    await mount()
    await openPicker()
    await pickFolder('구매')
    await attachBodyFile()
    await clickSave()
    expect(createMinute).toHaveBeenCalledTimes(1)
    expect(createMinute.mock.calls[0][0]).toMatchObject({ teamCode: 'ERP' })
    expect(createMinute.mock.calls[0][1]).toBe('c-buy')
    expect(onSaved).toHaveBeenCalled()
  })

  it('미분류 선택 시 defaultTeam 폴백으로 담당 파생, createMinute 에는 폴더 id null 전달', async () => {
    await mount({ defaultFolderId: 'c-q', defaultTeam: 'MDM' })
    await openPicker()
    await pickFolder('min.fold.unfiled')
    await attachBodyFile()
    await clickSave()
    expect(createMinute.mock.calls[0][0]).toMatchObject({ teamCode: 'MDM' })
    expect(createMinute.mock.calls[0][1]).toBe(null)
  })

  it('defaultTeam 도 없으면 활성 팀 1순위(PMO)로 담당 파생', async () => {
    await mount()   // defaultFolderId=null → 시작부터 미분류
    await attachBodyFile()
    await clickSave()
    expect(createMinute.mock.calls[0][0]).toMatchObject({ teamCode: 'PMO' })
  })

  it('열림 시 재조회 응답의 새 폴더가 픽커에 반영된다', async () => {
    fetchMinuteFoldersLite.mockImplementation(async () => [...tree, F('u-new', '신규폴더', 'r-mes', 'u1', 100)])
    await mount()
    await openPicker()
    expect([...pickerDialog().querySelectorAll('button')].some(b => b.textContent === '신규폴더')).toBe(true)
  })

  it('프로젝트가 하나뿐이면 기본 선택 — 고르지 않아 미연결로 쌓이는 것을 막는다', async () => {
    await mount({ projects: [{ id: 'p1', name: 'D-CUBE 프로젝트' }] })
    await attachBodyFile()
    await clickSave()
    expect(createMinute.mock.calls[0][0]).toMatchObject({ projectId: 'p1' })
  })

  it('여러 프로젝트 중 내가 멤버인 것이 하나면 그것으로 자동 선택', async () => {
    await mount({
      projects: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }],
      myProjectIds: ['p2'],
    })
    await attachBodyFile()
    await clickSave()
    expect(createMinute.mock.calls[0][0]).toMatchObject({ projectId: 'p2' })
  })

  it('내가 여러 프로젝트 멤버면 자동 선택하지 않는다 — 사람이 고른다', async () => {
    await mount({
      projects: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }],
      myProjectIds: ['p1', 'p2'],
    })
    await attachBodyFile()
    await clickSave()
    expect(createMinute.mock.calls[0][0]).toMatchObject({ projectId: null })
  })

  it('내 프로젝트가 셀렉트 앞쪽에 온다 — 여럿일 때 고르는 비용을 줄인다', async () => {
    await mount({
      projects: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }, { id: 'p3', name: 'C' }],
      myProjectIds: ['p3', 'p2'],
    })
    // 내 것이 앞으로 오되 그룹 안에서는 원래 목록 순서를 지킨다(sortMyProjectsFirst 계약)
    const opts = [...mainDialog().querySelectorAll('option')].map(o => o.value).filter(Boolean)
    expect(opts).toEqual(['p2', 'p3', 'p1'])
  })

  it('프로젝트가 둘 이상이고 소속 정보가 없으면 기본 선택하지 않는다', async () => {
    await mount({ projects: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }] })
    await attachBodyFile()
    await clickSave()
    expect(createMinute.mock.calls[0][0]).toMatchObject({ projectId: null })
  })

  it('프로젝트가 없으면 종전대로 미연결', async () => {
    await mount()
    await attachBodyFile()
    await clickSave()
    expect(createMinute.mock.calls[0][0]).toMatchObject({ projectId: null })
  })

  /* ── 폴더 픽커 프로젝트 스코프(0076) ── */

  const projectSelect = () => mainDialog().querySelector<HTMLSelectElement>('select')!
  async function chooseProject(pid: string) {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!
      setter.call(projectSelect(), pid)
      projectSelect().dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  it('폴더 픽커는 선택된 프로젝트 소속 폴더만 보여준다 — 교차 프로젝트 편철은 서버도 거부한다', async () => {
    const scoped: MinuteFolder[] = [
      { id: 'r-a', name: '루트A', parentId: null, sort: 0, createdBy: null, projectId: 'pA' },
      { id: 'r-b', name: '루트B', parentId: null, sort: 1, createdBy: null, projectId: 'pB' },
    ]
    fetchMinuteFoldersLite.mockImplementation(async () => scoped)
    await mount({ folders: scoped, projects: [{ id: 'pA', name: 'A' }, { id: 'pB', name: 'B' }] })
    await chooseProject('pA')
    await openPicker()
    expect([...pickerDialog().querySelectorAll('button')].some(b => b.textContent === '루트A')).toBe(true)
    expect([...pickerDialog().querySelectorAll('button')].some(b => b.textContent === '루트B')).toBe(false)
  })

  it('프로젝트를 바꾸면 스코프 밖 폴더 선택이 미분류로 해제된다', async () => {
    const scoped: MinuteFolder[] = [
      { id: 'r-a', name: '루트A', parentId: null, sort: 0, createdBy: null, projectId: 'pA' },
      { id: 'r-b', name: '루트B', parentId: null, sort: 1, createdBy: null, projectId: 'pB' },
    ]
    fetchMinuteFoldersLite.mockImplementation(async () => scoped)
    // myProjectIds로 pA를 자동 선택시켜 폴더(r-a)·프로젝트(pA)가 처음부터 정합하게 시작한다
    await mount({
      folders: scoped, defaultFolderId: 'r-a', myProjectIds: ['pA'],
      projects: [{ id: 'pA', name: 'A' }, { id: 'pB', name: 'B' }],
    })
    expect(folderFieldBtn().textContent).toContain('루트A')
    await chooseProject('pB')
    expect(folderFieldBtn().textContent).toContain('min.fold.unfiled')
  })

  it('같은 프로젝트를 유지하거나 스코프 안의 폴더면 선택을 건드리지 않는다', async () => {
    const scoped: MinuteFolder[] = [
      { id: 'r-a', name: '루트A', parentId: null, sort: 0, createdBy: null, projectId: 'pA' },
    ]
    fetchMinuteFoldersLite.mockImplementation(async () => scoped)
    await mount({
      folders: scoped, defaultFolderId: 'r-a', myProjectIds: ['pA'],
      projects: [{ id: 'pA', name: 'A' }, { id: 'pB', name: 'B' }],
    })
    expect(folderFieldBtn().textContent).toContain('루트A')
    await chooseProject('pA')   // 이미 그 프로젝트 소속 — 무접촉
    expect(folderFieldBtn().textContent).toContain('루트A')
  })

  it('탐색기에서 보던 폴더가 자동 선택된 프로젝트 밖이면 초기값으로 쓰지 않는다', async () => {
    const scoped: MinuteFolder[] = [
      { id: 'r-a', name: '루트A', parentId: null, sort: 0, createdBy: null, projectId: 'pA' },
      { id: 'r-b', name: '루트B', parentId: null, sort: 1, createdBy: null, projectId: 'pB' },
    ]
    fetchMinuteFoldersLite.mockImplementation(async () => scoped)
    // pB가 자동 선택(내 유일 소속)되는데 탐색기에서 보던 폴더는 pA 소속 — 어긋난 채로 보여주지 않는다
    await mount({
      folders: scoped, defaultFolderId: 'r-a', myProjectIds: ['pB'],
      projects: [{ id: 'pA', name: 'A' }, { id: 'pB', name: 'B' }],
    })
    expect(folderFieldBtn().textContent).toContain('min.fold.unfiled')
  })
})
