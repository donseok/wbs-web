# 범용 WBS 코어 전환 (Plan A: P0 + 단계 0~3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** D'Flow 의 WBS 를 3단 고정에서 해방하는 코어 전환 — `level` 판정 폐기(depth 파생), `project_settings` 계층 신설·주입, sub-act 플래그화 — 을 **화면 1픽셀 변화 없이** 배포한다.

**Architecture:** 정본 스펙 `docs/design/dflow-generic-wbs-design-2026-07-29.md` 의 §11 이행 경로 중 P0+단계 0~3. 계산 코어는 이미 깊이 무관(감사 실측)이므로, 이 계획은 (1) 위험 스크립트 무해화 (2) 타입 넓히기로 결합 지점 노출 (3) 설정 테이블+로더 신설 (4) 하드코딩 값의 주입 전환 (5) DB CHECK 제거+플래그 백필만 수행한다. **임포트 마법사(단계 4)는 Plan B, N단 UI(단계 5~6)는 Plan C 로 분리** — 각자 독립 배포 가능한 단위다.

**Tech Stack:** Next.js 15 + Supabase(Management API 적용) · vitest · 기존 주입 패턴(팀 마스터 0044 선례)

## Global Constraints

- **회귀 0 이 유일한 합격 기준** (스펙 §2-4): 각 배포 후 D-CUBE 의 WBS 엑셀 익스포트(셀 단위)·대시보드 KPI 전량·진척 스냅샷 재계산·`npm run test`·`npm run smoke:prod` 가 전부 동일/초록.
- **마이그레이션과 코드는 별도 커밋**(G1). 모든 마이그레이션에 `_rollback.sql` 동반. 적용은 Management API(`db push` 금지).
- **UI 위험 파일 무접촉**: 이 계획은 `src/components/app/*`·`globals.css`·`layout.tsx` 를 건드리지 않는다. `WbsGanttSheet.tsx` 도 이 계획 범위 밖(Plan C).
- **에러 3원칙**: 설정 조회 — 행 없음=기본값(정상), 조회 실패=throw(위장 금지). 백필 검증 — 건수 대조.
- **`level` 컬럼은 이 계획에서 drop 하지 않는다**(스펙 §4.2 3단계 제거 — drop 은 Plan C 검증 후). 기존 쓰기 경로는 하위호환용으로 legacy 문자열을 계속 쓴다. **신규 코드는 `level` 을 읽지 않는다**가 규율이고, UI 표시용 잔존 참조(shared.tsx·RowDetailPanel·WbsGanttSheet)는 Plan C 범위로 명시 이월한다.
- 다음 마이그레이션 번호: **0058**(project_settings), **0059**(level CHECK 해제+is_owner_split). 선행 확인: `ls supabase/migrations | tail`.
- 커밋 메시지는 한국어 "왜" 중심 + 트레일러 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. `git add -A` 금지.
- 미결 사항 잠정값(스펙 §12, 이 계획의 결정): Q2 `max_depth` 기본 null(무제한, UI 상한은 Plan C 에서 재론) · Q5 `biz` 유지(그림자 컬럼 그대로 — D-CUBE 행 `extra_axis_label='Biz'`) · Q6 마일스톤 부분 일치 유지(현행 동일). Q1/Q3/Q4 는 Plan B 에서 결정.

---

### Task 1: P0 — 적용 스크립트의 운영 DB 하드코딩 제거

**Files:**
- Modify: `scripts/apply-0028.mjs`, `scripts/apply-0038.mjs`, `scripts/apply-0039.mjs`, `scripts/apply-0040.mjs`, `scripts/apply-0041.mjs`, `scripts/apply-0042.mjs`, `scripts/apply-0043.mjs`, `scripts/apply-0050.mjs` (8개 — 각 파일의 `const PROJECT_REF = 'rglfgrwwwwdqejohdnty'` 라인)
- Modify: `scripts/mark-good.mjs:71` (고정 URL)
- Test: 없음(스크립트) — 검증은 드라이 실행

**Interfaces:**
- Produces: 모든 apply 스크립트가 `SUPABASE_PROJECT_REF` env 필수 + 실행 전 ref 출력·확인을 요구. `mark-good.mjs` 가 `SMOKE_URL` 오버라이드를 지원.

- [ ] **Step 1: 8개 apply 스크립트 공통 패치**

각 파일의 `const PROJECT_REF = 'rglfgrwwwwdqejohdnty'` 를 다음으로 교체(파일마다 동일):

```js
// 운영 DB 오적용 방지(스펙 §10.11) — ref 하드코딩 금지. 반드시 env 로 받고 화면에 밝힌다.
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF
if (!PROJECT_REF) {
  console.error('SUPABASE_PROJECT_REF 가 필요합니다. 예: SUPABASE_PROJECT_REF=<ref> node scripts/apply-XXXX.mjs')
  process.exit(1)
}
if (process.env.APPLY_CONFIRM !== PROJECT_REF) {
  console.error(`대상 프로젝트: ${PROJECT_REF}`)
  console.error(`확인을 위해 APPLY_CONFIRM=${PROJECT_REF} 를 함께 지정해 다시 실행하세요.`)
  process.exit(1)
}
```

- [ ] **Step 2: mark-good.mjs URL 오버라이드**

`scripts/mark-good.mjs` 의 `https://wbs-web.vercel.app` 고정 라인을 `smoke-prod.mjs:24` 와 같은 방식으로:

```js
const BASE = (process.env.SMOKE_URL || 'https://wbs-web.vercel.app').replace(/\/$/, '')
```

(기존 사용처 변수명에 맞춰 치환 — 파일을 열어 실제 변수명을 확인하고 그 이름을 유지한다.)

- [ ] **Step 3: 드라이 검증**

Run: `node scripts/apply-0050.mjs` (env 없이)
Expected: `SUPABASE_PROJECT_REF 가 필요합니다` + exit 1. DB 접근 0.
Run: `SUPABASE_PROJECT_REF=dummy node scripts/apply-0050.mjs`
Expected: `APPLY_CONFIRM=dummy ...` 안내 + exit 1.

- [ ] **Step 4: 커밋**

```bash
git add scripts/apply-0028.mjs scripts/apply-0038.mjs scripts/apply-0039.mjs scripts/apply-0040.mjs scripts/apply-0041.mjs scripts/apply-0042.mjs scripts/apply-0043.mjs scripts/apply-0050.mjs scripts/mark-good.mjs
git commit -m "chore(scripts): 적용 스크립트의 운영 DB ref 하드코딩 제거 — env 필수+이중 확인

다른 인스턴스에서 그대로 실행하면 D-CUBE 운영 DB 에 DDL 이 나가는
구조였다(스펙 §10.11). 두 번째 프로젝트가 생기기 전에 막는다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 단계 0 — `Level = string` 타입 넓히기 + 룩업 4곳 안전화

**Files:**
- Modify: `src/lib/domain/types.ts:1`
- Modify: `src/components/wbs/shared.tsx:23-29` (LEVEL 룩업)
- Modify: `src/components/wbs/RowDetailPanel.tsx:27` (CHILD_LEVEL)
- Modify: `src/lib/report/weekly.ts:254` (LEVEL_LABEL)
- Modify: `src/lib/ai/analytics.ts:18` (LEVEL_KO)
- Test: `tests/domain/level-widening.test.ts` (신규)

**Interfaces:**
- Produces: `type Level = string` (DEPRECATED 주석). 4개 룩업이 미정의/null 레벨에서 **크래시·조용한 빈칸 대신 안전 폴백**을 갖는다. 동작은 기존 3값에 대해 현행과 동일.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/level-widening.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Level } from '@/lib/domain/types'

describe('Level 타입 넓히기 (스펙 §4.3)', () => {
  it('임의 문자열이 Level 에 대입 가능해야 한다 — 컴파일 게이트', () => {
    const custom: Level = '설계'   // 3값 유니언이면 여기서 tsc 가 실패한다
    expect(typeof custom).toBe('string')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsc --noEmit`
Expected: FAIL — `'설계'` 가 `Level` 유니언에 대입 불가. (vitest 는 transpile-only 라 tsc 로 확인한다.)

- [ ] **Step 3: 타입 넓히기**

`src/lib/domain/types.ts:1`:

```ts
/** DEPRECATED — 깊이 판정에 쓰지 않는다(진실은 parent_id 트리). 프로젝트별 레벨 라벨은 ProjectConfig.levelLabels. */
export type Level = string
```

- [ ] **Step 4: 드러난 룩업 4곳을 안전 폴백으로 교체**

Run: `npx tsc --noEmit` → `Record<Level, …>` 이던 곳들이 에러로 드러난다. 각각:

`src/components/wbs/shared.tsx` — 미정의 레벨의 런타임 TypeError 방지(스펙 §4.4):

```tsx
const LEVEL: Record<string, { label: string; cls: string } | undefined> = {
  phase: { label: 'PHASE', cls: 'bg-brand-weak text-brand' },
  task: { label: 'TASK', cls: 'bg-progress-weak text-progress' },
  activity: { label: 'ACT', cls: 'bg-pending-weak text-pending' },
}
/** 미정의·null 레벨 폴백 — 크래시 대신 중립 배지(Plan C 에서 depth 기반으로 대체). */
const LEVEL_FALLBACK = { label: 'ITEM', cls: 'bg-surface-2 text-ink-muted' }
```

사용처(`LEVEL[l]` 형태)는 `LEVEL[l] ?? LEVEL_FALLBACK` 으로. 기존 3값 렌더는 불변.

`src/components/wbs/RowDetailPanel.tsx:27`:

```ts
/** DEPRECATED(Plan C 에서 depth+maxDepth 판정으로 대체) — 미정의 레벨은 자식 추가 버튼을 숨긴다(안전측). */
const CHILD_LEVEL: Record<string, Level | null | undefined> = { phase: 'task', task: 'activity', activity: null }
```

사용처의 `CHILD_LEVEL[level]` 은 `CHILD_LEVEL[level] ?? null` 로.

`src/lib/report/weekly.ts:254`:

```ts
const LEVEL_LABEL: Record<string, string | undefined> = { phase: 'Phase', task: 'Task', activity: 'Activity' }
```

'Lv' 열 기록처는 `LEVEL_LABEL[level] ?? (level || '-')` — 조용한 빈칸 제거.

`src/lib/ai/analytics.ts:18`:

```ts
const LEVEL_KO: Record<string, string | undefined> = { phase: 'Phase', task: 'Task', activity: 'Activity' }
```

사용처는 `LEVEL_KO[x] ?? x` — `'구분 undefined'` 임베딩 제거.

- [ ] **Step 5: 통과 확인 (전량)**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 클린, 기존 테스트 전량 통과(3값 fixture 는 문자열이라 그대로 통과 — 스펙 §4.5).

- [ ] **Step 6: 커밋**

```bash
git add src/lib/domain/types.ts src/components/wbs/shared.tsx src/components/wbs/RowDetailPanel.tsx src/lib/report/weekly.ts src/lib/ai/analytics.ts tests/domain/level-widening.test.ts
git commit -m "refactor(wbs): Level 유니언 폐기(string) — 룩업 4곳을 타입 에러로 노출해 안전 폴백으로

TeamCode 가 0044 때 간 길 그대로(스펙 §4.3). 미정의 레벨의 런타임
TypeError·조용한 빈칸·'구분 undefined' 임베딩을 같은 커밋에서 제거한다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 단계 1a — 마이그레이션 0058 `project_settings` (+현행 재현 시드)

**Files:**
- Create: `supabase/migrations/0058_project_settings.sql`
- Create: `supabase/migrations/0058_project_settings_rollback.sql`
- Test: `tests/migrations/project-settings.test.ts` (신규 — 0057 계약 테스트 `tests/migrations/agent-work-loop.test.ts` 패턴)

**Interfaces:**
- Produces: 테이블 `project_settings` (스펙 §7.2 스키마 그대로). **기존 전 프로젝트에 현행 동작 재현 행 시드**(§7.5 — D-CUBE 회귀 0 의 핵심).

- [ ] **Step 1: 마이그레이션 SQL 작성** (0050~0057 관례: begin/commit·if not exists·revoke/grant·search_path 핀)

`supabase/migrations/0058_project_settings.sql`:

```sql
-- 프로젝트 설정 계층 (스펙 §7 — 행 없음 = 전체 기본값이 계약)
begin;
set search_path = public, extensions;

create table if not exists public.project_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  level_labels    text[]  not null default array['Phase','Task','Activity'],
  max_depth       int,
  extra_axis_label text,
  milestone_keywords text[] not null default array[]::text[],
  excel_profile   jsonb   not null default '{}'::jsonb,
  -- P3/P4/P7 자리 — 이번 스펙에서는 읽지 않는다(스펙 §7.2)
  enabled_modules text[],
  weekly_sections text[],
  working_days    int[],
  timezone        text,
  preset_applied  text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id)
);

alter table public.project_settings enable row level security;
drop policy if exists read_project_settings on public.project_settings;
create policy read_project_settings on public.project_settings for select to authenticated
  using (true);  -- 설정은 로그인 사용자 전원 조회(라벨·키워드는 화면 공용). 쓰기 정책 없음(서버 관문).

revoke all on table public.project_settings from public, anon, authenticated;
grant select on table public.project_settings to authenticated;
grant all on table public.project_settings to service_role;

-- §7.5 — 기존 프로젝트 전부에 '현행 동작 재현' 행을 시드한다. 이 행이 있으면 화면은 1픽셀도 안 바뀐다.
insert into public.project_settings (project_id, level_labels, max_depth, extra_axis_label, milestone_keywords, weekly_sections, preset_applied)
select p.id,
       array['Phase','Task','Activity'],
       3,
       'Biz',
       array['착수보고','중간보고','보고회','마스터 플랜','bmt','최종 선정','승인','준공','kick-off','킥오프'],
       array['PMO','영업','구매','생산','품질','물류','조업및표준화','원가','인사총무','전산기획'],
       'legacy-dcube'
from public.projects p
on conflict (project_id) do nothing;

reset search_path;
commit;
```

⚠️ `weekly_sections` 시드값은 **구현 시 `src/lib/data/weeklySheet.ts:19` 의 `WEEKLY_SECTIONS` 실물과 대조해 그대로 옮긴다** — 위 10개는 계획 작성 시점 추정이며 실물이 정본이다(§10.2 쓰기 계약). `milestone_keywords` 는 `dashboard.ts:62` 실물과 대조(현재 10개 확인됨).

- [ ] **Step 2: 롤백 SQL 작성**

```sql
-- 0058 롤백 — 신규 테이블만 제거. 기존 테이블 무접촉이었으므로 복원 대상 없음.
begin;
set search_path = public, extensions;
drop table if exists public.project_settings;
reset search_path;
commit;
```

- [ ] **Step 3: 계약 테스트 작성 후 실행**

`tests/migrations/project-settings.test.ts` — `tests/migrations/agent-work-loop.test.ts` 를 본떠 SQL 텍스트를 assert:
begin/commit 래핑 · `create table if not exists` · 기본값 3종(`array['Phase','Task','Activity']`, `'{}'::jsonb`, `array[]::text[]`) · 쓰기 정책 부재 · revoke/grant 3줄 · 시드 insert 의 `on conflict do nothing` · 롤백의 `drop table if exists`.

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const sql = readFileSync('supabase/migrations/0058_project_settings.sql', 'utf8')
const rollback = readFileSync('supabase/migrations/0058_project_settings_rollback.sql', 'utf8')
describe('0058 project_settings 계약', () => {
  it('멱등·트랜잭션', () => {
    expect(sql).toMatch(/^begin;/m); expect(sql).toMatch(/^commit;/m)
    expect(sql).toContain('create table if not exists public.project_settings')
  })
  it('현행 재현 시드 — 회귀 0 의 근거', () => {
    expect(sql).toContain("array['Phase','Task','Activity']")
    expect(sql).toContain('on conflict (project_id) do nothing')
    expect(sql).toContain("'legacy-dcube'")
  })
  it('쓰기 정책 없음 + 하드닝', () => {
    expect(sql).not.toMatch(/for (insert|update|delete)/)
    expect(sql).toContain('revoke all on table public.project_settings')
  })
  it('롤백은 신규 테이블만', () => {
    expect(rollback).toContain('drop table if exists public.project_settings')
    expect(rollback).not.toContain('alter table')
  })
})
```

Run: `npx vitest run tests/migrations` → PASS

- [ ] **Step 4: 커밋 (마이그레이션+테스트 — 테스트는 코드이므로 별도 커밋 2개)**

```bash
git add supabase/migrations/0058_project_settings.sql supabase/migrations/0058_project_settings_rollback.sql
git commit -m "db: project_settings — 행 없음=기본값 계약 + 기존 프로젝트 현행 재현 시드

시드 행이 회귀 0 의 근거다(스펙 §7.5): 값이 현행 상수와 동일하므로
주입 전환 후에도 D-CUBE 화면은 변하지 않는다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git add tests/migrations/project-settings.test.ts
git commit -m "test(db): 0058 계약 테스트 — 멱등·시드·쓰기정책 부재 고정

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 단계 1b — 프리셋 + `getProjectConfig` 로더

**Files:**
- Create: `src/lib/domain/projectPresets.ts`
- Create: `src/lib/data/projectConfig.ts`
- Test: `tests/domain/project-presets.test.ts`, `tests/data/project-config.test.ts`

**Interfaces:**
- Produces:
  - `PRESETS: Record<'pi'|'swdev'|'blank', ProjectPreset>` + `type ProjectPreset`
  - `interface ProjectConfig { levelLabels: string[]; maxDepth: number | null; extraAxisLabel: string | null; milestoneKeywords: string[]; excelProfile: Record<string, unknown> }`
  - `DEFAULT_PROJECT_CONFIG: ProjectConfig` (행 없음일 때)
  - `getProjectConfig(projectId: string, client?): Promise<ProjectConfig>` — 행 없음=기본값, 조회 실패=throw
  - 마일스톤 키워드는 로더에서 **소문자 정규화**(스펙 §7.4 함정 2)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/project-presets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PRESETS } from '@/lib/domain/projectPresets'

describe('프로젝트 프리셋 (스펙 §8)', () => {
  it('pi 프리셋 = D-CUBE 현행 재현', () => {
    expect(PRESETS.pi.levelLabels).toEqual(['Phase', 'Task', 'Activity'])
    expect(PRESETS.pi.maxDepth).toBe(3)
    expect(PRESETS.pi.extraAxisLabel).toBe('Biz')
    expect(PRESETS.pi.milestoneKeywords.length).toBeGreaterThan(0)
  })
  it('키워드는 전부 소문자(§7.4 — isMilestoneLeaf 가 lowercase 비교)', () => {
    for (const p of Object.values(PRESETS))
      for (const k of p.milestoneKeywords) expect(k).toBe(k.toLowerCase())
  })
  it('빈 키워드 프리셋 금지(§7.4 — 마일스톤 카드 무증상 소실)', () => {
    for (const p of Object.values(PRESETS)) expect(p.milestoneKeywords.length).toBeGreaterThan(0)
  })
})
```

`tests/data/project-config.test.ts` (mock supabase — tests/agent 관례의 큐 mock):

```ts
import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
import { getProjectConfig, DEFAULT_PROJECT_CONFIG } from '@/lib/data/projectConfig'

function client(data: unknown, error: { message: string } | null = null) {
  const b: Record<string, unknown> = {}
  for (const k of ['from', 'select', 'eq']) b[k] = () => b
  b.maybeSingle = async () => ({ data, error })
  return b as never
}

describe('getProjectConfig', () => {
  it('행 없음 = 기본값 (정상 — fail-safe 계약)', async () => {
    mocks.createServerClient.mockResolvedValue(client(null))
    const c = await getProjectConfig('11111111-1111-4111-8111-111111111111')
    expect(c).toEqual(DEFAULT_PROJECT_CONFIG)
  })
  it('조회 실패 = throw (기본값으로 위장 금지 — 3원칙)', async () => {
    mocks.createServerClient.mockResolvedValue(client(null, { message: 'db down' }))
    await expect(getProjectConfig('11111111-1111-4111-8111-111111111111')).rejects.toThrow('db down')
  })
  it('키워드 소문자 정규화', async () => {
    mocks.createServerClient.mockResolvedValue(client({
      level_labels: ['A', 'B'], max_depth: 5, extra_axis_label: null,
      milestone_keywords: ['Kick-Off', 'BMT'], excel_profile: {},
    }))
    const c = await getProjectConfig('11111111-1111-4111-8111-111111111111')
    expect(c.milestoneKeywords).toEqual(['kick-off', 'bmt'])
    expect(c.levelLabels).toEqual(['A', 'B'])
  })
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/domain/project-presets.test.ts tests/data/project-config.test.ts` → 모듈 없음 FAIL

- [ ] **Step 3: 구현**

`src/lib/domain/projectPresets.ts`:

```ts
/**
 * 프로젝트 생성 프리셋 (스펙 §8) — 생성 시 1회 project_settings 로 구체화되는 시드.
 * DB 에는 preset_applied 이름만 남고 런타임에 이 상수를 다시 읽는 코드는 없다.
 * 이름은 성격이 아니라 설정 내용을 말한다(§8.2-3).
 */
export interface ProjectPreset {
  /** 설정 화면에 보여줄 정직한 요약 — '3단 WBS · 분류축 사용' 형식 */
  summary: string
  levelLabels: string[]
  maxDepth: number | null
  extraAxisLabel: string | null
  /** 소문자만(§7.4 — isMilestoneLeaf 가 name.toLowerCase() 와 비교). 빈 배열 금지(카드 무증상 소실). */
  milestoneKeywords: string[]
}

export const PRESETS = {
  pi: {
    summary: '3단 WBS · 분류축(Biz) · PI 보고 어휘',
    levelLabels: ['Phase', 'Task', 'Activity'],
    maxDepth: 3,
    extraAxisLabel: 'Biz',
    milestoneKeywords: ['착수보고', '중간보고', '보고회', '마스터 플랜', 'bmt', '최종 선정', '승인', '준공', 'kick-off', '킥오프'],
  },
  swdev: {
    summary: '5단 WBS · 분류축 없음 · 개발 마일스톤 어휘',
    levelLabels: ['단계', '기능', '작업', '세부', '항목'],
    maxDepth: 5,
    extraAxisLabel: null,
    milestoneKeywords: ['킥오프', 'kick-off', '오픈', '릴리스', 'release', '검수', '이행', 'uat', '준공'],
  },
  blank: {
    summary: '깊이 무제한 · 최소 설정',
    levelLabels: ['1단', '2단', '3단'],
    maxDepth: null,
    extraAxisLabel: null,
    milestoneKeywords: ['마일스톤', 'milestone'],
  },
} as const satisfies Record<string, ProjectPreset>
```

`src/lib/data/projectConfig.ts`:

```ts
import { createServerClient } from '@/lib/supabase/server'

/**
 * 프로젝트 설정 로더 (스펙 §7.3) — 전역 캐시가 아니라 주입.
 * 행 없음 = 기본값(fail-safe 계약, 정상). 조회 실패 = throw(기본값 위장 금지 — 3원칙).
 */
export interface ProjectConfig {
  levelLabels: string[]
  maxDepth: number | null
  extraAxisLabel: string | null
  milestoneKeywords: string[]
  excelProfile: Record<string, unknown>
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  levelLabels: ['Phase', 'Task', 'Activity'],
  maxDepth: null,
  extraAxisLabel: null,
  milestoneKeywords: [],
  excelProfile: {},
}

type Client = { from: (t: string) => unknown }

export async function getProjectConfig(projectId: string, client?: Client): Promise<ProjectConfig> {
  const sb = (client ?? (await createServerClient())) as never as {
    from: (t: string) => {
      select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }> } }
    }
  }
  const { data, error } = await sb
    .from('project_settings')
    .select('level_labels, max_depth, extra_axis_label, milestone_keywords, excel_profile')
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) throw new Error(`프로젝트 설정 조회 실패: ${error.message}`)
  if (!data) return DEFAULT_PROJECT_CONFIG
  const row = data as {
    level_labels: string[]; max_depth: number | null; extra_axis_label: string | null
    milestone_keywords: string[]; excel_profile: Record<string, unknown>
  }
  return {
    levelLabels: row.level_labels,
    maxDepth: row.max_depth,
    extraAxisLabel: row.extra_axis_label,
    // §7.4 함정 2 — isMilestoneLeaf 는 lowercase 비교. 주입 전에 정규화해 계약을 로더가 보증한다.
    milestoneKeywords: (row.milestone_keywords ?? []).map(k => k.toLowerCase()),
    excelProfile: row.excel_profile ?? {},
  }
}
```

- [ ] **Step 4: 통과 확인** — 두 테스트 파일 PASS + `npx tsc --noEmit`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/projectPresets.ts src/lib/data/projectConfig.ts tests/domain/project-presets.test.ts tests/data/project-config.test.ts
git commit -m "feat(settings): 프리셋 상수 + getProjectConfig 로더 — 행 없음=기본값, 실패=throw

전역 캐시 대신 주입(스펙 §7.3 — 팀 마스터와 달리 프로젝트별 값이라
키 있는 캐시는 무효화 버그를 부른다). 키워드 소문자 정규화를 로더가 보증.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 단계 2a — 마일스톤 키워드 주입

**Files:**
- Modify: `src/lib/domain/dashboard.ts:61-79` (MILESTONE_KEYWORDS·isMilestoneLeaf·detectMilestones)
- Modify: `detectMilestones` 호출처 전부 — `grep -rn "detectMilestones(" src/ | grep -v domain/dashboard` 로 전수 확인(최소: 대시보드 서버 로딩 경로, `src/lib/ai/tools/dashboard.ts:96`)
- Test: `tests/domain/dashboard.test.ts` 기존 + 신규 케이스

**Interfaces:**
- Produces: `detectMilestones(items: ComputedItem[], today: string, keywords: readonly string[]): MilestoneModel` — **keywords 인자 필수**(기본값 없음 — 컴파일 에러로 전 호출처 노출, Task 2 와 같은 전략). 기존 상수는 `LEGACY_MILESTONE_KEYWORDS` 로 개명·export(@deprecated) — 설정 로더가 없는 호출처의 임시 주입원.

- [ ] **Step 1: 실패하는 테스트 추가** (tests/domain/dashboard.test.ts 에)

```ts
it('마일스톤 키워드는 주입된다 — 주입값이 다르면 판정도 달라진다', () => {
  const leaf = fx.leaf({ name: '릴리스 준비', plannedEnd: '2026-08-10' })   // 기존 fixture 헬퍼 사용
  const withHit = detectMilestones([leaf], '2026-08-01', ['릴리스'])
  const withoutHit = detectMilestones([leaf], '2026-08-01', ['착수보고'])
  expect(withHit.name).toBe('릴리스 준비')
  expect(withoutHit.name).toBeNull()
})
```

(기존 테스트 파일의 fixture 헬퍼 형태를 따른다 — 파일을 열어 실제 헬퍼명을 확인하고 그것을 쓴다. 기존 detectMilestones 테스트들은 `LEGACY_MILESTONE_KEYWORDS` 를 주입하도록 시그니처만 갱신.)

- [ ] **Step 2: 실패 확인** — tsc/vitest FAIL (인자 불일치)

- [ ] **Step 3: 구현**

`dashboard.ts`:

```ts
/** @deprecated 주입 전환(스펙 §7.4) — 설정 미로딩 호출처의 임시 주입원. 신규 코드는 ProjectConfig.milestoneKeywords 를 주입할 것. */
export const LEGACY_MILESTONE_KEYWORDS: readonly string[] =
  ['착수보고', '중간보고', '보고회', '마스터 플랜', 'bmt', '최종 선정', '승인', '준공', 'kick-off', '킥오프']

function isMilestoneLeaf(l: ComputedItem, keywords: readonly string[]): boolean {
  const name = l.name.toLowerCase()
  const kw = keywords.some(k => name.includes(k))
  const singleDay =
    l.plannedStart != null && l.plannedStart === l.plannedEnd && !!(l.deliverable && l.deliverable.trim())
  return kw || singleDay
}

export function detectMilestones(items: ComputedItem[], today: string, keywords: readonly string[]): MilestoneModel {
```

호출처: 대시보드 서버 경로는 `getProjectConfig(projectId)` 를 기존 `Promise.all` 에 합류시켜 `config.milestoneKeywords` 를 주입(행이 시드돼 있으므로 값은 현행과 동일 = 회귀 0). **설정 로딩이 구조적으로 어려운 호출처(봇 도구 등)는 `LEGACY_MILESTONE_KEYWORDS` 를 명시 주입**하고 `// TODO(Plan B/C): config 주입` 을 남기지 말 것 — 대신 주석으로 `@deprecated 주입원` 임을 표기(추적은 deprecated 심볼 참조 검색으로 한다).

- [ ] **Step 4: 통과 확인** — `npx tsc --noEmit && npx vitest run tests/domain` PASS. `grep -rn "MILESTONE_KEYWORDS" src/` 에 LEGACY 이외 참조 0.

- [ ] **Step 5: 커밋** (메시지: "feat(settings): 마일스톤 키워드 주입 전환 — 시드 행 덕에 D-CUBE 판정 불변" + 트레일러)

---

### Task 6: 단계 2b — 팀 폴백 구멍 2개 + DISPLAY_ENUMS 현존 버그

**Files:**
- Modify: `src/lib/domain/dashboard.ts:190-198` (`PROGRESS_TEAMS` 기본 인자 제거)
- Modify: `src/lib/ai/analytics.ts:100` (`buildWeeklyReportModel` 에 teams 주입)
- Modify: `src/lib/report/weekly.ts:297` (`REPORT_TEAMS` 폴백 제거 — teams 인자 필수화)
- Modify: `src/lib/ai/chat/orchestrator.ts:146` (`DISPLAY_ENUMS` 에 `activity: 'Activity'` 추가)
- Test: 기존 `tests/domain/dashboard.test.ts`·`tests/report/weekly.test.ts` 시그니처 갱신 + 신규 1케이스

**Interfaces:**
- Produces: `teamProgress(leaves, teams)` — teams **필수**. `buildWeeklyReportModel(..., { teams })` — teams **필수**(옵션 제거). 호출처는 팀 마스터(`activeCodes`/`progress_visible`)를 주입. `ALL_TEAMS`/`PROGRESS_TEAMS`/`REPORT_TEAMS` 상수는 삭제하고, 테스트 전용 fixture 는 각 테스트 파일 안에 지역 상수로.

- [ ] **Step 1: 상수 참조 전수 조사**

Run: `grep -rn "PROGRESS_TEAMS\|REPORT_TEAMS\|ALL_TEAMS" src/ tests/ | grep -v "\.test\."`
Expected: `dashboard.ts`(정의·기본인자), `riskSignals.ts:290`(`input.teams ?? ALL_TEAMS`), `weekly.ts:297`, `analytics.ts:100` 경로. 이 목록이 전부 교체 대상이다 — 새로 발견되면 같은 원칙(필수 주입)으로 처리하고 리포트에 기록.

- [ ] **Step 2: 실패하는 테스트** — `tests/ai/analytics` 계열(또는 knowledge 경로 테스트)에 "활성 팀이 주입되면 그 팀이 워크로드에 나타난다" 1케이스. 기존 테스트들의 시그니처 갱신은 tsc 가 강제한다.

- [ ] **Step 3: 구현** — 기본 인자·`?? ALL_TEAMS`·`?? REPORT_TEAMS` 폴백 제거, 호출 경로마다 팀 마스터 주입(서버 경로는 이미 로딩 중인 teams 를 전달, `analytics.ts:100` 은 호출자에게 teams 인자를 추가로 요구 — `knowledge.ts:44,53` → `answer.ts`/`api/chat/context/route.ts` 까지 체인으로 올라가며 tsc 에러를 따라간다). `orchestrator.ts:146` 에 `activity: 'Activity',` 1줄.

- [ ] **Step 4: 통과 확인** — `npx tsc --noEmit && npx vitest run` 전량.

- [ ] **Step 5: 커밋** (메시지: "fix(teams): 죽은 5팀 폴백 2개 제거 — 관리자가 팀을 바꿔도 봇·대시보드가 따라온다" + §10.4/§10.15/§10.9 근거 + 트레일러)

---

### Task 7: 단계 2c — 주말 판정 2벌→1벌 + `seoulToday()` 15벌→1벌

**Files:**
- Modify: `src/lib/domain/dates.ts` (단일 출처 신설: `isWeekendDow`·`todayInTz`)
- Modify: `src/lib/domain/ganttScale.ts:37-39` (자체 isWeekend 정의 제거 → dates 재사용)
- Modify: `seoulToday` 정의 15벌 → `import { seoulToday } from '@/lib/domain/dates'` (§10.19 의 목록: `(app)/layout.tsx:15`, `meetings/page.tsx:12`, `projects/page.tsx:33`, `minutes/page.tsx:14`, `p/[projectId]/announcements|issues|meetings|weekly/page.tsx`, `attendance/page.tsx:21`, `actions/announcements.ts:31`, `AnnouncementsView.tsx:28`, `DashboardView.tsx:24`, `api/export/route.ts:20`, `api/report/route.ts:28`, `api/minutes/export/route.ts:103` — 구현 시 `grep -rn "Asia/Seoul" src/ | grep -i today` 로 전수 재확인이 정본)
- Test: `tests/domain/dates.test.ts` 케이스 추가

**Interfaces:**
- Produces (dates.ts):

```ts
/** 주말 판정의 단일 출처(스펙 §10.12 — 정의 2벌 금지). 소비: isBusinessDay·ganttScale. 요일 규칙 설정화는 P7. */
export function isWeekendDow(dow: number): boolean {
  return dow === 0 || dow === 6
}
/** '오늘'의 단일 출처(스펙 §10.19 — 15벌 흩어짐 금지). 타임존 설정화는 P7 — 지금은 Asia/Seoul 고정. */
export function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}
```

⚠️ 구현 시 **기존 15벌 중 한 곳의 실물 구현을 열어 그대로 옮긴다**(위는 대표형 — 실물들이 `toLocaleDateString('en-CA', …)` 등 다른 표기면 그 다수형을 채택). 15벌의 출력이 서로 다르면 그 자체가 버그이므로 리포트에 기록하고 다수형으로 통일.

- [ ] **Step 1: 테스트** — `isWeekendDow` 7요일 전수, `seoulToday()` 가 `YYYY-MM-DD` 형식(고정 시각 mock 없이 형식만).
- [ ] **Step 2~3: 구현·교체** — ganttScale 은 `isWeekendDow(new Date(d + 'T00:00:00Z').getUTCDay())` 로. `isBusinessDay` 도 내부에서 `isWeekendDow` 사용. 15벌 정의 제거 후 import 교체(정의만 바꾸고 호출부 이름은 유지 — diff 최소).
- [ ] **Step 4: 통과 확인** — `npx tsc --noEmit && npx vitest run` 전량 + `grep -rn "dow === 0 || dow === 6" src/ | wc -l` = 1.
- [ ] **Step 5: 커밋** (메시지: "refactor(dates): 주말·오늘 판정을 단일 출처로 — P7 설정화의 선행 정지작업" + 트레일러)

---

### Task 8: 단계 3a — 마이그레이션 0059: level CHECK 해제 + `is_owner_split`

**Files:**
- Create: `supabase/migrations/0059_level_uncheck_owner_split.sql`
- Create: `supabase/migrations/0059_level_uncheck_owner_split_rollback.sql`
- Test: `tests/migrations/level-uncheck.test.ts`

**Interfaces:**
- Produces: `wbs_items.level` CHECK 제거·nullable·DEPRECATED 코멘트(스펙 §4.2), `wbs_items.is_owner_split boolean not null default false` + 백필(§5.2). **주의: `alter table wbs_items` 가 포함된다 — 이 계획에서 유일하게 기존 테이블을 만지는 지점**이므로 아래 안전장치가 계약이다: CHECK/NOT NULL 해제와 컬럼 추가는 데이터 무손실·잠금 최소(default 있는 add column 은 PG11+ 메타데이터 전용).

- [ ] **Step 1: SQL 작성**

```sql
-- 레벨 모델 해방 (스펙 §4.2·§5.2). alter 는 제약 해제와 컬럼 추가뿐 — 데이터 변형은 백필 update 1건.
begin;
set search_path = public, extensions;

alter table public.wbs_items drop constraint if exists wbs_items_level_check;
alter table public.wbs_items alter column level drop not null;
comment on column public.wbs_items.level is
  'DEPRECATED — 깊이의 진실은 parent_id 트리다. 하위호환 표시용으로만 남긴다. 신규 코드는 읽지 않는다.';

alter table public.wbs_items add column if not exists is_owner_split boolean not null default false;

-- 백필: 부모가 activity 인 activity = 기존 sub-act (§5.2). 적용 전후 건수 대조는 적용 절차(Task 11)에서.
update public.wbs_items c set is_owner_split = true
from public.wbs_items p
where c.parent_id = p.id and c.level = 'activity' and p.level = 'activity'
  and c.is_owner_split = false;

reset search_path;
commit;
```

- [ ] **Step 2: 롤백 SQL** — 위반 행이 있으면 **중단하고 리포트**(§4.2 — 조용히 데이터를 고치지 않는다):

```sql
begin;
set search_path = public, extensions;
do $$
declare bad int;
begin
  select count(*) into bad from public.wbs_items
   where level is null or level not in ('phase','task','activity');
  if bad > 0 then
    raise exception '0059 롤백 중단: level 3값 밖 행 %건 — 먼저 데이터를 정리하라 (select distinct level from wbs_items)', bad;
  end if;
end $$;
alter table public.wbs_items alter column level set not null;
alter table public.wbs_items add constraint wbs_items_level_check
  check (level in ('phase','task','activity'));
alter table public.wbs_items drop column if exists is_owner_split;
reset search_path;
commit;
```

- [ ] **Step 3: 계약 테스트** — 0058 패턴: CHECK drop·not null drop·코멘트 DEPRECATED·add column if not exists·백필 update 의 `is_owner_split = false` 가드·롤백의 위반행 중단 raise.
- [ ] **Step 4: 커밋 2개** (마이그레이션 단독 / 테스트).

---

### Task 9: 단계 3b — 도메인 전환: 플래그 정렬·주입, `addSubAct`·`validate` 재정의

**Files:**
- Modify: `src/lib/domain/types.ts` (WbsRow 에 `isOwnerSplit: boolean` 추가)
- Modify: `src/lib/data/wbs.ts:75` 부근 (행 매핑에 `isOwnerSplit: r.is_owner_split === true` 추가 + select 컬럼 추가)
- Modify: `src/lib/domain/tree.ts` (SUB_ACT_TEAM_ORDER 삭제 → 주입, level 참조 제거)
- Modify: `src/app/actions/wbs.ts` addSubAct (레벨 가드 3중 → 플래그·리프 판정)
- Modify: `src/lib/excel/validate.ts:74,78` (splitLeafOwners 가 `is_owner_split: true` 를 실어 보냄) — **선행 확인: `supabase/migrations/0006_import_wbs_rpc.sql` 이 컬럼 화이트리스트면 0059 에 import_wbs 함수 교체를 추가**(이 경우 Task 8 로 되돌아가 마이그레이션에 반영 후 재커밋)
- Modify: `buildTree` 호출처 전부 (`grep -rn "buildTree(" src/ tests/`) — 정렬 순서 주입
- Test: `tests/domain/tree.test.ts:36-44` 재작성 + N단 케이스

**Interfaces:**
- Produces:

```ts
// tree.ts — 정렬 순서는 주입이 계약(스펙 §5.3). 인자 필수라 tsc 가 전 호출처를 드러낸다.
export interface BuildTreeOpts {
  /** 팀코드→표시순위. teamOrderMap(activeCodes(teams)) 를 넘길 것. 미등재 팀은 뒤로. */
  subActTeamOrder: ReadonlyMap<string, number>
}
export function buildTree(rows: WbsRow[], opts: BuildTreeOpts): TreeNode[]
```

정렬 규칙: **자식 중 `isOwnerSplit` 이 하나라도 있으면** 그 형제 집합을 팀 순위→sortOrder 로, 아니면 sortOrder 로 (기존 `parent?.level === 'activity'` 분기 대체 — 백필된 D-CUBE 데이터에서 두 조건은 동치이므로 회귀 0).

`addSubAct` 새 가드(레벨 무관): ① 대상은 **리프**여야 한다(자식이 있으면 거부 — 단, 자식 전원이 `is_owner_split` 인 경우는 허용: 기존 sub-act 형제에 추가하는 경로) ② 대상 자신이 `is_owner_split` 이면 거부("SUB-ACT 아래에는 추가할 수 없습니다" 유지) ③ insert 시 `is_owner_split: true` + `level: 'activity'`(하위호환 기록용 — 읽지 않는다).

- [ ] **Step 1: 실패하는 테스트** — tree.test 재작성:

```ts
it('owner-split 자식은 주입된 팀 순위로 정렬된다 (level 무관)', () => {
  const rows = [
    row({ id: 'p', parentId: null }),
    row({ id: 'a', parentId: 'p', sortOrder: 1, isOwnerSplit: true, owners: [{ team: 'MES', kind: 'primary' }] }),
    row({ id: 'b', parentId: 'p', sortOrder: 2, isOwnerSplit: true, owners: [{ team: 'PMO', kind: 'primary' }] }),
  ]
  const t = buildTree(rows, { subActTeamOrder: new Map([['PMO', 0], ['MES', 1]]) })
  expect(t[0].children.map(c => c.id)).toEqual(['b', 'a'])
})
it('순위 맵에 없는 팀은 뒤로, 그 안에서는 sortOrder', () => { /* 미등재 2팀 케이스 */ })
it('owner-split 아닌 형제는 sortOrder 만 따른다 — 깊이 5단이어도', () => { /* depth 5 fixture */ })
```

(기존 `row` fixture 헬퍼에 `isOwnerSplit: false` 기본값을 추가한다.)

- [ ] **Step 2: 실패 확인** — tsc(시그니처)·vitest FAIL
- [ ] **Step 3: 구현** — 위 계약대로. 호출처 주입: 서버 경로는 로딩된 teams 로 `teamOrderMap(activeCodes(teams))`, 클라이언트는 `useTeamCodes()`(TeamsProvider) 결과로. **주입값 검증**: D-CUBE 팀 마스터의 sort_order 가 PMO<ERP<MES<가공<MDM 임을 배포 절차(Task 11)에서 SQL 로 확인 — 이 순서가 기존 상수와 동치라 회귀 0 이 성립한다.
- [ ] **Step 4: 통과 확인** — `npx tsc --noEmit && npx vitest run` 전량(§4.5 의 7개 파일 중 tree/split 계열이 이 태스크의 회귀 감시선이다).
- [ ] **Step 5: 커밋** (메시지: "feat(wbs): sub-act 를 레벨에서 플래그로 — 이름·레벨 의존 판별 폐기, 정렬 주입" + 트레일러)

---

### Task 10: 단계 3c — §4.5 잔여 테스트의 N단 fixture 보강

**Files:**
- Modify: `tests/excel/parse.test.ts` · `tests/excel/export.test.ts` · `tests/excel/edgecases.test.ts` · `tests/excel/split.test.ts` · `tests/report/weekly.test.ts:104` · `tests/ui/wbs-initial-collapsed.test.tsx:28-29` (tree.test 는 Task 9 에서 완료)
- Test: 자체

**Interfaces:** 없음 (검증 강화 전용)

- [ ] **Step 1: 각 파일에 4단+ fixture 1케이스씩 추가** — 기존 3단 케이스는 유지(회귀 감시), 신규 케이스는 "4단 깊이에서도 롤업/평탄화/접힘 초기값이 리프 기준으로 동작"을 assert. 엑셀 파서·익스포터는 아직 3열 양식이므로(Plan B 전) **도메인 통과분만**: 4단 rows 를 buildTree→rollup 에 태워 리프 판정이 깊이 무관임을 고정하는 케이스를 `tests/domain/` 쪽에 두는 것이 자연스러우면 그렇게 배치하고 파일 선택을 리포트에 기록.
- [ ] **Step 2: 전량 통과** — `npx vitest run`
- [ ] **Step 3: 커밋** ("test(wbs): N단 fixture — 3단 가정이 되살아나면 여기서 무너진다" + 트레일러)

---

### Task 11: 배포·적용·회귀 0 검증 (사람 개입 구간)

**Files:** 없음 (운영 절차)

- [ ] **Step 1: 통합 검증** — `npm run test && npm run lint && npm run build` 전량 초록.
- [ ] **Step 2: 배포 전 스냅샷 채취(회귀 비교 기준)** — 프로덕션에서 ① D-CUBE WBS 엑셀 익스포트 파일 다운로드 보관 ② 대시보드 KPI 값 기록(Management API 읽기 전용 쿼리 또는 화면 캡처) ③ `select count(*), sum(actual_pct) from wbs_items where project_id='7a1c6034-...'` 기록.
- [ ] **Step 3: 0058 적용** — Management API(키체인 레시피). 검증: `select preset_applied, level_labels from project_settings` → 전 프로젝트 `legacy-dcube` 행. **0058 은 코드 배포보다 먼저** (로더는 행 없음도 처리하지만, 시드가 먼저 있어야 주입 전환 순간부터 현행값이 보장된다).
- [ ] **Step 4: 코드 배포** — main 머지·push(브랜치 경유), Ready 확인, `npm run smoke:prod`.
- [ ] **Step 5: 0059 적용** — 적용 전 `select count(*) from wbs_items c join wbs_items p on c.parent_id=p.id where c.level='activity' and p.level='activity'` (백필 예상 건수), 적용 후 `select count(*) from wbs_items where is_owner_split` 대조(§5.2 건수 검증). D-CUBE 팀 순서 확인: `select code, sort_order from teams where active order by sort_order` → PMO,ERP,MES,가공,MDM.
- [ ] **Step 6: 회귀 0 판정** — Step 2 스냅샷과 재비교(익스포트 셀 비교는 파일 diff, KPI 는 값 대조). 다르면 **즉시 중단·원인 규명**(롤백 좌표: 0059_rollback → 0058_rollback → git revert).
- [ ] **Step 7: `npm run mark:good`** (화면 확인 후) + 메모리 기록.

---

## Self-Review 결과 (계획 작성 시점)

- **스펙 커버리지**: §10.11→T1 · §4.3/§4.4 룩업 4곳→T2 · §7.2/§7.5→T3 · §7.3/§8→T4 · §7.4→T5 · §10.4/§10.15/§10.9→T6 · §10.12/§10.19→T7 · §4.2/§5.2→T8 · §5.3/§4.4(tree·addSubAct·validate)→T9 · §4.5→T10 · §11.1→T11. **의도적 이월**: §4.4 의 UI 계열(RowDetailPanel 판정 대체·shared 배지 depth 화·WbsGanttSheet 3건)은 Plan C — T2 가 안전 폴백까지만 하고 표시 동작을 보존한다. §6 전체는 Plan B. §10.1/10.2/10.13(P4/P5)·§10.14(P7) 범위 밖 명시.
- **플레이스홀더 점검**: "실물을 열어 확인" 지시가 3곳(T1 mark-good 변수명, T3 weekly_sections 시드값, T7 seoulToday 다수형) 있으나 각각 정본 위치와 판단 규칙을 명시했으므로 지연 결정이 아니라 검증 지시다.
- **타입 일관성**: `ProjectConfig`(T4)를 T5 가 소비, `BuildTreeOpts`(T9) 시그니처 필수화 전략은 T2·T5·T6 과 동일(컴파일 에러로 전 호출처 노출). `isOwnerSplit` 은 T8(DB)→T9(타입·매핑) 순서로만 참조.
- **위험 메모**: T9 의 import_wbs RPC 화이트리스트 여부가 유일한 분기 — 계획에 선행 확인·회귀 절차를 박았다. T8 은 이 계획에서 유일한 기존 테이블 ALTER — 제약 해제·컬럼 추가뿐임을 태스크 계약으로 명시.
```
