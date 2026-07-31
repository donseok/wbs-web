# 임포트 마법사 (Plan B: 설계 §6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 어떤 엑셀 양식이든 자동 감지 + 사람 확인 2단계로 임포트하고(N단 계층·append/replace), 익스포트가 같은 프로파일로 라운드트립되게 한다.

**Architecture:** 정본 스펙 `docs/design/dflow-generic-wbs-design-2026-07-29.md` §6 + §10.3. 양식 지식을 `ExcelProfile`(project_settings.excel_profile, Plan A 가 자리를 마련)로 물화하고, 감지(detect)→확인(사람)→실행(execute) 3단으로 나눈다. **기존 임포트 라우트·폼은 무접촉 병행 유지**(§11 단계 4 — D-CUBE 운영 경로 보존). 새 파서는 프로파일 주입형이며, D-CUBE 레거시 프로파일을 주입하면 기존 파서와 동일 결과를 내는 것이 라운드트립 계약이다.

**Tech Stack:** xlsx(기존) · Next.js Route Handlers · Supabase RPC(신규 replace_wbs) · vitest

**사용자 결정(2026-08-01):** Q1 replace 백업 = **트리만**(change_logs 미포함 — cascade 유실은 비가역임을 확인 화면에 명시) · Q3 코드 = **그대로 + 부재 시 트리 위치 채번** · Q4 마크 사전 = **excel_profile 에 저장**(임포트·익스포트 공용).

## Global Constraints

- **D-CUBE 운영 경로 무접촉**: `src/lib/excel/parse.ts`·`validate.ts`(기존 export 유지분)·`src/app/api/import/route.ts`·`WbsImportForm.tsx` 는 수정 금지(링크 추가 1곳 예외는 Task 8 에 명시). 기존 테스트 전량 초록 유지.
- 마이그레이션(0061)은 단독 커밋 + `_rollback.sql`(G1). 적용은 Management API. 기존 테이블 ALTER 0건 — 신규 RPC(create or replace 신규 함수) + project_settings **행 update**(백필)만.
- 에러 3원칙: 시트 부재·감지 실패는 **명시 에러**(§6.3 — 조용한 D-CUBE 폴백 금지. 단 이 규칙은 새 경로에만 — 기존 parse.ts 는 무접촉). 조회 실패 위장 금지. replace 는 백업 생성 실패 시 실행 중단.
- UI 위험 파일(components/app/*, globals.css, layout 류) 무접촉. 신규 페이지는 `/p/[projectId]/import`.
- i18n: 신규 문구는 dict 신규 파일 + dict.ts 배선(ko/En `Record<keyof …>` 패리티).
- 커밋 한국어 "왜" + 트레일러 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. `git add -A` 금지.
- 마이그레이션 번호는 착수 시점 `ls supabase/migrations | tail` 로 재확인(기준: 0061. 병렬 세션이 선점했으면 +1).

---

### Task 1: `ExcelProfile` 타입 + 검증 + D-CUBE 레거시 프로파일 상수

**Files:**
- Create: `src/lib/excel/profile.ts`
- Test: `tests/excel/profile.test.ts`

**Interfaces (이후 전 태스크가 이 이름을 쓴다):**

```ts
export interface ExcelProfile {
  version: 1
  sheetName: string
  holidaySheetName: string | null
  /** 0-based 헤더 행 인덱스. 데이터는 headerRow+1 부터. */
  headerRow: number
  hierarchy:
    | { kind: 'columns'; columns: number[] }   // 열=계층: 왼쪽=얕음. 한 행에 정확히 하나 채워짐
    | { kind: 'outline'; column: number }      // 아웃라인 코드(1.2.3) 열. 깊이=구분자 수+1
  logical: {
    extraAxis: number | null; code: number | null; deliverable: number | null
    start: number | null; end: number | null; weight: number | null; actualPct: number | null
  }
  teamColumns: [number, string][]
  ownerMarks: Record<string, 'primary' | 'support'>
}
export function validateProfile(p: unknown): { ok: true; profile: ExcelProfile } | { ok: false; error: string }
/** D-CUBE 현행 3행 헤더 규약(5팀) — §7.5 백필값이자 라운드트립 계약 테스트의 기준. */
export const LEGACY_DCUBE_PROFILE: ExcelProfile
```

- [ ] **Step 1: 실패하는 테스트**

```ts
import { describe, expect, it } from 'vitest'
import { LEGACY_DCUBE_PROFILE, validateProfile } from '@/lib/excel/profile'

describe('ExcelProfile', () => {
  it('레거시 D-CUBE 프로파일이 현행 파서 좌표와 일치한다', () => {
    const p = LEGACY_DCUBE_PROFILE
    expect(p.sheetName).toBe('WBS'); expect(p.holidaySheetName).toBe('Holiday')
    expect(p.headerRow).toBe(2)
    expect(p.hierarchy).toEqual({ kind: 'columns', columns: [1, 2, 3] })
    expect(p.logical).toEqual({ extraAxis: 0, code: null, deliverable: 11, start: 12, end: 13, weight: 14, actualPct: 16 })
    expect(p.teamColumns).toEqual([[6, 'PMO'], [7, 'ERP'], [8, 'MES'], [9, '가공'], [10, 'MDM']])
    expect(p.ownerMarks).toEqual({ '●': 'primary', '△': 'support' })
  })
  it('validateProfile — 필수 누락·계층 열 중복·마크 값 오류를 거부한다', () => {
    expect(validateProfile(null).ok).toBe(false)
    expect(validateProfile({ ...LEGACY_DCUBE_PROFILE, hierarchy: { kind: 'columns', columns: [1, 1] } }).ok).toBe(false)
    expect(validateProfile({ ...LEGACY_DCUBE_PROFILE, ownerMarks: { '●': 'boss' } }).ok).toBe(false)
    const ok = validateProfile(JSON.parse(JSON.stringify(LEGACY_DCUBE_PROFILE)))
    expect(ok.ok).toBe(true)
  })
})
```

- [ ] **Step 2: RED 확인** — 모듈 없음
- [ ] **Step 3: 구현** — 수동 타입가드(리포 관례 — zod 없음). 검증 규칙: version===1, sheetName 비공백, headerRow 정수≥0, hierarchy 두 형태 중 하나(columns 는 비어있지 않고 중복 없는 정수 오름차순, outline 은 정수≥0), logical 각 필드 null|정수≥0, teamColumns [정수,비공백문자열][], ownerMarks 값은 'primary'|'support' 만, 마크 키 비공백.
- [ ] **Step 4: GREEN + tsc + eslint**
- [ ] **Step 5: 커밋** — "feat(excel): ExcelProfile 계약 — 양식 지식의 물화(§6). 레거시 D-CUBE 좌표는 라운드트립 계약의 기준"

---

### Task 2: 마이그레이션 0061 — `replace_wbs` RPC + D-CUBE excel_profile 백필

**Files:**
- Create: `supabase/migrations/0061_replace_wbs_and_profile.sql`
- Create: `supabase/migrations/0061_replace_wbs_and_profile_rollback.sql`
- Test: `tests/migrations/replace-wbs.test.ts`

**Interfaces:**
- Produces: RPC `replace_wbs(p_project_id uuid, p_items jsonb, p_holidays jsonb) returns int` — **단일 트랜잭션에서 해당 프로젝트 wbs_items 전량 delete 후 import_wbs 와 동일 로직으로 insert**(§6.6-3). 반환 = 삽입 건수. security definer + 기존 import_wbs 와 같은 권한 게이트 방식(0006/0060 실물을 열어 gate 방식을 그대로 복제 — 함수 서두의 관리자 검사 유무 포함).
- project_settings 백필: `update project_settings set excel_profile = '<Task 1 의 LEGACY_DCUBE_PROFILE JSON>'::jsonb where preset_applied = 'legacy-dcube' and excel_profile = '{}'::jsonb;` (조건부 — 이미 커스텀이면 무접촉. Plan A parked 항목 해소).

- [ ] **Step 1: SQL 작성** — 0060 관례(begin/commit·search_path 핀·`create or replace`). **본문은 0060_import_wbs_owner_split.sql 의 함수 정의를 기반으로**: 서두에 `delete from public.wbs_items where project_id = p_project_id;` 를 추가한 신규 함수 replace_wbs 로 작성(중복 구현이지만 함수 분리가 계약 — import_wbs 는 무접촉). change_logs 는 FK cascade 로 함께 지워짐을 함수 주석에 명시(Q1 결정 — 백업은 앱 계층 몫).
- [ ] **Step 2: 롤백 SQL** — `drop function if exists public.replace_wbs(uuid, jsonb, jsonb);` + 백필 원복은 하지 않음(주석: 프로파일은 데이터가 아니라 설정이며 '{}' 로 되돌리면 오히려 사용자 설정 파괴 가능 — 놔둔다).
- [ ] **Step 3: 계약 테스트** — 0060 테스트 패턴: delete 문 존재·import_wbs 무접촉(`create or replace function public.import_wbs` 부재)·is_owner_split 포함·백필 update 의 이중 조건(`preset_applied`+`excel_profile = '{}'`)·롤백에 백필 원복 부재.
- [ ] **Step 4: 커밋 2개** (마이그레이션 단독 / 테스트) — `npx vitest run tests/migrations` 전량.

---

### Task 3: 감지 모듈 `detect.ts`

**Files:**
- Create: `src/lib/excel/detect.ts`
- Test: `tests/excel/detect.test.ts`

**Interfaces:**

```ts
export interface DetectionResult {
  sheetNames: string[]
  profile: ExcelProfile          // 최선 추정(사람이 2단계에서 수정)
  confidence: { header: number; hierarchy: number; logical: number }  // 0~1
  preview: { headers: string[]; rows: unknown[][] }   // 헤더행 + 데이터 10행
  warnings: string[]             // '가중치 열을 찾지 못했습니다' 등 — 빈 매핑은 null 로 두고 경고
}
export function detectWorkbook(buf: ArrayBuffer): { ok: true; result: DetectionResult } | { ok: false; error: string }
export const LOGICAL_ALIASES: Record<keyof ExcelProfile['logical'], readonly string[]>
export const DEFAULT_OWNER_MARKS: Record<string, 'primary' | 'support'>  // { '●':'primary','△':'support','◎':'primary','O':'primary','o':'primary' }
```

감지 규칙(§6.3 — 전부 순수 함수로 분리해 개별 테스트):
1. **시트**: 'WBS' 우선, 없으면 첫 시트. 시트 0개 → `{ok:false, error:'시트가 없습니다'}`. Holiday 시트는 이름 일치 시만.
2. **헤더 행**: 상위 10행을 별칭 사전 히트 수로 스코어링, 최고점 행. 동점·0점이면 warnings 에 기록하고 0행 가정(confidence.header 낮게).
3. **열=계층**: 헤더행 이후 데이터에서, 텍스트가 든 연속 열 구간 중 **"각 행에서 그 구간 내 비공백 셀이 정확히 1개"** 비율이 90%+ 인 최장 구간(§6.3 의 정의). 후보 없으면 아웃라인 검사로.
4. **아웃라인**: `^\d+([.\-]\d+)*$` 매치 비율 80%+ 인 첫 열. 둘 다 실패 → hierarchy 는 columns:[헤더 최좌측 텍스트열] + warnings + confidence.hierarchy=0.
5. **논리 열**: LOGICAL_ALIASES 완전일치(trim, 대소문자 무시) 우선, 부분일치 차선. 미발견=null+warning.
6. **팀 열**: 계층·논리 열을 제외한 열 중 데이터 셀 값이 DEFAULT_OWNER_MARKS 키 또는 공백뿐인 열(마크 방식), **또는** 별칭 '담당' 열 하나에 팀명이 직접 든 방식(§6.3 — 이 경우 teamColumns 는 [[그 열,'*']] 로 두고 warnings 에 '담당 열의 팀명을 직접 사용'을 기록, 실행 시 셀 값=팀코드로 해석).
7. **미리보기**: 헤더행 라벨 + 데이터 10행 원본.

- [ ] **Step 1: 실패하는 테스트** — AOA 를 XLSX.utils.aoa_to_sheet 로 워크북화하는 헬퍼 + 케이스 4개:
  (a) D-CUBE 3행 헤더 5팀 파일 → LEGACY_DCUBE_PROFILE 과 동등한 감지(teamColumns·logical 좌표 일치)
  (b) 아웃라인 코드 파일(코드열 A, 이름 B, 담당 C에 팀명 직접) → hierarchy outline, code 열 감지
  (c) 4열 계층(B~E) 파일 → columns [1,2,3,4]
  (d) 시트 0개/헤더 불명 → ok:false / warnings+저신뢰
- [ ] **Step 2: RED** → **Step 3: 구현**(규칙별 순수 함수 + detectWorkbook 조립) → **Step 4: GREEN+tsc+eslint**
- [ ] **Step 5: 커밋** — "feat(excel): 양식 자동 감지 — 감지 실패는 침묵 폴백이 아니라 질문거리(§6.3)"

---

### Task 4: 프로파일 파서 `parseWithProfile.ts` + N단 링커

**Files:**
- Create: `src/lib/excel/parseWithProfile.ts`
- Test: `tests/excel/parse-with-profile.test.ts`

**Interfaces:**

```ts
export interface ParsedRowN {
  depth: number                 // 0-based
  code: string | null           // 코드 열 값(Q3). 없으면 null → 링커가 채번
  name: string
  extraAxis: string | null
  deliverable: string | null
  plannedStart: string | null; plannedEnd: string | null
  weight: number | null; actualPct: number | null
  owners: { team: string; kind: 'primary' | 'support' }[]
  excelRow: number
}
export function parseWithProfile(buf: ArrayBuffer, profile: ExcelProfile):
  { ok: true; rows: ParsedRowN[]; holidays: { date: string; name: string }[] }
  | { ok: false; error: string }
/** N단 스택 링킹 + 코드 채번(Q3: 있으면 그대로, 없으면 1·1.1·1.1.2) → ImportItem[] (validate.ts 의 기존 타입 재사용) */
export function linkByDepth(rows: ParsedRowN[]):
  { ok: true; items: ImportItem[] } | { ok: false; errors: ImportError[] }
```

구현 규칙:
- 날짜·숫자 변환은 parse.ts 의 `toIso`/`toNum` 로직을 **복제**한다(원본 무접촉 — 함수 앞 주석에 "parse.ts 와 동일, 구 경로 제거(Plan C) 때 통합" 명시).
- hierarchy columns: 행마다 채워진 열 인덱스 → depth = 그 열의 구간 내 순번. 2개 이상 채워짐 → 에러 행(excelRow 포함). outline: 구분자 수 → depth, 코드 열 값이 code 후보(logical.code 미설정 시).
- linkByDepth: 스택 배열(§4.4 — lastAtDepth[d]). depth 가 스택보다 2+ 깊게 점프하면 에러('깊이 건너뜀'). level 기록: **hierarchy 가 columns 이고 정확히 3열이면 depth→['phase','task','activity'] 매핑(레거시 호환), 그 외 level 은 'activity'**(0059 이후 level 은 DEPRECATED 표기용 — CHECK 없음. null 대신 'activity' 를 쓰는 이유: 롤백(0059_rollback)이 3값 밖·null 행에서 중단되므로 롤백 가능성을 보존한다).
- 코드 채번: 형제 순번 경로 조인('1', '1.1'). 코드 열 값이 있으면 trim 후 그대로(60자 초과만 에러).
- 팀명 직접 방식(teamColumns=[[c,'*']]): 셀 값(콤마 분리 허용)을 팀코드로, 첫 팀 primary 나머지 support.
- splitLeafOwners(기존 validate.ts export)를 그대로 재사용해 후처리(마법사 경로도 sub-act 규칙 동일).

- [ ] **Step 1: 실패하는 테스트** — 핵심 4케이스:
  (a) **라운드트립 계약**: D-CUBE 형 AOA 를 LEGACY_DCUBE_PROFILE 로 파싱+링킹 → 기존 `parseWbsWorkbook`+`validateAndLink` 결과와 **항목 수·이름·부모 연결·owners·일정 동일**(code 는 채번 규칙이 다르므로 비교 제외 — 주석으로 §6.4 근거)
  (b) 아웃라인 4단 파일 → depth 0~3 링킹, 코드 그대로 보존, 채번 없음
  (c) 코드 열 없는 4열 계층 → 자동 채번 '1','1.1','1.1.1','1.1.1.1'
  (d) 깊이 점프(0→2) → 에러 행 보고
- [ ] **Step 2~4: RED→구현→GREEN** (기존 tests/excel 전량 회귀 포함 `npx vitest run tests/excel`)
- [ ] **Step 5: 커밋** — "feat(excel): 프로파일 파서+N단 링커 — 레거시 프로파일 주입 시 구 파서와 동등(라운드트립 계약)"

---

### Task 5: inspect API — `POST /api/import/inspect`

**Files:**
- Create: `src/app/api/import/inspect/route.ts`
- Test: `tests/api/import-inspect.test.ts` (tests/api 관례 — 없으면 tests/excel 옆 신설하고 리포트에 기록)

**Interfaces:**
- 요청: multipart form — `file`, `projectId`. 가드 `requireProjectAdmin(projectId)`(기존 import route 의 AUTHZ_STATUS 매핑 복제).
- 응답 200: `{ ok: true, detection: DetectionResult, savedProfile: ExcelProfile | null }` — savedProfile 은 project_settings.excel_profile 이 '{}' 가 아니면 파싱·검증해 반환(사람 확인 화면의 기본값 = savedProfile ?? detection.profile). **DB 쓰기 0**(§6.2 — 1단계는 무접촉).
- 실패: 파일/프로젝트 누락 400, 감지 실패 400(`detectWorkbook` 의 error 그대로), 설정 조회 실패 500(위장 금지).

- [ ] **Step 1: 실패하는 테스트** — 라우트 mock 패턴(requireProjectAdmin·createServerClient mock): 정상 감지 / 미인가 403 / 시트 없음 400 / savedProfile 반환.
- [ ] **Step 2~4: RED→구현→GREEN**
- [ ] **Step 5: 커밋**

---

### Task 6: execute API — `POST /api/import/execute` (append/replace + 백업 + 프로파일 저장 + 팀 부트스트랩 신호)

**Files:**
- Create: `src/app/api/import/execute/route.ts`
- Test: `tests/api/import-execute.test.ts`

**Interfaces:**
- 요청: multipart form — `file`, `projectId`, `profile`(JSON 문자열 → validateProfile), `mode`('append'|'replace'), `saveProfile`('true'|'false', Q4), `registerTeams`('true'|'false' — §10.3).
- 흐름: 가드 → validateProfile → parseWithProfile → **팀 검증**: 등장 팀 중 팀 마스터 미등록분을 추출. `registerTeams=false` 면 `{ needsTeams: [...] }` 를 409 로 반환(마법사가 등록 확인 UI 를 띄운다). `true` 면 슈퍼유저 확인 후(`requireSuperuser` — 실패 시 403 '팀 등록은 슈퍼유저 권한') 팀 마스터에 등록(admin client insert — `/admin/teams` 의 addTeam 액션 로직을 열어 필드 관례(code·sort_order 말번 채번·active true)를 그대로 따르고, 액션 직접 호출이 가능하면 재사용) 후 진행.
- linkByDepth → splitLeafOwners → mode 분기:
  - append: 기존 `import_wbs` RPC.
  - replace: **백업 먼저** — 현 트리 전체 select(전 컬럼) 실패 시 중단(§6.6-2, Q1: wbs_items 만). 성공 시 `replace_wbs` RPC → 응답에 `backup: { rows: [...], generatedAt }` 포함(클라이언트가 JSON 파일 다운로드). change_logs 유실 경고 문자열도 응답에.
- 성공 후: `saveProfile=true` 면 project_settings.excel_profile upsert(admin client — createProject 시드와 같은 경로 관례). recordProgressSnapshot + ingestProject(기존 route 관례 복제).
- 응답: `{ ok: true, count, mode, reindexed, backup? , profileSaved: boolean }`.

- [ ] **Step 1: 실패하는 테스트** — 케이스: append 성공 / replace 가 백업 select 실패 시 RPC 미호출 중단 / needsTeams 409 / registerTeams+비슈퍼유저 403 / saveProfile 시 upsert 페이로드 / 검증 오류 400.
- [ ] **Step 2~4: RED→구현→GREEN** (기존 import route 무접촉 — diff 확인)
- [ ] **Step 5: 커밋** — "feat(import): 실행 라우트 — replace 는 백업 선행, 팀 부트스트랩은 명시 확인(§10.3)"

---

### Task 7: 익스포트 — 프로파일 헤더 + sub-act 펼침 옵션

**Files:**
- Create: `src/lib/excel/exportWithProfile.ts`
- Modify: `src/app/api/export/route.ts` (옵션 쿼리 `?expand=1` 추가 — 기존 기본 경로 동작 불변)
- Test: `tests/excel/export-with-profile.test.ts`

**Interfaces:**
- `buildAoaWithProfile(items, profile, opts: { expandSubActs: boolean }): unknown[][]` — profile 의 hierarchy·logical·teamColumns·ownerMarks 로 헤더와 열 배치를 생성(임포트와 같은 규약 = 라운드트립, §6.5). expandSubActs=true 면 sub-act 를 계층 열 +1 깊이(또는 outline 코드 자릿수+1)로 실제 행 출력, false 면 기존 flatten 접기와 동일.
- 기존 `/api/export` 는 **무변경 기본**(D-CUBE 산출물 불변 — Plan A 회귀 기준 유지). `?expand=1&profile=saved` 일 때만 신 경로: project_settings 프로파일('{}' 이면 LEGACY_DCUBE_PROFILE) + 펼침.
- 스펙 §6.5 의 "기본값 펼침" 은 **마법사 UI 의 다운로드 버튼 기본값**으로 구현(Task 8)하고, 구 익스포트 버튼 경로는 접기 유지 — 이유(운영 산출물 급변 방지)를 코드 주석+리포트에 명시. ⚠️ 이는 스펙 문면("기본값을 펼침으로")의 절충 적용이다 — 최종 리뷰에서 스펙 편차로 다룰 것.

- [ ] **Step 1: 실패하는 테스트** — (a) LEGACY_DCUBE_PROFILE+접기 → 기존 buildWbsAoa 와 헤더·행 동일(셀 비교) (b) 펼침 → sub-act 행이 4번째 계층 열에 등장, 팀 마크 1개 (c) 펼침 산출물을 detect→parseWithProfile 로 되읽어 sub-act 가 isOwnerSplit 후보로 복원되는 왕복 1건.
- [ ] **Step 2~4: RED→구현→GREEN** (기존 export 테스트 회귀 포함)
- [ ] **Step 5: 커밋**

---

### Task 8: 마법사 UI — `/p/[projectId]/import` 2단계

**Files:**
- Create: `src/app/(app)/p/[projectId]/import/page.tsx`
- Create: `src/components/import/ImportWizard.tsx`
- Create: `src/lib/i18n/dict/importWizard.ts` + Modify: `src/lib/i18n/dict.ts` (import+spread — 4줄 이내)
- Modify: `src/components/settings/WbsImportForm.tsx` — **링크 1줄만 추가**("새 임포트 마법사 →" — 기존 폼·동작 무변경)
- Test: 빌드+기존 스위트(컴포넌트 테스트는 리포 관례상 로직 있는 경우만 — 위저드 상태 전이 순수 함수가 생기면 그것만 tests/ui 에)

구성(§6.2 화면 그대로):
- 1단계: 파일 선택 → inspect 호출 → 파일은 클라이언트 메모리 보관(§6.2 — 서버 임시 저장 없음).
- 2단계: 감지 결과 편집 폼 — 계층 방식 라디오(columns/outline), 논리 열 셀렉트(열 라벨 목록), 레벨 라벨 입력(표시용 — project_settings.level_labels 는 이번 범위 밖, 입력값은 미저장·미리보기 전용이면 **아예 두지 않는다**: YAGNI — §6.2 의 '레벨 라벨' 행은 P2 설정 화면 몫으로 이월, 리포트에 기록), 마크 사전 편집(키↔주관/지원), 모드 라디오(append/replace — replace 선택 시 삭제 건수+change_logs 유실 경고+백업 자동 다운로드 안내), 프로파일 저장 체크(기본 on), 미리보기 10행 테이블.
- 실행: execute 호출 → needsTeams 409 면 팀 목록 확인 다이얼로그("이 팀들을 등록하시겠습니까" — 슈퍼유저만 버튼 활성) → registerTeams=true 재호출. replace 성공 시 응답 backup 을 Blob 다운로드(`wbs-backup-{projectId}-{date}.json`).
- 접근성: 파일 input·라디오·셀렉트에 라벨(에이전트 루프 리뷰 교훈).
- 스타일: 기존 토큰·프리미티브(btn/app-input/Modal/EmptyState/useToast — 실물 시그니처가 정본).

- [ ] **Step 1: i18n 사전 → Step 2: 페이지+위저드 구현 → Step 3: WbsImportForm 링크 1줄 → Step 4: `npx tsc --noEmit`+eslint+`npm run build` → Step 5: 커밋**

---

### Task 9: 배포·적용·E2E (사람 개입 구간)

- [ ] **Step 1**: `npm run test && npm run lint && npm run build` 전량.
- [ ] **Step 2**: 0061 적용(Management API) → `pg_get_functiondef` 로 replace_wbs 확인 + D-CUBE excel_profile 백필 확인(`select excel_profile->>'sheetName' from project_settings where preset_applied='legacy-dcube'` → 'WBS').
- [ ] **Step 3**: 브랜치 선푸시 → main 머지·push → Ready → `npm run smoke:prod`.
- [ ] **Step 4 (E2E, 샘플 프로젝트)**: 브라우저로 `/p/99999999-9999-4999-8999-999999999999/import` — (a) 4단 아웃라인 코드 xlsx(스크래치에서 생성)를 append 임포트 → WBS 화면에서 4단 트리·자동 채번 확인 (b) replace 모드로 재임포트 → 백업 JSON 다운로드 확인 + 트리 교체 확인 (c) 미등록 팀 파일 → 등록 확인 다이얼로그 → 등록 후 성공. **D-CUBE 는 화면 열람만**(임포트 금지) — 기존 익스포트 산출물 불변 확인(다운로드 셀 비교).
- [ ] **Step 5**: `npm run mark:good`(화면 확인 후) + 메모리 갱신.
- 롤백 좌표: 코드 revert → 0061_rollback(함수 drop — 구 경로는 0061 과 무관하므로 즉시 안전).

---

## Self-Review 결과 (작성 시점)

- **스펙 §6 커버리지**: §6.1 침묵 오파싱 → 새 경로에서 전부 명시화(T3~T6, 구 경로는 §11 단계 4 대로 병행 유지·무접촉) · §6.2 2단계 마법사 → T5/T6/T8 · §6.3 감지 규칙 → T3 · §6.4 code 승격(Q3) → T4 · §6.5 프로파일 익스포트+펼침 → T7(기본값은 절충 — 스펙 편차로 명시) · §6.6 append/replace(Q1) → T2/T6 · §10.3 팀 부트스트랩 → T6/T8 · §7.5 excel_profile 백필(parked 승계) → T2 · Q4 마크 저장 → T1/T6.
- **의도적 비범위**: 레벨 라벨 편집(P2 설정 화면), 구 임포트 라우트 제거(Plan C), holiday 시트 매핑 편집(현행 이름 규약 유지 — detect 가 이름만 감지).
- **타입 일관성**: ExcelProfile(T1)을 T3~T8 전부 소비. ImportItem 은 기존 validate.ts 타입 재사용(T4). DetectionResult(T3)를 T5 응답·T8 이 소비.
- **위험 메모**: T2 의 replace_wbs 가 import_wbs 본문을 복제하는 것은 의도(함수 분리 계약·구 함수 무접촉). T6 의 팀 등록은 슈퍼유저 한정 — 관리자 확장은 별도 결정. T7 의 스펙 문면 절충(기본 펼침 위치)은 최종 리뷰 의제.
```
