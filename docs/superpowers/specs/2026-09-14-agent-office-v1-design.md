# 가상오피스(에이전트 좌석표) v1 구현 스펙 (2026-09-14)

- **상태**: 확정(사용자 결정 4건 반영). 구현 계획은 `docs/superpowers/plans/2026-09-14-agent-office-v1.md`.
- **정본 관계**: 설계 정리본 `2026-09-10-agent-seatmap-monitoring-design.md` 의 S1·S2 를 실제로 구현하는 문서다.
  정리본과 어긋나는 곳은 이 문서가 이긴다(§9 에 정정 목록). 팀장 스킬과의 연동 계약은
  `2026-09-10-dflow-team-design.md` §9 를 따르고, 팀장 스킬 세션이 2026-09-14 에 회신한 6건(§4-4)을 반영했다.
- **걸림돌 문서** `2026-09-11-office-team-blockers.md` 의 "착수 전 사용자 결정" 1~3 은 아래로 확정됐다.

| 결정 | 확정 내용 |
|---|---|
| 1. 착수 순서·`blocked` 스키마 | 좌석표는 팀장 리허설(Task 7~9)과 병행해 지금 착수한다. `blocked` 는 status 열을 늘리지 않고 `heartbeat_phase='blocked'` + `heartbeat_note` 로 파생한다 |
| 2. heartbeat 스코프 | PAT `work:claim` 재사용 |
| 3. Micro 부하 | S2 를 스테이징에 배포한 뒤 열람자 20명·30초 폴링·3분 재현 스크립트로 실측하고 결과를 이 문서 §6 에 기록한다. 실측 전에는 main 에 올리지 않는다 |
| 부수. STANDBY | v1 포함. 0094 에 `agent_watchers` 를 같이 넣고 `POST /api/v1/agent/watch` 를 둔다. TTL 70분 |
| 부수. staging:sync | 리허설 전 sync 를 생략한다(팀장 리허설이 쓰는 스테이징 데이터 보존). 0094 는 열 추가와 새 테이블뿐이라 기존 데이터 형태에 의존하지 않는다 |

## 1. 범위

**v1 에 들어가는 것**
- S1: 마이그레이션 0094, heartbeat API, watch API, `dflow.sh heartbeat|watch`, PostToolUse 훅 스크립트, `poll.sh` 의 watch 호출.
- S2: `/agents` 페이지(층·구역·책상·상세 패널·카운터·확인 필요 띠), 30초 폴링, 기존 비트맵 스프라이트(4캐릭터 × 9동작)로 재생. 사이드바 메뉴.
- 부하 실측 스크립트와 결과 기록.

**v1 에서 빼는 것**
- S3 Buzz 게시 전부.
- 새 스프라이트 제작(STANDBY 순찰 걷기 포함). STANDBY 는 층 헤더 배지로만 표시한다.
- 팔레트 치환(에이전트별 머리색·옷색). 캐릭터 4종 중 해시로 하나를 고르는 것까지만.
- `/dflow-dev` SKILL.md 의 Phase 경계 명시 heartbeat 호출. 이유: 그 파일은 `feat/dflow-team` 이 160줄을 고쳐 두었고 아직 main 에 없다. 훅이 `state.json` 의 `phase` 를 읽어 보내므로 없어도 Phase 별 동작이 나온다. `feat/dflow-team` 머지 뒤 한 줄씩 넣는다.
- `~/.dflow/events.jsonl` 로컬 이벤트 로그. 팀장 스킬이 `team.*` 이벤트로 이미 쓰고 있고, 좌석표는 서버 데이터만 읽는다.

## 2. 상태 모델 (확정)

판정 입력은 서버가 아는 사실뿐이다: 주문 `status`, `last_heartbeat_at`, `heartbeat_phase`, `heartbeat_note`, `updated_at`,
그 주문의 마지막 completion 보고 `review_action`, 항목 `actual_pct`. 판정은 순수 함수 `src/lib/domain/seatState.ts` 가 한다.

| 상태 | 판정 (위에서부터 먼저 맞는 것) | 책상 | 사람 · 애니메이션 |
|---|---|---|---|
| READY | `status=ready` | 점선 테두리 | 빈 의자 `empty.png` |
| WAIT (승인 대기) | `status=reported` | 주황 | `idle_coffee` / `idle_stretch` / `idle_look` 를 10초마다 순환 |
| DONE | `status=approved` | 회색, 층 안에서 접힘 | 빈 의자 |
| BLOCKED | `status=claimed` 이고 `heartbeat_phase='blocked'` | 파랑 + 손 든 표식 `?` | `idle_look` 정지 프레임(손 든 그림이 없으므로 대체) + 말풍선에 `heartbeat_note` |
| OFFLINE | `status=claimed` 이고 마지막 신호가 30분 초과 | 회색 · 붉은 테두리 · `끊김` | 빈 의자(점선) |
| STALE | `status=claimed` 이고 마지막 신호가 5분 초과 30분 이하 | 파랑 빗금 · `!` | `stale` |
| REJECTED | `status=claimed` 이고 마지막 completion 보고가 `reject` | 붉은 스트라이프 | `rejected` |
| ACTIVE | `status=claimed` (나머지) | 파랑 · progress 바 | phase 별: design→`design`, build→`typing`, verify→`verify`, refactor→`refactor`, 그 외→`typing` |
| STANDBY (층 단위) | 그 층에 해당하는 watcher 가 70분 안에 신호를 보냄 | 층 헤더 초록 배지 | 없음 |

- **마지막 신호** = `max(last_heartbeat_at, updated_at)`. heartbeat 가 한 번도 없는 옛 주문(훅 없는 수동 세션)은 progress 보고가 touch 한 `updated_at` 으로 판정된다. Phase 하나가 30분을 넘기면 OFFLINE 로 보이는데, 이것이 정리본 §1 이 드러내려던 침묵 구간이므로 감추지 않는다.
- **BLOCKED 우선**: 팀장 세션 회신대로 BLOCKED 는 시간 판정보다 앞선다. pane 팀원은 질문을 낸 뒤 heartbeat 를 보내지 않으므로, 다른 phase 의 heartbeat 가 오거나 `status` 가 `claimed` 를 벗어날 때까지 손 든 채로 남는다.
- **REJECTED 와 시간 판정**: 반려 뒤 재작업 중인 팀원이 침묵하면 STALE·OFFLINE 이 이긴다. 반려 표식(붉은 스트라이프)은 책상 장식으로 겹쳐 남긴다.
- **임계값**: STALE 5분, OFFLINE 30분(정리본 §3 초안 유지). `seatState.ts` 의 상수이며 운영하며 조정한다.
- **phase 폴백**: `heartbeat_phase` 가 없으면 항목 `actual_pct` 로 추정한다. `<25` design, `<60` build, `<85` verify, 그 외 refactor.
- **캐릭터 배정**: `heartbeat_agent ?? claimed_by ?? order.id` 를 FNV-1a 32비트로 해시해 `monitor_bot`·`cat_dev`·`human_dev`·`dome_bot` 중 하나를 고른다. 같은 `AGENT_ID` 는 늘 같은 캐릭터다(팀장 스펙 §9-1 의 슬롯별 일관 인물).
- **카운터**: Active = ACTIVE+STALE+REJECTED+BLOCKED, Standby = 살아 있는 watcher 수, Idle = WAIT, Offline = OFFLINE+READY. DONE 은 세지 않는다.
- **확인 필요 띠**: BLOCKED(질문 본문), STALE, OFFLINE, REJECTED 순.

## 3. 서버

### 3-1. 마이그레이션 `0094_agent_heartbeat.sql` (+ `_rollback.sql`)

```sql
alter table public.agent_work_orders
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists heartbeat_phase   text,
  add column if not exists heartbeat_agent   text,
  add column if not exists heartbeat_note    text;

create table if not exists public.agent_watchers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  project_id    uuid references public.projects(id) on delete cascade,   -- null = 배정분 전체
  agent         text not null,        -- '<신원>/<host>/lead' 또는 '<신원>/<host>/poll'
  host          text,
  slots         int,
  busy          int,
  until_label   text,                 -- 팀장이 준 종료시각 문자열 그대로('18:00')
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (user_id, agent)
);
create index if not exists agent_watchers_last_seen_idx on public.agent_watchers (last_seen_at);
alter table public.agent_watchers enable row level security;
-- 조회는 로그인 사용자 전체(0057 의 주문 조회 정책과 같은 수준). 쓰기 정책은 두지 않는다(service_role 전용, 서버 가드가 유일 관문).
create policy agent_watchers_select on public.agent_watchers for select to authenticated using (true);
-- (최종 리뷰 반영) 위 select 정책은 0095 에서 제거한다. 앱은 agent_watchers 를 service_role 로만 읽으며 authenticated 정책은 두지 않는다.
```

롤백은 정책·인덱스·테이블 drop 과 열 4개 drop. `tests/migrations/migration-ledger.test.ts` 가 쌍 존재를 검사한다.
리허설은 `docs/runbook-staging.md` §4 의 6단계에서 1단계(sync)만 건너뛴다. 커밋은 마이그레이션 파일만 따로(G1), `Staging-verified:` 트레일러(G4).

### 3-2. `POST /api/v1/agent/work/{id}/heartbeat`

- 파일 `src/app/api/v1/agent/work/[id]/heartbeat/route.ts`. `report/route.ts` 와 같은 골격: `createAdminClient()` → `resolveWriteActor(req, admin, raw, 'work:claim')` → PAT 면 `loadGatedOrderForUser`, 레거시면 `loadGatedOrder` → 소유 판정(`claimed_by_user_id` / `claimed_by`, 불일치 403 `not_claim_owner`).
- 본문: `{ agent: string, phase?: string, note?: string }`. `agent` 필수 1~120자. `phase` 는 `design|build|verify|refactor|blocked|rejected|reported` 중 하나, 아니면 400. `note` ≤ 500자, `phase='blocked'` 일 때만 저장한다.
- 효과 (CAS, `.eq('status','claimed')`): `last_heartbeat_at=now`, `updated_at=now`, `heartbeat_agent=agent`, `heartbeat_phase = phase ?? null`, `heartbeat_note = phase==='blocked' ? note ?? null : null`. 0행이면 409 `conflict`(claimed 가 아님). **보고 행·스냅샷·알림·revalidate 없음.**
- 응답 200 `{ ok: true, last_heartbeat_at }`. GET 등 나머지 메서드는 `apiNotFound`.
- "phase 를 생략하면 null" 규칙 덕에 사람이 답한 뒤 팀원의 다음 heartbeat 가 BLOCKED 를 푼다(훅은 항상 phase 를 보낸다).

### 3-3. `POST /api/v1/agent/watch`

- 파일 `src/app/api/v1/agent/watch/route.ts`. 인증은 PAT 전용(`resolveWriteActor` 의 PAT 갈래, `work:claim`). 레거시 토큰은 400 `identity_required`(`me` 라우트와 같음).
- 본문: `{ agent: string, host?: string, slots?: int, busy?: int, until?: string, project_id?: uuid }`. `agent` 필수 1~120자. PAT 가 프로젝트 한정이면 `project_id` 는 그 값으로 강제하고, 본문 값이 다르면 403 `forbidden_role`. 전역 PAT 면 본문 `project_id` 를 쓰고 없으면 null.
- 효과: `agent_watchers` 를 `(user_id, agent)` 로 upsert, `last_seen_at=now`. 같은 호출에서 `last_seen_at < now - 7일` 인 행을 지운다(청소를 따로 두지 않는다).
- 응답 200 `{ ok: true, expires_at }` (`last_seen_at + 70분`).
- **감시 종료**(팀장 세션 조율 2, 2026-09-14): 본문에 `stop: true` 가 있으면 그 `(user_id, agent)` 행을 지우고 `{ ok: true, stopped: true }` 로 답한다. 팀장은 「7. 마감」에서, `poll.sh` 는 `--until` 도달(exit 8)에서 `dflow.sh watch --stop` 을 1회 부른다. TTL 만료를 기다리지 않고 STANDBY 가 꺼진다.
- 살아 있음 판정은 화면이 한다: `last_seen_at > now - 70분`. 70분은 팀장 잠금의 죽음 판정(두 TICK 연속 누락)과 같은 값이다.

## 4. 클라이언트 신호

### 4-1. `dflow.sh heartbeat` · `dflow.sh watch`

`.claude/skills/dflow-work/scripts/dflow.sh` 에 추가한다. `feat/dflow-team` 은 이 파일을 건드리지 않았다.

```
dflow.sh heartbeat <ref> [--phase p] [--note "<질문>"] [--agent id]
    POST /api/v1/agent/work/<id>/heartbeat. --agent 기본값은 워크트리 루트 .dflow-agent 첫 줄, 없으면 claude-<host>.
    출력: last_heartbeat_at 한 줄. 종료 코드는 api_raw 규칙(409→4).
dflow.sh watch [--agent id] [--slots n] [--busy n] [--until HH:MM] [--project id] [--stop]
    POST /api/v1/agent/watch. --agent 기본값은 <신원>/<host>/poll (신원은 /me 의 user_email 로 만든 슬러그).
    --stop 이면 본문 {agent, stop:true} 로 행을 지운다. 출력: expires_at 한 줄(--stop 은 "stopped").
```

- `cmd_heartbeat` 는 `cmd_progress`(234행) 바로 뒤, case 줄은 `progress)` 다음에 둔다(팀장 세션 회신 3).
- git 을 부르면 `${DFLOW_GIT:-git}` 로 쓴다(팀장 쪽 후속 커밋과 충돌 방지).
- `usage()`(21~34행)와 `dflow-work/SKILL.md` 의 "진행 보고" 절 옆에 두 서브커맨드를 같이 적는다.
- 신원 슬러그 규칙은 팀장 스펙 §9-1 과 같다: `user_email` 의 `@` 앞을 소문자로, `[a-z0-9-]` 밖은 `-`. host 는 `hostname -s` 에 같은 규칙.

### 4-2. PostToolUse 훅 `kit/hooks/heartbeat.sh`

설치 위치는 `~/.dflow/hooks/heartbeat.sh`. `dflow.sh` 를 거치지 않는다. 이유: `api_raw` 는 타임아웃이 없고 비-2xx 마다 exit 하며 임시파일을 쓰므로 "fire-and-forget, 실패 무시" 를 만족하지 못한다.

동작 순서(모든 단계에서 조건이 안 맞으면 조용히 exit 0):
1. stdin JSON 을 읽어 `cwd` 를 얻는다(없으면 `$PWD`). `git rev-parse --show-toplevel` 로 루트를 잡는다. git 은 `command -v git` 절대경로.
2. `AGENT_ID`: 루트 `.dflow-agent` 첫 줄. 값이 `*/parked` 면 종료(팀장 세션 회신 2). 파일이 없으면 현재 브랜치가 `agent/` 로 시작할 때만 `claude-<host>` 로 계속하고, 아니면 종료(팀장 세션·기본 브랜치 세션은 아무것도 보내지 않는다).
3. 대상 작업: `docs/tasks/*/state.json` 중 `phase` 가 `design|build|verify|refactor|rejected` 인 파일. 여럿이면 mtime 최신. 없으면 종료. `order`(전체 UUID)와 `phase` 를 읽는다. 브랜치 이름에서 TSK 를 뽑지 않는다(수동 `agent/<id8>-<slug>` 와 팀원 브랜치 이름이 달라도 동작해야 한다).
4. 절제: `~/.dflow/hb/<order>` 의 mtime 이 60초 안이면 종료. 아니면 touch.
5. 인증: 루트 `.env` 를 `set -a; . .env; set +a` 로 읽는다(팀원 워크트리에는 `.env` 심링크가 있다). `DFLOW_API_BASE`·`DFLOW_PATS` 첫 토큰(없으면 `DFLOW_PAT`) 이 없으면 종료.
6. `curl -s -o /dev/null --max-time 1.5 -X POST ... /api/v1/agent/work/<order>/heartbeat` 본문 `{agent, phase}`. 백그라운드(`&`)로 띄우고 훅은 즉시 exit 0. 출력 없음.

정리본이 절제 파일을 `docs/tasks/<TSK>/.hb` 로 두었으나 `docs/tasks/` 는 커밋되는 디렉터리라 대상 리포의 `.gitignore` 를 건드려야 한다. `~/.dflow/hb/` 로 옮긴다.

글로벌 등록은 `~/.claude/settings.json` 의 `hooks.PostToolUse` 배열에 Orca 훅과 나란히 두 번째 원소를 추가한다(이 PC 에서는 이 세션이 `update-config` 절차로 추가하고, 다른 PC 는 `kit/README.md` 의 안내를 따른다):

```json
{ "matcher": "*", "hooks": [ { "type": "command",
  "command": "if [ -x \"${HOME-}/.dflow/hooks/heartbeat.sh\" ]; then /bin/sh \"${HOME-}/.dflow/hooks/heartbeat.sh\"; else cat >/dev/null 2>&1 || :; fi",
  "timeout": 5 } ] }
```

`kit/install.sh` 는 `permissions.allow` 병합만 하고 hooks 를 건드리지 않는다(팀장 세션 회신 6). 훅 설치는 install.sh 에 `--hooks` 옵션으로 `~/.dflow/hooks/heartbeat.sh` 복사만 추가하고, settings.json 편집은 안내문으로 둔다. `kit/README.md` 는 파일 끝에 새 절로 붙인다(`feat/dflow-team` 의 README 수정 위치와 겹치지 않게).

### 4-3. `poll.sh` 의 watch 호출

`.claude/skills/dflow-poll/scripts/poll.sh` 의 매 주기 시작부(`--until` 검사 직후, 승인 스캔 앞, 54~55행 부근)에서
`"$DFLOW" watch --until "$UNTIL_LABEL" >/dev/null 2>&1 || :` 를 부른다. 이 자리는 exit 하는 주기(0/8/9/10)에도 반드시 한 번 지난다. 실패는 폴링을 막지 않는다. `poll.sh` 는 `.env` 와 `DFLOW` 경로를 이미 갖고 있어 배선이 더 필요 없다.

- **`DFLOW_WATCH=0` 이면 보내지 않는다**(팀장 세션 조율 1). 팀장은 poll.sh 를 자기 아래에서 띄울 때 이 값을 붙인다. 팀장이 `<신원>/<host>/lead` 로 직접 보내므로, poll.sh 까지 보내면 같은 사람이 watcher 둘로 보이거나 `slots`·`busy` 없는 신호가 lead 행을 덮는다.
- 단독 `/dflow-poll` 의 watcher 는 `<신원>/<host>/poll` 이다(`dflow.sh watch` 기본값). 좌석표는 `<신원>/<host>` 앞부분이 같은 lead·poll 을 나란히 보여 준다.
- `--until` 도달로 끝날 때(exit 8 직전) `"$DFLOW" watch --stop >/dev/null 2>&1 || :` 를 1회 부른다.

### 4-4. 팀장 스킬과의 계약 (팀장 세션 회신 반영)

| 항목 | 좌석표 쪽 | 팀장 쪽(팀장 세션이 반영) |
|---|---|---|
| `blocked` | §2 판정. `phase` 없는 다음 heartbeat 가 푼다 | `worker-prompt.md` blocked 직전에 `dflow.sh heartbeat <id8> --phase blocked --note "<질문>"` 1회 |
| `.dflow-agent` | 훅이 첫 줄을 `agent` 로 보냄. `parked` 면 침묵 | 팀원이 씀. 팀장은 쓰지 않음 |
| STANDBY | `agent_watchers` + watch API, TTL 70분, `stop` 으로 즉시 종료 | SKILL.md 「1. 시작」·매 기상에서 `dflow.sh watch --agent <신원>/<host>/lead --slots N --busy M --until HH:MM`, 「7. 마감」에서 `dflow.sh watch --agent <신원>/<host>/lead --stop`. poll.sh 기동에 `DFLOW_WATCH=0` |
| dflow.sh | `cmd_heartbeat`·`cmd_watch` 신설, git 은 `${DFLOW_GIT:-git}` | 미수정 |
| 브랜치 | `staging` 기점 `feat/agent-office` 워크트리 | `feat/dflow-team` 은 main 기점, 미push |

계약이 확정된 시점에 heartbeat 본문과 watch 본문(§3-2·§3-3)을 팀장 세션에 보낸다.

## 5. 화면

### 5-1. 접근과 데이터

- 페이지 `src/app/(app)/agents/page.tsx`, `dynamic = 'force-dynamic'`. 게이트는 `src/lib/authz/agentsAccess.ts` 의 `canViewAgents(actor)` = 슈퍼유저 또는 `isAnyProjectAdmin`. 아니면 `redirect('/projects')`(usage 와 같은 방식). 층 목록은 `seatmapProjectIds(actor)`: 슈퍼유저는 전체, 관리자는 `adminProjectIds(actor)`.
- 조회 `src/lib/data/agentSeatmap.ts`(서버 전용, `createAdminClient`). 프로젝트 필터는 항상 위 목록으로 건다. 요청 6개를 `Promise.all` 로: ① 주문(`status in ready,claimed,reported` 전부 + `approved` 는 최근 7일) ② 주문 항목(`wbs_items` id, code, name, parent_id, actual_pct) ③ 부모 항목(구역) ④ claimed 주문의 마지막 completion 보고(`agent_work_reports` kind=completion, `review_action`, `created_at`) ⑤ `agent_watchers` 70분 이내. 프로젝트 이름은 ⑥ `projects`. 어느 하나라도 실패하면 throw 한다(데이터 없음으로 위장하지 않는다).
- 조립은 순수 함수 `src/lib/domain/seatmap.ts` 의 `assembleSeatmap(rows, now)` 가 한다: 층(프로젝트) → 구역(주문 항목의 **부모 항목**, 없으면 "구역 없음") → 책상(주문, 항목 code 순). 구역 라벨은 부모의 `code · name`. "WP" depth 개념은 리포에 없으므로 쓰지 않는다.
- (2026-09-14 사용자 결정) 대상은 **에이전트 위임 태그(`wbs_items.tags` ∋ `agent`, `wbsSpec.ts` `AGENT_TAG`)가 붙은 항목의 주문뿐**이다. `dev_workflow` 리프마다 주문이 생기므로 사람이 하는 작업의 주문도 테이블에 있지만 좌석표엔 올리지 않는다. 항목이 지워진 주문은 태그를 알 수 없어 제외한다("항목 없음" 구역은 없앰). 기본 범위는 `scope=mine`(담당자가 나 또는 내 계정이 잡은 주문), 헤더에서 `all` 로 전환.
- 갱신: 클라이언트가 30초마다 서버 액션 `refreshSeatmap()`(`src/app/actions/agentSeatmap.ts`, 같은 게이트 재검사)을 부른다. `document.hidden` 이면 멈추고, 다시 보이면 즉시 1회. 실패하면 마지막 성공 데이터를 유지하고 상단에 "갱신 실패 HH:MM:SS" 를 표시한다.

### 5-2. 구성

`src/components/agents/`(위험 파일 `src/components/app/*` 에 두지 않는다):

| 파일 | 역할 |
|---|---|
| `SeatmapView.tsx` | 클라이언트 루트. 폴링, 선택 상태, 레이아웃(목업 v2: 상단 카운터 → 확인 필요 띠 → 층 그리드 + 우측 상세 패널 → 범례) |
| `Counters.tsx` | Active/Standby/Idle/Offline 4칸 |
| `AttentionBand.tsx` | 확인 필요 항목 버튼 목록, 클릭하면 그 책상 선택 |
| `FloorCard.tsx` | 층 헤더(프로젝트명, 구역·좌석 수, STANDBY 배지에 watcher `agent`·`busy/slots`·`until`), DONE 접기 |
| `ZoneBlock.tsx` | 구역 헤더(코드·이름·진행/대기/완료 집계)와 통로선 양쪽 두 줄 좌석 |
| `Seat.tsx` | 의자(스프라이트) + 책상 버튼(TSK 코드·이름·메타 줄·progress 바·`!`/`끊김`/`?` 표식) |
| `Sprite.tsx` | `public/sprites/<char>/<anim>.png` 를 `background-image` 로, 96px 셀, `steps(n)` 키프레임. `prefers-reduced-motion` 이면 정지. 4프레임·6프레임 두 클래스 |
| `DetailPanel.tsx` | 선택 책상: 층·구역·주문 id8, 상태 pill, Phase 사다리(design 25 / build 60 / verify 85 / reported 100 / merged), 에이전트, 마지막 신호 시각, heartbeat phase, BLOCKED 질문 전문, 반려 사유(`review_note`), 프로젝트 WBS 링크 |
| `seatmap.module.css` | 색·키프레임·`image-rendering: pixelated`. `globals.css` 는 건드리지 않는다. 다크는 `.dark` 조상 선택자로 토큰을 바꾼다. 상태 변형 display 유틸 금지 |

- 캐릭터 그림과 책상 색은 정리본 §3 표와 목업 v2 의 팔레트를 그대로 옮긴다.
- 사이드바 메뉴: `(app)/layout.tsx` identity 에 `showAgents`, `Sidebar.tsx` props·`items.push`·전역 블록, `common.ts`/`common.en.ts` 에 `nav.agents`(`에이전트`/`Agents`). 이 4곳은 **별도 커밋**으로 두고, 브랜치를 push 해 Preview 를 받는다(G2). 나머지 커밋은 위험 파일을 건드리지 않는다.

## 6. Micro 부하

**설계상 근거**
- 열람 경로는 브라우저 → Vercel 서버 액션 → PostgREST(service_role, HTTP) 다. 브라우저가 Supabase 에 직접 붙지 않으므로 열람자 수가 직접 연결 60 한도를 먹지 않는다.
- 열람자 1명 = 30초마다 PostgREST 요청 6개. 20명이면 초당 4요청이다. 숨긴 탭은 0.
- heartbeat = 열 touch 1회(요청 1개, 행 증가 없음). 팀원 4명이 60초 절제로 보내면 분당 4요청. **행이 늘지 않으므로** 08-05 장애의 실제 원인(디스크 사용률 → PostgREST 크래시 루프)과 같은 경로가 없다. `agent_watchers` 도 (user, agent) 당 1행이다.

**실측 절차(스테이징, S2 배포 뒤, main 머지 전)**
- `scripts/seatmap-load.mjs --viewers 20 --minutes 3 --interval 30`: 스테이징 service_role 로 §5-1 의 조회 6개를 열람자 수만큼 병렬로 반복한다. 요청별 지연(p50/p95/max)과 오류 수를 출력한다. 자격은 `db:apply` 가 쓰는 스테이징 좌표 규칙과 같은 env 를 쓴다.
- 같은 시간에 브라우저 두 개로 `/agents` 를 열어 두고, `dflow.sh heartbeat` 를 10초 간격으로 20회 보낸다.
- Supabase 대시보드 Database → Connections·CPU 를 전후 비교한다.
- 합격: 오류 0, p95 < 1.5초, 연결 수 증가 ≤ 5. 결과는 이 절 아래 표에 적는다.

| 측정일 | 열람자 | 요청 수 | p50 | p95 | 오류 | 연결 증가 | 판정 |
|---|---|---|---|---|---|---|---|
| (미측정) | | | | | | | |

## 7. 검증

| 대상 | 방법 |
|---|---|
| `seatState.ts` | `tests/domain/seatState.test.ts`: 상태 우선순위(BLOCKED > OFFLINE > STALE > REJECTED > ACTIVE), 임계값 경계(5분·30분 정확히), 신호 폴백(updated_at), phase 폴백(actual_pct), 캐릭터 해시 안정성, 카운터·확인 필요 목록 |
| `seatmap.ts` | `tests/domain/seatmap.test.ts`: 층·구역·책상 조립, 부모 없는 항목, 항목이 지워진 주문(`wbs_item_id` null), DONE 7일 창, watcher 층 매칭(project_id null 은 모든 층) |
| heartbeat 라우트 | `tests/agent/heartbeat-route.test.ts`: `work-routes-pat.test.ts` 와 같은 모킹. 200/400(phase 오류)/403(소유자)/409(claimed 아님)/보고 행 미생성 |
| watch 라우트 | `tests/agent/watch-route.test.ts`: upsert, 프로젝트 한정 PAT 강제, 레거시 400 |
| `agentsAccess.ts` | `tests/domain/agents-access.test.ts`(`usage-access.test.ts` 관례) |
| 마이그레이션 | `tests/migrations/migration-ledger.test.ts`(쌍) + `tests/migrations/0094.test.ts`(열 4개·테이블·정책·롤백 문구) |
| 셸 | `tests/skills/shell-syntax.test.ts`: `sh -n` 으로 `dflow.sh`·`poll.sh`·`kit/hooks/heartbeat.sh` 문법 검사, `dflow.sh` usage 에 `heartbeat`·`watch` 문자열 존재 |
| 화면 | 스테이징 URL 에서 눈으로: 4상태 이상이 보이는 프로젝트, 다크, 400px 폭, 탭 숨김 시 폴링 중단(네트워크 탭) |
| 훅 | 리허설 리포(`~/project/mes-base-rehearsal`, 스테이징 PAT)에서 `/dflow-dev` 1건을 돌리며 `last_heartbeat_at` 이 60~120초 간격으로 갱신되는지, 기본 브랜치 세션에서는 요청이 없는지 |
| 부하 | §6 |

## 8. 브랜치와 순서

메인 체크아웃(`~/project/wbs-web`, `staging`)은 다른 리포들의 스킬 심링크가 가리키므로 switch 하지 않는다. 코드는 워크트리 `.claude/worktrees/feat-agent-office`(브랜치 `feat/agent-office`, 기점 `staging`)에서 한다. 스프라이트 자산이 `staging` 에만 있어 main 기점은 쓸 수 없다.

1. 0094 작성 → 스테이징 `db:apply --target staging` 리허설(sync 생략) → 마이그레이션만 커밋 + `Staging-verified:` 트레일러.
2. S1 코드(라우트·dflow.sh·훅·poll.sh·킷) 커밋. 팀장 세션에 계약 회신.
3. 도메인(`seatState`·`seatmap`) + 테스트 커밋.
4. 데이터·액션·페이지·컴포넌트 커밋.
5. 메뉴 4곳 커밋(위험 파일). `git push -u origin feat/agent-office` → Preview 확인.
6. `staging` 에 머지·push → dflow-staging 에서 §7 화면·훅 검증 → §6 부하 실측 → 결과 기록 커밋.
7. `db:apply --target prod` → `main` 머지·push → `smoke:prod` → `mark:good`.

## 9. 정리본 정정

- §4-1 셀 64×64 → **96×96**(§4-4 시연 결과, 이번에 표를 고쳤다).
- §4-2 조립 스크립트 `build.mjs` → 실제는 Python(`scripts/sprites/*.py`)이며 산출물은 캐릭터별 `public/sprites/<char>/<동작>.png` + `manifest.json` 이다. 아틀라스 1장 방식은 쓰지 않았다.
- §5-1 훅 절제 파일 `docs/tasks/<TSK>/.hb` → `~/.dflow/hb/<order>`(§4-2).
- §5-1 "훅이 `dflow.sh heartbeat` 를 부른다" → 훅은 자체 curl(§4-2). `dflow.sh heartbeat` 는 명시 호출용.
- §5-4 STANDBY 미결 → §3-3 으로 확정.
- §3 상태표에 BLOCKED 추가(§2).

## 10. 미결(v1 뒤)

- 임계값 5분/30분/60초의 운영 조정.
- `/dflow-dev` Phase 경계 명시 호출(`feat/dflow-team` 머지 뒤).
- 팔레트 치환과 STANDBY 순찰 걷기 스프라이트.
- Buzz 게시(S3).
- Gemini 생성 이미지 사용 조건 기록(걸림돌 문서 [중간]). 내부 도구용이며 v1 에 이미 있는 자산만 쓴다.
