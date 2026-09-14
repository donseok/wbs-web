---
name: dflow-merge
description: 승인(approved)된 D'Flow 작업의 agent 브랜치를 기본브랜치(main)에 반영. 스택 브랜치는 조상 순서대로, approved 확인 전 머지 금지. 트리거 - "/dflow-merge", "승인된 작업 머지", "approved 반영". 사용법 - /dflow-merge [<ref>...]
---

# /dflow-merge — 승인된 작업의 main 반영

인자: `$ARGUMENTS` (선택: ref 목록. 없으면 로컬 `phase=reported` 작업과, 원격 `origin/agent/*` 브랜치 중 `phase` 가 `merged` 가 아닌 작업이 후보. `api_base` 가 현재 D'Flow 와 다른 후보는 건너뛴다)

> **위치 선언**: /dflow-dev 는 done(reported, 승인 대기)에서 끝난다. 사람이 D'Flow 웹에서
> approve 한 뒤 그 브랜치를 main 에 합치는 것이 이 스킬이다. 이게 없으면 후속 작업의 선행
> 게이트(`merge-base --is-ancestor` 검사)가 영원히 거짓이고 스택 브랜치가 무한히 깊어진다.
> 서버 통신은 dflow.sh, exit code 분기, dflow-work 금지사항 상속.

## 절차

1. **후보 식별**: 인자 없으면 대상 저장소의 `docs/tasks/*/state.json` 에서 `phase=reported`
   인 작업 전부(로컬 후보). 여기에 원격 후보를 더한다.
   - `git fetch origin` 뒤 `git branch -r --list 'origin/agent/*'` 의 각 `<ref>` 에서, state.json 경로를
     `git diff --name-only origin/<기본브랜치>...<ref> -- 'docs/tasks/*/state.json'` 로 찾고
     `git show <ref>:<경로>` 로 읽는다. `git show` 에는 glob 을 쓰지 않는다(경로를 해석하지 않는다).
     ```bash
     set -a; . ./.env; set +a; api=${DFLOW_API_BASE%/}
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
       jq -r --arg f "$f" --arg api "$api" 'select(.phase == "reported")
         | [$f, .tsk, .order, (if (.api_base // "") == "" then "none" elif .api_base == $api then "same" else "other" end)] | @tsv' "$f"
     done
     ```
     glob(`docs/tasks/*/state.json`)을 쓰지 않는 이유: zsh 에서는 매치가 없으면 `no matches found` 로 명령
     전체가 죽는다. `docs/tasks` 가 없는 리포에서도 `find` 는 조용히 아무것도 내지 않는다.
     이유: 스테이징 D'Flow DB 는 운영을 복제하므로, 스테이징 `.env` 로 실제 리포에서 스윕하면 운영에서
     승인된 작업을 로컬 후보든 원격 후보든 머지할 수 있다. 값이 없는 옛 로컬 후보는 출처를 가릴 수 없으므로
     사람이 보는 수동 경로에만 남긴다.
   - 서버 조회는 state.json 의 전체 UUID 로 한다. 원격에만 있는 후보의 머지 대상은
     `origin/agent/<id8>-<slug>` 다.
   - show 출력은 jq 로 `.order.status` 와 마지막 `kind=completion` 리포트의 `review_action`·`review_note`·완료
     증적의 `head_sha` 만 뽑는다. 스윕마다 spec 본문을 컨텍스트에 싣지 않기 위해서다. `head_sha` 는 4번의 승인 뒤
     변경 확인에 쓴다.
     ```bash
     j=$(set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh show <order 전체 UUID>); echo "show=$?"
     printf '%s' "$j" | jq -c '{status: .order.status, last: ([.reports[]? | select(.kind == "completion")] | last | {review_action, review_note, head_sha: .evidence.head_sha})}'
     ```
2. **판정: approved 만 진행**: 후보마다 아래 중 하나로 보고한다. 승인 대기나 데이터 없음으로 뭉개지 않는다.
   **approved 확인 전 머지 절대 금지** — 로컬 state 나 기억이 아니라 show 응답이 판정이다.
   - `status=approved`: 머지 대상.
   - 마지막 completion 리포트가 `review_action=reject`: "반려: 재작업 필요 (<review_note>)". dflow-dev
     Phase 0 1번의 반려 판정과 같은 기준이다. 반려는 로컬 후보도 state.json 을 고치지 않고 보고만 한다. 이유:
     수동 `/dflow-poll` 의 반려 감지(exit 10)는 로컬 state.json 의 `reported`·`merged` 를 재료로 쓰므로,
     `rejected` 로 바꾸면 그 감지가 사라진다.
   - `status=reported`: "승인 대기".
   - 그 밖의 status: "건너뜀(서버 <status>)".
   - show 가 404(dflow.sh exit 7)이거나 그 밖의 이유로 실패: "건너뜀(조회 실패)".
3. **순서: 스택은 조상 먼저**: 대상이 여럿이면 브랜치 tip 이 아니라 후보 state.json 의 `branch_base` 로 조상
   관계를 판정해 조상부터 머지한다. 선행이 approved 가 아니어서 조상 브랜치를 머지할 수 없으면
   그 위의 후손도 이번엔 머지하지 않는다(선행을 건너뛰고 후손만 합치면 미승인 커밋이 main 에
   섞인다).
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
   - 이유: `/dflow-dev` Phase 5 가 done 뒤 `reported` 를 커밋하므로 선행 tip 은 후속이 기점으로 삼은 커밋보다
     앞서 있어 후속의 조상이 아니다. tip 으로 판정하면 스택을 알아보지 못해, 승인이 철회된 선행 위에 쌓인
     후속만 승인됐을 때 선행의 코드가 main 에 들어간다.
4. **머지**:
   ```bash
   git fetch origin && git switch <기본브랜치> && git pull --ff-only origin <기본브랜치>
   git rev-parse HEAD                      # 머지 직전 HEAD. 값을 기록해 둔다
   git merge-base --is-ancestor <증적 head_sha> <머지 대상>   # 증적에 head_sha 가 있을 때만. 0 이 아니면(커밋이 없거나 조상이 아님) 머지하지 않는다
   git diff --name-only <증적 head_sha>..<머지 대상>   # 증적에 head_sha 가 있을 때만. 실패하면 머지하지 않고, 그 작업의 state.json 뿐이거나 비어 있어야 머지한다
   git merge --no-ff <머지 대상> -m "merge: <TSK> <제목> (approved)"   # 로컬 후보 agent/<id8>-<slug>, 원격 전용 후보 origin/agent/<id8>-<slug>
   git add docs/tasks/<TSK>/state.json && git commit -m "chore(<TSK>): phase=merged"   # state.json 을 phase=merged 로 고친 뒤, push 전에
   git push origin <기본브랜치>
   ```
   후보마다 다음 순서로 한다.
   1. `git fetch origin && git switch <기본브랜치> && git pull --ff-only origin <기본브랜치>` 뒤 머지 직전
      HEAD 를 기록한다.
   2. **승인 뒤 변경 확인**: 증적 head_sha 가 로컬에 있고 머지 대상의 조상이며
      (`git merge-base --is-ancestor <증적 head_sha> <머지 대상>` 이 참), `git diff --name-only <증적 head_sha>..<머지 대상>`
      이 성공해 그 작업의 `docs/tasks/<TSK>/state.json` 뿐이거나 비어 있으면 머지한다. 다른 파일이 있으면
      "건너뜀(승인 뒤 변경)", head_sha 가 로컬에 없거나 머지 대상의 조상이 아니거나 `git diff` 가 실패하면
      "건너뜀(승인 뒤 변경 확인 불가)" 로 보고한 뒤 다음 후보로 간다. `<증적 head_sha>` 는 1번 show 출력의
      `head_sha` 다. 이유: 원격 후보를 받으므로 승인 뒤 같은 agent 브랜치에 올라온 커밋까지 머지 대상이 되는데,
      사람이 승인한 것은 증적의 head_sha 까지다. tip 이 head_sha 와 같은지만 보면 `/dflow-dev` Phase 5 의
      `reported` 커밋 때문에 늘 다르다. 확인하지 못한 경우를 건너뛰는 이유: `git diff` 가 오류로 끝나면 출력이
      비어 "비어 있으면 머지" 로 읽히기 때문이다. 증적에 `head_sha` 자체가 없는 옛 완료 보고는 이 확인을
      건너뛰고 지금처럼 머지하되 보고에 "승인 뒤 변경 확인 불가" 를 붙인다. 수동 경로가 머지하던 후보를
      거부하면 퇴행이기 때문이다.
   3. `git merge --no-ff <머지 대상>`. 충돌하면 `git merge --abort` 로 되돌리고 "머지 실패(충돌)" 로
      보고한 뒤 다음 후보로 간다. 이유: 충돌 상태로 남으면 체크아웃이 더러워져, 팀장이면 이후 모든
      기상이 전제 검사에서 멈추고 수동이면 사람이 그 상태를 치워야 한다.
   4. state.json 을 `phase=merged` 로 갱신해 기본 브랜치에 커밋한다(파일명 명시). 이 커밋을 **push 전에**
      만든다.
   5. `git push origin <기본브랜치>` 로 머지와 `merged` 커밋을 한 번에 올린다. push 가 실패하면 먼저
      `git reset --keep <기록한 HEAD>` 로 되돌리고, 거부 모양으로 가른다.
      - 출력에 `non-fast-forward` 나 `fetch first` 가 있으면 경합이다. "push 실패(경합)" 로 보고하고 스윕을
        멈춘다. 다음 실행은 fetch 부터 다시 한다. 이유: 다른 스윕이 먼저 머지한 것이라 fetch 부터 다시 해야
        후보가 맞다.
      - 그런 문구 없이 1 로 끝나면 훅 거부다(로컬 pre-push 훅은 고정 문구 없이 훅 출력과
        `failed to push some refs` 만 남긴다). "push 실패(훅)" 로 보고하고 그 작업과 그 후손(3번의 스택 관계)만
        빼고 다음 후보로 간다. 이유: 훅이 막은 작업은 사람이 풀 때까지 매번 막히므로 그 한 건이 뒤의
        승인분까지 막으면 안 되며, `/dflow-dev` Phase 0-가 의 원문도 이 작업만 건너뛰고 스윕을 계속했다.
      - 그 밖의 실패(128 등 연결·권한 오류)는 "push 실패" 로 보고하고 스윕을 멈춘다. 원인을 모르는
        실패에서 머지를 계속 시도하지 않는 것이 지금 동작이기 때문이다.

      `origin` 으로 리셋하지 않는다. 이유: 수동 사용자의 기본 브랜치에 있던 미push 커밋을 보호한다. 훅 거부를
      우회하지 않는 것은 그대로다.
   `--no-ff` 고정 — 작업 단위 경계가 머지 커밋으로 남아야 추적이 된다. push 가 훅에 거부되면
   우회 금지. 되돌리고 보고한 뒤 그 작업과 후손만 빼는 절차는 위 5단계다.
5. **뒷정리** (머지된 작업마다):
   - 머지된 `agent/` 브랜치를 지운다. 원격 agent 브랜치 삭제(`git push origin --delete agent/<id8>-<slug>`)는
     그대로 한다. 로컬 삭제(`git branch -d agent/<id8>-<slug>`)는 브랜치가 없거나(not found) 다른 워크트리가
     잡고 있으면(checked out) 건너뛰고 보고한다. 원격 전용 후보에는 로컬 브랜치가 없고, 팀원 워크트리가 그
     브랜치를 잡고 있을 수 있기 때문이다. 아직 미승인 후손 스택 브랜치는 **삭제·rebase
     하지 않는다** — 이미 머지된 커밋을 조상으로 포함하므로 그대로 두면 제 차례에 깨끗이 머지된다.
6. **보고**: 머지됨 / 승인 대기 / 반려: 재작업 필요 (<review_note>) / 머지 실패(충돌) / push 실패(경합) /
   push 실패(훅) / push 실패 / 건너뜀(서버 <status>·조회 실패·다른 D'Flow·조상 미승인·기점 미반영·승인 뒤 변경·
   승인 뒤 변경 확인 불가·로컬 브랜치 삭제 건너뜀)을 표로. 반려·머지 실패(충돌)·push 실패(훅)는 id8 과 함께 따로
   적는다. 호출자(`/dflow-team` 팀장 등)가 이 목록으로 후속 처리를 한다.

## 금지

- approved 아닌 작업의 머지(reported·claimed 포함). 서버 approve 시도.
- force push. 훅 우회(SKIP_GUARD).
- 머지 순서 뒤집기(후손 먼저).
- 대상 저장소가 wbs-web 자신이면 G1~G4 훅 제약을 사용자에게 사전 경고.
