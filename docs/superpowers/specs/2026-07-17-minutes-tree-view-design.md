# 회의록 트리 뷰 설계 (2026-07-17)

## 배경·목표

회의록 보관함(`/minutes`)에는 현재 리스트·달력 두 가지 뷰가 있고 둘 다 월 단위 조회다. 같은 회의체(예: 물류공정, 공정조)의 지난 기록을 훑어보려면 월을 하나씩 넘겨야 한다. **구분(팀) → 회의체 → 회의록** 계층의 세 번째 뷰 "트리"를 추가해, 사용자가 별도 학습 없이 회의체 단위로 이력을 탐색할 수 있게 한다.

## 확정 요구사항 (사용자 결정 이력)

| 결정 | 내용 |
|------|------|
| 계층 | 구분(PMO/ERP/MES/가공) → 회의체(제목에서 추출) → 회의록(날짜 내림차순) |
| 기간 | **전 기간** — 트리 뷰에서는 월 네비게이션 비활성(검색 모드와 동일 패턴) |
| 관례 미준수 제목 | 노이즈 토큰을 제거한 **제목 자체를 그룹으로** 사용('기타' 묶음 없음) |
| 구현 접근 | **서버 집계** — 그룹핑은 서버에서 수행, 클라이언트는 완성된 트리 JSON만 수신 |

## 아키텍처

세 계층에 각각 추가하며 DB 스키마·마이그레이션 변경은 없다.

### 1) 도메인 순수 함수 — `src/lib/domain/minutes.ts`

```ts
/** 제목에서 회의체 이름 추출. 노이즈 토큰 제거 후 비면 원제목(trim) 반환. */
export function meetingBodyOf(title: string): string

/** 목록 → 트리 조립. 입력 정렬(minute_date desc, created_at desc)을 보존하는 안정 그룹핑. */
export function buildMinutesTree(minutes: Minute[]): MinutesTreeGroup[]
```

`buildMinutesTree` 계약:

- 입력이 `minute_date desc, created_at desc`로 정렬되어 있음을 전제하며 **자체 재정렬하지 않는다**(리프 순서 = 입력 순서). 계약은 함수 주석에 명시.
- 팀 그룹은 `TEAM_CODES` 순서. DB CHECK 제약(`0021_minutes.sql`: `team_code in ('PMO','ERP','MES','가공')`)상 미지 코드는 없어야 하나, 방어적으로 미지 코드 그룹이 생기면 조용히 버리지 않고 `TEAM_CODES` 뒤에 등장 순으로 붙인다.
- 회의체 노드의 `latestDate` = 그 회의체의 첫 리프(가장 최근)의 `minuteDate`. 회의체 정렬 = `latestDate` desc, 동률이면 첫 등장(입력) 순서.
- 0건 팀은 그룹을 만들지 않는다.

트리 타입(`src/lib/domain/types.ts`):

```ts
export interface MinutesTreeLeaf {
  id: string; minuteDate: string; title: string
  fileCount: number; createdByName: string | null
}
export interface MinutesTreeBody {
  name: string          // 추출된 회의체 이름(그룹 키이자 표시명)
  count: number
  latestDate: string
  leaves: MinutesTreeLeaf[]
}
export interface MinutesTreeGroup {
  teamCode: TeamCode; count: number; bodies: MinutesTreeBody[]
}
```

### 2) 데이터 계층 — `src/lib/data/minutes.ts`

```ts
export const MINUTES_TREE_LIMIT = 1000

/** 전 기간·전 팀 트리. 실패 시 로깅 + null (빈 트리 []와 구분 — 조용한 빈 화면 방지). */
export const getMinutesTree = cache(async ():
  Promise<{ groups: MinutesTreeGroup[]; total: number; truncated: boolean } | null>)
```

- 기존 `LIST_COLS`(본문 제외) 재사용, `minute_date desc, created_at desc` 정렬, **항상 전 팀 조회**(팀 필터는 클라이언트에서 그룹 선택 — 카운트 요약 계산과 탭 전환 비용 문제를 동시에 해결).
- `MINUTES_TREE_LIMIT = 1000`은 PostgREST `max_rows` 하드 캡(로컬 `supabase/config.toml:18`, 호스티드 기본값 모두 1000)과 일치시킨 값이다. 서버 캡이 클라이언트 `.limit`보다 우선하므로 이보다 큰 값은 성립하지 않는다. `.limit(MINUTES_TREE_LIMIT)` 명시는 의도 문서화 목적.
- `truncated` = 반환 행 수 `>= MINUTES_TREE_LIMIT`. `total` = **반환(집계에 사용)된 행 수**이며 실제 전체 건수가 아니다.
- 규모 근거: 현재 월 약 27건 → 연 약 330건. 1000건 도달까지 약 3년이라 v1은 단일 조회로 충분하며, 도달 시 업그레이드 경로는 비범위 참조.
- 조회 실패 시 `console.error('[getMinutesTree] …')` + `null` 반환.

### 3) 서버 액션 — `src/app/actions/minutes.ts`

```ts
/** 트리 뷰 진입/재시도/업로드 후 클라이언트 호출용. */
export async function fetchMinutesTree()
```

기존 액션들과 동일한 `getSession()` 가드를 쓰되, 폴백 값은 다르다: `fetchMinutesRange`/`fetchMinutesSearch`는 미로그인 시 `[]`를 반환하지만(`actions/minutes.ts:310-323`), 트리는 에러 상태를 UI까지 전달하기 위해 **의도적으로 관례를 이탈해 `null`**을 반환한다. 미로그인과 조회 실패를 v1에서는 구분하지 않는다 — 이 페이지는 인증 하에 있어 실사용상 세션 만료 엣지뿐이며, 그 경우도 에러 카드+재시도로 수용한다.

## 회의체 추출 규칙 (`meetingBodyOf`)

**절차 (노이즈 토큰 제거 방식):**

1. 제목을 trim한 뒤 `_`와 공백(연속 포함)을 모두 구분자로 토큰화한다.
2. 각 토큰이 아래 노이즈 패턴 중 하나에 **전체 일치**하면 제거한다.
3. 남은 토큰을 공백 1칸으로 연결한 결과가 회의체 이름(그룹 키이자 표시명). 전부 제거되어 비면 **원제목(trim)**을 반환한다.

**노이즈 토큰 패턴:**

| 분류 | 정규식(토큰 전체 일치) | 예 |
|------|------------------------|----|
| 날짜 6/8자리 | `^\d{6}$`, `^\d{8}$` | 260716, 20260716 |
| 연월(일) | `^\d{4}[.\-/]\d{1,2}([.\-/]\d{1,2})?$` | 2026-07-16, 2026.07 |
| 2자리 연도 | `^\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}$` | 26.07.16 |
| 월일 | `^\d{1,2}[.\-/]\d{1,2}$` | 07-16, 7.16 |
| 회차 | `^\(?제?\d{1,4}차\)?$` | 12차, 제3차, (5차) |
| 요일 괄호 단독 | `^\((월\|화\|수\|목\|금\|토\|일)\)$` | (수) |

날짜형 4종은 꼬리에 요일 괄호가 붙은 변형(`7.16(수)`)도 노이즈로 판정한다(패턴 뒤에 `(\((월|화|수|목|금|토|일)\))?` 허용).

**예시 (전 케이스가 단위 테스트 대상):**

| 제목 | 추출 결과 |
|------|-----------|
| `물류공정_260716_2026-07-16` | 물류공정 |
| `공정조_2026.07.16_2026-07-16` | 공정조 |
| `주간회의 260716` | 주간회의 |
| `주간정례_12차_260716` | 주간정례 |
| `물류공정_7.16(수)` | 물류공정 |
| `260716_주간회의` | 주간회의 |
| `PMO_260716_물류공정회의` | PMO 물류공정회의 |
| `물류공정_킥오프` | 물류공정 킥오프 |
| `7월 주간회의 메모` | 7월 주간회의 메모 (노이즈 없음 → 그대로) |
| `2026-07-16` | 2026-07-16 (전부 노이즈 → 원제목) |

한계(수용): 붙여쓰기·띄어쓰기 차이("물류공정" vs "물류 공정")는 다른 노드가 된다(단, `_`와 공백은 동일 구분자로 취급되어 "물류_공정"과 "물류 공정"은 같은 노드). 그룹명이 제목 기반이라 오분류여도 사용자가 원인을 눈으로 확인 가능하다. 추후 DB 컬럼 승격 시 이 함수 호출부만 컬럼 우선으로 교체하면 된다(비범위 참조).

## UI 상세

### 뷰 토글·설정

- `MinutesView.tsx`의 `ViewKey`를 `'list' | 'calendar' | 'tree'`로 확장. SegmentedTabs 세 번째 탭: lucide `ListTree` 아이콘(`Sidebar.tsx:8`에 import 선례 존재, `SegmentedTabs.tsx:5`의 `icon?: LucideIcon` prop 사용) + `t('min.view.tree')`.
- `UiPrefs.minutesView` 타입(`src/lib/domain/types.ts:162`)에 `'tree'` 추가. `saveUiPrefs`는 화이트리스트 없는 병합 upsert(`preferences.ts:21-33`)라 타입 확장만으로 저장·복원이 동작하며, `page.tsx`의 `prefs.minutesView ?? 'list'`도 그대로 통과한다.
- 토글 시 기존 `changeView` → `queueUiPref({ minutesView: 'tree' })` 그대로.

### 신규 컴포넌트 `src/components/minutes/MinutesTree.tsx`

- 접기/펼치기는 `WbsGanttSheet.tsx:46-55`의 flatten + `:137`의 접힘 Set state 패턴을 참고하되(단, WBS와 달리 서버 영속화 없이 로컬만), 레벨별로 시맨틱을 다르게 둔다 — 시드 없이 기본 상태가 성립하도록:
  - **레벨1 구분**: `collapsedTeams: Set<TeamCode>` — 비어 있으면 전부 펼침(기본).
  - **레벨2 회의체**: `expandedBodies: Set<string>`(키 `${teamCode}/${name}`) — 비어 있으면 전부 접힘(기본).
  - 데이터 재조회 후에도 두 Set은 유지한다(사라진 키는 무해).
- **레벨1 구분 행**: TEAM 색 점(`TEAM[tk].bar`) + 팀 코드 + 건수. 0건 구분은 렌더하지 않음. 미지 팀 코드 그룹(방어 케이스)은 회색 점 폴백.
- **레벨2 회의체 행**: Chevron + 이름 + 건수 + 최근 날짜(`latestDate`).
- **레벨3 리프 행**: 기존 리스트 행 스타일 재사용 — 날짜, 제목, 첨부 수(Paperclip), 작성자명, `/minutes/{id}` Link, `hover:bg-surface-2`.
- 레벨1·2 토글은 `<button>`으로 구현하고 `aria-expanded`를 부여한다(`WbsGanttSheet.tsx:648-649`와 동일 수준; button이라 Tab/Enter 키보드 조작은 자연 충족).
- **전체 펼치기/접기 단일 토글 버튼**: 라벨·동작은 마지막으로 누른 동작 기준의 boolean state로 결정(개별 노드 조작은 버튼 상태에 영향 없음, 초기 라벨 '전체 펼치기').
  - 전체 펼치기: `collapsedTeams = ∅`, `expandedBodies = 모든 회의체 키` — 모든 레벨 펼침.
  - 전체 접기: `collapsedTeams = 모든 팀 키`, `expandedBodies = ∅` — 레벨1까지 전부 접힘(라벨 '전체 접기'와 일치).
- 스타일은 전부 기존 토큰(`.card`, `.btn`, `text-ink-*`, `TEAM` 매핑)과 `ui/` 프리미티브만 사용.

### `MinutesView.tsx` 통합

- **트리 데이터 state**: `treeState: 'idle' | 'loading' | 'error' | { groups, total, truncated }` — 월 목록 `minutes` state와 별개.
- **전용 세대 카운터 `treeReqRef`**: 기존 `reqRef`(월 목록·검색용)와 분리한다. 공유하면 트리 로딩 중 검색 입력·팀 변경이 트리 응답을 폐기해 'loading'에 갇히는 경합이 생긴다. 트리 응답 커밋은 `treeReqRef`만 비교한다.
- **로드 트리거**:
  - (a) `view`가 'tree'가 되는 모든 시점(prefs로 초기 뷰가 'tree'인 마운트 포함)에 `treeState`가 로드 완료가 아니면 조회. 로드 완료 데이터가 있으면 재사용(재조회 없음).
  - (b) 업로드 저장(`onSaved`): 기존 `loadMonth`/`runSearch` 실행은 그대로 유지하고, `treeState`가 idle이 아니면 트리도 병행 재조회(idle이면 그대로 — 다음 진입 시 (a)가 조회).
  - (c) 에러 카드의 재시도 버튼.
  - 검색 입력/해제는 트리 조회에 영향을 주지 않는다(별도 카운터라 검색 중 도착한 트리 응답도 정상 커밋되어, 검색 해제 시 즉시 표시).
- **구분 탭**: 트리 조회는 항상 전 팀이므로 팀 선택 시 **재조회 없이 클라이언트에서 선택 팀 그룹만 표시**(전체면 모든 그룹). 기존 `changeTeam`의 `loadMonth`/`runSearch` 호출은 뷰와 무관하게 그대로 유지해 리스트/달력 복귀 시 월 데이터가 stale하지 않게 한다.
- **월 네비**: `view === 'tree'`일 때 ◀▶ disabled(기존 `isSearch` 패턴)하고, 월 라벨('2026-07') 자리에 **'전체 기간'**(`min.tree.allPeriod`)을 표시한다 — 월 라벨 옆에 전 기간 건수가 놓여 오독되는 것을 방지.
- **상단 카운트 요약**: 트리 뷰에서는 트리 데이터(전 기간, 전 팀 — 항상 전체를 들고 있으므로 팀별 N 계산 가능) 기준. 로딩·에러 중에는 숫자 대신 '-' 표시(이전 월 숫자 잔존 금지). 리스트/달력은 기존대로 월 데이터 기준.
- **검색**: 기존 동작 유지 — 검색어 입력 시 리스트 강제(`isSearch ? 'list' : view`), 트리 내 검색은 비범위.
- **truncated 안내문**: `truncated: true`면 트리 상단에 표시. 문구는 건수 부정확성까지 고지하며(아래 i18n), 숫자는 `MINUTES_TREE_LIMIT` 상수를 렌더 시 삽입한다(문구 하드코딩 금지 — dict 문구에 `{n}` 자리를 두고 치환).

### i18n (`src/lib/i18n/dict/minutes.ts`, ko/en 쌍)

| 키 | ko | en |
|----|----|----|
| `min.view.tree` | 트리 | Tree |
| `min.tree.expandAll` | 전체 펼치기 | Expand all |
| `min.tree.collapseAll` | 전체 접기 | Collapse all |
| `min.tree.allPeriod` | 전체 기간 | All time |
| `min.tree.truncated` | 최근 {n}건 기준으로 표시·집계됩니다 | Showing and counting the most recent {n} only |
| `min.tree.error` | 트리를 불러오지 못했습니다 | Failed to load the tree |
| `min.tree.retry` | 다시 시도 | Retry |

## 에러 처리

- `fetchMinutesTree`가 `null`을 반환하면(조회 실패 또는 세션 만료) **에러 카드 + 재시도 버튼**(`min.tree.error` / `min.tree.retry`)을 표시한다. EmptyState로 위장하지 않는다(조용한 빈 화면 재발 방지 원칙: 표시=로깅).
- 로딩 중에는 스켈레톤(`ui/Skeleton`) 표시.
- 정상 0건일 때만 기존 `EmptyState`(`min.empty.title/desc`) 표시.

## 테스트

`tests/domain/minutesTree.test.ts` (vitest, 기존 `tests/domain/` 관례):

- `meetingBodyOf`: 위 예시 표 10케이스 전부 + 노이즈 변형(요일 괄호 붙은 날짜 `7.16(수)`·`2026-07-16(금)`, 2자리 연도 `26.07.16`, 회차 `제3차`·`(5차)`, `2026/07/16` 슬래시), 공백만 있는 제목, 혼합 구분자(`_`+공백 혼용).
- `buildMinutesTree`: 팀 순서(TEAM_CODES) 및 미지 팀 코드의 후순위 배치, 회의체 최근 활동순 + `latestDate` 동률 시 첫 등장 순, 리프의 입력 순서 보존(자체 재정렬 없음), 건수 집계, 0건 팀 미포함, 동일 이름 병합.
- 수동 검증: `npm run build` / `lint` / `test` + verify 스킬 절차(샌드박스는 브라우저 접속 불가).

## 비범위 (v1 제외)

- 트리 내 검색(검색은 기존처럼 리스트 강제)
- 접힘 상태 영속화(계정 동기화)
- DB에 회의체 컬럼 추가·백필 — 추후 업그레이드 경로: 컬럼 신설 시 `meetingBodyOf` 호출부를 컬럼 우선으로 교체
- 월 필터와 트리의 조합(기간 좁히기)
- 1000건 초과 시의 정확한 전체 건수 표시(`count: 'exact'`)와 `.range()` 페이지네이션 — truncated 안내문이 뜨기 시작하면 착수
- 회의(meetings) 도메인의 시리즈(`meeting_id`)와의 연동 — 회의록 제목 기반 그룹핑과 별개 개념
