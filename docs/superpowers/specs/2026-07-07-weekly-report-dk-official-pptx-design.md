# 주간보고 PPT — 동국씨엠 공식 양식 재현 — 설계 문서

- **날짜:** 2026-07-07
- **상태:** 설계 (승인 대기)
- **참조 원본:** `docs/26.07.02. D-Cube 주간보고_부산운영팀_1_2026-07-07_이돈석.pptx`

## 1. 목적

앱의 주간보고 PPT 생성기(`buildReportDeck` in `src/lib/report/pptx.ts`)의 출력을,
동국씨엠 공식 주간보고 양식(참조 원본)과 **디자인·글꼴·색·크기 동일하게** 재현한다.
내용도 참조 양식(표지 + 「전주/금주 주요활동」서술형 본문 + 이슈·주요이벤트)을 그대로 따르고,
앱의 WBS 데이터(`WeeklyReportModel`)를 각 칸에 자동으로 채운다.

### 확정된 결정 (사용자 승인)

| 항목 | 결정 |
|------|------|
| 구성 방식 | **참조 양식 그대로 재현** — 표지 + 본문 2장, 서술형 활동 표 |
| 주차 프레이밍 | **전주 \| 금주** (회고형 — 지난주 한 일 / 이번주 한 일) |
| 구현 접근 | **A. pptxgenjs 네이티브** 재현 + DK 로고/워터마크 PNG 재사용 |
| 기존 덱 처리 | **교체** — 라우트를 새 생성기로 재배선, 구 네이비 덱 제거. Excel 출력은 유지 |
| 데이터 범위 | **참조만큼만** — 근태·상세KPI·WBS 트리는 PPT에서 제외(Excel엔 유지). 회의→주요이벤트, 이슈→이슈사항 |

## 2. 참조 원본 분석 (추출 스펙)

참조 파일은 **think-cell**(PPT 애드인)로 제작됐고 표/차트는 OLE 임베드 객체다.
think-cell 객체 자체는 재현 불가하므로, **동국 네이비 테마 네이티브 도형으로 육안상 동일하게** 재현한다.
아래 좌표는 참조의 슬라이드 레이아웃(`slideLayout11`=표지, `slideLayout10`=내지)에서 추출한 값이다.

### 2.1 색상 (`theme1.xml` clrScheme "동국제강")

- **DONGKUK BLUE** `#002452` (dk2/tx2) — 제목·헤더·불릿
- **DONGKUK RED** `#C51F2A` (accent4) — 상단 룰 그라데이션
- 회색 계열: 구분선 `#A6A6A6`(bg1 65%), 푸터/페이지 `#B6B6B6`(lt2/bg2)
- → 현재 `dkbrand.ts`의 `PN.navy`/`PN.red`와 **이미 일치**. 회색 토큰만 보강.

### 2.2 글꼴 (`theme1.xml` fontScheme "동국제강")

| 용도 | 글꼴 | 크기 |
|------|------|------|
| 표지 제목 | **본고딕 Bold** | 32pt |
| 표지 부제 | **본고딕 Medium** | 14pt |
| 내지 헤더 제목 | **본고딕 Medium** | 19pt |
| 본문 불릿 L1 (▐) | **본고딕 Medium** | 16pt |
| 본문 불릿 L3 (‒) | **본고딕 Normal** | 12pt |
| 푸터·페이지번호 | **본고딕 Normal** | 8pt |

- `fontFace`는 위 이름을 **문자 그대로** 지정("본고딕 Bold" 등). 미설치 시 PowerPoint가 대체(참조 제작 환경엔 설치되어 있음).
- 현재 `pptx.ts`의 `FONT = 'Malgun Gothic'` → **본고딕 계열로 교체**.

### 2.3 슬라이드 크기

- **A4 가로 = 10.833″ × 7.5″** (참조: cx 9906000 × cy 6858000 EMU, type="A4")
- 현재 16:9(10×5.625) → **A4로 교체**. `defineLayout({ name:'DK_A4', width:10.833, height:7.5 })`

### 2.4 표지 배치 (좌표: inch, 참조 `slideLayout11` 그대로)

| 요소 | x, y | w × h | 스타일 |
|------|------|-------|--------|
| 상단 룰 | 0, 0 | 10.833 × 0.039 | red→navy 가로 그라데이션(0%=red, 38%~=navy) |
| 제목 | 0.484, 2.489 | 5.903 × 1.046 | 본고딕 Bold 32pt, navy, 하단정렬, 자간 -0.5 |
| 부제 | 0.484, 4.017 | 5.865 × 0.272 | 본고딕 Medium 14pt |
| 워터마크(DK) | 8.251, 2.684 | 2.583 × 3.570 | `dk-watermark.png` (image3.png) |
| 하단 로고(동국씨엠) | 4.896, 7.079 | 1.041 × 0.218 | `dk-logo.png` (image2.png), 하단중앙 |

- 배경: 흰색.
- red→navy 그라데이션은 pptxgenjs 도형 gradient 미지원 → **2개 사각형으로 근사**(red 0–≈4.1″, navy 나머지) 또는 소형 그라데이션 PNG.

### 2.5 내지 크롬 (좌표: inch, 참조 `slideLayout10` 그대로)

| 요소 | x, y | w × h | 스타일 |
|------|------|-------|--------|
| 헤더 제목 | 0.298, 0.187 | 6.751 × 0.404 | 본고딕 Medium 19pt, navy — `{프로젝트명} 주간보고` |
| 구분선 | 0.295, 0.591 | 10.239 × 0 | 가로선, `#A6A6A6`, 0.5pt |
| 본문 영역 | 0.295, 0.65~ | 10.239 × ~6.4 | (아래 §3 본문 배치) |
| 푸터 로고 | 0.299, 7.214 | 0.828 × 0.174 | `dk-logo.png` (좌하단) |
| 푸터 텍스트 | 8.517, 7.220 | 1.678 × 0.163 | `작성자_동국씨엠`, 본고딕 Normal 8pt, 회색, 우정렬 |
| 페이지 번호 | 10.131, 7.220 | 0.410 × 0.161 | 본고딕 Normal 8pt, 회색, 우정렬 |

### 2.6 재사용 브랜드 자산

참조 파일에서 그대로 추출해 리포지토리에 정적 자산으로 포함(픽셀 동일):

| 신규 경로 | 원본 | 규격 |
|-----------|------|------|
| `src/lib/report/assets/dk-logo.png` | 참조 `ppt/media/image2.png` | 229×48px (동국씨엠 워드마크) |
| `src/lib/report/assets/dk-watermark.png` | 참조 `ppt/media/image3.png` | 450×622px (DK 모노그램 워터마크) |

- pptxgenjs `addImage`에 **base64 data URI**로 임베드(서버 라우트에서 파일 읽어 인라인). 번들·경로 이슈 회피.

## 3. 본문 배치 (전주/금주 활동 표 + 이슈·주요이벤트)

참조 본문 구조:
```
[헤더] {프로젝트명} 주간보고
─────────────────────────────────────────
| 내용 | 전주 주요활동 ({전주범위}) | 금주 주요활동 ({금주범위}) |
|      | ▐ {Phase A}               | ▐ {Phase B}               |
|      |   ‒ {작업 · 담당 · 상태}  |   ‒ {작업 · 담당 · 상태}  |
─────────────────────────────────────────
이슈사항 및 주요 이벤트
  ▐ 이슈:  {model.issues 항목}
  ▐ 주요 이벤트: {회의·마일스톤}
```

- **2단 활동 표**: 좌측 narrow 라벨열(`내용`) + `전주 주요활동` + `금주 주요활동` 2열.
  - 각 칸은 Phase별 그룹 불릿: `▐ {Phase}`(본고딕 Medium 16pt, navy 바 불릿) → `‒ {작업명 · 담당 · 상태/공정율}`(본고딕 Normal 12pt).
  - 표 헤더 배경 navy `#002452`, 흰 글씨. 테두리 `#D4D8E0`. 셀 상단정렬.
- **이슈·주요이벤트 블록**: 표 아래. `▐ 이슈`/`▐ 주요 이벤트` 두 소제목 + 불릿.
- 내용이 많으면 본문 슬라이드를 추가 페이지로 넘김(참조는 1장이지만, 작업 수가 많은 프로젝트 대비 페이지네이션 유지 — 잘림 방지).

## 4. 아키텍처

```
buildWeeklyReportModel (기존, weekly.ts)         [+ prevWeek 필드 보강]
        │  WeeklyReportModel
        ▼
buildWeeklyNarrative(model) (신규, 순수)   → NarrativeModel { prevActivities, thisActivities, issues, events }
        │
        ▼
buildReportDeck(model) (재작성, pptx.ts)   → pptxgenjs → A4 .pptx (표지 + 본문)
```

- **단일 출처 유지**: 화면·Excel·PPT가 공유하는 `WeeklyReportModel`은 그대로. PPT 전용 변환만 `buildWeeklyNarrative`에 격리.

## 5. 컴포넌트별 명세

### 5.1 `src/lib/report/weekly.ts` (수정 — 전주 데이터 **추가만**)

> 🔴 **불변식: 기존 필드 정의는 절대 바꾸지 않는다(추가만).** `planActual.thisWeek`/`nextWeek`는 `excel.ts`(변경 금지)가 소비하므로(§8), 재정의하면 Excel 출력이 바뀐다. 따라서 **오직 새 필드만 추가**한다.

`WeeklyMeta`에 추가:
- `prevWeekStart: string`, `prevWeekDays: string[]`, `prevWeekRange: string` (지난주 월~금 / 'M/D~M/D')

`PhasePlanActual`에 추가:
- `prevWeek: WeeklyTaskRow[]` — leaf 중 **계획기간이 지난주와 겹치고**, 상태가 `done`(plannedEnd가 지난주 이내) 또는 `in_progress`/`delayed`인 작업.
- `doneThisWeek: WeeklyTaskRow[]` (선택) — 이번주 완료 작업. 샘플에서 "금주 활동"이 빈약하면 추가. 기존 `thisWeek`(진행중)과 별도 필드로 두어 Excel 무영향.

**금주 주요활동** = 기존 `planActual[].thisWeek`(진행중) **그대로 사용**(정의 불변). (필요 시 위 `doneThisWeek`를 합쳐 렌더 — 모델 필드는 각각 유지.)

> ⚠️ 근사 한계: 앱은 주별 이력 스냅샷이 없어 "지난주 활동"을 **현재 상태 + 계획일정** 기준으로 근사한다.

### 5.2 `src/lib/report/narrative.ts` (신규, 순수)

```ts
export interface NarrativeGroup { phase: string; items: string[] }  // items: "작업명 · 담당 · 상태 80%"
export interface NarrativeModel {
  prev: NarrativeGroup[]      // 전주 주요활동 (Phase별)
  this: NarrativeGroup[]      // 금주 주요활동 (Phase별)
  issues: string[]            // 이슈사항 (model.issues.content)
  events: string[]            // 주요 이벤트 (금주·차주 회의 + 임박 마일스톤)
}
export function buildWeeklyNarrative(model: WeeklyReportModel): NarrativeModel
```

- `prev`/`this`: `model.planActual`의 `prevWeek`/`thisWeek`를 Phase별로 그룹핑, 빈 Phase 제외.
- `events`: `model.meetings.thisWeek + nextWeek`를 `"{date} {title} ({location})"`로. 없으면 임박 종료 Phase/마일스톤으로 보완, 그래도 없으면 빈 배열(섹션은 "해당 없음").
- 순수함수 → 결정적 → 테스트 용이.

### 5.3 `src/lib/report/pptx.ts` (재작성)

- 상수: `FONTS = { bold:'본고딕 Bold', medium:'본고딕 Medium', normal:'본고딕 Normal' }`, `COMPANY='동국씨엠'`, A4 크기 상수.
- 자산 로더: `assets/dk-logo.png`·`dk-watermark.png`를 base64로 읽어 캐시.
- `coverSlide(pptx, model)` — §2.4 좌표대로.
- `contentSlides(pptx, narrative, model)` — §2.5 크롬 + §3 본문. 페이지네이션(작업 과다 시).
- `buildReportDeck(model): Promise<Buffer>` — 시그니처 유지(라우트 무변경). 내부만 교체.
- 구 네이비 덱 코드(coverSlide 네이비판, summarySlide, detailSlides, attendanceSlide, meetingSlide) **제거**.

### 5.4 `src/lib/report/dkbrand.ts` (경미 수정)

- `PN`에 회색 토큰 보강: `rule:'A6A6A6'`, `foot:'B6B6B6'` (없으면 기존 `line`/`subtle` 재사용).

### 5.5 자산 파일 (신규)

- `src/lib/report/assets/dk-logo.png`, `src/lib/report/assets/dk-watermark.png` (참조에서 추출).

## 6. 데이터 매핑 요약

| 참조 양식 칸 | 앱 데이터 소스 |
|--------------|----------------|
| 표지 제목 | `{meta.projectName} 주간보고` |
| 표지 부제 | `동국씨엠 · {meta.weekLabel}` |
| 내지 헤더 | `{meta.projectName} 주간보고` |
| 전주 주요활동 (범위) | `meta.prevWeekRange` + `planActual[].prevWeek` (Phase별) |
| 금주 주요활동 (범위) | `meta.weekRange` + `planActual[].thisWeek` (Phase별) |
| 이슈사항 | `issues[].content` |
| 주요 이벤트 | `meetings.thisWeek + nextWeek` (없으면 마일스톤) |
| 푸터 | `작성자_동국씨엠` + 페이지번호 |

## 7. 테스트 전략

- `tests/report/narrative.test.ts` — `buildWeeklyNarrative` 결정성: 전주/금주 Phase 그룹핑, 빈 Phase 제외, 이슈·이벤트 매핑, 빈 데이터 처리.
- `tests/report/weekly.test.ts`(기존 있으면 확장) — `prevWeek` 추출 로직: 지난주 겹침·done/in_progress 판정, 경계일.
- `tests/report/exporters.test.ts`(또는 신규 `pptx.test.ts`) — 스모크: `buildReportDeck` → Buffer 길이>0, PPTX zip 시그니처(`PK`), 슬라이드 수(표지+본문≥2), 핵심 텍스트("주간보고", 회사명) 포함.
- 엣지: 빈 WBS, 전주/금주 활동 0건, 이슈 0건, 회의 0건.

## 8. 리스크 / 확인사항

- **본고딕 미설치 환경**: fontFace 이름 지정만으로는 미설치 PC에서 대체 렌더. 참조 제작 환경엔 설치됨 → 동일 조건 가정. (임베드 폰트는 이번 범위 아님.)
- **think-cell 표 미세 스타일**: 100% 복제 아님 → 네이비 테마로 근사, 실제 샘플 PPT 비교 후 조정.
- **Excel 무영향 보장**: `excel.ts`가 `planActual.thisWeek`를 소비함(확인됨, line 132). → 기존 필드 **재정의 금지**, `prevWeek`/`doneThisWeek` **추가만**. 기존 테스트(`weekly.test.ts`)도 기존 필드만 검증하므로 추가는 안전.
- **그라데이션 룰**: pptxgenjs gradient 미지원 → 2-사각형 근사.

## 9. 검증 방법

브라우저 목업 대신 **실제 .pptx 샘플을 생성**해 참조 원본과 나란히 비교·조정(표지 우선, 이후 본문). 데모/실데이터 양쪽 확인.

## 10. 비목표 (YAGNI)

- Excel(`excel.ts`) 출력 변경 없음.
- 근태·상세KPI·WBS 트리 슬라이드(구 덱 기능)는 PPT에서 제거(Excel에 존재).
- 폰트 파일 임베드, 보고서 섹션 커스터마이즈 UI, think-cell 재현.
- 원시 WBS export(`/api/export`) 변경 없음.

## 11. 변경/신규 파일 요약

**신규:** `src/lib/report/narrative.ts`, `src/lib/report/assets/dk-logo.png`, `src/lib/report/assets/dk-watermark.png`, `tests/report/narrative.test.ts`
**수정:** `src/lib/report/pptx.ts`(재작성), `src/lib/report/weekly.ts`(prevWeek 보강), `src/lib/report/dkbrand.ts`(회색 토큰), `tests/report/*`(스모크/모델 테스트)
**제거:** 구 네이비 덱 함수(pptx.ts 내부). 라우트(`/api/report`)·`buildReportDeck` 시그니처는 유지.
