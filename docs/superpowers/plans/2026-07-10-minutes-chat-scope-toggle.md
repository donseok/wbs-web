# 뷰어 채팅 범위 전환 (이 문서 ↔ 전체 회의록) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회의록 뷰어(`/minutes/[id]`)의 채팅 패널에서 "이 문서 | 전체 회의록" 범위를 전환해, 뷰어를 벗어나지 않고 전체 회의록 보관함에도 질문할 수 있게 한다.

**Architecture:** 백엔드 변경 없음 — 기존 `POST /api/minutes/chat`의 `mode: 'archive'` + null 필터가 이미 전체 검색을 지원한다. `MinuteChatPanel`에 범위 토글(SegmentedTabs)과 범위별 독립 대화 스레드(`useMinutesChat` 2개 인스턴스)를 추가하고, archive 답변의 `/minutes/<uuid>` 출처 경로를 링크화하기 위해 `linkifyMinutePaths`를 공용 모듈로 추출한다.

**Tech Stack:** Next.js App Router, React 클라이언트 컴포넌트, vitest (node/jsdom per-file), Tailwind 토큰 시스템.

**Spec:** `docs/superpowers/specs/2026-07-10-minutes-chat-scope-toggle-design.md`

## Global Constraints

- 백엔드(`src/app/api/minutes/chat/route.ts`, `src/lib/ai/minutes-answer.ts`)는 수정하지 않는다.
- 전체 범위 요청 바디: `{ mode: 'archive', message, history, filters: { team: null, from: null, to: null } }` — 필터는 정확히 이 형태.
- i18n 키(정확히 이 값): ko `min.chat.scope.doc: '이 문서'`, `min.chat.scope.all: '전체 회의록'` / en `'This doc'`, `'All minutes'`.
- `linkifyMinutePaths` 동작 변경 금지: 내부 `/minutes/<uuid>` 경로만 링크화, 외부 URL·마크다운 링크는 텍스트 유지.
- 디자인 토큰·공용 프리미티브(`SegmentedTabs`, `btn`, `card` 등) 재사용 — 새 스타일 시스템 도입 금지.
- git 커밋 시 `git add -A` 금지 (병렬 세션 관례) — 항상 파일 경로를 명시한다.

---

### Task 1: `linkifyMinutePaths` 공용 모듈 추출 + 테스트

**Files:**
- Create: `src/components/minutes/linkify.tsx`
- Create: `tests/minutes/linkify.test.tsx`
- Modify: `src/components/minutes/ArchiveChatPanel.tsx` (로컬 복사본 제거, import 로 교체)

**Interfaces:**
- Consumes: 없음 (`next/link`, `react` 만)
- Produces: `export function linkifyMinutePaths(content: string): ReactNode` — Task 2의 `MinuteChatPanel`이 import 한다. 모듈 경로: `@/components/minutes/linkify` (동일 폴더에서는 `./linkify`).

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/minutes/linkify.test.tsx` 생성 (node 환경 — DOM 렌더 없이 React 엘리먼트 구조만 검사):

```tsx
import { describe, it, expect } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import Link from 'next/link'
import { linkifyMinutePaths } from '@/components/minutes/linkify'

const UUID_A = '123e4567-e89b-42d3-a456-426614174000'
const UUID_B = 'abcdef01-2345-4678-9abc-def012345678'

function asArray(node: React.ReactNode): React.ReactNode[] {
  return Array.isArray(node) ? node : [node]
}

describe('linkifyMinutePaths', () => {
  it('내부 /minutes/<uuid> 경로를 Link 로 감싼다', () => {
    const parts = asArray(linkifyMinutePaths(`출처: /minutes/${UUID_A} 참고`))
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('출처: ')
    const link = parts[1] as ReactElement<{ href: string }>
    expect(isValidElement(link)).toBe(true)
    expect(link.type).toBe(Link)
    expect(link.props.href).toBe(`/minutes/${UUID_A}`)
    expect(parts[2]).toBe(' 참고')
  })

  it('여러 경로를 각각 링크화한다', () => {
    const parts = asArray(linkifyMinutePaths(`/minutes/${UUID_A} 그리고 /minutes/${UUID_B}`))
    const links = parts.filter(p => isValidElement(p))
    expect(links).toHaveLength(2)
  })

  it('외부 URL 은 텍스트로 남긴다', () => {
    const text = '참고: https://evil.example.com/minutes/123'
    const parts = asArray(linkifyMinutePaths(text))
    expect(parts).toHaveLength(1)
    expect(parts[0]).toBe(text)
  })

  it('경로가 없으면 원문 그대로 반환한다', () => {
    const parts = asArray(linkifyMinutePaths('일반 텍스트'))
    expect(parts).toHaveLength(1)
    expect(parts[0]).toBe('일반 텍스트')
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run tests/minutes/linkify.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/minutes/linkify"` (모듈이 아직 없음)

- [ ] **Step 3: 공용 모듈 생성**

`src/components/minutes/linkify.tsx` 생성 — 본문은 `ArchiveChatPanel.tsx`의 기존 구현을 그대로 옮긴다 (동작 변경 금지):

```tsx
import Link from 'next/link'
import type { ReactNode } from 'react'

const MINUTE_PATH_RE = /\/minutes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

/** 내부 /minutes/<uuid> 경로만 링크화 — 외부 URL·md 링크는 그대로 텍스트(피싱 표면 차단). */
export function linkifyMinutePaths(content: string): ReactNode {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of content.matchAll(MINUTE_PATH_RE)) {
    const i = m.index ?? 0
    if (i > last) parts.push(content.slice(last, i))
    parts.push(
      <Link key={`${i}-${m[0]}`} href={m[0]} className="font-medium text-brand underline underline-offset-2">
        {m[0]}
      </Link>,
    )
    last = i + m[0].length
  }
  if (last < content.length) parts.push(content.slice(last))
  return parts
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/minutes/linkify.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: `ArchiveChatPanel.tsx` 를 공용 모듈로 전환**

`src/components/minutes/ArchiveChatPanel.tsx`에서:

1. 로컬 `MINUTE_PATH_RE` 상수와 `linkifyMinutePaths` 함수(주석 포함, 8~26행)를 삭제한다.
2. `import Link from 'next/link'` 를 삭제한다 (linkify 이동 후 미사용).
3. import 를 추가한다:

```tsx
import { linkifyMinutePaths } from './linkify'
```

변경 후 상단 import 블록은 다음과 같아야 한다:

```tsx
'use client'
import { MessageCircle, RotateCcw, X } from 'lucide-react'
import type { TeamCode } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'
import { ChatBubble, ChatComposer, useMinutesChat } from './MinuteChatPanel'
import { linkifyMinutePaths } from './linkify'
```

나머지(컴포넌트 본문의 `renderContent={linkifyMinutePaths}` 사용부)는 그대로 둔다.

- [ ] **Step 6: 전체 테스트 + lint 확인**

Run: `npm test && npm run lint`
Expected: 기존 테스트 전부 PASS, lint 에러 0 (미사용 import 가 남았으면 여기서 잡힘)

- [ ] **Step 7: 커밋**

```bash
git add src/components/minutes/linkify.tsx src/components/minutes/ArchiveChatPanel.tsx tests/minutes/linkify.test.tsx
git commit -m "refactor(minutes): linkifyMinutePaths 공용 모듈 추출 + 테스트

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 뷰어 채팅 범위 토글 (i18n 키 포함)

**Files:**
- Modify: `src/lib/i18n/dict/minutes.ts` (ko 43~49행 · en 96~102행 `min.chat.*` 블록 주변)
- Modify: `src/components/minutes/MinuteChatPanel.tsx:100-137` (`MinuteChatPanel` 컴포넌트)
- Test: `tests/ui/minute-chat-scope.test.tsx`

**Interfaces:**
- Consumes: Task 1의 `linkifyMinutePaths` (`./linkify`), 기존 `useMinutesChat(buildBody)` 훅(같은 파일), `SegmentedTabs<T extends string>({ tabs, value, onChange, size })` (`@/components/ui/SegmentedTabs`).
- Produces: `MinuteChatPanel({ minuteId }: { minuteId: string })` — 시그니처 변경 없음 (호출부 `MinuteViewer.tsx:133` 수정 불필요).

- [ ] **Step 1: i18n 키 추가**

`src/lib/i18n/dict/minutes.ts` — ko 블록의 `'min.chat.reset': '대화 초기화',` 바로 아래에 추가:

```ts
  'min.chat.scope.doc': '이 문서',
  'min.chat.scope.all': '전체 회의록',
```

en 블록의 `'min.chat.reset': 'Clear conversation',` 바로 아래에 추가:

```ts
  'min.chat.scope.doc': 'This doc',
  'min.chat.scope.all': 'All minutes',
```

- [ ] **Step 2: 실패하는 UI 테스트 작성**

`tests/ui/minute-chat-scope.test.tsx` 생성 (기존 `tests/ui/theme-write.test.tsx` 패턴: jsdom + createRoot + act, `useLocale` 모킹):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko' }),
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

  it('기본(이 문서) 전송은 mode=doc + minuteId', async () => {
    await act(async () => root.render(<MinuteChatPanel minuteId="m-1" />))
    await send('요약해줘')
    expect(lastBody()).toMatchObject({ mode: 'doc', minuteId: 'm-1', message: '요약해줘' })
  })

  it('전체 회의록 탭 전송은 mode=archive + null 필터', async () => {
    await act(async () => root.render(<MinuteChatPanel minuteId="m-1" />))
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
    await act(async () => root.render(<MinuteChatPanel minuteId="m-1" />))
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
})
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npx vitest run tests/ui/minute-chat-scope.test.tsx`
Expected: FAIL — `탭 없음: min.chat.scope.all` (토글이 아직 없음)

- [ ] **Step 4: `MinuteChatPanel` 구현**

`src/components/minutes/MinuteChatPanel.tsx` 상단 import 에 추가:

```tsx
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { linkifyMinutePaths } from './linkify'
```

파일 하단의 `MinuteChatPanel` 컴포넌트(100~137행)를 다음으로 교체 — `useMinutesChat`/`ChatBubble`/`ChatComposer` 는 변경하지 않는다:

```tsx
type ChatScope = 'doc' | 'archive'

/** 문서 모드 패널 — 뷰어 우측(좁은 화면에선 아래). 범위 토글로 전체 보관함 질문 가능. */
export function MinuteChatPanel({ minuteId }: { minuteId: string }) {
  const { t } = useLocale()
  const [open, setOpen] = useState(true)
  const [scope, setScope] = useState<ChatScope>('doc')
  // 범위별 독립 스레드 — 전환해도 각 대화가 보존되고 LLM 컨텍스트가 섞이지 않는다.
  const doc = useMinutesChat((message, history) => ({ mode: 'doc', minuteId, message, history }))
  const archive = useMinutesChat((message, history) => ({
    mode: 'archive', message, history, filters: { team: null, from: null, to: null },
  }))
  const chat = scope === 'doc' ? doc : archive

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn self-start">
        <MessageCircle className="h-4 w-4" />{t('min.chat.doc.title')}
      </button>
    )
  }
  return (
    <aside className="card flex h-[560px] w-full flex-col lg:w-[340px] lg:shrink-0">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="inline-flex items-center gap-2">
          <MessageCircle className="h-4 w-4 shrink-0 text-brand" />
          <SegmentedTabs<ChatScope>
            tabs={[{ key: 'doc', label: t('min.chat.scope.doc') },
                   { key: 'archive', label: t('min.chat.scope.all') }]}
            value={scope} onChange={setScope} size="sm" />
        </span>
        <span className="inline-flex items-center gap-2">
          <button onClick={chat.reset} disabled={chat.loading || chat.messages.length === 0}
            className="text-ink-subtle hover:text-ink disabled:opacity-40"
            title={t('min.chat.reset')} aria-label={t('min.chat.reset')}>
            <RotateCcw className="h-4 w-4" />
          </button>
          <button onClick={() => setOpen(false)} className="text-ink-subtle hover:text-ink" aria-label="close">
            <X className="h-4 w-4" />
          </button>
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {chat.messages.map(m => (
          <ChatBubble key={m.id} role={m.role} content={m.content}
            renderContent={scope === 'archive' ? linkifyMinutePaths : undefined} />
        ))}
      </div>
      <ChatComposer onSend={chat.send} loading={chat.loading} />
    </aside>
  )
}
```

주의: 헤더의 패널 제목 텍스트(`min.chat.doc.title`)가 토글로 대체된다. 접힘 상태 버튼 라벨은 기존 `min.chat.doc.title` 유지.

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/ui/minute-chat-scope.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 6: 전체 테스트 + lint + build 확인**

Run: `npm test && npm run lint && npm run build`
Expected: 전체 테스트 PASS, lint 에러 0, build 성공

- [ ] **Step 7: 커밋**

```bash
git add src/components/minutes/MinuteChatPanel.tsx src/lib/i18n/dict/minutes.ts tests/ui/minute-chat-scope.test.tsx
git commit -m "feat(minutes): 뷰어 채팅 범위 전환 — 이 문서↔전체 회의록 (범위별 스레드 분리)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 검증 메모

- 샌드박스에서 브라우저 검증 불가(프로젝트 관례) — build/lint/vitest 로 검증하고, 실 UI 토글 동작은 배포 후 사용자 수기 확인.
- 백엔드는 미변경이므로 `/api/minutes/chat` curl 검증은 불필요.
