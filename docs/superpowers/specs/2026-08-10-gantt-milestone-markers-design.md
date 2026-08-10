# 간트 마일스톤 기준선 — 설계

날짜: 2026-08-10
상태: 승인됨 (사용자 승인, 세로 기준선 형태 선택)

## 배경과 목표

대시보드에는 마일스톤 타임라인(`MilestoneTimeline`)이 있지만 간트차트에는 이정표가 보이지 않는다.
간트 타임라인 위에 마일스톤 날짜마다 세로 기준선을 그려, 스크롤 중에도 "지금 어느 이정표
사이를 보고 있는지" 방향을 잡을 수 있게 한다.

**함께 검토했던 Zoom(시간축 확대) 기능은 사용자 결정으로 이번 범위에서 제외한다.**
(참고: 축소 토글은 과거 9147c0e에서 '저사용'으로 제거된 이력이 있다.)

## 결정 사항

| 결정 | 내용 | 근거 |
|---|---|---|
| 마커 형태 | 세로 기준선 + 상단 라벨 칩 (사용자 선택) | '오늘' 선 패턴 재활용, 구현 최소 |
| 데이터 | `milestoneTimeline()` 도메인 함수 재사용 | 대시보드와 판정 단일 출처 |
| 빈 키워드 | 아무것도 그리지 않음 (폴백 금지) | 설정 부재를 드러내는 기존 계약 유지 |
| 토글 저장 | 세션 상태만 (저장 안 함, 기본 켜짐) | 열 숨김(planningColsHidden) 선례 |
| Zoom | 제외 | 사용자 결정 (2026-08-10) |

## 데이터 흐름

신규 페치·마이그레이션 없음.

1. `src/app/(app)/p/[projectId]/wbs/page.tsx` — 이미 호출 중인 `getProjectConfig(projectId)`의
   `milestoneKeywords`를 `WbsGanttSheet`에 prop으로 추가 전달한다.
2. `WbsGanttSheet` 내부 — `milestoneTimeline(items, today, milestoneKeywords)`
   (`src/lib/domain/dashboard.ts:224`, 순수 함수)를 useMemo로 호출한다.
   - `items`: 컴포넌트가 이미 보유한 ComputedItem 트리
   - `today`: 간트가 이미 쓰는 값(공정율 기준일 base_date 기반) 재사용 →
     완료/지연/예정 판정이 대시보드와 자동 일치
3. 키워드가 빈 프로젝트는 대시보드와 동일하게 마커 0건 — 의도된 계약이며 폴백 키워드를 넣지 않는다.

## 렌더링

'오늘' 세로선 오버레이(`WbsGanttSheet.tsx:1321` 부근)의 패턴을 복제한다.

- 오버레이 컨테이너: `pointer-events-none absolute` — `left: LEFT_W`, `top: var(--wbs-head-h)`,
  `height: rowsH`. **rowsH·LEFT_W 기존 변수를 반드시 재사용한다** (하드코딩 시 과거 오늘선
  끊김 버그 재발).
- 마일스톤 날짜마다: `x = xOf(date) + dayPx/2` 위치에 **점선** 세로선 + 상단 라벨 칩(이름 + D-day).
- 색: 대시보드 3색 그대로 — 완료 `done`(초록) · 지연 `delayed`(적색) · 예정 `brand`(청록).
  Tailwind 토큰 유틸이라 다크모드 자동 대응.
- 오늘선과 구분: 마일스톤은 점선, 오늘선은 기존 실선 유지. z-index는 오늘선(z-30) 바로 아래
  (의존성 SVG z-20과 오늘선 사이) — 겹치면 오늘선이 이긴다.
- 라벨 겹침 완화: 위/아래 2단 교차 배치(대시보드 i%2 선례) + 말줄임 + `title` 툴팁(전체 이름·날짜).
- 같은 날짜에 마일스톤 여러 개면 선은 1개, 칩은 "이름 외 N"으로 병합.
- 칩은 클릭 없음(pointer-events-none 유지) — 행 이동 연결은 추후 확장.

## 토글과 범례

- 툴바에 Flag 아이콘 토글 — 의존선 토글(`showDependencyLinks`)과 같은 패턴
  (`btn btn-ghost`, 활성 시 `border-brand-ring bg-brand-weak text-brand`, `aria-pressed`).
- 기본 켜짐, useState만(저장 안 함).
- 범례 영역에 '이정표' 항목 추가 (3색 안내).
- i18n: `src/lib/i18n/dict/wbs.ts`에 토글 라벨·범례 키 추가 (ko/en).

## 제약 (CSS 안전망)

상태 변형 display 유틸(`group-hover:flex` 등) 금지 — unlayered 안전망에 져서 조용히 죽는다.
표시/숨김은 JSX 조건부 렌더링으로만 처리한다. `globals.css`는 건드리지 않는다.

## 테스트

- 판정·정렬은 이미 테스트된 `milestoneTimeline` 재사용 — 신규 도메인 로직 없음.
- 신규 순수 로직은 "같은 날짜 병합 + 2단 교차 배치 인덱스"뿐 — 이를 도메인 순수 함수로 분리해
  vitest 단위 테스트를 단다.

## 배포

- `WbsGanttSheet.tsx`는 UI 위험 파일 목록에 없고 `globals.css` 무접촉 → main 직행 가능.
- 코드만 담은 커밋 (마이그레이션 없음 — G1 무관).
- push 후 `npm run smoke:prod`, 실화면 확인 뒤 `npm run mark:good`.

## 이번에 안 하는 것

- Zoom(시간축 배율 변경) — 사용자 결정으로 제외
- 마커 클릭 → 행 이동/포커스
- 실적 완료일 마커 (plannedEnd 계획 시점만 존재, 실적 날짜 데이터 없음)
- 축소 배율(16px 미만) 대응
