# D'Flow Agent API 계약 v2.0

`contract_version: "2.0"` — v1(전역 시크릿) 계약은 불변 유지, v2는 PAT 축 추가.

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
  "token_expires_at": "2026-11-08T00:00:00Z", "contract_version": "2.0",
  "projects": [{ "id": "<uuid>", "name": "…", "role": "admin|member|superuser" }] }
```
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
               "title": "…", "stage": "todo|as|fp|ip|im|xx", "category": "dev",
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
필드 소유권(미결 ⑫ 권고안): 신규 행 = 파일 값 전부 시드 / 기존 행 = 구조·명세(title·schedule·parent·depends·acceptance·priority·category·domain·model·tags·prd_ref·entry_point·spec)만 갱신, **stage·assignee·actual_pct는 보존**.

## claim·show 응답 확장과 선행 게이트 (결정 A·C)

- `GET /work/{id}`(PAT)와 `POST /work/{id}/claim` 200 응답의 `item`에 확장 필드를 포함한다:
  `external_ref·category·domain·priority·model·tags·depends·prd_ref·entry_point·acceptance·spec·stage`.
  클라이언트는 claim 성공 시 이걸로 `docs/tasks/<TSK-ID>/spec.md` 로컬 캐시를 만든다(TSK-ID = external_ref의 `/` 뒤).
- 두 응답 모두 `depends_evidence: [{ external_ref, stage, branch|null, head_sha|null }]` 포함 —
  각 선행 항목의 **최근 approved 주문의 completion 보고 evidence**에서 추출(없으면 null).
- **서버 선행 게이트**: claim 시 depends의 선행 항목 중 `stage`가 `im` 이상(`im`·`xx`)이 아닌 것이 하나라도 있으면
  403 `dependency_not_met` + `unmet: [{external_ref, stage}]`. 선행 external_ref가 프로젝트에 없거나 stage가 null이면 미충족(fail-closed).
- **클라이언트 하드 차단**: ① claim 전 `show`의 depends_evidence로 `git cat-file -e <sha>` + `git merge-base --is-ancestor <sha> HEAD` 검사 — 미도달이면 메시지 출력 후 **실행 거부(exit 4)**. ② `done`은 `git ls-remote`로 현재 브랜치 tip이 원격에 도달했는지 확인 — 미도달이면 **보고 거부(exit 2)**. "완료 = push 완료"가 클라이언트 계약이다.

## 상태 어휘 매핑 (§7.2-2)

파일 `[ ]`/`[as]`/`[fp]`/`[ip]`/`[im]`/`[xx]` ↔ DB `stage` `todo/as/fp/ip/im/xx` ↔ 진척 환산 0/0/0/20/60/100(산식 정본은 D'Flow, 미결 ③ 승인 전 환산 미적용).
전이 권한: 사람 전용 = assign/unassign/force/unforce/accept · 에이전트 = cycle.start/*.ok/*.fail/bypass. 에이전트 API에 사람 전용 이벤트 없음(도입 시 403 `human_gate`). claim 시 `as`→`ip` 자동 전이는 미결 ⑪ 잔여 — v2.0에서는 전이 없음.

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
