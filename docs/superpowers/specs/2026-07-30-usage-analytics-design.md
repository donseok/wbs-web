# 사용 현황(Usage Analytics) 설계

> 상태: 확정 스펙 (구현 전)
> 작성: 2026-07-30
> 요구: 접속 로그 · 사용자 현황 · 많이 쓰는 프로그램(메뉴)을 보는 화면. 좌측 사이드바 **설정 메뉴 바로 아래**.
> 초기에는 전원 열람, 이후 관리자 전용으로 전환.

---

## 0. 출발점 — 없는 것부터 확인

탐색 결과 **"누가 언제 무엇을 봤는가"를 기록하는 테이블도 코드도 이 리포에 존재하지 않는다.**

| 부재 항목 | 실측 |
|---|---|
| 페이지뷰 / 세션 / 로그인 이력 테이블 | 없음 |
| telemetry SDK (`@vercel/analytics`, posthog, sentry …) | `package.json` deps 0건 |
| 커스텀 로거 | `src/lib/`에 `*log*` 파일 0개 |
| 로그인 훅 | 로그인은 `src/app/login/page.tsx:62`에서 클라이언트가 `signInWithPassword()`를 직접 호출 → **로그인 시점에 서버 코드가 전혀 실행되지 않는다** |

존재하는 활동 흔적은 `change_logs`(WBS 편집, `0001_init.sql:57`), `announcement_seen`(워터마크 1행, `0012`), Realtime presence 2종(**DB 영속 0**)뿐이며 어느 것도 메뉴 사용량의 대리 지표가 되지 못한다.

→ **이 기능은 화면 추가가 아니라 수집 계층 신설이다.**

유일한 예외가 하나 있다: **`auth.users.last_sign_in_at`은 GoTrue가 계속 채워온 소급 데이터이고 이 리포에서 한 번도 참조된 적이 없다**(grep 0건). 이것이 day-0에 화면을 채우는 근거가 된다(§5).

---

## 1. 아키텍처 한 장

```
브라우저                      서버                              DB
────────                      ────                              ──
UsageTracker (클라이언트)
  pathname 변화 감지
  └─ fetch(keepalive) ──►  POST /api/track
                             ├ env 게이트 (프로덕션만)
                             ├ 쿠키에서 uid 확인 (본문 불신)
                             ├ resolveMenuKey(path)  ← 순수함수
                             └ service_role insert ──►  usage_events
                                                              │
/usage 페이지  ◄── src/lib/data/usage.ts ── RPC 4종 (집계) ◄───┘
   (서버 렌더)        + auth.users(listUsers)
```

- 수집은 **렌더 경로 밖**(`keepalive` fetch). 페이지 응답 시간에 영향 0.
- 집계는 **DB에서** 수행(RPC). 원시 행을 JS로 끌어오지 않는다.
- 표시 계산은 **순수 함수**(`src/lib/domain/usage.ts`) + 단위 테스트.

---

## 2. 수집 지점 — 클라이언트 비콘

### 2.1 채택 근거

| 후보 | 판정 |
|---|---|
| `src/middleware.ts`에 로깅 | **기각.** 이 파일은 `getUser()` 대신 `getClaims()`를 쓰는 이유가 "클릭당 100~180ms 절감"으로 주석에 박제된 성능 급소다. 게다가 matcher가 `/api/**`·`/share/**`를 제외해 커버리지도 반쪽. |
| 페이지별 서버 `after()` | **기각.** 대시보드에 선례(`recordProgressSnapshot`)는 있으나 15개 페이지를 개별 계측해야 하고 신규 페이지에서 조용히 누락된다. |
| 기존 `usePagePresence` 확장 | **기각.** 사용처가 WBS 간트 1곳뿐이고 in-memory라 영속 경로가 아예 없다. |
| **`(app)/layout.tsx`의 클라이언트 비콘** | **채택.** 같은 파일에 `PrefsSync`라는 null 렌더 클라이언트 컴포넌트 선례가 이미 있다. pathname 변화 한 곳에서 전 메뉴를 잡는다. |

### 2.2 `src/components/app/UsageTracker.tsx`

```tsx
'use client'
// 라우트 전환마다 1건 기록. 렌더 출력 없음(PrefsSync 와 동일 형태).
export function UsageTracker() { /* usePathname() 변화 → POST /api/track */ }
```

- **중복 억제**: 직전 전송 경로를 `useRef`에 보관해 같은 경로 재전송을 막는다(React StrictMode 이중 실행 + 같은 경로 리렌더 방어). 같은 경로는 10초 쿨다운.
- **전송**: `fetch(url, { method:'POST', keepalive:true })`. `keepalive`라 라우트 전환·탭 종료 중에도 전송이 살아남는다. 실패는 `.catch(() => {})` — 사용자 이동을 절대 막지 않는다.
- 클라이언트는 **경로만** 보낸다. 메뉴 키·프로젝트 id·사용자 id는 전부 서버가 판정한다.

### 2.3 `src/app/api/track/route.ts`

순서가 계약이다(위에서부터):

1. **환경 게이트** — `trackingEnabled()`가 거짓이면 즉시 `{ok:true, skipped:'disabled'}`. DB 접근 없음.
2. **인증** — `createServerClient()` → `auth.getClaims()` → `claims.sub`. 없으면 401.
   `/api/**`는 미들웨어 matcher 밖이므로 이 라우트가 스스로 인증한다. **본문의 사용자 정보는 절대 신뢰하지 않는다.**
3. **검증** — `path`가 문자열이고 512자 이하가 아니면 400.
4. **판정** — `resolveMenuKey(path)` / `normalizeUsagePath(path)` / `extractProjectId(path)` (전부 순수 함수).
5. **기록** — `createAdminClient()` (service_role) insert. 실패 시 `console.error('[usage] …')` + 500.

### 2.4 로컬 개발 잡음 차단 (필수)

**로컬 dev가 프로덕션 Supabase를 공유한다.** 개발 중 클릭이 그대로 운영 테이블에 쌓이면 지표가 오염된다.

```ts
// src/lib/domain/usageTracking.ts — 순수 함수, 테스트로 매트릭스 고정
export function trackingEnabled(env: Record<string, string | undefined>): boolean {
  if (env.USAGE_TRACKING === 'off') return false   // 운영 긴급 차단
  if (env.USAGE_TRACKING === 'on')  return true    // 로컬 검증용 명시적 opt-in
  return env.VERCEL_ENV === 'production'           // 기본: 프로덕션만
}
```

Preview 배포도 자동으로 제외된다(`VERCEL_ENV === 'preview'`).

---

## 3. 저장 — 원시 이벤트 1테이블

### 3.1 `supabase/migrations/0051_usage_events.sql`

```sql
create table if not exists usage_events (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  menu_key    text not null,                       -- 'wbs' | 'minutes' | 'unknown' …
  path        text not null,                       -- UUID 정규화된 경로
  project_id  uuid references projects(id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index if not exists usage_events_occurred_idx on usage_events (occurred_at desc);
create index if not exists usage_events_user_idx     on usage_events (user_id, occurred_at desc);
create index if not exists usage_events_menu_idx     on usage_events (menu_key, occurred_at desc);
```

**롤업 테이블을 만들지 않는 이유**: 41계정 × 하루 100뷰 ≈ 4천 행/일, 90일 보존이면 36만 행. 인덱스가 있으면 Postgres에 부담이 아니다. 지금 롤업은 조기 최적화이며, 필요해지면 원시 데이터가 있으므로 언제든 파생할 수 있다(반대는 불가능).

**`on delete cascade`(user_id)**: 개인 활동 데이터이고 보존이 90일이라 감사 아카이브가 아니다. `minute_highlights`(`0025:13`)가 같은 이유로 cascade를 "의도적 선택"이라 주석에 박아둔 선례를 따른다. 마이그레이션 주석에 사유를 남긴다.

**`on delete set null`(project_id)**: 프로젝트가 지워져도 접속 사실 자체는 남는다.

### 3.2 RLS — 셰이프 C (읽기 개방 + 서버만 쓰기)

```sql
alter table usage_events enable row level security;

drop policy if exists read_usage_events on usage_events;
create policy read_usage_events on usage_events
  for select to authenticated using (true);

-- INSERT/UPDATE/DELETE 정책을 만들지 않는다 = 쓰기는 service_role(/api/track)만 가능.
```

- 관리자 전용 전환 시 **이 select 정책 한 줄만 교체**한다. GRANT를 회수하는 방식(0031·0050 스타일)은 되돌리기가 파괴적이라 쓰지 않는다.
- **`app_role()`에 의존하지 않는다.** 진행 중인 권한 3단 재설계(`2026-07-29-authz-three-tier-design.md`)가 `app_role()`을 shim으로 재정의할 예정이라, 신규 정책이 거기 하드 의존하면 충돌 지점이 된다. `0017`·`0039`가 순수 `auth.uid()`만 쓰는 이유와 같다.

### 3.3 집계 RPC 4종 (전부 SECURITY INVOKER)

`security invoker`(기본값)라 **호출자의 RLS가 그대로 적용된다.** 즉 §3.2의 select 정책 하나가 화면·RPC 양쪽의 단일 관문이 된다.

일자 버킷은 전부 `(occurred_at at time zone 'Asia/Seoul')::date` — 리포의 "오늘" 정의(`seoulToday()`)와 일치시킨다.

| 함수 | 반환 | 용도 |
|---|---|---|
| `usage_summary(p_from date, p_to date, p_today date)` | `total_events, active_users, today_users, last_event_at` | KPI + **수집 상태** |
| `usage_daily_actives(p_from date, p_to date)` | `d date, active_users int, events int` | 추이 차트 |
| `usage_menu_ranking(p_from date, p_to date)` | `menu_key text, events int, active_users int` | 많이 쓰는 프로그램 |
| `usage_user_rollup(p_from date, p_to date)` | `user_id uuid, events int, active_days int, last_at timestamptz` | 사용자 현황 표 |

`grant execute … to authenticated`. 멱등(`create or replace`), 롤백 파일에서 `drop function if exists`.

### 3.4 보존 90일

`src/lib/data/usage.ts`의 `purgeOldUsageEvents()` — service_role로 `delete … lt('occurred_at', cutoff)`. `/usage` 페이지 렌더의 `after()`에서 호출하며, **모듈 스코프 타임스탬프로 24시간 쿨다운**을 건다.

- 크론을 쓰지 않는다: `vercel.json`의 크론 슬롯은 이미 `/api/wiki/worker` 1건이 쓰고 있고, 이 정리는 지연에 민감하지 않다.
- "조회가 쓰기를 유발하는" 형태는 `recordProgressSnapshot` 선례와 동형이다.
- 쿨다운 상태가 인스턴스 메모리라 서버리스 다중 인스턴스에서 완전 직렬화되지 않는다 — 최악은 삭제 쿼리 중복 실행이며 멱등이므로 수용한다(`createEnsureGate` 주석과 같은 판단).
- **절대 throw 하지 않는다.** 실패는 `console.error` + 무시(정리 실패가 화면을 깨면 안 된다).

---

## 4. 메뉴 키 — 드리프트를 테스트로 막는다

`src/lib/domain/usageMenu.ts` (순수, DB 무접촉):

```ts
export const USAGE_MENUS: { key: string; labelKey: DictKey | null; fallback: string }[]
export function resolveMenuKey(pathname: string): string      // 모르면 'unknown'
export function normalizeUsagePath(pathname: string): string  // UUID → ':id', 200자 절단
export function extractProjectId(pathname: string): string | null
```

- 정본 목록: 프로젝트 메뉴 11개(`dashboard, wbs, kanban, meetings, weekly, issues, wiki, announcements, members, attendance, settings`) + 전역 3개(`my-meetings, minutes, projects`) + 신규 `usage` + 관리자 3개(`admin-accounts, admin-teams, admin-llm`).
- 관리자 페이지는 i18n을 쓰지 않으므로(`/admin/*` 3종 전부 한국어 하드코딩) `labelKey: null` + `fallback` 문자열로 처리한다.
- **모르는 경로는 추측하지 않고 `'unknown'`.** 리포의 "모르면 unknown" 관례(`projectLifecycleStatus`, `accessScope`)와 동일.

### 드리프트 가드

`tests/domain/usage-menu.test.ts`가 `src/components/app/Sidebar.tsx`를 **텍스트로 읽어** `${base}/xxx` 패턴의 href를 뽑고, 전부 `'unknown'`이 아닌 키로 해석되는지 단언한다. 나중에 메뉴를 추가하고 매퍼를 안 고치면 테스트가 깨진다.

(텍스트 단언은 `tests/migrations/`가 이미 쓰는 기법이다. Sidebar를 리팩터링해 배열을 export 하는 방식은 UI 위험 파일 변경을 키우므로 택하지 않는다.)

---

## 5. day-0에 빈 화면이 아닌 이유

수집기를 켜도 첫날 `usage_events`는 비어 있다. 그러나 **`auth.users`는 이미 데이터를 갖고 있다.**

`src/app/actions/accounts.ts:187`의 `listUsers({page, perPage})` 페이지네이션 루프를 재사용해 `id / email / created_at / user_metadata.full_name / last_sign_in_at`을 읽는다(현재 코드는 `last_sign_in_at`을 뽑지 않으므로 필드만 추가).

→ **첫날부터 "사용자 현황"(41계정의 가입일·마지막 로그인·휴면 여부)은 완전히 채워진다.** 페이지뷰 기반 지표(추이·메뉴 랭킹·접속 로그)만 며칠에 걸쳐 차오른다.

화면은 이 상태를 숨기지 않는다 — 수집 데이터가 0이면 해당 카드에 `MiniEmpty`로 "수집 시작 이후 데이터가 쌓입니다"를 명시한다.

---

## 6. 화면 — `/usage`, 서버 렌더 단일 페이지

`src/app/(app)/usage/page.tsx` (async 서버 컴포넌트, `export const dynamic = 'force-dynamic'`) + `loading.tsx`.
전역 스코프이므로 `ProjectPageShell`을 쓰지 않고 `<div className="space-y-6">` + `PageHero`(관리자 페이지와 동일 형태).

기간 선택(7/30/90일)과 필터는 `searchParams` — **클라이언트 상태 없음**.

| # | 섹션 | 내용 |
|---|---|---|
| 1 | 요약 | `KpiCard variant="surface"` 그리드: 오늘 접속자 / 7일 활성 / 30일 활성 / 기간 총 조회수. 그 아래 **수집 상태** 한 줄(마지막 이벤트 시각) |
| 2 | 일별 활성 사용자 추이 | `TrendChart.tsx`와 동형의 **자체 인라인 SVG**(차트 라이브러리 0 유지). 토큰 클래스(`stroke-brand`, `fill-ink-subtle`)라 다크모드 자동 |
| 3 | 많이 쓰는 프로그램 | 메뉴별 조회수 + 순 사용자 수, 가로 바 순위. 라벨은 `t(labelKey)` 또는 fallback |
| 4 | 사용자 현황 | 이름 / 이메일 / 팀 / 권한 / 가입일 / **마지막 로그인** / 최근 활동 / 기간 내 조회수 / 방문일수. **이벤트 0인 휴면 계정도 표시** |
| 5 | 접속 로그 | 최근 이벤트(시각·사용자·메뉴·경로), 사용자/메뉴 필터, 200건 상한(상한 도달 시 화면에 명시) |

`PageHero`는 **현재 `title`만 렌더한다**(`heroKpis`는 받되 그리지 않음, `PageHero.tsx:9`). 따라서 KPI는 반드시 본문에 배치한다.

### 접속 "횟수"의 정의

로그인 이벤트 자체를 잡을 수 없으므로(§0), **연속된 이벤트 사이 간격이 30분을 넘으면 새 접속으로 센다.** 이 유도는 `src/lib/domain/usage.ts`의 순수 함수이며 화면에 "30분 무활동 기준"임을 명시한다. 추정을 사실처럼 표기하지 않는다.

### 표시 규약

- 숫자 반올림은 자체 구현하지 않고 `src/lib/domain/format.ts`의 `round1`/`formatPct1`만 쓴다.
- **상태 변형 display 유틸(`group-hover:flex`, `data-[state=open]:hidden`, `print:hidden`) 사용 금지** — `globals.css` 말미의 unlayered 반응형 안전망이 모든 named layer를 이겨 조용히 무력화된다. 한 요소에 컨테이너 쿼리 display와 반응형 display를 함께 쓰지 않는다.
- 테이블은 `AccountsManager.tsx:60`의 관용구(`overflow-x-auto` + `min-w-[…]`)를 따른다.

---

## 7. 권한 — 지금은 전원, 나중은 한 줄

`src/lib/authz/usageAccess.ts`:

```ts
/**
 * 사용 현황 열람 권한 — 지금은 전원 공개(요구사항).
 * 관리자 전용 전환 시 이 함수 하나만 바꾼다. 페이지·데이터 모듈이 모두 여기만 본다.
 */
export function canViewUsage(_m: Membership | null): boolean { return true }
```

전환 시 바꿀 곳은 **이 함수 + §3.2의 RLS select 정책, 두 군데뿐이다.**

⚠️ 나중에 `pmo_admin`으로 잠그면 **41계정 중 28명(68%)이 통과한다.** 실질적 관리자 전용은 진행 중인 `is_superuser`/`project_roles` 3단 재설계가 구현된 뒤라야 의미가 생긴다. 이 스펙은 그 전환을 막지 않도록 판정을 한 함수에 모으는 것까지만 책임진다.

### 프라이버시 — 명시된 전제

전원 공개 단계에서는 **누가 언제 어느 화면에 있었는지가 이름 단위로 전부 보인다.** 요청된 동작이며, 보존이 90일이라 무기한 축적되지는 않는다.

이메일은 표시한다 — 멤버 화면(`src/components/members/MembersBoard.tsx:250`)이 이미 전 인원의 이메일을 모든 로그인 사용자에게 노출하고 있으므로 이 화면이 새로운 노출 경로가 되지는 않는다(실측 확인).

---

## 8. 에러 처리 (리포 3원칙)

이 화면은 **"데이터 0"과 "집계 실패"가 육안으로 같아 보이는 대표 사례**다. 그래서 규칙을 강하게 건다.

1. **조회 실패를 빈 데이터로 위장하지 않는다.** 집계 RPC와 `listUsers`는 실패 시 `throw`(→ 에러 화면). `listAccounts`가 이미 같은 판단을 주석으로 박아둔 선례를 따른다(`accounts.ts:206-210`). "사용자 0명"·"조회수 0"을 절대 렌더하지 않는다.
2. **수집 실패는 화면에 드러난다.** 비콘 실패는 사용자를 막지 않지만, 수집이 끊기면 §6-1의 **수집 상태**에 마지막 이벤트 시각이 멈춘 채로 보인다. 실패가 조용히 사라지지 않는다.
3. **가드는 fail-closed.** `/api/track`은 인증 실패 시 401이고 본문 uid를 무시한다. `canViewUsage`는 `Membership | null`을 받아 판정한다.
4. 정리 배치(`purgeOldUsageEvents`)만 예외적으로 never-throw — 단 `console.error`로 반드시 남긴다.

---

## 9. 파일 목록

**신규**
```
supabase/migrations/0051_usage_events.sql
supabase/migrations/0051_usage_events_rollback.sql
src/lib/domain/usageMenu.ts          경로 → 메뉴 키 (순수)
src/lib/domain/usage.ts              집계·세션 유도·행 병합 (순수)
src/lib/domain/usageTracking.ts      trackingEnabled (순수)
src/lib/authz/usageAccess.ts         canViewUsage
src/lib/data/usage.ts                RPC 조회 + 계정 디렉터리 + purge
src/app/api/track/route.ts           수집 엔드포인트
src/components/app/UsageTracker.tsx  클라이언트 비콘
src/components/usage/*.tsx           요약 / 추이차트 / 메뉴랭킹 / 사용자표 / 접속로그
src/app/(app)/usage/page.tsx
src/app/(app)/usage/loading.tsx
tests/domain/usage.test.ts
tests/domain/usage-menu.test.ts      (+ Sidebar 드리프트 가드)
tests/domain/usage-tracking.test.ts
tests/migrations/usage-events.test.ts
tests/actions/usage-track-gate.test.ts
```

**수정**
```
src/components/app/Sidebar.tsx       설정 아래 '사용 현황' 링크 (+ 프로젝트 미선택 분기에도)
src/app/(app)/layout.tsx             <UsageTracker /> 마운트
src/lib/i18n/dict/common.ts          'nav.usage' ko/en
```

---

## 10. 배포 절차 (CLAUDE.md 규칙)

`Sidebar.tsx`와 `(app)/layout.tsx`는 **UI 위험 파일**이다.

1. `git switch -c ui/usage-analytics`
2. 커밋 분리 — **마이그레이션 단독 커밋**과 코드 커밋을 섞지 않는다(pre-push G1). `git add -A` 금지, 파일명 명시(병렬 세션).
3. `git push -u origin HEAD` → G2 통과(원격 이력 확보).
   ⚠️ Preview env가 0건이라 **로그인 뒤 화면은 Preview에서 볼 수 없다.** G2는 속도 방지턱이지 화면 보증이 아니다.
4. **마이그레이션을 Supabase Management API로 먼저 적용**한 뒤 코드를 배포한다(0027 PGRST 사고 교훈). `supabase db push`는 쓰지 않는다.
5. main 머지 → push(Vercel 자동 배포) → `npm run smoke:prod` → 화면 확인 후 `npm run mark:good`.

프로덕션 마이그레이션 적용과 배포는 **사용자 승인 후** 수행한다.

---

## 11. 범위 밖 (지금 하지 않는 것)

- 롤업/집계 테이블 (§3.1)
- 기능 단위 계측(엑셀 내려받기·PPT 생성·챗봇 질의) — 이번 "프로그램"은 **메뉴(화면) 단위**로 정의했다
- 체류 시간(dwell time) 측정
- 관리자 전용 전환 자체 — `canViewUsage` 한 함수로 준비만 한다
- 데이터 내보내기(엑셀/CSV)
