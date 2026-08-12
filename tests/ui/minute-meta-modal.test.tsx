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
const updateMinuteMeta = vi.fn<(id: string, patch: unknown, folderId?: string | null) => Promise<{ ok: boolean; error?: string }>>(
  async () => ({ ok: true }))
const resetMinuteExternalId = vi.fn<(id: string) => Promise<{ ok: boolean; error?: string }>>(
  async () => ({ ok: true }))
const fetchMinuteFoldersLite = vi.fn<() => Promise<MinuteFolder[]>>(async () => tree)
vi.mock('@/app/actions/minutes', () => ({
  updateMinuteMeta: (...a: unknown[]) => updateMinuteMeta(...(a as [string, unknown, string?])),
  resetMinuteExternalId: (...a: unknown[]) => resetMinuteExternalId(...(a as [string])),
  fetchMinuteFoldersLite: () => fetchMinuteFoldersLite(),
  fetchProjectMeetingsLite: vi.fn(async () => []),
}))

import { MinuteMetaModal } from '@/components/minutes/MinuteMetaModal'

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

const baseMinute = {
  id: 'm1', minuteDate: '2026-07-24', teamCode: 'MES', title: '주간회의', bodyMd: '',
  meetingId: null, createdBy: 'u1', createdByName: '홍길동', createdAt: 't', updatedAt: 't',
  fileCount: 0, bodyPreview: '', meetingCategory: null, folderId: 'c-q', meetingProjectId: null,
  externalId: null,
} as Minute

describe('MinuteMetaModal — 폴더 직접 선택 + 또박또박 연결', () => {
  let container: HTMLDivElement, root: Root
  const onSaved = vi.fn()
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    updateMinuteMeta.mockClear(); resetMinuteExternalId.mockClear(); onSaved.mockClear()
    fetchMinuteFoldersLite.mockImplementation(async () => tree)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(minute: Minute = baseMinute, projects: { id: string; name: string }[] = []) {
    await act(async () => root.render(
      <MinuteMetaModal open onClose={() => {}} onSaved={onSaved} minute={minute} projects={projects} />,
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
  const save = async () => {
    const btn = [...mainDialog().querySelectorAll<HTMLButtonElement>('button')]
      .find(b => b.textContent === 'min.meta.save')!
    await act(async () => btn.click())
  }
  const btnByText = (label: string) =>
    [...mainDialog().querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label)

  it('현 소속 폴더(품질)로 필드 초기화', async () => {
    await mount()
    expect(folderFieldBtn().textContent).toContain('품질')
  })

  it('폴더 변경(구매) 저장 → 그 폴더 id 그대로 전달, 담당은 그 폴더 소속 팀으로 파생', async () => {
    await mount()
    await openPicker()
    await pickFolder('구매')
    await save()
    expect(updateMinuteMeta.mock.calls[0][2]).toBe('c-buy')
    expect((updateMinuteMeta.mock.calls[0][1] as { teamCode: string }).teamCode).toBe('ERP')
    expect(onSaved).toHaveBeenCalled()
  })

  it('무변경 저장은 폴더 무접촉(undefined) — 커스텀 편철 존중', async () => {
    await mount()
    await save()
    expect(updateMinuteMeta.mock.calls[0][2]).toBeUndefined()
  })

  it('미분류로 명시 이동 후 저장 → null 그대로 전달(무접촉과 구분)', async () => {
    await mount()
    await openPicker()
    await pickFolder('min.fold.unfiled')
    await save()
    expect(updateMinuteMeta.mock.calls[0][2]).toBeNull()
  })

  it('이미 미분류인 회의록의 무변경 저장은 그대로 무접촉(undefined) — 팀 루트로 되돌리지 않는다', async () => {
    await mount({ ...baseMinute, folderId: null })
    await save()
    expect(updateMinuteMeta.mock.calls[0][2]).toBeUndefined()
  })

  it('폴더를 골랐다가 원래 폴더로 되돌리면 다시 무접촉으로 판정', async () => {
    await mount()
    await openPicker()
    await pickFolder('구매')
    await openPicker()
    await pickFolder('품질')
    await save()
    expect(updateMinuteMeta.mock.calls[0][2]).toBeUndefined()
  })

  it('또박또박 연결 없음이면 "연결 없음" 표시, 초기화 버튼 없음', async () => {
    await mount()
    expect(mainDialog().textContent).toContain('min.ext.none')
    expect(btnByText('min.ext.reset')).toBeUndefined()
  })

  it('연결 있으면 opaque 문자열 그대로 표시(파싱 없이)', async () => {
    await mount({ ...baseMinute, externalId: 'ddobak:0192a1b2-aaaa-7bbb-8ccc-1234567890ab' })
    expect(mainDialog().textContent).toContain('ddobak:0192a1b2-aaaa-7bbb-8ccc-1234567890ab')
  })

  it('연결 초기화 — 확인 단계를 거쳐 resetMinuteExternalId 호출, 성공 시 연결 없음으로 갱신', async () => {
    await mount({ ...baseMinute, externalId: 'ddobak:ext-1' })
    await act(async () => { btnByText('min.ext.reset')!.click() })
    expect(mainDialog().textContent).toContain('min.ext.resetConfirm')
    expect(resetMinuteExternalId).not.toHaveBeenCalled()
    await act(async () => { btnByText('min.ext.reset')!.click() })
    expect(resetMinuteExternalId).toHaveBeenCalledWith('m1')
    expect(mainDialog().textContent).toContain('min.ext.none')
  })

  it('연결 초기화 취소는 API 를 호출하지 않고 연결 표시를 유지', async () => {
    await mount({ ...baseMinute, externalId: 'ddobak:ext-1' })
    await act(async () => { btnByText('min.ext.reset')!.click() })
    await act(async () => { btnByText('common.cancel')!.click() })
    expect(resetMinuteExternalId).not.toHaveBeenCalled()
    expect(mainDialog().textContent).toContain('ddobak:ext-1')
  })

  it('연결 초기화 실패 시 에러를 보여주고 연결 표시는 유지', async () => {
    resetMinuteExternalId.mockResolvedValueOnce({ ok: false, error: '권한 없음' })
    await mount({ ...baseMinute, externalId: 'ddobak:ext-1' })
    await act(async () => { btnByText('min.ext.reset')!.click() })
    await act(async () => { btnByText('min.ext.reset')!.click() })
    expect(mainDialog().textContent).toContain('권한 없음')
    expect(mainDialog().textContent).toContain('ddobak:ext-1')
  })

  it('폴더 목록 미확보(빈 배열)면 필드는 로딩 상태(…)로 표시 — 허위 미분류 표시 방지', async () => {
    fetchMinuteFoldersLite.mockImplementation(async () => [])
    await mount()
    expect(folderFieldBtn().textContent).toContain('…')
    await save()
    expect(updateMinuteMeta.mock.calls[0][2]).toBeUndefined()
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

  it('폴더 픽커는 선택된 프로젝트 소속 폴더만 보여준다', async () => {
    const scoped: MinuteFolder[] = [
      { id: 'r-erp', name: 'ERP', parentId: null, sort: 0, createdBy: null, projectId: 'pA' },
      { id: 'r-mes2', name: 'MES(B)', parentId: null, sort: 1, createdBy: null, projectId: 'pB' },
    ]
    fetchMinuteFoldersLite.mockImplementation(async () => scoped)
    await mount({ ...baseMinute, projectId: 'pA' }, [{ id: 'pA', name: 'A' }, { id: 'pB', name: 'B' }])
    await openPicker()
    expect([...pickerDialog().querySelectorAll('button')].some(b => b.textContent === 'ERP')).toBe(true)
    expect([...pickerDialog().querySelectorAll('button')].some(b => b.textContent === 'MES(B)')).toBe(false)
  })

  it('프로젝트를 바꾸면 스코프 밖 폴더 선택이 미분류로 해제된다 — 기존 편철(초기값)은 무접촉', async () => {
    const scoped: MinuteFolder[] = [
      { id: 'r-a', name: '루트A', parentId: null, sort: 0, createdBy: null, projectId: 'pA' },
      { id: 'r-b', name: '루트B', parentId: null, sort: 1, createdBy: null, projectId: 'pB' },
    ]
    fetchMinuteFoldersLite.mockImplementation(async () => scoped)
    await mount(
      { ...baseMinute, projectId: 'pA', folderId: 'r-a' },
      [{ id: 'pA', name: 'A' }, { id: 'pB', name: 'B' }],
    )
    expect(folderFieldBtn().textContent).toContain('루트A')
    await chooseProject('pB')
    expect(folderFieldBtn().textContent).toContain('min.fold.unfiled')
    await save()
    // 명시적으로 미분류로 바꿨으므로 null 그대로 전달(무접촉 undefined와 구분)
    expect(updateMinuteMeta.mock.calls[0][2]).toBeNull()
  })
})
