---
name: dflow-merge
description: 승인(approved)된 D'Flow 작업의 agent 브랜치를 개발 브랜치(`.dflow.local` 의 `dev_branch`)에 반영. 스택 브랜치는 조상 순서대로, approved 확인 전 머지 금지(팀장 전용 --on-report 만 예외). 트리거 - "/dflow-merge", "승인된 작업 머지", "approved 반영". 사용법 - /dflow-merge [<ref>...]
---
<!-- dflow-caps: remote-candidates — 팀장·워커가 이 줄로 기능 지원을 판정한다. 지우거나 바꾸지 않는다. -->

# /dflow-merge — 승인된 작업의 main 반영

인자: `$ARGUMENTS` (선택: ref 목록. 없으면 「절차」 1번의 로컬·원격 후보 전부)

**`--on-report`(팀장 전용, 승인 전 머지)**: `/dflow-team` 팀장이 자동 머지 모드에서만 붙인다. 사람이 직접 쓰지 않으며
description 의 사용법에도 노출하지 않는다. 반려되지 않은 `status=reported` 도 머지하고(2번), 사람의 사후 승인은 다음 스윕이
「승인 전 머지분」 으로 정리한다. 플래그가 없으면 approved 만 머지한다.

**`--resolve <ref>`(팀장이 띄운 해소 워커 전용)**: 사람이 직접 쓰지 않으며 description 의 사용법에 노출하지 않는다. ref 는
정확히 하나이고 `--attempt <n>`(1~3)이 함께 온다. `--on-report` 가 함께 오면 그 판정도 그대로다. **이 플래그면 지금
`references/resolve.md` 를 읽고 그 절차(「해소 머지」)를 따른다** — 이 파일의 「절차」 는 그 문서가 가리키는 단계만 쓴다.
플래그 없는 수동 사용과 팀장 스윕은 충돌하면 파일 목록을 보고하고 `--abort` 한다(4번 3단계).

> **위치 선언**: /dflow-dev 는 done(reported, 승인 대기)에서 끝난다. 사람이 D'Flow 웹에서
> approve 한 뒤 그 브랜치를 main 에 합치는 것이 이 스킬이다. 이게 없으면 후속 작업의 선행
> 게이트(`merge-base --is-ancestor` 검사)가 영원히 거짓이고 스택 브랜치가 무한히 깊어진다.
> 서버 통신은 dflow.sh, exit code 분기, dflow-work 금지사항 상속.

**분기별 읽을 파일**(그 분기에 들어설 때만 읽는다. 경로는 이 스킬 폴더 `.claude/skills/dflow-merge/` 기준): `--resolve` → `references/resolve.md` · 호출한 체크아웃이 기본 브랜치에
있지 않음 → `references/merge-worktree.md` · 로컬 스캔에 `merged` 줄 → `references/unapproved.md` · push 실패 →
`references/push-fail.md` · 스윕 보고 직전(`dialect_check` 설정 시) → `references/dialect.md` · 결정 번호·마이그레이션 관문 출력을 풀어 설명하거나
설정을 바꿀 때 → `references/script-details.md`. 근거·사고 이력은 `references/rationale.md` 다(실행에 필요 없고 규칙을 바꿀 때만 읽는다).

## 절차

`<기본브랜치>` 는 개발 브랜치, 즉 `dflow.sh branch dev` 의 값이다(`.dflow.local` 의 `dev_branch`, 레거시는
`origin/HEAD`). 팀원(`--worker`)은 팀장이 넘긴 `DEV_BRANCH` 를 쓴다.

작업 폴더 `<TASKS>` 는 `<DOCS_DIR>/tasks` 다(리포 최상위 기준). 한 주문의 폴더 `<TASKS>/<TSK>` 는
`dflow.sh taskdir <ref>` 의 값이다(`.dflow.local` 의 `project_map`, 없으면 `docs`). 여러 작업을 훑을 때는
`dflow.sh config tasks-dirs` 가 내는 폴더 전부를 본다. `<DOCS_DIR>` 를 `docs` 로 박은 고정 경로는 쓰지 않는다.

1. **후보 식별**: 인자가 없으면 아래 원격·로컬 두 스캔이 낸 줄이 후보다. **정본은 이 두 셸 블록이다**(`scripts/sweep-check.sh`
   는 이 1번을 흉내 내는 사전 검사일 뿐이다 — 이 번호 끝 항목).
   - **원격 스캔**: `origin/agent/*` 마다 `origin/<기본브랜치>...<ref>` 차분에서 `tasks-dirs` 폴더별 pathspec
     (`<그 폴더>/*/state.json`)으로 state.json 을 찾아 `git show <ref>:<경로>` 로 읽는다. `git show` 에는 glob 을 쓰지 않는다.
     고정 glob `*/tasks/*/state.json` 도 쓰지 않는다.
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
             'select((.order // "") | startswith($id8)) | select(.phase != "merged" and .phase != "wait_pred")
              | [$ref, .tsk, .order, .phase, (if (.api_base // "") == "" then "none" elif .api_base == $api then "same" else "other" end), $p] | @tsv'
         done
       done
     }
     ```
     `tasks-dirs` 가 실패하거나(exit≠0) 빈 값을 내면 후보 식별을 **하지 않고** "건너뜀(tasks-dirs 조회 실패)" 로 보고한 뒤
     멈춘다(블록이 `rc`·빈 값을 먼저 본다). `$dirs` 를 here-doc(`<<EOF`)으로 넘기지 않는다. 여섯째 칸(`$p`)은 그 state.json 의
     정확한 경로이며, 4번이 `<후보 state.json 경로>` 로 그대로 쓴다 — 다시 `dflow.sh taskdir` 를 부르지 않는다.
     브랜치 이름의 id8 과 state.json `order` 의 앞 8자가 일치하고 **`phase` 가 `merged` 가 아니면 전부 후보**다(tip 의 phase 에
     기대지 않는다. 판정은 서버 `show` 로 한다). 단 `wait_pred`(설계 완료·선행 대기, `/dflow-dev` 「설계 선행」)는 뺀다 — 완료 보고
     전에 설계만 push 한 브랜치라 머지할 것이 없고, 넣으면 선행이 끝날 때까지 스윕마다 후보로 잡힌다. 일치하는 state.json 이 없는 브랜치는 후보가 아니다. 원격에만 있는 후보의
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
     남은 원격 후보는 값이 없어도 건너뛴다(마지막 칸 `none`·`other`). 값이 없는 로컬 후보(옛 state.json)는 지금처럼 판정한다.
     `/dflow-team` 팀장은 그런 후보가 있으면 시작하지 않는다.
   - **서버 조회**: 서버 조회는 state.json 의 전체 UUID 로 한다. show 출력은 jq 로 `.order.status` 와 마지막 `kind=completion`
     리포트의 `review_action`·`review_note`·완료 증적 `head_sha`(4번의 승인 뒤 변경 확인용)만 뽑는다 — spec 본문을 싣지 않는다.
     ```bash
     j=$(.claude/skills/dflow-work/scripts/dflow.sh show <order 전체 UUID>); echo "show=$?"
     printf '%s' "$j" | jq -c '{status: .order.status, last: ([.reports[]? | select(.kind == "completion")] | last | {review_action, review_note, head_sha: .evidence.head_sha})}'
     ```
   - **사전 검사 `scripts/sweep-check.sh`**: 이 1번을 서버 조회 없이 흉내 내는 **상위 집합**이다. 출력 계약(마지막 줄이 판정):
     `SWEEP_CANDIDATES n=<N> <id8…>` · `SWEEP_NONE`(이 스킬을 부르지 않는다) · `SWEEP_UNKNOWN <사유>`(스윕을 돌린다), 판정 줄
     앞의 `SWEEP_DIALECT_PENDING <sha>`(`SWEEP_NONE` 이어도 `dialect-check.sh` 를 한 번 부른다). 호출자는 `/dflow-team`
     「4-0. 스윕을 부르는 규칙」 과 `/dflow-dev` Phase 01-가 다. 이 1번을 바꾸면 스크립트도 같이 고친다
     (`tests/skills/dflow-sweep-check.test.ts` 가 두 블록과 스크립트의 후보를 대조한다).
2. **판정: approved 만 진행**(`--on-report` 면 승인 대기도): 후보마다 아래 중 하나로 보고한다. 승인 대기나 데이터 없음으로 뭉개지 않는다.
   **approved 확인 전 머지 절대 금지** — 로컬 state 나 기억이 아니라 show 응답이 판정이다.
   예외는 `--on-report` 의 승인 대기 머지 하나뿐이며, 그 판정도 show 응답으로 한다.
   - `status=approved`: 머지 대상.
   - `--on-report` 이고 `status=reported` 이며 마지막 completion 리포트의 `review_action` 이 `reject` 가 아님: 머지 대상
     (**승인 전 머지**). 4번 4단계에서 state.json 에 `unapproved: true` 를 함께 남긴다. 플래그가 없으면 아래 "승인 대기" 다.
   - 마지막 completion 리포트가 `review_action=reject`: "반려: 재작업 필요 (<review_note>)"(dflow-dev Phase 01 1번의 반려 판정과
     같은 기준). 반려는 로컬 후보도 state.json 을 고치지 않고 보고만 한다(`rejected` 로 바꾸지 않는다).
   - `status=reported`: "승인 대기".
   - 그 밖의 status: "건너뜀(서버 <status>)".
   - show 가 404(dflow.sh exit 7)이거나 그 밖의 이유로 실패: "건너뜀(조회 실패)".

   **승인 전 머지분 판정**(1번 로컬 스캔의 넷째 칸이 `merged` 인 후보): 절대 다시 머지하지 않는다. 그런 후보가 있으면
   `references/unapproved.md` 를 읽고 같은 show 로 가른다(승인 반영·반려(머지됨)·승인 대기(머지됨)·건너뜀).
3. **순서: 스택은 조상 먼저**: 대상이 여럿이면 브랜치 tip 이 아니라 후보 state.json 의 `branch_base` 로 조상
   관계를 판정해 조상부터 머지한다. 선행이 approved 가 아니어서 조상 브랜치를 머지할 수 없으면
   그 위의 후손도 이번엔 머지하지 않는다(선행을 건너뛰고 후손만 합치면 미승인 커밋이 main 에
   섞인다).
   `--on-report` 면 "approved 가 아니어서" 를 "2번의 머지 대상이 아니어서" 로 읽는다(반려·조회 실패 등).
   - `branch_base`(기점 커밋. `/dflow-dev` 「--worker」 B 면 선행 완료 증적의 head_sha)가 없거나
     `origin/<기본브랜치>` 의 조상이면 스택이 아니다.
   - 아니면 스택이며, 선행은 `git merge-base --is-ancestor <branch_base> <그 후보의 머지 대상>` 이 참인 다른
     후보다. 그런 선행 후보가 없으면 "건너뜀(기점 미반영)" 으로 보고한다.
   - `branch_base` 가 커밋으로 풀리지 않으면(옛 state.json 은 브랜치 이름을 적었을 수 있다) 그 후보만 브랜치 tip 끼리
     `git merge-base --is-ancestor A B` 로 판정한다.
   - **차분 백스톱**: `branch_base` 판정과 별도로,
     `git diff --name-only origin/<기본브랜치>...<그 후보의 머지 대상> --` 뒤에 1번과 같이 구성한 pathspec 을 붙인 것에
     그 작업 외의 state.json 이 있으면 그 파일(`git show <그 후보의 머지 대상>:<경로>`)의 `order` 가 가리키는 작업들도 선행으로
     보고 위 순서와 승인 판정에 넣는다. 그 선행이 이번에 머지되지 않았으면 후손을 건너뛰고, 후보에 없으면
     "건너뜀(기점 미반영)" 으로 보고한다.
4. **머지**: 먼저 머지 자리를 정한다. 호출한 체크아웃의 현재 브랜치가 `<기본브랜치>` 면 그 체크아웃에서 아래 블록 그대로
   머지한다. 아니면(detached HEAD·다른 브랜치) **임시 머지 워크트리** `<W>` 에서 머지한다 — 스윕을 시작할 때
   `references/merge-worktree.md` 를 읽고 따른다. 호출한 체크아웃은 건드리지 않는다.
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
   1. 블록 첫 줄(fetch·switch·pull) 뒤 머지 직전 HEAD 를 기록한다.
   2. **승인 뒤 변경 확인**(승인 전 머지면 "보고 뒤 변경 확인". 규칙은 같고 증적은 완료 보고의 것이다): `<증적 head_sha>`(1번
      show 출력의 `head_sha`)가 로컬에 있고 머지 대상의 조상이며(`git merge-base --is-ancestor <증적 head_sha> <머지 대상>` 이
      참), `git diff --name-only <증적 head_sha>..<머지 대상>` 이 성공해 그 작업의 `<TASKS>/<TSK>/state.json` 뿐이거나 비어
      있으면 머지한다. 다른 파일이 있으면 "건너뜀(승인 뒤 변경)", head_sha 가 로컬에 없거나 머지 대상의 조상이 아니거나
      `git diff` 가 실패하면 "건너뜀(승인 뒤 변경 확인 불가)" 로 보고한 뒤 다음 후보로 간다. 증적에 `head_sha` 자체가 없는
      옛 완료 보고는 이 확인을 건너뛰고 머지하되 보고에 "승인 뒤 변경 확인 불가" 를 붙인다.
      **강제 진행 스텁 관문**: 개발 브랜치와 운영 브랜치가 같으면(`dflow.sh branch dev` 와 `dflow.sh branch release` 가 같은 값)
      머지 전에 `dflow.sh stub-check <머지 대상>` 을 돌린다. exit 4 면 머지하지 않고 「스텁 잔존 — 개발 브랜치 미설정 리포라
      운영에 스텁이 들어간다」 로 보고한 뒤 다음 후보로 간다. 두 브랜치가 다르면 이 검사를 하지 않는다.
      **마이그레이션 버전 관문**: 머지 전에 `.claude/skills/dflow-merge/scripts/migration-check.sh HEAD <머지 대상>` 을 돈다
      (「마이그레이션 버전 관문」, 임시 머지 워크트리면 `-C "$W"`). exit 1(버전 중복·역순 도착)이면 머지하지 않고
      `머지 실패(충돌) <MIGRATION_FILES 의 파일,…> (마이그레이션 버전)` 으로 보고한 뒤 다음 후보로 간다 — 팀장은 텍스트 충돌과
      똑같이 해소 워커에 넘긴다. exit 2(판정 불가)면 머지하지 않고 "건너뜀(마이그레이션 검사 실패)" 로 보고한다.
   3. `git merge --no-ff <머지 대상>`. 충돌하면 먼저 공용 결정 기록(`decisions.md`)의 충돌만 스크립트로 푼다(「결정 번호
      매김」). 남은 충돌이 없으면 `git commit --no-edit --cleanup=strip` 으로 머지를 완성하고 3-1 로 간다(`-m` 두 문단과
      트레일러는 `MERGE_MSG` 에 남아 있고, `--cleanup=strip` 이 `# Conflicts:` 주석을 지운다).
      남은 충돌이 있으면 그 목록을 읽은 뒤 `git merge --abort` 로 되돌리고 "머지 실패(충돌)" 로
      보고한 뒤 다음 후보로 간다(충돌 상태로 두지 않는다). 사람이 그 자리에서 충돌을
      손으로 풀어 `git merge --abort` 대신 직접 `git commit` 으로 머지를 완성하는 경로도 있다 — 이
      경로에도 「트레일러 고정」 이 그대로 적용된다.
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
      `NO_TEMP_IDS` 면 커밋이 없고, `COMMITTED <sha>` 면 번호 매김 커밋이 머지 커밋 위에 생긴다(5단계 push 에 함께 실린다).
      `RENUMBER_DIRTY`·`RENUMBER_FAILED …` 는 머지를 막지 않는다(스크립트가 자기 변경을 되돌린다) — 4단계로 가고 보고에
      "결정 번호 매김 실패(<출력>)" 를 붙인다. `UNION_SET`·`DUP_*`·`DECISIONS_SEQ` 줄도 머지를 막지 않는다(6번대로 싣는다).
      번호 매김이 실패했는데 그 머지에 중복이 있었으면 "결정 번호 중복 — 사람이 고쳐야 함" 으로 보고한다.
   4. state.json 을 `phase=merged` 로 갱신해 기본 브랜치에 커밋한다(파일명 명시). `<후보 state.json 경로>` 는
      **1번 후보 식별이 이미 찾은 그 경로다**(로컬 `$f`, 원격 `$p`). 여기서 `dflow.sh taskdir` 를 다시 부르지 않는다.
      `git add` 가 실패하면(경로가 비었거나, 그 파일이 이 시점의 트리에 없거나, stage 되지 않으면) **커밋·push 하지 않고**
      "머지 실패(state.json 경로)" 로 보고한 뒤 다음 후보로 간다. 이 커밋을 **push 전에** 만든다.
      승인 전 머지면 같은 커밋에서 `unapproved: true` 를 함께 넣는다. `phase` 를 `merged` 가 아닌 새 값으로 만들지 않는다
      (행 G 의 반영 확인과 `poll.sh` 의 반려 감지가 `merged` 를 본다).
   5. `git push origin <기본브랜치>` 로 머지와 `merged` 커밋을 한 번에 올린다. push 가 실패하면 먼저
      `git reset --keep <기록한 HEAD>` 로 되돌리고, `references/push-fail.md` 를 읽어 거부 모양(경합·훅·그 밖)으로
      가른다. `origin` 으로 리셋하지 않는다.

   `--no-ff` 고정 — 작업 단위 경계가 머지 커밋으로 남아야 추적이 된다. push 가 훅에 거부되면
   우회 금지. 되돌리고 보고한 뒤 그 작업과 후손만 빼는 절차는 `references/push-fail.md` 다.

   **트레일러 고정**: 이 스킬이 만드는 모든 머지 커밋에는 `DFlow-Order: <order>` 트레일러를 붙인다(`<order>` 는 그 후보
   state.json 의 `order`, 주문 UUID). `git merge` 에는 `--trailer` 가 없으므로(`git commit` 전용) 3단계는 위 블록처럼 둘째
   `-m "DFlow-Order: <order>"` 로 붙인다(빈 줄 뒤 단독 문단이 트레일러가 된다). 충돌을 손으로 풀어 직접 `git commit` 으로
   완성할 때는 `git commit --trailer "DFlow-Order: <order>"` 를 쓴다.
   어느 경로든 결과 메시지에 이 트레일러가 실려야 하는 것은 같다 — `/dflow-dev` 「--worker」 행 G 의 반영 확인이 보는 증거다. "자동 스윕이 아니다" 는 빠뜨릴 이유가
   되지 않는다.
5. **뒷정리** (머지된 작업마다):
   - 머지된 `agent/` 브랜치를 지운다. 원격 agent 브랜치 삭제(`git push origin --delete agent/<id8>-<slug>`)는 그대로 한다.
     로컬 삭제(`git branch -d agent/<id8>-<slug>`)는 브랜치가 없거나(not found) 다른 워크트리가 잡고 있으면(checked out)
     건너뛰고 보고한다. 아직 미승인 후손 스택 브랜치는 **삭제·rebase
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
   다시 시도한다). 결과 줄(`DIALECT_*`, `DIALECT_SKIP` 제외)과 `DIALECT_UNVERIFIED` 줄을 표 아래에 그대로 싣는다.

## 방언 검증

같은 목적의 도커 검증(DB 방언 검증 등)은 워커가 하지 않고(정본 dev-discipline 「도커 사용 규칙」) 이 스윕이 **스윕 한 번에
한 번, 마지막 머지 커밋(스윕 끝의 `origin/<기본브랜치>`)에서** 돌린다. 머지마다 돌리지 않는다. **도커 런타임을 켜지 않는다.**
`--resolve` 는 이 절을 타지 않는다. 스윕은 시작의 `git fetch origin` 직후 `git rev-parse origin/<기본브랜치>` 를 `<스윕 전 sha>`
로 기록해 두고, 6번 보고 직전에 `.claude/skills/dflow-work/scripts/dflow.sh config dialect_check` 를 본다. exit 0 에 빈 값이면
이 단계는 없다(`DIALECT_NONE`). 그 밖에는 `references/dialect.md` 를 읽고 그 명령을 한 번 부른다.

## 결정 번호 매김

공용 결정 기록(`docs/<모듈>/decisions.md` 등, `## D-NNN (<UTC 타임스탬프>)` 블록을 추가만 하는 기록)의 전역 번호는 머지하는 이
스킬이 매긴다. agent 브랜치는 Task 범위 임시 ID `D-<TSK>-<n>` 만 쓴다(dev-discipline 「공용 결정 기록(decisions.md)의 번호」).
번호는 손으로 매기지 않는다. 도구는 `.claude/skills/dflow-merge/scripts/decisions.sh` 하나이며 머지 자리의 최상위에서 돈다
(임시 머지 워크트리면 `-C "$W"`).

- **충돌 풀기**(`merge-conflicts`, 4번 3단계·해소 머지 4번): 충돌한 decisions.md 만 블록 단위로 푼다(`DECISIONS_RESOLVED`).
  풀지 못한 `DECISIONS_LEFT` 파일은 다른 충돌과 같이 다룬다.
- **번호 매김**(`renumber`, 4번 3-1단계·해소 머지 6번 뒤): 임시 ID 를 다음 전역 번호로 바꾸는 커밋 하나를 남긴다. 첫 단계에서
  **전역 번호 중복**(두 브랜치가 같은 `## D-NNN` 을 들고 온 것)을 충돌 여부와 무관하게 머지 대상 쪽만 옮겨 바로잡는다.
- **`merge=union` 을 걸지 않는다.** 이미 걸려 있으면 `renumber` 가 `UNION_SET <파일>` 로 알린다. 대상 리포 `.gitattributes`
  에서 그 줄을 빼라고 보고한다.

출력 줄의 뜻·사유 코드·`Temp ID`·`Renumbered from` 줄·참조를 바꾸는 범위는 `references/script-details.md` 「결정 번호 매김」.

## 마이그레이션 버전 관문

Flyway 처럼 파일명이 곧 버전인 마이그레이션(`V<버전>__<설명>.sql`)은 병렬 브랜치가 같은 번호를 고르면 **git 충돌 없이**
머지되고 개발 브랜치 기동이 깨진다. 그래서 머지 전에 합친 트리를 `.claude/skills/dflow-merge/scripts/migration-check.sh` 로
검사하고, 걸리면 충돌로 취급해 해소 워커(`--resolve`, `resolve-prompt.md` 「해소 규약」 R9)가 다음 번호로 재채번하게 한다.
스윕(4번 2단계)은 `migration-check.sh HEAD <머지 대상>`, 해소 머지(`references/resolve.md` 4·5번)는 `migration-check.sh --staged`
다. 대상 리포가 Flyway `outOfOrder=true` 로 운영하면 팀장 세션 환경에 `DFLOW_MIGRATION_OUT_OF_ORDER=1`(또는
`--allow-out-of-order`)을 두어 역순 검사만 끈다. 중복 검사는 끄지 않는다. 출력(`MIGRATION_*`)·버전 비교 규칙은
`references/script-details.md` 「마이그레이션 버전 관문」.

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
