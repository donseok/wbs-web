# 11 — 실패 채널 · stage 직교축 · 자동 발행 (현 Supabase 스택 즉시 구현안)

작성 2026-08-05 · 설계자 A · 상태 **구현 대기(설계만, 코드·git·DB 무접촉)**
입력: `04-pm-synthesis.md` §4-1 사용자 결정 P1~P4 · 대체 대상: `01-scheduler-domain.md` §7의 MySQL DDL

---

## 0. 이 문서의 위치

`04-pm-synthesis.md` §4-1에서 **P1 경로 β**가 확정됐다 — 현 Supabase 사본 위에서 기능 먼저, 이식은 뒤로. 따라서 `01-scheduler-domain.md` §7(MySQL DDL)은 **지금 쓰지 않는다.** 그 문서의 나머지(트리거 조건 T1~T10, 사전식 우선순위, 5중 상한, 재사용/변경 표)는 DB 종류와 무관하므로 그대로 유효하고, 이 문서는 그중 **지금 당장 손댈 최소 범위**만 잘라 Postgres 형태로 구체화한다.

PM §3-2가 지목한 최대 결함부터 간다.

| 결함 | 현상 | 근거 |
|---|---|---|
| **실패 채널 부재** | `kind`가 `progress\|completion` 뿐이라 실패를 기록할 곳이 없다 | `src/lib/domain/agentWork.ts:6`, `.../report/route.ts:39`, `0057:40` |
| **release 무한 재-claim 루프** | 실패 → release → `ready` → 다시 claim → 같은 실패. 시도 횟수를 세는 곳이 리포 어디에도 없다 | `.../release/route.ts:26-30`, `scripts/agent-harness-example.mjs:56-58` |

이 둘은 같은 뿌리다 — **실패가 데이터가 아니라 무(無)로 처리된다.** 실패를 행으로 남기면 세는 것도, 멈추는 것도 가능해진다.

---

## 1. 최소 변경 설계 — 실패 채널

### 1.1 세 조각

| 조각 | 무엇 | 왜 그 자리인가 |
|---|---|---|
| `agent_run_events` (신규 테이블) | 고빈도 실행 이벤트 — stage 전이, 테스트 실패, 빌드 실패, lease 연장 | 승인 타임라인(`agent_work_reports`)을 오염시키지 않는다. 승인자는 5줄을 보지 200줄을 보지 않는다 |
| `kind='failure'` (report 확장) | **저빈도 요약** — "이 시도는 실패했다" 1행 | `fetchAgentOps`가 읽는 그 테이블(`actions/agentWork.ts:267-272`)이라야 관제 화면 타임라인에 실패가 **보인다** |
| `status='blocked'` (상태 추가) | 재시도 소진의 종착지 | `ready`로 돌리면 루프가 다시 돈다. 루프를 끊는 유일한 방법은 **큐에서 빼는 것**이다 |

**왜 events만으로 끝내지 않는가**: 실패가 `agent_run_events`에만 있으면 승인 화면의 보고 타임라인에는 아무것도 안 나타난다. 관리자 입장에서 "3번 시도했고 다 실패했다"는 사실이 **화면에 없는 채로** 주문이 조용히 blocked가 된다. 그건 실패 채널을 만든 게 아니라 실패를 다른 곳에 숨긴 것이다.

**왜 kind만으로 끝내지 않는가**: stage 전이·재시도·lease 연장은 작업 1건당 수십 건이다. 보고 테이블에 넣으면 승인 화면이 못 쓰게 된다.

### 1.2 루프를 끊는 메커니즘 — 라우트를 안 건드리는 방법

`attempt_count`를 라우트에서 올리려면 `claim/route.ts:24-31`의 CAS를 고쳐야 한다. supabase-js의 `.update()`는 `attempt_count = attempt_count + 1` 같은 컬럼 산술을 표현할 수 없어서 RPC나 별도 왕복이 필요하고, 그 순간 CAS의 원자성 논증이 흔들린다.

→ **트리거로 올린다.** `ready → claimed` 전이 시 DB가 알아서 `attempt_count`를 증가시킨다. **claim 라우트는 한 글자도 바뀌지 않는다.**

그리고 소진된 주문을 큐에서 빼는 것도 라우트를 안 건드린다:

- `GET /api/v1/agent/work`는 `.eq('status','ready')`로 필터한다(`work/route.ts:23`).
- 스위퍼가 소진된 주문을 `ready → blocked`로 옮기면 **자동으로 목록에서 사라진다.** GET 라우트 수정 0줄.
- `POST report`는 `order.status !== 'claimed'`면 409다(`report/route.ts:54-55`). blocked 주문에 오는 보고는 **이미 거부된다.** 수정 0줄.
- `POST release`는 `.eq('status','claimed')` CAS다(`release/route.ts:29`). blocked에는 안 먹는다. 수정 0줄.

즉 **`blocked` 상태 추가만으로 기존 라우트 4개가 전부 올바르게 동작한다.** 이건 우연이 아니라 기존 코드가 전 경로에서 CAS + 상태 화이트리스트로 짜여 있기 때문이다(§4).

### 1.3 실패 보고의 전이 규칙

`kind='failure'` 보고가 도착하면 서버가 `attempt_count`를 보고 스스로 갈래를 정한다:

```
failure 보고 (claimed 상태, 본인 점유)
  ├─ attempt_count <  max_attempts  → status='ready'   (재시도 여지 있음, claimed_by/claimed_at 비움)
  └─ attempt_count >= max_attempts  → status='blocked' (blocked_reason 기록, 사람만 해제)
```

- **WBS 실적은 건드리지 않는다.** `applyAgentProgress`를 호출하지 않는다 — 실패에 percent가 붙는 순간 `progress 0` 사고(PM §3-3)의 재발 경로가 생긴다.
- 기존 하네스의 실패 경로(`release`만 호출, `agent-harness-example.mjs:56-58`)는 **그대로 둬도 동작한다.** 다만 실패로 집계되지 않을 뿐이고, `attempt_count`는 트리거가 claim 시점에 이미 올려놨으므로 **release-only 하네스도 결국 상한에 걸려 멈춘다.** 이게 트리거 방식의 진짜 이득이다 — 무한루프 차단이 하네스의 선의에 의존하지 않는다.

### 1.4 마이그레이션 초안 — `0068_agent_failure_channel.sql`

> 다음 번호는 **0068**이다(현재 최신 `0067_wiki_job_lease_reclaim.sql` 실측).
> 리포 관례대로 멱등(`if not exists`)이고 `_rollback.sql`을 같이 만든다.
> **ALTER 범위 자기 점검**: 이 마이그레이션이 건드리는 테이블은 `agent_` 접두 셋뿐이다.
> 0057의 "기존 테이블 ALTER 0건"(`0057:2` 주석)은 **루프 도입 이전부터 있던 운영 테이블**에 대한 규칙이고,
> `agent_work_*`는 루프가 0057에서 스스로 만든 자기 테이블이다. D-CUBE 테이블은 여전히 0건 접촉이다.

```sql
-- 0068 — 에이전트 루프에 실패 채널과 stage 축을 넣는다.
--
-- 왜: 현행 kind 는 progress|completion 뿐이라 실패를 기록할 곳이 없고(0057:40),
-- release 는 주문을 ready 로 되돌리기만 해서(release/route.ts:26-30) 같은 실패가
-- 무한히 재시도된다. 시도 횟수를 세는 코드가 리포 어디에도 없다.
--
-- 접촉 범위: agent_work_orders · agent_work_reports · (신규) agent_run_events 뿐이다.
-- 운영 테이블(wbs_items·change_logs·projects…)은 한 줄도 건드리지 않는다.

begin;

set search_path = public, extensions;

-- ── 1. 주문: blocked 상태 + 재시도/리스/stage 컬럼 ───────────────────────────
alter table public.agent_work_orders
  add column if not exists stage            text,
  add column if not exists attempt_count    int  not null default 0,
  add column if not exists blocked_reason   text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists origin           text not null default 'manual',
  add column if not exists trigger_key      text;

-- status CHECK 교체(blocked 추가). 0057 의 인라인 컬럼 제약은 자동 명명되므로
-- 이름을 가정하지 않고 status 를 참조하는 check 제약을 찾아 지운다.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public' and rel.relname = 'agent_work_orders'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.agent_work_orders drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.agent_work_orders
  add constraint agent_work_orders_status_check
  check (status in ('ready','claimed','reported','approved','cancelled','blocked'));

alter table public.agent_work_orders
  drop constraint if exists agent_work_orders_stage_check;
alter table public.agent_work_orders
  add constraint agent_work_orders_stage_check
  check (stage is null or stage in ('dev','test','verify','debug','deploy','awaiting_approval'));

alter table public.agent_work_orders
  drop constraint if exists agent_work_orders_origin_check;
alter table public.agent_work_orders
  add constraint agent_work_orders_origin_check
  check (origin in ('manual','schedule'));

-- blocked 는 반드시 사유를 갖는다. 사유 없는 blocked 는 "왜 멈췄는지 모르는 멈춤"이다.
alter table public.agent_work_orders
  drop constraint if exists agent_work_orders_blocked_reason_check;
alter table public.agent_work_orders
  add constraint agent_work_orders_blocked_reason_check
  check (status <> 'blocked' or nullif(btrim(coalesce(blocked_reason,'')),'') is not null);

-- 자동 발행 멱등키. NULL 다중 허용 = 수동 발행은 무제한, 자동 발행은 (항목,계획일)당 1건.
create unique index if not exists agent_work_orders_trigger_key_uidx
  on public.agent_work_orders (trigger_key) where trigger_key is not null;

create index if not exists agent_work_orders_lease_idx
  on public.agent_work_orders (status, lease_expires_at);

-- ── 2. 보고: kind 에 failure 추가, percent 를 failure 에서 면제 ──────────────
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public' and rel.relname = 'agent_work_reports'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%kind%'
  loop
    execute format('alter table public.agent_work_reports drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.agent_work_reports
  add constraint agent_work_reports_kind_check
  check (kind in ('progress','completion','failure'));

-- failure 에 percent 를 강요하면 0 을 넣게 된다. 0 은 이 시스템에서 가장 비싼 값이다
-- (applyProgress.ts:34-40 이 actual_pct 를 즉시 덮어쓴다). 그래서 null 을 허용하고,
-- 대신 kind 별로 percent 유무를 CHECK 로 못박는다.
alter table public.agent_work_reports alter column percent drop not null;

alter table public.agent_work_reports
  drop constraint if exists agent_work_reports_percent_by_kind_check;
alter table public.agent_work_reports
  add constraint agent_work_reports_percent_by_kind_check
  check (
    (kind = 'progress'   and percent between 0 and  99) or
    (kind = 'completion' and percent = 100)             or
    (kind = 'failure'    and percent is null)
  );

-- failure 는 절대 WBS 에 반영되지 않는다 — 데이터 층에서도 못박는다.
alter table public.agent_work_reports
  drop constraint if exists agent_work_reports_failure_not_applied_check;
alter table public.agent_work_reports
  add constraint agent_work_reports_failure_not_applied_check
  check (kind <> 'failure' or applied_to_wbs = false);

-- ── 3. 실행 이벤트(신규) — stage 전이·실패의 원천 ──────────────────────────
create table if not exists public.agent_run_events (
  id            bigserial primary key,
  work_order_id uuid not null references public.agent_work_orders(id) on delete cascade,
  attempt       int  not null default 0,           -- 몇 번째 시도의 이벤트인가
  from_stage    text,
  to_stage      text not null,
  outcome       text not null check (outcome in ('pass','fail','skip','abort','heartbeat')),
  detail        text,                              -- 실패 로그 발췌(길이 상한은 앱이 강제)
  agent         text not null,
  actor_user_id uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  constraint agent_run_events_stage_check
    check (to_stage in ('dev','test','verify','debug','deploy','awaiting_approval'))
);
create index if not exists agent_run_events_order_idx
  on public.agent_run_events (work_order_id, created_at);

-- ── 4. 시도 횟수 자동 증가 — claim 라우트를 건드리지 않기 위한 트리거 ────────
-- CAS(claim/route.ts:24-31)는 한 글자도 바뀌지 않는다. supabase-js 의 update() 는
-- 컬럼 산술을 표현할 수 없어 라우트에서 올리려면 왕복이 하나 더 필요하고,
-- 그 순간 CAS 의 원자성 논증이 깨진다. DB 가 세는 편이 안전하다.
create or replace function public.agent_bump_attempt()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'ready' and new.status = 'claimed' then
    new.attempt_count := coalesce(old.attempt_count, 0) + 1;
    new.stage := coalesce(new.stage, 'dev');
  end if;
  return new;
end
$$;

drop trigger if exists trg_agent_bump_attempt on public.agent_work_orders;
create trigger trg_agent_bump_attempt
  before update of status on public.agent_work_orders
  for each row execute function public.agent_bump_attempt();

-- ── 5. RLS — 0057 과 동형(조회만, 쓰기는 service_role) ─────────────────────
alter table public.agent_run_events enable row level security;

drop policy if exists read_agent_run_events on public.agent_run_events;
create policy read_agent_run_events on public.agent_run_events for select to authenticated
  using (exists (
    select 1 from public.agent_work_orders o
    where o.id = public.agent_run_events.work_order_id
      and public.is_project_member(o.project_id)
  ));

revoke all on table public.agent_run_events from public, anon, authenticated;
grant select on table public.agent_run_events to authenticated;
grant all on table public.agent_run_events to service_role;
grant usage, select on sequence public.agent_run_events_id_seq to service_role;

reset search_path;

commit;
```

**롤백 `0068_agent_failure_channel_rollback.sql`** (요지):

```sql
begin;
set search_path = public, extensions;

drop trigger if exists trg_agent_bump_attempt on public.agent_work_orders;
drop function if exists public.agent_bump_attempt();
drop table if exists public.agent_run_events;

-- 되돌리기 전에 blocked 주문을 ready 로 내려야 CHECK 복원이 실패하지 않는다.
update public.agent_work_orders
   set status = 'ready', claimed_by = null, claimed_at = null
 where status = 'blocked';

alter table public.agent_work_orders drop constraint if exists agent_work_orders_status_check;
alter table public.agent_work_orders
  add constraint agent_work_orders_status_check
  check (status in ('ready','claimed','reported','approved','cancelled'));
alter table public.agent_work_orders
  drop constraint if exists agent_work_orders_stage_check,
  drop constraint if exists agent_work_orders_origin_check,
  drop constraint if exists agent_work_orders_blocked_reason_check;
drop index if exists public.agent_work_orders_trigger_key_uidx;
drop index if exists public.agent_work_orders_lease_idx;
alter table public.agent_work_orders
  drop column if exists stage,
  drop column if exists attempt_count,
  drop column if exists blocked_reason,
  drop column if exists lease_expires_at,
  drop column if exists origin,
  drop column if exists trigger_key;

-- failure 보고를 지워야 percent NOT NULL 을 복원할 수 있다(지워도 원장은 남는다).
delete from public.agent_work_reports where kind = 'failure';
alter table public.agent_work_reports
  drop constraint if exists agent_work_reports_percent_by_kind_check,
  drop constraint if exists agent_work_reports_failure_not_applied_check,
  drop constraint if exists agent_work_reports_kind_check;
alter table public.agent_work_reports alter column percent set not null;
alter table public.agent_work_reports
  add constraint agent_work_reports_kind_check check (kind in ('progress','completion'));
alter table public.agent_work_reports
  add constraint agent_work_reports_percent_check check (percent between 0 and 100);

reset search_path;
commit;
```

⚠️ **롤백은 무손실이 아니다.** failure 보고 행을 지워야 `percent NOT NULL`이 복원된다. 롤백 전에 필요하면 그 행들을 따로 덤프해야 한다. 이 비대칭을 감추지 않고 파일 주석에 남긴다.

### 1.5 앱 계층 변경 (파일별, 최소)

| 파일 | 변경 | 규모 |
|---|---|---|
| `src/lib/domain/agentWork.ts` | `AgentOrderStatus`에 `'blocked'`, `TRANSITIONS`에 `claimed→blocked`·`blocked→ready`·`blocked→cancelled`, `AgentReportKind`에 `'failure'`, `validateReport`에 failure 분기, `STAGES`·`canAdvanceStage` 순수 함수 신설 | 순수 함수만. DB·요청 컨텍스트 모름(파일 헤더 규약 유지) |
| `.../work/[id]/report/route.ts` | `kind` 화이트리스트에 `'failure'` 추가(l.39), failure 분기(WBS 미반영 + 전이 결정) | 조건 1줄 + 분기 1블록 |
| `.../work/[id]/event/route.ts` | **신규 파일** — stage 이벤트 수신 | `gateAgentApi`·`loadGatedOrder`·`parseAgentActor` 재사용. `routeShared.ts` 헤더가 "공용 로직은 lib 로"라고 이미 못박아둔 그 경로 |
| `.../agent/sweep/route.ts` | **신규 파일** — 스위퍼(§3) | 크론 인증은 위키 워커 패턴 상속 |
| `src/app/actions/agentWork.ts` | `cancelAgentOrder`의 허용 상태 배열에 `'blocked'` 추가(l.207,214), `unblockAgentOrder` 신설(관리자) | **필요 변경** — §4.3 참조 |
| `src/components/agent/AgentOpsView.tsx` | `COLS`에 `blocked` 열 추가(l.16,47-50) | **필요 변경** — 안 하면 blocked 주문이 화면에서 사라진다. §4.3 |
| `docs/design/dflow-agent-work-api-spec.md` | `kind` 열거·상태 목록·에러 코드 갱신 | 계약 문서 동기화 |

---

## 2. stage 직교축을 현 스키마에 얹는 방법

### 2.1 원칙 — 이벤트가 진실, 컬럼은 캐시

```
agent_run_events   = 진실 원천 (append-only, 시도별 전 이력)
agent_work_orders.stage = 최신 이벤트의 비정규화 캐시 (보드 렌더·필터용)
```

캐시로 두는 이유: 보드에서 stage별로 거르고 정렬하려면 컬럼이 필요한데, 컬럼만 두면 이력이 사라지고 이벤트만 두면 목록 쿼리마다 lateral join이 붙는다. 드리프트가 나면 이벤트가 이긴다 — 복구는 한 문장이다:

```sql
update public.agent_work_orders o
   set stage = e.to_stage
  from (select distinct on (work_order_id) work_order_id, to_stage
          from public.agent_run_events order by work_order_id, created_at desc) e
 where e.work_order_id = o.id and o.status = 'claimed';
```

### 2.2 stage 전이 규칙 (순수 함수)

```
dev → test → verify → debug → deploy → awaiting_approval
                 ↘_______↙   (verify 실패 → debug, debug → test 로만 되감기)
```

- 허용: 순방향 1칸 전진, `verify→debug`, `debug→test`.
- 금지: 건너뛰기(`dev→deploy`), 임의 되감기(`deploy→dev`).
- 판정은 `canAdvanceStage(from, to)` 순수 함수로 `src/lib/domain/agentWork.ts`에 둔다 — `canTransition`과 같은 자리, 같은 형태. 도메인 계층에 DB를 들이지 않는다는 그 파일의 규약(`agentWork.ts:2-3`)을 지킨다.

### 2.3 stage와 percent를 연동하지 않는다

`01` §4.3의 판단을 유지한다. **stage는 사실(테스트가 돌았다), percent는 주장(70% 했다)이다.** 연동하면 진척률이 파이프라인 구현 디테일에 종속되고, 파이프라인을 바꾸는 순간 과거 실적의 의미가 달라진다. `progress` 보고는 지금처럼 에이전트가 명시적으로 낼 때만 WBS에 반영된다.

### 2.4 `completion`의 의미 이동

`stage='awaiting_approval'`에 도달해야 `completion` 보고를 받는다. 서버가 검증한다:

```
completion 보고 수신 → order.stage 확인
  ├─ 'awaiting_approval' 또는 'deploy'  → 기존 경로대로 reported 전이
  └─ 그 외                              → 409 (아직 파이프라인이 안 끝났다)
```

이건 API 계약 §5의 "completion 전 빌드·테스트 필수"라는 **권고**를 서버가 강제하는 **계약**으로 승격시키는 것이다. 다만 파일럿(PM §6) 동안에는 이 게이트를 끄고 시작하는 것을 권고한다 — 파이프라인이 안 돌아가는 상태에서 게이트부터 켜면 파일럿 자체가 막힌다.

---

## 3. 자동 발행 스케줄러를 현 스택에서 무엇으로 돌릴 것인가

### 3.1 실측한 것

| 항목 | 실측값 | 근거 |
|---|---|---|
| 현재 크론 등록 수 | **0건** (`"crons": []`) | `vercel.json` |
| 직전 크론 | 위키 워커 1개, `17 18 * * *` = **하루 1회** | `git show 9cf7ff5^:vercel.json` |
| 크론 인증 관례 | Vercel Cron → `Authorization: Bearer <CRON_SECRET>`, 수동 → `x-cron-secret`, 미설정 시 404 은닉 | `src/app/api/wiki/worker/route.ts:27-40` |
| 리포의 기존 권고 | "cron은 **1개**만 두고 dispatch가 뿌린다 — 요금제별 개수 제한에 부딪힌다" | `docs/2026-07-27-cli-automation-agentic-recommendations.md:132-143` |
| Vercel 스코프 | 단일 스코프 `leedonseoks-projects` (개인 스코프 명명 패턴) | `vercel teams ls` 실행 결과 |
| GitHub Actions | **`.github/` 디렉터리 없음** — 쓰려면 신규 인프라 | `ls -R .github` → 출력 없음 |
| pg_cron | 마이그레이션 어디에도 사용 흔적 없음 | `grep pg_cron supabase/migrations/*.sql` → 0건 |
| 함수 시간 상한 선례 | `maxDuration = 60` 1곳뿐 | `src/app/api/v1/minutes/folder/route.ts:26` |

**확인하지 않은 것**: Vercel 요금제 **등급**. `vercel teams ls`로 스코프 이름만 확인했고 과금 정보는 조회하지 않았다. Hobby는 크론이 **하루 1회 단위**로 제한되고 개수도 적다 — 그렇다면 10분 주기 tick은 Vercel 크론으로 **불가능**하다. 대시보드에서 1분이면 확인되지만, 아래 권고안은 **등급이 무엇으로 밝혀지든 바뀌지 않는다.**

### 3.2 권고 — 러너가 tick을 친다 (크론은 안전망)

```
[운영자 PC 로컬 러너]  ── 폴링 주기마다 ──▶ POST /api/v1/agent/schedule/tick   (주 경로)
                       └─ 이어서 GET /work → claim → …

[Vercel Cron 1일 1회] ─────────────────▶ POST /api/v1/agent/sweep            (안전망)
                                          (스테일 lease 회수 + 소진분 blocked + tick 1회)
```

**왜 러너가 주 경로인가** — 결정적 근거 하나면 충분하다: **실행자가 없는데 주문을 발행해봐야 아무 일도 안 일어난다.** PM §4가 확정했듯 실행자는 운영자 PC의 로컬 러너다. 러너가 안 돌면 ready 주문은 그냥 쌓인다. 그러니 "러너가 살아 있을 때만 발행"이 낭비가 아니라 **정확히 맞는 의미론**이다. 부수 효과로 요금제 등급 리스크가 **사라진다**.

**tick이 몇 번 불려도 안전한 이유** — `trigger_key` 유니크 인덱스(§1.4)가 중복 발행을 DB에서 막는다. 러너 3대가 동시에 tick을 쳐도 두 번째·세 번째는 중복키로 스킵된다. 멱등성이 락이 아니라 제약으로 보장되므로 **호출자를 신뢰할 필요가 없다.**

**Vercel 크론(안전망)이 하는 일** — 러너가 며칠 안 돈 경우의 스테일 lease 회수와 상한 소진 주문의 blocked 전환. 하루 1회로 충분하고, 따라서 **Hobby 등급이어도 성립한다.** 등록도 리포 권고대로 크론 1개만 늘린다.

**기각한 대안**:

| 대안 | 기각 사유 |
|---|---|
| Vercel Cron 10분 주기를 주 경로로 | 등급 미확인 상태에서 아키텍처를 걸 수 없다. Hobby면 설계가 통째로 무효 |
| GitHub Actions `schedule` | `.github/`가 없다 — 신규 인프라 도입. 러너 방식으로 충분한데 CI 스케줄러를 새로 들일 이유가 없다. **다만 러너 없이도 무인 운전을 원하면 이게 1순위 대안이다** |
| Supabase `pg_cron` | 사용 선례 0건이고 확장 활성 여부 미확인. DB에서 HTTP를 쏘려면 `pg_net`도 필요 — 검증 안 된 경로를 두 개 늘린다 |
| 항상 켜진 별도 워커 프로세스 | 사내 서버 가용성이 미확인(PM §4-1 P4). 전제가 깨져 있다 |

### 3.3 tick 라우트 계약 (초안)

```
POST /api/v1/agent/schedule/tick     body: { project_id, mode?: 'dryrun'|'live' }
  인증: Authorization: Bearer <AGENT_API_SECRET>   (기존 게이트 재사용 — 새 시크릿 축을 안 만든다)
  게이트: agentApiEnabled() → 404 · 미등록 프로젝트 → 404   (externalApi.ts:34-48 그대로)
  동작:
    1. select … for update skip locked 로 프로젝트 단위 직렬화
       (0029:50 의 pg_advisory_xact_lock 도 대안. 어느 쪽이든 정합성은 trigger_key 가 잡는다)
    2. 스테일 lease 회수(0067 wiki job 회수 로직과 동형)
    3. attempt_count >= 상한인 ready 주문 → blocked
    4. T1~T10 (01 §3.1) 판정 → 자동 발행 (origin='schedule', trigger_key 세팅)
    5. 결과 카운트 반환 { candidates, published, reclaimed, blocked, skipped: {...} }
  LLM 호출: 없음. 순수 DB 연산 — 무료 티어 RPM 예산 영향 0
```

`AGENT_API_SECRET`을 재사용하는 이유: 러너가 이미 그 시크릿을 갖고 있다. 시크릿 축을 하나 더 만들면 회전 대상이 둘이 된다(스펙 §6 "시크릿 회전 = env 교체 1회" 원칙 유지). Vercel 크론이 치는 `/sweep`만 `CRON_SECRET` 축을 쓴다 — 그건 Vercel이 헤더를 정해서 보내기 때문이지 설계 선택이 아니다.

### 3.4 파일럿 단계에서는 자동 발행을 켜지 않는다

PM §6이 파일럿 1건을 다음 단계로 지정했다. 자동 발행(§3 전체)은 **파일럿 이후**다. 순서:

1. **0068 적용 + 실패 채널·blocked·stage** — 파일럿 중 실패를 기록할 곳이 있어야 완주율·시도 횟수를 실측할 수 있다. **파일럿의 계측기 자체가 이것이다.**
2. 파일럿으로 `attempt` 상한·lease 시간의 실측값 확보(현재 `01` §9-5의 30분/2회는 근거 없는 가정값).
3. 그 값을 넣고 자동 발행 tick 개방 — 드라이런 먼저(`01` §3.2).

즉 **§1·§2는 지금, §3은 파일럿 뒤**다.

---

## 4. 기존 5상태·CAS·라우트를 깨지 않는다는 입증

### 4.1 상태 소비처 전수 — 코드 근거

| 소비처 | 코드 | `blocked` 추가 시 |
|---|---|---|
| 전이표 | `agentWork.ts:14-20` `TRANSITIONS: Record<AgentOrderStatus, …>` | **타입이 강제한다.** 유니온에 멤버를 넣으면 키 누락이 컴파일 에러가 된다. 조용한 누락 불가 |
| ready 목록 | `work/route.ts:23` `.eq('status','ready')` | 무변경. blocked는 자동 제외 |
| claim CAS | `claim/route.ts:30` `.eq('id',id).eq('status','ready')` | 무변경. blocked는 매칭 안 됨 |
| 보고 게이트 | `report/route.ts:54-55` `order.status !== 'claimed'` → 409 | 무변경. blocked 보고는 자동 409 |
| completion CAS | `report/route.ts:94` `.eq('status','claimed').eq('claimed_by',…)` | 무변경 |
| release CAS | `release/route.ts:29` `.eq('status','claimed').eq('claimed_by',…)` | 무변경 |
| 상태 폴링 | `work/[id]/route.ts:19,57` — status를 **불투명 문자열로 통과**시킨다(화이트리스트 없음) | 무변경. 하네스가 blocked를 그대로 읽는다 |
| 승인 | `actions/agentWork.ts:108` `status !== 'reported'` | 무변경 |
| 반려 | `actions/agentWork.ts:161` `status !== 'reported'` | 무변경 |
| 회수 | `actions/agentWork.ts:191` `status !== 'claimed'` | 무변경 |
| 보드 데이터 | `actions/agentWork.ts:246-251` — status **필터 없음**, 전건 조회 | 무변경. blocked 행이 뷰까지 도달한다 |
| DB 제약 | `0057:24-25` status CHECK | 0068이 교체(§1.4) |

**13개 소비처 중 12개가 무변경**이다. 이유는 설계 덕이 아니라 **기존 코드가 전 경로에서 "허용 상태 화이트리스트 + CAS"로 짜여 있기 때문**이다. 새 상태는 어떤 화이트리스트에도 안 걸리므로 기본적으로 아무 동작도 허용되지 않는다 — fail-closed가 상태 확장에도 그대로 작동한다.

### 4.2 기존 테스트가 깨지지 않는 이유 — 파일을 열어 확인함

**`tests/domain/agent-work.test.ts`** — 전 케이스가 **개별 (from,to) 쌍**에 대한 단언이다:
- 허용 8건: `ready→claimed`, `ready→cancelled`, `claimed→ready`, `claimed→reported`, `claimed→cancelled`, `reported→claimed`, `reported→approved`, `reported→cancelled`
- 금지 5건: `approved→ready`, `cancelled→claimed`, `ready→reported`, `ready→approved`, `claimed→approved`

`blocked`를 추가해도 **이 13개 쌍의 진리값은 하나도 바뀌지 않는다.** 전이표 전체를 스냅샷으로 비교하는 단언은 없다(파일 전문 확인).

`validateReport` 단언 4건도 `progress`/`completion` 인자에 대한 것이라 `failure` 분기 추가에 영향받지 않는다.

**`tests/migrations/agent-work-loop.test.ts`** — 이 파일은 **0057 파일의 텍스트를 읽어** 단언한다(`readFileSync(…0057_agent_work_loop.sql)`). 단언 내용:
- `create table if not exists` 개수 === 3
- `wbs_item_id … on delete set null` 존재
- status CHECK에 `'rejected'` 없음
- `percent int not null check (percent between 0 and 100)` 문자열 존재
- `for select to authenticated` 3건 / insert·update·delete 정책 0건
- revoke·grant 3세트

**0068은 별도 파일이므로 0057의 텍스트가 한 글자도 안 바뀐다 → 이 단언들은 전부 그대로 초록이다.**

⚠️ 단 **이 테스트는 이제 실물 스키마를 대변하지 않게 된다.** "percent는 NOT NULL"이라고 단언하는 텍스트는 남는데 실제 컬럼은 nullable이 된다. 텍스트 검사의 구조적 한계다. → **0068용 테스트를 같이 쓰고, 0057 테스트 파일 주석에 "0068이 이 제약을 넓혔다"는 포인터를 남긴다.** 이걸 안 하면 다음 사람이 0057 테스트만 보고 스키마를 오해한다.

**라우트 테스트 3종**(`tests/agent/work-routes.test.ts`·`claim-routes.test.ts`·`report-route.test.ts`) — 게이트 404·미등록 404·400 검증·CAS 경합·본인 점유 검증을 본다. 전부 기존 상태·기존 kind 경로라 무변경. (테스트명 목록으로 확인, 본문 전문은 `work-routes.test.ts`만 확인)

### 4.3 정직하게 — **무변경이 아닌 곳 2개**

"깨지지 않는다"를 "손댈 데가 없다"로 쓰면 거짓이 된다. 두 곳은 **반드시 고쳐야** 한다:

1. **`src/components/agent/AgentOpsView.tsx:16,47-50`**
   ```ts
   const COLS = ['ready', 'claimed', 'reported', 'done'] as const
   done: orders.filter(o => o.status === 'approved' || o.status === 'cancelled')
   ```
   `blocked`는 **어느 열에도 안 들어간다.** 데이터는 뷰까지 오는데(`fetchAgentOps`는 필터가 없다) **화면에서 사라진다.** 실패를 기록해놓고 화면에서 감추는 건 이 작업의 목적과 정반대다. → `blocked` 열 추가 + 사유·시도 횟수 표시 + 해제 버튼이 **필수 동반 변경**이다.
   ⚠️ 이 파일은 `src/components/app/*`가 아니므로 CLAUDE.md의 UI 위험 파일 목록에는 없다. 그래도 화면이므로 배포 후 눈으로 확인한다.

2. **`src/app/actions/agentWork.ts:207,214`**
   ```ts
   if (!['ready','claimed','reported'].includes(loaded.order.status)) …
   .in('status', ['ready','claimed','reported'])
   ```
   `blocked` 주문을 **취소할 수 없다.** 막다른 골목에 갇힌 주문이 영구히 남는다. → 배열에 `'blocked'` 추가 + `unblockAgentOrder`(관리자, `blocked→ready`, `attempt_count` 리셋 여부 선택) 신설.

### 4.4 D-CUBE 무영향 재확인

- 0068이 건드리는 테이블은 `agent_work_orders`·`agent_work_reports`·(신규)`agent_run_events` **셋뿐**이다. 운영 테이블 ALTER 0건.
- D-CUBE는 `agent_projects`에 미등록이므로 전 엔드포인트가 404다(`externalApi.ts:43-48`). 스위퍼·tick도 같은 게이트를 통과한 프로젝트만 본다.
- `failure` 보고는 `applyAgentProgress`를 **호출하지 않고**, DB CHECK가 `applied_to_wbs=false`를 강제한다 — WBS 실적 경로에 새 진입점이 생기지 않는다.
- 적용은 Management API 경유(`db push` 금지, CLAUDE.md). 적용 전 드라이런으로 blocked 행 0건·failure 행 0건을 확인한다(신규 값이므로 당연히 0이어야 하고, 아니면 뭔가 잘못된 것이다).

---

## 5. 결정이 필요한 사항 (권고 포함)

| # | 질문 | **권고** | 근거 |
|---|---|---|---|
| 1 | `kind='failure'`를 쓰나, events만으로 끝내나 | **둘 다.** failure는 시도당 1행(요약), events는 고빈도 | events만이면 승인 화면에 실패가 안 보인다(§1.1) |
| 2 | `percent`를 nullable로 넓히나 | **넓힌다** | failure에 percent를 강요하면 0을 넣게 되고, 0은 이 시스템에서 가장 비싼 값이다. 대신 kind별 CHECK로 조인다(§1.4) |
| 3 | `attempt_count`를 트리거로 올리나, 라우트에서 올리나 | **트리거** | claim CAS를 한 글자도 안 건드린다. 게다가 구형 release-only 하네스도 자동으로 상한에 걸린다(§1.2) |
| 4 | 자동 발행 스케줄러 런타임 | **러너가 tick + Vercel 크론 1일 1회 안전망** | 실행자가 없으면 발행이 무의미하고, 요금제 등급 리스크가 사라진다(§3.2) |
| 5 | `completion` 전 stage 게이트를 언제 켜나 | **파일럿 이후** | 파이프라인이 없는 상태에서 게이트부터 켜면 파일럿이 막힌다(§2.4) |
| 6 | `max_attempts` 기본값 | **2 — 단 파일럿 실측 전까지는 가정값이라고 명시** | PM §6이 지적한 그 가정값이다. 이 설계의 계측기(0068)가 그걸 실측값으로 바꾼다 |
| 7 | 자동화 설정을 어디 두나 | **`project_settings`** (PM §8 종결대로 C 방침) | 게이트 1행 조회 이점은 포기하고 조인 1회 감수 |

---

## 6. 리스크

| # | 리스크 | 완화 |
|---|---|---|
| R1 | **blocked가 화면에서 사라진다** | §4.3-1이 필수 동반 변경. 이걸 빠뜨리면 이 작업은 실패를 기록만 하고 감추는 결과가 된다 |
| R2 | **blocked 적체** — 무료·구독 CLI의 실패율이 높으면 blocked만 쌓이고 사람 부하가 늘어난다 | 성공률을 events에서 상시 집계·노출. 임계 미만이면 자동 발행을 스스로 끄는 서킷 브레이커는 후속 |
| R3 | **롤백 비대칭** — failure 행을 지워야 되돌릴 수 있다 | 롤백 파일 주석 + 덤프 선행 절차 명문화(§1.4) |
| R4 | **0057 테스트가 스키마를 오도한다** — "percent NOT NULL"을 단언하는 텍스트가 남는다 | 0068 전용 테스트 신설 + 0057 테스트에 포인터 주석(§4.2) |
| R5 | **트리거가 조용히 동작한다** — `attempt_count` 증가가 코드에 안 보여 다음 사람이 놓친다 | 마이그레이션 주석 + `agentWork.ts` 도메인 주석 양쪽에 명시. 트리거 존재를 검사하는 테스트 1건 |
| R6 | **stage 캐시 드리프트** | 이벤트가 진실. 복구 UPDATE 한 문장(§2.1) |
| R7 | **Vercel 요금제 등급 미확인** | 권고안이 등급에 의존하지 않게 설계했다(§3.2). 그래도 크론 1개 등록 전에 대시보드 확인 |
| R8 | **lease 회수 중복 실행** — 살아 있는 에이전트를 회수하면 두 에이전트가 같은 작업을 한다 | 회수 후 옛 에이전트의 보고는 `claimed_by` 불일치로 403(`report/route.ts:57-59`) — **이미 코드에 있는 방어**다. 0067이 wiki job에서 같은 논증으로 회수를 도입했다(`0067:15-18`) |

---

## 7. 모르는 것 / 확인하지 못한 것

1. **Vercel 요금제 등급** — 스코프 이름만 확인했고 과금 정보는 조회하지 않았다. §3.2 권고는 등급과 무관하게 성립하도록 짰다.
2. **`task_dependencies` 실제 등록 건수** — 여전히 미확인(운영 DB 무접촉). 자동 발행 T6과 우선순위 2~5의 실효성이 여기 달려 있다(PM §7에도 1순위로 올라 있다).
3. **0057 CHECK 제약의 실제 이름** — 인라인 컬럼 제약이라 `agent_work_orders_status_check`로 자동 명명됐을 것이나 **프로덕션에서 확인하지 않았다.** 그래서 §1.4를 이름 가정 없는 DO 블록으로 썼다.
4. **`agent_work_reports`에 이미 쌓인 행 수** — 0 이상이면 `percent` nullable 전환은 무해하지만, CHECK 추가는 기존 행 전수 검사를 유발한다. 행이 많으면 잠금 시간이 는다. 확인하지 않았다.
5. **`tests/agent/claim-routes.test.ts`·`report-route.test.ts` 본문** — 테스트 이름 목록만 확인했고 전문은 읽지 않았다. `work-routes.test.ts`와 `tests/domain/agent-work.test.ts`, `tests/migrations/agent-work-loop.test.ts`는 전문 확인.
6. **`recordProgressSnapshot` 내부** — 여전히 미확인(`report/route.ts:71`에서 `after()`로 호출된다는 것만). failure 경로는 이 함수를 부르지 않으므로 이 작업 범위에서는 영향 없다.
7. **`pg_cron`/`pg_net` 확장 활성 여부** — 확인하지 않았다. §3.2에서 기각했으므로 결정에 영향 없다.
8. **위키** — 제외.
