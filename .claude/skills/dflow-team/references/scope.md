# /dflow-team 실행 범위(설계만·구현부터)

SKILL.md 「인자」 의 `<SCOPE>` 가 `full` 이 아닐 때, 그리고 「이어서 시작」 요청이 설계 검토 대기 작업을 가리킬 때 Bash `cat` 으로
읽는다. 워커 쪽 정본은 `/dflow-dev` SKILL.md 「실행 범위」(`references/orch/design.md` 「설계만 멈춤」·`references/orch/start.md`
「구현부터」)이고, 설계는 wbs-web 리포 docs/superpowers/specs/2026-09-26-dflow-dev-skill-router-design.md §14(킷에는 미동봉)다.

| `<SCOPE>` | 팀원이 하는 일 | 끝 |
|---|---|---|
| `design` | claim → 기준선 → Design → Design 게이트 | `design_review`(state.json `wait_review`, 설계는 agent 브랜치에 push) |
| `build` | 사람이 쓴 설계(개발 브랜치 `<TASKS>/<TSK>/design.md`)나 검토 대기 설계에서 Build → Verify → 마감 | `done` 등 `full` 과 같다 |

## 1. 후보(「2-3」 poll exit 0)

**`design`**
- `deps_unmet` 이 비어 있지 않아도 선행 대기에 넣지 않고 곧바로 후보로 둔다. 설계만 하므로 선행 코드가 필요 없고, 워커의
  claim 은 늘 `--design-first` 다. 선행이 아직 구현 전이면 서버가 `DESIGN_FIRST_TOO_EARLY` 로 거부하고 워커가 `skipped 선행
  미충족(설계 선행 불가: …)` 로 끝낸다(일시 제외).
- 「선행 반영 사전 검사」(`deps_nohead`)는 하지 않는다. 설계 선행 상한(`DFLOW_DESIGN_AHEAD_MAX`)과 design-ahead.md 「3」 도 쓰지
  않는다 — 모든 슬롯이 설계만 한다.

**`build`**
- 선행 사전 검사는 `full` 과 같다.
- 후보마다 띄우기 전에 사람이 쓴 설계가 개발 브랜치에 있는지 본다. 워커를 띄워 곧 `skipped` 로 끝내는 낭비를 막는다.
  `<TASK_DIR>` 은 「5. 팀원 spawn」 3번과 같은 `dflow.sh taskdir` 값이다. 기상마다 처음 한 번만 fetch 한다.
  ```bash
  git -C '<MAIN>' fetch -q origin || echo FETCH_FAIL
  git -C '<MAIN>' cat-file -e "origin/<개발브랜치>:<TASK_DIR>/design.md" 2>/dev/null && echo HAS_DESIGN || echo NO_DESIGN
  ```
  `NO_DESIGN` 이면 띄우지 않고 일시 제외에 넣어 사유 `설계 문서 없음(구현부터)` 로 보고하며 `team.result`(slot `-`, status
  `skipped`)를 남긴다. `FETCH_FAIL` 이면 이 기상에는 `build` 후보를 띄우지 않는다(모르는 채 띄우지 않는다). 5절 검사는 워커가 한다.
- 새 후보보다 먼저 아래 「2」 의 검토 대기 설계를 본다.

## 2. 검토 대기 설계 이어 가기

설계만으로 멈춘 작업은 서버에 `claimed`·`mine` 으로 남고, 설계는 `origin/agent/<id8>-<slug>` 에 있다(워크트리는 결과 처리 때
지웠다). 이어 가는 길은 둘이다.

1. **`<SCOPE>` 가 `build`**: 빈 슬롯이 있으면 기상마다 한 번(재개 대상·대기 큐 다음, 새 후보보다 먼저) 이 PC 신원의 검토 대기
   작업을 찾아 「5-1. 재개 spawn」 으로 띄운다. 워크트리가 없으므로 resume.md 3항이 원격 agent 브랜치에서 다시 만든다.
   ```bash
   dirs=$(.claude/skills/dflow-work/scripts/dflow.sh config tasks-dirs); rc=$?
   { [ "$rc" = 0 ] && [ -n "$dirs" ]; } || { echo "FAIL TASKS_DIRS rc=$rc"; exit 1; }
   git -C '<MAIN>' fetch -q origin || { echo FETCH_FAIL; exit 1; }
   printf '%s\n' "$dirs" | {
     set --
     while IFS= read -r d; do set -- "$@" "$d/*/state.json"; done
     for ref in $(git -C '<MAIN>' branch -r --list 'origin/agent/*'); do
       id8=$(printf '%s' "${ref#origin/agent/}" | cut -c1-8)
       git -C '<MAIN>' diff --name-only "origin/<개발브랜치>...$ref" -- "$@" | while IFS= read -r p; do
         git -C '<MAIN>' show "$ref:$p" | jq -r --arg id8 "$id8" --arg ref "$ref" \
           'select((.order // "") | startswith($id8)) | select(.phase == "wait_review") | "REVIEW\t\($id8)\t\(.tsk // "-")\t\($ref)"'
       done
     done
   }
   ```
   `REVIEW` 줄마다 `dflow.sh show <id8>` 으로 `status=claimed`·`mine=true` 를 확인한 것만 띄운다(show 실패는 이 기상에 건너뛴다).
   `FAIL TASKS_DIRS`·`FETCH_FAIL` 이면 이 기상에는 찾지 않는다. 포인터는 `SCOPE=build` 다. 워커가 선행을 다시 보고, 미충족이면
   state.json 을 `wait_pred` 로 바꿔 `design_waiting` 으로 끝낸다 — 그 뒤로는 design-ahead.md 의 선행 대기 재개를 탄다.
2. **좌석 「이어서 시작」 요청**(범위와 무관): 요청 작업이 검토 대기면 포인터를 `SCOPE=build` 로 띄운다 — 사람이 검토를 마친 한
   건만 구현으로 넘기는 손잡이다. 검토 대기인지는 이 PC 에 워크트리가 있으면 그 state.json, 없으면 위 블록처럼
   `git show origin/agent/<id8>-*:<TASK_DIR>/state.json` 의 `phase` 로 본다. 읽지 못하면 팀장의 `<SCOPE>` 그대로 띄운다.

`full`·`design` 에서는 1 을 하지 않는다(검토 전에 구현이 시작되면 안 된다).

## 3. 결과

- `design_review`: SKILL.md 「3. 결과 처리」 표대로 슬롯을 풀고 워크트리를 정리한다. 좌석은 워커가 보낸 heartbeat `wait_review`
  로 「설계 검토 대기」 가 된다. 보고 한 줄: `<TSK> 설계 완료 — 검토 대기(<branch>). 검토 뒤 팀장을 "구현부터" 로 돌리거나 좌석
  「이어서 시작」 을 누른다`.
- `skipped design_missing`·`skipped design_invalid <빠진 절>`: 일시 제외. 사람이 설계 문서를 채워야 하므로 사유를 그대로 보고한다.
