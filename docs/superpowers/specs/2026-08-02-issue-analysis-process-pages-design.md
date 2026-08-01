# 이슈 분석서 PPT — As-Is 프로세스 체계 페이지(5·6·7) 자동 생성 설계

- 날짜: 2026-08-02
- 상태: 설계 확정 (사용자 승인 완료)
- 선행: `2026-08-01-issue-major-process-design.md`(0062)가 "PPT 페이지는 후속"으로 미룬 바로 그 작업
- 참조 셈플: `docs/design/2. 이슈 분석서(작성 템플릿)_부산운영팀_1_2026-07-31_이돈석 (1).pptx` 5·6·7페이지

## 1. 목표

표준 템플릿의 5페이지(As-Is 프로세스 트리)와 6·7페이지(프로세스 정의)를 이슈 분석서
PPT 생성 시 자동으로 포함한다. 현재 `deckPlan.ts`는 "5~7 프로세스 체계 제외"로 이 소스
슬라이드들을 쓰지 않는다. 산출물은 **초안**이다 — 사용자는 다운로드한 PPT에서 확인·보완한다.

## 2. 브레인스토밍 결정 사항 (사용자 확정)

| # | 질문 | 결정 |
|---|---|---|
| 1 | 정의 문장(어디에도 없는 데이터)을 어떻게 만들까 | **AI 생성 편입** — 기존 이슈분석 실행(원인분석·개선기회)에 정의 생성을 추가 |
| 2 | 초안 보완 위치 | **PPT에서 보완** — 앱 내 편집·영속화 없음. 재생성하면 PPT 수정본은 새 초안으로 대체됨을 인지 |
| 3 | 트리 용량 초과 처리 | **전량 유지** — Sub 세로 초과는 "이름(계속)" 열로 이어 그리고, 열 8개 초과는 트리 페이지를 (1/2)(2/2)로 분할. "외 N건" 캡을 쓰지 않는다 |

추가 결정(설계 제시에 포함, 함께 승인됨):

- Major 범위 = 프로젝트×Mega의 **마스터 전체**(`issue_major_processes`, seq순). 이슈가 참조하지
  않는 Major도 트리·정의에 포함한다(As-Is 체계는 이슈 유무와 무관한 프로세스 지형).
- Major 미지정 레거시 이슈(0062 이전, `major_id` null)는 트리 마지막에 **"(미지정)"** 열로
  그 구분(sub_process)들을 표시한다(회의록 탐색기의 '미지정' 관례). 정의 페이지에서는 제외.
- 배치는 셈플 그대로: Mega 섹션마다 **트리 → 정의 → 이슈 종합 → 원인분석** 순.

## 3. 데이터 — 마이그레이션 불필요

필요한 데이터는 전부 있다. 코드만 바꾼다.

- Major 마스터: `issue_major_processes`(0062) — project×mega, `major_seq`(01, 02…), `name`.
  표기는 `{megaCode}.{seq2}`(예: `02.01 기준정보`). 결번 없는 체번은 0062가 보장.
- 이슈→Major: `issues.major_id`. 로드 경로(`loadIssueAnalysisIssues`)가 이미 majors를 join.
- Sub: 이슈의 `sub_process` 자유 텍스트(구분). preflight 필수 필드라 ready 이슈는 항상 보유.
- Mega 체브론: `ISSUE_MEGA_AREAS` 8종(00 기준관리 ~ 07 원가) — 템플릿 체브론 8칸과 1:1.

### 3.1 스냅샷/저장 스키마 (additive, 버전 유지)

`issue-analysis.v1`을 유지하고 `causeAnalyses` 관례대로 optional 필드만 더한다.

- `IssueAnalysisInputSnapshot.areas[]`에 `majors: Array<{ id, majorSeq, name }>` 추가
  (해당 Mega의 마스터 전체, seq순).
- `IssueAnalysisReportIssue`에 `majorId: string | null` 추가.
- 저장 report의 area에 `processDefinitions?: { megaDefinition: string,
  majors: Array<{ majorId: string, definition: string }> }` 추가.
- 파서(`storedRun.ts`): `processDefinitions` 없는 구버전 실행은 그대로 통과 —
  덱 플랜이 프로세스 페이지를 생략하고 지금과 동일하게 렌더한다(하위호환).
- 입력 해시가 바뀌고 프롬프트 버전이 오르므로 **기존 캐시는 다음 실행 때 1회 재생성**된다.

## 4. AI 생성 — 프롬프트 v2 → v3

기존 Mega별 개선기회 프롬프트를 확장한다. **LLM 호출 수는 지금과 동일**(무료 티어 RPM 20 보호).
별도 프롬프트 분리(호출 +N)와 다운로드 시점 생성(비결정적·다운로드 실패 결합)은 기각했다.

- `ISSUE_ANALYSIS_PROMPT_VERSION` = `issue-causes-opportunities-defs-v3`.
- 입력 추가: majors 목록 `[{ majorId, seqLabel, name, subProcesses[], issueCount }]`.
- 출력 추가: `megaDefinition`(≤200자), `majorDefinitions: [{ majorId, definition ≤150자 }]`.
- 스타일 가이드(프롬프트에 명시): 셈플 톤의 명사형 종결("…을 관리하는 프로세스",
  "…하는 일련의 프로세스임"), 이슈 제목·내용·구분을 근거로 하되 이슈가 없는 Major는
  이름만으로 일반적 정의 초안(초안이므로 허용).
- 검증(기존 opportunities/causes 검증 관례): 입력 majors 전원이 정확히 1회, 입력에 없는
  majorId 거부, 빈 정의 거부, 길이 상한 초과 거부. 실패 처리(재시도/실패)는 기존 파이프라인 그대로.
- LLM 미설정 시 실행 자체가 안 되는 것은 기존과 동일 — 새 실패 모드 없음.

## 5. 덱 플랜 — 새 슬라이드 kind 2종

```
| { kind: 'process-tree', sourceSlide: 5,
    megaCode, megaName, pageInSeries, pageCount,
    headline: string,
    columns: Array<{ label: string, continuation: boolean, subs: string[] }> }  // ≤8열, subs ≤6
| { kind: 'process-definition', sourceSlide: 6,
    megaCode, megaName, pageInSeries, pageCount,
    megaDefinition: string,
    rows: Array<{ seqLabel: string, name: string, definition: string }> }       // ≤4행
```

- 배치: populated area마다 `process-tree*` → `process-definition*` → `area-summary` → ….
  report에 `processDefinitions`가 없으면(구버전 실행) 두 kind 모두 생략.
- 트리 열 구성 알고리즘:
  1. majors를 seq순으로 순회. 각 Major의 subs = 그 Major 소속 이슈들의 구분 고유값
     (compact 기준 dedup, 표시 문자열은 first-appearance의 compact 결과,
     순서는 이슈 체번 `megaSeq`순 first-appearance).
  2. subs를 6개 단위로 chunk. 첫 chunk는 `이름`, 이후 chunk는 `이름(계속)` 라벨의 연속 열.
     **subs가 0개인 Major(마스터에 있으나 이슈 미참조)도 Sub 박스 없는 열 1개를 차지한다** —
     트리에서 사라지면 안 된다.
  3. 미지정(majorId null) 이슈가 있으면 그 구분들로 `(미지정)` 열(들)을 마지막에 추가.
     연속 열 라벨 규칙은 Major와 동일(`(미지정)(계속)`).
  4. 열 시퀀스를 8열씩 페이지로 자른다. 다중 페이지면 제목에 `(i/n)`, 체브론·헤드라인 반복.
- 헤드라인: `현행 {megaName} 프로세스는 {Major 이름 상위 3개}, … 등 N개의 Major 프로세스와
  M개의 Sub 프로세스로 구성됨` — N = 마스터 Major 수(미지정 제외), M = 트리에 표시되는
  구분 고유값 총수(미지정 포함).
- 정의 페이지: majors seq순 4행씩. `seqLabel` = `{megaCode}.{lpad(seq,2)}`. Mega 정의 박스는
  각 페이지 반복(셈플 그대로). `(미지정)`은 정의 페이지에 없다.
- 빈 케이스: majors 0 + 미지정 subs만 → 트리는 `(미지정)` 열만, 정의 페이지 생략.
- 정의 텍스트는 상한(200/150자)이 박스 실측(셈플 ~110자 3줄)에 들어가므로 페이지 분할 없음.
  장문 구분명·Major명은 박스 안 자동 줄바꿈 + 기존 autofit 유틸로 흡수.

## 6. 렌더러 — 템플릿 지오메트리 재사용 (실측 완료)

새로 그리지 않는다. 소스 슬라이드 5의 **8열 고정 지오메트리를 그대로 쓰고 남는 것을 지운다**.
기존 프리미티브(`deleteShapeOrConnector`, `withElementTransform`, `appendShapeTreeElements`,
`setShapeText`)로 충분함을 확인했다.

- 실측(px = EMU/9525): Major 박스 y≈287, w=98, 열 x피치 ≈111 (x ≈ 124/236/347/458/569/680/791/903).
  Sub 박스 w=102 h=41, y = 381 + 50k. **열당 최대 6칸**(k=0..5, 마지막 박스 하단 y≈672,
  푸터 직전) — 구현 때 렌더 결과를 눈으로 보고 최종 확정한다.
- 트리 렌더 절차: ① 체브론 8칸 라벨을 `ISSUE_MEGA_AREAS`로 세팅, 현재 영역만 진한 스타일
  (템플릿의 active 도형 id=135 / inactive 도형을 프로토타입 2종으로 삼아 8칸을 재구성).
  ② 열 슬롯별 Major 라벨·Sub 박스 텍스트 채움 — 템플릿 열의 기존 Sub 수보다 부족하면 삭제,
  많으면 복제(y+50px 시프트). ③ 사용하지 않는 열은 박스+연결 커넥터 모두 삭제.
  ④ 제목 `As-Is 프로세스 체계 – {megaCode}_{megaName}` (다중 페이지 시 `(i/n)`), 헤드라인 채움.
- 정의 렌더: 모든 정의 페이지는 **소스 슬라이드 6만 복제**(7은 사용하지 않음 — 6과 같은
  레이아웃의 셈플 텍스트 변형일 뿐). 4행 중 빈 행은 이름·정의 박스+커넥터 삭제.
- 푸터 페이지 번호는 기존 `setPageFooter` 관례를 따른다.

## 7. UI

`IssueAnalysisModal`에 Major 미지정 이슈가 있을 때 안내 1줄: "Major 미지정 이슈 N건은
트리에 '(미지정)'으로 표시됩니다." 차단하지 않는다(preflight 차단 조건 불변).
카운트는 기존 preflight 응답으로 계산 가능하면 재사용, 아니면 응답에 카운트만 추가.

## 8. 테스트

- `tests/report/` deckPlan: 8열/6칸/4행 페이지네이션 경계, `(계속)` 라벨, `(미지정)` 열,
  processDefinitions 부재 시 생략(하위호환), 헤드라인 조립, 배치 순서.
- `tests/ai/`: v3 응답 파서·검증(누락·조작·상한 초과·빈 정의 거부).
- 렌더러: `tests/report/issue-analysis-export.test.ts` 기존 패턴(XML 구조 검증)으로
  트리 열 삭제/복제·체브론 스타일·정의 행 삭제를 검증.
- 수동: D-CUBE 실데이터로 실행 → PPT 눈 확인. 분석 실행은 원래 기능의 쓰기 경로(runs 저장)
  이므로 데이터 훼손 없음.

## 9. 배포 메모

- 마이그레이션 없음, UI 위험 파일(`src/components/app/*` 등) 없음 → main 직행 가능.
- 이슈 데이터가 있는 프로젝트에서 실행 1회는 캐시 재생성(프롬프트 v3)이 되므로
  첫 실행이 평소보다 오래 걸릴 수 있다 — 예상된 동작.
