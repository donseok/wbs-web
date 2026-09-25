# /dflow-merge 방언 검증

스윕(`--resolve` 아님)이 SKILL.md 「절차」 6번 보고 직전에 읽는다. 스윕이 중간에 멈췄어도, 머지가 0건이어도 돈다(보류된 커밋을
다시 시도한다). 규칙의 머리는 SKILL.md 「방언 검증」 이다(스윕 한 번에 한 번, 머지마다 돌리지 않는다, 도커 런타임을 켜지 않는다).

## 방언 검증

- **명령**: 대상 리포 설정의 `dialect_check` 다(`dflow.sh config dialect_check`). `.dflow`(리포 공통)에 적고, PC 전용
  값(JAVA_HOME 등)이 든 명령은 `.dflow.local` 이 덮는다(export 된 `DFLOW_DIALECT_CHECK` 가 둘 다 덮는다). 키가 없으면 이
  단계는 없다(`DIALECT_NONE`). 값은 임시 워크트리의 최상위에서 `bash -c` 로 돌므로 `cd <폴더> && VAR=값 <명령>` 형태를
  그대로 받는다. 예: `dialect_check=cd src/backend/mdm && ../gradlew :api:mssqlMigrationTest --no-daemon --console=plain`.
  설정 파일은 값 뒤의 ` #…` 를 주석으로 자르므로 명령에 ` #` 를 쓰지 않는다. 임시 워크트리에는 추적 파일만 있다
  (`.dflow.local`·`node_modules`·빌드 산출물 없음). 준비가 필요하면 명령 안에 넣는다(예 `npm ci && npm run test:mssql`).
- **돌리는 법**: 호출한 체크아웃의 최상위에서 한 번 부른다(`<스윕 전 sha>` 는 SKILL.md 「방언 검증」 대로 기록해 둔 값).
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
  다음 스윕이 같은 커밋을 다시 시도한다. 죽은 앞 호출이 남긴 임시 워크트리는 다음 호출이 치운다.
- **실패**: `DIALECT_FAIL <sha> exit=<n> since=<직전 통과> tasks=<그 뒤 머지된 Task…> unverified=<…> log=<로그>`. tasks 는
  직전 통과 커밋(없으면 스윕 전 sha) 이후 개발 브랜치에 머지된 Task 다(머지 커밋 제목 `merge: <TSK> …`). 자동으로 되돌리거나
  Task 를 재오픈하지 않는다 — 보고만 한다.
- **확인하지 못한 항목 대조**: 같은 범위에서 design.md·resolution.md 에 `도커 금지로 생략:`·`확인하지 못한 수용 기준:` 줄을
  남긴 Task 를 결과 줄 앞에 `DIALECT_UNVERIFIED <TSK> 생략=<n> 미확인=<m> <파일>` 로, 결과 줄에 `unverified=` 로 적는다.
  통과든 실패든 싣는다 — 워커가 도커 금지로 확인하지 못한 수용 기준을 이 결과와 사람이 대조한다.
- 결과는 출력하기 전에 상태 파일에 먼저 적는다. 호출이 10분을 넘겨 백그라운드로 옮겨지거나 결과를 놓쳤으면
  `dialect-check.sh status --dev <기본브랜치>` 가 마지막 결과를 다시 낸다.
- 결과 줄(`DIALECT_*`)과 `DIALECT_UNVERIFIED` 줄은 보고 표 아래에 그대로 싣는다. 호출자(`/dflow-team` 팀장)의 보고·기록
  방법은 그 스킬의 「4. 승인 스윕」 이다.
