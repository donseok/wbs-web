# 대시보드 지휘 상황판 설계

- 작성일: 2026-07-09
- 대상: `/p/[projectId]/dashboard` 의 **공지사항 줄 아래 전 영역**
- 유지: `PageHero` + `ExecSummary` 카드(게이지 · 신호등 3 · 공지 링크)

## 1. 배경

현 대시보드 하단은 「단계별 진척」+「지연 작업」 두 카드와 접이식 3그룹(분석 / 일정·리스크 / 팀·산출물)으로 되어 있다. 사용자(경영진·PMO)가 지적한 문제는 셋이다.

1. 숫자는 많은데 "무엇을 해야 하나"가 없다.
2. 시간 감각이 없다 — 전체 여정의 어디쯤인지, 앞으로 무엇이 언제 오는지 안 보인다.
3. 경영진이 볼 항목이 아닌 내부 지표(가중치 분포, 상태 분포, 데이터가 0건인 근태)가 자리를 차지한다.

## 2. 목표

공지 아래를 **스크롤 없는 3열 상황판**으로 재구성한다. 세 칸이 서로 다른 질문에 답한다.

| 칸 | 질문 | 성격 |
|---|---|---|
| 여정 (Journey) | 계획대로 가고 있나? | 진단 |
| 조치 (Action) | 지금 무엇을 해야 하나? | 처방 |
| 병목 (Bottleneck) | 어디가 막혔나? | 원인 |

그 아래에 PMO용 상세를 접이식 2그룹으로 둔다. 기본은 접힘 — 첫 화면은 상황판만 보인다.

### 비목표 (YAGNI)

- 실적 추세선. `change_logs` 0건, `progress_snapshots` 테이블 없음(0007 생성 → 0009 삭제). 스냅샷 테이블·크론 도입은 이 스펙의 범위가 **아니다**.
- WBS 딥링크(`?focus=`). §15 참조 — 별도 작업으로 분리.
- DB 마이그레이션. 이 스펙은 스키마를 건드리지 않는다.

## 3. 검증된 데이터 사실 (2026-07-09, 프로덕션)

설계의 모든 판단은 아래 실측값에 근거한다. 추정 없음.

| 사실 | 값 |
|---|---|
| 프로젝트 창 | 2026-07-01 ~ 12-31 (184 캘린더일). 오늘 = D+9 |
| `wbs_items` | 157행 (phase 5 / task 18 / activity 134) |
| **리프** | **107건** |
| 리프당 담당팀 수 | **전부 정확히 1개** (`{1: 107}`). 103건 `primary`, 4건 support-only, 0건 무담당 |
| 팀별 리프 | PMO 18 · ERP 59 · MES 60 · 가공 60 (owner rows 197 중 90은 비-리프에 붙음) |
| 전체 진척 | **실적 1% / 계획 6%** (편차 −5%p) |
| 리프 상태 | 시작전 91 · **지연 13** · 완료 2 · 진행중 1 |
| 마감임박(7일) | 7건, 그중 6건이 지연과 중복 → **고유 조치 대상 14건** |
| 루트 5개 phase 날짜 | 전부 non-null |
| `plannedStart` null 리프 | 0건 |
| 업무일 0인 리프 (주말/공휴일 단일일) | **0건** |
| 계획 곡선 종점 (`overallPlannedAt(endDate)`) | **정확히 100.0** |
| 마일스톤 리프 | 5건 (07-07, 07-10, 09-17, 11-19, 12-31) |
| 활성 공지 | 2건 (둘 다 07-09/07-10 만료 → ExecSummary 높이가 곧 바뀜) |
| `change_logs` / `attendance_records` | 0행 / 0행 |
| 단계별 가중치 | P1 4.5% · P2 28.5% · **P3 48.3%** · P4 9.1% · P5 9.6% |

마지막 줄이 이 설계의 핵심이다. **전체 가중치의 48%가 3단계(8/17~10/30)에 몰려 있다.** 게이지는 이 사실을 보여줄 수 없다. 계획 곡선은 보여준다.

## 4. 화면 구조

```
┌─ PageHero ──────────────────────────────────────────────┐  (유지)
├─ ExecSummary: 게이지 · 신호등 3 · 공지 ────────────────────┤  (유지, §10 한 건 수정)
├─ Row 1 ─────────────────────────────────────────────────┤
│ ┌──────────────┬──────────┬──────────────┐              │
│ │  여정        │  조치     │  병목         │  ← 스크롤 0  │
│ │  S-커브      │  14건     │  5×4 표       │              │
│ │  단계 띠 5   │  내부스크롤│               │              │
│ │  마일스톤 5  │  전체보기 │               │              │
│ └──────────────┴──────────┴──────────────┘              │
├─ Row 2 ─────────────────────────────────────────────────┤
│ ▶ 팀 · 산출물        (id: teamDeliv, 기본 접힘)           │
│ ▶ 주간 리듬          (id: weekly,    기본 접힘)           │
└─────────────────────────────────────────────────────────┘
```

삭제되는 것: 「단계별 진척」 카드(→ 여정의 단계 띠로 흡수), 「지연 작업」 카드(→ 조치로 흡수), 상태 분포, 가중치 분포, 금주 근태.

## 5. 여정 (Journey)

전부 손으로 쓴 SVG. RSC. 클라이언트 경계 없음.

### 5.1 구성 요소

1. **계획 누적 곡선** — 프로젝트 창 전체(7/1~12/31)에 걸친 `overallPlannedAt(D)`.
2. **가중치 음영** — 3단계 창(8/17~10/30)을 옅게 칠하고 `3단계 = 전체 가중치 48%` 라벨. 가장 무거운 루트 phase 하나에만.
3. **오늘 선** — 세로 점선. `stroke-delayed` (§8.4).
4. **편차 스텁** — 실적 점에서 계획 곡선까지 굵은 세로선 + `−5%p`. 최소 14px 보장.
5. **단계 띠 5개** — 계획 기간 = 기하, 채움 = 해당 phase의 `plannedPct`(롤업값). 아직 시작 안 한 phase는 빗금.
6. **마일스톤 다이아몬드** — `milestoneLeaves()` 전체(완료 포함, 완료는 다르게 렌더).
7. **예측 점선** — 조건부. §5.3.

### 5.2 곡선 계산 — 실패 지점 두 곳

**(a) 루트 날짜로 샘플링하면 안 된다.**
`rollup.ts:41-43`은 비-리프의 `plannedPct`를 자식들의 `siblingWeight` 가중평균으로 **덮어쓴다**. `overallProgress()`는 루트의 *롤업된* `plannedPct`를 읽는다(`rollup.ts:20`). 실측: P1의 자체 날짜 기준 `plannedPct` = 88%, 롤업값 = 83.3%.

따라서 `overallPlannedAt(D)`는 **날짜 D에서 전체 트리를 재귀 롤업**해야 한다. 그러지 않으면 곡선이 오늘 지점에서 6.56%를 지나는데 바로 위 게이지는 6%를 찍는다.

```ts
// rollup.ts — computeNode가 이 함수를 호출하도록 리팩터. 구현은 하나만 존재한다.
export function plannedRollupAt(node: TreeNode, D: string, idx: BizDayIndex): number
export function overallPlannedAt(roots: TreeNode[], D: string, idx: BizDayIndex): number
```
밴드 기하는 루트의 `plannedStart`/`plannedEnd`를 쓰되, null이면 자손 min/max로 폴백한다 (실측 non-null이지만 `rollup.test.ts:15,24` 픽스처는 null이다).

**(b) 곡선 종점이 100이 아닐 수 있다.**
`businessDaysBetween`은 구간 전체가 비업무일이면 0을 반환하고(`dates.ts:15-22`), `plannedPct`는 `total === 0`에서 0을 조기 반환한다(`progress.ts:10`). 주말·공휴일에 놓인 단일일 리프는 **영원히 0%** 이고, 이는 `edgecases.test.ts:15`가 고정한 동작이다. 그런 리프가 있으면 곡선 종점이 100 미만이 된다.

실측: 그런 리프 **0건**, 종점 **정확히 100.0**. 그러므로 정규화하지 않는다. 대신 **불변식 테스트**로 못 박는다 — 미래에 누가 토요일 마일스톤을 넣으면 차트가 조용히 67%에서 멈추는 대신 테스트가 깨진다.

### 5.3 예측선 — `label`이 아니라 `projectedEnd`로 게이팅

`scheduleModel()`(`dashboard.ts`)의 `label`은 4값이고 `projectedEnd`는 `'onTrack'`에서만 non-null이다.

- **오늘**: `elapsed = 9 < earlyFloor = max(14, round(184×0.15)) = 28` → `label = 'early'`, `projectedEnd = null`. **예측선을 그릴 수 없다.**
- **2026-07-28 이후**: 가드가 풀린다. 그런데 `spi = actual/planned ≈ 0.05` → `projectedDuration`이 `totalDays × 3` 클램프에 걸려 **`projectedEnd = 2028-01-03`**. `label`은 여전히 `'onTrack'`이다. `'onTrack'`은 "정상"이 아니라 "early도 done도 아님"일 뿐이다.

따라서:

```
if (label === 'none')                      → 카드 전체를 EmptyState('프로젝트 기간 미설정')
if (label === 'early')                     → 예측선 없음.
                                             · earlyFloor 지점(7/28)에 옅은 눈금 + '예측 산정 시작'
                                             · 우하단 캡션 '예측 미산정 · D+9 / 28'
if (label === 'done')                      → (x(endDate), 100)에 완료 마커
if (projectedEnd && projectedEnd <= endDate) → (오늘, 실적) → (projectedEnd, 100) 점선
if (projectedEnd && projectedEnd >  endDate) → x축을 [start, end]에 고정한 채 점선이 오른쪽
                                             가장자리를 뚫고 나가게 그리고, 꺾쇠 + '+{slipDays}일'
```

x축은 **절대 재스케일하지 않는다.** `spi`는 누가 실적%를 편집할 때마다 움직인다. 축이 매번 늘어나면 단계 띠와 오늘 선이 춤춘다.

`earlyFloor`는 현재 `ScheduleModel`에 없다. `dashboard.ts`의 매직넘버 `14` / `0.15`가 카드 쪽에 복제되지 않도록 **`ScheduleModel.earlyFloor`를 추가**한다.

### 5.4 마일스톤

`isMilestoneLeaf`와 `MILESTONE_KEYWORDS`는 `dashboard.ts` 모듈 private이고, `detectMilestones()`는 **하나만** 반환한다. 여정이 판정 로직을 재구현하면 ExecSummary의 「다음 마일스톤」 타일과 갈라진다.

```ts
// dashboard.ts — 새 export. detectMilestones가 이걸 소비하도록 리팩터. 동작 변화 0.
export function milestoneLeaves(items: ComputedItem[], today: string): ComputedItem[]
```
`detectMilestones`와 달리 완료된 마일스톤도 포함한다(타임라인은 지나온 것도 보여야 한다). 완료는 채운 다이아몬드, 미완료는 빈 다이아몬드.

### 5.5 성능

`businessDaysBetween`은 하루당 `Date` 할당 + `toISOString()`을 하는 O(days) 루프이고, `plannedPct`가 이를 **두 번** 호출한다. 40샘플 × 157노드를 순진하게 돌리면 **107ms**(모든 노드가 전 구간을 덮는 최악 1.18s). Vercel 서버리스 CPU에선 2~3배. 매 대시보드 요청마다, 캐시 없이.

```ts
// dates.ts — 프로젝트 창을 1회 스캔해 누적 업무일 prefix-sum을 만든다.
export interface BizDayIndex { between(a: string, b: string): number }
export function makeBizDayIndex(start: string, end: string, holidays: Set<string>): BizDayIndex
```
창 밖 날짜는 기존 `businessDaysBetween`으로 폴백. `businessDaysBetween`의 시그니처·동작은 건드리지 않는다 (`dates.test.ts`, `edgecases.test.ts`가 고정).

샘플 지점: **월요일 전부 ∪ 단계 경계 전부 ∪ {시작일, 오늘, 종료일}** — 실측 36점. 곡선이 꺾이는 곳은 단계 경계뿐이므로 이걸로 충분하다.

## 6. 조치 (Action)

### 6.1 중복 제거는 단일 출처에서

`delayedLeaves`(status === 'delayed')와 `dueSoonLeaves`(status !== 'done' && 7일 내 마감)는 **겹친다**. `dueSoonLeaves`가 `delayed`를 제외하지 않기 때문이다(`dashboard.ts:95`). 실측 13 ∪ 7, 중복 6 → 고유 **14**.

앱 안에 이미 네 벌의 구현이 있다: `dashboard.ts:91`, `dashboard.ts:95`, `DashboardView.tsx:194-196` 인라인, 그리고 `notifications.ts:42`(유일하게 제대로 중복 제거하여 헤더 벨에 14를 표시).

```ts
// dashboard.ts — 단일 출처. delayed가 이긴다.
export type ActionKind = 'delayed' | 'dueSoon'
export interface ActionRow {
  item: ComputedItem
  kind: ActionKind
  overdueDays: number      // plannedEnd < today 일 때만 > 0. plannedEnd null → 0
  gapPp: number            // max(0, plannedPct - rolledActualPct)
  dday: number | null      // plannedEnd null → null
  weightShare: number      // 전체 프로젝트에서 이 리프가 차지하는 가중치 (0~1)
  isMilestone: boolean
}
export function attentionLeaves(leaves: ComputedItem[], today: string): ComputedItem[]
export function buildActionRows(roots: ComputedItem[], today: string): ActionRow[]  // 정렬 완료
```

`RiskModel`에 `attention: number` 필드를 추가하고 `riskModel()`이 `attentionLeaves(...).length`를 채운다. `risk.signal` 임계값은 `delayed`만 읽으므로(`dashboard.ts:118`) **신호등은 변하지 않는다.**

### 6.2 우선순위 — 전순서 comparator

```
1. kind          delayed(0) < dueSoon(1)
2. overdueDays   내림차순
3. gapPp         내림차순
4. weightShare   내림차순
5. sortOrder     오름차순      ← 결정적 타이브레이크
```
`Array.prototype.sort`의 불안정성에 기대지 않는다. `compare(a,b) === -compare(b,a)`, `compare(a,a) === 0`을 테스트로 강제한다.

`weightShare`(리프가 전체 100% 중 차지하는 몫)는 기존 헬퍼가 없다. `siblingWeight`를 `rollup.ts`에서 export하고 재귀로 계산한다:

```ts
// rollup.ts
export function leafWeightShares(roots: ComputedItem[]): Map<string, number>
// share(leaf) = Π (siblingWeight(node) / Σ siblingWeight(형제들)) — 루트부터 리프까지
```

오늘의 상위 5행 (실측):

| 순위 | 배지 | 작업 | 팀 | 격차 |
|---|---|---|---|---|
| 1–4 | 2일 초과 | TFT R&R 확정 / 협의체 구성 / 마스터플랜 일정 확정 / 관리 프로세스 정의 | PMO | 100%p |
| 5 | 지연 (D-8) | CBO 개발 프로그램 사용 현황 분석 | ERP | 58%p |

### 6.3 행수 캡 — 없음

현재 코드는 배지에 `delayed.length`(15)를 찍고 `slice(0, 8)`로 8개만 그린다(`DashboardView.tsx:449` vs `:455`). 같은 패턴이 `:262/:267`, `:294/:302`, `:343`에도 있다. **카드가 자기가 방금 말한 숫자를 스스로 부정하고, 숨은 행에 도달할 방법이 없다.**

고정 캡을 두지 않는다. 대신:

- 리스트는 `flex-1 min-h-0 overflow-y-auto overscroll-contain` — **높이가 허용하는 만큼 렌더**
- 푸터는 항상 `전체 {N}건 · WBS에서 전체 보기 →` (`<Link href={/p/{id}/wbs}>`)
- 0건이면 `MiniEmpty('조치가 필요한 작업이 없습니다')`. 단, 이 상태는 이 프로젝트에서 **흔하지 않다** — 빈 상태를 기본값처럼 설계하지 않는다.

`overscroll-contain`은 필수다. 부모 스크롤 영역이 이미 `overscroll-y-contain`(`ProjectPageShell.tsx:12`)이라 없으면 내부 리스트가 페이지를 끌고 간다.

### 6.4 행 클릭

`<Link href={`/p/${projectId}/wbs`}>`. **딥링크 없음** — §15.

## 7. 병목 (Bottleneck)

### 7.1 리프 → (단계, 팀)

단계 = 루트 조상. `collectLeaves([phase])`로 phase별 리프를 뽑으면 O(n)에 공짜다(`collectLeaves`는 `ComputedItem[]`을 받는다). `collectLeaves`의 시그니처는 6개 호출부가 있으므로 바꾸지 않는다.

팀은 리프당 **정확히 하나**로 해석한다:

```ts
// bottleneck.ts — tree.ts:9 (subActTeamRank)의 기존 선례를 그대로 따른다
const teamOf = (l: ComputedItem): TeamCode | null =>
  l.owners.find(o => o.kind === 'primary')?.team ?? l.owners[0]?.team ?? null
```

이유: `item_owners`의 PK가 `(wbs_item_id, team_id)`라 **다중 담당은 스키마상 합법**이다. 오늘 `{1: 107}`인 건 데이터일 뿐 불변식이 아니다. `owners.some(...)`으로 팀마다 세면(=`teamSummary`, `DashboardView.tsx:162`의 방식) 행/열 합이 리프 수를 넘겨 표의 여백 숫자가 거짓말이 된다. `teamOf`면 **Σ셀 + 미배정 = 리프 수**가 항상 성립한다.

`primary`가 없는 리프(실측 4건, support-only)는 `owners[0]`으로 떨어진다. 무담당 리프는 어느 열에도 속하지 않고 표 아래에 `미배정 리프 N건` 각주로 표시한다 — **절대 조용히 버리지 않는다**.

팀 목록은 `REPORT_TEAMS`(`report/model.ts:46`)를 import한다. 같은 리터럴이 `DashboardView.tsx:35`, `tree.ts:6`에도 있다 — 네 번째 사본을 만들지 않는다.

### 7.2 셀 상태 — 색 하나가 아니라 상태

오늘 20칸 중 15칸이 "아직 시작 안 함"이다. 단순 진척률 히트맵이면 12칸 회색 + 8칸 새빨강이 되어 양쪽 다 정보가 없다. **셀은 상태를 인코딩한다.**

우선순위 (위에서부터 먼저 매치):

| # | 상태 | 조건 (셀의 리프 집합 `L`) | 표시 | 색조 | 질감/테두리 | 글리프 |
|---|---|---|---|---|---|---|
| 1 | 미배정 | `L.length === 0` | `–` | 없음 (`bg-surface-2/40`) | `border-dashed` | 없음 |
| 2 | 완료 | 모두 `done` | `n건 · 100%` | `done` | solid | `CheckCircle2` |
| 3 | 지연 | 하나라도 `delayed` | `지연 k` / `n건 · N%` | `delayed` | solid | `AlertOctagon` |
| 4 | 예정 | `today < min(plannedStart)` | `D-N` / `예정 n건` | `pending` | **대각 빗금** | `○` |
| 5 | 진행중 | 그 외 | `n건 · N%` | `progress` | solid | `dot` |

**지연이 예정보다 앞선다.** 아직 시작 안 한 *단계*에도 창이 열린 리프가 있을 수 있다.

`plannedStart`가 전부 null인 셀(실측 0건)은 D-day 없이 `예정`으로 렌더한다. `min()`에 null을 넣어 `NaN`을 만들지 않는다.

`N%` = `L`의 `rolledActualPct` **비가중 평균**. 생성된 sub-activity는 전부 `weight: null`이라 `siblingWeight`가 1을 반환하므로 가중은 무의미하고(`validate.ts:79`, `rollup.ts:24-26`), `teamSummary`(`DashboardView.tsx:163`)·`ReportTeam.pct`(`report/model.ts:43`)와도 일치한다.

**셀은 편차(%p)를 찍지 않는다.** 비가중 평균의 편차는 ExecSummary·여정의 가중 롤업 숫자와 갈라진다. 셀이 보여줄 것은 **건수 · D-day · 팀 평균 진척**뿐이고, 이 셋은 (단계 × 팀) 부분집합의 값이라 화면 어디와도 충돌하지 않는다.

`0%`는 **일이 있는 칸에만** 찍힌다. 담당 없는 칸은 `–`. 이 둘을 섞으면 "PMO가 3단계에서 0% 진행 중"이라는 거짓말이 된다 — 실제로는 담당이 없다.

빈 행·열도 **절대 지우지 않는다.** 프로젝트마다 표 모양이 달라지면 비교가 불가능해진다.

### 7.2.1 오늘의 20칸 (실측)

```
        PMO         ERP         MES         가공
1.준비  지연4/6      –           –           –
2.As-Is 지연1/3     지연3/10    지연3/9     지연2/9
3.To-Be  –          예정17 D-39 예정17 D-39 예정17 D-39
4.로드맵 예정4 D-116 예정3 D-95  예정3 D-95  예정3 D-95
5.RFP   예정3 D-144 예정1 D-130 예정1 D-130 예정1 D-130
```
지연 5 · 예정 11 · 미배정 4 · **죽은 칸 0**. 예정 칸은 "앞으로 들어올 물량"이라는 실제 정보를 담는다.

### 7.3 접근성 · 인쇄 · 마크업

`<table>`이다. `<caption class="sr-only">`, `<th scope="col">`(팀), `<th scope="row">`(단계), 셀마다 `aria-label="To-Be 설계 · ERP · 예정 · 17건 · D-39"`. `<div>` 그리드는 스크린리더에서 행/열 연관을 파괴한다. **여기엔 SVG를 쓰지 않는다** — 20칸 행렬의 올바른 원시 자료는 HTML/CSS다. 손으로 쓴 SVG는 여정 곡선에만.

색은 단독으로 의미를 지지 않는다. 팔레트가 청록-초록 / 파랑 / 진홍이라 `done` vs `delayed`는 적록색약의 전형적 실패다. 그래서:
- 셀마다 글리프 (기존 `signalStyle.ts`의 lucide 아이콘 재사용)
- **예정은 대각 빗금** — 미래 칸을 "살아있는데 0%"인 칸과 **무채색으로, 질감으로** 구분하는 가장 중요한 장치
- 미배정은 `border-dashed` — 색조·질감과 직교하는 세 번째 채널

`globals.css:336-348`의 인쇄 경로가 `background-color`를 떨군다. 색조는 사라지지만 글리프·빗금·점선 테두리는 살아남는다.

코드베이스에 `repeating-linear-gradient`/`<pattern>` 선례가 **없다**(grep 0건). `@layer components`에 `.hatch`를 추가한다 — `var(--color-line-strong)` 기반(다크 오버라이드 있음). CSS `fill`은 HTML 요소에서 SVG `<pattern>`을 참조할 수 없으므로, 여정의 SVG `<pattern>`과 표의 CSS 빗금은 별개 구현이다.

## 8. 레이아웃

### 8.1 컨테이너 쿼리 — 미디어 쿼리로는 불가능

사이드바는 `lg` 이상에서 펼침 248px / 접힘 78px이고, 그 상태는 클라이언트 `localStorage`에서 온다(`Sidebar.tsx:52-54,86`). **미디어 쿼리는 이 170px 스윙을 볼 수 없다.**

| 뷰포트 | 사이드바 펼침 | 사이드바 접힘 |
|---|---|---|
| 1280 | 976px | 1146px |
| 1440 | 1136px | 1306px |
| 1920 | 1616px | 1624px (max-w 클램프) |

`xl:`(1280)로 3열을 켜면 펼침 상태(976px)에서 깨진다. `2xl:`(1536)로 하면 1280~1535 노트북 전부가 접힘이어도 2열이 된다. **컨테이너 쿼리라야 두 상태가 모두 맞다.** `@container`는 이미 `HeaderChrome.tsx:97`에서 쓰고 있다.

```tsx
<div className="@container space-y-5">
  {/* ExecSummary */}
  <div className="grid gap-5
                  @min-[48rem]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]
                  @min-[68rem]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(17rem,0.78fr)]
                  @min-[48rem]:h-[clamp(19rem,calc(100dvh-31rem),30rem)]">
    <JourneyCard    className="@min-[48rem]:col-span-2 @min-[68rem]:col-span-1" />
    <ActionCard />
    <BottleneckCard />
  </div>
  <DetailAccordion … />
</div>
```

`68rem = 1088px` 임계는 의도적이다 — 1280-펼침(976)은 제외하고 1280-접힘(1146)은 포함한다. 명명 컨테이너 사이즈 `@6xl`(1152px)은 1280-접힘을 잘못 제외한다. 임의값 `@min-[68rem]`을 쓴다.

`minmax(17rem, ...)`는 병목의 하한이다: 단계 라벨 48px + 팀 셀 4×44 + 갭 3×6 = 242px, + `sm:p-6` 48px = 290px ≈ 17rem.

**48rem~68rem 구간에서는 여정이 두 칸을 다 먹는다**(`col-span-2`). 시간축 카드가 폭을 가장 필요로 하므로 이건 열화가 아니다. DOM 순서 여정 → 조치 → 병목이 이미 읽기 순서(진단 → 처방 → 원인)와 같아 **재정렬이 필요 없다**.

### 8.2 세로 예산 — "스크롤 0"의 정확한 의미

스크롤 영역 높이 = `dvh − 183`
(header 68 + `main` pt 24 + PageHero 55 + shell gap 20 + `main` pb 16)

`PageHero`는 **이미 영구 접힘 상태**다(`PageHero.tsx:3-6`: 토글 제거됨, `PrefsSync.tsx:20-21`: `heroCollapsed` 상수 true). 여기서 벌어올 세로 공간은 없다. `UiPrefs.heroCollapsed`는 **죽은 필드**다.

ExecSummary = 235px, 공지가 렌더되면 **+58px = 293px**. 오늘 활성 공지 2건 → 293px. (둘 다 07-09/07-10 만료 → 곧 235px가 된다. **두 높이 모두 정상 경로**다.)

| | 공지 없음 | 공지 있음 |
|---|---|---|
| 900dvh — Row 1 | 462px | **404px** |
| 800dvh — Row 1 | 362px | 304px |

`SectionCard` 크롬 111px을 빼면 카드 내용은 900dvh+공지에서 **293px**. 여정 SVG ≈248px, 병목 표 ≈198px는 들어간다. 조치는 행당 ~44px라 6행+푸터 292px — **턱걸이**.

그래서 §6.3처럼 **고정 행수를 약속하지 않는다.** 높이는 `clamp(19rem, calc(100dvh - 31rem), 30rem)`으로 스스로 적응하고, 조치 리스트만 내부 스크롤한다.

**스펙에 명시할 약속**: "스크롤 0"은 **Row 1 한정, ≥900dvh, 3열 구간**에서만 보장된다. Row 2(접이식, 접힌 상태 132px)는 폴드 아래에 있다. 2열 폴백에서는 여정이 전폭이 되어 Row 1이 더 높아지므로 스크롤이 생긴다 — 정상이다.

### 8.3 `SectionCard` — 옵트인 확장

현재 `SectionCard`는 내부 스크롤 자식을 구조적으로 지탱하지 못한다:

```tsx
// SectionCard.tsx:16,27 — flex 없음, min-h-0 없음
<section className={`card p-5 sm:p-6 ${className}`}>
  …
  <div className="mt-5">{children}</div>
</section>
```
`mt-5` div가 `height: auto`라 자식의 `overflow-y-auto`는 클램프 대상이 없다. 리스트가 늘어나 섹션을 넘치고 그리드 행 높이를 결정해 버린다.

호출부가 19곳이므로 기본 클래스를 바꾸지 않는다. **옵트인 prop을 추가한다.**

```tsx
export function SectionCard({ …, fill = false, bodyClassName = '' }) {
  <section className={`card p-5 sm:p-6 ${fill ? 'flex h-full min-h-0 flex-col' : ''} ${className}`}>
    <div className="flex shrink-0 items-start justify-between gap-3">…</div>
    <div className={`mt-5 ${fill ? 'min-h-0 flex-1' : ''} ${bodyClassName}`}>{children}</div>
```
Row 1의 세 카드만 `fill`을 켠다. 조치는 추가로 `bodyClassName="flex min-h-0 flex-col"`.

### 8.4 다크 모드 토큰 — 두 개의 함정

Tailwind v4 `@theme`가 모든 `--color-*`에 대해 `stroke-*` / `fill-*` 유틸리티를 생성하고, `.dark`가 같은 커스텀 프로퍼티를 재선언한다(`globals.css:105-154`). 따라서 `className="stroke-line"`은 **자동으로 테마 전환된다.** `dark:` 배리언트가 필요 없다. 선례: `ProgressGauge.tsx:32,35,38`.

**함정 1** — `--color-today`(`#cb4b5f`, `globals.css:80`)에는 **`.dark` 오버라이드가 없다.** 다크 캔버스(`#0f1217`)에 라이트용 진홍이 찍힌다. 오늘 선은 `stroke-delayed`를 쓴다(`#cb4b5f` → `#ff738a`). 부수적으로 `.dark`에 `--color-today: #ff738a`도 추가한다 (간트가 쓴다).

**함정 2** — `--color-team-가공` 은 **존재하지 않는다.** `TeamCode`는 `'PMO'|'ERP'|'MES'|'가공'`인데 토큰은 `team-dt`이고 `TEAM['가공'].bar = 'bg-team-dt'`로 매핑된다(`shared.tsx:5`, `0014_rename_dt_to_gagong.sql`의 잔재). 게다가 `--color-team-*` 기본 색조는 다크 오버라이드가 없다(`-weak`만 있다).

⇒ **병목 히트맵은 팀을 색으로 인코딩하지 않는다.** 팀은 열 축(라벨 텍스트)이고, 셀 색은 상태가 결정한다. 조치 카드의 팀 칩은 기존 `OwnerBadges`(`text-team-* + bg-team-*-weak` 조합, 다크 안전)를 재사용한다. **`bg-team-${code.toLowerCase()}` 식 문자열 조립 금지** — 없는 토큰이 나오고 JIT가 스캔하지도 못한다.

SVG 그라디언트는 인라인 `<linearGradient>`의 `stopColor="var(--color-brand)"`로 쓴다. CSS 그라디언트는 SVG `fill`이 될 수 없다.

사용할 토큰: 격자 `line`/`grid`, 계획 곡선 `ink-muted`, 실적 마커 `brand`, 오늘 선 `delayed`, 단계 띠 `phasebar`/`phasebar-fill`, 마일스톤 `accent-warning`, 셀 `done|progress|pending|delayed`(+`-weak`).

## 9. 파일 구조

`DashboardView.tsx`는 491줄이고 계산과 마크업이 섞여 있다. 계산은 전부 `src/lib/domain/`으로 내리고 — React 없이 단위 테스트할 수 있도록 — 컴포넌트는 렌더만 한다.

### 신규

| 경로 | 책임 |
|---|---|
| `src/lib/domain/journey.ts` | `buildJourney(roots, {startDate, endDate, today, holidays})` → 곡선 샘플 · 단계 밴드 · 마일스톤 · 오늘 · 예측 모델 |
| `src/lib/domain/attention.ts` | `attentionLeaves`, `buildActionRows`, `compareActionRows` |
| `src/lib/domain/bottleneck.ts` | `teamOf`, `buildBottleneck(roots, today)` → `{ cells: Cell[5][4], unassignedLeaves: number }` |
| `src/components/dashboard/JourneyCard.tsx` | RSC. 손으로 쓴 SVG |
| `src/components/dashboard/ActionCard.tsx` | RSC. `next/link` 행 |
| `src/components/dashboard/BottleneckCard.tsx` | RSC. `<table>` |
| `src/components/dashboard/primitives.tsx` | `CountBadge` · `Stat` · `MiniEmpty` (DashboardView 내부에서 승격) |

### 수정

| 경로 | 변경 |
|---|---|
| `src/lib/domain/dates.ts` | `makeBizDayIndex(start, end, holidays)` 추가. 기존 `businessDaysBetween`은 그대로 (창 밖 폴백) |
| `src/lib/domain/rollup.ts` | `plannedRollupAt` / `overallPlannedAt` 추출 후 `computeNode`가 호출. `siblingWeight` export. `leafWeightShares` 추가 |
| `src/lib/domain/dashboard.ts` | `milestoneLeaves` export. `ScheduleModel.earlyFloor` 추가. `RiskModel.attention` 추가 |
| `src/components/ui/SectionCard.tsx` | `fill` · `bodyClassName` 옵트인 (§8.3) |
| `src/components/dashboard/ExecSummary.tsx` | 리스크 타일 값 → `s.risk.attention` (§10) |
| `src/components/dashboard/DashboardView.tsx` | 491줄 → 약 120줄. 조립만 |
| `src/app/(app)/p/[projectId]/dashboard/page.tsx` | `Promise.all` 6 → 4. `holidays` 구조분해 추가 |
| `src/app/globals.css` | `@layer components`에 `.hatch`. `.dark`에 `--color-today: #ff738a` |
| `src/lib/i18n/dict/dashboard.ts` | 키 삭제 · 추가 (§11) |

## 10. ExecSummary 수정 (1건)

`ExecSummary.tsx:85`가 `${s.risk.delayed + s.risk.dueSoon}`을 찍는다 → **20건**. 실제 고유 대상은 **14건**이다. 조치 카드가 14를 표시하면 두 숫자가 3인치 거리에서 충돌한다. 헤더 벨(`notifications.ts:42`)은 이미 14로 제대로 센다 — **앱 안에서 이미 두 surface가 불일치**한다.

```ts
// dashboard.ts
export interface RiskModel { delayed: number; dueSoon: number; attention: number; topWeightDelayed: boolean; signal: Signal }
// riskModel(): + attention: attentionLeaves(leaves, today).length
```
```tsx
// ExecSummary.tsx:85
value={`${s.risk.attention}${tr('dash.unitCount')}`}
sub={`${tr('dash.exec.delayed')} ${s.risk.delayed} · ${tr('dash.exec.dueSoon')} ${s.risk.dueSoon}`}   // 그대로
```

서브텍스트는 건드리지 않는다. `지연 13 · 임박 7`은 각각 맞는 숫자이고, 합이 아니라 두 관점이다.

**테스트 영향 0.** `tests/domain/dashboard.test.ts`는 `RiskModel`에 속성 접근만 하고 객체 리터럴 비교를 하지 않는다. `risk.signal` 임계값은 `delayed`만 읽으므로 신호등도 불변.

## 11. 삭제

### 카드
상태 분포(STATUS MIX) · 가중치 분포(WEIGHT) · 금주 근태(ATTENDANCE).
「단계별 진척」은 여정의 단계 띠로, 「지연 작업」은 조치로 흡수된다.

### 데이터 로더 (호출만 제거, 로더 자체는 존치)
- `getAttendanceRecords` — 대시보드의 유일한 소비처가 근태 카드였다. `attendance/page.tsx`, `api/report/route.ts`가 계속 쓴다.
- `getProjectMembers` — `memberCount`의 유일한 소비처가 근태 카드 푸터였다. 병목은 `item_owners`의 팀을 쓰지 `project_members`를 쓰지 않는다. 5개 다른 호출부가 있다.

⇒ 대시보드 요청에서 Supabase 왕복 2회가 사라진다.

### `DashboardView` props
`memberCount`, `attendance` 제거. `holidays: string[]` 추가 (`getComputedWbs`가 이미 반환하는데 `page.tsx:16`이 버리고 있다 — 추가 쿼리 0).

### 죽은 심볼
`DashboardView.tsx`: `ATT` 맵, `STATUSES`, `avg()`(→ `bottleneck.ts`로 이동), 타입 `AttendanceRecord`/`AttendanceType`/`Status`, lucide `PieChart`/`Scale`/`CalendarCheck`/`Layers`/`AlertTriangle`/`Timer`.

### i18n (ko/en 양쪽, ko 먼저)
삭제: `dash.statusMix.title`, `dash.weight.title`, `dash.phase.title`, `dash.kpi.delayed`, `dash.delayed.empty`, `dash.overdueSuffix`, `dash.gapLabel`, `dash.group.analysis`, `dash.group.scheduleRisk`, `dash.att.*` 전체(20키).

`dash.att.*`는 근태 **페이지**와 공유되지 않는다 — 그쪽은 `att.*` 네임스페이스다. 주간보고(`src/lib/report/*`)는 `dash.*`를 하나도 참조하지 않는다(grep 0건).

`dashboardEn`이 `Record<keyof typeof dashboardKo, string>`으로 타입되어 있어(`dict/dashboard.ts:91`) ko를 지우면 en 잔여 키가 **컴파일 에러로 잡힌다**. 단, `` tr(`dash.att.${type}` as DictKey) ``(`DashboardView.tsx:386`)의 캐스트는 타입 검사를 우회하므로 해당 렌더 코드도 함께 지운다.

존치: `dash.teamLoad.*`, `dash.noAssignment`, `dash.deliv.*`, `dash.dueSoon.*`, `dash.thisWeek.*`, `dash.nextWeek.*`, `dash.recentDone.*`, `dash.group.teamDeliv`, `dash.exec.*`, `dash.unit*`.

신규 키(ko/en): `dash.journey.title`, `dash.journey.noSchedule`, `dash.journey.forecastPending`, `dash.journey.weightHint`, `dash.action.title`, `dash.action.empty`, `dash.action.viewAll`, `dash.action.totalPrefix`, `dash.action.overdueSuffix`, `dash.action.gapLabel`, `dash.bottleneck.title`, `dash.bottleneck.unassigned`, `dash.bottleneck.scheduled`, `dash.bottleneck.noOwner`, `dash.bottleneck.unassignedLeaves`, `dash.group.weekly`.

## 12. 접이식 2그룹

| 그룹 | id | 내용 |
|---|---|---|
| 팀 · 산출물 | **`teamDeliv`** (재사용) | 팀 부하 + 산출물 현황 |
| 주간 리듬 | `weekly` (신규) | 이번 주 / 다음 주 작업 + 최근 완료 |

`teamDeliv`를 재사용하면 기존에 그 그룹을 펼쳐 두었던 사용자의 상태가 그대로 보존된다.

`UiPrefs.dashSections`에 남은 낡은 id(`analysis`, `scheduleRisk`)는 렌더에서는 무해한 no-op(`DetailAccordion.tsx:13,25`의 `open.has(g.id)`가 매치되지 않을 뿐)이다. 그러나 `toggle()`이 `[...next]`를 통째로 다시 저장하므로(`DetailAccordion.tsx:15-20`) **영원히 DB에 남는다.**

⇒ `toggle()`에서 렌더된 group id로 필터한 뒤 저장한다:
```ts
const live = new Set(groups.map(g => g.id))
queueUiPref({ dashSections: [...next].filter(id => live.has(id)) })
```
마이그레이션 없음. `prefs/sync.ts:11`의 `KEYS`에 `dashSections`가 없으므로 `PrefsSync`는 이 필드에 관여하지 않는다.

## 13. 빈 상태 · 에러

| 조건 | 동작 |
|---|---|
| `items.length === 0` | 기존 `EmptyState` (현행 유지) |
| `startDate` 또는 `endDate` null | **여정 카드만** `EmptyState('프로젝트 기간 미설정')`. 조치·병목은 정상 렌더. 항목 날짜에서 창을 유추하지 않는다 — 없는 기간을 조용히 발명하는 짓이다 |
| 조치 0건 | `MiniEmpty('조치가 필요한 작업이 없습니다')` |
| 병목: 어떤 팀이 모든 단계에서 미배정 | 열을 **지우지 않는다**. 전부 `–` |
| 병목: 무담당 리프 존재 | 표 아래 각주 `미배정 리프 N건` |
| `label === 'early'` | 예측선 없음 + `예측 미산정 · D+{elapsed} / {earlyFloor}` |

## 14. 테스트

### `tests/domain/journey.test.ts` (신규)
1. **불변식**: `overallPlannedAt(roots, today, idx) === overallProgress(computeTree(...)).planned`. 이게 깨지면 곡선과 바로 위 게이지가 서로 다른 숫자를 말한다.
2. **종점**: `overallPlannedAt(roots, endDate, idx) === 100`. 현재 실측 100.0. 누가 주말 마일스톤을 넣으면 여기서 실패한다 — 차트가 조용히 67%에서 멈추는 대신.
3. 곡선 단조 비감소.
4. 샘플 집합 = 월요일 ∪ 단계 경계 ∪ {start, today, end}, 중복 제거·정렬됨.
5. `label === 'early'` → `forecast === null`.
6. `projectedEnd > endDate` → `forecast.clipped === true`, `forecast.slipDays > 0`.
7. `startDate === null` → `buildJourney`가 `null`을 반환 (카드가 EmptyState로 분기).
8. `makeBizDayIndex(...).between(a,b) === businessDaysBetween(a,b,holidays)` — 창 안 모든 쌍에 대해 (기존 구현과의 등가성).

### `tests/domain/attention.test.ts` (신규)
1. `delayed=13`, `dueSoon=7`, 중복 6 픽스처 → `attentionLeaves().length === 14`, `kind`는 delayed가 이긴다.
2. `compare(a,b) === -compare(b,a)`, `compare(a,a) === 0` — 6행 픽스처 전 쌍.
3. 정렬 결과의 **id 전체 시퀀스**를 단언 (쌍별 비교 아님).
4. `plannedEnd === null` + delayed → `overdueDays: 0`, `dday: null`, `NaN` 없음.
5. `gapPp = max(0, planned - actual)` — 음수 없음.
6. 빈 입력 → `[]`. D+7 경계 포함(기존 `dashboard.test.ts:195`가 고정).

### `tests/domain/bottleneck.test.ts` (신규)
1. **Σ셀 + `unassignedLeaves` = 리프 수.**
2. 격자 모양 5×4, 팀 순서는 `REPORT_TEAMS`와 일치 (`Object.keys`에 기대지 않음).
3. 상태 우선순위: 미배정 > 완료 > 지연 > 예정 > 진행중. 특히 **미래 단계의 지연 리프가 있으면 지연이 예정을 이긴다.**
4. 다중 담당 리프(primary MES + support 가공) → `teamOf`로 **MES 셀에만** 1회.
5. `primary` 없는 support-only 리프 → `owners[0]` 팀으로.
6. 무담당 리프 → 어느 셀에도 안 들어가고 `unassignedLeaves`에 계상. 크래시 없음.
7. `|L| === 0` → `'unassigned'`, 절대 `'done'`이 아니다.
8. `plannedStart` 전부 null인 셀 → `'scheduled'`, `dday === null`.
9. `avgPct`는 `Math.round(sum/n)` (절삭 아님) — `DashboardView.tsx:50`의 `avg()`와 동일.

### `tests/domain/dashboard.test.ts` (수정)
`riskModel().attention` 케이스 추가. 기존 케이스는 손대지 않는다.

### `tests/ui/dashboard-accordion-prefs.test.tsx` (신규, jsdom)
`initialExpanded=['analysis','scheduleRisk','teamDeliv']`, groups=`[teamDeliv, weekly]`, `StrictMode`.
→ `teamDeliv`만 열림. `weekly` 토글 후 600ms → `saveUiPrefs({dashSections:['teamDeliv','weekly']})`. **낡은 id가 사라졌음**을 단언. 필터가 없으면 `['analysis','scheduleRisk','teamDeliv','weekly']`로 실패한다.

`vitest.config.ts`는 `environment: 'node'`이므로 이 파일만 `// @vitest-environment jsdom` 독블록 (선례: `tests/ui/wbs-initial-collapsed.test.tsx:1`).

## 15. 범위 밖 — 별도 작업

**WBS 딥링크(`?focus=<itemId>`).** 조치 행에서 해당 WBS 항목으로 점프하는 기능은 매력적이지만 **DB를 쓴다.**

`WbsGanttSheet.tsx:138-142`의 지속화 이펙트는 `collapsed` Set 참조가 바뀌면 `queueWbsCollapse` → `user_wbs_state` upsert를 한다. 조상을 프로그램적으로 펼치면 새 `Set`이 생기므로 **조치 행을 한 번 클릭하는 것만으로 사용자가 저장해 둔 WBS 접힘 상태가 영구히 덮어써진다.** 여기에 3중 중첩 `overflow` 컨테이너에서의 `scrollIntoView`, `key={projectId}` 때문에 소프트 내비게이션에서 리마운트가 안 되는 문제, `useSearchParams`의 `<Suspense>` 요구까지 겹친다.

이번 범위에서는 행 클릭이 `/p/{projectId}/wbs`로만 이동한다.

나중에 딥링크를 붙인다면 `?focus=`보다 **`?q=<검색어>` 프리필**이 훨씬 싸다 — `query`가 비어있지 않으면 `flatRows`가 `collapsed`를 통째로 무시하므로(`WbsGanttSheet.tsx:223`) DB 쓰기가 0이다.

**실적 추세선.** `progress_snapshots` 부활 + 일일 크론이 선행되어야 한다. 별도 스펙.

## 16. 검증 방법

1. `npx vitest run` — 신규 3 + 수정 2 테스트 통과, 기존 테스트 무손상.
2. `npx tsc --noEmit` — i18n 키 삭제 후 en 잔여 키가 없음이 컴파일로 증명된다.
3. `npm run build` — RSC 경계 위반 없음(새 카드 셋 모두 클라이언트 훅 미사용).
4. 로컬 dev에서 `/p/7a1c6034-.../dashboard` 를 실제로 열어 확인:
   - 여정 곡선이 오늘 지점에서 6%를 지나고, 바로 위 게이지도 6%를 표시하는가
   - 리스크 타일이 **14건**인가 (20 아님)
   - 병목 20칸이 지연 5 · 예정 11 · 미배정 4 인가
   - 조치 푸터가 `전체 14건`인가
   - 900dvh에서 Row 1이 스크롤 없이 들어가는가
   - 다크 모드에서 오늘 선이 `#ff738a`인가
   - 사이드바 접기/펼치기 시 1280px에서 3열 ↔ 2열이 전환되는가
5. 인쇄 미리보기에서 병목의 빗금·점선·글리프가 살아있는가.

## 부록 A — 구현 중 발견된 잠재 버그 (이 스펙의 범위 밖)

두 건 모두 **기존 코드의 문제**이고, 이번 작업이 만든 것이 아니다. 독립적으로 재현·확인했다. 고치지 않되 기록한다.

### A-1. 루트 가중치가 일부만 null이면 그 phase가 통째로 사라진다

`overallProgress`(`rollup.ts`)의 루트 가중 규칙은 `eff = allNull ? 1 : (r.weight ?? 0)` 이다. 즉 루트 중 **하나라도** 가중치가 있으면, 가중치가 `null`인 루트는 `0`으로 취급되어 전체 공정율에 **전혀 기여하지 못한다.**

반면 루트 아래 모든 계층에서 `null`은 `siblingWeight`에 의해 **균등 분배(=1)** 를 뜻한다. 같은 `null`이 루트에서는 "몫 없음", 그 아래에서는 "동등한 몫"이다.

재현: 루트 P1(`weight: 2`), P2(`weight: null`), 각각 리프 1개. 2026-07-15 기준 P2의 `plannedPct`는 **100**인데 `overallProgress().planned`는 **48**이다. `siblingWeight` 규칙이었다면 65다. 100% 진행되어야 할 phase 하나가 조용히 증발한다.

이 동작은 `tests/domain/overallProgress.test.ts:36-43`이 **의도적으로 고정**하고 있다(단, `actual`만 단언하고 `planned`는 단언하지 않는다).

현재 D-CUBE 프로젝트는 루트 5개가 모두 가중치를 가지므로 발동하지 않는다. **가중치 0~100 재조정 작업(`feat/weight-100-scale-clean`)이 부분 null 루트 집합을 만들면 그때 터진다.** 실패 모드가 조용하다는 것이 가장 나쁘다.

### A-2. 형제 가중치가 전부 0이면 몫이 0이 된다

`weightedMean`과 `leafWeightShares`의 `|| 1` 가드는 `totalW === 0`일 때 분모를 1로 만든다. 자식들의 `weight`가 전부 `0`이면 모든 자식의 몫이 `0`이 되어, 그 서브트리의 리프 몫 합이 **1이 아니라 0**이 된다. `wbs_items.weight`에는 CHECK 제약이 없어 `0`을 저장할 수 있다(`0001_init.sql:36`).

이 구멍은 기존 `computeNode`에 이미 있었다(자식이 둘 다 100%여도 부모는 `rolledActualPct: 0`). `weightedMean`은 그 동작을 충실히 보존하므로 **회귀가 아니다**. `leafWeightShares`가 새로 이 성질을 물려받았을 뿐이다.

고친다면 두 곳 모두 `totalW === 0 ? children.length : totalW`로 바꿔 균등 분배로 폴백해야 하고, 그러면 `computeNode`의 동작이 바뀌므로 **별도 커밋·별도 회귀 검증**이 필요하다.

### A-3. 곡선은 반드시 `overallPlannedAt`으로 그려야 한다

`Σ(leafWeightShares × plannedPct(leaf, d))`로 곡선을 만들면 `overallPlannedAt`과 **다른 숫자**가 나온다. `weightedMean`이 트리의 **매 계층마다** 반올림하기 때문이다.

실측(`plannedAt.test.ts` 픽스처, `d = 2026-07-06`): `overallPlannedAt = 22`, 평탄 가중합 = `21.375 → 21`.

`leafWeightShares`는 **조치 목록의 우선순위 타이브레이크**처럼 리프별 기여도를 따질 때만 쓴다. 게이지 값을 재구성하는 데 쓰면 이 스펙이 막으려 한 바로 그 버그(§5.2)를 한 계층 더 깊은 곳에서 재현한다.
