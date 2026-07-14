# 주간업무 시트 — 구분(카테고리) 재정의 + PPT 연동

- 날짜: 2026-07-14
- 상태: 설계 승인됨
- 선행 스펙: `2026-07-10-weekly-report-sheet-design.md`(시트·PPT 경로), `2026-07-10-weekly-sheet-combo-seed-design.md`(구 콤보·시드 체계 — **이 문서로 대체됨**)

## 1. 배경과 문제

현행 주간업무 시트의 분류 체계는 **시스템 축**(공통 / ERP / MES)을 상위 구분으로, **모듈 축**(SD/LE, MD/PP, MM, FI/TR, CO, 품질, APS, 조업 및 표준화, 가공, 설비 Level2, 물류)을 하위로 두는 2단 구조다.

실제 D-CUBE 주간보고는 **업무영역 축** 하나로 보고한다. 사내 양식의 구분 목록은 다음 9개다.

> 영업 · 품질 · 생산계획 · 조업 및 표준화 · Luxteel 가공 · 설비 및 Level2 · 물류 · 관리회계 · 구매

시트가 보고 양식과 다른 축으로 쪼개져 있어, 작성자가 매주 머릿속에서 축을 변환해 옮겨 적어야 한다. 시트를 보고 양식과 같은 축으로 맞춘다.

## 2. 범위

**바꾼다**
- 구분 분류 체계(도메인 상수, 시드 스켈레톤)
- 시트 표 구조: 모듈 열 제거, 구분 1단
- 이월(carry-over) 로직: 레거시 구분 → 신규 구분 정규화
- PPT 그룹 라벨(헤드라인·이슈 라벨)

**안 바꾼다**
- 셀 편집 전부: 멀티셀 선택·복사/붙여넣기·채우기 드래그·Undo/Redo·IME·Realtime 동시편집·디바운스 저장·배치 저장
- 제목 편집, 주차 네비게이션, 프레즌스
- PPT 렌더러(`fillWeeklyTemplate`), 페이지 분할(`paginateGroups`), 연속 슬라이드, 사내 `.pptx` 템플릿
- DB 스키마 (마이그레이션 없음)

## 3. 카테고리 정의

`src/lib/domain/weeklySheet.ts`

```ts
export const WEEKLY_SECTIONS = [
  '공통', '영업', '품질', '생산계획', '조업 및 표준화',
  'Luxteel 가공', '설비 및 Level2', '물류', '관리회계', '구매',
] as const
```

- `WEEKLY_MODULES`, `moduleOptions()` 삭제.
- `defaultWeeklyRows()` → 위 순서 그대로 **10행**(sortOrder 1..10), 네 내용 셀은 빈 문자열, `module: ''`.
- `WeeklySheetRow.module` 필드와 DB 컬럼 `weekly_report_rows.module`은 **유지**한다. 과거 시트의 `SD/LE`·`MD/PP` 값을 보존해야 하고, 컬럼은 `text not null default ''`라 새 행에 빈 문자열을 넣으면 그만이다.
- 따라서 **SQL 마이그레이션 파일은 만들지 않는다.** section/module 모두 DB 제약이 없는 자유 텍스트다.

## 4. 시트 화면

`src/components/weekly/WeeklySheetView.tsx`

### 4.1 표 구조

열은 7개(구분·모듈·금주내용·금주이슈·차주내용·차주이슈·행액션)에서 **5개**로 줄인다.

| 열 | 폭 |
|---|---|
| 구분 | 10% |
| 금주실적 내용 | 27% |
| 금주 이슈 및 주요 이벤트 | 19% |
| 차주계획 내용 | 26% |
| 차주 이슈 및 주요 이벤트 | 18% |

구분 폭은 최장 라벨(`설비 및 Level2`, `조업 및 표준화`)이 두 줄로 깨지지 않을 만큼 준다. 2단 헤더(`구분` rowSpan=2 / `금주실적(범위)` colSpan=2 / `차주계획(범위)` colSpan=2)는 유지한다.

### 4.2 구분 셀은 읽기 전용

10행이 고정이므로 구분명을 바꿀 이유가 없다. 콤보박스를 남기면 "영업을 실수로 구매로 바꿨는데 행 추가 UI가 없어 되돌릴 수 없는" 함정이 생긴다. 구분 셀은 라벨만 렌더한다.

과거 시트를 열었을 때 정보 손실이 없도록, `module`이 비어 있지 않고 `section`과 다르면 구분 칸에 2줄로 병기한다.

```
┌──────────┐
│ ERP      │   ← section (기본 글씨)
│ SD/LE    │   ← module (작은 글씨, muted)
└──────────┘
```

연속 동일 section의 rowSpan 병합(`spans`)은 그대로 둔다 — 신규 시트는 모든 구분이 1행이라 rowSpan=1로 수렴하고, 레거시 시트에서만 병합이 보인다.

### 4.3 제거되는 것

- `NameCombo`(구분·모듈 콤보박스), `AddRowForm`, 행 액션 열(위/아래/삭제 버튼)
- 그에 따라 데드 코드가 되는 서버 액션 5개: `renameWeeklySection`, `renameWeeklyModule`, `addWeeklyRow`, `deleteWeeklyRow`, `moveWeeklyRow` (`src/app/actions/weekly.ts`)
- 관련 상수: `NAME_MAX`, `RENAME_MAX_ROWS`

셀 저장 경로(`saveWeeklyCell`, `saveWeeklyCells`), 문서 생성(`createWeeklyReport`), 제목(`saveWeeklyTitle`)은 그대로다.

## 5. 이월(carry-over) 정규화

**이것이 놓치면 조용히 깨지는 지점이다.** 현행 `carryOverRows(prev)`는 이전 주차의 행 구성을 1:1 복제한다. 그대로 두면 레거시 12행 시트(7월 2주차)에서 이월한 다음 주차가 다시 `ERP/SD/LE` 구조로 생성돼 새 체계가 무너진다.

새 계약: **이월 결과는 항상 표준 10행이다.**

```ts
carryOverRows(prev): NewWeeklyRow[]
```

1. `defaultWeeklyRows()`로 표준 10행 프레임을 만든다.
2. `prev`를 sortOrder 순으로 훑으며 각 행을 `mapLegacySection(section, module)`으로 신규 구분에 매핑한다.
3. 매핑된 구분 행의 `thisContent` ← `prev.nextContent`, `thisIssue` ← `prev.nextIssue`. 같은 구분으로 둘 이상이 모이면 `\n`으로 이어붙인다(빈 값은 건너뛴다).
4. `nextContent`/`nextIssue`는 비운다.

### 5.1 매핑표

`mapLegacySection(section, module)` — 신규 구분이면 항등, 레거시면 아래 표, 어디에도 없으면 `'공통'`.

| 이전 구분 / 모듈 | 신규 구분 |
|---|---|
| 공통 / 공통 | 공통 |
| ERP / SD/LE | 영업 |
| ERP / MD/PP | 생산계획 |
| MES / APS | 생산계획 |
| ERP / MM | 구매 |
| ERP / FI/TR | 관리회계 |
| ERP / CO | 관리회계 |
| MES / 품질 | 품질 |
| MES / 조업 및 표준화 | 조업 및 표준화 |
| MES / 가공 | Luxteel 가공 |
| MES / 설비 Level2 | 설비 및 Level2 |
| MES / 물류 | 물류 |
| 그 외 (자유 입력) | 공통 |

매칭은 `module` 우선(모듈명이 더 구체적), 없으면 `section`으로 본다. 신규 체계끼리의 이월에서는 `section`이 이미 신규 구분이라 항등 매핑되고, 결과적으로 기존과 같은 1:1 이월로 동작한다.

## 6. PPT

`src/lib/report/sheetNarrative.ts` 두 함수만 고친다. 렌더러·템플릿·페이지 분할은 손대지 않는다.

```ts
// 신규 행:  '영업'
// 레거시 행: 'ERP · SD/LE'
const headline = (r) => {
  const sec = r.section.trim(), mod = r.module.trim()
  if (!sec) return mod || '기타'
  return mod && mod !== sec ? `${sec} · ${mod}` : sec
}

const issueLabel = headline   // 이슈 줄 앞머리 `[영업] …`
```

- 내용이 빈 구분은 `groupsOf`의 `filter(r => r[field].trim() !== '')`가 이미 걸러낸다. 10행 중 3개만 채우면 PPT엔 3개만 나온다.
- 이슈 3건 / 이벤트 4건 상한(`ISSUE_CAP`, `EVENT_CAP`)과 `외 N건` 표기는 유지한다. 구분이 10개로 늘어 이슈가 많아질 수 있지만, 상한을 올리면 공식 양식의 이슈 행 높이(1195036 EMU 고정)를 넘긴다.
- `주간보고상세 (PPT)` 버튼과 `/api/report?source=sheet` 경로는 그대로다.

## 7. 기존 데이터

**DB를 건드리지 않는다.** 과거 주차 시트는 저장된 section/module 그대로 남고, 화면에서도 §4.2 병기 방식으로 그대로 읽힌다. 새 체계는 새로 만드는 주차 문서(`createWeeklyReport`)부터 적용되고, 레거시 시트에서 이월할 때는 §5 매핑으로 정규화된다.

D-CUBE 운영 데이터에 쓰기를 가하지 않으므로 롤백은 코드 되돌리기만으로 끝난다.

## 8. 테스트

`tests/domain/weeklySheet.test.ts`
- `defaultWeeklyRows()` — 10행, sortOrder 1..10 연속, 구분 순서가 `WEEKLY_SECTIONS`와 일치, module은 전부 `''`
- `mapLegacySection()` — 매핑표 전 항목 + 미지의 값 → `'공통'`
- `carryOverRows()` — (a) 레거시 12행 → 표준 10행, FI/TR·CO의 차주계획이 `관리회계` 한 셀에 줄바꿈으로 합쳐짐, (b) 신규 10행 → 1:1 이월, (c) `nextContent`/`nextIssue`는 비워짐
- 삭제: `moduleOptions()` 테스트

`tests/report/sheetNarrative.test.ts` (신설)
- `headline` — 신규 행은 구분명 단독, 레거시 행은 `구분 · 모듈`, section 빈 행은 module 폴백
- 빈 셀 구분이 그룹에서 생략되는지

`tests/report/templateFill.test.ts` — 변경 없이 통과해야 한다(렌더러 미변경의 회귀 가드).

## 9. 검증

`npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` 전부 통과. 런타임은 `/verify` 스킬 절차(브라우저 대신 빌드·테스트·curl)를 따른다.
