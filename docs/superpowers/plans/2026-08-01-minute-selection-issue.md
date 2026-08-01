# 회의록 드래그 선택 → 이슈 등록 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회의록에서 마우스로 드래그한 텍스트(여러 블록 걸침 허용)를 기존 블록 단위 등록과 동일한 AI 초안·서버 검증 흐름으로 이슈로 등록한다.

**Architecture:** 선택 텍스트를 "시작 블록에 앵커된 검증된 발췌"로 취급한다. `MinuteIssueSourceInput`에 옵션 `selection` 필드를 추가하고, 서버가 불변 버전 원문을 재분할해 선택 텍스트가 실제 존재하는 연속 부분 문자열인지 공백 제거 대조로 확인한 뒤에만 발췌로 저장한다. DB·RPC·마이그레이션 변경 없음.

**Tech Stack:** Next.js 15 App Router, React 19, Supabase(변경 없음), vitest(+jsdom), 기존 `src/lib/minutes/blocks.ts` mdast 파이프라인.

**Spec:** `docs/superpowers/specs/2026-08-01-minute-selection-issue-design.md`

## Global Constraints

- `git add -A` 금지 — 항상 파일명을 명시해 stage (병렬 세션 리포).
- 커밋 메시지는 한국어, "무엇"보다 "왜". 마이그레이션 없음(코드만).
- UI 위험 파일(`globals.css`, `layout.tsx`, `src/components/app/*`) 무접촉 — 이 계획의 파일은 전부 `src/components/minutes/*`, `src/lib/*`, `src/app/actions/*`.
- 상태 변형 display 유틸(`group-hover:flex` 등) 금지 — 반응형 안전망이 이긴다. 버블은 `position: fixed` 인라인 스타일 + 상시 렌더 분기로만 표시를 제어한다.
- 서버 액션 에러 문구는 한국어 하드코딩(기존 issues.ts 관례), 클라 표시는 i18n 키.
- 에러 3원칙: 대조 실패는 fail-closed로 에러 반환(추측 재매칭 금지), 표시=로깅.
- 검증 명령: `npm run test -- tests/<파일>` (vitest), `npm run lint`, `npm run build`.

---

### Task 1: 선택 대조 순수 라이브러리 `src/lib/minutes/selection.ts`

**Files:**
- Create: `src/lib/minutes/selection.ts`
- Test: `tests/minutes/selection.test.ts` (신설)

**Interfaces:**
- Consumes: `fnv1a64`, `isMarkableBlock`, `MinuteBlock`, `splitMinuteBlocks` (`@/lib/minutes/blocks`)
- Produces (후속 태스크가 그대로 import):
  - `MINUTE_SELECTION_MIN_CHARS = 5`, `MINUTE_SELECTION_MAX_BLOCK_SPAN = 200`
  - `normalizeSelectionText(raw: string): string`
  - `stripSelectionWhitespace(value: string): string`
  - `minuteSelectionKeyHash(excerpt: string): string`
  - `type MinuteSelectionMatch = { ok: true; excerpt: string } | { ok: false; reason: 'anchor' | 'empty' | 'text' }`
  - `matchMinuteSelection(blocks, startIndex, startHash, endIndex, endHash, rawText): MinuteSelectionMatch`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/minutes/selection.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { fnv1a64, splitMinuteBlocks } from '@/lib/minutes/blocks'
import {
  MINUTE_SELECTION_MIN_CHARS,
  matchMinuteSelection,
  minuteSelectionKeyHash,
  normalizeSelectionText,
  stripSelectionWhitespace,
} from '@/lib/minutes/selection'

const BODY = [
  '# 주간회의',
  '',
  '첫 번째 문단은 인터페이스 전송 누락 위험을 다룬다.',
  '',
  '- [x] 재처리 여부 확인',
  '- 인터페이스 보완 방안 협의',
  '',
  '| 시스템 | 상태 |',
  '| --- | --- |',
  '| CRM | 지연 |',
].join('\n')
const blocks = splitMinuteBlocks(BODY)
// blocks: 0=heading, 1=paragraph, 2=list, 3=table

describe('normalizeSelectionText', () => {
  it('CRLF·줄 내 공백 압축·빈 줄 제거로 정규화한다', () => {
    expect(normalizeSelectionText('  가  나\r\n\r\n다  \n')).toBe('가 나\n다')
  })
  it('공백뿐인 선택은 빈 문자열이 된다', () => {
    expect(normalizeSelectionText(' \n\t ')).toBe('')
  })
})

describe('stripSelectionWhitespace / minuteSelectionKeyHash', () => {
  it('NBSP 포함 모든 공백을 제거한다', () => {
    expect(stripSelectionWhitespace('가 나 다\n라')).toBe('가나다라')
  })
  it('키 해시는 공백 제거 텍스트의 fnv1a64다', () => {
    expect(minuteSelectionKeyHash('가 나\n다')).toBe(fnv1a64('가나다'))
  })
})

describe('matchMinuteSelection', () => {
  it('단일 블록 안 부분 선택을 인정하고 정규화 발췌를 돌려준다', () => {
    const res = matchMinuteSelection(
      blocks, 1, blocks[1].hash, 1, blocks[1].hash, '전송 누락  위험을 다룬다',
    )
    expect(res).toEqual({ ok: true, excerpt: '전송 누락 위험을 다룬다' })
  })
  it('여러 블록에 걸친 선택(문단→목록)을 인정한다', () => {
    const raw = '누락 위험을 다룬다.\n재처리 여부 확인'
    const res = matchMinuteSelection(blocks, 1, blocks[1].hash, 2, blocks[2].hash, raw)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.excerpt).toBe('누락 위험을 다룬다.\n재처리 여부 확인')
  })
  it('표 셀을 가로지르는 선택(탭·개행 차이)을 공백 제거 대조로 흡수한다', () => {
    const res = matchMinuteSelection(blocks, 3, blocks[3].hash, 3, blocks[3].hash, 'CRM\t지연')
    expect(res.ok).toBe(true)
  })
  it('원문에 없는 텍스트는 text 사유로 거절한다', () => {
    const res = matchMinuteSelection(blocks, 1, blocks[1].hash, 1, blocks[1].hash, '존재하지 않는 문장')
    expect(res).toEqual({ ok: false, reason: 'text' })
  })
  it('시작 블록 안에서 끝나는 선택이 끝 블록을 부풀려 주장하면 거절한다', () => {
    // '전송 누락 위험' 은 블록 1 안에서 끝난다 — endIndex=2 주장에서 끝 블록에 걸치지 않음
    const res = matchMinuteSelection(blocks, 1, blocks[1].hash, 2, blocks[2].hash, '전송 누락 위험')
    expect(res).toEqual({ ok: false, reason: 'text' })
  })
  it('블록 해시 불일치·범위 역전·비 markable 은 anchor 사유로 거절한다', () => {
    expect(matchMinuteSelection(blocks, 1, 'f'.repeat(16), 1, blocks[1].hash, '위험').ok).toBe(false)
    expect(matchMinuteSelection(blocks, 2, blocks[2].hash, 1, blocks[1].hash, '위험').ok).toBe(false)
    expect(matchMinuteSelection(blocks, 99, blocks[1].hash, 99, blocks[1].hash, '위험').ok).toBe(false)
  })
  it('공백뿐인 선택은 empty 사유로 거절한다', () => {
    const res = matchMinuteSelection(blocks, 1, blocks[1].hash, 1, blocks[1].hash, ' \n ')
    expect(res).toEqual({ ok: false, reason: 'empty' })
  })
  it('같은 문구가 반복돼도 시작·끝 블록에 걸치는 매치를 찾는다', () => {
    const dupBody = '확인 필요.\n\n확인 필요. 추가 조치가 있다.'
    const dup = splitMinuteBlocks(dupBody)
    const res = matchMinuteSelection(dup, 1, dup[1].hash, 1, dup[1].hash, '확인 필요. 추가')
    expect(res.ok).toBe(true)
  })
  it('MINUTE_SELECTION_MIN_CHARS 상수를 노출한다(버블 게이트 공유)', () => {
    expect(MINUTE_SELECTION_MIN_CHARS).toBe(5)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- tests/minutes/selection.test.ts`
Expected: FAIL — `Cannot find module '@/lib/minutes/selection'`

- [ ] **Step 3: 구현** — `src/lib/minutes/selection.ts`

```ts
import { fnv1a64, isMarkableBlock, type MinuteBlock } from './blocks'

/** 버블 표출 최소 선택 길이(공백 제거 기준) — 클라 게이트 전용, 서버는 비어있지 않음만 요구. */
export const MINUTE_SELECTION_MIN_CHARS = 5
/** 비정상 요청 방어용 선택 범위 블록 수 상한. */
export const MINUTE_SELECTION_MAX_BLOCK_SPAN = 200

/** DOM 선택 원본을 발췌 저장·미리보기 공통 형태로 정규화. 클라 미리보기 = 서버 저장 계약. */
export function normalizeSelectionText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** 원문 대조용 — DOM 렌더 텍스트와 mdast 평문의 차이(표 구분자·개행·NBSP)는 전부 공백이다. */
export function stripSelectionWhitespace(value: string): string {
  return value.replace(/\s+/g, '')
}

/** 같은 블록의 서로 다른 선택을 source_key 조회에서 구분하는 해시. */
export function minuteSelectionKeyHash(excerpt: string): string {
  return fnv1a64(stripSelectionWhitespace(excerpt))
}

export type MinuteSelectionMatch =
  | { ok: true; excerpt: string }
  | { ok: false; reason: 'anchor' | 'empty' | 'text' }

/**
 * 클라이언트 선택 텍스트를 불변 버전 블록 원문과 대조한다. 공백 제거 연속 부분 문자열이면서
 * 실제로 시작·끝 블록 양쪽에 걸친 선택만 인정한다. 본문이 바뀐 뒤의 추측 재매칭은 하지
 * 않는다(source.ts 원칙) — 실패는 실패로 돌려준다.
 */
export function matchMinuteSelection(
  blocks: readonly MinuteBlock[],
  startIndex: number,
  startHash: string,
  endIndex: number,
  endHash: string,
  rawText: string,
): MinuteSelectionMatch {
  const start = blocks[startIndex]
  const end = blocks[endIndex]
  if (
    !Number.isSafeInteger(startIndex) || !Number.isSafeInteger(endIndex)
    || startIndex < 0 || endIndex < startIndex
    || !start || !end || !isMarkableBlock(start) || !isMarkableBlock(end)
    || start.hash !== startHash.toLowerCase() || end.hash !== endHash.toLowerCase()
  ) return { ok: false, reason: 'anchor' }

  const excerpt = normalizeSelectionText(rawText)
  if (!excerpt) return { ok: false, reason: 'empty' }
  const needle = stripSelectionWhitespace(excerpt)

  let haystack = ''
  let startSpanEnd = 0
  let endSpanFrom = 0
  for (let index = startIndex; index <= endIndex; index += 1) {
    const candidate = blocks[index]
    if (!candidate || !isMarkableBlock(candidate)) continue
    if (index === endIndex) endSpanFrom = haystack.length
    haystack += stripSelectionWhitespace(candidate.text)
    if (index === startIndex) startSpanEnd = haystack.length
  }

  // 같은 문구가 반복되면 첫 매치가 다른 위치일 수 있다 — 양 끝 블록에 걸치는 매치를 찾을 때까지 순회.
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    if (at < startSpanEnd && at + needle.length > endSpanFrom) return { ok: true, excerpt }
  }
  return { ok: false, reason: 'text' }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test -- tests/minutes/selection.test.ts`
Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/minutes/selection.ts tests/minutes/selection.test.ts
git commit -m "feat(minutes): 드래그 선택 원문 대조 순수 함수 — 공백 제거 연속 부분 문자열 판정

DOM 렌더 텍스트와 mdast 평문의 차이(표 구분자·개행·NBSP)는 전부 공백이라
공백 제거 비교로 흡수한다. 클라 텍스트를 신뢰하지 않는 기존 검증 불변식을
선택 단위로 확장하기 위한 단일 원천."
```

---

### Task 2: source_key 선택 접미사 — `src/lib/domain/issueMinuteSource.ts`

**Files:**
- Modify: `src/lib/domain/issueMinuteSource.ts:4-57`
- Test: `tests/domain/issue-minute-source.test.ts` (기존 파일 확장)

**Interfaces:**
- Produces: `MinuteIssueSourceKeyInput.selectionHash?: string | null` — 있으면 키 끝에 `:sel:<hash>` 추가. Task 3의 `createIssueFromMinuteBlock`이 사용.

- [ ] **Step 1: 실패하는 테스트 추가** — 기존 `tests/domain/issue-minute-source.test.ts`의 `makeMinuteIssueSourceKey` describe에 추가

```ts
it('선택 발췌 해시가 있으면 :sel:<hash> 접미사로 블록 전체 키와 구분한다', () => {
  const base = {
    minuteVersionId: 'version-1',
    blockIndex: 3,
    blockHash: 'ABCDEF0123456789',
    kind: 'manual' as const,
  }
  expect(makeMinuteIssueSourceKey({ ...base, selectionHash: 'FEDCBA9876543210' }))
    .toBe('minute:version-1:3:abcdef0123456789:manual:sel:fedcba9876543210')
  // null/미전송은 기존 키와 바이트 단위 동일(하위 호환)
  expect(makeMinuteIssueSourceKey({ ...base, selectionHash: null }))
    .toBe('minute:version-1:3:abcdef0123456789:manual')
  expect(makeMinuteIssueSourceKey(base))
    .toBe('minute:version-1:3:abcdef0123456789:manual')
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- tests/domain/issue-minute-source.test.ts`
Expected: FAIL — `selectionHash` 타입 오류 또는 접미사 없는 키 반환

- [ ] **Step 3: 구현** — `issueMinuteSource.ts` 수정

```ts
export interface MinuteIssueSourceKeyInput {
  minuteVersionId: string
  blockIndex: number
  blockHash: string
  kind: IssueMinuteSourceKind
  /** 드래그 선택 발췌의 공백 제거 fnv1a64 — 선택 등록만 채운다(블록 전체 등록과 조회 키 구분). */
  selectionHash?: string | null
}
```

`makeMinuteIssueSourceKey` 본문:

```ts
export function makeMinuteIssueSourceKey(input: MinuteIssueSourceKeyInput): string {
  const parts = [
    'minute',
    encodeURIComponent(input.minuteVersionId),
    String(input.blockIndex),
    input.blockHash.toLowerCase(),
    input.kind,
  ]
  if (input.selectionHash) parts.push('sel', input.selectionHash.toLowerCase())
  return parts.join(':')
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test -- tests/domain/issue-minute-source.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/issueMinuteSource.ts tests/domain/issue-minute-source.test.ts
git commit -m "feat(issues): source_key에 선택 발췌 해시 접미사 — 같은 블록의 부분 선택 이슈를 조회 키에서 구분

DB CHECK는 형식을 강제하지 않으므로 무마이그레이션. 미전송이면 기존 키와
바이트 단위 동일해 하위 호환."
```

---

### Task 3: 서버 액션 선택 검증 통합 — `src/app/actions/issues.ts`

**Files:**
- Modify: `src/app/actions/issues.ts` (`MinuteIssueSourceInput`·`validMinuteIssueSource`·`VerifiedMinuteIssueBlock`·`verifyMinuteIssueBlock`·`prepareMinuteIssueDraft`·`createIssueFromMinuteBlock`)
- Test: `tests/actions/issue-from-minute.test.ts` (확장)

**Interfaces:**
- Consumes: Task 1의 `matchMinuteSelection`·`minuteSelectionKeyHash`·`MINUTE_SELECTION_MAX_BLOCK_SPAN`, Task 2의 `selectionHash`.
- Produces (Task 5의 클라이언트가 호출):
  - `MinuteIssueSourceInput.selection?: { text: string; endBlockIndex: number; endBlockHash: string }`
  - selection이 있으면 `kind`는 `'manual'`만 유효. 검증 실패 에러 문구:
    `'선택 영역을 회의록 원문과 대조하지 못했습니다. 범위를 다시 선택하거나 블록 단위로 등록해 주세요.'`

- [ ] **Step 1: 실패하는 테스트 추가** — `tests/actions/issue-from-minute.test.ts`

파일 상단 근처(기존 `SOURCE` 아래)에 다중 블록 픽스처 추가:

```ts
import { matchMinuteSelection, minuteSelectionKeyHash } from '@/lib/minutes/selection'

const MULTI_BODY = [
  '# 주간회의',
  '',
  '첫 번째 문단은 인터페이스 전송 누락 위험을 다룬다.',
  '',
  '- 재처리 여부 확인',
  '- 인터페이스 보완 방안 협의',
].join('\n')
const MULTI_BLOCKS = splitMinuteBlocks(MULTI_BODY)
const MULTI_HASH = fnv1a64(MULTI_BODY)
const SELECTION_RAW = '누락 위험을 다룬다.\n재처리 여부 확인'
const SELECTION_SOURCE = {
  minuteId: 'minute-1',
  minuteVersionId: 'version-1',
  bodyHash: MULTI_HASH,
  blockIndex: MULTI_BLOCKS[1].index,
  blockHash: MULTI_BLOCKS[1].hash,
  kind: 'manual' as const,
  selection: {
    text: SELECTION_RAW,
    endBlockIndex: MULTI_BLOCKS[2].index,
    endBlockHash: MULTI_BLOCKS[2].hash,
  },
}
```

새 describe 블록(기존 `clientsWithVersion` 헬퍼 재사용 — `body`/`bodyHash` 인자에 MULTI 값 전달):

```ts
describe('드래그 선택 이슈 등록', () => {
  it('검증된 선택 발췌를 excerpt·:sel: source_key로 저장한다', async () => {
    vi.mocked(getSession).mockResolvedValue(USER as never)
    requireProjectMember.mockResolvedValue({ ok: true, actor: ACTOR })
    const { client, admin } = clientsWithVersion({ body: MULTI_BODY })
    state.client = client
    state.admin = admin

    const res = await createIssueFromMinuteBlock('project-1', INPUT, SELECTION_SOURCE)
    expect(res.ok).toBe(true)
    const rpcArgs = admin.rpc.mock.calls[0][1] as Record<string, unknown>
    const expected = matchMinuteSelection(
      MULTI_BLOCKS, 1, MULTI_BLOCKS[1].hash, 2, MULTI_BLOCKS[2].hash, SELECTION_RAW,
    )
    expect(expected.ok).toBe(true)
    if (!expected.ok) return
    expect(rpcArgs.p_excerpt_snapshot).toBe(expected.excerpt)
    expect(rpcArgs.p_block_index).toBe(1)
    expect(rpcArgs.p_source_kind).toBe('manual')
    expect(rpcArgs.p_source_key).toBe(
      `minute:version-1:1:${MULTI_BLOCKS[1].hash}:manual:sel:${minuteSelectionKeyHash(expected.excerpt)}`,
    )
  })

  it('원문에 없는 선택 텍스트는 fail-closed로 거절하고 RPC를 호출하지 않는다', async () => {
    vi.mocked(getSession).mockResolvedValue(USER as never)
    requireProjectMember.mockResolvedValue({ ok: true, actor: ACTOR })
    const { client, admin } = clientsWithVersion({ body: MULTI_BODY })
    state.client = client
    state.admin = admin

    const res = await createIssueFromMinuteBlock('project-1', INPUT, {
      ...SELECTION_SOURCE,
      selection: { ...SELECTION_SOURCE.selection, text: '원문에 없는 문장이다' },
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('선택 영역을 회의록 원문과 대조하지 못했습니다')
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('selection이 있는데 kind가 manual이 아니면 형식 오류로 거절한다', async () => {
    vi.mocked(getSession).mockResolvedValue(USER as never)
    requireProjectMember.mockResolvedValue({ ok: true, actor: ACTOR })
    const { client, admin } = clientsWithVersion({ body: MULTI_BODY })
    state.client = client
    state.admin = admin

    const res = await createIssueFromMinuteBlock('project-1', INPUT, {
      ...SELECTION_SOURCE,
      kind: 'risk' as const,
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('회의록 원문 정보가 올바르지 않습니다')
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('제목(heading)만의 선택은 거절한다', async () => {
    vi.mocked(getSession).mockResolvedValue(USER as never)
    requireProjectMember.mockResolvedValue({ ok: true, actor: ACTOR })
    const { client, admin } = clientsWithVersion({ body: MULTI_BODY })
    state.client = client
    state.admin = admin

    const res = await createIssueFromMinuteBlock('project-1', INPUT, {
      ...SELECTION_SOURCE,
      blockIndex: MULTI_BLOCKS[0].index,
      blockHash: MULTI_BLOCKS[0].hash,
      selection: { text: '주간회의', endBlockIndex: 0, endBlockHash: MULTI_BLOCKS[0].hash },
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('제목이 아닌 실제 이슈 내용')
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('prepare는 선택 발췌를 AI 원문으로 쓰고 범위 블록 원문을 컨텍스트에 담는다', async () => {
    vi.mocked(getSession).mockResolvedValue(USER as never)
    requireProjectMember.mockResolvedValue({ ok: true, actor: ACTOR })
    const { client } = clientsWithVersion({ body: MULTI_BODY })
    state.client = client
    ai.hasLLM.mockReturnValue(true)
    ai.generateAnswer.mockResolvedValue(aiResponseForAction('선택 발췌 제목'))

    const res = await prepareMinuteIssueDraft('project-1', SELECTION_SOURCE)
    expect(res.ok).toBe(true)
    const prompt = String(
      (ai.generateAnswer.mock.calls[0][1] as Array<{ content: string }>)[0].content,
    )
    const expected = matchMinuteSelection(
      MULTI_BLOCKS, 1, MULTI_BLOCKS[1].hash, 2, MULTI_BLOCKS[2].hash, SELECTION_RAW,
    )
    if (!expected.ok) throw new Error('fixture 불일치')
    expect(prompt).toContain(JSON.stringify(expected.excerpt).slice(1, -1))
    expect(prompt).toContain('선택 범위 블록 원문')
  })
})
```

주의: 이 테스트 파일에서 `prepareMinuteIssueDraft` 캐시(`minuteDraftCache`)는 모듈 전역이다.
기존 테스트들이 `vi.resetModules()` 없이 도는 구조라면 selection 테스트는 **프롬프트가 달라
캐시 키가 분리**되므로 충돌하지 않는다 — 새 `beforeEach` 추가 없이 기존 것을 따른다.

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- tests/actions/issue-from-minute.test.ts`
Expected: FAIL — `selection` 필드 타입 오류(TS) 및 검증 미구현

- [ ] **Step 3: 구현** — `src/app/actions/issues.ts`

(a) import 추가:

```ts
import {
  MINUTE_SELECTION_MAX_BLOCK_SPAN, matchMinuteSelection, minuteSelectionKeyHash,
} from '@/lib/minutes/selection'
```

(b) `MinuteIssueSourceInput` 확장:

```ts
export interface MinuteIssueSourceInput {
  minuteId: string
  minuteVersionId: string
  bodyHash: string
  blockIndex: number
  blockHash: string
  kind: IssueMinuteSourceKind
  /** 드래그 선택 등록일 때만 존재. blockIndex/blockHash 는 시작 블록 앵커가 된다. */
  selection?: {
    text: string
    endBlockIndex: number
    endBlockHash: string
  }
}
```

(c) `validMinuteIssueSource` 확장 (기존 반환식 뒤에):

```ts
function validMinuteIssueSource(source: MinuteIssueSourceInput): boolean {
  const base = Boolean(
    source.minuteId
    && source.minuteVersionId
    && Number.isSafeInteger(source.blockIndex)
    && source.blockIndex >= 0
    && BLOCK_HASH_RE.test(source.blockHash)
    && BLOCK_HASH_RE.test(source.bodyHash)
    && ISSUE_MINUTE_SOURCE_KINDS.includes(source.kind),
  )
  if (!base) return false
  const selection = source.selection
  if (selection === undefined) return true
  // 선택 등록은 인사이트 kind 를 얹지 않는다 — manual 만 유효(스펙 §4.1).
  return Boolean(
    source.kind === 'manual'
    && typeof selection.text === 'string'
    && selection.text.length > 0
    && selection.text.length <= TEXT_MAX
    && Number.isSafeInteger(selection.endBlockIndex)
    && selection.endBlockIndex >= source.blockIndex
    && selection.endBlockIndex - source.blockIndex <= MINUTE_SELECTION_MAX_BLOCK_SPAN
    && BLOCK_HASH_RE.test(selection.endBlockHash),
  )
}
```

(d) `VerifiedMinuteIssueBlock`에 필드 추가:

```ts
interface VerifiedMinuteIssueBlock {
  storedBodyHash: string
  block: MinuteBlock
  insightLabel: string | null
  draftContextText: string
  /** 드래그 선택 등록이면 검증·정규화된 발췌, 블록 등록이면 null. */
  selectionExcerpt: string | null
}
```

(e) 범위 컨텍스트 헬퍼(`minuteIssueDraftContext` 아래에 추가):

```ts
/** 선택이 걸친 블록 전체 원문 — 잘린 문장 경계를 AI 가 원문으로 보완할 수 있게 컨텍스트로 준다. */
function selectionRangeContext(
  blocks: readonly MinuteBlock[],
  startIndex: number,
  endIndex: number,
): string {
  const texts: string[] = []
  for (let index = startIndex; index <= endIndex && index < blocks.length; index += 1) {
    const candidate = blocks[index]
    if (candidate && isMarkableBlock(candidate)) texts.push(minuteBlockDraftText(candidate))
  }
  return texts.length ? `선택 범위 블록 원문:\n${texts.join('\n')}` : ''
}
```

(f) `verifyMinuteIssueBlock` — 블록 검증(`block.hash !== ...` 체크) 통과 직후, 인사이트 조회 앞에 삽입:

```ts
  let selectionExcerpt: string | null = null
  if (source.selection) {
    const match = matchMinuteSelection(
      blocks,
      source.blockIndex,
      source.blockHash,
      source.selection.endBlockIndex,
      source.selection.endBlockHash,
      source.selection.text,
    )
    if (!match.ok) {
      return {
        ok: false,
        error: '선택 영역을 회의록 원문과 대조하지 못했습니다. 범위를 다시 선택하거나 블록 단위로 등록해 주세요.',
      }
    }
    // 제목만의 선택으로는 이슈를 만들지 않는다 — 블록 흐름의 heading 거절과 같은 원칙.
    const endIndex = source.selection.endBlockIndex
    const hasBody = blocks.some((candidate, index) =>
      index >= source.blockIndex && index <= endIndex
      && isMarkableBlock(candidate) && !candidate.headingDepth)
    if (!hasBody) {
      return { ok: false, error: '제목이 아닌 실제 이슈 내용이 있는 범위를 선택해 주세요.' }
    }
    selectionExcerpt = match.excerpt
  }
```

반환값 조립부 변경:

```ts
  return {
    ok: true,
    value: {
      storedBodyHash,
      block,
      insightLabel,
      selectionExcerpt,
      draftContextText: source.selection
        ? [
            minuteIssueDraftContext(blocks, source.blockIndex, version),
            selectionRangeContext(blocks, source.blockIndex, source.selection.endBlockIndex),
          ].filter(Boolean).join('\n')
        : minuteIssueDraftContext(blocks, source.blockIndex, version),
    },
  }
```

(g) `prepareMinuteIssueDraft` — heading 거절을 블록 흐름 전용으로 좁히고 AI 원문을 선택 발췌로:

```ts
  const { block, insightLabel, draftContextText, selectionExcerpt } = verified.value
  if (!source.selection && block.headingDepth) {
    return { ok: false, error: '제목이 아닌 실제 이슈 내용이 있는 블록을 선택해 주세요.' }
  }
  const knownSubProcesses = await loadKnownSubProcesses(projectId)
  const blockText = selectionExcerpt ?? minuteBlockDraftText(block)
```

(캐시 키는 `fnv1a64(prompt)`가 이미 선택 텍스트를 반영하므로 변경 없음 — 주석으로 명시하지 않아도 된다.)

(h) `createIssueFromMinuteBlock` — 발췌·source_key:

```ts
  const { storedBodyHash, block, selectionExcerpt } = verified.value
  const excerpt = minuteIssueSourceExcerpt(selectionExcerpt ?? minuteBlockDraftText(block))
  const sourceKey = makeMinuteIssueSourceKey({
    minuteVersionId: source.minuteVersionId,
    blockIndex: source.blockIndex,
    blockHash: block.hash,
    kind: source.kind,
    selectionHash: selectionExcerpt ? minuteSelectionKeyHash(selectionExcerpt) : null,
  })
```

- [ ] **Step 4: 통과 확인 (기존 테스트 회귀 포함)**

Run: `npm run test -- tests/actions/issue-from-minute.test.ts tests/minutes/selection.test.ts`
Expected: PASS (기존 블록 흐름 테스트 전체 + 신규 selection describe)

- [ ] **Step 5: 커밋**

```bash
git add src/app/actions/issues.ts tests/actions/issue-from-minute.test.ts
git commit -m "feat(issues): 서버 액션이 드래그 선택 발췌를 원문 대조 후 이슈 원천으로 수용

클라 텍스트를 그대로 믿지 않는 기존 불변식을 유지한다 — 불변 버전 재분할
검증을 통과한 뒤 공백 제거 연속 부분 문자열 대조에 성공한 선택만 발췌로
저장하고, AI 초안 원문도 검증된 발췌만 쓴다. DB·RPC 무변경."
```

---

### Task 4: 선택 버블 컴포넌트 + i18n — `MinuteSelectionBubble.tsx`

**Files:**
- Create: `src/components/minutes/MinuteSelectionBubble.tsx`
- Modify: `src/lib/i18n/dict/minutes.ts` (ko 구획 `'min.issue.sourceLabel'` 근처 + en 구획 대응 위치)
- Test: `tests/ui/minute-selection-bubble.test.tsx` (신설)

**Interfaces:**
- Consumes: Task 1의 `MINUTE_SELECTION_MIN_CHARS`·`stripSelectionWhitespace`, `isMarkableBlock`·`MinuteBlock`(blocks.ts)
- Produces (Task 5가 사용):

```ts
export interface MinuteSelectionTarget {
  startIndex: number
  endIndex: number
  startHash: string
  endHash: string
  text: string          // Selection.toString() 원본(블록 경계 개행을 보존하는 렌더 텍스트 근사)
}
// 컴포넌트 props
{ bodyRef: RefObject<HTMLDivElement | null>; blocks: MinuteBlock[]; disabled: boolean;
  busy: boolean; onCreateIssue: (target: MinuteSelectionTarget) => void }
```

- i18n 키: ko `'min.sel.create': '이슈로 등록'`, `'min.sel.sourceLabel': '선택한 회의록 범위'` /
  en `'min.sel.create': 'Create issue'`, `'min.sel.sourceLabel': 'Selected minutes range'`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/ui/minute-selection-bubble.test.tsx`

```tsx
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { splitMinuteBlocks } from '@/lib/minutes/blocks'
import {
  MinuteSelectionBubble, type MinuteSelectionTarget,
} from '@/components/minutes/MinuteSelectionBubble'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (key: string) => key }),
}))

const BODY = '첫 번째 문단은 전송 누락 위험을 다룬다.\n\n두 번째 문단은 재처리 확인이 필요하다.'
const blocks = splitMinuteBlocks(BODY)
const HEADING_BODY = '# 제목뿐인 회의록'
const headingBlocks = splitMinuteBlocks(HEADING_BODY)

const RECT = {
  top: 100, bottom: 120, left: 40, right: 240, width: 200, height: 20, x: 40, y: 100,
  toJSON: () => ({}),
} as DOMRect

let container: HTMLDivElement
let root: Root

function mount(ui: React.ReactElement) {
  act(() => root.render(ui))
}

function selectAcross(el1: Node, off1: number, el2: Node, off2: number) {
  const range = document.createRange()
  range.setStart(el1, off1)
  range.setEnd(el2, off2)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

function fireSelectionDone() {
  act(() => { document.dispatchEvent(new Event('pointerup')) })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(RECT)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.getSelection()?.removeAllRanges()
  vi.restoreAllMocks()
})

function renderWithBody(opts: {
  blocks?: typeof blocks
  bodyHtml?: string
  disabled?: boolean
  onCreateIssue?: (target: MinuteSelectionTarget) => void
} = {}) {
  const bodyRef = createRef<HTMLDivElement>()
  const onCreateIssue = opts.onCreateIssue ?? vi.fn()
  mount(
    <>
      <div
        ref={bodyRef}
        dangerouslySetInnerHTML={{
          __html: opts.bodyHtml
            ?? '<p data-mblock="0">첫 번째 문단은 전송 누락 위험을 다룬다.</p>'
              + '<p data-mblock="1">두 번째 문단은 재처리 확인이 필요하다.</p>',
        }}
      />
      <MinuteSelectionBubble
        bodyRef={bodyRef}
        blocks={opts.blocks ?? blocks}
        disabled={opts.disabled ?? false}
        busy={false}
        onCreateIssue={onCreateIssue}
      />
    </>,
  )
  return { bodyRef, onCreateIssue }
}

describe('MinuteSelectionBubble', () => {
  it('두 블록에 걸친 선택 후 pointerup 에 버블이 뜨고 target 을 전달한다', () => {
    const onCreateIssue = vi.fn()
    const { bodyRef } = renderWithBody({ onCreateIssue })
    const [p0, p1] = Array.from(bodyRef.current!.querySelectorAll('p'))
    selectAcross(p0.firstChild!, 8, p1.firstChild!, 12)
    fireSelectionDone()

    const button = document.querySelector('button')
    expect(button?.textContent).toContain('min.sel.create')
    act(() => { button!.click() })
    expect(onCreateIssue).toHaveBeenCalledTimes(1)
    const target = onCreateIssue.mock.calls[0][0] as MinuteSelectionTarget
    expect(target.startIndex).toBe(0)
    expect(target.endIndex).toBe(1)
    expect(target.startHash).toBe(blocks[0].hash)
    expect(target.endHash).toBe(blocks[1].hash)
    expect(target.text.replace(/\s+/g, '')).toBe(
      '전송 누락 위험을 다룬다.두 번째 문단은 재처리'.replace(/\s+/g, ''),
    )
  })

  it('공백 제거 5자 미만 선택은 버블을 띄우지 않는다', () => {
    const { bodyRef } = renderWithBody()
    const p0 = bodyRef.current!.querySelector('p')!
    selectAcross(p0.firstChild!, 0, p0.firstChild!, 3)
    fireSelectionDone()
    expect(document.querySelector('button')).toBeNull()
  })

  it('본문 밖 선택은 무시한다', () => {
    renderWithBody()
    const outside = document.createElement('p')
    outside.textContent = '본문 밖 텍스트입니다 다섯 글자 이상'
    document.body.appendChild(outside)
    selectAcross(outside.firstChild!, 0, outside.firstChild!, 10)
    fireSelectionDone()
    expect(document.querySelector('button')).toBeNull()
    outside.remove()
  })

  it('heading 뿐인 선택은 버블을 띄우지 않는다', () => {
    const { bodyRef } = renderWithBody({
      blocks: headingBlocks,
      bodyHtml: '<h1 data-mblock="0">제목뿐인 회의록</h1>',
    })
    const h1 = bodyRef.current!.querySelector('h1')!
    selectAcross(h1.firstChild!, 0, h1.firstChild!, 8)
    fireSelectionDone()
    expect(document.querySelector('button')).toBeNull()
  })

  it('disabled 면 아무것도 띄우지 않는다', () => {
    const { bodyRef } = renderWithBody({ disabled: true })
    const [p0, p1] = Array.from(bodyRef.current!.querySelectorAll('p'))
    selectAcross(p0.firstChild!, 0, p1.firstChild!, 12)
    fireSelectionDone()
    expect(document.querySelector('button')).toBeNull()
  })

  it('선택이 해제되면 버블이 사라진다', () => {
    const { bodyRef } = renderWithBody()
    const [p0, p1] = Array.from(bodyRef.current!.querySelectorAll('p'))
    selectAcross(p0.firstChild!, 0, p1.firstChild!, 12)
    fireSelectionDone()
    expect(document.querySelector('button')).not.toBeNull()
    act(() => {
      window.getSelection()!.removeAllRanges()
      document.dispatchEvent(new Event('selectionchange'))
    })
    expect(document.querySelector('button')).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- tests/ui/minute-selection-bubble.test.tsx`
Expected: FAIL — `Cannot find module '@/components/minutes/MinuteSelectionBubble'`

- [ ] **Step 3: i18n 키 추가** — `src/lib/i18n/dict/minutes.ts`

ko 구획 `'min.issue.sourceLabel': '선택한 회의록 블록',` 바로 아래:

```ts
  'min.sel.create': '이슈로 등록',
  'min.sel.sourceLabel': '선택한 회의록 범위',
```

en 구획 대응 위치(`'min.issue.sourceLabel'` en 항목 아래):

```ts
  'min.sel.create': 'Create issue',
  'min.sel.sourceLabel': 'Selected minutes range',
```

- [ ] **Step 4: 컴포넌트 구현** — `src/components/minutes/MinuteSelectionBubble.tsx`

```tsx
'use client'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { CircleAlert, LoaderCircle } from 'lucide-react'
import { isMarkableBlock, type MinuteBlock } from '@/lib/minutes/blocks'
import { MINUTE_SELECTION_MIN_CHARS, stripSelectionWhitespace } from '@/lib/minutes/selection'
import { useLocale } from '@/components/providers/LocaleProvider'

export interface MinuteSelectionTarget {
  startIndex: number
  endIndex: number
  startHash: string
  endHash: string
  /**
   * Selection.toString() 원본 — Range.toString() 과 달리 블록 경계 개행을 보존하는
   * 렌더 텍스트 근사라 여러 블록 발췌가 한 줄로 붙지 않는다. 정규화·검증은
   * 서버 계약(selection.ts)이 담당한다.
   */
  text: string
}

interface BubbleState {
  target: MinuteSelectionTarget
  rect: { top: number; bottom: number; left: number; width: number }
}

function closestBlockElement(node: Node | null): HTMLElement | null {
  if (!node) return null
  const el = node instanceof Element ? node : node.parentElement
  return el?.closest<HTMLElement>('[data-mblock]') ?? null
}

/**
 * 본문 드래그 선택 근처에 뜨는 '이슈로 등록' 버블 — 블록 팝오버(클릭)와 상보적인 진입점.
 * 선택 확정은 pointerup/keyup 에서만 판정해 드래그 중 재배치 깜빡임을 피하고,
 * 스크롤·리사이즈는 rAF 로 위치만 추적한다. 선택 해제 시 즉시 소멸.
 */
export function MinuteSelectionBubble({ bodyRef, blocks, disabled, busy, onCreateIssue }: {
  bodyRef: RefObject<HTMLDivElement | null>
  blocks: MinuteBlock[]
  disabled: boolean
  busy: boolean
  onCreateIssue: (target: MinuteSelectionTarget) => void
}) {
  const { t } = useLocale()
  const [state, setState] = useState<BubbleState | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const readTarget = useCallback((): BubbleState | null => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
    const range = selection.getRangeAt(0)
    const body = bodyRef.current
    if (!body || !body.contains(range.commonAncestorContainer)) return null
    const startEl = closestBlockElement(range.startContainer)
    const endEl = closestBlockElement(range.endContainer)
    if (!startEl || !endEl) return null
    const startIndex = Number(startEl.dataset.mblock)
    const endIndex = Number(endEl.dataset.mblock)
    const start = blocks[startIndex]
    const end = blocks[endIndex]
    if (!start || !end || endIndex < startIndex || !isMarkableBlock(start) || !isMarkableBlock(end)) {
      return null
    }
    const text = selection.toString()
    if (stripSelectionWhitespace(text).length < MINUTE_SELECTION_MIN_CHARS) return null
    // 제목만의 선택은 이슈가 될 수 없다 — 서버 규칙(선택 범위에 non-heading 필요)과 동일 게이트.
    let hasBody = false
    for (let index = startIndex; index <= endIndex; index += 1) {
      const candidate = blocks[index]
      if (candidate && isMarkableBlock(candidate) && !candidate.headingDepth) {
        hasBody = true
        break
      }
    }
    if (!hasBody) return null
    const rect = range.getBoundingClientRect()
    return {
      target: { startIndex, endIndex, startHash: start.hash, endHash: end.hash, text },
      rect: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
    }
  }, [blocks, bodyRef])

  useEffect(() => {
    if (disabled) {
      setState(null)
      return
    }
    let frame = 0
    const evaluate = () => setState(readTarget())
    const evaluateSoon = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(evaluate)
    }
    const onPointerDown = (event: Event) => {
      // 버블 내부 pointerdown(버튼 클릭)은 선택을 유지해야 하므로 숨기지 않는다.
      if (event.target instanceof Node && boxRef.current?.contains(event.target)) return
      setState(null)
    }
    const onSelectionChange = () => {
      const selection = document.getSelection()
      if (!selection || selection.isCollapsed) setState(null)
    }
    document.addEventListener('pointerup', evaluate)
    document.addEventListener('keyup', evaluate)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('scroll', evaluateSoon, true)
    window.addEventListener('resize', evaluateSoon)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerup', evaluate)
      document.removeEventListener('keyup', evaluate)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('scroll', evaluateSoon, true)
      window.removeEventListener('resize', evaluateSoon)
    }
  }, [disabled, readTarget])

  if (!state) return null
  const W = 180
  const H = 44
  const center = state.rect.left + state.rect.width / 2
  const left = Math.min(Math.max(8, center - W / 2), window.innerWidth - W - 8)
  const below = state.rect.bottom + 6 + H < window.innerHeight
  const top = below ? state.rect.bottom + 6 : Math.max(8, state.rect.top - 6 - H)
  return (
    <div
      ref={boxRef}
      style={{ position: 'fixed', top, left, width: W }}
      className="z-[95]"
      // 버튼 mousedown 이 브라우저 기본 동작으로 선택을 해제하는 것을 막는다.
      onPointerDown={event => event.preventDefault()}
    >
      <button
        onClick={() => onCreateIssue(state.target)}
        disabled={busy}
        className="btn btn-primary h-9 w-full shadow-[var(--shadow-lg)]"
      >
        {busy
          ? <LoaderCircle className="h-4 w-4 animate-spin" />
          : <CircleAlert className="h-4 w-4" />}
        {busy ? t('min.issue.summarizing') : t('min.sel.create')}
      </button>
    </div>
  )
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm run test -- tests/ui/minute-selection-bubble.test.tsx`
Expected: PASS (6건)

- [ ] **Step 6: 커밋**

```bash
git add src/components/minutes/MinuteSelectionBubble.tsx src/lib/i18n/dict/minutes.ts tests/ui/minute-selection-bubble.test.tsx
git commit -m "feat(minutes): 드래그 선택 버블 — 블록 팝오버와 상보적인 이슈 등록 진입점

선택 확정(pointerup/keyup)에서만 판정해 드래그 중 깜빡임을 피하고, 제목만의
선택·5자 미만·본문 밖 선택은 서버 규칙과 같은 게이트로 클라에서 먼저 거른다."
```

---

### Task 5: `MinuteViewer` 배선 — 이슈 원천 유니언 + 선택 흐름

**Files:**
- Modify: `src/components/minutes/MinuteViewer.tsx` (이슈 상태·`issueContextAt`·`beginIssueCreate`·`continueWithProject`·`createLinkedIssue`·`sourcePreview`·버블 렌더)
- Test: `tests/ui/minute-issue-draft-flow.test.tsx` (확장)

**Interfaces:**
- Consumes: Task 3의 `MinuteIssueSourceInput.selection`, Task 4의 `MinuteSelectionBubble`/`MinuteSelectionTarget`, Task 1의 `normalizeSelectionText`.
- Produces: 사용자 흐름 — 선택 → 버블 → (AI 초안) → `IssueFormModal`(발췌=선택 정규화 텍스트, 라벨=`min.sel.sourceLabel`).

- [ ] **Step 1: 실패하는 테스트 추가** — `tests/ui/minute-issue-draft-flow.test.tsx`

(a) MarkdownView 목을 다중 블록 렌더로 교체(기존 단일 문단 테스트와 호환 — 단일 문단 본문은
지금처럼 `data-mblock="0"` 하나만 나온다):

```tsx
vi.mock('@/components/minutes/MarkdownView', () => ({
  MarkdownView: ({ content }: { content: string }) => (
    <div>
      {content.split('\n\n').map((segment, index) => (
        <p key={index} data-mblock={index} data-testid="minute-source-block">{segment}</p>
      ))}
    </div>
  ),
}))
```

(b) 파일 하단에 선택 흐름 describe 추가:

```tsx
describe('드래그 선택 이슈 등록 흐름', () => {
  const selectionBody = [
    '첫 번째 문단은 전송 누락 위험을 다룬다.',
    '두 번째 문단은 재처리 확인이 필요하다.',
  ].join('\n\n')
  const selectionBlocks = splitMinuteBlocks(selectionBody)
  const selectionMinute: Minute = { ...minute, bodyMd: selectionBody }

  function makeSelection() {
    const paragraphs = Array.from(document.querySelectorAll('[data-mblock]'))
    const range = document.createRange()
    range.setStart(paragraphs[0].firstChild!, 8)
    range.setEnd(paragraphs[1].firstChild!, 12)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    act(() => { document.dispatchEvent(new Event('pointerup')) })
  }

  beforeEach(() => {
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 100, bottom: 120, left: 40, right: 240, width: 200, height: 20, x: 40, y: 100,
      toJSON: () => ({}),
    } as DOMRect)
  })

  it('선택 → 버블 → AI 초안 → 모달이 selection 페이로드로 이어진다', async () => {
    const prepared = deferred<{ ok: boolean; draft?: Record<string, unknown> }>()
    mocks.prepareMinuteIssueDraft.mockReturnValue(prepared.promise)
    render(selectionMinute)

    makeSelection()
    const bubble = document.querySelector('button.btn-primary') as HTMLButtonElement
    expect(bubble?.textContent).toContain('min.sel.create')
    await act(async () => { bubble.click() })

    expect(mocks.prepareMinuteIssueDraft).toHaveBeenCalledTimes(1)
    const source = mocks.prepareMinuteIssueDraft.mock.calls[0][1] as Record<string, unknown>
    expect(source.blockIndex).toBe(0)
    expect(source.blockHash).toBe(selectionBlocks[0].hash)
    expect(source.kind).toBe('manual')
    const selection = source.selection as Record<string, unknown>
    expect(selection.endBlockIndex).toBe(1)
    expect(selection.endBlockHash).toBe(selectionBlocks[1].hash)
    expect(String(selection.text).replace(/\s+/g, ''))
      .toContain('전송누락위험을다룬다')

    await act(async () => {
      prepared.resolve({ ok: true, draft: { title: '초안 제목', body: '초안 본문', mode: 'ai' } })
      await prepared.promise
    })
    expect(document.querySelector('[data-testid="minute-issue-form"]')).not.toBeNull()
    const formProps = mocks.issueFormProps.at(-1) as {
      sourcePreview?: { excerpt: string; label: string }
    }
    // jsdom Selection.toString() 은 블록 경계 개행을 넣지 않으므로 개행에 의존하지 않고 비교한다.
    expect(formProps.sourcePreview?.excerpt.replace(/\s+/g, ''))
      .toBe('전송누락위험을다룬다.두번째문단은재처리')
    expect(formProps.sourcePreview?.label).toContain('min.sel.sourceLabel')
  })

  it('과거 버전 열람 중에는 선택 버블이 뜨지 않는다', () => {
    render(selectionMinute, { historicalVersion: { id: 'version-1', versionNo: 1 } })
    makeSelection()
    expect(document.querySelector('button.btn-primary')).toBeNull()
  })
})
```

주의: 이 테스트 파일의 기존 `render` 헬퍼 시그니처를 확인해 `historicalVersion` 전달을 맞춘다
(없으면 두 번째 인자로 추가 props 를 spread 하는 형태로 헬퍼를 확장한다). `splitMinuteBlocks`
는 이미 import 되어 있다.

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- tests/ui/minute-issue-draft-flow.test.tsx`
Expected: FAIL — 버블 미렌더(`bubble` null)

- [ ] **Step 3: 구현** — `src/components/minutes/MinuteViewer.tsx`

(a) import 추가:

```ts
import { normalizeSelectionText } from '@/lib/minutes/selection'
import {
  MinuteSelectionBubble, type MinuteSelectionTarget,
} from './MinuteSelectionBubble'
```

(b) 이슈 원천 유니언 도입 — `issueBlockIndex` 상태를 대체:

```ts
type IssueOrigin =
  | { type: 'block'; index: number }
  | {
      type: 'selection'
      startIndex: number
      endIndex: number
      startHash: string
      endHash: string
      text: string
      /** normalizeSelectionText(text) — 미리보기·폴백 초안·발췌가 서버 저장 계약과 일치. */
      excerpt: string
    }
```

```ts
const [issueOrigin, setIssueOrigin] = useState<IssueOrigin | null>(null)
```

파생값 교체(기존 `issueBlock`·`issueInsight`·`issueSourceKind`·`issueDraft` 자리):

```ts
  const issueAnchorIndex = issueOrigin === null
    ? null
    : issueOrigin.type === 'block' ? issueOrigin.index : issueOrigin.startIndex
  const issueBlock = issueAnchorIndex === null ? null : blocks[issueAnchorIndex] ?? null
  const issueInsight = useMemo(() => {
    if (issueOrigin?.type !== 'block') return null
    const candidates = insights.filter(i =>
      i.blockIndex === issueOrigin.index && (i.kind === 'risk' || i.kind === 'action'))
    return candidates.find(i => i.kind === 'risk') ?? candidates.find(i => i.kind === 'action') ?? null
  }, [insights, issueOrigin])
  const issueSourceKind: IssueMinuteSourceKind = issueOrigin?.type === 'selection'
    ? 'manual'
    : issueInsight?.kind === 'risk'
      ? 'risk'
      : issueInsight?.kind === 'action' ? 'action' : 'manual'
  const issueSourceText = issueOrigin?.type === 'selection'
    ? issueOrigin.excerpt
    : issueBlock ? minuteBlockDraftText(issueBlock) : ''
  const issueDraft = useMemo<IssueFormDraft | undefined>(() => {
    if (!issueBlock || !issueSourceText) return undefined
    const draft = preparedIssueDraft
      ?? buildFallbackMinuteIssueDraft(
        issueSourceText,
        issueOrigin?.type === 'block' ? issueInsight?.label : null,
      )
    if (!draft) return undefined
    return { ...draft, severity: 'medium', assigneeMemberIds: [], startDate: null, dueDate: null }
  }, [issueBlock, issueInsight, issueOrigin, issueSourceText, preparedIssueDraft])
```

(c) `issueContextAt(index)` → `issueContextFor(origin)` 로 일반화(소스 빌더 공유):

```ts
  function issueSourceInputFor(origin: IssueOrigin): MinuteIssueSourceInput | null {
    if (!currentVersion) return null
    if (origin.type === 'block') {
      const block = blocks[origin.index]
      if (!block) return null
      const candidates = insights.filter(insight =>
        insight.blockIndex === origin.index && (insight.kind === 'risk' || insight.kind === 'action'))
      const insight = candidates.find(candidate => candidate.kind === 'risk')
        ?? candidates.find(candidate => candidate.kind === 'action')
        ?? null
      const kind: IssueMinuteSourceKind = insight?.kind === 'risk'
        ? 'risk'
        : insight?.kind === 'action' ? 'action' : 'manual'
      return {
        minuteId: minute.id,
        minuteVersionId: currentVersion.id,
        bodyHash,
        blockIndex: block.index,
        blockHash: block.hash,
        kind,
      }
    }
    const start = blocks[origin.startIndex]
    const end = blocks[origin.endIndex]
    if (!start || !end) return null
    return {
      minuteId: minute.id,
      minuteVersionId: currentVersion.id,
      bodyHash,
      blockIndex: start.index,
      blockHash: start.hash,
      kind: 'manual',
      selection: { text: origin.text, endBlockIndex: end.index, endBlockHash: end.hash },
    }
  }

  function issueContextFor(origin: IssueOrigin) {
    const source = issueSourceInputFor(origin)
    if (!source) return null
    if (origin.type === 'selection') {
      return { source, fallback: buildFallbackMinuteIssueDraft(origin.excerpt, null) }
    }
    const block = blocks[origin.index]
    if (!block) return null
    const candidates = insights.filter(insight =>
      insight.blockIndex === origin.index && (insight.kind === 'risk' || insight.kind === 'action'))
    const insight = candidates.find(candidate => candidate.kind === 'risk')
      ?? candidates.find(candidate => candidate.kind === 'action')
      ?? null
    return {
      source,
      fallback: buildFallbackMinuteIssueDraft(minuteBlockDraftText(block), insight?.label),
    }
  }
```

(d) `beginIssueCreate` 를 origin 파라미터화 — 기존 본문에서 `popover.blockIndex` 대신
origin 을 쓰고, `setIssueBlockIndex(idx)` → `setIssueOrigin(origin)`,
`context = issueContextAt(idx)` → `context = issueContextFor(origin)`,
실패 경로의 `setIssueBlockIndex(null)` → `setIssueOrigin(null)` 로 치환:

```ts
  async function beginIssueCreateFrom(origin: IssueOrigin) {
    const requestId = ++issueProjectRequestRef.current
    setIssueBusy(false)
    if (!currentVersion) {
      toast({ title: t('min.issue.versionMissing'), variant: 'error' })
      setPopover(null)
      return
    }
    const context = issueContextFor(origin)
    if (!context) {
      toast({ title: t('min.issue.versionMissing'), variant: 'error' })
      setPopover(null)
      return
    }
    setIssueOrigin(origin)
    setPreparedIssueDraft(null)
    setIssueProjectError(null)
    const fixedProjectId = minute.projectId ?? minute.meetingProjectId ?? ''
    if (fixedProjectId) {
      /* 기존 beginIssueCreate 의 prepare 호출·에러·폴백 로직을 그대로 옮긴다(문구·requestId
         가드 포함). 단 하나의 변경: try/catch/finally 이후의
           setPopover(null); setIssueFormOpen(true)
         직전에 window.getSelection()?.removeAllRanges() 를 추가한다 — 선택 흐름에서
         폼이 열리면 버블이 selectionchange 로 자연 소멸한다. */
      return
    }
    setPopover(null)
    window.getSelection()?.removeAllRanges()
    setIssueProjectId('')
    setIssueMemberOptions([])
    setProjectPickerOpen(true)
  }

  function beginIssueCreate() {
    if (!popover) return
    void beginIssueCreateFrom({ type: 'block', index: popover.blockIndex })
  }
```

주의: 기존 `beginIssueCreate` 안의 `const idx = popover.blockIndex` / `if (!popover) return`
은 래퍼로 이동한다. prepare 성공·폴백 경로의 `setPopover(null)` 호출은 블록 흐름에서만
의미가 있으나 무해하므로 그대로 둔다.

(e) `continueWithProject` — `issueBlockIndex === null` 검사를 `issueOrigin === null` 로,
`issueContextAt(issueBlockIndex)` 를 `issueContextFor(issueOrigin)` 로 치환.

(f) `createLinkedIssue` — 소스 빌더 재사용:

```ts
  function createLinkedIssue(projectId: string, input: IssueInput) {
    if (!issueOrigin || !currentVersion) {
      return Promise.resolve({ ok: false, error: t('min.issue.versionMissing') })
    }
    const source = issueSourceInputFor(issueOrigin)
    if (!source) {
      return Promise.resolve({ ok: false, error: t('min.issue.versionMissing') })
    }
    return createIssueFromMinuteBlock(projectId, input, source)
  }
```

(g) `closeIssueForm`·`closeProjectPicker`·팝오버 `onClose` 의 `setIssueBlockIndex(null)` 를
전부 `setIssueOrigin(null)` 로 치환.

(h) 선택 버블 핸들러 + 렌더 — 팝오버 렌더 블록 아래에 추가:

```tsx
  function onSelectionIssue(target: MinuteSelectionTarget) {
    const excerpt = normalizeSelectionText(target.text)
    if (!excerpt) return
    void beginIssueCreateFrom({ type: 'selection', ...target, excerpt })
  }
```

```tsx
      {!historicalVersion && !minute.archivedAt && (
        <MinuteSelectionBubble
          bodyRef={bodyRef}
          blocks={blocks}
          disabled={issueFormOpen || projectPickerOpen}
          busy={issueBusy}
          onCreateIssue={onSelectionIssue}
        />
      )}
```

(i) `sourcePreview` — 발췌·라벨을 origin 에 맞춘다:

```tsx
          sourcePreview={{
            title: currentVersion?.title ?? minute.title,
            date: currentVersion?.minuteDate ?? minute.minuteDate,
            excerpt: issueSourceText,
            label: `${issueOrigin?.type === 'selection'
              ? t('min.sel.sourceLabel')
              : t('min.issue.sourceLabel')} · v${currentVersion?.versionNo ?? 1}`,
            organizedDraft: true,
            classificationRecommended: preparedIssueDraft?.mode === 'ai'
              && Boolean(preparedIssueDraft.megaCode && preparedIssueDraft.subProcess),
          }}
```

- [ ] **Step 4: 통과 확인 (기존 흐름 회귀 포함)**

Run: `npm run test -- tests/ui/minute-issue-draft-flow.test.tsx tests/ui/minute-selection-bubble.test.tsx tests/ui/issue-form-draft.test.tsx`
Expected: PASS — 기존 블록 흐름 테스트 전체 + 신규 선택 흐름 2건

- [ ] **Step 5: 커밋**

```bash
git add src/components/minutes/MinuteViewer.tsx tests/ui/minute-issue-draft-flow.test.tsx
git commit -m "feat(minutes): 뷰어에 드래그 선택 이슈 흐름 배선 — 블록·선택을 단일 원천 유니언으로

블록 팝오버와 선택 버블이 같은 상태 기계(프로젝트 픽커·AI 초안·폼)를 공유해
문구·에러·폴백 동작이 갈라지지 않는다. 폼이 열릴 때 선택을 해제해 버블을
정리한다."
```

---

### Task 6: 전체 검증

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 전체 테스트**

Run: `npm run test`
Expected: PASS (전량 — 2026-07-27 사고 교훈: vitest 통과가 화면 보증은 아니므로 아래 lint/build 병행)

- [ ] **Step 2: 린트 + 빌드**

Run: `npm run lint && npm run build`
Expected: 오류 0 (경고 허용)

- [ ] **Step 3: 실패 시 수정 후 재검증, 수정분은 해당 태스크 커밋에 fixup 하지 말고 별도 커밋**

```bash
git add <수정 파일 명시>
git commit -m "fix(minutes): 선택 이슈 등록 검증 후속 수정 — <사유>"
```
