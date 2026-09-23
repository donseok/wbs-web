# 팀원 자동 재시작 — 멈춘 워커를 팀장이 그 자리에서 다시 띄운다 (과제 H, + G 중단 표식)

- 작성: 2026-09-23
- 상위: `docs/idea.md` 「에이전트 스킬」 과제 H(워커 자동 재시작), 과제 G(중단 표식 정리)
- 관련: 과제 B 팀장 lease `docs/superpowers/specs/2026-09-23-dflow-lead-lease-design.md`(origin/staging a8eabc6d)
- 반영 범위: staging 까지. main·dflow-kit 반영은 별도 지시.
- 이 문서는 설계만 한다. 스킬·코드는 이 문서의 구현 계획에서 고친다.

## 0. 근거 표기

로컬 `staging`(HEAD `8bb61c89`)과 `origin/staging`(`a8eabc6d`)이 서로 다른 커밋을 갖고 있다. 로컬에는 작업 폴더
`TASK_DIR` 통일(20건)이, 원격에는 팀장 lease(17건)가 있다. 두 쪽이 머지되면 줄 번호가 밀리므로 인용마다 ref 를 붙인다.

- `@HEAD` — 로컬 `staging` 작업 트리. 표기가 없는 인용도 `@HEAD` 다.
- `@os` — `origin/staging`(lease 가 들어간 판).

## 1. 배경

### 1-1. 지금 팀장이 멈춘 워커를 다루는 방식

| 상황 | 지금 동작 | 근거 |
|---|---|---|
| 생존 증거 | HEAD 커밋 시각 · 서버 마지막 progress · 미커밋 diff 해시. 셋 중 하나라도 직전 TICK 과 다르면 살아 있다. 화면은 쓰지 않는다 | `.claude/skills/dflow-team/SKILL.md:951-963` |
| 한 TICK 무변화 | "무응답" 보고만 하고 슬롯 유지 | `SKILL.md:1032` |
| 두 TICK 연속 무변화(약 60분) | tmux 는 `kill-pane` 과 슬롯 해제. Orca 는 깨끗하고 push 된 경우에만 워크트리 삭제, 아니면 슬롯을 쥔 채 "사람 확인 필요". 어느 쪽이든 영구 제외에 넣고 「멈춤」 표(사유 `무응답`)에 올린다 | `SKILL.md:1036-1041` |
| 결과 줄 없이 pane 이 죽음 | 죽은 pane 화면에서 결과 줄을 찾고, 없으면 **곧바로** `failed no-result`. 영구 제외, 「멈춤」 표, 차단기 계산 | `SKILL.md:942-947`, `:1010` |
| 서버 주문이 `cancelled` | 결과 줄이 없어도 `show` 가 `cancelled` 면 `cancelled` 결과처럼 처리한다. 무응답 판정을 기다리지 않는다 | `SKILL.md:1028-1031` |
| 고아 워크트리 재개 | 팀장 **시작** 때 고아 스캔이 "재개 가능"(브랜치 있음·최종 판정 없음·서버 `claimed`+`mine`+같은 host·재시도 3 미만)을 가려 「5-1」 로 띄운다 | `SKILL.md:307-343` |
| 재시도 수 | events.jsonl 에서 마지막 `team.result` 이후의 `spawn_kind=="resume"` 인 `team.spawn` 개수 | `SKILL.md:320-337`, `references/events.md:28-33` |
| 차단기 | `failed…`(`not-assignee`·`cancelled` 제외)가 연속 2건이면 새 spawn 을 멈추고, TICK 마다 1건만 시험 | `SKILL.md:1024-1027` |
| `--resume` 지목 | 상한과 `claimed_by` 불일치를 무시한다 | `SKILL.md:1174`, `:1251-1253` |
| 재개 절차 | 워크트리를 새로 만들지 않고 claim 도 하지 않는다. `.dflow-agent`·`.dflow-prompt`·`.dflow-run` 을 다시 쓰고 옛 `.result` 를 지운다 | `SKILL.md:1161-1249` |
| 재개한 워커 | 산출물 실재 기준으로 끊긴 Phase 를 잇고, `claimed`+`mine` 이면 다시 claim 하지 않는다 | `.claude/skills/dflow-dev/SKILL.md:66-75` |

### 1-2. 빈 곳

- 무응답 정리와 `failed no-result` 뒤에 **그 자리에서 다시 띄우지 않는다.** 재개는 팀장을 다시 시작하거나
  사람이 `--resume` 을 줄 때만 일어난다. 밤새 도는 팀장은 워커 하나가 죽으면 아침까지 그 작업을 붙잡고만 있다.
- `failed no-result` 는 `team.result` 로 기록된다(`references/events.md:41`). 재시도 수는 마지막 `team.result`
  에서 0 으로 돌아가므로(`SKILL.md:331`), 지금 방식대로 "죽으면 결과를 적고 다시 띄운다" 를 붙이면 **상한 3 이
  영영 닿지 않는다.** H 의 핵심은 이 카운터를 어떻게 지키느냐다(§5).
- 오피스는 마지막 신호 뒤 5분이면 STALE, 30분이면 OFFLINE 으로 그린다(`src/lib/domain/seatState.ts:16-17`). 팀장이
  손을 대는 시각(약 60분)과 시간축이 다르다.

### 1-3. G 결함 — 중단 표식이 지워지지 않는다

heartbeat 훅은 서버가 `409 code=cancelled` 를 주면 `~/.dflow/hb/<order>.cancelled` 표식을 쓰고 세션을 세운다
(`kit/hooks/heartbeat.sh:114-125`). 표식이 있는 동안은 60초 절제와 무관하게 도구를 부를 때마다 다시 세운다
(`:64-70`). 표식을 **지우는 코드는 어디에도 없다.** 문서만 "같은 주문을 다시 위임받아 이어 갈 때 지운다" 고
적는다(`.claude/skills/dflow-dev/SKILL.md:56-58`, `kit/README.md:82`).

전제를 하나 바로잡는다. 과제 목록은 "같은 주문을 다시 띄우는 H 경로가 생기면 훅이 세션을 계속 죽인다" 고
적었는데, **정상 경로로는 같은 주문이 되살아나지 않는다.**
- `cancelled` 는 종착 상태다. 전이 표가 `cancelled: []` 다(`src/lib/domain/agentWork.ts:43-50`).
- 다시 맡기면(위임 체크를 다시 켜면) **새 주문**이 생긴다(`SKILL.md:1015`). 표식은 주문 UUID 로 찾으므로
  새 주문과 겹치지 않는다(`heartbeat.sh:66-68`, 테스트 `tests/skills/heartbeat-hook.test.ts:212-217`).

그래도 H 와 맞물리는 실제 경로가 둘 있다.
1. **UUID 가 겹치는 다른 서버.** `staging:sync` 는 운영 `public` 스키마를 데이터째 떠서 스테이징에 붓는다
   (`scripts/staging-sync.mjs:79`, `pg_dump --schema=public`). 그래서 운영과 스테이징의 주문 UUID 가 같다. 표식
   파일 이름에는 `api_base` 가 없으므로, 스테이징에서 중단한 주문의 표식이 운영에서 `claimed` 인 같은 UUID 의
   세션을 세운다(반대 방향도 같다). 이 세션은 결과 줄 없이 멈춰 무응답이 되고, H 가 다시 띄우면 첫 도구 호출에서
   또 선다. 상한 3 까지 헛돈다.
2. **`show` 실패.** 지금의 중단 처리(`SKILL.md:1028-1031`)는 생존 증거 2번의 `show` 가 성공해야 돈다. `show` 가
   실패한 TICK 에는 `cancelled` 를 알아채지 못한다(`:960`). 훅에 세워진 세션이 그대로 무응답으로 보이고, H 가 그
   주문을 다시 띄우면 표식에 또 선다.

둘 다 "재시작 전에 서버 status 를 확인하고, 서버가 살아 있다고 말하는 주문의 표식은 지운다" 로 막힌다(§8).

## 2. 사용자 결정(2026-09-23)

1. 자동 재시작 대상은 **무응답**(두 TICK 무증거)과 **pane 이 결과 없이 죽음**뿐이다. **rate-limit** 은 한도 해제 시각
   뒤 1회 재시작한다. 권한 거부·`blocked`·취소는 재시작하지 않고 사람에게 알린다.
2. 재시도 상한은 기존 상한 3 을 **공유**한다(고아 재개와 같은 카운터). 닿으면 「멈춤(재시도 상한)」.
3. 감지 속도는 현행(30분 TICK × 2)을 유지한다. 오피스의 「자동 재시작 예정 시각」 표시는 비용을 보고 제안한다.

## 3. 결정 표

| # | 결정 | 이유 |
|---|---|---|
| H1 | 재시작 판정은 TICK 기상과 `PANE_DEAD` 기상에서만 한다. 판정 순서는 서버 status → 한도 → 화면 결과 줄 → 원인 없음(무응답·죽음) 이다(§4) | 원인이 확실한 것부터 걸러야 "재시작하면 안 되는 것" 을 재시작하지 않는다 |
| H2 | **재시작 전제**: `show` 가 성공하고 `status=claimed`·`mine=true`·`claimed_by` 가 이 PC 다. 하나라도 아니면 그 기상에서는 재시작하지 않는다. `show` 실패는 다음 TICK 에 다시 판정한다 | fail-closed. `show` 실패를 "살아 있는 주문" 으로 읽으면 중단된 주문을 되살린다(§1-3 2) |
| H3 | 자동 재시작으로 처리하는 손실은 **새 이벤트 `team.lost`** 로 기록하고 `team.result` 를 쓰지 않는다 | `team.result` 가 재시도 수를 0 으로 되돌린다(§1-2). 상한을 공유하려면 손실이 카운터를 끊지 않아야 한다 |
| H4 | 재시도 수 공식은 **그대로 둔다**(마지막 `team.result` 이후 `resume` spawn 수). 자동 재시작도 `spawn_kind=resume` 으로 기록한다 | 사용자 결정 2(같은 카운터). 공식을 바꾸지 않으면 고아 스캔·재구성·테스트가 같은 한 줄을 계속 쓴다 |
| H5 | 상한에 닿으면 `.dflow-agent` 를 `parked` 로 바꾸고 「멈춤」 표(사유 `재시도 상한`)에 올린다. 이때도 `team.result` 를 쓰지 않는다 | `team.result` 를 쓰면 다음 팀장 시작의 고아 스캔이 재시도 0 으로 읽고 또 재개한다 |
| H6 | 재투입은 「5-1. 재개 spawn」 을 그대로 쓴다. **같은 워크트리를 이어받고, 슬롯 번호도 같게**(`.dflow-prompt` 의 `AGENT_ID`) 쓰며, **claim 하지 않는다** | 5-1 이 이미 워크트리 유지·claim 생략·포인터 재작성·옛 `.result` 삭제를 한다. 같은 슬롯이면 오피스의 같은 책상에 다시 앉는다 |
| H7 | 무응답·pane 죽음은 **같은 기상 안에서** 곧바로 재투입한다. 재투입 대상은 새 작업보다 먼저 빈 슬롯을 받는다 | 이미 서버 claim 을 쥔 작업이다(`SKILL.md:1168-1170` 과 같은 이유) |
| H8 | rate-limit 은 **감지 때 pane 을 죽이지 않는다.** 해제 시각 + 10분까지 기다린 뒤 생존 증거를 다시 재어, 변했으면 살아난 것으로 이어받고 그대로면 그때 1회 재시작한다 | 이 PC 의 Claude Code(2.1.280)는 한도가 풀리면 스스로 이어 가는 문구를 갖고 있고, "대기 중에 종료되면 스스로 이어 가지 않는다" 는 문구도 있다(§6-1). 감지 때 죽이면 자동 이어 가기를 없앤다 |
| H9 | rate-limit 은 1회만 재시작한다. 마지막 `team.result` 이후 `cause=rate-limit` 인 `team.lost` 가 둘째면 재시작하지 않고 「멈춤」(사유 `rate-limit 반복`)으로 내린다. 이 1회도 상한 3 에 들어간다 | 사용자 결정 1·2 |
| H10 | rate-limit 대기 중에는 **새 spawn 을 모두 보류한다**(새 작업·재시작 모두). poll 도 다시 띄우지 않는다 | 한도는 계정 단위다. 팀장·팀원이 같은 로그인(같은 `~/.claude`)을 쓰므로 누구를 띄워도 같은 벽에 선다 |
| H11 | `team.lost` 는 차단기에서 `failed…` 와 같이 **실패 1건으로 센다.** 재시작은 차단기의 통제를 받는다(걸리면 TICK 마다 시험 1건, 재시작 대상이 시험 우선) | 여러 슬롯이 한꺼번에 죽는 것은 환경 결함 신호다. 재시작만 차단기 밖에 두면 결함 속에서 재시작이 슬롯을 계속 태운다 |
| H12 | 재시작하지 않는 원인은 현행대로 알린다: 권한 거부·`blocked`·`cancelled`·그 밖 `failed…`·`pane_dead_status` 127(claude 없음)·서버 status 가 `claimed` 가 아님·`state.json` 이 이미 `cancelled` | 사용자 결정 1. 127 은 다시 띄워도 같은 자리에서 죽는 환경 결함이다 |
| H13 | Orca 백엔드도 같은 판정을 한다. 재투입 명령(`orca terminal close` + `orca terminal create`)은 **실측 관문**을 통과한 뒤에만 켠다. 관문 전에는 Orca 는 분류·알림·재시작 명령 안내까지만 한다 | Orca 에는 pane 이 없어 죽음 감지는 무응답 하나뿐이고, 새 명령 조합이 팀원을 권한 확인 생략 모드로 띄우는지 확인된 바 없다(§7) |
| G1 | 팀장은 **모든 spawn(새 작업·재개·재시작) 직전**에, `show` 의 status 가 `ready` 나 `claimed` 이면 그 주문의 `~/.dflow/hb/<order>.cancelled` 를 지운다 | 서버가 살아 있다고 말하는 주문의 표식은 낡은 것이다. 새 세션의 첫 도구 호출 전에 지워야 한다(훅은 절제보다 표식을 먼저 본다) |
| G2 | 워크트리의 `state.json` 이 이미 `phase=cancelled` 인데 서버가 `claimed` 면 자동 재시작하지 않고 「멈춤」(사유 `중단 표식 불일치`)으로 내린다 | 훅의 `stop_now` 가 phase 를 바꿔 둔 트리다(`heartbeat.sh:53-58`). `/dflow-dev` 는 `cancelled` 를 재개 판정에서 건너뛰므로(`dflow-dev/SKILL.md:58`), 그대로 띄우면 이어 가지 못한다. 사람이 phase 를 되돌릴지 판단한다 |
| G3 | 훅(`heartbeat.sh`)은 고치지 않는다. 문서 두 곳(`dflow-dev/SKILL.md:56-58`, `kit/README.md:82`)의 "재위임 시 지운다" 를 "팀장이 spawn 직전에 서버 status 로 확인하고 지운다. 수동 세션은 사람이 지운다" 로 고친다 | 훅은 매 도구 호출마다 도는 곳이라 네트워크 없이 표식만 봐야 한다. 표식 정리는 서버를 이미 조회하는 팀장이 하는 편이 싸다 |
| U1 | 감지 속도는 현행 유지(결정 3) | — |
| U2 | 오피스 「자동 재시작 예정 시각」 표시는 **이번 범위 밖**이다. 팀장 텍스트 보고에만 싣는다(§10) | 서버 계약·저장소·화면 세 층과 마이그레이션이 필요하다 |

## 4. 재시작 판정 흐름

### 4-1. 판정 시점

| 기상 | 누구를 보나 |
|---|---|
| `TICK` | 결과 줄 없는 진행 슬롯 전부(`blocked` 제외), 그리고 `team.lost` 로 대기 중인 id8 |
| `PANE_DEAD <경로>`(tmux) | 그 슬롯. `.result` 가 있으면 현행대로 결과 처리이고, 판정은 결과 줄이 없을 때만 한다 |
| 그 밖 | 판정하지 않는다 |

`LEASE_LOST` 기상과 「7. 마감」 중에는 재시작하지 않는다(§9).

### 4-2. 원인 분류

진행 슬롯 하나마다 아래를 위에서부터 보고, 처음 맞는 줄에서 멈춘다.

| 순서 | 조건 | 분류 | 처리 |
|---|---|---|---|
| 1 | `show` 실패 | 측정 실패 | 이번 기상에는 아무것도 하지 않는다. 증거 비교에서 2번을 뺀다(현행 `SKILL.md:960`) |
| 2 | `show` 의 status 가 `cancelled` | 중단 | 현행 중단 처리(`SKILL.md:1028-1031`). 재시작 없음 |
| 3 | status 가 `claimed` 가 아니다(`ready`·`reported`·`approved`) 또는 `mine`·같은 host 가 아니다 | 점유 변동 | 재시작 없음. 「멈춤」(사유 `서버 <status>` 또는 `다른 PC claim`) |
| 4 | 워크트리 `state.json` 이 `phase=cancelled` | 표식 불일치 | 재시작 없음. 「멈춤」(사유 `중단 표식 불일치`, G2) |
| 5 | 한도 신호가 있다(§6) | rate-limit | §6-3 의 대기로 간다. **첫 무증거 TICK 에서도 바로 간다**(두 TICK 을 기다리지 않는다) |
| 6 | tmux 이고 pane 이 죽었다 | pane 죽음 | 죽은 pane 화면 폴백(현행). 결과 줄이 있으면 그 결과로 처리한다. 없고 `pane_dead_status` 가 127 이면 현행 `failed no-result`(재시작 없음, H12). 그 밖이면 **재시작 후보** |
| 7 | 생존 증거가 두 TICK 연속 무변화 | 무응답 | **재시작 후보** |
| 8 | 한 TICK 무변화 | 무응답 1회 | 현행대로 보고만 한다 |

화면(tmux `capture-pane`, Orca `orca terminal read`)은 5번의 원인 분류와 6번의 결과 줄 폴백에만 쓴다. **생존
판정에는 여전히 쓰지 않는다**(`SKILL.md:961-963` 의 규칙 유지).

### 4-3. 재시작 후보를 띄울지

재시작 후보(6·7번)마다 이렇게 가른다.

| 조건 | `team.lost` 의 `next` | 처리 |
|---|---|---|
| 재시도 수(§5-2) ≥ 3 | `park` | `.dflow-agent` 를 `parked` 로, 「멈춤」(사유 `재시도 상한`). `team.result` 는 쓰지 않는다(H5) |
| 차단기가 걸렸거나 rate-limit 보류 중이고, 이번이 시험 1건이 아니다 | `wait` (`restart_at` = `-`) | 슬롯만 해제한다. 다음 TICK 에 다시 본다 |
| 그 밖 | `restart` | 같은 기상에서 §5-3 의 재투입 |

tmux 는 `restart`·`wait` 전에 pane 을 `kill-pane` 으로 거둔다(무응답은 pane 이 살아 있다). `park` 도 거둔다.
Orca 는 §7.

### 4-4. 사람에게 알리는 한 줄

| 분류 | 한 줄 |
|---|---|
| 재시작 | `<TSK> <id8> 재시작(<무응답|pane 죽음>, <n>/3) — 워크트리 <경로> 이어받음` |
| rate-limit 대기 | `<TSK> <id8> 사용량 한도 — <HH:MM> 이후 다시 봅니다. 그때까지 새 배정 보류` |
| 상한 | `<TSK> <id8> 멈춤(재시도 상한) — 재시작 명령: /dflow-team <종료시각> --resume <id8>` |
| 그 밖 멈춤 | 현행 「멈춤」 표(`SKILL.md:344-362`)에 사유를 적는다 |

## 5. 이벤트와 카운터

### 5-1. 새 이벤트 `team.lost`

`references/events.md` 의 이벤트 표(`:10-19`)와 가드의 `$req` 표(`:69`)에 더한다.

| 이벤트 | 시점 | 추가 필드 |
|---|---|---|
| `team.lost` | 「3. 결과 처리」 재시작 판정(§4) | `slot`, `id8`, `worktree`, `cause`, `next`, `restart_at` |

- `cause`: `no-response` · `pane-dead` · `rate-limit` 중 하나.
- `next`: `restart`(곧바로 재투입) · `wait`(기다렸다 재투입) · `park`(멈춤).
- `restart_at`: 재투입을 다시 볼 시각. epoch 초 문자열이며, 시각이 정해지지 않았으면 `-`. `restart`·`park` 는 늘 `-` 다.
- 가드 규칙은 기존과 같다. 모르는 값은 `""` 가 아니라 `-` 로 쓴다(`references/events.md:80`). 가드 `$req` 에
  `"team.lost":["slot","id8","worktree","cause","next","restart_at"]` 를 더하지 않으면 줄이 `EVENT_ARGS_MISSING` 으로
  거부된다(`:69-71`).
- 기본 필드 `tsk`·`order` 도 채운다.

### 5-2. 카운터 규칙

- **재시도 수** = 그 id8 의 마지막 `team.result` 이후 `spawn_kind=="resume"` 인 `team.spawn` 개수. 공식과 명령
  블록(`SKILL.md:327-331`)은 바꾸지 않는다. `team.lost` 는 세지도 끊지도 않는다.
- 자동 재시작의 `team.spawn` 은 `spawn_kind=resume` 이다(H4). 고아 재개·「이어서 시작」 요청과 같은 값이라 한
  카운터를 나눠 쓴다. 사람이 누른 「이어서 시작」 과 `--resume` 이 상한을 무시하는 규칙(`SKILL.md:1173-1174`)은 그대로다.
- **rate-limit 횟수** = 마지막 `team.result` 이후 `event=="team.lost" and cause=="rate-limit"` 개수. 2 이상이면 재시작하지
  않는다(H9).
  - (2026-09-23 리뷰 보충) "1회" 는 **한도 에피소드** 기준이다. 에피소드는 첫 rate-limit `team.lost`(`next=wait`)부터 재개 성공까지이며 `team.result` 와 `readopt` spawn(워커가 스스로 이어 감)에서 끊긴다. 스스로 이어 간 뒤 새 한도면 새 에피소드다. 재투입(`resume`)은 끊지 않는다.
- 둘 다 `team.start` 로 구간을 자르지 않는다. 팀장을 다시 띄워도 이어진다.

### 5-3. 재구성·제외·차단기 규칙에 더할 것

| 규칙 | 지금 | 더할 것 |
|---|---|---|
| 제외 목록(`SKILL.md:278-281`, `events.md:47-49`) | id8 마다 마지막 `team.spawn`·`team.blocked`·`team.result` | 마지막이 `team.lost` 면 **영구 제외(진행 중과 같음)**. poll 이 돌려주지 않게 한다 |
| 재시작 대기 목록(새) | — | 마지막 이벤트가 `team.lost` 이고 `next` 가 `restart`·`wait` 인 id8. `restart` 가 남아 있으면 기록 뒤 spawn 전에 컨텍스트 압축을 겪은 것이므로 다음 기상에 재투입한다(5-1 은 반복해도 같은 결과를 낸다) |
| 차단기 복원(`SKILL.md:275-276`) | 끝에서부터 연속한 `failed…` 수 | `team.lost`(모든 `cause`)도 실패 1건으로 센다(H11). `failed` 가 아닌 `team.result` 가 0 으로 되돌린다 |
| 고아 스캔 "재개 가능"(`SKILL.md:312-320`) | 네 조건 | 다섯째: 그 id8 의 마지막 `team.lost` 가 `cause=rate-limit`·`next=wait` 이고 `restart_at` 이 아직 오지 않았으면 재개하지 않고 그 시각까지 둔다. `team.start` 로 자르지 않고 찾는다(카운터와 같은 이유) |
| 「1. 시작」 4번 재기록(`SKILL.md:683-688`) | 흡수한 슬롯·답 대기·처리 해시 | 재시작 대기 목록은 재기록하지 않는다. 새 `team.start` 뒤에는 고아 스캔이 같은 워크트리를 "재개 가능" 으로 잡고, rate-limit 대기는 위 다섯째 조건이 지킨다 |
| poll 재기동 조건(`SKILL.md:755-759`) | 빈 슬롯·대기 큐 빔·차단기 풀림 | rate-limit 보류가 없을 것(H10) |

### 5-4. 재투입 절차

「5-1. 재개 spawn」(`SKILL.md:1180-1249`)을 그대로 따르고 아래만 다르다.

1. **손실 보고 한 줄**(1항)은 §4-4 의 재시작 줄로 바꾼다. 워크트리가 있으므로 "잃는 것" 은 늘 `없음` 이다.
2. **워크트리**(3항): 있는 것을 그대로 쓴다. 무응답 자동 정리가 하던 "고아 정리 규칙대로 지움"(`SKILL.md:1037-1040`)을
   재시작 후보에는 하지 않는다. 깨끗하고 push 된 워크트리도 지우지 않는다. 지우면 5-1 이 원격 브랜치에서 다시
   만들어야 하고, 그 사이 미추적 `.issues` 를 잃는다.
3. **슬롯**(5항): `.dflow-prompt` 의 `AGENT_ID` 번호를 쓴다. 방금 pane 을 거둬 그 번호가 비어 있으므로 대개 같은
   번호다. 이미 찼으면 발급 규칙으로 새로 낸다(현행).
4. **표식 정리**(새, G1): 7항(띄우기) 직전에 §8 의 블록을 돈다.
5. **claim**: 하지 않는다. 주문은 `claimed`·`mine` 이며(H2 가 확인했다), 이어받은 `/dflow-dev --worker` 가 재claim 을
   건너뛴다(`dflow-dev/SKILL.md:73-75`).
6. `team.spawn`(`spawn_kind=resume`)을 기록한다(9항). `team.lost` 는 그보다 먼저 기록한다.

## 6. rate-limit

### 6-1. 조사 결과 — 해제 시각을 어디서 얻나

| 출처 | 쓸 수 있나 | 근거 |
|---|---|---|
| 워커 `.result` 의 `failed rate-limit <사유>` | **거의 못 쓴다.** 계정 한도에 닿으면 워커 메인 세션도 모델 턴을 못 돌려 결과 줄을 쓰지 못한다. 이 줄이 오는 것은 Phase 서브에이전트가 짧은 API 429 를 받고 워커가 아직 돌 때뿐이며, 사유는 자유 문구라 시각이 없다 | `references/worker-prompt.md:194` |
| 워커 화면 | **쓸 수 있으나 문구가 확정되지 않았다.** 이 PC 의 CLI(2.1.280) 바이너리에 `limit resets`·`this limit resets`·`resets in`·`continuing automatically when it resets`·`Claude Code exited during the wait, so the task will not resume on its own when the usage limit resets` 같은 조각이 있다(`strings` 로 확인). 실제 화면 문장과 시각 형식(`3pm`·`15:00`·시간대 표기)은 캡처로 확인해야 한다 | 바이너리 문자열 |
| statusLine 입력 JSON | **구조화된 값이 있다.** statusLine 명령이 받는 입력에 `rate_limits.five_hour`·`rate_limits.seven_day`(각각 `used_percentage`, `resets_at` = Unix epoch 초)가 실린다. 구독자이고 첫 API 응답 뒤에만 있다 | 바이너리 문자열의 statusLine 스키마 주석 |
| 팀장 자신 | 팀장도 같은 계정이다. 한도 중에는 팀장도 기상 처리를 못 한다. 팀장이 TICK 을 처리하고 있다는 것 자체가 (모델별 한도가 아니라면) 한도가 풀렸다는 방증이다 | 같은 `~/.claude` 로그인 |

### 6-2. 채택 — 세 출처를 차례로 본다

1. **statusLine 덤프(tmux 만)**: `.dflow-run`(`references/backends.md:72-85`)의 `claude` 호출에 `--settings` 로
   statusLine 을 붙여, 입력 JSON 의 `.rate_limits` 를 `~/.dflow/limits/<id8>.json` 에 쓰게 한다. **워크트리 밖에
   쓴다.** 워크트리 안에 쓰면 `git status --porcelain` 이 더러워져 `DIRTY` 검사와 고아 정리 규칙 2번이 깨진다.
   한도 판정: 어느 창이든 `used_percentage >= 100` 이면 한도이며, 해제 시각은 그런 창의 `resets_at` 중 가장 늦은 것이다.
2. **화면 문구**: 1이 없거나(Orca, 구독 아님, 파일 없음) 한도가 아니라고 나오면 화면 마지막 40줄에서 한도 문구를
   찾는다. 문구가 있으면 한도이며, 시각을 읽을 수 있으면 그 시각을 쓴다(오늘 그 시각이 지났으면 내일).
3. **폴백**: 한도는 확실한데 시각을 모르면 `restart_at` = 감지 시각 + 60분.

`restart_at` = 해제 시각 + 10분(유예). 유예를 두는 이유: 자동 이어 가기가 있으면 그 사이에 워커가 스스로 돈다.

### 6-3. 대기와 재시작

| 때 | 처리 |
|---|---|
| 감지 | `team.lost`(`cause=rate-limit`, `next=wait`, `restart_at`). **pane 을 죽이지 않고 슬롯을 그대로 쥔다.** 이 때의 생존 증거 값을 함께 남긴다(슬롯 표의 "직전 생존 증거"). 보류 시작(H10) |
| 대기 중 TICK | 그 슬롯은 무응답 판정에서 뺀다(같은 한도를 두 번 세지 않는다) |
| `restart_at` 이 지난 TICK | 생존 증거를 다시 잰다. **변했으면** 워커가 스스로 이어 간 것이다. `team.spawn`(`spawn_kind=readopt`)으로 진행 중에 되돌린다. `readopt` 는 재시도로 세지 않는다. **그대로면** rate-limit 횟수(§5-2)가 1 이하일 때 `kill-pane` 뒤 §5-4 로 재투입한다. 2 이상이면 「멈춤」(`rate-limit 반복`) |
| pane 이 한도 화면을 남기고 죽음 | 자동 이어 가기가 없다. `restart_at` 이 지나면 증거를 재지 않고 곧바로 재투입한다 |
| 보류 해제 | 대기 중인 rate-limit 이 모두 처리되면 보류를 풀고 poll 재기동 조건을 다시 본다 |

## 7. Orca 백엔드

`references/backends.md:264` 는 "tmux 를 찾지 못한 Orca 환경에서만 이 백엔드로 온다" 고 적었지만, SKILL.md 「0.
환경 감지」 는 Orca 안이면 Orca 를 **먼저** 고른다(`SKILL.md:399-408`). 그 줄은 낡았다. Orca 안에서 띄운 팀장은 늘
Orca 백엔드이므로 Orca 사용자가 주 대상일 수 있다. 구현 때 그 줄도 고친다.

| 항목 | tmux | Orca |
|---|---|---|
| 죽음 감지 | `PANE_DEAD` + 무응답 | 무응답뿐(pane 개념이 없다) |
| 한도 판정 | statusLine 덤프 → 화면 → 폴백 | 화면(`orca terminal read --screen --terminal <handle>`) → 폴백. 핸들이 없는 옛 런타임은 폴백만 |
| 멈춘 세션 거두기 | `kill-pane` | `orca terminal close --terminal <handle>`(관문 뒤) |
| 재투입 | 5-1 의 `.dflow-run` + `split-window` | `orca terminal create --worktree path:<워크트리> --command './.dflow-run' --json`(관문 뒤). 5-1 이 Orca 에도 `.dflow-run` 을 쓰게 한다 |
| 핸들 | `.dflow-pane` | 새 `create` 결과의 핸들을 `team.spawn` 의 `handle` 에 적는다 |

**실측 관문**(구현 계획의 첫 과제): 다음 셋을 Orca 에서 확인해야 켠다.
1. `orca terminal close --terminal <agentTerminalHandle>` 이 그 팀원 claude 프로세스를 실제로 끝낸다.
2. `orca terminal create --command './.dflow-run'` 으로 띄운 세션이 권한 확인 생략 모드로 돌고, 포인터가 첫 입력으로
   들어가며, 폴더 신뢰 확인을 넘길 수 있다.
3. 새 탭의 핸들을 JSON 으로 받을 수 있다.

관문 전 Orca: 무응답 두 TICK 이면 지금처럼 보고하고(`SKILL.md:1038-1040`), 한 줄을 더한다: "재시작하려면 그 탭을 닫고
`/dflow-team <종료시각> --resume <id8>`". `team.lost` 는 기록하지 않는다(관문 전에는 동작이
현행과 같아야 하므로).

## 8. `.cancelled` 표식 정리

**위치**: 「5. 팀원 spawn」 5항(띄우기) 직전과 「5-1. 재개 spawn」 7항 직전. 자동 재시작도 5-1 을 타므로 함께 걸린다.

**조건**: 그 기상에서 이미 받은 `show` 결과의 `.order.status` 가 `ready`(새 작업) 또는 `claimed`(재개·재시작)다.
`show` 를 받지 못했으면 spawn 자체를 하지 않는다(H2, 새 작업은 기존 show 필터 실패 규칙 `SKILL.md:920-922`).

```bash
order='<주문 전체 UUID>'; st='<show 의 .order.status>'
case "$st" in
  ready|claimed) m="$HOME/.dflow/hb/$order.cancelled"
    [ -e "$m" ] && { rm -f "$m" && echo "STALE_CANCEL_MARK_REMOVED $order" || echo "CANCEL_MARK_RM_FAILED $order"; } ;;
esac
```
- `STALE_CANCEL_MARK_REMOVED` 가 나오면 보고에 한 줄 적는다. 대개 스테이징·운영 UUID 가 겹친 경우다(§1-3 1).
- `CANCEL_MARK_RM_FAILED` 면 **띄우지 않는다.** 띄우면 첫 도구 호출에서 선다.
- 워크트리 `state.json` 이 `cancelled` 인 경우는 여기서 고치지 않는다(G2 가 앞에서 걸러 「멈춤」 으로 보낸다).
- 훅은 고치지 않는다(G3). 수동 `/dflow-dev` 세션의 표식은 사람이 지운다(`kit/README.md:82` 의 안내를 그 뜻으로 고친다).

## 9. lease·잠금·차단기와의 관계

| 상황 | 동작 |
|---|---|
| `LEASE_LOST` 기상(`SKILL.md@os:956`) | 재시작 판정을 하지 않는다. lease 설계대로 떠 있는 워커는 건드리지 않는다(lease 설계 §8). 대기 중인 재시작은 버린다 |
| 밀려난 팀장의 재시작 대기 | 이벤트는 `agent`+`repo`(이 PC·이 체크아웃) 단위라 **다른 clone·다른 PC 의 새 팀장에게 넘어가지 않는다.** 새 팀장은 그 작업을 서버 `claimed`·워크트리 없음으로 보고 「멈춤」(사유 `워크트리 없음`) 표에 올린다(`SKILL.md:655-666`). 복구 길은 사람의 `--resume` 이다. 같은 체크아웃에서 다시 뜬 팀장은 고아 스캔이 이어받는다 |
| `LOCK_LOST` | 현행과 같다. 재시작하지 않는다 |
| 한 기상 안에서 kill 뒤 lease 상실 | 재투입은 kill 과 같은 기상 안에서 끝낸다. 그 사이 lease 를 잃었어도 방금 띄운 워커는 "하던 작업을 끝낸다" 규칙에 들어간다. 반쯤 된 상태(`next=restart` 인데 spawn 없음)는 같은 체크아웃의 다음 팀장이 고아 스캔으로 잇는다 |
| `STALE` 기상 | 판정하지 않는다(현행: 잠금·beat 만) |
| 차단기 | H11. 걸린 동안 TICK 마다 1건만 시험하며, 재시작 대기가 새 작업보다 먼저다 |
| 「7. 마감」 | 재시작하지 않는다. 대기 중인 재시작과 rate-limit 대기는 「멈춤」 표에 사유(`무응답`·`pane 죽음`·`rate-limit 대기(<시각>)`)와 재시작 명령을 적는다 |

## 10. 오피스 「자동 재시작 예정 시각」 — 범위 밖

실으려면 네 곳을 바꿔야 한다.
1. `dflow.sh watch` 에 재시작 목록 인자(예: `--restarts '<json>'`).
2. watch 라우트가 그 값을 받아 저장. `agent_watchers` 에 컬럼을 더하는 마이그레이션이 든다.
3. 좌석표 조회와 오피스 화면(좌석 말풍선·툴팁).
4. 계약 버전과 킷 재빌드.

대가에 비해 얻는 것이 작다. 예정 시각은 TICK(30분) 단위로만 정해지고, 한도 대기는 어차피 팀장·팀원이 함께 멈춰
화면에 새로 그릴 주체가 없다. 이번에는 팀장 보고(§4-4)와 「멈춤」 표에만 싣는다.

시간축 차이는 그대로 남는다: 오피스는 5분에 STALE, 30분에 OFFLINE 을 그리고 팀장은 약 60분에 재시작한다. 오피스가
OFFLINE 인데 아무 일도 안 일어나는 30분 구간이 있다. 후속 과제로 적어 둔다.

## 11. 바꿀 파일(구현 계획의 범위)

| 파일 | 바꿀 것 |
|---|---|
| `.claude/skills/dflow-team/SKILL.md` | 「3. 결과 처리」 무응답·`PANE_DEAD` 폴백·차단기·status 표의 `failed no-result` 행, 「팀장 상태」 제외·차단기·고아 스캔 다섯째 조건, 「2-1」 재기동 조건, 「2-3」 TICK 행, 「5」·「5-1」 표식 정리, 「7. 마감」 멈춤 표 사유 |
| `.claude/skills/dflow-team/references/events.md` | `team.lost` 행·필드 설명·가드 `$req` |
| `.claude/skills/dflow-team/references/backends.md` | `.dflow-run` 의 `--settings` statusLine, Orca 재투입 명령(관문 뒤), `:264` 낡은 줄 |
| `.claude/skills/dflow-team/references/help.md` | 자동 재시작 한 문단 |
| `.claude/skills/dflow-dev/SKILL.md:56-58`, `kit/README.md:82` | 표식 정리 문장(G3) |

스크립트를 새로 만들지 않는다. statusLine 명령은 `.dflow-run` 안의 한 줄 `jq` 다.

## 12. 테스트

| 층 | 파일 | 내용 |
|---|---|---|
| 스킬 문서 계약 | `tests/skills/dflow-team.test.ts` | **바뀌는 기존 테스트**: `:342`(「PANE_DEAD 는 … 즉시 failed no-result」)는 "결과 줄이 없으면 재시작 판정, 127 이면 failed no-result" 로, `:352`(`failed rate-limit` 행)는 rate-limit 대기 규칙까지로 고친다. 새 검사: 재시작 전제(H2 의 `claimed`·`mine`·같은 host), 원인 분류 표 순서, `team.lost` 는 `team.result` 를 대신한다, 상한 도달 시 `team.result` 를 쓰지 않는다, 재투입이 5-1 을 탄다, 표식 정리가 5·5-1 에 있다, Orca 관문 |
| 이벤트 표 | `tests/skills/dflow-team-backends.test.ts`(`:90` 이 이벤트 표 행을 문자열로 검사한다) | `team.lost` 행과 필드 |
| 가드 실행 | 같은 파일에 추가 | events.md 의 기록 명령 블록을 그대로 꺼내 돌린다: `team.lost` 완전한 줄은 붙고, `restart_at` 이 빠지면 `EVENT_ARGS_MISSING` |
| 카운터 실행 | `tests/skills/dflow-team.test.ts` 에 추가 | `SKILL.md` 의 재시도 수 블록(jq+awk)을 fixture events.jsonl 로 돌린다: `resume` 두 번 사이에 `team.lost` 가 끼어도 2, `team.result` 뒤는 0, `readopt` 는 세지 않음, `team.start` 로 끊기지 않음. rate-limit 횟수 블록도 같은 방식 |
| 셸 블록 문법 | `tests/skills/dflow-team-shell-blocks.test.ts` | 새 블록(표식 정리·한도 판정)이 sh·bash·zsh 에서 파싱된다(기존 테스트가 자동으로 잡는다) |
| 한도 판정 실행 | 새 fixture `tests/skills/fixtures/limits/*.json`, `*.screen.txt` | statusLine JSON(창 하나 100%·둘 다 100%·필드 없음)에서 해제 시각을 고르고, 화면 캡처에서 문구와 시각을 뽑고, 둘 다 없으면 폴백. 화면 fixture 는 실제 캡처로 만든다(§14 1) |
| 훅 | `tests/skills/heartbeat-hook.test.ts` | 훅을 고치지 않으므로 기존 `:183-217` 이 그대로 통과해야 한다 |
| 실측(ego-browser 불필요, 터미널) | 스테이징 | tmux 팀원 pane 을 `kill-pane` → 다음 `PANE_DEAD` 에서 같은 슬롯·같은 워크트리로 재투입, `team.lost`→`team.spawn resume` 순서 확인. 무응답은 워커 프로세스를 `kill -STOP` 하고 세대 파일의 `TICK_AT` 을 당겨 두 TICK 을 흉내 낸다. 세 번 연속 죽이면 「멈춤(재시도 상한)」, 팀장을 다시 띄워도 재개하지 않음. `~/.dflow/hb/<order>.cancelled` 를 손으로 만든 뒤 재시작 → `STALE_CANCEL_MARK_REMOVED` 와 워커 정상 진행 |

## 13. 범위 밖

- 오피스 「자동 재시작 예정 시각」 표시(§10).
- 감지 속도 단축(TICK·두 TICK 규칙 유지).
- heartbeat 훅 변경(표식 파일 이름에 `api_base` 넣기, 표식 자기 치유). 팀장 쪽 정리로 H 의 경로는 막힌다.
- 오래된 표식 파일 청소(GC). 종착 주문의 표식은 UUID 가 겹치지 않는 한 해가 없다.
- 다른 PC·다른 clone 으로 넘어간 재시작 대기의 인계(§9, `--resume` 으로 복구).
- 권한 거부·`blocked`·`cancelled` 의 자동 처리(사용자 결정 1).
- 한도에 걸린 워커에 "계속" 을 입력해 깨우는 방식(§14 3).

## 14. 미결

1. **한도 화면 문구와 자동 이어 가기의 실제 동작.** 바이너리 문자열만 확인했다. 대화형 세션이 한도에 닿았을 때의
   실제 문장, 시각 형식, 한도가 풀리면 스스로 이어 가는지(기본값인지 설정인지)를 실측 캡처로 확인해 화면 fixture 와
   §6-2 의 정규식을 정한다. 스스로 이어 가지 않는다면 H8 의 "기다렸다 재측정" 은 유예 10분만큼 늦을 뿐 틀리지 않는다.
2. **statusLine 덤프가 한도 중에도 갱신되는지.** 한도 429 응답 뒤에 `rate_limits` 가 채워진 입력으로 statusLine 이 다시
   도는지 확인해야 한다. 안 돌면 1번 출처는 한도 직전 값(`used_percentage` 가 100 미만)만 남기고, 화면·폴백으로 넘어간다.
   `--settings` 의 statusLine 이 사용자 설정 statusLine 을 팀원 pane 에서 덮는 것은 받아들인다.
3. **한도 중 팀장의 기상.** 팀장도 같은 계정이라 한도 중에는 모델 턴을 못 돈다. 이때 백그라운드 감시 루프의 `TICK`
   알림이 한도가 풀린 뒤 전달되는지, 버려지는지 모른다. 버려지면 팀장이 다음 알림(20초 루프는 이미 끝났다)을 받지
   못해 멈출 수 있다. 실측하고, 버려진다면 lease `keep`·잠금 `beat` 의 70분 규칙과 겹치는지 함께 본다. 이 답에 따라
   "재시작 대신 `send-keys` 로 '계속' 을 넣어 맥락을 살리는" 대안을 다시 검토한다.
4. **모델별 한도.** 팀원만 `opus` 로 돌고 팀장은 다른 모델이면 팀원만 한도에 닿는다. 이때 H10 의 전면 보류가 과한지
   (같은 모델의 spawn 만 막으면 되는지)는 실제 사례를 보고 정한다.
5. **Orca 관문(§7)** 세 항목의 실측.
6. **`show` 연속 실패.** H2 로 `show` 가 계속 실패하면 재시작도 계속 미뤄진다. 몇 TICK 뒤에 사람에게 알릴지(예: 두
   TICK 연속 측정 실패면 「멈춤」 표에 `서버 조회 실패`) 정해야 한다.
7. **로컬·원격 staging 머지 뒤 줄 번호.** 이 문서의 `@HEAD` 인용은 lease 머지 뒤 밀린다. 구현 계획을 쓸 때 머지된
   판으로 다시 맞춘다.
