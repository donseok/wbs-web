# 무거운 작업 표시 — 오피스 말풍선·팀장 칩 게이지 (2026-09-26)

사용자 요청(09-26): "CPU 부하가 많은 작업을 진행중일때는 에이전트 오피스에 표시가 나면 좋겠다", "말풍선에
'무거운 작업중 : 어떤 작업....' 이라고 나오면 더 알기 편하겠다. 말풍선 포맷은 더 재미있게 꾸며 달라."

## 1. 무엇을 보이나

- **좌석 말풍선**(평면도·상태 레인·에이전트 보기 공용 `seatSpeech`)
  - 실행: 머리말 `🔥 무거운 작업 중 · N분째`, 본문 작업 이름(`전체 테스트` …), 경과 시간별 한마디, 열기 막대.
  - 대기: 머리말 `⏳ 무거운 작업 순번 대기 · N번째`, 본문 작업 이름, 한마디(`앞에 N명` 류).
  - 같은 좌석(워크트리)에서 두 건 이상이면(병렬 묶음 단위·E2E 서버 hold) 본문 끝에 `외 N건`.
  - 원 명령(가린 것)은 말풍선 title(툴팁)로 본다.
- **팀장 칩 게이지**(LeadChip — 평면도 층 머리·에이전트 보기 팀장 책상 공용): `🔥 2/2 · ⏳ 3 · load 7.1`.
  슬롯이 다 찼으면 붉게, load 가 코어 수를 넘으면 붉게.

## 2. 전달 경로

좌석 heartbeat 훅은 PostToolUse 라 긴 Bash(전체 테스트 10분) 동안 아무 신호도 없다. 그래서 **팀장 lease 갱신
루프**(`dflow.sh lease keep` → `lease_renew`, 60초)에 싣는다. 수동 `/dflow-dev`(팀장 없음)는 1차 범위 밖이다.

```
heavy.sh 슬롯·대기 표식(~/.dflow/locks/heavy)
  └ heavy.sh snapshot (탭 구분 기계 출력)
      └ dflow-lease.sh lease_renew — cwd 에서 id8 추출·명령 가림 → renew 본문의 heavy
          └ POST /api/v1/agent/lead/lease (renew) — renew 성공 뒤 lead_lease_heavy RPC(0106)
              ├ agent_lead_leases.heavy        ← PC 요약
              └ agent_work_orders.heartbeat_heavy ← 주문별
                  └ 좌석표 조립(seatmap.ts) → Seat.heavy / LeadLease.heavy → 말풍선·칩
```

### 2-1. 슬롯 → 주문

팀원 워크트리는 `<MAIN>/.claude/worktrees/dflow-<id8>` 이고(resolve 워커는 `-resolve` 접미사), heavy.sh owner
파일에 이미 `cwd=` 가 있다. 대기 표식에만 `cwd=` 를 더한다. 셸은 `/.claude/worktrees/dflow-([0-9a-f]{8})(-resolve)?(/|$)`
로 id8 을 뽑고, 서버가 id8 을 주문으로 바꾼다. 팀장 상태(events.jsonl)를 매분 읽지 않는다(수십만 자).

### 2-2. heavy.sh snapshot

`status` 의 stdout 한 줄은 capacity.sh 가 파싱하므로 건드리지 않는다. 새 하위 명령 `snapshot` 은 stdout 에:

```
PC	<K>	<held>	<waiting>	<load1|->	<cpus|->
RUN	<start epoch>	<kind run|hold>	<pool general|docker>	<cwd>	<cmd>
WAIT	<start epoch>	<pool>	<cwd>	<cmd>
```

필드는 탭 구분(Windows 경로에 공백). 죽은 소유자·만료 hold 는 뺀다(status 와 같은 stale 판정). 도커 풀 실행은 도커
슬롯과 일반 슬롯을 같은 pid 로 쥐므로 pid 로 한 줄로 합치고 pool=docker 로 적는다. load 는 macOS `sysctl -n vm.loadavg`,
Linux `/proc/loadavg`, 못 읽으면 `-`.

### 2-3. renew 본문

```json
{ "op": "renew", "holder": "…", "leases": [...],
  "heavy": { "pc": { "k": 2, "held": 2, "waiting": 3, "load": 7.1, "cpus": 10 },
             "orders": [ { "id8": "abcdef12", "state": "run", "kind": "run", "pool": "general",
                           "since": 1790350000, "pos": null, "n": 2, "cmd": "npm run test" } ] } }
```

- 주문별로 하나: 실행이 대기보다 먼저, 그중 가장 먼저 시작한 것. `n` 은 그 워크트리의 건수.
- `pos` 는 대기일 때 PC 전체 일반 풀 대기 중 시작 순번(1부터).
- **가림은 허용 목록**(lease 설계가 홈 경로를 서버에 보내지 않는 것과 같은 축. 리뷰에서 금지 목록 정규식의 빈틈 — URL 속
  비밀번호·`--token 값`·`Bearer`·따옴표 값·Windows 경로 — 이 나와 바꿨다): 경로는 마지막 조각만, `a=b`·`a='…'` 는 `a=***`,
  URL 은 `<url>`, 비밀 류 플래그(`--token`·`-H`·`-u`·`Bearer` …) 바로 뒤 토큰은 `***`, 영숫자·`_.:+,-` 밖의 글자가 든 토큰은
  `***`, 190 코드포인트로 자른다. 서버(`sanitizeHeavyCmd`)가 같은 규칙을 한 번 더 건다.
- **lease 를 잃지 않는다**: heavy 를 만들다 무엇이 실패해도(heavy.sh 없음·jq 실패) `heavy` 를 빼고 renew 는 그대로 간다.
  `lease_keep` 은 renew 비정상 종료 3회면 팀장을 멈추므로, heavy 쪽 실패가 renew 종료 코드로 번지면 안 된다.
  `snapshot)` 분기가 없는 옛 heavy.sh 는 부르지 않는다(모르는 인자를 무거운 명령으로 보고 슬롯을 240초까지 기다린다).

### 2-4. 서버

- 파서(`parseLeaseBody`)는 renew 의 `heavy` 를 선택으로 받는다. PC 요약·배열 모양이 틀리면 **renew 는 받아들이고 heavy 만
  버린다**(로그). 틀린 주문 항목은 그 항목만 건너뛴다. 옛 서버는 모르는 필드를 무시하므로 새 킷 → 옛 서버도 안전하다.
- 라우트는 renew RPC 가 성공한 뒤 `lead_lease_heavy` 를 **별도 try** 로 부른다. heavy 가 없거나 틀린 renew(옛 킷·snapshot
  실패)도 `pc=null, orders=[]` 로 불러 비운다 — 안 그러면 옛 값이 lease 가 사는 동안 「N분째」 로 계속 늘어난다. 실패(0106 전
  서버의 함수 없음 포함)는 로그만 남기고 renew 응답은 그대로 준다. 함수는 `lock_timeout 2s` — renew 응답이 기다리므로.
- `lead_lease_heavy(p_user, p_holder, p_pc, p_orders)`(0106):
  - 대상 프로젝트 = `user_id = p_user and holder = p_holder and expires_at >= now()` 인 lease 행.
  - 그 행들의 `heavy = p_pc`(값이 다를 때만).
  - 주문: `status = 'claimed'`, 대상 프로젝트, `claimed_by_user_id = p_user`(팀원은 팀장과 같은 PAT 신원으로 claim 한다 —
    한 프로젝트에 두 신원의 팀장이 있어도 남의 좌석에 쓰지 않는다), `left(id::text, 8) = id8` 이 **하나일 때만**. 값에 `by = p_user` 를 더해
    `heartbeat_heavy` 에 쓴다(`is distinct from` 일 때만 — 매분 같은 값을 다시 쓰지 않는다).
  - 비우기: 대상 프로젝트에서 `heartbeat_heavy->>'by' = p_user` 인데 이번 목록에 없는 주문은 null.
  - `agent_work_orders` 에는 updated_at 트리거가 없다(확인함) — heavy 쓰기는 좌석 생존 판정(`lastSignalMs`)을 바꾸지 않는다.
- 팀장이 죽거나 lease 를 반납하면 값이 남지만, 화면은 **`by` 의 lease 가 살아 있고(expires_at > now) 점유 신원이 `by` 인
  주문만** 믿는다. 같은 신원이 새 팀장으로 lease 를 다시 잡으면 첫 renew(≤60초)가 비우기 전까지 옛 값이 잠깐 보일 수 있다.

## 3. 화면

### 3-1. 좌석 조립

`OrderRow.heartbeat_heavy`, `LeaseRow.heavy` 를 싣는다. `Seat.heavy` =
`{ state: 'run' | 'wait', label, cmd, sinceMs, pos, more }` — 주문이 claimed 이고 `by`·프로젝트의 lease 가 살아 있을 때만.
작업 이름(label)은 TS 순수 함수 `heavyLabel(cmd, kind)` 가 정한다(시험 가능, 셸은 분류하지 않는다):

| 순서 | 명령에 있으면 | 이름 |
|---|---|---|
| 1 | kind=hold | E2E 서버 |
| 2 | mutation·stryker·pitest·mutmut | 변이 검증 |
| 3 | mssqlMigrationTest | MSSQL 마이그레이션 시험 |
| 4 | playwright·e2e·smoke | E2E 스모크 |
| 5 | npm ci·npm install·pnpm install·yarn install·--refresh-dependencies | 의존성 설치 |
| 6 | testAll·vitest·jest·pytest·npm test·npm run test·gradlew … test | 전체 테스트(`--tests`·`related`·`-t` 가 있으면 테스트 실행) |
| 7 | gradlew·gradle … build/assemble | Gradle 빌드 |
| 8 | mvn | Maven 빌드 |
| 9 | next build·npm run build·tsc | 빌드 |
| 10 | docker | 도커 작업 |
| — | 그 밖 | 무거운 명령 |

### 3-2. 우선순위 — 승인안에서 바꾼 점

승인안은 "새 보고 > 무거운 작업 > 잡담" 이었다. 진행 보고 말풍선은 10분 동안 떠 있고 Build 는 단위 시작에 진행
보고를 하므로, 그대로면 무거운 게이트 동안 말풍선이 거의 보이지 않는다. 그래서 **무거운 작업 > 보고 > 잡담** 으로
한다. 완료 보고는 주문이 claimed 가 아니게 된 뒤라 겹치지 않는다. 무거운 작업 말풍선은 좌석 상태와 무관하게
claimed 면 보인다 — 긴 게이트 동안 PostToolUse heartbeat 가 없어 좌석이 무응답·끊김으로 보이는 바로 그때가 대상이다.
(좌석 상태 판정 자체는 바꾸지 않는다. 무거운 작업 중엔 무응답으로 치지 않는 것은 따로 제안한다.)

### 3-3. 말풍선 꾸밈

- `BUBBLE_LOOK.heavy`(주황·빨강 계열), `heavyWait`(파랑 계열).
- `Speech.sub`(선택) — 경과 시간별 한마디. **잡담을 끄면 sub 만 빠지고** 말풍선은 남는다(업무 정보다).
  대사는 `officeChatter.lines.json` 의 새 분류 `무거운 작업 중`(예열 1분 전·달아오름 1~5분·뜨끈 5~10분·비명 10분 넘게)과
  `무거운 작업 대기`. 8초마다 돌리는 규칙(`pick`)을 그대로 쓴다.
- `Speech.meter`(0~1) — 열기 막대. 10분에 가득 찬다. 불꽃 깜박임 keyframes 는 `seatmap.module.css` 에 두고
  `prefers-reduced-motion` 이면 멈춘다(globals.css 는 건드리지 않는다).
- React key 는 `text`(작업 이름) 그대로 — 분은 머리말에 두어 매분 톡 튀는 애니메이션이 다시 돌지 않게 한다.
- 상태 레인(한 줄)은 sub·막대 없이 머리말+이름만.

## 4. 반영 순서

`agentSeatmap.ts` 는 조회 실패를 `must()` 로 던지므로, 새 열을 select 하는 코드가 열보다 먼저 가면 오피스 화면
전체가 깨진다. **DB 먼저, 그다음 코드**(0099·0105 와 같은 규칙).

1. 0106 커밋(마이그레이션만, 롤백 파일 포함) → `db:apply --target staging` → 검증 → `Staging-verified:` 트레일러.
2. 코드 커밋 → staging push → ego-browser 로 화면 확인.
3. 운영은 지시 대기(0106 prod 먼저, main 나중).

## 5. 시험

- heavy.sh: `snapshot` 형식·stale 제외·도커 합치기·대기 표식 cwd, `status` stdout 불변.
- dflow-lease.sh: 가짜 슬롯이 있으면 renew 본문에 heavy(id8·가림), heavy.sh 가 없거나 깨져도 `LEASE_OK`.
- 파서·라우트: heavy 선택·형식 오류는 renew 성공 + heavy 버림, RPC 실패도 renew 200.
- 0106 정적 시험(0101 시험과 같은 꼴): 열·함수·revoke/grant·롤백.
- 도메인: `heavyLabel` 표, `seatHeavy`(lease 생존·claimed·state), 한마디 단계.
- `seatSpeech`: 무거운 작업 > 보고 > 잡담, 잡담 끔이면 sub 없음.
