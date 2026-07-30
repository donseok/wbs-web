# 사용 현황(Usage Analytics) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 접속 로그·사용자 현황·많이 쓰는 메뉴를 보는 `/usage` 화면과 그것을 채우는 수집 계층을 만든다.

**Architecture:** `(app)/layout.tsx`에 마운트된 클라이언트 비콘이 라우트 전환마다 `POST /api/track`을 호출하고, 라우트가 쿠키로 사용자를 확인한 뒤 service_role로 `usage_events`에 1행을 남긴다. 집계는 SECURITY INVOKER RPC 4종이 DB에서 수행하고(그래서 RLS 정책 하나가 화면·RPC 양쪽의 단일 관문이 된다), 표시 계산은 순수 함수 + 단위 테스트로 고정한다. day-0 빈 화면은 `auth.users.last_sign_in_at`(소급 데이터)로 채운다.

**Tech Stack:** Next.js 15 App Router · React 19 · Tailwind v4 · Supabase(Postgres + RLS) · vitest

**설계 스펙:** `docs/superpowers/specs/2026-07-30-usage-analytics-design.md` (커밋 `1b55161`)

---

## Global Constraints

이 절의 규칙은 **모든 태스크에 암묵적으로 포함된다.**

- **브랜치**: 전 작업을 `ui/usage-analytics`에서 한다. `Sidebar.tsx`·`(app)/layout.tsx`가 UI 위험 파일이라 main 직행이 pre-push G2에 막힌다.
- **`git add -A` 절대 금지.** 항상 파일명을 명시한다(여러 PC·세션이 이 리포를 동시에 쓴다). `tests/scratch/`는 다른 세션 소유이므로 절대 stage 하지 않는다.
- **마이그레이션과 `src/` 코드를 같은 커밋에 담지 않는다**(G1). 훅의 실제 판정은 "한 커밋이 `supabase/migrations/`와 `src/`를 동시에 건드리는가"이므로 `tests/` 파일은 마이그레이션과 같은 커밋에 담아도 된다.
- **`git push --force` 금지.**
- 커밋 메시지는 한국어. "무엇"보다 "왜". 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **프로덕션 마이그레이션 적용과 배포는 사용자 승인 후에만.** 이 계획의 태스크는 로컬 커밋까지만 수행한다.
- **상태 변형 display 유틸 금지** — `group-hover:flex`, `data-[state=open]:hidden`, `print:hidden`은 `globals.css` 말미의 unlayered 안전망에 져서 조용히 무력화된다. 한 요소에 컨테이너 쿼리 display와 반응형 display를 함께 쓰지 않는다.
- **숫자 반올림 자체 구현 금지** — `src/lib/domain/format.ts`의 `round1`/`formatPct1`만 쓴다.
- **에러 처리 3원칙**: ① 조회 실패를 "데이터 없음"으로 위장 금지(throw 또는 로깅) ② 쓰기 전 선행 조회 실패 시 중단 ③ 보안 가드는 fail-closed, 모르면 `'unknown'`.
- 테스트 실행은 `npx vitest run <경로>`. 전체는 `npm run test`.
- "오늘"은 항상 `Asia/Seoul` 기준(`Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })`).
- 보존 기간 상수 **90일**, 세션 유도 간격 **30분**, 접속 로그 표시 상한 **200건**.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `supabase/migrations/0051_usage_events.sql` | 테이블·인덱스·RLS·집계 RPC 4종 |
| `supabase/migrations/0051_usage_events_rollback.sql` | 위의 역순 제거 |
| `src/lib/domain/usageMenu.ts` | 경로 → 메뉴 키/정규화 경로/프로젝트 id (순수) |
| `src/lib/domain/usageTracking.ts` | 수집 on/off 판정 (순수) |
| `src/lib/domain/usage.ts` | 타입 + 시리즈 패딩·행 병합·세션 유도·기간 파싱 (순수) |
| `src/lib/authz/usageAccess.ts` | `canViewUsage` — 열람 권한 단일 판정점 |
| `src/lib/data/usage.ts` | RPC 조회·계정 디렉터리·보존기간 정리 (I/O) |
| `src/app/api/track/route.ts` | 수집 엔드포인트 |
| `src/components/app/UsageTracker.tsx` | 클라이언트 비콘 |
| `src/components/usage/*.tsx` | 표시 전용 컴포넌트 6종 |
| `src/app/(app)/usage/page.tsx` · `loading.tsx` | 조립 |

---

## Task 1: 마이그레이션 0051 (스키마·RLS·집계 RPC)

**Files:**
- Create: `supabase/migrations/0051_usage_events.sql`
- Create: `supabase/migrations/0051_usage_events_rollback.sql`
- Test: `tests/migrations/usage-events.test.ts`

**Interfaces:**
- Consumes: 없음(첫 태스크)
- Produces: 테이블 `usage_events(id bigserial, user_id uuid, menu_key text, path text, project_id uuid, occurred_at timestamptz)`, RPC `usage_summary(p_from date, p_to date, p_today date) → (total_events bigint, active_users bigint, today_users bigint, last_event_at timestamptz)`, `usage_daily_actives(p_from date, p_to date) → (d date, active_users integer, events integer)`, `usage_menu_ranking(p_from date, p_to date) → (menu_key text, events integer, active_users integer)`, `usage_user_rollup(p_from date, p_to date) → (user_id uuid, events integer, active_days integer, last_at timestamptz)`

- [ ] **Step 1: 브랜치 생성**

```bash
cd /Users/jerry/wbs-web
git switch -c ui/usage-analytics
```

- [ ] **Step 2: 실패하는 계약 테스트 작성**

`tests/migrations/usage-events.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/0051_usage_events.sql', import.meta.url),
  'utf8',
)
const rollback = readFileSync(
  new URL('../../supabase/migrations/0051_usage_events_rollback.sql', import.meta.url),
  'utf8',
)

describe('0051 사용 현황 수집 migration 계약', () => {
  it('이벤트 테이블과 조회 인덱스 3종을 만든다', () => {
    expect(migration).toContain('create table if not exists public.usage_events')
    expect(migration).toContain('references auth.users(id) on delete cascade')
    expect(migration).toContain('references public.projects(id) on delete set null')
    expect(migration).toContain('usage_events_occurred_idx')
    expect(migration).toContain('usage_events_user_idx')
    expect(migration).toContain('usage_events_menu_idx')
  })

  it('읽기만 authenticated 에 열고 쓰기 정책은 만들지 않는다(service_role 전용)', () => {
    expect(migration).toContain('alter table public.usage_events enable row level security')
    expect(migration).toContain('create policy read_usage_events on public.usage_events')
    expect(migration).toMatch(/for select\s+to authenticated\s+using \(true\)/)
    expect(migration).not.toMatch(/create policy \w+ on public\.usage_events\s+for (insert|update|delete)/)
    expect(migration).toContain('revoke insert, update, delete on public.usage_events from anon, authenticated')
  })

  it('진행 중인 권한 재설계와 충돌하지 않도록 app_role() 에 의존하지 않는다', () => {
    expect(migration).not.toContain('app_role()')
    expect(migration).not.toContain('current_team()')
  })

  it('집계 RPC 4종은 KST 일자 기준이며 인덱스를 쓸 수 있는 범위 조건을 쓴다', () => {
    for (const fn of ['usage_summary', 'usage_daily_actives', 'usage_menu_ranking', 'usage_user_rollup']) {
      expect(migration).toContain(`create or replace function public.${fn}(`)
      expect(migration).toContain(`grant execute on function public.${fn}(`)
    }
    expect(migration).toContain("at time zone 'Asia/Seoul'")
    // 날짜 함수를 컬럼에 씌운 술어는 occurred_at 인덱스를 못 쓴다 — 범위 비교로 쓴다.
    expect(migration).not.toMatch(/where \(occurred_at at time zone 'Asia\/Seoul'\)::date/)
    expect(migration).toContain('occurred_at >= (p_from::timestamp at time zone')
  })

  it('RPC 는 security definer 가 아니다 — 호출자의 RLS 가 그대로 적용돼야 한다', () => {
    expect(migration).not.toContain('security definer')
  })

  it('롤백은 RPC·정책·테이블을 멱등하게 제거한다', () => {
    for (const fn of ['usage_summary', 'usage_daily_actives', 'usage_menu_ranking', 'usage_user_rollup']) {
      expect(rollback).toContain(`drop function if exists public.${fn}(`)
    }
    expect(rollback).toContain('drop table if exists public.usage_events')
    expect(rollback).toMatch(/데이터 소실|경고/)
  })
})
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npx vitest run tests/migrations/usage-events.test.ts`
Expected: FAIL — `ENOENT: no such file or directory ... 0051_usage_events.sql`

- [ ] **Step 4: 마이그레이션 작성**

`supabase/migrations/0051_usage_events.sql`:

```sql
-- 사용 현황(접속 로그·메뉴 사용량) 수집.
--
-- 핵심 계약
--   1) 쓰기는 service_role(/api/track) 전용이다. INSERT/UPDATE/DELETE 정책을 만들지 않는
--      것이 곧 쓰기 차단이다. 읽기만 authenticated 에 연다.
--   2) "초기 전원 공개 → 이후 관리자 전용" 전환은 read_usage_events 정책 한 줄 교체로
--      끝난다. GRANT 회수(0031·0050 방식)는 되돌리기가 파괴적이라 쓰지 않는다.
--   3) app_role()/current_team() 에 의존하지 않는다 — 진행 중인 권한 3단 재설계가
--      app_role() 을 shim 으로 재정의할 예정이라 하드 의존은 충돌 지점이 된다.
--      (0017/0039 가 순수 auth.uid() 만 쓰는 이유와 같다.)
--   4) 집계 RPC 는 SECURITY INVOKER(기본값)다. 호출자의 RLS 가 그대로 적용되므로
--      위 2)의 정책 한 줄이 화면과 RPC 양쪽의 단일 관문이 된다.
--   5) 일자 버킷은 Asia/Seoul 기준이되, 술어는 occurred_at 범위 비교로 쓴다.
--      (occurred_at at time zone ...)::date = X 형태는 인덱스를 못 쓴다.
--   6) user_id 는 on delete cascade — 개인 활동 데이터이고 보존이 90일이라 감사
--      아카이브가 아니다. minute_highlights(0025) 가 같은 이유로 택한 선례를 따른다.
--      project_id 는 on delete set null — 프로젝트가 지워져도 접속 사실은 남는다.
--
-- 멱등: 반복 실행 안전(create ... if not exists / create or replace / drop policy if exists).
-- 적용: Supabase Management API POST /v1/projects/<ref>/database/query.
--       SUPABASE_DB_URL 이 비어 있어 pg 직결/supabase db push 는 쓰지 않는다.
-- 적용 순서: 이 마이그레이션을 먼저 적용한 뒤 수집·화면 코드를 배포한다(0027 PGRST 교훈).
-- 롤백: 0051_usage_events_rollback.sql (수집된 접속 이력이 전부 소실된다).
-- updated_at 트리거를 만들지 않는다 — 이 테이블은 append-only 다.

set search_path = public, extensions;

-- ── 1) 이벤트 테이블 ──
create table if not exists public.usage_events (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  menu_key    text not null,
  path        text not null,
  project_id  uuid references public.projects(id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index if not exists usage_events_occurred_idx on public.usage_events (occurred_at desc);
create index if not exists usage_events_user_idx     on public.usage_events (user_id, occurred_at desc);
create index if not exists usage_events_menu_idx     on public.usage_events (menu_key, occurred_at desc);

-- ── 2) RLS ──
alter table public.usage_events enable row level security;

drop policy if exists read_usage_events on public.usage_events;
create policy read_usage_events on public.usage_events
  for select
  to authenticated
  using (true);
-- INSERT/UPDATE/DELETE 정책 없음 = 쓰기는 service_role 만.

revoke all on public.usage_events from anon;
grant select on public.usage_events to authenticated;
revoke insert, update, delete on public.usage_events from anon, authenticated;

-- bigserial 시퀀스도 함께 잠근다(쓰기 권한이 없으므로 필요 없지만 표면을 남기지 않는다).
do $$
declare seq text := pg_get_serial_sequence('public.usage_events', 'id');
begin
  if seq is not null then
    execute format('revoke all on sequence %s from public, anon, authenticated', seq);
  end if;
end
$$;

-- ── 3) 집계 RPC (SECURITY INVOKER — 호출자 RLS 적용) ──

-- last_event_at 만 기간 밖 전체를 본다: 화면의 '수집 상태'(수집이 끊겼는가) 판정용이다.
create or replace function public.usage_summary(p_from date, p_to date, p_today date)
returns table (total_events bigint, active_users bigint, today_users bigint, last_event_at timestamptz)
language sql
stable
as $$
  select
    (select count(*) from public.usage_events
       where occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
         and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')),
    (select count(distinct user_id) from public.usage_events
       where occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
         and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')),
    (select count(distinct user_id) from public.usage_events
       where occurred_at >= (p_today::timestamp at time zone 'Asia/Seoul')
         and occurred_at <  ((p_today + 1)::timestamp at time zone 'Asia/Seoul')),
    (select max(occurred_at) from public.usage_events);
$$;

create or replace function public.usage_daily_actives(p_from date, p_to date)
returns table (d date, active_users integer, events integer)
language sql
stable
as $$
  select (occurred_at at time zone 'Asia/Seoul')::date,
         count(distinct user_id)::int,
         count(*)::int
  from public.usage_events
  where occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  group by 1
  order by 1;
$$;

create or replace function public.usage_menu_ranking(p_from date, p_to date)
returns table (menu_key text, events integer, active_users integer)
language sql
stable
as $$
  select menu_key,
         count(*)::int,
         count(distinct user_id)::int
  from public.usage_events
  where occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  group by menu_key
  order by 2 desc, 1;
$$;

create or replace function public.usage_user_rollup(p_from date, p_to date)
returns table (user_id uuid, events integer, active_days integer, last_at timestamptz)
language sql
stable
as $$
  select user_id,
         count(*)::int,
         count(distinct (occurred_at at time zone 'Asia/Seoul')::date)::int,
         max(occurred_at)
  from public.usage_events
  where occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  group by user_id;
$$;

grant execute on function public.usage_summary(date, date, date) to authenticated;
grant execute on function public.usage_daily_actives(date, date)  to authenticated;
grant execute on function public.usage_menu_ranking(date, date)   to authenticated;
grant execute on function public.usage_user_rollup(date, date)    to authenticated;

reset search_path;
```

`supabase/migrations/0051_usage_events_rollback.sql`:

```sql
-- 0051 롤백 — 사용 현황 수집을 제거한다.
--
-- 경고(데이터 소실)
--   · usage_events 에 쌓인 접속 이력이 전부 삭제된다. 복구 경로 없음.
-- 순서: 수집·화면 코드를 먼저 롤백한 뒤 이 파일을 적용한다. 새 코드가 살아 있는 상태에서
--   먼저 적용하면 /api/track 과 /usage 가 PGRST 오류를 낸다.
-- 멱등: 함수/정책/테이블이 이미 없어도 반복 실행 안전하다.

set search_path = public, extensions;

drop function if exists public.usage_summary(date, date, date);
drop function if exists public.usage_daily_actives(date, date);
drop function if exists public.usage_menu_ranking(date, date);
drop function if exists public.usage_user_rollup(date, date);

-- drop policy if exists 는 대상 테이블이 없으면 42P01 이므로 재실행을 위해 가드한다.
do $$
begin
  if to_regclass('public.usage_events') is not null then
    execute 'drop policy if exists read_usage_events on public.usage_events';
  end if;
end
$$;

-- 인덱스와 FK 는 테이블과 함께 제거된다.
drop table if exists public.usage_events;

reset search_path;
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/migrations/usage-events.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: 커밋 (마이그레이션 단독 — G1)**

```bash
git add supabase/migrations/0051_usage_events.sql \
        supabase/migrations/0051_usage_events_rollback.sql \
        tests/migrations/usage-events.test.ts
git commit -m "$(cat <<'EOF'
feat(usage): 사용 현황 수집 스키마 — 쓰기 정책을 만들지 않는 것이 곧 쓰기 차단이다

usage_events 는 service_role 만 쓴다. INSERT 정책을 두지 않는 방식을 택한 이유는
"초기 전원 공개 → 이후 관리자 전용" 전환을 select 정책 한 줄 교체로 끝내기 위해서다.
GRANT 를 회수하는 0031·0050 방식은 되돌릴 때 파괴적이라 쓰지 않았다.

app_role() 에 의존하지 않는다 — 진행 중인 권한 3단 재설계가 그 함수를 shim 으로
재정의할 예정이라 신규 정책이 하드 의존하면 충돌 지점이 된다.

집계 RPC 는 SECURITY INVOKER 다. 호출자 RLS 가 그대로 걸리므로 정책 한 줄이
화면과 RPC 양쪽의 단일 관문이 된다. 일자는 KST 기준이되 술어는 범위 비교로 써서
occurred_at 인덱스를 살렸다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 경로 → 메뉴 키 매퍼 (순수)

**Files:**
- Create: `src/lib/domain/usageMenu.ts`
- Test: `tests/domain/usage-menu.test.ts`

**Interfaces:**
- Consumes: `DictKey` from `@/lib/i18n/dict`
- Produces:
  - `interface UsageMenu { key: string; labelKey: DictKey | null; fallback: string }`
  - `const USAGE_MENUS: readonly UsageMenu[]`
  - `resolveMenuKey(pathname: string): string`
  - `normalizeUsagePath(pathname: string): string`
  - `extractProjectId(pathname: string): string | null`
  - `menuLabel(key: string, translate: (k: DictKey) => string): string`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/usage-menu.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  USAGE_MENUS, resolveMenuKey, normalizeUsagePath, extractProjectId, menuLabel,
} from '@/lib/domain/usageMenu'

const PID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

describe('resolveMenuKey — 경로를 메뉴 키로', () => {
  it.each([
    [`/p/${PID}/dashboard`, 'dashboard'],
    [`/p/${PID}/wbs`, 'wbs'],
    [`/p/${PID}/wbs?view=gantt`, 'wbs'],
    [`/p/${PID}/kanban`, 'kanban'],
    [`/p/${PID}/settings`, 'settings'],
    [`/p/${PID}/wiki/some-topic`, 'wiki'],
    ['/minutes', 'minutes'],
    ['/minutes/abc', 'minutes'],
    ['/meetings', 'my-meetings'],
    ['/projects', 'projects'],
    ['/usage', 'usage'],
    ['/admin/accounts', 'admin-accounts'],
    ['/admin/teams', 'admin-teams'],
    ['/admin/llm-config', 'admin-llm'],
  ])('%s → %s', (path, key) => {
    expect(resolveMenuKey(path)).toBe(key)
  })

  it.each([
    [`/p/${PID}`],
    [`/p/${PID}/무언가새로생긴메뉴`],
    ['/login'],
    ['/'],
    ['/share/minutes/tok'],
  ])('모르는 경로(%s)는 추측하지 않고 unknown', (path) => {
    expect(resolveMenuKey(path)).toBe('unknown')
  })

  it('모든 반환 키는 USAGE_MENUS 에 정의돼 있다', () => {
    const keys = new Set(USAGE_MENUS.map(m => m.key))
    for (const p of [`/p/${PID}/issues`, '/minutes', '/usage', '/nope']) {
      expect(keys.has(resolveMenuKey(p))).toBe(true)
    }
  })
})

describe('드리프트 가드 — 사이드바 메뉴가 전부 해석된다', () => {
  it('Sidebar.tsx 의 프로젝트 메뉴 href 가 하나도 unknown 이 아니다', () => {
    const src = readFileSync(
      new URL('../../src/components/app/Sidebar.tsx', import.meta.url),
      'utf8',
    )
    const segments = [...src.matchAll(/href:\s*`\$\{base\}\/([a-z-]+)`/g)].map(m => m[1])
    expect(segments.length).toBeGreaterThanOrEqual(11) // 현재 11개 — 줄면 정규식이 깨진 것
    for (const seg of segments) {
      expect(resolveMenuKey(`/p/${PID}/${seg}`)).not.toBe('unknown')
    }
  })
})

describe('normalizeUsagePath — UUID 를 지우고 길이를 제한', () => {
  it('UUID 를 :id 로 바꾼다', () => {
    expect(normalizeUsagePath(`/p/${PID}/wbs`)).toBe('/p/:id/wbs')
  })
  it('쿼리스트링과 해시를 버린다', () => {
    expect(normalizeUsagePath(`/p/${PID}/wbs?view=gantt#x`)).toBe('/p/:id/wbs')
  })
  it('200자를 넘기지 않는다', () => {
    expect(normalizeUsagePath('/a' + 'b'.repeat(500)).length).toBe(200)
  })
})

describe('extractProjectId', () => {
  it('프로젝트 스코프 경로에서 id 를 뽑는다', () => {
    expect(extractProjectId(`/p/${PID}/wbs`)).toBe(PID)
  })
  it('전역 경로는 null', () => {
    expect(extractProjectId('/minutes')).toBeNull()
    expect(extractProjectId('/p/not-a-uuid/wbs')).toBeNull()
  })
})

describe('menuLabel', () => {
  it('labelKey 가 있으면 번역기를 쓴다', () => {
    expect(menuLabel('dashboard', () => '번역됨')).toBe('번역됨')
  })
  it('i18n 이 없는 관리자 메뉴는 fallback 을 쓴다', () => {
    expect(menuLabel('admin-accounts', () => '번역됨')).toBe('계정 관리')
  })
  it('정의에 없는 키는 키 자체를 돌려준다(추측 금지)', () => {
    expect(menuLabel('zzz', () => '번역됨')).toBe('zzz')
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run tests/domain/usage-menu.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/usageMenu"`

- [ ] **Step 3: 구현**

`src/lib/domain/usageMenu.ts`:

```ts
import type { DictKey } from '@/lib/i18n/dict'

/**
 * 사용 현황 집계의 메뉴 정본 목록.
 * 사이드바(projectMenu)와 전역 링크를 그대로 반영한다. 여기 없는 경로는 'unknown' 으로
 * 모이며 가까운 메뉴로 추측해 붙이지 않는다(리포의 "모르면 unknown" 관례).
 * labelKey 가 null 인 항목은 i18n 사전이 없는 /admin/* 이다 — 관리자 화면은 한국어 하드코딩.
 */
export interface UsageMenu {
  key: string
  labelKey: DictKey | null
  fallback: string
}

export const USAGE_MENUS: readonly UsageMenu[] = [
  { key: 'dashboard', labelKey: 'nav.dashboard', fallback: '대시보드' },
  { key: 'wbs', labelKey: 'nav.wbsGantt', fallback: 'WBS · 간트' },
  { key: 'kanban', labelKey: 'nav.kanban', fallback: '칸반 보드' },
  { key: 'meetings', labelKey: 'nav.meetings', fallback: '회의일정' },
  { key: 'weekly', labelKey: 'nav.weekly', fallback: '주간업무' },
  { key: 'issues', labelKey: 'nav.issues', fallback: '이슈관리' },
  { key: 'wiki', labelKey: 'nav.wiki', fallback: '프로젝트 Wiki' },
  { key: 'announcements', labelKey: 'nav.announcements', fallback: '공지사항' },
  { key: 'members', labelKey: 'nav.members', fallback: '멤버' },
  { key: 'attendance', labelKey: 'nav.attendance', fallback: '근태현황' },
  { key: 'settings', labelKey: 'nav.settings', fallback: '설정' },
  { key: 'my-meetings', labelKey: 'nav.myMeetings', fallback: '내 회의' },
  { key: 'minutes', labelKey: 'nav.minutes', fallback: '회의록' },
  { key: 'projects', labelKey: 'nav.home', fallback: '홈' },
  { key: 'usage', labelKey: 'nav.usage', fallback: '사용 현황' },
  { key: 'admin-accounts', labelKey: null, fallback: '계정 관리' },
  { key: 'admin-teams', labelKey: null, fallback: '팀 관리' },
  { key: 'admin-llm', labelKey: null, fallback: 'LLM 설정' },
  { key: 'unknown', labelKey: null, fallback: '기타' },
] as const

/** /p/<id>/<seg> 의 seg 로 그대로 쓰는 프로젝트 스코프 키. */
const PROJECT_SEGMENT_KEYS = new Set([
  'dashboard', 'wbs', 'kanban', 'meetings', 'weekly',
  'issues', 'wiki', 'announcements', 'members', 'attendance', 'settings',
])

/** 쿼리스트링·해시·끝 슬래시를 제거한 경로. */
function bare(pathname: string): string {
  const p = pathname.split('?')[0].split('#')[0]
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p
}

/**
 * 경로 → 메뉴 키. 모르면 'unknown'(추측 금지).
 * 신규 메뉴를 사이드바에 추가하고 여기를 안 고치면 tests/domain/usage-menu.test.ts 가 깨진다.
 */
export function resolveMenuKey(pathname: string): string {
  const p = bare(pathname)
  const proj = p.match(/^\/p\/[^/]+\/([^/]+)/)
  if (proj) return PROJECT_SEGMENT_KEYS.has(proj[1]) ? proj[1] : 'unknown'
  if (p === '/projects' || p.startsWith('/projects/')) return 'projects'
  if (p === '/meetings' || p.startsWith('/meetings/')) return 'my-meetings'
  if (p === '/minutes' || p.startsWith('/minutes/')) return 'minutes'
  if (p === '/usage') return 'usage'
  if (p === '/admin/accounts') return 'admin-accounts'
  if (p === '/admin/teams') return 'admin-teams'
  if (p === '/admin/llm-config') return 'admin-llm'
  return 'unknown'
}

/** 저장용 경로 — UUID 를 ':id' 로 접고 200자로 자른다(카디널리티·행 크기 제한). */
export function normalizeUsagePath(pathname: string): string {
  return bare(pathname)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .slice(0, 200)
}

/** 프로젝트 스코프 경로의 프로젝트 id. 전역 경로면 null. */
export function extractProjectId(pathname: string): string | null {
  const m = bare(pathname).match(
    /^\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i,
  )
  return m ? m[1] : null
}

/** 메뉴 키의 표시 라벨. 정의에 없는 키는 키 자체를 돌려준다(임의 한국어 생성 금지). */
export function menuLabel(key: string, translate: (k: DictKey) => string): string {
  const m = USAGE_MENUS.find(x => x.key === key)
  if (!m) return key
  return m.labelKey ? translate(m.labelKey) : m.fallback
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/domain/usage-menu.test.ts`
Expected: PASS

> 참고: `'nav.usage'`는 Task 5에서 사전에 추가한다. 그 전까지는 TypeScript 타입 에러가 날 수 있으나 vitest(oxc)는 타입 검사를 하지 않아 테스트는 통과한다. `npm run build`는 Task 5 이후에 돌린다.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/usageMenu.ts tests/domain/usage-menu.test.ts
git commit -m "$(cat <<'EOF'
feat(usage): 경로→메뉴 키 매퍼 — 사이드바가 바뀌면 테스트가 깨지게 묶었다

집계 축이 '메뉴'인데 정본 목록이 사이드바에만 있으면 메뉴를 추가할 때마다 조용히
'unknown' 으로 새는 데이터가 생긴다. Sidebar.tsx 를 텍스트로 읽어 href 를 뽑고
전부 해석되는지 단언하는 드리프트 가드를 붙였다(tests/migrations 가 쓰는 기법).

Sidebar 를 리팩터링해 배열을 export 하는 방법도 있었지만 UI 위험 파일의 변경 면적을
키우는 쪽이라 택하지 않았다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 수집 on/off 판정 (순수)

**Files:**
- Create: `src/lib/domain/usageTracking.ts`
- Test: `tests/domain/usage-tracking.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `trackingEnabled(env: Record<string, string | undefined>): boolean`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/usage-tracking.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { trackingEnabled } from '@/lib/domain/usageTracking'

describe('trackingEnabled — 로컬 dev 가 프로덕션 DB 를 공유하므로 기본은 프로덕션만', () => {
  it('기본값: 프로덕션에서만 수집한다', () => {
    expect(trackingEnabled({ VERCEL_ENV: 'production' })).toBe(true)
  })

  it.each([
    ['preview', { VERCEL_ENV: 'preview' }],
    ['development', { VERCEL_ENV: 'development' }],
    ['미설정(로컬)', {}],
  ])('%s 에서는 수집하지 않는다', (_name, env) => {
    expect(trackingEnabled(env)).toBe(false)
  })

  it('USAGE_TRACKING=on 이면 로컬에서도 수집한다(명시적 opt-in)', () => {
    expect(trackingEnabled({ USAGE_TRACKING: 'on' })).toBe(true)
  })

  it('USAGE_TRACKING=off 는 프로덕션도 끈다(긴급 차단이 최우선)', () => {
    expect(trackingEnabled({ USAGE_TRACKING: 'off', VERCEL_ENV: 'production' })).toBe(false)
  })

  it('알 수 없는 값은 무시하고 기본 규칙으로 떨어진다', () => {
    expect(trackingEnabled({ USAGE_TRACKING: 'maybe', VERCEL_ENV: 'production' })).toBe(true)
    expect(trackingEnabled({ USAGE_TRACKING: 'maybe' })).toBe(false)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run tests/domain/usage-tracking.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/usageTracking"`

- [ ] **Step 3: 구현**

`src/lib/domain/usageTracking.ts`:

```ts
/**
 * 사용 기록 수집 여부.
 *
 * 로컬 dev 가 프로덕션 Supabase 를 공유하므로(CLAUDE.md) 개발 중 클릭이 그대로 운영
 * 지표에 쌓인다. 그래서 기본값은 "프로덕션에서만". Preview 도 자동으로 제외된다.
 *   USAGE_TRACKING=on   로컬/Preview 검증용 명시적 opt-in
 *   USAGE_TRACKING=off  운영 긴급 차단(다른 무엇보다 우선)
 */
export function trackingEnabled(env: Record<string, string | undefined>): boolean {
  if (env.USAGE_TRACKING === 'off') return false
  if (env.USAGE_TRACKING === 'on') return true
  return env.VERCEL_ENV === 'production'
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/domain/usage-tracking.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/usageTracking.ts tests/domain/usage-tracking.test.ts
git commit -m "$(cat <<'EOF'
feat(usage): 수집 on/off 판정 — 로컬 dev 가 운영 DB 를 공유한다는 전제에서 나온 기본값

이 리포는 로컬 개발도 프로덕션 Supabase 를 본다. 수집기를 켠 채 개발하면 내 클릭이
그대로 전사 지표에 섞인다. 그래서 기본값을 'VERCEL_ENV=production 일 때만' 으로 두고,
로컬 검증은 USAGE_TRACKING=on 으로 명시적으로만 열리게 했다.

off 를 on 보다 먼저 판정하는 이유는 운영 중 긴급 차단이 다른 어떤 설정보다 우선해야
하기 때문이다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 집계 순수 함수

**Files:**
- Create: `src/lib/domain/usage.ts`
- Test: `tests/domain/usage.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `const USAGE_RETAIN_DAYS = 90`, `const SESSION_GAP_MINUTES = 30`, `const PERIOD_OPTIONS = [7, 30, 90]`
  - `interface UsageSummary { totalEvents: number; activeUsers: number; todayUsers: number; lastEventAt: string | null }`
  - `interface DailyActive { d: string; activeUsers: number; events: number }`
  - `interface MenuRank { menuKey: string; events: number; activeUsers: number }`
  - `interface UserRollup { userId: string; events: number; activeDays: number; lastAt: string | null }`
  - `interface AccountRecord { id: string; email: string; name: string; teamCode: string | null; role: string | null; createdAt: string; lastSignInAt: string | null }`
  - `interface UsageUserRow extends AccountRecord { events: number; activeDays: number; lastActivityAt: string | null }`
  - `addDaysIso(dateIso: string, days: number): string`
  - `parsePeriodDays(raw: string | undefined): number`
  - `fillDailySeries(rows: DailyActive[], from: string, to: string): DailyActive[]`
  - `mergeUserRows(accounts: AccountRecord[], rollups: UserRollup[]): UsageUserRow[]`
  - `countSessions(timestampsIso: string[], gapMinutes?: number): number`
  - `barPct(value: number, max: number): number`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/usage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  addDaysIso, parsePeriodDays, fillDailySeries, mergeUserRows, countSessions, barPct,
  SESSION_GAP_MINUTES, type AccountRecord, type UserRollup,
} from '@/lib/domain/usage'

describe('addDaysIso', () => {
  it('월·연 경계를 넘는다', () => {
    expect(addDaysIso('2026-07-30', 3)).toBe('2026-08-02')
    expect(addDaysIso('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDaysIso('2026-07-30', 0)).toBe('2026-07-30')
  })
})

describe('parsePeriodDays — 신뢰할 수 없는 쿼리스트링', () => {
  it('허용된 값만 통과', () => {
    expect(parsePeriodDays('7')).toBe(7)
    expect(parsePeriodDays('90')).toBe(90)
  })
  it('그 외는 기본 30일', () => {
    for (const v of [undefined, '', '31', 'abc', '-7', '99999']) {
      expect(parsePeriodDays(v)).toBe(30)
    }
  })
})

describe('fillDailySeries — 빈 날짜를 0으로 메운다', () => {
  it('구간 전체 길이를 보장하고 순서를 맞춘다', () => {
    const out = fillDailySeries(
      [{ d: '2026-07-30', activeUsers: 3, events: 12 }],
      '2026-07-28', '2026-07-31',
    )
    expect(out.map(r => r.d)).toEqual(['2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'])
    expect(out.map(r => r.activeUsers)).toEqual([0, 0, 3, 0])
    expect(out.map(r => r.events)).toEqual([0, 0, 12, 0])
  })

  it('데이터가 하나도 없어도 구간 길이만큼 0을 만든다', () => {
    expect(fillDailySeries([], '2026-07-30', '2026-07-31')).toHaveLength(2)
  })

  it('구간 밖 데이터는 버린다', () => {
    const out = fillDailySeries(
      [{ d: '2026-01-01', activeUsers: 9, events: 9 }],
      '2026-07-30', '2026-07-30',
    )
    expect(out).toEqual([{ d: '2026-07-30', activeUsers: 0, events: 0 }])
  })
})

const ACC = (id: string, name: string): AccountRecord => ({
  id, email: `${id}@x.com`, name, teamCode: 'PMO', role: 'team_editor',
  createdAt: '2026-01-01T00:00:00Z', lastSignInAt: null,
})

describe('mergeUserRows — 활동이 0인 계정도 사라지지 않는다', () => {
  const accounts = [ACC('u1', '가나'), ACC('u2', '다라'), ACC('u3', '마바')]
  const rollups: UserRollup[] = [
    { userId: 'u2', events: 40, activeDays: 5, lastAt: '2026-07-30T01:00:00Z' },
    { userId: 'u1', events: 10, activeDays: 2, lastAt: '2026-07-29T01:00:00Z' },
  ]

  it('계정 전체를 유지하고 활동 없는 계정은 0/null 로 채운다', () => {
    const rows = mergeUserRows(accounts, rollups)
    expect(rows).toHaveLength(3)
    const u3 = rows.find(r => r.id === 'u3')!
    expect(u3.events).toBe(0)
    expect(u3.activeDays).toBe(0)
    expect(u3.lastActivityAt).toBeNull()
  })

  it('조회수 내림차순, 동률이면 이름순', () => {
    expect(mergeUserRows(accounts, rollups).map(r => r.id)).toEqual(['u2', 'u1', 'u3'])
  })

  it('계정 목록에 없는 롤업(탈퇴 직후 등)은 버리지 않고 무시한다 — 행 수는 계정 수', () => {
    const rows = mergeUserRows(accounts, [
      ...rollups, { userId: 'ghost', events: 999, activeDays: 9, lastAt: null },
    ])
    expect(rows).toHaveLength(3)
    expect(rows.some(r => r.id === 'ghost')).toBe(false)
  })
})

describe('countSessions — 로그인 이벤트가 없으므로 무활동 간격으로 유도한다', () => {
  it('기본 간격은 30분', () => {
    expect(SESSION_GAP_MINUTES).toBe(30)
  })

  it('간격 이내 연속 이벤트는 한 접속', () => {
    expect(countSessions([
      '2026-07-30T01:00:00Z', '2026-07-30T01:20:00Z', '2026-07-30T01:45:00Z',
    ])).toBe(1)
  })

  it('간격을 넘으면 새 접속', () => {
    expect(countSessions([
      '2026-07-30T01:00:00Z', '2026-07-30T02:00:00Z', '2026-07-30T02:10:00Z',
    ])).toBe(2)
  })

  it('정확히 경계값(30분)은 같은 접속으로 본다', () => {
    expect(countSessions(['2026-07-30T01:00:00Z', '2026-07-30T01:30:00Z'])).toBe(1)
  })

  it('순서가 뒤섞여 들어와도 정렬해서 센다', () => {
    expect(countSessions(['2026-07-30T02:00:00Z', '2026-07-30T01:00:00Z'])).toBe(2)
  })

  it('빈 입력은 0', () => {
    expect(countSessions([])).toBe(0)
  })
})

describe('barPct — 막대 길이', () => {
  it('최대값 대비 비율(소수 1자리)', () => {
    expect(barPct(5, 20)).toBe(25)
    expect(barPct(1, 3)).toBe(33.3)
  })
  it('최대가 0이면 0 (0으로 나누지 않는다)', () => {
    expect(barPct(0, 0)).toBe(0)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run tests/domain/usage.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/usage"`

- [ ] **Step 3: 구현**

`src/lib/domain/usage.ts`:

```ts
import { round1 } from './format'

/** 원시 이벤트 보존 기간(일). 이 값을 넘긴 행은 /usage 조회 시 정리된다. */
export const USAGE_RETAIN_DAYS = 90

/**
 * 접속 1회로 묶는 무활동 간격(분).
 * 로그인은 클라이언트에서 signInWithPassword() 로 처리돼 서버에 기록이 남지 않는다.
 * 그래서 '접속 횟수'는 관측값이 아니라 이 간격으로 유도한 값이며, 화면에 그 사실을 밝힌다.
 */
export const SESSION_GAP_MINUTES = 30

/** 기간 선택지(일). */
export const PERIOD_OPTIONS = [7, 30, 90] as const

export interface UsageSummary {
  totalEvents: number
  activeUsers: number
  todayUsers: number
  /** 전체 기간 기준 마지막 이벤트 — 수집이 끊겼는지 판정하는 근거. */
  lastEventAt: string | null
}

export interface DailyActive { d: string; activeUsers: number; events: number }
export interface MenuRank { menuKey: string; events: number; activeUsers: number }
export interface UserRollup { userId: string; events: number; activeDays: number; lastAt: string | null }

export interface AccountRecord {
  id: string
  email: string
  name: string
  teamCode: string | null
  role: string | null
  createdAt: string
  /** auth.users.last_sign_in_at — 수집 시작 이전까지 소급되는 유일한 데이터. */
  lastSignInAt: string | null
}

export interface UsageUserRow extends AccountRecord {
  events: number
  activeDays: number
  lastActivityAt: string | null
}

/** 'YYYY-MM-DD' + n일. Date.UTC 가 월/연 경계를 자동 처리. */
export function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  const pad2 = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`
}

/** 쿼리스트링은 신뢰할 수 없다 — 허용 목록에 없으면 기본 30일. */
export function parsePeriodDays(raw: string | undefined): number {
  const n = Number(raw)
  return (PERIOD_OPTIONS as readonly number[]).includes(n) ? n : 30
}

/**
 * 구간의 모든 날짜를 만들고 데이터가 없는 날은 0으로 채운다.
 * 채우지 않으면 접속이 없던 날이 차트에서 사라져 추세선이 실제보다 촘촘해 보인다.
 */
export function fillDailySeries(rows: DailyActive[], from: string, to: string): DailyActive[] {
  const byDate = new Map(rows.map(r => [r.d, r]))
  const out: DailyActive[] = []
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    out.push(byDate.get(d) ?? { d, activeUsers: 0, events: 0 })
  }
  return out
}

/**
 * 계정 목록(좌) + 활동 롤업(우) 좌외부조인.
 * 계정 기준이라 활동이 0인 휴면 계정도 표에서 사라지지 않는다 — "안 쓰는 사람"이
 * 이 화면의 핵심 정보이기 때문이다. 계정에 없는 롤업(탈퇴 직후 등)은 무시한다.
 */
export function mergeUserRows(accounts: AccountRecord[], rollups: UserRollup[]): UsageUserRow[] {
  const byUser = new Map(rollups.map(r => [r.userId, r]))
  return accounts
    .map<UsageUserRow>(a => {
      const r = byUser.get(a.id)
      return {
        ...a,
        events: r?.events ?? 0,
        activeDays: r?.activeDays ?? 0,
        lastActivityAt: r?.lastAt ?? null,
      }
    })
    .sort((x, y) => y.events - x.events || x.name.localeCompare(y.name, 'ko'))
}

/** 무활동 간격이 gapMinutes 를 넘을 때마다 새 접속으로 센다. 경계값은 같은 접속. */
export function countSessions(timestampsIso: string[], gapMinutes = SESSION_GAP_MINUTES): number {
  if (timestampsIso.length === 0) return 0
  const ms = timestampsIso.map(t => new Date(t).getTime()).sort((a, b) => a - b)
  const gap = gapMinutes * 60_000
  let sessions = 1
  for (let i = 1; i < ms.length; i++) {
    if (ms[i] - ms[i - 1] > gap) sessions++
  }
  return sessions
}

/** 최대값 대비 막대 길이(%). 최대가 0이면 0 — 0으로 나누지 않는다. */
export function barPct(value: number, max: number): number {
  return max <= 0 ? 0 : round1((value / max) * 100)
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/domain/usage.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/usage.ts tests/domain/usage.test.ts
git commit -m "$(cat <<'EOF'
feat(usage): 집계 순수 함수 — 활동 0인 계정을 표에서 지우지 않기 위한 좌외부조인

mergeUserRows 를 롤업 기준이 아니라 계정 기준으로 짠 이유는, '안 쓰는 사람'이
이 화면의 핵심 정보이기 때문이다. 롤업 기준으로 하면 한 번도 안 들어온 계정이
표에서 아예 사라져 "전원 사용 중"처럼 보인다.

fillDailySeries 도 같은 이유다 — 접속 없던 날을 빼면 추세선이 실제보다 촘촘해진다.

countSessions 는 유도값이다. 로그인이 클라이언트 signInWithPassword 라 서버에
기록이 없어서, 30분 무활동을 경계로 접속을 나눈다. 화면에도 그 기준을 밝힌다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 권한 판정 + i18n 키

**Files:**
- Create: `src/lib/authz/usageAccess.ts`
- Modify: `src/lib/i18n/dict/common.ts` (`'nav.settings'` 항목 바로 아래에 ko/en 각각 1줄 추가)
- Test: `tests/domain/usage-access.test.ts`

**Interfaces:**
- Consumes: `Membership` from `@/lib/domain/types`
- Produces: `canViewUsage(m: Membership | null): boolean`, 사전 키 `'nav.usage'`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/usage-access.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { canViewUsage } from '@/lib/authz/usageAccess'
import { DICT } from '@/lib/i18n/dict'

describe('canViewUsage — 지금은 전원 공개(요구사항)', () => {
  it.each([
    ['pmo_admin', { role: 'pmo_admin', teamCode: 'PMO', teamId: 't1' }],
    ['team_editor', { role: 'team_editor', teamCode: 'ERP', teamId: 't2' }],
  ])('%s 는 볼 수 있다', (_n, m) => {
    expect(canViewUsage(m as never)).toBe(true)
  })

  it('멤버십이 없어도(조회 실패 포함) 볼 수 있다 — 이 단계의 명시적 결정', () => {
    expect(canViewUsage(null)).toBe(true)
  })
})

describe('nav.usage 사전 키', () => {
  it('ko/en 양쪽에 있다', () => {
    expect(DICT.ko['nav.usage']).toBe('사용 현황')
    expect(DICT.en['nav.usage']).toBe('Usage')
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run tests/domain/usage-access.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/authz/usageAccess"`

- [ ] **Step 3: 구현**

`src/lib/authz/usageAccess.ts`:

```ts
import type { Membership } from '@/lib/domain/types'

/**
 * 사용 현황(/usage) 열람 권한 — 판정을 여기 한 곳에만 둔다.
 *
 * 현재는 전원 공개다(요구사항: "지금 구현 단계에서는 일단 다 볼 수 있게").
 * 관리자 전용으로 전환할 때 바꿀 곳은 이 함수와 0051 의 read_usage_events 정책,
 * 두 군데뿐이다.
 *
 * 주의: 전환 시 `m?.role === 'pmo_admin'` 으로 두면 실질적 관리자 전용이 아니다 —
 * 2026-07-30 기준 41계정 중 28명(68%)이 pmo_admin 이다. 진행 중인 권한 3단
 * 재설계(is_superuser)가 들어온 뒤 그 축에 거는 것을 전제로 한다.
 */
export function canViewUsage(_m: Membership | null): boolean {
  return true
}
```

`src/lib/i18n/dict/common.ts` — `commonKo`의 `'nav.settings': '설정',` 바로 다음 줄에 추가:

```ts
  'nav.usage': '사용 현황',
```

`commonEn`의 `'nav.settings': 'Settings',` 바로 다음 줄에 추가:

```ts
  'nav.usage': 'Usage',
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/domain/usage-access.test.ts tests/domain/usage-menu.test.ts`
Expected: PASS (두 파일 모두)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/authz/usageAccess.ts src/lib/i18n/dict/common.ts tests/domain/usage-access.test.ts
git commit -m "$(cat <<'EOF'
feat(usage): 열람 권한을 한 함수로 모으고 nav.usage 사전 추가

지금은 전원 공개가 요구사항이지만, 그걸 페이지 안에 return true 로 흩어 두면
나중에 잠글 때 빠뜨리는 곳이 생긴다. canViewUsage 하나만 보게 해서 전환 지점을
'이 함수 + RLS 정책' 두 군데로 고정했다.

전환할 때 pmo_admin 으로 거는 것이 관리자 전용이 아니라는 사실(41명 중 28명)을
함수 주석에 박아 둔다 — 그때 가서 다시 조사하지 않도록.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 데이터 계층 (RPC 조회·계정 디렉터리·보존기간 정리)

**Files:**
- Create: `src/lib/data/usage.ts`

**Interfaces:**
- Consumes: Task 1의 RPC 4종, Task 4의 타입, Task 5의 `canViewUsage`
- Produces:
  - `getUsageSummary(from: string, to: string, today: string): Promise<UsageSummary>`
  - `getDailyActives(from: string, to: string): Promise<DailyActive[]>`
  - `getMenuRanking(from: string, to: string): Promise<MenuRank[]>`
  - `getUserRollup(from: string, to: string): Promise<UserRollup[]>`
  - `getRecentUsageEvents(o: { from: string; to: string; userId?: string; menuKey?: string; limit: number }): Promise<UsageEventRow[]>`
  - `getUsageDirectory(): Promise<AccountRecord[]>`
  - `purgeOldUsageEvents(): Promise<void>`
  - `interface UsageEventRow { id: number; userId: string; menuKey: string; path: string; occurredAt: string }`

- [ ] **Step 1: 구현**

> 이 태스크는 순수 I/O 래퍼라 단위 테스트를 두지 않는다(리포의 `src/lib/data/*`도 동일 — `tests/repositories/`는 인터페이스 계약만 검사한다). 계약은 Task 1의 마이그레이션 테스트와 Task 9의 화면이 검증한다.

`src/lib/data/usage.ts`:

```ts
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMembership } from '@/lib/auth'
import { canViewUsage } from '@/lib/authz/usageAccess'
import { displayNameFrom } from '@/lib/domain/display-name'
import {
  USAGE_RETAIN_DAYS, addDaysIso,
  type AccountRecord, type DailyActive, type MenuRank, type UsageSummary, type UserRollup,
} from '@/lib/domain/usage'

export interface UsageEventRow {
  id: number
  userId: string
  menuKey: string
  path: string
  occurredAt: string
}

/** KST 일자 경계를 timestamptz 문자열로. RPC 의 범위 조건과 같은 기준을 쓴다. */
function kstStart(dateIso: string): string {
  return `${dateIso}T00:00:00+09:00`
}

export async function getUsageSummary(from: string, to: string, today: string): Promise<UsageSummary> {
  const sb = await createServerClient()
  const { data, error } = await sb.rpc('usage_summary', { p_from: from, p_to: to, p_today: today })
  // 요약 실패를 0으로 표시하면 '아무도 안 썼다'와 '집계가 깨졌다'가 화면에서 같아 보인다.
  if (error) throw new Error('사용 현황 요약을 불러오지 못했습니다: ' + error.message)
  const row = (data as Record<string, unknown>[] | null)?.[0]
  return {
    totalEvents: Number(row?.total_events ?? 0),
    activeUsers: Number(row?.active_users ?? 0),
    todayUsers: Number(row?.today_users ?? 0),
    lastEventAt: (row?.last_event_at as string | null) ?? null,
  }
}

export async function getDailyActives(from: string, to: string): Promise<DailyActive[]> {
  const sb = await createServerClient()
  const { data, error } = await sb.rpc('usage_daily_actives', { p_from: from, p_to: to })
  if (error) throw new Error('일별 활성 사용자를 불러오지 못했습니다: ' + error.message)
  return (data as Record<string, unknown>[] ?? []).map(r => ({
    d: r.d as string,
    activeUsers: Number(r.active_users),
    events: Number(r.events),
  }))
}

export async function getMenuRanking(from: string, to: string): Promise<MenuRank[]> {
  const sb = await createServerClient()
  const { data, error } = await sb.rpc('usage_menu_ranking', { p_from: from, p_to: to })
  if (error) throw new Error('메뉴 사용량을 불러오지 못했습니다: ' + error.message)
  return (data as Record<string, unknown>[] ?? []).map(r => ({
    menuKey: r.menu_key as string,
    events: Number(r.events),
    activeUsers: Number(r.active_users),
  }))
}

export async function getUserRollup(from: string, to: string): Promise<UserRollup[]> {
  const sb = await createServerClient()
  const { data, error } = await sb.rpc('usage_user_rollup', { p_from: from, p_to: to })
  if (error) throw new Error('사용자별 활동을 불러오지 못했습니다: ' + error.message)
  return (data as Record<string, unknown>[] ?? []).map(r => ({
    userId: r.user_id as string,
    events: Number(r.events),
    activeDays: Number(r.active_days),
    lastAt: (r.last_at as string | null) ?? null,
  }))
}

export async function getRecentUsageEvents(o: {
  from: string; to: string; userId?: string; menuKey?: string; limit: number
}): Promise<UsageEventRow[]> {
  const sb = await createServerClient()
  let q = sb
    .from('usage_events')
    .select('id, user_id, menu_key, path, occurred_at')
    .gte('occurred_at', kstStart(o.from))
    .lt('occurred_at', kstStart(addDaysIso(o.to, 1)))
    .order('occurred_at', { ascending: false })
    .limit(o.limit)
  if (o.userId) q = q.eq('user_id', o.userId)
  if (o.menuKey) q = q.eq('menu_key', o.menuKey)

  const { data, error } = await q
  if (error) throw new Error('접속 로그를 불러오지 못했습니다: ' + error.message)
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: Number(r.id),
    userId: r.user_id as string,
    menuKey: r.menu_key as string,
    path: r.path as string,
    occurredAt: r.occurred_at as string,
  }))
}

/**
 * 계정 디렉터리 — auth.users + memberships/teams.
 *
 * service_role 로 auth.users 를 읽으므로 이 함수 자체가 게이트를 다시 검사한다(fail-closed).
 * 화면의 redirect 는 UX 이고, 실제 방어선은 여기다.
 * last_sign_in_at 은 GoTrue 가 계속 채워온 값이라 수집 시작 이전까지 소급되는 유일한 데이터다.
 */
export async function getUsageDirectory(): Promise<AccountRecord[]> {
  if (!canViewUsage(await getMembership())) {
    throw new Error('사용 현황을 볼 권한이 없습니다.')
  }
  const admin = createAdminClient()

  type Raw = { id: string; email: string; created_at: string; last_sign_in_at: string | null; meta: Record<string, unknown> }
  const users: Raw[] = []
  const perPage = 200
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    // 지금까지 모은 페이지만 반환하면 '잘린 목록'이 완전한 목록처럼 보인다 —
    // 빠진 계정은 '한 번도 안 들어온 사람'과 구별되지 않는다. listAccounts 와 같은 fail-loud.
    if (error || !data) {
      throw new Error(`계정 목록을 불러오지 못했습니다(page=${page}): ${error?.message ?? 'unknown'}`)
    }
    for (const u of data.users) {
      users.push({
        id: u.id,
        email: u.email ?? '',
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        meta: (u.user_metadata ?? {}) as Record<string, unknown>,
      })
    }
    if (data.users.length < perPage) break
  }

  const { data: mems, error: memsErr } = await admin
    .from('memberships')
    .select('user_id, role, teams(code)')
  // 조회 실패를 '멤버십 없음'으로 폴백하면 전원이 '팀 없음/권한 없음'으로 렌더링된다.
  if (memsErr || !mems) {
    throw new Error('계정 권한 정보를 불러오지 못했습니다: ' + (memsErr?.message ?? 'unknown'))
  }
  const byUser = new Map<string, { role: string; teamCode: string | null }>()
  for (const row of mems as Record<string, unknown>[]) {
    const team = row.teams as { code: string } | null
    byUser.set(row.user_id as string, { role: row.role as string, teamCode: team?.code ?? null })
  }

  return users.map<AccountRecord>(u => ({
    id: u.id,
    email: u.email,
    name: displayNameFrom(u.meta, u.email) ?? u.email,
    teamCode: byUser.get(u.id)?.teamCode ?? null,
    role: byUser.get(u.id)?.role ?? null,
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at,
  }))
}

/**
 * 보존 기간 정리 — /usage 렌더의 after() 에서 호출한다("조회가 쓰기를 유발"하는
 * recordProgressSnapshot 선례와 동형). 크론 슬롯은 wiki worker 가 이미 쓰고 있고
 * 이 정리는 지연에 민감하지 않다.
 *
 * 쿨다운 상태가 인스턴스 메모리라 서버리스 다중 인스턴스에서 완전 직렬화되지 않는다 —
 * 최악은 삭제 쿼리 중복 실행이며 멱등이므로 수용한다(createEnsureGate 와 같은 판단).
 * 정리 실패가 화면을 깨면 안 되므로 절대 throw 하지 않되, 반드시 로그로 남긴다.
 */
let lastPurgeAt = 0
const PURGE_COOLDOWN_MS = 24 * 60 * 60 * 1000

export async function purgeOldUsageEvents(): Promise<void> {
  if (Date.now() - lastPurgeAt < PURGE_COOLDOWN_MS) return
  lastPurgeAt = Date.now()
  try {
    const cutoff = new Date(Date.now() - USAGE_RETAIN_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const admin = createAdminClient()
    const { error } = await admin.from('usage_events').delete().lt('occurred_at', cutoff)
    if (error) console.error('[usage] 보존기간 정리 실패:', error.message)
  } catch (e) {
    console.error('[usage] 보존기간 정리 예외:', e instanceof Error ? e.message : e)
  }
}
```

- [ ] **Step 2: 타입 확인**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 이 파일에 대한 에러 없음 (`src/app/(app)/usage`는 아직 없으므로 다른 에러도 없어야 한다)

- [ ] **Step 3: 커밋**

```bash
git add src/lib/data/usage.ts
git commit -m "$(cat <<'EOF'
feat(usage): 데이터 계층 — 조회 실패를 0으로 위장하지 않는다

이 화면은 '아무도 안 썼다'와 '집계가 깨졌다'가 육안으로 같아 보이는 대표 사례라
집계 조회는 전부 throw 로 올린다. listUsers 페이지네이션도 중간 실패 시 모은 것만
돌려주지 않는다 — 빠진 계정이 '한 번도 안 들어온 사람'과 구별되지 않기 때문이다.

getUsageDirectory 는 service_role 로 auth.users 를 읽으므로 함수 자체가 게이트를
다시 본다. 페이지의 redirect 는 UX 이고 실제 방어선은 여기다.

보존기간 정리만 예외적으로 never-throw — 정리 실패가 화면을 깨면 안 된다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 수집 엔드포인트 `/api/track`

**Files:**
- Create: `src/app/api/track/route.ts`
- Test: `tests/actions/usage-track-gate.test.ts`

**Interfaces:**
- Consumes: `trackingEnabled`(Task 3), `resolveMenuKey`/`normalizeUsagePath`/`extractProjectId`(Task 2)
- Produces: `POST /api/track` — 본문 `{ path: string }`, 응답 `{ ok: true } | { ok: true, skipped: 'disabled' } | { error: string }`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/actions/usage-track-gate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 게이트를 통과하기 전에는 service_role 클라이언트가 만들어지면 안 된다.
const insert = vi.hoisted(() => vi.fn(async () => ({ error: null })))
const { createAdminClient } = vi.hoisted(() => ({
  createAdminClient: vi.fn(() => ({ from: () => ({ insert }) })),
}))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock } })),
}))
const getClaimsMock = vi.hoisted(() => vi.fn(async () => ({ data: null })))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { POST } from '@/app/api/track/route'

const PID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const req = (body: unknown) =>
  new Request('http://localhost/api/track', { method: 'POST', body: JSON.stringify(body) }) as never

beforeEach(() => {
  insert.mockClear()
  createAdminClient.mockClear()
  getClaimsMock.mockReset()
  process.env.USAGE_TRACKING = 'on'
})
afterEach(() => { delete process.env.USAGE_TRACKING })

describe('수집 게이트', () => {
  it('수집이 꺼져 있으면 DB 에 접근하지 않는다', async () => {
    process.env.USAGE_TRACKING = 'off'
    const res = await POST(req({ path: '/minutes' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ skipped: 'disabled' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('미인증이면 401 이고 DB 에 접근하지 않는다', async () => {
    getClaimsMock.mockResolvedValue({ data: null })
    const res = await POST(req({ path: '/minutes' }))
    expect(res.status).toBe(401)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it.each([
    ['path 없음', {}],
    ['path 가 문자열이 아님', { path: 42 }],
    ['슬래시로 시작하지 않음', { path: 'https://evil.example/x' }],
    ['너무 김', { path: '/' + 'a'.repeat(600) }],
  ])('잘못된 본문(%s)은 400 이고 DB 에 접근하지 않는다', async (_n, body) => {
    getClaimsMock.mockResolvedValue({ data: { claims: { sub: 'u1' } } })
    const res = await POST(req(body))
    expect(res.status).toBe(400)
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})

describe('기록 내용 — 본문을 신뢰하지 않는다', () => {
  beforeEach(() => { getClaimsMock.mockResolvedValue({ data: { claims: { sub: 'real-user' } } }) })

  it('사용자 id 는 쿠키의 것을 쓰고 본문의 user_id 는 무시한다', async () => {
    const res = await POST(req({ path: '/minutes', user_id: 'spoofed', menu_key: 'spoofed' }))
    expect(res.status).toBe(200)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'real-user',
      menu_key: 'minutes',
    }))
  })

  it('경로에서 메뉴 키·프로젝트 id 를 서버가 판정하고 UUID 를 정규화한다', async () => {
    await POST(req({ path: `/p/${PID}/wbs?view=gantt` }))
    expect(insert).toHaveBeenCalledWith({
      user_id: 'real-user',
      menu_key: 'wbs',
      path: '/p/:id/wbs',
      project_id: PID,
    })
  })

  it('insert 실패는 삼키지 않고 500 으로 올린다', async () => {
    insert.mockResolvedValueOnce({ error: { message: 'boom' } } as never)
    const res = await POST(req({ path: '/minutes' }))
    expect(res.status).toBe(500)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run tests/actions/usage-track-gate.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/track/route"`

- [ ] **Step 3: 구현**

`src/app/api/track/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { trackingEnabled } from '@/lib/domain/usageTracking'
import { extractProjectId, normalizeUsagePath, resolveMenuKey } from '@/lib/domain/usageMenu'

export const dynamic = 'force-dynamic'

/** 경로 길이 상한 — 정상 라우트는 200자를 넘지 않는다. 그 이상은 잡음이거나 공격이다. */
const MAX_PATH_LEN = 512

/**
 * 사용 기록 수집 — 라우트 전환 1건당 1행.
 *
 * /api/** 는 middleware matcher 밖이라 여기서 직접 인증한다.
 * 본문은 경로만 받는다: 사용자 id·메뉴 키·프로젝트 id 는 전부 서버가 판정한다.
 * 클라이언트가 보낸 식별자를 그대로 쓰면 남의 이름으로 기록을 남길 수 있다.
 */
export async function POST(req: NextRequest) {
  if (!trackingEnabled(process.env)) {
    return NextResponse.json({ ok: true, skipped: 'disabled' })
  }

  const sb = await createServerClient()
  const { data } = await sb.auth.getClaims()
  const uid = data?.claims?.sub as string | undefined
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { path?: unknown } | null
  const path = typeof body?.path === 'string' ? body.path : null
  if (!path || !path.startsWith('/') || path.length > MAX_PATH_LEN) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('usage_events').insert({
    user_id: uid,
    menu_key: resolveMenuKey(path),
    path: normalizeUsagePath(path),
    project_id: extractProjectId(path),
  })
  if (error) {
    // 조용히 삼키면 수집이 끊긴 것을 아무도 모른다. 화면의 '수집 상태'와 이 로그가 짝이다.
    console.error('[usage] 이벤트 기록 실패:', error.message)
    return NextResponse.json({ error: 'insert failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/actions/usage-track-gate.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/track/route.ts tests/actions/usage-track-gate.test.ts
git commit -m "$(cat <<'EOF'
feat(usage): 수집 엔드포인트 — 본문에서 받는 것은 경로뿐이다

사용자 id·메뉴 키·프로젝트 id 를 전부 서버가 판정한다. 클라이언트가 보낸 식별자를
그대로 쓰면 남의 이름으로 접속 기록을 남길 수 있고, 이 화면은 그걸 사실처럼 보여준다.

/api/** 는 middleware matcher 밖이라 이 라우트가 스스로 인증한다. 게이트 순서를
env → 인증 → 검증 → 기록으로 고정하고, 테스트가 각 단계에서 service_role 클라이언트가
만들어지지 않는지 확인한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 클라이언트 비콘 + 사이드바 링크

**Files:**
- Create: `src/components/app/UsageTracker.tsx`
- Modify: `src/app/(app)/layout.tsx` (import 추가 + `<PrefsSync />` 다음 줄에 `<UsageTracker />`)
- Modify: `src/components/app/Sidebar.tsx` (lucide `BarChart3` import, `projectMenu()` 배열 끝에 1항목, 프로젝트 미선택 분기에 링크 1개)

**Interfaces:**
- Consumes: `POST /api/track`(Task 7), 사전 키 `'nav.usage'`(Task 5)
- Produces: `<UsageTracker />` (렌더 출력 없음), 사이드바 `/usage` 진입점

- [ ] **Step 1: `UsageTracker` 작성**

`src/components/app/UsageTracker.tsx`:

```tsx
'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

/** 같은 경로 재전송 억제(ms) — StrictMode 이중 실행과 리렌더 중복을 함께 막는다. */
const REPEAT_COOLDOWN_MS = 10_000

/**
 * 라우트 전환 1건당 사용 기록 1행. 렌더 출력 없음(PrefsSync 와 같은 형태).
 *
 * 미들웨어가 아니라 여기서 잡는 이유: middleware 는 getClaims() 로 클릭당 100~180ms 를
 * 아끼는 성능 급소이고 /api/**·/share/** 를 matcher 에서 제외해 커버리지도 반쪽이다.
 * keepalive 로 보내 라우트 전환·탭 종료 중에도 전송이 끊기지 않는다.
 * 실패는 삼키되 사용자 이동을 막지 않는다 — 수집 중단은 /usage 의 '수집 상태'에 드러난다.
 */
export function UsageTracker() {
  const pathname = usePathname()
  const last = useRef<{ path: string; at: number } | null>(null)

  useEffect(() => {
    if (!pathname) return
    const now = Date.now()
    if (last.current && last.current.path === pathname && now - last.current.at < REPEAT_COOLDOWN_MS) return
    last.current = { path: pathname, at: now }
    void fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pathname }),
      keepalive: true,
    }).catch(() => {})
  }, [pathname])

  return null
}
```

- [ ] **Step 2: 레이아웃에 마운트**

`src/app/(app)/layout.tsx` — import 블록의 `PrefsSync` 다음 줄에:

```ts
import { UsageTracker } from '@/components/app/UsageTracker'
```

그리고 JSX 의 `<PrefsSync />` 바로 다음 줄에:

```tsx
            <UsageTracker />
```

- [ ] **Step 3: 사이드바에 링크 추가**

`src/components/app/Sidebar.tsx`:

(a) lucide import 목록에 `BarChart3` 추가 — 알파벳 순서상 `ArrowLeft,` 다음:

```ts
  ArrowLeft, BarChart3, BookOpenText, CalendarCheck, CalendarClock, CalendarRange, CircleAlert, Columns3, FolderOpen, LayoutDashboard, LayoutGrid,
```

(b) `projectMenu()` 배열의 `settings` 항목 다음(배열 마지막)에:

```ts
    // 사용 현황은 전사 지표(접속·메뉴 사용량)라 프로젝트 스코프가 아니다 —
    // 요구대로 설정 바로 아래에 두되 링크는 전역 /usage 로 보낸다.
    { href: '/usage', labelKey: 'nav.usage', icon: BarChart3, match: '/usage' },
```

(c) 프로젝트 미선택 분기(`) : (` 이후 `nav.allProjects` 링크 다음)에 같은 진입점 추가 — 프로젝트를 고르지 않은 상태에서도 사용 현황에 갈 수 있어야 한다:

```tsx
                <Tooltip label={t('nav.usage')} side="right" disabled={!collapsed}>
                  <Link href="/usage" className={`side-link ${pathname === '/usage' ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
                    <BarChart3 className="h-[18px] w-[18px] shrink-0" />{!collapsed && <span className="flex-1">{t('nav.usage')}</span>}
                  </Link>
                </Tooltip>
```

- [ ] **Step 4: 드리프트 가드가 여전히 통과하는지 확인**

Run: `npx vitest run tests/domain/usage-menu.test.ts tests/css/`
Expected: PASS — 드리프트 가드 정규식은 `` `${base}/…` `` 형태만 잡으므로 새 전역 항목(`'/usage'`)은 세지 않는다. CSS 안전망 테스트도 통과해야 한다(사이드바에 상태 변형 display 유틸을 넣지 않았다).

- [ ] **Step 5: 커밋**

```bash
git add src/components/app/UsageTracker.tsx src/components/app/Sidebar.tsx "src/app/(app)/layout.tsx"
git commit -m "$(cat <<'EOF'
feat(usage): 라우트 전환 비콘과 사이드바 진입점

수집 지점을 미들웨어가 아니라 앱 레이아웃의 클라이언트 컴포넌트로 잡았다.
middleware 는 getClaims() 로 클릭당 100~180ms 를 아끼는 성능 급소이고 matcher 가
/api/**·/share/** 를 빼서 커버리지도 반쪽이다. PrefsSync 와 같은 자리, 같은 형태다.

메뉴는 요구대로 '설정' 바로 아래에 두되 링크는 전역 /usage 로 보낸다 — 접속·사용량은
프로젝트로 쪼개면 의미가 왜곡되는 전사 지표라서다. 프로젝트 미선택 상태에서도
닿을 수 있게 대체 분기에도 같은 링크를 넣었다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `/usage` 화면

**Files:**
- Create: `src/components/usage/UsageSummary.tsx`
- Create: `src/components/usage/UsageTrendChart.tsx`
- Create: `src/components/usage/MenuRankingCard.tsx`
- Create: `src/components/usage/UsageUserTable.tsx`
- Create: `src/components/usage/UsageEventLog.tsx`
- Create: `src/components/usage/PeriodTabs.tsx`
- Create: `src/app/(app)/usage/page.tsx`
- Create: `src/app/(app)/usage/loading.tsx`

**Interfaces:**
- Consumes: Task 4 타입·함수, Task 6 데이터 함수, Task 2 `menuLabel`, Task 5 `canViewUsage`
- Produces: 라우트 `/usage`

- [ ] **Step 1: 표시 컴포넌트 6종 작성**

`src/components/usage/PeriodTabs.tsx`:

```tsx
import Link from 'next/link'
import { PERIOD_OPTIONS } from '@/lib/domain/usage'

/** 기간 선택 — 서버 렌더 유지를 위해 상태가 아니라 링크다. */
export function PeriodTabs({ current }: { current: number }) {
  return (
    <div className="seg">
      {PERIOD_OPTIONS.map(d => (
        <Link
          key={d}
          href={`/usage?days=${d}`}
          className={`seg-item ${current === d ? 'seg-item-active' : ''}`}
          aria-current={current === d ? 'page' : undefined}
        >
          {d}일
        </Link>
      ))}
    </div>
  )
}
```

`src/components/usage/UsageSummary.tsx`:

```tsx
import { Activity, CalendarCheck, MousePointerClick, Users } from 'lucide-react'
import { KpiCard } from '@/components/ui/KpiCard'
import type { UsageSummary as Summary } from '@/lib/domain/usage'

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(iso))
}

/**
 * 요약 + 수집 상태.
 * '수집 상태'가 이 화면의 자기진단이다 — 비콘이 조용히 끊겨도 마지막 이벤트 시각이
 * 멈춘 채로 보이므로 "데이터 0"과 "수집 중단"이 구별된다.
 */
export function UsageSummary({ summary, days, sessions }: {
  summary: Summary; days: number; sessions: number
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="TODAY" value={summary.todayUsers} sub="오늘 접속한 사용자" icon={CalendarCheck} tone="brand" />
        <KpiCard label={`ACTIVE ${days}D`} value={summary.activeUsers} sub={`최근 ${days}일 접속 사용자`} icon={Users} tone="success" />
        <KpiCard label={`SESSIONS ${days}D`} value={sessions} sub="30분 무활동 기준 유도값" icon={Activity} />
        <KpiCard label={`VIEWS ${days}D`} value={summary.totalEvents.toLocaleString('ko-KR')} sub="화면 열람 건수" icon={MousePointerClick} />
      </div>
      <p className="text-[11px] text-ink-subtle">
        {summary.lastEventAt
          ? `수집 상태 · 마지막 기록 ${fmtDateTime(summary.lastEventAt)}`
          : '수집 상태 · 아직 기록이 없습니다. 수집은 프로덕션 배포 환경에서만 동작합니다.'}
      </p>
    </div>
  )
}
```

`src/components/usage/UsageTrendChart.tsx`:

```tsx
import { TrendingUp } from 'lucide-react'
import { SectionCard } from '@/components/ui/SectionCard'
import { MiniEmpty } from '@/components/dashboard/bits'
import type { DailyActive } from '@/lib/domain/usage'

const W = 640, H = 200, PL = 30, PR = 12, PT = 12, PB = 24

/** 일별 활성 사용자 추이 — 자체 SVG(의존성 0). 색은 토큰 클래스라 다크모드 자동. */
export function UsageTrendChart({ series }: { series: DailyActive[] }) {
  const max = Math.max(1, ...series.map(p => p.activeUsers))
  const hasAny = series.some(p => p.events > 0)
  const x = (i: number) => PL + (series.length <= 1 ? 0 : (i / (series.length - 1)) * (W - PL - PR))
  const y = (v: number) => PT + (1 - v / max) * (H - PT - PB)
  const points = series.map((p, i) => `${x(i).toFixed(1)},${y(p.activeUsers).toFixed(1)}`).join(' ')

  return (
    <SectionCard eyebrow="TREND" title="일별 활성 사용자" icon={TrendingUp}>
      {!hasAny ? (
        <MiniEmpty text="수집 시작 이후 데이터가 쌓입니다." />
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="일별 활성 사용자 추이">
          {[0, max].map(g => (
            <g key={g}>
              <line x1={PL} x2={W - PR} y1={y(g)} y2={y(g)} className="stroke-line" strokeWidth={1} />
              <text x={PL - 6} y={y(g) + 3} textAnchor="end" fontSize={9} className="fill-ink-subtle">{g}</text>
            </g>
          ))}
          <polyline points={points} fill="none" className="stroke-brand" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <text x={PL} y={H - 6} fontSize={9} className="fill-ink-subtle">{series[0]?.d ?? ''}</text>
          <text x={W - PR} y={H - 6} textAnchor="end" fontSize={9} className="fill-ink-subtle">{series[series.length - 1]?.d ?? ''}</text>
        </svg>
      )}
    </SectionCard>
  )
}
```

`src/components/usage/MenuRankingCard.tsx`:

```tsx
import { BarChart3 } from 'lucide-react'
import { SectionCard } from '@/components/ui/SectionCard'
import { MiniEmpty } from '@/components/dashboard/bits'
import { menuLabel } from '@/lib/domain/usageMenu'
import { barPct, type MenuRank } from '@/lib/domain/usage'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'

/** 많이 쓰는 프로그램(메뉴) — 조회수 순. 막대는 1위 대비 비율. */
export function MenuRankingCard({ ranks, locale }: { ranks: MenuRank[]; locale: Locale }) {
  const translate = (k: DictKey) => t(locale, k)
  const max = ranks[0]?.events ?? 0

  return (
    <SectionCard eyebrow="MENUS" title="많이 쓰는 프로그램" icon={BarChart3}>
      {ranks.length === 0 ? (
        <MiniEmpty text="수집 시작 이후 데이터가 쌓입니다." />
      ) : (
        <ol className="space-y-2">
          {ranks.map((r, i) => (
            <li key={r.menuKey} className="flex items-center gap-3">
              <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-ink-subtle">{i + 1}</span>
              <span className="w-32 shrink-0 truncate text-xs text-ink">{menuLabel(r.menuKey, translate)}</span>
              <span className="h-2 min-w-0 flex-1 rounded-full bg-surface-2">
                <span className="block h-2 rounded-full bg-brand" style={{ width: `${barPct(r.events, max)}%` }} />
              </span>
              <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-ink-muted">
                {r.events.toLocaleString('ko-KR')}회 · {r.activeUsers}명
              </span>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  )
}
```

`src/components/usage/UsageUserTable.tsx`:

```tsx
import { Users } from 'lucide-react'
import { SectionCard } from '@/components/ui/SectionCard'
import type { UsageUserRow } from '@/lib/domain/usage'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium' }).format(new Date(iso))
}

const ROLE_LABEL: Record<string, string> = { pmo_admin: '관리자', team_editor: '팀 편집자' }

/**
 * 사용자 현황 — 계정 기준이라 활동이 0인 휴면 계정도 표시된다.
 * last_sign_in_at 은 수집 시작 이전까지 소급되므로 배포 첫날부터 채워진다.
 */
export function UsageUserTable({ rows, days }: { rows: UsageUserRow[]; days: number }) {
  return (
    <SectionCard eyebrow="USERS" title="사용자 현황" icon={Users}
      actions={<span className="badge bg-brand-weak text-brand">{rows.length}명</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-line text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              <th className="py-2 pr-3 text-left">이름</th>
              <th className="py-2 pr-3 text-left">이메일</th>
              <th className="py-2 pr-3 text-left">팀</th>
              <th className="py-2 pr-3 text-left">권한</th>
              <th className="py-2 pr-3 text-left">가입일</th>
              <th className="py-2 pr-3 text-left">마지막 로그인</th>
              <th className="py-2 pr-3 text-left">최근 활동</th>
              <th className="py-2 pr-3 text-right">{days}일 조회</th>
              <th className="py-2 pr-3 text-right">방문일수</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-line/60">
                <td className="py-2 pr-3 font-medium text-ink">{r.name}</td>
                <td className="py-2 pr-3 text-ink-muted">{r.email}</td>
                <td className="py-2 pr-3 text-ink-muted">{r.teamCode ?? '—'}</td>
                <td className="py-2 pr-3 text-ink-muted">{r.role ? (ROLE_LABEL[r.role] ?? r.role) : '—'}</td>
                <td className="py-2 pr-3 tabular-nums text-ink-muted">{fmtDate(r.createdAt)}</td>
                <td className="py-2 pr-3 tabular-nums text-ink-muted">{fmtDate(r.lastSignInAt)}</td>
                <td className="py-2 pr-3 tabular-nums text-ink-muted">{fmtDate(r.lastActivityAt)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink">{r.events.toLocaleString('ko-KR')}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink">{r.activeDays}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}
```

`src/components/usage/UsageEventLog.tsx`:

```tsx
import { ScrollText } from 'lucide-react'
import { SectionCard } from '@/components/ui/SectionCard'
import { MiniEmpty } from '@/components/dashboard/bits'
import { menuLabel } from '@/lib/domain/usageMenu'
import type { UsageEventRow } from '@/lib/data/usage'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium',
  }).format(new Date(iso))
}

/** 접속 로그 — 최신순. 상한에 걸리면 그 사실을 화면에 밝힌다(잘린 목록을 전부처럼 보이지 않게). */
export function UsageEventLog({ events, names, limit, locale }: {
  events: UsageEventRow[]; names: Map<string, string>; limit: number; locale: Locale
}) {
  const translate = (k: DictKey) => t(locale, k)
  return (
    <SectionCard eyebrow="ACCESS LOG" title="접속 로그" icon={ScrollText}
      actions={events.length >= limit
        ? <span className="badge bg-pending-weak text-pending">최근 {limit}건만 표시</span>
        : <span className="badge bg-brand-weak text-brand">{events.length}건</span>}>
      {events.length === 0 ? (
        <MiniEmpty text="이 기간에 기록된 접속이 없습니다." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                <th className="py-2 pr-3 text-left">시각</th>
                <th className="py-2 pr-3 text-left">사용자</th>
                <th className="py-2 pr-3 text-left">메뉴</th>
                <th className="py-2 pr-3 text-left">경로</th>
              </tr>
            </thead>
            <tbody>
              {events.map(e => (
                <tr key={e.id} className="border-b border-line/60">
                  <td className="py-2 pr-3 tabular-nums text-ink-muted">{fmtDateTime(e.occurredAt)}</td>
                  {/* 계정 목록에 없는 id 는 이름을 지어내지 않는다 */}
                  <td className="py-2 pr-3 text-ink">{names.get(e.userId) ?? '확인 불가'}</td>
                  <td className="py-2 pr-3 text-ink-muted">{menuLabel(e.menuKey, translate)}</td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-ink-subtle">{e.path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}
```

- [ ] **Step 2: 페이지와 로딩 스켈레톤 작성**

`src/app/(app)/usage/page.tsx`:

```tsx
import { after } from 'next/server'
import { redirect } from 'next/navigation'
import { getMembership } from '@/lib/auth'
import { canViewUsage } from '@/lib/authz/usageAccess'
import { PageHero } from '@/components/ui/PageHero'
import { PeriodTabs } from '@/components/usage/PeriodTabs'
import { UsageSummary } from '@/components/usage/UsageSummary'
import { UsageTrendChart } from '@/components/usage/UsageTrendChart'
import { MenuRankingCard } from '@/components/usage/MenuRankingCard'
import { UsageUserTable } from '@/components/usage/UsageUserTable'
import { UsageEventLog } from '@/components/usage/UsageEventLog'
import { getServerLocale } from '@/lib/i18n/server'
import {
  addDaysIso, countSessions, fillDailySeries, mergeUserRows, parsePeriodDays,
} from '@/lib/domain/usage'
import {
  getDailyActives, getMenuRanking, getRecentUsageEvents, getUsageDirectory,
  getUsageSummary, getUserRollup, purgeOldUsageEvents,
} from '@/lib/data/usage'

export const dynamic = 'force-dynamic' // 접속 지표는 항상 최신이어야 한다

/** 접속 로그 표시 상한. 넘치면 화면이 그 사실을 밝힌다. */
const EVENT_LIMIT = 200

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

export default async function UsagePage({ searchParams }: {
  searchParams: Promise<{ days?: string }>
}) {
  const m = await getMembership()
  // 지금은 전원 통과. 관리자 전용 전환은 canViewUsage 한 곳에서 이뤄진다.
  if (!canViewUsage(m)) redirect('/projects')

  const [{ days }, locale] = await Promise.all([searchParams, getServerLocale()])
  const period = parsePeriodDays(days)
  const today = seoulToday()
  const from = addDaysIso(today, -(period - 1))

  // 단일 왕복 — 직렬 2단째를 만들지 않는다(대시보드 관례).
  const [summary, daily, ranks, rollup, directory, events] = await Promise.all([
    getUsageSummary(from, today, today),
    getDailyActives(from, today),
    getMenuRanking(from, today),
    getUserRollup(from, today),
    getUsageDirectory(),
    getRecentUsageEvents({ from, to: today, limit: EVENT_LIMIT }),
  ])

  const series = fillDailySeries(daily, from, today)
  const userRows = mergeUserRows(directory, rollup)
  const names = new Map(directory.map(a => [a.id, a.name]))
  // 표시된 로그 범위 안에서의 접속 횟수 — 전 구간이 아니라 최근 EVENT_LIMIT 건 기준임을
  // 카드 설명(30분 무활동 기준)과 함께 읽도록 둔다.
  const sessions = countSessions(events.map(e => e.occurredAt))

  after(() => { void purgeOldUsageEvents() })

  return (
    <div className="space-y-6">
      <PageHero eyebrow="OPERATIONS" title="사용 현황" />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">
          최근 {period}일 · 원시 기록은 90일간 보관됩니다.
        </p>
        <PeriodTabs current={period} />
      </div>
      <UsageSummary summary={summary} days={period} sessions={sessions} />
      <div className="grid gap-5 lg:grid-cols-2">
        <UsageTrendChart series={series} />
        <MenuRankingCard ranks={ranks} locale={locale} />
      </div>
      <UsageUserTable rows={userRows} days={period} />
      <UsageEventLog events={events} names={names} limit={EVENT_LIMIT} locale={locale} />
    </div>
  )
}
```

`src/app/(app)/usage/loading.tsx`:

```tsx
/** /usage 스켈레톤 — 실제 레이아웃(요약 4칸 → 2열 카드 → 표 2개)을 모사한다. */
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="사용 현황 불러오는 중">
      <div className="hero-card h-16 animate-pulse" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map(i => <div key={i} className="kpi-card h-24 animate-pulse" />)}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card h-64 animate-pulse" />
        <div className="card h-64 animate-pulse" />
      </div>
      <div className="card h-72 animate-pulse" />
    </div>
  )
}
```

- [ ] **Step 3: 빌드·린트·전체 테스트**

```bash
npm run lint && npm run build && npm run test
```
Expected: 세 명령 모두 성공. 실패하면 그 태스크 안에서 고치고 다시 돌린다(초록이 될 때까지 다음 단계로 넘어가지 않는다).

- [ ] **Step 4: 커밋**

```bash
git add src/components/usage "src/app/(app)/usage"
git commit -m "$(cat <<'EOF'
feat(usage): 사용 현황 화면 — '수집 상태' 한 줄이 이 화면의 자기진단이다

접속 지표 화면은 '아무도 안 썼다'와 '수집이 끊겼다'가 육안으로 같아 보인다.
그래서 요약 아래에 마지막 기록 시각을 항상 노출한다 — 비콘이 조용히 죽어도
그 시각이 멈춘 채로 보인다.

사용자 표는 계정 기준 좌외부조인이라 한 번도 안 들어온 사람이 사라지지 않는다.
접속 로그는 200건 상한에 걸리면 그 사실을 배지로 밝힌다(잘린 목록을 전부처럼
보이지 않게). 계정 목록에 없는 id 는 이름을 지어내지 않고 '확인 불가'로 둔다.

차트는 기존 TrendChart 와 같은 자체 SVG 다 — 차트 라이브러리 의존성 0을 유지한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: 최종 검증

**Files:** 없음(검증 전용)

- [ ] **Step 1: 전체 검증 재실행**

```bash
npm run lint && npm run build && npm run test
```
Expected: 전부 성공. 실패한 테스트가 있으면 개수와 이름을 그대로 보고한다(통과했다고 주장하지 않는다).

- [ ] **Step 2: 커밋 위생 확인**

```bash
git log --oneline main..HEAD
git show --stat --oneline $(git rev-list main..HEAD | tail -1)
```
Expected: 마이그레이션 커밋이 `src/` 파일을 하나도 포함하지 않는다(G1).

- [ ] **Step 3: 남은 변경 없는지 확인**

```bash
git status --short
```
Expected: `tests/scratch/`(다른 세션 소유) 외에 미커밋 변경이 없다.

- [ ] **Step 4: 사용자에게 보고하고 승인 요청**

푸시·마이그레이션 적용·배포는 **여기서 멈추고 사용자 승인을 받는다.** 보고할 것:
- 로컬 검증 결과(lint/build/test 실제 출력)
- 프로덕션 적용에 필요한 순서: ① `0051` Management API 적용 → ② 브랜치 push → ③ main 머지·배포 → ④ `npm run smoke:prod`
- **적용 전까지 `/usage`는 프로덕션에서 500을 낸다**(테이블·RPC 없음). 그래서 마이그레이션이 코드보다 먼저다.
- 수집은 `VERCEL_ENV=production`에서만 동작하므로 로컬에서는 화면이 비어 있다는 사실

---

## Self-Review

**1. 스펙 커버리지**

| 스펙 절 | 태스크 |
|---|---|
| §2 수집 지점·비콘·env 게이트 | Task 3, 7, 8 |
| §3.1 테이블·인덱스·cascade | Task 1 |
| §3.2 RLS 셰이프 C | Task 1 |
| §3.3 RPC 4종 | Task 1 |
| §3.4 보존 90일·`after()` 정리 | Task 6 (`purgeOldUsageEvents`), Task 9 (호출) |
| §4 메뉴 키·드리프트 가드 | Task 2 |
| §5 day-0 `last_sign_in_at` | Task 6 (`getUsageDirectory`), Task 9 (표) |
| §6 화면 5섹션·기간 선택·세션 정의 | Task 4, 9 |
| §7 `canViewUsage`·이메일 표시 | Task 5, 9 |
| §8 에러 처리 4항 | Task 6(throw), 7(fail-closed), 9(수집 상태·상한 표기) |
| §9 파일 목록 | Task 1~9 전체 |
| §10 배포 절차 | Global Constraints, Task 10 |

누락 없음.

**2. 플레이스홀더 스캔** — "TBD"/"적절히 처리"/"위 내용에 대한 테스트" 없음. 모든 코드 단계에 실제 코드가 들어 있다.

**3. 타입 일관성** — `UsageSummary`(도메인 타입)와 컴포넌트 `UsageSummary`(함수)의 이름이 겹치므로 `src/components/usage/UsageSummary.tsx`에서 타입을 `Summary`로 별칭 import 한다(해당 코드에 반영됨). `UsageEventRow`는 `src/lib/data/usage.ts`에서만 정의하고 컴포넌트가 거기서 import 한다. `AccountRecord.name`은 `string`(널 아님) — `getUsageDirectory`가 `displayNameFrom(...) ?? email`로 보장하므로 `mergeUserRows`의 `localeCompare`가 안전하다.
