# 대시보드 본문 재구성 — 경영진/PMO 섹션 + 진척 트렌드 (설계 스펙)

- 작성일: 2026-07-09
- 대상: 프로젝트 대시보드 (`/p/[projectId]/dashboard`) — Executive Summary **아래** 전체
- 상태: 설계 확정 (사용자 승인 완료, 스펙 리뷰 대기)
- 선행 스펙: `2026-07-08-dashboard-exec-redesign-design.md` (ExecSummary 히어로 — 현행 유지)

## 1. 배경 & 목표

07-08 재설계로 상단 ExecSummary(게이지 + 신호등 3타일 + 공지 + 리포트)는 완성됐다. 그러나 그 아래는 여전히 **운영형 카드 나열**(BY PHASE, ATTENTION, 접이식 상세 3그룹 = 상태분포·가중치·마감임박·금주/차주·팀부하·산출물·최근완료·근태)이다.

**목표**: ExecSummary는 그대로 두고, 그 아래 전체를 경영진/PMO가 실제로 묻는 질문에 답하는 섹션으로 **완전 교체**한다.

| 경영진/PMO의 질문 | 답하는 섹션 |
|---|---|
| 추세가 좋아지고 있나, 나빠지고 있나? | B. 진척 트렌드 (S-Curve + SPI + velocity) |
| 어느 단계·어느 팀이 병목인가? | C-1. 진척 매트릭스 (Phase×팀) |
| 뒤처졌지만 아직 마감 전인 것(따라잡기 후보)은? | C-2. 편차 랭킹 |
| 마일스톤 여정 전체는 어떤 상태인가? | D. 마일스톤 타임라인 |
| 기한을 이미 넘긴 작업은 얼마나 오래 방치됐나? | E-1. 지연 에이징(기한 경과) |
| 계획 데이터 자체는 관리 가능한 품질인가? | E-2. 데이터 위생 |

**선행 스펙과의 관계**: 07-08 스펙의 "정보 손실 0(13블록 전부 보존)" 원칙은 본 스펙에서 **사용자 결정으로 폐기**한다(브레인스토밍 선택지 "완전 교체" 채택). 근태·산출물 등은 각자 전용 페이지가 이미 있다.

## 2. 확정된 결정 (브레인스토밍 결과)

1. **범위**: 스냅샷 테이블 신설 + 트렌드 차트까지 (리스크 레지스터는 범위 밖)
2. **본문 섹션**: 트렌드 블록 / 진척 매트릭스 + 편차 랭킹 / 마일스톤 타임라인 / 지연 에이징 + 데이터 위생 (산출물 파이프라인·보고회 일정은 **선택하지 않음**)
3. **기존 상세 카드**: 완전 교체 — DetailAccordion 및 하위 카드 전부 제거
4. **스냅샷 기록 시점**: WBS 변경 서버 액션 시 upsert + 대시보드 조회 시 보험 upsert (크론 없음)

## 3. 화면 구성 (위 → 아래)

```
A. EXECUTIVE SUMMARY ──────────────────────────── 현행 유지 (변경 없음)
B. 진척 트렌드 ────────────────── xl: [minmax(0,2fr) minmax(0,1fr)]
   좌: S-Curve (계획 누적곡선 전 구간 + 실적 이력선 + 오늘 마커)
   우: SPI 스파크라인 + 현재 SPI · 주간 velocity(+x%p) · 현재 편차(%p) 스탯
C. 진척 매트릭스 + 편차 랭킹 ──── xl: 2열
   좌: Phase(행)×팀(열) 히트맵 — 셀=담당 leaf 평균 진척%(작업수), 행 끝=Phase 전체%·편차
   우: 계획-실적 편차 내림차순 Top 8 (done·기한경과 제외 — 마감이 남은 따라잡기 후보만) — 이름·담당팀·이중 바·편차 %p 배지
D. 마일스톤 타임라인 ──────────── 전체 폭
   프로젝트 시작→종료 가로축, 마일스톤 점 배치
   완료=초록 · 기한경과 미완=빨강 · 예정=중립+D-day 라벨 · 오늘 세로선
E. 지연 에이징 + 데이터 위생 ──── xl: [minmax(0,2fr) minmax(0,1fr)]
   좌: 기한 경과(plannedEnd<오늘) 미완료 작업의 경과일 버킷(1~7 / 8~14 / 15+일) 스탯 3개
       + 경과 Top 8 리스트(기존 ATTENTION 흡수)
   우: 담당팀 누락 n건 · 기간 미설정 n건 · 가중치 혼재 n건 — 각 행에서 WBS 페이지로 링크
```

모바일(기본)은 전부 1열 세로 스택. 카드 골격은 기존 `SectionCard`(eyebrow/title/icon/actions) 재사용.

## 4. 데이터 모델 — 마이그레이션 `0020_progress_snapshots.sql`

```sql
create table wbs_progress_snapshots (
  project_id  uuid not null references projects(id) on delete cascade,
  snap_date   date not null,            -- KST 기준 날짜
  actual_pct  numeric(5,2) not null,    -- 전체 실적% (0~100)
  planned_pct numeric(5,2) not null,    -- 기록 당시 전체 계획% (0~100)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (project_id, snap_date)
);
```

- **RLS**: `wbs_items`와 동일한 정책 모형 — 읽기는 프로젝트 멤버, 쓰기는 편집 권한 멤버. **프로덕션 헬퍼는 `app_role()`이다**(리포지토리 0002/0004의 `current_role()`은 드리프트) — 0020은 프로덕션 실태(`app_role()`)에 맞춰 작성한다.
- `planned_pct`를 함께 저장하는 이유: SPI 시계열(실적/계획)을 **그 시점의 계획** 기준으로 정직하게 그리기 위해. 계획이 나중에 수정돼도 과거 SPI가 소급 왜곡되지 않는다.
- 현재 롤업(`overallProgress`)은 정수를 반환하므로 당장은 정수가 저장된다. `numeric(5,2)`는 추후 정밀화 여지.

## 5. 스냅샷 기록 경로

새 헬퍼 `recordProgressSnapshot(projectId)` — `src/lib/data/snapshots.ts` (서버 전용, 기존 데이터 접근 계층 관례):

1. 해당 프로젝트 WBS 전체 조회 → `computeAll` → `overallProgress`로 (actual, planned) 산출
2. `(project_id, KST today)` 행에 upsert (`onConflict: project_id,snap_date`)

호출 지점:
- **`src/app/actions/wbs.ts`의 모든 변경 액션** 말미 (생성·수정·삭제·상태/실적 변경·엑셀 임포트 등 wbs_items를 변경하는 전 경로). 실패해도 본 작업을 실패시키지 않는다(로그만).
- **대시보드 `page.tsx` 로드 시** — 오늘 행이 없거나 저장값 ≠ 현재값이면 upsert (이미 조회한 items를 재사용하므로 추가 조회 비용 없음).

크론 없음. 무변경 기간의 빈 날짜는 차트가 carry-forward로 메운다(실적은 편집 시에만 변하므로 값이 정확하다).

## 6. 도메인 로직 (`src/lib/domain/` — 순수 함수, 전부 테스트 대상)

새 파일 `trend.ts` + 기존 `dashboard.ts` 확장. UI에서 계산하지 않는다.

### 6.1 트렌드 (`trend.ts`)

- `plannedAt(rows, date): number` — 임의 날짜의 전체 계획%. **기존 `computeAll(rows, date)`를 해당 날짜로 재실행**해 `overallProgress`를 읽는 방식으로 확정(주말/공휴일 규칙을 공짜로 재사용, 샘플 수십 개 × 소규모 트리라 비용 무시 가능).
- `buildTrend(snapshots, items, { startDate, endDate, today }): TrendModel`
  - `plannedSeries`: 프로젝트 시작→종료 전 구간(주 단위 샘플 + 시작/종료/오늘 포함)
  - `actualSeries`: 스냅샷 정렬 → **carry-forward**(다음 스냅샷 전까지 직전 값 유지) → **오늘까지만** (미래로 연장 금지)
  - `spiSeries`: 각 스냅샷의 `actual/planned` — 단, `planned < 5`인 시점은 제외(기존 `scheduleModel` 조기 가드와 동일 원칙: 초기 SPI 불안정 구간은 그리지 않는다)
  - `velocityWeek`: `actual(today) − actual(today−7d)` (%p, carry-forward 값 기준)
- X축 범위: `startDate/endDate` 우선, null이면 WBS leaf 날짜의 min/max로 대체. 둘 다 없으면 트렌드 모델은 `empty` 플래그를 반환.

### 6.2 매트릭스·랭킹·에이징·위생 (`dashboard.ts` 확장)

- `progressMatrix(roots): { rows: { phase, cells: ({ pct, count } | null)[], overall, variance }[] }` — 셀 = 해당 팀이 담당인 leaf들의 평균 `rolledActualPct` + 개수(primary·support 모두 포함 — 기존 `teamSummary` 관례), 담당 leaf 없으면 null(표시는 "—"). 팀 축은 기존 `TEAMS` 상수.
- `varianceRanking(leaves, today): { item, gapPp }[]` — `plannedPct − rolledActualPct` 내림차순, `gapPp > 0`만, Top 8. 제외: `done`, 그리고 **기한 경과 항목(`plannedEnd < today`)** — 그건 E-1이 전담. **주의(도메인 사실)**: `statusOf`는 `actual < planned`이면 곧바로 `delayed`이므로 "지연 전 조기 경보" 상태는 이 도메인에 존재하지 않는다. C-2/E-1의 분리 기준은 상태가 아니라 **마감 경과 여부**다(C-2=따라잡을 시간이 남은 것, E-1=기한을 넘긴 것 — 상호 배타).
- `milestoneTimeline(items, today): { name, date, status: 'done'|'overdue'|'upcoming', dday }[]` — 기존 `isMilestoneLeaf` 재사용하되 **완료 포함 전체** 나열, 날짜순. 기존 `detectMilestones`(다음 1개 감지)는 ExecSummary용으로 그대로 유지.
- `delayAging(leaves, today): { d1_7, d8_14, d15plus, total, list }` — 대상 = `status !== 'done' && plannedEnd < today`(기한 경과 미완료), 경과일 = `today − plannedEnd`(항상 ≥1), 버킷 1~7 / 8~14 / 15+, 리스트는 기존 ATTENTION 정렬(경과일 → 편차) Top 8.
- `dataHygiene(items): { noOwner: number, noDates: number, mixedWeight: number }`
  - `noOwner`: owners가 빈 leaf 수
  - `noDates`: plannedStart·plannedEnd 모두 null인 leaf 수
  - `mixedWeight`: **형제 그룹 내 weight가 일부만 null**인 그룹 수 — 이 경우 null 형제의 유효가중이 0이 되어 롤업에서 사실상 누락되는 실제 버그 소지(현행 `eff()` 동작 기준)

## 7. UI 컴포넌트 & RSC 경계 (`src/components/dashboard/`)

전부 **서버 컴포넌트 + 자체 SVG** (의존성 추가 없음 — 기존 `ProgressGauge` 노선). 호버 인터랙션은 SVG `<title>` 네이티브 툴팁으로 충분, 클라이언트 JS 불필요.

| 컴포넌트 | 내용 |
|---|---|
| `TrendChart` | S-Curve SVG. 계획선(점선·ink-muted), 실적선(brand·굵게), 오늘 세로선, 축 라벨(시작/오늘/종료 + 25/50/75/100%). 실적 시작점 이전 구간은 실적선 없음 |
| `SpiPanel` | SPI 스파크라인(소형 SVG) + `Stat` 3개(현재 SPI · 주간 velocity · 현재 편차). velocity 양수=done 톤, 음수·0=중립 |
| `ProgressMatrix` | 시맨틱 `<table>`. 셀 배경 = 달성률 구간 틴트(done/brand/pending/delayed weak 톤), 숫자 병기(색맹 대비). 행 끝 편차 열은 `+/−%p` |
| `VarianceRanking` | 리스트 행: 이름 · OwnerBadges · ProgressBar(value=실적, planned=계획) · 편차 배지 |
| `MilestoneTimeline` | 가로 스트립 SVG: 시간축 비례 배치, 점 색 = status, 라벨 = 이름(말줄임)·날짜·D-day. 마일스톤 0건이면 MiniEmpty |
| `DelayAging` | `Stat` 버킷 3개 + 지연 리스트(기존 ATTENTION 행 마크업 재사용) |
| `DataHygiene` | 카운트 행 3개, 각각 `/p/[projectId]/wbs` 링크. 전부 0이면 "계획 데이터 이상 없음" 확인 상태(done 톤) |

색·간격·타이포는 기존 토큰(`brand/done/delayed/pending/ink-*/surface-*/line`)만 사용. 신규 토큰 없음.

## 8. 기존 코드 변경 지점

- **`DashboardView.tsx`**: ExecSummary 아래 전면 재작성. 제거 — BY PHASE, ATTENTION(§E로 흡수), `DetailAccordion` 호출부와 3그룹 JSX 전부, 로컬 헬퍼 중 새 섹션이 안 쓰는 것(`ATT`, `TaskRow`, `GroupTitle` 등). 유지 — `Stat`, `CountBadge`, `MiniEmpty`, 날짜 유틸.
- **삭제 파일**: `DetailAccordion.tsx` (다른 사용처 없음 확인 후).
- **`page.tsx`**: `attendance`·`memberCount`·`initialExpanded` 등 불용 prop 제거, 스냅샷 조회 + 보험 upsert 추가.
- **`UiPrefs.dashSections`**: 대시보드에서 참조 제거. 타입 필드와 서버 저장분은 무해하므로 유지(별도 정리 범위 밖).
- **i18n `dict/dashboard.ts`**: 신규 키 추가(ko/en 동시), 삭제된 카드의 고아 키 제거. `dash.att.*`는 근태 페이지가 쓰지 않는 것만 제거(구현 시 사용처 grep으로 확정).
- **`ExecSummary`·`ReportButton`·주간보고 生成**: 변경 없음(리포트가 기존 도메인 함수를 쓰면 그대로 동작 — 구현 시 의존 확인).

## 9. 엣지 / 빈 상태

| 상황 | 처리 |
|---|---|
| 스냅샷 0건 (기능 배포 직후) | 계획선 + 오늘 위치에 현재 실적 점 1개 + "실적 이력은 지금부터 기록됩니다" 안내. velocity·SPI 스파크라인은 "—" |
| 스냅샷 1건 | 실적선 = 그 점부터 오늘까지 carry-forward 수평선 |
| 프로젝트 기간 null & WBS 날짜도 없음 | 트렌드·타임라인 카드는 MiniEmpty |
| 계획 < 5% (조기) | SPI 표기 억제(중립 "—"), ExecSummary 조기 가드와 일관 |
| 완료 프로젝트 (actual=100) | 곡선 100 도달 후 평탄, velocity 0, 정상 표시 |
| 마일스톤 0건 | 타임라인 MiniEmpty (기존 감지 규칙 그대로이므로 키워드/단일일+산출물 leaf가 없는 경우) |
| 팀 미배정 프로젝트 | 매트릭스 셀 전부 "—" — 위생 카드의 담당 누락 카운트가 원인을 지목 |
| WBS 0건 | 기존 EmptyState 유지 (변경 없음) |

날짜는 전부 KST(`seoulToday()`), 일수 계산은 기존 UTC 정수일 유틸 재사용.

## 10. 테스트 (Vitest)

- `tests/domain/trend.test.ts` (신규): plannedAt 경계(시작 전=0, 종료 후=100), carry-forward(빈 날짜 메움·미래 미연장), SPI 조기 가드 제외, velocity(7일 창, 스냅샷 희소 시 carry-forward 기준), 빈 스냅샷/기간 null 폴백.
- `tests/domain/dashboard.test.ts` (확장): progressMatrix(무배정 null 셀·평균 계산), varianceRanking(done·기한경과 제외·양수만·정렬), milestoneTimeline(done/overdue/upcoming 분류·정렬), delayAging(버킷 경계 7/14일·기한 경과만 포함), dataHygiene(mixedWeight — 일부 null 형제 감지, 전부 null은 정상).
- 스냅샷 upsert 헬퍼: 도메인 산출값 정합만 단위 테스트(DB 왕복은 범위 밖 — 기존 액션 테스트 관례 따름).

## 11. 배포

1. `0020_progress_snapshots.sql`을 **프로덕션에 Management API 레시피로 적용** (RLS 헬퍼 `app_role()` 기준 — 메모리 `rls-helper-drift` 참조)
2. main 푸시 → Vercel 자동 배포 (`deploy` 스킬 플로우)
3. 배포 직후 대시보드 1회 조회로 첫 스냅샷 생성 확인

## 12. 범위 밖 (YAGNI)

- 리스크 레지스터(등록/영향도/완화책) — 브레인스토밍에서 보류
- 산출물 파이프라인·보고회 일정 섹션 — 사용자가 선택하지 않음
- 포트폴리오(다중 프로젝트) 뷰, 비용 기반 EVM(CPI), 크리티컬 패스(의존성 데이터 없음)
- 차트 라이브러리 도입, 클라이언트 인터랙티브 툴팁
- 과거 실적 백필(스냅샷은 배포 시점부터 축적)
