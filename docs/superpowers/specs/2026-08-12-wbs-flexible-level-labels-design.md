# WBS 구분(레벨 라벨) 유연화 설계

작성 2026-08-12 · 상태 **설계 확정(구현 미착수)** · 근거: 코드 실측 12 에이전트 감사
(6축 전수 조사 162건·위험 64건 → 핵심 전제 5건 반증 검증 → 통합, 2026-08-12)

---

## 한 줄 결론

**구분은 프로젝트마다 다르다.** 엑셀로 올리면 그 엑셀의 계층 열 헤더가 곧 구분이 되고,
엑셀 없이 직접 쓰면 기본 4단 `PHASE · TASK · ACT · SUB-ACT` 를 갖는다.
저장소는 이미 있는 `project_settings.level_labels` 를 그대로 쓴다 — **마이그레이션 0건**.

배지 렌더링 코드는 **손대지 않는다.** 기본 라벨을 대문자 원문으로 저장하면
`levelBadgeText` 의 원문 폴백 경로를 타서 기존 표기가 그대로 나온다.

## 사용자 확정 결정 (2026-08-12)

| # | 결정 |
|---|---|
| L1 | 엑셀 헤더 반영은 **임포트 마법사 2단계 체크박스**로 — 감지 결과를 보여주고 확인 후 적용 |
| L2 | **구분 라벨 편집 UI 를 포함**한다 — 엑셀 없는 프로젝트도 어휘를 바꿀 수 있어야 하고, 잘못 반영된 헤더를 되돌릴 길이 된다 |
| L3 | **라벨만 4개, 깊이는 무제한** — `max_depth` 는 null. 라벨 개수 ≠ 최대 깊이 |
| L4 | 기본 어휘는 **기존 표기 그대로** `PHASE · TASK · ACT · SUB-ACT` (대문자) |

## 설계 검토 중 뒤집힌 전제 (감사 실측)

착수 전 세운 전제 5건 중 **성립 0 · 조건부 3 · 반증 2**. 아래는 그 결과로 바뀐 설계다.

| 전제 | 판정 | 결과 |
|---|---|---|
| 마이그레이션 0건이면 충분하다 | 조건부 | 저장은 되지만 **DB 제약이 0건**이라 빈 배열·빈 문자열·200자 라벨이 전부 통과한다 → §4 정규화 관문이 **필수 동반** |
| 시드 프리셋 교체는 기존 프로젝트에 무영향 | 조건부 | 화면은 무영향이 맞으나 **기존 테스트 2건이 확정 파손** → §9 에 갱신 대상 명시 |
| 서버가 클라이언트를 믿지 않고 라벨을 재유도한다 | 조건부 | 파일도 profile 도 같은 요청의 클라이언트가 준 것이라 **"불신"은 거짓** → §5 에서 문구를 정직하게 재기술 |
| 라벨 개수 편집은 무손실이다 | **반증** | 주간보고·RAG 는 폴백이 아니라 **클램프**라 표기가 조용히 바뀐다 → §7 에서 무손실 주장 철회 |
| 배지는 항상 PHASE/TASK/ACT 로 유지된다 | **반증** | 라벨이 배지의 유일한 소스라 엑셀 반영과 양립 불가 → §3 에서 **요구를 재해석**해 해소 |

---

## 현황 실측 (2026-08-12)

- `project_settings.level_labels`(`supabase/migrations/0058_project_settings.sql:7`)는 이미 있고,
  **15개 소비처가 전부 주입받아 쓴다**(배지·엑셀 내보내기·주간보고·RAG 임베딩·자식추가 placeholder 등).
  즉 저장 값만 바꾸면 화면·산출물이 따라온다 — 이 설계가 스키마를 건드릴 이유가 없는 근거.
- **쓰기 경로가 없다.** 0058 정책은 `read_project_settings`(SELECT/authenticated) 1건뿐이고
  grants 는 `authenticated:SELECT / service_role:ALL`(`0058:22,27`, prod·staging 드리프트 0).
  라벨을 바꿀 UI 도 액션도 현재 0건이다.
- 신규 프로젝트는 무조건 `pi` 프리셋(3단)으로 시드된다 — `src/app/actions/project.ts:70-75`.
  프리셋 선택 UI 는 Plan B 로 미뤄져 있었고 아직 없다.
- 임포트 마법사는 계층 열 헤더를 **이미 알고 있다**(`detect.ts:334` 의 `preview.headers`)
  — 그런데 라벨로 반영하는 경로만 없다.
- `DEFAULT_PROJECT_CONFIG.levelLabels`(`src/lib/data/projectConfig.ts:19`)와
  `DEFAULT_LEVEL_LABELS`(`src/components/wbs/shared.tsx:26`)는 둘 다 `['Phase','Task','Activity']`.
  **설정 행이 없는 비정상 프로젝트 전용 폴백**이고 D-CUBE 값과 같아야 회귀 0이라는 기존 계약이 있다 → 건드리지 않는다.

---

## §1. 저장소와 기본값

**스키마 무변경.** `project_settings.level_labels text[]` 를 그대로 쓴다.
마이그레이션 0건이므로 `_rollback.sql` 도 G4 게이트도 발동하지 않는다.

`src/lib/domain/projectPresets.ts` 에 **신규 키를 추가**한다. `PRESETS.pi` 는 손대지 않는다
(`tests/domain/project-presets.test.ts:6-9` 가 pi 값을 고정하고 있고, 그 테스트는 D-CUBE 현행의 유일한 감시선이다).

```ts
standard4: {
  summary: '4단 WBS · 분류축 없음 · 깊이 무제한',
  levelLabels: ['PHASE', 'TASK', 'ACT', 'SUB-ACT'],
  maxDepth: null,
  extraAxisLabel: null,
  milestoneKeywords: ['킥오프', 'kick-off', '착수보고', '중간보고', '최종보고', '보고회',
                      '오픈', '릴리스', 'release', '검수', 'uat', '준공', '승인', '마일스톤', 'milestone'],
},
```

제약 세 가지를 값에 박아 둔다.

- `milestoneKeywords` 는 **비어 있지 않고 전부 소문자**여야 한다 — `tests/domain/project-presets.test.ts:12-17`
  이 `Object.values(PRESETS)` 전수로 강제한다. 빈 배열은 마일스톤 카드를 무증상 소실시킨다(스펙 §7.4 기존 계약).
  위 목록의 한글은 소문자 개념이 없어 그대로 통과한다.
- `maxDepth: null` — L3. `canAddChild(depth, maxDepth) = maxDepth == null || depth + 1 < maxDepth`
  (`src/lib/domain/wbsAffordance.ts:5`)이므로 `4` 로 두면 depth 3 에서 자식 추가가 막혀 목표와 정면 충돌한다.
- `summary`·`extraAxisLabel` 은 현재 소비처 0건이지만 타입상 필수다. 구현자가 임의로 채우지 않도록 위 값으로 확정한다.

`createProject`(`src/app/actions/project.ts:68-75`)의 시드를 `PRESETS.pi` → `PRESETS.standard4` 로 바꾸고,
**`preset_applied` 를 리터럴 `'pi'` 가 아니라 프리셋 키에서 파생**시킨다.
`0061_replace_wbs_and_profile.sql:94` 가 이 값을 술어로 쓴 전례가 있어, 3라벨 pi 프로젝트와
4라벨 신규 프로젝트가 같은 마커를 갖게 두면 나중에 구분할 수 없다.

**기존 프로젝트는 무접촉.** 0058 시드가 기존 전 프로젝트에 행을 넣었고, 이 변경은 신규 생성 경로만 건드린다.

> ⚠️ **DB default 가 여전히 3단이다** — `0058:7` 의 `default array['Phase','Task','Activity']`.
> 마이그레이션 0건을 유지하는 대가로 "신규는 4단"이라는 제품 규칙과 어긋나는 2차 진실원이 남는다.
> **계약: `project_settings` 에 INSERT 하는 모든 경로는 `level_labels` 를 명시한다**(§5 의 upsert 포함).

---

## §2. 세 경로, 한 관문

라벨이 쓰이는 경로는 셋이고, **전부 같은 정규화 함수를 통과한다.**

```
엑셀 임포트 ─┐
설정 편집 ───┼→ normalizeLevelLabels() → project_settings.level_labels → getProjectConfig() → 15개 소비처
프로젝트 생성 ┘                                      (방어 정규화 2차 관문)
```

신규 순수 모듈 `src/lib/domain/levelLabels.ts` 에 함수 셋을 둔다. i18n 을 모르고 DB 를 모른다(기존 도메인 관례).

| 함수 | 책임 |
|---|---|
| `normalizeLevelLabels(labels)` | 단일 검증 관문. trim → 빈·공백 원소 거부 → 개수 1~8 → 원소 길이 ≤ 12자 → `{ok, labels}` 또는 `{ok:false, reason}`. **중복 라벨은 허용**한다(사람이 의도적으로 같은 이름을 둘 수 있고, 해로운 값이 아니다) |
| `proposeLevelLabels(headers, profile)` | 계층 열 헤더 → 제안 라벨. 판단이 서지 않으면 **`null`**(제안 포기) |
| `mergeLevelLabels(derived, existing)` | `merged[i] = derived[i] ?? existing[i]` — 뒤쪽 기존 라벨 보존 |

**길이 상한 12자**는 임의값이 아니다. WBS 시트의 구분 열이 60px 로 동결돼 있어
(`src/components/wbs/WbsGanttSheet.tsx:35`) 그보다 길면 배지가 잘린다.

**`proposeLevelLabels` 가 `null` 을 내는 조건** — 하나라도 걸리면 제안하지 않는다(무증상 오염 방지):

- outline(단일 코드 열) 프로파일 — 레벨별 헤더라는 것이 존재하지 않는다
- 헤더 중 빈 문자열·공백만 있는 것이 있다 — **병합 셀 양식에서 연속 셀이 `null` 로 읽힌다**(실측)
- 헤더에 중복이 있다
- 헤더가 시스템 생성물이다 — `/^Level\d+$/` 또는 `'세부업무'`(§8 왕복 방지)

`mergeLevelLabels` 가 필요한 이유: 3열 엑셀을 4라벨 프로젝트에 임포트하면 라벨이 3개로 잘려
depth 3 표기가 퇴화한다. 감지 실패 폴백(`detect.ts:274`)이나 계층 방식 전환(`importWizard.ts:129`)으로
**1열**이 되는 경우도 있다. 명시적 축소는 §6 수동 편집에서만 일어난다.

**2차 관문**: `getProjectConfig`(`src/lib/data/projectConfig.ts:44`)에 방어 정규화를 넣는다 —
빈 원소를 걸러내고, 그 결과가 0개면 `DEFAULT_PROJECT_CONFIG.levelLabels` 로 승격.
같은 파일 `:48` 이 `milestone_keywords` 를 lowercase 로 정규화해 계약을 로더가 보증하는 것과 같은 관례다.
이미 손상된 행이 DB 에 있어도 소비처에 닿지 않게 한다.

---

## §3. 배지 — 코드를 고치지 않는다

**감사가 반증한 지점이자, 재해석으로 해소한 지점.**

`levelBadgeText`(`src/components/wbs/shared.tsx:41-45`)의 현재 규칙:

```
isOwnerSplit → 'SUB-ACT'
아니면       → LEGACY_LABEL_ABBR[label]  ?? label  ?? `${depth+1}단`
                (Phase→PHASE 등 3키)      (원문)     (라벨 밖 깊이)
```

기본 라벨을 `['PHASE','TASK','ACT','SUB-ACT']` 로 **대문자 원문 저장**하면 축약표에 없어
`?? label` 원문 폴백을 타고, 화면에 정확히 `PHASE·TASK·ACT·SUB-ACT` 가 나온다.
**따라서 `shared.tsx` 는 이 설계의 수정 대상이 아니다.** 축약표 확장(당초 A7)은 폐기한다.

D-CUBE 는 계속 `Phase·Task·Activity` 를 저장하고 축약표를 타서 동일하게 `PHASE·TASK·ACT` 로 나온다.
두 어휘가 같은 화면 문자열로 수렴하되 서로 간섭하지 않는다.

**엑셀 프로젝트의 배지는 엑셀 헤더가 된다** — `대분류`를 올리면 배지도 `대분류`다. 이것이 이 기능의 목적이므로
버그가 아니다. L4 의 "기존 표기 유지"는 **기본값 어휘**를 말한 것으로 해석했다(→ §11 확인 요망 #1).

### depth 3 정규 항목과 담당팀 분리 항목이 같은 배지를 갖는 문제

`DEPTH_CLASS_FALLBACK`(`:34`)과 `SUB_ACT.cls`(`:36`)는 문자열까지 같은 `'bg-surface-2 text-ink-muted'` 라,
4단 프로젝트에서 depth 3 정규 항목과 담당 분리 항목은 텍스트·색이 모두 같아진다.

**이것을 사양으로 수용한다.** 담당 분리 항목은 ACT(depth 2)의 자식이므로 **항상 depth 3** 이고,
새 4단 어휘에서 depth 3 이 곧 SUB-ACT 다 — 같은 단계를 같게 표기하는 것이라 의미가 어긋나지 않는다.
분리 항목인지 여부는 이름 규칙(`{ACT명} (MES 주관)` — `src/lib/domain/subact.ts:9`)으로 이미 드러난다.

색을 분리하려면 `shared.tsx` 를 고쳐야 하는데, 그 파일은 전 WBS 화면에 영향을 주면서
빌드·린트·테스트로 깨짐이 잡히지 않는 계열이다. **이번 범위의 이득이 그 위험을 사지 않는다.**

---

## §4. 라벨 검증 (마이그레이션 0건의 대가)

`0058:7` 은 `text[] not null` 이고 **길이·원소 CHECK 가 0건**이다. 스테이징 실측으로
빈 배열·`''`·200자 라벨이 전부 저장됨을 확인했다. 방치하면:

- **빈 배열** → `weekly.ts:483`·`analytics.ts:373` 의 클램프 인덱스가 `-1` 이 되어 `undefined` 를 내고,
  주간보고 엑셀 B열과 RAG 임베딩 본문에 `구분 undefined` 가 박힌다. 그 문서가 pgvector 에 색인되면 **봇 답변까지 오염**된다.
- **빈 문자열 원소** → `shared.tsx:44` 의 `??` 는 `''` 를 통과시키므로(`undefined` 일 때만 폴백) 배지가 빈칸이 된다.

DB 에 제약을 걸지 않기로 한 이상 **애플리케이션이 유일한 관문**이다.
§2 의 `normalizeLevelLabels` 를 세 경로가 모두 통과하고, `getProjectConfig` 가 2차로 막는다.

---

## §5. 임포트 경로

### 마법사 (클라이언트)

`WizardState` 에 `applyLevelLabels: boolean` 과 액션 `applyLevelLabelsChanged` 를 추가한다.

- 초기값 **`false`** (→ §11 확인 요망 #2)
- outline 모드이거나 `proposeLevelLabels` 가 `null` 이면 **체크박스를 렌더링하지 않고** 값을 `false` 로 강제
- `switchHierarchyKind` 로 outline 으로 전환하면 `false` 로 되돌린다
- `fileSelected`·`reset` 은 기존과 같이 전체 초기화

리뷰 단계에 **현재 → 제안 대비**를 표시한다. `replace` 는 되돌릴 수 없고 라벨 갱신도 이력이 남지 않으므로,
이 표가 실행 전 유일한 검증면이라는 기존 설계 철학(`importWizard.ts:163` 주석)을 그대로 잇는다.

### 실행 (서버, `/api/import/execute`)

폼 필드 `applyLevelLabels` 를 추가한다. 서버는 클라이언트가 보낸 **라벨 문자열을 받지 않고**
업로드된 파일에서 직접 다시 읽는다.

> **문구를 정직하게 쓴다.** 이것은 "클라이언트 불신"이 아니다 — 파일도 profile 도 같은 요청의
> 클라이언트가 준 것이고, `validateProfile`(`src/lib/excel/profile.ts:44-78`)은 `headerRow`·`columns` 가
> 시트 범위 안인지조차 검사하지 않는다. 실질 관문은 `requireProjectAdmin`(`route.ts:55`) 하나다.
> 서버 재유도의 실익은 **파싱에 쓴 좌표계를 그대로 재사용해 라벨-파싱 불일치를 없애는 것**이고,
> 값의 안전성은 §4 정규화가 담당한다.

신규 모듈 `src/lib/excel/headers.ts` 에 `readHierarchyHeaders(buf, profile): string[] | null` 을 둔다.

- 내부에서 `parseWithProfile.ts:88` 과 **동일한 `sheet_to_json(ws, { header:1, blankrows:false })`** 를 쓴다.
  `profile.headerRow` 는 엑셀 절대 행 번호가 아니라 **이 옵션으로 압축된 배열의 인덱스**다(§10-1).
- `aoa[profile.headerRow]` 에서 `profile.hierarchy.columns` 위치 셀만 뽑는다.
- 시트 없음·행 범위 밖·열 범위 밖이면 `null`.

`parseWithProfile` 에 export 를 얹지 않고 **별도 모듈로 분리하는 이유**는 §10-5 — 라우트 테스트가
`parseWithProfile` 모듈을 통째로 `vi.mock` 하고 있어, 같은 모듈에 얹으면 팩토리에 없는 export 가 `undefined` 가 된다.

라우트 변경:

1. `route.ts:67` 의 인라인 `await file.arrayBuffer()` 를 `const buf = ...` 로 승격해 파싱과 재유도가 **같은 버퍼**를 쓴다(대용량 2배 메모리 회피).
2. 임포트 본체 성공 후, `readHierarchyHeaders` → `proposeLevelLabels` → `mergeLevelLabels(derived, 현재 라벨)` → `normalizeLevelLabels` 순으로 통과시킨다. 어느 단계든 실패하면 **라벨만 건너뛰고 임포트는 성공 유지**, 사유를 `warnings` 에 싣는다(에러 처리 3원칙 — 조용히 삼키지 않는다).
3. 쓰기는 기존 `excel_profile` 저장(`route.ts:143-149`)과 **하나의 upsert 로 합류**시킨다.
   `update().eq()` 는 행이 없을 때 PostgREST 가 error 없이 0행을 돌려주어 "저장했습니다" 와 함께 무증상 실패한다.
4. **INSERT 로 떨어질 때를 대비해 페이로드에 프리셋 전량을 싣는다** — upsert 가 INSERT 가 되면
   페이로드에 없는 컬럼이 DB default 를 먹고, `milestone_keywords` 가 빈 배열이 되어
   마일스톤 카드가 무증상 소실된다(`dashboard.ts:72-78`). 쓰기 전 `getProjectConfig` 로 현재 값을 읽어
   함께 싣는다 — 선행 조회가 실패하면 중단(3원칙).
5. `updated_at`·`updated_by` 를 앱이 직접 채운다 — **updated_at 트리거는 전 마이그레이션에 0건**이고
   `default now()` 는 INSERT 에서만 발동한다. `updated_by` 는 가드가 돌려준 `g.actor.userId`.

응답에 `levelLabels: { applied: boolean; before: string[]; after: string[] } | { applied: false; reason: string }` 을 싣고
완료 화면에 표시한다. **이력 테이블이 없으므로 이 응답이 수동 복구의 유일한 좌표다.**

> ⚠️ 기본 경로(`applyLevelLabels=false` 이고 `saveProfile=false`)에서는 **응답 필드가 하나도 늘지 않고
> admin 클라이언트를 아예 호출하지 않아야 한다** — `tests/api/import-execute.test.ts:320` 이 응답 바디를
> 정확일치로, `:398` 이 `admin.upsert` 미호출을 단정한다.

---

## §6. 구분 라벨 편집 UI

`/p/[projectId]/settings` 에 `SectionCard` "WBS 구분" 을 추가하고,
클라이언트 컴포넌트 `src/components/settings/LevelLabelsManager.tsx` 를 둔다.

```
WBS 구분
────────────────────────
1단  [PHASE   ]  ✕
2단  [TASK    ]  ✕
3단  [ACT     ]  ✕
4단  [SUB-ACT ]  ✕
     [+ 단계 추가]
[저장]
```

- **i18n 은 `ProjectPrivacyToggle` 방식을 따른다** — `useLocale` + `t()` 로 전량 사전화.
  설정 화면 컴포넌트의 관례가 둘로 갈려 있어(`ProjectTeamsManager` 는 한국어 하드코딩) 명시해 둔다.
- 저장 실패는 인라인 `role="alert"` 로 표시(표시 = 로깅).
- 페이지에서 `getProjectConfig` 를 **try/catch 로 별도 호출**한다 — 설정 조회 실패가 설정 화면 전체를
  못 열게 만들면 안 되고, 동시에 "데이터 없음"으로 위장해서도 안 된다.

서버 액션 `src/app/actions/projectSettings.ts` — `updateLevelLabels(projectId, labels)`:

`isUuidLike` → `requireProjectAdmin` → `normalizeLevelLabels` → `createAdminClient().upsert(..., { onConflict: 'project_id' })`
(§5-4·5 와 동일하게 프리셋 전량 + `updated_at`/`updated_by` 동반) → `revalidatePath` → **재색인 베스트에포트**.

재색인이 필요한 이유: `ensure-index.ts:35-37` 은 색인이 1건이라도 있으면 즉시 return 하므로
**stale 을 스스로 고치지 못한다.** 라벨은 RAG 임베딩 본문에 들어가므로 갱신 후 `ingestProject` 를
베스트에포트로 부른다(임포트 경로와 같은 관례). 실패해도 저장은 성공으로 둔다.

**`max_depth` 는 이 화면에서 편집하지 않는다**(범위 통제). 다만 기존 두 프로젝트는 `max_depth=3` 이라
4번째 라벨을 넣어도 depth 2 아래 '자식 추가' 가 UI 에서 막힌다 — **손으로 만들 수 없는 유령 라벨**이 된다.
라벨 개수가 `max_depth` 를 넘으면 저장은 허용하되 경고 문구를 띄운다.

---

## §7. 라벨 개수 변경의 알려진 영향 (무손실 주장 철회)

**당초 "라벨 개수 편집은 데이터 무손실" 이라 했으나, 감사에서 반증됐다.**
항목 구조는 실제로 불변이지만 **표기가 조용히 바뀐다.** 소비처의 규칙이 셋으로 갈려 있기 때문이다.

| 소비처 | 라벨 밖 깊이 처리 | 근거 |
|---|---|---|
| WBS 배지 | `N단` 폴백 | `shared.tsx:44` |
| 주간보고 Lv · RAG 임베딩 | **마지막 라벨로 클램프** | `weekly.ts:483`, `analytics.ts:373` |
| 엑셀 내보내기 | `[0..2]` 고정 인덱스 | `export.ts:67` |

따라서:

- **4 → 3 축소**: depth 3 행의 주간보고 Lv 가 `세분류` → `소분류` 로 바뀌어 **depth 2 행과 같은 값**이 된다.
  보고서만 보는 사람은 4단 항목을 3단으로 오독한다.
- **3 → 4 확대**: 기존 depth 3 행의 Lv 와 임베딩 본문이 소리 없이 바뀐다.

**결정: 클램프를 그대로 둔다.** 폴백으로 통일하면 `tests/report/excel.test.ts:98`·
`weekly.test.ts:158-160`·`analytics.test.ts:197-201` 세 회귀선이 깨지고 **D-CUBE 주간보고·임베딩 산출물의
바이트가 바뀐다.** 이번 목적(어휘 유연화)에 그 대가는 과하다.

대신 **위 영향을 알려진 사양으로 명시**하고, §6 편집 UI 에서 라벨 개수를 줄일 때 확인을 받는다.

---

## §8. 엑셀 왕복 비대칭

`exportWithProfile.ts:22-25` 의 `hierarchyLabel` 은 `level_labels` 를 **전혀 읽지 않는다** —
3열이면 `Phase/Task/Activity` 하드코딩, 아니면 `Level{n+1}`, 삽입 열 헤더는 `'세부업무'` 고정(`:185`).

내보낸 파일을 라벨 반영을 켜고 되임포트하면 **사용자 라벨이 조용히 되돌아간다.**

**둘 다 한다.**

1. `buildWorkbookWithProfile` 에 `levelLabels` 를 주입해 내보내기 헤더가 프로젝트 어휘를 따르게 한다.
   D-CUBE 는 `level_labels` 가 정확히 `['Phase','Task','Activity']` 라 **출력 바이트가 동일**하다(회귀 0).
2. `proposeLevelLabels` 가 `/^Level\d+$/`·`'세부업무'` 를 시스템 생성 헤더로 보고 제안을 포기한다(§2).

---

## §9. 영향 파일

**신규**

| 파일 | 사유 |
|---|---|
| `src/lib/domain/levelLabels.ts` | 정규화·제안·병합 순수함수 3종. 세 경로의 공통 관문 |
| `src/lib/excel/headers.ts` | `readHierarchyHeaders` — 파싱과 동일 좌표계로 헤더 재유도. `parseWithProfile` 과 분리(§10-5) |
| `src/app/actions/projectSettings.ts` | `updateLevelLabels` 서버 액션 |
| `src/components/settings/LevelLabelsManager.tsx` | 편집 UI |

**수정**

| 파일 | 사유 |
|---|---|
| `src/lib/domain/projectPresets.ts` | `standard4` 키 추가 (pi 무접촉) |
| `src/app/actions/project.ts` | 시드 프리셋 교체 + `preset_applied` 를 키에서 파생 |
| `src/lib/data/projectConfig.ts` | `level_labels` 방어 정규화 |
| `src/lib/domain/importWizard.ts` | `applyLevelLabels` 상태·액션·전환 규칙 |
| `src/components/import/ImportWizard.tsx` | 체크박스 + 현재→제안 대비 + 완료 화면 before/after |
| `src/app/api/import/execute/route.ts` | buf 승격·라벨 재유도·단일 upsert·warnings |
| `src/app/(app)/p/[projectId]/settings/page.tsx` | 라벨 SectionCard |
| `src/lib/excel/exportWithProfile.ts` | `hierarchyLabel` 에 levelLabels 주입(§8) |
| `src/lib/i18n/dict/settings.ts`, `dict/importWizard.ts` | ko/en 동시 추가 |

**수정하지 않는 것**: `src/components/wbs/shared.tsx`(§3) · `DEFAULT_PROJECT_CONFIG`·`DEFAULT_LEVEL_LABELS` 값 ·
`PRESETS.pi` · `weekly.ts`·`analytics.ts` 의 클램프(§7) · 마이그레이션.

---

## §10. 구현 함정 (코드를 봐야만 알 수 있는 것)

1. **`sheet_to_json` 옵션 불일치 = 인덱스 1칸 밀림.** `profile.headerRow` 는 `{header:1, blankrows:false}`
   로 만든 **압축 배열의 인덱스**다. 재유도에서 `blankrows` 를 빠뜨리면 기본값 `true` 가 되어,
   범위 안 빈 행 하나로 헤더 대신 데이터 행(업무명)이 라벨로 저장된다 — 에러 없이.
2. **`savedProfile.headerRow` 와 detect 의 `headerRow` 가 다를 수 있다.** `importWizard.ts:85` 는
   `savedProfile ?? detection.profile` 인데 사용자가 본 `preview.headers` 는 detect 가 고른 행에서 나오고,
   마법사에 headerRow 편집기가 **없어 사람이 교정할 수도 없다.** 그래서 execute 응답에 실제 저장 라벨을 실어
   완료 화면에서 대비할 수 있게 한다(§5).
3. **`??` 는 빈 문자열을 통과시킨다**(`shared.tsx:44`). `N단` 폴백은 `undefined` 일 때만 탄다.
4. **라우트 테스트의 admin mock 은 `project_settings` 에 `{ upsert }` 만 노출**하고 그 외 테이블은 throw 한다
   (`tests/api/import-execute.test.ts:103-110`). `.update()`/`.select()` 를 쓰면 즉시 TypeError.
5. **`parseWithProfile` 모듈이 통째로 `vi.mock` 되어 있다**(같은 파일 `:26`). 새 export 를 얹으면 팩토리에 없어
   `undefined` 가 된다. FILE 픽스처는 `new Blob(['x'])` 1바이트 가짜라 라우트에 실제 `XLSX.read` 를 태우면
   전 케이스가 예외 또는 침묵 스킵 경로를 탄다 — **테스트는 초록인데 기능은 죽어 있는** 형태가 된다.
   실 워크북 픽스처 검증은 `tests/excel/` 이 맡는다.
6. **vitest 는 타입체크를 하지 않는다**(oxc 변환만). ko/en 키 누락은 전량 초록으로 통과하고
   `next build` 에서만 잡힌다 → **i18n 검증 게이트는 `npm run test` 가 아니라 `npm run build`**.
7. **`createProject` 는 설정 시드 실패를 삼키고**(`project.ts:76-77`), `createAdminClient()` 는 env 결손 시
   `projects insert` **성공 뒤에** throw 한다(`admin.ts:8-10`). "설정 행이 없을 수 있는 경로"는 없는 게 아니라 있다.
8. **upsert 가 INSERT 로 떨어지면 페이로드에 없는 컬럼이 DB default 를 먹는다** → `milestone_keywords` 빈 배열
   → 마일스톤 카드 무증상 소실(`dashboard.ts:72-78`). §5-4 가 이것 때문이다.
9. **`max_depth` 는 서버 강제가 아니다.** `addWbsItem`(`src/app/actions/wbs.ts:217`)에 검사 0건,
   임포트도 `getProjectConfig` 를 부르지 않는다. 실증: `max_depth=3` 인 프로젝트에 depth 3 항목 388건 존재.
   `canAddChild` 는 **순수 UI 어포던스**일 뿐이니 "깊이 제한"으로 오해하지 말 것.
10. **`dict.ts:27-73` 은 네임스페이스를 단순 스프레드로 병합**하며 중복 키를 막는 테스트도 린트도 없다.
    접두(`settings.`/`importWizard.`)를 빠뜨리면 나중 스프레드가 조용히 이긴다.
    런타임 폴백이 `table[key] ?? DICT.ko[key] ?? key`(`:77`)라 en 누락은 **한국어 노출로 조용히 끝난다.**
11. **`RESERVED_TEAM_NAMES`(`src/lib/domain/teams.ts:41`)에 `'Phase','Task','Activity'` 가 하드코딩**돼 있고
    프로젝트 라벨과 연동되지 않는다. 새 라벨(`대공정` 등)은 팀명으로 등록 가능해 엑셀 열 맵 오염 여지가 남는다
    — **이번 범위 밖**으로 둔다(별도 백로그).
12. **`src/lib/excel/parse.ts` 레거시 파서는 import 하는 라우트가 0건**이다(테스트 오라클 전용).
    거기 있는 `labels.indexOf('Activity')` 를 보고 런타임 영향으로 오판하지 말 것.
13. **`resolveLegacyLevelLabels`(`parseWithProfile.ts:170`)는 계층 열이 정확히 3개인지만 본다** — 헤더 문자열과 무관.
    4열 엑셀은 비-레거시 경로를 타 모든 행이 `level='activity'` 가 되고,
    `validate.ts:69` 의 담당자 분리 조건 `level !== 'phase'` 가 **최상위 항목까지** 걸린다.
    이 설계가 만든 문제는 아니지만 4단 어휘가 기본이 되면 노출 빈도가 오른다 — 별도 백로그.

---

## §11. 확인 요망

구현 전 사용자 확인이 필요한 결정 2건. 둘 다 뒤집어도 설계 구조는 그대로다.

**#1. 엑셀 프로젝트의 배지가 엑셀 헤더로 바뀌는 것 (§3)**

L4 "기존 ACT·SUB-ACT·TASK·PHASE 유지" 를 **기본값 어휘**로 해석했다. 그 결과 `대분류` 헤더 엑셀을 올리면
WBS 배지도 `대분류` 가 된다 — 이것이 "엑셀 기준으로 등록"의 자연스러운 귀결이라 판단했다.

만약 **배지만은 항상 PHASE/TASK/ACT 여야 한다**는 뜻이었다면 설계가 크게 달라진다:
`levelBadgeText` 에서 라벨 의존을 끊고 depth 고정 테이블로 바꿔야 하고,
그 순간 기존 `D-CUBE MES Pilot Project` 의 **depth 3 정규 항목 388건이 `4단` → `SUB-ACT` 로 일괄 변경**된다
(D-CUBE 본 프로젝트의 depth 3 81건은 전부 담당 분리라 무변경).
`src/components/wbs/shared.tsx` 수정 + 브랜치 + 스테이징 눈확인이 필수가 된다.

**#2. 임포트 체크박스 기본값을 꺼짐으로 바꿨다 (§5)**

브레인스토밍 때 보여드린 미리보기는 체크가 켜진 상태였으나, 감사 결과를 보고 **꺼짐으로 뒤집었다.**

- 켜짐의 비용: 협력사 엑셀을 평범하게 append 하는 것만으로 운영 프로젝트의 구분 어휘가 바뀌고,
  주간보고 표기와 RAG 임베딩까지 따라 바뀐다. `project_settings` 는 트리거·이력이 0건이고
  마이그레이션 0건이라 `git revert` 로도 안 돌아온다. PITR 도 꺼져 있다.
- 꺼짐의 비용: 라벨을 반영하려는 사람이 체크박스를 한 번 더 누른다. 대비 표가 바로 옆에 있다.

파괴적 방향으로 기울 때는 fail-safe 쪽을 기본값으로 둔다는 이 리포의 관례에 맞췄다.
"업로드하면 알아서 반영" 이 더 중요하다면 켜짐으로 되돌리면 된다.

---

## §12. 테스트 계획

**단위 (순수함수)**

- `normalizeLevelLabels` — trim / 빈 문자열 원소 거부 / 공백만 원소 거부 / 빈 배열 거부 / 9개 이상 거부 /
  원소 13자 이상 거부 / 정상 통과
- `proposeLevelLabels` — 정상 3열 / 빈 헤더 포함 시 `null` / 중복 헤더 시 `null` / outline 프로파일 `null` /
  `Level1` 같은 시스템 헤더 `null` / `'세부업무'` `null`
- `mergeLevelLabels` — 3개 제안 + 4개 기존 → 4번째 보존 / 1개 제안 → 나머지 3개 보존 / 동일 길이 → 전량 치환
- `readHierarchyHeaders` — **실 워크북 픽스처**로: 정상 / 범위 안 빈 행 존재(`blankrows:false` 계약 고정) /
  병합 헤더 / `headerRow` 범위 밖 `null` / 계층 열 범위 밖 `null`
- `importWizard` 리듀서 — `applyLevelLabels` 초기값(columns/outline) / outline 전환 시 강제 false /
  `fileSelected`·`reset` 리셋 (액션 1개당 `it` 1개 — 기존 관례)
- `updateLevelLabels` — 비-UUID 거부 / 가드 실패 시 가드 문자열 그대로 반환 /
  upsert 페이로드에 `updated_at`·`updated_by`·프리셋 전량 포함 / 정규화 위반 시 쓰기 미발생
- `getProjectConfig` 방어 정규화 — 빈 원소 제거 / 전량 손상 시 DEFAULT 승격
  (기존 `tests/data/project-config.test.ts:15` 는 상수 참조 비교라 값 회귀를 못 잡는다 — 케이스 신설)

**갱신이 필요한 기존 테스트**

- `tests/actions/project-actions.test.ts:73-80` — **확정 파손.** `level_labels`·`max_depth`·
  `extra_axis_label`·`preset_applied:'pi'` 를 하드 단정한다. describe 제목의 'pi 프리셋' 표현까지 고친다.
- `tests/domain/project-presets.test.ts:12-17` — 전수 순회. 신규 프리셋의 `milestoneKeywords` 가
  비어 있거나 대문자면 자동 파손(의도된 감시선 — 통과하도록 값을 맞춘다).
- `tests/api/import-execute.test.ts` — `:26` mock 팩토리 / `:320` 응답 바디 정확일치 /
  `:398` `admin.upsert` 미호출. **수용 기준: 기본 경로(플래그 false)는 응답 필드가 늘지 않고 admin 을 부르지 않는다.**
- `tests/domain/level-badge.test.ts` — §3 대로 `shared.tsx` 를 고치지 않으므로 **무영향**.
  (확인 요망 #1 이 뒤집히면 `:13` 의 `(3,false,DCUBE)==='4단'` 이 확정 파손된다.)

**게이트**

- `npm run test` 전량 초록 (베이스라인 359파일 / 4224건)
- **`npm run build`** — i18n ko/en 키 패리티는 여기서만 잡힌다(§10-6)
- 마이그레이션 0건이므로 G4 미발동. `shared.tsx` 무수정이므로 G2 도 무관.
- 신규 화면(설정 섹션·마법사 체크박스)이므로 **스테이징 URL 확인 후 main 머지**(리포 관례).
  스테이징에서 확인할 3가지: ① 신규 프로젝트 생성 → 4단 배지 ② 임의 헤더 엑셀 임포트 →
  체크 시 라벨 갱신·완료 화면 before/after ③ 설정에서 편집·축소 경고·저장 후 배지 반영.

---

## 범위 밖 (별도 백로그)

| # | 항목 | 사유 |
|---|---|---|
| B1 | `RESERVED_TEAM_NAMES` 를 프로젝트 라벨과 연동 | §10-11. 팀 마스터 쪽 설계가 필요 |
| B2 | 4열 임포트의 최상위 담당자 분리 (`validate.ts:69`) | §10-13. 기존 동작이라 별도 판단 필요 |
| B3 | 프로젝트 생성 시 프리셋 선택 UI | §6 편집 UI 가 사후 변경을 커버하므로 YAGNI |
| B4 | `max_depth` 편집 | §6. 기존 프로젝트의 유령 라벨 문제는 경고로 대응 |
| B5 | 라벨 변경 이력 테이블 | 이력 0건이 §11-2 결정의 근거. 필요해지면 그때 |
