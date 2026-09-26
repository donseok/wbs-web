# /dflow-dev 단계 — 기점 이동·claim·브랜치

SKILL.md 「단계 지도」 가 가리킬 때 읽는다. 다 읽기 전에 이 단계를 시작하지 않는다. 모든 단계에 공통인 규칙(게이트 집행 원칙·상태 모델·서버 통신)은 SKILL.md 에 있다.

### 재claim 잔재 격리(상태 모델)

- **재claim 시 이전 시도의 잔재 격리**: claim 하려는 작업의 `<TASKS>/<TSK>/` 가 이미 있으면
  `<TASKS>/<TSK>.prev-<날짜>/` 로 옮긴 뒤 시작한다(stale state 로 Phase 건너뜀 방지).
  **반려 재작업은 예외** — 산출물이 심사 대상이었던 그 트리이므로 옮기지 않고 그 위에서 고친다.
  **재개도 예외다.** show 가 `status=claimed` 이고 `mine=true` 면 이미 잡은 작업이라 claim 도 격리도 하지 않는다. 격리는
  **신규 claim 경로에서만** 돈다(잘못 돌면 design.md 가 `.prev-` 로 밀려 Design 부터 다시 한다).
  **scaffold 가 만든 폴더도 예외다.** 폴더 안에 `state.json` 하나만 있고 `phase=ready` 이면 잔재가 아니다(`dflow.sh scaffold`
  가 미리 만든 자리). 옮기지 않고 `order`·`api_base` 를 이번 claim 값으로 덮어쓴 뒤 진행한다(남이 만든 ready 파일도 같다).
  파일이 더 있거나 `phase` 가 `ready` 가 아니면 종전대로 격리한다.
  **구현부터(`--scope build`)의 설계 폴더도 예외다.** 사람이 쓴 design.md 가 든 폴더는 입력이다. 옮기지 않고, state.json 이 있으면
  `order`·`api_base` 를 이번 claim 값으로 덮어쓴다(없으면 `prepare` 쓰기에서 만든다).

### 기점 이동과 claim

   - **claim 전 기점 이동은 항상 한다.** 옮기기 전에 원래 위치를 기록한다.
     ```bash
     git symbolic-ref -q --short HEAD || git rev-parse HEAD
     ```
     그 다음 기점이 `origin/<기본브랜치>` 여도 detach 한다(무관한 브랜치의 HEAD 를 보고 claim 이 exit 4 를 내지 않게).
     ```bash
     git fetch origin && git switch --detach <기점>
     ```
     해당 agent 브랜치(`agent/<주문id8>-*`)가 이미 있으면(재개) detach 대신 그 브랜치로 switch 한다.
   - 기점 이동이 실패하면 claim 하지 않고 중단·보고한다(detach 와 재개 브랜치 switch 모두. 워커는 `.result` 에
     `failed detach`). 거부된 switch 는 HEAD 를 옮기지 않으므로 복귀할 것은 없다.
   - claim 이 `PROJECT_MISMATCH`(exit 2)로 거부되면 그 주문은 이 리포에 바인딩된 D'Flow 프로젝트 밖이거나 리포에
     바인딩(`.dflow` 의 `project_id`·`.dflow.local` 의 `project_map`)이 없다. 재시도하지 않고 원래 위치로 돌아가 중단·보고한다.
     워커는 `.result` 에 `failed project <메시지>` 를 쓴다.
   - **claim 명령**: `dflow.sh contract-ge 2.9` 가 exit 0 이면 늘 `dflow.sh claim <ref> --design-first` 다(선행이 모두 충족돼도
     그렇다 — 단계 `ds` 가 "설계 중" 이라는 뜻을 늘 갖게 한다). 아니면 종전 `dflow.sh claim <ref>`. 출력에 `DESIGN_FIRST_UNMET` 줄이
     있으면 설계 선행 모드다(「설계 선행」 1). exit 4 에 stderr `DESIGN_FIRST_TOO_EARLY` 면 아래 재시도를 하지 않는다(선행이
     착수하기 전에는 다시 해도 같다) — 원래 위치로 돌아가 "선행 <ref:stage…> 이 구현 전이라 설계 선행 불가" 로 보고한다.
   - claim 이 exit 4(선행·상태로 인한 진행 불가. 서버 403 `dependency_not_met` 재매핑 포함)면
     `git fetch origin` 뒤 기점을 다시 정해(다시 옮겨) 1회 재시도하고, 그래도 4 면 중단·보고한다. 우회
     금지. merge 는 하지 않는다(기본 브랜치를 사용자의 현재 브랜치에 섞는다).
   - detach 부터 3번의 `git switch -c` 성공까지의 **모든 실패**(claim 실패, 브랜치 생성 실패 포함)에서
     기록한 원래 위치로 돌아간다. 브랜치면 `git switch <기록한 브랜치>`, 아니면
     `git switch --detach <기록한 sha>` 다. `git switch -` 는 쓰지 않는다(직전 위치는 기록한 위치와 다를 수 있다).
3. **브랜치를 오케스트레이터가 직접 만든다** — dflow.sh 는 브랜치를 만들지 않는다(스크립트 실측).
   기점 규칙(2번이 claim 전에 이 규칙으로 기점을 정해 HEAD 를 이미 그 기점에 옮겨 두었다):
   - 기본: `origin/<기본브랜치>`
   - 선행이 approved 인데 main 미반영이거나 미승인(스택)이면: **선행 산출물이 있는 agent/
     브랜치 위**에 만들고, state.json 에 `branch_base`(기점 커밋 sha)·`risk`(선행 반려 시 재작업)와 `api_base`(상태 모델)를 기록한다.
   ```bash
   git switch -c agent/<주문id8>-<slug> <기점>
   ```
   **agent 브랜치에 올라서면 곧바로 state.json 의 `phase` 를 `prepare` 로 쓴다** — 설치·기준선·spec 판정 동안에도 heartbeat
   훅이 신호를 보내게 한다(훅은 `ready` 를 보내지 않는다). claim 직후가 아니라 여기서 쓴다(복귀 switch 를 막지 않게).
   - 파일이 없거나 `phase` 가 `ready` 일 때만 쓴다. 재개로 이미 뒤 단계(`design` 이후)가 적혀 있으면 덮어쓰지 않고,
     반려 재작업 경로(`phase=rejected`)에서는 쓰지 않는다.
   - 이 쓰기가 state.json 의 첫 기록이면 `order`(전체 UUID)와 `api_base`(상태 모델)를 함께 적는다. 커밋은 하지 않는다
     (다음 커밋에 실린다).
   - 범위가 `full` 이 아니면(SKILL.md 「실행 범위」) 같은 쓰기에서 `scope`(`design`|`build`)를 함께 적는다.
   이미 해당 브랜치면 재개. **main·staging 위에서 사이클 진행 금지** — Phase 진입 전
   `git branch --show-current` 가 `agent/` 로 시작하는지 확인하고, 아니면 중단한다.
   <!-- worker:begin -->
   `--worker` 면 여기서 의존성을 설치한 뒤 4번으로 간다(「--worker」 H).
   설치 절차는 worker-mode.md 「행 H」 다 — `.claude/skills/dflow-dev/scripts/sections.sh .claude/skills/dflow-dev/references/worker-mode.md '행 H'` 로 읽는다.
   <!-- worker:end -->

**다음 단계**: claim 출력에 `DESIGN_FIRST_UNMET` 줄이 있으면 `orch/design-first.md` 「1」 을 한 뒤, `orch/baseline.md`.
