# wbs.md N단 계층 계약 — 단계 선언·진도 역할·샘플 (2026-08-21 설계 논의)

대형 MES 형 프로젝트(최대 8단: Project→Phase→System→Subsystem→WP→Activity→Task→SubTask)를
wbs.md 한 파일로 표현하기 위한 계약 초안. 코드 구현 전 설계 정본.

배경 결정 (같은 날 대화에서 확정):

- 트리 최상단 분해축 = 계약 구조. Program 은 트리 층이 아니라 우산 — 프로젝트별 독립 트리 + PMO 통합관리.
- Phase 는 Project 안 (분석→설계→구축→통합테스트→적용). 구축 Phase 만 깊은 제품 트리, 선행·후행은 산출물·시나리오 축의 얕은 비대칭 트리.
- L2 I/F 는 Subsystem 급으로 승격(공정 축: PLTCM·2CGL…ACCL), ERP I/F 는 업무 축(생산실적·작업지시). 같은 레벨 형제끼리 다른 축 허용, 한 부모 밑 축 혼합 금지.
- ERP I/F 는 쌍 구현 — I/F 1건 = 양쪽 트리에 Task 2개 + PMO 대장 1행(`if-id`). 연동 검증은 별도 Task.
- 골격(Phase~System)은 PM/PMO 소유·잠금, System 아래는 담당 PL 소유·업로드. 업로드 시 자동 검증 필수.
- D'Flow 코어는 N단 준비됨(parent_id 트리, 0064 에서 level drop). 병목은 project_settings 시드(pi 3단 하드코딩)와
  설정 편집 UI 부재, 레거시 excel export 3열 하드코딩. 혼재 허용 시 노드별 level 저장(import 계약 `level` 필드 + wbs_items 컬럼) 필요.

## 계약 요점

### 단계 판정

- **접두어가 단계 판정의 정본** (`TSK-` = Task). 헤딩 깊이·리스트 들여쓰기는 부모 판정용(구조).
- 검증: 자식의 단계 순번 > 부모의 단계 순번. 건너뛰기 허용(선택층), 역행·동급 금지.
  `optional: false` 층 건너뛰기는 경고.
- 마크다운 헤딩 6단 한계는 리스트 들여쓰기가 흡수 — `levels` 선언만 늘리면 8단+ 표현 가능.
- WP→Task 와 WP→Activity→Task 혼재 허용. 같은 단계가 다른 트리 깊이에 있을 수 있다.

### progress 역할 4종 (levels 의 층별 선언)

| 값 | 기록 | 집계 영향 | 용도 |
|---|---|---|---|
| `input` | stage/% | 부모 롤업에 들어감 (weight 가중) | Task |
| `rollup` | 없음(자동 계산) | 자식 집계 통과. **이 층 노드가 leaf 면 import 에러** | Phase~WP, Activity |
| `checklist` | 완료 ○/× 만 (이력 있음) | **없음 — 집계에 투명.** 부모는 input 유지 | SubTask, 확인 항목 |
| `none` | 없음 | 없음 | 마일스톤·참고 행 |

- checklist 는 leaf 전용(밑에 자식 금지). "자식 생기면 롤업 전환" 규칙이 checklist 자식에는 발동하지 않는다.
- Task 완료 전이 시 미체크 checklist 경고/차단 게이트로 활용 가능.
- 발행·배정 대상 = `input` 층 (현행 "task kind 만 발행" 의 일반화).

### 진도율 원칙

- 입력은 leaf 한 곳(stage 전이 기반 크레딧), 나머지 전부 자동 롤업. % 수기 입력은 예외.
- 롤업은 weight(계획 MD) 가중 — 개수 평균 금지.
- 보고 단위 = WP(`report: weekly`), Control Account = System/Subsystem.
- 선행 Phase 산출물은 doc 크레딧(미착수/작성중/제출/검수완료), I/F 는 연동검증 전 50% 상한.

## 샘플 wbs.md

```markdown
---
project: MES
module: mes-op
start_date: 2026-09-01

# 단계 정의 — 이름·접두어·진도 역할. 이 배열이 프로젝트 설정(level_labels)의 정본.
levels:
  - { name: Phase,     prefix: PH,  progress: rollup }
  - { name: System,    prefix: SYS, progress: rollup }
  - { name: Subsystem, prefix: SUB, progress: rollup }
  - { name: WP,        prefix: WP,  progress: rollup, report: weekly }
  - { name: Activity,  prefix: ACT, progress: rollup, optional: true }
  - { name: Task,      prefix: TSK, progress: input }
  - { name: SubTask,   prefix: STK, progress: checklist, optional: true }

# input 층의 stage → 진도 크레딧 (category 별)
credits:
  default: { 대기: 0, 설계: 20, 구현중: 50, 구현완료: 70, 테스트완료: 90, 검수완료: 100 }
  if:      { 대기: 0, 구현중: 30, 구현완료: 50, 연동검증: 100 }   # I/F 는 연동돼야 절반 이상
  doc:     { 미착수: 0, 작성중: 30, 제출: 50, 검수완료: 100 }      # 선행 산출물용
---

# WBS — MES

## PH-01: 분석

### SYS-OP: 조업

#### WP-AN-OP: 조업 요건정의
- [ ] TSK-AN-001: 조업 AS-IS 분석서            @박PL  w:5  ~2026-09-19  credit:doc
- [ ] TSK-AN-002: 입측/출측 요건정의서          @박PL  w:5  ~2026-09-26  credit:doc
- [ ] TSK-AN-003: L2 I/F 요건 목록             @이OO  w:3  ~2026-09-26  credit:doc
- [M] 분석 완료 보고회                          ~2026-09-30              # progress:none — 마일스톤

## PH-03: 구축

### SYS-OP: 조업

#### SUB-IN: 입측

##### WP-IN-PR: 프로세스

###### ACT-IN-PR-1: 실적 관리                                # Activity — 그룹핑 전용, 입력 금지
- [ ] TSK-IN-001: 입측 실적 수집 프로세스       @홍길동 w:5  ~2026-10-17
  - [ ] STK-IN-001-1: 크레인 계량 연계 확인                   # checklist — 집계 불개입
  - [ ] STK-IN-001-2: 중복 수신 방어 로직
  - [x] STK-IN-001-3: 실적 테이블 설계 리뷰
- [ ] TSK-IN-002: 입측 실적 정정               @홍길동 w:3  ~2026-10-24
- [ ] TSK-IN-003: 실적 마감 배치               @김대리 w:2  ~2026-10-24

###### ACT-IN-PR-2: 판정
- [ ] TSK-IN-011: 입측 판정 프로세스            @홍길동 w:5  ~2026-10-31
- [ ] TSK-IN-012: 판정 예외 처리               @홍길동 w:2  ~2026-10-31

##### WP-IN-UI: 화면                                          # Activity 생략 — Task 직결 (혼재 OK)
- [ ] TSK-IN-101: 입측 작업 현황 화면           @김철수 w:3  ~2026-10-17
- [ ] TSK-IN-102: 입측 실적 조회 화면           @김철수 w:2  ~2026-10-24
- [ ] TSK-IN-103: 입측 수동 보정 화면           @김철수 w:3  ~2026-10-31

#### SUB-OUT: 출측

##### WP-OUT-PR: 프로세스
- [ ] TSK-OUT-001: 출측 실적 수집 프로세스      @최OO  w:5  ~2026-11-07
##### WP-OUT-UI: 화면
- [ ] TSK-OUT-101: 출측 작업 현황 화면          @김철수 w:3  ~2026-11-07

#### SUB-L2IF: L2 I/F

##### WP-L2-2CGL: 2CGL

###### ACT-2CGL-RX: 수신
- [ ] TSK-L2-221: 트래킹 수신 I/F              @이OO  w:5  ~2026-11-14  credit:if
  - [ ] STK-L2-221-1: 전문 파싱 모듈
  - [ ] STK-L2-221-2: 재전송 처리
- [ ] TSK-L2-223: 품질실적 수신 I/F            @이OO  w:3  ~2026-11-21  credit:if

###### ACT-2CGL-TX: 송신
- [ ] TSK-L2-222: 코일 정보 송신 I/F           @이OO  w:3  ~2026-11-21  credit:if

##### WP-L2-ACCL: ACCL
- [ ] TSK-L2-291: 실적 수신 I/F                @이OO  w:3  ~2026-11-28  credit:if

#### SUB-ERPIF: ERP I/F

##### WP-ERP-PR: 생산실적
- [ ] TSK-ERP-301: 조업 실적 ERP 송신 I/F      @박OO  w:5  ~2026-11-28  credit:if  if-id:IF-0031
- [ ] TSK-ERP-302: 실적 정정 송신 I/F          @박OO  w:2  ~2026-12-05  credit:if  if-id:IF-0033
##### WP-ERP-WO: 작업지시
- [ ] TSK-ERP-311: 생산오더 수신 I/F           @박OO  w:3  ~2026-12-05  credit:if  if-id:IF-0032
```

## 표기 규약 (파서 계약)

| 표기 | 의미 |
|---|---|
| 헤딩 깊이 / 리스트 들여쓰기 | 부모 판정 (구조) |
| `PH- SYS- SUB- WP- ACT- TSK- STK-` 접두 | **단계 판정 (정본)** — 자식 순번 > 부모 순번 검증 |
| `- [ ]` / `- [x]` | input 층: 초기 stage / checklist 층: 완료 체크 |
| `- [M]` | 마일스톤 — `progress: none`, 일정만 |
| `@이름` | 담당 (import 시 멤버 매칭) |
| `w:N` | weight (MD) — 롤업 가중치. 생략 시 1 |
| `~날짜` | 계획 종료일 |
| `credit:키` | stage 크레딧 표 선택. 생략 시 default |
| `if-id:` | PMO I/F 대장 참조 (쌍 연결) |

## 구현 착수 시 범위 (미착수 — 설계만 확정)

1. 프로젝트 설정에 level_labels·max_depth 편집 (관리자 전용 서버 액션 + UI, 축소 시 기존 트리 depth 검증 fail-closed)
2. Excel export/import 동적 단계 열 (A안: 단계별 열, 헤더 = level_labels, 레거시 3열 하드코딩 제거)
3. import 계약 v2.2: 노드별 `level` 필드 + progress 역할, wbs_items 저장
4. stage→크레딧 환산 + weight 필드 + 롤업 쿼리 (checklist 제외)
