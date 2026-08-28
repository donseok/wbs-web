# 의존성 두 축 병합 설계 — `task_dependencies` × `wbs_items.depends`

작성 2026-08-28. 상태: **설계안(미착수)**. 구현은 별도 승인 후.

---

## 0. 앞선 안은 폐기한다

2026-08-28 대화에서 먼저 제시한 안은 **"import 시 `depends` → `task_dependencies` 승격"** 이었다.
`origin` 컬럼 추가 + `import_wbs_upsert` 확장 + 마이그레이션 1건.

**그 안을 접는다.** 조사 결과가 반대를 가리켰다:

`0029_task_dependencies.sql` 의 `validate_task_dependency` 트리거는 연결 대상에
**계획 시작일·종료일이 있고, 그 기간에 영업일이 있어야** 한다고 강제한다(0029:65-87).
그런데 wbs.md 의 `schedule` 은 선택 항목이다 — `parseSchedule(null)` 이 `{start:null,end:null}` 을
그대로 돌려준다(`src/lib/agent/wbsImport.ts:96-101,162`). 즉 **에이전트가 실제로 다루는 날짜 없는 작업은
승격 자체가 트리거에 막힌다.**

반면 도메인 계산기는 그 경우를 이미 정상 처리한다:

| 상황 | `computeDependencySchedule` 처리 | 위치 |
|---|---|---|
| 계획일 없음/역전 | `unscheduledTaskIds` 로 분류하고 계속 | `dependencySchedule.ts:123-126` |
| 영업일 0 | 같음 | `:128-131` |
| 대상 없는 엣지·자기참조 | `invalidDependencyIds` | `:137-153` |
| 순환 | `cycleTaskIds` | `:199-204` |

**DB 트리거가 앱보다 엄격하다.** 그 비대칭은 *저장할 때만* 문제가 된다.
저장하지 않으면 트리거 완화도, 두 트리거(`validate_task_dependency`,
`guard_dependent_wbs_dates`) 재작성도, 마이그레이션도, G4 스테이징 리허설도 필요 없다.

부수 효과 하나 더: 승격안은 "트리거에 걸릴 쌍이 몇 건인가"를 알아야 착수 가능한데,
지금 그 수를 **잴 수 없다** — anon 키는 RLS 에 막혀 `[]` 를 돌려주고(측정 불가와 데이터 없음이
구분되지 않는다), `.env.local` 의 `SUPABASE_SERVICE_ROLE_KEY` 는 자리표시자다.
읽기 시점 병합에서는 이 수치가 설계를 바꾸지 않으므로 측정이 선행 조건에서 빠진다.

---

## 1. 현상 — 같은 관계가 두 곳에 따로 산다

둘 다 "A 가 끝나야 B 를 한다"를 뜻한다. 갈린 건 역할이 아니라 **출신**이다(0029 → 0077, 3개월 차).

| | `task_dependencies` (0029) | `wbs_items.depends` (0077) |
|---|---|---|
| 키 | uuid 쌍 | `external_ref` 배열 (`<module>/<id>`) |
| 입력 | 화면에서 관리자가 연결 | wbs.md import 로만 |
| 부가 정보 | FS/SS, `lag_days` 0–365 | 없음 (= FS, lag 0) |
| DB 제약 | 날짜·영업일·순환·교차프로젝트 트리거 | 없음 |
| 소비처 | 간트 연결선·크리티컬 패스·예상 일정·AI 봇 | **에이전트 claim 게이트**·후행 알림·화면 배지 |

실제 개발 과정을 막는 것은 `depends` 뿐이다:

```ts
// src/app/api/v1/agent/work/[id]/claim/route.ts:66
const unmet = dependsInfo.filter((d) => !stageAtLeast(d.stage, 'im') && !d.order_approved)
// → unmet 이면 409. 에이전트가 그 작업을 못 집는다.
```

`task_dependencies` 는 **어떤 쓰기 경로도 막지 않는다.** 화면·분석 전용이다.

### 지금 갈라져서 나는 손해

1. import 로 들어온 선행은 **간트에 선이 안 그려진다.** 크리티컬 패스에도 안 잡힌다.
2. 선행이 밀려도 후행 **예상 일정이 안 밀린다.** 프로젝트 지연 합계에도 반영 안 된다.
3. 사람이 화면에서 그은 선은 **에이전트를 못 막는다.** (→ 3-2. Stage 2)
4. 오른쪽 패널에 뜻이 같은 섹션이 둘이다 — 작업 의존성, 선행·후행 항목.

---

## 2. 채택안 — 읽기 시점 병합 (Read-time merge)

`depends` 를 **저장하지 않고**, 읽는 순간 `TaskDependency` 로 합성해 기존 배열에 합친다.
소비처가 전부 그 배열 하나만 보므로 간트 연결선·크리티컬 패스·예상 일정·AI 봇이 **동시에 켜진다.**

**마이그레이션 0건.** 정본은 그대로다 — `depends` 는 wbs.md, `task_dependencies` 는 화면.

#### 무엇이 켜지고, 무엇은 안 켜지는가 — 먼저 못 박는다

간트 연결선은 **양끝에 계획일이 있어야** 그려진다:

```ts
// WbsGanttSheet.tsx:2002 (DependencyOverlay)
if (!predecessor?.plannedStart || !predecessor.plannedEnd || !successor?.plannedStart) return null
```

wbs.md 의 `schedule` 은 선택 항목이므로, **날짜 없이 import 된 작업 사이의 선행은 이 안으로도
선이 안 그려진다.** 승격안이었어도 결과는 같았다(오히려 트리거에 막혀 저장조차 안 됐다).
날짜 없는 작업을 간트에 그리는 것은 이 안이 푸는 문제가 아니다 — wbs.md 에 `schedule` 을 채우거나,
선행 기준 날짜 파생(`903544f`)을 넓히는 별개의 일이다.

| 기능 | 날짜 있는 쌍 | 날짜 없는 쌍 |
|---|---|---|
| 간트 연결선 | **켜진다** | 안 그려짐 (`:2002`) |
| 크리티컬 패스 | **켜진다** | 대상 아님 (`unscheduledTaskIds`) |
| 예상 일정 전파·지연 합계 | **켜진다** | 대상 아님 |
| AI 봇 `get_wbs_dependencies` | **켜진다** | **켜진다** (일정 무관) |
| 상세 패널 선행·후행 목록·충족 배지 | **켜진다** | **켜진다** (일정 무관) |

즉 이 안의 확실한 소득은 **표(패널·AI)는 전부**, **그림(간트)은 날짜 있는 쌍만**이다.

### 2-1. 근거: SQL 전용 소비자가 없다

`task_dependencies` 를 읽는 곳을 전부 훑었다. **SQL 쪽 독자는 0건**이다 —
0053 의 RLS 쓰기 정책(`admin_write_task_dependencies`)뿐이고, 뷰·함수·크론·리포트 어디에도 없다.
따라서 "DB 에 한 테이블로 모으는 것" 말고 승격이 사주는 값이 없다.

읽기 경로는 TS 로 **딱 둘**이다. 둘 다 손봐야 한다:

| 경로 | 함수 | 소비자 |
|---|---|---|
| `src/lib/data/wbs.ts:26` | `getComputedWbs` | WBS 화면(`p/[projectId]/wbs/page.tsx:29`), export, report, portfolio, ai/ingest |
| `src/lib/repositories/supabase/wbs.ts:153` | `getProjectSnapshot` | AI 봇 `get_wbs_dependencies`(`ai/tools/wbs.ts:374`) |

### 2-2. 타입 확장

```ts
// src/lib/domain/types.ts
export interface TaskDependency {
  id: string
  projectId: string
  predecessorId: string
  successorId: string
  type: DependencyType
  lagDays: number
  /**
   * 이 관계가 어디서 왔는가.
   * 'manual' — task_dependencies 실제 행. 화면에서 지울 수 있다.
   * 'spec'   — wbs_items.depends 에서 읽기 시점 합성. DB 행이 없다.
   */
  origin: 'manual' | 'spec'
}
```

`origin` 은 **필수 필드**로 넣는다. 선택 필드로 두면 합성 행에 remove 버튼이 붙는 사고를
타입이 못 잡는다. 기존 매핑 두 곳(`data/wbs.ts:86`, `repositories/supabase/wbs.ts:140`)에
`origin: 'manual'` 을 명시한다.

### 2-3. 병합 함수 (순수)

```ts
// src/lib/domain/mergeDependencies.ts (신규)

export interface SpecDependSource {
  id: string
  projectId: string
  externalRef: string | null
  depends: string[] | null
}

/**
 * depends(external_ref) 를 uuid 쌍의 FS 의존성으로 합성해 실제 행과 합친다.
 *
 * - 해석 못 한 ref 는 버린다(대상이 프로젝트에 없다). 화면 배지는 별도 경로가 이미 보여준다.
 * - 같은 (predecessor, successor) 가 양쪽에 있으면 **실제 행이 이긴다** — 연결선 중복 방지.
 * - 자기참조는 버린다. 순환은 버리지 않는다(computeDependencySchedule 이 cycleTaskIds 로 처리).
 */
export function mergeSpecDepends(
  rows: TaskDependency[],
  items: SpecDependSource[],
): TaskDependency[]
```

합성 id 규칙: `` `spec:${predecessorId}>${successorId}` ``

- uuid 와 형태가 겹치지 않아 실수로 DB 에 넘어가도 즉시 실패한다(조용히 통과하지 않는다).
- 안정적이라 React key·`criticalDependencyIds` 집합에 그대로 쓸 수 있다.
- 앞자리 `spec:` 이 로그·디버깅에서 출처를 드러낸다.

### 2-4. 화면 — 섹션 하나로 접는다

지금 상세 패널에 두 섹션이 있다. 병합 뒤 **작업 의존성 섹션이 둘 다 담는다.**

- `WbsSpecLinksPanel.tsx` (2026-08-28 신설) **제거.** 별도 서버 액션 `getWbsSpecLinks` 도
  같이 제거한다 — 병합 뒤에는 `dependencies` prop 이 이미 그 정보를 담는다.
  왕복 하나가 줄어드는 부수 이득이 있다.
- `RowDetailPanel` 의 `DependencyRow`:
  - `origin === 'spec'` → **remove 버튼 감춤.** 합성 id 로 `removeTaskDependency` 를 부르면
    없는 행을 지우려다 실패한다. 게다가 정본이 wbs.md 라 지워도 다음 import 에 되살아난다.
  - `origin === 'spec'` → `가져옴` 배지. 사용자가 "왜 못 지우지"를 묻지 않게 한다.
- 선행 추가 폼은 그대로 — 새로 그은 선은 항상 `manual` 이다.

### 2-5. 충족 판정 — 축마다 규칙이 다르다, 뭉개지 않는다

| origin | 충족 규칙 | 이유 |
|---|---|---|
| `spec` | `stageAtLeast(stage, 'im')` | **claim 게이트와 같은 식**이어야 한다. 어긋나면 화면은 "시작 가능"인데 claim 이 409 를 낸다 |
| `manual` | `rolledActualPct >= 100` (FS) / `> 0` (SS) | 이 축은 아무것도 막지 않는다. 실적이 유일한 완료 신호다 |

`evaluateStartReadiness`(`src/lib/domain/dependencyReadiness.ts`)에 `origin` 분기를 넣고,
`specDependency.ts` 의 `specLinkState` 를 그 안으로 흡수한다. 판정 코드가 한 곳으로 모인다.

**알려진 어긋남 — 이 안의 범위 밖:** claim 게이트의 두 번째 축인 `order_approved`
(`src/lib/agent/depends.ts:5-11`)를 화면은 모른다. 승인은 났는데 stage 가 안 따라간 선행은
claim 은 통과시키지만 **화면은 계속 "대기"로 보여준다.** 지금도 그렇고 병합해도 그대로다.
고치려면 `agent_work_orders.status='approved'` 를 읽기 경로에 얹어야 한다 — 별건으로 남긴다.

### 2-6. 안 건드리는 것

- 마이그레이션·트리거·RLS — 손대지 않는다.
- `guard_dependent_wbs_dates` 가 지키는 불변식("연결된 작업은 계획일이 유효하다")이 그대로 유지된다.
  `dependencySchedule.ts:240-241` 의 `plannedStart!`/`plannedEnd!` 는 `validTaskIds` 뒤라 안전하고,
  이 안은 그 전제를 건드리지 않으므로 **소비자 전수 감사를 지지 않는다.**
- `depends` 컬럼·import 계약·claim 게이트 — 그대로.

---

## 3. 단계

### Stage 1 — 읽기 시점 병합 (이 문서의 본안)

| # | 내용 | 파일 |
|---|---|---|
| 1 | `TaskDependency.origin` 추가, 기존 매핑에 `'manual'` 명시 | `domain/types.ts`, `data/wbs.ts`, `repositories/supabase/wbs.ts` |
| 2 | `mergeSpecDepends` 신설 + 단위 테스트 | `domain/mergeDependencies.ts` |
| 3 | 읽기 경로 둘에 병합 적용 (`depends, external_ref` 를 select 에 추가) | `data/wbs.ts`, `repositories/supabase/wbs.ts` |
| 4 | 충족 판정에 `origin` 분기, `specLinkState` 흡수 | `domain/dependencyReadiness.ts` |
| 5 | `DependencyRow` 에 `가져옴` 배지 + remove 감춤 | `RowDetailPanel.tsx` |
| 6 | `WbsSpecLinksPanel`·`getWbsSpecLinks`·`specDependency.ts` 제거, 해당 테스트 정리 | 5파일 |

커밋 분할: (1–2) 도메인 · (3) 읽기 경로 · (4–5) 화면 · (6) 정리.
마이그레이션이 없으므로 G1·G4 무관. `src/components/app/*` 미접촉이라 G2 무관.
**신규 기능이므로 staging 확인 후 main** (관례).

### Stage 2 — claim 게이트가 화면 연결선도 존중 (별건, 미승인)

지금은 사람이 화면에서 그은 선을 에이전트가 무시한다. 고치려면
`claim/route.ts` 가 `depends` 뿐 아니라 `task_dependencies` 의 선행도 읽어야 한다.

**Stage 1 이 선행 조건이 아니다** — 독립적으로 할 수 있다. 다만 순서를 지키는 게 낫다:
Stage 1 로 화면에서 두 축이 한 줄에 서면, Stage 2 가 무엇을 막게 되는지 눈으로 먼저 확인된다.

범위: `loadDependsInfo` 에 uuid 선행 조회 추가, 409 응답의 `depends_evidence` 계약 확장,
스킬 쪽(`dflow-*`) 이 그 응답을 어떻게 읽는지 점검. **이 문서는 여기까지 설계하지 않는다.**

---

## 4. 검증

| 대상 | 검사 |
|---|---|
| `mergeSpecDepends` | ref 해석 성공/실패, 실제 행 우선 중복 제거, 자기참조 제거, 순환 보존, 빈 `depends` |
| 읽기 경로 | 병합 결과가 `origin` 을 정확히 달고 나오는지 (액션 테스트, mutation 검증) |
| 충족 판정 | `spec` 행은 stage 로, `manual` 행은 실적으로 판정되는지 |
| 간트 | 합성 의존성이 연결선·크리티컬 패스에 반영되는지 (`DependencyOverlay`, `WbsGanttSheet.tsx:1941`) |
| 간트 (음성) | 날짜 없는 쌍은 선을 **안 그리고도** 목록·배지에는 나오는지 |
| 화면 | `spec` 행에 remove 버튼이 **없고** `manual` 행엔 있는지 |
| 회귀 | `dependencies` prop 을 쓰는 기존 테스트 전부 |

읽기 실패는 기존대로 **던진다** — `getComputedWbs` 는 조회 실패를 "의존성 없음"으로 위장하지
않는다(`data/wbs.ts:37,44-46`). 병합 단계가 그 계약을 약화시키지 않는지 확인할 것.

---

## 5. 위험

| 위험 | 크기 | 대응 |
|---|---|---|
| import 데이터에 순환이 있으면 크리티컬 패스가 비고 `cycleTaskIds` 에 몰린다 | 하 | 도메인이 처리하고 화면도 이미 대응한다 — 순환 연결선은 `--color-delayed` 와 전용 마커로 그린다(`WbsGanttSheet.tsx:2018-2020`). 추가 작업 없음 |
| 병합으로 의존성 개수가 급증해 간트가 느려진다 | 하 | 실측 못 함(아래). 스테이징에서 눈으로 |
| 실제 데이터 규모를 모른다 | — | anon 은 RLS 에 막히고 service_role 키는 자리표시자다. 스테이징 화면에서 확인하는 게 유일한 경로 |
| `spec` 행 판정과 claim 게이트가 `order_approved` 만큼 어긋난다 | 중 | 2-5 에 기록. 별건 |

---

## 부록 — 조사 근거

- `supabase/migrations/0029_task_dependencies.sql:12-27` 스키마, `:37-107` 트리거 둘
- `src/app/api/v1/agent/work/[id]/claim/route.ts:59-66,98` 게이트와 409
- `src/lib/agent/depends.ts:5-11` `order_approved` 축, `:26-31` fail-closed 조회
- `src/lib/agent/wbsImport.ts:96-101` `parseSchedule` 널 허용, `:162,167`
- `src/lib/domain/dependencySchedule.ts:121-153,199-204` 도메인의 관용
- `src/lib/data/wbs.ts:26-46,86` / `src/lib/repositories/supabase/wbs.ts:140,153` 읽기 경로 둘
- `src/lib/ai/tools/wbs.ts:347,374` AI 봇 소비
- SQL 전용 독자 부재: `rg task_dependencies supabase/` → 0053 RLS 정책뿐
