---
name: dflow-team
description: D'Flow 에서 내게 배정되고 에이전트 위임(tags:agent)된 ready 작업을 상시 감시해 슬롯 N개의 팀원에게 나눠 동시에 개발시키는 팀장 스킬. 팀원은 자기 서브에이전트를 띄울 수 있는 독립 세션(tmux pane 또는 Orca 탭)이며 각자 워크트리에서 /dflow-dev 를 돌린다. 당일·여러 날·종료 요청 전까지 실행할 수 있다. 트리거 - "/dflow-team", "팀으로 개발", "팀장 시작", "N건 동시 착수", "팀장 종료". 사용법 - /dflow-team [인원] <종료시각|종료 요청 전까지> [모델] [effort] [WP-XX…] · /dflow-team help
---

# /dflow-team: 팀장 (슬롯 N개 동시 개발)

인자: `$ARGUMENTS`

> **위치 선언**: 설계 정본은 wbs-web 리포 docs/superpowers/specs/2026-09-10-dflow-team-design.md(킷에는
> 미동봉). `/dflow-poll` 이 한 번에 1건만 착수하던 것을 슬롯 N개 동시 착수와 상시 보충으로 넓힌다. 기본은
> 담당자가 자리에 있는 supervised 루프이고, 사람이 명시하면 여러 날이나 종료 요청 전까지 무인으로도 돈다(「인자」). 서버 통신은 dflow.sh 로 하고 exit code 로 분기하며, dflow-work
> 금지사항을 상속한다.
>
> **제1 제약: 팀원을 서브에이전트로 띄우지 않는다.** 팀원은 `/dflow-dev` 를 실행하고 `/dflow-dev` 는
> Phase 02~05 를 서브에이전트로 쪼갠다. 서브에이전트는 자기 턴이 끝나면 하네스가 완료로 보아, 그 뒤에 끝난
> Phase 손자의 완료가 팀원을 깨우지 못한다. 팀원은 별도 프로세스의 **대화형** claude 메인 에이전트여야
> 한다: 팀장이 tmux pane 에 띄운 프로세스 또는 Orca 탭 프로세스(backends.md).

참조: `references/backends.md`(백엔드별 spawn·정리 명령, 차이표, 고아 정리 규칙), `references/worker-prompt.md`
(팀원 규칙. 팀장은 포인터로 넘기기만 한다), `references/events.md`(events.jsonl 이벤트 표·기록 명령),
`references/restart.md`(자동 재시작 판정·재투입·rate-limit 대기·중단 표식 정리).
문제 기록: 팀원이 겪은 에러·문제점은 팀장 체크아웃의 `docs/dflow-team/issues.md` 에 쌓인다(「3. 결과 처리」).
스킬 개선 재료이며 커밋하지 않는다.

이 문서의 `dflow.sh` 는 `.claude/skills/dflow-work/scripts/dflow.sh` 이며, `.dflow`·`.dflow.local`(레거시는
`.env`)을 스스로 읽으므로 접두를 붙이지 않는다. `<기본브랜치>` 는 「1. 시작」 전제 검사가 구한 이름이다(자세한
정의는 「1. 시작」 첫머리).
`<MAIN>`·`<MAIN_CHECKOUT>` 은 팀장 체크아웃의 절대경로, `<신원>`·`<host>` 는 「1. 시작」 전제 검사가 만든
슬러그다.

## 인자

`/dflow-team [인원] <종료시각|종료 요청 전까지> [모델] [effort] [WP-XX…]`. 예: `/dflow-team 18:00`,
`/dflow-team 4명 18시까지 opus`, `/dflow-team 18:00 WP-02 WP-03`, `/dflow-team 3일 뒤 06:00까지`,
`/dflow-team 종료 요청 전까지`, `/dflow-team 18:00 opus effort xhigh`.

- 인자는 자연어로 해석한다. 플래그 문법을 강제하지 않는다.
- **`help`**: 인자가 `help`·`--help`·`-h`·`도움말`·`사용법` 중 하나면 `references/help.md` 를 Bash `cat` 으로 읽어
  그대로 보여 주고 **끝낸다.** 전제 검사·잠금·서버 호출을 하지 않는다. 그 파일은 이때만 읽는다. 이유: 사용 안내는
  사람이 요청할 때만 필요하고, 매 실행마다 읽으면 컨텍스트만 차지한다.
- **강제 인수**: 인자에 `--takeover`·`강제 인수`·`넘겨받기` 가 있으면 「1. 시작」 의 `<TAKEOVER>` 를 `--takeover` 로,
  없으면 빈 값으로 채운다. 같은 신원이 이 프로젝트의 팀장 lease 를 **다른 곳**(다른 clone·다른 PC)에서 쥐고 있을 때
  그것을 빼앗는다. 밀려난 팀장은 약 1분 안에(다음 갱신 + 감시 루프 20초) `LEASE_LOST` 로 멈추고, 그 팀장의 워커는 하던 작업을 끝낸다. 사람이
  명시할 때만 쓴다. 이유: 살아 있는 팀장을 빼앗으면 그 팀장의 슬롯·대기 큐가 보고만 남기고 끊긴다.
- **키 판정**: `.dflow.local` 의 `pats`(레거시 `.env` 의 `DFLOW_PATS`)에 토큰이 둘 이상이면 어느 키로 돌지를 시작
  전에 정한다. 「1. 시작」 전제 검사
  **전**, 다른 인자의 질문보다 **먼저** 한다. 이유: 잠금을 쥔 채 사람의 답을 기다리지 않아야 하고, WP 범위
  선택지를 뽑는 `list` 도 전제 검사의 `me` 도 고른 키로 돌아야 한다. 정본은 `.dflow.local` 의 `as=<prefix>`(레거시
  `.env` 의 `DFLOW_AS`)이며
  `dflow.sh`·`poll.sh`·팀원(`.dflow.local` 심링크)·heartbeat 훅이 모두 그 값을 따른다. 실행마다 골라 워커에 넘기지 않는
  이유: 훅과 `/dflow-dev` 의 하위 Phase 는 그 값을 받지 못해 팀장과 팀원의 신원이 갈라진다. `.dflow.local` 은 팀장
  체크아웃마다(주 체크아웃, 그리고 「두 번째 팀장」 의 팀장 워크트리마다) **워크트리마다 따로** 있으므로, 키도
  워크트리마다 정한다. 팀원의 `.dflow.local` 링크는 자기 팀장의 체크아웃을 가리키므로 팀원은 자기 팀장의 키를 따른다.
  ```bash
  (echo "as=$(.claude/skills/dflow-work/scripts/dflow.sh config as)"; .claude/skills/dflow-work/scripts/dflow.sh profiles) \
    | .claude/skills/dflow-team/scripts/live-leads.sh --mark
  ```
  토큰마다 한 줄 JSON 이 나온다(`n`·`prefix`·`name`·`email`·`who`·`expires_at`·`projects`·`bound`·`selected`·`in_use`,
  `/me` 가 실패한 토큰은 `error`). 토큰 값은 나오지 않는다. `bound` 는 그 키의 프로젝트에 이 리포의 바인딩 프로젝트가
  있다는 뜻이고, `selected` 는 지금 설정으로 `dflow.sh` 가 고르는 키다. `who` 는 그 키의 신원 슬러그(잠금 `owner` 의
  `<신원>` 과 같은 규칙)이고, `in_use` 는 같은 리포의 **다른 워크트리에서 살아 있는 팀장**이 그 신원을 쓰고 있으면 그
  워크트리 경로, 아니면 `null` 이다. 살아 있음의 기준은 전제 검사의 `SAME_IDENTITY_LEAD` 와 같다(`live-leads.sh`).
  `in_use` 가 `null` 이 아닌 키로는 시작할 수 없다. 전제 검사가 어차피 거부하는데, 그것을 사람에게 종료 시각까지
  물은 뒤가 아니라 묻기 전에 알기 위해 여기서 본다. **같은 계정의 키** 여러 개는 `who` 가 같아 함께 빠진다. 잠금
  `owner` 에는 prefix 가 없고 신원만 있으며, 좌석표와 팀원 접두(`<신원>/<host>/`)도 신원 단위이기 때문이다.

  | 상태 | 처리 |
  |---|---|
  | `as`(레거시 `DFLOW_AS`) 가 있다(값이 비어 있지 않다) | 묻지 않는다. `selected` 가 `true` 인 행이 없으면 `KEY_NOT_FOUND`, 그 행의 `in_use` 가 `null` 이 아니면 `KEY_IN_USE` 로 끝낸다 |
  | 없고 토큰이 1개 | 그 행의 `in_use` 가 `null` 이 아니면 `KEY_IN_USE` 로 끝내고, 아니면 그대로 간다 |
  | 없고 토큰이 2개 이상 | `error` 가 없고 `bound` 가 `true` 이고 `in_use` 가 `null` 인 행이 후보다 |
  | → 후보 0개 | `bound` 가 `true` 인 행이 하나도 없으면 `NO_KEY_FOR_PROJECT`, 있는데 모두 `in_use` 면 `NO_FREE_KEY` 로 끝낸다 |
  | → 후보 1개 | 그 키를 자동 선택한다 |
  | → 후보 2개 이상 | AskUserQuestion 으로 묻는다. 종료 시각도 물어야 하면 같은 호출에 모은다 |

  - `bound` 가 `null` 이면(프로젝트 바인딩 없음) 키 판정을 건너뛰고 전제 검사로 간다. `NO_PROJECT` 가 시작을 막는다.
  - 선택지는 후보마다 하나다. label 은 `<name> · <email>`, description 은 `prefix <prefix> · <프로젝트 이름들> · 만료
    <expires_at 의 날짜>` 다. 후보가 4개를 넘으면 앞의 3개를 내고 나머지는 "Other 에 prefix 를 적는다" 로 받는다.
  - **종료 시각이 인자로 주어져도 키 질문은 한다.** 인원·WP 범위는 기본값이 있어 묻지 않지만, 신원에는 안전한
    기본값이 없다.
  - 키를 묻는 호출에서는 WP 범위 선택지를 서버에서 뽑지 않고 `전체 (기본)` 과 "Other 로 직접 적는다" 만 둔다. 이유:
    그 목록은 고른 키로 조회해야 하는데, 키는 같은 호출의 답으로 정해진다.
  - 자동 선택이든 답이든, 고른 prefix 를 `.dflow.local` 끝에 더하고 한 줄 보고한다. 자동 선택한 키가 첫 토큰이어도
    더한다. 이유: 나중에 토큰을 더하거나 순서를 바꿔도 이 리포의 키가 바뀌지 않는다. `.dflow.local` 이 아직 없으면
    새로 만든다. 새 방식이 아닌 리포(레거시)는 `.env` 에 `DFLOW_AS` 로 적는다.
    ```bash
    if [ "$(.claude/skills/dflow-work/scripts/dflow.sh config --source | sed -n 's/^mode=//p')" = new ]; then
      printf '\nas=%s\n' '<prefix>' >> .dflow.local
    else
      printf '\nDFLOW_AS=%s\n' '<prefix>' >> .env
    fi
    ```
    보고: "키: <이름> (<email>, <prefix>). `.dflow.local` 에 `as` 로 저장했습니다(레거시는 `.env` 의 `DFLOW_AS`).
    바꾸려면 그 줄을 고치십시오." `.dflow.local`(레거시 `.env`)은 gitignore 대상이라 전제 검사의 `DIRTY` 에 걸리지
    않는다.
  - `KEY_NOT_FOUND`: "`.dflow.local` 의 `as`(레거시 `.env` 의 `DFLOW_AS`)가 어느 토큰과도 맞지 않는다. `dflow.sh
    profiles` 의 `prefix` 로 고쳐라" 와
    profiles 출력을 표로 내고 끝낸다. `as`·`DFLOW_AS` 는 prefix 만 받는다(이메일·이름 불가). 훅이 네트워크 없이 같은 키를
    골라야 하기 때문이다.
  - `KEY_IN_USE`: "이 키의 신원(`<who>`)은 `<in_use 경로>` 의 팀장이 쓰고 있다. 같은 신원으로는 팀장을 둘 띄울 수
    없다(`SAME_IDENTITY_LEAD`)" 와 profiles 출력을 표로 내고 끝낸다. `as`(레거시 `DFLOW_AS`)가 있었다면 "이
    워크트리의 `.dflow.local`(레거시 `.env`)에서 그
    줄을 지우고 다시 실행하면 남은 키에서 고른다" 를 덧붙인다. 다른 키로 **자동으로 바꾸지 않는다.** 사람이
    적어 둔 값을 조용히 무시하면 의도한 계정이 아닌 신원으로 작업이 claim 된다.
  - `NO_FREE_KEY`: "이 리포의 프로젝트에 속한 키가 모두 다른 워크트리의 팀장이 쓰는 신원이다. 다른 계정의 PAT 를 이
    워크트리의 `.dflow.local`(레거시 `.env`)의 `pats`(레거시 `DFLOW_PATS`)에 더하거나, 그 팀장에 인원과 WP 범위를 더
    주어라" 와 profiles 출력을 표로 내고
    끝낸다.
  - `NO_KEY_FOR_PROJECT`: "이 리포의 D'Flow 프로젝트에 속한 키가 `.dflow.local`(레거시 `.env`)에 없다" 와 profiles
    출력을 표로 내고 끝낸다.
    `error` 가 `auth` 인 행은 "폐기·만료된 키", `unreachable` 인 행은 "서버에 닿지 못함" 으로 적는다. 조회 실패를
    후보 없음으로 뭉개지 않기 위해서다.
  - 프로필 행이 하나도 나오지 않으면 `profiles` 가 실패한 것이다(파이프 뒤라 종료 코드는 보이지 않는다). 그 stderr 를
    그대로 보고하고 끝낸다.
- **종료 시각은 유일한 필수 인자다.** 새 배정을 멈추는 시각이며 세 형식 중 하나로 정규화한다. 정규화한 값을
  `<UNTIL>`, 좌석표에 싣는 표시 문자열을 `<UNTIL_LABEL>` 이라 부른다.

  | 말 | `<UNTIL>` | `<UNTIL_LABEL>` |
  |---|---|---|
  | `18:00`, "18시까지" (오늘) | `18:00` | `18:00` |
  | "내일 아침 7시", "3일 뒤 06:00", "월요일 09:00", `2026-09-21 06:00` | `2026-09-21 06:00` | `09-21 06:00` |
  | "종료 요청 전까지", "무기한", "계속", "끝날 때까지" | `none` | `종료요청까지` |

  - 날짜가 붙은 말은 오늘 날짜(`date +%Y-%m-%d`)를 기준으로 절대 날짜로 바꾼다. "N일 뒤" 는 오늘+N일, 요일은 오늘
    이후 가장 가까운 그 요일이다. 시각만 있고 그 시각이 오늘 이미 지났으면 **내일로 추측하지 않고** 묻는다. 이유:
    22시에 "06:00" 이라고 쓴 사람이 오늘 아침을 잘못 쓴 것인지 내일 아침을 뜻한 것인지 팀장이 알 수 없다.
  - 날짜가 붙은 종료 시각은 지금부터 **7일 이내**여야 한다(`UNTIL_TOO_FAR`). 그보다 길게 돌리려면 `종료 요청 전까지`
    를 쓴다. 이유: 날짜 오타 한 번에 몇 주씩 도는 일을 막되, 정말 길게 돌리려는 사람에게는 명시적인 길을 둔다.
  - 시작 보고의 첫 줄에 정규화한 절대 시각(또는 "종료 요청 전까지")을 적는다. 사람이 해석이 맞는지 바로 확인하게 한다.
  - **종료 요청**: 종료 시각 전이라도, 또는 `none` 이면 언제든 둘 중 하나로 멈춘다. 둘 다 「7. 마감」 으로 간다.
    1. 팀장 세션에 말로 한다: "팀장 종료", "마감해", "그만" 같은 말.
    2. 다른 세션·터미널에서 종료 파일을 만든다. 감시 루프가 20초 안에 보고 `STOP_REQUESTED` 로 팀장을 깨운다.
       ```bash
       touch "$(git -C <팀장 체크아웃> rev-parse --git-path dflow-team.stop)"
       ```
  - 종료 시각이 없거나, 이미 지났거나, 형식이 틀리거나, 7일을 넘으면 사용법만 출력하고 끝내지 않고
    **AskUserQuestion 으로 묻는다.** 묻는 것은 「1. 시작」 전제 검사 **전**이다. 이유: 전제 검사는 마지막에 잠금을
    잡으므로, 잠금을 쥔 채 사람의 답을 기다리면 그동안 다른 팀장이 이 체크아웃을 못 쓴다.
  - 한 번의 AskUserQuestion 에 질문을 모아 묻는다. 종료 시각이 빠졌을 때만 묻고, 종료 시각이 주어졌으면 나머지
    선택 인자는 묻지 않고 기본값을 쓴다. 이유: 인자를 다 준 사람을 붙잡지 않는다.
    1. **종료 시각**(필수): 선택지는 넷이다. 오늘 안의 가까운 정시 하나(없으면 뺀다), `내일 09:00`, `다음 월요일
       09:00`(오늘이 금·토·일일 때만. 아니면 `내일 18:00`), `종료 요청 전까지`. 사람이 "Other" 로 직접 적을 수 있다.
    2. **인원**: 이번 인자에 없을 때만. `3 (기본)`·`2`·`4`·`6` 순이다. 1·5 는 "Other" 로 직접 적는다(선택지는 넷까지다).
    3. **WP 범위**: 이번 인자에 없을 때만. `전체 (기본)` 하나와, 서버 ready 목록에서 뽑은 WP 를 최대 3개까지
       선택지로 낸다. 목록은 `dflow.sh list --scope assigned` 의 `RD` 행마다 show 한 `external_ref` 의 TSK 번호
       첫 칸(`TSK-02-05` → `WP-02`)이며, 조회가 실패하면 `전체 (기본)` 과 "Other 로 직접 적는다" 만 둔다.
       `multiSelect` 로 묻는다. `전체` 를 함께 고르면 전체로 본다.
    모델은 묻지 않는다. 기본 모델로 도는 것이 통상이고, 질문이 많으면 답이 늦어지기 때문이다.
  - 답으로 받은 종료 시각이 여전히 틀리면 한 번만 더 묻고, 그래도 맞지 않으면 아래 사용법을 출력하고 끝낸다.
  ```
  사용법: /dflow-team [인원] <종료시각|종료 요청 전까지> [모델] [effort] [WP-XX…]
         예) /dflow-team 18:00 · /dflow-team 4명 3일 뒤 06:00까지 opus · /dflow-team 종료 요청 전까지 WP-02
         자세한 안내: /dflow-team help
  ```
  종료 시각이 지나면 새 배정을 멈추고, 진행 중인 팀원은 대기 상한까지 기다린 뒤 남은 것을 목록으로 보고한다
  (「7. 마감」).
  - **실행 중 연장**: 사람이 팀장 세션에 "내일 9시까지 연장" 처럼 말하면 새 종료 시각을 위 표와 같은 규칙(날짜
    절대화, 7일 이내, 지난 시각이면 묻기)으로 정규화해 `<UNTIL>`·`<UNTIL_LABEL>` 을 바꾸고 아래를 차례로 한다.
    1. `team.extend`(until, until_label)를 기록한다(events.md). **`team.start` 를 새로 쓰지 않는다.** 재구성은
       마지막 `team.start` 이후만 읽으므로, 새로 쓰면 그 앞의 슬롯·제외 목록·답 대기가 사라진다.
    2. 떠 있는 poll 은 옛 `--until` 로 돌고 있으므로 새 `--until` 로 poll 을 다시 띄운다(재기동 조건은 「2-1」). 옛
       poll 이 나중에 exit 8 로 끝나도 「2-3」 표의 poll exit 8 행이 지금 `<UNTIL>` 과 대조해 무시한다.
    3. 좌석표에 새 `--until '<UNTIL_LABEL>'` 로 watch 를 보낸다(「2-3」 블록).
    4. 새 `<UNTIL>` 이 오늘이 아니거나 `none` 이고 macOS 인데 절전 방지가 떠 있지 않으면 「1. 시작」 6번대로 띄운다.
    5. **마감 중에 연장하면 마감을 취소한다.** 「7. 마감」 2번의 기다림 중이면 기다림을 끝내고 평소 기상 절차로
       돌아가 poll 을 다시 띄운다. 3번 이후(집계 보고를 낸 뒤)면 이미 끝난 실행이므로 `/dflow-team` 을 새로
       시작하라고 안내한다(재구성이 살아 있는 팀원을 흡수한다).
    "연장했습니다: <절대 시각>" 을 한 줄 알린다.
- **여러 날·무기한 실행**(`<UNTIL>` 이 오늘이 아니거나 `none`): 시작 보고에 "팀원은 권한 확인 생략 모드로 무인으로
  돕니다. 답을 기다리는 팀원은 사람이 답할 때까지 슬롯을 잡습니다." 를 한 줄 더 적는다. macOS 면 절전 방지를
  건다(「1. 시작」 6번). 서버(Linux)와 Windows 는 절전 방지를 걸지 않는다. 서버는 절전하지 않고, 절전하는 PC 라면
  사람이 전원 설정으로 막는다.
- 인원은 동시 팀원 슬롯 수다. **기본 3, 하드 상한 6.** 6 을 넘기면 6 으로 자르고 그 사실을 한 줄 알린다.
  슬롯마다 독립 메인 에이전트가 떠서 비용과 사용량 한도 소모가 빠르게 늘기 때문이다.
- **도커 금지 인원 기준: 인원이 4명 이상이면 팀원의 도커 실행을 금지한다.** 이 기준값을 정하는 곳은 이 줄
  하나다. 6 으로 자른 뒤의 인원으로 판정해 `<NO_DOCKER>` 를 `1`(기준 이상) 또는 `0` 으로 정하고, 모든 포인터(새 작업·
  재개·재시작·해소)에 `NO_DOCKER=<NO_DOCKER>` 로 싣는다(「5. 팀원 spawn」 4번). 압축 뒤에는 `team.start` 의 `slots` 로
  다시 구한다. 켜졌으면 시작 보고에 "도커 금지: 켜짐(인원 <N>명)" 을 한 줄 적는다. 워커가 무엇을 빼고 어떻게 보고하는지는
  dev-discipline.md 「도커 사용 규칙」 이 정본이다. 인원과 무관하게 켜는 스위치는 `.dflow`·`.dflow.local` 의
  `no_docker=1` 이며 워커가 스스로 읽는다. 이유: 2026-09-24 dmes-standard 에서 팀원 6명이 Testcontainers(MSSQL)를
  동시에 돌려 RAM 16GB 장비가 스왑 17GB·load 52 까지 밀렸다. 이 기준은 팀장 하나 단위라, 한 PC 에서 팀장 둘이 3명씩
  돌리면 걸리지 않는다. 그때는 설정 키를 쓴다.
- 모델은 선택이다(`opus`|`sonnet`). 없으면 포인터에 `MODEL=default` 를 넘겨 기본 모델을 쓴다. 값은 팀원이
  `/dflow-dev --model` 로 넘기고, tmux 백엔드는 팀원을 띄우는 `.dflow-run` 의 `claude --model` 에도 붙인다.
- **추론 강도(effort)는 기본 `high` 다**(2026-09-23 사용자 지시). 사람이 `effort xhigh`·`추론 강도 max` 처럼 요청할 때만
  바꾼다. 값은 `low`|`medium`|`high`|`xhigh`|`max` 중 하나이고, 그 밖의 값이면 한 줄 알리고 `high` 를 쓴다. 정한 값을
  `<EFFORT>` 로 기억한다. tmux 백엔드는 `.dflow-run` 의 `claude` 호출에 `--effort <EFFORT>` 를 붙인다(backends.md).
  기본값을 명시하는 이유: `.dflow-run` 이 팀장 세션의 `CLAUDE_EFFORT` 를 벗기므로, 플래그가 없으면 팀원은 PC 마다
  다른 `effortLevel` 설정을 따른다. Orca 백엔드는 `orca worktree create --agent claude` 에 플래그를 넘길 길이 없어
  그 PC 의 `~/.claude/settings.json` `effortLevel` 을 따른다. Orca 로 돌리면서 기본값이 아닌 값을 요청받았으면 그
  사실을 한 줄 알린다. 묻지 않는다(모델과 같은 이유).
- **재개 인자 `--resume <id8>[ <id8>…]`** 는 선택이다. 자연어로 "443b8ffe 재개" 라고 써도 같게 해석한다. 이 인자가
  없어도 이 PC 에 남아 있는 중단된 팀원 워크트리는 자동으로 이어받는다(「팀장 상태」 고아 스캔의 "재개 가능"
  분류). `--resume` 은 자동 판정이 닿지 않는 자리, 곧 **워크트리가 이 PC 에 없거나 다른 PC 가 claim 한 작업**을
  사람이 손으로 지목해 이어받게 한다(「5-1. 재개 spawn」). 지목한 id8 은 자동 판정의 거부 사유(재시도 상한 초과,
  `claimed_by` 불일치)를 무시하고 진행하며, 띄우기 전에 무엇이 남아 있고 무엇을 잃는지 한 줄로 보고한다.
- **WP 범위 `WP-XX`** 는 선택이다. 여럿이면 공백이나 쉼표로 적고, 모듈이 여럿인 프로젝트에서 한 모듈로 좁히려면
  `dict/WP-02` 처럼 모듈을 앞에 붙인다. 자연어로 "2번 WP만" 이라고 써도 `WP-02` 로 해석한다. 없으면 전체다.
  이 범위는 **새 배정만** 좁힌다. poll 이 `--wp` 로 그 WP 의 Task 만 돌려준다(「2-1」). 판정 기준은 `external_ref`
  의 TSK 번호 첫 칸이다(`dict/TSK-02-05` → `WP-02`). WBS ID 규칙상 Task ID 의 첫 칸이 WP 번호이기 때문이다(3단계
  `TSK-XX-YY`, 4단계 `TSK-XX-YY-ZZ` 모두). 재개(「5-1. 재개 spawn」)·「이어서 시작」 요청·승인 스윕은 범위와
  무관하게 그대로 한다. 이유: 그 작업들은 이미 claim 됐거나 끝난 것이라, 범위 밖이라고 두면 서버에 점유만
  남는다. 범위 안의 작업이 범위 밖 선행을 기다리면 워커가 `skipped` 로 끝내고 일시 제외되는 것은 지금과 같다.
  범위는 `team.start` 의 `wp` 에 남긴다(「1. 시작」 5번). 컨텍스트 압축 뒤 poll 을 다시 띄울 때 그 값으로 복원한다.
- poll 조회 주기는 180초(3분)로 고정하고, 일시 제외는 `--recheck-cycles 10`(10주기 = 30분)으로 유지한다. 이유: 조회는
  셸 프로세스의 `curl` 이라 토큰을 쓰지 않으므로 발견만 빨라진다. 주기만 줄이면 일시 제외가 빨리 풀려 팀장 기상(토큰)이
  늘므로, 주기 수를 함께 늘려 유지 시간을 30분으로 둔다.
- **자동 머지 `automerge=1`**(`.dflow.local`, 개인 설정, 기본 0. 레거시는 `.env` 의 `DFLOW_AUTOMERGE=1`): 켜면
  팀원이 완료 보고(`done`)를 하는 즉시 팀장이 그
  agent 브랜치를 기본 브랜치에 머지하고 다음 Task 를 착수한다. **승인은 사후 확인이다.** 스윕이 `/dflow-merge --on-report`
  로 돌며(「4. 승인 스윕」), 승인 전에 머지한 작업은 state.json 에 `phase: "merged"` 와 `unapproved: true` 를 남긴다.
  나중에 사람이 승인하면 다음 스윕이 표식만 지우고, 반려하면 "반려(머지됨)" 으로 보고한다(되돌리기는 사람이 고른다).
  꺼져 있으면 종전대로 approved 만 머지하며, 승인 대기인 선행의 후속은 승인·머지 뒤에야 풀린다.
  인자가 아니라 설정으로 받는 이유: 컨텍스트 압축 뒤에도 스윕마다 같은 값을 다시 읽어야 하고, 사람마다 정하는
  운영 정책이라 실행마다 다르게 줄 일이 아니다. 값은 스윕마다 아래로 읽는다.
  ```bash
  [ "$(.claude/skills/dflow-work/scripts/dflow.sh config automerge)" = 1 ] && echo AUTOMERGE_ON || echo AUTOMERGE_OFF
  ```
  켜는 이유: 의존 사슬이 있는 WBS 에서 선행이 승인될 때까지 후속이 착수하지 못하면, 사람이 Task 마다 승인해야
  진척된다(2026-09-19 mdm-dict-v2 실측: 팀원 4명 중 3명이 `skipped 선행 승인 대기`). 대가는 사람이 보기 전에
  에이전트 코드가 기본 브랜치에 들어간다는 것이며, 반려가 나면 기본 브랜치에서 되돌리거나 그 위에 고친다.
- 작업을 빼는 인자는 없다. 특정 작업을 잡지 않게 하려면 D'Flow 에서 그 작업의 `agent` 태그를 끈다. 팀장
  내부의 제외 목록은 그대로 있다.

## 팀장 상태: 메모리는 캐시다

팀장이 다루는 상태는 슬롯 표(슬롯 번호, `AGENT_ID`, TSK, id8, 워크트리 경로, 터미널 핸들 또는 pane id,
시작 시각, 직전 생존 증거), 대기 큐(ready 인데 슬롯이 없어 아직 못 준 id8), 영구 제외
목록(failed·반려·진행 중), 일시 제외 목록(선행·spec 사유), 답을 기다리는 `blocked` 작업, 결과 줄 경로별
마지막 처리 해시, 차단기 상태, 감지된 백엔드다. **답을 받아 팀원 화면에 넣는 일은 한 번의 기상 안에서
끝내며 중간 상태를 남기지 않는다.** `team.answer` 는 답을 넣은 뒤에 기록하므로, 넣기 직전에 컨텍스트가
압축되면 그 답은 되살아나지 않는다. 그때는 재구성이 그 작업을 여전히 답 대기로 보고 다시 통지하므로 사람이
한 번 더 답하면 된다.
세션 메모리의 이 값들은 캐시일 뿐이며, 팀장은 **깨어날 때마다** 아래 정본에서 다시 만든다. 이유: 몇 시간 도는 세션은 컨텍스트 압축을 겪고, 요약에서
슬롯이 빠지면 `.result` 가 와도 처리되지 않는다.

**압축 뒤 첫 기상**: 요약은 절차의 정본도 아니다. 컨텍스트 압축 뒤 첫 기상에서는 행동하기 전에 이 파일의
「2. 기상과 감시」「3. 결과 처리」「6. blocked」「7. 마감」 과 `references/events.md`, `references/restart.md`(전부), `references/merge-conflict.md`, `references/backends.md` 의
「고아 정리 규칙」 을 Bash `cat` 으로 다시 읽고(심링크 배포 리포에서 Read 는 작업 디렉터리 밖 읽기 확인을
부른다), `<host>` 도 기억이 아니라 「1. 시작」 의 명령으로 다시 구한다. 이유:
요약에서 빠진 규칙(이벤트의 추가 필드, `parked` 표시, host 슬러그와 `host` 필드의 차이)은 기억으로 메워지지
않으며, 그렇게 기록한 줄은 다음 재구성이 읽지 못한다.

이 절의 접두는 모두 `<신원>/<host>/` 로 시작한다. 이유: 같은 신원이 다른 PC 에서 띄운 팀장의 워크트리를 이
팀장이 자기 것으로 읽지 않게 한다.

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
- `FAIL TASKS_DIRS`: `config tasks-dirs` 가 실패하거나(exit≠0) 빈 값을 내면 재구성을 멈춘다. 계속 진행하면
  `dirs` 가 빈 줄 하나가 되어 `find "$w/$dd"` 가 `find "$w/"` 로 풀려(빈 `$dd`), 워크트리 루트 두 단계 아래
  전부를 훑는 사고로 번진다 — 엉뚱한 파일을 `.result` 로 오판할 수 있다.
- 루트 `.dflow-agent` 값이 `<신원>/<host>/w` 로 시작하는 워크트리가 팀원 워크트리이고, 값의 슬롯 번호가 그
  워크트리의 슬롯이다. 값이 `<신원>/<host>/parked` 인 워크트리는 슬롯이 아니며 고아 스캔만 본다.
- 그 워크트리 안의 `<TASKS>/*/.result` 가 팀원의 결과다.
- 그 워크트리의 브랜치 이름 `agent/<id8>-…`(있으면)과 워크트리 이름 `dflow-<id8>`(두 백엔드 공통)이 작업을
  알려 준다.
- tmux 백엔드의 `.dflow-pane`(팀장이 spawn 때 쓴 pane id, backends.md)이 팀원 pane 의 생존을 알려 준다.
  마지막 칸이 `alive` 면 살아 있고, `dead` 면 죽었거나 pane 이 사라졌으며, `-` 면 Orca 팀원이다. 빈 출력과
  `1` 을 함께 `dead` 로 보는 이유: `remain-on-exit` 를 놓친 pane 은 흔적 없이 사라지는데, 그 팀원도 끝난 것이다.

**보조**: `~/.dflow/events.jsonl` 에서 마지막 `team.start` 이후이고 `agent` 가 `<신원>/<host>/lead`, `repo` 가
이 리포(`<MAIN>`)인 줄.
```bash
jq -c --arg a '<신원>/<host>/lead' --arg r '<MAIN>' 'select(.agent == $a and .repo == $r)' ~/.dflow/events.jsonl 2>/dev/null \
  | awk '/"event":"team.start"/{buf=""} {buf=buf $0 "\n"} END{printf "%s", buf}'
```
- 첫 줄 `team.start` 의 `wp` 가 이번 실행의 WP 범위다(`-` 면 전체). poll 을 다시 띄울 때 `--wp` 에 그대로 넘긴다.
  이 필드가 없는 옛 줄은 전체로 읽는다.
- 종료 시각(`<UNTIL>`·`<UNTIL_LABEL>`)은 **마지막 `team.extend`** 의 `until`·`until_label` 이고, 없으면 `team.start` 의
  `until` 이다. 이유: 실행 중 연장(「인자」)을 모르고 `team.start` 의 옛 시각으로 복원하면 곧바로 마감으로 간다
  (2026-09-19 mdm-dict-v2: 23:00 → 다음 날 09:00 연장).
- `team.spawn` 의 `slot`·`id8`·`worktree`·`handle` 로 슬롯과 작업을 잇는다. 아직 브랜치를 만들지 않은 Phase 01
  의 팀원도 이것으로 id8 을 안다.
- `spawn_kind` 가 `resolve` 인 `team.spawn` 도 같게 잇는다. 해소 워커다(「5-2. 해소 spawn」). 워크트리는
  `<MAIN>/.claude/worktrees/dflow-<id8>-resolve`(Orca 는 `<MAIN>/dflow-<id8>-resolve`)이고 detached 라 브랜치가 없다.
  **해소 워커 판별은 워크트리 이름 접미사 `-resolve` 로 한다**(4번 재기록이 `spawn_kind` 를 `readopt` 로 덮으므로,
  `spawn_kind` 만 보면 팀장을 다시 띄운 뒤 해소 워커를 잃는다. `merge-conflict.md` 「0」). 결과는 `references/merge-conflict.md`
  「4. 해소 결과 처리」 표로 처리한다. 고아 스캔에서는 backends.md 「고아 정리 규칙」 2-1번으로 가르며 "재개 가능" 으로
  보내지 않는다. 워커 자동 재시작(H)의 대상도 아니다.
- `team.result`·`team.blocked` 로 이미 판정한 작업, 제외 목록(`skipped` 는 일시, `failed`·`failed no-result`·
  `failed not-isolated`·`failed no-worker-flag`·`failed deps`·`failed not-assignee`·`cancelled`·`blocked` 는 영구, `failed rate-limit` 은 제외
  없음), 차단기 상태(끝에서부터 연속한 `failed…` 수. `failed not-assignee`·`cancelled`·해소 워커의 내용 실패(`references/merge-conflict.md` 「6. 차단기」)는 세지도 끊지도 않고 건너뛴다. `team.lost` 는 `cause` 와 무관하게 실패 1건으로 센다. 단 `next=wait` 인 `team.lost` 는 세지도 끊지도 않는다), 결과 줄 경로별 마지막 처리 해시(경로는
  `<worktree>/<TASKS>/<tsk>/.result`)를 복원한다.
- 제외 목록은 id8 마다 마지막 `team.spawn`·`team.blocked`·`team.result` 로 정한다. 마지막이 `team.spawn` 이나
  `team.blocked` 면 진행 중(영구 제외)이고, `team.result` 면 위 status 별 제외다. `team.answer` 는 제외를 바꾸지
  않는다. 이유: 일시 제외가 풀려 다시 띄운 작업이 옛 `skipped` 로 다시 일시 제외되거나, 결과가 난 작업이 진행
  중으로 남지 않게 한다.
- **`team.lost`**: id8 의 마지막 이벤트(`team.spawn`·`team.blocked`·`team.result`·`team.lost` 중)가 `team.lost` 면 영구 제외
  (진행 중)다. 재시작 대기 목록·rate-limit 대기·보류는 `references/restart.md` 「이벤트로 본 상태」 블록으로 복원한다.
  이 블록은 `team.start` 로 자르지 않는다.
- `team.blocked` 중 그 뒤에 같은 id8 의 `team.answer` 가 없는 것이 답을 기다리는 질문이다. 두 백엔드
  공통이다.
- `team.issue` 중 id8 마다 **마지막** 것의 `decision` 이 `pending` 인 것이 아직 지시를 보내지 않은 이슈다
  (「2-4. 팀원 이슈 보고 처리」). 압축 뒤 첫 기상에서 이 목록을 복원해 곧바로 2·3번(판단·추가 지시)을
  마무리한다 — 사람에게 넘긴 채 잊지 않는다.

**재구성 규칙**
- 살아 있는 팀원의 워크트리는 그 `.dflow-agent` 슬롯 번호로 슬롯 표에 흡수한다. 그 안에 `.result` 가 있으면
  처리 여부를 해시로 가린 뒤 처리한다(「3. 결과 처리」).
- 새로 줄 슬롯 번호는 흡수한 번호를 뺀 1..N 중 가장 작은 것이다. 이유: 살아 있는 팀원과 같은 `AGENT_ID` 를
  다시 발급하면 좌석표가 한 인물을 두 책상에 그린다.
- "살아 있는 팀원" 은 spawn 했고 아직 최종 판정(`done`·`needs-merge`·`skipped`·`failed`·`cancelled`·`resolved`)을 받지 않은 팀원이다.
  화면이 떠 있는지로 판단하지 않는다. Orca 는 `.dflow-agent` 가 `w<slot>` 인 워크트리 중 최종 status 의
  `.result` 가 없는 것이며, tmux 는 거기에 더해 정본 표의 생존 칸이 `alive` 여야 한다. `blocked` 는 최종
  판정이 아니므로 그 팀원은 두 백엔드 모두 살아 있다. 실제로 죽은 Orca 팀원은 무응답 규칙(「3. 결과 처리」)이
  가려낸다. tmux pane 이 죽었으면(`dead`) 살아 있지 않으며, `.result` 가 있으면 결과 처리로, 없으면 죽은 pane
  화면 폴백과 고아 스캔으로 간다(「3. 결과 처리」). 팀장 세션이 새로 떠도 살아 있는 tmux 팀원은 원래 슬롯
  번호로 흡수한다. tmux 서버가 팀장과 독립해 돌아 팀장이 죽어도 팀원이 계속 돌기 때문이다.
- 대기 큐는 재구성하지 않는다. 비어 있어도 다음 poll 이 같은 ready 를 다시 찾는다. `blocked` 작업은 대기
  큐에 넣지 않는다. 그 팀원이 슬롯을 계속 잡은 채 자기 화면에서 답을 기다리기 때문이다.
- **결과 중복 방지**: 결과 줄은 그 줄의 해시로 식별한다. `.result` 경로마다 events.jsonl 의 `team.result`·
  `team.blocked` 에서 마지막으로 처리한 해시(경로별 마지막 처리 해시)를 유도하고, 현재 줄의 해시와 비교해
  해시가 다를 때만 처리한다. 이유: 보존된 `blocked` 워크트리의 같은 질문이 재구성마다 다시 통지되거나 같은
  결과가 두 번 처리되지 않게 하고, 답을 받은 pane 팀원이 새 질문으로 다시 `blocked` 가 되면 그것은 놓치지
  않게 한다. 집계는 order 로 중복을 없앤다. 줄과 해시는 한 번의 Bash 호출로 함께 읽는다.
  ```bash
  l=$(head -n 1 '<경로>'); printf '%s\n' "$l"; printf '%s\n' "$l" | cksum | cut -d' ' -f1
  ```
- **고아 스캔**: 값이 `<신원>/<host>/` 로 시작하는 `.dflow-agent` 워크트리(`parked` 포함) 중 살아 있는 팀원이
  없는 것을 **정리 가능·재개 가능·멈춤** 셋으로 가른다. 판정 순서는 정리 → 재개 → 멈춤이며, 앞의 갈래에
  걸리지 않은 것이 뒤로 간다.
  1. **정리 가능**: backends.md 「고아 정리 규칙」 대로 깨끗하고(미커밋 변경 없음) HEAD 가 `origin/<그 브랜치>`
     와 같다. 그 규칙대로 지운다. 산출물이 이미 원격에 있어 잃을 것이 없다.
  2. **재개 가능**: 아래가 모두 참이다. 「5-1. 재개 spawn」 의 대상이며 `.dflow-agent` 를 `parked` 로 바꾸지
     **않는다**.
     - 브랜치가 `agent/<id8>-…` 이다(id8 을 여기서 얻는다). 브랜치가 없으면 claim 전에 죽은 것이라 재개할
       산출물이 없다.
     - `.result` 가 없거나, 있어도 status 가 최종 판정(`done`·`needs-merge`·`skipped`·`failed`·`cancelled`·`resolved`)이 아니다.
       최종 판정이 있으면 재개가 아니라 「3. 결과 처리」 의 몫이다.
     - 서버 show 가 `status=claimed` 이고 `mine=true` 이며, `claimed_by` 를 소문자로 바꾼 값이
       `claude-<host>` 와 같거나 팀원 라벨 `<신원>/<host>/w<슬롯>` 의 가운데 칸이 `<host>` 다(이 PC 가 claim 했다).
     - 그 id8 의 재개 재시도가 상한(3)에 닿지 않았다.
     - 그 id8 이 `references/restart.md` 「이벤트로 본 상태」 에서 `PARKED`·`RL_WAIT`·`RL_DUE` 가 아니다. 이유: 자동
       재시작이 멈춤으로 내린 작업(`park`)과 한도 대기 중인 작업을 팀장을 다시 띄울 때마다 되살리지 않는다.
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
     이어받은 슬롯의 재기록(`readopt`)은 세지 않는다. 세면 팀장을 다시 띄울 때마다 멀쩡한 팀원의 재기록이
     재시도로 잡혀 상한에 금방 닿는다. `team.start` 로 구간을 자르지는 않는다.
     이유: 재개가 매번 실패하는 작업이 팀장을 다시 띄울 때마다 슬롯을 먹는 것을 막아야 하는데, 그 반복은
     세션을 넘어서 일어난다. 별도 카운터 파일을 두지 않는 이유는 새 저장소를 만들지 않기 위해서다.
     결과 줄이 하나라도 나오면 `skipped` 여도 수가 0 으로 돌아가는 것은 **의도한 것이다.** 이 상한이 겨냥하는
     것은 결과를 남기지 못하고 거듭 죽는 경우이며, 판정을 남기고 끝난 작업은 그 status 의 제외 규칙이 이미
     다룬다.
  3. **멈춤**: 나머지다. 자동으로 지우지 않고 `.dflow-agent` 값을 `<신원>/<host>/parked` 로 바꾼 뒤(「고아 정리
     규칙」 3번) **"멈춤" 목록**에 넣는다. 이유: 남긴 워크트리가 `w<slot>` 값을 그대로 가지면 그 슬롯에 새로 뜬
     팀원과 같은 슬롯 표시를 가져 재구성이 충돌한다.
- **"멈춤" 보고**: 멈춤으로 분류한 것, 서버에 claimed 인데 이 PC 어디에도 워크트리가 없는 id8(「1. 시작」 3번),
  결과가 `failed…` 이거나 무응답 자동 정리로 끝났는데 서버에 claimed 로 남은 작업(「3. 결과 처리」)을 한 표로
  낸다. 칸은 id8 · TSK · 워크트리 경로(없으면 `-`) · 브랜치 · 미커밋 파일 수 · 사유 · **재시작 명령**이다.
  사유는 `미커밋 보존`·`서버 미claim`·`다른 PC claim`·`재시도 상한`·`워크트리 없음`·`무응답`·`pane 죽음`·`rate-limit 반복`·
  `rate-limit 대기(<HH:MM>)`·`중단 표식 불일치`·`중단 표식 삭제 실패`·`거두기 실패`·`살아 있는 팀원`·`서버 <status>`·`서버 조회 실패`(`references/restart.md`), 또는 결과 줄의
  `failed <사유>` 로 적는다. `failed…` 로 끝난 작업이 자동 재개로 가지 않는 이유: 그 워크트리에는 최종 판정
  `.result` 가 있어 고아 스캔의 "재개 가능" 조건에 걸리지 않으며, 원인(권한·의존성 설치·한도)을 사람이 먼저
  고쳐야 같은 자리에서 다시 죽지 않는다. 고친 뒤에는 `--resume` 이 그 워크트리를 그대로 이어받는다. 이 표는
  시작 보고와 마감 보고에 모두 낸다. 이유: 자동으로 잇지 못한 작업이 조용히 사라지면 미커밋 산출물을 안은
  워크트리가 아무도 모르는 채 남는다.
  재시작 명령은 갈래마다 아래 중 하나를 그대로 적어 사람이 복사해 쓸 수 있게 한다.
  - 팀장에게 맡긴다: `/dflow-team <종료시각> --resume <id8>`
  - 사람이 그 워크트리에서 직접 한다(워크트리가 있을 때):
    ```bash
    printf '%s\n' '<신원>/<host>/w<slot>' > <워크트리>/.dflow-agent   # parked 를 되돌린다
    cd <워크트리> && claude   # 그 세션에서 /dflow-dev <TSK>
    ```
    `.dflow-agent` 를 먼저 되돌리는 이유: `dflow.sh heartbeat` 는 값이 `*/parked` 면 exit 2 로 거부하므로,
    `parked` 인 채로 재개하면 그 세션은 좌석표에 진척을 알리지 못한다. `<slot>` 은 `.dflow-prompt` 의
    `AGENT_ID=` 에 박혀 있는 번호다.
- **부트스트랩 실패 정리**(해소 워크트리 `dflow-<id8>-resolve` 는 예외 — 「고아 정리 규칙」 2-1번): `.result` 의 branch 가 `-`(브랜치를 만들기 전에 끝남)이면 backends.md
  「고아 정리 규칙」 1번대로, 알려진 부산물만 있을 때만 `--force` 로 정리하고 그 밖의 변경이 있으면 보존하고
  보고한다. 이유: 브랜치가 없어도 워커가 무언가를 고쳤다면 그것은 사람이 판단할 산출물이다.
- state.json 미러 같은 새 저장소는 만들지 않는다. 정본(서버·원격 agent 브랜치·워크트리)과 따로 도는 저장소는
  동기화 규칙을 계속 맞춰야 하기 때문이다.

## 두 번째 팀장 (링크드 워크트리)

같은 리포에서 **다른 신원(다른 PAT)** 의 팀장을 하나 더 돌릴 때는 리포를 다시 clone 하지 않고 링크드 워크트리를
쓴다. 주 체크아웃 루트에서 아래를 실행한다.
```bash
.claude/skills/dflow-team/scripts/lead-worktree.sh <이름>
```
- 스크립트는 `<주 체크아웃>/.claude/worktrees/lead-<이름>` 을 개발 브랜치(`dflow.sh branch dev`)에서 detached 로
  만들고, `.claude/skills` 를 주 체크아웃의 것으로 링크한다. 새 방식이면 주 체크아웃의 `.dflow.local` 을 `as`
  줄을 빼고 복사하고(값은 출력하지 않는다), 커밋되지 않은 `.dflow` 는 링크한다. 레거시는 `.env` 를 `DFLOW_AS` 줄은 빼고
  복사한다. 줄을 빼는 이유: 그 줄은 주 체크아웃 팀장의 키라서, 따라가면 이 워크트리의 키 판정이 묻지
  않고 같은 신원으로 넘어가 `SAME_IDENTITY_LEAD` 에 걸린다.
- 사람은 그 워크트리에서 `claude` 를 띄워 `/dflow-team …` 을 실행한다. 키는 그 실행의 키 판정(「인자」)이 정한다.
  다른 워크트리의 팀장이 쓰는 신원을 후보에서 빼고, 남은 키가 하나면 자동으로 고르고 둘 이상이면 물은 뒤 그
  워크트리의 `.dflow.local`(레거시 `.env`)에 `as`(레거시 `DFLOW_AS`)로 적는다. 미리 정하려면 그 파일에
  `as=<prefix>`(레거시 `DFLOW_AS=<prefix>`)를 직접 적는다.
- `.dflow.local`(레거시 `.env`)을 링크하지 않고 복사하는 이유: 두 팀장이 서로 다른 키를 써야 하는데, 링크하면
  한쪽의 키 변경이 도는 다른 팀장과 그 팀원에게 번진다. 팀원 워크트리의 `.dflow.local`(레거시 `.env`) 링크는
  팀장 체크아웃(`<MAIN>`)의 것을 가리키므로 두 번째 팀장의 팀원은 그 워크트리의 것을 쓴다.
- 팀장 워크트리에는 `node_modules` 를 설치하지 않는다. 팀장은 테스트를 돌리지 않는다. 팀원은 `/dflow-dev
  --worker` 행 H 가 설치한다.
- 이 팀장의 `<MAIN>` 은 그 워크트리 경로다. 잠금·종료 파일·poll 디렉터리(`git rev-parse --git-path`)가 워크트리마다
  따로 풀리고, events.jsonl 의 `repo` 도 달라지므로 두 팀장의 상태는 섞이지 않는다. 공유하는 것은
  `info/exclude`(넣는 패턴이 같다)와 로컬 브랜치 저장소, 그리고 `git worktree list` 다.
- 같은 신원으로는 두 번째 팀장을 띄울 수 없다(`SAME_IDENTITY_LEAD`, 「1. 시작」).
- 다 쓴 팀장 워크트리는 마감한 뒤 `git worktree remove .claude/worktrees/lead-<이름>` 으로 지운다. `.dflow.local`
  (레거시 `.env`) 복사본이 미추적 파일이라 거부되면 `--force` 를 붙인다.

## 0. 환경 감지 (시작 맨 처음)

백엔드는 Orca 를 **먼저** 보고, Orca 안이 아니면 tmux 를 본다. 이유: Orca 안에서 띄운 팀장은 팀원을 Orca 탭으로
띄워야 사람이 같은 화면에서 팀원을 보고 답할 수 있다. tmux 는 Orca 밖(터미널)에서 띄운 팀장의 백엔드다.
`TMUX` 환경변수는 감지에 쓰지 않는다. 전용 소켓을 쓰므로 팀장이 tmux 안인지가 무의미하고, Orca 안에서도
`TMUX` 가 채워져 오진의 근원이었기 때문이다.

| 순위 | 조건 | 백엔드 |
|---|---|---|
| 1 | `TERM_PROGRAM` 이 `Orca` 이거나 `ORCA_WORKTREE_ID` 가 비어 있지 않다 | **pane(Orca)** |
| 2 | Orca 밖이고 `find_tmux`(backends.md 「진짜 tmux 찾기」)가 진짜 tmux 절대경로를 돌려준다 | pane(tmux) |
| 3 | 그 밖 | `FAIL NO_TMUX` 로 중단하고 설치를 안내한다 |

감지는 「1. 시작」 전제 검사 블록 안에서 한 번에 하며, 그 블록이 `BACKEND`(`tmux` 또는 `orca`)와 `TM`(진짜
tmux 절대경로. Orca 백엔드면 빈 값)을 출력한다. 백엔드 이름은 시작 보고와 `team.start` 에 남긴다. 3번 갈래에서만 시작하지 않는다.
팀원을 대화형으로 띄울 수단이 없기 때문이다.

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
   0 이 아닌 값으로 끝나고, **exit 가 0 이 아니면 아무것도 띄우지 않고 중단·보고한다.** 이유: 실패를 출력만 하는
   검사는 읽고 넘어가면 그대로 진행된다. `<UNTIL>` 은 「인자」 에서 정규화한 종료 시각이다.
   ```bash
   fail=0; bad() { echo "FAIL $*"; fail=1; }
   MAIN=$(git rev-parse --show-toplevel); [ -z "$(git rev-parse --show-prefix)" ] || bad NOT_REPO_ROOT
   case "$MAIN" in *' '*) bad SPACE_IN_PATH ;; esac
   base=$(.claude/skills/dflow-work/scripts/dflow.sh branch dev) || bad CONFIG
   [ -n "$base" ] || bad NO_DEFAULT_BRANCH
   [ -z "$base" ] || git rev-parse -q --verify "refs/remotes/origin/$base" >/dev/null || .claude/skills/dflow-work/scripts/dflow.sh branch ensure-dev >/dev/null || bad "NO_REMOTE_DEV_BRANCH $base"
   cur=$(git branch --show-current)   # detached HEAD 면 빈 값
   [ -n "$base" ] && [ -n "$cur" ] && [ "$cur" != "$base" ] && bad "NOT_DEFAULT_BRANCH $base 또는 detached HEAD 여야 한다"
   for s in dflow-dev dflow-work dflow-poll dflow-merge dflow-team; do [ -e ".claude/skills/$s/SKILL.md" ] || bad "NO_SKILL $s"; done
   grep -q -- '--worker' .claude/skills/dflow-dev/SKILL.md || bad OLD_DFLOW_DEV
   grep -q 'origin/agent/\*' .claude/skills/dflow-merge/SKILL.md || bad OLD_DFLOW_MERGE
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
       git show "origin/$base:.claude/skills/dflow-dev/SKILL.md" 2>/dev/null | grep -q -- '--worker' || bad "KIT_NOT_PUSHED dflow-dev"
       git show "origin/$base:.claude/skills/dflow-merge/SKILL.md" 2>/dev/null | grep -q 'origin/agent/\*' || bad "KIT_NOT_PUSHED dflow-merge"
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
     { orca worktree create --help | grep -q -- '--agent' && orca worktree create --help | grep -q -- '--prompt'; } || bad ORCA_OLD
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
   - **팀장 잠금**: 잠금은 디렉터리이며 `mkdir` 로 얻는다. `mkdir` 는 원자적이라 동시에 시작한 팀장 둘 중 하나만
     성공한다. 실패한 검사가 잠금을 남기지 않도록 블록의 마지막에 둔다. 안에 `owner` 한 줄
     `<신원>/<host>/lead <시작 epoch 초> <PID>` 와 `beat`(epoch 초)를 쓴다. PID 는 팀장 세션 프로세스의 PID 로,
     Bash 도구가 환경 변수 `CLAUDE_PID` 로 내보내는 값(없으면 `$PPID`)이며 Bash 호출마다, 컨텍스트 압축 뒤에도
     같다. `$PPID` 만 쓰지 않는 이유: Windows 의 Git Bash 는 부모가 Cygwin 프로세스가 아니면 `$PPID` 를 1 로
     보고해 모든 팀장이 같은 PID 를 갖는다. Windows 에서 `CLAUDE_PID` 가 비어 있으면 `NO_CLAUDE_PID` 로
     중단한다. 이유: `$PPID` 가 1 이면 잠금 소유 판정이 모든 팀장을 같은 프로세스로 보고, 권한 확인 생략
     감지도 `Get-CimInstance` 가 PID 1 을 찾지 못해 항상 0 이 된다(러너 실측). **소유 판정**은 "`owner` 의 신원이 자기
     `<신원>/<host>/lead` 이고 PID 가 현재 `$LEAD_PID` 와 같다" 이다. 이유: 잠금은 체크아웃마다 하나라서 잠금을 가져간
     다른 팀장도 신원·host·리포가 같고, 신원만으로는 누구의 잠금인지 가려내지 못한다. 시작 시각은 `LOCKED` 안내에서
     사람이 그 팀장을 알아보게 하려고 둔다. 팀장은 매 기상 소유를 확인한 뒤에만 `beat` 를 갱신한다(「2-3」).
     `owner`·`beat` 쓰기가 실패하면 방금 만든 잠금 디렉터리를 지우고 `FAIL LOCK_WRITE` 로 끝낸다. 이유: `beat`
     없는 잠금은 만들어진 지 10분 안에는 다른 팀장의 시작을 막는데(아래), 그대로 두면 그 10분 동안 아무도
     시작하지 못한다. 방금 `mkdir` 로 만든 잠금은 다른 팀장이 건드리지 않으므로 지워도 남의 잠금이 아니다.
     기존 잠금의 `beat` 가 있고 70분(4200초)보다 새로우면 거부한다. `beat` 가 없으면 잠금 디렉터리 자체의
     수정 시각을 본다(`find "$LOCK" -maxdepth 0 -mmin +10` 가 경로를 출력하면 10분보다 오래된 것이다;
     macOS·Linux 모두에서 도는 방법이다). 10분 이내면 `mkdir` 와 `owner`·`beat` 쓰기 사이의 그 짧은 틈에 있는,
     방금 만들어지는 중인 잠금으로 보고 지금처럼 거부한다. `beat` 가 있고 70분보다 오래됐거나, `beat` 가
     없고 잠금 디렉터리가 10분보다 오래됐으면 죽은 것으로 보고 가져온다. 가져올 때는 잠금 디렉터리를 `mv`
     로 이 팀장만 아는 이름 `$LOCK.stale.$$` 로 옮기고, 옮긴 디렉터리를 같은 기준(옮기기 전 본 것이 `beat`
     였으면 `beat` 를, 잠금 디렉터리 수정 시각이었으면 옮긴 디렉터리의 수정 시각을)으로 다시 재어 여전히
     오래됐을 때만 지운 뒤 `mkdir` 로 다시 얻는다. 옮긴 잠금이 새로우면 그사이 다른
     팀장이 가져간 것이므로 옮긴 경로를 알리며 거부하고 사람이 되돌리게 한다. `mv` 나 다시 하는 `mkdir` 가
     실패해도 다른 팀장이 먼저 가져간 것이므로 거부한다. 이유: 다시 잰 시각이 여전히 오래됐음을 확인한 뒤
     지우기 전에 다른 팀장이 먼저 가져가면 그 잠금까지 지우게 되는데, 옮긴 디렉터리는 이 팀장만 보므로 확인과
     삭제 사이에 끼어들 틈이 없다. `LOCKED` 로 거부할 때는 잠금 경로·
     `owner`·`beat` 시각과 함께 "그 팀장이 끝난 것이 확실하면 잠금 디렉터리를 지우고 다시 시작하라" 를 안내한다.
     질문하지 않고 중단한다(AskUserQuestion 을 쓰지 않는다).
     세션이 죽은 직후 재기동하면 `beat` 가 아직 새롭기 때문이다. 이유: 한 체크아웃의 팀장 둘은 슬롯 번호·세대
     파일·승인 스윕을 서로 덮어쓴다. 생존(가져와도 되는지)은 PID 가 아니라 `beat`(없으면 잠금 디렉터리 수정
     시각)로 본다. 이유: 세션 프로세스가
     살아 있어도 권한 확인 등에 멈춘 팀장은 기상하지 않아 제 몫을 못 하는데, `beat` 는 그 멈춤까지 드러낸다.
     살아 있는 팀장은 늦어도 `TICK`(30분)마다 깨어 `beat` 를 갱신하므로, 70분이면 두 `TICK` 을 연속으로 놓친 것이다.
   - **팀장 lease**: 로컬 잠금은 같은 리포의 워크트리끼리만 본다. 같은 신원이 **다른 clone·다른 PC** 에서 같은
     프로젝트의 팀장을 띄우는 것은 서버 lease 가 막는다(스펙 wbs-web docs/superpowers/specs/2026-09-23-dflow-lead-lease-design.md).
     로컬 잠금을 잡은 **뒤** 얻는다. 이유: 같은 리포의 두 팀장이 동시에 서버에 가서 같은 holder 로 서로를
     밀어내지 않게, 로컬 경합을 먼저 끝낸다. 결과별 처리:
     - `LEASE_OK <n>`: 계속한다.
     - `LEAD_LEASE_HELD <project_id> <host> <agent> <만료 시각>` 줄(exit 4): 잠금을 지우고 멈춘다. 줄마다 "이 프로젝트는
       `<host>` 의 `<agent>` 가 쥐고 있다(만료 `<시각>`)" 로 보고하고, "그 팀장이 이미 죽었다면 최대 3분 뒤 풀린다.
       지금 넘겨받으려면 `/dflow-team … --takeover` 또는 오피스 화면의 「팀장 해제」" 를 덧붙인다.
     - 그 밖(exit 2·3·5·6·7): 잠금을 지우고 사유를 보고하고 멈춘다. 서버에 lease 가 없는 구버전(exit 7, 404)도 여기다.
       lease 를 확인하지 못한 채 시작하지 않는다(fail-closed).
     `holder` 는 `~/.dflow/machine-id`(처음 쓸 때 만든다)와 이 체크아웃 경로로 정해진다. 같은 자리에서 다시 시작하면
     즉시 넘겨받는다.
   - `KIT_NOT_PUSHED`: `.claude/skills/dflow-dev` 가 git 추적되는 킷 복사형 리포면 `git fetch origin` 뒤
     `origin/<기본브랜치>` 의 `dflow-dev` SKILL.md 에 `--worker` 가, `dflow-merge` SKILL.md 에 원격 후보 지원
     (`origin/agent/*`)이 있어야 한다. fetch 가 실패하면 검사할 수 없으므로 실패로 친다. 이유: 팀원 워크트리는
     `origin/<기본브랜치>` 에서 만들어지거나 그리로 detach 해서 그 커밋의 스킬을 쓴다. 킷을 설치·커밋만 하고
     push 하지 않으면 작업트리 검사(`OLD_DFLOW_DEV`)는 통과하고 팀원은 전원 `failed no-worker-flag` 로 끝난다.
     안내에 "킷 커밋을 기본 브랜치에 push 한 뒤 다시 시작하라" 를 넣는다. 심링크 배포 리포는 워커가 메인
     체크아웃의 스킬을 링크하므로 이 검사를 하지 않는다. 판정 대상을 `.claude/skills` 전체가 아니라
     `dflow-dev` 로 좁히는 이유: 일반 스킬만 커밋하고 `dflow-*` 는 심링크로 둔 리포가 있다. 그런 리포를
     킷 복사형으로 읽으면 원격에 없는 `dflow-dev` 를 찾다가 `KIT_NOT_PUSHED` 로 오탐한다(2026-09-23 dmes-standard).
   - `NO_PROJECT`: `.dflow` 의 `project_id` 또는 `.dflow.local` 의 `project_map`(레거시 `.env` 의
     `DFLOW_PROJECT_ID`·`DFLOW_PROJECT_MAP`)에 리포 ↔ D'Flow 프로젝트 바인딩이 없으면
     시작을 거부한다. 이유: 서버의 작업 목록(`/work/mine`)은 PAT 주인이 속한 **모든 프로젝트**의 주문을 돌려준다.
     `dflow.sh list` 가 바인딩으로 거르고(poll·"멈춤" 재구성 모두 이 목록을 쓴다) `dflow.sh claim` 이 바인딩 밖
     주문을 `PROJECT_MISMATCH` 로 거부하는데, 바인딩이 없으면 거를 기준이 없어 다른 프로젝트의 작업을 이 리포에서
     개발하게 된다. 같은 모듈 이름·같은 TSK 번호 체계를 쓰는 프로젝트끼리는 겉으로 드러나지도 않는다.
   - `CONFIG`: `dflow.sh config --source` 가 실패하면(`.dflow`·`.dflow.local`·레거시 `.env` 어느 것도 읽지 못했거나
     설정에 문제가 있으면) 시작을 거부한다. `dflow.sh` 가 stderr 에 낸 사유 코드(`NO_LOCAL`·`NO_DFLOW`·
     `NO_DEV_BRANCH`·`PERSONAL_KEY_IN_DFLOW`)대로 파일을 고친 뒤 다시 시작한다.
   - `SPACE_IN_PATH`: 메인 체크아웃 절대경로에 공백이 있으면 시작을 거부한다. 이유: 포인터 한 줄 형식과
     워커 부트스트랩의 `ln -s` 링크가 공백을 다루지 않는다.
   - `NO_DEFAULT_BRANCH`·`NOT_DEFAULT_BRANCH`: 개발 브랜치는 `dflow.sh branch dev` 로 구한다(`.dflow.local` 의
     `dev_branch`, 레거시는 `origin/HEAD`, 그 ref 가 없으면 `git ls-remote --symref origin HEAD`). 팀장 체크아웃은
     그 개발 브랜치 위에 있거나 **detached HEAD** 여야 한다. 다른 이름 있는 브랜치면 거부한다. 이유: 개발 브랜치
     위의 팀장은 그 체크아웃에서 머지하고, detached HEAD 인 팀장은 `/dflow-merge` 가 임시 머지 워크트리에서
     머지해 `HEAD:<기본브랜치>` 로 push 한다(「4. 승인 스윕」). 이름 있는 다른 브랜치를 허용하지 않는 이유는 그
     브랜치가 사람의 작업 브랜치일 수 있어, 스윕 뒤 최신으로 다시 detach 하는 일이 그 작업을 흔들기 때문이다.
     detached HEAD 를 허용하는 이유: 개발 브랜치는 워크트리 하나만 체크아웃할 수 있으므로, 같은 리포에서 두 번째
     팀장을 링크드 워크트리로 띄우려면 개발 브랜치를 잡지 않아야 한다(「두 번째 팀장」).
   - `NO_REMOTE_DEV_BRANCH`: 개발 브랜치가 원격에 없으면 먼저 `dflow.sh branch ensure-dev` 가 운영 브랜치에서 만들어
     push 한다. 그것마저 실패했을 때(운영 브랜치도 없음·push 권한 없음)만 이 항목으로 멈춘다. 이유: 팀원
     워크트리와 「4. 승인 스윕」 의 머지는 `origin/<기본브랜치>` 를 기점으로 삼으므로, 로컬에만 있는 개발
     브랜치로는 그 어느 쪽도 동작하지 않는다.
   - `SAME_IDENTITY_LEAD`: 같은 리포의 다른 워크트리에 잠금 `owner` 가 같은 `<신원>/<host>/lead` 이고 `beat` 가
     살아 있는 팀장이 있으면 거부한다. 잠금은 워크트리마다 따로 생기므로 잠금만으로는 이 경우를 막지 못한다.
     이유: 팀원 재구성과 고아 스캔은 `git worktree list` 로 리포의 모든 워크트리를 보고 `<신원>/<host>/` 접두로
     자기 팀원을 가려낸다. 같은 신원의 팀장이 둘이면 서로의 팀원을 자기 슬롯으로 흡수하고, 같은 `w<slot>` 을
     발급해 좌석표가 한 인물을 두 책상에 그리며, 「이어서 시작」 요청을 둘 다 받아 한 작업에 워커를 둘 띄운다.
     같은 신원으로 일을 나눠 돌리고 싶으면 팀장 하나에 인원과 WP 범위를 주면 된다. 두 팀장이 동시에 시작하는
     아주 짧은 틈은 막지 못한다.
   - `OLD_DFLOW_DEV`·`OLD_DFLOW_MERGE`: 수정된 기존 스킬이 적용되지 않았다. 옛 `/dflow-dev` 면 팀원이 기본
     브랜치 switch 에서 죽고, 옛 `/dflow-merge` 면 스윕이 팀원 작업을 영영 보지 못한다.
   - `AUTH`: 인증은 `dflow.sh me` 의 성공(`user_email` 이 나옴)으로 판정한다. doctor 는 진단 출력용이며 종료
     코드로 판정하지 않는다. 이유: doctor 는 토큰 인증이 실패해도 그 줄만 출력하고 0 으로 끝난다. 출력한
     `user_email` 로 `DFLOW_PATS` 첫 토큰이 이 신원의 PAT 인지 보여 주고, 그 값으로 `<신원>` 슬러그를,
     `hostname` 의 첫 점 앞부분으로 `<host>` 슬러그를 만든다(`hostname -s` 는 Windows 의 hostname.exe 에 없다).
     팀원은 `<신원>/<host>/w<slot>`, 팀장은 `<신원>/<host>/lead` 다.
   - `LEGACY_REPORTED`: `api_base` 가 없는 `phase=reported` 로컬 state.json 이 있으면 시작을 거부하고
     "수동 `/dflow-merge` 로 먼저 정리하라" 고 안내한다. 이유: 스테이징 D'Flow DB 는 운영을 복제하므로 출처를 모르는
     로컬 후보를 자동 스윕이 머지할 수 있다. 같은 작업의 원격 사본에 값이 있으면 `/dflow-merge` 가 출처를
     가려내지만(1번 로컬·원격 중복), 사본이 없거나 사본에도 값이 없으면 그 후보를 수동 규칙대로 판정하므로, 사람이
     보지 않는 루프에 그 판정을 맡기지 않는다. 이 검사는 로컬 파일만 보므로 원격 사본에 값이 있는 경우도
     거부하며, 이는 안전한 쪽으로 기운 것이다.
   - `mkdir -p ~/.dflow`: 이벤트 기록이 디렉터리 부재로 조용히 실패하지 않게 한다.
   - 공유 `info/exclude` 에 워커 부산물 패턴을 없을 때만 넣는다. 커밋하지 않는 로컬 설정이며 링크드
     워크트리가 모두 공유한다. `**/.claude/worktrees/` 는 tmux 팀원 워크트리(`dflow-<id8>`), `/dflow-*/` 는 Orca 팀원 워크트리다
     (`orca worktree create --name dflow-<id8>` 은 `.claude/worktrees/` 가 아니라 리포 루트 바로 아래에 만든다 —
     2026-09-19 mdm-dict-v2 실측. 빼면 재기동 때 `DIRTY` 에 걸린다), `.vitest/` 는 워커가 vitest 를 돌리면 남기는 결과
     파일(`.vitest/json/output.json`)이다(빼면 done 뒤 워크트리가 깨끗하지 않아 「고아 정리 규칙」 과 `orca worktree rm` 이
     실패한다. 2026-09-19 mdm-dict-v2 실측), `/.dflow-agent`·
     `**/tasks/*/.result`·`**/tasks/*/.issues`·`**/tasks/*/decisions.json` 은 워커가 쓰는 미추적 파일(decisions.json 은
     `done --decisions` 의 전송용으로, 커밋하지 않는다. 어느 `<TASKS>` 아래든 잡도록
     `docs/` 접두를 고정하지 않는다), `/docs/dflow-team/` 은 팀장이 쓰는
     문제 기록(「3. 결과 처리」 문제 기록) 폴더, `/.dflow-prompt`·`/.dflow-pane`·`/.dflow-run` 은
     팀장이 spawn 때 쓰는 미추적 파일, `/.dflow.local` 은 워크트리 부트스트랩이 거는 심링크다. `.gitignore` 가
     `.dflow.local` 을 가리기 전에도 DIRTY 를 트립하지 않게 여기 둔다. `.dflow` 는 **넣지 않는다** — 스펙 §3.1 대로
     커밋 대상이며, exclude 에 넣으면 아직 커밋되지 않은 `.dflow` 가 `git status`·`git add -A` 에서 조용히
     사라져 사람이 커밋을 잊고 다른 PC 가 `NO_DFLOW` 로 막힌다. `/.claude/skills`(끝 슬래시 없음)는 스킬 심링크다. 끝 슬래시가 붙은 패턴은 디렉터리에만 걸려 심링크를 가리지 못한다. 이 패턴은 **`.claude/skills`
     가 추적되지 않는 리포에서만** 넣는다. 스킬이 커밋된 리포에 넣으면 새로 추가하는 스킬 파일이 무시돼
     `git add` 가 거부되기 때문이다. 일반 스킬은 커밋하고 `dflow-*` 만 심링크인 리포에는 `/.claude/skills/dflow-*`
     를 넣는다. 이유: 부산물이 `/dflow-dev` Phase 06 의 "미커밋 잔여물 커밋" 에 섞이면,
     브랜치마다 다른 `.dflow-agent` 가 스윕 머지를 충돌시키고 절대경로 심링크가 main 에 들어간다.
   - `DIRTY`: exclude 를 넣은 뒤 `git status --porcelain` 이 비어 있어야 한다. 팀장 체크아웃이 더러우면 승인
     스윕이 위험하다. 실패 안내에 "미커밋 `<TASKS>/*/state.json` 은 파일명을 명시해 먼저 커밋하라(수동
     `/dflow-dev` 가 남긴 것일 수 있다)" 를 넣는다.
   - `UNTIL_BAD`·`UNTIL_PAST`·`UNTIL_TOO_FAR`: 종료 시각은 에포크 초로 비교한다(BSD `date -j` 먼저, 없으면 GNU
     `date -d`. macOS·Linux 서버 모두에서 돈다). 형식이 틀리거나, 이미 지났거나, 7일을 넘으면 거부한다. `none` 은
     검사하지 않는다. 「인자」 가 전제 검사 전에 이미 걸렀으므로 이 검사는 두 번째 방어선이다.
   - 종료 파일(`dflow-team.stop`)은 잠금을 얻은 뒤 지운다. 이유: 지난 실행에서 마감 전에 죽은 팀장이 남긴 요청이
     새 팀장을 곧바로 멈추지 않게 한다. 잠금을 얻기 전에 지우면 돌고 있는 다른 팀장에게 보낸 요청을 지우게 된다.
   - `LEGACY_REPORTED` 검사와 이 블록 전체는 bash 와 zsh 모두에서 돈다. state.json 은 glob 대신 `find` 로 찾고,
     결과를 변수로 받아 루프 밖에서 `bad` 를 부른다. 이유: zsh 는 매치 없는 glob 에서 블록 전체를 `FAIL` 줄 없이
     죽이고, bash 는 파이프 안의 `while` 을 서브셸에서 돌려 그 안에서 바꾼 `fail` 이 밖으로 나오지 않는다.
   - `ORCA_OLD`: pane(Orca)이면 `orca worktree create` 가 `--agent`·`--prompt` 를 지원해야 한다. tmux 를 찾지
     못한 Orca 환경에서만 이 갈래로 온다.
   - `NO_CLAUDE_CLI`: tmux 백엔드는 팀원을 `.dflow-run` 의 `exec claude` 로 띄우므로 `claude` 가 PATH 에 있어야
     한다. 없으면 pane 이 즉시 죽고 종료 코드 127 만 남아, 무엇이 없어서 죽었는지 화면에 남지 않는다.
   - `NO_TMUX`: tmux 도 Orca 도 없으면 시작하지 않는다. 팀원을 대화형으로 띄울 수단이 없기 때문이다. 안내에
     설치 명령을 적는다(macOS `brew install tmux`, Debian·Ubuntu `apt install tmux`, Windows 는 MSYS2 또는
     WSL). 종전의 비대화형 프로세스 백엔드(`nohup claude -p`)는 2026-09-16 에 없앴다. 사람이 권한 확인에
     답하거나 화면을 보거나 `blocked` 를 맥락을 지킨 채 풀 자리가 없었기 때문이다.
   - `find_tmux` 가 절대경로 후보를 훑는 이유: Orca 는 PATH 앞에 tmux shim 을 끼우는데, 그 shim 은 명령
     부분집합만 처리하고 `tmux -V` 에 거짓 버전을 답한다. 판별 방법은 backends.md 「진짜 tmux 찾기」 다.
2. **담당 작업 폴더 scaffold**: 팀장 체크아웃(개발 브랜치)에서 `.claude/skills/dflow-work/scripts/dflow.sh scaffold` 를
   한 번 부르고 출력 한 줄(`scaffold created=N skipped=N no_ref=N`)을 시작 보고에 싣는다. **개발 브랜치 위일 때만
   부른다** — detached HEAD 팀장(「두 번째 팀장」의 팀장 워크트리는 언제나 detached)에서 부르면 scaffold 가 만든
   `state.json` 을 커밋하지 못해(`dflow.sh scaffold` 는 개발 브랜치 위에서만 커밋한다) 작업 트리가 더러워지고,
   다음 시작이 `DIRTY` 로 막히거나 승인 스윕 뒤 재-detach 가 깨끗한 트리를 요구해 멈춘다. 아래 블록 하나로
   판정하고 부른다(1번과 다른 Bash 호출이라 그 블록의 변수는 남아 있지 않으므로 이 블록 안에서 다시 구한다).
   **scaffold 를 부르기 전에 개발 브랜치를 fast-forward 한다** — 뒤처진 로컬 dev 에서 scaffold 가 커밋하면 push 가
   거부되고(exit 0 + "push 실패 — 로컬 커밋만 남김"), 로컬과 원격 dev 가 갈라져 이후 모든 스윕의
   `git pull --ff-only origin <기본브랜치>`(`/dflow-merge`)가 사람이 rebase 할 때까지 계속 실패한다.
   fast-forward 가 실패하면(로컬에 origin 에 없는 커밋이 있어 fast-forward 가 안 되는 등) scaffold 자체를
   건너뛴다 — pull 실패를 무시하고 그냥 부르면 같은 갈라짐이 재현된다:
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
   실패(exit≠0)는 경고만 하고 계속한다 — 편의 기능이지 게이트가 아니다. 이유: 내게 배정된 작업의
   `<TASKS>/<TSK>/state.json`(phase=ready)이 개발 브랜치에 있으면 사람이 리포만 보고 할 일을 알고, 팀원
   워크트리(`origin/<기본브랜치>` 기점)에도 같은 폴더가 보인다 — 이는 팀장이 실제로 커밋해 개발 브랜치에
   반영했을 때만 참이다. **그래도 push 실패가 보고되면** 다음 승인 스윕 전에 `git pull --rebase origin <기본브랜치>`
   로 사람이 직접 되돌린다.
3. **재구성**: 새 `team.start` 를 쓰기 **전에** 「팀장 상태」 의 재구성과 고아 스캔을 한다. 이유: "마지막
   `team.start` 이후" 필터가 이전 세션의 이벤트를 가리지 않게 한다. 이 단계가 곧 재기동 절차다. 이어서
   서버에 claimed 인데 흡수한 슬롯·고아 워크트리·답을 기다리는 `blocked`·대기 중인 답 어디에도 없는 id8 을
   **"멈춤" 표(사유 `워크트리 없음`)** 에 넣고 영구 제외에 넣는다. 자동으로 재착수하지 않는다. 이유: 이 PC 에
   워크트리가 없으면 그 작업이 다른 PC 나 수동 세션에서 지금 돌고 있는 것과 구분할 수단이 없다. 생존 신호는 서버 DB 에
   쌓이지만(`last_heartbeat_at`·`heartbeat_phase` — 좌석표 화면은 이것으로 침묵을 그린다) **`show` 가 그 둘을
   내주지 않는다.** `show` 가 주는 `stale` 은 `claimed_at` 으로부터 24시간이 지났는지
   (`AGENT_CLAIM_STALE_HOURS`)일 뿐이라 이 판정에 쓸 수 없다. 사람이 `--resume <id8>` 으로 지목할 때만 이어받는다
   (「5-1. 재개 spawn」). **워크트리가 이 PC 에 남아 있는 갈래는 이 조항이 아니라 「팀장 상태」 고아 스캔의
   "재개 가능" 이 맡아 자동으로 이어받는다.** 그쪽은 `.dflow-agent` 가 이 신원·이 host 를 달고 있어 이 팀장
   계보의 워커임이 드러나므로 같은 모호함이 없다. 답을 기다리는 `blocked` 를 빼는 이유: 그 작업은 claimed 이면서 슬롯도
   잡고 있어 재개 대상이 아니다. 그 팀원은 자기 화면에서 답을 기다리는 중이고, 5번이 답 대기 목록을 이어받는다.
   ```bash
   (.claude/skills/dflow-work/scripts/dflow.sh list --scope claimed) | awk -F'\t' 'NF>=4 && $2=="CL" {print $4}'
   ```
   상태 열이 `CL` 인 행만 센다. 이유: `--scope claimed` 는 보고까지 끝난 `RP`(reported) 행도 돌려주는데, 그 작업은
   승인 대기이지 재개 대상이 아니다.
4. **시작 보고**: 3번이 만든 **"멈춤" 표**(「팀장 상태」)를 먼저 내고, 재개 가능으로 분류한 것과 `--resume`
   지목분은 "이번에 이어받습니다" 로 한 줄 알린다. 2번의 scaffold 출력 한 줄(부른 경우 `scaffold created=N
   skipped=N no_ref=N`, 건너뛴 경우 "scaffold 건너뜀(detached HEAD 또는 개발 브랜치 아님)")도 여기 싣는다.
   WP 범위가 있으면 "새 배정은 <WP 목록> 만 합니다. 재개·승인
   스윕은 범위와 무관합니다." 를 한 줄 알린다. 이어서 아래 두 줄을 알린다. 백엔드와 무관하게 "팀원은 **권한 확인 생략 모드로** 돕니다. 팀장 세션의 권한 모드와
   무관합니다." 를 알린다. tmux 백엔드면 "화면은 `TMUX= tmux -L dflow attach` 로 볼 수 있습니다." 를 한 줄 더
   알린다. 첫 줄이 중요하다. 팀장을 평소 모드로 띄운 사람도 팀원은 무제한으로 돈다는 사실이 여기서 드러나야
   하기 때문이다. `TMUX=` 를 앞에 붙이는 이유는 팀장이 이미 tmux 안일 때 중첩 attach 가 거부되기 때문이다.
   `AUTOMERGE_ON` 이면(「인자」 자동 머지) "자동 머지: 켜짐. 완료 보고된 작업은 승인 전에 main 에 머지하고, 승인은
   사후에 확인합니다." 를 한 줄 알린다. 꺼져 있으면 알리지 않는다.
   종료 시각 줄 바로 다음에 `키: <이름> (<email>, <prefix>)` 를 적는다. 토큰이 하나여도 적는다. 값은 「인자」 키 판정의
   `selected` 행이다. 이유: 어느 신원으로 도는지가 배정 목록·좌석표 신원·claim 주체를 모두 정하는데, 지금까지는
   시작 보고 어디에도 나오지 않았다.
5. `team.start`(backend, slots, until, wp)를 기록한다. `until` 은 `<UNTIL>` 이다. `wp` 는 정규화한 WP 범위를 쉼표로 이은 값이며 없으면 `-` 다. 3번에서 이어받은 것은 `team.start` 바로 뒤에 같은 필드로
   다시 기록한다: 흡수한 슬롯마다 `team.spawn`(`spawn_kind` 는 `readopt`)(원래 종류는 `orig_kind` 필드에 싣는다, `references/events.md`), 답을 기다리는 `blocked` 마다
   `team.blocked`, 흡수한 슬롯의 마지막 처리 해시마다 `team.result` 또는 `team.blocked`.
   이유: 이후 기상의 재구성은 새 `team.start` 이후만 읽으므로, 다시 기록하지 않으면
   이어받은 팀원이 살아 있지 않은 것으로 보이고 같은 결과가 다시 처리된다. 답을 기다리던 질문도 대기 목록에서 사라져 사람이 준 `<id8> <답>`
   이 매칭되지 않고, "기다리는 질문이 하나면 id8 없이 답해도 된다" 가 깨진다.
   그 다음 **승인 스윕**(「4. 승인 스윕」)을 한 번 돌고 결과(머지됨·대기·반려·건너뜀)를 한 줄씩 보고한다.
   스윕을 마친 뒤, 빈 슬롯이 있으면 재개 대상을 띄운다(「5-1. 재개 spawn」). 스윕보다 뒤에 두는 이유: 스윕이
   선행을 main 에 반영하면 재개한 워커가 기점을 다시 잡지 않아도 되기 때문이다.
6. **감시 시작**: 다음 TICK 예정 시각을 지금+1800초로 정하고 「2-2」 대로 감시 루프를 띄운다. 재기동 조건이
   맞으면 poll.sh 도 띄운다(「2-1」). 둘 다 Bash `run_in_background` 로 띄운다. 셸 `&` 는 쓰지 않는다. 종료
   알림이 세션에 오지 않아 루프가 소리 없이 끊기기 때문이다. 그 다음 좌석표에 감시 시작을 알린다. STANDBY 는
   마지막 신호 뒤 70분에 꺼지므로 시작과 매 기상마다 보낸다.
   ```bash
   LOCK=$(git rev-parse --git-path dflow-team.lock); lead=$(cut -d' ' -f1 "$LOCK/owner")
   .claude/skills/dflow-work/scripts/dflow.sh watch --agent "$lead" \
     --slots <N> --busy <M> --until '<UNTIL_LABEL>' --json || :
   ```
   **절전 방지**: `<UNTIL>` 이 오늘이 아니거나 `none` 이고 `uname -s` 가 `Darwin` 이면, 이어서 아래를 Bash
   `run_in_background` 로 띄운다. `-w` 는 팀장 세션 프로세스가 끝나면 함께 끝나게 한다. 「7. 마감」 6번이 거둔다.
   ```bash
   caffeinate -i -w <LEAD_PID>
   ```
   `-i` 는 시스템 유휴 절전만 막는다. 뚜껑을 닫으면 막지 못하므로 시작 보고에 "전원을 연결하고 뚜껑을 연 채로
   두라" 를 적는다. Linux 서버와 Windows 에서는 띄우지 않는다.
   **lease 갱신**: 이어서 아래를 Bash `run_in_background` 로 띄운다(모든 OS). 60초마다 lease 를 갱신하고,
   팀장 세션이 끝나면 lease 를 바로 반납하고 끝난다. lease 를 잃으면 표식 파일에 사유를 쓰고 끝나며, 감시 루프가
   그것을 보고 `LEASE_LOST` 로 깨운다. `<lease-lost 절대경로>` 는
   `git rev-parse --path-format=absolute --git-path dflow-team.lease-lost` 의 값을 **리터럴로** 박는다(루프와 같은 이유).
   ```bash
   .claude/skills/dflow-work/scripts/dflow.sh lease keep --pid <LEAD_PID> --lost-file '<lease-lost 절대경로>'
   ```
   이 첫 watch 응답에도 `resume_requests` 가 실려 온다. 「2-3」 의 처리 규칙대로 읽어, `host` 가 이 PC 인 요청은
   5번에서 띄우지 못한 재개 대상에 더해 지금 띄운다. 이유: 이것을 넘기면 사람이 화면에서 누른 요청이 첫
   `TICK`(최대 30분)까지 그대로 놓인다.
   `<N>` 은 「인자」 에서 정한 인원, `<M>` 은 지금 슬롯 표에서 찬 슬롯 수, `<UNTIL_LABEL>` 은 「인자」 의 표시 문자열이다.
   `--project` 는 넘기지 않는다. `dflow.sh watch` 는 설정에서 읽은 `project_id` 를 기본값으로 쓰고,
   `${V:+--project "$V"}` 꼴은 zsh 에서 한 단어로 넘어가 호출이 usage 로 끝나기 때문이다.
   신원은 `$who`·`$host` 를 다시 쓰지 않고 방금 쓴 잠금 `owner` 에서 읽는다. 이 6번이 1번과 다른 Bash 호출이라
   env 가 남아 있지 않기 때문이다.

## 2. 기상과 감시

팀장은 포그라운드로 기다리지 않는다. 팀장을 깨우는 것은 넷이다: poll.sh 종료(새 작업·시한·오류), 감시 루프
종료(팀원 결과·팀원 pane 종료·`TICK`·`STALE`·`STOP_REQUESTED`), 사람이 이 세션에 주는 답(종료 요청 포함),
팀원의 cross-session 메시지(SendMessage 이슈 보고, 「2-4. 팀원 이슈 보고 처리」). 팀원은 별도 프로세스라 이
세션에 작업 완료 알림(결과 줄)은 보내지 않지만, 이슈가 생기면 SendMessage 로 이 세션을 직접 깨울 수 있다.

### 2-1. poll

작업 폴더가 없는 빈 디렉터리를 cwd 로 두고 띄운다.
```bash
mkdir -p "$(git rev-parse --git-path dflow-team-poll)"
POLL_DIR=$(cd "$(git rev-parse --git-path dflow-team-poll)" && pwd)
( cd "$POLL_DIR" && DFLOW_CONFIG_DIR="<MAIN>" DFLOW_WATCH=0 \
    "<MAIN>/.claude/skills/dflow-poll/scripts/poll.sh" --require-tag agent --until '<UNTIL>' --interval 180 --recheck-cycles 10 \
    [--wp <WP-02,dict/WP-03>] [--exclude <id8,id8>] [--exclude-temp <id8,id8>] )
```
대괄호는 선택 플래그 표기이며 실제 명령에는 쓰지 않는다. `<MAIN>` 경로는 따옴표로 감싼다. 경로에 공백이 있으면
`DFLOW_CONFIG_DIR` 값이 끊기고 poll.sh 를 찾지 못해 poll 이 곧바로 죽기 때문이다.
- 빈 디렉터리를 cwd 로 두는 이유: 그러면 승인·반려 감지 재료가 없어 poll exit 9·10 이 팀장에게 절대 오지
  않는다. 9·10 감지는 `--exclude` 를 보지 않으므로, 팀장 체크아웃에 수동 마감한 state.json 이 있으면
  재기동마다 즉시 다시 울려 공회전한다. 팀장은 기상마다 승인 스윕을 하므로 9·10 이 필요 없다.
- `DFLOW_CONFIG_DIR` 을 주는 이유: poll 의 cwd 는 git 작업 트리 밖(`.git/…`)이라 설정 위치를 스스로 찾지
  못한다. 레거시 리포는 `<MAIN>/.env` 를 읽는다. dflow.sh 경로는 poll.sh 가 자기
  위치로 풀므로 따로 주지 않는다. `git rev-parse --git-path` 는 상대경로를 돌려줄 수 있어 `cd … && pwd` 로
  절대경로를 만든다.
- `DFLOW_WATCH=0` 을 주는 이유: 팀장이 자기 식별자로 watch 를 이미 보내므로, poll.sh 의 watch 까지 더하면 같은
  팀장이 둘로 보이거나 `slots`·`busy` 없는 신호가 `lead` 행을 덮어쓴다.
- `--exclude` 에는 **영구 제외 ∪ 현재 슬롯의 id8** 을 넣는다. 슬롯의 id8 은 재구성으로 복원된다. 이유: 팀원이
  claim 하기 전까지 그 작업은 ready 라서, 넣지 않으면 poll 이 즉시 다시 찾아 짧은 간격으로 서버를 친다.
  `--exclude-temp` 에는 일시 제외 목록을 넣는다.
- 목록은 공백 없는 쉼표 구분이다. **목록이 비면 그 플래그 자체를 생략한다.** 빈 값을 넘기면 poll.sh 가 다음
  플래그를 값으로 삼켜 사용법 오류로 끝난다.
- `--wp` 에는 WP 범위(`team.start` 의 `wp`)를 공백 없는 쉼표 구분으로 넣는다. 범위가 전체(`-`)면 플래그를 생략한다.
  poll.sh 가 형식(`WP-<숫자>` 또는 `<모듈>/WP-<숫자>`)을 검사해 틀리면 exit 2 로 끝나며, 번호 앞의 0 은 무시한다
  (`WP-2` 와 `WP-02` 가 같다).
- 대기 큐는 `--exclude` 에 넣지 않는다. 메모리에만 있는 값이 떠 있는 poll 프로세스 안에 숨으면, 컨텍스트
  압축으로 대기 큐를 잃었을 때 그 작업들이 보이지 않는 제외에 갇히기 때문이다.

**재기동 조건**: 빈 슬롯이 있고, 대기 큐가 비었고, 차단기가 풀려 있고, rate-limit 보류(`references/restart.md` 「이벤트로 본 상태」)가 없을 때만 띄운다. poll 은 기동 즉시 첫
조회를 하므로, 슬롯이 찬 채로 띄우면 곧바로 다시 끝나 공회전하고, 대기 큐가 남아 있거나 차단기가 걸려 있으면
찾아도 줄 수가 없다. 예외는 하나다: 차단기가 걸린 `TICK` 에 대기 큐가 비어 시험 spawn 할 후보가 없으면 poll 을
한 번 띄우고, 그 poll exit 0 에서는 1건만 시험 spawn 하고 나머지는 대기 큐에 넣는다. poll 이 떠 있지 않은
구간이 있으므로, 팀장은 기상마다 스스로 시각을 보고 종료 시각이 지났으면 poll exit 8 과 같이 처리한다.

일시 제외는 poll.sh 가 10주기(30분) 뒤 스스로 풀어 재발견을 유도하므로, 팀장은 해제 시각을 따로 관리하지 않는다.
풀린 id8 이 다시 발견되면 착수 판정을 다시 하고, 여전히 막히면 다시 일시 제외에 넣는다. 그래서 poll exit 0 의
재대조는 일시 제외 목록을 보지 않는다(「2-3」 표). 팀장이 자기 일시 제외 목록으로 다시 버리면, 같은 목록을 다시
`--exclude-temp` 로 넘겨 그 작업이 그 세션에서 끝내 뜨지 않기 때문이다. poll 을 다른 이유로
재기동하면 10주기 계산이 처음부터 다시 시작된다(poll.sh 프로세스 안에서 세기 때문이다). 재검사가 늦어질 뿐
틀린 착수는 생기지 않는다.

### 2-2. 감시 루프

루프 교체는 TaskStop 이 아니라 세대 파일 `$(git rev-parse --git-path dflow-team.gen)` 로 한다. 파일은 한 줄
`<세대> <다음 TICK epoch 초>` 이다. 이유: 컨텍스트 압축으로 태스크 id 를 잃어도 루프가 겹쳐 같은 결과를 두 번
처리하지 않는다.

루프를 새로 띄울 때마다 팀장은 먼저 세대를 올린다.
```bash
GEN_FILE=$(git rev-parse --git-path dflow-team.gen); case "$GEN_FILE" in /*) ;; *) GEN_FILE="$PWD/$GEN_FILE" ;; esac
old=$(cut -d' ' -f1 "$GEN_FILE" 2>/dev/null); gen=$(( ${old:-0} + 1 ))
printf '%s %s\n' "$gen" '<다음 TICK epoch 초>' > "$GEN_FILE"; echo "GEN_FILE=$GEN_FILE gen=$gen"
```
다음 TICK 예정 시각은 시작과 `TICK` 기상 때만 지금+1800초로 새로 정하고, 그 밖의 교체에서는 세대 파일 둘째
칸 값을 그대로 쓴다. 이유: 루프를 자주 바꿔도 TICK 이 밀리지 않게 하고, 컨텍스트 압축 뒤에도 그 값을 되찾는다.

그리고 아래 루프를 `run_in_background` 로 띄운다. `set --` 에는 진행 중 슬롯(`blocked` 포함)마다
`'<워크트리>/<TASKS>/<TSK>/.result|<그 경로의 마지막 처리 해시 또는 ->|<pane id 또는 ->'` 를 작은따옴표로
넣는다. pane id 는 tmux 팀원의 `.dflow-pane` 첫 줄이고 Orca 팀원은 `-` 다. 진행 중 슬롯이 없으면 `set --` 를
비운다. 경로에 공백이나 작은따옴표가 든 워크트리는 지원하지 않는다. `TM` 은 **리터럴 절대경로**로 박는다.
루프는 `run_in_background` 의 별도 셸이라 전제 검사의 변수를 물려받지 않고, PATH 에는 Orca shim 이 살아 있을
수 있기 때문이다.
```bash
GEN_FILE='<세대 파일 절대경로>'; MY_GEN=<세대>; TICK_AT=<다음 TICK epoch 초>
STOP_FILE='<팀장 체크아웃>/.git/dflow-team.stop'   # git rev-parse --git-path dflow-team.stop 의 절대경로
LEASE_FILE='<git rev-parse --path-format=absolute --git-path dflow-team.lease-lost 의 값>'   # 워크트리에선 .git 이 파일이라 이 값을 리터럴로 써야 한다
TM='<진짜 tmux 절대경로 또는 빈 값>'
set -- '<워크트리1>/<TASKS>/<TSK1>/.result|<해시1>|<pane1>' '<워크트리2>/<TASKS>/<TSK2>/.result|-|-'
while :; do
  [ "$(cut -d' ' -f1 "$GEN_FILE" 2>/dev/null)" = "$MY_GEN" ] || { echo STALE; exit 0; }
  [ -e "$STOP_FILE" ] && { echo STOP_REQUESTED; exit 0; }
  [ -e "$LEASE_FILE" ] && { echo "LEASE_LOST $(head -n 1 "$LEASE_FILE")"; exit 0; }
  hit=''; dead=''
  for s in "$@"; do
    f=${s%%|*}; rest=${s#*|}; prev=${rest%%|*}; pane=${rest#*|}
    if [ -f "$f" ]; then
      cur=$(head -n 1 "$f"); sum=$(printf '%s\n' "$cur" | cksum | cut -d' ' -f1)
      [ "$sum" = "$prev" ] || hit="$hit $f"
    fi
    if [ "$pane" != - ] && [ -n "$TM" ]; then
      d=$("$TM" -L dflow list-panes -t "$pane" -F '#{pane_dead}' 2>/dev/null | head -n 1)
      [ "$d" = 0 ] || dead="$dead $f"
    fi
  done
  [ -n "$hit" ] && { echo "RESULT_READY$hit"; exit 0; }
  [ -n "$dead" ] && { echo "PANE_DEAD$dead"; exit 0; }
  [ "$(date +%s)" -ge "$TICK_AT" ] && { echo TICK; exit 0; }
  sleep 20
done
```
- **줄 전체를 비교한다.** status 만 비교하면 답을 받은 팀원이 다시 `blocked` 가 됐을 때 status 가 같아 깨어나지
  않는다. 줄에 따옴표가 든 질문이 올 수 있어 줄 대신 그 해시를 넘긴다.
- `PANE_DEAD` 는 tmux 팀원의 pane 이 새 결과 줄 없이 죽었을 때 난다. 결과 줄이 새로 있으면 `RESULT_READY` 가
  먼저다. `list-panes` 는 없는 pane 에서 stderr 로 죽으므로 `2>/dev/null` 로 삼키고, 빈 출력을 `0` 이 아닌
  값으로 보아 죽음으로 친다. pane 이 사라진 것도 팀원이 끝난 것이기 때문이다.
- 루프는 기동 즉시 넘겨받은 전체 경로를 한 번 전수 검사한 뒤 20초 간격으로 감시한다. 루프를 바꾸는 사이에
  도착한 `.result` 를 놓치지 않기 위해서다.
- 종료 파일이 생기면 `STOP_REQUESTED` 를 출력하고 끝난다(「인자」 종료 요청). 결과보다 먼저 보는 이유: 사람이
  멈추라고 한 뒤에 새로 도착한 결과로 spawn 을 이어 가지 않게 한다. 결과 줄은 마감에서 그대로 처리된다.
- lease 상실 표식(`dflow-team.lease-lost`)이 생기면 `LEASE_LOST <사유>` 를 출력하고 끝난다. 종료 요청 다음, 결과보다
  먼저 본다. 이유: 밀려난 팀장이 새로 도착한 결과로 spawn·스윕을 이어 가지 않게 한다.
- 두 백엔드 모두 `TICK_AT` 이 지나면 `TICK` 을 출력하고 끝난다. 한가한 구간에도 30분마다 승인 스윕과
  무응답 점검을 하기 위해서다.
- 교체 시점: 진행 중 슬롯의 경로·처리 해시·pane id 집합이 바뀔 때와 루프가 끝나 있을 때 새로 띄운다(두
  백엔드 공통). 컨텍스트 압축 뒤 루프가 떠 있는지 모르면 새로 띄운다. 옛 루프는 `STALE` 로 끝난다.

### 2-3. 기상마다 하는 일

모든 기상은 먼저 잠금 소유를 확인하고, 소유가 맞을 때만 `beat` 를 갱신하고 좌석표에도 같은 신호를 보낸다.
`STALE` 은 그것만 하고 넘긴다. 이유: 살아 있는 팀장의 잠금이 70분 뒤 죽은 것으로 보이지 않게 하되, 잠금을 잃은
팀장이 새 팀장의 잠금을 계속 살아 있게 만들지 않는다(「1. 시작」 팀장 잠금).
기상에서 이벤트를 기록할 때는 아래 블록의 마지막 명령이 띄운 `references/events.md` 의 명령 블록을 그대로 쓴다.
기억으로 재구성한 명령은 쓰지 않는다. 이유: 컨텍스트 압축 뒤 기억으로 재구성한 명령은 인자가 비거나 추가
필드를 빠뜨려 null 필드를 남긴다. events.md 의 가드가 그런 줄을 `EVENT_ARGS_MISSING` 으로 거부하므로, 그 출력이
보이면 명령 블록을 다시 띄워 다시 기록한다.
```bash
LEAD_PID=${CLAUDE_PID:-$PPID}
LOCK=$(git rev-parse --git-path dflow-team.lock); o_who=; o_ts=; o_pid=
{ read -r o_who o_ts o_pid < "$LOCK/owner"; } 2>/dev/null || true
if [ "$o_who" = '<신원>/<host>/lead' ] && [ "$o_pid" = "$LEAD_PID" ]; then
  date +%s > "$LOCK/beat" && { echo LOCK_OK
    h=$(.claude/skills/dflow-work/scripts/dflow.sh lease holder) || h=''
    if [ -n "$h" ]; then
      wr=$(.claude/skills/dflow-work/scripts/dflow.sh watch --agent "$o_who" \
        --slots <N> --busy <M> --until '<UNTIL_LABEL>' --json \
        --holder "$h") \
        && ps=$(.claude/skills/dflow-work/scripts/dflow.sh config projects) \
        && printf '%s' "$wr" | jq -c --arg ps "$ps" '($ps | split("\n")) as $ok
             | {n: (.resume_requests | if . == null then "NULL" else length end),
             err: (.resume_requests_error // "-"),
             reqs: [(.resume_requests // [])[] | select(.project_id as $p | $ok | index($p)) | {id8, code, host, requested_at}],
             other_project: [(.resume_requests // [])[] | select(.project_id as $p | ($ok | index($p)) | not) | .id8]}' \
        || echo "WATCH_FAILED"
    else
      echo "HOLDER_FAILED"
    fi
  } || echo "LOCK_LOST beat 쓰기 실패"
else
  echo "LOCK_LOST owner=$o_who $o_ts $o_pid 내 PID=$LEAD_PID"
fi
LB=$(git rev-parse --git-path dflow-team.lease).beat
lb=$(cat "$LB" 2>/dev/null); lb=${lb:-0}
[ $(( $(date +%s) - lb )) -lt 180 ] || echo "LEASE_KEEP_DEAD 마지막 갱신 ${lb}"
sed -n '/^## 기록 명령/,$p' .claude/skills/dflow-team/references/events.md   # 이벤트 기록 명령의 정본. 이 출력의 블록으로만 기록한다
```
**`resume_requests` 는 좌석표의 「이어서 시작」 요청이다.** 사람이 화면에서 멈춘 좌석의 그 버튼을 누르면
서버가 주문에 표식을 남기고, 이 응답이 그것을 실어 온다. 항목은
`{order_id, id8, project_id, wbs_item_id, code, name, host, claimed_by, requested_at}` 이며 최대 50건, 오래된
것부터다. 범위는 이 신원이 점유한 `claimed` 주문뿐이며 **프로젝트를 가리지 않는다.** 그래서 위 블록이 이 리포
바인딩(`DFLOW_PROJECT_ID`·`DFLOW_PROJECT_MAP`) 밖의 요청을 `reqs` 에서 빼 `other_project` 로 따로 낸다.
`other_project` 는 처리하지 않고 "다른 프로젝트의 요청: <id8…>. 그 프로젝트 리포의 팀장이 처리한다" 로 한 줄만
보고한다. 이유: 같은 신원이 다른 프로젝트 리포에서도 팀장을 돌리므로, 거르지 않으면 이 리포에 남의 워크트리를
만들어 재개한다. 처리 규칙은 셋이다.
- `n` 이 `"NULL"` 이면 **요청이 없는 것이 아니라 조회가 실패한 것이다.** `err` 에 사유가 온다. 그 기상에서는
  요청을 하나도 처리하지 않고 사유를 한 줄 보고한 뒤 다음 기상에 다시 읽는다. 빈 배열(`n` 이 0)과 절대
  뭉개지 않는다. 조회 실패를 데이터 없음으로 위장하면 사람이 누른 버튼이 조용히 사라진다.
- `host` 가 이 PC 의 `<host>` 슬러그와 **글자 그대로 같은 것만** 「5-1. 재개 spawn」 으로 보낸다. 서버가 그
  값을 `claimed_by` 에서 파생하므로 팀장이 다시 계산하지 않는다. 다른 값이면 그 워크트리가 이 PC 에 없다는
  뜻이므로 **"멈춤" 표에 사유 `다른 PC claim` 으로 적고 띄우지 않는다.**
- **팀장은 표식을 지우지 않으며 확인 응답도 보내지 않는다.** 되살아난 워커의 첫 heartbeat 가 그것을 비우고,
  회수 뒤 재claim 하는 경로에서는 claim 라우트가 지운다. 팀장이 지우면 아직 띄우지 못한 요청이 사라지고,
  팀장이 옛 요청을 계속 보면 이미 정상 점유된 주문에 워커를 겹쳐 띄운다.
`WATCH_FAILED` 는 watch 호출 자체가 실패한 것이다. `beat` 는 이미 갱신됐으므로 잠금은 유효하고, 그 기상의
요청 처리만 건너뛴다.
`HOLDER_FAILED` 는 `lease holder` 조회가 실패해 watch 를 아예 부르지 않은 것이다(빈 `--holder` 로 부르면 무필터로
전체 재개 요청이 온다) — `beat` 는 이미 갱신됐으므로 잠금은 유효하고, `WATCH_FAILED` 와 같이 그 기상의 요청
처리만 건너뛴다.

`LEASE_KEEP_DEAD` 는 lease 갱신 프로세스가 3분 넘게 갱신하지 못한 것이다(죽었거나 서버에 닿지 못함). **이 기상이
「2-2」 감시 루프의 `LEASE_LOST` 로 온 것이면 이 문단은 건너뛰고 그 `LEASE_LOST` 를 그대로 따른다(아래 기상 표).**
서버에 닿지 못해 갱신 프로세스가 죽는 경우 마지막 갱신(3번 연속 실패, 60초 간격)으로부터 이미 180초 안팎이
지나 있으므로, 표식 파일을 본 감시 루프의 `LEASE_LOST` 와 이 블록의 beat 나이 검사가 낸 `LEASE_KEEP_DEAD` 가 같은
기상에 함께 뜰 수 있다. **우선순위는 `LEASE_LOST` 다**: 곧장 「7. 마감」 의 lease 상실 마감으로 가고, 같은
기상에 함께 뜬 `LEASE_KEEP_DEAD` 는 무시한다.
그 밖의 기상(감시 루프의 `LEASE_LOST` 없이 이 블록만 `LEASE_KEEP_DEAD` 를 낸 경우)에서는 `dflow.sh lease renew`
를 한 번 부른다. `LEASE_OK` 면, lease 상실 표식 파일(`dflow-team.lease-lost`, 「2-2」 의 `LEASE_FILE`)이 남아
있으면 먼저 지운 뒤 「1. 시작」 6번의 lease 갱신 블록과 감시 루프를 다시 띄운다. 표식을 지우지 않고 다시 띄우면
그 감시 루프가 첫 검사에서 옛 표식을 보고 재기동 직후 곧바로 다시 `LEASE_LOST` 로 깨운다. `LEASE_LOST`
(exit 4)나 `LEASE_NONE` 이면 「7. 마감」 의 lease 상실 마감으로 간다. 그 밖의 실패는 사유를 보고하고 다음 기상에 다시
본다. 이유: 갱신 프로세스만 죽으면 이 팀장은 살아 있는데 lease 가 3분 뒤 만료돼 다른 곳이 가져갈 수 있다.

`LOCK_LOST` 면 **잠금 상실**이다. "잠금 상실" 로 보고하고 새 spawn 을 멈추며, 잠금을 지우지 않은 채 「7. 마감」 의
잠금 상실 마감으로 간다. 이유: 이 팀장이 `beat` 를 70분 넘게 놓친 사이 다른 팀장이 잠금을 가져갔다면 두 팀장이
같은 체크아웃에서 스윕·spawn 을 하고 같은 슬롯 번호를 낸다. `beat` 를 쓰지 못한 경우도 곧 다른 팀장이 가져갈 수
있어 소유를 장담할 수 없다.

`STALE` 과 `LEASE_LOST` 를 뺀 모든 기상에서는 `LOCK_OK` 뒤에 이어서 이 순서로 한다.
1. 재구성(「팀장 상태」). 컨텍스트 압축 뒤 첫 기상이면 그 전에 「팀장 상태」 의 압축 규칙대로 절차 정본을 다시
   읽는다.
2. 아래 표의 처리.
3. 승인 스윕(「4. 승인 스윕」). 스윕을 도는 기상은 시작, 결과 도착(`.result` 또는 완료 알림), `TICK`, poll
   재기동 직전, 마감이다. 이유: 팀장의 poll 에는 exit 9·10 이 오지 않는다. 대가로 승인 반영은 사람이 승인한 뒤
   다음 기상까지 늦어지며, `TICK` 이 있어 최대 30분이다. 이 지연 동안 승인됐으나 main 미반영인 선행은 워커가
   그 `head_sha` 를 스택 기점으로 받고(`/dflow-dev` 「--worker」 B), 승인 대기인 선행의 후속은 `skipped` 로 일시
   제외됐다가 승인·머지 뒤 재검사에서 풀린다(「--worker」 G). 자동 머지(`AUTOMERGE_ON`)면 승인 대기인 선행도
   결과 도착 스윕에서 곧바로 머지되므로, 후속은 워커의 기본 브랜치 반영 확인(「--worker」 G)을 통과해 승인을
   기다리지 않고 착수한다. 일시 제외된 후속은 10주기(30분) 뒤 재검사에서 풀린다.
4. 빈 슬롯이 있고 차단기가 허락하면 **재개 대상을 먼저**(「5-1. 재개 spawn」), 그 다음 **해소 큐**(「5-2. 해소 spawn」), 그 다음 대기 큐 맨 앞부터
   spawn 한다(「5. 팀원 spawn」). 재개 대상은 재구성의 고아 스캔이 "재개 가능" 으로 분류한 것과 아직 띄우지
   않은 `--resume` 지목분이다. 재시작 대기 목록(`references/restart.md` 「이벤트로 본 상태」 의 `RESTART_DUE`)도 재개 대상이며
   재투입 전 확인(`REINJECT_OK`)을 통과할 때만 띄운다. 재시작 대기는
   새 작업보다 먼저다. rate-limit 보류 중에는 재개·새 작업 모두 띄우지 않는다(`RL_DUE` 슬롯 자신의 재투입만 예외).
5. 끝나 있는 감시 루프를 다시 띄우고, 재기동 조건(「2-1」)을 만족하면 poll.sh 를 다시 띄운다. 컨텍스트 압축 뒤
   poll 이 떠 있는지 모르면 재기동 조건에 따라 새로 띄운다. poll 이 겹쳐 떠도 poll exit 0 처리의 대조와 spawn 전
   확인(「5. 팀원 spawn」 1번)이 같은 작업을 두 번 띄우지 않게 막는다.

| 기상 | 처리 |
|---|---|
| poll exit 0 (ready N줄) | 각 줄 `순번<TAB>id8<TAB>이름` 에서 순번은 버리고 id8 만 쓴다. 먼저 후보를 영구 제외 목록과 슬롯 표에만 한 번 더 대조해 걸리는 것을 버린다. 이유: 겹쳐 뜬 옛 poll 은 옛 제외 목록으로 돌고 있을 수 있다. 일시 제외는 대조하지 않는다. poll.sh 가 10주기 뒤 풀어 돌려준 것을 그대로 다시 판정해야 하기 때문이며(「2-1」), 대가로 겹쳐 뜬 옛 poll 이 막 일시 제외한 작업을 돌려주면 한 번 더 띄워 `skipped` 로 끝난다. 남은 후보마다 아래 show 필터로 `.order.item.spec` 이 비었는지와 선행 사전 검사(`deps_unmet`)만 본다(spec 본문을 컨텍스트에 싣지 않는다). 비었거나 `ref` 가 비면 일시 제외에 넣고 사유(spec 부재·TSK 없음)를 보고하며 `team.result`(slot `-`, status `skipped`)를 남긴다. `deps_unmet` 이 비어 있지 않으면 띄우지 않고 사유 `선행 미충족(사전 검사: <ref…>)` 로 같은 처리를 한다(아래 「선행 사전 검사」). `deps_unmet` 이 비었고 `deps_nohead` 가 비어 있지 않으면 아래 「선행 반영 사전 검사」 를 거친다. 남은 것을 빈 슬롯 수만큼 spawn 하고 나머지는 대기 큐 끝에 넣는다. 차단기가 걸려 있으면 spawn 하지 않고 대기 큐에 넣는다(시험 spawn 예외는 「2-1」 재기동 조건). 대기 큐를 잃어도 그 작업들은 아직 ready 이므로 다음 poll 이 다시 찾는다 |
| `STOP_REQUESTED`, 사람의 종료 요청("팀장 종료"·"마감해" 등) | 종료 시각과 무관하게 「7. 마감」 으로 간다. "종료 요청으로 마감합니다" 를 한 줄 알린다. 종료 파일은 이 자리에서 지운다(요청을 받았다). 남기면 마감 중 다시 띄운 감시 루프가 곧바로 다시 끝나 공회전한다. 마감의 기다림(「7. 마감」 2번) 중에 종료 요청이 **한 번 더** 오면 기다림을 끝내고 곧바로 3번으로 간다 |
| poll exit 8 (시한) | 먼저 지금 시각이 현재 `<UNTIL>`(연장 반영) 전인지 본다. 전이면 연장 전에 띄운 옛 poll 이 끝난 것이므로 무시하고 재기동 조건(「2-1」)대로 새 `--until` 로 다시 띄운다. 지났으면 새 배정을 멈춘다. 대기 큐를 비우고(보고만 한다) 「7. 마감」 으로 간다 |
| poll exit 2·3·5·6·7 | 중단 사유(stderr)를 보고하고 「7. 마감」 으로 간다 |
| `RESULT_READY <경로…>` | 경로마다 「3. 결과 처리」 |
| `PANE_DEAD <경로…>` (tmux) | 경로마다 「3. 결과 처리」. `.result` 가 있으면 그 줄, 없으면 죽은 pane 화면 폴백, 그것도 없으면 `references/restart.md` 「판정」(`pane_dead_status` 127 이면 `failed no-result`) |
| 팀원의 cross-session 메시지(이슈 보고) | 「2-4. 팀원 이슈 보고 처리」 로 간다. 도착한 이 기상 안에서 곧바로 처리한다 — 사람에게 보고만 하고 턴을 끝내지 않는다 |
| 사람의 답 | 「6. blocked」 의 답 매칭 |
| `TICK` | 다음 TICK 예정 시각을 지금+1800초로 새로 정한다. 진행 중 슬롯의 생존을 확인하고 무응답 슬롯의 생존 증거를 잰다(「3. 결과 처리」). 결과 줄 없는 정체 슬롯과 재시작 대기 목록은 `references/restart.md` 「판정」·「rate-limit 대기」 를 탄다. 차단기가 걸려 있으면 시험 spawn 1건을 허용한다 |
| `LEASE_LOST <사유>` | 다른 곳이 이 신원+프로젝트의 팀장 lease 를 가져갔거나(`LEASE_LOST <project_id…>`), 서버에 3분 넘게 닿지 못했다(`LEASE_UNREACHABLE`). 위 1~5(재구성·승인 스윕·spawn·poll·감시 루프 재기동)를 하지 않고, 같은 `LOCK_OK` 블록이 함께 낸 `LEASE_KEEP_DEAD` 도 무시한 채 곧장 「7. 마감」 의 lease 상실 마감으로 간다 |
| `STALE` | 잠금 소유 확인과 `beat` 갱신만 하고 나머지는 넘긴다 |

poll exit 0 의 show 필터:
```bash
(.claude/skills/dflow-work/scripts/dflow.sh show <id8>) \
  | jq -c '{order: .order.id, status: .order.status, ref: .order.item.external_ref, spec_empty: ((.order.item.spec // "") | length == 0),
            deps_unmet: [.depends_evidence[]? | select(has("reached") and .reached == false) | .external_ref],
            deps_nohead: [.depends_evidence[]? | select(.reached == true and ((.head_sha // "") == "")) | .external_ref]}'
```
show 가 실패하면(dflow.sh 가 0 이 아닌 코드로 끝나거나, 404 로 exit 7 이거나, 출력이 비면) spec 부재로 보지 않는다.
그 id8 은 "조회 실패" 사유로 일시 제외에 넣고 다음 기상에서 다시 판정한다. 이유: 조회 실패를 데이터 없음으로
위장하면 살아 있는 작업이 spec 부재로 잘못 제외된다.

**선행 사전 검사**(`deps_unmet`): 서버 판정 `reached` 가 거짓인 선행이 하나라도 있으면 spawn 하지 않는다.
이 경우는 워커가 무엇을 하든 `skipped` 로 끝나는 확정 skip 이다. `head_sha` 는 승인된 주문의 완료 보고에서만
나오므로 `reached` 가 거짓이면 `head_sha` 도 없고(워커 행 G 갈래 1 → `skipped 선행 미승인`), 설령 워커가 진행해도
서버 claim 게이트가 같은 `reached` 로 `dependency_not_met` 을 돌려준다. 그래서 이 검사는 워커 G 의 판정을 대신하지
않는다. `reached` 가 참인 선행(승인 대기·기본 브랜치 반영 여부·스택 기점)은 전부 워커가 판정하고, `reached` 키가
없는 옛 서버 응답이나 `depends_evidence` 가 없는 응답은 걸러내지 않고 워커에 맡긴다(판정 불가를 미충족으로 단정하지
않는다). `state.json` 의 `phase=merged` 로 거르지 않는다(단, 행 G 갈래 2 의 반영 확인은 아래 「선행 반영 사전 검사」 가 사전에 한다). 이유: 진행 중인 선행이라도 승인되면 `head_sha` 를 기점으로
스택해 진행하는 것이 워커 규칙(행 B)이라, merged 기준은 확정 skip 이 아닌 작업까지 30분씩 묶는다. 이유(이 검사를 두는
까닭): poll 은 10주기마다 일시 제외를 풀어 선행이 진행 중인 후속을 다시 돌려준다. 그대로 띄우면 후속마다 팀원 세션이
열려 행 G 판정만 하고 `skipped` 로 끝나며, 선행이 끝날 때까지 30분마다 되풀이되어 토큰과 슬롯을 쓴다(2026-09-19
mdm-dict-v2 실측: 한 선행에 걸린 후속 5건). 사유 문자열이 「선행 미충족」 으로 시작하므로 자동 머지 뒤 일시 제외
해제(「3. 결과 처리」)의 선행 계열에 그대로 들어간다. 면제된 간선(`waived:true`, 계약 2.8)은 서버가 `reached:true` 로 주므로
이 검사에 걸리지 않는다 — 그대로 spawn 한다.

**선행 반영 사전 검사**(`deps_nohead`, 2026-09-23): `deps_unmet` 이 비었고 `deps_nohead`(서버 `reached` 는 참인데
`head_sha` 가 없는 선행, 즉 완료 보고 뒤 승인 전)가 비어 있지 않으면 워커 행 G 갈래 2 의 반영 확인을 여기서 먼저 한다.
그대로 띄우면 워커가 행 G 에서 `skipped 선행 승인 대기` 로 끝나는 확정 skip 이고, 30분마다 팀원 세션 하나를 쓴다.
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

팀원이 작업 중 사고·환경 문제·판단이 필요한 이슈를 겪으면 SendMessage 로 이 세션에 직접 이슈 보고를
보낸다(worker-prompt.md 「9. 이슈 보고」). **감시 루프는 cross-session 메시지로 깨지 않으므로, 메시지가
도착한 턴에서 곧바로** 아래 1~3 을 처리한다. **사람에게 보고만 하고 턴을 끝내는 것은 금지한다** — 2026-09-24
dmes-standard TSK-01-01 사고가 그 패턴이었다(팀원이 이슈를 보고했는데 팀장이 사람에게만 전달하고 멈춰,
둘이 서로를 기다리며 약 10분 교착했다).

메시지 형식은 첫 줄 `[이슈 <TSK> <id8>] <요약>` 이고, 이어서 경위·지금까지 한 조치·선택지(있으면)·기본안이
온다(worker-prompt.md 「9」와 짝).

1. **저장**: `docs/dflow-team/issues.md`(「3. 결과 처리」 문제 기록과 같은 파일, 커밋하지 않는다)에 원문
   요약을 항목 하나로 붙이고, `team.issue` 이벤트(`id8`, `summary`, `decision`)를 events.jsonl 에 남긴다
   (`references/events.md`). 처음 저장할 때 `decision` 은 `pending` 이다. 이 이벤트는 재구성 대상이다
   (「팀장 상태」 「보조」) — 컨텍스트 압축 뒤에도 아직 지시를 보내지 않은 이슈를 찾을 수 있다.
2. **판단**: 팀장이 최선의 선택을 스스로 한다. 판단 재료는 스킬 규칙, 리포 가이드(CLAUDE.md 등), 메모리,
   다른 팀원 상황이다. 사람에게 묻는 것은 사람만 정할 수 있는 것(운영 배포, 되돌리기 어려운 외부 작업,
   요구사항 해석)에 한정하며, 그때도 팀원에게는 먼저 기본안으로 계속할지 그 단계만 미룰지를 지시한다 —
   팀원을 답 없이 세워 두지 않는다.
3. **추가 지시**: 판단한 내용을 `[팀장 지시 <id8>] …` 형식으로 SendMessage 로 보낸다. `to` 는 그 이슈
   메시지의 `from` 이다 — 이슈 보고가 온 세션이 곧 그 팀원의 세션이므로 별도로 주소를 찾지 않는다. 지시에는
   할 일, 하지 말 것, 팀장이 따로 맡는 조치를 적는다. 보낸 뒤 `team.issue` 를 `decision` 을 채워(실제 결정
   요약, `pending` 아님) 같은 id8 로 다시 기록한다 — id8 마다 **마지막** `team.issue` 의 `decision` 이
   `pending` 인 것이 아직 지시를 보내지 않은 이슈다. 답장 없는 이슈를 남기지 않는다.
4. **전파**: 같은 문제가 다른 팀원에게도 생길 수 있으면 살아 있는 다른 팀원에게도 같은 지시를 SendMessage
   로 보낸다. 새로 띄우는 팀원에게는 포인터나 worker-prompt.md 규칙에 반영될 때까지, 팀장이 이 events 를
   판단 재료로 들고 있는다.
5. **근본 조치**: 리포 코드·환경 문제는 팀장이 고치고(개발 브랜치 커밋), 스킬 문제는 스킬 개선 요청으로
   넘긴다. 결과를 issues.md 에 남긴다.

**되돌릴 수 없는 조치는 미룬다**: 팀원은 이슈를 보고한 뒤에도 되돌릴 수 있는 작업은 기본안대로 계속한다.
`push`·`done`·외부 상태 변경처럼 되돌릴 수 없는 것만 팀장 지시를 기다리며 미룬다(worker-prompt.md 「9」).
팀장이 10분 안에 지시를 보내지 못하면 팀원은 `.result` 의 `blocked` 로 정규 경로로 넘어간다 — 그러면 이
절이 아니라 「6. blocked」 로 처리한다.

**SendMessage 가 닿지 않을 때**: backends.md 는 tmux 팀원의 `CLAUDE_CODE_MESSAGING_SOCKET`·`TOKEN` 을
일부러 벗긴다(「팀원 환경을 벗기는 이유」) — 그래서 SendMessage 가 양쪽 다 실패할 수 있다. 팀원 쪽은
실패해도 `.issues` 와 10분 규칙(worker-prompt.md 「9」)으로 넘어간다. 팀장 쪽에서 SendMessage 가 실패하면
1번(저장)은 그대로 하고, `send-keys -l --`(tmux, backends.md 「생존·화면·답·회수」) 또는 `orca terminal`
로 같은 지시를 그 팀원 화면에 직접 넣는다.

## 3. 결과 처리

**결과 줄 찾기**
- 감시 루프가 알린 경로(`RESULT_READY`)의 `.result` 한 줄이다. 두 백엔드 공통이며 슬롯은 경로(그 슬롯의
  워크트리)로 찾는다. 이미 판정한 경로의 알림은 집계만 갱신하고 슬롯을 건드리지 않는다.
- `PANE_DEAD <경로>`(tmux): 그 슬롯의 팀원 pane 이 죽었다. `.result` 가 있으면 그 줄을 처리한다. 없으면
  backends.md 「결과 줄과 죽은 pane 폴백」 대로 `capture-pane -p -J -S -` 로 죽은 pane 의 화면 전체를 읽어
  `<TSK> <id8> ` 로 시작하는 마지막 줄을 찾아 처리한다(`failed not-isolated` 는 워커가 파일을 쓰지 않으므로 이
  폴백으로만 온다). 그것도 없으면 `#{pane_dead_status}` 를 읽는다(`references/restart.md` 「판정」 블록의 `dead_status`).
  `127`(`claude` 를 찾지 못함)이면 **곧바로** `failed no-result` 로 판정한다(hash `-`). 다시 띄워도 같은 자리에서 죽는
  환경 결함이기 때문이다. 그 밖이면 `references/restart.md` 「판정」 으로 간다(재시작 후보). 기다리지 않는 이유:
  프로세스가 없으므로 더 올 결과가 없다.
- 줄 형식은 `<TSK> <id8> <branch|-> <head|-> <done_exit|-> <status> <사유…>` 다. 줄과 해시는 「팀장 상태」 의 한
  줄 명령으로 함께 읽고, 해시가 그 경로의 마지막 처리 해시와 같으면 처리하지 않는다.

**생존 증거**: tmux 팀원은 먼저 「팀장 상태」 정본 표의 생존 칸(`.dflow-pane` 의 pane 이 `#{pane_dead}=0` 인지)
을 본다. `dead` 면 증거를 재지 않고 `PANE_DEAD` 와 같이 처리한다. 살아 있는 팀원은 아래 중 하나라도 직전
`TICK` 과 달라지면 살아 있는 것이다. 슬롯의 첫 `TICK` 은 기록만 한다.
```bash
git -C <워크트리> log -1 --format=%ct                                        # 1. 워크트리가 있으면 HEAD 커밋 시각
git fetch origin && git log -1 --format=%ct 'origin/agent/<id8>-<slug>'   # 1. 워크트리가 없으면 원격 tip 커밋 시각
(.claude/skills/dflow-work/scripts/dflow.sh show <id8>) | jq -r '[.reports[]?] | last | .created_at // empty'   # 2. 서버 최신 progress
git -C <워크트리> status --porcelain | cksum                                 # 3. 미커밋 변경 목록
```
2번의 show 가 실패하면 증거 없음이 아니라 측정 실패로 기록하고, 그 `TICK` 에서는 2번을 비교에서 뺀다.
**화면은 생존 증거로 쓰지 않는다.** 화면(tmux `capture-pane`, Orca `orca terminal read`)은 보고용과 폴더 신뢰
확인 판별(backends.md)에만 쓴다. 스피너 때문에 화면이 매번 달라져 멈춘 팀원도 살아 있는 것처럼 보이기
때문이다. 터미널 핸들이 없는 옛 Orca 런타임에서는 화면을 읽지 않고 위 셋만 쓴다.

**문제 기록**: 결과 줄을 처리할 때 `blocked` 가 아니면 **`team.result` 기록과 워크트리 정리보다 먼저** 팀장
체크아웃의 `docs/dflow-team/issues.md` 에 항목 하나를 붙인다. 목적은 팀원이 보고한 에러·문제점을 모아 스킬과
환경을 개선하는 것이다. 이 파일은 커밋하지 않는다(「1. 시작」 exclude 의 `/docs/dflow-team/`). 커밋하면 승인
스윕의 머지와 `DIRTY` 검사가 흔들린다.
- 재료는 둘이다. 하나는 워커가 쓴 `<워크트리>/<TASKS>/<TSK>/.issues`(worker-prompt.md 「7-1」, 줄마다
  `<phase>\t<분류>\t<내용>`)이고, 다른 하나는 `done` 이 아닌 결과의 사유(결과 줄 7번째 칸부터)다.
- `done`·`needs-merge` 이고 `.issues` 가 없거나 비었으면 붙이지 않는다. 그 밖의 status 는 `.issues` 가 없어도
  사유 한 줄로 항목을 만든다.
- `failed no-result` 는 사유 대신 `pane_dead_status` 와 화면 마지막 20줄(tmux `capture-pane -p -J -S - | tail -n
  20`, Orca `orca terminal read`)을 코드 블록으로 붙인다. 화면을 읽지 못하면 `화면 없음` 한 줄을 쓴다.
- `blocked` 는 붙이지 않는다. 팀원이 답을 받아 이어 가며 `.issues` 에 계속 적고, 최종 결과 때 한 번에 옮긴다.
- 워크트리를 정리하기 전에 옮기는 이유: 정리(`git worktree remove --force`·`orca worktree rm`)가 미추적
  `.issues` 를 함께 지운다.
```bash
f='<MAIN>/docs/dflow-team/issues.md'; i='<워크트리>/<TASKS>/<TSK>/.issues'; st='<status>'
reason=$(head -n 1 "$(dirname "$i")/.result" 2>/dev/null | cut -d' ' -f7-)
if [ -s "$i" ] || { [ "$st" != done ] && [ "$st" != needs-merge ]; }; then
  mkdir -p "$(dirname "$f")"
  [ -s "$f" ] || printf '# /dflow-team 문제 기록\n\n팀원이 보고한 에러·문제점. 스킬·환경 개선 재료이며 커밋하지 않는다.\n' > "$f"
  { printf '\n### %s · <TSK> (<id8>) · %s\n\n' "$(date '+%Y-%m-%d %H:%M')" "$st"
    [ "$st" = done ] || [ "$st" = needs-merge ] || printf -- '- 결과 사유: %s\n' "$reason"
    [ -s "$i" ] && awk -F'\t' 'NF{c=$2;p=$1;sub(/^[^\t]*\t[^\t]*\t/,"");printf "- [%s] %s: %s\n",c,p,$0}' "$i"
  } >> "$f" || echo ISSUE_LOG_FAIL
fi
```
`reason` 은 events.md 「기록 명령」 과 같은 방법(`.result` 첫 줄의 7번째 칸부터)으로 이 블록 안에서 다시 뽑는다.
기록 명령은 별도 Bash 호출이라 그 셸 변수를 이 블록이 못 보기 때문이다. `.result` 가 없으면(`failed no-result`) 빈 값이다. `ISSUE_LOG_FAIL` 이 나와도 결과 처리를 멈추지
않고 보고에 한 줄 적는다. 기록 실패가 슬롯 해제를 막으면 안 되기 때문이다. 해시 중복 방지가 결과 줄을 한 번만
처리하게 하므로 같은 결과가 두 번 기록되지 않는다.

**status 별 처리**: 결과 줄은 경로별 마지막 처리 해시와 다를 때만 처리하며, `blocked` 는 `team.blocked`,
나머지는 `team.result` 로 해시·사유와 함께 기록한다(events.md). 모든 결과는 집계에 넣는다. 결과를 처리할 때는
그 id8 을 먼저 진행 중 영구 제외에서 빼고, 아래 표의 제외 칸대로 일시·영구 제외를 새로 정한다. 이유: 「5. 팀원
spawn」 6번이 넣은 진행 중 제외가 남으면 `skipped`(일시 제외)와 `failed rate-limit`(제외 없음)의 재시도가 영영
막힌다.

| status | 슬롯 | 제외 | 워크트리 | 그 밖 |
|---|---|---|---|---|
| `done` | 해제 | 없음 | 「고아 정리 규칙」 2번(미커밋 변경 없음, HEAD 가 `origin/<agent 브랜치>` 와 같음)을 맞추면 그 자리에서 정리한다. 아니면 3번대로 경로와 미커밋 목록을 보고하고 남기며 `.dflow-agent` 값을 `<신원>/<host>/parked` 로 바꾼다 | 자동 머지(`AUTOMERGE_ON`)면 **먼저 승인 스윕을 곧바로 한다**(「4. 승인 스윕」). 그 다음 대기 큐가 있으면 그 슬롯에 spawn 한다. 비어 있으면 poll 재기동 조건(「2-1」)을 따른다. 스윕을 먼저 하는 이유: 방금 끝난 작업이 기본 브랜치에 들어가야 그 후속이 착수할 수 있다 |
| `needs-merge` | 해제 | 없음 | `done` 과 같다 | 승인 스윕을 곧바로 한다 |
| `skipped`(선행 미충족·선행 미승인·선행 승인 대기·claim exit 4·공통 기점 없음·spec 부재) | 해제 | 일시 제외 | branch 가 `-` 면 부트스트랩 실패 정리 규칙, 아니면 `done` 과 같다 | 사유 보고 |
| `blocked` | 유지 | 진행 중으로 영구 제외에 남긴다 | 그대로 둔다(두 백엔드 공통). 팀원이 pane 이나 탭에서 답을 기다린다 | 통지(「6. blocked」) |
| `failed <사유>` | 해제 | 영구 제외 | 고아 정리 규칙을 따른다 | 사유 보고, 차단기 계산 |
| `failed permission <명령>` | 해제 | 영구 제외 | 고아 정리 규칙을 따른다 | 거부된 명령을 "권한 목록 재료" 로 보고한다(킷 허용 목록에 넣을 값). 서버에 claimed 로 남으므로 **"멈춤" 표**에 넣는다(사유는 그 status). 차단기 계산 |
| `failed rate-limit` | 해제 | 제외하지 않는다 | 고아 정리 규칙을 따른다 | 재시도할 수 있다. 아직 ready 면 poll 이 다시 찾고, 이미 claimed 면 **"멈춤" 표**에 넣는다(사유는 그 status). 차단기 계산에 넣는다. 워커가 결과 줄을 쓴 경우라 자동 재시작·보류 대상이 아니다. 결과 줄 없이 한도에 선 워커는 `references/restart.md` 「rate-limit 대기」 가 다룬다 |
| `failed no-result`(pane 이 죽었는데 결과 줄 없음) | 해제 | 영구 제외 | 고아 정리 규칙을 따른다 | 서버에 claimed 면 **"멈춤" 표**에 넣는다(사유는 그 status). 차단기 계산. `pane_dead_status` 127 일 때만 이 행이다. 127 이 아닌 죽음은 이 행이 아니라 `references/restart.md` 의 재시작 판정으로 간다(워크트리를 지우지 않는다) |
| `failed not-isolated` | 해제 | 영구 제외 | 없음(워커가 파일을 쓰지 않았다) | 백엔드 결함이므로 새 spawn 을 멈추고 「7. 마감」 으로 간다 |
| `failed project` | 해제 | 영구 제외 | 고아 정리 규칙을 따른다(claim 전이라 대개 부트스트랩 실패 정리) | 주문이 이 리포의 D'Flow 프로젝트 밖이다. claim 하지 않았으므로 "멈춤" 표에 넣지 않는다. 바인딩(`.env`)이나 poll 필터가 새는 결함이므로 사유를 그대로 보고한다. 차단기 계산 |
| `failed not-assignee` | 해제 | 영구 제외 | 고아 정리 규칙을 따른다(claim 전이라 대개 부트스트랩 실패 정리) | 다른 멤버에게 배정된 작업을 claim 하려다 서버가 `not_assignee` 로 거부했다. claim 하지 않았으므로 "멈춤" 표에 넣지 않는다. **차단기 계산에 넣지 않는다**: 환경 결함이 아니라 배정 불일치라, 세면 정상인 팀이 멈춘다. poll 과 claim 은 같은 기준(내 멤버 id)으로 배정을 보므로, 대개 poll 이 돌려준 뒤 담당자가 바뀌었거나 팀장이 poll 을 거치지 않고 띄운 것이다(2026-09-19 mdm-dict-v2: 일시 제외를 비운 뒤 poll 을 기다리지 않고 직접 띄웠는데 그사이 담당자가 다른 멤버로 바뀌었다). 사유와 함께 "담당자 변경 여부를 D'Flow 에서 확인하라" 를 보고한다 |
| `failed deps` | 해제 | 영구 제외 | 고아 정리 규칙을 따른다 | 사유 보고, 차단기 계산. 설치는 claim 과 브랜치 생성 뒤라서(`/dflow-dev` 「--worker」 H) 서버에 claimed 로 남으므로 **"멈춤" 표**에 넣는다(사유는 그 status). 대상 리포의 lockfile·패키지 관리자 문제라 사람이 고친다 |
| `cancelled`(사람이 D'Flow 에서 중단 — 주문 `cancelled`·위임 해제) | 해제 | 영구 제외 | **지우지 않는다**(산출물 보존). 미커밋 변경이 있어도 그대로 두고 경로만 보고하며, `.dflow-agent` 값을 `<신원>/<host>/parked` 로 바꾼다 | 사람 알림은 한 줄(`<TSK> <id8> 중단됨 — 워크트리 <경로> 보존`). 사람이 멈춘 것이라 "멈춤" 표에 넣지 않고, **차단기 계산에 넣지 않는다**(세지도 끊지도 않는다). 다시 맡기려면 사람이 위임 체크를 켜며, 그때 새 주문으로 다시 poll 에 잡힌다 |

**해소 워커의 결과**: 슬롯의 워크트리 이름이 `-resolve` 로 끝나면(`dflow-<id8>-resolve`, `readopt` 뒤에도 같다) 위 표가 아니라
`references/merge-conflict.md` 「4. 해소 결과 처리」 표를 따른다. 결과 줄 찾기·해시·`team.result`·`team.blocked` 기록·tmux
회수는 위와 같다.

- **그 자리에서 정리하는 이유**: git 은 다른 워크트리가 체크아웃한 브랜치를 지우지 못한다. 워크트리를 마감까지
  남기면 같은 세션에서 승인된 작업의 로컬 agent 브랜치 삭제가 실패한다. 정리 명령은 backends.md 의 백엔드별
  「정리」 와 「고아 정리 규칙」 이며, 워크트리를 지웠으면 그 규칙 5번의 생성 브랜치 정리까지 한다.
- **회수**: tmux 백엔드에서는 결과 줄을 처리한 뒤 pane 을 `kill-pane -t <pane>` 으로 거두고
  `select-layout -t dflow tiled` 를 다시 돈다(backends.md 「생존·화면·답·회수」). **`blocked` 는 예외로 두어
  거두지 않는다.** 그 팀원은 답을 기다리며 계속 살아야 하기 때문이다. 워커는 `.result` 를 쓰고 곧 끝나므로
  보통 `remain-on-exit` 가 남긴 죽은 pane 이며, 그것도 `kill-pane` 으로 치운다. Orca 팀원은 회수하지 않는다.
- **차단기**: 결과가 도착한 순서로 `failed`(`no-result`·`rate-limit` 포함, `not-assignee`·해소 워커의 내용 실패(`references/merge-conflict.md` 「6. 차단기」) 제외)가 연속 2건이면 새 spawn 을 멈추고
  보고한다. `failed` 가 아닌 결과가 오면 연속 수를 0 으로 되돌린다. 걸린 동안에는 다음 `TICK` 마다 1건만 시험
  spawn 하고(대기 큐 맨 앞에서, 큐가 비었으면 poll 을 한 번 띄워 얻는다), 그 결과가 `failed` 가 아니면 차단기를
  푼다. 이유: 사용량 한도나 환경 결함에 걸린 채 대기 큐 전체를 소진하지 않게 한다.
  자동 재시작의 `team.lost`(모든 `cause`)도 실패 1건으로 센다(`references/restart.md`). 단 `next=wait` 인 `team.lost` 는 세지 않는다. 걸린 동안의 시험 1건은
  재시작 대기가 새 작업보다 먼저다.
- **중단**: 워커는 `dflow.sh` exit 10 을 받으면 `.result` 에 `cancelled` 를 쓰지만, heartbeat 훅이 먼저 세션을 세우면
  결과 줄 없이 멈춘다. 그래서 결과 줄이 없는 진행 슬롯이라도 생존 증거 2번의 `show` 가 `status=cancelled` 면 결과 줄
  `cancelled`(hash `-`)를 받은 것과 똑같이 처리한다 — 무응답 판정을 기다리지 않는다. tmux 는 `kill-pane` 으로 거두되
  워크트리는 지우지 않는다. 이유: 주문이 종착 상태라 더 올 결과가 없고, 멈춘 세션이 슬롯을 계속 잡으면 대기 큐가 선다.
- **무응답**: 결과도 알림도 없는 진행 슬롯의 생존 증거가 한 `TICK` 동안 변하지 않으면 "무응답" 으로 보고만 하고 슬롯을 유지한다.
  생존 증거에 `show` 의 `last_heartbeat_at`·`heartbeat_phase` 를 넣는다. 워커가 Phase 마다 보내는 값이라 브랜치
  tip 시각보다 촘촘하다. `stale` 은 쓰지 않는다. 그 값은 `claimed_at` 으로부터 24시간이 지났는지일 뿐이라,
  두 시간 전에 죽은 워커에도 `false` 가 온다(2026-09-18 실측).
  느린 팀원을 죽이면 미커밋분을 잃고, 권한 확인에 걸려 멈춘 팀원은 사람이 보면 풀리기 때문이다. 자동 정리는
  **두 TICK 연속으로** 생존 증거가 없을 때만 한다. tmux 는 `kill-pane` 으로 팀원을 멈추고 슬롯을 해제하며,
  워크트리는 고아 정리 규칙을 따른다. Orca 는 팀원 프로세스를 멈출 수단이 워크트리 삭제뿐이므로, 깨끗하고
  push 된 경우에만 `orca worktree rm --worktree path:<경로>` 로 정리하고 슬롯을 해제한다. 그렇지
  않으면 슬롯을 계속 잡고 "사람 확인 필요" 로 보고한다. 자동 정리한 작업은 영구 제외에 넣고 **"멈춤" 표**에 넣는다
  (사유 `무응답`).
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
  terminal`(backends.md, 「SendMessage 가 닿지 않을 때」와 같은 주입 경로)로 그 팀원 화면에 다음을 넣는다:
  "[팀장 지시 <id8>] 서브에이전트 @<TSK>-<phase> 는 이미 끝났다(finished). 백그라운드 완료 알림은 오지 않는다 —
  프로세스(`pgrep` 등)와 산출물(커밋·파일)을 직접 확인하고, 남은 작업이 없으면 게이트를 직접 돌려라."
  **자동 정리·자동 재시작과의 관계**: 주입이 오케스트레이터를 깨우면 다음 `TICK` 의 생존 증거(커밋·미커밋
  목록 등)가 바뀌어 "두 `TICK` 연속 무변화" 조건이 깨지므로, 위 무응답 자동 정리(`kill-pane`)도
  `references/restart.md` 「판정」 의 재시작 후보(`cause=no-response`, (나) 2회째)도 걸리지 않는다. 주입이 먹지
  않아 다음 `TICK` 에도 같은 화면(finished 알림 + 프롬프트)이면 재주입하지 않고 "사람 확인 필요"로 올린다
  (같은 문구를 무한 재주입하지 않는다) — 그 이후로도 두 `TICK` 무변화 조건이 유지되면 기존 자동 정리·자동
  재시작이 그대로 이어받는다(이 절이 그것을 막지 않는다).
- **대기 중인 팀원 판정(2026-09-24, doc-level — 별도 판정 스크립트는 아직 없다)**: `last_heartbeat_at` 은
  갱신되는데 커밋 시각·미커밋 변경 목록·`heartbeat_phase` 가 두 `TICK` 연속으로 그대로이고, tmux 화면
  마지막 줄이 입력 대기 프롬프트(`❯`)로 끝나면 이 팀원은 죽은 것이 아니라 **입력을 기다리며 서 있는
  것이다** — SendMessage 이슈 보고 뒤 지시를 기다리는 경우가 전형적이다(「2-4. 팀원 이슈 보고 처리」).
  이때는 위 무응답 자동 정리(`kill-pane`)를 하지 않고 **"대기 중인 팀원"** 으로 보고만 하며 슬롯을
  유지한다 — heartbeat 가 살아 있는 프로세스를 죽이면 미답 이슈와 미커밋 산출물을 함께 잃는다. 화면은
  다른 곳과 같이 생존 증거로 쓰지 않고 이 판정에만 쓴다(backends.md 「화면은 생존 증거로 쓰지 않는다」와
  같은 원칙). Orca 는 터미널 핸들이 없으면(`-`) 화면을 읽을 수 없으므로 이 판정을 건너뛰고 위 무응답
  규칙만 적용한다.
- **자동 재시작**: 위 자동 정리의 tmux 갈래는 `references/restart.md` 「판정」 이 대신한다. 두 TICK 연속 무변화(또는 결과
  없는 pane 죽음)면 원인을 가려, 재시작 후보는 워크트리를 지우지 않고 pane 만 거둔 뒤 `team.lost` 를 기록하고 같은 기상
  안에 「5-1. 재개 spawn」 으로 다시 띄운다(재시도 상한 3 은 고아 재개와 공유). 영구 제외는 `team.lost` 가 대신한다.
  Orca 는 관문 전이라 위 자동 정리를 그대로 하고 `references/restart.md` 「Orca」 의 한 줄을 더한다.

## 4. 승인 스윕

Skill 도구로 `/dflow-merge` 를 **인자 없이** 실행한다. 자동 머지(`AUTOMERGE_ON`, 「인자」)면 `--on-report` 하나만 붙여
실행한다. 스윕마다 `.dflow`·`.dflow.local`(레거시 `.env`)을 다시 읽어 정한다. 후보가 원격 `origin/agent/*` tip 에서도 오므로 팀장
체크아웃의 state.json 유무와 무관하다. 판정은 서버 `show` 로만 하고 approved 만 머지한다. 후보는 state.json 의
`api_base` 가 팀장의 `api_base` 설정(`.dflow`, 레거시 `DFLOW_API_BASE`)과 같은 것만 받는다. `api_base` 가 없는 로컬 후보는 전제 검사가 시작 전에 막는다(「1. 시작」 `LEGACY_REPORTED`).
- **반려(머지됨)**: 자동 머지로 이미 기본 브랜치에 들어간 작업이 반려되면 `/dflow-merge` 가 "반려(머지됨)" 과 그 위에
  쌓였을 수 있는 작업 목록을 낸다. 팀장은 "main 에 머지된 반려 작업: <id8> (<review_note>). 그 위에 쌓였을 수 있는
  작업: <id8…>. 되돌리기(`git revert -m 1 <머지 커밋>`)나 수동 `/dflow-dev <id8>` 재작업을 사람이 고른다" 로 보고하고
  그 id8 을 영구 제외에 넣는다. 팀장이 스스로 revert 하지 않는 이유: 그 위에 올라간 후속이 반려된 코드에 기대고
  있을 수 있어, 되돌리기가 후속까지 깨뜨리는지는 사람이 판단해야 한다.
- **반려**: 반려로 보고된 id8 은 "반려: 수동 `/dflow-dev <id8>` 대상 (<review_note>)" 로 보고하고 영구 제외에
  넣는다. 재작업은 기존 agent 브랜치 위에서 해야 하므로 자동 배정하지 않는다.
- **다중 경합**: 두 팀장의 스윕이 같은 브랜치를 머지하려 하면 나중 쪽 `git push` 가 non-fast-forward 로
  거부된다. 그러면 `/dflow-merge` 가 머지 직전 HEAD 로 `git reset --keep` 해 되돌리고 "push 실패(경합)" 로 보고한
  뒤 스윕을 멈춘다. 다음 기상의 스윕이 fetch 부터 다시 하며, 그 사이에 머지된 것은 후보에서 빠진다.
- **그 밖의 push 실패**: `/dflow-merge` 는 연결·권한 오류(128 등)를 "push 실패" 로 보고하고 스윕을 멈춘다. 팀장은
  그 스윕을 "중간에 멈춤" 으로 보고하고 정상 완료로 적지 않는다. 머지되지 않은 후보는 다음 기상의 스윕이 다시 본다.
- **push 훅 거부**: `/dflow-merge` 가 `git reset --keep` 으로 되돌리고 "push 실패(훅)" 로 보고한 뒤, 그 작업과 그
  후손만 빼고 다음 후보로 간다. 팀장은 그 id8 을 "사람이 머지해야 함" 으로 보고한다. 이유: 훅이 막는 작업(예:
  스테이징 리허설 트레일러가 없는 마이그레이션) 한 건이 후보 앞쪽에 있어도 뒤의 승인분은 계속 반영돼야 하며,
  스윕을 멈추면 사람이 그 한 건을 풀 때까지 매 기상이 같은 자리에서 멈춘다.
- **머지 충돌**: `/dflow-merge` 가 충돌 파일 목록을 읽고 `git merge --abort` 로 되돌린 뒤 "머지 실패(충돌)" 로
  보고하고(파일 목록 `<파일,…>` 동반) 다음 후보로 간다. 마이그레이션 버전 중복·역순 도착(`/dflow-merge` 「마이그레이션
  버전 관문」)도 머지 전에 같은 문구로 보고된다(끝에 `(마이그레이션 버전)`, 파일은 이 브랜치가 추가한 마이그레이션). 팀장은 그 id8 을 「4-1. 머지 충돌 해소」 로 넘긴다. 해소하지
  못하는 경우(다른 신원의 주문·상한·재시도 불가)만 "사람이 머지해야 함" 으로 보고한다. 팀장 체크아웃은 깨끗하게 남아
  다음 기상의 전제가 깨지지 않는다.
- **공용 결정 기록(`decisions.md`)**: 팀원은 전역 번호 대신 임시 ID `D-<TSK>-<n>` 을 쓰고(dev-discipline
  「공용 결정 기록(decisions.md)의 번호」), `/dflow-merge` 가 머지하며 그 파일의 충돌을 기계적으로 풀고 번호를 매긴다
  (「결정 번호 매김」). 대상 리포에 `merge=union` 을 걸지 않는다 — 같은 필드 줄을 가진 블록을 섞는다. 스윕 보고에
  `UNION_SET <파일>` 이 있으면 "대상 리포 `.gitattributes` 에서 decisions.md 의 `merge=union` 을 빼야 함" 으로 사람에게
  보고한다. 팀장이 그 파일을 직접 고쳐 커밋하지 않는다(대상 리포 설정 변경은 사람 몫). "결정 번호 매김 실패" 는 보고만
  한다(다음 머지가 다시 매긴다).
- 로컬 agent 브랜치 삭제가 브랜치 없음이나 "checked out" 오류로 실패하면 `/dflow-merge` 가 건너뛰고 보고한다.
  그 워크트리는 결과 처리나 고아 스캔이 정리한다.
- 승인 대기·건너뜀(서버 <status>·조회 실패·다른 D'Flow·조상 미승인·기점 미반영·승인 뒤 변경·승인 뒤 변경 확인 불가)은 보고만 한다.
  자동 머지의 "머지됨(승인 전)"·"승인 반영(이미 머지됨)"·"승인 대기(머지됨)" 도 한 줄씩 보고한다.
- **자동 머지 뒤 일시 제외 해제**: 스윕이 "머지됨(승인 전)"·"머지됨" 을 한 건이라도 냈거나 해소 워커가 `resolved` 로 끝났으면(「5-2」), 일시 제외 가운데 사유가
  선행 계열(선행 미충족·선행 미승인·선행 승인 대기·claim exit 4·공통 기점 없음·선행 미반영)인 id8 을 목록에서 빼고, 재기동 조건
  (「2-1」)이 맞으면 줄어든 `--exclude-temp` 로 poll 을 새로 띄운다. **푼 작업을 팀장이 직접 띄우지 않는다.** poll 이
  다시 돌려준 것만 띄운다. 이유: 그사이 담당자가 바뀌었거나 다른 팀장이 가져갔을 수 있는데, 그것을 거르는 곳이
  poll 의 `--scope assigned` 조회다(2026-09-19 mdm-dict-v2: 직접 띄운 작업이 `failed not-assignee` 로 끝났다). 이유: 방금 머지로 풀린 후속이 10주기(30분)를
  기다리면 자동 머지를 켠 의미가 줄어든다. 떠 있던 옛 poll 이 옛 목록으로 한 번 더 돌아도 poll exit 0 처리의 대조와
  spawn 전 확인이 같은 작업을 두 번 띄우지 않게 막는다(「2-3」 5번).
- `team.sweep`(merged, waiting, rejected, resolved 개수)을 기록한다. `resolved` 는 직전 스윕 뒤 해소 워커의 `resolved` 가 조상 확인까지 통과한 수다(없으면 0). `merged` 에는 승인 전 머지를 포함하고, `waiting` 에는
  승인 대기(머지됨)를, `rejected` 에는 반려(머지됨)를 포함한다.
- 머지 자리는 팀장 체크아웃의 상태로 갈린다(`/dflow-merge` 4번). 기본 브랜치 위의 팀장은 그 체크아웃에서
  머지한다. detached HEAD 인 팀장은 임시 머지 워크트리 `<MAIN>/.claude/worktrees/dflow-merge` 에서 머지하고
  `HEAD:<기본브랜치>` 로 push 한다. 팀원은 각자 워크트리의 agent 브랜치나 detached HEAD 에 있으므로 어느 쪽과도
  충돌하지 않는다.
- detached HEAD 인 팀장은 스윕이 끝나면 팀장 체크아웃을 최신으로 옮긴다. 체크아웃이 깨끗할 때만 한다.
  ```bash
  [ -z "$(git branch --show-current)" ] && [ -z "$(git status --porcelain)" ] && git switch -q --detach origin/<기본브랜치>
  ```
  이유: 팀장 체크아웃의 `<TASKS>/*/state.json` 은 `LEGACY_REPORTED` 검사가 읽는다. 옛 커밋에 머물면 이미
  머지된 작업의 옛 state.json 을 보고 재기동을 거부할 수 있다.

### 4-1. 머지 충돌 해소

스윕이 "머지 실패(충돌)" 을 낸 id8 은 `references/merge-conflict.md` 「1. 충돌 접수」 로 넘긴다. 해소는 이 신원의
주문(`mine`)만, 한 작업에 3번까지, 같은 기준에서 다시 충돌한 것이 아닐 때만 한다. 해소 큐에 넣고 「5-2. 해소 spawn」 이
띄운다. 나머지는 "사람이 머지해야 함" 으로 보고한다. 두 경우 모두 좌석표에 `merge_conflict` 표시를 대리로 쏜다. 충돌
목록은 `team.conflict` 로 남는다. 사람이 손으로 머지하면 다음 스윕 기상의 「5. 사람 머지 감지」 가 표시를 푼다. 절차
정본은 그 문서이며 Bash `cat` 으로 읽는다.
```bash
cat .claude/skills/dflow-team/references/merge-conflict.md
```

## 5. 팀원 spawn

0. **입장 제어**: 띄우기 직전마다 「5-3. 입장 제어」 를 먼저 돈다. `CAPACITY_LOW` 면 이번 기상에는 띄우지 않는다(「5-1」·「5-2」 도 같다).
1. 그 id8 이 재구성한 슬롯 표에 있으면 띄우지 않는다. poll 이 겹쳐 떠서 같은 ready 를 두 번 돌려줘도 한 번만
   띄우기 위해서다.
2. 슬롯 번호를 정하고(「팀장 상태」 의 발급 규칙) `AGENT_ID = <신원>/<host>/w<slot>` 을 만든다.
3. TSK 는 show 필터의 `ref`(`.order.item.external_ref`)에서 마지막 `/` 뒤, order 는 `.order.id` 다.
   **4번은 별도 Bash 호출이라 이 줄의 셸 변수를 못 본다 — 그래서 값을 이 자리에서 출력하고, 그 출력을
   4번 포인터에 그대로 옮겨 쓴다.**
   ```bash
   order='<order>'   # show 출력의 .order.id(전체 UUID)를 옮겨 쓴다
   TASK_DIR=$(.claude/skills/dflow-work/scripts/dflow.sh taskdir "$order"); rc=$?
   echo "TASK_DIR=${TASK_DIR:-없음} rc=$rc"
   ```
   로 이 작업의 작업 폴더(`<TASKS>/<TSK>`)를 구한다. `taskdir` 는 순번·id8·전체 UUID 만 받고 `external_ref` 는
   모른다 — `ref` 가 아니라 `order`(전체 UUID, id8 도 된다)를 넘긴다. `rc` 가 0 이 아니면(exit 2
   `PROJECT_MISMATCH`·`AMBIGUOUS_DOCS_DIR`, exit 6 `NO_REF`) **spawn 하지 않는다**: 그 id8 을 일시 제외에 넣고
   사유 `작업 폴더 해석 실패(exit $rc)` 를 보고하며 `team.result`(slot `-`, status `skipped`)를 남긴 뒤 다음
   후보로 간다(위 poll exit 0 갈래의 spec 부재·TSK 없음과 같은 처리). 성공하면 위 출력의 `TASK_DIR` 값을
   4번 포인터의 `TASK_DIR=` 자리에 그대로 옮겨 쓴다.
4. 포인터 **한 줄**을 만든다. 백엔드에는 워커 프롬프트 전문이 아니라 이 포인터를 넘기고, 워커가
   `references/worker-prompt.md` 를 읽어 그 규칙대로 실행한다. 포인터는 치환 변수만 전달한다.
   ```
   <MAIN_CHECKOUT>/.claude/skills/dflow-team/references/worker-prompt.md 를 읽고 그 규칙대로 실행하라. TSK=<TSK> ID8=<id8> AGENT_ID=<신원>/<host>/w<slot> MAIN_CHECKOUT=<팀장 체크아웃 절대경로> BACKEND=pane MODEL=<opus|sonnet|default> DEV_BRANCH=<개발브랜치> TASK_DIR=<작업 폴더> NO_DOCKER=<NO_DOCKER>
   ```
   - `NO_DOCKER` 는 「인자」 의 도커 금지 인원 기준으로 정한 `0`|`1` 이다. 재개(「5-1」)·재시작(restart.md 재투입)은
     이 형식으로 포인터를 다시 쓰고 해소(「5-2」)는 merge-conflict.md 의 해소 포인터에 실으므로, 같은 값이 모두에 간다.
   - `DEV_BRANCH` 는 전제 검사의 `base` 다. 워커가 detach 된 옛 커밋에서 다른 값을 읽지 않도록 팀장이 넘긴다.
   - `TASK_DIR` 은 3번이 출력한 값이다. 워커는 이 값을 다시 해석하지 않는다 — detach 된 옛 커밋에는
     `.dflow.local` 의 `project_map` 이 없거나 지금과 달라, 워커가 스스로 구하면 팀장이 구한 값과 다른
     `TASK_DIR` 이 나올 수 있기 때문이다(`DEV_BRANCH` 와 같은 이유).
   - 전문을 셸 인자로 넘기면 백틱·따옴표·여러 줄이 섞여 깨진다(자동 제출은 한 줄에서 확인됐다).
   - `BACKEND` 는 언제나 `pane` 이다. 두 백엔드 모두 팀원이 화면에서 멈춰 답을 기다리므로 워커가 갈래를 타지
     않는다(worker-prompt.md).
   - 워커 프롬프트 경로를 절대경로로 주는 이유: 새 워크트리에 스킬이 없을 수 있다.
   - 모델은 공백이 든 `--model opus` 를 넘기지 않고 `MODEL=` 로 넘기며, 워커가 `{MODEL_FLAG}` 로 바꾼다
     (`default` 면 빈 값). tmux 백엔드는 같은 값을 `.dflow-run` 의 `claude` 호출에도 붙인다(backends.md).
5. **띄우기 직전** `references/restart.md` 「중단 표식 정리」 블록을 돈다(`order` 는 show 필터의 `order`, `st` 는 `status`).
   `CANCEL_MARK_RM_FAILED` 면 띄우지 않고 그 id8 을 일시 제외에 넣어 사유를 보고한다. 이어서 backends.md 의 해당 절 명령 그대로 띄운다.
   - **pane(tmux)**: 팀장 체크아웃에서
     `git worktree add --detach <MAIN>/.claude/worktrees/dflow-<id8> origin/<기본브랜치>` 로 워크트리를 만들고
     `.dflow.local`(레거시 `.env`)·스킬 링크를 건 뒤, 포인터를 `<워크트리>/.dflow-prompt` 에, 실행 스크립트를 `<워크트리>/.dflow-run`
     에 쓰고, 서버가 없으면 `new-session` 있으면 `split-window` 로 pane 을 띄운다(명령 전문은 backends.md
     「pane(tmux)」). pane id 를 `<워크트리>/.dflow-pane` 에 쓰고, `allow-set-title off` 를 걸고 `select-pane -T` 로 그 pane 에 `w<slot> · <TSK> <id8> · <작업 이름>` 이름표를 붙인다(순서와 테두리 표시 설정은 backends.md. 옵션을 먼저 걸지 않으면 claude 가 제목을 자기 진행 표시로 덮는다). **이어서 폴더 신뢰 확인 루프를 반드시 돈다.**
     그 확인을 넘기지 않으면 팀원이 첫 화면에서 멈춘 채 살아 있어 한 슬롯이 통째로 놀게 된다. 기점은
     `origin/<기본브랜치>` 로 명시하고, 스택 기점은 `/dflow-dev` Phase 01 2번이 claim 전에 맞춘다.
   - **pane(Orca)**:
     ```
     orca worktree create --name dflow-<id8> --agent claude --no-parent \
       --base-branch origin/<기본브랜치> --prompt "<포인터 한 줄>" --json
     ```
     기점은 agent 브랜치가 결국 머지될 `origin/<기본브랜치>` 로 명시한다. 생략하면 리포 기본 base 로 가는데,
     리포 기본 base 설정이 기본 브랜치와 다를 수 있기 때문이다. 결과 JSON 의 `result.worktree.path` 와
     `result.agentTerminalHandle` 을 슬롯 표에 저장한다. 핸들이 없으면(옛 런타임) 화면 읽기 없이 git·서버
     증거만 쓴다. **create 뒤에 같은 포인터를 `<워크트리>/.dflow-prompt` 에도 쓴다**(backends.md). 재개가 슬롯
     번호를 그 파일에서 되찾기 때문이다. 이후 이 워크트리를 가리킬 때는 `--worktree path:<result.worktree.path>`
     선택자를 쓴다.

   팀원을 Agent 도구 서브에이전트로 띄우지 않는다. 서브에이전트는 턴이 끝나면 멈춰 Phase 손자를 기다리지
   못한다.
6. spawn 직후 `team.spawn` 에 `slot`·`tsk`·`order`·`id8`·`worktree`·`handle`·`spawn_kind` 를 남긴다. 새 작업이므로
   `spawn_kind` 는 `new` 다. `worktree` 는 팀원
   워크트리 절대경로(모르면 `-`), `handle` 은 `tmux:<pane_id>` 또는 Orca 터미널 핸들이며 핸들이 없으면 `-` 다.
   재구성이 이 기록으로 슬롯과 작업을 잇는다. id8 을 영구 제외(진행 중)에 넣는다. 빠뜨리면 압축 뒤 재구성이
   그 작업을 놓친다.

같은 작업을 다시 띄우는 것은 다섯뿐이다(다섯째는 「5-2. 해소 spawn」 의 해소 워커다. 주문이 `reported`·`approved` 라 개발 재spawn 이 아니며 `resolve-decide.sh` 판정 안에서만 띄운다). poll 이 그 작업을 다시 돌려준 경우(일시 제외가 풀린 `skipped`,
제외하지 않는 `failed rate-limit`), 고아 스캔이 "재개 가능" 으로 분류한 중단 작업, `--resume` 으로 사람이 지목한
작업, 자동 재시작(`references/restart.md`)이 다시 띄우는 작업이다. 뒤의 셋은 이 절이 아니라 「5-1. 재개 spawn」 의 절차로 띄운다. 워크트리를 새로 만들지 않고 claim 도
하지 않기 때문이다. `blocked` 는 재spawn 하지 않는다. 팀원이 자기 화면에서
답을 기다리므로 그 자리에서 이어 간다(「6. blocked」). 다시 띄울 때 이름·브랜치가 부딪치지 않는 것은
backends.md 「고아 정리 규칙」 5번의 생성 브랜치 정리와 결과 처리의 워크트리 정리가 맡는다.

### 5-1. 재개 spawn

중단된 작업을 이어 띄운다. 새 작업 spawn 과 두 가지가 다르다. **워크트리를 새로 만들지 않고**(남아 있으면
그대로 쓴다) **claim 하지 않는다**. 서버가 이미 `claimed` 이고, 이어받은 워커의 `/dflow-dev --worker` 가 재개
판정으로 끊긴 Phase 를 잇는다.

대상은 넷이다.
- **자동**: 고아 스캔이 "재개 가능" 으로 분류한 워크트리(「팀장 상태」). 빈 슬롯이 있고 차단기가 풀려 있으면
  대기 큐보다 **먼저** 띄운다. 이유: 그 작업은 이미 서버 claim 을 잡고 있어, 새 작업을 먼저 띄우면 점유만 늘고
  진척은 늘지 않는다.
- **요청**: 좌석표의 「이어서 시작」 버튼이 남긴 `resume_requests`(「2-3」). `host` 가 이 PC 인 것만 온다. 이미
  워크트리가 있고 자동 조건도 맞으면 자동 갈래와 같고, 워크트리가 없으면 아래 3항이 새로 만든다. 사람이 화면에서
  누른 것이므로 재시도 상한은 무시한다.
- **재시작**: `references/restart.md` 「재투입」. 결과 줄 없이 멈춘 팀원을 팀장이 그 자리에서 다시 띄운다. 이미 서버
  claim 을 잡고 있어 대기 큐보다 먼저 띄우며, 재시도 상한 3 을 자동 갈래와 나눠 쓴다. 차단기·rate-limit 보류의 통제를 받는다.
- **지목**: 「인자」 의 `--resume <id8>`. 자동 판정의 거부 사유(재시도 상한, `claimed_by` 불일치)를 무시한다.
  워크트리가 없어도 된다. 다만 **서버 status 가 `claimed` 일 때만 재개다.** 지목한 id8 이 `ready` 면 재개가
  아니라 새 작업이므로 5번의 일반 spawn 으로 보내고(claim 은 워커가 한다), `reported`·`approved` 면 개발이
  끝난 것이므로 "재개 대상 아님(서버 <status>)" 로 보고하고 띄우지 않는다. 승인 반영은 「4. 승인 스윕」 이
  한다.

절차:
1. **손실 보고 한 줄을 먼저 낸다.** 사람이 이 줄만 보고 멈출 수 있어야 한다.
   ```
   재개 <id8> <TSK>: 워크트리 <경로|없음> · 브랜치 <agent/…@<head>|없음> · 원격 <origin/agent/…@<sha>|없음>
        · 미커밋 <N파일|없음> · claimed_by=<값>(이 PC|다른 PC) · 잃는 것: <없음|…>
   ```
   ```bash
   git ls-remote --heads origin "refs/heads/agent/<id8>-*"
   git -C <워크트리> status --porcelain | wc -l      # 워크트리가 있을 때만
   ```
   "잃는 것" 은 갈래마다 이렇다. 워크트리가 있으면 `없음`(커밋·미커밋 모두 그대로 이어 간다). 워크트리가
   없고 원격 브랜치가 있으면 `그 PC 의 미커밋 변경(마지막 push 인 <sha> 뒤의 작업)`. 워크트리도 원격 브랜치도
   없으면 `이전 시도 전부(설계 문서 포함) — 사실상 처음부터 시작한다`. 워커는 Phase 06 에서만 push 하므로
   진행 중이던 작업의 원격 브랜치는 대개 없다.
2. **다른 PC 경고**: `claimed_by` 가 이 PC 가 아니면 "그 PC 의 워커가 아직 돌고 있어도 이 팀장은 알 수 없다
   (생존 신호가 서버 DB 에는 있으나 지금 계약의 `show` 가 내주지 않는다). 겹쳐 돌면 같은 브랜치에 두 세션이
   커밋한다" 를 한 줄 더 적는다. 이 갈래는
   `--resume` 으로만 오므로 사람이 지목한 것으로 보고 진행한다.
3. **워크트리 확보**
   - 있으면 그대로 쓴다. 지우지 않는다.
   - 없으면 새로 만든다. 기점은 `origin/agent/<id8>-<slug>` 가 있으면 그것, 없으면 `origin/<기본브랜치>` 다.
     원격 agent 브랜치가 있으면 detach 하지 않고 그 브랜치로 만든다. 이어서 push 해야 하기 때문이다.
     ```bash
     git fetch origin
     git worktree add <MAIN>/.claude/worktrees/dflow-<id8> -B agent/<id8>-<slug> origin/agent/<id8>-<slug>
     ```
     `.dflow.local`(레거시 `.env`)·스킬 링크는 새 작업 spawn(5번)과 같게 건다.
4. **`TASK_DIR` 을 구한다.** 슬롯을 정하고 `.dflow-agent` 를 되돌리기(5항) **전에** 한다 — 실패하면 이 재개
   자체를 접어야 하는데, 이미 되돌린 `.dflow-agent` 는 그 워크트리를 `parked` 아닌 상태로 남겨 다음 기상의
   고아 스캔·전제 검사가 살아 있는 팀원으로 오판하게 만든다. **6·8항은 별도 Bash 호출이라 여기서 구한 값을
   못 보므로, 아래 값을 출력해 그 출력을 6·8항에 그대로 옮겨 쓴다.** 옛 `.dflow-prompt` 의 `TASK_DIR=` 토큰을
   그대로 쓴다(5항의 슬롯 추출과 같은 sed 방식):
   ```bash
   task_dir=$(sed -n 's/.*TASK_DIR=\([^ ]*\).*/\1/p' <워크트리>/.dflow-prompt 2>/dev/null | head -n 1)
   echo "task_dir=${task_dir:-없음}"
   ```
   비어 있으면(`TASK_DIR` 이전에 만들어진 옛 포인터) 다시 구한다:
   ```bash
   id8='<id8>'
   task_dir=$(.claude/skills/dflow-work/scripts/dflow.sh taskdir "$id8"); rc=$?
   echo "task_dir=${task_dir:-없음} rc=$rc"
   ```
   `rc` 가 0 이 아니면(위 항목 1 과 같은 실패 갈래) **재개하지 않는다** — `.dflow-agent` 는 그대로 두고(아직
   건드리지 않았다), 그 id8 을 일시 제외에 넣고 사유 `작업 폴더 해석 실패(exit $rc)` 를 보고하며
   `team.result`(slot `-`, status `skipped`)를 남긴 뒤 다음 후보로 간다. 성공하면 위 출력의 작업 폴더 값을
   아래 `<4항에서 출력된 작업 폴더>` 자리에 그대로 옮겨 쓴다.
5. **슬롯을 정하고 `.dflow-agent` 를 되돌린다.** 슬롯 번호는 `.dflow-prompt` 의 `AGENT_ID=` 에 박힌 번호를
   먼저 쓰고, 그 번호가 이미 찼거나 파일이 없으면 「팀장 상태」 의 발급 규칙으로 새로 낸다.
   ```bash
   slot=$(sed -n 's/.*AGENT_ID=[^ /]*\/[^ /]*\/w\([0-9][0-9]*\).*/\1/p' <워크트리>/.dflow-prompt 2>/dev/null | head -n 1)
   echo "slot=${slot:-없음}"   # 비었거나 이미 찬 번호면 발급 규칙으로 새로 정한 뒤 아래 줄을 쓴다
   printf '%s\n' '<신원>/<host>/w<정한 슬롯>' > <워크트리>/.dflow-agent
   ```
   `slot` 이 빈 채로 두 번째 줄을 쓰지 않는다. `.../w` 로 끝나는 값은 `dflow.sh` 의 `*/parked` 가드에 걸리지
   않아 번호 없는 좌석으로 heartbeat 가 나간다. 파일이 없어 번호를 못 찾는 경우는 `.dflow-prompt` 를 쓰기 전에
   만들어진 옛 Orca 워크트리뿐이며, 그때는 새로 발급한다.
   **이 되돌리기를 워커가 뜨기 전에 한다.** `dflow.sh heartbeat` 는 값이 `*/parked` 면 exit 2 로 거부하므로,
   `parked` 인 채로 띄우면 그 팀원은 좌석표에 진척을 하나도 알리지 못한다.
6. **포인터를 다시 쓴다.** 5번 4항의 형식 그대로이며 `AGENT_ID` 는 5항에서 정한 슬롯, `TASK_DIR` 은
   `<4항에서 출력된 작업 폴더>` 다. 옛 파일을 그대로 두지 않는 이유: 슬롯을 새로 발급한 경우 옛 포인터의
   `AGENT_ID` 와 어긋나 팀원이 남의 좌석으로 heartbeat 를 보낸다. `MODEL` 은 이번 실행의 인자를 쓴다.
7. **띄운다.** 먼저 `references/restart.md` 「중단 표식 정리」 블록을 돈다(`st` 는 재개 판정이 받은 show 의 `status`,
   곧 `claimed`). `CANCEL_MARK_RM_FAILED` 면 띄우지 않고 「멈춤」 표(사유 `중단 표식 삭제 실패`)에 넣는다. 백엔드별 명령은 5번 5항과 같다. tmux 는 `.dflow-run` 을 **있든 없든 새로 쓰고**(새로 만든
   워크트리에는 없고, 남아 있던 것은 옛 모델 인자를 달고 있다) pane id 를 `.dflow-pane` 에 덮어쓴다. **폴더 신뢰 확인 루프를 반드시 돈다.** 넘기면 팀원이 첫 화면에서 멈춘 채 살아 있어 슬롯 하나가
   통째로 논다. Orca 는 포인터를 `--prompt` 로 넘겨 기존 워크트리에 탭을 다시 연다.
8. **옛 `.result` 를 지운다**(`rm -f <워크트리>/<4항에서 출력된 작업 폴더>/.result`). 이유: `failed…` 로 끝난 워크트리를
   `--resume` 으로 이어받으면 옛 결과 줄이 그대로 남아 있는데, 재개한 팀원이 결과를 쓰기 전에 pane 이 한 번
   흔들리면 `PANE_DEAD` 폴백이 그 옛 줄을 읽어 방금 띄운 작업을 다시 실패로 판정한다. 해시가 같아 중복
   처리는 막히지만, 그 슬롯이 빈 것으로 돌아가 같은 작업이 두 번 뜬다.
9. `team.spawn` 을 기록한다. 필드는 5번 6항과 같고 `spawn_kind` 는 `resume` 이다(events.md). 재시도 수를 이
   값으로 세므로, `new` 로 적으면 상한이 동작하지 않는다.

재개한 팀원이 다시 최종 판정 없이 죽으면 다음 기상의 고아 스캔이 같은 판정을 하고, 재시도가 상한(3)에 닿으면
"멈춤"(사유 `재시도 상한`)으로 내려간다. `--resume` 은 그 상한을 무시하므로 사람이 원인을 고친 뒤 다시 지목할
수 있다.

### 5-2. 해소 spawn

해소 큐의 작업을 해소 전용 워커로 띄운다. 워크트리는 `origin/<기본브랜치>` 에 detach 한
`<MAIN>/.claude/worktrees/dflow-<id8>-resolve` 이고, 포인터는 `references/resolve-prompt.md` 를 가리키며, `team.spawn` 의
`spawn_kind` 는 `resolve` 다. 재개 다음·대기 큐보다 먼저 띄우고, 동시에는 `max(1, ⌊인원/2⌋)` 까지다. claim 하지 않는다.
tmux·Orca 띄우기, 신뢰 확인 루프, 이름표(`w<slot> · 해소 <TSK> <id8>`)는 5번과 같다. 절차 정본은
`references/merge-conflict.md` 「2. 해소 spawn」 이고 결과 처리는 같은 문서 「4」 다.

### 5-3. 입장 제어 (spawn 직전 자원 확인)

팀원 세션을 새로 띄우기 직전마다 PC 여유 자원을 본다. 새 작업(「5」)·재개와 재투입(「5-1」)·해소(「5-2」)·차단기의 시험
spawn 모두 해당한다. 이유: 2026-09-24 dmes-standard 에서 10코어·16GB PC 에 팀원 6명이 동시에 무거운 검증을 돌려 load
average 52, 스왑 18GB 중 17GB 까지 올라 PC 전체가 멈추다시피 했다. 이미 모자란 PC 에 팀원을 더 얹지 않는다.
**이미 떠 있는 팀원은 건드리지 않는다**(끄거나 멈추지 않는다). 무거운 명령 자체의 동시 실행은 워커 쪽 `heavy.sh`
(`dev-discipline.md` 「무거운 명령 줄 세우기」)가 따로 묶는다.
```bash
.claude/skills/dflow-team/scripts/capacity.sh --state "$(git rev-parse --git-path dflow-team.capacity)"; echo "rc=$?"
```
- `CAPACITY_OK`(rc=0): 띄운다.
- `CAPACITY_LOW`(rc=1): 이번 기상에는 팀원을 새로 띄우지 않는다. 후보는 대기 큐(재개 대상은 재개 목록)에 그대로 둔다.
  작업 탓이 아니므로 `team.result` 를 남기지 않고 일시 제외에도 넣지 않는다. 다음 기상(늦어도 `TICK`)에 다시 본다.
- `CAPACITY_UNKNOWN`(rc=0): 판정할 수 없는 OS 이거나 측정 명령이 실패했다. 막지 않고 띄운다. 성능 보호이지 보안
  가드가 아니기 때문이다. 일부 항목만 못 읽었으면 `unknown=` 에 적히고 판정은 읽은 항목으로 한다.
- **알림은 줄 끝이 `notify=1` 일 때만 한 줄** 사람에게 한다. `CAPACITY_LOW` 면 "자원 부족으로 새 팀원 보류: <출력 줄>",
  `CAPACITY_OK` 면 "자원 회복, 팀원 spawn 재개", `CAPACITY_UNKNOWN` 이면 "자원 판정 불가(막지 않음): <출력 줄>" 이다.
  `notify=0` 이면 알리지 않는다. 상태 파일(git-path `dflow-team.capacity`)이 마지막 판정과 시각을 담는 기록이며, 판정이
  바뀔 때만 `notify=1` 이 되므로 `TICK` 마다나 컨텍스트 압축 뒤에 같은 알림을 되풀이하지 않는다.
- 기준값의 정본은 `capacity.sh` 머리다. 여유 메모리 30% 미만, 스왑 사용량이 RAM 크기 이상, 5분 load average 가 코어당
  3.0 초과, macOS 메모리 압박 warn 이상 가운데 하나라도 걸리면 `CAPACITY_LOW` 다. 사람이 바꾸려면 팀장 세션의 환경변수
  `DFLOW_CAP_MIN_FREE_PCT`·`DFLOW_CAP_MAX_SWAP_PCT`·`DFLOW_CAP_MAX_LOAD_PER_CPU` 로 덮는다.

## 6. blocked

**공통**: 사람에게 AskUserQuestion 으로 묻지 않는다(자동 루프). 결과 처리가 `team.blocked` 를 기록한다.
PushNotification 도구가 있으면(지연 로드면 ToolSearch 로 불러) 질문 요약으로 한 번 알린다. 없으면 화면 통지만
한다. 그 id8 은 진행 중으로 영구 제외에 남긴다.

**그 슬롯은 blocked 팀원이 계속 잡으며 다른 작업에 재배정하지 않는다.** 살아 있는 프로세스 둘이 같은
`AGENT_ID` 로 heartbeat 를 보내면 좌석표가 한 인물을 두 책상에 그리고 손 든 상태가 새 active 에 덮이기
때문이다. 두 백엔드 모두 팀원이 같은 워크트리·브랜치에서 이어 가며 재spawn 도 재claim 도 없다. `.result` 가
새 줄로 바뀌면 감시 루프가 알린다.

**tmux**: "결정 필요 <id8>: <질문>. `TMUX= tmux -L dflow attach` 로 붙어 그 pane 에서 직접 답하거나, 이 세션에
`<id8> <답>` 으로 답하라" 고 알린다.

**Orca**: "결정 필요 <id8>: <질문>. Orca 의 `dflow-<id8>` 탭에서 답하라" 고 알린다.

**답 매칭(tmux)**
- 답은 `<id8> <답>` 형식으로 받는다. 이유: 여러 팀원의 질문이 동시에 쌓일 수 있다.
- 답을 기다리는 `blocked` 가 하나뿐이면 id8 없이 온 답도 그 작업의 답으로 본다.
- 여럿인데 id8 이 없으면 어느 작업의 답인지 되묻는다. 루프가 돈 뒤 팀장이 사람에게 묻는 곳은 여기 하나다(시작
  전 인자 질문은 「인자」). 답을 엉뚱한
  작업에 넣으면 그 작업이 틀린 결정으로 진행되기 때문이다.
- 답을 넣기 **전에** "그 pane 에 답을 넣는다" 를 한 줄 알린다. 사람이 같은 pane 에 동시에 치면 입력이 섞이기
  때문이다.
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
  `-l --` 로 넣는 이유: `-l` 이 없으면 tmux 가 답을 **키 이름으로 먼저 해석한다.** 실측에서 답이 `Up` 이면
  위쪽 화살표가 눌려 답이 통째로 전달되지 않았고, `Space` 면 공백 하나만 들어가 빈 답이 됐다.
- `PANE_GONE` 이면 그 팀원은 이미 끝났다. 답을 넣지 못하므로 "그 팀원은 이미 끝났다. 수동 `/dflow-dev <id8>`
  대상" 으로 보고하고 영구 제외에 남긴 뒤 슬롯을 해제한다. 워크트리는 「고아 정리 규칙」 을 따른다.
- `ANSWER_SENT` 면 `team.answer`(id8, answer)를 기록한다. 이유: 이 기록이 없으면 컨텍스트 압축 뒤 재구성이
  `team.blocked` 만 보고 이미 답한 질문을 사람에게 다시 통지한다.
- 슬롯은 그대로 둔다. 팀원이 그 자리에서 이어 가므로 새로 띄울 것이 없다.

## 7. 마감

poll exit 8, poll 오류 exit, `failed not-isolated`, 기상 때 확인한 종료 시각 경과, 종료 요청(`STOP_REQUESTED` 또는
사람의 말)으로 온다. 잠금 상실과 lease 상실은 1~6 을 타지
않고 아래 「잠금 상실 마감」·「lease 상실 마감」 으로 간다.
1. 새 spawn 을 멈춘다. 대기 큐는 보고만 하고 비운다.
2. **기다림의 상한**: `blocked` 슬롯과 무응답 슬롯은 기다리지 않는다. 진행 중 슬롯은 마감에 들어선 뒤
   `TICK` 두 번까지만 결과를 기다린다. 이 동안 poll 은 재기동하지 않고 감시 루프만 재기동해 결과와 `TICK` 을
   계속 받는다(「2-3」 의 일은 spawn·poll 만 빼고 그대로 한다). 그 뒤에도 남은 슬롯은 TSK·id8·워크트리 경로·
   마지막 생존 증거를 목록으로 보고한다. 이유: 사람이 자리를 비운 시간대에 답이 오지 않는 슬롯 하나가 팀장을
   무한정 붙잡지 않게 한다. 팀원은 팀장이 끝나도 자기 pane 이나 탭에서 계속 돈다.
   해소 워커도 같은 규칙으로 기다린다. 마감은 남은 `merge_conflict` 표시를 지우지 않는다(사람이 보아야 한다).
3. 집계 표(TSK · id8 · 브랜치 · head · done exit · status · 사유)를 보고하고, 마지막 승인 스윕을 한 번 돈다.
   대기 큐·남은 슬롯과 **"멈춤" 표**(「팀장 상태」 — 재시작 명령 칸까지)도 함께 적는다. 이유: 마감 뒤에 남는
   워크트리는 사람이 이어받는 수밖에 없으므로, 이어받는 방법이 그 자리에 있어야 한다. 이번 실행에서 붙인 문제
   기록이 있으면 `문제 기록 N건 → <MAIN>/docs/dflow-team/issues.md` 를 한 줄 더 적는다(「3. 결과 처리」 문제 기록).
   워크트리는 사람이 이어받는 수밖에 없으므로, 이어받는 방법이 그 자리에 있어야 한다. 재시작 대기와 rate-limit 대기는
   `references/restart.md` 「마감·lease·잠금」 대로 사유와 재시작 명령을 적는다(마감 중에는 재시작하지 않는다).
4. 남은 팀원 워크트리 중 살아 있는 팀원(「팀장 상태」 정의)이 없는 것만 백엔드별로 정리한다. tmux 는
   워크트리가 아직 있을 때만 `git worktree remove --force <경로>`, Orca 는
   `orca worktree rm --worktree path:<경로>` 다. 두 경우 모두 backends.md 「고아 정리 규칙」 을 따라, 깨끗하고
   HEAD 가 `origin/<agent 브랜치>` 와 같을 때만 지우고(생성 브랜치 정리 포함) 나머지는 경로를 보고한다.
   **살아 있는 팀원의 워크트리는 조건과 무관하게 지우지 않는다.** 경로(tmux 는 pane id 도)만 보고에 남긴다.
   이유: 팀원은 팀장이 끝나도 계속 돈다. `blocked` 팀원은 pane 이나 탭에서 답을 기다린다. 깨끗하고 push 된
   순간에 지우면 돌고 있는 팀원의 cwd 가 사라진다. 살아남은 tmux 팀원은 다음 팀장의 재구성이 `.dflow-pane` 과
   `#{pane_start_path}` 로 흡수한다.
   tmux 백엔드에서는 **소켓에 pane 이 하나도 없을 때만** 서버를 거둔다(backends.md 「마감」).
   ```bash
   [ -z "$("$TM" -L dflow list-panes -a -F '#{pane_id}' 2>/dev/null)" ] && "$TM" -L dflow kill-server
   ```
   이 소켓은 **사용자 단위**이지 리포 단위가 아니다. 자기 슬롯 표만 보고 거두면 같은 PC 의 다른 체크아웃에서
   도는 팀장의 살아 있는 팀원이 미커밋 산출물을 안은 채 죽는다. 목록이 비지 않으면 서버를 남기며, 대가는
   서버 하나가 계속 도는 것뿐이고 다음 팀장의 재구성이 그 pane 들을 흡수한다.
   `--force` 는 미추적 부산물(`.result`·`.dflow-agent`·`.dflow-prompt`·`.dflow-pane`·`.dflow-run`·`.dflow.local`
   (레거시 `.env`) 링크·`.dflow` 링크·스킬 링크) 때문에 필요하다.
5. **agent 브랜치는 남긴다.** 승인은 사람이 D'Flow 웹에서 하고, 승인 뒤 머지는 다음 `/dflow-team` 의 스윕이나
   `/dflow-merge` 가 한다.
6. poll 이 떠 있으면 TaskStop 으로 멈추고(태스크 id 를 모르면 종료 시각에 스스로 끝난다), 세대 파일의 세대를
   올려 감시 루프를 끝낸다. `team.stop` 을 기록하고, 좌석표에 감시 종료를 알린 뒤 팀장 잠금 디렉터리를 지운다.
   지우기 전에 「1. 시작」 의 소유 판정(`owner` 의 신원이 자기 `<신원>/<host>/lead` 이고 PID 가 현재
   `$LEAD_PID` 와 같다)을 한 번 더 하고, 참일 때만 지운다. 이유: 이 팀장이 `beat` 를 70분 넘게 놓쳐 다른 팀장이 잠금을 가져갔다면
   그 잠금은 신원·host·리포가 같아도 PID 가 다르며, 지우면 안 된다. events.jsonl 의 `team.start` 시각과 비교하지
   않는 이유: 두 팀장의 이벤트가 같은 `agent`·`repo` 로 섞여, 마지막 `team.start` 가 새 팀장의 것일 수 있다.
   `owner` 를 읽는 `read` 는 `|| true` 로 감싼다. 이유: 파일이 없으면 `read` 가 0 이 아닌 값으로 끝나, 실패에
   멈추는 셸 설정에서는 마감의 나머지가 통째로 건너뛰어진다. 좌석표 종료 신호는 같은 소유 판정이 참일 때만,
   잠금을 지우기 전에 보낸다. 신원을 잠금 `owner` 에서 읽으므로 지운 뒤에는 보낼 수 없기 때문이다.
   ```bash
   LEAD_PID=${CLAUDE_PID:-$PPID}
   LOCK=$(git rev-parse --git-path dflow-team.lock); o_who=; o_ts=; o_pid=
   { read -r o_who o_ts o_pid < "$LOCK/owner"; } 2>/dev/null || true
   if [ "$o_who" = '<신원>/<host>/lead' ] && [ "$o_pid" = "$LEAD_PID" ]; then
     .claude/skills/dflow-work/scripts/dflow.sh watch --agent "$o_who" --stop || :
   fi
   if [ "$o_who" = '<신원>/<host>/lead' ] && [ "$o_pid" = "$LEAD_PID" ]; then
     .claude/skills/dflow-work/scripts/dflow.sh lease release || { rm -f "$(git rev-parse --git-path dflow-team.lease)" "$(git rev-parse --git-path dflow-team.lease).beat"; echo "LEASE_RELEASE_FAILED 3분 뒤 스스로 풀린다"; }
     rm -f "$(git rev-parse --git-path dflow-team.stop)"
     pkill -f "caffeinate -i -w $LEAD_PID" 2>/dev/null || :
     rm -rf "$LOCK" && echo LOCK_RELEASED
   else echo "LOCK_KEPT owner=$o_who $o_ts $o_pid"; fi
   ```
   종료 파일과 절전 방지도 여기서 거둔다. 종료 파일을 남기면 다음 팀장은 전제 검사에서 지우므로 해가 없지만,
   소유가 맞을 때만 지우는 이유는 잠금을 가져간 새 팀장에게 온 요청을 지우지 않기 위해서다.
   lease 는 잠금보다 먼저 반납한다. `dflow.sh lease release` 가 성공하면 그 명령이 스스로 상태 파일과 `.beat` 를
   지우므로, lease 갱신 프로세스는 다음 확인(최대 5초)에서 상태 파일이 없는 것을 보고 스스로 끝난다. **실패하면
   (예: 서버 호출 실패) `dflow.sh lease release` 는 상태 파일을 지우지 않은 채 끝나므로, 이 블록이 대신
   지운다.** 지우는 것이 실제로 갱신 프로세스를 멈추는 신호다 — 지우지 않으면 세션이 살아 있는 한 갱신
   프로세스가 계속 서버에 renew 를 시도해, "3분 뒤 스스로 풀린다" 는 다음 문장이 거짓이 된다(서버 쪽 lease 는
   TTL 로 풀려도 로컬 프로세스는 살아남는다). 반납이 실패해도 마감을 멈추지 않는다.
7. **남은 에이전트 확인**: ListAgents 를 다시 불러 이 세션에 `running` 인 이름 붙은 에이전트가 남아 있으면
   그 이름으로 TaskStop 하고 보고한다. 정상이면 하나도 없다. 팀원과 그 Phase 손자는 별도 프로세스라 이 세션의
   목록에 나타나지 않고, 손자는 팀원이 스스로 회수한다. poll 태스크와 감시 루프는 Bash 태스크라 이
   목록에 없다.

**잠금 상실 마감**(「2-3」 의 `LOCK_LOST`): 위 1~7 중 기다림·마지막 승인 스윕·워크트리 정리·`team.*` 기록·세대
파일 변경·잠금 삭제를 하지 않는다. 떠 있는 poll 을 TaskStop 으로 멈추고 7번을 그대로 수행한 뒤, 집계와 남은
슬롯(TSK·id8·워크트리 경로·pane id)을 "잠금 상실: 이 체크아웃은 다른 팀장이 맡았다" 와 함께 보고한 뒤
끝낸다. 팀원 pane 은 건드리지 않고 `kill-server` 도 하지 않는다. 새 팀장의 재구성이 `.dflow-pane` 으로
흡수하기 때문이다. 이유: 이 세션의 poll 을
멈추는 것은 공유 상태를 건드리지 않으며, 남겨 두면 새 팀장의 poll 과 같은 작업을 두 번 돌려준다. 체크아웃과 이
신원의 워크트리·세대 파일은 이제 새 팀장 것이고, 새 팀장의 재구성은 같은 `agent`·`repo` 의 마지막 `team.start`
이후 이벤트를 읽으므로 이 팀장이 남기는 기록이 새 팀장의 슬롯 표와 제외 목록에 섞인다.

**lease 상실 마감**(「2-3」 의 `LEASE_LOST`): 다른 곳의 같은 신원 팀장이 이 프로젝트를 넘겨받았다. 이 팀장은 즉시
손을 뗀다.
1. "팀장 lease 상실: <사유>. 이 프로젝트는 다른 곳의 팀장이 맡았다" 를 보고한다.
2. 새 claim·새 spawn·승인 스윕·머지를 하지 않는다. 대기 큐는 보고만 하고 비운다.
3. 떠 있는 poll 을 TaskStop 으로 멈추고, 세대 파일의 세대를 올려 감시 루프를 끝낸다. lease 갱신 프로세스는 이미
   끝나 있다(표식을 쓰고 끝난다).
4. **떠 있는 워커는 건드리지 않는다.** 워커는 하던 작업을 끝까지 하고 agent 브랜치 push 와 done 보고를 한다. 그
   결과는 새 팀장의 승인 스윕이 서버에서 이어받는다. 팀원 pane·탭을 닫지 않고 `kill-server` 도 하지 않는다.
5. 「7. 마감」 6번 블록을 그대로 실행한다: 좌석표 감시 종료, `lease release`, 로컬 잠금 삭제(소유 판정이 참일 때).
   그 블록의 `lease release` 는 남의 lease 를 풀지 않는다. 서버가 holder·generation 이 맞는 행만 풀기 때문에
   빼앗긴 lease 에는 0건으로 끝나고, 서버에 닿지 못해 끝난 경우(`LEASE_UNREACHABLE`)에는 아무도 가져가지 않은 내
   lease 를 바로 풀어 준다. 이유(로컬 잠금 삭제): 같은 체크아웃에서 사람이 나중에 팀장을 다시 띄울 수 있어야 한다.
   표식 파일(`dflow-team.lease-lost`)은 다음 시작의 전제 검사가 지운다.
6. 7번(남은 에이전트 확인)을 그대로 한다.
7. 보고에 남은 슬롯(TSK·id8·워크트리 경로·pane id)과 "워커 N명은 하던 작업을 끝낸 뒤 스스로 끝난다" 를 적는다.

## 좌석표 연동

- 팀원의 좌석 식별은 워커가 쓰는 워크트리 루트 `.dflow-agent`(`<신원>/<host>/w<slot>`)다. 좌석표 S1 의 훅이 이
  파일을 `heartbeat_agent` 로 읽는다. `<신원>/<host>/parked` 는 좌석이 아니며 heartbeat 를 보내지 않는다.
- 팀장 자신은 `<신원>/<host>/lead` 다. 같은 신원의 두 PC 팀장이 좌석표에서 하나로 합쳐지지 않게 한다.
- 좌석표 STANDBY 신호: 팀장은 「1. 시작」 6번과 매 기상(「2-3」)에서 잠금 `owner` 의 신원으로
  `dflow.sh watch --agent <신원>/<host>/lead --slots <N> --busy <M> --until '<UNTIL_LABEL>'` 을 1회 보내고, 「7. 마감」에서
  `--stop` 을 1회 보낸다. 좌석표는 마지막 신호 뒤 70분에 STANDBY 를 끈다.
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
  예외 둘(2026-09-23 머지 충돌): (1) 머지 충돌 표시 heartbeat(`merge_conflict` 설정·해제, `references/merge-conflict.md`
  「3」)는 팀장이 한다. 주문 상태를 바꾸지 않고 표시 열만 쓴다. (2) 팀장이 띄운
  해소 워커의 `/dflow-merge --resolve` 가 개발 브랜치에 한 건을 머지·push 한다. "스윕의 머지만 팀장이 한다" 의 유일한
  예외다. 경합은 두 쪽 모두 non-fast-forward 거부로 드러나고, force push 는 여전히 금지다.
- 팀원을 Agent 도구 서브에이전트로 띄우는 것(`isolation: "worktree"` 를 주어도). 서브에이전트는 턴이 끝나면
  하네스가 완료로 보고, 그 뒤 끝난 Phase 손자의 완료가 팀원을 깨우지 못한다. 팀원은 별도 프로세스의 대화형
  claude 다.
- tmux 를 PATH 로 부르는 것. Orca 가 PATH 앞에 끼운 shim 이 잡아 대부분의 명령을 `unsupported command` 로
  거부한다. 언제나 전제 검사가 구한 절대경로(`TM`)로 부른다(backends.md 「진짜 tmux 찾기」).
- 팀원 워크트리에서 팀장이 git 을 조작하는 것(읽기 조회, `parked` 표시, 「5-1. 재개 spawn」 의 `.dflow-agent`
  되돌리기·포인터 재작성·옛 `.result` 삭제, backends.md 의 정리 절차는 예외).
- 팀장 체크아웃에서 poll.sh 를 띄우는 것. 빈 디렉터리(「2-1」)에서만 띄운다.
- 순번 참조, force push, 훅 우회(SKIP_GUARD).
- 같은 작업의 재spawn. 예외는 다섯이다(다섯째: 「5-2. 해소 spawn」 의 해소 워커, `resolve-decide.sh` 판정 안에서만). poll 이 다시 돌려준 작업(일시 제외가 풀린 `skipped`,
  `failed rate-limit`), 고아 스캔이 "재개 가능" 으로 분류한 중단 작업, `--resume` 으로 사람이 지목한 작업,
  자동 재시작(`references/restart.md`)이 다시 띄우는 작업(뒤의 셋은 「5-1. 재개 spawn」). `blocked` 는 재spawn 하지 않는다. 팀원이 자기 화면에서 답을 기다리며 그
  자리에서 이어 간다.
- poll·감시 루프를 셸 `&` 로 띄우는 것. 둘은 Bash `run_in_background` 로만 띄운다. 팀원 spawn 에도 `&` 를
  쓰지 않는다. tmux `split-window` 가 곧바로 돌아오고 pane 은 tmux 서버가 붙잡기 때문이다.
- 인원 6 초과.
