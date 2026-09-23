---
name: dflow-merge
description: 승인(approved)된 D'Flow 작업의 agent 브랜치를 개발 브랜치(`.dflow.local` 의 `dev_branch`)에 반영. 스택 브랜치는 조상 순서대로, approved 확인 전 머지 금지(팀장 전용 --on-report 만 예외). 트리거 - "/dflow-merge", "승인된 작업 머지", "approved 반영". 사용법 - /dflow-merge [<ref>...]
---

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
온다. `--on-report` 가 함께 오면 그 판정도 그대로다. 절차는 아래 「해소 머지(`--resolve`)」 절이다. 플래그 없는 수동
사용과 팀장 스윕은 충돌 파일 목록을 보고하는 것만 바뀌고 여전히 `--abort` 한다(2026-09-23 머지 충돌 설계 §5.1).

> **위치 선언**: /dflow-dev 는 done(reported, 승인 대기)에서 끝난다. 사람이 D'Flow 웹에서
> approve 한 뒤 그 브랜치를 main 에 합치는 것이 이 스킬이다. 이게 없으면 후속 작업의 선행
> 게이트(`merge-base --is-ancestor` 검사)가 영원히 거짓이고 스택 브랜치가 무한히 깊어진다.
> 서버 통신은 dflow.sh, exit code 분기, dflow-work 금지사항 상속.

## 절차

`<기본브랜치>` 는 개발 브랜치, 즉 `dflow.sh branch dev` 의 값이다(`.dflow.local` 의 `dev_branch`, 레거시는
`origin/HEAD`). 팀원(`--worker`)은 팀장이 넘긴 `DEV_BRANCH` 를 쓴다.

1. **후보 식별**: 인자 없으면 대상 저장소의 `docs/tasks/*/state.json` 에서 `phase=reported`
   인 작업 전부(로컬 후보). 여기에 원격 후보를 더한다.
   - `git fetch origin` 뒤 `git branch -r --list 'origin/agent/*'` 의 각 `<ref>` 에서, state.json 경로를
     `git diff --name-only origin/<기본브랜치>...<ref> -- 'docs/tasks/*/state.json'` 로 찾고
     `git show <ref>:<경로>` 로 읽는다. `git show` 에는 glob 을 쓰지 않는다(경로를 해석하지 않는다).
     ```bash
     api=$(.claude/skills/dflow-work/scripts/dflow.sh config api_base); api=${api%/}
     git fetch origin
     for ref in $(git branch -r --list 'origin/agent/*'); do
       id8=$(printf '%s' "${ref#origin/agent/}" | cut -c1-8)
       git diff --name-only "origin/<기본브랜치>...$ref" -- 'docs/tasks/*/state.json' | while IFS= read -r p; do
         git show "$ref:$p" | jq -r --arg ref "$ref" --arg id8 "$id8" --arg api "$api" \
           'select((.order // "") | startswith($id8)) | select(.phase != "merged")
            | [$ref, .tsk, .order, .phase, (if (.api_base // "") == "" then "none" elif .api_base == $api then "same" else "other" end)] | @tsv'
       done
     done
     ```
   - 브랜치 이름의 id8 과 state.json `order` 의 앞 8자가 일치해야 하고, **`phase` 가 `merged` 가 아니면
     전부 후보**로 본다. 이유: tip 의 phase 는 `reported` 커밋이 실패하면 `verify` 에 머물 수 있으므로
     기대지 않는다. 판정은 서버 `show` 로만 하므로 넓게 잡아도 안전하다. 일치하는 state.json 이 없는
     브랜치는 후보가 아니다(아직 state.json 을 커밋하기 전이다).
   - **로컬·원격 중복**: 같은 order 가 로컬과 원격에 모두 있으면 로컬 후보 하나로 합쳐 로컬 규칙으로
     판정한다. 합친 후보의 `api_base` 는 값이 있는 쪽을 쓰고(원격·로컬 스캔 출력 마지막 칸이 `none` 이 아닌 쪽), 둘 다
     값이 있는데 서로 다르면 "건너뜀(다른 D'Flow)" 로 보고한다. 머지 대상은 증적 head_sha 를 포함하는 쪽
     (`git merge-base --is-ancestor <증적 head_sha> <그 브랜치>` 가 참)이고, 그 밖에는(둘 다 포함하거나 증적에
     head_sha 가 없으면) 원문처럼 로컬 브랜치 `agent/<id8>-<slug>`, 로컬 브랜치가 없으면 원격 브랜치다.
     순서는 중복 제거 → `api_base` 필터다. 이유: 필터를 먼저 걸면 같은 작업이 "건너뜀(다른 D'Flow)" 와
     "머지됨" 으로 두 번 보고되고, 원격 사본 쪽을 남기면 `api_base` 가 없는 옛 로컬 후보가 원격 규칙에 걸려
     건너뛰어져 수동 경로가 머지하던 작업을 놓친다. head_sha 를 포함하는 쪽을 고르는 이유: 사람이 승인한
     코드는 그 커밋까지이며, 그 커밋이 없는 쪽은 4번의 승인 뒤 변경 확인을 통과할 수 없다.
   - **`api_base` 필터**(중복 제거 뒤): 후보 state.json 의
     `api_base` 가 현재 `DFLOW_API_BASE`(끝 `/` 제거)와 다르면
     로컬이든 원격이든 "건너뜀(다른 D'Flow)" 로 보고한다. 중복 제거 뒤 남은
     원격 후보는 값이 없어도 건너뛴다(위 출력 마지막 칸 `none`·`other`). 값이 없는 로컬 후보(이 수정 전에
     만든 state.json)는 지금처럼 판정한다. `/dflow-team` 팀장은 그런 후보가 있으면 시작하지 않는다. 로컬
     후보의 값은 아래로 본다.
     ```bash
     find docs/tasks -mindepth 2 -maxdepth 2 -name state.json 2>/dev/null | while IFS= read -r f; do
       jq -r --arg f "$f" --arg api "$api" 'select(.phase == "reported" or (.phase == "merged" and .unapproved == true))
         | [$f, .tsk, .order, .phase, (if (.api_base // "") == "" then "none" elif .api_base == $api then "same" else "other" end)] | @tsv' "$f"
     done
     ```
     넷째 칸이 `merged` 인 줄은 **승인 전 머지분**이다(`--on-report` 가 머지하며 `unapproved: true` 를 남겼다). 이미 기본
     브랜치에 들어 있으므로 머지 대상이 아니라 2번의 「승인 전 머지분 판정」 만 받는다. 플래그와 무관하게 늘 본다. 이유:
     머지한 뒤에는 원격 스캔(`phase != "merged"`)에도 `reported` 스캔에도 걸리지 않아, 그 작업의 승인·반려를 아무도
     읽지 못한다. 팀장의 poll 에는 반려 신호(exit 10)도 오지 않는다(`/dflow-team` 「2-3」).
     glob(`docs/tasks/*/state.json`)을 쓰지 않는 이유: zsh 에서는 매치가 없으면 `no matches found` 로 명령
     전체가 죽는다. `docs/tasks` 가 없는 리포에서도 `find` 는 조용히 아무것도 내지 않는다.
     이유: 스테이징 D'Flow DB 는 운영을 복제하므로, 스테이징 `api_base`(export 된 `DFLOW_API_BASE`) 로 실제 리포에서 스윕하면 운영에서
     승인된 작업을 로컬 후보든 원격 후보든 머지할 수 있다. 값이 없는 옛 로컬 후보는 출처를 가릴 수 없으므로
     사람이 보는 수동 경로에만 남긴다.
   - 서버 조회는 state.json 의 전체 UUID 로 한다. 원격에만 있는 후보의 머지 대상은
     `origin/agent/<id8>-<slug>` 다.
   - show 출력은 jq 로 `.order.status` 와 마지막 `kind=completion` 리포트의 `review_action`·`review_note`·완료
     증적의 `head_sha` 만 뽑는다. 스윕마다 spec 본문을 컨텍스트에 싣지 않기 위해서다. `head_sha` 는 4번의 승인 뒤
     변경 확인에 쓴다.
     ```bash
     j=$(.claude/skills/dflow-work/scripts/dflow.sh show <order 전체 UUID>); echo "show=$?"
     printf '%s' "$j" | jq -c '{status: .order.status, last: ([.reports[]? | select(.kind == "completion")] | last | {review_action, review_note, head_sha: .evidence.head_sha})}'
     ```
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
     `git diff --name-only origin/<기본브랜치>...<그 후보의 머지 대상> -- 'docs/tasks/*/state.json'` 에 그 작업 외의 state.json 이 있으면
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
   git add docs/tasks/<TSK>/state.json && git commit -m "chore(<TSK>): phase=merged"   # state.json 을 phase=merged 로 고친 뒤, push 전에
   git push origin <기본브랜치>
   ```
   후보마다 다음 순서로 한다.
   1. `git fetch origin && git switch <기본브랜치> && git pull --ff-only origin <기본브랜치>` 뒤 머지 직전
      HEAD 를 기록한다.
   2. **승인 뒤 변경 확인**(승인 전 머지면 "보고 뒤 변경 확인"이며 규칙은 같다. 증적은 완료 보고의 것이다): 증적 head_sha 가 로컬에 있고 머지 대상의 조상이며
      (`git merge-base --is-ancestor <증적 head_sha> <머지 대상>` 이 참), `git diff --name-only <증적 head_sha>..<머지 대상>`
      이 성공해 그 작업의 `docs/tasks/<TSK>/state.json` 뿐이거나 비어 있으면 머지한다. 다른 파일이 있으면
      "건너뜀(승인 뒤 변경)", head_sha 가 로컬에 없거나 머지 대상의 조상이 아니거나 `git diff` 가 실패하면
      "건너뜀(승인 뒤 변경 확인 불가)" 로 보고한 뒤 다음 후보로 간다. `<증적 head_sha>` 는 1번 show 출력의
      `head_sha` 다. 이유: 원격 후보를 받으므로 승인 뒤 같은 agent 브랜치에 올라온 커밋까지 머지 대상이 되는데,
      사람이 승인한 것은 증적의 head_sha 까지다. tip 이 head_sha 와 같은지만 보면 `/dflow-dev` Phase 06 의
      `reported` 커밋 때문에 늘 다르다. 확인하지 못한 경우를 건너뛰는 이유: `git diff` 가 오류로 끝나면 출력이
      비어 "비어 있으면 머지" 로 읽히기 때문이다. 증적에 `head_sha` 자체가 없는 옛 완료 보고는 이 확인을
      건너뛰고 지금처럼 머지하되 보고에 "승인 뒤 변경 확인 불가" 를 붙인다. 수동 경로가 머지하던 후보를
      거부하면 퇴행이기 때문이다.
   3. `git merge --no-ff <머지 대상>`. 충돌하면 먼저 충돌 파일 목록을 읽은 뒤 `git merge --abort` 로 되돌리고 "머지 실패(충돌)" 로
      보고한 뒤 다음 후보로 간다. 이유: 충돌 상태로 남으면 체크아웃이 더러워져, 팀장이면 이후 모든
      기상이 전제 검사에서 멈추고 수동이면 사람이 그 상태를 치워야 한다. 사람이 그 자리에서 충돌을
      손으로 풀어 `git merge --abort` 대신 직접 `git commit` 으로 머지를 완성하는 경로도 있다 — 이
      경로에도 아래 트레일러 규칙이 그대로 적용된다. "자동 스윕이 아니다" 는 트레일러를 빠뜨릴
      이유가 되지 않는다.
      충돌 파일 목록은 `--abort` **전에** 읽는다(뒤에는 비어 있다). 보고 줄은 `머지 실패(충돌) <파일,…>` 다.
      임시 머지 워크트리에서는 두 명령 모두 `git -C "$W"` 로 부른다.
      ```bash
      git diff --name-only --diff-filter=U | paste -sd, -   # 충돌 파일 목록(쉼표로 이음)
      git merge --abort
      ```
   4. state.json 을 `phase=merged` 로 갱신해 기본 브랜치에 커밋한다(파일명 명시). 이 커밋을 **push 전에**
      만든다. 승인 전 머지면 같은 커밋에서 `unapproved: true` 를 함께 넣는다. `phase` 를 `merged` 가 아닌 새 값으로
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
   (`<order>` 는 그 후보 `docs/tasks/<TSK>/state.json` 의 `order`, 주문 UUID). 붙이는 방법은 커밋 방식마다
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
   ```
   - `MERGE_WT_FAILED` 면 이번 스윕은 아무것도 머지하지 않고 "머지 워크트리 생성 실패" 로 보고한다.
   - 후보마다 위 1~5를 `<W>` 에서 한다. 달라지는 것은 셋뿐이다.
     1. 1단계는 `git -C "$W" fetch origin && git -C "$W" switch --detach origin/<기본브랜치>` 다. `pull` 대신
        detach 하는 이유: `<W>` 는 브랜치를 잡지 않는다. 그 뒤 `git -C "$W" rev-parse HEAD` 를 머지 직전 HEAD 로 기록한다.
     2. 4단계의 state.json 은 `<W>/docs/tasks/<TSK>/state.json` 을 고쳐 `<W>` 에서 커밋한다.
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
   승인 뒤 변경 확인 불가·로컬 브랜치 삭제 건너뜀)을 표로. 반려·머지 실패(충돌)·push 실패(훅)는 id8 과 함께 따로
   적는다. 반려(머지됨)도 따로 적는다. 호출자(`/dflow-team` 팀장 등)가 이 목록으로 후속 처리를 한다.

## 해소 머지(`--resolve`)

팀장이 띄운 해소 워커(`dflow-team/references/resolve-prompt.md`)만 이 절을 탄다. 목적은 충돌한 작업 한 건을
**개발 브랜치 위의 머지 커밋 안에서** 푸는 것이다. agent 브랜치는 건드리지 않는다. 건드리면 다음 스윕의 2단계
「승인 뒤 변경 확인」 이 그 작업을 "건너뜀(승인 뒤 변경)" 으로 내기 때문이다. rebase 도 하지 않는다. rebase 는
force push 금지와 `merge-base --is-ancestor <head_sha>` 검사에 모두 걸린다. 결과는 마지막 출력 줄 **하나**로 호출자에게
넘긴다(아래 「결과 줄」).

1. **후보·판정**: 1·2단계를 그대로 하되 후보는 인자 ref 하나뿐이다. 2단계가 머지 대상이 아니라고 판정하면(승인 대기·
   반려·이미 머지됨·조회 실패 등) 해소하지 않고 `RESOLVE_SKIPPED <그 보고 문구>` 로 끝난다. 3단계의 스택 판정에서
   선행이 개발 브랜치에 없으면 `RESOLVE_SKIPPED 건너뜀(기점 미반영)` 이다. 해소 워커는 선행까지 머지하지 않는다.
2. 머지 자리는 **호출한 워크트리 자신**이다. 임시 머지 워크트리 `<ROOT>/.claude/worktrees/dflow-merge` 는 쓰지 않는다.
   팀장 스윕의 임시 워크트리와 경로가 겹치기 때문이다. 이 워크트리는 `origin/<기본브랜치>` 에 detach 돼 있어야 한다.
   ```bash
   git fetch origin
   git branch --show-current                  # 비어 있어야 한다(detached). 아니면 RESOLVE_NOT_DETACHED 로 멈춘다
   git rev-parse HEAD origin/<기본브랜치>      # 두 줄이 같아야 한다. 다르면 RESOLVE_BASE_MOVED <origin 짧은 sha> 로 멈춘다
   ```
   `RESOLVE_BASE_MOVED` 는 실패가 아니다. 호출자가 새 `origin/<기본브랜치>` 로 다시 detach 하고 기준선을 다시 잰 뒤
   이 절을 다시 부른다. 기준선과 머지 기점이 어긋나면 게이트가 개발 브랜치의 새 실패를 해소 탓으로 돌리거나, 그
   반대가 되기 때문이다. 이때 `git rev-parse HEAD` 를 **기준 HEAD** 로 기록한다.
3. **승인 뒤 변경 확인**: 4단계 2번 그대로다. 걸리면 `RESOLVE_SKIPPED 건너뜀(승인 뒤 변경)` 또는
   `RESOLVE_SKIPPED 건너뜀(승인 뒤 변경 확인 불가)` 로 끝난다.
4. **머지**: 충돌 여부와 무관하게 늘 커밋 없이 머지한다. 그래야 `resolution.md` 와 트레일러 둘이 한 커밋에 실린다.
   rerere 는 명령줄 `-c` 로만 켠다. `git config` 로 켜지 않는 이유: 워크트리의 `git config` 는 공용 `.git/config` 에
   써져 사람 체크아웃까지 바뀐다. rerere 기록(`rr-cache`)은 공용 디렉터리에 남으므로, push 경합 뒤 재머지와 다음
   시도가 같은 해소를 다시 쓴다. 기록은 커밋 때 남으므로 `commit` 에도 `-c` 를 붙인다.
   ```bash
   git -c rerere.enabled=true merge --no-ff --no-commit <머지 대상>
   git diff --name-only --diff-filter=U        # 충돌 파일 목록. 비었으면 텍스트 충돌은 없다(files=0)
   ```
   - 충돌 파일마다 `dflow-team/references/resolve-prompt.md` 「해소 규약」 의 R1~R8 로 푼다. 그 규약의 「blocked 로
     멈추는 경우」 에 걸리면 머지를 워크트리에 멈춘 채 두고 `RESOLVE_BLOCKED <질문과 선택지 한 줄>` 로 끝난다
     (`--abort` 하지 않는다. 사람이 답하면 그 자리에서 이어 간다).
   - 해소 기록 `<TASKS>/<TSK>/resolution.md` 에 `## 시도 <n>` 절을 덧붙인다. 파일마다 적용한 규약 번호와 판단을
     한 줄씩 적는다. `<TASKS>/<TSK>` 는 호출자가 넘긴 작업 폴더다.
   - 푼 파일과 `resolution.md` 를 파일명으로 stage 한 뒤 커밋한다. 둘째 `-m` 은 요약(충돌 파일 수·규약 번호)이다.
   ```bash
   git -c rerere.enabled=true commit -m "merge: <TSK> <제목> (approved) — 충돌 해소" -m "충돌 <N>개 · 규약 <R…>" \
     --trailer "DFlow-Order: <order>" --trailer "DFlow-Resolve: <n>/3"
   ```
   승인 전 머지(`--on-report`)면 제목 괄호는 `(reported, 승인 전)` 이다. `<n>` 은 `--attempt` 값이다. 트레일러
   `DFlow-Order` 는 「트레일러 고정」 과 같은 이유로 빠뜨리지 않는다(행 G 증거 2).
5. **게이트**: 머지 커밋 **직후, state.json 커밋 전에** 한 번 돈다. 충돌이 없었어도 돈다. 의미 충돌은 텍스트 충돌
   없이 오기 때문이다(2026-09-21 가드 Task: 텍스트 충돌 한 줄에 시험 85건이 401). 판정은
   `dflow-team/references/resolve-prompt.md` 「게이트」 이며, 기준선은 호출자가 기준 HEAD 에서 잰 총수와 머지 대상
   단독 총수 중 큰 쪽이다. 통과하지
   못하면 `git reset --keep <기준 HEAD>` 로 버리고 `RESOLVE_GATE_FAILED <신규 실패 수>` 로 끝난다.
6. **state.json**: 4단계 4번 그대로 `phase=merged`(승인 전이면 `unapproved: true` 도) 커밋을 만든다. 이 커밋과 머지
   커밋 사이에 게이트를 다시 돌지 않는다.
7. **push**: `git push origin HEAD:<기본브랜치>`. 실패하면 먼저 `git reset --keep <기준 HEAD>` 로 되돌리고 모양으로
   가른다.
   - `non-fast-forward`·`fetch first` 면 경합이다. `git fetch origin && git switch -q --detach origin/<기본브랜치>`
     뒤 `RESOLVE_BASE_MOVED <새 origin 짧은 sha>` 로 끝난다. 호출자가 기준선을 다시 재고 이 절을 1번부터 다시 부른다.
     rerere 가 앞서 푼 덩어리를 되살린다. 기준 이동과 합친 **이 재시도는 한 세션 안에서 2회까지**이며 호출자가 센다.
     넘으면 호출자가 `failed push-race` 로 끝낸다.
   - 그런 문구 없이 1 로 끝나면 훅 거부다. 우회하지 않고 `RESOLVE_PUSH_HOOK` 으로 끝난다.
   - 그 밖의 실패는 `RESOLVE_PUSH_FAILED <exit>` 다.
8. **뒷정리**: 5번 뒷정리 그대로다(원격 agent 브랜치 삭제, 로컬 브랜치의 not found·checked out 건너뛰기).
9. **결과 줄**: 성공하면
   `RESOLVE_PUSHED <머지 커밋 전체 sha> base=<기준 HEAD 짧은 sha> files=<충돌 파일 수> rules=<R번호,…|-> tests=<통과/총수>`.
   머지 커밋 sha 는 `git rev-parse HEAD~1` 이다(HEAD 는 state.json 커밋). 전체 sha 로 넘기는 이유: 팀장이 이 값으로
   조상 확인을 하는데, 짧은 sha 는 저장소가 커지면 모호해져 확인이 실패할 수 있다.

`--resolve` 가 쓰는 파일은 호출한 워크트리 안뿐이다. 팀장 체크아웃은 건드리지 않으므로, 해소가 `RESOLVE_BLOCKED` 로
멈춰도 팀장의 전제 검사는 깨지지 않는다.

## 금지

- approved 아닌 작업의 머지(reported·claimed 포함). 서버 approve 시도.
  예외는 `--on-report` 의 반려되지 않은 `reported` 하나뿐이다. 반려된 작업·`claimed`·승인 전 머지분의 재머지는 플래그가
  있어도 금지.
- force push. 훅 우회(SKIP_GUARD).
- 머지 순서 뒤집기(후손 먼저).
- `--resolve` 의 agent 브랜치 수정·rebase, 시험 삭제·`skip`·기대값 완화로 게이트 통과. `--resolve` 도 force push·훅 우회
  금지는 같다.
- 대상 저장소가 wbs-web 자신이면 G1~G4 훅 제약을 사용자에게 사전 경고.
