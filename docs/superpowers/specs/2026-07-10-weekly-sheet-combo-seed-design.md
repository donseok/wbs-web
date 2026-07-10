# 주간업무 시트 Rev2 — 구글시트 완전 복제 + 콤보박스 + 샘플 시드 + 전폭 레이아웃

- 날짜: 2026-07-10
- 상태: 사용자 요청 기반 설계(자율 세션 — 레퍼런스 시트 자체가 요구 명세). 기반 스펙: `2026-07-10-weekly-report-sheet-design.md`
- 레퍼런스: 구글시트 `1cA-fD5n86eZtnad3Kys8U6WiK6QXNFISW9TUwbqi8BE` — 탭 `7월2주차`(gid=0)

## 1. 요구 → 설계 매핑

| 사용자 요구 | 설계 결정 |
|---|---|
| 시트와 완전 똑같이 | 열 비율을 레퍼런스 실측값(B8.38/C13.5/D58.63/E39.75/F41.13/G36)의 백분율로 반영, 제목행 `▣ 주간업무보고 - …(N월 N주차)`를 **편집 가능**하게(레퍼런스의 "ERP부분"은 프로젝트명이 아니므로 자유 텍스트 필요) |
| 구분·모듈 콤보박스 | 그리드 셀 자체를 콤보(select)로: 구분(병합 셀)=그룹 전체 rename, 모듈=행 단위 rename. 행 추가 폼도 동일 콤보. `직접 입력…` 옵션으로 자유 값 허용(자유 작성 요구 충족) |
| 샘플 입력 값 | 레퍼런스 `7월2주차` 탭의 실제 셀 텍스트를 프로덕션 DB의 2026-07-06 주차 문서(행 0개 확인됨)에 시드. 완전 빈 스페이서 행 1개는 제외, 구분·모듈 없는 말미 콘텐츠 행은 그대로 재현 |
| 주간보고 버튼 → 프로젝트 PPT 양식 | 기존 `source=sheet` 경로가 이미 `weekly-template.pptx`(부산운영팀 양식 — 디자인·폰트 보존)를 채움. 버튼 라벨을 `주간보고 (PPT)`로 변경만 |
| 최대한 자유롭게 작성 | 셀 textarea 무제약 유지(20,000자 상한만), 콤보에 직접 입력 경로, 제목 자유 편집 |
| 좌우 간격 최대화 | 시트 래퍼 패딩 축소(p-3→p-1.5), 행 액션 거터 64px→32px, 열 백분율로 테이블이 컨테이너 전폭 사용, 이슈 열 고정 224px 폐지(백분율화) |

## 2. 데이터 (마이그레이션 `0024_weekly_title.sql`)

```sql
alter table weekly_reports add column if not exists title text not null default '';
```

- `title=''`이면 화면은 `▣ 주간업무보고 - {프로젝트명}({N월 N주차})` 기본값을 보여준다(주차 이동해도 자연스러운 기본 제목).
- RLS는 기존 weekly_reports update 정책(authenticated 전원)이 그대로 커버.
- 적용: Management API `POST /v1/projects/<ref>/database/query` — 코드 배포 전 선적용(추가 컬럼이라 무해).

## 3. 도메인 (`src/lib/domain/weeklySheet.ts`)

```ts
WEEKLY_SECTIONS = ['공통', 'ERP', 'MES']
WEEKLY_MODULES  = { 공통: [공통], ERP: [SD/LE, MD/PP, MM, FI/TR, CO],
                    MES: [품질, APS, 조업 및 표준화, 가공, 설비 Level2, 물류] }
moduleOptions(section, current?)  // 구분별 목록, 미지의 구분→전체 평탄화, current 값 항상 포함
defaultWeeklyRows(): NewWeeklyRow[]  // 12행 스켈레톤(위 순서), 셀은 빈값
```

## 4. 서버 액션 (`src/app/actions/weekly.ts`)

- `createWeeklyReport(…, carryOver=false)` — 빈 문서 대신 **기본 스켈레톤 12행 시드**(빈 시트에 수동으로 12행 추가하는 노동 제거, 레퍼런스 프레임 재현).
- `renameWeeklySection(projectId, rowIds[], section)` — 병합(연속 동일 구분) 그룹 전체 rename. `.in('id', rowIds)` 단일 UPDATE, 비어있지 않은 trim·NAME_MAX 검증, rowIds ≤ 50.
- `renameWeeklyModule(projectId, rowId, module)` — 행 단위 rename, 동일 검증.
- `saveWeeklyTitle(projectId, reportId, title)` — 200자 상한, 빈 문자열 허용(기본 제목으로 복귀).
- rename은 Realtime UPDATE 이벤트로 타 사용자에 전파 — `applyServerRow`가 구조 필드를 서버 채택하므로 추가 작업 없음.

## 5. UI (`src/components/weekly/WeeklySheetView.tsx`)

- 열 구성(table-fixed, 백분율): 구분 4.5% / 모듈 7% / 금주내용 29.5% / 금주이슈 20% / 차주내용 21% / 차주이슈 18% + 행 액션 거터 `w-8`(무테두리).
- `NameCombo` 셀 컴포넌트: 시트 셀 룩(테두리 없음·중앙·볼드 13px·흰 배경)의 select. 옵션 = 현재값(목록 밖이면 선두 추가) + 구분별 목록 + `직접 입력…`. 직접 입력 선택 시 인라인 input으로 전환(Enter/blur 커밋, Esc 취소). hover 시 ▾ 표시.
- 제목행: borderless input(볼드 15px). blur 시 변경분만 저장.
- 버튼: `PPT 내보내기` → `주간보고 (PPT)`.
- 빈 주차 EmptyState: `빈 시트로 시작` → `기본 시트로 시작(공통·ERP·MES)`.

## 6. PPT 견고화 (`src/lib/report/sheetNarrative.ts`)

구분·모듈이 빈 행(레퍼런스 말미 행)이 PPT에서 `[] `로 나오지 않게:
- 헤드라인: 둘 다 있으면 `[구분] 모듈`, 아니면 `모듈 || 구분 || '기타'`.
- 이슈 접두: `[모듈 || 구분 || '기타']`.

## 7. 테스트

- `moduleOptions`: 구분별 목록·미지 구분 평탄화·current 포함.
- `defaultWeeklyRows`: 12행·순서·sortOrder 1부터·셀 빈값.
- `buildSheetNarrative`: 빈 라벨 헤드라인/이슈 접두 폴백.
- 기존 테스트 전부 그린 유지.

## 8. 배포 순서

1. 0024 프로덕션 선적용 → 2. 코드 구현·검증(build/lint/test) → 3. 샘플 시드 SQL 적용(멱등: 해당 report의 행 0개일 때만) → 4. 로컬 커밋(푸시는 사용자 게이트 관례).
