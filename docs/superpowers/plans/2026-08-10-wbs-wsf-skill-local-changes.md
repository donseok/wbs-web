# /wbs-wsf 로컬 오버라이드 변경 (DEV-04 · D'Flow 연동) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/wbs-wsf` 로컬 오버라이드 스킬이 프로그램 리스트(json/md/csv/xlsx/yaml)를 입력으로 받아 WSF 샌드위치 WBS를 생성하고, 엑셀 보고본을 파생 출력하며, 생성물이 D'Flow `/wbs/import` 계약(부록 §7.2)과 어긋나지 않도록 표기 규칙과 툴체인 제약 경고를 확정한다.

**Architecture:** 스킬은 실행 코드가 아니라 LLM이 읽는 지시문이므로, 변경은 전부 `SKILL.md` 텍스트 편집이다. 포맷을 슬롯별로 나눈 부록 §2.6의 원칙을 그대로 구현한다 — 입력은 어댑터 1층이 아무 포맷을 공통 스키마로 흡수하고, **정본은 md 하나**이며, 엑셀은 md에서 나가는 단방향 보고본이다. 프로그램 리스트 모드는 "정규화 어댑터 → 공통 스키마 → 기존 생성 규칙"으로 접붙여 PRD/TRD 경로와 샌드위치 골격·출력 형식을 공유한다. 검증은 단위 테스트가 아니라 샘플 입력으로 실제 wbs.md·wbs.xlsx를 만들어 `wbs-parse.py`와 표준 라이브러리 리더로 되읽는 방식이다.

**Tech Stack:** Markdown (SKILL.md) · Python 3 표준 라이브러리(`csv`/`json`/`zipfile`/`xml.etree`) + `pyyaml`(설치 확인됨) · dev 플러그인 스크립트 `dev/1.7.1/scripts/*`

**설계 정본:**
- `/Users/jji/project/wbs-web/docs/superpowers/specs/2026-08-10-claude-code-work-integration-review.md`
- `/Users/jji/project/wbs-web/docs/superpowers/specs/2026-08-10-claude-code-work-integration-review-appendix.md` (§2.5 · §2.6 · §2.8 · §7.2 · DEV-04)

---

## 확정 전제 — wbs.md 는 은퇴한다

**WBS 의 정본은 D'Flow DB 다.** `wbs.md` 는 **최초 작성·사람 검수·import 부트스트랩 전용**이며, import 이후 개발 실행은 D'Flow DB 를 읽는다(`claim` 시 `dflow.sh` 가 명세를 `docs/tasks/{TSK}/spec.md` 로 캐시). 설계서·분석서 실물은 계속 로컬 git 이다.

이 전제가 이 계획에 미치는 영향은 셋뿐이다:

| | 영향 |
|---|---|
| **명세 필드는 전부 파일이 나른다** | import 가 유일한 이관 통로이므로 `requirements`·`acceptance`·`tech-spec` 등이 wbs.md 에 **빠짐없이·파싱 가능한 문법으로** 찍혀야 한다(Task 3 Step 4). 0073 확장으로 DB 에 자리가 생겼다 — `category`/`domain`/`priority`/`model` text · `tags`/`depends` text[] · `prd_ref`/`entry_point` text · `acceptance` jsonb · `spec` text(마크다운 본문) |
| **ID 불변은 "재import 시"** | 재생성 왕복이 없으므로 규칙의 사정거리가 좁아진다. 그래도 **유지한다** — 초기 import 는 매핑·검증 실패로 여러 번 돌아가고, 그 사이 멱등성이 필요하다 |
| **엑셀은 검수용** | `--export-xlsx` 는 **import 전 사람 검수용**이다. 운영 보고본은 D'Flow export 다 |

바뀌지 않는 것: 생성 규칙·샌드위치 골격·6상태 표기·툴체인 제약 경고. **파일을 만들고 검수하는 동안은 파일 도구가 그대로 쓰인다.**

## Global Constraints

- **편집 대상은 단 하나다** — `/Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md` (238행). 다른 파일을 만들거나 고치지 않는다.
- **플러그인 정본은 불변** — `/Users/jji/.claude/plugins/marketplaces/dev-tools/skills/wbs-wsf/SKILL.md` (684행)과 `/Users/jji/.claude/plugins/cache/dev-tools/dev/1.7.1/**` 는 읽기 전용이다. 스크립트(`wbs-validate.py`·`merge-wbs-status.py`·`dep-analysis.py`) 수정은 DEV-01/DEV-03의 몫이며 이 계획 밖이다.
- **`/Users/jji/project/dev-workflow` 는 git 저장소가 아니다**(`git rev-parse` 실패 실측). 따라서 되돌릴 수단이 커밋이 아니다 — Task 1에서 `SKILL.md.bak` 을 만들고, 각 Task 종료 시 `diff SKILL.md.bak SKILL.md` 로 변경 범위를 눈으로 확인한다. 작업 완료 후에도 `.bak` 을 지우지 않는다.
- **스크립트 경로의 `dev/1.7.1` 버전 핀은 유지한다**(현행 33·34·42·43·166·167행). 이 계획은 그 핀을 따라갈 뿐 갱신하지 않는다 — 캐시에 실재하는 유일한 버전이다(`ls /Users/jji/.claude/plugins/cache/dev-tools/dev/` 실측 결과 `1.7.1` 단독).
- **문서 규칙의 정본은 여전히 `docs/wbs-workflow.md` · `docs/state-machine.json`** 이다(현행 9-13행). 이 계획이 추가하는 규칙은 그 둘과 충돌하지 않는 범위의 *생성 절차*이며, 충돌 시 문서가 이긴다는 문장을 건드리지 않는다.
- **이 계획 문서 자체**는 `wbs-web` 저장소에 있다. 커밋한다면 파일명을 명시해 stage 하고(`git add -A` 금지) 메시지는 한국어로 쓴다.
- 검증 산출물은 전부 `/tmp/wbs-wsf-verify/` 에 만든다. `dev-workflow` 나 `wbs-web` 안에 샘플을 남기지 않는다.

---

## 실측 근거 (변경의 전제 — 전부 이 계획 작성 중 직접 확인)

| 사실 | 근거 파일:행 |
|---|---|
| 4단계 `#### TSK-XX-YY-ZZ` 를 **파서는 읽는다** | `wbs-parse.py:198` — `^#{3,4}\s+(TSK-\d+(?:-\d+)+):` |
| 4단계를 **검증기는 못 읽는다** | `wbs-validate.py:39` — `^###\s+(TSK-\d+-\d+):` (2세그먼트 고정) |
| 4단계를 **머지 드라이버도 못 읽는다** | `merge-wbs-status.py:37` — 동일 정규식 |
| 머지 상태 어휘가 5개뿐이고 미지 상태는 **`[ ]` 보다 낮게** 취급된다 | `merge-wbs-status.py:28-33` `STATUS_PRIORITY` + `:172` `.get(v, -1)` |
| `[as]/[fp]/[ip]` 를 파일에 쓰면 전이가 **거부**된다 | `wbs-transition.py:353` `known_states = {"[ ]","[dd]","[im]","[ts]","[xx]"}` → `"unknown status in wbs.md"` |
| 의존 완료 판정이 `[xx]` 단독이다(문서는 `[im]` 이상) | `dep-analysis.py:388` — `if "[xx]" in status or item.get("bypassed") or category == "feat"` |
| `openpyxl`·`pandas` 없음, `pyyaml 6.0.3` 있음 | `python3 -c "import ..."` 실측 |
| 4단계 wbs.md 실물 관례(모듈 계약 ACT 배치) | `/Users/jji/project/dev-workflow/docs/MES/wbs.md:452-456` |

---

### Task 1: 백업 + 툴체인 제약 경고 통합

**Files:**
- Create: `/Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md.bak` (원본 사본)
- Modify: `/Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md` 39-51행(출력 검증 블록), 111행(dep 충족 기준)

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `.bak` 백업 · 이후 모든 Task가 참조하는 "툴체인 제약" 표 (범위 4의 근거지)

- [ ] **Step 1: 백업 생성**
  ```bash
  cp /Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md \
     /Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md.bak
  wc -l /Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md.bak   # 238 이어야 한다
  ```

- [ ] **Step 2: 출력 검증 절의 제약 블록을 표로 교체 (46-49행)**

  Before:
  ```markdown
  > ⚠️ 알려진 제약 (스킬 연결 보류 항목):
  > - `wbs-validate.py` 는 3단계(`### TSK-`)만 인식 — 4단계 WBS 는 task_count 0 으로 나온다. 4단계면 이 검증 결과를 신뢰하지 말고 구조 검증은 수동으로.
  > - Task ID 파서 정규식은 숫자 ID 만 (`TSK-\d+(-\d+)+`). `TSK-02-01a` 같은 letter suffix 는 **조용히 무시**된다 — 절대 쓰지 않는다.
  > - `dep-analysis.py` 입력은 JSON array 파일 경로 (stdin `/dev/stdin` 불가). `wbs-parse.py --tasks-all` 출력을 파일로 저장 후 전달.
  ```

  After:
  ```markdown
  > ⚠️ **툴체인 제약 — 실측 기준. 검증 결과를 곧이곧대로 믿지 말 것.**
  >
  > | 제약 | 근거 | 생성 시 영향 | 해소 |
  > |---|---|---|---|
  > | `wbs-validate.py` 는 3단계만 인식 | `wbs-validate.py:39` 정규식 `^###\s+(TSK-\d+-\d+):` | **4단계 WBS 는 task_count 0 + `ok:true`** — 통과가 아니라 아무것도 안 본 것 | DEV-03 |
  > | `merge-wbs-status.py` 도 3단계만 인식 | `merge-wbs-status.py:37` 동일 정규식 | 4단계에서 상태 머지가 조용히 무동작 | DEV-03 |
  > | 머지 상태 어휘가 5개 | `merge-wbs-status.py:28-33` + `:172` `.get(v, -1)` | `[as]/[fp]/[ip]` 는 랭크 −1 로 `[ ]`(0)보다도 낮게 취급되어 **조용히 덮인다** | DEV-01 |
  > | 전이 스크립트 상태 어휘가 5개 | `wbs-transition.py:353` `{"[ ]","[dd]","[im]","[ts]","[xx]"}` | 파일에 `[as]` 를 쓰면 `unknown status in wbs.md` 로 **거부** | DEV-01 |
  > | 의존 완료 판정이 `[xx]` 단독 | `dep-analysis.py:388` | 문서 기준(`[im]` 이상)과 어긋나 진행 중 체인을 미완으로 계산 | DEV-01 |
  > | Task ID 정규식은 숫자만 | `wbs-parse.py:198` | `TSK-02-01a` 같은 letter suffix 는 **조용히 무시** — 절대 쓰지 않는다 | — |
  > | `dep-analysis.py` 는 stdin 불가 | 인자가 JSON array 파일 경로 | `wbs-parse.py --tasks-all` 출력을 파일로 저장 후 전달 | — |
  >
  > **4단계(ACT) 를 생성했으면** `wbs-validate.py` 결과를 구조 검증으로 쓰지 않는다. 대신
  > `wbs-parse.py --tasks-all` 로 Task 건수·필드를 직접 확인하고(파서는 `#{3,4}` 를 읽는다),
  > **생성 리포트에 "4단계 — wbs-validate·merge-wbs-status 무력화(DEV-03 대기)" 를 한 줄 출력한다.**
  > 이 경고는 생성 리포트에만 남기고 wbs.md 본문에는 넣지 않는다 — wbs.md 는 작업 정본이지 툴 상태 기록부가 아니다.
  ```

- [ ] **Step 3: dep 충족 기준의 코드-문서 불일치 명시 (111행)**

  Before:
  ```markdown
  - dep 충족 기준 `[im]` 이상 (bypassed 포함). itest 는 bypass·force 금지.
  ```

  After:
  ```markdown
  - dep 충족 기준 `[im]` 이상 (bypassed 포함). itest 는 bypass·force 금지.
    ⚠️ `dep-analysis.py:388` 은 `[xx]` 만 완료로 센다 — **그래프 통계의 완료 판정은 문서 기준보다 좁다.**
    생성 시점엔 전 Task 가 `[ ]` 라 영향이 없지만, 진행 중 WBS 를 재분석할 때 이 차이를 감안한다(DEV-01).
  ```

- [ ] **Step 4: 변경 확인**
  ```bash
  diff /Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md.bak \
       /Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md
  ```
  두 hunk(출력 검증 블록, dep 기준 줄)만 나와야 한다.

---

### Task 2: 플러그인 원본 참조 범위 축소 (6상태 잔여 불일치)

**Files:**
- Modify: `/Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md` 175행(출력 형식 헤딩)

**Interfaces:**
- Consumes: Task 1 (`.bak` 존재)
- Produces: "플러그인에서 가져오는 것 / 가져오지 않는 것" 목록 — Task 3·5가 출력 형식을 확장할 때의 기준선

**배경(이 Task가 존재하는 유일한 이유):** 로컬 오버라이드는 이미 전면 6상태다 — description(3행), `## 상태 — 6개`(105-111행), 생성 규칙(109행), 진척 파생(226행), 성공 기준(238행)이 모두 6상태로 정합한다. **잔여 불일치는 175행 하나뿐이다.** 이 줄이 "필드 전체는 플러그인 원본과 동일"이라며 독자를 684행 정본으로 보내는데, 그쪽에는 5상태 문장(`plugin:491` — `[ ]`/`[dd]`/`[im]`/`[ts]`/`[xx]`)과 옛 category 값(`plugin:494` `infrastructure`, `plugin:536` `development`, `plugin:579` `integration-test`)이 그대로 있다. 로컬은 7종 약어(`dev`/`defect`/`infra`/`feat`/`design`/`research`/`itest`, 95-103행)를 쓴다. 포인터를 좁히는 것으로 끝난다 — 다른 곳을 손대지 않는다.

- [ ] **Step 1: 175행 헤딩과 그 아래 안내문 교체**

  Before:
  ```markdown
  ## 출력 형식 (요약 — 필드 전체는 플러그인 원본과 동일)
  ```

  After:
  ```markdown
  ## 출력 형식 (요약)

  > 플러그인 원본(`~/.claude/plugins/marketplaces/dev-tools/skills/wbs-wsf/SKILL.md`)에서 **가져오는 것만** 가져온다:
  > - `### Task 속성 목록` 표와 리스트 필드 파싱 규칙 (원본 656-669행)
  > - `#### PRD 요구사항` / `#### 기술 스펙 (TRD)` 하위 필드 형식 (원본 549-570행)
  > - `## 의존 그래프` 챕터 형식 — Mermaid·통계표·리뷰 후보 (원본 599-654행)
  >
  > **가져오지 않는 것 (원본이 낡았다):**
  > - **상태 어휘** — 원본 491행은 5상태(`[ ]`/`[dd]`/`[im]`/`[ts]`/`[xx]`)다. 이 스킬은 6상태(105-111행)를 쓴다.
  > - **category 값 이름** — 원본은 `infrastructure`(494행)·`development`(536행)·`integration-test`(579행)를 쓴다. 이 스킬은 7종 약어(95-103행)를 쓴다: `infra`·`dev`·`itest`.
  ```

- [ ] **Step 2: 6상태 전면 재확인 (잔여 누락 탐색)**
  ```bash
  grep -n '\[dd\]\|\[ts\]\|infrastructure\|integration-test' \
    /Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md
  ```
  Step 1이 새로 쓴 "가져오지 않는 것" 블록의 **2줄**(상태 어휘 줄에 `[dd]`·`[ts]`, category 줄에 `infrastructure`·`integration-test`)만 나와야 한다. 그 2줄 밖의 hit가 있으면 해당 줄을 6상태·7종 약어로 고친다. `development` 는 `- category: development` 형태로는 파일에 없으므로 검색어에서 뺐다(오탐 방지).

---

### Task 3: D'Flow 연동 필드 표기 규칙

**Files:**
- Modify: `/Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md` — 105-111행 `## 상태` 절 끝에 신설 절 삽입, 109행 교체, 238행(성공 기준 말미)

**Interfaces:**
- Consumes: Task 2 (출력 형식 기준선 확정)
- Produces: `assignee` 시드 규칙 · ID 불변 규칙 · `prd-ref: program:{ID}` 관례 · `.env` 프로젝트 바인딩 — Task 5가 프로그램 리스트 Task를 찍을 때, Task 6이 리포트를 쓸 때 이 규칙을 따른다

**판단 근거:** 부록 §7.2-1이 export JSON의 `id` 를 곧 `external_ref` 로 규정한다. 즉 **헤딩 ID(TSK/ACT/WP)가 이미 매칭 키다 — wbs.md에 `external_ref` 필드를 새로 만들 필요가 없다.** 대신 ID 안정성이 새 계약 조건이 된다. `assignee` 는 §7.2-3 소유권 표에서 "웹이 정본"이지만 같은 줄이 "신규 항목만 파일 값 시드"를 허용하고 §2.6 매핑이 `assignee`(email)→로스터 매칭을 명시하므로 파일에 남긴다. 실적·진척·`stage` 상향은 넣지 않는다.

- [ ] **Step 1: 109행 교체 — assignee 시드 허용과 status 고정 근거**

  Before:
  ```markdown
  - **WBS 생성 시 모든 Task `status: [ ]`**. assignee `-`.
  ```

  After:
  ```markdown
  - **WBS 생성 시 모든 Task `status: [ ]`** — 담당자를 아는 경우에도 그렇다.
    `[as]` 는 사람의 `assign` 이벤트 결과이고, 파일에 직접 쓰면 `wbs-transition.py:353` 이 `unknown status in wbs.md` 로 거부한다(DEV-01 전).
  - `assignee` 는 **입력이 email 을 줄 때만** 그 값을 쓰고, 그 외에는 `-` 다 (규칙은 아래 `## D'Flow 연동 표기` 절).
  ```

- [ ] **Step 2: `## 상태 — 6개` 절(105-111행) 바로 뒤에 신설 절 삽입** (바깥 펜스는 4-backtick — 안에 3-backtick 블록이 있다)
  ````markdown
  ## D'Flow 연동 표기 (정본: 부록 §2.5·§2.6·§7.2)

  생성물이 `POST /api/v1/wbs/import` 로 올라갈 수 있다는 전제에서, wbs.md 표면에 **넣는 것과 넣지 않는 것**이 정해져 있다.

  ### 넣는 것

  | 항목 | 계층 | 문법 | 규칙 |
  |---|---|---|---|
  | 담당자 | Task | `- assignee: {email}` | 입력 값이 `@` 를 포함하면 그대로 시드. 아니면 `- assignee: -` 로 두고 **생성 리포트의 "담당 미매칭" 표에 원문과 함께 전량 나열**한다(생략 금지). |
  | 모듈 담당자 | WP / ACT | `- assignee: {email}` | 입력에 모듈 담당 컬럼이 있을 때만. ⚠️ DEV-02(`wbs-parse.py --export`) 전까지 **어떤 스크립트도 WP/ACT 필드를 읽지 않는다** — 기록만 되고 업로드되지 않는다. |
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
    - **분산 다인** — **서버**(D'Flow). 남의 PC 파일은 볼 수 없으므로 state.json 도 답이 아니다. 미결 7 참조.

    어느 쪽이든 **이 스킬의 범위가 아니다.** 분산 추적에 대한 `/wbs-wsf` 의 기여는 다른 둘이다 — **안정적 ID**(서버 추적이 한 항목에 누적되려면 `external_ref` 가 안 바뀌어야 한다)와 **`assignee` 시드**(자동 발행 → 주문 → claim → 서버 추적의 진입점). 둘 다 이 계획에 이미 있다.

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
  ````

- [ ] **Step 3b: `## 출력 형식` 절에 명세 블록 파싱 계약 삽입** (Task 2 Step 1이 만든 안내문 뒤)

  wbs.md 가 은퇴하므로 **import 가 명세를 나르는 유일한 통로**다. 파서가 놓치면 그 필드는 영원히 사라진다. 아래 넷은 `wbs-parse.py` 실측에서 나온 하드 제약이다.

  ````markdown
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
  ````

- [ ] **Step 3: 성공 기준(현재 228-238행)에 ID 불변 항목 추가**

  Before:
  ```markdown
  - 모든 Task `status: [ ]`, ID 숫자만
  ```

  After:
  ```markdown
  - 모든 Task `status: [ ]`, ID 숫자만
  - **재생성 시 기존 Task/WP/ACT ID 가 보존됨** — ID 는 D'Flow `external_ref` 매칭 키다 (`## D'Flow 연동 표기`)
  ```

---

### Task 4: 프로그램 리스트 입력 어댑터 — 인자·스키마·정규화 (DEV-04 전반)

**Files:**
- Modify: `/Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md` 15-24행(인자 파싱), 26-28행(입력 파일) — 뒤에 신설 절 삽입

**Interfaces:**
- Consumes: Task 3 (`assignee`·`prd-ref` 규칙)
- Produces: 공통 스키마 레코드 배열(`module`·`program_id`·`program_name`·`group`·`type`·`difficulty`·`owner`·`route`·`depends`·`priority`·`note`) — Task 5의 입력

- [ ] **Step 1: 24행 플래그 줄에 `--programs` 추가**

  Before:
  ```markdown
  플래그: `--scale large|medium` (규모 강제), `--start-date YYYY-MM-DD`, `--estimate-only` (산정만).
  ```

  After:
  ```markdown
  플래그: `--scale large|medium` (규모 강제), `--start-date YYYY-MM-DD`, `--estimate-only` (산정만),
  `--programs {경로}` (프로그램 리스트 입력 모드 — `.json` / `.yaml` / `.yml` / `.csv` / `.md` / `.xlsx`).
  ```

- [ ] **Step 2: 26-28행 입력 파일 절 교체 — 모드 두 개를 명시**

  Before:
  ```markdown
  ## 입력 파일

  - `{DOCS_DIR}/PRD.md`, `{DOCS_DIR}/TRD.md` — 둘 다 없으면 에러 후 중단.
  ```

  After:
  ```markdown
  ## 입력 파일 — 모드 두 개

  | 모드 | 조건 | 입력 |
  |---|---|---|
  | **PRD 모드** (기본) | `--programs` 없음 | `{DOCS_DIR}/PRD.md`, `{DOCS_DIR}/TRD.md` — 둘 다 없으면 에러 후 중단 |
  | **프로그램 리스트 모드** | `--programs {경로}` 있음 | 그 파일. PRD/TRD 는 **선택** — 있으면 함께 읽어 requirements·tech-spec 을 보강하고, 없어도 중단하지 않는다 |

  프로그램 리스트 모드의 상세는 `## 프로그램 리스트 입력 어댑터` 절.
  ```

- [ ] **Step 3: `## Task 분해 원칙` 절(현행 128-133행) 앞에 어댑터 절 삽입 — 스키마·별칭·검증** (바깥 펜스는 4-backtick — 안에 python 블록이 있다)
  ````markdown
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
  - `owner` 가 email 이 아님 → 원문과 함께 나열 (`assignee: -` 로 생성됨)
  - `depends` 가 존재하지 않는 `program_id` 를 가리킴 → 나열 후 그 의존만 버린다
  - `route` 미기재로 파생값을 쓴 목록
  ````

---

### Task 5: 프로그램 리스트 → WBS 생성 규칙

**Files:**
- Modify: `/Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md` — Task 4가 삽입한 `## 프로그램 리스트 입력 어댑터` 절 끝에 이어 붙임, 128-133행(Task 분해 원칙), 135-146행(일정 계산), 148-151행(Dev Config)

**Interfaces:**
- Consumes: Task 4 (공통 스키마 레코드) · Task 3 (`assignee`·`prd-ref`)
- Produces: 계층 배치·매핑표·수직 슬라이스 강제 — Task 6의 실행 플로우가 호출하는 규칙

- [ ] **Step 1: 어댑터 절 끝에 "생성 규칙" 이어 붙이기**
  ```markdown
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

  ⚠️ **이 기간표는 위 `## 일정 계산` 의 category 표(dev 기본 10일, 5~15)를 대신한다.** 그 표는 PRD 유래 기능 Task(여러 프로그램을 아우르는 단위) 기준이고, 프로그램 1개 = 수직 슬라이스에는 `## Task 분해 원칙` 의 크기 규칙(**권장 1~3일 / 최대 1주**)이 우선한다. 추정은 시드값이라 비고·화면 수로 올릴 수 있으나, **1주(5영업일)를 넘기면 기간을 늘리지 말고 프로그램을 분할한다.** 선행/후행 공정 Task 는 종전대로 `## 일정 계산` 표를 쓴다.

  Task 필드 생성값:

  - `status: [ ]` · `priority: {priority 또는 high}` · `assignee: {owner 가 email 이면 그 값, 아니면 -}`
  - `tags: {module}, {type 영문 슬러그}` — 화면 `ui` · 리포트 `report` · 배치 `batch` · 인터페이스 `interface`
  - `prd-ref: program:{program_id}` (필수)
  - `note:` 는 입력 `note` 가 있을 때만
  - `requirements` / `acceptance` — 프로그램명·유형에서 유도하고, PRD/TRD 가 함께 주어졌으면 해당 절을 인용해 보강한다

  ### 생성 규칙 — WSF 샌드위치 골격 (PRD/TRD 없이도 동일 생성)

  프로그램 리스트에는 TRD 가 없으므로 `## 실행 플로우` 4단계의 **공유 계약 4종 스캔이 성립하지 않는다.** 그 자리를 아래 고정 골격이 대신한다.

  **골격과 depends 사슬은 고정이다** (형태 근거: `docs/MES/wbs.md:58-120, 158-200, 456-495` 실측 — 그 파일의 depends 를 그대로 일반화했다). 3단계면 아래 ID 에서 마지막 세그먼트를 하나 뺀다.

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
  ```

- [ ] **Step 2: `## Task 분해 원칙`(현행 128-133행) 첫 bullet 에 프로그램 모드 연결**

  Before:
  ```markdown
  - UI 있는 기능 = 화면+API+전용 DB 를 **하나의 `fullstack` Task** (layer 수평 분할 금지, 큰 화면은 수직 분할). `entry-point` 필수.
  ```

  After:
  ```markdown
  - UI 있는 기능 = 화면+API+전용 DB 를 **하나의 `fullstack` Task** (layer 수평 분할 금지, 큰 화면은 수직 분할). `entry-point` 필수.
    프로그램 리스트 모드에서는 이 원칙이 **프로그램 1개 = Task 1개**로 구체화된다 (`## 프로그램 리스트 입력 어댑터`).
  ```

- [ ] **Step 3: `## 일정 계산`(현행 135-146행) 표 아래에 적용 범위 한 줄 추가**

  Before:
  ```markdown
  depends 기반 시작/종료일 산출. 산출 후 FS+겹침 검증식 통과 확인.
  ```

  After:
  ```markdown
  depends 기반 시작/종료일 산출. 산출 후 FS+겹침 검증식 통과 확인.

  ⚠️ 위 표는 **PRD 유래 기능 Task** 기준이다. 프로그램 리스트 모드의 기능 Task 는 난이도 기반 기간표(하 2 / 중 3 / 상 5 영업일)를 쓴다 — 근거는 `## 프로그램 리스트 입력 어댑터`. 선행·후행 공정 Task 는 모드와 무관하게 이 표를 쓴다.
  ```

- [ ] **Step 4: `## Dev Config`(현행 148-151행) — TRD 없는 경로 보강**

  `wbs-parse.py - --dev-config` 와 `wbs-validate.py` 가 이 블록을 요구하는데, 현행 문장은 "TRD 로 채운다"뿐이라 프로그램 리스트 모드에서 채울 근거가 사라진다.

  Before:
  ```markdown
  `# WBS` 메타 블록 아래 `---` 직후, 첫 `## WP-` 앞에 정확히 한 번.
  골격은 플러그인 템플릿 참조: `~/.claude/plugins/cache/dev-tools/dev/1.7.1/skills/wbs/references/dev-config-template.md` 를 Read 후 TRD 로 채운다.
  ```

  After:
  ```markdown
  `# WBS` 메타 블록 아래 `---` 직후, 첫 `## WP-` 앞에 정확히 한 번.
  골격은 플러그인 템플릿 참조: `~/.claude/plugins/cache/dev-tools/dev/1.7.1/skills/wbs/references/dev-config-template.md` 를 Read 후 채운다. (경로 실재 확인됨)

  - **PRD 모드**: TRD 로 채운다.
  - **프로그램 리스트 모드**: TRD 가 없어도 **템플릿 골격을 반드시 생성한다** — 이 블록이 없으면 `wbs-parse.py --dev-config` 와 `wbs-validate.py` 가 돌지 않는다.
    - `Domains` 표의 행은 **실제 생성된 Task 의 domain 집합만** 남긴다 (`fullstack`·`backend` + 공정 Task 의 `database`·`infra`·`test`).
    - `Quality Commands`·`Design Guidance` 는 템플릿 기본값을 그대로 두고, PRD/TRD 가 함께 주어졌으면 그 내용으로 덮는다.
    - 추측으로 명령어를 지어내지 않는다 — 모르는 칸은 템플릿 기본값이 정답이다.
  ```

- [ ] **Step 5: `## 전체 구조`(현행 68행) — 통합테스트 조건에 모드 예외 명시**

  Step 1이 "모듈 수와 무관하게 항상 생성"을 도입했으므로, 조건부 규칙을 그대로 두면 단일 모듈 입력에서 두 규칙이 충돌한다.

  Before:
  ```markdown
  - 소규모면 WP-01 생략 가능 (WP-00 이 흡수). 기능 WP 2개 이상이면 통합테스트 WP 필수.
  ```

  After:
  ```markdown
  - 소규모면 WP-01 생략 가능 (WP-00 이 흡수). 기능 WP 2개 이상이면 통합테스트 WP 필수.
    **프로그램 리스트 모드는 예외 — 기능 WP 가 1개여도 통합테스트 WP 를 생성한다**(`## 프로그램 리스트 입력 어댑터`).
  ```

---

### Task 6: 실행 플로우 모드 분기 + 성공 기준

**Files:**
- Modify: `/Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md` — `## 실행 플로우` 절(현행 153-173행), `## 성공 기준` 절(현행 228-238행), frontmatter description(3행)

**Interfaces:**
- Consumes: Task 4·5 (어댑터·생성 규칙)
- Produces: 실행 가능한 절차 — Task 7·8의 검증이 이 절차를 따라 실행된다

- [ ] **Step 1: 실행 플로우 3·4단계를 모드 분기로 교체**

  Before:
  ```markdown
  3. PRD/TRD 분석, 규모 산정 (`--estimate-only` 면 여기서 종료).
  4. 공유 계약 사전 분석 (4종 스캔) → 계약 전용 Task 목록 확정.
  ```

  After:
  ```markdown
  3. 입력 분석·규모 산정 (`--estimate-only` 면 여기서 종료).
     - PRD 모드: PRD/TRD 분석 → 기존 규모 판별 4기준.
     - 프로그램 리스트 모드: `--programs` 파일 로드 → 정규화 → **검증(중단 조건 먼저)** → 프로그램 수·모듈 수·`group` 유무로 규모 판정. PRD/TRD 가 있으면 함께 읽어 컨텍스트로만 쓴다.
  4. 계약 Task 목록 확정.
     - PRD 모드: 공유 계약 사전 분석 (TRD 4종 스캔).
     - 프로그램 리스트 모드: 고정 골격 — 전사 계약 1개 + (모듈 ≥ 2 면) 모듈당 계약 1개. TRD 가 없으므로 4종 스캔은 실행하지 않는다.
  ```

- [ ] **Step 2: 실행 플로우 10번(의존 그래프 검증) 뒤, 11번(출력 검증) 앞에 리포트 단계 삽입**

  **삽입만 한다 — 번호 다시 매기기는 Step 3이 한꺼번에 처리한다.** 현행 10번(의존 그래프 검증) 블록 바로 뒤, 현행 11번(출력 검증) 줄 바로 앞에 아래를 넣는다.

  ```markdown
  11. (프로그램 리스트 모드) **`## 입력 매핑 리포트` 챕터 작성** — `## 의존 그래프` 챕터 **앞**에 배치.
      유형 미매핑 · 난이도 미매핑 · 담당 미매칭 · depends 미해결 · route 파생, 다섯 표를 전부 쓴다.
      해당 없는 표는 "해당 없음"이라고 명시한다 — 비워두지 않는다.
  ```

  삽입 직후에는 `11.` 이 두 개, `12.` 가 하나인 상태다. Step 3에서 정리된다.

- [ ] **Step 3: 출력 검증 단계를 4단계 대응으로 교체하면서 뒤 번호를 민다**

  Before (Step 2 삽입 후 파일에 남아 있는 원래 11·12번 두 줄):
  ```markdown
  11. 출력 검증 (wbs-validate — 4단계면 제약 유의).
  12. **phases 블록 정의**: `docs/state-machine.json` 의 `phases.{SUBPROJECT}` 에 서브프로젝트별로 추가.
  ```

  After:
  ```markdown
  12. 출력 검증.
      - 3단계: `wbs-validate.py` 실행.
      - **4단계: `wbs-validate.py` 결과를 구조 검증으로 쓰지 않는다**(task_count 0 + `ok:true`). 대신
        `wbs-parse.py --tasks-all` 로 Task 건수·`category`·`domain`·`entry-point` 를 직접 확인하고,
        생성 리포트에 "4단계 — wbs-validate·merge-wbs-status 무력화(DEV-03 대기)" 를 출력한다.
  13. **phases 블록 정의**: `docs/state-machine.json` 의 `phases.{SUBPROJECT}` 에 서브프로젝트별로 추가.
  ```

  (원래 12번의 나머지 3줄 — 게이트 설명 — 은 그대로 둔다.) 교체 후 `grep -n '^[0-9]*\. ' SKILL.md` 로 1~13이 중복·결번 없이 나오는지 확인한다.

- [ ] **Step 4: 성공 기준의 통합테스트 항목(현행 236행)에 모드 예외 반영**

  Before:
  ```markdown
  - 기능 WP 2+ 면 마지막 WP = 통합테스트, depends 는 기능 체인 말단
  ```

  After:
  ```markdown
  - 기능 WP 2+ 면 마지막 WP = 통합테스트, depends 는 기능 체인 말단 (프로그램 리스트 모드는 기능 WP 1개여도 필수)
  ```

- [ ] **Step 5: 성공 기준에 프로그램 리스트 모드 항목 추가** — `## 성공 기준` 목록 끝(Task 3 Step 3이 추가한 ID 불변 줄 뒤)에 붙인다
  ```markdown

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
  ```

- [ ] **Step 6: frontmatter description(3행)에 프로그램 리스트 모드 노출** — 스킬 트리거 문구가 곧 발견성이다

  Before:
  ```
  description: PRD/TRD 기반 WBS 를 Water-Scrum-Fall 샌드위치 구조로 생성한다 (로컬 6상태 워크플로우 버전). 선행 공정(초기화·기본설계) → 애자일 기능 Task → 후행 통합테스트. category 7종(dev/defect/infra/feat/design/research/itest), 상태 6개([ ]/[as]/[fp]/[ip]/[im]/[xx]). 사용법 /wbs-wsf [SUBPROJECT | /absolute/path/to/wbs.md] [--scale large|medium] [--start-date YYYY-MM-DD] [--estimate-only]
  ```

  After:
  ```
  description: PRD/TRD 또는 프로그램 리스트(json/yaml/csv/md/xlsx)로 WBS 를 Water-Scrum-Fall 샌드위치 구조로 생성한다 (로컬 6상태 워크플로우 버전). 선행 공정(초기화·기본설계) → 애자일 기능 Task → 후행 통합테스트. 프로그램 1개 = fullstack Task 1개(수직 슬라이스). category 7종(dev/defect/infra/feat/design/research/itest), 상태 6개([ ]/[as]/[fp]/[ip]/[im]/[xx]). 사용법 /wbs-wsf [SUBPROJECT | /absolute/path/to/wbs.md] [--programs 경로] [--scale large|medium] [--start-date YYYY-MM-DD] [--estimate-only]
  ```

- [ ] **Step 7: 전체 diff 확인**
  ```bash
  diff /Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md.bak \
       /Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md | head -200
  wc -l /Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md
  grep -c '^## ' /Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md   # 원본 17 → 19 (D'Flow 연동 표기 + 프로그램 리스트 입력 어댑터)
  ```
  Task 1~6의 편집만 나타나야 한다. 절 수가 줄었다면 기존 절을 실수로 덮어쓴 것이다.

---

### Task 7: 검증 A — 3단계(CSV, 단일 모듈)

**Files:**
- Create: `/tmp/wbs-wsf-verify/a/programs.csv` · `/tmp/wbs-wsf-verify/a/docs/wbs.md` (스킬이 생성)
- Modify: 없음

**Interfaces:**
- Consumes: Task 6 (완성된 SKILL.md)
- Produces: 3단계 경로가 동작한다는 증거 — `wbs-validate.py` 가 실제로 도는 유일한 경로

- [ ] **Step 1: 샘플 입력 작성** — `/tmp/wbs-wsf-verify/a/programs.csv`
  ```csv
  모듈,프로그램ID,프로그램명,유형,난이도,담당,화면경로
  c10,C10-SCR-011,품질설계의뢰 등록,화면,중,lee@example.com,/c10/design-requests/new
  c10,C10-SCR-014,품질설계의뢰현황 조회,화면,하,,
  c10,C10-BAT-003,생산가부 자동판정 배치,배치,상,,
  c10,C10-IFC-007,주문수신 EAI 인터페이스,인터페이스,상,장종익,
  ```

  (C10-SCR-014 의 화면경로를 일부러 비웠다 — route 파생 규칙을 실제로 태우기 위해서다. backend 유형은 `entry-point` 자체가 `-` 라 파생 경로를 타지 않는다.)

- [ ] **Step 2: 스킬 절차대로 생성** — `DOCS_DIR=/tmp/wbs-wsf-verify/a/docs`, `--programs /tmp/wbs-wsf-verify/a/programs.csv`, `--start-date 2026-08-17`

- [ ] **Step 3: 구조·depends 기대치 대조** — 모듈 1개 · `group` 없음 · 프로그램 4개 → **3단계**

  | ID | 제목 | category | depends |
  |---|---|---|---|
  | TSK-00-01 | 스캐폴드 + DB 연결 + CI | `infra` | `-` |
  | TSK-00-02 | 전사 공유 계약 (계약 전용) | `infra` | `TSK-01-01` |
  | TSK-00-03 | 권한 가드 + 공통 레이아웃 셸 | `infra` | `TSK-00-02` |
  | TSK-01-01 | 전사 아키텍처·공통 계약 설계 | `design` | `TSK-00-01` |
  | TSK-01-02 | c10 DB(ERD) 설계 | `design` | `TSK-01-01` |
  | TSK-02-01 | c10 공유 계약 (계약 전용) | `infra` | `TSK-01-02, TSK-00-02` |
  | TSK-02-02 | 품질설계의뢰 등록 | `dev` | `TSK-02-01, TSK-00-03` |
  | TSK-02-03 | 품질설계의뢰현황 조회 | `dev` | `TSK-02-01, TSK-00-03` |
  | TSK-02-04 | 생산가부 자동판정 배치 | `dev` | `TSK-02-01` |
  | TSK-02-05 | 주문수신 EAI 인터페이스 | `dev` | `TSK-02-01` |
  | TSK-03-01 | c10 통합 시나리오 | `itest` | `TSK-02-02, TSK-02-03, TSK-02-04, TSK-02-05` |

  - **총 11 Task** · 기능 Task 4개(프로그램과 1:1)
  - 권한 가드·셸 Task 는 화면 2건이 있으므로 생성된다
  - 모듈 관통 시나리오 Task 는 모듈이 1개라 생성되지 않는다
  - 최장 경로 = `TSK-00-01 → TSK-01-01 → TSK-00-02 → TSK-00-03 → TSK-02-02 → TSK-03-01` = **6노드**

- [ ] **Step 4: Task 필드 대조 (기능 4건)**

  | 프로그램 | Task 필드 기대값 |
  |---|---|
  | C10-SCR-011 | `category: dev` · `domain: fullstack` · `model: sonnet` · 3영업일 · `assignee: lee@example.com` · `entry-point: /c10/design-requests/new (메뉴: c10 > 품질설계의뢰 등록)` · `tags: c10, ui` |
  | C10-SCR-014 | `domain: fullstack` · `model: sonnet` · 2영업일 · `assignee: -` · **`entry-point: /c10/c10-scr-014 (메뉴: c10 > 품질설계의뢰현황 조회)`** (화면경로 공란 → 파생) · `tags: c10, ui` |
  | C10-BAT-003 | `domain: backend` · `model: opus` · 5영업일 · `entry-point: -` · `tags: c10, batch` |
  | C10-IFC-007 | `domain: backend` · `model: opus` · 5영업일 · `entry-point: -` · **`assignee: -`** (담당 "장종익"은 email 이 아니다) · `tags: c10, interface` |

  전 Task `status: [ ]` · `prd-ref: program:{ID}`.

- [ ] **Step 5: 리포트 대조** — `## 입력 매핑 리포트` 의 다섯 표 기대값
  - 담당 미매칭: **1건** — `C10-IFC-007` / 원문 `장종익`
  - route 파생: **1건** — `C10-SCR-014` (backend 유형은 `entry-point` 가 `-` 라 파생 대상이 아니다)
  - 유형 미매핑 · 난이도 미매핑 · depends 미해결: **해당 없음** (비워두지 않고 그렇게 적혀 있어야 한다)

- [ ] **Step 6: 파서·검증기 실행**
  ```bash
  P=/Users/jji/.claude/plugins/cache/dev-tools/dev/1.7.1/scripts
  python3 $P/wbs-parse.py /tmp/wbs-wsf-verify/a/docs/wbs.md --tasks-all > /tmp/wbs-wsf-verify/a/tasks.json
  python3 -c "import json;d=json.load(open('/tmp/wbs-wsf-verify/a/tasks.json'));print(len(d));print([t['tsk_id'] for t in d])"
  python3 $P/wbs-parse.py /tmp/wbs-wsf-verify/a/docs/wbs.md - --dev-config > /tmp/wbs-wsf-verify/a/dev-config.json
  python3 $P/wbs-validate.py validate --wbs /tmp/wbs-wsf-verify/a/docs/wbs.md --dev-config-json "$(cat /tmp/wbs-wsf-verify/a/dev-config.json)"
  python3 $P/dep-analysis.py /tmp/wbs-wsf-verify/a/tasks.json --graph-stats
  ```
  - `--tasks-all` 이 **11건**을 내야 하고, `tsk_id` 집합이 Step 3 표와 정확히 일치해야 한다.
  - **3단계이므로 `wbs-validate.py` 의 task_count 도 11이어야 한다** — 0이면 헤딩 레벨(`###`)이 틀린 것이다.
  - `--graph-stats` 의 `max_chain_depth` 를 Step 3의 최장 경로(6노드 / 5간선)와 대조한다. 출력이 노드 수 기준이면 6, 간선 수 기준이면 5다. **그 둘 중 하나가 아니면 depends 가 규칙대로 안 걸린 것이다.**
  - 임계값(3) 초과분은 전부 공정 양끝에서 온 것이므로, `## 의존 그래프` 챕터에 그 근거와 "모듈 계약 Task fan-in 은 구조적이라 계약 추출 후보에서 제외" 문장이 있는지 확인한다.
  - fan-in 상위는 `TSK-02-01`(c10 모듈 계약, 4) 과 `TSK-03-01`(itest, 4) 이어야 한다.

- [ ] **Step 7: 실패 처리** — 기대와 다르면 SKILL.md 의 해당 규칙 문장을 고치고 Step 2부터 다시 돈다. wbs.md 를 손으로 고쳐 통과시키지 않는다(스킬을 검증하는 것이지 산출물을 만드는 것이 아니다).

---

### Task 8: 검증 B — 4단계(XLSX, 3개 모듈)

**Files:**
- Create: `/tmp/wbs-wsf-verify/b/mkxlsx.py` · `/tmp/wbs-wsf-verify/b/programs.xlsx` · `/tmp/wbs-wsf-verify/b/docs/wbs.md` (스킬이 생성)
- Modify: 없음

**Interfaces:**
- Consumes: Task 6 (완성된 SKILL.md) · Task 7 (3단계 경로 통과)
- Produces: xlsx 리더·4단계 배치·툴체인 제약 경고가 실제로 동작한다는 증거

- [ ] **Step 1: xlsx 픽스처 생성기 작성** — `/tmp/wbs-wsf-verify/b/mkxlsx.py` (표준 라이브러리만. 이 스니펫은 작성 중 실행 검증됨)
  ```python
  import zipfile
  rows = [["모듈", "프로그램ID", "프로그램명", "업무그룹", "유형", "난이도", "담당"],
          ["c10", "C10-SCR-011", "품질설계의뢰 등록", "PG-01", "화면", "중", "lee@example.com"],
          ["c10", "C10-SCR-014", "품질설계의뢰현황 조회", "PG-01", "화면", "하", ""],
          ["m30", "M30-SCR-021", "부재료 입고등재", "PG-03", "화면", "중", ""],
          ["m30", "M30-BAT-002", "부재료 재고 일마감 배치", "PG-03", "배치", "상", ""],
          ["m60", "M60-IFC-005", "출하지시 수신 인터페이스", "PG-01", "인터페이스", "상", ""]]
  ss, idx, cells = [], {}, []
  def sid(v):
      if v not in idx:
          idx[v] = len(ss); ss.append(v)
      return idx[v]
  for r, row in enumerate(rows, 1):
      cs = [f'<c r="{chr(ord("A") + c)}{r}" t="s"><v>{sid(str(v))}</v></c>' for c, v in enumerate(row)]
      cells.append(f'<row r="{r}">{"".join(cs)}</row>')
  M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  z = zipfile.ZipFile("/tmp/wbs-wsf-verify/b/programs.xlsx", "w")
  z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>')
  z.writestr("_rels/.rels", f'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{R}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  z.writestr("xl/workbook.xml", f'<?xml version="1.0"?><workbook xmlns="{M}" xmlns:r="{R}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')
  z.writestr("xl/_rels/workbook.xml.rels", f'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="{R}/sharedStrings" Target="sharedStrings.xml"/></Relationships>')
  z.writestr("xl/worksheets/sheet1.xml", f'<?xml version="1.0"?><worksheet xmlns="{M}"><sheetData>{"".join(cells)}</sheetData></worksheet>')
  z.writestr("xl/sharedStrings.xml", '<?xml version="1.0"?><sst xmlns="%s" count="%d" uniqueCount="%d">%s</sst>' % (M, len(ss), len(ss), "".join("<si><t>%s</t></si>" % s for s in ss)))
  z.close()
  print("written")
  ```
  ```bash
  mkdir -p /tmp/wbs-wsf-verify/b/docs && python3 /tmp/wbs-wsf-verify/b/mkxlsx.py
  ```

- [ ] **Step 2: 어댑터의 xlsx 리더 단독 확인** — SKILL.md `## 프로그램 리스트 입력 어댑터` 의 표준 라이브러리 스니펫을 그대로 파일로 옮겨 실행한다. 출력이 **5건**이고 한글 헤더(`모듈`·`프로그램ID`·`업무그룹` 등)가 그대로 나오는지 본다. 여기서 실패하면 스니펫이 잘못 옮겨진 것이다.

- [ ] **Step 3: 스킬 절차대로 생성** — `DOCS_DIR=/tmp/wbs-wsf-verify/b/docs`, `--programs /tmp/wbs-wsf-verify/b/programs.xlsx`, `--start-date 2026-08-17`

- [ ] **Step 4: 규모·계층 대조** — 모듈 3개 + `업무그룹` 컬럼 존재 → **4단계** (조건 "모듈 ≥ 2 且 group 존재")
  - `## WP-00` / `### ACT-00-01` — 3 Task (`#### TSK-00-01-01` ~ `-03`)
  - `## WP-01` — `ACT-01-01` 전사 설계 1 + `ACT-01-02/03/04` 모듈별 DB(ERD) 설계 3 = **4 Task**
  - `## WP-02: c10` — `ACT-02-01` 모듈 계약 1 + `ACT-02-02: PG-01` 기능 2 = **3 Task**
  - `## WP-03: m30` — `ACT-03-01` 계약 1 + `ACT-03-02: PG-03` 기능 2 = **3 Task**
  - `## WP-04: m60` — `ACT-04-01` 계약 1 + `ACT-04-02: PG-01` 기능 1 = **2 Task**
  - `## WP-05` 통합테스트 — `ACT-05-01`: 모듈별 3 + 관통 1 = **4 Task**
  - **총 19 Task · 기능 Task 5개(프로그램과 1:1)**

- [ ] **Step 5: 툴체인 제약 재현 확인**
  ```bash
  P=/Users/jji/.claude/plugins/cache/dev-tools/dev/1.7.1/scripts
  python3 $P/wbs-parse.py /tmp/wbs-wsf-verify/b/docs/wbs.md --tasks-all > /tmp/wbs-wsf-verify/b/tasks.json
  python3 -c "
  import json; d=json.load(open('/tmp/wbs-wsf-verify/b/tasks.json'))
  print('tasks', len(d))
  print('fullstack/backend', sum(1 for t in d if t.get('domain') in ('fullstack','backend')))
  print(sorted(t['tsk_id'] for t in d))"
  python3 $P/wbs-parse.py /tmp/wbs-wsf-verify/b/docs/wbs.md - --dev-config > /tmp/wbs-wsf-verify/b/dev-config.json
  python3 $P/wbs-validate.py validate --wbs /tmp/wbs-wsf-verify/b/docs/wbs.md --dev-config-json "$(cat /tmp/wbs-wsf-verify/b/dev-config.json)"
  ```
  - `--tasks-all` 이 **19건**을 내야 한다 (`wbs-parse.py:198` 이 `#{3,4}` 를 읽으므로 4단계도 파싱된다).
  - `wbs-validate.py` 는 **task_count 0 · `ok:true`** 를 내야 한다 — **이것이 정상이며, DEV-03 제약의 재현이다.** 이 결과를 통과로 읽지 않는다.
  - 생성 리포트에 "4단계 — wbs-validate·merge-wbs-status 무력화(DEV-03 대기)" 경고 한 줄이 있어야 한다(Task 1 Step 2 · Task 6 Step 3).

- [ ] **Step 6: 6상태·연동 필드 최종 확인**
  ```bash
  grep -n 'status:' /tmp/wbs-wsf-verify/b/docs/wbs.md | grep -v 'status: \[ \]'   # 0건이어야 한다
  grep -c 'prd-ref: program:' /tmp/wbs-wsf-verify/b/docs/wbs.md                   # 5 (기능 Task 수)
  grep -n 'assignee:' /tmp/wbs-wsf-verify/b/docs/wbs.md | grep -v 'assignee: -' | grep -v '@'   # 0건
  grep -n '입력 매핑 리포트\|## 의존 그래프' /tmp/wbs-wsf-verify/b/docs/wbs.md    # 리포트가 의존 그래프보다 앞
  grep -in 'DFLOW_\|project_id\|project-id' /tmp/wbs-wsf-verify/b/docs/wbs.md    # 0건 — 프로젝트 바인딩은 .env 몫
  ```

- [ ] **Step 6c: 명세 블록이 export 로 실제로 빠져나오는지 확인 (4단계에서 가장 비싼 조용한 실패)**
  ```bash
  P=/Users/jji/.claude/plugins/cache/dev-tools/dev/1.7.1/scripts
  # 규칙 1 — 4단계이므로 명세 블록 헤딩은 반드시 #####
  grep -n '^#### \(PRD 요구사항\|기술 스펙\)' /tmp/wbs-wsf-verify/b/docs/wbs.md   # 0건이어야 한다
  grep -c '^##### PRD 요구사항' /tmp/wbs-wsf-verify/b/docs/wbs.md                 # 기능 Task 수와 같아야 한다
  # 규칙 2·3 — 필드가 파서 경계를 실제로 통과하는가
  python3 $P/wbs-parse.py /tmp/wbs-wsf-verify/b/docs/wbs.md TSK-02-02-01 --json \
    | python3 -c "
  import json,sys; d=json.load(sys.stdin)
  for k in ('prd_ref','requirements','acceptance','category','domain','model','entry_point','tags'):
      v=d.get(k); print(k, '=', repr(v), '<<< 비었음' if v in ('', [], None) else '')"
  ```
  **`requirements`·`acceptance` 가 빈 리스트로 나오면 규칙 1 위반**(블록이 명세 앞에서 잘렸다)이 첫 번째 의심이다 — 헤딩 레벨부터 본다. 개별 필드만 비었으면 규칙 2(열 0) 또는 3(2칸 들여쓰기) 위반이다.

- [ ] **Step 6b: `.env` 바인딩 리포트 확인**
  - `/tmp/wbs-wsf-verify/b/` 에 `.env` 가 없는 상태이므로, 생성 리포트에 `업로드 불가 — .env 에 DFLOW_PROJECT_ID 또는 DFLOW_PROJECT_MAP 필요` 한 줄이 있어야 한다.
  - 리포트 어디에도 PAT·URL·UUID **값**이 찍히지 않아야 한다("설정됨/없음"만).

- [ ] **Step 7: ID 불변 규칙 확인 (재생성)**
  - `mkxlsx.py` 의 `rows` 리스트 끝에 `["m30", "M30-SCR-025", "부재료 반출등재", "PG-03", "화면", "중", ""]` 를 추가하고 다시 실행해 `programs.xlsx` 를 덮어쓴다.
  - 같은 `DOCS_DIR`(`/tmp/wbs-wsf-verify/b/docs`, 기존 `wbs.md` 를 지우지 않은 채)로 재생성한다.
  - **기존 5개 기능 Task 의 ID 가 하나도 바뀌지 않아야 하고**, 신규 Task 는 `TSK-03-02-03`(m30 PG-03 ACT 의 다음 번호)여야 한다. 하나라도 바뀌면 `## D'Flow 연동 표기` 의 ID 불변 규칙이 절차에 반영되지 않은 것이므로 SKILL.md 를 고치고 다시 돈다.

- [ ] **Step 8: 최종 diff 보존**
  ```bash
  diff /Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md.bak \
       /Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md > /tmp/wbs-wsf-verify/SKILL.diff
  wc -l /tmp/wbs-wsf-verify/SKILL.diff
  ```
  `.bak` 은 지우지 않는다(이 저장소에 git 이 없다).

---

### Task 9: WBS 엑셀 export (`--export-xlsx`)

**Files:**
- Modify: `/Users/jji/project/dev-workflow/.claude/skills/wbs-wsf/SKILL.md` — Task 4 Step 1이 고친 플래그 줄, `## 실행 플로우` 말미, `## 프로그램 리스트 입력 어댑터` 뒤에 신설 절

**Interfaces:**
- Consumes: Task 6 (실행 플로우 확정) · Task 3 (D'Flow 필드 규칙 — export 도 실적을 입력값으로 만들지 않는다)
- Produces: `--export-xlsx` 절차 — Task 10이 검증한다

**설계 근거 — 용도는 "import 전 사람 검수" 하나로 확정한다.** wbs.md 가 import 후 은퇴하므로 wbs.md 기준 엑셀은 import 시점의 스냅샷이고 곧 낡는다. **운영·대외 보고본은 D'Flow export(DB 기준)다.** 이 export 가 답하는 질문은 하나다 — "이 WBS 를 DB 에 넣기 전에 PM 이 표로 훑어보고 틀린 곳을 잡는다". 그래서 xlsx 는 파생 산출물이며, 읽어들여 wbs.md 로 되돌리는 경로는 만들지 않는다(바이너리라 diff·병합·검수가 불가하다는 부록 §2.6의 판단 그대로). 검수 결과 수정은 **입력 프로그램 리스트나 wbs.md 를 고쳐 재생성**하는 것이지 엑셀을 고치는 것이 아니다.

- [ ] **Step 1: 플래그 줄에 `--export-xlsx` 추가** (Task 4 Step 1이 만든 텍스트 기준)

  Before:
  ```markdown
  플래그: `--scale large|medium` (규모 강제), `--start-date YYYY-MM-DD`, `--estimate-only` (산정만),
  `--programs {경로}` (프로그램 리스트 입력 모드 — `.json` / `.yaml` / `.yml` / `.csv` / `.md` / `.xlsx`).
  ```

  After:
  ```markdown
  플래그: `--scale large|medium` (규모 강제), `--start-date YYYY-MM-DD`, `--estimate-only` (산정만),
  `--programs {경로}` (프로그램 리스트 입력 모드 — `.json` / `.yaml` / `.yml` / `.csv` / `.md` / `.xlsx`),
  `--export-xlsx [경로]` (WBS 엑셀 보고본 생성. 경로 생략 시 `{DOCS_DIR}/wbs.xlsx`).
  `--export-xlsx` 는 **VIEW_MODE 에서도 동작한다** — 기존 WBS 를 재생성 없이 엑셀로만 뽑는 것이 주 용도다.
  ```

- [ ] **Step 2: `## 프로그램 리스트 입력 어댑터` 절 뒤에 export 절 삽입** (바깥 펜스는 4-backtick — 안에 python 블록이 있다)
  ````markdown
  ## 엑셀 export (`--export-xlsx`) — 보고본

  정본은 `wbs.md` 다. xlsx 는 **읽기 전용 파생 산출물**이며 다시 wbs.md 로 되돌리지 않는다(부록 §2.6 — 바이너리는 diff·병합·검수가 불가하다).

  ### 데이터 출처 — wbs.md 를 직접 파싱하지 않는다

  실행 중 Task 는 `docs/tasks/<ID>/state.json` 이 진실 원천이고 wbs.md 는 파생 사본이다(부록 §7.1-F2). 따라서:

  1. `wbs-parse.py {wbs} --tasks-all` 로 **Task ID 목록**을 얻는다 (이 모드는 `tsk_id`·`title`·`status`·`depends`·`domain`·`category` 6필드만 낸다 — `wbs-parse.py:198-224` 실측).
  2. 각 ID 에 대해 `wbs-parse.py {wbs} {TSK_ID} --json` 을 호출해 **나머지 필드**를 얻는다 — `model`·`priority`·`assignee`·`schedule`·`tags`·`blocked-by`·`note`·`entry-point`·`prd-ref` (`wbs-parse.py:829-836` 실측). N회 호출은 부록 §2.6이 DEV-02 전 과도기로 명시한 방식 그대로다.
  3. **WP/ACT 행의 제목만** wbs.md 헤딩 정규식(`^##\s+(WP-\d+):\s*(.*)` · `^###\s+(ACT-\d+-\d+):\s*(.*)`)으로 읽는다. 파서가 계층 노드를 내지 않기 때문이며(부록 §7.1-F5), **헤딩은 구조라 진실 원천 문제가 없다.** 그 블록의 필드는 읽지 않는다.
  4. **부모 귀속은 ID 세그먼트로 유도한다** — 파서가 계층을 내지 않으므로 이것이 유일한 연결 고리다(`## D'Flow 연동 표기` 의 ID 불변 규칙이 기대는 것과 같은 규칙).
     - 4단계: `TSK-02-02-01` → `ACT-02-02` → `WP-02`
     - 3단계: `TSK-02-03` → `WP-02` (ACT 행 없음)
     - 유도한 부모 ID 가 3단계에서 읽은 헤딩 목록에 없으면 **그 Task 를 버리지 않고** 부모 없이 쓰고 리포트에 나열한다.

  ⚠️ `status` 는 어떤 경우에도 wbs.md 텍스트에서 읽지 않는다 — 1·2단계의 파서 출력만 쓴다. DEV-02(`--export`)가 나오면 1~4단계가 한 번의 호출로 대체된다.

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
  ````

- [ ] **Step 3: 실행 플로우 말미에 export 단계 추가**

  삽입 위치는 `13.` 헤딩 줄 뒤가 아니라 **13번 항목의 마지막 이어짐 줄 뒤**, 즉 `## 실행 플로우` 절의 맨 끝이다. 13번은 헤딩 줄 다음에 게이트 설명 3줄(현행 172-173행 계열)이 딸려 있으므로, 헤딩 바로 뒤에 넣으면 항목이 두 동강 난다.

  ```markdown
  14. (`--export-xlsx` 있을 때) **엑셀 보고본 생성** — `## 엑셀 export` 절 그대로. 실패해도 wbs.md 생성 결과를 되돌리지 않고, 실패 사유를 리포트에 남긴다.
  ```

- [ ] **Step 3b: VIEW_MODE 의 "종료" 두 곳에 export 예외 명시**

  `--export-xlsx` 의 주 용도가 "기존 WBS 를 재생성 없이 엑셀로만 뽑기"인데, 현행 문장 둘이 VIEW_MODE 를 즉시 종료로 못박고 있어 충돌한다.

  Before (인자 파싱 절, 현행 19행 일부):
  ```markdown
  `VIEW_MODE=true` (내용 전체 표시 후 종료)
  ```

  After:
  ```markdown
  `VIEW_MODE=true` (내용 전체 표시 후 종료 — 단 `--export-xlsx` 가 있으면 export 를 실행한 뒤 종료)
  ```

  Before (실행 플로우 1번):
  ```markdown
  1. **VIEW_MODE** 면 파일 전체 표시 후 종료.
  ```

  After:
  ```markdown
  1. **VIEW_MODE** 면 파일 전체 표시 후 종료. `--export-xlsx` 가 함께 오면 표시 후 14번(엑셀 보고본 생성)만 실행하고 종료한다 — 2~13번은 건너뛴다.
  ```

- [ ] **Step 4: 성공 기준에 항목 추가** — `## 성공 기준` 의 프로그램 리스트 모드 블록 뒤
  ```markdown

  **`--export-xlsx` 사용 시:**

  - 엑셀 행 수 = WP 수 + ACT 수 + Task 수 (헤더·주석 행 제외)
  - 상태 라벨·진척 환산이 `docs/state-machine.json` 에서 읽은 값이고 스킬에 하드코딩되지 않았다
  - 사람이 실적%를 입력하는 컬럼이 없다
  ```

---

### Task 10: 검증 C — 엑셀 export 왕복

**Files:**
- Create: `/tmp/wbs-wsf-verify/b/docs/wbs.xlsx` (스킬이 생성) · `/tmp/wbs-wsf-verify/readxlsx.py`
- Modify: 없음

**Interfaces:**
- Consumes: Task 8 (샘플 B 의 4단계 wbs.md 존재) · Task 9 (export 절)
- Produces: export 가 실제로 열리고 내용이 맞는다는 증거

- [ ] **Step 1: 샘플 B 의 WBS 를 export**
  ```bash
  # VIEW_MODE + export — 재생성 없이 엑셀만 뽑는 주 용도를 그대로 태운다
  /wbs-wsf /tmp/wbs-wsf-verify/b/docs/wbs.md --export-xlsx
  ls -l /tmp/wbs-wsf-verify/b/docs/wbs.xlsx
  ```

- [ ] **Step 2: 되읽기 스크립트 작성** — `/tmp/wbs-wsf-verify/readxlsx.py` 는 SKILL.md `## 프로그램 리스트 입력 어댑터` 의 표준 라이브러리 리더 스니펫을 그대로 옮긴 것이다(Task 8 Step 2에서 이미 검증됨). 숫자 셀은 `t` 속성이 없어 그대로 문자열로 읽힌다 — 정상이다.

- [ ] **Step 3: 내용 대조**
  ```bash
  python3 /tmp/wbs-wsf-verify/readxlsx.py /tmp/wbs-wsf-verify/b/docs/wbs.xlsx > /tmp/wbs-wsf-verify/b/xlsx.json
  python3 -c "
  import json; d=json.load(open('/tmp/wbs-wsf-verify/b/xlsx.json'))
  print('rows', len(d))
  from collections import Counter; print(Counter(r['레벨'] for r in d))
  print('상태코드 집합', {r['상태 코드'] for r in d if r['레벨']=='TSK'})
  print('진척 집합', {r['진척(파생)'] for r in d if r['레벨']=='TSK'})"
  ```
  - 데이터 행 = 19(TSK) + 6(WP) + ACT 수. 샘플 B 의 ACT 는 `00-01` · `01-01~01-04` · `02-01~02-02` · `03-01~03-02` · `04-01~04-02` · `05-01` = **12개** → **37행**.
  - 리더는 1행(헤더)을 제외하고 반환하므로 `rows` 는 **38** 이어야 한다 — 37 데이터 행 + 디스클레이머 푸터 1행.
  - `레벨` 분포: `WP` 6 · `ACT` 12 · `TSK` 19 · 빈 값 1(푸터).
  - 전 Task 가 `[ ]` 이므로 `상태 코드` 집합은 `{"[ ]"}`, `진척(파생)` 집합은 `{"0"}` 여야 한다(`state_weights["[ ]"] = 0`). 다른 값이 나오면 환산이 `state-machine.json` 이 아니라 어딘가에 하드코딩된 것이다.
    (리더는 숫자 셀도 문자열로 돌려주므로 이 대조는 **값만** 검증한다. 숫자 셀로 나갔는지는 아래 Step 3b 가 본다.)

- [ ] **Step 3b: 숫자 컬럼이 텍스트로 새지 않았는지 확인** — 12·17번은 숫자여야 한다(`t` 속성 없음). Step 3 의 값 대조로는 잡히지 않는다.
  ```bash
  python3 -c "
  import zipfile, re
  x = zipfile.ZipFile('/tmp/wbs-wsf-verify/b/docs/wbs.xlsx').read('xl/worksheets/sheet1.xml').decode()
  row2 = re.search(r'<row r=\"2\">.*?</row>', x).group(0)
  for ref in ('L2', 'Q2'):                      # 12번=영업일, 17번=진척(파생)
      c = re.search(r'<c r=\"%s\"[^>]*>' % ref, row2)
      print(ref, c.group(0) if c else 'MISSING')
  "
  ```
  두 셀 모두 `t=\"s\"` 가 **없어야** 한다. 있으면 writer 가 숫자를 문자열로 넘긴 것이다.

- [ ] **Step 4: 열림 확인과 이스케이프 확인**
  ```bash
  python3 -c "
  import zipfile; z=zipfile.ZipFile('/tmp/wbs-wsf-verify/b/docs/wbs.xlsx'); print(z.namelist()); print(z.testzip())"
  ```
  `testzip()` 이 `None` 이어야 하고 5개 파트가 모두 있어야 한다.

  이어서 XML 이스케이프를 확인한다 — `html.escape` 누락의 유일한 검출 경로다. Step 3의 행 수 대조가 끝난 뒤에 하는 **일회성 확인**이므로 행 수가 늘어나는 것은 무시한다: `mkxlsx.py` 의 `rows` 에 `["m60", "M60-SCR-009", "출고 & 반품 조회", "PG-01", "화면", "하", ""]` 를 추가해 재생성·재export 한 뒤, `readxlsx.py` 로 되읽어 그 제목이 `출고 & 반품 조회` 로 온전히 나오는지 본다. 파일이 열리지 않거나 `&amp;` 가 보이면 이스케이프가 틀린 것이다.

- [ ] **Step 5: 정본 불변 확인**
  ```bash
  grep -c '^#### TSK-' /tmp/wbs-wsf-verify/b/docs/wbs.md   # export 가 wbs.md 를 건드리지 않았다
  ```
  export 전후로 이 값이 같아야 한다. xlsx 는 파생 산출물이므로 정본을 수정하지 않는다.

---

## 미결 — 이 계획이 결정하지 않은 것

아래는 스킬 편집만으로 닫히지 않아 사용자·상위 계획의 결정이 필요하다. 결정 전까지 위 규칙이 잠정값으로 동작한다.

### 닫힌 것 (2026-08-10 사용자 확정 — 기록용, 되묻지 말 것)

| 항목 | 결론 |
|---|---|
| WBS 정본 위치 | **D'Flow DB.** wbs.md 는 최초 작성·검수·import 부트스트랩 전용으로 은퇴. `/dev` 계열은 import 후 DB 를 읽고, `claim` 시 `dflow.sh` 가 명세를 `docs/tasks/{TSK}/spec.md` 로 캐시 |
| import 시 명세 유실 | **(a)안 채택 — 0073 확장.** `category`/`domain`/`priority`/`model` text · `tags`/`depends` text[] · `prd_ref`/`entry_point` text · `acceptance` jsonb · `spec` text(마크다운 본문, 뷰어 조회·편집). wbs.md 의 명세 필드가 전부 DB 에 자리를 얻었다 |
| 재생성 시 삭제된 프로그램 처리 | **불필요.** DB 정본이므로 import 후 재생성 자체가 예외 경로다. 항목 삭제는 웹에서 사람이 한다 |
| WP/ACT `assignee` 문법 | **export 계약 v2 로 확정** — 노드별 `assignee`(email)를 전 계층이 갖는다. "입력에 모듈 담당 컬럼이 있을 때만 기록" 규칙 그대로 유효 |
| 엑셀 보고본 이원화 | **역할 분리로 확정.** 로컬 `--export-xlsx` = **import 전 사람 검수용** · D'Flow export = 운영·대외 보고본 |
| 선행 산출물 미도달 대응 강도 | **하드 차단.** `done` 은 push 미도달 시 보고 거부, `claim` 은 선행 `head_sha` 미도달 시 메시지 출력 후 **실행 거부**(경고+확인 아님) |
| PAT 관리 UI 배치 | **`/account` 페이지 신설**(비밀번호 변경 모달 통합). `/agent-ops` 임시 배치 → WP-05 이관 2단계를 거치지 않는다. 이 계획 범위 밖 |

**export 계약 v2** (TSK-01-01 동결 대상, 이 계획의 생성 템플릿이 맞춰야 할 것): 기존 §7.2-1 필드 + `model` · `tags[]` · `prd_ref` · `entry_point` · `spec_sections{requirements[], test_criteria[], constraints[], api_spec, data_model, description}`. `acceptance[]` 는 최상위 유지, `priority` 는 문자열 라벨 유지. → Task 3 Step 3b 의 파싱 계약이 이 v2 를 만족시키는 문법 규정이다.

### 남은 미결

1. **claim 시 `as`→`ip` 자동 전이 여부**(부록 미결 ⑪ 잔여). 확정되면 생성 시 상태 시드 규칙(`status: [ ]` 고정)을 재검토해야 할 수 있다. TSK-01-01 계약 동결 대상.
2. **난이도 3단계 기간값(하 2 / 중 3 / 상 5 영업일)의 실측 보정.** MES 실제 프로그램 리스트로 한 번 돌려 실적과 대조하기 전까지는 추정치다. 기존 `## 일정 계산` 표(dev 5~15일)와 다른 근거로 서 있다는 점을 스킬에 명시했으나, 어느 쪽이 옳은지는 실적이 판정한다.
3. **`.env` 프로젝트 바인딩 키 이름의 최종 확정.** 이 계획은 `DFLOW_PROJECT_ID`(단일) + `DFLOW_PROJECT_MAP`(DOCS_DIR→project_id) 두 키를 제안하고 해석 순서·fail-closed 규칙까지 정했으나, 부록 §2.7의 로컬 계약에는 `DFLOW_API_BASE`·`DFLOW_PATS`·`DFLOW_USER_EMAIL` 만 있다. **키 이름과 `project_id` 를 UUID 로 쓸지 slug 로 쓸지는 TSK-01-01(계약 동결)의 몫**이며, 확정 값이 다르면 이 절만 갈아 끼운다. 또한 PAT 자체가 `project_id` 로 스코프될 수 있으므로(부록 §2.1 리졸버 반환의 `projectId`), **`.env` 바인딩과 PAT 스코프가 불일치할 때 어느 쪽이 이기는지**도 그 Task 에서 정해야 한다 — 권고는 "불일치면 업로드 거부"(fail-closed).
4. **[이 계획 밖 — wbs-web WP-03/WP-04 안건] 분산 다인 개발의 작업 위치 추적.** (선행 산출물 미도달은 **하드 차단으로 확정** — 아래 (나) 참조, 남은 미결은 (가) 뿐이다.)

   **(가) 위치 추적** — 담당자들이 각자 다른 PC·다른 클론에서 개발하면 "지금 누가 어느 리포 어느 브랜치에서 하고 있나"를 아무도 답하지 못한다. 현행 추적 수단 셋(커밋 트레일러 `DFlow-Order` · `done --auto-links` · 0072 `evidence`)은 **전부 보고 이후 시점**이라 claim~report 사이 구간(분산에서는 며칠)이 통째로 빈다. 단일 PC 에서는 `dev-monitor` 가 로컬 파일 스캔으로 메웠지만 남의 PC 파일은 볼 수 없다.

   **권고 — 서버(claim 시점)에서 받는다.** 분산의 유일한 공통 지점이 서버이고, 부록 §3이 이미 "세션 복구는 로컬 상태 파일에 의존하지 않는다 — 서버에서 복원한다"고 못박았으므로 그 약속의 연장이지 새 방향이 아니다.
   - `agent_work_orders` 에 `work_repo_url` · `work_branch` · `work_base_sha` (전부 nullable)
   - **왕복 비용 0** — `claim/route.ts:15-17` 이 이미 JSON body 를 파싱하고, `:26-29` 의 CAS UPDATE 가 이미 4개 컬럼을 쓴다(실측). 같은 UPDATE 에 3개를 더해도 원자성이 그대로다.
   - `dflow.sh claim` 이 `done --auto-links` 와 같은 방식으로 자동 수집 — 사람이 타이핑하지 않는다
   - **서버는 검증하지 않는다**(부록 §6 원칙 — "에이전트가 제출한 주장" 표기). progress 보고에서 갱신 허용(브랜치를 갈아탔을 수 있다)
   - **워크트리 경로는 받지 않는다** — PC 로컬 사실이라 남이 쓸 수 없다. repo URL + 브랜치는 남이 `git fetch` 로 실제 확인할 수 있고, 그것이 "추적 가능"의 실질 기준이다
   - 배치는 WP-03(0071 과 같은 계열): 0071 이 "누가"를, 이것이 "어디서"를 답한다

   **(나) 선행 산출물 미도달 — [확정: 양쪽 하드 차단]** 의존 게이트는 *상태*(서버의 `stage >= [im]`)로 판정하는데, 착수에 실제로 필요한 것은 *산출물*(선행의 커밋이 내 워킹트리에 있는 것)이다. 분산에서는 둘 사이에 시간차가 있고 **그 시간차 동안 claim 이 허용된다.** 결과:
   - 계약 Task 가 `[im]` 인데 내 로컬에 그 타입·DDL·인터페이스가 없다 → **내가 그 계약을 다시 만든다** → 중복 정의 + 머지 충돌. fan-in 이 큰 계약 Task 일수록 피해가 크다.
   - 선행 마이그레이션이 없어 로컬 DB 스키마가 다르다 → 테스트는 통과하는데 실제로는 깨진 코드.
   - 낡은 base 에서 브랜치를 따 rebase 충돌이 커진다.

   **원인은 pull 을 안 한 것이 아니라 push 없이 완료 보고한 것이다.** 후자를 막으면 전자는 fetch 한 번으로 끝난다. 두 겹으로 푼다:

   - **보고 측(강제)** — `dflow.sh done` 이 `git ls-remote --heads origin` 으로 `head_sha` 의 원격 도달을 확인하고, 미도달이면 **보고를 거부**한다(exit 2). "완료 = push 완료"를 클라이언트 계약으로 만든다. 서버는 여전히 검증하지 않는다(부록 §6 유지).
   - **착수 측(차단)** — `claim` 응답에 선행 Task 들의 `head_sha`(0072 `evidence` 에 이미 있는 값)를 실어 보내고, 클라이언트가 `git fetch` 후 두 검사를 돈다:
     - `git cat-file -e <sha>^{commit}` → 실패면 "선행 X 의 커밋이 로컬에 없다(그 사람이 push 하지 않았거나 fetch 필요)"
     - `git merge-base --is-ancestor <sha> HEAD` → 실패면 "있지만 내 브랜치에 포함되지 않았다 — base 를 갱신하라"

     **둘 중 하나라도 실패하면 사유를 출력하고 실행을 거부한다**(경고 + 확인이 아니라 차단 — 사용자 확정). 근거: 계약 미도달 상태의 착수가 만드는 중복 정의·머지 충돌 비용이, 선행자의 push 를 기다리는 비용보다 크다. **서버측 claim 은 성공하되 클라이언트가 브랜치 생성·작업 개시를 막는 구조**다 — 서버는 로컬 git 을 볼 수 없어 서버측 강제는 자기신고가 되기 때문이다. 우회가 필요하면 사람이 `[fp]`(강제 진행 — "선행 미충족이지만 사람이 판단해 시작 허용", `state-machine.json`)로 명시 전환한다. 이 전환은 **사람 전용 이벤트**라 에이전트가 스스로 뚫을 수 없다(부록 §2.5-② — 403 `human_gate`).

   이 검사가 **클라이언트(셸 래퍼)에서만 가능하다는 사실이 곧 부록이 MCP 를 만들지 않기로 한 근거**다 — "원격 MCP 는 개발자 PC 의 git 을 볼 수 없다".

5. **Phase 노드의 표현.** export JSON(부록 §7.2-1)은 `kind: phase` 노드를 요구하지만 wbs.md 에는 Phase 헤딩이 없다(`state-machine.json` 의 `phases.{SUBPROJECT}` 가 정본). 프로그램 리스트 모드도 이 관례를 그대로 따르게 두었다 — Phase 를 파일 표면에 올릴지는 DEV-02 의 결정이다. **참고: `wbs_items.level` 은 `check (level in ('phase','task','activity'))` 3계층이고(`0001_init.sql:28`), wbs.md 도 Phase 헤딩이 없어 실질 3계층이라 `WP→phase · ACT→activity · TSK→task` 로 손실 없이 매핑된다** — 이 정합이 유지되는 한 Phase 를 파일에 올릴 실익이 없다.
