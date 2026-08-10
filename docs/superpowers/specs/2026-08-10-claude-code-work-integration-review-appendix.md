# Claude Code × D'Flow 작업 연동 — 구현 명세 (상세 부록)

작성 2026-08-10 · 상태 **구현 승인 (착수 게이트 ⓪①② 결정 완료 2026-08-10)**

> **사람은 본문(`2026-08-10-claude-code-work-integration-review.md`)을 먼저 읽는다.**
> 구현 세션이 참조하는 정본 스펙은 이 파일이다.
>
> 기준 코드: `main@6699b2d` (실측 시점에 `0070_project_member_email_identity` 추가 확인)
>
> 선행 문서: `docs/superpowers/specs/2026-07-31-agent-work-loop-design.md`(v1, 구현 완료),
> `docs/superpowers/specs/2026-08-04-agent-control-plane-v2-design.md`(초안·미승인),
> `docs/superpowers/specs/2026-08-06-test-environment-split-design.md`,
> `docs/design/agent-coding-platform/`(17문서 코퍼스), `docs/design/dflow-agent-work-api-spec.md`(v1 계약 정본)

---

## 요약 (TLDR)

**절반은 이미 있다.** `/api/v1/agent/work` v1 원장(claim/report/release, CAS 동시성, PM 승인 루프)이
구현·테스트 완료. Jira급 경험까지 격차는 세 축:

1. **사용자 귀속 신원 없음** — 전역 시크릿 1개 + 자기신고 `user_email`
2. **"내 작업" 조회 불가** — 서버가 "내가 점유한 주문"을 물리적으로 답하지 못함 (`claimed_by`는 자유 문자열 라벨)
3. **Claude Code 클라이언트 부재** — 스킬·CLI 없음

**결론: MCP 서버·독립 npm 패키지는 만들지 않는다. REST 확장(신규 엔드포인트 3개) +
리포 정본 스킬(심볼릭 링크 설치) + curl 래퍼 `dflow.sh`.**

### 범주별 요건

| 범주 | 필요한 것 |
|---|---|
| API | 기존 5개 계약 불변. 신규 3개: `GET /api/v1/agent/me`, `GET /api/v1/agent/work/mine`, `POST /api/v1/wbs/import`. 게이트를 PAT 리졸버로 확장 |
| DB | `0069_agent_runners`(PAT+러너 겸용, `kind` 컬럼) · `0071` `claimed_by_user_id` · `0072` evidence · `0073` WBS 담당자·단계·external_ref·**명세 컬럼(§2.5 — WBS 중앙관리)** (0070은 `project_member_email_identity`가 선점 — 재사용 금지) |
| CLI | 독립 npm ✗. 리포 내 `dflow.sh`(curl 래퍼). exit code 계약 · compact 출력 · `done --auto-links` · 다중 프로필 `DFLOW_PATS` |
| 스킬 | 정본 `docs/agent/claude-skill/dflow-work/` + `ln -s ~/.claude/skills/` — 개발자는 MES 리포에서 작업하므로 리포 내 `.claude/skills/`는 로드되지 않음 |
| 워크플로우 | 목록 → claim → 브랜치 → 구현 → progress 보고 → completion → `reported`(승인 대기) → PM 웹 승인. `/approve` REST 없음 |

### 핵심 사실 4건

1. **보안 순서**: `GET /work`·`GET /work/{id}` 둘 다 멤버십 검사 없음. 개인 토큰 도입 순간
   토큰 하나로 enabled 전 프로젝트 열람 — **멤버십 게이트가 PAT 발급과 같은 배포 이전에 필수.**
2. **지금 전 라우트 404**: env에 `AGENT_API_*` 부재 → `agentApiEnabled()` 불충족. 발급 전엔 데모 불가.
3. **코퍼스 합류**: `docs/design/agent-coding-platform/21-multi-client-model.md:279-310`이 이미
   `agent_runners` 초안 보유. 새 테이블 이름 만들지 않고 여기에 `kind` 컬럼만 더해 합류.
4. **`item_owners` 권한 상승**: 웹 경로는 멤버를 자기 팀 리프로 제한(`src/app/actions/wbs.ts:96-99`),
   에이전트 채널은 프로젝트 전체 리프에 쓴다(`src/lib/agent/applyProgress.ts:8-9`).
   에이전트측 발행 도입 전 반드시 닫을 것.

### 문서 사용법

- §통합안 — 최종 설계 (§2 서버 · §3 클라이언트 · §7 dev-workflow 계약·분담)
- §로드맵 — WP 체크리스트·수용 기준
- §미결 사항 — ⓪~⑬

---
## 통합안 (REST+Skill 기반)
### 결론

**REST 확장 + 리포 정본 스킬을 기반으로, CLI 계약(exit code·compact 출력·로컬 git 증적)을 얇은 래퍼로 접목하고, 토큰 테이블은 코퍼스 `agent_runners`에 `kind` 컬럼으로 합류한다. MCP 서버·독립 npm 패키지는 만들지 않는다.**

근거 둘: (1) **스킬 배치** — 개발자는 wbs-web이 아니라 동국씨엠 MES 리포에서 작업하므로(`docs/superpowers/specs/2026-08-06-test-environment-split-design.md:23-27`) `wbs-web/.claude/skills/`는 로드되지 않는다. 사용자 레벨 설치가 유일하게 맞는 배치다. (2) **Phase 1에 쓰기 경로가 구조적으로 없다** — 읽기 전용 단계는 운영 리스크 0이라 테스트 환경 완성 전에도 착수 가능하다.

---

### 1. 코퍼스 (`docs/design/agent-coding-platform/`) 와의 관계

- `21-multi-client-model.md:279-310`이 **`agent_runners` 테이블 초안을 이미 보유** — `owner_user_id` · `token_hash` · `project_id`(null=전 프로젝트) · `enabled` · `revoked_at` · `last_seen_at`. **네 번째 테이블 이름을 만들지 않고 여기에 합류한다.** `kind text check in ('user_pat','runner') default 'user_pat'`를 추가하면 이번 PAT와 훗날 Runner credential이 같은 테이블의 두 row 종류가 된다.
- 같은 문서 결정표(`:345-353`)에서 **사용자 확정 표시가 있는 행은 #1(해석 2) 하나뿐** — 나머지(#2 러너별 토큰, #7 발급 권한 등)는 설계자 권고다.
- 인증 흐름(`:321-328`): `Bearer <token>` → `agent_runners` 조회 → `owner_user_id` = 권한 주체(위조 불가) → **body의 `user_email`·`agent`는 무시**. 하위 호환으로 `AGENT_API_SECRET` 경로 유지.
- 마이그레이션 번호: 코퍼스가 적은 "다음 번호 0068"은 낡았다. **0069가 빈 번호이고, 0070은 `project_member_email_identity`가 선점했다** — 이 설계는 0069·0071·0072·0073을 쓴다.
- `2026-08-05-wbs-ai-pm-design.md` 계열은 MySQL 기반 별개 그린필드 제품이라 wbs-web 마이그레이션을 구속하지 않는다.

---

### 2. 서버 — 무엇을 바꾸는가

#### 2.1 인증축 (0069)

현재 `gateAgentApi`는 Bearer 값 전체를 `AGENT_API_SECRET`과 sha256 후 `timingSafeEqual` 비교한다(`src/lib/agent/externalApi.ts:34-40`). PAT를 곁에 붙일 수 없으므로 **게이트 자체를 리졸버로 교체한다**:

```
resolveAgentPrincipal(req):
  ① AGENT_API_ENABLED !== 'true' → 404          ← 킬스위치는 이 플래그 단독
  ② Bearer == AGENT_API_SECRET   → { kind:'legacy' }
       — AGENT_API_SECRET 미설정이면 이 분기 자체가 없음(레거시 경로만 닫힘). v1 동작 그대로.
  ③ Bearer 가 dflow_pat_ 접두    → token_prefix 조회 → enabled = true
                                    → revoked_at is null → expires_at > now()
                                    → token_hash 상수시간 비교
                                    → { kind:'pat', userId: owner_user_id,
                                        scopes, projectId }   ← 라우트가 강제할 재료를 전부 반환
  ④ 그 외                        → 401
```

규칙:

- **킬스위치는 `AGENT_API_ENABLED` 단독.** 시크릿 존재는 레거시 분기 활성화 조건으로만 쓴다(현행 `agentApiEnabled()`는 시크릿 존재까지 요구 — 리팩터 대상, `externalApi.ts:10-12`). 토큰 발급 액션도 이 플래그 뒤에 둔다.
- `enabled` → `revoked_at` → `expires_at` → hash 순서로 검사한다.
- 리졸버가 반환한 `scopes`·`projectId`를 **모든 라우트가 강제한다** — `projectId`가 있으면 대상 프로젝트 일치, 요구 스코프 보유. Phase 1 읽기 라우트도 `work:read`를 요구한다.
- PAT 경로에서 body의 `user_email`은 읽지 않는다. 있는데 소유자와 다르면 **400 `identity_mismatch`**(조용히 무시하지 않는다 — 사칭 시도의 유일한 신호).
- 권한 판정은 기존 3단 재사용: `isAgentProjectMember`가 `is_superuser` 단락 후 `project_roles` 존재로 판정, 조회 실패는 `false`(fail-closed, `externalApi.ts:54-71`). deprecated `memberships.role`은 읽지 않는다.
- 부수 효과: 쓰기 라우트의 매 요청 `resolveUserByEmail`(`auth.admin.listUsers()` 전량 순회, `src/lib/minutes/externalApi.ts:131-146`)이 PAT 경로에서 사라진다 — PAT는 `owner_user_id`를 직접 안다.

#### 2.2 두 GET 의 멤버십 스코프 — 순서가 안전의 전부다

`GET /api/v1/agent/work`(`route.ts:12-18`)와 `GET /api/v1/agent/work/{id}`(`[id]/route.ts:12-29`)는 지금 `gateAgentApi` + `requireAgentProject`만 통과하면 응답한다 — `isAgentProjectMember` 호출이 없다. **멤버십 스코프 보강은 PAT 발급보다 먼저, 최소한 같은 배포에 들어간다.**

- **이 게이트는 PAT principal에만 적용한다.** 레거시 시크릿 GET에는 신원이 없어 검사가 불가능하다 — 레거시 경로는 v1 동작 그대로(회귀 기준선 유지). 그 대가로 레거시가 살아있는 동안 무스코프 크로스 프로젝트 열람이 남는다 — 폐기 일정(미결 ④)의 실질 근거.
- 슈퍼유저 PAT는 이 게이트를 정의상 통과하므로 발급 규칙으로 제한한다: `project_id` **지정 필수**(전역 null 금지) + 만료 상한 단축.
- 비멤버는 403이 아니라 404(존재 은닉 관례 유지).

#### 2.3 점유 소유권 이관 (0071)

현재 소유권은 자유 문자열 라벨 하나에 걸려 있다 — claim은 `claimed_by: actor.agent`(`claim/route.ts:27`), report/release는 `order.claimed_by !== actor.agent → 403`(`report/route.ts:57` · `release/route.ts:23`), CAS도 `.eq('claimed_by', actor.agent)`(`report/route.ts:94` · `release/route.ts:29`). 세션·PC가 바뀌면 자기 작업에 자기가 보고를 못 한다.

`agent_work_orders.claimed_by_user_id uuid`를 추가하고 **PAT 경로에서만** 소유 판정과 CAS를 이 컬럼 기준으로 전환한다. 레거시 경로는 `claimed_by` 문자열 기준 그대로. **두 조건을 하나의 UPDATE에 OR로 섞지 않는다** — CAS의 원자성은 단일 컬럼 등가 비교에서 나온다. 교차 소유는 **양방향 모두 403 `not_claim_owner`**: 레거시가 claim한 주문의 PAT 보고 불허, PAT가 claim한 주문의 레거시 보고/반납 불허.

이 컬럼이 `--mine`을 가능케 하는 전부다.

#### 2.4 신규 엔드포인트

- `GET /api/v1/agent/me` — whoami. 토큰 유효성 + 접근 가능한 agent-enabled 프로젝트 목록 + `contract_version`. 404 존재 은닉(`externalApi.ts:22-23`) 아래에서 유일한 진단 창구. PAT 전용(레거시 호출은 400 `identity_required`).
- `GET /api/v1/agent/work/mine` — 크로스 프로젝트 목록. **`GET /api/v1/agent/work`는 한 글자도 바꾸지 않는다**(`scripts/agent-harness-example.mjs:28`이 그 셰이프에 의존). 정적 세그먼트 `mine`이 `[id]`보다 우선하고 `[id]`는 `isUuidLike`로 비-UUID를 거르므로(`[id]/route.ts:15`) 라우팅 충돌 없음.
  - 집계 범위는 `agent_projects.enabled = true` ∩ 내가 멤버인 프로젝트 — "미등록 프로젝트 404" 불변식을 신규 엔드포인트가 깨지 않는다.
  - **Phase 1은 `scope=available`(기본이자 유일값)만.** `claimed`·`all`은 0071 없이 답할 수 없으므로 Phase 2에서 0071과 함께. `scope=claimed` 요청은 그 전까지 400 `unsupported_scope`.
  - `scope=all` 도입 시 응답은 **claimed 구획을 먼저, 그다음 available** — `priority` 동률로 정렬이 `created_at asc`로 붕괴해 방금 claim한 주문이 limit 밖으로 밀리는 문제를 구획으로 푼다.
- `POST /api/v1/wbs/import` — §2.6.

"내 작업" 정의: **mine = 내게 배정된 항목(assigned) ∪ 내가 점유한 주문(claimed) ∪ ready 풀(available).** Phase 1은 available만, Phase 2에 claimed, WP-07에 assigned 합류.

#### 2.5 WBS 변경 — 전 계층 담당자 + Task 단계

① **전 계층 담당자 — 축은 로스터다.** Task·WP·ACT 등 `wbs_items` 트리의 **모든 노드**에 개인 담당자를 할당할 수 있다.
   - 컬럼은 `assignee_member_id`(로스터 축). 근거: D'Flow의 "사람 담당" 관례가 이미 로스터다 — 이슈 담당자가 `issue_assignees.member_id → project_members`로 구현돼 있고(0041/0042), 복합 FK `(member_id, project_id) references project_members(id, project_id)`가 "담당자의 프로젝트 = 항목의 프로젝트"를 DB가 보장한다. 로스터는 **계정 없는 외부 인력**도 담고(0003 설계 의도), `project_members.user_id`/`email`이 auth 계정과의 다리다(0019 자동 링크 트리거).
   - `0073_wbs_assignee_stage.sql`: `wbs_items`에
     `assignee_member_id uuid null` + 복합 FK `(assignee_member_id, project_id) → project_members(id, project_id) on delete set null (assignee_member_id)`,
     `stage text null check (stage in ('todo','as','fp','ip','im','xx'))`,
     `external_ref text null`(§2.6 업로드 upsert 매칭 키, 부분 유니크 `(project_id, external_ref) where external_ref is not null`),
     그리고 **명세 컬럼**(WBS 중앙관리 결정 — Task 명세도 DB가 정본이어야 `/dev`가 파일 없이 착수 가능. MES wbs.md 16필드 실측 매핑):
     `category text` · `domain text` · `priority text` · `model text` · `tags text[]` ·
     `depends text[]`(external_ref 배열 — §2.9 선행 게이트 판정용) · `prd_ref text` · `entry_point text` ·
     `acceptance jsonb`(자동 발행 주문의 수용 기준으로 서버가 직접 사용 — spec 본문에 묻으면 재파싱 필요) ·
     `spec text`(requirements·test-criteria·constraints·api-spec·data-model을 고정 섹션 순서로 조립한 마크다운 본문).
     전부 nullable — 기존 행·기존 프로젝트 무영향.
   - **뷰어 명세 패널** — WBS 시트에서 항목 선택 시 스칼라(배지·필드) + `spec` 마크다운 렌더, 편집 가능(마크다운 에디터). 설계서·분석서 실물은 작업 리포 git — DB에는 `prd_ref`·`entry_point` 참조 문자열만.
   - ⚠️ **v1 원칙("에이전트 기능은 기존 테이블 ALTER 0건")의 첫 의도적 예외** — 에이전트 전용 기능이 아니라 WBS 제품 기능이다. 마이그레이션 헤더에 명시.
   - 기존 담당팀(`item_owners`)과 공존: **팀 = 조직 책임, 담당자 = 개인 실행 책임.** 서로 대체하지 않는다. (보강 근거: `memberships`는 사용자당 팀 1개 전역이라 다중 프로젝트에서 팀 축이 흔들린다는 한계가 0022 주석에 기록돼 있다.)
   - 배정 UI: WBS 시트·간트에서 할당 — 이슈 담당자 피커(`IssueAssigneePicker`) 관례 재사용. 배정 권한은 `requireProjectAdmin`.
   - 담당자는 노드 속성이다 — 하위 자동 상속·롤업 없음(WP 담당자는 WP의 책임자이지 하위 Task 전부의 실행자가 아니다).

② **Task 단계 — 컬럼명은 `stage`, 세트는 6상태.**
   - **`status`라는 이름을 쓰지 않는다** — D'Flow에는 이미 파생 `Status`(`not_started/in_progress/delayed/done`, `statusOf` 계산값)가 화면 전반에 있어 충돌한다. 저장 컬럼은 `stage`.
   - 값은 대괄호 없는 코드: `todo`(=`[ ]`) `as` `fp` `ip` `im` `xx`. 대괄호 표기는 wbs.md 파일 표면 한정. `null` = 단계 미도입(점진 도입).
   - **미결 ③의 상태 파생 환산(`todo/as/fp`=0 · `ip`=20 · `im`=60 · `xx`=100)이 이 컬럼 위에서 동작한다.** 단계 도입이 곧 "LLM 자기보고 % 제거"의 기반이다. dev-workflow 정본(`docs/state-machine.json` progress 블록)도 계획%·상태 파생을 **D'Flow의 `plannedPct`/`statusOf` 재사용으로 명시**하므로 산식의 정본 위치는 D'Flow다.
   - 전이 권한: `assign`/`unassign`/`force`/`unforce`/`accept`는 **사람 전용**(웹 세션), `cycle.start`·`*.ok`·`*.fail`·`bypass`는 에이전트 허용 — dev-workflow `docs/state-machine.json`의 이벤트 권한 규정 그대로. 에이전트 API로는 사람 전용 이벤트를 받지 않는다(403 `human_gate`).
   - **왕복 동기화는 없다** — WBS 중앙관리 결정으로 상태 전이는 D'Flow `stage`(API)에서만 일어난다. 파일→DB는 부트스트랩 import 1회 경로이고, D'Flow가 쓴 값을 파일로 되돌리는 흐름은 열지 않는다. 로컬 6상태 실행(DEV-01)은 이로써 스코프 아웃(§7.1 F1).

③ **로컬 신원(.env)** — 클라이언트 신원의 정본은 `DFLOW_PATS`(다중 프로필, §2.7)다 — 토큰이 owner를 안다(서버 검증 신원). 과도기·레거시 경로에서는 `DFLOW_USER_EMAIL`을 `.env`에 두고 배정 필터에 쓴다. **단 이 값은 표시·필터 편의일 뿐 자기신고다** — 서버가 신뢰하는 신원은 PAT뿐. 이 구분을 SKILL.md에 명시한다.

④ **`/work/mine?scope=assigned`** — `assigned` 판정은 로스터 다리를 탄다: `wbs_items.assignee_member_id → project_members`에서 `user_id = PAT userId` **또는** `lower(email) = PAT 소유자 email`(이중 매칭 — `resolveMemberIds`의 기존 관례 그대로).

⑤ **배정과 선착순 풀의 정합** — ready 풀 CAS는 유지한다. 발행된 주문의 `wbs_item`에 담당자가 있으면 **claim을 그 사용자로 제한**한다(④의 로스터 다리 판정, 불일치 403 `not_assignee`). 담당자 없는 항목은 종전대로 선착순. 담당자가 로스터에만 있고 auth 계정·PAT이 없으면 그 주문은 아무도 claim할 수 없다 — 버그가 아니라 "그 사람 몫" 표시이며, 배정 변경 또는 대리 발급(§2.7)으로 푼다.

#### 2.6 WBS 파이프라인 — 생성·업로드·소비

**정본은 D'Flow DB다(중앙관리 — 사용자 결정).** 로컬 wbs.md를 각자 읽으면 다인·다PC에서 문서·코드 충돌이 커진다.
**wbs.md는 최초 작성·검수·import 부트스트랩 전용**이며 import 후 은퇴한다. import 후 `/dev` 계열의 소비 경로:

- **명세·상태는 DB에서** — claim 시 `dflow.sh`가 해당 Task 명세(스칼라+`spec`+`acceptance`)를 받아
  `docs/tasks/{TSK}/spec.md` 로컬 캐시로 생성하고, `/dev`는 그 캐시를 읽는다. 상태 전이는 서버 `stage`.
- **설계서·분석서 실물은 로컬 git** — DB의 `prd_ref`·`entry_point`가 가리키는 파일은 작업 리포에 있다.
- wbs.md의 Dev Config 블록(Domains·Design Guidance·Quality Commands·Cleanup)은 WBS 항목이 아닌 실행 환경 설정 — 로컬 리포에 남는다.
- state.json 5상태 사이클 내부는 로컬 그대로(서버 stage와 별개의 실행 내부 상태).

**작성 표면 포맷: `wbs.md`(markdown) 유지. YAML·xlsx 전환 안 한다.**
xlsx 작성은 md 대비 최악: 바이너리라 diff·검수 불가, 텍스트 병합 불가, 셀 수정 시 서식 파손, LLM 직접 읽기·쓰기 불가. YAML 반대 근거:
① 상태 표기 `[ ]`/`[as]`가 YAML에선 배열로 파싱되는 상극(전량 인용 강제 = 실수 다발)
② md를 읽는 도구 사슬이 이미 안정 — `wbs-parse.py` + 전용 테스트
③ 사람 검수 표면은 md 우위(리뷰·diff 포함)
④ 구조가 필요한 소비자는 JSON 경계를 쓰면 된다 — YAML은 어떤 문제도 풀지 않는다.

**파이프라인:**

```
PRD/TRD 또는 프로그램 리스트 → /wbs-wsf → docs/<모듈>/wbs.md   ← 작성·검수 표면 (부트스트랩)
                                    └→ wbs-parse.py --export (JSON v2, DEV-02 신설)
                                            └→ 변환기 → POST /api/v1/wbs/import (PAT) → wbs_items  ← 이후 정본
                                                                     └→ claim 시 docs/tasks/{TSK}/spec.md 캐시 ← /dev 소비
```

- **JSON 경계는 현행 `--tasks-all`로는 부족하다.** 목록 모드는 6필드(`tsk_id/title/status/depends/domain/category`)만 내고 `assignee`·`schedule`·`priority`는 단건 `--json`에만 있으며, 계층(Phase/WP/ACT)·WP 메타데이터를 파싱하는 코드가 없다. 업로드 계약의 소스는 dev 플러그인에 신설하는 **`wbs-parse.py --export`**(§7 DEV-02) — 전 Task의 전체 필드 + 계층(부모 ID 사슬) + WP/ACT 노드를 한 JSON으로. 그 전까지의 과도기는 변환기가 Task별 `--json` N회 + ID 규칙(`TSK-01-02`→`WP-01`)으로 계층을 유도한다.
- **상태의 진실 원천 주의** — 실행 중 Task는 `docs/tasks/<ID>/state.json`이 정본이고 wbs.md는 파생 사본이다. `wbs-parse`가 state.json 값을 반영해 출력하므로, **변환기는 wbs.md를 직접 파싱하지 않고 wbs-parse JSON 경계만 쓴다**(계약 명시).
- **모듈별 업로드** — 단위는 서브프로젝트 `wbs.md`(워크플로우의 `DOCS_DIR=docs/<모듈>` 구조 그대로). MES 4단이면 ACT 서브트리 단위도 허용.
- **upsert 멱등 — 기존 임포트 RPC를 재사용하지 않는다.** 기존 경로는 마법사 전용 `import_wbs`(순수 append)/`replace_wbs`(전삭제 후 재삽입)뿐이고, ① INSERT 화이트리스트에 없는 키(stage·assignee·external_ref)를 **조용히 버리며**(0063) ② `replace_wbs`는 `change_logs`를 cascade로 **비가역 삭제**한다. `/wbs/import`는 **신규 upsert RPC**(0073과 같은 계열, `external_ref` 매칭)로 낸다. 재업로드는 갱신, **삭제는 하지 않는다**(운영 데이터 보호 — 제거는 웹에서 사람이). 마법사(append/replace)와는 **서로 다른 제3의 경로**임을 양쪽 문서에 명시한다.
- **매핑** — `[xx]` 표기 → `stage` 코드(`todo/as/fp/ip/im/xx`) · `assignee`(email) → 로스터 매칭 `project_members.email`(미매칭 항목은 생략하지 않고 리포트) · `schedule`(`"YYYY-MM-DD ~ YYYY-MM-DD"` 불투명 문자열 — 분해는 변환기 책임) → `planned_start/end` · `depends[]` → `depends`(external_ref 배열) · Task/WP/ACT/Phase ID → `external_ref`(전 계층 노드가 갖는다 — `code`는 비유니크라 매칭 키 불가) · `priority` 라벨 → 그대로 `priority text`(주문 정수 priority 매핑은 §7.2-4) · `spec_sections` → 고정 섹션 순서(요구사항→제약→테스트 기준→API 스펙→데이터 모델)로 조립해 `spec text` · `acceptance[]` → `acceptance jsonb`.
- **프로그램 리스트 입력(MES)** — `/wbs-wsf`가 PRD/TRD 외에 **프로그램 리스트(json / md / csv / xlsx / yaml)** 를 입력으로 받는다.
  - 포맷별로 다루지 않는다 — **정규화 어댑터 1층**이 공통 스키마(JSON: 모듈·프로그램ID·프로그램명·유형(화면/배치/리포트/인터페이스)·난이도·담당)로 수렴.
  - 생성 규칙: 모듈 → ACT/WP · **프로그램 1개 = Task 1개** · 유형 → category/domain · 난이도 → model·기간 추정. WSF 샌드위치 골격(선행 계약·설계, 후행 통테)은 동일하게 생성.
  - **수직 슬라이스 강제** — 각 프로그램은 **한 Task 안에서 백엔드+프론트엔드를 함께** 처리한다(`domain: fullstack`, 화면 있으면 `entry-point` 필수). "OO화면 API" / "OO화면 UI" 식 분리 Task 생성 금지 — 계약이 흩어져 수정·테스트가 맞물려 실패한다.
  - 검증: 필수 컬럼(모듈·ID·명)·ID 중복 검사, 매핑 실패 항목은 생략하지 않고 리포트.
  - ⚠️ 이 확장은 **dev 플러그인(wbs-wsf 스킬) 작업**이다 — wbs-web 로드맵 밖(§7 DEV-04).

#### 2.7 다중 프로필 — 한 PC 에 1~N 명의 신원

한 PC에서 여러 명(예: 이돈석·장종익·장한솔)의 배정 작업을 받아 처리할 수 있다. 모델은 **사람별 PAT × N, 클라이언트 프로필** — 서버는 "1 요청 = 1 신원"을 유지하므로 서버 설계 변경이 0이다.

- **로컬 계약**: `.env`의 `DFLOW_PATS`(쉼표 구분 배열 — env에 배열 타입이 없으니 구분자 문자열이 곧 배열. PAT 형식 `dflow_pat_<prefix>_<secret>`에는 쉼표·공백이 없어 안전). `DFLOW_PAT` 단일 변수는 배열 1개짜리로 하위 호환. 파일 권한 600 권고 — 한 파일에 N인분 자격증명이므로 유출 반경이 커진다(완화: 사람별 개별 폐기).
- **이름표를 로컬에 두지 않는다** — 클라이언트가 토큰별 `GET /agent/me` 1회로 소유자(이름·email)를 해석해 캐시한다. `dflow --as 이돈석`은 그 결과 매칭, `dflow list --all`은 프로필 N개 순회 후 통합 표시. 신원 정본은 항상 서버다.
- **claim 귀속**: 이돈석 배정 Task는 이돈석 프로필로 전환해 claim한다(§2.5-⑤와 자연 정합). `claimed_by_user_id` = 그 프로필의 owner. 실제 타이핑한 사람은 따로 기록하지 않는다(레거시 라벨 `claimed_by`의 hostname으로 충분, 필요 시 후속).
- **발급 경로**: 본인 세션 자율 발급이 기본. 웹에 로그인하지 않는 팀원 몫은 **프로젝트 관리자 대리 발급**을 허용한다(`created_by`에 발급자 기록, 미결 ①). 대리 발급도 읽기 스코프 한정 규칙(§4(a))을 따른다.
- **git author는 섞지 않는다** — 커밋 author는 PC 주인 그대로, D'Flow 귀속은 PAT 신원. 두 축을 겹치지 않는 것이 규약이다(SKILL.md 명시).

#### 2.8 배정 기반 자동 발행

**담당자가 배정된 리프 Task는 주문이 자동으로 존재한다.** (현행 수동 발행은 관리자가 WBS UUID를 직접 타이핑하는 폼뿐.)

- **트리거 두 곳**: ① `/wbs/import`가 담당자 매칭에 성공한 리프 항목 ② 웹 UI에서 담당자 배정 시. 둘 다 같은 멱등 함수 `ensureOrderForAssignedLeaf`를 탄다.
- **멱등·중복 방지**: 리프당 활성 주문(`ready/claimed/reported`) 1개 부분 유니크 인덱스. 이미 활성 주문이 있으면 no-op.
- **발행 조건은 기존 가드 그대로**: `agent_projects.enabled` 프로젝트만(미등록 404 안전망 유지) · 리프만(자식 있으면 스킵하고 리포트) · 실행 주체는 관리자 권한 경로(import는 관리자 스코프, 웹 배정은 `requireProjectAdmin`) — "발행 = 관리자 전용"이라는 v1 전제가 유지되므로 미결 ⑦(에이전트측 발행)의 권한 상승 게이트와는 별개다.
- **역방향 정리**: 배정 해제·항목 삭제 시 활성 주문을 자동 취소하지 않는다 — 관리자 회수/취소(기존 액션)로 사람이 정리한다(자동 파괴는 점유 중 작업을 유실시킬 수 있다).
- 발행 UI는 유지하되(수동 발행도 가능) UUID 직접 입력을 항목 검색·선택으로 개선한다.

#### 2.9 선행 하드 차단 — "완료 = push 완료"

의존 게이트는 *상태*(`stage`)로 판정하지만 착수에 실제로 필요한 것은 *산출물*(선행 커밋이 내 워킹트리에 있음)이다. 분산 환경에서 이 둘 사이의 시간차 동안 후행이 착수하면 계약을 중복 정의하고 머지 충돌을 만든다. 원인은 pull 누락이 아니라 **push 없이 완료 보고한 것** — 후자를 막으면 전자는 `fetch` 한 번으로 끝난다. 세 겹 전부 하드 차단(경고+확인 아님):

| 겹 | 위치 | 동작 |
|---|---|---|
| 서버 게이트 | `claim` | `wbs_items.depends`(external_ref 배열)의 선행 중 `stage`가 `im` 미만인 것이 있으면 **403 `dependency_not_met`**(선행 목록 포함) |
| 보고 강제 | `dflow.sh done` | `git ls-remote --heads origin`으로 `head_sha` 원격 도달 확인 — 미도달이면 **보고 거부**(exit 2) |
| 착수 안전망 | `dflow.sh claim` | claim 응답에 선행 Task들의 `branch`·`head_sha`(0072 evidence 값) 포함 → `git cat-file -e <sha>^{commit}` + `git merge-base --is-ancestor <sha> HEAD` 검사 — 미도달이면 **메시지 출력 후 실행 거부** |

서버는 로컬 git을 볼 수 없으므로 산출물 검사는 클라이언트에서만 가능하다(이 사실이 §3의 MCP 비채택 근거와 같은 것이다). 차단 해제는 사람 판단 경로(`fp` 강제 진행)로만.

---

### 3. 클라이언트

정본은 리포에, 사용은 사용자 레벨에:

```
docs/agent/claude-skill/dflow-work/     ← 리포에 커밋 (정본)
├── SKILL.md                            ← ~140행. 트리거 문구를 description 에 직접 박는다
├── references/{api-contract,troubleshooting}.md
└── scripts/dflow.sh                    ← 얇은 curl 래퍼
```

```
ln -s <wbs-web 클론 경로>/docs/agent/claude-skill/dflow-work ~/.claude/skills/dflow-work
```

리포 갱신이 곧 스킬 갱신이다. 팀 배포가 필요해지면 같은 디렉터리를 `.claude-plugin/plugin.json`으로 감싼다(구조 변경 없음).

⚠️ **버전 스큐 한계**: 개발자는 MES 리포에서 작업하므로 wbs-web을 `git pull`하지 않고 심볼릭 링크 너머의 스킬은 낡는다. 완화: `/agent/me`의 `contract_version`을 스킬 로컬 버전과 비교하는 검사를 `dflow.sh doctor`와 스킬 시작 절차에 넣고, 불일치 시 "wbs-web pull 필요"를 출력한다.

**`dflow.sh` 계약:**

- **exit code**: `0` 성공 / `2` 사용법·설정·push 미완료 / `3` 인증 실패 / `4` 상태 충돌(409)·선행 미반영 로컬 차단(§2.9) / `5` 권한 없음(403) / `6` 네트워크·서버 / `7` 기능 꺼짐(404). 스킬이 산문을 파싱하지 않고 분기한다.
- **compact 출력**: 헤더 없는 공백 구분 1행/건, 상태 2자 코드(RD/CL/RP/AP/CX), 이름 40자 절단. 10건 ≈ 200토큰(원 JSON ~2,000토큰). `--json`은 특정 필드가 필요할 때만.
- **`done --auto-links`**: `git rev-parse HEAD` · `git remote get-url origin` · `git branch --show-current` · (`gh` 있으면) `gh pr view --json url`로 산출물 URL을 조립해 `links[]`로 보낸다. `parseLinks`가 `^https?://` URL을 20건까지 이미 받으므로(`report/route.ts:14-26` · `src/lib/domain/agentWork.ts:11`) **서버 변경 0으로 오늘 동작한다.**
- **`ref` 해석 3종**: 목록 순번 / UUID 접두 8자 / 전체 UUID. 사용자가 "3번 착수"라고 말할 수 있어야 한다.
- **다중 프로필**: `DFLOW_PATS` 순회·`--as`·`list --all` (§2.7).
- **claim 시 명세 캐시**: 응답의 명세(스칼라+`spec`+`acceptance`)를 `docs/tasks/{TSK}/spec.md`로 기록 — `/dev`의 로컬 소비 경계(§2.6).
- **선행 하드 차단**(§2.9): claim 응답의 선행 `head_sha` 로컬 도달 검사 — 미도달이면 메시지 출력 후 실행 거부. `done`은 push 미도달이면 보고 거부(exit 2).

스킬 사전 규칙: `validateReport`가 progress 100을 400으로 막는다는 사실(`src/lib/domain/agentWork.ts:27-33`)을 SKILL.md 본문과 troubleshooting 표에 명시해 400 왕복을 없앤다.

**라벨 결정론**: `AGENT_LABEL=claude-$(hostname -s)` 고정 산출. 무작위·타임스탬프 금지 — 레거시 경로 호환과 보드 표시를 위해 `claimed_by`는 계속 기록된다.

**세션 복구**: 로컬 상태 파일에 의존하지 않는다. `dflow work list --mine --status claimed`로 언제든 서버에서 복원한다 — `claimed_by_user_id`를 넣는 실질적 이유.

**MCP는 만들지 않는다** — 도구 표면 7개에 상시 컨텍스트 점유를 정당화할 수 없고, 원격 MCP는 개발자 PC의 git을 볼 수 없어 완료 증적 조립이 왕복 2회로 는다. **독립 npm 패키지도 만들지 않는다** — 배포 단위·버전 스큐가 늘고 사내 레지스트리 존재 여부도 미확인.

---

### 4. 착수 조건과 권한 상승 게이트

#### (a) 이 기능은 08-05 확정 결정의 번복이다

코퍼스에서 사용자가 유일하게 확정했던 **해석 2**(`21-multi-client-model.md:93` "서버 접속 사용자 = 에이전트 러너만. 사람은 WBS 확인과 승인만")는 그 비범위표(`:95-101`)에 "개인 배정 축 · '내 작업' 화면 · 사람용 claim"을 명시적 비범위로 못박았고, 이 문서의 제품 정의가 정확히 그것이었다. **번복은 2026-08-10 승인됐다**(미결 ⓪ 결정 완료) — 코퍼스 헤더에 번복 기록 완료.

발급 권한(미결 ①): `kind`로 나눠 `user_pat`은 본인 세션 자율 발급 + 관리자 대리 발급(§2.7), `runner`는 슈퍼유저 전용. 자율 발급은 읽기 스코프 한정 — **`work:report`는 §4(b)의 권한 상승 경로가 닫히기 전까지 관리자 승인 발급만.** ("웹 세션 권한의 부분집합이므로 권한 상승이 아니다"는 논거는 읽기 스코프에서만 성립한다.)

#### (b) `item_owners` 권한 상승 경로가 발행 가드에만 매달려 있다

`src/lib/agent/applyProgress.ts:8-9` — "`updateActual`의 담당팀(`item_owners`) 검사는 여기 없다 — 주문 발행이 프로젝트 관리자 전용이므로 항목 선정 검증은 발행 시점에 이미 끝났다."

웹 경로에서 멤버는 자기 팀이 담당인 리프만 실적을 쓸 수 있다(`src/app/actions/wbs.ts:96-99`, fail-closed). 에이전트 채널은 프로젝트 내 모든 리프에 쓴다. **에이전트 채널은 이미 같은 사람에 대해 웹보다 넓고, 오늘은 `requireProjectAdmin` 발행 가드 하나로만 닫혀 있다**(`src/app/actions/agentWork.ts:45-85`). 따라서 **에이전트측 주문 발행은 게이트 항목이다** — `authorized_by` 대리 판정 또는 `item_owners` 검사 복원(미결 ⑦)이 선행되기 전에는 착수하지 않는다.

---

### 5. 유지하는 것

- **완료 확정은 사람 몫.** `approved` 전이는 PM 세션 액션 `approveAgentCompletion`에만 있고(`src/app/actions/agentWork.ts:104-153`), `validateReport`가 progress 100을 400으로 막아 승인 경로를 강제한다. **`/approve` REST를 만들지 않는다.** 스킬은 "완료했습니다"가 아니라 "`reported`(승인 대기)"로 보고한다.
- **운영 D-CUBE 방어선은 워크플로가 아니라 게이트다.** `agent_projects` 미등록이면 claim/report가 404다(`externalApi.ts:43-48` · `routeShared.ts:38`). 등록은 슈퍼유저 서버 액션으로만 가능하며, **D-CUBE에 대해 이 액션을 실행하는 것이 이 설계 전체에서 가장 위험한 단일 동작이다.**
- **v1 계약 회귀는 기존 테스트가 지킨다.** `tests/agent/external-api.test.ts` · `work-routes.test.ts` · `claim-routes.test.ts` · `report-route.test.ts` · `apply-progress.test.ts` · `tests/domain/agent-work.test.ts` · `tests/actions/agent-work-actions.test.ts` · `tests/migrations/agent-work-loop.test.ts` — **총 8개**가 기준선. 게이트 리팩터 **전에** 레거시 경로 응답이 v1과 동일함을 이 파일들로 고정한다.

### 6. 고치지 않는다고 선언하는 것

- **progress의 WBS 즉시 반영**(`applyProgress.ts:11-49`) — v1 동작 유지. LLM 추정 퍼센트가 PM 실적을 오염시키는 경로는 남는다. 근본 해결은 상태 파생 환산 전환(미결 ③).
- **증적 검증** — `evidence`는 형식 검증만 한다. 서버가 commit SHA·PR head·CI를 독립 확인하지 않으므로 `/agent-ops` 상세에 **"에이전트가 제출한 주장이며 서버가 검증하지 않았음"**을 명시 표기한다.
- **원자성** — report는 WBS를 먼저 쓰고 보고 행을 나중에 insert한다(`report/route.ts:62-90`). 승인도 같은 계열 — `approveAgentCompletion`은 `updateActual(100)` 선행 후 CAS라, 반려와 경합하면 "WBS 100% + 주문 claimed" 불일치가 발생 가능함이 코드 주석에 명시돼 있다(`agentWork.ts:123-127`). 알려진 위험으로 유지.
- **lease/heartbeat/fencing** — 24시간 `isClaimStale`(`agentWork.ts:37-42`)만 있다. 다중 PC 개방 전까지 감내.

### 7. D'Flow ↔ dev-workflow 계약

두 시스템의 경계. **오늘 dev-workflow 툴체인의 기계 인터페이스는 파일시스템뿐이다**(원격 API·스프레드시트 교환 경로 0건 — 실측). 연동은 전부 신규 설계다.

#### 7.1 실측이 드러낸 갈라짐 (계약의 전제 조건)

| # | 갈라짐 | 실태 | 계약상 처리 |
|---|---|---|---|
| F1 | **상태머신 두 벌** | 실행 코드(플러그인 스크립트)는 5상태 `[ ]/[dd]/[im]/[ts]/[xx]`. 6상태는 `docs/state-machine.json`(목표 정의)과 로컬 파생 스킬에만 있고 `assign/accept/force` 이벤트·`[as]/[fp]/[ip]` 문자열이 코드에 0건 | **WBS 중앙관리 결정으로 갈라짐 자체가 해소** — 6상태는 D'Flow `stage`에서만 실행되고 로컬 구현(DEV-01)은 스코프 아웃. wbs.md 생성 시 상태는 항상 `[ ]` |
| F2 | **state.json이 진실 원천** | 실행 중 Task는 `docs/tasks/<ID>/state.json` 정본, wbs.md는 파생 사본 | 부트스트랩 import 시 wbs-parse JSON 경계만 사용(state 값 자동 반영). 변환기의 자체 md 파싱 금지. import 후에는 서버 `stage`가 정본, state.json은 사이클 실행 내부용 |
| F3 | **의존 임계값 불일치** | 문서 `[im]` 이상 vs 코드(`dep-analysis.py`) `[xx]`만 완료 취급 | 선행 판정 정본은 D'Flow 서버 게이트(§2.9, `im` 이상). dep-analysis 정정은 부트스트랩 전 로컬 검증용으로만 유지 |
| F4 | **4단계(ACT) WBS 무력화** | `wbs-validate`·`merge-wbs-status`가 `### TSK-\d+-\d+`(2세그먼트) 고정 — MES 4단 WBS 40개 Task를 0개로 읽고 `ok:true` | MES가 첫 대상이므로 **DEV-03 필수**(부트스트랩 검증). 완료 전 MES wbs.md 검증 결과를 신뢰하지 않는다 |
| F5 | **목록 JSON 6필드** | `--tasks-all`에 assignee·schedule·priority·계층 없음. Phase/WP 메타 파싱 코드 자체가 없음 | **DEV-02 `--export` 모드(계약 v2)**가 업로드 계약의 소스(§2.6) |

#### 7.2 경계 아티팩트 (계약 문서로 동결하는 것)

1. **export JSON 스키마 v2** — `wbs-parse.py --export` 출력(DEV-02). 노드 배열(Task+WP+ACT+Phase), 필드:
   `id`(=external_ref) · `parent_id` · `kind`(phase/wp/act/task) · `title` · `stage`(state.json 반영값) · `category` · `domain` ·
   `assignee`(email) · `schedule` · `depends[]` · `acceptance[]` · `priority`(문자열 라벨: critical/high/medium/low) ·
   **`model` · `tags[]` · `prd_ref` · `entry_point` · `spec_sections`** = `{requirements: string[], test_criteria: string[], constraints: string[], api_spec: string|null, data_model: string|null, description: string|null}`.
   TSK-01-01 계약 동결 대상에 포함된다.
2. **상태 어휘 매핑표** — 파일 `[ ]/[as]/[fp]/[ip]/[im]/[xx]` ↔ DB `stage` `todo/as/fp/ip/im/xx` ↔ 진척 환산 0/0/0/20/60/100. 산식 정본은 D'Flow(`plannedPct`/`statusOf` — dev-workflow 문서가 명시적으로 재사용 선언).
3. **필드 소유권**(미결 ⑫ 해소 — WBS 중앙관리) — **import 후에는 전 필드가 웹 정본이다.** 파일 값은 부트스트랩 시드일 뿐. 재import는 예외 경로(초기 반복 검증용)로만 허용하며 갱신 시 `stage`·`assignee_member_id`·`actual_pct`는 불변(웹 값 보존), 구조·명세 필드만 갱신.
4. **`/wbs/import` 요청/응답 스키마** — 요청 = export JSON v2 그대로(변환기는 얇게) + `project_id` + `module`(DOCS_DIR 명). `external_ref`는 `<module>/<id>` 조합(조합 주체는 import 서버 — 클라이언트는 id만 안다). import가 `spec_sections`를 고정 섹션 순서로 마크다운 조립해 `spec text` 저장, `acceptance[]`→jsonb, `priority` 라벨→주문 정수 매핑(critical=100 / high=50 / medium=10 / low=0). 응답 = `{upserted, skipped, unmatched_assignees[], non_leaf_skipped[], orders_created}` — 매핑 실패는 생략하지 않고 전량 리포트(에러 3원칙).

#### 7.3 분담표

| ID | 리포 | 작업 | 왜 그쪽인가 |
|---|---|---|---|
| DEV-01 | dev-workflow(플러그인) | ~~6상태 상태머신 로컬 구현~~ → **스코프 아웃**(WBS 중앙관리 — 상태 전이는 D'Flow `stage`) | 부트스트랩 1회 파일→DB만, 역방향 없음 |
| DEV-02 | dev-workflow(플러그인) | `wbs-parse.py --export` 신설 — 전 계층·전 필드 JSON **v2**(§7.2-1, `spec_sections` 포함) | 파서가 거기 있다. **계획의 중심** |
| DEV-03 | dev-workflow(플러그인) | validate·merge의 TSK 정규식 세그먼트 무제한화(4단 ACT 지원) | MES 4단이 첫 대상(부트스트랩 검증) |
| DEV-04 | dev-workflow(스킬) | 프로그램 리스트 입력 어댑터(§2.6) | WBS 생성 스킬이 거기 있다 |
| (본편) | wbs-web | 0069·0071·0072·0073 · 리졸버·게이트 · `/me`·`/mine`·`/wbs/import` · 배정·단계·명세 UI · 자동 발행 · 선행 게이트 · `/account` · 스킬·dflow.sh | 이 문서의 로드맵 전체 |

DEV-02~04는 wbs-web 로드맵 **밖**이지만, **DEV-02는 WP-07(TSK-07-04 업로드)의 선행 의존**이다 — 로드맵 게이트에 명시. DEV-02 완료 전 과도기는 §2.6의 Task별 `--json` 순회로 때운다.

## 로드맵 — WSF 구조

정본 워크플로우: `~/project/dev-workflow/docs/wbs-workflow.md` (Water-Scrum-Fall).
전체 체계를 이식하지 않고 **디플로우 작업에 필요한 세 가지만** 가져온다:

1. **샌드위치 구조** — PH-1 선행(결정·계약 동결) → PH-2 기능(병렬) → PH-3 후행(통합 검증).
2. **계약 동결 = 병렬화** — 계약 Task(TSK-01-01)만 확정되면 서버(WP-02)와 클라이언트(WP-04)와 WBS 축(WP-07)이 병렬 진행. 미결 ⓪①② 승인은 선행 Task(TSK-00-01)의 완료 조건.
3. **진척율은 파생값, LLM 자기보고 % 금지.**

상태 표기·사이클(`/dev` 등)·force/stub 규칙은 wbs-workflow.md를 그대로 따르며 여기 재기술하지 않는다.

### WP-00 결정·실측 — PH-1 선행 · `research`

- **TSK-00-01 미결 결정** — **완료(2026-08-10).** ⓪(해석 2 번복 승인)·①(자율+대리)·②(단일 테이블) 결정, 본 문서 §미결과 코퍼스 헤더에 명문화. WP-01 이하 게이트 해제.
- **TSK-00-02 테스트 환경 실측** (`research`, depends 없음 — 00-01과 병렬):
  - `wbs-web-test` Supabase 프로젝트의 **실제 존재 여부** 확인 — 테스트환경분리 설계(08-06)가 '설계 확정·구현 미착수'였다.
  - `.env.local.example`에 `AGENT_API_*` 키가 없음을 재확인(현재 `MINUTES_API_*`만 존재). 로컬·운영 전부 전 라우트 404 — 발급 없이는 어떤 단계도 데모되지 않는다.
  - `AGENT_API_ENABLED`/`AGENT_API_SECRET`을 **테스트 환경 전용으로만** 발급(테스트환경분리 §3.2). 운영 Vercel env는 손대지 않는다.
  - 테스트 DB에 샘플 프로젝트 1개 + `agent_projects.enabled=true` 등록 + 리프 항목 3~5건.
  - **테스트 사용자 2명 생성** — A(샘플 프로젝트 `project_roles` 부여), B(비멤버). 수용 기준 (d)의 검증 대상.
  - 산출물: 테스트 호스트 URL · 테스트 시크릿 · 샘플 project_id · 리프 항목 UUID 목록 · 테스트 사용자 A/B 계정.

### WP-01 공유 계약 동결 — PH-1 선행 · `infra` (contract-only)

- **TSK-01-01 계약 동결** (`infra`, depends: TSK-00-01) — 코드 없이 계약 shape만 확정해
  `docs/agent/claude-skill/dflow-work/references/api-contract.md` 초안으로 동결:
  0069/0071/0072/0073 DDL(컬럼·`unique(owner_user_id,name)`·`kind`·§2.5 담당자 로스터 축·`stage`·명세 컬럼) · `resolveAgentPrincipal` 반환 구조 ·
  `/me`·`/work/mine`·`/wbs/import` 응답 shape · **export JSON 스키마 v2·상태 어휘 매핑표·priority 라벨→정수 매핑·`spec_sections` 조립 규칙(§7.2 — dev-workflow와 공유하는 절반)** ·
  에러코드 표(400/401/403 `dependency_not_met` 포함/404/409) · `contract_version` 규약 · `DFLOW_PATS` 로컬 계약(§2.7) · claim 시 `as`→`ip` 자동 전이 여부(미결 ⑪ 잔여 소항목).
  **acceptance: 서버(WP-02)와 클라이언트(WP-04)와 dev 플러그인(DEV-01~03)이 이 문서만 보고 각자 착수 가능.**

### WP-02 신원축 서버 — PH-2 기능 · `infra`/`dev`

진입 게이트: TSK-01-01 `[im]` (실행엔 TSK-00-02 산출물 필요).
Task 분해: **TSK-02-01** 0069 마이그레이션(`infra`, 마이그레이션 단독 커밋, depends: 01-01) →
**TSK-02-02** 리졸버·멤버십 게이트·`/me`·`/mine`(`dev`, depends: 02-01) ·
**TSK-02-03** 발급 액션·UI(`dev`, depends: 02-01, 02-02와 병렬).

- **[마이그레이션 커밋, 코드와 분리]** `supabase/migrations/0069_agent_runners.sql` + `_rollback` — 코퍼스 초안 기반 + `kind text not null check (kind in ('user_pat','runner')) default 'user_pat'` · `token_prefix text not null unique` · `scopes text[] not null default '{work:read}'` · `expires_at timestamptz not null`. 컬럼: id · name · kind · owner_user_id(fk auth.users, on delete cascade) · token_prefix · token_hash · project_id(null=전체) · scopes · enabled · revoked_at · last_seen_at · created_by · created_at
  - 코퍼스 초안 대비 수정 두 곳: ① `name`은 전역 unique가 아니라 **`unique(owner_user_id, name)`** — 사용자별 PAT가 같은 테이블에 오면 남이 선점한 "laptop"을 못 쓰는 충돌이 생긴다. ② `owner_user_id`의 `on delete cascade`는 **유지** — 자격증명은 소유자 소멸 시 즉시 소멸하는 쪽이 옳다(잔존 행 = 고아 credential). 에이전트 활동 감사는 토큰 행이 아니라 usage 이벤트가 담당. 0069 헤더에 근거 주석.
  - **토큰 형식**: `dflow_pat_<prefix 12자>_<secret>` — secret은 32바이트 CSPRNG, DB에는 `sha256(전체 토큰)`만. prefix는 비밀이 아니라 조회 키다(충돌 시 재생성).
- 0069 RLS: `enable row level security` + **쓰기 정책 0개**. `revoke all ... from public, anon, authenticated; grant all to service_role;` — `0057_agent_work_loop.sql:79-89` 관례 그대로. `token_hash`는 authenticated에게 어떤 경로로도 노출하지 않는다.
- **[코드 커밋]** `src/lib/domain/agentToken.ts` 신설(순수: 토큰 형식·prefix 분리·만료/폐기 판정) + `src/lib/agent/token.ts`(발급·조회·sha256 상수시간 비교).
- `src/lib/agent/externalApi.ts` — `agentApiEnabled()`를 `AGENT_API_ENABLED === 'true'` 단독 판정으로 리팩터, `gateAgentApi`를 `resolveAgentPrincipal`로 확장(§2.1). 라우트는 `scopes`(읽기도 `work:read`)와 `projectId` 한정을 강제.
- **[보안 순서 필수]** `work/route.ts`와 `[id]/route.ts`에 `isAgentProjectMember` 게이트 추가 — **PAT principal에만**(§2.2). 이 보강이 PAT 발급보다 먼저 또는 같은 배포에 들어가지 않으면 토큰 하나로 enabled 전 프로젝트가 샌다. 비멤버는 404.
- 신규 `me/route.ts` — `{user_email, scopes, token_expires_at, contract_version, projects:[{id,name,agent_enabled,role}]}`. PAT 전용(레거시 호출 400 `identity_required`).
- 신규 `work/mine/route.ts` — Phase 1은 `scope=available` 단일. `limit=`(기본 20, 최대 100). 집계는 `agent_projects.enabled=true` ∩ 멤버 프로젝트만. 정렬은 v1과 동일(`priority desc, created_at asc`).
- `src/app/actions/agentTokens.ts` — `createAgentToken` / `revokeAgentToken` / `listMyAgentTokens`. 로그인 세션 기반. 평문은 발급 응답 1회만. 규칙: ① **모든 액션은 `AGENT_API_ENABLED` 뒤에** — 운영 env에 플래그가 없는 한 발급 자체가 거부된다 ② 대상 행은 `owner_user_id = 세션 사용자` 한정(관리자 대리 발급은 미결 ① 승인 후 `created_by` 기록으로 확장) ③ 슈퍼유저 PAT는 `project_id` 지정 필수 + 만료 상한 단축 ④ `work:report` 스코프는 자율 발급 금지(§4(a)).
- 발급 UI — **`/account` '내 계정' 페이지 신설**(사용자 결정): 프로필 정보 + 비밀번호 변경(기존 `src/components/account/ChangePasswordModal.tsx` 로직 통합) + PAT 생성·복사(평문 발급 1회)·폐기 목록. 구현은 `src/components/account/*`(UI 위험군 밖). 헤더 드롭다운 '비밀번호 변경' → '내 계정' 교체는 `HeaderChrome.tsx` 1줄 — **pre-push G2 대상이라 브랜치 경유**. 참고: `/agent-ops`에는 페이지 레벨 가드가 없다(로그인 멤버 누구나 진입) — 개인 토큰 UI를 거기 두지 않는 추가 근거.
- **[회귀 방어]** 게이트 리팩터 **전에** 레거시 경로 계약 테스트를 고정(§5의 8개 파일).
- 클라이언트: SKILL.md §0~§2(전제·whoami·번호 매긴 목록) + `references/api-contract.md` 골격. `ln -s` 설치 절차를 README에.
- **수용 기준**: (a) `agent_projects` 미등록 프로젝트에 대해 `/me`는 200이되 그 프로젝트가 목록에 없다 (b) `AGENT_API_ENABLED` 미설정 시 `/me`·`/work/mine`이 404 **이고 토큰 발급 액션도 거부된다** (c) 레거시 시크릿 요청이 v1과 동일 응답(기존 `tests/agent/` 계열 8개 전부 초록) (d) A 사용자 PAT로 B 사용자만 멤버인 프로젝트의 주문이 조회되지 않는다 (e) `scope=claimed` 요청은 400 `unsupported_scope`. **claim/report/release는 손대지 않는다 — 이 단계에 원장·WBS 쓰기 경로가 없다**(토큰 발급이라는 DB 쓰기는 세션 인증 + 킬스위치 뒤).

### WP-03 쓰기 루프 — PH-2 기능 · `infra`/`dev`

진입 게이트: WP-02 말단 `[im]` + 테스트 DB 실재(TSK-00-02).
Task 분해: **TSK-03-01** 0071·0072 마이그레이션(`infra`, depends: 02-02) →
**TSK-03-02** claim/release/report의 PAT 소유 판정·스코프 강제·`/mine` 확장(`dev`, depends: 03-01).

- **[마이그레이션 커밋]** `0071_agent_order_claim_owner.sql` + `_rollback` — `alter table public.agent_work_orders add column if not exists claimed_by_user_id uuid references auth.users(id) on delete set null;`(`wbs_item_id`와 같은 감사 보존 정책) + `create index ... (claimed_by_user_id, status) where claimed_by_user_id is not null`. 헤더에 "v1의 '기존 테이블 ALTER 0건'과 충돌해 보이나 대상은 v1이 만든 에이전트 전용 테이블이고 D-CUBE 핵심 테이블은 무변경·nullable" 근거를 남긴다.
- **[마이그레이션 커밋]** `0072_agent_report_evidence.sql` + `_rollback` — `alter table public.agent_work_reports add column if not exists evidence jsonb not null default '{}'::jsonb;`(기존 `links` jsonb 유지, default라 백필 불필요).
- `claim/route.ts` — PAT 경로에서 `claimed_by_user_id`를 **서버 유도값으로** 기록(바디에서 받지 않는다). `claimed_by`(라벨)는 v1 호환·보드 표시용으로 계속 기록. CAS 무변경.
- `release/route.ts` · `report/route.ts` — PAT 경로의 소유 판정·CAS를 `claimed_by_user_id` 기준으로 전환(§2.3 — 레거시는 문자열 기준 그대로, OR 금지, 교차 소유 양방향 403).
- `/work/mine`에 `scope=claimed|all` 도입(0071과 같은 배포) — `all` 응답은 claimed 구획 먼저.
- 스코프 강제 — `work:claim` / `work:report` 없으면 403 `insufficient_scope`. **`work:report`만 유일하게 `wbs_items.actual_pct`를 쓰므로** 발급 기본값에서 제외하고 명시 opt-in.
- `evidence` 형식 검증 — `{branch, base_sha, head_sha, repo_url, pr_url, checks:[{name,status}]}`. SHA 40자 hex와 URL host allowlist만 본다. 서버가 실재·일치를 확인한다고 주장하지 않는다.
- `GET /work/{id}` 응답에 `mine:boolean` · `claimed_by_user_email` 추가(PAT 호출 시에만 채워 기존 소비자 무영향).
- **수용 기준**: 테스트 프로젝트에서 조회→claim→브랜치→커밋→progress 보고(WBS `actual_pct` 반영 확인)→completion→PM 승인이 한 세션에 통과하고, **운영 D-CUBE에는 행 변화 0건**. PC A에서 claim → PC B에서 report가 성공한다(라벨이 달라도).

### WP-04 클라이언트 — PH-2 기능 · `dev`

진입 게이트: **TSK-01-01 `[im]`만** — 서버(WP-02·03)와 병렬 진행(계약 동결의 배당). 서버 미배포 구간의 접점은 stub(계약 문서 기준 mock)으로 격리, E2E 확인은 WP-06 몫.
Task 분해: **TSK-04-01** dflow.sh(`dev`, depends: 01-01) → **TSK-04-02** SKILL.md·references(`dev`, depends: 04-01).

- `dflow.sh` — 서브커맨드 `me|list|show|claim|progress|done|release|doctor`. 의존성 0(curl + POSIX sh). `doctor`와 스킬 시작 절차는 `contract_version` 비교(§3). 다중 프로필 `DFLOW_PATS` 순회·`--as`·`list --all`(§2.7).
- exit code · compact 출력 · `ref` 해석 3종(순번 매핑 `~/.cache/dflow/last-list.json`, TTL 30분) · `done --auto-links` — §3 계약 그대로.
- SKILL.md §3~§7 — 라벨 결정론 · 브랜치 `agent/<order8>-<slug>` · 커밋 트레일러 `DFlow-Order: <uuid>` · 진행/완료 보고 · 금지사항.
- SKILL.md **금지사항 목록**(명령형): 토큰을 `echo`·파일 기록·명령 문자열 보간 금지(env 확장으로만 전달) / `DFLOW_API_BASE` 기본값 채우기 금지 / `--pct 100` 금지 / approve 시도 금지 / 409를 재시도로 뚫기 금지 / 실패를 성공으로 요약 금지 / 완료를 'approved'가 아니라 '**reported(승인 대기)**'로 보고.
- `references/troubleshooting.md` 해석표 — 404는 세 원인(기능 꺼짐 / 프로젝트 미등록 / 주문 없음)이 의도적으로 구분되지 않는다. `/agent/me`를 진단 창구로 쓰는 절차 명시. 401 / 403 `forbidden_role`·`not_claim_owner`·`insufficient_scope`·`not_assignee`·`human_gate` / 409 `conflict`·`apply_failed` / 400 `identity_mismatch` 전수.
- **UI 위험 파일 경고** — 작업 대상이 wbs-web 자신일 때 `src/app/globals.css` · `src/app/layout.tsx` · `src/app/(app)/layout.tsx` · `src/components/app/*` 변경 감지 시 'Preview 확인 필요'(pre-push G2) 경고. `git add -A` 금지 · 마이그레이션 분리 커밋(G1)을 SKILL.md에 인용.
- **수용 기준(온보딩)**: 새 개발자가 (1) 웹에서 토큰 발급 (2) `DFLOW_API_BASE`/`DFLOW_PATS` 설정 (3) `ln -s` 스킬 설치 — **3단계 10분 이내**에 MES 리포에서 '내 D'Flow 작업 보여줘'가 동작한다.

### WP-05 운용성 — PH-2 기능 · `dev`

진입 게이트: WP-03 말단 `[im]`.

- `/account` PAT 관리 보강 — 목록(prefix·이름·`last_used_at`·만료) · 만료 임박 경고 · 즉시 폐기. (기본 UI는 WP-02에서 `/account`에 신설 — 이관 없음.)
- **감사 격차 해소** — `/api/v1/agent/*` 호출이 `usage_events`에 전혀 남지 않는다. 최소한 토큰별 호출 카운트와 `last_seen_at`은 남긴다.
- `POST /work/{id}/heartbeat` — lease 연장. 24시간 stale 오탐 방지용 최소판. fencing token은 없다.
- `/agent-ops` 상세 모달에 `claimed_by_user_email` · `evidence` · '에이전트가 제출한 주장이며 서버가 검증하지 않았음' 표기.
- IP·토큰당 rate limit과 인증 실패 로깅 — `/api/v1/agent/*`가 운영 도메인의 브루트포스 표면이 된다.
- 레거시 경로 deprecation — 레거시 응답에 `Deprecation: true` 헤더. 제거 일정은 미결 ④.
- **수용 기준**: 토큰 유출 시나리오에서 폐기 1행으로 해당 사람만 차단되고 다른 프로필은 계속 동작한다.

### WP-07 WBS 담당자·단계·업로드·자동 발행 — PH-2 기능 · `infra`/`dev`

진입 게이트: TSK-01-01 `[im]`. 서버(WP-02·03)와 병렬 가능.

- **TSK-07-01** 0073 마이그레이션 — `assignee_member_id`(로스터 복합 FK)·`stage`·`external_ref` + **명세 컬럼**(§2.5) + 신규 upsert RPC(`infra`, 단독 커밋, depends: 01-01)
- **TSK-07-02** 배정·단계 UI — WBS 시트·간트, 이슈 담당자 피커 관례 재사용 + `requireProjectAdmin` 가드(`dev`, depends: 07-01)
- **TSK-07-03** `/work/mine?scope=assigned`(로스터 다리 이중 매칭) + claim 배정 제한(403 `not_assignee`) + **선행 게이트(403 `dependency_not_met`, §2.9)**(`dev`, depends: 07-01, 02-02)
- **TSK-07-04** `POST /api/v1/wbs/import` — export JSON **v2** 업로드·`external_ref` upsert·`spec_sections` 조립·미매칭 전량 리포트(`dev`, depends: 07-01, 02-02 — **외부 의존 DEV-02**, 미완이면 과도기 변환기로 대체)
- **TSK-07-05** 배정 기반 자동 발행 — `ensureOrderForAssignedLeaf` 멱등 함수(수용 기준 = `acceptance` jsonb) + 활성 주문 부분 유니크 + import·배정 UI 두 트리거 + 발행 폼 항목 검색 개선(`dev`, depends: 07-01, 07-02, §2.8)
- **TSK-07-06** 뷰어 명세 패널 — 항목 선택 시 스칼라 배지 + `spec` 마크다운 렌더·편집(`dev`, depends: 07-01)

### WP-06 통합 검증 — PH-3 후행 · `itest`

진입 게이트: 검증 대상인 WP-02·03·04·07 말단이 `[im]` 이상 (WP-05는 게이트 아님 — fast-tracking).
`itest`는 force·bypass 금지. 결함은 여기 쌓지 않는다 — 해당 기능 WP에 `defect` Task 신설 후 재실행.

- **TSK-06-01 수직 E2E** (depends: 03-02, 04-02, 07-05) — **wbs.md 업로드→배정→자동 발행**→조회→claim→브랜치→progress(WBS 반영 확인)→completion→PM 승인 한 세션 통과 + PC A claim → PC B report + 재업로드 멱등(주문 중복 0건)
- **TSK-06-02 보안 매트릭스** (depends: 03-02, 07-03) — WP-02 수용 기준 (a)~(e) 전수 + 교차 소유 양방향 403 + 비멤버 404 + 배정 항목의 타인 claim 403 + **선행 미완 claim 403 `dependency_not_met` + push 미도달 `done` 거부(§2.9)** + **운영 D-CUBE 행 변화 0건**
- **TSK-06-03 온보딩 실측** (depends: 06-01) — 신규 개발자 3단계(발급→env→`ln -s`) 10분 이내, MES 리포에서 "내 D'Flow 작업 보여줘" 동작

---

### 스코프 밖 — 후속 WBS 로 이관

아래는 이 WBS에 넣지 않는다(별도 승인·별도 WBS 대상).

**배정·의존성·에이전트측 발행:**
- **[게이트 — 선행 필수]** 에이전트측 주문 발행 도입 **전에** `item_owners` 권한 상승 경로를 닫는다(§4(b), 미결 ⑦의 결론 없이 착수 금지).
- WBS FS/SS 의존성 기반 claim gate — 선행 미완 주문을 `blocked_by` 사유와 함께 목록에서 분리(`computeDependencySchedule` 재사용). 착수 전 `task_dependencies` 실제 등록 건수 실측 — 0이면 우선순위 로직이 무의미하다.
- 에이전트 계열 테이블 RLS 쓰기 정책 보강 — `agent_*` 3테이블은 SELECT 정책만 있고 쓰기는 전부 service_role(서버 가드가 유일 관문, `0057:55-59` 주석). 테스트환경분리 §5.3이 별도 과제로 규정.
- **운영 D-CUBE의 `agent_projects` 등록 판단** — 이 설계 전체에서 가장 위험한 단일 동작. 별도 승인 안건.

**코퍼스 합류:**
- `agent_runners.kind='runner'`로 머신 credential 발급 — 같은 테이블이므로 교체 마이그레이션 불필요(이 설계가 `agent_runners` 이름을 쓰는 이유).
- `21-multi-client-model.md` §5의 나머지 — `assigned_agent` · `authorized_by` · `claim-next` RPC(FOR UPDATE SKIP LOCKED).
- control-plane v2 P0 잔여 — Run Attempt 분리 · heartbeat lease + fencing · worktree 격리 Runner · 증적 서버측 독립 검증 · 승인 트랜잭션 원자성. v2 문서 자체의 승인이 선행.
- progress telemetry와 WBS 공정률 분리 여부(미결 ③).
- `docs/design/dflow-agent-work-api-spec.md` 개정 — PAT 인증축 · `claimed_by_user_id` · `/me`·`/mine`·`/wbs/import` · 레거시 deprecation.
- 에이전트 관련 설계 문서 4벌(v2 초안 · WBS-AI PM · 테스트환경분리 · 코퍼스)의 정본 관계 정리.

## 미결 사항 (사용자 승인 필요)

- **⓪ [결정 완료 2026-08-10] 해석 2 번복 승인.** 사람도 개인 PAT로 서버 접속·내 작업 조회·claim·보고를 수행한다. 코퍼스(`21-multi-client-model.md` 헤더)에 번복 기록 완료.
- **① [결정 완료 2026-08-10] 발급 권한 = 자율+대리.** `user_pat`은 본인 세션 자율 발급 + 프로젝트 관리자 대리 발급(`created_by` 기록 — §2.7), 자율·대리 모두 읽기 스코프 한정. `work:report`는 미결 ⑦이 닫히기 전까지 관리자 승인 발급만. `runner`는 슈퍼유저 전용. 배정–신원 연결은 §2.5-④ 그대로: 배정은 로스터 축에 저장, 조회는 PAT 신원(user_id·email 이중 매칭)으로 판정.
- **② [결정 완료 2026-08-10] `agent_runners` 단일 테이블 + `kind`.** 훗날 러너 credential 합류가 마이그레이션 없이 끝난다.
- **③ progress 보고의 WBS 즉시 반영을 유지하는가.** `applyProgress.ts:11-49`가 `actual_pct` + `change_logs` + 스냅샷을 즉시 쓴다 — LLM 추정 퍼센트가 PM 실적·주간보고·PPT로 전파되는 경로. 워크플로우 대원칙("실적% 입력 금지·전부 파생값")과 정면 충돌. **권고: `stage` 파생 환산(todo/as/fp=0 · ip=20 · im=60 · xx=100)으로 전환 + 자기보고 %는 telemetry로 격하.** 구현 변경은 승인 필요.
- **④ 레거시 공유 시크릿 경로를 언제 끊는가.** 결정 둘: (a) 운영에 `AGENT_API_ENABLED`를 켜는 시점(= PAT 경로 운영 개방) (b) 레거시 시크릿 분기의 폐기 일정 — 레거시가 살아있는 동안 무스코프 크로스 프로젝트 열람이 남으므로 빠를수록 좋다. `scripts/agent-harness-example.mjs`가 레거시 경로에 의존.
- **⑤ 운영 D-CUBE를 `agent_projects`에 등록할 것인가, 언제.** 미등록 404가 이 설계 전체에서 가장 강한 안전망. 등록은 슈퍼유저 액션 1회이며 되돌릴 수 있지만 그 사이 쓰인 실적은 되돌아오지 않는다. 통합 검증(WP-06) 전에는 하지 않기를 권고.
- **⑥ 8/26 역산 일정에서 이 기능의 우선순위.** 테스트 환경 `[1]`의 1차 마감(8/9)이 지났고 실재가 미확인 — `[1]`이 미완이면 쓰기 루프 이후가 전부 막힌다. 이 기능이 `[2']`와 병행인지, `[4]` v2 P0 vertical slice에 흡수되는지 정리 필요.
- **⑦ `item_owners` 권한 상승을 어떻게 닫는가(에이전트측 발행 도입 전제).** (a) `authorized_by` 대리 판정(코퍼스 권고) vs (b) `item_owners` 검사 복원(담당 미지정 항목에서 루프가 통째로 막힘) 중 택1.
- **⑧ 클라이언트 형태 최종 확정.** 권고: `dflow.sh`(의존성 0, curl 래퍼). 대안(순수 curl 인라인 / 독립 npm)은 토큰 비용·버전 스큐로 비권장. 사내 npm 레지스트리 존재 여부 미확인이라 npm 경로는 임계경로에서 뺐다.
- **⑨ 스킬 배포 방식.** MVP는 리포 정본 + `ln -s`(1인 기준 최소 마찰). 팀 배포 시점이 오면 `.claude-plugin/plugin.json`으로 감싸는 전환 시점·대상 인원 결정 필요. 심볼릭 링크는 리포를 클론하지 않은 PC에서는 성립하지 않는다.
- **⑩ 문서 정본 관계 정리 주체.** 에이전트 관련 설계 4벌(v2 초안 · WBS-AI PM · 테스트환경분리 · 코퍼스)이 겹쳐 있고 폐기·승계 선언이 없다. 코퍼스의 마이그레이션 번호도 실물과 어긋난다.
- **⑪ [결정 완료] Task 단계.** 6상태 채택 + 전이 권한은 정본 규정 채택(사람: assign/unassign/force/unforce/accept · 에이전트: cycle.start/*.ok/*.fail/bypass) — §2.5-② 반영. 잔여 소항목 하나만 남음: claim 시 `as`→`ip` 자동 전이 여부(TSK-01-01에서 확정).
- **⑫ [결정 완료] WBS 중앙관리.** 각 로컬 wbs.md를 계속 읽으면 다인·다PC 충돌 — **import 후 D'Flow DB가 전 필드 정본**이고 wbs.md는 최초 작성·검수·import 부트스트랩 전용으로 은퇴한다(§2.6). `/dev` 소비는 API+로컬 캐시. 재import는 초기 반복 검증용 예외 경로(웹 값 보존 규칙은 §7.2-3).
- **⑬ [부분 결정] 개발 참조 문서의 저장소 — 혼합.** Task 밀착 산출물(design.md 등)은 작업 리포 git 정본(툴체인이 이미 그렇게 동작), 프로젝트 수준 분석·참고는 D'Flow 위키, 연결은 wbs.md `prd-ref`/`note`와 D'Flow `links`. **남은 미결**: 에이전트용 위키 읽기 API(`docs:read` 스코프)의 범위·시점 — 위키 계열은 RLS 쓰기 정책이 없어 서버 가드가 유일 관문인 계열이므로 후속 승인 대상.
