# 팀장 lease — 신원+프로젝트당 팀장 하나 (과제 B)

- 작성: 2026-09-23
- 상위: `docs/idea.md` 「에이전트 스킬」 과제 B(1레포 1팀장)
- 선행: 과제 A `docs/superpowers/specs/2026-09-23-dflow-config-design.md`(staging 5bde7d4e)
- 반영 범위: staging 까지. main·dflow-kit 반영은 별도 지시.

## 1. 문제

같은 PAT(= 같은 신원)로 `/dflow-team` 팀장을 두 곳에서 띄우면 지금은 다음이 뚫려 있다.

| | 경우 | 지금 결과 |
|---|---|---|
| ① | 같은 PC, 다른 clone 또는 다른 리포 | 로컬 잠금(`dflow-team.lock`)은 같은 리포의 워크트리끼리만 본다. 두 팀장이 뜨고 좌석 ID(`<신원>/<host>/w<n>`)가 겹친다. 재개 요청이 host 로만 걸러져 남의 워크트리를 재개할 수 있다 |
| ② | 다른 PC, 같은 hostname | ①과 같다 |
| ③ | 다른 PC, 같은 프로젝트 | 팀장이 둘이 된다. claim CAS 덕에 한 작업을 둘이 점유하지는 않지만 슬롯·승인 스윕·머지가 겹친다 |

사용자 결정(2026-09-23):
- 잠금 단위는 **신원+프로젝트당 하나**다.
- 방어는 **서버 lease 하나**로 한다(로컬 `~/.dflow` 잠금은 두지 않는다).
- 강제 인수로 밀려난 팀장의 **워커는 하던 작업을 끝까지 한다.**

## 2. 목표와 비목표

목표
- 한 `(user_id, project_id)` 에 살아 있는 팀장은 언제나 하나다(PC·clone·hostname 무관).
- 팀장이 죽으면 lease 가 스스로 풀린다: 같은 PC 에서 프로세스만 죽으면 즉시, PC 째 죽으면 TTL(3분) 뒤.
- 사람이 강제로 넘겨받을 수 있다: CLI `--takeover`, 웹 「팀장 해제」 버튼.
- 재개 요청은 lease 를 쥔 팀장에게만 간다.

비목표
- 워커 claim 을 lease 로 막지 않는다(워커는 lease 를 모른다. 팀장 수준에서 막는다).
- 좌석 ID 형식(`<신원>/<host>/…`)은 바꾸지 않는다.
- 구버전 스킬로 뜬 팀장은 막지 못한다(lease 를 잡지 않으므로 보이지 않는다). 모든 PC 가 새 스킬을 쓰게 되면 보호가 완전해진다.
- 단독 `/dflow-poll`·`/dflow-dev` 는 lease 대상이 아니다.

## 3. 용어

- **holder**: lease 를 쥔 자리. `<PC ID>:<리포 경로 해시>`.
  - PC ID 는 `~/.dflow/machine-id` 의 UUID 다. 없으면 처음 쓸 때 만든다(디렉터리 700, 파일 600). hostname 은 겹칠 수 있어 쓰지 않는다.
  - 리포 경로 해시는 `git rev-parse --show-toplevel` 을 `cksum` 한 값이다. 서버에 홈 경로를 보내지 않기 위해 해시로 보낸다. 링크된 워크트리(`lead-worktree.sh`)는 경로가 달라 holder 도 다르다.
- **generation**: `(user_id, project_id)` 행의 단조 증가 정수. 획득·인수·해제 때 오른다. 갱신은 holder 와 generation 이 둘 다 맞을 때만 된다(펜싱 토큰).
- **TTL**: 3분. 갱신 주기 60초.

## 4. 데이터 — 마이그레이션 0101

`supabase/migrations/0101_agent_lead_leases.sql` + `0101_agent_lead_leases_rollback.sql`. 코드와 다른 커밋.

```sql
create table if not exists agent_lead_leases (
  user_id     uuid not null references auth.users(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  holder      text,               -- null = 비어 있음(해제됨)
  host        text,               -- 표시용 hostname 슬러그
  agent       text,               -- 표시용 '<신원>/<host>/lead'
  generation  bigint not null default 0,
  acquired_at timestamptz,
  renewed_at  timestamptz,
  expires_at  timestamptz,
  primary key (user_id, project_id)
);
alter table agent_lead_leases enable row level security;
-- 정책 없음 = authenticated 접근 없음(0095 agent_watchers 와 같은 판단). 읽기·쓰기 모두 service_role.
```

RLS 는 켜고 정책은 두지 않는다. 0095 가 `agent_watchers` 의 select 정책을 지운 이유(로그인 사용자 전체가 남의 신원·host 를 읽게 됨)가 이 테이블에도 그대로 해당한다. 오피스 화면은 좌석표 조회(`src/lib/data/agentSeatmap.ts`)처럼 서버에서 admin 클라이언트로 읽는다.

DB 함수 넷(`security definer` 아님, 실행 권한은 service_role 에게만). acquire 는 대상 행을 `for update` 로 잠그고, 나머지는 조건부 update 로 CAS 한다.

### `lead_lease_acquire(p_user uuid, p_projects uuid[], p_holder text, p_host text, p_agent text, p_takeover boolean)`
1. 없는 행은 `holder=null, generation=0` 으로 insert (`on conflict do nothing`).
2. 모든 대상 행을 `for update` 로 잠근다.
3. 행마다 판정한다:
   - 비었다(`holder is null`) 또는 만료(`expires_at < now()`) → 얻을 수 있다.
   - `holder = p_holder` → 같은 자리의 재시작, 즉시 얻는다.
   - 그 밖 → `p_takeover` 면 빼앗는다, 아니면 **막힘**.
4. 하나라도 막히면 **아무것도 바꾸지 않고** 막힌 행 목록(`project_id, host, agent, expires_at`)을 돌려준다(전부 아니면 전무).
5. 모두 얻을 수 있으면 행마다 `holder, host, agent` 를 쓰고 `generation = generation + 1`, `acquired_at = renewed_at = now()`, `expires_at = now() + 3분`. 행마다 새 generation 을 돌려준다.

### `lead_lease_renew(p_user uuid, p_holder text, p_leases jsonb)`
`p_leases = [{project_id, generation}]`. 행마다 `holder = p_holder and generation = <값>` 이면 `renewed_at = now(), expires_at = now() + 3분`. **만료됐어도 아무도 가져가지 않았으면 갱신된다**(holder·generation 이 그대로이므로). 맞지 않는 행은 `lost` 로 돌려준다.

### `lead_lease_release(p_user uuid, p_holder text, p_leases jsonb)`
holder·generation 이 맞는 행만 `holder = null, expires_at = now(), generation = generation + 1`. 행을 지우지 않는다: generation 을 이어 가야 옛 팀장의 갱신이 확실히 실패한다.

### `lead_lease_force_release(p_user uuid, p_project uuid)`
웹 강제 해제(§7). 살아 있는 lease(`holder is not null and expires_at >= now()`)만 release 와 같은 효과로 풀고, holder·generation 조건은 보지 않는다. 풀린 행 수를 돌려준다.

TTL 3분은 SQL 함수 `lead_lease_ttl()` 한 곳에만 둔다. 함수 인자로 받지 않는다.

리허설 동작 검증은 `scripts/checks/0101_lead_lease_check.sql`(롤백되는 트랜잭션 안의 assert)로 한다.

## 5. API — `POST /api/v1/agent/lead/lease`

PAT 전용(레거시 시크릿은 `identity_required` 400). `requireScope(principal, 'work:claim')`. 본문 `op` 로 나눈다.

| op | 본문 | 성공 | 실패 |
|---|---|---|---|
| `acquire` | `{projects: uuid[], holder, host, agent, takeover?: boolean}` | `{ok, leases: [{project_id, generation, expires_at}]}` | 409 `lead_lease_held` + `held: [{project_id, host, agent, expires_at}]` |
| `renew` | `{holder, leases: [{project_id, generation}]}` | `{ok, expires_at, lost: [project_id]}` (lost 가 비어야 정상) | — |
| `release` | `{holder, leases: [{project_id, generation}]}` | `{ok, released: n}` | — |

검증
- `projects` 는 1~20개의 uuid. 프로젝트 한정 PAT 는 `patProjectAllowed` 로 거른다(어긋나면 403 `forbidden_role`).
- 프로젝트마다 `isAgentProjectMember` 로 멤버인지 본다. 아니면 403 `forbidden_role`. 멤버가 아닌 프로젝트의 lease 를 잡아 남을 막는 일을 막는다.
- `holder` 는 `^[0-9a-f-]{36}:[0-9]{1,12}$`, `host`·`agent` 는 1~120자.
- 조회·쓰기 실패는 500 이다. "lease 없음"으로 위장하지 않는다(에러 3원칙).

`dflow.sh` 종료 코드 매핑은 기존 규칙을 따른다: 409 → 4, 403 → 5, 401 → 3, 그 밖의 4xx → 2, 5xx·네트워크 → 6.

### watch 의 재개 요청 거르기
`POST /api/v1/agent/watch` 본문에 선택 필드 `holder` 를 더한다.
- `holder` 가 있으면 `resume_requests` 를 **이 신원이 그 holder 로 유효한 lease 를 쥔 프로젝트**의 주문으로만 거른다. lease 조회가 실패하면 `resume_requests: null` + `resume_requests_error` 다(기존 null 규약).
- `holder` 가 없으면(단독 `/dflow-poll`, 구버전 팀장) 지금 동작 그대로다.

## 6. CLI — `dflow.sh lease`

설정을 읽고 `TOK` 을 고르는 기존 흐름을 그대로 탄다. 상태 파일은 `git rev-parse --git-path dflow-team.lease` (팀장 체크아웃의 `.git` 안, 커밋되지 않음). 한 줄에 `<project_id> <generation>` 이다.

| 하위 명령 | 동작 | 출력·종료 |
|---|---|---|
| `lease acquire [--takeover]` | 대상 = `dflow.sh config projects` 전체. 성공하면 상태 파일을 쓴다 | 0 + `LEASE_OK <n>`. 막히면 4 + 줄마다 `LEAD_LEASE_HELD <project_id> <host> <agent> <expires_at>` |
| `lease renew` | 상태 파일의 lease 를 갱신하고 `<상태 파일>.beat` 에 epoch 초를 쓴다 | 0 + `LEASE_OK`. lost 가 있으면 4 + `LEASE_LOST <project_id…>`. 상태 파일이 없으면 2 + `LEASE_NONE` |
| `lease release` | 상태 파일의 lease 를 반납하고 파일을 지운다 | 0 + `LEASE_RELEASED <n>`. 파일이 없으면 0 + `LEASE_NONE` |
| `lease keep --pid <PID> --lost-file <path>` | 60초마다 renew. `kill -0 <PID>` 가 실패하거나 TERM·HUP·INT 를 받으면 release 하고 0 으로 끝난다. 상태 파일이 없어지면(정상 마감의 release) 0 으로 끝난다. renew 가 `LEASE_LOST` 면 `<path>` 에 그 줄을 쓰고 4 로 끝난다. 네트워크 실패(6)는 다음 주기에 다시 시도하고, 연속 3회(=3분) 실패하면 `LEASE_UNREACHABLE` 을 `<path>` 에 쓰고 6 으로 끝난다 | — |
| `lease holder` | holder 문자열을 찍는다(machine-id 가 없으면 만든다) | 0 |

`holder` 계산과 machine-id 생성은 `dflow-config.sh` 옆의 작은 함수로 둔다. machine-id 파일 내용은 비밀이 아니지만 권한을 600 으로 둔다.

`LEASE_UNREACHABLE` 로 끝내는 이유: 서버에 3분간 닿지 못하면 lease 가 이미 만료돼 다른 곳이 가져갔을 수 있다. 소유를 장담할 수 없으므로 잃은 것으로 다룬다(로컬 잠금의 `LOCK_LOST beat 쓰기 실패` 와 같은 판단).

## 7. 웹 — 오피스 「팀장 해제」

- 오피스 화면(`src/components/agents/SeatmapView.tsx` 계열)의 팀장 좌석에 lease 표시를 더한다: 쥔 host, 마지막 갱신 시각. 만료된 lease 는 표시하지 않는다.
- 「팀장 해제」 버튼 → 서버 액션 `releaseLeadLease(projectId, userId)`:
  - 가드: `requireProjectMember(projectId)` 뒤 호출자 = lease 의 `user_id` 인지 보거나, 아니면 `requireProjectAdmin(projectId)`. 판정은 `src/lib/domain/authz.ts` 순수 함수로 둔다(액션에 역할 문자열을 적지 않는다). service_role 로 쓰므로 이 가드가 유일한 관문이다.
  - 쓰기: 그 `(user_id, project_id)` 행을 `holder = null, expires_at = now(), generation = generation + 1`.
  - 실패는 사용자에게 표시하고 로깅한다.
- 이 버튼은 `src/components/agents/*` 만 고친다(UI 위험 파일 목록 밖).

## 8. 팀장 흐름 — `dflow-team/SKILL.md`

### 시작
1. 기존 사전 점검(설정·`SAME_IDENTITY_LEAD`·로컬 잠금 `mkdir`)은 그대로다. `SAME_IDENTITY_LEAD` 는 서버를 부르기 전에 같은 리포의 겹침을 빨리 거른다.
2. 로컬 잠금을 잡은 **다음** `dflow.sh lease acquire` (인자에 `--takeover` 가 있으면 붙인다).
   - `LEASE_OK` → 계속.
   - `LEAD_LEASE_HELD …` → 로컬 잠금을 풀고 멈춘다. 보고: 어느 프로젝트를 어느 host 의 누가 언제까지 쥐었는지, 그리고 "그 팀장이 이미 죽었다면 최대 3분 뒤 풀린다. 지금 넘겨받으려면 `--takeover` 또는 오피스의 「팀장 해제」".
   - 그 밖의 실패(3·5·6) → 로컬 잠금을 풀고 사유를 보고하고 멈춘다(fail-closed).
3. 감시 시작 단계에서 `dflow.sh lease keep --pid <LEAD_PID> --lost-file '<git rev-parse --path-format=absolute --git-path dflow-team.lease-lost 의 값>'` 를 `run_in_background` 로 띄운다(`caffeinate -w` 와 같은 자리). 띄우기 전에 옛 `lease-lost` 파일을 지운다. 워크트리에선 `.git` 이 파일이라 `<팀장 체크아웃>/.git/…` 로 적으면 틀린다.
4. `--takeover` 는 새 인자다. `references/help.md` 인자 표에 더한다.

### 20초 감시 루프
`STOP_FILE` 검사 바로 뒤에 `LEASE_FILE`(`dflow-team.lease-lost`) 검사를 더한다: 있으면 `LEASE_LOST <파일 첫 줄>` 을 출력하고 끝난다. 결과 도착보다 먼저 본다(밀려난 팀장이 새 결과로 spawn 을 잇지 않게).

### 기상마다
`h=$(dflow.sh lease holder) || h=''` 로 먼저 값을 구한다. `h` 가 비어 있지 않을 때만 watch 호출에
`--holder "$h"` 를 더한다(재개 요청 거르기, §5). `h` 가 비면 watch 를 부르지 않고 `HOLDER_FAILED` 로 보고한다 —
`--holder "$(...)"` 를 그대로 값 자리에 넣으면 조회 실패가 빈 문자열로 조용히 넘어가 무필터(전체 재개 요청)로
호출되기 때문이다.
`<상태 파일>.beat` 가 180초 넘게 낡았으면 `LEASE_KEEP_DEAD` 로 보고하고 `lease renew` 를 한 번 부른다. `LEASE_OK` 면 `lease keep` 을 다시 띄우고, `LEASE_LOST`·`LEASE_NONE` 이면 lease 상실 마감으로 간다(§12 의 「`lease keep` 만 죽음」).

### `LEASE_LOST` 기상 → 밀려난 팀장의 마감
1. "팀장 lease 상실(다른 곳에서 인수)" 로 보고한다.
2. 새 claim·새 spawn·승인 스윕을 하지 않는다.
3. poll·감시 루프를 거둔다(`lease keep` 은 표식을 쓰고 이미 끝나 있다). 정상 마감의 블록을 그대로 써서 `lease release` 를 불러도 된다: 서버가 holder·generation 이 맞는 행만 풀므로 빼앗긴 lease 에는 0건이고, `LEASE_UNREACHABLE` 로 끝난 경우에는 아무도 가져가지 않은 내 lease 를 바로 푼다.
4. **떠 있는 워커는 건드리지 않는다.** 워커는 하던 작업을 끝까지 하고 agent 브랜치 push 와 done 보고를 한다. 그 결과는 새 팀장의 승인 스윕이 서버에서 이어받는다.
5. 로컬 잠금(`dflow-team.lock`)을 지우고 끝낸다. 이유: 같은 리포에서 새 팀장을 다시 띄울 수 있어야 한다.
6. 보고에 "워커 N명은 하던 작업을 끝낸 뒤 스스로 끝난다" 와 그 슬롯 목록을 적는다.

### 정상 마감(「7. 마감」)
`lease keep` 을 거두고 `dflow.sh lease release` 를 부른 뒤 로컬 잠금을 지운다. release 실패는 보고만 한다(3분 뒤 스스로 풀린다).

## 9. 재개 요청 오배달

§5 의 `holder` 거르기로 푼다. 신원+프로젝트마다 팀장이 하나이므로, hostname 이 겹쳐도 lease 가 없는 팀장은 그 프로젝트의 재개 요청을 받지 않는다. 기존 SKILL.md 의 `other_project` 분기와 host 글자 비교는 그대로 둔다(구버전 서버와 섞여도 안전).

## 10. 테스트

| 층 | 파일 | 내용 |
|---|---|---|
| 마이그레이션 문안 | `tests/migrations/agent-lead-leases.test.ts` | 기존 방식(파일을 읽어 문자열 검사): 테이블·PK·RLS 켜짐·정책 없음, 세 함수의 `for update`, rollback 이 함수·테이블을 지움 |
| DB 함수 동작 | 스테이징 리허설(§11 2번) | psql 로 확인: 빈 행 획득, 같은 holder 즉시 인수, 다른 holder 막힘(전부 아니면 전무), takeover 로 generation 증가, 만료 뒤 획득, 만료됐지만 안 뺏긴 lease 의 renew 성공, generation 불일치 renew → lost, release 뒤 generation 증가. 결과를 `Staging-verified:` 트레일러와 계획 원장에 남긴다 |
| route | `tests/agent/lead-lease-route.test.ts` | `heartbeat-route.test.ts` 방식의 admin 클라이언트 목으로: 스코프·PAT 프로젝트 한정·비멤버 403·형식 검증 400·409 본문 형태·조회 실패 500 |
| watch | `tests/agent/watch-route.test.ts` 에 추가 | `holder` 있을 때 lease 프로젝트만, lease 조회 실패 시 null, `holder` 없을 때 기존 동작 |
| CLI | `tests/skills/dflow-lead-lease.test.ts` | 가짜 `curl`(PATH 앞): acquire 성공·막힘 출력과 종료 코드, 상태 파일, renew lost, release, `keep` 이 죽은 PID 에 release 하고 끝남, 네트워크 3회 실패에 `LEASE_UNREACHABLE`, machine-id 생성·권한 600 |
| 스킬 문서 | `tests/skills/dflow-team*.test.ts` | 시작 단계의 `lease acquire` 위치(로컬 잠금 뒤), 감시 루프 `LEASE_LOST` 검사가 결과보다 앞, `LEASE_LOST` 마감이 워커를 건드리지 않음, 셸 블록 문법(`dflow-team-shell-blocks`) |
| 권한 | `tests/authz/` 의 새 파일 | 해제 판정 순수 함수: 본인 허용, 관리자 허용, 타인 멤버 거부, 비멤버 거부 |
| 화면 | ego-browser, 스테이징 | 팀장을 띄운 뒤 오피스에 lease 표시, 「팀장 해제」 → 팀장이 약 1분 안에(다음 갱신 + 감시 루프 20초) `LEASE_LOST` 로 멈춤 |

## 11. 배포 순서

1. 워크트리 브랜치에서 구현(마이그레이션 커밋은 따로).
2. `staging:sync` → `db:apply --target staging` 로 0101 적용 → DB 함수 검증 → 커밋 트레일러 `Staging-verified:`.
3. staging push → 스테이징 URL 에서 CLI·화면 확인.
4. 운영(0101 prod 적용 → main)과 dflow-kit 재빌드는 별도 지시. 운영 순서는 **DB 먼저, main 다음**이다(새 스킬이 없는 API 를 부르면 lease acquire 가 404 → exit 7 로 팀장이 시작하지 못한다).

## 12. 위험과 대응

| 위험 | 대응 |
|---|---|
| 서버가 0101 없이 새 스킬을 받음(404) | 팀장이 시작하지 못하고 사유를 보고한다(fail-closed). 운영 순서를 DB 먼저로 고정 |
| 팀장 기상 처리가 길어 갱신이 끊김 | 갱신은 별도 `lease keep` 프로세스가 하므로 기상 처리와 무관하다 |
| `lease keep` 만 죽음 | lease 가 3분 뒤 만료되고 다른 곳이 가져갈 수 있다. 기상마다 `.beat` 의 나이로 keep 의 생존을 보고(`LEASE_KEEP_DEAD`), 죽었으면 `lease renew` 로 확인한 뒤 다시 띄운다(lost 면 lease 상실 마감) |
| Windows 에서 `CLAUDE_PID` 가 없음 | 기존 관문과 같다(`NO_CLAUDE_PID` 로 시작 불가). `kill -0` 은 Git Bash 에서 동작 |
| 두 곳이 동시에 acquire | DB 함수의 `for update` 가 직렬화한다. 늦은 쪽은 막힘 |
