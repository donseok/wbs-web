# 대시보드 경영진/PMO 재설계 — 설계 스펙 (v2, 검증 반영)

- 작성일: 2026-07-08
- 대상: 프로젝트 대시보드 (`/p/[projectId]/dashboard`)
- 상태: 설계 확정 (사용자 리뷰 대기). v2 = 4-관점 적대적 검증 24건 반영.

## 1. 배경 & 목표

현재 대시보드는 `DashboardView.tsx`에 약 13개 정보 블록이 세로로 나열된 **운영형 대시보드**다. 팀 실무엔 풍부하지만 경영진/PMO가 "우리 잘 가고 있나?"를 3초 안에 읽기 어렵다.

**중요(현행 사실 정정)**: 상단 `PageHero`는 커밋 702a753 이후 **제목 한 줄만 렌더**한다. `page.tsx`가 넘기는 KPI 카드 5개(`heroKpis`)와 네비/`ReportButton`(`actions`)은 **렌더되지 않는 죽은 prop**이다. 즉 지금 경영진은 요약을 **아무것도** 못 본다. 이 재설계의 본질은 "중복 제거"가 아니라 **컴팩트 히어로가 없애 버린 경영진 요약을 복원**하는 것이다.

**목표**: 경영진/PMO가 한 화면에서 프로젝트 건강도를 즉시 파악하는 **레이어드 단일 대시보드**. 상단은 요약, 상세는 접힘. 기존 정보는 하나도 버리지 않는다.

## 2. 사용자 & 성공 기준

- **주 사용자**: 경영진(스티어링 위원회), PMO.
- **범위**: 단일 프로젝트(D-CUBE). 포트폴리오는 범위 밖.
- **성공 기준**:
  - 히어로에 **단일 종합 판정(overall verdict)** 하나가 지배적으로 보여 3초 내 "괜찮은가?"에 답한다. 그다음 보조 지표로 "왜"를 설명.
  - 진척·일정·리스크·마일스톤을 신호등(초록/노랑/빨강/**회색=판단보류**)으로 보조 판독.
  - 요약은 스크롤 없이 한 화면. 상세는 원할 때만 펼침(그룹별 기억).
  - 정보 손실 없음(기존 13블록 전부 보존).

## 3. 설계 개요 (B안 + 종합 판정)

위→아래:
1. **PageHero** — 제목만(현행 그대로). 주 네비게이션은 Sidebar/HeaderChrome(ProjectTabs)가 제공.
2. **경영진 요약 히어로 (ExecSummary)** — ①종합 판정 + 진척 게이지(좌), ②일정·③리스크·④마일스톤 신호등 타일 3개(우), 헤더에 **ReportButton** 배치(고아 해소·§9 보고 친화).
3. **공지 슬림바** — 게시중 공지 1건.
4. **핵심 시각 2개** — Phase별 진척 / 주의 필요(지연 Top).
5. **상세 아코디언 (DetailAccordion)** — 기본 접힘, 3그룹.

## 4. 정보 구조

### 4.1 히어로 (ExecSummary)
- **종합 판정(overall)**: 하위 신호 worst-of → 한 단어 + 색을 게이지 중앙(또는 헤드라인 칩)에 지배적으로. 이게 3초 판독의 주인공.
- **① 진척 게이지**: 큰 실적% + 편차 칩이 **1차 판독**, 링 채움 + 계획 눈금은 보조. (§7 시각 위계 참조)
- **② 일정**: 신호는 slip 밴드로 판정. 예상 종료일은 **"추정(참고용)"**로 부차 표기(헤드라인 아님).
- **③ 리스크**: 지연 건수(+마감임박).
- **④ 마일스톤**: 명칭·예정일·D-day. 미감지 시 회색.

각 지표는 색 + 아이콘 + 텍스트 라벨 병행(색각 접근성).

### 4.2 상세 아코디언 3그룹 (펼침 시)
- **① 진행 분석**: 상태 분포 · 가중치 분포
- **② 일정·리스크**: 마감 임박 · 이번 주 · 다음 주
- **③ 팀 & 산출물**: 팀별 작업량 · 산출물 현황 · 최근 완료 · 근태

## 5. 신호등 기준 (경계 연산자 명시)

`src/lib/domain/dashboard.ts` 상수로 조정 가능. 신호 타입 = `'green'|'amber'|'red'|'neutral'`(회색=판단보류/N-A).

| 지표 | 정의 | 🟢 | 🟡 | 🔴 | ⚪ 회색 |
|---|---|---|---|---|---|
| ① 진척 | 편차 v = 실적−계획(%p) | v ≥ −2 | −10 ≤ v < −2 | v < −10 | — |
| ② 일정 | slip = 예상종료−계획종료(일) | slip ≤ 3 | 3 < slip ≤ 14 | slip > 14 **또는 (종료일경과 && 미완료)** | 초기(§6.1 가드)·일정 미설정 |
| ③ 리스크 | 지연 건수 | 0 | 1~3 | ≥ 4 | — |
| ④ 마일스톤 | 다음 마일스톤 D-day | dday ≥ 15 이고 지연 마일스톤 없음 | 0 ≤ dday ≤ 14 | 예정일 경과·미완료 | 미감지 |
| overall | 하위 worst-of (red>amber>green; 회색 제외) | 모두 🟢 | 최소 하나 🟡 | 최소 하나 🔴 | 판정 불가 |

- **완료 예외**: overallActual ≥ 100 → ② 일정 🟢 "완료", slip 숨김(종료일 경과 무시).
- **③ 격상**: 최상위 가중 Phase가 지연이면(§6.3 `topWeightDelayed`) 리스크 한 단계 격상.

## 6. 신규 계산 로직 (`src/lib/domain/dashboard.ts`, 순수 함수)

기존 데이터로 계산 불가한 것만 신규. 순수 함수 + 단위 테스트. `buildExecSummary(items, {startDate, endDate, today})` — **holidays 파라미터 불필요**(plannedPct에 이미 반영됨, §6.1).

### 6.1 예상 종료일 & 일정 신호
- `SPI = overallActual / overallPlanned`. **기준 명시**: overallPlanned는 `plannedPct`(영업일, 휴일 반영)의 롤업이고 overallActual/Planned는 정수(반올림). 휴일은 이미 ComputedItem에 반영돼 있어 buildExecSummary에 holidays 불필요.
- `projectedDuration = totalDays / SPI` (`totalDays`는 달력일 = `diffDays`). 영업일 SPI × 달력 totalDays는 의도된 1/SPI 근사(SPI=1 ⇒ projectedEnd=plannedEnd).
- `projectedEnd = startDate + projectedDuration`; `slipDays = projectedEnd − plannedEnd`.
- **Clamp**: projectedDuration ≤ 약 3× plannedDuration(또는 SPI 하한)으로 상한 → actual이 극소일 때 수년짜리 날짜 방지.
- **조기 가드(회색)**: `overallPlanned < 5%` **또는** `경과일 < max(14일, totalDays의 15%)`이면 SPI 불안정 → 일정 신호 **회색("초기")**, 예상 종료 **숨김**. (초록 아님 — "판단보류"를 정직하게)
- **완료 가드**: overallActual ≥ 100 → 일정 🟢 "완료", slip=null(§5).
- start/end 미설정 → 일정 신호 회색, 타일 빈 상태.
- 예상 종료일은 헤드라인이 아니라 **"추정(참고용)"** 부차 표기(§4.1②).

### 6.2 마일스톤 자동감지
- 후보 = **리프** 중:
  - 이름이 키워드 목록에 **대소문자 무시 부분문자열** 매칭(모듈 상수: `착수보고/중간보고/보고회/마스터 플랜/BMT/최종 선정/승인/준공/Kick-off/킥오프` 등, 중복 정규화), **또는**
  - **단일일**(`plannedStart != null && plannedStart === plannedEnd`) 이면서 산출물 보유. (둘 다 null인 리프는 마일스톤 아님)
- 후보는 `plannedEnd != null`만 대상. 날짜 비교는 'YYYY-MM-DD' 사전식.
- **다음 마일스톤** = `plannedEnd ≥ today && status ≠ done` 중 `plannedEnd` 최솟값. 동점이면 `sortOrder` 오름차순.
- **지연 마일스톤** = `plannedEnd < today && status ≠ done` 존재 시 ④ 🔴 승격 + 해당 항목 노출.
- 키워드·이름은 WBS 도메인 데이터(한국어, UI 로케일 무관). 타일엔 원문 `item.name` 그대로(미번역).

### 6.3 신호등 판정 & 뷰모델
- 지표별 `signalOf`(순수) → `'green'|'amber'|'red'|'neutral'`. 진입점 `buildExecSummary`:
  ```
  {
    overall:  { signal, label },              // 하위 worst-of (red>amber>green; neutral 제외)
    progress: { actual, planned, variance, signal },
    schedule: { totalDays, elapsed, remaining, elapsedPct, projectedEnd|null, slipDays|null, signal },
    risk:     { delayed, dueSoon, topWeightDelayed, signal },
    milestone:{ name|null, date|null, dday|null, overdue, signal },
  }
  ```
- `risk.dueSoon`: 기존 predicate 그대로 재사용 — `status≠'done' && plannedEnd && plannedEnd≥today && diffDays(today,plannedEnd)≤7`. DashboardView 인라인 로직을 공용 헬퍼로 추출해 히어로/아코디언이 같은 값을 쓰게.
- `risk.topWeightDelayed`: **루트 Phase** 대상(가중치가 전역 비교 가능한 유일 레벨, `overallProgress`의 eff 규약 재사용). 모든 루트 가중치 null이면 `false`(격상 없음). 아니면 최상위 유효가중 Phase가 `status==='delayed'`일 때 `true`, 동점은 `sortOrder` 오름차순. `true`면 리스크 신호 한 단계 격상(green→amber→red).

### 6.4 종합 판정(overall)
- `overall.signal` = {progress, schedule, risk, milestone}.signal 중 worst(red>amber>green). neutral은 판정에서 제외(모두 neutral/green이면 green).
- 라벨(ko/en): 🟢 정상/On track · 🟡 주의/Caution · 🔴 위험/At risk.

## 7. 컴포넌트 구조 & RSC 경계

신규:
- `src/lib/domain/dashboard.ts` — §6 순수 로직. DB/네트워크 무관, 단위 테스트.
- `src/components/dashboard/ExecSummary.tsx` — 종합 판정 + 게이지 + 신호등 타일 3 + 공지 슬림바 + ReportButton. 서버 컴포넌트로 렌더 가능(상태 없음).
- `src/components/dashboard/ProgressGauge.tsx` — 도넛(실적 채움 + 계획 눈금). **SVG + aria-label로 수치 제공**. **시각 위계**: 큰 실적% + 편차 칩이 1차 판독, 링/눈금은 보조 — 정밀 판단이 링 각도에 의존하지 않게. (대안: 앱 공용 `ProgressBar`(실적+계획 눈금) 재사용도 허용 — §14)
- `src/components/dashboard/SignalTile.tsx` — 색+아이콘+라벨. 회색(neutral) 상태: '예정 마일스톤 없음' / '일정 미설정/초기'.
- `src/components/dashboard/DetailAccordion.tsx` — **thin `'use client'` 셸**. 그룹별 접기/펼치기 상태만 소유.

**RSC 경계(중요)**: `DashboardView`는 **async Server Component 유지** — 모든 블록 렌더 + `tr()`/`getServerLocale`는 서버에 둔다(`getServerLocale`는 서버 전용이라 client 전환 불가, async-client 안티패턴). 서버에서 렌더한 그룹 JSX를 `DetailAccordion`에 **props/children으로 전달**:
```
<DetailAccordion
  groups={[{ id:'analysis', titleNode, content:<서버 JSX/> }, …]}
  initialExpanded={initialExpanded} />
```
셸은 각 패널 안에 `{group.content}`만 렌더. 무거운 파생 계산(delayed/dueSoon/teamSummary…)은 서버에 유지.

재사용/이동: `SectionCard`·`ProgressBar`·`StatusPill`·`OwnerBadges`·`EmptyState`·`KpiCard`·`Skeleton` 그대로. 기존 13블록 렌더는 삭제 없이 **핵심 시각 2개 + 아코디언 3그룹**으로 재배치.

## 8. 기존 코드와의 관계 (변경 지점)

- **`page.tsx`**: `heroKpis`/`actions`는 렌더 안 되는 **죽은 prop → 정리**(중복 해소가 아니라 dead-code 제거). `KpiCard` import + `overallActual/Planned/variance/inProgress/doneCount/donePct` 계산 삭제. **`ReportButton`은 ExecSummary 헤더로 이전**(현재 고아 상태 — 유일 사용처였음). `PageHero`는 title-only 그대로.
- **`DashboardView.tsx`**: 상단에 `<ExecSummary>`, 블록 재배치, 상세를 `<DetailAccordion>`으로. Server Component 유지.
- **`loading.tsx`**: 스켈레톤 교체 — 게이지 자리표시 + 신호등 타일 3 + 공지 슬림바 1줄 + 핵심 시각 2단(CardSkeleton×2). 아코디언 접힘이라 그룹 스켈레톤 없음. 기존 4-KPI 레일 제거(로딩 플래시 방지).
- **`src/lib/domain/types.ts`**: `UiPrefs`에 옵션 키 `dashSections?`(펼친 그룹 id 배열 등) 추가. `prefs`는 JSONB 블롭이라 **DB 마이그레이션 불필요**.
- **`page.tsx`(prefs 읽기)**: 기존 `getUiPrefs`로 SSR에서 읽어 `initialExpanded`로 전달(하이드레이션 불일치 방지).
- **i18n(`dict/dashboard.ts`)**: 신규 키(종합 판정 라벨, 신호 상태, 예상 종료/추정, 마일스톤/회색 라벨, 아코디언 그룹명) ko/en 함께 추가(패리티는 컴파일러 강제). **미사용화 키 삭제**: `dash.kpi.actualSub/planned/inProgress/done`, `dash.ofTotalPrefix`, `dash.pctDoneSuffix`, `dash.needsReview`, `dash.normalRange`. **유지**: `dash.kpi.delayed`, `dash.vsPlan`. 신호 상태는 `common.ts`의 `status.*` 재사용 가능.
- 데이터 페칭·RPC·**DB 스키마 변경 없음**.

## 9. 인터랙션 · 접근성 · 반응형

- **기본 접힘**. 아코디언 펼침 상태는 **기존 UiPrefs 서버 동기화 패턴(`queueUiPref`→`saveUiPrefs`)으로 전역 기억**(3그룹은 구조적이라 전역이 적절). `getUiPrefs`로 SSR에서 읽어 `initialExpanded` 전달 → 하이드레이션 불일치 방지. (per-item WBS collapse용 `queueWbsCollapse`나 미존재 client-only 패턴은 사용 안 함.)
- **접근성**: 신호는 색 단독 금지 — 색+아이콘+텍스트. 회색=판단보류. 게이지 SVG+aria-label 수치.
- **반응형**: ExecSummary 게이지 | 타일 그룹은 `lg:`에서 분할(아래로 스택). 신호등 3타일 `grid-cols-3`(좁으면 스택). 핵심 시각 쌍은 **`xl:grid-cols-2`**(기존 DashboardView 카드 리듬과 일치, `lg:` 아님). 320px에서 가로 스크롤 없음.
- **보고 친화**: 아코디언 펼쳐 캡처/인쇄하면 주간보고로 사용. ReportButton은 히어로 헤더에 상시 노출.

## 10. 데이터 소스
- **재사용**: `overallProgress`, 상태 분포, 팀별 작업량, 지연, 마감임박, Phase 진척, 가중치, 최근완료, 이번/다음주, 산출물, 근태, 공지.
- **신규**: 예상 종료(SPI)·마일스톤 자동감지·신호등/종합 판정 — 전부 `dashboard.ts` 순수 함수.

## 11. 엣지/빈 상태
- 항목 0개: 기존 `EmptyState`.
- `overallPlanned<5%`/경과<가드: 일정 **회색 "초기"**, 예상 종료 숨김.
- overallActual≥100 + 종료일 경과: 일정 🟢 "완료", slip 숨김.
- 지연 0: 리스크 🟢.
- 마일스톤 미감지: ④ 회색 "예정 마일스톤 없음". 날짜 null 리프는 감지 제외.
- start/end 미설정: 일정 회색/빈 상태.
- 게시중 공지 0건: 슬림바 숨김(또는 '공지 없음'), 나머지는 '전체 보기'로 접근(정보 손실 아님). 표시 1건 = `sortAnnouncements(published)[0]`(고정 우선→최신).

## 12. 테스트 (Vitest, `tests/domain/dashboard.test.ts`)
- 신호 경계값: 진척 −2/−10, 일정 slip 3/14, 리스크 3/4, 마일스톤 dday 14/15.
- SPI 예상종료 + 조기 가드(§6.1) + clamp.
- 마일스톤: 키워드/단일일 감지, 다음 선택, 동점 tie-break, **날짜 null 리프 미감지**.
- 신호 회색: 마일스톤 미감지, 일정 미설정, 조기.
- 완료-종료일경과 → 일정 🟢/완료, slip null.
- overall worst-of: all-green→green, any-red→red, 충돌(진척🟢+일정🔴)→red.
- ③ 격상: 최상위 가중 Phase 지연 → 한 단계; all-null 가중치 → 격상 없음.

## 13. 범위 밖 (YAGNI)
- 포트폴리오, `is_milestone` 스키마 플래그, 예산/비용 KPI, 임계값 설정 UI.

## 14. 미해결 / 결정 필요
- §5 컷 기준 값이 운영 감각과 맞는지(초기 몇 주 관찰 후 조정).
- 게이지 유지 vs 앱 공용 `ProgressBar`(실적 채움 + 계획 눈금) 재사용(§7) — 권장: 게이지 유지하되 위계 명시.
