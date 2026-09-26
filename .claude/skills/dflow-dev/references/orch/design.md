# /dflow-dev 단계 — Design 게이트와 구현 전환

SKILL.md 「단계 지도」 가 가리킬 때 읽는다. 다 읽기 전에 이 단계를 시작하지 않는다. 모든 단계에 공통인 규칙(게이트 집행 원칙·상태 모델·서버 통신)은 SKILL.md 에 있다.

### Design 게이트

   - **Design 게이트 뒤 구현 전환**: Design 게이트가 통과하면 아래 모듈 기준선보다 먼저 `dflow.sh build-start <ref>` 를 부른다(늘
     부른다 — 옛 서버는 `BUILD_START_UNSUPPORTED` 로 넘어간다). exit 4 면 Build 로 가지 않고 설계 완료·선행 대기로 멈춘다. 갈래와
     멈춤 절차는 「설계 선행」 2.
   - **Design 게이트 뒤(대응표가 있을 때만)**: 첫 Build 단위를 띄우기 전에 모듈 게이트 명령의 기준선을 잰다. design.md
     「변경 파일 목록」 의 경로를 파일에 적어 `gate-scope.sh --base <기점> --ignore <TASKS>/<TSK>/ --paths-file <파일>` 로
     예측 범위를 보고, `module` 줄의 명령마다 `baseline.sh run --base <기점> --task-dir <TASKS>/<TSK> -- '<명령>'` 으로 잰다.
     트리가 기점과 코드가 같을 때(`git diff --name-only <기점>..HEAD` 와 `git status --porcelain` 이 Task 문서 밖에서 빔)만
     잰다. 결과는 state.json `baseline.cmds` 에 `"scope": "module"` 을 붙여 더한다. 정본은 dev-discipline 「게이트 범위 대응표(.dflow-gates)」.

2. **Design 게이트 뒤**(Phase 02~05 「Phase 종료마다」 1번): `dflow.sh build-start <ref>` 의 결과로 가른다. 모드와 무관하게 늘 부른다.

   | 결과 | 처리 |
   |---|---|
   | exit 0 | Build 로 간다(종전) |
   | exit 0 + stderr `BUILD_START_UNSUPPORTED` | 옛 서버다(404 이고 계약 < 2.9 — claim 이 이미 `ip` 로 보냈다). Build 로 간다 |
   | exit 4 | 설계 완료·선행 대기로 멈춘다(아래 멈춤 절차) |
   | exit 10 | 중단(상태 모델) |
   | 그 밖 | Build 로 가지 않고 중단·보고한다. `phase` 는 `design` 그대로라 재실행하면 Design 게이트 뒤에서 다시 부른다. 워커는 `failed build-start <exit>` |


**다음 단계**: `build-start` exit 0 이면 `orch/build.md`, exit 4 면 `orch/design-first.md` 「2」.
