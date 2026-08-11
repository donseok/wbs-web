# 알림함(Notification Inbox) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 개인(수신자 행)·전체(기존 공지 재사용) 이원 저장 + 통합 수신(한 벨·배지 합산)의 알림함을 구축하고, 이슈 담당 지정 2곳에 첫 발행 훅을 넣는다.

**Architecture:** `notification_events` + `notification_recipients` 2테이블(0074, RLS 쓰기 정책 0 — service_role 발행)에 `emitNotification` 헬퍼(fire-and-forget+로깅)로 쓴다. 벨은 개인 unseen + 공지 안읽음(기존 `announcement_seen`)을 합산하고 피드를 구획 렌더한다. Realtime(0075, `realtime.send` private 채널)은 향상 계층 — 실패해도 폴링으로 동작.

**Tech Stack:** Next.js 15 App Router 서버 액션 · Supabase(Postgres 17, service_role) · vitest(마이그레이션은 SQL 텍스트 검사) · Vercel Cron

**정본 스펙:** `docs/superpowers/specs/2026-08-11-notification-inbox-design.md` · 작업 루프 발행 지점은 `docs/superpowers/specs/2026-08-10-claude-code-work-integration-review-appendix.md` §2.10 (이 계획 범위 밖 — 연동 Task가 emit 직접 포함)

## Global Constraints

- 로컬 dev도 **운영 Supabase를 공유**한다 — 마이그레이션 적용은 Supabase Management API(`supabase db push` 금지), 실 DB를 건드리는 테스트 금지(마이그레이션 테스트는 SQL 텍스트 검사 관례).
- 마이그레이션과 코드는 **다른 커밋**(pre-push G1). 마이그레이션마다 `_rollback.sql` 동반.
- `git add -A` 금지 — 파일명 명시 stage. 커밋 메시지 한국어, "왜" 중심.
- `src/components/app/*` 변경(Task 6·8)은 **브랜치 경유**(pre-push G2): `git switch -c ui/<주제>` → `git push -u origin HEAD` → main 머지. Preview는 Supabase env가 없어 로그인 뒤 화면 검증 불가 — G2는 속도 방지턱임을 알고 통과할 것.
- 마이그레이션 번호는 **0074·0075** (0069·0071·0072·0073은 연동 설계가 예약 — 사용 금지).
- RLS 관례(0051/0057): `enable row level security` → select 정책만(쓰기 정책 0 = 쓰기 차단) → `revoke all ... from public, anon, authenticated` → `grant select ... to authenticated` + `grant all ... to service_role`.
- 에러 3원칙: 조회 실패를 "데이터 없음"으로 위장하지 않는다(표시=로깅) · 쓰기 전 선행 조회 실패 시 중단 · fail-closed.
- 알림 발행은 fire-and-forget — **본 동작을 실패시키지 않되 실패는 반드시 `console.error` 로깅**.
- i18n: `src/lib/i18n/dict/` ko/en 키 패리티가 타입으로 강제됨 — 새 키는 양쪽에.
- `createAdminClient()`(service_role) 사용 전 반드시 세션·권한 가드(`getSession`/`requireProject*`) 선행.
- 상태 변형 display 유틸(`group-hover:flex` 등)·컨테이너쿼리+반응형 display 혼용 금지(CSS 안전망).

## 파일 구조

| 파일 | 책임 |
|---|---|
| `supabase/migrations/0074_notification_inbox.sql` (+`_rollback`) | 2테이블·인덱스·RLS·purge 함수 |
| `supabase/migrations/0075_notification_realtime.sql` (+`_rollback`) | broadcast 트리거·`realtime.messages` 정책 |
| `src/lib/domain/inbox.ts` | 순수: 카탈로그·타입·설정 판정·수신자 정규화 (I/O 없음) |
| `src/lib/notify/emit.ts` | 발행: service_role insert·수신자 해석·dedupe·fire-and-forget |
| `src/app/actions/inbox.ts` | 조회·seen/read·설정 서버 액션 |
| `src/app/actions/issues.ts` (수정) | 발행 훅 2곳 |
| `src/components/app/InboxPanel.tsx` | 벨 패널 (구획 렌더) — **G2 대상 디렉터리** |
| `src/components/app/HeaderChrome.tsx` (수정) | 데이터 소스 교체·배지 합산 — **G2** |
| `src/lib/i18n/dict/inbox.ts` | 알림함 i18n 네임스페이스 |
| `src/app/api/cron/inbox-retention/route.ts` | retention (Vercel Cron) |
| `src/lib/hooks/useInboxRealtime.ts` | private 채널 구독 훅 |

---

### Task 1: 0074 마이그레이션 — 저장 계층

**Files:**
- Create: `supabase/migrations/0074_notification_inbox.sql`
- Create: `supabase/migrations/0074_notification_inbox_rollback.sql`
- Test: `tests/migrations/notification-inbox.test.ts`

**Interfaces:**
- Produces: `notification_events`·`notification_recipients` 테이블, `purge_read_notifications(retention_days int)` 함수. 이후 전 Task가 이 스키마를 전제.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/migrations/notification-inbox.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const dir = 'supabase/migrations/'
const migration = readFileSync(`${dir}0074_notification_inbox.sql`, 'utf8')
const rollback = readFileSync(`${dir}0074_notification_inbox_rollback.sql`, 'utf8')

describe('0074 notification inbox', () => {
  it('테이블 2개를 멱등 생성한다', () => {
    expect((migration.match(/create table if not exists public\.notification_/g) ?? []).length).toBe(2)
  })
  it('recipients는 수신자 축 CHECK — member_id 또는 user_id', () => {
    expect(migration).toMatch(/check \(member_id is not null or user_id is not null\)/)
  })
  it('이벤트 dedupe·수신자 멱등 부분 유니크가 있다', () => {
    expect(migration).toMatch(/unique index if not exists notification_events_dedupe/)
    expect(migration).toMatch(/unique index if not exists notification_recipients_by_member/)
    expect(migration).toMatch(/unique index if not exists notification_recipients_by_user/)
  })
  it('배지 인덱스는 unseen 기준 부분 인덱스다', () => {
    expect(migration).toMatch(/where seen_at is null/)
  })
  it('쓰기 정책은 만들지 않는다 — select 정책 2개만', () => {
    expect(migration).not.toMatch(/for\s+(insert|update|delete)\s+to\s+authenticated/i)
    expect((migration.match(/for select to authenticated/gi) ?? []).length).toBe(2)
  })
  it('revoke/grant 잠금 세트가 테이블마다 있다', () => {
    expect((migration.match(/revoke all on table public\.notification_/g) ?? []).length).toBe(2)
    expect((migration.match(/grant all on table public\.notification_\w+ to service_role/g) ?? []).length).toBe(2)
  })
  it('purge 함수는 authenticated 실행 불가', () => {
    expect(migration).toMatch(/create or replace function public\.purge_read_notifications/)
    expect(migration).toMatch(/revoke execute on function public\.purge_read_notifications\(int\) from public, anon, authenticated/)
  })
  it('트랜잭션으로 감싼다', () => {
    expect(migration.trim()).toMatch(/^--/)
    expect(migration).toMatch(/\nbegin;/)
    expect(migration).toMatch(/\ncommit;/)
  })
  it('롤백은 자식→부모 순서로 지운다', () => {
    const ri = rollback.indexOf('notification_recipients')
    const ei = rollback.indexOf('notification_events')
    expect(ri).toBeGreaterThan(-1)
    expect(ri).toBeLessThan(ei)
    expect(rollback).toMatch(/drop function if exists public\.purge_read_notifications/)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/migrations/notification-inbox.test.ts`
Expected: FAIL — `ENOENT ... 0074_notification_inbox.sql`

- [ ] **Step 3: 마이그레이션 작성**

```sql
-- 알림함(inbox) 저장 계층 — 개인 알림 이벤트/수신자.
--
-- 핵심 계약 (스펙: docs/superpowers/specs/2026-08-11-notification-inbox-design.md)
--   1) 쓰기는 service_role 전용이다. INSERT/UPDATE/DELETE 정책을 만들지 않는 것이 곧 쓰기 차단이다.
--      발행(emit)·읽음 처리 전부 서버 액션 가드가 유일한 관문이다(0051/0057 관례).
--   2) 전체 알림(공지)은 여기 저장하지 않는다 — 기존 announcements + announcement_seen(0012)이
--      이미 그 구조라 재사용한다. audience 'project'/'global' 값은 훗날을 위한 예약이다.
--   3) 수신자 키는 이원 — 프로젝트 사건은 member_id(로스터 축, 0019 user_id nullable 함정 회피),
--      프로젝트 밖 사건(system.* 계열)만 user_id 직접. CHECK 로 최소 한 축을 강제한다.
--   4) 배지는 unseen(seen_at is null) 카운트다 — 카운터 컬럼을 두지 않는다(드리프트 원천).
--   5) retention: 읽은 지 90일 지난 수신자 행과 고아 이벤트만 purge — 안읽음은 보존한다.
--
-- 멱등: 반복 실행 안전. 적용: Supabase Management API POST /v1/projects/<ref>/database/query.
-- 적용 순서: 이 마이그레이션 먼저, 발행·화면 코드는 다음 배포(0027 PGRST 교훈).
-- 롤백: 0074_notification_inbox_rollback.sql (수신 이력이 전부 소실된다).

begin;

set search_path = public, extensions;

create table if not exists public.notification_events (
  id            uuid primary key default gen_random_uuid(),
  type          text not null,
  category      text not null check (category in ('work','issue','meeting','announce','system')),
  audience      text not null default 'direct' check (audience in ('direct','project','global')),
  project_id    uuid null references public.projects(id) on delete cascade,
  actor_user_id uuid null,
  entity_type   text null,
  entity_id     uuid null,
  payload       jsonb not null default '{}'::jsonb,
  dedupe_key    text null,
  created_at    timestamptz not null default now()
);

create unique index if not exists notification_events_dedupe
  on public.notification_events (dedupe_key) where dedupe_key is not null;
create index if not exists notification_events_project
  on public.notification_events (project_id, created_at desc);

create table if not exists public.notification_recipients (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.notification_events(id) on delete cascade,
  -- 프로젝트 사건의 수신자 키. on delete cascade — 로스터에서 빠진 사람의 알림은 의미를 잃는다.
  member_id   uuid null references public.project_members(id) on delete cascade,
  -- 발행 시점의 계정 링크 스냅샷(realtime 채널 키) 겸 프로젝트 밖 사건의 수신자 키.
  user_id     uuid null references auth.users(id) on delete cascade,
  seen_at     timestamptz null,
  read_at     timestamptz null,
  archived_at timestamptz null,
  created_at  timestamptz not null default now(),
  constraint notification_recipients_identity check (member_id is not null or user_id is not null)
);

-- 같은 이벤트 중복 수신 불가 — 수신자 축별 부분 유니크.
create unique index if not exists notification_recipients_by_member
  on public.notification_recipients (event_id, member_id) where member_id is not null;
create unique index if not exists notification_recipients_by_user
  on public.notification_recipients (event_id, user_id) where member_id is null;
-- 배지(unseen) 카운트 전용.
create index if not exists notification_recipients_badge
  on public.notification_recipients (user_id) where seen_at is null;
-- 피드 조회.
create index if not exists notification_recipients_feed
  on public.notification_recipients (user_id, created_at desc);

-- ── RLS ──
alter table public.notification_events enable row level security;
alter table public.notification_recipients enable row level security;

drop policy if exists read_notification_recipients on public.notification_recipients;
create policy read_notification_recipients on public.notification_recipients
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists read_notification_events on public.notification_events;
create policy read_notification_events on public.notification_events
  for select to authenticated
  using (
    exists (
      select 1 from public.notification_recipients r
      where r.event_id = notification_events.id and r.user_id = auth.uid()
    )
    or (audience = 'project' and public.is_project_member(project_id))
    or audience = 'global'
  );
-- INSERT/UPDATE/DELETE 정책 없음 = 쓰기는 service_role 만.

revoke all on table public.notification_events from public, anon, authenticated;
grant select on table public.notification_events to authenticated;
grant all on table public.notification_events to service_role;

revoke all on table public.notification_recipients from public, anon, authenticated;
grant select on table public.notification_recipients to authenticated;
grant all on table public.notification_recipients to service_role;

-- ── retention: 읽은 지 retention_days 지난 수신자 행 + 수신자가 0이 된 direct 이벤트 purge ──
create or replace function public.purge_read_notifications(retention_days int default 90)
returns table (recipients_deleted bigint, events_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  rc bigint; ec bigint;
begin
  delete from public.notification_recipients
    where read_at is not null and read_at < now() - make_interval(days => retention_days);
  get diagnostics rc = row_count;
  delete from public.notification_events e
    where e.audience = 'direct'
      and e.created_at < now() - make_interval(days => retention_days)
      and not exists (select 1 from public.notification_recipients r where r.event_id = e.id);
  get diagnostics ec = row_count;
  return query select rc, ec;
end;
$$;

revoke execute on function public.purge_read_notifications(int) from public, anon, authenticated;
grant execute on function public.purge_read_notifications(int) to service_role;

reset search_path;

commit;
```

- [ ] **Step 4: 롤백 작성**

```sql
-- 0074 롤백 — 알림함 신규 객체만 제거한다. 기존 테이블은 0074 가 건드리지 않았으므로 복원 대상 없음.
-- ⚠️ 수신 이력(안읽음 포함)이 전부 소실된다.

begin;

set search_path = public, extensions;

drop function if exists public.purge_read_notifications(int);
drop table if exists public.notification_recipients;
drop table if exists public.notification_events;

reset search_path;

commit;
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/migrations/notification-inbox.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 6: 커밋 — 마이그레이션 + 테스트만 (G1: 앱 코드 금지)**

```bash
git add supabase/migrations/0074_notification_inbox.sql supabase/migrations/0074_notification_inbox_rollback.sql tests/migrations/notification-inbox.test.ts
git commit -m "feat(migration): 알림함 저장 계층(0074) — 개인 알림 이벤트/수신자, 쓰기는 service_role 전용"
```

- [ ] **Step 7: Management API로 적용** — `POST /v1/projects/rglfgrwwwwdqejohdnty/database/query`에 0074 본문 실행(기존 마이그레이션 적용 절차와 동일). 적용 후 `select count(*) from notification_events;`가 0을 반환하는지 확인.

---

### Task 2: 도메인 카탈로그 — 순수 로직

**Files:**
- Create: `src/lib/domain/inbox.ts`
- Test: `tests/domain/inbox.test.ts`

**Interfaces:**
- Produces: `NOTIFICATION_CATALOG`, `type NotificationType`, `categoryOf(type)`, `isTypeEnabled(prefs, type)`, `normalizeRecipientUserIds(userIds, actorUserId)` — Task 3·5·6이 소비.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/domain/inbox.test.ts
import { describe, it, expect } from 'vitest'
import {
  NOTIFICATION_CATALOG, categoryOf, isTypeEnabled, normalizeRecipientUserIds,
} from '@/lib/domain/inbox'

describe('notification catalog', () => {
  it('전 타입이 5개 카테고리 안에 있다', () => {
    const cats = new Set(Object.values(NOTIFICATION_CATALOG).map(c => c.category))
    for (const c of cats) expect(['work', 'issue', 'meeting', 'announce', 'system']).toContain(c)
  })
  it('REQUIRED 는 승인 요청류 둘뿐이다', () => {
    const required = Object.entries(NOTIFICATION_CATALOG).filter(([, c]) => c.required).map(([t]) => t)
    expect(required.sort()).toEqual(['work.rejected', 'work.reported'])
  })
  it('categoryOf — issue.assigned 는 issue', () => {
    expect(categoryOf('issue.assigned')).toBe('issue')
  })
})

describe('isTypeEnabled — 조회 시점 필터', () => {
  it('prefs 없으면 카탈로그 기본값', () => {
    expect(isTypeEnabled(undefined, 'issue.assigned')).toBe(true)
    expect(isTypeEnabled(undefined, 'work.progress')).toBe(false)
  })
  it('prefs 가 기본값을 뒤집는다', () => {
    expect(isTypeEnabled({ 'issue.assigned': false }, 'issue.assigned')).toBe(false)
    expect(isTypeEnabled({ 'work.progress': true }, 'work.progress')).toBe(true)
  })
  it('REQUIRED 는 끌 수 없다', () => {
    expect(isTypeEnabled({ 'work.reported': false }, 'work.reported')).toBe(true)
  })
})

describe('normalizeRecipientUserIds', () => {
  it('중복·null 제거, 행위자 제외', () => {
    expect(normalizeRecipientUserIds(['u1', 'u1', null, 'u2', 'u3'], 'u2')).toEqual(['u1', 'u3'])
  })
  it('행위자 없으면 전원 유지', () => {
    expect(normalizeRecipientUserIds(['u1', 'u2'], null)).toEqual(['u1', 'u2'])
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/domain/inbox.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/inbox'`

- [ ] **Step 3: 구현**

```ts
// src/lib/domain/inbox.ts — 알림함 순수 도메인. I/O 없음.
// 카탈로그 정본: docs/superpowers/specs/2026-08-11-notification-inbox-design.md
// noise 가 알림함의 최대 실패 요인 — 기본값은 보수적으로, REQUIRED 는 승인 요청류만.

export type NotificationCategory = 'work' | 'issue' | 'meeting' | 'announce' | 'system'

export const NOTIFICATION_CATALOG = {
  // A. 작업 루프 — 발행 지점은 연동 부록 §2.10 (연동 배포 후 활성화)
  'work.assigned':       { category: 'work',   defaultOn: true,  required: false },
  'work.order_created':  { category: 'work',   defaultOn: true,  required: false },
  'work.claimed':        { category: 'work',   defaultOn: true,  required: false },
  'work.progress':       { category: 'work',   defaultOn: false, required: false },
  'work.reported':       { category: 'work',   defaultOn: true,  required: true },
  'work.approved':       { category: 'work',   defaultOn: true,  required: false },
  'work.rejected':       { category: 'work',   defaultOn: true,  required: true },
  'work.released':       { category: 'work',   defaultOn: true,  required: false },
  'work.revoked':        { category: 'work',   defaultOn: true,  required: false },
  'work.unblocked':      { category: 'work',   defaultOn: true,  required: false },
  'work.human_gate':     { category: 'work',   defaultOn: true,  required: false },
  // B. 협업 — issue.assigned 가 v1 첫 발행 지점(Task 5)
  'issue.assigned':      { category: 'issue',  defaultOn: true,  required: false },
  'issue.status':        { category: 'issue',  defaultOn: true,  required: false },
  'member.invited':      { category: 'system', defaultOn: true,  required: false },
  // C. 시스템
  'system.pat_expiring': { category: 'system', defaultOn: true,  required: false },
  'system.import_result':{ category: 'system', defaultOn: true,  required: false },
  'system.runner_stale': { category: 'system', defaultOn: false, required: false },
} as const satisfies Record<string, { category: NotificationCategory; defaultOn: boolean; required: boolean }>

export type NotificationType = keyof typeof NOTIFICATION_CATALOG

export function categoryOf(type: NotificationType): NotificationCategory {
  return NOTIFICATION_CATALOG[type].category
}

/** 조회 시점 필터 — 발행 시 수신자별 prefs 조회를 피하고, 토글이 소급 적용되게 한다. */
export function isTypeEnabled(prefs: Record<string, boolean> | undefined, type: NotificationType): boolean {
  const entry = NOTIFICATION_CATALOG[type]
  if (entry.required) return true
  return prefs?.[type] ?? entry.defaultOn
}

/** 중복·null 제거 + 행위자 제외 — 자기 행위는 자기에게 알리지 않는다. */
export function normalizeRecipientUserIds(
  userIds: ReadonlyArray<string | null | undefined>, actorUserId: string | null | undefined,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of userIds) {
    if (!id || id === actorUserId || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/domain/inbox.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/inbox.ts tests/domain/inbox.test.ts
git commit -m "feat(inbox): 알림 카탈로그·설정 판정 순수 도메인 — 기본값 보수, REQUIRED 는 승인 요청류만"
```

---

### Task 3: emitNotification — 발행 헬퍼

**Files:**
- Create: `src/lib/notify/emit.ts`
- Test: `tests/lib/notify-emit.test.ts`

**Interfaces:**
- Consumes: `NOTIFICATION_CATALOG`, `normalizeRecipientUserIds` (Task 2), `createAdminClient` (`src/lib/supabase/admin.ts`)
- Produces: `emitNotification(input: EmitInput): Promise<EmitResult>` — Task 5와 연동 서버 Task들이 소비.
  ```ts
  type EmitInput = {
    type: NotificationType
    projectId: string | null
    actorUserId?: string | null
    entityType?: string; entityId?: string
    payload: { title: string; detail?: string; href?: string }
    recipientMemberIds?: string[]   // 프로젝트 사건 — 로스터 축
    recipientUserIds?: string[]     // 프로젝트 밖 사건(system.*)
    dedupeKey?: string
  }
  type EmitResult = { ok: boolean; deduped?: boolean; recipients?: number }
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/lib/notify-emit.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { emitNotification } from '@/lib/notify/emit'

type Resp = { data?: unknown; error?: { code?: string; message: string } | null }

/** 테이블별 응답 큐 mock — tests/actions/agent-work-actions.test.ts 관례 축소판 */
function admin(queues: Record<string, Resp[]>) {
  const inserted: Record<string, unknown[]> = {}
  const client = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'order', 'limit']) b[k] = () => b
      b.insert = (rows: unknown) => { (inserted[table] ??= []).push(rows); return b }
      b.single = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.maybeSingle = b.single
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  }
  mocks.createAdminClient.mockReturnValue(client)
  return { client, inserted }
}

beforeEach(() => vi.clearAllMocks())

describe('emitNotification', () => {
  it('member 수신자를 user_id 스냅샷으로 해석해 이벤트+수신자 행을 쓴다', async () => {
    const { inserted } = admin({
      project_members: [{ data: [{ id: 'm1', user_id: 'u1' }, { id: 'm2', user_id: null }] }],
      notification_events: [{ data: { id: 'ev1' } }],
      notification_recipients: [{ data: null }],
    })
    const r = await emitNotification({
      type: 'issue.assigned', projectId: 'p1', actorUserId: 'actor',
      payload: { title: 'T' }, recipientMemberIds: ['m1', 'm2'],
    })
    expect(r.ok).toBe(true)
    expect(r.recipients).toBe(2) // 계정 미링크(m2)도 행은 남는다 — 링크 후 대비는 아니고 감사 목적
    const rows = inserted.notification_recipients[0] as { member_id: string | null; user_id: string | null }[]
    expect(rows).toEqual([
      { event_id: 'ev1', member_id: 'm1', user_id: 'u1' },
      { event_id: 'ev1', member_id: 'm2', user_id: null },
    ])
  })
  it('행위자 본인이 유일 수신자면 발행하지 않는다 (no-op)', async () => {
    admin({ project_members: [{ data: [{ id: 'm1', user_id: 'actor' }] }] })
    const r = await emitNotification({
      type: 'issue.assigned', projectId: 'p1', actorUserId: 'actor',
      payload: { title: 'T' }, recipientMemberIds: ['m1'],
    })
    expect(r).toEqual({ ok: true, recipients: 0 })
  })
  it('dedupe_key 충돌(23505)은 성공으로 삼킨다', async () => {
    admin({
      project_members: [{ data: [{ id: 'm1', user_id: 'u1' }] }],
      notification_events: [{ data: null, error: { code: '23505', message: 'duplicate' } }],
    })
    const r = await emitNotification({
      type: 'issue.assigned', projectId: 'p1', payload: { title: 'T' },
      recipientMemberIds: ['m1'], dedupeKey: 'k1',
    })
    expect(r).toEqual({ ok: true, deduped: true })
  })
  it('수신자 해석 실패는 ok:false + 로깅 — throw 하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    admin({ project_members: [{ data: null, error: { message: 'boom' } }] })
    const r = await emitNotification({
      type: 'issue.assigned', projectId: 'p1', payload: { title: 'T' }, recipientMemberIds: ['m1'],
    })
    expect(r.ok).toBe(false)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/lib/notify-emit.test.ts`
Expected: FAIL — `Cannot find module '@/lib/notify/emit'`

- [ ] **Step 3: 구현**

```ts
// src/lib/notify/emit.ts — 알림 발행. fire-and-forget: 실패해도 본 동작을 실패시키지 않되 반드시 로깅.
import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { NOTIFICATION_CATALOG, type NotificationType } from '@/lib/domain/inbox'

export type EmitInput = {
  type: NotificationType
  projectId: string | null
  actorUserId?: string | null
  entityType?: string
  entityId?: string
  payload: { title: string; detail?: string; href?: string }
  recipientMemberIds?: string[]
  recipientUserIds?: string[]
  dedupeKey?: string
}
export type EmitResult = { ok: boolean; deduped?: boolean; recipients?: number }

export async function emitNotification(input: EmitInput): Promise<EmitResult> {
  try {
    const admin = createAdminClient()
    const actor = input.actorUserId ?? null

    // 1) 수신자 해석 — member_id → user_id 스냅샷(발행 시점 링크). 미링크(user_id null)도
    //    행은 남긴다: 멱등 키·감사 근거. 배지·피드는 user_id 기준이라 링크 전에는 보이지 않는다.
    const rows: { member_id: string | null; user_id: string | null }[] = []
    const memberIds = [...new Set(input.recipientMemberIds ?? [])]
    if (memberIds.length > 0) {
      const { data, error } = await admin
        .from('project_members').select('id, user_id').in('id', memberIds)
      if (error) {
        console.error('[notify] 수신자 해석 실패', input.type, error.message)
        return { ok: false }
      }
      for (const m of data ?? []) {
        if (m.user_id !== actor) rows.push({ member_id: m.id, user_id: m.user_id ?? null })
      }
    }
    for (const uid of new Set(input.recipientUserIds ?? [])) {
      if (uid !== actor) rows.push({ member_id: null, user_id: uid })
    }
    if (rows.length === 0) return { ok: true, recipients: 0 }

    // 2) 이벤트 — dedupe_key 유니크 충돌은 "이미 발행됨" = 성공.
    const { data: ev, error: evErr } = await admin
      .from('notification_events')
      .insert({
        type: input.type,
        category: NOTIFICATION_CATALOG[input.type].category,
        audience: 'direct',
        project_id: input.projectId,
        actor_user_id: actor,
        entity_type: input.entityType ?? null,
        entity_id: input.entityId ?? null,
        payload: input.payload,
        dedupe_key: input.dedupeKey ?? null,
      })
      .select('id')
      .single()
    if (evErr || !ev) {
      if (evErr?.code === '23505') return { ok: true, deduped: true }
      console.error('[notify] 이벤트 기록 실패', input.type, evErr?.message)
      return { ok: false }
    }

    // 3) 수신자 행 — 이벤트가 방금 생겼으므로 충돌 없음(부분 유니크는 안전망).
    const { error: rcErr } = await admin
      .from('notification_recipients')
      .insert(rows.map(r => ({ event_id: ev.id, member_id: r.member_id, user_id: r.user_id })))
    if (rcErr) {
      console.error('[notify] 수신자 기록 실패', input.type, rcErr.message)
      return { ok: false }
    }
    return { ok: true, recipients: rows.length }
  } catch (e) {
    console.error('[notify] emit 예외', input.type, e)
    return { ok: false }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/lib/notify-emit.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/notify/emit.ts tests/lib/notify-emit.test.ts
git commit -m "feat(inbox): emitNotification 발행 헬퍼 — fire-and-forget, 행위자 제외, dedupe 멱등"
```

---

### Task 4: 조회·읽음 서버 액션

**Files:**
- Create: `src/app/actions/inbox.ts`
- Modify: `src/lib/domain/types.ts` (`UiPrefs`에 `notif?: Record<string, boolean>` 1줄)
- Test: `tests/actions/inbox.test.ts`

**Interfaces:**
- Consumes: `getSession`(`@/lib/auth`), `createServerClient`, `createAdminClient`, `isTypeEnabled`(Task 2)
- Produces (Task 6이 소비):
  ```ts
  type InboxItem = {
    recipientId: string; type: string; category: string
    title: string; detail: string | null; href: string | null
    createdAt: string; seen: boolean; read: boolean
  }
  getInboxFeed(limit?: number): Promise<{ items: InboxItem[]; unseen: number; failed?: true }>
  markInboxSeen(): Promise<{ ok: boolean }>
  markAllInboxRead(): Promise<{ ok: boolean }>
  markInboxItemRead(recipientId: string): Promise<{ ok: boolean }>
  ```

- [ ] **Step 1: `UiPrefs` 확장** — `src/lib/domain/types.ts`의 `UiPrefs` interface(`types.ts:177-190` 부근)에 추가:

```ts
  notif?: Record<string, boolean> // 알림 타입 → on/off (조회 시점 필터, REQUIRED 는 무시)
```

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// tests/actions/inbox.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createServerClient: vi.fn(),
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { getInboxFeed, markInboxSeen } from '@/app/actions/inbox'

type Resp = { data?: unknown; error?: { message: string } | null }

function client(queues: Record<string, Resp[]>) {
  const updates: Record<string, unknown[]> = {}
  return {
    updates,
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'is', 'in', 'order', 'limit', 'gt']) b[k] = () => b
      b.update = (patch: unknown) => { (updates[table] ??= []).push(patch); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ id: 'u1' })
})

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1', seen_at: null, read_at: null, created_at: '2026-08-11T00:00:00Z',
  notification_events: {
    type: 'issue.assigned', category: 'issue',
    payload: { title: '이슈 A', detail: null, href: '/p/p1/issues' },
    created_at: '2026-08-11T00:00:00Z',
  },
  ...over,
})

describe('getInboxFeed', () => {
  it('수신 행을 InboxItem 으로 변환하고 unseen 을 센다', async () => {
    mocks.createServerClient.mockResolvedValue(client({
      notification_recipients: [{ data: [row(), row({ id: 'r2', seen_at: '2026-08-11T01:00:00Z' })] }],
      user_preferences: [{ data: null }],
    }))
    const r = await getInboxFeed()
    expect(r.items).toHaveLength(2)
    expect(r.items[0]).toMatchObject({ recipientId: 'r1', title: '이슈 A', seen: false, read: false })
    expect(r.unseen).toBe(1)
  })
  it('prefs 로 꺼진 타입은 피드·배지에서 제외', async () => {
    mocks.createServerClient.mockResolvedValue(client({
      notification_recipients: [{ data: [row()] }],
      user_preferences: [{ data: { prefs: { notif: { 'issue.assigned': false } } } }],
    }))
    const r = await getInboxFeed()
    expect(r.items).toHaveLength(0)
    expect(r.unseen).toBe(0)
  })
  it('조회 실패는 failed 로 표면화 — 빈 피드로 위장하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.createServerClient.mockResolvedValue(client({
      notification_recipients: [{ data: null, error: { message: 'boom' } }],
    }))
    const r = await getInboxFeed()
    expect(r.failed).toBe(true)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('markInboxSeen', () => {
  it('본인 unseen 행 전체에 seen_at 을 쓴다 (admin 경유 — 쓰기 정책 0)', async () => {
    const c = client({ notification_recipients: [{ data: null }] })
    mocks.createAdminClient.mockReturnValue(c)
    const r = await markInboxSeen()
    expect(r.ok).toBe(true)
    expect(c.updates.notification_recipients).toHaveLength(1)
  })
  it('비로그인은 거부', async () => {
    mocks.getSession.mockResolvedValue(null)
    expect(await markInboxSeen()).toEqual({ ok: false })
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run tests/actions/inbox.test.ts`
Expected: FAIL — `Cannot find module '@/app/actions/inbox'`

- [ ] **Step 4: 구현**

```ts
// src/app/actions/inbox.ts — 알림함 조회·읽음. 조회는 RLS(본인 행), 쓰기는 admin + 세션 가드
// (0074 는 쓰기 정책 0 — 서버 액션 가드가 유일한 관문).
'use server'

import { getSession } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isTypeEnabled, type NotificationType } from '@/lib/domain/inbox'
import type { UiPrefs } from '@/lib/domain/types'

export type InboxItem = {
  recipientId: string
  type: string
  category: string
  title: string
  detail: string | null
  href: string | null
  createdAt: string
  seen: boolean
  read: boolean
}

type EventRow = {
  type: string; category: string
  payload: { title?: string; detail?: string; href?: string } | null
  created_at: string
}
type RecipientRow = {
  id: string; seen_at: string | null; read_at: string | null; created_at: string
  notification_events: EventRow | EventRow[] | null
}

/** 개인 피드 + unseen 배지. 공지(전체 알림) 합산은 화면에서 getUnreadAnnouncementCount 와 병렬 호출. */
export async function getInboxFeed(limit = 30): Promise<{ items: InboxItem[]; unseen: number; failed?: true }> {
  const user = await getSession()
  if (!user) return { items: [], unseen: 0 }
  const sb = await createServerClient()

  const { data, error } = await sb
    .from('notification_recipients')
    .select('id, seen_at, read_at, created_at, notification_events(type, category, payload, created_at)')
    .eq('user_id', user.id)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[inbox] 피드 조회 실패', error.message)
    return { items: [], unseen: 0, failed: true }
  }

  const { data: prefRow } = await sb
    .from('user_preferences').select('prefs').eq('user_id', user.id).maybeSingle()
  const notifPrefs = ((prefRow?.prefs as UiPrefs | null)?.notif) ?? undefined

  const items: InboxItem[] = []
  for (const r of (data ?? []) as RecipientRow[]) {
    const ev = Array.isArray(r.notification_events) ? r.notification_events[0] : r.notification_events
    if (!ev) continue
    if (!isTypeEnabled(notifPrefs, ev.type as NotificationType)) continue
    items.push({
      recipientId: r.id,
      type: ev.type,
      category: ev.category,
      title: ev.payload?.title ?? ev.type,
      detail: ev.payload?.detail ?? null,
      href: ev.payload?.href ?? null,
      createdAt: r.created_at,
      seen: r.seen_at != null,
      read: r.read_at != null,
    })
  }
  return { items, unseen: items.filter(i => !i.seen).length }
}

/** 벨 열람 — unseen 전체 소등(배지 0). 항목의 읽음(read)과는 별개. */
export async function markInboxSeen(): Promise<{ ok: boolean }> {
  const user = await getSession()
  if (!user) return { ok: false }
  const admin = createAdminClient()
  const { error } = await admin
    .from('notification_recipients')
    .update({ seen_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('seen_at', null)
  if (error) console.error('[inbox] seen 처리 실패', error.message)
  return { ok: !error }
}

/** '모두 읽음' — read+seen 동시 처리. */
export async function markAllInboxRead(): Promise<{ ok: boolean }> {
  const user = await getSession()
  if (!user) return { ok: false }
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { error } = await admin
    .from('notification_recipients')
    .update({ read_at: now, seen_at: now })
    .eq('user_id', user.id)
    .is('read_at', null)
  if (error) console.error('[inbox] 모두 읽음 실패', error.message)
  return { ok: !error }
}

/** 항목 클릭 — 개별 읽음. 본인 행 한정(eq user_id)이 소유 검증이다. */
export async function markInboxItemRead(recipientId: string): Promise<{ ok: boolean }> {
  const user = await getSession()
  if (!user || typeof recipientId !== 'string') return { ok: false }
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { error } = await admin
    .from('notification_recipients')
    .update({ read_at: now, seen_at: now })
    .eq('id', recipientId)
    .eq('user_id', user.id)
    .is('read_at', null)
  if (error) console.error('[inbox] 읽음 처리 실패', error.message)
  return { ok: !error }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/actions/inbox.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: 전체 테스트·lint**

Run: `npm run test && npm run lint`
Expected: 전부 초록 (기존 회귀 없음)

- [ ] **Step 7: 커밋**

```bash
git add src/app/actions/inbox.ts src/lib/domain/types.ts tests/actions/inbox.test.ts
git commit -m "feat(inbox): 피드 조회·seen/read 액션 — 조회는 RLS, 쓰기는 세션 가드 + admin"
```

---

### Task 5: 이슈 발행 지점 2곳 — 첫 실사용

**Files:**
- Modify: `src/app/actions/issues.ts` (`replaceAssignees` :470-500 부근, `createIssueFromMinuteBlock` :812 부근)
- Test: `tests/actions/issue-notify.test.ts`

**Interfaces:**
- Consumes: `emitNotification` (Task 3)
- Produces: `issue.assigned` 알림 — ① `replaceAssignees` 경유 전 경로(createIssue·updateIssue·updateIssueProgress)에서 **신규 추가분만** ② 회의록→이슈 RPC 경로.

**배경:** `replaceAssignees`는 delete-all-then-insert다 — diff 없이 발행하면 이슈를 수정할 때마다 기존 담당자 전원이 재알림을 받는다(스팸). delete 전에 기존 `member_id`를 읽어 **추가분만** 발행한다. RPC 경로(`create_issue_from_minute_block`)는 `replaceAssignees`를 타지 않으므로 액션에서 별도 발행한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`replaceAssignees`는 미export 내부 함수 — 발행 로직을 검증 가능하게 하기 위해 diff 계산을 Task 2의 도메인에 두지 않고 이슈 액션 파일에 export 순수 함수로 추가한다(`computeAddedAssignees`).

```ts
// tests/actions/issue-notify.test.ts
import { describe, it, expect } from 'vitest'
import { computeAddedAssignees } from '@/app/actions/issues'

describe('computeAddedAssignees — 신규 추가분만 알림', () => {
  it('기존에 없던 담당자만 반환', () => {
    expect(computeAddedAssignees(['m1', 'm2'], ['m2', 'm3'])).toEqual(['m3'])
  })
  it('전원 유지면 빈 배열 — 재알림 없음', () => {
    expect(computeAddedAssignees(['m1', 'm2'], ['m1', 'm2'])).toEqual([])
  })
  it('신규 이슈(기존 없음)는 전원', () => {
    expect(computeAddedAssignees([], ['m1', 'm2'])).toEqual(['m1', 'm2'])
  })
  it('해제만 있으면 빈 배열', () => {
    expect(computeAddedAssignees(['m1', 'm2'], ['m1'])).toEqual([])
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/actions/issue-notify.test.ts`
Expected: FAIL — `computeAddedAssignees is not a function` (또는 export 없음)

- [ ] **Step 3: `issues.ts` 수정 — diff 함수 + 발행**

`issues.ts` 상단에 import 추가:

```ts
import { emitNotification } from '@/lib/notify/emit'
```

diff 순수 함수 export 추가(서버 액션 파일의 export는 async 여야 하므로 — Next 'use server' 제약 — **`src/lib/domain/inbox.ts`에 두는 것으로 변경**한다. Task 2 파일에 추가):

```ts
// src/lib/domain/inbox.ts 에 추가
/** delete-then-insert 담당자 교체에서 "새로 배정된" 사람만 — 재알림 스팸 방지. */
export function computeAddedAssignees(existing: readonly string[], next: readonly string[]): string[] {
  const had = new Set(existing)
  return next.filter(id => !had.has(id))
}
```

(테스트의 import 경로도 `@/lib/domain/inbox`로 작성한다 — Step 1 코드에서 경로만 교체.)

`replaceAssignees`를 수정 — delete 전에 기존 조회, insert 성공 후 발행. 함수 시그니처에 발행 문맥을 추가한다:

```ts
async function replaceAssignees(
  sb: SupabaseClient, issueId: string, projectId: string, memberIds: string[],
  notify?: { issueTitle: string; actorUserId: string },
): Promise<string | null> {
  const unique = [...new Set(memberIds)]
  // ... 기존 유효성 선검증 그대로 ...

  // 발행용 diff — delete 전에 스냅샷 (쓰기 전 선행 조회 실패 시 중단하지 않고 알림만 포기:
  // 알림은 부차 기능, 담당자 저장 자체를 막지 않는다. 실패는 로깅.)
  let added: string[] = []
  if (notify) {
    const { data: prev, error: prevErr } = await sb
      .from('issue_assignees').select('member_id').eq('issue_id', issueId)
    if (prevErr) console.error('[notify] 기존 담당자 조회 실패 — 알림 생략', prevErr.message)
    else added = computeAddedAssignees((prev ?? []).map(p => p.member_id as string), validIds)
  }

  // ... 기존 delete → insert 그대로 ...

  if (notify && added.length > 0) {
    await emitNotification({
      type: 'issue.assigned', projectId, actorUserId: notify.actorUserId,
      entityType: 'issue', entityId: issueId,
      payload: { title: notify.issueTitle, detail: '이슈 담당자로 지정되었습니다', href: `/p/${projectId}/issues` },
      recipientMemberIds: added,
      dedupeKey: `issue.assigned:${issueId}:${added.slice().sort().join(',')}`,
    })
  }
  return null
}
```

호출부 3곳(`createIssue` :606 부근 · `updateIssue` :970 부근 · `updateIssueProgress` :1047 부근)에 `notify` 인자 추가 — 각 액션이 이미 보유한 제목·actor를 전달:

```ts
await replaceAssignees(sb, issueId, projectId, value.assigneeMemberIds,
  { issueTitle: value.title, actorUserId: g.actor.userId })
```

(`updateIssueProgress`는 제목을 폼에서 받지 않으면 기존 이슈 조회값의 title을 쓴다 — 이 액션이 이미 이슈 행을 읽고 있으면 그 값을 재사용하고, 아니면 `notify` 생략(진행 갱신은 담당 변경이 드물다 — 생략 시 알림 없음이 아니라 `updateIssue` 경로가 커버).)

`createIssueFromMinuteBlock`(:812) — RPC 성공 후 발행:

```ts
// admin.rpc('create_issue_from_minute_block', ...) 성공 분기 안, created.id 확보 후
await emitNotification({
  type: 'issue.assigned', projectId, actorUserId: g.actor.userId,
  entityType: 'issue', entityId: created.id,
  payload: { title: value.title, detail: '회의록에서 생성된 이슈의 담당자로 지정되었습니다', href: `/p/${projectId}/issues` },
  recipientMemberIds: [...new Set(value.assigneeMemberIds)],
  dedupeKey: `issue.assigned:${created.id}:init`,
})
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/actions/issue-notify.test.ts tests/actions/`
Expected: issue-notify 4건 PASS + 기존 이슈 액션 테스트 전부 초록(시그니처 변경이 옵셔널 인자라 회귀 없음. 깨지면 mock에 `issue_assignees` 조회 큐 1개 추가)

- [ ] **Step 5: 전체 테스트**

Run: `npm run test`
Expected: 전부 초록

- [ ] **Step 6: 커밋**

```bash
git add src/app/actions/issues.ts src/lib/domain/inbox.ts tests/actions/issue-notify.test.ts tests/domain/inbox.test.ts
git commit -m "feat(inbox): 이슈 담당 지정 알림 — replaceAssignees diff 로 신규 추가분만, RPC 경로 별도 발행"
```

---

### Task 6: 벨 UI 통합 — G2 브랜치

**Files:**
- Create: `src/components/app/InboxPanel.tsx` — **G2 대상**
- Modify: `src/components/app/HeaderChrome.tsx` (벨 데이터 소스·배지·패널) — **G2 대상**
- Create: `src/lib/i18n/dict/inbox.ts` + Modify: `src/lib/i18n/dict.ts` (네임스페이스 등록)
- Test: `tests/ui/inbox-panel.test.tsx`

**Interfaces:**
- Consumes: `getInboxFeed`·`markInboxSeen`·`markAllInboxRead`·`markInboxItemRead`(Task 4), 기존 `getNotifications`·`markAllNotificationsRead`(파생 구획), `getUnreadAnnouncementCount`(공지 합산)
- Produces: 벨 아이콘 = 통합 배지(개인 unseen + 파생 안읽음 + 공지 안읽음), 패널 3구획(개인 알림 / 공지 / 지연·마감)

- [ ] **Step 1: 브랜치 생성**

```bash
git switch -c ui/inbox-bell
```

- [ ] **Step 2: i18n 네임스페이스**

```ts
// src/lib/i18n/dict/inbox.ts — 알림함 전용 네임스페이스 (화면별 파일 분리 관례)
export const inboxKo = {
  'inbox.title': '알림',
  'inbox.personal': '내 알림',
  'inbox.announcements': '공지',
  'inbox.derived': '지연 · 마감 임박',
  'inbox.empty': '새 알림이 없습니다. 👍',
  'inbox.markAllRead': '모두 읽음',
  'inbox.loadFailed': '알림을 불러오지 못했습니다',
  'inbox.announceUnread': '안읽은 공지',
  'inbox.viewAnnouncements': '공지사항 보기',
} as const
export const inboxEn: Record<keyof typeof inboxKo, string> = {
  'inbox.title': 'Notifications',
  'inbox.personal': 'My notifications',
  'inbox.announcements': 'Announcements',
  'inbox.derived': 'Delayed · Due soon',
  'inbox.empty': 'No new notifications. 👍',
  'inbox.markAllRead': 'Mark all read',
  'inbox.loadFailed': 'Failed to load notifications',
  'inbox.announceUnread': 'unread announcements',
  'inbox.viewAnnouncements': 'View announcements',
}
```

`src/lib/i18n/dict.ts`에 기존 네임스페이스 등록 관례대로 ko/en 병합 지점에 `...inboxKo` / `...inboxEn` 추가.

- [ ] **Step 3: InboxPanel 컴포넌트**

```tsx
// src/components/app/InboxPanel.tsx — 벨 패널 본문. 데이터는 HeaderChrome 이 내려준다(패널은 표현만).
'use client'

import Link from 'next/link'
import { AlertTriangle, BellRing, Clock4, Megaphone } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { NotificationItem } from '@/app/actions/notifications'
import type { InboxItem } from '@/app/actions/inbox'

export function InboxPanel({
  items, derived, unreadAnnouncements, projectId, loading, failed, onItemClick, onMarkAllRead,
}: {
  items: InboxItem[]
  derived: NotificationItem[]           // 기존 파생 피드(지연·마감) — 이벤트가 아니라 구획 유지
  unreadAnnouncements: number
  projectId: string | null
  loading: boolean
  failed: boolean
  onItemClick: (item: InboxItem) => void
  onMarkAllRead: () => void
}) {
  const { t } = useLocale()
  const unread = items.filter(i => !i.read).length + derived.length
  const empty = items.length === 0 && derived.length === 0 && unreadAnnouncements === 0

  return (
    <>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="text-sm font-semibold text-ink">{t('inbox.title')}</span>
        {unread > 0 && (
          <span className="flex items-center gap-2">
            <span className="chip bg-delayed-weak text-delayed">{unread}</span>
            <button onClick={onMarkAllRead} className="text-[11px] font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline">
              {t('inbox.markAllRead')}
            </button>
          </span>
        )}
      </div>
      <div className="max-h-96 overflow-y-auto">
        {failed ? (
          <div className="px-4 py-6 text-center text-xs text-delayed">{t('inbox.loadFailed')}</div>
        ) : loading ? (
          <div className="px-4 py-6 text-center text-xs text-ink-subtle">…</div>
        ) : empty ? (
          <div className="px-4 py-6 text-center text-xs text-ink-subtle">{t('inbox.empty')}</div>
        ) : (
          <>
            {items.length > 0 && (
              <Section label={t('inbox.personal')}>
                {items.map(n => (
                  <li key={n.recipientId}>
                    <button onClick={() => onItemClick(n)} className={`flex w-full gap-3 px-4 py-3 text-left transition hover:bg-surface-2 ${n.read ? 'opacity-55' : ''}`}>
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-muted">
                        <BellRing className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-ink">{n.title}</span>
                        {n.detail && <span className="block text-[11px] text-ink-muted">{n.detail}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </Section>
            )}
            {projectId && unreadAnnouncements > 0 && (
              <Section label={t('inbox.announcements')}>
                <li>
                  <Link href={`/p/${projectId}/announcements`} className="flex gap-3 px-4 py-3 transition hover:bg-surface-2">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-pending-weak text-accent-warning">
                      <Megaphone className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-ink">{unreadAnnouncements} {t('inbox.announceUnread')}</span>
                      <span className="block text-[11px] text-ink-muted">{t('inbox.viewAnnouncements')}</span>
                    </span>
                  </Link>
                </li>
              </Section>
            )}
            {projectId && derived.length > 0 && (
              <Section label={t('inbox.derived')}>
                {derived.map(n => (
                  <li key={n.id}>
                    <Link href={`/p/${projectId}/kanban`} className="flex gap-3 px-4 py-3 transition hover:bg-surface-2">
                      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${n.severity === 'danger' ? 'bg-delayed-weak text-delayed' : 'bg-pending-weak text-accent-warning'}`}>
                        {n.type === 'delayed' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock4 className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-ink">{n.title}</span>
                        <span className="block text-[11px] text-ink-muted">{n.detail}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="border-b border-line bg-surface-2/60 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">{label}</div>
      <ul className="divide-y divide-line">{children}</ul>
    </div>
  )
}
```

- [ ] **Step 4: HeaderChrome 수정** — 벨 상태·배지·패널 본문 교체(`HeaderChrome.tsx:45-61`의 파생 로드는 유지, inbox 로드 추가):

```tsx
// 추가 import
import { getInboxFeed, markInboxSeen, markAllInboxRead, markInboxItemRead, type InboxItem } from '@/app/actions/inbox'
import { InboxPanel } from './InboxPanel'
// getUnreadAnnouncementCount 는 이미 import 되어 있다(:11)

// 상태 추가 (기존 notifs·notifLoading 곁에)
const [inbox, setInbox] = useState<InboxItem[]>([])
const [inboxFailed, setInboxFailed] = useState(false)
const [unreadAnn, setUnreadAnn] = useState(0)

// 로드 — 파생(프로젝트 의존)과 달리 개인 피드는 프로젝트 무관, 경로 변경마다 재조회
useEffect(() => {
  let alive = true
  getInboxFeed()
    .then(r => { if (!alive) return; setInbox(r.items); setInboxFailed(r.failed === true) })
    .catch(() => { if (alive) setInboxFailed(true) })
  if (routeProjectId) {
    getUnreadAnnouncementCount(routeProjectId).then(n => { if (alive) setUnreadAnn(n) }).catch(() => {})
  } else setUnreadAnn(0)
  return () => { alive = false }
}, [pathname, routeProjectId])

// 배지 합산 — 개인 unseen + 파생 안읽음 + 공지 안읽음 (결정 N3: 한 벨, 합산 배지)
const unseenInbox = useMemo(() => inbox.filter(n => !n.seen).length, [inbox])
const badge = unseenInbox + unreadNotifs + unreadAnn

// 벨 열람 = seen 소등 (read 는 항목 클릭)
const openNotif = () => {
  const next = open === 'notif' ? null : 'notif'
  setOpen(next)
  if (next === 'notif' && unseenInbox > 0) {
    setInbox(ns => ns.map(n => ({ ...n, seen: true })))  // 낙관 반영
    markInboxSeen().catch(() => {})
  }
}

const onInboxItemClick = (item: InboxItem) => {
  setInbox(ns => ns.map(n => n.recipientId === item.recipientId ? { ...n, read: true } : n))
  markInboxItemRead(item.recipientId).catch(() => {})
  if (item.href) { setOpen(null); router.push(item.href) }
}

const onMarkAllRead = () => {
  setInbox(ns => ns.map(n => ({ ...n, read: true, seen: true })))
  markAllInboxRead().catch(() => {})
  markAllRead()  // 기존 파생 구획 읽음 처리 재사용
}
```

벨 버튼(:150-155)의 카운트를 `unreadNotifs` → `badge`로, 패널 본문(:157-196)을 다음으로 교체:

```tsx
{open === 'notif' && (
  <Popover onClose={() => setOpen(null)}>
    <InboxPanel
      items={inbox} derived={visibleNotifs} unreadAnnouncements={unreadAnn}
      projectId={routeProjectId} loading={notifLoading} failed={inboxFailed}
      onItemClick={onInboxItemClick} onMarkAllRead={onMarkAllRead}
    />
  </Popover>
)}
```

벨 클릭 핸들러(:150)를 `onClick={openNotif}`로 교체. Popover 폭은 구획이 늘었으니 `w-64` → `w-80`(Popover 컴포넌트 :254).

- [ ] **Step 5: UI 테스트**

```tsx
// tests/ui/inbox-panel.test.tsx — 렌더 분기 검증 (node 환경 관례에 맞춰 renderToStaticMarkup)
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { InboxPanel } from '@/components/app/InboxPanel'

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko', setLocale: () => {} }),
}))

const base = {
  derived: [], unreadAnnouncements: 0, projectId: 'p1',
  loading: false, failed: false, onItemClick: () => {}, onMarkAllRead: () => {},
}
const item = {
  recipientId: 'r1', type: 'issue.assigned', category: 'issue', title: '이슈 A',
  detail: null, href: '/p/p1/issues', createdAt: '2026-08-11', seen: false, read: false,
}

describe('InboxPanel', () => {
  it('빈 상태', () => {
    expect(renderToStaticMarkup(<InboxPanel {...base} items={[]} />)).toContain('inbox.empty')
  })
  it('개인 알림 구획 렌더', () => {
    const html = renderToStaticMarkup(<InboxPanel {...base} items={[item]} />)
    expect(html).toContain('이슈 A')
    expect(html).toContain('inbox.personal')
  })
  it('조회 실패는 위장하지 않고 표시', () => {
    expect(renderToStaticMarkup(<InboxPanel {...base} items={[]} failed />)).toContain('inbox.loadFailed')
  })
  it('공지 구획은 안읽음이 있고 프로젝트 문맥일 때만', () => {
    const html = renderToStaticMarkup(<InboxPanel {...base} items={[]} unreadAnnouncements={3} />)
    expect(html).toContain('inbox.announceUnread')
    const none = renderToStaticMarkup(<InboxPanel {...base} items={[]} unreadAnnouncements={3} projectId={null} />)
    expect(none).not.toContain('inbox.announceUnread')
  })
})
```

Run: `npx vitest run tests/ui/inbox-panel.test.tsx`
Expected: PASS (4 tests). (기존 `tests/ui/`가 다른 렌더 방식을 쓰면 그 관례를 따른다 — 먼저 기존 파일 1개를 열어 확인.)

- [ ] **Step 6: 전체 검증 + 브랜치 push (G2 통과 요건)**

```bash
npm run test && npm run lint && npm run build
git add src/components/app/InboxPanel.tsx src/components/app/HeaderChrome.tsx src/lib/i18n/dict/inbox.ts src/lib/i18n/dict.ts tests/ui/inbox-panel.test.tsx
git commit -m "feat(inbox): 벨 통합 — 개인·공지·파생 3구획 패널, 배지 합산, 열람=seen 소등"
git push -u origin HEAD
```

Preview URL은 로그인 뒤 화면을 검증하지 못한다(env 0건) — 로컬 `npm run dev`에서 벨 열람·배지·읽음 흐림을 눈으로 확인한 뒤 머지한다.

- [ ] **Step 7: main 머지**

```bash
git switch main && git merge ui/inbox-bell && git push origin main
npm run smoke:prod   # 배포 후
```

---

### Task 7: retention — Vercel Cron

**Files:**
- Create: `src/app/api/cron/inbox-retention/route.ts`
- Modify: `vercel.json` (crons 등록 — 현재 `"crons": []`)
- Test: `tests/api/inbox-retention.test.ts`

**Interfaces:**
- Consumes: `purge_read_notifications` RPC (Task 1)
- Produces: 매일 04시(KST) 읽음 90일 경과분 purge. `CRON_SECRET` env 필요(Vercel이 cron 요청에 `Authorization: Bearer <CRON_SECRET>` 자동 첨부).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/api/inbox-retention.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET } from '@/app/api/cron/inbox-retention/route'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-secret'
})

const req = (auth?: string) =>
  new Request('http://localhost/api/cron/inbox-retention', { headers: auth ? { authorization: auth } : {} })

describe('inbox retention cron', () => {
  it('시크릿 불일치는 401 — fail-closed', async () => {
    expect((await GET(req('Bearer wrong'))).status).toBe(401)
    expect((await GET(req())).status).toBe(401)
  })
  it('CRON_SECRET 미설정이면 503 — 조용히 전삭제하지 않는다', async () => {
    delete process.env.CRON_SECRET
    expect((await GET(req('Bearer anything'))).status).toBe(503)
  })
  it('정상 호출은 purge RPC 실행', async () => {
    const rpc = vi.fn(async () => ({ data: [{ recipients_deleted: 3, events_deleted: 1 }], error: null }))
    mocks.createAdminClient.mockReturnValue({ rpc })
    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('purge_read_notifications', { retention_days: 90 })
  })
  it('RPC 실패는 500 로 표면화', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.createAdminClient.mockReturnValue({ rpc: vi.fn(async () => ({ data: null, error: { message: 'boom' } })) })
    expect((await GET(req('Bearer test-secret'))).status).toBe(500)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/api/inbox-retention.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// src/app/api/cron/inbox-retention/route.ts — 읽음 90일 경과 알림 purge (안읽음 보존).
// Vercel Cron 이 Authorization: Bearer <CRON_SECRET> 으로 호출한다. 시크릿 없으면 실행 거부(fail-closed).
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) return new Response('cron secret not configured', { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 })
  }
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('purge_read_notifications', { retention_days: 90 })
  if (error) {
    console.error('[inbox] retention purge 실패', error.message)
    return new Response('purge failed', { status: 500 })
  }
  return Response.json({ ok: true, result: data })
}
```

`vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["icn1"],
  "crons": [{ "path": "/api/cron/inbox-retention", "schedule": "0 19 * * *" }]
}
```

(19:00 UTC = 04:00 KST. Vercel 프로젝트 env에 `CRON_SECRET` 추가 필요 — 값은 `openssl rand -hex 16`, **Production 대상**. 이 env 추가는 배포 전 사람이 Vercel 대시보드에서 수행하고, 미설정 동안 라우트는 503으로 안전.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/api/inbox-retention.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/cron/inbox-retention/route.ts vercel.json tests/api/inbox-retention.test.ts
git commit -m "feat(inbox): retention cron — 읽음 90일 purge, 안읽음 보존, CRON_SECRET fail-closed"
```

---

### Task 8: Realtime — 0075 + 클라 구독

**Files:**
- Create: `supabase/migrations/0075_notification_realtime.sql` (+`_rollback`)
- Create: `src/lib/hooks/useInboxRealtime.ts`
- Modify: `src/components/app/HeaderChrome.tsx` (훅 1줄 연결 — **G2**)
- Test: `tests/migrations/notification-realtime.test.ts`

**Interfaces:**
- Consumes: `notification_recipients` (Task 1)
- Produces: private 채널 `user-{user_id}-notifications`의 `new_notification` broadcast → 벨 배지 실시간 갱신. **향상 계층 — 실패해도 경로 전환 재조회(Task 6)로 동작.**

**주의:** 리포에 `realtime.send`/`realtime.messages` 선례가 없다(실측). postgres_changes는 쓰지 않는다(구독자 비례 RLS 재검사 — Micro 컴퓨트 부담, 스펙 §Realtime).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/migrations/notification-realtime.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const dir = 'supabase/migrations/'
const migration = readFileSync(`${dir}0075_notification_realtime.sql`, 'utf8')
const rollback = readFileSync(`${dir}0075_notification_realtime_rollback.sql`, 'utf8')

describe('0075 notification realtime', () => {
  it('realtime.send 를 쓴다 — postgres_changes(publication) 아님', () => {
    expect(migration).toMatch(/realtime\.send/)
    expect(migration).not.toMatch(/alter publication supabase_realtime/)
  })
  it('user_id 없는 행(미링크 로스터)은 송신 생략', () => {
    expect(migration).toMatch(/new\.user_id is not null/)
  })
  it('송신 실패가 insert 를 실패시키지 않는다 — 예외 삼킴', () => {
    expect(migration).toMatch(/exception when others then/i)
  })
  it('private 채널 수신 정책 — 본인 토픽 한정', () => {
    expect(migration).toMatch(/on realtime\.messages/)
    expect(migration).toMatch(/realtime\.topic\(\) = 'user-' \|\| \(select auth\.uid\(\)\)::text \|\| '-notifications'/)
  })
  it('롤백은 트리거→함수→정책 순 제거', () => {
    expect(rollback).toMatch(/drop trigger if exists notify_recipient_broadcast/)
    expect(rollback).toMatch(/drop function if exists public\.notify_recipient_broadcast/)
    expect(rollback).toMatch(/drop policy if exists receive_own_notification_channel on realtime\.messages/)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/migrations/notification-realtime.test.ts`
Expected: FAIL — 파일 없음

- [ ] **Step 3: 마이그레이션 작성**

```sql
-- 알림 실시간 push — 수신자 행 INSERT 시 본인 private 채널로 broadcast.
--
-- 핵심 계약
--   1) postgres_changes 를 쓰지 않는다 — 구독자 수 비례 RLS 재검사가 Micro 컴퓨트(2vCPU 공유·1GB)에
--      불리하다. realtime.send(broadcast) 는 송신 1회로 끝난다.
--   2) 송신은 향상 계층이다 — 실패해도 알림 저장(INSERT)을 실패시키지 않는다(예외 삼킴).
--   3) 채널은 private — realtime.messages 의 select 정책이 본인 토픽만 허용한다.
--   4) user_id 없는 수신자(계정 미링크 로스터)는 송신 대상이 없으므로 생략.
--
-- 멱등: 반복 실행 안전. 적용: Supabase Management API(0074 와 동일).
-- 롤백: 0075_notification_realtime_rollback.sql (실시간만 꺼진다 — 저장·폴링은 무영향).

begin;

set search_path = public, extensions;

create or replace function public.notify_recipient_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    begin
      perform realtime.send(
        jsonb_build_object('recipient_id', new.id, 'event_id', new.event_id),
        'new_notification',
        'user-' || new.user_id::text || '-notifications',
        true  -- private 채널
      );
    exception when others then
      null;  -- 송신 실패는 삼킨다 — 본 INSERT 를 지키는 것이 우선
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_recipient_broadcast on public.notification_recipients;
create trigger notify_recipient_broadcast
  after insert on public.notification_recipients
  for each row execute function public.notify_recipient_broadcast();

-- private 채널 수신 인가 — 본인 토픽만.
drop policy if exists receive_own_notification_channel on realtime.messages;
create policy receive_own_notification_channel on realtime.messages
  for select to authenticated
  using (
    realtime.topic() = 'user-' || (select auth.uid())::text || '-notifications'
    and extension = 'broadcast'
  );

reset search_path;

commit;
```

- [ ] **Step 4: 롤백 작성**

```sql
-- 0075 롤백 — 실시간 계층만 제거한다. 알림 저장·폴링 경로는 무영향.

begin;

set search_path = public, extensions;

drop trigger if exists notify_recipient_broadcast on public.notification_recipients;
drop function if exists public.notify_recipient_broadcast();
drop policy if exists receive_own_notification_channel on realtime.messages;

reset search_path;

commit;
```

- [ ] **Step 5: 테스트 통과 → 마이그레이션 단독 커밋 (G1) → Management API 적용**

```bash
npx vitest run tests/migrations/notification-realtime.test.ts
git add supabase/migrations/0075_notification_realtime.sql supabase/migrations/0075_notification_realtime_rollback.sql tests/migrations/notification-realtime.test.ts
git commit -m "feat(migration): 알림 실시간 broadcast(0075) — private 채널, 송신 실패는 저장을 막지 않는다"
```

- [ ] **Step 6: 구독 훅 (별도 커밋 — 코드)**

```ts
// src/lib/hooks/useInboxRealtime.ts — 알림 private 채널 구독. 벨 마운트 1회, 정리 필수(채널 leak 방지).
'use client'

import { useEffect } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'

export function useInboxRealtime(onNew: () => void) {
  useEffect(() => {
    const sb = createBrowserClient()
    let channel: ReturnType<typeof sb.channel> | null = null
    let alive = true
    sb.auth.getUser().then(({ data }) => {
      if (!alive || !data.user) return
      sb.realtime.setAuth() // private 채널 인가 토큰 갱신
      channel = sb
        .channel(`user-${data.user.id}-notifications`, { config: { private: true } })
        .on('broadcast', { event: 'new_notification' }, () => onNew())
        .subscribe()
    })
    return () => {
      alive = false
      if (channel) sb.removeChannel(channel) // leak 1순위 함정 — 반드시 정리
    }
    // onNew 는 ref 로 고정하지 않는다 — 호출부가 useCallback 으로 안정화해서 넘긴다.
  }, [onNew])
}
```

- [ ] **Step 7: HeaderChrome 연결 — G2 브랜치**

```bash
git switch -c ui/inbox-realtime
```

```tsx
// HeaderChrome 내부 — Task 6 의 inbox 로드 effect 곁에
const refreshInbox = useCallback(() => {
  getInboxFeed().then(r => { setInbox(r.items); setInboxFailed(r.failed === true) }).catch(() => {})
}, [])
useInboxRealtime(refreshInbox)
```

(import에 `useCallback`·`useInboxRealtime` 추가.)

- [ ] **Step 8: 검증·머지**

```bash
npm run test && npm run lint && npm run build
git add src/lib/hooks/useInboxRealtime.ts src/components/app/HeaderChrome.tsx
git commit -m "feat(inbox): 실시간 배지 갱신 — private 채널 구독, unmount 시 채널 정리"
git push -u origin HEAD
git switch main && git merge ui/inbox-realtime && git push origin main
npm run smoke:prod
```

로컬 dev 2세션(A가 이슈 담당 지정 → B의 벨 배지 즉시 +1)으로 실측. 실패 시 0075만 롤백해도 폴링 경로는 살아 있다.

---

## 수용 기준 (전체)

1. 이슈 담당자 지정 시 **신규 담당자에게만** 알림 — 같은 이슈 재수정(담당 유지)에서 재알림 0건.
2. 행위자 본인에게는 알림이 가지 않는다.
3. 벨 배지 = 개인 unseen + 파생 안읽음 + 공지 안읽음 합산. 벨 열람으로 개인분 소등, 항목 클릭으로 읽음 흐림 + 딥링크.
4. 알림 발행 실패(테이블 잠금·네트워크)가 이슈 저장을 실패시키지 않고, 서버 로그에 `[notify]` 에러가 남는다.
5. A 계정으로 B 계정의 수신 행이 조회되지 않는다(RLS).
6. `npm run test`·`lint`·`build` 초록, 기존 벨(지연·마감) 동작 회귀 없음.
7. 운영 D-CUBE 데이터 행 변화 0건(신규 테이블 외 무변경).

## 계획 밖 (이 계획이 하지 않는 것)

- **작업 루프 알림(work.*)** — 발행 지점이 연동 구현(8/10 계획)에 있다. 연동 서버 Task가 emit를 직접 포함한다(부록 §2.10 표가 정본).
- `issue.status`·`member.invited`·`system.*` 발행 훅 — 카탈로그에는 있으나 v1 발행 지점 밖(후속).
- `/account` 알림 설정 UI — 타입 ON/OFF 토글 화면은 연동의 `/account` 페이지(WP-02) 신설 후 그 안에 배치(후속). 그 전까지 기본값으로 동작.
- 이메일·Slack 채널, 서버 배칭, snooze, 브라우저 푸시(스펙 §스코프 밖).

## Self-Review 결과

- 스펙 대비: 데이터 모델(2테이블·워터마크 재사용)·카탈로그·수신 3단계·배지 합산·realtime·retention·안티패턴 가드 9종 전부 Task에 매핑됨. 알림 설정 토글 UI만 의도적 후속(판정 로직은 Task 2·4에 구현 — 기본값 동작).
- 타입 일관성: `InboxItem`(Task 4 정의 ↔ Task 6 소비), `EmitInput`(Task 3 ↔ Task 5), `computeAddedAssignees`(Task 5에서 domain/inbox.ts로 배치 — 테스트 import 경로 주의) 확인.
- 플레이스홀더 없음. 단 `issues.ts`·`HeaderChrome.tsx` 수정 코드는 기존 코드와의 병합이므로 라인 번호는 참고값 — 실제 파일 기준으로 맞출 것.
