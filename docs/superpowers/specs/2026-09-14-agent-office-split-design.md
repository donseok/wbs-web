# 에이전트 오피스 분리 — 조작(허브)과 감시(가상 오피스)를 라우트로 나눈다

작성 2026-09-14. 허브 v1 스펙(`2026-09-14-agent-hub-design.md`)과 좌석표 v1 스펙(`2026-09-14-agent-office-v1-design.md`) 위에 얹는다. 마이그레이션 없음.

## 0. 결정 요약 (사용자 결정 2026-09-14, 1안)

- 프로젝트 허브 `/p/[projectId]/agents` 는 **조작 화면**만 남긴다: 켜기/중지·카운터·감시자, 위임 표, 승인 큐. 좌석 층·상세 패널은 뺀다.
- **프로젝트 가상 오피스** `/p/[projectId]/agents/office` 를 새로 둔다. 이 프로젝트 층 하나를 기존 전역 좌석표 컴포넌트(`SeatmapView`)로 그리고 30초 폴링한다.
- 사이드바는 '에이전트' 하나. 두 페이지 상단에 "위임·승인 | 가상 오피스" 탭(링크)을 둔다.
- 전역 `/agents` 는 **전체 오피스**로 이름을 맞추고 그대로 둔다. 입구는 프로젝트 오피스 탭의 "전체 오피스" 링크.
- 브랜치 `feat/agent-office-split`(origin/staging adb6466b 기반). 머지는 사용자 지시 때 한 번.

## 1. 배경 — 왜 나누는가

허브 v1 은 한 페이지에 조작(위임·승인)과 감시(층·좌석)를 같이 얹었다. 둘은 갱신 방식이 다르다.

- 조작 화면은 변경 뒤 1회 재조회하고 폴링하지 않는다(허브 스펙 §7). 조작 중에 표가 밑에서 바뀌면 안 된다.
- 감시 화면은 폴링해야 의미가 있다(좌석표 스펙: 30초, 숨긴 탭은 쉼). 허브 안의 층은 멈춘 그림이었다.

라우트로 나누면 각자 제 갱신 규칙을 갖고, 오피스는 뒤에 얹을 연출(비트맵 층·캐릭터)을 프로젝트 단위로 키울 자리를 얻는다.

## 2. 범위

### 하는 것

1. 허브에서 층·상세 패널 제거. `AgentHub.floor` 삭제, 조립에서 `assembleSeatmap` 호출 제거.
2. 페이지 `/p/[projectId]/agents/office` 신설. 게이트·로더·화면.
3. 좌석표 로더·액션에 프로젝트 필터 추가(`getSeatmap` 옵션 `projectId`, `refreshSeatmap(scope, projectId?)`).
4. `SeatmapView` 에 `projectId` prop: 재조회에 전달, 빈 상태 문구, "전체 오피스" 링크.
5. 탭 컴포넌트 `AgentTabs` — 두 페이지의 `ProjectPageShell` `pinned` 슬롯에 얹는다(컴팩트 뷰포트에서도 남아야 하는 조작부라 `hero` 가 아니다).
6. 라벨: `nav.agents` ko '전체 오피스' / en 'All offices'. 전역 페이지 제목 "가상 오피스 · 전체". 허브 상태 줄의 "전체 좌석표" 링크는 오피스 탭으로 옮긴다.

### 하지 않는 것

- 좌석표 규칙(상태·구역·의자 인물)·폴링 주기 변경, 전역 `/agents` 의 기능 변경.
- 사이드바 항목 추가. `match` 가 `startsWith(match + '/')` 라 `/agents/office` 에서도 '에이전트'가 활성이다.
- 사용 현황 메뉴 키 변경. `resolveMenuKey('/p/<id>/agents/office')` 는 이미 세그먼트 규칙으로 `agents` 다(테스트만 추가).
- 허브 조회(`fetchAgentHubRows`) 변경. 7건 그대로 — `reports` 는 승인 큐와 반려 상태 판정에 여전히 쓴다.

## 3. 접근·권한

| 대상 | 판정 | 위치 |
|---|---|---|
| `/p/[id]/agents/office` 열람 | 프로젝트 멤버 이상(`isProjectMember`) — 허브와 같다 | 페이지 `getActorForView` 후 아니면 `redirect(/p/<id>/dashboard)` / `projectId` 가 UUID 형식이 아니면 로더 전에 404(슈퍼유저는 멤버 판정을 통과해 DB 에서 500 이 나던 것을 막는다) |
| `refreshSeatmap(scope, projectId)` | `canViewAgents(actor)` 그리고 `projectId` 가 있으면 `isProjectMember(actor, projectId)` | 액션. 둘 중 하나라도 아니면 `{ ok:false, error:'권한이 없습니다.' }` |
| 로더 `getSeatmap(..., { projectId })` | 층 목록 = `seatmapProjectIds(actor)` 와 교집합. 슈퍼유저(null)는 `[projectId]`, 역할 목록에 없으면 `[]`(빈 좌석표) | `src/lib/data/agentSeatmap.ts` — 게이트를 통과했어도 로더가 다시 좁힌다(fail-closed) |

`projectId` 액션 인자는 클라이언트 입력이다. UUID 형식(8-4-4-4-12 hex)이 아니면 `{ ok:false, error:'프로젝트 값이 잘못됐습니다.' }`.

## 4. 데이터

### 4-1. 좌석표 로더 `src/lib/data/agentSeatmap.ts`

```ts
export interface SeatmapOptions { projectId?: string }
export function seatmapFloorIds(actor: Actor, projectId: string | undefined): string[] | null
// projectId 없음 → seatmapProjectIds(actor) 그대로(null = 전체, [] = 없음)
// projectId 있음 → ids === null ? [projectId] : ids.includes(projectId) ? [projectId] : []
export async function getSeatmap(actor: Actor, nowMs = Date.now(), scope: SeatmapScope = 'mine', opts: SeatmapOptions = {}): Promise<Seatmap>
```

`getSeatmap` 은 `seatmapFloorIds` 결과를 `fetchSeatmapRows` 와 `fetchMyMemberIds` 양쪽에 넘긴다. `[]` 면 두 함수가 이미 빈 결과를 돌려주므로 조회가 없다. `Seatmap` 타입은 바꾸지 않는다.

### 4-2. 허브 조립 `src/lib/domain/agentHub.ts`

- `AgentHub.floor` 필드 삭제. `assembleAgentHub` 에서 `seatItems`·`reviews`·`assembleSeatmap`·`floor` 블록 삭제.
- `watchers` 는 `watchersFor(rows.watchers, projectId, nowMs)` 한 줄(지금의 fallback 이 본문이 된다).
- import 에서 `assembleSeatmap`, `Floor`, `ItemRow`, `ReviewRow` 를 지운다(안 쓰면 lint 가 잡는다).

### 4-3. 갱신

- 허브: 변경 없음(변경 뒤 `refreshAgentHub` 1회, 탭 복귀 1회, 폴링 없음).
- 프로젝트 오피스: `SeatmapView` 그대로 — 30초 폴링, 숨긴 탭은 쉼, 실패는 마지막 데이터 유지 + 표시.

## 5. 서버 액션 `src/app/actions/agentSeatmap.ts`

```ts
export async function refreshSeatmap(scope: SeatmapScope = 'mine', projectId?: string)
```

순서: actor 없음/`canViewAgents` 실패 → 권한 없음. `scope` 검증(기존). `projectId` 가 주어졌으면 형식 검증 → `isProjectMember` 검증 → `getSeatmap(actor, Date.now(), scope, { projectId })`. 실패 문구는 기존 '좌석표 재조회에 실패했습니다.' 그대로.

## 6. 화면

### 6-1. 탭 `src/components/agent-hub/AgentTabs.tsx` (client)

```tsx
export function AgentTabs({ projectId }: { projectId: string })
```

- `usePathname()` 으로 활성 판정. `<nav aria-label="에이전트 화면">` 안에 링크 둘:
  - `data-agent-tab="hub"` → `/p/${projectId}/agents`, 라벨 '위임·승인'. 활성 조건 `pathname === base`.
  - `data-agent-tab="office"` → `/p/${projectId}/agents/office`, 라벨 '가상 오피스'. 활성 조건 `pathname === base + '/office'`.
- 활성 링크에 `aria-current="page"`. 스타일은 `chip` 토큰(활성 `bg-brand-weak text-brand`, 비활성 `text-ink-muted hover:text-ink`). 상태 변형 display 유틸을 쓰지 않는다(CLAUDE.md CSS 규칙).

### 6-2. 허브 페이지 `src/app/(app)/p/[projectId]/agents/page.tsx`

- `ProjectPageShell` 에 `pinned={<AgentTabs projectId={projectId} />}` 추가. hero 설명은 "위임과 승인을 한곳에서 합니다."
- `AgentHubView`: `floor` 관련 상태(`selected`, `sel`)·`FloorCard`·`DetailPanel`·`seatCss` 삭제. `<section aria-label="좌석">` 삭제. 상단 갱신 줄·상태 줄·표·큐는 그대로.
- `HubStatusBar`: "전체 좌석표" 링크(`data-hub-seatmap-link`) 삭제. "내 토큰" 링크는 남긴다.

### 6-3. 오피스 페이지 `src/app/(app)/p/[projectId]/agents/office/page.tsx`

```tsx
export const dynamic = 'force-dynamic'
export default async function ProjectOfficePage({ params }: { params: Promise<{ projectId: string }> })
```

- `getActorForView` → 멤버 아니면 `redirect(/p/<id>/dashboard)`.
- 프로젝트 이름은 `admin.from('projects').select('id, name').eq('id', projectId).maybeSingle()` — 없으면 `notFound()`. 조회 실패는 throw.
- `getSeatmap(actor, Date.now(), 'mine', { projectId })`.
- `ProjectPageShell hero={<PageHero eyebrow="AGENTS" title={`${name} 가상 오피스`} description="이 프로젝트 층의 좌석을 30초마다 갱신합니다." />} pinned={<AgentTabs projectId={projectId} />}` 안에 `<SeatmapView initial={seatmap} projectId={projectId} />`.

### 6-4. `SeatmapView` 변경 `src/components/agents/SeatmapView.tsx`

- prop `projectId?: string`. `refresh` 는 `refreshSeatmap(scopeRef.current, projectId)`.
- 헤더 오른쪽(`css.topRight`)에 `projectId` 가 있을 때만 `<Link href="/agents" data-office-all-link>전체 오피스</Link>`.
- 빈 상태 문구(`map.floors.length === 0`)는 `projectId` 가 있으면 범위별 두 문장 — `mine`: "이 프로젝트에서 내게 배정된 에이전트 작업이 없습니다. 다른 사람 것까지 보려면 ‘전체’를 누르세요." / `all`: "이 프로젝트에 위임된 주문이 없습니다. 위임·승인 탭에서 리프 항목에 위임을 켜면 좌석이 생깁니다." 없으면 기존 두 문구. (최종 리뷰 반영: 내 작업 범위에서 남의 주문이 있는데 "없다"고 말하면 좁은 조회를 "없음"으로 위장하는 셈이다.)
- 범위 버튼(내 작업/전체)·범례·폴링은 그대로.

### 6-5. 전역 페이지 `src/app/(app)/agents/page.tsx`

- 제목 "가상 오피스 · 전체". 주석의 입구 설명을 "프로젝트 오피스 탭의 전체 오피스 링크"로 고친다. 그 외 변경 없음.

### 6-6. 라벨

- `common.ts` `nav.agents` '전체 오피스', `common.en.ts` 'All offices'. `usageMenu.ts` 의 `seatmap` fallback '전체 오피스'.
- 설정 페이지·명세 패널 링크(→ 허브)는 그대로.

## 7. 성능 예산

- 허브: 조회 7건 그대로, 조립에서 좌석 계산이 빠진다. 서버 처리 시간은 v1 이하.
- 프로젝트 오피스 첫 렌더: 프로젝트 조회 1 + 좌석표 조회(주문 → 항목·부모·보고·감시자·프로젝트) — 층 하나라 주문 필터가 `in('project_id',[id])`.
- 폴링 1회: 액션 1(`refreshSeatmap`). `router.refresh()` 0회(허브 컴포넌트 소스 검사 테스트 유지).

## 8. 테스트

- `tests/data/agent-seatmap-project.test.ts`(신규): `seatmapFloorIds` — 슈퍼유저+projectId → `[id]`, 멤버(p1)+p1 → `[p1]`, 멤버(p1)+p2 → `[]`, projectId 없음 → 기존 값. `getSeatmap` 이 `[]` 이면 주문 조회를 하지 않는다.
- `tests/actions/agent-seatmap-refresh.test.ts`(신규 또는 기존 확장): 비멤버 projectId → 권한 없음, 형식 오류 → 프로젝트 값 문구, 통과 시 `getSeatmap` 이 `{ projectId }` 옵션으로 불린다.
- `tests/components/agents-seatmap-view.test.tsx`: `projectId` 있으면 재조회 인자 `('mine','p1')`, 전체 오피스 링크 존재, 빈 상태 프로젝트 문구; 없으면 링크 없음.
- `tests/components/agent-tabs.test.tsx`(신규): 경로별 `aria-current`, href 둘.
- `tests/components/agent-hub-view.test.tsx`: 층 섹션 없음(`section[aria-label="좌석"]` null), 픽스처에서 `floor` 제거, `router.refresh` 소스 검사 유지.
- `tests/components/agent-hub-queue.test.tsx`(HubStatusBar): `data-hub-seatmap-link` 없음.
- `tests/domain/agent-hub.test.ts`: `floor` 단언 제거, `watchers` 는 프로젝트 일치·살아 있는 것만.
- `tests/ui/sidebar-project-context.test.tsx`: `/p/p1/agents/office` 에서 '에이전트' 항목 활성.
- `tests/domain/usage-menu.test.ts`: `/p/<id>/agents/office` → `agents`.
- `tests/domain/agents-access.test.ts`: `nav.agents` '전체 오피스' / 'All offices'.

## 9. 롤아웃

브랜치 `feat/agent-office-split`(origin/staging adb6466b). UI 위험 파일은 건드리지 않는다(`Sidebar.tsx` 변경 없음). 스테이징 배포 후 확인 항목: 허브에 층이 없고 탭 둘이 보임; 오피스 탭에서 이 프로젝트 층·폴링·전체 오피스 링크; 멤버(yoo7032)로 두 탭 모두 열림; 전역 `/agents` 제목·라벨.

허브 스펙 `2026-09-14-agent-hub-design.md` §6-5 는 이 문서로 대체한다(그 절 머리에 한 줄 표기).
