# 화면 작업의 브라우저 E2E

화면 작업의 Design(「스모크 넷」 만)·Build·Verify 서브에이전트가 읽는 파일이다. 이 파일이 E2E·서버 프로세스·E2E 서버 슬롯
규칙의 정본이다(dev-discipline.md 의 같은 이름 절은 여기를 가리킨다).

API 시험만으로는 화면의 JavaScript(DOM 바인딩·이벤트·fetch 호출)를 아무도 확인하지 않는다. 화면을
바꾸는 작업(spec 에 `entry-point` 가 있거나 domain 이 `fullstack`·`frontend` 인 작업)은 화면도 끝에서
끝까지 시험한다. 프로젝트 명세(TRD)가 도구·경로를 따로 정했으면 그것이 이긴다.

- **러너를 늘리지 않는다.** 브라우저 시험도 기준선과 같은 테스트 명령 하나로 돈다. 별도 러너를 두면
  기준선과 게이트 판정이 둘로 갈라진다. 기본값은 기존 러너 안에서 `playwright` 라이브러리로
  headless Chromium 을 띄우는 것이다(Node 프로젝트면 `@playwright/test` 가 아니라 `playwright`).
- 시험은 `tests/e2e/`(프로젝트 관례가 있으면 그것)에 둔다. 서버는 임시 포트와 임시 데이터로 띄우고
  시험이 끝나면 치운다. 개발 서버나 공유 DB 에 기대지 않는다.
- **브라우저 설치는 스캐폴드(초기화) 작업의 몫이다.** 의존성 설치 한 번으로 브라우저까지 갖춰지게
  한다(npm 이면 `playwright` devDependency + `postinstall: playwright install chromium`). 팀원 워크트리는 lockfile 로만
  설치하므로(`/dflow-dev` 「--worker」 H) 리포에 설치 절차가 있어야 한다. 스캐폴드가 이것을 빠뜨렸는데 화면 작업이 왔으면
  그 작업에서 추가하고 build-log.md 「설계 이탈」 에 적는다.
- **통합 작업(itest)** 의 관통 시나리오도 API 가 아니라 브라우저로 돈다.
- 화면 작업은 시험 중 화면별 스크린샷을 `<TASKS>/<TSK>/screens/*.png`(`<TASKS>/<TSK>` = `dflow.sh taskdir <ref>`) 로 남겨 커밋한다. 모양은
  자동 시험이 판정하지 못하므로 승인하는 사람이 이 파일로 화면을 본다.
- 시험은 브라우저 종류나 개인 환경에 기대지 않는다. 사람이나 에이전트가 눈으로 확인할 때 쓰는
  브라우저는 각자의 환경이 정하며, 이 문서가 정하지 않는다.

## 스모크 넷

**화면 작업마다 스모크 시험 넷**을 둔다. design.md 「테스트 전략」 과 「수용 기준 매핑」 에 적는다.
1. 메뉴(사이드바 등)에서 그 화면으로 이동된다.
2. 목록이 서버 데이터로 채워지고, 데이터가 없으면 빈 상태가 보인다.
3. 등록 또는 수정 한 번이 화면 조작만으로 끝나고 목록에 반영된다.
4. 서버가 오류를 돌려주면 화면에 오류가 보인다.

화면에 목록이나 입력이 없으면 해당 항목은 "해당 없음" 과 사유를 적는다.

## 서버 프로세스 (정본)

화면 작업·E2E 에 쓰는 서버는 **리포의 서버 실행 스크립트를 쓰지 않고 직접 띄운다.** `be-run.sh`·
`fe-run.sh` 처럼 다른 인스턴스나 포트를 점유한 프로세스를 이름·포트 기준으로 정리하는 스크립트
(`pgrep -f`·`pkill`·`killall`·전역 `gradlew --stop` 등)는 같은 머신의 다른 체크아웃 서버까지 죽인다.

- 빈 포트는 `.claude/skills/dflow-dev/scripts/free-port.sh` 로 OS 에서 받아 띄운다. 번호를 눈으로 고르지 않는다 — 같은
  PC 의 다른 팀원 서버와 부딪힌다. 스크립트는 포트 번호 한 줄을 낸다. Bash 호출 사이에 셸 변수는 남지 않으므로 받은 번호를
  기록해 두고 그 번호로 띄우거나, 한 호출 안에서 `PORT=$(.claude/skills/dflow-dev/scripts/free-port.sh) && …` 로 이어 쓴다.
  예: `./gradlew :api:bootRun --no-daemon --args='--server.port=<빈 포트>'`
  (`--no-daemon` 으로 사용자 전역 Gradle 데몬을 공유·터치하지 않는다), `next dev --port <빈 포트>`. 끝에 `&` 를 붙여 띄우는
  서버 기동은 가드 훅의 timeout 검사에서 면제된다. 그 밖의 `gradlew` 호출은 Bash 도구의 timeout 을 300000~600000 으로 준다.
  받은 포트는 곧바로 닫히므로 서버가 bind 하기 전에 남이 가져갈 수 있다(드묾). 서버가 "Address already in use" 로 뜨지
  못하면 포트를 다시 받아 띄운다.
- 워크스페이스 라이브러리 빌드는 프런트 dev 서버(`next dev` 등) 기동 **전에** 끝낸다. dev 서버는 떠 있는 동안 라이브러리
  산출물(dist)을 지켜보므로, 기동 뒤 dist 를 지웠다 다시 쓰는 빌드가 돌면 "Module not found" 오류 화면이 클릭을 가로채 모든
  시험이 로그인 단계에서 시간 초과로 끝난다. 기동 뒤 라이브러리를 다시 빌드했으면 dev 서버도 다시 띄운다(자기가 띄운 PID 만
  거두고 새 포트로).
- 시험이 DB 를 바꿔 처음 상태가 필요하면 서버를 다시 띄우지 않고 픽스처(SQL·시드 스크립트)를 다시 넣어 초기화한다. 서버
  기동이 E2E 에서 가장 비싼 단계다. 리포에 재투입 절차가 없으면 시험의 준비 단계(beforeAll·beforeEach 등)에 둔다. 스키마가
  바뀌었을 때(마이그레이션 추가)만 서버를 다시 띄운다.
- 선택지 — Spring Boot 백엔드는 `bootWar`(또는 `bootJar`) 산출물을 `java -jar` 로 띄워도 된다. 서버가 도는 동안 Gradle
  데몬 JVM 이 떠 있지 않아 E2E 한 건에 약 1GB 를 아낀다.
  - 산출물 빌드는 무거운 Gradle 호출이다 — `heavy.sh` 로 감싸고 Bash 도구의 timeout 을 300000~600000 으로 준다(팀원 세션은
    가드 훅이 이보다 짧으면 거부한다): `.claude/skills/dflow-dev/scripts/heavy.sh ./gradlew :api:bootWar`. 서버 자체
    (`java -jar`)는 감싸지 않는다 — 서버의 슬롯은 아래 「E2E 서버 슬롯」 의 `acquire` 가 잡는다.
  - `java -jar` 는 상대 경로(파일 DB `jdbc:h2:file:./data/…`, `./logs` 등)를 **실행한 폴더(cwd) 기준으로** 푼다. 모듈 폴더에서
    실행하거나 `--spring.datasource.url=<절대경로 URL>` 로 넘긴다 — 그러지 않으면 다른 체크아웃(메인 체크아웃·다른 팀원의
    워크트리)의 DB 를 잡는다. 예: `cd api && java -jar build/libs/<산출물>.war --server.port=<빈 포트>`.
  - 띄운 `java` 의 PID 를 기록해 두고 끝나면 아래 거두기 규칙대로 그 PID 를 죽인다.
- 끝나면 **자기가 띄운 프로세스만** 거둔다: 기동 시 기록한 PID 를 먼저 죽이고, 그 PID 가 자식 프로세스를
  남겼으면(Gradle·Node 러너는 흔하다) 자기가 고른 포트를 리슨하는 프로세스도 죽인다 — 그 포트는 시작할
  때 비어 있었다고 확인하고 골랐으므로, 지금 그 포트의 점유자는 자신의 프로세스뿐이다.
- 금지: 전역 `gradlew --stop`, 이름 기반 `pkill`·`killall`·`pgrep -f` 종료, 남의 포트를 점유한 프로세스
  종료.
- 이 규칙은 수동·워커 두 소비자 모두에 적용된다. 워커 쪽 요약은 `.claude/skills/dflow-team/references/worker-prompt.md`
  「8」에도 있지만 규칙 본문의 정본은 이 절이다 — 수정은 여기서만 한다.

## E2E 서버 슬롯

**E2E 서버는 서버를 띄울 때 슬롯을 붙잡고, 서버를 끌 때 푼다**(dev-discipline.md 「무거운 명령 줄 세우기」).
1. 서버를 띄우기 직전 `.claude/skills/dflow-dev/scripts/heavy.sh acquire e2e-<TSK>` 를 부른다. `HEAVY_ACQUIRED` 를
   확인한다(`HEAVY_BUSY` 면 다시 부른다). Bash 도구의 timeout 을 300000~600000 으로 준다(팀원 세션은 가드 훅이 이보다 짧으면
   거부한다 — `release` 는 면제). 소유자는 이 세션(`CLAUDE_PID`)이다. `acquire` 는 일반 슬롯이 아니라 **E2E 풀**
   (`e2e-<i>`, `DFLOW_HEAVY_E2E_SLOTS`, 기본 1)을 잡는다 — 서버가 떠 있는 동안에도 다른 팀원의 게이트·빌드는 일반 슬롯에서
   돈다. E2E 풀이 차 있으면(다른 팀원의 E2E 서버) `HEAVY_BUSY e2e=<n> …` 로 돌아온다.
2. 서버는 「서버 프로세스」 규칙대로 빈 포트에 직접 띄운다. 백엔드와 프런트를 함께 띄워도 슬롯은 하나다. 이
   세션의 시험 명령은 `heavy.sh` 로 감싸도 붙잡은 슬롯을 다시 쓴다(`HEAVY_REUSE`) — 두 번째 슬롯을 기다리지 않는다.
   도커가 필요한 시험(`heavy.sh --pool docker`)은 도커 슬롯만 더 잡는다.
3. **E2E 가 끝나면 성공·실패·중단과 상관없이 서버를 반드시 종료한다**(「서버 프로세스」 의 거두기 규칙). 그다음
   `.claude/skills/dflow-dev/scripts/heavy.sh release` 로 슬롯을 푼다. 서버를 켜 둔 채 다음 Phase 로 넘기지 않는다.
   Phase 서브에이전트는 끝나기 전에 자기가 띄운 서버를 끄고 슬롯을 푼다.
4. release 를 잊으면 세션이 끝나거나 1시간(`DFLOW_HEAVY_HOLD_TTL`)이 지나야 회수된다. 그동안 E2E 풀(기본 한 자리)이
   막혀 다른 팀원의 E2E 가 서지 못한다.

**E2E 풀의 대가**: E2E 풀은 일반 슬롯 K 와 따로 세므로, PC 전체에서 동시에 도는 무거운 스택이 최대 K+1(E2E 풀 한
자리 추가)이 된다 — RAM 기준으로 정한 K 를 넘는다. 메모리가 빠듯한 PC 면 사람이 `DFLOW_HEAVY_E2E_SLOTS=0` 으로 옛
동작으로 되돌린다. 그러면 `acquire` 가 일반 슬롯 하나를 붙잡고 E2E 서버가 게이트와 같은 줄에 선다. 이 값은 사람이
정한다(워커는 바꾸지 않는다). 독점 실행(`heavy.sh --exclusive`)은 일반 풀만 비우므로 떠 있는 E2E 서버는 멈추지 않는다.

서버를 시험 러너 안에서 띄우고 치우는 리포(globalSetup 등)는 acquire 없이 시험 명령만 감싼다.
