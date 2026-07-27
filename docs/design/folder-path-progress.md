# folder_path 작업 원장 — `dflow-folder-path-worklist-2026-07-27.md` 구현 진행

> 이 파일이 유일한 진행 기억이다. 매 턴 먼저 읽고 마지막에 갱신한다.
> 지시서: `docs/design/dflow-folder-path-worklist-2026-07-27.md`
> 브랜치: `feat/minutes-folder-path`

---

## 0. 최종 요약

_(모든 항목이 DONE/BLOCKED가 되면 여기 채운다)_

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
| **W10b** | `src/components/minutes/MinuteMetaModal.tsx` | 연동 식별자 표시 + 초기화 버튼 + 확인 다이얼로그 | TODO | — | — |

### 3.3 폴더 중심 UI 재편 (§6)

| # | 담당 파일 | 작업 | 상태 | 검증 | 커밋 |
|---|---|---|---|---|---|
| **W18** | `src/app/actions/minutes.ts:587` | `createMinuteFolder` — `parentId === null` 거절 | **DONE** | tsc·lint·vitest | `7df6c52` |
| **W19** | `src/components/minutes/MinuteUploadModal.tsx` | 담당·하위 구분 제거 → 폴더 트리 피커(필수) | TODO | — | — |
| **W20a** | `src/components/minutes/MinuteMetaModal.tsx` | 담당·하위 구분 제거 → 폴더 트리 피커 | TODO | — | — |
| **W20b** | `src/app/actions/minutes.ts:673` | `moveMinuteToFolder` — 팀 넘어 이동 시 `team_code` 동반 + 메타 RPC | **DONE** | tsc·lint·vitest | `7df6c52` |
| **W21** | `src/app/actions/minutes.ts` (신규) | `moveMinuteFolder` — `pmo_admin` 전용, 가드 M1~M5 | **DONE** | tsc·lint·vitest | `7df6c52` |
| **W22** | `src/components/minutes/MinutesExplorer.tsx` | 회의록·폴더 D&D + 드롭 가능 시각 표시 | TODO | — | — |
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
| **Q1** | 지시서 §10의 「비활성 팀 시나리오」 수용기준을 **신규 등록(insertNew) 경로로만** 검증하면 되는가? `update_minute_metadata_with_wiki_retraction`이 `t.active`를 요구해 **replace 경로는 비활성 팀에서 원래 실패**한다(§2 실측 관찰). | 실측 |
| **Q2** ⚠️ | **§6.8 수용기준 「회의록 D&D 다른 팀으로 이동 → team_code 갱신 **&&** 위키 철회·재빌드 발생」은 현재 스키마로 달성 불가다.** RPC의 `wiki_rebuild_required := old_project_id is distinct from new_project_id or v_chronology_changed` — **`team_code`가 빠져 있다**(실측: 함수 정의 237–238행). `team_code`는 `v_index_content_changed`(109–111행)에만 들어가고 그 분기는 `queue_minute_ai_index_scope_change(..., 'upsert', ...)` 즉 **검색 인덱스(ai_documents) 재적재**만 한다. 프로젝트가 안 바뀌는 순수 팀 이동은 위키 철회가 일어나지 않는다.<br>**구현은 RPC 경유로 했다** — raw update보다 명백히 옳다(raw update는 ai_documents가 옛 team_code로 남는다). **수용기준 문구를 「검색 인덱스 재적재 발생」으로 정정할지**, 아니면 팀 이동 시 `rebuildProjectWikiFromActiveMinutes`를 명시 호출할지 팀장 판단 필요. | 실측 |
| **Q3** | 배치 응답 `status` 값 집합에 **`failed(folder_error)`·`failed(update_failed)`를 추가**했다(지시서 §8.2 요건 11 표에 없던 값). DB 실패 계열을 기존 4개 사유 중 하나로 뭉개면 거짓 보고가 되기 때문. 계약서(W8)에도 반영했다. **또박또박에 통보 필요** — 재시도 대상(DB 실패)과 사람이 고칠 대상(입력·전제)을 가르는 구분이다. | 설계 |

---

## 7. 또박또박에 통보할 것 (§11.2 차수 기준)

_(작업 완료 시 정리)_
