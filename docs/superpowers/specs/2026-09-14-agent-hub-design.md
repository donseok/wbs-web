# 에이전트 허브 v1 — 프로젝트 단위 에이전트 화면 설계

작성 2026-09-14. 좌석표 v1(`2026-09-14-agent-office-v1-design.md`) 위에 얹는다. 마이그레이션 없음.

## 0. 결정 요약 (사용자 결정 2026-09-14)

- 흩어진 에이전트 UI 를 **프로젝트 메뉴 "에이전트" 페이지 `/p/[projectId]/agents`** 하나로 모은다. 전역 `/agents` 좌석표는 전 프로젝트 감시용으로 남기되 **사이드바 항목은 없애고** 허브 상태 줄의 "전체 좌석표" 링크로만 들어간다(사용자 결정 2026-09-14 — 프로젝트 메뉴 옆에 두면 같은 종류로 읽힌다).
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

1. `wbs_items` — `id, parent_id, code, name, sort_order, milestone, dev_workflow, tags, assignee_member_id, agent_prompt, actual_pct, stage` (`project_id` 필터)
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
export interface HubItemRow { id: string; parent_id: string | null; code: string; name: string; sort_order: number; milestone: boolean; dev_workflow: boolean; tags: string[] | null; assignee_member_id: string | null; agent_prompt: string | null; actual_pct: number | null; stage: string | null }
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

- 클라이언트는 폴링하지 않는다(허브는 조작 화면). 좌석 층의 경과 시간 표시만 1초 틱.
- 위임 체크는 재조회하지 않는다 — 1.5초 모아 `applyHubDelegations` 1건으로 보내고 **응답에 실린 허브로 교체**한다(§10, 2026-09-14 체크 지연 개선).
- 그 밖의 변경(프롬프트 저장·승인/반려·켜기/중지) 뒤 `refreshAgentHub(projectId)` 1회.
- 문서 탭이 다시 보이면(`visibilitychange`) 1회 재조회.

## 5. 서버 액션 `src/app/actions/agentHub.ts` + `wbsSpec.ts` 변경

```ts
// agentHub.ts
export async function refreshAgentHub(projectId: string): Promise<{ ok: true; hub: AgentHub } | { ok: false; error: string }>
//   requireProjectMember(projectId) → getAgentHub. 실패는 고정 문구 '에이전트 현황 재조회에 실패했습니다.' + console.error 상세.
export async function applyHubDelegations(projectId: string, changes: { itemId: string; delegated: boolean }[]): Promise<
  { ok: true; hub: AgentHub | null; hubError?: string; failed: { itemId: string; error: string }[]; warnings: { itemId: string; warning: string }[] }
  | { ok: false; error: string }>
//   (2026-09-14 §10) requireProjectMember(projectId) 1회 → isAdmin 판정. changes 는 1~200개, 같은 항목은 마지막 값만.
//   전부 이 프로젝트 소속인지 한 번에 검증(아니면 ok:false). 멤버(비관리자)는 로스터 판정(myMemberIds)을 묶음당 1회 하고
//   담당자 본인이 아닌 항목은 그 항목만 failed(ERR_NOT_ASSIGNEE). 항목마다 applyDelegation(아래) 순차 호출, 개별 실패·경고는 항목별로 모은다.
//   끝에 getAgentHub 를 한 번 더 읽어 응답에 싣는다 — 재조회만 실패하면 hub:null + hubError(변경은 저장됐다는 사실을 숨기지 않는다).
//   revalidatePath 를 부르지 않는다(테스트로 고정: 소스에 `revalidatePath(` 가 없어야 한다). 종전 setAgentDelegationBulk 는 이 액션으로 대체됐다.
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
- 표 열: 위임 체크 · 코드 · 이름(깊이만큼 들여쓰기, 부모는 접기 토글) · 담당자 · **단계** · 상태 · 에이전트 · 마지막 신호 · **조정** · 프롬프트(단계·조정은 §11, 2026-09-14).
- 리프 행 체크박스: `canToggle` 아니면 `disabled` + `title="담당자 본인 또는 관리자만"`. 클릭 → 표시만 즉시 바꾸고 **잠그지 않는다**. 변경은 `usePendingDelegations` 훅이 모았다가(서버값으로 되돌린 체크는 대기에서 뺀다) 마지막 체크 뒤 1.5초에 `applyHubDelegations(projectId, changes)` 1건으로 보낸다. 표 머리에 "N건 · n초 뒤 저장 · 지금 저장" 칩(`PendingSaveChip` 재사용), 저장 중엔 "저장 중…". 응답의 `failed` 는 그 행만 서버값으로 되돌리고 행에 오류 문구, `warnings` 는 행 아래 문구, `hub` 는 `onHub` 로 화면 교체. `ok:false`(묶음 전체 거부)·throw 는 보낸 행마다 그 문구.
- 부모 행 체크박스: 관리자만 렌더. 상태 = 하위 리프(마일스톤 제외)가 전부 위임이면 checked, 일부면 `indeterminate`. 클릭 → 확인 없이 하위 리프 전부를 같은 대기 맵에 넣는다(이미 같은 값인 리프는 보내지 않는다). 실패가 2건 이상이면 표 위 알림 줄에 "n건 실패: 코드…".
- 상태 열 라벨: READY '대기(미착수)', ACTIVE '작업 중', STALE '무응답', OFFLINE '끊김', BLOCKED '결정 대기', WAIT '승인 대기', REJECTED '반려·재작업', DONE '승인됨', 주문 없음 '—'. `dev_workflow` 만 켜지고 위임이 없으면 상태 옆에 작은 힌트 "위임 필요".
- 프롬프트 열: 값이 있으면 앞 40자, 연필 버튼(`canToggle` 과 같은 자격) → 행 아래 textarea + 저장/취소 → `updateAgentPrompt`.
- 접기: 부모 행 왼쪽 chevron. 기본 펼침. 접힘 상태는 클라이언트 state 만(저장 안 함).

### 6-4. `ApprovalQueue`

- `queue` 가 비면 "승인 대기 없음" 한 줄.
- 카드: 코드·이름·에이전트·보고 시각·percent·summary·증적 링크. 버튼(관리자만): 승인 → `runHubProcessOp(projectId, {kind:'approve'})`, 반려 → 사유 textarea 필수(비면 버튼 비활성) → `{kind:'reject', note}`. 응답의 허브로 교체(`onHub`), 재조회 요청 없음(§11). `warning` 은 카드 안 경고 문구.
- 멤버에게는 버튼 대신 "승인은 관리자가 합니다".

### 6-5. 좌석 층

> 2026-09-14 대체: 좌석 층은 허브에서 빠지고 `/p/[projectId]/agents/office` 가 그린다 — `2026-09-14-agent-office-split-design.md`.

- `hub.floor` 가 null 이면 "위임된 주문이 아직 없습니다" 한 줄.
- 있으면 좌석표 CSS 변수를 받기 위해 `<div className={seatmapCss.root}>` 로 감싸고 `FloorCard` + `DetailPanel`(선택 좌석). `nowMs` 는 1초 틱.

### 6-6. 사이드바·설정·다이얼로그

- `Sidebar.projectMenu`: 근태 아래, 설정 위에 `{ href: `${base}/agents`, labelKey: 'nav.projectAgents', icon: Bot, match: `${base}/agents` }` — 조건 없음(프로젝트 목록에 있으면 멤버).
- 전역 항목 라벨 구분: `nav.agents` 를 ko '전체 좌석표' / en 'All seatmaps' 로 바꾼다. 새 키 `nav.projectAgents` ko '에이전트' / en 'Agents' (`common.ts` / `common.en.ts`).
- 전역 좌석표 항목은 사이드바에서 뺀다(`Sidebar` 의 `showAgents` prop·`/agents` 항목 삭제, `layout.tsx` 도 같이). 입구는 `HubStatusBar` 의 `<Link href="/agents" data-hub-seatmap-link>전체 좌석표</Link>` 한 곳. `nav.agents` 라벨은 사용 현황 메뉴 키(`seatmap`)가 계속 쓴다.
- `ProjectNavigationContext.isGlobalProjectBridge` 는 손대지 않는다(`/p/…` 경로라 해당 없음).
- 설정 페이지: `AgentProjectToggle` 자리에 링크 카드 "에이전트 켜기/중지·위임·승인은 에이전트 페이지에서" → `/p/<id>/agents`. `AgentProjectToggle` 컴포넌트는 허브 상태 줄이 재사용한다(파일 이동 없음).
- `WbsAgentOrderStatus`(명세 패널): 제목 줄 오른쪽에 `<Link href={`/p/${projectId}/agents`}>에이전트 페이지</Link>` — `projectId` 는 `getAgentOrderForItem` 응답에 `projectId` 를 추가해 받는다.

## 7. 성능 예산

- 페이지 첫 렌더: Vercel 왕복 1 + Supabase 병렬 7. 220항목 기준 서버 처리 p95 800ms 이하(스테이징 실측으로 §9 에 기록).
- 체크 N개(1.5초 창 안): 액션 1(응답에 허브 포함) + 재조회 0 + 잠금 0. `router.refresh()` 호출 0회(테스트로 고정: `agent-hub` 컴포넌트 소스에 `router.refresh` 문자열이 없어야 한다), `revalidatePath` 0회(§5).

## 8. 테스트

- `tests/domain/agent-hub.test.ts`: 트리 순서(sort_order·code), 리프/마일스톤 `canToggle`, `assigneeMine`(user_id·email 대소문자), 상태 매핑(ready/claimed 신호 5분·30분/reported/approved 7일), counters, queue(보고 없음 포함), floor 가 agent 태그 주문만 담는지.
- `tests/data/agent-hub.test.ts`: 7건 `Promise.all` 컬럼·필터 단정, 실패 throw, 추가 왕복 없음(`from` 호출 수 7).
- `tests/actions/agent-hub-actions.test.ts`: `applyHubDelegations` — 관리자 순서대로 적용·실패/경고 항목별 집계·허브 반환, 멤버 로스터 판정 1회·남의 항목만 failed, 판정 실패 fail-closed, 타 프로젝트 항목 거부, 같은 항목 중복은 마지막 값, 재조회 실패 → hub:null+hubError, 입력 검증, 소스에 `revalidatePath(` 없음. (`requireDelegationRight` 는 `tests/actions/wbs-spec-delegation-right.test.ts`.)
- `tests/actions/wbs-spec*.test.ts`(기존): 그대로 통과.
- `tests/components/agent-hub-table.test.tsx`: 체크 → 즉시 표시·잠기지 않음·대기 칩·1.5초 뒤 묶음 1건·`onHub`, 켰다 끄면 저장 없음, 지금 저장, 항목 실패 되돌림·경고, 묶음 거부·throw, hub:null → 알림+재조회, 부모 체크 indeterminate·같은 값 제외 묶음, 2건 이상 실패 알림 줄, 연속 체크 한 묶음, 멤버는 부모 체크 없음·비담당 행 disabled, 필터 mine.
- `tests/components/use-pending-delegations.test.tsx`: 대기·묶음·flush·저장 중 되돌림 보존·서버값 동기화로 대기 제거·throw 시 복귀·언마운트 분리 저장.
- `tests/components/agent-hub-queue.test.tsx`: 반려 사유 비면 버튼 비활성, 승인·반려 → `runHubProcessOp` + `onHub`, 실패·warning 문구, hub:null → onChanged, 멤버는 버튼 없음.
- `tests/actions/agent-hub-actions.test.ts`(§11): `runHubProcessOp` — approve/reject/unapprove/rework 는 각 액션으로, stage 는 setWbsStage, release 는 CAS·흔적 제거·알림, claimed 아님/CAS 0행 거부, 타 프로젝트 거부, 내부 실패·warning 전달, 재조회 실패 hub:null, 관리자 아님·입력 검증.
- `tests/components/agent-hub-table.test.tsx`(§11): 멤버는 단계 글자·버튼 없음, 관리자 상태별 버튼 집합, 승인/회수/승인 취소 → op, 반려·재작업 사유 줄, 실패·warning·hub:null, 단계 select 현재값·전송·실패 복귀·미지정.
- `tests/components/agent-hub-view.test.tsx`: refresh 실패 시 데이터 유지 + 문구, `router.refresh` 미사용(소스 문자열 검사).
- `tests/ui/sidebar-project-context.test.tsx`: `/p/p1/agents` 링크 존재, 라벨 키, 전역 `/agents` 링크 부재.
- `tests/components/agent-hub-queue.test.tsx`(HubStatusBar): `data-hub-seatmap-link` → `/agents`.
- `tests/domain/agents-access.test.ts`: `nav.projectAgents` ko/en 존재.

## 9. 롤아웃

브랜치 `feat/agent-hub`(origin/staging 0813b3a5 기반). UI 위험 파일(`src/components/app/Sidebar.tsx`) 포함이라 브랜치 push → staging 머지 → dflow-staging.vercel.app 에서 멤버(yoo7032)·슈퍼유저 양쪽 확인 → main. 마이그레이션 없음.

확인 항목: 멤버 계정에서 메뉴 표시·자기 담당 리프 토글 가능·남의 리프 disabled·부모 체크 없음; 슈퍼유저에서 부모 체크 일괄 20건; 승인 큐 반려 사유 필수; 층 좌석 표시; 설정 페이지 링크; 사이드바에 '에이전트' 하나만 보이고 전체 좌석표는 허브 상태 줄 링크로 열림.

## 10. 체크 지연 개선 (2026-09-14, 사용자 결정 "debounce + 낙관 캐시")

**증상.** 위임 체크 하나에 체크박스가 0.8~1.0초 잠겼다(스테이징 실측, `MES 공통 개발`).

| 동작 | 요청 | 걸린 시간 |
|---|---|---|
| 체크 켜기 | 2건 직렬: 쓰기 0.86초(18KB) → 재조회 0.37초 | 1.04초 잠김 |
| 체크 끄기 | 2건 직렬: 쓰기 0.63초 → 재조회 0.28초 | 0.79초 잠김 |
| 새로고침 버튼 | 1건 | 0.92초 |

**원인.** (1) 체크 = `setAgentDelegation` + `refreshAgentHub` 직렬(Next 앱 라우터 액션 큐). (2) 쓰기 액션의 `revalidatePath(..., 'layout')` 이
허브 페이지 재렌더(18KB·서버 0.5초)를 응답에 실었는데 `AgentHubView` 는 `useState(initial)` 이라 쓰지 않았다. (3) 액션마다 가드가 반복됐고
가드의 `getUser()` 가 GoTrue 왕복(0.1초 안팎)을 강제했다. (4) 저장 중 행을 `disabled` 로 잠갔다.

**결정.** debounce 는 쓰고, 캐시는 셋으로 나눠 판단했다.

- 클라이언트 낙관 상태(사실상 캐시): **쓴다.** 체크 즉시 표시, 잠금 없음, 응답의 허브로 확정.
- 서버 데이터 캐시(허브 조회 결과를 요청 사이에 보관): **쓰지 않는다.** 러너의 claim·보고·heartbeat 로 늘 바뀌어 무효화 비용이 이득을 넘고 "화면이 안 바뀐다"는 새 불만이 생긴다.
- 권한 캐시(가드 결과 보관): **쓰지 않는다.** 멤버에서 빠진 사람이 TTL 동안 남는다(fail-closed 위반). 대신 `getActor` 의 세션 확인을 `getUser()` → `getClaims()` 로 바꿔 왕복만 없앤다(미들웨어와 같은 근거, 비대칭 JWT + auth-js 전역 JWKS 캐시).

**구현.** `applyHubDelegations`(§5) + `usePendingDelegations`(§6-3, 1.5초) + `getActor` getClaims(`src/lib/authz/index.ts`).
체크 10개를 해도 요청은 1건이고, 체감 대기는 0초, 서버 확정은 마지막 체크 뒤 약 2초 안이다.

**반영 후 실측(스테이징 7e46a71c, 같은 항목).**

| 동작 | 체크 직후 | 요청 | 서버 확정까지 |
|---|---|---|---|
| 체크 켜기 | 즉시 반영·잠김 없음·칩 "1건 · 2초 뒤 저장" | 1건(1.5초 뒤 시작, 1.16초, 13KB) | 2.7초 |
| 체크 끄기 | 같음 | 1건(0.53~0.95초) | 2.0~2.5초 |
| 켰다 끄기(1.5초 안) | 칩 사라짐 | 0건 | 해당 없음 |

남은 비용은 요청 1건의 서버 처리(applyDelegation 의 순차 DB 왕복 + 허브 재조회)다. 더 줄이려면 applyDelegation 을 Postgres 함수 1회로 묶는 길이 있다(마이그레이션 필요, 미착수).

**같은 낭비가 남은 곳(범위 밖).** WBS 상세 패널의 위임 체크(`WbsSpecPanel`)는 flush 뒤 액션의 `revalidatePath` 재렌더와 `router.refresh()` 가 WBS 페이지를 두 번 그린다.
`getSession`(`src/lib/auth.ts`)은 아직 `getUser()` 다(레이아웃·페이지 경로).

## 11. 개발 프로세스 조정 (2026-09-14, 사용자 요구 "승인, 승인취소, 완료취소 등 개발 프로세스를 허브에서 조정")

**결정.** 완료 취소 = **재작업 요청**(승인된 xx 작업을 에이전트에게 되돌린다, 사유 필수). 단계 직접 조정도 허브에 둔다.

**표 행의 조정 열(관리자, 리프, 마일스톤 제외).** 주문 상태별 버튼. 문구는 WBS 상세 패널과 같다(같은 행위에 다른 이름을 주지 않는다).

| 주문 상태 | 버튼 | 액션 | 결과 |
|---|---|---|---|
| 승인 대기(reported) | 승인 | `approveAgentCompletion` | approved, 실적 100, 단계 xx |
| | 반려(사유) | `rejectAgentCompletion` | claimed 복귀, 보고에 reject 기록 — 에이전트가 사유를 읽고 재작업 |
| 승인됨(approved) | 승인 취소 | `unapproveAgentCompletion` | reported 복귀, 실적·단계(xx→im) 되감기 |
| | 재작업 요청(사유) = 완료 취소 | `requestAgentRework` | claimed 복귀 + reject 기록, 실적·단계 되감기 |
| 작업 중·무응답·끊김·결정 대기(claimed) | 회수 | 새 `releaseOrderByAdmin` | ready 복귀(CAS), 점유·heartbeat 흔적 제거, `work.released` 알림. 러너는 다음 heartbeat·report 에서 409 |
| 대기(ready)·없음 | (없음) | 위임 체크가 발행·취소 | |

**단계 열.** 관리자·리프에는 select(미지정/분석/기능 계획/구현 계획/구현/완료), 그 밖에는 글자. 고르면 즉시 `{kind:'stage'}` 1건.
규칙은 `setWbsStage` 그대로: 하위가 있으면 거부, **진행 중 주문(claimed/reported)이 있으면 구현(im)·완료(xx) 직행 거부**("승인 버튼으로") —
완료·검수는 승인으로만 간다는 2026-08-25 결정을 허브에서도 유지한다. 실패하면 select 는 서버값으로 돌아가고 행 아래에 문구.

**액션 `runHubProcessOp(projectId, op)`.** 관리자 가드 1회 → 대상(주문·항목)이 이 프로젝트 것인지(fail-closed) → 기존 액션 →
`getAgentHub` 를 한 응답에. `revalidatePath` 없음(§10 원칙). 재조회만 실패하면 `hub:null + hubError`(처리는 됐다). 내부 액션의
`warning` 은 그대로 올려 행·카드에 보인다. 승인 큐 카드도 같은 액션을 쓴다.

**범위 밖.** 자동 회수(24h 무응답)는 여전히 없다 — 사람이 회수한다(작업 루프 스펙 §운영). 취소된 주문의 재발행은 위임 체크로.
