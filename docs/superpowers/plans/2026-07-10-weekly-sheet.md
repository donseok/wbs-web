# 주간업무 시트 + PPT 자동 생성 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀원들이 주간업무를 자유 텍스트로 작성하는 구글시트식 그리드(주차별 문서, 실시간 협업)와, 그 내용으로 부산운영팀 템플릿 PPT를 자동 생성하는 기능을 추가한다.

**Architecture:** Supabase 테이블 2개(주차 문서 + 모듈 행, 행에 텍스트 셀 4개 내장)에 셀 단위 UPDATE로 저장하고 Realtime으로 동기화한다. PPT는 기존 `lib/report/` 템플릿-필 파이프라인을 재사용하되 헤더 라벨과 라인 포매터만 파라미터로 주입한다(기존 WBS 자동 보고서는 동작 불변).

**Tech Stack:** Next.js App Router(서버 액션 + `/api/report` route), Supabase(Postgres RLS + Realtime), vitest, JSZip 기반 기존 PPTX 템플릿-필.

**Spec:** `docs/superpowers/specs/2026-07-10-weekly-report-sheet-design.md` (승인본 — 이 계획과 충돌 시 스펙이 우선)

## Global Constraints

- 커밋은 **관련 파일만 개별 stage** — `git add -A` 절대 금지(병렬 세션·민감 파일 보호).
- 새 UI는 기존 디자인 토큰·프리미티브만 사용: `card`, `btn btn-primary/btn-ghost`, `app-input`, `app-textarea`, `chip`, `text-ink/ink-muted/ink-subtle`, `border-line`, `bg-surface/surface-2`, `EmptyState`, `useToast`, `Spinner`, lucide-react 아이콘.
- 날짜·주차 계산은 전부 **UTC 기반**(`weekly.ts` 유틸 재사용) — 로컬 타임존 `new Date()` 산술 금지.
- RLS 헬퍼는 프로덕션 기준 `app_role()` — `current_role()`은 레포 드리프트라 금지 (이번 기능은 헬퍼 자체를 안 씀).
- 마이그레이션은 멱등(`if not exists`, `drop policy if exists`)으로 작성, 적용은 Supabase Management API(프로젝트 ref `rglfgrwwwwdqejohdnty`).
- 서버 액션 반환 관례: `{ ok: boolean; error?: string }`. 성공 시 `revalidatePath`.
- 테스트는 vitest(`npx vitest run <파일>`), import는 `@/` alias 사용.
- 커밋 메시지는 한국어, 무엇보다 왜. 트레일러: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

| 파일 | 역할 |
|---|---|
| Create `supabase/migrations/0023_weekly_sheet.sql` | 테이블 2개 + RLS + Realtime publication |
| Modify `src/lib/report/weekly.ts` | 비공개 날짜 유틸 4+1개 export만 추가 |
| Create `src/lib/report/week.ts` | 주차 정규화·이동·시트 주차 라벨/범위(순수) |
| Create `src/lib/domain/weeklySheet.ts` | 행 타입, 셀 키 화이트리스트, carryOverRows, 서버병합(순수) |
| Create `src/lib/report/sheetNarrative.ts` | 셀 텍스트→NarrativeModel 변환 + sheetLineText(순수) |
| Modify `src/lib/report/xml.ts` | `buildCellTxBody`에 lineFormatter 파라미터 |
| Modify `src/lib/report/templateFill.ts` | `paginateGroups`/`fillWeeklyTemplate`에 포매터·헤더 라벨 파라미터 |
| Create `src/lib/data/weeklySheet.ts` | 서버 조회(문서+행, 이월 원본) |
| Create `src/app/actions/weekly.ts` | 문서 생성(이월)·셀 저장·행 CRUD 서버 액션 |
| Modify `src/app/api/report/route.ts` | `source=sheet` 분기 |
| Create `src/app/(app)/p/[projectId]/weekly/page.tsx` | 서버 페이지 |
| Create `src/components/weekly/WeeklySheetView.tsx` | 클라이언트 그리드(편집·저장·Realtime) |
| Modify `src/components/app/Sidebar.tsx` | 메뉴 항목 |
| Modify `src/lib/i18n/dict/common.ts` | `nav.weekly` ko/en |
| Test `tests/report/week.test.ts`, `tests/domain/weeklySheet.test.ts`, `tests/report/sheetNarrative.test.ts` | 신규 순수 함수 |
| Test `tests/report/xml.test.ts`, `tests/report/templateFill.test.ts` | 파라미터 추가 케이스 |

---

### Task 1: 마이그레이션 0023 — 테이블 + RLS + Realtime

**Files:**
- Create: `supabase/migrations/0023_weekly_sheet.sql`

**Interfaces:**
- Produces: 테이블 `weekly_reports(id, project_id, week_start, created_at, updated_at)`, `weekly_report_rows(id, report_id, section, module, sort_order, this_content, this_issue, next_content, next_issue, updated_at)` — 이후 모든 태스크의 저장소.

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 주간업무 시트 — 구글시트식 자유 작성 그리드(주차 문서 + 모듈 행) + PPT 소스.
-- 권한: 읽기/쓰기 모두 인증 사용자 전원(협업 시트 — 설계 승인 2026-07-10). created_by/app_role() 게이트 없음.
-- 멱등: SQL Editor 반복 실행 안전(if not exists / drop policy if exists / duplicate_object 무시).
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (0021과 동일 경로).
-- 적용 순서: 이 마이그레이션을 **먼저** 적용한 뒤 코드를 배포한다.

-- ── 주차 문서 ──
create table if not exists weekly_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  week_start date not null,           -- 그 주 월요일 (서버에서 정규화)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, week_start)
);

-- ── 모듈 행 (텍스트 셀 4개 내장 — 셀 저장 = 열 하나 UPDATE) ──
create table if not exists weekly_report_rows (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references weekly_reports(id) on delete cascade,
  section text not null default '',   -- 구분: 공통/ERP/MES …
  module text not null default '',    -- 모듈: SD/LE, MD/PP …
  sort_order int not null default 1,
  this_content text not null default '',
  this_issue   text not null default '',
  next_content text not null default '',
  next_issue   text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists weekly_report_rows_report_idx on weekly_report_rows (report_id, sort_order);

-- ── RLS: 협업 시트 — 인증 사용자 전원 편집 ──
alter table weekly_reports     enable row level security;
alter table weekly_report_rows enable row level security;

drop policy if exists weekly_reports_select on weekly_reports;
create policy weekly_reports_select on weekly_reports for select to authenticated using (true);
drop policy if exists weekly_reports_insert on weekly_reports;
create policy weekly_reports_insert on weekly_reports for insert to authenticated with check (true);
drop policy if exists weekly_reports_update on weekly_reports;
create policy weekly_reports_update on weekly_reports for update to authenticated using (true) with check (true);
drop policy if exists weekly_reports_delete on weekly_reports;
create policy weekly_reports_delete on weekly_reports for delete to authenticated using (true);

drop policy if exists weekly_report_rows_select on weekly_report_rows;
create policy weekly_report_rows_select on weekly_report_rows for select to authenticated using (true);
drop policy if exists weekly_report_rows_insert on weekly_report_rows;
create policy weekly_report_rows_insert on weekly_report_rows for insert to authenticated with check (true);
drop policy if exists weekly_report_rows_update on weekly_report_rows;
create policy weekly_report_rows_update on weekly_report_rows for update to authenticated using (true) with check (true);
drop policy if exists weekly_report_rows_delete on weekly_report_rows;
create policy weekly_report_rows_delete on weekly_report_rows for delete to authenticated using (true);

-- ── Realtime: 행 변경 브로드캐스트 (중복 추가는 duplicate_object — 멱등 처리) ──
do $$
begin
  alter publication supabase_realtime add table weekly_report_rows;
exception when duplicate_object then null;
end $$;
```

- [ ] **Step 2: 프로덕션 적용 (Management API)**

토큰: Supabase CLI 키체인에서 추출 — `security find-generic-password -s "Supabase CLI" -w` 결과에서 `go-keyring-base64:` 접두사를 제거하고 base64 디코드하면 `sbp_` 토큰. `User-Agent` 헤더 필수.

```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d)
curl -sS -X POST "https://api.supabase.com/v1/projects/rglfgrwwwwdqejohdnty/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "User-Agent: wbs-web-migration" \
  --data-binary @<(python3 -c "import json;print(json.dumps({'query': open('supabase/migrations/0023_weekly_sheet.sql').read()}))")
```

Expected: `[]` 또는 빈 성공 응답(에러 JSON이 아니어야 함). 토큰 추출 실패 시 여기서 멈추고 사용자에게 보고.

- [ ] **Step 3: 적용 검증**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/rglfgrwwwwdqejohdnty/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "User-Agent: wbs-web-migration" \
  --data-binary '{"query":"select tablename, policyname from pg_policies where tablename in ('"'"'weekly_reports'"'"','"'"'weekly_report_rows'"'"') order by 1,2"}'
```

Expected: 두 테이블 각 4개 정책(select/insert/update/delete) = 총 8행.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0023_weekly_sheet.sql
git commit -m "feat(weekly): 주간업무 시트 스키마 — 주차 문서+모듈 행, 전원 편집 RLS, Realtime"
```

---

### Task 2: 주차 유틸 — weekly.ts export + week.ts

**Files:**
- Modify: `src/lib/report/weekly.ts:192-228` (function 앞에 `export` 키워드만 추가)
- Create: `src/lib/report/week.ts`
- Test: `tests/report/week.test.ts`

**Interfaces:**
- Consumes: `weekly.ts`의 `parseUTC(d: string): Date`, `fmtUTC(d: Date): string`, `addDays(d: Date, n: number): Date`, `mondayOf(d: Date): Date`, `md(d: Date): string` (현재 비공개 — export 추가).
- Produces: `mondayIso(dateIso: string): string`, `shiftWeeks(weekStartIso: string, n: number): string`, `sheetWeekMeta(weekStartIso: string): { weekTag: string; label: string; thisRange: string; nextRange: string }` — Task 7·8·9가 사용.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/report/week.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { mondayIso, shiftWeeks, sheetWeekMeta } from '@/lib/report/week'

describe('mondayIso', () => {
  it('임의 요일을 그 주 월요일로 정규화(UTC)', () => {
    expect(mondayIso('2026-07-10')).toBe('2026-07-06') // 금 → 월
    expect(mondayIso('2026-07-06')).toBe('2026-07-06') // 월 그대로
    expect(mondayIso('2026-07-12')).toBe('2026-07-06') // 일 → 그 주 월
  })
})

describe('shiftWeeks', () => {
  it('주 단위 이동', () => {
    expect(shiftWeeks('2026-07-06', 1)).toBe('2026-07-13')
    expect(shiftWeeks('2026-07-06', -1)).toBe('2026-06-29')
  })
})

describe('sheetWeekMeta', () => {
  it('그 달의 몇 번째 월요일로 N주차 산정 + 월~금 범위', () => {
    // 2026-07-06 = 7월의 첫 월요일
    expect(sheetWeekMeta('2026-07-06')).toEqual({
      weekTag: '7월1주차', label: '7월 1주차', thisRange: '7/6~7/10', nextRange: '7/13~7/17',
    })
  })
  it('월 경계 주는 월요일 소속 달 기준', () => {
    // 2026-06-29(월)~7/3 → 6월의 다섯 번째 월요일 = 6월 5주차
    const m = sheetWeekMeta('2026-06-29')
    expect(m.weekTag).toBe('6월5주차')
    expect(m.thisRange).toBe('6/29~7/3')
  })
  it('월요일이 아닌 입력도 정규화 후 산정', () => {
    expect(sheetWeekMeta('2026-07-08').weekTag).toBe('7월1주차')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/report/week.test.ts`
Expected: FAIL — `Cannot find module '@/lib/report/week'`

- [ ] **Step 3: 구현**

`src/lib/report/weekly.ts` — 다음 5개 함수 선언에 `export`만 붙인다(191~228행 부근, 본문 변경 없음): `parseUTC`, `fmtUTC`, `addDays`, `mondayOf`, `md`.

`src/lib/report/week.ts` 신규:

```ts
import { parseUTC, fmtUTC, addDays, mondayOf, md } from './weekly'

/* ── 주간업무 시트 전용 주차 유틸(순수·UTC). WBS 보고서의 weekly.ts 유틸을 재사용한다. ── */

/** 임의 'YYYY-MM-DD' → 그 주 월요일 'YYYY-MM-DD'. */
export function mondayIso(dateIso: string): string {
  return fmtUTC(mondayOf(parseUTC(dateIso)))
}

/** 주 시작일을 n주 이동. */
export function shiftWeeks(weekStartIso: string, n: number): string {
  return fmtUTC(addDays(parseUTC(weekStartIso), n * 7))
}

export interface SheetWeekMeta {
  weekTag: string    // '7월1주차' (파일명용)
  label: string      // '7월 1주차' (화면 표시용)
  thisRange: string  // '7/6~7/10' (월~금)
  nextRange: string  // '7/13~7/17'
}

/** 주차 라벨: 그 주 월요일이 속한 달에서 몇 번째 월요일인지로 N주차(스펙 §3). 범위는 월~금. */
export function sheetWeekMeta(weekStartIso: string): SheetWeekMeta {
  const mon = parseUTC(mondayIso(weekStartIso))
  const month = mon.getUTCMonth() + 1
  const nth = Math.floor((mon.getUTCDate() - 1) / 7) + 1
  const fri = addDays(mon, 4)
  const nextMon = addDays(mon, 7)
  const nextFri = addDays(mon, 11)
  return {
    weekTag: `${month}월${nth}주차`,
    label: `${month}월 ${nth}주차`,
    thisRange: `${md(mon)}~${md(fri)}`,
    nextRange: `${md(nextMon)}~${md(nextFri)}`,
  }
}
```

- [ ] **Step 4: 통과 확인 + 기존 회귀**

Run: `npx vitest run tests/report/`
Expected: 전부 PASS (weekly.ts는 export 추가만 — 동작 불변)

- [ ] **Step 5: Commit**

```bash
git add src/lib/report/weekly.ts src/lib/report/week.ts tests/report/week.test.ts
git commit -m "feat(weekly): 주차 유틸 — 월요일 정규화·주 이동·시트 주차 라벨(그 달 N번째 월요일)"
```

---

### Task 3: 도메인 순수 계층 — 행 타입·이월·서버 병합

**Files:**
- Create: `src/lib/domain/weeklySheet.ts`
- Test: `tests/domain/weeklySheet.test.ts`

**Interfaces:**
- Produces (Task 4·7·9가 사용):
  - `interface WeeklySheetRow { id: string; reportId: string; section: string; module: string; sortOrder: number; thisContent: string; thisIssue: string; nextContent: string; nextIssue: string }`
  - `WEEKLY_CELL_KEYS: readonly ['this_content','this_issue','next_content','next_issue']` / `type WeeklyCellKey` / `isWeeklyCellKey(v: string): v is WeeklyCellKey`
  - `CELL_FIELD: Record<WeeklyCellKey, 'thisContent'|'thisIssue'|'nextContent'|'nextIssue'>` (snake→camel 매핑)
  - `carryOverRows(prev: WeeklySheetRow[]): NewWeeklyRow[]` — `NewWeeklyRow = Omit<WeeklySheetRow,'id'|'reportId'>`
  - `applyServerRow(local: WeeklySheetRow, server: WeeklySheetRow, dirty: ReadonlySet<string>): WeeklySheetRow` — dirty 키 형식 `${rowId}:${WeeklyCellKey}`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/domain/weeklySheet.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import {
  carryOverRows, applyServerRow, isWeeklyCellKey, type WeeklySheetRow,
} from '@/lib/domain/weeklySheet'

const row = (over: Partial<WeeklySheetRow>): WeeklySheetRow => ({
  id: 'r1', reportId: 'rep1', section: 'ERP', module: 'SD/LE', sortOrder: 1,
  thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over,
})

describe('carryOverRows', () => {
  it('차주계획→금주실적 이월, next는 비움, 행 구성·순서 보존', () => {
    const prev = [
      row({ id: 'a', sortOrder: 2, module: 'MM', nextContent: '계획B', nextIssue: '이슈B' }),
      row({ id: 'b', sortOrder: 1, thisContent: '지난실적', nextContent: '계획A' }),
    ]
    const out = carryOverRows(prev)
    expect(out.map(r => r.module)).toEqual(['SD/LE', 'MM']) // sortOrder 정렬
    expect(out[0]).toMatchObject({ sortOrder: 1, thisContent: '계획A', thisIssue: '', nextContent: '', nextIssue: '' })
    expect(out[1]).toMatchObject({ sortOrder: 2, thisContent: '계획B', thisIssue: '이슈B', nextContent: '', nextIssue: '' })
    expect('id' in out[0]).toBe(false)
  })
  it('빈 입력 → 빈 배열', () => expect(carryOverRows([])).toEqual([]))
})

describe('applyServerRow', () => {
  const local = row({ thisContent: '입력중(dirty)', nextContent: '로컬낡음' })
  const server = row({ thisContent: '서버값1', nextContent: '서버값2', module: '변경모듈' })
  it('dirty 셀은 로컬 유지, 나머지는 서버 채택(구조 필드 포함)', () => {
    const merged = applyServerRow(local, server, new Set(['r1:this_content']))
    expect(merged.thisContent).toBe('입력중(dirty)')
    expect(merged.nextContent).toBe('서버값2')
    expect(merged.module).toBe('변경모듈')
  })
  it('dirty 없으면 서버 그대로', () => {
    expect(applyServerRow(local, server, new Set())).toEqual(server)
  })
})

describe('isWeeklyCellKey', () => {
  it('화이트리스트만 통과', () => {
    expect(isWeeklyCellKey('this_content')).toBe(true)
    expect(isWeeklyCellKey('next_issue')).toBe(true)
    expect(isWeeklyCellKey('section')).toBe(false)     // 구조 필드는 셀 저장 경로로 못 바꿈
    expect(isWeeklyCellKey('id; drop table')).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/weeklySheet.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현** — `src/lib/domain/weeklySheet.ts`

```ts
/* ── 주간업무 시트 도메인(순수) — 행 타입·셀 키·이월·서버 병합. I/O 없음. ── */

export interface WeeklySheetRow {
  id: string
  reportId: string
  section: string
  module: string
  sortOrder: number
  thisContent: string
  thisIssue: string
  nextContent: string
  nextIssue: string
}

export type NewWeeklyRow = Omit<WeeklySheetRow, 'id' | 'reportId'>

/** 셀 저장 가능한 DB 열 화이트리스트 — 구조 필드(section/module/sort_order)는 별도 액션으로만. */
export const WEEKLY_CELL_KEYS = ['this_content', 'this_issue', 'next_content', 'next_issue'] as const
export type WeeklyCellKey = (typeof WEEKLY_CELL_KEYS)[number]
export function isWeeklyCellKey(v: string): v is WeeklyCellKey {
  return (WEEKLY_CELL_KEYS as readonly string[]).includes(v)
}

export const CELL_FIELD = {
  this_content: 'thisContent', this_issue: 'thisIssue',
  next_content: 'nextContent', next_issue: 'nextIssue',
} as const satisfies Record<WeeklyCellKey, keyof WeeklySheetRow>

/** 새 주차 이월(스펙 §4): 행 구성 복사 + 전주 차주계획→금주실적, next는 비움. sortOrder 재부여. */
export function carryOverRows(prev: WeeklySheetRow[]): NewWeeklyRow[] {
  return [...prev]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r, i) => ({
      section: r.section, module: r.module, sortOrder: i + 1,
      thisContent: r.nextContent, thisIssue: r.nextIssue,
      nextContent: '', nextIssue: '',
    }))
}

/** Realtime/refresh 병합(스펙 §5): dirty(`${rowId}:${cellKey}`) 셀만 로컬 유지, 나머지는 서버 채택. */
export function applyServerRow(
  local: WeeklySheetRow, server: WeeklySheetRow, dirty: ReadonlySet<string>,
): WeeklySheetRow {
  const merged = { ...server }
  for (const key of WEEKLY_CELL_KEYS) {
    if (dirty.has(`${server.id}:${key}`)) merged[CELL_FIELD[key]] = local[CELL_FIELD[key]]
  }
  return merged
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/weeklySheet.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/weeklySheet.ts tests/domain/weeklySheet.test.ts
git commit -m "feat(weekly): 시트 도메인 순수 계층 — 셀 키 화이트리스트·이월·dirty 병합"
```

---

### Task 4: 시트 → PPT 내러티브 변환 (sheetNarrative)

**Files:**
- Create: `src/lib/report/sheetNarrative.ts`
- Test: `tests/report/sheetNarrative.test.ts`

**Interfaces:**
- Consumes: `WeeklySheetRow` (Task 3), `NarrativeModel`/`NarrativeGroup` (`src/lib/report/narrative.ts`의 기존 export).
- Produces (Task 6·8이 사용):
  - `sheetLineText(line: string): string` — 마커 추가 없이 들여쓰기만(일반·숫자 4칸 / `-` 8칸 / `.` 12칸)
  - `cellLines(text: string): string[]` — 줄 분해, 연속 빈 줄 1개로 축약, 앞뒤 빈 줄 제거
  - `buildSheetNarrative(rows: WeeklySheetRow[]): NarrativeModel` — prev=금주실적, curr=차주계획, issues=금주 이슈, events=차주 이슈(빈 목록이면 `['특이 이슈 없음']`)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/report/sheetNarrative.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { sheetLineText, cellLines, buildSheetNarrative } from '@/lib/report/sheetNarrative'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'

const row = (over: Partial<WeeklySheetRow>): WeeklySheetRow => ({
  id: 'r1', reportId: 'rep1', section: 'ERP', module: 'SD/LE', sortOrder: 1,
  thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over,
})

describe('sheetLineText', () => {
  it('일반·숫자 줄은 4칸, 마커 추가 없음', () => {
    expect(sheetLineText('1. 현업 인터뷰 참석')).toBe('    1. 현업 인터뷰 참석')
    expect(sheetLineText('프로세스 분석')).toBe('    프로세스 분석')
  })
  it("'-' 줄은 8칸, '.' 줄은 12칸", () => {
    expect(sheetLineText('- 대상 : 영업팀')).toBe('        - 대상 : 영업팀')
    expect(sheetLineText('. 세부 검토')).toBe('            . 세부 검토')
  })
  it('이미 들여쓴 입력도 시작 문자로 판정', () => {
    expect(sheetLineText('  - 대상')).toBe('        - 대상')
  })
})

describe('cellLines', () => {
  it('줄 분해 + 연속 빈 줄 축약 + 앞뒤 빈 줄 제거', () => {
    expect(cellLines('1. A\n- a\n\n\n2. B\n')).toEqual(['1. A', '- a', '', '2. B'])
    expect(cellLines('\n\n1. A')).toEqual(['1. A'])
    expect(cellLines('')).toEqual([])
    expect(cellLines('   \n  ')).toEqual([])
  })
})

describe('buildSheetNarrative', () => {
  const rows = [
    row({ id: 'a', sortOrder: 2, section: 'MES', module: '가공', thisContent: '1. 인터뷰', nextContent: '' }),
    row({ id: 'b', sortOrder: 1, thisContent: '1. CheckList\n- CBO', thisIssue: '지연 위험', nextContent: '1. 계획', nextIssue: '일정 협의 필요\n추가 인력' }),
    row({ id: 'c', sortOrder: 3, section: '공통', module: '공통' }), // 4셀 모두 빈 행
  ]
  const n = buildSheetNarrative(rows)

  it('prev=금주실적, curr=차주계획 — 헤드라인 [구분] 모듈, sortOrder 순', () => {
    expect(n.prev.map(g => g.phase)).toEqual(['[ERP] SD/LE', '[MES] 가공'])
    expect(n.prev[0].items).toEqual(['1. CheckList', '- CBO'])
    expect(n.curr.map(g => g.phase)).toEqual(['[ERP] SD/LE']) // 가공은 차주 빈 셀 → 생략
  })
  it('빈 행은 어디에도 안 나감', () => {
    expect([...n.prev, ...n.curr].some(g => g.phase.includes('공통'))).toBe(false)
  })
  it('이슈: [모듈] 접두, 멀티라인은 줄마다 개별 항목', () => {
    expect(n.issues).toEqual(['[SD/LE] 지연 위험'])
    expect(n.events).toEqual(['[SD/LE] 일정 협의 필요', '[SD/LE] 추가 인력'])
  })
  it('이슈 없으면 [특이 이슈 없음] 직접 채움(우측 슬롯 기존 폴백 차단)', () => {
    const empty = buildSheetNarrative([row({ thisContent: '1. 작업' })])
    expect(empty.issues).toEqual(['특이 이슈 없음'])
    expect(empty.events).toEqual(['특이 이슈 없음'])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/report/sheetNarrative.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현** — `src/lib/report/sheetNarrative.ts`

```ts
import type { NarrativeGroup, NarrativeModel } from './narrative'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'

/* ============================================================================
 * 주간업무 시트 → PPT 내러티브 변환(순수). 스펙 §6.
 * prev 슬롯 = 금주실적(왼쪽 열), curr 슬롯 = 차주계획(오른쪽 열).
 * ========================================================================== */

/** 시트 셀 줄 → PPT 들여쓰기. 작성자가 쓴 마커를 그대로 두고 깊이만 부여(subLineText와 별개). */
export function sheetLineText(line: string): string {
  const t = line.trimStart()
  if (t.startsWith('.')) return `            ${t}` // 12칸 — 3단계
  if (t.startsWith('-')) return `        ${t}`     // 8칸 — 2단계
  return `    ${t}`                                 // 4칸 — 1단계(숫자·일반)
}

/** 셀 텍스트 → 줄 배열. 문단 구분(빈 줄)은 존중하되 연속 빈 줄은 1개로, 앞뒤 빈 줄은 제거. */
export function cellLines(text: string): string[] {
  const lines = text.split('\n').map(l => l.replace(/\s+$/, ''))
  const out: string[] = []
  for (const l of lines) {
    if (l.trim() === '' && (out.length === 0 || out[out.length - 1] === '')) continue
    out.push(l.trim() === '' ? '' : l)
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}

const headline = (r: WeeklySheetRow): string => `[${r.section}] ${r.module}`

function groupsOf(rows: WeeklySheetRow[], field: 'thisContent' | 'nextContent'): NarrativeGroup[] {
  return rows
    .filter(r => r[field].trim() !== '')
    .map((r, i) => ({ phase: headline(r), num: i + 1, items: cellLines(r[field]) }))
}

function issuesOf(rows: WeeklySheetRow[], field: 'thisIssue' | 'nextIssue'): string[] {
  const out = rows.flatMap(r =>
    cellLines(r[field]).filter(l => l.trim() !== '').map(l => `[${r.module}] ${l.trim()}`),
  )
  // 빈 목록을 직접 채워 fillWeeklyTemplate 우측 슬롯의 '예정된 주요 이벤트 없음' 폴백이 노출되지 않게 한다.
  return out.length ? out : ['특이 이슈 없음']
}

/** 시트 행들 → NarrativeModel. 셀이 빈 모듈은 그 열에서 생략, 4셀 모두 빈 행은 어디에도 안 나감. */
export function buildSheetNarrative(rows: WeeklySheetRow[]): NarrativeModel {
  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder)
  return {
    prev: groupsOf(sorted, 'thisContent'),
    curr: groupsOf(sorted, 'nextContent'),
    issues: issuesOf(sorted, 'thisIssue'),
    events: issuesOf(sorted, 'nextIssue'),
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/report/sheetNarrative.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/report/sheetNarrative.ts tests/report/sheetNarrative.test.ts
git commit -m "feat(weekly): 시트→PPT 내러티브 변환 — 들여쓰기 3단계·이슈 모듈 접두·빈 셀 생략"
```

---

### Task 5: xml.ts — buildCellTxBody 라인 포매터 주입

**Files:**
- Modify: `src/lib/report/xml.ts:69-83` (`buildCellTxBody`)
- Test: `tests/report/xml.test.ts` (케이스 추가)

**Interfaces:**
- Produces: `buildCellTxBody(groups, sk, emptyText?, lineFormatter?: (item: string) => string)` — 4번째 파라미터 기본값 `subLineText`(기존 동작 불변). Task 6이 관통시킴.

- [ ] **Step 1: 실패하는 테스트 추가** — `tests/report/xml.test.ts`의 `describe('buildCellTxBody', ...)` 안에 추가

```ts
  it('lineFormatter 주입 시 subLineText 대신 적용(시트 PPT 경로)', () => {
    const fmt = (s: string) => `>>${s}`
    const xml = buildCellTxBody([{ phase: 'P', num: 1, items: ['1. 항목'] }], SK, undefined, fmt)
    expect(xml).toContain('<a:t>&gt;&gt;1. 항목</a:t>')
    expect(xml).not.toContain('<a:t>    - 1. 항목</a:t>')
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/report/xml.test.ts`
Expected: FAIL — 인자 4개 시그니처 없음(또는 `    - 1. 항목` 출력)

- [ ] **Step 3: 구현** — `xml.ts`의 `buildCellTxBody`를 다음으로 교체

```ts
/** Phase 그룹들 → 콘텐츠 셀 <a:txBody>. title=불릿+볼드 헤드라인, sub=들여쓴 상세 줄.
 *  상세 줄 표기는 lineFormatter로 주입(기본 subLineText — WBS 주간보고 '    - ' 규칙).
 *  상세 항목이 있는 그룹(주제 블록)이 끝나면 빈 문단 1줄로 다음 그룹과 구분(시인성).
 *  항목 없는 한 줄짜리 그룹(이슈/이벤트 불릿) 사이에는 빈 줄을 넣지 않는다. */
export function buildCellTxBody(
  groups: NarrativeGroup[], sk: CellSkeletons, emptyText = '(해당 없음)',
  lineFormatter: (item: string) => string = subLineText,
): string {
  const body: string[] = []
  if (!groups.length) {
    body.push(para(sk.sub.pPr, sk.sub.rPr, emptyText))
  } else {
    groups.forEach((g, gi) => {
      if (gi > 0 && groups[gi - 1].items.length > 0) {
        body.push(`<a:p>${sk.sub.pPr}${asEndParaRPr(sk.sub.rPr)}</a:p>`)
      }
      body.push(para(sk.title.pPr, sk.title.rPr, g.phase))
      for (const it of g.items) body.push(para(sk.sub.pPr, sk.sub.rPr, lineFormatter(it)))
    })
  }
  return `<a:txBody>${sk.bodyPr}${sk.lstStyle}${body.join('')}</a:txBody>`
}
```

- [ ] **Step 4: 통과 확인 + 회귀**

Run: `npx vitest run tests/report/`
Expected: 전부 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/report/xml.ts tests/report/xml.test.ts
git commit -m "refactor(report): buildCellTxBody 라인 포매터 주입 — 시트 PPT의 무마커 들여쓰기 지원"
```

---

### Task 6: templateFill.ts — 헤더 라벨·포매터 파라미터

**Files:**
- Modify: `src/lib/report/templateFill.ts` (`groupCost`·`paginateGroups`·`fillWeeklyTemplate`)
- Test: `tests/report/templateFill.test.ts` (케이스 추가)

**Interfaces:**
- Consumes: Task 5의 `buildCellTxBody(..., lineFormatter)`.
- Produces (Task 8이 사용):
  - `paginateGroups(groups, budget, lineFormatter?: (item: string) => string)` — 기본 `subLineText`
  - `fillWeeklyTemplate(narr, model: { meta: { prevWeekRange: string; weekRange: string } }, opts?: { labels?: { left: string; right: string }; lineFormatter?: (item: string) => string }): Promise<Buffer>` — labels 기본 `{ left: '전주 주요활동', right: '금주 주요활동' }`. `model` 타입은 구조적 부분집합이라 기존 `WeeklyReportModel` 호출부 그대로 컴파일됨.

- [ ] **Step 1: 실패하는 테스트 추가** — `tests/report/templateFill.test.ts`에 추가 (파일 상단에 이미 `fillWeeklyTemplate` import 있음; `paginateGroups`도 import 목록에 있음)

```ts
describe('fillWeeklyTemplate 옵션 (시트 경로)', () => {
  const narr = {
    prev: [{ phase: '[ERP] SD/LE', num: 1, items: ['1. 실적', '- 상세'] }],
    curr: [{ phase: '[ERP] SD/LE', num: 1, items: ['1. 계획'] }],
    issues: ['[SD/LE] 지연 위험'], events: ['특이 이슈 없음'],
  }
  const meta = { meta: { prevWeekRange: '7/6~7/10', weekRange: '7/13~7/17' } }
  const sheetFmt = (s: string) => (s.trimStart().startsWith('-') ? `        ${s.trimStart()}` : `    ${s.trimStart()}`)

  it('labels 주입 시 헤더 교체 + lineFormatter로 무마커 들여쓰기', async () => {
    const buf = await fillWeeklyTemplate(narr, meta, {
      labels: { left: '금주실적', right: '차주계획' }, lineFormatter: sheetFmt,
    })
    const zip = await JSZip.loadAsync(buf)
    const xml = await zip.file('ppt/slides/slide2.xml')!.async('string')
    expect(xml).toContain('금주실적 (7/6~7/10)')
    expect(xml).toContain('차주계획 (7/13~7/17)')
    expect(xml).toContain('<a:t>    1. 실적</a:t>')       // 마커 미추가
    expect(xml).toContain('<a:t>        - 상세</a:t>')     // '-' 8칸
    expect(xml).not.toContain('전주 주요활동')
  })
  it('옵션 없으면 기존 라벨 그대로(기본 동작 불변)', async () => {
    const buf = await fillWeeklyTemplate(narr, meta)
    const zip = await JSZip.loadAsync(buf)
    const xml = await zip.file('ppt/slides/slide2.xml')!.async('string')
    expect(xml).toContain('전주 주요활동 (7/6~7/10)')
    expect(xml).toContain('<a:t>    - 1. 실적</a:t>')      // 기존 subLineText 규칙
  })
})
```

(테스트 파일에 `import JSZip from 'jszip'`가 없으면 상단에 추가.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/report/templateFill.test.ts`
Expected: FAIL — 3번째 인자 없음/타입 에러

- [ ] **Step 3: 구현** — `templateFill.ts` 수정 3곳

(a) `groupCost`/`paginateGroups`에 포매터 파라미터 (렌더와 줄수 추정이 같은 포매터를 쓰는 것이 규칙):

```ts
/** 그룹 줄수 = 헤더 + 들여쓴 하위 항목들(줄바꿈 추정 포함) — 실제 렌더 문자열과 동일 기준. */
const groupCost = (phase: string, items: string[], fmt: (item: string) => string): number =>
  lineCost(phase) + items.reduce((s, it) => s + lineCost(fmt(it)), 0)

export function paginateGroups(
  groups: NarrativeGroup[], budget: number,
  lineFormatter: (item: string) => string = subLineText,
): NarrativeGroup[][] {
```

함수 본문에서 `groupCost(phase, items)` → `groupCost(phase, items, lineFormatter)`, 분할 루프의 `lineCost(subLineText(items[take]))` 2곳 → `lineCost(lineFormatter(items[take]))`. (`subLineText`는 이미 `./xml`에서 import 중.)

(b) `fillWeeklyTemplate` 시그니처·헤더·셀 렌더:

```ts
export interface FillTemplateOptions {
  labels?: { left: string; right: string }      // 행0 헤더 라벨(범위는 meta에서 합성)
  lineFormatter?: (item: string) => string      // 상세 줄 표기(렌더·줄수 추정 공용)
}

/** 주간 내러티브 → 템플릿 디자인 그대로의 PPTX(nodebuffer). 내용이 길면 페이지 자동 추가.
 *  model은 헤더 범위(meta)만 쓰므로 구조적 부분집합 허용 — 시트 경로는 최소 meta만 합성해 넘긴다. */
export async function fillWeeklyTemplate(
  narr: NarrativeModel,
  model: { meta: { prevWeekRange: string; weekRange: string } },
  opts: FillTemplateOptions = {},
): Promise<Buffer> {
  const labels = opts.labels ?? { left: '전주 주요활동', right: '금주 주요활동' }
  const fmt = opts.lineFormatter ?? subLineText
```

`buildPage` 안:

```ts
    x = mapTableCell(x, 0, 1, buildHeaderCellTxBody(labels.left, model.meta.prevWeekRange, hdrSk))
    x = mapTableCell(x, 0, 2, buildHeaderCellTxBody(labels.right, model.meta.weekRange, hdrSk))
    x = mapTableCell(x, 1, 1, buildCellTxBody(prevPages[i] ?? [], contentSk, i ? '-' : undefined, fmt))
    x = mapTableCell(x, 1, 2, buildCellTxBody(currPages[i] ?? [], contentSk, i ? '-' : undefined, fmt))
```

`prevPages`/`currPages` 생성부도 포매터 전달:

```ts
  const prevPages = paginateGroups(narr.prev, CELL_BUDGET, fmt)
  const currPages = paginateGroups(narr.curr, CELL_BUDGET, fmt)
```

이슈/이벤트 셀(`asBulletGroups` 경로)은 헤드라인 렌더라 포매터 영향 없음 — 변경하지 않는다. import 문에서 `WeeklyReportModel` 타입 import가 더 이상 필요 없으면 제거.

- [ ] **Step 4: 통과 확인 + 전체 회귀**

Run: `npx vitest run`
Expected: 전부 PASS (기존 `/api/report` 경로는 `WeeklyReportModel`이 부분집합 타입을 만족 → 컴파일·동작 불변)

- [ ] **Step 5: Commit**

```bash
git add src/lib/report/templateFill.ts tests/report/templateFill.test.ts
git commit -m "feat(report): fillWeeklyTemplate 헤더 라벨·라인 포매터 파라미터 — 시트 PPT 재사용 준비"
```

---

### Task 7: 서버 데이터 조회 + 서버 액션

**Files:**
- Create: `src/lib/data/weeklySheet.ts`
- Create: `src/app/actions/weekly.ts`

**Interfaces:**
- Consumes: Task 2 `mondayIso`, Task 3 `WeeklySheetRow`/`NewWeeklyRow`/`carryOverRows`/`isWeeklyCellKey`, 기존 `createServerClient`(`@/lib/supabase/server`), `getSession`(`@/lib/auth`).
- Produces (Task 8·9가 사용):
  - `getWeeklySheet(projectId: string, weekStartIso: string): Promise<{ report: WeeklyReportDoc; rows: WeeklySheetRow[] } | null>` / `interface WeeklyReportDoc { id: string; projectId: string; weekStart: string }`
  - `findCarryOverSource(projectId: string, beforeWeekStartIso: string): Promise<{ report: WeeklyReportDoc; rows: WeeklySheetRow[] } | null>`
  - 액션: `createWeeklyReport(projectId, weekStartIso, carryOver): Promise<{ ok: boolean; error?: string }>`, `saveWeeklyCell(projectId, rowId, cellKey, content)`, `addWeeklyRow(projectId, reportId, section, module)`, `deleteWeeklyRow(projectId, rowId)`, `moveWeeklyRow(projectId, rowId, dir: 'up' | 'down')` — 전부 `{ ok, error? }`

- [ ] **Step 1: 데이터 조회 구현** — `src/lib/data/weeklySheet.ts`

```ts
import { createServerClient } from '@/lib/supabase/server'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'

export interface WeeklyReportDoc { id: string; projectId: string; weekStart: string }

type RowRecord = {
  id: string; report_id: string; section: string; module: string; sort_order: number
  this_content: string; this_issue: string; next_content: string; next_issue: string
}

function mapRow(r: RowRecord): WeeklySheetRow {
  return {
    id: r.id, reportId: r.report_id, section: r.section, module: r.module, sortOrder: r.sort_order,
    thisContent: r.this_content, thisIssue: r.this_issue,
    nextContent: r.next_content, nextIssue: r.next_issue,
  }
}

const ROW_COLS = 'id, report_id, section, module, sort_order, this_content, this_issue, next_content, next_issue'

async function loadRows(reportId: string): Promise<WeeklySheetRow[]> {
  const sb = await createServerClient()
  const { data } = await sb.from('weekly_report_rows').select(ROW_COLS)
    .eq('report_id', reportId).order('sort_order')
  return ((data ?? []) as RowRecord[]).map(mapRow)
}

/** 해당 주차 문서+행. 없으면 null(자동 생성하지 않음 — 스펙 §3). */
export async function getWeeklySheet(
  projectId: string, weekStartIso: string,
): Promise<{ report: WeeklyReportDoc; rows: WeeklySheetRow[] } | null> {
  const sb = await createServerClient()
  const { data } = await sb.from('weekly_reports').select('id, project_id, week_start')
    .eq('project_id', projectId).eq('week_start', weekStartIso).maybeSingle()
  if (!data) return null
  const report = { id: data.id as string, projectId: data.project_id as string, weekStart: data.week_start as string }
  return { report, rows: await loadRows(report.id) }
}

/** 이월 원본: 해당 주 이전 가장 최근 week_start 문서(직전 주 한정 아님 — 연휴 건너뜀 대응, 스펙 §4). */
export async function findCarryOverSource(
  projectId: string, beforeWeekStartIso: string,
): Promise<{ report: WeeklyReportDoc; rows: WeeklySheetRow[] } | null> {
  const sb = await createServerClient()
  const { data } = await sb.from('weekly_reports').select('id, project_id, week_start')
    .eq('project_id', projectId).lt('week_start', beforeWeekStartIso)
    .order('week_start', { ascending: false }).limit(1).maybeSingle()
  if (!data) return null
  const report = { id: data.id as string, projectId: data.project_id as string, weekStart: data.week_start as string }
  return { report, rows: await loadRows(report.id) }
}
```

- [ ] **Step 2: 서버 액션 구현** — `src/app/actions/weekly.ts`

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { mondayIso } from '@/lib/report/week'
import { carryOverRows, isWeeklyCellKey } from '@/lib/domain/weeklySheet'
import { findCarryOverSource, getWeeklySheet } from '@/lib/data/weeklySheet'

export interface WeeklyActionResult { ok: boolean; error?: string }

const CELL_MAX = 20000        // 공지 body와 동일 상한
const NAME_MAX = 100          // 구분·모듈명 상한

function revalidateWeekly(projectId: string) {
  revalidatePath(`/p/${projectId}/weekly`)
}

/** 주차 문서 생성. carryOver=true면 이월 원본(가장 최근 이전 주차)에서 행 구성+차주계획을 초안으로. */
export async function createWeeklyReport(
  projectId: string, weekStartIso: string, carryOver: boolean,
): Promise<WeeklyActionResult> {
  if (!(await getSession())) return { ok: false, error: '로그인 필요' }
  const weekStart = mondayIso(weekStartIso)

  // 이미 있으면 멱등 성공(동시 생성 경쟁 대비)
  if (await getWeeklySheet(projectId, weekStart)) return { ok: true }

  const sb = await createServerClient()
  const { data: report, error } = await sb.from('weekly_reports')
    .insert({ project_id: projectId, week_start: weekStart })
    .select('id').single()
  if (error) {
    if (error.code === '23505') { revalidateWeekly(projectId); return { ok: true } } // 동시 생성 — 승자 문서 사용
    return { ok: false, error: error.message }
  }

  if (carryOver) {
    const src = await findCarryOverSource(projectId, weekStart)
    if (src && src.rows.length) {
      const rows = carryOverRows(src.rows).map(r => ({
        report_id: report.id as string, section: r.section, module: r.module, sort_order: r.sortOrder,
        this_content: r.thisContent, this_issue: r.thisIssue,
        next_content: r.nextContent, next_issue: r.nextIssue,
      }))
      const { error: rowErr } = await sb.from('weekly_report_rows').insert(rows)
      if (rowErr) return { ok: false, error: rowErr.message }
    }
  }
  revalidateWeekly(projectId)
  return { ok: true }
}

/** 셀 저장 — 열 화이트리스트 강제(last-write-wins, 스펙 §2). */
export async function saveWeeklyCell(
  projectId: string, rowId: string, cellKey: string, content: string,
): Promise<WeeklyActionResult> {
  if (!(await getSession())) return { ok: false, error: '로그인 필요' }
  if (!isWeeklyCellKey(cellKey)) return { ok: false, error: '잘못된 셀입니다.' }
  if (content.length > CELL_MAX) return { ok: false, error: `내용은 ${CELL_MAX}자 이하여야 합니다.` }

  const sb = await createServerClient()
  const { error } = await sb.from('weekly_report_rows')
    .update({ [cellKey]: content, updated_at: new Date().toISOString() }) // updated_at 트리거 없음 — 수동(wbs.ts 관례)
    .eq('id', rowId)
  if (error) return { ok: false, error: error.message }
  // revalidate 불필요 — 셀 값은 클라이언트 상태 + Realtime으로 동기화(새로고침 시 서버 조회가 최신)
  return { ok: true }
}

export async function addWeeklyRow(
  projectId: string, reportId: string, section: string, module: string,
): Promise<WeeklyActionResult> {
  if (!(await getSession())) return { ok: false, error: '로그인 필요' }
  const sec = section.trim(), mod = module.trim()
  if (!mod) return { ok: false, error: '모듈명을 입력하세요.' }
  if (sec.length > NAME_MAX || mod.length > NAME_MAX) return { ok: false, error: `이름은 ${NAME_MAX}자 이하여야 합니다.` }

  const sb = await createServerClient()
  const { data: last } = await sb.from('weekly_report_rows').select('sort_order')
    .eq('report_id', reportId).order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const { error } = await sb.from('weekly_report_rows')
    .insert({ report_id: reportId, section: sec, module: mod, sort_order: ((last?.sort_order as number) ?? 0) + 1 })
  if (error) return { ok: false, error: error.message }
  revalidateWeekly(projectId)
  return { ok: true }
}

export async function deleteWeeklyRow(projectId: string, rowId: string): Promise<WeeklyActionResult> {
  if (!(await getSession())) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { error } = await sb.from('weekly_report_rows').delete().eq('id', rowId)
  if (error) return { ok: false, error: error.message }
  revalidateWeekly(projectId)
  return { ok: true }
}

/** 행 이동 — 동일 section 내 인접 행과 swap(스펙 §3: 구분 병합이 갈라지지 않게). */
export async function moveWeeklyRow(
  projectId: string, rowId: string, dir: 'up' | 'down',
): Promise<WeeklyActionResult> {
  if (!(await getSession())) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data: me } = await sb.from('weekly_report_rows')
    .select('id, report_id, section, sort_order').eq('id', rowId).maybeSingle()
  if (!me) return { ok: false, error: '행을 찾을 수 없습니다.' }

  const { data: all } = await sb.from('weekly_report_rows')
    .select('id, section, sort_order').eq('report_id', me.report_id as string).order('sort_order')
  const list = all ?? []
  const idx = list.findIndex(r => r.id === rowId)
  const nIdx = dir === 'up' ? idx - 1 : idx + 1
  const neighbor = list[nIdx]
  if (!neighbor || neighbor.section !== me.section) return { ok: false, error: '같은 구분 안에서만 이동할 수 있습니다.' }

  const [r1, r2] = await Promise.all([
    sb.from('weekly_report_rows').update({ sort_order: neighbor.sort_order as number }).eq('id', rowId),
    sb.from('weekly_report_rows').update({ sort_order: me.sort_order as number }).eq('id', neighbor.id as string),
  ])
  const err = r1.error ?? r2.error
  if (err) return { ok: false, error: err.message }
  revalidateWeekly(projectId)
  return { ok: true }
}
```

- [ ] **Step 3: 타입 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add src/lib/data/weeklySheet.ts src/app/actions/weekly.ts
git commit -m "feat(weekly): 시트 조회·서버 액션 — 이월 생성/셀 저장/행 CRUD(구분 내 이동)"
```

---

### Task 8: /api/report — source=sheet 분기

**Files:**
- Modify: `src/app/api/report/route.ts`

**Interfaces:**
- Consumes: Task 2 `mondayIso`/`sheetWeekMeta`, Task 4 `buildSheetNarrative`/`sheetLineText`, Task 6 `fillWeeklyTemplate(narr, meta, opts)`, Task 7 `getWeeklySheet`.
- Produces: `GET /api/report?projectId=<id>&format=pptx&source=sheet&week=YYYY-MM-DD` → PPTX 다운로드. Task 9의 내보내기 버튼이 사용.

- [ ] **Step 1: 구현** — `route.ts`의 format 검증 직후(50행 부근)에 분기 삽입. 시트 분기는 기존 6소스 페치·`buildWeeklyReportModel`을 우회한다(스펙 §6).

```ts
  // ── 주간업무 시트 PPT (source=sheet): WBS 모델 페치를 우회하고 시트 rows만 사용 ──
  const source = req.nextUrl.searchParams.get('source')
  if (source === 'sheet') {
    if (format !== 'pptx') return NextResponse.json({ error: '시트 보고서는 pptx만 지원합니다' }, { status: 400 })
    const week = req.nextUrl.searchParams.get('week')
    if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
      return NextResponse.json({ error: 'week(YYYY-MM-DD)가 필요합니다' }, { status: 400 })
    }
    const weekStart = mondayIso(week) // 임의 날짜 → 월요일 정규화(스펙 §7)
    const [projects, sheet] = await Promise.all([listProjects(), getWeeklySheet(projectId, weekStart)])
    const project = (projects as { id: string; name: string }[]).find(p => p.id === projectId)
    if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다' }, { status: 404 })
    const hasContent = sheet?.rows.some(r =>
      (r.thisContent + r.thisIssue + r.nextContent + r.nextIssue).trim() !== '')
    if (!sheet || !hasContent) {
      return NextResponse.json({ error: '해당 주차에 작성된 내용이 없습니다' }, { status: 400 })
    }
    const wk = sheetWeekMeta(weekStart)
    const body = await fillWeeklyTemplate(
      buildSheetNarrative(sheet.rows),
      { meta: { prevWeekRange: wk.thisRange, weekRange: wk.nextRange } }, // 좌=금주실적, 우=차주계획
      { labels: { left: '금주실적', right: '차주계획' }, lineFormatter: sheetLineText },
    )
    const filename = `${project.name}_주간업무_${wk.weekTag}_${weekStart}.pptx`.replace(/[^\w가-힣.\-]+/g, '_')
    return new NextResponse(body as ArrayBuffer, { // 기존 반환부(route.ts:74)와 동일 캐스팅 관례
      headers: {
        'Content-Type': FORMATS.pptx.type,
        'Content-Disposition': `attachment; filename="report.pptx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      },
    })
  }
```

import 추가:

```ts
import { mondayIso, sheetWeekMeta } from '@/lib/report/week'
import { buildSheetNarrative, sheetLineText } from '@/lib/report/sheetNarrative'
import { getWeeklySheet } from '@/lib/data/weeklySheet'
```

(기존 반환부가 `body as ArrayBuffer` 캐스팅을 쓰고 있으므로 동일 관례를 따른다.)

- [ ] **Step 2: 타입·회귀 확인**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 에러 없음, 전부 PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/api/report/route.ts
git commit -m "feat(weekly): /api/report source=sheet — 시트 내용으로 주간업무 PPT 생성"
```

---

### Task 9: 주간업무 페이지 + 그리드 컴포넌트

**Files:**
- Create: `src/app/(app)/p/[projectId]/weekly/page.tsx`
- Create: `src/components/weekly/WeeklySheetView.tsx`

**Interfaces:**
- Consumes: Task 2 `mondayIso`/`shiftWeeks`/`sheetWeekMeta`, Task 3 도메인, Task 7 조회·액션.
- Produces: `/p/<projectId>/weekly?week=YYYY-MM-DD` 라우트. `WeeklySheetView` props: `{ projectId: string; weekStart: string; weekLabel: string; report: { id: string } | null; initialRows: WeeklySheetRow[]; hasCarrySource: boolean }`.

- [ ] **Step 1: 서버 페이지** — `src/app/(app)/p/[projectId]/weekly/page.tsx`

```tsx
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { listProjects } from '@/app/actions/project'
import { mondayIso, sheetWeekMeta } from '@/lib/report/week'
import { getWeeklySheet, findCarryOverSource } from '@/lib/data/weeklySheet'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { WeeklySheetView } from '@/components/weekly/WeeklySheetView'

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

export default async function WeeklyPage({
  params, searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ week?: string }>
}) {
  const { projectId } = await params
  const { week } = await searchParams
  const weekStart = mondayIso(week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : seoulToday())
  const wk = sheetWeekMeta(weekStart)

  const [sheet, carrySource, projects, locale] = await Promise.all([
    getWeeklySheet(projectId, weekStart),
    findCarryOverSource(projectId, weekStart),
    listProjects(),
    getServerLocale(),
  ])
  const projectName = projects.find(p => p.id === projectId)?.name ?? ''

  return (
    <ProjectPageShell
      hero={<PageHero
        eyebrow="WEEKLY"
        badge={<HeroBadge>Weekly Report</HeroBadge>}
        title={`${projectName} ${t(locale, 'nav.weekly')}`}
        description={`${wk.label} (${wk.thisRange})`}
      />}
    >
      <WeeklySheetView
        projectId={projectId}
        weekStart={weekStart}
        weekLabel={`${wk.label} (${wk.thisRange})`}
        report={sheet ? { id: sheet.report.id } : null}
        initialRows={sheet?.rows ?? []}
        hasCarrySource={!!carrySource && carrySource.rows.length > 0}
      />
    </ProjectPageShell>
  )
}
```

(주: `PageHero`에 `heroKpis` 없이 쓰는 형태가 지원되지 않으면 공지 페이지의 최소 사용례를 따른다.)

- [ ] **Step 2: 그리드 컴포넌트** — `src/components/weekly/WeeklySheetView.tsx`

핵심 규칙(스펙 §3·§5): 셀 로컬 상태 + dirty 집합, 1.5초 디바운스 + blur 저장, dirty 셀은 서버/Realtime 값으로 덮지 않음(`applyServerRow`), 저장 실패 시 로컬 유지 + 자동 재시도 1회 + 수동 재시도.

```tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Download, Plus, Trash2, ArrowUp, ArrowDown, FileSpreadsheet, RefreshCw } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import {
  applyServerRow, CELL_FIELD, type WeeklyCellKey, type WeeklySheetRow,
} from '@/lib/domain/weeklySheet'
import {
  addWeeklyRow, createWeeklyReport, deleteWeeklyRow, moveWeeklyRow, saveWeeklyCell,
} from '@/app/actions/weekly'
import { shiftWeeks } from '@/lib/report/week'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'

type CellStatus = 'saving' | 'saved' | 'error'
const DEBOUNCE_MS = 1500

const COLS: { key: WeeklyCellKey; label: string }[] = [
  { key: 'this_content', label: '금주실적 내용' },
  { key: 'this_issue', label: '금주 이슈·이벤트' },
  { key: 'next_content', label: '차주계획 내용' },
  { key: 'next_issue', label: '차주 이슈·이벤트' },
]

/** DB 행 payload(snake) → WeeklySheetRow. Realtime payload 매핑용. */
function fromRecord(r: Record<string, unknown>): WeeklySheetRow {
  return {
    id: String(r.id), reportId: String(r.report_id), section: String(r.section ?? ''),
    module: String(r.module ?? ''), sortOrder: Number(r.sort_order ?? 0),
    thisContent: String(r.this_content ?? ''), thisIssue: String(r.this_issue ?? ''),
    nextContent: String(r.next_content ?? ''), nextIssue: String(r.next_issue ?? ''),
  }
}

export function WeeklySheetView({
  projectId, weekStart, weekLabel, report, initialRows, hasCarrySource,
}: {
  projectId: string
  weekStart: string
  weekLabel: string
  report: { id: string } | null
  initialRows: WeeklySheetRow[]
  hasCarrySource: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [rows, setRows] = useState<WeeklySheetRow[]>(initialRows)
  const [status, setStatus] = useState<Record<string, CellStatus>>({}) // key = `${rowId}:${cellKey}`
  const dirtyRef = useRef<Set<string>>(new Set())
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const retriedRef = useRef<Set<string>>(new Set())
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const [isPending, startTransition] = useTransition()

  // 서버 refetch(라우터 refresh) 반영 — dirty 셀은 로컬 유지(스펙 §5)
  useEffect(() => {
    setRows(local => initialRows.map(sv => {
      const lc = local.find(l => l.id === sv.id)
      return lc ? applyServerRow(lc, sv, dirtyRef.current) : sv
    }))
  }, [initialRows])

  // Realtime 구독 — 행 단위 이벤트를 셀 단위 병합
  useEffect(() => {
    if (!report) return
    const sb = createBrowserClient()
    const channel = sb
      .channel(`weekly-rows-${report.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'weekly_report_rows', filter: `report_id=eq.${report.id}` },
        payload => {
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string }).id
            if (oldId) setRows(rs => rs.filter(r => r.id !== oldId))
            return
          }
          const server = fromRecord(payload.new as Record<string, unknown>)
          setRows(rs => {
            const i = rs.findIndex(r => r.id === server.id)
            if (i < 0) return [...rs, server].sort((a, b) => a.sortOrder - b.sortOrder)
            const next = [...rs]
            next[i] = applyServerRow(rs[i], server, dirtyRef.current)
            return next.sort((a, b) => a.sortOrder - b.sortOrder)
          })
        })
      .subscribe(st => {
        if (st === 'SUBSCRIBED') router.refresh() // 재연결 누락분 보정(스펙 §5)
      })
    return () => { sb.removeChannel(channel) }
  }, [report, router])

  const commit = useCallback((rowId: string, key: WeeklyCellKey) => {
    const k = `${rowId}:${key}`
    const timer = timersRef.current.get(k)
    if (timer) { clearTimeout(timer); timersRef.current.delete(k) }
    const row = rowsRef.current.find(r => r.id === rowId)
    if (!row || !dirtyRef.current.has(k)) return
    const sent = row[CELL_FIELD[key]]
    setStatus(s => ({ ...s, [k]: 'saving' }))
    saveWeeklyCell(projectId, rowId, key, sent).then(res => {
      const now = rowsRef.current.find(r => r.id === rowId)?.[CELL_FIELD[key]]
      if (!res.ok) {
        setStatus(s => ({ ...s, [k]: 'error' }))
        if (!retriedRef.current.has(k)) { retriedRef.current.add(k); setTimeout(() => commit(rowId, key), 2000) } // 자동 재시도 1회
        else toast({ title: '저장 실패', description: res.error, variant: 'error' })
        return
      }
      retriedRef.current.delete(k)
      if (now === sent) { dirtyRef.current.delete(k); setStatus(s => ({ ...s, [k]: 'saved' })) }
      else commit(rowId, key) // 전송 중 재수정 — dirty 유지한 채 재저장
    })
  }, [projectId, toast])

  const onCellChange = (rowId: string, key: WeeklyCellKey, value: string) => {
    const k = `${rowId}:${key}`
    dirtyRef.current.add(k)
    setRows(rs => rs.map(r => (r.id === rowId ? { ...r, [CELL_FIELD[key]]: value } : r)))
    const prev = timersRef.current.get(k)
    if (prev) clearTimeout(prev)
    timersRef.current.set(k, setTimeout(() => commit(rowId, key), DEBOUNCE_MS))
  }

  const runAction = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) toast({ title: '실패', description: res.error, variant: 'error' })
      router.refresh()
    })

  // section 시각 병합: 연속 같은 section의 첫 행에만 rowSpan.
  // 훅 규칙: 아래 EmptyState 조기 return보다 반드시 먼저 호출(렌더마다 훅 순서 고정).
  const spans = useMemo(() => rows.map((r, i) => {
    if (i > 0 && rows[i - 1].section === r.section) return 0
    let n = 1
    while (i + n < rows.length && rows[i + n].section === r.section) n += 1
    return n
  }), [rows])

  // ── 문서 없음: EmptyState + 시작 버튼 2종(스펙 §3 — 자동 생성 금지) ──
  if (!report) {
    return (
      <div className="space-y-4">
        <WeekNav projectId={projectId} weekStart={weekStart} weekLabel={weekLabel} exportDisabled />
        <EmptyState
          icon={FileSpreadsheet}
          title={`${weekLabel} 시트가 없습니다`}
          description="이전 주차에서 이월하거나 빈 시트로 시작하세요. 이월하면 이전 주의 차주계획이 이번 주 금주실적 초안으로 들어옵니다."
          action={
            <div className="flex gap-2">
              {hasCarrySource && (
                <button className="btn btn-primary" disabled={isPending}
                  onClick={() => runAction(() => createWeeklyReport(projectId, weekStart, true))}>
                  이전 주차에서 이월해 시작
                </button>
              )}
              <button className="btn btn-ghost" disabled={isPending}
                onClick={() => runAction(() => createWeeklyReport(projectId, weekStart, false))}>
                빈 시트로 시작
              </button>
            </div>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <WeekNav projectId={projectId} weekStart={weekStart} weekLabel={weekLabel} exportDisabled={false} />
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left">
              <th className="w-20 px-3 py-2 font-semibold text-ink">구분</th>
              <th className="w-28 px-3 py-2 font-semibold text-ink">모듈</th>
              {COLS.map(c => <th key={c.key} className="px-3 py-2 font-semibold text-ink">{c.label}</th>)}
              <th className="w-24 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-b border-line align-top">
                {spans[i] > 0 && (
                  <td rowSpan={spans[i]} className="border-r border-line px-3 py-2 text-center font-semibold text-ink">
                    {r.section}
                  </td>
                )}
                <td className="border-r border-line px-3 py-2 text-center font-medium text-ink">{r.module}</td>
                {COLS.map(c => (
                  <td key={c.key} className="border-r border-line p-1">
                    <CellEditor
                      value={r[CELL_FIELD[c.key]]}
                      status={status[`${r.id}:${c.key}`]}
                      onChange={v => onCellChange(r.id, c.key, v)}
                      onBlur={() => commit(r.id, c.key)}
                      onRetry={() => commit(r.id, c.key)}
                    />
                  </td>
                ))}
                <td className="px-2 py-2">
                  <div className="flex gap-1 text-ink-subtle">
                    <button title="위로" className="hover:text-ink" onClick={() => runAction(() => moveWeeklyRow(projectId, r.id, 'up'))}><ArrowUp className="h-4 w-4" /></button>
                    <button title="아래로" className="hover:text-ink" onClick={() => runAction(() => moveWeeklyRow(projectId, r.id, 'down'))}><ArrowDown className="h-4 w-4" /></button>
                    <button title="행 삭제" className="hover:text-delayed"
                      onClick={() => { if (confirm(`'${r.module}' 행을 삭제할까요? 셀 내용도 함께 지워집니다.`)) runAction(() => deleteWeeklyRow(projectId, r.id)) }}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <AddRowForm disabled={isPending} onAdd={(section, module) => runAction(() => addWeeklyRow(projectId, report.id, section, module))} />
      </div>
    </div>
  )
}

function WeekNav({ projectId, weekStart, weekLabel, exportDisabled }: {
  projectId: string; weekStart: string; weekLabel: string; exportDisabled: boolean
}) {
  const base = `/p/${projectId}/weekly`
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Link href={`${base}?week=${shiftWeeks(weekStart, -1)}`} className="btn btn-ghost px-2" aria-label="이전 주">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <span className="min-w-40 text-center text-sm font-semibold text-ink">{weekLabel}</span>
        <Link href={`${base}?week=${shiftWeeks(weekStart, 1)}`} className="btn btn-ghost px-2" aria-label="다음 주">
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      <ExportPptButton projectId={projectId} weekStart={weekStart} disabled={exportDisabled} />
    </div>
  )
}

/** PPT 내보내기 — fetch로 받아 400(빈 시트 등)을 Toast로 안내(스펙 §7). 성공 시 blob 다운로드. */
function ExportPptButton({ projectId, weekStart, disabled }: {
  projectId: string; weekStart: string; disabled: boolean
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const onExport = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/report?projectId=${projectId}&format=pptx&source=sheet&week=${weekStart}`)
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null
        toast({ title: 'PPT 내보내기 실패', description: err?.error ?? `오류 (${res.status})`, variant: 'error' })
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const name = decodeURIComponent(cd.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? `weekly_${weekStart}.pptx`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button className="btn btn-primary" disabled={disabled || busy} onClick={onExport}>
      <Download className="mr-1 h-4 w-4" />PPT 내보내기
    </button>
  )
}

function CellEditor({ value, status, onChange, onBlur, onRetry }: {
  value: string; status?: CellStatus
  onChange: (v: string) => void; onBlur: () => void; onRetry: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { // 자동 높이
    const el = ref.current
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }
  }, [value])
  return (
    <div className="relative">
      <textarea
        ref={ref} value={value} rows={3}
        className="app-textarea min-h-20 w-full resize-none border-0 bg-transparent text-sm leading-5"
        onChange={e => onChange(e.target.value)} onBlur={onBlur}
      />
      <span className="absolute right-1 top-1 text-[10px]">
        {status === 'saving' && <span className="text-ink-subtle">저장 중…</span>}
        {status === 'saved' && <span className="text-done">저장됨</span>}
        {status === 'error' && (
          <button className="flex items-center gap-0.5 text-delayed" onClick={onRetry} title="다시 저장">
            <RefreshCw className="h-3 w-3" />재시도
          </button>
        )}
      </span>
    </div>
  )
}

function AddRowForm({ disabled, onAdd }: { disabled: boolean; onAdd: (section: string, module: string) => void }) {
  const [section, setSection] = useState('')
  const [module, setModule] = useState('')
  return (
    <div className="flex items-center gap-2 border-t border-line px-3 py-2">
      <Plus className="h-4 w-4 text-ink-subtle" />
      <input className="app-input h-8 w-28 text-sm" placeholder="구분 (ERP)" value={section} onChange={e => setSection(e.target.value)} />
      <input className="app-input h-8 w-36 text-sm" placeholder="모듈 (SD/LE)" value={module} onChange={e => setModule(e.target.value)} />
      <button className="btn btn-ghost h-8 text-sm" disabled={disabled || !module.trim()}
        onClick={() => { onAdd(section, module); setSection(''); setModule('') }}>
        모듈 추가
      </button>
    </div>
  )
}
```

- [ ] **Step 3: 타입·빌드 확인**

Run: `npx tsc --noEmit && npm run build 2>&1 | tail -5`
Expected: 타입 에러 없음, 빌드 성공. (`ProjectPageShell`/`PageHero` prop 불일치가 나오면 공지 페이지 사용례에 맞춰 조정.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/p/[projectId]/weekly/page.tsx" src/components/weekly/WeeklySheetView.tsx
git commit -m "feat(weekly): 주간업무 시트 화면 — 그리드 편집·디바운스 저장·Realtime dirty 병합·주차 네비"
```

---

### Task 10: 사이드바 메뉴 + i18n

**Files:**
- Modify: `src/components/app/Sidebar.tsx:34-45` (`projectMenu`)
- Modify: `src/lib/i18n/dict/common.ts` (nav 키 — ko 블록 17행 부근, en 블록 62행 부근)

**Interfaces:**
- Consumes: Task 9의 라우트 `/p/<id>/weekly`.

- [ ] **Step 1: i18n 키 추가** — `common.ts`의 ko 블록 `'nav.meetings': '회의일정',` 다음 줄과 en 블록 `'nav.meetings': 'Meetings',` 다음 줄에 각각:

```ts
  'nav.weekly': '주간업무',
```
```ts
  'nav.weekly': 'Weekly Report',
```

- [ ] **Step 2: 메뉴 항목 추가** — `Sidebar.tsx` lucide import에 `NotebookPen` 추가, `projectMenu()`의 meetings 항목 다음에:

```ts
    { href: `${base}/weekly`, labelKey: 'nav.weekly', icon: NotebookPen, match: `${base}/weekly` },
```

- [ ] **Step 3: 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (`nav.weekly`가 DictKey에 자동 포함)

- [ ] **Step 4: Commit**

```bash
git add src/components/app/Sidebar.tsx src/lib/i18n/dict/common.ts
git commit -m "feat(weekly): 사이드바 주간업무 메뉴 + nav.weekly i18n"
```

---

### Task 11: 통합 검증 (PPTX 실물 확인 포함)

**Files:** 없음(검증만). 스크립트는 스크래치패드에 생성.

- [ ] **Step 1: 전체 테스트·타입·빌드**

Run: `npx vitest run && npx tsc --noEmit && npm run build 2>&1 | tail -5`
Expected: 전부 통과

- [ ] **Step 2: 시트 PPT 실물 생성·XML 검증** — 스크래치패드에서 실행(리포에 커밋하지 않음)

```bash
npx tsx -e "
import { fillWeeklyTemplate } from './src/lib/report/templateFill'
import { buildSheetNarrative, sheetLineText } from './src/lib/report/sheetNarrative'
import { writeFileSync } from 'node:fs'
const rows = [
  { id: 'a', reportId: 'r', section: 'ERP', module: 'SD/LE', sortOrder: 1,
    thisContent: '1. 현업 인터뷰 참석\n- 대상 : 영업팀\n. 불편사항 청취', thisIssue: '지연 위험',
    nextContent: '1. Check List 점검', nextIssue: '' },
  { id: 'b', reportId: 'r', section: 'MES', module: '가공', sortOrder: 2,
    thisContent: '1. 프로세스 분석', thisIssue: '', nextContent: '', nextIssue: '인터뷰 일정 협의' },
]
fillWeeklyTemplate(
  buildSheetNarrative(rows as any),
  { meta: { prevWeekRange: '7/6~7/10', weekRange: '7/13~7/17' } },
  { labels: { left: '금주실적', right: '차주계획' }, lineFormatter: sheetLineText },
).then(buf => { writeFileSync('<스크래치패드>/weekly-sheet.pptx', buf); console.log('ok', buf.length) })
"
```

이후 zip에서 `ppt/slides/slide2.xml`을 추출해 확인:
- 헤더 `금주실적 (7/6~7/10)` / `차주계획 (7/13~7/17)`
- `• [ERP] SD/LE` 볼드 불릿 + `    1. 현업 인터뷰 참석` + `        - 대상 : 영업팀` + `            . 불편사항 청취`
- 이슈 행 좌 `[SD/LE] 지연 위험`, 우 `[가공] 인터뷰 일정 협의`
- 차주 열에 `[MES] 가공` 그룹 없음(빈 셀 생략) — 금주 열에는 있음

- [ ] **Step 3: 결과 보고**

수동 브라우저 검증(그리드 편집·Realtime·이월·PPT 다운로드)은 프로덕션 배포 후 사용자와 함께 진행한다고 보고. 배포(`/deploy`)는 사용자 지시가 있을 때만.

---

## 실행 메모

- Task 1(마이그레이션 적용)은 프로덕션 DB를 변경한다 — 적용 전 SQL을 사용자에게 한 번 보여주고 진행하는 것이 안전.
- Task 2~8은 순수/서버 계층이라 순차 TDD로 안전. Task 9가 가장 크고 UI 세부는 기존 토큰에 맞춰 조정 여지 있음.
- Realtime은 로컬에서 완전 검증이 어려움(브라우저 2개 필요) — 구조(dirty 병합)는 Task 3 단위 테스트로 보증하고, 실동작은 배포 후 확인.
