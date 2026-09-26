# /dflow-dev --worker 팀원 모드 (팀장 전용)

`/dflow-dev` SKILL.md 가 `--worker` 일 때만 읽게 하는 파일이다. SKILL.md 와 다른 문서의 「--worker」 A~I 는 이 파일의 행이다.
규칙의 이유·사고 이력은 `rationale.md` 「worker-mode.md」 에 있다.

**팀장 전용, 사람이 직접 쓰지 않는다.** `--worker` 는 "이 세션은 자동 실행되는 팀원이며, 기본 브랜치를
잡고 있는 상위 체크아웃이 따로 있다" 는 뜻이다. `/dflow-team` 팀장이 띄운 팀원만 이 플래그를 붙인다.
description 의 사용법 줄에는 노출하지 않고, `.dflow-agent` 가 있다고 워커 모드로 자동 전환하지 않는다.

| # | 위치 | 플래그 없음 | `--worker` |
|---|---|---|---|
| A | Phase 01-가 승인 스윕 | claim 앞에서 매번 스윕한다 | **건너뛴다.** 스윕은 팀장 몫이며, 이유를 한 줄 남긴다 |
| B | Phase 01 2번, 선행이 approved 인데 main 미반영이면 직접 머지 | 직접 머지한다 | **머지하지 않는다.** 기점을 그 `head_sha` 로 잡고, Phase 01 2번 공통 규칙대로 claim 전에 그 기점으로 detach 한 뒤 claim 하고 스택 브랜치를 만든다. state.json 에 `branch_base` 와 `risk: "선행 main 미반영(팀장 머지 대기)"` 를 기록한다 |
| C | Phase 01 1번 재개 판정의 approved 갈래 | 즉시 머지하고 종료한다 | **머지하지 않고** `.result` 를 `{TSK} {ID8} <branch> <head_sha> - needs-merge approved` 로 쓰고 종료한다 |
| D | 사람 판단이 필요한 분기(AskUserQuestion, `--only` 확인) | 지금처럼 묻는다 | **AskUserQuestion 을 쓰지 않는다.** 합리적으로 고른 뒤 나중에 알린다. 기본값이 있으면 택해 한 줄 남기고 진행한다. 없어도 근거가 더 강한 쪽을 골라 진행하고, design.md `## 담당자 확인 필요 결정` 절에 질문·선택지·택한 것·근거·반려 시 재작업 방향을 남긴다. Phase 06 `done` 요약 끝에 `확인 필요 결정 N건: …` 을 싣는다. 결정마다 `D` 번호를 붙이고, Phase 06 에서 그 절을 `<TASKS>/<TSK>/decisions.json` 으로 옮겨 `done --decisions` 로 넘긴다(0건이면 `[]`). `blocked` 는 되돌리기 어려운 결정(데이터 삭제·외부 공개·다른 Task 산출물의 대폭 수정·보안·권한 변경)에만 쓴다(worker-prompt.md 판단 규칙). 팀장은 `--only` 를 넘기지 않으므로 `--only` 확인은 워커 경로에 없다 |
| E | Phase 02~05 공통 프롬프트 | 지금 문구 그대로 | 공통 프롬프트에 "git 은 `command -v git` 이 돌려주는 절대경로를 글자 그대로 적어 호출한다. bare `git`, `$(command -v git)`·변수로 넣는 치환, git 을 감싼 명령 치환, 워크트리 밖을 가리키는 `-C` 는 쓰지 않는다" 한 줄을 덧붙인다(템플릿의 `{WORKER_LINES}`). 오케스트레이터 자신도 같은 규칙을 따른다 |
| F | Phase 01 2번 claim exit 4 재시도 | `git fetch origin` 뒤 기점을 다시 정해 1회 재시도하고, 그래도 4 면 중단·보고한다(merge 없음) | 같다. 그래도 4 면 `.result` 에 `skipped` 를 쓴다 |
| G | Phase 01 2번 `head_sha` 없는 선행의 갈래 1·2 | 갈래 1(미승인·stage 미달)은 로컬 선행 산출물이 있으면 스택하고, 갈래 2(`stage >= im`·`order_approved:false`, 완료 보고 뒤 승인 대기)는 한 줄 남기고 진행한다 | **스택하지 않는다.** 갈래 1(`reached` 가 거짓)은 `skipped 선행 미승인` 으로 끝내고 팀장이 일시 제외한다. 갈래 2(`reached` 가 참인데 `head_sha` 가 없음)는 아래 **기본 브랜치 반영 확인**을 거쳐, 반영이 확인되면 `origin/<기본브랜치>` 기점으로 **스택 없이 진행**하고 그 사실을 한 줄 남긴다. 확인되지 않으면 `skipped 선행 승인 대기` 로 끝낸다(승인 전에 기본 브랜치로 머지하는 운영에서는 선행 산출물이 이미 기점에 있다). 워커의 스택은 `head_sha` 가 있는 선행(행 B)에만 한다. `waived:true` 간선은 이 행의 대상이 아니다 — Phase 01 2번의 강제 진행 갈래로 간다(기본 브랜치 반영 확인 없음). 서버 계약이 2.9 이상이면 갈래 1 은 아래 「설계 선행」 이 대신한다 |
| H | Phase 01 3번의 브랜치 생성 또는 재개 판정으로 agent 브랜치에 들어온 직후 | 설치하지 않는다. 사람의 체크아웃에는 의존성이 이미 있다 | 생성 또는 재개로 agent 브랜치에 들어온 직후, 4번 기준선과 Phase 02~05 게이트 전에 아래 블록으로 설치한다. `blocked` 답을 받아 재spawn 된 워커처럼 재개 판정으로 기존 agent 브랜치에 들어온 경우도 같다(새 격리 워크트리에는 `node_modules` 가 없다). lockfile 로 관리자를 고르고, `package.json` 이 있고 `node_modules` 가 없을 때만 설치하며, lockfile 이 없으면 설치하지 않는다. 설치가 실패하면 `.result` 에 `failed deps <실패한 명령과 exit>` 를 쓰고 끝낸다. `DEPS_BUSY <폴더>`(exit 75)는 실패가 아니다 — heavy 슬롯이 없어 설치를 미룬 것이므로 잠시 뒤 같은 명령을 다시 부른다(이어서 설치한다). 설치는 브랜치 기점의 lockfile 로 고정한다(스택이면 선행이 lockfile 을 바꿨을 수 있다) |
| I | Phase 05 Refactor | supervised 에서 기본 실행한다(커밋이 없으면 Refactor 게이트 생략) | **실행하지 않는다.** Verify 게이트 통과 뒤 곧바로 Phase 06 으로 간다. Refactor 서브에이전트를 띄우지 않고 state.json 의 `phase` 도 `refactor` 로 쓰지 않는다 — dev-discipline.md 「Phase 05」 의 "무인 모드에서는 실행하지 않는다" |

## 행 G — 기본 브랜치 반영 확인

행 G 의 **기본 브랜치 반영 확인**: 선행 산출물이 `origin/<기본브랜치>` 에 실재하는지를 git 으로만 확인한다.
`<선행TSK>` 는 그 `depends_evidence` 원소의 `external_ref` 에서 마지막 `/` 뒤다(예 `dict/TSK-02-01` → `TSK-02-01`).
선행 주문을 `show` 하지 않는다(워커의 서버 조회는 자기 `{ID8}` 하나로 제한된다 — worker-prompt.md 「5」).
**실행은 공용 스크립트 한 줄이다**(팀장의 선행 반영 사전 검사와 같은 판정, 2026-09-23). `git fetch origin` 을 먼저
단독으로 실행한 뒤 부른다.
```bash
.claude/skills/dflow-dev/scripts/pred-reflected.sh <TASKS> <선행TSK> <기본브랜치>
```
`<TASKS>` 는 선행 Task 폴더의 부모다. 팀장이 넘긴 `{TASK_DIR}` 의 부모 디렉터리(`$(dirname {TASK_DIR})`)를 쓴다 —
선행은 같은 프로젝트·모듈 안에 있으므로(의존은 프로젝트 경계를 넘지 않는다) 같은 `<TASKS>` 아래에 있다고 본다.
출력 첫 낱말이 `REFLECTED` 면 반영이 확인된 것이다. `NOT_REFLECTED`·`UNKNOWN` 은 모두 `skipped 선행 승인 대기` 다
(지금 동작과 같다). 아래 블록은 스크립트가 하는 일의 설명이며 워커가 직접 치지 않는다. 스크립트 안에서 git 을
부르는 것은 `deps.sh` 와 같은 방식이며, 워커 git 호출 규칙(명령 치환 금지)은 워커가 직접 치는 Bash 줄에 대한 것이다.

판정은 `phase=merged` **AND** (아래 세 증거 중 하나라도 참) 이다. **첫 증거가 가장 강하다** — 선행 산출물이
`origin/<기본브랜치>` 라는 기점에 실재한다는 직접 증거이기 때문이다. 커밋 그래프의 조상 관계는 git 이 보증하는
사실이라, 커밋 메시지 트레일러나 state.json 값처럼 사람·자동화가 빠뜨리거나 잘못 쓸 수 있는 경로를 거치지
않는다. `state.json` 에 `head_sha` 가 없으면 첫 증거는 판정 불가로 건너뛰고 나머지 둘로 본다.

```bash
git fetch origin
git show "origin/<기본브랜치>:$(dirname {TASK_DIR})/<선행TSK>/state.json"   # phase 가 merged 여야 하고, 여기서 order 와 head_sha 를 읽는다
git merge-base --is-ancestor <head_sha> origin/<기본브랜치>   # 증거 1. head_sha 가 있을 때만 실행. exit 0 이면 참
git log origin/<기본브랜치> --grep='DFlow-Order: <그 order>' --format=%h   # 증거 2. 한 줄이라도 나오면 참
git log origin/<기본브랜치> --merges --grep='^merge: <선행TSK> ' --format=%h   # 증거 3. 한 줄이라도 나오면 참. TSK 뒤 공백까지 넣는다 — 안 넣으면 TSK-03-1 이 TSK-03-10·03-11 도 함께 집어 오탐이 된다
```

팀장의 자동 머지(`automerge=1`)가 승인 전에 머지한 선행도 `phase` 는 `merged` 이고 `unapproved: true` 가
붙을 뿐이므로 같은 확인을 통과한다. `unapproved` 는 이 판정에서 보지 않는다.
`show` 가 실패하거나(그 경로에 파일이 없다) `phase` 가 `merged` 가 아니거나 세 증거가 모두 판정 불가·거짓이면
반영되지 않은 것이며, 그때는 `skipped 선행 승인 대기` 로 끝낸다.
state.json 의 `phase` 는 파일 한 줄이라 실제 머지 없이도 쓰일 수 있어 `phase` 만으로는 부족하고, 트레일러는 과거
커밋에 없을 수 있어 증거를 셋으로 넓혔다. 이 확인을 통과했다는 것은 선행 코드가 기점에 있다는 뜻이므로 스택할 대상도,
스택할 이유도 없다. 판정 이력(실측 사례)은 `scripts/pred-reflected.sh` 머리 주석에 있다.
트레일러 패턴(증거 2)의 콜론 뒤 **공백을 반드시 넣고 따옴표로 감싼다.** 실제 트레일러가 `DFlow-Order: <uuid>` 라
공백을 빼면 매치가 0 건이 되고, 그 0 건은 「반영되지 않음」 과 구분되지 않아 정상인 선행까지 `skipped` 로 만든다.

## 설계 선행 (계약 2.9)

`orch/design-first.md` 「설계 선행 (계약 2.9)」 이 정본이다. 워커에서 달라지는 것만 적는다.

- **행 G 갈래 1 대신**: `dflow.sh contract-ge 2.9` 가 exit 0 이면 `reached` 가 거짓인 선행은 `skipped 선행 미승인` 으로 끝내지 않고
  `claim --design-first` 로 간다(`orch/base.md` 2번 「v2.9 설계 선행 후보」). 팀장은 선행 대기 작업을 빈 슬롯에만 설계 선행으로
  준다(`/dflow-team` 「선행 대기의 설계 선행」). 서버가 `DESIGN_FIRST_TOO_EARLY` 로 거부하면 `.result` 에
  `skipped 선행 미충족(설계 선행 불가: <ref…>)` 를 쓴다(`<ref…>` 는 그 JSON 의 `external_ref` 를 공백으로 이은 것).
- **멈춤**: 멈춤 절차 5번의 `.result` 는 `{TSK} {ID8} <agent 브랜치> <push 한 head_sha> - design_waiting <미충족 선행 ref…>` 다.
  재개했는데 여전히 미충족이거나 기점을 정하지 못했으면 같은 status 에 사유만 바꾼다(`design_waiting 선행 승인 대기 <ref>` 등).
  팀장은 이 status 를 실패로 보지 않고 워크트리를 남긴 채 좌석만 비운다.
- **선행 반영 머지**: 재개 3번의 머지(정한 기점을 agent 브랜치에 한 번)는 워커도 한다. 기본 브랜치를 체크아웃하거나 기본 브랜치에
  머지하는 것이 아니라 agent 브랜치 위의 머지이므로, 아래 「그 밖의 워커 규칙」 의 "기본 브랜치를 switch·pull·merge·push 하는
  지점은 행 A·B·C 뿐" 과 부딪치지 않는다. git 은 행 E 의 절대경로 규칙대로 부른다.
- 재개는 팀장이 같은 워크트리로 다시 띄운 워커가 한다(claim 하지 않는다). 좌석 번호가 바뀌어 `.dflow-agent` 가 달라져도 서버는
  PAT 사용자로 점유자를 가르므로 `build-start` 가 통한다.

## 행 H — 의존성 설치

행 H 의 설치 블록:
```bash
.claude/skills/dflow-dev/scripts/deps.sh   # 75(DEPS_BUSY)면 잠시 뒤 다시 부른다. 그 밖에 0 이 아니면 .result 에 failed deps <DEPS_FAILED 줄의 명령과 exit>
```
- `DEPS_GRADLE_JAR_MISSING <폴더>` 줄은 실패가 아니라 경고다. 그 폴더의 `gradlew` 는 wrapper jar 가 없어 돌지 않는다.
  그 폴더의 Gradle 작업이 이번 작업에 필요하면 jar 를 커밋하거나 `.gitignore` 를 고치지 말고 팀장에게 이슈로 보고한다
  (수동 실행이면 사용자에게 알린다). 필요 없는 폴더(예제·PoC)면 무시한다.
- 설치 규칙은 위 표와 같다(lockfile 로 관리자를 고르고, `package.json` 이 있고 `node_modules` 가 없을 때만,
  lockfile 이 없으면 설치하지 않는다). 공용 캐시 복제(npm, 캐시가 없으면 `npm ci`)·메인 체크아웃 복제(pnpm, `DFLOW_DEPS_MAIN_CLONE=1`)·yarn·
  postinstall·캐시 보존 같은 세부는 `scripts/deps.sh` 머리 주석이 정본이다. 스크립트가 하므로 워커가 따로 하지 않는다.
- **준비 빌드**: 설치가 끝나면 `deps.sh` 가 리포 루트 `.dflow-gates` 의 `prepare<TAB><명령>` 줄(예: 워크스페이스 라이브러리
  빌드)을 워크트리마다 한 번 돌린다 — 새 워크트리에 dist 가 없어 첫 게이트가 실패하지 않게 한다. `DEPS_PREPARE_FAIL` 은
  경고다(exit 0) — 게이트가 같은 원인으로 실패하면 그 결과로 판정한다. 이번 호출에서 실제로 설치를 했으면 준비 빌드는
  돌지 않고 `DEPS_PREPARE_PENDING` 과 exit 75 로 끝난다 — `DEPS_BUSY` 처럼 실패가 아니며, 다시 부르면 설치는 건너뛰고 준비
  빌드만 돈다(한 호출이 10분을 넘지 않게). 이 호출은 Bash 도구의 timeout 을 300000~600000 으로 준다.
- **행 H 서버 프로세스**: Build·Verify Phase 가 화면 작업의 브라우저 E2E 를 위해 서버를 띄울 때도 행 H 와
  같은 자리의 규칙이다 — `references/e2e.md` 「서버 프로세스」(정본)를 따른다. 리포의 서버 실행 스크립트
  (`be-run.sh`·`fe-run.sh` 류)를 쓰지 않고 빈 포트로 직접 띄우며, 끝나면 자기가 띄운 프로세스만 거둔다.

## 그 밖의 워커 규칙

- **도커 금지 모드(워커)**: 워커는 도커를 쓰지 않는 것이 기본이다. 팀장 포인터의 `DOCKER` 값(worker-prompt.md
  변수표)이 `allow` 일 때만(`docker` 태그 Task) 풀리고, 그때도 `dflow.sh config no_docker` 가 `1` 이면 금지다. 옛 포인터의
  `NO_DOCKER` 는 보지 않는다. 기준선 전에 판정하고 출처를 기준선 기록에 남긴다. 판정·제외·도커 슬롯·기록의 정본은
  dev-discipline.md 「도커 사용 규칙」 이며, 도커 런타임을 켜지 않는 규칙은 금지 모드와 무관하게 늘 지킨다.

- 인자 파싱: `$ARGUMENTS` 에 `--worker` 가 있으면 이 모드다. 참조는 id8 으로만 온다. `--scope` 는 팀장이 넘긴 그대로 따른다(SKILL.md
  「실행 범위」). 범위 때문에 끝나면 `.result` 는 `design_review`(설계만 멈춤)·`skipped design_missing`·`skipped design_invalid <빠진 절>`
  (구현부터인데 사람 설계가 없거나 모자람)이다.
- `.result` 형식과 status 뜻은 `.claude/skills/dflow-team/references/worker-prompt.md` 가 정본이다. 끝날 때
  status·agent 브랜치·head·`done` exit·한 줄 사유를 마지막에 요약해 워커가 `.result` 로 옮기게 한다.
- 중단(exit 10, 상태 모델)이면 `.result` 에 `{TSK} {ID8} <branch|-> <head_sha|-> - cancelled <멈춘 Phase 와 호출>` 을
  쓰고 끝낸다. push 하지 않으므로 `<head_sha>` 는 로컬 커밋이다. 팀장이 슬롯을 풀고 pane 을 거두되 워크트리는
  남긴다(산출물 보존).
- 기본 브랜치를 switch·pull·merge·push 하는 지점은 행 A·B·C 뿐이며, 워커는 셋 다 하지 않는다. 행 F 의
  재시도는 수동·워커 모두 merge 하지 않는다. claim 전 기점 이동(`git switch --detach`, Phase 01 2번)은 기본
  브랜치를 체크아웃하지 않으므로 팀장 체크아웃과 부딪치지 않는다. agent 브랜치를 만들고 그 위에 push
  하는 Phase 01 3번과 Phase 06(`reported` 커밋 포함)는 워커에서도 그대로 돈다.
- 새로 만드는 "사람에게 묻기" 지점은 없다. dflow-dev 의 판단 실패는 이미 전부 "중단·보고"(push 훅
  거부, Verify 재시도 소진, 빨간 기준선)라서 워커에서는 `.result` 의 `failed <사유>` 로 떨어진다. 설계
  재량 분기는 판단 규칙이 받으며, 대부분은 골라서 진행하고 기록한다. `blocked` 는 되돌리기 어려운 결정뿐이다.
- 인자 파싱과 위 아홉 행만 워커용으로 갈린다(행 F 는 수동과 같고 결과 표기만 다르다). 게이트·Phase
  정의·커밋 규칙·모델 배정(dev-discipline.md)은 워커에서도 같다. 행 I 의 Refactor 생략도 dev-discipline.md 가 정한
  무인 모드 규칙을 따르는 것이다.
