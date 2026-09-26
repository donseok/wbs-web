---
name: dflow-team
description: D'Flow 에서 내게 배정되고 에이전트 위임(tags:agent)된 ready 작업을 상시 감시해 슬롯 N개의 팀원에게 나눠 동시에 개발시키는 팀장 스킬. 팀원은 자기 서브에이전트를 띄울 수 있는 독립 세션(tmux pane 또는 Orca 탭)이며 각자 워크트리에서 /dflow-dev 를 돌린다. 당일·여러 날·종료 요청 전까지 실행할 수 있다. 트리거 - "/dflow-team", "팀으로 개발", "팀장 시작", "N건 동시 착수", "팀장 종료". 사용법 - /dflow-team [인원] <종료시각|종료 요청 전까지> [모델] [effort] [WP-XX…] · /dflow-team help
---

# /dflow-team: 팀장 (슬롯 N개 동시 개발)

인자: `$ARGUMENTS`

> **컨텍스트 압축 뒤에는 Skill 도구로 `/dflow-team` 을 다시 부르지 않는다**(스킬 전체가 다시 실린다). 「팀장 상태」
> 의 「압축 뒤 첫 기상」 대로 재독 세트만 Bash `sed` 로 읽는다. 재독 명령은 매 기상 `wake.sh` 출력의 `COMPACT_REREAD` 줄에 있다.

> **위치 선언**: 설계 정본은 wbs-web 리포 docs/superpowers/specs/2026-09-10-dflow-team-design.md(킷에는 미동봉).
> `/dflow-poll` 의 1건 착수를 슬롯 N개 동시 착수와 상시 보충으로 넓힌다. 기본은 담당자가 자리에 있는 supervised
> 루프이고, 사람이 명시하면 여러 날이나 종료 요청 전까지 무인으로도 돈다(「인자」). 서버 통신은 dflow.sh 로 하고
> exit code 로 분기하며, dflow-work 금지사항을 상속한다.
>
> **제1 제약: 팀원을 서브에이전트로 띄우지 않는다.** 팀원은 `/dflow-dev` 를 돌리고 `/dflow-dev` 는 Phase 를
> 서브에이전트로 쪼갠다. 서브에이전트는 자기 턴이 끝나면 완료로 보여, 그 뒤 끝난 Phase 손자의 완료가 팀원을 깨우지
> 못한다. 팀원은 별도 프로세스의 **대화형** claude 메인 에이전트다: 팀장이 tmux pane 에 띄운 프로세스 또는 Orca 탭
> 프로세스(backends.md). 이 문서의 서브에이전트 금지는 모두 이 조항을 가리킨다.
>
> **팀장 역할: 팀장은 대상 리포의 소스를 고치지 않고, 빌드·시험을 직접 돌리지 않는다.** 그 일은 팀원(이슈 보고에 대한
> `[팀장 지시]`)이나 해소 워커(「4-1」)에게 넘긴다. 팀장이 직접 하는 것은 이 스킬이 맡긴 것뿐이다: 스킬 스크립트 호출
> (`dflow.sh`·`sweep-check.sh`·`dialect-check.sh`·`resolve-decide.sh` 등), 팀장 체크아웃의 git 조작(fetch·detach·스윕 머지),
> 이벤트·문제 기록, 백엔드 명령. 유일한 예외는 개발 브랜치 자체가 깨졌을 때의 최소 수정이다(「2-4」 5번).

**참조**: 아래 문서는 그 절차를 탈 때 Bash `cat` 으로 읽는다(심링크 배포 리포에서 Read 는 작업 디렉터리 밖 읽기 확인을
부른다). 근거·이력은 `references/rationale.md` 에 모았다(운영에는 읽지 않아도 된다).

| 문서 | 읽는 때 |
|---|---|
| `references/help.md` | 인자가 `help` 일 때만 |
| `references/args.md` | 인자를 물어야 할 때(종료 시각 누락·오류, 키 후보 둘 이상), 키를 자동 선택해 저장할 때, 키 판정이 `KEY_*`·`NO_*_KEY` 로 끝날 때 |
| `references/precheck.md` | 전제 검사가 `PRECHECK_OK` 없이 끝났을 때, 또는 `WARN GRADLE_TUNING` 이 나왔을 때 |
| `references/extend.md` | 사람이 실행 중 연장을 말할 때 |
| `references/second-lead.md` | 같은 리포에서 다른 신원의 팀장을 하나 더 띄울 때 |
| `references/backends.md` | spawn·회수·정리·답 넣기·고아 정리 때(그 절만) |
| `references/worker-prompt.md` | 팀장은 읽지 않는다(팀원 규칙. 포인터로 넘기기만 한다) |
| `references/resume.md` | 재개 spawn(「5-1」) 때 |
| `references/restart.md` | TICK 판정·결과 줄 없는 `PANE_DEAD`·재투입·rate-limit 대기·중단 표식 정리 때 |
| `references/design-ahead.md` | 빈 슬롯에 선행 대기 작업을 설계 선행으로 줄 때, `design_waiting` 결과·설계 완료 대기 워크트리(고아 스캔 0번)를 다룰 때 |
| `references/merge-conflict.md` | 머지 충돌 접수·해소 spawn·해소 결과·사람 머지 감지 때 |
| `references/issues.md` | 팀원의 SendMessage 이슈 보고가 도착했을 때(「2-4」) |
| `references/closing.md` | 「7. 마감」 에 들어설 때(잠금 상실·lease 상실 마감 포함) |
| `references/events.md` | 기록 명령 절은 매 기상 `wake.sh` 가 띄운다. 이벤트 표는 필드가 궁금할 때 |

문제 기록: 팀원이 겪은 에러·문제점은 팀장 체크아웃의 `docs/dflow-team/issues.md` 에 쌓인다(「3. 결과 처리」). 스킬 개선
재료이며 커밋하지 않는다.

`dflow.sh` 는 `.claude/skills/dflow-work/scripts/dflow.sh` 이며 `.dflow`·`.dflow.local`(레거시는 `.env`)을 스스로 읽으므로
접두를 붙이지 않는다. `<기본브랜치>` 는 「1. 시작」 전제 검사가 구한 이름이다. `<MAIN>`·`<MAIN_CHECKOUT>` 은 팀장
체크아웃의 절대경로, `<신원>`·`<host>` 는 「1. 시작」 전제 검사가 만든 슬러그다.

## 인자

`/dflow-team [인원] <종료시각|종료 요청 전까지> [모델] [effort] [WP-XX…]`. 예: `/dflow-team 18:00`,
`/dflow-team 4명 18시까지 opus`, `/dflow-team 18:00 WP-02 WP-03`, `/dflow-team 3일 뒤 06:00까지`,
`/dflow-team 종료 요청 전까지`, `/dflow-team 18:00 opus effort xhigh`.

- 인자는 자연어로 해석한다. 플래그 문법을 강제하지 않는다.
- **`help`**: 인자가 `help`·`--help`·`-h`·`도움말`·`사용법` 중 하나면 `references/help.md` 를 Bash `cat` 으로 읽어
  그대로 보여 주고 **끝낸다.** 전제 검사·잠금·서버 호출을 하지 않는다. 그 파일은 이때만 읽는다.
- **강제 인수**: 인자에 `--takeover`·`강제 인수`·`넘겨받기` 가 있으면 「1. 시작」 의 `<TAKEOVER>` 를 `--takeover` 로,
  없으면 빈 값으로 채운다. 같은 신원이 이 프로젝트의 팀장 lease 를 **다른 곳**(다른 clone·다른 PC)에서 쥐고 있을 때
  그것을 빼앗는다. 밀려난 팀장은 약 1분 안에(다음 갱신 + 감시 루프 20초) `LEASE_LOST` 로 멈추고, 그 팀장의 워커는 하던 작업을 끝낸다. 사람이
  명시할 때만 쓴다.
- **키 판정**: `.dflow.local` 의 `pats`(레거시 `.env` 의 `DFLOW_PATS`)에 토큰이 둘 이상이면 어느 키로 돌지를 시작
  전에 정한다. 「1. 시작」 전제 검사
  **전**, 다른 인자의 질문보다 **먼저** 한다. 정본은 `.dflow.local` 의 `as=<prefix>`(레거시
  `.env` 의 `DFLOW_AS`)이며
  `dflow.sh`·`poll.sh`·팀원(`.dflow.local` 심링크)·heartbeat 훅이 모두 그 값을 따른다. 키는 `.dflow.local` 처럼
  **워크트리마다 따로** 정한다(주 체크아웃, 「두 번째 팀장」 의 팀장 워크트리마다). 팀원은 자기 팀장의 키를 따른다.
  ```bash
  (echo "as=$(.claude/skills/dflow-work/scripts/dflow.sh config as)"; .claude/skills/dflow-work/scripts/dflow.sh profiles) \
    | .claude/skills/dflow-team/scripts/live-leads.sh --mark
  ```
  토큰마다 한 줄 JSON(`prefix`·`name`·`email`·`who`·`bound`·`selected`·`in_use`, 실패한 토큰은 `error`)이 나온다. 필드 뜻은
  `references/args.md` 「키 판정 상세」 다. `in_use` 가 `null` 이 아닌 키(다른 워크트리의 살아 있는 팀장이 쓰는 신원)로는
  시작할 수 없다.

  | 상태 | 처리 |
  |---|---|
  | `as`(레거시 `DFLOW_AS`) 가 있다(값이 비어 있지 않다) | 묻지 않는다. `selected` 가 `true` 인 행이 없으면 `KEY_NOT_FOUND`, 그 행의 `in_use` 가 `null` 이 아니면 `KEY_IN_USE` 로 끝낸다 |
  | 없고 토큰이 1개 | 그 행의 `in_use` 가 `null` 이 아니면 `KEY_IN_USE` 로 끝내고, 아니면 그대로 간다 |
  | 없고 토큰이 2개 이상 | `error` 가 없고 `bound` 가 `true` 이고 `in_use` 가 `null` 인 행이 후보다 |
  | → 후보 0개 | `bound` 가 `true` 인 행이 하나도 없으면 `NO_KEY_FOR_PROJECT`, 있는데 모두 `in_use` 면 `NO_FREE_KEY` 로 끝낸다 |
  | → 후보 1개 | 그 키를 자동 선택한다 |
  | → 후보 2개 이상 | AskUserQuestion 으로 묻는다. 종료 시각도 물어야 하면 같은 호출에 모은다 |

  `bound` 가 `null` 이면(프로젝트 바인딩 없음) 키 판정을 건너뛰고 전제 검사로 간다. 묻기·자동 선택한 키의 저장·끝낼 때의
  보고 문구는 `references/args.md` 「키 판정 상세」 대로 한다(자동 선택이든 답이든 고른 prefix 를 저장한다).
- **종료 시각은 유일한 필수 인자다.** 새 배정을 멈추는 시각이며 세 형식 중 하나로 정규화한다. 정규화한 값을
  `<UNTIL>`, 좌석표에 싣는 표시 문자열을 `<UNTIL_LABEL>` 이라 부른다.

  | 말 | `<UNTIL>` | `<UNTIL_LABEL>` |
  |---|---|---|
  | `18:00`, "18시까지" (오늘) | `18:00` | `18:00` |
  | "내일 아침 7시", "3일 뒤 06:00", "월요일 09:00", `2026-09-21 06:00` | `2026-09-21 06:00` | `09-21 06:00` |
  | "종료 요청 전까지", "무기한", "계속", "끝날 때까지" | `none` | `종료요청까지` |

  - 날짜가 붙은 말은 오늘 날짜(`date +%Y-%m-%d`)를 기준으로 절대 날짜로 바꾼다. "N일 뒤" 는 오늘+N일, 요일은 오늘
    이후 가장 가까운 그 요일이다. 시각만 있고 그 시각이 오늘 이미 지났으면 **내일로 추측하지 않고** 묻는다.
  - 날짜가 붙은 종료 시각은 지금부터 **7일 이내**여야 한다(`UNTIL_TOO_FAR`). 그보다 길게 돌리려면 `종료 요청 전까지`
    를 쓴다.
  - 시작 보고의 첫 줄에 정규화한 절대 시각(또는 "종료 요청 전까지")을 적는다.
  - **종료 요청**: 종료 시각 전이라도, 또는 `none` 이면 언제든 둘 중 하나로 멈춘다. 둘 다 「7. 마감」 으로 간다.
    1. 팀장 세션에 말로 한다: "팀장 종료", "마감해", "그만" 같은 말.
    2. 다른 세션·터미널에서 종료 파일을 만든다. 감시 루프가 20초 안에 보고 `STOP_REQUESTED` 로 팀장을 깨운다.
       ```bash
       touch "$(git -C <팀장 체크아웃> rev-parse --git-path dflow-team.stop)"
       ```
  - 종료 시각이 없거나, 이미 지났거나, 형식이 틀리거나, 7일을 넘으면 사용법만 출력하고 끝내지 않고
    **AskUserQuestion 으로 묻는다.** 묻는 것은 「1. 시작」 전제 검사 **전**이다(잠금을 쥔 채 답을 기다리지 않는다).
    한 번의 호출에 모아 묻고, 선택지·다시 묻기·사용법 출력은 `references/args.md` 「인자 질문」 대로 한다. 종료 시각이
    주어졌으면 나머지 선택 인자는 묻지 않고 기본값을 쓴다.
  종료 시각이 지나면 새 배정을 멈추고, 진행 중인 팀원은 대기 상한까지 기다린 뒤 남은 것을 목록으로 보고한다
  (「7. 마감」).
  - **실행 중 연장**: 사람이 "내일 9시까지 연장" 처럼 말하면 `references/extend.md` 대로 한다(`team.extend` 기록, poll·
    감시 루프·좌석표 갱신, 마감 중이면 마감 취소). **`team.start` 를 새로 쓰지 않는다.**
- **여러 날·무기한 실행**(`<UNTIL>` 이 오늘이 아니거나 `none`): 시작 보고에 "팀원은 권한 확인 생략 모드로 무인으로
  돕니다. 답을 기다리는 팀원은 사람이 답할 때까지 슬롯을 잡습니다." 를 한 줄 더 적는다. macOS 면 절전 방지를
  건다(「1. 시작」 6번). 서버(Linux)와 Windows 는 절전 방지를 걸지 않는다.
- 인원은 동시 팀원 슬롯 수다. **기본 3, 인원 상한은 이 PC 의 `min(6, K+2)`.** K 는 무거운 명령 슬롯 수
  (`heavy.sh` 와 같은 계산: `DFLOW_HEAVY_SLOTS`, 없으면 `max(1, ⌊RAM_GB/8⌋)`)라 16GB 면 4명, 32GB 이상이면 6명이다.
  상한은 아래로 구하고, 인원(기본 3 포함)이 상한을 넘으면 상한으로 자르고 그 사실을 출력 줄과 함께 한 줄 알린다.
  ```bash
  .claude/skills/dflow-team/scripts/capacity.sh max
  ```
  출력은 `TEAM_MAX <상한> k=<K> ram=<GB>GB source=<default|DFLOW_TEAM_MAX>` 한 줄이다. 사람이 상한을 바꾸려면 팀장
  세션의 환경변수 `DFLOW_TEAM_MAX`(1~6)로 덮는다. 6 은 덮어도 넘지 못한다(`clamped=` 가 붙는다).
- **도커 허용 태그: 팀원은 도커를 쓰지 않는 것이 기본이고(인원과 무관), D'Flow 작업의 tags 에 `docker` 가 있는 Task 의
  팀원에게만 허용한다.** 이 판정을 정하는 곳은 이 줄 하나다. 새 작업·재개·재시작·해소 포인터를 쓸 때마다 띄우기 직전에
  `.claude/skills/dflow-team/scripts/docker-allow.sh <id8>` 로 그 작업의 서버 tags 를 다시 읽고, 출력의 `DOCKER=allow`·
  `DOCKER=ban` 을 포인터에 그대로 싣는다(「5. 팀원 spawn」 3·4번, `references/resume.md` 4·6항, merge-conflict.md 「2」 4번). 조회에 실패하면
  `ban` 이다(모르면 금지). 옛 포인터(`.dflow-prompt`)의 값을 옮겨 쓰지 않는다(옛 `NO_DOCKER=0` 을 허용으로 읽지 않는다).
  허용된 팀원도 도커 명령은 PC 전역 도커 슬롯(`heavy.sh --pool docker`, 기본 1개)을 잡은
  동안에만 돌린다. 여러 Task 가 같은 목적으로 도는 도커 검증(DB 방언)은 팀원이 아니라 「4. 승인 스윕」 끝의 방언 검증이 한
  번 돈다. `.dflow`·`.dflow.local` 의 `no_docker=1` 은 태그가 있어도 막는 강제 스위치이며 워커가 스스로 읽는다(`0` 은
  아무것도 풀지 않는다). 태그는 사람이 D'Flow 웹의 WBS 명세나 wbs.md import 의 tags 필드로 단다(`agent` 와 같은 자리).
  도커 명령은 대상 리포가 제공하는 컨테이너 재사용 방식을 따른다. 규칙 정본은 dev-discipline.md 「도커 사용 규칙」.
- 모델은 선택이다(`opus`|`sonnet`). 없으면 포인터에 `MODEL=default` 를 넘겨 기본 모델을 쓴다. 값은 팀원이
  `/dflow-dev --model` 로 넘기고, 두 백엔드 모두 팀원을 띄우는 `.dflow-run` 의 `claude --model` 에도 붙인다.
- **추론 강도(effort)는 기본 `high` 다**. 사람이 `effort xhigh`·`추론 강도 max` 처럼 요청할 때만
  바꾼다. 값은 `low`|`medium`|`high`|`xhigh`|`max` 중 하나이고, 그 밖의 값이면 한 줄 알리고 `high` 를 쓴다. 정한 값을
  `<EFFORT>` 로 기억한다. 두 백엔드 모두 `.dflow-run` 의 `claude` 호출에 `--effort <EFFORT>` 를 붙인다(backends.md
  「팀원 워크트리 준비」). 모델과 effort 는 묻지 않는다.
- **재개 인자 `--resume <id8>[ <id8>…]`** 는 선택이다. 자연어로 "443b8ffe 재개" 라고 써도 같게 해석한다. 이 인자가
  없어도 이 PC 에 남아 있는 중단된 팀원 워크트리는 자동으로 이어받는다(「팀장 상태」 고아 스캔의 "재개 가능"
  분류). `--resume` 은 **워크트리가 이 PC 에 없거나 다른 PC 가 claim 한 작업**을
  사람이 손으로 지목해 이어받게 한다(「5-1. 재개 spawn」). 지목한 id8 은 자동 판정의 거부 사유(재시도 상한 초과,
  `claimed_by` 불일치)를 무시하고 진행하며, 띄우기 전에 무엇이 남아 있고 무엇을 잃는지 한 줄로 보고한다.
- **WP 범위 `WP-XX`** 는 선택이다. 여럿이면 공백이나 쉼표로 적고, 모듈이 여럿인 프로젝트에서 한 모듈로 좁히려면
  `dict/WP-02` 처럼 모듈을 앞에 붙인다. 자연어로 "2번 WP만" 이라고 써도 `WP-02` 로 해석한다. 없으면 전체다.
  이 범위는 **새 배정만** 좁힌다. poll 이 `--wp` 로 그 WP 의 Task 만 돌려준다(「2-1」). 판정 기준은 `external_ref`
  의 TSK 번호 첫 칸이다(`dict/TSK-02-05` → `WP-02`). 재개(「5-1. 재개 spawn」)·「이어서 시작」 요청·승인 스윕은 범위와
  무관하게 그대로 한다. 범위 안의 작업이 범위 밖 선행을 기다리면 워커가 `skipped` 로 끝내고 일시 제외되는 것은 지금과 같다.
  범위는 `team.start` 의 `wp` 에 남긴다(「1. 시작」 5번). 컨텍스트 압축 뒤 poll 을 다시 띄울 때 그 값으로 복원한다.
- poll 조회 주기는 180초(3분)로 고정하고, 일시 제외는 `--recheck-cycles 10`(10주기 = 30분)으로 유지한다. 선행 대기(「2-3」
  「선행 사전 검사」)는 따로 `--wait-cycles 40`(40주기 = 2시간)으로 붙든다.
- **자동 머지 `automerge=1`**(`.dflow.local`, 개인 설정, 기본 0. 레거시는 `.env` 의 `DFLOW_AUTOMERGE=1`): 켜면
  팀원이 완료 보고(`done`)를 하는 즉시 팀장이 그
  agent 브랜치를 기본 브랜치에 머지하고 다음 Task 를 착수한다. **승인은 사후 확인이다.** 스윕이 `/dflow-merge --on-report`
  로 돌며(「4. 승인 스윕」), 승인 전에 머지한 작업은 state.json 에 `phase: "merged"` 와 `unapproved: true` 를 남긴다.
  나중에 사람이 승인하면 다음 스윕이 표식만 지우고, 반려하면 "반려(머지됨)" 으로 보고한다(되돌리기는 사람이 고른다).
  꺼져 있으면 종전대로 approved 만 머지하며, 승인 대기인 선행의 후속은 승인·머지 뒤에야 풀린다.
  값은 인자가 아니라 설정이며 스윕마다 아래로 읽는다.
  ```bash
  [ "$(.claude/skills/dflow-work/scripts/dflow.sh config automerge)" = 1 ] && echo AUTOMERGE_ON || echo AUTOMERGE_OFF
  ```
- 작업을 빼는 인자는 없다. 특정 작업을 잡지 않게 하려면 D'Flow 에서 그 작업의 `agent` 태그를 끈다. 팀장
  내부의 제외 목록은 그대로 있다.

## 팀장 상태: 메모리는 캐시다

상태: 슬롯 표(슬롯 번호·`AGENT_ID`·TSK·id8·워크트리·pane id 또는 터미널 핸들·시작 시각·직전 생존 증거), 대기 큐(슬롯이 없어
못 준 ready id8), 영구 제외(failed·반려·진행 중), 일시 제외(선행·spec 사유), 선행 대기(사전 검사의 선행 미충족 id8 과 선행 ref),
답을 기다리는 `blocked`, 결과 줄 경로별 마지막 처리 해시, 차단기, 백엔드. **답을 받아 팀원 화면에 넣는 일은 한 번의 기상 안에서
끝내며 중간 상태를 남기지 않는다**(`team.answer` 는 넣은 뒤 기록한다. 그 사이 압축되면 다시 통지되고 사람이 한 번 더 답한다).
세션 메모리의 이 값들은 캐시일 뿐이며, 팀장은 **깨어날 때마다** 아래 정본에서 다시 만든다.

**압축 뒤 첫 기상**: 요약은 절차의 정본이 아니다.
- **압축 신호**: 하나라도 맞으면 압축 뒤다. (1) 대화가 "이전 대화에서 이어진다" 는 요약으로 시작한다. (2) 이 문서의 절 본문을
  글자 그대로 볼 수 없고 요약만 있다. (3) 슬롯 표·`<신원>`·`<host>`·`<UNTIL>` 같은 값을 대화에서 찾을 수 없다. 모르겠으면
  압축 뒤로 본다(재독은 싸다). 폴링만 이어 가지 않는다.
- **할 일**: 행동하기 전에 재독 세트(이 파일의 「참조」~「인자」「팀장 상태」「2. 기상과 감시」「3. 결과 처리」)를 아래 한 줄로 읽는다. 매 기상
  `wake.sh` 출력의 `COMPACT_REREAD` 줄이 같은 명령이다. Read 도구가 아니라 Bash `sed` 로 읽는다. Skill 도구로 `/dflow-team` 을
  다시 부르지 않는다.
  ```bash
  sed -n '/^\*\*참조\*\*/,/^## 두 번째 팀장/p;/^## 2\. 기상과 감시/,/^## 4\. 승인 스윕/p' .claude/skills/dflow-team/SKILL.md
  ```
- 재독 세트 밖의 절(「4」~「7」·「좌석표 연동」·「금지」)과 `references/*` 는 압축 뒤 그 절차를 처음 탈 때 그 절만 `sed`·`cat` 으로
  읽는다(「참조」 표). 기억으로 절차를 밟지 않는다.
- `<host>` 도 기억이 아니라 「1. 시작」 의 명령으로 다시 구한다. 요약에서 빠진 규칙(이벤트의 추가 필드, `parked` 표시,
  host 슬러그와 `host` 필드의 차이)은 기억으로 메워지지 않으며, 그렇게 기록한 줄은 다음 재구성이 읽지 못한다.

이 절의 접두는 모두 `<신원>/<host>/` 로 시작한다(같은 신원이 다른 PC 에서 띄운 팀장의 워크트리를 자기 것으로 읽지 않는다).

**정본**: 이 신원·이 PC 의 팀원 워크트리와 그 결과. `TM` 은 「1. 시작」 전제 검사가 출력한 tmux 절대경로다.
```bash
TM='<진짜 tmux 절대경로>'   # Orca 백엔드면 빈 값
dirs=$(.claude/skills/dflow-work/scripts/dflow.sh config tasks-dirs); rc=$?   # 팀장 체크아웃 기준 값이 정본. 워크트리마다 다시 부르지 않는다 — 팀원 워크트리는 detach 된 옛 커밋에 있어 project_map 이 다르게 나올 수 있다(DEV_BRANCH 와 같은 이유)
{ [ "$rc" = 0 ] && [ -n "$dirs" ]; } || { echo "FAIL TASKS_DIRS rc=$rc"; exit 1; }
git worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r w; do
  [ -f "$w/.dflow-agent" ] || continue
  a=$(head -n 1 "$w/.dflow-agent")
  case "$a" in "<신원>/<host>/"*) ;; *) continue ;; esac
  rf=$(printf '%s\n' "$dirs" | while IFS= read -r dd; do
    find "$w/$dd" -mindepth 2 -maxdepth 2 -name .result 2>/dev/null; done | head -n 1)
  r=$([ -n "$rf" ] && head -n 1 "$rf")
  b=$(git -C "$w" branch --show-current)
  p=$(head -n 1 "$w/.dflow-pane" 2>/dev/null); alive=-
  if [ -n "$p" ] && [ -n "$TM" ]; then
    d=$("$TM" -L dflow list-panes -t "$p" -F '#{pane_dead}' 2>/dev/null | head -n 1)
    case "$d" in 0) alive=alive ;; *) alive=dead ;; esac
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$a" "$w" "${b:--}" "${r:--}" "${p:--}" "$alive"
done
```
- `FAIL TASKS_DIRS`(`config tasks-dirs` 실패·빈 값)면 재구성을 멈춘다(빈 폴더로 워크트리 전체를 훑어 오판한다).
- `.dflow-agent` 가 `<신원>/<host>/w<slot>` 인 워크트리가 그 슬롯의 팀원 워크트리, `<신원>/<host>/parked` 는 슬롯이
  아니며 고아 스캔만 본다. 그 안의 `<TASKS>/*/.result` 가 결과이고, 브랜치 `agent/<id8>-…`·워크트리 이름 `dflow-<id8>` 이
  작업을 알려 준다.
- 마지막 칸(`.dflow-pane` 의 tmux pane): `alive` 면 살아 있고, `dead` 면 죽었거나 사라졌으며(빈 출력도 `dead`), `-` 면 Orca 팀원이다.

**보조**: `~/.dflow/events.jsonl` 에서 마지막 `team.start` 이후이고 `agent` 가 `<신원>/<host>/lead`, `repo` 가
이 리포(`<MAIN>`)인 줄. **줄을 통째로 띄우지 않고** 아래 스크립트의 요약만 읽는다(이벤트를 그대로 띄우면 실행이 길수록
불어난다). 스크립트는 아래 목록의 규칙대로 계산하며, 출력 줄
(`RUN`·`EVENTS`·`BREAKER`·`CONFLICT_CLEARED`·`HASH_OMITTED`·`EXCLUDE_*`·`ISSUE_PENDING`·`WAIT_ANSWER`·`LOST`·`SLOT`·`HASH`)의
뜻은 스크립트 머리에 있다.
```bash
.claude/skills/dflow-team/scripts/lead-state.sh --agent '<신원>/<host>/lead' --repo '<MAIN>'
```
- `EVENTS` 의 `bad` 가 0 보다 크면 깨진 줄을 빼고 셌다는 뜻이다. 재구성 보고에 "events.jsonl 깨진 줄 <n>" 을 싣는다.
  `HASH_OMITTED` 가 0 보다 크면 `HASH` 에 없는 경로의 해시는 같은 명령에 `--hash '<worktree>'` 를 붙여 따로 읽는다.
- `RUN` 의 `wp`(`team.start` 의 `wp`, 없는 옛 줄은 전체 `-`)가 WP 범위다. poll 을 다시 띄울 때 `--wp` 에 넘긴다.
- 종료 시각(`<UNTIL>`·`<UNTIL_LABEL>`)은 **마지막 `team.extend`** 의 `until`·`until_label` 이고, 없으면 `team.start` 의
  `until` 이다(`RUN` 의 `until`·`until_label`).
- `team.spawn` 의 `slot`·`id8`·`worktree`·`handle` 로 슬롯과 작업을 잇는다(`SLOT`. 브랜치 전인 Phase 01 팀원도 id8 을 안다).
- `spawn_kind` 가 `resolve` 인 줄은 해소 워커다(「5-2. 해소 spawn」, 워크트리 `<MAIN>/.claude/worktrees/dflow-<id8>-resolve`,
  detached). **해소 워커 판별은 워크트리 이름 접미사 `-resolve` 로 한다**(재기록이 `spawn_kind` 를 `readopt` 로 덮는다.
  `merge-conflict.md` 「0」). 결과는 `references/merge-conflict.md` 「4. 해소 결과 처리」 표로 처리하고, 고아 스캔에서는
  backends.md 「고아 정리 규칙」 2-1번으로 가르며 "재개 가능" 으로 보내지 않는다. 워커 자동 재시작(H)의 대상도 아니다.
- `team.result`·`team.blocked` 로 이미 판정한 작업, 제외 목록(`skipped` 는 일시, `failed`·`failed no-result`·
  `failed not-isolated`·`failed no-worker-flag`·`failed deps`·`failed not-assignee`·`cancelled`·`blocked` 는 영구, `failed rate-limit`·`design_waiting` 은 제외
  없음), 차단기 상태(끝에서부터 연속한 `failed…` 수. `failed not-assignee`·`cancelled`·해소 워커의 내용 실패(`references/merge-conflict.md` 「6. 차단기」)는 세지도 끊지도 않고 건너뛴다. `team.lost` 는 `cause` 와 무관하게 실패 1건으로 센다. 단 `next=wait` 인 `team.lost` 는 세지도 끊지도 않는다), 결과 줄 경로별 마지막 처리 해시(경로는
  `<worktree>/<TASKS>/<tsk>/.result`)를 복원한다.
- 단 사유가 `선행 미충족(사전 검사:` 로 시작하는 `skipped` 는 일시 제외가 아니라 **선행 대기**다. 선행 대기 목록은
  「2-3」 의 선행 대기 블록 출력으로 복원한다.
- 제외 목록은 id8 마다 마지막 `team.spawn`·`team.blocked`·`team.result` 로 정한다. 마지막이 `team.spawn` 이나
  `team.blocked` 면 진행 중(영구 제외)이고, `team.result` 면 위 status 별 제외다. `team.answer` 는 제외를 바꾸지
  않는다.
- **`team.lost`**: id8 의 마지막 이벤트(`team.spawn`·`team.blocked`·`team.result`·`team.lost` 중)가 `team.lost` 면 영구 제외
  (진행 중)다. 재시작 대기 목록·rate-limit 대기·보류는 `references/restart.md` 「이벤트로 본 상태」 블록으로 복원한다.
  이 블록은 `team.start` 로 자르지 않는다.
- `team.blocked` 중 그 뒤에 같은 id8 의 `team.answer` 가 없는 것이 답을 기다리는 질문이다(`WAIT_ANSWER`. 그 뒤에 같은 id8 의
  결과·spawn·손실이 온 것은 이미 끝난 질문이라 뺀다). 두 백엔드 공통이다.
- `team.issue` 중 id8 마다 **마지막** 것의 `decision` 이 `pending` 인 것이 아직 지시를 보내지 않은 이슈다(`ISSUE_PENDING`)
  (「2-4. 팀원 이슈 보고 처리」). 압축 뒤 첫 기상에서 이 목록을 복원해 곧바로 2·3번(판단·추가 지시)을
  마무리한다 — 사람에게 넘긴 채 잊지 않는다.

**재구성 규칙**
- 살아 있는 팀원의 워크트리는 그 `.dflow-agent` 슬롯 번호로 슬롯 표에 흡수한다. 그 안에 `.result` 가 있으면
  처리 여부를 해시로 가린 뒤 처리한다(「3. 결과 처리」).
- 새로 줄 슬롯 번호는 흡수한 번호를 뺀 1..N 중 가장 작은 것이다(같은 `AGENT_ID` 를 다시 발급하지 않는다).
- "살아 있는 팀원" 은 spawn 했고 아직 최종 판정(`done`·`needs-merge`·`skipped`·`failed`·`cancelled`·`resolved`·`design_waiting`)을 받지 않은 팀원이다.
  화면이 떠 있는지로 판단하지 않는다. Orca 는 `.dflow-agent` 가 `w<slot>` 인 워크트리 중 최종 status 의
  `.result` 가 없는 것이며, tmux 는 거기에 더해 정본 표의 생존 칸이 `alive` 여야 한다. `blocked` 는 최종
  판정이 아니므로 그 팀원은 두 백엔드 모두 살아 있다. 실제로 죽은 Orca 팀원은 무응답 규칙(「3. 결과 처리」)이
  가려낸다. tmux pane 이 죽었으면(`dead`) 살아 있지 않으며, `.result` 가 있으면 결과 처리로, 없으면 죽은 pane
  화면 폴백과 고아 스캔으로 간다(「3. 결과 처리」). 팀장 세션이 새로 떠도 살아 있는 tmux 팀원은 원래 슬롯
  번호로 흡수한다(tmux 서버는 팀장과 따로 돈다).
- 대기 큐는 재구성하지 않는다(다음 poll 이 같은 ready 를 다시 찾는다). `blocked` 작업은 대기 큐에 넣지 않는다(그 팀원이
  슬롯을 잡은 채 답을 기다린다).
- **결과 중복 방지**: 결과 줄은 그 줄의 해시로 식별한다. `.result` 경로마다 events.jsonl 의 `team.result`·
  `team.blocked` 에서 마지막으로 처리한 해시(경로별 마지막 처리 해시)를 유도하고, 현재 줄의 해시와 비교해
  해시가 다를 때만 처리한다. 집계는 order 로 중복을 없앤다. 줄과 해시는 한 번의 Bash 호출로 함께 읽는다.
  ```bash
  l=$(head -n 1 '<경로>'); printf '%s\n' "$l"; printf '%s\n' "$l" | cksum | cut -d' ' -f1
  ```
- **고아 스캔**: 값이 `<신원>/<host>/` 로 시작하는 `.dflow-agent` 워크트리(`parked` 포함) 중 살아 있는 팀원이
  없는 것을 **정리 가능·재개 가능·멈춤** 셋으로 가른다. 판정 순서는 정리 → 재개 → 멈춤이며, 앞의 갈래에
  걸리지 않은 것이 뒤로 간다.
  0. **설계 완료 대기**: `<TASKS>/*/state.json` 이 `phase=wait_pred` 면 정리·멈춤으로 보내지 않는다. `references/design-ahead.md`
     2번(재개 판정)을 통과할 때만 2번으로 보내고, 아니면 그대로 둔다(재시작·재개 후보가 아니다).
  1. **정리 가능**: backends.md 「고아 정리 규칙」 대로 깨끗하고(미커밋 변경 없음) HEAD 가 `origin/<그 브랜치>`
     와 같다. 그 규칙대로 지운다.
  2. **재개 가능**: 아래가 모두 참이다. 「5-1. 재개 spawn」 의 대상이며 `.dflow-agent` 를 `parked` 로 바꾸지
     **않는다**.
     - 브랜치가 `agent/<id8>-…` 이다(id8 을 여기서 얻는다). 브랜치가 없으면 claim 전에 죽은 것이라 재개할
       산출물이 없다.
     - `.result` 가 없거나, 있어도 status 가 최종 판정(`done`·`needs-merge`·`skipped`·`failed`·`cancelled`·`resolved`)이 아니다.
       최종 판정이 있으면 재개가 아니라 「3. 결과 처리」 의 몫이다.
     - 서버 show 가 `status=claimed` 이고 `mine=true` 이며, `claimed_by` 를 소문자로 바꾼 값이
       `claude-<host>` 와 같거나 팀원 라벨 `<신원>/<host>/w<슬롯>` 의 가운데 칸이 `<host>` 다(이 PC 가 claim 했다).
     - 그 id8 의 재개 재시도가 상한(3)에 닿지 않았다.
     - 그 id8 이 `references/restart.md` 「이벤트로 본 상태」 에서 `PARKED`·`RL_WAIT`·`RL_DUE` 가 아니다.
       `RESTART_DUE` 는 이 다섯 조건과의 교집합일 때만 재개 가능이며(`references/restart.md` 「재투입」 의 재투입 전
       확인이 이번 기상의 show 로 판정한다), 재시작 대기 목록과 id8 으로 합쳐 한 번만 띄운다.
     ```bash
     w='<워크트리>'; id8='<id8>'
     br=$(git -C "$w" branch --show-current)
     (.claude/skills/dflow-work/scripts/dflow.sh show "$id8") \
       | jq -c --arg h 'claude-<host>' '.order | {status, mine,
           same_host: (((.claimed_by // "") | ascii_downcase) as $c | $c == $h or (($c | split("/")) as $p | ($p | length) == 3 and $p[1] == ($h | ltrimstr("claude-"))))}'
     jq -r --arg a '<신원>/<host>/lead' --arg r '<MAIN>' --arg i "$id8" \
       'select(.agent == $a and .repo == $r and (.id8 // "") == $i)
        | select(.event == "team.result" or (.event == "team.spawn" and (.spawn_kind // "new") == "resume"))
        | .event' ~/.dflow/events.jsonl 2>/dev/null \
       | awk '/team\.result/{n=0; next} {n++} END{print "tries=" n+0}'
     ```
     재시도 수는 마지막 `team.result` 이후의 `spawn_kind == "resume"` 인 `team.spawn` 개수다. 새 작업(`new`)과
     이어받은 슬롯의 재기록(`readopt`)은 세지 않는다. `team.start` 로 구간을 자르지는 않는다. 결과 줄이 하나라도
     나오면 `skipped` 여도 수가 0 으로 돌아가는 것은 **의도한 것이다**(판정을 남긴 작업은 그 status 의 제외 규칙이 다룬다).
  3. **멈춤**: 나머지다. 자동으로 지우지 않고 `.dflow-agent` 값을 `<신원>/<host>/parked` 로 바꾼 뒤(「고아 정리
     규칙」 3번) **"멈춤" 목록**에 넣는다.
- **"멈춤" 보고**: 멈춤으로 분류한 것, 서버에 claimed 인데 이 PC 어디에도 워크트리가 없는 id8(「1. 시작」 3번),
  결과가 `failed…` 이거나 무응답 자동 정리로 끝났는데 서버에 claimed 로 남은 작업(「3. 결과 처리」)을 한 표로
  낸다. 칸은 id8 · TSK · 워크트리 경로(없으면 `-`) · 브랜치 · 미커밋 파일 수 · 사유 · **재시작 명령**이다.
  사유는 `미커밋 보존`·`서버 미claim`·`다른 PC claim`·`재시도 상한`·`워크트리 없음`·`무응답`·`pane 죽음`·`rate-limit 반복`·
  `rate-limit 대기(<HH:MM>)`·`중단 표식 불일치`·`중단 표식 삭제 실패`·`거두기 실패`·`살아 있는 팀원`·`서버 <status>`·`서버 조회 실패`(`references/restart.md`), 또는 결과 줄의
  `failed <사유>` 로 적는다. `failed…` 로 끝난 작업은 자동 재개로 가지 않는다(원인을 사람이 먼저 고친 뒤 `--resume` 이
  그 워크트리를 그대로 이어받는다). 이 표는 시작 보고와 마감 보고에 모두 낸다.
  재시작 명령은 갈래마다 아래 중 하나를 그대로 적어 사람이 복사해 쓸 수 있게 한다.
  - 팀장에게 맡긴다: `/dflow-team <종료시각> --resume <id8>`
  - 사람이 그 워크트리에서 직접 한다(워크트리가 있을 때):
    ```bash
    printf '%s\n' '<신원>/<host>/w<slot>' > <워크트리>/.dflow-agent   # parked 를 되돌린다
    cd <워크트리> && claude   # 그 세션에서 /dflow-dev <TSK>
    ```
    `.dflow-agent` 를 먼저 되돌린다(`dflow.sh heartbeat` 는 값이 `*/parked` 면 exit 2 로 거부한다). `<slot>` 은
    `.dflow-prompt` 의 `AGENT_ID=` 에 박혀 있는 번호다.
- **부트스트랩 실패 정리**(해소 워크트리 `dflow-<id8>-resolve` 는 예외 — 「고아 정리 규칙」 2-1번): `.result` 의 branch 가 `-`(브랜치를 만들기 전에 끝남)이면 backends.md
  「고아 정리 규칙」 1번대로, 알려진 부산물만 있을 때만 `--force` 로 정리하고 그 밖의 변경이 있으면 보존하고
  보고한다.
- state.json 미러 같은 새 저장소는 만들지 않는다.

## 두 번째 팀장 (링크드 워크트리)

같은 리포에서 **다른 신원(다른 PAT)** 의 팀장을 하나 더 돌릴 때는 리포를 다시 clone 하지 않고 링크드 워크트리를
쓴다(`scripts/lead-worktree.sh`). 절차는 `references/second-lead.md` 다. 같은 신원으로는 띄울 수 없다(`SAME_IDENTITY_LEAD`).

## 0. 환경 감지 (시작 맨 처음)

백엔드는 Orca 를 **먼저** 보고, Orca 안이 아니면 tmux 를 본다. `TMUX` 환경변수는 감지에 쓰지 않는다(전용 소켓을 쓰고,
Orca 안에서도 채워진다).

| 순위 | 조건 | 백엔드 |
|---|---|---|
| 1 | `TERM_PROGRAM` 이 `Orca` 이거나 `ORCA_WORKTREE_ID` 가 비어 있지 않다 | **pane(Orca)** |
| 2 | Orca 밖이고 `find_tmux`(backends.md 「진짜 tmux 찾기」)가 진짜 tmux 절대경로를 돌려준다 | pane(tmux) |
| 3 | 그 밖 | `FAIL NO_TMUX` 로 중단하고 설치를 안내한다 |

감지는 「1. 시작」 전제 검사 블록 안에서 한 번에 하며, 그 블록이 `BACKEND`(`tmux` 또는 `orca`)와 `TM`(진짜
tmux 절대경로. Orca 백엔드면 빈 값)을 출력한다. 백엔드 이름은 시작 보고와 `team.start` 에 남긴다. 3번 갈래에서만 시작하지 않는다.

**플랫폼**: 이 문서의 셸 블록은 macOS·Linux 와 Windows(Git Bash) 에서 같은 절차로 돈다. Windows 에서만 다른
것(호스트 이름·팀장 세션 PID·심링크·tmux 설치)은 블록 안에서 `uname -s` 로 가르며(`MINGW*|MSYS*|CYGWIN*`),
그 차이의 목록은 backends.md 「플랫폼 차이」 다. WSL 은 Linux 다.

## 1. 시작

이 문서의 `<기본브랜치>` 는 개발 브랜치, 즉 `dflow.sh branch dev` 의 값이다(`.dflow.local` 의 `dev_branch`,
레거시는 `origin/HEAD`).
작업 폴더 `<TASKS>` 는 `<DOCS_DIR>/tasks` 다(리포 최상위 기준). 한 주문의 폴더 `<TASKS>/<TSK>` 는
`dflow.sh taskdir <ref>` 의 값이다 — `.dflow.local` 의 `project_map` 에서 그 주문의 프로젝트 키를, 없으면 `docs` 를 쓴다.
여러 작업을 훑을 때는 `dflow.sh config tasks-dirs` 가 내는 폴더 전부를 본다. `<DOCS_DIR>` 를 `docs` 로 박아 둔
고정 경로는 쓰지 않는다.

1. **전제 검사**: 아래 블록 하나를 한 번의 Bash 호출로 돌린다. 블록은 실패한 항목을 모두 `FAIL …` 로 출력한 뒤
   0 이 아닌 값으로 끝나고, **exit 가 0 이 아니면 아무것도 띄우지 않고 중단·보고한다.** `<UNTIL>` 은 「인자」 에서
   정규화한 종료 시각, `<TAKEOVER>` 는 「인자」 강제 인수다.
   ```bash
   fail=0; bad() { echo "FAIL $*"; fail=1; }
   MAIN=$(git rev-parse --show-toplevel); [ -z "$(git rev-parse --show-prefix)" ] || bad NOT_REPO_ROOT
   case "$MAIN" in *' '*) bad SPACE_IN_PATH ;; esac
   if [ -x .claude/skills/dflow-team/scripts/gradle-check.sh ]; then   # Gradle 권장 설정 — 경고만, 시작은 막지 않는다
     .claude/skills/dflow-team/scripts/gradle-check.sh "$MAIN" 2>/dev/null | while IFS= read -r gline; do
       case "$gline" in
         "NOFILE "*) echo "WARN GRADLE_TUNING ${gline#NOFILE } (gradle.properties 없음)" ;;
         "MISSING "*) grest=${gline#MISSING }; echo "WARN GRADLE_TUNING ${grest% *} ${grest##* }" ;;
       esac
     done
   fi
   base=$(.claude/skills/dflow-work/scripts/dflow.sh branch dev) || bad CONFIG
   [ -n "$base" ] || bad NO_DEFAULT_BRANCH
   [ -z "$base" ] || git rev-parse -q --verify "refs/remotes/origin/$base" >/dev/null || .claude/skills/dflow-work/scripts/dflow.sh branch ensure-dev >/dev/null || bad "NO_REMOTE_DEV_BRANCH $base"
   cur=$(git branch --show-current)   # detached HEAD 면 빈 값
   [ -n "$base" ] && [ -n "$cur" ] && [ "$cur" != "$base" ] && bad "NOT_DEFAULT_BRANCH $base 또는 detached HEAD 여야 한다"
   for s in dflow-dev dflow-work dflow-poll dflow-merge dflow-team; do [ -e ".claude/skills/$s/SKILL.md" ] || bad "NO_SKILL $s"; done
   grep -q '^<!-- dflow-caps: worker ' .claude/skills/dflow-dev/SKILL.md || bad OLD_DFLOW_DEV
   grep -q '^<!-- dflow-caps: remote-candidates ' .claude/skills/dflow-merge/SKILL.md || bad OLD_DFLOW_MERGE
   .claude/skills/dflow-work/scripts/dflow.sh config --source >/dev/null || bad "CONFIG .dflow·.dflow.local 을 확인하라(위 사유 코드)"
   [ -n "$(.claude/skills/dflow-work/scripts/dflow.sh config projects)" ] || bad "NO_PROJECT .dflow 의 project_id 또는 .dflow.local 의 project_map 을 넣어라"
   .claude/skills/dflow-work/scripts/dflow.sh doctor   # 진단 출력용. 종료 코드로 판정하지 않는다
   email=$(.claude/skills/dflow-work/scripts/dflow.sh me | jq -r '.user_email // empty')
   [ -n "$email" ] || bad AUTH
   who=$(printf '%s' "$email" | cut -d@ -f1 | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9-]/-/g')
   host=$(hostname | cut -d. -f1 | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9-]/-/g')
   echo "user_email=$email lead=$who/$host/lead"
   legacy=$(.claude/skills/dflow-work/scripts/dflow.sh config tasks-dirs | while IFS= read -r d; do find "$(git rev-parse --show-toplevel)/$d" -mindepth 2 -maxdepth 2 -name state.json 2>/dev/null; done | while IFS= read -r f; do
     jq -e '.phase == "reported" and ((.api_base // "") == "")' "$f" >/dev/null 2>&1 && printf '%s ' "$f"
   done)
   [ -z "$legacy" ] || bad "LEGACY_REPORTED $legacy"
   mkdir -p ~/.dflow
   ex=$(git rev-parse --git-path info/exclude); mkdir -p "$(dirname "$ex")"; touch "$ex"
   for p in '**/.claude/worktrees/' '/dflow-*/' '.vitest/' '/.dflow-agent' '/.dflow-prompt' '/.dflow-pane' '/.dflow-run' '/.dflow.local' '**/tasks/*/.result' '**/tasks/*/.issues' '**/tasks/*/decisions.json' '/docs/dflow-team/'; do
     grep -qxF "$p" "$ex" || printf '%s\n' "$p" >> "$ex"
   done
   tracked=$(git ls-files .claude/skills/dflow-dev | head -n 1)   # 비어 있지 않으면 킷 복사형(dflow 스킬이 git 추적됨)
   if [ -z "$tracked" ]; then   # 심링크형 — 일반 스킬을 추적하는 리포면 dflow-* 링크만 가린다
     if [ -n "$(git ls-files .claude/skills | head -n 1)" ]; then sp='/.claude/skills/dflow-*'; else sp='/.claude/skills'; fi
     grep -qxF "$sp" "$ex" || printf '%s\n' "$sp" >> "$ex"
   fi
   if [ -n "$tracked" ] && [ -n "$base" ]; then
     if git fetch -q origin; then
       git show "origin/$base:.claude/skills/dflow-dev/SKILL.md" 2>/dev/null | grep -qE '^<!-- dflow-caps: worker |--worker' || bad "KIT_NOT_PUSHED dflow-dev"
       git show "origin/$base:.claude/skills/dflow-merge/SKILL.md" 2>/dev/null | grep -qE '^<!-- dflow-caps: remote-candidates |origin/agent/\*' || bad "KIT_NOT_PUSHED dflow-merge"
     else
       bad "KIT_NOT_PUSHED fetch 실패"
     fi
   fi
   [ -z "$(git status --porcelain)" ] || bad DIRTY
   UNTIL='<UNTIL>'   # HH:MM · YYYY-MM-DD HH:MM · none
   if [ "$UNTIL" != none ]; then
     case "$UNTIL" in ??:??) u="$(date +%Y-%m-%d) $UNTIL" ;; *) u="$UNTIL" ;; esac
     ue=$(date -j -f '%Y-%m-%d %H:%M:%S' "$u:00" +%s 2>/dev/null || date -d "$u" +%s 2>/dev/null)
     if [ -z "$ue" ]; then bad "UNTIL_BAD $UNTIL"
     elif [ "$ue" -le "$(date +%s)" ]; then bad "UNTIL_PAST $UNTIL 는 이미 지났다"
     elif [ "$ue" -gt $(( $(date +%s) + 7 * 86400 )) ]; then bad "UNTIL_TOO_FAR 7일을 넘는다. 더 길게는 '종료 요청 전까지'로 시작하라"
     fi
   fi
   find_tmux() {
     for c in /opt/homebrew/bin/tmux /usr/local/bin/tmux /usr/bin/tmux "$(command -v tmux 2>/dev/null)"; do
       [ -n "$c" ] && [ -x "$c" ] || continue
       grep -q 'agent-teams-tmux' "$c" 2>/dev/null && continue
       "$c" -L "dflowprobe$$" has-session -t __probe__ 2>&1 | grep -qi 'unsupported command' && continue
       printf '%s\n' "$c"; return 0
     done
     return 1
   }
   TM=
   if [ "${TERM_PROGRAM-}" = Orca ] || [ -n "${ORCA_WORKTREE_ID-}" ]; then
     BACKEND=orca
     { orca terminal create --help | grep -q -- '--worktree' && orca terminal create --help | grep -q -- '--command'; } || bad ORCA_OLD
     command -v claude >/dev/null 2>&1 || bad NO_CLAUDE_CLI
   elif TM=$(find_tmux); then
     BACKEND=tmux
     command -v claude >/dev/null 2>&1 || bad NO_CLAUDE_CLI
   else
     TM=
     BACKEND=-
     bad "NO_TMUX tmux 를 설치하라(macOS: brew install tmux · Debian/Ubuntu: apt install tmux · Windows: MSYS2 또는 WSL)"
   fi
   LEAD_PID=${CLAUDE_PID:-$PPID}   # 팀장 세션 프로세스. Bash 도구가 내보내는 CLAUDE_PID, 없으면 $PPID
   case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) [ -n "${CLAUDE_PID:-}" ] || bad "NO_CLAUDE_PID Windows 의 \$PPID 는 1 이라 팀장 세션을 가려내지 못한다" ;; esac
   stale() {   # $1: 잠금 디렉터리. beat 있으면 70분, 없으면 디렉터리 수정 시각 10분으로 죽음을 본다
     b=$(cat "$1/beat" 2>/dev/null || true)
     if [ -n "$b" ]; then [ $(( $(date +%s) - b )) -ge 4200 ]
     else [ -n "$(find "$1" -maxdepth 0 -mmin +10 2>/dev/null)" ]; fi
   }
   # 같은 리포의 다른 워크트리에서 같은 신원의 팀장이 살아 있으면 거부한다
   dup=$(git worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r w; do
     [ "$w" = "$MAIN" ] && continue
     l=$(git -C "$w" rev-parse --path-format=absolute --git-path dflow-team.lock 2>/dev/null) || continue
     [ -d "$l" ] || continue
     [ "$(cut -d' ' -f1 "$l/owner" 2>/dev/null)" = "$who/$host/lead" ] || continue
     stale "$l" || printf '%s ' "$w"
   done)
   [ -z "$dup" ] || bad "SAME_IDENTITY_LEAD $dup"
   [ "$fail" = 0 ] || exit 1
   # 팀장 잠금: 나머지 검사가 모두 통과한 뒤 마지막에 원자 획득한다
   LOCK=$(git rev-parse --git-path dflow-team.lock)
   if ! mkdir "$LOCK" 2>/dev/null; then
     stale "$LOCK" || { echo "LOCKED $LOCK owner=$(cat "$LOCK/owner" 2>/dev/null) beat=$(cat "$LOCK/beat" 2>/dev/null || echo 없음)"; exit 1; }
     T="$LOCK.stale.$$"
     mv "$LOCK" "$T" 2>/dev/null || { echo "LOCKED $LOCK"; exit 1; }
     stale "$T" || { echo "LOCKED $LOCK 옮긴 잠금이 새롭다. 다른 팀장이 방금 가져간 것이므로 $T 를 $LOCK 로 되돌려라"; exit 1; }
     rm -rf "$T"
     mkdir "$LOCK" 2>/dev/null || { echo "LOCKED $LOCK"; exit 1; }
     echo "STALE_LOCK_TAKEN"
   fi
   # owner = <신원>/<host>/lead <시작 epoch> <팀장 세션 PID>. 방금 만든 잠금이라 쓰기에 실패하면 지우고 끝낸다
   { printf '%s %s %s\n' "$who/$host/lead" "$(date +%s)" "$LEAD_PID" > "$LOCK/owner" && date +%s > "$LOCK/beat"; } \
     || { rm -rf "$LOCK"; echo "FAIL LOCK_WRITE $LOCK"; exit 1; }
   rm -f "$(git rev-parse --git-path dflow-team.stop)"   # 지난 실행이 남긴 종료 요청을 지운다
   rm -f "$(git rev-parse --git-path dflow-team.lease-lost)"   # 지난 실행이 남긴 lease 상실 표식을 지운다
   TAKEOVER='<TAKEOVER>'   # --takeover 또는 빈 값(「인자」 강제 인수)
   if [ "$TAKEOVER" = --takeover ]; then lr=$(.claude/skills/dflow-work/scripts/dflow.sh lease acquire --takeover)
   else lr=$(.claude/skills/dflow-work/scripts/dflow.sh lease acquire); fi
   lrc=$?
   printf '%s\n' "$lr"
   [ "$lrc" = 0 ] || { rm -rf "$LOCK"; echo "FAIL LEASE rc=$lrc"; exit 1; }
   echo "PRECHECK_OK lead_pid=$LEAD_PID BACKEND=$BACKEND TM=$TM"
   ```
   - `PRECHECK_OK` 가 없으면(`FAIL …`·`LOCKED`·lease 거부) `references/precheck.md` 를 `cat` 으로 읽고 그 코드의 처리대로
     보고한다. 질문하지 않고 중단한다(AskUserQuestion 을 쓰지 않는다).
   - **잠금 소유 판정**: `owner` 의 신원이 자기 `<신원>/<host>/lead` 이고 PID 가 현재 `$LEAD_PID`(`CLAUDE_PID`, 없으면
     `$PPID`)와 같다. 매 기상(`wake.sh`)과 「7. 마감」 이 이 판정으로 소유를 확인한 뒤에만 `beat` 를 갱신하거나 잠금을
     지운다. 생존(다른 팀장이 가져가도 되는지)은 PID 가 아니라 `beat`(70분, 없으면 잠금 디렉터리 수정 시각 10분)로 본다.
   - **팀장 lease**: 로컬 잠금을 잡은 **뒤** 얻는다. `LEASE_OK <n>` 이면 계속하고, 그 밖(`LEAD_LEASE_HELD`·exit 2·3·5·6·7)이면
     블록이 잠금을 지우고 멈춘다(fail-closed, 처리 문구는 precheck.md).
2. **담당 작업 폴더 scaffold**: 팀장 체크아웃(개발 브랜치)에서 `.claude/skills/dflow-work/scripts/dflow.sh scaffold` 를
   한 번 부르고 출력 한 줄(`scaffold created=N skipped=N no_ref=N`)을 시작 보고에 싣는다. **개발 브랜치 위일 때만
   부른다**(detached HEAD 에서는 커밋하지 못해 트리가 더러워진다). **scaffold 를 부르기 전에 개발 브랜치를
   fast-forward 한다**. fast-forward 가 실패하면 scaffold 자체를 건너뛴다(뒤처진 dev 에서 커밋하면 push 가 거부돼
   로컬과 원격 dev 가 갈라진다). 아래 블록 하나로 판정하고 부른다(1번의 변수는 남아 있지 않다):
   ```bash
   dev=$(.claude/skills/dflow-work/scripts/dflow.sh branch dev); cur=$(git branch --show-current)
   if [ -n "$dev" ] && [ "$cur" = "$dev" ]; then
     if git pull -q --ff-only origin "$dev"; then
       .claude/skills/dflow-work/scripts/dflow.sh scaffold || echo "scaffold 경고: exit $?"
     else
       echo "scaffold 건너뜀(개발 브랜치 fast-forward 실패)"
     fi
   else
     echo "scaffold 건너뜀(detached HEAD 또는 개발 브랜치 아님)"
   fi
   ```
   실패(exit≠0)는 경고만 하고 계속한다 — 편의 기능이지 게이트가 아니다. **그래도 push 실패가 보고되면** 다음 승인 스윕
   전에 `git pull --rebase origin <기본브랜치>` 로 사람이 직접 되돌린다.
3. **재구성**: 새 `team.start` 를 쓰기 **전에** 「팀장 상태」 의 재구성과 고아 스캔을 한다("마지막 `team.start` 이후"
   필터가 이전 세션의 이벤트를 가리지 않게). 이 단계가 곧 재기동 절차다. 이어서
   서버에 claimed 인데 흡수한 슬롯·고아 워크트리·답을 기다리는 `blocked`·대기 중인 답 어디에도 없는 id8 을
   **"멈춤" 표(사유 `워크트리 없음`)** 에 넣고 영구 제외에 넣는다. 자동으로 재착수하지 않는다(이 PC 에 워크트리가
   없으면 다른 PC·수동 세션에서 도는 것과 가를 수 없고, `show` 는 생존 신호를 내주지 않는다). 사람이 `--resume <id8>`
   으로 지목할 때만 이어받는다(「5-1. 재개 spawn」). **워크트리가 이 PC 에 남아 있는 갈래는 이 조항이 아니라 「팀장 상태」 고아 스캔의
   "재개 가능" 이 맡아 자동으로 이어받는다.**
   ```bash
   (.claude/skills/dflow-work/scripts/dflow.sh list --scope claimed) | awk -F'\t' 'NF>=4 && $2=="CL" {print $4}'
   ```
   상태 열이 `CL` 인 행만 센다(`--scope claimed` 는 승인 대기인 `RP` 행도 돌려준다).
4. **시작 보고**: 첫 줄은 정규화한 종료 시각, 바로 다음 줄은 `키: <이름> (<email>, <prefix>)`(토큰이 하나여도 적는다.
   값은 「인자」 키 판정의 `selected` 행)다. 이어서 3번의 **"멈춤" 표**(「팀장 상태」)를 내고, 재개 가능으로 분류한 것과
   `--resume` 지목분은 "이번에 이어받습니다" 로 한 줄 알린다. 2번의 scaffold 출력 한 줄(부른 경우 `scaffold created=N
   skipped=N no_ref=N`, 건너뛴 경우 "scaffold 건너뜀(detached HEAD 또는 개발 브랜치 아님)")도 싣는다.
   1번 전제 검사가 `WARN GRADLE_TUNING …` 을 냈으면 그 줄들도 싣는다(시작은 막지 않는다. 처리는 precheck.md).
   WP 범위가 있으면 "새 배정은 <WP 목록> 만 합니다. 재개·승인
   스윕은 범위와 무관합니다." 를 한 줄 알린다. 백엔드와 무관하게 "팀원은 **권한 확인 생략 모드로** 돕니다. 팀장 세션의 권한 모드와
   무관합니다." 를 알린다. tmux 백엔드면 "화면은 `TMUX= tmux -L dflow attach` 로 볼 수 있습니다." 를 한 줄 더
   알린다(`TMUX=` 는 팀장이 tmux 안일 때의 중첩 attach 거부를 피한다).
   `AUTOMERGE_ON` 이면(「인자」 자동 머지) "자동 머지: 켜짐. 완료 보고된 작업은 승인 전에 main 에 머지하고, 승인은
   사후에 확인합니다." 를 한 줄 알린다. 꺼져 있으면 알리지 않는다.
5. `team.start`(backend, slots, until, wp)를 기록한다. `until` 은 `<UNTIL>` 이다. `wp` 는 정규화한 WP 범위를 쉼표로 이은 값이며 없으면 `-` 다. 3번에서 이어받은 것은 `team.start` 바로 뒤에 같은 필드로
   다시 기록한다: 흡수한 슬롯마다 `team.spawn`(`spawn_kind` 는 `readopt`)(원래 종류는 `orig_kind` 필드에 싣는다, `references/events.md`), 답을 기다리는 `blocked` 마다
   `team.blocked`, 흡수한 슬롯의 마지막 처리 해시마다 `team.result` 또는 `team.blocked`. 다시 기록하지 않으면
   이어받은 팀원이 살아 있지 않은 것으로 보이고 같은 결과가 다시 처리된다(재구성은 새 `team.start` 이후만 읽는다).
   그 다음 **승인 스윕**(「4. 승인 스윕」)을 한 번 돌고 결과(머지됨·대기·반려·건너뜀)를 한 줄씩 보고한다. 이 스윕은 사전 검사 없이 늘 부른다(「4-0」 의 예외).
   스윕을 마친 뒤, 빈 슬롯이 있으면 재개 대상을 띄운다(「5-1. 재개 spawn」).
6. **감시 시작**: 「2-2」 대로 감시 루프를 `--new-tick` 으로 띄운다(다음 TICK 을 지금+1800초로 정한다). 재기동 조건이
   맞으면 poll.sh 도 띄운다(「2-1」). 둘 다 Bash `run_in_background` 로 띄운다. 셸 `&` 는 쓰지 않는다(종료
   알림이 세션에 오지 않아 루프가 소리 없이 끊긴다). 그 다음 좌석표에 감시 시작을 알린다. STANDBY 는
   마지막 신호 뒤 70분에 꺼지므로 시작과 매 기상마다 보낸다.
   ```bash
   LOCK=$(git rev-parse --git-path dflow-team.lock); lead=$(cut -d' ' -f1 "$LOCK/owner")
   .claude/skills/dflow-work/scripts/dflow.sh watch --agent "$lead" \
     --slots <N> --busy <M> --until '<UNTIL_LABEL>' --json || :
   ```
   **절전 방지**: `<UNTIL>` 이 오늘이 아니거나 `none` 이고 `uname -s` 가 `Darwin` 이면, 이어서 아래를 Bash
   `run_in_background` 로 띄운다. `-w` 는 팀장 세션 프로세스가 끝나면 함께 끝나게 한다. 「7. 마감」(closing.md 6번)이 거둔다.
   ```bash
   caffeinate -i -w <LEAD_PID>
   ```
   `-i` 는 시스템 유휴 절전만 막는다. 시작 보고에 "전원을 연결하고 뚜껑을 연 채로
   두라" 를 적는다. Linux 서버와 Windows 에서는 띄우지 않는다.
   **lease 갱신**: 이어서 아래를 Bash `run_in_background` 로 띄운다(모든 OS). 60초마다 lease 를 갱신하고,
   팀장 세션이 끝나면 lease 를 바로 반납하고 끝난다. lease 를 잃으면 표식 파일에 사유를 쓰고 끝나며, 감시 루프가
   그것을 보고 `LEASE_LOST` 로 깨운다. `<lease-lost 절대경로>` 는
   `git rev-parse --path-format=absolute --git-path dflow-team.lease-lost` 의 값을 **리터럴로** 박는다.
   ```bash
   .claude/skills/dflow-work/scripts/dflow.sh lease keep --pid <LEAD_PID> --lost-file '<lease-lost 절대경로>'
   ```
   이 첫 watch 응답에도 `resume_requests` 가 실려 온다. 「2-3」 의 처리 규칙대로 읽어, `host` 가 이 PC 인 요청은
   5번에서 띄우지 못한 재개 대상에 더해 지금 띄운다(첫 `TICK` 까지 놓아 두지 않는다).
   `<N>` 은 「인자」 에서 정한 인원, `<M>` 은 지금 슬롯 표에서 찬 슬롯 수, `<UNTIL_LABEL>` 은 「인자」 의 표시 문자열이다.
   `--project` 는 넘기지 않는다(`dflow.sh watch` 가 설정의 `project_id` 를 쓰고, `${V:+--project "$V"}` 꼴은 zsh 에서
   깨진다). 신원은 방금 쓴 잠금 `owner` 에서 읽는다(1번의 env 는 남아 있지 않다).

## 2. 기상과 감시

팀장은 포그라운드로 기다리지 않는다. 팀장을 깨우는 것은 넷이다: poll.sh 종료(새 작업·시한·오류), 감시 루프
종료(팀원 결과·팀원 pane 종료·`TICK`·`STALE`·`STOP_REQUESTED`), 사람이 이 세션에 주는 답(종료 요청 포함),
팀원의 cross-session 메시지(SendMessage 이슈 보고, 「2-4. 팀원 이슈 보고 처리」). 팀원은 결과 줄을 알리지는 않지만,
이슈가 생기면 SendMessage 로 이 세션을 직접 깨울 수 있다.

### 2-1. poll

작업 폴더가 없는 빈 디렉터리를 cwd 로 두고 띄운다.
```bash
mkdir -p "$(git rev-parse --git-path dflow-team-poll)"
POLL_DIR=$(cd "$(git rev-parse --git-path dflow-team-poll)" && pwd)
( cd "$POLL_DIR" && DFLOW_CONFIG_DIR="<MAIN>" DFLOW_WATCH=0 \
    "<MAIN>/.claude/skills/dflow-poll/scripts/poll.sh" --require-tag agent --until '<UNTIL>' --interval 180 --recheck-cycles 10 \
    --wait-cycles 40 [--wp <WP-02,dict/WP-03>] [--exclude <id8,id8>] [--exclude-temp <id8,id8>] [--exclude-wait <id8,id8>] )
```
대괄호는 선택 플래그 표기이며 실제 명령에는 쓰지 않는다. `<MAIN>` 경로는 따옴표로 감싼다(공백이 있으면 poll 이 곧바로
죽는다).
- 빈 디렉터리를 cwd 로 두므로 poll exit 9·10(승인·반려 감지)은 팀장에게 오지 않는다. 팀장은 기상마다 승인 스윕 판정(「4-0」)을 한다.
- `DFLOW_CONFIG_DIR` 은 설정 위치다(poll 의 cwd 는 작업 트리 밖이다. 레거시 리포는 `<MAIN>/.env` 를 읽는다). `git rev-parse
  --git-path` 가 상대경로를 줄 수 있어 `cd … && pwd` 로 절대경로를 만든다.
- `DFLOW_WATCH=0`: 팀장이 자기 식별자로 watch 를 보내므로 poll.sh 의 watch 는 끈다.
- `--exclude` 에는 **영구 제외 ∪ 현재 슬롯의 id8** 을 넣는다. 슬롯의 id8 은 재구성으로 복원된다(claim 전의 ready 를
  poll 이 즉시 다시 찾지 않게). `--exclude-temp` 에는 일시 제외 목록을, `--exclude-wait` 에는 선행 대기 목록(「2-3」 선행 대기 블록 출력의 id8)을
  넣는다. 한 id8 은 둘 중 한쪽에만 넣는다.
- 목록은 공백 없는 쉼표 구분이다. **목록이 비면 그 플래그 자체를 생략한다.** 빈 값을 넘기면 poll.sh 가 다음
  플래그를 값으로 삼켜 사용법 오류로 끝난다.
- `--wp` 에는 WP 범위(`team.start` 의 `wp`)를 공백 없는 쉼표 구분으로 넣는다. 범위가 전체(`-`)면 플래그를 생략한다.
  poll.sh 가 형식(`WP-<숫자>` 또는 `<모듈>/WP-<숫자>`)을 검사해 틀리면 exit 2 로 끝나며, 번호 앞의 0 은 무시한다.
- 대기 큐는 `--exclude` 에 넣지 않는다(압축으로 대기 큐를 잃으면 그 작업들이 보이지 않는 제외에 갇힌다).

**재기동 조건**: 빈 슬롯이 있고, 대기 큐가 비었고, 차단기가 풀려 있고, rate-limit 보류(`references/restart.md` 「이벤트로 본 상태」)가 없을 때만 띄운다. poll 은 기동 즉시 첫
조회를 하므로 줄 수 없을 때 띄우면 공회전한다. 예외는 하나다: 차단기가 걸린 `TICK` 에 대기 큐가 비어 시험 spawn 할 후보가 없으면 poll 을
한 번 띄우고, 그 poll exit 0 에서는 1건만 시험 spawn 하고 나머지는 대기 큐에 넣는다. poll 이 떠 있지 않은
구간이 있으므로, 팀장은 기상마다 스스로 시각을 보고 종료 시각이 지났으면 poll exit 8 과 같이 처리한다.

일시 제외는 poll.sh 가 10주기(30분) 뒤 스스로 풀어 재발견을 유도하므로, 팀장은 해제 시각을 따로 관리하지 않는다.
풀린 id8 이 다시 발견되면 착수 판정을 다시 하고, 여전히 막히면 다시 일시 제외에 넣는다. 그래서 poll exit 0 의
재대조는 일시 제외 목록을 보지 않는다(「2-3」 표). poll 을 다른 이유로
재기동하면 10주기 계산이 처음부터 다시 시작된다(재검사가 늦어질 뿐 틀린 착수는 없다). 선행 대기는 poll.sh 가 40주기(2시간) 뒤에 풀고,
선행 대기 블록도 기록 시각으로 2시간 지난 것을 뺀다. 두 장치 가운데 먼저 닿는 쪽이 푼다.

### 2-2. 감시 루프

감시 루프는 `scripts/tick.sh` 다. 루프를 손으로 쓰지 않고 아래 한 줄을 Bash `run_in_background` 로 띄운다(셸 `&` 금지).
대괄호는 선택 플래그 표기다.
```bash
.claude/skills/dflow-team/scripts/tick.sh [--new-tick] [--may-skip] [--until '<UNTIL>'] --tm '<진짜 tmux 절대경로 또는 빈 값>' \
  --owner '<신원>/<host>/lead' --slots <N> --until-label '<UNTIL_LABEL>' --pid "${CLAUDE_PID:-$PPID}" \
  -- '<워크트리1>/<TASKS>/<TSK1>/.result|<해시1>|<pane1>' '<워크트리2>/<TASKS>/<TSK2>/.result|-|-'
```
- `--` 뒤: 진행 중 슬롯(`blocked` 포함)마다 `'<.result 경로>|<마지막 처리 해시 또는 ->|<pane id 또는 ->'`(pane id 는 tmux
  팀원의 `.dflow-pane` 첫 줄, Orca 는 `-`). 없으면 비운다. 공백·작은따옴표가 든 경로는 지원하지 않는다.
- `--tm` 은 전제 검사의 `TM` 을 **리터럴 절대경로**로 쓴다(Orca 면 `''`. 별도 셸이라 변수를 못 물려받고 PATH 에 Orca shim 이
  있을 수 있다). 세대·종료·lease 상실 파일 경로는 스크립트가 git 에 묻는다.
- `--new-tick` 은 시작과 `TICK` 기상 때만 붙인다(다음 TICK = 지금+1800초). 그 밖의 교체는 세대 파일의 값을 그대로 써서
  TICK 이 밀리지 않는다. `--until` 은 `<UNTIL>` 이 `none` 이 아닐 때 붙인다.
- 교체는 TaskStop 이 아니라 세대 파일 `$(git rev-parse --git-path dflow-team.gen)`(`<세대> <다음 TICK epoch 초> <건너뛴 TICK
  수>`)로 한다. 기동하면 세대를 올리고 옛 루프는 `STALE` 로 끝난다(압축으로 태스크 id 를 잃어도 겹치지 않는다). 새 루프 없이
  끝내기만 할 때(「7. 마감」)는 `tick.sh --retire` 다.
- 진행 중 슬롯의 경로·처리 해시·pane id 집합이 바뀔 때와 루프가 끝나 있을 때 새로 띄운다. 압축 뒤 떠 있는지 모르면
  새로 띄운다. 루프는 기동 즉시 전수 검사한 뒤 20초 간격으로 본다(교체 사이에 온 `.result` 를 놓치지 않는다).

출력의 **마지막 줄**이 기상 사유다. 위에서부터 먼저 걸린 하나다.

| 마지막 줄 | 뜻 |
|---|---|
| `STALE` | 세대가 바뀌었다(새 루프가 떴거나 `--retire`) |
| `STOP_REQUESTED` | 종료 파일이 생겼다(「인자」 종료 요청). 결과보다 먼저 본다(멈추라고 한 뒤 새 결과로 spawn 을 잇지 않는다. 결과 줄은 마감에서 처리된다) |
| `LEASE_LOST <사유>` | lease 상실 표식(`dflow-team.lease-lost`). 종료 요청 다음, 결과보다 먼저 본다 |
| `RESULT_READY <경로…>` | 결과 줄의 해시가 넘겨받은 해시와 다르다. **줄 전체를 비교한다**(status 만 보면 답을 받은 팀원이 다시 `blocked` 가 돼도 깨지 않는다) |
| `PANE_DEAD <경로…>` | tmux 팀원 pane 이 새 결과 줄 없이 죽었거나 사라졌다. 결과 줄이 새로 있으면 `RESULT_READY` 가 먼저다 |
| `TICK` | 다음 TICK 시각이 지났다(한가해도 승인 스윕 판정 「4-0」 과 무응답 점검을 한다) |

**변화 없는 TICK 건너뛰기**(`--may-skip`): TICK 시각에 아래가 모두 참이면 TICK 을 내지 않고 **한 번만** 건너뛴다
(`TICK_SKIPPED at=<epoch> next=<epoch>` 줄을 남기고 계속한다). 건너뛴 다음 TICK 은 반드시 낸다(건너뛴 수는 세대 파일에 남아
루프를 바꿔도 이어지고 `--new-tick` 이 0 으로 되돌린다). 그래서 팀장 기상 간격은 최대 60분이다.
- 진행 중 슬롯(결과 줄이 `blocked` 인 것은 뺀다)마다 생존 증거(「3」 의 셋과 heartbeat)가 루프를 띄운 때와 달라졌고 서버
  status 는 그대로다. 한 슬롯이라도 증거가 그대로면(팀원 무응답 30분) 깨운다. 재지 못해도 깨운다.
- 승인 후보(`sweep-check.sh`)와 그 서버 status 가 그대로다(사람의 승인·반려는 깨운다). 판정 불가면 깨운다.
- 종료 시각이 지나지 않았다(poll 이 떠 있지 않을 때의 종료 시각 확인). 형식을 읽지 못하면 깨운다.
- `scripts/wake.sh`(「2-3」)가 `LOCK_OK` 를 내고 재개 요청 조회가 성공했으며 이 리포의 요청이 없다. `LOCK_LOST`·
  `WATCH_FAILED`·`HOLDER_FAILED`·`LEASE_KEEP_DEAD` 면 깨운다. 건너뛸 때도 이 호출이 잠금 `beat` 와 좌석표 STANDBY 를
  갱신한다(대가로, 루프를 띄운 뒤 멈춘 팀장은 한 TICK(30분) 늦게 드러난다).
건너뛸 때는 진행 슬롯마다 `EVIDENCE <id8> ct=<…> report=<…> heartbeat=<…> phase=<…> dirty=<…> status=<…>` 줄도 남긴다.
다음 TICK 에서 이 값이 그 슬롯의 "직전 TICK" 증거다(「3」 생존 증거).

`--may-skip` 은 TICK 이 시각으로 할 일이 없을 때만 붙인다. 아래 중 하나라도 있으면 붙이지 않는다.
- 차단기가 걸렸다(TICK 마다 시험 spawn 1건).
- 재시작 대기·rate-limit 대기(`references/restart.md` 「이벤트로 본 상태」 의 `RESTART_DUE`·`RL_WAIT`·`RL_DUE`)가 있다.
- 빈 슬롯이 있는데 띄우지 못한 후보(대기 큐·재개 대상·해소 큐. 입장 제어로 미룬 것 포함)가 남았다.
- 「7. 마감」 에 들어섰다(마감의 기다림은 `TICK` 두 번이다).

### 2-3. 기상마다 하는 일

모든 기상은 먼저 아래 한 줄(`scripts/wake.sh`, 기상 블록)을 돈다. 스크립트는 잠금 소유를 확인하고, 소유가 맞을 때만
`beat` 를 갱신하고 좌석표에도 같은 신호(watch)를 보낸 뒤, lease 갱신 상태를 보고, 마지막으로 `references/events.md` 의
「기록 명령」 절과 압축 뒤 재독 명령(`COMPACT_REREAD`)을 띄운다. `STALE` 은 그것만 하고 넘긴다(출력에 `EVIDENCE` 줄이 있으면 직전 TICK 증거로 갱신한다). 잠금을 잃은 팀장은 새
팀장의 잠금을 살아 있게 만들지 않는다(「1. 시작」 잠금 소유 판정).
기상에서 이벤트를 기록할 때는 이 출력이 띄운 `references/events.md` 의 명령 블록을 그대로 쓴다.
기억으로 재구성한 명령은 쓰지 않는다. events.md 의 가드가 인자가 비거나 필드가 빠진 줄을 `EVENT_ARGS_MISSING` 으로
거부하므로, 그 출력이 보이면 명령 블록을 다시 띄워 다시 기록한다.
```bash
.claude/skills/dflow-team/scripts/wake.sh --owner '<신원>/<host>/lead' --slots <N> --busy <M> --until-label '<UNTIL_LABEL>'
```
출력 줄(글자 그대로): `LOCK_OK` 다음 줄에 재개 요청 요약 `{"n":…,"err":…,"reqs":[…],"other_project":[…]}`(또는
`WATCH_FAILED`·`HOLDER_FAILED`), 소유가 아니면 `LOCK_LOST …`, lease 갱신이 멈췄으면 `LEASE_KEEP_DEAD …`, 그 뒤에 기록 명령 절이다.
팀장 세션 PID 는 `CLAUDE_PID` 로 본다(스크립트 안의 `$PPID` 는 팀장이 아니다).

**`resume_requests` 는 좌석표의 「이어서 시작」 요청이다.** 사람이 멈춘 좌석의 그 버튼을 누르면 서버가 주문에 표식을
남기고 watch 응답이 그것을 실어 온다(최대 50건, 오래된 것부터, 이 신원이 점유한 `claimed` 주문뿐이며 **프로젝트를 가리지
않는다**). 그래서 스크립트가 이 리포 바인딩(`DFLOW_PROJECT_ID`·`DFLOW_PROJECT_MAP`) 밖의 요청을 `reqs` 에서 빼
`other_project` 로 따로 낸다. `other_project` 는 처리하지 않고 "다른 프로젝트의 요청: <id8…>. 그 프로젝트 리포의 팀장이
처리한다" 로 한 줄만 보고한다. 처리 규칙은 셋이다.
- `n` 이 `"NULL"` 이면 **요청이 없는 것이 아니라 조회가 실패한 것이다.** `err` 에 사유가 온다. 그 기상에서는
  요청을 하나도 처리하지 않고 사유를 한 줄 보고한 뒤 다음 기상에 다시 읽는다. 빈 배열(`n` 이 0)과 절대
  뭉개지 않는다.
- `host` 가 이 PC 의 `<host>` 슬러그와 **글자 그대로 같은 것만** 「5-1. 재개 spawn」 으로 보낸다(서버가 `claimed_by` 에서
  파생한 값이다. 팀장이 다시 계산하지 않는다). 다른 값이면 **"멈춤" 표에 사유 `다른 PC claim` 으로 적고 띄우지 않는다.**
- **팀장은 표식을 지우지 않으며 확인 응답도 보내지 않는다.** 되살아난 워커의 첫 heartbeat 가 그것을 비우고,
  회수 뒤 재claim 하는 경로에서는 claim 라우트가 지운다.
`WATCH_FAILED`(watch 호출 실패)·`HOLDER_FAILED`(`lease holder` 조회가 실패해 watch 를 아예 부르지 않은 것. 빈 `--holder`
로 부르면 무필터로 전체 재개 요청이 온다)면 `beat` 는 이미 갱신됐으므로 잠금은 유효하고, 그 기상의 요청 처리만 건너뛴다.

`LEASE_KEEP_DEAD` 는 lease 갱신 프로세스가 3분 넘게 갱신하지 못한 것이다(죽었거나 서버에 닿지 못함). **이 기상이
「2-2」 감시 루프의 `LEASE_LOST` 로 온 것이면 이 문단은 건너뛰고 그 `LEASE_LOST` 를 그대로 따른다(아래 기상 표).**
둘이 같은 기상에 함께 뜰 수 있으며 **우선순위는 `LEASE_LOST` 다**: 곧장 「7. 마감」 의 lease 상실 마감으로 가고, 같은
기상에 함께 뜬 `LEASE_KEEP_DEAD` 는 무시한다.
그 밖의 기상(감시 루프의 `LEASE_LOST` 없이 이 블록만 `LEASE_KEEP_DEAD` 를 낸 경우)에서는 `dflow.sh lease renew`
를 한 번 부른다. `LEASE_OK` 면, lease 상실 표식 파일(`dflow-team.lease-lost`, 「2-2」)이 남아
있으면 먼저 지운 뒤 「1. 시작」 6번의 lease 갱신 블록과 감시 루프를 다시 띄운다(표식이 남으면 새 루프가 곧바로
`LEASE_LOST` 로 깨운다). `LEASE_LOST`
(exit 4)나 `LEASE_NONE` 이면 「7. 마감」 의 lease 상실 마감으로 간다. 그 밖의 실패는 사유를 보고하고 다음 기상에 다시
본다.

`LOCK_LOST` 면 **잠금 상실**이다. "잠금 상실" 로 보고하고 새 spawn 을 멈추며, 잠금을 지우지 않은 채 「7. 마감」 의
잠금 상실 마감으로 간다(다른 팀장이 잠금을 가져갔으면 두 팀장이 같은 체크아웃을 쓰게 된다).

`STALE` 과 `LEASE_LOST` 를 뺀 모든 기상에서는 `LOCK_OK` 뒤에 이어서 이 순서로 한다.
1. 재구성(「팀장 상태」). 컨텍스트 압축 뒤 첫 기상이면 그 전에 「팀장 상태」 의 「압축 뒤 첫 기상」 대로 재독 세트를
   읽는다(`wake.sh` 출력의 `COMPACT_REREAD` 줄).
2. 아래 표의 처리.
3. 승인 스윕 판정 — 부를지·몇 번인지는 「4-0. 스윕을 부르는 규칙」 이 정한다(기상마다 **최대 1회**, 먼저 `sweep-check.sh`).
   판정하는 기상은 시작, 결과 도착(`.result` 또는 완료 알림), `TICK`, poll
   재기동 직전, 마감이다(팀장의 poll 에는 exit 9·10 이 오지 않는다). 승인 반영은 사람이 승인한 뒤
   다음 기상까지 늦어지며, `TICK` 이 있어 최대 30분이다. 이 지연 동안 승인됐으나 main 미반영인 선행은 워커가
   그 `head_sha` 를 스택 기점으로 받고(`/dflow-dev` 「--worker」 B), 승인 대기인 선행의 후속은 `skipped` 로 일시
   제외됐다가 승인·머지 뒤 재검사에서 풀린다(「--worker」 G). 자동 머지(`AUTOMERGE_ON`)면 승인 대기인 선행도
   결과 도착 스윕에서 곧바로 머지되므로, 후속은 워커의 기본 브랜치 반영 확인(「--worker」 G)을 통과해 승인을
   기다리지 않고 착수한다.
4. 빈 슬롯이 있고 차단기가 허락하면 **재개 대상을 먼저**(「5-1. 재개 spawn」), 그 다음 **해소 큐**(「5-2. 해소 spawn」), 그 다음 대기 큐 맨 앞부터
   spawn 한다(「5. 팀원 spawn」). 재개 대상은 재구성의 고아 스캔이 "재개 가능" 으로 분류한 것과 아직 띄우지
   않은 `--resume` 지목분이다. 재시작 대기 목록(`references/restart.md` 「이벤트로 본 상태」 의 `RESTART_DUE`)도 재개 대상이며
   재투입 전 확인(`REINJECT_OK`)을 통과할 때만 띄운다. 재시작 대기는
   새 작업보다 먼저다. rate-limit 보류 중에는 재개·새 작업 모두 띄우지 않는다(`RL_DUE` 슬롯 자신의 재투입만 예외).
   그러고도 빈 슬롯이 남으면 선행 대기 작업을 **설계 선행**으로 준다(`references/design-ahead.md` 3번, `DFLOW_DESIGN_AHEAD_MAX`).
5. 끝나 있는 감시 루프를 다시 띄우고(`--may-skip` 은 「2-2」 의 조건일 때만), 재기동 조건(「2-1」)을 만족하면 poll.sh 를 다시 띄운다. 컨텍스트 압축 뒤
   poll 이 떠 있는지 모르면 재기동 조건에 따라 새로 띄운다. poll 이 겹쳐 떠도 poll exit 0 처리의 대조와 spawn 전
   확인(「5. 팀원 spawn」 1번)이 같은 작업을 두 번 띄우지 않게 막는다.

| 기상 | 처리 |
|---|---|
| poll exit 0 (ready N줄) | 각 줄 `순번<TAB>id8<TAB>이름` 에서 순번은 버리고 id8 만 쓴다. 먼저 후보를 영구 제외 목록과 슬롯 표에만 한 번 더 대조해 걸리는 것을 버린다(겹쳐 뜬 옛 poll 은 옛 제외 목록으로 돌 수 있다). 일시 제외는 대조하지 않는다(poll.sh 가 10주기 뒤 풀어 돌려준 것을 그대로 다시 판정한다, 「2-1」). 남은 후보마다 아래 show 필터로 `.order.item.spec` 이 비었는지와 선행 사전 검사(`deps_unmet`)만 본다(spec 본문을 컨텍스트에 싣지 않는다). 비었거나 `ref` 가 비면 일시 제외에 넣고 사유(spec 부재·TSK 없음)를 보고하며 `team.result`(slot `-`, status `skipped`)를 남긴다. `deps_unmet` 이 비어 있지 않으면 띄우지 않고 사유 `선행 미충족(사전 검사: <ref…>)` 로 보고와 `team.result` 는 같게 하되, 일시 제외가 아니라 **선행 대기**에 넣는다(아래 「선행 사전 검사」). `deps_unmet` 이 비었고 `deps_nohead` 가 비어 있지 않으면 아래 「선행 반영 사전 검사」 를 거친다. 남은 것을 빈 슬롯 수만큼 spawn 하고 나머지는 대기 큐 끝에 넣는다. 차단기가 걸려 있으면 spawn 하지 않고 대기 큐에 넣는다(시험 spawn 예외는 「2-1」 재기동 조건). 대기 큐를 잃어도 그 작업들은 아직 ready 이므로 다음 poll 이 다시 찾는다 |
| `STOP_REQUESTED`, 사람의 종료 요청("팀장 종료"·"마감해" 등) | 종료 시각과 무관하게 「7. 마감」 으로 간다. "종료 요청으로 마감합니다" 를 한 줄 알린다. 종료 파일은 이 자리에서 지운다(남기면 마감 중 다시 띄운 감시 루프가 곧바로 다시 끝나 공회전한다). 마감의 기다림(「7. 마감」 2번) 중에 종료 요청이 **한 번 더** 오면 기다림을 끝내고 곧바로 3번으로 간다 |
| poll exit 8 (시한) | 먼저 지금 시각이 현재 `<UNTIL>`(연장 반영) 전인지 본다. 전이면 연장 전에 띄운 옛 poll 이 끝난 것이므로 무시하고 재기동 조건(「2-1」)대로 새 `--until` 로 다시 띄운다. 지났으면 새 배정을 멈춘다. 대기 큐를 비우고(보고만 한다) 「7. 마감」 으로 간다 |
| poll exit 2·3·5·6·7 | 중단 사유(stderr)를 보고하고 「7. 마감」 으로 간다 |
| `RESULT_READY <경로…>` | 경로마다 「3. 결과 처리」 |
| `PANE_DEAD <경로…>` (tmux) | 경로마다 「3. 결과 처리」. `.result` 가 있으면 그 줄, 없으면 죽은 pane 화면 폴백, 그것도 없으면 `references/restart.md` 「판정」(`pane_dead_status` 127 이면 `failed no-result`) |
| 팀원의 cross-session 메시지(이슈 보고) | 「2-4. 팀원 이슈 보고 처리」 로 간다. 도착한 이 기상 안에서 곧바로 처리한다 — 사람에게 보고만 하고 턴을 끝내지 않는다 |
| 사람의 답 | 「6. blocked」 의 답 매칭 |
| `TICK` | 감시 루프를 `--new-tick` 으로 다시 띄워 다음 TICK 을 지금+1800초로 새로 정한다. 출력에 `TICK_SKIPPED` 가 있었으면 한 번 건너뛴 뒤의 TICK 이며 그 `EVIDENCE` 줄이 직전 TICK 증거다(「3」). 진행 중 슬롯의 생존을 확인하고 무응답 슬롯의 생존 증거를 잰다(「3. 결과 처리」). 결과 줄 없는 정체 슬롯과 재시작 대기 목록은 `references/restart.md` 「판정」·「rate-limit 대기」 를 탄다. 차단기가 걸려 있으면 시험 spawn 1건을 허용한다 |
| `LEASE_LOST <사유>` | 다른 곳이 이 신원+프로젝트의 팀장 lease 를 가져갔거나(`LEASE_LOST <project_id…>`), 서버에 3분 넘게 닿지 못했다(`LEASE_UNREACHABLE`). 위 1~5(재구성·승인 스윕·spawn·poll·감시 루프 재기동)를 하지 않고, 같은 `LOCK_OK` 블록이 함께 낸 `LEASE_KEEP_DEAD` 도 무시한 채 곧장 「7. 마감」 의 lease 상실 마감으로 간다 |
| `STALE` | 잠금 소유 확인과 `beat` 갱신만 하고 나머지는 넘긴다 |

poll exit 0 의 show 필터:
```bash
(.claude/skills/dflow-work/scripts/dflow.sh show <id8>) | tee "$(git rev-parse --git-path dflow-team-poll)/show-<id8>.json" \
  | jq -c '{order: .order.id, status: .order.status, ref: .order.item.external_ref, spec_empty: ((.order.item.spec // "") | length == 0),
            deps_unmet: [.depends_evidence[]? | select(has("reached") and .reached == false) | .external_ref],
            deps_nohead: [.depends_evidence[]? | select(.reached == true and ((.head_sha // "") == "")) | .external_ref]}'
```
show 가 실패하면(dflow.sh 가 0 이 아닌 코드로 끝나거나, 404 로 exit 7 이거나, 출력이 비면) spec 부재로 보지 않는다.
그 id8 은 "조회 실패" 사유로 일시 제외에 넣고 다음 기상에서 다시 판정한다(조회 실패를 데이터 없음으로 위장하지 않는다).

**선행 사전 검사**(`deps_unmet`): 서버 판정 `reached` 가 거짓인 선행이 하나라도 있으면 spawn 하지 않는다.
워커가 무엇을 하든 `skipped` 로 끝나는 확정 skip 이다(`reached` 가 거짓이면 `head_sha` 도 없고, 서버 claim 게이트도 같은
`reached` 로 거부한다). 이 검사는 워커 G 의 판정을 대신하지 않는다. `reached` 가 참인 선행(승인 대기·기본 브랜치 반영
여부·스택 기점)은 전부 워커가 판정하고, `reached` 키가
없는 옛 서버 응답이나 `depends_evidence` 가 없는 응답은 걸러내지 않고 워커에 맡긴다(판정 불가를 미충족으로 단정하지
않는다). `state.json` 의 `phase=merged` 로 거르지 않는다(단, 행 G 갈래 2 의 반영 확인은 아래 「선행 반영 사전 검사」 가 사전에 한다).
면제된 간선(`waived:true`, 계약 2.8)은 서버가 `reached:true` 로 주므로 이 검사에 걸리지 않는다 — 그대로 spawn 한다.

**선행 대기**: 이 검사로 건너뛴 작업은 일시 제외(30분)가 아니라 선행 대기에 둔다. 사유의 `<ref…>` 는
`deps_unmet` 원소를 공백으로 이어 적는다(`선행 미충족(사전 검사: d/TSK-03-01 d/TSK-03-02)`). 푸는 길은 셋이다.
- **선행 완료**: 선행 대기 블록(아래)이 그 선행 TSK 의 `done`·`needs-merge`·`resolved` 결과(`team.result`)가 건너뛴
  뒤에 있으면 목록에서 뺀다. 이 팀의 팀원이 선행을 끝낸 경우다. 결과를 처리한 기상에서 블록을 다시 돌려 줄었으면
  재기동 조건(「2-1」)대로 poll 을 줄어든 `--exclude-wait` 로 다시 띄운다.
- **선행 머지**: 승인 스윕이 "머지됨"·"머지됨(승인 전)" 을 냈거나 해소 워커가 `resolved` 로 끝났으면, 그 TSK 를
  선행 ref 에 가진 id8 을 이번 기상의 선행 대기에서 빼고 같은 방법으로 poll 을 다시 띄운다. 이 해제는 이벤트에 남지
  않으므로 poll 이 그 작업을 돌려주기 전에 컨텍스트가 압축되면 블록이 다시 넣는다. 그때는 아래 안전망이 푼다.
- **안전망**: 블록은 기록한 지 2시간이 지난 것을 빼고, poll.sh 도 `--wait-cycles 40`(2시간) 뒤에 스스로 푼다. 다른 PC
  나 사람이 선행을 끝낸 경우처럼 이 팀장이 신호를 받지 못하는 갈래다.
푼 작업을 팀장이 직접 띄우지 않는다. poll 이 다시 돌려주면 이 사전 검사를 다시 하고, 여전히 막히면 새 `team.result`
로 다시 선행 대기에 들어간다(2시간 계산도 새로 시작한다). poll exit 0 의 재대조는 선행 대기도 보지 않는다(일시
제외와 같은 이유).

선행 대기 블록 — 출력 한 줄이 `<id8><TAB><선행 TSK,…>` 이다. 목록은 기억이 아니라 이 출력이 정본이며, poll 을
띄울 때마다 돌린다.
```bash
now=$(date +%s)
jq -c --arg a '<신원>/<host>/lead' --arg r '<MAIN>' 'select(.agent == $a and .repo == $r)' ~/.dflow/events.jsonl 2>/dev/null \
  | awk '/"event":"team.start"/{buf=""} {buf=buf $0 "\n"} END{printf "%s", buf}' \
  | jq -rs --argjson now "$now" '
      def t: (.ts // "");
      ($now - 7200 | todate) as $cut
      | [.[] | select(.event == "team.result" and (.status == "done" or .status == "needs-merge" or .status == "resolved"))
        | {tsk: (.tsk // ""), t: t}] as $done
      | reduce (.[] | select((.event == "team.spawn" or .event == "team.blocked" or .event == "team.result" or .event == "team.lost")
          and (.id8 // "") != "")) as $e ({}; .[$e.id8] = $e)
      | .[]
      | select(.event == "team.result" and .status == "skipped" and ((.reason // "") | startswith("선행 미충족(사전 검사:")))
      | t as $at
      | [.reason | ltrimstr("선행 미충족(사전 검사:") | rtrimstr(")") | splits("[ ,]+") | select(. != "") | split("/") | last] as $refs
      | select($at > $cut)
      | select(any($done[]; .t >= $at and (.tsk as $k | any($refs[]; . == $k))) | not)
      | "\(.id8)\t\($refs | join(","))"'
```
시각은 `ts`(UTC `YYYY-MM-DDTHH:MM:SSZ`) 문자열끼리 견준다. 형식이 같아 사전순이 곧 시간순이다.

**선행 반영 사전 검사**(`deps_nohead`): `deps_unmet` 이 비었고 `deps_nohead`(서버 `reached` 는 참인데
`head_sha` 가 없는 선행, 즉 완료 보고 뒤 승인 전)가 비어 있지 않으면 워커 행 G 갈래 2 의 반영 확인을 여기서 먼저 한다
(그대로 띄우면 워커가 `skipped 선행 승인 대기` 로 끝나는 확정 skip 이다).
`head_sha` 가 있는 선행은 거르지 않는다(워커 행 B 가 그 기점에 스택한다). `git fetch origin` 은 기상마다 한 번만 한다.
`<TASKS>` 는 `references/merge-conflict.md` 「2」 2번 블록으로 구한다. `TASKDIR_FAILED` 면 사유 `작업 폴더 해석 실패` 로
일시 제외한다. 구한 작업 폴더는 「5. 팀원 spawn」 이 다시 쓴다(두 번 부르지 않는다).
```bash
.claude/skills/dflow-dev/scripts/pred-reflected.sh '<TASKS>' '<선행TSK>' '<개발브랜치>'; echo "rc=$?"
```
`<선행TSK>` 는 `deps_nohead` 원소의 마지막 `/` 뒤다.
- 하나라도 `NOT_REFLECTED`(rc=1)이면 띄우지 않는다. 사유 `선행 미반영(사전 검사: <ref…>)` 로 일시 제외에 넣고
  `team.result`(slot `-`, status `skipped`)를 남긴다. 그 선행이 해소 큐나 해소 슬롯에 있으면(TSK 로 대조) 사유를
  `선행 미반영(머지 충돌 해소 중: <ref>)` 로 쓴다. 두 문구 모두 「선행」 으로 시작해 일시 제외 해제의 선행 계열에 든다.
- `UNKNOWN`(rc=2) 은 거르지 않고 워커에 맡긴다. 위 「선행 사전 검사」 의 "판정 불가를 미충족으로 단정하지 않는다" 와 같다.
- 모두 `REFLECTED` 면 그대로 spawn 한다.

### 2-4. 팀원 이슈 보고 처리

팀원이 SendMessage 로 이슈 보고(첫 줄 `[이슈 <TSK> <id8>] <요약>`, worker-prompt.md 「9」)를 보내면 **도착한 턴에서 곧바로**
`references/issues.md` 를 Bash `cat` 으로 읽고 그 1~5(저장·판단·`[팀장 지시 <id8>]` 추가 지시·전파·근본 조치)를 한다. 감시 루프는
cross-session 메시지로 깨지 않는다. **사람에게 보고만 하고 턴을 끝내는 것은 금지한다**(팀원과 팀장이 서로를 기다리며
교착한다). 팀장이 10분 안에 지시를 보내지 못하면 팀원은 `.result` 의 `blocked` 로 넘어가며, 그때는 「6. blocked」 로 처리한다.

## 3. 결과 처리

**결과 줄 찾기**
- 감시 루프가 알린 경로(`RESULT_READY`)의 `.result` 한 줄이다. 두 백엔드 공통이며 슬롯은 경로(그 슬롯의
  워크트리)로 찾는다. 이미 판정한 경로의 알림은 집계만 갱신하고 슬롯을 건드리지 않는다.
- `PANE_DEAD <경로>`(tmux): 그 슬롯의 팀원 pane 이 죽었다. `.result` 가 있으면 그 줄을 처리한다. 없으면
  backends.md 「결과 줄과 죽은 pane 폴백」 대로 `capture-pane -p -J -S -` 로 죽은 pane 의 화면 전체를 읽어
  `<TSK> <id8> ` 로 시작하는 마지막 줄을 찾아 처리한다(`failed not-isolated` 는 워커가 파일을 쓰지 않으므로 이
  폴백으로만 온다). 그것도 없으면 `#{pane_dead_status}` 를 읽는다(`references/restart.md` 「판정」 블록의 `dead_status`).
  `127`(`claude` 를 찾지 못함)이면 **곧바로** `failed no-result` 로 판정한다(hash `-`. 다시 띄워도 같은 자리에서 죽는
  환경 결함이다). 그 밖이면 `references/restart.md` 「판정」 으로 간다(재시작 후보). 프로세스가 없으므로 기다리지 않는다.
- 줄 형식은 `<TSK> <id8> <branch|-> <head|-> <done_exit|-> <status> <사유…>` 다. 줄과 해시는 「팀장 상태」 의 한
  줄 명령으로 함께 읽고, 해시가 그 경로의 마지막 처리 해시와 같으면 처리하지 않는다.

**생존 증거**: tmux 팀원은 먼저 「팀장 상태」 정본 표의 생존 칸(`.dflow-pane` 의 pane 이 `#{pane_dead}=0` 인지)
을 본다. `dead` 면 증거를 재지 않고 `PANE_DEAD` 와 같이 처리한다. 살아 있는 팀원은 아래 중 하나라도 직전
`TICK` 과 달라지면 살아 있는 것이다. 슬롯의 첫 `TICK` 은 기록만 한다. 직전 TICK 증거는 그 슬롯의 마지막 TICK 기상 때
잰 값이고, 감시 루프가 그 뒤 TICK 을 건너뛰었으면(「2-2」) 그 출력의 `EVIDENCE <id8>` 줄이다(`ct`=1번, `report`=2번,
`heartbeat`·`phase`=무응답의 heartbeat 값, `dirty`=3번 cksum 의 첫 칸).
```bash
git -C <워크트리> log -1 --format=%ct                                        # 1. 워크트리가 있으면 HEAD 커밋 시각
git fetch origin && git log -1 --format=%ct 'origin/agent/<id8>-<slug>'   # 1. 워크트리가 없으면 원격 tip 커밋 시각
(.claude/skills/dflow-work/scripts/dflow.sh show <id8>) | jq -r '[.reports[]?] | last | .created_at // empty'   # 2. 서버 최신 progress
git -C <워크트리> status --porcelain | cksum                                 # 3. 미커밋 변경 목록
```
2번의 show 가 실패하면 증거 없음이 아니라 측정 실패로 기록하고, 그 `TICK` 에서는 2번을 비교에서 뺀다.
**화면은 생존 증거로 쓰지 않는다.** 화면(tmux `capture-pane`, Orca `orca terminal read`)은 보고용과 폴더 신뢰
확인 판별(backends.md)에만 쓴다(스피너 때문에 멈춘 팀원도 화면이 매번 달라진다). 이 원칙의 정본은 이 줄이며 backends.md·
restart.md 는 이것을 가리킨다. 터미널 핸들이 없는 옛 Orca 런타임에서는 화면을 읽지 않고 위 셋만 쓴다.

**문제 기록**: 결과 줄을 처리할 때 `blocked` 가 아니면 **`team.result` 기록과 워크트리 정리보다 먼저** 팀장
체크아웃의 `docs/dflow-team/issues.md` 에 항목 하나를 붙인다(정리가 미추적 `.issues` 를 함께 지운다). 이 파일은
커밋하지 않는다(「1. 시작」 exclude 의 `/docs/dflow-team/`).
- 재료는 둘이다. 하나는 워커가 쓴 `<워크트리>/<TASKS>/<TSK>/.issues`(worker-prompt.md 「7-1」, 줄마다
  `<phase>\t<분류>\t<내용>`)이고, 다른 하나는 `done` 이 아닌 결과의 사유(결과 줄 7번째 칸부터)다.
- `done`·`needs-merge`·`design_waiting` 이고 `.issues` 가 없거나 비었으면 붙이지 않는다. 그 밖의 status 는 `.issues` 가 없어도
  사유 한 줄로 항목을 만든다.
- `failed no-result` 는 사유 대신 `pane_dead_status` 와 화면 마지막 20줄(tmux `capture-pane -p -J -S - | tail -n
  20`, Orca `orca terminal read`)을 코드 블록으로 붙인다. 화면을 읽지 못하면 `화면 없음` 한 줄을 쓴다.
- `blocked` 는 붙이지 않는다. 팀원이 답을 받아 이어 가며 `.issues` 에 계속 적고, 최종 결과 때 한 번에 옮긴다.
```bash
f='<MAIN>/docs/dflow-team/issues.md'; i='<워크트리>/<TASKS>/<TSK>/.issues'; st='<status>'
reason=$(head -n 1 "$(dirname "$i")/.result" 2>/dev/null | cut -d' ' -f7-)
if [ -s "$i" ] || { [ "$st" != done ] && [ "$st" != needs-merge ] && [ "$st" != design_waiting ]; }; then
  mkdir -p "$(dirname "$f")"
  [ -s "$f" ] || printf '# /dflow-team 문제 기록\n\n팀원이 보고한 에러·문제점. 스킬·환경 개선 재료이며 커밋하지 않는다.\n' > "$f"
  { printf '\n### %s · <TSK> (<id8>) · %s\n\n' "$(date '+%Y-%m-%d %H:%M')" "$st"
    [ "$st" = done ] || [ "$st" = needs-merge ] || [ "$st" = design_waiting ] || printf -- '- 결과 사유: %s\n' "$reason"
    [ -s "$i" ] && awk -F'\t' 'NF{c=$2;p=$1;sub(/^[^\t]*\t[^\t]*\t/,"");printf "- [%s] %s: %s\n",c,p,$0}' "$i"
  } >> "$f" || echo ISSUE_LOG_FAIL
fi
```
`reason` 은 events.md 「기록 명령」 과 같은 방법(`.result` 첫 줄의 7번째 칸부터)으로 이 블록 안에서 다시 뽑는다(별도
Bash 호출의 변수는 남지 않는다). `.result` 가 없으면(`failed no-result`) 빈 값이다. `ISSUE_LOG_FAIL` 이 나와도 결과
처리를 멈추지 않고 보고에 한 줄 적는다.

**status 별 처리**: 결과 줄은 경로별 마지막 처리 해시와 다를 때만 처리하며, `blocked` 는 `team.blocked`,
나머지는 `team.result` 로 해시·사유와 함께 기록한다(events.md). 모든 결과는 집계에 넣는다. 결과를 처리할 때는
그 id8 을 먼저 진행 중 영구 제외에서 빼고, 아래 표의 제외 칸대로 일시·영구 제외를 새로 정한다(그대로 두면
`skipped`·`failed rate-limit` 의 재시도가 막힌다).

| status | 슬롯 | 제외 | 워크트리 | 그 밖 |
|---|---|---|---|---|
| `done` | 해제 | 없음 | 「고아 정리 규칙」 2번(미커밋 변경 없음, HEAD 가 `origin/<agent 브랜치>` 와 같거나 그 머지가 이미 기본 브랜치의 조상임)을 맞추면 그 자리에서 정리한다. 아니면 3번대로 경로와 미커밋 목록을 보고하고 남기며 `.dflow-agent` 값을 `<신원>/<host>/parked` 로 바꾼다 | 자동 머지(`AUTOMERGE_ON`)면 **먼저 승인 스윕을 곧바로 한다**(이 기상의 스윕 1회(「4-0」)를 spawn 보다 먼저 한다는 뜻이다. 방금 끝난 작업이 기본 브랜치에 들어가야 후속이 착수한다). 그 다음 대기 큐가 있으면 그 슬롯에 spawn 한다. 비어 있으면 poll 재기동 조건(「2-1」)을 따른다 |
| `needs-merge` | 해제 | 없음 | `done` 과 같다 | 승인 스윕을 곧바로 한다. 이 기상의 스윕 1회이며, 워커가 approved 를 확인한 머지 대상이 있으므로 사전 검사 없이 부른다(「4-0」 의 예외) |
| `skipped`(선행 미충족·선행 미승인·선행 승인 대기·claim exit 4·공통 기점 없음·spec 부재) | 해제 | 일시 제외 | branch 가 `-` 면 부트스트랩 실패 정리 규칙, 아니면 `done` 과 같다 | 사유 보고 |
| `design_waiting`(설계 완료·선행 대기, 사유는 미충족 선행 ref) | 해제 | 없음 | **지우지 않는다**. `.dflow-agent` 를 `parked` 로 | 실패가 아니다(차단기 연속 수를 0 으로). 재개는 `references/design-ahead.md` 2·4번 |
| `blocked` | 유지 | 진행 중으로 영구 제외에 남긴다 | 그대로 둔다(두 백엔드 공통). 팀원이 pane 이나 탭에서 답을 기다린다 | 통지(「6. blocked」) |
| `failed <사유>` | 해제 | 영구 제외 | 고아 정리 규칙을 따른다 | 사유 보고, 차단기 계산 |
| `failed permission <명령>` | 해제 | 영구 제외 | 고아 정리 규칙을 따른다 | 거부된 명령을 "권한 목록 재료" 로 보고한다(킷 허용 목록에 넣을 값). 서버에 claimed 로 남으므로 **"멈춤" 표**에 넣는다(사유는 그 status). 차단기 계산 |
| `failed rate-limit` | 해제 | 제외하지 않는다 | 고아 정리 규칙을 따른다 | 재시도할 수 있다. 아직 ready 면 poll 이 다시 찾고, 이미 claimed 면 **"멈춤" 표**에 넣는다(사유는 그 status). 차단기 계산에 넣는다. 워커가 결과 줄을 쓴 경우라 자동 재시작·보류 대상이 아니다. 결과 줄 없이 한도에 선 워커는 `references/restart.md` 「rate-limit 대기」 가 다룬다 |
| `failed no-result`(pane 이 죽었는데 결과 줄 없음) | 해제 | 영구 제외 | 고아 정리 규칙을 따른다 | 서버에 claimed 면 **"멈춤" 표**에 넣는다(사유는 그 status). 차단기 계산. `pane_dead_status` 127 일 때만 이 행이다. 127 이 아닌 죽음은 이 행이 아니라 `references/restart.md` 의 재시작 판정으로 간다(워크트리를 지우지 않는다) |
| `failed not-isolated` | 해제 | 영구 제외 | 없음(워커가 파일을 쓰지 않았다) | 백엔드 결함이므로 새 spawn 을 멈추고 「7. 마감」 으로 간다 |
| `failed project` | 해제 | 영구 제외 | 고아 정리 규칙을 따른다(claim 전이라 대개 부트스트랩 실패 정리) | 주문이 이 리포의 D'Flow 프로젝트 밖이다. claim 하지 않았으므로 "멈춤" 표에 넣지 않는다. 바인딩(`.env`)이나 poll 필터가 새는 결함이므로 사유를 그대로 보고한다. 차단기 계산 |
| `failed not-assignee` | 해제 | 영구 제외 | 고아 정리 규칙을 따른다(claim 전이라 대개 부트스트랩 실패 정리) | 다른 멤버에게 배정된 작업을 claim 하려다 서버가 `not_assignee` 로 거부했다. claim 하지 않았으므로 "멈춤" 표에 넣지 않는다. **차단기 계산에 넣지 않는다**(배정 불일치이지 환경 결함이 아니다). 사유와 함께 "담당자 변경 여부를 D'Flow 에서 확인하라" 를 보고한다 |
| `failed deps` | 해제 | 영구 제외 | 고아 정리 규칙을 따른다 | 사유 보고, 차단기 계산. 설치는 claim 과 브랜치 생성 뒤라서(`/dflow-dev` 「--worker」 H) 서버에 claimed 로 남으므로 **"멈춤" 표**에 넣는다(사유는 그 status). 대상 리포의 lockfile·패키지 관리자 문제라 사람이 고친다 |
| `cancelled`(사람이 D'Flow 에서 중단 — 주문 `cancelled`·위임 해제) | 해제 | 영구 제외 | **지우지 않는다**(산출물 보존). 미커밋 변경이 있어도 그대로 두고 경로만 보고하며, `.dflow-agent` 값을 `<신원>/<host>/parked` 로 바꾼다 | 사람 알림은 한 줄(`<TSK> <id8> 중단됨 — 워크트리 <경로> 보존`). 사람이 멈춘 것이라 "멈춤" 표에 넣지 않고, **차단기 계산에 넣지 않는다**(세지도 끊지도 않는다). 다시 맡기려면 사람이 위임 체크를 켜며, 그때 새 주문으로 다시 poll 에 잡힌다 |

**해소 워커의 결과**: 슬롯의 워크트리 이름이 `-resolve` 로 끝나면(`dflow-<id8>-resolve`, `readopt` 뒤에도 같다) 위 표가 아니라
`references/merge-conflict.md` 「4. 해소 결과 처리」 표를 따른다. 결과 줄 찾기·해시·`team.result`·`team.blocked` 기록·tmux
회수는 위와 같다.

- **그 자리에서 정리한다**: git 은 다른 워크트리가 체크아웃한 브랜치를 지우지 못하므로, 마감까지 남기면 승인된 작업의
  로컬 agent 브랜치 삭제가 실패한다. 정리 명령은 backends.md 의 백엔드별
  「정리」 와 「고아 정리 규칙」 이며, 워크트리를 지웠으면 그 규칙 5번의 생성 브랜치 정리까지 한다.
- **회수**: tmux 백엔드에서는 결과 줄을 처리한 뒤 pane 을 `kill-pane -t <pane>` 으로 거두고
  `select-layout -t dflow tiled` 를 다시 돈다(backends.md 「생존·화면·답·회수」). Orca 는 결과 줄을 처리한 뒤
  `orca terminal close --terminal <handle> --tab --json` 으로 탭을 닫는다(핸들이 `-` 면 건너뛴다). 순서는 결과 처리 →
  탭 닫기 → 워크트리 정리다. 응답의 `ptyKilled:false` 는 실패가 아니다(claude 프로세스는 실제로 끝난다). **`blocked` 는
  예외로 두어 거두지 않는다**(답을 기다리며 살아 있어야 한다). 워커는 `.result` 를 쓰고 곧 끝나므로
  보통 `remain-on-exit` 가 남긴 죽은 pane 이며, 그것도 `kill-pane` 으로 치운다.
- **차단기**: 결과가 도착한 순서로 `failed`(`no-result`·`rate-limit` 포함, `not-assignee`·해소 워커의 내용 실패(`references/merge-conflict.md` 「6. 차단기」) 제외)가 연속 2건이면 새 spawn 을 멈추고
  보고한다. `failed` 가 아닌 결과가 오면 연속 수를 0 으로 되돌린다. 걸린 동안에는 다음 `TICK` 마다 1건만 시험
  spawn 하고(대기 큐 맨 앞에서, 큐가 비었으면 poll 을 한 번 띄워 얻는다), 그 결과가 `failed` 가 아니면 차단기를
  푼다(한도·환경 결함에 걸린 채 대기 큐를 소진하지 않는다).
  자동 재시작의 `team.lost`(모든 `cause`)도 실패 1건으로 센다(`references/restart.md`). 단 `next=wait` 인 `team.lost` 는 세지 않는다. 걸린 동안의 시험 1건은
  재시작 대기가 새 작업보다 먼저다.
- **중단**: 워커는 `dflow.sh` exit 10 을 받으면 `.result` 에 `cancelled` 를 쓰지만, heartbeat 훅이 먼저 세션을 세우면
  결과 줄 없이 멈춘다. 그래서 결과 줄이 없는 진행 슬롯이라도 생존 증거 2번의 `show` 가 `status=cancelled` 면 결과 줄
  `cancelled`(hash `-`)를 받은 것과 똑같이 처리한다 — 무응답 판정을 기다리지 않는다. tmux 는 `kill-pane` 으로,
  Orca 는 `orca terminal close --terminal <handle> --tab --json` 으로 거두되 워크트리는 지우지 않는다.
- **무응답**: 결과도 알림도 없는 진행 슬롯의 생존 증거가 한 `TICK` 동안 변하지 않으면 "무응답" 으로 보고만 하고 슬롯을 유지한다.
  생존 증거에 `show` 의 `last_heartbeat_at`·`heartbeat_phase` 를 넣는다(워커가 Phase 마다 보내 브랜치 tip 시각보다
  촘촘하다). `stale` 은 쓰지 않는다(`claimed_at` 으로부터 24시간 경과일 뿐이다). 자동 정리는
  **두 TICK 연속으로** 생존 증거가 없을 때만 한다. tmux 는 `kill-pane` 으로, Orca 는 `orca terminal close
  --terminal <handle> --tab --json` 으로 팀원을 멈추고 슬롯을 해제하며, 워크트리는 고아 정리
  규칙을 따른다. 자동 정리한 작업은 영구 제외에 넣고 **"멈춤" 표**에 넣는다(사유 `무응답`).
- **서브에이전트 종료 후 정지 패턴(2026-09-24, dmes-standard TSK-03-01)**: 위 "무응답" 판정 시점(생존 증거
  무변화 **1 회째** — 두 `TICK` 을 기다리지 않는다)에 화면(tmux `capture-pane`)을 이 판정에만 쓴다. **적용
  대상은 `references/restart.md` 「판정」 의 1~5번(측정 실패·중단·점유 변동·표식 불일치·rate-limit)에 걸리지
  않고 그 표의 9번(무응답 1회)에 이른 슬롯뿐이다** — 취소되거나 한도에 걸린 슬롯에 이 지시를 주입하지
  않는다. `last_heartbeat_at`
  이 함께 멈춰 있어도 상관없다 — 오케스트레이터가 입력 대기로 서 있으면 도구 호출이 없어 heartbeat 자체가
  멎으므로, heartbeat 갱신을 전제로 하는 아래 "대기 중인 팀원 판정"과 달리 이 판정은 heartbeat 값을 보지 않는다.
  화면 마지막 줄이 입력 대기 프롬프트(`❯`)이고 그 위에 `Teammate @<TSK>-<phase> finished` 류의 서브에이전트
  종료 알림이 보이며 그 뒤 오케스트레이터 발화가 "완료 알림을 기다린다"·"백그라운드 작업이 끝나면"류이면,
  이는 **다시는 오지 않을 알림을 기다리는 정지**다 — 서브에이전트 턴이 끝나면 하네스가 완료로 보아 그 뒤
  백그라운드 손자의 완료가 오케스트레이터를 깨우지 못한다(「제1 제약」과 같은 구조가 Phase 한 단계 아래에서
  재발한 것, `/dflow-dev` SKILL.md 「Phase 종료마다 오케스트레이터가」 5번과 짝). 이때는 "무응답"으로 보고만
  하고 다음 `TICK` 을 기다리지 않는다 — **이 TICK 에서 곧바로** `send-keys -l --`(tmux) 또는 `orca
  terminal`(`references/issues.md` 「SendMessage 가 닿지 않을 때」와 같은 주입 경로)로 그 팀원 화면에 다음을 넣는다:
  "[팀장 지시 <id8>] 서브에이전트 @<TSK>-<phase> 는 이미 끝났다(finished). 백그라운드 완료 알림은 오지 않는다 —
  프로세스(`pgrep` 등)와 산출물(커밋·파일)을 직접 확인하고, 남은 작업이 없으면 게이트를 직접 돌려라(구현 단위가 남았으면 다음 단위·묶음을 띄워라)."
  **자동 정리·자동 재시작과의 관계**: 주입이 오케스트레이터를 깨우면 다음 `TICK` 의 생존 증거(커밋·미커밋
  목록 등)가 바뀌어 "두 `TICK` 연속 무변화" 조건이 깨지므로, 위 무응답 자동 정리(`kill-pane`)도
  `references/restart.md` 「판정」 의 재시작 후보(`cause=no-response`, (나) 2회째)도 걸리지 않는다. 주입이 먹지
  않아 다음 `TICK` 에도 같은 화면(finished 알림 + 프롬프트)이면 재주입하지 않고 "사람 확인 필요"로 올린다
  (같은 문구를 무한 재주입하지 않는다) — 그 이후로도 두 `TICK` 무변화 조건이 유지되면 기존 자동 정리·자동
  재시작이 그대로 이어받는다(이 절이 그것을 막지 않는다).
- **대기 중인 팀원 판정(2026-09-24, doc-level — 별도 판정 스크립트는 아직 없다)**: `last_heartbeat_at` 은
  갱신되는데 커밋 시각·미커밋 변경 목록·`heartbeat_phase` 가 두 `TICK` 연속으로 그대로이고, 화면(tmux
  `capture-pane`, Orca `orca terminal read --terminal <handle>`) 마지막 줄이 입력 대기 프롬프트(`❯`)로
  끝나면 이 팀원은 죽은 것이 아니라 **입력을 기다리며 서 있는 것이다** — SendMessage 이슈 보고 뒤 지시를
  기다리는 경우가 전형적이다(「2-4. 팀원 이슈 보고 처리」). 이때는 위 무응답 자동 정리(tmux `kill-pane`,
  Orca `orca terminal close`)를 하지 않고 **"대기 중인 팀원"** 으로 보고만 하며 슬롯을
  유지한다 — heartbeat 가 살아 있는 프로세스를 죽이면 미답 이슈와 미커밋 산출물을 함께 잃는다. 화면은
  다른 곳과 같이 생존 증거로 쓰지 않고 이 판정에만 쓴다(backends.md 「화면은 생존 증거로 쓰지 않는다」와
  같은 원칙). Orca 는 터미널 핸들이 없으면(`-`) 화면을 읽을 수 없으므로 이 판정을 건너뛰고 위 무응답
  규칙만 적용한다.
- **자동 재시작**: 위 자동 정리는 `references/restart.md` 「판정」 이 대신한다(두 백엔드 공통). 두 TICK 연속 무변화(또는 결과
  없는 pane·탭 죽음)면 원인을 가려, 재시작 후보는 워크트리를 지우지 않고 pane(Orca 는 탭)만 거둔 뒤 `team.lost` 를
  기록하고 같은 기상 안에 「5-1. 재개 spawn」 으로 다시 띄운다(재시도 상한 3 은 고아 재개와 공유). 영구 제외는
  `team.lost` 가 대신한다.

## 4. 승인 스윕

「4-0. 스윕을 부르는 규칙」 이 부르라고 판정했을 때만 한다. Skill 도구로 `/dflow-merge` 를 **인자 없이** 실행한다. 자동 머지(`AUTOMERGE_ON`, 「인자」)면 `--on-report` 하나만 붙여
실행한다. 스윕마다 `.dflow`·`.dflow.local`(레거시 `.env`)을 다시 읽어 정한다. 후보가 원격 `origin/agent/*` tip 에서도 오므로 팀장
체크아웃의 state.json 유무와 무관하다. 판정은 서버 `show` 로만 하고 approved 만 머지한다. 후보는 state.json 의
`api_base` 가 팀장의 `api_base` 설정(`.dflow`, 레거시 `DFLOW_API_BASE`)과 같은 것만 받는다. `api_base` 가 없는 로컬 후보는 전제 검사가 시작 전에 막는다(「1. 시작」 `LEGACY_REPORTED`).
- **반려(머지됨)**: 자동 머지로 이미 기본 브랜치에 들어간 작업이 반려되면 `/dflow-merge` 가 "반려(머지됨)" 과 그 위에
  쌓였을 수 있는 작업 목록을 낸다. 팀장은 "main 에 머지된 반려 작업: <id8> (<review_note>). 그 위에 쌓였을 수 있는
  작업: <id8…>. 되돌리기(`git revert -m 1 <머지 커밋>`)나 수동 `/dflow-dev <id8>` 재작업을 사람이 고른다" 로 보고하고
  그 id8 을 영구 제외에 넣는다. 팀장이 스스로 revert 하지 않는다(후속이 반려된 코드에 기댈 수 있다).
- **반려**: 반려로 보고된 id8 은 "반려: 수동 `/dflow-dev <id8>` 대상 (<review_note>)" 로 보고하고 영구 제외에
  넣는다. 재작업은 기존 agent 브랜치 위에서 해야 하므로 자동 배정하지 않는다.
- **다중 경합**: 두 팀장의 스윕이 같은 브랜치를 머지하려 하면 나중 쪽 `git push` 가 non-fast-forward 로
  거부된다. 그러면 `/dflow-merge` 가 머지 직전 HEAD 로 `git reset --keep` 해 되돌리고 "push 실패(경합)" 로 보고한
  뒤 스윕을 멈춘다. 다음 기상의 스윕이 fetch 부터 다시 한다.
- **그 밖의 push 실패**: `/dflow-merge` 는 연결·권한 오류(128 등)를 "push 실패" 로 보고하고 스윕을 멈춘다. 팀장은
  그 스윕을 "중간에 멈춤" 으로 보고하고 정상 완료로 적지 않는다. 머지되지 않은 후보는 다음 기상의 스윕이 다시 본다.
- **push 훅 거부**: `/dflow-merge` 가 `git reset --keep` 으로 되돌리고 "push 실패(훅)" 로 보고한 뒤, 그 작업과 그
  후손만 빼고 다음 후보로 간다. 팀장은 그 id8 을 "사람이 머지해야 함" 으로 보고한다.
- **머지 충돌**: `/dflow-merge` 가 충돌 파일 목록을 읽고 `git merge --abort` 로 되돌린 뒤 "머지 실패(충돌)" 로
  보고하고(파일 목록 `<파일,…>` 동반) 다음 후보로 간다. 마이그레이션 버전 중복·역순 도착(`/dflow-merge` 「마이그레이션
  버전 관문」)도 머지 전에 같은 문구로 보고된다(끝에 `(마이그레이션 버전)`, 파일은 이 브랜치가 추가한 마이그레이션). 팀장은 그 id8 을 「4-1. 머지 충돌 해소」 로 넘긴다. 해소하지
  못하는 경우(다른 신원의 주문·상한·재시도 불가)만 "사람이 머지해야 함" 으로 보고한다.
- **공용 결정 기록(`decisions.md`)**: 팀원은 전역 번호 대신 임시 ID `D-<TSK>-<n>` 을 쓰고(dev-discipline
  「공용 결정 기록(decisions.md)의 번호」), `/dflow-merge` 가 머지하며 그 파일의 충돌을 기계적으로 풀고 번호를 매긴다
  (「결정 번호 매김」). 대상 리포에 `merge=union` 을 걸지 않는다 — 같은 필드 줄을 가진 블록을 섞는다. 스윕 보고에
  `UNION_SET <파일>` 이 있으면 "대상 리포 `.gitattributes` 에서 decisions.md 의 `merge=union` 을 빼야 함" 으로 사람에게
  보고한다. 팀장이 그 파일을 직접 고쳐 커밋하지 않는다(대상 리포 설정 변경은 사람 몫). "결정 번호 매김 실패" 는 보고만
  한다(다음 머지가 다시 매긴다). 직접 매긴 전역 번호가 겹쳐 옮겨졌으면(`DUP_RENUMBERED`) 결과만 알리고,
  `DUP_REF_AMBIGUOUS`·`DUP_LEFT`·`DECISIONS_SEQ` 는 그 위치를 그대로 사람에게 넘긴다(팀장이 손으로 고치지 않는다).
- 로컬 agent 브랜치 삭제가 브랜치 없음이나 "checked out" 오류로 실패하면 `/dflow-merge` 가 건너뛰고 보고한다.
  그 워크트리는 결과 처리나 고아 스캔이 정리한다.
- 승인 대기·건너뜀(서버 <status>·조회 실패·다른 D'Flow·조상 미승인·기점 미반영·승인 뒤 변경·승인 뒤 변경 확인 불가)은 보고만 한다.
  자동 머지의 "머지됨(승인 전)"·"승인 반영(이미 머지됨)"·"승인 대기(머지됨)" 도 한 줄씩 보고한다.
- **자동 머지 뒤 일시 제외 해제**: 스윕이 "머지됨(승인 전)"·"머지됨" 을 한 건이라도 냈거나 해소 워커가 `resolved` 로 끝났으면(「5-2」), 일시 제외 가운데 사유가
  선행 계열(선행 미충족·선행 미승인·선행 승인 대기·claim exit 4·공통 기점 없음·선행 미반영)인 id8 을 목록에서 빼고, 재기동 조건
  (「2-1」)이 맞으면 줄어든 `--exclude-temp` 로 poll 을 새로 띄운다. **푼 작업을 팀장이 직접 띄우지 않는다.** poll 이
  다시 돌려준 것만 띄운다(담당자 변경·다른 팀장의 점유를 거르는 곳이 poll 의 `--scope assigned` 조회다). 떠 있던 옛
  poll 이 옛 목록으로 한 번 더 돌아도 poll exit 0 처리의 대조와 spawn 전 확인이 같은 작업을 두 번 띄우지 않게 막는다(「2-3」 5번).
- `team.sweep`(merged, waiting, rejected, resolved 개수)을 기록한다. `resolved` 는 직전 스윕 뒤 해소 워커의 `resolved` 가 조상 확인까지 통과한 수이며, 기억으로 세지 않고 `lead-state.sh` 의 `CONFLICT_CLEARED resolved=` 를 쓴다. `merged` 에는 승인 전 머지를 포함하고, `waiting` 에는
  승인 대기(머지됨)를, `rejected` 에는 반려(머지됨)를 포함한다.
- **방언 검증**: `/dflow-merge` 가 스윕 끝에 「방언 검증」 을 한 번 돌고(`.dflow`·`.dflow.local` 의 `dialect_check` 가 있을
  때만, 머지마다가 아니라 스윕마다 한 번) 결과 줄 `DIALECT_*` 를 보고에 싣는다. 팀장은 이렇게 처리한다. 방언 검증은
  자동으로 되돌리거나 Task 를 재오픈하지 않는다 — 어느 머지가 깨뜨렸는지와 되돌리기는 사람이 판단한다.
  - `DIALECT_FAIL`: 사람에게 "방언 검증 실패 <sha>: 직전 통과 <since> 이후 머지된 Task <tasks>. 도커 금지로 확인하지 못한
    항목이 있는 Task <unverified>. 로그 <log>" 로 알린다. `docs/dflow-team/issues.md` 에 같은 내용을 항목 하나로 붙이고
    (`DIALECT_UNVERIFIED` 줄도 함께), `team.issue` 를 남긴다. id8 는 `dialect`, `tsk` 는 `-`, `summary` 는 위 알림 문장,
    `decision` 은 `사람 판단(자동 되돌리기·재오픈 없음)` 이다. `decision` 을 `pending` 으로 쓰지 않는다(재구성이 팀원
    이슈로 읽는다).
  - `DIALECT_DEFERRED docker-off … notify=1`: "방언 검증 보류(도커 꺼짐): <sha>. 도커를 켜면 다음 스윕이 같은 커밋을 돌린다"
    로 알리고 issues.md 에 한 줄 남긴다. `notify=0` 이면 알리지 않는다.
    팀장은 도커 런타임을 켜지 않는다.
  - `DIALECT_PASS`: 한 줄 보고한다. `unverified=` 가 `-` 가 아니면 "방언 검증 통과. 도커 금지로 확인하지 못한 항목이 있던
    Task: <unverified>" 를 붙여 사람이 대조하게 한다.
  - `DIALECT_ERROR`: `notify=1` 이거나 `notify=` 가 없으면(설정·fetch 오류) "방언 검증을 돌리지 못함: <줄>" 로 알리고
    issues.md 에 한 줄 남긴다. 다음 스윕이 다시 시도한다. 명령 설정(`dialect_check`, PC 전용 값)을 고치는 것은 사람이 한다.
  - `DIALECT_BUSY`·`DIALECT_RUNNING`·`DIALECT_SKIP`·`DIALECT_NONE`: 보고하지 않는다. BUSY 는 다음 스윕이 다시 시도한다.
  - 방언 검증은 팀장 Bash 한 번으로 돈다(timeout 600000). 10분을 넘겨 하네스가 백그라운드로 옮기면 완료 알림으로 결과를
    받고, 컨텍스트 압축 등으로 놓쳤으면 `.claude/skills/dflow-merge/scripts/dialect-check.sh status --dev <기본브랜치>` 로
    마지막 결과를 읽는다. 도는 동안 겹친 스윕은 `DIALECT_RUNNING` 이다.
- 머지 자리는 팀장 체크아웃의 상태로 갈린다(`/dflow-merge` 4번). 기본 브랜치 위의 팀장은 그 체크아웃에서
  머지한다. detached HEAD 인 팀장은 임시 머지 워크트리 `<MAIN>/.claude/worktrees/dflow-merge` 에서 머지하고
  `HEAD:<기본브랜치>` 로 push 한다.
- detached HEAD 인 팀장은 스윕이 끝나면 팀장 체크아웃을 최신으로 옮긴다(옛 커밋의 state.json 이 `LEGACY_REPORTED` 를
  부르지 않게). 체크아웃이 깨끗할 때만 한다.
  ```bash
  [ -z "$(git branch --show-current)" ] && [ -z "$(git status --porcelain)" ] && git switch -q --detach origin/<기본브랜치>
  ```

### 4-0. 스윕을 부르는 규칙

스윕(`/dflow-merge` 호출)을 언제·몇 번 부르는지는 **이 절 하나가 정한다.** 시작(「1. 시작」 5번), 「2-3」 3번, `TICK`,
「3. 결과 처리」 의 `done`·`needs-merge` 행, 해소 `resolved`(merge-conflict.md 「4」), 「7. 마감」 은 모두 이 절을 따른다.

1. **한 기상에 최대 1회.** 결과가 여럿 도착했거나 `done`·`needs-merge`·`resolved` 행이 "곧바로 스윕" 을 말해도, 그
   기상의 판정과 스윕은 「2-3」 3번 자리에서 한 번이다. 그 행들의 "곧바로" 는 "같은 기상의 spawn(「2-3」 4번)보다
   먼저" 라는 뜻이다. 판정하는 기상은 「2-3」 3번에 적은 것(시작·결과 도착·`TICK`·poll 재기동 직전·마감)뿐이다. 사람의
   답·이슈 보고·`STALE`·`LEASE_LOST` 기상에서는 판정하지 않는다. 감시 루프가 건너뛴 TICK(「2-2」)은 기상이 아니므로 판정하지 않는다
   (승인·반려가 생기면 루프가 건너뛰지 않고 깨운다).
2. **먼저 사전 검사**: `/dflow-merge` 를 부르기 전에 아래를 돈다. 후보 정의는 `/dflow-merge` 「절차」 1번 그대로다(서버
   조회는 하지 않는다).
   ```bash
   .claude/skills/dflow-merge/scripts/sweep-check.sh --dev '<기본브랜치>'; echo "rc=$?"
   ```
   | 마지막 줄 | 처리 |
   |---|---|
   | `SWEEP_CANDIDATES n=<N> <id8…>` | 「4. 승인 스윕」 대로 `/dflow-merge` 를 부른다 |
   | `SWEEP_NONE` | 부르지 않는다. 보고는 "스윕 생략(후보 없음)" 한 줄이다. 아래 3번은 한다 |
   | `SWEEP_UNKNOWN <사유>`, 빈 출력, 스크립트 없음(옛 킷), `rc` 가 0 이 아님 | **부른다**(fail-open). 사유를 한 줄 보고한다 |

   글자 그대로 `SWEEP_NONE` 일 때만 건너뛴다(판정 불가를 후보 없음으로 뭉개지 않는다). 자동 머지(`AUTOMERGE_ON`)에서도 같다.
3. **`SWEEP_NONE` 이어도 하는 일**(스윕에 묶여 있던 일이라 부르지 않았다고 빠뜨리지 않는다):
   - 출력에 `SWEEP_DIALECT_PENDING <sha>` 줄이 있으면 방언 검증을 직접 한 번 부르고, 결과 줄은 「4」 의 방언 검증 규칙대로
     처리한다. `/dflow-merge` 본문을 다시 싣지 않도록 스크립트만 부른다.
     ```bash
     .claude/skills/dflow-merge/scripts/dialect-check.sh run --dev '<기본브랜치>'; echo "rc=$?"
     ```
   - merge-conflict.md 「5. 사람 머지 감지」. 사람이 손으로 머지하면 agent 브랜치가 지워져 후보가 없으므로, 이것을
     스윕에 묶어 두면 `merge_conflict` 표시가 영영 남는다.
   - 「4」 의 detached HEAD 재-detach 블록. 팀장 체크아웃이 옛 커밋에 머물지 않게 한다.
   - 해소 `resolved` 가 있었으면 「4」 의 일시 제외 해제(선행 계열)를 한다.
   - `team.sweep` 은 기록하지 않는다(스윕을 하지 않았다). `resolved` 개수는 다음에 실제로 도는 스윕의 `team.sweep` 에 싣는다.
4. **예외 — 사전 검사 없이 늘 부른다**:
   - 「1. 시작」 의 첫 스윕과 「7. 마감」 의 마지막 스윕. 실행마다 한 번뿐이고, 그 보고가 사람이 그 시점에 읽는 현황이다.
     후보가 없으면 `/dflow-merge` 가 스스로 0건으로 끝난다.
   - `needs-merge` 결과가 온 기상. 워커가 서버 approved 를 확인한 머지 대상이 있어 검사는 어차피 후보를 낸다.
   - 사람이 "스윕해"·"머지해" 처럼 직접 요청한 경우.
   예외여도 한 기상에 1회는 같다.

### 4-1. 머지 충돌 해소

스윕이 "머지 실패(충돌)" 을 낸 id8 은 `references/merge-conflict.md` 「1. 충돌 접수」 로 넘긴다. 해소는 이 신원의
주문(`mine`)만, 한 작업에 3번까지, 같은 기준에서 다시 충돌한 것이 아닐 때만 한다. 해소 큐에 넣고 「5-2. 해소 spawn」 이
띄운다. 나머지는 "사람이 머지해야 함" 으로 보고한다. 두 경우 모두 좌석표에 `merge_conflict` 표시를 대리로 쏜다. 충돌
목록은 `team.conflict` 로 남는다. 사람이 손으로 머지하면 다음 스윕 판정 기상(「4-0」, 스윕을 건너뛴 기상 포함)의 「5. 사람 머지 감지」 가 표시를 푼다. 절차
정본은 그 문서이며 Bash `cat` 으로 읽는다.
```bash
cat .claude/skills/dflow-team/references/merge-conflict.md
```

## 5. 팀원 spawn

0. **입장 제어는 spawn 블록이 집행한다**(「5-3. 입장 제어」). 5항에서 도는 backends.md 의 spawn 블록이 첫 단계에서
   `capacity.sh` 를 부르고, 막히면 `SPAWN_DEFERRED_CAPACITY` 를 내고 아무것도 만들지 않은 채 끝난다. 그러면 6항
   (`team.spawn`·진행 중 제외)을 하지 않고 이 작업을 대기 큐에 되돌리며, 이번 기상의 나머지 spawn 도 하지 않는다. 재개(「5-1」)·해소(「5-2」)·재투입도 같다.
   **새 작업만은** 그 블록 전에 주간 사용량도 본다: `.claude/skills/dflow-team/scripts/capacity.sh usage --live <점유 슬롯 수(이번 기상에 띄운 것 포함)> --state "$(git rev-parse --git-path dflow-team.usage)"`.
   exit 1(`CAPACITY_USAGE_STOP`, `CAPACITY_USAGE_CAP … defer=1`)이면 `SPAWN_DEFERRED_CAPACITY` 와 같이 새 작업만 미룬다. 알림은 `notify=1` 일 때만 그 줄 그대로 한 줄. 근거는 rationale.md 「5-3」.
1. 그 id8 이 재구성한 슬롯 표에 있으면 띄우지 않는다(poll 이 겹쳐 떠서 같은 ready 를 두 번 돌려줘도 한 번만 띄운다).
2. 슬롯 번호를 정하고(「팀장 상태」 의 발급 규칙) `AGENT_ID = <신원>/<host>/w<slot>` 을 만든다.
3. TSK 는 show 필터의 `ref`(`.order.item.external_ref`)에서 마지막 `/` 뒤, order 는 `.order.id` 다.
   **4번은 별도 Bash 호출이라 이 줄의 셸 변수를 못 본다 — 그래서 값을 이 자리에서 출력하고, 그 출력을
   4번 포인터에 그대로 옮겨 쓴다.**
   ```bash
   order='<order>'   # show 출력의 .order.id(전체 UUID)를 옮겨 쓴다
   TASK_DIR=$(.claude/skills/dflow-work/scripts/dflow.sh taskdir "$order"); rc=$?
   echo "TASK_DIR=${TASK_DIR:-없음} rc=$rc"
   .claude/skills/dflow-team/scripts/docker-allow.sh "$order" --reuse-dir "$(git rev-parse --git-path dflow-team-poll)"   # DOCKER=allow|ban — 4번 포인터에 옮긴다
   ```
   로 이 작업의 작업 폴더(`<TASKS>/<TSK>`)를 구한다. `taskdir` 는 `external_ref` 를 모르므로 `ref` 가 아니라
   `order` 를 넘긴다. `rc` 가 0 이 아니면(exit 2 `PROJECT_MISMATCH`·`AMBIGUOUS_DOCS_DIR`, exit 6 `NO_REF`)
   **spawn 하지 않는다**: 그 id8 을 일시 제외에 넣고 사유 `작업 폴더 해석 실패(exit $rc)` 를 보고하며
   `team.result`(slot `-`, status `skipped`)를 남긴 뒤 다음 후보로 간다(poll exit 0 갈래의 spec 부재·TSK 없음과 같은 처리).
4. 포인터 **한 줄**을 만든다. 백엔드에는 워커 프롬프트 전문이 아니라 이 포인터를 넘기고, 워커가
   `references/worker-prompt.md` 를 읽어 그 규칙대로 실행한다. 포인터는 치환 변수만 전달한다.
   ```
   <MAIN_CHECKOUT>/.claude/skills/dflow-team/references/worker-prompt.md 를 읽고 그 규칙대로 실행하라. TSK=<TSK> ID8=<id8> AGENT_ID=<신원>/<host>/w<slot> MAIN_CHECKOUT=<팀장 체크아웃 절대경로> BACKEND=pane MODEL=<opus|sonnet|default> DEV_BRANCH=<개발브랜치> TASK_DIR=<작업 폴더> DOCKER=<allow|ban>
   ```
   - `DOCKER` 는 3번 블록의 `docker-allow.sh` 가 낸 값이다(「인자」 의 「도커 허용 태그」). 재개(「5-1」)·재시작(restart.md
     재투입)은 이 형식으로 포인터를 다시 쓰며 그때도 `docker-allow.sh` 로 다시 구하고, 해소(「5-2」)는 merge-conflict.md 의
     해소 포인터에 같은 방법으로 싣는다. 옛 포인터의 값을 옮겨 쓰지 않는다.
   - `DEV_BRANCH` 는 전제 검사의 `base` 다. `TASK_DIR` 은 3번이 출력한 값이다. 워커는 둘을 다시 해석하지 않는다(detach 된
     옛 커밋에서는 다른 값이 나올 수 있다).
   - 전문을 셸 인자로 넘기면 백틱·따옴표·여러 줄이 섞여 깨진다. 워커 프롬프트 경로는 절대경로로 준다(새 워크트리에 스킬이
     없을 수 있다).
   - `BACKEND` 는 언제나 `pane` 이다(두 백엔드 모두 팀원이 화면에서 멈춰 답을 기다린다, worker-prompt.md).
   - 모델은 공백이 든 `--model opus` 를 넘기지 않고 `MODEL=` 로 넘기며, 워커가 `{MODEL_FLAG}` 로 바꾼다
     (`default` 면 빈 값). 두 백엔드 모두 같은 값을 `.dflow-run` 의 `claude` 호출에도 붙인다(backends.md).
5. **띄우기 직전** `references/restart.md` 「중단 표식 정리」 블록을 돈다(`order` 는 show 필터의 `order`, `st` 는 `status`).
   `CANCEL_MARK_RM_FAILED` 면 띄우지 않고 그 id8 을 일시 제외에 넣어 사유를 보고한다. 이어서 backends.md 의 해당 절 명령 그대로 띄운다.
   backends.md 는 통째로 읽지 않고 그 머리 「읽는 법」 의 `sed` 명령으로 spawn 절만 읽는다(Orca 는 「pane(Orca)」 도).
   - **pane(tmux)**: 팀장 체크아웃에서
     `git worktree add --detach <MAIN>/.claude/worktrees/dflow-<id8> origin/<기본브랜치>` 로 워크트리를 만들고
     `.dflow.local`(레거시 `.env`)·스킬 링크를 건 뒤, 포인터를 `<워크트리>/.dflow-prompt` 에, 실행 스크립트를 `<워크트리>/.dflow-run`
     에 쓰고, 서버가 없으면 `new-session` 있으면 `split-window` 로 pane 을 띄운다(명령 전문은 backends.md
     「pane(tmux)」). pane id 를 `<워크트리>/.dflow-pane` 에 쓰고, `allow-set-title off` 를 걸고 `select-pane -T` 로 그 pane 에 `w<slot> · <TSK> <id8> · <작업 이름>` 이름표를 붙인다. **이어서 폴더 신뢰 확인 루프를 반드시 돈다**(넘기면 팀원이 첫 화면에서 멈춘 채 슬롯 하나가 논다). 기점은
     `origin/<기본브랜치>` 로 명시하고, 스택 기점은 `/dflow-dev` Phase 01 2번이 claim 전에 맞춘다.
   - **pane(Orca)**: backends.md 「pane(tmux)」 스폰 블록의 처음(입장 제어 두 줄 포함)부터 `chmod +x
     "$WT/.dflow-run"` 줄까지 **그대로, 한 번의 Bash 호출 안에서** 돈 뒤, 그 이어(tmux 의 `has-session` 대신)
     backends.md 「pane(Orca)」 의 `orca terminal create --worktree "path:$WT" … --command ./.dflow-run --json` 블록으로
     잇는다. `WT` 는 tmux 와 같은 자리 `<MAIN>/.claude/worktrees/dflow-<id8>` 다. 결과 JSON 의 핸들을 슬롯 표와
     `$WT/.dflow-pane` 에 저장한다. 핸들이 없으면 화면 읽기 없이 git·서버 증거만 쓴다. **이어서 폴더 신뢰 확인
     루프를 반드시 돈다**(backends.md 「pane(Orca)」 「폴더 신뢰 확인」) — `I trust this folder` 가 보이면 키를
     보내지 않고 "사람 확인 필요"로 보고한다. 이후 이 워크트리를 가리킬 때는 `--worktree "path:$WT"` 선택자를 쓴다.

   팀원을 Agent 도구 서브에이전트로 띄우지 않는다(머리말 「제1 제약」).
6. spawn 직후 `team.spawn` 에 `slot`·`tsk`·`order`·`id8`·`worktree`·`handle`·`spawn_kind` 를 남긴다. 새 작업이므로
   `spawn_kind` 는 `new` 다. `worktree` 는 팀원
   워크트리 절대경로(모르면 `-`), `handle` 은 `tmux:<pane_id>` 또는 Orca 터미널 핸들이며 핸들이 없으면 `-` 다.
   재구성이 이 기록으로 슬롯과 작업을 잇는다. id8 을 영구 제외(진행 중)에 넣는다. 빠뜨리면 압축 뒤 재구성이
   그 작업을 놓친다.

같은 작업을 다시 띄우는 것은 다섯뿐이다(다섯째는 「5-2. 해소 spawn」 의 해소 워커다. 주문이 `reported`·`approved` 라 개발 재spawn 이 아니며 `resolve-decide.sh` 판정 안에서만 띄운다). poll 이 그 작업을 다시 돌려준 경우(일시 제외가 풀린 `skipped`,
제외하지 않는 `failed rate-limit`), 고아 스캔이 "재개 가능" 으로 분류한 중단 작업, `--resume` 으로 사람이 지목한
작업, 자동 재시작(`references/restart.md`)이 다시 띄우는 작업이다. 뒤의 셋은 이 절이 아니라 「5-1. 재개 spawn」 의 절차로 띄운다(워크트리를 새로 만들지 않고 claim 도
하지 않는다). `blocked` 는 재spawn 하지 않는다. 팀원이 자기 화면에서
답을 기다리므로 그 자리에서 이어 간다(「6. blocked」). 다시 띄울 때 이름·브랜치가 부딪치지 않는 것은
backends.md 「고아 정리 규칙」 5번의 생성 브랜치 정리와 결과 처리의 워크트리 정리가 맡는다.

### 5-1. 재개 spawn

중단된 작업을 이어 띄운다. 새 작업 spawn 과 두 가지가 다르다. **워크트리를 새로 만들지 않고**(남아 있으면
그대로 쓴다) **claim 하지 않는다**. 대상은 넷이다: 고아 스캔의 "재개 가능"(**자동**, 대기 큐보다 먼저), 좌석표 「이어서 시작」
의 `resume_requests`(**요청**, 재시도 상한 무시), `references/restart.md` 「재투입」(**재시작**), `--resume <id8>`(**지목**,
자동 판정의 거부 사유 무시. 서버 status 가 `claimed` 일 때만 재개다). 띄울 때마다 `references/resume.md` 를 Bash `cat` 으로
읽고 그 0~9항 절차(입장 제어 → 손실 보고 → 다른 PC 경고 → 워크트리 확보 → `TASK_DIR`·`DOCKER` → 슬롯·`.dflow-agent` 되돌리기
→ 포인터 재작성 → 중단 표식 정리·띄우기 → 옛 `.result` 삭제 → `team.spawn`(`resume`))를 그대로 따른다.

### 5-2. 해소 spawn

해소 큐의 작업을 해소 전용 워커로 띄운다. 워크트리는 `origin/<기본브랜치>` 에 detach 한
`<MAIN>/.claude/worktrees/dflow-<id8>-resolve` 이고, 포인터는 `references/resolve-prompt.md` 를 가리키며, `team.spawn` 의
`spawn_kind` 는 `resolve` 다. 재개 다음·대기 큐보다 먼저 띄우고, 동시에는 `max(1, ⌊인원/2⌋)` 까지다(인원은 「인자」 의
인원 상한으로 자른 뒤의 값이다. 16GB PC 의 기본 상한 4 면 해소는 2개까지). claim 하지 않는다.
tmux·Orca 띄우기, 신뢰 확인 루프, 이름표(`w<slot> · 해소 <TSK> <id8>`)는 5번과 같다. 입장 제어도 같다(「5-3」): merge-conflict.md
가 backends.md 의 공용 스폰 블록을 그대로 돌리므로 그 첫 단계가 집행한다. `SPAWN_DEFERRED_CAPACITY` 면 해소 큐에 그대로 두고 merge-conflict.md
「2」 의 5~7번(`team.spawn`·표시 note·감시 루프 항목)을 하지 않는다. 띄우지 않았으므로 해소 시도로 세지 않는다 —
`team.spawn`(`resolve`) 줄 수가 해소 카운터이고 그 id8 을 진행 중(영구 제외)으로 만들기 때문이다. 절차 정본은
`references/merge-conflict.md` 「2. 해소 spawn」 이고 결과 처리는 같은 문서 「4」 다.

### 5-3. 입장 제어 (spawn 직전 자원 확인)

**입장 제어의 정본은 이 절이다**(「5」 0항·「5-2」·`references/resume.md` 0항·backends.md 「입장 제어」·restart.md 「재투입」 은
이 절을 가리킨다). 팀원 세션을 새로 띄우기 직전마다 PC 여유 자원을 본다. 새 작업(「5」)·재개와 재투입(「5-1」)·해소(「5-2」)·차단기의 시험
spawn 모두 해당한다. 이미 모자란 PC 에 팀원을 더 얹지 않는다.
**이미 떠 있는 팀원은 건드리지 않는다**(끄거나 멈추지 않는다). 무거운 명령 자체의 동시 실행은 워커 쪽 `heavy.sh`
(`dev-discipline.md` 「무거운 명령 줄 세우기」)가 따로 묶는다.

**집행은 spawn 블록 한 곳이다.** backends.md 「입장 제어」 블록이 아래 명령을 부르고, 막히면 `SPAWN_DEFERRED_CAPACITY`
를 내고 끝난다. 새 작업(「5」)·해소(「5-2」)의 spawn 블록(backends.md 「팀원 워크트리 준비」)은 두 백엔드 모두 그 두 줄로
시작하므로 블록을 돌기만 하면 걸린다. 블록을 통째로 돌지 않는 자리 — 재개·재투입(`references/resume.md` 0항, restart.md
「재투입」) — 는 「입장 제어」 블록을 첫 단계로 따로 돈다(워크트리를 새로 만들지 않고 있는 것을 이어 쓴다).
```bash
.claude/skills/dflow-team/scripts/capacity.sh --state "$(git rev-parse --git-path dflow-team.capacity)"; echo "rc=$?"
```
- `CAPACITY_OK`(rc=0): 띄운다.
- `CAPACITY_LOW`(rc=1) = 블록의 `SPAWN_DEFERRED_CAPACITY`: 이번 기상에는 팀원을 새로 띄우지 않는다. 후보는 대기 큐(재개 대상은 재개 목록,
  해소는 해소 큐, 재투입은 재시작 대기)에 그대로 둔다. 한 후보가 막히면 같은 기상의 나머지 후보도 띄우지 않는다.
  작업 탓이 아니므로 `team.result` 를 남기지 않고 일시 제외에도 넣지 않는다. 다음 기상(늦어도 `TICK`)에 다시 본다.
- `CAPACITY_UNKNOWN`(rc=0): 판정할 수 없는 OS 이거나 측정 명령이 실패했다. 막지 않고 띄운다(성능 보호이지 보안
  가드가 아니다). 일부 항목만 못 읽었으면 `unknown=` 에 적히고 판정은 읽은 항목으로 한다.
- **알림은 줄 끝이 `notify=1` 일 때만 한 줄** 사람에게 한다. `CAPACITY_LOW` 면 "자원 부족으로 새 팀원 보류: <출력 줄>",
  `CAPACITY_OK` 면 "자원 회복, 팀원 spawn 재개", `CAPACITY_UNKNOWN` 이면 "자원 판정 불가(막지 않음): <출력 줄>" 이다.
  `notify=0` 이면 알리지 않는다. 상태 파일(git-path `dflow-team.capacity`)이 마지막 판정과 시각을 담는 기록이며, 판정이
  바뀔 때만 `notify=1` 이 되므로 `TICK` 마다나 컨텍스트 압축 뒤에 같은 알림을 되풀이하지 않는다.
- 기준값의 정본은 `capacity.sh` 머리다. macOS 메모리 압박 warn 이상, 여유 메모리 30% 미만, 5분 load average 가 코어당
  2.0 초과, 무거운 명령 슬롯의 대기자 수가 슬롯 수 이상(`heavy_wait=<대기>/<슬롯>`, `heavy.sh status` 첫 줄에서 읽는다) 가운데
  하나라도 걸리면 `CAPACITY_LOW` 다. 스왑은 RAM 의 150% 이상일 때만 막는 극단 안전망이다(macOS 스왑은 압박이 풀린 뒤에도
  몇 시간씩 남는다). `heavy.sh status` 를 못 읽으면 그 항목만 판정하지 않는다
  (`unknown=heavy`). 사람이 바꾸려면 팀장 세션의 환경변수 `DFLOW_CAP_MIN_FREE_PCT`·`DFLOW_CAP_MAX_LOAD_PER_CPU`·
  `DFLOW_CAP_MAX_SWAP_PCT` 로 덮는다.

## 6. blocked

**공통**: 사람에게 AskUserQuestion 으로 묻지 않는다(자동 루프). 결과 처리가 `team.blocked` 를 기록한다.
PushNotification 도구가 있으면(지연 로드면 ToolSearch 로 불러) 질문 요약으로 한 번 알린다. 없으면 화면 통지만
한다. 그 id8 은 진행 중으로 영구 제외에 남긴다.

**그 슬롯은 blocked 팀원이 계속 잡으며 다른 작업에 재배정하지 않는다.** 살아 있는 프로세스 둘이 같은
`AGENT_ID` 로 heartbeat 를 보내면 좌석표가 한 인물을 두 책상에 그린다. 두 백엔드 모두 팀원이 같은 워크트리·브랜치에서
이어 가며 재spawn 도 재claim 도 없다. `.result` 가 새 줄로 바뀌면 감시 루프가 알린다.

**tmux**: "결정 필요 <id8>: <질문>. `TMUX= tmux -L dflow attach` 로 붙어 그 pane 에서 직접 답하거나, 이 세션에
`<id8> <답>` 으로 답하라" 고 알린다.

**Orca**: "결정 필요 <id8>: <질문>. Orca 의 `w<slot> · <TSK> <id8> · <작업 이름>` 탭에서 답하라" 고 알린다.

**답 매칭(tmux)**
- 답은 `<id8> <답>` 형식으로 받는다(여러 팀원의 질문이 동시에 쌓일 수 있다).
- 답을 기다리는 `blocked` 가 하나뿐이면 id8 없이 온 답도 그 작업의 답으로 본다.
- 여럿인데 id8 이 없으면 어느 작업의 답인지 되묻는다. 루프가 돈 뒤 팀장이 사람에게 묻는 곳은 여기 하나다(시작
  전 인자 질문은 「인자」). 답을 엉뚱한 작업에 넣지 않는다.
- 답을 넣기 **전에** "그 pane 에 답을 넣는다" 를 한 줄 알린다(사람이 같은 pane 에 동시에 치면 입력이 섞인다).
  ```bash
  TM='<진짜 tmux 절대경로>'; PANE=$(head -n 1 '<워크트리>/.dflow-pane')
  d=$("$TM" -L dflow list-panes -t "$PANE" -F '#{pane_dead}' 2>/dev/null | head -n 1)
  if [ "$d" = 0 ]; then
    "$TM" -L dflow send-keys -t "$PANE" -l -- '<답 한 줄>'
    "$TM" -L dflow send-keys -t "$PANE" Enter
    echo ANSWER_SENT
  else
    echo "PANE_GONE dead=$d"
  fi
  ```
  `-l --` 로 넣는다(없으면 tmux 가 답을 키 이름으로 먼저 해석한다. backends.md 「생존·화면·답·회수」).
- `PANE_GONE` 이면 그 팀원은 이미 끝났다. 답을 넣지 못하므로 "그 팀원은 이미 끝났다. 수동 `/dflow-dev <id8>`
  대상" 으로 보고하고 영구 제외에 남긴 뒤 슬롯을 해제한다. 워크트리는 「고아 정리 규칙」 을 따른다.
- `ANSWER_SENT` 면 `team.answer`(id8, answer)를 기록한다(없으면 압축 뒤 재구성이 이미 답한 질문을 다시 통지한다).
- 슬롯은 그대로 둔다. 팀원이 그 자리에서 이어 가므로 새로 띄울 것이 없다.

## 7. 마감

poll exit 8, poll 오류 exit, `failed not-isolated`, 기상 때 확인한 종료 시각 경과, 종료 요청(`STOP_REQUESTED` 또는
사람의 말)으로 온다. 잠금 상실(「2-3」 의 `LOCK_LOST`)과 lease 상실(`LEASE_LOST`)은 「잠금 상실 마감」·「lease 상실 마감」 으로
간다. 들어서면 먼저 아래를 읽고 그 절차(1~7, 잠금 상실 마감, lease 상실 마감)를 그대로 따른다. 새 spawn 은 곧바로 멈춘다.
```bash
cat .claude/skills/dflow-team/references/closing.md
```

## 좌석표 연동

- 팀원의 좌석 식별은 워커가 쓰는 워크트리 루트 `.dflow-agent`(`<신원>/<host>/w<slot>`)다. 좌석표 S1 의 훅이 이
  파일을 `heartbeat_agent` 로 읽는다. `<신원>/<host>/parked` 는 좌석이 아니며 heartbeat 를 보내지 않는다.
- 팀장 자신은 `<신원>/<host>/lead` 다. 같은 신원의 두 PC 팀장이 좌석표에서 하나로 합쳐지지 않게 한다.
- 좌석표 STANDBY 신호: 팀장은 「1. 시작」 6번과 매 기상(「2-3」 의 `wake.sh`)에서 잠금 `owner` 의 신원으로
  `dflow.sh watch --agent <신원>/<host>/lead --slots <N> --busy <M> --until '<UNTIL_LABEL>'` 을 1회 보내고, 「7. 마감」에서
  `--stop` 을 1회 보낸다. 감시 루프가 TICK 을 건너뛸 때도 `wake.sh` 로 1회 보낸다(「2-2」). 좌석표는 마지막 신호 뒤 70분에
  STANDBY 를 끈다.
- poll.sh 는 `DFLOW_WATCH=0` 으로 띄우므로 watch 를 보내지 않는다.
- **이 호출은 표시용만이 아니다.** 응답의 `resume_requests` 가 좌석표의 「이어서 시작」 요청을 실어 오므로
  `--json` 으로 부르고 본문을 읽는다(「2-3」). 실패해도 팀장을 멈추지 않지만, 실패를 "요청 없음" 으로 읽지
  않는다. 「1. 시작」 6번과 「7. 마감」 의 `--stop` 은 종전대로 결과를 보지 않는다.
- 팀원의 blocked 직전 heartbeat(worker-prompt.md)는 좌석표에 손 든 상태를 남기고, 다음 heartbeat 가 그것을 푼다.

## 금지

- 팀원에게 AskUserQuestion 을 쓰게 하는 것. 팀장이 사람에게 묻는 곳은 시작 전 인자 질문(「인자」)과 답 매칭의
  id8 되묻기 둘이다.
- 팀장이 작업을 claim·progress·done 하는 것. 서버 쓰기는 팀원 몫이다(스윕의 머지만 팀장이 한다). 재개도
  마찬가지다. 서버가 이미 `claimed` 이므로 다시 claim 하지 않으며, 끊긴 Phase 를 잇는 것은 이어받은 워커의
  `/dflow-dev --worker` 다.
  예외 둘: (1) 머지 충돌 표시 heartbeat(`merge_conflict` 설정·해제, `references/merge-conflict.md`
  「3」)는 팀장이 한다. 주문 상태를 바꾸지 않고 표시 열만 쓴다. (2) 팀장이 띄운
  해소 워커의 `/dflow-merge --resolve` 가 개발 브랜치에 한 건을 머지·push 한다. "스윕의 머지만 팀장이 한다" 의 유일한
  예외다. 경합은 두 쪽 모두 non-fast-forward 거부로 드러나고, force push 는 여전히 금지다.
- 팀장이 대상 리포의 소스를 고치거나 빌드·시험(gradle·npm test 등)을 직접 돌리는 것(머리말 「팀장 역할」, 예외는 「2-4」 5번). 팀원이나
  해소 워커에게 넘긴다. 스킬이 팀장에게 맡긴 스크립트(`dialect-check.sh` 등)가 안에서 시험을 돌리는 것은 예외다.
- 한 기상에 스윕을 두 번 이상 부르는 것, `sweep-check.sh` 가 `SWEEP_NONE` 인데 `/dflow-merge` 를 부르는 것(「4-0」 의 예외 제외).
- 팀원을 Agent 도구 서브에이전트로 띄우는 것(`isolation: "worktree"` 를 주어도). 머리말 「제1 제약」.
- tmux 를 PATH 로 부르는 것(Orca shim 이 잡는다). 언제나 전제 검사가 구한 절대경로(`TM`)로 부른다(backends.md 「진짜 tmux 찾기」).
- 팀원 워크트리에서 팀장이 git 을 조작하는 것(읽기 조회, `parked` 표시, 「5-1. 재개 spawn」 의 `.dflow-agent`
  되돌리기·포인터 재작성·옛 `.result` 삭제, backends.md 의 정리 절차는 예외).
- 팀장 체크아웃에서 poll.sh 를 띄우는 것. 빈 디렉터리(「2-1」)에서만 띄운다.
- 순번 참조, force push, 훅 우회(SKIP_GUARD).
- 같은 작업의 재spawn. 예외는 「5. 팀원 spawn」 끝의 다섯뿐이다. `blocked` 는 재spawn 하지 않는다.
- poll·감시 루프를 셸 `&` 로 띄우는 것. 둘은 Bash `run_in_background` 로만 띄운다. 팀원 spawn 에도 `&` 를
  쓰지 않는다(tmux `split-window` 가 곧바로 돌아오고 pane 은 tmux 서버가 붙잡는다).
- 컨텍스트 압축 뒤 Skill 도구로 `/dflow-team` 을 다시 부르는 것(「팀장 상태」 「압축 뒤 첫 기상」).
