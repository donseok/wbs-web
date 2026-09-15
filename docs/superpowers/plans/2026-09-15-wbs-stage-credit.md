# WBS 진척·단계·실적 크레딧 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 개발 Task 의 단계 전이 사건이 설정된 크레딧 표로 실적%를 지정하고, 그 전이를 DB 트랜잭션 하나(`apply_workflow_event`)로 묶으며, WBS 표에 「진척」·「단계」 두 축을 보인다.

**Architecture:** 순수 도메인 함수(크레딧 검증·사건 표·선행 판정·라벨 정본)를 먼저 세우고, 마이그레이션 0096 이 크레딧 컬럼·fp 제거·원자 전이 RPC 를 넣는다. 앱 층은 `applyWorkflowEvent` 래퍼 하나로 RPC 를 부르고 기존 `transitionStage`·`applyProgress`·실적 복원 코드를 지운다. 화면은 헤더 「진척」, 위임 1건 이상일 때 켜지는 「단계」 컬럼, 드롭다운 잠금 규칙, 설정 페이지 크레딧 슬라이더다.

**Tech Stack:** Next.js 15 App Router 서버 액션·라우트, Supabase(Postgres 17, PL/pgSQL RPC, service_role 호출), vitest(jsdom), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-15-wbs-stage-credit-design.md`

## Global Constraints

- 브랜치 `feat/wbs-stage-credit` (staging 에서 분기). 병렬 세션 때문에 **`git add -A` 금지 — 파일명 명시**. 커밋 메시지는 한국어, "왜" 중심, 끝에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` 와 `Claude-Session: https://claude.ai/code/session_018V49dnv2npGi72Lj7RkeK4`.
- **마이그레이션은 코드와 다른 커밋**(G1). `supabase/migrations/0096_wbs_stage_credits.sql` + `_rollback.sql`. 스테이징 리허설(`npm run db:apply -- <file> --target staging`) 뒤 커밋에 트레일러 `Staging-verified: 2026-09-15 db 리허설 통과`(G4). `staging:sync` 는 돌리지 않는다 — 스테이징에 mes-base 리허설 데이터가 살아 있다.
- 운영 D-CUBE 데이터 훼손 금지. 운영 적용(`--target prod`)·main 머지는 사용자 지시 뒤.
- 단계 코드 정본 `as|ip|im|xx|null`. `fp` 는 어디에도 남기지 않는다(입력 `fp` 는 `ip` 로 정규화).
- 크레딧 기본값(코드·SQL 동일): `default {as:0, ip:30, rw:50, im:80, xx:100}`, `if {as:0, ip:20, rw:30, im:50, xx:100}`, `doc {as:0, ip:20, rw:30, im:50, xx:100}`. 검증 규칙: 정수, 5 단위, `as < ip < rw < im < xx`, 인접 간격 ≥ 10, `xx === 100`.
- 라벨 한 벌: null=미착수 · as=할당됨 · ip=작업 중 · im=검수 대기 · xx=완료 (en: Not started · Assigned · In progress · Awaiting review · Done). WBS 헤더 ko 「진척」· en "Progress". 「단계」 컬럼 ko 「단계」· en "Stage".
- 에러 처리 3원칙: 조회 실패를 "없음"으로 위장하지 않는다, 쓰기 전 선행 조회 실패는 중단, 가드는 fail-closed.
- 검증 명령: `npm run lint`, `npx tsc --noEmit`, `npm run test`(vitest run). 단일 파일은 `npx vitest run <path>`.
- 이 환경에서는 `Agent` 도구(서브에이전트)가 뜨지 않는다(tmux shim). **인라인 실행**(executing-plans) 으로 진행한다.

---

## 파일 지도

| 구분 | 파일 | 책임 |
|---|---|---|
| 생성 | `src/lib/domain/stageLabels.ts` | 단계 코드 4개·한글 라벨 정본 |
| 생성 | `src/lib/domain/stageCredits.ts` | 크레딧 표 타입·기본값·검증·사건→크레딧·클램프 |
| 수정 | `src/lib/domain/agentWork.ts` | `STAGE_ORDER` fp 제거, `stageAtLeast` 삭제, `REACHED_STAGES`·`predecessorReached` 추가 |
| 수정 | `src/lib/domain/waitReason.ts`, `dependencyReadiness.ts`, `types.ts` | 선행 판정 통일, 라벨 정본 사용, `WbsRow.agentDelegated` |
| 생성 | `supabase/migrations/0096_wbs_stage_credits.sql` (+`_rollback.sql`) | 크레딧 컬럼, fp→ip, import RPC 정규화, `apply_workflow_event` |
| 생성 | `src/lib/agent/workflowEvent.ts` | RPC 호출 래퍼·사유 문구·도달 알림 헬퍼 |
| 수정 | `src/lib/agent/stageTransition.ts` | `transitionStage` 삭제, 알림 헬퍼만 남김 |
| 삭제 | `src/lib/agent/applyProgress.ts` | progress 보고 실적 반영(폐기) |
| 수정 | `claim/route.ts`, `report/route.ts`, `release/route.ts` | RPC 호출로 교체 |
| 수정 | `src/app/actions/agentWork.ts`, `agentHub.ts`, `wbsAssign.ts`, `src/lib/agent/delegation.ts` | RPC 호출로 교체, 삭제 목록 정리 |
| 수정 | `src/lib/agent/depends.ts` | `actual_pct` 조회, `reached` 필드 |
| 수정 | `src/app/actions/wbs.ts` | `updateActual` 99 상한 |
| 수정 | `src/components/wbs/WbsAssigneeStagePanel.tsx`, `src/components/agent-hub/DelegationTable.tsx`, `labels.ts` | 드롭다운 규칙·라벨 통일 |
| 수정 | `src/lib/i18n/dict/wbs.ts`, `wbs.en.ts`, `settings.ts`, `settings.en.ts` | 헤더·라벨·안내문·슬라이더 문구 |
| 수정 | `src/lib/data/wbs.ts`, `src/components/wbs/WbsGanttSheet.tsx`, `shared.tsx`, `src/lib/excel/export.ts` | 「진척」 헤더, 「단계」 컬럼 |
| 생성 | `src/components/settings/StageCreditSlider.tsx` | 크레딧 슬라이더(클라이언트) |
| 수정 | `src/lib/data/projectConfig.ts`, `src/app/actions/project.ts`, `src/app/(app)/p/[projectId]/settings/page.tsx` | 크레딧 읽기·저장·배치 |
| 수정 | `.claude/skills/dflow-work/references/api-contract.md`, `.claude/skills/dflow-dev/SKILL.md`, `.claude/skills/dflow-work/references/troubleshooting.md` | 계약 v2.3·스킬 문구 |

---

### Task 0: 브랜치

- [ ] **Step 1: staging 최신에서 분기**

```bash
cd /Users/jji/project/wbs-web && git status --short && git switch -c feat/wbs-stage-credit
```

Expected: 워킹트리 깨끗, 브랜치 `feat/wbs-stage-credit`.

---

### Task 1: 「진척」 헤더·엑셀 헤더

**Files:**
- Modify: `src/lib/i18n/dict/wbs.ts:80`, `src/lib/i18n/dict/wbs.en.ts:74`, `src/lib/excel/export.ts:74`
- Test: `tests/ui/wbs-progress-header.test.ts`(생성), `tests/excel/export.test.ts:150,164`, `tests/excel/export-nlevel.test.ts:44`, `tests/excel/parse.test.ts:101`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// tests/ui/wbs-progress-header.test.ts
// WBS 「상태」 컬럼을 「진척」으로(스펙 D6, 2026-09-15) — 「단계」와 헷갈리지 않게 한다. 칩 값 4개는 그대로다.
import { describe, expect, it } from 'vitest'
import { wbsKo } from '@/lib/i18n/dict/wbs'
import { wbsEn } from '@/lib/i18n/dict/wbs.en'

describe('WBS 진척 헤더', () => {
  it('ko 「진척」· en "Progress"', () => {
    expect(wbsKo['wbs.colStatus']).toBe('진척')
    expect(wbsEn['wbs.colStatus']).toBe('Progress')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/ui/wbs-progress-header.test.ts`
Expected: FAIL — `'상태'` 가 `'진척'` 과 다름.

- [ ] **Step 3: 구현**

`wbs.ts:80` → `'wbs.colStatus': '진척',` · `wbs.en.ts:74` → `'wbs.colStatus': 'Progress',` · `export.ts:74` 의 마지막 `'상태'` → `'진척'`.
테스트 3개 파일의 `'상태'` 기대값을 `'진척'` 으로 바꾼다(`parse.test.ts:101` 은 export 헤더를 흉내 낸 픽스처 — 파서는 이 칸을 읽지 않는다).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/ui/wbs-progress-header.test.ts tests/excel`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/i18n/dict/wbs.ts src/lib/i18n/dict/wbs.en.ts src/lib/excel/export.ts tests/ui/wbs-progress-header.test.ts tests/excel/export.test.ts tests/excel/export-nlevel.test.ts tests/excel/parse.test.ts
git commit -m "feat(wbs): 「상태」 컬럼 헤더를 「진척」으로 — 에이전트 「단계」와 어휘 분리"
```

---

### Task 2: 도메인 순수 함수

**Files:**
- Create: `src/lib/domain/stageLabels.ts`, `src/lib/domain/stageCredits.ts`
- Modify: `src/lib/domain/agentWork.ts:8-18`, `src/lib/domain/waitReason.ts`, `src/lib/domain/dependencyReadiness.ts:69-74`, `src/lib/domain/types.ts:31-36`
- Test: `tests/domain/stage-labels.test.ts`, `tests/domain/stage-credits.test.ts`, `tests/domain/predecessor-reached.test.ts`(생성), `tests/domain/wait-reason.test.ts`, `tests/domain/dependency-readiness.test.ts`(수정)

**Interfaces (Produces):**
- `STAGE_CODES: readonly ['as','ip','im','xx']`, `type StageCode`, `STAGE_LABEL_KO`, `STAGE_NONE_LABEL_KO`, `isStageCode(v): v is StageCode`, `stageLabelKo(stage: string|null): string`
- `type CreditKey = 'as'|'ip'|'rw'|'im'|'xx'`, `type CreditTable = Record<CreditKey, number>`, `type StageCredits = { default: CreditTable; if?: CreditTable; doc?: CreditTable }`, `DEFAULT_STAGE_CREDITS`, `CREDIT_STEP=5`, `CREDIT_GAP=10`, `validateStageCredits(raw: unknown): {ok:true; credits} | {ok:false; error}`, `type CreditEvent`, `EVENT_CREDIT`, `creditForKey(key, credits|null, creditKey|null): number`, `clampCredit(raw, key, table): number`
- `REACHED_STAGES: ReadonlySet<string>`, `predecessorReached({ stage, orderApproved?, actualPct? }): boolean`
- `WbsRow.agentDelegated?: boolean`

- [ ] **Step 1: 라벨 정본 테스트**

```ts
// tests/domain/stage-labels.test.ts
import { describe, expect, it } from 'vitest'
import { STAGE_CODES, STAGE_LABEL_KO, STAGE_NONE_LABEL_KO, isStageCode, stageLabelKo } from '@/lib/domain/stageLabels'
import { wbsKo } from '@/lib/i18n/dict/wbs'

describe('단계 라벨 정본(스펙 §3.2) — 한 벌만', () => {
  it('코드는 as·ip·im·xx 넷 — fp 없음', () => {
    expect([...STAGE_CODES]).toEqual(['as', 'ip', 'im', 'xx'])
    expect(isStageCode('fp')).toBe(false)
    expect(isStageCode('im')).toBe(true)
  })
  it('i18n ko 사전과 같다', () => {
    expect(wbsKo['wbs.stageAs']).toBe(STAGE_LABEL_KO.as)
    expect(wbsKo['wbs.stageIp']).toBe(STAGE_LABEL_KO.ip)
    expect(wbsKo['wbs.stageIm']).toBe(STAGE_LABEL_KO.im)
    expect(wbsKo['wbs.stageXx']).toBe(STAGE_LABEL_KO.xx)
    expect(wbsKo['wbs.stageNoneOption']).toBe(STAGE_NONE_LABEL_KO)
    expect((wbsKo as Record<string, string>)['wbs.stageFp']).toBeUndefined()
  })
  it('null 은 미착수, 모르는 코드는 코드 그대로(위장 금지)', () => {
    expect(stageLabelKo(null)).toBe('미착수')
    expect(stageLabelKo('zz')).toBe('zz')
    expect(stageLabelKo('im')).toBe('검수 대기')
  })
})
```

- [ ] **Step 2: 크레딧·선행 판정 테스트**

```ts
// tests/domain/stage-credits.test.ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STAGE_CREDITS, EVENT_CREDIT, clampCredit, creditForKey, validateStageCredits,
} from '@/lib/domain/stageCredits'

describe('validateStageCredits', () => {
  it('기본값은 유효하다', () => {
    expect(validateStageCredits(DEFAULT_STAGE_CREDITS)).toEqual({ ok: true, credits: DEFAULT_STAGE_CREDITS })
  })
  it('default 표가 없으면 거부', () => {
    expect(validateStageCredits({ if: DEFAULT_STAGE_CREDITS.if })).toMatchObject({ ok: false })
  })
  it.each([
    ['정수 아님', { as: 0, ip: 30.5, rw: 50, im: 80, xx: 100 }],
    ['5 단위 아님', { as: 0, ip: 32, rw: 50, im: 80, xx: 100 }],
    ['순서 역전', { as: 0, ip: 60, rw: 50, im: 80, xx: 100 }],
    ['간격 10 미만', { as: 0, ip: 30, rw: 35, im: 80, xx: 100 }],
    ['xx 가 100 아님', { as: 0, ip: 30, rw: 50, im: 80, xx: 95 }],
    ['키 누락', { as: 0, ip: 30, rw: 50, im: 80 }],
  ])('%s 이면 거부', (_name, table) => {
    expect(validateStageCredits({ default: table })).toMatchObject({ ok: false })
  })
  it('모르는 표 키(rw2)나 모르는 카테고리는 거부', () => {
    expect(validateStageCredits({ default: { ...DEFAULT_STAGE_CREDITS.default, zz: 1 } })).toMatchObject({ ok: false })
    expect(validateStageCredits({ default: DEFAULT_STAGE_CREDITS.default, etc: DEFAULT_STAGE_CREDITS.default })).toMatchObject({ ok: false })
  })
})

describe('creditForKey — 사건 표(스펙 §3.4)', () => {
  it('사건→크레딧 키 매핑', () => {
    expect(EVENT_CREDIT).toEqual({
      assign: 'as', claim: 'ip', report_completion: 'im', approve: 'xx',
      unapprove: 'im', reject: 'rw', rework: 'rw', release: 'as',
    })
  })
  it('credits null 이면 코드 기본값, credit_key 가 표에 없으면 default', () => {
    expect(creditForKey('rw', null, null)).toBe(50)
    expect(creditForKey('ip', null, 'if')).toBe(20)
    expect(creditForKey('im', { default: { as: 0, ip: 10, rw: 20, im: 40, xx: 100 } }, 'doc')).toBe(40)
  })
  it('xx 는 항상 100', () => {
    expect(creditForKey('xx', { default: { as: 0, ip: 10, rw: 20, im: 40, xx: 100 } }, null)).toBe(100)
  })
})

describe('clampCredit — 슬라이더 핸들 제약', () => {
  const t = { as: 0, ip: 30, rw: 50, im: 80, xx: 100 }
  it('5 단위로 스냅하고 이웃과 10 간격을 지킨다', () => {
    expect(clampCredit(42, 'ip', t)).toBe(40)
    expect(clampCredit(48, 'ip', t)).toBe(40)   // rw(50) - 10
    expect(clampCredit(-7, 'as', t)).toBe(0)
    expect(clampCredit(95, 'im', t)).toBe(90)   // xx(100) - 10
  })
  it('xx 는 100 고정', () => {
    expect(clampCredit(10, 'xx', t)).toBe(100)
  })
})
```

```ts
// tests/domain/predecessor-reached.test.ts
import { describe, expect, it } from 'vitest'
import { REACHED_STAGES, STAGE_ORDER, predecessorReached } from '@/lib/domain/agentWork'

describe('predecessorReached — 선행 충족 세 축(스펙 §3.7)', () => {
  it('stage im·xx', () => {
    expect(predecessorReached({ stage: 'im' })).toBe(true)
    expect(predecessorReached({ stage: 'xx' })).toBe(true)
    expect(predecessorReached({ stage: 'ip' })).toBe(false)
    expect(predecessorReached({ stage: null })).toBe(false)
  })
  it('승인된 주문', () => {
    expect(predecessorReached({ stage: null, orderApproved: true })).toBe(true)
  })
  it('실적 100 — 위임하지 않은 사람 Task', () => {
    expect(predecessorReached({ stage: null, actualPct: 100 })).toBe(true)
    expect(predecessorReached({ stage: null, actualPct: 99.6 })).toBe(false)
    expect(predecessorReached({ stage: null, actualPct: null })).toBe(false)
  })
  it('fp 는 어휘에 없다', () => {
    expect([...STAGE_ORDER]).toEqual(['as', 'ip', 'im', 'xx'])
    expect(REACHED_STAGES.has('fp')).toBe(false)
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/domain/stage-labels.test.ts tests/domain/stage-credits.test.ts tests/domain/predecessor-reached.test.ts`
Expected: FAIL — 모듈 없음 / export 없음.

- [ ] **Step 4: 구현**

```ts
// src/lib/domain/stageLabels.ts
/**
 * 단계 코드·라벨 정본(스펙 2026-09-15 §3.2) — 한 벌만. fp 는 0096 에서 ip 로 이관돼 어휘에 없다.
 * i18n ko 사전(wbs.stage*)은 이 값과 같아야 한다(tests/domain/stage-labels.test.ts 가 고정).
 * 허브 표·대기 사유 문구처럼 i18n 을 못 쓰는 서버 문구는 이 모듈을 쓴다.
 */
export const STAGE_CODES = ['as', 'ip', 'im', 'xx'] as const
export type StageCode = (typeof STAGE_CODES)[number]

export const STAGE_LABEL_KO: Readonly<Record<StageCode, string>> = {
  as: '할당됨', ip: '작업 중', im: '검수 대기', xx: '완료',
}
export const STAGE_NONE_LABEL_KO = '미착수'

export function isStageCode(v: unknown): v is StageCode {
  return typeof v === 'string' && (STAGE_CODES as readonly string[]).includes(v)
}

/** null → 미착수, 모르는 코드 → 코드 그대로(표시 = 로깅 — 감추면 "단계 없음"으로 위장한다). */
export function stageLabelKo(stage: string | null): string {
  if (stage === null) return STAGE_NONE_LABEL_KO
  return isStageCode(stage) ? STAGE_LABEL_KO[stage] : stage
}
```

```ts
// src/lib/domain/stageCredits.ts
/**
 * 실적 크레딧 표(스펙 2026-09-15 §3.3) — 순수 함수. 값의 정본은 DB(project_settings.stage_credits)이고
 * 전이 시 실제 계산은 RPC apply_workflow_event 가 한다. 여기 기본값·규칙은 그 SQL 과 같아야 한다
 * (tests/migrations/0096-wbs-stage-credits.test.ts 가 SQL 상수와 비교한다).
 */
export const CREDIT_KEYS = ['as', 'ip', 'rw', 'im', 'xx'] as const
export type CreditKey = (typeof CREDIT_KEYS)[number]
export type CreditTable = Record<CreditKey, number>
export const CREDIT_TABLE_KEYS = ['default', 'if', 'doc'] as const
export type CreditTableKey = (typeof CREDIT_TABLE_KEYS)[number]
export type StageCredits = { default: CreditTable; if?: CreditTable; doc?: CreditTable }

export const DEFAULT_STAGE_CREDITS: StageCredits = {
  default: { as: 0, ip: 30, rw: 50, im: 80, xx: 100 },
  if: { as: 0, ip: 20, rw: 30, im: 50, xx: 100 },
  doc: { as: 0, ip: 20, rw: 30, im: 50, xx: 100 },
}
export const CREDIT_STEP = 5
export const CREDIT_GAP = 10

/** 사건 → 크레딧 키(§3.4). 승인은 xx(=100 고정), 반려·재작업은 rw(단계는 ip). */
export type CreditEvent = 'assign' | 'claim' | 'report_completion' | 'approve' | 'unapprove' | 'reject' | 'rework' | 'release'
export const EVENT_CREDIT: Readonly<Record<CreditEvent, CreditKey>> = {
  assign: 'as', claim: 'ip', report_completion: 'im', approve: 'xx',
  unapprove: 'im', reject: 'rw', rework: 'rw', release: 'as',
}

function validateTable(name: string, raw: unknown): { ok: true; table: CreditTable } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: `${name} 표는 객체여야 합니다.` }
  const o = raw as Record<string, unknown>
  for (const k of Object.keys(o)) {
    if (!(CREDIT_KEYS as readonly string[]).includes(k)) return { ok: false, error: `${name} 표에 모르는 키: ${k}` }
  }
  const t: Partial<CreditTable> = {}
  for (const k of CREDIT_KEYS) {
    const v = o[k]
    if (typeof v !== 'number' || !Number.isInteger(v)) return { ok: false, error: `${name}.${k} 는 정수여야 합니다.` }
    if (v < 0 || v > 100) return { ok: false, error: `${name}.${k} 는 0~100 이어야 합니다.` }
    if (v % CREDIT_STEP !== 0) return { ok: false, error: `${name}.${k} 는 ${CREDIT_STEP} 단위여야 합니다.` }
    t[k] = v
  }
  const table = t as CreditTable
  if (table.xx !== 100) return { ok: false, error: `${name}.xx 는 100 이어야 합니다.` }
  for (let i = 1; i < CREDIT_KEYS.length; i++) {
    const prev = table[CREDIT_KEYS[i - 1]], cur = table[CREDIT_KEYS[i]]
    if (cur - prev < CREDIT_GAP) return { ok: false, error: `${name}: ${CREDIT_KEYS[i - 1]} < ${CREDIT_KEYS[i]} 이고 간격이 ${CREDIT_GAP} 이상이어야 합니다.` }
  }
  return { ok: true, table }
}

export function validateStageCredits(raw: unknown): { ok: true; credits: StageCredits } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: '크레딧 표는 객체여야 합니다.' }
  const o = raw as Record<string, unknown>
  for (const k of Object.keys(o)) {
    if (!(CREDIT_TABLE_KEYS as readonly string[]).includes(k)) return { ok: false, error: `모르는 카테고리: ${k}` }
  }
  if (o.default === undefined) return { ok: false, error: 'default 표는 필수입니다.' }
  const out: Partial<StageCredits> = {}
  for (const k of CREDIT_TABLE_KEYS) {
    if (o[k] === undefined) continue
    const v = validateTable(k, o[k])
    if (!v.ok) return v
    out[k] = v.table
  }
  return { ok: true, credits: out as StageCredits }
}

/** credits null → 코드 기본값. 항목 credit_key 가 표에 없으면 default. xx 는 100 고정. */
export function creditForKey(key: CreditKey, credits: StageCredits | null, creditKey: string | null): number {
  if (key === 'xx') return 100
  const src = credits ?? DEFAULT_STAGE_CREDITS
  const table = (creditKey && (CREDIT_TABLE_KEYS as readonly string[]).includes(creditKey)
    ? src[creditKey as CreditTableKey]
    : undefined) ?? src.default ?? DEFAULT_STAGE_CREDITS.default
  return table[key]
}

/** 슬라이더 핸들 클램프 — 5 단위 스냅, 이웃 핸들과 10 간격, xx 는 100 고정. */
export function clampCredit(raw: number, key: CreditKey, table: CreditTable): number {
  if (key === 'xx') return 100
  const i = CREDIT_KEYS.indexOf(key)
  const snapped = Math.round(raw / CREDIT_STEP) * CREDIT_STEP
  const lo = i === 0 ? 0 : table[CREDIT_KEYS[i - 1]] + CREDIT_GAP
  const hi = table[CREDIT_KEYS[i + 1]] - CREDIT_GAP
  return Math.max(lo, Math.min(snapped, hi))
}
```

`src/lib/domain/agentWork.ts` 8~18행을 다음으로 교체한다.

```ts
/** WBS Task 단계 순서(스펙 2026-09-15 §3.2) — fp 는 0096 에서 ip 로 이관됐다. */
export const STAGE_ORDER = ['as', 'ip', 'im', 'xx'] as const

/** @deprecated 호출부가 predecessorReached 로 옮겨 가는 동안만 남긴다 — Task 4d 에서 지운다. */
export function stageAtLeast(stage: string | null, min: 'im'): boolean {
  if (stage === null) return false
  const stageIdx = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number])
  if (stageIdx === -1) return false
  return stageIdx >= STAGE_ORDER.indexOf(min)
}

/** "완료 도달"로 보는 단계 — §2.10 알림·선행 게이트 판정 축. */
export const REACHED_STAGES: ReadonlySet<string> = new Set(['im', 'xx'])

/**
 * 선행 충족(§3.7) = stage ∈ {im,xx} ∨ 승인된 주문 ∨ 실적 ≥ 100. 세 번째 축은 위임하지 않은 사람 Task 가
 * 선행일 때 드롭다운 없이 풀리게 한다. claim 게이트·대기 사유·WBS 착수 판정·unblocked 알림이 전부 이 함수다.
 * 실적은 원시값 비교(statusOf 의 done 판정과 같다 — 99.6 은 완료가 아니다).
 */
export function predecessorReached(p: { stage: string | null; orderApproved?: boolean; actualPct?: number | null }): boolean {
  if (p.stage !== null && REACHED_STAGES.has(p.stage)) return true
  if (p.orderApproved === true) return true
  return typeof p.actualPct === 'number' && Number.isFinite(p.actualPct) && p.actualPct >= 100
}
```

`src/lib/domain/waitReason.ts`: `import { stageAtLeast }` → `import { predecessorReached } from './agentWork'` + `import { stageLabelKo } from './stageLabels'`. `STAGE_LABEL` 은 허브 표(`DelegationTable`)가 Task 5 까지 쓰므로 남기되 `fp` 키만 지운다. `stageText` 는 `stage === null ? '단계 없음' : \`${stage}(${stageLabelKo(stage)})\``. `PredecessorLike` 에 `actual_pct: number | null` 추가. `unmetDepends` 의 판정을 `if (predecessorReached({ stage: p.stage, orderApproved: p.order_approved, actualPct: p.actual_pct })) continue` 로. 대기 사유 문구 `선행이 im(구현) 단계 이상이 되거나 그 주문이 승인돼야` → `선행이 검수 대기(im) 이상이거나, 그 주문이 승인됐거나, 실적이 100% 여야`.

`src/lib/domain/dependencyReadiness.ts`: import 를 `predecessorReached` 로 바꾸고 69~74행을

```ts
    const satisfied = dep.origin === 'spec'
      ? predecessorReached({ stage: predecessor.stage ?? null, actualPct: predecessor.rolledActualPct })
      : dep.type === 'SS'
        ? predecessor.rolledActualPct > 0
        : predecessor.rolledActualPct >= 100
```

주석의 `stageAtLeast(stage, 'im')` 설명도 "stage im·xx 또는 실적 100(predecessorReached — claim 게이트와 같은 함수)" 로 고친다. `src/lib/domain/types.ts:31-36` 의 stage 주석에서 `'fp'` 를 빼고 그 아래에

```ts
  /** 에이전트 위임(tags 에 'agent') 여부 — WBS 「단계」 컬럼 표시 조건(D9). 선택 필드인 이유는 stage 와 같다. */
  agentDelegated?: boolean
```

`src/lib/domain/agentHub.ts:189` 의 `byRef` 콜백이 만드는 `PredecessorLike` 에 `actual_pct: p.actual_pct` 를 넣는다(`AgentHubItem` 타입에 `actual_pct: number | null` 이 없으면 추가하고 `src/lib/data/agentHub.ts` 조회 select 에 `actual_pct` 를 더한다).

- [ ] **Step 5: 기존 테스트 갱신**

- `tests/domain/wait-reason.test.ts`: fp 케이스 삭제, `stageText('im')` 기대를 `'im(검수 대기)'` 로, `PredecessorLike` 픽스처에 `actual_pct: null` 추가, 실적 100 선행이 충족되는 케이스 1개 추가.
- `tests/domain/dependency-readiness.test.ts`: spec 링크에서 선행 `stage: null, rolledActualPct: 100` 이면 satisfied 인 케이스 추가, fp 참조 제거.
- `tests/domain/agent-hub.test.ts`·`tests/data/agent-hub.test.ts`·`tests/data/agent-seatmap.test.ts`: fp 픽스처를 ip 로.

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/domain` · `npx tsc --noEmit`
Expected: PASS, tsc 오류 0 (`stageAtLeast`·`STAGE_LABEL` 을 남겨 두어 기존 호출부가 깨지지 않는다).

- [ ] **Step 7: 커밋**

```bash
git add src/lib/domain/stageLabels.ts src/lib/domain/stageCredits.ts src/lib/domain/agentWork.ts src/lib/domain/waitReason.ts src/lib/domain/dependencyReadiness.ts src/lib/domain/types.ts src/lib/domain/agentHub.ts tests/domain/stage-labels.test.ts tests/domain/stage-credits.test.ts tests/domain/predecessor-reached.test.ts tests/domain/wait-reason.test.ts tests/domain/dependency-readiness.test.ts
git commit -m "feat(domain): 단계 라벨 정본·크레딧 표 검증·선행 충족 세 축 — fp 제거"
```

---

### Task 3: 마이그레이션 0096 + 롤백 + 스테이징 리허설

**Files:**
- Create: `supabase/migrations/0096_wbs_stage_credits.sql`, `supabase/migrations/0096_wbs_stage_credits_rollback.sql`
- Test: `tests/migrations/0096-wbs-stage-credits.test.ts`
- Reference: `supabase/migrations/0089_wbs_nlevel_import.sql:23-140`(import RPC 본문), `0082_wbs_stage_workflow.sql`(CHECK 재정의 관례)

**Interfaces (Produces):** `public.apply_workflow_event(p_event text, p_actor uuid, p_item_id uuid = null, p_order_id uuid = null, p_stage text = null, p_agent text = null, p_agent_user_id uuid = null) returns jsonb`

반환 jsonb: `{ ok, conflict?, reason?, order_status, stage, actual_pct, stage_changed, actual_changed, reached_first, skipped }`. 실패 reason: `bad_event | item_required | item_not_found | order_required | order_not_found | order_item_mismatch | bad_stage | not_workflow | parent | active_order`. skipped: `parent | not_workflow | stage | no_item | null`.

- [ ] **Step 1: 마이그레이션 테스트 작성**

```ts
// tests/migrations/0096-wbs-stage-credits.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STAGE_CREDITS } from '@/lib/domain/stageCredits'

const s = () => readFileSync('supabase/migrations/0096_wbs_stage_credits.sql', 'utf8')
const r = () => readFileSync('supabase/migrations/0096_wbs_stage_credits_rollback.sql', 'utf8')

describe('0096 진척·단계·크레딧 — 크레딧 컬럼·fp 제거·원자 전이 RPC', () => {
  it('stage_credits jsonb 컬럼을 additive 로 추가한다', () => {
    expect(s()).toContain('alter table public.project_settings add column if not exists stage_credits jsonb')
  })
  it("fp→ip 이관이 CHECK 재정의보다 먼저이고, CHECK 에 fp 가 없다", () => {
    const body = s()
    const mig = body.indexOf("update public.wbs_items set stage = 'ip' where stage = 'fp'")
    const chk = body.indexOf("add constraint wbs_items_stage_check check (stage in ('as','ip','im','xx'))")
    expect(mig).toBeGreaterThan(-1)
    expect(chk).toBeGreaterThan(mig)
  })
  it("import RPC 가 stage fp 를 ip 로 정규화한다(0089 본문 + 그 줄만)", () => {
    expect(s()).toContain("case when v_node->>'stage' in ('', 'todo') then null when v_node->>'stage' = 'fp' then 'ip' else v_node->>'stage' end")
    const updateClause = s().split('create or replace function public.import_wbs_upsert')[1].split('do update set')[1] ?? ''
    for (const kept of ['stage', 'assignee_member_id', 'actual_pct']) {
      expect(updateClause.split('returning')[0]).not.toContain(`${kept} =`)
    }
  })
  it('apply_workflow_event 는 security invoker 이고 service_role 만 실행한다', () => {
    const body = s()
    const fn = body.split('create or replace function public.apply_workflow_event')[1] ?? ''
    expect(fn.split('$$')[0]).toContain('security invoker')
    expect(body).toContain('revoke all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated')
    expect(body).toContain('grant execute on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) to service_role')
  })
  it('SQL 기본 크레딧 상수가 코드 기본값과 같다', () => {
    const m = /c_default\s+constant\s+jsonb\s*:=\s*'(\{.*?\})'::jsonb/s.exec(s())
    expect(m).not.toBeNull()
    expect(JSON.parse(m![1])).toEqual(DEFAULT_STAGE_CREDITS)
  })
  it('RPC 가 항목·주문 행을 for update 로 잠그고 사건별 기대 status 로 CAS 한다', () => {
    const body = s()
    expect(body).toContain('from public.wbs_items where id = v_item_id for update')
    expect(body).toContain('from public.agent_work_orders where id = p_order_id for update')
    expect(body).toContain("when 'approve' then 'reported'")
    expect(body).toContain("'conflict', true")
  })
  it('rollback 이 함수·컬럼을 지우고 CHECK 를 fp 포함으로, import RPC 를 0089 본문으로 되돌린다', () => {
    const rb = r()
    expect(rb).toContain('drop function if exists public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid)')
    expect(rb).toContain('drop column if exists stage_credits')
    expect(rb).toMatch(/add constraint wbs_items_stage_check check \(stage in \('as','fp','ip','im','xx'\)\)/)
    expect(rb).toContain("case when v_node->>'stage' in ('', 'todo') then null else v_node->>'stage' end")
    expect(rb).not.toContain("= 'fp' then 'ip'")
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/migrations/0096-wbs-stage-credits.test.ts`
Expected: FAIL — 파일 없음(ENOENT).

- [ ] **Step 3: 마이그레이션 작성**

`0089_wbs_nlevel_import.sql` 23~140행(`create or replace function public.import_wbs_upsert(` 부터 `$$;` 까지)을 그대로 복사해 아래 `-- 3)` 자리에 넣고, 87행에 해당하는 stage case 식 한 줄만 `case when v_node->>'stage' in ('', 'todo') then null when v_node->>'stage' = 'fp' then 'ip' else v_node->>'stage' end,` 로 바꾼다.

```sql
-- supabase/migrations/0096_wbs_stage_credits.sql
-- 진척·단계·실적 크레딧(docs/superpowers/specs/2026-09-15-wbs-stage-credit-design.md §7).
-- 1) project_settings.stage_credits — 단계 전이 크레딧 표(null = 코드 기본값).
-- 2) stage 어휘에서 fp 제거 — 자동 경로 0건, 라벨 두 벌의 원인. 기존 fp 행은 ip(작업 중)로 이관.
-- 3) import_wbs_upsert — 입력 fp 를 ip 로 정규화(0089 본문 기준 그 줄만).
-- 4) apply_workflow_event — 주문 CAS·단계·실적 크레딧·change_logs 를 한 트랜잭션으로.
--    승인은 됐는데 단계·실적이 뒤처진 반쪽 상태(앱 층 분리 실행)를 없앤다.
-- 사전 확인: select count(*) from public.wbs_items where stage = 'fp';
begin;
set search_path = public, extensions;

-- 1) 크레딧 표
alter table public.project_settings add column if not exists stage_credits jsonb;
comment on column public.project_settings.stage_credits is
  '단계 전이 실적 크레딧 {default:{as,ip,rw,im,xx}, if?, doc?} — null 이면 코드 기본값. 규칙: 정수·5단위·as<ip<rw<im<xx·간격≥10·xx=100';

-- 2) fp 제거 — 이관이 CHECK 재정의보다 먼저
update public.wbs_items set stage = 'ip' where stage = 'fp';
alter table public.wbs_items drop constraint if exists wbs_items_stage_check;
alter table public.wbs_items
  add constraint wbs_items_stage_check check (stage in ('as','ip','im','xx'));

-- 3) import RPC — 0089 본문 + stage 정규화 식에 fp→ip
-- (여기에 0089 의 create or replace function public.import_wbs_upsert ... $$; 를 그대로 붙이고 stage case 한 줄만 바꾼다)

-- 4) 원자 전이 RPC
create or replace function public.apply_workflow_event(
  p_event         text,
  p_actor         uuid,
  p_item_id       uuid default null,   -- assign|unassign|set_stage 필수. 주문 사건은 주문의 wbs_item_id 를 쓴다(주면 일치해야 한다)
  p_order_id      uuid default null,   -- 주문 사건 필수
  p_stage         text default null,   -- set_stage 전용
  p_agent         text default null,   -- claim: 기록 / report_completion·release: 점유자 일치 조건
  p_agent_user_id uuid default null    -- 위와 같다(PAT 계정)
) returns jsonb
language plpgsql
security invoker
as $$
declare
  c_default constant jsonb := '{"default":{"as":0,"ip":30,"rw":50,"im":80,"xx":100},"if":{"as":0,"ip":20,"rw":30,"im":50,"xx":100},"doc":{"as":0,"ip":20,"rw":30,"im":50,"xx":100}}'::jsonb;
  -- record 대신 스칼라를 쓴다: 항목이 지워진 주문처럼 SELECT INTO 를 건너뛴 경로에서 미할당 record 의
  -- 필드를 참조하면 CASE 의 안 타는 분기라도 "record is not assigned yet" 로 실패한다.
  v_is_order_event boolean;
  v_order_status text;
  v_order_claimed_by text;
  v_order_claimed_by_user uuid;
  v_order_item uuid;
  v_item_id uuid;
  v_item_found boolean := false;
  v_project_id uuid;
  v_old_stage text;
  v_old_pct numeric;
  v_dev_workflow boolean;
  v_item_credit_key text;
  v_is_leaf boolean := false;
  v_expect text;
  v_next text;
  v_apply boolean := false;
  v_new_stage text;
  v_credit_key text;
  v_credits jsonb;
  v_table jsonb;
  v_new_pct numeric;
  v_skipped text;
  v_stage_changed boolean := false;
  v_actual_changed boolean := false;
  v_reached_first boolean := false;
  v_now timestamptz := now();
begin
  if p_event is null or p_event not in ('assign','unassign','claim','report_completion','approve','unapprove','reject','rework','release','set_stage') then
    return jsonb_build_object('ok', false, 'reason', 'bad_event');
  end if;
  v_is_order_event := p_event in ('claim','report_completion','approve','unapprove','reject','rework','release');

  -- 주문 사건: 주문을 잠그고 사건이 정한 기대 status·점유자 조건으로 CAS
  if v_is_order_event then
    if p_order_id is null then
      return jsonb_build_object('ok', false, 'reason', 'order_required');
    end if;
    select status, claimed_by, claimed_by_user_id, wbs_item_id
      into v_order_status, v_order_claimed_by, v_order_claimed_by_user, v_order_item
      from public.agent_work_orders where id = p_order_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'order_not_found');
    end if;
    if p_item_id is not null and v_order_item is distinct from p_item_id then
      return jsonb_build_object('ok', false, 'reason', 'order_item_mismatch');
    end if;
    v_item_id := v_order_item;
    v_expect := case p_event
      when 'claim' then 'ready'
      when 'report_completion' then 'claimed'
      when 'release' then 'claimed'
      when 'approve' then 'reported'
      when 'reject' then 'reported'
      when 'unapprove' then 'approved'
      when 'rework' then 'approved' end;
    v_next := case p_event
      when 'claim' then 'claimed'
      when 'report_completion' then 'reported'
      when 'release' then 'ready'
      when 'approve' then 'approved'
      when 'reject' then 'claimed'
      when 'unapprove' then 'reported'
      when 'rework' then 'claimed' end;
    if v_order_status <> v_expect
       or (p_event in ('report_completion','release') and p_agent_user_id is not null and v_order_claimed_by_user is distinct from p_agent_user_id)
       or (p_event in ('report_completion','release') and p_agent is not null and v_order_claimed_by is distinct from p_agent)
    then
      return jsonb_build_object('ok', false, 'conflict', true, 'order_status', v_order_status);
    end if;
  else
    if p_item_id is null then
      return jsonb_build_object('ok', false, 'reason', 'item_required');
    end if;
    v_item_id := p_item_id;
  end if;

  -- 항목 잠금. 주문 사건에서 항목이 지워진 주문이면 단계·실적만 건너뛴다(주문 전이는 한다).
  if v_item_id is not null then
    select project_id, stage, actual_pct, dev_workflow, credit_key
      into v_project_id, v_old_stage, v_old_pct, v_dev_workflow, v_item_credit_key
      from public.wbs_items where id = v_item_id for update;
    v_item_found := found;
    if v_item_found then
      v_is_leaf := not exists (select 1 from public.wbs_items where parent_id = v_item_id);
    elsif not v_is_order_event then
      return jsonb_build_object('ok', false, 'reason', 'item_not_found');
    end if;
  end if;

  -- 주문 갱신
  if v_is_order_event then
    if p_event = 'claim' then
      update public.agent_work_orders
         set status = 'claimed', claimed_by = p_agent, claimed_by_user_id = p_agent_user_id,
             claimed_at = v_now, updated_at = v_now
       where id = p_order_id;
    elsif p_event = 'release' then
      update public.agent_work_orders
         set status = 'ready', claimed_by = null, claimed_by_user_id = null, claimed_at = null,
             last_heartbeat_at = null, heartbeat_phase = null, heartbeat_agent = null, heartbeat_note = null,
             updated_at = v_now
       where id = p_order_id;
    else
      update public.agent_work_orders set status = v_next, updated_at = v_now where id = p_order_id;
    end if;
  end if;

  -- 단계·실적 결정(스펙 §3.4·§4.2)
  if v_is_order_event then
    -- 주문의 존재가 워크플로 증거 — dev_workflow 를 보지 않는다(구 force 의 일반화). 리프에만.
    if not v_item_found then v_skipped := 'no_item';
    elsif not v_is_leaf then v_skipped := 'parent';
    else
      v_apply := true;
      v_new_stage := case p_event
        when 'claim' then 'ip' when 'report_completion' then 'im' when 'approve' then 'xx'
        when 'unapprove' then 'im' when 'reject' then 'ip' when 'rework' then 'ip' when 'release' then 'as' end;
      v_credit_key := case p_event
        when 'claim' then 'ip' when 'report_completion' then 'im' when 'approve' then 'xx'
        when 'unapprove' then 'im' when 'reject' then 'rw' when 'rework' then 'rw' when 'release' then 'as' end;
    end if;
  elsif p_event = 'assign' then
    if v_dev_workflow is not true then v_skipped := 'not_workflow';
    elsif not v_is_leaf then v_skipped := 'parent';
    elsif v_old_stage is not null then v_skipped := 'stage';
    else v_apply := true; v_new_stage := 'as'; v_credit_key := 'as';
    end if;
  elsif p_event = 'unassign' then
    if v_dev_workflow is not true then v_skipped := 'not_workflow';
    elsif v_old_stage is distinct from 'as' then v_skipped := 'stage';
    else v_apply := true; v_new_stage := null; v_credit_key := null;
    end if;
  else -- set_stage
    if p_stage is not null and p_stage not in ('as','ip','im','xx') then
      return jsonb_build_object('ok', false, 'reason', 'bad_stage');
    end if;
    -- 활성 주문이 있으면 해제(null)도 거부 — 단계는 승인·반려로만 바뀐다(§3.5).
    if exists (select 1 from public.agent_work_orders
                where wbs_item_id = v_item_id and status in ('ready','claimed','reported')) then
      return jsonb_build_object('ok', false, 'reason', 'active_order');
    end if;
    if p_stage is null then
      -- 해제는 워크플로·리프와 무관하게 허용(잘못 찍힌 값을 지울 길). 실적 불변.
      v_apply := true; v_new_stage := null; v_credit_key := null;
    else
      if v_dev_workflow is not true then return jsonb_build_object('ok', false, 'reason', 'not_workflow'); end if;
      if not v_is_leaf then return jsonb_build_object('ok', false, 'reason', 'parent'); end if;
      v_apply := true; v_new_stage := p_stage; v_credit_key := p_stage;
    end if;
  end if;

  if v_apply then
    if v_credit_key = 'xx' then
      v_new_pct := 100;
    elsif v_credit_key is not null then
      select stage_credits into v_credits from public.project_settings where project_id = v_project_id;
      v_credits := coalesce(v_credits, c_default);
      v_table := coalesce(v_credits -> coalesce(v_item_credit_key, 'default'), v_credits -> 'default', c_default -> 'default');
      v_new_pct := coalesce((v_table ->> v_credit_key)::numeric, (c_default -> 'default' ->> v_credit_key)::numeric);
    end if;
    if v_new_stage is distinct from v_old_stage then
      v_stage_changed := true;
      v_reached_first := coalesce(v_new_stage in ('im','xx'), false) and not coalesce(v_old_stage in ('im','xx'), false);
      insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
        values (p_actor, v_item_id, 'stage', v_old_stage, v_new_stage);
    end if;
    if v_new_pct is not null and v_new_pct is distinct from v_old_pct then
      v_actual_changed := true;
      insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
        values (p_actor, v_item_id, 'actual_pct', v_old_pct::text, v_new_pct::text);
    end if;
    if v_stage_changed or v_actual_changed then
      update public.wbs_items
         set stage = case when v_stage_changed then v_new_stage else stage end,
             actual_pct = case when v_actual_changed then v_new_pct else actual_pct end,
             updated_at = v_now
       where id = v_item_id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_status', case when v_is_order_event then v_next end,
    'stage', case when v_stage_changed then v_new_stage else v_old_stage end,
    'actual_pct', case when v_actual_changed then v_new_pct else v_old_pct end,
    'stage_changed', v_stage_changed,
    'actual_changed', v_actual_changed,
    'reached_first', v_reached_first,
    'skipped', v_skipped);
end;
$$;

revoke all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) to service_role;

reset search_path;
commit;
```

롤백:

```sql
-- supabase/migrations/0096_wbs_stage_credits_rollback.sql
begin;
set search_path = public, extensions;

drop function if exists public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid);

-- import RPC 를 0089 본문으로 복원(stage case 식에서 fp 정규화 제거)
-- (여기에 0089 의 create or replace function public.import_wbs_upsert ... $$; 를 그대로 붙인다)

-- CHECK 를 0082 형태로 복원. 이관된 행(fp→ip)은 되돌리지 않는다 — 데이터 손실 없음.
alter table public.wbs_items drop constraint if exists wbs_items_stage_check;
alter table public.wbs_items
  add constraint wbs_items_stage_check check (stage in ('as','fp','ip','im','xx'));

alter table public.project_settings drop column if exists stage_credits;

reset search_path;
commit;
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/migrations`
Expected: PASS(rollback 짝 검사 포함).

- [ ] **Step 5: 스테이징 리허설**

```bash
npm run db:apply -- supabase/migrations/0096_wbs_stage_credits.sql --target staging
```

검증 SQL(스크래치패드 `verify-0096.sql`)을 같은 명령으로 실행한다. 트랜잭션 안에서 실제 리프 dev_workflow 항목 하나로 set_stage 를 부르고 롤백한다.

```sql
begin;
select count(*) as fp_rows from public.wbs_items where stage = 'fp';
select column_name from information_schema.columns where table_name = 'project_settings' and column_name = 'stage_credits';
select proname, prosecdef from pg_proc where proname = 'apply_workflow_event';
with leaf as (
  select i.id, i.stage, i.actual_pct from public.wbs_items i
   where i.dev_workflow and not exists (select 1 from public.wbs_items c where c.parent_id = i.id)
     and not exists (select 1 from public.agent_work_orders o where o.wbs_item_id = i.id and o.status in ('ready','claimed','reported'))
   limit 1)
select l.stage as before_stage, l.actual_pct as before_pct,
       public.apply_workflow_event('set_stage', (select user_id from public.change_logs limit 1), l.id, null, 'im') as result
  from leaf l;
rollback;
```

Expected: `fp_rows = 0`, 컬럼 1행, `prosecdef = false`, result 에 `"ok": true, "stage": "im", "actual_pct": 80, "stage_changed": true` (항목 credit_key 가 if/doc 이면 50).

- [ ] **Step 6: 마이그레이션만 커밋(G1) + 트레일러(G4)**

```bash
git add supabase/migrations/0096_wbs_stage_credits.sql supabase/migrations/0096_wbs_stage_credits_rollback.sql tests/migrations/0096-wbs-stage-credits.test.ts
git commit -m "migrate(0096): 실적 크레딧 표·fp 제거·원자 전이 RPC apply_workflow_event" --trailer "Staging-verified: 2026-09-15 db 리허설 통과"
```

---

### Task 4a: RPC 래퍼 `workflowEvent.ts` + `stageTransition.ts` 정리

**Files:**
- Create: `src/lib/agent/workflowEvent.ts`
- Modify: `src/lib/agent/stageTransition.ts`(`transitionStage`·`REACHED_STAGES` 삭제, `allPredecessorsReached` 판정 교체), `src/lib/agent/depends.ts`
- Delete: `src/lib/agent/applyProgress.ts`, `tests/agent/apply-progress.test.ts`
- Test: `tests/agent/workflow-event.test.ts`(생성), `tests/agent/stage-transition.test.ts`(알림만 남김), `tests/agent/depends-gate.test.ts`

**Interfaces (Produces):**
```ts
export type WorkflowEvent = 'assign'|'unassign'|'claim'|'report_completion'|'approve'|'unapprove'|'reject'|'rework'|'release'|'set_stage'
export type WorkflowEventArgs = { event: WorkflowEvent; actorUserId: string; itemId?: string | null; orderId?: string | null; stage?: string | null; agent?: string | null; agentUserId?: string | null }
export type WorkflowEventOk = { ok: true; orderStatus: string | null; stage: string | null; actualPct: number | null; stageChanged: boolean; actualChanged: boolean; reachedFirst: boolean; skipped: 'parent'|'not_workflow'|'stage'|'no_item'|null }
export type WorkflowEventFail = { ok: false; conflict: boolean; reason: string; orderStatus: string | null; error: string }
export async function applyWorkflowEvent(admin: AdminClient, args: WorkflowEventArgs): Promise<WorkflowEventOk | WorkflowEventFail>
export const REASON_TEXT: Record<string, string>
export const SKIPPED_WARN: Record<string, string>
export async function notifyOnReached(admin: AdminClient, itemId: string, actorUserId: string): Promise<void>
```
- `DependInfo` 에 `actual_pct: number | null; reached: boolean` 추가.

- [ ] **Step 1: 래퍼 테스트**

```ts
// tests/agent/workflow-event.test.ts
import { describe, expect, it, vi } from 'vitest'
import { applyWorkflowEvent, REASON_TEXT } from '@/lib/agent/workflowEvent'

function admin(reply: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn(async () => ({ data: reply.data ?? null, error: reply.error ?? null }))
  return { client: { rpc } as never, rpc }
}
const W1 = '33333333-3333-4333-8333-333333333333'
const O1 = '22222222-2222-4222-8222-222222222222'

describe('applyWorkflowEvent — RPC 인자 매핑·결과 파싱', () => {
  it('인자를 p_* 로 넘기고 성공 jsonb 를 camelCase 로 돌려준다', async () => {
    const { client, rpc } = admin({ data: { ok: true, order_status: 'approved', stage: 'xx', actual_pct: 100, stage_changed: true, actual_changed: true, reached_first: true, skipped: null } })
    const r = await applyWorkflowEvent(client, { event: 'approve', actorUserId: 'u1', orderId: O1 })
    expect(rpc).toHaveBeenCalledWith('apply_workflow_event', {
      p_event: 'approve', p_actor: 'u1', p_item_id: null, p_order_id: O1, p_stage: null, p_agent: null, p_agent_user_id: null,
    })
    expect(r).toEqual({ ok: true, orderStatus: 'approved', stage: 'xx', actualPct: 100, stageChanged: true, actualChanged: true, reachedFirst: true, skipped: null })
  })
  it('conflict 는 ok:false·conflict:true·현재 status', async () => {
    const { client } = admin({ data: { ok: false, conflict: true, order_status: 'claimed' } })
    const r = await applyWorkflowEvent(client, { event: 'approve', actorUserId: 'u1', orderId: O1 })
    expect(r).toMatchObject({ ok: false, conflict: true, reason: 'conflict', orderStatus: 'claimed', error: REASON_TEXT.conflict })
  })
  it('reason 은 사람 문구로, 모르는 reason 도 감추지 않는다', async () => {
    const { client } = admin({ data: { ok: false, reason: 'active_order' } })
    expect(await applyWorkflowEvent(client, { event: 'set_stage', actorUserId: 'u1', itemId: W1, stage: 'im' }))
      .toMatchObject({ ok: false, conflict: false, reason: 'active_order', error: REASON_TEXT.active_order })
    const { client: c2 } = admin({ data: { ok: false, reason: 'weird' } })
    expect(await applyWorkflowEvent(c2, { event: 'assign', actorUserId: 'u1', itemId: W1 })).toMatchObject({ ok: false, error: '전이 실패(weird)' })
  })
  it('RPC 오류는 rpc_error 로 그대로 드러낸다', async () => {
    const { client } = admin({ error: { message: 'boom' } })
    expect(await applyWorkflowEvent(client, { event: 'assign', actorUserId: 'u1', itemId: W1 })).toMatchObject({ ok: false, reason: 'rpc_error', error: '전이 실패: boom' })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/workflow-event.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// src/lib/agent/workflowEvent.ts
import type { AdminClient } from '@/lib/minutes/externalApi'
import { notifySuccessorsOnReached } from '@/lib/agent/stageTransition'

/**
 * 원자 전이 RPC apply_workflow_event 의 앱 층 입구(스펙 2026-09-15 §4). 주문 CAS·단계·실적 크레딧·
 * change_logs 는 DB 트랜잭션 하나가 한다 — 여기서는 인자 매핑·결과 파싱·사유 문구만.
 * 호출부는 성공 뒤 actualChanged 면 스냅샷, reachedFirst 면 notifyOnReached 를 부른다(둘 다 실패는 로깅만).
 */
export type WorkflowEvent =
  | 'assign' | 'unassign' | 'claim' | 'report_completion' | 'approve' | 'unapprove' | 'reject' | 'rework' | 'release' | 'set_stage'

export type WorkflowEventArgs = {
  event: WorkflowEvent
  actorUserId: string
  /** assign·unassign·set_stage 필수. 주문 사건은 생략(주문의 wbs_item_id 를 쓴다). */
  itemId?: string | null
  orderId?: string | null
  stage?: string | null
  /** claim 은 기록, report_completion·release 는 점유자 일치 조건. 사람 사건은 null. */
  agent?: string | null
  agentUserId?: string | null
}

export type WorkflowSkipped = 'parent' | 'not_workflow' | 'stage' | 'no_item'
export type WorkflowEventOk = {
  ok: true; orderStatus: string | null; stage: string | null; actualPct: number | null
  stageChanged: boolean; actualChanged: boolean; reachedFirst: boolean; skipped: WorkflowSkipped | null
}
export type WorkflowEventFail = { ok: false; conflict: boolean; reason: string; orderStatus: string | null; error: string }

export const REASON_TEXT: Record<string, string> = {
  conflict: '상태가 바뀌어 처리하지 못했습니다. 다시 시도하세요.',
  active_order: '에이전트에 위임된 작업입니다. 단계는 승인·반려로 바뀝니다. 직접 바꾸려면 위임을 끄세요.',
  not_workflow: '개발 워크플로 대상이 아닌 항목입니다.',
  parent: '하위 항목이 있습니다 — 개발 워크플로 단계는 최종단계에만 지정합니다.',
  item_required: '항목이 필요한 사건입니다.',
  item_not_found: '항목 없음',
  order_required: '주문이 필요한 사건입니다.',
  order_not_found: '주문 없음',
  order_item_mismatch: '주문의 항목이 다릅니다.',
  bad_event: '알 수 없는 사건입니다.',
  bad_stage: '허용되지 않는 단계입니다.',
}

/** 주문 사건이 단계·실적을 건너뛴 사유 — 사람이 할 일이 다르므로 warning 으로 드러낸다. */
export const SKIPPED_WARN: Record<WorkflowSkipped, string> = {
  parent: '처리는 됐지만 이 항목에 하위 항목이 있어 단계·실적을 바꾸지 않았습니다 — 개발 워크플로 단계는 최종단계의 것입니다. 주문이 상위 항목에 나간 경위를 확인하세요.',
  no_item: '처리는 됐지만 WBS 항목이 삭제된 주문이라 단계·실적을 바꾸지 않았습니다.',
  not_workflow: '처리는 됐지만 개발 워크플로 대상이 아니라 단계·실적을 바꾸지 않았습니다.',
  stage: '처리는 됐지만 현재 단계가 자동 전이 대상이 아니라 그대로 두었습니다.',
}

export async function applyWorkflowEvent(admin: AdminClient, args: WorkflowEventArgs): Promise<WorkflowEventOk | WorkflowEventFail> {
  const { data, error } = await admin.rpc('apply_workflow_event', {
    p_event: args.event, p_actor: args.actorUserId,
    p_item_id: args.itemId ?? null, p_order_id: args.orderId ?? null, p_stage: args.stage ?? null,
    p_agent: args.agent ?? null, p_agent_user_id: args.agentUserId ?? null,
  })
  if (error) return { ok: false, conflict: false, reason: 'rpc_error', orderStatus: null, error: `전이 실패: ${error.message}` }
  const r = (data ?? {}) as Record<string, unknown>
  const orderStatus = typeof r.order_status === 'string' ? r.order_status : null
  if (r.ok !== true) {
    const conflict = r.conflict === true
    const reason = typeof r.reason === 'string' ? r.reason : conflict ? 'conflict' : 'unknown'
    return { ok: false, conflict, reason, orderStatus, error: REASON_TEXT[reason] ?? `전이 실패(${reason})` }
  }
  return {
    ok: true, orderStatus,
    stage: typeof r.stage === 'string' ? r.stage : null,
    actualPct: r.actual_pct == null ? null : Number(r.actual_pct),
    stageChanged: r.stage_changed === true, actualChanged: r.actual_changed === true, reachedFirst: r.reached_first === true,
    skipped: typeof r.skipped === 'string' ? (r.skipped as WorkflowSkipped) : null,
  }
}

/** im·xx 첫 도달 뒤 후행 unblocked 알림(§2.10) — 항목을 읽어 notifySuccessorsOnReached 에 넘긴다. 실패는 로깅만. */
export async function notifyOnReached(admin: AdminClient, itemId: string, actorUserId: string): Promise<void> {
  const { data, error } = await admin
    .from('wbs_items').select('id, project_id, name, external_ref').eq('id', itemId).maybeSingle()
  if (error || !data) {
    console.error('[workflowEvent] 도달 알림용 항목 조회 실패:', error?.message ?? '0행')
    return
  }
  await notifySuccessorsOnReached(admin, data as { id: string; project_id: string; name: string; external_ref: string | null }, actorUserId)
}
```

`src/lib/agent/stageTransition.ts`: `WbsStage` 타입·`REACHED_STAGES`·`transitionStage` 를 지우고 `import { predecessorReached } from '@/lib/domain/agentWork'`. `allPredecessorsReached` 의 select 를 `'external_ref, stage, actual_pct'` 로, 판정을 `rows.every(r => predecessorReached({ stage: r.stage, actualPct: r.actual_pct }))` 로. 파일 머리 주석을 "단계 전이는 RPC apply_workflow_event(workflowEvent.ts) — 여기는 도달 알림만" 으로.

`src/lib/agent/depends.ts`: `DependInfo` 에 `actual_pct: number | null; reached: boolean`. select 를 `'id, external_ref, stage, actual_pct'` 로. 미발견 ref 는 `{ ..., actual_pct: null, order_approved: false, reached: false }`. 발견 시 `reached: predecessorReached({ stage: item.stage, orderApproved: order !== null, actualPct: item.actual_pct })`.

`src/lib/agent/applyProgress.ts`·`tests/agent/apply-progress.test.ts` 삭제(`git rm`).

- [ ] **Step 4: 테스트 갱신**

- `tests/agent/stage-transition.test.ts`: `transitionStage` 관련 describe 전부 삭제, `notifySuccessorsOnReached` 테스트만 남기고 선행 조회 픽스처에 `actual_pct` 를 넣는다. "선행 실적 100 이면 stage null 이어도 발행" 케이스 1개 추가.
- `tests/agent/depends-gate.test.ts`: `loadDependsInfo` 결과에 `actual_pct`·`reached` 기대 추가, `stageAtLeast` import 제거.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/agent/workflow-event.test.ts tests/agent/stage-transition.test.ts tests/agent/depends-gate.test.ts`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/agent/workflowEvent.ts src/lib/agent/stageTransition.ts src/lib/agent/depends.ts tests/agent/workflow-event.test.ts tests/agent/stage-transition.test.ts tests/agent/depends-gate.test.ts
git rm src/lib/agent/applyProgress.ts tests/agent/apply-progress.test.ts
git commit -m "feat(agent): 전이 RPC 래퍼 applyWorkflowEvent — transitionStage·applyProgress 폐기, 선행 판정에 실적 축"
```

---

### Task 4b: 에이전트 라우트(claim·report·release)

**Files:**
- Modify: `src/app/api/v1/agent/work/[id]/claim/route.ts`, `.../report/route.ts`, `.../release/route.ts`
- Test: `tests/agent/stage-lifecycle.test.ts`(재작성), `tests/agent/report-route.test.ts`, `tests/agent/work-routes-pat.test.ts`(수정)

- [ ] **Step 1: 라우트 테스트 갱신(실패 상태로)**

`tests/agent/stage-lifecycle.test.ts` 를 다음 골자로 재작성한다. admin 목에 `rpc` 큐를 둔다.

```ts
function useAdmin(queues: Record<string, Resp[]>, rpcReplies: Array<{ data?: unknown; error?: { message: string } | null }>) {
  const rpcCalls: Array<[string, Record<string, unknown>]> = []
  const client = {
    from: vi.fn((table: string) => { /* 기존 큐 빌더 그대로 */ }),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push([fn, args])
      const r = rpcReplies.shift() ?? { data: null, error: null }
      return { data: r.data ?? null, error: r.error ?? null }
    }),
  }
  mocks.createAdminClient.mockReturnValue(client)
  return { client, rpcCalls }
}
```

케이스:
- `claim`: 선행 없음·ready 주문 → `rpcCalls[0]` 이 `['apply_workflow_event', { p_event: 'claim', p_order_id: O1, p_agent: 'agent-a', p_agent_user_id: null, ... }]`, 응답 200 `{ status: 'claimed' }`. RPC 가 `{ok:false, conflict:true, order_status:'claimed'}` 면 409 `code: 'conflict'`.
- `claim` 선행 게이트: `loadDependsInfo` 재료(`wbs_items` 큐)가 `stage: null, actual_pct: 100` 이면 통과, `stage: 'ip', actual_pct: 30` + approved 주문 없음이면 403 `dependency_not_met` 이고 `unmet[0].stage === 'ip'`.
- `report` progress: RPC 를 부르지 않고(`rpcCalls.length === 0`) 보고 행 insert payload 가 `applied_to_wbs: false`, 응답 `{ status: 'claimed', applied_to_wbs: false }`, `wbs_items` update 없음.
- `report` completion: 보고 insert 뒤 RPC `p_event: 'report_completion'`, PAT 이면 `p_agent_user_id`, legacy 면 `p_agent`. conflict 면 보고 행 delete(cleanup) + 409. 성공 시 `{ status: 'reported' }`.
- `release`(API): RPC `p_event: 'release'` + 점유자 인자, conflict → 409, 성공 200 `{ status: 'ready' }`.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/stage-lifecycle.test.ts`
Expected: FAIL — 라우트가 아직 `transitionStage`/직접 UPDATE 를 쓴다.

- [ ] **Step 3: claim 라우트**

import 에서 `stageAtLeast`·`transitionStage` 를 지우고 `import { applyWorkflowEvent, notifyOnReached } from '@/lib/agent/workflowEvent'`, `import { revalidatePath } from 'next/cache'`, `import { after } from 'next/server'`, `import { recordProgressSnapshot } from '@/lib/data/snapshots'`. 선행 게이트(66행)를 `const unmet = dependsInfo.filter((d) => !d.reached)` 로, 문구를 `'선행 작업이 완료(검수 대기 이상·승인·실적 100%)되지 않았습니다.'` 로. 76~100행 CAS 블록과 115~126행 전이 블록을 지우고 알림 앞에:

```ts
    // 원자 전이 — 주문 ready→claimed CAS + 단계 ip + 실적 크레딧이 한 트랜잭션(스펙 §4). 점유자 신원은 서버 유도값.
    // 항목이 지워진 주문은 RPC 가 단계·실적만 건너뛴다(skipped:'no_item') — claim 자체는 종전처럼 된다.
    const transition = await applyWorkflowEvent(admin, {
      event: 'claim', actorUserId: loaded.userId, orderId: id,
      agent: actor.agentLabel, agentUserId: actor.principal.kind === 'pat' ? (actor.userId as string) : null,
    })
    if (!transition.ok) {
      if (transition.conflict) {
        return NextResponse.json(
          { error: '이미 다른 에이전트가 점유했거나 점유 불가 상태입니다.', code: 'conflict', status: transition.orderStatus ?? 'unknown' },
          { status: 409 },
        )
      }
      console.error('[agent-api] claim 전이 실패:', transition.error)
      return apiInternalError()
    }
    if (transition.actualChanged) {
      revalidatePath(`/p/${loaded.order.project_id}`, 'layout')
      after(() => recordProgressSnapshot(loaded.order.project_id, admin as never))
    }
    if (transition.reachedFirst && loaded.order.wbs_item_id) await notifyOnReached(admin, loaded.order.wbs_item_id, loaded.userId)
```

(`item` 로드 블록은 그대로 둔다.)

- [ ] **Step 4: report 라우트**

import 에서 `applyAgentProgress`·`transitionStage` 를 지우고 `applyWorkflowEvent, notifyOnReached` 를 넣는다. 82~93행(progress 반영)을 삭제하고 `appliedToWbs` 상수를 `false` 로 둔다(보고 행 `applied_to_wbs: false`, 응답 `applied_to_wbs: false` — 계약 v2.3: progress 는 보고 행만). 110~167행(completion CAS·알림·전이)을:

```ts
    if (kind === 'completion') {
      // 원자 전이 — claimed→reported CAS(점유자 일치) + 단계 im + 실적 표.im 이 한 트랜잭션. 경합·오류는 보고 행 cleanup.
      const transition = await applyWorkflowEvent(admin, {
        event: 'report_completion', actorUserId: loaded.userId, orderId: id,
        agent: actor.principal.kind === 'pat' ? null : actor.agentLabel,
        agentUserId: actor.principal.kind === 'pat' ? (actor.userId as string) : null,
      })
      if (!transition.ok) {
        const { error: cleanupErr } = await admin.from('agent_work_reports').delete().eq('id', reportId)
        if (cleanupErr) console.error('[agent-api] 보고 행 cleanup 실패(고아 행 남음):', cleanupErr.message)
        if (transition.conflict) return apiFail(409, 'conflict', '완료 요청 가능한 상태가 아닙니다.')
        console.error('[agent-api] completion 전이 실패:', transition.error)
        return apiInternalError()
      }
      if (transition.actualChanged) {
        revalidatePath(`/p/${order.project_id}`, 'layout')
        after(() => recordProgressSnapshot(order.project_id, admin as never))
      }
      // (기존 관리자 조회·work.reported 알림 블록 그대로)
      if (transition.reachedFirst && order.wbs_item_id) await notifyOnReached(admin, order.wbs_item_id, loaded.userId)
    } else {
      // (기존 progress touch 그대로)
    }
```

- [ ] **Step 5: release 라우트**

PAT·legacy 두 갈래의 소유 판정(56~62·80~85행)은 그대로 두고, 두 UPDATE 블록을 하나의 RPC 호출로 합친다:

```ts
    const transition = await applyWorkflowEvent(admin, {
      event: 'release', actorUserId: loaded.userId, orderId: id,
      agent: actor.principal.kind === 'pat' ? null : actor.agentLabel,
      agentUserId: actor.principal.kind === 'pat' ? (actor.userId as string) : null,
    })
    if (!transition.ok) {
      if (transition.conflict) return apiFail(409, 'conflict', '반납 가능한 상태가 아닙니다.')
      console.error('[agent-api] release 전이 실패:', transition.error)
      return apiInternalError()
    }
    if (transition.actualChanged) {
      revalidatePath(`/p/${order.project_id}`, 'layout')
      after(() => recordProgressSnapshot(order.project_id, admin as never))
    }
    await emitReleaseNotification(admin, order, loaded.userId)
    return NextResponse.json({ ok: true, status: 'ready' })
```

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/agent/stage-lifecycle.test.ts tests/agent/report-route.test.ts tests/agent/work-routes-pat.test.ts`
Expected: PASS(기존 두 파일은 `applyAgentProgress` 목·progress 실적 반영 기대를 지우고 `rpc` 목을 추가해 맞춘다).

- [ ] **Step 7: 커밋**

```bash
git add "src/app/api/v1/agent/work/[id]/claim/route.ts" "src/app/api/v1/agent/work/[id]/report/route.ts" "src/app/api/v1/agent/work/[id]/release/route.ts" tests/agent/stage-lifecycle.test.ts tests/agent/report-route.test.ts tests/agent/work-routes-pat.test.ts
git commit -m "feat(agent-api): claim·완료 보고·반납을 원자 전이 RPC 로 — progress 보고는 실적을 건드리지 않는다"
```

---

### Task 4c: 검토 액션(승인·반려·승인 취소·재작업)·허브 회수

**Files:**
- Modify: `src/app/actions/agentWork.ts:173-476`, `src/app/actions/agentHub.ts:151-197`
- Test: `tests/actions/agent-work-actions.test.ts`, `tests/actions/agent-hub-actions.test.ts`

- [ ] **Step 1: 테스트 갱신**

`tests/actions/agent-work-actions.test.ts` 의 admin 목에 `rpc` 큐(4b 와 같은 형태)를 넣고:
- 승인: `rpc` 가 `p_event:'approve', p_order_id:O1` 로 1회, 성공 응답이면 `agent_work_reports` review_action `'approve'` 갱신·`work.approved` 알림·`{ ok: true }`. `wbs_items` update 를 직접 하지 않는다(`captured.wbs_items` 없음). RPC `conflict` 면 `{ ok:false, error: '상태가 바뀌어 승인하지 못했습니다. 다시 시도하세요.' }`. `skipped:'parent'` 면 `warning` 에 `'하위 항목이 있어'` 포함.
- 반려: `p_event:'reject'`, review_action `'reject'` + note.
- 승인 취소: `p_event:'unapprove'`, review 필드 null 초기화, change_logs 조회 없음(`calls` 에 `change_logs` 없음).
- 재작업: `p_event:'rework'`, review_action `'reject'` + note.

`tests/actions/agent-hub-actions.test.ts`: 회수 op 가 `p_event:'release'` RPC 를 부르고 직접 UPDATE 를 하지 않는다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/actions/agent-work-actions.test.ts tests/actions/agent-hub-actions.test.ts`
Expected: FAIL.

- [ ] **Step 3: agentWork.ts**

import: `transitionStage` 제거 → `import { applyWorkflowEvent, notifyOnReached, SKIPPED_WARN } from '@/lib/agent/workflowEvent'`. `STAGE_SKIP_WARN`·`applyApprovedActualPct` 삭제. `approveAgentCompletion` 을:

```ts
export async function approveAgentCompletion(orderId: string): Promise<ActionResult> {
  const loaded = await loadOrderForAdmin(orderId)
  if (!loaded.ok) return loaded
  const { order, actor } = loaded
  if (order.status !== 'reported') return { ok: false, error: `승인 가능한 상태가 아닙니다(${order.status}).` }
  if (!order.wbs_item_id) return { ok: false, error: 'WBS 항목이 삭제된 주문입니다. 취소로 정리하세요.' }

  const admin = createAdminClient()
  // 원자 전이(스펙 §4) — reported→approved CAS + 단계 xx + 실적 100 + change_logs 가 한 트랜잭션.
  // 종전엔 실적 100 을 먼저 쓰고 CAS 에서 밀리면 "실적만 100" 인 반쪽 상태가 남았다.
  const transition = await applyWorkflowEvent(admin, { event: 'approve', actorUserId: actor.userId, orderId })
  if (!transition.ok) {
    return { ok: false, error: transition.conflict ? '상태가 바뀌어 승인하지 못했습니다. 다시 시도하세요.' : transition.error }
  }
  const now = new Date().toISOString()
  // (기존 latest completion 보고 review_action:'approve' 갱신 블록 그대로)
  await notifyReviewResult(admin, order, 'work.approved', actor.userId)
  if (transition.actualChanged) after(() => recordProgressSnapshot(order.project_id))
  if (transition.reachedFirst) await notifyOnReached(admin, order.wbs_item_id, actor.userId)
  revalidatePath(`/p/${order.project_id}`, 'layout')
  const warning = transition.skipped ? SKIPPED_WARN[transition.skipped] : null
  return warning ? { ok: true, warning } : { ok: true }
}
```

`rejectAgentCompletion`: 333~339행 CAS 를 `applyWorkflowEvent(admin, { event: 'reject', actorUserId: actor.userId, orderId })` 로, 실패 시 `{ ok:false, error: transition.conflict ? '상태가 바뀌어 반려하지 못했습니다.' : transition.error }`. 성공 뒤 `actualChanged` 면 스냅샷, `revalidatePath(\`/p/${order.project_id}\`, 'layout')`, skipped 는 warning.

`unapproveOrder`: 382~388행 CAS 를 `applyWorkflowEvent(admin, { event: opts.to === 'reported' ? 'unapprove' : 'rework', actorUserId: actor.userId, orderId })` 로. 409~460행(실적 복원·stage 되감기) 전부 삭제. 성공 뒤 스냅샷·skipped warning·revalidate 만. 머리 주석을 "되감기는 RPC 가 단계 im·실적 표.im(승인 취소) / 단계 ip·실적 표.rw(재작업) 로 쓴다" 로 고친다.

- [ ] **Step 4: agentHub.ts 회수**

`releaseOrderByAdmin` 의 조회·상태 검사는 두고 UPDATE 블록을:

```ts
  const transition = await applyWorkflowEvent(admin, { event: 'release', actorUserId, orderId })
  if (!transition.ok) return { ok: false, error: transition.conflict ? '상태가 바뀌어 회수하지 못했습니다. 다시 시도하세요.' : transition.error }
  if (transition.actualChanged) after(() => recordProgressSnapshot(order.project_id))
```

(`after`·`recordProgressSnapshot` import 추가. `WbsStageCode`·`STAGE_CODES` 의 `'fp'` 제거 — `STAGE_CODES` 는 `import { STAGE_CODES as DOMAIN_STAGE_CODES } from '@/lib/domain/stageLabels'` 로 대체.)

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/actions/agent-work-actions.test.ts tests/actions/agent-hub-actions.test.ts tests/components/wbs-agent-order-actions.test.tsx tests/components/agent-hub-view.test.tsx`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/app/actions/agentWork.ts src/app/actions/agentHub.ts tests/actions/agent-work-actions.test.ts tests/actions/agent-hub-actions.test.ts
git commit -m "feat(agent): 승인·반려·승인 취소·재작업·회수를 원자 전이 RPC 로 — 실적 복원 코드 폐기"
```

---

### Task 4d: 배정·위임·단계 지정 액션

**Files:**
- Modify: `src/app/actions/wbsAssign.ts`, `src/lib/agent/delegation.ts:105-130`
- Test: `tests/actions/wbs-assign.test.ts`, `tests/agent/delegation*.test.ts`(있으면)

**Interfaces (Produces):** `setWbsStage(itemId, stage: 'as'|'ip'|'im'|'xx'|null)`, `getWbsAssigneeStage(itemId): Promise<{ assigneeMemberId; stage; devWorkflow; activeOrder: boolean } | null>`

- [ ] **Step 1: 테스트 갱신**

`tests/actions/wbs-assign.test.ts`: `transitionStage` 목·`stageTransition` 모듈 목 제거, admin 목에 `rpc` 큐 추가. 케이스:
- 배정: `p_event:'assign', p_item_id: W1` 1회. 해제: `p_event:'unassign'`.
- cascade: 갱신된 id 마다 `assign` 1회.
- `setWbsStage(W1,'im')`: `p_event:'set_stage', p_stage:'im'` 1회, `wbs_items` update·`change_logs` insert·주문 조회를 직접 하지 않는다. RPC `reason:'active_order'` 면 `{ ok:false, error: REASON_TEXT.active_order }`. `reached_first:true` 면 후행 알림 조회(`wbs_items` `.contains('depends', …)`)가 돈다.
- `getWbsAssigneeStage`: `agent_work_orders` 큐에 행이 있으면 `activeOrder: true`.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/actions/wbs-assign.test.ts`
Expected: FAIL.

- [ ] **Step 3: wbsAssign.ts**

import 를 `import { applyWorkflowEvent, notifyOnReached } from '@/lib/agent/workflowEvent'` 로(`REACHED_STAGES, notifySuccessorsOnReached, transitionStage` 제거). `STAGES` 를 `import { isStageCode } from '@/lib/domain/stageLabels'` 로 대체. `after`·`recordProgressSnapshot` import.

- `setWbsAssignee` 93~102행:
```ts
  // 배정↔as 전이(스펙 §3.4) — RPC 가 dev_workflow·리프·현재 stage 를 판정한다(assign 은 stage null 일 때만, unassign 은 as 일 때만). 실패는 로깅만.
  const tr = await applyWorkflowEvent(admin, { event: memberId !== null ? 'assign' : 'unassign', actorUserId: g.actor.userId, itemId })
  if (!tr.ok) console.error('[wbsAssign] 배정↔stage 전이 실패:', tr.error)
  else if (tr.actualChanged) after(() => recordProgressSnapshot(item.project_id))
```
- `setWbsAssigneeCascade` 286~293행: 루프 안을 `const tr = await applyWorkflowEvent(admin, { event: 'assign', actorUserId: g.actor.userId, itemId: id }); if (!tr.ok) console.error(...)`. 루프 뒤 하나라도 `actualChanged` 면 스냅샷 1회.
- `setWbsDevWorkflow` 526~533행: `if (info?.assignee_member_id)` 조건에서 RPC `assign` (stage null 판정은 RPC 몫).
- `setWbsStage` 322~381행:
```ts
export async function setWbsStage(itemId: string, stage: 'as' | 'ip' | 'im' | 'xx' | null): Promise<{ ok: boolean; error?: string }> {
  if (stage !== null && !isStageCode(stage)) return { ok: false, error: '허용되지 않는 단계입니다.' }
  const resolved = await resolveItemProjectId(itemId)
  if (!resolved.ok) return resolved
  const g = await requireSubtreeManagerOrAdmin(itemId, resolved.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  // 리프 게이트·활성 주문 잠금·크레딧 지정·change_logs 는 RPC 가 한 트랜잭션으로(스펙 §3.5·§4).
  const tr = await applyWorkflowEvent(admin, { event: 'set_stage', actorUserId: g.actor.userId, itemId, stage })
  if (!tr.ok) return { ok: false, error: tr.error }
  revalidatePath(`/p/${resolved.projectId}`, 'layout')
  if (tr.actualChanged) after(() => recordProgressSnapshot(resolved.projectId))
  if (tr.reachedFirst) await notifyOnReached(admin, itemId, g.actor.userId)
  return { ok: true }
}
```
- `getWbsAssigneeStage`: select 뒤에
```ts
  const { data: active, error: activeErr } = await sb
    .from('agent_work_orders').select('id').eq('wbs_item_id', itemId).in('status', ['ready', 'claimed', 'reported']).limit(1).maybeSingle()
  if (activeErr) { console.error('[getWbsAssigneeStage] 주문 조회 실패:', activeErr.message); return null }
```
반환에 `activeOrder: active !== null`. 파일 머리 주석의 `transitionStage` 언급을 RPC 로 고친다.

`src/lib/domain/agentWork.ts`: 호출부가 0 이 됐으므로 `stageAtLeast` 를 지운다.

`src/lib/agent/delegation.ts:121-128`: `if (dw.assignee_member_id) { const tr = await applyWorkflowEvent(admin, { event: 'assign', actorUserId, itemId }); if (!tr.ok) console.error('[delegation] dev_workflow ON stage 전이 실패:', tr.error) }` (import 교체).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/actions/wbs-assign.test.ts tests/agent tests/actions` · `npx tsc --noEmit` · `grep -rn "transitionStage\|applyAgentProgress\|stageAtLeast\|'fp'" src/` (결과 0 이어야 한다 — 0089 이전 마이그레이션 SQL 제외)
Expected: PASS, tsc 오류 0.

- [ ] **Step 5: 커밋**

```bash
git add src/app/actions/wbsAssign.ts src/lib/agent/delegation.ts src/lib/domain/agentWork.ts tests/actions/wbs-assign.test.ts
git commit -m "feat(wbs): 배정·위임·단계 지정을 원자 전이 RPC 로 — 활성 주문이 있으면 단계 지정 거부"
```

---

### Task 5: 수기 실적 상한·드롭다운 규칙·라벨 통일

**Files:**
- Modify: `src/app/actions/wbs.ts:73-135`, `src/components/wbs/WbsAssigneeStagePanel.tsx`, `src/components/agent-hub/DelegationTable.tsx:234,268-278`, `src/components/agent-hub/labels.ts:21-39`, `src/lib/i18n/dict/wbs.ts:226-237`, `wbs.en.ts:213-222`, `src/components/wbs/shared.tsx:144-150`, `src/lib/agent/wbsImport.ts:91`(+`toRpcNode` stage 정규화)
- Test: `tests/actions/wbs-update-actual.test.ts`(있으면 수정, 없으면 생성), `tests/components/wbs-assignee-stage-panel.test.tsx`, `tests/components/agent-hub-table.test.tsx`

- [ ] **Step 1: updateActual 테스트**

기존 `updateActual` 테스트 파일(`grep -rl "updateActual" tests/actions`)에 케이스 추가. 없으면 `tests/actions/wbs-update-actual.test.ts` 를 만들되 목 골격은 `tests/actions/wbs-assign.test.ts` 의 `createServerClient` 큐 목을 따른다.

```ts
  it('dev_workflow 항목에 활성 주문이 있으면 100 은 거부 — 완료는 승인으로', async () => {
    server({
      wbs_items: [{ data: { id: W1, actual_pct: 40, project_id: P1, dev_workflow: true } }, { data: null }],
      agent_work_orders: [{ data: { id: O1 } }],
    })
    const r = await updateActual(W1, 100, 40)
    expect(r).toEqual({ ok: false, error: '완료는 승인 버튼으로 처리합니다 — 에이전트에 위임된 작업은 99% 까지 입력할 수 있습니다.' })
  })
  it('활성 주문이 있어도 99 는 저장된다', async () => { /* 같은 큐, newPct 99 → ok:true, wbs_items update payload actual_pct 99 */ })
  it('dev_workflow=false 는 100 도 그대로 — 주문 조회를 하지 않는다', async () => { /* agent_work_orders 큐 미호출 */ })
```

- [ ] **Step 2: updateActual 구현**

select 를 `'id, actual_pct, project_id, dev_workflow'` 로. 자식 검사 뒤에:

```ts
  // D7 — 위임된 작업의 100 은 승인 버튼으로만. 에이전트 API 가 progress 를 99 로 막는 규칙과 같다(2026-08-25 드롭다운 우회 사고 재발 방지).
  if (newPct > 99 && (item as { dev_workflow?: boolean | null }).dev_workflow === true) {
    const { data: active, error: activeErr } = await sb
      .from('agent_work_orders').select('id').eq('wbs_item_id', itemId).in('status', ['ready', 'claimed', 'reported']).limit(1).maybeSingle()
    if (activeErr) return { ok: false, error: `에이전트 주문 확인 실패: ${activeErr.message}` }
    if (active) return { ok: false, error: '완료는 승인 버튼으로 처리합니다 — 에이전트에 위임된 작업은 99% 까지 입력할 수 있습니다.' }
  }
```

- [ ] **Step 3: 라벨·드롭다운**

- i18n ko: `'wbs.stageIp': '작업 중'`, `'wbs.stageIm': '검수 대기'`, `wbs.stageFp` 삭제, 추가 `'wbs.colStage': '단계'`, `'wbs.stageLockedByOrder': '에이전트에 위임된 작업입니다. 단계는 승인·반려로 바뀝니다. 직접 바꾸려면 위임을 끄세요.'`, `'wbs.stageNotWorkflow': '개발 워크플로 대상이 아닙니다.'`. en: `'In progress'`, `'Awaiting review'`, `Force proceed` 삭제, `'wbs.colStage': 'Stage'`, `'wbs.stageLockedByOrder': 'Delegated to an agent. The stage changes through approve/reject. Turn delegation off to set it manually.'`, `'wbs.stageNotWorkflow': 'Not a dev-workflow item.'`.
- `WbsAssigneeStagePanel.tsx`: `type Stage = 'as'|'ip'|'im'|'xx'`, `STAGE_KEYS`·`STAGES` 에서 fp 제거, `AssigneeStage` 에 `activeOrder: boolean`(기본 false). 단계 블록: `view.devWorkflow` 가 false 면 `<p className="text-[13px] text-ink-subtle">{t('wbs.stageNotWorkflow')}</p>`, true 면 select 에 `disabled={view.activeOrder}` 와 아래 `{view.activeOrder && <p className="mt-1 text-[11px] text-ink-subtle">{t('wbs.stageLockedByOrder')}</p>}`.
- `labels.ts`: `export { STAGE_CODES } from '@/lib/domain/stageLabels'`, `export const STAGE_NONE_LABEL = STAGE_NONE_LABEL_KO`, OP_TITLE 을 `approve: '완료 보고를 승인합니다 — 단계 완료(xx)·실적 100'`, `unapprove: '승인을 무릅니다 — 승인 대기로 돌아가고 단계 검수 대기(im)·실적은 표의 IM 값'`, `rework: '완료(xx)를 취소하고 에이전트에게 되돌립니다 — 단계 작업 중(ip)·실적은 표의 RW 값(사유 필수)'`, `reject: '완료 보고를 되돌립니다 — 단계 작업 중(ip)·실적은 표의 RW 값, 에이전트가 사유를 읽고 재작업(사유 필수)'`, `release: '점유를 풀어 대기(미착수)로 되돌립니다 — 단계 할당됨(as)·실적은 표의 AS 값. 러너는 다음 신호에서 409 를 받고 멈춥니다'`.
- `DelegationTable.tsx`: `import { STAGE_LABEL } from '@/lib/domain/waitReason'` → `import { stageLabelKo } from '@/lib/domain/stageLabels'`; `canStage` 에 `&& r.devWorkflow`; `const stageLocked = r.order !== null && r.order.state !== 'DONE'`; select 에 `disabled={isBusy || stageLocked}` + title 을 `stageLocked ? '에이전트에 위임된 작업입니다. 단계는 승인·반려로 바뀝니다. 직접 바꾸려면 위임을 끄세요.' : '단계 직접 조정 — 실적은 그 단계의 크레딧으로 지정됩니다'`; 옵션 문구 `stageLabelKo(c)`; 읽기 전용 텍스트 `stageLabelKo(r.stage)`(null 은 미착수). 선행 미완료 title 문구를 `선행이 검수 대기(im) 이상이거나 그 주문이 승인됐거나 실적이 100% 여야` 로.
- `shared.tsx` `STAGE_META` 에서 fp 행 삭제.
- `wbsImport.ts`: `STAGES` 는 그대로 두되 `toRpcNode` 의 stage 산출에서 `n.stage === 'fp' ? 'ip' : n.stage`(과도기 정규화, 계약 v2.3 #1).

- [ ] **Step 4: 테스트 갱신·통과**

`tests/components/wbs-assignee-stage-panel.test.tsx`: `getWbsAssigneeStage` 목 반환에 `activeOrder` 추가, fp 옵션 기대 삭제, "activeOrder 면 select disabled + 안내문", "devWorkflow=false 면 select 없음" 케이스 추가. `tests/components/agent-hub-table.test.tsx`: 라벨 기대를 새 문구로, "주문이 DONE 이 아닌 행은 단계 select disabled" 추가. `tests/agent/wbs-import*.test.ts`: fp 입력이 ip 로 정규화되는 기대.

Run: `npx vitest run tests/actions tests/components tests/agent tests/domain tests/ui` · `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/app/actions/wbs.ts src/components/wbs/WbsAssigneeStagePanel.tsx src/components/agent-hub/DelegationTable.tsx src/components/agent-hub/labels.ts src/lib/i18n/dict/wbs.ts src/lib/i18n/dict/wbs.en.ts src/components/wbs/shared.tsx src/lib/agent/wbsImport.ts tests/components/wbs-assignee-stage-panel.test.tsx tests/components/agent-hub-table.test.tsx
git commit -m "feat(wbs): 위임 작업 수기 실적 99 상한·활성 주문이면 단계 드롭다운 잠금·단계 라벨 한 벌"
```

(테스트 파일이 더 바뀌면 파일명을 추가한다.)

---

### Task 6: WBS 「단계」 컬럼(D9)

**Files:**
- Modify: `src/lib/data/wbs.ts:81-95`, `src/components/wbs/WbsGanttSheet.tsx:37-49,66,78,127-129,401,1373,1634-1639,1666`
- Test: `tests/ui/wbs-stage-column.test.tsx`(생성), `tests/ui/wbs-stage-chip.test.tsx`(삭제), `tests/ui/wbs-column-visibility.test.tsx`

- [ ] **Step 1: 실패 테스트**

```tsx
// tests/ui/wbs-stage-column.test.tsx
// @vitest-environment jsdom
// 「단계」 컬럼(스펙 D9, 2026-09-15): 에이전트 위임(agent 태그) 항목이 하나라도 있는 프로젝트에만 뜬다 —
// 담당자 컬럼(hasAssignee)과 같은 규칙. 작업명 칸 우단 칩은 컬럼으로 옮겼다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn(), queueUiPref: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'

function item(over: Partial<ComputedItem>): ComputedItem {
  return { id: 'x', parentId: null, code: '1', sortOrder: 0, name: '항목', biz: null, deliverable: null,
    plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0, owners: [], isOwnerSplit: false,
    plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0, ...over }
}

describe('WBS 「단계」 컬럼', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })
  async function render(items: ComputedItem[]) {
    await act(async () => root.render(
      <WbsGanttSheet items={items} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} />,
    ))
  }
  const header = () => container.querySelector<HTMLElement>('[data-wbs-col="stage"][data-wbs-col-kind="header"]')
  const cell = (id: string) => container.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-wbs-col="stage"]`)

  it('위임 항목이 하나도 없으면 컬럼도, 작업명 칸 칩도 없다', async () => {
    await render([item({ id: 'a1', stage: 'im' })])
    expect(header()).toBeNull()
    expect(container.querySelector('[data-wbs-stage]')).toBeNull()
  })
  it('위임 항목이 하나라도 있으면 컬럼이 뜨고 라벨 칩·미지정 - 를 그린다', async () => {
    await render([item({ id: 'a1', stage: 'im', agentDelegated: true }), item({ id: 'a2' }), item({ id: 'a3', stage: 'zz' })])
    expect(header()!.textContent).toContain('wbs.colStage')
    const chip = cell('a1')!.querySelector<HTMLElement>('[data-wbs-stage]')!
    expect(chip.dataset.wbsStage).toBe('im')
    expect(chip.textContent).toBe('IM')                     // 칩은 코드 대문자(스펙 §3.2), 라벨은 title
    expect(chip.getAttribute('title')).toBe('wbs.stageIm')
    expect(cell('a2')!.textContent).toBe('-')
    expect(cell('a3')!.textContent).toBe('ZZ')   // 모르는 코드도 감추지 않는다
    expect(container.querySelector('[data-wbs-col="name"] [data-wbs-stage]')).toBeNull()
  })
  it('깊은 자손에만 위임이 있어도 컬럼이 뜬다(재귀 판정)', async () => {
    await render([item({ id: 'a1', children: [item({ id: 'b1', children: [item({ id: 'c1', agentDelegated: true })] })] })])
    expect(header()).not.toBeNull()
  })
  it('진척 컬럼 바로 뒤에 온다', async () => {
    await render([item({ id: 'a1', agentDelegated: true })])
    const heads = [...container.querySelectorAll<HTMLElement>('[data-wbs-col-kind="header"]')].map(h => h.dataset.wbsCol)
    expect(heads.indexOf('stage')).toBe(heads.indexOf('status') + 1)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/ui/wbs-stage-column.test.tsx`
Expected: FAIL — 헤더 없음.

- [ ] **Step 3: 구현**

`src/lib/data/wbs.ts` rows 매핑에 `agentDelegated: Array.isArray(r.tags) && (r.tags as string[]).includes(AGENT_TAG),` (`import { AGENT_TAG } from '@/lib/domain/seatmap'`).

`WbsGanttSheet.tsx`:
- `PLAN_COLS`: `{ key: 'status', w: 76 },` 뒤에 `{ key: 'stage', w: 84 },`
- `TIMELINE_COLS = new Set(['no', 'outline', 'name', 'owners', 'status', 'stage'])`, `HIDEABLE_PLAN_COLS` 에 `'stage'` 추가.
- 127행 아래에
```ts
/** 「단계」 컬럼 표시 조건(D9) — 에이전트 위임 항목이 트리 어디든 하나라도 있으면. 담당자 컬럼과 같은 규칙. */
function hasAnyDelegation(items: ComputedItem[]): boolean {
  return items.some(n => n.agentDelegated === true || hasAnyDelegation(n.children))
}
```
- 350행 아래 `const hasDelegation = useMemo(() => hasAnyDelegation(items), [items])`; `visibleCols` 의 base 를
```ts
    const base = cols.filter(col => (col.key !== 'assignee' || hasAssignee) && (col.key !== 'stage' || hasDelegation))
```
(deps 에 `hasDelegation` 추가.)
- 헤더 1373행 뒤: `{showCol('stage') && headCell(colOf('stage'), t('wbs.colStage'), 'justify-center')}`
- 1634~1639행 작업명 칸 칩 블록 삭제(`StageChip` import 는 유지).
- 상태 셀 블록 뒤에:
```tsx
                {/* 단계 — 위임 1건 이상인 프로젝트에만(D9). null 은 -, 모르는 코드는 코드 그대로(표시 = 로깅). */}
                {showCol('stage') && (
                  <div
                    data-wbs-col="stage"
                    className={`${cellBase} overflow-hidden border-r border-grid justify-center ${cellBg}`}
                    style={{ width: W('stage'), paddingInline: 4 }}
                  >
                    {n.stage ? <StageChip stage={n.stage} t={t} /> : <span className="text-ink-subtle">-</span>}
                  </div>
                )}
```

`StageChip`(`shared.tsx`)은 그대로 쓴다 — 코드 대문자·라벨 title(스펙 §3.2).

`tests/ui/wbs-stage-chip.test.tsx` 삭제. `tests/ui/wbs-column-visibility.test.tsx` 의 `HIDEABLE_COLS` 는 위임 픽스처가 없어 stage 열이 애초에 없으므로 그대로 둔다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/ui`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/wbs.ts src/components/wbs/WbsGanttSheet.tsx tests/ui/wbs-stage-column.test.tsx
git rm tests/ui/wbs-stage-chip.test.tsx
git commit -m "feat(wbs): 에이전트 위임이 1건이라도 있으면 「단계」 컬럼 — 작업명 칸 칩을 컬럼으로 이동"
```

---

### Task 7: 설정 크레딧 슬라이더

**Files:**
- Create: `src/components/settings/StageCreditSlider.tsx`
- Modify: `src/lib/data/projectConfig.ts`, `src/app/actions/project.ts`(`updateStageCredits` 추가), `src/app/(app)/p/[projectId]/settings/page.tsx:235-247`, `src/lib/i18n/dict/settings.ts`, `settings.en.ts`
- Test: `tests/actions/project-stage-credits.test.ts`, `tests/components/stage-credit-slider.test.tsx`(생성), `tests/data/project-config.test.ts`

**Interfaces (Produces):** `ProjectConfig.stageCredits: StageCredits | null`, `updateStageCredits(projectId: string, credits: unknown): Promise<{ ok: boolean; error?: string }>`, `<StageCreditSlider projectId initial editable />`

- [ ] **Step 1: 액션 테스트**

```ts
// tests/actions/project-stage-credits.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ requireProjectAdmin: vi.fn(), createAdminClient: vi.fn(), createServerClient: vi.fn(), requireSuperuser: vi.fn(), getActorViewState: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: mocks.requireProjectAdmin, requireSuperuser: mocks.requireSuperuser, getActorViewState: mocks.getActorViewState }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { updateStageCredits } from '@/app/actions/project'
import { DEFAULT_STAGE_CREDITS } from '@/lib/domain/stageCredits'

const P1 = '11111111-1111-4111-8111-111111111111'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
})

describe('updateStageCredits', () => {
  it('관리자가 아니면 거부', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await updateStageCredits(P1, DEFAULT_STAGE_CREDITS)).toEqual({ ok: false, error: '권한 없음' })
  })
  it('검증 실패는 저장하지 않는다', async () => {
    const upsert = vi.fn()
    mocks.createAdminClient.mockReturnValue({ from: () => ({ upsert }) })
    const r = await updateStageCredits(P1, { default: { as: 0, ip: 30, rw: 35, im: 80, xx: 100 } })
    expect(r.ok).toBe(false)
    expect(upsert).not.toHaveBeenCalled()
  })
  it('유효하면 project_settings.stage_credits 를 upsert 한다(소급 없음 — 행만 쓴다)', async () => {
    const upsert = vi.fn(async () => ({ error: null }))
    mocks.createAdminClient.mockReturnValue({ from: (t: string) => { expect(t).toBe('project_settings'); return { upsert } } })
    expect(await updateStageCredits(P1, DEFAULT_STAGE_CREDITS)).toEqual({ ok: true })
    expect(upsert.mock.calls[0][0]).toMatchObject({ project_id: P1, stage_credits: DEFAULT_STAGE_CREDITS, updated_by: 'admin-1' })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/actions/project-stage-credits.test.ts`
Expected: FAIL — export 없음.

- [ ] **Step 3: 액션·로더 구현**

`src/app/actions/project.ts` 의 `updateLevelSettings` 아래:

```ts
/**
 * 단계 전이 실적 크레딧 표(스펙 2026-09-15 §3.3·§5.1) — 관리자 전용. 검증은 순수 함수(validateStageCredits)가
 * 정본이고 여기는 가드·저장만. 저장은 소급하지 않는다 — 이미 기록된 actual_pct 는 그대로, 다음 전이부터 적용.
 */
export async function updateStageCredits(projectId: string, credits: unknown): Promise<{ ok: boolean; error?: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const v = validateStageCredits(credits)
  if (!v.ok) return { ok: false, error: v.error }
  const admin = createAdminClient()
  const { error } = await admin.from('project_settings').upsert({
    project_id: projectId,
    stage_credits: v.credits,
    updated_at: new Date().toISOString(),
    updated_by: g.actor.userId,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}
```

`projectConfig.ts`: `ProjectConfig` 에 `stageCredits: StageCredits | null`(null = 코드 기본값), `DEFAULT_PROJECT_CONFIG.stageCredits = null`, select 에 `stage_credits` 추가, 매핑 `stageCredits: row.stage_credits ?? null`(타입은 검증 없이 `StageCredits | null` 로 캐스트 — 저장 경로가 검증했다).

- [ ] **Step 4: 슬라이더 컴포넌트**

```tsx
// src/components/settings/StageCreditSlider.tsx
'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import { updateStageCredits } from '@/app/actions/project'
import {
  CREDIT_KEYS, CREDIT_STEP, CREDIT_TABLE_KEYS, DEFAULT_STAGE_CREDITS, clampCredit, validateStageCredits,
  type CreditKey, type CreditTable, type CreditTableKey, type StageCredits,
} from '@/lib/domain/stageCredits'

/**
 * 워크플로 크레딧 슬라이더(스펙 §5.1, 목업 2f1a7669). 트랙 하나에 AS·IP·RW·IM 핸들과 100 에 잠긴 XX.
 * 순서·간격 제약은 clampCredit(도메인)이 정본이고 서버(validateStageCredits)가 다시 검사한다.
 * 저장은 소급하지 않는다 — 안내문으로 못 박는다.
 */
const HANDLE_COLOR: Record<CreditKey, string> = {
  as: 'bg-pending', ip: 'bg-progress', rw: 'bg-delayed', im: 'bg-brand', xx: 'bg-done',
}

export function StageCreditSlider({ projectId, initial, editable }: {
  projectId: string; initial: StageCredits | null; editable: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()
  const [pending, start] = useTransition()
  const [credits, setCredits] = useState<StageCredits>(() => structuredClone(initial ?? DEFAULT_STAGE_CREDITS))
  const [dirty, setDirty] = useState(false)
  const tables = useMemo(() => CREDIT_TABLE_KEYS.filter(k => credits[k] !== undefined), [credits])

  const setValue = (tableKey: CreditTableKey, key: CreditKey, raw: number) => {
    setCredits(prev => {
      const table = prev[tableKey]
      if (!table) return prev
      const next = { ...table, [key]: clampCredit(raw, key, table) }
      return { ...prev, [tableKey]: next }
    })
    setDirty(true)
  }
  const addTable = (k: CreditTableKey) => { setCredits(prev => ({ ...prev, [k]: { ...DEFAULT_STAGE_CREDITS[k]! } })); setDirty(true) }
  const removeTable = (k: CreditTableKey) => {
    if (k === 'default') return
    setCredits(prev => { const next = { ...prev }; delete next[k]; return next })
    setDirty(true)
  }
  const save = () => start(async () => {
    const v = validateStageCredits(credits)
    if (!v.ok) { toast({ title: v.error, variant: 'error' }); return }
    const r = await updateStageCredits(projectId, v.credits)
    if (!r.ok) { toast({ title: r.error ?? t('settings.actionFailed'), variant: 'error' }); return }
    setDirty(false)
    toast({ title: t('settings.creditsSaved'), variant: 'success' })
    router.refresh()
  })

  return (
    <div className="mt-3 space-y-3" data-stage-credits>
      {tables.map(k => (
        <CreditRow key={k} tableKey={k} table={credits[k]!} editable={editable}
          onChange={(key, raw) => setValue(k, key, raw)} onRemove={k === 'default' ? undefined : () => removeTable(k)} />
      ))}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
        {editable && CREDIT_TABLE_KEYS.filter(k => credits[k] === undefined).map(k => (
          <button key={k} type="button" data-credit-add={k} onClick={() => addTable(k)} className="btn btn-ghost h-7 px-2 text-xs">
            + {t(`settings.creditTable_${k}` as never)}
          </button>
        ))}
        <span>{t('settings.creditsNoRetro')}</span>
        {editable && (
          <button type="button" data-credit-save disabled={pending || !dirty} onClick={save} className="btn btn-primary ml-auto h-8 px-3 text-xs">
            {pending ? t('wbs.saving') : t('common.save')}
          </button>
        )}
      </div>
    </div>
  )
}

function CreditRow({ tableKey, table, editable, onChange, onRemove }: {
  tableKey: CreditTableKey; table: CreditTable; editable: boolean
  onChange: (key: CreditKey, raw: number) => void; onRemove?: () => void
}) {
  const { t } = useLocale()
  const trackRef = useRef<HTMLDivElement>(null)
  const drag = (key: CreditKey) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editable || key === 'xx') return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture?.(e.pointerId)
    const rect = trackRef.current!.getBoundingClientRect()
    const move = (ev: PointerEvent) => onChange(key, ((ev.clientX - rect.left) / rect.width) * 100)
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up) }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
  }
  const keyDown = (key: CreditKey) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!editable || key === 'xx') return
    const cur = table[key]
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(key, cur - CREDIT_STEP) }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(key, cur + CREDIT_STEP) }
    else if (e.key === 'Home') { e.preventDefault(); onChange(key, 0) }
    else if (e.key === 'End') { e.preventDefault(); onChange(key, 100) }
  }
  return (
    <div data-credit-table={tableKey} className="rounded-xl border border-line bg-surface-2/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-ink">{t(`settings.creditTable_${tableKey}` as never)}</span>
        {onRemove && editable && <button type="button" data-credit-remove onClick={onRemove} className="btn btn-ghost h-6 px-2 text-[11px]">{t('settings.creditTableRemove')}</button>}
      </div>
      <div className="mb-6 flex justify-between text-[10px] text-ink-subtle"><span>0</span><span>50</span><span>100</span></div>
      <div ref={trackRef} className="relative h-2 rounded-full bg-line">
        {CREDIT_KEYS.map(key => (
          <div key={key} role="slider" tabIndex={editable && key !== 'xx' ? 0 : -1}
            aria-label={`${tableKey} ${key.toUpperCase()}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={table[key]}
            aria-disabled={!editable || key === 'xx'} data-credit-handle={key}
            onPointerDown={drag(key)} onKeyDown={keyDown(key)}
            className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface ${HANDLE_COLOR[key]} ${key === 'xx' ? 'opacity-60' : 'cursor-grab'}`}
            style={{ left: `${table[key]}%` }}
          >
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-semibold tabular-nums text-ink">{key.toUpperCase()} {table[key]}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-5 gap-2">
        {CREDIT_KEYS.map(key => (
          <label key={key} className="text-[11px] text-ink-muted">
            <span className="block">{key.toUpperCase()} · {t(`settings.creditKey_${key}` as never)}</span>
            <input type="number" min={0} max={100} step={CREDIT_STEP} value={table[key]} readOnly={!editable || key === 'xx'}
              data-credit-input={key} aria-label={`${tableKey} ${key} 크레딧`}
              onChange={e => onChange(key, Number(e.target.value))} onBlur={e => onChange(key, Number(e.target.value))}
              className="app-input mt-1 h-8 w-full text-xs tabular-nums" />
          </label>
        ))}
      </div>
    </div>
  )
}
```

i18n `settings.ts`(en 도 같은 키): `'settings.creditsTitle': '개발 워크플로 크레딧'`, `'settings.creditsDesc': '단계가 바뀔 때 실적%를 이 값으로 지정합니다. 사람이 실적을 직접 고칠 수 있고, 위임된 작업의 100은 승인으로만 갑니다.'`, `'settings.creditsNoRetro': '저장해도 이미 기록된 실적%는 바뀌지 않습니다.'`, `'settings.creditsSaved': '크레딧을 저장했습니다.'`, `'settings.creditTable_default': '기본'`, `'settings.creditTable_if': 'IF · 인터페이스'`, `'settings.creditTable_doc': 'DOC · 문서'`, `'settings.creditTableRemove': '표 제거'`, `'settings.creditKey_as': '할당됨'`, `'settings.creditKey_ip': '작업 중'`, `'settings.creditKey_rw': '반려·재작업'`, `'settings.creditKey_im': '검수 대기'`, `'settings.creditKey_xx': '완료'`. en: `'Dev workflow credits'`, `'When the stage changes, actual % is set to these values. People can still edit actual %; 100 on a delegated task comes only from approval.'`, `'Saving does not change actual % already recorded.'`, `'Credits saved.'`, `'Default'`, `'IF · Interface'`, `'DOC · Document'`, `'Remove table'`, `'Assigned'`, `'In progress'`, `'Rejected · rework'`, `'Awaiting review'`, `'Done'`.

settings 페이지 「에이전트」 카드 본문(245행 `<p>` 뒤):
```tsx
        {levelConfig && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-ink">{t(locale, 'settings.creditsTitle')}</p>
            <p className="text-xs leading-5 text-ink-muted">{t(locale, 'settings.creditsDesc')}</p>
            <StageCreditSlider projectId={projectId} initial={levelConfig.stageCredits} editable={canMutate} />
          </div>
        )}
```
(`import { StageCreditSlider } from '@/components/settings/StageCreditSlider'`.)

- [ ] **Step 5: 컴포넌트 테스트**

```tsx
// tests/components/stage-credit-slider.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ updateStageCredits: vi.fn(), toast: vi.fn() }))
vi.mock('@/app/actions/project', () => ({ updateStageCredits: mocks.updateStageCredits }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
import { StageCreditSlider } from '@/components/settings/StageCreditSlider'

describe('StageCreditSlider', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); mocks.updateStageCredits.mockResolvedValue({ ok: true }) })
  afterEach(() => { act(() => root.unmount()); container.remove() })
  const input = (k: string) => container.querySelector<HTMLInputElement>(`[data-credit-table="default"] [data-credit-input="${k}"]`)!
  async function mount(editable = true) {
    await act(async () => root.render(<StageCreditSlider projectId="p1" initial={null} editable={editable} />))
  }
  it('기본값으로 그리고 XX 는 읽기 전용', async () => {
    await mount()
    expect(input('rw').value).toBe('50')
    expect(input('xx').readOnly).toBe(true)
  })
  it('직접 입력은 5 단위·이웃 간격으로 클램프된다', async () => {
    await mount()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(input('ip'), '48'); input('ip').dispatchEvent(new Event('input', { bubbles: true })) })
    expect(input('ip').value).toBe('40')   // rw(50) - 10
  })
  it('저장은 검증된 객체로 액션을 부른다', async () => {
    await mount()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(input('rw'), '60'); input('rw').dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-credit-save]')!.click() })
    expect(mocks.updateStageCredits).toHaveBeenCalledWith('p1', { default: { as: 0, ip: 30, rw: 60, im: 80, xx: 100 }, if: { as: 0, ip: 20, rw: 30, im: 50, xx: 100 }, doc: { as: 0, ip: 20, rw: 30, im: 50, xx: 100 } })
  })
  it('읽기 전용이면 저장 버튼이 없다', async () => {
    await mount(false)
    expect(container.querySelector('[data-credit-save]')).toBeNull()
  })
})
```

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/actions/project-stage-credits.test.ts tests/components/stage-credit-slider.test.tsx tests/data/project-config.test.ts` · `npx tsc --noEmit` · `npm run lint`
Expected: PASS. (`project-config.test.ts` 의 3번째 케이스 기대에 `stageCredits: null` 이 자연히 맞는다 — `toEqual` 대상이 `DEFAULT_PROJECT_CONFIG` 인 1번은 그대로.)

- [ ] **Step 7: 커밋**

```bash
git add src/components/settings/StageCreditSlider.tsx src/lib/data/projectConfig.ts src/app/actions/project.ts "src/app/(app)/p/[projectId]/settings/page.tsx" src/lib/i18n/dict/settings.ts src/lib/i18n/dict/settings.en.ts tests/actions/project-stage-credits.test.ts tests/components/stage-credit-slider.test.tsx
git commit -m "feat(settings): 개발 워크플로 크레딧 슬라이더 — 단계 전이 실적을 프로젝트별로 지정"
```

---

### Task 8: 계약 v2.3·스킬 문구·스펙 정합

**Files:**
- Modify: `.claude/skills/dflow-work/references/api-contract.md`, `.claude/skills/dflow-dev/SKILL.md:117-127`, `.claude/skills/dflow-work/references/troubleshooting.md:61`, `docs/superpowers/specs/2026-09-15-wbs-stage-credit-design.md`(§4.2 시그니처 순서)

- [ ] **Step 1: api-contract.md**

제목을 `# D'Flow Agent API 계약 v2.3`, `contract_version: "2.3"`. v2.2 변경점 앞에 절 추가:

```markdown
## v2.3 변경점 (2026-09-15)

| # | 항목 | v2.2 | v2.3 |
|---|---|---|---|
| 1 | stage enum | `as\|fp\|ip\|im\|xx\|null` | `as\|ip\|im\|xx\|null`. 서버는 입력 `fp` 를 `ip` 로 정규화(과도기). 라벨: as=할당됨 · ip=작업 중 · im=검수 대기 · xx=완료 |
| 2 | progress 보고 | `actual_pct` 즉시 반영, `applied_to_wbs:true` | 보고 행만 기록. `actual_pct` 불변, 응답 `applied_to_wbs:false`. 200 그대로 |
| 3 | completion 보고 | 주문 reported + stage im (분리 실행) | RPC 한 트랜잭션. 실적은 프로젝트 크레딧 표의 IM 값 |
| 4 | claim | 주문 claimed + stage ip (분리 실행) | RPC 한 트랜잭션. 실적은 표의 IP 값 |
| 5 | depends_evidence | `{external_ref, stage, branch, head_sha, order_approved}` | `actual_pct`·`reached:boolean` 추가. `reached` = stage∈{im,xx} ∨ order_approved ∨ actual_pct≥100 — 서버 게이트와 같은 판정 |
| 6 | claim 게이트 | stage ≥ im ∨ order_approved | `reached` 와 동일. 403 `dependency_not_met` 의 `unmet[]` 는 `reached:false` 인 선행 |

⚠️ `reached` 도 키 존재 여부로 지원을 가른다(`'reached' in d`). 없으면 v2.2 판정(stage ∨ order_approved)으로 폴백하고 그 사실을 한 줄 남긴다.
```

"상태 어휘 매핑" 절의 fp 표기·라벨 정본 줄과 "stage 자동 전이 표" 를 새 사건 표(스펙 §3.4)로 교체하고 `transitionStage` 언급을 `apply_workflow_event` 로 바꾼다.

- [ ] **Step 2: 스킬 문구**

`dflow-dev/SKILL.md` 117~127행의 선행 검사 문구 앞에: "**`d.reached` 키가 있으면(v2.3) 그 값이 판정이다** — 없으면 아래 v2.2 규칙." `troubleshooting.md:61` 을 `- 선행 항목 미충족(reached:false — 검수 대기 이상도, 승인도, 실적 100 도 아님) — stderr 로 흘러나온 바디의 unmet[] 로 어느 선행인지 확인` 로.

- [ ] **Step 3: 스펙 §4.2 시그니처 정합**

스펙의 시그니처 블록을 Task 3 의 실제 순서(`p_event, p_actor, p_item_id, p_order_id, p_stage, p_agent, p_agent_user_id`)와 `p_item_id 주문 사건 선택` 주석으로 맞추고, §4.2 4번의 set_stage 규칙을 "활성 주문이 있으면 해제(null)도 거부, 주문이 없으면 해제는 워크플로·리프와 무관하게 허용" 으로 고치고, 상태 줄을 `구현 완료(staging)` 로.

- [ ] **Step 4: 커밋**

```bash
git add .claude/skills/dflow-work/references/api-contract.md .claude/skills/dflow-dev/SKILL.md .claude/skills/dflow-work/references/troubleshooting.md docs/superpowers/specs/2026-09-15-wbs-stage-credit-design.md
git commit -m "docs(agent): API 계약 v2.3 — reached 축·progress 무반영·fp 제거, 스킬 선행 판정 문구"
```

---

### Task 9: 전체 검증·스테이징 반영

- [ ] **Step 1: 전체 검증**

Run: `npm run lint && npx tsc --noEmit && npm run test`
Expected: 전부 초록. 실패는 그 자리에서 고치고 해당 Task 파일만 추가 커밋.

- [ ] **Step 2: 잔재 검사**

```bash
grep -rn "transitionStage\|applyAgentProgress\|applyApprovedActualPct\|stageAtLeast\|STAGE_LABEL\b\|stageFp\|'fp'" src/ tests/ .claude/skills/ | grep -v "0089\|0082\|0077"
```
Expected: 출력 없음(마이그레이션 테스트가 옛 파일을 읽는 줄은 제외).

- [ ] **Step 3: staging 머지·푸시**

```bash
git switch staging && git merge --no-ff feat/wbs-stage-credit -m "merge: feat/wbs-stage-credit → staging: 진척·단계·실적 크레딧" && git push origin staging
```

G4 는 0096 커밋의 `Staging-verified:` 트레일러로 통과한다. 푸시 뒤 dflow-staging.vercel.app 에서 확인할 항목을 사용자에게 넘긴다: 헤더 「진척」, 위임 프로젝트의 「단계」 컬럼, 설정 슬라이더 저장, 위임 항목 승인 시 단계·실적이 함께 바뀌는지. 운영 적용(`db:apply --target prod`)·main 머지는 사용자 지시 뒤.

- [ ] **Step 4: 메모리 갱신**

`~/.claude/projects/-Users-jji-project-wbs-web/memory/wbs-stage-credit-spec.md` 를 "staging 반영, 운영 적용 대기" 로 갱신하고 `MEMORY.md` 한 줄을 맞춘다.

---

## 자체 검토

- **스펙 커버리지**: D1~D9 → Task 1(D6)·2(§3.2·3.3·3.7)·3(§7·§4)·4a~4d(§3.4·§4.3)·5(§3.5·3.6·5.3·5.4)·6(D9·§5.2)·7(D5·§5.1)·8(§6). §8 테스트는 각 Task 의 Step 에 분산. §9 범위 밖 항목은 손대지 않는다.
- **플레이스홀더**: 0089 본문 복사 지시는 파일·행 범위·바꿀 줄이 명시돼 있다. "기존 블록 그대로" 는 현재 파일의 해당 행을 가리킨다.
- **타입 정합**: `applyWorkflowEvent`/`WorkflowEventArgs`/`notifyOnReached`/`SKIPPED_WARN`/`REASON_TEXT`(4a) 를 4b·4c·4d 가 같은 이름으로 쓴다. `predecessorReached`(2) 를 4a 의 `depends.ts`·`stageTransition.ts` 가 쓴다. `isStageCode`(2) 를 4d 가, `stageLabelKo`(2) 를 5 가, `clampCredit`·`validateStageCredits`(2) 를 7 이 쓴다. `WbsRow.agentDelegated`(2) 를 6 이 채우고 읽는다. `getWbsAssigneeStage().activeOrder`(4d) 를 5 의 패널이 읽는다.
