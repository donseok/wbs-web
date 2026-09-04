---
name: dflow-wbs-nlevel
description: N단(5~8단) 대형 프로젝트의 wbs.md 를 levels 계약(frontmatter 단계 선언·접두어 판정·진도 역할·업로드 범위)으로 생성·검증할 때 사용. PMO 골격(--skeleton)과 PL 모듈 파일 두 모드. 트리거 - "/dflow-wbs-nlevel", "N단 WBS", "8단 WBS", "골격 WBS", "PL WBS", "levels frontmatter". 3~4단 기존 흐름은 dflow-wbs(동결)를 쓴다. 사용법 - /dflow-wbs-nlevel [--skeleton 시스템목록 | 모듈경로] [--programs 경로]
---

# /dflow-wbs-nlevel — N단 WBS 생성 (levels 계약)

> **계약 정본은 `.claude/skills/dflow-wbs-nlevel/references/wbs-nlevel-md-contract.md` 다** (wbs-web docs/superpowers/specs 의 사본 — 갱신 시 둘 다).
> 생성 전에 반드시 Read 하고, 이 파일과 다르면 그 문서가 이긴다.
> 기존 `dflow-wbs`(3~4단 WSF)는 **동결** — 이 스킬과 규약이 다르며 서로 섞지 않는다.
>
> **업로드 게이트 (2026-08-22 갱신)**: import v2.2(levels·attach·fold)는 **서버 랜딩 완료** —
> 스테이징(dflow-staging)은 코드·DB(0089) 모두 적용돼 업로드 가능. **운영은 0089 운영 적용 +
> main 머지 전까지 금지.** 업로드 전 반드시 `wbs-nlevel-parse.py validate` 통과(§검증·업로드).

## 모드 — 인자로 판정

| 모드 | 인자 | 산출물 | 소유 |
|---|---|---|---|
| **골격** | `--skeleton {시스템목록}` | Phase·System 골격 wbs.md + 시스템 키 목록 + levels 정본 + PL 파일 템플릿(배포 킷) | PMO/PM |
| **PL** (기본) | `{모듈 디렉토리}` (예: `docs/mes/조업`) `[--programs 경로]` | 그 모듈의 wbs.md (Subsystem 이하) | 담당 PL |

PL 모드의 **levels·시스템 키 조회 사슬** (2026-08-22 확정 — 위가 이김):

1. **서버 직조회**: `GET /api/v1/wbs/structure?project_id=...` (PAT `work:read`, 멤버) —
   levels 정본 + Phase·System 노드(external_ref·name). 골격이 이미 업로드된 프로젝트의 정본.
2. **골격 파일 폴백**: 같은 프로젝트 루트의 골격 wbs.md 에서 levels·시스템 키를 복사.
3. 둘 다 없으면 **에러 후 중단**(골격 선행 원칙). levels 를 임의로 새로 쓰지 않는다.

**코드는 이름으로 고른다** — PL 에게 시스템 코드를 묻지 않는다: 조회 결과의 시스템 목록을
이름으로 제시(①공통 ②품질 …)하고, 선택하면 attach·module 을 정본에서 자동 기입한다.
골격에 없는 업무를 답하면 코드를 만들어주지 않고 "PMO 에 skeleton.yaml 추가 요청"으로 중단
(fail-closed — 시스템 신설은 조직 결정). SUB 이하 약어만 스킬이 제안한다(§programs.*).
예외 — 사용자가 골격 부재를 알고도 초안을 명시 요구하면: 스펙 정본 샘플의 levels 를 "임시 사본"으로
복사하고, 파일 머리와 리포트에 **골격 발행 후 대조 필수(불일치 시 골격이 이김)·대조 전 업로드 금지**를
명시한다. 임시 사본 없이 levels 를 창작하는 것은 여전히 금지.

## 계약 요약 (정본: 스펙 문서)

### 1. frontmatter — 단계는 여기서만 선언한다

```yaml
---
project: MES
module: mes-op                  # PL 모드 필수 — external_ref 네임스페이스
attach: PH-03/SYS-OP            # PL 모드 필수 — 골격의 부착점 노드
levels:                         # 골격이 정본, PL 파일은 복사본(불일치 = 업로드 거부)
  - { name: Phase,     prefix: PH,  progress: rollup }
  - { name: System,    prefix: SYS, progress: rollup }
  - { name: Subsystem, prefix: SUB, progress: rollup }
  - { name: WP,        prefix: WP,  progress: rollup, report: weekly }
  - { name: Activity,  prefix: ACT, progress: rollup, optional: true }
  - { name: Task,      prefix: TSK, progress: input }
  - { name: SubTask,   prefix: STK, progress: checklist, optional: true, upload: fold }
credits:
  default: { 대기: 0, 설계: 20, 구현중: 50, 구현완료: 70, 테스트완료: 90, 검수완료: 100 }
  if:      { 대기: 0, 구현중: 30, 구현완료: 50, 연동검증: 100 }
  doc:     { 미착수: 0, 작성중: 30, 제출: 50, 검수완료: 100 }
---
```

- 산문 표·본문 절로 단계를 선언하지 않는다 — 기계 파싱 대상은 frontmatter 뿐이다.
- `progress` 4종: `input`(leaf 입력·발행 대상) / `rollup`(집계 전용 — leaf 면 에러) /
  `checklist`(완료 ○/× 만, 집계 불개입, leaf 전용) / `none`(마일스톤).
- `upload` 3종: `true`(기본) / `false`(파일 전용) / `fold`(부모 acceptance 로 접힘).
  **아래에서 위로만** 끌 수 있다. `input` 층은 `true` 강제. 노드 단위 skip 마커를 발명하지 않는다.

### 2. 단계 판정 — 접두어가 정본

- `TSK-` 접두 = Task. **ID 세그먼트 수·헤딩 깊이로 층을 판정하지 않는다.**
- 헤딩 깊이·리스트 들여쓰기는 **부모 판정(구조)** 에만 쓴다.
- 검증: 자식의 단계 순번 > 부모의 단계 순번 (건너뛰기 허용 — 선택층, 역행·동급 금지).
- 마크다운 헤딩 6단 한계는 **리스트 들여쓰기가 흡수**한다 — Task 이하를 `- [ ]` 리스트로 쓰면
  헤딩 캡·중복 깊이가 생기지 않는다. 같은 헤딩 깊이에 두 단계를 겹쳐 쓰지 않는다.
- ID = external_ref 매칭 키. 재번호매김 금지, 사라진 ID 재사용 금지 (dflow-wbs 와 동일 규칙).
- **ID 채번 관례** (2026-08-21 확정): `{접두}-{SYS약어}-{경로꼬리}-{순번}` — 예: 조업>입측>화면>1번
  = `TSK-OP-IN-UI-01`, 그 SubTask = `STK-OP-IN-UI-01-1`. PL 파일의 SUB·WP 도 시스템 약어 포함
  (`SUB-OP-IN`, `WP-OP-IN-UI`). 골격(전사 항목)은 시스템이 없으니 `TSK-AN-RQ-01` 형.
  경로 조각은 **생성 시점의 소속 힌트**일 뿐 — 단계·부모 판정은 접두어+구조가 정본이고, 노드를
  옮겨도 ID 는 불변(힌트가 낡을 수 있음을 감수). module 이 이미 네임스페이스라 기술적으론 중복이나,
  ID 가 화면·회의에서 단독 유통되므로 사람용 자기완결성을 위해 시스템을 포함한다.
  개요 번호(1.3.4.12)는 ID 가 아니라 **표시 파생값** — 화면·엑셀이 트리 위치에서 자동 계산, 파일에 쓰지 않는다.

### 3. 본문 표기 (한 줄 요약 — 전체 표는 스펙)

```markdown
## PH-03: 구축                       ← 헤딩: 상위 층
##### WP-IN-PR: 프로세스
###### ACT-IN-PR-1: 실적 관리
- [ ] TSK-IN-001: 입측 실적 수집 @홍길동 w:5 ~2026-10-17 credit:default
  - [ ] STK-IN-001-1: 중복 수신 방어   ← checklist (fold)
- [M] TSK-AN-IF-90: 분석 완료 보고회 ~2026-09-30   ← 마일스톤 — ID 필수(external_ref)
```

`@담당` `w:가중치(MD, 생략=1)` `~종료일` 또는 `시작~종료일` `credit:크레딧표키` `if-id:I/F대장ID`.
생성기는 **`시작~종료일` 로 쓴다** — 종료만 쓰면 import 가 시작을 파생(선행 종료 다음 영업일 → `start_date`)하지만,
선행이 더 늦게 끝나는 계획은 시작=종료로 접혀 0일 막대가 된다. 일정을 산정했으면 둘 다 적는 게 정확하다.
상태는 항상 `[ ]` — 전이 정본은 D'Flow(dflow-wbs 와 동일). 실적 % 를 파일에 쓰지 않는다.

**Task 상세 블록** — 한 줄 밑에 들여쓴 `- key: value` 필드(체크박스 없는 리스트 = 필드,
`- [ ]` = SubTask — 둘은 공존한다). import 필드(category·domain·model·priority·tags·depends·
prd-ref·entry-point·requirements·acceptance·spec·note)를 여기에 싣는다:

```markdown
- [ ] TSK-IN-001: 입측 실적 수집 프로세스 @홍길동 w:5 ~2026-11-14
  - category: dev
  - domain: backend
  - depends: TSK-L2-221
  - requirements: L2 인입 통보 수신 시 입고 실적 생성·재고 반영, 불일치는 예외 큐
  - acceptance: 수신→실적→재고 단일 트랜잭션 / 중복 전문 멱등 처리
  - [ ] STK-IN-001-1: 중복 수신 방어 로직
```

상세 블록은 **선택**이다 — 골격·초안 단계는 한 줄로 두되, **개발 착수 전 input 층 Task 는
requirements·acceptance 필수**(검증기 경고 대상). 명세의 재료는 PRD/프로그램 리스트 입력에서
가져온다 — 입력 없이 명세를 지어내지 않는다(초안은 한 줄로 남기고 리포트에 "명세 미충전" 표기).

### 4. WSF 배치 — 모드가 샌드위치를 나눠 갖는다

- `--skeleton` = **빵**: Water(PH-01 분석·PH-02 설계 골격 + 전사 아키텍처·공통 계약 Task) +
  Fall(PH-04 통합테스트·PH-05 적용 골격 + 시스템 관통·컷오버).
- PL 모드 = **속**: 모듈 Water 꼬리(모듈 요건분석·상세설계·DB(ERD)·모듈 공유 계약(계약 전용)) +
  Scrum(프로그램 Task — 1 프로그램 = 1 fullstack Task 수직 슬라이스) + 모듈 Fall(모듈 통합 시나리오).
- depends 사슬·경계 규칙("2+ 모듈 공유만 선행", 통테 결함은 defect 되돌림)은 dflow-wbs §전체 구조를
  계승한다. category 7종·수직 슬라이스·FS 전용 depends 도 동일.

### 5. 분리 업로드 전제

- 골격 먼저, PL 파일들은 무순서. module = 디렉토리 세그먼트(`docs/mes/조업` → 조업 매핑표 or 영문 코드).
- PL 파일 최상위 노드는 attach 가 가리키는 골격 노드의 자식으로 들어간다 — 골격 층(PH·SYS)을
  PL 파일 본문에 쓰면 에러.
- module 1개 = 파일 1개. ID 는 모듈 안에서만 유일하면 된다.

## 골격 정의 파일 (`skeleton.yaml`) — 골격 모드의 입력 정본

```yaml
project: MES
start_date: 2026-09-01
methodology: wsf            # wsf(기본) | waterfall | scrum — 단계 프리셋과 PL 생성 규칙을 결정
phases:                     # 생략 시 methodology 프리셋. 명시하면 그것이 이김
  - { key: PH-03, name: 구축, build: true }   # build: true = 시스템 트리가 붙는 Phase
levels: default             # 'default' = 스펙 정본 7층. 커스텀이면 배열. scrum 은 Phase 층 제거판
systems:
  - { key: SYS-OP, name: 조업, module: mes-op, pl: 박PL }
```

### methodology 3종 — 단계 프리셋 + 생성 규칙

| 값 | phases 프리셋 | levels | PL 모드 규칙 |
|---|---|---|---|
| `wsf` (기본) | 분석·설계·구축(build)·통합테스트·적용 | 정본 7층 | 모듈 Water 꼬리 + Scrum + 모듈 Fall (현행) |
| `waterfall` | 분석·설계·개발(build)·단위테스트·통합테스트·이행 | 정본 7층 | 애자일 반복 없음 — 프로그램 Task 일렬, 계약 Task 는 설계 단계 소속, `credit:doc` 게이트 중심 |
| `scrum` | **없음** — Phase 층 자체를 levels 에서 제거, System 이 최상위 | Phase 제거 6층 | 선행·후행 공정 없음 — 백로그형. 통테는 횡단 시스템으로 두거나 생략 |

- **파일이 있으면 무질문 생성.** 파일이 없으면 대화로 수집한다 — 질문은 넷뿐:
  ① 프로젝트명 ② **방법론(wsf/waterfall/scrum — 기본 wsf)** ③ 단계(방법론 프리셋을 제시하고 수정 여부;
  scrum 이면 생략) ④ 시스템 목록(이름을 받아 키·module 을 제안 → 사용자 확정).
  답으로 **skeleton.yaml 을 생성하고 멈춘다** — "파일 검토 후 재실행" 안내.
  즉석 골격 생성 금지: 시스템 키는 external_ref 라 불변이며, 리뷰 없이 확정하지 않는다.
- 시스템 목록을 스킬이 지어내지 않는다 — 입력(파일 또는 답변)에 없는 시스템은 만들지 않는다.
- 필수 누락(project 없음, systems 0개)은 중단. 선택 누락(pl 미정)은 기본값 + 리포트.

### wsf 골격 표준 구성 (2026-08-21 확정 — 실물 예시: `.claude/skills/dflow-wbs-nlevel/references/skeleton-sample.md`)

구축(build Phase)은 System 자리만 두고, 나머지 4 Phase 는 아래 WP 구성을 템플릿으로 생성한다
(시스템 횡단이라 System·Subsystem 층 건너뜀 — 얕은 비대칭 트리):

| Phase | WP 구성 |
|---|---|
| 분석 | 현행(AS-IS) 분석 · **요건 정의(시스템별 Task ×N)** · I/F 요건 정의 + 보고회 [M] |
| 설계 | 아키텍처 설계 · 데이터 설계(ERD·마스터·코드) · **시스템별 상세설계(ACT ×N, 깊은 시스템은 Subsystem 별 Task)** · I/F 상세설계 + 보고회 [M] |
| 통합테스트 | 계획·환경·데이터 · 시스템 내 통합 · L2 연동(credit:if) · ERP 연동(credit:if) · 결함 관리·회귀 + 완료 [M] |
| 적용 | 데이터 이행 · 사용자 교육·매뉴얼 · 컷오버·오픈 + 가동 [M] · 안정화 |

- 산출물 Task 는 `credit:doc`, 연동 Task 는 `credit:if`. 시스템별 항목은 skeleton.yaml 의 systems 로 전개.
- 시스템별 요건정의·상세설계 Task 는 골격(PMO 파일) 소속이다 — **attach 는 단일 노드로 확정**(b안,
  2026-08-22): 모듈 통테 준비·시나리오도 "모듈 검증까지가 구축"으로 build Phase 소속이며, 선행·후행
  Phase 는 PMO 골격 전유. 담당 PL 확정 시 @담당으로 배정해 소유를 넘긴다.

## 실행 플로우

1. 스펙 문서 Read (계약 로드).
2. 모드 판정 (`--skeleton` 유무).
3. **골격 모드**: skeleton.yaml 로드(없으면 위 대화 수집 → 파일 생성 후 종료) → PH + System 노드 생성 →
   levels·credits 정본 작성 → PL 템플릿(모듈별, attach·levels 채움) 생성 → 키 목록 표 출력 +
   "키는 이후 불변" 경고.
4. **PL 모드**: levels·시스템 키 조회(§조회 사슬 — 서버 structure → 골격 파일 → 에러) →
   시스템을 **이름으로 선택**받아 attach·module 자동 기입 → **프로그램 리스트 로드**
   (`{모듈 디렉토리}/programs.{yaml|csv|xlsx|md|json}` — 없으면 빈 템플릿 programs.yaml 생성 후
   정지, "채워서 재실행" 안내. skeleton.yaml 과 동일 패턴) → 프로그램 Task + 모듈 Fall 생성 →
   attach 기입. PRD/TRD 는 선택 — 있으면 requirements·acceptance 인용 보강, 없으면 한 줄 Task 로
   두고 리포트에 "명세 미충전" 표기(지어내지 않는다).

### PL 입력 파일 (`programs.*`) — dflow-wbs 어댑터 준용 + N단 확장

공통 스키마·한글 헤더 별칭·포맷별 읽기는 dflow-wbs SKILL.md §프로그램 리스트 입력 어댑터를
준용하고, N단 배치를 위해 두 키를 추가한다:

| 키 | 필수 | 역할 |
|---|---|---|
| `subsystem` | ✅ | SUB 배치 — `입측` → `SUB-{SYS}-IN`. 없으면 에러(N단 필수) |
| `target` | I/F 만 | 인터페이스 축 판정 — 공정명(`2CGL`)→L2IF 공정 WP, `ERP`→ERPIF(`group` 이 WP) |

- `type` → WP 판정: 프로세스/배치→`-PR`, 화면/리포트→`-UI`, 인터페이스→`target` 축.
- `id` 는 Task 의 `prd-ref: program:{id}` 로 보존 — 재생성 시 기존 Task ID 복원 키.
- difficulty→`w:` 환산(하 2 / 중 3 / 상 5), 인터페이스 Task 는 `credit:if` 자동.
- subsystem 값→SUB 약어 매핑은 최초 등장 시 제안·programs 파일 머리에 주석으로 고정(재실행 안정).
5. **검증 게이트** — 파서 스크립트가 정본(수동 체크리스트 대체, 2026-08-22):
   ```bash
   python3 .claude/skills/dflow-wbs-nlevel/scripts/wbs-nlevel-parse.py validate \
     --wbs docs/mes/조업/wbs.md --role pl        # 골격은 --role skeleton
   ```
   errors 0 이어야 통과. warnings 는 리포트에 전량 나열(생략 금지) — 얕은 비대칭 골격의
   "필수층 건너뜀"과 분리 업로드 과도기의 "rollup leaf" 는 정상 경고다.
6. 생성 리포트에 업로드 게이트 상태(스테이징 가능 / 운영 대기)를 한 줄 남긴다.

## 업로드 — export → import v2.2 (2026-08-22 게이트 부분 해제)

```bash
# 1) export — 검증 게이트 내장(에러 시 payload 안 나옴). attach_ref 는 골격 module 로 자동 조립.
python3 .claude/skills/dflow-wbs-nlevel/scripts/wbs-nlevel-parse.py export \
  --wbs docs/mes/조업/wbs.md --skeleton docs/mes/skel/wbs.md > "$SCRATCHPAD/nlevel-op.json"   # 골격 경로는 프로젝트마다 다름

# 2) 봉투 완성(project_id) 후 전송 — PAT 규칙·바인딩은 dflow-export SKILL.md 준용(값 비출력)
python3 - <<EOF
import json; d = json.load(open("$SCRATCHPAD/nlevel-op.json"))
d["project_id"] = "<UUID>"
json.dump(d, open("$SCRATCHPAD/nlevel-op-import.json", "w"), ensure_ascii=False)
EOF
PAT="$(echo "${DFLOW_PATS:-$DFLOW_PAT}" | cut -d',' -f1)"
curl -sS -X POST "$DFLOW_API_BASE/api/v1/wbs/import" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  -d @"$SCRATCHPAD/nlevel-op-import.json"
```

- **골격 먼저**: 골격 파일은 attach 없이 export(levels 가 project_settings 시드), PL 파일은
  attach_ref 필수 — 골격 미업로드면 서버가 400 `attach_not_found` 로 거부(fail-closed).
- PL 파일 levels 가 서버 정본과 다르면 400 `levels_mismatch` — 골격의 levels 를 다시 복사.
- fold(STK)·마일스톤·w:·credit:·if-id: 는 export 가 자동 변환 — payload 수동 조작 금지.
- 대상 서버: **스테이징만**(운영은 0089 운영 적용 + main 머지 후 — 게이트 상단 참조).

## 자주 틀리는 것 (베이스라인 실측 2026-08-21)

| 스킬 없이 나온 발명 | 교정 |
|---|---|
| ID 세그먼트 경로(`P1.OP.EN.PR.A1.T1`)로 층 판정 | 접두어 정본. ID 는 짧게, 층은 prefix |
| 산문 "계층 규약" 표 | frontmatter levels |
| Task 마다 `progress: input` 필드 | 층별 선언 — 노드에 반복 기재 금지 |
| `dflow: skip` 노드 마커 | 층별 `upload` — 노드 단위 제외는 계약에 없다 |
| 헤딩 `######` 캡으로 두 단계 겹침 | Task 이하는 리스트 — 구조 모호 금지 |
