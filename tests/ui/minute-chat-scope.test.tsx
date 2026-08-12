// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MinuteFolder } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => (k === 'min.grp.unassigned' ? '미지정' : k), locale: 'ko' }),
}))
const fetchMinuteFoldersLite = vi.fn<() => Promise<MinuteFolder[]>>(async () => [])
vi.mock('@/app/actions/minutes', () => ({
  fetchMinuteFoldersLite: () => fetchMinuteFoldersLite(),
}))

import { MinuteChatPanel } from '@/components/minutes/MinuteChatPanel'

function streamResponse(text: string): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(enc.encode(text)); c.close() },
  })
  return { ok: true, body } as unknown as Response
}

/** React 제어 input 에 값 주입 — native setter 로 써야 onChange 가 발화한다. */
function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('MinuteChatPanel 범위 전환', () => {
  let container: HTMLDivElement, root: Root
  const fetchMock = vi.fn()

  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => streamResponse('답변'))
    vi.stubGlobal('fetch', fetchMock)
    fetchMinuteFoldersLite.mockReset()
    fetchMinuteFoldersLite.mockImplementation(async () => [])
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })

  function tab(label: string): HTMLButtonElement {
    const el = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find(b => b.textContent === label)
    if (!el) throw new Error(`탭 없음: ${label}`)
    return el
  }
  async function send(text: string) {
    await act(async () => { setInput(container.querySelector('input')!, text) })
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="min.chat.send"]')!.click() })
    await act(async () => { await Promise.resolve() }) // 스트림 flush
  }
  function lastBody(): Record<string, unknown> {
    const call = fetchMock.mock.calls.at(-1) as [string, { body: string }]
    return JSON.parse(call[1].body) as Record<string, unknown>
  }
  async function mountPanel(projects: { id: string; name: string }[] = []) {
    await act(async () => root.render(<MinuteChatPanel minuteId="m-1" projects={projects} />))
  }
  async function openArchiveTeam(teamLabel: string) {
    await act(async () => { tab('min.chat.scope.all').click() })
    await act(async () => { await Promise.resolve() }) // 폴더 지연 로드(fetchMinuteFoldersLite) flush
    await act(async () => { tab(teamLabel).click() })
  }

  it('질문 패널은 기본으로 열린다', async () => {
    await mountPanel()
    expect(tab('min.chat.scope.doc')).toBeTruthy()
    expect(container.querySelector('input[placeholder="min.chat.placeholder"]')).toBeTruthy()
  })

  it('기본(이 문서) 전송은 mode=doc + minuteId', async () => {
    await mountPanel()
    await send('요약해줘')
    expect(lastBody()).toMatchObject({ mode: 'doc', minuteId: 'm-1', message: '요약해줘' })
  })

  it('전체 회의록 탭 전송은 mode=archive + null 필터', async () => {
    await mountPanel()
    await act(async () => { tab('min.chat.scope.all').click() })
    await send('PI 관련 회의 찾아줘')
    expect(lastBody()).toMatchObject({
      mode: 'archive',
      message: 'PI 관련 회의 찾아줘',
      filters: { team: null, from: null, to: null },
    })
    expect(lastBody()).not.toHaveProperty('minuteId')
  })

  it('범위 전환 후에도 각 스레드 대화가 보존된다', async () => {
    await mountPanel()
    await send('문서 질문')
    expect(container.textContent).toContain('문서 질문')

    await act(async () => { tab('min.chat.scope.all').click() })
    expect(container.textContent).not.toContain('문서 질문') // archive 스레드는 비어 있음

    await send('보관함 질문')
    expect(container.textContent).toContain('보관함 질문')

    await act(async () => { tab('min.chat.scope.doc').click() })
    expect(container.textContent).toContain('문서 질문')      // doc 스레드 보존
    expect(container.textContent).not.toContain('보관함 질문')
  })

  /* ── 하위 구분 칩 프로젝트 라벨(0076) ── */

  it('팀 루트가 유일하면 하위 구분 칩에 프로젝트 라벨을 붙이지 않는다(종전과 동일)', async () => {
    fetchMinuteFoldersLite.mockImplementation(async () => [
      { id: 'r-pmo', name: 'PMO', parentId: null, sort: 0, createdBy: null, projectId: null },
      { id: 'c1', name: '하위구분1', parentId: 'r-pmo', sort: 0, createdBy: null, projectId: null },
    ])
    await mountPanel()
    await openArchiveTeam('PMO')
    expect(tab('하위구분1')).toBeTruthy()
  })

  it('같은 이름의 팀 루트가 여러 프로젝트에 있으면 하위 구분 칩에 그 프로젝트 이름이 붙는다', async () => {
    fetchMinuteFoldersLite.mockImplementation(async () => [
      { id: 'r-pmo-p1', name: 'PMO', parentId: null, sort: 0, createdBy: null, projectId: 'p1' },
      { id: 'c1', name: '하위구분1', parentId: 'r-pmo-p1', sort: 0, createdBy: null, projectId: 'p1' },
      // 동명 루트가 다른 프로젝트에도 있다 — 뽑히지는 않지만 중의성의 원인
      { id: 'r-pmo-p2', name: 'PMO', parentId: null, sort: 1, createdBy: null, projectId: 'p2' },
    ])
    await mountPanel([{ id: 'p1', name: 'P1 프로젝트' }, { id: 'p2', name: 'P2 프로젝트' }])
    await openArchiveTeam('PMO')
    expect(tab('P1 프로젝트 · 하위구분1')).toBeTruthy()
  })

  it('뽑힌 루트가 미지정(프로젝트 null)이면 미지정 라벨을 붙인다', async () => {
    fetchMinuteFoldersLite.mockImplementation(async () => [
      { id: 'r-pmo-un', name: 'PMO', parentId: null, sort: 0, createdBy: null, projectId: null },
      { id: 'c1', name: '하위구분1', parentId: 'r-pmo-un', sort: 0, createdBy: null, projectId: null },
      { id: 'r-pmo-p2', name: 'PMO', parentId: null, sort: 1, createdBy: null, projectId: 'p2' },
    ])
    await mountPanel([{ id: 'p2', name: 'P2 프로젝트' }])
    await openArchiveTeam('PMO')
    expect(tab('미지정 · 하위구분1')).toBeTruthy()
  })

  it('선택은 folder_id 그대로 전송된다 — 라벨이 붙어도 필터 동작은 무변경', async () => {
    fetchMinuteFoldersLite.mockImplementation(async () => [
      { id: 'r-pmo-p1', name: 'PMO', parentId: null, sort: 0, createdBy: null, projectId: 'p1' },
      { id: 'c1', name: '하위구분1', parentId: 'r-pmo-p1', sort: 0, createdBy: null, projectId: 'p1' },
      { id: 'r-pmo-p2', name: 'PMO', parentId: null, sort: 1, createdBy: null, projectId: 'p2' },
    ])
    await mountPanel([{ id: 'p1', name: 'P1 프로젝트' }, { id: 'p2', name: 'P2 프로젝트' }])
    await openArchiveTeam('PMO')
    await act(async () => { tab('P1 프로젝트 · 하위구분1').click() })
    await send('이 구분 회의만 찾아줘')
    expect(lastBody()).toMatchObject({ filters: { team: 'PMO', folderId: 'c1' } })
  })
})
