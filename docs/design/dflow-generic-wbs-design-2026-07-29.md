# D'Flow 범용화 설계 — 가변 깊이 WBS + 프로젝트 설정 계층 (P1+P2)

작성 2026-07-29 · 상태 **설계 확정 대기** · 구현 미착수

> 이 문서는 D'Flow 를 "D-CUBE 전용"에서 "성격이 다양한 여러 프로젝트를 담는 도구"로 바꾸기 위한
> 첫 번째 스펙이다. 대상은 **WBS 코어의 가변 깊이화(P1)** 와 **그것을 담을 프로젝트 설정 계층(P2)**.
> 나머지(메뉴 on/off·주간보고 범용화·브랜드 제거·전역 축 프로젝트화·로케일/근무제도)는 §11 로드맵에 남긴다.
>
> **먼저 읽을 것:** §10 은 감사가 파일을 직접 열어 확인한 함정 20건이다. 그중 **§10.11 은 이 스펙과
> 무관하게 지금 고쳐야 한다** — 마이그레이션 적용 스크립트 8개가 D-CUBE 운영 DB 를 직접 겨냥한다.

---

## 0. 요약

**질문:** 매 프로젝트마다 WBS 양식이 다른데, 프로그램이 양식을 통일해야 하는가?

**답:** 아니다. **모델을 통일하고 양식은 흡수한다.** 지금 문제는 "통일이 안 된 것"이 아니라
**"D-CUBE 의 양식이 모델 자리에 앉아 있는 것"** 이다.

전수 감사 결과 이 진단이 코드로 확인되었다.

- **계산 코어는 이미 완전히 깊이 무관하다.** `rollup.ts`·`progress.ts`·`dashboard.ts`·`kanban.ts`·
  `permissions.ts`·`riskSignals.ts`·`trend.ts`·`dependencySchedule.ts` 에 `'phase'`/`'task'`/`'activity'`
  리터럴이 **단 한 건도 없다.** 롤업·리프 판정·권한이 전부 `children.length === 0` 으로만 갈린다
  (`rollup.ts:35`, `tree.ts:39-47`, `permissions.ts:13`).
- **DB 권한 계층도 이미 깊이 무관하다.** `0022_leaf_actual_rls.sql:57` 이 RLS 를
  `level='activity'` → `public.wbs_is_leaf(id)` 로 이미 옮겼다. `0002_rls.sql:41,48` 의
  `level='activity'` 두 줄은 사문이다.
- **저장/조회 계층도 무관하다.** 리포 전체에서 `level` 로 필터·정렬하는 쿼리가 **0건**이고
  (`.eq('level', ...)` 검색 결과 없음), `import_wbs` RPC 는 `level` 을 pass-through 한다
  (`0006_import_wbs_rpc.sql:33`).

즉 3단을 실제로 붙잡고 있는 것은 **DB CHECK 제약 1줄 + 엑셀 3열 양식 + 룩업 테이블 4개 +
UI 3분기 스타일**뿐이다. 모델이 아니라 표층이다.

**규모 판정 — 두 결합을 반드시 분리해서 볼 것.**
`src/lib/domain/**` 전체에서 세 리터럴이 등장하는 곳은 **3곳뿐**이다
(`permissions.ts:8` 주석, `tree.ts:27`, `types.ts:1`).

| 결합 | 규모 | 근거 |
|---|---|---|
| **레벨 유니언 + DB CHECK** | **소(small)** | 계산 코어 참조 0건. 타입 넓히기 + CHECK drop 이면 끝 |
| **엑셀 B/C/D 3열 양식** | **대(large)** | `parse`·`export`·`validate` 세 곳이 같은 가정을 공유하는 라운드트립 계약 |

이 둘을 하나로 묶어 "레벨 축은 large" 로 보면 **분할 가능성이 안 보인다.**
실제로는 *레벨은 지금 풀고, 엑셀 양식은 뒤에 따로* 갈 수 있다 — §11 의 단계 구분이 이 판정에서 나왔다.

> **가장 중요한 발견:** `actions/wbs.ts:238` 주석이 깊이 제한의 근거를 자백한다 —
> *"1단계만 허용(SUB-ACT 아래엔 불가) — **엑셀 3단(Phase/Task/Activity) 형식을 유지하기 위함**"*.
> 계산 모델이 아니라 **출력 양식이 데이터 구조를 제한하고 있다.** 이 문서는 그 인과를 뒤집는다.

---

## 1. 배경과 결정 이력

### 1.1 확정된 전제 (사용자 결정)

| # | 결정 | 근거 |
|---|---|---|
| A | **인스턴스 복제 방식이 아니다.** 하나의 D'Flow 가 성격이 다른 여러 프로젝트를 담는다 | 사용자 결정 2026-07-29 |
| B | **매 프로젝트마다 WBS 등의 양식이 정해져 있지 않고 다양하다** | 사용자 결정 2026-07-29 |
| C | **레벨 깊이가 가변이어야 한다** (라벨만 바꾸는 것으로 부족) | 사용자 결정 2026-07-29 |
| D | **엑셀 임포트는 자동 감지 + 사람 확인 마법사** — 열=계층 방식과 아웃라인 코드 방식을 둘 다 수용 | 사용자 결정 2026-07-29 |
| E | 이번 범위는 **P1(WBS 코어) + P2(설정 계층)**, 구현 없이 설계 문서까지 | 사용자 결정 2026-07-29 |

### 1.2 "모드" 아이디어에 대한 결론

사용자가 제안한 "프로젝트 성격에 따라 모드 변경"은 **프리셋으로 채택하고 분기로는 거부한다.**

- **채택:** 프로젝트 생성 시 유형을 고르면 **설정값이 채워진 채로 생성**된다. 그 후엔 전부 개별 수정 가능.
- **거부:** 코드에 `if (mode === 'pi')` 가 들어가는 형태. 모드가 3개면 테스트 경로가 3배가 되고,
  실제 프로젝트는 **항상 모드 경계에 안 맞는다**(PI 인데 개발 파트가 있는 경우 등).

즉 **모드는 DB 에 사는 상태가 아니라, 생성 시 1회 적용되는 시드다.** 상세는 §7.

---

## 2. 설계 원칙

1. **진실은 하나** — 계층의 진실은 `parent_id` 트리다. `level` 문자열은 진실이 아니다.
2. **양식은 경계에서 흡수** — 엑셀 양식의 다양성은 임포트/익스포트 어댑터에서 끝난다. 도메인까지 들어오지 않는다.
3. **D-CUBE 는 첫 번째 고객일 뿐** — D-CUBE 의 값들은 코드 상수가 아니라 **그 프로젝트의 설정 행**이 된다.
4. **회귀 0** — 각 단계 배포 후 D-CUBE 화면·엑셀·수치가 **동일**해야 한다. 이것이 유일한 합격 기준.
5. **되돌릴 수 있는 단위로 자른다** — 각 단계가 독립 배포 가능하고 각자 롤백 좌표를 갖는다.

---

## 3. 무엇을 통일하고 무엇을 통일하지 않는가

감사 결과를 두 통에 나눈 결과다. 이 표가 이 문서 전체의 뼈대다.

### 3.1 [모델] 통일한다 — 프로젝트마다 달라지면 프로그램의 절반이 조건부 분기가 된다

| 모델 요소 | 근거 | 판정 |
|---|---|---|
| 가중치 트리 + 리프 실적% 롤업 | `rollup.ts:29-55` — `level` 참조 0건, 리프는 `children.length===0` | **깊이 무관 · 유지** |
| 기간 기반 계획%, 달성율, 상태 판정 | `progress.ts` 40줄 전체에 `level` 참조 0건 | **깊이 무관 · 유지** |
| 대시보드 지표 전량 | `dashboard.ts` 270줄에 `level` 참조 0건. 매트릭스 행=루트, 셀=리프 | **깊이 무관 · 유지** |
| 실적% 편집 권한 | `permissions.ts:13` + RLS `wbs_is_leaf` (`0022:57`) | **깊이 무관 · 유지** |
| 칸반 컬럼 매핑 | `kanban.ts:37` `groupByPhase` = 루트 1개당 컬럼 1개. 이름만 Phase | **깊이 무관 · 유지** |
| 담당 팀 축 | 0044 팀 마스터로 이미 런타임화 (CHECK drop 완료) | **이미 일반화됨 · 선례** |
| `actual_pct 0~100`, `weight null=균등`, `deliverable 자유텍스트` | `0001_init.sql:37`, `rollup.ts:36` | **범용 EVM 모델 · 유지** |
| 임포트 논리 계약 (`import_wbs` RPC) | `0006:29` — 엑셀 열 위치를 전혀 모르는 논리 필드 계약 | **이미 올바른 층 · 유지** |

### 3.2 [양식] 통일하지 않는다 — 지금 D-CUBE 값이 박혀 있다

| 항목 | 위치 | 이번 스펙 |
|---|---|---|
| 레벨 개수·이름 | `0001_init.sql:28` CHECK, `types.ts:1` 유니언 | **P1 포함** |
| 분류축 `biz` | `0001_init.sql:32` | **P1 포함** |
| 엑셀 임포트 양식 | `parse.ts` 전반 | **P1 포함** |
| 엑셀 익스포트 양식 | `export.ts:64` | **P1 포함** |
| 마일스톤 키워드 | `dashboard.ts:62` | **P2 포함** |
| 주간보고 10구분 | `weeklySheet.ts:19` | **P4로 이월** (자리만 확보) |
| PPT 템플릿·브랜드 | `report/assets/weekly-template.pptx` | **P4로 이월** (§10 리스크로 명기) |
| 메뉴 구성 | `Sidebar.tsx:40` 외 3벌 | **P3으로 이월** |
| 팀·회의록 폴더·권한의 전역성 | `teams`, `minute_folders`, `memberships` | **P6로 이월** (§9 한계로 명기) |

### 3.3 [경계] 판정이 갈린 항목

| 항목 | 왜 애매한가 | 이 문서의 결정 |
|---|---|---|
| `deliverable`(산출물) | SI/컨설팅형엔 강하게 맞고 운영형엔 덜 맞다 | **모델로 유지.** nullable 자유 텍스트라 성격이 달라도 깨지지 않는다(빈칸이면 `-`). |
| sub-activity(담당별 분리) | 계산상 필요는 없으나 팀별 실적 원장이 여기 산다 | **모델로 유지하되 레벨이 아닌 플래그로 재정의.** §5 |
| `weight`(가중치) | '가중치'는 양식 어휘 | **개념은 모델, 라벨만 양식.** 라벨을 설정으로. |
| `code`(항목 코드) | 지금은 이름에서 파생(`parse.ts:100`)이라 쓰레기가 섞임 | **모델로 승격.** 별도 열로 받고 없으면 자동 채번. §6.4 |

---

## 4. P1-1 — 레벨 모델: `level` 폐기, `depth` 파생

### 4.1 결정

**`wbs_items.level` 을 판정 근거에서 제거하고, 깊이는 `parent_id` 트리에서 파생한다.**

대안 검토:

| 안 | 내용 | 기각 사유 |
|---|---|---|
| (a) `level` 을 자유 텍스트 "레벨 키"로 유지 | CHECK 만 제거 | 항목을 다른 부모로 옮기면 `level` 이 실제 깊이와 **드리프트**한다. 진실이 둘이 된다. |
| (b) `depth int` 컬럼 신설 + 저장 | 명시적 | (a)와 같은 드리프트 문제. 재부모화마다 서브트리 전체 UPDATE 필요. |
| **(c) `depth` 를 트리에서 파생 (채택)** | 저장하지 않음 | 진실이 `parent_id` 하나. 이동해도 자동으로 맞다. `report/weekly.ts:482` 가 이미 이 방식으로 들여쓰기를 계산 중 — **선례가 코드 안에 있다.** |

### 4.2 스키마 변경

```sql
-- 마이그레이션 (코드와 분리된 별도 커밋 — CLAUDE.md G1)
alter table wbs_items drop constraint if exists wbs_items_level_check;
alter table wbs_items alter column level drop not null;
comment on column wbs_items.level is
  'DEPRECATED — 깊이의 진실은 parent_id 트리다. 하위호환 표시용으로만 남긴다. 신규 코드는 읽지 않는다.';
```

**컬럼을 즉시 drop 하지 않는다.** 되돌릴 수 있는 지점을 확보하기 위해 3단계에 걸쳐 없앤다:
CHECK 제거 → 코드가 안 읽게 만듦 → (검증 후 별도 마이그레이션에서) drop column.

`_rollback.sql` 은 CHECK 를 재부착한다. 단 **롤백 시점에 3값 밖 데이터가 있으면 실패**하므로,
롤백 스크립트는 먼저 `select distinct level from wbs_items` 로 위반 행을 리포트하고 중단한다
(조용히 데이터를 고치지 않는다).

### 4.3 타입 변경 — 넓히기를 **가장 먼저** 한다

```ts
// src/lib/domain/types.ts
/** DEPRECATED — 깊이 판정에 쓰지 않는다. 프로젝트별 레벨 라벨은 ProjectConfig.levelLabels. */
export type Level = string
```

감사가 지적한 대로 이것을 **1번 커밋으로 먼저** 하면 `Record<Level, X>` 룩업 4곳이
**타입 에러로 전부 드러난다** — 누락 없이 잡히는 가장 싼 방법이다. 그리고 이 전환 경로는
**같은 파일에 선례가 있다**: `types.ts:2` 의 `TeamCode` 가 0044 때 정확히 이 길을 갔다
(*"런타임 기준은 DB 마스터, 컴파일 타임 유니언 금지"*).

### 4.4 교체 대상 — 감사가 확정한 전수 목록

| 파일:라인 | 현재 | 변경 |
|---|---|---|
| `components/wbs/RowDetailPanel.tsx:27` | `CHILD_LEVEL: Record<Level, Level\|null>` — 자식 추가 버튼(110)·placeholder(445) 결정 | `depth + 1 < maxDepth` 판정 + `levelLabels[depth+1]` |
| `components/wbs/shared.tsx:23` | `LEVEL: Record<Level,{label,cls}>` — 미정의 레벨이면 `l.cls` 에서 **런타임 TypeError** | `depth` 기반 배지 + 라벨은 설정에서 |
| `lib/report/weekly.ts:254` | `LEVEL_LABEL` — 미정의 레벨이면 엑셀 'Lv' 열에 **조용한 빈칸** | `levelLabels[depth] ?? depth+1단` |
| `lib/ai/analytics.ts:18` | `LEVEL_KO` — 미정의 레벨이면 RAG 색인에 `'구분 undefined'` 임베딩 | 설정 라벨 주입 |
| `lib/domain/tree.ts:27` | `parent?.level === 'activity'` 일 때만 팀 순서 정렬 — **트리 모듈의 유일한 level 참조** | `child.isOwnerSplit` 플래그 (§5) |
| `components/wbs/WbsGanttSheet.tsx:981` | 행 배경 3분기 (`phase`/`task`/else) | `depth` 기반 틴트. 들여쓰기는 이미 `depth*14`(972·1054) 라 선례 있음 |
| `WbsGanttSheet.tsx:72` | `splitParentIds` — 접기 대상이 '자식 있는 activity' 뿐. 351행 *"phase/task 는 항상 펼친 채 고정"* | '자식 있는 모든 노드' 또는 `depth >= N` |
| `WbsGanttSheet.tsx:625` | 루트 추가가 `addWbsItem(projectId, null, 'phase', ...)` 리터럴 | `null` 부모 = depth 0 |
| `actions/wbs.ts:252,258,284` | `addSubAct` 의 3중 레벨 가드 | §5 로 재정의 |
| `excel/validate.ts:29-36` | `lastPhase`/`lastTask` 2단 스택 | 레벨 스택 **배열**로 일반화 |
| `lib/ai/chat/orchestrator.ts:146` | `DISPLAY_ENUMS` 에 `'activity'` 누락 — **현존 버그**, 지금도 사용자에게 원문 노출 | 설정 라벨로 대체하며 동시 수정 |

### 4.5 3단을 실제로 '검증'하는 테스트 7개

`tests/` 전체의 레벨 리터럴은 **144건 / 54개 파일**이나 대다수는 단순 fixture 라 §4.3 의
타입 넓히기만으로 통과한다. **실제로 3단 구조를 검증하는 것은 아래 7개뿐**이므로 여기만 N단 fixture 를 추가한다.

`tests/excel/parse.test.ts:27` · `export.test.ts:35,57` · `edgecases.test.ts:43` ·
`split.test.ts:57` · `tests/domain/tree.test.ts:36-44` · `tests/report/weekly.test.ts:104` ·
`tests/ui/wbs-initial-collapsed.test.tsx:28-29`

반대로 `tests/domain/permissions.test.ts:33` 은 *'자식이 있으면 불가 — level 무관'* 을 검증하므로
**이 전환의 우군**이다. 회귀 감시용으로 유지한다.

---

## 5. P1-2 — sub-activity: 레벨이 아니라 플래그로

### 5.1 문제

현재 sub-activity(담당별 자동 분리)는 **4단째에 있으면서 3번째 레벨 이름을 재사용**한다
(`validate.ts:74` 가 `level:'activity'` 로 생성). 그리고 깊이가 1단으로 제한되는데,
그 근거가 계산이 아니라 **엑셀 양식**이다(`actions/wbs.ts:238`, `validate.ts:59-60`).

더 나쁜 것은 **sub-act 판별이 이름 문자열에 의존**한다는 점이다. 생성 이름이
`{원본명} ({팀} 주관/지원)` 이고, 0014 마이그레이션이 이 이름을 **문자열 치환으로 개명**한 전례가 있다
(`'(DT 주관)'` → `'(가공 주관)'`). 즉 이 라벨은 사실상 스키마 노릇을 하고 있다.

### 5.2 결정

**`wbs_items.is_owner_split boolean not null default false` 를 추가하고,
sub-act 판별을 레벨·이름에서 플래그로 옮긴다.**

```sql
alter table wbs_items add column if not exists is_owner_split boolean not null default false;

-- 백필: 부모가 activity 인 activity = 기존 sub-act
update wbs_items c set is_owner_split = true
from wbs_items p
where c.parent_id = p.id and c.level = 'activity' and p.level = 'activity';
```

백필 결과는 적용 전 `select count(*)` 로 예상 건수를 확인하고, 적용 후 동일 건수를 대조한다.

효과:

- `tree.ts:27` 의 유일한 `level` 참조가 `child.isOwnerSplit` 으로 바뀐다
- `WbsGanttSheet.tsx:344` 의 `subActLabels` 이 이름 접두 파싱을 그만둔다
- **깊이 1단 제한이 근거를 잃고 사라진다** — 사용자 레벨이 몇 단이든 그 리프 밑에 붙는다
- 익스포트가 sub-act 를 접을지 펼칠지 **선택할 수 있게 된다**(§6.3)

### 5.3 정렬 순서

`tree.ts:7` 의 `SUB_ACT_TEAM_ORDER = { PMO:0, ERP:1, MES:2, 가공:3, MDM:4 }` 는
순수 도메인 모듈에 D-CUBE 팀 코드가 박힌 것이다. 타사에서는 전 항목이 동일 순위로 떨어져
`sortOrder` 순으로만 정렬된다(동작은 하나 의도한 순서가 아니다).

→ **정렬 순서를 인자로 받는다.** 호출부가 팀 마스터의 `sort_order` 를 주입한다.
`teamOrderMap(activeCodes(teams))` 가 이미 `domain/teams.ts:33` 에 있으므로 그걸 쓴다.

---

## 6. P1-3 — 엑셀: 임포트 마법사

### 6.1 현재 상태 — 조용한 오파싱

감사가 확인한 실패 모드다. 전부 **에러 없이 통과**한다는 점이 공통이다.

| 지점 | 현재 동작 | 결과 |
|---|---|---|
| `parse.ts:81,115` | 시트를 이름으로 직접 집음(`Sheets['WBS']`, `Sheets['Holiday']`) | 시트명이 다르면 `aoa=[]` → `rows=[]` → 라우트가 **`{ok:true, count:0}`** 반환. **CLAUDE.md 의 "조회 실패를 데이터 없음으로 위장하지 않는다" 원칙 정면 위반** |
| `parse.ts:19` `LEGACY_COLUMN_MAP` | 헤더 인식 실패 시 **거부가 아니라 'D-CUBE 5팀 양식이라 가정'** | 타사 파일은 `Activity`/`산출물` 헤더가 없어 거의 항상 이 폴백을 타고, 11~16번 열을 산출물/일정/가중치/실적으로 **오독한 채 조용히 임포트** |
| `parse.ts:89` | 데이터 시작이 `i = 3` 하드코딩 | 헤더가 1~2행인 파일은 첫 행들이 유실 |
| `parse.ts:103` | `biz = r[0]` — 헤더를 보지도 않고 A열 | A열에 번호·비고가 오면 `biz` 에 쓰레기 |
| `parse.ts:100` | `code = name.split(/[.\s]/)[0]` | 번호 없는 WBS면 첫 단어가 code 가 된다. 실물 백업에 `code:'요구사항'`, `code:'현황'` 으로 남아 있음 (`docs/backups/deleted-project-계량대재구축-2026-07-12.json`) |
| `parse.ts:72` | 담당 마크가 `●`/`△` 유니코드 완전일치 | `O`/`X`/`◎`/`R`·`A`/담당자명 → **빈 owners 로 조용히 통과**. 팀 배지 없음 + 팀 편집자 실적 입력 불가 |
| `parse.ts:27` | 헤더 라벨 완전일치 (`'Activity'`,`'산출물'`,`'시작'`,`'종료'`,`'가중치'`,`'실적%'`) | `완료율`·`Progress`·`담당부서`·`Deliverable` 전부 인식 실패 |
| `api/import/route.ts:38` | 임포트가 **insert 전용** — 기존 트리를 지우지 않음 | 타사 파일을 '시험 삼아' 올리면 **운영 트리에 통째로 덧붙고 롤백 수단이 없다** |

### 6.2 설계 — 2단계 마법사

사용자 결정 D 에 따라 열=계층 방식과 아웃라인 코드 방식을 **둘 다** 받는다.

```
1단계  파일 업로드
       └→ 서버가 파싱해 구조 요약 + 미리보기 10행 반환 (DB 무접촉)

2단계  감지 결과 확인·수정
       ├ 계층 표현 방식   ◉ 열=계층(B~E 4열 감지)   ○ 아웃라인 코드(C열)
       ├ 논리 열 매핑     담당→F  산출물→G  시작→H  종료→I  가중치→없음  실적%→K
       ├ 레벨 라벨        1단[단계] 2단[업무] 3단[작업] 4단[세부]
       ├ 담당 마크 사전   ●=주관  △=지원
       └ 임포트 모드      ◉ 추가(append)   ○ 교체(replace) ⚠ 확인 필요
                                                        [ 임포트 실행 ]
```

**파일은 서버에 임시 저장하지 않는다.** 클라이언트가 원본을 메모리에 들고 있다가 2단계에서
확정 매핑과 함께 재전송한다. 임시 저장소·정리 배치·고아 파일 문제가 통째로 사라진다.

### 6.3 감지 규칙

| 대상 | 규칙 |
|---|---|
| 헤더 행 | 앵커 라벨 후보 사전으로 각 행을 스코어링해 최고점 행을 헤더로. 동점·저점이면 사용자에게 질문 |
| 열=계층 | 연속한 텍스트 열 중 **"한 행에 최대 하나만 채워지는"** 열 집합을 찾는다. 이 성질이 계층 열의 정의다 |
| 아웃라인 코드 | `^\d+([.\-]\d+)*$` 패턴이 지배적인 열. 깊이 = 구분자 개수 + 1 |
| 논리 열 | 별칭 사전 (`담당`\|`Owner`\|`담당부서`, `산출물`\|`Deliverable`\|`결과물`, `실적%`\|`진척률`\|`완료율`\|`Progress` …) |
| 담당 마크 | 마크 사전 + **팀명 직접 기재**도 허용 (`ERP`, `개발팀` 등이 셀에 그대로 있는 흔한 양식) |

**`LEGACY_COLUMN_MAP` 폴백은 삭제한다.** 감지 실패는 이제 **사람에게 물을 화면이 있으므로**
조용히 D-CUBE 배치로 되돌아갈 이유가 없다. 시트 부재도 명시적 에러로 바꾼다.

### 6.4 `code` 를 모델로 승격

이름 파싱(`parse.ts:100`)을 폐기하고 **별도 '코드' 열을 옵션으로 받는다.** 열이 없으면
트리 위치 기반으로 자동 채번(`1`, `1.1`, `1.1.2`). `code` 는 UI 표시·봇 인용·딥링크 라벨에
쓰이므로 쓰레기가 하류 전체로 퍼진다.

### 6.5 익스포트

익스포트는 임포트와 **같은 프로파일에서 헤더를 생성**한다(라운드트립 계약).

`export.ts:23` 의 `flatten` 이 sub-act 를 부모 행으로 접는 것은 주석이 스스로
*'의도된 손실'* 이라 자인한 동작이다 — 팀별 실적 편차·개별 일정/가중치가 소실되고
재임포트 시 롤업 평균이 모든 sub-act 에 승계된다. **깊이 제한이 사라지면 이 손실도 해소된다.**

→ **익스포트에 'sub-act 펼침' 옵션을 추가**하고 기본값을 펼침으로 한다. 접기는 구양식 호환용으로만 남긴다.

### 6.6 임포트 모드

`append` / `replace` 를 **명시 선택**으로 만든다. 현재는 append 전용이고
*"엑셀 개정판 반영 = 프로젝트 유지 + `wbs_items` 삭제 후 재임포트"* 가 **사람이 손으로 하는
운영 레시피**로 굳어 있다. `replace` 선택 시:

1. 확인 다이얼로그(삭제될 항목 수 표시)
2. **삭제 전 백업 JSON 자동 생성** — `docs/backups/` 관례가 이미 있다
3. 단일 트랜잭션 내 delete + insert

> ⚠️ `change_logs.wbs_item_id` 가 `on delete cascade` 이므로 replace 는 변경 이력을 함께 지운다.
> 백업 JSON 에 이력을 포함할지 여부는 구현 시 결정 필요.

---

## 7. P2 — 프로젝트 설정 계층

### 7.1 현재 표면적 — 6개뿐

감사 결과 `projects` 테이블은 `id/name/start_date/end_date/created_at` + `description`(0003) +
`base_date`(0005) 가 전부이고, **설정성 컬럼은 0건**이다. 전 마이그레이션(0001~0050)에서
`alter table projects` 는 이 둘뿐이다.

관리자가 화면에서 실제로 바꿀 수 있는 값도 정확히 6개다 — 이름·설명·시작일·종료일·기준일·공휴일.
나머지 카드는 **동작 트리거**(임포트/익스포트/재색인)이거나 읽기 전용이다.

그리고 `createProject`(`actions/project.ts:22`)는 **insert 한 줄이 전부**로, 폴더·팀·주간보고
스켈레톤 어느 것도 시드하지 않는다. 새 프로젝트는 이름과 날짜만 있는 빈 껍데기다.

> 이 '시드 없음'이 **오히려 유리하다** — 생성 시 설정 프로파일을 적용하는 훅을 새로 넣어도
> 충돌할 기존 시드 로직이 없다.

### 7.2 결정 — `project_settings` 별도 테이블

`projects.settings jsonb` 컬럼이 아니라 **별도 테이블**로 한다.

- RLS 를 따로 걸 수 있다 (읽기는 전원, 쓰기는 관리자)
- `projects` 는 목록 조회에서 자주 읽히는데 설정 덩어리를 항상 끌고 다니지 않는다
- **행이 없음 = 전체 기본값** 이라는 계약이 자연스럽다 (fail-safe)

```sql
create table if not exists project_settings (
  project_id uuid primary key references projects(id) on delete cascade,

  -- WBS 구조
  level_labels    text[]  not null default array['Phase','Task','Activity'],
  max_depth       int,                    -- null = 무제한
  extra_axis_label text,                  -- null = 분류축(현 biz) 사용 안 함

  -- 판정 어휘
  milestone_keywords text[] not null default array[]::text[],

  -- 엑셀 양식 프로파일(임포트/익스포트 공용)
  excel_profile   jsonb   not null default '{}'::jsonb,

  -- P3/P4/P7 을 위한 자리 — 이번 스펙에서는 읽지 않는다
  enabled_modules text[],                 -- null = 전체 활성
  weekly_sections text[],                 -- null = 코드 기본값
  working_days    int[],                  -- null = 월~금. ISO 요일(1=월 … 7=일). §10.12
  timezone        text,                   -- null = 'Asia/Seoul'. §10.11

  preset_applied  text,                   -- 생성 시 적용한 프리셋 이름(표시용)
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id)
);
```

`enabled_modules`·`weekly_sections`·`working_days`·`timezone` 은 **자리만 만들고 이번 스펙에서는
읽지 않는다.** P3/P4/P7 이 스키마 마이그레이션 없이 시작할 수 있게 하기 위함이다.

### 7.3 소비 방식 — 전역 캐시가 아니라 주입

`lib/teams/master.ts` 는 프로세스 전역 싱글톤 캐시다. **프로젝트 설정에는 이 패턴을 쓰지 않는다** —
프로젝트마다 값이 다르므로 키 있는 캐시가 되고, 그러면 무효화 버그가 따라온다.

대신 **주입(injection)** 을 쓴다. 이미 리포에 정착한 패턴이다(팀 목록을 순수 함수 인자로 넘기는 방식).

```ts
// src/lib/data/projectConfig.ts (신규)
export interface ProjectConfig {
  levelLabels: string[]
  maxDepth: number | null
  extraAxisLabel: string | null
  milestoneKeywords: string[]
  excelProfile: ExcelProfile
}
export async function getProjectConfig(projectId: string): Promise<ProjectConfig>
```

- 서버 컴포넌트는 이미 프로젝트를 로드하므로 같은 `Promise.all` 에 합류시킨다
- 클라이언트는 `TeamsProvider` 와 같은 방식의 `ProjectConfigProvider` 로 받는다
- 순수 도메인 함수는 필요한 조각만 인자로 받는다 (`detectMilestones(leaves, keywords)`)

**조회 실패 시 기본값으로 위장하지 않는다.** 행이 없으면 기본값(정상), 조회 자체가 실패하면
에러를 던진다 — CLAUDE.md 에러 처리 3원칙.

### 7.4 마일스톤 키워드

`dashboard.ts:62` 의 `MILESTONE_KEYWORDS` 를 설정으로 옮긴다.

> ⚠️ **빈 배열은 안전한 기본값이 아니다.** `isMilestoneLeaf`(`dashboard.ts:70-74`)의 두 번째 규칙은
> `단일일자 **AND** 산출물 기재`를 동시에 요구한다. WBS 항목 대부분은 기간을 가지므로, 키워드를 비우면
> `detectMilestones` 가 `{name: null, signal: 'neutral'}` 로 **조용히 비고**, `ai/tools/dashboard.ts:96`
> (봇 마일스톤 도구)도 함께 빈다. 크래시가 없다는 것과 기능이 남는다는 것은 다르다.
> → **신규 프로젝트 생성 시 프리셋이 키워드를 반드시 채운다.** 빈 배열은 사용자가 명시적으로 비운 경우만.

> ⚠️ 함정 2: `isMilestoneLeaf` 가 `name.toLowerCase()` 후 비교하므로 **주입 키워드도 소문자로 정규화**해야 한다.
> (현 상수에 `'bmt'`, `'kick-off'` 가 소문자로 들어 있는 이유가 이것이다.)

> ⚠️ 함정 3: 부분문자열 매칭이라 현 키워드 `'승인'` 은 **지금도** `"설계 승인 요청"` 같은 일반 작업을
> 마일스톤으로 승격시킨다. 설정화하면서 완전 일치/부분 일치를 선택할 수 있게 할지 검토 대상(Q6).

### 7.5 D-CUBE 프로젝트 설정 행 — 회귀 0의 핵심

마이그레이션에서 **D-CUBE 프로젝트에 현 동작을 그대로 재현하는 행**을 넣는다.

| 필드 | 값 |
|---|---|
| `level_labels` | `{Phase, Task, Activity}` |
| `max_depth` | `3` (sub-act 는 플래그라 깊이에 포함하지 않음) |
| `extra_axis_label` | `'Biz'` |
| `milestone_keywords` | 현 `MILESTONE_KEYWORDS` 10개 그대로 |
| `excel_profile` | 현 D-CUBE 3행 헤더 규약을 프로파일로 표현 |
| `weekly_sections` | 현 `WEEKLY_SECTIONS` 10개 (P4 대비 미리 저장) |

**이 행이 있으면 D-CUBE 화면은 한 픽셀도 바뀌지 않아야 한다.** 그것이 §8 검증의 기준이다.

---

## 8. 프리셋 (모드)

### 8.1 형태

프리셋은 **코드 상수**로 정의하고, 프로젝트 **생성 시 1회** `project_settings` 행으로 구체화된다.
DB 에는 `preset_applied` 라는 **표시용 이름만** 남고, 런타임에 프리셋을 다시 읽는 코드는 없다.

```ts
// src/lib/domain/projectPresets.ts (신규, 순수)
export const PRESETS = {
  pi:    { levelLabels: ['Phase','Task','Activity'], maxDepth: 3,    extraAxisLabel: 'Biz', ... },
  swdev: { levelLabels: ['단계','기능','작업'],       maxDepth: 5,    extraAxisLabel: null,  ... },
  blank: { levelLabels: ['1단','2단','3단'],          maxDepth: null, extraAxisLabel: null,  ... },
} as const
```

### 8.2 프리셋이 나쁜 아이디어가 되는 경우 — 반드시 읽을 것

**프리셋 축이 실제 변동 축과 어긋나면 프리셋은 해롭다.**

프리셋은 "프로젝트 성격"(PI냐 시스템개발이냐)으로 축을 잡는다. 그런데 실제로 설정을 가르는 축은
**발주사의 엑셀 양식**, **조직 구조**, **보고 주기**다. 이 둘은 상관은 있어도 일치하지 않는다.
어긋나면 사용자는 프리셋을 고른 뒤 항목을 전부 다시 고치게 되고, 그보다 나쁘게는
**"프리셋을 골랐으니 설정은 끝났다"는 착각**을 얻는다.

완화책 셋:

1. 프리셋을 **되돌릴 수 있는 시드**로 둔다 — 생성 직후 "다른 프리셋으로 다시 적용" 가능
2. 설정 화면에서 각 항목에 **"프리셋 기본값" / "수정됨"** 배지를 표시한다
3. **프리셋 이름을 프로젝트 성격이 아니라 설정 내용으로 짓는다** —
   `'PI 프로젝트'` 보다 `'3단 WBS · 분류축 사용 · 근태 포함'` 이 정직하다

세 번째가 가장 중요하다. 이름이 성격을 주장하는 순간 사용자는 그 이름을 믿는다.

---

## 9. 이 스펙이 풀지 않는 것 (한계)

사용자 결정 A 는 "하나의 인스턴스에 여러 프로젝트"다. **이 스펙을 전부 구현해도 그 목표에는
도달하지 못한다.** 아래 셋이 전역으로 남기 때문이다. 정직하게 명시한다.

| 남는 한계 | 근거 | 증상 |
|---|---|---|
| **팀 마스터가 전역** | `teams` 에 `project_id` 없음. `/admin/teams` 가 *"탭·필터·검증·엑셀·회의록 편철이 모두 이 목록을 따릅니다"* 라 명시 | 두 번째 프로젝트가 다른 팀 체계를 쓰면 **한 목록에 뒤섞인다** |
| **권한이 전역** | `memberships` PK 가 `(user_id)` 단일. `app_role()` 이 프로젝트 인자를 안 받음 | 프로젝트 A 관리자 = **모든 프로젝트 관리자**. 프로젝트별 설정을 만들면 "누가 이걸 바꿀 수 있나"가 즉시 문제가 된다 |
| **회의록 폴더가 전역** | `minute_folders` 에 `project_id` 없음. 루트 이름이 **전역 unique** (`0040:17`) | 두 번째 프로젝트 회의록이 첫 프로젝트 폴더 트리에 섞이고, 같은 이름 폴더를 만들 수 없다 |

셋 다 **P6(전역 축 프로젝트화)** 로 분리한다. 규모는 large — 마이그레이션 + RLS 전면 재작성 +
`item_owners.team_id` FK·`minutes.team_code`·엑셀 파서 열 맵·대시보드 팀 카드·AI 도구까지 재배선이다.

> **순서 권고:** P1+P2 를 먼저 하는 것이 맞다. P6 는 위험이 크고, P1+P2 없이 P6 만 하면
> "여러 프로젝트를 담을 수 있으나 전부 D-CUBE 양식이어야 하는" 상태가 된다.
> 다만 **P6 전까지는 실질적으로 단일 조직 도구**라는 점을 관계자가 알고 있어야 한다.

---

## 10. 코드만 봐서는 안 보이는 함정

감사가 파일을 직접 열어 확인한 것들이다. 구현 전에 전부 읽을 것.

> **심각도 최상 3건은 §10.11 · §10.1 · §10.12 다.** §10.11(스크립트가 D-CUBE 운영 DB 를 직접 겨냥)은
> 이 스펙과 무관하게 **지금 당장** 고쳐야 한다.

### 10.1 🔴 PPT 산출물에 D-CUBE 브랜드가 유출된다 (P4 이지만 심각도상 최우선)

`templateFill.ts` 는 `slide2` 표(graphicFrame) 안 **6개 셀만** 교체하고 zip 나머지를 그대로 내보낸다.
감사가 XML 스팬을 직접 갈라 확인한 결과, 표 **바깥** 텍스트는
`['D-CUBE ','프로젝트 ','주간보고','2','작성자','_D-Cube TF']` 이며 **한 번도 치환되지 않는다.**
게다가 `slide1`(표지, *"동국씨엠 D-Cube TF"*)이 `sldIdLst` 에 그대로 남아 출력물에 실린다.

→ **어느 프로젝트에서 PPT 를 뽑아도 표지와 제목이 '동국씨엠 D-Cube TF' 로 나간다.**
파일명과 표 내용만 프로젝트별로 바뀌므로 **눈으로 열어보기 전엔 안 걸린다.**
템플릿에 실제 회의 내용(`'AWS 엔지니어'`, `'MES Cloud 전환'`, `'MDM 개발 방향성'`)이 샘플로 남아 있어
**사내 문서 유출 측면의 리스크**도 있다.

### 10.2 🔴 `WEEKLY_SECTIONS` 는 표시 순서가 아니라 **쓰기 계약**이다

`ensureStandardRows`(`data/weeklySheet.ts:40`)가 빠진 행을 **DB 에 INSERT** 하고,
`buildSheetSections` 가 PPT 페이지를 강제 생성한다. 즉 다른 프로젝트의 시트에도
`영업`·`구매`·`조업및표준화` 같은 D-CUBE 업무영역 행이 **실제로 박힌다.**

또한 과거 주차 데이터가 이 한글 문자열 그대로 `weekly_report_rows.section`(free text)에 저장돼 있고
`mapLegacySection` 이 매핑 실패분을 `WEEKLY_SECTIONS[0]='PMO'` 로 흡수한다.
→ **구분을 갈아끼우면 기존 시트 전량이 첫 구분으로 빨려 들어간다.** P4 는 구분 마스터화 +
`section` 백필 마이그레이션이 반드시 세트다.

### 10.3 🔴 `teams` 시드 마이그레이션이 없어 신규 인스턴스의 **첫 임포트가 원천 차단**된다

`insert into teams` 는 `0035`(MDM 1건)뿐이고 `0001_init` 은 테이블만 만든다.
`master.ts:44` 가 빈 목록을 에러로 던지지만 `load()` 가 그것을 catch 하고 **`cache` 는
`DEFAULT_TEAMS` 를 그대로 유지**한다(18행 초기값, `everLoaded=false`).

→ **`teams` 가 빈 신규 인스턴스의 "정상 기동 상태"가 D-CUBE 5팀이다.** 예외 상황이 아니라 기본값이다.
그리고 `api/import/route.ts:21` 이 `teamsSync()` 로 엑셀 팀 열을 검증하므로,
**신규 인스턴스는 PMO/ERP/MES/가공/MDM 이외의 팀 열이 있는 파일을 400 으로 거부한다.**
부트스트랩 경로 없이는 첫 임포트가 아예 성립하지 않는다.

→ 임포트 마법사(§6)와 **같은 단계에 팀 부트스트랩**이 필요하다. 마법사가 미등록 팀을 발견하면
"이 팀들을 등록하시겠습니까"로 흘러가는 것이 자연스럽다.

### 10.4 `PROGRESS_TEAMS` 의 MDM 제외가 죽은 폴백으로 살아 있다

`dashboard.ts:193` `PROGRESS_TEAMS = ALL_TEAMS.filter(t => t !== 'MDM')`.
0044 가 `progress_visible` 로 데이터화했는데도 `teamProgress` 의 **기본 인자**로 남아 있고,
`riskSignals.ts:290` 도 `input.teams ?? ALL_TEAMS` 로 쓴다.
→ 주입이 누락된 호출 경로에서는 **D-CUBE 5팀 + MDM 제외가 조용히 적용된다.**
설정 계층을 넣기 전에 이 폴백부터 제거해야 조용한 오작동이 안 생긴다.

### 10.5 `RESERVED_TEAM_NAMES` 가 양식 라벨에서 도메인 검증으로 역류했다

`domain/teams.ts:39` 가 `'Biz','Phase','Task','Activity','담당','산출물',...` 을 팀명 금지어로 쓴다.
양식 라벨을 설정화하면 **이 상수도 그 설정에서 파생**되어야 한다 —
안 그러면 새 양식의 헤더명이 팀명과 충돌해 열 맵이 오염되거나, 반대로 쓰지도 않는 한국어
예약어 때문에 `'담당'` 이라는 팀을 못 만드는 무의미한 제약만 남는다.

### 10.6 메뉴 목록이 UI 5벌 + 봇 6벌 = 11벌 존재하고 이미 드리프트했다

- **UI 5벌**: `Sidebar.tsx:40`(11개) / `HeaderChrome.tsx:268` MobileMenu(10개) /
  `HeaderChrome.tsx:22` `SECTION_LABEL` / `ProjectTabs.tsx:9`(참조 0건 사문) /
  **`chat/verifier.ts:30` 내부 href 화이트리스트**
- **봇 6벌**: `BOT_DOMAINS`(protocol) / `BOT_READ_CAPABILITIES`(types) / `V2_READ_DOMAINS`(router) /
  `DOMAIN_TERMS`(router) / deep-links 빌더 / `inferDomain` switch

확인된 드리프트:

- **`issues` 가 봇에 전혀 배선되지 않았다**(2026-07 추가 메뉴). `inferDomain` 에도 없어
  이슈 페이지에서 봇이 페이지 문맥을 못 읽고 레거시로 폴백한다.
- **모바일 메뉴에 `wiki` 가 없어** lg 미만 사용자는 Wiki 에 도달할 경로가 없다.
- `SECTION_LABEL` 에도 `wiki` 가 없어 브레드크럼이 조용히 축약되고, i18n 을 안 타 영어 로케일에서도 한국어가 나온다.
- ⚠️ **`/gantt` 는 사문이 아니다** — `p/[projectId]/gantt/page.tsx` 는 살아 있는 라우트
  (`/wbs?view=timeline` 리다이렉트)이고 `verifier.ts:30` 이 이를 정식 경로로 인정한다. 삭제 금지.

### 10.7 `router.ts:216` 이 팀 코드를 정규식으로 하드코딩

`teamFrom()` 이 `/(PMO|ERP|MES|가공|MDM)/`. 0044 로 팀이 런타임 마스터가 됐는데 봇 라우터만 5팀 고정.
→ 팀 코드를 바꾸면 **봇의 팀 필터가 전부 무응답**이 된다.

### 10.8 `WbsGanttSheet.tsx` · `HeaderChrome.tsx` 는 UI 위험 파일이다

CLAUDE.md 규칙상 `src/components/app/*` 는 브랜치 + Preview 필수(G2)다.
동시에 **Preview 는 Supabase env 가 0건이라 로그인 뒤 화면을 볼 수 없다** —
즉 G2 는 속도 방지턱이지 검증이 아니다. 이 파일들의 변경은 **배포 후 `npm run smoke:prod` +
육안 확인**이 유일한 검증이다. 계획에 그 시간을 넣어야 한다.

### 10.9 `orchestrator.ts:146` 의 `DISPLAY_ENUMS` 에 `'activity'` 가 없다

현행 3단조차 커버하지 못하는 **현존 버그**. `level` 값이 사용자에게 원문 그대로 노출된다.
N단 전환과 무관하게 지금도 발생 중이므로 이번에 함께 고친다.

### 10.10 `docs/design/dflow-wbs-write-bot-design.md:141-151` 과 충돌한다

그 문서는 `CHILD_LEVEL` 표를 `src/lib/domain/wbsLevel.ts` 로 **승격해 챗봇과 공유**하려는
미구현 계획을 갖고 있다. 이 스펙은 그 표를 **없앤다.**
→ **그 계획보다 이 스펙을 먼저 하는 게 싸다.** 순서가 뒤바뀌면 승격한 표를 다시 걷어내야 한다.

### 10.11 🔴🔴 `scripts/apply-*.mjs` 8개가 **D-CUBE 운영 DB ref 를 하드코딩**한다

`apply-0028` · `0038` · `0039` · `0040` · `0041` · `0042` · `0043` · `0050` 전부:

```js
const PROJECT_REF = 'rglfgrwwwwdqejohdnty'   // env 오버라이드 없음, 확인 프롬프트 없음
// → https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query 로 곧장 DDL 실행
```

**다른 인스턴스에서 마이그레이션을 적용하려고 이 스크립트를 그대로 돌리면, 자기 DB 가 아니라
D-CUBE 운영 DB 에 SQL 이 실행된다.** CLAUDE.md 의 *"운영 D-CUBE 데이터를 훼손하지 않는다"* 와 정면 충돌한다.

→ **이 스펙과 무관하게 지금 즉시 고칠 것.** `PROJECT_REF` 를 필수 env 로 바꾸고, ref 를 화면에 출력한 뒤
명시적 확인을 받게 한다. 두 번째 프로젝트가 생기기 전에 처리해야 한다.

관련: `scripts/mark-good.mjs:71` 이 `https://wbs-web.vercel.app` 를 **오버라이드 없이** 고정한다
(`smoke-prod.mjs:24` 는 `SMOKE_URL` 폴백이 있다). 다른 배포에서 `npm run mark:good` 을 돌리면
D-CUBE 프로덕션의 배포 시각을 조회해 태그 가부를 판정한다.

### 10.12 🔴 주 5일·월~금이 **계획% 계산 코어**에 박혀 있고, 정의가 2벌이다

- `domain/dates.ts:9` — `isBusinessDay` 가 `dow === 0 || dow === 6` 리터럴.
  **`plannedPct`·`plannedCurve`·`shiftBusinessDays`·`computeDependencySchedule` 이 전부 이 한 줄을 탄다.**
- `domain/ganttScale.ts:57` — `isWeekend` 가 **같은 규칙을 2벌째** 정의. 동기화 계약 없음.
- `report/weekly.ts:19` `WEEKDAY_LABELS = ['월','화','수','목','금']`
- `report/excel.ts:146` — 워크로드 헤더가 `월·화·수·목·금` **5열 고정**. 문자열이 아니라 **열 구조**이고
  `weekly.ts:408` 의 `workload[].perDay`(5칸)와 암묵 계약이다. 한쪽만 바꾸면 조용히 어긋난다.
- **주 시작 요일이 축마다 다르다** — `report/week.ts:5` 는 월요일, `domain/attendance.ts:48` 은 일요일.

→ 금·토 휴무 조직이면 **계획%가 통째로 틀린다. 에러 없이.**
이번 스펙에서는 `project_settings.working_days` 자리만 만들고(§7.2), **두 벌 정의를 하나로 모으는 것**까지만 한다.
실제 소비는 P7.

### 10.13 🔴 `docs/backups/` 에 실제 D-CUBE 운영 문서 4건이 커밋돼 있다

- `26.07.02. D-Cube 주간보고_부산운영팀_1_2026-07-07_이돈석.pptx` (479KB) — **실명 포함 실제 보고서**
- `D-CUBE PI Master Plan 수립 WBS ... _Rev1/_Rev2/_Rev3_...이돈석.xlsx` (각 ~99KB) — **실제 WBS 원본 3판**
- `deleted-project-계량대재구축-2026-07-12.json` — 프로젝트 UUID · `"동국씨엠 계량대 재구축"` · WBS 전량

§10.1 의 `weekly-template.pptx` 와 **동급 이상의 유출 리스크**다. 파일명에 실명이 두 번 들어간다.
→ 범용화 이전에 정리 대상. (단 이 파일들은 §6.1 의 `code` 파싱 문제를 실증한 근거이기도 하므로,
삭제 전에 필요한 관찰은 이 문서에 이미 옮겨 두었다.)

### 10.14 🔴 봇 답변이 한국어 고정이고, **환각 검증기가 한국어 전용이라 fail-open** 이다

- 프롬프트가 "한국어로 답한다"를 강제 — `ai/answer.ts:22`, `minutes-answer.ts:11,18`,
  `brief.ts:222,228`, `risk-brief.ts:35`, `chat/orchestrator.ts:283`.
  앱에 en 토글이 있는데 **chat 경로로 locale 을 전달하는 코드가 grep 0건.**
- `chat/verifier.ts:191-197` — `UNIT_NUMBER_RE` 가 한국어 단위(`건|명|개|회|시간|분|일`),
  `KOREAN_DATE_RE` 가 `N월 N일` 로 주장을 추출한다.
  → **답변이 영어면 추출되는 주장이 0건이 되어 검증할 것이 없고 그대로 통과한다.**
  안전장치가 출력 언어에 결합돼 있다. 이것이 fail-open 인 것 자체가 CLAUDE.md 의
  *"보안 가드는 fail-closed"* 원칙 위반이다.
- `ai/intent.ts:19` `QUICK_SUGGESTIONS` 5개가 한국어이고 `classifyIntent` 도 한국어 키워드 매칭 →
  영어 질문은 항상 freeform 으로 떨어진다.
- 검색 정규화 `toLocaleLowerCase('ko-KR')` 20여 곳, `domain/nameSort.ts:10` 은
  `Intl.Collator('ko-KR')` 를 **주석으로 의도적으로 못박았다**(전 화면 명단 정렬의 단일 출처).

→ P7 범위. 다만 **verifier 의 fail-open 은 언어와 무관하게 지금 고칠 가치가 있다.**

### 10.15 `REPORT_TEAMS` 폴백이 죽은 코드가 아니라 **살아 있는 봇 경로**에 있다

`ai/analytics.ts:100` 이 `buildWeeklyReportModel(items, {name}, today, { members })` 로
**`teams` 를 주입하지 않는다.** → `report/weekly.ts:297` 의 `opts.teams ?? REPORT_TEAMS` →
**D-CUBE 5팀 고정.** 이 `analyzeProject` 는 `ai/knowledge.ts:44,53` 이 호출하고,
그것을 `ai/answer.ts:2`(레거시 봇)와 `api/chat/context/route.ts:3` 가 소비한다.

→ **관리자가 새 팀을 추가해도 봇의 팀별 워크로드·미완료 요약에는 나오지 않고, 팀을 비활성화해도 계속 나온다.
에러도 로그도 없다.** §10.4 의 `PROGRESS_TEAMS` 와 같은 성격의 **두 번째 구멍**이다.
단계 2에서 함께 막는다.

### 10.16 한국 공휴일 테이블이 2030년에 만료된다 — 조용한 절벽

`domain/holidays.ts` 의 `VARIABLE` 은 2020~2030 만 수록. **2031년부터는 양력 고정분만 남아
설날·추석·부처님오신날·대체공휴일이 달력에서 소리 없이 사라진다.**
`KR_HOLIDAY_TABLE_YEARS`(152행)를 export 해 두었으나 **이를 읽어 경고하는 코드가 리포 전체 0건**이다.

> 참고: 이 테이블은 **달력 표시 전용**이다. 영업일 계산이 쓰는 휴일은 `data/wbs.ts:27` 의
> `holidays` 테이블(프로젝트별)이고, `holidays.ts:2` 주석이 그 분리를 명시한다.
> 즉 이 만료는 계획% 를 틀리게 하지는 않는다.

### 10.17 `.env.local.example:75` 의 기본값이 D-CUBE 다

`MAIL_FROM_NAME=D-CUBE 회의알림`. 설정 지점이 env 로 이미 빠져 있어도 **예시 파일을 복사한
새 인스턴스는 결과가 같다.** 설정 가능성과 탈결합은 다르다 — 기본값도 중립이어야 한다.

### 10.18 테스트의 D-CUBE 결합 총량이 크다 (공수 산정용)

실측: 팀 리터럴(`PMO|ERP|MES|가공|MDM|D-CUBE`) **877건 / 108개 파일**,
레벨 리터럴 **144건 / 54개 파일**.

대부분은 단순 fixture 라 §4.3 의 타입 넓히기만으로 통과하지만, **총량이 공수 산정을 왜곡하지 않도록**
기록한다. 실제로 3단 구조를 *검증*하는 것은 §4.5 의 7개 파일뿐이다.
정리 대상 고유명사 픽스처: `tests/ai/golden/fixtures.ts:37` 의 `root@dcube.invalid`,
`tests/excel/parse.test.ts:12` 의 `'TFT R&R 확정'`.

### 10.19 `Asia/Seoul` 이 46회 / 35개 파일, 동일한 `seoulToday()` 정의가 15벌

`(app)/layout.tsx:15`, `meetings/page.tsx:12`, `projects/page.tsx:33`, `minutes/page.tsx:14`,
`p/[projectId]/announcements|issues|meetings|weekly/page.tsx`, `attendance/page.tsx:21`(인라인),
`actions/announcements.ts:31`, `AnnouncementsView.tsx:28`, `DashboardView.tsx:24`,
`api/export/route.ts:20`, `api/report/route.ts:28`, `api/minutes/export/route.ts:103`.

'오늘'은 `statusOf`(지연)·`isOverdue`(이슈)·`announcementStatus`(게시)·근태·스냅샷의 유일한 기준이다.
타 타임존 조직에서 하루 경계가 밀리면 **에러 없이** 지연·기한이 틀린다.

→ **단일 함수로 모으는 것이 P7 의 선행 과제**다. 15벌이 흩어져 있으면 설정화 자체가 불가능하다.
이번 스펙에서는 `project_settings.timezone` 자리만 만든다.

### 10.20 역할 축이 둘이다

`memberships.role`(`pmo_admin`/`team_editor`, 전역)과
`project_members.role`(`admin`/`contributor`, `0003_ops.sql:15`, 프로젝트별).
어휘는 중립이라 범용화 부담은 없으나, §9 의 권한 재설계(P6) 때 **두 축을 함께 봐야 한다.**

---

## 11. 이행 경로

각 단계는 독립 배포 가능하고 자체 롤백 좌표를 갖는다.
**CLAUDE.md 규칙: 마이그레이션과 코드는 항상 별도 커밋.**

| 단계 | 내용 | 화면 변화 | 롤백 |
|---|---|---|---|
| **P0** | **§10.11 스크립트 하드코딩 ref 제거** — 이 스펙과 무관하게 선행 | 없음 | revert |
| | └ `scripts/apply-*.mjs` 8개 + `mark-good.mjs`. 두 번째 프로젝트가 생기기 전에 | | |
| **0** | `Level = string` 타입 넓히기 | 없음 | revert 1커밋 |
| | └ 목적: `Record<Level,X>` 4곳을 **타입 에러로 노출**시켜 누락 방지 | | |
| **1** | `project_settings` 테이블 + `getProjectConfig` 로더 + D-CUBE 행 시드 | 없음 (아무도 안 읽음) | `drop table` + `_rollback.sql` |
| **2** | 설정 주입 — 레벨 라벨·분류축·마일스톤 키워드 소비처 교체 | **없어야 함** (값이 현행과 동일) | revert |
| | └ 동시 수정: §10.4 `PROGRESS_TEAMS` + §10.15 `REPORT_TEAMS` 두 구멍, §10.9 `DISPLAY_ENUMS` 버그 | | |
| | └ 동시 정리: §10.12 주말 판정 2벌 → 1벌, §10.19 `seoulToday()` 15벌 → 1벌 (소비는 P7) | | |
| **3** | `level` CHECK 제거 + `is_owner_split` 추가·백필 + depth 파생 전환 | 없어야 함 | `_rollback.sql` (위반 행 있으면 중단) + revert |
| **4** | 임포트 마법사 신설 | **신규 화면.** 기존 임포트 라우트는 **남겨두고 병행** | 화면 숨김 (라우트 유지) |
| **5** | N단 UI — 간트 depth 틴트, 접기 규칙, 자식 추가, 익스포트 펼침 옵션 | 변경 있음 → 브랜치 + 배포 후 육안 검증 (§10.8) | revert |
| **6** | 검증 완료 후 `level` 컬럼 drop, 구 임포트 라우트 제거 | 없음 | — |

### 11.1 검증 기준 — 회귀 0

각 단계 배포 후 D-CUBE 프로젝트에서 아래가 **모두 동일**해야 한다.

- WBS 엑셀 익스포트 — 셀 단위 비교
- 대시보드 KPI 전량 (전체 실적/계획/편차, 팀별 진척, 마일스톤 카드)
- 진척 스냅샷 재계산 결과
- `npm run test` 전량 + `npm run smoke:prod`

단계 5 이후에는 화면 육안 확인이 필수다(§10.8 — 빌드·린트·테스트로 UI 깨짐이 잡히지 않는다).

큰 단계를 마칠 때마다 `npm run mark:good` 으로 좌표를 남긴다.

### 11.2 이후 로드맵 (이 스펙 범위 밖)

| | 내용 | 규모 | 선행 |
|---|---|---|---|
| **P3** | 메뉴/기능 on-off (§10.6 — 11벌 동기화가 실작업) | 중 | P2 |
| **P4** | 주간보고 범용화 + PPT 템플릿 (§10.1·10.2) | 대 | P2 |
| **P5** | 어휘·브랜드 탈-D-CUBE — §10.13 백업 문서, §10.17 env 기본값, §10.16 공휴일 만료 감지 | 소 | 없음 |
| **P6** | 전역 축 프로젝트화 — `teams`·`memberships`(2축, §10.20)·`minute_folders` (§9) | 대 | P1+P2 |
| **P7** | 로케일·근무제도 — 타임존(§10.19), 주 5일(§10.12), 봇 다국어 + verifier fail-open(§10.14) | 중~대 | P2 |

> **우선순위는 규모가 아니라 노출 위험으로 정한다.**
> - **§10.11(스크립트 ref)은 P0** — 지금 고친다.
> - **§10.1(PPT 브랜드 유출) + §10.13(백업 문서)은 P4/P5 규모와 무관하게 두 번째 프로젝트 이전에.**
>   두 번째 프로젝트가 생기는 순간 남의 회사 브랜드와 실명이 찍힌 산출물이 외부로 나간다.
> - **§10.14 의 verifier fail-open 은 다국어와 분리해서** 지금 고칠 수 있다.

---

## 12. 미결 사항

| # | 질문 | 영향 |
|---|---|---|
| Q1 | `replace` 임포트 시 `change_logs` 를 백업 JSON 에 포함할 것인가 (cascade 로 함께 삭제됨) | §6.6 |
| Q2 | `max_depth` 기본값 — 무제한 vs 상한. 무제한이면 간트 들여쓰기가 가로로 넘칠 수 있다 | §7.2, §11 단계 5 |
| Q3 | 아웃라인 코드 방식에서 `code` 열을 그대로 `wbs_items.code` 로 쓸 것인가, 별도 채번할 것인가 | §6.4 |
| Q4 | 담당 마크 사전을 프로젝트 설정에 저장할 것인가, 임포트 1회용으로 둘 것인가 | §6.3 |
| Q5 | 기존 D-CUBE 프로젝트의 `biz` 값을 유지할 것인가 정리할 것인가 — 현재 UI 어디에도 표시되지 않는 그림자 컬럼이다 | §3.2 |
| Q6 | 마일스톤 키워드를 부분 일치로 둘 것인가 완전 일치 옵션을 줄 것인가 — 현 `'승인'` 은 지금도 오탐을 낸다 | §7.4 |
| Q7 | §10.13 백업 문서를 리포에서 삭제할 것인가(git 이력에도 남는다 — 이력까지 지우려면 별도 결정) | §10.13 |

---

## 부록 A — `biz` 컬럼 실측

감사가 전수 확인한 결과다. `biz` 는 **사람이 UI 로 볼 수도 고칠 수도 없는 그림자 컬럼**이다.

- 채워지는 경로: 임포트(`parse.ts:103`), sub-act 승계(`validate.ts:78`)
- 나가는 경로: 익스포트 A열(`export.ts:72`), AI 컨텍스트·색인(`analytics.ts:304,372`,
  `index/content.ts:134`, `tools/wbs.ts:144`), `updateWbsFields`(`actions/wbs.ts:362`)
- **표시되는 곳: 없음.** `WbsGanttSheet` COLS·상세 패널·칸반·대시보드 어디에도 없다.
  `RowDetailPanel:24` 에서 오직 '변경 이력의 필드 라벨'로만 등장하고, `saveFields`(`:160`)는 `biz` 를 보내지 않는다.
- 계산 관여: **0건.** `snapshots.ts:59` 는 아예 `biz: null` 로 하드코딩한다.

그리고 이 단일 컬럼에 **이름이 네 개** 붙어 있다 — `'Biz'`(엑셀/i18n), `'업무 내용'`(봇 `DISPLAY_LABELS`),
`'업무내용'`(임베딩 문서), `'구분'`(지식 색인). 특히 `'구분'` 은 `WEEKLY_SECTIONS`(업무영역 구분)와
이름이 겹쳐 봇 컨텍스트에서 혼동을 유발한다.

→ **의미가 합의된 적 없는 축이다.** 일반화(설정 가능한 분류축)하든 제거하든 계산 계층은 흔들리지 않는다.

---

## 부록 B — 감사 방법

2026-07-29, 2단 감사.

**1단 — 6축 병렬 전수 조사.** WBS 레벨 / `biz`·엑셀 / 주간보고·PPT / 메뉴 의존 그래프 /
어휘·브랜드 / 설정 표면적. 각 발견은 파일을 직접 열어 확인했으며
`kind`(model·format·vocabulary·branding·schema-constraint)와
`cost`(trivial·small·medium·large)로 분류했다.

**2단 — 누락 탐색 및 반박.** 1단이 다루지 않은 영역(`scripts/`, `docs/backups/`, 타임존,
근무제도, 봇 다국어, 테스트 총량)을 조사하고, 1단의 분류를 실측으로 재검증했다.
이 단계에서 **6건의 정정**이 나왔고 전부 이 문서에 반영돼 있다. 그중 셋은 결론을 바꿨다.

| 정정 | 1단 판정 | 실측 결과 | 반영 |
|---|---|---|---|
| 마일스톤 키워드 | *"빈 배열이어도 후자 규칙만으로 동작"* | 후자는 `단일일자 AND 산출물`을 동시 요구 → **키워드를 비우면 카드가 무증상 소실** | §7.4 |
| `REPORT_TEAMS` 폴백 | *"죽은 폴백, 실사용 경로 영향 없음"* | `analytics.ts:100` → `knowledge.ts` → 레거시 봇으로 **살아 있는 경로** | §10.15 |
| `teams` 콜드스타트 폴백 | trivial (*"D-CUBE 색채뿐"*) | 빈 `teams` 의 **정상 기동 상태가 D-CUBE 5팀**이고, 임포트가 타 팀 파일을 400 거부 | §10.3 |
| 레벨 축 규모 | 축마다 small / large / medium 불일치 | `domain/**` 참조 3곳 → **레벨은 small, 엑셀 3열이 large** (분리 가능) | §0 |
| 공휴일 i18n | medium (*"영업일 계산 입력"*) | 소비처 3곳 전부 **달력 색칠 전용**. 계산용 휴일은 `holidays` 테이블 | §10.16 |
| `report/excel.ts` | *"완전 범용, 손댈 것 없음"* | 워크로드 헤더가 **월~금 5열 구조** + 시트명 `'1.공정보고'` | §10.12 |

이 문서의 모든 파일:라인 인용은 그 감사 결과에서 왔다.
