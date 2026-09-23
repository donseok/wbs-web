# 병렬 Task 머지 충돌 (과제 E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 병렬 Task 가 개발 브랜치와 충돌해 의존 사슬이 멈추는 일을 네 갈래로 막는다. ① 계약 Task 규칙으로 충돌을 예방하고, ② 해소 전용 워커가 충돌을 풀고, ③ 반영되지 않은 선행의 후속을 팀장이 미리 거르고, ④ 좌석표에 「머지 충돌」 을 보인다.

**Architecture:** 서버는 heartbeat 라우트가 `reported`·`approved` 주문에 한해 PAT 팀장의 `merge_conflict` 표시(설정·해제)를 받는다. 이 표시는 `heartbeat_phase`·`heartbeat_note` 두 열에만 쓰며, 마이그레이션은 없다. 좌석표 도메인은 이 phase 를 말풍선·확인 필요 띠·후속 대기 사유로 드러낸다. 스킬 쪽에서는 `/dflow-merge` 에 숨은 플래그 `--resolve` 를 더하고, 새 워커 프롬프트 `resolve-prompt.md` 와 판정 스크립트 둘(`pred-reflected.sh`·`resolve-decide.sh`)을 둔다. 팀장 절차는 새 reference `merge-conflict.md` 에 모으고, `dflow-team/SKILL.md` 에는 짧은 포인터 절과 필요한 몇 줄만 고친다.

**Tech Stack:** Next.js 15 route handler · supabase-js admin client · React(client component) · POSIX sh + jq + git · vitest · Tailwind

**Spec:** `docs/superpowers/specs/2026-09-23-parallel-merge-conflict-design.md`

## 미결 처리 (스펙 §11 — 보수적 기본안으로 정한다)

1. 승인된 주문의 해소 재검토(E9): 서버 표식을 두지 않는다. 머지 커밋 본문, `resolution.md`, 스윕 보고로 드러내기만 한다.
2. 해소 상한은 3 이고 `push-race` 도 카운터에 센다. 카운터에서 빼는 일은 운영 뒤에 정한다.
3. 해소 워커 모델은 팀장 인자 모델을 그대로 쓴다. `opus` 로 고정하지 않는다.
4. `resolution.md` 는 Task 폴더 안에 두고 머지 커밋에 함께 싣는다.
5. 해소 범위를 기계로 검사하지 않는다. `resolution.md` 기록에 맡긴다.
6. H(워커 자동 재시작, `feat/worker-auto-restart`, 새 이벤트 `team.lost`, 재개 카운터 상한 3 공유)와의 조율: 해소 워커(`spawn_kind: resolve`)는 **H 의 자동 재시작 대상이 아니다.** 해소 워커의 죽음은 `team.lost` 가 아니라 `failed no-result` 로 판정한다. 이 판정은 해소 카운터(`spawn_kind == "resolve"` 개수)만 한 번 올리고, 다음 스윕에서 충돌이 다시 나면 해소 경로로만 다시 띄운다. H 문서에도 같은 문장이 들어가야 하므로 H 작성자에게 알린다(Task 10).
7. `blocked` 해소 워커는 슬롯을 쥔 채 답을 기다린다. 피해는 동시 해소 상한 `max(1, ⌊인원/2⌋)` 으로 묶는다.

계획에서 정한 구현 선택 셋(스펙이 문장으로만 적은 것을 이렇게 구현한다):
- 해소 재시도 판정(해소 카운터·직전 결과·같은 기준 재충돌)은 `dflow-team/scripts/resolve-decide.sh` 로 뽑는다. 이 스크립트는 fixture events 로 시험한다. 스펙 §9 는 SKILL.md 의 jq 를 꺼내 돌린다고 적었지만, 그 jq 는 스크립트 안에 있다.
- 사람이 손으로 머지한 충돌의 표시를 해제하려면 "충돌 목록" 이 압축 뒤에도 남아 있어야 한다(§7.1 마지막 행). 그래서 이벤트 `team.conflict`(`id8`·`decision`·`files`)를 하나 더한다. 메모리는 캐시라는 팀장 규칙 때문이다.
- `/dflow-merge --resolve` 는 충돌이 없어도 늘 `--no-commit` 으로 머지한다. 그래야 `resolution.md` 와 트레일러 둘(`DFlow-Order`·`DFlow-Resolve`)이 한 `git commit` 에 실린다.

## Global Constraints

- 작업 위치는 워크트리 `/Users/jji/project/wbs-web-mergefix`(브랜치 `feat/merge-conflict-resolve`, 기점 `origin/staging`)다. 메인 체크아웃 `/Users/jji/project/wbs-web` 은 병렬 세션이 쓰므로 건드리지 않는다.
- 반영은 **이 브랜치 → `origin/staging` 머지·push 까지**다. main push·dflow-kit 재빌드는 하지 않는다.
- **마이그레이션은 없다.** `heartbeat_phase` 는 CHECK 가 없는 text 다(`supabase/migrations/0094_agent_heartbeat.sql`). 0094 의 comment 도 고치지 않는다. 정본 값 목록은 `src/lib/domain/seatState.ts` 다.
- `git add -A` 는 쓰지 않는다. 늘 파일명을 적어 stage 한다.
- 커밋 메시지는 한국어로 쓰고 끝에 아래 두 줄을 붙인다.
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
  ```
- 권한 판정은 `src/lib/domain/authz.ts`(순수)와 `src/lib/authz/index.ts`(가드) 두 곳에서만 한다. 이 계획은 새 권한 판정을 만들지 않는다. heartbeat 라우트의 소유 판정은 지금 쓰는 PAT 규칙 `claimed_by_user_id === actor.userId` 를 그대로 쓴다.
- 에러 3원칙을 지킨다. 조회 실패를 "없음" 으로 위장하지 않는다(표시하면 로깅한다). 쓰기 전 선행 조회가 실패하면 중단한다. 보안 가드는 fail-closed 로 둔다. 스크립트가 판정할 수 없으면 `UNKNOWN` 을 내고, 호출자는 그것을 "반영 안 됨" 이나 "재시도 가능" 으로 읽지 않는다.
- 계약 버전은 **2.5 → 2.7** 로 올린다(additive). 병행 과제 C 가 2.6 을 쓰기 때문이다. 고칠 곳은 넷이다: `src/lib/agent/externalApi.ts` 의 `AGENT_CONTRACT_VERSION`, `dflow.sh` 의 `CONTRACT_VERSION`, `references/api-contract.md`, `tests/agent/me-route.test.ts`. 네 곳 모두 "머지 순서에 따라 조정한다" 는 주석을 남긴다. C 보다 먼저 들어가면 C 가 2.8 로 가거나, 이 변경을 2.6 으로 내린다.
- **병행 수정 중인 파일**(`dflow-team/SKILL.md`·`dflow.sh`·`dflow-dev/SKILL.md`)은 기존 줄을 크게 옮기지 않는다. 새 절이나 새 파일로 모으고, 기존 줄은 필요한 낱말만 바꾼다. 모든 편집은 **줄 번호가 아니라 인용한 원문(old_string)과 「절 이름」** 으로 찾는다. 원문이 정확히 한 번 나오지 않으면 멈추고 보고한다(Task 0 이 미리 확인한다).
- **이 워크트리와 로컬 staging 은 다르다.** 스펙이 기대는 `dflow.sh taskdir`·`TASK_DIR`·worker-prompt 「7-1」 `.issues` 는 로컬 staging(`6941d6f6..c1b64ac5`)에만 있고 `origin/staging` 에는 아직 없다. 규칙을 하나로 정한다.
  - 새 스크립트는 tasks 디렉터리를 **인자로 받는다**(`pred-reflected.sh <TASKS> …`).
  - 팀장은 `TASK_DIR` 을 한 번만 정한다. `dflow.sh` 사용법에 `taskdir <ref>` 줄이 있으면 `dflow.sh taskdir <order>` 의 값을 쓰고, 없으면 `docs/tasks/<TSK>` 를 쓴다. `taskdir` 가 있는데 실패하면 "작업 폴더 해석 실패" 로 일시 제외한다. `docs/tasks` 로 되돌아가지 않는다.
  - 해소 워커의 `.issues` 기록은 `worker-prompt.md` 에 「7-1」 절이 있을 때만 한다.
  - `.result` 는 `{TASK_DIR}/.result` 다. 팀장 재구성의 `find "$w/docs/tasks" …` 가 찾는 자리이며, taskdir 판에서는 그 판의 재구성 규칙을 따른다.
- 셸은 POSIX sh 로 쓴다(`#!/bin/sh`). SKILL.md·reference 의 ```bash 블록은 sh·bash·zsh 에서 모두 문법 검사를 통과해야 한다(`tests/skills/dflow-team-shell-blocks.test.ts`). 따옴표 없는 `$VAR` 로 인자를 늘리거나 줄이지 않는다.
- 토큰·PAT 값을 출력·로그·파일에 남기지 않는다. 테스트 토큰은 가짜 문자열만 쓴다.
- `src/components/agents/*` 는 전 화면 공용은 아니지만 스펙 §7.4 가 UI 위험으로 다룬다(pre-push G2 가 막는 것은 `src/components/app/*` 등이라 훅은 막지 않는다). 그래서 브랜치에서 작업하고, staging(dflow-staging.vercel.app)에서 ego-browser 로 눈으로 확인한다(Task 10).
- 이 계획의 "원문 `…` → `…`" 인용에서 `\`` 는 실제 백틱 한 글자다(인라인 코드 안에 백틱을 적기 위한 표기).
- 테스트는 `npx vitest run <path>`, 린트는 `npm run lint` 로 돌린다.

## Review Focus

- **해제가 다른 phase 를 지우는가**: `clear: "merge_conflict"` 는 현재 값이 `merge_conflict` 일 때만 null 로 바꿔야 한다. `blocked` 나 워커 phase 를 지우면 사람이 손 든 좌석이 조용히 사라진다. → Task 1 테스트 「clear → 현재 값이 merge_conflict 일 때만」 이 `.eq('heartbeat_phase','merge_conflict')` 를 확인하고, 「clear 인데 바뀐 행이 없으면 cleared:false」 도 둔다.
- **팀장 표시가 `updated_at`·`heartbeat_agent` 를 건드리는가**: 건드리면 승인분 좌석이 7일 창(`DONE_WINDOW_MS`) 밖에서도 계속 보이고, 좌석 이름이 팀장 라벨로 바뀐다. → Task 1 테스트는 update 본문이 `{heartbeat_phase, heartbeat_note}` **정확히 두 키**인지 `toEqual` 로 확인한다.
- **같은 기준에서 다시 충돌해도 무한 루프가 없는가**: `resolved` 뒤 개발 브랜치가 그대로인데 다음 스윕에서 또 충돌하면 재시도하지 않아야 한다. → Task 7 `resolve-decide.sh` 테스트 「resolved 의 base 가 지금 개발 브랜치와 같으면 HUMAN」. 상한 3 과 `team.result` 로 카운터가 초기화되지 않는 것도 같은 파일에서 확인한다.
- **`TSK-03-1` 이 `TSK-03-10` 머지 제목에 걸리는가**: 걸리면 반영되지 않은 선행을 반영됐다고 보고 후속을 띄운다. → Task 5 `pred-reflected.sh` 테스트 「TSK-03-1 은 TSK-03-10 머지 제목에 걸리지 않는다」.
- **WAIT·DONE 인 머지 충돌 좌석의 띠 순서**: `ATTENTION_ORDER.indexOf` 는 WAIT·DONE 에 -1 을 돌려준다. 그대로 두면 이 좌석이 BLOCKED 보다 위로 올라간다. → Task 2 테스트 「확인 필요 띠: 머지 충돌은 BLOCKED 바로 뒤, DONE 좌석도 든다」.
- (보조) **해소 워크트리에서 heartbeat 훅이 남의 주문에 신호를 보내는가**: 해소 워크트리는 개발 브랜치 위에 있고 `.dflow-agent` 를 가진다. 훅은 진행 중 phase(`design|build|verify|refactor|rejected`)인 state.json 을 대상으로 삼는다. 개발 브랜치의 state.json 이 모두 `merged`·`reported` 면 훅은 아무것도 보내지 않는다. → Task 7 테스트가 이 경우를 고정한다. 해소 프롬프트는 그런 state.json 이 있으면 `.dflow-agent` 를 쓰기 전에 `failed dirty-dev-state` 로 멈춘다.

---

## 파일 구조

| 파일 | 책임 | Task |
|---|---|---|
| `src/lib/domain/seatState.ts` | `Phase` 에 `merge_conflict`, `LEAD_PHASES`, `inferPhase` | 1 |
| `src/app/api/v1/agent/work/[id]/heartbeat/route.ts` | reported·approved 의 `merge_conflict` 설정·해제 | 1 |
| `src/lib/agent/externalApi.ts` · `tests/agent/me-route.test.ts` | 계약 2.7 | 1 |
| `tests/agent/heartbeat-route.test.ts` · `tests/domain/seat-state.test.ts` | 라우트·도메인 시험 | 1 |
| `src/lib/domain/seatmap.ts` | 좌석 note, 확인 필요 띠 | 2 |
| `src/lib/domain/waitReason.ts` · `src/components/agent-hub/labels.ts` | 대기 사유 `merge_conflict` | 2 |
| `src/lib/data/agentSeatmap.ts` | 선행 주문의 `heartbeat_phase` 조회 | 2 |
| `tests/domain/seatmap.test.ts` · `tests/domain/wait-reason.test.ts` · `tests/data/agent-seatmap.test.ts` | 도메인·데이터 시험 | 2 |
| `src/components/agents/PhaseBadge.tsx` · `RosterBoard.tsx` · `DetailPanel.tsx` | 말풍선·명찰·상세 인용 | 3 |
| `tests/components/agents-phase-badge.test.tsx` · `agents-detail-panel.test.tsx` · `agents-roster-phase.test.ts`(신규) | 컴포넌트 시험 | 3 |
| `.claude/skills/dflow-work/scripts/dflow.sh` | `heartbeat --clear-merge-conflict`, 팀장 표시 응답 출력, 계약 2.7 | 4 |
| `.claude/skills/dflow-work/references/api-contract.md` | 계약 문서 2.7 | 4 |
| `tests/skills/dflow-heartbeat-merge-conflict.test.ts`(신규) | 가짜 curl 로 CLI 확인 | 4 |
| `.claude/skills/dflow-dev/scripts/pred-reflected.sh`(신규) | 행 G 반영 확인 공용 판정 | 5 |
| `.claude/skills/dflow-dev/SKILL.md` | 행 G 실행을 스크립트 한 줄로 | 5 |
| `tests/skills/dflow-pred-reflected.test.ts`(신규) · `tests/skills/dflow-row-g-evidence.test.ts` | 스크립트·문서 시험 | 5 |
| `.claude/skills/dflow-merge/SKILL.md` | 충돌 파일 목록, 「해소 머지(--resolve)」 절 | 6 |
| `tests/skills/dflow-merge-resolve.test.ts`(신규) | 문서 문자열 + 임시 git 저장소 | 6 |
| `.claude/skills/dflow-team/references/resolve-prompt.md`(신규) | 해소 워커 프롬프트·규약·게이트·결과 줄 | 7 |
| `.claude/skills/dflow-team/scripts/resolve-decide.sh`(신규) | 해소 재시도 판정 | 7 |
| `tests/skills/dflow-team-resolve.test.ts`(신규) | 프롬프트·판정 스크립트·훅 시험 | 7 |
| `tests/skills/dflow-team-merge-conflict.test.ts`(신규) | 팀장 문서·문서 속 jq·이벤트 가드 | 8 |
| `.claude/skills/dflow-team/references/merge-conflict.md`(신규) | 팀장의 충돌 접수·해소 spawn·결과 처리·표시 | 8 |
| `.claude/skills/dflow-team/SKILL.md` | 포인터 절 「4-1」「5-2」 와 최소 문구 변경 | 8 |
| `.claude/skills/dflow-team/references/events.md` · `backends.md` · `help.md` | 이벤트·고아 정리·도움말 | 8 |
| `tests/skills/dflow-team-depends-precheck.test.ts` · `dflow-team-shell-blocks.test.ts` | 사전 필터·셸 블록 | 8 |
| `.claude/skills/dflow-wbs/SKILL.md` | 「계약 Task 의 공유 파일 규칙」 | 9 |
| `tests/skills/dflow-wbs-contract-rules.test.ts`(신규) | 규칙 문서 시험 | 9 |

Task 의존: 1 → 2 → 3(`Phase` 타입과 `LEAD_PHASES`). 4 는 1 의 응답 모양을 쓴다. 8 은 4·5·6·7 의 이름을 쓴다. 이 계획이 이름과 출력을 모두 정해 두었으므로 **1·4·5·6·7·9 는 병렬로 해도 된다.** 2 는 1 뒤, 3 은 2 뒤, 8 은 5·7 뒤, 10 은 모두 끝난 뒤다.

`dflow-team.test.ts`(32K, 병행 세션이 자주 고친다)에는 새 검사를 넣지 않는다. 스펙 §9 가 그 파일에 넣으라고 한 검사는 새 파일 `dflow-team-resolve.test.ts` 에 둔다. 같은 이유로 `dflow-merge-remote.test.ts` 의 `CHANGED` 에도 아무것도 더하지 않는다. 이번에 바꾸는 dflow-merge 줄은 fixture(`tests/skills/fixtures/dflow-merge.SKILL.orig.md`)에 없으므로 보존 검사가 빨개지지 않는다. `CHANGED` 에 줄을 더하면 그 검사 둘째 it(fixture 에 정확히 한 번)이 오히려 깨진다.

---

### Task 0: 준비 (컨트롤러가 직접)

- [ ] **Step 1: 최신 staging 을 받아 합친다**

```bash
cd /Users/jji/project/wbs-web-mergefix
git status --short          # 비어 있어야 한다
git fetch -q origin
git merge --no-edit origin/staging
npm ci --silent
```

- [ ] **Step 2: 기준선**

Run: `npx vitest run tests/skills tests/agent tests/domain tests/data tests/components/agents-phase-badge.test.tsx tests/components/agents-detail-panel.test.tsx 2>&1 | tail -5`
Expected: 실패 0. 실패가 있으면 이 계획과 무관한 기존 실패인지 기록해 두고 진행한다(게이트는 기준선 대비 신규 실패 0).

- [ ] **Step 3: 편집 기준 원문이 정확히 한 번씩 있는지 확인**

```bash
cd /Users/jji/project/wbs-web-mergefix
T=.claude/skills/dflow-team/SKILL.md; M=.claude/skills/dflow-merge/SKILL.md; D=.claude/skills/dflow-dev/SKILL.md; W=.claude/skills/dflow-wbs/SKILL.md
for p in \
  "$T|「2. 기상과 감시」「3. 결과 처리」「6. blocked」「7. 마감」 과 \`references/events.md\`, \`references/backends.md\` 의" \
  "$T|\`failed not-assignee\`·\`cancelled\` 는 세지도 끊지도 않고 건너뛴다)" \
  "$T|- \`team.spawn\` 의 \`slot\`·\`id8\`·\`worktree\`·\`handle\` 로 슬롯과 작업을 잇는다. 아직 브랜치를 만들지 않은 Phase 01" \
  "$T|4. 빈 슬롯이 있고 차단기가 허락하면 **재개 대상을 먼저**(「5-1. 재개 spawn」), 그 다음 대기 큐 맨 앞부터" \
  "$T|로 같은 처리를 한다(아래 「선행 사전 검사」)." \
  "$T|            deps_unmet: [.depends_evidence[]? | select(has(\"reached\") and .reached == false) | .external_ref]}'" \
  "$T|\`state.json\` 의 \`phase=merged\` 로 거르지 않는다. 이유: 진행 중인 선행이라도" \
  "$T|해제(「3. 결과 처리」)의 선행 계열에 그대로 들어간다." \
  "$T|- **그 자리에서 정리하는 이유**: git 은 다른 워크트리가 체크아웃한 브랜치를 지우지 못한다. 워크트리를 마감까지" \
  "$T|(\`no-result\`·\`rate-limit\` 포함, \`not-assignee\` 제외)" \
  "$T|- **머지 충돌**: \`/dflow-merge\` 가 \`git merge --abort\` 로 되돌리고 \"머지 실패(충돌)\" 로 보고한 뒤 다음 후보로" \
  "$T|- **자동 머지 뒤 일시 제외 해제**: 자동 머지 스윕이 \"머지됨(승인 전)\" 을 한 건이라도 냈으면, 일시 제외 가운데 사유가" \
  "$T|  선행 계열(선행 미충족·선행 미승인·선행 승인 대기·claim exit 4·공통 기점 없음)인 id8 을 목록에서 빼고, 재기동 조건" \
  "$T|- \`team.sweep\`(merged, waiting, rejected 개수)을 기록한다." \
  "$T|## 5. 팀원 spawn" \
  "$T|같은 작업을 다시 띄우는 것은 셋뿐이다." \
  "$T|## 6. blocked" \
  "$T|   무한정 붙잡지 않게 한다. 팀원은 팀장이 끝나도 자기 pane 이나 탭에서 계속 돈다." \
  "$T|- 팀장이 작업을 claim·progress·done 하는 것. 서버 쓰기는 팀원 몫이다(스윕의 머지만 팀장이 한다). 재개도" \
  "$T|  의 팀원도 이것으로 id8 을 안다." \
  "$T|- **부트스트랩 실패 정리**: \`.result\` 의 branch 가 \`-\`(브랜치를 만들기 전에 끝남)이면 backends.md" \
  "$T|  간다. 팀장은 그 id8 을 \"사람이 머지해야 함\" 으로 보고한다. 팀장 체크아웃은 깨끗하게 남아 다음 기상의 전제가" \
  ".claude/skills/dflow-team/references/backends.md|3. 하나라도 거짓이면 지우지 않는다. 그 다음 SKILL.md 「팀장 상태」 고아 스캔의 **\"재개 가능\"** 조건을 보고" \
  ".claude/skills/dflow-team/references/events.md|  \`spawn_kind\` 는 세 값 중 하나인 문자열이다. \`new\` 는 「5. 팀원 spawn」 의 새 작업, \`resume\` 은" \
  "$T|- 같은 작업의 재spawn. 예외는 셋이다." \
  "$M|   3. \`git merge --no-ff <머지 대상>\`. 충돌하면 \`git merge --abort\` 로 되돌리고 \"머지 실패(충돌)\" 로" \
  "$M|      이유가 되지 않는다." \
  "$M|## 금지" \
  "$M|확인한다는 팀장 설계와 어긋난다. 플래그가 없으면 종전대로 approved 만 머지한다." \
  "$D|줄마다 단독으로 실행해 출력을 읽는다(git 을 감싼 명령 치환은 워커 git 호출 규칙이 금지한다)." \
  "$W|⚠️ **의존 그래프 구조 예외**" \
  "$W|- 유일한 depends = 해당 DB(ERD)/설계 분리 Task" \
  "$W|  - 실행 로직 없음 (contract-only)" \
  "$W|    \`max_chain_depth > 3\`(기능 구간 내부 기준, 공정 양끝 +2 는 구조 비용 허용) 또는 \`fan_in ≥ 3\` → 계약 추출 재검토. 결과를 \`## 의존 그래프\` 챕터에 기록 (후보 없어도 \"후보 없음\" 명시)." \
  ; do f=${p%%|*}; s=${p#*|}; n=$(grep -cF -- "$s" "$f"); [ "$n" = 1 ] || echo "ANCHOR $n $f :: $s"; done; echo ANCHOR_CHECK_DONE
```
Expected: `ANCHOR_CHECK_DONE` 한 줄만 나온다. `ANCHOR <n>` 줄이 나오면 그 원문이 병행 세션 때문에 바뀐 것이다. 해당 Task 의 편집 원문을 현재 문장으로 고쳐 적은 뒤 진행한다. 뜻이 바뀐 경우에는 멈추고 보고한다.

- [ ] **Step 4: 이 계획과 스펙을 같은 브랜치에 둔다**

스펙 커밋 `41a5748a` 와 이 계획 커밋이 이미 브랜치에 있다. 따로 할 일은 없다.

---
### Task 1: 서버 — `merge_conflict` phase 와 heartbeat 라우트 (계약 2.7)

**Files:**
- Modify: `src/lib/domain/seatState.ts` (`Phase` 타입, `HEARTBEAT_PHASES` 바로 아래, `inferPhase`)
- Modify: `src/app/api/v1/agent/work/[id]/heartbeat/route.ts`
- Modify: `src/lib/agent/externalApi.ts` (`AGENT_CONTRACT_VERSION`)
- Test: `tests/domain/seat-state.test.ts`, `tests/agent/heartbeat-route.test.ts`, `tests/agent/me-route.test.ts`

**Interfaces:**
- Produces:
  - `type Phase = … | 'merge_conflict'`
  - `export const LEAD_PHASES: readonly Phase[] = ['merge_conflict']`. `HEARTBEAT_PHASES` 는 바꾸지 않는다.
  - `inferPhase(i)` 는 `heartbeatPhase` 가 `HEARTBEAT_PHASES` 나 `LEAD_PHASES` 에 들면 그 값을 돌려준다.
  - `POST /api/v1/agent/work/{id}/heartbeat` 의 팀장 표시 갈래:
    - 본문 `{agent, phase:"merge_conflict", note}` → 200 `{ok:true, phase:"merge_conflict"}`
    - 본문 `{agent, clear:"merge_conflict"}` → 200 `{ok:true, phase:null, cleared:boolean}`
    - 오류: 400 `bad_request`(note 없음, clear 와 phase 를 함께 보냄, clear 값이 다름, 주문이 claimed), 400 `identity_required`(레거시 principal), 403 `not_claim_owner`, 409 `conflict`(그 밖의 상태, 설정 0행), 409 `cancelled`, 500
  - 워커 갈래(claimed + `HEARTBEAT_PHASES`)의 응답 `{ok, last_heartbeat_at}` 은 그대로다.
  - `AGENT_CONTRACT_VERSION = '2.7'`

- [ ] **Step 1: 도메인 시험을 먼저 쓴다**

`tests/domain/seat-state.test.ts` 파일 끝에 붙인다(import 줄에는 `LEAD_PHASES`·`HEARTBEAT_PHASES` 를 더한다: `OFFLINE_MS, STALE_MS, WATCHER_TTL_MS, HEARTBEAT_PHASES, LEAD_PHASES, animFor, …`).

```ts
describe('merge_conflict — 팀장 대리 표시 phase(2026-09-23 머지 충돌 §7.3)', () => {
  it('LEAD_PHASES 에만 있고 워커 phase 목록(HEARTBEAT_PHASES)에는 없다', () => {
    expect(LEAD_PHASES).toEqual(['merge_conflict'])
    expect(HEARTBEAT_PHASES).not.toContain('merge_conflict')
  })
  it('inferPhase 는 reported·approved 주문의 merge_conflict 를 그대로 돌려준다', () => {
    expect(inferPhase(base({ status: 'reported', heartbeatPhase: 'merge_conflict' }))).toBe('merge_conflict')
    expect(inferPhase(base({ status: 'approved', heartbeatPhase: 'merge_conflict' }))).toBe('merge_conflict')
  })
  it('deriveSeatState 는 바뀌지 않는다 — 머지 충돌은 WAIT·DONE 좌석의 phase 로만 드러난다', () => {
    expect(deriveSeatState(base({ status: 'reported', heartbeatPhase: 'merge_conflict' }), NOW)).toBe('WAIT')
    expect(deriveSeatState(base({ status: 'approved', heartbeatPhase: 'merge_conflict' }), NOW)).toBe('DONE')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/domain/seat-state.test.ts`
Expected: FAIL. `LEAD_PHASES` 가 export 되지 않았다(undefined).

- [ ] **Step 3: 도메인을 구현한다**

`src/lib/domain/seatState.ts`:
- 원문 `export type Phase = 'design' | 'build' | 'verify' | 'refactor' | 'blocked' | 'rejected' | 'reported'`
  → `export type Phase = 'design' | 'build' | 'verify' | 'refactor' | 'blocked' | 'rejected' | 'reported' | 'merge_conflict'`
- 원문 `export const HEARTBEAT_PHASES: readonly Phase[] = ['design', 'build', 'verify', 'refactor', 'blocked', 'rejected', 'reported']` 바로 아래에 더한다.
```ts
/** 팀장이 대리로 쏘는 표시 phase — reported·approved 주문에만 받는다(heartbeat 라우트). 워커 phase 와 섞지 않는다.
 *  정본: docs/superpowers/specs/2026-09-23-parallel-merge-conflict-design.md §7.2~7.3 */
export const LEAD_PHASES: readonly Phase[] = ['merge_conflict']
```
- `inferPhase` 의 원문 `  if (i.heartbeatPhase && (HEARTBEAT_PHASES as readonly string[]).includes(i.heartbeatPhase)) {`
  → `  if (i.heartbeatPhase && ([...HEARTBEAT_PHASES, ...LEAD_PHASES] as readonly string[]).includes(i.heartbeatPhase)) {`

Run: `npx vitest run tests/domain/seat-state.test.ts`
Expected: PASS

- [ ] **Step 4: 라우트 시험을 먼저 쓴다**

`tests/agent/heartbeat-route.test.ts` 의 `useAdmin` 이 `eq`·`in` 호출을 기록하게 바꾼다.
원문 `      for (const k of ['eq', 'in', 'limit', 'order']) b[k] = () => b`
→
```ts
      for (const k of ['limit', 'order']) b[k] = () => b
      // 가드 조건(.eq('heartbeat_phase', …)·.in('status', …))을 시험이 확인할 수 있게 인자를 남긴다.
      b.eq = (...a: unknown[]) => { (calls[`${table}:eq`] ??= []).push(a); return b }
      b.in = (...a: unknown[]) => { (calls[`${table}:in`] ??= []).push(a); return b }
```

파일 끝에 붙인다.

```ts
describe('POST heartbeat — 팀장 대리 merge_conflict(2026-09-23 머지 충돌 §7.2)', () => {
  const LEAD = 'hong/mbp/lead'
  const REPORTED = { ...ORDER, status: 'reported' }
  it('reported + merge_conflict → 200, heartbeat_phase·heartbeat_note 두 열만 쓴다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(REPORTED), calls)
    const res = await post({ agent: LEAD, phase: 'merge_conflict', note: '충돌 2개(src/a.ts…) · 해소 대기 1/3' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, phase: 'merge_conflict' })
    // updated_at(승인분 7일 창)·heartbeat_agent(좌석 이름)·last_heartbeat_at·resume_requested_* 는 건드리지 않는다
    expect(calls.agent_work_orders[0]).toEqual({ heartbeat_phase: 'merge_conflict', heartbeat_note: '충돌 2개(src/a.ts…) · 해소 대기 1/3' })
    expect(calls['agent_work_orders:in']).toContainEqual(['status', ['reported', 'approved']])
    expect(calls['agent_work_reports:insert']).toBeUndefined()
  })
  it('approved 도 같다(E9 — 승인분도 자동 해소한다)', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues({ ...ORDER, status: 'approved' }), calls)
    expect((await post({ agent: LEAD, phase: 'merge_conflict', note: '사람 머지 필요: 해소 상한(3/3)' })).status).toBe(200)
    expect((calls.agent_work_orders[0] as Record<string, unknown>).heartbeat_phase).toBe('merge_conflict')
  })
  it('clear → 현재 값이 merge_conflict 일 때만 null 로 되돌린다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(REPORTED), calls)
    const res = await post({ agent: LEAD, clear: 'merge_conflict' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, phase: null, cleared: true })
    expect(calls.agent_work_orders[0]).toEqual({ heartbeat_phase: null, heartbeat_note: null })
    expect(calls['agent_work_orders:eq']).toContainEqual(['heartbeat_phase', 'merge_conflict'])
    expect(calls['agent_work_orders:in']).toContainEqual(['status', ['reported', 'approved']])
  })
  it('clear 인데 바뀐 행이 없으면(다른 phase 이거나 이미 해제) 200 cleared:false — 다른 값을 지우지 않는다', async () => {
    useAdmin({ ...okQueues(REPORTED), agent_work_orders: [{ data: REPORTED }, { data: [] }] })
    const res = await post({ agent: LEAD, clear: 'merge_conflict' })
    expect(res.status).toBe(200)
    expect((await res.json()).cleared).toBe(false)
  })
  it('400 — merge_conflict 에 note 없음 / clear 와 phase 동시 / clear 값이 merge_conflict 아님', async () => {
    useAdmin(okQueues(REPORTED)); expect((await post({ agent: LEAD, phase: 'merge_conflict' })).status).toBe(400)
    useAdmin(okQueues(REPORTED)); expect((await post({ agent: LEAD, phase: 'merge_conflict', note: '  ' })).status).toBe(400)
    useAdmin(okQueues(REPORTED)); expect((await post({ agent: LEAD, phase: 'build', clear: 'merge_conflict' })).status).toBe(400)
    useAdmin(okQueues(REPORTED)); expect((await post({ agent: LEAD, clear: 'blocked' })).status).toBe(400)
  })
  it('400 — claimed 주문에는 merge_conflict 를 받지 않는다(워커 phase 와 섞지 않는다)', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls)
    expect((await post({ agent: LEAD, phase: 'merge_conflict', note: 'x' })).status).toBe(400)
    expect(calls.agent_work_orders).toBeUndefined()
  })
  it('409 conflict — reported 에 워커 phase(design) 는 종전대로 / ready 에 merge_conflict', async () => {
    useAdmin(okQueues(REPORTED))
    const r1 = await post({ agent: 'hong/mbp/w1', phase: 'design' })
    expect(r1.status).toBe(409); expect((await r1.json()).code).toBe('conflict')
    useAdmin(okQueues({ ...ORDER, status: 'ready', claimed_by: null, claimed_by_user_id: null } as unknown as typeof ORDER))
    expect((await post({ agent: LEAD, phase: 'merge_conflict', note: 'x' })).status).toBe(409)
  })
  it('409 conflict — 설정 update 가 0행(그사이 상태가 바뀜)', async () => {
    useAdmin({ ...okQueues(REPORTED), agent_work_orders: [{ data: REPORTED }, { data: [] }] })
    expect((await post({ agent: LEAD, phase: 'merge_conflict', note: 'x' })).status).toBe(409)
  })
  it('409 cancelled — 중단된 주문은 표시하지 않는다', async () => {
    useAdmin(okQueues({ ...ORDER, status: 'cancelled', claimed_by: null, claimed_by_user_id: null } as unknown as typeof ORDER))
    expect((await (await post({ agent: LEAD, clear: 'merge_conflict' })).json()).code).toBe('cancelled')
  })
  it('400 identity_required — 레거시 시크릿 principal 은 팀장 표시를 보낼 수 없다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(REPORTED), calls)
    const res = await post({ user_email: 'dev@example.com', agent: 'lead1', phase: 'merge_conflict', note: 'x' }, 'legacy-secret')
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('identity_required')
    expect(calls.agent_work_orders).toBeUndefined()
  })
  it('403 not_claim_owner — 다른 계정이 점유했던 주문', async () => {
    useAdmin(okQueues({ ...REPORTED, claimed_by_user_id: 'u-9' }))
    const res = await post({ agent: LEAD, phase: 'merge_conflict', note: 'x' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_claim_owner')
  })
  it('500 — 주문 조회 실패 / 표시 update 실패', async () => {
    useAdmin({ ...okQueues(REPORTED), agent_work_orders: [{ error: { message: 'boom' } }] })
    expect((await post({ agent: LEAD, phase: 'merge_conflict', note: 'x' })).status).toBe(500)
    useAdmin({ ...okQueues(REPORTED), agent_work_orders: [{ data: REPORTED }, { error: { message: 'boom' } }] })
    expect((await post({ agent: LEAD, clear: 'merge_conflict' })).status).toBe(500)
  })
})
```

`tests/agent/me-route.test.ts` 의 원문 `    expect(body.contract_version).toBe('2.5')` → `    expect(body.contract_version).toBe('2.7') // 머지 충돌 표시. 과제 C(2.6)와 머지 순서에 따라 조정한다`

- [ ] **Step 5: 실패를 확인한다**

Run: `npx vitest run tests/agent/heartbeat-route.test.ts tests/agent/me-route.test.ts`
Expected: FAIL. 새 describe 는 400(`phase 는 design|…`)으로 떨어지고, me-route 는 `'2.5'` 다. 기존 it 은 모두 PASS 로 남는다(`eq`·`in` 기록만 더했다).

- [ ] **Step 6: 라우트를 구현한다**

`src/app/api/v1/agent/work/[id]/heartbeat/route.ts`:

1. import 원문 `import { HEARTBEAT_PHASES } from '@/lib/domain/seatState'` → `import { HEARTBEAT_PHASES, LEAD_PHASES } from '@/lib/domain/seatState'`
2. 원문 `const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,63}$/` 바로 아래에 더한다.
```ts
/** 팀장 대리 표시(머지 충돌 설계 2026-09-23 §7.2)를 받는 주문 상태. 워커 phase 는 여전히 claimed 에서만 받는다. */
const LEAD_STATUSES = ['reported', 'approved'] as const
const ALL_PHASES = [...HEARTBEAT_PHASES, ...LEAD_PHASES] as readonly string[]
```
3. phase 검증 두 줄을 바꾼다.
원문
```ts
  if (phase !== null && (typeof phase !== 'string' || !(HEARTBEAT_PHASES as readonly string[]).includes(phase))) {
    return apiBadRequest(`phase 는 ${HEARTBEAT_PHASES.join('|')} 중 하나여야 합니다.`)
  }
```
→
```ts
  if (phase !== null && (typeof phase !== 'string' || !ALL_PHASES.includes(phase))) {
    return apiBadRequest(`phase 는 ${ALL_PHASES.join('|')} 중 하나여야 합니다.`)
  }
  // 팀장 대리 해제 — 현재 값이 merge_conflict 일 때만 지운다(아래 writeLeadMark).
  const clear = b.clear === undefined || b.clear === null ? null : b.clear
  if (clear !== null && clear !== 'merge_conflict') return apiBadRequest('clear 는 merge_conflict 만 받습니다.')
  if (clear !== null && phase !== null) return apiBadRequest('clear 와 phase 를 함께 보낼 수 없습니다.')
  const lead = phase === 'merge_conflict' || clear !== null
```
4. 원문 `  if (note.length > NOTE_MAX) return apiBadRequest(\`note 는 ${NOTE_MAX}자 이하여야 합니다.\`)` 바로 아래에 더한다.
```ts
  if (phase === 'merge_conflict' && !note) return apiBadRequest('merge_conflict 는 note 가 필요합니다(충돌 파일·해소 단계).')
```
5. 원문 `    if (!actor.ok) return actor.res` 바로 아래에 더한다.
```ts
    // 팀장 대리 표시는 PAT 전용 — 레거시 소유 판정(claimed_by 라벨)으로는 팀장이 통과할 수 없다(§7.2).
    if (lead && actor.principal.kind !== 'pat') {
      return apiFail(400, 'identity_required', 'merge_conflict 표시는 PAT 로만 보낼 수 있습니다.')
    }
```
6. 상태 판정을 바꾼다.
원문
```ts
    if (order.status !== 'claimed') {
      return apiFail(409, 'conflict', `heartbeat 가능한 상태가 아닙니다(현재: ${order.status}).`)
    }
```
→
```ts
    if (lead) {
      if (order.status === 'claimed') return apiBadRequest('merge_conflict 는 완료 보고(reported)·승인(approved) 주문에만 씁니다.')
      if (!(LEAD_STATUSES as readonly string[]).includes(order.status)) {
        return apiFail(409, 'conflict', `merge_conflict 를 표시할 수 있는 상태가 아닙니다(현재: ${order.status}).`)
      }
    } else if (order.status !== 'claimed') {
      return apiFail(409, 'conflict', `heartbeat 가능한 상태가 아닙니다(현재: ${order.status}).`)
    }
```
7. 소유 판정 블록이 끝나는 원문 `    const now = new Date().toISOString()` 바로 **위**에 더한다(소유 판정은 두 갈래가 같이 쓴다. `report` 가 `claimed_by_user_id` 를 지우지 않으므로 같은 계정의 팀장이 통과한다).
```ts
    if (lead) return await writeLeadMark(admin, id, clear !== null, note)
```
8. 파일 끝의 `export const GET = apiNotFound` 바로 **위**에 함수를 더한다.
```ts
/**
 * 팀장 대리 표시 — heartbeat_phase·heartbeat_note 두 열만 쓴다.
 * updated_at 을 건드리지 않는 이유: 승인분 좌석은 updated_at 7일 창으로 고른다(agentSeatmap.ts DONE_WINDOW_MS).
 * heartbeat_agent 를 건드리지 않는 이유: 좌석 이름이 heartbeat_agent ?? claimed_by 라 팀장 라벨로 바뀐다.
 */
async function writeLeadMark(admin: ReturnType<typeof createAdminClient>, id: string, clear: boolean, note: string) {
  const patch = clear ? { heartbeat_phase: null, heartbeat_note: null } : { heartbeat_phase: 'merge_conflict', heartbeat_note: note }
  let q = admin.from('agent_work_orders').update(patch).eq('id', id).in('status', [...LEAD_STATUSES])
  // 해제는 현재 값이 merge_conflict 일 때만 — 워커가 남긴 다른 phase 를 지우지 않는다.
  if (clear) q = q.eq('heartbeat_phase', 'merge_conflict')
  const { data, error } = await q.select('id')
  if (error) {
    console.error('[agent-api] merge_conflict 표시 실패:', error.message)
    return apiInternalError()
  }
  const n = ((data as unknown[] | null) ?? []).length
  if (clear) return NextResponse.json({ ok: true, phase: null, cleared: n > 0 })
  if (n === 0) return apiFail(409, 'conflict', '주문 상태가 바뀌어 merge_conflict 를 표시하지 못했습니다.')
  return NextResponse.json({ ok: true, phase: 'merge_conflict' })
}
```
9. 파일 머리 주석 원문 ` * 승인 화면의 이력이 오염되고 디스크가 찬다(2026-08-05 장애 경로). 열 4개 touch 뿐이다.` 바로 아래에 한 줄을 더한다.
```ts
 * 예외: reported·approved 주문의 merge_conflict 설정·해제(팀장 대리, 2026-09-23 머지 충돌 §7.2)는 phase·note 두 열만 쓴다.
```

`src/lib/agent/externalApi.ts` 원문 `export const AGENT_CONTRACT_VERSION = '2.5'`
→
```ts
// 2.7: heartbeat 의 팀장 merge_conflict 표시(2026-09-23 머지 충돌 설계 §7.2). 병행 과제 C 가 2.6 을 쓴다 —
// 머지 순서가 바뀌면(이 변경이 C 보다 먼저 staging 에 들어가면) 번호를 서로 맞춘다.
export const AGENT_CONTRACT_VERSION = '2.7'
```

- [ ] **Step 7: 통과를 확인한다**

Run: `npx vitest run tests/agent/heartbeat-route.test.ts tests/agent/me-route.test.ts tests/domain/seat-state.test.ts && npx tsc --noEmit -p . 2>&1 | head -20`
Expected: PASS. 타입 오류 0. `q = q.eq(…)` 재대입이 타입 오류를 내면 `const base = …; const { data, error } = await (clear ? base.eq('heartbeat_phase', 'merge_conflict') : base).select('id')` 꼴로 바꾼다.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/domain/seatState.ts "src/app/api/v1/agent/work/[id]/heartbeat/route.ts" src/lib/agent/externalApi.ts tests/domain/seat-state.test.ts tests/agent/heartbeat-route.test.ts tests/agent/me-route.test.ts
git commit -m "feat(agent): 팀장이 reported·approved 주문에 머지 충돌 표시를 쏠 수 있게 한다" -m "해소 워커는 서버를 부르지 않아 충돌 표시를 팀장이 대신 쏜다. 표시는 heartbeat_phase·note 두 열만 써 승인분 7일 창과 좌석 이름을 흔들지 않는다. 계약 2.7(과제 C 2.6 과 머지 순서로 조정)." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA"
```

---

### Task 2: 좌석표 도메인·데이터 — note, 확인 필요 띠, 후속 대기 사유

**Files:**
- Modify: `src/lib/domain/seatmap.ts` (`toSeat` 의 `note`, `Attention` 인터페이스, 확인 필요 띠 루프·정렬)
- Modify: `src/lib/domain/waitReason.ts` (`WaitReasonKind`, `PredecessorLike`, `deriveWaitReason` 끝)
- Modify: `src/components/agent-hub/labels.ts` (`REASON_TONE` — `Record<WaitReasonKind>` 라 키를 더하지 않으면 타입 오류)
- Modify: `src/lib/data/agentSeatmap.ts` (선행 주문 조회)
- Test: `tests/domain/seatmap.test.ts`, `tests/domain/wait-reason.test.ts`, `tests/data/agent-seatmap.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `Phase` 에 든 `'merge_conflict'` 와 `inferPhase`
- Produces:
  - `Seat.note` 는 `heartbeat_phase` 가 `blocked` 이거나 `merge_conflict` 일 때 `heartbeat_note` 를 싣는다.
  - `interface Attention { …; mergeConflict?: boolean }`. 머지 충돌 좌석은 `mergeConflict: true`, `why: '머지 충돌 · <note>'`, `state` 는 좌석 상태(WAIT·DONE) 그대로다.
  - `WaitReasonKind = 'dependency' | 'agent_off' | 'agents_busy' | 'pickup' | 'merge_conflict'`
  - `PredecessorLike.merge_conflict?: boolean`. `fetchSeatmapRows` 가 채운다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/domain/seatmap.test.ts` 파일 끝에 붙인다.

```ts
describe('assembleSeatmap — 머지 충돌 표시(2026-09-23 §7.3)', () => {
  it('reported·approved 주문의 merge_conflict 는 좌석 phase 와 note 로 싣고 상태는 WAIT·DONE 그대로', () => {
    const m = assembleSeatmap(rows({ orders: [
      order({ id: '1'.repeat(8) + '-a', status: 'reported', heartbeat_phase: 'merge_conflict', heartbeat_note: '충돌 2개(src/a.ts…) · 해소 중 w2 1/3', updated_at: ago(60_000) }),
    ] }), NOW)
    const s = m.floors[0].zones[0].seats[0]
    expect(s.state).toBe('WAIT')
    expect(s.phase).toBe('merge_conflict')
    expect(s.note).toBe('충돌 2개(src/a.ts…) · 해소 중 w2 1/3')
  })
  it('확인 필요 띠: 머지 충돌은 BLOCKED 바로 뒤, DONE 좌석도 든다', () => {
    const m = assembleSeatmap(rows({ orders: [
      order({ id: '1'.repeat(8) + '-a', last_heartbeat_at: ago(STALE_MS + 1), updated_at: ago(STALE_MS + 1) }),
      order({ id: '2'.repeat(8) + '-b', status: 'approved', heartbeat_phase: 'merge_conflict', heartbeat_note: '사람 머지 필요: 해소 상한(3/3)', updated_at: ago(60_000) }),
      order({ id: '3'.repeat(8) + '-c', heartbeat_phase: 'blocked', heartbeat_note: '어느 DB?' }),
      order({ id: '4'.repeat(8) + '-d', status: 'reported', heartbeat_phase: 'merge_conflict', heartbeat_note: '충돌 1개(a) · 해소 대기 1/3' }),
    ] }), NOW)
    expect(m.attention.map(a => [a.state, a.mergeConflict ?? false])).toEqual([
      ['BLOCKED', false], ['DONE', true], ['WAIT', true], ['STALE', false],
    ])
    expect(m.attention[1].why).toBe('머지 충돌 · 사람 머지 필요: 해소 상한(3/3)')
    // DONE 은 여전히 현황판 넷(active·idle·offline)에 끼지 않는다
    expect(m.counters).toEqual({ active: 2, standby: 0, idle: 1, offline: 0 })
  })
  it('blocked 가 아닌 워커 phase 의 note 는 여전히 싣지 않는다', () => {
    const m = assembleSeatmap(rows({ orders: [order({ heartbeat_phase: 'build', heartbeat_note: '남은 값' })] }), NOW)
    expect(m.floors[0].zones[0].seats[0].note).toBeNull()
  })
})
```

`tests/domain/seatmap.test.ts` 의 `describe('assembleSeatmap — 착수 대기 사유(waitReason)'` 안 마지막 it 뒤에 붙인다.

```ts
  it('선행이 merge_conflict 이면 pickup 대신 merge_conflict(선행 머지 충돌)로 말한다', () => {
    const base = { orders: [ready()], items: [{ id: 'i1', project_id: P1, code: 'T', name: 'n', parent_id: 'z1', actual_pct: 0, assignee_member_id: null, tags: ['agent'], depends: ['M/T1'] }], watchers: [w()] }
    const m = assembleSeatmap(rows({ ...base, predecessors: [{ id: 'x', project_id: P1, external_ref: 'M/T1', code: 'TSK-03-01', name: 'x', stage: 'im', order_approved: false, merge_conflict: true }] }), NOW)
    expect(seatOf(m).waitReason?.kind).toBe('merge_conflict')
    expect(seatOf(m).waitReason?.label).toBe('선행 머지 충돌')
    expect(seatOf(m).waitReason?.text).toContain('선행 TSK-03-01 가 개발 브랜치와 충돌해 머지 대기 중입니다')
    expect(seatOf(m).anim).toBe('empty')
  })
```

`tests/domain/wait-reason.test.ts` 파일 끝에 붙인다(`deriveWaitReason` 은 이미 import 돼 있다).

```ts
describe('deriveWaitReason — 선행 머지 충돌(2026-09-23 §7.3)', () => {
  const wl = { agent: 'hong/mbp/lead', user_id: 'u1', slots: 2, busy: 0, until_label: null }
  const mc = (merge_conflict: boolean) => ({ external_ref: 'M/T1', code: 'TSK-03-01', name: 'x', stage: 'im', order_approved: false, merge_conflict })
  it('집어갈 에이전트가 있고 선행이 충돌 중이면 merge_conflict', () => {
    expect(deriveWaitReason({ depends: ['M/T1'], predecessorByRef: () => mc(true), assignee: null, watchers: [wl] }).kind).toBe('merge_conflict')
  })
  it('선행이 충돌이 아니면 종전대로 pickup, 에이전트가 없으면 종전대로 agent_off(사람이 움직일 일이 먼저)', () => {
    expect(deriveWaitReason({ depends: ['M/T1'], predecessorByRef: () => mc(false), assignee: null, watchers: [wl] }).kind).toBe('pickup')
    expect(deriveWaitReason({ depends: ['M/T1'], predecessorByRef: () => mc(true), assignee: null, watchers: [] }).kind).toBe('agent_off')
  })
})
```

`tests/data/agent-seatmap.test.ts` 의 `describe('fetchSeatmapRows — 선행 항목(predecessors)'` 첫 it 을 바꾼다.
- 원문 `      agent_work_orders: [{ data: [READY] }, { data: [{ wbs_item_id: 'x1' }] }],`
  → `      agent_work_orders: [{ data: [READY] }, { data: [{ wbs_item_id: 'x1', status: 'approved', heartbeat_phase: null }, { wbs_item_id: 'x2', status: 'reported', heartbeat_phase: 'merge_conflict' }] }],`
- 원문 `    expect(calls['agent_work_orders.eq']?.[0]).toEqual(['status', 'approved'])`
  → `    expect(calls['agent_work_orders.in']?.[2]).toEqual(['status', ['reported', 'approved']])`
- 기대 predecessors 두 줄에 `merge_conflict` 를 더한다: 첫 줄 끝 `order_approved: true }` → `order_approved: true, merge_conflict: false }`, 둘째 줄 끝 `order_approved: false }` → `order_approved: false, merge_conflict: true }`.
- it 제목 `그 id 의 approved 주문 1회를` → `그 id 의 reported·approved 주문 1회를`.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/domain/seatmap.test.ts tests/domain/wait-reason.test.ts tests/data/agent-seatmap.test.ts`
Expected: FAIL 여섯 가지. note null, 띠 순서, `mergeConflict` undefined, waitReason pickup, 선행 조회 `eq`, `merge_conflict` 필드 없음.

- [ ] **Step 3: 구현한다**

`src/lib/domain/seatmap.ts`:
- 원문 `    note: o.heartbeat_phase === 'blocked' ? o.heartbeat_note : null,`
  → `    note: o.heartbeat_phase === 'blocked' || o.heartbeat_phase === 'merge_conflict' ? o.heartbeat_note : null,`
- 원문 `export interface Attention { orderId: string; id8: string; floorName: string; code: string; name: string; state: SeatState; why: string }`
  →
```ts
export interface Attention {
  orderId: string; id8: string; floorName: string; code: string; name: string; state: SeatState; why: string
  /** 머지 충돌 표시(팀장 대리, 2026-09-23). state 는 좌석 상태(WAIT·DONE) 그대로이고 이 표식이 띠 순서를 정한다. */
  mergeConflict?: boolean
}
```
- 원문 `const ATTENTION_ORDER: readonly SeatState[] = ['BLOCKED', 'STALE', 'OFFLINE', 'REJECTED']` 바로 아래에 더한다.
```ts
/** 확인 필요 띠 순서 — 머지 충돌은 BLOCKED 바로 뒤. WAIT·DONE 은 ATTENTION_ORDER 밖(-1)이라 따로 매긴다. */
function attentionRank(a: Attention): number {
  return a.mergeConflict ? 0.5 : ATTENTION_ORDER.indexOf(a.state)
}
```
- 원문
```ts
  for (const f of floors) for (const z of f.zones) for (const s of z.seats) {
    if (s.state === 'DONE') continue // 승인분은 doneCount 로 따로 센다 — 현황판 넷에 끼우지 않는다
```
→
```ts
  for (const f of floors) for (const z of f.zones) for (const s of z.seats) {
    // 머지 충돌은 승인 대기·승인 좌석에서 난다 — DONE 을 건너뛰기 전에 띠에 넣는다(카운터에는 넣지 않는다).
    if (s.heartbeatPhase === 'merge_conflict') {
      attention.push({ orderId: s.orderId, id8: s.id8, floorName: f.name, code: s.code, name: s.name, state: s.state, why: `머지 충돌 · ${s.note ?? '확인 필요'}`, mergeConflict: true })
    }
    if (s.state === 'DONE') continue // 승인분은 doneCount 로 따로 센다 — 현황판 넷에 끼우지 않는다
```
- 원문 `  attention.sort((a, b) => ATTENTION_ORDER.indexOf(a.state) - ATTENTION_ORDER.indexOf(b.state))`
  → `  attention.sort((a, b) => attentionRank(a) - attentionRank(b))`

`src/lib/domain/waitReason.ts`:
- 원문 `export type WaitReasonKind = 'dependency' | 'agent_off' | 'agents_busy' | 'pickup'`
  → `export type WaitReasonKind = 'dependency' | 'agent_off' | 'agents_busy' | 'pickup' | 'merge_conflict'`
- `PredecessorLike` 의 원문 `  actual_pct?: number | null` 바로 아래에 더한다.
```ts
  /** 선행 주문이 개발 브랜치와 머지 충돌 중(heartbeat_phase=merge_conflict, 2026-09-23). 선택 필드 — 모르는 호출부는 싣지 않는다. */
  merge_conflict?: boolean
```
- `deriveWaitReason` 끝의 원문
```ts
  return {
    kind: 'pickup', label: '착수 대기',
```
→
```ts
  // 선행이 머지 충돌 중이면 claim 게이트는 통과하지만 팀장 사전 필터가 거른다(2026-09-23 §6.3) — 그 이유를 보여 준다.
  const conflicted = (args.depends ?? []).map(r => args.predecessorByRef(r)).filter((p): p is PredecessorLike => p?.merge_conflict === true)
  if (conflicted.length > 0) {
    return {
      kind: 'merge_conflict', label: '선행 머지 충돌',
      text: `선행 ${conflicted.map(p => p.code).join(', ')} 가 개발 브랜치와 충돌해 머지 대기 중입니다. 해소되면 자동으로 착수합니다.`,
    }
  }
  return {
    kind: 'pickup', label: '착수 대기',
```

`src/components/agent-hub/labels.ts`:
- 원문 `  pickup: 'bg-pending-weak text-pending',` 바로 아래에 `  merge_conflict: 'bg-delayed-weak text-delayed',` 를 더한다.
- 주석 원문 ` * 착수 대기 사유 칩 색(waitReason.ts 의 네 종류).` → ` * 착수 대기 사유 칩 색(waitReason.ts 의 다섯 종류 — 선행 머지 충돌은 선행 대기와 같은 색).`

`src/lib/data/agentSeatmap.ts` 의 원문
```ts
    const approved = found.length
      ? must<Array<{ wbs_item_id: string }>>('선행 승인 주문',
        await admin.from('agent_work_orders').select('wbs_item_id').in('wbs_item_id', found.map(p => p.id)).eq('status', 'approved'))
      : []
    const ok = new Set(approved.map(a => a.wbs_item_id))
    predecessors = found.map(p => ({ ...p, order_approved: ok.has(p.id) }))
```
→
```ts
    // reported 도 함께 읽는다 — 선행의 머지 충돌 표시(heartbeat_phase=merge_conflict)가 후속 대기 사유가 된다(2026-09-23).
    const preds = found.length
      ? must<Array<{ wbs_item_id: string; status: string; heartbeat_phase: string | null }>>('선행 주문',
        await admin.from('agent_work_orders').select('wbs_item_id, status, heartbeat_phase').in('wbs_item_id', found.map(p => p.id)).in('status', ['reported', 'approved']))
      : []
    const ok = new Set(preds.filter(a => a.status === 'approved').map(a => a.wbs_item_id))
    const conflict = new Set(preds.filter(a => a.heartbeat_phase === 'merge_conflict').map(a => a.wbs_item_id))
    predecessors = found.map(p => ({ ...p, order_approved: ok.has(p.id), merge_conflict: conflict.has(p.id) }))
```
그 위 주석 원문 `  // 선행 항목 — ready 주문 항목의 depends 만 모아 프로젝트 안 external_ref 로 1회, 그 id 의 approved 주문 1회. ref 가 없으면 0회.`
→ `  // 선행 항목 — ready 주문 항목의 depends 만 모아 프로젝트 안 external_ref 로 1회, 그 id 의 reported·approved 주문 1회. ref 가 없으면 0회.`

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/domain tests/data tests/components/agent-hub-table.test.tsx && npx tsc --noEmit -p . 2>&1 | head -20`
Expected: PASS, 타입 오류 0. 에이전트 허브는 `deriveWaitReason` 을 쓰지만 `merge_conflict` 를 싣지 않으므로 동작이 바뀌지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/seatmap.ts src/lib/domain/waitReason.ts src/components/agent-hub/labels.ts src/lib/data/agentSeatmap.ts tests/domain/seatmap.test.ts tests/domain/wait-reason.test.ts tests/data/agent-seatmap.test.ts
git commit -m "feat(agent): 좌석표가 머지 충돌을 확인 필요 띠와 후속 대기 사유로 보인다" -m "충돌은 승인 대기·승인 좌석에서 나므로 DONE 을 건너뛰기 전에 띠에 넣고 BLOCKED 바로 뒤에 둔다. 선행 주문의 heartbeat_phase 를 함께 읽어 팀장 필터가 후속을 거르는 이유를 보여 준다." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA"
```

---

### Task 3: 컴포넌트 — 말풍선·명찰·상세 인용 (UI 위험 파일)

**Files:**
- Modify: `src/components/agents/PhaseBadge.tsx` (`PHASE_LOOK`, `seatPhaseKey`)
- Modify: `src/components/agents/RosterBoard.tsx` (`PHASE_KO` 에 키를 더하고 export 한다)
- Modify: `src/components/agents/DetailPanel.tsx` (BLOCKED 인용 옆)
- Test: `tests/components/agents-phase-badge.test.tsx`, `tests/components/agents-detail-panel.test.tsx`, `tests/components/agents-roster-phase.test.ts`(신규)

**Interfaces:**
- Consumes: Task 2 의 `Seat.phase === 'merge_conflict'` 와 `Seat.note`
- Produces:
  - `seatPhaseKey({state, phase})` 는 `phase === 'merge_conflict'` 면 좌석 상태와 무관하게 `'merge_conflict'` 를 돌려준다.
  - `export const PHASE_KO`

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/components/agents-phase-badge.test.tsx` 의 describe 안 마지막 it 뒤에 붙인다.

```tsx
  it('머지 충돌은 승인 대기·완료 좌석에도 말풍선을 달고, 순서 밖 상태라 점은 그리지 않는다', () => {
    expect(seatPhaseKey({ state: 'WAIT', phase: 'merge_conflict' })).toBe('merge_conflict')
    expect(seatPhaseKey({ state: 'DONE', phase: 'merge_conflict' })).toBe('merge_conflict')
    act(() => root.render(<PhaseBadge seat={{ state: 'WAIT', phase: 'merge_conflict' }} />))
    const b = host.querySelector('[data-phase-badge="merge_conflict"]')
    expect(b?.textContent).toContain('머지 충돌')
    expect(b?.getAttribute('title')).toBe('머지 충돌')
    expect(host.querySelector('[data-phase-dot]')).toBeNull()
  })
```
같은 파일의 원문 `    expect(seatPhaseKey({ state: 'WAIT', phase: 'reported' })).toBeNull()` 는 그대로 둔다. 머지 충돌이 아닌 승인 대기 좌석에는 여전히 말풍선을 달지 않는다.

`tests/components/agents-detail-panel.test.tsx` 파일 끝에 붙인다.

```tsx
describe('DetailPanel — 머지 충돌 인용(2026-09-23)', () => {
  it('phase 가 merge_conflict 이고 note 가 있으면 "머지 충돌: <note>" 를 인용한다', () => {
    act(() => root.render(<DetailPanel seat={seat({ state: 'WAIT', phase: 'merge_conflict', heartbeatPhase: 'merge_conflict', note: '충돌 2개(src/a.ts…) · 해소 중 w2 1/3' })} nowMs={NOW} {...OPS} />))
    expect(host.textContent).toContain('머지 충돌: 충돌 2개(src/a.ts…) · 해소 중 w2 1/3')
  })
  it('note 가 없으면 인용하지 않는다', () => {
    act(() => root.render(<DetailPanel seat={seat({ state: 'DONE', phase: 'merge_conflict', heartbeatPhase: 'merge_conflict', note: null })} nowMs={NOW} {...OPS} />))
    expect(host.textContent).not.toContain('머지 충돌:')
  })
})
```

`tests/components/agents-roster-phase.test.ts`(신규):

```ts
// 로스터 명찰의 단계 이름표 — 머지 충돌(2026-09-23)이 raw 값으로 새지 않는다.
import { describe, expect, it } from 'vitest'
import { PHASE_KO } from '@/components/agents/RosterBoard'

describe('RosterBoard PHASE_KO', () => {
  it('merge_conflict 를 "머지 충돌" 로 읽는다', () => {
    expect(PHASE_KO.merge_conflict).toBe('머지 충돌')
    expect(PHASE_KO.blocked).toBe('결정 대기')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/components/agents-phase-badge.test.tsx tests/components/agents-detail-panel.test.tsx tests/components/agents-roster-phase.test.ts`
Expected: FAIL 셋. `seatPhaseKey` 는 null 을 돌려주고, 인용이 없고, `PHASE_KO` 는 export 되지 않았다.

- [ ] **Step 3: 구현한다**

`src/components/agents/PhaseBadge.tsx`:
- 원문 `  rejected: { label: '재작업', color: '#EE7B6A', icon: I(<><path d="M3 8a5 5 0 1 0 1.5-3.5" /><path d="M3 2.5v2.5h2.5" /></>) },` 바로 아래에 더한다(색은 반려 빨강 `#EE7B6A` 와 구분되는 자홍, 아이콘은 갈라진 화살표).
```tsx
  // 머지 충돌(팀장 대리 표시, 2026-09-23) — 승인 대기·완료 좌석에도 단다. 순서 밖 상태라 점이 없다.
  merge_conflict: { label: '머지 충돌', color: '#D35FB7', icon: I(<><path d="M8 14V9" /><path d="M8 9L4 5" /><path d="M8 9l4-4" /><path d="M2.5 5.5L4 5l.5-1.5" /><path d="M13.5 5.5L12 5l-.5-1.5" /></>) },
```
- `seatPhaseKey` 의 원문 `  if (!WORKING.has(seat.state)) return null` 바로 **위**에 더한다.
```tsx
  // 머지 충돌은 WAIT·DONE 좌석에서 난다 — WORKING 검사보다 먼저 본다.
  if (seat.phase === 'merge_conflict') return 'merge_conflict'
```
- 파일 머리 주석 원문 `// 결정 대기·재작업은 순서 밖의 상태라 점 없이 말풍선만 단다. 에이전트가 붙어 있지 않은 좌석(빈자리·승인 대기·완료)엔 달지 않는다.` 바로 아래에 `// 예외: 머지 충돌(2026-09-23)은 승인 대기·완료 좌석에도 점 없이 단다 — 팀장이 대리로 쏜 표시다.` 를 더한다.

`src/components/agents/RosterBoard.tsx`:
- 원문 `const PHASE_KO: Record<string, string> = { design: '설계', build: '구현', verify: '검증', refactor: '리팩터', blocked: '결정 대기', rejected: '재작업', reported: '보고' }`
  → `export const PHASE_KO: Record<string, string> = { design: '설계', build: '구현', verify: '검증', refactor: '리팩터', blocked: '결정 대기', rejected: '재작업', reported: '보고', merge_conflict: '머지 충돌' }`

`src/components/agents/DetailPanel.tsx`:
- 원문 `      {seat.state === 'BLOCKED' && seat.note && <p className={css.quote}>{seat.note}</p>}` 바로 아래에 더한다.
```tsx
      {seat.phase === 'merge_conflict' && seat.note && <p className={css.quote}>머지 충돌: {seat.note}</p>}
```

`LaneBoard`·`Seat`·CSS 는 바꾸지 않는다. 좌석은 승인 대기·완료 레인에 그대로 있고 말풍선만 붙는다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/components/agents-phase-badge.test.tsx tests/components/agents-detail-panel.test.tsx tests/components/agents-roster-phase.test.ts tests/components/agents-seat.test.tsx tests/components/agents-seatmap-view.test.tsx tests/components/agents-owner.test.tsx && npm run lint`
Expected: PASS, 린트 오류 0.

- [ ] **Step 5: 커밋**

```bash
git add src/components/agents/PhaseBadge.tsx src/components/agents/RosterBoard.tsx src/components/agents/DetailPanel.tsx tests/components/agents-phase-badge.test.tsx tests/components/agents-detail-panel.test.tsx tests/components/agents-roster-phase.test.ts
git commit -m "feat(agent): 오피스 좌석에 머지 충돌 말풍선과 상세 인용을 단다" -m "사람이 팀장 보고를 읽지 않아도 충돌로 멈춘 작업을 좌석에서 바로 보게 한다. 승인 대기·완료 좌석에도 달되 순서 밖 상태라 네 점은 그리지 않는다. 화면 확인은 staging 에서 한다(Task 10)." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA"
```

---
### Task 4: CLI — `dflow.sh heartbeat --clear-merge-conflict` 와 계약 문서 2.7

**Files:**
- Modify: `.claude/skills/dflow-work/scripts/dflow.sh` (`CONTRACT_VERSION`, usage 의 heartbeat 줄, `cmd_heartbeat`)
- Modify: `.claude/skills/dflow-work/references/api-contract.md`
- Test: `tests/skills/dflow-heartbeat-merge-conflict.test.ts`(신규)

**Interfaces:**
- Consumes: Task 1 의 응답 `{ok, phase:"merge_conflict"}` · `{ok, phase:null, cleared}` · 워커 갈래 `{ok, last_heartbeat_at}`
- Produces:
  - `dflow.sh heartbeat <ref> --agent <id> --phase merge_conflict --note "<note>"` → stdout `MERGE_CONFLICT_SET`
  - `dflow.sh heartbeat <ref> --agent <id> --clear-merge-conflict` → stdout `MERGE_CONFLICT_CLEARED`(지웠음) 또는 `MERGE_CONFLICT_ABSENT`(지울 것이 없었음)
  - `--clear-merge-conflict` 와 `--phase` 를 함께 주면 usage(exit 2)
  - 워커 갈래의 출력(`last_heartbeat_at` 값)은 그대로다. exit 코드 규칙(3·4·5·6·7·10)도 그대로다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/skills/dflow-heartbeat-merge-conflict.test.ts`:

```ts
// tests/skills/dflow-heartbeat-merge-conflict.test.ts
// 팀장의 머지 충돌 표시(2026-09-23 §7.1) — dflow.sh heartbeat 가 보내는 본문과 출력. 가짜 curl 로 실제 실행한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DFLOW = join(process.cwd(), '.claude/skills/dflow-work/scripts/dflow.sh')
const TOKEN = `dflow_pat_AAAAAAAAAAAA_${'x'.repeat(24)}` // 가짜 토큰(형식만)
const ORDER = '22222222-2222-4222-8222-222222222222'

// api_raw 의 호출 꼴: -o <파일> 에 본문, stdout 에 HTTP 코드. --data 는 FAKE_DATA 파일에 남긴다.
const FAKE_CURL = `#!/bin/sh
out=''
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    --data) printf '%s' "$2" > "$FAKE_DATA"; shift ;;
    -H|-w|-X) shift ;;
  esac
  shift
done
printf '%s' "$FAKE_BODY" > "$out"; printf '%s' "$FAKE_CODE"
`

let tmp: string
function run(args: string[], code: string, body: string) {
  return spawnSync('sh', [DFLOW, ...args], {
    encoding: 'utf8',
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PATH: `${join(tmp, 'bin')}:${process.env.PATH ?? ''}`, HOME: join(tmp, 'home'),
      XDG_CACHE_HOME: join(tmp, 'cache'), DFLOW_ENV_FILE: join(tmp, 'no-such-env'), DFLOW_CONFIG_DIR: join(tmp, 'no-config'),
      DFLOW_API_BASE: 'https://x.test', DFLOW_PATS: TOKEN, FAKE_CODE: code, FAKE_BODY: body, FAKE_DATA: join(tmp, 'data.json'),
    },
  })
}
const sentBody = () => JSON.parse(readFileSync(join(tmp, 'data.json'), 'utf8'))

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dflow-mc-'))
  mkdirSync(join(tmp, 'bin')); mkdirSync(join(tmp, 'home'))
  writeFileSync(join(tmp, 'bin/curl'), FAKE_CURL, { mode: 0o755 })
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('dflow.sh heartbeat — 팀장 머지 충돌 표시', () => {
  it('설정: phase·note·agent 를 싣고 MERGE_CONFLICT_SET 을 낸다', () => {
    const r = run(['heartbeat', ORDER, '--agent', 'hong/mbp/lead', '--phase', 'merge_conflict', '--note', '충돌 2개(src/a.ts…) · 해소 대기 1/3'],
      '200', '{"ok":true,"phase":"merge_conflict"}')
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout.trim()).toBe('MERGE_CONFLICT_SET')
    expect(sentBody()).toEqual({ agent: 'hong/mbp/lead', phase: 'merge_conflict', note: '충돌 2개(src/a.ts…) · 해소 대기 1/3' })
  })
  it('해제: 본문은 {agent, clear:"merge_conflict"} 이고 phase 를 싣지 않는다', () => {
    const r = run(['heartbeat', ORDER, '--agent', 'hong/mbp/lead', '--clear-merge-conflict'], '200', '{"ok":true,"phase":null,"cleared":true}')
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout.trim()).toBe('MERGE_CONFLICT_CLEARED')
    expect(sentBody()).toEqual({ agent: 'hong/mbp/lead', clear: 'merge_conflict' })
  })
  it('해제할 것이 없었으면 MERGE_CONFLICT_ABSENT(오류가 아니다)', () => {
    const r = run(['heartbeat', ORDER, '--agent', 'hong/mbp/lead', '--clear-merge-conflict'], '200', '{"ok":true,"phase":null,"cleared":false}')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('MERGE_CONFLICT_ABSENT')
  })
  it('--clear-merge-conflict 와 --phase 를 함께 주면 usage(exit 2), 서버를 부르지 않는다', () => {
    const r = run(['heartbeat', ORDER, '--agent', 'hong/mbp/lead', '--phase', 'merge_conflict', '--clear-merge-conflict'], '200', '{}')
    expect(r.status).toBe(2)
  })
  it('워커 갈래는 종전대로 last_heartbeat_at 을 낸다', () => {
    const r = run(['heartbeat', ORDER, '--agent', 'hong/mbp/w1', '--phase', 'build'], '200', '{"ok":true,"last_heartbeat_at":"2026-09-23T00:00:00Z"}')
    expect(r.stdout.trim()).toBe('2026-09-23T00:00:00Z')
  })
  it('서버 오류 코드는 종전 exit 규칙 그대로(403 → 5, 409 conflict → 4)', () => {
    expect(run(['heartbeat', ORDER, '--agent', 'hong/mbp/lead', '--clear-merge-conflict'], '403', '{"code":"not_claim_owner"}').status).toBe(5)
    expect(run(['heartbeat', ORDER, '--agent', 'hong/mbp/lead', '--phase', 'merge_conflict', '--note', 'x'], '409', '{"code":"conflict"}').status).toBe(4)
  })
  it('계약 버전은 2.7, usage 에 --clear-merge-conflict 가 있다', () => {
    const src = readFileSync(DFLOW, 'utf8')
    expect(src).toMatch(/^CONTRACT_VERSION=2\.7$/m)
    expect(src).toContain('--clear-merge-conflict')
    const doc = readFileSync(join(process.cwd(), '.claude/skills/dflow-work/references/api-contract.md'), 'utf8')
    expect(doc).toContain('# D\'Flow Agent API 계약 v2.7')
    expect(doc).toContain('## v2.7 변경점')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/skills/dflow-heartbeat-merge-conflict.test.ts`
Expected: FAIL. `--clear-merge-conflict` 는 usage(exit 2)로 떨어지고, 설정 출력은 `null` 이며, 버전은 2.5 다.

- [ ] **Step 3: 구현한다**

`.claude/skills/dflow-work/scripts/dflow.sh`:
- 원문 `CONTRACT_VERSION=2.5` →
```sh
# 2.7: 팀장 머지 충돌 표시(heartbeat --clear-merge-conflict). 병행 과제 C 가 2.6 — 머지 순서에 따라 조정한다.
CONTRACT_VERSION=2.7
```
- usage 의 원문 두 줄
```
  heartbeat <ref> [--phase p] [--note "<질문>"] [--agent id] [--model m]
                         진행 중 신호(보고 행 없음). --agent 기본값은 워크트리 루트 .dflow-agent 첫 줄
```
→
```
  heartbeat <ref> [--phase p] [--note "<질문>"] [--agent id] [--model m] [--clear-merge-conflict]
                         진행 중 신호(보고 행 없음). --agent 기본값은 워크트리 루트 .dflow-agent 첫 줄
                         팀장 전용: reported·approved 주문에 --phase merge_conflict --note 로 머지 충돌 표시,
                         --clear-merge-conflict 로 해제(출력 MERGE_CONFLICT_SET·CLEARED·ABSENT)
```
- `cmd_heartbeat` 를 바꾼다. 원문
```sh
  _phase=''; _note=''; _agent=''; _model=''
```
→
```sh
  _phase=''; _note=''; _agent=''; _model=''; _clear=''
```
원문
```sh
      --model) _model="${2:-}"; shift 2 || usage ;;
```
바로 아래에 더한다.
```sh
      --clear-merge-conflict) _clear=1; shift ;;
```
원문
```sh
  [ -n "$_agent" ] || _agent=$(agent_id_default)
```
바로 **위**에 더한다.
```sh
  # 해제는 phase 와 함께 보내지 않는다 — 서버도 400 으로 거부한다(머지 충돌 설계 2026-09-23 §7.1).
  [ -z "$_clear" ] || [ -z "$_phase" ] || usage
```
원문
```sh
  _json=$(jq -nc --arg a "$_agent" --arg p "$_phase" --arg n "$_note" --arg m "$_model" \
    '{agent:$a} + (if $p != "" then {phase:$p} else {} end) + (if $n != "" then {note:$n} else {} end)
     + (if $m != "" then {model:$m} else {} end)')
  _body=$(TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/heartbeat" "$_json") || exit $?
  printf '%s' "$_body" | jq -r '.last_heartbeat_at'
```
→
```sh
  _json=$(jq -nc --arg a "$_agent" --arg p "$_phase" --arg n "$_note" --arg m "$_model" --arg c "$_clear" \
    '{agent:$a} + (if $p != "" then {phase:$p} else {} end) + (if $n != "" then {note:$n} else {} end)
     + (if $m != "" then {model:$m} else {} end) + (if $c != "" then {clear:"merge_conflict"} else {} end)')
  _body=$(TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/heartbeat" "$_json") || exit $?
  # 워커 갈래는 last_heartbeat_at, 팀장 표시 갈래는 phase·cleared 를 돌려준다(계약 2.7).
  printf '%s' "$_body" | jq -r 'if .last_heartbeat_at then .last_heartbeat_at
    elif .phase == "merge_conflict" then "MERGE_CONFLICT_SET"
    elif .cleared == true then "MERGE_CONFLICT_CLEARED" else "MERGE_CONFLICT_ABSENT" end'
```

`.claude/skills/dflow-work/references/api-contract.md`:
- 원문 `# D'Flow Agent API 계약 v2.5` → `# D'Flow Agent API 계약 v2.7`
- 원문 `` `contract_version: "2.5"` — `` → `` `contract_version: "2.7"` — ``
- 같은 줄 끝의 원문 `v2.5는 팀장 lease 를 더했다.` → `v2.5는 팀장 lease 를 더했다. v2.7은 heartbeat 에 팀장의 머지 충돌 표시를 더했다(v2.6 은 병행 과제 C 몫 — 머지 순서에 따라 번호를 조정한다).`
- 원문 `## v2.5 변경점 (2026-09-23)` 바로 **위**에 절을 더한다.
```markdown
## v2.7 변경점 (2026-09-23)

- `POST /api/v1/agent/work/{id}/heartbeat` 에 팀장 대리 표시 갈래(머지 충돌 설계 §7.2). **PAT 전용**(레거시 400 `identity_required`), 소유 판정은 워커와 같다(`claimed_by_user_id`).
  - 주문 `reported`·`approved` 에 `{agent, phase:"merge_conflict", note}`(note 필수) → 200 `{ok, phase:"merge_conflict"}`. `heartbeat_phase`·`heartbeat_note` 두 열만 쓴다 — `updated_at`·`last_heartbeat_at`·`heartbeat_agent`·재개 요청 열은 그대로다.
  - `{agent, clear:"merge_conflict"}` → 200 `{ok, phase:null, cleared}`. 현재 값이 `merge_conflict` 일 때만 지운다(`cleared:false` 는 지울 것이 없었다는 뜻).
  - `claimed` 주문에 `merge_conflict` 는 400, 그 밖의 상태는 409 `conflict`, 중단은 409 `cancelled`. 워커 phase 는 종전대로 `claimed` 에서만 받는다.
- CLI: `dflow.sh heartbeat <order> --agent <신원>/<host>/lead --phase merge_conflict --note "<…>"`(출력 `MERGE_CONFLICT_SET`), `--clear-merge-conflict`(출력 `MERGE_CONFLICT_CLEARED`·`MERGE_CONFLICT_ABSENT`).
```
- 원문 `응답의 \`contract_version\`은 \`src/lib/agent/externalApi.ts\`의 \`AGENT_CONTRACT_VERSION\` 상수 값이다 — 현재 \`"2.5"\`.` 안의 `"2.5"` → `"2.7"`
- `/me` 예시 JSON 의 원문 `"contract_version": "2.5",` → `"contract_version": "2.7",`

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/skills/dflow-heartbeat-merge-conflict.test.ts tests/skills/dflow-exit-cancelled.test.ts tests/skills/dflow-key-select.test.ts tests/skills/dflow-lead-lease.test.ts tests/skills/dflow-team-kit.test.ts tests/skills/shell-syntax.test.ts`
Expected: PASS. doctor 는 major 만 비교하므로 2.7 이 2.x 서버와 맞는다.

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-work/scripts/dflow.sh .claude/skills/dflow-work/references/api-contract.md tests/skills/dflow-heartbeat-merge-conflict.test.ts
git commit -m "feat(dflow-work): 팀장이 머지 충돌 표시를 설정·해제하는 heartbeat 옵션" -m "해소 워커는 서버를 부르지 않으므로 좌석 표시는 팀장이 대리로 쏜다. 출력은 설정·해제·해당 없음 세 값으로 갈라 팀장이 결과를 읽게 한다. 계약 2.7(과제 C 2.6 과 머지 순서로 조정)." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA"
```

---

### Task 5: 공용 판정 — `pred-reflected.sh` 와 워커 행 G

**Files:**
- Create: `.claude/skills/dflow-dev/scripts/pred-reflected.sh`
- Modify: `.claude/skills/dflow-dev/SKILL.md` (「--worker」 행 G 의 **기본 브랜치 반영 확인** 문단)
- Test: `tests/skills/dflow-pred-reflected.test.ts`(신규), `tests/skills/dflow-row-g-evidence.test.ts`

**Interfaces:**
- Produces: `pred-reflected.sh <TASKS> <선행TSK> <DEV_BRANCH>`. cwd 는 리포(워크트리) 루트이며, 호출하기 **전에** `git fetch origin` 을 한다.
  - `REFLECTED <1|2|3>` / exit 0: `phase=merged` 이고 세 증거 중 하나가 참이다(1 head_sha 조상, 2 트레일러, 3 머지 커밋 제목).
  - `NOT_REFLECTED <no-state|phase=<값>|no-evidence>` / exit 1
  - `UNKNOWN <usage|no-jq|no-dev-branch origin/<DEV>|bad-state-json|git-log>` / exit 2

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/skills/dflow-pred-reflected.test.ts`:

```ts
// tests/skills/dflow-pred-reflected.test.ts
// 행 G 반영 확인의 공용 스크립트(2026-09-23 머지 충돌 §6.2). 임시 git 저장소 + bare origin 에서 실제로 돈다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const SCRIPT = join(ROOT, '.claude/skills/dflow-dev/scripts/pred-reflected.sh')
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}
function sh(cwd: string, script: string) {
  const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', env: GIT_ENV })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
function judge(tsk: string, dev = 'main') {
  const r = spawnSync('sh', [SCRIPT, 'docs/tasks', tsk, dev], { cwd: repo, encoding: 'utf8', env: GIT_ENV })
  return { code: r.status, out: (r.stdout || '').trim() }
}
/** state.json 을 main 에 커밋하고 push 한다. */
const state = (tsk: string, json: Record<string, unknown>) =>
  `mkdir -p docs/tasks/${tsk} && printf '%s' '${JSON.stringify(json)}' > docs/tasks/${tsk}/state.json && git add docs && git commit -qm "chore(${tsk}): state" && git push -q origin main`
/** agent 브랜치를 --no-ff 로 머지한다(제목은 인자 그대로). */
const mergeAs = (title: string, br: string) =>
  `git switch -q -c ${br} && printf '%s\\n' ${br} > ${br.replace('/', '-')}.txt && git add . && git commit -qm feat && git switch -q main && git merge -q --no-ff ${br} -m "${title}" && git push -q origin main`

let tmp: string, repo: string
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-predref-')))
  repo = join(tmp, 'repo')
  const r = sh(tmp, `
    git init -q --bare -b main origin.git
    git clone -q origin.git repo 2>/dev/null
    cd repo && git checkout -q -b main
    printf 'x\\n' > a.txt && git add a.txt && git commit -qm init && git push -q origin main
  `)
  expect(r.code, r.out).toBe(0)
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('pred-reflected.sh', () => {
  it('state.json 이 없으면 NOT_REFLECTED no-state(1)', () => {
    expect(judge('TSK-03-02')).toEqual({ code: 1, out: 'NOT_REFLECTED no-state' })
  })
  it('phase 가 merged 가 아니면 NOT_REFLECTED(1)', () => {
    expect(sh(repo, state('TSK-03-02', { tsk: 'TSK-03-02', order: 'o-2', phase: 'reported' })).code).toBe(0)
    expect(judge('TSK-03-02')).toEqual({ code: 1, out: 'NOT_REFLECTED phase=reported' })
  })
  it('phase=merged + 머지 커밋 제목 → REFLECTED 3(0)', () => {
    expect(sh(repo, `${mergeAs('merge: TSK-03-02 기능 (approved)', 'agent/t2')} && ${state('TSK-03-02', { tsk: 'TSK-03-02', order: 'o-2', phase: 'merged' })}`).code).toBe(0)
    expect(judge('TSK-03-02')).toEqual({ code: 0, out: 'REFLECTED 3' })
  })
  it('head_sha 가 개발 브랜치의 조상이면 REFLECTED 1 — 가장 강한 증거가 먼저', () => {
    const head = sh(repo, 'git rev-parse HEAD').out.trim()
    expect(sh(repo, state('TSK-03-02', { tsk: 'TSK-03-02', order: 'o-2', phase: 'merged', head_sha: head })).code).toBe(0)
    expect(judge('TSK-03-02')).toEqual({ code: 0, out: 'REFLECTED 1' })
  })
  it('DFlow-Order 트레일러 → REFLECTED 2', () => {
    expect(sh(repo, `printf 'y\\n' > t.txt && git add t.txt && git commit -qm "feat: x" -m "DFlow-Order: o-2" && ${state('TSK-03-02', { tsk: 'TSK-03-02', order: 'o-2', phase: 'merged' })}`).code).toBe(0)
    expect(judge('TSK-03-02')).toEqual({ code: 0, out: 'REFLECTED 2' })
  })
  it('TSK-03-1 은 TSK-03-10 머지 제목에 걸리지 않는다', () => {
    expect(sh(repo, `${mergeAs('merge: TSK-03-10 다른 기능 (approved)', 'agent/t10')} && ${state('TSK-03-1', { tsk: 'TSK-03-1', order: 'o-1', phase: 'merged' })}`).code).toBe(0)
    expect(judge('TSK-03-1')).toEqual({ code: 1, out: 'NOT_REFLECTED no-evidence' })
  })
  it('merged 인데 증거가 하나도 없으면 NOT_REFLECTED no-evidence(1) — phase 한 줄만으로는 믿지 않는다', () => {
    expect(sh(repo, state('TSK-03-02', { tsk: 'TSK-03-02', order: 'o-2', phase: 'merged' })).code).toBe(0)
    expect(judge('TSK-03-02')).toEqual({ code: 1, out: 'NOT_REFLECTED no-evidence' })
  })
  it('개발 브랜치가 origin 에 없으면 UNKNOWN(2) — 반영 안 됨으로 단정하지 않는다', () => {
    expect(judge('TSK-03-02', 'develop')).toEqual({ code: 2, out: 'UNKNOWN no-dev-branch origin/develop' })
  })
  it('인자가 셋이 아니면 UNKNOWN usage(2)', () => {
    const r = spawnSync('sh', [SCRIPT, 'docs/tasks'], { cwd: repo, encoding: 'utf8', env: GIT_ENV })
    expect(r.status).toBe(2)
    expect(r.stdout.trim()).toBe('UNKNOWN usage')
  })
  it('POSIX sh 스크립트다(#!/bin/sh, set -u)', () => {
    const src = readFileSync(SCRIPT, 'utf8')
    expect(src.startsWith('#!/bin/sh\n')).toBe(true)
    expect(src).toContain('set -u')
  })
})
```

`tests/skills/dflow-row-g-evidence.test.ts` 의 첫 describe 안 마지막 it 뒤에 붙인다.

```ts
  it('워커는 반영 확인을 공용 스크립트 한 줄로 실행한다(팀장 사전 필터와 같은 판정, 2026-09-23)', () => {
    expect(dev).toContain('.claude/skills/dflow-dev/scripts/pred-reflected.sh <TASKS> <선행TSK> <기본브랜치>')
    expect(dev).toContain('`REFLECTED` 면 반영이 확인된 것이다')
    expect(dev).toContain('`NOT_REFLECTED`·`UNKNOWN` 은 모두 `skipped 선행 승인 대기` 다')
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/skills/dflow-pred-reflected.test.ts tests/skills/dflow-row-g-evidence.test.ts`
Expected: FAIL. 스크립트 파일이 없고(`sh` 가 127·2 로 끝난다), 문구도 없다.

- [ ] **Step 3: 스크립트를 쓴다**

`.claude/skills/dflow-dev/scripts/pred-reflected.sh`(실행 권한 `chmod +x`):

```sh
#!/bin/sh
# /dflow-dev 「--worker」 행 G 의 기본 브랜치 반영 확인 — 워커와 /dflow-team 팀장(선행 반영 사전 검사)이 함께 쓴다.
# 판정 = state.json phase=merged AND (증거 1 head_sha 조상 | 증거 2 DFlow-Order 트레일러 | 증거 3 머지 커밋 제목).
# 설명·이유의 정본은 dflow-dev/SKILL.md 행 G 이고, 이 스크립트는 그 실행체다.
# 사용: pred-reflected.sh <TASKS> <선행TSK> <DEV_BRANCH>   cwd = 리포(워크트리) 루트. 부르기 전에 git fetch origin 을 한다.
#   <TASKS> 는 선행 Task 폴더의 부모(예 docs/tasks). 이 스크립트는 fetch 하지 않는다 — 한 기상에 여러 번 부르기 때문이다.
# 출력 첫 낱말: REFLECTED <1|2|3>(exit 0) · NOT_REFLECTED <사유>(exit 1) · UNKNOWN <사유>(exit 2)
# UNKNOWN 은 판정 불가다. 호출자는 그것을 "반영 안 됨" 으로 단정하지 않는다(팀장은 거르지 않고 워커에 맡긴다).
set -u

[ $# -eq 3 ] && [ -n "$1" ] && [ -n "$2" ] && [ -n "$3" ] || { echo "UNKNOWN usage"; exit 2; }
tasks=${1%/}; tsk=$2; dev=$3
command -v jq >/dev/null 2>&1 || { echo "UNKNOWN no-jq"; exit 2; }
git rev-parse --verify -q "refs/remotes/origin/$dev" >/dev/null 2>&1 || { echo "UNKNOWN no-dev-branch origin/$dev"; exit 2; }

st=$(git show "origin/$dev:$tasks/$tsk/state.json" 2>/dev/null) || { echo "NOT_REFLECTED no-state"; exit 1; }
phase=$(printf '%s' "$st" | jq -r '.phase // ""' 2>/dev/null) || { echo "UNKNOWN bad-state-json"; exit 2; }
[ "$phase" = merged ] || { echo "NOT_REFLECTED phase=${phase:-none}"; exit 1; }
order=$(printf '%s' "$st" | jq -r '.order // ""')
head=$(printf '%s' "$st" | jq -r '.head_sha // ""')

# 증거 1 — 커밋 그래프의 조상 관계. head_sha 가 없으면 판정 불가로 건너뛴다.
if [ -n "$head" ] && git merge-base --is-ancestor "$head" "origin/$dev" 2>/dev/null; then
  echo "REFLECTED 1"; exit 0
fi
# 증거 2 — 트레일러. 콜론 뒤 공백을 반드시 넣는다(실제 트레일러가 "DFlow-Order: <uuid>").
if [ -n "$order" ]; then
  hit=$(git log "origin/$dev" --grep="DFlow-Order: $order" --format=%h 2>/dev/null) || { echo "UNKNOWN git-log"; exit 2; }
  [ -z "$hit" ] || { echo "REFLECTED 2"; exit 0; }
fi
# 증거 3 — 머지 커밋 제목. TSK 뒤 공백까지 넣는다(TSK-03-1 이 TSK-03-10 을 집지 않게).
hit=$(git log "origin/$dev" --merges --grep="^merge: $tsk " --format=%h 2>/dev/null) || { echo "UNKNOWN git-log"; exit 2; }
[ -z "$hit" ] || { echo "REFLECTED 3"; exit 0; }
echo "NOT_REFLECTED no-evidence"; exit 1
```

- [ ] **Step 4: 행 G 문단을 스크립트 호출로 바꾼다**

`.claude/skills/dflow-dev/SKILL.md` 의 원문 한 줄
`줄마다 단독으로 실행해 출력을 읽는다(git 을 감싼 명령 치환은 워커 git 호출 규칙이 금지한다).`
→
````markdown
**실행은 공용 스크립트 한 줄이다**(팀장의 선행 반영 사전 검사와 같은 판정, 2026-09-23). `git fetch origin` 을 먼저
단독으로 실행한 뒤 부른다.
```bash
.claude/skills/dflow-dev/scripts/pred-reflected.sh <TASKS> <선행TSK> <기본브랜치>
```
`<TASKS>` 는 선행 Task 폴더의 부모다(이 리포에서는 `docs/tasks`, 작업 폴더가 `{TASK_DIR}` 로 주어지는 판에서는 그 부모).
출력 첫 낱말이 `REFLECTED` 면 반영이 확인된 것이다. `NOT_REFLECTED`·`UNKNOWN` 은 모두 `skipped 선행 승인 대기` 다
(지금 동작과 같다). 아래 블록은 스크립트가 하는 일의 설명이며 워커가 직접 치지 않는다. 스크립트 안에서 git 을
부르는 것은 `deps.sh` 와 같은 방식이며, 워커 git 호출 규칙(명령 치환 금지)은 워커가 직접 치는 Bash 줄에 대한 것이다.
````
원문의 세 증거 블록과 그 뒤 설명은 그대로 둔다. `dflow-row-g-evidence.test.ts` 의 기존 문자열 검사는 그대로 통과해야 한다.

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run tests/skills/dflow-pred-reflected.test.ts tests/skills/dflow-row-g-evidence.test.ts tests/skills/dflow-dev-worker.test.ts tests/skills/dflow-team-shell-blocks.test.ts tests/skills/shell-syntax.test.ts`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
chmod +x .claude/skills/dflow-dev/scripts/pred-reflected.sh
git add .claude/skills/dflow-dev/scripts/pred-reflected.sh .claude/skills/dflow-dev/SKILL.md tests/skills/dflow-pred-reflected.test.ts tests/skills/dflow-row-g-evidence.test.ts
git commit -m "feat(dflow-dev): 선행 반영 확인을 공용 스크립트로 뽑는다" -m "팀장이 후속을 띄우기 전에 워커 행 G 와 같은 판정으로 선행 미반영을 거르려면 두 쪽이 한 실행체를 써야 한다. 판정 불가는 UNKNOWN 으로 따로 내 미반영으로 단정하지 않게 한다." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA"
```

---
### Task 6: `/dflow-merge` — 충돌 파일 목록과 「해소 머지(`--resolve`)」 절

**Files:**
- Modify: `.claude/skills/dflow-merge/SKILL.md` (`--on-report` 문단 뒤에 한 문단, 4단계 3번 충돌 문장, 6번 보고, `## 금지` 앞에 새 절)
- Test: `tests/skills/dflow-merge-resolve.test.ts`(신규)

**Interfaces:**
- Consumes: Task 7 의 `resolve-prompt.md` 절 이름 「해소 규약」·「게이트」(이름만 쓴다. 두 Task 는 병렬로 해도 된다)
- Produces:
  - 수동 경로와 스윕의 충돌 보고: `"머지 실패(충돌)"` 뒤에 충돌 파일 목록 `<파일,…>`
  - `/dflow-merge --resolve <ref> --attempt <n> [--on-report]`. 마지막 출력 줄 하나가 호출자(해소 워커)에게 넘기는 결과다.
    - `RESOLVE_PUSHED <머지 커밋 짧은 sha> base=<기준 짧은 sha> files=<충돌 파일 수> rules=<R번호,…|-> tests=<통과/총수>`
    - `RESOLVE_SKIPPED <2단계 보고 문구>`
    - `RESOLVE_NOT_DETACHED`
    - `RESOLVE_BASE_MOVED <새 origin 짧은 sha>`
    - `RESOLVE_BLOCKED <질문 한 줄>`
    - `RESOLVE_GATE_FAILED <신규 실패 수>`
    - `RESOLVE_PUSH_HOOK` · `RESOLVE_PUSH_FAILED <exit>`
    - push 경합은 `RESOLVE_BASE_MOVED` 로 돌려준다. 재시도 횟수(합쳐 2회)는 호출자가 세고, 넘으면 호출자가 `failed push-race` 로 끝낸다

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/skills/dflow-merge-resolve.test.ts`:

```ts
// tests/skills/dflow-merge-resolve.test.ts
// 머지 충돌 해소(2026-09-23 §5.1) — /dflow-merge 의 충돌 파일 보고와 숨은 플래그 --resolve.
// 문서 문자열 + 임시 git 저장소(가짜 origin)에서 해소 머지의 전제(E4·rerere)를 실제로 돌린다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const MERGE = readFileSync(join(ROOT, '.claude/skills/dflow-merge/SKILL.md'), 'utf8')
const section = (from: string, to: string) => {
  const a = MERGE.indexOf(from); const b = MERGE.indexOf(to, a + 1)
  if (a < 0 || b < 0) throw new Error(`절을 찾지 못했다: ${from}`)
  return MERGE.slice(a, b)
}

describe('/dflow-merge 문서 — 충돌 파일 목록과 --resolve', () => {
  it('--resolve 는 description 사용법에 노출하지 않는다(--on-report 와 같은 취급)', () => {
    const desc = MERGE.split('\n').find(l => l.startsWith('description:')) ?? ''
    expect(desc).not.toContain('--resolve')
    expect(MERGE).toContain('**`--resolve <ref>`(팀장이 띄운 해소 워커 전용)**')
  })
  it('스윕의 충돌 처리: --diff-filter=U 로 파일 목록을 --abort 전에 읽는다', () => {
    const step3 = section('   3. `git merge --no-ff <머지 대상>`.', '   4. state.json 을 `phase=merged` 로')
    expect(step3).toContain('git diff --name-only --diff-filter=U')
    // 코드 블록에서 목록 명령이 --abort 바로 앞 줄이다(뒤에서는 목록이 비어 있다)
    expect(step3).toMatch(/--diff-filter=U[^\n]*\n\s*git merge --abort/)
    expect(step3).toContain('"머지 실패(충돌)"')
    expect(MERGE).toContain('머지 실패(충돌) <파일,…>')
  })
  it('해소 머지 절: 머지 자리는 호출한 워크트리, rerere 는 -c 로만, 트레일러 둘, push 경합 재시도 2회', () => {
    const r = section('## 해소 머지(`--resolve`)', '## 금지')
    expect(r).toContain('머지 자리는 **호출한 워크트리 자신**')
    expect(r).toContain('RESOLVE_NOT_DETACHED')
    expect(r).toContain('RESOLVE_BASE_MOVED')
    expect(r).toContain('git -c rerere.enabled=true merge --no-ff --no-commit <머지 대상>')
    expect(r).toContain('git -c rerere.enabled=true commit')
    expect(r).toContain('--trailer "DFlow-Order: <order>" --trailer "DFlow-Resolve: <n>/3"')
    expect(r).toContain('git push origin HEAD:<기본브랜치>')
    expect(r).toContain('한 세션 안에서 2회까지')
    expect(r).toContain('`dflow-team/references/resolve-prompt.md` 「해소 규약」')
    expect(r).toContain('`dflow-team/references/resolve-prompt.md` 「게이트」')
    expect(r).not.toContain('git config rerere')
  })
  it('금지: --resolve 에서도 agent 브랜치 수정·force push·훅 우회는 금지다', () => {
    const ban = MERGE.slice(MERGE.indexOf('## 금지'))
    expect(ban).toContain('`--resolve` 의 agent 브랜치 수정·rebase')
  })
})

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}
function sh(cwd: string, script: string) {
  const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', env: GIT_ENV })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
let tmp: string, repo: string
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-resolve-')))
  repo = join(tmp, 'repo')
  const r = sh(tmp, `
    git init -q --bare -b main origin.git
    git clone -q origin.git repo 2>/dev/null
    cd repo && git checkout -q -b main
    printf 'base\\n' > f.txt && git add f.txt && git commit -qm init && git push -q origin main
    git switch -q -c agent/aaaaaaaa-x && printf 'agent\\n' > f.txt && git commit -qam feat && git push -q origin agent/aaaaaaaa-x
    git rev-parse HEAD > ../head_sha
    git switch -q main && printf 'main\\n' > f.txt && git commit -qam other && git push -q origin main
    git rev-parse HEAD > ../base_sha
    git switch -q --detach origin/main
  `)
  expect(r.code, r.out).toBe(0)
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('해소 머지의 git 전제 — 임시 저장소', () => {
  it('충돌 파일 목록 명령이 충돌한 파일을 낸다(--abort 전)', () => {
    const r = sh(repo, 'git merge --no-ff origin/agent/aaaaaaaa-x >/dev/null 2>&1; git diff --name-only --diff-filter=U; git merge --abort')
    expect(r.out.trim()).toBe('f.txt')
  })
  it('개발 브랜치 위 머지 커밋에서 풀면 agent 브랜치는 그대로라 2단계 승인 뒤 변경 확인이 통과한다(E4)', () => {
    const r = sh(repo, `
      git -c rerere.enabled=true merge --no-ff --no-commit origin/agent/aaaaaaaa-x >/dev/null 2>&1
      printf 'main\\nagent\\n' > f.txt && git add f.txt
      git -c rerere.enabled=true commit -q -m "merge: TSK-01-01 x (approved) — 충돌 해소" --trailer "DFlow-Order: o-1" --trailer "DFlow-Resolve: 1/3"
      git log -1 --format=%B | grep -c 'DFlow-Resolve: 1/3'
      h=$(cat ../head_sha)
      git merge-base --is-ancestor "$h" origin/agent/aaaaaaaa-x && echo ANCESTOR_OK
      printf 'diff=[%s]\\n' "$(git diff --name-only "$h"..origin/agent/aaaaaaaa-x)"
    `)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('1\n')
    expect(r.out).toContain('ANCESTOR_OK')
    expect(r.out).toContain('diff=[]')
  })
  it('rerere 가 push 경합 뒤 재머지에서 앞서 푼 덩어리를 되살린다(commit 에도 -c 가 붙어야 기록된다)', () => {
    const r = sh(repo, `
      git -c rerere.enabled=true merge --no-ff --no-commit origin/agent/aaaaaaaa-x >/dev/null 2>&1
      printf 'main\\nagent\\n' > f.txt && git add f.txt
      git -c rerere.enabled=true commit -q -m "merge: TSK-01-01 x" --trailer "DFlow-Order: o-1"
      git reset -q --keep "$(cat ../base_sha)"
      git -c rerere.enabled=true merge --no-ff --no-commit origin/agent/aaaaaaaa-x >/dev/null 2>&1
      grep -c '<<<<<<<' f.txt || true
      cat f.txt
    `)
    expect(r.out).toContain('0\nmain\nagent')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/skills/dflow-merge-resolve.test.ts`
Expected: 문서 describe 넷은 FAIL(문구 없음). git describe 셋은 PASS다. 셋은 git 의 동작을 고정하는 시험이며, 문서가 기대는 전제가 실제로 성립함을 보인다.

- [ ] **Step 3: 문서를 고친다**

`.claude/skills/dflow-merge/SKILL.md`:

(a) 원문 `확인한다는 팀장 설계와 어긋난다. 플래그가 없으면 종전대로 approved 만 머지한다.` 바로 아래에 빈 줄과 한 문단을 더한다.
```markdown

**`--resolve <ref>`(팀장이 띄운 해소 워커 전용)**: `/dflow-team` 팀장이 머지 충돌을 풀라고 띄운 해소 워커만 쓴다.
사람이 직접 쓰지 않으며 description 의 사용법에 노출하지 않는다. ref 는 정확히 하나이고 `--attempt <n>`(1~3)이 함께
온다. `--on-report` 가 함께 오면 그 판정도 그대로다. 절차는 아래 「해소 머지(`--resolve`)」 절이다. 플래그 없는 수동
사용과 팀장 스윕은 충돌 파일 목록을 보고하는 것만 바뀌고 여전히 `--abort` 한다(2026-09-23 머지 충돌 설계 §5.1).
```

(b) 원문 `   3. \`git merge --no-ff <머지 대상>\`. 충돌하면 \`git merge --abort\` 로 되돌리고 "머지 실패(충돌)" 로`
→ `   3. \`git merge --no-ff <머지 대상>\`. 충돌하면 먼저 충돌 파일 목록을 읽은 뒤 \`git merge --abort\` 로 되돌리고 "머지 실패(충돌)" 로`
원문 `      이유가 되지 않는다.`(3번 문단의 끝 줄) 바로 아래에 더한다.
````markdown
      충돌 파일 목록은 `--abort` **전에** 읽는다(뒤에는 비어 있다). 보고 줄은 `머지 실패(충돌) <파일,…>` 다.
      임시 머지 워크트리에서는 두 명령 모두 `git -C "$W"` 로 부른다.
      ```bash
      git diff --name-only --diff-filter=U | paste -sd, -   # 충돌 파일 목록(쉼표로 이음)
      git merge --abort
      ```
````

(c) 6번 보고의 원문 `반려(머지됨): 되돌리기 또는 재작업 필요 (<review_note>, 그 위에 쌓였을 수 있는 작업) / 머지 실패(충돌) / push 실패(경합) /`
→ `반려(머지됨): 되돌리기 또는 재작업 필요 (<review_note>, 그 위에 쌓였을 수 있는 작업) / 머지 실패(충돌) <파일,…> / push 실패(경합) /`

(d) `## 금지` 바로 **위**에 새 절을 더한다.
````markdown
## 해소 머지(`--resolve`)

팀장이 띄운 해소 워커(`dflow-team/references/resolve-prompt.md`)만 이 절을 탄다. 목적은 충돌한 작업 한 건을
**개발 브랜치 위의 머지 커밋 안에서** 푸는 것이다. agent 브랜치는 건드리지 않는다. 건드리면 다음 스윕의 2단계
「승인 뒤 변경 확인」 이 그 작업을 "건너뜀(승인 뒤 변경)" 으로 내기 때문이다. rebase 도 하지 않는다. rebase 는
force push 금지와 `merge-base --is-ancestor <head_sha>` 검사에 모두 걸린다. 결과는 마지막 출력 줄 **하나**로 호출자에게
넘긴다(아래 「결과 줄」).

1. **후보·판정**: 1·2단계를 그대로 하되 후보는 인자 ref 하나뿐이다. 2단계가 머지 대상이 아니라고 판정하면(승인 대기·
   반려·이미 머지됨·조회 실패 등) 해소하지 않고 `RESOLVE_SKIPPED <그 보고 문구>` 로 끝난다. 3단계의 스택 판정에서
   선행이 개발 브랜치에 없으면 `RESOLVE_SKIPPED 건너뜀(기점 미반영)` 이다. 해소 워커는 선행까지 머지하지 않는다.
2. **머지 자리는 호출한 워크트리 자신**이다. 임시 머지 워크트리 `<ROOT>/.claude/worktrees/dflow-merge` 는 쓰지 않는다.
   팀장 스윕의 임시 워크트리와 경로가 겹치기 때문이다. 이 워크트리는 `origin/<기본브랜치>` 에 detach 돼 있어야 한다.
   ```bash
   git fetch origin
   git branch --show-current                  # 비어 있어야 한다(detached). 아니면 RESOLVE_NOT_DETACHED 로 멈춘다
   git rev-parse HEAD origin/<기본브랜치>      # 두 줄이 같아야 한다. 다르면 RESOLVE_BASE_MOVED <origin 짧은 sha> 로 멈춘다
   ```
   `RESOLVE_BASE_MOVED` 는 실패가 아니다. 호출자가 새 `origin/<기본브랜치>` 로 다시 detach 하고 기준선을 다시 잰 뒤
   이 절을 다시 부른다. 기준선과 머지 기점이 어긋나면 게이트가 개발 브랜치의 새 실패를 해소 탓으로 돌리거나, 그
   반대가 되기 때문이다. 이때 `git rev-parse HEAD` 를 **기준 HEAD** 로 기록한다.
3. **승인 뒤 변경 확인**: 4단계 2번 그대로다. 걸리면 `RESOLVE_SKIPPED 건너뜀(승인 뒤 변경)` 또는
   `RESOLVE_SKIPPED 건너뜀(승인 뒤 변경 확인 불가)` 로 끝난다.
4. **머지**: 충돌 여부와 무관하게 늘 커밋 없이 머지한다. 그래야 `resolution.md` 와 트레일러 둘이 한 커밋에 실린다.
   rerere 는 명령줄 `-c` 로만 켠다. `git config` 로 켜지 않는 이유: 워크트리의 `git config` 는 공용 `.git/config` 에
   써져 사람 체크아웃까지 바뀐다. rerere 기록(`rr-cache`)은 공용 디렉터리에 남으므로, push 경합 뒤 재머지와 다음
   시도가 같은 해소를 다시 쓴다. 기록은 커밋 때 남으므로 `commit` 에도 `-c` 를 붙인다.
   ```bash
   git -c rerere.enabled=true merge --no-ff --no-commit <머지 대상>
   git diff --name-only --diff-filter=U        # 충돌 파일 목록. 비었으면 텍스트 충돌은 없다(files=0)
   ```
   - 충돌 파일마다 `dflow-team/references/resolve-prompt.md` 「해소 규약」 의 R1~R8 로 푼다. 그 규약의 「blocked 로
     멈추는 경우」 에 걸리면 머지를 워크트리에 멈춘 채 두고 `RESOLVE_BLOCKED <질문과 선택지 한 줄>` 로 끝난다
     (`--abort` 하지 않는다. 사람이 답하면 그 자리에서 이어 간다).
   - 해소 기록 `<TASKS>/<TSK>/resolution.md` 에 `## 시도 <n>` 절을 덧붙인다. 파일마다 적용한 규약 번호와 판단을
     한 줄씩 적는다. `<TASKS>/<TSK>` 는 호출자가 넘긴 작업 폴더다.
   - 푼 파일과 `resolution.md` 를 파일명으로 stage 한 뒤 커밋한다. 둘째 `-m` 은 요약(충돌 파일 수·규약 번호)이다.
   ```bash
   git -c rerere.enabled=true commit -m "merge: <TSK> <제목> (approved) — 충돌 해소" -m "충돌 <N>개 · 규약 <R…>" \
     --trailer "DFlow-Order: <order>" --trailer "DFlow-Resolve: <n>/3"
   ```
   승인 전 머지(`--on-report`)면 제목 괄호는 `(reported, 승인 전)` 이다. `<n>` 은 `--attempt` 값이다. 트레일러
   `DFlow-Order` 는 「트레일러 고정」 과 같은 이유로 빠뜨리지 않는다(행 G 증거 2).
5. **게이트**: 머지 커밋 **직후, state.json 커밋 전에** 한 번 돈다. 충돌이 없었어도 돈다. 의미 충돌은 텍스트 충돌
   없이 오기 때문이다(2026-09-21 가드 Task: 텍스트 충돌 한 줄에 시험 85건이 401). 판정은
   `dflow-team/references/resolve-prompt.md` 「게이트」 이며, 기준선은 호출자가 기준 HEAD 에서 잰 것이다. 통과하지
   못하면 `git reset --keep <기준 HEAD>` 로 버리고 `RESOLVE_GATE_FAILED <신규 실패 수>` 로 끝난다.
6. **state.json**: 4단계 4번 그대로 `phase=merged`(승인 전이면 `unapproved: true` 도) 커밋을 만든다. 이 커밋과 머지
   커밋 사이에 게이트를 다시 돌지 않는다.
7. **push**: `git push origin HEAD:<기본브랜치>`. 실패하면 먼저 `git reset --keep <기준 HEAD>` 로 되돌리고 모양으로
   가른다.
   - `non-fast-forward`·`fetch first` 면 경합이다. `git fetch origin && git switch -q --detach origin/<기본브랜치>`
     뒤 `RESOLVE_BASE_MOVED <새 origin 짧은 sha>` 로 끝난다. 호출자가 기준선을 다시 재고 이 절을 1번부터 다시 부른다.
     rerere 가 앞서 푼 덩어리를 되살린다. 기준 이동과 합친 **이 재시도는 한 세션 안에서 2회까지**이며 호출자가 센다.
     넘으면 호출자가 `failed push-race` 로 끝낸다.
   - 그런 문구 없이 1 로 끝나면 훅 거부다. 우회하지 않고 `RESOLVE_PUSH_HOOK` 으로 끝난다.
   - 그 밖의 실패는 `RESOLVE_PUSH_FAILED <exit>` 다.
8. **뒷정리**: 5번 뒷정리 그대로다(원격 agent 브랜치 삭제, 로컬 브랜치의 not found·checked out 건너뛰기).
9. **결과 줄**: 성공하면
   `RESOLVE_PUSHED <머지 커밋 짧은 sha> base=<기준 HEAD 짧은 sha> files=<충돌 파일 수> rules=<R번호,…|-> tests=<통과/총수>`.
   머지 커밋 sha 는 `git rev-parse --short HEAD~1` 이다(HEAD 는 state.json 커밋).

`--resolve` 가 쓰는 파일은 호출한 워크트리 안뿐이다. 팀장 체크아웃은 건드리지 않으므로, 해소가 `RESOLVE_BLOCKED` 로
멈춰도 팀장의 전제 검사는 깨지지 않는다.
````

(e) `## 금지` 아래 원문 `- 머지 순서 뒤집기(후손 먼저).` 바로 아래에 더한다.
```markdown
- `--resolve` 의 agent 브랜치 수정·rebase, 시험 삭제·`skip`·기대값 완화로 게이트 통과. `--resolve` 도 force push·훅 우회
  금지는 같다.
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/skills/dflow-merge-resolve.test.ts tests/skills/dflow-merge-remote.test.ts tests/skills/dflow-row-g-evidence.test.ts tests/skills/dflow-team-shell-blocks.test.ts tests/skills/dflow-team.test.ts`
Expected: PASS. `dflow-merge-remote.test.ts` 의 원문 보존 검사도 통과한다(바꾼 줄은 fixture 에 없다). `CHANGED` 에는 아무것도 더하지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-merge/SKILL.md tests/skills/dflow-merge-resolve.test.ts
git commit -m "feat(dflow-merge): 충돌 파일을 보고하고 해소 워커용 --resolve 절을 둔다" -m "무인 실행에서 충돌은 아무도 풀지 않아 의존 사슬이 멈췄다. 해소는 agent 브랜치가 아니라 개발 브랜치 위 머지 커밋에서 해 승인 뒤 변경 확인을 깨지 않고, rerere 는 -c 로만 켜 사람 체크아웃 설정을 바꾸지 않는다." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA"
```

---
### Task 7: 해소 워커 — `resolve-prompt.md` 와 `resolve-decide.sh`

**Files:**
- Create: `.claude/skills/dflow-team/references/resolve-prompt.md`
- Create: `.claude/skills/dflow-team/scripts/resolve-decide.sh`
- Test: `tests/skills/dflow-team-resolve.test.ts`(신규)

**Interfaces:**
- Consumes: Task 6 의 `/dflow-merge --resolve <ref> --attempt <n> [--on-report]` 와 결과 줄 `RESOLVE_*`. Task 5 의 `deps.sh` 방식.
- Produces:
  - 포인터 키 `TSK ID8 ORDER AGENT_ID MAIN_CHECKOUT MODEL DEV_BRANCH TASK_DIR ATTEMPT ON_REPORT`
  - `.result` 한 줄 `{TSK} {ID8} - <머지 커밋 짧은 sha|-> - <status> <사유>`. status 는 `resolved`·`skipped`·`blocked`·`failed <첫 낱말>` 이다. 첫 낱말은 `gate`·`push-race`·`push-hook`·`push-other`·`not-detached`·`dirty-dev-state`·`deps`·`permission`·`rate-limit`·`no-skill`·`doctor-<exit>`·`auth`·`detach`·`no-dev-branch`·`not-isolated` 중 하나다.
  - `resolved` 의 사유는 `base=<짧은 sha> files=<n> rules=<R…|-> tests=<통과/총수>` 이다.
  - `resolve-decide.sh <EVENTS> <LEAD_AGENT> <REPO> <id8> <DEV_SHA>` 의 출력과 exit:
    - `RESOLVE <n>` / 0
    - `HUMAN <사유>` / 1
    - `UNKNOWN <사유>` / 2
    - `RUNNING` / 3

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/skills/dflow-team-resolve.test.ts`:

```ts
// tests/skills/dflow-team-resolve.test.ts
// 머지 충돌 해소 워커(2026-09-23 §5) — 프롬프트 문서, 재시도 판정 스크립트, 해소 워크트리에서의 heartbeat 훅.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const PROMPT = readFileSync(join(ROOT, '.claude/skills/dflow-team/references/resolve-prompt.md'), 'utf8')
const DECIDE = join(ROOT, '.claude/skills/dflow-team/scripts/resolve-decide.sh')
const HOOK = join(ROOT, 'kit/hooks/heartbeat.sh')

describe('resolve-prompt.md — 해소 워커 규칙', () => {
  it('포인터 키 표에 ORDER·TASK_DIR·ATTEMPT·ON_REPORT 가 있다', () => {
    for (const k of ['`ORDER`', '`TASK_DIR`', '`ATTEMPT`', '`ON_REPORT`', '`DEV_BRANCH`', '`AGENT_ID`']) expect(PROMPT).toContain(k)
  })
  it('해소 규약 R1~R8, blocked 기준, 금지, 게이트, 결과 줄 표가 있다', () => {
    for (const r of ['| R1 |', '| R2 |', '| R3 |', '| R4 |', '| R5 |', '| R6 |', '| R7 |', '| R8 |']) expect(PROMPT).toContain(r)
    expect(PROMPT).toContain('## 해소 규약')
    expect(PROMPT).toContain('### blocked 로 멈추는 경우')
    expect(PROMPT).toContain('## 게이트')
    expect(PROMPT).toContain('**기준선 대비 신규 실패 0 + 시험 총수가 기준선 이상**')
    expect(PROMPT).toContain('## 금지')
    for (const s of ['| `resolved` |', '| `skipped` |', '| `blocked` |', '| `failed <사유>` |']) expect(PROMPT).toContain(s)
  })
  it('서버에 쓰지 않는다 — blocked 직전 heartbeat 도 보내지 않는다(주문이 claimed 가 아니라 409)', () => {
    expect(PROMPT).toContain('`dflow.sh heartbeat --phase blocked` 를 **보내지 않는다**')
    expect(PROMPT).toContain('claim·progress·done·heartbeat 를 하지 않는다')
  })
  it('/dflow-merge --resolve 를 --attempt 와 함께 부르고, 기준 이동·push 경합 재시도는 합쳐 2회', () => {
    expect(PROMPT).toContain('/dflow-merge --resolve {ID8} --attempt {ATTEMPT}')
    expect(PROMPT).toContain('합쳐 **2회**까지')
  })
  it('격리·부트스트랩은 worker-prompt.md 「0」~「3」 을 따르고, 좌석 식별 전에 개발 브랜치 state 를 검사한다', () => {
    expect(PROMPT).toContain('`worker-prompt.md` 「0」·「1」')
    expect(PROMPT).toContain('`worker-prompt.md` 「2」')
    expect(PROMPT).toContain('`worker-prompt.md` 「3」')
    expect(PROMPT.indexOf('failed dirty-dev-state')).toBeLessThan(PROMPT.indexOf('`worker-prompt.md` 「2」'))
  })
  it('H(워커 자동 재시작)의 대상이 아니라고 적는다', () => {
    expect(PROMPT).toContain('워커 자동 재시작(H)의 대상이 아니다')
  })
})

// ---- resolve-decide.sh ------------------------------------------------------
const LEAD = 'hong/mbp/lead', REPO = '/r/main', ID8 = 'aaaaaaaa', DEV = 'abc1234def5678'
const ev = (event: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ts: 't', host: 'mbp', repo: REPO, tsk: 'TSK-01-01', order: 'o', phase: 'team', event, agent: LEAD, id8: ID8, ...extra })
const spawnResolve = () => ev('team.spawn', { slot: '2', worktree: '/w', handle: '-', spawn_kind: 'resolve' })
const result = (status: string, reason = '') => ev('team.result', { slot: '2', status, worktree: '/w', hash: 'h', reason })

let tmp: string
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'dflow-decide-')) })
afterEach(() => rmSync(tmp, { recursive: true, force: true }))
function decide(lines: string[] | null, dev = DEV) {
  const f = join(tmp, 'events.jsonl')
  if (lines) writeFileSync(f, lines.join('\n') + '\n')
  const r = spawnSync('sh', [DECIDE, f, LEAD, REPO, ID8, dev], { encoding: 'utf8' })
  return { code: r.status, out: (r.stdout || '').trim() }
}

describe('resolve-decide.sh — 해소 재시도 판정', () => {
  it('기록이 없으면 첫 시도', () => {
    expect(decide(null)).toEqual({ code: 0, out: 'RESOLVE 1' })
    expect(decide([ev('team.spawn', { slot: '1', worktree: '/x', handle: '-', spawn_kind: 'new' })])).toEqual({ code: 0, out: 'RESOLVE 1' })
  })
  it('카운터는 team.result 로 초기화되지 않는다 — resolve 2줄 + result 3줄 + resume 1줄이면 다음은 3번째', () => {
    expect(decide([
      result('done', '개발 완료'),
      ev('team.spawn', { slot: '1', worktree: '/x', handle: '-', spawn_kind: 'resume' }),
      spawnResolve(), result('failed push-race', 'push-race'),
      spawnResolve(), result('failed rate-limit', 'rate-limit'),
    ])).toEqual({ code: 0, out: 'RESOLVE 3' })
  })
  it('상한 3 — 세 번 띄웠으면 결과와 무관하게 사람 몫', () => {
    expect(decide([spawnResolve(), result('failed push-race'), spawnResolve(), result('failed push-race'), spawnResolve(), result('failed no-result')]))
      .toEqual({ code: 1, out: 'HUMAN 해소 상한(3/3)' })
  })
  it('마지막 해소 spawn 뒤 결과가 없거나 blocked 면 진행 중', () => {
    expect(decide([spawnResolve()])).toEqual({ code: 3, out: 'RUNNING' })
    expect(decide([spawnResolve(), ev('team.blocked', { slot: '2', worktree: '/w', hash: 'h', reason: '질문' })])).toEqual({ code: 3, out: 'RUNNING' })
  })
  it('resolved 뒤 같은 기준(base 가 지금 개발 브랜치의 접두)에서 또 충돌이면 재시도하지 않는다', () => {
    expect(decide([spawnResolve(), result('resolved', 'base=abc1234 files=1 rules=R1 tests=10/10')]))
      .toEqual({ code: 1, out: 'HUMAN 같은 기준 재충돌(base=abc1234)' })
  })
  it('resolved 뒤 개발 브랜치가 움직였으면 다음 시도', () => {
    expect(decide([spawnResolve(), result('resolved', 'base=0000000 files=1 rules=R1 tests=10/10')])).toEqual({ code: 0, out: 'RESOLVE 2' })
  })
  it('resolved 사유에 base 가 없으면 사람 몫(fail-closed)', () => {
    expect(decide([spawnResolve(), result('resolved', 'files=1')])).toEqual({ code: 1, out: 'HUMAN 해소 기준 불명' })
  })
  it('재시도 가능한 실패는 push-race·rate-limit·no-result·skipped 뿐, 나머지는 사람 몫', () => {
    expect(decide([spawnResolve(), result('skipped', '건너뜀(승인 뒤 변경)')]).out).toBe('RESOLVE 2')
    expect(decide([spawnResolve(), result('failed gate', 'gate 3')])).toEqual({ code: 1, out: 'HUMAN 재시도 불가(failed gate)' })
    expect(decide([spawnResolve(), result('failed push-hook')]).out).toBe('HUMAN 재시도 불가(failed push-hook)')
    expect(decide([spawnResolve(), result('failed deps')]).out).toBe('HUMAN 재시도 불가(failed deps)')
  })
  it('다른 팀장·다른 리포·다른 id8 의 줄은 세지 않는다', () => {
    const other = JSON.stringify({ ts: 't', host: 'mbp', repo: '/r/other', tsk: 'T', order: 'o', phase: 'team', event: 'team.spawn', agent: LEAD, id8: ID8, slot: '1', worktree: '/w', handle: '-', spawn_kind: 'resolve' })
    const otherLead = JSON.stringify({ ts: 't', host: 'pc', repo: REPO, tsk: 'T', order: 'o', phase: 'team', event: 'team.spawn', agent: 'kim/pc/lead', id8: ID8, slot: '1', worktree: '/w', handle: '-', spawn_kind: 'resolve' })
    expect(decide([other, otherLead, other])).toEqual({ code: 0, out: 'RESOLVE 1' })
  })
  it('인자가 모자라면 UNKNOWN usage(2)', () => {
    const r = spawnSync('sh', [DECIDE, 'x'], { encoding: 'utf8' })
    expect(r.status).toBe(2)
    expect(r.stdout.trim()).toBe('UNKNOWN usage')
  })
})

// ---- 해소 워크트리에서 heartbeat 훅(Review Focus 보조) ----------------------------
describe('heartbeat 훅 — 개발 브랜치의 state.json 이 merged·reported 뿐이면 아무것도 보내지 않는다', () => {
  it('.dflow-agent 가 w<slot> 이어도 진행 중 phase 가 없으면 침묵', () => {
    const repo = join(tmp, 'repo'), home = join(tmp, 'home'), log = join(tmp, 'curl.log')
    mkdirSync(repo); mkdirSync(home)
    writeFileSync(join(tmp, 'fakecurl'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexit 0\n`, { mode: 0o755 })
    const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' })
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
    writeFileSync(join(repo, '.env'), 'DFLOW_API_BASE=https://x.test\nDFLOW_PATS=dfl_u_abc_secret\n')
    for (const [t, ph] of [['TSK-01', 'merged'], ['TSK-02', 'reported']]) {
      mkdirSync(join(repo, `docs/tasks/${t}`), { recursive: true })
      writeFileSync(join(repo, `docs/tasks/${t}/state.json`), JSON.stringify({ tsk: t, order: '22222222-2222-4222-8222-22222222222' + t.slice(-1), phase: ph }))
    }
    git('add', '.'); git('commit', '-q', '-m', 'init')
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    execFileSync('sh', [HOOK], {
      cwd: repo, input: JSON.stringify({ cwd: repo, tool_name: 'Bash' }),
      env: { PATH: process.env.PATH ?? '', HOME: home, CURL: join(tmp, 'fakecurl'), NODE_ENV: process.env.NODE_ENV },
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    execFileSync('sh', ['-c', 'sleep 0.8'])
    expect(existsSync(log) ? readFileSync(log, 'utf8').trim() : '').toBe('')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/skills/dflow-team-resolve.test.ts`
Expected: FAIL. `resolve-prompt.md` 가 없어 파일 읽기에서 전체가 떨어진다.

- [ ] **Step 3: `resolve-decide.sh` 를 쓴다**

`.claude/skills/dflow-team/scripts/resolve-decide.sh`(실행 권한):

```sh
#!/bin/sh
# 머지 충돌 해소 재시도 판정 — /dflow-team 팀장이 스윕의 "머지 실패(충돌)" id8 마다 부른다
# (references/merge-conflict.md 「1. 충돌 접수」, 설계 2026-09-23 §5.6).
# 사용: resolve-decide.sh <EVENTS> <LEAD_AGENT> <REPO> <id8> <DEV_SHA>
#   EVENTS     ~/.dflow/events.jsonl
#   LEAD_AGENT <신원>/<host>/lead      REPO 팀장 체크아웃 절대경로
#   DEV_SHA    지금 origin/<개발브랜치> 의 전체 sha(결과 사유 base=<짧은 sha> 와 접두로 비교한다)
# 출력: RESOLVE <다음 시도 번호>(exit 0) · HUMAN <사유>(exit 1) · UNKNOWN <사유>(exit 2) · RUNNING(exit 3)
# 카운터 = spawn_kind "resolve" 인 team.spawn 개수. 초기화하지 않는다(재개 카운터와 다르다 — 해소 워커는 시도마다
# .result 를 쓰므로 team.result 로 되돌리면 상한에 영영 닿지 않는다). 워커 자동 재시작(H)의 카운터와도 나눈다.
set -u
MAX=3
[ $# -eq 5 ] && [ -n "$4" ] && [ -n "$5" ] || { echo "UNKNOWN usage"; exit 2; }
ev=$1; lead=$2; repo=$3; id8=$4; dev=$5
command -v jq >/dev/null 2>&1 || { echo "UNKNOWN no-jq"; exit 2; }
[ -f "$ev" ] || { echo "RESOLVE 1"; exit 0; }

# 이 팀장·리포·id8 의 해소 관련 줄만 순서대로: S(해소 spawn) · R<TAB>status<TAB>reason · B(blocked). 다른 spawn 은 버린다.
lines=$(jq -r --arg a "$lead" --arg r "$repo" --arg i "$id8" '
  select(.agent == $a and .repo == $r and (.id8 // "") == $i)
  | if .event == "team.spawn" then (if (.spawn_kind // "new") == "resolve" then "S" else empty end)
    elif .event == "team.result" then "R\t\(.status // "")\t\(.reason // "")"
    elif .event == "team.blocked" then "B"
    else empty end' "$ev" 2>/dev/null) || { echo "UNKNOWN bad-events"; exit 2; }

n=$(printf '%s\n' "$lines" | grep -c '^S$')
[ "$n" -gt 0 ] || { echo "RESOLVE 1"; exit 0; }
# 마지막 해소 spawn 뒤의 마지막 판정 줄
last=$(printf '%s\n' "$lines" | awk '/^S$/{l=""; next} NF{l=$0} END{print l}')
case "$last" in
  ''|B) echo "RUNNING"; exit 3 ;;
esac
[ "$n" -lt "$MAX" ] || { echo "HUMAN 해소 상한($n/$MAX)"; exit 1; }
status=$(printf '%s' "$last" | cut -f2)
reason=$(printf '%s' "$last" | cut -f3)
next=$((n + 1))
case "$status" in
  resolved)
    base=$(printf '%s' "$reason" | sed -n 's/.*base=\([0-9a-f][0-9a-f]*\).*/\1/p')
    [ -n "$base" ] || { echo "HUMAN 해소 기준 불명"; exit 1; }
    case "$dev" in "$base"*) echo "HUMAN 같은 기준 재충돌(base=$base)"; exit 1 ;; esac
    echo "RESOLVE $next"; exit 0 ;;
  'failed push-race'|'failed rate-limit'|'failed no-result'|skipped)
    echo "RESOLVE $next"; exit 0 ;;
  *)
    echo "HUMAN 재시도 불가($status)"; exit 1 ;;
esac
```

- [ ] **Step 4: `resolve-prompt.md` 를 쓴다**

`.claude/skills/dflow-team/references/resolve-prompt.md`:

````markdown
# /dflow-team 해소 워커 프롬프트 (정본)

> 설계 정본: wbs-web 리포 docs/superpowers/specs/2026-09-23-parallel-merge-conflict-design.md §5(킷에는 미동봉).

너는 `/dflow-team` 팀장이 띄운 **해소 워커**다. 개발 브랜치와 충돌해 머지되지 못한 작업 한 건을 **개발 브랜치 위의
머지 커밋 안에서** 풀어 push 하고, `.result` 한 줄로 보고한다. 개발 워커(`worker-prompt.md`)와 달리 주문을 점유하지
않으며 서버에 아무것도 쓰지 않는다. 팀장이 첫 입력으로 보낸 것은 포인터 한 줄이며, 그 줄의 `KEY=VALUE` 가 아래
변수를 채운다. 이 문서의 규칙이 `/dflow-merge` 본문보다 우선한다.

| 변수 | 포인터 키 | 뜻 |
|---|---|---|
| `{TSK}` | `TSK` | 작업 TSK-ID |
| `{ID8}` | `ID8` | 주문 id8. 참조는 이것과 `{ORDER}` 로만 한다 |
| `{ORDER}` | `ORDER` | 주문 전체 UUID. 머지 커밋 트레일러 `DFlow-Order` 의 값 |
| `{AGENT_ID}` | `AGENT_ID` | 좌석 식별자 `<신원>/<host>/w<slot>` |
| `{MAIN_CHECKOUT}` | `MAIN_CHECKOUT` | 팀장의 상주 체크아웃 절대경로 |
| `{MODEL_FLAG}` | `MODEL` | `worker-prompt.md` 와 같다 |
| `{DEV_BRANCH}` | `DEV_BRANCH` | 개발 브랜치 이름(`origin/` 없음) |
| `{TASK_DIR}` | `TASK_DIR` | 이 작업의 폴더(리포 최상위 기준, 예 `docs/tasks/TSK-03-02`). `{TASKS}` 는 그 부모 |
| `{ATTEMPT}` | `ATTEMPT` | 이번 해소 시도 번호(1~3) |
| `{ON_REPORT}` | `ON_REPORT` | `1` 이면 팀장이 자동 머지 운영이다. `/dflow-merge` 에 `--on-report` 를 붙인다 |

`DEV_BRANCH`·`TASK_DIR`·`ORDER` 중 하나라도 비어 있으면 파일을 쓰지 않고 마지막 응답으로
`{TSK} {ID8} - - - failed no-dev-branch` 한 줄만 출력하고 끝낸다.

**워커 자동 재시작(H)의 대상이 아니다.** 이 세션이 결과 없이 죽으면 팀장은 `team.lost` 가 아니라 `failed no-result`
로 판정하고 해소 카운터로만 센다(`references/merge-conflict.md`).

## 0. git 호출 규칙·격리 확인

`worker-prompt.md` 「0」·「1」 을 그대로 따른다. 파일은 `cat {MAIN_CHECKOUT}/.claude/skills/dflow-team/references/worker-prompt.md`
로 읽어 그 절만 적용한다. 격리에 실패하면 아무 파일도 쓰지 않고 마지막 응답으로 `{TSK} {ID8} - - - failed not-isolated`
한 줄만 출력하고 끝낸다.

## 1. 개발 브랜치 state 검사 (좌석 식별 전)

heartbeat 훅은 `.dflow-agent` 가 있는 워크트리에서, 진행 중 phase 인 state.json 의 주문으로 신호를 보낸다. 해소
워크트리는 개발 브랜치 위라서 그런 파일이 있으면 남의 주문에 신호가 간다(멈춘 워커가 살아 보인다). 좌석 파일을 쓰기
**전에** 확인한다.
```bash
find docs -path '*/tasks/*/state.json' 2>/dev/null | while IFS= read -r f; do
  jq -r --arg f "$f" 'select(.phase == "design" or .phase == "build" or .phase == "verify" or .phase == "refactor" or .phase == "rejected") | $f' "$f"
done
```
출력이 비어 있어야 한다. 줄이 있으면 `.dflow-agent`·`.result` 를 쓰지 않고, 마지막 응답으로
`{TSK} {ID8} - - - failed dirty-dev-state <파일…>` 한 줄만 출력하고 끝낸다(팀장은 `failed not-isolated` 와 같은
화면 폴백으로 안다).

## 2. 좌석 식별·부트스트랩

- `worker-prompt.md` 「2」 그대로 `.dflow-agent` 에 `{AGENT_ID}` 를 쓴다. 팀장 재구성이 이 파일로 슬롯을 흡수한다.
- `worker-prompt.md` 「3」 그대로 링크·doctor·`me`·기점 이동(`git fetch origin && git switch --detach origin/{DEV_BRANCH}`)을
  한다. 실패 값(`no-skill`·`doctor-<exit>`·`auth`·`detach`)도 같다. 그 절의 `--worker` 플래그 확인 줄은 건너뛴다. 마지막
  기점 이동이 Orca 가 만든 브랜치 워크트리도 detach 한다.
- 스킬 폴더가 실제 폴더로 있으면 해소에 쓰는 두 스킬도 링크한다.
  ```bash
  if [ -d .claude/skills ] && [ ! -L .claude/skills ]; then
    for s in dflow-merge dflow-team; do [ -e ".claude/skills/$s" ] || ln -s "{MAIN_CHECKOUT}/.claude/skills/$s" ".claude/skills/$s"; done
  fi
  test -e .claude/skills/dflow-merge/SKILL.md || echo NO_MERGE_SKILL
  .claude/skills/dflow-dev/scripts/deps.sh
  ```
  `NO_MERGE_SKILL` 이면 `failed no-skill`, `deps.sh` 가 0 이 아니면 `failed deps <DEPS_FAILED 줄의 명령과 exit>` 다.

## 3. 기준선

dev-discipline 「게이트 기준선」 대로 전체 시험을 한 번 돌려 기록한다. 이때의 `git rev-parse --short HEAD` 를
`<BASE>` 로 함께 적는다. 게이트는 반드시 `<BASE>` 위에 만든 머지를 판정해야 한다.

## 4. 해소 머지

Skill 도구로 `/dflow-merge --resolve {ID8} --attempt {ATTEMPT}` 를 실행한다. `{ON_REPORT}` 가 `1` 이면 `--on-report` 를
붙인다. Skill 도구가 `dflow-merge` 를 모르면 `.claude/skills/dflow-merge/SKILL.md` 를 Read 해 그 절차를 따른다.
충돌은 아래 「해소 규약」 으로, 게이트는 아래 「게이트」 로 판정한다(`/dflow-merge` 「해소 머지(`--resolve`)」 가 이
두 절을 부른다). 해소 기록은 `{TASK_DIR}/resolution.md` 에 쓴다.

마지막 출력 줄로 가른다.

| 출력 | 할 일 |
|---|---|
| `RESOLVE_PUSHED <sha> base=… files=… rules=… tests=…` | `resolved` 결과 줄을 쓴다(아래 표) |
| `RESOLVE_BASE_MOVED <sha>` | 새 `origin/{DEV_BRANCH}` 로 다시 detach 하고 3번 기준선을 다시 잰 뒤 4번을 다시 한다 |
| `RESOLVE_SKIPPED <문구>` | `skipped <문구>` |
| `RESOLVE_BLOCKED <질문>` | `blocked <질문>`. 머지는 워크트리에 멈춘 채 둔다 |
| `RESOLVE_GATE_FAILED <n>` | `failed gate <n>` |
| `RESOLVE_PUSH_HOOK` | `failed push-hook` |
| `RESOLVE_PUSH_FAILED <exit>` | `failed push-other <exit>` |
| `RESOLVE_NOT_DETACHED` | `failed not-detached` |

`RESOLVE_BASE_MOVED` 는 기준 이동과 push 경합 둘 다에서 온다. 이것으로 다시 하는 것은 이 세션 안에서 합쳐 **2회**까지다.
세 번째 `RESOLVE_BASE_MOVED` 가 오면 `failed push-race` 다.

## 5. 서버 쓰기 없음

claim·progress·done·heartbeat 를 하지 않는다. 조회는 `show {ID8}` 뿐이다. 특히 `worker-prompt.md` 가 blocked 직전에
보내는 `dflow.sh heartbeat --phase blocked` 를 **보내지 않는다**. 주문이 `claimed` 가 아니라서 409 가 난다. 좌석 표시는
팀장이 `merge_conflict` 로 대신한다.

## 6. 판단·권한·중단

AskUserQuestion 을 쓰지 않는 것과 권한 거부 처리는 `worker-prompt.md` 「6」 을 따른다. 권한 거부는
`failed permission <거부된 명령의 첫 낱말들>` 이다. 해소 워커는 서버를 부르지 않으므로 중단(exit 10)은 사실상 오지 않는다.
`blocked` 는 아래 「blocked 로 멈추는 경우」 에만 쓴다. 멈출 때는 결과 줄을 쓰고, 질문을 화면에 출력한 채 세션을 멈춘다.
답을 받으면 같은 워크트리에서 멈춘 머지를 이어 푼다(`/dflow-merge` 「해소 머지」 4번의 해소부터). 끝나면 `.result` 를 새
결과로 덮어쓴다.

## 해소 규약

원칙: **양쪽 기능을 모두 살린다.** 한쪽 변경을 버리는 해소는 R3·R4 가 명시한 경우뿐이다. "개발 브랜치 쪽" 은 먼저
머지된 쪽(`HEAD`)이고, "이 브랜치 쪽" 은 해소 대상 agent 브랜치(`MERGE_HEAD`)다. 상대편 의도는 충돌 파일을 먼저 바꾼
개발 브랜치 쪽 Task 의 design.md 를 `git log -1 --format=%H HEAD -- <파일>` 로 찾아 읽는다. 이 Task 의 의도는
`{TASK_DIR}/design.md` 다.

| # | 충돌 모양 | 해소 |
|---|---|---|
| R1 | 등록 목록·import 블록·배열·라우트 표에 양쪽이 항목을 더함 | 양쪽 항목을 모두 남긴다. 개발 브랜치 쪽 순서를 유지하고 이 브랜치 항목을 뒤에 둔다. 중복은 하나로 |
| R2 | "아직 비어 있어야 할 것" 목록(`STUBS` 등)에서 양쪽이 서로 다른 항목을 뺌 | **어느 쪽이든 뺀 항목은 모두 뺀다.** 한쪽 줄을 남기면 이미 구현된 함수에 "스텁이어야 한다" 를 단정하게 된다 |
| R3 | 같은 목적을 서로 다른 방식으로 품(`IMPLEMENTED` vs `REGISTERED_ROUTES`) | **개발 브랜치에 먼저 들어온 방식을 따른다.** 이 브랜치의 항목을 그 방식으로 다시 쓰고, 이 브랜치가 새로 만든 상수·함수는 걷어낸다 |
| R4 | 같은 경로에 양쪽이 새 파일을 만듦(add/add) | 개발 브랜치 판을 정본으로 둔다. 이 브랜치의 호출부를 그 판에 맞춘다. 이 브랜치에 꼭 필요한 기능이 정본에 없으면 **기존 호출부가 깨지지 않는 하위 호환 확장**만 한다(인자 추가·반환 필드 추가) |
| R5 | 텍스트 충돌 없이 시험이 깨짐(의미 충돌. 예: 가드가 들어와 헤더 없는 요청이 401) | 원인이 개발 브랜치 쪽 횡단 변경이면 **이 브랜치 쪽 시험·코드를 그 규약에 맞춘다.** 이미 머지된 다른 Task 의 시험이 깨지면, 공용 헬퍼를 더해 호출부를 바꾸지 않고 고치는 방식만 허용한다 |
| R6 | lockfile | 개발 브랜치 판을 받고 패키지 관리자로 다시 만든다(`npm install --package-lock-only` 등). 이 브랜치가 더한 의존만 다시 반영한다 |
| R7 | Task 폴더(`{TASKS}/<TSK>/*`) | 이 Task 폴더는 이 브랜치 판, 다른 Task 폴더는 개발 브랜치 판 |
| R8 | 설명 문서·주석 | 양쪽 문장을 모두 살려 합친다 |

### blocked 로 멈추는 경우

- 양쪽 기능을 모두 살리는 해소가 없다(한쪽 동작을 바꿔야만 통과한다).
- 다른 Task 의 공개 계약(API 모양·DB 스키마·이벤트 페이로드)을 바꿔야 한다.
- 마이그레이션 파일이 충돌하거나 번호가 겹친다(적용 이력과 얽혀 번호를 다시 매길 수 없다).
- 시험을 지우거나 `skip` 하거나 기대값을 느슨하게 해야만 통과한다. R2·R3 의 목록 정리는 예외다. 그것은 단정 대상을
  바로잡는 일이기 때문이다.
- 이미 머지된 다른 Task 의 소유 파일을 R5 범위를 넘어 고쳐야 한다.

## 게이트

dev-discipline 「게이트 기준선」 과 같은 판정이다. 기준선은 3번에서 `<BASE>` 로 잰 것이고, 판정 대상은 해소 머지
커밋이다. **기준선 대비 신규 실패 0 + 시험 총수가 기준선 이상**이면 통과다. 빌드·린트·타입 검사가 대상 리포 기준선
명령에 들어 있으면 같이 본다. 기준 이동이나 push 경합으로 다시 머지했으면 기준선부터 다시 잰다.

## 기록

- 해소한 파일마다 적용한 규약 번호와 판단을 `{TASK_DIR}/resolution.md` 의 `## 시도 {ATTEMPT}` 절에 덧붙이고, 머지
  커밋에 함께 담는다. 머지 커밋 본문 둘째 문단에는 요약(충돌 파일 수·규약 번호)을 둔다.
- `worker-prompt.md` 에 「7-1」 절(`.issues`)이 있으면 그 형식을 따르고, phase 칸은 `resolve` 로 쓴다. 없으면 쓰지 않는다.

## 결과 줄

`{TASK_DIR}/.result` 에 한 줄을 쓰고(디렉터리가 없으면 만든다) 같은 줄을 마지막 응답으로도 출력한다. 형식은
`worker-prompt.md` 「7」 과 같다: `{TSK} {ID8} <branch|-> <head|-> <done_exit|-> <status> <사유>`. 해소 워커는
`branch` 칸에 `-`, `head` 칸에 push 한 머지 커밋의 짧은 sha(없으면 `-`), `done_exit` 칸에 `-` 를 쓴다. `branch` 칸에
특별한 값을 넣지 않는 이유가 있다. 팀장 결과 표가 그 칸을 브랜치 이름으로 읽기 때문이다. 해소 결과인지는 슬롯의
`spawn_kind` 로 가른다.

| status | 언제 | 사유 |
|---|---|---|
| `resolved` | 해소(또는 충돌 없이 머지)하고 게이트 통과·push 성공 | `base=<BASE> files=<충돌 파일 수> rules=<R번호,…|-> tests=<통과/총수>`. 충돌이 없었으면 `files=0 rules=-` |
| `skipped` | `/dflow-merge` 가 해소 전에 건너뜀(이미 머지됨·반려·승인 뒤 변경 등) | 그 보고 문구 |
| `blocked` | 「blocked 로 멈추는 경우」 | 질문과 선택지 한 줄 |
| `failed <사유>` | `gate <n>`·`push-race`·`push-hook`·`push-other <exit>`·`not-detached`·`deps …`·`permission …`·`rate-limit`·부트스트랩 실패 값 | 첫 낱말이 팀장이 구분하는 값 |

## 금지

- 시험 삭제·`skip`·기대값 완화로 게이트 통과.
- agent 브랜치 수정·rebase·force push. 훅 우회(SKIP_GUARD).
- 서버 쓰기(claim·progress·done·heartbeat·release). `{ID8}` 외 주문 조회.
- `git config` 로 rerere 켜기(공용 설정이 바뀐다). 명령줄 `-c` 만 쓴다.
- 팀장 체크아웃에서 git 을 조작하는 것.
````

- [ ] **Step 5: 통과를 확인한다**

Run: `chmod +x .claude/skills/dflow-team/scripts/resolve-decide.sh && npx vitest run tests/skills/dflow-team-resolve.test.ts tests/skills/shell-syntax.test.ts`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add .claude/skills/dflow-team/references/resolve-prompt.md .claude/skills/dflow-team/scripts/resolve-decide.sh tests/skills/dflow-team-resolve.test.ts
git commit -m "feat(dflow-team): 머지 충돌 해소 워커 프롬프트와 재시도 판정 스크립트" -m "원래 워커는 done 뒤 끝나고 claim·done 흐름이 reported·approved 주문에 맞지 않아 해소 전용 워커를 둔다. 재시도 카운터는 team.result 로 초기화되지 않게 따로 세고, 같은 기준에서 다시 충돌하면 무한 루프 대신 사람에게 넘긴다." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA"
```

---
### Task 8: 팀장 흐름 — `merge-conflict.md`·SKILL.md·events·backends·help

**Files:**
- Create: `.claude/skills/dflow-team/references/merge-conflict.md`
- Modify: `.claude/skills/dflow-team/SKILL.md` (아래 E1~E20. 새 절은 「4-1」「5-2」 둘뿐이고 나머지는 문구만 바꾼다)
- Modify: `.claude/skills/dflow-team/references/events.md`, `references/backends.md`(「고아 정리 규칙」 2-1), `references/help.md`
- Test: `tests/skills/dflow-team-merge-conflict.test.ts`(신규), `tests/skills/dflow-team-depends-precheck.test.ts`, `tests/skills/dflow-team-shell-blocks.test.ts`(`DOCS` 에 두 파일)

**Interfaces:**
- Consumes:
  - Task 4 `dflow.sh heartbeat <order> --agent <lead> --phase merge_conflict --note …` / `--clear-merge-conflict`
  - Task 5 `pred-reflected.sh <TASKS> <TSK> <DEV>`
  - Task 6 스윕 보고 `머지 실패(충돌) <파일,…>`
  - Task 7 `resolve-decide.sh`, `resolve-prompt.md` 의 포인터 키와 결과 줄
- Produces:
  - 이벤트 `team.spawn.spawn_kind = "resolve"`
  - 이벤트 `team.result.status = "resolved"`
  - 이벤트 `team.sweep.resolved`(숫자)
  - 새 이벤트 `team.conflict {id8, decision: queued|human|cleared, files}`
  - 해소 워크트리 경로 `<MAIN>/.claude/worktrees/dflow-<id8>-resolve`

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/skills/dflow-team-merge-conflict.test.ts`:

```ts
// tests/skills/dflow-team-merge-conflict.test.ts
// 팀장의 머지 충돌 흐름(2026-09-23 §4·§6.3·§7.1·§8) — 문서 계약과 문서 속 jq 를 실제로 돌린다.
// dflow-team.test.ts 는 병행 세션이 자주 고치므로 이 과제의 검사는 이 파일에 모은다.
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const TEAM = read('.claude/skills/dflow-team/SKILL.md')
const MC = read('.claude/skills/dflow-team/references/merge-conflict.md')
const EVENTS = read('.claude/skills/dflow-team/references/events.md')
const BACKENDS = read('.claude/skills/dflow-team/references/backends.md')
const HELP = read('.claude/skills/dflow-team/references/help.md')

describe('SKILL.md — 포인터 절과 바뀐 문구', () => {
  it('「4-1. 머지 충돌 해소」·「5-2. 해소 spawn」 이 merge-conflict.md 를 가리킨다', () => {
    expect(TEAM).toContain('### 4-1. 머지 충돌 해소')
    expect(TEAM).toContain('### 5-2. 해소 spawn')
    expect(TEAM).toContain('cat .claude/skills/dflow-team/references/merge-conflict.md')
    expect(TEAM).toContain('`references/events.md`, `references/merge-conflict.md`, `references/backends.md` 의')
  })
  it('최종 판정 목록 두 곳에 resolved 가 있다', () => {
    expect(TEAM.split('`needs-merge`·`skipped`·`failed`·`cancelled`·`resolved`)').length - 1).toBe(2)
  })
  it('spawn 우선순위: 재개 → 해소 → 대기 큐', () => {
    expect(TEAM).toContain('**재개 대상을 먼저**(「5-1. 재개 spawn」), 그 다음 **해소 큐**(「5-2. 해소 spawn」), 그 다음 대기 큐')
  })
  it('머지 충돌 bullet 은 해소로 넘기고, 못 푸는 경우만 사람 몫(기존 문구 유지)', () => {
    expect(TEAM).toContain('"머지 실패(충돌)"')
    expect(TEAM).toContain('"사람이 머지해야 함"')
    expect(TEAM).toContain('「4-1. 머지 충돌 해소」 로 넘긴다')
  })
  it('일시 제외 해제: 머지됨·해소 resolved 도 풀고, 선행 미반영도 선행 계열이다', () => {
    expect(TEAM).toContain('"머지됨(승인 전)"·"머지됨" 을 한 건이라도 냈거나 해소 워커가 `resolved` 로 끝났으면')
    expect(TEAM).toMatch(/선행 계열\(선행 미충족·[^)]*선행 미반영\)/)
  })
  it('금지: heartbeat·--resolve 예외, 재spawn 예외는 넷', () => {
    expect(TEAM).toContain('머지 충돌 표시 heartbeat(`merge_conflict` 설정·해제')
    expect(TEAM).toContain('해소 워커의 `/dflow-merge --resolve` 가 개발 브랜치에 한 건을 머지·push 한다')
    expect(TEAM).toContain('- 같은 작업의 재spawn. 예외는 넷이다')
    expect(TEAM).toContain('같은 작업을 다시 띄우는 것은 넷뿐이다')
  })
  it('team.sweep 은 resolved 를 함께 센다, 마감은 표시를 지우지 않는다', () => {
    expect(TEAM).toContain('`team.sweep`(merged, waiting, rejected, resolved 개수)을 기록한다.')
    expect(TEAM).toContain('마감은 남은 `merge_conflict` 표시를 지우지 않는다')
  })
  it('해소 워크트리는 부트스트랩 실패 정리 대상이 아니다(branch 칸이 늘 -)', () => {
    expect(TEAM).toContain('(해소 워크트리 `dflow-<id8>-resolve` 는 예외 — 「고아 정리 규칙」 2-1번)')
  })
})

describe('merge-conflict.md — 팀장 쪽 절차', () => {
  it('충돌 접수: mine 확인, resolve-decide.sh, 동시 해소 상한', () => {
    expect(MC).toContain('.claude/skills/dflow-team/scripts/resolve-decide.sh ~/.dflow/events.jsonl')
    expect(MC).toContain('`mine` 이 `true` 가 아니면')
    expect(MC).toContain('`max(1, ⌊인원/2⌋)`')
  })
  it('heartbeat 대리 호출은 전체 UUID 와 --agent <lead> 로 부른다', () => {
    expect(MC).toContain("dflow.sh heartbeat '<order 전체 UUID>' --agent '<신원>/<host>/lead' --phase merge_conflict --note")
    expect(MC).toContain("dflow.sh heartbeat '<order 전체 UUID>' --agent '<신원>/<host>/lead' --clear-merge-conflict")
  })
  it('resolved 는 조상 확인 뒤에만 해제하고, 곧바로 승인 스윕', () => {
    expect(MC).toContain("git merge-base --is-ancestor '<결과 줄 head>' origin/<개발브랜치>")
    expect(MC).toContain('해소 push 확인 불가')
    expect(MC).toContain('곧바로 승인 스윕')
  })
  it('차단기: 내용 실패는 세지도 끊지도 않고, 환경 실패만 센다', () => {
    expect(MC).toContain('`failed gate`·`failed push-race`·`failed push-hook`·`failed push-other`·`failed not-detached`·`failed dirty-dev-state`')
    expect(MC).toContain('세지도 끊지도 않는다')
  })
  it('H 제외, lease 상실 중 spawn 금지', () => {
    expect(MC).toContain('워커 자동 재시작(H)의 대상이 아니다')
    expect(MC).toContain('`team.lost` 를 쓰지 않는다')
    expect(MC).toContain('`LEASE_LOST`')
  })
  it('사람 머지 감지 jq: 마지막 decision 이 cleared 가 아닌 id8 만 낸다', () => {
    const m = MC.match(/jq -rs --arg a '<신원>\/<host>\/lead' --arg r '<MAIN>' '([^']+)'/)
    expect(m).not.toBeNull()
    const line = (id8: string, decision: string, agent = 'hong/mbp/lead') =>
      JSON.stringify({ ts: 't', host: 'mbp', repo: '/r', tsk: `TSK-${id8}`, order: `o-${id8}`, phase: 'team', event: 'team.conflict', agent, id8, decision, files: 'a.ts' })
    const input = [line('aaaa1111', 'queued'), line('bbbb2222', 'human'), line('aaaa1111', 'cleared'), line('cccc3333', 'human', 'kim/pc/lead')].join('\n')
    const out = execFileSync('jq', ['-rs', '--arg', 'a', 'hong/mbp/lead', '--arg', 'r', '/r', m![1]], { input }).toString().trim()
    expect(out).toBe('bbbb2222\tTSK-bbbb2222\to-bbbb2222')
  })
})

describe('events.md — 새 값과 가드', () => {
  const guard = () => {
    const m = EVENTS.match(/'(\{"team\.start":[\s\S]*?EVENT_ARGS_MISSING"\) end)'/)
    if (!m) throw new Error('가드 jq 를 찾지 못했다')
    return m[1]
  }
  const run = (obj: Record<string, unknown>) => {
    try {
      return execFileSync('jq', ['-c', '--arg', 'h', 'mbp', guard()], { input: JSON.stringify(obj), stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
    } catch { return 'EVENT_ARGS_MISSING' }
  }
  const base = { ts: 't', host: 'mbp', repo: '/r', tsk: 'TSK-01-01', order: 'o', phase: 'team', agent: 'hong/mbp/lead' }
  it('team.sweep 은 resolved 가 있어야 붙는다', () => {
    expect(run({ ...base, event: 'team.sweep', merged: 1, waiting: 0, rejected: 0, resolved: 1 })).not.toBe('EVENT_ARGS_MISSING')
    expect(run({ ...base, event: 'team.sweep', merged: 1, waiting: 0, rejected: 0 })).toBe('EVENT_ARGS_MISSING')
  })
  it('team.conflict 는 id8·decision·files 가 있어야 붙는다', () => {
    expect(run({ ...base, event: 'team.conflict', id8: 'aaaa1111', decision: 'queued', files: 'src/a.ts' })).not.toBe('EVENT_ARGS_MISSING')
    expect(run({ ...base, event: 'team.conflict', id8: 'aaaa1111', decision: 'queued' })).toBe('EVENT_ARGS_MISSING')
  })
  it('spawn_kind 는 네 값이고 resolve 를 설명한다', () => {
    expect(EVENTS).toContain('`spawn_kind` 는 네 값 중 하나인 문자열이다')
    expect(EVENTS).toContain('`resolve` 는 「5-2. 해소 spawn」')
    expect(EVENTS).toContain('`new`·`resume`·`readopt`·`resolve` 밖의 값을 쓰지 않는다')
  })
})

describe('backends.md·help.md', () => {
  it('고아 정리 규칙 2-1: 해소 워크트리는 개발 브랜치 조상이면 지운다', () => {
    expect(BACKENDS).toContain('2-1. **해소 워크트리**')
    expect(BACKENDS).toContain('git -C <워크트리> merge-base --is-ancestor HEAD origin/<개발브랜치>')
  })
  it('도움말에 해소 동작과 상한이 있다', () => {
    expect(HELP).toContain('머지 충돌 해소')
    expect(HELP).toContain('3번까지')
  })
})
```

`tests/skills/dflow-team-depends-precheck.test.ts`:
- 원문 `function run(show: unknown): { spec_empty: boolean; deps_unmet: string[] } {` → `function run(show: unknown): { spec_empty: boolean; deps_unmet: string[]; deps_nohead: string[] } {`
- describe 안 마지막 it 뒤에 붙인다.
```ts
  it('deps_nohead 는 reached=true·head_sha 없는 선행만 담는다 — head_sha 있는 선행(행 B 스택)은 거르지 않는다(2026-09-23)', () => {
    const r = run(order({ depends_evidence: [
      { external_ref: 'd/TSK-03-01', reached: true, head_sha: null },
      { external_ref: 'd/TSK-03-02', reached: true, head_sha: 'abc' },
      { external_ref: 'd/TSK-03-03', reached: false, head_sha: null },
      { external_ref: 'd/TSK-03-04', reached: true },
    ] }))
    expect(r.deps_nohead).toEqual(['d/TSK-03-01', 'd/TSK-03-04'])
    expect(r.deps_unmet).toEqual(['d/TSK-03-03'])
  })
  it('선행 반영 사전 검사: NOT_REFLECTED 는 선행 미반영으로 일시 제외, UNKNOWN 은 거르지 않는다', () => {
    expect(team).toContain('사유 `선행 미반영(사전 검사: <ref…>)`')
    expect(team).toContain('`UNKNOWN`(rc=2) 은 거르지 않고 워커에 맡긴다')
    expect(team).toContain('.claude/skills/dflow-dev/scripts/pred-reflected.sh')
  })
```

`tests/skills/dflow-team-shell-blocks.test.ts` 의 `DOCS` 배열에서 원문 `  '.claude/skills/dflow-team/references/worker-prompt.md',` 바로 아래에 두 줄을 더한다.
```ts
  '.claude/skills/dflow-team/references/resolve-prompt.md',
  '.claude/skills/dflow-team/references/merge-conflict.md',
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/skills/dflow-team-merge-conflict.test.ts tests/skills/dflow-team-depends-precheck.test.ts tests/skills/dflow-team-shell-blocks.test.ts`
Expected: FAIL. `merge-conflict.md` 가 없고, `deps_nohead` 가 undefined 다.

- [ ] **Step 3: `merge-conflict.md` 를 쓴다**

`.claude/skills/dflow-team/references/merge-conflict.md`:

````markdown
# /dflow-team 머지 충돌 해소 — 팀장 쪽 절차 (정본)

> 설계 정본: wbs-web 리포 docs/superpowers/specs/2026-09-23-parallel-merge-conflict-design.md §4~§8(킷에는 미동봉).

SKILL.md 「4-1. 머지 충돌 해소」·「5-2. 해소 spawn」 이 이 문서를 가리킨다. 컨텍스트 압축 뒤 첫 기상에서는 다른
reference 와 함께 Bash `cat` 으로 다시 읽는다. 해소 워커 쪽 규칙은 `resolve-prompt.md` 다.

## 0. 상태와 불변식

- **해소 큐**: 해소하기로 정했으나 아직 띄우지 못한 id8 이다. 메모리 캐시이며 재구성하지 않는다. 다음 스윕이 같은
  충돌을 다시 내기 때문이다.
- **충돌 목록**: 표시를 풀어야 할 id8 이다. `team.conflict` 이벤트로 남기며, id8 마다 마지막 `decision` 이 `cleared` 가
  아닌 것이다(「5」 의 jq).
- **해소 슬롯**: 슬롯 표에서 `spawn_kind` 가 `resolve` 인 슬롯이다(워크트리 `<MAIN>/.claude/worktrees/dflow-<id8>-resolve`).
- **동시 해소 상한**은 `max(1, ⌊인원/2⌋)` 이다. 답을 기다리는 `blocked` 해소 워커도 센다. 넘치는 것은 해소 큐에 남긴다.
  이유: `blocked` 해소 워커는 슬롯을 쥔다. 상한이 없으면 충돌이 많은 밤에 모든 슬롯이 사람을 기다리며 선다.
- **해소는 이 신원의 주문(`mine`)만 한다.** 같은 신원+프로젝트의 팀장은 lease 가 하나로 묶는다.
- `LEASE_LOST` 마감·잠금 상실 마감·「7. 마감」 에 들어선 뒤에는 해소를 새로 띄우지 않는다(spawn 이기 때문이다). 떠 있는
  해소 워커는 워커와 같이 끝까지 한다.
- 해소 워커는 **워커 자동 재시작(H)의 대상이 아니다.** 결과 없이 죽은 해소 워커는 `failed no-result` 로 판정하고
  `team.lost` 를 쓰지 않는다. 해소 카운터(`spawn_kind == "resolve"` 개수)가 한 번 오르며, 다음 스윕에서 충돌이 다시 나면
  「1」 로만 다시 띄운다.

## 1. 충돌 접수

「4. 승인 스윕」 보고의 `머지 실패(충돌) <파일,…>` 마다 한다.

1. **주문 확인**
   ```bash
   (.claude/skills/dflow-work/scripts/dflow.sh show '<id8>') \
     | jq -c '{order: .order.id, status: .order.status, mine: .order.mine, ref: .order.item.external_ref}'
   ```
   - show 가 실패하면 "조회 실패: <id8>" 로 보고하고 이번에는 아무것도 하지 않는다. 다음 스윕이 다시 낸다.
   - `mine` 이 `true` 가 아니면 "사람이 머지해야 함: <id8> (다른 신원의 주문) · 충돌 파일 <…>" 로 보고만 한다.
     표시도 쏘지 않는다(서버가 403 이다).
   - `status` 가 `reported`·`approved` 가 아니면 보고만 한다.
   - TSK 는 `ref` 의 마지막 `/` 뒤다.
2. **진행 중 확인**: 같은 id8 이 해소 슬롯이나 해소 큐에 있으면 건너뛴다. 스윕이 도는 동안 같은 id8 이 계속 충돌로
   보고되기 때문이다.
3. **재시도 판정**
   ```bash
   git fetch origin
   dev=$(git rev-parse origin/<개발브랜치>)
   .claude/skills/dflow-team/scripts/resolve-decide.sh ~/.dflow/events.jsonl '<신원>/<host>/lead' '<MAIN>' '<id8>' "$dev"; echo "rc=$?"
   ```
   | 출력 | 처리 |
   |---|---|
   | `RESOLVE <n>` | 해소 큐 끝에 `{id8, order, TSK, n, 충돌 파일}` 를 넣는다. 표시 note `충돌 <k>개(<첫 파일>…) · 해소 대기 <n>/3`. `team.conflict`(decision `queued`) |
   | `RUNNING` | 아무것도 하지 않는다. 2번에서 걸렀어야 하므로 "재구성 누락: <id8>" 를 한 줄 보고한다 |
   | `HUMAN <사유>` | "사람이 머지해야 함: <id8> (<사유>) · 충돌 파일 <…>" 로 보고한다. 표시 note `사람 머지 필요: <사유>`. `team.conflict`(decision `human`) |
   | `UNKNOWN <사유>` | 해소하지 않는다(fail-closed). "해소 판정 불가: <id8> (<사유>)" 로 보고한다. 표시 note `사람 머지 필요: 판정 불가`. `team.conflict`(decision `human`) |
4. **보고**: 스윕 보고에 충돌 파일 목록을 싣는다.

## 2. 해소 spawn

「2-3」 기상 순서 4번에서 **재개 다음, 대기 큐보다 먼저** 띄운다. 해소가 막힌 후속 전체를 풀기 때문이다. 빈 슬롯과
차단기 규칙은 새 작업과 같고, 동시 해소 상한(「0」)을 넘지 않는다. 해소 큐의 맨 앞부터 한다.

1. 슬롯 번호를 정하고(「팀장 상태」 발급 규칙) `AGENT_ID = <신원>/<host>/w<slot>` 을 만든다.
2. **작업 폴더**: 아래 출력이 `<TASKS>` 이고, `TASK_DIR = <TASKS>/<TSK>` 다. `TASKDIR_FAILED` 면 띄우지 않고
   "작업 폴더 해석 실패: <id8>" 로 보고한다(해소 큐에서 뺀다. 다음 스윕이 다시 낸다).
   ```bash
   if grep -q '^  taskdir <ref>' .claude/skills/dflow-work/scripts/dflow.sh; then
     td=$(.claude/skills/dflow-work/scripts/dflow.sh taskdir '<order>') && dirname "$td" || echo "TASKDIR_FAILED"
   else
     echo docs/tasks
   fi
   ```
3. **워크트리**: 남아 있으면 먼저 backends.md 「고아 정리 규칙」 2-1번으로 정리를 시도한다. 그래도 있으면 띄우지 않고
   "해소 워크트리 남아 있음: <경로>" 로 보고한다. `team.conflict` 는 decision `human` 이다.
   ```bash
   W='<MAIN>/.claude/worktrees/dflow-<id8>-resolve'
   [ ! -e "$W" ] || echo "RESOLVE_WT_EXISTS $W"
   ```
   - **tmux**: 팀장 체크아웃에서 만든다.
     ```bash
     git fetch origin
     git worktree add --detach '<MAIN>/.claude/worktrees/dflow-<id8>-resolve' origin/<개발브랜치>
     ```
     그 뒤는 backends.md 「pane(tmux)」 의 spawn 과 같다: 링크, `.dflow-prompt`·`.dflow-run`, pane 띄우기, `.dflow-pane`,
     이름표, **폴더 신뢰 확인 루프**. 달라지는 것은 포인터와 이름표 `w<slot> · 해소 <TSK> <id8>` 뿐이다.
   - **Orca**:
     ```
     orca worktree create --name dflow-<id8>-resolve --agent claude --no-parent \
       --base-branch origin/<개발브랜치> --prompt "<포인터 한 줄>" --json
     ```
     Orca 는 브랜치 워크트리를 만든다. 해소 워커가 부트스트랩 끝에서 `origin/<개발브랜치>` 로 detach 한다
     (`resolve-prompt.md` 「2」). create 뒤 같은 포인터를 `.dflow-prompt` 에도 쓴다.
4. **포인터 한 줄**:
   ```
   <MAIN_CHECKOUT>/.claude/skills/dflow-team/references/resolve-prompt.md 를 읽고 그 규칙대로 실행하라. TSK=<TSK> ID8=<id8> ORDER=<order 전체 UUID> AGENT_ID=<신원>/<host>/w<slot> MAIN_CHECKOUT=<팀장 체크아웃 절대경로> MODEL=<opus|sonnet|default> DEV_BRANCH=<개발브랜치> TASK_DIR=<TASK_DIR> ATTEMPT=<n> ON_REPORT=<0|1>
   ```
   `MODEL` 은 이번 실행의 인자다(해소도 같은 모델). `ON_REPORT` 는 `AUTOMERGE_ON` 이면 `1` 이다.
5. `team.spawn` 을 기록한다. 필드는 「5. 팀원 spawn」 6번과 같고 `spawn_kind` 는 `resolve` 다. 이 줄의 개수가 해소
   카운터이므로 `new` 로 적으면 상한이 동작하지 않는다. id8 은 진행 중으로 영구 제외에 넣는다.
6. 표시 note 를 `해소 중 w<slot> <n>/3` 으로 바꾼다(「3」).

## 3. 표시 heartbeat 대리 호출

해소 워커는 서버를 부르지 않으므로 팀장이 대신 쏜다. 주문 참조는 **전체 UUID** 로 한다. `reported`·`approved` 주문은
목록 캐시에 없을 수 있어 id8 해석이 실패하기 때문이다. `--agent` 는 늘 팀장 자신이다.
```bash
.claude/skills/dflow-work/scripts/dflow.sh heartbeat '<order 전체 UUID>' --agent '<신원>/<host>/lead' --phase merge_conflict --note '<note>' || echo "MC_MARK_FAILED $?"
.claude/skills/dflow-work/scripts/dflow.sh heartbeat '<order 전체 UUID>' --agent '<신원>/<host>/lead' --clear-merge-conflict || echo "MC_MARK_FAILED $?"
```
- 출력은 `MERGE_CONFLICT_SET`·`MERGE_CONFLICT_CLEARED`·`MERGE_CONFLICT_ABSENT` 중 하나다. `ABSENT` 는 오류가 아니다
  (이미 풀렸다).
- note 는 500자 이하로 쓴다. 파일은 첫 하나와 개수만 싣는다.
- `MC_MARK_FAILED` 가 나와도 팀장을 멈추지 않고 보고에 한 줄 적는다. 표시는 부가 기능이다.

| 시점 | note |
|---|---|
| 충돌 접수(해소 큐) | `충돌 <k>개(<첫 파일>…) · 해소 대기 <n>/3` |
| 해소 spawn | `해소 중 w<slot> <n>/3` |
| 해소 워커 `blocked` | `해소 결정 대기: <질문>` |
| 재시도 가능한 실패 | `해소 대기(재시도 가능): <status> <n>/3` |
| 상한 초과·재시도 불가 | `사람 머지 필요: <사유>` |
| `resolved` 조상 확인, 사람 머지 감지 | 해제(`--clear-merge-conflict`) |

## 4. 해소 결과 처리

결과 줄 찾기·해시·`team.result`·`team.blocked` 기록·tmux 회수는 SKILL.md 「3. 결과 처리」 와 같다. 슬롯의
`spawn_kind` 가 `resolve` 면 그 절의 status 표 대신 아래 표를 쓴다. `team.result` 의 `status` 는 `resolved`·`skipped`,
또는 `failed <첫 낱말>` 이다. 해소 워커의 실패에는 첫 낱말을 **늘 붙인다**(`resolve-decide.sh` 가 그 값으로 가른다).
워크트리는 backends.md 「고아 정리 규칙」 2-1번으로 정리한다. 결과 줄 branch 칸이 `-` 여도 1번(부트스트랩 실패)을
쓰지 않는다. SKILL.md 「3. 결과 처리」 에 결과 사유를 문제 기록으로 남기는 블록이 있는 판이면, `resolved` 도 `done`·
`needs-merge` 처럼 사유를 적지 않는다.

| status | 슬롯 | 표시 | 그 밖 |
|---|---|---|---|
| `resolved` | 해제 | 먼저 조상을 확인한다(아래). 참이면 해제하고 `team.conflict`(decision `cleared`)를 남긴다. 거짓이면 표시를 두고 "해소 push 확인 불가: <id8>" 로 보고하며 `team.conflict`(decision `human`)를 남긴다 | 조상이 참이면 선행 계열 일시 제외를 풀고(「4. 승인 스윕」 의 일시 제외 해제), 다음 `team.sweep` 의 `resolved` 에 1을 더하고, **곧바로 승인 스윕**을 한다. 보고는 "해소됨: <TSK> <id8> (<사유>)" 다. 주문이 `approved` 였으면 "해소 내용은 승인 범위 밖 — 머지 커밋·resolution.md 확인" 을 붙인다 |
| `skipped` | 해제 | `pred-reflected.sh '<TASKS>' '<TSK>' '<개발브랜치>'` 가 `REFLECTED` 면 해제하고 `team.conflict` `cleared` 를 남긴다. 아니면 note `해소 건너뜀: <사유>` | "해소 대상 아님: <id8> (<사유>)" 로 보고한다 |
| `blocked` | 유지 | note `해소 결정 대기: <질문>` | SKILL.md 「6. blocked」 통지·답 매칭 그대로다. 통지 문구 앞에 "(해소)" 를 붙인다 |
| `failed push-race`·`failed rate-limit`·`failed no-result` | 해제 | note `해소 대기(재시도 가능): <status> <n>/3` | 다음 스윕에서 충돌이 다시 나면 「1」 이 재시도를 판정한다 |
| 그 밖의 `failed …` | 해제 | note `사람 머지 필요: <status> <사유>` | "사람이 머지해야 함: <id8> (해소 실패 <status>)" 로 보고하고 `team.conflict`(decision `human`)를 남긴다. `failed permission` 은 거부된 명령을 권한 목록 재료로 함께 보고한다 |

`resolved` 의 조상 확인:
```bash
git fetch origin && git merge-base --is-ancestor '<결과 줄 head>' origin/<개발브랜치>; echo "anc=$?"
```
해제를 스윕 보고에 기대지 않는 이유가 있다. 해소 워커가 머지하면 `/dflow-merge` 뒷정리가 원격 agent 브랜치를 지운다.
그래서 다음 스윕에서 그 주문은 후보가 아니고, "머지됨" 줄을 기다리면 표시가 영영 남는다.

## 5. 사람 머지 감지

스윕을 도는 기상마다 한다. 충돌 목록 중 해소 슬롯·해소 큐에 없는 id8 마다, 사람이 손으로 머지했는지 본다.
```bash
jq -rs --arg a '<신원>/<host>/lead' --arg r '<MAIN>' '[.[] | select(.agent == $a and .repo == $r and .event == "team.conflict")] | group_by(.id8) | map(last) | .[] | select(.decision != "cleared") | [.id8, .tsk, .order] | @tsv' ~/.dflow/events.jsonl 2>/dev/null
```
줄마다 「2」 2번 블록으로 `<TASKS>` 를 구한 뒤 `pred-reflected.sh '<TASKS>' '<TSK>' '<개발브랜치>'` 를 부른다.
`REFLECTED` 면 표시를 해제하고 `team.conflict`(decision `cleared`)를 남긴 뒤 "사람 머지 확인: <id8>" 로 보고한다.
그 밖이면 아무것도 하지 않는다.

## 6. 차단기

해소 워커의 **내용 실패** `failed gate`·`failed push-race`·`failed push-hook`·`failed push-other`·`failed not-detached`·`failed dirty-dev-state` 는
`not-assignee` 처럼 **세지도 끊지도 않는다.** 이유: 의미 충돌 두 건이 연달아 `failed gate` 가 되면 차단기가 새 spawn 을
모두 멈춘다. 이 설계가 풀려던 정지를 다시 만드는 셈이다. **환경 실패**(`rate-limit`·`no-result`·`deps`·`permission`·
부트스트랩 실패 값)만 워커와 같이 센다. 실패가 아닌 결과(`resolved`·`skipped`·`blocked`)는 워커와 같이 연속 수를
0으로 되돌린다. 재구성은 id8 마다 마지막 `team.spawn` 의 `spawn_kind` 로 이 규칙을 적용한다.

## 7. 마감

해소 워커도 다른 팀원과 같이 기다린다(「7. 마감」 2번). 마감은 남은 `merge_conflict` 표시를 지우지 않는다. 사람이 보아야
하기 때문이다. 마감 보고에 충돌 목록(「5」 jq)을 함께 적는다.
````

- [ ] **Step 4: SKILL.md 를 고친다 (원문 → 바꾼 문장)**

`.claude/skills/dflow-team/SKILL.md`. 모두 원문 문자열로 찾는다(Task 0 이 한 번씩 있음을 확인했다).

E1. 원문 `「2. 기상과 감시」「3. 결과 처리」「6. blocked」「7. 마감」 과 \`references/events.md\`, \`references/backends.md\` 의`
→ `「2. 기상과 감시」「3. 결과 처리」「6. blocked」「7. 마감」 과 \`references/events.md\`, \`references/merge-conflict.md\`, \`references/backends.md\` 의`

E2. 원문 `` `failed not-assignee`·`cancelled` 는 세지도 끊지도 않고 건너뛴다) ``
→ `` `failed not-assignee`·`cancelled`·해소 워커의 내용 실패(`references/merge-conflict.md` 「6. 차단기」)는 세지도 끊지도 않고 건너뛴다) ``

E3. 원문 두 줄
```
- `team.spawn` 의 `slot`·`id8`·`worktree`·`handle` 로 슬롯과 작업을 잇는다. 아직 브랜치를 만들지 않은 Phase 01
  의 팀원도 이것으로 id8 을 안다.
```
바로 아래에 더한다.
```
- `spawn_kind` 가 `resolve` 인 `team.spawn` 도 같게 잇는다. 해소 워커다(「5-2. 해소 spawn」). 워크트리는
  `<MAIN>/.claude/worktrees/dflow-<id8>-resolve` 이고 detached 라 브랜치가 없다. 결과는 `references/merge-conflict.md`
  「4. 해소 결과 처리」 표로 처리한다. 고아 스캔에서는 backends.md 「고아 정리 규칙」 2-1번으로 가르며 "재개 가능" 으로
  보내지 않는다. 워커 자동 재시작(H)의 대상도 아니다.
```

E4. 원문 `` `needs-merge`·`skipped`·`failed`·`cancelled`) `` (두 곳: 「재구성 규칙」 의 "살아 있는 팀원" 과 고아 스캔 2번) → 두 곳 모두
`` `needs-merge`·`skipped`·`failed`·`cancelled`·`resolved`) `` (Edit 의 `replace_all: true`. 바꾸기 전에 `grep -cF` 로 2 인지 확인한다)

E5. 원문 `- **부트스트랩 실패 정리**: \`.result\` 의 branch 가 \`-\`(브랜치를 만들기 전에 끝남)이면 backends.md`
→ `- **부트스트랩 실패 정리**(해소 워크트리 \`dflow-<id8>-resolve\` 는 예외 — 「고아 정리 규칙」 2-1번): \`.result\` 의 branch 가 \`-\`(브랜치를 만들기 전에 끝남)이면 backends.md`

E6. 원문 `4. 빈 슬롯이 있고 차단기가 허락하면 **재개 대상을 먼저**(「5-1. 재개 spawn」), 그 다음 대기 큐 맨 앞부터`
→ `4. 빈 슬롯이 있고 차단기가 허락하면 **재개 대상을 먼저**(「5-1. 재개 spawn」), 그 다음 **해소 큐**(「5-2. 해소 spawn」), 그 다음 대기 큐 맨 앞부터`

E7. 원문 `로 같은 처리를 한다(아래 「선행 사전 검사」).`
→ `로 같은 처리를 한다(아래 「선행 사전 검사」). \`deps_unmet\` 이 비었고 \`deps_nohead\` 가 비어 있지 않으면 아래 「선행 반영 사전 검사」 를 거친다.`

E8. 원문 `            deps_unmet: [.depends_evidence[]? | select(has("reached") and .reached == false) | .external_ref]}'`
→
```
            deps_unmet: [.depends_evidence[]? | select(has("reached") and .reached == false) | .external_ref],
            deps_nohead: [.depends_evidence[]? | select(.reached == true and ((.head_sha // "") == "")) | .external_ref]}'
```

E9. 원문 `` `state.json` 의 `phase=merged` 로 거르지 않는다. 이유: 진행 중인 선행이라도 ``
→ `` `state.json` 의 `phase=merged` 로 거르지 않는다(단, 행 G 갈래 2 의 반영 확인은 아래 「선행 반영 사전 검사」 가 사전에 한다). 이유: 진행 중인 선행이라도 ``
그리고 원문 `해제(「3. 결과 처리」)의 선행 계열에 그대로 들어간다.` 바로 아래에 빈 줄과 문단을 더한다.
````markdown

**선행 반영 사전 검사**(`deps_nohead`, 2026-09-23): `deps_unmet` 이 비었고 `deps_nohead`(서버 `reached` 는 참인데
`head_sha` 가 없는 선행, 즉 완료 보고 뒤 승인 전)가 비어 있지 않으면 워커 행 G 갈래 2 의 반영 확인을 여기서 먼저 한다.
그대로 띄우면 워커가 행 G 에서 `skipped 선행 승인 대기` 로 끝나는 확정 skip 이고, 30분마다 팀원 세션 하나를 쓴다.
`head_sha` 가 있는 선행은 거르지 않는다(워커 행 B 가 그 기점에 스택한다). `git fetch origin` 은 기상마다 한 번만 한다.
`<TASKS>` 는 `references/merge-conflict.md` 「2」 2번 블록으로 구한다. `TASKDIR_FAILED` 면 사유 `작업 폴더 해석 실패` 로
일시 제외한다. 구한 작업 폴더는 「5. 팀원 spawn」 이 다시 쓴다(두 번 부르지 않는다).
```bash
.claude/skills/dflow-dev/scripts/pred-reflected.sh '<TASKS>' '<선행TSK>' '<개발브랜치>'; echo "rc=$?"
```
`<선행TSK>` 는 `deps_nohead` 원소의 마지막 `/` 뒤다.
- 하나라도 `NOT_REFLECTED`(rc=1)이면 띄우지 않는다. 사유 `선행 미반영(사전 검사: <ref…>)` 로 일시 제외에 넣고
  `team.result`(slot `-`, status `skipped`)를 남긴다. 그 선행이 해소 큐나 해소 슬롯에 있으면(TSK 로 대조) 사유를
  `선행 미반영(머지 충돌 해소 중: <ref>)` 로 쓴다. 두 문구 모두 「선행」 으로 시작해 일시 제외 해제의 선행 계열에 든다.
- `UNKNOWN`(rc=2) 은 거르지 않고 워커에 맡긴다. 위 「선행 사전 검사」 의 "판정 불가를 미충족으로 단정하지 않는다" 와 같다.
- 모두 `REFLECTED` 면 그대로 spawn 한다.
````

E10. 원문 `- **그 자리에서 정리하는 이유**: git 은 다른 워크트리가 체크아웃한 브랜치를 지우지 못한다. 워크트리를 마감까지` 바로 **위**에 더한다.
```
**해소 워커의 결과**: 슬롯의 `spawn_kind` 가 `resolve`(워크트리 `dflow-<id8>-resolve`)면 위 표가 아니라
`references/merge-conflict.md` 「4. 해소 결과 처리」 표를 따른다. 결과 줄 찾기·해시·`team.result`·`team.blocked` 기록·tmux
회수는 위와 같다.

```

E11. 원문 `` (`no-result`·`rate-limit` 포함, `not-assignee` 제외) ``
→ `` (`no-result`·`rate-limit` 포함, `not-assignee`·해소 워커의 내용 실패(`references/merge-conflict.md` 「6. 차단기」) 제외) ``

E12. 원문 세 줄
```
- **머지 충돌**: `/dflow-merge` 가 `git merge --abort` 로 되돌리고 "머지 실패(충돌)" 로 보고한 뒤 다음 후보로
  간다. 팀장은 그 id8 을 "사람이 머지해야 함" 으로 보고한다. 팀장 체크아웃은 깨끗하게 남아 다음 기상의 전제가
  깨지지 않는다.
```
→
```
- **머지 충돌**: `/dflow-merge` 가 충돌 파일 목록을 읽고 `git merge --abort` 로 되돌린 뒤 "머지 실패(충돌)" 로
  보고하고(파일 목록 `<파일,…>` 동반) 다음 후보로 간다. 팀장은 그 id8 을 「4-1. 머지 충돌 해소」 로 넘긴다. 해소하지
  못하는 경우(다른 신원의 주문·상한·재시도 불가)만 "사람이 머지해야 함" 으로 보고한다. 팀장 체크아웃은 깨끗하게 남아
  다음 기상의 전제가 깨지지 않는다.
```

E13. 원문 두 줄을 각각 바꾼다.
- `- **자동 머지 뒤 일시 제외 해제**: 자동 머지 스윕이 "머지됨(승인 전)" 을 한 건이라도 냈으면, 일시 제외 가운데 사유가`
  → `- **자동 머지 뒤 일시 제외 해제**: 스윕이 "머지됨(승인 전)"·"머지됨" 을 한 건이라도 냈거나 해소 워커가 \`resolved\` 로 끝났으면(「5-2」), 일시 제외 가운데 사유가`
- `  선행 계열(선행 미충족·선행 미승인·선행 승인 대기·claim exit 4·공통 기점 없음)인 id8 을 목록에서 빼고, 재기동 조건`
  → `  선행 계열(선행 미충족·선행 미승인·선행 승인 대기·claim exit 4·공통 기점 없음·선행 미반영)인 id8 을 목록에서 빼고, 재기동 조건`

E14. 원문 `` - `team.sweep`(merged, waiting, rejected 개수)을 기록한다. ``
→ `` - `team.sweep`(merged, waiting, rejected, resolved 개수)을 기록한다. `resolved` 는 직전 스윕 뒤 해소 워커의 `resolved` 가 조상 확인까지 통과한 수다(없으면 0). ``

E15. 원문 `## 5. 팀원 spawn` 바로 **위**에 절을 더한다.
````markdown
### 4-1. 머지 충돌 해소

스윕이 "머지 실패(충돌)" 을 낸 id8 은 `references/merge-conflict.md` 「1. 충돌 접수」 로 넘긴다. 해소는 이 신원의
주문(`mine`)만, 한 작업에 3번까지, 같은 기준에서 다시 충돌한 것이 아닐 때만 한다. 해소 큐에 넣고 「5-2. 해소 spawn」 이
띄운다. 나머지는 "사람이 머지해야 함" 으로 보고한다. 두 경우 모두 좌석표에 `merge_conflict` 표시를 대리로 쏜다. 충돌
목록은 `team.conflict` 로 남는다. 사람이 손으로 머지하면 다음 스윕 기상의 「5. 사람 머지 감지」 가 표시를 푼다. 절차
정본은 그 문서이며 Bash `cat` 으로 읽는다.
```bash
cat .claude/skills/dflow-team/references/merge-conflict.md
```

````

E16. 원문 `같은 작업을 다시 띄우는 것은 셋뿐이다.`
→ `같은 작업을 다시 띄우는 것은 넷뿐이다(넷째는 「5-2. 해소 spawn」 의 해소 워커다. 주문이 \`reported\`·\`approved\` 라 개발 재spawn 이 아니며 \`resolve-decide.sh\` 판정 안에서만 띄운다).`

E17. 원문 `## 6. blocked` 바로 **위**에 절을 더한다.
````markdown
### 5-2. 해소 spawn

해소 큐의 작업을 해소 전용 워커로 띄운다. 워크트리는 `origin/<기본브랜치>` 에 detach 한
`<MAIN>/.claude/worktrees/dflow-<id8>-resolve` 이고, 포인터는 `references/resolve-prompt.md` 를 가리키며, `team.spawn` 의
`spawn_kind` 는 `resolve` 다. 재개 다음·대기 큐보다 먼저 띄우고, 동시에는 `max(1, ⌊인원/2⌋)` 까지다. claim 하지 않는다.
tmux·Orca 띄우기, 신뢰 확인 루프, 이름표(`w<slot> · 해소 <TSK> <id8>`)는 5번과 같다. 절차 정본은
`references/merge-conflict.md` 「2. 해소 spawn」 이고 결과 처리는 같은 문서 「4」 다.

````

E18. 원문 `   무한정 붙잡지 않게 한다. 팀원은 팀장이 끝나도 자기 pane 이나 탭에서 계속 돈다.` 바로 아래에 더한다.
```
   해소 워커도 같은 규칙으로 기다린다. 마감은 남은 `merge_conflict` 표시를 지우지 않는다(사람이 보아야 한다).
```

E19. 「금지」 의 원문 세 줄
```
- 팀장이 작업을 claim·progress·done 하는 것. 서버 쓰기는 팀원 몫이다(스윕의 머지만 팀장이 한다). 재개도
  마찬가지다. 서버가 이미 `claimed` 이므로 다시 claim 하지 않으며, 끊긴 Phase 를 잇는 것은 이어받은 워커의
  `/dflow-dev --worker` 다.
```
바로 아래에 더한다.
```
  예외 둘(2026-09-23 머지 충돌): (1) 머지 충돌 표시 heartbeat(`merge_conflict` 설정·해제, `references/merge-conflict.md`
  「3」)는 팀장이 한다. 주문 상태를 바꾸지 않고 표시 열만 쓴다. (2) 팀장이 띄운 해소 워커의 `/dflow-merge --resolve` 가
  개발 브랜치에 한 건을 머지·push 한다. "스윕의 머지만 팀장이 한다" 의 유일한 예외다. 경합은 두 쪽 모두
  non-fast-forward 거부로 드러나고, force push 는 여전히 금지다.
```

E20. 원문 `- 같은 작업의 재spawn. 예외는 셋이다.`
→ `- 같은 작업의 재spawn. 예외는 넷이다(넷째: 「5-2. 해소 spawn」 의 해소 워커, \`resolve-decide.sh\` 판정 안에서만).`

- [ ] **Step 5: events·backends·help 를 고친다**

`.claude/skills/dflow-team/references/events.md`:
- 표 원문 `` | `team.spawn` | 「5. 팀원 spawn」 6번, 「5-1. 재개 spawn」 7번, 「1. 시작」 4번(이어받은 슬롯 재기록) | `slot`, `id8`, `worktree`, `handle`, `spawn_kind` | ``
  → `` | `team.spawn` | 「5. 팀원 spawn」 6번, 「5-1. 재개 spawn」 7번, 「5-2. 해소 spawn」(merge-conflict.md 「2」 5번), 「1. 시작」 4번(이어받은 슬롯 재기록) | `slot`, `id8`, `worktree`, `handle`, `spawn_kind` | ``
- 표 원문 `` | `team.sweep` | 「4. 승인 스윕」 | `merged`, `waiting`, `rejected` | ``
  → 두 줄로 바꾼다.
```
| `team.sweep` | 「4. 승인 스윕」 | `merged`, `waiting`, `rejected`, `resolved` |
| `team.conflict` | 「4-1. 머지 충돌 해소」(merge-conflict.md 「1」「4」「5」) | `id8`, `decision`, `files` |
```
- 원문 `` `spawn_kind` 는 세 값 중 하나인 문자열이다. `new` 는 「5. 팀원 spawn」 의 새 작업, `resume` 은 ``
  → `` `spawn_kind` 는 네 값 중 하나인 문자열이다. `resolve` 는 「5-2. 해소 spawn」 의 해소 워커이며, 그 개수가 해소 카운터다(초기화하지 않는다, `scripts/resolve-decide.sh`). 재개 재시도 계산은 `resolve` 줄을 세지 않는다. `new` 는 「5. 팀원 spawn」 의 새 작업, `resume` 은 ``
- 원문 `` 결과 줄 없이 판정한 것(pane 이 죽었는데 `.result` 도 pane 화면의 결과 줄도 없음)은 `failed no-result`(hash `-`)다. `` 바로 아래에 더한다.
```
  해소 워커(`spawn_kind: resolve`)의 `status` 는 `resolved`·`skipped`·`failed <첫 낱말>`(첫 낱말을 늘 붙인다)이다.
```
- 원문 `` - `team.sweep`: 세 필드 모두 개수(숫자)다. ``
  → 두 줄로 바꾼다.
```
- `team.sweep`: 네 필드 모두 개수(숫자)다. `resolved` 는 직전 스윕 뒤 해소 머지가 조상 확인까지 통과한 수다.
- `team.conflict`: `decision` 은 `queued`(해소 큐에 넣음)·`human`(사람 몫)·`cleared`(표시 해제) 중 하나, `files` 는 충돌 파일 목록(쉼표로 이음, 모르면 `-`)이다. id8 마다 마지막 `decision` 이 `cleared` 가 아니면 충돌 목록에 남는다(merge-conflict.md 「5」).
```
- 가드 jq 의 원문 `"team.sweep":["merged","waiting","rejected"]` → `"team.sweep":["merged","waiting","rejected","resolved"],"team.conflict":["id8","decision","files"]`
  (H 과제가 같은 줄에 `"team.lost":[…]` 를 더한다. 머지 충돌이 나면 두 키를 모두 남긴다.)
- 원문 `` `slot` 은 문자열(`2` 또는 `-`)로 쓴다. `team.start` 의 `slots` 와 `team.sweep` 의 세 필드는 `--argjson` 숫자이고, ``
  → `` `slot` 은 문자열(`2` 또는 `-`)로 쓴다. `team.start` 의 `slots` 와 `team.sweep` 의 네 필드는 `--argjson` 숫자이고, ``
- 원문 `` `team.spawn` 의 `spawn_kind` 는 `--arg` 문자열이며 `new`·`resume`·`readopt` 밖의 값을 쓰지 않는다. ``
  → `` `team.spawn` 의 `spawn_kind` 는 `--arg` 문자열이며 `new`·`resume`·`readopt`·`resolve` 밖의 값을 쓰지 않는다. ``

`.claude/skills/dflow-team/references/backends.md` 의 「고아 정리 규칙」 원문 `3. 하나라도 거짓이면 지우지 않는다. 그 다음 SKILL.md 「팀장 상태」 고아 스캔의 **"재개 가능"** 조건을 보고` 바로 **위**에 더한다.
````markdown
2-1. **해소 워크트리**(이름 `dflow-<id8>-resolve`, detached, SKILL.md 「5-2. 해소 spawn」): 1·2번 대신 아래 둘이 모두
   참일 때 정리한다. 결과 줄 branch 칸이 늘 `-` 여도 1번(부트스트랩 실패)을 쓰지 않는다.
   ```bash
   git -C <워크트리> status --porcelain --untracked-files=all \
     | grep -v -E '^\?\? (\.dflow-(agent|prompt|pane|run)|\.env|\.dflow|\.dflow\.local|\.claude/skills(/dflow-(dev|work|merge|team)(/.*)?)?|<TASK_DIR>/\.result)$'
   git fetch origin
   git -C <워크트리> merge-base --is-ancestor HEAD origin/<개발브랜치>
   ```
   첫 명령 출력이 비고 둘째가 0 이면 지운다(push 했거나 `reset --keep` 으로 버렸다. 잃을 것이 없다). tmux 는
   `git worktree remove --force <경로>`, Orca 는 `orca worktree rm --worktree path:<경로> --force` 다. 아니면 3번으로
   간다. 해소 워크트리는 "재개 가능" 이 아니므로 `parked` 로 바꾸고 "멈춤" 표에 넣는다. 사유는 결과 줄 status
   (`blocked` 해소 중 멈춤 등)다. 살아 있는 해소 워커(`blocked` 포함)의 워크트리는 4번대로 지우지 않는다.

````

`.claude/skills/dflow-team/references/help.md` 파일 끝에 더한다.
```markdown

## 머지 충돌 해소 (2026-09-23)

승인 스윕이 개발 브랜치와 충돌한 작업을 만나고 그 작업이 이 신원의 것이면, 해소 전용 팀원(`w<slot> · 해소 <TSK> <id8>`)을
띄워 개발 브랜치 위 머지 커밋에서 푼다. 한 작업에 3번까지, 동시에는 인원의 절반(최소 1)까지다. 풀지 못하면
"사람이 머지해야 함" 으로 보고하고 좌석표에 「머지 충돌」 을 띄운다. 사람이 손으로 머지하면 다음 스윕이 표시를 푼다.
새 인자는 없다.
```

- [ ] **Step 6: 통과를 확인한다**

Run: `npx vitest run tests/skills`
Expected: PASS(기준선 대비 신규 실패 0). 특히 `dflow-team.test.ts`(기존 문자열 `"머지 실패(충돌)"`·`"사람이 머지해야 함"`)·`dflow-team-depends-precheck.test.ts`(show 필터 추출 정규식 `\{order: \.order\.id[\s\S]*?\})'` 가 새 `deps_nohead` 줄까지 잡는다)·`dflow-team-shell-blocks.test.ts`(새 두 문서의 bash 블록 sh·bash·zsh 파싱)·`dflow-team-lease.test.ts` 가 초록이어야 한다.

- [ ] **Step 7: 커밋**

```bash
git add .claude/skills/dflow-team/references/merge-conflict.md .claude/skills/dflow-team/SKILL.md .claude/skills/dflow-team/references/events.md .claude/skills/dflow-team/references/backends.md .claude/skills/dflow-team/references/help.md tests/skills/dflow-team-merge-conflict.test.ts tests/skills/dflow-team-depends-precheck.test.ts tests/skills/dflow-team-shell-blocks.test.ts
git commit -m "feat(dflow-team): 팀장이 머지 충돌을 해소 워커에 넘기고 미반영 선행의 후속을 미리 거른다" -m "충돌이 나면 사람이 올 때까지 의존 사슬 전체가 멈췄고, 반영 안 된 선행의 후속은 30분마다 팀원을 띄워 skipped 로 끝났다. 해소를 재개 다음 순서로 띄우고, 워커 행 G 와 같은 판정으로 후속을 사전에 거른다. 절차는 새 reference 에 모아 병행 세션의 SKILL.md 편집과 덜 부딪치게 한다." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA"
```

---
### Task 9: 설계 단계 예방 — `/dflow-wbs` 「계약 Task 의 공유 파일 규칙」

**Files:**
- Modify: `.claude/skills/dflow-wbs/SKILL.md` (「계약 전용 Task 관례」 목록 끝, 「의존 그래프 구조 예외」 뒤 새 절, 출력 형식 예의 계약 Task acceptance, 실행 플로우 10번)
- Test: `tests/skills/dflow-wbs-contract-rules.test.ts`(신규)

**Interfaces:**
- Produces: 생성되는 `tags: contract` Task 의 acceptance 끝에 붙는 고정 네 줄과, 기능 Task(`dev`) requirements 에 붙는 한 줄(아래 Step 3 의 문구 그대로). 워커는 `/dflow-wbs` 를 읽지 않으므로, 규칙이 워커에게 닿는 길은 이 줄들뿐이다.
- `dflow-wbs-nlevel` 은 이 과제에서 바꾸지 않는다(스펙 §3 은 `/dflow-wbs` 만 다룬다).

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/skills/dflow-wbs-contract-rules.test.ts`:

```ts
// tests/skills/dflow-wbs-contract-rules.test.ts
// 병렬 머지 충돌 예방(2026-09-23 §3) — 계약 Task 규칙이 /dflow-wbs 문서와 생성 산출물(acceptance)에 실린다.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const WBS = readFileSync(join(process.cwd(), '.claude/skills/dflow-wbs/SKILL.md'), 'utf8')
const FIXED = [
  '- 공유 시험은 틀의 존재·탑재 순서만 단정한다. 빈 라우터·스텁 목록(`STUBS` 등)을 단정하지 않는다',
  '- 기능 Task 마다 자기 시험 파일과 소유 파일을 design.md `## 기능 Task 편집 지점` 에 적고, 두 Task 가 한 파일을 나눠 갖지 않는다',
  '- 등록(라우트·핸들러 목록)은 자동 수집이며 기능 Task 가 공유 진입점에 줄을 더하지 않아도 된다',
  '- 계약 문서가 지정한 파일(공용 시험 헬퍼 포함)이 모두 있다',
]

describe('/dflow-wbs — 계약 Task 의 공유 파일 규칙', () => {
  it('절이 있고 C1~C7 이 있다', () => {
    expect(WBS).toContain('### 계약 Task 의 공유 파일 규칙')
    for (const c of ['| C1 |', '| C2 |', '| C3 |', '| C4 |', '| C5 |', '| C6 |', '| C7 |']) expect(WBS).toContain(c)
  })
  it('절은 「의존 그래프 구조 예외」 뒤, 엑셀 export 앞에 있다(프로그램 리스트 골격 뒤)', () => {
    const at = WBS.indexOf('### 계약 Task 의 공유 파일 규칙')
    expect(at).toBeGreaterThan(WBS.indexOf('⚠️ **의존 그래프 구조 예외**'))
    expect(at).toBeLessThan(WBS.indexOf('## 엑셀 export'))
  })
  it('acceptance 고정 네 줄과 기능 Task requirements 한 줄을 그대로 싣는다', () => {
    const sec = WBS.slice(WBS.indexOf('### 계약 Task 의 공유 파일 규칙'), WBS.indexOf('## 엑셀 export'))
    for (const l of FIXED) expect(sec).toContain(l)
    expect(sec).toContain('- 계약 Task design.md 「기능 Task 편집 지점」 의 자기 소유 파일만 고친다')
  })
  it('PRD 모드 관례가 그 절을 잇고, 출력 예의 계약 Task 에도 네 줄이 있다', () => {
    expect(WBS).toContain('- 공유 파일 규칙(C1~C7)과 acceptance 고정 네 줄은 아래 「계약 Task 의 공유 파일 규칙」 절을 따른다')
    const example = WBS.slice(WBS.indexOf('### TSK-01-02: users 스키마 + User 타입 정의 (계약 전용)'))
    for (const l of FIXED) expect(example).toContain('  ' + l)
  })
  it('의존 그래프 검증(자기 리뷰 게이트)에 계약 acceptance 네 줄 확인이 있다', () => {
    expect(WBS).toContain('계약 Task(`tags: contract`)마다 acceptance 에 「계약 Task 의 공유 파일 규칙」 의 고정 네 줄이 있는지')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/skills/dflow-wbs-contract-rules.test.ts`
Expected: FAIL 다섯 개.

- [ ] **Step 3: 문서를 고친다**

`.claude/skills/dflow-wbs/SKILL.md`:

(a) 원문 `- 유일한 depends = 해당 DB(ERD)/설계 분리 Task` 바로 아래에 더한다.
```
- 공유 파일 규칙(C1~C7)과 acceptance 고정 네 줄은 아래 「계약 Task 의 공유 파일 규칙」 절을 따른다(PRD·프로그램 리스트 모드 공통)
```

(b) 원문 `⚠️ **의존 그래프 구조 예외**` 로 시작하는 문단(그 한 줄) 바로 아래에 빈 줄과 새 절을 더한다.
````markdown

### 계약 Task 의 공유 파일 규칙

병렬 기능 Task 가 공유 파일의 같은 줄을 서로 다르게 고쳐 개발 브랜치 머지에서 충돌하는 것을 설계 단계에서 막는다
(2026-09-21 mdm-dict-v2: 팀원 8명 중 6건 충돌, 설계 docs/superpowers/specs/2026-09-23-parallel-merge-conflict-design.md §3).
두 모드의 계약 Task 가 모두 이 절을 따른다.

| # | 규칙 |
|---|---|
| C1 | **기능 Task 는 자기 소유 파일만 고친다.** 계약 Task 는 design.md 에 `## 기능 Task 편집 지점` 표(기능 Task → 소유 파일)를 두고, 두 기능 Task 가 같은 파일을 소유하지 않게 한다. 공유 파일은 이 표에 나오지 않아야 한다 |
| C2 | **등록은 자동 수집한다.** 라우트·핸들러·마이그레이션 같은 목록은 디렉터리 스캔(`readdirSync`·glob)이나 파일 이름 관례로 모은다. 기능 Task 가 `server.js`·`routes/index.js` 의 import 블록이나 배열에 줄을 더하지 않게 한다 |
| C3 | **계약 시험은 틀의 존재만 단정한다.** export 가 있다, 시그니처가 맞다, 탑재 순서가 맞다는 단정한다. "라우터가 비어 있다"·"이 함수는 아직 `not implemented` 다" 는 단정하지 않는다 |
| C4 | **스텁 판정은 각 함수의 시험이 스스로 한다.** 계약 Task 는 기능 Task 마다 자기 시험 파일(`tests/routes/<name>.test.*`)을 빈 틀(`it.todo`)로 만들어 둔다. 기능 Task 는 그 파일만 채운다. 공유 목록(`STUBS`·`IMPLEMENTED`)을 두지 않는다 |
| C5 | **계약 문서가 지정한 파일은 계약 Task 가 모두 만든다.** 공용 시험 헬퍼(`tests/helpers/*`)가 대표다 |
| C6 | **횡단 관심사는 계약에서 먼저 연다.** 인증 가드처럼 모든 라우트 동작을 바꾸는 Task 가 있으면, 계약 Task 가 시험 헬퍼에 가드 헤더를 처음부터 싣거나 그 Task 를 기능 Task 들의 선행으로 건다 |
| C7 | 공유 파일을 **먼저 들어온 쪽이 새 규약으로 바꾸지 않는다.** 규약이 필요하면 계약 Task 가 처음부터 정한다 |

C1·C4 는 강제 진행 설계(`2026-09-23-force-progress-design.md`) §3.4 1번과 같은 방향이다. 그쪽은 스텁을 둘 **자리**를 다루고,
이 절은 계약 Task 가 만드는 **시험·등록 구조**를 다룬다.

**생성 산출물에 싣는다.** 계약 Task 를 구현하는 워커는 이 스킬을 읽지 않으므로, 규칙은 Task 본문에 있어야 워커에게
닿는다. `tags: contract` Task 의 `acceptance` 끝에 아래 네 줄을 고정으로 붙인다(PRD·프로그램 리스트 모드 공통).
```
- 공유 시험은 틀의 존재·탑재 순서만 단정한다. 빈 라우터·스텁 목록(`STUBS` 등)을 단정하지 않는다
- 기능 Task 마다 자기 시험 파일과 소유 파일을 design.md `## 기능 Task 편집 지점` 에 적고, 두 Task 가 한 파일을 나눠 갖지 않는다
- 등록(라우트·핸들러 목록)은 자동 수집이며 기능 Task 가 공유 진입점에 줄을 더하지 않아도 된다
- 계약 문서가 지정한 파일(공용 시험 헬퍼 포함)이 모두 있다
```
기능 Task(`category: dev`)의 `requirements` 끝에는 한 줄을 붙인다.
```
- 계약 Task design.md 「기능 Task 편집 지점」 의 자기 소유 파일만 고친다
```
명세 블록 파싱 계약(필드 줄 열 0, bullet 2칸 들여쓰기)을 그대로 따른다.
````

(c) 출력 형식 예의 원문 `  - 실행 로직 없음 (contract-only)` 바로 아래에 네 줄을 더한다(2칸 들여쓰기).
```
  - 공유 시험은 틀의 존재·탑재 순서만 단정한다. 빈 라우터·스텁 목록(`STUBS` 등)을 단정하지 않는다
  - 기능 Task 마다 자기 시험 파일과 소유 파일을 design.md `## 기능 Task 편집 지점` 에 적고, 두 Task 가 한 파일을 나눠 갖지 않는다
  - 등록(라우트·핸들러 목록)은 자동 수집이며 기능 Task 가 공유 진입점에 줄을 더하지 않아도 된다
  - 계약 문서가 지정한 파일(공용 시험 헬퍼 포함)이 모두 있다
```

(d) 실행 플로우 10번의 원문 `    \`max_chain_depth > 3\`(기능 구간 내부 기준, 공정 양끝 +2 는 구조 비용 허용) 또는 \`fan_in ≥ 3\` → 계약 추출 재검토. 결과를 \`## 의존 그래프\` 챕터에 기록 (후보 없어도 "후보 없음" 명시).` 바로 아래에 더한다.
```
    같은 자리에서 계약 Task(`tags: contract`)마다 acceptance 에 「계약 Task 의 공유 파일 규칙」 의 고정 네 줄이 있는지,
    기능 Task(`dev`)마다 requirements 에 편집 지점 한 줄이 있는지 확인한다. 빠졌으면 고친 뒤 다시 검증한다(자기 리뷰 게이트).
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/skills/dflow-wbs-contract-rules.test.ts tests/skills`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-wbs/SKILL.md tests/skills/dflow-wbs-contract-rules.test.ts
git commit -m "feat(dflow-wbs): 계약 Task 가 기능 Task 의 공유 파일 충돌을 설계 단계에서 막게 한다" -m "2026-09-21 충돌의 뿌리는 계약 시험이 빈 라우터·스텁 목록을 단정해 기능 Task 마다 같은 줄을 고치게 한 데 있다. 워커는 이 스킬을 읽지 않으므로 규칙을 계약 Task acceptance 고정 네 줄로 싣는다." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA"
```

---

### Task 10: 통합·staging 반영·화면 확인 (컨트롤러가 직접)

**Files:** 없음(검증과 반영만)

- [ ] **Step 1: 전체 검증**

```bash
cd /Users/jji/project/wbs-web-mergefix
npx vitest run 2>&1 | tail -8
npm run lint
npx tsc --noEmit -p .
npm run build 2>&1 | tail -5
```
Expected: vitest 는 Task 0 기준선 대비 신규 실패 0, 린트·타입 오류 0, 빌드 성공.

- [ ] **Step 2: 최신 staging·main 을 받아 합친다(staging push 전 규칙)**

```bash
git fetch -q origin
git merge --no-edit origin/staging
git merge --no-edit origin/main
```
충돌이 나면 이렇게 푼다.
- `references/events.md` 가드 줄: H(`feat/worker-auto-restart`)의 `"team.lost":[…]` 와 이 계획의 `"team.sweep":[…,"resolved"],"team.conflict":[…]` 를 **모두 남긴다.** 옆 문장의 값 개수("네 값"·"네 필드")는 합친 결과에 맞춘다.
- 계약 버전(`externalApi.ts`·`dflow.sh`·`api-contract.md`·`me-route.test.ts`): 과제 C(2.6)가 이미 들어와 있으면 2.7 을 유지한다. C 가 아직 없으면 2.7 을 유지하고, C 가 뒤에 들어갈 때 2.8 로 가도록 C 쪽에 알린다. 네 곳은 늘 같은 값이어야 한다.
- `dflow-team/SKILL.md`·`dflow.sh`·`dflow-dev/SKILL.md`: 병행 세션의 줄은 그대로 두고, 이 계획이 바꾼 문구(E1~E20, Task 4·5)만 다시 적용한다. 작업 폴더 과제(`taskdir`)가 들어왔으면 「선행 반영 사전 검사」 와 merge-conflict.md 「2」 2번 블록이 그 판에서 `taskdir` 갈래로 도는지 `grep -q '^  taskdir <ref>' .claude/skills/dflow-work/scripts/dflow.sh && echo HAS_TASKDIR` 로 확인한다.

머지 뒤 Step 1 을 다시 돈다.

- [ ] **Step 3: staging 으로 push**

```bash
git push -u origin HEAD
git push origin HEAD:staging
```
Expected: pre-push 훅 G1~G4 통과(마이그레이션 없음). 훅 우회(`SKIP_GUARD`)와 force push 는 하지 않는다. non-fast-forward 로 거부되면 Step 2 부터 다시 한다.

- [ ] **Step 4: staging 화면 확인 (ego-browser)**

1. Vercel 의 staging 배포(dflow-staging.vercel.app)가 끝났는지 확인한다.
2. 스테이징 DB 에서 `reported` 주문 하나와 `approved` 주문 하나(에이전트 위임 항목, 7일 창 안)를 골라 표시를 넣는다. 파일은 스크래치 디렉터리에 만들고 커밋하지 않는다.
   ```sql
   update public.agent_work_orders set heartbeat_phase = 'merge_conflict', heartbeat_note = '충돌 2개(src/a.ts…) · 해소 중 w2 1/3'
    where id = '<reported 주문 UUID>' and status = 'reported';
   update public.agent_work_orders set heartbeat_phase = 'merge_conflict', heartbeat_note = '사람 머지 필요: 해소 상한(3/3)'
    where id = '<approved 주문 UUID>' and status = 'approved';
   ```
   `npm run db:apply -- <스크래치 SQL 경로> --target staging` 으로 적용한다. `db-apply` 가 migrations 밖 경로를 거부하면 Supabase 대시보드(스테이징 프로젝트) SQL 편집기에서 같은 문장을 실행한다. **운영 DB 에는 하지 않는다.**
3. ego-browser 로 staging 오피스(에이전트 보기)를 연다. 두 좌석에 자홍 「머지 충돌」 말풍선이 있고 네 점이 없는지 본다. 확인 필요 띠에서 두 줄이 BLOCKED 바로 뒤에 `머지 충돌 · <note>` 로 나오는지 본다. 좌석을 누르면 상세에 `머지 충돌: <note>` 인용이 나오는지 본다. 그 주문을 선행으로 갖는 ready 좌석이 있으면 대기 사유가 「선행 머지 충돌」 인지 본다. 화면을 캡처해 둔다.
4. 되돌린다.
   ```sql
   update public.agent_work_orders set heartbeat_phase = null, heartbeat_note = null
    where id in ('<reported 주문 UUID>', '<approved 주문 UUID>') and heartbeat_phase = 'merge_conflict';
   ```

- [ ] **Step 5: 스킬 흐름 리허설(가능하면)**

샘플 리포에서 같은 줄을 고치는 Task 두 건을 자동 머지(`DFLOW_AUTOMERGE=1`)로 `/dflow-team 2` 에 돌린다. 한 건이 충돌하면 해소 워커가 `resolved` 로 끝나고, 표시가 풀리고, 후속이 착수하는지 본다. 리허설 리포가 없으면 건너뛰고, "리허설 미실시" 를 보고에 적는다.

- [ ] **Step 6: 조율과 보고**

- H 작성자(`feat/worker-auto-restart`)에게 알린다: "`spawn_kind: resolve` 인 해소 워커는 자동 재시작 대상이 아니다. 죽으면 `failed no-result` 로 판정하고 `team.lost` 를 쓰지 않는다. events.md 가드 줄은 `team.lost` 와 `team.conflict` 를 둘 다 남긴다."
- 과제 C 작성자에게 계약 버전(2.6/2.7)의 머지 순서를 알린다.
- 보고: staging 반영 커밋, 화면 확인 결과(캡처), 리허설 여부. main·킷 반영은 제안하지 않는다(staging 까지).
