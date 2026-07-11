# 1–2주차: 액션 봇 + 리포 위생 + 상태 판정 + 측정 시작 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DK Bot이 자연어 명령(실적 변경·일정 변경·완료 처리)을 확인 카드로 제안하고 승인 시 기존 서버 액션으로 실행하게 하며, 실명 사내 파일 제거·README 재작성·프로젝트 상태 판정 결함 수정·성과 측정 프로토콜 수립을 완료한다.

**Architecture:** 명령 처리는 순수 함수 파이프라인(큐 감지 → 결정형 파싱 → LLM 폴백 파싱 → 대상 매칭 → 제안 생성)으로 `src/lib/ai/commands/`에 격리하고, API 라우트는 인증+데이터 로드+파이프라인 호출만 하는 얇은 접착층으로 유지한다. 쓰기는 전부 기존 서버 액션(updateActual/updateWbsFields)을 재사용해 권한 게이트·낙관적 잠금·change_logs·진척 스냅샷을 그대로 상속한다. AI는 절대 자동 실행하지 않는다 — 확인 카드의 [적용] 클릭만 쓰기를 유발한다.

**Tech Stack:** Next.js 15 (App Router, server actions), Supabase, Gemini free tier via 기존 `generateAnswer` 체인, Vitest.

## Global Constraints

- **`git add -A` / `git add .` 절대 금지** — 커밋마다 파일을 명시적으로 나열한다 (병렬 세션 규칙).
- 새 외부 의존성 추가 금지 (package.json 변경 없음).
- LLM 호출은 반드시 기존 `generateAnswer(system, messages)` (src/lib/ai/llm.ts:20) 경유 — 신규 fetch 금지. 반환 `null` = LLM 불능이며 정직한 안내로 폴백한다.
- WBS 쓰기는 기존 서버 액션만 사용 — 신규 쓰기 경로(RPC/route 직접 update) 금지.
- 사용자 대면 문자열은 한국어. 서버 액션의 기존 에러 문자열은 그대로 봇 말풍선에 표출한다.
- 테스트: `tests/<area>/<topic>.test.ts`, vitest 명시적 import (`import { describe, it, expect, vi } from 'vitest'`), 한국어 describe/it 제목, 모킹 순서는 vi.mock 먼저 → SUT import (기존 관례).
- 검증 커맨드: `npm test` (전체), `npx vitest run tests/<path>` (단일), `npm run lint`, `npm run build`. 이 저장소는 `next dev` 실행 중 `next build` 금지.
- TypeScript strict — `any` 회피, 기존 도메인 타입(`ComputedItem`, `Membership` 등 src/lib/domain/types.ts) 재사용.
- **D-CUBE 프로덕션 데이터 불훼손 (절대 원칙)** — 운영 중인 D-CUBE 프로젝트의 데이터(projects/wbs_items/진도율·진척 스냅샷·변경 이력/회의록/주간 시트)를 어떤 태스크도 변경·삭제하지 않는다. 이 계획에 DB 마이그레이션은 0건이며 신규 쓰기 경로도 없다(기존 서버 액션 재사용만). 봇의 쓰기는 확인 카드 [적용] 클릭으로만 발생하고 자동 실행은 없다.
- 쓰기 경로의 수동·스모크 검증(봇 [적용] 클릭)은 **전용 테스트 프로젝트**(예: "액션봇 테스트" 신설)에서만 실행한다. D-CUBE 항목 대상 [적용] 클릭 검증 금지 — 로컬 dev도 프로덕션 Supabase를 공유하므로 로컬 검증에도 동일하게 적용된다.
- Task 1에서 제거한 실물 파일 4개는 docs/backups/(git 제외)에 로컬 백업 보관 — 삭제 금지. git 히스토리도 보존(소거는 사용자 보류 결정).

---

### Task 1: 실명 사내 파일 제거 + .gitignore 방어 (C1-a, 최우선 보안)

**Files:**
- Delete: `docs/26.07.02. D-Cube 주간보고_부산운영팀_1_2026-07-07_이돈석.pptx`
- Delete: `docs/D-CUBE PI Master Plan 수립 WBS WBS_Rev1(1)_부산운영팀_1_2026-07-03_이돈석.xlsx`
- Delete: `docs/D-CUBE PI Master Plan 수립 WBS WBS_Rev2.xlsx`
- Delete: `docs/D-CUBE PI Master Plan 수립 WBS WBS_Rev3_부산운영팀_1_2026-07-07_이돈석.xlsx`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: 없음. 사전 확인 완료: 이 4개 파일을 참조하는 코드/테스트/스크립트 0건 (tests/excel/*은 전부 인메모리 워크북, 유일한 디스크 픽스처는 src/lib/report/assets/weekly-template.pptx로 docs/ 밖).
- Produces: 실명 파일 없는 워킹 트리. (git 히스토리 소거는 사용자 보류 결정 — 건드리지 않는다.)

- [ ] **Step 1: 4개 파일 git rm** (파일명에 공백·괄호·한글 — 반드시 인용)

```bash
cd /Users/jerry/wbs-web
git rm 'docs/26.07.02. D-Cube 주간보고_부산운영팀_1_2026-07-07_이돈석.pptx' \
  'docs/D-CUBE PI Master Plan 수립 WBS WBS_Rev1(1)_부산운영팀_1_2026-07-03_이돈석.xlsx' \
  'docs/D-CUBE PI Master Plan 수립 WBS WBS_Rev2.xlsx' \
  'docs/D-CUBE PI Master Plan 수립 WBS WBS_Rev3_부산운영팀_1_2026-07-07_이돈석.xlsx'
```

Expected: `rm 'docs/...'` 4줄 출력.

- [ ] **Step 2: .gitignore에 재커밋 방어 패턴 추가**

`.gitignore` 끝(기존 `/docs/backups/` 라인 아래)에 추가:

```gitignore
# 사내 실물 문서 재커밋 방지
/docs/*.xlsx
/docs/*.pptx
```

- [ ] **Step 3: 참조 부재 재확인 + 테스트 통과 확인**

```bash
grep -rn "이돈석\|부산운영팀" src/ tests/ scripts/ ; echo "exit=$?"
npm test
```

Expected: grep은 exit=1 (0건), 테스트 662개 전부 PASS.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore(docs): 실명 포함 사내 실물 파일 제거 + 재커밋 방지 패턴"
```

(git rm은 이미 스테이징됨 — .gitignore만 추가 스테이징.)

---

### Task 2: README 전면 재작성 (C1-b)

**Files:**
- Modify: `README.md` (전체 교체)
- Add: `docs/competition-brainstorm.md` (기존 untracked 파일 커밋 — 스펙 5-3이 참조)

**Interfaces:**
- Consumes: 검증된 현황 — 데모 모드 코드 0건, 마이그레이션 0001~0024(0018 결번, *_rollback.sql 2개 제외), 팀 코드 PMO/가공/ERP/MES (0014에서 DT→가공), 관리자 계정 UI 존재(src/app/(app)/admin/accounts), env는 .env.local.example이 최신.
- Produces: 재현 가능한 README. 이후 태스크와 독립.

- [ ] **Step 1: README.md 전체 교체**

아래 구조로 작성한다 (기존 L5-9 도메인 원칙과 L26-48 명령어 표는 그대로 보존·재배치):

```markdown
# D'Flow — PI 프로젝트 운영 스위트

동국씨엠 PI(Process Innovation) 관리를 위해 구축한 통합 운영 도구.
WBS·간트, 경영진 대시보드, 칸반, 주간업무 시트(실시간 동시편집),
회사 공식 양식 주간보고 PPT/Excel 생성, 회의 달력, 회의록 보관함(RAG 챗봇),
공지, 근태, 계정 관리, DK Bot(WBS RAG 챗봇), 한/영 i18n을 포함한다.

## 도메인 원칙
(기존 L5-9 불릿 그대로 복사)

## 기술 스택
Next.js 15(App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
Supabase(Postgres+RLS+Realtime+pgvector) · Gemini API(무료 티어, OpenAI 호환
전환 가능) · SheetJS/exceljs(엑셀) · jszip(PPTX 템플릿 필) · mermaid ·
react-markdown · lucide-react · Vitest(+jsdom)

## 로컬 실행
(기존 명령어 표 그대로. "데모 모드" 섹션은 부활 금지 — 코드에서 제거된 기능)

## 환경 변수
.env.local.example 참조 (Supabase 3종 + DK Bot용 GEMINI_API_KEY 등.
NEXT_PUBLIC_DEMO_MODE는 폐기된 변수 — 문서화 금지)

## 데이터베이스
supabase/migrations/ 0001~0024를 번호순 실행 (0018 결번, *_rollback.sql 제외).
시드: supabase/seed.sql — 팀 4개(PMO/가공/ERP/MES).
알려진 드리프트: 레포 0002/0004의 current_role()은 프로덕션에서 app_role()로
대체 적용됨 (0012부터 주석 참조). DK Bot 스키마는 scripts/apply-dkbot-migration.mjs.

## 계정
관리자 화면(/admin/accounts)에서 생성/일괄생성/리셋. 최초 pmo_admin 1명만
Supabase 대시보드에서 수동 부트스트랩.

## 프로젝트 구조
src/app: (app)/{admin,meetings,minutes,p/[projectId]/{announcements,attendance,
dashboard,gantt,kanban,meetings,members,settings,wbs,weekly},projects},
actions/, api/{chat,export,import,minutes,report}, login/
src/lib: ai/ domain/ data/ excel/ report/ i18n/ prefs/ supabase/ auth.ts
src/components: 18개 화면·공용 디렉터리 (ui/가 공용 프리미티브 13종)
tests/: actions ai domain excel lib minutes report ui
```

문구는 위 개요를 따르되 완전한 문장으로 작성. 정확성 기준: 존재하지 않는
파일·기능 언급 0건.

- [ ] **Step 2: 검증 — README가 언급하는 경로 전수 존재 확인**

```bash
ls docs/WBS-original.xlsx src/app/preview 2>&1 | head -2
grep -n "DEMO_MODE\|DT" README.md ; echo "exit=$?"
```

Expected: 첫 줄 두 경로 모두 "No such file"(README에 없어야 정상), grep exit=1.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/competition-brainstorm.md
git commit -m "docs(readme): 현행 제품(D'Flow 운영 스위트) 기준 전면 재작성 — 데모 모드·구 팀코드 등 드리프트 제거"
```

---

### Task 3: 성과 측정 프로토콜 문서 (D5)

**Files:**
- Create: `docs/superpowers/measurements.md`

**Interfaces:**
- Consumes: 없음.
- Produces: 측정 로그 파일 — 이후 주차(A3/A4)에서 자동 측정 지표를 이 파일 기준으로 계측. 발표 자료의 정량 근거 원천.

- [ ] **Step 1: 프로토콜 문서 작성**

```markdown
# D'Flow 성과 측정 프로토콜

발표에서 "N% 단축" 임의 주장 대신 실제 사용 기록의 중앙값을 제시한다.
측정 시작: 2026-07-14(월). 기록 주기: 발생 시마다 아래 로그 표에 1행.

## 지표 정의

| # | 지표 | 측정 방법 | 비고 |
|---|------|----------|------|
| 1 | 주간보고 작성시간 | 시트 작성 시작~PPT 다운로드까지 수동 타이머 | AI 초안(5주차) 전/후 비교가 핵심 |
| 2 | 회의 종료→WBS 반영시간 | 회의 종료 시각~관련 WBS 변경 커밋 시각 | A3(4주차) 배포 후 자동화 |
| 3 | 누락 액션 아이템 수 | 주간 회고 시 "회의에서 나왔는데 WBS에 없는 항목" 카운트 | 주 1회 |
| 4 | 기한 내 액션 완료율 | 완료 액션 중 기한 내 비율 | 주 1회 |
| 5 | 엑셀 파일 교환 횟수 | 메일/메신저로 WBS·주간보고 엑셀을 주고받은 횟수 | 주 1회, 0이 목표 |
| 6 | 버전 충돌 횟수 | 동시 편집 충돌 토스트 목격 횟수 | 발생 시 |
| 7 | 위험 사전 감지 리드타임 | 대시보드 신호→실제 문제 확인까지 일수 | 발생 시 |
| 8 | 회의록 검색 소요시간 | 과거 결정사항 찾기 시작~발견까지 | 발생 시 |

## 측정 로그

| 날짜 | 지표# | 값 | 상황 메모 |
|------|-------|-----|----------|
| (기록 시작 전) | - | - | - |

## 베이스라인 (도입 전 관행 — 1회 회고로 추정 기록)

| 지표# | 도입 전 값 | 추정 근거 |
|-------|-----------|----------|
| 1 | (기록) | 엑셀+PPT 수작업 시절 소요시간 회고 |
| 5 | (기록) | 주당 메일 첨부 횟수 회고 |
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/measurements.md
git commit -m "docs(measurements): 성과 측정 프로토콜 — 8개 지표 정의 + 로그 시작"
```

---

### Task 4: 프로젝트 생애 상태 순수 함수 (D2-a)

**Files:**
- Create: `src/lib/domain/project-status.ts`
- Test: `tests/domain/project-status.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 함수만).
- Produces: `type ProjectLifecycleStatus = 'ready' | 'active' | 'overdue' | 'done'`, `interface ProjectCompletion { hasWbs: boolean; allDone: boolean }`, `projectLifecycleStatus(start: string | null, end: string | null, today: string, completion: ProjectCompletion): ProjectLifecycleStatus`, `computeCompletionMap(rows: CompletionRow[]): Record<string, ProjectCompletion>` (`CompletionRow = { id: string; parentId: string | null; projectId: string; actualPct: number | null }`). Task 5가 소비.

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// tests/domain/project-status.test.ts
import { describe, it, expect } from 'vitest'
import {
  projectLifecycleStatus,
  computeCompletionMap,
  type ProjectCompletion,
} from '@/lib/domain/project-status'

const done: ProjectCompletion = { hasWbs: true, allDone: true }
const notDone: ProjectCompletion = { hasWbs: true, allDone: false }
const noWbs: ProjectCompletion = { hasWbs: false, allDone: false }

describe('projectLifecycleStatus — 날짜+실제 완료율 결합 판정', () => {
  it('시작 전이면 ready', () => {
    expect(projectLifecycleStatus('2026-08-01', '2026-12-31', '2026-07-14', notDone)).toBe('ready')
  })
  it('기간 내면 active (완료율 무관)', () => {
    expect(projectLifecycleStatus('2026-07-01', '2026-12-31', '2026-07-14', notDone)).toBe('active')
  })
  it('종료일 경과 + 전 리프 완료면 done', () => {
    expect(projectLifecycleStatus('2026-01-01', '2026-07-01', '2026-07-14', done)).toBe('done')
  })
  it('종료일 경과 + 미완 리프 존재면 overdue (기존 결함의 수정 지점)', () => {
    expect(projectLifecycleStatus('2026-01-01', '2026-07-01', '2026-07-14', notDone)).toBe('overdue')
  })
  it('종료일 경과 + WBS 없음이면 done (판단 근거 없음 — 날짜 기준 유지)', () => {
    expect(projectLifecycleStatus('2026-01-01', '2026-07-01', '2026-07-14', noWbs)).toBe('done')
  })
  it('날짜 미설정이면 ready', () => {
    expect(projectLifecycleStatus(null, null, '2026-07-14', done)).toBe('ready')
  })
})

describe('computeCompletionMap — 리프 판정(자식 유무) + 전량 완료', () => {
  it('자식 없는 행만 리프로 집계하고 프로젝트별로 묶는다', () => {
    const map = computeCompletionMap([
      { id: 'a', parentId: null, projectId: 'p1', actualPct: null }, // 부모
      { id: 'b', parentId: 'a', projectId: 'p1', actualPct: 100 },
      { id: 'c', parentId: 'a', projectId: 'p1', actualPct: 100 },
      { id: 'd', parentId: null, projectId: 'p2', actualPct: 50 }, // 단독 리프
    ])
    expect(map['p1']).toEqual({ hasWbs: true, allDone: true })
    expect(map['p2']).toEqual({ hasWbs: true, allDone: false })
  })
  it('done 판정은 원시값 >= 100 (99.5는 미완 — statusOf 규약과 동일)', () => {
    const map = computeCompletionMap([
      { id: 'x', parentId: null, projectId: 'p', actualPct: 99.5 },
    ])
    expect(map['p'].allDone).toBe(false)
  })
  it('빈 입력이면 빈 맵', () => {
    expect(computeCompletionMap([])).toEqual({})
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/project-status.test.ts`
Expected: FAIL — "Cannot find module '@/lib/domain/project-status'"

- [ ] **Step 3: 구현**

```typescript
// src/lib/domain/project-status.ts
// 프로젝트 생애 상태 — 날짜 + 실제 WBS 완료율 결합 판정.
// 배경: 날짜만 보던 기존 판정은 종료일이 지나면 실적 50%여도 '완료'로 표시했다.

export type ProjectLifecycleStatus = 'ready' | 'active' | 'overdue' | 'done'

export interface ProjectCompletion {
  hasWbs: boolean
  allDone: boolean
}

export interface CompletionRow {
  id: string
  parentId: string | null
  projectId: string
  actualPct: number | null
}

export function projectLifecycleStatus(
  start: string | null,
  end: string | null,
  today: string,
  completion: ProjectCompletion,
): ProjectLifecycleStatus {
  if (!start || !end) return 'ready'
  if (today < start) return 'ready'
  if (today > end) {
    // WBS가 없으면 판단 근거가 없으므로 날짜 기준(done)을 유지한다.
    if (!completion.hasWbs) return 'done'
    return completion.allDone ? 'done' : 'overdue'
  }
  return 'active'
}

// done 판정은 원시값 >= 100 (statusOf와 동일 규약 — 반올림 금지)
export function computeCompletionMap(rows: CompletionRow[]): Record<string, ProjectCompletion> {
  const parents = new Set<string>()
  for (const r of rows) if (r.parentId) parents.add(r.parentId)
  const map: Record<string, ProjectCompletion> = {}
  for (const r of rows) {
    if (parents.has(r.id)) continue // 리프만 (자식 유무 판정 — level 아님)
    const cur = map[r.projectId] ?? { hasWbs: false, allDone: true }
    cur.hasWbs = true
    if ((r.actualPct ?? 0) < 100) cur.allDone = false
    map[r.projectId] = cur
  }
  return map
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/project-status.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/project-status.ts tests/domain/project-status.test.ts
git commit -m "feat(domain): 프로젝트 생애 상태 순수 함수 — 날짜+완료율 결합, overdue 상태 신설"
```

---

### Task 5: 상태 판정 배선 — 홈·사이드바·i18n (D2-b)

**Files:**
- Modify: `src/lib/data/wbs.ts` (완료율 맵 조회 헬퍼 추가)
- Modify: `src/app/(app)/projects/page.tsx:24-41,106-111` (projectStatus 대체)
- Modify: `src/app/(app)/layout.tsx:12-17,20-27` (projectStatus 대체)
- Modify: `src/components/app/Sidebar.tsx:15,28-32` (SidebarProject union + STATUS_META)
- Modify: `src/lib/i18n/dict/home.ts` (home.status_overdue ko/en)

**Interfaces:**
- Consumes: Task 4의 `projectLifecycleStatus`, `computeCompletionMap`, `ProjectCompletion`. 기존 `aggregateTaskStats(projectTrees): { tasks, done, donePct }` (src/lib/domain/workspace.ts:19), `getComputedWbs` (src/lib/data/wbs.ts:11, React cache).
- Produces: `getProjectsCompletion(projectIds: string[]): Promise<Record<string, ProjectCompletion>>` (src/lib/data/wbs.ts, cache 래핑). `SidebarProject['status']`가 4값 유니언으로 확장 — HeaderChrome.tsx(17행 import)는 status를 안 읽으므로 타입 확장만으로 안전.

- [ ] **Step 1: 데이터 헬퍼 추가** (src/lib/data/wbs.ts 하단)

```typescript
import { computeCompletionMap, type ProjectCompletion } from '@/lib/domain/project-status'

// 사이드바용 경량 완료율 맵 — 프로젝트 전체를 1쿼리로 (트리 로드 없이)
export const getProjectsCompletion = cache(
  async (projectIds: string[]): Promise<Record<string, ProjectCompletion>> => {
    if (!projectIds.length) return {}
    const sb = await createServerClient()
    const { data } = await sb
      .from('wbs_items')
      .select('id, parent_id, project_id, actual_pct')
      .in('project_id', projectIds)
    return computeCompletionMap(
      (data ?? []).map(r => ({
        id: r.id as string,
        parentId: (r.parent_id as string | null) ?? null,
        projectId: r.project_id as string,
        actualPct: (r.actual_pct as number | null) ?? null,
      })),
    )
  },
)
```

(파일 상단에 이미 있는 `cache`, `createServerClient` import 재사용 — 없으면 추가.)

- [ ] **Step 2: layout.tsx 배선** — 12-17행의 로컬 `projectStatus` 함수를 삭제하고 대체:

```typescript
import { projectLifecycleStatus } from '@/lib/domain/project-status'
import { getProjectsCompletion } from '@/lib/data/wbs'

// (기존 데이터 로드부에서)
const completion = await getProjectsCompletion(projects.map(p => p.id))
const projectLinks: SidebarProject[] = projects.map(p => ({
  id: p.id,
  name: p.name,
  status: projectLifecycleStatus(
    p.start_date, p.end_date, today,
    completion[p.id] ?? { hasWbs: false, allDone: false },
  ),
  baseDate: (p as { base_date?: string | null }).base_date ?? null,
}))
```

- [ ] **Step 3: projects/page.tsx 배선** — 24-41행 로컬 타입·함수 삭제, 이미 로드된 trees 재사용 (추가 쿼리 없음):

```typescript
import { projectLifecycleStatus, type ProjectLifecycleStatus } from '@/lib/domain/project-status'
import { aggregateTaskStats } from '@/lib/domain/workspace'

// trees는 기존 115-117행에서 이미 projects와 인덱스 정렬로 로드됨
const withStatus = projects.map((p, i) => {
  const stats = aggregateTaskStats([trees[i]])
  return {
    project: p,
    status: projectLifecycleStatus(p.start_date, p.end_date, today, {
      hasWbs: stats.tasks > 0,
      allDone: stats.tasks > 0 && stats.done === stats.tasks,
    }),
  }
})
```

STATUS 맵(26-30행)에 overdue 추가:

```typescript
overdue: { labelKey: 'home.status_overdue' as DictKey, chip: 'bg-delayed-weak text-delayed', dot: 'bg-delayed' },
```

KPI 집계(106-111행)의 `type ProjectStatus` 참조를 `ProjectLifecycleStatus`로 교체. doneCount는 status==='done' 유지(overdue는 완료 아님 — 의미 교정이 목적).

- [ ] **Step 4: Sidebar + i18n**

`src/components/app/Sidebar.tsx:15` — status 유니언에 `'overdue'` 추가.
`Sidebar.tsx:28-32` STATUS_META에 추가 (기존 raw 팔레트 관례 유지 — 토큰화는 3주차 디자인 S작업):

```typescript
overdue: { dot: 'bg-rose-400', label: '지연' },
```

`src/lib/i18n/dict/home.ts` — ko `status_overdue: '지연 종료'`, en `status_overdue: 'Overdue'` (ko/en 키 패리티는 컴파일 타임 강제 — 한쪽만 넣으면 빌드 에러).

- [ ] **Step 5: 전체 검증**

```bash
npm test && npm run lint && npm run build
```

Expected: 테스트 전부 PASS(신규 9개 포함), 린트·빌드 통과.

- [ ] **Step 6: Commit**

```bash
git add src/lib/data/wbs.ts src/app/\(app\)/layout.tsx src/app/\(app\)/projects/page.tsx src/components/app/Sidebar.tsx src/lib/i18n/dict/home.ts
git commit -m "fix(home): 프로젝트 상태를 날짜+실제 완료율로 판정 — 기간 경과·미완은 '지연 종료'로 표시"
```

---

### Task 6: 명령 타입 + 큐 감지 (A1-a)

**Files:**
- Create: `src/lib/ai/commands/types.ts`
- Create: `src/lib/ai/commands/cue.ts`
- Test: `tests/ai/commands-cue.test.ts`

**Interfaces:**
- Consumes: 없음 (순수).
- Produces (이후 모든 A1 태스크가 소비):

```typescript
export type CommandAction = 'set_actual' | 'set_dates' | 'complete'
export interface ParsedCommand {
  action: CommandAction
  targetQuery: string          // 사용자가 말한 대상 표현
  actualPct?: number           // set_actual 전용 (0~100)
  plannedStart?: string | null // set_dates 전용, 'YYYY-MM-DD'
  plannedEnd?: string | null
}
export interface CommandCandidate {
  id: string
  name: string
  phaseName: string
  ownersText: string
  currentActual: number | null   // 원시 actualPct — 낙관적 잠금 expectedCurrent용
  displayActual: number          // Math.round(rolledActualPct) — 표시용
  plannedStart: string | null
  plannedEnd: string | null
}
export type CommandProposal =
  | { kind: 'proposal'; action: CommandAction; target: CommandCandidate
      // params = 적용 시 서버 액션에 넘길 원시 값 (표시 문자열 역파싱 금지)
      params: { actualPct?: number; plannedStart?: string | null; plannedEnd?: string | null }
      changes: { field: 'actual_pct' | 'planned_start' | 'planned_end'; label: string; before: string; after: string }[] }
  | { kind: 'disambiguate'; targetQuery: string; candidates: CommandCandidate[] }
  | { kind: 'not_found'; targetQuery: string }
  | { kind: 'not_command' }
  | { kind: 'error'; message: string }
```

그리고 `isCommandUtterance(raw: string): boolean` (cue.ts).

- [ ] **Step 1: types.ts 작성** (위 정의 그대로, JSDoc 한 줄씩)

- [ ] **Step 2: 실패하는 큐 감지 테스트 작성**

```typescript
// tests/ai/commands-cue.test.ts
import { describe, it, expect } from 'vitest'
import { isCommandUtterance } from '@/lib/ai/commands/cue'

describe('isCommandUtterance — 쓰기 명령 게이트 (보수적)', () => {
  it.each([
    'ERP 인터페이스 설계 실적 80으로 올려줘',
    'TFT R&R 확정 완료 처리해줘',
    '킥오프 준비 완료로 바꿔줘',
    '기준정보 정제 종료일 8월 20일로 미뤄줘',
    '마스터플랜 수립 실적 50%로 변경',
  ] as const)('명령으로 감지: %s', text => {
    expect(isCommandUtterance(text)).toBe(true)
  })
  it.each([
    '지연된 작업이 뭐야?',
    '전체 프로젝트 현황 알려줘',
    '완료된 작업 목록 보여줘',       // '완료' 포함하지만 조회 — 오탐 금지
    '이번 주 작업 알려줘',
    '실적이 낮은 작업 정리해줘',      // '정리해줘'는 조회성
    "'인터페이스' 들어간 항목 찾아줘",
  ] as const)('조회로 통과: %s', text => {
    expect(isCommandUtterance(text)).toBe(false)
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/ai/commands-cue.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: cue.ts 구현**

```typescript
// src/lib/ai/commands/cue.ts
// 쓰기 명령 게이트 — 보수적: 확실한 쓰기 동사+대상이 있을 때만 true.
// 조회 질문(알려줘/보여줘/뭐야/찾아줘/목록)은 반드시 false — 오탐은 조회 경험을 깨뜨린다.

const WRITE_CUE =
  /(올려\s*줘?|바꿔\s*줘?|변경(해\s*줘?)?$|변경해|수정해\s*줘?|미뤄\s*줘?|당겨\s*줘?|완료\s*(처리|로))/
const READ_CUE = /(알려\s*줘|보여\s*줘|뭐야|뭐지|찾아\s*줘|목록|현황|정리해\s*줘|요약)/

export function isCommandUtterance(raw: string): boolean {
  const t = raw.trim()
  if (!t) return false
  if (READ_CUE.test(t)) return false
  return WRITE_CUE.test(t)
}
```

- [ ] **Step 5: 통과 확인 후 Commit**

Run: `npx vitest run tests/ai/commands-cue.test.ts` → PASS (11 tests)

```bash
git add src/lib/ai/commands/types.ts src/lib/ai/commands/cue.ts tests/ai/commands-cue.test.ts
git commit -m "feat(ai): 액션 봇 명령 타입 + 보수적 쓰기 큐 감지"
```

---

### Task 7: 명령 파싱 — 결정형 우선 + LLM 폴백 (A1-b)

**Files:**
- Create: `src/lib/ai/commands/parse.ts`
- Test: `tests/ai/commands-parse.test.ts`

**Interfaces:**
- Consumes: Task 6 타입. `generateAnswer(system: string, messages: ChatMessage[]): Promise<string | null>` — vi.mock으로 모킹.
- Produces: `parseDeterministic(raw: string): ParsedCommand | null` (순수), `extractJson(text: string): unknown | null` (순수 — 코드펜스 제거+첫 {} 블록), `validateParsed(v: unknown): ParsedCommand | null` (순수), `parseCommand(raw: string): Promise<ParsedCommand | null>` (결정형 먼저, 실패 시 LLM 1콜).

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// tests/ai/commands-parse.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai/llm', () => ({ generateAnswer: vi.fn() }))

import { generateAnswer } from '@/lib/ai/llm'
import {
  parseDeterministic, extractJson, validateParsed, parseCommand,
} from '@/lib/ai/commands/parse'

const mGen = vi.mocked(generateAnswer)

describe('parseDeterministic — LLM 없이 잡는 고빈도 패턴', () => {
  it('실적 NN(%)로/으로 + 올려/변경/바꿔', () => {
    expect(parseDeterministic('ERP 인터페이스 설계 실적 80으로 올려줘')).toEqual({
      action: 'set_actual', targetQuery: 'ERP 인터페이스 설계', actualPct: 80,
    })
  })
  it('완료 처리', () => {
    expect(parseDeterministic('TFT R&R 확정 완료 처리해줘')).toEqual({
      action: 'complete', targetQuery: 'TFT R&R 확정',
    })
  })
  it('범위 밖 실적은 null (LLM 폴백에 넘김)', () => {
    expect(parseDeterministic('설계 실적 180으로 올려줘')).toBeNull()
  })
  it('일정 변경 문장은 결정형이 안 잡는다 (날짜 해석은 LLM 몫)', () => {
    expect(parseDeterministic('기준정보 정제 종료일 8월 20일로 미뤄줘')).toBeNull()
  })
})

describe('extractJson — 관용적 JSON 추출', () => {
  it('코드펜스를 벗긴다', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })
  it('서두 문장 뒤 첫 {} 블록', () => {
    expect(extractJson('다음과 같습니다: {"a":1} 끝')).toEqual({ a: 1 })
  })
  it('JSON 없으면 null', () => {
    expect(extractJson('죄송하지만 이해하지 못했어요')).toBeNull()
  })
})

describe('validateParsed — 스키마 강제', () => {
  it('유효한 set_dates', () => {
    expect(validateParsed({
      action: 'set_dates', targetQuery: '기준정보 정제', plannedEnd: '2026-08-20',
    })).toEqual({ action: 'set_dates', targetQuery: '기준정보 정제', plannedEnd: '2026-08-20' })
  })
  it('잘못된 날짜 형식 거부', () => {
    expect(validateParsed({ action: 'set_dates', targetQuery: 'x', plannedEnd: '8월 20일' })).toBeNull()
  })
  it('실적 범위 밖 거부', () => {
    expect(validateParsed({ action: 'set_actual', targetQuery: 'x', actualPct: 101 })).toBeNull()
  })
  it('빈 targetQuery 거부', () => {
    expect(validateParsed({ action: 'complete', targetQuery: ' ' })).toBeNull()
  })
})

describe('parseCommand — 결정형 우선, LLM 폴백', () => {
  beforeEach(() => vi.clearAllMocks())
  it('결정형이 잡으면 LLM을 부르지 않는다', async () => {
    const r = await parseCommand('설계 검토 실적 60으로 변경')
    expect(r?.action).toBe('set_actual')
    expect(mGen).not.toHaveBeenCalled()
  })
  it('결정형 실패 시 LLM JSON을 검증해 반환', async () => {
    mGen.mockResolvedValue('{"action":"set_dates","targetQuery":"기준정보 정제","plannedEnd":"2026-08-20"}')
    const r = await parseCommand('기준정보 정제 종료일 8월 20일로 미뤄줘')
    expect(r).toEqual({ action: 'set_dates', targetQuery: '기준정보 정제', plannedEnd: '2026-08-20' })
  })
  it('LLM null(불능)이면 null', async () => {
    mGen.mockResolvedValue(null)
    expect(await parseCommand('기준정보 정제 종료일 미뤄줘')).toBeNull()
  })
  it('LLM이 이상한 텍스트를 내면 null (환각 방어)', async () => {
    mGen.mockResolvedValue('알겠습니다! 변경하겠습니다.')
    expect(await parseCommand('기준정보 정제 종료일 미뤄줘')).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/ai/commands-parse.test.ts` → FAIL (module not found)

- [ ] **Step 3: parse.ts 구현**

```typescript
// src/lib/ai/commands/parse.ts
// 명령 파싱 — 결정형 패턴 우선(쿼터 절약+데모 결정성), 실패 시에만 LLM 1콜.
import { generateAnswer } from '@/lib/ai/llm'
import type { CommandAction, ParsedCommand } from './types'

const ACTUAL_RE =
  /^(.+?)\s*(?:의\s*)?실적\s*(\d{1,3})\s*%?\s*(?:으로|로)\s*(?:올려|변경|바꿔|수정)/
const COMPLETE_RE = /^(.+?)\s*(?:을|를)?\s*완료\s*(?:처리|로)/

export function parseDeterministic(raw: string): ParsedCommand | null {
  const t = raw.trim()
  const m1 = ACTUAL_RE.exec(t)
  if (m1) {
    const pct = Number(m1[2])
    if (pct >= 0 && pct <= 100) {
      return { action: 'set_actual', targetQuery: m1[1].trim(), actualPct: pct }
    }
    return null // 범위 밖 — LLM이 되물을 수 있게 넘긴다
  }
  const m2 = COMPLETE_RE.exec(t)
  if (m2) return { action: 'complete', targetQuery: m2[1].trim() }
  return null
}

export function extractJson(text: string): unknown | null {
  const stripped = text.replace(/```(?:json)?/g, '').trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(stripped.slice(start, end + 1))
  } catch {
    return null
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ACTIONS: CommandAction[] = ['set_actual', 'set_dates', 'complete']

export function validateParsed(v: unknown): ParsedCommand | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const action = o.action as CommandAction
  if (!ACTIONS.includes(action)) return null
  const targetQuery = typeof o.targetQuery === 'string' ? o.targetQuery.trim() : ''
  if (!targetQuery) return null
  const out: ParsedCommand = { action, targetQuery }
  if (action === 'set_actual') {
    const pct = Number(o.actualPct)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null
    out.actualPct = pct
  }
  if (action === 'set_dates') {
    const s = o.plannedStart, e = o.plannedEnd
    if (s != null && (typeof s !== 'string' || !DATE_RE.test(s))) return null
    if (e != null && (typeof e !== 'string' || !DATE_RE.test(e))) return null
    if (s == null && e == null) return null
    if (s != null) out.plannedStart = s
    if (e != null) out.plannedEnd = e
  }
  return out
}

const PARSE_SYSTEM = `너는 WBS 명령 파서다. 사용자의 한국어 명령을 JSON 하나로만 변환한다.
스키마: {"action":"set_actual|set_dates|complete","targetQuery":"작업명 표현","actualPct":숫자?,"plannedStart":"YYYY-MM-DD"?,"plannedEnd":"YYYY-MM-DD"?}
규칙: JSON 외 텍스트 금지. 날짜는 반드시 YYYY-MM-DD (연도 불명시는 2026). 명령이 아니면 {"action":"none"}을 출력.`

export async function parseCommand(raw: string): Promise<ParsedCommand | null> {
  const det = parseDeterministic(raw)
  if (det) return det
  const text = await generateAnswer(PARSE_SYSTEM, [{ role: 'user', content: raw.trim() }])
  if (!text) return null
  return validateParsed(extractJson(text))
}
```

- [ ] **Step 4: 통과 확인 후 Commit**

Run: `npx vitest run tests/ai/commands-parse.test.ts` → PASS (15 tests)

```bash
git add src/lib/ai/commands/parse.ts tests/ai/commands-parse.test.ts
git commit -m "feat(ai): 명령 파싱 — 결정형 우선 + LLM JSON 폴백(환각 방어 검증)"
```

---

### Task 8: 대상 매칭 + 제안 생성 (A1-c)

**Files:**
- Create: `src/lib/ai/commands/match.ts`
- Create: `src/lib/ai/commands/propose.ts`
- Test: `tests/ai/commands-match.test.ts`

**Interfaces:**
- Consumes: Task 6 타입. `ComputedItem` (src/lib/domain/types.ts — children/rolledActualPct/actualPct/owners/plannedStart/plannedEnd/name).
- Produces: `collectCandidates(items: ComputedItem[]): CommandCandidate[]` (트리→리프 평탄화, phaseName 추적), `matchCandidates(query: string, all: CommandCandidate[]): CommandCandidate[]` (정규화 부분일치, 상위 5), `buildProposal(cmd: ParsedCommand, matches: CommandCandidate[]): CommandProposal` (0건→not_found, 1건→proposal+changes, 2건+→disambiguate).

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// tests/ai/commands-match.test.ts
import { describe, it, expect } from 'vitest'
import type { ComputedItem } from '@/lib/domain/types'
import { collectCandidates, matchCandidates } from '@/lib/ai/commands/match'
import { buildProposal } from '@/lib/ai/commands/propose'

const leaf = (over: Partial<ComputedItem>): ComputedItem =>
  ({
    id: 'x', parentId: null, level: 'activity', code: '', sortOrder: 0,
    name: '', biz: null, deliverable: null, plannedStart: '2026-07-01',
    plannedEnd: '2026-07-31', weight: null, actualPct: 40, owners: [],
    plannedPct: 50, rolledActualPct: 40, achievement: null,
    status: 'in_progress', children: [], ...over,
  }) as ComputedItem

const tree: ComputedItem[] = [
  leaf({
    id: 'ph1', name: '2. As-Is 분석', level: 'phase',
    children: [
      leaf({ id: 'a', name: 'ERP 인터페이스 설계', owners: [{ team: 'ERP', kind: 'primary' }] }),
      leaf({ id: 'b', name: 'ERP 인터페이스 설계 검토' }),
      leaf({ id: 'c', name: '기준정보 정제', actualPct: null, rolledActualPct: 0 }),
    ],
  }),
]

describe('collectCandidates — 리프 평탄화 + phaseName', () => {
  it('리프만 뽑고 루트 phase 이름을 단다', () => {
    const cands = collectCandidates(tree)
    expect(cands.map(c => c.id)).toEqual(['a', 'b', 'c'])
    expect(cands[0].phaseName).toBe('2. As-Is 분석')
    expect(cands[0].currentActual).toBe(40)
    expect(cands[2].currentActual).toBeNull()
  })
})

describe('matchCandidates — 정규화 부분일치', () => {
  const all = collectCandidates(tree)
  it('공백·대소문자 무시 부분일치', () => {
    expect(matchCandidates('erp인터페이스설계', all).map(c => c.id)).toEqual(['a', 'b'])
  })
  it('정확 일치가 있으면 그것만', () => {
    expect(matchCandidates('ERP 인터페이스 설계', all).map(c => c.id)).toEqual(['a'])
  })
  it('0건', () => {
    expect(matchCandidates('없는 작업', all)).toEqual([])
  })
})

describe('buildProposal — 제안/되묻기/못찾음', () => {
  const all = collectCandidates(tree)
  it('1건 매칭 → proposal + before/after 변경 요약', () => {
    const p = buildProposal(
      { action: 'set_actual', targetQuery: 'ERP 인터페이스 설계', actualPct: 80 },
      matchCandidates('ERP 인터페이스 설계', all),
    )
    expect(p.kind).toBe('proposal')
    if (p.kind === 'proposal') {
      expect(p.target.id).toBe('a')
      expect(p.params).toEqual({ actualPct: 80 })
      expect(p.changes).toEqual([
        { field: 'actual_pct', label: '실적', before: '40%', after: '80%' },
      ])
    }
  })
  it('complete는 실적 100 변경으로 표현', () => {
    const p = buildProposal(
      { action: 'complete', targetQuery: '기준정보 정제' },
      matchCandidates('기준정보 정제', all),
    )
    if (p.kind === 'proposal') {
      expect(p.params).toEqual({ actualPct: 100 }) // complete = 실적 100 (전용 액션 없음)
      expect(p.changes[0]).toEqual({ field: 'actual_pct', label: '실적', before: '0%', after: '100%' })
    } else {
      throw new Error('proposal이어야 함')
    }
  })
  it('다건 → disambiguate', () => {
    const p = buildProposal(
      { action: 'set_actual', targetQuery: 'erp인터페이스설계', actualPct: 80 },
      matchCandidates('erp인터페이스설계', all),
    )
    expect(p.kind).toBe('disambiguate')
  })
  it('0건 → not_found', () => {
    expect(buildProposal({ action: 'complete', targetQuery: '없음' }, []).kind).toBe('not_found')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/ai/commands-match.test.ts` → FAIL

- [ ] **Step 3: match.ts + propose.ts 구현**

```typescript
// src/lib/ai/commands/match.ts
import type { ComputedItem } from '@/lib/domain/types'
import type { CommandCandidate } from './types'

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')

export function collectCandidates(items: ComputedItem[]): CommandCandidate[] {
  const out: CommandCandidate[] = []
  const walk = (nodes: ComputedItem[], phaseName: string) => {
    for (const n of nodes) {
      const ph = n.level === 'phase' ? n.name : phaseName
      if (n.children.length) {
        walk(n.children, ph)
      } else {
        out.push({
          id: n.id,
          name: n.name,
          phaseName: ph,
          ownersText: n.owners.map(o => o.team).join('·') || '미배정',
          currentActual: n.actualPct,
          displayActual: Math.round(n.rolledActualPct),
          plannedStart: n.plannedStart,
          plannedEnd: n.plannedEnd,
        })
      }
    }
  }
  walk(items, '')
  return out
}

export function matchCandidates(query: string, all: CommandCandidate[]): CommandCandidate[] {
  const q = norm(query)
  if (!q) return []
  const exact = all.filter(c => norm(c.name) === q)
  if (exact.length) return exact.slice(0, 5)
  return all.filter(c => norm(c.name).includes(q) || q.includes(norm(c.name))).slice(0, 5)
}
```

```typescript
// src/lib/ai/commands/propose.ts
import type { CommandCandidate, CommandProposal, ParsedCommand } from './types'

const fmtDate = (d: string | null) => d ?? '미정'

export function buildProposal(cmd: ParsedCommand, matches: CommandCandidate[]): CommandProposal {
  if (!matches.length) return { kind: 'not_found', targetQuery: cmd.targetQuery }
  if (matches.length > 1) return { kind: 'disambiguate', targetQuery: cmd.targetQuery, candidates: matches }
  const target = matches[0]
  const changes: Extract<CommandProposal, { kind: 'proposal' }>['changes'] = []
  const params: Extract<CommandProposal, { kind: 'proposal' }>['params'] = {}
  if (cmd.action === 'set_actual' || cmd.action === 'complete') {
    const after = cmd.action === 'complete' ? 100 : (cmd.actualPct as number)
    params.actualPct = after
    changes.push({
      field: 'actual_pct', label: '실적',
      before: `${target.displayActual}%`, after: `${after}%`,
    })
  }
  if (cmd.action === 'set_dates') {
    if (cmd.plannedStart !== undefined) {
      params.plannedStart = cmd.plannedStart
      changes.push({ field: 'planned_start', label: '시작일', before: fmtDate(target.plannedStart), after: fmtDate(cmd.plannedStart) })
    }
    if (cmd.plannedEnd !== undefined) {
      params.plannedEnd = cmd.plannedEnd
      changes.push({ field: 'planned_end', label: '종료일', before: fmtDate(target.plannedEnd), after: fmtDate(cmd.plannedEnd) })
    }
  }
  return { kind: 'proposal', action: cmd.action, target, params, changes }
}
```

- [ ] **Step 4: 통과 확인 후 Commit**

Run: `npx vitest run tests/ai/commands-match.test.ts` → PASS (8 tests)

```bash
git add src/lib/ai/commands/match.ts src/lib/ai/commands/propose.ts tests/ai/commands-match.test.ts
git commit -m "feat(ai): 명령 대상 매칭(리프 평탄화·정규화 일치) + 확인 카드 제안 생성"
```

---

### Task 9: 명령 파이프라인 + API 라우트 (A1-d)

**Files:**
- Create: `src/lib/ai/commands/pipeline.ts`
- Create: `src/app/api/chat/command/route.ts`
- Test: `tests/ai/commands-pipeline.test.ts`

**Interfaces:**
- Consumes: Tasks 6-8 전부. `getComputedWbs(projectId): Promise<{ items: ComputedItem[]; holidays: string[]; today: string }>` (src/lib/data/wbs.ts:11). 세션 확인은 기존 스트림 라우트(src/app/api/chat/stream/route.ts) 패턴 복사.
- Produces: `runCommandPipeline(message: string, items: ComputedItem[], targetId?: string): Promise<CommandProposal>` — 라우트와 테스트가 공유하는 오케스트레이터. `POST /api/chat/command` — req `{ projectId: string, message: string, targetId?: string }` → res 200 `CommandProposal` JSON | 401 `{ error }` | 400 `{ error }`.

- [ ] **Step 1: 실패하는 파이프라인 테스트 작성**

```typescript
// tests/ai/commands-pipeline.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai/llm', () => ({ generateAnswer: vi.fn() }))

import { generateAnswer } from '@/lib/ai/llm'
import { runCommandPipeline } from '@/lib/ai/commands/pipeline'
import type { ComputedItem } from '@/lib/domain/types'

const mGen = vi.mocked(generateAnswer)

const leaf = (over: Partial<ComputedItem>): ComputedItem =>
  ({
    id: 'x', parentId: null, level: 'activity', code: '', sortOrder: 0,
    name: '', biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
    weight: null, actualPct: 40, owners: [], plannedPct: 50, rolledActualPct: 40,
    achievement: null, status: 'in_progress', children: [], ...over,
  }) as ComputedItem

const items = [leaf({ id: 'a', name: 'ERP 인터페이스 설계' })]

describe('runCommandPipeline — 큐→파싱→매칭→제안', () => {
  beforeEach(() => vi.clearAllMocks())
  it('조회 문장은 not_command (LLM 미호출)', async () => {
    const r = await runCommandPipeline('지연된 작업이 뭐야?', items)
    expect(r.kind).toBe('not_command')
    expect(mGen).not.toHaveBeenCalled()
  })
  it('결정형 명령 → proposal (LLM 미호출)', async () => {
    const r = await runCommandPipeline('ERP 인터페이스 설계 실적 80으로 올려줘', items)
    expect(r.kind).toBe('proposal')
    expect(mGen).not.toHaveBeenCalled()
  })
  it('targetId 지정 시 매칭을 건너뛰고 해당 항목으로 제안 (되묻기 후속)', async () => {
    const r = await runCommandPipeline('ERP 인터페이스 설계 실적 80으로 올려줘', items, 'a')
    expect(r.kind).toBe('proposal')
    if (r.kind === 'proposal') expect(r.target.id).toBe('a')
  })
  it('파싱 불능(LLM null) → error 안내', async () => {
    mGen.mockResolvedValue(null)
    const r = await runCommandPipeline('기준정보 종료일 미뤄줘', items)
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toContain('명령을 이해하지 못했어요')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/ai/commands-pipeline.test.ts` → FAIL

- [ ] **Step 3: pipeline.ts 구현**

```typescript
// src/lib/ai/commands/pipeline.ts
import type { ComputedItem } from '@/lib/domain/types'
import type { CommandProposal } from './types'
import { isCommandUtterance } from './cue'
import { parseCommand } from './parse'
import { collectCandidates, matchCandidates } from './match'
import { buildProposal } from './propose'

export async function runCommandPipeline(
  message: string,
  items: ComputedItem[],
  targetId?: string,
): Promise<CommandProposal> {
  if (!isCommandUtterance(message)) return { kind: 'not_command' }
  const cmd = await parseCommand(message)
  if (!cmd) {
    return {
      kind: 'error',
      message: '명령을 이해하지 못했어요. 예: "ERP 인터페이스 설계 실적 80으로 올려줘"',
    }
  }
  const all = collectCandidates(items)
  const matches = targetId ? all.filter(c => c.id === targetId) : matchCandidates(cmd.targetQuery, all)
  return buildProposal(cmd, matches)
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/ai/commands-pipeline.test.ts` → PASS (4 tests)

- [ ] **Step 5: 라우트 작성** (얇은 접착층 — 스트림 라우트의 세션 패턴 복사)

```typescript
// src/app/api/chat/command/route.ts
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getComputedWbs } from '@/lib/data/wbs'
import { runCommandPipeline } from '@/lib/ai/commands/pipeline'

export async function POST(req: Request) {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    projectId?: unknown; message?: unknown; targetId?: unknown
  }
  const projectId = typeof body.projectId === 'string' ? body.projectId : null
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const targetId = typeof body.targetId === 'string' ? body.targetId : undefined
  if (!message || message.length > 2000) {
    return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 })
  }
  if (!projectId) {
    return NextResponse.json({
      kind: 'error', message: '프로젝트 화면에서만 명령을 사용할 수 있어요.',
    })
  }
  const { items } = await getComputedWbs(projectId)
  const proposal = await runCommandPipeline(message, items, targetId)
  return NextResponse.json(proposal)
}
```

- [ ] **Step 6: 빌드·린트 확인 후 Commit**

```bash
npm run lint && npm run build
git add src/lib/ai/commands/pipeline.ts src/app/api/chat/command/route.ts tests/ai/commands-pipeline.test.ts
git commit -m "feat(ai): 명령 파이프라인 오케스트레이터 + /api/chat/command 라우트"
```

---

### Task 10: DkBot 확인 카드 UI + 적용 배선 (A1-e)

**Files:**
- Modify: `src/components/chat/DkBot.tsx` (Msg 확장, send 분기, ProposalCard, 적용 핸들러)

**Interfaces:**
- Consumes: `CommandProposal`/`CommandCandidate` 타입(Task 6), `isCommandUtterance`(Task 6 — 클라이언트 번들 안전한 순수 함수), `POST /api/chat/command`(Task 9), 서버 액션 `updateActual(itemId, newPct, expectedCurrent?)` / `updateWbsFields(itemId, fields)` (src/app/actions/wbs.ts — 클라이언트에서 직접 호출 가능). `useRouter` from 'next/navigation' (refresh용).
- Produces: 없음 (최종 소비자). 기존 스트리밍 경로는 무변경 — 명령 큐 미감지 시 기존 동작 그대로.

- [ ] **Step 1: Msg 타입 확장 + import 추가** (DkBot.tsx:11-16 근방)

```typescript
import { useRouter } from 'next/navigation'
import { isCommandUtterance } from '@/lib/ai/commands/cue'
import type { CommandProposal, CommandCandidate } from '@/lib/ai/commands/types'
import { updateActual, updateWbsFields } from '@/app/actions/wbs'

interface Msg {
  id: number
  role: Role
  content: string
  proposal?: CommandProposal      // 있으면 Bubble 대신 ProposalCard 렌더
  proposalState?: 'pending' | 'applied' | 'cancelled'
}
```

- [ ] **Step 2: send()에 명령 분기 추가** — 기존 send 함수(DkBot.tsx:133) 첫머리, 유저 버블 push + clearInput() 이후 스트림 fetch 이전에 삽입. genRef 세대 가드 패턴 동일 적용:

먼저 명령 fetch를 공용 함수로 추출한다 (send 분기와 되묻기 후속이 공유 — 중복 금지):

```typescript
// 명령 제안 요청 — send()의 명령 분기와 후보 칩 선택(pickCandidate)이 공유
const requestProposal = useCallback(
  async (message: string, targetId?: string) => {
    const gen = genRef.current
    setLoading(true)
    try {
      const res = await fetch('/api/chat/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: currentProjectId, message, targetId }),
      })
      const proposal = (await res.json()) as CommandProposal
      if (genRef.current !== gen) return 'stale' as const
      if (proposal.kind === 'not_command') return 'not_command' as const
      const content =
        proposal.kind === 'proposal' ? '변경 내용을 확인해 주세요:'
        : proposal.kind === 'disambiguate' ? '어떤 작업인지 골라 주세요:'
        : proposal.kind === 'not_found' ? `"${proposal.targetQuery}" 작업을 찾지 못했어요. 작업명을 더 정확히 말해 주세요.`
        : proposal.message
      setMessages(prev => [...prev, {
        id: nextId(), role: 'assistant', content,
        ...(proposal.kind === 'proposal' || proposal.kind === 'disambiguate'
          ? { proposal, proposalState: 'pending' as const } : {}),
      }])
      return 'handled' as const
    } catch {
      if (genRef.current !== gen) return 'stale' as const
      return 'not_command' as const // 명령 경로 실패 → 호출부가 스트리밍으로 폴백
    } finally {
      if (genRef.current === gen) setLoading(false) // ← 로딩 고착 방지 (stale이면 다른 세대 소유)
    }
  },
  [currentProjectId],
)
```

send()에는 유저 버블 push + clearInput() 직후, 기존 `setLoading(true)`/스트림 fetch 이전에 분기만 넣는다:

```typescript
if (isCommandUtterance(text)) {
  lastCommandRef.current = text
  const outcome = await requestProposal(text)
  if (outcome !== 'not_command') return // handled/stale — 스트리밍 경로 미진입
  // not_command → 아래 기존 스트리밍 경로 그대로 계속
}
```

- [ ] **Step 3: ProposalCard 컴포넌트 추가** (파일 하단, Bubble 옆) — 기존 칩·버블 클래스 관례 준수:

```tsx
function ProposalCard({
  msg, onApply, onPick, onCancel,
}: {
  msg: Msg
  onApply: (msgId: number, p: Extract<CommandProposal, { kind: 'proposal' }>) => void
  onPick: (c: CommandCandidate) => void
  onCancel: (msgId: number) => void
}) {
  const p = msg.proposal
  if (!p || (p.kind !== 'proposal' && p.kind !== 'disambiguate')) return null
  const disabled = msg.proposalState !== 'pending'
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] rounded-2xl rounded-bl-md border border-brand-ring/30 bg-brand-weak/50 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
        {p.kind === 'proposal' ? (
          <>
            <div className="font-medium">{p.target.name}</div>
            <div className="mt-0.5 text-[12px] text-ink-muted">
              [{p.target.phaseName}] · 담당 {p.target.ownersText}
            </div>
            <ul className="mt-1.5 space-y-0.5">
              {p.changes.map(c => (
                <li key={c.field}>
                  {c.label}: <span className="line-through opacity-60">{c.before}</span>
                  {' → '}<span className="font-semibold text-brand">{c.after}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-1.5">
              <button
                onClick={() => onApply(msg.id, p)}
                disabled={disabled}
                className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
              >
                적용
              </button>
              <button
                onClick={() => onCancel(msg.id)}
                disabled={disabled}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-muted transition hover:border-brand-ring disabled:opacity-50"
              >
                취소
              </button>
            </div>
            {msg.proposalState === 'applied' && <div className="mt-1.5 text-[12px] text-ink-subtle">적용됨</div>}
            {msg.proposalState === 'cancelled' && <div className="mt-1.5 text-[12px] text-ink-subtle">취소됨</div>}
          </>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {p.candidates.map(c => (
              <button
                key={c.id}
                onClick={() => onPick(c)}
                disabled={disabled}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink-muted transition hover:border-brand-ring hover:text-brand disabled:opacity-50"
              >
                {c.name} <span className="opacity-60">({c.phaseName})</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 적용/선택/취소 핸들러** (DkBot 본문):

```typescript
const router = useRouter()
const lastCommandRef = useRef<string>('') // disambiguate 후속용 원문 보관

// send()의 명령 분기에서 fetch 직전에: lastCommandRef.current = text

const applyProposal = useCallback(
  async (msgId: number, p: Extract<CommandProposal, { kind: 'proposal' }>) => {
    const mark = (state: 'applied' | 'cancelled') =>
      setMessages(prev => prev.map(m => (m.id === msgId ? { ...m, proposalState: state } : m)))
    const say = (content: string) =>
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content }])
    // 원시 params 사용 — 표시 문자열('80%', '미정') 역파싱 금지
    const result = p.params.actualPct !== undefined
      ? await updateActual(p.target.id, p.params.actualPct, p.target.currentActual)
      : await updateWbsFields(p.target.id, {
          ...(p.params.plannedStart !== undefined ? { plannedStart: p.params.plannedStart } : {}),
          ...(p.params.plannedEnd !== undefined ? { plannedEnd: p.params.plannedEnd } : {}),
        })
    if (result.ok) {
      mark('applied')
      say(`✓ 변경했어요. ${p.target.name} — ${p.changes.map(c => `${c.label} ${c.after}`).join(', ')}`)
      router.refresh()
    } else {
      mark('cancelled')
      say(`변경하지 못했어요: ${result.error ?? '알 수 없는 오류'}`) // 서버 액션의 한국어 에러 그대로 — AI도 권한을 우회하지 못한다
    }
  },
  [router],
)

const pickCandidate = useCallback((c: CommandCandidate) => {
  // 되묻기 후속: 같은 명령 원문 + targetId 재요청 (requestProposal 재사용)
  void requestProposal(lastCommandRef.current, c.id)
}, [requestProposal])

const cancelProposal = useCallback((msgId: number) => {
  setMessages(prev => prev.map(m => (m.id === msgId ? { ...m, proposalState: 'cancelled' } : m)))
}, [])
```

적용 중 이중 클릭은 updateActual의 낙관적 잠금(expectedCurrent)이 뒷단에서 방어한다 — 두 번째 호출은 no-op({ok:true}) 또는 conflict로 무해.

- [ ] **Step 5: 렌더 분기** — 메시지 맵 렌더(기존 Bubble 호출부)에서:

```tsx
{messages.map(m =>
  m.proposal ? (
    <div key={m.id} className="space-y-1.5">
      <Bubble role="assistant" content={m.content} />
      <ProposalCard msg={m} onApply={applyProposal} onPick={pickCandidate} onCancel={cancelProposal} />
    </div>
  ) : (
    <Bubble key={m.id} role={m.role} content={m.content} />
  ),
)}
```

- [ ] **Step 6: 인사말 카피 정리** (스펙 5-1 실화면 리스크 메모) — 봇 환영 메시지의 "전체 N개 프로젝트에 대해서도 질문할 수 있습니다"가 N=1일 때 어색. 환영 문구 생성부(컨텍스트 로드 효과 내 welcome 메시지)에서 totalProjects가 1이면 "이 프로젝트에 대해 무엇이든 질문하세요"로, 2 이상이면 기존 문구 유지. 명령 기능 추가에 맞춰 예시 한 줄 추가: "실적 변경 같은 명령도 할 수 있어요 — 예: \"○○ 실적 80으로 올려줘\"".

- [ ] **Step 7: 수동 검증 시나리오 + 전체 게이트**

```bash
npm test && npm run lint && npm run build
```

이후 `npm run dev`로 로컬 확인 (샌드박스는 curl 검증 — verify 스킬 참조).
**시나리오 2–5는 반드시 전용 테스트 프로젝트("액션봇 테스트")에서 실행 — D-CUBE 항목 대상 [적용] 금지 (Global Constraints 참조. 로컬 dev도 프로덕션 Supabase 공유):**
1. 프로젝트 화면에서 봇 열기 → "지연된 작업이 뭐야?" → 기존 스트리밍 답변 (회귀 없음, 조회는 아무 프로젝트나 무해)
2. 테스트 프로젝트 항목명으로 "○○ 실적 80으로 올려줘" → 확인 카드 (현재% → 80%)
3. [적용] → 성공 버블 + WBS 시트 새로고침 시 반영 + 행 상세 변경 이력에 기록
4. 모호한 이름 → 후보 칩 → 선택 → 카드 → 적용
5. team_editor 계정으로 타팀 작업 명령 → '담당 작업이 아님' 에러 버블 (권한 데모 포인트)

- [ ] **Step 8: Commit**

```bash
git add src/components/chat/DkBot.tsx
git commit -m "feat(chat): DK Bot 확인 카드 — 자연어 명령을 제안→승인→기존 서버 액션으로 실행"
```

---

### Task 11: 통합 검증 + 배포

**Files:** 없음 (검증 전용)

**Interfaces:**
- Consumes: Tasks 1-10 전체.
- Produces: 프로덕션 배포된 1–2주차 결과물.

- [ ] **Step 1: 전체 게이트**

```bash
npm test && npm run lint && npm run build
```

Expected: 테스트 ~700개 전부 PASS (기존 662 + 신규 ~47), 린트 0 에러, 빌드 성공.

- [ ] **Step 2: 실명 파일 부재 최종 확인**

```bash
git ls-files docs/ | grep -i "xlsx\|pptx" ; echo "exit=$?"
```

Expected: exit=1 (0건).

- [ ] **Step 3: 배포** — `/deploy` 스킬 사용 (push만으로 Vercel 자동 배포 — `vercel --prod` 중복 실행 금지).

- [ ] **Step 4: 프로덕션 스모크** — wbs-web.vercel.app에서 Task 10 Step 7 시나리오 1-3 재확인. 시나리오 1(조회)은 아무 프로젝트나 무해, 시나리오 2-3(카드+적용)은 **전용 테스트 프로젝트에서만** — D-CUBE 대상 [적용] 금지. RPM 여유를 위해 명령은 결정형 패턴(실적 변경) 위주로 확인. 비로그인 게이트는 curl로 확인(/api/chat/command 401).

- [ ] **Step 5: 측정 시작** — docs/superpowers/measurements.md 로그 표에 첫 실사용 기록 시작 (지표 #2: 이번 배포로 "봇 명령→WBS 반영" 시간 측정 가능해짐).
