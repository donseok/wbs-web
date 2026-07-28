# folder_path 작업 원장 — `dflow-folder-path-worklist-2026-07-27.md` 구현 진행

> 이 파일이 유일한 진행 기억이다. 매 턴 먼저 읽고 마지막에 갱신한다.
> 지시서: `docs/design/dflow-folder-path-worklist-2026-07-27.md`
> 브랜치: `feat/minutes-folder-path`

---

## 0. 최종 요약 (2026-07-27)

> **⚠️ 2차 갱신** — 최초 구현(18항목) 이후 **결정 정본 `dflow-decisions-final-2026-07-27.md`(D'Flow PMO)** 가
> 도착해 R1 패키지를 추가 반영했다. 그 문서가 이 원장·지시서보다 **이긴다**. 아래 §8 참조.

**완료 18 + R1 결정분 10 / 차단 0 / 확인 필요 1(Q2만 잔존)**

지시서 §4 표(W1·W1-b·W2~W10)와 §6.6 표(W18~W23) 전 항목 + 사용자 결정 E3으로 신설된 W24까지 구현·검증했다.
지시서가 ⚠️ 결정 필요로 남긴 3건은 착수 시점에 사용자 결정(E1~E3)을 받아 **BLOCKED 없이** 진행했다.

| 커밋 | 범위 |
|---|---|
| `4387576` | W8 — 계약서 v2.3 (충돌 문장 3개 + 요약표·§1.2·§4.2 잔존 3곳 정정) |
| `c769ee5` | W1·W1-b·W2·W3·W4·W5·W24 — `folder_path` 코어 + 보관 상태 노출 |
| `afc1943` | W6 — 배치 재편철 + 스냅샷 리팩터 |
| `7df6c52` | W10a·W18·W20b·W21 — 서버 액션 + 순수 함수 2개 + 데이터 배관 |
| `cd057a1` | 공용 — `folder-drop.ts` · `FolderTreeSelect` · i18n 26키 |
| `d098b9f` | 배치 summary 항등식 테스트 |
| `e682f17` | W19·W20a·W10b·W22 — UI 재편 + 죽은 어포던스 정리 |

**검증**: `npx tsc --noEmit` · `npm run lint`(신규 경고 0) · `npm test` 전부 통과 · `npm run build` 통과.
※ 테스트 건수는 커밋마다 늘어난다 — 이 줄에 숫자를 박아 두면 곧 거짓이 되므로 적지 않는다(2026-07-28 정정:
「203 files / 2412 tests」로 고정돼 있었으나 실측과 어긋났다).

**푸시됨** — `origin/feat/minutes-folder-path`. `main` 미머지.
(2026-07-28 정정: 종전 「푸시하지 않았다 — 로컬 브랜치에만 있다」는 거짓이었다.)

### 구현 중 드러난 지시서 밖 조치 4건 (전부 본문에 근거 기록)

1. **W24 신설** — E3 결정에 따른 `include_archived` + `archived`. 지시서에 없던 작업 항목.
2. **배치 status 사유 2개 추가** — `failed(folder_error)`·`failed(update_failed)`. → Q3
3. **탐색기 루트 '새 폴더' 버튼 제거** — W18이 루트 생성을 거절하면서 **항상 실패하는 죽은 어포던스**가 됐다.
   지시서는 W18의 이 파급을 적지 않았다. 폴더는 팀 폴더 ⋯ 메뉴의 '하위 폴더 추가'로만 만든다.
4. **`FolderPickModal` 미분류 항목 제거** — §6.4가 "드롭 대상에 미분류를 포함하지 않는다"고 했는데
   같은 조작이 픽커에는 남아 있었다. 폴더가 `team_code`의 유일한 출처가 되면 미분류 강등은 팀 파생을 끊는다.

---

## 1. 착수 시점 결정 사항 (사용자 확정 2026-07-27)

지시서가 **⚠️ 결정 필요**로 남긴 3건 + 조사 쿼리 처리 방침. 구현 중 뒤집지 말 것.

| 결정 | 지시서 절 | 확정 내용 |
|---|---|---|
| **E1** | §3.3 | **`folder_path: null`** — 미분류 폴백 시 `folder_id: null` + `folder_path: null`. `[]`(팀 루트 편철 성공)와 구분한다. → 또박또박 `ddobak-W9` 타입 nullable 요청(§11.3 ⑥)이 이로써 성립 |
| **E2** | §8.3 | **(b) 배포 차수 교체** — 재편철(또박또박 3차)을 전송 전환(2차)보다 앞세운다. **D'Flow 코드 변경 0**, §11.2 차수표 + §11.3 ⑤를 함께 개정(= W8 범위). D'Flow는 `W6`를 `W1`~`W5`와 함께(또는 먼저) 낸다 |
| **E3** | §9.7 | **(a) D'Flow가 보관 상태 구분 노출** — `GET /api/v1/minutes`에 `include_archived` 파라미터 + 응답 `archived` 필드. 신규 엔드포인트가 아니라 기존 라우트 파라미터라 §5 방침과 충돌 없음. → **신규 작업 항목 `W24`로 등재** |
| **E4** | §7 · §6.7 | 조사 쿼리를 **읽기 전용으로 실행**(Management API, select만). 결과는 §2. 쓰기(백필·정리)는 실행하지 않는다 |

---

## 2. 선행 확인 결과 (§7 · §6.7) — 운영 DB 읽기 전용, 2026-07-27

프로젝트 `rglfgrwwwwdqejohdnty`. **select만 실행했다. 쓰기 없음.**

| # | 확인 | 결과 | 판정 |
|---|---|---|---|
| ① | 루트 폴더 (0043 시드) | `PMO(0)·ERP(1)·MES(2)·가공(3)·MDM(4)`, `created_by` 전부 `null` | ✅ **0043 적용됨** — 지시서 §7 기대치와 정확히 일치 |
| ② | 사용자 루트 폴더 (`parent_id is null and created_by is not null`) | **0건** | ✅ §6.3 불변식이 **이미 성립** — W23 데이터 이동 불필요 |
| ③ | 미분류 회의록 (`folder_id is null and archived_at is null`) | **0건** | ✅ §6.7 ② 백필 불필요 |
| ④ | `teams` 마스터 | 5팀 전부 `active=true` | 비활성 팀 경로는 현재 실데이터 없음(테스트로만 검증) |
| ⑤ | 폴더 깊이 분포 | 1단 5개, 2단 9개 (최대 2단) | 3단 이상 미존재 — `folder_path`가 처음으로 3단+를 만든다 |
| ⑥ | 외부 연동 회의록 | `ddobak:` 19건, 미연결 21건 | §8 재편철 대상 19건 규모 |
| ⑦ | `update_minute_metadata_with_wiki_retraction` | allowlist에 `folder_id` 있음 + 적용 로직 있음 (`folder_id = v_minute.folder_id`) | ✅ **W5 마이그레이션 불필요** — 지시서 주장 실측 확인 |
| ⑧ | `v_index_content_changed` | `title` · `team_code` · `minute_date` **만**. `folder_id` 없음 | ✅ 폴더 변경만으로는 위키 재빌드 안 걸림 — 지시서 주장 실측 확인 |

**⇒ W23(§6.7 마이그레이션)은 데이터 작업이 없다.** 불변식이 이미 성립하므로 W18~W23 UI 전환을 데이터 정리 없이 착수할 수 있다. 단 **재파괴 방지 가드**(W18 루트 생성 금지)는 그대로 필요하다.

### ⚠️ 지시서에 없는 실측 관찰 1건

`update_minute_metadata_with_wiki_retraction`은 팀 검증을 **`where t.code = v_minute.team_code and t.active`** 로 한다 — 즉 **비활성 팀의 회의록은 `replace` 경로(메타 갱신)가 실패한다.** `folder_path`와 무관한 기존 동작이고 현재 비활성 팀이 0개라 실데이터 영향은 없다. §3.2 각주의 "비활성 팀" 논증은 **정규화 분기**에 관한 것이라 이 제약과 별개지만, 지시서 §10 수용기준의 「비활성 팀 시나리오」를 **replace가 아니라 신규 등록(insertNew)으로 검증**해야 한다. → 확인 필요 Q1

---

## 3. 작업 항목

상태: TODO / DOING / DONE / BLOCKED

### 3.1 코어 — `folder_path` 계약 (§3·§4)

| # | 담당 파일 | 작업 | 상태 | 검증 | 커밋 |
|---|---|---|---|---|---|
| **W8** | `docs/design/dflow-minutes-upload-api-spec.md` | 계약 개정 §3·§8·§9 + 충돌 문장 3개 정리 + E1~E3 반영 | **DONE** | tsc·lint·vitest | `4387576` |
| **W1** | `src/lib/minutes/externalApi.ts` | `folderPath`·`folderPathProvided` + §3.1 검증 | **DONE** | tsc·lint·vitest | `c769ee5` |
| **W1-b** | `src/lib/minutes/externalApi.ts` | `validateMinuteInput(..., activeTeamCodesSync())` 주입 | **DONE** | tsc·lint·vitest | `c769ee5` |
| **W2** | `src/lib/minutes/folders.ts` | `resolveFolderPath` — §3.2 정규화 + 순차 해석 | **DONE** | tsc·lint·vitest | `c769ee5` |
| **W3** | `src/app/api/v1/minutes/route.ts` | `insertNew`가 `resolveFolderPath` 사용 | **DONE** | tsc·lint·vitest | `c769ee5` |
| **W4** | `src/app/api/v1/minutes/route.ts` | `respondMinute`에 `folder_id`·`folder_path`(둘 다 nullable — E1) | **DONE** | tsc·lint·vitest | `c769ee5` |
| **W5** | `src/app/api/v1/minutes/route.ts` | `handleExisting` metadata에 `folder_id`(3값 규약) | **DONE** | tsc·lint·vitest | `c769ee5` |
| **W6** | `src/app/api/v1/minutes/folder/route.ts` (신규) | 일괄 재편철 배치 엔드포인트 (§8) | **DONE** | tsc·lint·vitest | `afc1943` |
| **W24** | `src/app/api/v1/minutes/route.ts` | ★ E3 신규 — `include_archived` 파라미터 + `archived` 필드 (§9.7 (a)) | **DONE** | tsc·lint·vitest | `c769ee5` |
| **W9** | `tests/` | 각 항목의 일부로 취급(별도 항목 아님) | **DONE** | tsc·lint·vitest | `각 항목` |

### 3.2 연결 초기화 (§9)

| # | 담당 파일 | 작업 | 상태 | 검증 | 커밋 |
|---|---|---|---|---|---|
| **W10a** | `src/app/actions/minutes.ts` | `clearMinuteExternalId` 서버 액션 (§9.4) | **DONE** | tsc·lint·vitest | `7df6c52` |
| **W10b** | `src/components/minutes/MinuteMetaModal.tsx` | 연동 식별자 표시 + 초기화 버튼 + 확인 다이얼로그 | **DONE** | tsc·lint·vitest·build | `e682f17` |

### 3.3 폴더 중심 UI 재편 (§6)

| # | 담당 파일 | 작업 | 상태 | 검증 | 커밋 |
|---|---|---|---|---|---|
| **W18** | `src/app/actions/minutes.ts:587` | `createMinuteFolder` — `parentId === null` 거절 | **DONE** | tsc·lint·vitest | `7df6c52` |
| **W19** | `src/components/minutes/MinuteUploadModal.tsx` | 담당·하위 구분 제거 → 폴더 트리 피커(필수) | **DONE** | tsc·lint·vitest·build | `e682f17` |
| **W20a** | `src/components/minutes/MinuteMetaModal.tsx` | 담당·하위 구분 제거 → 폴더 트리 피커 | **DONE** | tsc·lint·vitest·build | `e682f17` |
| **W20b** | `src/app/actions/minutes.ts:673` | `moveMinuteToFolder` — 팀 넘어 이동 시 `team_code` 동반 + 메타 RPC | **DONE** | tsc·lint·vitest | `7df6c52` |
| **W21** | `src/app/actions/minutes.ts` (신규) | `moveMinuteFolder` — `pmo_admin` 전용, 가드 M1~M5 | **DONE** | tsc·lint·vitest | `7df6c52` |
| **W22** | `src/components/minutes/MinutesExplorer.tsx` | 회의록·폴더 D&D + 드롭 가능 시각 표시 | **DONE** | tsc·lint·vitest·build | `e682f17` |
| **W23** | 마이그레이션 | §2 조사 결과 **불변식 이미 성립 → 데이터 작업 없음** | **DONE** | tsc·lint·vitest | `—(불필요)` |

---

## 4. 순서 제약

1. **W8** (계약서 개정) — 착수 전 선행
2. **W1 → W1-b → W2 → W3 → W4 → W5** (코어 체인)
3. **W6** — W2 완료 후. E2에 따라 W1~W5와 **함께** 배포한다
4. **W24** — W1~W5와 독립(같은 파일이라 순차 편집)
5. **W10a → W10b** — W6과 독립
6. **W18 → W19 · W20a**, **W20b · W21 → W22**

---

## 5. 절대 금지 (§2 C1~C6 · §5)

- C1 `team_code` 컬럼·인덱스·필터 제거 금지
- C2 외부 API가 루트 폴더 생성 금지
- C3 폴더 생성에 `ON CONFLICT` 금지 (부분 인덱스 → 42P10). pre-select → insert → `23505` 재조회
- C4 자동 생성 폴더의 `created_by`를 null로 두지 말 것 (null = 시드 표식)
- C5 폴더명 60자 사전 검증, 절단 금지
- C6 깊이 5 존중
- 스키마 마이그레이션 추가 금지
- 신규 엔드포인트는 `POST /api/v1/minutes/folder` 1개뿐 (W24는 기존 라우트 **파라미터** 추가라 해당 없음)
- 운영 DB 쓰기 금지 (읽기 전용 조사만 완료 — §2)

---

## 6. 확인 필요 (팀장 판단)

| # | 질문 | 근거 |
|---|---|---|
| ~~**Q1**~~ | ~~비활성 팀 시나리오 수용기준의 검증 경로~~ → **종결.** 결정 §6이 "비활성 팀은 `replace`·`insertNew` 양쪽 모두 실패하므로 수용기준 귀속을 **§8(배치)** 로 옮긴다"로 확정했다(테스트 이미 존재). 재전송 실패는 500 → **400 `team_inactive`** 로 매핑 완료 | 결정 §6 |
| **Q2** ⚠️ | **§6.8 수용기준 「회의록 D&D 다른 팀으로 이동 → team_code 갱신 **&&** 위키 철회·재빌드 발생」은 현재 스키마로 달성 불가다.** RPC의 `wiki_rebuild_required := old_project_id is distinct from new_project_id or v_chronology_changed` — **`team_code`가 빠져 있다**(실측: 함수 정의 237–238행). `team_code`는 `v_index_content_changed`(109–111행)에만 들어가고 그 분기는 `queue_minute_ai_index_scope_change(..., 'upsert', ...)` 즉 **검색 인덱스(ai_documents) 재적재**만 한다. 프로젝트가 안 바뀌는 순수 팀 이동은 위키 철회가 일어나지 않는다.<br>**구현은 RPC 경유로 했다** — raw update보다 명백히 옳다(raw update는 ai_documents가 옛 team_code로 남는다). **수용기준 문구를 「검색 인덱스 재적재 발생」으로 정정할지**, 아니면 팀 이동 시 `rebuildProjectWikiFromActiveMinutes`를 명시 호출할지 팀장 판단 필요. | 실측 |
| ~~**Q3**~~ | ~~배치 `status` 사유 2개 추가~~ → **종결.** 계약 v2.4에 반영하고 또박또박 통보 목록(§7-5)에 등재했다 | 설계 |

**Q2만 남아 있다.** 결정 정본이 Q2를 직접 다루지 않았다 — §6.8 수용기준 「다른 팀으로 이동 → 위키 철회·재빌드」는
`wiki_rebuild_required`에 `team_code`가 없어 현재 스키마로 달성 불가다(실측). 구현은 RPC 경유(검색 인덱스 재적재)로
했고 raw update보다 명백히 옳지만, **수용기준 문구 정정 여부**는 여전히 팀장 판단이다.

---

## 7. 또박또박에 통보할 것 (§11.2 차수 기준)

> ⚠️ **이 절은 결정 정본 도착 전에 쓴 것이다.** 또박또박 요청의 **정본은
> `dflow-decisions-final-2026-07-27.md` §7(체크리스트 11건)** 이며, 아래와 어긋나면 그쪽이 이긴다.
> 아래는 D'Flow 구현 관점의 보조 목록으로 남긴다.

D'Flow 측은 **W1~W6·W24가 한 브랜치에 다 들어 있다.** 즉 배포되는 순간 또박또박의 2차·3차 전제가
**동시에** 풀린다. E2(재편철을 전송 전환보다 앞세움)에 따라 순서는 또박또박이 지킨다.

| # | 통보 내용 | 근거 |
|---|---|---|
| **1** | **정본 계약서가 v2.3으로 개정됐다.** 또박또박 사본(v2.1)을 이 파일로 동기화할 것(반대 방향 금지). 접두 제목·`folder_path` 부재·"해제 API 없음" 3개 문장이 이번에 뒤집혔다 | §4 ⚠️ W8 |
| **2** | **`W6`(배치)가 `W1~W5`와 함께 나간다** → 3차(재편철)를 2차(전송 전환)보다 **먼저** 실행할 수 있다. E2 결정대로 그렇게 할 것. §11.2 차수표와 §11.3 ⑤를 이 결정으로 개정해야 한다 | E2 |
| **3** | **응답 타입을 nullable로** — `folder_id: string \| null`, `folder_path: string[] \| null`. 둘 다 `null`이면 **미분류**다. `[]`는 응답으로 오지 않는다(경로는 최소 `[팀코드]`). `[]`로 받아 "팀 루트 편철됨"이라 안내하면 **정반대**다 (= `ddobak-W9` + §11.3 ⑥) | E1 |
| **4** | **`ddobak-W8`(응답 `folder_path` 표시)을 필수로 승격**해 달라. D5로 사전 미리보기를 포기했으므로 이 에코가 **유일한 사후 피드백**이고, 깊이 5 절단과 '한 칸 내림'은 이것 없이는 사용자에게 영영 안 보인다 | §11.3 ② |
| **5** | **배치 `status` 사유 2개 추가** — `failed(folder_error: …)`, `failed(update_failed: …)`. **DB 실패 계열이라 재실행으로 해소된다.** 기존 4개(`team_mismatch`·`folder_name_too_long`·`validation_failed`·`no_team_root`)는 입력·전제 문제라 재실행해도 같다. 이 구분으로 재시도 대상을 갈라야 한다 | Q3 |
| **6** | **dry run은 폴더를 만들지 않는다** → 목표 폴더가 아직 없으면 `status: "moved"` + **`folder_id: null`** + `to`에 목표 경로. `folder_id`가 채워져 오면 그 폴더가 이미 실재한다는 뜻이다 | §8.2-8 |
| **7** | **`include_archived=true` + 응답 `archived` 필드가 생겼다**(§9.7 (a) 채택). `exists_on_dflow: false`를 "초기화됨"으로 단정하지 말고, `GET /minutes?external_id=…&include_archived=true`로 **보관 여부를 구분**해 "D'Flow에서 보관됨 — 복원 후 다시 시도"를 안내할 것. `ddobak-W14` 문구와 `ddobak-W15`의 `RELINK_RESET` 분류가 이것에 직결된다 | E3 |
| **8** | **`ddobak-W14`·`ddobak-W17`을 1~2차로 앞당길 것**(§11.3 ⑦). 둘 다 D'Flow 변경이 0인데, `ddobak-W14`는 D'Flow `W10`(연결 초기화)이 만드는 위험의 **완화책**이라 지금 배치는 완화책이 위험보다 뒤에 있다 — 그 사이 초기화 → 또박또박은 '연결됨' 표시 → 재전송 → **중복 생성 + 원본 고아**가 자가 치유되지 않는다 | §11.3 ⑦ |
| **9** | 배치 실행 계정(`ACTOR_EMAIL`)을 **사전 합의**할 것 — 그 계정이 재편철로 생기는 폴더의 `created_by`가 된다. 전용 서비스 계정으로 돌리면 그 트리를 일반 사용자가 개명·삭제할 수 없다(§12 미해결 항목) | §12 |

### 아직 남은 것 (D'Flow)

- **런타임 스모크 미실시** — 로컬 dev 서버가 프로덕션 DB를 공유하고(D-CUBE 데이터 보호), 운영 쓰기는 금지라
  `POST /minutes`(folder_path)·`POST /minutes/folder`의 실호출 검증을 하지 않았다. 단위·통합 테스트로만 덮여 있다.
  **전용 테스트 프로젝트 또는 스테이징에서 §14.3 E6~E10 시나리오를 돌려야 한다.**
- **배포 안 됨** — `origin` 에는 있으나 `main` 미머지라 프로덕션에 나가지 않았다. 머지·배포는 별도 결정.
- §12 미해결 항목 **정정(2026-07-28)** — 종전 「그대로다」는 거짓이었다. 결정 정본 §2-C·§6 으로 다음이 해소됐다:
  **깊이 절단 정책 정본화**(`folder_path_status` 신호 추가) · **폴더 삭제 가드**(자식·회의록을 부모로 승격 후
  삭제) · **구버전 replace 의 team 불일치**(새 팀 루트로 이동, 계약 §4.5-11).
  남은 것은 **별건 티켓 4개**다: 폴더 권한을 `created_by`에서 분리 / 깊이 정책 3중 분기 통일 /
  zip 그룹핑 축을 제목→폴더 / 오매칭 후 본문 복구(4차 착수 조건).


---

## 8. R1 결정 패키지 (결정 정본 `dflow-decisions-final-2026-07-27.md` 반영, 2026-07-27)

PMO 결정 문서가 도착해 **D'Flow 담당 전량**으로 지정된 항목을 구현했다. 커밋 `2d97289`·`6e97be6`.

| 항목 | 결정 절 | 구현 |
|---|---|---|
| **W25** `MINUTES_FOLDER_PATH_ENABLED` | §2-A | 기본 `false`. 꺼져 있으면 `POST /minutes`가 `folder_path`를 **키 부재와 동일하게** 취급(검증 400도 없음) → **R1 배포는 전송 동작을 1비트도 바꾸지 않는다.** 배치·`include_archived`는 항상 활성 |
| **조상 규칙** | §2-J | 배치 판정을 "팀 루트냐"에서 "현재 위치가 목표 경로의 **조상**이냐"로 교체. 실측상 연동 19건 중 **17건이 이미 사람 손으로 하위 폴더에 정리**돼 있어 종전 기준으로는 전부 `manual_placement`로 막혔다 |
| **`folder_path_status`** | §2-C | `exact`/`truncated`/`partial`/`unclassified`를 등록 응답·배치 `results[]`에 |
| **배치 건별 검증** | v2.4 ⑥ | `items[].folder_path`·`team` 오류를 요청 전체 400 → **건별 `failed`**. 계약 위반 수정 |
| **배치 `pmo_admin` 게이트** | §2-H | `403 forbidden_role`. `ACTOR_EMAIL` 오타가 실재하는 다른 직원을 가리켜도 조용히 성공하던 구멍 |
| **폴더 삭제 가드** | §6 (R1 선행) | **비우기 우선** — 자식 폴더·회의록을 부모로 승격 후 삭제. 종전 cascade는 회의록을 미분류로 강등 |
| **폴더명 NFC** | v2.4 ⑧ | 외부 API·UI 생성·개명 전부. macOS NFD가 중복 폴더를 만들던 문제 |
| **구버전 replace team 불일치** | §6 | `folder_path` 키 부재 + team만 바뀐 재전송은 새 팀 루트로 폴더 이동 |
| **비활성 팀 500 → 400** | v2.4 ⑨ | `team_inactive` + 명시 사유 |
| **`from` nullable** | §2-D | 배치 응답 `from: string[] \| null` |

### 적대적 리뷰 결과 (3관점 감사 + 20 에이전트 검증)

발견 17건 중 **확정 10 / 기각 7**(검증 후 전부 low로 하향). **확정 10건 전부 수정 완료**:

- 배치가 `skip`할 건의 목표 트리를 **판정 전에 생성**하던 문제(3명이 독립 발견) → 판정은 `create:false`, 생성은 이동 확정 후
- `items[].folder_path` 봉투 400 → 건별 `failed` (R1 패키지에서 이미 해소)
- **`replace`의 부분 편철이 회의록을 조상으로 강등**하던 문제 → 기존 위치 유지 (배치가 금지한 동작과 일관)
- `team_code` ↔ `folder_id` 정합을 **서버가 검증하지 않던** 문제(2명) → 폴더에서 파생, 파생 불가 폴더는 거절
- `moveMinuteToFolder`가 `folderId=null` 수락 → 거절(§6.3 서버 강제)
- `fetchMinuteFoldersLite`가 조회 실패를 빈 배열로 위장 → `null` 반환

기각 7건에는 "ACTOR 폴더 소유권"(결정 §2-H가 의식적으로 채택한 설계 + `pmo_admin` 게이트로 보강),
"`.in()` 이스케이프", "`subtreeHeightOf` 순환"(짝인 `folderDepthOf`가 포화해 합산 판정이 거부) 등이 포함된다.


---

## 9. ⚠️ 배포 구조 — 이 브랜치는 R1과 R4를 **함께** 담고 있다

결정 §3 배포 순서 정본은 이렇게 나눈다:

- **R1** = 계약 v2.4 + `W1`~`W6`·`W24` + `W25`(플래그 `false`) + 조상 규칙 + 폴더 삭제 가드 + 배치 400 경계 + NFC
- **R4** = `W18`~`W23` 폴더 중심 UI 재편(D&D) — **재편철 1회차 완료 후**(결정 §2-A C-2 승인)

**그런데 `feat/minutes-folder-path` 브랜치 하나에 둘 다 있다.** 그대로 머지·배포하면 R4가 R1과 함께 나간다.

### 왜 문제인가 (결정 §2-A C-2)

D&D를 재편철 1회차보다 먼저 열면 사용자들이 정리 차원으로 회의록을 옮기기 시작하고,
그 건들이 3차 재편철에서 `manual_placement`로 skip된다 → **부분 일치 상태가 '마이그레이션 완료'로 보고**된다.
조상 규칙(§2-J)이 이 위험을 **줄이기는 하지만 없애지는 못한다** — 사용자가 목표의 형제·자손 가지로 옮기면 여전히 skip이다.

### 선택지 (팀장 판단)

| 안 | 내용 | 비용 |
|---|---|---|
| **(a) 브랜치 분리** | `W18`~`W23`(UI) 커밋을 떼어 별도 브랜치로. R1만 먼저 머지 | 커밋이 서버/UI를 오가며 얽혀 있어(`7df6c52`가 W18·W20b·W21을, `cd057a1`이 공용 기반을 담음) **체리픽 수술이 필요**하다. 실수 여지 있음 |
| **(b) 함께 배포하고 운영으로 통제** | R1+R4를 함께 내되, **재편철 1회차 dry-run·APPLY가 끝날 때까지 사용자에게 D&D 사용 자제를 공지** | 코드 0. 사람 규율에 의존 |
| **(c) UI에도 플래그** | `W25`와 같은 방식으로 D&D를 env 플래그 뒤에 둔다 | 코드 소량. 결정이 요구하지 않은 범위 확장 |

**권고: (c)** — 이미 `W25`로 같은 패턴을 썼고, (b)의 사람 규율보다 확실하며 (a)의 수술 위험이 없다.

### ✅ 결정됨 (2026-07-28) — **(c) 채택**

`MINUTES_FOLDER_DND_ENABLED`(기본 `false`)를 신설했다. R1+R4를 함께 머지해도 D&D 는 닫혀 있고,
재편철 1회차 APPLY 후 **env 만 켜면 개방**된다(코드 배포 불필요).

| 층 | 구현 |
|---|---|
| 플래그 | `src/lib/minutes/flags.ts` `folderDndEnabled()` — `NEXT_PUBLIC_` 아님(서버 전용) |
| 서버 | `moveMinuteFolder`(actions/minutes.ts) 최상단 게이트. **인증보다 앞** — 미로그인도 같은 사유로 거절하고 DB 를 건드리지 않는다 |
| UI | `page.tsx` 에서 평가해 `MinutesView` → `MinutesExplorer` 로 prop 전달. 폴더·회의록 `draggable` 과 드롭 핸들러가 닫힌다 |
| 테스트 | `tests/actions/minutes-dnd-gate.test.ts` 6건 (기본 닫힘 · `'true'` 외 전부 닫힘 · 게이트가 인증보다 앞 · 통과 시 기존 검증으로) |

**범위는 D&D 한정이다.** 다음은 그대로 열려 있다 — 결정이 막으려던 것은 "정리 차원의 대량 이동"이고,
아래는 의도적인 단일 조작이라 드래그처럼 무심코 일어나지 않는다:

- [이동] 버튼의 폴더 픽커(`moveMinuteToFolder`) — 액션에 게이트를 걸지 **않았다**
- 업로드·수정 모달의 폴더 트리 선택(`W19`·`W20a`)
- 폴더 생성·개명·삭제(`FolderManageModal`)

> ⚠️ 클라이언트에서 `process.env.MINUTES_FOLDER_DND_ENABLED` 를 직접 읽지 말 것 — `NEXT_PUBLIC_` 접두가
> 없어 번들에서 항상 `undefined` 이고, 서버가 켜져 있어도 UI 만 조용히 닫힌다. 반드시 서버에서 평가해 prop 으로 내린다.

---

## 10. 감사 대응 (2026-07-28) — 결정 정본 대비 잔여 공백

인수인계 문서가 "구현 전 항목 완료"로 기록했으나, 결정 정본 R1 범위를 항목별로 코드와 대조해
**33건 구현 확인 · 확정 공백 9건**을 얻었다(오탐 0). 아래를 처리했다.

| # | 공백 | 조치 |
|---|---|---|
| 1 | **폴더 삭제 안내 문구가 실제 동작과 정반대** — 코드는 부모로 승격하는데 i18n 은 "미분류로 이동"이라 안내 | `min.fold.deleteConfirm` ko/en 정정 + 동명 충돌 중단 안내 추가 |
| 2 | **UI 60자 검증이 NFC 적용 전 길이 기준** — NFD 한글은 길이가 2~3배라 20자 폴더명이 UI 에서 거절되는데 외부 API 로는 통과 | `validateFolderName` 이 `normalizeFolderName` 을 거쳐 판정. 회귀 테스트 2건 |
| 3 | **NFC 정규화가 SSOT 아님** — `externalApi.ts` 가 `seg.trim().normalize('NFC')` 를 인라인 복제(계약 §4.9 는 "모두 같은 함수를 통과"라고 약속) | `normalizeFolderName` 호출로 통일 |
| 4 | **팀 변경 재전송(§6) 테스트 0건** | 4건 추가 — 이동/미이동/팀 루트 부재/`folder_path` 우선 |
| 5 | **`folder_path_status` POST 응답 테스트 0건** (배치만 검증돼 있었다) | 4건 추가 — `exact`·`truncated`·`unclassified`·`partial` |
| 6 | **계약 §4.8·결정 §2-A 의 "1비트도 바꾸지 않는다"가 거짓** — §4.5-11 팀 이동이 플래그 밖 | 두 문서에 예외 명시(계약 표에 행 추가 + 결정 문서에 정정 주석) |
| 7 | **R4 D&D 게이트 없음** | §9 (c) 채택 — 위 참조 |
| 8 | **Q2 §6.8 수용기준이 스키마상 달성 불가** | 「검색 인덱스 재적재」로 정정 + 근거 주석 |
| 9 | 진행 원장 실상태 불일치(테스트 수·푸시 여부·§12 잔여) | 이 문서 갱신 |

**§2-B 예비안(`external_id` 정확 조회 archived 면제)은 의도대로 미구현**이다 — 또박또박이 호출부 3건을
못 고친다는 회신이 오기 전까지 손대면 안 되는 조건부 항목이다.
