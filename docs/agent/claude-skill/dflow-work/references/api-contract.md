# D'Flow Agent API 계약 v2.1

`contract_version: "2.1"` — v1(전역 시크릿) 계약은 불변 유지, v2는 PAT 축 추가. v2.1은 stage 워크플로 재설계(0079) 반영.

## v2.1 변경점 (2026-08-13)

stage 워크플로 재설계(마이그레이션 0079)를 계약에 반영. **엔드포인트·인증·payload 형식은 v2.0과 동일** — 아래 5가지는 전부 stage 어휘·주문 발행 조건·자동 전이에 관한 의미론 변경이다.

| # | 변경 | v2.0 | v2.1 |
|---|---|---|---|
| 1 | stage enum | `todo\|as\|fp\|ip\|im\|xx` | `as\|fp\|ip\|im\|xx` 또는 `null`(미착수). `todo`는 과도기 하위호환으로만 수용 — 서버가 null로 정규화(app 레이어 `toRpcNode` + DB RPC `import_wbs_upsert` 이중 방어). `""`도 기존대로 null 취급 |
| 2 | import의 dev_workflow | 없음(전 항목 false) | `kind:"task"` 노드는 서버가 `dev_workflow=true` 자동 설정(신규·재업로드 갱신 모두). `wp\|act\|phase`는 항상 false. payload에 `dev_workflow` 필드 없음(무변경) |
| 3 | 주문 존재 조건 | "배정된 리프"에만 존재 | "dev_workflow ON인 리프"에는 배정 여부와 무관하게 주문이 존재. 미배정 task도 발행되어 `mine?scope=available` 구획에 노출 |
| 4 | stage 자동 전이 | 없음(claim 시 as→ip 전이는 미결 ⑪로 보류) | 배정·claim·완료보고·승인 4개 이벤트에 자동 전이 배선(아래 표). 전부 dev_workflow=true 항목 한정, 반려는 무전이 |
| 5 | 파일 표기 매핑 | `[ ]`↔`todo` | `[ ]`↔`null`(구 todo 열 제거). 진척 환산 0(null)/0/0/20/60/100 |

## 인증

- `Authorization: Bearer <값>`. 값이 `AGENT_API_SECRET`과 일치 → legacy principal.
  값이 `dflow_pat_` 접두 → PAT principal. 그 외 401.
- PAT 형식: `dflow_pat_<prefix 12자 영숫자>_<secret base64url 43자>`. DB에는 sha256(전체) hex만.
- 킬스위치: `AGENT_API_ENABLED !== 'true'` → 전 라우트 404. 시크릿 미설정 → legacy 분기만 닫힘.
- PAT 검사 순서: enabled → revoked_at → expires_at → hash(상수시간).
- PAT 요청 body의 `user_email`: 없으면 무시, 있는데 소유자와 다르면 400 `identity_mismatch`.
- 스코프: `work:read`(조회) · `work:claim`(claim/release) · `work:report`(report). 부족 시 403 `insufficient_scope`. legacy는 스코프 개념 없음(v1 동작).
- PAT는 `project_id` 지정 시 그 프로젝트만. 멤버십: PAT principal은 모든 조회·쓰기에서 `is_superuser` 또는 `project_roles` 보유 필요, 아니면 404.

## 엔드포인트 (v1 5개 불변 + 신규 3개)

| 메서드·경로 | 신원 | 요지 |
|---|---|---|
| GET `/api/v1/agent/work?project_id=` | legacy·pat | v1 계약 그대로. PAT는 멤버십·스코프 강제 |
| GET `/api/v1/agent/work/{id}` | legacy·pat | v1 + PAT 호출 시 `mine:boolean`·`claimed_by_user_email` 추가 |
| POST `/api/v1/agent/work/{id}/claim` | legacy·pat | PAT: `claimed_by_user_id` 서버 유도 기록. 배정 항목은 담당자만(403 `not_assignee`) |
| POST `/api/v1/agent/work/{id}/release` | legacy·pat | 소유 판정: PAT=claimed_by_user_id, legacy=claimed_by 라벨. 교차 403 `not_claim_owner` |
| POST `/api/v1/agent/work/{id}/report` | legacy·pat | 위와 같음 + PAT는 `evidence` 객체 허용 |
| GET `/api/v1/agent/me` | **pat 전용** | legacy 호출 400 `identity_required` |
| GET `/api/v1/agent/work/mine?scope=&limit=` | **pat 전용** | scope: `available`(기본)·`claimed`·`all`·`assigned` |
| POST `/api/v1/wbs/import` | **pat 전용** | export JSON upsert. 스코프 `work:report` 필요 |

## 응답 셰이프 (신규분)

`GET /agent/me` 200:
```json
{ "ok": true, "user_email": "a@b.c", "scopes": ["work:read"], "kind": "user_pat",
  "token_expires_at": "2026-11-08T00:00:00Z", "contract_version": "2.1",
  "projects": [{ "id": "<uuid>", "name": "…", "role": "admin|member|superuser" }] }
```
응답의 `contract_version`은 `src/lib/agent/externalApi.ts`의 `AGENT_CONTRACT_VERSION` 상수 값이다 — v2.1 재설계와 함께 `"2.1"`로 갱신됐다.
`projects`는 `agent_projects.enabled=true` ∩ 내가 멤버인 프로젝트만(미등록은 목록에서도 은닉).

`GET /agent/work/mine` 200:
```json
{ "ok": true, "scope": "all",
  "claimed": [ { "id": "…", "project_id": "…", "status": "claimed", "priority": 0,
                 "instructions": "…", "claimed_at": "…", "item": { "id": "…", "code": "…", "name": "…" } } ],
  "available": [ …같은 셰이프… ], "assigned": [ …같은 셰이프… ] }
```
요청 scope에 해당하는 구획만 채운다(`available`이면 `available`만). 정렬은 구획 내 `priority desc, created_at asc`. `limit` 기본 20 최대 100(구획별 적용). 미지원 scope → 400 `unsupported_scope`.

`POST /wbs/import` 요청( `wbs-parse.py --export` 출력 v2 + 2필드) — **계약 v2 확장(결정 E, 두 리포 공통·고정)**:
```json
{ "project_id": "<uuid>", "module": "MES",
  "nodes": [ { "id": "TSK-01-01", "parent_id": "WP-01", "kind": "task|wp|act|phase",
               "title": "…", "stage": "as|fp|ip|im|xx|null", "category": "dev",
               "domain": "fullstack", "assignee": "a@b.c", "schedule": "2026-08-11 ~ 2026-08-14",
               "depends": ["TSK-01-00"], "acceptance": ["…"],
               "priority": "critical|high|medium|low",
               "model": "opus", "tags": ["contract"],
               "prd_ref": "docs/prd.md#3.2", "entry_point": "src/app/(app)/wbs/page.tsx",
               "spec_sections": { "requirements": ["…"], "test_criteria": ["…"],
                 "constraints": ["…"], "api_spec": "…|null", "data_model": "…|null",
                 "description": "…|null" } } ] }
```
`external_ref` = `<module>/<id>` (예: `MES/TSK-01-01`).
- **stage(v2.1)**: `as|fp|ip|im|xx` 또는 미기재·`""`·null → 서버가 null(미착수)로 저장. **`"todo"`도 과도기 하위호환으로 수용해 null로 정규화**한다(app 레이어 `toRpcNode` + DB RPC `import_wbs_upsert`의 `case when … in ('', 'todo') then null` 이중 방어 — 부트스트랩이 서버 배포 전후 어느 쪽 export 를 올려도 결과가 같다). `todo`는 언제든 제거될 수 있는 호환 수용이지 정식 값이 아니다.
- **dev_workflow(v2.1, 자동)**: 클라이언트가 지정하지 않는다. 서버가 `kind:"task"` 노드에는 `dev_workflow=true`, `wp|act|phase` 노드에는 `false`를 자동 설정한다(신규 삽입·기존 행 재업로드 갱신 모두 동일 — RPC의 `on conflict … do update set dev_workflow = excluded.dev_workflow`).
- **priority는 문자열 라벨.** 주문 정수 priority 매핑(계약 고정): `critical=100 · high=50 · medium=10 · low=0` (미기재·미지 라벨=0).
- **spec 조립**: import가 `spec_sections`를 고정 섹션 순서 — 머리말(description, 헤딩 없음) → `## 요구사항` → `## 제약` → `## 테스트 기준` → `## API 스펙` → `## 데이터 모델` — 의 마크다운으로 조립해 `wbs_items.spec`(text)에 저장한다. 빈 섹션은 생략. `acceptance[]`는 최상위 그대로 `acceptance jsonb`로.
- `depends[]`는 같은 모듈 내 노드 id — DB에는 external_ref 배열로 저장(선행 판정 키).

응답:
```json
{ "ok": true, "upserted": 12, "skipped": 3,
  "unmatched_assignees": [{ "id": "TSK-01-02", "assignee": "x@y.z" }],
  "non_leaf_skipped": [], "orders_created": 4 }
```
멱등: 같은 payload 재업로드 시 upsert 0건 갱신·주문 중복 0건. 삭제는 하지 않는다.
필드 소유권(미결 ⑫ 권고안): 신규 행 = 파일 값 전부 시드 / 기존 행 = 구조·명세(title·schedule·parent·depends·acceptance·priority·category·domain·model·tags·prd_ref·entry_point·spec·dev_workflow)만 갱신, **stage·assignee·actual_pct는 보존**(RPC의 `on conflict do update`가 `stage`·`assignee_member_id`·`actual_pct`를 갱신 목록에서 제외).

- **`non_leaf_skipped`(v2.1)**: `kind:"task"`인데 자식이 있는(비정상) 노드만 채워진다. **정상 데이터에서는 항상 빈 배열** — task는 리프라는 전제가 계약이며, 자식을 가진 task 노드가 있는 비정상 WBS에서만 값이 들어간다. 응답 필드 자체는 계약상 항상 유지한다.
- **`unmatched_assignees`와 `orders_created`는 서로 독립**이다(v2.1 — v2.0은 assignee 매칭 실패 시 주문 발행을 건너뛰었다). assignee 이메일이 로스터에 매칭되지 않아도 `kind:"task"` 노드는 담당자 없이 주문이 발행된다 — 배정은 발행 조건이 아니다(아래 "주문 존재 조건" 참조).

### 주문 존재 조건 (v2.1 재정의)

**"dev_workflow ON인 리프에는 주문이 존재한다"** — 배정 여부는 조건이 아니다(v2.0의 "배정된 리프"에서 변경). import·배정·dev_workflow 토글 등 모든 발행 경로가 공용 함수 `ensureOrderForWorkflowLeaf`를 거치며, 게이트는 다음 순서로 고정이다:

1. `agent_projects.enabled = true`(꺼진 프로젝트는 발행하지 않음)
2. `dev_workflow = true`(항목 게이트)
3. 리프(자식 없음) — 아니면 발행하지 않음
4. 활성 주문(ready·claimed·reported) 존재 여부로 멱등 판정 — 이미 있으면 재발행하지 않음(DB 부분 유니크 인덱스가 2차 방어, 23505 경합은 no-op으로 수렴)

미배정 task도 이 조건만 충족하면 주문이 발행되고, `GET /agent/work/mine?scope=available`은 assignee 유무와 무관하게 `ready` 주문 전체를 노출한다.

관리자 화면의 수동 발행(`createAgentWorkOrder`)도 이 불변식을 지킨다 — 발행 대상 항목의 `dev_workflow`가 꺼져 있으면 발행 성공과 함께 서버가 자동으로 켠다("발행 = 도입 선언").

## claim·show 응답 확장과 선행 게이트 (결정 A·C)

- `GET /work/{id}`(PAT)와 `POST /work/{id}/claim` 200 응답의 `item`에 확장 필드를 포함한다:
  `external_ref·category·domain·priority·model·tags·depends·prd_ref·entry_point·acceptance·spec·stage`.
  클라이언트는 claim 성공 시 이걸로 `docs/tasks/<TSK-ID>/spec.md` 로컬 캐시를 만든다(TSK-ID = external_ref의 `/` 뒤).
- 두 응답 모두 `depends_evidence: [{ external_ref, stage, branch|null, head_sha|null }]` 포함 —
  각 선행 항목의 **최근 approved 주문의 completion 보고 evidence**에서 추출(없으면 null).
- **서버 선행 게이트**: claim 시 depends의 선행 항목 중 `stage`가 `im` 이상(`im`·`xx`)이 아닌 것이 하나라도 있으면
  403 `dependency_not_met` + `unmet: [{external_ref, stage}]`. 선행 external_ref가 프로젝트에 없거나 stage가 null이면 미충족(fail-closed).
- **클라이언트 하드 차단**: ① claim 전 `show`의 depends_evidence로 `git cat-file -e <sha>` + `git merge-base --is-ancestor <sha> HEAD` 검사 — 미도달이면 메시지 출력 후 **실행 거부(exit 4)**. ② `done`은 `git ls-remote`로 현재 브랜치 tip이 원격에 도달했는지 확인 — 미도달이면 **보고 거부(exit 2)**. "완료 = push 완료"가 클라이언트 계약이다.

## 상태 어휘 매핑 (§7.2-2, v2.1)

파일 `[ ]`/`[as]`/`[fp]`/`[ip]`/`[im]`/`[xx]` ↔ DB `stage` `null/as/fp/ip/im/xx`(구 `todo` 열 제거, `[ ]`는 `null`) ↔ 진척 환산 0(null)/0/0/20/60/100(산식 정본은 D'Flow, 미결 ③ 승인 전 환산 미적용).
전이 권한: 사람 전용 = assign/unassign/force/unforce/accept · 에이전트 = cycle.start/*.ok/*.fail/bypass. 에이전트 API에 사람 전용 이벤트 없음(도입 시 403 `human_gate`).

UI 라벨 정본(참고 표기용, `dev-workflow state-machine.json` 기준): `as`=할당됨 · `fp`=강제 진행 · `ip`=진행 중 · `im`=구현 완료·검수 대기 · `xx`=완료.

### stage 자동 전이 표 (v2.1 신설)

모두 **`dev_workflow=true` 항목 한정** — 공용 함수 `transitionStage`가 dev_workflow 게이트·`fromIn`(현재 stage 제약)·`change_logs` 기록을 담당한다. `progress` 보고는 stage에 무간섭.

| 이벤트 | to | fromIn(현재 stage가 이 안에 있을 때만 전이) | 비고 |
|---|---|---|---|
| 배정(담당자 지정) | `as` | `null`만 | 이미 진행 중인 항목(as 이후)은 배정해도 stage 유지 |
| 배정 해제 | `null` | `as`만 | `ip` 이상은 해제해도 stage 유지(진행분 보존) |
| claim(착수) | `ip` | `as`·`fp`·`null` | **`im`에서는 전이하지 않는다** — 반려 후 재작업은 `im` 유지, claim이 되돌려놓지 않음 |
| 완료보고(completion) | `im` | `ip`·`as`·`fp`·`null` | `progress` 보고는 이 표에 해당 없음(전이 없음) |
| 승인(accept) | `xx` | `im`·`ip`·`as`·`fp`·`null` | 사람 검수 통과가 곧 완료(accept는 사람 전용 이벤트) |
| 반려(reject) | — | — | **stage 무변경** — 주문만 `reported`→`claimed`로 되돌린다. `im` 그대로 유지 |

`im`/`xx` "처음 도달" 시(역전이·재설정 제외) depends 역참조로 후행 담당자에게 `work.unblocked` 알림이 발행된다(§2.10, 다중 depends는 전부 도달 시 1회).

## 에러코드 전수

| HTTP | code | 의미 |
|---|---|---|
| 400 | `validation_failed` | 형식 오류(v1 관례) |
| 400 | `identity_mismatch` | PAT 소유자 ≠ body user_email |
| 400 | `identity_required` | PAT 전용 엔드포인트에 legacy 호출 |
| 400 | `unsupported_scope` | mine의 미지원 scope |
| 401 | `unauthorized` | 시크릿·PAT 불일치/만료/폐기 |
| 403 | `forbidden_role` | 멤버 아님(쓰기 경로 v1 관례) |
| 403 | `not_claim_owner` | 점유 소유자 아님(교차 소유 포함) |
| 403 | `insufficient_scope` | PAT 스코프 부족 |
| 403 | `not_assignee` | 배정 항목을 타인이 claim |
| 403 | `dependency_not_met` | 선행(depends) stage 미충족 claim (결정 C — `unmet[]` 동반) |
| 404 | — | 꺼짐/미등록/비멤버/없음(의도적 비구분) |
| 409 | `conflict` | CAS 충돌·상태 불일치 |
| 409 | `apply_failed` | WBS 반영 실패 |
| 409 | `wbs_item_missing` | 항목 삭제된 주문 |

## 로컬 클라이언트 계약

- env: `DFLOW_API_BASE`(기본값 없음 — 미설정 시 즉시 실패) · `DFLOW_PATS`(쉼표 구분 1~N개) · `DFLOW_PAT`(단일, PATS 미설정 시 폴백).
- `dflow.sh` exit code: 0 성공 / 2 사용법·설정·push 미완료 / 3 인증(401) / 4 상태 충돌(409)·선행 미반영 로컬 차단 / 5 권한(403) / 6 네트워크·서버(5xx) / 7 기능 꺼짐(404).
- 신원 해석: 토큰별 `GET /agent/me` 1회 → `~/.cache/dflow/profiles.json` 캐시. `--as <이름|email>` 프로필 선택.
- evidence 자동 조립: `git rev-parse HEAD`·`git remote get-url origin`·`git branch --show-current`·(`gh` 있으면) PR URL.
