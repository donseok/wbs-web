# D'Flow 킷 개발 성능 개선 설계 (dmes-standard 성능 감사 반영)

- 작성: 2026-09-26. 요청: dmes-standard-12 팀장 세션(사용자 승인 "5건 모두", Gradle 킷 확장은 측정 1차 결과 수신 후 착수 지시).
- 근거: `dmes-standard/docs/dflow-team/perf-audit-report.md`(P1·P3·P4·P5·모순 표), gradle-tuning 1차 측정(chore/gradle-tuning 7c12e49).
- 범위: wbs-web 정본 스킬(`.claude/skills/dflow-*`)과 `kit/`. 앱 코드·DB 변경 없음. 반영은 staging 까지.

## 공통 제약

1. **옛 heavy.sh 와 새 heavy.sh 가 같은 잠금 폴더(`~/.dflow/locks/heavy`)를 동시에 쓴다.** dmes-standard 는 wbs-web 본
   체크아웃을 심볼릭 링크로 읽으므로 pull 직후 이미 떠 있는 옛 프로세스가 남는다. 새로 만드는 파일·폴더는
   - 옛 코드의 glob(`slot-*`·`docker-*`·`wait-*`)에 걸리지 않는 이름을 쓴다(`e2e-<i>`, `excl-<소유PID>-<heavy.sh PID>`, jobs 는 잠금 폴더 밖).
   - 옛 코드가 이들을 모르면 무시될 뿐 쓰레기로 지우거나 수를 틀리게 세지 않아야 한다.
2. **기계가 읽는 출력 형식을 바꾸지 않는다.** `HEAVY_STATUS slots=<K> held=<N> waiting=<M>`(capacity.sh), `snapshot` 의
   `PC/RUN/WAIT` 줄(dflow-lease.sh → 앱 `heavyWork.ts` 가 `pool ∈ {general, docker}`, `kind ∈ {run, hold}` 만 받는다).
   새 경우는 기존 값으로 매핑한다: E2E 풀 보유 → `RUN … hold general …`, 독점 실행 → `RUN … run general …` 한 줄.
3. **heartbeat 상한**: 팀장은 도구 호출이 약 5분 없으면 무응답으로 본다. 한 번의 Bash 안에서 막히는 대기는 240초 이하로 둔다.
4. **계약 테스트가 문구를 고정한다**(`tests/skills/*`). 바꾸는 문구는 테스트도 같이 고친다.

## ① 백그라운드 정지 방지

- `DFLOW_HEAVY_WAIT` 기본 240 → **90**. `DFLOW_BASELINE_WAIT` 기본도 240 → **90**(baseline.sh 는 마감을 나눠 쓰므로 같은 값).
  Bash 기본 timeout 120초 안에서 `HEAVY_BUSY`/`BASELINE_BUSY`(exit 75)로 돌아온다. 문서의 "240초"·"4분" 표기를 모두 고친다.
- **PreToolUse 가드 훅** `.claude/skills/dflow-dev/scripts/timeout-guard.sh`:
  - 등록은 **팀원 전용 설정**(`~/.dflow/limits/<id8>.settings.json`, backends.md 「팀원 워크트리 준비」 jq 블록)에만 한다.
    전역 `~/.claude/settings.json` 은 건드리지 않는다. 수동 세션용 등록 방법은 README 에 선택 사항으로 적는다.
  - 등록 명령은 heartbeat 와 같은 가드형: 스크립트가 없으면 stdin 을 비우고 통과.
  - 대상: **명령 위치**에 오는 `heavy.sh`(단 `status`·`snapshot`·`release` 하위 명령 제외), `baseline.sh run`, `gradlew`, `mvn`/`mvnw`,
    `playwright test`. 인자 자리(`sed … heavy.sh`, `grep heavy.sh`)는 대상이 아니다.
  - 판정: `timeout` 이 없거나 300000 미만이면 exit 2 + 이유("timeout 을 300000~600000 으로 주고 다시 호출"). 대상 명령을
    `run_in_background: true` 로 부르면 거부한다. 단 E2E 서버 기동(`bootRun`·`java -jar`·`next dev`·`pnpm dev` 등, e2e.md 절차)은 허용한다.
  - 한 번은 실제로 확인한다: `--settings` 로 준 PreToolUse 훅이 `--dangerously-skip-permissions` 아래에서 돌고 exit 2 가 막는지,
    Phase 서브에이전트(Agent 도구) 안의 Bash 에도 걸리는지.
- **분리 실행 + 폴링**: 부하가 높아 한 번에 10분을 넘는 명령용.
  - `heavy.sh --detach <명령>`: 잡 폴더 `~/.dflow/jobs/<id>/`(워크트리 밖)에 `cmd`·`cwd`·`log`·`pid` 를 쓰고, `nohup` 으로 띄운
    자식이 `heavy.sh <명령>` 을 돈다(슬롯 소유자는 그 자식. 대기 상한은 길게). 끝나면 `rc` 를 임시 파일→mv 로 원자적으로 쓴다.
    곧바로 `HEAVY_DETACHED id=<id> pid=<pid> log=<경로>` 를 내고 exit 0.
  - `heavy.sh wait <id> [--max <초>]`(기본 240, 상한 240): 끝나면 로그 끝 30줄 + `HEAVY_JOB_DONE id=<id> rc=<rc>` 를 내고 명령의 rc 로
    끝난다. 아직이면 `HEAVY_JOB_RUNNING id=<id> elapsed=<초>s` 와 exit 76 — 실패가 아니며 같은 명령을 다시 부른다.

## ② 독점 실행 `heavy.sh --exclusive <명령>`

벽시계 성능 테스트처럼 다른 무거운 명령과 겹치면 안 되는 명령용.
- 일반 슬롯 K개를 **한꺼번에** 잡는다. 하나라도 못 잡으면 잡은 것을 모두 돌려주고 다시 시도한다(부분 보유로 기다리지 않는다 — 교착 방지).
- **양보 표식** `<DIR>/excl-<소유 PID>-<heavy.sh PID>`(pid·hpid·pstart·start·seen·cwd·cmd): 독점 대기자가 있으면 새 일반 `take` 는 슬롯을 잡지 않는다(비우기).
  표식은 `HEAVY_BUSY` 로 돌아와도 남아 재호출 사이에 이어진다. 소유 PID(CLAUDE_PID) 가 죽었거나 재호출 공백 TTL(`DFLOW_HEAVY_EXCL_TTL`, 기본 180초, 리뷰 뒤 1800초에서 줄임)이
  지나면 무시·회수한다. 독점 실행이 끝나면 지운다. 표식이 여럿이면 가장 오래된 것만 진행한다.
- 이미 슬롯을 쥔 세션(acquire·감싼 실행 안)에서 부르면 거부한다(`HEAVY_EXCL_NESTED`, exit 2).
- 옛 heavy.sh 는 표식을 모르므로 전환기에는 양보하지 않는다(공통 제약 1 — 무시될 뿐 깨지지 않는다).

## ③ 게이트 명령은 필요한 의존만 빌드

킷에는 게이트 명령 설정 키가 없고, 오케스트레이터가 리포마다 고른다. 그래서 dev-discipline 「게이트 기준선」에 일반 지침을 넣는다.
- 모노레포 단위 게이트는 대상 패키지가 의존하는 패키지만 빌드한다(pnpm 예: `pnpm --filter "<패키지>^..." build && pnpm --filter <패키지> test`).
  전체 라이브러리 빌드는 E2E 처럼 전부가 필요한 명령에만 둔다.
- 기준선과 게이트는 같은 명령이다. 명령을 바꾸면 기준선 캐시 키가 바뀌므로 **Task 도중에 바꾸지 않고 새 Task 부터** 쓴다.
- 실제 명령(패키지 이름)은 대상 리포 문서의 몫이다.

## ④ E2E 전용 풀

- `heavy.sh acquire` 는 일반 슬롯 대신 **E2E 풀** `<DIR>/e2e-<i>`(`DFLOW_HEAVY_E2E_SLOTS`, 기본 1)를 잡는다. 게이트가 E2E hold 때문에 굶지 않는다.
- E2E hold 를 쥔 세션 안의 `heavy.sh <명령>` 은 그 hold 를 다시 쓴다(`HEAVY_REUSE`). `--pool docker` 는 도커 슬롯만 더 잡는다(일반 슬롯을 쥔 경우와 같다).
- `snapshot` 은 E2E 풀 보유를 `RUN <start> hold general <cwd> <cmd>` 로 낸다(앱 변경 없음). `HEAVY_STATUS` 의 held 는 일반 풀만 센다.
  사람용 stderr 에 `HEAVY_E2E e2e=<n> held=<n> <보유>` 줄을 더한다.
- **대가**: PC 전체에서 동시에 도는 무거운 스택이 최대 K+1(E2E 1개 추가)이 된다. RAM 기준 K 를 넘으므로 사람에게 알린다.
  메모리가 빠듯하면 `DFLOW_HEAVY_E2E_SLOTS=0` 으로 옛 동작(일반 슬롯 사용)으로 돌린다.
- e2e.md 에 선택지로 `bootWar` 산출물을 `java -jar` 로 띄우는 방법을 적는다(Gradle 데몬 JVM 이 빠져 E2E 1건당 약 1GB 절감).
  주의: `bootWar` 빌드 자체는 무거운 Gradle 호출이라 `heavy.sh` 로 감싼다. `java -jar` 는 cwd 에 따라 상대 경로 DB 를 잡으므로
  모듈 폴더에서 실행하거나 `--spring.datasource.url` 로 절대경로를 넘긴다(다른 체크아웃의 DB 를 잡지 않게).

## ⑤ 변이 되돌리기 통일

- 단독·묶음 모두 **백업 사본 방식** 하나로: 변이 전에 사본을 뜨고, 대상 테스트 뒤 사본을 평범한 `cp` 로 되돌리고 사본을 지운다.
  `git checkout -- <파일>` 은 쓰지 않는다(그 파일의 미커밋 구현까지 지운다 — 감사 보고서 190·413·555~558행).
- 되돌릴 때 mtime 이 새로 찍혀야 한다(`cp -p`·`touch -r` 금지). mtime 을 되돌리면 같은 크기 변이에서 Gradle 이 재컴파일을 건너뛴다(486행).
- 사본은 작업 트리 밖 `$(git rev-parse --git-dir)/dflow-bak/` 에 둔다(작업 트리에 두면 미추적 파일로 DIRTY 검사에 걸린다).
- `trap` 으로 중단돼도 되돌린다. `git stash` 금지는 그대로.

## ⑥ Gradle 권장 설정(install.sh·precheck·--gradle-pc)

측정 1차 결과로 확정한 값: `org.gradle.caching=true`, `org.gradle.workers.max=3`, `org.gradle.daemon.idletimeout=600000`.
테스트 JVM `-XX:TieredStopAtLevel=1`(CPU 25%↓, 경과 시간 동일). **Test 태스크는 빌드 캐시에서 뺀다**(선언하지 않은 외부 입력을 읽는
테스트가 흔하다) — 컴파일만 캐시하는 것이 기본값이다.

- `kit/install.sh`: 대상 리포에서 `gradlew`·`settings.gradle(.kts)` 가 있는 빌드 루트를 찾는다(깊이 제한, node_modules·.git·build 제외).
  `org.gradle.*` 는 실행한 루트의 `gradle.properties` 만 읽히므로 includeBuild 폴더를 단독으로 돌리는 경우까지 루트마다 검사한다.
  - 파일이 없으면 권장 3키로 만든다. 있는데 키가 빠졌으면 **고치지 않고** 붙일 줄을 안내한다. 커밋은 사람이 한다.
  - 테스트 JVM 스니펫(`tasks.withType(Test).configureEach { outputs.doNotCacheIf('…') { true }; jvmArgs '-XX:TieredStopAtLevel=1' }`)은
    빌드 스크립트 수정이라 안내만 한다. 캐시 위험과 opt-out 을 함께 적는다.
- `/dflow-team` 전제 검사: Gradle 리포인데 권장 키가 없으면 경고 한 줄(시작은 막지 않는다).
- `install.sh --gradle-pc`: 팀원을 돌리는 PC 용.
  - `~/.gradle/gradle.properties` 에 **없는 키만** 덧붙인다(있는 키는 건드리지 않는다). 주의: 사용자 홈의 값은 프로젝트 값보다 우선한다.
  - `~/.gradle/init.d/dflow-test-jvm.gradle`(없을 때만): 모든 Test 태스크를 빌드 캐시에서 뺀다(안전한 방향이라 무조건).
    `-XX:TieredStopAtLevel=1` 은 루트 폴더나 그 조상에 `.dflow-agent` 가 있을 때(팀원 워크트리)만 붙인다 — 사람이 직접 돌리는 빌드는 그대로.

## 파일 소유(병렬 구현)

| 묶음 | 파일 |
|---|---|
| A heavy.sh | `dflow-dev/scripts/heavy.sh`·`baseline.sh`, `dflow-dev/references/dev-discipline.md`(「무거운 명령」·기준선 대기 문구)·`e2e.md`·`phase-prompt.md`·`rationale.md`, heavy·baseline 계약 테스트 |
| B 변이 | `dflow-dev/references/phase-build.md`, `dflow-dev/references/rationale.md` 는 A 소유라 B 는 문구 제안만 |
| C 가드 훅 | `dflow-dev/scripts/timeout-guard.sh`(신규), `dflow-team/references/backends.md`, 가드 계약 테스트 |
| D Gradle | `kit/install.sh`·`kit/README.md`, `dflow-team/references/precheck.md`(+전제 검사 스크립트), 테스트 |
| 메인 | ③ dev-discipline 「게이트 기준선」 지침, 통합·커밋 |

## 추가 항목(같은 날 뒤이어 받은 요청)

### ⑦ 게이트 범위 — 영향 모듈 게이트, Verify 에서 전체 1회

- 대상 리포 최상위 `.dflow-gates`(커밋 대상, 별도 파일): 한 줄에 `<경로 접두 또는 glob><TAB><명령>`. 예약어 `full`(필수)·`prepare`.
  명령 `-` 는 테스트 대상이 아닌 경로. 먼저 나온 줄이 이긴다. 의존 모듈은 명령이 스스로 포함한다(`:core:test :api:test`, pnpm `...<패키지>`).
  예시: `.claude/skills/dflow-dev/references/dflow-gates.example`.
- `gate-scope.sh --base <기점> [--ignore <TASKS>/<TSK>/]` 가 `GATE_SCOPE none|module <명령>|full <명령>|invalid` 을 낸다.
  대응표 밖 경로·공용 빌드 파일·`.dflow-gates` 자신이 바뀌면 full. 게이트는 **기점 커밋의 대응표**를 읽는다.
- 대응표가 없으면 종전과 같다. 있으면 기준선은 full 만, 모듈 기준선은 Design 게이트 직후 design.md 변경 파일 목록으로 예측해 잰다.
  Build 게이트·변이 대체 실행은 모듈 명령, Verify 에서 오케스트레이터가 full 1회(Build 가 이미 full 이면 생략).
- 강제 재실행(`--rerun-tasks`·`cleanTest`)은 `dflow-bak/` 에 사본이 남았을 때만. 게이트마다 build-log.md `## 게이트 기록` 한 줄.
- baseline.sh 캐시 키를 기점 sha 로 바꾸고, HEAD 가 기점 위 Task 문서 커밋만 얹었으면 캐시를 쓴다.

### ⑧ 부하 기반 슬롯 배정(P12)

- 새 일반 슬롯은 1분 부하 평균 > 코어 수 × `DFLOW_HEAVY_LOAD_MAX`(기본 1.5, 0 이면 끔)이면 미룬다. 대기 90초·`HEAVY_BUSY` 규약 안.
  쥔 슬롯은 빼앗지 않는다. 일반 풀 보유자가 0명이면 부하와 무관하게 하나는 준다. 부하를 못 읽으면 검사를 건너뛴다.
- 적용: 명령 실행, 도커 풀의 일반 슬롯(도커 슬롯을 잡기 전에 본다), E2E 풀을 끈 acquire. 제외: E2E 풀(기아), 독점(표식이 배정을 막은 채
  heavy.sh 밖 부하를 기다리면 PC 전체가 선다), REUSE.

### ⑨ 새 워크트리 준비 빌드(P9)

- deps.sh 가 설치 성공 직후 `.dflow-gates` 의 첫 `prepare` 명령을 heavy.sh 로 한 번 돈다. 완료 표식은 git 디렉터리에 명령 해시로.
  실패는 `DEPS_PREPARE_FAIL` 경고(exit 0 유지), 슬롯 없음은 `DEPS_BUSY prepare`(exit 75). 가드 훅 대상에 deps.sh 를 더했다.

### ⑩ E2E 운영(P8)

- `free-port.sh` 가 OS 에서 빈 포트를 받아 준다. 라이브러리 빌드는 dev 서버 기동 전에 끝내고, 기동 뒤 다시 빌드했으면 dev 서버도 다시 띄운다.
  DB 를 바꿀 때마다 서버를 재기동하지 않고 픽스처를 다시 넣는다.
