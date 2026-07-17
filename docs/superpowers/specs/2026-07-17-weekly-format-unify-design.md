# 주간업무 시트 「양식 통일」 버튼 — 설계

2026-07-17 · 브레인스토밍 확정본

## 배경과 목표

주간업무 시트는 구분(업무영역)별로 담당이 각자 작성한다. 사람마다 하위 마커(`-`, `-.`,
들여쓰기 0~5칸), 번호 매김(한 셀 안 `1. … 1. …` 중복), 빈 줄 정책이 제각각이라
주간보고상세 PPT를 뽑기 전에 손으로 다듬어야 했다. 「양식 통일」 버튼 한 번으로
셀 텍스트의 **형식만** 표준화한다. 내용(문장·오탈자·문장 내부 공백)은 절대 바꾸지 않는다.

실데이터 근거(2026-07 최근 3주, 읽기 전용 샘플링): 하위 마커 4종 혼용, 들여쓰기 0~5칸,
중복 번호 2건, 공백만 있는 줄 존재. 상위 `1.` 숫자 마커와 명사형 문체는 이미 일관적 —
그래서 규칙 기반으로 충분하며 AI 정리는 채택하지 않는다(사용자 결정).

## 확정 결정 (브레인스토밍)

| 결정 | 선택 |
|---|---|
| 통일 수준 | 마커 + 번호 재부여 + 빈 줄 (규칙 기반, 내용 불변) |
| 표준 하위 마커 | 들여쓰기 2칸 + `-. ` |
| 적용 UX | 미리보기 모달 확인 후 일괄 적용, 적용 후 Ctrl+Z 되돌리기 |
| 권한 | 프로젝트 구성원 누구나 (시트 편집 권한과 동일) |
| 아키텍처 | **B: 서버 액션이 DB 기준으로 정규화 계산**, 적용은 기존 `saveWeeklyCells` 재사용 |

## 정규화 규칙 (`src/lib/domain/weeklyFormat.ts`, 순수 함수)

`normalizeCellText(text: string): string` — 줄 단위 적용:

1. **공백**: 줄 끝 공백 제거 · 공백만 있는 줄은 빈 줄로 · 연속 빈 줄 1개로 · 셀 앞뒤 빈 줄 제거
2. **상위(1단계)**: `1.` `1)` `(1)` `①` 등 숫자 마커 줄 → 등장 순서대로 `1. ` `2. ` … 재부여
   (붙여 쓴 `1.내용`도 `1. 내용`으로)
3. **하위(2단계)**: `-` `-.` `·` `•` `*` `→` 시작 줄 → `␣␣-.␣내용` (2칸 + `-.` + 공백 1)
4. **3단계**: `.` 시작 줄(숫자 아님) → `␣␣␣␣.␣내용` (4칸) — PPT 변환기(`sheetLineText`)의
   `.`=3단계 관례와 일치
5. **빈 줄 정책**: 빈 줄은 상위 항목 사이에만 정확히 1개 — 그 외 위치(상위–하위,
   하위–하위 사이)의 빈 줄은 제거. 상위 항목이 하나도 없는 셀은 재배치 없이 공백 규칙(1)만 적용
6. **불변 원칙**: 마커·들여쓰기·빈 줄 외 한 글자도 불변. 마커 없는 일반 줄 그대로
7. **멱등성**: `f(f(x)) === f(x)` 테스트로 보장

`unifySheetRows(rows: WeeklySheetRow[]): WeeklyFormatEdit[]` — 4열(this_content,
this_issue, next_content, next_issue) 전부 정규화해 **바뀌는 셀만**
`{ rowId, cellKey, section, before, after }`로 반환.

## 서버 액션 (`src/app/actions/weekly.ts`)

**`previewWeeklyFormat(projectId, reportId)`** → `{ ok, edits: WeeklyFormatEdit[] }`
- 로그인 확인 → DB에서 rows 직접 조회(권위 있는 저장 상태, RLS 자동 반영) → `unifySheetRows`.
- 실패는 `{ ok: false, error }` (silent-empty-screens 원칙: 표시=로깅).

**적용 액션은 만들지 않는다** — 미리보기에서 확인한 `after`를 기존 `saveWeeklyCells`
배치로 저장(WYSIWYG: 본 것 = 적용되는 것). 멱등 배치·goneRowIds 스킵·Realtime 전파를
그대로 상속. 10구분 × 4열 = 최대 40 edits ≪ BATCH_MAX 500. 셀 상한 20,000자는
정규화로 위협받지 않는다(빈 줄 1~수 개 증감 수준).

## 클라이언트 흐름 (`WeeklySheetView`)

```
[양식 통일] 클릭
 → flushPendingSaves()          미저장 셀 커밋(PPT 내보내기와 동일 가드) — 실패 시 중단
 → previewWeeklyFormat()        변경 0건이면 "이미 통일된 양식입니다" 토스트로 종료
 → FormatUnifyModal             변경 셀만 before/after 표시
 → [N개 셀 적용]
 → saveWeeklyCells(after들)     기존 배치 경로
 → 성공 시에만 pushUndo({before, after})  Ctrl+Z 한 번에 전체 되돌리기
 → 로컬 rows 갱신 + 성공 토스트
```

**동시 편집**: 미리보기 열림~적용 사이의 타 사용자 편집은 시트 기존 관례대로
last-write-wins(미리보기의 after가 덮어씀). 충돌 감지는 만들지 않는다(YAGNI) —
겹쳐도 Ctrl+Z·Realtime으로 복구·전파된다.

## UI

- **버튼**: WeekNav 내보내기 그룹 맨 왼쪽 — `양식 통일 · 주간보고요약 (PPT) · 주간보고상세 (PPT)`
  순서(왼→오가 작업 순서). btn-ghost + Wand2 아이콘. EmptyState(시트 없음)에서는 비활성,
  처리 중 busy 비활성.
- **모달** `src/components/weekly/FormatUnifyModal.tsx` — 공용 `Modal` 재사용.
  변경 셀만 「구분 · 열 이름」 헤더 + before/after 2열(모노스페이스, `whitespace-pre-wrap`,
  시트와 같은 이유로 밝은 고정 색상). 푸터: 취소 · `N개 셀 적용`(btn-primary).

## 에러 처리

- flush 실패 → 기존 문구로 중단 토스트, 모달 미오픈
- preview 실패 → "양식 검사 실패" + 서버 error 토스트
- 적용 DB 에러 → "일부 저장 실패 — 다시 시도" 토스트(배치 멱등이라 재시도 안전),
  **undo push는 성공 시에만**
- goneRowIds → 해당 셀 스킵 안내(기존 시맨틱)

## 테스트

- `tests/domain/weeklyFormat.test.ts` — 실데이터 픽스처: `-CBO`(붙임), `-.` 들여쓰기 0~5칸,
  중복 번호 재부여, `1)`/`①`, 공백만 줄, 문장 내부 보존(`대상 : `), 마커 없는 줄 불변,
  빈 셀, 멱등성
- `tests/ui/` — 모달 미리보기→적용 시 `saveWeeklyCells` 호출 값, 변경 0건 토스트,
  Ctrl+Z 되돌리기 통합
- 서버 액션 — 미로그인 거부, 빈 시트

## 범위 밖 (명시)

- AI 문체 정리(사용자가 배제), PPT 내보내기 시 자동 정규화(수동 버튼만),
  충돌 감지 UI, DB 스키마 변경(없음)
