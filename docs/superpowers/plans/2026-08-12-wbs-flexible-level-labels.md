# WBS 구분(레벨 라벨) 유연화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WBS 구분 어휘를 프로젝트마다 다르게 — 엑셀로 올리면 그 엑셀의 계층 열 헤더가 구분이 되고, 직접 작성하면 기본 4단 `PHASE · TASK · ACT · SUB-ACT` 를 갖게 한다.

**Architecture:** 이미 있는 `project_settings.level_labels`(0058)를 그대로 저장소로 쓰고 **마이그레이션 없이** 쓰기 경로 셋(임포트 · 설정 편집 · 프로젝트 생성 시드)만 연다. 세 경로는 전부 신규 순수 모듈 `src/lib/domain/levelLabels.ts` 의 검증 관문을 통과하고, `getProjectConfig` 가 2차 방어선이 된다. 배지 렌더링 코드는 손대지 않는다 — 기본 라벨을 대문자 원문으로 저장하면 `levelBadgeText` 의 원문 폴백 경로를 타서 기존 표기가 그대로 나온다.

**Tech Stack:** Next.js 15 (App Router) · TypeScript (strict) · Supabase (PostgREST + service_role) · SheetJS(`xlsx`) · vitest · Tailwind v4

**설계 정본:** [`docs/superpowers/specs/2026-08-12-wbs-flexible-level-labels-design.md`](../specs/2026-08-12-wbs-flexible-level-labels-design.md) — 아래 `§n` 은 전부 그 문서의 절 번호다.

## Global Constraints

이 절의 제약은 **모든 태스크에 암묵적으로 포함**된다.

- **마이그레이션 0건.** `supabase/migrations/` 에 파일을 추가하지 않는다. DB 스키마·제약·RLS 를 바꾸지 않는다(§1).
- **`src/components/wbs/shared.tsx` 를 수정하지 않는다.** 배지 로직은 이 계획의 대상이 아니다(§3). 전 WBS 화면에 영향을 주면서 빌드·린트·테스트로 깨짐이 잡히지 않는 파일이다.
- **`weekly.ts` · `analytics.ts` 의 클램프를 바꾸지 않는다**(§7). 폴백으로 통일하면 D-CUBE 주간보고·임베딩 산출물의 바이트가 바뀐다.
- **`PRESETS.pi` 를 수정하지 않는다.** 신규 키만 추가한다(§1). `tests/domain/project-presets.test.ts:6-9` 가 D-CUBE 현행의 유일한 감시선이다.
- **`DEFAULT_PROJECT_CONFIG.levelLabels` 와 `DEFAULT_LEVEL_LABELS` 의 값 `['Phase','Task','Activity']` 를 바꾸지 않는다.** 설정 행이 없는 비정상 프로젝트 전용 폴백이고 D-CUBE 값과 같아야 회귀 0이다.
- **임포트 라벨 반영 체크박스의 기본값은 꺼짐**이다(§5·§11-2). 켜짐으로 바꾸지 않는다.
- **기본 프리셋 라벨은 대문자** `['PHASE','TASK','ACT','SUB-ACT']` 다(§1·L4).
- **`project_settings` 쓰기는 반드시 `createAdminClient()`** — 0058 은 `authenticated:SELECT / service_role:ALL` 이라 일반 클라이언트로는 RLS 이전에 테이블 권한에서 거부된다(§10-c).
- **`project_settings` 쓰기는 `upsert(..., { onConflict: 'project_id' })`** — `update().eq()` 는 행이 없을 때 error 없이 0행을 돌려주어 무증상 실패한다.
- **`updated_at` · `updated_by` 를 앱이 직접 채운다** — updated_at 트리거가 전 마이그레이션에 0건이고 `default now()` 는 INSERT 에서만 발동한다.
- **`project_settings` 에 INSERT 하는 모든 경로는 `level_labels` 를 명시한다** — DB default 가 여전히 3단(`array['Phase','Task','Activity']`)이라 생략하면 조용히 3단이 된다(§1).
- **커밋 규칙(CLAUDE.md):** `git add -A` 금지 — 항상 파일명을 명시한다. 커밋 메시지는 한국어로, "무엇"보다 "왜".
- **i18n:** `ko`/`en` 을 **같은 커밋에서** 추가한다. `en` 은 `Record<keyof ko, string>` 이라 누락이 컴파일 에러가 되지만, vitest 는 타입체크를 하지 않으므로 **검증은 `npm run build`** 다(§10-6).

## File Structure

**신규 4**

| 파일 | 책임 |
|---|---|
| `src/lib/domain/levelLabels.ts` | 라벨 검증·제안·병합 순수함수 3종. 세 쓰기 경로의 단일 관문. i18n·DB 를 모른다 |
| `src/lib/excel/headers.ts` | 업로드 워크북에서 계층 열 헤더만 재유도. `parseWithProfile` 과 **동일한** `sheet_to_json` 옵션을 쓰는 것이 존재 이유 |
| `src/app/actions/projectSettings.ts` | `updateLevelLabels` 서버 액션 — 가드·정규화·admin upsert·재색인 |
| `src/components/settings/LevelLabelsManager.tsx` | 구분 라벨 편집 UI |

**수정 11** — `projectPresets.ts`(신규 키) · `actions/project.ts`(시드) · `data/projectConfig.ts`(방어 정규화) · `domain/importWizard.ts`(리듀서 상태) · `components/import/ImportWizard.tsx`(체크박스·대비·완료 표시) · `import/page.tsx`(현재 라벨 공급) · `api/import/execute/route.ts`(재유도·단일 upsert) · `settings/page.tsx`(섹션 삽입) · `excel/exportWithProfile.ts`(라벨 주입) · `api/export/route.ts`(라벨 전달) · `i18n/dict/{settings,importWizard}.ts`

> 설계 §9 의 목록보다 두 파일이 많다. `import/page.tsx` 는 리뷰 단계의 '현재 → 제안' 대비에 쓸 현재 라벨의 공급원이고, `api/export/route.ts` 는 Task 8 이 주입하는 라벨의 전달자다. 둘 다 없으면 컴파일되지 않는다 — 설계 검토 때 놓친 것이라 여기서 명시적으로 편입한다.

**태스크 의존 순서** — 1·2 가 3~8 의 관문을 만들고, 3 이 없으면 5 가 `PRESETS.standard4` 를 참조할 수 없다.

```
1 순수함수 ─┬─→ 5 임포트 라우트 ─→ 6 마법사 UI
2 헤더 재유도 ┘        ↑
3 프리셋·시드 ────────┘
4 설정 로더 방어
                       └─→ 7 설정 편집 UI
8 내보내기 라벨 주입 (1 에만 의존)
9 최종 게이트 (전부)
```

---

### Task 1: 구분 라벨 순수 도메인 함수

라벨을 저장하는 세 경로가 전부 통과할 검증 관문을 먼저 만든다. `project_settings.level_labels` 에는
길이·원소 CHECK 가 0건이라(마이그레이션 0건을 택한 대가) **애플리케이션이 유일한 관문**이다(§4).

**Files:**
- Create: `src/lib/domain/levelLabels.ts`
- Test: `tests/domain/level-labels.test.ts`

**Interfaces:**
- Consumes: `ExcelProfile`(`@/lib/excel/profile`) — 기존 타입, 변경 없음
- Produces:
  - `normalizeLevelLabels(labels: string[]): { ok: true; labels: string[] } | { ok: false; reason: string }`
  - `proposeLevelLabels(headers: (string|null|undefined)[], profile: ExcelProfile): string[] | null`
  - `mergeLevelLabels(derived: string[], existing: string[]): string[]`
  - `MAX_LEVEL_LABELS = 8` · `MAX_LEVEL_LABEL_LEN = 12`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/domain/level-labels.test.ts` 를 만든다. `LEGACY_DCUBE_PROFILE` 은 `@/lib/excel/profile` 이
이미 export 하는 상수이고 계층 열이 `[1,2,3]` 이다 — 헤더 0번은 분류축이라 제안 대상이 아니다.

> 스펙 §12 '단위(순수함수)' 의 levelLabels 케이스 전부 + 경계값(정확히 8개/12자 통과) + 열 범위 밖 케이스. 실행 실측: 20 tests passed (vitest 4.1.9). 상한 상수를 테스트가 하드코딩하지 않고 모듈에서 import 하므로 값이 바뀌면 제목까지 따라간다.

```typescript
import { describe, expect, it } from 'vitest'
import { LEGACY_DCUBE_PROFILE, type ExcelProfile } from '@/lib/excel/profile'
import {
  normalizeLevelLabels, proposeLevelLabels, mergeLevelLabels,
  MAX_LEVEL_LABELS, MAX_LEVEL_LABEL_LEN,
} from '@/lib/domain/levelLabels'

/** 계층 열 = [1,2,3] (D-CUBE 3열 규약). 헤더 0번은 분류축이라 제안 대상이 아니다. */
const COLUMNS_PROFILE = LEGACY_DCUBE_PROFILE
const OUTLINE_PROFILE: ExcelProfile = { ...LEGACY_DCUBE_PROFILE, hierarchy: { kind: 'outline', column: 1 } }

describe('normalizeLevelLabels — 세 경로의 단일 검증 관문(§2·§4)', () => {
  it('정상 통과 + 앞뒤 공백 제거', () => {
    expect(normalizeLevelLabels([' PHASE ', 'TASK', 'ACT', 'SUB-ACT'])).toEqual({
      ok: true, labels: ['PHASE', 'TASK', 'ACT', 'SUB-ACT'],
    })
  })

  it('빈 배열 거부(클램프 인덱스 -1 → 주간보고·RAG 에 undefined 박힘)', () => {
    const r = normalizeLevelLabels([])
    expect(r.ok).toBe(false)
  })

  it('빈 문자열 원소 거부(?? 폴백을 통과해 배지가 빈칸이 된다)', () => {
    expect(normalizeLevelLabels(['PHASE', '']).ok).toBe(false)
  })

  it('공백만 있는 원소 거부', () => {
    expect(normalizeLevelLabels(['PHASE', '   ']).ok).toBe(false)
  })

  it(`${MAX_LEVEL_LABELS}개 초과 거부`, () => {
    const eight = Array.from({ length: MAX_LEVEL_LABELS }, (_, i) => `L${i}`)
    expect(normalizeLevelLabels(eight).ok).toBe(true)
    expect(normalizeLevelLabels([...eight, 'L8']).ok).toBe(false)
  })

  it(`원소 ${MAX_LEVEL_LABEL_LEN}자 초과 거부(구분 열 60px 고정 — 배지 잘림)`, () => {
    expect(normalizeLevelLabels(['A'.repeat(MAX_LEVEL_LABEL_LEN)]).ok).toBe(true)
    expect(normalizeLevelLabels(['A'.repeat(MAX_LEVEL_LABEL_LEN + 1)]).ok).toBe(false)
  })

  it('trim 후 길이로 판정한다(공백만 긴 라벨은 거부 사유가 길이가 아니라 빈 값)', () => {
    expect(normalizeLevelLabels([` ${'A'.repeat(MAX_LEVEL_LABEL_LEN)} `])).toEqual({
      ok: true, labels: ['A'.repeat(MAX_LEVEL_LABEL_LEN)],
    })
  })

  it('중복 라벨은 허용한다(사람이 의도할 수 있고 해로운 값이 아니다)', () => {
    expect(normalizeLevelLabels(['작업', '작업'])).toEqual({ ok: true, labels: ['작업', '작업'] })
  })

  it('거부 시 사유 문자열을 준다(표시 = 로깅 — 조용히 삼키지 않는다)', () => {
    const r = normalizeLevelLabels([])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0)
  })
})

describe('proposeLevelLabels — 엑셀 계층 헤더 → 제안(확신 없으면 null)', () => {
  it('정상 3열 — hierarchy.columns 순서대로 뽑고 trim 한다', () => {
    expect(proposeLevelLabels(['Biz', ' 대분류 ', '중분류', '소분류'], COLUMNS_PROFILE))
      .toEqual(['대분류', '중분류', '소분류'])
  })

  it('outline 프로파일이면 null(레벨별 헤더라는 것이 없다)', () => {
    expect(proposeLevelLabels(['Biz', '코드', '이름'], OUTLINE_PROFILE)).toBeNull()
  })

  it('빈 헤더가 있으면 null(병합 셀 양식에서 연속 셀이 null 로 읽힌다)', () => {
    expect(proposeLevelLabels(['Biz', '대분류', '', '소분류'], COLUMNS_PROFILE)).toBeNull()
    expect(proposeLevelLabels(['Biz', '대분류', '  ', '소분류'], COLUMNS_PROFILE)).toBeNull()
    expect(proposeLevelLabels(['Biz', '대분류', null, '소분류'], COLUMNS_PROFILE)).toBeNull()
  })

  it('계층 열이 헤더 범위 밖이면 null', () => {
    expect(proposeLevelLabels(['Biz', '대분류'], COLUMNS_PROFILE)).toBeNull()
  })

  it('중복 헤더가 있으면 null', () => {
    expect(proposeLevelLabels(['Biz', '대분류', '대분류', '소분류'], COLUMNS_PROFILE)).toBeNull()
  })

  it('시스템 생성 헤더 Level{n} 이면 null(§8 왕복 방지)', () => {
    expect(proposeLevelLabels(['Biz', 'Level1', 'Level2', 'Level3'], COLUMNS_PROFILE)).toBeNull()
  })

  it("'세부업무' 헤더면 null(내보내기 삽입 열 — 되임포트로 라벨이 되돌아간다)", () => {
    expect(proposeLevelLabels(['Biz', '대분류', '중분류', '세부업무'], COLUMNS_PROFILE)).toBeNull()
  })
})

describe('mergeLevelLabels — 뒤쪽 기존 라벨 보존', () => {
  it('3개 제안 + 4개 기존 → 4번째가 살아남는다', () => {
    expect(mergeLevelLabels(['대분류', '중분류', '소분류'], ['PHASE', 'TASK', 'ACT', 'SUB-ACT']))
      .toEqual(['대분류', '중분류', '소분류', 'SUB-ACT'])
  })

  it('1개 제안(감지 실패 폴백·계층 방식 전환) → 나머지 3개 보존', () => {
    expect(mergeLevelLabels(['업무'], ['PHASE', 'TASK', 'ACT', 'SUB-ACT']))
      .toEqual(['업무', 'TASK', 'ACT', 'SUB-ACT'])
  })

  it('동일 길이 → 전량 치환', () => {
    expect(mergeLevelLabels(['대', '중', '소'], ['Phase', 'Task', 'Activity']))
      .toEqual(['대', '중', '소'])
  })

  it('제안이 기존보다 길면 늘어난다(축소는 수동 편집에서만)', () => {
    expect(mergeLevelLabels(['대', '중', '소', '세'], ['Phase', 'Task', 'Activity']))
      .toEqual(['대', '중', '소', '세'])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/domain/level-labels.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/levelLabels"`

- [ ] **Step 3: 구현한다**

> 스펙 §2 의 3함수. 실검증 완료 — 리포에 임시 배치해 `npx vitest run tests/domain/level-labels.test.ts` 20/20 통과, `npx tsc --noEmit` 이 파일 관련 오류 0건, `npx eslint` 무경고. 검증 후 임시 파일은 제거해 리포는 원상태다. 설계 준수: shared.tsx 무접촉, 마이그레이션 0건, 중복 라벨 허용, 상한 8개/12자.

```typescript
/** 구분(레벨 라벨) 순수 도메인 — 검증·제안·병합 3종(설계 §2).
 *  i18n 도 DB 도 모른다(기존 도메인 모듈 관례 — 문구는 호출부가 붙인다).
 *
 *  라벨을 저장하는 세 경로(엑셀 임포트·설정 편집·프로젝트 생성)가 전부 여기를 통과한다.
 *  `project_settings.level_labels`(0058:7)에는 길이·원소 CHECK 가 0건이라 빈 배열도 200자 라벨도
 *  그대로 저장된다 — 마이그레이션 0건을 택한 이상 **애플리케이션이 유일한 관문**이다(§4). */

import type { ExcelProfile } from '@/lib/excel/profile'

/** 라벨 개수 상한. 최대 깊이가 아니다 — 깊이는 무제한이고(L3), 라벨 밖 깊이는
 *  소비처가 각자 폴백(배지 `N단`)이나 클램프(주간보고·RAG)로 처리한다(§7). */
export const MAX_LEVEL_LABELS = 8

/** 라벨 1개의 길이 상한. 임의값이 아니다 — WBS 시트의 구분 열이 60px 로 동결돼 있어
 *  (`src/components/wbs/WbsGanttSheet.tsx:35`) 그보다 길면 배지가 잘린다. */
export const MAX_LEVEL_LABEL_LEN = 12

/** 내보내기가 생성하는 계층 헤더 — 3열이 아닐 때 `Level1`,`Level2`… (`exportWithProfile.ts:22-25`). */
const SYSTEM_HEADER_RE = /^Level\d+$/

/** 내보내기가 삽입하는 고정 헤더(`exportWithProfile.ts:185`). 내보낸 파일을 라벨 반영을 켜고
 *  되임포트하면 사용자 라벨이 조용히 되돌아가므로, 시스템 생성물의 표지로 보고 제안을 포기한다(§8). */
const SYSTEM_INSERTED_HEADER = '세부업무'

export type NormalizeLevelLabelsResult =
  | { ok: true; labels: string[] }
  | { ok: false; reason: string }

/** 단일 검증 관문 — trim → 빈·공백 원소 거부 → 개수 1~8 → 원소 길이 ≤ 12자.
 *
 *  **중복 라벨은 허용한다.** 사람이 의도적으로 같은 이름을 둘 수 있고(예: 2·3단 모두 '작업'),
 *  해로운 값이 아니다 — 막아야 하는 것은 화면·산출물을 망가뜨리는 값뿐이다:
 *  빈 배열은 클램프 인덱스를 -1 로 만들어 주간보고 B열과 RAG 임베딩에 `구분 undefined` 를 박고
 *  (`weekly.ts:483`·`analytics.ts:373`), 빈 문자열 원소는 `??` 폴백을 통과해(`shared.tsx:44`)
 *  배지를 빈칸으로 만든다.
 *
 *  reason 은 한국어 문장이다 — 임포트 `warnings` 와 설정 화면 인라인 오류가 그대로 노출한다
 *  (detect.ts 의 경고 문구와 같은 관례). */
export function normalizeLevelLabels(labels: string[]): NormalizeLevelLabelsResult {
  // 서버 액션·폼 경계를 건너온 값은 타입이 보증이 아니다 — 런타임으로 한 번 더 확인한다.
  if (!Array.isArray(labels)) return { ok: false, reason: '구분 라벨은 배열이어야 합니다' }
  if (labels.length === 0) return { ok: false, reason: '구분 라벨은 1개 이상이어야 합니다' }
  if (labels.length > MAX_LEVEL_LABELS) {
    return { ok: false, reason: `구분 라벨은 ${MAX_LEVEL_LABELS}개까지 가능합니다` }
  }

  const out: string[] = []
  for (const raw of labels) {
    if (typeof raw !== 'string') return { ok: false, reason: '구분 라벨은 문자열이어야 합니다' }
    const label = raw.trim()
    if (label === '') return { ok: false, reason: '빈 구분 라벨은 사용할 수 없습니다' }
    if (label.length > MAX_LEVEL_LABEL_LEN) {
      return { ok: false, reason: `구분 라벨은 ${MAX_LEVEL_LABEL_LEN}자를 넘을 수 없습니다: ${label}` }
    }
    out.push(label)
  }
  return { ok: true, labels: out }
}

/** 엑셀 계층 열 헤더 → 제안 라벨. **판단이 서지 않으면 `null`**(제안 포기)이다.
 *  무증상 오염이 되돌릴 수 없는 쪽이라(이력 테이블 0건·PITR 꺼짐) 애매하면 아무것도 하지 않는다.
 *
 *  포기 조건 넷:
 *   - outline(단일 코드 열) 프로파일 — 레벨별 헤더라는 것이 존재하지 않는다
 *   - 계층 열 헤더에 빈 문자열·공백만·부재가 있다 — 병합 셀 양식에서 연속 셀이 `null` 로 읽힌다(실측).
 *     헤더 배열보다 열 인덱스가 큰 경우(범위 밖)도 여기서 함께 걸린다
 *   - 헤더에 중복이 있다 — 어느 단계의 어휘인지 사람이 확인해야 한다
 *   - 시스템 생성 헤더다 — `Level1`… 또는 `세부업무`(§8 왕복 방지) */
export function proposeLevelLabels(
  headers: (string | null | undefined)[],
  profile: ExcelProfile,
): string[] | null {
  if (profile.hierarchy.kind !== 'columns') return null

  const proposed: string[] = []
  for (const col of profile.hierarchy.columns) {
    const raw = headers[col]
    if (typeof raw !== 'string') return null
    const label = raw.trim()
    if (label === '') return null
    if (SYSTEM_HEADER_RE.test(label) || label === SYSTEM_INSERTED_HEADER) return null
    proposed.push(label)
  }
  if (proposed.length === 0) return null
  if (new Set(proposed).size !== proposed.length) return null

  return proposed
}

/** `merged[i] = derived[i] ?? existing[i]` — 길이는 둘 중 긴 쪽.
 *
 *  뒤쪽 기존 라벨을 보존하는 이유: 3열 엑셀을 4라벨 프로젝트에 임포트하면 라벨이 3개로 잘려
 *  depth 3 표기가 퇴화한다. 감지 실패 폴백(`detect.ts:274`)이나 계층 방식 전환
 *  (`importWizard.ts:129`)으로 계층 열이 **1열**이 되는 경우도 있다.
 *  명시적 축소는 설정 화면의 수동 편집(§6)에서만 일어난다. */
export function mergeLevelLabels(derived: string[], existing: string[]): string[] {
  const len = Math.max(derived.length, existing.length)
  const merged: string[] = []
  for (let i = 0; i < len; i++) {
    // 배열에 구멍이 없다는 전제 아래 `derived[i] ?? existing[i]` 와 동치 — 인덱스 비교로 명시한다.
    merged.push(i < derived.length ? derived[i] : existing[i])
  }
  return merged
}
```

> `mergeLevelLabels` 가 `derived[i] ?? existing[i]` 대신 인덱스 비교를 쓰는 이유: tsconfig 에
> `noUncheckedIndexedAccess` 가 없어 `arr[i]` 가 `string` 으로 타이핑되므로 `??` 의 좌변이
> never-nullish 로 보인다. 같은 의미를 타입이 이해하는 형태로 적은 것이다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/domain/level-labels.test.ts`
Expected: PASS (전 케이스)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/levelLabels.ts tests/domain/level-labels.test.ts
git commit -m "feat: 구분 라벨 검증·제안·병합 순수함수

level_labels 에 DB 제약이 0건이라 빈 배열·빈 문자열이 그대로 저장되고,
빈 배열은 주간보고 B열과 RAG 임베딩에 '구분 undefined' 를 박는다.
세 쓰기 경로가 공유할 단일 관문을 먼저 세운다."
```

---

### Task 2: 엑셀 계층 헤더 재유도

임포트 실행 라우트가 클라이언트가 보낸 라벨 문자열을 그대로 쓰지 않고, **파싱에 쓴 좌표계를
그대로 재사용해** 라벨-파싱 불일치를 없애기 위한 모듈이다.

`parseWithProfile` 에 export 를 얹지 않고 별도 모듈로 두는 것이 핵심이다 — 라우트 테스트가
`@/lib/excel/parseWithProfile` 을 통째로 `vi.mock` 해서, 같은 모듈에 새 export 를 얹으면
팩토리에 없는 이름이 `undefined` 가 되어 런타임에서만 터진다(§10-5).

**Files:**
- Create: `src/lib/excel/headers.ts`
- Test: `tests/excel/hierarchy-headers.test.ts`

**Interfaces:**
- Consumes: `ExcelProfile`(`@/lib/excel/profile`) · `xlsx`
- Produces: `readHierarchyHeaders(buf: ArrayBuffer, profile: ExcelProfile): string[] | null`
  — 계층 열 순서대로 헤더 문자열. 병합으로 빈 셀은 `''` 로 정규화(제안 포기 판단은 Task 1 의 `proposeLevelLabels` 몫)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

메모리에서 워크북을 만들어 `ArrayBuffer` 로 넘긴다. `blankrows:false` 계약을 고정하는 케이스가
이 테스트의 존재 이유다 — 깨지면 재유도가 `parseWithProfile` 과 다른 행을 보고 있다는 뜻이다.

> 실행 검증 완료 — `npx vitest run tests/excel/hierarchy-headers.test.ts` → **Test Files 1 passed / Tests 12 passed** (2026-08-12 실측). eslint 통과, tsc 에러 0건.

스펙 §12 의 5 케이스를 전부 덮고 3건을 더했다:
- 정상 / 범위 안 빈 행 / 병합 헤더 / headerRow 범위 밖 null / 계층 열 범위 밖 null (§12 지정)
- + outline null, 시트 없음 null, 손상 버퍼 null (모듈 계약이 명시한 나머지 null 조건)

픽스처 설계에서 **주의할 실측 사실**(계획서에 적어 둘 것): `aoa_to_sheet` 에 선두 빈 행(`[]`)을 주면 `!ref` 자체가 `A2:C3` 로 시작해 그 행이 범위 밖으로 나가 버린다 — blankrows 계약을 시연할 수 없다. 그래서 픽스처를 `[제목행, [], 헤더행, 데이터…]` 로 짰다. 이러면 `!ref = A1:C5` 안에 빈 행이 들어와 `blankrows:false` 면 헤더가 인덱스 1, `true` 면 인덱스 2 가 된다. `'전제 고정'` it 이 그 사실 자체를 xlsx 로 직접 단정해, 향후 xlsx 버전 업으로 동작이 바뀌면 이 테스트가 먼저 깨지게 했다.

`'엑셀 절대 행 번호(headerRow=2)를 넣으면 데이터 행이 라벨로 잡힌다'` it 은 §10-1 함정의 **증상을 박제**한 것이다 — 통과가 정상 동작을 뜻하지 않고, 오설정 시 무엇이 저장되는지를 고정한다. §10-2(savedProfile.headerRow ≠ detect 의 headerRow)가 현실화됐을 때 완료 화면 before/after 가 왜 필요한지의 근거가 된다.

```typescript
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { readHierarchyHeaders } from '@/lib/excel/headers'
import type { ExcelProfile } from '@/lib/excel/profile'

function makeBook(sheets: { name: string; aoa: unknown[][] }[]): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const { name, aoa } of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name)
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

/** 계층 3열·headerRow 지정만 다르게 쓰는 최소 프로파일. */
function columnsProfile(over: Partial<ExcelProfile> = {}): ExcelProfile {
  return {
    version: 1,
    sheetName: 'Sheet1',
    holidaySheetName: null,
    headerRow: 0,
    hierarchy: { kind: 'columns', columns: [0, 1, 2] },
    logical: { extraAxis: null, code: null, name: null, deliverable: null, start: null, end: null, weight: null, actualPct: null },
    teamColumns: [],
    ownerMarks: {},
    ...over,
  }
}

/* ── 정상: 계층 열 헤더가 프로파일 좌표 그대로 나온다 ── */
describe('readHierarchyHeaders — 정상', () => {
  const aoa: unknown[][] = [
    ['대분류', '중분류', '소분류', '산출물'],
    ['1. 준비', '', '', ''],
    ['', '1-1. 거버넌스', '', ''],
  ]
  const buf = makeBook([{ name: 'Sheet1', aoa }])

  it('계층 열(0,1,2)의 헤더만 뽑는다 — 계층 밖 열(산출물)은 포함하지 않는다', () => {
    expect(readHierarchyHeaders(buf, columnsProfile())).toEqual(['대분류', '중분류', '소분류'])
  })

  it('계층 열이 비연속이어도 좌표대로 뽑는다', () => {
    const wideAoa: unknown[][] = [
      ['Biz', '대공정', '중공정', '', '세부공정'],
      ['PI', '1. 준비', '', '', ''],
    ]
    const wideBuf = makeBook([{ name: 'Sheet1', aoa: wideAoa }])
    const profile = columnsProfile({ hierarchy: { kind: 'columns', columns: [1, 2, 4] } })
    expect(readHierarchyHeaders(wideBuf, profile)).toEqual(['대공정', '중공정', '세부공정'])
  })
})

/* ── 범위 안 빈 행: `blankrows:false` 계약 고정(설계 §10-1).
 *  headerRow 는 엑셀 절대 행 번호가 아니라 '빈 행이 제거된 배열'의 인덱스다.
 *  이 케이스가 깨지면 재유도가 parseWithProfile 과 다른 행을 보고 있다는 뜻이다. ── */
describe('readHierarchyHeaders — 범위 안 빈 행(blankrows:false 계약)', () => {
  // 1행 제목 / 2행 완전 공백 / 3행 헤더 — 빈 행이 제거되므로 헤더의 인덱스는 2 가 아니라 1 이다.
  const aoa: unknown[][] = [
    ['2026 WBS 계획서'],
    [],
    ['대분류', '중분류', '소분류'],
    ['1. 준비', '', ''],
    ['', '1-1. 거버넌스', ''],
  ]
  const buf = makeBook([{ name: 'Sheet1', aoa }])

  it('빈 행이 압축된 인덱스(headerRow=1)에서 헤더를 읽는다', () => {
    expect(readHierarchyHeaders(buf, columnsProfile({ headerRow: 1 }))).toEqual(['대분류', '중분류', '소분류'])
  })

  it('전제 고정 — blankrows 기본값(true)이었다면 같은 인덱스가 빈 행을 가리킨다', () => {
    const ws = XLSX.read(buf, { type: 'array', cellDates: false }).Sheets['Sheet1']
    const kept = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true })
    expect(kept[1]).toEqual([])
  })

  it('엑셀 절대 행 번호(headerRow=2)를 넣으면 데이터 행이 라벨로 잡힌다 — 오설정의 증상 고정', () => {
    expect(readHierarchyHeaders(buf, columnsProfile({ headerRow: 2 }))).toEqual(['1. 준비', '', ''])
  })
})

/* ── 병합 헤더: 연속 셀이 null 로 읽혀 빈 문자열이 된다.
 *  readHierarchyHeaders 는 이것을 에러로 보지 않고 그대로 노출하고,
 *  제안 포기 판단은 호출부(proposeLevelLabels)가 맡는다(관심사 분리). ── */
describe('readHierarchyHeaders — 병합 헤더', () => {
  it('병합으로 비어 있는 셀은 빈 문자열로 나온다(undefined 를 흘려보내지 않는다)', () => {
    const aoa: unknown[][] = [
      ['대분류', null, '소분류'],
      ['1. 준비', '', ''],
    ]
    const buf = makeBook([{ name: 'Sheet1', aoa }])
    const headers = readHierarchyHeaders(buf, columnsProfile())
    expect(headers).toEqual(['대분류', '', '소분류'])
    expect(headers?.every(h => typeof h === 'string')).toBe(true)
  })

  it('트레일링 병합(행 배열이 잘리는 경우)도 범위 밖으로 오판하지 않는다', () => {
    // ['대분류', null, null] 은 sheet_to_json 에서 ['대분류'] 로 잘려 나온다 —
    // 행 배열 length 로 열 범위를 재면 여기서 null 이 나와 버린다.
    const aoa: unknown[][] = [
      ['대분류', null, null],
      ['1. 준비', '', ''],
    ]
    const buf = makeBook([{ name: 'Sheet1', aoa }])
    expect(readHierarchyHeaders(buf, columnsProfile())).toEqual(['대분류', '', ''])
  })
})

/* ── null 을 내는 조건들 ── */
describe('readHierarchyHeaders — null 조건', () => {
  const aoa: unknown[][] = [
    ['대분류', '중분류', '소분류'],
    ['1. 준비', '', ''],
  ]
  const buf = makeBook([{ name: 'Sheet1', aoa }])

  it('headerRow 가 행 범위 밖이면 null', () => {
    expect(readHierarchyHeaders(buf, columnsProfile({ headerRow: 9 }))).toBeNull()
  })

  it('계층 열이 시트 열 범위 밖이면 null (일부만 밖이어도 전체 포기)', () => {
    const profile = columnsProfile({ hierarchy: { kind: 'columns', columns: [0, 1, 7] } })
    expect(readHierarchyHeaders(buf, profile)).toBeNull()
  })

  it('outline 프로파일이면 null — 레벨별 헤더라는 개념이 없다', () => {
    const profile = columnsProfile({ hierarchy: { kind: 'outline', column: 0 } })
    expect(readHierarchyHeaders(buf, profile)).toBeNull()
  })

  it('profile.sheetName 시트가 없으면 null', () => {
    expect(readHierarchyHeaders(buf, columnsProfile({ sheetName: 'WBS' }))).toBeNull()
  })

  it('워크북으로 읽을 수 없는 버퍼면 null(예외를 흘리지 않는다)', () => {
    expect(readHierarchyHeaders(new Uint8Array([1, 2, 3]).buffer, columnsProfile())).toBeNull()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/excel/hierarchy-headers.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/excel/headers"`

- [ ] **Step 3: 구현한다**

> 검증 완료 — 이 파일 그대로 리포에 넣고 `npx tsc --noEmit -p tsconfig.json` 실행 시 이 파일 관련 에러 0건, `npx eslint src/lib/excel/headers.ts` 통과, 아래 테스트 12건 전량 초록.

설계 대비 명시적으로 굳힌 판단 2건(계획서에 적어 둘 것):
1) **열 범위 판정은 `!ref` 의 decode_range 로 한다.** 행 배열 length 로 재면 안 된다 — xlsx 실측(2026-08-12)에서 `['대분류', null, null]` 헤더가 `sheet_to_json` 결과에서 `['대분류']`(length 1)로 잘려 나왔다. 병합 헤더가 오른쪽 끝에 있을 때 멀쩡한 열을 '범위 밖'으로 오판해 라벨 반영이 통째로 침묵 스킵된다. `!ref` 는 같은 시트에서 `A1:C2` 로 e.c=2 를 정확히 준다.
2) **병합 셀은 `''` 로 노출하고 `null` 을 내지 않는다.** 스펙 §2 의 '빈 헤더가 있으면 제안 포기'는 `proposeLevelLabels` 의 책임이다. 여기서 미리 `null` 로 접으면 라우트가 `warnings` 에 '왜' 를 구분해 실을 수 없어진다(readHierarchyHeaders 실패 = 좌표 문제, proposeLevelLabels 실패 = 헤더 내용 문제).

`XLSX.read` 를 try/catch 로 감싸는 것은 parseWithProfile.ts:78-83 과 동일 — 라우트가 이미 파싱에 성공한 버퍼를 넘기므로 정상 경로에서는 발동하지 않지만, 예외가 임포트 성공 후에 터져 응답 전체를 500 으로 만드는 일은 없어야 한다(스펙 §5-2: 라벨만 건너뛰고 임포트는 성공 유지).

```typescript
/** 계층 열 헤더 재유도(구분 라벨 유연화 설계 §5) — 업로드된 워크북에서 계층 열의 헤더 문자열만
 *  다시 읽는다. 임포트 실행 라우트가 클라이언트가 보낸 라벨 문자열을 그대로 쓰지 않고,
 *  **파싱에 쓴 좌표계(profile)를 그대로 재사용해** 라벨-파싱 불일치를 없애기 위한 모듈이다.
 *
 *  `parseWithProfile` 에 export 를 얹지 않고 별도 모듈로 둔 이유(설계 §10-5): 라우트 테스트가
 *  `@/lib/excel/parseWithProfile` 을 통째로 `vi.mock` 하고 있어, 같은 모듈에 새 export 를 얹으면
 *  팩토리에 없는 이름이 `undefined` 가 되어 런타임에서만 터진다. */

import * as XLSX from 'xlsx'
import type { ExcelProfile } from '@/lib/excel/profile'

/** detect.ts 의 cellText 와 동일 규칙(export 되어 있지 않아 복제).
 *  병합 셀 양식에서 연속 셀이 `null`/`undefined` 로 읽히는데, 여기서 `''` 로 정규화해
 *  호출부(`proposeLevelLabels`)가 "빈 헤더가 있으면 제안 포기" 규칙으로 걸러낼 수 있게 한다. */
function cellText(v: unknown): string {
  return String(v ?? '').trim()
}

/**
 * 계층 열 헤더를 프로파일 좌표 그대로 읽어 반환한다. 판단이 서지 않으면 `null`.
 *
 * `null` 을 내는 조건:
 * - outline(단일 코드 열) 프로파일 — 레벨별 헤더라는 것이 존재하지 않는다
 * - 워크북을 읽을 수 없음 / `profile.sheetName` 시트 없음 / 빈 시트(`!ref` 부재)
 * - `profile.headerRow` 가 행 범위 밖
 * - `profile.hierarchy.columns` 중 하나라도 시트 열 범위 밖
 *
 * ⚠️ `sheet_to_json` 옵션은 `parseWithProfile.ts:88` 과 **반드시 동일**해야 한다.
 * `profile.headerRow` 는 엑셀 절대 행 번호가 아니라 `{ header:1, blankrows:false }` 로 압축된
 * 배열의 인덱스다 — `blankrows` 를 빠뜨리면 기본값 `true` 가 되어 범위 안 빈 행 하나로
 * 인덱스가 밀리고, 헤더 대신 데이터 행(업무명)이 라벨로 저장된다. 에러 없이.
 */
export function readHierarchyHeaders(buf: ArrayBuffer, profile: ExcelProfile): string[] | null {
  // outline 은 깊이를 코드 문자열에서 유도하므로 '레벨별 헤더' 자체가 없다.
  if (profile.hierarchy.kind !== 'columns') return null

  let wb: XLSX.WorkBook
  try {
    // parseWithProfile 과 동일 옵션 — 같은 좌표계를 얻기 위한 것이므로 임의로 바꾸지 말 것.
    wb = XLSX.read(buf, { type: 'array', cellDates: false })
  } catch {
    return null
  }

  const ws = wb.Sheets[profile.sheetName]
  if (!ws) return null

  const ref = ws['!ref']
  if (!ref) return null // 셀이 하나도 없는 시트

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false })
  const headerRow = aoa[profile.headerRow]
  if (!headerRow) return null // headerRow 가 행 범위 밖

  // 열 범위는 시트 선언 범위(`!ref`)로 판정한다 — 행 배열의 length 는 믿을 수 없다.
  // 병합 헤더의 트레일링 `null` 은 배열 끝을 잘라내기 때문에(['대분류',null,null] → ['대분류'])
  // length 로 재면 멀쩡한 열을 '범위 밖'으로 오판한다.
  const lastCol = XLSX.utils.decode_range(ref).e.c

  const headers: string[] = []
  for (const c of profile.hierarchy.columns) {
    if (c < 0 || c > lastCol) return null
    headers.push(cellText(headerRow[c]))
  }
  return headers
}
```

> 열 범위를 행 배열의 `length` 가 아니라 시트 선언 범위(`!ref`)로 재는 것이 중요하다.
> 트레일링 병합 셀은 배열 끝을 잘라내므로(`['대분류',null,null]` → `['대분류']`)
> `length` 로 재면 멀쩡한 열을 '범위 밖'으로 오판한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/excel/hierarchy-headers.test.ts`
Expected: PASS (전 케이스)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/excel/headers.ts tests/excel/hierarchy-headers.test.ts
git commit -m "feat: 계층 열 헤더 재유도 모듈

headerRow 는 엑셀 절대 행 번호가 아니라 blankrows:false 로 압축된 배열의
인덱스다. 옵션이 어긋나면 헤더 대신 데이터 행이 라벨로 저장되는데 에러가
나지 않는다 — 파싱과 같은 옵션을 쓴다는 것을 테스트로 못박는다.
parseWithProfile 이 라우트 테스트에서 통째로 mock 되므로 별도 모듈로 둔다."
```

---

### Task 3: 기본 4단 프리셋과 생성 시드

신규 프로젝트가 4단 어휘를 갖게 한다. **기존 프로젝트는 무접촉** — 0058 시드가 이미 전 프로젝트에
설정 행을 넣었고 이 변경은 생성 경로만 건드린다.

기존 테스트 2건이 **확정 파손**된다. 둘 다 D-CUBE 현행을 지키는 감시선이므로 지우지 말고
"pi 프리셋을 심는다"에서 "standard4 프리셋을 심는다"로 의도를 다시 쓴다.

**Files:**
- Modify: `src/lib/domain/projectPresets.ts` (신규 키 추가 — `pi` 무접촉)
- Modify: `src/app/actions/project.ts` (`createProject` 시드 + `preset_applied` 파생)
- Test: `tests/domain/project-presets.test.ts` (갱신) · `tests/actions/project-actions.test.ts` (갱신)

**Interfaces:**
- Produces: `PRESETS.standard4` — `levelLabels: ['PHASE','TASK','ACT','SUB-ACT']` · `maxDepth: null` · `extraAxisLabel: null` · 비어있지 않은 전부 소문자 `milestoneKeywords`. Task 5 가 `PRESETS.standard4.milestoneKeywords` 를 참조한다

- [ ] **Step 1: 테스트를 먼저 고친다(실패 상태로 만든다)**

`tests/domain/project-presets.test.ts` — 전수 순회 케이스(`milestoneKeywords` 비어있지 않음 + 전부 소문자)는
그대로 두고 `standard4` 고정 단정을 추가한다.

> 파손은 없다(전수 감시선 2건은 standard4 값이 §1 대로면 통과). pi 핀과 대칭으로 standard4 값을 고정하는 it 1건만 추가한다 — 이 값이 신규 프로젝트의 유일한 어휘 출처라 실수로 바뀌면 화면·산출물이 통째로 따라 바뀐다. 기존 3개 it 은 무변경.

```typescript
  it('standard4 프리셋 = 신규 프로젝트 기본 어휘(라벨 유연화 §1)', () => {
    // 대문자 원문 저장이 계약이다 — levelBadgeText 의 축약표에 없어야 `?? label` 원문 폴백을 타고
    // 화면에 PHASE·TASK·ACT·SUB-ACT 가 그대로 나온다(§3, shared.tsx 무수정의 근거).
    expect(PRESETS.standard4.levelLabels).toEqual(['PHASE', 'TASK', 'ACT', 'SUB-ACT'])
    // 라벨 개수 ≠ 최대 깊이(L3). 4 면 canAddChild(3, 4) 가 false 라 4단 프로젝트에서 자식 추가가 막힌다.
    expect(PRESETS.standard4.maxDepth).toBeNull()
    expect(PRESETS.standard4.extraAxisLabel).toBeNull()
    expect(PRESETS.standard4.milestoneKeywords.length).toBeGreaterThan(0)
  })
```

`tests/actions/project-actions.test.ts` — `level_labels`/`max_depth`/`extra_axis_label`/`preset_applied` 를
하드 단정하는 케이스를 새 값으로 고친다. `describe`/`it` 제목의 'pi 프리셋' 표현까지 함께 고친다.

> **확정 파손 수정.** 머리 주석(3행)·describe 제목(67행)·it 제목(68행)·단정(73-80행)을 standard4 로 갱신하고, §1 계약(페이로드에 프리셋 전량 명시)을 지키는 케이스를 1건 신설한다. mock/beforeEach 등 나머지(6-65행, 83-92행)는 무변경.

```typescript
// createProject 의 project_settings standard4 프리셋 시드(Task 11 finding I3 · 라벨 유연화 §1)만 검증한다.
// projects insert 는 일반 클라이언트(su_insert_projects RLS 정책), project_settings insert 는
// 쓰기 정책이 없어(0058) admin 클라이언트가 필요하다 — 두 경로를 각각 모의한다.

// …(vi.hoisted mock·vi.mock·beforeEach 무변경)…

describe('createProject — project_settings standard4 프리셋 시드 (Task 11 I3 · 라벨 유연화 §1)', () => {
  it('성공 시 project_settings 에 standard4 프리셋 값 + preset_applied:"standard4" 를 insert 한다', async () => {
    await createProject('신규 프로젝트', '2026-01-01', '2026-12-31', '설명')

    expect(db.insertedProject).toMatchObject({ name: '신규 프로젝트', start_date: '2026-01-01', end_date: '2026-12-31' })
    expect(createAdminClient).toHaveBeenCalled()
    expect(db.insertedSettings).toMatchObject({
      project_id: 'proj-1',
      // 대문자 원문 — levelBadgeText 의 축약표를 타지 않고 원문 폴백으로 화면에 그대로 나온다(§3).
      level_labels: ['PHASE', 'TASK', 'ACT', 'SUB-ACT'],
      // 라벨 개수 ≠ 최대 깊이(L3) — 4 로 두면 canAddChild 가 depth 3 에서 자식 추가를 막는다.
      max_depth: null,
      extra_axis_label: null,
      preset_applied: 'standard4',
    })
    expect((db.insertedSettings as { milestone_keywords: string[] }).milestone_keywords.length).toBeGreaterThan(0)
  })

  it('level_labels·milestone_keywords 를 페이로드에 명시한다(§1 계약 — DB default 는 여전히 3단·빈 키워드다)', async () => {
    await createProject('신규 프로젝트3', null, null, null)

    // 생략하면 0058:7 의 default array['Phase','Task','Activity'] 가 먹어 신규가 조용히 3단이 되고,
    // milestone_keywords 는 빈 배열이 되어 마일스톤 카드가 무증상 소실된다.
    expect(db.insertedSettings).toHaveProperty('level_labels')
    expect(db.insertedSettings).toHaveProperty('milestone_keywords')
  })

  it('project_settings insert 실패는 프로젝트 생성 성공을 막지 않는다(로깅만 — 이력 기록 실패 관례)', async () => {
    db.settingsInsertError = { message: 'RLS 위반' }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(createProject('신규 프로젝트2', null, null, null)).resolves.toBeUndefined()

    expect(db.insertedProject).toMatchObject({ name: '신규 프로젝트2' })
    expect(errSpy).toHaveBeenCalledWith('[createProject] project_settings 시드 실패:', 'RLS 위반')
    errSpy.mockRestore()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/domain/project-presets.test.ts tests/actions/project-actions.test.ts`
Expected: FAIL — `standard4` 미정의, 그리고 insert 페이로드가 여전히 pi 값

- [ ] **Step 3: 프리셋을 추가한다**

> standard4 를 PRESETS 의 첫 키로 추가(순수 추가 — pi/swdev/blank 무접촉). milestoneKeywords 는 §1 목록 그대로: 비어 있지 않고 전부 소문자라 project-presets.test.ts:11-17 의 전수 감시선을 통과한다(한글은 소문자 개념이 없어 `k === k.toLowerCase()` 가 참).

```typescript
export const PRESETS = {
  /** 신규 프로젝트 기본 시드(라벨 유연화 설계 §1) — 라벨만 4개, 깊이는 무제한(L3).
   *  대문자 원문으로 저장하는 것이 핵심이다: levelBadgeText(shared.tsx:41-45)의 축약표에 없는 값이라
   *  `?? label` 원문 폴백을 타고 화면에 PHASE·TASK·ACT·SUB-ACT 가 그대로 나온다 — 배지 코드를 고칠 필요가 없다(§3).
   *  maxDepth 는 반드시 null. 4 로 두면 canAddChild(depth, 4)(wbsAffordance.ts:5)가 depth 3 에서
   *  자식 추가를 막아 '라벨 개수 ≠ 최대 깊이' 라는 결정과 정면 충돌한다. */
  standard4: {
    summary: '4단 WBS · 분류축 없음 · 깊이 무제한',
    levelLabels: ['PHASE', 'TASK', 'ACT', 'SUB-ACT'],
    maxDepth: null,
    extraAxisLabel: null,
    milestoneKeywords: ['킥오프', 'kick-off', '착수보고', '중간보고', '최종보고', '보고회',
                        '오픈', '릴리스', 'release', '검수', 'uat', '준공', '승인', '마일스톤', 'milestone'],
  },
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

- [ ] **Step 4: 생성 시드를 바꾼다**

`preset_applied` 를 리터럴이 아니라 프리셋 키에서 파생시킨다 — `0061_replace_wbs_and_profile.sql:94` 가
이 값을 술어로 쓴 전례가 있어, 3라벨 pi 프로젝트와 4라벨 신규 프로젝트가 같은 마커를 갖게 두면
나중에 구분할 수 없다.

> ① 파일 상단(createProject 위)에 SEED_PRESET_KEY 상수 추가 ② insert 구간 교체. import 는 이미 `PRESETS` 를 들여오고 있어 추가 import 0건.

```typescript
/** 신규 프로젝트의 시드 프리셋(라벨 유연화 §1) — 기본 어휘는 4단 PHASE·TASK·ACT·SUB-ACT.
 *  preset_applied 를 리터럴이 아니라 이 키에서 파생시키는 이유: 0061_replace_wbs_and_profile.sql:94 가
 *  preset_applied 를 백필 술어(`where preset_applied = 'legacy-dcube'`)로 쓴 전례가 있어,
 *  3라벨 pi 프로젝트와 4라벨 신규 프로젝트가 같은 마커를 가지면 나중에 SQL 로 구분할 수 없다. */
const SEED_PRESET_KEY = 'standard4' satisfies keyof typeof PRESETS

export async function createProject(
  name: string,
  start: string | null,
  end: string | null,
  description: string | null = null,
) {
  // 프로젝트 생성은 전역 관리 — 슈퍼유저만.
  const g = await requireSuperuser()
  if (!g.ok) throw new Error(g.error)
  if (!isValidDateRange(start || null, end || null)) throw new Error('종료일은 시작일보다 빠를 수 없습니다.')
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('projects')
    .insert({ name, start_date: start, end_date: end, description })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  // 생성 시 프리셋 선택 UI 는 두지 않는다(설계 B3 — 사후 변경은 설정의 'WBS 구분' 편집이 커버한다).
  // 페이로드에 프리셋 전량을 명시하는 것이 계약이다: level_labels 를 빼면 DB default(0058:7 의
  // array['Phase','Task','Activity'])가 먹어 신규 프로젝트가 조용히 3단이 되고,
  // milestone_keywords 를 빼면 빈 배열이 되어 마일스톤 카드가 무증상 소실된다(§7.4).
  // project_settings 는 쓰기 정책이 없다(0058 — service_role 전용 관문) — projects insert 와 달리 admin 클라이언트가 필요하다.
  const preset = PRESETS[SEED_PRESET_KEY]
  const admin = createAdminClient()
  const { error: settingsErr } = await admin.from('project_settings').insert({
    project_id: data.id,
    level_labels: preset.levelLabels,
    max_depth: preset.maxDepth,
    extra_axis_label: preset.extraAxisLabel,
    milestone_keywords: preset.milestoneKeywords,
    preset_applied: SEED_PRESET_KEY,
  })
  // 실패해도 프로젝트 생성은 성공 — 행이 없으면 getProjectConfig 가 DEFAULT_PROJECT_CONFIG 로 폴백한다(이력 기록 실패와 동일 관례).
  if (settingsErr) console.error('[createProject] project_settings 시드 실패:', settingsErr.message)
  revalidatePath('/projects')
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run tests/domain/project-presets.test.ts tests/actions/project-actions.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/lib/domain/projectPresets.ts src/app/actions/project.ts \
        tests/domain/project-presets.test.ts tests/actions/project-actions.test.ts
git commit -m "feat: 신규 프로젝트 기본 구분을 4단으로

생성 시 pi(3단)로 고정돼 있어 엑셀 없이 직접 쓰는 프로젝트가 4단 어휘를
가질 수 없었다. pi 는 D-CUBE 현행의 감시선이라 손대지 않고 키를 추가한다.
preset_applied 는 0061 이 술어로 쓴 전례가 있어 키에서 파생시킨다."
```

---

### Task 4: 설정 로더 방어 정규화

DB 에 제약이 없으므로 **이미 손상된 행**이 있을 수 있다. 로더가 계약을 보증해 15개 소비처에
닿지 않게 한다 — 같은 파일이 `milestone_keywords` 를 lowercase 로 정규화하는 것과 같은 관례다.

**Files:**
- Modify: `src/lib/data/projectConfig.ts`
- Test: `tests/data/project-config.test.ts` (케이스 신설)

**Interfaces:**
- Produces: `getProjectConfig` 의 `levelLabels` 가 **항상** 빈 원소 없는 1개 이상 배열임을 보증

- [ ] **Step 1: 실패하는 테스트를 쓴다**

기존 테스트는 상수 참조 비교라 값 회귀를 못 잡는다 — 손상된 행을 주는 케이스를 신설한다.

> 기존 3케이스는 파손 없이 통과한다(15행은 상수 참조 비교라 값 회귀를 못 잡는다 — §12 대로 케이스를 신설). describe 블록 안에 아래 3건을 추가한다.

```typescript
  it('빈 문자열·공백 라벨 원소는 걸러낸다(§2 2차 관문 — 배지 빈칸 방지)', async () => {
    mocks.createServerClient.mockResolvedValue(client({
      level_labels: ['PHASE', '', '  ', 'ACT'], max_depth: null, extra_axis_label: null,
      milestone_keywords: [], excel_profile: {},
    }) as never)
    const c = await getProjectConfig('11111111-1111-4111-8111-111111111111')
    expect(c.levelLabels).toEqual(['PHASE', 'ACT'])
  })

  it('라벨이 전량 손상이면 기본값으로 승격한다(빈 배열 = 주간보고·RAG 클램프 -1 → "구분 undefined")', async () => {
    mocks.createServerClient.mockResolvedValue(client({
      level_labels: [], max_depth: null, extra_axis_label: null,
      milestone_keywords: [], excel_profile: {},
    }) as never)
    const c = await getProjectConfig('11111111-1111-4111-8111-111111111111')
    // 값으로 비교한다 — 참조 비교는 기본값이 바뀌어도 통과해 회귀를 못 잡는다.
    expect(c.levelLabels).toEqual(['Phase', 'Task', 'Activity'])
  })

  it('승격한 라벨은 공유 상수의 복사본이다(소비처 변형이 전역 기본값을 오염시키지 않는다)', async () => {
    mocks.createServerClient.mockResolvedValue(client({
      level_labels: ['   '], max_depth: null, extra_axis_label: null,
      milestone_keywords: [], excel_profile: {},
    }) as never)
    const c = await getProjectConfig('11111111-1111-4111-8111-111111111111')
    expect(c.levelLabels).not.toBe(DEFAULT_PROJECT_CONFIG.levelLabels)
    expect(c.levelLabels).toEqual(DEFAULT_PROJECT_CONFIG.levelLabels)
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/data/project-config.test.ts`
Expected: FAIL — 빈 원소가 그대로 흘러나온다

- [ ] **Step 3: 구현한다**

> getProjectConfig 의 return 직전에 방어 정규화(§2 2차 관문) 삽입 + DEFAULT_PROJECT_CONFIG 주석의 'pi 프리셋' 표현 갱신. 함수 시그니처·throw 계약은 무변경이라 기존 3케이스 전부 그대로 통과한다.

```typescript
export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  levelLabels: ['Phase', 'Task', 'Activity'],
  maxDepth: null,
  extraAxisLabel: null,
  // ⚠️ 스펙 §7.4: 빈 키워드는 마일스톤 카드를 무증상 소실시킨다. 이 기본값은 '설정 행이 없는 프로젝트'의 폴백인데,
  // 0058 시드가 기존 전 프로젝트에 행을 넣었고 신규 프로젝트는 생성 시 프리셋이 행을 만든다(createProject 가 standard4 프리셋 행을 시드) — 즉 이 폴백을
  // 실제로 타는 프로젝트는 시드·프리셋 경로 밖에서 만들어진 비정상 케이스뿐이며, 그때 카드가 비는 것은 '조용한
  // 기본값'이 아니라 설정 부재의 가시 신호로 남긴다.
  // levelLabels 는 D-CUBE 현행값과 같아야 회귀 0 이라는 기존 계약이 있어 4단 어휘로 바꾸지 않는다(라벨 유연화 §9).
  milestoneKeywords: [],
  excelProfile: {},
}

export async function getProjectConfig(projectId: string, client?: SupabaseServerClient): Promise<ProjectConfig> {
  const sb = client ?? (await createServerClient())
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
  // 라벨 방어 정규화(라벨 유연화 §2 2차 관문) — 0058 의 level_labels 에는 길이·원소 CHECK 가 0건이라
  // 빈 배열·빈 문자열 원소가 그대로 저장된다(스테이징 실측). 이미 손상된 행이 소비처에 닿지 않게 로더가 막는다:
  //  · 빈 문자열 원소 → shared.tsx:44 의 `??` 는 '' 를 통과시켜 배지가 빈칸이 된다
  //  · 빈 배열      → weekly.ts:483 · analytics.ts:373 의 클램프 인덱스가 -1 이 되어 주간보고 엑셀과
  //                   RAG 임베딩 본문에 '구분 undefined' 가 박히고, 그 문서가 색인되면 봇 답변까지 오염된다
  const labels = (row.level_labels ?? []).map(l => String(l ?? '').trim()).filter(l => l.length > 0)
  return {
    // 전량 손상이면 '행 없음' 과 같은 fail-safe 로 승격한다. 공유 상수 배열을 그대로 넘기면 소비처의
    // 변형이 프로세스 전역 기본값을 오염시키므로 복사본을 준다.
    levelLabels: labels.length > 0 ? labels : [...DEFAULT_PROJECT_CONFIG.levelLabels],
    maxDepth: row.max_depth,
    extraAxisLabel: row.extra_axis_label,
    // §7.4 함정 2 — isMilestoneLeaf 는 lowercase 비교. 주입 전에 정규화해 계약을 로더가 보증한다.
    milestoneKeywords: (row.milestone_keywords ?? []).map(k => k.toLowerCase()),
    excelProfile: row.excel_profile ?? {},
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/data/project-config.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/projectConfig.ts tests/data/project-config.test.ts
git commit -m "fix: 손상된 구분 라벨이 소비처에 닿지 않게 로더에서 막는다

level_labels 에 DB 제약이 0건이라 빈 배열·빈 문자열이 이미 저장돼 있을 수
있다. 빈 배열은 주간보고·RAG 클램프 인덱스를 -1 로 만들어 undefined 를
박으므로, milestone_keywords 를 정규화하는 것과 같은 자리에서 함께 막는다."
```

---

### Task 5: 임포트 실행 라우트

**가장 조심스러운 태스크다.** 기존 테스트의 단정 3건과 충돌하고, 그중 둘은 반드시 갱신해야 하며
나머지 하나(기본 경로 응답 정확일치)는 **반드시 그대로 초록이어야 한다.**

수용 기준: `applyLevelLabels=false` 이고 `saveProfile=false` 인 기본 경로에서 **응답 필드가 하나도
늘지 않고 `createAdminClient` 를 아예 호출하지 않는다.**

**Files:**
- Modify: `src/app/api/import/execute/route.ts`
- Test: `tests/api/import-execute.test.ts` (mock 등록 + 픽스처 보강 + 단정 갱신 + 신규 케이스)

**Interfaces:**
- Consumes: Task 1 의 `normalizeLevelLabels`/`proposeLevelLabels`/`mergeLevelLabels` · Task 2 의 `readHierarchyHeaders` · Task 3 의 `PRESETS.standard4`
- Produces: 응답에 `levelLabels?: { applied: true; before: string[]; after: string[] } | { applied: false; reason: string }`. **이력 테이블이 없으므로 이 응답이 잘못 반영됐을 때 되돌릴 유일한 좌표다** — Task 6 의 완료 화면이 이것을 표시한다
- 폼 필드 추가: `applyLevelLabels`(`'true'` 문자열일 때만 참 — 기존 `saveProfile`·`registerTeams` 관례와 동일)

- [ ] **Step 1: 테스트 픽스처와 mock 을 먼저 손본다**

세 가지를 해야 새 코드가 이 파일에서 돌아간다.

1. `@/lib/excel/headers` 를 **반드시 `vi.mock`** 한다 — FILE 픽스처가 `new Blob(['x'])` 1바이트 가짜라
   실제 `XLSX.read` 를 태우면 전 케이스가 예외 또는 침묵 스킵 경로를 탄다.
2. `@/lib/domain/levelLabels` 는 **mock 하지 않는다** — 순수함수이고, `validateProfile` 을 실물로 쓰는
   이 파일의 선례와 맞는다.
3. `makeSbClient.from` 이 `wbs_items` 외 테이블에서 throw 하므로, `getProjectConfig` 가 읽는
   `project_settings` 용 빌더(`select().eq().maybeSingle()`)를 추가한다. 현재 `backupBuilder` 에는
   `maybeSingle` 이 없다.

- [ ] **Step 2: 깨지는 단정을 갱신하고 신규 케이스를 추가한다**

갱신 대상 두 곳:
- `admin.upsert` 를 `toHaveBeenCalledWith({project_id, excel_profile, updated_by, updated_at}, {onConflict})` 로
  정확일치 단정하는 케이스 — 페이로드에 `level_labels`/`max_depth`/`extra_axis_label`/`milestone_keywords` 가 추가된다.
- `saveProfile=true` 케이스들 — `project_settings` 선행 조회가 추가되므로 픽스처 보강 없이는 예외로 빠진다.

**유지되어야 하는 감시선 두 개**(수정 금지):
- 기본 경로 응답 바디 `toEqual({ok,count,mode,reindexed,profileSaved})` 정확일치
- 기본 경로 `admin.upsert` 미호출

신규 케이스:

```typescript
it('applyLevelLabels=true 면 파일 헤더로 구분 라벨을 갱신하고 before/after 를 돌려준다', async () => {
  // readHierarchyHeaders mock 이 ['대분류','중분류','소분류'] 를 돌려주도록 설정
  // → 응답 levelLabels === { applied: true, before: [...], after: ['대분류','중분류','소분류'] }
  // → admin.upsert 페이로드의 level_labels 가 after 와 같다
})

it('헤더를 읽지 못하면 임포트는 성공하되 warnings 와 levelLabels.applied=false 를 남긴다', async () => {
  // readHierarchyHeaders mock 이 null 을 돌려주도록 설정
  // → res.ok === true, count 는 정상, levelLabels.applied === false, warnings 에 사유 포함
})

it('applyLevelLabels=false 면 응답에 levelLabels 필드가 없다', async () => {
  // 기본 경로 감시선의 짝 — 필드가 조건부로만 붙는다는 계약 고정
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx vitest run tests/api/import-execute.test.ts`
Expected: FAIL — 신규 케이스에서 `levelLabels` 가 `undefined`

- [ ] **Step 4: 라우트를 고친다**

전체 파일이다. 변경 지점은 넷 — ① `buf` 승격 ② `applyLevelLabels` 폼 필드
③ 프로파일 저장 블록을 **선행 조회 + 라벨 재유도 + 단일 upsert** 로 확장 ④ 응답에 조건부 필드.

> 변경 후 전체 파일. 변경점은 ① import 4건 추가 ② LevelLabelsResult 타입 ③ applyLevelLabels 폼 필드 ④ buf 승격 ⑤ 프로파일 저장 블록 → '선행 조회 + 라벨 재유도 + 단일 upsert' 로 교체 ⑥ 응답 levelLabels 조건부 스프레드. 그 외 전 구간(가드·팀 부트스트랩·RPC·스냅샷·색인)은 원문 무변경.

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProjectAdmin, requireSuperuser } from '@/lib/authz'
import { validateProfile } from '@/lib/excel/profile'
import { parseWithProfile, linkByDepth, resolveLegacyLevelLabels } from '@/lib/excel/parseWithProfile'
import { readHierarchyHeaders } from '@/lib/excel/headers'
import { splitLeafOwners } from '@/lib/excel/validate'
import { projectTeamRowsSync, teamsForProjectSync } from '@/lib/teams/master'
import { addTeam } from '@/app/actions/teams'
import { addProjectTeam } from '@/app/actions/projectTeams'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { getProjectConfig } from '@/lib/data/projectConfig'
import { ingestProject } from '@/lib/ai/ingest'
import { isUuidLike } from '@/lib/domain/agentWork'
import { mergeLevelLabels, normalizeLevelLabels, proposeLevelLabels } from '@/lib/domain/levelLabels'
import { PRESETS } from '@/lib/domain/projectPresets'

/** 가드 실패 사유 → HTTP status. 기존 `/api/import` 의 매핑을 복제한다(원본 파일은 건드리지 않는다).
 *  조회 실패는 거부가 아니라 서버 사정이므로 500(재시도 가능). */
const AUTHZ_STATUS: Record<string, number> = { '로그인 필요': 401, '권한 없음': 403 }

/** replace 모드가 백업하지 않는 부수 효과를 명시 경고한다(B2 리뷰 이월).
 *  change_logs 는 wbs_items 의 on delete cascade 로 함께 지워지고(Q1 결정 — 백업은 트리뿐),
 *  holidays 는 replace_wbs 가 delete 하지 않고 upsert 만 한다(갱신되되 잔존 항목이 남을 수 있음). */
const REPLACE_WARNINGS = [
  '변경 이력(change_logs)은 백업에 포함되지 않으며 교체 시 함께 삭제되어 복구할 수 없습니다.',
  '휴일은 삭제되지 않고 갱신만 됩니다.',
]

type ImportMode = 'append' | 'replace'

/** 구분(레벨) 라벨 갱신 결과. project_settings 에는 트리거도 이력 테이블도 없어
 *  이 응답이 잘못 반영됐을 때 되돌릴 유일한 좌표다 — before 를 반드시 함께 싣는다. */
type LevelLabelsResult =
  | { applied: true; before: string[]; after: string[] }
  | { applied: false; reason: string }

/**
 * 임포트 마법사 2단계 — 실제 쓰기(§6.6). append 는 기존 import_wbs 와 동일하게 삽입만,
 * replace 는 백업 선행 후 전체 교체(§6.6-2). 팀 부트스트랩(§10.3)은 이 라우트가 유일한 진입점이다.
 * 판정 대상 프로젝트가 본문에 있어 폼을 먼저 읽는다 — 파싱·DB 접근은 가드 통과 후에만 한다.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const file = form.get('file') as File | null
  const projectId = String(form.get('projectId') ?? '')
  const profileRaw = String(form.get('profile') ?? '')
  const mode = String(form.get('mode') ?? '')
  const saveProfile = form.get('saveProfile') === 'true'
  const registerTeams = form.get('registerTeams') === 'true'
  // 구분 라벨 반영은 기본 꺼짐 — 켜짐이면 협력사 엑셀을 평범하게 append 하는 것만으로 운영 프로젝트의
  // 어휘가 바뀌고(주간보고·RAG 임베딩까지 따라 바뀐다) 이력이 없어 되돌릴 수 없다. fail-safe 쪽을 기본값으로 둔다.
  const applyLevelLabels = form.get('applyLevelLabels') === 'true'

  if (!file || !projectId || !profileRaw) {
    return NextResponse.json({ error: '파일/프로젝트/프로파일 누락' }, { status: 400 })
  }
  if (mode !== 'append' && mode !== 'replace') {
    return NextResponse.json({ error: "mode는 'append' 또는 'replace' 여야 합니다" }, { status: 400 })
  }
  // agent-loop 교훈 — 비 UUID 를 그대로 흘리면 가드·쿼리가 엉뚱한 에러로 새어나간다. 가드보다 먼저 막는다.
  if (!isUuidLike(projectId)) {
    return NextResponse.json({ error: '프로젝트 식별자 형식이 올바르지 않습니다' }, { status: 400 })
  }

  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: AUTHZ_STATUS[g.error] ?? 500 })

  let profileJson: unknown
  try {
    profileJson = JSON.parse(profileRaw)
  } catch {
    return NextResponse.json({ error: '프로파일 JSON 형식이 올바르지 않습니다' }, { status: 400 })
  }
  const validated = validateProfile(profileJson)
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })
  const profile = validated.profile

  // 버퍼를 변수로 승격한다 — 아래 라벨 재유도(readHierarchyHeaders)가 같은 버퍼를 재사용해야 한다.
  // file.arrayBuffer() 를 두 번 부르면 대용량 워크북에서 메모리가 2배가 된다.
  const buf = await file.arrayBuffer()
  const parsed = parseWithProfile(buf, profile)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // 구조 검증(linkByDepth) 을 팀 부트스트랩보다 먼저 통과시킨다(리뷰 Minor). 원래 순서는 팀 등록이
  // 먼저라 링킹이 400 으로 실패해도 전역 팀 마스터에 이미 등록된 팀이 남는 부수효과가 있었다 — 검증에
  // 실패하는 요청은 아무 부수효과도 남기지 않아야 한다.
  const linked = linkByDepth(parsed.rows, { legacyLevelLabels: resolveLegacyLevelLabels(profile) })
  if (!linked.ok) return NextResponse.json({ errors: linked.errors }, { status: 400 })

  // 팀 마스터 대조(§10.3) — 대조 기준도 등록 스코프도 프로젝트 팀 정의 여부를 따른다(0071).
  const projectDefined = projectTeamRowsSync(projectId).length > 0
  const registered = new Set(teamsForProjectSync(projectId).map(t => t.code))
  const unknownTeams = [...new Set(parsed.rows.flatMap(r => r.owners.map(o => o.team)))]
    .filter(t => !registered.has(t))

  if (unknownTeams.length > 0) {
    if (!registerTeams) {
      return NextResponse.json({ needsTeams: unknownTeams, scope: projectDefined ? 'project' : 'global' }, { status: 409 })
    }
    if (projectDefined) {
      // 프로젝트 팀으로 등록 — 라우트 상단 가드(관리자)로 충분, 시드 폴더 없음(addProjectTeam 계약).
      for (const team of unknownTeams) {
        const added = await addProjectTeam(projectId, team)
        if (!added.ok) {
          return NextResponse.json({ error: `팀 등록 실패: ${team} — ${added.error}` }, { status: 500 })
        }
      }
    } else {
      // 전역 상속 프로젝트(D-CUBE)는 현행 유지 — 전역 마스터 등록은 슈퍼유저만.
      const su = await requireSuperuser()
      if (!su.ok) return NextResponse.json({ error: '팀 등록은 슈퍼유저 권한' }, { status: 403 })
      for (const team of unknownTeams) {
        const added = await addTeam(team)
        if (!added.ok) {
          return NextResponse.json({ error: `팀 등록 실패: ${team} — ${added.error}` }, { status: 500 })
        }
      }
    }
  }

  const items = splitLeafOwners(linked.items)

  const sb = await createServerClient()
  let count: number
  let backup: { rows: unknown[]; generatedAt: string } | undefined
  const warnings: string[] = []

  if (mode === 'replace') {
    // 백업 먼저(§6.6-2, Q1: wbs_items 전 컬럼만 — change_logs 는 대상 아님). 실패 시 RPC 를 호출하지 않고 중단한다.
    const { data: backupRows, error: backupErr } = await sb
      .from('wbs_items').select('*').eq('project_id', projectId)
    if (backupErr) {
      console.error('[import/execute] replace 백업 select 실패 — RPC 미호출:', backupErr.message)
      return NextResponse.json({ error: `백업 생성 실패로 중단했습니다: ${backupErr.message}` }, { status: 500 })
    }
    backup = { rows: backupRows ?? [], generatedAt: new Date().toISOString() }
    warnings.push(...REPLACE_WARNINGS)

    const { data, error } = await sb.rpc('replace_wbs', {
      p_project_id: projectId, p_items: items, p_holidays: parsed.holidays,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    count = typeof data === 'number' ? data : items.length
  } else {
    const { data, error } = await sb.rpc('import_wbs', {
      p_project_id: projectId, p_items: items, p_holidays: parsed.holidays,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    count = typeof data === 'number' ? data : items.length
  }

  // ── project_settings 쓰기(프로파일 저장 Q4 + 구분 라벨 갱신) — 두 갱신을 upsert '하나'로 합류시킨다.
  //    따로 쓰면 뒤 쓰기가 앞 페이로드 밖 컬럼을 INSERT 분기에서 DB default 로 되돌린다.
  //    project_settings 는 쓰기 정책이 없다(0058 service_role 전용 관문, createProject 시드와 동일 경로).
  //    라벨 갱신을 임포트 본체 '뒤'에 두는 이유 — 임포트가 400/500 으로 실패한 요청은 어휘도 바꾸지 않는다.
  let profileSaved = false
  let levelLabels: LevelLabelsResult | undefined
  if (saveProfile || applyLevelLabels) {
    // 쓰기 전 선행 조회(3원칙). upsert 가 INSERT 로 떨어지면 페이로드에 없는 컬럼이 DB default 를 먹어
    // milestone_keywords 가 빈 배열이 되고 마일스톤 카드가 무증상 소실된다 — 현재 값을 읽어 전량 동반한다.
    let config: Awaited<ReturnType<typeof getProjectConfig>> | null = null
    try {
      config = await getProjectConfig(projectId, sb)
    } catch (e) {
      // 임포트 본체는 이미 성공했다 — 200 을 뒤집지 않되, 무엇을 못 했는지는 숨기지 않는다(표시 = 로깅).
      const reason = `프로젝트 설정 조회 실패로 저장을 건너뛰었습니다: ${e instanceof Error ? e.message : String(e)}`
      console.error('[import/execute] project_settings 선행 조회 실패 — 쓰기 미실행:', e)
      warnings.push(reason)
      if (applyLevelLabels) levelLabels = { applied: false, reason }
    }

    if (config) {
      const before = config.levelLabels
      let nextLabels: string[] | null = null

      if (applyLevelLabels) {
        // 라벨 문자열은 클라이언트에서 받지 않고 업로드된 파일에서 다시 읽는다. '클라이언트 불신'이 아니라
        // 파싱에 쓴 좌표계(profile)를 그대로 재사용해 라벨-파싱 불일치를 없애기 위함이다.
        // 값의 안전성은 normalizeLevelLabels 가 담당한다.
        const skip = (reason: string) => {
          warnings.push(reason)
          levelLabels = { applied: false, reason }
        }
        const headers = readHierarchyHeaders(buf, profile)
        if (!headers) {
          skip('엑셀에서 계층 열 헤더를 읽지 못해 구분 라벨을 갱신하지 않았습니다.')
        } else {
          const derived = proposeLevelLabels(headers, profile)
          if (!derived) {
            skip('헤더가 구분 라벨로 적합하지 않아 갱신하지 않았습니다(빈 헤더·중복·시스템 생성 헤더).')
          } else {
            // 3열 엑셀을 4라벨 프로젝트에 올려도 4번째 라벨이 잘려 depth 3 표기가 퇴화하지 않도록 기존 값과 병합한다.
            const normalized = normalizeLevelLabels(mergeLevelLabels(derived, before))
            if (!normalized.ok) skip(`구분 라벨 검증 실패로 갱신하지 않았습니다: ${normalized.reason}`)
            else nextLabels = normalized.labels
          }
        }
      }

      const admin = createAdminClient()
      // 0058 project_settings 는 updated_at 트리거가 없다(0038 주석 관례 계승) — UPDATE 분기에서는
      // 컬럼 default now() 가 타지 않으므로 앱이 두 필드를 직접 채운다(actions/llmConfig.ts:285 선례).
      const { error: upsertErr } = await admin
        .from('project_settings')
        .upsert(
          {
            project_id: projectId,
            // INSERT 로 떨어질 때를 대비해 프리셋 컬럼 전량을 동반한다. UPDATE 로 떨어지면 방금 읽은
            // 현재값을 그대로 다시 쓰는 것이라 무변경이다.
            level_labels: nextLabels ?? before,
            max_depth: config.maxDepth,
            extra_axis_label: config.extraAxisLabel,
            // 설정 행이 아예 없으면 getProjectConfig 가 DEFAULT(빈 키워드)를 준다 — 그대로 INSERT 하면
            // 마일스톤 카드가 무증상 소실되므로 기본 프리셋 어휘로 채운다(빈 배열 금지 계약).
            milestone_keywords: config.milestoneKeywords.length > 0
              ? config.milestoneKeywords
              : [...PRESETS.standard4.milestoneKeywords],
            ...(saveProfile ? { excel_profile: profile } : {}),
            updated_by: g.actor.userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'project_id' },
        )
      if (upsertErr) {
        console.error('[import/execute] project_settings 저장 실패(무시):', upsertErr.message)
        if (nextLabels) {
          const reason = `구분 라벨 저장 실패: ${upsertErr.message}`
          warnings.push(reason)
          levelLabels = { applied: false, reason }
        }
      } else {
        if (saveProfile) profileSaved = true
        if (nextLabels) levelLabels = { applied: true, before, after: nextLabels }
      }
    }
  }

  // 임포트는 실적·계획 전면 교체(또는 신규 반영) — 즉시 스냅샷 기록(라우트라 await로 충분).
  await recordProgressSnapshot(projectId)

  // 임포트 성공 후 DK Bot 의미검색 색인 갱신(베스트에포트 — 임베딩 키 없으면 자동 skip).
  // 라벨은 임베딩 본문에 들어가므로 위 갱신 뒤에 부르는 순서가 중요하다(stale 색인 방지).
  let reindexed = 0
  try {
    reindexed = (await ingestProject(projectId)).count
  } catch (e) {
    console.error('[dkbot] 임포트 후 색인 실패(무시):', e)
  }

  return NextResponse.json({
    ok: true,
    count,
    mode: mode as ImportMode,
    reindexed,
    ...(backup ? { backup } : {}),
    profileSaved,
    // 기본 경로(applyLevelLabels=false·saveProfile=false)에서는 이 필드가 붙지 않는다 —
    // tests/api/import-execute.test.ts:320 이 응답 바디를 정확일치로 단정한다.
    ...(levelLabels ? { levelLabels } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  })
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run tests/api/import-execute.test.ts`
Expected: PASS — 특히 기본 경로 응답 정확일치와 `admin.upsert` 미호출 두 감시선이 초록

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/import/execute/route.ts tests/api/import-execute.test.ts
git commit -m "feat: 임포트 시 엑셀 계층 헤더를 구분 라벨로 반영

라벨 문자열은 클라이언트에서 받지 않고 업로드된 파일에서 다시 읽는다 —
클라이언트 불신이 아니라 파싱에 쓴 좌표계를 재사용해 라벨과 파싱이
어긋나지 않게 하려는 것이다.

프로파일 저장과 라벨 갱신을 upsert 하나로 합류시킨다. 따로 쓰면 뒤 쓰기가
앞 페이로드 밖 컬럼을 INSERT 분기에서 DB default 로 되돌려, 마일스톤
키워드가 빈 배열이 되고 카드가 무증상 소실된다."
```

---

### Task 6: 임포트 마법사 — 체크박스와 대비 표시

기본값은 **꺼짐**이다(§11-2). 협력사 엑셀을 평범하게 append 하는 것만으로 운영 프로젝트의 어휘가
바뀌고 주간보고·RAG 임베딩까지 따라 바뀌는데, `project_settings` 는 트리거도 이력도 없고
마이그레이션 0건이라 `git revert` 로도 되돌아오지 않는다.

**Files:**
- Modify: `src/lib/domain/importWizard.ts`
- Modify: `src/components/import/ImportWizard.tsx` (편집 4곳)
- Modify: `src/app/(app)/p/[projectId]/import/page.tsx` (현재 라벨 공급 — 아래 Step 7)
- Modify: `src/lib/i18n/dict/importWizard.ts` (ko/en 동시)
- Test: `tests/ui/import-wizard-state.test.ts` (리듀서 케이스 추가)

**Interfaces:**
- Consumes: Task 1 의 `proposeLevelLabels` (제안 미리보기 계산) · Task 5 의 응답 `levelLabels`
- Produces: `WizardState.applyLevelLabels: boolean` · 액션 `{ type: 'applyLevelLabelsChanged'; value: boolean }` · `ExecuteLevelLabels` 타입(Task 5 라우트의 `LevelLabelsResult` 와 구조 동일) · `ImportWizard` 의 신규 prop `currentLevelLabels: string[] | null` — **`null` 은 "현재 라벨을 못 읽었다"** 는 뜻이고 대비 표가 그 사실을 표시한다(조회 실패를 "라벨 없음"으로 위장하지 않는다 — 에러 처리 3원칙)

- [ ] **Step 1: 리듀서 테스트를 쓴다**

액션 1개당 `it` 1개가 이 파일의 관례다.

> 기존 describe `'importWizard reducer — 상태 전이(§6.2)'` 안, resetToDetected 케이스(:88-90) 뒤에 이어 붙인다. OUTLINE_DETECTION 픽스처는 파일 상단 DETECTION(:9-15) 바로 아래에 둔다. 스펙 §12 의 5개 요구(초기값 columns/outline · outline 전환 강제 false · fileSelected·reset 리셋)를 액션 1개당 it 1개 관례로 나눴다.

```typescript
// ── 파일 상단, DETECTION 상수 바로 아래 ──────────────────────────────────────
const OUTLINE_DETECTION: DetectionResult = {
  ...DETECTION,
  profile: { ...LEGACY_DCUBE_PROFILE, hierarchy: { kind: 'outline', column: 0 } },
}

// ── describe('importWizard reducer — 상태 전이(§6.2)') 안, resetToDetected 케이스 뒤 ──
  it('applyLevelLabelsChanged — 체크 상태만 바꾼다. 초기값은 꺼짐(파괴적 방향은 fail-safe — 설계 §5·§11-2)', () => {
    expect(initialWizardState.applyLevelLabels).toBe(false)
    const on = reducer(initialWizardState, { type: 'applyLevelLabelsChanged', applyLevelLabels: true })
    expect(on.applyLevelLabels).toBe(true)
    expect(reducer(on, { type: 'applyLevelLabelsChanged', applyLevelLabels: false }).applyLevelLabels).toBe(false)
  })

  it('profileChanged — outline 으로 전환하면 applyLevelLabels 를 false 로 되돌린다(레벨별 헤더가 없다 — 설계 §2)', () => {
    const checked = reducer(
      reducer(initialWizardState, { type: 'inspectSuccess', detection: DETECTION, savedProfile: null }),
      { type: 'applyLevelLabelsChanged', applyLevelLabels: true },
    )
    expect(checked.applyLevelLabels).toBe(true)
    const outline = reducer(checked, { type: 'profileChanged', profile: switchHierarchyKind(checked.profile!, 'outline') })
    expect(outline.applyLevelLabels).toBe(false)
  })

  it('profileChanged — columns 안에서의 편집(논리 열 등)은 체크 상태를 보존한다', () => {
    const checked = reducer(
      reducer(initialWizardState, { type: 'inspectSuccess', detection: DETECTION, savedProfile: null }),
      { type: 'applyLevelLabelsChanged', applyLevelLabels: true },
    )
    const edited = reducer(checked, { type: 'profileChanged', profile: setLogicalColumn(checked.profile!, 'weight', 9) })
    expect(edited.applyLevelLabels).toBe(true)
  })

  it('resetToDetected — 감지 프로파일이 outline 이면 applyLevelLabels 도 함께 내린다(profileChanged 와 같은 불변식)', () => {
    const started = reducer(initialWizardState, {
      type: 'inspectSuccess', detection: OUTLINE_DETECTION, savedProfile: LEGACY_DCUBE_PROFILE,
    })
    const checked = reducer(started, { type: 'applyLevelLabelsChanged', applyLevelLabels: true })
    expect(checked.applyLevelLabels).toBe(true)
    const reverted = reducer(checked, { type: 'resetToDetected' })
    expect(reverted.profile).toBe(OUTLINE_DETECTION.profile)
    expect(reverted.applyLevelLabels).toBe(false)
  })

  it('fileSelected — 파일이 바뀌면 제안 자체가 달라지므로 applyLevelLabels 도 꺼짐으로 되돌린다', () => {
    const checked = reducer(initialWizardState, { type: 'applyLevelLabelsChanged', applyLevelLabels: true })
    expect(reducer(checked, { type: 'fileSelected', fileName: 'b.xlsx' }).applyLevelLabels).toBe(false)
  })

  it('reset — applyLevelLabels 도 초기값(꺼짐)으로 되돌린다', () => {
    const checked = reducer(initialWizardState, { type: 'applyLevelLabelsChanged', applyLevelLabels: true })
    expect(reducer(checked, { type: 'reset' })).toEqual(initialWizardState)
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/ui/import-wizard-state.test.ts`
Expected: FAIL — `applyLevelLabels` 가 상태에 없다

- [ ] **Step 3: 리듀서를 고친다**

> 파일 앞부분(1~130행)을 이 블록으로 교체한다. 131행 이후(setOutlineColumn 이하)는 무변경. 변경점 5개: ExecuteLevelLabels 타입 신설 + ExecuteResult.levelLabels 옵셔널 필드 / WizardState.applyLevelLabels / initialWizardState 기본 false / applyLevelLabelsChanged 액션 / profileChanged·resetToDetected 에서 outline 강제 false. switchHierarchyKind 함수 본체는 손대지 않는다 — 그 함수는 순수 변환일 뿐이고 dispatch 는 profileChanged 로 들어오므로 강제 규칙은 리듀서에 둔다.

```typescript
/** 임포트 마법사(B8) 상태 전이 — 순수 함수만 둔다. `ImportWizard` 컴포넌트가 그대로 소비한다.
 *  네트워크 호출(inspect/execute)·파일 보관(File 객체)은 컴포넌트 쪽 책임 — 여기는 상태 계산만. */

import type { ExcelProfile } from '@/lib/excel/profile'
import type { DetectionResult } from '@/lib/excel/detect'
import type { ImportError } from '@/lib/excel/validate'

export type ImportMode = 'append' | 'replace'

/** 라벨 반영 결과(설계 §5). `project_settings` 에는 트리거도 이력 테이블도 없어 이 응답이
 *  수동 복구의 유일한 좌표다 — 그래서 건너뛴 경우의 사유까지 판별 가능한 합타입으로 받는다. */
export type ExecuteLevelLabels =
  | { applied: true; before: string[]; after: string[] }
  | { applied: false; reason: string }

/** `/api/import/execute` 200 응답 바디(§B6) — ok 는 판별에만 쓰고 이 타입엔 담지 않는다. */
export interface ExecuteResult {
  count: number
  mode: ImportMode
  reindexed: number
  backup?: { rows: unknown[]; generatedAt: string }
  profileSaved: boolean
  warnings?: string[]
  /** 반드시 옵셔널이다 — 기본 경로(applyLevelLabels=false)에서는 응답 필드가 하나도 늘지 않아야
   *  하고(설계 §5), tests/api/import-execute.test.ts 가 응답 바디를 정확일치로 단정하고 있다. */
  levelLabels?: ExecuteLevelLabels
}

export type WizardStep = 'select' | 'review' | 'done'

export interface WizardState {
  step: WizardStep
  fileName: string | null
  detection: DetectionResult | null
  profile: ExcelProfile | null
  mode: ImportMode
  saveProfile: boolean
  /** 엑셀의 계층 열 헤더를 이 프로젝트의 WBS 구분(level_labels)으로 반영할지(설계 §5).
   *  기본값 false — 켜면 협력사 엑셀을 평범하게 append 하는 것만으로 운영 프로젝트의 어휘가 바뀌고
   *  주간보고 표기·RAG 임베딩까지 따라 바뀌는데, 이력도 트리거도 없어 되돌릴 좌표가 남지 않는다.
   *  파괴적 방향일 때 fail-safe 를 기본값으로 두는 이 리포의 관례(§11-2). */
  applyLevelLabels: boolean
  busy: boolean
  error: string | null
  errors: ImportError[] | null
  needsTeams: string[] | null
  /** 409 응답의 등록 스코프(0071) — 팀 정의 프로젝트는 'project'(관리자 게이트로 충분),
   *  전역 상속 프로젝트는 'global'(기존대로 슈퍼유저 게이트). needsTeams 와 함께 지운다. */
  needsTeamsScope: 'project' | 'global' | null
  result: ExecuteResult | null
}

export const initialWizardState: WizardState = {
  step: 'select',
  fileName: null,
  detection: null,
  profile: null,
  mode: 'append',
  saveProfile: true,
  applyLevelLabels: false,
  busy: false,
  error: null,
  errors: null,
  needsTeams: null,
  needsTeamsScope: null,
  result: null,
}

export type WizardAction =
  | { type: 'fileSelected'; fileName: string }
  | { type: 'inspectStart' }
  | { type: 'inspectSuccess'; detection: DetectionResult; savedProfile: ExcelProfile | null }
  | { type: 'inspectFailure'; error: string }
  | { type: 'profileChanged'; profile: ExcelProfile }
  | { type: 'modeChanged'; mode: ImportMode }
  | { type: 'saveProfileChanged'; saveProfile: boolean }
  | { type: 'applyLevelLabelsChanged'; applyLevelLabels: boolean }
  | { type: 'executeStart' }
  | { type: 'executeNeedsTeams'; teams: string[]; scope: 'project' | 'global' }
  | { type: 'dismissNeedsTeams' }
  | { type: 'executeFailure'; error: string }
  | { type: 'executeValidationFailure'; errors: ImportError[] }
  | { type: 'executeSuccess'; result: ExecuteResult }
  | { type: 'reset' }
  | { type: 'resetToDetected' }

/** outline 계층에는 '레벨별 헤더'라는 것이 존재하지 않아 라벨 제안 자체를 하지 않는다(설계 §2).
 *  그때 체크박스는 화면에서 사라지는데 값만 true 로 남으면 실행 시점에 무엇이 반영될지가 화면과
 *  어긋난다. profile 이 바뀌는 모든 경로에서 같은 규칙으로 내린다 — switchHierarchyKind 는 순수
 *  변환일 뿐이고 dispatch 는 profileChanged 로 들어오므로 강제 지점은 여기 하나면 충분하다. */
function levelLabelsFlagFor(profile: ExcelProfile, current: boolean): boolean {
  return profile.hierarchy.kind === 'columns' ? current : false
}

/** 2단계 진입 기본값 계약(§6.2): savedProfile ?? detection.profile. */
export function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'fileSelected':
      // 파일을 바꾸면 이전 감지·편집 결과는 전부 무효 — 처음부터 다시 진행한다.
      return { ...initialWizardState, fileName: action.fileName }
    case 'inspectStart':
      return { ...state, busy: true, error: null }
    case 'inspectSuccess':
      return {
        ...state,
        busy: false,
        step: 'review',
        detection: action.detection,
        profile: action.savedProfile ?? action.detection.profile,
        error: null,
      }
    case 'inspectFailure':
      return { ...state, busy: false, error: action.error }
    case 'profileChanged':
      return { ...state, profile: action.profile, applyLevelLabels: levelLabelsFlagFor(action.profile, state.applyLevelLabels) }
    case 'modeChanged':
      return { ...state, mode: action.mode }
    case 'saveProfileChanged':
      return { ...state, saveProfile: action.saveProfile }
    case 'applyLevelLabelsChanged':
      return { ...state, applyLevelLabels: action.applyLevelLabels }
    case 'executeStart':
      return { ...state, busy: true, error: null, errors: null, needsTeams: null, needsTeamsScope: null }
    case 'executeNeedsTeams':
      return { ...state, busy: false, needsTeams: action.teams, needsTeamsScope: action.scope }
    case 'dismissNeedsTeams':
      return { ...state, needsTeams: null, needsTeamsScope: null }
    case 'executeFailure':
      return { ...state, busy: false, error: action.error, needsTeams: null, needsTeamsScope: null }
    case 'executeValidationFailure':
      return { ...state, busy: false, errors: action.errors, needsTeams: null, needsTeamsScope: null }
    case 'executeSuccess':
      return { ...state, busy: false, step: 'done', result: action.result, error: null, errors: null, needsTeams: null, needsTeamsScope: null }
    case 'reset':
      return initialWizardState
    // 리뷰 Important #2 — savedProfile 로 시작한 2단계에서도 업로드 파일이 실제로 감지한 프로파일로
    // 되돌릴 길이 있어야 한다(레거시 프로젝트가 새 양식 파일을 저장된 옛 프로파일로 잘못 해석해
    // 임포트를 막아버리는 사고 방지). detection 이 없으면(있을 수 없는 상태지만) 무변화.
    case 'resetToDetected':
      return state.detection
        ? { ...state, profile: state.detection.profile, applyLevelLabels: levelLabelsFlagFor(state.detection.profile, state.applyLevelLabels) }
        : state
    default:
      return state
  }
}

/** 계층 방식 전환 — columns↔outline. 반대편에 없던 필드는 합리적 기본값으로 재구성한다.
 *  columns 로 돌아가면 name 은 다시 null(계층 열 자체가 이름의 출처 — profile.ts 규약). */
export function switchHierarchyKind(profile: ExcelProfile, kind: 'columns' | 'outline'): ExcelProfile {
  if (profile.hierarchy.kind === kind) return profile
  if (kind === 'outline') {
    const column = profile.hierarchy.kind === 'columns' ? profile.hierarchy.columns[0] : 0
    return { ...profile, hierarchy: { kind: 'outline', column } }
  }
  const column = profile.hierarchy.kind === 'outline' ? profile.hierarchy.column : 0
  return { ...profile, hierarchy: { kind: 'columns', columns: [column] }, logical: { ...profile.logical, name: null } }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/ui/import-wizard-state.test.ts`
Expected: PASS

- [ ] **Step 5: i18n 키를 추가한다 (ko/en 동시)**

> ko 는 saveProfileLabel(64행) 아래 한 그룹, done 키는 doneWarningsTitle(99행) 아래 한 그룹으로 넣는다. en 은 같은 순서·같은 위치(175행 / 210행)에 넣는다 — 누락은 npm run test 가 아니라 npm run build 에서만 잡힌다(§10-6).

```typescript
// ── importWizardKo: 'importWizard.saveProfileLabel' 바로 아래 ──────────────────
  'importWizard.applyLevelLabelsLabel': '엑셀 헤더를 이 프로젝트의 WBS 구분으로 반영',
  'importWizard.applyLevelLabelsDesc': '계층 열 헤더가 WBS 구분이 됩니다 — 항목 배지·주간보고 Lv·AI 색인 표기가 함께 바뀝니다. 되돌리려면 프로젝트 설정에서 직접 고쳐야 합니다(변경 이력이 남지 않습니다).',
  'importWizard.levelLabelsCurrent': '현재 구분',
  'importWizard.levelLabelsProposed': '반영 후 구분',
  'importWizard.levelLabelsCurrentUnknown': '확인할 수 없음(설정 조회 실패)',

// ── importWizardKo: 'importWizard.doneWarningsTitle' 바로 아래 ─────────────────
  'importWizard.doneLevelLabelsTitle': 'WBS 구분',
  'importWizard.doneLevelLabelsBefore': '반영 전',
  'importWizard.doneLevelLabelsAfter': '반영 후',
  'importWizard.doneLevelLabelsSkipped': '구분은 반영하지 않았습니다 — ',

// ── importWizardEn: 'importWizard.saveProfileLabel' 바로 아래 ──────────────────
  'importWizard.applyLevelLabelsLabel': "Apply the Excel headers as this project's WBS levels",
  'importWizard.applyLevelLabelsDesc': 'The hierarchy column headers become the WBS level names — item badges, weekly report levels and the AI index all follow. Undoing requires editing them in project settings (no change history is kept).',
  'importWizard.levelLabelsCurrent': 'Current levels',
  'importWizard.levelLabelsProposed': 'After import',
  'importWizard.levelLabelsCurrentUnknown': 'Unavailable (settings lookup failed)',

// ── importWizardEn: 'importWizard.doneWarningsTitle' 바로 아래 ─────────────────
  'importWizard.doneLevelLabelsTitle': 'WBS levels',
  'importWizard.doneLevelLabelsBefore': 'Before',
  'importWizard.doneLevelLabelsAfter': 'After',
  'importWizard.doneLevelLabelsSkipped': 'Levels were not applied — ',
```

- [ ] **Step 6: UI 를 붙인다 (편집 4곳)**

리뷰 단계에 체크박스와 현재→제안 대비를, 완료 단계에 before/after 를 표시한다.
`replace` 는 되돌릴 수 없고 라벨 갱신도 이력이 남지 않으므로, 이 표가 실행 전 유일한 검증면이다.
각 블록 앞의 인용문이 삽입 위치다 — 순서대로 적용한다.

> [편집 1/4] import 블록(16-20행)에 levelLabels 순수함수 2종을 추가하고, 컴포넌트 시그니처(117-125행)에 currentLevelLabels prop 을, 파생값 구역(135-142행)에 levelLabelProposal·doneLevelLabels 를 추가한다. doneLevelLabels 를 render 밖 const 로 뽑는 이유는 JSX 안에서 `state.result.levelLabels` 경로를 두 번 좁히지 않기 위함(합타입 narrowing 을 const 로 고정).

```tsx
import {
  reducer, initialWizardState, switchHierarchyKind, setOutlineColumn, setLogicalColumn,
  recordToRows, rowsToRecord, deriveMappedPreview, type MarkRow, type ExecuteResult,
  type PreviewColumnRole,
} from '@/lib/domain/importWizard'
import { proposeLevelLabels, mergeLevelLabels } from '@/lib/domain/levelLabels'

// …(중략: LOGICAL_FIELD_LABEL_KEYS ~ radioRowClass 무변경)…

export function ImportWizard({
  projectId, isSuperuser, currentItemCount, currentLevelLabels,
}: {
  projectId: string
  isSuperuser: boolean
  /** replace 경고에 실제 삭제 건수를 싣기 위한 값(리뷰 Important #1) — 서버 조회 실패 시 null 로
   *  degrade 되어 온다(page.tsx 가 표시=로깅). null 이면 건수 없는 일반 경고 문구로 대체한다. */
  currentItemCount: number | null
  /** 리뷰 단계의 '현재 → 제안' 대비에 쓸 현재 WBS 구분(설계 §5). currentItemCount 와 같은 관례로
   *  조회 실패 시 null 로 degrade — 그때는 '확인 불가' 문구로 바꿔 표시하고 체크박스는 살려 둔다
   *  (현재 값을 못 읽는 것과 반영이 불가능한 것은 다르다. 실제 저장 값은 서버가 다시 정한다). */
  currentLevelLabels: string[] | null
}) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()
  const [state, dispatch] = useReducer(reducer, initialWizardState)
  const [markRows, setMarkRows] = useState<MarkRow[]>([])
  const [exportBusy, setExportBusy] = useState(false)
  const fileRef = useRef<File | null>(null)
  const markIdRef = useRef(0)

  const headers = state.detection?.preview.headers ?? []
  const profile = state.profile
  // 계층 방식·논리 열 편집이 표에 즉시 반영돼야 한다(리뷰 Important #2 — replace 비가역성의 유일한
  // 검증면). 원본 재파싱 없이 detection.preview 를 현재 profile 로 재라벨링만 하므로 가볍다.
  const mappedPreview = useMemo(
    () => (state.detection && profile ? deriveMappedPreview(state.detection.preview.headers, state.detection.preview.rows, profile) : null),
    [state.detection, profile],
  )

  // 계층 열 헤더 → 반영될 구분(설계 §2·§5). proposeLevelLabels 가 null 이면(outline·중복·빈 헤더·
  // 시스템 생성 헤더) 제안 자체를 포기하고 체크박스도 렌더하지 않는다 — 무증상 오염 방지.
  // merge 까지 태워서 보여주는 이유: 3열 엑셀을 4구분 프로젝트에 올리면 4번째 라벨이 보존되는데,
  // 그 사실이 표에 안 보이면 사용자가 '구분이 3개로 줄었다'고 오해한다.
  const levelLabelProposal = useMemo(() => {
    if (!state.detection || !profile) return null
    const derived = proposeLevelLabels(state.detection.preview.headers, profile)
    return derived ? mergeLevelLabels(derived, currentLevelLabels ?? []) : null
  }, [state.detection, profile, currentLevelLabels])

  // 완료 화면의 before/after — 합타입 narrowing 을 JSX 안에서 반복하지 않도록 const 로 고정한다.
  const doneLevelLabels = state.result?.levelLabels ?? null
```
> [편집 2/4] runExecute 의 폼 필드 — saveProfile append(224행) 바로 다음 줄에 추가한다.

```tsx
      fd.append('saveProfile', String(state.saveProfile))
      // 제안이 사라진 상태(outline 전환 등)에서 체크만 남아 있을 수 없도록 값과 제안을 함께 본다.
      // 서버도 파일에서 헤더를 다시 읽지만(§5), 켜지지 않은 요청은 라벨 경로를 아예 타지 않아야
      // 기본 경로에서 admin 클라이언트가 호출되지 않는다는 계약이 유지된다.
      fd.append('applyLevelLabels', String(state.applyLevelLabels && levelLabelProposal !== null))
      fd.append('registerTeams', String(registerTeams))
```
> [편집 3/4] 리뷰(2단계) 체크박스 + 현재→제안 대비. saveProfile 라벨(501-511행) 바로 뒤, 설정 카드를 닫는 512행 `</div>` 앞에 삽입한다. saveProfile 체크박스의 input 관례(h-4 w-4 rounded accent-[var(--color-brand)] / disabled={state.busy} / aria-label=라벨문구)를 그대로 따르고, 설명문이 붙어야 하므로 items-center 대신 items-start + mt-0.5 를 쓴다(모드 라디오 501행 계열과 동일한 처리).

```tsx
            {/* ── WBS 구분 반영(설계 §5) ── 기본값은 꺼짐이다. 켜면 계층 열 헤더가 이 프로젝트의
                구분이 되어 배지·주간보고 Lv·RAG 임베딩까지 따라 바뀌는데, project_settings 에는
                이력도 트리거도 없어 git revert 로도 되돌아오지 않는다(§11-2). replace 경고와 같은
                이유로, 실행 전 유일한 검증면인 대비 표를 체크박스 바로 옆에 둔다. */}
            {levelLabelProposal && (
              <div className="rounded-xl border border-line bg-surface-2 p-3.5">
                <label className="flex items-start gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded accent-[var(--color-brand)]"
                    checked={state.applyLevelLabels}
                    disabled={state.busy}
                    onChange={e => dispatch({ type: 'applyLevelLabelsChanged', applyLevelLabels: e.target.checked })}
                    aria-label={t('importWizard.applyLevelLabelsLabel')}
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">{t('importWizard.applyLevelLabelsLabel')}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-ink-muted">{t('importWizard.applyLevelLabelsDesc')}</span>
                  </span>
                </label>
                <dl className="mt-3 grid gap-2 pl-6 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="eyebrow">{t('importWizard.levelLabelsCurrent')}</dt>
                    <dd className="mt-1 flex flex-wrap gap-1">
                      {currentLevelLabels === null ? (
                        <span className="text-ink-subtle">{t('importWizard.levelLabelsCurrentUnknown')}</span>
                      ) : (
                        currentLevelLabels.map((label, i) => (
                          <span key={i} className="badge bg-surface px-2 py-0.5 text-ink-muted">{label}</span>
                        ))
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow">{t('importWizard.levelLabelsProposed')}</dt>
                    <dd className="mt-1 flex flex-wrap gap-1">
                      {levelLabelProposal.map((label, i) => (
                        <span key={i} className="badge bg-brand-weak px-2 py-0.5 text-brand">{label}</span>
                      ))}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
```
> [편집 4/4] 완료 화면 before/after. 요약 `<dl>`(596-609행) 다음, warnings 블록(611행) 앞에 삽입한다. 응답에 levelLabels 가 없으면(기본 경로) 아무것도 렌더하지 않으므로 기존 화면은 그대로다.

```tsx
          {/* 설계 §5 — 라벨 변경에는 이력 테이블이 없다. 이 before/after 가 수동 복구의 유일한
              좌표이므로 성공만이 아니라 '건너뜀 + 사유'도 같이 보여준다(조용히 삼키지 않는다 —
              에러 처리 3원칙). 저장된 값은 서버가 파일에서 다시 읽은 것이라 2단계의 제안과
              다를 수 있다(§10-2 headerRow 불일치) — 그래서 여기가 정본이다. */}
          {doneLevelLabels && (
            <div className="panel-soft p-4">
              <p className="text-sm font-semibold text-ink">{t('importWizard.doneLevelLabelsTitle')}</p>
              {doneLevelLabels.applied ? (
                <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="eyebrow">{t('importWizard.doneLevelLabelsBefore')}</dt>
                    <dd className="mt-1 flex flex-wrap gap-1">
                      {doneLevelLabels.before.map((label, i) => (
                        <span key={i} className="badge bg-surface-2 px-2 py-0.5 text-ink-muted">{label}</span>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow">{t('importWizard.doneLevelLabelsAfter')}</dt>
                    <dd className="mt-1 flex flex-wrap gap-1">
                      {doneLevelLabels.after.map((label, i) => (
                        <span key={i} className="badge bg-brand-weak px-2 py-0.5 text-brand">{label}</span>
                      ))}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-1 text-xs leading-5 text-ink-muted">
                  {t('importWizard.doneLevelLabelsSkipped')}{doneLevelLabels.reason}
                </p>
              )}
            </div>
          )}
```

- [ ] **Step 7: 현재 라벨을 공급한다**

리뷰 단계의 '현재 → 제안' 대비에는 프로젝트의 **현재** 라벨이 필요한데, 마법사는 그것을 모른다.
같은 파일의 `fetchWbsItemCount` 관례(조회 실패는 로그만 남기고 degrade)를 그대로 복제해 넘긴다.
설계 §9 의 수정 파일 목록에 없던 파일이지만, 이것 없이는 Step 6 이 컴파일되지 않는다.

> [영역 밖 최소 변경 — 계획에 반드시 포함해야 컴파일된다] 리뷰 단계 '현재 → 제안' 대비에 쓸 현재 라벨의 공급원. 스펙 §9 수정 목록에는 없지만 §5 의 대비 표를 구현하려면 필요하고, 같은 파일의 fetchWbsItemCount 관례(조회 실패는 로그만 남기고 null 로 degrade)를 그대로 복제한다. inspect 라우트를 건드리는 대안보다 이 경로가 기존 관례와 정확히 일치한다. 두 조회는 Promise.all 로 묶어 페이지 로드가 직렬화되지 않게 한다.

```tsx
import { getProjectConfig } from '@/lib/data/projectConfig'

/** 리뷰 단계의 '현재 → 제안' 대비에 쓸 현재 WBS 구분(설계 §5). fetchWbsItemCount 와 같은 관례로
 *  조회 실패는 로그만 남기고 null 로 degrade — 마법사는 '확인 불가' 문구로 계속 동작한다
 *  (설정 조회 실패가 임포트 화면 전체를 못 열게 만들면 안 되고, 동시에 조용히 숨겨도 안 된다). */
async function fetchLevelLabels(projectId: string): Promise<string[] | null> {
  try {
    return (await getProjectConfig(projectId)).levelLabels
  } catch (e) {
    console.error('[import] 프로젝트 설정 조회 실패 — 구분 대비는 표시하지 않음:', e)
    return null
  }
}

// ── ImportWizardPage 본문: 기존 currentItemCount 한 줄(40행)을 아래로 교체 ──
  // 비관리자는 위저드를 렌더하지 않으니(아래) 조회 자체를 건너뛴다 — 불필요한 쿼리 방지.
  const [currentItemCount, currentLevelLabels] = isAdmin
    ? await Promise.all([fetchWbsItemCount(projectId), fetchLevelLabels(projectId)])
    : [null, null]

// ── 렌더: ImportWizard 호출부(54행)를 아래로 교체 ──
        <ImportWizard
          projectId={projectId}
          isSuperuser={isSuperuser}
          currentItemCount={currentItemCount}
          currentLevelLabels={currentLevelLabels}
        />
```

- [ ] **Step 8: 빌드로 i18n 패리티를 확인한다**

Run: `npm run build`
Expected: 성공 — `en` 이 `Record<keyof ko, string>` 이라 키 누락이면 여기서 타입 에러가 난다

- [ ] **Step 9: 커밋**

```bash
git add src/lib/domain/importWizard.ts src/components/import/ImportWizard.tsx \
        "src/app/(app)/p/[projectId]/import/page.tsx" \
        src/lib/i18n/dict/importWizard.ts tests/ui/import-wizard-state.test.ts
git commit -m "feat: 임포트 마법사에 구분 라벨 반영 체크박스

기본값은 꺼짐이다 — project_settings 에는 트리거도 이력도 없고 이 설계는
마이그레이션 0건이라, 잘못 반영된 라벨을 revert 로 되돌릴 수 없다.
켜는 비용은 클릭 한 번이고 끄지 못한 비용은 복구 불가다.

실행 전 유일한 검증면이므로 현재→제안 대비를 함께 보여주고, 완료 화면에
before/after 를 남겨 수동 복구 좌표를 준다."
```

---

### Task 7: 구분 라벨 편집 UI

엑셀 없이 직접 쓰는 프로젝트가 어휘를 바꿀 수 있는 유일한 길이고, 잘못 반영된 엑셀 헤더를
되돌리는 길이기도 하다(L2).

**Files:**
- Create: `src/app/actions/projectSettings.ts`
- Create: `src/components/settings/LevelLabelsManager.tsx`
- Modify: `src/app/(app)/p/[projectId]/settings/page.tsx`
- Modify: `src/lib/i18n/dict/settings.ts` (ko/en 동시)
- Test: `tests/actions/project-settings.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `normalizeLevelLabels` · Task 3 의 `PRESETS.standard4`
- Produces: `updateLevelLabels(projectId: string, labels: string[]): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: 서버 액션 테스트를 쓴다**

> 설계 §12 의 updateLevelLabels 케이스 전량 + 선행조회 중단·재색인 베스트에포트 2건. normalizeLevelLabels 는 의도적으로 모킹하지 않는다(§2 '세 경로가 같은 관문' 계약의 실물 검증). 실행: npx vitest run tests/actions/project-settings.test.ts

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// updateLevelLabels(설계 §6)의 게이트·페이로드 계약만 본다.
// project_settings 는 쓰기 RLS 정책이 0건이라(0058) admin 클라이언트가 유일한 쓰기 경로다 —
// 다른 테이블 접근은 즉시 던져 계약 위반을 드러낸다(project-teams-actions.test.ts 관례).
// normalizeLevelLabels 는 모킹하지 않는다: '세 경로가 같은 관문을 지난다'(§2)를 실물로 검증해야
// 정규화가 액션에서 빠지는 회귀가 잡힌다.
const { db, fromCalls, createAdminClient, requireProjectAdmin, getProjectConfig, ingestProject, revalidatePath } =
  vi.hoisted(() => {
    const db = {
      upserted: null as Record<string, unknown> | null,
      upsertOpts: null as unknown,
      upsertError: null as { message: string } | null,
    }
    const fromCalls: string[] = []
    const createAdminClient = vi.fn(() => ({
      from: (table: string) => {
        fromCalls.push(table)
        if (table !== 'project_settings') {
          throw new Error(`구분 편집 액션이 ${table} 테이블을 건드렸습니다`)
        }
        return {
          upsert: async (row: Record<string, unknown>, opts: unknown) => {
            db.upserted = row
            db.upsertOpts = opts
            return { error: db.upsertError }
          },
        }
      },
    }))
    const requireProjectAdmin = vi.fn()
    const getProjectConfig = vi.fn()
    const ingestProject = vi.fn(async () => ({ count: 0 }))
    const revalidatePath = vi.fn()
    return { db, fromCalls, createAdminClient, requireProjectAdmin, getProjectConfig, ingestProject, revalidatePath }
  })

vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/data/projectConfig', () => ({ getProjectConfig }))
vi.mock('@/lib/ai/ingest', () => ({ ingestProject }))

import { updateLevelLabels } from '@/app/actions/projectSettings'

const PID = '11111111-2222-3333-4444-555555555555'
const ADMIN_ACTOR = {
  userId: 'u-admin', teamCode: 'PMO', teamId: 't1', isSuperuser: false,
  projectRoles: new Map([[PID, 'admin']]),
}
const asAdmin = () => requireProjectAdmin.mockResolvedValue({ ok: true, actor: ADMIN_ACTOR })

// 프리셋 전량 동반(§5-4)을 검증하려면 '현재 값'이 기본값과 달라야 한다.
const CURRENT = {
  levelLabels: ['PHASE', 'TASK', 'ACT'],
  maxDepth: 3,
  extraAxisLabel: 'Biz',
  milestoneKeywords: ['킥오프', 'uat'],
  excelProfile: { headerRow: 2 },
}

describe('updateLevelLabels — WBS 구분 편집 서버액션', () => {
  beforeEach(() => {
    db.upserted = null
    db.upsertOpts = null
    db.upsertError = null
    fromCalls.length = 0
    createAdminClient.mockClear()
    requireProjectAdmin.mockReset()
    getProjectConfig.mockReset()
    getProjectConfig.mockResolvedValue(CURRENT)
    ingestProject.mockClear()
    ingestProject.mockResolvedValue({ count: 0 })
    revalidatePath.mockClear()
  })

  it('비-UUID projectId 는 권한 조회 이전에 거부한다', async () => {
    expect(await updateLevelLabels('not-a-uuid', ['PHASE'])).toEqual({ ok: false, error: '잘못된 요청입니다.' })
    expect(requireProjectAdmin).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('프로젝트 관리자가 아니면 가드 문자열을 그대로 반환한다(fail-closed)', async () => {
    requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await updateLevelLabels(PID, ['PHASE'])).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(getProjectConfig).not.toHaveBeenCalled()
  })

  it('정규화 위반(빈 배열·공백 원소)이면 쓰기가 일어나지 않는다', async () => {
    asAdmin()
    expect((await updateLevelLabels(PID, [])).ok).toBe(false)
    expect((await updateLevelLabels(PID, ['PHASE', '   '])).ok).toBe(false)
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(db.upserted).toBeNull()
  })

  it('선행 조회가 실패하면 중단한다(쓰기 전 선행 조회 실패 = 중단)', async () => {
    asAdmin()
    getProjectConfig.mockRejectedValue(new Error('PGRST205'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await updateLevelLabels(PID, ['대공정', '중공정'])
    expect(r).toEqual({ ok: false, error: '현재 설정을 확인할 수 없어 저장을 중단했습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('성공: 프리셋 전량 + updated_at·updated_by 를 담아 project_settings 로 upsert 한다', async () => {
    asAdmin()
    const r = await updateLevelLabels(PID, [' 대공정 ', '중공정', '소공정', '세부작업'])
    expect(r).toEqual({ ok: true })
    expect(fromCalls).toEqual(['project_settings'])
    expect(db.upserted).toMatchObject({
      project_id: PID,
      // 정규화가 trim 을 책임진다 — 액션이 원문을 그대로 싣지 않는다는 계약.
      level_labels: ['대공정', '중공정', '소공정', '세부작업'],
      // upsert 가 INSERT 로 떨어져도 DB default 에 먹히지 않도록 전량 동반(§5-4).
      max_depth: 3,
      extra_axis_label: 'Biz',
      milestone_keywords: ['킥오프', 'uat'],
      excel_profile: { headerRow: 2 },
      updated_by: 'u-admin',
    })
    expect(typeof (db.upserted as { updated_at: unknown }).updated_at).toBe('string')
    expect(db.upsertOpts).toEqual({ onConflict: 'project_id' })
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${PID}`, 'layout')
  })

  it('성공 후 재색인을 부른다 — 라벨이 RAG 임베딩 본문에 들어가고 ensure-index 는 stale 을 못 고친다', async () => {
    asAdmin()
    await updateLevelLabels(PID, ['PHASE', 'TASK'])
    expect(ingestProject).toHaveBeenCalledWith(PID)
  })

  it('재색인 실패는 저장 성공을 막지 않는다(베스트에포트)', async () => {
    asAdmin()
    ingestProject.mockRejectedValue(new Error('embed down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await updateLevelLabels(PID, ['PHASE', 'TASK'])).toEqual({ ok: true })
    expect(db.upserted).not.toBeNull()
    errSpy.mockRestore()
  })

  it('upsert 실패는 실패로 보고한다(조용한 성공 위장 금지)', async () => {
    asAdmin()
    db.upsertError = { message: 'permission denied' }
    const r = await updateLevelLabels(PID, ['PHASE', 'TASK'])
    expect(r).toEqual({ ok: false, error: '구분 저장 실패: permission denied' })
    expect(ingestProject).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/actions/project-settings.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/actions/projectSettings"`

- [ ] **Step 3: 서버 액션을 구현한다**

재색인을 베스트에포트로 부르는 이유: `ensure-index.ts` 는 색인이 1건이라도 있으면 즉시 return 하므로
**stale 을 스스로 고치지 못한다.** 라벨은 RAG 임베딩 본문에 들어간다.

> 설계 §6 서버액션 전문. 순서 = isUuidLike → requireProjectAdmin → normalizeLevelLabels → getProjectConfig 선행조회 → admin upsert(프리셋 전량 + updated_at/updated_by) → revalidatePath → ingestProject 베스트에포트. 의존 계약: normalizeLevelLabels 가 { ok:true; labels } | { ok:false; reason: 한국어 문구 } 를 돌려준다.

```typescript
'use server'

// WBS 구분(레벨 라벨) 편집 — 설계 §6. 프로젝트 관리자 스코프.
// project_settings 는 0058 이후로도 쓰기 RLS 정책이 0건이다(grants: authenticated:SELECT / service_role:ALL).
// 즉 admin 클라이언트가 유일한 쓰기 경로이고 requireProjectAdmin 이 유일한 관문이다 — 2차 방어선이 없으므로
// 이 파일을 손댈 때는 가드를 먼저 본다(CLAUDE.md 권한 절, 회의록·위키와 같은 계열).

import { revalidatePath } from 'next/cache'
import { requireProjectAdmin } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuidLike } from '@/lib/domain/agentWork'
import { normalizeLevelLabels } from '@/lib/domain/levelLabels'
import { getProjectConfig } from '@/lib/data/projectConfig'
import { ingestProject } from '@/lib/ai/ingest'

export type ProjectSettingsActionResult = { ok: true } | { ok: false; error: string }

/**
 * 프로젝트의 WBS 구분 라벨을 교체한다(설계 §6).
 *
 * 라벨은 배지·엑셀 내보내기·주간보고·RAG 임베딩 등 15개 소비처가 주입받아 쓰는 값이라
 * 저장 한 번이 화면과 산출물을 모두 바꾼다. DB 에 CHECK 제약이 0건이므로(§4)
 * normalizeLevelLabels 가 애플리케이션 측 유일한 관문이다.
 */
export async function updateLevelLabels(
  projectId: string,
  labels: string[],
): Promise<ProjectSettingsActionResult> {
  // 가드보다 먼저 본다 — 비-UUID 로 권한 조회를 때리지 않는다(agentWork.ts:23 · wbsSpec.ts:50 관례).
  if (!isUuidLike(projectId)) return { ok: false, error: '잘못된 요청입니다.' }
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  const norm = normalizeLevelLabels(labels)
  if (!norm.ok) return { ok: false, error: norm.reason }

  // 쓰기 전 선행 조회(에러 처리 3원칙) — 아래 upsert 가 INSERT 로 떨어질 때 페이로드에 없는 컬럼이
  // DB default 를 먹는다. 특히 milestone_keywords 가 빈 배열이 되면 마일스톤 카드가 무증상 소실된다(§10-8).
  // 조회가 실패하면 기본값으로 추측하지 않고 중단한다 — 추측한 값으로 쓰면 운영 설정을 덮어쓴다.
  let current
  try {
    current = await getProjectConfig(projectId)
  } catch (e) {
    console.error('[updateLevelLabels] 현재 설정 조회 실패 — 쓰기 중단:', e)
    return { ok: false, error: '현재 설정을 확인할 수 없어 저장을 중단했습니다.' }
  }

  const admin = createAdminClient()
  // 0058 project_settings 에는 updated_at 트리거가 없다(전 마이그레이션에 0건) — default now() 는
  // INSERT 에서만 타므로 UPDATE 분기를 위해 앱이 두 필드를 직접 채운다(llmConfig.ts:285 · import/execute 선례).
  const { error } = await admin.from('project_settings').upsert(
    {
      project_id: projectId,
      level_labels: norm.labels,
      // INSERT 분기 대비 프리셋 전량 동반(§5-4). milestoneKeywords 는 getProjectConfig 가 lowercase 로
      // 정규화해 돌려주지만, 프리셋 키워드가 전부 소문자여야 한다는 계약을 tests/domain/project-presets.test.ts
      // 가 전수로 강제하므로 프리셋 시드 행에서는 이 왕복이 바이트 동일하다.
      max_depth: current.maxDepth,
      extra_axis_label: current.extraAxisLabel,
      milestone_keywords: current.milestoneKeywords,
      excel_profile: current.excelProfile,
      updated_by: g.actor.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id' },
  )
  if (error) return { ok: false, error: `구분 저장 실패: ${error.message}` }

  // 라벨은 WBS 배지·칸반·보고서 등 프로젝트 서브트리 전역에서 쓰인다 — settings 만 무효화하면
  // 다른 화면이 옛 어휘로 남는다.
  revalidatePath(`/p/${projectId}`, 'layout')

  // 라벨은 RAG 임베딩 본문에 들어간다. ensure-index 는 색인이 1건이라도 있으면 즉시 return 하므로
  // stale 을 스스로 고치지 못한다(§6) — 갱신 경로가 직접 재색인한다. 임베딩 키가 없으면 자동 skip 이고,
  // 실패해도 저장은 이미 끝났으므로 성공으로 둔다(임포트 경로와 동일한 베스트에포트 관례).
  try {
    await ingestProject(projectId)
  } catch (e) {
    console.error('[updateLevelLabels] 라벨 변경 후 색인 실패(무시):', e)
  }

  return { ok: true }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/actions/project-settings.test.ts`
Expected: PASS

- [ ] **Step 5: i18n 키를 추가한다 (ko/en 동시)**

> ko 객체 말미(현재 'settings.privacyApplied' 다음, 닫는 중괄호 앞)와 en 객체 말미에 같은 순서로 추가. 두 블록을 반드시 함께 넣는다 — vitest 는 타입체크를 하지 않아 en 누락이 전량 초록으로 통과하고 npm run build 에서만 잡힌다(§10-6). 숫자가 끼는 문구는 t() 에 보간이 없어 Pre/Post 로 쪼갰다.

```typescript
// ── settingsKo 말미에 추가 ──
  // WBS 구분(레벨 라벨) — 설계 §6
  'settings.levelLabelsTitle': 'WBS 구분',
  'settings.levelLabelsDesc': '이 프로젝트의 WBS 단계 이름입니다. WBS 배지·엑셀 내보내기·주간보고·AI 검색이 이 어휘를 씁니다. 엑셀을 가져올 때 계층 열 헤더로 덮어쓸 수도 있습니다.',
  'settings.levelLabelsStagePrefix': '',
  'settings.levelLabelsStageSuffix': '단',
  'settings.levelLabelsPlaceholder': '구분 이름',
  'settings.levelLabelsAdd': '단계 추가',
  'settings.levelLabelsRemove': '단계 삭제',
  'settings.levelLabelsSaving': '저장 중…',
  'settings.levelLabelsSaved': 'WBS 구분을 저장했습니다.',
  'settings.levelLabelsEmptyRow': '빈 구분 이름은 저장할 수 없습니다.',
  'settings.levelLabelsTooLong': '구분 이름은 12자 이하여야 합니다. WBS 시트의 구분 열 너비가 고정이라 더 길면 잘립니다.',
  'settings.levelLabelsMaxCount': '구분은 최대 8단까지 만들 수 있습니다.',
  'settings.levelLabelsMinCount': '구분은 최소 1단이 필요합니다.',
  'settings.levelLabelsDepthWarnPre': '이 프로젝트의 최대 깊이 설정은 ',
  'settings.levelLabelsDepthWarnPost': '단입니다. 그보다 아래 단계는 화면에서 \'자식 추가\'가 막혀 있어 이름만 남고 항목을 만들 수 없습니다.',
  'settings.levelLabelsShrinkTitle': '구분 단계를 줄입니다',
  'settings.levelLabelsShrinkBody': '단계를 줄이면 라벨 밖으로 나간 깊이의 항목이 주간보고 Lv·AI 검색 본문에서 마지막 구분 이름으로 표기됩니다. 항목 자체는 그대로지만 보고서 표기가 상위 단계와 같아져 오독될 수 있고, 변경 이력이 남지 않습니다. 계속할까요?',
  'settings.levelLabelsReadOnly': '구분 변경은 PMO 관리자만 가능합니다.',
  'settings.levelLabelsLoadFailed': 'WBS 구분 정보를 불러오지 못했습니다.',
  'settings.levelLabelsLoadFailedDesc': '일시적인 오류일 수 있습니다. 잠시 후 새로고침하세요. 이 페이지의 다른 설정은 그대로 사용할 수 있습니다.',

// ── settingsEn 말미에 추가(같은 순서) ──
  // WBS level labels — design §6
  'settings.levelLabelsTitle': 'WBS level labels',
  'settings.levelLabelsDesc': 'Names for this project’s WBS levels. Badges, Excel export, weekly reports and AI search all use this vocabulary. An Excel import can also overwrite it with the hierarchy column headers.',
  'settings.levelLabelsStagePrefix': 'L',
  'settings.levelLabelsStageSuffix': '',
  'settings.levelLabelsPlaceholder': 'Label',
  'settings.levelLabelsAdd': 'Add level',
  'settings.levelLabelsRemove': 'Remove level',
  'settings.levelLabelsSaving': 'Saving…',
  'settings.levelLabelsSaved': 'WBS level labels saved.',
  'settings.levelLabelsEmptyRow': 'A label cannot be empty.',
  'settings.levelLabelsTooLong': 'Labels must be 12 characters or fewer — the WBS sheet level column has a fixed width and longer names get clipped.',
  'settings.levelLabelsMaxCount': 'Up to 8 levels are supported.',
  'settings.levelLabelsMinCount': 'At least one level is required.',
  'settings.levelLabelsDepthWarnPre': 'This project’s max depth setting is ',
  'settings.levelLabelsDepthWarnPost': '. Levels below that cannot be created — ‘Add child’ is disabled, so the label exists in name only.',
  'settings.levelLabelsShrinkTitle': 'Removing levels',
  'settings.levelLabelsShrinkBody': 'Items deeper than the remaining labels will be shown with the last label in weekly reports and AI search text. The items themselves are unchanged, but reports may read as if they were one level higher, and this change is not versioned. Continue?',
  'settings.levelLabelsReadOnly': 'Only PMO admins can change level labels.',
  'settings.levelLabelsLoadFailed': 'Could not load WBS level labels.',
  'settings.levelLabelsLoadFailedDesc': 'This may be temporary — please refresh shortly. Other settings on this page remain available.',
```

- [ ] **Step 6: 편집 컴포넌트를 만든다**

`ProjectPrivacyToggle` 방식을 따른다 — `useLocale` + `t()` 로 전량 사전화한다.
(`ProjectTeamsManager` 는 한국어 하드코딩이라 관례가 둘로 갈려 있는데, 새 컴포넌트는 전자다.)

> 설계 §6 편집 UI 전문. 의존 계약: '@/lib/domain/levelLabels' 가 LEVEL_LABEL_MAX_COUNT(8) · LEVEL_LABEL_MAX_LEN(12) 을 export 한다. 상태 변형 display 유틸을 쓰지 않는다(globals.css 안전망).

```tsx
'use client'

// WBS 구분(레벨 라벨) 편집 — 설계 §6.
// i18n 은 ProjectPrivacyToggle 방식(useLocale + t)으로 전량 사전화한다. 같은 폴더의
// ProjectTeamsManager 는 한국어 하드코딩이라 관례가 둘로 갈려 있는데, 새 코드는 사전화 쪽을 따른다.
// 서버 액션이 유일한 검증 관문이므로(normalizeLevelLabels) 여기 검사는 '왕복 한 번을 아끼는 선검증'일 뿐,
// 안전 근거가 아니다 — 두 곳의 상수는 levelLabels.ts 에서 import 해 갈라지지 않게 한다.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Save, X } from 'lucide-react'
import { updateLevelLabels } from '@/app/actions/projectSettings'
import { LEVEL_LABEL_MAX_COUNT, LEVEL_LABEL_MAX_LEN } from '@/lib/domain/levelLabels'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'

export function LevelLabelsManager({ projectId, labels, maxDepth, canEdit }: {
  projectId: string
  labels: string[]
  maxDepth: number | null
  canEdit: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()
  const [rows, setRows] = useState<string[]>(labels)
  const [error, setError] = useState<string | null>(null)
  // 축소 확인 대기 중인 페이로드. boolean 이 아니라 값을 들고 있어야 확인 직후 그대로 저장할 수 있다
  // (다시 rows 에서 만들면 모달이 떠 있는 동안의 편집이 확인 없이 섞여 들어간다).
  const [confirming, setConfirming] = useState<string[] | null>(null)
  const [pending, start] = useTransition()

  const stage = (i: number) =>
    `${t('settings.levelLabelsStagePrefix')}${i + 1}${t('settings.levelLabelsStageSuffix')}`

  const dirty = rows.length !== labels.length || rows.some((r, i) => r !== labels[i])
  // max_depth 는 이 화면에서 편집하지 않는다(§6 범위 통제). 넘겨도 저장은 허용하되,
  // 그 단계는 canAddChild 가 막아 '자식 추가'로 만들 수 없는 유령 라벨이 되므로 미리 알린다.
  const depthWarn = maxDepth !== null && rows.length > maxDepth

  function setAt(i: number, v: string) {
    setError(null)
    setRows(prev => prev.map((r, idx) => (idx === i ? v : r)))
  }

  function addRow() {
    setError(null)
    if (rows.length >= LEVEL_LABEL_MAX_COUNT) { setError(t('settings.levelLabelsMaxCount')); return }
    setRows(prev => [...prev, ''])
  }

  function removeRow(i: number) {
    setError(null)
    if (rows.length <= 1) { setError(t('settings.levelLabelsMinCount')); return }
    setRows(prev => prev.filter((_, idx) => idx !== i))
  }

  function persist(next: string[]) {
    setError(null)
    start(async () => {
      try {
        const res = await updateLevelLabels(projectId, next)
        // 실패는 토스트로 흘려보내지 않고 인라인으로 남긴다 — 입력값을 고쳐야 하는 오류라
        // 사라지는 알림이면 무엇이 잘못됐는지 다시 볼 수 없다(표시 = 로깅).
        if (!res.ok) { setError(res.error || t('settings.actionFailed')); return }
        router.refresh()
        toast({ title: t('settings.levelLabelsSaved'), variant: 'success' })
      } catch {
        setError(t('settings.actionError'))
      }
    })
  }

  function submit() {
    const next = rows.map(r => r.trim())
    if (next.some(r => r.length === 0)) { setError(t('settings.levelLabelsEmptyRow')); return }
    if (next.some(r => r.length > LEVEL_LABEL_MAX_LEN)) { setError(t('settings.levelLabelsTooLong')); return }
    // 축소는 되돌릴 수 없는 표기 변경이다 — 주간보고 Lv 와 RAG 임베딩은 폴백이 아니라
    // '마지막 라벨로 클램프'라(§7), 라벨 밖으로 나간 깊이가 상위 단계와 같은 값으로 조용히 바뀐다.
    // 변경 이력 테이블도 없으므로(§11-2) 이 확인이 사실상 유일한 검증면이다.
    if (next.length < labels.length) { setConfirming(next); return }
    persist(next)
  }

  // 조회 전용(멤버) — 어휘 자체는 보여야 WBS 배지를 이해할 수 있다.
  if (!canEdit) {
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {labels.map((l, i) => (
            <span key={`${i}-${l}`} className="chip bg-surface-2 text-ink-muted">
              <span className="mr-1 tabular-nums text-ink-subtle">{stage(i)}</span>
              {l}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-ink-subtle">{t('settings.levelLabelsReadOnly')}</p>
      </div>
    )
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-delayed-weak px-3 py-2 text-sm text-delayed">{error}</p>
      )}
      {depthWarn && (
        <p role="alert" className="mb-3 rounded-lg bg-pending-weak px-3 py-2 text-sm text-accent-warning">
          {t('settings.levelLabelsDepthWarnPre')}{maxDepth}{t('settings.levelLabelsDepthWarnPost')}
        </p>
      )}

      <ul className="space-y-2">
        {rows.map((v, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-xs font-semibold tabular-nums text-ink-subtle">{stage(i)}</span>
            <input
              value={v}
              onChange={e => setAt(i, e.target.value)}
              placeholder={t('settings.levelLabelsPlaceholder')}
              maxLength={LEVEL_LABEL_MAX_LEN}
              className="app-input w-48"
              disabled={pending}
              aria-label={stage(i)}
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              disabled={pending || rows.length <= 1}
              className="btn btn-ghost btn-sm"
              aria-label={t('settings.levelLabelsRemove')}
              title={t('settings.levelLabelsRemove')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <button
          type="button"
          onClick={addRow}
          disabled={pending || rows.length >= LEVEL_LABEL_MAX_COUNT}
          className="btn btn-ghost"
        >
          <Plus className="h-4 w-4" />{t('settings.levelLabelsAdd')}
        </button>
        <button type="button" onClick={submit} disabled={pending || !dirty} className="btn btn-primary">
          <Save className="h-4 w-4" />{pending ? t('settings.levelLabelsSaving') : t('common.save')}
        </button>
      </div>

      <Modal
        open={confirming !== null}
        onClose={() => { if (!pending) setConfirming(null) }}
        eyebrow="WBS"
        title={t('settings.levelLabelsShrinkTitle')}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setConfirming(null)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending}
              onClick={() => { const next = confirming; setConfirming(null); if (next) persist(next) }}
            >
              {pending ? t('settings.levelLabelsSaving') : t('common.confirm')}
            </button>
          </>
        }
      >
        <p className="text-sm leading-6 text-ink-muted">{t('settings.levelLabelsShrinkBody')}</p>
      </Modal>
    </div>
  )
}
```

- [ ] **Step 7: 설정 페이지에 섹션을 끼운다**

`getProjectConfig` 를 **try/catch 로 별도 호출**한다 — 설정 조회 실패가 설정 화면 전체를 못 열게
만들어서도 안 되고, "데이터 없음"으로 위장해서도 안 된다.

> 삽입 diff 3곳 — ① import 2줄 + lucide 아이콘 Layers 추가 ② 본문 119행(projectTeamRows) 직후 getProjectConfig 별도 조회 ③ 233행 </SectionCard>(DATA 카드) 직후 새 SectionCard. 기존 코드는 한 줄도 지우지 않는다.

```tsx
// ── ① 3행 lucide 임포트에 Layers 추가 ──
-import { Upload, Download, CalendarDays, Settings, Shield, ListTree, CalendarRange, Info, RefreshCw, Lock, Sparkles, Cpu, ArrowUpRight, Users } from 'lucide-react'
+import { Upload, Download, CalendarDays, Settings, Shield, ListTree, CalendarRange, Info, RefreshCw, Lock, Sparkles, Cpu, ArrowUpRight, Users, Layers } from 'lucide-react'

// ── ① 4행 뒤(데이터 로더 그룹)에 한 줄 ──
 import { getComputedWbs } from '@/lib/data/wbs'
+import { getProjectConfig } from '@/lib/data/projectConfig'

// ── ① 20행 뒤(설정 컴포넌트 그룹)에 한 줄 ──
 import { ProjectPrivacyToggle } from '@/components/settings/ProjectPrivacyToggle'
+import { LevelLabelsManager } from '@/components/settings/LevelLabelsManager'


// ── ② 119행 `const projectTeamRows = projectTeamRowsSync(projectId)` 직후 ──
   const projectTeamRows = projectTeamRowsSync(projectId)
+  // 설계 §6 — 위 Promise.all 에 합류시키지 않는다. 설정 조회 실패가 설정 화면 전체를 못 열게
+  // 만들면 안 되고(가용성), 동시에 '데이터 없음'으로 위장해서도 안 된다(3원칙).
+  // null 로 구분해 해당 카드 안에서만 실패를 드러낸다.
+  const levelConfig = await getProjectConfig(projectId).catch((e: unknown) => {
+    console.error('[settings] 프로젝트 설정(WBS 구분) 조회 실패 — 해당 카드만 degrade:', e)
+    return null
+  })


// ── ③ 233행 `        </SectionCard>`(DATA 카드 닫힘) 직후, 235행 `{/* ── DK Bot 의미검색 색인 ── */}` 앞 ──
         </SectionCard>
+
+      {/* ── WBS 구분(레벨 라벨) ── 임포트 체크박스로도 바뀌는 값이라 데이터 카드 바로 뒤에 둔다 ── */}
+        <SectionCard
+        eyebrow="VOCABULARY"
+        title={t(locale, 'settings.levelLabelsTitle')}
+        icon={Layers}
+        actions={!canMutate ? <span className="badge bg-pending-weak px-2 py-1 text-pending">{t(locale, 'settings.pmoOnlyBadge')}</span> : undefined}
+      >
+        <p className="-mt-2 mb-4 text-xs leading-5 text-ink-muted">
+          {t(locale, 'settings.levelLabelsDesc')}
+        </p>
+        {levelConfig ? (
+          <LevelLabelsManager
+            projectId={projectId}
+            labels={levelConfig.levelLabels}
+            maxDepth={levelConfig.maxDepth}
+            canEdit={canMutate}
+          />
+        ) : (
+          // 빈 배열로 넘기면 '구분 0건'(비정상)과 조회 실패가 같은 화면이 된다 — 실패는 안내로 드러낸다.
+          <div className="panel-soft flex items-center gap-4 p-5">
+            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pending-weak text-pending">
+              <Info className="h-5 w-5" />
+            </span>
+            <div>
+              <p className="text-sm font-semibold text-ink">{t(locale, 'settings.levelLabelsLoadFailed')}</p>
+              <p className="mt-1 text-xs leading-5 text-ink-muted">{t(locale, 'settings.levelLabelsLoadFailedDesc')}</p>
+            </div>
+          </div>
+        )}
+        </SectionCard>
 
       {/* ── DK Bot 의미검색 색인 ── */}
```

- [ ] **Step 8: 빌드로 i18n 패리티를 확인한다**

Run: `npm run build`
Expected: 성공

- [ ] **Step 9: 커밋**

```bash
git add src/app/actions/projectSettings.ts src/components/settings/LevelLabelsManager.tsx \
        "src/app/(app)/p/[projectId]/settings/page.tsx" src/lib/i18n/dict/settings.ts \
        tests/actions/project-settings.test.ts
git commit -m "feat: 설정 화면에서 WBS 구분 라벨 편집

지금까지 라벨을 바꿀 수단이 아예 없었다 — 엑셀을 쓰지 않는 프로젝트는
생성 시 시드된 어휘에 영원히 묶이고, 잘못 반영된 엑셀 헤더도 되돌릴 수 없다.

라벨은 RAG 임베딩 본문에 들어가는데 ensure-index 는 색인이 있으면 즉시
return 해 stale 을 못 고치므로, 저장 후 재색인을 베스트에포트로 부른다."
```

---

### Task 8: 엑셀 내보내기에 라벨 주입

`exportWithProfile` 의 `hierarchyLabel` 은 `level_labels` 를 **전혀 읽지 않는다** — 3열이면
`Phase/Task/Activity` 하드코딩, 아니면 `Level{n+1}`. 내보낸 파일을 라벨 반영을 켜고 되임포트하면
사용자 라벨이 조용히 되돌아간다(§8).

**D-CUBE 는 출력 바이트가 동일하다** — `level_labels` 가 정확히 `['Phase','Task','Activity']` 라
주입해도 같은 값이 나온다. 회귀 0의 근거다.

**Files:**
- Modify: `src/lib/excel/exportWithProfile.ts`
- Modify: `src/app/api/export/route.ts` (levelLabels 주입)
- Test: `tests/excel/export-with-profile.test.ts`

**Interfaces:**
- Consumes: `getProjectConfig(projectId).levelLabels`
- Produces: `buildWorkbookWithProfile` 이 `levelLabels` 옵셔널 인자를 받는다 — 미주입이면 기존 동작

- [ ] **Step 1: 테스트를 쓴다**

> 파손 없음(기존 15개 호출은 levelLabels 미지정 = 종전 동작). §8-1 의 바이트 불변 주장과 어휘 반영을 고정하는 describe 1건을 파일 말미에 추가한다. row/OPTS/unwrap/computeTree/LEGACY_DCUBE_PROFILE 는 파일 상단의 기존 헬퍼를 그대로 쓴다.

```typescript
/* ── (신설, 라벨 유연화 §8-1) levelLabels 주입 — 계층 열 헤더가 프로젝트 어휘를 따른다.
 *  D-CUBE(level_labels=['Phase','Task','Activity'] + 3열 프로파일)는 주입 전후가 셀 단위로 동일해야 한다(회귀 0). ── */
describe('buildAoaWithProfile — levelLabels 주입(§8-1)', () => {
  const SRC: WbsRow[] = [
    row({ id: 'P', parentId: null, code: '1', sortOrder: 0, name: 'P' }),
    row({ id: 'T', parentId: 'P', code: '1-1', sortOrder: 1, name: 'T' }),
    row({ id: 'A', parentId: 'T', code: 'a1', sortOrder: 2, name: 'A', actualPct: 10 }),
  ]
  const items = computeTree(SRC, '2026-09-15', new Set(), OPTS)
  const hierCols = LEGACY_DCUBE_PROFILE.hierarchy.kind === 'columns' ? LEGACY_DCUBE_PROFILE.hierarchy.columns : []

  it('D-CUBE 라벨을 주입해도 출력이 셀 단위로 동일하다(바이트 불변 — 회귀 0)', () => {
    const before = unwrap(buildAoaWithProfile(items, LEGACY_DCUBE_PROFILE, { expandSubActs: false }, 'D'))
    const after = unwrap(buildAoaWithProfile(
      items, LEGACY_DCUBE_PROFILE, { expandSubActs: false, levelLabels: ['Phase', 'Task', 'Activity'] }, 'D',
    ))
    expect(after).toEqual(before)
  })

  it('프로젝트 어휘가 있으면 헤더 2·3행의 계층 열이 그 라벨을 쓴다', () => {
    const aoa = unwrap(buildAoaWithProfile(
      items, LEGACY_DCUBE_PROFILE, { expandSubActs: false, levelLabels: ['대분류', '중분류', '소분류'] }, 'D',
    ))
    expect(hierCols.map(c => aoa[1][c])).toEqual(['대분류', '중분류', '소분류'])
    expect(hierCols.map(c => aoa[2][c])).toEqual(['대분류', '중분류', '소분류'])
  })

  it('라벨이 없거나 빈 라벨인 계층 열은 종전 폴백을 유지한다(빈칸 헤더 금지)', () => {
    const aoa = unwrap(buildAoaWithProfile(
      items, LEGACY_DCUBE_PROFILE, { expandSubActs: false, levelLabels: ['대분류', '  '] }, 'D',
    ))
    expect(hierCols.map(c => aoa[2][c])).toEqual(['대분류', 'Task', 'Activity'])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/excel/export-with-profile.test.ts`
Expected: FAIL — 주입한 라벨이 무시되고 `Phase/Task/Activity` 가 나온다

- [ ] **Step 3: 내보내기를 고친다**

> 3곳만 바뀐다: ① hierarchyLabel 정의(18-25행) ② buildAoaWithProfile 의 opts 타입·구조분해(93-99행)와 호출부 2곳(161·174행) ③ buildWorkbookWithProfile 의 opts 타입(258행). 호출부 외 본문은 무접촉.

```typescript
const LEGACY_LEVEL_LABELS = ['Phase', 'Task', 'Activity'] as const

/** 계층 열 라벨 — 프로젝트 어휘(project_settings.level_labels)가 있으면 그 라벨이 정본이다(라벨 유연화 §8-1).
 *  라벨이 없거나 라벨 개수보다 깊은 열은 종전 규칙을 유지한다: 3열(columns) 프로파일은 레거시 이름,
 *  그 외(N열/outline)는 `Level{n+1}` (resolveLegacyLevelLabels 와 동일 판정 재사용 — 라운드트립 규약의 단일 출처).
 *
 *  D-CUBE 는 level_labels 가 정확히 ['Phase','Task','Activity'] 이고 프로파일도 3열이라 두 경로가 같은
 *  문자열로 수렴한다 — **출력 바이트 불변**(회귀 0).
 *  폴백 문자열(`Level{n+1}`, 삽입 열의 '세부업무')은 proposeLevelLabels 가 시스템 생성 헤더로 보고 제안을
 *  포기하는 값이라, 내보낸 파일을 라벨 반영을 켜고 되임포트해도 사용자 라벨을 덮지 않는다(§8-2).
 *  빈 문자열·공백 라벨은 폴백으로 떨어뜨린다 — `??` 로 받으면 '' 가 통과해 헤더가 빈칸이 된다(§10-3 과 같은 함정). */
function hierarchyLabel(profile: ExcelProfile, depth: number, levelLabels?: string[]): string {
  const custom = levelLabels?.[depth]?.trim()
  if (custom) return custom
  if (resolveLegacyLevelLabels(profile)) return LEGACY_LEVEL_LABELS[depth] ?? 'Activity'
  return `Level${depth + 1}`
}

// ── buildAoaWithProfile: 시그니처와 구조분해만 교체(위치 인자는 늘리지 않는다 — 기존 호출부 무수정) ──
export function buildAoaWithProfile(
  items: ComputedItem[],
  profile: ExcelProfile,
  /** levelLabels 미지정 = 종전 동작(레거시 이름 / Level{n+1}) — 기존 호출부는 그대로 통과한다. */
  opts: { expandSubActs: boolean; levelLabels?: string[] },
  projectName = 'WBS',
): { ok: true; aoa: unknown[][] } | { ok: false; error: string } {
  const { expandSubActs, levelLabels } = opts

  // …(본문 무변경)…

  // 헤더 2행 호출부
  if (hierColsOut) hierColsOut.forEach((c, i) => { header2[c] = hierarchyLabel(profile, i, levelLabels) })

  // 헤더 3행 호출부
  if (hierColsOut) hierColsOut.forEach((c, i) => { header3[c] = hierarchyLabel(profile, i, levelLabels) })

// ── buildWorkbookWithProfile: opts 타입만 확장(본문은 그대로 buildAoaWithProfile 로 전달) ──
export function buildWorkbookWithProfile(
  items: ComputedItem[],
  profile: ExcelProfile,
  holidays: { date: string; name: string }[],
  opts: { expandSubActs: boolean; levelLabels?: string[] },
  projectName = 'WBS',
): { ok: true; buffer: ArrayBuffer } | { ok: false; error: string } {
  const built = buildAoaWithProfile(items, profile, opts, projectName)
  if (!built.ok) return built
  // …(이하 무변경)…
```

- [ ] **Step 4: 호출부에서 라벨을 넘긴다**

> expand 분기의 호출 한 줄만 교체. config 는 바로 위 :33 에서 이미 읽었으므로 새 조회 없음. 비-expand 분기(:64-66)는 이미 config.levelLabels 를 넘기고 있어 무변경.

```typescript
    const built = buildWorkbookWithProfile(
      items, profile, holidays.map(d => ({ date: d, name: '' })),
      // 계층 열 헤더가 프로젝트 어휘를 따르게 한다(§8-1). D-CUBE 는 라벨이 ['Phase','Task','Activity'] 라
      // 폴백과 같은 문자열이 나와 출력 바이트가 불변이다. config 는 위에서 이미 읽었다 — 재조회하지 않는다.
      { expandSubActs: true, levelLabels: config.levelLabels },
      name,
    )
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run tests/excel/export-with-profile.test.ts`
Expected: PASS — D-CUBE 3열 케이스의 헤더가 여전히 `Phase/Task/Activity` 인 것도 함께 확인

- [ ] **Step 6: 커밋**

```bash
git add src/lib/excel/exportWithProfile.ts src/app/api/export/route.ts \
        tests/excel/export-with-profile.test.ts
git commit -m "fix: 내보내기 계층 헤더가 프로젝트 구분 라벨을 따르게

hierarchyLabel 이 level_labels 를 읽지 않고 3열이면 Phase/Task/Activity 를
하드코딩해, 내보낸 파일을 라벨 반영을 켜고 되임포트하면 사용자 라벨이
조용히 되돌아갔다. D-CUBE 는 level_labels 가 같은 값이라 출력 무변경."
```

---

### Task 9: 전체 게이트와 스테이징 확인

**Files:** 없음(검증만)

- [ ] **Step 1: 전량 테스트**

Run: `npm run test`
Expected: PASS — 베이스라인 359파일 / 4224건에서 **감소 없음**. 신규 파일만큼 늘어야 한다.

- [ ] **Step 2: 빌드 (i18n 패리티의 유일한 게이트)**

Run: `npm run build`
Expected: 성공. vitest 는 타입체크를 하지 않으므로 ko/en 키 누락은 **여기서만** 잡힌다(§10-6).

- [ ] **Step 3: 린트**

Run: `npm run lint`
Expected: 경고 0

- [ ] **Step 4: 브랜치를 스테이징에 올린다**

마이그레이션 0건이라 G4 는 발동하지 않고, `shared.tsx` 무수정이라 G2 도 무관하다.
다만 **신규 화면**이므로 리포 관례대로 스테이징에서 눈으로 확인한 뒤 main 에 머지한다.

```bash
git switch -c feat/wbs-level-labels   # main 에서 시작
git push -u origin HEAD
# staging 브랜치에 머지 후 dflow-staging.vercel.app 에서 확인
```

- [ ] **Step 5: 스테이징에서 3가지를 눈으로 확인한다**

- [ ] 신규 프로젝트를 만들면 WBS 배지가 `PHASE · TASK · ACT · SUB-ACT` 로 나온다
- [ ] 임의 헤더(예: 대분류/중분류/소분류) 엑셀을 임포트할 때 체크박스가 **꺼져 있고**, 켜면 현재→제안 대비가 보이며, 실행 후 완료 화면에 before/after 가 남는다
- [ ] 설정 화면에서 라벨을 고치면 WBS 배지에 반영되고, 개수를 줄일 때 확인을 받으며, `max_depth` 를 넘으면 경고가 뜬다

- [ ] **Step 6: main 머지와 배포 확인**

```bash
git switch main && git merge feat/wbs-level-labels && git push origin main
npm run smoke:prod
npm run mark:good
```

---

## 완료 기준

- [ ] 신규 프로젝트가 4단 어휘를 갖는다 — 기존 프로젝트는 무접촉
- [ ] 엑셀 임포트에서 계층 헤더를 라벨로 반영할 수 있고, **기본값은 꺼짐**이며, before/after 가 남는다
- [ ] 설정 화면에서 라벨을 편집할 수 있다
- [ ] 손상된 라벨(빈 배열·빈 문자열)이 소비처에 닿지 않는다
- [ ] `npm run test` · `npm run build` · `npm run lint` 전부 초록
- [ ] 마이그레이션 0건 · `shared.tsx` 무수정 · `PRESETS.pi` 무수정
