# /dflow-dev 단계 — 착수 — show 판정과 갈래

SKILL.md 「단계 지도」 가 가리킬 때 읽는다. 다 읽기 전에 이 단계를 시작하지 않는다. 모든 단계에 공통인 규칙(게이트 집행 원칙·상태 모델·서버 통신)은 SKILL.md 에 있다.

## Phase 01 — Claim·브랜치·기준선 (오케스트레이터 본인)

> Phase 01 의 번호는 네 파일에 이어진다: 1 이 파일, 2 `orch/base.md`, 3 `orch/claim.md`, 4~6 `orch/baseline.md`.

`<기본브랜치>` 는 개발 브랜치, 즉 `dflow.sh branch dev` 의 값이다(`.dflow.local` 의 `dev_branch`, 레거시는
`origin/HEAD`). 팀원은 팀장이 넘긴 `DEV_BRANCH` 를 쓴다. 개발 브랜치가 원격에 없으면 멈추지 말고 먼저
`.claude/skills/dflow-work/scripts/dflow.sh branch ensure-dev` 로 운영 브랜치에서 만든다(실패하면 그 사유로 중단·보고).

작업 폴더 `<TASKS>` 는 `<DOCS_DIR>/tasks` 다(리포 최상위 기준). 한 주문의 폴더 `<TASKS>/<TSK>` 는
`dflow.sh taskdir <ref>` 의 값이다 — `.dflow.local` 의 `project_map` 에서 그 주문의 프로젝트 키를, 없으면 `docs` 를 쓴다.
여러 작업을 훑을 때는 `dflow.sh config tasks-dirs` 가 내는 폴더 전부를 본다. `<DOCS_DIR>` 를 `docs` 로 박아 둔
고정 경로는 쓰지 않는다.

1. `dflow.sh doctor` (세션 첫 호출 시). `dflow.sh show <ref>` 로 상태 확인:
   ready → 착수 가능 판정(2번) 후 claim / claimed → **반려 판정 먼저(아래), 아니면** 재개 판정(SKILL.md 상태 모델) /
   reported → 종료 / approved → 위 Phase 01-가 스윕이 이미 처리했어야 함(로컬 state.json 이 없는
   작업이라 스윕이 못 봤을 수 있다 — 그 경우 지금 즉시 같은 머지 절차를 이 ref 하나로 실행 후 종료).
   <!-- worker:begin -->
   `--worker` 면 머지하지 않고 `needs-merge` 로 끝낸다(「--worker」 C).
   <!-- worker:end -->
   이 머지도 `/dflow-merge` SKILL.md 4번 절차다 — Phase 01-가 가 `SWEEP_NONE` 으로 건너뛰어 아직 읽지 않았으면 먼저 읽는다.

   **반려 재작업 경로** — 로컬 `phase=reported`(또는 승인 뒤 재작업 요청이면 `merged`)인데
   서버 `status=claimed` 이면 반려를 의심한다.
   판정은 show 응답 최상위 `.reports` 의 마지막 `kind=completion` 리포트: `review_action=reject`
   면 반려다(`review_note` 가 사유). 이때:
   반려면 `orch/rework.md` 를 읽고 그대로 한다.

   **설계 선행 재개** — 서버 `status=claimed`·`mine=true` 이고 이 작업의 agent 브랜치(로컬 `agent/<주문id8>-*`, 없으면
   `origin/agent/<주문id8>-*`) tip 의 state.json 이 `phase=wait_pred` 면 claim·격리를 하지 않고 `orch/design-first.md` 「3」 으로 간다(반려
   판정은 먼저 한다). 현재 트리가 아니라 그 브랜치에서 읽는다 — `git show <그 브랜치>:<TASKS>/<TSK>/state.json`. 워커는 부트스트랩이
   기본 브랜치로 detach 해 두었고, 거기 있는 state.json 은 scaffold 의 `ready` 이거나 없다.

   **설계 검토 대기** — 위와 같은 조건에서 그 브랜치 tip 의 state.json 이 `phase=wait_review`(설계만으로 멈춤)면 claim·격리를 하지 않는다.
   범위가 `build` 가 아니면 이어 가지 않는다 — supervised 는 `"{TSK} 설계 검토 대기 — design.md 를 검토한 뒤 /dflow-dev {TSK} --scope build
   로 이어 간다"` 로 알리고 끝낸다. 범위가 `build` 면 `orch/design-first.md` 「3」 재개를 그대로 타되 다섯이 다르다:
   - 「3」 0 의 switch 대신 **사람이 고친 설계를 받아 온다.** 사람은 검토하며 design.md 를 고쳐 origin 에 올린다. `git fetch origin` 뒤
     로컬 `agent/<주문id8>-*` 가 없으면 「3」 0 그대로 origin 에서 만든다. 있으면 그 브랜치로 switch 하고, 로컬이 origin 의 조상이면
     `git merge --ff-only origin/<그 브랜치>` 로 맞추고, origin 이 로컬의 조상이면 그대로 둔다. 둘 다 아니면(갈라짐) 이어 가지 않고
     두 끝의 sha 를 적어 보고하고 멈춘다(`phase` 는 `wait_review` 그대로).
   - 받아 온 **바로 뒤, 아무것도 커밋하기 전에 Design 게이트를 다시 돈다** — 사람이 검토하며 design.md 를 고쳤을 수 있다. 통과하지
     못하면 빠진 절을 적어 보고하고 멈춘다(`phase` 는 `wait_review` 그대로, 커밋 없음).
   - state.json `scope` 를 `build` 로 바꾼다(다음 커밋에 실린다). `design` 이 남으면 인자 없이 다시 돌리거나 검토 모드로 Design 을 다시
     띄울 때 또 설계만 하고 멈춘다.
   - 「3」 5(선행 계약 재확인)는 design.md 에 `## 선행 기준` 절이 있을 때만 한다. 설계만으로 만든 설계는 선행이 충족된 채 설계했으면 이
     절이 없고, 그때는 바뀐 파일이 없는 것으로 본다.
   - 3 의 1 에서 선행이 미충족이라 다시 멈추면, 멈춤 절차 4·5 전에 state.json `phase` 를 `wait_pred` 로 바꿔 파일명을 명시해 커밋하고
     push 한다. 검토는 끝났고 이제 선행만 기다리므로 선행이 풀리면 팀장이 자동으로 이어 가는 것이 맞다.

### 구현부터 (`--scope build`)

ready 갈래에서 범위가 `build` 면 **claim 전에** 사람이 쓴 설계를 확인한다(개발자동 — 설계는 사람, 구현은 에이전트).
1. `git fetch origin` 뒤 `git show origin/<기본브랜치>:<TASKS>/<TSK>/design.md` 로 읽는다(`<TASKS>/<TSK>` 는 `dflow.sh taskdir <ref>`). 없으면
   착수하지 않고 "설계 문서 없음" 으로 보고한다.
2. SKILL.md 「게이트 집행 원칙」 의 Design 게이트 최소 구조 5절이 모두 있는지 본다. 빠진 절이 있으면 착수하지 않고 빠진 절을 적어
   보고한다. **빠진 절을 스스로 채우지 않는다** — 이 범위의 전제는 사람이 설계한다는 것이다.
3. 통과하면 종전대로 `orch/base.md` → `orch/claim.md` 로 간다. design.md 가 든 그 폴더는 재claim 격리 대상이 아니다(`orch/claim.md`).
   Design 단계에서는 Design 서브에이전트를 띄우지 않고 곧바로 Design 게이트를 돈다(`orch/design.md`).
<!-- worker:begin -->
`--worker` 면 보고 대신 `.result` 를 쓰고 끝낸다: 1 은 `skipped design_missing`, 2 는 `skipped design_invalid <빠진 절>`, 「설계 검토
대기」 에서 범위가 `build` 가 아니면 `design_review`, 갈라짐이면 `failed diverged <로컬 sha> <origin sha>`(형식 정본은 worker-prompt.md).
<!-- worker:end -->

**다음 단계**: ready 는 `orch/base.md` → `orch/claim.md`, 반려는 `orch/rework.md`, 설계 선행 재개는 `orch/design-first.md` 「3」, 그 밖의 재개는 state.json `phase` 의 단계 지도 행.
