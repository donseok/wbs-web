# 전사 포트폴리오 대시보드 (슈퍼유저 전용) — 설계 정본

날짜: 2026-08-18
상태: 설계 확정 (v1 범위 사용자 승인)
브랜치: `ui/portfolio` (사이드바·헤더 = UI 위험 파일이라 브랜치 규칙 대상)

## 1. 목적과 범위

프로젝트 하나를 깊게 보는 기존 대시보드(`/p/[id]/dashboard`)와 달리,
**모든 프로젝트를 한 화면에서 비교**하는 슈퍼유저 전용 화면을 만든다.

### v1 범위 (이번 구현)

- 전체 프로젝트 신호등 (프로젝트별 red/amber/green/neutral + 전사 분포)
- 프로젝트별 진척률(실적/계획/편차) · SPI · 예상 종료일(D-day/지연일)
- 다음 마일스톤 + 마일스톤 통합 타임라인 (전 프로젝트 한 축)
- PM 열 (로스터 '리더' 표시 — 사용자 확정)
- 프로젝트 생애 상태 칩 (ready/active/overdue/done/unknown)
- 행 클릭 → `/p/{id}/dashboard` 이동
- **마이그레이션 0건**

### v2 이후로 미룬 것 (사용자 확정 — v1에서 구현 금지)

| 기능 | 미루는 이유 |
|---|---|
| 경영진 읽기전용 공유 링크 | 전용 토큰 테이블(0065 초대 패턴: expires_at·revoked_at·감사) + `/share/portfolio/[token]` 라우트 신설 필요. 회의록식 무기한 토큰(0026)은 전사 데이터에 부적합 |
| 담당자 충돌 (한 사람이 여러 프로젝트 동시 배정) | 구조는 가능(0070 email 전역 키 + 0077 assignee_member_id)하나 사람 담당자 배정이 2026-08-12 배포된 신기능이라 실데이터 커버리지가 거의 0. email 없는 외부 인력은 원리적으로 판정 불가 |
| 프로젝트 간 선후행 | `task_dependencies`는 복합 FK+트리거가 교차 프로젝트를 DB 레벨에서 차단. 새 테이블+입력 UI가 필요한 최대 신규 범위 — 수요 확인 후 |

## 2. 접근안 결정: A안 (라이브 집계 + 정본 함수 재사용)

서버 컴포넌트가 전 프로젝트를 병렬 로드하고 프로젝트마다 **기존 정본 함수를
그대로 호출**한다. 근거:

- 프로젝트 대시보드와 숫자가 반드시 일치한다(같은 함수).
- `/projects` 홈이 이미 같은 패턴(Promise.all × getComputedWbs)을 쓴다.
- 마이그레이션 0건.

기각한 안: B(경량 배치 쿼리 신설 — 롤업 정본 `overallProgress`와 계산이 갈라질
위험), C(요약 저장 테이블 — v1에 과함. A가 느려지면 그때 승격).

부수 효과: 포트폴리오 조회 시 `after()`로 전 프로젝트 스냅샷을 일괄
upsert하면 "아무도 안 여는 프로젝트는 스냅샷 공백" 문제가 자연 해소된다.

## 3. 라우트와 권한

- 라우트: `src/app/(app)/portfolio/page.tsx` + 자체 `loading.tsx`(레이아웃
  일치 스켈레톤, `dashboard/loading.tsx` 모범 준수). `export const dynamic =
  'force-dynamic'`.
- 판정: `src/lib/authz/portfolioAccess.ts`에 `canViewPortfolio(actor) =
  actor?.isSuperuser === true` 신설 — `canViewUsage`(usageAccess.ts) 전례 복제.
  role 문자열 직접 비교 금지(프로젝트 CLAUDE.md 계약).
- 페이지 선두: `getActorForView()` → `canViewPortfolio` 실패 시
  `redirect('/projects')` (usage/page.tsx:32-34 패턴).
- 메뉴 노출: `(app)/layout.tsx` identity 스냅샷에 `showPortfolio` boolean 추가
  (Actor의 Map은 RSC 직렬화 불가 — boolean 평탄화 관례). `Sidebar.tsx` 2곳
  (projectMenu push + 프로젝트 미선택 분기)과 `HeaderChrome.tsx` 모바일 드로어
  (lg 미만 유일 진입점)에 등록 — showUsage와 동일 방식.
- **방어선 명시**: projects/wbs_items 읽기 RLS는 authenticated 전체
  개방(0002:20-21)이므로 이 화면을 잠그는 것은 코드 게이트뿐이다. 새 테이블·
  RPC를 만들지 않으므로 DB 2차 방어선은 없다(데이터 자체는 전 직원이 이미
  읽을 수 있는 것들의 재조합이라 수용).
- 비공개 프로젝트(0070): 슈퍼유저는 `canSeeProject`가 전부 통과 — 포트폴리오에
  포함하되 행에 비공개 표시(자물쇠 아이콘 등)를 붙인다.

## 4. 데이터 로딩

단일 Promise.all 왕복(직렬 2단째 금지 — 대시보드 관례):

1. 전 프로젝트 목록(슈퍼유저이므로 비공개 포함).
2. 프로젝트별 병렬: `getComputedWbs(id)` + `getSnapshots(id)` +
   `getProjectConfig(id)`.
3. PM(리더): `project_members`에서 `role='admin'` 행을 `.in('project_id',
   ids)` 한 방으로 배치 조회(getProjectsCompletion 선례). 복수면 병기, 0명이면
   '—'.
4. 프로젝트별 파생(모두 기존 정본 함수):
   - 신호등: `buildExecSummary` (dashboard.ts:146-164)
   - 진척/계획/편차: `overallProgress` (rollup.ts, round1 규약)
   - SPI·예상종료·지연일: `scheduleModel` (dashboard.ts:30-58) — **예상 종료일
     정본은 SPI 외삽(projectedEnd)**. 의존성 전파(projectForecastEnd)는 채택
     안 함(프로젝트 대시보드 SPI 패널과 값 일치 우선).
   - 다음 마일스톤: `detectMilestones`, 타임라인: `milestoneTimeline`
   - 생애 상태: `projectLifecycleStatus`
5. `after()`: 전 프로젝트 `recordProgressSnapshot` 일괄 upsert.

기준일: 각 프로젝트의 `getComputedWbs`가 반환하는 today(base_date 우선)를
그대로 쓴다 — 프로젝트 대시보드와 동일 판정. base_date가 설정된 프로젝트는
행에 기준일을 병기해 "오늘"이 아님을 드러낸다(이원화 관례의 정직 표시).

## 5. 집계 도메인 계층 (신규, 순수 함수)

`src/lib/domain/portfolio.ts` — 컴포넌트는 조립만 한다는 대시보드 원칙 준수.

```ts
type PortfolioRow = {
  projectId: string
  name: string
  isPrivate: boolean
  lifecycle: LifecycleStatus        // projectLifecycleStatus
  signal: Signal                    // ExecSummary.overall.signal
  actualPct: number | null          // round1
  plannedPct: number | null
  variancePct: number | null
  spi: number | null                // neutral 가드 시 null
  projectedEnd: string | null       // SPI 외삽, 3× clamp
  slipDays: number | null
  nextMilestone: { name: string; date: string; dday: number } | null
  pms: string[]                     // 리더 이름들, 빈 배열 = '—'
  baseDate: string | null           // base_date 병기용
  degraded: boolean                 // 조회 실패 행 — 표시 = 로깅
}

buildPortfolio(inputs: PerProjectInput[]): {
  rows: PortfolioRow[]              // 정렬 포함
  totals: { count: number; red: number; amber: number; green: number;
            neutral: number; overdue: number }
  milestones: PortfolioMilestone[]  // 통합 타임라인용 (projectId 부착)
}
```

정렬: 신호 심각도(red → amber → green → neutral) 우선, 동률은 편차 오름차순.
생애 상태 done/ready는 active 그룹 뒤에 구분해 배치.

## 6. 화면 구성 (기존 프리미티브 재사용)

위에서 아래로:

1. **KPI 스트립**: 프로젝트 수 · 신호 분포(red/amber/green 카운트) · 지연 중
   프로젝트 수 — `KpiCard`/`SignalTile` 재사용(색맹 대응 statusText 필수).
2. **비교 테이블** (화면의 중심): 행=프로젝트, 열=신호등 · 진척(실적/계획/
   편차) · SPI · 예상종료(D-day/지연일) · 다음 마일스톤 · PM · 생애 상태 칩.
   행 전체 클릭 → `/p/{id}/dashboard`. 신호→스타일은 `SIGNAL_META`
   (signalStyle.ts) 재사용. 모바일은 테이블 가로 스크롤 컨테이너.
3. **마일스톤 통합 타임라인**: 프로젝트당 1행 다행 SVG — 기존
   `MilestoneTimeline` 패턴(서버측 라벨 폭 어림) 확장, 프로젝트 구분은
   `projectColors` 재사용. 의존성 0 자체 SVG 관례 준수.

빈 상태·엣지 문구:

- 마일스톤 0건 프로젝트: "키워드 미설정 시 0건이 정상"임을 구분하는 빈 상태
  문구(키워드 유무로 문구 분기).
- SPI neutral(계획<5% 또는 경과<max(14일,15%)): 회색 '—' + 툴팁 사유.
- WBS 0건 프로젝트: 행은 표시하되 지표 전부 '—'.

i18n: `src/lib/i18n/dict/portfolio.ts` 신설(화면당 1파일 규칙) +
`dict/common.ts`의 `nav.*`에 ko/en 쌍 추가. CSS는 기존 토큰·공용 클래스만
사용(globals.css 무수정).

## 7. 에러 처리 (3원칙 준수)

- 프로젝트 목록 조회 실패: 화면 전체를 DegradedNotice 식으로 정직 표시 —
  빈 목록으로 위장 금지.
- 개별 프로젝트 로드 실패: 그 행만 `degraded: true`로 '확인 불가' 표시하고
  서버 로그를 남긴다(표시 = 로깅). 다른 프로젝트 행은 정상 렌더.
- 가드 판정 불가(getActorForView null): redirect — fail-closed.

## 8. 테스트

- `tests/domain/portfolio.test.ts` (vitest): buildPortfolio 정렬(신호 심각도 →
  편차), neutral·null 처리, PM 병기/0명, totals 카운트, degraded 행 처리,
  round1 규약 유지.
- 기존 정본 함수는 재사용만 하므로 재테스트하지 않는다.
- 화면 검증: 빌드·테스트로 잡히지 않는 UI 위험 파일 변경(Sidebar·HeaderChrome)
  포함 — Preview는 로그인 불가이므로 **배포 후 프로덕션 눈확인 + mark:good**
  계획을 명시한다.

## 9. 배포 절차

1. `ui/portfolio` 브랜치에서 구현, push → Preview(속도 방지턱 통과 목적).
2. main ff 머지 → Vercel 자동 배포 → `npm run smoke:prod`.
3. 슈퍼유저 계정으로 /portfolio 눈확인(신호등·SPI·타임라인·메뉴 노출·비슈퍼
   유저 redirect) → `npm run mark:good`.
