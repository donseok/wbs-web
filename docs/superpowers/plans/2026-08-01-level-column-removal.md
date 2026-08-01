# level 컬럼 제거 (Plan D: 설계 §11 단계 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 마지막 남은 비-UI `level` 소비처(봇 RAG·주간보고 PPT/엑셀·WBS 엑셀 익스포트)를 depth+levelLabels로 옮기고, insert 경로·RPC에서 level을 빼고, `wbs_items.level` 컬럼을 drop하고, 구 임포트 라우트/파서를 제거한다 — D-CUBE 산출물이 1바이트도 바뀌지 않은 채로.

**Architecture:** 정본 스펙 `docs/design/dflow-generic-wbs-design-2026-07-29.md` §11 단계 6. Plan A~C가 UI를 depth로 옮겼고 level 컬럼만 DEPRECATED로 남았다. 이 계획은 (1) 산출물 계열 3파일과 봇 3파일의 level 소비를 depth 클램프로 전환 (2) WbsRow.level 필드·insert 경로·RPC에서 level 제거 (3) 컬럼 drop (4) 구 임포트 경로 제거. **핵심 불변식**: level은 depth의 순수함수라 D-CUBE에서 `level==='phase'⟺depth 0`, `'task'⟺depth 1`, `'activity'(sub-act 포함)⟺depth≥2`. sub-act가 depth 3(레이블 배열 밖)이므로 `levelLabels[Math.min(depth, levelLabels.length-1)]` **클램프가 회귀 0의 필수 장치**다.

**Tech Stack:** Next.js 15 · Supabase(Management API) · vitest · 기존 주입 패턴(Plan A getProjectConfig, teams 주입)

## Global Constraints

- **회귀 0이 유일한 합격 기준**: 각 배포 후 D-CUBE의 ① WBS 엑셀 익스포트 셀 단위 동일 ② 주간보고 PPT·엑셀 산출물 동일 ③ DK Bot 답변·임베딩 텍스트 동일(재색인 불필요) ④ 대시보드·화면 동일 ⑤ `npm run test`·`npm run smoke:prod` 초록.
- **클램프 필수**: level→라벨 전환은 항상 `levelLabels[Math.min(depth, levelLabels.length - 1)]`. 순진한 `levelLabels[depth]`는 depth-3 sub-act(D-CUBE 81건 실재)에서 `undefined`가 되어 회귀. levelLabels 기본값은 `['Phase','Task','Activity']`(= `DEFAULT_PROJECT_CONFIG.levelLabels`, `src/lib/data/projectConfig.ts`).
- **drop 안전성 실측 완료**: D-CUBE는 stored level ≡ 트리 depth 완전 일치(mismatch 0). 전 프로젝트 mismatch 6건은 비운영 샘플의 아웃라인 임포트 트리(level 전부 'activity')이며 봇·주간보고·엑셀은 D-CUBE에서만 동작해 무관.
- **컬럼 drop(Task 5)은 Task 1~4 배포·`mark:good` 완료 후에만.** 비가역. drop 전까지 컬럼·insert는 level을 계속 써도 무방하나 UI·신규 코드는 안 읽는다.
- **buildWbsAoa는 N단 열로 확장하지 않는다.** 레거시 파서(`parse.ts`)가 3열만 읽어 4단 라운드트립이 구조적으로 불가능하고, 진짜 N단 익스포트는 이미 프로파일 경로(`exportWithProfile.ts`, `?expand=1`)가 담당한다. 이 계획은 buildWbsAoa에서 **level만 제거**하고 4단 유실은 기존 손실 계약(export.ts:19 주석)을 유지한다.
- 마이그레이션(0062 RPC 교체, 0063 drop)은 단독 커밋 + `_rollback.sql`(G1). 적용 Management API. 번호는 착수 시 `ls supabase/migrations | tail`로 재확인.
- `git add -A` 금지. 커밋 한국어 "왜" + 트레일러 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: 산출물 계열(엑셀 익스포트·주간보고) level→depth 클램프

**Files:**
- Modify: `src/lib/excel/export.ts` (buildWbsAoa 75-76·85행, 시그니처에 levelLabels)
- Modify: `src/app/api/export/route.ts` (기본 경로에 getProjectConfig 주입)
- Modify: `src/lib/report/weekly.ts` (141 WbsFlatRow.level 필드·251 LEVEL_LABEL·482 생산, opts에 levelLabels)
- Modify: `src/lib/report/excel.ts` (198-199 bg/bold)
- Modify: `src/app/api/report/route.ts` (buildWeeklyReportModel 호출에 levelLabels 주입 — 실물 호출부 확인)
- Test: `tests/excel/export.test.ts`, `tests/report/weekly.test.ts`, `tests/report/excel.test.ts`

**Interfaces:**
- Produces: `buildWbsAoa(items, projectName?, teamCodes?, levelLabels?: readonly string[])` — levelLabels 기본값 `['Phase','Task','Activity']`. `buildWeeklyReportModel(..., opts)`의 opts에 `levelLabels?: readonly string[]` 추가(기본 동일). `WbsFlatRow`에서 `level` 필드 제거(levelLabel은 유지, depth 기반으로 산출).

- [ ] **Step 1: 실패하는 테스트 — 엑셀 익스포트 depth 매핑 + 커스텀 라벨** (export.test.ts에 추가)

```ts
it('buildWbsAoa: 계층 열이 depth로 배치되고 커스텀 levelLabels가 헤더에 반영된다', () => {
  const items = /* phase(depth0)→task(depth1)→activity(depth2) 3단 fixture, 기존 헬퍼 사용 */
  const aoaDefault = buildWbsAoa(items, 'P', ['PMO','ERP','MES','가공','MDM'])
  // aoa[0]=header1, aoa[1]=header2, aoa[2]=header3, aoa[3..]=데이터행
  // header2/header3 의 열1/2/3 라벨(기본 Phase/Task/Activity) — 무인자 현행과 동일
  expect(aoaDefault[1][1]).toBe('Phase'); expect(aoaDefault[2][2]).toBe('Task'); expect(aoaDefault[2][3]).toBe('Activity')
  // 데이터행: phase명은 열1, task명은 열2, activity명은 열3 (row[1+depth])
  expect(aoaDefault[3][1]).toBe(/* phase 노드명 */)
  const aoaCustom = buildWbsAoa(items, 'P', ['PMO'], ['단계','기능','작업'])
  expect(aoaCustom[1][1]).toBe('단계'); expect(aoaCustom[2][1]).toBe('단계')  // levelLabels[0] → header2·header3 열1
})
```

⚠️ **헤더 구조 실물 확인**: `export.ts:65-69`의 header2/header3에서 하드코딩된 'Phase'/'Task'/'Activity'(열 1/2/3)를 `levelLabels[0..2]`로. 나머지 헤더·팀 열(base=6+teams.length)·패드 2칸은 무변경. **기본값 `['Phase','Task','Activity']`가 현행과 동일**하므로 무인자 호출(기존 테스트)은 바이트 불변.

- [ ] **Step 2: RED** → **Step 3: 구현 (export.ts)**

행 배치(75-76): `if (it.level==='phase') row[1]=... else if 'task' row[2] else row[3]` → **`row[1 + it.depth] = it.name`** (ComputedItem.depth는 Plan C가 이미 부여). actualPct 셀(85): `it.level==='activity'` → **`it.children.length > 0 && it.children[0].isOwnerSplit`** (자식이 sub-act인 접힌 노드 = 현행 activity 대표 행과 등가; `exportWithProfile.ts:222`의 `childrenAreSubActs`와 동형). 헤더 라벨 3곳을 levelLabels로. 시그니처에 `levelLabels: readonly string[] = ['Phase','Task','Activity']`.

route.ts 기본 경로(현 55행 `buildWbsWorkbook(items, ..., activeTeamCodesSync())`): `getProjectConfig(projectId).levelLabels`를 Promise.all에 추가해 buildWbsAoa/buildWbsWorkbook에 전달. `getProjectConfig`는 서버 전용(next/headers) — 라우트라 정상. `?expand=1` 경로는 이미 getProjectConfig를 쓰므로 패턴 동일.

- [ ] **Step 4: 실패하는 테스트 — 주간보고** (weekly.test.ts·excel.test.ts)

weekly.test.ts:154의 기존 `expect(m.wbs[2].levelLabel).toBe('stage')`는 depth-2 노드에 `level:'stage'`(매핑 밖)를 넣고 원문 폴백을 기대한다 — depth 전환 후엔 `levelLabels[2]='Activity'`가 나오므로 **`'Activity'`로 변경**(의미: 라벨이 raw level이 아니라 depth+levelLabels 유래). depth-3 sub-act 케이스 추가: `levelLabel === 'Activity'`(클램프). excel.test.ts에 col-2(Lv) 라벨 + bg/bold 스냅샷(phase>task>activity>sub-act → Phase/Task/Activity/Activity, bold=T/T/F/F) 회귀 케이스 추가.

- [ ] **Step 5: RED → 구현 (weekly.ts·excel.ts)**

weekly.ts:482 생산: `level: node.level, levelLabel: LEVEL_LABEL[node.level] ?? ...` → **`levelLabel: levelLabels[Math.min(depth, levelLabels.length - 1)], depth`** (level 필드 제거, depth는 이미 482행이 계산). `WbsFlatRow`(141)에서 `level: Level` 제거, `LEVEL_LABEL`(251) 삭제, `Level` import 제거. `buildWeeklyReportModel` opts에 `levelLabels?: readonly string[]`(기본 `['Phase','Task','Activity']`). excel.ts:198-199: `bg = row.depth===0 ? PX.phaseRow : row.depth===1 ? PX.actRow : r%2===0 ? PX.zebra : PX.white`, `bold = row.depth <= 1`. (201행 levelLabel 셀은 무변경 — 필드값만 depth 유래로.)

report/route.ts 호출부: buildWeeklyReportModel에 `levelLabels: (await getProjectConfig(projectId)).levelLabels` 주입(실물 route 확인 — 이미 Promise.all로 데이터 페치 중). analytics.ts의 analyzeProject 경로는 weekly.wbs를 안 쓰므로 levelLabels 기본값으로 두면 출력 영향 0(주입 불필요).

- [ ] **Step 6: GREEN 전량** — `npx vitest run tests/excel tests/report` + `npx tsc --noEmit` + eslint + `npm run build`.
- [ ] **Step 7: 커밋** — "feat(export): WBS/주간보고 산출물의 level을 depth 클램프로 — D-CUBE 셀 불변, 컬럼 제거 준비"

---

### Task 2: 봇 계열(analytics RAG·match·tools) level→depth 클램프

**Files:**
- Modify: `src/lib/ai/analytics.ts` (18 LEVEL_KO·372 임베딩 텍스트)
- Modify: `src/lib/ai/ingest.ts` (buildDocuments 호출에 levelLabels 주입 — getProjectConfig 로드)
- Modify: `src/lib/ai/commands/match.ts:11` (phaseName 판정)
- Modify: `src/lib/ai/tools/wbs.ts` (35 타입·143 값)
- Test: `tests/ai/analytics.test.ts`, `tests/ai/commands-match.test.ts`

**Interfaces:**
- Consumes: ComputedItem.depth·isOwnerSplit.
- Produces: `buildDocuments(items, projectName, today, teamCodes, members, levelLabels?)` — levelLabels 인자 추가(기본 `['Phase','Task','Activity']`), analyzeProject 시그니처는 무변경(buildDocuments 내부에서만 사용). match는 `n.depth===0`. tools의 level 필드는 depth에서 재생성한 enum 키.

- [ ] **Step 1: 실패하는 테스트 — 임베딩 텍스트 depth-3 sub-act가 'Activity'** (analytics.test.ts)

```ts
it('buildDocuments: depth-3 sub-act 리프의 구분이 클램프로 Activity를 유지한다(재색인 불필요)', () => {
  const items = /* phase→task→activity→sub-act(isOwnerSplit,depth3) 트리 */
  const docs = buildDocuments(items, 'P', '2026-08-01', ['PMO'], [], ['Phase','Task','Activity'])
  const subActDoc = docs.find(d => d.content.includes('sub-act 리프명'))
  expect(subActDoc!.content).toContain('구분 Activity')  // levelLabels[min(3,2)] = Activity
})
```

- [ ] **Step 2: RED** → **Step 3: 구현**

analytics.ts:372: `구분 ${LEVEL_KO[n.level] ?? n.level}` → `구분 ${levelLabels[Math.min(n.depth, levelLabels.length - 1)]}`. LEVEL_KO(18) 삭제. buildDocuments 시그니처에 `levelLabels: readonly string[] = ['Phase','Task','Activity']`. ingest.ts(현 31행 `buildDocuments(items, name, today, activeTeamCodesSync(), members)`): `getProjectConfig(projectId).levelLabels`를 로드(ingest는 서버 전용·createAdminClient)해 인자 추가. **analytics.ts는 순수 모듈이라 내부에서 getProjectConfig 금지** — ingest가 주입.

match.ts:11: `n.level === 'phase' ? n.name : phaseName` → `n.depth === 0 ? n.name : phaseName` (pipeline.ts가 computed items 전달 — depth 보유).

tools/wbs.ts:143: `level: item.level` → **`level: (['phase','task','activity'] as const)[Math.min(item.depth, 2)]`** (enum 키를 depth에서 재생성 — orchestrator의 DISPLAY_ENUMS가 동일하게 'Phase/Task/Activity' 렌더, config 배선 불필요, D-CUBE 바이트 동일). 타입(35)은 유지(`ComputedItem['level']`가 Task 3에서 없어지면 `'phase'|'task'|'activity'` 리터럴로 — Task 3와 조율).

- [ ] **Step 4: GREEN** — `npx vitest run tests/ai` + tsc + eslint. **match 테스트 픽스처에 depth 세팅 필수**(commands-match.test.ts:9,18이 level만 세팅 — depth 추가 안 하면 스왑 후 깨짐).
- [ ] **Step 5: 커밋** — "feat(ai): 봇 RAG·명령·도구의 level을 depth 클램프로 — D-CUBE 임베딩 텍스트 불변(재색인 불필요)"

---

### Task 3: WbsRow.level 필드 제거 + data 매핑·trend·tools 타입·addWbsItem 시그니처

**Files:**
- Modify: `src/lib/domain/types.ts` (WbsRow에서 level 제거)
- Modify: `src/lib/data/wbs.ts:72`·`src/lib/data/snapshots.ts:54`·`src/lib/repositories/supabase/wbs.ts:119` (level 매핑 제거)
- Modify: `src/lib/domain/trend.ts:36` (level 전달 제거)
- Modify: `src/lib/ai/tools/wbs.ts:35` (타입을 리터럴로)
- Modify: `src/app/actions/wbs.ts` (addWbsItem 시그니처에서 level 인자 제거)
- Test: 기존 전량 회귀

**Interfaces:**
- Produces: `WbsRow`에 level 없음. `addWbsItem(projectId, parentId, name)` — level 인자 제거(호출부 RowDetailPanel은 Plan C에서 이미 depth 파생 문자열을 넘기므로 그 인자 전달 삭제). `Level` 타입은 types.ts에 export 유지(다른 참조 대비).

- [ ] **Step 1: WbsRow.level 제거 후 tsc 전수 노출** — `npx tsc --noEmit`이 드러내는 곳이 정확히 위 목록(data 매핑 3·trend·tools 타입·addWbsItem)뿐이어야 한다. Task 1·2가 끝났으므로 봇·주간보고·엑셀에는 안 나와야 한다. **다른 곳에서 나면 Task 1/2 미완이니 그 파일 명시해 BLOCKED 보고.**
- [ ] **Step 2: 정리** — 매핑 3곳·trend에서 `level:` 라인 제거. addWbsItem 시그니처·insert(238)에서 level 제거(컬럼 nullable이라 안 넣어도 됨 — drop은 Task 5). addSubAct insert(307)에서 `level:'activity'` 제거(is_owner_split:true는 유지). addWbsItem 호출부(`grep -rn "addWbsItem(" src/`) 전수 인자 조정. tools 타입(35)을 `'phase'|'task'|'activity'`로.
- [ ] **Step 3: GREEN** — `npx vitest run` 전량 + tsc + eslint + build.
- [ ] **Step 4: 커밋** — "refactor(wbs): WbsRow.level 필드·매핑·addWbsItem 인자 제거 — 컬럼 drop 준비"

---

### Task 4: 0062 마이그레이션 — import_wbs·replace_wbs에서 level insert 제거

**Files:**
- Create: `supabase/migrations/0062_wbs_rpc_drop_level.sql` + rollback
- Test: `tests/migrations/wbs-rpc-drop-level.test.ts`

**Interfaces:**
- Produces: import_wbs·replace_wbs를 level insert 없이 `create or replace`. 0060(import_wbs)·0061(replace_wbs) 함수 본문에서 **level insert 라인만 제거**(is_owner_split·code 등 나머지 바이트 동일). 롤백은 0060/0061 정의 복원.

- [ ] **Step 1: SQL 작성** — `pg_get_functiondef`로 현행 import_wbs·replace_wbs 본문을 뜬 뒤(0060/0061 파일 참조), insert 문의 `level` 컬럼·`v_item->>'level'` 값만 제거. begin/commit·search_path 핀. **주의: level은 아직 nullable 컬럼으로 존재**하므로 insert 목록에서 빠지면 default null로 들어간다(안전).
- [ ] **Step 2: 롤백** — 0060/0061의 정의(level 포함) 복원.
- [ ] **Step 3: 계약 테스트** — 두 RPC 정의에 `level` insert 미포함·`is_owner_split` 유지·롤백에 level 복원 assert(0058 패턴).
- [ ] **Step 4: 커밋** — 마이그레이션 2파일 단독 / 테스트 별도(G1).

---

### Task 5: 0063 마이그레이션 — level 컬럼 drop (게이트: Task 1~4 배포·mark:good 후)

**Files:**
- Create: `supabase/migrations/0063_drop_wbs_level.sql` + rollback
- Test: `tests/migrations/drop-wbs-level.test.ts`

**⚠️ Task 1~4가 프로덕션 배포되고 `mark:good`된 뒤에만 실행.** level을 읽는 코드가 프로덕션에 0임을 확인한 상태에서만 drop이 안전(Global Constraints).

**Interfaces:**
- Produces: `alter table public.wbs_items drop column level`. 롤백은 `add column level text`(nullable, 데이터 복원 불가 — 주석: is_owner_split·트리로 재파생 가능하나 이 마이그레이션은 컬럼만 되살린다).

- [ ] **Step 1: drop 전 최종 grep** — `grep -rn "\.level\b\|'level'\|\"level\"\|->>'level'" src/ supabase/ | grep -v level_labels | grep -v levelLabels | grep -v minute | grep -v folder` → wbs_items.level 참조 0건(민트·폴더 등 다른 level 제외). RPC도 `pg_get_functiondef`로 level 미참조 확인.
- [ ] **Step 2: 0063 SQL + 롤백** — begin/commit·search_path 핀. drop column. 롤백은 add column nullable + 미복원 주석.
- [ ] **Step 3: 계약 테스트** — drop column 존재·롤백 add column·데이터 미복원 주석 assert.
- [ ] **Step 4: 커밋** — 마이그레이션 단독 / 테스트 별도.

---

### Task 6: 구 임포트 라우트·파서 제거 (§11 단계 6)

**Files:**
- Delete: `src/app/api/import/route.ts` (마법사가 대체)
- Modify/Delete: `src/lib/excel/parse.ts` (parseWbsWorkbook·buildWbsColumnMap·LEGACY_COLUMN_MAP — Plan B가 대체한 export)
- Modify: `src/components/settings/WbsImportForm.tsx` (구 폼 제거, 마법사 링크만 — 실물 확인 후 결정)
- Test: 제거 라우트·파서 전용 테스트 정리

**Interfaces:**
- Produces: 구 임포트 경로 0. **`splitLeafOwners`(validate.ts)·validateAndLink는 유지** — parseWithProfile/execute가 재사용(제거 전 `grep -rn "splitLeafOwners\|validateAndLink\|parseWbsWorkbook\|buildWbsColumnMap"`로 잔존 참조 확인).

- [ ] **Step 1: 참조 전수 확인** — `parseWbsWorkbook`·`buildWbsColumnMap`·`LEGACY_COLUMN_MAP`·`/api/import`(구) 참조를 grep. 마법사(inspect/execute)·validate 재사용분과 구 경로 전용분을 구분.
- [ ] **Step 2: 제거** — 구 라우트 삭제, parse.ts의 구 export 제거(재사용분 유지). WbsImportForm은 구 폼 제거 여부를 실물 확인 후 결정(사용자 확인 대상일 수 있어 리포트에 명시 — 폼이 마법사와 중복이면 링크만 남김).
- [ ] **Step 3: GREEN** — `npx vitest run` 전량 + tsc + build. 제거로 깨지는 테스트는 구 경로 전용인지 확인 후 정리.
- [ ] **Step 4: 커밋** — "chore(import): 구 임포트 라우트·레거시 파서 제거 — 마법사가 대체(§11 단계 6)"

---

### Task 7: 배포·회귀 0·mark:good (사람 개입 구간)

- [ ] **Step 1**: `npm run test && npm run lint && npm run build` 전량.
- [ ] **Step 2: 배포 전 스냅샷** — D-CUBE ① WBS 엑셀 익스포트 파일 ② 주간보고 PPT·엑셀 다운로드(있으면) ③ 봇 답변 샘플 ④ `select md5(...) from wbs_items where project_id=7a1c...` 해시.
- [ ] **Step 3: Task 1~4 배포** — 브랜치 push(UI 위험 파일 없음 — 서버·라이브러리·라우트만) → main 머지·push → Ready → `npm run smoke:prod`. **0062는 코드 배포 후 적용**(RPC가 level 생략 — 컬럼은 아직 존재).
- [ ] **Step 4: 회귀 0 판정** — Step 2 스냅샷과 재비교: 엑셀 익스포트 셀 diff, 주간보고 산출물, 봇 답변(임베딩 텍스트 'Activity' 유지 → 재색인 불필요 확인), 대시보드 KPI. **다르면 즉시 롤백**(0062_rollback → 코드 revert). 통과 시 `npm run mark:good`.
- [ ] **Step 5: Task 5·6 실행(별도 배포)** — Step 4 mark:good 후에만. grep으로 level 참조 0 재확인 → 0063 적용(drop) + 구 경로 제거 코드 배포 → smoke → 육안(WBS·마법사·봇·주간보고 정상) → `mark:good`. 롤백: 0063_rollback(컬럼만 복원) → 코드 revert.
- [ ] **Step 6**: 메모리 갱신 — 범용화 로드맵 P1·P2·§6·단계 5·6 전부 완료. `generic-wbs-core`·`ntier-ui-feature` 메모의 "Plan D" 항목 해소. 남은 건 P3(메뉴)·P4(주간보고 구분 마스터)·P5(브랜드)·P6(전역 축)·P7(로케일).

---

## Self-Review 결과 (작성 시점)

- **소비처 커버리지**(조사 3축 실측): 엑셀 buildWbsAoa 2지점·report/excel·weekly→T1 · 봇 analytics·match·tools→T2 · WbsRow.level·data 매핑 3·trend·addWbsItem→T3 · insert RPC→T4 · 컬럼 drop→T5 · 구 임포트 제거→T6 · 배포/회귀→T7. §11 단계 6 완주.
- **클램프 일관성**: T1(weekly·엑셀 actualPct는 isOwnerSplit)·T2(analytics·tools) 모두 `Math.min(depth, len-1)` 또는 isOwnerSplit 등가. sub-act(depth 3)를 'Activity'로 눌러 D-CUBE 회귀 0.
- **의도적 비범위**: buildWbsAoa N단 열 확장(레거시 파서 라운드트립 불가 — 프로파일 경로가 담당). weekly.wbs를 안 쓰는 analytics.analyzeProject 경로의 levelLabels 주입(출력 영향 0). WbsImportForm 구 폼 제거는 T6에서 실물 확인 후 결정.
- **타입 일관성**: ComputedItem.depth(Plan C)를 T1·T2가 소비. WbsRow.level 제거(T3)는 T1·T2가 level 소비를 걷은 뒤에만(T3 Step 1의 tsc 전수 노출이 검증). tools 타입(T2 vs T3) 조율 명시.
- **위험 메모**: T5 drop은 비가역 — T7 Step 4 mark:good 게이트가 방어선. 봇 재색인은 클램프 덕에 불필요(depth-3 sub-act='Activity' 유지, 실측 확인). T4 RPC 본문은 0060/0061에서 level 라인만 제거(나머지 바이트 동일).
