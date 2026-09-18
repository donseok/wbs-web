# D'Flow 스킬 키 선택 설계

2026-09-18. `.env` 의 `DFLOW_PATS` 에 토큰이 둘 이상일 때 어느 키로 도는지를 사람이 알 수 있게 하고,
리포마다 쓸 키를 고정한다. 대상은 서버 `/api/v1/agent/me`, `dflow.sh`, 좌석표 heartbeat 훅, `/dflow-team` 이다.

---

## 1. 왜 바꾸는가

2026-09-18 mdm-dict 에서 `/dflow-team` 을 돌렸을 때 `.env` 에는 토큰이 둘 있었다(서로 다른 계정). 팀장은
어느 키로 돌지 묻지 않았고, 시작 보고에도 신원이 나오지 않았다. 확인해 보니 구조적인 문제다.

1. **선택 수단이 끊겨 있다.** `dflow.sh` 는 `--as` 가 없으면 첫 토큰을 쓴다. `/dflow-team`·`poll.sh`·
   worker-prompt·`/dflow-dev` 의 하위 Phase 어디에도 `--as` 를 넘기는 단계가 없다. `kit/hooks/heartbeat.sh` 는
   `dflow.sh` 를 거치지 않고 `DFLOW_PATS` 의 첫 토큰을 직접 쓴다. 그래서 키를 고르려면 `.env` 의 토큰 순서를
   손으로 바꾸는 방법뿐이다.
2. **같은 계정의 키를 구별하지 못한다.** `--as` 는 이메일 부분 일치다. 한 계정에 키가 둘이면 언제나 앞의 것이
   잡힌다. 이 PC 의 `~/.cache/dflow/profiles.json` 에는 한 계정의 prefix 가 실제로 둘 기록돼 있다.
3. **키가 무엇인지 알려 주는 정보가 없다.** `/me` 는 `user_email`·`scopes`·`kind`·`token_expires_at`·
   `projects` 만 돌려준다. 발급할 때 적은 이름(`agent_runners.name`)은 DB 에 있지만 응답에 없다.

키가 다르면 배정 목록, 좌석표 신원, claim 주체가 모두 달라진다. 잘못된 키로 도는 것은 조용한 오동작이다.

---

## 2. 결정 요약

| 항목 | 결정 |
|---|---|
| 키 선택의 정본 | `.env` 의 `DFLOW_AS=<token_prefix>`. `DFLOW_PROJECT_ID` 와 같은 **리포 단위 바인딩**이다 |
| 값의 형식 | **prefix 만.** 이름·이메일은 받지 않는다(훅이 네트워크 없이 풀 수 있어야 한다) |
| 우선순위 | `--as` 플래그 → `DFLOW_AS` → 첫 토큰 |
| `--as` 매칭 | prefix 완전 일치 → 이메일 부분 일치(기존) |
| 서버 | `/me` 에 `token_name`·`token_prefix` 추가. 계약 2.3 → 2.4(additive). 마이그레이션 없음 |
| 새 명령 | `dflow.sh profiles` — 토큰마다 한 줄 JSON. 토큰 값은 출력하지 않는다 |
| 훅 | `DFLOW_AS` 가 있으면 그 prefix 의 토큰, 맞는 것이 없으면 **보내지 않는다** |
| `/dflow-team` | 잠금 전에 키 판정. 모호하면 묻고, 결과를 `.env` 에 추가한다 |
| `team.start` | 필드를 늘리지 않는다. 정본이 `.env` 라 재구성에 필요 없다 |

**실행마다 묻고 워커에 넘기는 방식을 버린 이유**: 고른 키를 포인터·`.dflow-run`·Orca 인자로 넘겨도 heartbeat
훅과 `/dflow-dev` 의 하위 Phase 는 그 값을 받지 못한다. 팀장과 팀원의 신원이 갈라진다. 모든 경로가 이미 같은
`.env` 를 읽으므로(팀원 워크트리는 심링크, `poll.sh` 는 `DFLOW_ENV_FILE`), 선택을 `.env` 에 두면 새는 곳이 없다.

---

## 3. 서버: `/api/v1/agent/me`

응답에 두 필드를 더한다.

```json
{ "ok": true, "user_email": "…", "token_name": "맥북 에어", "token_prefix": "OxMb1D1097Qz", "scopes": ["…"], "…": "…" }
```

- `token_name` 은 `agent_runners.name`, `token_prefix` 는 `agent_runners.token_prefix` 다.
- `resolveAgentPrincipal` 의 select 에 `name` 을 더하고, `AgentPrincipal`(pat) 에 `runnerName`·`tokenPrefix` 를
  더한다. 다른 라우트는 이 필드를 쓰지 않는다.
- `AGENT_CONTRACT_VERSION` 을 `2.4` 로 올린다. 필드 추가뿐이라 minor 다. `dflow.sh` 의 `CONTRACT_VERSION` 도
  `2.4` 로 맞춘다(doctor 는 major 만 비교한다).
- prefix 는 토큰 문자열 안에 평문으로 들어 있는 식별자다. 응답에 실어도 비밀이 늘지 않는다.
- legacy 주체는 지금처럼 400 `identity_required` 다.

서버가 아직 2.3 이면 `token_name` 이 없다. 클라이언트는 이름을 `-` 로 표시하고 나머지는 그대로 동작한다.

---

## 4. `dflow.sh`

### 4-1. 키 선택

```
AS = --as 값 || $DFLOW_AS || ''
pick_token(AS):
  AS 가 비면 첫 토큰
  토큰의 prefix(셋째 '_' 칸)가 AS 와 같으면 그 토큰          # 네트워크 없음
  AS 가 DFLOW_AS 에서 왔으면 여기서 exit 2                    # prefix 만 받는다. 첫 토큰으로 물러서지 않는다
  아니면 profile_email 에 AS 가 부분 일치하는 첫 토큰         # --as 의 기존 동작
  없으면 exit 2 "프로필을 찾지 못했습니다: <AS>"
```

- `DFLOW_AS` 는 `.env` 자동 로드와 CR 제거 대상에 넣는다.
- `DFLOW_AS` 에 이메일을 적으면 exit 2 다. `--as` 만 이메일 부분 일치를 받는다. 이유: 훅은 이메일을 풀 수
  없으므로, `dflow.sh` 만 통과시키면 팀원의 heartbeat 만 조용히 끊긴다.
- prefix 일치를 먼저 보는 이유: 같은 계정의 키 둘을 가르는 유일한 값이고, `/me` 를 부르지 않아도 된다.

### 4-2. `profiles`

토큰마다 한 줄 JSON 을 낸다. 토큰 값은 어디에도 내지 않는다.

```json
{"n":1,"prefix":"OxMb1D1097Qz","name":"맥북 에어","email":"a@example.com","kind":"user_pat","expires_at":"2026-12-15T04:40:29Z","projects":[{"id":"…","name":"MDM 사전"}],"bound":true,"selected":true}
{"n":2,"prefix":"73mRwPGRB8W8","error":"auth"}
```

- `bound`: 이 키의 `projects` 에 리포 바인딩(`DFLOW_PROJECT_ID`·`DFLOW_PROJECT_MAP`)의 프로젝트가 하나라도 있다.
  바인딩이 없으면 `null` 이다.
- `selected`: 지금 설정(`--as`·`DFLOW_AS`·첫 토큰)으로 `pick_token` 이 고르는 키다. 설정값이 어느 토큰과도 맞지
  않으면 모든 행이 `false` 다. `profiles` 는 그 경우에도 죽지 않는다(진단 명령이 진단할 상황에서 죽으면 안 된다).
- `/me` 가 실패한 토큰은 `{"n","prefix","error","selected"}` 로 낸다. `error` 는 401(dflow.sh exit 3)이면 `"auth"`,
  그 밖(네트워크·서버)이면 `"unreachable"` 이다. 조회 실패를 빈 목록으로 뭉개지 않고, 죽은 키와 닿지 않는
  서버를 한 단어로 뭉개지도 않는다.
- `name` 이 응답에 없으면(서버 2.3) `"-"` 다.
- exit 는 0 이다. 토큰이 하나도 없으면 기존처럼 exit 2.

### 4-3. `doctor`

프로필 줄을 `프로필 1: <prefix> <이름> <email> (계약 2.4, 프로젝트 1) [선택됨]` 으로 넓힌다. 토큰이 둘 이상인데
`DFLOW_AS` 가 없으면 `⚠ 토큰이 N개인데 DFLOW_AS 가 없습니다 — 첫 토큰을 씁니다(.env 에 DFLOW_AS=<prefix>).` 를
낸다. `DFLOW_AS` 가 어느 토큰과도 맞지 않으면 `⚠ DFLOW_AS=<값> 에 맞는 토큰이 없습니다.` 를 낸다. 종료 코드는
지금처럼 0 이다(진단 출력용).

---

## 5. `kit/hooks/heartbeat.sh`

지금은 `DFLOW_PATS` 의 첫 토큰을 쓴다. 이렇게 바꾼다.

- `DFLOW_AS` 가 비어 있으면 지금과 같다.
- `DFLOW_AS` 가 있으면 `DFLOW_PATS`(없으면 `DFLOW_PAT`)의 토큰 중 셋째 `_` 칸이 그 값과 같은 것을 쓴다.
- 맞는 토큰이 없으면 **아무것도 보내지 않고 exit 0 한다.** 이유: 첫 토큰으로 물러서면 다른 신원의 좌석에
  heartbeat 가 찍힌다. 보안 가드는 fail-closed 다.

`DFLOW_AS` 를 prefix 로 고정한 이유가 이 훅이다. 훅은 타임아웃이 짧고 `/me` 를 부르지 않는다.
훅은 `install.sh --hooks` 가 `~/.dflow/hooks/` 에 **복사**하므로, 고친 뒤에 다시 설치해야 반영된다.

---

## 6. `/dflow-team`

### 6-1. 키 판정 (「인자」 단계, 전제 검사 **전**)

종료 시각 질문과 같은 자리다. 잠금을 쥔 채 사람의 답을 기다리지 않기 위해서다.

```bash
(set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh profiles)
```

| 상태 | 처리 |
|---|---|
| `DFLOW_AS` 가 있다 | 묻지 않는다. `selected` 행이 있는지만 본다. 없으면 `KEY_NOT_FOUND` 로 중단 |
| 없고 토큰 1개 | 지금과 같다 |
| 없고 토큰 2개 이상 | `error` 없는 행 중 `bound` 가 `true` 인 것이 후보다(바인딩이 없으면 전제 검사 `NO_PROJECT` 가 어차피 막는다) |
| → 후보 0개 | `NO_KEY_FOR_PROJECT` 와 profiles 표를 출력하고 중단 |
| → 후보 1개 | 자동 선택 |
| → 후보 2개 이상 | AskUserQuestion. 종료 시각 질문과 **같은 호출에** 모은다 |

- 질문의 선택지는 후보마다 하나다. label 은 `<이름> · <email>`, description 은 `prefix <prefix> · <프로젝트 이름들> ·
  만료 <날짜>` 다. 후보가 4개를 넘으면 앞의 3개와 "Other 에 prefix 를 적는다" 를 둔다.
- 키를 묻는 호출에서는 WP 범위 선택지를 서버에서 뽑지 않고 `전체 (기본)` 과 "Other 로 직접 적는다" 만 둔다.
  이유: 그 목록(`dflow.sh list`)은 고른 키로 조회해야 하는데, 키는 같은 호출의 답으로 정해진다.
- **종료 시각이 인자로 주어져도 키 질문은 한다.** 인원·WP 는 기본값이 있어 묻지 않지만, 신원에는 안전한
  기본값이 없다.
- 자동 선택이든 답이든, 고른 prefix 를 `.env` 끝에 한 줄로 더하고 보고한다.
  ```bash
  printf '\nDFLOW_AS=%s\n' '<prefix>' >> .env
  ```
  보고: `키: <이름> (<email>, <prefix>) — .env 에 DFLOW_AS 로 저장했습니다. 바꾸려면 그 줄을 고치십시오.`
  `.env` 는 gitignore 대상이라 전제 검사의 `DIRTY` 에 걸리지 않는다.
- 자동 선택한 키가 첫 토큰이어도 저장한다. 이유: 나중에 토큰을 더하거나 순서를 바꿔도 이 리포의 키가
  바뀌지 않게 한다.

### 6-2. 전제 검사와 시작 보고

- 전제 검사의 `me` 호출은 `DFLOW_AS` 를 따르므로 `<신원>` 슬러그가 고른 키의 계정에서 나온다.
- `KEY_NOT_FOUND` 는 전제 검사가 아니라 6-1 에서 판정한다(`selected` 행이 없다). 안내: ".env 의 DFLOW_AS 를
  `dflow.sh profiles` 의 prefix 로 고쳐라". 전제 검사 블록은 바꾸지 않는다. 그 값으로는 `me` 가 exit 2 로 끝나
  기존 `AUTH` 에도 걸리므로, 6-1 을 건너뛴 경우에도 시작은 막힌다.
- 시작 보고에서 종료 시각 줄 바로 다음에 `키: <이름> (<email>, <prefix>)` 를 낸다. 토큰이 하나여도 낸다
  (`5bf6e07d` 가 첫 줄을 정규화한 종료 시각에 썼다).

### 6-3. 바꾸지 않는 것

- `team.start` 와 events.md 가드. 키는 `.env` 에서 다시 읽는다.
- worker-prompt.md 와 포인터. 팀원은 `.env` 심링크로 같은 `DFLOW_AS` 를 읽는다.
- `poll.sh`. `DFLOW_ENV_FILE` 을 `set -a` 로 읽으므로 `DFLOW_AS` 가 `dflow.sh` 까지 간다.

---

## 7. 문서와 킷

- `kit/.env.example`: `DFLOW_AS=` 와 설명("토큰이 둘 이상일 때 이 리포가 쓸 키의 prefix. `dflow.sh profiles`").
- `kit/README.md`, dflow-work `SKILL.md`·`README.md`·`references/troubleshooting.md`: 키 선택 절.
- `references/api-contract.md`: v2.4, `/me` 응답 예, 신원 해석 줄(`--as <prefix|email>`·`DFLOW_AS`).

---

## 8. 테스트

| 대상 | 방법 |
|---|---|
| `/me` | `tests/agent/me-route.test.ts` — `token_name`·`token_prefix`·`contract_version: "2.4"` |
| principal | `tests/agent/resolve-principal.test.ts` — `runnerName`·`tokenPrefix` |
| `dflow.sh` | 새 `tests/skills/dflow-key-select.test.ts` — 가짜 `curl` 을 PATH 앞에 두고 실제 실행. prefix 일치, `--as` > `DFLOW_AS` > 첫 토큰, 불일치 exit 2, `profiles` 의 `bound`·`selected`·`error`, 출력에 토큰 값 없음 |
| 훅 | `tests/skills/heartbeat-hook.test.ts` — `DFLOW_AS` 로 둘째 토큰 선택, 불일치면 무전송 |
| 스킬 문서 | 같은 새 파일 `tests/skills/dflow-key-select.test.ts` — 키 판정 절이 전제 검사보다 앞, `NO_KEY_FOR_PROJECT`·`KEY_NOT_FOUND`, `.env` 추가 명령. 셸 블록 구문 검사는 기존 `dflow-team-shell-blocks.test.ts` 가 새 블록도 잡는다 |

**기준선**(2026-09-18, 로컬 `staging` `5bf6e07d`): `tests/skills`·`tests/agent` 338건 중 문서 계약 테스트 31건이 이미
실패한다(`dflow-team.test.ts` 18, `dflow-team-backends.test.ts` 7, `dflow-dev-worker.test.ts` 6). 스킬 문서가 tmux pane
백엔드 등으로 바뀐 뒤 단언이 옛 문구(프로세스 백엔드·`nohup claude -p`)에 머물러 있기 때문이다. `npx tsc --noEmit` 의
오류는 27건이다. 이 작업은 그것들을 고치지 않으며, 새 단언을 그 파일들에 섞지 않는다. 완료 기준은 "새 테스트 전부
통과, 기존 실패 31건·tsc 오류 27건에서 늘지 않음" 이다. 구현 뒤 실측: 372건 중 실패 31건(같은 세 파일), tsc 27건.

가짜 `curl` 은 `Authorization` 헤더의 prefix 로 응답을 가른다. 테스트 토큰은 `dflow_pat_<prefix>_<더미>` 꼴의
가짜 값이다.

---

## 9. 배포 순서

1. `feat/dflow-key-select`(기점 `origin/staging`)에서 구현·테스트.
2. staging 머지·push → dflow-staging 배포 → 실제 `.env` 로 `dflow.sh profiles`·`doctor` 확인.
3. `~/dflow-skills`(라이브 스킬 워크트리)를 새 커밋으로 옮기고 `install.sh --hooks` 로 훅 사본을 갱신한다.
   도는 팀장이 있으면 그 팀장이 마감한 뒤에 한다.
4. main 머지는 종전 절차대로.

서버보다 스킬이 먼저 나가도 깨지지 않는다(이름만 `-`). 스킬보다 서버가 먼저 나가도 깨지지 않는다(additive).

---

## 10. 하지 않는 것

- `dflow.sh` 가 키를 스스로 좁혀 고르는 것. 호출마다 `/me` 를 토큰 수만큼 부르게 되고, 같은 설정에서 고르는
  키가 서버 상태에 따라 달라진다. 자동 선택은 `/dflow-team` 이 한 번 하고 `.env` 에 굳힌다.
- `/dflow-poll`·`/dflow-dev` 의 키 질문. 둘은 `DFLOW_AS` 를 따르고, 없으면 `doctor` 의 경고가 알린다.
- 키 이름으로 `DFLOW_AS` 를 적는 것. 이름은 계정 안에서만 유일하다.

---

## 11. 후속: 워크트리 단위 키 (2026-09-18, 링크드 워크트리 팀장 도입 뒤)

`21f5764f` 가 같은 리포에서 다른 신원의 두 번째 팀장을 링크드 워크트리로 띄우게 했다(`lead-worktree.sh`,
`SAME_IDENTITY_LEAD`). 그 뒤로 `.env` 는 팀장 체크아웃마다 따로 있고, 6-1 의 "리포 단위 바인딩" 은 **워크트리 단위
바인딩**으로 읽는다. 바뀐 것은 셋이다.

- `lead-worktree.sh` 는 주 체크아웃의 `.env` 를 복사할 때 `DFLOW_AS` 줄을 뺀다. 그 줄이 따라가면 두 번째 워크트리의 키
  판정이 "DFLOW_AS 가 있다" 로 넘어가 묻지 않고, 종료 시각까지 물은 뒤에 전제 검사가 `SAME_IDENTITY_LEAD` 로 거부한다.
- `dflow.sh profiles` 행에 `who`(신원 슬러그)를 더한다. 잠금 `owner` 에는 prefix 가 없고 `<신원>/<host>/lead` 만 있어,
  대조는 신원 단위로 해야 한다. 같은 계정의 키 여러 개는 `who` 가 같다.
- 새 `dflow-team/scripts/live-leads.sh` 가 같은 리포의 다른 워크트리에서 살아 있는 팀장을 찾고(기준은
  `SAME_IDENTITY_LEAD` 와 같다), `--mark` 로 profiles 행에 `in_use` 를 더한다. 6-1 의 후보 조건에 `in_use` 가 `null`
  일 것이 더해지고, 중단 사유 둘이 생긴다: `KEY_IN_USE`(`DFLOW_AS` 나 유일한 토큰의 신원을 다른 팀장이 쓴다),
  `NO_FREE_KEY`(바인딩된 키가 모두 쓰이고 있다). `DFLOW_AS` 가 가리키는 키가 쓰이고 있어도 다른 키로 자동으로 바꾸지
  않는다. 사람이 적은 값을 조용히 무시하면 의도하지 않은 계정으로 claim 된다.

하지 않는 것: 전제 검사의 `SAME_IDENTITY_LEAD` 블록을 `live-leads.sh` 로 바꾸는 것. 두 곳의 기준은 테스트가 임계값을
함께 단언해 묶는다. 전제 검사는 잠금 직전의 최종 방어선이라 스크립트 유무에 기대지 않게 둔다.
