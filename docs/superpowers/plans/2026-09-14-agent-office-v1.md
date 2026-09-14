# 가상오피스(에이전트 좌석표) v1 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** D'Flow 웹에 에이전트 좌석표 `/agents` 를 띄우고, 그 데이터 원천인 heartbeat·watch 신호 경로(마이그레이션·API·`dflow.sh`·훅)를 만든다.

**Architecture:** 서버는 `agent_work_orders` 에 heartbeat 열 4개와 `agent_watchers` 테이블을 더하고, 보고 행을 만들지 않는 얇은 POST 라우트 둘로 신호를 받는다. 상태 판정(`seatState.ts`)과 조립(`seatmap.ts`)은 순수 함수로 두고, 서버 컴포넌트가 service_role 로 6개 조회를 한 번에 읽어 클라이언트 뷰(`src/components/agents/*`)에 넘기며, 클라이언트는 30초마다 서버 액션으로 재조회한다. 클라이언트 쪽 신호는 PostToolUse 훅(자체 curl)과 `dflow.sh heartbeat|watch`, `poll.sh` 의 watch 호출이 낸다.

**Tech Stack:** Next.js 15 App Router, Supabase(PostgREST, service_role), Tailwind v4 + CSS module, vitest(node·jsdom), POSIX sh.

**Spec:** `docs/superpowers/specs/2026-09-14-agent-office-v1-design.md` (정리본 `2026-09-10-agent-seatmap-monitoring-design.md`, 팀장 연동 `2026-09-10-dflow-team-design.md` §9)

## Global Constraints

- 작업 위치는 워크트리 `/Users/jji/project/wbs-web/.claude/worktrees/feat-agent-office`(브랜치 `feat/agent-office`, 기점 `staging`). 메인 체크아웃을 switch 하지 않는다. 이 워크트리에는 `npm install` 이 끝났고 `.env` 는 메인 체크아웃 `.env` 로의 심링크다(스테이징 DB).
- 커밋은 파일명을 명시해 stage 한다. `git add -A` 금지. 마이그레이션 파일은 코드와 다른 커밋(G1). 커밋 메시지는 한국어, "왜" 중심, 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` 과 `Claude-Session: https://claude.ai/code/session_018V49dnv2npGi72Lj7RkeK4` 두 줄.
- `src/app/globals.css`·`src/app/layout.tsx`·`src/app/(app)/layout.tsx`·`src/components/app/*` 는 Task 11 에서만 건드린다(UI 위험 파일, Preview 대상).
- 상태 변형 display 유틸(`group-hover:flex` 류)과 컨테이너 쿼리 display 조합 금지(`tests/css/breakpoint-safety-net.test.ts` 가 잡는다).
- 조회 실패를 빈 데이터로 위장하지 않는다. 데이터 계층은 throw, 액션은 `{ ok:false, error }`, 화면은 그 사실을 표시한다.
- 권한 판정은 `src/lib/domain/authz.ts` 의 순수 함수만 조합한다. 액션·페이지에 `role === '...'` 을 적지 않는다.
- 새 스킬·킷 파일에 `~/project/wbs-web`·`docs/superpowers` 절대경로를 넣지 않는다(`scripts/kit-build.sh` 빌드 가드).
- `dflow.sh` 안의 git 호출은 `${DFLOW_GIT:-git}`.
- 테스트 실행은 `npx vitest run <경로>`. 전체는 `npm test`. 린트 `npm run lint`.
- 스테이징 마이그레이션 리허설은 `npm run staging:sync` 를 **건너뛴다**(사용자 결정).

---

### Task 1: 마이그레이션 0094 — heartbeat 열 4개 + `agent_watchers`

**Files:**
- Create: `supabase/migrations/0094_agent_heartbeat.sql`
- Create: `supabase/migrations/0094_agent_heartbeat_rollback.sql`
- Test: `tests/migrations/0094-agent-heartbeat.test.ts`

**Interfaces:**
- Produces: `agent_work_orders.last_heartbeat_at timestamptz | heartbeat_phase text | heartbeat_agent text | heartbeat_note text`, 테이블 `agent_watchers(id, user_id, project_id, agent, host, slots, busy, until_label, last_seen_at, created_at)` unique `(user_id, agent)`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/migrations/0094-agent-heartbeat.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.cwd(), 'supabase/migrations/')
const up = () => readFileSync(join(dir, '0094_agent_heartbeat.sql'), 'utf8')
const down = () => readFileSync(join(dir, '0094_agent_heartbeat_rollback.sql'), 'utf8')

describe('0094 — heartbeat 열과 agent_watchers (좌석표 v1 스펙 §3-1)', () => {
  it('agent_work_orders 에 heartbeat 열 4개를 멱등하게 더한다', () => {
    const s = up()
    for (const col of ['last_heartbeat_at', 'heartbeat_phase', 'heartbeat_agent', 'heartbeat_note']) {
      expect(s).toMatch(new RegExp(`add column if not exists ${col}`))
    }
  })
  it('agent_watchers 는 (user_id, agent) 유일, RLS 켬, select 정책만 둔다', () => {
    const s = up()
    expect(s).toContain('create table if not exists public.agent_watchers')
    expect(s).toContain('unique (user_id, agent)')
    expect(s).toContain('alter table public.agent_watchers enable row level security')
    expect(s).toMatch(/create policy agent_watchers_select on public\.agent_watchers\s+for select/)
    expect(s).not.toMatch(/for (insert|update|delete)/)
  })
  it('롤백은 정책·테이블·열 4개를 되돌린다', () => {
    const s = down()
    expect(s).toContain('drop policy if exists agent_watchers_select')
    expect(s).toContain('drop table if exists public.agent_watchers')
    for (const col of ['last_heartbeat_at', 'heartbeat_phase', 'heartbeat_agent', 'heartbeat_note']) {
      expect(s).toMatch(new RegExp(`drop column if exists ${col}`))
    }
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/migrations/0094-agent-heartbeat.test.ts tests/migrations/migration-ledger.test.ts`
Expected: FAIL — `ENOENT ... 0094_agent_heartbeat.sql`

- [ ] **Step 3: 마이그레이션 작성**

```sql
-- supabase/migrations/0094_agent_heartbeat.sql
-- 좌석표 v1 (docs/superpowers/specs/2026-09-14-agent-office-v1-design.md §3-1)
-- heartbeat 는 보고 행을 만들지 않고 주문 행의 열만 touch 한다 — 행이 늘지 않아 디스크·풀 부담이 없다.
alter table public.agent_work_orders
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists heartbeat_phase   text,
  add column if not exists heartbeat_agent   text,
  add column if not exists heartbeat_note    text;

comment on column public.agent_work_orders.heartbeat_phase is
  'design|build|verify|refactor|blocked|rejected|reported — 마지막 heartbeat 가 말한 phase. blocked 는 담당자 결정 대기.';

-- 감시자(팀장 /dflow-team, 단독 /dflow-poll) 존재 신호. (user_id, agent) 당 1행, TTL 판정은 화면(70분).
create table if not exists public.agent_watchers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  project_id    uuid references public.projects(id) on delete cascade,   -- null = 배정분 전체
  agent         text not null,        -- '<신원>/<host>/lead' 또는 '<신원>/<host>/poll'
  host          text,
  slots         int,
  busy          int,
  until_label   text,                 -- 감시 종료 예정 'HH:MM' 문자열 그대로
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (user_id, agent)
);
create index if not exists agent_watchers_last_seen_idx on public.agent_watchers (last_seen_at);

alter table public.agent_watchers enable row level security;
-- 조회는 로그인 사용자 전체(0057 주문 조회 정책과 같은 수준). 쓰기 정책 없음 — service_role 전용, 서버 가드가 유일 관문.
drop policy if exists agent_watchers_select on public.agent_watchers;
create policy agent_watchers_select on public.agent_watchers
  for select to authenticated using (true);
```

```sql
-- supabase/migrations/0094_agent_heartbeat_rollback.sql
drop policy if exists agent_watchers_select on public.agent_watchers;
drop index if exists public.agent_watchers_last_seen_idx;
drop table if exists public.agent_watchers;
alter table public.agent_work_orders
  drop column if exists last_heartbeat_at,
  drop column if exists heartbeat_phase,
  drop column if exists heartbeat_agent,
  drop column if exists heartbeat_note;
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/migrations/0094-agent-heartbeat.test.ts tests/migrations/migration-ledger.test.ts`
Expected: PASS (ledger 테스트가 `_rollback.sql` 쌍을 인정)

- [ ] **Step 5: 스테이징 리허설(sync 생략)**

Run (워크트리 루트):
```bash
npm run db:apply -- supabase/migrations/0094_agent_heartbeat.sql --target staging
```
Expected: SQL 실행 결과 출력, 오류 없음. 토큰이 없다는 안내가 나오면 그 안내문(키체인 `Supabase CLI` 또는 `SUPABASE_ACCESS_TOKEN`)을 그대로 보고하고 멈춘다 — 사람 몫.

검증(스테이징 Studio 또는 아래 curl, `.env` 의 스테이징 `NEXT_PUBLIC_SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY` 사용):
```bash
set -a; . ./.env; set +a
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/agent_watchers?select=id&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/agent_work_orders?select=id,last_heartbeat_at,heartbeat_phase&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```
Expected: 둘 다 `[]` 또는 행 JSON(열 이름 오류 없음).

- [ ] **Step 6: 마이그레이션만 커밋(G1) + 트레일러(G4)**

```bash
git add supabase/migrations/0094_agent_heartbeat.sql supabase/migrations/0094_agent_heartbeat_rollback.sql tests/migrations/0094-agent-heartbeat.test.ts
git commit -m "feat(db): 0094 에이전트 heartbeat 열 4개와 agent_watchers — 좌석표가 Phase 안 침묵을 보게 한다" \
  --trailer "Staging-verified: $(date +%F) db 리허설 통과" \
  --trailer "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" \
  --trailer "Claude-Session: https://claude.ai/code/session_018V49dnv2npGi72Lj7RkeK4"
```

---

### Task 2: 상태 판정 순수 함수 `seatState.ts`

**Files:**
- Create: `src/lib/domain/seatState.ts`
- Test: `tests/domain/seat-state.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type OrderStatus = 'ready' | 'claimed' | 'reported' | 'approved' | 'cancelled'
  export type SeatState = 'READY' | 'WAIT' | 'DONE' | 'BLOCKED' | 'OFFLINE' | 'STALE' | 'REJECTED' | 'ACTIVE'
  export type Phase = 'design' | 'build' | 'verify' | 'refactor' | 'blocked' | 'rejected' | 'reported'
  export type AnimName = 'typing' | 'design' | 'verify' | 'refactor' | 'stale' | 'idle_coffee' | 'idle_stretch' | 'idle_look' | 'rejected' | 'empty'
  export type CharacterName = 'monitor_bot' | 'cat_dev' | 'human_dev' | 'dome_bot'
  export const HEARTBEAT_PHASES: readonly Phase[]
  export const STALE_MS = 5 * 60_000; export const OFFLINE_MS = 30 * 60_000; export const WATCHER_TTL_MS = 70 * 60_000
  export interface SeatInput { status: OrderStatus; lastHeartbeatAt: string | null; heartbeatPhase: string | null; updatedAt: string; lastReview: 'approve' | 'reject' | null; actualPct: number | null }
  export function lastSignalMs(i: SeatInput): number
  export function isRejected(i: SeatInput): boolean
  export function deriveSeatState(i: SeatInput, nowMs: number): SeatState
  export function inferPhase(i: SeatInput): Phase
  export function animFor(state: SeatState, phase: Phase, idleSlot?: number): AnimName
  export function fnv1a32(s: string): number
  export function pickCharacter(key: string): CharacterName
  export function isWatcherAlive(lastSeenAt: string, nowMs: number): boolean
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/domain/seat-state.test.ts
import { describe, expect, it } from 'vitest'
import {
  OFFLINE_MS, STALE_MS, WATCHER_TTL_MS, animFor, deriveSeatState, fnv1a32, inferPhase, isRejected,
  isWatcherAlive, lastSignalMs, pickCharacter, type SeatInput,
} from '@/lib/domain/seatState'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
// updatedAt 은 항상 heartbeat 보다 오래된 값으로 둔다 — 마지막 신호 = max(둘) 이라 그래야 heartbeat 로 경계를 시험할 수 있다.
const base = (over: Partial<SeatInput> = {}): SeatInput => ({
  status: 'claimed', lastHeartbeatAt: ago(1000), heartbeatPhase: 'build', updatedAt: ago(2 * 3600_000),
  lastReview: null, actualPct: 25, ...over,
})

describe('deriveSeatState — 스펙 §2 우선순위', () => {
  it('status 가 판정을 앞선다: ready/reported/approved', () => {
    expect(deriveSeatState(base({ status: 'ready' }), NOW)).toBe('READY')
    expect(deriveSeatState(base({ status: 'reported' }), NOW)).toBe('WAIT')
    expect(deriveSeatState(base({ status: 'approved' }), NOW)).toBe('DONE')
  })
  it('BLOCKED 는 시간 판정보다 앞선다 — 2시간 침묵해도 손 든 채 남는다', () => {
    expect(deriveSeatState(base({ heartbeatPhase: 'blocked', lastHeartbeatAt: ago(2 * 3600_000), updatedAt: ago(2 * 3600_000) }), NOW)).toBe('BLOCKED')
  })
  it('임계값 경계: 5분 정확히는 ACTIVE, 5분+1ms 는 STALE, 30분 정확히는 STALE, 30분+1ms 는 OFFLINE', () => {
    expect(deriveSeatState(base({ lastHeartbeatAt: ago(STALE_MS) }), NOW)).toBe('ACTIVE')
    expect(deriveSeatState(base({ lastHeartbeatAt: ago(STALE_MS + 1) }), NOW)).toBe('STALE')
    expect(deriveSeatState(base({ lastHeartbeatAt: ago(OFFLINE_MS) }), NOW)).toBe('STALE')
    expect(deriveSeatState(base({ lastHeartbeatAt: ago(OFFLINE_MS + 1) }), NOW)).toBe('OFFLINE')
  })
  it('heartbeat 가 없으면 updated_at 이 마지막 신호다(훅 없는 옛 세션)', () => {
    expect(lastSignalMs(base({ lastHeartbeatAt: null, updatedAt: ago(10_000) }))).toBe(NOW - 10_000)
    expect(deriveSeatState(base({ lastHeartbeatAt: null, updatedAt: ago(OFFLINE_MS + 1) }), NOW)).toBe('OFFLINE')
  })
  it('마지막 신호는 둘 중 늦은 쪽이다', () => {
    expect(lastSignalMs(base({ lastHeartbeatAt: ago(50_000), updatedAt: ago(5_000) }))).toBe(NOW - 5_000)
  })
  it('REJECTED 는 살아 있을 때만 — 침묵하면 STALE/OFFLINE 이 이기고 rejected 플래그는 따로 남는다', () => {
    const r = base({ lastReview: 'reject' })
    expect(deriveSeatState(r, NOW)).toBe('REJECTED')
    expect(deriveSeatState({ ...r, lastHeartbeatAt: ago(STALE_MS + 1) }, NOW)).toBe('STALE')
    expect(isRejected(r)).toBe(true)
    expect(isRejected(base({ lastReview: 'approve' }))).toBe(false)
  })
  it('cancelled 는 DONE 도 READY 도 아니다 — 화면에서 빼기 위해 DONE 으로 접지 않는다', () => {
    expect(deriveSeatState(base({ status: 'cancelled' }), NOW)).toBe('DONE')
  })
})

describe('inferPhase — heartbeat_phase 우선, 없으면 actual_pct', () => {
  it('heartbeat_phase 가 알려진 값이면 그대로', () => {
    expect(inferPhase(base({ heartbeatPhase: 'verify' }))).toBe('verify')
  })
  it('없거나 모르는 값이면 pct 로: <25 design, <60 build, <85 verify, 그 외 refactor', () => {
    expect(inferPhase(base({ heartbeatPhase: null, actualPct: 0 }))).toBe('design')
    expect(inferPhase(base({ heartbeatPhase: 'weird', actualPct: 25 }))).toBe('build')
    expect(inferPhase(base({ heartbeatPhase: null, actualPct: 60 }))).toBe('verify')
    expect(inferPhase(base({ heartbeatPhase: null, actualPct: 85 }))).toBe('refactor')
    expect(inferPhase(base({ heartbeatPhase: null, actualPct: null }))).toBe('design')
  })
})

describe('animFor — 스펙 §2 표', () => {
  it('ACTIVE 는 phase 별, 모르는 phase 는 typing', () => {
    expect(animFor('ACTIVE', 'design')).toBe('design')
    expect(animFor('ACTIVE', 'build')).toBe('typing')
    expect(animFor('ACTIVE', 'verify')).toBe('verify')
    expect(animFor('ACTIVE', 'refactor')).toBe('refactor')
    expect(animFor('ACTIVE', 'reported')).toBe('typing')
  })
  it('WAIT 는 idle 3종을 slot 으로 순환한다', () => {
    expect(animFor('WAIT', 'reported', 0)).toBe('idle_coffee')
    expect(animFor('WAIT', 'reported', 1)).toBe('idle_stretch')
    expect(animFor('WAIT', 'reported', 2)).toBe('idle_look')
    expect(animFor('WAIT', 'reported', 3)).toBe('idle_coffee')
  })
  it('STALE→stale, REJECTED→rejected, BLOCKED→idle_look, 빈자리 3종→empty', () => {
    expect(animFor('STALE', 'build')).toBe('stale')
    expect(animFor('REJECTED', 'build')).toBe('rejected')
    expect(animFor('BLOCKED', 'blocked')).toBe('idle_look')
    expect(animFor('READY', 'design')).toBe('empty')
    expect(animFor('DONE', 'reported')).toBe('empty')
    expect(animFor('OFFLINE', 'build')).toBe('empty')
  })
})

describe('pickCharacter — 같은 키는 늘 같은 캐릭터', () => {
  it('FNV-1a 32 는 알려진 값을 낸다', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5)
    expect(fnv1a32('a')).toBe(0xe40c292c)
  })
  it('결정론이고 4종 안에 든다', () => {
    const a = pickCharacter('hong/mbp/w2')
    expect(pickCharacter('hong/mbp/w2')).toBe(a)
    expect(['monitor_bot', 'cat_dev', 'human_dev', 'dome_bot']).toContain(a)
  })
})

describe('isWatcherAlive — TTL 70분', () => {
  it('70분 정확히는 살아 있고, 그 뒤는 죽는다', () => {
    expect(isWatcherAlive(ago(WATCHER_TTL_MS), NOW)).toBe(true)
    expect(isWatcherAlive(ago(WATCHER_TTL_MS + 1), NOW)).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/seat-state.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/seatState'`

- [ ] **Step 3: 구현**

```ts
// src/lib/domain/seatState.ts
// 좌석표 상태 판정 — IO 없음. 정본: docs/superpowers/specs/2026-09-14-agent-office-v1-design.md §2
export type OrderStatus = 'ready' | 'claimed' | 'reported' | 'approved' | 'cancelled'
export type SeatState = 'READY' | 'WAIT' | 'DONE' | 'BLOCKED' | 'OFFLINE' | 'STALE' | 'REJECTED' | 'ACTIVE'
export type Phase = 'design' | 'build' | 'verify' | 'refactor' | 'blocked' | 'rejected' | 'reported'
export type AnimName =
  | 'typing' | 'design' | 'verify' | 'refactor' | 'stale'
  | 'idle_coffee' | 'idle_stretch' | 'idle_look' | 'rejected' | 'empty'
export type CharacterName = 'monitor_bot' | 'cat_dev' | 'human_dev' | 'dome_bot'

export const HEARTBEAT_PHASES: readonly Phase[] = ['design', 'build', 'verify', 'refactor', 'blocked', 'rejected', 'reported']
/** 임계값 초안(정리본 §3). 운영하며 조정한다. */
export const STALE_MS = 5 * 60_000
export const OFFLINE_MS = 30 * 60_000
/** 팀장 잠금의 죽음 판정(두 TICK 연속 누락)과 같은 값. */
export const WATCHER_TTL_MS = 70 * 60_000

const CHARACTERS: readonly CharacterName[] = ['monitor_bot', 'cat_dev', 'human_dev', 'dome_bot']
const IDLE_ANIMS: readonly AnimName[] = ['idle_coffee', 'idle_stretch', 'idle_look']

export interface SeatInput {
  status: OrderStatus
  lastHeartbeatAt: string | null
  heartbeatPhase: string | null
  updatedAt: string
  /** 그 주문의 마지막 completion 보고 판정. 없으면 null. */
  lastReview: 'approve' | 'reject' | null
  actualPct: number | null
}

const ms = (iso: string | null): number => (iso ? Date.parse(iso) : Number.NaN)

/** 마지막 신호 = max(last_heartbeat_at, updated_at). heartbeat 가 없던 옛 주문은 progress 가 touch 한 updated_at 으로 판정된다. */
export function lastSignalMs(i: SeatInput): number {
  const hb = ms(i.lastHeartbeatAt), up = ms(i.updatedAt)
  if (Number.isNaN(hb)) return up
  if (Number.isNaN(up)) return hb
  return Math.max(hb, up)
}

export function isRejected(i: SeatInput): boolean {
  return i.status === 'claimed' && i.lastReview === 'reject'
}

export function deriveSeatState(i: SeatInput, nowMs: number): SeatState {
  if (i.status === 'ready') return 'READY'
  if (i.status === 'reported') return 'WAIT'
  if (i.status !== 'claimed') return 'DONE' // approved · cancelled — 화면은 cancelled 를 조회에서 뺀다
  if (i.heartbeatPhase === 'blocked') return 'BLOCKED'
  const silence = nowMs - lastSignalMs(i)
  if (silence > OFFLINE_MS) return 'OFFLINE'
  if (silence > STALE_MS) return 'STALE'
  if (isRejected(i)) return 'REJECTED'
  return 'ACTIVE'
}

export function inferPhase(i: SeatInput): Phase {
  if (i.heartbeatPhase && (HEARTBEAT_PHASES as readonly string[]).includes(i.heartbeatPhase)) {
    return i.heartbeatPhase as Phase
  }
  const pct = i.actualPct ?? 0
  if (pct < 25) return 'design'
  if (pct < 60) return 'build'
  if (pct < 85) return 'verify'
  return 'refactor'
}

export function animFor(state: SeatState, phase: Phase, idleSlot = 0): AnimName {
  switch (state) {
    case 'ACTIVE':
      if (phase === 'design' || phase === 'verify' || phase === 'refactor') return phase
      return 'typing'
    case 'WAIT': return IDLE_ANIMS[((idleSlot % 3) + 3) % 3]
    case 'STALE': return 'stale'
    case 'REJECTED': return 'rejected'
    case 'BLOCKED': return 'idle_look' // 손 든 그림이 아직 없다 — 정지 프레임 + 말풍선으로 대체(스펙 §2)
    default: return 'empty'
  }
}

/** FNV-1a 32비트 — 캐릭터 배정용. 같은 AGENT_ID 는 늘 같은 인물이어야 한다(팀장 스펙 §9-1). */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function pickCharacter(key: string): CharacterName {
  return CHARACTERS[fnv1a32(key) % CHARACTERS.length]
}

export function isWatcherAlive(lastSeenAt: string, nowMs: number): boolean {
  return nowMs - Date.parse(lastSeenAt) <= WATCHER_TTL_MS
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/seat-state.test.ts`
Expected: PASS (fnv1a32('a') 기대값이 어긋나면 구현이 아니라 `Math.imul` 순서를 의심한다 — XOR 뒤 곱이 FNV-1a 다)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/seatState.ts tests/domain/seat-state.test.ts
git commit -m "feat(domain): 좌석 상태 판정 순수 함수 — BLOCKED 가 시간 판정에 앞서고 신호 없는 옛 주문은 updated_at 으로 본다"
```
(트레일러 두 줄은 Global Constraints 대로 붙인다.)

---

### Task 3: 조립 순수 함수 `seatmap.ts` — 행 → 층·구역·책상·카운터·확인 필요

**Files:**
- Create: `src/lib/domain/seatmap.ts`
- Test: `tests/domain/seatmap.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `deriveSeatState`·`inferPhase`·`animFor`·`pickCharacter`·`isRejected`·`lastSignalMs`·`isWatcherAlive`.
- Produces:
  ```ts
  export interface OrderRow { id: string; project_id: string; wbs_item_id: string | null; status: OrderStatus; claimed_by: string | null; claimed_by_user_id: string | null; claimed_at: string | null; created_at: string; updated_at: string; last_heartbeat_at: string | null; heartbeat_phase: string | null; heartbeat_agent: string | null; heartbeat_note: string | null }
  export interface ItemRow { id: string; project_id: string; code: string; name: string; parent_id: string | null; actual_pct: number | null }
  export interface ReviewRow { work_order_id: string; review_action: 'approve' | 'reject' | null; review_note: string | null; created_at: string }
  export interface WatcherRow { id: string; user_id: string; project_id: string | null; agent: string; host: string | null; slots: number | null; busy: number | null; until_label: string | null; last_seen_at: string }
  export interface ProjectRow { id: string; name: string }
  export interface SeatmapRows { orders: OrderRow[]; items: ItemRow[]; parents: ItemRow[]; reviews: ReviewRow[]; watchers: WatcherRow[]; projects: ProjectRow[] }
  export interface Seat { orderId: string; id8: string; projectId: string; itemId: string | null; code: string; name: string; state: SeatState; phase: Phase; anim: AnimName; character: CharacterName; agent: string | null; progress: number; lastSignalAt: string | null; heartbeatAt: string | null; heartbeatPhase: string | null; note: string | null; rejected: boolean; reviewNote: string | null }
  export interface Zone { key: string; code: string; name: string; seats: Seat[]; summary: { work: number; wait: number; done: number; ready: number } }
  export interface Watcher { agent: string; host: string | null; slots: number | null; busy: number | null; untilLabel: string | null; lastSeenAt: string; projectId: string | null }
  export interface Floor { id: string; name: string; zones: Zone[]; seatCount: number; doneCount: number; watchers: Watcher[] }
  export interface Attention { orderId: string; id8: string; floorName: string; code: string; name: string; state: SeatState; why: string }
  export interface Seatmap { floors: Floor[]; counters: { active: number; standby: number; idle: number; offline: number }; attention: Attention[]; fetchedAt: string }
  export function assembleSeatmap(rows: SeatmapRows, nowMs: number): Seatmap
  export function ageLabel(fromIso: string | null, nowMs: number): string   // '12초 전' | '5분 전' | '2시간 3분 전' | '—'
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/domain/seatmap.test.ts
import { describe, expect, it } from 'vitest'
import { OFFLINE_MS, STALE_MS } from '@/lib/domain/seatState'
import { ageLabel, assembleSeatmap, type OrderRow, type SeatmapRows } from '@/lib/domain/seatmap'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const P1 = 'p1', P2 = 'p2'
const order = (over: Partial<OrderRow>): OrderRow => ({
  id: '11111111-aaaa-4aaa-8aaa-000000000001', project_id: P1, wbs_item_id: 'i1', status: 'claimed',
  claimed_by: 'claude-mbp', claimed_by_user_id: 'u1', claimed_at: ago(3600_000), created_at: ago(7200_000),
  updated_at: ago(60_000), last_heartbeat_at: ago(1000), heartbeat_phase: 'build', heartbeat_agent: 'hong/mbp/w1',
  heartbeat_note: null, ...over,
})
const rows = (over: Partial<SeatmapRows> = {}): SeatmapRows => ({
  orders: [order({})],
  items: [{ id: 'i1', project_id: P1, code: 'TSK-04-02', name: '주문 상세', parent_id: 'z1', actual_pct: 25 }],
  parents: [{ id: 'z1', project_id: P1, code: 'WP-04', name: '주문 관리', parent_id: null, actual_pct: null }],
  reviews: [], watchers: [], projects: [{ id: P1, name: 'mes-base' }, { id: P2, name: 'mes-runlog' }],
  ...over,
})

describe('assembleSeatmap — 층·구역·책상', () => {
  it('주문 1건이 층(프로젝트)→구역(부모 항목)→책상으로 놓이고 상태·애니메이션·캐릭터가 붙는다', () => {
    const m = assembleSeatmap(rows(), NOW)
    expect(m.floors).toHaveLength(1) // 주문 없는 프로젝트는 층을 만들지 않는다
    const f = m.floors[0]
    expect(f.name).toBe('mes-base')
    expect(f.zones[0].code).toBe('WP-04')
    const s = f.zones[0].seats[0]
    expect(s.id8).toBe('11111111')
    expect(s.state).toBe('ACTIVE'); expect(s.anim).toBe('typing'); expect(s.progress).toBe(25)
    expect(s.agent).toBe('hong/mbp/w1')
    expect(['monitor_bot', 'cat_dev', 'human_dev', 'dome_bot']).toContain(s.character)
  })
  it('부모가 없는 항목은 "구역 없음", 항목이 지워진 주문(wbs_item_id null)은 "항목 없음" 구역에 놓인다', () => {
    const m = assembleSeatmap(rows({
      orders: [order({ id: 'a'.repeat(8) + '-1', wbs_item_id: 'i2' }), order({ id: 'b'.repeat(8) + '-2', wbs_item_id: null })],
      items: [{ id: 'i2', project_id: P1, code: 'TSK-99', name: '고아', parent_id: null, actual_pct: 0 }],
      parents: [],
    }), NOW)
    const keys = m.floors[0].zones.map(z => z.name)
    expect(keys).toContain('구역 없음')
    expect(keys).toContain('항목 없음')
  })
  it('책상은 구역 안에서 code 순', () => {
    const m = assembleSeatmap(rows({
      orders: [order({ id: 'c'.repeat(8) + '-3', wbs_item_id: 'i3' }), order({})],
      items: [
        { id: 'i3', project_id: P1, code: 'TSK-04-01', name: '먼저', parent_id: 'z1', actual_pct: 0 },
        { id: 'i1', project_id: P1, code: 'TSK-04-02', name: '나중', parent_id: 'z1', actual_pct: 25 },
      ],
    }), NOW)
    expect(m.floors[0].zones[0].seats.map(s => s.code)).toEqual(['TSK-04-01', 'TSK-04-02'])
  })
  it('마지막 completion 보고가 reject 면 rejected 와 reviewNote 가 붙고 상태는 REJECTED', () => {
    const m = assembleSeatmap(rows({
      reviews: [
        { work_order_id: order({}).id, review_action: 'approve', review_note: null, created_at: ago(9000_000) },
        { work_order_id: order({}).id, review_action: 'reject', review_note: '테스트 누락', created_at: ago(600_000) },
      ],
    }), NOW)
    const s = m.floors[0].zones[0].seats[0]
    expect(s.state).toBe('REJECTED'); expect(s.rejected).toBe(true); expect(s.reviewNote).toBe('테스트 누락')
  })
  it('DONE(approved) 은 doneCount 로 세고 카운터에는 들어가지 않는다', () => {
    const m = assembleSeatmap(rows({ orders: [order({ status: 'approved' })] }), NOW)
    expect(m.floors[0].doneCount).toBe(1)
    expect(m.counters).toEqual({ active: 0, standby: 0, idle: 0, offline: 0 })
  })
})

describe('assembleSeatmap — 카운터·확인 필요·watcher', () => {
  it('카운터: Active=ACTIVE+STALE+REJECTED+BLOCKED, Idle=WAIT, Offline=OFFLINE+READY', () => {
    const m = assembleSeatmap(rows({
      orders: [
        order({ id: '1'.repeat(8) + '-a' }),
        order({ id: '2'.repeat(8) + '-b', last_heartbeat_at: ago(STALE_MS + 1), updated_at: ago(STALE_MS + 1) }),
        order({ id: '3'.repeat(8) + '-c', heartbeat_phase: 'blocked', heartbeat_note: '어느 DB?' }),
        order({ id: '4'.repeat(8) + '-d', status: 'reported' }),
        order({ id: '5'.repeat(8) + '-e', last_heartbeat_at: ago(OFFLINE_MS + 1), updated_at: ago(OFFLINE_MS + 1) }),
        order({ id: '6'.repeat(8) + '-f', status: 'ready', claimed_by: null, claimed_by_user_id: null, heartbeat_agent: null }),
      ],
    }), NOW)
    expect(m.counters).toEqual({ active: 3, standby: 0, idle: 1, offline: 2 })
    expect(m.attention.map(a => a.state)).toEqual(['BLOCKED', 'STALE', 'OFFLINE'])
    expect(m.attention[0].why).toBe('어느 DB?')
  })
  it('watcher: 70분 안이면 살아 있고, project_id null 은 모든 층에, 지정이면 그 층에만', () => {
    const m = assembleSeatmap(rows({
      orders: [order({}), order({ id: '9'.repeat(8) + '-z', project_id: P2, wbs_item_id: null })],
      watchers: [
        { id: 'w1', user_id: 'u1', project_id: null, agent: 'hong/mbp/lead', host: 'mbp', slots: 3, busy: 1, until_label: '18:00', last_seen_at: ago(60_000) },
        { id: 'w2', user_id: 'u1', project_id: P2, agent: 'hong/mbp/poll', host: 'mbp', slots: null, busy: null, until_label: null, last_seen_at: ago(60_000) },
        { id: 'w3', user_id: 'u2', project_id: null, agent: 'kim/air/lead', host: 'air', slots: 2, busy: 0, until_label: null, last_seen_at: ago(71 * 60_000) },
      ],
    }), NOW)
    const byName = Object.fromEntries(m.floors.map(f => [f.name, f.watchers.map(w => w.agent)]))
    expect(byName['mes-base']).toEqual(['hong/mbp/lead'])
    expect(byName['mes-runlog']).toEqual(['hong/mbp/lead', 'hong/mbp/poll'])
    expect(m.counters.standby).toBe(2)
  })
  it('fetchedAt 은 nowMs 의 ISO', () => {
    expect(assembleSeatmap(rows(), NOW).fetchedAt).toBe(new Date(NOW).toISOString())
  })
})

describe('ageLabel', () => {
  it('초·분·시간 분·없음', () => {
    expect(ageLabel(ago(12_000), NOW)).toBe('12초 전')
    expect(ageLabel(ago(5 * 60_000), NOW)).toBe('5분 전')
    expect(ageLabel(ago(2 * 3600_000 + 3 * 60_000), NOW)).toBe('2시간 3분 전')
    expect(ageLabel(null, NOW)).toBe('—')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/seatmap.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/seatmap'`

- [ ] **Step 3: 구현**

```ts
// src/lib/domain/seatmap.ts
// 좌석표 조립 — IO 없음. 층=프로젝트, 구역=주문 항목의 부모 항목, 책상=주문(스펙 §5-1).
import {
  animFor, deriveSeatState, inferPhase, isRejected, isWatcherAlive, lastSignalMs, pickCharacter,
  type AnimName, type CharacterName, type OrderStatus, type Phase, type SeatState,
} from './seatState'

export interface OrderRow {
  id: string; project_id: string; wbs_item_id: string | null; status: OrderStatus
  claimed_by: string | null; claimed_by_user_id: string | null; claimed_at: string | null
  created_at: string; updated_at: string
  last_heartbeat_at: string | null; heartbeat_phase: string | null; heartbeat_agent: string | null; heartbeat_note: string | null
}
export interface ItemRow { id: string; project_id: string; code: string; name: string; parent_id: string | null; actual_pct: number | null }
export interface ReviewRow { work_order_id: string; review_action: 'approve' | 'reject' | null; review_note: string | null; created_at: string }
export interface WatcherRow {
  id: string; user_id: string; project_id: string | null; agent: string; host: string | null
  slots: number | null; busy: number | null; until_label: string | null; last_seen_at: string
}
export interface ProjectRow { id: string; name: string }
export interface SeatmapRows {
  orders: OrderRow[]; items: ItemRow[]; parents: ItemRow[]; reviews: ReviewRow[]; watchers: WatcherRow[]; projects: ProjectRow[]
}

export interface Seat {
  orderId: string; id8: string; projectId: string; itemId: string | null; code: string; name: string
  state: SeatState; phase: Phase; anim: AnimName; character: CharacterName
  agent: string | null; progress: number
  lastSignalAt: string | null; heartbeatAt: string | null; heartbeatPhase: string | null
  note: string | null; rejected: boolean; reviewNote: string | null
}
export interface Zone { key: string; code: string; name: string; seats: Seat[]; summary: { work: number; wait: number; done: number; ready: number } }
export interface Watcher { agent: string; host: string | null; slots: number | null; busy: number | null; untilLabel: string | null; lastSeenAt: string; projectId: string | null }
export interface Floor { id: string; name: string; zones: Zone[]; seatCount: number; doneCount: number; watchers: Watcher[] }
export interface Attention { orderId: string; id8: string; floorName: string; code: string; name: string; state: SeatState; why: string }
export interface Seatmap {
  floors: Floor[]
  counters: { active: number; standby: number; idle: number; offline: number }
  attention: Attention[]
  fetchedAt: string
}

const WORK_STATES: readonly SeatState[] = ['ACTIVE', 'STALE', 'REJECTED', 'BLOCKED']
const ATTENTION_ORDER: readonly SeatState[] = ['BLOCKED', 'STALE', 'OFFLINE', 'REJECTED']

export function ageLabel(fromIso: string | null, nowMs: number): string {
  if (!fromIso) return '—'
  const sec = Math.max(0, Math.floor((nowMs - Date.parse(fromIso)) / 1000))
  if (sec < 60) return `${sec}초 전`
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`
  return `${Math.floor(sec / 3600)}시간 ${Math.floor((sec % 3600) / 60)}분 전`
}

/** 주문별 마지막 completion 보고(가장 늦은 created_at). */
function latestReviewByOrder(reviews: ReviewRow[]): Map<string, ReviewRow> {
  const out = new Map<string, ReviewRow>()
  for (const r of reviews) {
    const cur = out.get(r.work_order_id)
    if (!cur || Date.parse(r.created_at) > Date.parse(cur.created_at)) out.set(r.work_order_id, r)
  }
  return out
}

function toSeat(o: OrderRow, item: ItemRow | undefined, review: ReviewRow | undefined, nowMs: number): Seat {
  const input = {
    status: o.status, lastHeartbeatAt: o.last_heartbeat_at, heartbeatPhase: o.heartbeat_phase,
    updatedAt: o.updated_at, lastReview: review?.review_action ?? null, actualPct: item?.actual_pct ?? null,
  }
  const state = deriveSeatState(input, nowMs)
  const phase = inferPhase(input)
  // WAIT 의 idle 3종은 10초 슬롯으로 순환한다 — 서버·클라이언트가 같은 슬롯을 계산하도록 nowMs 기준.
  const idleSlot = Math.floor(nowMs / 10_000)
  const agent = o.heartbeat_agent ?? o.claimed_by
  const signal = Number.isNaN(lastSignalMs(input)) ? null : new Date(lastSignalMs(input)).toISOString()
  return {
    orderId: o.id, id8: o.id.slice(0, 8), projectId: o.project_id, itemId: o.wbs_item_id,
    code: item?.code ?? o.id.slice(0, 8), name: item?.name ?? '(항목 삭제됨)',
    state, phase, anim: animFor(state, phase, idleSlot), character: pickCharacter(agent ?? o.id),
    agent, progress: Math.max(0, Math.min(100, Math.round(item?.actual_pct ?? 0))),
    lastSignalAt: o.status === 'claimed' ? signal : null,
    heartbeatAt: o.last_heartbeat_at, heartbeatPhase: o.heartbeat_phase,
    note: o.heartbeat_phase === 'blocked' ? o.heartbeat_note : null,
    rejected: isRejected(input), reviewNote: review?.review_action === 'reject' ? review.review_note : null,
  }
}

function attentionWhy(s: Seat, nowMs: number): string {
  if (s.state === 'BLOCKED') return s.note ?? '결정 필요'
  if (s.state === 'STALE') return `무응답 ${ageLabel(s.lastSignalAt, nowMs)}`
  if (s.state === 'OFFLINE') return `끊김 ${ageLabel(s.lastSignalAt, nowMs)}`
  return s.reviewNote ? `반려 · ${s.reviewNote}` : '반려 · 재작업'
}

export function assembleSeatmap(rows: SeatmapRows, nowMs: number): Seatmap {
  const itemById = new Map(rows.items.map(i => [i.id, i]))
  const parentById = new Map(rows.parents.map(p => [p.id, p]))
  const reviewByOrder = latestReviewByOrder(rows.reviews)
  const projectName = new Map(rows.projects.map(p => [p.id, p.name]))

  // 층 → 구역 → 책상. 구역 키는 부모 항목 id, 부모가 없으면 고정 키 둘.
  const floorMap = new Map<string, Map<string, Zone>>()
  const done = new Map<string, number>()
  for (const o of rows.orders) {
    const item = o.wbs_item_id ? itemById.get(o.wbs_item_id) : undefined
    const seat = toSeat(o, item, reviewByOrder.get(o.id), nowMs)
    if (seat.state === 'DONE') { done.set(o.project_id, (done.get(o.project_id) ?? 0) + 1); continue }
    const zones = floorMap.get(o.project_id) ?? new Map<string, Zone>()
    floorMap.set(o.project_id, zones)
    let key: string, code: string, name: string
    if (!item) { key = '__no_item'; code = '—'; name = '항목 없음' }
    else if (item.parent_id && parentById.get(item.parent_id)) {
      const p = parentById.get(item.parent_id)!; key = p.id; code = p.code; name = p.name
    } else { key = '__no_parent'; code = '—'; name = '구역 없음' }
    const zone = zones.get(key) ?? { key, code, name, seats: [], summary: { work: 0, wait: 0, done: 0, ready: 0 } }
    zones.set(key, zone)
    zone.seats.push(seat)
    if (WORK_STATES.includes(seat.state)) zone.summary.work++
    else if (seat.state === 'WAIT') zone.summary.wait++
    else zone.summary.ready++ // READY · OFFLINE(빈 의자)
  }

  const aliveWatchers: Watcher[] = rows.watchers
    .filter(w => isWatcherAlive(w.last_seen_at, nowMs))
    .map(w => ({ agent: w.agent, host: w.host, slots: w.slots, busy: w.busy, untilLabel: w.until_label, lastSeenAt: w.last_seen_at, projectId: w.project_id }))
    .sort((a, b) => a.agent.localeCompare(b.agent))

  const floorIds = new Set<string>([...floorMap.keys(), ...done.keys()])
  const floors: Floor[] = [...floorIds].map(id => {
    const zones = [...(floorMap.get(id)?.values() ?? [])]
      .map(z => ({ ...z, seats: [...z.seats].sort((a, b) => a.code.localeCompare(b.code)) }))
      .sort((a, b) => a.code.localeCompare(b.code))
    return {
      id, name: projectName.get(id) ?? id, zones,
      seatCount: zones.reduce((n, z) => n + z.seats.length, 0),
      doneCount: done.get(id) ?? 0,
      watchers: aliveWatchers.filter(w => w.projectId === null || w.projectId === id),
    }
  }).sort((a, b) => a.name.localeCompare(b.name))

  const counters = { active: 0, standby: aliveWatchers.length, idle: 0, offline: 0 }
  const attention: Attention[] = []
  for (const f of floors) for (const z of f.zones) for (const s of z.seats) {
    if (WORK_STATES.includes(s.state)) counters.active++
    else if (s.state === 'WAIT') counters.idle++
    else counters.offline++
    if (ATTENTION_ORDER.includes(s.state)) {
      attention.push({ orderId: s.orderId, id8: s.id8, floorName: f.name, code: s.code, name: s.name, state: s.state, why: attentionWhy(s, nowMs) })
    }
  }
  attention.sort((a, b) => ATTENTION_ORDER.indexOf(a.state) - ATTENTION_ORDER.indexOf(b.state))

  return { floors, counters, attention, fetchedAt: new Date(nowMs).toISOString() }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/seatmap.test.ts tests/domain/seat-state.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/seatmap.ts tests/domain/seatmap.test.ts
git commit -m "feat(domain): 좌석표 조립 — 층은 프로젝트, 구역은 부모 항목, 확인 필요는 BLOCKED·STALE·OFFLINE·REJECTED 순"
```

---

### Task 4: `POST /api/v1/agent/work/{id}/heartbeat`

**Files:**
- Create: `src/app/api/v1/agent/work/[id]/heartbeat/route.ts`
- Test: `tests/agent/heartbeat-route.test.ts`

**Interfaces:**
- Consumes: `resolveWriteActor`·`loadGatedOrderForUser`·`loadGatedOrder`·`parseAgentActor`(`@/lib/agent/routeShared`), `apiBadRequest`·`apiFail`·`apiInternalError`·`apiNotFound`(`@/lib/agent/externalApi`), `isUuidLike`(`@/lib/domain/agentWork`), `HEARTBEAT_PHASES`(Task 2).
- Produces: 요청 `{ agent: string; phase?: Phase; note?: string }` → 200 `{ ok: true, last_heartbeat_at: string }`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/agent/heartbeat-route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { POST } from '@/app/api/v1/agent/work/[id]/heartbeat/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
type Resp = { data?: unknown; error?: { message: string } | null }
const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', token_prefix: PAT.prefix, token_hash: PAT.hash,
  project_id: null, scopes: ['work:claim'], enabled: true, revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}
const ORDER = { id: O1, project_id: P1, status: 'claimed', claimed_by: 'pat-r-1', claimed_by_user_id: 'u-1', wbs_item_id: null }

/** 큐 순서(work-routes-pat.test.ts 상세 조회와 같다): agent_runners(조회, last_seen) → 주문 → agent_projects → memberships → project_roles → 주문 update */
function useAdmin(queues: Record<string, Resp[]>, calls: Record<string, unknown[]> = {}) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.update = (payload: unknown) => { (calls[table] ??= []).push(payload); return b }
      b.insert = (payload: unknown) => { (calls[`${table}:insert`] ??= []).push(payload); return b }
      for (const k of ['eq', 'in', 'limit', 'order']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'dev@example.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const post = (body: unknown, bearer = PAT.token) =>
  POST(new NextRequest(`http://l/api/v1/agent/work/${O1}/heartbeat`, {
    method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: O1 }) })
const okQueues = (order = ORDER) => ({
  agent_runners: [{ data: RUNNER }, { data: null }],
  agent_work_orders: [{ data: order }, { data: [{ id: O1 }] }],
  agent_projects: [{ data: { enabled: true } }],
  memberships: [{ data: { is_superuser: false } }],
  project_roles: [{ data: [{ role: 'member' }] }],
})

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
})

describe('POST /agent/work/[id]/heartbeat', () => {
  it('200 — 열 4개를 touch 하고 보고 행은 만들지 않는다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls)
    const res = await post({ agent: 'hong/mbp/w1', phase: 'build' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.last_heartbeat_at).toBe('string')
    const upd = calls.agent_work_orders?.[0] as Record<string, unknown>
    expect(upd.heartbeat_agent).toBe('hong/mbp/w1')
    expect(upd.heartbeat_phase).toBe('build')
    expect(upd.heartbeat_note).toBeNull()
    expect(upd.last_heartbeat_at).toBe(body.last_heartbeat_at)
    expect(upd.updated_at).toBe(body.last_heartbeat_at)
    expect(calls['agent_work_reports:insert']).toBeUndefined()
  })
  it('blocked 는 note 를 저장하고, phase 생략은 phase·note 를 null 로 둔다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls)
    await post({ agent: 'hong/mbp/w1', phase: 'blocked', note: '어느 DB 를 쓸까요?' })
    expect((calls.agent_work_orders[0] as Record<string, unknown>).heartbeat_note).toBe('어느 DB 를 쓸까요?')
    const calls2: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls2)
    await post({ agent: 'hong/mbp/w1' })
    const upd = calls2.agent_work_orders[0] as Record<string, unknown>
    expect(upd.heartbeat_phase).toBeNull(); expect(upd.heartbeat_note).toBeNull()
  })
  it('400 — agent 없음 / 모르는 phase / note 500자 초과', async () => {
    useAdmin(okQueues()); expect((await post({ phase: 'build' })).status).toBe(400)
    useAdmin(okQueues()); expect((await post({ agent: 'a', phase: 'lunch' })).status).toBe(400)
    useAdmin(okQueues()); expect((await post({ agent: 'a', phase: 'blocked', note: 'x'.repeat(501) })).status).toBe(400)
  })
  it('409 — claimed 가 아니면 touch 하지 않는다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues({ ...ORDER, status: 'reported' }), calls)
    const res = await post({ agent: 'a', phase: 'build' })
    expect(res.status).toBe(409)
    expect(calls.agent_work_orders).toBeUndefined()
  })
  it('403 not_claim_owner — 다른 사용자가 점유한 주문', async () => {
    useAdmin(okQueues({ ...ORDER, claimed_by_user_id: 'u-9' }))
    const res = await post({ agent: 'a', phase: 'build' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_claim_owner')
  })
  it('409 conflict — CAS 0행(경합으로 상태가 바뀜)', async () => {
    useAdmin({ ...okQueues(), agent_work_orders: [{ data: ORDER }, { data: [] }] })
    expect((await post({ agent: 'a', phase: 'build' })).status).toBe(409)
  })
  it('403 insufficient_scope — work:read 만 있는 PAT', async () => {
    useAdmin({ ...okQueues(), agent_runners: [{ data: { ...RUNNER, scopes: ['work:read'] } }, { data: null }] })
    expect((await post({ agent: 'a', phase: 'build' })).status).toBe(403)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/heartbeat-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/v1/agent/work/[id]/heartbeat/route'`

- [ ] **Step 3: 라우트 구현**

```ts
// src/app/api/v1/agent/work/[id]/heartbeat/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuidLike } from '@/lib/domain/agentWork'
import { HEARTBEAT_PHASES } from '@/lib/domain/seatState'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound } from '@/lib/agent/externalApi'
import { loadGatedOrder, loadGatedOrderForUser, parseAgentActor, resolveWriteActor } from '@/lib/agent/routeShared'

/**
 * heartbeat — 좌석표 v1 스펙 §3-2. 진행 중 주문의 "살아 있음"을 서버에 남긴다.
 * report 와 달리 보고 행·스냅샷·알림·revalidate 가 없다: 60초마다 오는 신호가 행을 늘리면
 * 승인 화면의 이력이 오염되고 디스크가 찬다(2026-08-05 장애 경로). 열 4개 touch 뿐이다.
 */
export const dynamic = 'force-dynamic'

const AGENT_MAX = 120
const NOTE_MAX = 500

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!isUuidLike(id)) return apiBadRequest('id 형식이 올바르지 않습니다.')
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const agent = typeof b.agent === 'string' ? b.agent.trim() : ''
  if (!agent || agent.length > AGENT_MAX) return apiBadRequest(`agent 는 1~${AGENT_MAX}자여야 합니다.`)
  const phase = b.phase === undefined || b.phase === null ? null : b.phase
  if (phase !== null && (typeof phase !== 'string' || !(HEARTBEAT_PHASES as readonly string[]).includes(phase))) {
    return apiBadRequest(`phase 는 ${HEARTBEAT_PHASES.join('|')} 중 하나여야 합니다.`)
  }
  const note = typeof b.note === 'string' ? b.note.trim() : ''
  if (note.length > NOTE_MAX) return apiBadRequest(`note 는 ${NOTE_MAX}자 이하여야 합니다.`)

  try {
    const admin = createAdminClient()
    const actor = await resolveWriteActor(req, admin, raw, 'work:claim')
    if (!actor.ok) return actor.res
    const loaded = actor.principal.kind === 'pat'
      ? await loadGatedOrderForUser(admin, id, actor.userId as string, actor.principal.userEmail, actor.principal)
      : await loadGatedOrder(admin, id, (parseAgentActor(raw) as { userEmail: string }).userEmail)
    if (!loaded.ok) return loaded.res
    const order = loaded.order
    if (order.status !== 'claimed') {
      return apiFail(409, 'conflict', `heartbeat 가능한 상태가 아닙니다(현재: ${order.status}).`)
    }
    // 소유 판정 — report 라우트와 같은 규칙(교차 소유 양방향 403).
    if (actor.principal.kind === 'pat') {
      if (order.claimed_by_user_id === null) return apiFail(403, 'not_claim_owner', '레거시 세션이 점유한 주문입니다.')
      if (order.claimed_by_user_id !== actor.userId) return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 처리할 수 있습니다.')
    } else {
      if (order.claimed_by_user_id !== null) return apiFail(403, 'not_claim_owner', 'PAT 사용자가 점유한 주문입니다.')
      if (order.claimed_by !== actor.agentLabel) return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 처리할 수 있습니다.')
    }

    const now = new Date().toISOString()
    // phase 를 생략하면 null — 사람이 답한 뒤 팀원의 다음 heartbeat 가 BLOCKED 를 푼다(훅은 항상 phase 를 보낸다).
    const { data: updated, error } = await admin
      .from('agent_work_orders')
      .update({
        last_heartbeat_at: now, updated_at: now, heartbeat_agent: agent,
        heartbeat_phase: phase, heartbeat_note: phase === 'blocked' && note ? note : null,
      })
      .eq('id', id).eq('status', 'claimed')
      .select('id')
    if (error) {
      console.error('[agent-api] heartbeat 갱신 실패:', error.message)
      return apiInternalError()
    }
    if (!updated || (updated as unknown[]).length === 0) {
      return apiFail(409, 'conflict', '주문 상태가 바뀌어 heartbeat 를 기록하지 못했습니다.')
    }
    return NextResponse.json({ ok: true, last_heartbeat_at: now })
  } catch (e) {
    console.error('[agent-api] heartbeat 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/agent/heartbeat-route.test.ts tests/agent/work-routes-pat.test.ts`
Expected: PASS. 큐 순서가 어긋나 404 가 나오면 `loadGatedOrderForUser` 의 호출 순서(주문 → agent_projects → memberships → project_roles)를 기존 상세 조회 테스트와 대조한다.

- [ ] **Step 5: 커밋**

```bash
git add "src/app/api/v1/agent/work/[id]/heartbeat/route.ts" tests/agent/heartbeat-route.test.ts
git commit -m "feat(api): 주문 heartbeat 라우트 — 보고 행 없이 열만 touch, phase 생략이 blocked 를 푼다"
```

---

### Task 5: `POST /api/v1/agent/watch` — 감시자 존재 신호(upsert · stop)

**Files:**
- Create: `src/app/api/v1/agent/watch/route.ts`
- Test: `tests/agent/watch-route.test.ts`

**Interfaces:**
- Consumes: `resolveAgentPrincipal`·`requireScope`·`apiBadRequest`·`apiFail`·`apiInternalError`·`apiNotFound`(`@/lib/agent/externalApi`), `isUuidLike`(`@/lib/domain/agentWork`), `WATCHER_TTL_MS`(Task 2).
- Produces: 요청 `{ agent: string; host?: string; slots?: number; busy?: number; until?: string; project_id?: string; stop?: boolean }` → 200 `{ ok: true, expires_at: string }` 또는 `{ ok: true, stopped: true }`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/agent/watch-route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'
import { WATCHER_TTL_MS } from '@/lib/domain/seatState'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { POST } from '@/app/api/v1/agent/watch/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '99999999-9999-4999-8999-999999999999'
type Resp = { data?: unknown; error?: { message: string } | null }
const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', token_prefix: PAT.prefix, token_hash: PAT.hash,
  project_id: null, scopes: ['work:claim'], enabled: true, revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}

function useAdmin(queues: Record<string, Resp[]>, calls: Record<string, unknown[]> = {}) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.upsert = (payload: unknown, opts: unknown) => { (calls[`${table}:upsert`] ??= []).push([payload, opts]); return b }
      b.delete = () => { (calls[`${table}:delete`] ??= []).push(true); return b }
      b.update = () => b
      for (const k of ['eq', 'lt', 'in', 'limit', 'order']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'dev@example.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const post = (body: unknown, bearer = PAT.token) =>
  POST(new NextRequest('http://l/api/v1/agent/watch', {
    method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
const runnerQueues = (runner = RUNNER) => ({ agent_runners: [{ data: runner }, { data: null }], agent_watchers: [{ data: null }, { data: null }] })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
})

describe('POST /agent/watch', () => {
  it('200 — (user_id, agent) 로 upsert 하고 expires_at = last_seen_at + 70분', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(runnerQueues(), calls)
    const res = await post({ agent: 'hong/mbp/lead', host: 'mbp', slots: 3, busy: 1, until: '18:00' })
    expect(res.status).toBe(200)
    const body = await res.json()
    const [payload, opts] = calls['agent_watchers:upsert'][0] as [Record<string, unknown>, Record<string, unknown>]
    expect(payload).toMatchObject({ user_id: 'u-1', agent: 'hong/mbp/lead', host: 'mbp', slots: 3, busy: 1, until_label: '18:00', project_id: null })
    expect(opts).toEqual({ onConflict: 'user_id,agent' })
    expect(Date.parse(body.expires_at) - Date.parse(payload.last_seen_at as string)).toBe(WATCHER_TTL_MS)
  })
  it('오래된 행(7일)을 같은 호출에서 지운다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(runnerQueues(), calls)
    await post({ agent: 'hong/mbp/lead' })
    expect(calls['agent_watchers:delete']).toHaveLength(1)
  })
  it('stop: true — 행을 지우고 stopped 로 답한다(upsert 없음)', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(runnerQueues(), calls)
    const res = await post({ agent: 'hong/mbp/lead', stop: true })
    expect((await res.json())).toEqual({ ok: true, stopped: true })
    expect(calls['agent_watchers:upsert']).toBeUndefined()
    expect(calls['agent_watchers:delete']).toHaveLength(1)
  })
  it('프로젝트 한정 PAT 는 project_id 를 강제하고, 다른 값이면 403 forbidden_role', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(runnerQueues({ ...RUNNER, project_id: P1 }), calls)
    const ok = await post({ agent: 'a' })
    expect(ok.status).toBe(200)
    expect((calls['agent_watchers:upsert'][0] as [Record<string, unknown>])[0].project_id).toBe(P1)
    useAdmin(runnerQueues({ ...RUNNER, project_id: P1 }))
    expect((await post({ agent: 'a', project_id: P2 })).status).toBe(403)
  })
  it('400 — agent 없음 / project_id 형식 오류 / slots 음수', async () => {
    useAdmin(runnerQueues()); expect((await post({})).status).toBe(400)
    useAdmin(runnerQueues()); expect((await post({ agent: 'a', project_id: 'nope' })).status).toBe(400)
    useAdmin(runnerQueues()); expect((await post({ agent: 'a', slots: -1 })).status).toBe(400)
  })
  it('레거시 시크릿 → 400 identity_required (PAT 전용)', async () => {
    useAdmin(runnerQueues())
    const res = await post({ agent: 'a' }, 'legacy-secret')
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('identity_required')
  })
  it('403 insufficient_scope — work:read 만 있는 PAT', async () => {
    useAdmin(runnerQueues({ ...RUNNER, scopes: ['work:read'] }))
    expect((await post({ agent: 'a' })).status).toBe(403)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/watch-route.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 라우트 구현**

```ts
// src/app/api/v1/agent/watch/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuidLike } from '@/lib/domain/agentWork'
import { WATCHER_TTL_MS } from '@/lib/domain/seatState'
import {
  apiBadRequest, apiFail, apiInternalError, apiNotFound, requireScope, resolveAgentPrincipal,
} from '@/lib/agent/externalApi'

/**
 * watch — 감시자(팀장 /dflow-team · 단독 /dflow-poll) 존재 신호. 좌석표 v1 스펙 §3-3.
 * (user_id, agent) 당 1행 upsert. 살아 있음(TTL 70분)은 화면이 판정하고, stop 은 행을 지운다.
 * PAT 전용 — 레거시 시크릿은 신원이 없어 user_id 를 못 채운다.
 */
export const dynamic = 'force-dynamic'

const AGENT_MAX = 120
const STALE_ROW_MS = 7 * 24 * 3600_000

function nonNegInt(v: unknown, name: string): number | null | { error: string } {
  if (v === undefined || v === null) return null
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return { error: `${name} 은 0 이상의 정수여야 합니다.` }
  return v
}

export async function POST(req: NextRequest) {
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const agent = typeof b.agent === 'string' ? b.agent.trim() : ''
  if (!agent || agent.length > AGENT_MAX) return apiBadRequest(`agent 는 1~${AGENT_MAX}자여야 합니다.`)
  const stop = b.stop === true
  const host = typeof b.host === 'string' && b.host.trim() ? b.host.trim().slice(0, 80) : null
  const until = typeof b.until === 'string' && b.until.trim() ? b.until.trim().slice(0, 16) : null
  const slots = nonNegInt(b.slots, 'slots'); if (slots !== null && typeof slots === 'object') return apiBadRequest(slots.error)
  const busy = nonNegInt(b.busy, 'busy'); if (busy !== null && typeof busy === 'object') return apiBadRequest(busy.error)
  const bodyProject = b.project_id === undefined || b.project_id === null ? null : b.project_id
  if (bodyProject !== null && (typeof bodyProject !== 'string' || !isUuidLike(bodyProject))) {
    return apiBadRequest('project_id 형식이 올바르지 않습니다.')
  }

  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    if (principal.kind === 'legacy') return apiFail(400, 'identity_required', '이 엔드포인트는 PAT 전용입니다.')
    const scopeErr = requireScope(principal, 'work:claim')
    if (scopeErr) return scopeErr
    // 프로젝트 한정 PAT 는 그 프로젝트로 강제 — 다른 값을 대면 사칭 신호라 조용히 덮지 않는다.
    let projectId: string | null = bodyProject
    if (principal.projectId !== null) {
      if (bodyProject !== null && bodyProject !== principal.projectId) {
        return apiFail(403, 'forbidden_role', 'PAT 가 한정된 프로젝트와 다릅니다.')
      }
      projectId = principal.projectId
    }

    if (stop) {
      const { error } = await admin.from('agent_watchers').delete().eq('user_id', principal.userId).eq('agent', agent)
      if (error) { console.error('[agent-api] watch stop 실패:', error.message); return apiInternalError() }
      return NextResponse.json({ ok: true, stopped: true })
    }

    const now = new Date()
    const { error: upErr } = await admin
      .from('agent_watchers')
      .upsert({
        user_id: principal.userId, project_id: projectId, agent, host, slots, busy,
        until_label: until, last_seen_at: now.toISOString(),
      }, { onConflict: 'user_id,agent' })
    if (upErr) { console.error('[agent-api] watch upsert 실패:', upErr.message); return apiInternalError() }
    // 청소를 따로 두지 않는다 — 7일 넘게 조용한 행은 여기서 지운다. 실패는 로깅만.
    const { error: gcErr } = await admin
      .from('agent_watchers').delete().lt('last_seen_at', new Date(now.getTime() - STALE_ROW_MS).toISOString())
    if (gcErr) console.error('[agent-api] watch 오래된 행 정리 실패:', gcErr.message)
    return NextResponse.json({ ok: true, expires_at: new Date(now.getTime() + WATCHER_TTL_MS).toISOString() })
  } catch (e) {
    console.error('[agent-api] watch 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/agent/watch-route.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/v1/agent/watch/route.ts tests/agent/watch-route.test.ts
git commit -m "feat(api): 감시자 watch 라우트 — (user, agent) upsert, stop 은 행 삭제, 7일 침묵 행은 같은 호출에서 정리"
```

---

### Task 6: `dflow.sh heartbeat` · `dflow.sh watch` + SKILL.md + 셸 문법 테스트

**Files:**
- Modify: `.claude/skills/dflow-work/scripts/dflow.sh` — `usage()`(21~34행), `cmd_progress` 뒤(241행 뒤), 디스패치 case(`progress)` 다음, 320행 부근)
- Modify: `.claude/skills/dflow-work/SKILL.md` — `### 진행 보고` 절(95행) 뒤에 두 절 추가
- Test: `tests/skills/shell-syntax.test.ts`

**Interfaces:**
- Consumes: Task 4·5 의 요청 본문.
- Produces: `dflow.sh heartbeat <ref> [--phase p] [--note n] [--agent id]`, `dflow.sh watch [--agent id] [--slots n] [--busy n] [--until HH:MM] [--project id] [--stop]`, 셸 함수 `slug()`·`agent_id_default()`·`watcher_id_default()`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/skills/shell-syntax.test.ts
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const DFLOW = join(root, '.claude/skills/dflow-work/scripts/dflow.sh')
const POLL = join(root, '.claude/skills/dflow-poll/scripts/poll.sh')
const HOOK = join(root, 'kit/hooks/heartbeat.sh')

describe('셸 스크립트 문법(sh -n) — 자동 회귀 가드가 없던 파일들', () => {
  for (const f of [DFLOW, POLL, HOOK]) {
    it(`${f.replace(root, '')} 는 POSIX sh 로 파싱된다`, () => {
      expect(() => execFileSync('sh', ['-n', f])).not.toThrow()
    })
  }
})

describe('dflow.sh heartbeat · watch 계약(좌석표 v1 스펙 §4-1)', () => {
  const src = readFileSync(DFLOW, 'utf8')
  it('usage 에 두 서브커맨드가 있다', () => {
    expect(src).toMatch(/heartbeat <ref> \[--phase p\] \[--note "<질문>"\] \[--agent id\]/)
    expect(src).toMatch(/watch \[--agent id\] \[--slots n\] \[--busy n\] \[--until HH:MM\] \[--project id\] \[--stop\]/)
  })
  it('디스패치에 두 case 가 있고 heartbeat 는 ref 를 요구한다', () => {
    expect(src).toMatch(/heartbeat\) \[ \$# -ge 1 \] \|\| usage; cmd_heartbeat "\$@" ;;/)
    expect(src).toMatch(/watch\) cmd_watch "\$@" ;;/)
  })
  it('git 은 DFLOW_GIT 로 주입 가능한 형태로만 부른다(팀장 스킬 후속 커밋과 충돌 방지)', () => {
    const fn = src.slice(src.indexOf('# ---- 좌석표 신호'), src.indexOf('cmd_done()'))
    expect(fn).not.toMatch(/(^|[^_A-Z}])git /m)
    expect(fn).toContain('${DFLOW_GIT:-git}')
  })
  it('SKILL.md 가 두 서브커맨드를 설명한다', () => {
    const skill = readFileSync(join(root, '.claude/skills/dflow-work/SKILL.md'), 'utf8')
    expect(skill).toContain('### heartbeat')
    expect(skill).toContain('### watch')
    expect(skill).toContain('DFLOW_WATCH=0')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/shell-syntax.test.ts`
Expected: FAIL — `kit/hooks/heartbeat.sh` ENOENT(Task 7 에서 생김)와 usage/디스패치 불일치. 이 Task 에서는 훅 파일 케이스만 남기고 나머지를 초록으로 만든다. 훅 케이스는 Task 7 이 완성한다.

- [ ] **Step 3: `usage()` 에 두 줄 추가** (`progress` 줄 다음)

```sh
  progress <ref> <pct 0-99> <요약>
  heartbeat <ref> [--phase p] [--note "<질문>"] [--agent id]
                         진행 중 신호(보고 행 없음). --agent 기본값은 워크트리 루트 .dflow-agent 첫 줄
  watch [--agent id] [--slots n] [--busy n] [--until HH:MM] [--project id] [--stop]
                         감시자 존재 신호(좌석표 STANDBY). 기본 agent 는 <신원>/<host>/poll
```

- [ ] **Step 4: 함수 추가** — `cmd_progress` 의 닫는 `}` 바로 뒤, `cmd_done()` 앞

```sh
# ---- 좌석표 신호(v1 스펙 §4-1) --------------------------------------------
# 슬러그: 소문자, [a-z0-9-] 밖은 '-' (팀장 스펙 §9-1 과 같은 규칙)
slug() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g'; }
# 기본 AGENT_ID: 워크트리 루트 .dflow-agent 첫 줄 → 없으면 claude-<host>
agent_id_default() {
  _top=$(${DFLOW_GIT:-git} rev-parse --show-toplevel 2>/dev/null || printf '%s' "$PWD")
  if [ -f "$_top/.dflow-agent" ]; then head -n 1 "$_top/.dflow-agent"; else printf 'claude-%s' "$(slug "$(hostname -s)")"; fi
}
# 기본 watcher id: <신원>/<host>/poll — 신원은 /me 의 user_email 로컬 파트
watcher_id_default() {
  _email=$(profile_email "$TOK") || die 3 "신원 확인 실패(/me)"
  printf '%s/%s/poll' "$(slug "${_email%%@*}")" "$(slug "$(hostname -s)")"
}

cmd_heartbeat() {
  _id=$(resolve_ref "$1"); shift
  _phase=''; _note=''; _agent=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --phase) _phase="${2:-}"; shift 2 || usage ;;
      --note)  _note="${2:-}";  shift 2 || usage ;;
      --agent) _agent="${2:-}"; shift 2 || usage ;;
      *) usage ;;
    esac
  done
  [ -n "$_agent" ] || _agent=$(agent_id_default)
  case "$_agent" in */parked) die 2 "parked 워크트리는 heartbeat 를 보내지 않습니다." ;; esac
  _json=$(jq -nc --arg a "$_agent" --arg p "$_phase" --arg n "$_note" \
    '{agent:$a} + (if $p != "" then {phase:$p} else {} end) + (if $n != "" then {note:$n} else {} end)')
  _body=$(TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/heartbeat" "$_json") || exit $?
  printf '%s' "$_body" | jq -r '.last_heartbeat_at'
}

cmd_watch() {
  _agent=''; _slots=''; _busy=''; _until=''; _project="${DFLOW_PROJECT_ID:-}"; _stop=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --agent)   _agent="${2:-}";   shift 2 || usage ;;
      --slots)   _slots="${2:-}";   shift 2 || usage ;;
      --busy)    _busy="${2:-}";    shift 2 || usage ;;
      --until)   _until="${2:-}";   shift 2 || usage ;;
      --project) _project="${2:-}"; shift 2 || usage ;;
      --stop)    _stop=1; shift ;;
      *) usage ;;
    esac
  done
  [ -n "$_agent" ] || _agent=$(watcher_id_default)
  _host=$(slug "$(hostname -s)")
  if [ -n "$_stop" ]; then
    _json=$(jq -nc --arg a "$_agent" '{agent:$a, stop:true}')
  else
    _json=$(jq -nc --arg a "$_agent" --arg h "$_host" --arg s "$_slots" --arg b "$_busy" --arg u "$_until" --arg p "$_project" \
      '{agent:$a, host:$h}
       + (if $s != "" then {slots:($s|tonumber)} else {} end)
       + (if $b != "" then {busy:($b|tonumber)} else {} end)
       + (if $u != "" then {until:$u} else {} end)
       + (if $p != "" then {project_id:$p} else {} end)')
  fi
  _body=$(TOKEN="$TOK" api_raw POST /api/v1/agent/watch "$_json") || exit $?
  if [ -n "$_stop" ]; then printf 'stopped\n'; else printf '%s' "$_body" | jq -r '.expires_at'; fi
}
```

- [ ] **Step 5: 디스패치 case 추가** — `progress)` 줄 다음

```sh
       progress) [ $# -ge 3 ] || usage; cmd_progress "$@" ;;
       heartbeat) [ $# -ge 1 ] || usage; cmd_heartbeat "$@" ;;
       watch) cmd_watch "$@" ;;
```

- [ ] **Step 6: SKILL.md 에 두 절 추가** — `### 진행 보고` 절 끝(`### 완료 보고` 앞)

```markdown
### heartbeat

`dflow.sh heartbeat <ref> [--phase p] [--note "<질문>"] [--agent id]` — 진행 중 신호. 보고 행을 만들지 않고
주문의 `last_heartbeat_at`·`heartbeat_phase`·`heartbeat_agent`·`heartbeat_note` 만 갱신한다. 평소에는 PostToolUse 훅
(`~/.dflow/hooks/heartbeat.sh`)이 60초에 1회 자동으로 보내므로 직접 부를 일은 두 가지뿐이다.
- 담당자 결정 대기 직전: `dflow.sh heartbeat <id8> --phase blocked --note "<질문>"`. 좌석표에 손 든 사람과 질문이 뜬다.
  답을 받은 뒤의 첫 heartbeat(훅이든 명시든, `--phase` 가 blocked 가 아닌 것)가 이 상태를 푼다.
- Phase 경계를 명시하고 싶을 때: `--phase design|build|verify|refactor|rejected|reported`.
`--agent` 기본값은 워크트리 루트 `.dflow-agent` 첫 줄, 없으면 `claude-<host>`. 값이 `*/parked` 면 보내지 않는다.
claimed 가 아니면 exit 4, 소유자가 아니면 exit 5.

### watch

`dflow.sh watch [--agent id] [--slots n] [--busy n] [--until HH:MM] [--project id] [--stop]` — 감시자 존재 신호.
좌석표 층 헤더의 STANDBY 배지가 이 신호로 켜지고, 마지막 신호 70분 뒤 꺼진다. `--stop` 은 즉시 끈다.
- `poll.sh` 가 매 주기 자동으로 보내고 `--until` 도달 시 `--stop` 을 보낸다. 팀장(`/dflow-team`) 아래에서 poll.sh 를 띄울 때는
  `DFLOW_WATCH=0` 을 붙여 끈다 — 팀장이 `<신원>/<host>/lead` 로 직접 보내기 때문이다.
- 기본 agent 는 `<신원>/<host>/poll`, `--project` 기본값은 `.env` 의 `DFLOW_PROJECT_ID`(없으면 전 프로젝트 = 모든 층에 표시).
```

- [ ] **Step 7: 통과 확인(훅 케이스 제외)**

Run: `sh -n .claude/skills/dflow-work/scripts/dflow.sh && npx vitest run tests/skills/shell-syntax.test.ts -t "dflow.sh"`
Expected: 문법 OK, `dflow.sh heartbeat · watch 계약` 4건 PASS. (`-t` 로 훅 파일 케이스는 이 단계에서 제외한다.)

수동 확인(스테이징, 워크트리 루트, Task 4·5 가 스테이징에 배포되기 전이면 404 가 정상):
```bash
set -a; . ./.env; set +a
.claude/skills/dflow-work/scripts/dflow.sh watch --slots 1 --busy 0 --until 18:00; echo "exit $?"
```

- [ ] **Step 8: 커밋**

```bash
git add .claude/skills/dflow-work/scripts/dflow.sh .claude/skills/dflow-work/SKILL.md tests/skills/shell-syntax.test.ts
git commit -m "feat(dflow-work): heartbeat·watch 서브커맨드 — 좌석표 신호를 CLI 로도 보낼 수 있게 하고 셸 문법 회귀 가드를 둔다"
```

---

### Task 7: PostToolUse 훅 `kit/hooks/heartbeat.sh` + 킷 설치 + `poll.sh` watch 호출

**Files:**
- Create: `kit/hooks/heartbeat.sh`
- Modify: `kit/install.sh` — 4) 버전 표식 앞에 훅 복사 블록, 안내문에 한 항목
- Modify: `kit/README.md` — 파일 끝에 `## 좌석표 heartbeat 훅` 절
- Modify: `scripts/kit-build.sh` — `cp "$ROOT/kit/README.md"` 줄 다음에 `hooks/` 복사
- Modify: `.claude/skills/dflow-poll/scripts/poll.sh` — 13행 `UNTIL` 옆 `UNTIL_LABEL`, `--until` 파싱, 53행 종료 분기, 55행 앞 watch 호출
- Test: `tests/skills/shell-syntax.test.ts`(Task 6 에서 만든 훅 케이스가 이제 통과) + `tests/skills/heartbeat-hook.test.ts`

**Interfaces:**
- Consumes: Task 4 요청 본문 `{ agent, phase }`, Task 6 의 `dflow.sh watch`.
- Produces: `~/.dflow/hooks/heartbeat.sh`(설치 위치), `~/.dflow/hb/<order>` 절제 파일, `poll.sh` 의 `DFLOW_WATCH` env.

- [ ] **Step 1: 훅 동작 테스트 작성** (실제 curl 대신 `CURL` 환경변수로 가짜 curl 을 주입한다)

```ts
// tests/skills/heartbeat-hook.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOOK = join(process.cwd(), 'kit/hooks/heartbeat.sh')
let tmp: string, repo: string, home: string, log: string

function git(...args: string[]) { execFileSync('git', args, { cwd: repo, stdio: 'ignore' }) }
function run(cwd = repo, env: Record<string, string> = {}) {
  execFileSync('sh', [HOOK], {
    cwd, input: JSON.stringify({ cwd, tool_name: 'Bash' }),
    env: { PATH: process.env.PATH ?? '', HOME: home, CURL: join(tmp, 'fakecurl'), ...env },
    stdio: ['pipe', 'ignore', 'ignore'],
  })
  // 백그라운드 curl 이 로그를 쓸 시간을 준다
  execFileSync('sh', ['-c', 'sleep 0.3'])
}
const sent = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [])

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hb-'))
  repo = join(tmp, 'repo'); home = join(tmp, 'home'); log = join(tmp, 'curl.log')
  mkdirSync(repo); mkdirSync(home)
  writeFileSync(join(tmp, 'fakecurl'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\n`, { mode: 0o755 })
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(repo, '.env'), 'DFLOW_API_BASE=https://x.test\nDFLOW_PATS=dfl_u_abc_secret\n')
  mkdirSync(join(repo, 'docs/tasks/TSK-01'), { recursive: true })
  writeFileSync(join(repo, 'docs/tasks/TSK-01/state.json'), JSON.stringify({ tsk: 'TSK-01', order: '22222222-2222-4222-8222-222222222222', phase: 'build' }))
  writeFileSync(join(repo, 'README'), 'x'); git('add', '.'); git('commit', '-q', '-m', 'init')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('heartbeat.sh — 스펙 §4-2', () => {
  it('.dflow-agent 가 있으면 그 값으로 order 의 heartbeat 를 보낸다(phase 는 state.json)', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    run()
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toContain('/api/v1/agent/work/22222222-2222-4222-8222-222222222222/heartbeat')
    expect(sent()[0]).toContain('"agent":"hong/mbp/w2"')
    expect(sent()[0]).toContain('"phase":"build"')
    expect(sent()[0]).toContain('--max-time 1.5')
  })
  it('.dflow-agent 가 없고 브랜치가 agent/ 로 시작하면 claude-<host> 로 보낸다', () => {
    git('switch', '-q', '-c', 'agent/abcd1234-slug')
    run()
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toMatch(/"agent":"claude-[a-z0-9-]+"/)
  })
  it('.dflow-agent 가 없고 기본 브랜치면 아무것도 보내지 않는다(팀장 세션)', () => {
    run(); expect(sent()).toHaveLength(0)
  })
  it('parked 는 침묵한다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/parked\n')
    run(); expect(sent()).toHaveLength(0)
  })
  it('진행 중 state.json 이 없으면(전부 reported/merged) 보내지 않는다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, 'docs/tasks/TSK-01/state.json'), JSON.stringify({ tsk: 'TSK-01', order: '2'.repeat(8), phase: 'merged' }))
    run(); expect(sent()).toHaveLength(0)
  })
  it('60초 절제: 두 번 연속 실행하면 한 번만 보낸다, 절제 파일이 오래되면 다시 보낸다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    run(); run()
    expect(sent()).toHaveLength(1)
    const stamp = join(home, '.dflow/hb/22222222-2222-4222-8222-222222222222')
    const old = new Date(Date.now() - 120_000)
    utimesSync(stamp, old, old)
    run()
    expect(sent()).toHaveLength(2)
  })
  it('.env 에 API_BASE 나 PAT 가 없으면 보내지 않는다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, '.env'), 'DFLOW_API_BASE=https://x.test\n')
    run(); expect(sent()).toHaveLength(0)
  })
  it('git 리포가 아닌 cwd 에서는 조용히 끝난다', () => {
    const plain = join(tmp, 'plain'); mkdirSync(plain)
    run(plain); expect(sent()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/heartbeat-hook.test.ts`
Expected: FAIL — `kit/hooks/heartbeat.sh` 없음

- [ ] **Step 3: 훅 작성**

```sh
#!/bin/sh
# heartbeat.sh — Claude Code PostToolUse 훅. 진행 중인 D'Flow 작업의 "살아 있음"을 서버에 남긴다.
# 설치: ~/.dflow/hooks/heartbeat.sh (kit/install.sh --hooks). 등록: ~/.claude/settings.json hooks.PostToolUse.
# 규칙(좌석표 v1 스펙 §4-2): 조건이 하나라도 안 맞으면 조용히 exit 0. 출력 없음. 실패 무시. 60초에 1회.
# dflow.sh 를 거치지 않는 이유: api_raw 는 타임아웃이 없고 비-2xx 마다 exit 하며 임시파일을 쓴다.
set -u
GIT=$(command -v git 2>/dev/null) || exit 0
CURL="${CURL:-$(command -v curl 2>/dev/null)}"; [ -n "$CURL" ] || exit 0
JQ=$(command -v jq 2>/dev/null) || exit 0

# 1) cwd: 훅 입력 JSON 의 cwd, 없으면 $PWD. stdin 은 반드시 배수한다.
_in=$(cat 2>/dev/null || :)
_cwd=$(printf '%s' "$_in" | "$JQ" -r '.cwd // empty' 2>/dev/null || :)
[ -n "$_cwd" ] && [ -d "$_cwd" ] || _cwd="$PWD"
_top=$("$GIT" -C "$_cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0

# 2) AGENT_ID: .dflow-agent 첫 줄. parked 면 침묵. 없으면 agent/ 브랜치일 때만 claude-<host>.
if [ -f "$_top/.dflow-agent" ]; then
  _agent=$(head -n 1 "$_top/.dflow-agent" 2>/dev/null | tr -d '\r')
  [ -n "$_agent" ] || exit 0
  case "$_agent" in */parked) exit 0 ;; esac
else
  _branch=$("$GIT" -C "$_top" rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
  case "$_branch" in agent/*) ;; *) exit 0 ;; esac
  _agent="claude-$(hostname -s 2>/dev/null | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')"
fi

# 3) 대상 작업: 진행 중 phase 의 state.json 중 최신. 브랜치 이름에서 TSK 를 뽑지 않는다.
_state=''
for _f in $(ls -t "$_top"/docs/tasks/*/state.json 2>/dev/null); do
  _ph=$("$JQ" -r '.phase // empty' "$_f" 2>/dev/null || :)
  case "$_ph" in design|build|verify|refactor|rejected) _state="$_f"; break ;; esac
done
[ -n "$_state" ] || exit 0
_order=$("$JQ" -r '.order // empty' "$_state" 2>/dev/null || :)
_phase=$("$JQ" -r '.phase // empty' "$_state" 2>/dev/null || :)
case "$_order" in ????????-????-????-????-????????????) ;; *) exit 0 ;; esac

# 4) 절제: ~/.dflow/hb/<order> mtime 이 60초 안이면 종료.
_hbdir="${HOME:-/tmp}/.dflow/hb"; mkdir -p "$_hbdir" 2>/dev/null || exit 0
_stamp="$_hbdir/$_order"
if [ -f "$_stamp" ]; then
  _now=$(date +%s); _mt=$(stat -f %m "$_stamp" 2>/dev/null || stat -c %Y "$_stamp" 2>/dev/null || echo 0)
  [ $((_now - _mt)) -ge 60 ] || exit 0
fi
: > "$_stamp"

# 5) 인증: 루트 .env (팀원 워크트리에는 심링크가 있다). 토큰은 env 로만 다룬다 — 출력·기록 금지.
[ -f "$_top/.env" ] || exit 0
set -a; . "$_top/.env" 2>/dev/null; set +a
_base="${DFLOW_API_BASE:-}"; [ -n "$_base" ] || exit 0
_tok="${DFLOW_PATS%%,*}"; [ -n "$_tok" ] || _tok="${DFLOW_PAT:-}"; [ -n "$_tok" ] || exit 0

# 6) fire-and-forget. 응답·실패는 보지 않는다.
_json=$("$JQ" -nc --arg a "$_agent" --arg p "$_phase" '{agent:$a, phase:$p}')
"$CURL" -s -o /dev/null --max-time 1.5 -X POST \
  -H "Authorization: Bearer $_tok" -H 'Content-Type: application/json' \
  --data "$_json" "${_base%/}/api/v1/agent/work/$_order/heartbeat" >/dev/null 2>&1 &
exit 0
```

`chmod +x kit/hooks/heartbeat.sh`.

- [ ] **Step 4: 훅 테스트 통과 확인**

Run: `npx vitest run tests/skills/heartbeat-hook.test.ts tests/skills/shell-syntax.test.ts`
Expected: PASS 전부(Task 6 에서 남겨 둔 훅 문법 케이스 포함). `stat -f` 가 Linux 에서 실패하면 `stat -c` 폴백이 잡는다.

- [ ] **Step 5: `kit/install.sh` — 훅 복사(`--hooks`) 와 안내**

`# 4) 버전 표식` 블록 앞에 추가:
```sh
# 3-b) 좌석표 heartbeat 훅 — --hooks 를 붙였을 때만 ~/.dflow/hooks 에 복사한다. settings.json 은 건드리지 않는다(안내만).
if [ "${2:-}" = "--hooks" ]; then
  mkdir -p "$HOME/.dflow/hooks"
  cp "$KIT_DIR/hooks/heartbeat.sh" "$HOME/.dflow/hooks/heartbeat.sh" && chmod +x "$HOME/.dflow/hooks/heartbeat.sh"
  echo "훅 복사: $HOME/.dflow/hooks/heartbeat.sh — ~/.claude/settings.json 등록은 README 「좌석표 heartbeat 훅」 참조"
fi
```
사용법 줄(3행·10행)을 `install.sh <대상 리포 경로> [--hooks]` 로 고치고, 마지막 안내 heredoc 에 `5. 좌석표 heartbeat 훅: ./install.sh <리포> --hooks 뒤 README 「좌석표 heartbeat 훅」 대로 settings.json 등록` 한 줄을 더한다.

- [ ] **Step 6: `scripts/kit-build.sh` — 훅 동봉**

`cp "$ROOT/kit/README.md" "$OUT/README.md"` 줄 다음:
```sh
mkdir -p "$OUT/hooks" && cp "$ROOT/kit/hooks/heartbeat.sh" "$OUT/hooks/heartbeat.sh" && chmod +x "$OUT/hooks/heartbeat.sh"
```

- [ ] **Step 7: `kit/README.md` 끝에 절 추가**

```markdown

## 좌석표 heartbeat 훅

D'Flow 좌석표(`/agents`)가 "진행 중/무응답/끊김"을 구분하려면 에이전트가 도구를 쓸 때마다 60초에 1회 신호가 서버에 닿아야 한다.
훅은 진행 중 작업(`docs/tasks/*/state.json` 의 phase 가 design/build/verify/refactor/rejected)이 있는 워크트리에서만 보내고,
`.dflow-agent` 가 없으면 `agent/` 브랜치에서만 보낸다. 기본 브랜치의 팀장 세션에서는 아무것도 보내지 않는다.

1. `./install.sh <리포> --hooks` → `~/.dflow/hooks/heartbeat.sh`
2. `~/.claude/settings.json` 의 `hooks.PostToolUse` 배열에 아래 원소를 추가한다(기존 원소는 그대로 둔다):
   ```json
   { "matcher": "*", "hooks": [ { "type": "command", "timeout": 5,
     "command": "if [ -x \"${HOME-}/.dflow/hooks/heartbeat.sh\" ]; then /bin/sh \"${HOME-}/.dflow/hooks/heartbeat.sh\"; else cat >/dev/null 2>&1 || :; fi" } ] }
   ```
3. 확인: 작업 리포에서 `/dflow-dev` 를 한 사이클 돌리며 D'Flow `/agents` 의 그 책상이 1~2분 간격으로 갱신되는지 본다.

끄기: settings.json 에서 위 원소를 지운다. 훅은 `.env` 의 첫 PAT 를 쓰고 토큰을 출력하거나 기록하지 않는다.
```

- [ ] **Step 8: `poll.sh` — 매 주기 watch, `--until` 도달 시 stop, `DFLOW_WATCH=0` 이면 끔**

13행 다음에:
```sh
UNTIL_LABEL="18:00"   # watch 신호에 실을 종료시각 표시 문자열(--until 원문)
```
`--until` 파싱을:
```sh
    --until)          UNTIL_LABEL="${2:-}"; UNTIL=$(printf '%s' "${2:-}" | tr -d ':'); shift 2 || usage ;;
```
53행 종료 분기를:
```sh
  [ "$now" -ge "$UNTIL" ] && {
    [ "${DFLOW_WATCH:-1}" = "0" ] || "$DFLOW" watch --stop >/dev/null 2>&1 || :
    echo "종료 시각 도달(--until $UNTIL)" >&2; exit 8
  }
  # 좌석표 STANDBY 신호 — 매 주기 1회. 팀장 아래에서는 팀장이 lead 로 보내므로 DFLOW_WATCH=0 으로 끈다.
  [ "${DFLOW_WATCH:-1}" = "0" ] || "$DFLOW" watch --until "$UNTIL_LABEL" >/dev/null 2>&1 || :
```
파일 머리 주석(3~8행)에 `DFLOW_WATCH=0 이면 좌석표 watch 신호를 보내지 않는다(팀장 /dflow-team 아래 실행용).` 한 줄을 더한다.

- [ ] **Step 9: 문법·테스트 확인**

Run: `sh -n .claude/skills/dflow-poll/scripts/poll.sh && sh -n kit/install.sh && sh -n scripts/kit-build.sh && npx vitest run tests/skills`
Expected: 전부 PASS

- [ ] **Step 10: 커밋**

```bash
git add kit/hooks/heartbeat.sh kit/install.sh kit/README.md scripts/kit-build.sh .claude/skills/dflow-poll/scripts/poll.sh tests/skills/heartbeat-hook.test.ts
git commit -m "feat(kit): 좌석표 heartbeat 훅과 poll.sh watch 신호 — 도구 호출이 곧 살아 있음의 증거가 되게 하고 팀장 아래에서는 DFLOW_WATCH=0 으로 끈다"
```

- [ ] **Step 11: 이 PC 의 글로벌 훅 등록(메인 세션이 수행, 서브에이전트는 건너뛴다)**

메인 세션이 `update-config` 절차로 `~/.claude/settings.json` `hooks.PostToolUse` 에 README 의 원소를 추가하고, `~/.dflow/hooks/heartbeat.sh` 를 워크트리의 `kit/hooks/heartbeat.sh` 로 복사한다. 전역 파일이라 모든 세션·리포에 적용된다는 사실을 완료 보고에 적는다.

---

### Task 8: 접근 판정 · 데이터 조회 · 서버 액션

**Files:**
- Create: `src/lib/authz/agentsAccess.ts`
- Create: `src/lib/data/agentSeatmap.ts`
- Create: `src/app/actions/agentSeatmap.ts`
- Test: `tests/domain/agents-access.test.ts`, `tests/data/agent-seatmap.test.ts`

**Interfaces:**
- Consumes: `Actor`·`isAnyProjectAdmin`·`adminProjectIds`(`@/lib/domain/authz`), `getActorForView`(`@/lib/authz`), `createAdminClient`, Task 3 의 `assembleSeatmap`·행 타입.
- Produces:
  ```ts
  // agentsAccess.ts
  export function canViewAgents(actor: Actor | null): boolean          // 슈퍼유저 또는 관리자 프로젝트 1개 이상
  export function seatmapProjectIds(actor: Actor | null): string[] | null // null = 전체(슈퍼유저), [] = 없음
  // agentSeatmap.ts
  export const DONE_WINDOW_MS = 7 * 24 * 3600_000
  export async function fetchSeatmapRows(admin: AdminClient, projectIds: string[] | null, nowMs: number): Promise<SeatmapRows>  // 실패 시 throw
  export async function getSeatmap(actor: Actor, nowMs?: number): Promise<Seatmap>
  // actions/agentSeatmap.ts
  export async function refreshSeatmap(): Promise<{ ok: true; seatmap: Seatmap } | { ok: false; error: string }>
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/domain/agents-access.test.ts
import { describe, expect, it } from 'vitest'
import { canViewAgents, seatmapProjectIds } from '@/lib/authz/agentsAccess'
import type { Actor } from '@/lib/domain/authz'
import { KO } from '@/lib/i18n/dict/ko'
import { EN } from '@/lib/i18n/dict/en'

const actor = (over: Partial<Actor>): Actor => ({
  userId: 'u1', teamCode: 'PMO', teamId: 't1', isSuperuser: false,
  projectRoles: new Map(), rosterTeams: new Map(), ...over,
})

describe('canViewAgents — 슈퍼유저 또는 관리자인 프로젝트 1개 이상(좌석표 v1 스펙 §5-1)', () => {
  it('슈퍼유저·관리자는 본다', () => {
    expect(canViewAgents(actor({ isSuperuser: true }))).toBe(true)
    expect(canViewAgents(actor({ projectRoles: new Map([['p1', 'admin' as const]]) }))).toBe(true)
  })
  it('멤버뿐·비로그인·null 은 못 본다 — fail-closed', () => {
    expect(canViewAgents(actor({ projectRoles: new Map([['p1', 'member' as const]]) }))).toBe(false)
    expect(canViewAgents(null)).toBe(false)
  })
})

describe('seatmapProjectIds — 층 목록', () => {
  it('슈퍼유저는 null(전체), 관리자는 관리자 프로젝트만, 나머지는 빈 배열', () => {
    expect(seatmapProjectIds(actor({ isSuperuser: true }))).toBeNull()
    expect(seatmapProjectIds(actor({ projectRoles: new Map([['p1', 'admin' as const], ['p2', 'member' as const]]) }))).toEqual(['p1'])
    expect(seatmapProjectIds(actor({}))).toEqual([])
    expect(seatmapProjectIds(null)).toEqual([])
  })
})

describe('nav.agents 사전 키', () => {
  it('ko/en 양쪽에 있다', () => {
    expect(KO['nav.agents']).toBe('에이전트')
    expect(EN['nav.agents']).toBe('Agents')
  })
})
```
(`nav.agents` 케이스는 Task 11 이 끝나야 초록이다. 이 Task 에서는 `-t` 로 제외하고 실행한다.)

```ts
// tests/data/agent-seatmap.test.ts
import { describe, expect, it, vi } from 'vitest'
import { DONE_WINDOW_MS, fetchSeatmapRows } from '@/lib/data/agentSeatmap'

const NOW = Date.parse('2026-09-14T09:00:00Z')
type Resp = { data?: unknown; error?: { message: string } | null }

/** 테이블별 응답 큐 + 호출 기록. 체인은 전부 this 를 돌려주고 await 시 큐를 소비한다. */
function admin(queues: Record<string, Resp[]>, calls: Record<string, unknown[][]> = {}) {
  return {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: [], error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'in', 'eq', 'or', 'gte', 'gt', 'order', 'limit']) {
        b[k] = (...a: unknown[]) => { (calls[`${table}.${k}`] ??= []).push(a); return b }
      }
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  } as never
}
const O = { id: '11111111-1111-4111-8111-111111111111', project_id: 'p1', wbs_item_id: 'i1', status: 'claimed', claimed_by: 'x', claimed_by_user_id: 'u1', claimed_at: null, created_at: '2026-09-14T08:00:00Z', updated_at: '2026-09-14T08:59:00Z', last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null, heartbeat_note: null }

describe('fetchSeatmapRows', () => {
  it('주문 → 항목 → 부모 → 보고 → watcher → 프로젝트 6개 조회를 하고 행 묶음을 돌려준다', async () => {
    const calls: Record<string, unknown[][]> = {}
    const a = admin({
      agent_work_orders: [{ data: [O] }],
      wbs_items: [{ data: [{ id: 'i1', project_id: 'p1', code: 'T', name: 'n', parent_id: 'z1', actual_pct: 25 }] }, { data: [{ id: 'z1', project_id: 'p1', code: 'Z', name: 'zone', parent_id: null, actual_pct: null }] }],
      agent_work_reports: [{ data: [] }],
      agent_watchers: [{ data: [] }],
      projects: [{ data: [{ id: 'p1', name: 'P' }] }],
    }, calls)
    const rows = await fetchSeatmapRows(a, ['p1'], NOW)
    expect(rows.orders).toHaveLength(1)
    expect(rows.items[0].id).toBe('i1'); expect(rows.parents[0].id).toBe('z1')
    expect(rows.projects[0].name).toBe('P')
    // 프로젝트 필터가 걸렸다
    expect(calls['agent_work_orders.in']?.[0]).toEqual(['project_id', ['p1']])
    // DONE 은 7일 창 — approved 는 updated_at >= now-7d 만
    const orFilter = String(calls['agent_work_orders.or']?.[0]?.[0] ?? '')
    expect(orFilter).toContain('status.in.(ready,claimed,reported)')
    expect(orFilter).toContain(`updated_at.gte.${new Date(NOW - DONE_WINDOW_MS).toISOString()}`)
  })
  it('projectIds null(슈퍼유저)이면 프로젝트 필터를 걸지 않는다', async () => {
    const calls: Record<string, unknown[][]> = {}
    await fetchSeatmapRows(admin({ agent_work_orders: [{ data: [] }] }, calls), null, NOW)
    expect(calls['agent_work_orders.in']).toBeUndefined()
  })
  it('projectIds 가 빈 배열이면 조회 없이 빈 묶음', async () => {
    const a = admin({})
    const rows = await fetchSeatmapRows(a, [], NOW)
    expect(rows.orders).toEqual([]); expect((a as { from: { mock: { calls: unknown[] } } }).from.mock.calls).toHaveLength(0)
  })
  it('어느 조회든 error 면 throw — 데이터 없음으로 위장하지 않는다', async () => {
    await expect(fetchSeatmapRows(admin({ agent_work_orders: [{ data: null, error: { message: 'boom' } }] }), ['p1'], NOW))
      .rejects.toThrow(/boom/)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/agents-access.test.ts tests/data/agent-seatmap.test.ts -t "canViewAgents|seatmapProjectIds|fetchSeatmapRows"`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// src/lib/authz/agentsAccess.ts
// 좌석표(/agents) 접근 — 슈퍼유저 또는 관리자인 프로젝트가 1개 이상. usageAccess 와 같은 자리(페이지·사이드바가 함께 쓴다).
import { adminProjectIds, isAnyProjectAdmin, type Actor } from '@/lib/domain/authz'

export function canViewAgents(actor: Actor | null): boolean {
  return isAnyProjectAdmin(actor)
}

/** 층(프로젝트) 목록. null = 전체(슈퍼유저). 관리자는 관리자인 프로젝트만. */
export function seatmapProjectIds(actor: Actor | null): string[] | null {
  if (!actor) return []
  if (actor.isSuperuser) return null
  return adminProjectIds(actor)
}
```

```ts
// src/lib/data/agentSeatmap.ts
// 좌석표 조회 — 서버 전용(service_role). 프로젝트 필터는 항상 seatmapProjectIds 로 건다.
// 실패는 throw 한다(에러 3원칙: 조회 실패를 데이터 없음으로 위장하지 않는다).
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminClient } from '@/lib/minutes/externalApi'
import type { Actor } from '@/lib/domain/authz'
import { seatmapProjectIds } from '@/lib/authz/agentsAccess'
import { WATCHER_TTL_MS } from '@/lib/domain/seatState'
import {
  assembleSeatmap, type ItemRow, type OrderRow, type ProjectRow, type ReviewRow, type Seatmap, type SeatmapRows, type WatcherRow,
} from '@/lib/domain/seatmap'

/** DONE(approved) 은 최근 7일 것만 층에 접어 둔다. */
export const DONE_WINDOW_MS = 7 * 24 * 3600_000

const ORDER_COLS = 'id, project_id, wbs_item_id, status, claimed_by, claimed_by_user_id, claimed_at, created_at, updated_at, last_heartbeat_at, heartbeat_phase, heartbeat_agent, heartbeat_note'
const ITEM_COLS = 'id, project_id, code, name, parent_id, actual_pct'

function must<T>(what: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`[seatmap] ${what} 조회 실패: ${r.error.message}`)
  return (r.data ?? []) as T
}

export async function fetchSeatmapRows(admin: AdminClient, projectIds: string[] | null, nowMs: number): Promise<SeatmapRows> {
  const empty: SeatmapRows = { orders: [], items: [], parents: [], reviews: [], watchers: [], projects: [] }
  if (projectIds !== null && projectIds.length === 0) return empty

  const doneSince = new Date(nowMs - DONE_WINDOW_MS).toISOString()
  let q = admin.from('agent_work_orders').select(ORDER_COLS)
    .or(`status.in.(ready,claimed,reported),and(status.eq.approved,updated_at.gte.${doneSince})`)
  if (projectIds !== null) q = q.in('project_id', projectIds)
  const orders = must<OrderRow[]>('주문', await q.order('created_at', { ascending: true }).limit(2000))
  if (orders.length === 0) return empty

  const itemIds = [...new Set(orders.map(o => o.wbs_item_id).filter((x): x is string => !!x))]
  const orderIds = orders.map(o => o.id)
  const projIds = [...new Set(orders.map(o => o.project_id))]

  const items = itemIds.length
    ? must<ItemRow[]>('항목', await admin.from('wbs_items').select(ITEM_COLS).in('id', itemIds))
    : []
  const parentIds = [...new Set(items.map(i => i.parent_id).filter((x): x is string => !!x))]
  const [parents, reviews, watchers, projects] = await Promise.all([
    parentIds.length
      ? admin.from('wbs_items').select(ITEM_COLS).in('id', parentIds).then(r => must<ItemRow[]>('부모 항목', r))
      : Promise.resolve([] as ItemRow[]),
    admin.from('agent_work_reports').select('work_order_id, review_action, review_note, created_at')
      .in('work_order_id', orderIds).eq('kind', 'completion').then(r => must<ReviewRow[]>('완료 보고', r)),
    admin.from('agent_watchers').select('id, user_id, project_id, agent, host, slots, busy, until_label, last_seen_at')
      .gte('last_seen_at', new Date(nowMs - WATCHER_TTL_MS).toISOString()).then(r => must<WatcherRow[]>('감시자', r)),
    admin.from('projects').select('id, name').in('id', projIds).then(r => must<ProjectRow[]>('프로젝트', r)),
  ])
  return { orders, items, parents, reviews, watchers, projects }
}

export async function getSeatmap(actor: Actor, nowMs = Date.now()): Promise<Seatmap> {
  const rows = await fetchSeatmapRows(createAdminClient(), seatmapProjectIds(actor), nowMs)
  return assembleSeatmap(rows, nowMs)
}
```

```ts
// src/app/actions/agentSeatmap.ts
'use server'

import { getActorForView } from '@/lib/authz'
import { canViewAgents } from '@/lib/authz/agentsAccess'
import { getSeatmap } from '@/lib/data/agentSeatmap'
import type { Seatmap } from '@/lib/domain/seatmap'

/** 좌석표 재조회(30초 폴링). 페이지와 같은 게이트를 다시 검사한다 — 액션은 URL 로도 불릴 수 있다. */
export async function refreshSeatmap(): Promise<{ ok: true; seatmap: Seatmap } | { ok: false; error: string }> {
  const actor = await getActorForView()
  if (!actor || !canViewAgents(actor)) return { ok: false, error: '권한이 없습니다.' }
  try {
    return { ok: true, seatmap: await getSeatmap(actor) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[seatmap] 재조회 실패:', msg)
    return { ok: false, error: msg }
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/agents-access.test.ts tests/data/agent-seatmap.test.ts -t "canViewAgents|seatmapProjectIds|fetchSeatmapRows"`
Expected: PASS. `.or(...)` 문자열의 PostgREST 문법이 의심되면 `and(status.eq.approved,updated_at.gte.<iso>)` 가 supabase-js 의 `or` 필터 표기임을 확인한다(리포 안 선례: `grep -rn "\.or(" src/lib/data | head`).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/authz/agentsAccess.ts src/lib/data/agentSeatmap.ts src/app/actions/agentSeatmap.ts tests/domain/agents-access.test.ts tests/data/agent-seatmap.test.ts
git commit -m "feat(agents): 좌석표 접근 판정·조회·재조회 액션 — 관리자 프로젝트로만 필터하고 조회 실패는 그대로 올린다"
```

---

### Task 9: 좌석 컴포넌트 — Sprite · Seat · ZoneBlock · FloorCard + CSS 모듈

**Files:**
- Create: `src/components/agents/seatmap.module.css`
- Create: `src/components/agents/Sprite.tsx`
- Create: `src/components/agents/Seat.tsx`
- Create: `src/components/agents/ZoneBlock.tsx`
- Create: `src/components/agents/FloorCard.tsx`
- Test: `tests/components/agents-seat.test.tsx`

**Interfaces:**
- Consumes: Task 3 의 `Seat`·`Zone`·`Floor`·`Watcher`, Task 2 의 `AnimName`·`CharacterName`.
- Produces:
  ```ts
  export function Sprite({ character, anim, reduceMotion }: { character: CharacterName; anim: AnimName; reduceMotion?: boolean }): JSX.Element
  export function SeatCard({ seat, side, selected, nowMs, onSelect }: { seat: Seat; side: 'left' | 'right'; selected: boolean; nowMs: number; onSelect: (orderId: string) => void }): JSX.Element
  export function ZoneBlock({ zone, selectedId, nowMs, onSelect }: { zone: Zone; selectedId: string | null; nowMs: number; onSelect: (orderId: string) => void }): JSX.Element
  export function FloorCard({ floor, selectedId, nowMs, onSelect }: { floor: Floor; selectedId: string | null; nowMs: number; onSelect: (orderId: string) => void }): JSX.Element
  export const STATE_LABEL: Record<SeatState, string>   // Seat.tsx 에서 export
  export function seatMetaLine(seat: Seat, nowMs: number): string  // Seat.tsx 에서 export
  ```
- 스프라이트 규격: `public/sprites/<character>/<anim>.png` 가로 스트립, 셀 96×96, 프레임 수는 `manifest.json`(`typing/design/verify/refactor/stale/rejected` 4프레임, `idle_*` 6프레임), fps 는 `typing 8 · design 6 · verify 4 · refactor 6 · stale 2 · idle_coffee 4 · idle_stretch 4 · idle_look 3 · rejected 6`. 빈 의자는 `public/sprites/empty.png`(1프레임). 컴포넌트에 상수로 박는다(런타임 fetch 없음).

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
// tests/components/agents-seat.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Sprite } from '@/components/agents/Sprite'
import { SeatCard, seatMetaLine, STATE_LABEL } from '@/components/agents/Seat'
import type { Seat } from '@/lib/domain/seatmap'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const NOW = Date.parse('2026-09-14T09:00:00Z')
const seat = (over: Partial<Seat> = {}): Seat => ({
  orderId: '11111111-1111-4111-8111-111111111111', id8: '11111111', projectId: 'p1', itemId: 'i1',
  code: 'TSK-04-02', name: '주문 상세', state: 'ACTIVE', phase: 'build', anim: 'typing', character: 'cat_dev',
  agent: 'hong/mbp/w1', progress: 60, lastSignalAt: new Date(NOW - 42_000).toISOString(),
  heartbeatAt: new Date(NOW - 42_000).toISOString(), heartbeatPhase: 'build', note: null, rejected: false, reviewNote: null, ...over,
})

let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Sprite', () => {
  it('캐릭터·동작으로 배경 이미지와 프레임 수 클래스를 정한다', () => {
    act(() => root.render(<Sprite character="cat_dev" anim="idle_coffee" />))
    const el = host.querySelector('[data-sprite]') as HTMLElement
    expect(el.style.backgroundImage).toContain('/sprites/cat_dev/idle_coffee.png')
    expect(el.dataset.frames).toBe('6')
    expect(el.style.getPropertyValue('--frames')).toBe('6')
    expect(el.style.getPropertyValue('--fps')).toBe('4')
  })
  it('empty 는 공용 빈 의자 1프레임', () => {
    act(() => root.render(<Sprite character="cat_dev" anim="empty" />))
    const el = host.querySelector('[data-sprite]') as HTMLElement
    expect(el.style.backgroundImage).toContain('/sprites/empty.png')
    expect(el.dataset.frames).toBe('1')
  })
  it('reduceMotion 이면 정지 표식', () => {
    act(() => root.render(<Sprite character="cat_dev" anim="typing" reduceMotion />))
    expect((host.querySelector('[data-sprite]') as HTMLElement).dataset.still).toBe('1')
  })
})

describe('SeatCard', () => {
  it('책상 버튼에 코드·이름·메타·상태가 있고 클릭하면 orderId 로 선택된다', () => {
    let picked = ''
    act(() => root.render(<SeatCard seat={seat()} side="left" selected={false} nowMs={NOW} onSelect={id => { picked = id }} />))
    const btn = host.querySelector('button') as HTMLButtonElement
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(btn.textContent).toContain('TSK-04-02')
    expect(btn.textContent).toContain('주문 상세')
    expect(btn.textContent).toContain('hong/mbp/w1 · 42초 전')
    expect(btn.dataset.state).toBe('ACTIVE')
    act(() => btn.click())
    expect(picked).toBe('11111111-1111-4111-8111-111111111111')
  })
  it('BLOCKED 는 ? 표식과 질문, STALE 은 !, OFFLINE 은 끊김', () => {
    act(() => root.render(<SeatCard seat={seat({ state: 'BLOCKED', note: '어느 DB?' })} side="right" selected nowMs={NOW} onSelect={() => {}} />))
    expect(host.textContent).toContain('?'); expect(host.textContent).toContain('어느 DB?')
    act(() => root.render(<SeatCard seat={seat({ state: 'STALE' })} side="right" selected={false} nowMs={NOW} onSelect={() => {}} />))
    expect(host.querySelector('[data-flag]')?.textContent).toBe('!')
    act(() => root.render(<SeatCard seat={seat({ state: 'OFFLINE' })} side="right" selected={false} nowMs={NOW} onSelect={() => {}} />))
    expect(host.querySelector('[data-flag]')?.textContent).toBe('끊김')
  })
})

describe('seatMetaLine · STATE_LABEL', () => {
  it('상태별 문구', () => {
    expect(seatMetaLine(seat(), NOW)).toBe('hong/mbp/w1 · 42초 전')
    expect(seatMetaLine(seat({ state: 'STALE' }), NOW)).toBe('hong/mbp/w1 · 무응답 42초 전')
    expect(seatMetaLine(seat({ state: 'OFFLINE', phase: 'build' }), NOW)).toBe('build 에서 끊김 · 42초 전')
    expect(seatMetaLine(seat({ state: 'WAIT' }), NOW)).toBe('승인 대기')
    expect(seatMetaLine(seat({ state: 'READY', agent: null }), NOW)).toBe('미착수')
    expect(seatMetaLine(seat({ state: 'BLOCKED' }), NOW)).toBe('hong/mbp/w1 · 결정 대기')
    expect(STATE_LABEL.REJECTED).toBe('반려 · 재작업')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/agents-seat.test.tsx`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: CSS 모듈 작성** (팔레트는 목업 v2. `globals.css` 는 건드리지 않는다. 다크는 `:global(.dark)` 조상)

```css
/* src/components/agents/seatmap.module.css — 좌석표 전용. 상태 변형 display 유틸을 쓰지 않는다(안전망). */
.root {
  --sm-paper: #F3F5F1; --sm-surface: #FFFFFF; --sm-ink: #1B252C; --sm-ink-2: #4B5A64; --sm-ink-3: #7E8B93;
  --sm-line: #C9D0CB; --sm-line-2: #E2E6E1; --sm-zone: #F7F8F5;
  --sm-band: #22394A; --sm-band-ink: #F2F6F8; --sm-band-muted: #9FB4C2;
  --sm-active: #5DB1E5; --sm-active-ink: #0B2436; --sm-wait: #F0B068; --sm-wait-ink: #472705;
  --sm-empty: #E3E7E2; --sm-empty-ink: #75828A; --sm-reject: #F4C7BE; --sm-reject-ink: #6A1C0F; --sm-reject-bar: #D8563E;
  --sm-standby: #3F8F58; --sm-standby-soft: #DCEFE0; --sm-warn: #D8563E; --sm-warn-soft: #FBE4DF;
  --sm-shadow: 0 1px 2px rgba(20,30,36,.06), 0 8px 22px rgba(20,30,36,.06);
  color: var(--sm-ink);
}
:global(.dark) .root {
  --sm-paper: #12181C; --sm-surface: #1A2126; --sm-ink: #E7ECEA; --sm-ink-2: #B1BBC0; --sm-ink-3: #7C878E;
  --sm-line: #33404A; --sm-line-2: #26313A; --sm-zone: #151B20;
  --sm-band: #0D1418; --sm-band-ink: #EEF3F5; --sm-band-muted: #7F94A2;
  --sm-active: #4A9FD3; --sm-active-ink: #061521; --sm-wait: #D6984C; --sm-wait-ink: #241302;
  --sm-empty: #28313A; --sm-empty-ink: #8B97A1; --sm-reject: #5B2A21; --sm-reject-ink: #F7CDC3; --sm-reject-bar: #E56A52;
  --sm-standby: #6DBD84; --sm-standby-soft: #1D3527; --sm-warn: #E56A52; --sm-warn-soft: #3B211C;
  --sm-shadow: 0 1px 2px rgba(0,0,0,.4), 0 8px 22px rgba(0,0,0,.35);
}

/* 상단 현황판 */
.top { background: var(--sm-band); color: var(--sm-band-ink); border-radius: 0 0 14px 14px; padding: 14px 18px 16px; display: grid; grid-template-columns: 1fr auto; gap: 12px 24px; align-items: center; box-shadow: var(--sm-shadow); }
.counters { list-style: none; margin: 0; padding: 0; display: flex; gap: 8px; flex-wrap: wrap; }
.counter { display: grid; grid-template-columns: auto auto; column-gap: 10px; align-items: center; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; padding: 6px 12px; min-width: 110px; }
.counter b { font-family: ui-monospace, Menlo, monospace; font-size: 24px; font-weight: 600; line-height: 1; grid-row: 1 / 3; font-variant-numeric: tabular-nums; }
.counter span { grid-column: 2; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--sm-band-muted); display: inline-flex; align-items: center; gap: 6px; }
.counter span::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--sm-dot, #B7BFBA); }
.counter em { grid-column: 2; font-style: normal; font-size: 12px; }
.stamp { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: var(--sm-band-muted); }
.stampBad { color: #F6B6A9; }

/* 확인 필요 띠 */
.alert { margin-top: 14px; background: var(--sm-warn-soft); border: 1px solid var(--sm-warn); border-radius: 10px; padding: 10px 14px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.alert strong { color: var(--sm-warn); font-weight: 600; white-space: nowrap; }
.alertList { list-style: none; margin: 0; padding: 0; display: flex; gap: 8px; flex-wrap: wrap; }
.alertBtn { background: var(--sm-surface); border: 1px solid var(--sm-line); border-radius: 999px; padding: 3px 10px; cursor: pointer; font-size: 13px; color: inherit; }

/* 본문 */
.grid { display: grid; grid-template-columns: minmax(0, 1fr) 336px; gap: 20px; margin-top: 18px; align-items: start; }
@media (max-width: 960px) { .grid { grid-template-columns: 1fr; } }
.floors { column-width: 340px; column-gap: 18px; }
.floor { background: var(--sm-surface); border: 1px solid var(--sm-line-2); border-radius: 14px; padding: 14px 14px 16px; box-shadow: var(--sm-shadow); break-inside: avoid; margin-bottom: 18px; }
.floorHead { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; align-items: start; margin-bottom: 12px; }
.floorHead h2 { margin: 0; font-weight: 800; font-size: 19px; letter-spacing: -.01em; }
.floorHead h2 small { font-weight: 500; font-size: 11px; color: var(--sm-ink-3); margin-left: 6px; }
.watch { grid-column: 2; grid-row: 1 / 3; font-size: 11px; padding: 4px 9px; border-radius: 999px; border: 1px solid var(--sm-line); color: var(--sm-ink-3); white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; }
.watch::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #B7BFBA; }
.watchOn { background: var(--sm-standby-soft); border-color: transparent; color: var(--sm-standby); }
.watchOn::before { background: var(--sm-standby); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sm-standby) 25%, transparent); }
.doneNote { font-size: 12px; color: var(--sm-ink-3); margin: 8px 0 0; }

.zones { display: grid; gap: 10px; }
.zone { background: var(--sm-zone); border: 1px solid var(--sm-line-2); border-radius: 10px; padding: 8px 10px 10px; }
.zoneHead { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; flex-wrap: wrap; }
.zoneCode { font-family: ui-monospace, Menlo, monospace; font-weight: 600; font-size: 12px; color: var(--sm-ink-2); }
.zoneName { font-weight: 600; font-size: 13px; }
.zoneSum { margin-left: auto; font-size: 11px; color: var(--sm-ink-3); font-variant-numeric: tabular-nums; }

/* 좌석 블록: 가운데 통로선 양쪽 두 줄 */
.block { position: relative; display: grid; grid-template-columns: 1fr 1fr; row-gap: 8px; padding-block: 4px; }
.block::before { content: ""; position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--sm-line); }
.seat { display: grid; align-items: stretch; min-height: 96px; }
.seatLeft { grid-template-columns: 96px minmax(0, 1fr); }
.seatRight { grid-template-columns: minmax(0, 1fr) 96px; }
.seatRight .chair { order: 2; }
.chair { position: relative; min-height: 96px; display: flex; align-items: flex-end; justify-content: center; }
.seatRight .chair { transform: scaleX(-1); }

.desk { position: relative; display: flex; flex-direction: column; justify-content: center; gap: 3px; text-align: center; border: 1px solid var(--sm-line); padding: 10px 8px 11px; cursor: pointer; background: var(--sm-empty); color: var(--sm-empty-ink); min-width: 0; font: inherit; }
.seatLeft .desk { border-right: 0; border-radius: 8px 0 0 8px; }
.seatRight .desk { border-left: 0; border-radius: 0 8px 8px 0; }
.desk[aria-pressed="true"] { box-shadow: 0 0 0 3px var(--sm-ink) inset; }
.deskId { font-family: ui-monospace, Menlo, monospace; font-weight: 600; font-size: 14px; line-height: 1.1; }
.deskName { font-weight: 600; font-size: 13px; line-height: 1.3; overflow-wrap: anywhere; }
.deskMeta { font-size: 11px; line-height: 1.3; opacity: .82; font-variant-numeric: tabular-nums; }
.bar { display: block; height: 4px; border-radius: 2px; background: rgba(0,0,0,.14); margin-top: 4px; overflow: hidden; }
.bar i { display: block; height: 100%; background: currentColor; opacity: .8; }
.flag { position: absolute; top: 5px; right: 5px; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: var(--sm-warn); color: #fff; font-family: ui-monospace, Menlo, monospace; }
.note { font-size: 11px; line-height: 1.3; margin-top: 2px; padding: 3px 6px; border-radius: 6px; background: rgba(255,255,255,.55); color: var(--sm-ink); text-align: left; }
:global(.dark) .note { background: rgba(0,0,0,.35); }

.desk[data-state="ACTIVE"], .desk[data-state="BLOCKED"] { background: var(--sm-active); color: var(--sm-active-ink); border-color: transparent; }
.desk[data-state="STALE"] { background: var(--sm-active); color: var(--sm-active-ink); border-color: var(--sm-warn); background-image: repeating-linear-gradient(135deg, transparent 0 8px, rgba(255,255,255,.28) 8px 10px); }
.desk[data-state="WAIT"] { background: var(--sm-wait); color: var(--sm-wait-ink); border-color: transparent; }
.desk[data-state="REJECTED"] { background: var(--sm-reject); color: var(--sm-reject-ink); border-color: transparent; }
.desk[data-rejected="1"] { box-shadow: inset 5px 0 0 var(--sm-reject-bar); }
.seatRight .desk[data-rejected="1"] { box-shadow: inset -5px 0 0 var(--sm-reject-bar); }
.desk[data-state="READY"] { background: transparent; border: 1.5px dashed var(--sm-line); color: var(--sm-ink-3); }
.desk[data-state="OFFLINE"] { background: var(--sm-empty); color: var(--sm-empty-ink); border-color: var(--sm-warn); }

/* 스프라이트: 96px 셀 가로 스트립, steps(n) 로 background-position 이동. JS 타이머 없음. */
.sprite { width: 96px; height: 96px; background-repeat: no-repeat; background-size: auto 96px; image-rendering: pixelated; animation: seatStrip calc(var(--frames) / var(--fps) * 1s) steps(var(--frames)) infinite; }
.sprite[data-frames="1"], .sprite[data-still="1"] { animation: none; }
@keyframes seatStrip { to { background-position-x: calc(var(--frames) * -96px); } }
@media (prefers-reduced-motion: reduce) { .sprite { animation: none; } }

/* 상세 패널 */
.panel { background: var(--sm-surface); border: 1px solid var(--sm-line-2); border-radius: 14px; padding: 16px; box-shadow: var(--sm-shadow); position: sticky; top: 16px; }
@media (max-width: 960px) { .panel { position: static; } }
.eyebrow { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--sm-ink-3); }
.panel h3 { margin: 2px 0 0; font-family: ui-monospace, Menlo, monospace; font-weight: 600; font-size: 20px; }
.task { margin: 2px 0 0; font-weight: 600; font-size: 15px; }
.pill { display: inline-block; font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 999px; margin-top: 8px; background: var(--sm-empty); color: var(--sm-empty-ink); }
.pill[data-state="ACTIVE"], .pill[data-state="BLOCKED"] { background: var(--sm-active); color: var(--sm-active-ink); }
.pill[data-state="STALE"], .pill[data-state="OFFLINE"] { background: var(--sm-warn); color: #fff; }
.pill[data-state="WAIT"] { background: var(--sm-wait); color: var(--sm-wait-ink); }
.pill[data-state="REJECTED"] { background: var(--sm-reject-bar); color: #fff; }
.ladder { list-style: none; margin: 16px 0 0; padding: 0; display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
.ladder li { font-size: 10px; text-align: center; color: var(--sm-ink-3); }
.ladder li::before { content: ""; display: block; height: 6px; border-radius: 3px; background: var(--sm-line-2); margin-bottom: 5px; }
.ladder li[data-done="1"]::before { background: var(--sm-active); }
.ladder li[data-now="1"]::before { background: var(--sm-ink); }
.ladder li[data-now="1"] { color: var(--sm-ink); font-weight: 600; }
.ladder li[data-bad="1"]::before { background: var(--sm-reject-bar); }
.facts { margin: 16px 0 0; padding: 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; font-size: 13px; }
.facts dt { color: var(--sm-ink-3); white-space: nowrap; }
.facts dd { margin: 0; font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; overflow-wrap: anywhere; }
.factBad { color: var(--sm-warn); font-weight: 600; }
.quote { margin-top: 12px; font-size: 12px; color: var(--sm-ink-2); border-left: 3px solid var(--sm-reject-bar); padding-left: 10px; white-space: pre-wrap; }
.actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.actions a { flex: 1; text-align: center; text-decoration: none; font-weight: 600; font-size: 13px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--sm-line); color: inherit; }
.legend { margin-top: 22px; font-size: 12px; color: var(--sm-ink-3); }
.legend ul { list-style: none; margin: 0 0 8px; padding: 0; display: flex; gap: 14px; flex-wrap: wrap; }
.legend li { display: inline-flex; align-items: center; gap: 7px; }
.sw { width: 22px; height: 14px; border-radius: 3px; border: 1px solid var(--sm-line); display: inline-block; }
.error { margin-top: 14px; border: 1px solid var(--sm-warn); background: var(--sm-warn-soft); color: var(--sm-warn); border-radius: 10px; padding: 10px 14px; font-size: 13px; }
```

- [ ] **Step 4: Sprite.tsx**

```tsx
// src/components/agents/Sprite.tsx
import type React from 'react'
import type { AnimName, CharacterName } from '@/lib/domain/seatState'
import css from './seatmap.module.css'

/** public/sprites/<char>/manifest.json 과 같은 값. 런타임 fetch 대신 상수 — 4캐릭터가 전부 동일하다. */
const FRAMES: Record<AnimName, { frames: number; fps: number }> = {
  typing: { frames: 4, fps: 8 }, design: { frames: 4, fps: 6 }, verify: { frames: 4, fps: 4 }, refactor: { frames: 4, fps: 6 },
  stale: { frames: 4, fps: 2 }, idle_coffee: { frames: 6, fps: 4 }, idle_stretch: { frames: 6, fps: 4 }, idle_look: { frames: 6, fps: 3 },
  rejected: { frames: 4, fps: 6 }, empty: { frames: 1, fps: 1 },
}

export function Sprite({ character, anim, reduceMotion = false }: { character: CharacterName; anim: AnimName; reduceMotion?: boolean }) {
  const { frames, fps } = FRAMES[anim]
  const src = anim === 'empty' ? '/sprites/empty.png' : `/sprites/${character}/${anim}.png`
  return (
    <span
      data-sprite="" data-frames={String(frames)} data-still={reduceMotion ? '1' : undefined}
      className={css.sprite} aria-hidden="true"
      style={{ backgroundImage: `url(${src})`, '--frames': String(frames), '--fps': String(fps) } as React.CSSProperties}
    />
  )
}
```

- [ ] **Step 5: Seat.tsx**

```tsx
// src/components/agents/Seat.tsx
'use client'
import type { Seat } from '@/lib/domain/seatmap'
import type { SeatState } from '@/lib/domain/seatState'
import { ageLabel } from '@/lib/domain/seatmap'
import { Sprite } from './Sprite'
import css from './seatmap.module.css'

export const STATE_LABEL: Record<SeatState, string> = {
  ACTIVE: '업무 중', STALE: '무응답', OFFLINE: '끊김', BLOCKED: '결정 대기', REJECTED: '반려 · 재작업',
  WAIT: '승인 대기', READY: '빈자리', DONE: '머지 완료',
}

export function seatMetaLine(seat: Seat, nowMs: number): string {
  const who = seat.agent ?? '—'
  switch (seat.state) {
    case 'ACTIVE': case 'REJECTED': return `${who} · ${ageLabel(seat.lastSignalAt, nowMs)}`
    case 'STALE': return `${who} · 무응답 ${ageLabel(seat.lastSignalAt, nowMs)}`
    case 'OFFLINE': return `${seat.phase} 에서 끊김 · ${ageLabel(seat.lastSignalAt, nowMs)}`
    case 'BLOCKED': return `${who} · 결정 대기`
    case 'WAIT': return '승인 대기'
    case 'READY': return '미착수'
    default: return '머지 완료'
  }
}

const FLAG: Partial<Record<SeatState, string>> = { STALE: '!', OFFLINE: '끊김', BLOCKED: '?' }
const HAS_BAR: readonly SeatState[] = ['ACTIVE', 'STALE', 'REJECTED', 'BLOCKED', 'OFFLINE']

export function SeatCard({ seat, side, selected, nowMs, onSelect }: {
  seat: Seat; side: 'left' | 'right'; selected: boolean; nowMs: number; onSelect: (orderId: string) => void
}) {
  const flag = FLAG[seat.state]
  return (
    <div className={`${css.seat} ${side === 'left' ? css.seatLeft : css.seatRight}`}>
      <div className={css.chair}><Sprite character={seat.character} anim={seat.anim} /></div>
      <button
        type="button" className={css.desk} data-state={seat.state} data-rejected={seat.rejected ? '1' : undefined}
        aria-pressed={selected} aria-label={`${seat.code} ${seat.name} ${STATE_LABEL[seat.state]}`}
        onClick={() => onSelect(seat.orderId)}
      >
        {flag && <span className={css.flag} data-flag="">{flag}</span>}
        <span className={css.deskId}>{seat.code}</span>
        <span className={css.deskName}>{seat.name}</span>
        <span className={css.deskMeta}>{seatMetaLine(seat, nowMs)}</span>
        {seat.state === 'BLOCKED' && seat.note && <span className={css.note}>{seat.note}</span>}
        {HAS_BAR.includes(seat.state) && <span className={css.bar}><i style={{ width: `${seat.progress}%` }} /></span>}
      </button>
    </div>
  )
}
```

- [ ] **Step 6: ZoneBlock.tsx · FloorCard.tsx**

```tsx
// src/components/agents/ZoneBlock.tsx
'use client'
import type { Zone } from '@/lib/domain/seatmap'
import { SeatCard } from './Seat'
import css from './seatmap.module.css'

function summary(z: Zone): string {
  const parts: string[] = []
  if (z.summary.work) parts.push(`${z.summary.work} 진행`)
  if (z.summary.wait) parts.push(`${z.summary.wait} 승인 대기`)
  if (z.summary.ready) parts.push(`${z.summary.ready} 빈자리`)
  return parts.join(' · ')
}

export function ZoneBlock({ zone, selectedId, nowMs, onSelect }: {
  zone: Zone; selectedId: string | null; nowMs: number; onSelect: (orderId: string) => void
}) {
  return (
    <div className={css.zone}>
      <div className={css.zoneHead}>
        <span className={css.zoneCode}>{zone.code}</span>
        <span className={css.zoneName}>{zone.name}</span>
        <span className={css.zoneSum}>{summary(zone)}</span>
      </div>
      <div className={css.block}>
        {zone.seats.map((s, i) => (
          <SeatCard key={s.orderId} seat={s} side={i % 2 === 0 ? 'left' : 'right'} selected={s.orderId === selectedId} nowMs={nowMs} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}
```

```tsx
// src/components/agents/FloorCard.tsx
'use client'
import type { Floor } from '@/lib/domain/seatmap'
import { ZoneBlock } from './ZoneBlock'
import css from './seatmap.module.css'

export function FloorCard({ floor, selectedId, nowMs, onSelect }: {
  floor: Floor; selectedId: string | null; nowMs: number; onSelect: (orderId: string) => void
}) {
  const w = floor.watchers
  const watchLabel = w.length === 0 ? '감시 없음'
    : w.map(x => `${x.agent}${x.slots != null ? ` ${x.busy ?? 0}/${x.slots}` : ''}${x.untilLabel ? ` ~${x.untilLabel}` : ''}`).join(' · ')
  return (
    <section className={css.floor} aria-label={floor.name}>
      <header className={css.floorHead}>
        <h2>{floor.name}<small>{floor.zones.length}구역 · {floor.seatCount}석</small></h2>
        <span className={`${css.watch} ${w.length ? css.watchOn : ''}`} title={watchLabel}>{w.length ? `감시 중 · ${watchLabel}` : '감시 없음'}</span>
      </header>
      <div className={css.zones}>
        {floor.zones.map(z => <ZoneBlock key={z.key} zone={z} selectedId={selectedId} nowMs={nowMs} onSelect={onSelect} />)}
      </div>
      {floor.doneCount > 0 && <p className={css.doneNote}>머지 완료 {floor.doneCount}건(최근 7일)은 접혀 있습니다.</p>}
    </section>
  )
}
```

- [ ] **Step 7: 통과 확인**

Run: `npx vitest run tests/components/agents-seat.test.tsx && npm run lint -- src/components/agents`
Expected: PASS, 린트 오류 0. jsdom 이 `style.getPropertyValue('--frames')` 를 빈 문자열로 돌려주면(cssstyle 버전 차이) 그 두 단언을 `el.getAttribute('style')` 에 `--frames: 6` 이 포함되는지로 바꾼다 — 검사 의도는 같다. CSS 모듈 import 가 vitest 에서 실패하면 `vitest.config` 의 `css` 옵션을 확인한다(기본값은 모듈 클래스명을 그대로 돌려준다).

- [ ] **Step 8: 커밋**

```bash
git add src/components/agents/seatmap.module.css src/components/agents/Sprite.tsx src/components/agents/Seat.tsx src/components/agents/ZoneBlock.tsx src/components/agents/FloorCard.tsx tests/components/agents-seat.test.tsx
git commit -m "feat(agents): 좌석·구역·층 컴포넌트와 스프라이트 재생 — CSS steps 로 GPU 합성, globals.css 는 건드리지 않는다"
```

---

### Task 10: SeatmapView · Counters · AttentionBand · DetailPanel · `/agents` 페이지

**Files:**
- Create: `src/components/agents/Counters.tsx`, `src/components/agents/AttentionBand.tsx`, `src/components/agents/DetailPanel.tsx`, `src/components/agents/SeatmapView.tsx`
- Create: `src/app/(app)/agents/page.tsx`
- Test: `tests/components/agents-seatmap-view.test.tsx`

**Interfaces:**
- Consumes: Task 3 의 `Seatmap`·`Seat`·`Attention`, Task 8 의 `refreshSeatmap`·`getSeatmap`·`canViewAgents`, Task 9 컴포넌트.
- Produces: `SeatmapView({ initial, pollMs = 30_000 })`, 페이지 `/agents`.

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
// tests/components/agents-seatmap-view.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Seatmap } from '@/lib/domain/seatmap'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const refresh = vi.fn()
vi.mock('@/app/actions/agentSeatmap', () => ({ refreshSeatmap: (...a: unknown[]) => refresh(...(a as [])) }))
import { SeatmapView } from '@/components/agents/SeatmapView'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const map = (over: Partial<Seatmap> = {}): Seatmap => ({
  floors: [{
    id: 'p1', name: 'mes-base', seatCount: 2, doneCount: 0, watchers: [],
    zones: [{ key: 'z1', code: 'WP-04', name: '주문 관리', summary: { work: 1, wait: 0, done: 0, ready: 1 }, seats: [
      { orderId: 'o1', id8: 'o1', projectId: 'p1', itemId: 'i1', code: 'TSK-04-01', name: '목록', state: 'BLOCKED', phase: 'blocked', anim: 'idle_look', character: 'cat_dev', agent: 'hong/mbp/w1', progress: 60, lastSignalAt: new Date(NOW - 5000).toISOString(), heartbeatAt: null, heartbeatPhase: 'blocked', note: '어느 DB?', rejected: false, reviewNote: null },
      { orderId: 'o2', id8: 'o2', projectId: 'p1', itemId: 'i2', code: 'TSK-04-02', name: '상세', state: 'READY', phase: 'design', anim: 'empty', character: 'dome_bot', agent: null, progress: 0, lastSignalAt: null, heartbeatAt: null, heartbeatPhase: null, note: null, rejected: false, reviewNote: null },
    ] }],
  }],
  counters: { active: 1, standby: 0, idle: 0, offline: 1 },
  attention: [{ orderId: 'o1', id8: 'o1', floorName: 'mes-base', code: 'TSK-04-01', name: '목록', state: 'BLOCKED', why: '어느 DB?' }],
  fetchedAt: new Date(NOW).toISOString(), ...over,
})

let host: HTMLDivElement, root: Root
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); refresh.mockReset(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('SeatmapView', () => {
  it('카운터·확인 필요·층이 그려지고, 첫 확인 필요 항목이 선택되어 상세에 질문이 보인다', () => {
    act(() => root.render(<SeatmapView initial={map()} />))
    expect(host.textContent).toContain('mes-base')
    expect(host.querySelector('[data-counter="active"]')?.textContent).toBe('1')
    expect(host.querySelector('[data-counter="offline"]')?.textContent).toBe('1')
    expect(host.querySelector('[data-panel]')?.textContent).toContain('어느 DB?')
    expect(host.querySelector('[data-panel]')?.textContent).toContain('TSK-04-01')
  })
  it('확인 필요 버튼을 누르면 그 책상이 선택된다', () => {
    act(() => root.render(<SeatmapView initial={map({ attention: [] })} />))
    const desk = [...host.querySelectorAll('button[aria-pressed]')].find(b => b.textContent?.includes('TSK-04-02')) as HTMLButtonElement
    act(() => desk.click())
    expect(host.querySelector('[data-panel]')?.textContent).toContain('TSK-04-02')
  })
  it('30초마다 refreshSeatmap 을 부르고 결과로 갈아 끼운다', async () => {
    refresh.mockResolvedValue({ ok: true, seatmap: map({ counters: { active: 9, standby: 0, idle: 0, offline: 0 } }) })
    act(() => root.render(<SeatmapView initial={map()} pollMs={30_000} />))
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-counter="active"]')?.textContent).toBe('9')
  })
  it('재조회가 실패하면 마지막 데이터를 유지하고 실패 시각을 표시한다', async () => {
    refresh.mockResolvedValue({ ok: false, error: 'boom' })
    act(() => root.render(<SeatmapView initial={map()} pollMs={1000} />))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(host.querySelector('[data-counter="active"]')?.textContent).toBe('1')
    expect(host.querySelector('[data-error]')?.textContent).toContain('갱신 실패')
    expect(host.querySelector('[data-error]')?.textContent).toContain('boom')
  })
  it('탭이 숨겨지면 폴링하지 않고, 다시 보이면 즉시 1회 재조회한다', async () => {
    refresh.mockResolvedValue({ ok: true, seatmap: map() })
    act(() => root.render(<SeatmapView initial={map()} pollMs={1000} />))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(refresh).toHaveBeenCalledTimes(0)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0) })
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/agents-seatmap-view.test.tsx`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: Counters.tsx · AttentionBand.tsx**

```tsx
// src/components/agents/Counters.tsx
import type React from 'react'
import type { Seatmap } from '@/lib/domain/seatmap'
import css from './seatmap.module.css'

const ITEMS: Array<{ key: keyof Seatmap['counters']; label: string; sub: string; dot: string }> = [
  { key: 'active', label: 'Active', sub: '업무 중', dot: 'var(--sm-active)' },
  { key: 'standby', label: 'Standby', sub: '감시 중', dot: 'var(--sm-standby)' },
  { key: 'idle', label: 'Idle', sub: '승인 대기', dot: 'var(--sm-wait)' },
  { key: 'offline', label: 'Offline', sub: '빈자리·끊김', dot: '#B7BFBA' },
]

export function Counters({ counters }: { counters: Seatmap['counters'] }) {
  return (
    <ul className={css.counters} aria-label="현황">
      {ITEMS.map(it => (
        <li key={it.key} className={css.counter} style={{ '--sm-dot': it.dot } as React.CSSProperties}>
          <b data-counter={it.key}>{counters[it.key]}</b><span>{it.label}</span><em>{it.sub}</em>
        </li>
      ))}
    </ul>
  )
}
```

```tsx
// src/components/agents/AttentionBand.tsx
import type { Attention } from '@/lib/domain/seatmap'
import { STATE_LABEL } from './Seat'
import css from './seatmap.module.css'

export function AttentionBand({ items, onSelect }: { items: Attention[]; onSelect: (orderId: string) => void }) {
  if (items.length === 0) return null
  return (
    <div className={css.alert} role="region" aria-label="확인 필요">
      <strong>확인 필요</strong>
      <ul className={css.alertList}>
        {items.map(a => (
          <li key={a.orderId}>
            <button type="button" className={css.alertBtn} onClick={() => onSelect(a.orderId)}>
              <b>{a.code}</b> {a.name} · {STATE_LABEL[a.state]} · {a.why}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: DetailPanel.tsx**

```tsx
// src/components/agents/DetailPanel.tsx
import Link from 'next/link'
import type { Seat } from '@/lib/domain/seatmap'
import { ageLabel } from '@/lib/domain/seatmap'
import { STATE_LABEL } from './Seat'
import css from './seatmap.module.css'

const LADDER: Array<{ phase: string; pct: number }> = [
  { phase: 'design', pct: 25 }, { phase: 'build', pct: 60 }, { phase: 'verify', pct: 85 }, { phase: 'reported', pct: 100 }, { phase: 'merged', pct: 100 },
]

function ladderPhase(seat: Seat): string {
  if (seat.state === 'WAIT') return 'reported'
  if (seat.state === 'DONE') return 'merged'
  if (seat.phase === 'blocked' || seat.phase === 'rejected') return seat.progress < 25 ? 'design' : seat.progress < 60 ? 'build' : 'verify'
  return seat.phase
}

export function DetailPanel({ seat, floorName, zoneLabel, nowMs }: { seat: Seat | null; floorName: string; zoneLabel: string; nowMs: number }) {
  if (!seat) return <aside className={css.panel} data-panel="">책상을 고르면 상세가 여기 보입니다.</aside>
  const now = ladderPhase(seat)
  const idx = LADDER.findIndex(l => l.phase === now)
  const hbBad = seat.state === 'STALE' || seat.state === 'OFFLINE'
  const showSignal = !['READY', 'DONE', 'WAIT'].includes(seat.state)
  return (
    <aside className={css.panel} data-panel="" aria-live="polite">
      <div className={css.eyebrow}>{floorName} · {zoneLabel} · 주문 {seat.id8}</div>
      <h3>{seat.code}</h3>
      <p className={css.task}>{seat.name}</p>
      <span className={css.pill} data-state={seat.state}>{STATE_LABEL[seat.state]}</span>
      <ul className={css.ladder} aria-label="Phase">
        {LADDER.map((l, i) => (
          <li key={l.phase}
            data-done={seat.state !== 'READY' && (i < idx || (i === idx && (seat.state === 'WAIT' || seat.state === 'DONE'))) ? '1' : undefined}
            data-now={seat.state !== 'READY' && i === idx && seat.state !== 'WAIT' && seat.state !== 'DONE' ? '1' : undefined}
            data-bad={seat.rejected && i === idx ? '1' : undefined}>
            {l.phase}<br /><b>{l.pct}</b>
          </li>
        ))}
      </ul>
      <dl className={css.facts}>
        <dt>에이전트</dt><dd>{seat.agent ?? '—'}</dd>
        <dt>진행</dt><dd>{seat.progress}%</dd>
        <dt>마지막 신호</dt><dd className={hbBad ? css.factBad : ''}>{showSignal ? ageLabel(seat.lastSignalAt, nowMs) : '—'}</dd>
        <dt>heartbeat</dt><dd>{seat.heartbeatAt ? `${ageLabel(seat.heartbeatAt, nowMs)} · ${seat.heartbeatPhase ?? '—'}` : '없음(훅 미설치 또는 옛 세션)'}</dd>
      </dl>
      {seat.state === 'BLOCKED' && seat.note && <p className={css.quote}>{seat.note}</p>}
      {seat.rejected && <p className={css.quote}>반려 사유: {seat.reviewNote ?? '(없음)'}</p>}
      <div className={css.actions}>
        <Link href={`/p/${seat.projectId}/wbs`}>WBS 에서 열기</Link>
      </div>
    </aside>
  )
}
```

- [ ] **Step 5: SeatmapView.tsx**

```tsx
// src/components/agents/SeatmapView.tsx
'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Seat, Seatmap } from '@/lib/domain/seatmap'
import { refreshSeatmap } from '@/app/actions/agentSeatmap'
import { Counters } from './Counters'
import { AttentionBand } from './AttentionBand'
import { FloorCard } from './FloorCard'
import { DetailPanel } from './DetailPanel'
import css from './seatmap.module.css'

function findSeat(map: Seatmap, orderId: string | null): { seat: Seat; floorName: string; zoneLabel: string } | null {
  if (!orderId) return null
  for (const f of map.floors) for (const z of f.zones) for (const s of z.seats) {
    if (s.orderId === orderId) return { seat: s, floorName: f.name, zoneLabel: `${z.code} ${z.name}` }
  }
  return null
}

const hhmmss = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour12: false })

/** 좌석표 클라이언트 루트. 30초 폴링, 숨긴 탭은 쉬고 다시 보이면 즉시 1회. 실패는 마지막 데이터 유지 + 표시. */
export function SeatmapView({ initial, pollMs = 30_000 }: { initial: Seatmap; pollMs?: number }) {
  const [map, setMap] = useState(initial)
  const [error, setError] = useState<{ at: string; message: string } | null>(null)
  const [selected, setSelected] = useState<string | null>(initial.attention[0]?.orderId ?? null)
  const [nowMs, setNowMs] = useState(() => Date.parse(initial.fetchedAt))
  const inflight = useRef(false)

  const refresh = useCallback(async () => {
    if (inflight.current) return
    inflight.current = true
    try {
      const r = await refreshSeatmap()
      if (r.ok) { setMap(r.seatmap); setNowMs(Date.parse(r.seatmap.fetchedAt)); setError(null) }
      else setError({ at: new Date().toISOString(), message: r.error })
    } catch (e) {
      setError({ at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) })
    } finally { inflight.current = false }
  }, [])

  useEffect(() => {
    let timer: number | null = null
    const start = () => { if (timer === null) timer = window.setInterval(refresh, pollMs) }
    const stop = () => { if (timer !== null) { window.clearInterval(timer); timer = null } }
    const onVis = () => { if (document.visibilityState === 'hidden') stop(); else { void refresh(); start() } }
    document.addEventListener('visibilitychange', onVis)
    if (document.visibilityState !== 'hidden') start()
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [refresh, pollMs])

  // 경과 시간 표시만 1초마다 — 데이터는 건드리지 않는다.
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(n => n + 1000), 1000)
    return () => window.clearInterval(t)
  }, [])

  const sel = useMemo(() => findSeat(map, selected), [map, selected])

  return (
    <div className={css.root}>
      <header className={css.top}>
        <Counters counters={map.counters} />
        <div className={`${css.stamp} ${error ? css.stampBad : ''}`}>
          {error ? <span data-error="">갱신 실패 {hhmmss(error.at)} · {error.message}</span> : <span>갱신 {hhmmss(map.fetchedAt)}</span>}
        </div>
      </header>
      <AttentionBand items={map.attention} onSelect={setSelected} />
      <main className={css.grid}>
        <section className={css.floors} aria-label="프로젝트별 좌석">
          {map.floors.length === 0 && <p className={css.doneNote}>표시할 주문이 없습니다. 관리자인 프로젝트에 에이전트 주문이 생기면 여기 층이 생깁니다.</p>}
          {map.floors.map(f => <FloorCard key={f.id} floor={f} selectedId={selected} nowMs={nowMs} onSelect={setSelected} />)}
        </section>
        <DetailPanel seat={sel?.seat ?? null} floorName={sel?.floorName ?? ''} zoneLabel={sel?.zoneLabel ?? ''} nowMs={nowMs} />
      </main>
      <footer className={css.legend}>
        <ul>
          <li><i className={css.sw} style={{ background: 'var(--sm-active)' }} />업무 중(신호 5분 이내)</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-active)', borderColor: 'var(--sm-warn)' }} />무응답 5분 초과</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-empty)', borderColor: 'var(--sm-warn)' }} />끊김 30분 초과</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-active)' }} />? 결정 대기</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-wait)' }} />승인 대기</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-reject)' }} />반려 · 재작업</li>
          <li><i className={css.sw} style={{ borderStyle: 'dashed' }} />빈자리</li>
        </ul>
        <p>프로젝트가 층, 주문 항목의 부모 항목이 구역, 작업 주문 하나가 책상입니다. 의자의 인물은 그 주문을 잡은 에이전트(슬롯)이며 같은 에이전트는 늘 같은 인물입니다. 신호는 PostToolUse 훅의 heartbeat(60초 절제)와 progress 보고입니다.</p>
      </footer>
    </div>
  )
}
```

- [ ] **Step 6: 페이지**

```tsx
// src/app/(app)/agents/page.tsx
import { redirect } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { canViewAgents } from '@/lib/authz/agentsAccess'
import { getSeatmap } from '@/lib/data/agentSeatmap'
import { PageHero } from '@/components/ui/PageHero'
import { SeatmapView } from '@/components/agents/SeatmapView'

export const dynamic = 'force-dynamic' // 좌석표는 항상 최신이어야 한다

export default async function AgentsPage() {
  // 슈퍼유저 또는 관리자 프로젝트 1개 이상 — 판정은 canViewAgents 한 곳. 사이드바 링크도 같은 판정을 쓴다.
  const actor = await getActorForView()
  if (!actor || !canViewAgents(actor)) redirect('/projects')
  // 조회 실패는 throw → Next 의 error 경계가 받는다. 빈 좌석표로 위장하지 않는다.
  const seatmap = await getSeatmap(actor)
  return (
    <div className="space-y-4">
      <PageHero eyebrow="OPERATIONS" title="에이전트 좌석표" />
      <SeatmapView initial={seatmap} />
    </div>
  )
}
```

- [ ] **Step 7: 통과 확인 + 빌드**

Run: `npx vitest run tests/components/agents-seatmap-view.test.tsx tests/components/agents-seat.test.tsx && npm run lint && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, 린트·타입 오류 0. 서버 액션을 jsdom 테스트에서 import 할 때 `'use server'` 모듈이 문제되면 `vi.mock` 이 먼저 걸려 있는지(위 테스트처럼 import 앞) 확인한다.

로컬 확인(스테이징 DB, 슈퍼유저 계정으로 로그인): `npm run dev` → `http://localhost:3000/agents`. 층·구역·책상·스프라이트가 그려지고 30초 뒤 갱신 시각이 바뀌는지 본다. 스프라이트가 안 움직이면 `--frames` 커스텀 속성이 `steps()` 안에서 계산되는지(브라우저 devtools computed) 확인하고, 안 되면 `.sprite[data-frames="4"]`·`"6"` 두 클래스에 `steps(4)`·`steps(6)` 을 직접 쓰는 폴백으로 바꾼다.

- [ ] **Step 8: 커밋**

```bash
git add src/components/agents/Counters.tsx src/components/agents/AttentionBand.tsx src/components/agents/DetailPanel.tsx src/components/agents/SeatmapView.tsx "src/app/(app)/agents/page.tsx" tests/components/agents-seatmap-view.test.tsx
git commit -m "feat(agents): /agents 좌석표 페이지 — 30초 폴링, 숨긴 탭은 쉬고, 실패는 마지막 데이터 위에 표시한다"
```

---

### Task 11: 사이드바 메뉴 4곳(UI 위험 파일) — 별도 커밋 + 브랜치 push(Preview)

**Files:**
- Modify: `src/app/(app)/layout.tsx:58-76` — identity 에 `showAgents`
- Modify: `src/components/app/Sidebar.tsx:65-70`, `:271-279` — props·`items.push`·전역 블록
- Modify: `src/lib/i18n/dict/common.ts:21`, `src/lib/i18n/dict/common.en.ts:22` — `nav.agents`
- Test: `tests/domain/agents-access.test.ts`(Task 8 의 `nav.agents` 케이스가 이제 통과)

**Interfaces:**
- Consumes: `canViewAgents`(Task 8).
- Produces: `Sidebar` prop `showAgents?: boolean`, i18n 키 `nav.agents`.

- [ ] **Step 1: 실패 확인**

Run: `npx vitest run tests/domain/agents-access.test.ts -t "nav.agents"`
Expected: FAIL — `KO['nav.agents']` undefined

- [ ] **Step 2: i18n 키**

`common.ts` 의 `'nav.usage': '사용 현황',` 다음 줄에 `'nav.agents': '에이전트',`. `common.en.ts` 의 `'nav.usage': 'Usage',` 다음 줄에 `'nav.agents': 'Agents',`.

- [ ] **Step 3: layout.tsx identity**

`showUsage: canViewUsage(actor),` 다음에 `showAgents: canViewAgents(actor),`; degraded 분기에 `showAgents: false,`; import 에 `import { canViewAgents } from '@/lib/authz/agentsAccess'`; Sidebar 전달부를
```tsx
<Sidebar projects={projectLinks} showUsage={identity?.showUsage ?? false} showPortfolio={identity?.showPortfolio ?? false} showAgents={identity?.showAgents ?? false} />
```

- [ ] **Step 4: Sidebar.tsx**

- `lucide-react` import 에 `Armchair` 추가.
- `buildItems` 호출부·시그니처에 `showAgents` 를 `showUsage` 와 같은 방식으로 통과시키고, `if (showUsage) items.push(...)` 다음에
  ```ts
  // 에이전트 좌석표 — 슈퍼유저 또는 관리자 프로젝트 1개 이상(canViewAgents). 층=프로젝트라 전역 경로.
  if (showAgents) items.push({ href: '/agents', labelKey: 'nav.agents', icon: Armchair, match: '/agents' })
  ```
- 컴포넌트 시그니처: `export function Sidebar({ projects, showUsage = false, showPortfolio = false, showAgents = false }: { projects: SidebarProject[]; showUsage?: boolean; showPortfolio?: boolean; showAgents?: boolean })`
- 전역 블록의 `{showUsage && (...)}` 다음에 같은 모양으로:
  ```tsx
  {showAgents && (
    <Tooltip label={t('nav.agents')} side="right" disabled={!collapsed}>
      <Link href="/agents" aria-current={pathname === '/agents' ? 'page' : undefined}
        className={`side-link ${pathname === '/agents' ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
        <Armchair className="h-[18px] w-[18px] shrink-0" />{!collapsed && <span className="flex-1">{t('nav.agents')}</span>}
      </Link>
    </Tooltip>
  )}
  ```
  (`buildItems` 의 기존 주석 "에이전트 관제도 전역 화면… 종전엔 진입 링크가 없어" 는 이 링크로 해소되므로 그 주석을 지운다.)

- [ ] **Step 5: 확인**

Run: `npx vitest run tests/domain/agents-access.test.ts tests/css && npm run lint && npx tsc --noEmit -p tsconfig.json`
Expected: PASS 전부(`tests/css` 의 안전망 테스트 포함).

- [ ] **Step 6: 별도 커밋 + push(Preview)**

```bash
git add "src/app/(app)/layout.tsx" src/components/app/Sidebar.tsx src/lib/i18n/dict/common.ts src/lib/i18n/dict/common.en.ts
git commit -m "feat(nav): 사이드바에 에이전트 좌석표 링크 — 페이지 게이트와 같은 canViewAgents 판정을 쓴다"
git push -u origin feat/agent-office
```
push 뒤 Vercel Preview URL(Vercel 대시보드 또는 `vercel ls`)에서 로그인 후 사이드바 링크와 `/agents` 를 눈으로 확인하고, 확인 결과를 완료 보고에 적는다. Preview 가 로그인이 안 되면 CLAUDE.md 의 Preview 한계 항목을 인용해 보고하고 스테이징 확인(Task 13)으로 넘긴다.

---

### Task 12: Micro 부하 실측 스크립트 + 실측 기록

**Files:**
- Create: `scripts/seatmap-load.mjs`
- Modify: `docs/superpowers/specs/2026-09-14-agent-office-v1-design.md` §6 결과 표

**Interfaces:**
- Consumes: `.env` 의 `NEXT_PUBLIC_SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`(스테이징), Task 8 의 조회 6개와 같은 PostgREST 요청.

- [ ] **Step 1: 스크립트 작성**

```js
// scripts/seatmap-load.mjs — 좌석표 폴링 부하 재현(스테이징 전용). 스펙 §6.
// 사용법: node scripts/seatmap-load.mjs --viewers 20 --minutes 3 --interval 30
// 열람자 1명 = interval 초마다 좌석표 조회 6개(주문·항목·부모·보고·watcher·프로젝트)를 순서대로 보낸다.
import { readFileSync } from 'node:fs'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? Number(process.argv[i + 1]) : d }
const VIEWERS = arg('viewers', 20), MINUTES = arg('minutes', 3), INTERVAL = arg('interval', 30)

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { console.error('.env 에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없다'); process.exit(2) }
if (URL.includes('rglfgrwwwwdqejohdnty')) { console.error('운영 프로젝트를 가리키고 있다 — 스테이징에서만 돌린다(npm run env:staging)'); process.exit(2) }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }
const lat = [], errors = []
async function get(path) {
  const t0 = performance.now()
  try {
    const r = await fetch(`${URL}/rest/v1/${path}`, { headers: H })
    lat.push(performance.now() - t0)
    if (!r.ok) errors.push(`${r.status} ${path.slice(0, 40)}`)
    return r.ok ? r.json() : []
  } catch (e) { lat.push(performance.now() - t0); errors.push(String(e)); return [] }
}
async function poll() {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString()
  const orders = await get(`agent_work_orders?select=id,project_id,wbs_item_id,status,updated_at,last_heartbeat_at&or=(status.in.(ready,claimed,reported),and(status.eq.approved,updated_at.gte.${since}))&limit=2000`)
  const itemIds = [...new Set(orders.map(o => o.wbs_item_id).filter(Boolean))].slice(0, 500)
  const items = itemIds.length ? await get(`wbs_items?select=id,code,name,parent_id,actual_pct&id=in.(${itemIds.join(',')})`) : []
  const parentIds = [...new Set(items.map(i => i.parent_id).filter(Boolean))].slice(0, 500)
  await Promise.all([
    parentIds.length ? get(`wbs_items?select=id,code,name,parent_id&id=in.(${parentIds.join(',')})`) : Promise.resolve([]),
    get(`agent_work_reports?select=work_order_id,review_action,review_note,created_at&kind=eq.completion&limit=2000`),
    get(`agent_watchers?select=id,agent,last_seen_at&last_seen_at=gte.${new Date(Date.now() - 70 * 60_000).toISOString()}`),
    get(`projects?select=id,name&limit=200`),
  ])
}
async function viewer(i) {
  await new Promise(r => setTimeout(r, (i / VIEWERS) * INTERVAL * 1000)) // 열람자 시작 시각을 흩뿌린다
  const end = Date.now() + MINUTES * 60_000
  while (Date.now() < end) { await poll(); await new Promise(r => setTimeout(r, INTERVAL * 1000)) }
}
const t0 = Date.now()
await Promise.all(Array.from({ length: VIEWERS }, (_, i) => viewer(i)))
lat.sort((a, b) => a - b)
const q = p => Math.round(lat[Math.min(lat.length - 1, Math.floor(lat.length * p))])
console.log(JSON.stringify({
  viewers: VIEWERS, minutes: MINUTES, interval: INTERVAL, requests: lat.length,
  p50_ms: q(0.5), p95_ms: q(0.95), max_ms: Math.round(lat[lat.length - 1] ?? 0),
  errors: errors.length, error_samples: errors.slice(0, 5), wall_s: Math.round((Date.now() - t0) / 1000),
}, null, 2))
```

- [ ] **Step 2: 문법 확인 후 커밋**

Run: `node --check scripts/seatmap-load.mjs`
```bash
git add scripts/seatmap-load.mjs
git commit -m "chore(scripts): 좌석표 폴링 부하 재현 스크립트 — Micro 컴퓨트에서 열람자 20명·30초 폴링을 실측하기 위해"
```

- [ ] **Step 3: 실측(Task 13 의 스테이징 배포 뒤, 메인 세션이 수행)**

```bash
node scripts/seatmap-load.mjs --viewers 20 --minutes 3 --interval 30
```
같은 시간에 브라우저 둘로 `https://dflow-staging.vercel.app/agents` 를 열어 두고, 리허설 리포에서 `dflow.sh heartbeat <ref> --phase build` 를 10초 간격 20회 보낸다. Supabase 스테이징 대시보드 Database → Connections·CPU 를 전후로 캡처한다. 결과를 스펙 §6 표에 채워 커밋한다:
```bash
git add docs/superpowers/specs/2026-09-14-agent-office-v1-design.md
git commit -m "docs(spec): 좌석표 Micro 부하 실측 결과 기록"
```
합격 기준: 오류 0, p95 < 1500ms, 연결 증가 ≤ 5. 미달이면 main 머지를 멈추고 폴링 간격·조회 병합(RPC 1개)을 검토한다.

---

### Task 13: 스테이징 반영 → 검증 → 운영 반영(사람 확인 후)

**Files:** 없음(운영 절차). 메인 세션이 수행하고 사용자가 확인한다.

- [ ] **Step 1: 전체 테스트·린트**

Run (워크트리): `npm test && npm run lint`
Expected: 전부 PASS

- [ ] **Step 2: staging 머지·push**

```bash
git -C /Users/jji/project/wbs-web switch staging      # 메인 체크아웃은 이미 staging 이다 — 확인만
git -C /Users/jji/project/wbs-web merge --no-ff feat/agent-office -m "merge: 가상오피스 v1 (feat/agent-office) → staging"
git -C /Users/jji/project/wbs-web push origin staging
```
pre-push 훅(G1·G2·G3·G4)이 막으면 그 메시지를 그대로 보고한다. 우회(`SKIP_GUARD=1`)하지 않는다.

- [ ] **Step 3: 스테이징 검증(스펙 §7 "화면"·"훅")**

- `https://dflow-staging.vercel.app/agents` — 슈퍼유저 로그인, 층·구역·책상·스프라이트·상세 패널·다크·400px 폭.
- 리허설 리포(`~/project/mes-base-rehearsal`, 스테이징 PAT)에서 `/dflow-dev` 1건을 돌리며 그 책상이 1~2분 간격으로 갱신되는지(훅), `dflow.sh heartbeat <ref> --phase blocked --note "질문"` 뒤 손 든 표식과 확인 필요 띠가 뜨는지, `--phase build` 뒤 풀리는지.
- `dflow.sh watch --slots 2 --busy 1 --until 18:00` 뒤 층 헤더 배지, `dflow.sh watch --stop` 뒤 사라지는지.
- Task 12 Step 3 부하 실측.

- [ ] **Step 4: 운영 마이그레이션·main 반영(사용자 확인 뒤)**

```bash
npm run db:apply -- supabase/migrations/0094_agent_heartbeat.sql --target prod   # 운영 ref 를 대화형으로 입력
git -C /Users/jji/project/wbs-web switch main && git -C /Users/jji/project/wbs-web pull origin main
git -C /Users/jji/project/wbs-web merge --no-ff staging -m "merge: 가상오피스 v1 staging → main"
git -C /Users/jji/project/wbs-web push origin main
npm run smoke:prod && npm run mark:good
git -C /Users/jji/project/wbs-web switch staging
```
주의: 메인 체크아웃의 `main` 은 `feat/dflow-team` 이 ff 머지된 미push 상태다(d97443e). `pull origin main` 전에 팀장 스킬 세션과 그 커밋의 처리를 합의한다(그 세션의 리허설이 끝나지 않았으면 `main` 을 건드리지 않고 이 Task 를 보류한다).

- [ ] **Step 5: 팀장 스킬 세션에 알림**

`feat/agent-office` 의 최종 sha 와 스테이징 반영 사실을 보내 worker-prompt.md·SKILL.md 반영(blocked 직전 heartbeat, watch 호출, `DFLOW_WATCH=0`)을 시작하게 한다.

---

## 실행 준비(완료)

- 워크트리 `.claude/worktrees/feat-agent-office`(`feat/agent-office` ← `staging` c621569) 생성, `npm install` 완료, `.env` 심링크.
- 스펙 커밋 c621569(staging). 이 계획서와 스펙의 조율 반영(watch `--stop`, `DFLOW_WATCH=0`)은 `feat/agent-office` 첫 커밋.

## 실행 순서와 병렬성

Task 1 → (2 → 3) 과 (4, 5) 와 (6 → 7) 은 서로 독립이라 병렬 가능. Task 8 은 2·3 뒤. Task 9·10 은 3·8 뒤. Task 11 은 8 뒤. Task 12 는 독립(스크립트 작성) 이나 실측은 13 뒤. Task 13 은 마지막.
