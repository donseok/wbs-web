# WBS 상세 패널 조회 묶음(클릭 지연 개선) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WBS 행을 클릭했을 때 상세 패널이 채워지기까지 걸리는 시간을 직렬 서버 액션 5건(실측 1.5~2.6초)에서 서버 액션 1건(목표 0.7초 이내)으로 줄인다.

**Architecture:** 상세 패널이 열릴 때 나가던 조회 액션 다섯(변경 이력·첨부·담당/단계·명세·에이전트 주문)을 순수 로더 다섯으로 뽑아 `src/lib/data/wbsItemDetail.ts` 에 모으고, 권한 판정을 한 번만 하는 통합 액션 `getWbsItemDetail` 이 그 로더들을 `Promise.all` 로 돌린다. 클라이언트는 `RowDetailPanel` 이 통합 액션을 한 번 호출해 React 컨텍스트로 내려주고, 각 섹션은 컨텍스트가 있으면 스스로 읽지 않는다. 기존 소형 액션 다섯은 편집 뒤 재조회용으로 그대로 남기되 같은 로더를 쓰게 한다.

**Tech Stack:** Next.js 15.5 App Router 서버 액션, Supabase(`@supabase/ssr` 서버 클라이언트, RLS), React 19 컨텍스트, vitest(jsdom).

**Spec:** 별도 스펙 없음. 이 문서의 「배경과 근거」 절이 요구사항 정본이다.

## Global Constraints

- `git add -A` 금지. 파일명을 명시해 stage 한다. (CLAUDE.md)
- 커밋 메시지는 한국어, "무엇"보다 "왜". 커밋 끝에 `Co-Authored-By` 트레일러를 붙인다.
- 마이그레이션 없음. `supabase/migrations/*` 를 건드리지 않는다.
- 권한 판정은 `requireProjectMember(pid)` 등 가드 셋으로만 한다. `role === '...'` 직접 비교 금지. `memberships.role` 을 새로 읽지 않는다(기존 코드 이동은 예외, Task 1 참고).
- 에러 처리 3원칙: 조회 실패를 "데이터 없음"으로 위장하지 않는다(표시 = 로깅). 가드는 fail-closed.
- UI 위험 파일(`src/app/globals.css`, `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/components/app/*`)은 건드리지 않는다. 이 계획의 파일은 모두 그 밖이다.
- 작업 브랜치: `staging` 에서 `perf/wbs-detail-bundle` 을 딴다. 완료 후 `staging` 에 머지해 스테이징 URL 에서 확인한 뒤 `main` 으로 보낸다(docs/runbook-staging.md).
- 기존 테스트 전부 초록 유지: `npm run test`.

---

## 배경과 근거 (2026-09-14 실측)

스테이징 `MES 공통 개발` 프로젝트(220행) WBS 에서 행을 프로그램으로 클릭하고 Resource Timing API 로 그 뒤 요청을 관측했다.

| 표본 | 요청 수 | 각 요청 소요(ms) | 마지막 응답까지(ms) |
|---|---|---|---|
| 1 | 5 (모두 POST `/p/…/wbs`) | 1009, 360, 327, 286, 305 | 2571 |
| 2 | 5 | 474, 302, 244, 249, 182 | 1548 |
| 비교: `router.refresh()` 1회 | 1 (GET `?_rsc`) | 501 (132KB) | 512 |

다섯 요청은 **앞 요청의 `responseEnd` 시각에 다음 요청이 시작**한다. 병렬이 아니라 직렬이다.

원인은 두 겹이다.

1. **Next.js 앱 라우터가 서버 액션을 직렬 큐로 실행한다.** `node_modules/next/dist/client/app-call-server.js` 가 모든 서버 액션 호출을 `ACTION_SERVER_ACTION` 으로 라우터 액션 큐에 넣고, `app-router-instance.js` 의 `runAction` 이 연결 리스트를 하나 끝난 뒤 다음을 시작한다. 클라이언트에서 `Promise.all` 로 묶어도 직렬이다. 따라서 해법은 **요청 수 자체를 줄이는 것**이다.
2. **액션 하나가 DB 왕복 3~5단을 순차로 한다.** 각 액션이 따로 `auth.getUser()`(GoTrue HTTP) → `resolveProjectId`(wbs_items) → `getActor`(memberships·project_roles·project_members 병렬) → 본 조회를 한다. `getActor`/`getSession` 의 `cache()` 는 요청 1건 안에서만 유효해 요청 5건이면 다섯 번 반복된다. 첨부 목록은 파일 수만큼 `createSignedUrl` 을 순차 for 문으로 더 돈다.

패널을 여는 순간 나가는 액션과 호출 위치:

| 액션 | 정의 | 호출 위치 | 가드 |
|---|---|---|---|
| `getChangeLogs` | `src/app/actions/wbs.ts:26` | `RowDetailPanel.tsx:104` | 로그인만 |
| `listAttachments` | `src/app/actions/attachments.ts:38` | `RowDetailPanel.tsx:722` (AttachmentSection) | 로그인만 |
| `getWbsAssigneeStage` | `src/app/actions/wbsAssign.ts:566` | `WbsAssigneeStagePanel.tsx:61` | 프로젝트 멤버 |
| `getWbsSpec` | `src/app/actions/wbsSpec.ts:68` | `WbsSpecPanel.tsx:75` | 프로젝트 멤버 |
| `getAgentOrderForItem` | `src/app/actions/agentWork.ts:391` | `WbsSpecPanel.tsx:369` (WbsAgentOrderStatus, 접힘과 무관하게 마운트 시) | 프로젝트 멤버 |

인프라는 원인이 아니다. Vercel 함수 리전 `icn1`, Supabase `ap-northeast-2`. 페이지 전체를 다시 그리는 `router.refresh()` 가 0.5초인데 조회 액션 하나가 0.2~1.0초다. 비용은 조회 본체가 아니라 요청당 고정 오버헤드(함수 호출·인증·가드)에 있다.

### 이 계획의 범위 밖 (후속 계획으로)

- 편집 뒤 `router.refresh()` 14곳 감량(패널 셋). 시트에 보이지 않는 필드(명세·프롬프트·참조)는 로컬 상태만 갱신.
- 서버 액션 세션 확인을 `getClaims()` 로(미들웨어와 같은 근거). 통합 후엔 클릭당 1회라 이득이 작아졌다.
- `src/lib/data/wbs.ts:34` `item_owners` 조회에 `project_id` 필터 없음(전 프로젝트 행을 매번 수신). 페이지 로드·refresh 비용.
- 시트 행 렌더 메모이제이션(`setSelectedId` 마다 2000줄 컴포넌트 전체 재렌더, `allDates` flatMap 미메모). 220행에서는 미미하고 N단 대형 WBS 에서 커진다.

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| Create `src/lib/data/wbsItemDetail.ts` | 순수 로더 5개. `sb`(서버 클라이언트)와 `itemId` 를 받아 조회만 한다. 가드 없음. |
| Create `src/app/actions/wbsDetail.ts` | 통합 액션 `getWbsItemDetail`. 가드 1회 + 로더 5개 병렬. |
| Modify `src/app/actions/wbs.ts:26-66` | `getChangeLogs` 본문을 로더 호출로 교체. |
| Modify `src/app/actions/attachments.ts:38-63` | `listAttachments` 본문을 로더 호출로 교체. |
| Modify `src/app/actions/wbsAssign.ts:566-592` | `getWbsAssigneeStage` 본문을 로더 호출로 교체. |
| Modify `src/app/actions/wbsSpec.ts:68-116` | `getWbsSpec` 본문을 로더 호출로 교체. |
| Modify `src/app/actions/agentWork.ts:391-431` | `getAgentOrderForItem` 본문을 로더 호출로 교체. |
| Create `src/components/wbs/WbsItemDetailContext.tsx` | 묶음 상태 컨텍스트 + `useWbsItemDetail(itemId)`. |
| Modify `src/components/wbs/RowDetailPanel.tsx` | 묶음 1회 로드, 컨텍스트 제공, 변경 이력은 묶음에서. `AttachmentSection` 이 묶음을 쓴다. |
| Modify `src/components/wbs/WbsAssigneeStagePanel.tsx` | 묶음이 있으면 자가 조회 생략. |
| Modify `src/components/wbs/WbsSpecPanel.tsx` | `WbsSpecPanel`·`WbsAgentOrderStatus` 가 묶음이 있으면 자가 조회 생략. |
| Test `tests/data/wbs-item-detail.test.ts` | 로더 단위 테스트. |
| Test `tests/actions/wbs-detail.test.ts` | 통합 액션 가드·조립 테스트. |
| Test `tests/components/wbs-item-detail-context.test.tsx` | 컨텍스트 아래에서 섹션이 자가 조회를 안 하는지. |
| Modify `tests/components/wbs-row-detail-overview.test.tsx`, `tests/components/wbs-dependency-readiness-panel.test.tsx`, `tests/ui/wbs-subact-add.test.tsx`, `tests/ui/wbs-leaf-actual.test.tsx` | `RowDetailPanel` 을 렌더하는 테스트에 `@/app/actions/wbsDetail` 모킹 추가. |

---

### Task 0: 브랜치

**Files:** 없음.

- [ ] **Step 1: staging 최신화 후 브랜치 생성**

```bash
git switch staging && git pull --ff-only origin staging
git switch -c perf/wbs-detail-bundle
```

Expected: `Switched to a new branch 'perf/wbs-detail-bundle'`

---

### Task 1: 순수 로더 `src/lib/data/wbsItemDetail.ts`

**Files:**
- Create: `src/lib/data/wbsItemDetail.ts`
- Test: `tests/data/wbs-item-detail.test.ts`

**Interfaces:**
- Consumes: `ChangeLogEntry`(`@/app/actions/wbs`), `WbsSpecDetail`·`WbsPriority`(`@/app/actions/wbsSpec`), `AgentOrderStatus`·`AgentOrderBrief`·`AgentOrderReport`(`@/app/actions/agentWork`), `DeliverableAttachment`·`TeamCode`(`@/lib/domain/types`). 모두 타입 전용 import 라 `'use server'` 모듈을 lib 에서 참조해도 번들에 남지 않는다.
- Produces (Task 2·3 이 그대로 쓴다):
  - `type Db = Awaited<ReturnType<typeof createServerClient>>`
  - `const ATTACHMENT_BUCKET = 'deliverables'`
  - `type AssigneeStage = { assigneeMemberId: string | null; stage: string | null; devWorkflow: boolean }`
  - `type AgentOrderBundle = { order: AgentOrderStatus | null; priorOrders: AgentOrderBrief[] }`
  - `loadChangeLogs(sb: Db, itemId: string): Promise<ChangeLogEntry[]>`
  - `loadAttachments(sb: Db, itemId: string): Promise<DeliverableAttachment[]>`
  - `loadAssigneeStage(sb: Db, itemId: string): Promise<AssigneeStage | null>`
  - `loadSpec(sb: Db, itemId: string): Promise<WbsSpecDetail | null>`
  - `loadAgentOrder(sb: Db, itemId: string): Promise<({ ok: true } & AgentOrderBundle) | { ok: false; error: string }>`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/data/wbs-item-detail.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  loadAgentOrder, loadAssigneeStage, loadAttachments, loadChangeLogs, loadSpec, type Db,
} from '@/lib/data/wbsItemDetail'

type Resp = { data?: unknown; error?: { message: string } | null }

/** 테이블별 응답 큐를 가진 가짜 서버 클라이언트. from() 호출 순서와 서명 URL 호출 수를 기록한다. */
function fakeClient(queues: Record<string, Resp[]>, signed: Record<string, string> = {}) {
  const calls: string[] = []
  const createSignedUrl = vi.fn(async (path: string) => ({
    data: signed[path] ? { signedUrl: signed[path] } : null, error: null,
  }))
  const client = {
    from: vi.fn((table: string) => {
      calls.push(table)
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'order', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    storage: { from: () => ({ createSignedUrl }) },
  }
  return { sb: client as unknown as Db, calls, createSignedUrl }
}

const W1 = '33333333-3333-4333-8333-333333333333'

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('loadChangeLogs', () => {
  it('이력의 user_id 로 memberships 를 한 번 조회해 팀 코드를 붙인다', async () => {
    const { sb, calls } = fakeClient({
      change_logs: [{ data: [
        { id: 2, field: 'actual_pct', old_value: '10', new_value: '20', at: '2026-09-14T01:00:00Z', user_id: 'u1' },
        { id: 1, field: 'weight', old_value: null, new_value: '3', at: '2026-09-13T01:00:00Z', user_id: null },
      ] }],
      memberships: [{ data: [{ user_id: 'u1', role: 'pm', teams: { code: 'PMO' } }] }],
    })
    const out = await loadChangeLogs(sb, W1)
    expect(calls).toEqual(['change_logs', 'memberships'])
    expect(out).toEqual([
      { id: 2, field: 'actual_pct', oldValue: '10', newValue: '20', at: '2026-09-14T01:00:00Z', actorTeam: 'PMO', actorRole: 'pm' },
      { id: 1, field: 'weight', oldValue: null, newValue: '3', at: '2026-09-13T01:00:00Z', actorTeam: null, actorRole: null },
    ])
  })
  it('이력 조회 실패는 빈 목록 + console.error', async () => {
    const { sb, calls } = fakeClient({ change_logs: [{ data: null, error: { message: 'boom' } }] })
    expect(await loadChangeLogs(sb, W1)).toEqual([])
    expect(calls).toEqual(['change_logs'])
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[loadChangeLogs]'), 'boom')
  })
})

describe('loadAttachments', () => {
  it('첨부마다 서명 URL 을 만들되 순차가 아니라 병렬로 요청한다', async () => {
    const { sb, createSignedUrl } = fakeClient({
      deliverable_attachments: [{ data: [
        { id: 'a1', wbs_item_id: W1, file_name: 'a.pdf', file_path: 'p/a.pdf', size: 10, mime: 'application/pdf', created_at: '2026-09-14T00:00:00Z' },
        { id: 'a2', wbs_item_id: W1, file_name: 'b.pdf', file_path: 'p/b.pdf', size: null, mime: null, created_at: '2026-09-13T00:00:00Z' },
      ] }],
    }, { 'p/a.pdf': 'https://s/a', 'p/b.pdf': 'https://s/b' })
    // 두 호출이 서로 끝나길 기다리지 않는다: 첫 호출이 반환되기 전에 두 번째가 이미 호출돼 있어야 한다.
    let concurrent = 0, maxConcurrent = 0
    createSignedUrl.mockImplementation(async (path: string) => {
      concurrent += 1; maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise(r => setTimeout(r, 5))
      concurrent -= 1
      return { data: { signedUrl: `https://s/${path.split('/')[1]}` }, error: null }
    })
    const out = await loadAttachments(sb, W1)
    expect(createSignedUrl).toHaveBeenCalledTimes(2)
    expect(maxConcurrent).toBe(2)
    expect(out.map(a => [a.id, a.url])).toEqual([['a1', 'https://s/a.pdf'], ['a2', 'https://s/b.pdf']])
  })
  it('조회 실패는 빈 목록 + console.error', async () => {
    const { sb } = fakeClient({ deliverable_attachments: [{ data: null, error: { message: 'boom' } }] })
    expect(await loadAttachments(sb, W1)).toEqual([])
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[loadAttachments]'), 'boom')
  })
})

describe('loadAssigneeStage', () => {
  it('행을 camelCase 로 매핑한다', async () => {
    const { sb } = fakeClient({ wbs_items: [{ data: { assignee_member_id: 'm1', stage: 'ip', dev_workflow: true } }] })
    expect(await loadAssigneeStage(sb, W1)).toEqual({ assigneeMemberId: 'm1', stage: 'ip', devWorkflow: true })
  })
  it('조회 실패는 null(미배정으로 위장하지 않는다)', async () => {
    const { sb } = fakeClient({ wbs_items: [{ data: null, error: { message: 'boom' } }] })
    expect(await loadAssigneeStage(sb, W1)).toBeNull()
  })
})

describe('loadSpec', () => {
  it('acceptance 는 문자열만 남기고, null 컬럼은 기본값으로', async () => {
    const { sb } = fakeClient({ wbs_items: [{ data: {
      category: 'dev', domain: null, priority: 'high', model: null, tags: ['agent'], depends: null,
      prd_ref: 'PRD-1', entry_point: null, acceptance: ['ok', 3, null], spec: '# s', external_ref: null, agent_prompt: null,
    } }] })
    expect(await loadSpec(sb, W1)).toEqual({
      category: 'dev', domain: null, priority: 'high', model: null, tags: ['agent'], depends: [],
      prdRef: 'PRD-1', entryPoint: null, acceptance: ['ok'], spec: '# s', externalRef: null, agentPrompt: null,
    })
  })
  it('조회 실패는 null', async () => {
    const { sb } = fakeClient({ wbs_items: [{ data: null, error: { message: 'boom' } }] })
    expect(await loadSpec(sb, W1)).toBeNull()
  })
})

describe('loadAgentOrder', () => {
  it('주문이 없으면 order:null', async () => {
    const { sb, calls } = fakeClient({ agent_work_orders: [{ data: [] }] })
    expect(await loadAgentOrder(sb, W1)).toEqual({ ok: true, order: null, priorOrders: [] })
    expect(calls).toEqual(['agent_work_orders'])
  })
  it('최신 주문 + 그 보고, 이전 주문은 요약만', async () => {
    const { sb, calls } = fakeClient({
      agent_work_orders: [{ data: [
        { id: 'o2', status: 'reported', claimed_by: 'bot', claimed_at: '2026-09-14T00:00:00Z', updated_at: '2026-09-14T01:00:00Z' },
        { id: 'o1', status: 'approved', claimed_by: null, claimed_at: null, updated_at: '2026-09-10T00:00:00Z' },
      ] }],
      agent_work_reports: [{ data: [{ id: 'r1', kind: 'done', percent: 100, summary: 's', links: [], agent: 'a', review_action: null, review_note: null, created_at: '2026-09-14T00:30:00Z' }] }],
    })
    const r = await loadAgentOrder(sb, W1)
    expect(calls).toEqual(['agent_work_orders', 'agent_work_reports'])
    expect(r).toEqual({
      ok: true,
      order: { id: 'o2', status: 'reported', claimed_by: 'bot', claimed_at: '2026-09-14T00:00:00Z', updated_at: '2026-09-14T01:00:00Z', reports: [expect.objectContaining({ id: 'r1' })] },
      priorOrders: [{ id: 'o1', status: 'approved', updated_at: '2026-09-10T00:00:00Z' }],
    })
  })
  it('주문 조회 실패는 ok:false 와 사유', async () => {
    const { sb } = fakeClient({ agent_work_orders: [{ data: null, error: { message: 'boom' } }] })
    expect(await loadAgentOrder(sb, W1)).toEqual({ ok: false, error: '주문 조회 실패: boom' })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/data/wbs-item-detail.test.ts`
Expected: FAIL — `Cannot find module '@/lib/data/wbsItemDetail'`

- [ ] **Step 3: 로더 구현**

```ts
// src/lib/data/wbsItemDetail.ts
import type { createServerClient } from '@/lib/supabase/server'
import type { DeliverableAttachment, TeamCode } from '@/lib/domain/types'
import type { ChangeLogEntry } from '@/app/actions/wbs'
import type { WbsPriority, WbsSpecDetail } from '@/app/actions/wbsSpec'
import type { AgentOrderBrief, AgentOrderReport, AgentOrderStatus } from '@/app/actions/agentWork'

/**
 * WBS 상세 패널이 여는 순간 필요한 조회 다섯 — 가드 없는 순수 로더.
 *
 * 왜 액션에서 뽑았나: Next 앱 라우터가 서버 액션을 직렬 큐로 실행해(app-router-instance.js
 * runAction) 패널 하나에 액션 다섯이 나가면 앞 요청이 끝나야 다음이 시작된다(2026-09-14 실측
 * 1.5~2.6초). 통합 액션 getWbsItemDetail 이 가드 1회 뒤 이 로더들을 병렬로 돌리고, 편집 뒤
 * 재조회용 소형 액션들도 같은 로더를 써 조회 본문을 한 곳에 둔다.
 *
 * 실패 규칙은 원래 액션과 같다 — 목록형(이력·첨부)은 빈 배열 + console.error, 단건형(담당·명세)은
 * null(3원칙 ①: "조회 안 됨"을 "없음"으로 위장하지 않는다), 주문은 ok/error 결과 객체.
 */
export type Db = Awaited<ReturnType<typeof createServerClient>>

export const ATTACHMENT_BUCKET = 'deliverables'

export type AssigneeStage = { assigneeMemberId: string | null; stage: string | null; devWorkflow: boolean }
export type AgentOrderBundle = { order: AgentOrderStatus | null; priorOrders: AgentOrderBrief[] }

/** 변경 이력 최신 50건. user_id 의 표시는 프로필 테이블이 없어 memberships 의 팀/역할로 대체한다
 *  (getChangeLogs 에서 그대로 옮김 — memberships.role 은 deprecated(0054)라 새 참조를 만들지 않되,
 *  표시 전용 기존 참조는 이 이동에서 바꾸지 않는다). */
export async function loadChangeLogs(sb: Db, itemId: string): Promise<ChangeLogEntry[]> {
  const { data: logs, error: logErr } = await sb
    .from('change_logs')
    .select('id, field, old_value, new_value, at, user_id')
    .eq('wbs_item_id', itemId)
    .order('at', { ascending: false })
    .limit(50)
  if (logErr) console.error('[loadChangeLogs] 변경 이력 조회 실패:', logErr.message)
  if (!logs?.length) return []

  const userIds = [...new Set(logs.map(l => l.user_id).filter(Boolean) as string[])]
  const actorMap = new Map<string, { team: TeamCode | null; role: string | null }>()
  if (userIds.length) {
    const { data: mems, error: memErr } = await sb
      .from('memberships').select('user_id, role, teams(code)').in('user_id', userIds)
    if (memErr) console.error('[loadChangeLogs] 작성자 정보 조회 실패:', memErr.message)
    ;(mems ?? []).forEach((m: Record<string, unknown>) => {
      const t = m.teams as { code: TeamCode } | { code: TeamCode }[] | null
      const code = (Array.isArray(t) ? t[0]?.code : t?.code) ?? null
      actorMap.set(m.user_id as string, { team: code, role: (m.role as string) ?? null })
    })
  }

  return logs.map(l => {
    const actor = l.user_id ? actorMap.get(l.user_id as string) : undefined
    return {
      id: l.id as number,
      field: l.field as string,
      oldValue: (l.old_value as string) ?? null,
      newValue: (l.new_value as string) ?? null,
      at: l.at as string,
      actorTeam: actor?.team ?? null,
      actorRole: actor?.role ?? null,
    }
  })
}

/** 첨부 목록(서명 URL 포함, 최신순). 서명 URL 은 첨부 수만큼 왕복하므로 병렬로 만든다. */
export async function loadAttachments(sb: Db, itemId: string): Promise<DeliverableAttachment[]> {
  const { data, error } = await sb
    .from('deliverable_attachments')
    .select('*')
    .eq('wbs_item_id', itemId)
    .order('created_at', { ascending: false })
  if (error) console.error('[loadAttachments] 첨부 조회 실패:', error.message)
  const rows = (data ?? []) as Array<Record<string, unknown>>
  return Promise.all(rows.map(async r => {
    const { data: signed } = await sb.storage.from(ATTACHMENT_BUCKET).createSignedUrl(r.file_path as string, 3600)
    return {
      id: r.id as string,
      wbsItemId: r.wbs_item_id as string,
      fileName: r.file_name as string,
      filePath: r.file_path as string,
      size: (r.size as number) ?? null,
      mime: (r.mime as string) ?? null,
      createdAt: r.created_at as string,
      url: signed?.signedUrl ?? null,
    }
  }))
}

export async function loadAssigneeStage(sb: Db, itemId: string): Promise<AssigneeStage | null> {
  const { data, error } = await sb
    .from('wbs_items').select('assignee_member_id, stage, dev_workflow').eq('id', itemId).maybeSingle()
  if (error) {
    console.error('[loadAssigneeStage] 조회 실패:', error.message)
    return null
  }
  if (!data) return null
  const row = data as { assignee_member_id: string | null; stage: string | null; dev_workflow: boolean | null }
  return {
    assigneeMemberId: row.assignee_member_id ?? null,
    stage: row.stage ?? null,
    devWorkflow: row.dev_workflow === true,
  }
}

export async function loadSpec(sb: Db, itemId: string): Promise<WbsSpecDetail | null> {
  const { data, error } = await sb
    .from('wbs_items')
    .select('category, domain, priority, model, tags, depends, prd_ref, entry_point, acceptance, spec, external_ref, agent_prompt')
    .eq('id', itemId).maybeSingle()
  if (error) {
    console.error('[loadSpec] 조회 실패:', error.message)
    return null
  }
  if (!data) return null
  const row = data as {
    category: string | null
    domain: string | null
    priority: string | null
    model: string | null
    tags: string[] | null
    depends: string[] | null
    prd_ref: string | null
    entry_point: string | null
    acceptance: unknown
    spec: string | null
    external_ref: string | null
    agent_prompt: string | null
  }
  return {
    category: row.category ?? null,
    domain: row.domain ?? null,
    priority: (row.priority as WbsPriority | null) ?? null,
    model: row.model ?? null,
    tags: row.tags ?? [],
    depends: row.depends ?? [],
    prdRef: row.prd_ref ?? null,
    entryPoint: row.entry_point ?? null,
    acceptance: Array.isArray(row.acceptance) ? row.acceptance.filter((v): v is string => typeof v === 'string') : [],
    spec: row.spec ?? null,
    externalRef: row.external_ref ?? null,
    agentPrompt: row.agent_prompt ?? null,
  }
}

/** 최신 주문 + 그 보고, 이전 주문은 요약만. limit(1) 을 쓰지 않는 이유는 getAgentOrderForItem 주석 참고
 *  (승인된 주문은 항목을 비워주고 재발행이 새 주문을 만든다 — 최신 하나만 읽으면 승인 이력이 사라진다). */
export async function loadAgentOrder(
  sb: Db, itemId: string,
): Promise<({ ok: true } & AgentOrderBundle) | { ok: false; error: string }> {
  const { data: orders, error: ordErr } = await sb
    .from('agent_work_orders')
    .select('id, status, claimed_by, claimed_at, updated_at')
    .eq('wbs_item_id', itemId)
    .order('updated_at', { ascending: false })
  if (ordErr) return { ok: false, error: `주문 조회 실패: ${ordErr.message}` }
  const rows = (orders ?? []) as Array<{
    id: string; status: string; claimed_by: string | null; claimed_at: string | null; updated_at: string
  }>
  if (rows.length === 0) return { ok: true, order: null, priorOrders: [] }
  const row = rows[0]
  const priorOrders: AgentOrderBrief[] = rows.slice(1)
    .map(o => ({ id: o.id, status: o.status, updated_at: o.updated_at }))

  const { data: reports, error: repErr } = await sb
    .from('agent_work_reports')
    .select('id, kind, percent, summary, links, agent, review_action, review_note, created_at')
    .eq('work_order_id', row.id)
    .order('created_at', { ascending: true })
  if (repErr) return { ok: false, error: `보고 조회 실패: ${repErr.message}` }
  return { ok: true, order: { ...row, reports: (reports ?? []) as AgentOrderReport[] }, priorOrders }
}
```

`AgentOrderReport` 가 `src/app/actions/agentWork.ts` 에서 export 되지 않았다면(현재는 `AgentOrderStatus` 의 `reports` 필드 타입으로만 쓰임) 그 파일의 타입 선언에 `export` 를 붙인다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/data/wbs-item-detail.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/wbsItemDetail.ts tests/data/wbs-item-detail.test.ts src/app/actions/agentWork.ts
git commit -m "refactor(wbs): 상세 패널 조회 다섯을 가드 없는 로더로 뽑는다

Next 앱 라우터가 서버 액션을 직렬 큐로 돌려 패널 하나에 액션 다섯이 나가면
앞 요청이 끝나야 다음이 시작된다(스테이징 실측 1.5~2.6초). 통합 액션이 가드
한 번 뒤 이 로더들을 병렬로 부를 수 있게 조회 본문을 액션 밖으로 옮긴다.
첨부 서명 URL 은 순차 for 문이던 것을 병렬로 바꿨다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 통합 액션 `getWbsItemDetail`

**Files:**
- Create: `src/app/actions/wbsDetail.ts`
- Test: `tests/actions/wbs-detail.test.ts`

**Interfaces:**
- Consumes: Task 1 의 로더 5개와 `AssigneeStage`·`AgentOrderBundle`, `requireProjectMember`·`resolveProjectId`(`@/lib/authz`), `ERR_DENIED`(`@/lib/authz/errors`), `isUuidLike`(`@/lib/domain/validate`).
- Produces:
  - `type WbsItemDetail = { changeLogs: ChangeLogEntry[]; attachments: DeliverableAttachment[]; assigneeStage: AssigneeStage | null; spec: WbsSpecDetail | null; agentOrder: AgentOrderBundle | null }`
  - `getWbsItemDetail(itemId: string): Promise<WbsItemDetail | null>`

권한 규칙은 원래 액션 다섯의 합과 같아야 한다. 변경 이력·첨부는 **로그인만** 필요했고(D6, 조회는 전 프로젝트 개방) 담당·명세·주문은 **프로젝트 멤버**였다. 그래서 멤버가 아니어도 로그인 상태면 이력·첨부는 채우고 나머지 셋만 null 이다. 비로그인·조회 실패는 통째로 null.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/actions/wbs-detail.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveProjectId: vi.fn(),
  requireProjectMember: vi.fn(),
  createServerClient: vi.fn(),
  loadChangeLogs: vi.fn(),
  loadAttachments: vi.fn(),
  loadAssigneeStage: vi.fn(),
  loadSpec: vi.fn(),
  loadAgentOrder: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  resolveProjectId: mocks.resolveProjectId,
  requireProjectMember: mocks.requireProjectMember,
}))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/data/wbsItemDetail', () => ({
  loadChangeLogs: mocks.loadChangeLogs,
  loadAttachments: mocks.loadAttachments,
  loadAssigneeStage: mocks.loadAssigneeStage,
  loadSpec: mocks.loadSpec,
  loadAgentOrder: mocks.loadAgentOrder,
}))

import { getWbsItemDetail } from '@/app/actions/wbsDetail'
import { ERR_DENIED, ERR_LOOKUP } from '@/lib/authz/errors'

const P1 = '11111111-1111-4111-8111-111111111111'
const W1 = '33333333-3333-4333-8333-333333333333'
const SB = { tag: 'sb' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: P1 })
  mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'u1' } })
  mocks.createServerClient.mockResolvedValue(SB)
  mocks.loadChangeLogs.mockResolvedValue([{ id: 1 }])
  mocks.loadAttachments.mockResolvedValue([{ id: 'a1' }])
  mocks.loadAssigneeStage.mockResolvedValue({ assigneeMemberId: 'm1', stage: 'ip', devWorkflow: false })
  mocks.loadSpec.mockResolvedValue({ spec: '# s' })
  mocks.loadAgentOrder.mockResolvedValue({ ok: true, order: { id: 'o1' }, priorOrders: [] })
})

describe('getWbsItemDetail', () => {
  it('가드는 한 번, 로더 다섯은 같은 클라이언트로 모두 호출한다', async () => {
    const r = await getWbsItemDetail(W1)
    expect(mocks.resolveProjectId).toHaveBeenCalledTimes(1)
    expect(mocks.resolveProjectId).toHaveBeenCalledWith('wbs_items', W1)
    expect(mocks.requireProjectMember).toHaveBeenCalledTimes(1)
    expect(mocks.requireProjectMember).toHaveBeenCalledWith(P1)
    expect(mocks.createServerClient).toHaveBeenCalledTimes(1)
    for (const l of [mocks.loadChangeLogs, mocks.loadAttachments, mocks.loadAssigneeStage, mocks.loadSpec, mocks.loadAgentOrder]) {
      expect(l).toHaveBeenCalledWith(SB, W1)
    }
    expect(r).toEqual({
      changeLogs: [{ id: 1 }],
      attachments: [{ id: 'a1' }],
      assigneeStage: { assigneeMemberId: 'm1', stage: 'ip', devWorkflow: false },
      spec: { spec: '# s' },
      agentOrder: { order: { id: 'o1' }, priorOrders: [] },
    })
  })

  it('멤버가 아닌 로그인 사용자: 이력·첨부는 채우고 멤버 전용 셋은 null', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: ERR_DENIED })
    const r = await getWbsItemDetail(W1)
    expect(r).toEqual({
      changeLogs: [{ id: 1 }], attachments: [{ id: 'a1' }],
      assigneeStage: null, spec: null, agentOrder: null,
    })
    expect(mocks.loadAssigneeStage).not.toHaveBeenCalled()
    expect(mocks.loadSpec).not.toHaveBeenCalled()
    expect(mocks.loadAgentOrder).not.toHaveBeenCalled()
  })

  it('권한 조회 실패(ERR_LOOKUP)는 통째로 null', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: ERR_LOOKUP })
    expect(await getWbsItemDetail(W1)).toBeNull()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('프로젝트 조회 실패는 통째로 null', async () => {
    mocks.resolveProjectId.mockResolvedValue({ ok: false, error: ERR_LOOKUP })
    expect(await getWbsItemDetail(W1)).toBeNull()
    expect(mocks.requireProjectMember).not.toHaveBeenCalled()
  })

  it('주문 로더가 ok:false 면 그 섹션만 null', async () => {
    mocks.loadAgentOrder.mockResolvedValue({ ok: false, error: '주문 조회 실패: boom' })
    const r = await getWbsItemDetail(W1)
    expect(r?.agentOrder).toBeNull()
    expect(r?.spec).toEqual({ spec: '# s' })
  })

  it('UUID 가 아니면 가드도 부르지 않고 null', async () => {
    expect(await getWbsItemDetail('nope')).toBeNull()
    expect(mocks.resolveProjectId).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/actions/wbs-detail.test.ts`
Expected: FAIL — `Cannot find module '@/app/actions/wbsDetail'`

- [ ] **Step 3: 액션 구현**

```ts
// src/app/actions/wbsDetail.ts
'use server'
import { createServerClient } from '@/lib/supabase/server'
import { requireProjectMember, resolveProjectId } from '@/lib/authz'
import { ERR_DENIED } from '@/lib/authz/errors'
import { isUuidLike } from '@/lib/domain/validate'
import {
  loadAgentOrder, loadAssigneeStage, loadAttachments, loadChangeLogs, loadSpec,
  type AgentOrderBundle, type AssigneeStage,
} from '@/lib/data/wbsItemDetail'
import type { ChangeLogEntry } from '@/app/actions/wbs'
import type { WbsSpecDetail } from '@/app/actions/wbsSpec'
import type { DeliverableAttachment } from '@/lib/domain/types'

export type WbsItemDetail = {
  changeLogs: ChangeLogEntry[]
  attachments: DeliverableAttachment[]
  /** 프로젝트 멤버가 아니면 null(권한 없음). 멤버인데 null 이면 조회 실패 — 패널은 '표시 불가'로 그린다. */
  assigneeStage: AssigneeStage | null
  spec: WbsSpecDetail | null
  agentOrder: AgentOrderBundle | null
}

/**
 * 상세 패널이 열릴 때 필요한 조회 다섯을 **요청 하나**로 묶는다.
 *
 * Next 앱 라우터는 서버 액션을 직렬 큐로 실행한다(app-router-instance.js runAction —
 * 앞 액션의 응답이 와야 다음 액션의 요청이 나간다). 패널이 액션 다섯을 따로 부르면 각각
 * 세션 확인·프로젝트 판정·본 조회를 반복해 스테이징 실측 1.5~2.6초가 걸렸다(2026-09-14).
 * 여기서는 가드를 한 번만 하고 로더 다섯을 병렬로 돌린다.
 *
 * 권한은 원래 액션 다섯의 합과 같다 — 이력·첨부는 로그인만(D6), 담당·명세·주문은 프로젝트 멤버.
 * 멤버가 아니어도 로그인 상태면 이력·첨부는 채우고 나머지는 null. 비로그인·권한 조회 실패·
 * 프로젝트 조회 실패는 통째로 null(fail-closed).
 */
export async function getWbsItemDetail(itemId: string): Promise<WbsItemDetail | null> {
  if (!isUuidLike(itemId)) return null
  const resolved = await resolveProjectId('wbs_items', itemId)
  if (!resolved.ok) {
    console.error('[getWbsItemDetail] 프로젝트 조회 실패:', resolved.error)
    return null
  }
  const g = await requireProjectMember(resolved.projectId)
  if (!g.ok && g.error !== ERR_DENIED) {
    // 비로그인(ERR_ANON)·권한 조회 실패(ERR_LOOKUP) — 이력·첨부도 열어 주지 않는다.
    console.error('[getWbsItemDetail] 권한 확인 실패:', g.error)
    return null
  }
  const member = g.ok
  const sb = await createServerClient()
  const [changeLogs, attachments, assigneeStage, spec, agentOrder] = await Promise.all([
    loadChangeLogs(sb, itemId),
    loadAttachments(sb, itemId),
    member ? loadAssigneeStage(sb, itemId) : Promise.resolve(null),
    member ? loadSpec(sb, itemId) : Promise.resolve(null),
    member
      ? loadAgentOrder(sb, itemId).then(r => {
          if (r.ok) return { order: r.order, priorOrders: r.priorOrders }
          console.error('[getWbsItemDetail] 주문 조회 실패:', r.error)
          return null
        })
      : Promise.resolve(null),
  ])
  return { changeLogs, attachments, assigneeStage, spec, agentOrder }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/actions/wbs-detail.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/app/actions/wbsDetail.ts tests/actions/wbs-detail.test.ts
git commit -m "feat(wbs): 상세 패널 조회를 통합 액션 하나로 — 가드 1회, 로더 다섯 병렬

권한은 원래 액션 다섯의 합과 같다: 이력·첨부는 로그인만, 담당·명세·주문은
프로젝트 멤버. 멤버가 아니어도 이력·첨부는 채워 종전 화면과 같게 유지한다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 기존 소형 액션 다섯을 로더에 위임

편집 뒤 재조회 경로가 아직 소형 액션을 쓰므로 조회 본문이 두 벌이 되지 않게 위임한다. 공개 시그니처·반환값·가드는 바꾸지 않는다.

**Files:**
- Modify: `src/app/actions/wbs.ts:26-66` (`getChangeLogs`)
- Modify: `src/app/actions/attachments.ts:9,38-63` (`BUCKET`, `listAttachments`)
- Modify: `src/app/actions/wbsAssign.ts:566-592` (`getWbsAssigneeStage`)
- Modify: `src/app/actions/wbsSpec.ts:68-116` (`getWbsSpec`)
- Modify: `src/app/actions/agentWork.ts:391-431` (`getAgentOrderForItem`)
- Test: 기존 `tests/actions/agent-work-actions.test.ts`(getAgentOrderForItem 케이스 포함) 및 전체 스위트.

**Interfaces:** 변경 없음. 각 액션의 `Promise<...>` 반환 타입 그대로.

- [ ] **Step 1: 기존 테스트가 초록인지 먼저 확인(기준선)**

Run: `npx vitest run tests/actions/agent-work-actions.test.ts`
Expected: PASS

- [ ] **Step 2: `getChangeLogs` 본문 교체**

`src/app/actions/wbs.ts` 의 `getChangeLogs` 를 아래로 바꾼다. `ChangeLogEntry` 인터페이스와 `'use server'`·import 는 그대로 두고, 상단에 `import { loadChangeLogs } from '@/lib/data/wbsItemDetail'` 를 추가한다. 본문에서 더는 쓰지 않는 `TeamCode` import 가 남으면 lint 가 알려 주므로 그때 정리한다.

```ts
export async function getChangeLogs(itemId: string): Promise<ChangeLogEntry[]> {
  // 서버 액션 직접 호출에 대비한 인증 재확인(RLS와 이중 방어). 반환 타입에 에러 채널이 없어
  // listProjects 와 같은 관례로 빈 목록을 돌려주되, 조회 실패와 구분되도록 사유를 로그에 남긴다.
  if (!(await getSession())) {
    console.error('[getChangeLogs] 비로그인 호출 — 빈 이력 반환')
    return []
  }
  const sb = await createServerClient()
  return loadChangeLogs(sb, itemId)
}
```

- [ ] **Step 3: `listAttachments` 본문 교체**

`src/app/actions/attachments.ts` — `const BUCKET = 'deliverables'` 를 `import { ATTACHMENT_BUCKET as BUCKET, loadAttachments } from '@/lib/data/wbsItemDetail'` 로 바꾼다(업로드·삭제 경로가 `BUCKET` 을 계속 쓴다). `listAttachments` 는:

```ts
export async function listAttachments(itemId: string): Promise<DeliverableAttachment[]> {
  if (!(await getSession())) {
    console.error('[listAttachments] 비로그인 호출 — 빈 목록 반환')
    return []
  }
  const sb = await createServerClient()
  return loadAttachments(sb, itemId)
}
```

- [ ] **Step 4: `getWbsAssigneeStage` 본문 교체**

`src/app/actions/wbsAssign.ts` 상단에 `import { loadAssigneeStage } from '@/lib/data/wbsItemDetail'` 추가. 함수 본문의 `const sb = await createServerClient()` 이후를 `return loadAssigneeStage(sb, itemId)` 한 줄로 바꾼다. 앞부분(`isUuidLike` → `resolveProjectId` → `requireProjectMember`)은 그대로.

- [ ] **Step 5: `getWbsSpec` 본문 교체**

`src/app/actions/wbsSpec.ts` 상단에 `import { loadSpec } from '@/lib/data/wbsItemDetail'` 추가. 가드 이후를 `return loadSpec(sb, itemId)` 로. `WbsSpecDetail`·`WbsPriority` export 는 그대로 둔다(로더가 타입을 여기서 가져간다).

- [ ] **Step 6: `getAgentOrderForItem` 본문 교체**

`src/app/actions/agentWork.ts` 상단에 `import { loadAgentOrder } from '@/lib/data/wbsItemDetail'` 추가. 함수는:

```ts
export async function getAgentOrderForItem(itemId: string): Promise<
  | { ok: true; order: AgentOrderStatus | null; priorOrders: AgentOrderBrief[] }
  | { ok: false; error: string }
> {
  if (!isUuidLike(itemId)) return { ok: false, error: '잘못된 요청입니다.' }
  const sb = await createServerClient()
  const { data: item, error: itemErr } = await sb.from('wbs_items').select('project_id').eq('id', itemId).maybeSingle()
  if (itemErr) return { ok: false, error: `항목 조회 실패: ${itemErr.message}` }
  if (!item) return { ok: false, error: '대상을 찾을 수 없습니다.' }
  const g = await requireProjectMember((item as { project_id: string }).project_id)
  if (!g.ok) return { ok: false, error: g.error }
  return loadAgentOrder(sb, itemId)
}
```

- [ ] **Step 7: 타입·린트·전체 테스트**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: 모두 통과. `agent-work-actions.test.ts` 의 `getAgentOrderForItem` 케이스는 가짜 클라이언트의 `from()` 호출 순서(`wbs_items` → `agent_work_orders` → `agent_work_reports`)가 그대로라 바뀌지 않아야 한다. 깨지면 로더의 호출 순서가 원본과 달라진 것이니 로더를 고친다(테스트를 고치지 않는다).

- [ ] **Step 8: 커밋**

```bash
git add src/app/actions/wbs.ts src/app/actions/attachments.ts src/app/actions/wbsAssign.ts src/app/actions/wbsSpec.ts src/app/actions/agentWork.ts
git commit -m "refactor(wbs): 상세 조회 소형 액션 다섯이 공용 로더를 쓰게 한다

편집 뒤 재조회 경로가 아직 이 액션들을 쓴다. 조회 본문이 통합 액션과 두 벌로
갈라지지 않도록 위임한다. 가드·시그니처·반환값은 그대로.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 컨텍스트 + `RowDetailPanel` 이 묶음을 한 번 읽는다

**Files:**
- Create: `src/components/wbs/WbsItemDetailContext.tsx`
- Modify: `src/components/wbs/RowDetailPanel.tsx:14,62,96-105,697,714-724`
- Modify(모킹 추가): `tests/components/wbs-row-detail-overview.test.tsx`, `tests/components/wbs-dependency-readiness-panel.test.tsx`, `tests/ui/wbs-subact-add.test.tsx`, `tests/ui/wbs-leaf-actual.test.tsx`
- Test: `tests/components/wbs-item-detail-context.test.tsx` (이 Task 에서는 RowDetailPanel 케이스만, Task 5 에서 섹션 케이스 추가)

**Interfaces:**
- Consumes: `getWbsItemDetail`·`WbsItemDetail`(Task 2).
- Produces (Task 5 가 쓴다):
  - `type WbsItemDetailState = { itemId: string; status: 'loading'; detail: null } | { itemId: string; status: 'ready'; detail: WbsItemDetail } | { itemId: string; status: 'error'; detail: null }`
  - `WbsItemDetailProvider` (React Provider, `value: WbsItemDetailState`)
  - `useWbsItemDetail(itemId: string): WbsItemDetailState | null` — 제공자 밖이면 `null`(섹션이 종전대로 스스로 읽는다). 제공자의 `itemId` 가 다르면 `{ itemId, status: 'loading', detail: null }`(부모가 곧 갱신하므로 자가 조회하지 않는다).

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
// tests/components/wbs-item-detail-context.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const getWbsItemDetail = vi.fn(async () => ({
  changeLogs: [], attachments: [],
  assigneeStage: { assigneeMemberId: null, stage: 'ip', devWorkflow: false },
  spec: null, agentOrder: null,
}))
const getChangeLogs = vi.fn(async () => [])
const getWbsAssigneeStage = vi.fn(async () => ({ assigneeMemberId: null, stage: null, devWorkflow: false }))

vi.mock('@/app/actions/wbsDetail', () => ({ getWbsItemDetail: (...a: unknown[]) => getWbsItemDetail(...(a as [])) }))
vi.mock('@/app/actions/wbs', () => ({
  getChangeLogs: (...a: unknown[]) => getChangeLogs(...(a as [])),
  updateWbsFields: vi.fn(), addWbsItem: vi.fn(), deleteWbsItem: vi.fn(), moveWbsItem: vi.fn(), addSubAct: vi.fn(),
  updateDeliverable: vi.fn(),
}))
vi.mock('@/app/actions/wbsAssign', () => ({
  getWbsAssigneeStage: (...a: unknown[]) => getWbsAssigneeStage(...(a as [])),
  setWbsAssignee: vi.fn(), setWbsAssigneeCascade: vi.fn(), setWbsStage: vi.fn(), setWbsDevWorkflow: vi.fn(),
}))
vi.mock('@/app/actions/attachments', () => ({ listAttachments: vi.fn(async () => []), recordAttachment: vi.fn(), removeAttachment: vi.fn() }))
vi.mock('@/app/actions/dependencies', () => ({ addDependency: vi.fn(), removeDependency: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({}) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/app/TeamsProvider', () => ({ useTeamCodes: () => ['PMO', 'ERP'] }))
vi.mock('@/components/wbs/WbsSpecPanel', () => ({ WbsSpecPanel: () => null }))

import { RowDetailPanel } from '@/components/wbs/RowDetailPanel'

const item = {
  id: '33333333-3333-4333-8333-333333333333', name: '테스트 항목', depth: 2, children: [],
  plannedStart: '2026-09-01', plannedEnd: '2026-09-10', deliverable: null,
  actualPct: 0, rolledActualPct: 0, weight: 1, owners: [], isOwnerSplit: false, stage: null,
} as unknown as ComputedItem

describe('RowDetailPanel + WbsItemDetailProvider', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('열릴 때 통합 액션을 한 번만 부르고, 소형 조회 액션은 부르지 않는다', async () => {
    await act(async () => {
      root.render(<RowDetailPanel item={item} projectId="p1" onClose={() => {}} editable />)
    })
    await act(async () => { await Promise.resolve() })
    expect(getWbsItemDetail).toHaveBeenCalledTimes(1)
    expect(getWbsItemDetail).toHaveBeenCalledWith(item.id)
    expect(getChangeLogs).not.toHaveBeenCalled()
    expect(getWbsAssigneeStage).not.toHaveBeenCalled()
  })
})
```

`@/app/actions/dependencies` 의 실제 모듈 경로·export 이름은 `RowDetailPanel.tsx:8-11` 의 import 를 보고 맞춘다(의존성 추가·삭제 액션). 모킹 대상은 "RowDetailPanel 이 import 하는 모든 `@/app/actions/*`" 이다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/wbs-item-detail-context.test.tsx`
Expected: FAIL — `getWbsItemDetail` 0회 호출(아직 패널이 `getChangeLogs` 를 부른다).

- [ ] **Step 3: 컨텍스트 모듈 작성**

```tsx
// src/components/wbs/WbsItemDetailContext.tsx
'use client'
import { createContext, useContext, useMemo } from 'react'
import type { WbsItemDetail } from '@/app/actions/wbsDetail'

/**
 * 상세 패널 조회 묶음 — RowDetailPanel 이 getWbsItemDetail 을 한 번 불러 여기로 내려준다.
 *
 * 각 섹션(담당·단계 / 명세 / 진행 상황 / 첨부)은 제공자가 있으면 마운트 시 스스로 읽지 않는다.
 * 제공자 밖(단독 렌더·스토리·기존 테스트)에서는 null 이 나오므로 종전대로 소형 액션으로 읽는다.
 * 편집 뒤 재조회는 섹션이 종전처럼 소형 액션을 직접 부른다 — 묶음은 "여는 순간"만 책임진다.
 */
export type WbsItemDetailState =
  | { itemId: string; status: 'loading'; detail: null }
  | { itemId: string; status: 'ready'; detail: WbsItemDetail }
  | { itemId: string; status: 'error'; detail: null }

const Ctx = createContext<WbsItemDetailState | null>(null)
export const WbsItemDetailProvider = Ctx.Provider

export function useWbsItemDetail(itemId: string): WbsItemDetailState | null {
  const s = useContext(Ctx)
  // 제공자의 항목이 다르면 부모가 곧 새 묶음을 내려준다 — 그 사이 자가 조회를 시작하면 요청이 두 벌이 된다.
  return useMemo<WbsItemDetailState | null>(() => {
    if (!s) return null
    if (s.itemId === itemId) return s
    return { itemId, status: 'loading', detail: null }
  }, [s, itemId])
}
```

- [ ] **Step 4: `RowDetailPanel` 수정**

(a) import 교체 — `RowDetailPanel.tsx:14` 부근의 `getChangeLogs` import 를 제거하고 추가:

```ts
import { getWbsItemDetail } from '@/app/actions/wbsDetail'
import { WbsItemDetailProvider, type WbsItemDetailState } from './WbsItemDetailContext'
```

`ChangeLogEntry` 타입은 `@/app/actions/wbs` 에서 계속 import 한다(변경 이력 목록 타입).

(b) 상태 교체 — `RowDetailPanel.tsx:62` 의 `const [logs, setLogs] = useState<ChangeLogEntry[] | null>(null)` 를 다음으로:

```ts
const [bundle, setBundle] = useState<WbsItemDetailState>({ itemId: item.id, status: 'loading', detail: null })
// 변경 이력은 묶음에서 꺼낸다 — null 은 로딩, [] 는 비었거나 조회 실패(종전 getChangeLogs 폴백과 동일).
const logs: ChangeLogEntry[] | null =
  bundle.status === 'ready' ? bundle.detail.changeLogs : bundle.status === 'error' ? [] : null
```

(c) 로드 effect 교체 — `RowDetailPanel.tsx:96-105` 의 effect 안에서 `setLogs(null)` 을 `setBundle({ itemId: item.id, status: 'loading', detail: null })` 로, 마지막 `getChangeLogs(item.id).then(...)` 줄을 다음으로:

```ts
    getWbsItemDetail(item.id)
      .then(r => {
        if (!alive) return
        setBundle(r
          ? { itemId: item.id, status: 'ready', detail: r }
          : { itemId: item.id, status: 'error', detail: null })
      })
      .catch(() => { if (alive) setBundle({ itemId: item.id, status: 'error', detail: null }) })
```

의존성 배열 `[item.id, item.name, item.plannedStart, item.plannedEnd, item.deliverable]` 은 그대로 둔다(이름·일정·산출물 편집이 change_logs 를 만들므로 그때 이력을 다시 읽는 종전 동작 유지).

(d) 제공자로 감싸기 — 컴포넌트 `return (` 바로 안쪽의 최상위 JSX 요소를 `<WbsItemDetailProvider value={bundle}>` … `</WbsItemDetailProvider>` 로 감싼다. `bundle` 은 state 객체라 렌더 간 참조가 안정적이다(새 리터럴을 value 로 만들지 않는다).

(e) `AttachmentSection`(`RowDetailPanel.tsx:714-724`) 이 묶음을 쓰도록:

```tsx
function AttachmentSection({ itemId, canAttach }: { itemId: string; canAttach: boolean }) {
  const router = useRouter()
  const { t } = useLocale()
  const bundle = useWbsItemDetail(itemId)
  const [list, setList] = useState<DeliverableAttachment[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 업로드·삭제 뒤 재조회 — 묶음은 여는 순간만 책임지므로 여기는 종전 소형 액션.
  const load = useCallback(() => {
    listAttachments(itemId).then(setList).catch(() => setList([]))
  }, [itemId])
  useEffect(() => {
    setList(null)
    if (bundle) return          // 제공자 아래: 아래 effect 가 묶음에서 채운다
    load()
  }, [load, bundle === null])
  useEffect(() => {
    if (!bundle) return
    if (bundle.status === 'ready') setList(bundle.detail.attachments)
    else if (bundle.status === 'error') setList([])
  }, [bundle])
```

`useWbsItemDetail` import 를 파일 상단 (a) 의 import 줄에 함께 넣는다: `import { WbsItemDetailProvider, useWbsItemDetail, type WbsItemDetailState } from './WbsItemDetailContext'`.

- [ ] **Step 5: 기존 RowDetailPanel 테스트에 모킹 추가**

`tests/components/wbs-row-detail-overview.test.tsx`, `tests/components/wbs-dependency-readiness-panel.test.tsx`, `tests/ui/wbs-subact-add.test.tsx`, `tests/ui/wbs-leaf-actual.test.tsx` 각각의 `vi.mock('@/app/actions/wbs', …)` 옆에 추가한다:

```ts
vi.mock('@/app/actions/wbsDetail', () => ({
  getWbsItemDetail: vi.fn(async () => ({
    changeLogs: [], attachments: [], assigneeStage: null, spec: null, agentOrder: null,
  })),
}))
```

그 테스트들이 `getChangeLogs` 호출 횟수를 단언하고 있다면(예: "열릴 때 이력을 읽는다") 단언 대상을 `getWbsItemDetail` 로 바꾼다. 단언이 없으면 모킹만 추가한다.

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/components/wbs-item-detail-context.test.tsx tests/components/wbs-row-detail-overview.test.tsx tests/components/wbs-dependency-readiness-panel.test.tsx tests/ui/wbs-subact-add.test.tsx tests/ui/wbs-leaf-actual.test.tsx`
Expected: PASS. 새 테스트에서 `getWbsItemDetail` 1회, `getChangeLogs` 0회. (`getWbsAssigneeStage` 0회는 Task 5 전까지는 실패한다 — 그 단언 한 줄은 Task 5 Step 4 까지 `// TODO(Task 5)` 없이 **주석 처리하지 말고**, Task 5 를 바로 이어서 진행한다. Task 4 만 따로 커밋해야 하면 그 단언을 Task 5 의 테스트로 옮긴다.)

- [ ] **Step 7: 커밋**

```bash
git add src/components/wbs/WbsItemDetailContext.tsx src/components/wbs/RowDetailPanel.tsx tests/components/wbs-item-detail-context.test.tsx tests/components/wbs-row-detail-overview.test.tsx tests/components/wbs-dependency-readiness-panel.test.tsx tests/ui/wbs-subact-add.test.tsx tests/ui/wbs-leaf-actual.test.tsx
git commit -m "perf(wbs): 상세 패널이 통합 액션 한 번으로 묶음을 읽어 컨텍스트로 내려준다

변경 이력·첨부는 이 커밋에서 묶음을 쓴다. 담당·명세·진행 상황 섹션은 다음
커밋에서 컨텍스트를 읽는다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 담당·단계 / 명세 / 진행 상황 섹션이 묶음을 쓴다

**Files:**
- Modify: `src/components/wbs/WbsAssigneeStagePanel.tsx:9-11,44-63`
- Modify: `src/components/wbs/WbsSpecPanel.tsx:8-10,44-80,346-382`
- Test: `tests/components/wbs-item-detail-context.test.tsx` (섹션 케이스 추가)

**Interfaces:**
- Consumes: `useWbsItemDetail`(Task 4), `WbsItemDetail.assigneeStage/spec/agentOrder`(Task 2).
- Produces: 없음(컴포넌트 props 불변).

동작 규칙(세 섹션 공통):
1. 제공자 밖(`useWbsItemDetail` 가 `null`)이면 종전대로 마운트 시 소형 액션으로 읽는다.
2. 제공자 아래면 마운트 시 읽지 않는다. 묶음이 `ready` 가 되면 그 값을, `error` 면 `'error'` 를 채운다. `loading` 으로 **되돌아갈 때는 기존 값을 지우지 않는다**(부모가 이름·일정 편집 뒤 묶음을 다시 읽을 때 섹션이 깜빡이지 않게).
3. 편집 뒤 재조회는 종전처럼 소형 액션을 직접 부른다.

- [ ] **Step 1: 섹션 테스트 추가**

`tests/components/wbs-item-detail-context.test.tsx` 에 아래 describe 를 추가한다. 이 파일은 `WbsSpecPanel` 을 null 로 모킹하고 있으므로 명세·진행 상황 케이스는 별도 모킹 없이 실제 모듈을 렌더하는 두 번째 파일에 둔다: `tests/components/wbs-spec-panel-bundle.test.tsx`.

```tsx
// tests/components/wbs-item-detail-context.test.tsx 에 추가
import { WbsAssigneeStagePanel } from '@/components/wbs/WbsAssigneeStagePanel'
import { WbsItemDetailProvider } from '@/components/wbs/WbsItemDetailContext'

describe('WbsAssigneeStagePanel under provider', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('ready 묶음 아래에서는 자가 조회 없이 묶음 값을 그린다', async () => {
    await act(async () => {
      root.render(
        <WbsItemDetailProvider value={{ itemId: item.id, status: 'ready', detail: {
          changeLogs: [], attachments: [], spec: null, agentOrder: null,
          assigneeStage: { assigneeMemberId: null, stage: 'ip', devWorkflow: false },
        } }}>
          <WbsAssigneeStagePanel itemId={item.id} members={[]} editable />
        </WbsItemDetailProvider>,
      )
    })
    expect(getWbsAssigneeStage).not.toHaveBeenCalled()
    const stageSelect = container.querySelector('select') as HTMLSelectElement
    expect(stageSelect.value).toBe('ip')
  })

  it('loading 묶음 아래에서는 자가 조회를 시작하지 않는다', async () => {
    await act(async () => {
      root.render(
        <WbsItemDetailProvider value={{ itemId: item.id, status: 'loading', detail: null }}>
          <WbsAssigneeStagePanel itemId={item.id} members={[]} editable />
        </WbsItemDetailProvider>,
      )
    })
    expect(getWbsAssigneeStage).not.toHaveBeenCalled()
  })

  it('제공자 밖에서는 종전대로 스스로 읽는다', async () => {
    await act(async () => { root.render(<WbsAssigneeStagePanel itemId={item.id} members={[]} editable />) })
    expect(getWbsAssigneeStage).toHaveBeenCalledTimes(1)
  })
})
```

단계 `<select>` 가 첫 번째 select 가 아니면(담당자 콤보박스가 먼저면) `container.querySelectorAll('select')` 에서 옵션에 `'wbs.stageIp'` 텍스트가 있는 것을 고른다.

```tsx
// tests/components/wbs-spec-panel-bundle.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const getWbsSpec = vi.fn(async () => null)
const getAgentOrderForItem = vi.fn(async () => ({ ok: true, order: null, priorOrders: [] }))
vi.mock('@/app/actions/wbsSpec', () => ({
  getWbsSpec: (...a: unknown[]) => getWbsSpec(...(a as [])),
  setAgentDelegation: vi.fn(), updateAgentPrompt: vi.fn(), updateWbsSpec: vi.fn(), updateWbsSpecFields: vi.fn(),
}))
vi.mock('@/app/actions/agentWork', () => ({
  getAgentOrderForItem: (...a: unknown[]) => getAgentOrderForItem(...(a as [])),
  approveAgentCompletion: vi.fn(), rejectAgentCompletion: vi.fn(), requestAgentRework: vi.fn(), unapproveAgentCompletion: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))

import { WbsSpecPanel } from '@/components/wbs/WbsSpecPanel'
import { WbsItemDetailProvider } from '@/components/wbs/WbsItemDetailContext'

const ID = '33333333-3333-4333-8333-333333333333'
const spec = {
  category: 'dev', domain: null, priority: 'high' as const, model: null, tags: [], depends: [],
  prdRef: 'PRD-9', entryPoint: null, acceptance: [], spec: null, externalRef: null, agentPrompt: null,
}
const order = {
  id: 'o1', status: 'reported', claimed_by: 'bot', claimed_at: '2026-09-14T00:00:00Z', updated_at: '2026-09-14T01:00:00Z', reports: [],
}

describe('WbsSpecPanel under provider', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('ready 묶음 아래에서는 명세·주문을 스스로 읽지 않고 묶음 값을 그린다', async () => {
    await act(async () => {
      root.render(
        <WbsItemDetailProvider value={{ itemId: ID, status: 'ready', detail: {
          changeLogs: [], attachments: [], assigneeStage: null, spec, agentOrder: { order, priorOrders: [] },
        } }}>
          <WbsSpecPanel itemId={ID} editable />
        </WbsItemDetailProvider>,
      )
    })
    expect(getWbsSpec).not.toHaveBeenCalled()
    expect(getAgentOrderForItem).not.toHaveBeenCalled()
    expect(container.textContent).toContain('PRD-9')
    expect(container.textContent).toContain('wbs.agentOrderReported')
  })

  it('제공자 밖에서는 종전대로 둘 다 스스로 읽는다', async () => {
    await act(async () => { root.render(<WbsSpecPanel itemId={ID} editable />) })
    expect(getWbsSpec).toHaveBeenCalledTimes(1)
    expect(getAgentOrderForItem).toHaveBeenCalledTimes(1)
  })
})
```

`PRD-9` 가 접힌 본문 안에만 그려진다면(`bodyOpen=false` 기본) 단언을 `container.textContent` 대신 펼침 버튼 클릭 뒤로 옮기거나, 접힘 밖에 항상 그려지는 값(우선순위 배지 `wbs.specPriorityHigh`)으로 바꾼다. 기존 `tests/components/wbs-spec-collapsed-default.test.tsx` 가 무엇이 접힘 밖에 보이는지 알려 준다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/wbs-item-detail-context.test.tsx tests/components/wbs-spec-panel-bundle.test.tsx`
Expected: FAIL — 제공자 아래에서도 `getWbsAssigneeStage`/`getWbsSpec`/`getAgentOrderForItem` 이 1회 호출됨.

- [ ] **Step 3: `WbsAssigneeStagePanel` 수정**

import 추가(`WbsAssigneeStagePanel.tsx:12` 부근): `import { useWbsItemDetail } from './WbsItemDetailContext'`

`WbsAssigneeStagePanel.tsx:57-63` 의 effect 를 다음 둘로 바꾼다:

```ts
  const bundle = useWbsItemDetail(itemId)
  // 항목이 바뀌면 비우고, 제공자 밖에서만 스스로 읽는다.
  useEffect(() => {
    let alive = true
    setLoaded(null)
    setErr(null)
    if (bundle) return () => { alive = false }
    getWbsAssigneeStage(itemId).then(r => { if (alive) setLoaded(r ?? 'error') })
    return () => { alive = false }
    // bundle 은 null 여부만 본다 — 상태 전이는 아래 effect 가 처리한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, bundle === null])
  // 묶음이 도착하면 채운다. loading 으로 되돌아갈 때는 지우지 않는다(부모 재조회 중 깜빡임 방지).
  useEffect(() => {
    if (!bundle) return
    if (bundle.status === 'ready') setLoaded(bundle.detail.assigneeStage ?? 'error')
    else if (bundle.status === 'error') setLoaded('error')
  }, [bundle])
```

- [ ] **Step 4: `WbsSpecPanel` 수정**

import 추가(`WbsSpecPanel.tsx:19` 부근): `import { useWbsItemDetail } from './WbsItemDetailContext'`

`WbsSpecPanel.tsx:71-80` 의 effect 를:

```ts
  const bundle = useWbsItemDetail(itemId)
  const adopt = useCallback((r: WbsSpecDetail | null) => {
    setLoaded(r ?? 'error')
    if (r) { setPrdRefDraft(r.prdRef ?? ''); setEntryPointDraft(r.entryPoint ?? ''); setPromptDraft(r.agentPrompt ?? '') }
  }, [])
  useEffect(() => {
    let alive = true
    setLoaded(null)
    setSpecEditing(false); setFieldsEditing(false); setSpecErr(null); setRefErr(null)
    if (bundle) return () => { alive = false }
    getWbsSpec(itemId).then(r => { if (alive) adopt(r) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, bundle === null])
  useEffect(() => {
    if (!bundle) return
    if (bundle.status === 'ready') adopt(bundle.detail.spec)
    else if (bundle.status === 'error') setLoaded('error')
  }, [bundle, adopt])
```

`WbsAgentOrderStatus`(`WbsSpecPanel.tsx:346-382`) 의 `reload`/effect 를:

```ts
  const bundle = useWbsItemDetail(itemId)
  const reload = useCallback(() => {
    getAgentOrderForItem(itemId).then(r => {
      setOrder(r.ok ? r.order : null)
      setPriorOrders(r.ok ? r.priorOrders : [])
      if (r.ok && r.order?.status === 'reported') setOpen(true)
      if (!r.ok) console.error('[WbsAgentOrderStatus] 조회 실패:', r.error)
    })
  }, [itemId])
  useEffect(() => {
    setOrder(null); setPriorOrders([]); setErr(null); setWarn(null); setRejecting(false); setReworking(false)
    setOpen(false) // 항목이 바뀌면 접힌 상태로 돌아간다
    // 여는 순간(refreshKey 0)은 묶음이 채운다. 위임 체크로 refreshKey 가 오르면 종전대로 다시 읽는다.
    if (!bundle || refreshKey > 0) reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, refreshKey, bundle === null])
  useEffect(() => {
    if (!bundle || refreshKey > 0) return
    if (bundle.status === 'ready') {
      const b = bundle.detail.agentOrder
      setOrder(b?.order ?? null)
      setPriorOrders(b?.priorOrders ?? [])
      if (b?.order?.status === 'reported') setOpen(true)
    } else if (bundle.status === 'error') {
      setOrder(null); setPriorOrders([])
    }
  }, [bundle, refreshKey])
```

- [ ] **Step 5: 통과 확인 + 전체**

Run: `npx vitest run tests/components/wbs-item-detail-context.test.tsx tests/components/wbs-spec-panel-bundle.test.tsx && npx tsc --noEmit && npm run lint && npm run test`
Expected: 모두 PASS. 기존 `wbs-assignee-stage-panel.test.tsx`·`wbs-spec-*.test.tsx`·`wbs-agent-order-actions.test.tsx` 는 제공자 밖 렌더라 종전 경로를 타므로 바뀌지 않아야 한다.

- [ ] **Step 6: 커밋**

```bash
git add src/components/wbs/WbsAssigneeStagePanel.tsx src/components/wbs/WbsSpecPanel.tsx tests/components/wbs-item-detail-context.test.tsx tests/components/wbs-spec-panel-bundle.test.tsx
git commit -m "perf(wbs): 담당·명세·진행 상황 섹션이 여는 순간엔 묶음을 읽고 스스로 조회하지 않는다

제공자 밖(단독 렌더·테스트)에서는 종전대로 소형 액션으로 읽는다. 편집 뒤
재조회도 종전 경로 그대로다 — 묶음은 여는 순간만 책임진다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 스테이징 실측과 반영

**Files:**
- Modify: `docs/superpowers/plans/2026-09-14-wbs-detail-bundle.md` (이 문서의 「결과」 절에 수치 기입)

- [ ] **Step 1: staging 에 머지·push**

```bash
git switch staging && git pull --ff-only origin staging
git merge --no-ff perf/wbs-detail-bundle -m "merge: 상세 패널 조회 묶음(perf/wbs-detail-bundle) → staging"
git push origin staging
```

Vercel 이 dflow-staging.vercel.app 을 배포한다. 배포 완료를 `vercel ls` 또는 대시보드에서 확인한다.

- [ ] **Step 2: 실측(전과 같은 방법)**

브라우저에서 https://dflow-staging.vercel.app/p/5a2e12b2-d3c0-489b-b270-1999e27f80f2/wbs 를 열고(로그인 상태), 개발자 도구 콘솔에서 두 단계로 실행한다. 먼저 계측을 심고 클릭:

```js
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
const btns = [...document.querySelectorAll('button[title*=" · "]')]
performance.clearResourceTimings()
window.__t0 = performance.now()
btns[12].click()
```

3초 뒤에 읽기:

```js
performance.getEntriesByType('resource')
  .filter(e => e.startTime >= window.__t0 - 5 && e.initiatorType === 'fetch')
  .map(e => ({ start: Math.round(e.startTime - window.__t0), dur: Math.round(e.duration), end: Math.round(e.responseEnd - window.__t0) }))
```

Expected: fetch 항목이 **1건**이고 `end` 가 700ms 이내. 다른 행(예: `btns[40]`)으로 한 번 더 반복해 표본 2개를 얻는다.

- [ ] **Step 3: 결과 기입 + 커밋**

이 문서 맨 아래 「결과」 절에 전/후 표를 채우고 커밋한다.

```bash
git add docs/superpowers/plans/2026-09-14-wbs-detail-bundle.md
git commit -m "docs(wbs): 상세 패널 조회 묶음 전후 실측 기록

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin staging
```

- [ ] **Step 4: main 반영**

스테이징 화면에서 상세 패널을 열고 담당자 변경·단계 변경·명세 편집·첨부 업로드·위임 체크가 종전처럼 동작하는지 눈으로 확인한 뒤:

```bash
git switch main && git pull --ff-only origin main
git merge --no-ff staging -m "merge: 상세 패널 조회 묶음 → main"
git push origin main
npm run smoke:prod
npm run mark:good
```

---

## 결과 (Task 6 에서 기입)

| 표본 | 요청 수 | 마지막 응답까지(ms) 전 | 후 |
|---|---|---|---|
| 1 | 5 → ? | 2571 | ? |
| 2 | 5 → ? | 1548 | ? |

---

## Self-Review

- 요구사항 대조: 클릭 지연의 두 원인(직렬 큐 → Task 2·4·5 로 요청 1건, 액션당 가드 반복 → Task 2 로 가드 1회, 첨부 순차 서명 → Task 1 병렬) 모두 Task 가 있다. 범위 밖 넷은 「범위 밖」에 명시.
- 자리표시자: 없음. 각 Step 에 실제 코드·명령·기대값이 있다.
- 타입 일관성: `WbsItemDetailState`(Task 4 정의, Task 5 사용), `AssigneeStage`·`AgentOrderBundle`(Task 1 정의, Task 2 사용), `getWbsItemDetail(itemId): Promise<WbsItemDetail | null>`(Task 2 정의, Task 4 사용) 이름이 일치한다.
- 권한 불변식: 통합 액션이 이력·첨부(로그인) / 담당·명세·주문(멤버) 구분을 유지한다(Task 2 테스트 2번째 케이스).
