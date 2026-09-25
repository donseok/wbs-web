---
name: dflow-merge
description: 승인(approved)된 D'Flow 작업의 agent 브랜치를 개발 브랜치(`.dflow.local` 의 `dev_branch`)에 반영. 스택 브랜치는 조상 순서대로, approved 확인 전 머지 금지(팀장 전용 --on-report 만 예외). 트리거 - "/dflow-merge", "승인된 작업 머지", "approved 반영". 사용법 - /dflow-merge [<ref>...]
---
<!-- dflow-caps: remote-candidates — 팀장·워커가 이 줄로 기능 지원을 판정한다. 지우거나 바꾸지 않는다. -->

# /dflow-merge — 승인된 작업의 main 반영

인자: `$ARGUMENTS` (선택: ref 목록. 없으면 로컬 `phase=reported` 작업, 로컬 `phase=merged` 이고 `unapproved=true` 인 작업(승인 전 머지분, 판정만 한다), 원격 `origin/agent/*` 브랜치 중 `phase` 가 `merged` 가 아닌 작업이 후보. `api_base` 가 현재 D'Flow 와 다른 후보는 건너뛴다)

**`--on-report`(팀장 전용, 승인 전 머지)**: `/dflow-team` 팀장이 자동 머지 모드에서만 붙인다. 사람이 직접 쓰지 않으며
description 의 사용법에도 노출하지 않는다. 이 플래그가 있으면 서버 `status=reported`(완료 보고, 승인 대기)이고 반려되지
않은 작업도 머지한다(2번). 승인은 사람이 나중에 D'Flow 웹에서 하고, 그 판정은 다음 스윕이 「승인 전 머지분」 으로 읽어
정리한다. 이유: 의존 사슬이 있는 WBS 에서 선행이 승인될 때까지 후속이 착수하지 못하면, 사람이 Task 마다 승인해야
진척된다(2026-09-19 mdm-dict-v2 실측: 팀원 4명 중 3명이 `skipped 선행 승인 대기`). 자율로 돌고 사람은 사후에
확인한다는 팀장 설계와 어긋난다. 플래그가 없으면 종전대로 approved 만 머지한다.

**`--resolve <ref>`(팀장이 띄운 해소 워커 전용)**: `/dflow-team` 팀장이 머지 충돌을 풀라고 띄운 해소 워커만 쓴다.
사람이 직접 쓰지 않으며 description 의 사용법에 노출하지 않는다. ref 는 정확히 하나이고 `--attempt <n>`(1~3)이 함께
온다. `--on-report` 가 함께 오면 그 판정도 그대로다. **이 플래그면 지금 `references/resolve.md` 를 읽고 그 절차
(「해소 머지」)를 따른다** — 이 파일의 「절차」 는 그 문서가 가리키는 단계만 쓴다. 플래그 없는 수동
사용과 팀장 스윕은 충돌 파일 목록을 보고하는 것만 바뀌고 여전히 `--abort` 한다(2026-09-23 머지 충돌 설계 §5.1).

> **위치 선언**: /dflow-dev 는 done(reported, 승인 대기)에서 끝난다. 사람이 D'Flow 웹에서
> approve 한 뒤 그 브랜치를 main 에 합치는 것이 이 스킬이다. 이게 없으면 후속 작업의 선행
> 게이트(`merge-base --is-ancestor` 검사)가 영원히 거짓이고 스택 브랜치가 무한히 깊어진다.
> 서버 통신은 dflow.sh, exit code 분기, dflow-work 금지사항 상속.

근거·사고 이력은 `references/rationale.md` 에 있다. 실행에는 필요 없고 규칙을 바꿀 때만 읽는다.

## 절차

`<기본브랜치>` 는 개발 브랜치, 즉 `dflow.sh branch dev` 의 값이다(`.dflow.local` 의 `dev_branch`, 레거시는
`origin/HEAD`). 팀원(`--worker`)은 팀장이 넘긴 `DEV_BRANCH` 를 쓴다.

작업 폴더 `<TASKS>` 는 `<DOCS_DIR>/tasks` 다(리포 최상위 기준). 한 주문의 폴더 `<TASKS>/<TSK>` 는
`dflow.sh taskdir <ref>` 의 값이다 — `.dflow.local` 의 `project_map` 에서 그 주문의 프로젝트 키를, 없으면 `docs` 를 쓴다.
여러 작업을 훑을 때는 `dflow.sh config tasks-dirs` 가 내는 폴더 전부를 본다. `<DOCS_DIR>` 를 `docs` 로 박아 둔
고정 경로는 쓰지 않는다.

1. **후보 식별**: 인자가 없으면 아래 원격·로컬 두 스캔이 낸 줄이 후보다. **정본은 이 두 셸 블록이다**(`scripts/sweep-check.sh`
   는 이 1번을 흉내 내는 사전 검사일 뿐이다 — 이 번호 끝 항목).
   - **원격 스캔**: `git fetch origin` 뒤 `origin/agent/*` 의 각 `<ref>` 에서, `git diff --name-only origin/<기본브랜치>...<ref> --`
     뒤에 `dflow.sh config tasks-dirs` 의 폴더마다 만든 pathspec(`<그 폴더>/*/state.json`)을 붙여 state.json 을 찾고
     `git show <ref>:<경로>` 로 읽는다. `git show` 에는 glob 을 쓰지 않는다. 고정 glob `*/tasks/*/state.json` 도 쓰지 않는다.
     ```bash
     cd "$(git rev-parse --show-toplevel)" || exit 1   # tasks-dirs·pathspec 은 리포 최상위 기준이다
     api=$(.claude/skills/dflow-work/scripts/dflow.sh config api_base); api=${api%/}
     git fetch origin
     dirs=$(.claude/skills/dflow-work/scripts/dflow.sh config tasks-dirs); rc=$?
     { [ "$rc" = 0 ] && [ -n "$dirs" ]; } || { echo "건너뜀(tasks-dirs 조회 실패, exit $rc)"; exit 1; }
     printf '%s\n' "$dirs" | {
       set --
       while IFS= read -r d; do set -- "$@" "$d/*/state.json"; done
       for ref in $(git branch -r --list 'origin/agent/*'); do
         id8=$(printf '%s' "${ref#origin/agent/}" | cut -c1-8)
         git diff --name-only "origin/<기본브랜치>...$ref" -- "$@" | while IFS= read -r p; do
           git show "$ref:$p" | jq -r --arg ref "$ref" --arg id8 "$id8" --arg api "$api" --arg p "$p" \
             'select((.order // "") | startswith($id8)) | select(.phase != "merged")
              | [$ref, .tsk, .order, .phase, (if (.api_base // "") == "" then "none" elif .api_base == $api then "same" else "other" end), $p] | @tsv'
         done
       done
     }
     ```
     `tasks-dirs` 가 실패하거나(exit≠0) 빈 값을 내면 후보 식별을 **하지 않고** "건너뜀(tasks-dirs 조회 실패)" 로 보고한 뒤
     멈춘다(블록이 `rc`·빈 값을 먼저 본다). `$dirs` 를 here-doc(`<<EOF`)으로 넘기지 않는다. 여섯째 칸(`$p`)은 그 state.json 의
     정확한 경로이며, 4번이 `<후보 state.json 경로>` 로 그대로 쓴다 — 다시 `dflow.sh taskdir` 를 부르지 않는다.
     브랜치 이름의 id8 과 state.json `order` 의 앞 8자가 일치하고 **`phase` 가 `merged` 가 아니면 전부 후보**다(tip 의 phase 에
     기대지 않는다. 판정은 서버 `show` 로 한다). 일치하는 state.json 이 없는 브랜치는 후보가 아니다. 원격에만 있는 후보의
     머지 대상은 `origin/agent/<id8>-<slug>` 다.
   - **로컬 스캔**: `<TASKS>/*/state.json` 중 `phase=reported` 이거나, `phase=merged` 이고 `unapproved=true` 인 것.
     ```bash
     cd "$(git rev-parse --show-toplevel)" || exit 1   # tasks-dirs 는 최상위 기준. $f 도 최상위 기준 경로로 나와야 <W>/<경로> 로 재사용된다
     api=$(.claude/skills/dflow-work/scripts/dflow.sh config api_base); api=${api%/}   # 원격 스캔 블록과 별도 호출이라 다시 구한다
     .claude/skills/dflow-work/scripts/dflow.sh config tasks-dirs | while IFS= read -r d; do
       find "$d" -mindepth 2 -maxdepth 2 -name state.json 2>/dev/null
     done | while IFS= read -r f; do
       jq -r --arg f "$f" --arg api "$api" 'select(.phase == "reported" or (.phase == "merged" and .unapproved == true))
         | [$f, .tsk, .order, .phase, (if (.api_base // "") == "" then "none" elif .api_base == $api then "same" else "other" end)] | @tsv' "$f"
     done
     ```
     첫째 칸(`$f`)이 그 state.json 의 정확한 경로다(원격의 `$p` 와 같은 역할 — 4번이 그대로 쓴다). glob(`<TASKS>/*/state.json`)을
     쓰지 않는다. 넷째 칸이 `merged` 인 줄은 **승인 전 머지분**이다(`--on-report` 가 `unapproved: true` 를 남겼다). 이미 기본
     브랜치에 들어 있으므로 머지 대상이 아니라 2번의 「승인 전 머지분 판정」 만 받는다. 플래그와 무관하게 늘 본다.
   - **로컬·원격 중복**: 같은 order 가 로컬과 원격에 모두 있으면 로컬 후보 하나로 합쳐 로컬 규칙으로 판정한다. 합친 후보의
     `api_base` 는 값이 있는 쪽을 쓰고(스캔 출력 마지막 칸이 `none` 이 아닌 쪽), 둘 다 값이 있는데 서로 다르면 "건너뜀(다른
     D'Flow)" 로 보고한다. 머지 대상은 증적 head_sha 를 포함하는 쪽(`git merge-base --is-ancestor <증적 head_sha> <그 브랜치>`
     가 참)이고, 그 밖에는(둘 다 포함하거나 증적에 head_sha 가 없으면) 로컬 브랜치 `agent/<id8>-<slug>`, 로컬 브랜치가 없으면
     원격 브랜치다.
   - **`api_base` 필터**: 순서는 중복 제거 → `api_base` 필터다. 후보 state.json 의
     `api_base` 가 현재 `DFLOW_API_BASE`(끝 `/` 제거)와 다르면 로컬이든 원격이든 "건너뜀(다른 D'Flow)" 로 보고한다. 중복 제거 뒤
     남은 원격 후보는 값이 없어도 건너뛴다
     (마지막 칸 `none`·`other`). 값이 없는 로컬 후보(옛 state.json)는 지금처럼 판정한다. `/dflow-team` 팀장은 그런 후보가
     있으면 시작하지 않는다.
   - **서버 조회**: 서버 조회는 state.json 의 전체 UUID 로 한다. show 출력은 jq 로 `.order.status` 와 마지막 `kind=completion`
     리포트의 `review_action`·`review_note`·완료 증적 `head_sha`(4번의 승인 뒤 변경 확인용)만 뽑는다 — spec 본문을 싣지 않는다.
     ```bash
     j=$(.claude/skills/dflow-work/scripts/dflow.sh show <order 전체 UUID>); echo "show=$?"
     printf '%s' "$j" | jq -c '{status: .order.status, last: ([.reports[]? | select(.kind == "completion")] | last | {review_action, review_note, head_sha: .evidence.head_sha})}'
     ```
   - **사전 검사 `scripts/sweep-check.sh`**: 이 1번(두 스캔, 중복 제거, `api_base` 필터)을 서버 조회 없이 흉내 낸다. 출력 계약
     (마지막 줄이 판정, 늘 exit 0): `SWEEP_CANDIDATES n=<N> <id8…>`(후보 있음) · `SWEEP_NONE`(없음 — 이 스킬을 부르지 않는다) ·
     `SWEEP_UNKNOWN <사유>`(판정 못 함 — 스윕을 돌린다). 판정 줄 앞에 `SWEEP_DIALECT_PENDING <sha>` 가 오면 `SWEEP_NONE` 이어도
     「방언 검증」 의 `dialect-check.sh` 를 한 번 부른다. 호출자는 `/dflow-team` 「4-0. 스윕을 부르는 규칙」 과 `/dflow-dev`
     Phase 01-가 다. 이 스킬을 직접 부를 때는 쓰지 않아도 된다. 스크립트는 정본의 **상위 집합**이다(덜 내면 머지가 누락되고,
     더 내면 스윕 한 번이 는다). 이 1번을 바꾸면 스크립트도 같이 고친다 — `tests/skills/dflow-sweep-check.test.ts` 가 위 두 블록과
     스크립트의 후보를 같은 샌드박스에서 대조한다.
2. **판정: approved 만 진행**(`--on-report` 면 승인 대기도): 후보마다 아래 중 하나로 보고한다. 승인 대기나 데이터 없음으로 뭉개지 않는다.
   **approved 확인 전 머지 절대 금지** — 로컬 state 나 기억이 아니라 show 응답이 판정이다.
   예외는 `--on-report` 의 승인 대기 머지 하나뿐이며, 그 판정도 show 응답으로 한다.
   - `status=approved`: 머지 대상.
   - `--on-report` 이고 `status=reported` 이며 마지막 completion 리포트의 `review_action` 이 `reject` 가 아님: 머지 대상
     (**승인 전 머지**). 4번 4단계에서 state.json 에 `unapproved: true` 를 함께 남긴다. 플래그가 없으면 아래 "승인 대기" 다.
   - 마지막 completion 리포트가 `review_action=reject`: "반려: 재작업 필요 (<review_note>)". dflow-dev
     Phase 01 1번의 반려 판정과 같은 기준이다. 반려는 로컬 후보도 state.json 을 고치지 않고 보고만 한다. 이유:
     수동 `/dflow-poll` 의 반려 감지(exit 10)는 로컬 state.json 의 `reported`·`merged` 를 재료로 쓰므로,
     `rejected` 로 바꾸면 그 감지가 사라진다.
   - `status=reported`: "승인 대기".
   - 그 밖의 status: "건너뜀(서버 <status>)".
   - show 가 404(dflow.sh exit 7)이거나 그 밖의 이유로 실패: "건너뜀(조회 실패)".

   **승인 전 머지분 판정**(1번 로컬 스캔의 넷째 칸이 `merged` 인 후보): 절대 다시 머지하지 않는다. 같은 show 로 가른다.
   - `status=approved`: "승인 반영(이미 머지됨)". state.json 에서 `unapproved` 를 지우는 커밋 하나만 기본 브랜치에 올린다
     (4번의 머지 자리·push 실패 처리 그대로, `git merge` 단계만 없다. 커밋 메시지 `chore(<TSK>): approved (승인 전 머지분)`).
     이유: 표식이 남으면 매 스윕이 같은 작업을 다시 show 한다. 머지 자리의 state.json 에 표식이 이미 없으면
     (`jq -e '.unapproved == true'` 가 거짓) 커밋하지 않고 건너뛴다. 호출한 체크아웃이 옛 커밋에 머물러 표식을 계속
     읽어도 기본 브랜치에 빈 커밋이 쌓이지 않게 한다.
   - 마지막 completion 리포트가 `review_action=reject`: "반려(머지됨): 되돌리기 또는 재작업 필요 (<review_note>)". state.json 은
     고치지 않는다. 이유: 반려 재작업(`/dflow-dev` Phase 01 1번)은 로컬 `merged` 와 서버 `claimed` 로 반려를 알아보며, 승인
     뒤 재작업처럼 기본 브랜치에서 새 agent 브랜치를 따 머지된 코드 위에 수정 커밋을 얹는다. 되돌리기(`git revert`)는
     스윕이 하지 않는다. 그 위에 이미 다른 작업이 올라갔을 수 있어 사람이 고른다. 보고에 **그 위에 쌓였을 수 있는 작업**을
     붙인다: 다른 승인 전 머지분 가운데, 그 작업의 첫 산출 커밋이 반려된 작업의 첫 산출 커밋을 조상으로 갖는 것이다.
     ```bash
     git log origin/<기본브랜치> --grep='DFlow-Order: <order>' --format=%H | tail -n 1   # 각 작업의 첫 산출 커밋
     git merge-base --is-ancestor <반려된 작업의 첫 커밋> <다른 작업의 첫 커밋>        # 참이면 그 위에 쌓였을 수 있다
     ```
   - `status=reported`: "승인 대기(머지됨)". 보고만 한다.
   - 그 밖의 status(`claimed` 인데 반려 리포트가 아님 등): "건너뜀(머지됨, 서버 <status>)".
   - show 실패: "건너뜀(조회 실패)".
3. **순서: 스택은 조상 먼저**: 대상이 여럿이면 브랜치 tip 이 아니라 후보 state.json 의 `branch_base` 로 조상
   관계를 판정해 조상부터 머지한다. 선행이 approved 가 아니어서 조상 브랜치를 머지할 수 없으면
   그 위의 후손도 이번엔 머지하지 않는다(선행을 건너뛰고 후손만 합치면 미승인 커밋이 main 에
   섞인다).
   `--on-report` 면 "approved 가 아니어서" 를 "2번의 머지 대상이 아니어서" 로 읽는다(반려·조회 실패 등).
   - `branch_base`(기점 커밋. `/dflow-dev` 「--worker」 B 면 선행 완료 증적의 head_sha)가 없거나
     `origin/<기본브랜치>` 의 조상이면 스택이 아니다.
   - 아니면 스택이며, 선행은 `git merge-base --is-ancestor <branch_base> <그 후보의 머지 대상>` 이 참인 다른
     후보다. 그런 선행 후보가 없으면(기점이 main 에 없는데 그 기점을 가진 후보도 없다) "건너뜀(기점 미반영)" 으로
     보고한다.
   - `branch_base` 가 커밋으로 풀리지 않으면(이 수정 전의 state.json 은 브랜치 이름을 적었을 수 있다) 그
     후보만 지금처럼 브랜치 tip 끼리 `git merge-base --is-ancestor A B` 로 판정한다. 수동 경로가 판정하던 옛
     후보를 거부하면 퇴행이기 때문이다.
   - **차분 백스톱**: `branch_base` 판정과 별도로,
     `git diff --name-only origin/<기본브랜치>...<그 후보의 머지 대상> --` 뒤에 1번과 같이 구성한 pathspec(`dflow.sh
     config tasks-dirs` 의 각 폴더마다 `<그 폴더>/*/state.json`)을 붙인 것에 그 작업 외의 state.json 이 있으면
     그 파일(`git show <그 후보의 머지 대상>:<경로>`)의 `order` 가 가리키는 작업들도 선행으로 보고 위 순서와
     승인 판정에 넣는다. 그 선행이 이번에 머지되지 않았으면 후손을 건너뛰고, 후보에 없으면
     "건너뜀(기점 미반영)" 으로 보고한다. 이유: `branch_base` 는 오케스트레이터가 적는 값이라 빠질 수 있고,
     빠지면 스택이 비스택으로 판정돼 승인되지 않은 선행의 커밋이 main 에 들어간다. 차분에 다른 작업의
     state.json 이 보이는 것은 그 작업의 커밋이 기본 브랜치에 없다는 구조적 증거다.
   - 이유: `/dflow-dev` Phase 06 가 done 뒤 `reported` 를 커밋하므로 선행 tip 은 후속이 기점으로 삼은 커밋보다
     앞서 있어 후속의 조상이 아니다. tip 으로 판정하면 스택을 알아보지 못해, 승인이 철회된 선행 위에 쌓인
     후속만 승인됐을 때 선행의 코드가 main 에 들어간다.
4. **머지**: 먼저 머지 자리를 정한다. 호출한 체크아웃의 현재 브랜치가 `<기본브랜치>` 면 그 체크아웃에서
   머지한다(아래 블록 그대로). 아니면(detached HEAD 이거나 다른 브랜치면) **임시 머지 워크트리** `<W>` 에서
   머지한다(「임시 머지 워크트리」). 이유: git 은 한 브랜치를 워크트리 하나에서만 체크아웃하게 하므로, 기본 브랜치를
   다른 체크아웃이 잡고 있으면 `git switch <기본브랜치>` 가 `already used by worktree` 로 실패한다. 링크드
   워크트리에서 도는 두 번째 `/dflow-team` 팀장이 이 경우다. 수동 사용자가 다른 브랜치에서 불렀을 때도 체크아웃을
   옮기지 않게 된다.
   ```bash
   git fetch origin && git switch <기본브랜치> && git pull --ff-only origin <기본브랜치>
   git rev-parse HEAD                      # 머지 직전 HEAD. 값을 기록해 둔다
   git merge-base --is-ancestor <증적 head_sha> <머지 대상>   # 증적에 head_sha 가 있을 때만. 0 이 아니면(커밋이 없거나 조상이 아님) 머지하지 않는다
   git diff --name-only <증적 head_sha>..<머지 대상>   # 증적에 head_sha 가 있을 때만. 실패하면 머지하지 않고, 그 작업의 state.json 뿐이거나 비어 있어야 머지한다
   git merge --no-ff <머지 대상> -m "merge: <TSK> <제목> (approved)" -m "DFlow-Order: <order>"   # 로컬 후보 agent/<id8>-<slug>, 원격 전용 후보 origin/agent/<id8>-<slug>. 승인 전 머지는 (reported, 승인 전). <order> 는 그 후보 state.json 의 order. git merge 는 --trailer 를 모른다(git commit 전용) — 둘째 -m 이 빈 줄 뒤 문단이 되어 트레일러로 인식된다
   .claude/skills/dflow-merge/scripts/decisions.sh renumber --tsk <TSK> --order <order>   # 「결정 번호 매김」. 임시 ID 가 없으면 NO_TEMP_IDS 로 아무것도 하지 않는다
   git add "<후보 state.json 경로>" && git commit -m "chore(<TSK>): phase=merged" \
     && git push origin <기본브랜치>   # state.json 을 phase=merged 로 고친 뒤 push. add·commit 이 실패하면(경로 없음 등) && 사슬이 끊겨 push 하지 않는다
   ```
   후보마다 다음 순서로 한다.
   1. `git fetch origin && git switch <기본브랜치> && git pull --ff-only origin <기본브랜치>` 뒤 머지 직전
      HEAD 를 기록한다.
   2. **승인 뒤 변경 확인**(승인 전 머지면 "보고 뒤 변경 확인"이며 규칙은 같다. 증적은 완료 보고의 것이다): 증적 head_sha 가 로컬에 있고 머지 대상의 조상이며
      (`git merge-base --is-ancestor <증적 head_sha> <머지 대상>` 이 참), `git diff --name-only <증적 head_sha>..<머지 대상>`
      이 성공해 그 작업의 `<TASKS>/<TSK>/state.json` 뿐이거나 비어 있으면 머지한다. 다른 파일이 있으면
      "건너뜀(승인 뒤 변경)", head_sha 가 로컬에 없거나 머지 대상의 조상이 아니거나 `git diff` 가 실패하면
      "건너뜀(승인 뒤 변경 확인 불가)" 로 보고한 뒤 다음 후보로 간다. `<증적 head_sha>` 는 1번 show 출력의
      `head_sha` 다. 이유: 원격 후보를 받으므로 승인 뒤 같은 agent 브랜치에 올라온 커밋까지 머지 대상이 되는데,
      사람이 승인한 것은 증적의 head_sha 까지다. tip 이 head_sha 와 같은지만 보면 `/dflow-dev` Phase 06 의
      `reported` 커밋 때문에 늘 다르다. 확인하지 못한 경우를 건너뛰는 이유: `git diff` 가 오류로 끝나면 출력이
      비어 "비어 있으면 머지" 로 읽히기 때문이다. 증적에 `head_sha` 자체가 없는 옛 완료 보고는 이 확인을
      건너뛰고 지금처럼 머지하되 보고에 "승인 뒤 변경 확인 불가" 를 붙인다. 수동 경로가 머지하던 후보를
      거부하면 퇴행이기 때문이다.
      **강제 진행 스텁 관문**: 개발 브랜치와 운영 브랜치가 같으면(`dflow.sh branch dev` 와 `dflow.sh branch release` 가 같은 값)
      머지 전에 `dflow.sh stub-check <머지 대상>` 을 돌린다. exit 4 면 머지하지 않고 「스텁 잔존 — 개발 브랜치 미설정 리포라
      운영에 스텁이 들어간다」 로 보고한 뒤 다음 후보로 간다(스펙 2026-09-23 §4). 두 브랜치가 다르면 이 검사를 하지 않는다 —
      스텁은 개발 브랜치에 머지되는 것이 정상이고(F5), 관문은 운영 승격이다.
      **마이그레이션 버전 관문**: 머지 전에 `.claude/skills/dflow-merge/scripts/migration-check.sh HEAD <머지 대상>` 을 돈다
      (「마이그레이션 버전 관문」, 임시 머지 워크트리면 `-C "$W"`). exit 1(버전 중복·역순 도착)이면 머지하지 않고
      `머지 실패(충돌) <MIGRATION_FILES 의 파일,…> (마이그레이션 버전)` 으로 보고한 뒤 다음 후보로 간다 — 팀장은 텍스트 충돌과
      똑같이 해소 워커에 넘긴다. exit 2(판정 불가)면 머지하지 않고 "건너뜀(마이그레이션 검사 실패)" 로 보고한다.
   3. `git merge --no-ff <머지 대상>`. 충돌하면 먼저 공용 결정 기록(`decisions.md`)의 충돌만 스크립트로 푼다(「결정 번호
      매김」). 남은 충돌이 없으면 `git commit --no-edit --cleanup=strip` 으로 머지를 완성하고 3-1 로 간다(`-m` 두 문단과
      트레일러는 `MERGE_MSG` 에 남아 있고, `--cleanup=strip` 이 git 이 덧붙인 `# Conflicts:` 주석을 지운다).
      남은 충돌이 있으면 그 목록을 읽은 뒤 `git merge --abort` 로 되돌리고 "머지 실패(충돌)" 로
      보고한 뒤 다음 후보로 간다. 이유: 충돌 상태로 남으면 체크아웃이 더러워져, 팀장이면 이후 모든
      기상이 전제 검사에서 멈추고 수동이면 사람이 그 상태를 치워야 한다. 사람이 그 자리에서 충돌을
      손으로 풀어 `git merge --abort` 대신 직접 `git commit` 으로 머지를 완성하는 경로도 있다 — 이
      경로에도 아래 트레일러 규칙이 그대로 적용된다. "자동 스윕이 아니다" 는 트레일러를 빠뜨릴
      이유가 되지 않는다.
      충돌 파일 목록은 `--abort` **전에** 읽는다(뒤에는 비어 있다). 보고 줄은 `머지 실패(충돌) <파일,…>` 다(스크립트가
      푼 decisions.md 는 빠진다). 임시 머지 워크트리에서는 git 명령을 `git -C "$W"` 로, 스크립트를 `-C "$W"` 를 붙여 부른다.
      ```bash
      .claude/skills/dflow-merge/scripts/decisions.sh merge-conflicts   # 공용 decisions.md 충돌만 푼다. DECISIONS_RESOLVED·DECISIONS_LEFT
      git diff --name-only --diff-filter=U | paste -sd, -   # 남은 충돌 파일 목록(쉼표로 이음). 비었으면 아래 commit, 아니면 --abort
      git merge --abort
      ```
      ```bash
      git commit --no-edit --cleanup=strip   # 남은 충돌이 없을 때만. 머지 완성
      ```
   3-1. **결정 번호 매김**: 머지 커밋 뒤 `decisions.sh renumber --tsk <TSK> --order <order>` 를 돈다(「결정 번호 매김」).
      `NO_TEMP_IDS` 면 커밋이 생기지 않는다. `COMMITTED <sha>` 면 번호 매김 커밋 하나가 머지 커밋 위에 생긴다(5단계
      push 에 함께 실린다). `RENUMBER_DIRTY`·`RENUMBER_FAILED …` 는 머지를 막지 않는다 — 스크립트가 자기 변경을 되돌린
      채 끝나므로 그대로 4단계로 가고 보고에 "결정 번호 매김 실패(<출력>)" 를 붙인다. 임시 ID 는 트리에 남고 다음 머지의
      번호 매김이 트리 전체를 다시 훑어 매긴다. `UNION_SET <파일>` 이 나오면 보고에 붙인다. 같은 호출이 전역 번호 중복도
      바로잡는다(「결정 번호 매김」 의 **전역 번호 중복**) — `DUP_RENUMBERED`·`DUP_REF_REPLACED`·`DUP_REF_AMBIGUOUS`·`DUP_LEFT`·
      `DECISIONS_SEQ` 줄이 나오면 그대로 보고에 싣는다. 이 줄들은 머지를 막지 않는다. 단 중복 바로잡기는 임시 ID 와 달리
      다음 머지가 다시 해 주지 않는다 — 실패한 머지가 남긴 중복은 다음 머지에서 둘 다 개발 브랜치 쪽이 되어
      `DUP_LEFT … dev-side` 로만 나온다. 번호 매김이 실패했는데 그 머지에 중복이 있었으면 "결정 번호 중복 — 사람이 고쳐야 함" 으로 보고한다.
   4. state.json 을 `phase=merged` 로 갱신해 기본 브랜치에 커밋한다(파일명 명시). `<후보 state.json 경로>` 는
      **1번 후보 식별이 이미 찾은 그 경로다**(로컬 후보는 스캔이 낸 `$f`, 원격 후보는 스캔이 낸 `$p` — 위 1번의
      여섯째 칸). 여기서 `dflow.sh taskdir` 를 다시 부르지 않는다. 이유: 서버 호출이 실패하거나 예상 밖의 빈
      값을 돌려주면 `git add "/state.json"` 처럼 저장소 루트 바로 아래 엉뚱한 경로를 stage 하는 사고로
      번질 수 있다 — 이미 아는 값을 그대로 쓰면 그럴 일이 없다. `git add` 가 실패하면(경로가 비었거나, 그
      파일이 이 시점의 트리에 없거나, stage 되지 않으면) **커밋·push 하지 않고** "머지 실패(state.json 경로)"
      로 보고한 뒤 다음 후보로 간다. 이 커밋을 **push 전에** 만든다.
      승인 전 머지면 같은 커밋에서 `unapproved: true` 를 함께 넣는다. `phase` 를 `merged` 가 아닌 새 값으로
      만들지 않는 이유: `/dflow-dev` 「--worker」 행 G 의 기본 브랜치 반영 확인이 `phase` 가 `merged` 인지를 보고,
      `poll.sh` 의 반려 감지도 `reported|merged` 만 훑는다. 새 값을 쓰면 후속이 여전히 `skipped` 로 끝나고 반려도
      감지되지 않는다.
   5. `git push origin <기본브랜치>` 로 머지와 `merged` 커밋을 한 번에 올린다. push 가 실패하면 먼저
      `git reset --keep <기록한 HEAD>` 로 되돌리고, 거부 모양으로 가른다.
      - 출력에 `non-fast-forward` 나 `fetch first` 가 있으면 경합이다. "push 실패(경합)" 로 보고하고 스윕을
        멈춘다. 다음 실행은 fetch 부터 다시 한다. 이유: 다른 스윕이 먼저 머지한 것이라 fetch 부터 다시 해야
        후보가 맞다.
      - 그런 문구 없이 1 로 끝나면 훅 거부다(로컬 pre-push 훅은 고정 문구 없이 훅 출력과
        `failed to push some refs` 만 남긴다). "push 실패(훅)" 로 보고하고 그 작업과 그 후손(3번의 스택 관계)만
        빼고 다음 후보로 간다. 이유: 훅이 막은 작업은 사람이 풀 때까지 매번 막히므로 그 한 건이 뒤의
        승인분까지 막으면 안 되며, `/dflow-dev` Phase 01-가 의 원문도 이 작업만 건너뛰고 스윕을 계속했다.
      - 그 밖의 실패(128 등 연결·권한 오류)는 "push 실패" 로 보고하고 스윕을 멈춘다. 원인을 모르는
        실패에서 머지를 계속 시도하지 않는 것이 지금 동작이기 때문이다.

      `origin` 으로 리셋하지 않는다. 이유: 수동 사용자의 기본 브랜치에 있던 미push 커밋을 보호한다. 훅 거부를
      우회하지 않는 것은 그대로다.
   `--no-ff` 고정 — 작업 단위 경계가 머지 커밋으로 남아야 추적이 된다. push 가 훅에 거부되면
   우회 금지. 되돌리고 보고한 뒤 그 작업과 후손만 빼는 절차는 위 5단계다.

   **트레일러 고정**: 이 스윕이 만드는 모든 머지 커밋에는 `DFlow-Order: <order>` 트레일러를 붙인다
   (`<order>` 는 그 후보 `<TASKS>/<TSK>/state.json` 의 `order`, 주문 UUID). 붙이는 방법은 커밋 방식마다
   다르다 — `git merge` 에는 `--trailer` 가 없으므로(`git commit` 전용 옵션이다) 3단계의
   `git merge --no-ff` 는 위 블록처럼 둘째 `-m "DFlow-Order: <order>"` 로 붙인다(빈 줄 뒤 단독 문단이
   트레일러로 인식된다). 충돌을 손으로 풀어 직접 `git commit` 으로 머지를 완성할 때는 `git commit --trailer
   "DFlow-Order: <order>"` 를 그대로 쓴다. 어느 경로든 결과 메시지에 이 트레일러가 실려야 하는 것은 같다.
   이 트레일러가 `/dflow-dev` 「--worker」 행 G 의 기본 브랜치 반영 확인이 보는 증거 중 하나이며, 부착이
   우연에 맡겨지면 실제로 반영된 선행도 후속 워커가 승인 대기로 오판한다(2026-09-22 mdm-dict-v2 실측:
   선행 4건 TSK-03-07·03-09·03-11·03-12 가 origin/main 에 머지됐는데 트레일러가 0건이라 후속 3건
   TSK-03-10·03-13·04-01 이 모두 막혔다).

   **임시 머지 워크트리**: 호출한 체크아웃이 기본 브랜치에 있지 않을 때 쓴다. 스윕을 시작할 때 한 번 만들고
   끝날 때 지운다. `<ROOT>` 는 호출한 체크아웃의 `git rev-parse --show-toplevel` 이다.
   ```bash
   W="<ROOT>/.claude/worktrees/dflow-merge"
   ex=$(git rev-parse --git-path info/exclude); mkdir -p "$(dirname "$ex")"; touch "$ex"
   grep -qxF '**/.claude/worktrees/' "$ex" || printf '%s\n' '**/.claude/worktrees/' >> "$ex"
   git worktree remove --force "$W" 2>/dev/null; rm -rf "$W"; git worktree prune
   git fetch origin && git worktree add --detach "$W" origin/<기본브랜치> || echo MERGE_WT_FAILED
   echo "W=$W"
   ```
   - `MERGE_WT_FAILED` 면 이번 스윕은 아무것도 머지하지 않고 "머지 워크트리 생성 실패" 로 보고한다.
   - **`$W` 를 쓰는 뒤 호출은 모두 아래 가드 줄로 시작한다.** Bash 호출 사이에는 셸 변수가 남지 않는다.
     빈 `$W` 로 `git -C "" …` 를 부르면 git 은 호출한 체크아웃에서 돈다 — 사용자 브랜치에 머지하고, 그것을
     `HEAD:<기본브랜치>` 로 push 하고, 실패하면 `reset --hard` 로 그 체크아웃을 되돌린다. 가드는 `$W` 를 같은
     규칙(`<ROOT>` = 호출한 체크아웃의 최상위)으로 다시 구하고, 워크트리가 없으면 아무것도 하지 않고 멈춘다.
     ```bash
     W="$(git rev-parse --show-toplevel)/.claude/worktrees/dflow-merge"; [ -e "$W/.git" ] || { echo NO_MERGE_WT; exit 1; }
     ```
     `NO_MERGE_WT` 면 그 후보를 처리하지 않고 "머지 워크트리 없음" 으로 보고한 뒤 스윕을 멈춘다.
   - `decisions.sh`(3·3-1단계)는 호출한 체크아웃 최상위에서 그 체크아웃의 스킬 경로로 부르고 `-C "$W"` 를 붙인다
     (예: `.claude/skills/dflow-merge/scripts/decisions.sh renumber -C "$W" --tsk <TSK> --order <order>`). `<W>` 에는 스킬이
     없을 수 있기 때문이다(gitignore 된 심링크로 배포한 리포).
   - 후보마다 위 1~5를 `<W>` 에서 한다. 달라지는 것은 셋뿐이다. 설정 블록과 같은 호출 안에서 이어 돌 때만
     가드 없이 `$W` 를 그대로 쓴다. 아래 `<W>`·`"$W"` 는 가드 줄이 구한 값이다.
     1. 1단계는 `git -C "$W" fetch origin && git -C "$W" switch --detach origin/<기본브랜치>` 다. `pull` 대신
        detach 하는 이유: `<W>` 는 브랜치를 잡지 않는다. 그 뒤 `git -C "$W" rev-parse HEAD` 를 머지 직전 HEAD 로 기록한다.
     2. 4단계의 state.json 은 `<W>/<후보 state.json 경로>` 를 고쳐 `<W>` 에서 커밋한다(같은 경로 재사용 규칙).
     3. 5단계는 `git -C "$W" push origin HEAD:<기본브랜치>` 다. 실패하면 `git -C "$W" reset --hard <기록한 HEAD>` 로
        되돌리고 같은 규칙(경합·훅·그 밖)으로 가른다. `--keep` 대신 `--hard` 를 쓰는 이유: `<W>` 는 이 스윕만 쓰는
        임시 트리라 지킬 미커밋 변경이 없다.
   - 5번 뒷정리의 로컬 `git branch -d` 도 `git -C "$W"` 로 한다. `-d` 는 브랜치가 현재 HEAD 에 머지됐는지 보는데,
     머지 커밋은 `<W>` 의 HEAD 에만 있기 때문이다.
   - 스윕이 끝나면(멈춘 경우 포함) `git worktree remove --force "$W"` 로 지운다. 로컬 브랜치 저장소는 모든
     워크트리가 함께 쓰므로 `<W>` 를 지워도 머지·삭제 결과는 남는다.
   - 호출한 체크아웃은 건드리지 않는다. 팀장처럼 detached HEAD 로 도는 체크아웃은 스윕 뒤 스스로
     `origin/<기본브랜치>` 로 다시 detach 해 최신을 따른다(`/dflow-team` 「4. 승인 스윕」).
5. **뒷정리** (머지된 작업마다):
   - 머지된 `agent/` 브랜치를 지운다. 원격 agent 브랜치 삭제(`git push origin --delete agent/<id8>-<slug>`)는
     그대로 한다. 로컬 삭제(`git branch -d agent/<id8>-<slug>`)는 브랜치가 없거나(not found) 다른 워크트리가
     잡고 있으면(checked out) 건너뛰고 보고한다. 원격 전용 후보에는 로컬 브랜치가 없고, 팀원 워크트리가 그
     브랜치를 잡고 있을 수 있기 때문이다. 아직 미승인 후손 스택 브랜치는 **삭제·rebase
     하지 않는다** — 이미 머지된 커밋을 조상으로 포함하므로 그대로 두면 제 차례에 깨끗이 머지된다.
6. **보고**: 머지됨 / 머지됨(승인 전) / 승인 반영(이미 머지됨) / 승인 대기 / 승인 대기(머지됨) / 반려: 재작업 필요 (<review_note>) /
   반려(머지됨): 되돌리기 또는 재작업 필요 (<review_note>, 그 위에 쌓였을 수 있는 작업) / 머지 실패(충돌) <파일,…> / push 실패(경합) /
   push 실패(훅) / push 실패 / 건너뜀(서버 <status>·조회 실패·다른 D'Flow·조상 미승인·기점 미반영·승인 뒤 변경·
   승인 뒤 변경 확인 불가·마이그레이션 검사 실패·로컬 브랜치 삭제 건너뜀)을 표로. 반려·머지 실패(충돌)·push 실패(훅)는 id8 과 함께 따로
   적는다. 반려(머지됨)도 따로 적는다. 호출자(`/dflow-team` 팀장 등)가 이 목록으로 후속 처리를 한다.
   머지된 작업에 3-1단계의 번호 매김 결과(`D-TSK-…→D-NNN`, `DUP_RENUMBERED` 로 중복을 옮겼으면 `D-050→D-053(중복)`)가 있으면 그 줄에 붙이고,
   "결정 번호 매김 실패(<출력>)"·`UNION_SET <파일>`·`DUP_REF_REPLACED`·`DUP_REF_AMBIGUOUS`(사람이 볼 위치)·`DUP_LEFT`·
   `DECISIONS_SEQ` 줄은 표 아래에 그 작업 id8 과 함께 그대로 적는다.
   보고를 쓰기 전에 「방언 검증」 을 한 번 돈다(스윕이 중간에 멈췄어도 돈다. 머지가 0건이어도 돈다 — 보류된 커밋을
   다시 시도한다). 결과 줄(`DIALECT_*`)과 `DIALECT_UNVERIFIED` 줄을 표 아래에 그대로 싣는다.

## 방언 검증

여러 Task 가 같은 목적으로 도는 도커 검증(Testcontainers MSSQL 같은 DB 방언 검증)은 워커가 하지 않는다. 워커는 도커를
쓰지 않는 것이 기본이라(dev-discipline 「도커 사용 규칙」, 정본) 그 검증을 생략하고 `도커 금지로 생략:` 으로 보고한다.
대신 개발 브랜치에 머지된 뒤 이 스윕이 **스윕 한 번에 한 번, 마지막 머지 커밋(스윕 끝의 `origin/<기본브랜치>`)에서** 돌린다.
머지마다 돌리지 않는다. 이유: 2026-09-24 dmes-standard 에서 워커마다 같은 방언 검증 컨테이너를 따로 띄워 16GB PC 가
load 52 까지 밀렸다. 같은 목적의 컨테이너는 한 곳에 모아 한 번만 띄운다.

- **명령**: 대상 리포 설정의 `dialect_check` 다(`dflow.sh config dialect_check`). `.dflow`(리포 공통)에 적고, PC 전용
  값(JAVA_HOME 등)이 든 명령은 `.dflow.local` 이 덮는다(export 된 `DFLOW_DIALECT_CHECK` 가 둘 다 덮는다). 키가 없으면 이
  단계는 없다(`DIALECT_NONE`). 값은 임시 워크트리의 최상위에서 `bash -c` 로 돌므로 `cd <폴더> && VAR=값 <명령>` 형태를
  그대로 받는다. 예: `dialect_check=cd src/backend/mdm && ../gradlew :api:mssqlMigrationTest --no-daemon --console=plain`.
  설정 파일은 값 뒤의 ` #…` 를 주석으로 자르므로 명령에 ` #` 를 쓰지 않는다. 임시 워크트리에는 추적 파일만 있다
  (`.dflow.local`·`node_modules`·빌드 산출물 없음). 준비가 필요하면 명령 안에 넣는다(예 `npm ci && npm run test:mssql`).
- **돌리는 법**: 스윕 시작의 `git fetch origin` 직후 `git rev-parse origin/<기본브랜치>` 를 `<스윕 전 sha>` 로 기록해 두고,
  보고 직전에 호출한 체크아웃의 최상위에서 한 번 부른다.
  ```bash
  .claude/skills/dflow-merge/scripts/dialect-check.sh run --dev <기본브랜치> --sweep-base <스윕 전 sha>; echo "rc=$?"
  ```
  스크립트가 origin 을 다시 fetch 해 끝 커밋을 정하고, 그 커밋에 detach 한 **깨끗한 임시 워크트리**
  (`<ROOT>/.claude/worktrees/dflow-dialect-<pid>`)에서 돌린 뒤 지운다. 호출한 체크아웃(팀장 체크아웃)은 건드리지 않는다.
  명령은 `heavy.sh --pool docker` 로 감싸 PC 전역 **도커 슬롯**(도커가 허용된 워커와 같은 슬롯)과 일반 슬롯을 함께 잡은
  동안에만 돈다. 컨테이너 재사용(Testcontainers reuse·외부 DB 주소 등)은 대상 리포의 테스트 설정이 정하는 대로 따른다.
- **도커 런타임을 켜지 않는다.** `docker info`(`DFLOW_DOCKER_PROBE` 로 바꾼다)가 실패하면 돌리지 않고
  `DIALECT_DEFERRED docker-off <sha> notify=<0|1>` 로 보류를 기록한다. 같은 커밋은 다음 스윕이 다시 시도한다. `notify=1` 은
  그 커밋의 첫 보류라는 뜻이다(사람에게 알린다).
- **판정은 커밋마다 한 번**: 상태는 `<git-common-dir>/dflow-dialect/<브랜치>.state` 에 남는다(`last_pass`·`last_fail`·
  `deferred`·`last_result`). 끝 커밋이 마지막 통과·실패 커밋과 같으면 돌리지 않는다(`DIALECT_SKIP`). 도커 슬롯이 차 있으면
  `DIALECT_BUSY`(exit 75)이고 기록하지 않는다 — 다음 스윕이 다시 시도한다. 같은 브랜치의 검증이 아직 돌고 있으면
  `DIALECT_RUNNING` 이다. 명령이 exit 126·127·128 이상(실행 불가·명령 없음·시그널로 죽음 — 잘못된 JAVA_HOME, OOM kill
  등)으로 끝나면 코드 판정이 아니므로 실패로 기록하지 않고 `DIALECT_ERROR exit=<n> <sha> notify=<0|1> log=<로그>` 로 낸다.
  다음 스윕이 같은 커밋을 다시 시도한다(`baseline.sh` 가 같은 exit 를 저장하지 않는 것과 같은 규칙). 죽은 앞 호출이 남긴
  임시 워크트리는 다음 호출이 치운다.
- **실패**: `DIALECT_FAIL <sha> exit=<n> since=<직전 통과> tasks=<그 뒤 머지된 Task…> unverified=<…> log=<로그>`. tasks 는
  직전 통과 커밋(없으면 스윕 전 sha) 이후 개발 브랜치에 머지된 Task 다(머지 커밋 제목 `merge: <TSK> …`). 자동으로 되돌리거나
  Task 를 재오픈하지 않는다 — 보고만 한다.
- **확인하지 못한 항목 대조**: 같은 범위에서 design.md·resolution.md 에 `도커 금지로 생략:`·`확인하지 못한 수용 기준:` 줄을
  남긴 Task 를 결과 줄 앞에 `DIALECT_UNVERIFIED <TSK> 생략=<n> 미확인=<m> <파일>` 로, 결과 줄에 `unverified=` 로 적는다.
  통과든 실패든 싣는다 — 워커가 도커 금지로 확인하지 못한 수용 기준을 이 결과와 사람이 대조한다.
- 결과는 출력하기 전에 상태 파일에 먼저 적는다. 호출이 10분을 넘겨 백그라운드로 옮겨지거나 결과를 놓쳤으면
  `dialect-check.sh status --dev <기본브랜치>` 가 마지막 결과를 다시 낸다.
- `--resolve` 는 이 절을 타지 않는다(해소 머지 한 건은 스윕이 아니다). 호출자(`/dflow-team` 팀장)의 보고·기록 방법은
  그 스킬의 「4. 승인 스윕」 이다.

## 결정 번호 매김

대상 리포의 공용 결정 기록(`docs/<모듈>/decisions.md` 등)은 `## D-NNN (<UTC 타임스탬프>)` 블록을 추가만 하는 감사
기록이다(형식은 dflow-wbs `decision-log.py`, `validate` 는 D-001 부터 끊김 없는 순번을 요구). agent 브랜치는 전역 번호를
매기지 않고 Task 범위 임시 ID `D-<TSK>-<n>` 을 쓴다(dev-discipline 「공용 결정 기록(decisions.md)의 번호」). 번호는
개발 브랜치에 들어가는 순서로만 정해지므로 머지하는 이 스킬이 매긴다. 도구는 `.claude/skills/dflow-merge/scripts/decisions.sh`
하나이며, 머지 자리의 최상위에서 돈다(임시 머지 워크트리면 `-C "$W"`).

- **충돌 풀기**(`merge-conflicts`, 4번 3단계·해소 머지 4번): 머지가 멈추면 충돌한 decisions.md 만 푼다. 결과는 개발
  브랜치 쪽 파일 전체 뒤에, 머지 대상이 merge-base 에 없던 블록을 그 순서대로 붙인 것이다. 두 쪽이 모두 파일 끝에 블록을
  더해 늘 충돌하던 모양이 이것으로 풀린다. 머지 대상이 기존 블록을 고쳤거나(추가만 하는 기록의 위반) 한쪽이 파일을
  지웠으면 풀지 않고 `DECISIONS_LEFT` 로 둔다 — 그 파일은 다른 충돌과 같이 다룬다.
- **번호 매김**(`renumber`, 4번 3-1단계·해소 머지 6번 뒤): 트리 전체에서 임시 ID 머리를 그 파일의 다음 전역 번호로
  바꾸고(머리 순서대로), 바로 아래 `- **Temp ID**: <임시 ID>` 줄을 남기며, 추적 파일 전체(`.claude/` 는 제외 — 킷 복사형
  리포에서 스킬 문서의 예시 ID 가 실제 Task ID 와 겹쳐도 킷이 바뀌지 않게)의 같은 임시 ID 참조를 바꿔
  커밋 하나(`chore(<TSK>): 결정 번호 매김 (…)`, 트레일러 `DFlow-Order`)로 남긴다. 임시 ID 가 없으면 아무것도 하지 않는다
  (`NO_TEMP_IDS`). `Temp ID` 줄 덕분에 스택 후손이 선행의 임시 ID 를 적어 뒀어도 뒤 머지에서 찾아 바꾼다. 같은 임시 ID
  머리가 둘 이상이면 그 ID 만 건너뛰고(`RENUMBER_DUP`) 나머지는 매긴다 — 개발 브랜치에 남은 잘못 하나가 뒤의 머지를 모두
  막지 않게 한다. `decision-log.py` 의 형식·validate 는 바꾸지 않는다(`Temp ID` 는 선택 필드로 읽힌다).
- **전역 번호 중복**(`renumber` 의 첫 단계): 옛 규칙을 읽은 워커나 사람이 전역 번호를 직접 매기면, 같은 기점의 두 브랜치가
  같은 `## D-050` 을 들고 온다(2026-09-24 dmes-standard TSK-08-01·TSK-04-03 이 둘 다 D-050~052 — `merge-conflicts` 가 두 쪽
  블록을 그대로 붙였고 팀장이 손으로 고쳤다, 86baa20). git 이 두 추가를 다른 위치로 보면 충돌 없이도 합쳐지므로, 충돌 여부와
  무관하게 머지 커밋 뒤 `renumber` 가 본다. 머지 중의 `MERGE_HEAD` 는 커밋 뒤라 없으므로 **HEAD 가 머지 커밋일 때 HEAD^1 =
  머지 전 개발 브랜치, HEAD^2 = 머지 대상(그때의 MERGE_HEAD)** 으로 읽고 merge-base 는 그 둘에서 구한다(충돌 경로·충돌 없는
  경로·해소 머지가 모두 이 자리를 지난다). 파일마다 따로 본다(decisions.md 끼리 번호는 독립).
  - 개발 브랜치 쪽 블록은 그대로 둔다. 머지 대상이 더한 블록(머리 줄이 HEAD^2 판에 있고 merge-base 판·HEAD^1 판에 없는 것)
    가운데 번호가 겹친 것만 그 파일의 다음 전역 번호로 옮겨 파일 끝에 두고(개발 브랜치 블록의 순서는 바꾸지 않는다 —
    `merge-conflicts` 가 머지 대상 블록을 끝에 붙이는 것과 같다), 머리 바로 아래 `- **Renumbered from**: D-050 (중복 번호)`
    줄을 남긴다(validate 는 선택 필드로 읽는다). 출력 `DUP_RENUMBERED D-050=D-053 <파일>`, 커밋 제목 `D-050→D-053(중복)`.
  - 같은 파일 안에서는 머지 대상 블록(옮긴 것·안 옮긴 것)의 본문 참조만 새 번호로 바꾼다. 다른 파일은 **리포 전체가 아니라**
    머지 대상이 더하거나 바꾼 파일(`merge-base..HEAD^2`)만 바꾼다 — 같은 문자열이 개발 브랜치 쪽 결정도 가리키기 때문이다
    (`DUP_REF_REPLACED <파일> D-050→D-053,…`). 개발 브랜치도 바꾼 파일(`dev-changed`)·다른 decisions.md(Task 폴더 기록은
    자기 번호를 쓴다, `decisions`)·merge-base 판에 이미 그 번호가 있던 파일(`base-mention`)·한 번호가 둘로 옮겨졌거나 머지 대상의
    다른 decisions.md 에도 같은 번호 머리가 있는 경우(`ambiguous`)는 바꾸지 않고 `DUP_REF_AMBIGUOUS <파일>:<줄> D-050 <사유>`
    로 위치만 알린다 — 사람이 본다.
  - 바로잡지 못한 중복은 `DUP_LEFT <파일> D-NNN <사유>` 다: `not-a-merge`(HEAD 가 머지 커밋이 아님)·`dev-side`(개발 브랜치에
    이미 같은 번호가 둘)·`ambiguous-refs`(머지 대상끼리 겹쳐 참조를 바꾸지 않음) 등.
  - 겹치지 않은 직접 번호(다음 번호라 우연히 안 겹친 것)는 건드리지 않는다. 그 번호가 순번을 건너뛰었거나 앞뒤가 바뀌어
    validate 가 실패할 모양이면 `DECISIONS_SEQ <파일> at=<i> found=D-NNN want=D-NNN` 으로 알리기만 한다(이번 머지·이번 실행이
    바꾼 결정 기록만 본다). 번호를 바꾸면 겹치지 않은 결정의 참조까지 흔들리고, 블록을 옮기면 추가만 하는 기록의 순서를
    바꾸기 때문이다. 사람이 판단해 새 블록으로 정정한다.
- **`merge=union` 을 걸지 않는다.** union 은 두 쪽 블록을 모두 남기지만, 블록끼리 같은 필드 줄(`- **Phase**: design`,
  `- **Reversible**: yes`)을 공유하면 줄을 맞춰 합치면서 한 블록의 줄이 사라지고 두 머리가 붙는다(샌드박스 실측, wbs-web 리포
  `tests/skills/dflow-merge-decisions.test.ts`). 충돌을 내게 두고 위 `merge-conflicts` 가 블록 단위로 푸는 편이 안전하다.
  이미 걸려 있으면 `renumber` 가 `UNION_SET <파일>` 로 알린다. 대상 리포 `.gitattributes` 에서 그 줄을 빼라고 보고한다.

## 마이그레이션 버전 관문

Flyway 처럼 파일명이 곧 버전인 마이그레이션(`V<버전>__<설명>.sql`)은 병렬 브랜치가 같은 다음 번호를 고르면 파일명이 달라
**git 충돌 없이** 머지되고, 개발 브랜치에서 Flyway 가 `more than one migration with version N` 으로 기동에 실패한다
(2026-09-24 dmes-standard mdm: TSK-04-02 의 `V4__term_abbr_index_relax` 가 개발 브랜치의 `V4__create_mdm_interface_layout` 과
겹쳤고, 다른 Task 셋도 V5 를 고를 참이었다). 텍스트 충돌이 아니므로 해소 워커도 잡지 못했다. 그래서 머지 전에 합친 트리를
검사하고, 걸리면 충돌로 취급해 해소 워커(`--resolve`, `resolve-prompt.md` 「해소 규약」 R9)가 다음 번호로 재채번하게 한다.

도구는 `.claude/skills/dflow-merge/scripts/migration-check.sh` 다. 마이그레이션 폴더는 파일 패턴으로 찾고(폴더 설정을 읽지
않는다), 폴더별로 두 가지를 본다.
- **버전 중복**: 같은 폴더에 같은 버전이 둘 이상이고 그중 하나가 이 브랜치가 추가한 파일이다(`MIGRATION_DUP`). 개발
  브랜치 자체의 중복은 경고(`MIGRATION_DEV_DUP`)만 하고 이 머지를 막지 않는다.
- **역순 도착**: 이 브랜치가 추가한 버전이 그 폴더의 개발 브랜치 최대 버전보다 작다(`MIGRATION_ORDER`, 같으면 중복).
  Flyway 기본값 `outOfOrder=false` 에서는 이미 더 높은 버전을 적용한 개발 DB 가 그 파일을 거부한다. 대상 리포가
  `outOfOrder=true` 로 운영하면 팀장 세션 환경에 `DFLOW_MIGRATION_OUT_OF_ORDER=1` 을 두어(또는 `--allow-out-of-order`) 이 검사만
  끈다. 중복 검사는 끄지 않는다.

버전 비교는 Flyway 규칙이다(`_` 는 `.` 과 같고 부분마다 숫자로, 앞의 0 과 끝의 0 부분은 무시 — `V04`·`V4_0`·`V4.0` 은 `V4`).
폴더 단위로 묶는 이유: 방언별 폴더(`…/mdm/sqlite`·`…/mdm/mssql`)가 같은 버전을 나란히 두는 것이 정상이다. `R__`(반복)·`U`
(undo) 파일은 보지 않는다.

- 스윕(4번 2단계): `migration-check.sh HEAD <머지 대상>` — 머지 대상이 merge-base 이후 추가한 파일을 본다.
- 해소 머지(`references/resolve.md` 4·5번): `migration-check.sh --staged` — 커밋 없이 머지한 index 에서 HEAD 에 없는 추가 파일을 본다.

## 해소 머지(`--resolve`)

`--resolve`(해소 워커)일 때만 `references/resolve.md` 를 읽고 그 절차(「해소 머지」)를 따른다. 스윕·수동 사용은 읽지 않는다.

## 금지

- approved 아닌 작업의 머지(reported·claimed 포함). 서버 approve 시도.
  예외는 `--on-report` 의 반려되지 않은 `reported` 하나뿐이다. 반려된 작업·`claimed`·승인 전 머지분의 재머지는 플래그가
  있어도 금지.
- force push. 훅 우회(SKIP_GUARD).
- 머지 순서 뒤집기(후손 먼저).
- `--resolve` 의 agent 브랜치 수정·rebase, 시험 삭제·`skip`·기대값 완화로 게이트 통과. `--resolve` 도 force push·훅 우회
  금지는 같다.
- 대상 저장소가 wbs-web 자신이면 G1~G4 훅 제약을 사용자에게 사전 경고.
