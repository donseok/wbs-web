# 주간업무 시트 + PPT 자동 생성 — 설계 스펙

- 날짜: 2026-07-10
- 상태: 사용자 설계 승인 완료 (브레인스토밍 Q&A 6회로 핵심 결정 확정) + 3렌즈 셀프리뷰 반영
- 레퍼런스: 구글시트 "PI 프로젝트 주간보고-ERP" (구분/모듈 행 × 금주실적/차주계획 열, 셀 자유 텍스트, 주차별 탭)

## 1. 목적과 범위

팀원들이 주간업무 보고를 **자유 텍스트로 직접 작성**하는 구글시트식 그리드 화면을 추가하고, 그 내용으로 **주간보고 PPT를 자동 생성**한다.

- 기존 WBS 기반 자동 주간보고(보고서 모달 → `/api/report`)와는 **별도 보고서로 공존**한다. 기존 코드 변경은 3곳으로 한정하며 기존 호출 경로 동작은 불변: (a) `fillWeeklyTemplate` 헤더 라벨 파라미터화, (b) `/api/report`에 `source=sheet` 분기 추가, (c) 페이지 분할 줄수 추정·셀 렌더에 라인 포매터 주입.
- 편집 패러다임은 **구조화 그리드**: 행(구분·모듈)은 추가/삭제/순서 변경 가능(승인된 설계 §1에 포함), 열은 고정 4종(금주실적 내용/이슈, 차주계획 내용/이슈), 셀 안은 자유 멀티라인 텍스트.

### 비범위 (YAGNI)
셀 서식(볼드·색), 수식, 임의 열 추가, 셀 병합 편집, 변경 이력/버전, 셀 코멘트, 문자 단위 동시편집(CRDT), 엑셀 내보내기. 주차별 "탭"은 별도 UI 없이 주차 네비게이션이 대체한다.

## 2. 데이터 모델 (마이그레이션 `0023_weekly_sheet.sql`)

```
weekly_reports        -- 주차 문서 (프로젝트 × 주 시작일 유니크)
  id uuid pk, project_id uuid fk→projects, week_start date,
  created_at, updated_at
  unique (project_id, week_start)

weekly_report_rows    -- 모듈 행 (셀 4개 내장)
  id uuid pk, report_id uuid fk→weekly_reports (on delete cascade),
  section text,        -- 구분: 공통/ERP/MES …
  module text,         -- 모듈: SD/LE, MD/PP …
  sort_order int,
  this_content text default '',  -- 금주실적 내용
  this_issue   text default '',  -- 금주 이슈·주요 이벤트
  next_content text default '',  -- 차주계획 내용
  next_issue   text default '',  -- 차주 이슈·주요 이벤트
  updated_at timestamptz
```

- **셀 저장 = 행 하나의 열 하나 UPDATE.** 같은 모듈·같은 열을 동시에 고칠 때만 마지막 저장이 이긴다(last-write-wins). WBS식 낙관적 잠금은 자유 텍스트 셀에는 적용하지 않는다(사용자 결정: 셀 분담 구조라 실충돌 드묾).
- 마이그레이션 컨벤션은 `0021_minutes.sql` 스타일: 멱등(`if not exists`, `drop policy if exists`), 상단 주석에 권한 요약·적용 경로 명시, 적용은 **Supabase Management API**(`POST /v1/projects/<ref>/database/query`) — pg 직결/`db push` 아님. 코드 배포 전에 먼저 적용.
- **RLS**: 두 테이블 모두 enable RLS. 정확한 정책 문법:
  - select: `to authenticated using (true)` (기존 관례)
  - insert: `to authenticated with check (true)` (INSERT 정책은 USING 불가 — WITH CHECK만)
  - update: `to authenticated using (true) with check (true)`
  - delete: `to authenticated using (true)`
  - **협업 시트 성격상 로그인 멤버 전원 편집.** `created_by`/`app_role()` 게이트를 쓰는 공지·회의록과 의도적으로 다름 — "로그인한 프로젝트 멤버 전원이 셀 편집·행 관리 가능"으로 명시된 설계안을 사용자가 2026-07-10 승인함. `app_role()` 헬퍼를 쓰게 되면 프로덕션 헬퍼명은 `app_role()`이다(`current_role()`은 드리프트 — 금지).
- **Realtime**: `weekly_report_rows`를 `supabase_realtime` publication에 추가. 중복 추가 시 에러이므로 멱등 처리(`DO $$ ... exception when duplicate_object` 또는 존재 확인 후 추가).

## 3. 화면/UX (`src/app/(app)/p/[projectId]/weekly/page.tsx` + `src/components/weekly/`)

- 사이드바 새 메뉴 **"주간업무"**: `src/components/app/Sidebar.tsx`의 `projectMenu()`에 항목 추가 + `src/lib/i18n/dict/common.ts`에 `nav.weekly` 키(ko/en) 추가.
- 상단 바: `◀ 7월 2주차 (7/6~7/10) ▶` 주차 네비게이션 + `[PPT 내보내기]` 버튼.
  - **주 시작은 월요일**(기존 `buildWeeklyReportModel`과 동일, UTC 기준).
  - **주차 라벨 규칙**: 그 주 월요일이 속한 달을 기준으로, 그 달의 몇 번째 월요일인지로 "N주차"를 매긴다(예: 7/6(월)이 7월의 첫 월요일이면 "7월 1주차"). 날짜 범위 표기는 월~금. §6 PPT 헤더의 주차 범위도 동일 규칙.
- **문서 없음 상태**: 해당 주차 문서가 없으면 `EmptyState`로 표시하고 두 버튼 제공 — `[이전 주차에서 이월해 시작]`(이월 원본이 있을 때만 노출, §4의 '이월 원본' 정의 참조) / `[빈 시트로 시작]`. 자동 생성은 하지 않는다(빈 문서 양산 방지).
- 그리드 (레퍼런스 시트와 동일 구조):

  | 구분 | 모듈 | 금주실적 내용 | 금주 이슈·이벤트 | 차주계획 내용 | 차주 이슈·이벤트 |
  |---|---|---|---|---|---|

  - 같은 `section` 연속 행은 구분 셀을 시각적으로 병합(rowSpan)해 시트처럼 보이게.
  - 셀은 자동 높이 `textarea`(클릭 시 편집, `app-textarea` 토큰). 저장 트리거: **입력 멈춤 1.5초 디바운스 + 셀 blur**. 셀 모서리에 저장 상태 표시(저장 중 스피너 / 저장됨 / 실패 시 재시도 아이콘).
  - 행 관리: 마지막에 `[+ 모듈 추가]`(구분·모듈명 입력), 행 hover 시 삭제·위/아래 이동. 삭제는 확인 후 진행. **행 이동은 동일 section 내로 제한**(인접 swap, 구분 병합 표시가 갈라지지 않게).
  - 편집 권한: **로그인한 멤버 전원**(pmo_admin 게이트 없음). UI 게이팅 불필요, 서버 액션은 세션 검증만.
- 디자인은 기존 토큰·프리미티브만 사용: `card`, `btn btn-primary/ghost`, `app-textarea`, `EmptyState`, `Toast`, `Spinner`, lucide 아이콘.

## 4. 저장/서버 계층 (`src/app/actions/weekly.ts`)

리포 관례(server action, `{ ok, error? }` 반환, `revalidatePath`) 준수:

- `createWeeklyReport(projectId, weekStart, { carryOver: boolean })` — 문서 생성.
  - **이월 원본 정의**: 해당 주 이전 **가장 최근 `week_start`의 문서**(직전 주에 한정하지 않음 — 연휴로 한 주를 건너뛰어도 이월 가능).
  - `carryOver=true`면 이월 원본의 행 구성(구분/모듈/순서)을 복사하고, 원본의 `next_content/next_issue` → 새 주차 `this_content/this_issue` 초안으로, `next_*`는 빈값(사용자 확정 이월 규칙). 원본이 없으면 빈 시트.
  - 이월 변환은 순수 함수 `carryOverRows(prevRows): NewRow[]`로 분리(테스트 대상).
- `saveWeeklyCell(rowId, colKey: 'this_content'|'this_issue'|'next_content'|'next_issue', content)` — 열 화이트리스트 검증 후 단일 UPDATE. last-write-wins.
- `addWeeklyRow(reportId, section, module)` / `deleteWeeklyRow(rowId)` / `moveWeeklyRow(rowId, dir)` — sort_order 재배치, 이동은 동일 section 내 인접 행과 swap.
- 조회는 서버 페이지에서 `createServerClient()`로 문서+행 로드 후 클라이언트 컴포넌트에 initial data로 전달.
- **주차 유틸**: `src/lib/report/weekly.ts`의 비공개 `mondayOf/parseUTC/fmtUTC/addDays`를 export(또는 `src/lib/domain/dates.ts`류 공용 헬퍼로 추출, UTC 기준 유지). 주차 네비게이션(±7일), 서버의 주차 정규화, 주차 라벨 산정이 모두 이 헬퍼를 쓴다.

## 5. 실시간 협업

- 브라우저 supabase 클라이언트(`src/lib/supabase/client.ts`)로 `weekly_report_rows` 채널 구독(`filter: report_id=eq.<id>`), INSERT/UPDATE/DELETE 이벤트를 로컬 상태에 병합.
- **병합 규칙(열 단위)**: Realtime 이벤트는 행 단위(4셀)로 오지만 병합은 **셀(열) 단위**로 수행한다.
  - 로컬이 **dirty**(미저장 입력 있음 또는 저장 요청 진행 중)인 셀은 포커스 여부와 무관하게 원격 값으로 덮지 않는다. dirty가 아닌 셀은 즉시 반영.
  - dirty 셀은 **내 저장이 우선**(last-write-wins와 일관): blur/디바운스로 저장이 성공하면 서버 값(=내 값)을 채택하고 dirty 해제. 보류해 둔 원격 값을 나중에 병합하는 동작은 하지 않는다(내 저장이 그 값을 이미 덮었으므로).
  - **자기 echo**: 내 저장이 유발한 Realtime 이벤트는 내용이 로컬과 동일하므로 재적용해도 무해 — 별도 식별 없이 동일 병합 규칙으로 처리(dirty 아니면 반영 = no-op).
- 채널 재연결(`SUBSCRIBED` 재진입) 시 전체 행 refetch로 누락분 보정. Realtime 자체가 실패해도 저장/조회는 정상 동작(순수 향상 기능).

## 6. PPT 변환

- **엔드포인트**: 기존 `/api/report/route.ts`에 `source=sheet&week=YYYY-MM-DD` 파라미터 추가(format=pptx일 때만 유효). **sheet 분기는 기존 6소스 데이터 페치(route.ts:52-64)와 `buildWeeklyReportModel`을 우회**하고, 프로젝트명 조회 + 해당 주차 시트 rows 로드만 수행한다. 파일명용 weekTag와 헤더용 주차 범위는 `week` 파라미터에서 합성(§3 주차 라벨 규칙과 동일 유틸).
- **템플릿 매핑** (부산운영팀 템플릿, 표 구조 그대로):
  - 왼쪽 콘텐츠 열(`narr.prev` 슬롯) = **금주실적**, 오른쪽 열(`narr.curr` 슬롯) = **차주계획**. `buildSheetNarrative`는 이 매핑으로 `NarrativeModel`을 만든다.
  - **헤더 라벨 파라미터화**: `fillWeeklyTemplate(narr, model, labels?: { left: string; right: string })` — 라벨 기본값은 기존 '전주 주요활동'/'금주 주요활동'(기존 호출부 동작 불변). 날짜 범위는 지금처럼 `model.meta.prevWeekRange/weekRange`에서 오므로(`buildHeaderCellTxBody`가 `라벨 (범위)`로 합성), sheet 경로는 최소 meta(`prevWeekRange`=금주 범위, `weekRange`=차주 범위, `weekTag`)를 합성해 넘긴다. 라벨은 '금주실적'/'차주계획'.
  - 그룹 헤드라인(•볼드) = `[구분] 모듈` (예: `[ERP] SD/LE`). 해당 열 셀이 빈 모듈은 그 열에서 생략, 4개 셀이 모두 빈 행은 어디에도 안 나감.
  - **셀 텍스트 줄 규칙** (`sheetLineText()` — 기존 `subLineText`와 별개, 마커를 추가하지 않고 들여쓰기만):
    - 일반/`1.` 숫자 시작 줄 → 4칸 들여쓰기
    - `-` 시작 줄 → 8칸
    - `.` 시작 줄 → 12칸
    - 빈 줄은 유지(작성자의 문단 구분 존중), 연속 2줄 이상은 1줄로 축약
  - **라인 포매터 주입**: `buildCellTxBody`는 현재 모든 item에 `subLineText`를 무조건 적용하므로 items 사전 포맷은 불가(들여쓰기가 파괴됨). `buildCellTxBody`와 `paginateGroups`의 줄수 계산(`groupCost`/분할 루프)에 `lineFormatter?: (item: string) => string`(기본값 `subLineText`)를 추가하고 `fillWeeklyTemplate`이 관통시킨다. 렌더와 줄수 추정이 같은 포매터를 쓰는 것이 규칙.
  - **이슈 행**(템플릿 표 하단의 고정 행2 — 콘텐츠 그룹과 별도 셀이며 CELL_BUDGET 산정에 포함되지 않음): 왼쪽 셀 = 금주 이슈들(`narr.issues`), 오른쪽 셀 = 차주 이슈들(`narr.events` 슬롯 재사용). 이슈 셀 텍스트는 **줄 단위로 분해해 각 줄을 개별 이슈 항목(볼드 불릿)으로** 취급하고 각 항목에 `[모듈]` 접두. 빈 경우 `buildSheetNarrative`가 `['특이 이슈 없음']`을 직접 채워 넣는다(오른쪽 슬롯의 기존 폴백 '예정된 주요 이벤트 없음'이 노출되지 않도록). 캡은 기존 그대로(좌 ISSUE_CAP=3 / 우 EVENT_CAP=4, 초과분 '외 N건') — 셀 높이(1.3") 물리 제약. 연속 슬라이드에서 이슈 행이 '-'로 채워지는 기존 동작도 그대로.
- `buildSheetNarrative`는 순수 함수(`src/lib/report/sheetNarrative.ts`) — 입력 rows, 출력 `NarrativeModel` 호환 구조.

## 7. 에러 처리

- 셀 저장 실패: 셀 내용은 로컬 유지, 실패 아이콘 + Toast, 클릭 재시도(자동 재시도 1회 후 수동).
- PPT 내보내기: 해당 주차 문서 없거나 행 전부 빈 경우 400 + Toast로 안내 메시지.
- 주차 파라미터는 서버에서 월요일로 정규화(임의 날짜 들어와도 해당 주 문서로).

## 8. 테스트 (기존 `tests/report/` 스타일, vitest 순수 함수 중심)

- `carryOverRows`: 이월 매핑(차주→금주, next 비움, 행 구성·순서 보존), 원본 없음 → 빈 결과, 건너뛴 주(가장 최근 문서 선택).
- `buildSheetNarrative`: 그룹 생성·빈 셀 생략·`[구분] 모듈` 헤드라인·이슈 `[모듈]` 접두·빈 이슈 → `['특이 이슈 없음']`·빈 행 제외·prev=금주/curr=차주 매핑.
- `sheetLineText`: 들여쓰기 3단계 + 빈 줄 유지·연속 빈 줄 축약.
- `fillWeeklyTemplate` 라벨 파라미터: 기본값 기존 동작 불변 + 주입 시 헤더 교체. `lineFormatter` 주입 시 렌더·줄수 추정 일관성(기존 templateFill 테스트에 케이스 추가).
- 주차 라벨 산정(월 첫 월요일 기준 N주차, 월 경계 케이스).
- 서버 액션 열 화이트리스트 검증(허용 외 colKey 거부).

## 9. 구현 순서(요약)

1. 마이그레이션 0023 작성 → Management API로 프로덕션 적용
2. 주차 유틸 export/추출 + 순수 함수 계층(carryOver/sheetNarrative/sheetLineText/주차 라벨) TDD
3. 서버 액션 + 페이지/그리드 컴포넌트 (+ Sidebar 메뉴·i18n 키)
4. Realtime 구독 + dirty 셀 병합 규칙
5. `fillWeeklyTemplate` 라벨·lineFormatter 파라미터 확장 + `/api/report` source=sheet 분기
6. E2E 수동 검증(빌드/린트/테스트 + 실제 PPTX XML 확인)
