# 무인 개발 루프 — 설계

작성 2026-08-19 · 상태 **사용자 승인(설계 단계)** · 기준 커밋 `main@0b97c36`

> WBS 작업을 에이전트가 가져가 구현하고, 서버가 GitHub 을 직접 조회해 판정·병합하고,
> 후행 작업이 그 위에 쌓이는 루프를 **사람 개입 없이** 돌린다.
>
> 선행 문서: `2026-07-31-agent-work-loop-design.md`(v1, 구현 완료) ·
> `2026-08-10-claude-code-work-integration-review.md`+부록(PAT·스킬·WBS 축, 구현 완료).
> 이 문서는 그 위에 **판정 자동화**를 얹는다. `2026-08-05-wbs-ai-pm-design.md`(별도 제품·MariaDB)는
> 8-10 검토에서 "D'Flow 확장"으로 방향이 뒤집혔으므로 적용하지 않는다.

---

## 0. 사용자 결정 (2026-08-19 브레인스토밍)

| # | 결정 | 기각한 대안 |
|---|---|---|
| ① | WBS 는 **작업명만** 있다 → 선행 명세 배치가 `spec`·`acceptance` 를 만들고 사람이 1회 검수 | 러너가 매번 즉석 생성 / 기존 설계서 매핑 / 명세도 WBS 작업으로 |
| ② | 완료 판정 = **CI + 독립 리뷰어 2겹** 후 자동 승인 | CI 만 / 무조건 승인+사후감사 / 완료만 사람이 몰아서 |
| ③ | 대상 리포 = **GitHub 기존 리포**(MES 공통개발) | 그린필드 / 사내 GitLab |
| ④ | 동시성 = **러너 1대 · 1건 직렬** | 1대 N건 병렬 / 여러 PC / 서버급 상주 전용기 |
| ⑤ | 병합 = **통합 브랜치(develop) 자동 병합**, main 승격은 사람 | main 자동 병합 / PR 만 / 브랜치 없이 직커밋 |
| ⑥ | 격리 = **전용 worktree + 도구 화이트리스트** | Docker 완전 격리 / 리포 리모트에서 그대로 |
| ⑦ | 접근안 = **A. 서버 주도 게이트** — D'Flow 가 GitHub 을 직접 읽어 판정 | B. 러너 주도 / C. CI 주도 |
| ⑧ | 스코프 = **P0 전장 + 무인**(§7 의 P0 12건을 다 메우고 `auto_gate` 를 켠다) | 체인 무결성만 / 보안만 / 명세 계층만 |

대상 프로젝트는 **MES 공통개발**이 1차, **준비** 프로젝트가 2차다. 운영 **D-CUBE 는 영구 제외**
(`agent_projects` 미등록 유지 — 미등록 프로젝트는 전 엔드포인트가 404 로 존재를 숨긴다).

---

## 1. 아키텍처

세 계층이고 사람은 1계층에만 있다.

```
[1계층 · 명세]  작업명만 있는 WBS
   로컬 배치 ──claude──> spec/acceptance/depends 생성 ──POST /api/v1/wbs/import──> D'Flow DB
                                                              │
   사람: 뷰어에서 훑고 dev_workflow=ON + 러너 계정 배정  ←────┘   ← 사람의 유일한 개입
                                                              │
                                          ensureOrderForWorkflowLeaf 자동 발행
                                                              ▼
[2계층 · 실행]  러너 데몬 (개발 PC 1대, 1건 직렬)
   GET work/mine?scope=assigned ─> claim ─> worktree ─> claude -p 구현 ─> 로컬 검증 ─> push
                                                                         ├─ gh run watch (CI 결론 대기)
                                                                         └─ 리뷰어 세션(별도 컨텍스트)
                                          POST report kind=completion + evidence ◀───┘
                                                              ▼
[3계층 · 판정]  D'Flow 서버 게이트 (사람 없음)
   evidence.repo_url·head_sha 로 GitHub 을 직접 조회
     ① 리포 일치  ② SHA 실재·브랜치 tip  ③ 체크런+커밋스테이터스 전부 성공
     ④ 리뷰어가 acceptance 전 항목을 덮고 전부 pass  ⑤ PR merge(sha 지정) 성공
     └─ 다섯 다 통과 → approved + actual_pct 100 + stage 'xx'
                        └─ 후행 depends 해제 → 러너의 다음 폴링 ──루프
```

### 1.1 이 설계의 세 가지 축

**완료의 정의를 "병합됨"으로 옮긴다.** 승인 조건에 `develop` 병합 성공을 넣으면 후행이
worktree 를 딸 때 선행 코드가 이미 base 에 들어와 있다. WBS 의존 그래프가 별도 스케줄러 없이
그대로 실행 순서가 된다.

**CI 대기는 러너가 한다.** Vercel 함수가 CI 를 기다릴 수 없으므로 러너가 `gh run watch` 로
결론이 난 뒤 `done` 을 부른다. 서버는 그 시점에 조회하면 답이 나와 있고, pending 이면
`409 ci_pending` 으로 돌려보내 러너가 재시도한다.

**러너는 판정에 참여하지 않는다.** 러너가 보내는 것은 "어디를 보라"는 좌표(`repo_url`+`head_sha`)뿐이고
통과 여부는 서버가 GitHub 에서 읽는다. 러너 스크립트에 버그가 나도 공정률은 오염되지 않는다.

### 1.2 이미 있는 것 (실측, `main@0b97c36`)

| 축 | 실물 |
|---|---|
| 작업 원장 | `agent_work_orders`·`agent_work_reports`(0057), 활성 주문 부분 유니크(0077), `evidence` jsonb(0073) |
| API | `GET work`·`work/{id}`·`work/mine` · `POST claim`·`report`·`release` · `GET me` · `POST /api/v1/wbs/import` |
| 신원 | `agent_runners`(0078) — PAT 해시·스코프·만료·`kind` |
| WBS 축 | `assignee_member_id`·`stage`(as/fp/ip/im/xx, 0082)·`depends`·`acceptance`·`spec`·`entry_point`·`external_ref`·`dev_workflow`(0077·0082) |
| 자동 발행 | `ensureOrderForWorkflowLeaf` — 5단 게이트, 23505 no-op 수렴 |
| 선행 차단 | claim 시 `depends` 게이트 403 `dependency_not_met` |
| 클라이언트 | Claude Code 스킬 `docs/agent/claude-skill/dflow-work/` + `dflow.sh`(계약 2.0) |
| 알림 | 알림함(0074·0075), `work.*` 9종 배선 |

**없는 것은 판정 자동화 전부와, 그것을 켜기 전에 메워야 할 §7 의 P0 12건이다.**

---

## 2. 명세 계층 — 작업명을 실행 가능한 명세로

사람이 개입하는 유일한 지점이다. 여기서 걸러지지 않은 오해는 그대로 코드가 되고 100% 가 되므로,
설계 목표는 **사람이 빨리 훑고 빨리 거부할 수 있게** 하는 것이다.

### 2.1 배치는 로컬에서 돈다

서버(Vercel)에 LLM 호출을 두지 않는 기존 원칙 그대로다. `scripts/spec-draft.mjs` 가 D'Flow 에서
WBS 트리를 읽어 **모듈(WP) 단위로 잘라** `claude -p` 에 넘기고 결과를 `/api/v1/wbs/import` 로 upsert 한다.

한 번에 전체를 넘기지 않는 이유는 둘이다.

1. 넓은 영역을 통째로 뱉게 하면 **출력 상한에 걸려 결과가 통째로 사라진다**(실측 사고 3건).
   모듈당 20~30항목, 스키마에 `maxItems`·`maxLength` 를 건다.
2. 임포트 후처리가 갭 하나마다 `ensureOrder`(4쿼리+INSERT)를 **순차 호출**한다. 600건이면 왕복 3000회이고
   라우트에 `maxDuration` 선언이 없다. 같은 payload 재POST 시 갭 채우기로 안전하게 이어지므로
   **모듈 단위 분할은 선택이 아니라 필수다.**

### 2.2 항목당 생성물

| 필드 | 내용 | 왜 필요한가 |
|---|---|---|
| `spec` | 무엇을 만드는지 5~15줄. 화면/API/테이블 이름을 실명으로 | 러너가 매번 다른 것을 만드는 것을 막는다 |
| `acceptance` | 기계가 검사 가능한 조건 배열 | 3계층 리뷰어가 항목별 pass/fail 을 매길 대상. 여기 없는 것은 판정할 수 없다 |
| `entry_point` | 손댈 파일·디렉토리의 시작점 | worktree 안에서 헤매는 시간을 줄이고 리뷰어가 diff 범위를 검증하는 기준 |
| `depends` | 선행 `external_ref` 배열 | 이것이 곧 실행 순서다 |
| `category` | dev/feat/infra/itest 등 | 프롬프트 템플릿과 CI 게이트 강도를 가른다 |

**`acceptance` 가 비면 그 항목은 무인 대상이 아니다.** 배치가 조건을 세우지 못하는 항목은
`dev_workflow` 를 켜지 못하게 하고 사람 작업으로 남긴다. "판정 기준을 못 쓰겠다"는 것은 대개
작업이 덜 쪼개졌다는 신호이고, 억지로 통과시키면 3계층에서 리뷰어가 아무거나 통과시키는
형태로 되돌아온다.

### 2.3 검수는 새 화면을 만들지 않는다

WBS 뷰어의 명세 패널(0077 로 이미 DB 에 있고 렌더 대상)에서 읽고, 사람이 하는 동작은 둘뿐이다 —
`dev_workflow` 켜기, 러너 계정을 담당자로 배정하기. 그 순간 `ensureOrderForWorkflowLeaf` 가
주문을 자동 발행한다. **즉 "검수 통과"의 물리적 표현이 `dev_workflow=true` 이고, 새로 만들 승인 UI 가 없다.**

### 2.4 재업로드 규칙 (P0-7·P0-9 와 직결)

`import_wbs_upsert` 의 `on conflict do update` 목록에 `code`·`biz`·`deliverable`·`planned_start/end`·
`sort_order` 가 들어 있는데 업로더(`toRpcNode`)는 앞의 셋을 보내지 않는다. 그대로 두면 재업로드마다
`code` 가 `external_ref` 로 되돌아가고 `biz`·`deliverable` 이 NULL 로 지워지며 웹에서 조정한 정렬이 사라진다.
보존되는 것은 `actual_pct`·`stage`·`assignee_member_id`·`weight` 뿐이다 — **실적은 안전하지만
사람이 웹에서 손댄 내용은 안전하지 않다.**

규칙 셋을 둔다.

1. **미지정 필드는 갱신하지 않는다** — `toRpcNode` 가 보내지 않은 컬럼을 `do update` 목록에서 뺀다(근본 수정).
2. **`stage='xx'` 항목은 배치가 건너뛴다** — 끝난 항목의 명세를 바꾸면 감사 기록과 어긋난다.
3. **`weight` 를 신규 삽입 시 시드한다**(P0-9). 지금은 삽입 컬럼에 `weight` 가 없어 전부 null 이 되고,
   `overallProgress` 는 루트에 weight 가 하나라도 있으면 null 을 0 으로 쳐서 **에이전트 모듈이
   전사 공정률에서 통째로 빠지는데 트리 화면은 100% 로 보인다.** `on conflict` 에서는 보존한다.

---

## 3. 실행 계층 — 러너

### 3.1 러너는 상태를 갖지 않는다

진실은 전부 서버 원장에 있고 로컬에는 worktree 와 연속 실패 카운터만 남는다. 죽었다 살아나면
`list --scope claimed` 한 번으로 복원한다. 위치는 `docs/agent/runner/` — 스킬(`dflow-work`)과 같은 리포·
같은 `ln -s` 설치 관례를 따른다(토큰은 리포가 아니라 로컬 env 에 있으므로 "러너 코드가 D'Flow 리포에
있으면 위험"하다는 반론은 성립하지 않는다).

### 3.2 1 사이클

```
① GET /work/mine?scope=assigned    → priority desc, created_at asc 중 1건
② claim                            → 403 dependency_not_met / not_assignee 는 오류가 아니라
                                       "다음 후보로" 신호. 전부 막히면 sleep 후 ①
③ git fetch && git worktree add .runner/<주문8> -b agent/<주문8>-<slug> origin/develop
④ spec 캐시 → docs/tasks/<TSK>/spec.md
⑤ 구현 세션   claude -p  (§3.4 실행 규약)
⑥ 로컬 검증   프로젝트 표준 빌드·테스트·린트 → 실패 시 자가수정 1회, 또 실패면 release
⑦ push → PR 생성 → gh run watch (CI 결론까지 대기, 타임아웃 T2)
⑧ 리뷰어 세션 claude -p (별도 컨텍스트)
⑨ POST report kind=completion + evidence
⑩ 서버 응답으로 분기 → ①
```

**`scope=available` 을 쓰지 않는다.** `available` 집합은 배정자·선행을 걸러내지 않아
`403 not_assignee`·`dependency_not_met` 을 상시 맞는다.

### 3.3 리뷰어 세션의 격리 (②의 실질)

리뷰어에게 주는 입력은 **`acceptance` + `git diff` + CI 결과 셋으로 제한한다.** 구현 세션의 대화
로그나 요약을 넘기면 리뷰어가 구현자의 자기 합리화를 상속받아 세션만 둘이고 판단은 하나가 된다.

출력은 산문이 아니라 `acceptance` 항목별 구조로 강제한다:

```json
{"verdicts":[{"id":"AC-1","verdict":"pass|fail","evidence":"src/foo.ts:42-58","note":"..."}]}
```

근거(`evidence`)를 대지 못하면 통과가 나오지 않는다. 같은 PC·같은 구독이라는 한계는 남지만,
이 형태면 나중에 리뷰어만 CI 로 옮길 때 계약이 바뀌지 않는다.

### 3.4 무인 실행 규약 (실측 확정치)

| 항목 | 값 | 근거 |
|---|---|---|
| 권한 모드 | `--permission-mode dontAsk` | "프롬프트하지 않고 사전 승인 안 된 것은 거부". `bypassPermissions` 가 아니다 |
| 1차 방어선 | **`settings.json` 의 `deny[]`** | `deny` 는 `bypassPermissions` 와 `--dangerously-skip-permissions` 에서도 살아남는다(실측 3회) |
| MCP 차단 | `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` | `--tools` 는 내장 툴만 제한한다. 그것만 주면 계정의 claude.ai 커넥터(Gmail·Drive·Calendar) 툴 40여 개가 그대로 붙는다 |
| 결과 파싱 | `--output-format json` 의 `subtype` | 종료코드는 사실상 0/1 뿐. 원인 구분은 `success`/`error_max_turns`/`error_max_budget_usd`/`error_during_execution` 로만 가능 |
| 시간 상한 | OS `timeout` 래퍼 | 전체 실행시간 제한 플래그가 없다 |
| 예산 상한 | `--max-turns` · `--max-budget-usd` | 숨은 플래그이므로 러너 기동 시 존재를 점검하고 없으면 실패시킨다 |
| 권한 상향 차단 | managed settings `allowManagedPermissionRulesOnly` | 사용자·프로젝트·CLI 규칙을 전부 무시시킨다. macOS `/Library/Application Support/ClaudeCode/managed-settings.json` |

`deny` 목록의 뼈대: 리포 밖 경로 접근 · 파괴적 git(`push --force`·공유 브랜치 `reset --hard`·`branch -D`) ·
배포 명령 · `.env` 읽기 · `develop`/`main` 직접 커밋.

worktree 를 cwd 로 주면 그 안의 `CLAUDE.md` 와 커밋된 `.claude/settings.json` 이 그대로 적용되고
(deny 작동 실측), 트랜스크립트는 cwd 절대경로 슬러그로 분리된다. `settings.local.json` 은 gitignore 라
새 worktree 에 없다 — 러너가 필요한 설정은 **커밋된 파일이나 `--settings` 로 준다.**

### 3.5 실패 규율

| 상황 | 처리 | 이유 |
|---|---|---|
| ⑤ 타임아웃·크래시 | `release` 만. **진척 보고 절대 금지** | `progress` 는 즉시 `actual_pct` 에 반영된다 — 실패했다고 0 을 보내면 쌓인 실적을 0 으로 덮어쓴다 |
| ⑥ 검증 실패(자가수정 후에도) | `release` + 알림 | push 하지 않았으니 서버가 볼 것이 없다 |
| ⑦ CI 실패 | 그대로 `done` 보고 → 서버가 반려 | 러너가 숨기지 않는다. 반려 사유가 서버에 남아야 재작업 근거가 된다 |
| 서버 반려 1회 | 사유를 읽고 같은 worktree 에서 재작업 | |
| 서버 반려 2회 | `release` + 알림함으로 사람 호출, 로컬 스킵 목록 | 같은 실패를 반복하며 구독을 태우는 것을 막는다 |
| 연속 3건 실패 | **러너 정지** + 알림 | 개별 작업 문제가 아니라 환경이 깨진 것이다 |

작업당 최대 시간·1일 최대 건수 상한을 둔다. 무인 시스템에서 제일 비싼 사고는 틀린 결과가 아니라
**틀린 것을 밤새 반복하는 것**이다.

---

## 4. 판정 계층 — 서버 게이트

### 4.1 전제: 서버가 리포를 알아야 한다

지금 `agent_projects` 에는 `project_id`·`enabled`·`note` 뿐이라 러너가 보내는 40자 SHA 를
서버가 열어볼 수단이 없다. v2 설계가 지적한 **"서버가 리포 주소를 모르면 커밋 SHA 감사는
아무도 열어볼 수 없는 40자 문자열이 된다"** 는 상태가 그대로다. 컬럼 넷을 붙인다.

| 컬럼 | 용도 |
|---|---|
| `repo_url` | `evidence.repo_url` 이 이것과 다르면 즉시 반려 — 다른 리포의 초록 CI 를 증적으로 들이미는 경로를 막는다 |
| `integration_branch` | 기본 `develop`. 병합 대상 |
| `auto_gate` | **자동 판정 on/off.** 꺼져 있으면 종전대로 `reported` 로 남아 사람 승인 |
| `required_checks` | 반드시 성공해야 할 체크·스테이터스 이름 배열. **비어 있으면 판정 불가로 본다**(§5.2) |

GitHub 자격증명은 DB 가 아니라 Vercel env 에 둔다. 리포별 토큰을 원장에 넣기 시작하면
원장 유출이 곧 코드 유출이 된다.

### 4.2 판정 순서가 곧 안전 설계다

```
① evidence.repo_url == agent_projects.repo_url ?          아니면 반려
② head_sha 가 그 리포에 실재하고 그 브랜치의 tip 인가?     아니면 반려
③ required_checks 전부가 도착했고 전부 성공인가?           미도착이면 409 ci_pending (반려 아님)
④ 리뷰어 판정이 acceptance 전 항목을 덮고 전부 pass 인가?   아니면 반려
⑤ PUT /pulls/{n}/merge (sha 지정) 성공                     409 면 반려("rebase 후 재보고")
   └─ 다섯 다 통과 ─> approved + actual_pct 100 + stage 'xx' + 후행 해제
```

**⑤가 마지막인 것이 핵심이다.** 병합을 먼저 하고 나머지를 검사하면 실패했을 때 되돌릴 수 없다.
**③의 미도착은 반려가 아니라 `409`** 다 — 아직 결론이 안 난 것을 실패로 처리하면 CI 가 느린 날
전부 반려된다.

### 4.3 판정 시점과 승인 주체

판정은 `POST report kind=completion` 요청 안에서 이어진다. 별도 cron 을 두면 러너가 다음 작업을
못 받고 논다. GitHub 호출 서너 번과 merge 는 Vercel 함수 한도 안에서 넉넉하다.

승인 주체는 러너가 아니다. `approveAgentCompletion` 의 코어를 세션 없는
`applyApproval(admin, {orderId, actorUserId, gateResult})` 로 추출하되(§7-4),
게이트가 넘기는 `actorUserId` 는 **전용 '게이트 봇' 계정**이다. 그래야 `change_logs.user_id` 와
`reviewed_by` 만 보고도 사람 승인과 자동 승인이 구별되고, "자동 승인된 것만 골라 감사"가
쿼리 한 줄이 된다.

### 4.4 반려와 되돌리기

반려는 새 개념을 만들지 않는다 — 기존 `rejectAgentCompletion` 과 같은 결과(주문 `claimed` 복귀 +
`review_action='reject'` + `review_note`)를 게이트가 만들고, 러너는 기존 `GET /work/{id}` 로 사유를 읽는다.
**단 반려 시 `stage` 를 `im`→`ip` 로 되돌린다**(P0-2).

되돌리기 경로를 신설한다. 무인 루프에서 오승인은 반드시 생기는데 지금 `approved` 는 종단이고
`actual_pct` 를 되돌리는 쓰기가 어디에도 없다. `agent_work_orders` 에 claim 시점 값을 담는
`pre_actual_pct` 를 두고, `revertAgentCompletion(orderId)` 관리자 액션이 `actual_pct` 복원 +
`stage` 회귀 + 주문 `claimed` 복귀를 함께 수행한다. `status` CHECK 는 값 목록만 제한하고
전이표는 코드에 있으므로 CHECK 수정은 필요 없다. **코드 되돌리기(revert)까지 자동화하지는 않는다** —
그것은 사람이 판단할 일이다. 되돌릴 수 없는 무인 시스템은 사고가 영구적이다.

### 4.5 감사 화면

`/agent-ops` 카드에 "자동 승인" 배지와 게이트 근거(통과한 체크 이름·SHA·리뷰어의 항목별 판정)를
펼쳐 볼 수 있게 붙인다. 지금 `evidence` 는 **어떤 읽기 경로에도 노출되지 않는다** —
`fetchAgentOps` 와 `GET /work/{id}` 의 reports select 모두 `evidence` 를 뺀다. select 추가가 선행이다.

---

## 5. GitHub 연동 규약 (실측 확정치)

### 5.1 토큰은 GitHub App 이어야 한다

**fine-grained PAT 에는 Checks 권한이 존재하지 않는다.** GitHub 지원 공식 답변이며 2026-08 현재도
미제공이다(문서에는 'Checks(read)' 라 적혀 있어 혼선이 있다). 체크런을 읽으려면 **GitHub App 설치 토큰**
또는 classic PAT(repo) 뿐이다.

GitHub App 최소 권한: `Checks=read` · `Commit statuses=read` · `Contents=write`(병합) ·
`Pull requests=write`(PR 생성·병합) · `Metadata=read`.

Vercel 주의점: JWT 는 RS256, `iat` 는 시계 오차 대비 60초 과거, `exp` 최대 10분. 설치 토큰은
정확히 1시간 유효하다. **함수는 무상태·콜드스타트라 메모리 캐시가 매 인보케이션 날아가므로
만료시각과 함께 Supabase 에 저장한다.** PEM 은 개행 포함 env 이고 Node 런타임이 필요하다.

### 5.2 검증 결과는 한 곳에 없다

체크런과 커밋 스테이터스는 **별도 엔드포인트이고 서로를 포함하지 않는다.**

- `GET /repos/{o}/{r}/commits/{ref}/check-runs` — GitHub Actions 가 남기는 곳
- `GET /repos/{o}/{r}/commits/{ref}/status` — Vercel 이 남기는 곳

실측: `vercel/next.js` PR head 는 체크런 3건 전부 success 인데 combined status 는 `state=pending`,
`total_count=0`. 반대로 `wbs-web` main 은 스테이터스 2건(Vercel)에 체크런 11건(Actions).
**한쪽만 읽으면 영원히 초록이 안 되거나 CI 를 통째로 못 본다.**

combined status 의 `state` 는 스테이터스가 **0건일 때도 `pending`** 이라 "CI 없음"과 "실행 중"이
구분되지 않는다. 따라서 게이트는 `required_checks` 로 **무엇이 와야 하는지를 알고 그 전부의
도착을 확인**해야 한다. 그것이 비어 있으면 판정하지 않고 `409` 를 낸다.

판정 규칙 넷:

1. **미완료 판별** — `check_run.status` 가 `queued|in_progress|waiting|requested|pending` 이면
   미완료이고 이때 `conclusion` 은 null. `completed` 여야 conclusion 이 확정된다.
2. **`skipped` 는 실패로 센다** — GitHub 은 skipped 를 성공으로 취급해 필수 체크여도 병합을 막지 않는다.
   조건부로 통째로 스킵된 테스트가 초록 통과하는 경로다. 무인이므로 막는다.
3. **Vercel 스테이터스 `success` 를 그대로 믿지 않는다** — 실측에서 `"Canceled by Ignored Build Step"`
   인데 `state=success` 였다. `description` 을 함께 본다.
4. **체크런은 이름으로 dedupe 되지 않는다** — 한 SHA 에 같은 이름 체크런 11건이 붙은 실측이 있다
   (cron 워크플로가 계속 추가). `app_id`+이름으로 필터하고 **판정 시각을 스냅샷으로 박는다.**

### 5.3 병합은 PR merge 로 한다

`POST /repos/{o}/{r}/merges` 는 PR 없이 직접 머지 커밋을 만들지만 **sha 낙관적 잠금 인자가 없다.**
`PUT /repos/{o}/{r}/pulls/{n}/merge` 는 `sha` 를 지정하면 현재 head 와 다를 때 **409 로 거부**되어
경합이 막히고 브랜치 보호 규칙이 서버에서 한 번 더 걸린다. 러너가 ⑦에서 PR 을 만들고
게이트가 이 API 로 병합한다.

`develop` 에 ruleset(required_status_checks + strict)을 걸면 GitHub 이 2차 방어선이 된다.
**현재 이 리포에는 브랜치 보호가 없다**(`GET /rules/branches/main` 이 빈 배열 실측) — 즉
잘못된 병합을 GitHub 이 거부해 주지 않으므로 **판정 전부가 앱 코드 책임**이다.

### 5.4 rate limit

App 설치 토큰 5,000/h, 2차 한도 동시 100·REST 900점/분(GET=1점, POST/PUT=5점). 작업 1건당
3~4콜(최대 20점)은 무시할 수준이고 직렬 1건 러너면 여유가 사실상 무한하다. 실제 비용은
폴링이므로 **러너가 `gh run watch` 로 기다린 뒤 보고하는 이 설계는 폴링 비용이 거의 없다**
(게이트의 `409 ci_pending` 재시도만 소량 발생).

---

## 6. 개통 순서와 안전장치

### 6.1 자동 승인을 처음부터 켜지 않는다

| 단계 | 상태 | 확인하는 것 |
|---|---|---|
| 0 | 스테이징 전 루프 리허설 | 배관이 이어지는가 |
| 1 | MES 등록 · `auto_gate=false` · **게이트 드라이런** | 러너는 무인으로 돌고 승인만 사람이 한다. 게이트는 판정을 계산해 화면·로그에만 남긴다 |
| 2 | 드라이런 일치율 확인 후 `auto_gate=true` | 완전 무인 |
| 3 | 준비 프로젝트 추가 | |

1단계의 드라이런이 가장 값싼 보험이다. "게이트가 통과시켰을 것 / 사람이 반려한 것"이 며칠치
쌓이면 자동 승인을 켤지가 취향이 아니라 숫자로 결정되고, 어긋난 건들이 곧 리뷰어 프롬프트와
`acceptance` 작성 규칙의 수정 목록이 된다.

### 6.2 회로 차단기

러너측 상한(§3.5)은 러너가 정상일 때만 작동한다. 그래서 프로젝트당 **하루 자동 승인 건수 상한**을
서버에 두고, 넘으면 `auto_gate` 를 스스로 끄고 알림을 낸다. 무인 시스템에서 "평소보다 열 배 빨리
끝나고 있다"는 것은 좋은 소식인 적이 거의 없다.

### 6.3 운영 D-CUBE 무영향 — 그리고 그 한계

마이그레이션의 `ALTER` 는 `agent_projects`·`agent_work_orders` — 에이전트 전용 테이블에만 닿는다.
예외는 P0-1 의 `wbs_items` UNIQUE(id, project_id) 하나이며, 이는 제약 추가일 뿐 컬럼·데이터를
바꾸지 않는다. 미등록 프로젝트는 전 엔드포인트가 404 로 존재를 숨기는 기존 게이트가 최강 안전망이다.

**한계를 분명히 한다 — 미등록은 데이터를 지키지 커넥션 풀을 지키지 않는다.** 러너 요청은
D-CUBE 와 같은 Micro 인스턴스 풀을 쓴다. 2026-08-05 PostgREST 풀 고갈이 바로 이 사양에서 났고,
백오프 없는 러너는 `dependency_not_met` 으로 튕길 때마다 즉시 재시도한다.
그래서 **rate limit·백오프·`last_seen_at` 스로틀을 P1 이 아니라 P0 로 올린다**(P0-11).

### 6.4 토큰 위생

러너 PAT 은 `work:read`/`work:claim`/`work:report` 만, `kind='runner'`, `project_id` NOT NULL,
만료 상한 30일. GitHub App 은 대상 리포에만 설치. **러너 PAT 이 새도 GitHub 은 안 열리고
반대도 마찬가지**가 되게 분리한다.

관측은 알림함(0074)에 얹는다 — 새 화면을 만들지 않고, 사람이 아침에 한 번 보는 곳으로
루프 사건(자동 승인·반려 2회·러너 정지·차단기 발동·PAT 만료 D-7)을 보낸다.

---

## 7. P0 — `auto_gate` 를 켜기 전에 반드시 메울 것

적대 검토 4개 렌즈(자기채점 생존 · 공정률 오염 · 루프 정지·폭주 · 보안·권한)가 **독립적으로 같은
급소를 지목**했다. 아래는 새 기능 목록이 아니라 **지금 사람 승인이 마개 역할을 하고 있던 구멍**이다.
무인으로 가면 마개가 빠진다.

### P0-1 · 후행 해제가 자가 보고에서 일어난다

`report/route.ts:160` 이 completion 보고 직후 `transitionStage(to:'im')` 을 부르고,
`claim/route.ts:62` 의 선행 게이트는 `stageAtLeast(stage,'im')` 이다. **러너가 "완료"라고 말하는
순간 후행이 claim 가능**해지며 승인·체크런과 무관하다. 게다가 `loadDependsInfo` 는
`approved` 주문에서만 evidence 를 읽으므로 이 시점 `depends_evidence` 의 `branch`·`head_sha` 는
null 이다 — 게이트는 초록인데 분기할 베이스가 없다.

> **처방** — `auto_gate` 프로젝트의 선행 게이트를 `xx`(승인·병합 완료) 기준으로 올린다.
> `stageAtLeast` 의 min 을 `'im'|'xx'` 로 열고 depends 게이트만 `xx` 를 쓴다. 승인이 몇 초면
> 나므로 `im` 으로 앞당길 이유가 없고, 이래야 "완료 = 병합"이 실제로 성립한다.
> 아울러 `depends_evidence` 에 `branch`·`head_sha` 가 없는 선행이 있으면 claim 을 막는다.
> 또한 `wbs_items` 에 UNIQUE(id, project_id) 를 두고 `agent_work_orders` 에 (wbs_item_id, project_id)
> 복합 FK 를 건다 — 게이트가 보는 project 키와 실제 쓰기가 쓰는 키의 일치가 지금은 삽입 코드의
> 관례일 뿐이다.

### P0-2 · 반려해도 `stage='im'` 이 남는다

`rejectAgentCompletion` 은 주문만 `claimed` 로 되돌리고 `transitionStage` 를 부르지 않는다.
재claim 의 `fromIn` 은 `['as','fp',null]` 이라 `im` 이 내려올 길이 없다. **CI 실패로 반려된 선행이
후행의 claim 게이트를 영구히 통과시킨다.** `work.unblocked` 는 dedupeKey 로 이미 1회 발행돼
정정 알림도 나가지 않는다.

> **처방** — 반려(사람·게이트 공통)에 `transitionStage(to:'ip', fromIn:['im'])` 을 추가한다.
> `im`→`ip` 역전이 시 그 항목을 depends 로 가진 후행에게 "착수 불가로 되돌아감"을 발행하고
> 해당 dedupeKey 를 무효화해 재도달 시 다시 발행되게 한다.

### P0-3 · 완료 보고에 증적이 필요 없다

`validateEvidence` 는 `raw===undefined` 면 `{ok:true, evidence:{}}` 를 돌려주고 `validateReport` 는
`percent===100` 과 `summary` 비어있지 않음만 본다. `{"kind":"completion","percent":100,"summary":"완료"}`
한 줄이 통과해 `reported`+`im` 이 된다. `checks[].status` 에 값 enum 이 없어 `"zzz"` 도 통과하고,
코드 주석이 명시하듯 "실재·일치는 서버가 확인하지 않는다".

> **처방** — `kind='completion'` 에서 `evidence.repo_url`·`head_sha`·`pr_url`·`checks` 를 **필수**로 한다.
> 저장하는 `checks` 는 요청 본문이 아니라 **서버가 GitHub 에서 조회한 결과로 덮어쓴다.**
> `checks[].status` 에 enum 을 건다.

### P0-4 · 승인 API 가 없다 — 루프가 `reported` 에서 멈춘다

`api/v1/agent/**` 에 승인 라우트가 없다. `approveAgentCompletion` 은 `'use server'`+`requireProjectAdmin`
이고 내부의 `updateActual` 은 `createServerClient()`(쿠키)+`requireProjectMember` 라
**머신 신원으로는 실행 자체가 불가능**하다. 게이트가 초록을 봐도 사람이 버튼을 누를 때까지 멈춘다.

> **처방** — 세 조각을 신설한다.
> ① `src/lib/agent/approve.ts` 의 `applyApproval(admin, {orderId, actorUserId, gateResult})` —
>    `agentWork.ts` 는 `'use server'` 파일이라 순수 코어를 둘 수 없다(`routeShared.ts` 가 같은 이유의 선례).
> ② `applyAgentCompletion(admin, {itemId, actorUserId})` — 세션 없이 100% 를 쓰는 경로.
>    리프 검사·`change_logs`·스냅샷·revalidate 를 포함하고 **`recordProgressSnapshot` 에 `admin` 을
>    반드시 넘긴다**(안 넘기면 anon 으로 붙어 RLS 42501 이 로그도 없이 삼켜진다).
>    `stage` 전이만 단독 호출하는 것을 금지한다 — 그러면 stage 는 완료인데 `actual_pct` 는
>    마지막 progress 값에 머물러 주간보고가 완료 작업을 70% 로 싣는다.
> ③ `POST /api/v1/agent/work/{id}/review` — 새 스코프 `work:approve` + `isAgentProjectAdmin`
>    (세션 없는 관리자 판정은 이미 있다). UI 액션과 게이트가 같은 코어를 부른다.

### P0-5 · legacy 시크릿 한 줄이면 임의 사용자 사칭

`resolveAgentPrincipal` 은 `AGENT_API_SECRET` 이 맞으면 `{kind:'legacy'}` 를 주는데
`requireScope` 가 null(전 스코프), `patProjectAllowed` 가 true(전 프로젝트), 멤버십 검사는 pat 에만
걸린다. 쓰기는 본문 `user_email` 을 그대로 신원으로 해석한다. **러너 PC env 를 읽은 프로세스가
`user_email=슈퍼유저` 로 보고하면 `change_logs.user_id` 까지 그 사람 이름으로 남는다.**
덤으로 legacy 점유 소유권은 API 가 그대로 돌려주는 자유 문자열(`claimed_by`)이라 주문 탈취가 되고,
legacy 가 claim 한 주문은 `claimed_by_user_id=null` 이라 PAT 러너가 영구히 `not_claim_owner` 를 받는다.

> **처방** — claim/release/report 에서 legacy 를 거부한다.
> `/wbs/import` 가 이미 쓰는 `if (principal.kind==='legacy') return apiFail(400,'identity_required',…)`
> 패턴 그대로다. 남기려면 `AGENT_API_LEGACY=true`(기본 off) 뒤에 두고 시크릿에 **고정 매핑된
> 서비스 계정 하나**로 못 박아 본문 `user_email` 을 신원으로 쓰지 않는다.

### P0-6 · `work:report` PAT 을 발급할 경로가 없다

`SELF_ISSUE_SCOPES` 는 `work:read`·`work:claim` 뿐이고 관리자 대리 발급은 미구현,
`kind='runner'` 를 만드는 코드도 0건(유일한 insert 가 `'user_pat'` 하드코딩). 무인 루프는 완료 보고가
필수인데 **남는 선택지가 SQL 직삽입 아니면 P0-5 의 마스터 시크릿** — 둘 다 나쁘다.
게다가 자율 발급은 `projectId=null`(전 프로젝트)이 기본값이고 발급자 멤버십을 확인하지 않으며
`isAgentProjectMember` 가 `is_superuser` 로 단락돼 **슈퍼유저 PAT 은 사실상 무제한**이다.

> **처방** — `requireProjectAdmin(projectId)` 로 가드한 발급 액션을 신설한다:
> `kind='runner'` · `project_id` NOT NULL · `work:report` 허용 · 만료 상한 30일 · `created_by` 기록.
> `agent_runners` 에 `CHECK(kind='runner' → project_id is not null)` 를 걸어 SQL 직삽입도 같은 규칙을 받게 한다.
> `createAgentToken` 에서 `projectId=null` 을 거부하고 발급자 멤버십을 확인한다.
> PAT principal 에 대해서는 `is_superuser` 단락을 끄고 `project_roles` 만 보게 해
> **무인 토큰이 전역 등급을 상속하지 않게** 한다.

### P0-7 · 재업로드가 완료 항목에 주문을 재발행한다

`ensureOrder` 와 `ensureOrdersForPayload` 의 활성 판정이 `ready/claimed/reported` 뿐이라
`approved` 가 갭으로 잡힌다(0077 부분 유니크도 approved 를 제외). 명세 배치가 같은 모듈을
재업로드하면 **승인 완료 task 전부에 ready 주문이 새로 생기고**, `stage='xx'` 에서는 claim·report 의
전이가 모두 no-op 이라 WBS 상 신호가 0 이다. 러너가 재작업 후 `progress 30` 을 보내면
`applyAgentProgress` 에 단조 가드가 없어 **100% 가 30% 로 내려간다.**

> **처방** — 활성 상태 집합에 `'approved'` 를 추가하고, `stage='xx'` 또는 approved 주문이 있으면
> `reason:'completed'` 로 no-op 한다. 재개는 명시적 관리자 액션으로만.
> `applyAgentProgress` 에 **단조 가드**(percent < 현재 `actual_pct` 면 409)를 넣는다.
> `dev_workflow===true` 게이트도 함께 넣는다 — 지금은 `transitionStage` 만 그 게이트가 있어
> task→wp 로 뒤집힌 항목에서 **stage 는 얼어붙는데 실적만 오른다.**

### P0-8 · 승인이 100% 를 CAS 앞에 쓴다

`approveAgentCompletion` 은 `updateActual(itemId,100)` 을 먼저 하고 `reported→approved` CAS 를 건다.
경합에서 지면 **"WBS 는 100% 인데 주문은 claimed"** 가 남는다. 지금은 반환 문자열로 사람에게
알리는데 **무인 호출부에는 읽을 사람이 없다.**

> **처방** — CAS 를 먼저 실행하고 이긴 경우에만 100% 를 반영한다. 반영 실패 시 `approved` 를
> 유지한 채 멱등 재시도로 수렴시키고, 실패를 로그와 알림으로 드러낸다.

### P0-9 · `weight` 가 임포트에 없어 모듈이 공정률에서 빠진다

0077·0082 의 insert 컬럼에 `weight` 가 없어 업로드 항목은 전부 null 이다. `overallProgress` 는
루트 중 하나라도 weight 가 있으면 `eff = r.weight ?? 0` 을 쓰므로 **에이전트 모듈 루트가 분자·분모에서
통째로 빠진다.** 반면 `computeNode` 의 `siblingWeight` 는 null→1 이라 트리 화면·엑셀은 같은 모듈을
100% 로 보여준다 — **주간보고 표지 숫자와 본문 표가 어긋난다.**

> **처방** — `import_wbs_upsert` 의 insert 에 `weight` 를 추가(신규만 시드, `on conflict` 보존)하고,
> `overallProgress` 의 루트 `eff` 를 `siblingWeight` 와 동일한 null→1 규칙으로 통일한다.

### P0-10 · `evidence.branch` 가 검증 0 인 자유 문자열

`base_sha`·`head_sha` 에는 40자 hex 정규식이 걸려 있지만 `branch` 는 `typeof` 검사뿐이다.
이 값이 `depends.ts` 를 거쳐 다음 작업 러너의 `depends_evidence[].branch` 로 실려 간다.
`--upload-pack=…` 같은 문자열을 넣으면 **GitHub 토큰을 쥔 러너 PC 에서 git 인자 주입**이 성립한다.

> **처방** — `branch` 정규식(`^[A-Za-z0-9._/-]{1,255}$`, 선두 `-` 금지)을 추가하고
> `repo_url`·`pr_url` 은 호스트 allowlist 로 좁힌다. 러너의 git 호출에는 `--` 구분자를 강제한다.
> `depends_evidence` 는 장기적으로 보고 본문이 아니라 **서버가 GitHub 에서 조회한 사실**
> (병합 커밋 SHA·병합 시각)로 채운다. 과도기에는 각 필드에 `source`(`agent_reported`/`server_verified`)를
> 붙이고 러너가 `agent_reported` 만으로는 착수하지 않게 한다.

### P0-11 · rate limit·백오프가 없다 (§6.3 에서 승격)

인증 성공마다 `agent_runners.last_seen_at` 을 UPDATE 하고, `429`·`Retry-After`·백오프가 어디에도 없어
`dependency_not_met`·`conflict` 로 튕긴 러너가 즉시 재시도한다. **D-CUBE 와 같은 Micro 풀을 쓴다.**

> **처방** — 토큰별 속도 제한 + `429 Retry-After`. `last_seen_at` 은 60초 스로틀.
> `loadDependsInfo` 를 2쿼리(orders in-list → reports in-list)로 배치화하고 `mine` 의 프로젝트별
> 순회도 배치 조회로 바꾼다. 러너는 지수 백오프를 지킨다.

### P0-12 · 자기 자신 승인을 막는 코드가 없다

`approveAgentCompletion` 은 최신 completion 보고의 `actor_user_id` 나 `order.claimed_by_user_id` 를
승인자와 비교하지 않는다. 러너 PAT 소유자와 `/agent-ops` 로그인 계정이 같은 사람이면
드라이런 단계(§6.1 의 1단계)에서 **"보고 → 새로고침 → 승인"이 한 손으로 닫힌다.**

> **처방** — 승인 시 보고자와 승인자가 같으면 거부한다. 게이트 봇 승인은 예외
> (게이트 봇은 보고자가 될 수 없으므로 자연히 통과한다).

---

## 8. P1 — 무인 개통 직후

| 구멍 | 처방 |
|---|---|
| **좀비 claim 자동 회수가 없다** — `isClaimStale(24h)` 은 뱃지에만 쓰이고 cron 리퍼가 없다. 부분 유니크 때문에 굳은 주문이 있는 한 재발행도 막힌다 | stale 리퍼 cron + 러너 하트비트로 창을 24h 보다 짧게 |
| **반려 무한 반복** — 횟수 상한이 없고 `work.reported` 에 dedupeKey 가 없어 관리자 인박스가 쌓인다 | 반려 3회면 종료(`cancelled` 또는 신규 `blocked`) + 응답에 누적 횟수를 실어 러너가 스스로 멈추게 + dedupeKey 추가 |
| **`depends` 오타·순환·`dev_workflow=false` 선행 → 영구 굶주림** — 없는 ref 는 fail-closed 로 영영 미충족인데 `skipped` 는 숫자 하나뿐이라 추적이 불가능하다 | import 시 참조 존재·순환·선행 `dev_workflow` 검증 + 응답에 skip 상세 + `blocked` 사유 기록 |
| **정지 원인이 404/401 로 뭉개진다** — 킬스위치 off·미등록·비멤버가 전부 404, PAT 의 disabled/revoked/expired 가 전부 401 | `/me` 가 해시 일치 PAT 에 한해 킬스위치 상태를 알려 "작업 없음"과 "루프 꺼짐"을 구분 |
| **PAT 만료 예고가 없다** — `expires_at` 은 NOT NULL 인데 만료 순간 러너가 조용히 멈춘다 | 만료 D-7 경고 cron(`system.pat_expiring` 은 카탈로그에만 있고 배선이 없다) |
| **`registerAgentProject` 에 거부목록이 없다** — 드롭다운에 전 프로젝트가 실려 클릭 한 번이면 이미 발급된 모든 토큰에 D-CUBE 쓰기가 소급 적용된다 | env 거부목록 + DB 트리거 이중화 |
| **`evidence` 가 읽기 경로에 없다** | `fetchAgentOps`·`GET /work/{id}` select 추가 + `/agent-ops` 렌더 |
| **progress 가 CAS 없이 기록된다** — reclaim 중 도착한 in-flight 보고가 회수된 작업에 기록되고 그날 스냅샷에 박제된다 | 주문 touch(소유자 조건 포함)를 `applyAgentProgress` **앞**으로 옮기고 0행이면 409 |
| **정체 감시가 없다** | `ready` 주문이 N시간 방치되면 관리자에게 통지(만료 cron 에 합침) |

미배선 알림 8종 중 무인 루프에 필요한 것은 `work.progress`(장시간 진행의 가시성)·`work.revoked`·
`system.runner_stale`·`system.pat_expiring` 넷이다.

---

## 9. 신설·수정 목록

### 9.1 마이그레이션 (0087~)

| 번호 | 내용 | 대상 |
|---|---|---|
| 0087 | `agent_projects` + `repo_url`·`integration_branch`·`auto_gate`·`required_checks`·`daily_approve_cap` | 에이전트 전용 |
| 0088 | `wbs_items` UNIQUE(id, project_id) → `agent_work_orders` (wbs_item_id, project_id) 복합 FK · `pre_actual_pct` | 제약 추가만 |
| 0089 | `agent_runners` CHECK(kind='runner' → project_id not null) · `work:approve` 스코프 허용 | 에이전트 전용 |
| 0090 | `import_wbs_upsert` 교체 — `weight` 시드 · `do update` 목록에서 미지정 필드 제거 | RPC |

각각 `_rollback.sql` 동반. **0072+ 는 G4 훅이 스테이징 리허설 트레일러(`Staging-verified:`)를 강제**하므로
`docs/runbook-staging.md` 절차를 따른다. 마이그레이션과 코드는 별도 커밋(G1).

### 9.2 서버 — 신설

- `src/lib/agent/approve.ts` — `applyApproval` · `applyRejection` · `applyAgentCompletion`(세션 없는 100% 반영)
- `src/lib/agent/gate.ts` — 순수 판정(입력: order·evidence·프로젝트 매핑·GitHub 조회 결과 → 판정 객체)
- `src/lib/agent/github.ts` — App JWT·설치 토큰 캐시·체크런/스테이터스 조회·PR merge
- `src/app/api/v1/agent/work/[id]/review/route.ts` — `work:approve` + `isAgentProjectAdmin`
- 관리자 PAT 발급 서버 액션 (`kind='runner'`, `work:report`, 30일)
- `revertAgentCompletion(orderId)` 관리자 액션

### 9.3 서버 — 수정

claim 선행 게이트(`xx`) · 반려 시 stage 되돌림 · completion evidence 필수화 + 서버 조회 결과로 덮어쓰기 ·
`applyAgentProgress` 단조·`dev_workflow` 가드 · 승인 CAS 순서 역전 · 활성 집합에 `approved` 추가 ·
legacy 경로 차단 · `createAgentToken` 발급 가드 · `validateEvidence` 의 `branch`·호스트 검증 ·
rate limit·`last_seen_at` 스로틀 · `overallProgress` 의 루트 weight 규칙 통일 ·
`fetchAgentOps`/`GET work/{id}` 에 `evidence` 추가

### 9.4 클라이언트

- `docs/agent/runner/` — 러너 데몬(§3.2 사이클, §3.5 실패 규율)
- `scripts/spec-draft.mjs` — 명세 배치(모듈 단위 분할, `stage='xx'` 스킵)
- 리뷰어 프롬프트 템플릿 + 판정 JSON 스키마
- `.claude/settings.json` deny 세트 + managed settings 배치 안내
- `dflow-work` 스킬 갱신 — `scope=assigned`, `xx` 게이트, 새 에러코드

### 9.5 CI (MES 리포)

브랜치 push 시 빌드·테스트·린트 워크플로. **체크 이름을 `required_checks` 와 문자 단위로 맞춘다** —
게이트가 이름으로 도착을 확인하므로 오타 하나가 영구 `409 ci_pending` 이 된다.
`develop` 에 ruleset(required_status_checks + strict)을 걸어 2차 방어선을 만든다.

### 9.6 도입하지 않는 것

**Vercel Workflow DevKit 은 쓰지 않는다.** 서버측 판정은 단일 요청 안에서 끝나는 동기 작업이고,
장시간 오케스트레이션은 러너 PC 에서 일어난다. 대량 임포트의 재개성은 이미 "같은 payload 재POST →
갭 채우기"로 확보돼 있어 durable 실행 계층을 새로 들일 이유가 없다.

---

## 10. 테스트 전략

1. **도메인 단위** — 게이트 판정 순수 함수 전수(리포 불일치·SHA 미실재·체크 미도착·skipped·
   Vercel `description` 함정·리뷰어 항목 누락·merge 409). `stageAtLeast` 의 `im`/`xx` 분기.
   단조 가드 경계(현재 100 에 30 → 409).
2. **라우트** — legacy 거부 · `work:approve` 없는 PAT 403 · 미등록 프로젝트 404 ·
   completion evidence 누락 400 · `409 ci_pending` 재시도 · 승인 CAS 경합.
3. **D-CUBE 무영향 증명** — ① 마이그레이션이 운영 테이블에 데이터 변경을 넣지 않음을 리뷰 확정
   ② D-CUBE 미등록 상태에서 전 엔드포인트 404 테스트 ③ 기존 vitest 전량 초록.
4. **GitHub 계약** — App 인증·조회·merge 는 fixture 로 고정. **실측 함정 4종**(두 계열 분리 ·
   `total_count=0` 인데 pending · 동명 체크런 다수 · skipped)을 각각 회귀 테스트로 박는다.
5. **런타임 E2E** — 스테이징 프로젝트에서 명세 배치 → 검수 → 자동 발행 → claim → 구현 →
   CI → 리뷰어 → 게이트 → 병합 → 후행 해제까지 **2단 체인 1회 완주**.
6. **드라이런 실측**(§6.1 1단계) — 게이트 판정과 사람 판정의 일치율. 이것이 `auto_gate` 를
   켤지의 근거다.

---

## 11. 비범위 (YAGNI 확정)

다중 러너·병렬 실행 · Docker 격리 · 리뷰어의 CI 이전(계약은 열어 두되 이번엔 러너 PC) ·
`main` 자동 승격 · 코드 자동 revert · 웹훅 수신(러너 `gh run watch` 로 대체) ·
계획일 자동 트리거 · 에이전트의 WBS 구조 변경 · 서버측 LLM 호출.

---

## 12. 미결

1. **게이트 봇 계정의 실체** — `auth.users` 에 전용 계정을 만들지, 러너 PAT 의 `owner_user_id` 를
   쓸지. 코어 시그니처가 여기서 확정된다. 권고는 전용 계정(감사 구분이 쿼리 한 줄이 된다).
2. **`daily_approve_cap` 의 초기값** — 드라이런 실측 전에는 근거가 없다. 1단계 데이터로 정한다.
3. **`required_checks` 를 하드코딩할지, GitHub ruleset 에서 읽을지** —
   `GET /repos/{o}/{r}/rules/branches/{branch}` 로 읽으면 이중 관리가 사라지지만
   이 엔드포인트의 권한 요구사항이 문서에 없어 실측이 필요하다.
4. **`--permission-prompt-tool`** — 훅 방식보다 이쪽이 맞을 수 있으나 스키마·헤드리스 동작이
   미실측이다. 채택 전 검증.
5. **SIGTERM 시 `claude -p` 가 결과 JSON 을 flush 하는지** — OS `timeout` 래퍼의 부분 출력 처리
   규약이 여기 달려 있다.
6. **`service_role` 의 `statement_timeout`** — 847건급 임포트가 Postgres 쪽에서 잘리는지 미검증.
7. **준비 프로젝트 투입 시점** — MES 에서 2단계(완전 무인)가 안정된 뒤로 미룬다.
