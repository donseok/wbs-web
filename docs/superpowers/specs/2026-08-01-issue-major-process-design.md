# 이슈 Major Process 입력·체번 설계

날짜: 2026-08-01 · 상태: 확정(자율 세션 — 사용자 요청 원문과 표준 템플릿 실측 기반)

## 요구(사용자 원문 요지)

회의록에서 이슈 등록할 때 Mega(선택 유지)·Major(입력)·Sub(입력)를 모두 기록할 수 있어야 한다.
나중에 이슈 분석서 PPT의 해당 페이지(As-Is 프로세스 체계) 제작에 입력이 자연스럽게 연결돼야
하고, 이슈 ID 체번과 연계된다. **각 Mega별 Major 체번은 등록순 01, 02, 03…** 이다.

## 템플릿 실측(정본 근거)

`docs/design/2. 이슈 분석서(작성 템플릿)_부산운영팀_1_….pptx` 슬라이드 분해 결과:

| 페이지 | 관찰 | 결론 |
|---|---|---|
| 슬라이드 8·9 (영역별 이슈 종합) | 이슈 ID `PI-I-02-01`~`06` — Mega별 일련 | **이슈 ID 형식은 현행 유지** (`PI-I-{mega}-{seq}`, 0055 카운터) |
| 슬라이드 6·7 (프로세스 정의) | Major 표기 `02.01 기준정보`, `02.02 주문관리` | Major 코드는 `{mega}.{seq2}` — Mega별 등록순 01부터 |
| 슬라이드 5 (프로세스 체계) | Mega 셰브런 아래 Major 박스, 그 아래 Sub 박스 | Major는 프로젝트 수준 엔터티(이슈 없이도 존재 가능한 분류) — 이슈가 참조 |
| 슬라이드 8 헤더 | `Major Process 02.02 주문관리` 단위로 이슈 묶음 + `구분(Sub Process)` 열 | PPT는 Major 단위 그룹핑을 요구 → 자유 텍스트가 아니라 체번된 엔터티 필요 |

"이슈 아이디 체번과도 연계"는 **Mega 코드를 공유하고 Mega별로 동시성 안전하게 체번**한다는
Major에도 적용하라는 뜻으로 해석한다. 이슈 ID 형식 변경 아님(기존 발급분 불변 계약 유지).

## 설계

### 데이터 (0062)

- `issue_major_processes(id, project_id, mega_code, major_seq, name)` —
  unique (project,mega,seq) · (project,mega,name) · (id,project,mega).
  `major_seq`는 **프로젝트×Mega advisory transaction lock + MAX+1을 수행하는 security definer
  BEFORE INSERT 트리거**로만 발급한다. 같은 범위를 직렬화하므로 동시 등록에도 안전하고,
  이름 유니크 충돌이 롤백돼 번호만 소모되는 결번이 생기지 않는다. 직접 주입은 거부하고
  발급 후 project/mega/seq는 불변이다.
  RLS: 읽기 authenticated 전체(이슈 관례), insert는 `is_project_member(project_id)`
  (프로젝트 스코프 — 수퍼유저 포함, 0052), update/delete 정책 없음(개명·삭제는 향후 관리 기능).
- `issues.major_id uuid` + 복합 FK `(major_id, project_id, mega_code) →
  issue_major_processes(id, project_id, mega_code)` — Major가 이슈와 같은 프로젝트·같은
  Mega에 속함을 선언적으로 보장. 레거시(이미 분류됐지만 Major 없는) 이슈는 null 허용.
- `assign_issue_analysis_code` 확장: **pi 코드가 새로 체번되는 순간(insert 또는 최초 분류)
  major_id 필수**. 이미 체번된 이슈의 major_id 변경은 허용(레거시 백필·오분류 교정),
  mega 불변 규칙은 기존 그대로.
- `create_issue_from_minute_block` RPC에 `p_major_name` 추가(구 시그니처 drop — 0055 관례).
  함수 안에서 resolve-or-create(있으면 재사용, 없으면 insert→트리거 체번) 후 major_id 저장.
- 같은 이름 재등록 = 기존 Major 재사용(체번 유지), 새 이름 = 다음 번호. 이름이 dedupe 키.

### 앱

- `IssueAnalysisInput`에 `majorName`(필수, trim, ≤100자) — 폼·서버 액션 공용 검증.
- `formatIssueMajorCode(mega, seq)` → `02.01` (2자리 패딩, 100+ 자연 확장 — pi 코드와 동일 규칙).
- createIssue/updateIssue(사용자 클라이언트): select→insert→(23505 경합 시 재select)로 Major
  해소 후 major_id 기록. 회의록 경로는 RPC 한 트랜잭션.
- 폼: Mega 셀렉트(유지) → **Major Process 입력(datalist 자동완성, `02.01 기준정보` 표기)** →
  Sub Process 입력(유지). AI 초안 스키마를 5키(`majorProcess` 추가)로 확장, 기존 Major
  목록을 프롬프트 컨텍스트로 제공해 이름 재사용을 유도. 캐시 키 v4로 승격.
- 상세 모달 분석 섹션에 Major 행(`02.01 · 기준정보`) 표시.

### 배포 순서

0062를 Management API로 먼저 적용 → 즉시 코드 배포. **적용~배포 윈도우에는 이슈 생성이
전부 거부된다** — 회의록 파생 등록(구 RPC 소멸)뿐 아니라 구버전 앱의 일반 등록·레거시 최초
분류도 트리거(ISSUE_MAJOR_REQUIRED)가 막는다(0055보다 넓은 중단 범위 — 두 단계 연속 실행 필수).
마이그레이션 커밋과 코드 커밋 분리(G1).

### 알려진 한계(리뷰 확정, 수용)

- **고아 Major**: 일반 등록/수정 경로는 Major resolve(1차 트랜잭션) 후 이슈 쓰기(2차)가
  분리돼 있어, 2차가 실패하면 번호가 발급된 Major만 남는다. 같은 이름 재시도 시 그 행을
  재사용하므로 결번은 아니며, 정리는 향후 관리 기능(개명·삭제)에서. 회의록 RPC 경로는
  한 트랜잭션이라 해당 없음.
- **getIssues 열화**: Major 목록 조회 실패 시 목록 화면은 이름·번호 null 로 열화(로그 필수,
  기존 읽기 계층 정책과 동일). 분석서 로더는 반대로 strict throw.

### 범위 밖(YAGNI)

- PPT "As-Is 프로세스 체계" 페이지 생성 자체(사용자가 "나중에"로 명시 — 데이터만 준비).
- Major 개명·삭제 관리 UI, Mega 필터 외 Major 필터, 레거시 이슈 일괄 백필.
