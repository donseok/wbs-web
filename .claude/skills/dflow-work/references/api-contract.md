# D'Flow Agent API 계약 v2.4

`contract_version: "2.4"` — v1(전역 시크릿) 계약은 불변 유지, v2는 PAT 축 추가. v2.1은 stage 워크플로 재설계(0082) 반영, v2.2는 그 뒤 버전을 안 올린 채 넓혀온 세 필드를 뒤늦게 반영. v2.3은 단계 전이 원자화(0096)·실적 크레딧·선행 충족 세 축을 반영. v2.4는 `/me` 에 토큰 이름·prefix 를 더했다.

## v2.4 변경점 (2026-09-18)

- `GET /agent/me` 응답에 `token_name`(발급할 때 적은 이름)·`token_prefix`(토큰의 셋째 `_` 칸)를 더했다. 필드 추가뿐이라
  minor 다. 이유: `.env` 에 토큰이 둘 이상이면 어느 키로 도는지 사람이 알아볼 수 없었고, 한 계정에 키가 둘이면
  이메일로도 갈리지 않는다. prefix 는 토큰 문자열 안에 평문으로 든 조회 키라 응답에 실어도 비밀이 늘지 않는다.
- 클라이언트: `dflow.sh profiles`(토큰마다 한 줄 JSON) · `.dflow.local` 의 `as=<prefix>`(레거시 `.env` 의
  `DFLOW_AS`, 리포가 쓸 키 고정) · `--as <prefix|email>`. 설계 정본: wbs-web 리포 docs/superpowers/specs/2026-09-18-dflow-key-select-design.md(킷에는 미동봉).

## v2.3 변경점 (2026-09-15)

단계 전이를 DB 트랜잭션 하나(`apply_workflow_event`, 마이그레이션 0096)로 묶고, 실적%를 사건 크레딧으로 지정한다
(설계 정본: wbs-web 리포 docs/superpowers/specs/2026-09-15-wbs-stage-credit-design.md, 킷에는 미동봉).
엔드포인트·인증·요청 형식은 v2.2 와 같다.

| # | 항목 | v2.2 | v2.3 |
|---|---|---|---|
| 1 | stage enum | `as\|fp\|ip\|im\|xx\|null` | `as\|ip\|im\|xx\|null`. 서버는 입력 `fp` 를 `ip` 로 정규화한다(과도기 — import 앱 층·DB RPC 이중). 라벨: as=할당됨 · ip=작업 중 · im=검수 대기 · xx=완료 · null=미착수 |
| 2 | progress 보고 | `actual_pct` 즉시 반영, 응답 `applied_to_wbs:true` | 보고 행만 기록한다. `actual_pct` 는 바뀌지 않고 응답은 `applied_to_wbs:false`(200 그대로). 항목이 삭제된 주문의 progress 도 기록한다 |
| 3 | claim | 주문 CAS 뒤 stage `ip` 를 따로 실행 | 한 트랜잭션: 주문 `claimed` + stage `ip` + 실적 = 크레딧 표 IP 값 |
| 4 | completion 보고 | 주문 `reported` 뒤 stage `im` 을 따로 실행 | 한 트랜잭션: 주문 `reported`(점유자 일치 조건) + stage `im` + 실적 = 크레딧 표 IM 값. 경합·오류면 보고 행을 지우고 409·500 |
| 5 | release | 주문만 `ready` | 한 트랜잭션: 주문 `ready` + 점유·heartbeat 흔적 삭제 + stage `as` + 실적 = 크레딧 표 AS 값 |
| 6 | depends_evidence | `{external_ref, stage, branch, head_sha, order_approved}` | `actual_pct`·`reached` 추가. `reached` = stage∈{im,xx} ∨ order_approved ∨ actual_pct≥100 — 서버 claim 게이트와 같은 함수(`predecessorReached`) |
| 7 | claim 게이트 | stage ≥ im ∨ order_approved | `reached:false` 인 선행이 하나라도 있으면 403 `dependency_not_met` |

⚠️ **`reached` 도 키 존재 여부로 지원을 가른다**(`'reached' in d`). 키가 없으면 v2.2 판정(stage ≥ im ∨ `order_approved`)으로
폴백하고 그 사실을 한 줄 남긴다 — 실적 100 축이 없는 옛 서버에서는 사람이 끝낸 선행이 여전히 막힌다.

크레딧 표는 프로젝트 설정 `project_settings.stage_credits` 의 `default` 하나다(없으면 기본
`as 0 · ip 30 · rw 50 · im 80 · xx 100`). 항목의 `credit_key` 는 전이 계산에 쓰이지 않는다 — 카테고리별 표는
2026-09-16(마이그레이션 0097)에 없앴다. 설정 저장은 소급하지 않는다.

## v2.2 변경점 (2026-08-28)

전부 **additive** 다 — 기존 요청은 응답이 그대로이고 클라이언트를 고칠 필요가 없다.
세 가지 모두 v2.1 시기에 서버에 들어갔는데 버전을 안 올려 계약이 코드보다 뒤처져 있었다
(2026-08-27 감사에서 드러남). 이번에 버전을 올리며 문서에 반영한다.

| # | 변경 | v2.1 | v2.2 |
|---|---|---|---|
| 1 | 목록 status 필터 | `ready` 고정 | `?status=` 로 지정(쉼표로 여럿). 미지정은 종전대로 `ready`. 허용값은 `ready\|claimed\|reported\|approved\|cancelled`, 그 밖은 400 — 조용히 버리면 오타가 "그 상태의 주문이 없다"로 위장한다. **`approved`·`cancelled` 를 돌려주는 첫 목록 경로다**: 종전에는 주문 id 를 이미 알아야만 그 주문을 볼 수 있었다 |
| 2 | 상세의 보고 evidence | 미노출 | `GET /work/{id}` 의 `reports[]` 에 `evidence` 포함 — **PAT 호출만**(`depends_evidence` 와 같은 규칙). 완료 보고가 증적을 실었는지를 DB 직접 조회 없이 볼 수 있다 |
| 3 | depends 도달 축 | `stage` 만 | `depends_evidence[]` 에 `order_approved:boolean` 추가. claim 게이트가 `stage ≥ im` **또는** `order_approved` 로 판정한다 — 재발행을 겪은 선행은 현재 주문이 `ready` 여도 과거 승인이 있으면 `true` 다 |

⚠️ **`order_approved` 는 여전히 키 존재 여부로 지원을 가른다**(`'order_approved' in d`).
2.1 서버가 현장에 남아 있고, 그 중에는 이 키를 이미 내려주는 것도 안 내려주는 것도 있다 —
버전만 보고 단정하면 틀린다. 키가 없으면 `false` 로 단정하지 말고 "판정 불가"로 갈라
stage 축만으로 판정하고 그 사실을 한 줄 남긴다.

## v2.1 변경점 (2026-08-13)

stage 워크플로 재설계(마이그레이션 0082)를 계약에 반영. **엔드포인트·인증·payload 형식은 v2.0과 동일** — 아래 5가지는 전부 stage 어휘·주문 발행 조건·자동 전이에 관한 의미론 변경이다.

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
- 스코프: `work:read`(조회) · `work:claim`(claim/release/report/import). 부족 시 403 `insufficient_scope`. legacy는 스코프 개념 없음(v1 동작).
  `work:report` 는 폐지됐다(2026-08-25) — claim 할 수 있으면 그 결과도 적을 수 있어야 하고, claim 이 무제한이라 보고만 막는 건 방어선이 아니었다(본인 claim 건만 쓸 수 있다는 강제는 report 라우트가 한다). 신규 발급에는 없고, **옛 토큰의 `work:report` 는 `work:claim` 과 동등하게 수용**한다.
- PAT는 `project_id` 지정 시 그 프로젝트만. 멤버십: PAT principal은 모든 조회·쓰기에서 `is_superuser` 또는 `project_roles` 보유 필요, 아니면 404.

## 엔드포인트 (v1 5개 불변 + 신규 3개)

| 메서드·경로 | 신원 | 요지 |
|---|---|---|
| GET `/api/v1/agent/work?project_id=[&status=]` | legacy·pat | v1 계약 + `status` 필터(v2.2). PAT는 멤버십·스코프 강제 |
| GET `/api/v1/agent/work/{id}` | legacy·pat | v1 + PAT 호출 시 `mine:boolean`·`claimed_by_user_email` 추가 |
| POST `/api/v1/agent/work/{id}/claim` | legacy·pat | PAT: `claimed_by_user_id` 서버 유도 기록. 배정 항목은 담당자만(403 `not_assignee`) |
| POST `/api/v1/agent/work/{id}/release` | legacy·pat | 소유 판정: PAT=claimed_by_user_id, legacy=claimed_by 라벨. 교차 403 `not_claim_owner` |
| POST `/api/v1/agent/work/{id}/report` | legacy·pat | 위와 같음 + PAT는 `evidence` 객체 허용 |
| GET `/api/v1/agent/me` | **pat 전용** | legacy 호출 400 `identity_required` |
| GET `/api/v1/agent/work/mine?scope=&limit=` | **pat 전용** | scope: `available`(기본)·`claimed`·`all`·`assigned` |
| POST `/api/v1/wbs/import` | **pat 전용** | export JSON upsert. 스코프 `work:claim` 필요 |

## 응답 셰이프 (신규분)

`GET /agent/me` 200:
```json
{ "ok": true, "user_email": "a@b.c", "token_name": "맥북 에어", "token_prefix": "OxMb1D1097Qz",
  "scopes": ["work:read"], "kind": "user_pat",
  "token_expires_at": "2026-11-08T00:00:00Z", "contract_version": "2.4",
  "projects": [{ "id": "<uuid>", "name": "…", "role": "admin|member|superuser" }] }
```
응답의 `contract_version`은 `src/lib/agent/externalApi.ts`의 `AGENT_CONTRACT_VERSION` 상수 값이다 — 현재 `"2.4"`. 스킬은 **major 만** 비교한다(`dflow.sh` 의 `CONTRACT_VERSION`): 서버가 minor 를 올리는 것은 additive 라 정상이고, 등호로 보면 상향 때마다 전 세션이 오경보를 본다.
`projects`는 `agent_projects.enabled=true` ∩ 내가 멤버인 프로젝트만. 활성은 **자동**이다(2026-08-24) — WBS 항목의 "에이전트 위임" 체크·dev_workflow ON·task 가 있는 wbs.md 업로드 중 하나가 처음 일어나면 서버가 활성한다. 사람이 따로 등록하지 않는다. 설정에서 "전체 중지"한 프로젝트(enabled=false)만 은닉된다.

`GET /agent/work/mine` 200:
```json
{ "ok": true, "scope": "all",
  "claimed": [ { "id": "…", "project_id": "…", "status": "claimed", "priority": 0,
                 "instructions": "…", "claimed_at": "…", "item": { "id": "…", "code": "…", "name": "…", "external_ref": "MDM/TSK-01-01|null" } } ],
  "available": [ …같은 셰이프… ], "assigned": [ …같은 셰이프… ] }
```
요청 scope에 해당하는 구획만 채운다(`available`이면 `available`만). 정렬은 구획 내 `priority desc, created_at asc`. `limit` 기본 20 최대 100(구획별 적용). 미지원 scope → 400 `unsupported_scope`. `item.external_ref`는 import 로 들어온 항목의 `"<module>/<id>"` 다(웹에서 직접 만든 항목은 null). dflow.sh scaffold 가 작업 폴더 이름(TSK)을 여기서 얻는다.

`POST /wbs/import` 요청( `wbs-parse.py --export` 출력 v2 + 2필드) — **계약 v2 확장(결정 E, 두 리포 공통·고정)**:
```json
{ "project_id": "<uuid>", "module": "MES",
  "nodes": [ { "id": "TSK-01-01", "parent_id": "WP-01", "kind": "task|wp|act|phase",
               "title": "…", "stage": "as|ip|im|xx|null", "category": "dev",
               "domain": "fullstack", "assignee": "a@b.c", "schedule": "2026-08-11 ~ 2026-08-14",
               "depends": ["TSK-01-02"], "acceptance": ["…"],
               "priority": "critical|high|medium|low",
               "model": "opus", "tags": ["contract"],
               "prd_ref": "docs/prd.md#3.2", "entry_point": "src/app/(app)/wbs/page.tsx",
               "spec_sections": { "requirements": ["…"], "test_criteria": ["…"],
                 "constraints": ["…"], "api_spec": "…|null", "data_model": "…|null",
                 "description": "…|null" } } ] }
```
`external_ref` = `<module>/<id>` (예: `MES/TSK-01-01`).
- **stage(v2.3)**: `as|ip|im|xx` 또는 미기재·`""`·null → 서버가 null(미착수)로 저장. **`"fp"` 는 `ip` 로 정규화한다**(v2.3 과도기 — 0096 에서 제거된 값). **`"todo"`도 과도기 하위호환으로 수용해 null로 정규화**한다(app 레이어 `toRpcNode` + DB RPC `import_wbs_upsert`의 `case when … in ('', 'todo') then null` 이중 방어 — 부트스트랩이 서버 배포 전후 어느 쪽 export 를 올려도 결과가 같다). `todo`는 언제든 제거될 수 있는 호환 수용이지 정식 값이 아니다.
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

1. `agent_projects.enabled = true` — 자동 활성(위임 체크·dev_workflow ON·task 업로드가 처음이면 insert + **백필**: 그 프로젝트의 dev_workflow 리프 전부에 주문 보장). 설정에서 "전체 중지"한 프로젝트만 false 이며 되살리지 않는다
2. `dev_workflow = true`(항목 게이트)
3. 리프(자식 없음) — 아니면 발행하지 않음
4. 활성 주문(ready·claimed·reported) 존재 여부로 멱등 판정 — 이미 있으면 재발행하지 않음(DB 부분 유니크 인덱스가 2차 방어, 23505 경합은 no-op으로 수렴)

미배정 task도 이 조건만 충족하면 주문이 발행되고, `GET /agent/work/mine?scope=available`은 assignee 유무와 무관하게 `ready` 주문 전체를 노출한다.

수동 발행 화면은 없다(2026-08-24 제거). **발행 = WBS 명세 패널의 "에이전트 위임"(tags: agent) 체크** — 체크하면 서버가 프로젝트 활성 → dev_workflow ON → 주문 보장을 한 번에 한다. 체크 해제 = 그 항목의 ready 주문 취소(claimed/reported 는 사람이 승인·반려로 정리).

승인·반려도 전용 화면(`/agent-ops`)이 없다(2026-08-24 제거) — WBS 화면(`/p/<id>/wbs`) 항목 클릭 → 상세 패널의 "담당·단계" 섹션 → "진행 상황"에서 한다. `status=reported` 인 주문에만 승인/반려 버튼이 뜨고, 관리자(project admin·슈퍼유저)만 보인다(`editable={isAdmin}`). 반려는 `reported`→`claimed`로 되돌리고 stage `ip`·실적은 크레딧 표의 RW 값으로 한 트랜잭션에 쓴다(v2.3). 담당 에이전트가 같은 주문으로 재작업·재보고한다. 진행 중 작업을 멈추는 **중단**(옛 회수, 2026-09-19)은 에이전트 허브·좌석표에서 관리자·서브트리 관리자가 한다 — 위임 해제와 같은 경로로 태그를 떼고 주문을 `cancelled` 로 끝내며, 워커는 다음 heartbeat 에서 409 `cancelled` 를 받고 선다.

## claim·show 응답 확장과 선행 게이트 (결정 A·C)

- `GET /work/{id}`(PAT)와 `POST /work/{id}/claim` 200 응답의 `item`에 확장 필드를 포함한다:
  `external_ref·category·domain·priority·model·tags·depends·prd_ref·entry_point·acceptance·spec·stage`.
  클라이언트는 claim 성공 시 이걸로 `<DOCS_DIR>/tasks/<TSK-ID>/spec.md` 로컬 캐시를 만든다(TSK-ID = external_ref의 `/` 뒤).
- 두 응답 모두 `depends_evidence: [{ external_ref, stage, branch|null, head_sha|null, order_approved, actual_pct|null, reached }]`
  포함 — 각 선행 항목의 **approved 주문의 completion 보고 evidence**에서 추출(없으면 null).
  `order_approved`(v2.2)는 그 선행에 `status='approved'` 주문이 하나라도 있는지다. 최신 주문이
  아니라 "아무 approved 주문" 이라 재발행을 겪은 선행에서도 승인 사실이 살아남는다.
- **서버 선행 게이트(v2.3)**: claim 시 depends의 선행 항목 중 `reached`(= `stage` ∈ {`im`,`xx`} ∨ `order_approved` ∨ `actual_pct` ≥ 100)가 false 인 것이 하나라도 있으면
  403 `dependency_not_met` + `unmet: [{external_ref, stage}]`. 선행 external_ref가 프로젝트에 없으면 미충족(fail-closed).
  dflow.sh 는 이 403 을 바디 `code` 로 판독해 **exit 4**(선행·상태로 인한 진행 불가)로 낸다 — 권한 403(exit 5)과 처방이 다르기 때문이다(구조 필드 판독이므로 "산문 파싱 금지" 위반이 아니다).
- **클라이언트 하드 차단**: ① claim 전 `show`의 depends_evidence로 `git cat-file -e <sha>` + `git merge-base --is-ancestor <sha> HEAD` 검사 — 미도달이면 메시지 출력 후 **실행 거부(exit 4)**. ② `done`은 `git ls-remote`로 현재 브랜치 tip이 원격에 도달했는지 확인 — 미도달이면 **보고 거부(exit 2)**. "완료 = push 완료"가 클라이언트 계약이다.

## 상태 어휘 매핑 (§7.2-2, v2.3)

파일 `[ ]`/`[as]`/`[ip]`/`[im]`/`[xx]` ↔ DB `stage` `null/as/ip/im/xx`(`[ ]`는 `null`). 옛 파일의 `[fp]` 는 `ip` 로 받는다(0096).
로컬 state-machine.json 의 `[dd]`·`[ts]` 는 부트스트랩 전용이라 서버 어휘에 없다.
전이 권한: 사람 전용 = assign/unassign/set_stage/approve/unapprove/reject/rework · 에이전트 = claim/completion/release(본인 점유). 사람의 중단은 전이 사건이 아니라 위임 해제(주문 `cancelled`) + set_stage `as` 다.
에이전트 API에 사람 전용 사건 없음(도입 시 403 `human_gate`).

UI 라벨 정본(`src/lib/domain/stageLabels.ts`): `as`=할당됨 · `ip`=작업 중 · `im`=검수 대기 · `xx`=완료 · 미지정=미착수.

### 단계 전이 사건 표 (v2.3 — 정본은 설계 §3.4)

모든 사건은 DB 함수 `apply_workflow_event` 하나가 **한 트랜잭션**으로 주문 CAS·단계·실적·`change_logs` 를 쓴다. 주문 사건은
주문의 존재가 워크플로 증거라 `dev_workflow` 를 보지 않고, 리프가 아니면 단계·실적만 건너뛴다. 실적은 크레딧 표 값으로
**덮어쓴다**(큰 쪽 유지 규칙 없음).

| 사건 | 주문 status | stage | 실적% | 누가 |
|---|---|---|---|---|
| 배정·위임 ON | (발행 조건은 현행) | `null`→`as` (stage 가 null 일 때만) | 표.as | 사람 |
| 배정 해제 | 불변 | `as`→`null` (as 일 때만) | 불변 | 사람 |
| claim | `ready`→`claimed` | `ip` | 표.ip | 에이전트 |
| progress 보고 | 불변 | 불변 | **불변**(보고 행만) | 에이전트 |
| completion 보고 | `claimed`→`reported` | `im` | 표.im | 에이전트 |
| 승인 | `reported`→`approved` | `xx` | 100 | 사람 |
| 승인 취소 | `approved`→`reported` | `im` | 표.im | 사람 |
| 반려 | `reported`→`claimed` | `ip` | 표.rw | 사람 |
| 재작업 요청 | `approved`→`claimed` | `ip` | 표.rw | 사람 |
| 반납(release) | `claimed`→`ready` | `as` | 표.as | 에이전트(본인 점유) |
| 중단·위임 해제 | `ready`·`claimed`→`cancelled` | `claimed` 를 취소했을 때만 `as` | 표.as | 사람(허브·좌석표 중단, 위임 체크 해제) |
| 사람의 단계 지정 | 잠금이 아닐 때만 | 지정값 | 표.<지정값>(해제는 불변) | 사람 |

**잠금** = 위임됨(`tags` ∋ `agent`) ∨ 주문 `claimed`·`reported`. 잠기면 사람의 단계 지정은 거부되고 수기 실적 입력은 99 까지다
(100 은 승인으로만). `ready` 는 dev_workflow 리프마다 상주하므로 잠금이 아니다.

`im`/`xx` "처음 도달" 시(역전이·재설정 제외) depends 역참조로 후행 담당자에게 `work.unblocked` 알림이 발행된다
(§2.10, 다중 depends는 전부 충족(`reached`) 시 1회).

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
| 403 | `dependency_not_met` | 선행(depends) 미충족 claim — `reached:false`(v2.3, 결정 C — `unmet[]` 동반) |
| 404 | — | 꺼짐/미등록/비멤버/없음(의도적 비구분) |
| 409 | `conflict` | CAS 충돌·상태 불일치 |
| 409 | `cancelled` | 사람이 중단한 주문(heartbeat·progress·completion). 워커는 재시도하지 말고 멈춘다 — 2026-09-19 |
| 409 | `apply_failed` | WBS 반영 실패 |
| 409 | `wbs_item_missing` | 항목 삭제된 주문 |

## 로컬 클라이언트 계약

- env: `DFLOW_API_BASE`(기본값 없음 — 미설정 시 즉시 실패) · `DFLOW_PATS`(쉼표 구분 1~N개) · `DFLOW_PAT`(단일, PATS 미설정 시 폴백).
- `dflow.sh` exit code: 0 성공 / 2 사용법·설정·push 미완료 / 3 인증(401) / 4 상태 충돌(409)·선행 미반영 로컬 차단·선행 미충족(403 `code=dependency_not_met`) / 5 권한(403, 그 외) / 6 네트워크·서버(5xx)·로컬 환경 실패(파싱·파일 쓰기) / 7 기능 꺼짐(404) / 10 중단됨(409 `code=cancelled`).
  - 403 을 body 의 `code` 로 갈라 읽는다: 선행 미충족은 권한 문제가 아니라 상태 문제라
    호출부가 할 일이 "권한을 얻어라"가 아니라 "선행을 끝내고 다시 와라"이다.
  - 로컬 파싱·파일 쓰기 실패를 4 로 내지 않는다 — 호출부가 "선행을 기다린다"로 읽고 영원히 재시도한다.
  - 409 도 body 의 `code` 로 갈라 읽는다: `cancelled`(사람이 중단)는 경합이 아니라 끝난 작업이라 호출부가 할 일이
    "다시 시도"가 아니라 "즉시 멈춤"이다. 그래서 4 와 섞지 않고 10 으로 낸다.
- 신원 해석: 토큰별 `GET /agent/me` 1회 → `~/.cache/dflow/profiles.json` 캐시. 키 선택은 `--as <prefix|email>` →
  `.dflow.local` 의 `as`(prefix 만, 레거시 `.env` 의 `DFLOW_AS`) → 첫 토큰. prefix 일치는 `/me` 를 부르지 않는다. 목록은 `dflow.sh profiles`.
- evidence 자동 조립: `git rev-parse HEAD`·`git remote get-url origin`·`git branch --show-current`·(`gh` 있으면) PR URL.
