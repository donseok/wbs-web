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

### 업로드 범위 — 층별 `upload` (2026-08-21 추가)

파일엔 세밀하게 쪼개되 D'Flow 엔 관리 단위까지만 올리는 경우를 위해 층별 `upload` 를 선언한다.

| 값 | 의미 |
|---|---|
| `true` (기본) | wbs_items 노드로 업로드 |
| `false` | 업로드 제외 — 파일 전용 메모 |
| `fold` | 노드로는 안 올리되 부모 노드의 필드로 접어 올림 — checklist 층이면 부모 Task 의 `acceptance` 배열로 (import 계약에 acceptance jsonb 이미 존재, 0082 RPC) |

- **아래에서 위로만 끌 수 있다**: 한 층이 `false`/`fold` 면 그보다 깊은 층 전부 동일 — 중간층만 빼면 자식의 parent_external_ref 가 끊긴다. 검증기가 막는다.
- `progress: input` 층은 `upload: true` 강제 — 발행·배정 대상이 안 올라가면 모순.
- checklist 층 기본 권장 = `fold`: STK 를 아예 안 올리면 "Task 완료 전이 시 미체크 경고" 게이트가 은퇴하는 wbs.md 에만 남는다. fold 면 게이트가 서버에서 작동하고 트리는 안 지저분해진다. `false` 는 정말 사적인 메모 전용.
- 부수 이득: import 1회 1,000노드 상한 절약.

### 분리 업로드 — PMO 골격 + PL 모듈 파일 (2026-08-21 추가)

- PMO 골격 파일(Phase·System, `owner: pmo`)이 먼저, PL 파일 5개(공통/품질/생산계획/조업/물류)가 각자 `module` 다르게 같은 프로젝트로 업로드.
- PL 파일 frontmatter: `attach: PH-03/SYS-OP` — 업로드 부착점. 서버에 그 노드 없으면 fail-closed 거부(골격 선행이 기계 검증됨). attach 는 모듈 경계를 넘는 참조(`mes-skel/SYS-OP`)라 import v2.2 에 크로스 모듈 해석 규칙 필요.
- PL 파일의 levels 는 프로젝트 정본(PMO 골격이 시드한 level_labels)과 일치해야 통과 — PL 임의 층 추가 차단.
- 골격 층은 PL 파일에서 `owner: pmo, upload: false` 로 선언만(접두어 해석용) — 본문에 쓰면 검증 에러.
- 파일 배치 권장: 디렉토리 분리 `docs/mes/조업/wbs.md` (module = 디렉토리 세그먼트 파생, 현행 dflow-export 관례 그대로). 파일명 분리(wbs_조업.md)도 계약상 유효하나 module 매핑 표가 하나 더 필요.
- module = 파일 1:1 강제. external_ref 가 `{module}/{ID}` 네임스페이스라 PL 간 ID 채번 조율 불필요, 타 모듈 데이터 침범 구조적 불가.

**확정(2026-08-22 사용자 결정) — attach 는 단일 노드 유지(b안)**: 모듈 파일은 전부 PH-03/SYS-* 아래로
정론화한다 — 모듈 통테 준비·시나리오도 "모듈 검증까지가 구축"으로 보고 구축 소속. PH-01·02·04·05 는
PMO 골격 전유(전사 시나리오·L2 실통신·ERP 연동은 골격 Task 로 이미 존재). a안(attach 복수)은
파일 구조·검증·서버 로직 복잡도 대비 이득(통테 공수의 PH-04 진도 반영)이 작아 기각.
스킬 GREEN 테스트(2026-08-21)에서 실측된 갭의 해소.

업로드 경로 2개, 정본 1개 (2026-08-21 추가):

- **웹 경로(사람/PL) — 자동 부착 + 확인** (✅ 2026-08-23 구현): `/p/{id}/import` 의 "WBS 마크다운" 모드 —
  파일 업로드 → TS 파서(`src/lib/wbsmd/parse.ts` — 스킬 파서와 동일 규칙)가 검증 → 서버 액션
  (`previewWbsUpload`)이 부착점 자동 판정(attach 마지막 세그먼트의 suffix 유일 매칭 — 0건/2건+ 은
  적용 불가)·levels 정합·신규/갱신/fold 건수를 미리보기 카드로 → [적용/취소]. 적용(`applyWbsUpload`)은
  미리보기를 신뢰하지 않고 전 과정 재검증 후 API 라우트와 같은 코어(`runWbsImport`)를 태운다.
  사람은 노드를 고르지 않고 **확인만** 한다 — 잘못된 파일이면 부착점 표시에서 드러난다.
  attach 없는 파일 = 골격 업로드(levels 시드)로 처리.
- **API 경로(자동화)**: frontmatter `attach` 필수, 확인 없이 적용(현행 import 동작).
- 웹 경로에서 확인 없는 완전 자동은 두지 않는다 — 그건 API 경로의 중복이고, 웹 경로의 존재 이유가 "적용 전에 사람이 본다"이다.
- **권한 결정 지점**: 현행 import 는 프로젝트 관리자 전용이고 노드 단위 소유 개념 없음. 1차 = PL 전원 관리자 + attach 검증(실수 방어, 악의 방어 없음 — 사내 소수 PL 수용). 2차 = System 노드 owner(또는 0071 project_teams 연결) 기반 "자기 서브트리만 import" — 노드 소유가 다른 기능(보고·결재)에 필요해질 때 함께.

### import 계약 v2.2 — 서버 수용 (2026-08-22 확정)

payload 확장 — `POST /api/v1/wbs/import` (PAT·관리자, 기존 필드는 v2.0 그대로):

```jsonc
{
  "project_id": "…", "module": "mes-op",
  "levels": [ { "name": "Phase", "prefix": "PH", "progress": "rollup" }, … ],  // frontmatter 그대로
  "attach_ref": "mes-skel/SYS-OP",   // PL 업로드 표식 — 골격 노드의 full external_ref
  "nodes": [ { …v2.0 필드…, "level": 5, "weight": 5, "milestone": false,
               "credit": "if", "if_id": "IF-0031" } ]
}
```

- **attach_ref 해석(크로스 모듈)**: frontmatter `attach: PH-03/SYS-OP` 는 경로 표기 — 업로더가
  골격 module 을 붙여 full external_ref(`mes-skel/SYS-OP`, 마지막 세그먼트만)로 변환해 보낸다.
  서버는 프로젝트 안에서 그 external_ref 를 찾아, **parent 없는 노드들의 부모로 연결**한다.
  없으면 400 `attach_not_found` — fail-closed(골격 선행의 기계 검증).
- **levels 처리 2경로**: ① attach_ref 없음 = 골격 업로드 → level_labels 를 project_settings 에
  시드(validateLevelSettings 통과 필수 — 트리 축소 fail-closed 동일 적용). ② attach_ref 있음 = PL
  업로드 → levels 의 name 배열이 서버 정본(level_labels)과 완전 일치해야 통과, 불일치 400
  `levels_mismatch`. levels 없는 payload 는 v2.0 레거시 경로(변경 없음).
- **노드 v2.2 필드**: `level`(levels 배열 인덱스 — wbs_items.level_idx 저장), `weight`(롤업 가중,
  0001 의 기존 컬럼 재사용, 양수만), `milestone`(`[M]` — progress none, 발행 제외),
  `credit`(크레딧 표 키 — credit_key 저장), `if_id`(PMO I/F 대장 참조).
- **발행 판정 일반화**: levels 있는 payload 는 `progress: input` 층이면서 milestone 아님 →
  dev_workflow=true (v2.1 의 `kind==='task'` 규칙의 일반화). levels 없으면 종전 kind 규칙.
- **fold / upload:false 는 업로더 몫**: 파서가 STK 를 부모 acceptance 로 접거나 제외한 뒤 보낸다 —
  서버는 그 노드를 아예 받지 않는다(acceptance jsonb 는 0077부터 수용). 서버 변경 없음.
- **rollup-leaf 는 서버 비차단**: 분리 업로드 특성상 골격 단독 시점의 SYS leaf 는 정상 과도기.
  차단하면 골격 선행이 불가능해진다. 합본 기준 검증은 스킬 검증기 몫.
- **마이그레이션 0089**: wbs_items 에 `level_idx smallint`·`milestone boolean`·`credit_key text`·
  `if_id text` 추가. RPC `import_wbs_upsert` 에 `p_attach_id uuid default null` 파라미터 추가
  (구 2인자 시그니처는 drop — PostgREST 오버로드 모호성 방지).
- **PAT 읽기 엔드포인트** `GET /api/v1/wbs/structure`: PL 스킬의 서버 직조회 원천 —
  levels(level_labels)+얕은 노드(기본 max_depth=1(0-base) = Phase·System 두 층,
  external_ref·name·parent_external_ref·depth·level_idx)를 반환.
  스코프 work:read, 멤버면 조회 가능(비멤버 404 존재 은닉). PL 조회 우선순위 사슬:
  ① 서버(structure) → ② 골격 파일 폴백 → ③ 에러(골격 선행).

### Water-Scrum-Fall 매핑 (2026-08-21 추가)

WSF 는 두 층위에서 반복된다. 기존 dflow-wbs 의 WP 번호 샌드위치(WP-00/01 선행 → 기능 WP → 통합 WP)는
N단에서 **Phase 층으로 승격**된다.

- **층위 1 — 프로젝트**: Phase 축 = WSF 그 자체. Water=PH-01 분석·PH-02 설계 / Scrum=PH-03 구축 /
  Fall=PH-04 통합테스트·PH-05 적용.
- **층위 2 — 모듈(재귀)**: PL 서브트리 안에서 dflow-wbs 고정 골격 사슬 그대로 —
  모듈 DB(ERD) 설계 → 모듈 공유 계약(계약 전용) → 프로그램 Task → 모듈 통합 시나리오.

소유권 × WSF × 스킬 모드:

| WSF 구간 | 트리 위치 | 소유 | 스킬 모드 |
|---|---|---|---|
| Water(전사): 분석·설계 골격, 전사 아키텍처·공통 계약 | PH-01·02 | PMO | `--skeleton` |
| Water(모듈): 모듈 요건분석·상세설계·DB·계약 Task | PH-01·02 하위 + PH-03 선두 | PL | PL 모드 |
| Scrum: 프로그램 Task(수직 슬라이스) | PH-03 | PL | PL 모드 |
| Fall(모듈): 모듈 내 통합 시나리오 | PH-04 하위 | PL | PL 모드 |
| Fall(전사): 시스템 관통·ERP 연동, 컷오버 | PH-04·05 골격 | PMO | `--skeleton` |

`--skeleton` = 샌드위치의 빵(Water·Fall 골격), PL 모드 = 속(모듈 Water 꼬리 + Scrum + 모듈 Fall).
경계 규칙 승계: 선행 분리는 "2+ 모듈 공유 or 마이그레이션 필요"만, 통테 결함은 해당 모듈에
`category: defect` Task 신설(되돌림), depends 사슬(스캐폴드→전사설계→전사계약→기능→itest)은 전사
계약 Task 의 소속만 PMO 골격으로 옮기고 형태 유지.

### 스킬 전략 (2026-08-21 사용자 결정 — 신규 스킬)

- **기존 `dflow-wbs` 는 동결** — 운영 중인 3~4단 흐름(mes-base 등)을 건드리지 않는다.
- **신규 스킬 `dflow-wbs-nlevel`** 이 이 계약(N단·levels frontmatter·progress·upload)을 구현한다.
  역할 분리는 스킬 분리가 아니라 **모드**: `--skeleton`(PMO 골격 + PL 배포 킷) / PL 모드(기본 —
  골격 파일에서 levels·키를 읽어 정합 강제, attach 자동 기입). 권한 강제는 스킬이 아니라
  서버(import owner 검증)의 몫.
- WSF 는 두 모드에 나뉘어 들어간다: `--skeleton` = Water·Fall 골격(빵), PL 모드 = 모듈 Water 꼬리 +
  Scrum + 모듈 Fall(속) — 위 매핑 표 참조.
- **업로드 게이트**: v2.2(E) 구현 전까지 이 스킬의 산출물은 작성·검수 전용 — levels·attach·fold 를
  서버가 아직 받지 않으므로 업로드는 dflow-export 정합 이후. 스킬 본문에 이 게이트를 명시한다.

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
  - { name: SubTask,   prefix: STK, progress: checklist, optional: true,
      upload: fold }   # 노드로 안 올리고 부모 Task 의 acceptance 로 접어 올림

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
| `- [M] {ID}: 제목` | 마일스톤 — `progress: none`, 일정만. **ID 필수**(external_ref — 파서가 강제, 2026-08-22). 접두어는 소속 층 아무거나(관례: 소속 WP 꼬리 + 90번대, 예 `TSK-AN-IF-90`) |
| `@이름` | 담당 (import 시 멤버 매칭) |
| `w:N` | weight (MD) — 롤업 가중치. 생략 시 1 |
| `~날짜` | 계획 종료일. 시작일은 import 가 파생한다 — 선행(depends) 종료 다음 영업일, 선행이 없거나 선행에 종료가 없으면 frontmatter `start_date`, 둘 다 없으면 비움(간트 막대 없음). 마일스톤은 파생 안 함 (2026-08-24) |
| `시작~종료` | 계획 시작·종료 명시 (`2026-09-01~2026-09-03`). 파생보다 우선 |
| `credit:키` | stage 크레딧 표 선택. 생략 시 default |
| `if-id:` | PMO I/F 대장 참조 (쌍 연결) |

## 구현 범위와 진행 상태 (2026-08-21 착수)

1. ✅ **프로젝트 설정 level_labels·max_depth 편집** — 8d6bd92. domain/levelSettings(검증·treeMaxDepth) +
   updateLevelSettings 액션 + LevelSettingsManager + 설정 페이지 섹션. 축소 fail-closed.
2. ✅ **Excel export 동적 계층 열** — 19f2c82. buildWbsAoa 계층 열 = levelLabels.length(3라벨 바이트 불변),
   buildAoaWithProfile levelLabels 주입, export 라우트 연결. **import 는 변경 불요** — 위저드
   (detect·parseWithProfile·linkByDepth)가 이미 N단 범용임을 실사로 확인. 3열 고정 parse.ts 는 레거시 전용 존치.
3. ✅ **import 계약 v2.2** (2026-08-22 랜딩) — 서버: 0089 마이그레이션(level_idx·milestone·credit_key·
   if_id + RPC p_attach_id, 스테이징 리허설 완료) + import 라우트(levels 시드/일치 검증·attach 해석·
   input 층 발행 일반화·종료일 단독 schedule) + `GET /api/v1/wbs/structure`(PL 서버 직조회).
   스킬: `wbs-nlevel-parse.py`(validate/export — fold 접기·마일스톤·토큰 파싱, pytest 18건) +
   SKILL.md 조회 사슬·업로드 절차. **운영 DB 적용은 main 머지 시점**(그 전까지 업로드는 스테이징만).
4. ⏸ **stage→크레딧·weight 롤업** — 데이터(weight·credit_key·level_idx)는 3에서 랜딩됨. 계산·표시만 남음.

의도적 보류 (실사 결과):

- `ai/tools/wbs.ts` level enum 3종 clamp — AI 도구 계약 + 임베딩 바이트 불변에 묶여 있어 바꾸면 전 프로젝트
  재임베딩 필요. v2.2(3번)와 함께 계획적으로.
- weekly report·AI ingest 는 이미 getProjectConfig 주입식(Plan D 완료분) — 추가 변경 불요 확인.
- `RESERVED_TEAM_NAMES` 의 Phase/Task/Activity 고정 — 커스텀 라벨과 팀명 충돌 검증이 정적 목록이라
  안 잡힘(저위험). 라벨 저장·팀 추가 양쪽에서 상호 대조하는 후속 과제.
