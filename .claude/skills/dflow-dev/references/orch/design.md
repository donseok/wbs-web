# /dflow-dev 단계 — Design 게이트와 구현 전환

SKILL.md 「단계 지도」 가 가리킬 때 읽는다. 다 읽기 전에 이 단계를 시작하지 않는다. 모든 단계에 공통인 규칙(게이트 집행 원칙·상태 모델·서버 통신)은 SKILL.md 에 있다.

### Design 게이트

범위가 `build` 면(`orch/start.md` 「구현부터」·「설계 검토 대기」) Design 서브에이전트를 띄우지 않는다 — 이미 있는 design.md 로 곧바로
Design 게이트를 돈다. 게이트가 통과하면 design.md 를 새로 커밋할 것은 없다(개발 브랜치나 agent 브랜치에 이미 있다).

   - **Design 게이트 뒤 구현 전환**: Design 게이트가 통과하면 아래 모듈 기준선보다 먼저 `dflow.sh build-start <ref>` 를 부른다(늘
     부른다 — 옛 서버는 `BUILD_START_UNSUPPORTED` 로 넘어간다). exit 4 면 Build 로 가지 않고 설계 완료·선행 대기로 멈춘다. 갈래와
     멈춤 절차는 「설계 선행」 2.
   - **Design 게이트 뒤(대응표가 있을 때만)**: 첫 Build 단위를 띄우기 전에 모듈 게이트 명령의 기준선을 잰다. design.md
     「변경 파일 목록」 의 경로를 파일에 적어 `gate-scope.sh --base <기점> --ignore <TASKS>/<TSK>/ --paths-file <파일>` 로
     예측 범위를 보고, `module` 줄의 명령마다 `baseline.sh run --base <기점> --task-dir <TASKS>/<TSK> -- '<명령>'` 으로 잰다.
     트리가 기점과 코드가 같을 때(`git diff --name-only <기점>..HEAD` 와 `git status --porcelain` 이 Task 문서 밖에서 빔)만
     잰다. 결과는 state.json `baseline.cmds` 에 `"scope": "module"` 을 붙여 더한다. 정본은 dev-discipline 「게이트 범위 대응표(.dflow-gates)」.

2. **Design 게이트 뒤**(위 「Design 게이트」): `dflow.sh build-start <ref>` 의 결과로 가른다. 모드와 무관하게 늘 부른다.

   | 결과 | 처리 |
   |---|---|
   | exit 0 | Build 로 간다(종전) |
   | exit 0 + stderr `BUILD_START_UNSUPPORTED` | 옛 서버다(404 이고 계약 < 2.9 — claim 이 이미 `ip` 로 보냈다). Build 로 간다 |
   | exit 4 | 설계 완료·선행 대기로 멈춘다(아래 멈춤 절차) |
   | exit 10 | 중단(상태 모델) |
   | 그 밖 | Build 로 가지 않고 중단·보고한다. `phase` 는 `design` 그대로라 재실행하면 Design 게이트 뒤에서 다시 부른다. 워커는 `failed build-start <exit>` |


### 설계만 멈춤 (`--scope design`)

범위가 `design` 이면 Design 게이트가 통과한 뒤 `build-start` 를 **부르지 않는다**(부르면 서버 단계가 `ip` 로 넘어간다). 모듈 기준선도
재지 않는다. 대신 이 순서로 멈춘다.
1. design.md 커밋을 확인한다(없으면 파일명 명시 커밋).
2. state.json `phase` 를 `wait_review` 로 쓰고 파일명을 명시해 커밋한다(`DFlow-Order` 트레일러). 그 다음 `progress 25 "설계 완료(검토 대기)"`
   를 보낸다.
3. `git push origin <agent 브랜치>` 로 설계를 원격에 남긴다(사람의 검토와 다른 PC·새 워크트리의 재개가 그 브랜치를 쓴다). 훅에 거부되면
   우회하지 않고 보고한다.
4. `dflow.sh heartbeat <ref> --phase wait_review` 를 부른다. 실패해도(계약 2.10 전 서버는 400) 멈춤을 계속한다 — 좌석 이름표만 틀리고,
   이어 갈지는 로컬 state.json 으로 판정한다.
5. supervised 는 `"{TSK} 설계 완료·검토 대기 — design.md 를 검토·수정한 뒤 /dflow-dev {TSK} --scope build 로 이어 간다"` 로 알리고 끝낸다.

미충족 선행이 있어도 같다(claim 이 설계 선행 모드였으면 `design_first.unmet` 이 이미 적혀 있다). 선행 판정은 `--scope build` 로 이어 갈
때 `orch/design-first.md` 「3」 이 한다. `wait_pred` 를 쓰지 않는 이유: 팀장은 선행이 풀린 `wait_pred` 워크트리를 자동으로 Build 로
재개한다 — 사람이 검토하기 전에 구현이 시작되면 안 된다.
<!-- worker:begin -->
`--worker` 면 5 대신 `.result` 에 `{TSK} {ID8} <branch> <head_sha> - design_review` 를 쓰고 끝낸다(형식 정본은 worker-prompt.md).
<!-- worker:end -->

**다음 단계**: 범위 `design` 이면 여기서 끝난다. 아니면 `build-start` exit 0 이면 `orch/build.md`, exit 4 면 `orch/design-first.md` 「2」.
