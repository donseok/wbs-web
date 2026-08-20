---
name: dflow-export
description: 로컬 wbs.md 를 검증하고 D'Flow /wbs/import 계약 v2.1 JSON 으로 export 한다 (부트스트랩 1회 import 경로). 트리거 - "/dflow-export", "wbs export", "D'Flow 로 올려", "import payload 만들어". 사용법 - /dflow-export [SUBPROJECT | wbs.md 절대경로] [--project-id UUID --module NAME] [--push]
---

# dflow-export — WBS 부트스트랩 export

로컬 `wbs.md` → D'Flow `POST /api/v1/wbs/import` 요청 본문 생성 (+선택 전송).
**스크립트 정본**: 이 스킬 폴더 `.claude/skills/dflow-export/scripts/` (다른 리포의 사본과 무관 — 고치려면 여기를 고친다).
**계약 정본**: `docs/agent/claude-skill/dflow-work/references/api-contract.md` §"POST /wbs/import" — **v2.1**. 이 스킬과 계약 문서가 다르면 계약이 이긴다.

## 인자

- `SUBPROJECT` → `docs/{SUBPROJECT}/wbs.md` (예: `MES`, `bookloop`). 절대경로도 허용.
- `--project-id <UUID>` `--module <이름>`: import 봉투 완성용. 없으면 아래 "D'Flow 프로젝트 바인딩" 순서로 해석한다.
- `--push`: 실제 전송. **기본은 dry-run** (payload 파일 생성까지).

## D'Flow 프로젝트 바인딩

`wbs-wsf` 스킬(`.claude/skills/wbs-wsf/SKILL.md` §"D'Flow 프로젝트 바인딩")과 동일 규칙을 쓴다 — wbs.md 자체에는 프로젝트 결합을 넣지 않는다(파일은 git 으로 복제·브랜치되므로, 안에 박으면 엉뚱한 프로젝트로 업로드될 위험).

해석 순서(먼저 맞는 것이 이긴다):

1. CLI 인자 `--project-id`/`--module` — 최우선.
2. 없으면 작업 리포 `.env` 의 `DFLOW_PROJECT_MAP` 에서 현재 `DOCS_DIR`(= `docs/{SUBPROJECT}`) 키 조회.
3. 없으면 `.env` 의 `DFLOW_PROJECT_ID`.
4. **전부 없으면 업로드·payload 조립을 중단한다** (fail-closed — 추측 금지). export 는 정상 완료하되 필요한 키 이름(`DFLOW_PROJECT_ID` 또는 `DFLOW_PROJECT_MAP`)만 안내한다.

`module` 기본값 = `DOCS_DIR` 마지막 경로 세그먼트 (`docs/c10` → `c10`).

`.env` 는 **존재·키 유무만 확인하고 값을 출력하지 않는다** — PAT 등 N인분 자격증명이 같은 파일에 들어 있다. 생성·수정하지 않는다.

## PAT

- `DFLOW_PATS`(쉼표 구분 — **첫 토큰** 사용) 우선, 없으면 `DFLOW_PAT`.
- **값을 화면·리포트에 절대 출력하지 않는다.** curl 호출 시에도 셸 환경변수 치환만 쓰고 리터럴로 풀어 적지 않는다.

```bash
PAT="$(echo "${DFLOW_PATS:-$DFLOW_PAT}" | cut -d',' -f1)"
```

## 실행 순서

모든 명령은 **작업 리포 루트가 cwd** 라는 전제로 스킬 폴더 상대경로를 쓴다. 임시 파일은 `/tmp` 가 아니라 **이 세션의 scratchpad 디렉토리**를 쓴다(경로 하드코딩 금지 — 세션마다 다르다).

### 1. 검증 게이트 (실패 시 중단)

```bash
python3 .claude/skills/dflow-export/scripts/wbs-validate.py validate --wbs docs/{MOD}/wbs.md
```
- `ok: true` + `task_count` 가 실제 Task 수와 일치해야 통과. 0 이면 헤딩 형식 문제 — 진행 금지.
- Task 헤딩 정규식은 `#{3,5}` — **3~5단계 헤딩(`###`~`#####`)을 모두 TSK 로 인식**한다(3단계 WBS 와 4단계 WBS 양쪽 겸용).
- 참고 검사(선택): Task 목록을 파이프로 넘겨야 의미 있는 결과가 나온다(입력 없이 `--docs-dir` 만 주면 빈 결과).
  ```bash
  python3 .claude/skills/dflow-export/scripts/wbs-parse.py docs/{MOD}/wbs.md --tasks-all \
    | python3 .claude/skills/dflow-export/scripts/dep-analysis.py --docs-dir docs/{MOD}
  ```
  의존 충족 임계는 상태머신이 정한다(6상태 정의면 `[im]` 이상, 5상태 정의/미지정이면 `[xx]` 만 충족).

### 2. Export

```bash
python3 .claude/skills/dflow-export/scripts/wbs-parse.py docs/{MOD}/wbs.md --export > "$SCRATCHPAD/wbs-export-{MOD}.json"
```
봉투: `{"schema_version": "2.1", "source": "...", "nodes": [...]}` — 결정적 출력 (재실행 = byte 동일). `$SCRATCHPAD` 는 이 세션의 scratchpad 디렉토리로 치환한다.

### 3. import 본문 조립

export 봉투에 2필드 추가 = 요청 본문:
```bash
python3 - <<EOF
import json
d = json.load(open("$SCRATCHPAD/wbs-export-{MOD}.json"))
d["project_id"] = "<UUID>"; d["module"] = "<MOD>"
json.dump(d, open("$SCRATCHPAD/wbs-import-{MOD}.json", "w"), ensure_ascii=False, indent=2)
EOF
```

### 4. 전송 (`--push` 일 때만)

```bash
PAT="$(echo "${DFLOW_PATS:-$DFLOW_PAT}" | cut -d',' -f1)"
curl -sS -X POST "$DFLOW_API_BASE/api/v1/wbs/import" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  -d @"$SCRATCHPAD/wbs-import-{MOD}.json"
```
- PAT 스코프 `work:report` 필요, **프로젝트 관리자(admin) 또는 슈퍼유저 전용** — 그 외 역할은 403 `forbidden_role`.
- `nodes` 는 최대 `MAX_NODES = 1000` 건 — 초과 시 400.
- 404 = 킬스위치(`AGENT_API_ENABLED`) 꺼짐 / 프로젝트 미등록 / PAT principal 이 해당 프로젝트 비멤버 — **의도적으로 구분하지 않는다.**
- 응답 확인: `upserted`/`skipped`/`unmatched_assignees`/`non_leaf_skipped`/`orders_created`.
  - `non_leaf_skipped` 는 정상 데이터에서 항상 빈 배열이다 — task 는 리프라는 전제가 계약. 값이 있으면 비정상 WBS.
  - `unmatched_assignees` 와 `orders_created` 는 서로 독립(v2.1) — assignee 이메일이 로스터에 매칭되지 않아도 task 노드 주문은 발행된다.
- **멱등**: 같은 payload 재전송 = 0건 갱신. 삭제는 절대 안 함.
- **필드 소유권**: 기존 행은 구조·명세만 갱신 — `stage`·`assignee`·`actual_pct` 는 서버가 보존. 재업로드로 진행 상태가 초기화될 걱정 없음.

## 계약 v2.1 요지 (export 가 이미 준수 — 수동 조작 금지)

- `stage`: `as|fp|ip|im|xx` 또는 `null`(미착수 `[ ]`). `todo` 는 폐기(서버가 과도기 별칭으로 null 정규화). 레거시 마커 `[dd!]` 는 아직 `todo` 로 방출되나 서버 정규화로 무해 — 그대로 둔다.
- `priority`: 문자열 라벨 그대로 (`critical/high/medium/low`) — 정수 매핑(100/50/10/0)은 서버 책임.
- `spec_sections` 6키 (requirements[]·test_criteria[]·constraints[]·api_spec·data_model·description), `acceptance[]` 최상위. 서버가 고정 섹션 순서 마크다운으로 조립해 `spec` 저장.
- `dev_workflow`: payload 에 없음 — 서버가 `kind:"task"` 자동 ON.
- `depends[]`: 같은 모듈 내 노드 id. 서버 선행 게이트: claim 시 선행 stage `im`/`xx` 아니면 403 `dependency_not_met`.

## 상태의 진실 원천

- import 이후 정본은 **D'Flow DB**. `wbs.md` 는 최초 작성·부트스트랩 전용.
- 실행 중 Task 는 `docs/tasks/<ID>/state.json` 이 로컬 정본 — export 는 이 값으로 `- status:` 를 자동 덮어씀(`wbs-parse.py` 가 `_wbs_status.py` 경유, 별도 조작 불요). 이 경로 탐색은 스킬 폴더의 `scripts/references/state-machine.json` 을 fallback 으로 참조하므로, 스크립트만 옮기고 이 파일을 빠뜨리면 깨진다.

## 결과 보고

- `unmatched_assignees` 는 **전량 나열**한다(생략 금지 — 조회 실패를 데이터 없음으로 위장하지 않는다는 원칙과 동일선상).
- 업로드 불가(프로젝트 바인딩 미설정)로 중단했으면 어떤 키가 없었는지 리포트에 남긴다(값은 절대 남기지 않는다).

## 알려진 제약

- E2E 실사는 대상 D'Flow 서버에 `AGENT_API_ENABLED` 가 켜져 있어야 가능 — 꺼져 있으면 `--push` 는 404.
- 테스트: `python3 -m pytest .claude/skills/dflow-export/scripts -q` (또는 스크립트 디렉토리에서 `python3 -m pytest -q`) — 통과가 건강 기준선.
- 동봉 회귀 테스트 3종(export·validate·status). test_wbs_md_consistency 는 merge-wbs-status.py(이 스킬 범위 밖) 의존이라 제외 — 정본은 dev-workflow 리포.
