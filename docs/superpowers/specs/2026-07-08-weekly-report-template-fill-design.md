# 주간보고 PPTX 템플릿-필 설계 (D-Cube 양식 완전 동일 재현)

> 상태: 설계 승인됨 (2026-07-08) · 다음 단계: writing-plans

## 1. 배경 · 목표

현재 주간보고 PPTX는 `src/lib/report/pptx.ts`가 **pptxgenjs로 매번 새로 그려** D-Cube 양식을 *근사*한다. 커버의 OLE 임베드 객체·슬라이드 마스터·정확한 좌표·테마 색을 재현할 수 없어 원본과 **바이트 동일**이 불가능하다.

**목표:** 사내 공식 템플릿 `docs/26.07.02. D-Cube 주간보고_부산운영팀_1_2026-07-07_이돈석.pptx`와 **디자인이 완전히 동일**한 주간보고 PPTX를, **내용만 해당 주차에 맞게 자동 생성**해 내려받게 한다. 폰트(본고딕)·색·레이아웃·커버 장식 전부 원본과 같아야 한다.

## 2. 사용자 · 성공 기준

- **사용자:** PMO/현업 — 대시보드/리포트 모달에서 "주간 보고서(PPTX)"를 눌러 즉시 내려받는다.
- **성공 기준:**
  1. 생성된 PPTX를 원본 템플릿과 나란히 열었을 때 **폰트·색·커버·표 서식이 시각적으로 구분 불가**.
  2. slide2 표의 날짜 헤더와 전주/금주/이슈 내용만 해당 주차 데이터로 바뀜.
  3. 내용은 **WBS + 회의 + 공지**에서 자동 생성 — 손 편집 없이 바로 제출 가능한 초안.
  4. 회의/공지가 없거나 활동이 많은 주에도 깨지지 않음(캡·요약).

## 3. 설계 개요 — 템플릿-필

원본 `.pptx`(zip)를 앱 에셋으로 저장하고, export 시 **slide2 표의 대상 셀 텍스트만 교체**한 뒤 재압축한다. slide1(커버)·OLE·마스터·테마·폰트는 **원본 그대로** 두므로 디자인이 바이트 동일하다.

```
GET /api/report?format=pptx
  → 데이터 페치(route): WBS·members·attendance·meetings·[+공지]
  → buildWeeklyReportModel(...)                     (기존, +announcements)
  → buildWeeklyNarrative(model)                     (강화: 회의·공지 반영)
  → fillWeeklyTemplate(narrative, model)            ★신규 렌더러
        1. 템플릿 zip 로드
        2. ppt/slides/slide2.xml 파싱
        3. 날짜 헤더 치환
        4. 전주/금주/이슈 셀 문단 교체(원본 서식 클론)
        5. 재압축 → Buffer
  → 다운로드
```

- **xlsx 경로는 무변경**(exceljs `buildReportWorkbook`).
- pptx 경로만 `buildReportDeck`(pptxgenjs) → `fillWeeklyTemplate`(템플릿-필)로 교체. 구 생성기 코드는 제거한다(참고 재현이 목적이었고 이제 원본을 직접 사용하므로 불필요). `dkbrand.ts`의 PPT 색 토큰(`PN`)·`assets/reportImages.ts`도 pptx에서 미사용이 되면 정리.

## 4. 슬라이드 구조 (원본 실측)

- **slide1 (커버):** "D-Cube 프로젝트 주간보고 / 동국씨엠 / D-Cube TF" + OLE 객체 2 + 로고. **날짜 없음 → 손대지 않고 그대로 보존.**
- **slide2 (본문):** 3열 × 3행 네이티브 표(`<a:tbl>`, `graphicFrame` 내부).
  - 열 폭(EMU): `768351 / 4272688 / 4318862` (≈0.84" / 4.67" / 4.72").
  - 행0(헤더, 0.38"): `구분` | `전주 주요활동 (6/29~7/3)` | `금주 주요활동 (7/6~7/10)`
  - 행1(내용, 3.26"): `내용` | [전주 활동] | [금주 활동]
  - 행2(이슈, 1.31"): `이슈사항 및 주요이벤트` | [이슈] | [주요 이벤트]
  - 폰트: 본고딕 Medium(헤더)/Normal(본문). 표 셀 텍스트는 모두 `<a:t>` 런.

## 5. 콘텐츠 생성 (WBS + 회의 + 공지)

`buildWeeklyNarrative(model)`를 확장한다. 모델은 이미 `meetings`를 포함(route가 `getProjectMeetingData`로 페치). 공지는 route에 `getAnnouncements(projectId)`를 추가해 모델/내러티브에 전달한다.

- **전주 주요활동** = 지난주 완료/진행한 WBS 리프(Phase 그룹) + 지난주에 열린 회의(제목 + `body`에서 뽑은 핵심 불릿, 참석자 요약) + 지난주 게시된 공지 제목.
- **금주 주요활동** = 이번주 예정/진행 WBS 리프 + 이번주 회의/이벤트.
- **이슈·주요이벤트** = 지연 작업 → 이슈 / 다가오는 마일스톤·회의(예: Kick-Off) → 이벤트.
- 회의 `body`가 있으면 `- 참석자: …`, `- 회의 내용 . …` 형태로 전개해 샘플의 워크샵 회의록 톤에 근접시킨다. `body`가 없으면 제목만.
- 반환 형태는 기존 `NarrativeModel`(prev/curr `NarrativeGroup[]`, issues[], events[])을 유지·확장 → 렌더러가 표 셀로 매핑.

## 6. 템플릿-필 메커니즘 (핵심)

`fillWeeklyTemplate`은 순수 XML 조작으로 구현한다.

**6.1 zip 로드/저장:** `jszip`(현재 pptxgenjs 경유로 트리에 존재 — 직접 의존성으로 추가). 템플릿 바이트 → `JSZip.loadAsync` → `slide2.xml` 문자열 획득 → 치환 → `generateAsync({type:'nodebuffer'})`.

**6.2 날짜 헤더 치환:** 행0 col2/col3 셀의 `(6/29~7/3)` / `(7/6~7/10)` 텍스트를 `model.meta.prevWeekRange` / `model.meta.weekRange`로 교체. 날짜가 여러 런으로 쪼개져 있으므로, 셀 헤더 문단을 **`전주 주요활동 (범위)` 단일 런으로 재작성**(원본 rPr 서식 유지).

**6.3 셀 내용 교체(서식 클론):** 각 대상 셀에서 원본 `<a:p>` 1개를 읽어 **문단/런 서식 스켈레톤**을 추출한다:
- `<a:pPr>`(불릿 문자·들여쓰기·정렬), `<a:rPr>`(typeface=본고딕, sz, srgbClr).
- 생성 콘텐츠의 각 줄(헤더/불릿)에 대해 스켈레톤을 복제하고 `<a:t>`만 교체해 `<a:p>` 목록 생성.
- 셀 `<a:txBody>`의 기존 문단들을 새 목록으로 치환(첫 `<a:bodyPr>`/`<a:lstStyle>`은 보존).
- Phase 헤더(`▐ N. Phase`)와 하위 불릿(`‒ 작업`)은 원본 표의 서식 계층(헤더 런 vs 불릿 문단)을 그대로 사용.

**6.4 오버플로우 방지:** 셀 높이 고정(행1 3.26")이므로 활동은 줄 예산으로 캡한다. 현재 `pptx.ts`의 `capItems`/`capGroups`/`packGroups` 로직(단, 페이지 분할 없이 **한 페이지 캡만**)을 순수 함수로 이전·재사용. 초과분은 `외 N건`. 이슈/이벤트도 `ISSUE_CAP`/`EVENT_CAP` 유지.

**6.5 XML 안전:** 삽입 텍스트는 `&,<,>` 이스케이프. 유니코드(한글) 그대로. 표 외 슬라이드/파트는 손대지 않음.

## 7. 템플릿 저장

`src/lib/report/assets/weekly-template.pptx` 바이너리를 **git에 커밋**(468KB). 런타임에 `fs.readFile(path.join(process.cwd(), '…'))`로 읽고, `next.config`의 `outputFileTracingIncludes`에 `/api/report` 라우트용으로 이 경로를 등록해 서버 번들에 포함시킨다. (대안: base64 `.ts` 모듈 — 안정적이나 ~624KB 텍스트 블롭이라 비선호.)

## 8. 컴포넌트 · 파일

- **신규** `src/lib/report/templateFill.ts` — `fillWeeklyTemplate(narr, model): Promise<Buffer>` + 순수 헬퍼(`cloneParaSkeleton`, `buildCellXml`, `replaceDateHeader`, `escapeXml`).
- **신규** `src/lib/report/assets/weekly-template.pptx` — 원본 바이너리.
- **수정** `src/lib/report/narrative.ts` — 회의(body)·공지 반영해 prev/curr/issues/events 강화.
- **수정** `src/app/api/report/route.ts` — `getAnnouncements` 추가 페치 + pptx는 `fillWeeklyTemplate` 호출.
- **수정** `src/lib/report/weekly.ts`(모델) — announcements 필드 추가(필요 시).
- **수정** `next.config.*` — `outputFileTracingIncludes`.
- **수정** `package.json` — `jszip` 직접 의존성.
- **정리** `src/lib/report/pptx.ts` — 순수 캡 헬퍼(`capItems`/`capGroups`/`packGroups`)는 먼저 `templateFill.ts`(또는 공용 순수 모듈)로 **이전**한 뒤, pptxgenjs 렌더 함수·구 생성기 본체는 제거. pptx 전용 에셋(`assets/reportImages.ts`)·색 토큰(`PN`)이 pptx에서 완전히 미사용이 되면 정리.

## 9. 엣지 케이스

- 회의/공지 없음 → WBS만으로 채움. 활동 0건 셀 → `(해당 없음)`.
- 내용 초과 → 캡·요약(페이지 분할 없음 — 템플릿 2슬라이드 고정).
- 템플릿 파일 누락/손상 → 500 + 명확한 에러 메시지(폴백 없음).
- **폰트 의존성:** 본고딕 미설치 PC는 대체폰트로 렌더(원본 템플릿과 동일한 한계). 안내만, 임베딩은 범위 밖.

## 10. 범위 밖 (YAGNI)

- 다중 프로젝트 커버(현재 D-Cube 전용 템플릿).
- 폰트 임베딩.
- 표 용량 초과 시 슬라이드 자동 분할.
- 커버(slide1) 내용 변경.

## 11. 테스트

- **순수 함수 단위테스트**: `escapeXml`, `cloneParaSkeleton`(서식 보존), `buildCellXml`(문단 수·이스케이프), 날짜 헤더 치환, 캡·요약, 강화된 narrative(회의/공지 반영, 없을 때 폴백).
- **통합(스냅샷)**: `fillWeeklyTemplate` 산출 zip에서 `slide2.xml`을 재파싱해 (a) 날짜 헤더가 주차 범위로 바뀜, (b) 전주/금주 셀에 생성 텍스트 포함, (c) 표 외 파트(slide1, theme, media) **바이트 불변**을 검증.
- 회귀: 기존 report 테스트(narrative/exporters/pptx-unit) 유지·갱신.

## 12. 열린 질문

- 없음(승인 시점 기준). 회의 `body` 전개의 상세 톤은 구현 중 샘플과 대조해 조정.
