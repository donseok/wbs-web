# 계정별 UI 설정 동기화 (User Preferences Sync) — 설계

**날짜:** 2026-07-05
**상태:** 승인됨 (C안 하이브리드)

## 배경 / 문제

현재 D'Flow의 UI 상태는 계정별로 기억되지 않는다.

| 항목 | 현재 저장 위치 | 계정별? | 새로고침 유지 | 다른 기기 유지 |
|---|---|---|---|---|
| 요약 접기/펼치기 (PageHero) | 브라우저 localStorage (`dflow-hero`) | ❌ | ✅ | ❌ |
| 사이드바 접기 | localStorage (`dflow-sidebar`) | ❌ | ✅ | ❌ |
| 테마 (dark/light) | localStorage `dflow-theme` + 쿠키 | ❌ | ✅ | ❌ |
| 언어 (locale) | localStorage + 쿠키 | ❌ | ✅ | ❌ |
| WBS 트리 펼침/접힘 | React state (메모리) | ❌ | ❌ (매번 리셋) | ❌ |

Supabase 마이그레이션 0001~0016에 사용자별 UI 설정 테이블은 없다. 인증은 Supabase Auth(`auth.getUser()` → `user.id`)를 사용하므로 `user_id = auth.uid()` 기반 저장이 가능하다.

**목표:** 위 설정들이 계정에 묶여, 로그인하면 어느 기기에서든 이전 설정 그대로 복원되게 한다. WBS는 프로젝트별로 정확한 접힘/펼침 집합을 기억한다.

## 핵심 원칙 — 로컬 우선 + 서버 동기화 (local-first sync)

테마/언어/요약접기는 첫 페인트 전에 적용되어 화면 깜빡임이 없고(레이아웃의 no-flash 인라인 스크립트), 로그인 전에도 동작해야 한다. **이 동작을 깨지 않는 것이 하드 제약이다.**

따라서 서버를 유일 저장소로 바꾸지 않는다:

- **localStorage/쿠키** = 즉시 반영되는 로컬 캐시 (첫 페인트, 로그인 전 동작 담당).
- **서버(Supabase)** = 계정에 붙어 기기 간 따라오는 진실 원천.

동기화 규칙:

1. **로그인/앱 로드 시:** 서버 설정을 읽어 로컬 캐시에 반영한다. 서버에 값이 있으면 서버 값이 이긴다(로컬 캐시를 덮어씀). 서버가 비어 있으면 로컬 캐시 값을 유지하고, 그 값을 서버에 1회 백필(backfill)한다.
2. **변경 시:** 로컬 캐시(즉시) + 서버(debounce ~600ms) 양쪽에 기록한다.
3. **로그인 전:** 서버 호출 없이 기존 localStorage/쿠키 경로 그대로 동작.

이로써 깜빡임 없음 + 로그인 전 동작 유지 + 기기 간 동기화를 모두 만족한다.

## 데이터 모델 (migration 0017)

C안(하이브리드): 전역 설정은 사용자당 한 줄 JSONB, WBS는 프로젝트별 한 줄로 격리.

```sql
-- 전역 UI 설정: 사용자당 1행
create table user_preferences (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  prefs      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
-- prefs 예시:
-- { "heroCollapsed": true, "sidebarCollapsed": false, "theme": "dark", "locale": "ko" }

-- WBS 트리 접힘 상태: (사용자, 프로젝트)당 1행
create table user_wbs_state (
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  collapsed  jsonb not null default '[]'::jsonb,   -- 접힌 노드 id 문자열 배열
  updated_at timestamptz not null default now(),
  primary key (user_id, project_id)
);
```

**RLS (migration 0017, 기존 `app_role()`/정책 컨벤션 준수):** 두 테이블 모두 본인 행만 접근.

```sql
alter table user_preferences enable row level security;
alter table user_wbs_state   enable row level security;

-- select/insert/update/delete 모두 user_id = auth.uid() 조건
create policy up_self on user_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy uws_self on user_wbs_state
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

> 참고: 프로덕션 RLS 헬퍼는 리포지토리와 drift가 있으므로(메모리 `rls-helper-drift`), 여기서는 순수 `auth.uid()`만 사용해 drift 무관하게 안전하다.

## 서버 액션

`src/app/actions/preferences.ts` (신규):

- `getUiPrefs(): Promise<UiPrefs>` — 현재 사용자 `user_preferences.prefs` 반환(없으면 `{}`).
- `saveUiPrefs(patch: Partial<UiPrefs>): Promise<void>` — upsert + 부분 병합(기존 prefs에 patch 머지). 미로그인 시 no-op.
- `getWbsCollapse(projectId): Promise<string[] | null>` — 해당 프로젝트 접힘 id 배열(행 없으면 null).
- `saveWbsCollapse(projectId, ids: string[]): Promise<void>` — upsert. 미로그인 시 no-op.

`UiPrefs` 타입: `{ heroCollapsed?: boolean; sidebarCollapsed?: boolean; theme?: 'dark'|'light'; locale?: 'ko'|'en' }` (도메인 타입에 추가).

## 클라이언트 배선

### 전역 설정 (요약/사이드바/테마/언어)

기존 localStorage 로직은 **유지**하고, 그 위에 서버 동기화 계층을 얹는다.

- 신규 훅 `useServerSyncedPrefs()` (앱 셸 최상단, 예: `(app)` 레이아웃의 클라이언트 프로바이더에서 1회 마운트):
  - 마운트 시 `getUiPrefs()` 호출.
  - 서버 값이 있는 키 → 로컬 캐시(localStorage/쿠키)와 각 프로바이더 상태에 반영. 값이 다르면 서버가 이김.
  - 서버에 없는 키 → 현재 로컬 값을 `saveUiPrefs`로 1회 백필.
- 각 설정 변경 지점(`PageHero.setHeroCollapsed`, `Sidebar` 토글, `ThemeProvider.setTheme`, `LocaleProvider.setLocale`)에 debounce된 `saveUiPrefs({ ... })` 호출 추가. 로컬 쓰기는 지금처럼 즉시.
- 반영 방식은 기존 CustomEvent/프로바이더 상태 경로를 재사용(예: PageHero는 이미 `setHeroCollapsed` + CustomEvent dispatch 구조).

### WBS 트리

`WbsGanttSheet`는 서버 컴포넌트 `wbs/page.tsx`에서 `items`를 받는 클라이언트 컴포넌트다.

- `wbs/page.tsx`(서버)에서 `getWbsCollapse(projectId)` 호출 → `WbsGanttSheet`에 `initialCollapsed?: string[]` prop 전달.
- `WbsGanttSheet`의 초기 상태 변경:
  ```ts
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => initialCollapsed ? new Set(initialCollapsed) : splitParentIds(items),
  )
  ```
  (서버 저장값이 없으면 기존 기본값 = 담당별 분리 부모 접힘 유지.)
- `collapsed`가 바뀔 때 debounce(~600ms)로 `saveWbsCollapse(projectId, [...collapsed])`. `readOnly` 여부와 무관하게 개인 뷰 상태이므로 저장(읽기전용 사용자도 자기 펼침 상태는 기억).

## 에러 처리

- 서버 액션은 모두 실패해도 UI를 막지 않는다(로컬 캐시가 이미 동작). 실패는 조용히 무시하거나 콘솔 경고만.
- 미로그인/세션 만료 시 서버 액션은 no-op 반환(throw 금지) — 로컬 경로로 폴백.
- WBS `initialCollapsed`가 현재 트리에 없는 stale id를 포함해도 무해(존재하는 id에만 매칭). 정리는 다음 저장 때 자연 반영.

## 테스트

- **reconcile 로직 단위 테스트**: 서버 값 있음 → 로컬 덮어씀; 서버 비어있음 → 로컬 유지 + 백필 호출.
- **서버 액션 RLS 왕복**: 사용자 A가 저장한 값을 사용자 B가 못 읽음(본인 행만).
- **WBS initialCollapsed 렌더**: prop 주어지면 해당 노드가 접힌 상태로 렌더(기존 `tests/ui/wbs-*.test.tsx` 패턴 재사용).
- **부분 병합**: `saveUiPrefs({theme})`가 기존 `locale`을 지우지 않음.

## 범위 밖 (YAGNI)

- 설정 이력/버전 관리, 다중 탭 실시간 동기화(스토리지 이벤트 브로드캐스트), 관리자 대리 설정.
- WBS 외 다른 화면(간트 dayPx, 컬럼 표시 등)의 상태 저장 — 이번 범위 아님.

## 배포

- migration 0017을 리포지토리에 추가하고, 프로덕션은 메모리 `rls-helper-drift`의 Management API 적용 레시피로 반영.
- 기존 `deploy` 스킬 경로(커밋 → 푸시 → Vercel) 사용.
