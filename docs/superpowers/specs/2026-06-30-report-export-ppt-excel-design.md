# 현황 보고서 PPT/Excel 다운로드 — 설계 문서

- **날짜:** 2026-06-30
- **상태:** 승인됨 (구현 진행)
- **브랜치:** `feat/report-export-ppt-excel`

## 1. 목적

현재 D'Flow 대시보드의 **현황 보고서**(`ReportModal`)는 `window.print()` 기반 **인쇄/PDF**만 지원한다.
이 보고서 내용을 **Excel(.xlsx)** 과 **PowerPoint(.pptx)** 파일로도 내려받을 수 있게 한다.

### 확정된 결정 (사용자 승인)

| 항목 | 결정 |
|------|------|
| 내용 범위 | **화면 보고서 그대로** — KPI 4종 + Phase별 진척 + 지연 작업 목록 + 팀별 진척 |
| PPT 스타일 | **D'Flow 브랜드 멀티슬라이드 덱** (표지 + 요약 + Phase + 지연 + 팀별) |
| 버튼 위치 | **보고서 모달 푸터** (`[Excel] [PPT] [인쇄/PDF] [닫기]`) |
| 생성 방식 | **서버 사이드 API 라우트** (기존 `/api/export` 패턴) |

## 2. 현재 구조 (배경)

- `src/components/report/ReportButton.tsx` — 대시보드 히어로 버튼 → 모달 오픈.
- `src/components/report/ReportModal.tsx` — 보고서 본문. **파생값을 인라인 계산**:
  - `overallProgress(roots)` → 전체 실적/계획
  - `collectLeaves(items)` → 지연 작업 필터
  - 팀별 집계(`teamStat`), Phase별 편차 등.
- `src/app/(app)/p/[projectId]/dashboard/page.tsx` — `getComputedWbs` 등으로 데이터를 모아 `ReportButton`에 전달. **projectId 보유**.
- 기존 export: `src/app/api/export/route.ts` + `src/lib/excel/export.ts`(`xlsx`) — **원시 WBS** 내보내기(보고서 아님). 유지.
- 의존성: `xlsx`만 존재. **PPT 라이브러리 없음.**

## 3. 아키텍처

```
ReportModal (화면)  ─┐
                     ├─►  buildReportModel(items, project, today)  → ReportModel (직렬화 가능)
/api/report route  ─┘                                                   │
                                            ┌──────────────────────────┼──────────────────────────┐
                                     buildReportWorkbook(model)   buildReportDeck(model)    (화면 렌더)
                                       → exceljs → .xlsx           → pptxgenjs → .pptx
```

**핵심 원칙:** 화면·Excel·PPT가 **단일 모델(`buildReportModel`)** 을 공유 → 항상 1:1 일치.
(현 코드의 `overallProgress` 단일출처 철학을 보고서 전체로 확장.)

## 4. 컴포넌트별 명세

### 4.1 `src/lib/report/model.ts` (신규, 순수)

```ts
export interface ReportModel {
  meta: {
    projectName: string
    description: string | null
    today: string            // 'YYYY-MM-DD'
    startDate: string | null
    endDate: string | null
    totalLeaves: number
  }
  kpi: {
    actual: number           // 전체 실적 %
    planned: number          // 전체 계획 %
    variance: number         // actual - planned (%p)
    delayedCount: number
  }
  phases: Array<{
    name: string
    plannedPct: number
    actualPct: number        // rolledActualPct
    variance: number         // actual - planned
    status: Status
  }>
  delayed: Array<{
    name: string
    owners: { team: TeamCode; kind: OwnerKind }[]
    plannedEnd: string | null
    actualPct: number
  }>
  teams: Array<{
    team: TeamCode
    count: number
    pct: number | null       // 담당 작업 없으면 null
  }>
}

export function buildReportModel(
  items: ComputedItem[],
  project: { name: string; description?: string | null; start_date?: string | null; end_date?: string | null },
  today: string,
): ReportModel
```

- 내부적으로 `overallProgress`, `collectLeaves`, 기존 status 헬퍼 재사용.
- `ReportModal`은 이 함수가 만든 모델을 그대로 렌더(인라인 계산 제거).

### 4.2 `src/lib/report/excel.ts` (신규, exceljs)

`buildReportWorkbook(model: ReportModel): Promise<ArrayBuffer>`
- **시트 1 "현황요약"**: 제목 블록(프로젝트명·기간·생성일) → KPI 4칸 그리드 → Phase별 표 → 팀별 표.
- **시트 2 "지연작업"**: 지연 작업 표(작업명/담당/종료일/실적). 없으면 "지연 작업 없음" 행.
- 스타일: 브랜드 헤더 배경(`#0f766e`, 흰 글씨), 테두리, 숫자서식(`0"%"`), 편차 조건부 글자색(양수 `#138a67`/음수 `#cb4b5f`), 컬럼 폭, 제목 셀 병합.
- **exceljs 채택 이유**: 기존 `xlsx`(SheetJS 무료판)는 셀 채움/폰트/병합 스타일 불가. 스타일 Excel을 위해 신규 의존성 추가. (기존 WBS export의 `xlsx`는 변경 없음.)

### 4.3 `src/lib/report/pptx.ts` (신규, pptxgenjs)

`buildReportDeck(model: ReportModel): Promise<Uint8Array>` (16:9)
- **S1 표지** — dark 그라데이션(`#1c2028→#14181f→#0d1014`) 배경, "D'Flow" eyebrow, 프로젝트명(대), "현황 보고서 · Status Report", 생성일/기간/전체 작업 수.
- **S2 요약 KPI** — 4 타일(전체 실적/계획/편차/지연), 실적 vs 계획 비교 막대. 편차 양/음에 따라 색.
- **S3 Phase별 진척** — 표(Phase/계획/실적/편차/상태, 상태 컬러칩) + 실적·계획 막대차트.
- **S4 지연 작업** — 표(작업명/담당/종료일/실적). 없으면 "지연 작업 없음" 긍정 메시지(녹색).
- **S5 팀별 진척** — 팀별 가로 막대(팀 컬러: PMO `#4f46e5`/DT `#0276a8`/ERP `#7c3aed`/MES `#a65b00`) + 작업수/%.
- 모든 슬라이드 푸터: `D'Flow · {프로젝트명} · {생성일}` + 페이지 번호.

### 4.4 `src/app/api/report/route.ts` (신규)

- `GET ?projectId=<uuid>&format=xlsx|pptx`
- `export const runtime = 'nodejs'` (pptxgenjs/exceljs는 Node 전용).
- `/api/export`와 동일하게 **읽기 전용**(멤버십 게이트 없음; 데이터 페치는 RLS 적용 → 권한 자동 반영). 데모 모드 동작.
- 흐름: `getComputedWbs(projectId)` + `listProjects()` → `buildReportModel` → format 분기 → 버퍼 반환.
- 응답 헤더: 적절한 `Content-Type`, `Content-Disposition: attachment; filename*=UTF-8''현황보고서_{프로젝트명}_{날짜}.{ext}`, `Cache-Control: no-store`.
- 잘못된 format / projectId 누락 → 400.

### 4.5 UI 배선

- `ReportButton`/`ReportModal`에 `projectId: string` prop 추가. 대시보드 페이지에서 `projectId` 전달.
- 모달 푸터(`.no-print`): `[Excel 다운로드] [PPT 다운로드]`(=`<a href="/api/report?...&format=..." download>` 버튼 스타일) + 기존 `[인쇄/PDF]` + `[닫기]`.
- 다운로드 링크는 같은 탭 네비게이션 방지를 위해 일반 `<a download>` 사용(파일 응답이라 페이지 이동 없음).

## 5. 테스트 전략

- `tests/report/model.test.ts` — `buildReportModel` 결정성: KPI 편차, 지연 집계, Phase 편차/상태, 팀별 count/pct, 빈 WBS 처리.
- `tests/report/exporters.test.ts` — 스모크:
  - `buildReportWorkbook` → exceljs로 재파싱, 시트 2개, 핵심 셀 값/제목 검증, 버퍼 길이 > 0.
  - `buildReportDeck` → 버퍼(Uint8Array) 길이 > 0, PPTX zip 시그니처(`PK`) 확인. (가능하면 슬라이드 수 검증.)
- 엣지: 빈 WBS, 지연 0건, 팀 담당 0건, description/기간 null.

## 6. 신규 의존성

| 패키지 | 용도 | 로드 위치 |
|--------|------|----------|
| `pptxgenjs` | PPT 생성 | 서버(라우트)만 |
| `exceljs` | 스타일 Excel 생성 | 서버(라우트)만 |

클라이언트 번들 영향 없음(API 라우트에서만 import).

## 7. 변경/신규 파일 요약

**신규:** `src/lib/report/model.ts`, `src/lib/report/excel.ts`, `src/lib/report/pptx.ts`, `src/app/api/report/route.ts`, `tests/report/model.test.ts`, `tests/report/exporters.test.ts`
**수정:** `src/components/report/ReportModal.tsx`(모델 사용 + 푸터 버튼), `src/components/report/ReportButton.tsx`(projectId prop), `src/app/(app)/p/[projectId]/dashboard/page.tsx`(projectId 전달), `package.json`

## 8. 비목표 (YAGNI)

- 원시 WBS export 변경(그대로 유지).
- 진척 추세 차트/전체 WBS 트리/근태/멤버 — 이번 범위 아님("화면 보고서 그대로" 선택).
- PDF 직접 생성(기존 인쇄/PDF 유지).
- 보고서 커스터마이즈 UI(섹션 토글 등).
