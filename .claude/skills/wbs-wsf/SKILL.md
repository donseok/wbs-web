---
name: wbs-wsf
description: PRD/TRD 또는 프로그램 리스트(json/yaml/csv/md/xlsx)로 WBS 를 Water-Scrum-Fall 샌드위치 구조로 생성한다. 선행 공정(초기화·기본설계) → 애자일 기능 Task → 후행 통합테스트. 프로그램 1개 = fullstack Task 1개(수직 슬라이스). category 7종(dev/defect/infra/feat/design/research/itest). 생성 상태는 항상 [ ] — 상태 전이는 D'Flow(stage)가 정본이며 wbs.md 는 /wbs/import 부트스트랩용이다. 사용법 /wbs-wsf [SUBPROJECT | /absolute/path/to/wbs.md] [--programs 경로] [--scale large|medium] [--start-date YYYY-MM-DD] [--estimate-only] [--export-xlsx [경로]]
---

# /wbs-wsf - PRD/TRD·프로그램 리스트 기반 WBS 생성 (Water-Scrum-Fall)

> **독립 실행 패키지다** — 정본 위치는 wbs-web 리포의 `.claude/skills/wbs-wsf/` 이며(git 추적,
> 프로젝트 스코프 스킬), 실행에 필요한 스크립트(`scripts/` — dev 플러그인 1.7.1 스냅샷 5종)와
> 템플릿·출력 형식 정본(`references/`)을 전부 동봉한다. dev 플러그인이 없는 PC 에서도 리포
> 클론만으로 동작한다. 아래 상대 경로들은 리포 루트가 cwd 라는 전제다.
> 구조·경계·게이트 규칙의 문서 정본은 대상 리포의 `docs/wbs-workflow.md` 다 —
> 있으면 생성 전에 Read 하고, 이 파일과 다르면 그 문서가 이긴다.
> **상태·전이·배정·진척의 정본은 D'Flow 다.** 이 스킬은 상태를 `[ ]` 로만 생성한다 —
> wbs.md 는 최초 작성·사람 검수·`POST /api/v1/wbs/import` 부트스트랩 전용이며, import 후
> 실행 상태는 D'Flow DB 를 읽는다. (6상태 로컬 워크플로우 서술은 이 스킬에서 제거됐다 —
> 2026-08-11 WBS 중앙관리 결정. 옛 로컬 오버라이드는 dev-workflow 리포에서 같은 날 삭제.)

## 인자 파싱 — 서브프로젝트 감지

전달 인자를 공백 토큰화, 첫 토큰 검사:

1. `/` 로 시작 (절대 경로): 파일 존재 시 `WBS_FILE={경로}`, `DOCS_DIR={파일 디렉토리}`, `VIEW_MODE=true` (내용 전체 표시 후 종료 — 단 `--export-xlsx` 가 있으면 export 를 실행한 뒤 종료). 파일 없으면 에러 후 종료.
2. 토큰 없음 또는 `--` 시작 → `DOCS_DIR=docs`
3. `^(WP|TSK)-` 패턴 → `DOCS_DIR=docs` (토큰 유지)
4. 그 외 → 서브프로젝트 후보. `docs/{토큰}/` 존재 시 `SUBPROJECT={토큰}`, `DOCS_DIR=docs/{토큰}`. 없으면 사용자에게 생성 여부 확인 (오타 가능성).

플래그: `--scale large|medium` (규모 강제), `--start-date YYYY-MM-DD`, `--estimate-only` (산정만),
`--programs {경로}` (프로그램 리스트 입력 모드 — `.json` / `.yaml` / `.yml` / `.csv` / `.md` / `.xlsx`),
`--export-xlsx [경로]` (WBS 엑셀 보고본 생성. 경로 생략 시 `{DOCS_DIR}/wbs.xlsx`).
`--export-xlsx` 는 **VIEW_MODE 에서도 동작한다** — 기존 WBS 를 재생성 없이 엑셀로만 뽑는 것이 주 용도다.

## 입력 파일 — 모드 두 개

| 모드 | 조건 | 입력 |
|---|---|---|
| **PRD 모드** (기본) | `--programs` 없음 | `{DOCS_DIR}/PRD.md`, `{DOCS_DIR}/TRD.md` — 둘 다 없으면 에러 후 중단 |
| **프로그램 리스트 모드** | `--programs {경로}` 있음 | 그 파일. PRD/TRD 는 **선택** — 있으면 함께 읽어 requirements·tech-spec 을 보강하고, 없어도 중단하지 않는다 |

프로그램 리스트 모드의 상세는 `## 프로그램 리스트 입력 어댑터` 절.

### 입력 검증 (자율 보강, 사용자에게 묻지 않음)

PRD/TRD 가 있을 때만 실행한다 — 프로그램 리스트 모드에서 둘 다 없으면 건너뛴다.

```bash
python3 .claude/skills/wbs-wsf/scripts/prd-validate.py validate --target {DOCS_DIR}/PRD.md
python3 .claude/skills/wbs-wsf/scripts/prd-validate.py validate --target {DOCS_DIR}/TRD.md
```

`issues` 있으면: 합리적 가정으로 보강 → `## Assumptions (auto-resolved YYYY-MM-DD)` append → `decisions.md` 에 `phase=prd-resolve` 적재 (`decision-log.py append`) → 재검증 1회. 그래도 남으면 한 줄 알림 후 진행 (흐름 차단 없음).

### 출력 검증 (wbs.md 생성 직후)

```bash
python3 .claude/skills/wbs-wsf/scripts/wbs-parse.py {DOCS_DIR}/wbs.md - --dev-config > /tmp/dev-config.json
python3 .claude/skills/wbs-wsf/scripts/wbs-validate.py validate --wbs {DOCS_DIR}/wbs.md --dev-config-json "$(cat /tmp/dev-config.json)"
```

> ⚠️ **툴체인 제약 — 실측 기준. 검증 결과를 곧이곧대로 믿지 말 것.**
>
> | 제약 | 근거 | 생성 시 영향 | 해소 |
> |---|---|---|---|
> | `wbs-validate.py` 는 3단계만 인식 | `wbs-validate.py:39` 정규식 `^###\s+(TSK-\d+-\d+):` | **4단계 WBS 는 task_count 0 + `ok:true`** — 통과가 아니라 아무것도 안 본 것 | DEV-03 |
> | `merge-wbs-status.py` 도 3단계만 인식 | `merge-wbs-status.py:37` 동일 정규식 | 4단계에서 상태 머지가 조용히 무동작 | DEV-03 |
> | 머지 상태 어휘가 5개 | `merge-wbs-status.py:28-33` + `:172` `.get(v, -1)` | 어휘 밖 상태는 랭크 −1 로 `[ ]`(0)보다도 낮게 취급되어 **조용히 덮인다** | DEV-01 |
> | 전이 스크립트 상태 어휘가 5개 | `wbs-transition.py:353` `{"[ ]","[dd]","[im]","[ts]","[xx]"}` | 파일에 `[as]` 같은 진행 상태를 쓰면 `unknown status in wbs.md` 로 **거부** | DEV-01 |
> | 의존 완료 판정이 `[xx]` 단독 | `dep-analysis.py:388` | 문서 기준(`[im]` 이상)과 어긋나 진행 중 체인을 미완으로 계산 | DEV-01 |
> | Task ID 정규식은 숫자만 | `wbs-parse.py:198` | `TSK-02-01a` 같은 letter suffix 는 **조용히 무시** — 절대 쓰지 않는다 | — |
> | `dep-analysis.py` 는 stdin 불가 | 인자가 JSON array 파일 경로 | `wbs-parse.py --tasks-all` 출력을 파일로 저장 후 전달 | — |
>
> **4단계(ACT) 를 생성했으면** `wbs-validate.py` 결과를 구조 검증으로 쓰지 않는다. 대신
> `wbs-parse.py --tasks-all` 로 Task 건수·필드를 직접 확인하고(파서는 `#{3,4}` 를 읽는다),
> **생성 리포트에 "4단계 — wbs-validate·merge-wbs-status 무력화(DEV-03 대기)" 를 한 줄 출력한다.**
> 단, **DEV-02·DEV-03 해소판 스크립트는 `/dflow-export` 스킬에 동봉돼 있다**
> (`.claude/skills/dflow-export/scripts/` — `wbs-validate.py` 4단계 지원, `wbs-parse.py --export`).
> 위 제약 표는 이 스킬의 동봉 스냅샷(`wbs-wsf/scripts/`) 기준으로 여전히 유효하다.
> 이 경고는 생성 리포트에만 남기고 wbs.md 본문에는 넣지 않는다 — wbs.md 는 작업 정본이지 툴 상태 기록부가 아니다.

issue 발견 시 해당 Task 만 재작성 → 재검증 1회 → `decisions.md` 에 `phase=wbs-resolve` 적재.

## 전체 구조 — 샌드위치 (정본: wbs-workflow.md §1)

```
[선행 공정]                [애자일 반복]              [후행 공정]
WP-00 초기화·공유계약  →   기능 WP × N           →   마지막 WP 통합테스트
WP-01 전체 기본설계        (설계→구현→테스트를        (기능 간 E2E, 성능,
                           Task 안에 내포)            권한 교차, UAT)
```

- 화살표는 개념 순서 — 실제 진행은 게이트 충족 시 구간이 겹칠 수 있다.
- **선행/기능 경계**: "2개 이상 기능이 공유하거나, 바꾸면 마이그레이션 필요한 것"만 선행.
- **선행 설계는 얇게**: 핵심 엔티티·관계까지만, 컬럼 상세는 기능 Task 위임.
- **DB(ERD) 설계는 그룹 설계에서 분리해 작게 뗀다** — 계약 파이프라인이기 때문 (계약 Task 의 유일한 선행이 DB 설계). DB 설계가 큰 그룹 설계에 묶이면 계약 동결이 그룹 전체 완료를 기다리게 된다.
- **후행/기능 경계**: 기능 Task 는 자기 기능 E2E 까지. 통합 WP 는 기능 **간** 흐름·성능·권한 교차·이관 리허설만.
- **결함 되돌림**: 통합테스트 결함은 해당 기능 WP 에 `category: defect` Task 신설.
- 소규모면 WP-01 생략 가능 (WP-00 이 흡수). 기능 WP 2개 이상이면 통합테스트 WP 필수.
  **프로그램 리스트 모드는 예외 — 기능 WP 가 1개여도 통합테스트 WP 를 생성한다**(`## 프로그램 리스트 입력 어댑터`).

## 계층·규모·ID (정본: wbs-workflow.md §2)

```
Phase → WP → [ACT(4단계만)] → Task → [Sub Task 수동]
```

| 기준 | 대규모(4단계) | 중소규모(3단계) |
|------|--------------|----------------|
| 기간 | 12개월+ | 미만 |
| 팀 | 10명+ | 미만 |
| 기능 영역 | 5개+ | 미만 |
| Task 수 | 50개+ | 미만 |

타이브레이커: 2:2 면 4단계 (ACT 제거가 추가보다 싸다).
**예외**: 모듈 경계가 명확한 다모듈 시스템은 규모 미달이어도 ACT 허용 (MES 샘플).

| 레벨 | 4단계 | 3단계 |
|------|-------|-------|
| WP | `## WP-XX:` | `## WP-XX:` |
| ACT | `### ACT-XX-XX:` | — |
| TSK | `#### TSK-XX-XX-XX:` | `### TSK-XX-XX:` |

- `WP-00` 초기화 예약. **Task ID 는 숫자만** — 분할 시 새 숫자 ID + `tags: split-from-XX`.
- Sub Task = Task 헤딩보다 한 단계 아래 헤딩의 체크박스 (3단계 `####`, 4단계 `#####`).

## Task category — 7종 약어 (정본: wbs-workflow.md §3)

**애자일형** (산출물 = 코드+테스트): `dev`(기능), `defect`(결함), `infra`(인프라·공유 계약·리팩토링), `feat`(독립 기능, `/feat` 별도 실행, 의존 그래프 제외)

**공정형** (산출물 = 문서·결정·검증 결과): `design`(설계서·ERD), `research`(결정 문서, `decisions.md` 반영), `itest`(통합테스트 결과서)

- 판정 순서: ① 구간 먼저 (선행 WP → design/research/infra, 후행 WP → itest) ② 기능 구간은 산출물로 (코드 → dev/defect/infra).
- `feat` 자동 분류: depends 없음 + fan-in 0 + 코드·계약 공유 없음, 전부 충족 시. feat Task 에 depends 걸기 금지.
- 부가 Task(시드 데이터·fixture·API 키): 공유 범위로 판정 — 2+ 기능 공유면 `infra` 선행 분리, 1개 전용이면 해당 기능 Task 에 흡수.

## 상태 — 생성은 `[ ]` 하나 (전이 정본: D'Flow)

- **WBS 생성 시 모든 Task `status: [ ]`** — 담당자를 아는 경우에도 그렇다.
  배정·전이는 import 후 D'Flow(stage)가 관리한다. `[as]` 같은 진행 상태를 파일에 직접 쓰면
  로컬 툴체인도 거부한다(`wbs-transition.py:353` — `unknown status in wbs.md`).
- `assignee` 는 **입력이 email 을 줄 때만** 그 값을 쓰고, 그 외에는 `-` 다 (규칙은 아래 `## D'Flow 연동 표기` 절).
- ⚠️ `dep-analysis.py:388` 은 `[xx]` 만 완료로 센다 — 진행 중 WBS 를 재분석하면 완료 판정이
  문서 기준(`[im]` 이상)보다 좁다. 생성 시점엔 전 Task 가 `[ ]` 라 영향이 없다.

## D'Flow 연동 표기 (정본: 부록 §2.5·§2.6·§7.2)

생성물이 `POST /api/v1/wbs/import` 로 올라갈 수 있다는 전제에서, wbs.md 표면에 **넣는 것과 넣지 않는 것**이 정해져 있다.

### 넣는 것

| 항목 | 계층 | 문법 | 규칙 |
|---|---|---|---|
| 담당자 | Task | `- assignee: {email}` | 입력 값이 `@` 를 포함하면 그대로 시드. 아니면 `- assignee: -` 로 두고 **"담당 미매칭" 표에 원문과 함께 전량 나열**한다(생략 금지). 빈 값(미기재)은 미매칭이 아니다 — 표에 넣지 않는다. |
| 모듈 담당자 | WP / ACT | `- assignee: {email}` | 입력에 모듈 담당 컬럼이 있을 때만. ⚠️ DEV-02(`--export`)가 구현된 지금도 **export 는 WP/ACT 의 assignee 를 싣지 않는다**(task kind 전용 필드) — 기록만 되고 업로드되지 않는다. |
| 프로그램 추적 키 | Task | `- prd-ref: program:{프로그램ID}` | 프로그램 리스트 모드에서 필수. 재생성 시 이 값으로 기존 Task 를 찾는다. |

⚠️ **`assignee` 시드는 하류에서 자동 발행을 켠다.** 업로드 시 담당자 매칭에 성공한 **리프 Task 는 D'Flow 작업 주문이 자동 생성**되고(부록 §2.8), 그 주문은 **그 사람만 claim** 할 수 있다(불일치 시 403 `not_assignee`). 담당 컬럼을 채우는 것은 단순 표기가 아니라 배정 행위다 — 확정된 담당만 적는다.

### ID 는 import 매칭 키다 — 재번호매김 금지

헤딩 ID(`WP-XX` · `ACT-XX-YY` · `TSK-XX-YY[-ZZ]`)가 곧 D'Flow 의 `external_ref` 이고, import upsert 는 이 값으로 기존 행을 찾는다(부록 §7.2-1).

**wbs.md 는 import 후 은퇴하므로 이 규칙의 사정거리는 "재생성"이 아니라 "재import"다.** 그래도 필요하다 — **초기 import 는 한 번에 성공하지 않는다.** 담당자 미매칭·유형 미매핑·검증 실패로 고쳐서 여러 번 돌리게 되고, 그때 ID 가 흔들리면 같은 항목이 DB 에 여러 벌 생긴다.

- **기존 wbs.md 가 있으면 먼저 읽고, `prd-ref: program:{ID}` 로 프로그램 ↔ Task ID 매핑을 복원한 뒤 그 ID 를 그대로 재사용한다.**
- 신규 프로그램은 해당 WP/ACT 의 **다음 번호를 이어 붙인다.** 중간에 끼워 넣어 뒤 번호를 밀지 않는다.
- 사라진 프로그램의 ID 는 **재사용하지 않는다.** 항목 삭제는 웹에서 사람이 한다(import 는 삭제하지 않는다).
- ID 를 바꾸면 upsert 가 매칭에 실패해 **DB 에 중복 행이 생긴다.** 정렬을 예쁘게 하려고 번호를 다시 매기지 않는다.
- **import 성공 후에는 wbs.md 를 다시 생성하지 않는다.** 이후 구조 변경은 웹에서 한다 — 재생성은 예외 경로이며, 하려면 위 ID 복원을 반드시 거친다.

### 넣지 않는 것 (웹이 정본)

- **실적·진척률** — 이미 금지다(`## 출력 형식` 말미). 재업로드해도 웹 값이 보존된다.
- **`[as]` 이상의 상태 시드** — 위 `## 상태` 절 참조.
- **D'Flow 식별자**(`project_id`·`wbs_item` UUID·주문 상태) — 업로드 **요청 파라미터**이지 파일 필드가 아니다. 어디에 두는지는 바로 아래 절.
- **담당팀(`item_owners`)** — D'Flow 조직 축이며 파일에 대응 개념이 없다. 담당자(개인)와 혼동하지 않는다.
- **브랜치·워크트리 경로** — 넣지 않는다. 이유 넷:
  1. **이미 파생값이다** — `wp-setup.py:257,269,270` 실측: `wt_name = {WP_ID}{suffix}` → 워크트리 `.claude/worktrees/{wt_name}` · 브랜치 `dev/{wt_name}`. 계산되는 값을 파일에 복제하면 반드시 어긋난다.
  2. **wbs.md 자체가 워크트리마다 복제된다** — WP당 워크트리 N개가 각자 사본을 갖는데, `merge-wbs-status.py` 는 `status` 한 컬럼만 우선순위 머지하고(`:28-33,172`) 다른 필드엔 머지 규칙이 없다.
  3. **자기 참조 역설** — 브랜치 `dev/WP-04` 에서 "branch: dev/WP-04" 를 커밋하면 main 머지 순간 거짓이 된다. 브랜치는 지워져도 기록은 남는다.
  4. **추적 정본은 git 이다** — 커밋 트레일러 `DFlow-Order: <uuid>`(부록 §3) + `done --auto-links` + 0072 `evidence.{branch,base_sha,head_sha,repo_url,pr_url}`. `git log --grep='DFlow-Order: <uuid>'` 가 브랜치명보다 강한 추적이다(브랜치는 지워져도 커밋은 남는다).

  **분산(사람마다 다른 PC·다른 클론) 환경에서는 근거가 더 강해진다** — 각자 자기 Task 줄에 브랜치를 쓰면 wbs.md 가 상시 충돌하고, 위 1번의 파생 규칙(`dev/{WP_ID}`)은 `/dev-team` 이 한 PC 에서 워크트리를 팔 때만 성립해 사람이 손으로 판 브랜치에는 적용되지 않는다.

  실행 시점의 작업 위치를 남겨야 한다면 자리는 둘로 갈린다:
  - **단일 PC(워크트리 병렬)** — `docs/tasks/<ID>/state.json`(실행 정본, 워크트리마다 값이 달라도 정상, 머지 대상 아님). **DEV-01 의 몫.**
  - **분산 다인** — **서버**(D'Flow). 남의 PC 파일은 볼 수 없으므로 state.json 도 답이 아니다.

  어느 쪽이든 **이 스킬의 범위가 아니다.** 분산 추적에 대한 `/wbs-wsf` 의 기여는 다른 둘이다 — **안정적 ID**(서버 추적이 한 항목에 누적되려면 `external_ref` 가 안 바뀌어야 한다)와 **`assignee` 시드**(자동 발행 → 주문 → claim → 서버 추적의 진입점).

### D'Flow 프로젝트 바인딩 — wbs.md 가 아니라 작업 리포의 `.env`

**D'Flow 에는 프로젝트가 여러 개 있다.** wbs.md 하나가 어느 D'Flow 프로젝트로 올라가는지는 반드시 명시돼야 하며, 그 자리는 **작업 리포의 `.env`** 다. wbs.md 에 넣지 않는 이유: 파일은 git 으로 복제·브랜치되고 테스트/운영 환경을 오가는데, 그 안에 환경 결합을 박으면 **엉뚱한 프로젝트에 업로드되어 운영 데이터를 오염시킨다.**

```env
DFLOW_API_BASE=https://<host>
DFLOW_PATS=dflow_pat_<prefix>_<secret>[,dflow_pat_...]

# 리포 ↔ D'Flow 프로젝트 바인딩
DFLOW_PROJECT_ID=<D'Flow project uuid>          # 리포 전체가 한 프로젝트일 때
DFLOW_PROJECT_MAP=docs/c10=<uuid>,docs/m30=<uuid>  # DOCS_DIR 마다 프로젝트가 다를 때
```

해석 순서(먼저 맞는 것이 이긴다):

1. `DFLOW_PROJECT_MAP` 에 현재 `DOCS_DIR` 키가 있으면 그 값
2. 없으면 `DFLOW_PROJECT_ID`
3. **둘 다 없으면 업로드를 시도하지 않는다** — 추측하거나 "프로젝트 하나뿐이겠지"로 진행하지 않는다(fail-closed). 생성은 정상 완료하되 리포트에 `업로드 불가 — .env 에 DFLOW_PROJECT_ID 또는 DFLOW_PROJECT_MAP 필요` 를 남긴다.

`module` 업로드 파라미터는 `DOCS_DIR` 의 마지막 경로 세그먼트다(`docs/c10` → `c10`, `docs` → `docs`). 별도 env 키를 만들지 않는다.

스킬이 지키는 것:

- `.env` 는 **존재·키 유무만 확인하고 값을 출력하지 않는다.** 같은 파일에 PAT 가 들어 있다(부록 §2.7 — 한 파일에 N인분 자격증명).
- 이 키들을 **wbs.md 에도, 생성 리포트 본문에도 값으로 적지 않는다.** 리포트에는 "설정됨 / 없음"만 쓴다.
- `.env` 를 생성하거나 수정하지 않는다. 없으면 필요한 키 이름만 알린다.

⚠️ 키 이름은 부록 §2.7 로컬 계약의 확장이며 **TSK-01-01(계약 동결)에서 최종 확정된다.** 확정 값이 다르면 이 절을 그쪽에 맞춘다.

## depends 규칙 (정본: wbs-workflow.md §2)

- **FS(Finish-to-Start)만 사용한다.** SS 등 다른 유형 없음.
- **FS 의존과 일정 겹침은 공존 금지** — 검증식: depends 있는 쌍은 `후행 시작일 > 선행 종료일` 이어야 한다. 겹치게 계획했으면 의존을 제거하거나 일정을 밀어라.
- fast-tracking 은 **계약 분리**로 표현: 계획 단계 = 일정 겹침(비의존), 실행 단계 = 계약 동결(contract Task).
- 개발 Task 는 설계 Task 가 아니라 **계약 Task** 에 depends (설계는 전이적 게이트).

**계약 전용 Task 관례** (MES 샘플 준수):
- `category: infra`, `tags: contract`, 제목에 "(계약 전용)" 접미
- acceptance 에 "실행 로직 없음 (contract-only)" 명시
- 범위: DDL·타입·인터페이스·스키마·이벤트 페이로드 정의만
- 유일한 depends = 해당 DB(ERD)/설계 분리 Task

**공유 계약 사전 분석 (Task 분해 전 필수)**: TRD 4종 스캔 (data-model / API / 타입·스키마 / 이벤트) → "2개 이상 feature 참조?" → 예면 계약 전용 Task 선행 분리, feature 들이 depends 연결. 1개 전용이면 수직 슬라이스로 흡수.

## 프로그램 리스트 입력 어댑터 (정본: 부록 §2.6 · DEV-04)

포맷별로 다루지 않는다. **정규화 어댑터 1층**이 아래 공통 스키마로 수렴시키고, 그 뒤는 PRD 모드와 같은 생성 규칙을 탄다.

### 공통 스키마

| 키 | 필수 | 의미 | 없을 때 |
|---|---|---|---|
| `module` | ✅ | 모듈·서브시스템 코드 (WP 단위) | 에러 후 중단 |
| `program_id` | ✅ | 프로그램 ID (전역 유일) | 에러 후 중단 |
| `program_name` | ✅ | 프로그램명 (Task 제목) | 에러 후 중단 |
| `group` | — | 업무·프로세스 그룹 (ACT 단위) | 4단계면 유형별로 묶는다 |
| `type` | — | 화면 / 배치 / 리포트 / 인터페이스 | `화면` 으로 간주 + 리포트 |
| `difficulty` | — | 상 / 중 / 하 | `중` 으로 간주 + 리포트 |
| `owner` | — | 담당 (email 이어야 시드됨) | `assignee: -` |
| `module_owner` | — | 모듈 담당 (WP/ACT `assignee`) | 기록 안 함 |
| `route` | — | 화면 경로 | `/{module}/{program_id 소문자}` 로 파생 |
| `depends` | — | 선행 프로그램 ID, `;` 또는 `,` 구분 | 모듈 계약 Task 만 depends |
| `priority` | — | critical / high / medium / low | `high` |
| `note` | — | 비고 | 생략 |

### 헤더 별칭 (한글 헤더 지원)

헤더 문자열에서 **공백·언더스코어·하이픈을 제거하고 소문자로 바꾼 뒤** 아래 목록과 대조한다.

| 키 | 인식하는 헤더 |
|---|---|
| `module` | 모듈, 모듈명, 모듈코드, 시스템, module, mod, subsystem |
| `program_id` | 프로그램id, 프로그램코드, 화면id, pgmid, programid, id, code |
| `program_name` | 프로그램명, 화면명, 기능명, programname, name, title |
| `group` | 그룹, 업무그룹, 프로세스그룹, 단위업무, group, pg |
| `type` | 유형, 구분, 프로그램유형, 화면유형, type, kind |
| `difficulty` | 난이도, 복잡도, difficulty, complexity, level |
| `owner` | 담당, 담당자, 개발자, owner, assignee, developer |
| `module_owner` | 모듈담당, 모듈담당자, moduleowner |
| `route` | 화면경로, 경로, url, route, path, menu |
| `depends` | 선행, 선행프로그램, 의존, depends, predecessor |
| `priority` | 우선순위, priority |
| `note` | 비고, 설명, note, remark, description |

`group` 의 별칭에 `category` 를 **넣지 않는다** — WBS 의 `category`(7종 약어)와 충돌한다.

### 포맷별 읽기

| 포맷 | 방법 |
|---|---|
| `.json` | 객체 배열, 또는 `{"programs": [...]}` 의 그 배열 |
| `.yaml` / `.yml` | `python3 -c "import yaml,json,sys; print(json.dumps(yaml.safe_load(open(sys.argv[1])), ensure_ascii=False))" {경로}` — `pyyaml` 설치 확인됨 |
| `.csv` | `csv.DictReader`, 인코딩 `utf-8-sig` (엑셀 CSV 의 BOM) |
| `.md` | 파일의 **첫 번째 GFM 파이프 표**. 헤더 행 → 구분 행(`---`) → 데이터 행. 셀 앞뒤 공백과 양끝 `|` 제거 |
| `.xlsx` | 첫 시트. `openpyxl` 이 있으면 그것으로, 없으면 아래 표준 라이브러리 리더로 |

`.xlsx` 표준 라이브러리 리더 (의존성 0 — `openpyxl` 미설치 환경 실측 대응):

```python
import sys, zipfile, re, json, xml.etree.ElementTree as ET
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
z = zipfile.ZipFile(sys.argv[1])
ss = []
if 'xl/sharedStrings.xml' in z.namelist():
    for si in ET.fromstring(z.read('xl/sharedStrings.xml')):
        ss.append(''.join(t.text or '' for t in si.iter(NS + 't')))
sheet = sorted(n for n in z.namelist() if n.startswith('xl/worksheets/sheet'))[0]
rows = []
for row in ET.fromstring(z.read(sheet)).iter(NS + 'row'):
    vals = {}
    for c in row.iter(NS + 'c'):
        col = re.match(r'[A-Z]+', c.get('r')).group(0)
        v = c.find(NS + 'v')
        txt = '' if v is None else v.text
        if c.get('t') == 's':
            txt = ss[int(txt)]
        elif c.get('t') == 'inlineStr':
            txt = ''.join(t.text or '' for t in c.iter(NS + 't'))
        vals[col] = txt
    rows.append(vals)
hdr = rows[0]
cols = sorted(hdr, key=lambda k: (len(k), k))
print(json.dumps([{hdr[c]: r.get(c, '') for c in cols} for r in rows[1:]], ensure_ascii=False))
```

### 검증 (에러 3원칙 — 실패를 "없음"으로 위장하지 않는다)

**중단하는 것:**
- 필수 3키(`module`·`program_id`·`program_name`) 중 하나라도 헤더 매핑 실패 → 인식한 헤더 목록과 함께 에러 후 중단
- `program_id` 중복 → 중복 ID 를 **전량 나열**하고 중단
- `module` 또는 `program_name` 이 빈 행 → 행 번호와 함께 나열하고 중단

**진행하되 리포트하는 것** (생성물 마지막에 `## 입력 매핑 리포트` 챕터로 남긴다):
- `type` 미기재·미매핑 → `화면` 으로 처리한 목록
- `difficulty` 미기재·미매핑 → `중` 으로 처리한 목록
- `owner` 가 **기재됐는데** email 이 아님 → 원문과 함께 나열 (`assignee: -` 로 생성됨). 빈 값(미기재)은 나열하지 않는다
- `depends` 가 존재하지 않는 `program_id` 를 가리킴 → 나열 후 그 의존만 버린다
- `route` 미기재로 파생값을 쓴 목록

### 생성 규칙 — 계층 배치

규모 판정(프로그램 리스트 모드 전용 — 입력에 기간·팀 정보가 없어 기존 4기준 표를 그대로 못 쓴다):

- **4단계**: 프로그램 수 ≥ 50 **또는** 모듈 수 ≥ 5 **또는** (모듈 수 ≥ 2 **그리고** `group` 컬럼 존재)
- 그 외 **3단계**. `--scale` 이 있으면 그것이 우선한다.

| 레벨 | 4단계 | 3단계 |
|---|---|---|
| WP | `## WP-XX: {module}` | `## WP-XX: {module}` |
| ACT | `### ACT-XX-YY: {group}` (`group` 없으면 유형 묶음 — 화면·리포트·배치·인터페이스 순) | — |
| Task | `#### TSK-XX-YY-ZZ: {program_name}` | `### TSK-XX-ZZ: {program_name}` |

- 모듈 순서 = **입력 등장 순서**. 기능 WP 는 `WP-02` 부터 (`WP-00` 초기화 · `WP-01` 기본설계 예약).
- 4단계에서 각 기능 WP 의 **`ACT-XX-01` 은 모듈 계약 ACT 로 예약**한다 (MES 관례: `docs/MES/wbs.md:452-456`). 기능 ACT 는 `ACT-XX-02` 부터.
- 번호 부여 전에 **기존 wbs.md 의 ID 매핑을 복원한다** (`## D'Flow 연동 표기` 의 ID 불변 규칙).

### 생성 규칙 — 프로그램 1개 = Task 1개 (수직 슬라이스 강제)

**한 프로그램은 한 Task 안에서 백엔드와 프론트엔드를 함께 처리한다.** "OO화면 API" / "OO화면 UI" 로 나눈 Task 를 만들지 않는다 — 계약이 흩어져 수정·테스트가 맞물려 실패한다. 프로그램이 너무 크면 layer 로 자르지 말고 **기능 단위로 수직 분할**한 뒤 각각을 별도 프로그램 ID 로 입력에 되돌린다.

| `type` | `category` | `domain` | `entry-point` |
|---|---|---|---|
| 화면 | `dev` | `fullstack` | 필수 — `{route} (메뉴: {module} > {program_name})` |
| 리포트 | `dev` | `fullstack` | 필수 — 동일 |
| 배치 | `dev` | `backend` | `-` |
| 인터페이스 | `dev` | `backend` | `-` |

`route` 가 없으면 `/{module}/{program_id 소문자}` 로 파생하고 리포트에 남긴다.

| `difficulty` | `model` | 기간(영업일) |
|---|---|---|
| 하 (L / low / 1~2) | `sonnet` | 2 |
| 중 (M / medium / 3, 미기재) | `sonnet` | 3 |
| 상 (H / high / 4~5) | `opus` | 5 |

`model` 값은 **시드**다. `## Task 분해 원칙` 의 의미 규칙("다중 시스템·아키텍처·보안 핵심 → `opus`")이 여전히 우선하므로, 난이도가 `중`이어도 인증·정산·상태기계처럼 판단 비용이 큰 프로그램이면 `opus` 로 올리고, 난이도 `상`이어도 단순 대량 CRUD 면 `sonnet` 으로 내린다. 올리거나 내렸으면 그 Task 의 `note:` 에 한 줄 근거를 남긴다.

⚠️ **이 기간표는 아래 `## 일정 계산` 의 category 표(dev 기본 10일, 5~15)를 대신한다.** 그 표는 PRD 유래 기능 Task(여러 프로그램을 아우르는 단위) 기준이고, 프로그램 1개 = 수직 슬라이스에는 `## Task 분해 원칙` 의 크기 규칙(**권장 1~3일 / 최대 1주**)이 우선한다. 추정은 시드값이라 비고·화면 수로 올릴 수 있으나, **1주(5영업일)를 넘기면 기간을 늘리지 말고 프로그램을 분할한다.** 선행/후행 공정 Task 는 종전대로 `## 일정 계산` 표를 쓴다.

Task 필드 생성값:

- `status: [ ]` · `priority: {priority 또는 high}` · `assignee: {owner 가 email 이면 그 값, 아니면 -}`
- `tags: {module}, {type 영문 슬러그}` — 화면 `ui` · 리포트 `report` · 배치 `batch` · 인터페이스 `interface`
- `prd-ref: program:{program_id}` (필수)
- `note:` 는 입력 `note` 가 있을 때만
- `requirements` / `acceptance` — 프로그램명·유형에서 유도하고, PRD/TRD 가 함께 주어졌으면 해당 절을 인용해 보강한다

### 생성 규칙 — WSF 샌드위치 골격 (PRD/TRD 없이도 동일 생성)

프로그램 리스트에는 TRD 가 없으므로 `## 실행 플로우` 4단계의 **공유 계약 4종 스캔이 성립하지 않는다.** 그 자리를 아래 고정 골격이 대신한다.

**골격과 depends 사슬은 고정이다** (형태 근거: MES 4단계 wbs.md 실물의 depends 를 그대로 일반화했다). 3단계면 아래 ID 에서 마지막 세그먼트를 하나 뺀다.

| Task | category | depends |
|---|---|---|
| WP-00 · 스캐폴드 + DB 연결 + CI | `infra` | `-` |
| WP-01 · 전사 아키텍처·공통 계약 설계 | `design` | 스캐폴드 Task |
| WP-00 · 전사 공유 계약 (계약 전용) | `infra`, `tags: contract` | **전사 아키텍처 설계 Task** |
| WP-00 · 권한 가드 + 공통 레이아웃 셸 | `infra` | 전사 공유 계약 Task |
| WP-01 · `{module} DB(ERD) 설계` (모듈당 1개) | `design` | 전사 아키텍처 설계 Task |
| 기능 WP · `{module} 공유 계약 (계약 전용)` (모듈당 1개) | `infra`, `tags: contract` | 그 모듈의 DB(ERD) 설계 Task, 전사 공유 계약 Task |
| 기능 WP · 프로그램 Task | `dev` | 아래 3항 |
| 마지막 WP · 모듈별 통합 시나리오 (모듈당 1개) | `itest` | 그 모듈 기능 Task 전부 |
| 마지막 WP · 모듈 관통 시나리오 (모듈 ≥ 2 일 때만 1개) | `itest` | 각 모듈의 대표 기능 Task |

- **WP 번호 순서와 depends 순서는 다르다** — 전사 계약(WP-00)이 전사 설계(WP-01)에 depends 하는 것이 정상이다. WP 번호는 성격별 묶음이고 실행 순서는 depends 가 정한다.
- 권한 가드·셸 Task 는 **화면·리포트 유형이 1건이라도 있을 때만** 생성한다. 없으면 그 Task 를 만들지 않고, 기능 Task 의 depends 2항도 생기지 않는다.
- **모듈 계약 Task 는 모듈 수와 무관하게 항상 생성한다** — 모듈이 1개여도 예외를 두지 않는다. 전사 계약(공통코드·조직·권한)과 모듈 계약(그 모듈 도메인)은 범위가 다르고, 예외를 두면 사슬이 모듈 수에 따라 갈라진다.
- 기능 Task 의 `depends` 는 정확히 셋의 합집합:
  1. 자기 모듈의 계약 Task (항상)
  2. 화면·리포트 유형이면 WP-00 의 셸 Task
  3. 입력 `depends` 가 가리키는 프로그램의 Task ID (존재하는 ID 만 — 나머지는 리포트)

**마지막 WP 통합테스트는 모듈 수와 무관하게 항상 생성한다**(부록 §2.6: 샌드위치 골격은 동일 생성). `## 전체 구조` 의 "기능 WP 2개 이상이면 필수" 는 PRD 모드 기준이며, 프로그램 리스트 모드는 이를 무조건 생성으로 강화한다.

이 사슬의 최장 경로는 **6노드(스캐폴드 → 전사 설계 → 전사 계약 → 셸 → 기능 → itest)** 로 고정이며, 그중 기능 구간 내부(모듈 계약 → 기능 → itest)는 3이다. 초과분 3은 전부 공정 양끝(선행 2 · 후행 1)에서 온 구조 비용이므로 `## 의존 그래프` 챕터에 그 사실을 명시한다.

⚠️ **의존 그래프 구조 예외** — 모듈 계약 Task 의 fan-in 은 그 모듈의 프로그램 수만큼 구조적으로 커진다. **`fan_in ≥ 3` 계약 추출 재검토 대상에서 제외**하고, 통합테스트 Task 의 fan-in 을 제외하는 것과 같은 논리임을 `## 의존 그래프` 챕터에 명시한다. 이 예외가 없으면 생성된 WBS 가 매번 자기 리뷰 게이트에 걸린다.

## 엑셀 export (`--export-xlsx`) — 보고본

정본은 `wbs.md` 다. xlsx 는 **읽기 전용 파생 산출물**이며 다시 wbs.md 로 되돌리지 않는다(부록 §2.6 — 바이너리는 diff·병합·검수가 불가하다).

**용도는 "import 전 사람 검수" 하나다.** wbs.md 가 import 후 은퇴하므로 wbs.md 기준 엑셀은 import 시점의 스냅샷이고 곧 낡는다. 운영·대외 보고본은 D'Flow export(DB 기준)다. 검수 결과 수정은 **입력 프로그램 리스트나 wbs.md 를 고쳐 재생성**하는 것이지 엑셀을 고치는 것이 아니다.

### 데이터 출처 — wbs.md 를 직접 파싱하지 않는다

실행 중 Task 는 `docs/tasks/<ID>/state.json` 이 진실 원천이고 wbs.md 는 파생 사본이다(부록 §7.1-F2). 따라서:

1. `wbs-parse.py {wbs} --tasks-all` 로 **Task ID 목록**을 얻는다 (이 모드는 `tsk_id`·`title`·`status`·`depends`·`domain`·`category` 6필드만 낸다 — `wbs-parse.py:198-224` 실측).
2. 각 ID 에 대해 `wbs-parse.py {wbs} {TSK_ID} --json` 을 호출해 **나머지 필드**를 얻는다 — `model`·`priority`·`assignee`·`schedule`·`tags`·`blocked-by`·`note`·`entry-point`·`prd-ref` (`wbs-parse.py:829-836` 실측). N회 호출은 부록 §2.6이 DEV-02 전 과도기로 명시한 방식 그대로다.
3. **WP/ACT 행의 제목만** wbs.md 헤딩 정규식(`^##\s+(WP-\d+):\s*(.*)` · `^###\s+(ACT-\d+-\d+):\s*(.*)`)으로 읽는다. 파서가 계층 노드를 내지 않기 때문이며(부록 §7.1-F5), **헤딩은 구조라 진실 원천 문제가 없다.** 그 블록의 필드는 읽지 않는다.
4. **부모 귀속은 ID 세그먼트로 유도한다** — 파서가 계층을 내지 않으므로 이것이 유일한 연결 고리다(`## D'Flow 연동 표기` 의 ID 불변 규칙이 기대는 것과 같은 규칙).
   - 4단계: `TSK-02-02-01` → `ACT-02-02` → `WP-02`
   - 3단계: `TSK-02-03` → `WP-02` (ACT 행 없음)
   - 유도한 부모 ID 가 3단계에서 읽은 헤딩 목록에 없으면 **그 Task 를 버리지 않고** 부모 없이 쓰고 리포트에 나열한다.

⚠️ `status` 는 어떤 경우에도 wbs.md 텍스트에서 읽지 않는다 — 1·2단계의 파서 출력만 쓴다. DEV-02(`--export`)는 `/dflow-export` 스킬에 구현돼 있으나(`.claude/skills/dflow-export/scripts/wbs-parse.py`), **이 스킬의 동봉 스냅샷(`wbs-wsf/scripts/`)은 구판이라 위 N회 호출 절차를 유지한다** — 스냅샷을 신판으로 교체할 때 이 절차를 한 번의 `--export` 호출로 대체한다.

### 컬럼

| # | 컬럼 | 출처 |
|---|---|---|
| 1 | 레벨 (`WP`/`ACT`/`TSK`) | 행 종류 |
| 2 | ID | 헤딩 ID (= D'Flow `external_ref`) |
| 3 | 제목 | 헤딩 |
| 4 | category | `--json` |
| 5 | domain | `--json` |
| 6 | model | `--json` |
| 7 | 상태 코드 | `--tasks-all` 의 `status` (예: `[ ]`) |
| 8 | 상태 | `docs/state-machine.json` 의 `states[코드].label` — **하드코딩 금지, 그 파일에서 읽는다** |
| 9 | 담당 | `--json` 의 `assignee` |
| 10 | 시작일 | `schedule` 의 ` ~ ` 앞 |
| 11 | 종료일 | `schedule` 의 ` ~ ` 뒤 |
| 12 | 영업일 | 시작~종료 영업일 수 (주말 제외) — 숫자 |
| 13 | depends | `--json` |
| 14 | entry-point | `--json` |
| 15 | prd-ref | `--json` |
| 16 | tags | `--json` |
| 17 | 진척(파생) | `docs/state-machine.json` 의 `progress` 블록으로 환산 — 숫자 |
| 18 | note | `--json` |

- **17번은 파생값이다.** `category` 가 `progress.agile.applies_to` 에 있으면 `progress.agile.state_weights[상태코드]`, `progress.process.applies_to` 에 있으면 `progress.process` 규칙(`pre_accept_cap` 포함)을 적용한다. **환산표를 스킬이나 스크립트에 하드코딩하지 않는다** — `state-machine.json` 의 `progress._comment` 가 그것을 금지한다.
- **`docs/state-machine.json` 이 대상 리포에 없으면** 8번은 상태 코드 그대로, 17번은 `[ ]` = 0 으로 두고 리포트에 그 사실을 남긴다 (import 전 검수용 스냅샷은 전 Task `[ ]` 라 실질 손실이 없다).
- WP/ACT 행은 4~6·9·13~16·18 을 비우고, 10·11 은 **위 4단계로 귀속된 하위 Task** 의 최소 시작일·최대 종료일, 12·17 은 그 하위 집합에 `progress.rollup` 규칙(영업일 가중 평균)을 적용해 채운다. 하위가 하나도 없는 WP/ACT 는 10~12·17 을 비우고 리포트에 나열한다.
- **실적%·진행률을 사람이 입력하는 컬럼은 만들지 않는다.**
- **1행은 헤더 고정**(도구 호환 — 위에 주석 행을 얹지 않는다). 디스클레이머는 **마지막 데이터 행 다음 한 줄**의 A열에 넣는다:
  `import 전 검수용이다 — wbs.md 기준이며 D'Flow 실적·배정은 반영되지 않는다. 운영 보고본은 D'Flow export 를 쓴다. 이 파일을 고쳐도 정본에 반영되지 않는다.`

### 쓰기 — 의존성 0

`openpyxl` 이 있으면 그것을 쓰고, 없으면(실측 환경이 그렇다) 표준 라이브러리로 쓴다. 문자열 셀은 `t="s"`(sharedStrings), 숫자 셀(12·17번)은 `t` 속성을 생략한다.

```python
import zipfile, html

def write_xlsx(path, rows):           # rows[0] = 헤더, 셀 값은 str 또는 int/float
    ss, idx, body = [], {}, []
    def sid(v):
        if v not in idx:
            idx[v] = len(ss); ss.append(v)
        return idx[v]
    for r, row in enumerate(rows, 1):
        cs = []
        for c, v in enumerate(row):
            ref = f"{chr(ord('A') + c)}{r}"
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                cs.append(f'<c r="{ref}"><v>{v}</v></c>')
            else:
                cs.append(f'<c r="{ref}" t="s"><v>{sid(str(v))}</v></c>')
        body.append(f'<row r="{r}">{"".join(cs)}</row>')
    M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    z = zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED)
    z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>')
    z.writestr("_rels/.rels", f'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{R}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    z.writestr("xl/workbook.xml", f'<?xml version="1.0"?><workbook xmlns="{M}" xmlns:r="{R}"><sheets><sheet name="WBS" sheetId="1" r:id="rId1"/></sheets></workbook>')
    z.writestr("xl/_rels/workbook.xml.rels", f'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="{R}/sharedStrings" Target="sharedStrings.xml"/></Relationships>')
    z.writestr("xl/worksheets/sheet1.xml", f'<?xml version="1.0"?><worksheet xmlns="{M}"><sheetData>{"".join(body)}</sheetData></worksheet>')
    z.writestr("xl/sharedStrings.xml", '<?xml version="1.0"?><sst xmlns="%s" count="%d" uniqueCount="%d">%s</sst>' % (M, len(ss), len(ss), "".join("<si><t>%s</t></si>" % html.escape(s) for s in ss)))
    z.close()
```

`html.escape` 를 반드시 통과시킨다 — Task 제목에 `&`·`<` 가 들어가면 파일이 열리지 않는다. 서식(열 너비·틀 고정·색)은 이 절의 범위 밖이다.

### 순서와 실패 처리

- 행 순서는 wbs.md 등장 순서 그대로 — WP → (ACT) → 그 하위 Task.
- `--json` 호출이 실패한 Task 는 **건너뛰지 않는다.** 그 행을 쓰되 실패한 컬럼을 비우고, 생성 리포트에 ID 와 함께 나열한다(에러 3원칙: 조회 실패를 "데이터 없음"으로 위장하지 않는다).
- 출력 경로에 파일이 이미 있으면 덮어쓴다. 정본이 아니므로 백업하지 않는다.

## Task 분해 원칙

- UI 있는 기능 = 화면+API+전용 DB 를 **하나의 `fullstack` Task** (layer 수평 분할 금지, 큰 화면은 수직 분할). `entry-point` 필수.
  프로그램 리스트 모드에서는 이 원칙이 **프로그램 1개 = Task 1개**로 구체화된다 (`## 프로그램 리스트 입력 어댑터`).
- 순수 백엔드 = `backend` 단독, `entry-point: -`.
- 크기: 최소 4시간 / 권장 1~3일 / 최대 1주.
- `model` 필드: 다중 시스템·아키텍처·보안 핵심 → `opus`, 표준 패턴 → `sonnet`. 명시 권장 (생략 시 `wbs-parse.py --complexity` fallback).

## 일정 계산

| category | 기본 | 범위 |
|----------|------|------|
| dev | 10일 | 5~15 |
| defect | 3일 | 2~5 |
| infra | 5일 | 2~10 |
| design | 5일 | 3~7 |
| research | 3일 | 2~5 |
| itest | 5일 | 3~10 |

depends 기반 시작/종료일 산출. 산출 후 FS+겹침 검증식 통과 확인.

⚠️ 위 표는 **PRD 유래 기능 Task** 기준이다. 프로그램 리스트 모드의 기능 Task 는 난이도 기반 기간표(하 2 / 중 3 / 상 5 영업일)를 쓴다 — 근거는 `## 프로그램 리스트 입력 어댑터`. 선행·후행 공정 Task 는 모드와 무관하게 이 표를 쓴다.

## Dev Config

`# WBS` 메타 블록 아래 `---` 직후, 첫 `## WP-` 앞에 정확히 한 번.
골격은 플러그인 템플릿 참조: `.claude/skills/wbs-wsf/references/dev-config-template.md` 를 Read 후 채운다. (경로 실재 확인됨)

- **PRD 모드**: TRD 로 채운다.
- **프로그램 리스트 모드**: TRD 가 없어도 **템플릿 골격을 반드시 생성한다** — 이 블록이 없으면 `wbs-parse.py --dev-config` 와 `wbs-validate.py` 가 돌지 않는다.
  - `Domains` 표의 행은 **실제 생성된 Task 의 domain 집합만** 남긴다 (`fullstack`·`backend` + 공정 Task 의 `database`·`infra`·`test`).
  - `Quality Commands`·`Design Guidance` 는 템플릿 기본값을 그대로 두고, PRD/TRD 가 함께 주어졌으면 그 내용으로 덮는다.
  - 추측으로 명령어를 지어내지 않는다 — 모르는 칸은 템플릿 기본값이 정답이다.

## 실행 플로우

1. **VIEW_MODE** 면 파일 전체 표시 후 종료. `--export-xlsx` 가 함께 오면 표시 후 14번(엑셀 보고본 생성)만 실행하고 종료한다 — 2~13번은 건너뛴다.
2. 대상 리포의 `docs/wbs-workflow.md` 가 있으면 Read (규칙 로드).
3. 입력 분석·규모 산정 (`--estimate-only` 면 여기서 종료).
   - PRD 모드: PRD/TRD 분석 → 기존 규모 판별 4기준.
   - 프로그램 리스트 모드: `--programs` 파일 로드 → 정규화 → **검증(중단 조건 먼저)** → 프로그램 수·모듈 수·`group` 유무로 규모 판정. PRD/TRD 가 있으면 함께 읽어 컨텍스트로만 쓴다.
4. 계약 Task 목록 확정.
   - PRD 모드: 공유 계약 사전 분석 (TRD 4종 스캔).
   - 프로그램 리스트 모드: 고정 골격 — 전사 계약 1개 + 모듈당 계약 1개(모듈 수 무관). TRD 가 없으므로 4종 스캔은 실행하지 않는다.
5. WP 매핑 (샌드위치): WP-00 → WP-01(설계, DB 분리) → 기능 WP → 통합 WP.
6. (4단계만) ACT 분해 — MECE, 1~4주.
7. Task 분해 + category/domain/model + PRD/TRD 컨텍스트 주입 (requirements/acceptance/tech-spec 등 자기 완결).
8. 일정 계산 + FS+겹침 검증.
9. `{DOCS_DIR}/wbs.md` 생성.
10. 의존 그래프 검증:
    ```bash
    python3 .claude/skills/wbs-wsf/scripts/wbs-parse.py {DOCS_DIR}/wbs.md --tasks-all > {scratchpad}/tasks.json
    python3 .claude/skills/wbs-wsf/scripts/dep-analysis.py {scratchpad}/tasks.json --graph-stats
    ```
    `max_chain_depth > 3`(기능 구간 내부 기준, 공정 양끝 +2 는 구조 비용 허용) 또는 `fan_in ≥ 3` → 계약 추출 재검토. 결과를 `## 의존 그래프` 챕터에 기록 (후보 없어도 "후보 없음" 명시).
11. (프로그램 리스트 모드) **`## 입력 매핑 리포트` 챕터 작성** — `## 의존 그래프` 챕터 **앞**에 배치.
    유형 미매핑 · 난이도 미매핑 · 담당 미매칭 · depends 미해결 · route 파생, 다섯 표를 전부 쓴다.
    해당 없는 표는 "해당 없음"이라고 명시한다 — 비워두지 않는다.
12. 출력 검증.
    - 3단계: `wbs-validate.py` 실행.
    - **4단계: `wbs-validate.py` 결과를 구조 검증으로 쓰지 않는다**(task_count 0 + `ok:true`). 대신
      `wbs-parse.py --tasks-all` 로 Task 건수·`category`·`domain`·`entry-point` 를 직접 확인하고,
      생성 리포트에 "4단계 — wbs-validate·merge-wbs-status 무력화(DEV-03 대기)" 를 출력한다.
13. **`.env` 바인딩 확인** — `## D'Flow 연동 표기` 의 프로젝트 바인딩 절 그대로. 키 유무만 보고
    (값 출력 금지), 해석 결과(업로드 가능 / `업로드 불가 — .env 에 DFLOW_PROJECT_ID 또는
    DFLOW_PROJECT_MAP 필요`)를 생성 리포트에 남긴다. 없어도 생성은 정상 완료다(fail-closed 는 업로드에만).
    **실제 업로드는 이 스킬이 하지 않는다 — `/dflow-export` 스킬이 담당한다**
    (검증 게이트 → `--export` → 봉투 조립 → dry-run/`--push`). 리포트에 다음 단계로 안내한다.
14. (`--export-xlsx` 있을 때) **엑셀 보고본 생성** — `## 엑셀 export` 절 그대로. 실패해도 wbs.md 생성 결과를 되돌리지 않고, 실패 사유를 리포트에 남긴다.

**생성 리포트** — 실행 종료 시 사용자에게 출력하는 요약이다(별도 파일이 아니다 — 파일 산출물은
wbs.md 와 xlsx 뿐). 반드시 담는 것: 규모 판정(3/4단계)과 근거 · 검증 스크립트 실행 결과 요약 ·
4단계면 "wbs-validate·merge-wbs-status 무력화(DEV-03 대기)" 경고 · 담당 미매칭 요약 ·
`.env` 바인딩 상태("설정됨/없음"만 — 값 금지) · export 결과(해당 시).

## 출력 형식 (요약)

> 상세 정본은 동봉 발췌본 `.claude/skills/wbs-wsf/references/output-format.md` 다 —
> Task 속성 목록·리스트 필드 파싱 규칙, `#### PRD 요구사항`/`#### 기술 스펙 (TRD)` 블록 형식,
> 통합테스트 Task 형식, `## 의존 그래프` 챕터 형식(Mermaid·통계표·리뷰 후보)이 들어 있다.
> **출력 형식을 쓰기 전에 그 파일을 Read 한다.** 플러그인 원본(dev:wbs-wsf)은 더 이상 참조하지
> 않는다 — 상태 어휘(5상태)·category 표기(`development` 등)가 낡아, 발췌 시점에 이 스킬 규칙
> (상태 항상 `[ ]`·7종 약어)으로 치환해 뒀다.

```markdown
# WBS - {프로젝트명}

> version: 1.0
> depth: {3|4}
> start-date: / target-date: / updated:

---

## Dev Config
(템플릿 기반)

## WP-00: 프로젝트 초기화
- schedule: {시작} ~ {종료}

### TSK-00-01: {Task명}
- category: infra
- domain: infra
- model: sonnet
- status: [ ]
- priority: critical
- assignee: -
- schedule: {시작} ~ {종료}
- tags: setup
- depends: -
- entry-point: -

#### PRD 요구사항
- requirements: ...
- acceptance: ...

(계약 전용 예)
### TSK-00-02: users 스키마 + User 타입 정의 (계약 전용)
- category: infra
- tags: contract
- acceptance:
  - 실행 로직 없음 (contract-only)

## WP-{마지막}: 통합테스트
### TSK-{NN}-01: {시나리오 묶음}
- category: itest
- depends: {시나리오 관통 기능 체인 말단 Task들}

## 의존 그래프
(Mermaid + 통계 + 리뷰 후보 — 마지막 챕터 고정)
```

### 명세 블록 파싱 계약 (export v2 가 읽는 문법 — 어기면 조용히 유실된다)

`requirements`·`acceptance`·`test-criteria`·`constraints`·`tech-spec`·`api-spec`·`data-model`·`ui-spec`·`prd-ref` 는
`#### PRD 요구사항` / `#### 기술 스펙 (TRD)` 블록 관례를 **유지한다**(사람이 읽는 구획). 다만 파서는 그 헤딩을 보지 않고
**필드 줄만** 스캔하므로, 아래 넷이 실제 계약이다.

| # | 규칙 | 근거 | 어겼을 때 |
|---|---|---|---|
| 1 | **명세 블록 헤딩은 TSK 헤딩보다 반드시 한 단계 이상 깊다** — 3단계(`### TSK-`)면 `####`, 4단계(`#### TSK-`)면 `#####` | `wbs-parse.py:80` — `if found and hl >= 2 and hl <= level: break` (같거나 얕은 헤딩에서 블록이 끝난다) | **Task 블록이 명세 앞에서 잘려 전 필드가 통째로 유실**된다. 4단계에 `#### PRD 요구사항` 을 쓰는 것이 이 사고의 전형 |
| 2 | **필드 줄은 열 0에서 시작한다** — `- requirements:` (앞 공백 금지) | `wbs-parse.py:117` — `line.startswith("- {field}:")` | 그 필드만 빈 값이 된다 |
| 3 | **bullet 항목은 정확히 2칸 들여쓴다** — `  - 항목` | `parse_list_field` 의 bullet 형태(`:122-144`) | 항목이 안 잡히거나 앞 항목에 붙는다 |
| 4 | **빈 리스트는 생략하지 말고 `- field: -` 로 명시한다** | 같은 함수의 `-` 처리 | 필드 부재와 "비었음"이 구별되지 않는다 |

단일행 필드(`category`·`domain`·`model`·`status`·`priority`·`assignee`·`schedule`·`tags`·`depends`·`entry-point`·`prd-ref`·`note`)는
값에 콤마가 있어도 분할되지 않는다. 리스트 성격 값은 반드시 리스트 필드로 선언한다.

**4단계 생성 시에는 명세 블록 헤딩이 `#####` 인지 생성 직후 반드시 확인한다**(규칙 1 — 이 스킬이 만드는 가장 비싼 조용한 실패다).

- WP 레벨에 status/priority/progress 금지 (Task 집계로 파생).
- 의존 그래프 노드 표기: 3단계 4자리 `0001.`, 4단계 6자리 `000101.`.
- 진척율·실적은 입력하지 않는다 — import 후 진척·실적의 정본은 D'Flow 다. 재업로드해도 웹 값이 보존된다.

## 성공 기준

- PRD 전 기능 Task 커버, Task 1일~1주, prd-ref 추적성, 자기 완결성
- fullstack/frontend Task `entry-point` 필수 (orphan page 방지)
- 공유 계약 전부 선행 분리 + 계약 전용 관례 준수 (tags: contract)
- DB(ERD) 설계가 그룹 설계에서 분리되어 있음 (계약 파이프라인)
- depends 전부 FS + 겹침 검증식 통과
- 기능 구간 내부 `max_chain_depth ≤ 3` (공정 양끝 +2 허용, 예외는 근거 명시)
- 기능 WP 2+ 면 마지막 WP = 통합테스트, depends 는 기능 체인 말단 (프로그램 리스트 모드는 기능 WP 1개여도 필수)
- 모든 Task `status: [ ]`, ID 숫자만
- **재생성 시 기존 Task/WP/ACT ID 가 보존됨** — ID 는 D'Flow `external_ref` 매칭 키다 (`## D'Flow 연동 표기`)

**프로그램 리스트 모드 추가 기준:**

- 입력 프로그램 수 = 생성된 **기능 Task 수** (1:1). 한 프로그램이 2개 Task 로 쪼개지지 않았다
- 모든 기능 Task 의 `domain` 이 `fullstack` 또는 `backend` — "API"/"UI" 로 나뉜 Task 0건
- 모든 기능 Task 가 `prd-ref: program:{program_id}` 를 갖고, 그 값이 중복 없이 입력 ID 집합과 일치
- `assignee` 는 email 이거나 `-` — 이름 문자열이 들어간 Task 0건
- `## 입력 매핑 리포트` 챕터가 존재하고 다섯 표가 모두 채워짐 (해당 없으면 "해당 없음")
- 모듈 계약 Task 가 모듈마다 1개씩 존재하고, 기능 Task 가 전부 자기 모듈 계약 Task 에 depends

**명세 블록 파싱 계약 (import 유실 방지):**

- 4단계면 명세 블록 헤딩이 `#####`, 3단계면 `####` — TSK 헤딩보다 반드시 깊다
- 명세 필드 줄이 전부 열 0에서 시작하고, bullet 항목은 2칸 들여쓰기
- 빈 리스트가 생략되지 않고 `- field: -` 로 명시됨

**`--export-xlsx` 사용 시:**

- 엑셀 행 수 = WP 수 + ACT 수 + Task 수 (헤더·주석 행 제외)
- 상태 라벨·진척 환산이 `docs/state-machine.json` 에서 읽은 값이고 스킬에 하드코딩되지 않았다 (파일이 없으면 상태 코드 그대로 + 진척 0 + 리포트)
- 사람이 실적%를 입력하는 컬럼이 없다
