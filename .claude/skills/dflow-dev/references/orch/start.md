# /dflow-dev 단계 — 착수 — show 판정과 갈래

SKILL.md 「단계 지도」 가 가리킬 때 읽는다. 다 읽기 전에 이 단계를 시작하지 않는다. 모든 단계에 공통인 규칙(게이트 집행 원칙·상태 모델·서버 통신)은 SKILL.md 에 있다.

## Phase 01 — Claim·브랜치·기준선 (오케스트레이터 본인)

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

**다음 단계**: ready 는 `orch/base.md` → `orch/claim.md`, 반려는 `orch/rework.md`, 설계 선행 재개는 `orch/design-first.md` 「3」, 그 밖의 재개는 state.json `phase` 의 단계 지도 행.
