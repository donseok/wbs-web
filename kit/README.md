# dflow-kit — D'Flow 에이전트 스킬 배포 킷

D'Flow(작업 관리) 와 Claude Code 를 잇는 스킬 묶음. **wbs-web 리포 없이** 어느 PC·어느 프로젝트 리포에서든
`/dflow-dev`, `/dflow-poll`, `/dflow-merge`, `/dflow-team`, `/dflow-wbs-nlevel`, `/dflow-export` 를 쓸 수 있게 한다.

정본은 wbs-web 리포 `.claude/skills/dflow-*` 이고 이 킷은 `scripts/kit-build.sh` 가 만든 산출물이다.
킷에서 스킬을 고치지 말 것 — 다음 빌드에 덮인다. 고칠 건 wbs-web 에.

## 설치 (PC 마다 1회, 프로젝트 리포마다 1회)

```bash
git clone git@github.com:jongik-sv/dflow-kit.git ~/dflow-kit
~/dflow-kit/install.sh ~/project/<내 리포>
```

install.sh 가 하는 일: 의존 명령 점검(git curl jq python3 gh) → `<리포>/.claude/skills/dflow-*` 복사 →
`.dflow`·`.dflow.local` 초안 + `.gitignore` 보강 → `.claude/settings.json` 에 워커 허용 목록 병합(git 은 이 PC 의 절대경로) → 다음 단계 안내.

그 다음 사람이 할 일:

1. D'Flow 웹 → `/account` "내 토큰" → PAT 발급
2. `<리포>/.dflow` 에 `api_base`(스테이징/운영)·`project_id` 기입(커밋 대상). `<리포>/.dflow.local` 에 `pats`·`dev_branch` 기입(개인, 커밋하지 않음). 토큰이 둘 이상이면 `.dflow.local` 의 `as=<prefix>`(내부적으로 `DFLOW_AS`) 로 이 리포의 키를 고정한다(prefix 는 `dflow.sh profiles` 로 확인. `/dflow-team` 은 비어 있으면 시작할 때 묻고 적는다)
3. 확인: `cd <리포> && .claude/skills/dflow-work/scripts/dflow.sh doctor`
4. Claude Code 를 **리포 루트에서** 연다 — 스킬은 프로젝트 스코프(`.claude/skills/`)라 cwd 가 리포 루트여야 한다

`.claude/skills/` 는 리포에 커밋하고 기본 브랜치에 push 한다(`/dflow-team` 팀원 워크트리는 `origin` 의 스킬을 쓴다). 팀원은 클론만으로 같은 스킬을 쓴다. `.dflow` 는 커밋하고 `.dflow.local` 은 커밋하지 않는다.

## 들어 있는 것

| 스킬 | 역할 |
|---|---|
| dflow-work | `dflow.sh` — D'Flow Agent API 래퍼(me/list/show/claim/progress/done/release/doctor). 다른 스킬의 기반 |
| dflow-dev | 작업 1건 개발 사이클(착수 판정→설계→TDD→검증→보고). 규율 정본 `references/dev-discipline.md` 동봉 |
| dflow-poll | `poll.sh` — 에이전트 위임(tags: agent) 작업 감시 → 자동 착수. 낮 시간 반자동 |
| dflow-merge | 승인된 작업 브랜치를 main 에 반영(조상 순서, --no-ff) |
| dflow-team | 팀장. 에이전트 위임 작업을 슬롯 N개 팀원(Orca pane 또는 별도 claude -p 프로세스)에게 나눠 동시에 개발시킨다. 낮 시간 supervised |
| dflow-wbs-nlevel | levels 계약 wbs.md 생성·검증. 계약 문서·골격 샘플 동봉 |
| dflow-export | wbs.md → import payload(v2.1). 기본 dry-run |

사용법과 대화 예시는 wbs-web `docs/agent/claude-skill/dflow-skills-guide.md`.

## 갱신

```bash
cd ~/dflow-kit && git pull && ./install.sh ~/project/<내 리포>
```

`doctor` 가 계약 버전 불일치를 알리면 이 절차로 갱신한다. `VERSION` 파일에 빌드 원본(wbs-web 커밋) 이 있다.

좌석표 heartbeat 훅(`~/.dflow/hooks/heartbeat.sh`)을 예전에 설치했다면 `.dflow`·`.dflow.local` 전환 뒤
`./install.sh ~/project/<내 리포> --hooks` 를 다시 돌려 훅도 갱신한다 — 예전 훅은 `.env` 만 읽어 새 방식
리포에서는 신호를 보내지 못한다.

## Gradle 권장 설정

Gradle 리포(`gradlew` 또는 `settings.gradle(.kts)` 가 있는 폴더 — includeBuild 로 딸린 하위 모듈도 각각)에
측정으로 확정한 세 설정을 권한다. 두 층으로 나뉜다.

1. **리포 설정(정본)** — `install.sh` 가 설치할 때마다 자동으로 점검한다. 다른 PC·CI 에도 그대로 적용되므로 우선
   이쪽을 채운다.
   - 빌드 루트마다 `gradle.properties` 가 없으면 권장 3키로 **새로 만든다**.
   - 있는데 키가 빠졌으면 **파일을 고치지 않고** 붙일 줄만 안내한다(이미 있는 키는 값이 달라도 건드리지 않는다).
     git add·커밋은 사람이 한다(킷은 원칙적으로 대상 리포에 커밋하지 않는다).
   - 권장 3키: `org.gradle.caching=true` · `org.gradle.workers.max=3` · `org.gradle.daemon.idletimeout=600000`.
   - 테스트 JVM 최적화(`-XX:TieredStopAtLevel=1`, 측정상 CPU 약 25%↓·경과 시간 동일)는 **빌드 스크립트 수정**이라
     `install.sh` 가 자동으로 넣지 않는다. 안내만 한다. 넣으려면 빌드 스크립트 끝에:
     ```groovy
     allprojects {
       tasks.withType(Test).configureEach {
         outputs.doNotCacheIf('테스트는 선언되지 않은 외부 입력을 읽을 수 있다') { true }
         jvmArgs '-XX:TieredStopAtLevel=1', '-XX:ReservedCodeCacheSize=240m'
       }
     }
     ```
     **`-XX:ReservedCodeCacheSize=240m` 을 빼지 않는다** — C1 만 쓰면(`TieredStopAtLevel=1`) JVM 이 코드 캐시 기본값을
     240MB 에서 48MB 로 줄여, 테스트가 많은 리포에서 무작위 클래스가 `VirtualMachineError: Out of space in CodeCache for
     adapters` 로 실패한다(실측: 테스트 1060건에서 6건).
     **Test 태스크는 빌드 캐시에서 빼는 쪽을 기본으로 권한다** — 테스트가 작업 트리 밖 파일·환경 변수·상태가 있는
     DB 파일을 선언하지 않은 채 읽는 경우가 흔해, 캐시가 그 실패를 조용히 숨길 수 있기 때문이다(컴파일 태스크는
     캐시 대상에서 빼지 않는다). Test 를 캐시에서 빼는 방법(opt-out)은 위 스니펫의 `outputs.doNotCacheIf { true }`
     이고, `outputs.cacheIf { false }` 도 같은 뜻이다. 이 위험을 감수하고 Test 도 캐시하려면 그 줄을 지운다.
   - `/dflow-team` 시작 전제 검사도 같은 판정 스크립트(`.claude/skills/dflow-team/scripts/gradle-check.sh`)를 불러
     권장 키가 없으면 `WARN GRADLE_TUNING <빌드 루트> <빠진 키>` 를 한 줄 내지만 **시작을 막지는 않는다**.

2. **`--gradle-pc`(이 PC 안전망)** — D'Flow 팀원을 여러 개 돌리는 이 PC 전용으로 켜는 선택 층이다. 리포 인자와
   함께 붙이거나(그 리포 설치와 한 번에), 리포 없이 단독으로도 쓸 수 있다:
   ```bash
   ./install.sh ~/project/<내 리포> --gradle-pc   # 리포 설치와 함께
   ./install.sh --gradle-pc                       # 단독 — ~/.gradle 안전망만 설치
   ```
   **심링크 배포 리포**(`.claude/skills/dflow-*` 가 다른 리포를 가리키는 심링크)에서는 **반드시 단독 형태**를 쓴다.
   `./install.sh <리포>` 는 그 리포의 `.claude/skills/dflow-*` 를 `rm -rf` 뒤 `cp -R` 로 갱신하므로, 심링크에 걸면
   심링크가 평범한 폴더로 바뀌어 버린다. 단독 형태는 스킬 복사·`.dflow` 초안·`settings.json` 병합을 전혀 하지 않고
   `~/.gradle` 만 건드린다.
   - `$GRADLE_USER_HOME`(없으면 `~/.gradle`) 의 `gradle.properties` 에 **없는 키만** 덧붙인다. 파일이 없으면 만든다.
     설치·건너뜀은 키마다 한 줄씩 알린다(`설치: … 추가` 또는 `건너뜀: … (이미 있음)`).
     **사용자 홈의 값은 프로젝트 `gradle.properties` 값보다 우선 적용된다** — 이미 다른 값을 의도적으로 넣어 둔
     리포가 있다면 그 리포에서는 이 안전망이 그 값을 덮어쓸 수 있다는 뜻이다.
   - `$GRADLE_USER_HOME/init.d/dflow-test-jvm.gradle` 을 **없을 때만** 설치한다. 이 스크립트는 이 PC 에서 도는
     모든 Gradle 빌드(및 composite 의 included build)의 Test 태스크에 적용된다:
     - 모든 Test 태스크를 빌드 캐시에서 뺀다(안전한 방향이라 무조건 적용).
     - `-XX:TieredStopAtLevel=1` 은 빌드 루트 폴더나 그 조상에 `.dflow-agent` 파일이 있을 때만(D'Flow 팀원
       워크트리) 실행 직전(`doFirst`)에 붙인다 — 사람이 직접 돌리는 빌드는 건드리지 않는다. 대상 리포의
       `build.gradle` 이 이미 같은 플래그를 지정했으면(`allJvmArgs` 에 `-XX:TieredStopAtLevel` 로 시작하는 인자가
       있으면) 건너뛰고 리포 값을 그대로 둔다 — 같은 `-XX` 플래그가 두 번 와도 JVM 은 뒤의 값을 쓰므로 중복 자체는
       무해하지만, 어느 값이 적용되는지 헷갈리지 않도록 명시적으로 건너뛴다.
     - 같은 조건에서 `-XX:ReservedCodeCacheSize=240m` 도 붙인다(리포가 값을 정했으면 건너뛴다). C1 만 쓰면 코드 캐시
       기본값이 48MB 로 줄어 CodeCache 부족 오류가 나기 때문이다.
   - 킷 안의 원본은 `kit/gradle/dflow-test-jvm.gradle`.

**되돌리는 법**: 리포 설정은 그 리포의 `gradle.properties` 에서 추가된 키 줄을 지우고 커밋한다. `--gradle-pc` 안전망은
`$GRADLE_USER_HOME/gradle.properties` 의 해당 키 줄과 `$GRADLE_USER_HOME/init.d/dflow-test-jvm.gradle` 파일을 지우면
된다 — 둘 다 `install.sh` 가 만든 것 외의 값은 건드리지 않으므로 지워도 다른 설정에 영향이 없다.

## 의존

git · curl · jq · python3 · gh(GitHub CLI, `done --auto-links` 와 리포 생성용). macOS: `brew install jq gh`.

## Windows(Git Bash)

Git for Windows 의 Git Bash 에서 같은 `install.sh` 를 쓴다. 킷과 설치 대상의 `.gitattributes` 가 스킬 줄끝을
LF 로 고정한다(이미 CRLF 로 받은 클론은 `git add --renormalize .`). `.dflow`·`.dflow.local` 을 CRLF 로 저장해도 `dflow.sh`·
heartbeat 훅이 `\r` 을 걷어낸다. 네이티브 설치기(`irm https://claude.ai/install.ps1 | iex`)는 `~/.local/bin` 을
PATH 에 넣으라고 경고하므로 그대로 따른다. `/dflow-team` 은 `powershell.exe` 를 쓴다(프로세스 시작 시각·권한 감지).

## 좌석표 heartbeat 훅

D'Flow 좌석표(`/agents`)가 "진행 중/무응답/끊김"을 구분하려면 에이전트가 도구를 쓸 때마다 60초에 1회 신호가 서버에 닿아야 한다.
훅은 진행 중 작업(`docs/tasks/*/state.json` 또는 project_map 리포의 `docs/*/tasks/*/state.json` 의 phase 가 prepare/design/build/verify/refactor/rejected)이 있는 워크트리에서만 보내고(prepare 는 /dflow-dev Phase 01 준비, scaffold 자리표 ready 는 보내지 않는다),
`.dflow-agent` 가 없으면 `agent/` 브랜치에서만 보낸다. 기본 브랜치의 팀장 세션에서는 아무것도 보내지 않는다.

1. `./install.sh <리포> --hooks` → `~/.dflow/hooks/heartbeat.sh`
2. `~/.claude/settings.json` 의 `hooks.PostToolUse` 배열에 아래 원소를 추가한다(기존 원소는 그대로 둔다):
   ```json
   { "matcher": "*", "hooks": [ { "type": "command", "timeout": 5,
     "command": "if [ -x \"${HOME-}/.dflow/hooks/heartbeat.sh\" ]; then /bin/sh \"${HOME-}/.dflow/hooks/heartbeat.sh\"; else cat >/dev/null 2>&1 || :; fi" } ] }
   ```
3. 확인: 작업 리포에서 `/dflow-dev` 를 한 사이클 돌리며 D'Flow `/agents` 의 그 책상이 1~2분 간격으로 갱신되는지 본다.

끄기: settings.json 에서 위 원소를 지운다. 훅은 `.dflow.local` 의 첫 PAT 를 쓰고 토큰을 출력하거나 기록하지 않는다.

**중단**: D'Flow 화면에서 사람이 "중단" 을 누르면 서버가 그 주문의 heartbeat 에 `409 code=cancelled` 를 준다. 훅은 그때만
`~/.dflow/hb/<주문>.cancelled` 표식을 남기고 `{"continue": false, "stopReason": …}` 를 출력해 세션을 세우며, state.json 의
phase 를 `cancelled` 로 바꾼다. 표식이 남아 있는 동안은 60초 절제와 무관하게 매 도구 호출마다 다시 세운다. 반응은 최대
약 1분(절제 간격)이다. 네트워크 실패·다른 409·5xx 는 지금처럼 무시한다. `/dflow-team` 팀장은 spawn 직전에 서버 status 로 확인하고 낡은 표식을 지운다(서버가 `ready`·`claimed` 라고 말하는 주문의
표식). 수동 `/dflow-dev` 세션에서 같은 주문을 이어 가려면 사람이 표식 파일을 지운다.

## 긴 명령 timeout 가드 훅(선택)

`/dflow-team` 팀원은 이 훅이 자동으로 붙는다(팀원 전용 설정 `~/.dflow/limits/<id8>.settings.json`). 사람이 할 일은 없다.
훅은 `heavy.sh`·`baseline.sh run`·`gradlew`·`mvn`·`playwright test` 를 Bash 도구 timeout 없이(또는 300000 미만으로) 부르거나
백그라운드로 돌리면 거부하고 이유를 모델에게 돌려준다. 하네스가 긴 명령을 자동 백그라운드로 옮긴 뒤 서브에이전트가 완료
알림을 기다리며 멈추는 일을 막는다.

팀장 없이 직접 여는 `/dflow-dev` 세션에도 쓰고 싶으면 대상 리포의 `.claude/settings.local.json`(또는 전역 settings)의
`hooks.PreToolUse` 배열에 아래 원소를 **덧붙인다**(배열을 통째로 바꾸지 않는다 — 다른 훅이 이미 있을 수 있다).
스크립트가 없는 리포에서는 아무것도 하지 않고 통과한다.

```json
{ "matcher": "Bash",
  "hooks": [ { "type": "command", "timeout": 5,
    "command": "if [ -x \"${CLAUDE_PROJECT_DIR-}/.claude/skills/dflow-dev/scripts/timeout-guard.sh\" ]; then /bin/sh \"${CLAUDE_PROJECT_DIR-}/.claude/skills/dflow-dev/scripts/timeout-guard.sh\"; else cat >/dev/null 2>&1 || :; fi" } ] }
```

끄기: 위 원소를 지운다.
