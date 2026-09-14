# 에이전트 허브 v1 — 프로젝트 단위 에이전트 화면 설계

작성 2026-09-14. 좌석표 v1(`2026-09-14-agent-office-v1-design.md`) 위에 얹는다. 마이그레이션 없음.

## 0. 결정 요약 (사용자 결정 2026-09-14)

- 흩어진 에이전트 UI 를 **프로젝트 메뉴 "에이전트" 페이지 `/p/[projectId]/agents`** 하나로 모은다. 전역 `/agents` 좌석표는 전 프로젝트 감시용으로 남긴다.
- 위임(agent 태그) 토글은 **담당자 본인 또는 프로젝트 관리자**가 할 수 있다. 일괄 위임·프로젝트 켜기/중지·승인/반려는 관리자.
- 페이지는 **조회 한 번**으로 조립하고, 변경 뒤에는 **행 단위 재조회**만 한다. `router.refresh()` 를 쓰지 않는다.

## 1. 배경 — 왜 이 화면이 필요한가

실측(2026-09-14, 스테이징 MES 공통 개발 220항목):

- "에이전트 위임" 체크가 항목 다이얼로그 → 명세 섹션 펼침 → 편집 버튼 → 체크, 3클릭 뒤에 숨어 있고 프로젝트 관리자만 켤 수 있다(`setAgentDelegation` 이 `requireProjectAdmin`). 조업 아래 리프 20건이면 60클릭.
- "개발 워크플로 대상"(`dev_workflow`)과 "에이전트 위임"(`tags ∋ 'agent'`)이 체크 두 개로 갈라져 있다. 위임을 켜면 워크플로가 자동으로 켜지지만 반대는 아니다. 워크플로만 켜면 주문(`agent_work_orders`)은 생기는데 `dflow-poll` 이 "자동 착수 대상은 agent 태그뿐"이라 아무도 집어가지 않고, 좌석표에도 안 보인다.
- 에이전트 UI 가 6곳에 흩어져 있다: ① 항목 다이얼로그 > 담당·단계의 워크플로 체크 ② 명세 > 편집의 위임 체크·프롬프트 ③ 명세 > 에이전트 진행 상황(승인·반려) ④ 프로젝트 설정의 켜기/중지 토글 ⑤ 내 계정의 PAT ⑥ 전역 좌석표.
- 항목 다이얼로그는 서버 액션 5개 이상이 순차로 나가고(액션마다 세션·프로젝트 판정 포함 DB 왕복 3~4회), 체크 하나마다 `router.refresh()` 로 WBS 페이지 전체(로더 8개, 220항목 계산)를 다시 그린다.

## 2. 범위

**v1 에 넣는다**

1. 페이지 `/p/[projectId]/agents` 와 사이드바 프로젝트 메뉴 항목.
2. 상단 상태 줄: 프로젝트 에이전트 켜짐/중지(관리자 토글), 감시 중 에이전트, 카운터.
3. 위임 표: WBS 트리 순서로 항목을 나열하고 리프마다 위임 체크·주문 상태·에이전트·마지막 신호·프롬프트. 부모 행 체크 = 하위 리프 일괄(관리자).
4. 승인 대기 큐: 완료 보고(`reported`) 주문의 승인·반려.
5. 이 프로젝트 층의 좌석표 임베드(기존 `FloorCard`·`DetailPanel` 재사용).
6. 권한 완화: 단건 위임·프롬프트 편집을 담당자 본인(멤버)에게 연다.
7. 프로젝트 설정의 에이전트 토글을 허브로 옮기고 설정에는 링크만 남긴다.
8. 항목 다이얼로그의 "에이전트 진행 상황"에 허브 링크를 단다.

**v1 에서 뺀다**

- 항목 다이얼로그의 위임 체크·프롬프트 제거(허브가 자리 잡은 뒤 별도).
- PAT 발급 이동(계정 소유라 내 계정에 둔다. 허브에서 "내 토큰" 링크만).
- 전역 `/agents` 의 기능 변경, 알림·메일, 주문 우선순위 편집.
- 항목 다이얼로그의 왕복 구조 개선(별도 과제. 이 스펙은 허브에서 같은 문제를 만들지 않는 데까지만).

## 3. 접근·권한

| 행위 | 자격 | 판정 위치 |
|---|---|---|
| 페이지 열람·메뉴 표시 | 프로젝트 멤버 이상(`isProjectMember`) | 페이지 `getActorForView` + 사이드바 `SidebarProject` (멤버 여부는 이미 프로젝트 목록 자체가 멤버 기준) |
| 단건 위임 토글·프롬프트 편집 | 관리자 **또는** 그 항목의 담당자 본인(멤버) | 서버 액션 `requireDelegationRight(itemId)` (신설, `src/app/actions/wbsSpec.ts`) |
| 일괄 위임/해제 | 관리자 | `requireProjectAdmin` |
| 프로젝트 켜기/중지 | 관리자 | 기존 `setAgentProjectEnabled` |
| 승인·반려·재작업·승인 취소 | 관리자 | 기존 `agentWork.ts` 액션 |

**담당자 본인 판정**: `src/lib/agent/assignee.ts` 의 `myMemberIds(admin, { userId, userEmail, projectId })` 결과에 항목의 `assignee_member_id` 가 들어 있으면 본인이다(`user_id` 링크 또는 이메일 소문자 일치 — claim 제한과 같은 재료). `userEmail` 은 `admin.auth.admin.getUserById` 로 읽고, 실패는 throw(fail-closed).

**멤버가 위임을 켤 때의 프로젝트 등록 문제**: `setAgentDelegation` 은 처음 위임할 때 `ensureAgentProject` 로 프로젝트를 등록·활성하고 `backfillProjectOrders` 로 워크플로 리프 전체에 주문을 만든다. 이건 프로젝트 범위 부작용이라 관리자 행위다. **멤버(비관리자) 경로에서는 `agent_projects` 가 등록·활성 상태가 아니면 위임을 거부한다**: 오류 문구 `'프로젝트 에이전트가 꺼져 있습니다. 관리자가 에이전트 페이지에서 켜야 합니다.'`. 등록·활성이면 태그 갱신 → `dev_workflow` 켜기 → `ensureOrderForWorkflowLeaf` 까지 관리자와 같다. 해제(취소) 경로는 자기 항목이면 그대로 허용한다.

조회 전용(역할 없음)은 메뉴가 안 보이고, URL 직접 접근은 `/p/[projectId]/dashboard` 로 redirect 한다.

## 4. 데이터 — 조회 한 번, 순수 조립

### 4-1. 조회 `src/lib/data/agentHub.ts`

`getAgentHub(projectId: string, viewer: { userId: string; isAdmin: boolean }, nowMs = Date.now()): Promise<AgentHub>` — 서버 전용, `createAdminClient()`.

1차 `Promise.all` 6건 + 2차(살아 있는 주문의 완료 보고) 1건. 어느 하나라도 실패하면 throw(데이터 없음으로 위장하지 않는다):

1. `wbs_items` — `id, parent_id, code, name, sort_order, level, milestone, dev_workflow, tags, assignee_member_id, agent_prompt, actual_pct, stage` (`project_id` 필터)
2. `agent_projects` — `enabled` (`maybeSingle`; 없으면 registered=false)
3. `agent_work_orders` — 좌석표와 같은 컬럼(`ORDER_COLS`), `status in ready,claimed,reported` 전부 + `approved` 는 7일 이내. `created_at desc`, limit 2000
4. `agent_work_reports` — (2차) 3의 살아 있는 주문(ready/claimed/reported) 전부의 `kind='completion'` 보고(`work_order_id, percent, summary, links, agent, review_action, review_note, created_at`). 승인 큐의 본문과 claimed 의 반려 판정(REJECTED)에 함께 쓴다. 살아 있는 주문이 없으면 생략
5. `agent_watchers` — 70분 이내(좌석표 `fetchSeatmapRows` 와 같은 조건)
6. `project_members` — `id, name, email, user_id`
7. `projects` — `id, name`

담당자 본인 판정용 `myMemberIds` 는 6의 결과로 메모리에서 계산한다(추가 왕복 없음). `userEmail` 은 `viewerEmail(admin, userId)` (좌석표 `agentSeatmap.ts` 의 것을 export 해 재사용).

좌석표 층은 같은 행을 `assembleSeatmap({ orders, items, parents: items, reviews, watchers, projects }, nowMs)` 에 넣어 `floors[0]` 을 꺼낸다(scope all, agent 태그 규칙 그대로). 별도 조회를 하지 않는다.

### 4-2. 조립 `src/lib/domain/agentHub.ts` (순수)

```ts
export interface HubItemRow { id: string; parent_id: string | null; code: string; name: string; sort_order: number; level: string; milestone: boolean; dev_workflow: boolean; tags: string[] | null; assignee_member_id: string | null; agent_prompt: string | null; actual_pct: number | null; stage: string | null }
export interface HubMemberRow { id: string; name: string; email: string | null; user_id: string | null }
export interface HubReportRow { work_order_id: string; percent: number; summary: string; links: { label?: string; url: string }[]; agent: string; created_at: string }
export interface AgentHubRows { project: { id: string; name: string } | null; agentProject: { enabled: boolean } | null; items: HubItemRow[]; orders: OrderRow[]; reports: HubReportRow[]; watchers: WatcherRow[]; members: HubMemberRow[] }

export type HubOrderState = 'READY' | 'ACTIVE' | 'STALE' | 'OFFLINE' | 'BLOCKED' | 'WAIT' | 'REJECTED' | 'DONE'
export interface HubRow {
  itemId: string; code: string; name: string; depth: number; parentId: string | null
  isLeaf: boolean; milestone: boolean
  assigneeName: string | null; assigneeMine: boolean
  delegated: boolean; devWorkflow: boolean
  order: { id: string; status: OrderStatus; state: HubOrderState; agent: string | null; lastSignalAt: string | null } | null
  prompt: string | null
  canToggle: boolean   // isLeaf && !milestone && (viewer.isAdmin || assigneeMine)
}
export interface HubQueueEntry { orderId: string; itemId: string | null; code: string; name: string; agent: string; percent: number; summary: string; links: { label?: string; url: string }[]; reportedAt: string }
export interface AgentHub {
  projectId: string; projectName: string
  registered: boolean; enabled: boolean
  counters: { delegated: number; ready: number; working: number; waiting: number }
  watchers: Watcher[]
  rows: HubRow[]            // 트리 전위 순서(부모 → 자식), 형제는 sort_order 오름차순, 같으면 code
  queue: HubQueueEntry[]    // reported 주문, reportedAt 오름차순(오래된 것 먼저)
  floor: Floor | null       // 이 프로젝트 층(좌석표 규칙: agent 태그 주문만)
  fetchedAt: string
  viewer: { isAdmin: boolean; memberIds: string[] }
}
export function assembleAgentHub(rows: AgentHubRows, nowMs: number, viewer: { userId: string; userEmail: string | null; isAdmin: boolean }): AgentHub
```

규칙:

- **트리 순서**: `parent_id` 로 묶고 형제는 `sort_order` 오름차순, 같으면 `code` 사전순. 부모가 없는 항목(고아)은 루트 뒤에 붙인다. 좌석표의 팀 순위 정렬은 쓰지 않는다(허브는 관리 표라 코드 순이 읽기 쉽다).
- **리프**: 자식이 0개. `milestone` 은 리프여도 주문 발행 제외라 `canToggle=false`.
- **행 상태**(`order.state`): 살아 있는 주문(ready/claimed/reported)이 있으면 좌석표 `seatState.ts` 의 판정을 그대로 쓴다. 7일 이내 `approved` 는 `DONE`. 없으면 `order=null`.
- **살아 있는 주문이 둘 이상**이면 `updated_at` 최신 1건(좌석표와 동일).
- **assigneeMine**: `assignee_member_id ∈ myMemberIds` (members 배열에서 `user_id===viewer.userId || email 소문자 일치`).
- **counters**: `delegated` = `tags ∋ 'agent'` 인 리프 수, `ready` = READY, `working` = ACTIVE+STALE+OFFLINE+BLOCKED, `waiting` = WAIT.
- **queue**: `reported` 주문마다 최신 completion 보고 1건. 보고가 없으면(비정상) `summary=''`, `percent=0` 으로 넣고 빼지 않는다.
- `fetchedAt` 는 `new Date(nowMs).toISOString()`.

### 4-3. 갱신

- 클라이언트는 폴링하지 않는다(허브는 조작 화면). 변경 뒤 `refreshAgentHub(projectId)` 1회. 좌석 층의 경과 시간 표시만 1초 틱.
- 문서 탭이 다시 보이면(`visibilitychange`) 1회 재조회.

## 5. 서버 액션 `src/app/actions/agentHub.ts` + `wbsSpec.ts` 변경

```ts
// agentHub.ts
export async function refreshAgentHub(projectId: string): Promise<{ ok: true; hub: AgentHub } | { ok: false; error: string }>
//   requireProjectMember(projectId) → getAgentHub. 실패는 고정 문구 '에이전트 현황 재조회에 실패했습니다.' + console.error 상세.
export async function setAgentDelegationBulk(projectId: string, itemIds: string[], delegated: boolean): Promise<
  { ok: true; applied: number; failed: { itemId: string; error: string }[]; warning?: string } | { ok: false; error: string }>
//   requireProjectAdmin(projectId). itemIds 는 1~200개, 전부 이 프로젝트 소속인지 한 번에 검증(아니면 ok:false).
//   항목마다 applyDelegation(아래) 를 순차 호출, 개별 실패는 failed 에 모으고 계속. 마지막에 revalidatePath(`/p/${projectId}`, 'layout') 1회.
```

`wbsSpec.ts`:

- `setAgentDelegation(itemId, delegated)` 본체를 `applyDelegation(admin, { itemId, projectId, delegated, actor: { userId, isAdmin }, row })` 로 뽑아낸다(태그 갱신 → 프로젝트 보장 → dev_workflow → 주문 보장/취소, 반환 `AgentDelegationResult` 그대로). 기존 액션은 가드만 바꾸고 이 함수를 부른다. 동작·문구는 유지(기존 테스트 `tests/actions/wbs-spec*.test.ts` 가 계속 통과해야 한다).
- 가드 `requireDelegationRight(itemId)`: `resolveProjectId('wbs_items', itemId)` → `requireProjectMember` → 관리자면 통과, 아니면 항목 `assignee_member_id` 가 `myMemberIds` 에 있어야 통과. 반환 `{ ok: true; actor; projectId; isAdmin; row }` 또는 `{ ok: false; error }`.
- 멤버(비관리자) + `delegated=true` + `agent_projects` 미등록/중지 → `{ ok: false, error: '프로젝트 에이전트가 꺼져 있습니다. 관리자가 에이전트 페이지에서 켜야 합니다.' }`. 이 경우 `ensureAgentProject` 를 부르지 않는다.
- `updateAgentPrompt` 도 같은 가드로 바꾼다.

## 6. 화면 `src/components/agent-hub/`

페이지 `src/app/(app)/p/[projectId]/agents/page.tsx` (`dynamic = 'force-dynamic'`):

```
ProjectPageShell hero=<PageHero eyebrow="AGENTS" title="{프로젝트명} 에이전트" description="위임·승인·좌석을 한곳에서">
  <AgentHubView initial={hub} projectId={projectId} />
```

`getActorForView()` 가 null 이거나 `isProjectMember` 가 아니면 `redirect('/p/<id>/dashboard')`.

### 6-1. `AgentHubView` (client root)

- 상태: `hub`, `error`, `filter: 'mine' | 'all'` (기본: 관리자·슈퍼유저 `all`, 멤버 `mine`), `busy: Set<itemId>`.
- `refresh()` = `refreshAgentHub(projectId)`; 실패 시 마지막 데이터 유지 + 상단 "갱신 실패 HH:MM:SS"(좌석표와 같은 표기, `Asia/Seoul`).
- 구성 순서: `HubStatusBar` → `DelegationTable` → `ApprovalQueue` → 좌석 층.

### 6-2. `HubStatusBar`

- 왼쪽: 켜짐/중지 배지 + 토글 버튼(관리자만 렌더. `setAgentProjectEnabled` 재사용, 끝나면 `refresh()`). 미등록이면 "아직 등록 안 됨 — 첫 위임 때 켜집니다" 문구.
- 가운데: 카운터 4개(위임 n · 대기 n · 작업 중 n · 승인 대기 n).
- 오른쪽: 감시 중 에이전트(`FloorCard` 의 `watchLabel` 과 같은 조합), "내 토큰" 링크(`/account`).

### 6-3. `DelegationTable`

- 세그먼트 "내 담당 | 전체"(`aria-pressed`). `mine` 은 `assigneeMine` 리프와 그 조상만 남긴다.
- 표 열: 위임 체크 · 코드 · 이름(깊이만큼 들여쓰기, 부모는 접기 토글) · 담당자 · 상태 · 에이전트 · 마지막 신호 · 프롬프트.
- 리프 행 체크박스: `canToggle` 아니면 `disabled` + `title="담당자 본인 또는 관리자만"`. 클릭 → 낙관적으로 체크 상태 바꾸고 `setAgentDelegation(itemId, next)` → 결과가 `ok:false` 면 되돌리고 행에 오류 문구, `warning` 이면 행 아래 문구. 끝나면 `refresh()`.
- 부모 행 체크박스: 관리자만 렌더. 상태 = 하위 리프(마일스톤 제외)가 전부 위임이면 checked, 일부면 `indeterminate`. 클릭 → 확인 없이 `setAgentDelegationBulk(projectId, leafIds, next)`. 실패 목록은 표 위 알림 줄에 "n건 실패: 코드…".
- 상태 열 라벨: READY '대기(미착수)', ACTIVE '작업 중', STALE '무응답', OFFLINE '끊김', BLOCKED '결정 대기', WAIT '승인 대기', REJECTED '반려·재작업', DONE '승인됨', 주문 없음 '—'. `dev_workflow` 만 켜지고 위임이 없으면 상태 옆에 작은 힌트 "위임 필요".
- 프롬프트 열: 값이 있으면 앞 40자, 연필 버튼(`canToggle` 과 같은 자격) → 행 아래 textarea + 저장/취소 → `updateAgentPrompt`.
- 접기: 부모 행 왼쪽 chevron. 기본 펼침. 접힘 상태는 클라이언트 state 만(저장 안 함).

### 6-4. `ApprovalQueue`

- `queue` 가 비면 "승인 대기 없음" 한 줄.
- 카드: 코드·이름·에이전트·보고 시각·percent·summary·증적 링크. 버튼(관리자만): 승인 → `approveAgentCompletion`, 반려 → 사유 textarea 필수(비면 버튼 비활성) → `rejectAgentCompletion`. 끝나면 `refresh()`.
- 멤버에게는 버튼 대신 "승인은 관리자가 합니다".

### 6-5. 좌석 층

- `hub.floor` 가 null 이면 "위임된 주문이 아직 없습니다" 한 줄.
- 있으면 좌석표 CSS 변수를 받기 위해 `<div className={seatmapCss.root}>` 로 감싸고 `FloorCard` + `DetailPanel`(선택 좌석). `nowMs` 는 1초 틱.

### 6-6. 사이드바·설정·다이얼로그

- `Sidebar.projectMenu`: 근태 아래, 설정 위에 `{ href: `${base}/agents`, labelKey: 'nav.projectAgents', icon: Bot, match: `${base}/agents` }` — 조건 없음(프로젝트 목록에 있으면 멤버).
- 전역 항목 라벨 구분: `nav.agents` 를 ko '전체 좌석표' / en 'All seatmaps' 로 바꾼다. 새 키 `nav.projectAgents` ko '에이전트' / en 'Agents' (`common.ts` / `common.en.ts`).
- `ProjectNavigationContext.isGlobalProjectBridge` 는 손대지 않는다(`/p/…` 경로라 해당 없음).
- 설정 페이지: `AgentProjectToggle` 자리에 링크 카드 "에이전트 켜기/중지·위임·승인은 에이전트 페이지에서" → `/p/<id>/agents`. `AgentProjectToggle` 컴포넌트는 허브 상태 줄이 재사용한다(파일 이동 없음).
- `WbsAgentOrderStatus`(명세 패널): 제목 줄 오른쪽에 `<Link href={`/p/${projectId}/agents`}>에이전트 페이지</Link>` — `projectId` 는 `getAgentOrderForItem` 응답에 `projectId` 를 추가해 받는다.

## 7. 성능 예산

- 페이지 첫 렌더: Vercel 왕복 1 + Supabase 병렬 7. 220항목 기준 서버 처리 p95 800ms 이하(스테이징 실측으로 §9 에 기록).
- 토글 1회: 액션 1 + `refresh` 1. `router.refresh()` 호출 0회(테스트로 고정: `agent-hub` 컴포넌트 소스에 `router.refresh` 문자열이 없어야 한다).

## 8. 테스트

- `tests/domain/agent-hub.test.ts`: 트리 순서(sort_order·code), 리프/마일스톤 `canToggle`, `assigneeMine`(user_id·email 대소문자), 상태 매핑(ready/claimed 신호 5분·30분/reported/approved 7일), counters, queue(보고 없음 포함), floor 가 agent 태그 주문만 담는지.
- `tests/data/agent-hub.test.ts`: 7건 `Promise.all` 컬럼·필터 단정, 실패 throw, 추가 왕복 없음(`from` 호출 수 7).
- `tests/actions/agent-hub-actions.test.ts`: `requireDelegationRight` — 관리자 통과, 담당자 멤버 통과, 비담당 멤버 거부, 담당자 멤버 + 프로젝트 미등록 → 지정 문구, `setAgentDelegationBulk` 비관리자 거부·타 프로젝트 항목 거부·부분 실패 집계.
- `tests/actions/wbs-spec*.test.ts`(기존): 그대로 통과.
- `tests/components/agent-hub-table.test.tsx`: 체크 클릭 → 액션 호출·낙관적 갱신·실패 되돌림, 부모 체크 indeterminate·일괄 호출 id 목록, 멤버는 부모 체크 없음·비담당 행 disabled, 필터 mine.
- `tests/components/agent-hub-queue.test.tsx`: 반려 사유 비면 버튼 비활성, 승인 호출, 멤버는 버튼 없음.
- `tests/components/agent-hub-view.test.tsx`: refresh 실패 시 데이터 유지 + 문구, `router.refresh` 미사용(소스 문자열 검사).
- `tests/ui/sidebar-project-context.test.tsx`: `/p/p1/agents` 링크 존재, 라벨 키.
- `tests/domain/agents-access.test.ts`: `nav.projectAgents` ko/en 존재.

## 9. 롤아웃

브랜치 `feat/agent-hub`(origin/staging 0813b3a5 기반). UI 위험 파일(`src/components/app/Sidebar.tsx`) 포함이라 브랜치 push → staging 머지 → dflow-staging.vercel.app 에서 멤버(yoo7032)·슈퍼유저 양쪽 확인 → main. 마이그레이션 없음.

확인 항목: 멤버 계정에서 메뉴 표시·자기 담당 리프 토글 가능·남의 리프 disabled·부모 체크 없음; 슈퍼유저에서 부모 체크 일괄 20건; 승인 큐 반려 사유 필수; 층 좌석 표시; 설정 페이지 링크.
