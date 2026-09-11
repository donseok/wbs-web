# /dflow-team 팀장 스킬 구현 계획 (스펙 개정 4판 보완 기준, 2026-09-11 재작성)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** D'Flow 의 내 배정 작업(태그 `agent`)을 상시 감시해 슬롯 N개의 팀원에게 자동 분배하고, 완료 시 다음 작업을 보충하는 팀장 스킬 `/dflow-team` 을 만든다.

**Architecture:** 팀장은 현재 세션이며 `poll.sh` 와 `.result` 감시 루프를 `run_in_background` 로 띄워 종료 알림으로 깨어난다. 팀원은 **자기 서브에이전트를 띄울 수 있는 독립 세션**이다 — Orca 에서는 `orca worktree create --agent claude` 로 뜨는 pane 프로세스, 그 밖(일반 터미널·v1 의 tmux)에서는 Agent 도구의 에이전트 팀 팀원(`isolation: "worktree"` 필수). 팀원은 짧은 포인터로 `references/worker-prompt.md` 를 읽고 `/dflow-dev --worker` 를 돌린 뒤 `docs/tasks/<TSK>/.result` 한 줄로 보고한다. 기존 스킬은 순수 가산으로만 고친다: `/dflow-dev` 에 `--worker`(다섯 분기 A~E), `/dflow-merge` 에 원격 후보와 반려 갈래.

**Tech Stack:** Markdown 스킬(Claude Code `.claude/skills`), 기존 셸 스크립트 재사용(`poll.sh`·`dflow.sh`), `orca` CLI, vitest(스킬 문서 계약 테스트), git worktree.

**Spec:** `docs/superpowers/specs/2026-09-10-dflow-team-design.md` (개정 4판 + 2026-09-11 보완). 착수 전 걸림돌: `docs/superpowers/specs/2026-09-11-office-team-blockers.md`.

> ⚠️ **실행 금지 — 2026-09-11 저녁 2차 검토의 걸림돌 T1~T19 가 이 계획서에 아직 반영되지 않았다.** 특히
> T1(Task 2 원격 후보의 `reported` 조건), T2(`--worker` 행 B 스택과 claim 도달 검사), T3(팀장 슬롯 상태를
> 파일로 쓰지 않음), T5(완료 알림을 슬롯 번호로 매칭)는 이 문서대로 구현하면 틀린 동작이 된다. 걸림돌 문서의
> 2차 검토 절과 사용자 결정 8~11 을 반영해 이 계획서를 고친 뒤에 실행한다.

> **이 문서의 이력** — 첫 초안(커밋 f5597ea)은 폐기된 개정 2판 구조(팀원 = 작업 1건당 spawn 되는 단순
> 서브에이전트, 기존 스킬 무수정, `RESULT` 한 줄 응답)를 담고 있어 2026-09-11 전면 재작성했다. 그 구조가
> 틀린 이유: `/dflow-dev` 는 Phase 1~4 를 서브에이전트로 쪼개는데 단순 서브에이전트는 다시 서브에이전트를
> 띄우지 못한다. 이 계획은 그 제약(스펙 머리말 "제1 제약")을 전제로 한다.

## Global Constraints

- **팀원은 단순 서브에이전트가 아니다.** pane 의 별도 프로세스(Orca) 또는 에이전트 팀 팀원(Agent 도구 + `name` + `isolation: "worktree"`)만 허용한다(스펙 머리말·§2).
- **기존 스킬은 순수 가산으로만 고친다.** `/dflow-dev` 에 `--worker`, `/dflow-merge` 에 원격 후보·반려 갈래. **플래그·인자 없는 기본 동작의 원문은 한 줄도 바꾸지 않는다**(프론트매터 사용법 끝에 옵션을 붙이는 것만 예외). `/dflow-poll`(poll.sh 포함)은 손대지 않는다(스펙 §1 비목표, §3-14).
- `/dflow-dev` 는 mes-runlog 등에서 wbs-web 메인 체크아웃을 가리키는 심링크로 쓰인다. 변경은 **메인 체크아웃의 브랜치에 머지되는 순간 모든 리포에 즉시 적용된다.** Task 1·2 의 가산성 테스트가 초록일 때만 머지한다(스펙 §3-14, §12).
- 정본 위치 `.claude/skills/dflow-team/`: `SKILL.md`, `references/worker-prompt.md`, `references/backends.md`, `references/events.md` 넷. 새 스크립트를 만들지 않는다(스펙 §10).
- 포인터 한 줄 형식: `<MAIN_CHECKOUT>/.claude/skills/dflow-team/references/worker-prompt.md 를 읽고 그 규칙대로 실행하라. TSK=<TSK> ID8=<id8> AGENT_ID=<신원>/w<slot> MAIN_CHECKOUT=<MAIN_CHECKOUT> BACKEND=<pane|agent-team> MODEL=<opus|sonnet|default>` — 에이전트 팀 blocked 재개 때만 둘째 줄 `ANSWER=<답 한 줄>`(스펙 §4-3).
- 워커 프롬프트 치환 변수: `{TSK}` `{ID8}` `{AGENT_ID}` `{MAIN_CHECKOUT}` `{BACKEND}` `{MODEL_FLAG}` + 선택 `{ANSWER}`(스펙 §5).
- `.result` 한 줄: `{TSK} {ID8} <branch|-> <head_sha|-> <done_exit|-> <status> <한 줄 사유 또는 질문>`, status ∈ `done` `skipped` `needs-merge` `blocked` `failed`. 경로는 워커 워크트리의 `docs/tasks/{TSK}/.result`, 커밋하지 않는다. 같은 줄을 마지막 응답으로도 출력한다(스펙 §5).
- 좌석 식별 파일은 **워크트리 루트 `.dflow-agent`**(내용 `{AGENT_ID}` 한 줄). `docs/tasks/<TSK>/` 안에 두지 않는다 — claim 전에 그 디렉터리가 생기면 `/dflow-dev` 잔재 격리 규칙이 `.prev-<날짜>` 로 옮긴다(스펙 §5, §9-1).
- `AGENT_ID` 는 `<신원>/w<slot>`, 팀장은 `<신원>/lead`. `<신원>` = `dflow.sh me` 의 `user_email` 에서 `@` 앞부분을 소문자로 바꾸고 `[a-z0-9-]` 밖 문자를 `-` 로(스펙 §9-1).
- 에이전트 팀 `name` = `w<slot>-<id8>`, `subagent_type` = `general-purpose`(스펙 §4-3).
- **git 호출 규칙(두 백엔드 공통)**: 워커와 Phase 서브에이전트는 `command -v git` 이 돌려주는 절대경로로 git 을 부른다(bare `git` 금지). 리허설에서 절대경로도 rtk 에 막히면 리터럴 `/usr/bin/git` 으로 바꾼다(스펙 §2 결정 6, §3-5-A).
- 백엔드는 자동 감지만(`--backend` 플래그 없음). v1 에서 tmux 는 에이전트 팀으로 내려간다(스펙 §2 결정 7, §4-0).
- 팀장은 깨어날 때마다 승인 스윕을 돈다 — 팀원 작업은 팀장 체크아웃에 state.json 이 없어 poll exit 9·10 이 오지 않는다(스펙 §3-16, §4-2). 감시 루프는 30분마다 `TICK` 으로 팀장을 깨운다.
- events.jsonl: `~/.dflow/events.jsonl`, 스키마 `{ts, host, repo, tsk, order, phase, event, agent}` + 이벤트별 추가 필드(스펙 §9-3).
- 참조는 id8 만. 순번 금지. 팀원은 `dflow.sh list` 를 부르지 않는다(스펙 §3-10).
- 팀장·팀원 모두 AskUserQuestion 을 쓰지 않는다(자동 루프). `blocked` 는 PushNotification 이 있으면 한 번 알린다(스펙 §2).
- 커밋 메시지는 한국어, "무엇"보다 "왜". `git add -A` 금지, 파일명 명시(프로젝트 CLAUDE.md). 각 Task 의 커밋 명령은 제목·본문만 적었다 — 실행하는 세션은 메시지 끝에 **그 세션의** attribution 트레일러(`Co-Authored-By:`·`Claude-Session:` 등, 하네스가 알려 주는 것)를 붙인다.
- dflow.sh `show` 응답은 `{ok, order: {id, status, item, …}, reports, depends_evidence}` 모양이다. 항목 필드는 `.order.item.*`(예: `.order.item.spec`·`.order.item.external_ref`), 주문 id 는 `.order.id` 다(`src/app/api/v1/agent/work/[id]/route.ts`, poll.sh 118행).
- 테스트는 `process.cwd()` 를 리포 루트로 쓴다(기존 `tests/` 관례). `__dirname` 을 쓰지 않는다.

## 실행 준비 (Task 1 전에 한 번)

- [ ] **브랜치·워크트리**: superpowers:using-git-worktrees 로 `feat/dflow-team` 브랜치의 워크트리를 만든다. 기점은 `origin/main`. 메인 체크아웃(`/Users/jji/project/wbs-web`)에서 직접 고치지 않는다 — 심링크를 통해 다른 리포에 즉시 퍼지기 때문이다.
- [ ] **격리 에이전트 안에서 실행한다면**: 이 세션의 git 호출도 `command -v git` 절대경로로 한다(rtk 격리 가드, 스펙 §3-5-A).
- [ ] **기준선**: `npx vitest run tests/skills` — 이 폴더는 아직 없으므로 "No test files found" 가 정상이다.

## 파일 구조

| 파일 | 책임 | Task |
|---|---|---|
| `tests/skills/_additive.ts` (신규) | "원문의 모든 줄이 순서대로 남아 있는가" 판정 헬퍼 | 1 |
| `tests/skills/fixtures/dflow-dev.SKILL.before-worker.md` (신규) | `--worker` 추가 직전 dflow-dev SKILL.md 사본 | 1 |
| `tests/skills/dflow-dev-worker.test.ts` (신규) | `/dflow-dev --worker` 가산성·다섯 분기 계약 | 1 |
| `.claude/skills/dflow-dev/SKILL.md` (수정) | `--worker` 표지 다섯 곳 + 「--worker — 팀원 모드」 절 | 1 |
| `tests/skills/fixtures/dflow-merge.SKILL.before-remote.md` (신규) | 원격 후보 추가 직전 dflow-merge SKILL.md 사본 | 2 |
| `tests/skills/dflow-merge-remote.test.ts` (신규) | `/dflow-merge` 가산성·원격 후보·반려 갈래 계약 | 2 |
| `.claude/skills/dflow-merge/SKILL.md` (수정) | 원격 후보·반려 갈래·반려 목록 보고 | 2 |
| `.claude/skills/dflow-team/references/worker-prompt.md` (신규) | 팀원 규칙 정본 | 3 |
| `tests/skills/dflow-team.test.ts` (신규, Task 3~6 에서 확장) | dflow-team 문서 계약 | 3~6 |
| `.claude/skills/dflow-team/references/backends.md` (신규) | 백엔드별 spawn·정리 명령, 차이표 | 4 |
| `.claude/skills/dflow-team/references/events.md` (신규) | events.jsonl 기록 명령·이벤트 표 | 4 |
| `.claude/skills/dflow-team/SKILL.md` (신규) | 팀장 절차 | 5 |
| `scripts/kit-build.sh` (수정, 12행) | 킷 목록에 `dflow-team` | 6 |
| `kit/install.sh` (수정, 48행) | 설치 완료 문구에 `dflow-team` | 6 |
| `kit/README.md` (수정, 표) | 스킬 표에 `dflow-team` 행 | 6 |
| `docs/agent/claude-skill/dflow-skills-guide.md` (수정, "자주 겪는 상황" 앞) | 대화 예시 절 | 6 |
| `docs/superpowers/specs/2026-09-10-dflow-team-design.md` (수정, §11 끝) | 리허설 기록 | 7·8 |

---

### Task 1: `/dflow-dev --worker` 순수 가산 수정

**Files:**
- Create: `tests/skills/_additive.ts`
- Create: `tests/skills/fixtures/dflow-dev.SKILL.before-worker.md`
- Create: `tests/skills/dflow-dev-worker.test.ts`
- Modify: `.claude/skills/dflow-dev/SKILL.md` (3·8·54·89·122·159행 뒤 삽입, `## --only 옵션` 앞에 절 삽입)

**Interfaces:**
- Consumes: 없음(첫 Task).
- Produces: `firstMissingLine(orig: string, next: string, prefixOk?: (line: string) => boolean): string | null` — Task 2 가 재사용. `/dflow-dev` 의 `--worker` 플래그와 「--worker — 팀원 모드」 절 — Task 3 워커 프롬프트가 `/dflow-dev {ID8} --worker {MODEL_FLAG}` 로 부르고, 전제 검사가 `grep -q -- '--worker'` 로 지원 여부를 본다.

- [ ] **Step 1: 원문 사본(fixture)을 만든다 — 반드시 SKILL.md 를 고치기 전에**

```bash
mkdir -p tests/skills/fixtures
cp .claude/skills/dflow-dev/SKILL.md tests/skills/fixtures/dflow-dev.SKILL.before-worker.md
wc -l tests/skills/fixtures/dflow-dev.SKILL.before-worker.md
```
Expected: `204` 전후(다른 세션이 그 사이 dflow-dev 를 고쳤으면 그 줄 수 — 사본은 "고치기 직전" 이면 된다).

- [ ] **Step 2: 헬퍼 작성**

```ts
// tests/skills/_additive.ts
/**
 * next 가 orig 의 순수 가산인지 판정한다 — orig 의 모든 줄이 next 에 같은 순서로 그대로 있어야 한다.
 * prefixOk(line) 가 참인 원문 줄은 "새 줄이 원문 줄로 시작" 해도 인정한다(프론트매터 사용법 끝에 옵션 추가).
 * 반환: 찾지 못한 첫 원문 줄. 모두 찾으면 null.
 */
export function firstMissingLine(
  orig: string,
  next: string,
  prefixOk: (line: string) => boolean = () => false,
): string | null {
  const a = orig.split('\n');
  const b = next.split('\n');
  let j = 0;
  for (const line of a) {
    while (j < b.length && !(b[j] === line || (prefixOk(line) && b[j].startsWith(line)))) j++;
    if (j === b.length) return line;
    j++;
  }
  return null;
}
```

- [ ] **Step 3: 실패하는 테스트 작성**

```ts
// tests/skills/dflow-dev-worker.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { firstMissingLine } from './_additive';

const ROOT = process.cwd(); // vitest 는 리포 루트에서 돈다(기존 테스트 관례 — __dirname 은 ESM 에서 없을 수 있다)
const skill = readFileSync(join(ROOT, '.claude/skills/dflow-dev/SKILL.md'), 'utf8');
const before = readFileSync(join(ROOT, 'tests/skills/fixtures/dflow-dev.SKILL.before-worker.md'), 'utf8');
const workerSection = () => skill.split('## --worker — 팀원 모드')[1]?.split('\n## ')[0] ?? '';

describe('/dflow-dev --worker 는 순수 가산이다', () => {
  // dflow-dev 를 의도적으로 고칠 때는 이 fixture 도 같은 커밋에서 갱신한다.
  it('플래그 전 원문의 모든 줄이 순서대로 그대로 남아 있다', () => {
    expect(firstMissingLine(before, skill, (l) => l.startsWith('description: '))).toBeNull();
  });

  it('프론트매터 사용법에 --worker 가 있다', () => {
    const fm = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    expect(fm).toMatch(/사용법 - \/dflow-dev .*\[--worker\]/);
  });

  it('「--worker — 팀원 모드」 절이 다섯 분기 A~E 를 담는다', () => {
    const sec = workerSection();
    expect(sec).not.toBe('');
    for (const row of ['| A |', '| B |', '| C |', '| D |', '| E |']) expect(sec, row).toContain(row);
    expect(sec).toContain('branch_base');
    expect(sec).toContain('needs-merge');
    expect(sec).toContain('AskUserQuestion 을 쓰지 않는다');
    expect(sec).toContain('command -v git');
    expect(sec).toContain('.claude/skills/dflow-team/references/worker-prompt.md');
  });

  it('원래 절에서 --worker 절로 가는 표지가 있다', () => {
    for (const tag of ['「--worker」 A', '「--worker」 B', '「--worker」 C', '「--worker」 E']) {
      expect(skill, tag).toContain(tag);
    }
  });

  it('--worker 절은 기본 브랜치를 switch 하지 않는다', () => {
    expect(workerSection()).not.toMatch(/git switch (<기본브랜치>|main)(\s|$)/m);
  });
});
```

- [ ] **Step 4: 실패 확인**

Run: `npx vitest run tests/skills/dflow-dev-worker.test.ts`
Expected: FAIL 4건(가산성 건은 아직 원문과 같으므로 PASS). 실패 메시지는 `toMatch`·`not.toBe('')`·`toContain` 불일치.

- [ ] **Step 5: SKILL.md 에 표지 다섯 곳을 넣는다** (모두 기존 줄 **뒤에 새 줄을 넣는** 편집이다. 기존 줄 자체는 3행 사용법 끝에 ` [--worker]` 를 붙이는 것 외에 건드리지 않는다)

(1) 3행 프론트매터 `description:` 의 끝 `[--model opus|sonnet]` 을 `[--model opus|sonnet] [--worker]` 로.

(2) 8행 `인자: \`$ARGUMENTS\` (\`<순번|TSK-ID>\` + 옵션)` 뒤에:
```markdown

> **`--worker`(팀원 모드, `/dflow-team` 전용)**: 이 플래그가 있을 때만 아래 「--worker — 팀원 모드」 절의
> 다섯 분기(A~E)가 달라진다. **플래그가 없으면 이 문서의 모든 절차가 지금 문구 그대로다.**
```

(3) `## Phase 0-가 — 승인 스윕(머지, 오케스트레이터 본인)` 줄 뒤에:
```markdown

> `--worker` 면 이 절 전체를 건너뛴다(「--worker」 A) — 스윕은 팀장 몫이다.
```

(4) Phase 0 1번의 `   작업이라 스윕이 못 봤을 수 있다 — 그 경우 지금 즉시 같은 머지 절차를 이 ref 하나로 실행 후 종료).` 줄 뒤에:
```markdown
   `--worker` 면 머지하지 않고 `needs-merge` 로 끝낸다(「--worker」 C).
```

(5) Phase 0 2번의 `       있다). 머지 후 이어서 진행.` 줄 뒤에:
```markdown
       `--worker` 면 머지하지 않고 그 `head_sha` 위에 스택한다(「--worker」 B).
```

(6) Phase 1~4 의 `dev-discipline.md 를 따른다.` 줄 뒤에:
```markdown
`--worker` 면 공통 프롬프트에 git 절대경로 규칙 한 줄을 덧붙인다(「--worker」 E).
```

- [ ] **Step 6: `## --only 옵션` 줄 바로 앞에 절을 넣는다**

```markdown
## --worker — 팀원 모드 (`/dflow-team` 전용)

`/dflow-team` 팀장이 띄운 팀원이 붙이는 플래그다. "이 세션은 자동 실행되는 팀원이고, 기본 브랜치를 잡고
있는 상위 체크아웃(팀장)이 따로 있다" 는 뜻이다. 이 절의 다섯 분기 말고는 전부 위 절차 그대로다.

| # | 위치 | 플래그 없음 | `--worker` |
|---|---|---|---|
| A | Phase 0-가 승인 스윕 | claim 앞에서 매번 스윕 | **건너뛴다.** 스윕은 팀장 몫이다. 기본 브랜치는 팀장 체크아웃이 잡고 있어 여기서 switch 하면 `already checked out` 으로 실패한다. 건너뛴 사실을 한 줄 남긴다 |
| B | Phase 0-2 선행이 완료인데 main 미반영 → 직접 머지 | 직접 머지 후 진행 | **머지하지 않는다.** 그 `head_sha` 를 기점으로 스택 브랜치를 만들고 state.json 에 `branch_base` 와 `risk: "선행 main 미반영(팀장 머지 대기)"` 를 기록한 뒤 진행한다 |
| C | Phase 0-1 재개 판정이 approved | 즉시 머지 후 종료 | **머지하지 않고** 결과를 `needs-merge`(사유 `approved`)로 넘기고 끝낸다 |
| D | 사람 판단이 필요한 분기 | AskUserQuestion 등 그대로 | **AskUserQuestion 을 쓰지 않는다.** 명백한 기본값이 있으면 택해 design.md 또는 커밋 메시지에 한 줄 남기고 진행한다. 기본값이 없으면 산출물을 커밋·push 한 뒤 결과를 `blocked`(사유 자리에 질문과 선택지)로 넘기고 멈춘다. `--only` 확인은 팀장이 `--only` 를 넘기지 않으므로 워커 경로에 없다 |
| E | Phase 1~4 공통 프롬프트 | 지금 문구 그대로 | 공통 프롬프트에 "git 은 `command -v git` 이 돌려주는 절대경로로 호출한다(bare `git` 금지)" 한 줄을 덧붙인다. 오케스트레이터 자신도 이 규칙을 따른다. 에이전트 팀 백엔드에서는 rtk 가 재작성한 git 을 워크트리 격리 가드가 거부하기 때문이다 |

- 결과 보고는 워커 프롬프트(`.claude/skills/dflow-team/references/worker-prompt.md`)의 `.result` 계약으로
  한다. 이 스킬은 끝날 때 상태(`done`·`skipped`·`needs-merge`·`blocked`·`failed`)·agent 브랜치·head·
  `done` exit·한 줄 사유를 마지막에 요약해 둔다.
- 이 다섯 말고 기본 브랜치를 switch·pull·merge·push 하는 지점은 없다. agent 브랜치를 만들고 그 위에
  push 하는 Phase 0-3·Phase 5 는 워커에서도 그대로 한다.
- 새로 만드는 "사람에게 묻기" 지점은 없다. 기존의 "중단·보고"(push 훅 거부·Verify 재시도 소진·빨간
  기준선)는 워커에서 `failed <사유>` 가 된다.

```

- [ ] **Step 7: 통과 확인**

Run: `npx vitest run tests/skills/dflow-dev-worker.test.ts`
Expected: PASS 5건. 가산성 건이 실패하면 메시지의 "찾지 못한 원문 줄" 을 되살린다(편집이 기존 줄을 건드린 것이다).

- [ ] **Step 8: 커밋**

```bash
git add tests/skills/_additive.ts tests/skills/fixtures/dflow-dev.SKILL.before-worker.md tests/skills/dflow-dev-worker.test.ts .claude/skills/dflow-dev/SKILL.md
git commit -m "feat(dflow-dev): --worker 팀원 모드 순수 가산 — 머지 세 곳 대체·질문 억제·git 절대경로

/dflow-team 팀원은 기본 브랜치를 팀장 체크아웃이 잡고 있어 스윕·직접 머지에서 죽고,
에이전트 팀 백엔드에서는 rtk 가 재작성한 git 이 격리 가드에 막힌다. 플래그가 있을 때만
다섯 분기(A~E)가 갈린다. 심링크로 모든 리포에 즉시 퍼지므로 원문 줄 보존을 테스트로 고정한다."
```

---

### Task 2: `/dflow-merge` 원격 후보·반려 갈래 순수 가산

**Files:**
- Create: `tests/skills/fixtures/dflow-merge.SKILL.before-remote.md`
- Create: `tests/skills/dflow-merge-remote.test.ts`
- Modify: `.claude/skills/dflow-merge/SKILL.md` (18·20·37행 뒤 삽입)

**Interfaces:**
- Consumes: `firstMissingLine` (Task 1, `tests/skills/_additive.ts`).
- Produces: 인자 없는 `/dflow-merge` 가 원격 `origin/agent/*` 후보를 보고, 보고에 **반려 목록**을 따로 둔다 — Task 5 팀장 SKILL.md §4 가 반려 목록의 id8 을 제외 목록에 넣는다.

- [ ] **Step 1: 원문 사본**

```bash
cp .claude/skills/dflow-merge/SKILL.md tests/skills/fixtures/dflow-merge.SKILL.before-remote.md
```

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// tests/skills/dflow-merge-remote.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { firstMissingLine } from './_additive';

const ROOT = process.cwd(); // vitest 는 리포 루트에서 돈다(기존 테스트 관례 — __dirname 은 ESM 에서 없을 수 있다)
const skill = readFileSync(join(ROOT, '.claude/skills/dflow-merge/SKILL.md'), 'utf8');
const before = readFileSync(join(ROOT, 'tests/skills/fixtures/dflow-merge.SKILL.before-remote.md'), 'utf8');

describe('/dflow-merge 원격 후보·반려 갈래는 순수 가산이다', () => {
  // dflow-merge 를 의도적으로 고칠 때는 이 fixture 도 같은 커밋에서 갱신한다.
  it('원문의 모든 줄이 순서대로 그대로 남아 있다', () => {
    expect(firstMissingLine(before, skill)).toBeNull();
  });

  it('원격 agent 브랜치 tip 의 state.json 을 후보로 본다', () => {
    expect(skill).toContain("git branch -r --list 'origin/agent/*'");
    expect(skill).toContain('git diff --name-only');
    expect(skill).toContain('origin/agent/<id8>-<slug>');
    expect(skill).toMatch(/`order`.*전체 UUID/);
  });

  it('반려는 승인 대기와 갈라 보고한다', () => {
    expect(skill).toContain('review_action=reject');
    expect(skill).toContain('반려 — 재작업 필요');
    expect(skill).toContain('반려 목록');
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/skills/dflow-merge-remote.test.ts`
Expected: FAIL 2건(원격 후보·반려), 가산성 1건 PASS.

- [ ] **Step 4: SKILL.md 에 세 곳을 넣는다** (모두 기존 줄 뒤 삽입)

(1) 1번 `   인 작업 전부. 각각 \`dflow.sh show <ref>\` 로 서버 상태 확인.` 줄 뒤에:
````markdown
   **원격 후보(넓힘, `/dflow-team` 대응)**: 인자가 없으면 위 로컬 후보에 더해 원격 agent 브랜치도 본다.
   팀원 워크트리나 다른 PC 에서 마감한 작업은 state.json 이 그 브랜치에만 있어 로컬 후보에 안 잡힌다.
   ```bash
   git fetch origin
   git branch -r --list 'origin/agent/*'
   # 각 원격 브랜치 <b> 마다 — 그 브랜치가 기본브랜치에서 갈라진 뒤 바뀐 state.json 만 본다
   git diff --name-only origin/<기본브랜치>...<b> -- 'docs/tasks/*/state.json'
   git show <b>:docs/tasks/<TSK>/state.json
   ```
   `phase` 가 `reported` 인 것만 후보에 더한다. 로컬 후보와 `order`(전체 UUID)가 같으면 하나로 합친다.
   브랜치 tip 의 phase 는 후보를 고르는 데만 쓰고, 판정은 아래 2번의 show 로만 한다. 원격 후보는 로컬
   브랜치가 없을 수 있으므로 4번 머지 대상을 `origin/agent/<id8>-<slug>` 로 쓰고, 5번의 브랜치 삭제는
   로컬 브랜치가 있을 때만 로컬도 지운다.
````

(2) 2번 `   **approved 확인 전 머지 절대 금지** — 로컬 state 나 기억이 아니라 show 응답이 판정이다.` 줄 뒤에:
```markdown
   **반려 갈래(넓힘)**: approved 가 아닌 후보 중 같은 show 응답 최상위 `.reports` 의 마지막
   `kind=completion` 리포트가 `review_action=reject` 인 것은 "승인 대기" 가 아니라 "반려 — 재작업 필요:
   <review_note>" 로 갈라 보고한다. state.json `phase=rejected` 기록은 하지 않는다 — 그건 `/dflow-dev`
   Phase 0-가·재작업 경로의 몫이다.
```

(3) 6번 `6. **보고**: 머지된 목록 / 승인 대기로 남은 목록 / 건너뛴 목록(사유)을 표로.` 줄 뒤에:
```markdown
   반려 갈래(2번)가 있으면 반려 목록을 따로 둔다(`/dflow-team` 팀장은 이 목록의 id8 을 제외 목록에 넣는다).
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/skills/dflow-merge-remote.test.ts tests/skills/dflow-dev-worker.test.ts`
Expected: PASS 8건.

- [ ] **Step 6: 커밋**

```bash
git add tests/skills/fixtures/dflow-merge.SKILL.before-remote.md tests/skills/dflow-merge-remote.test.ts .claude/skills/dflow-merge/SKILL.md
git commit -m "feat(dflow-merge): 원격 agent 브랜치 후보·반려 갈래 보고 순수 가산

팀원 워크트리에서 마감한 작업은 state.json 이 agent 브랜치에만 있어 팀장 체크아웃의 로컬
후보에 안 잡히고, 같은 이유로 poll exit 9·10 도 울리지 않는다. 원격 tip 을 후보로 넓히고
반려를 승인 대기와 갈라 보고해 팀장이 놓치지 않게 한다. 판정·순서·머지 로직은 불변."
```

---

### Task 3: 팀원 프롬프트 정본 `references/worker-prompt.md`

**Files:**
- Create: `.claude/skills/dflow-team/references/worker-prompt.md`
- Create: `tests/skills/dflow-team.test.ts`

**Interfaces:**
- Consumes: `/dflow-dev --worker` (Task 1) — 호출 형식 `/dflow-dev {ID8} --worker {MODEL_FLAG}`, 결과 요약(status·브랜치·head·done exit·사유).
- Produces: 포인터 키 `TSK` `ID8` `AGENT_ID` `MAIN_CHECKOUT` `BACKEND` `MODEL` `ANSWER` 를 읽는 규칙, `.result` 한 줄 형식, `.dflow-agent` 파일 — Task 4 backends.md 와 Task 5 SKILL.md 가 이 이름·형식을 그대로 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/skills/dflow-team.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd(); // vitest 는 리포 루트에서 돈다(기존 테스트 관례 — __dirname 은 ESM 에서 없을 수 있다)
const SKILL_DIR = join(ROOT, '.claude', 'skills', 'dflow-team');
const read = (rel: string) => readFileSync(join(SKILL_DIR, rel), 'utf8');

const PLACEHOLDERS = ['{TSK}', '{ID8}', '{AGENT_ID}', '{MAIN_CHECKOUT}', '{BACKEND}', '{MODEL_FLAG}', '{ANSWER}'];
const STATUSES = ['done', 'skipped', 'needs-merge', 'blocked', 'failed'];

describe('dflow-team worker-prompt.md 계약', () => {
  const p = () => read('references/worker-prompt.md');

  it('치환 변수 일곱 개와 포인터 키를 모두 설명한다', () => {
    expect(existsSync(join(SKILL_DIR, 'references/worker-prompt.md'))).toBe(true);
    for (const v of PLACEHOLDERS) expect(p(), v).toContain(v);
    for (const k of ['`TSK`', '`ID8`', '`AGENT_ID`', '`MAIN_CHECKOUT`', '`BACKEND`', '`MODEL`', '`ANSWER`']) {
      expect(p(), k).toContain(k);
    }
  });

  it('git 은 절대경로로 부르고, 격리 실패면 파일을 쓰지 않는다', () => {
    expect(p()).toContain('command -v git');
    expect(p()).toContain('NOT_ISOLATED');
    expect(p()).toContain('failed not-isolated');
    expect(p()).toContain('아무 파일도 쓰지 않고');
  });

  it('부트스트랩은 .env·스킬을 메인 체크아웃에서 링크하고 --worker 지원을 확인한다', () => {
    expect(p()).toContain('ln -s {MAIN_CHECKOUT}/.env .env');
    expect(p()).toContain('ln -s {MAIN_CHECKOUT}/.claude/skills .claude/skills');
    expect(p()).toContain('SKILLS_PARTIAL');
    expect(p()).toContain('NO_WORKER_FLAG');
  });

  it('좌석 식별은 워크트리 루트 .dflow-agent 이고 docs/tasks 안에 두지 않는다', () => {
    expect(p()).toContain("printf '%s\\n' '{AGENT_ID}' > .dflow-agent");
    expect(p()).not.toMatch(/docs\/tasks\/\{TSK\}\/\.agent/);
  });

  it('/dflow-dev --worker 로 실행하고 Skill 미등록이면 SKILL.md 를 직접 따른다', () => {
    expect(p()).toContain('/dflow-dev {ID8} --worker {MODEL_FLAG}');
    expect(p()).toContain('.claude/skills/dflow-dev/SKILL.md');
  });

  it('.result 한 줄 형식과 status 다섯 가지를 담는다', () => {
    expect(p()).toMatch(/^\{TSK\} \{ID8\} <branch\|-> <head_sha\|-> <done_exit\|-> <status> <한 줄 사유 또는 질문>$/m);
    for (const s of STATUSES) expect(p(), s).toContain('`' + s + '`');
    expect(p()).toContain('docs/tasks/{TSK}/.result');
  });

  it('blocked 이후 동작을 BACKEND 두 값으로 가른다', () => {
    expect(p()).toMatch(/\| `pane` \|/);
    expect(p()).toMatch(/\| `agent-team` \|/);
    expect(p()).toContain('AskUserQuestion 을 쓰지 않는다');
  });

  it('기본 브랜치를 switch 하지 않는다', () => {
    expect(p()).not.toMatch(/switch (main|<기본브랜치>)(\s|$)/m);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: FAIL 8건 — 파일이 없어 `ENOENT` 또는 `toBe(true)` 실패.

- [ ] **Step 3: 파일 작성**

````markdown
# /dflow-team 워커 프롬프트 (정본)

> 설계 정본: wbs-web 리포 docs/superpowers/specs/2026-09-10-dflow-team-design.md §5(킷에는 미동봉).

너는 `/dflow-team` 팀장이 띄운 **팀원**이다. 자기 서브에이전트를 띄울 수 있는 독립 세션이며, 작업 한 건을
`/dflow-dev --worker` 로 끝까지 처리하고 `.result` 한 줄로 보고한다. 팀장이 보낸 포인터의 `KEY=VALUE` 가
아래 변수를 채운다. **이 문서의 규칙이 `/dflow-dev` 본문보다 우선한다.**

| 변수 | 포인터 키 | 뜻 |
|---|---|---|
| `{TSK}` | `TSK` | 작업 TSK-ID |
| `{ID8}` | `ID8` | 주문 id8. 모든 참조는 이것으로만 한다(순번 금지) |
| `{AGENT_ID}` | `AGENT_ID` | 좌석표 식별자 `<신원>/w<slot>` |
| `{MAIN_CHECKOUT}` | `MAIN_CHECKOUT` | 팀장의 상주 체크아웃 절대경로 |
| `{BACKEND}` | `BACKEND` | `pane` 또는 `agent-team` |
| `{MODEL_FLAG}` | `MODEL` | `opus` → `--model opus`, `sonnet` → `--model sonnet`, `default` → 빈 값 |
| `{ANSWER}` | `ANSWER` | (선택) 에이전트 팀 `blocked` 재개 때만 온다. 직전 질문에 대한 담당자 결정 |

## 0. git 호출 규칙 — 모든 단계에 적용

첫 Bash 호출에서 `command -v git` 을 실행해 나온 절대경로(예: `/usr/bin/git`)를 이 세션의 git 으로
기억한다. 이후 **모든 git 호출은 그 절대경로로** 한다 — bare `git` 금지. 이 문서와 `/dflow-dev` 본문의
`git …` 예시도 전부 그 절대경로로 바꿔 실행한다. 이유: 에이전트 팀 백엔드에서는 rtk 가 재작성한 git
서브커맨드를 워크트리 격리 가드가 거부한다. pane 에서는 필요 없지만 무해하다.

## 1. 격리 확인 — 첫 행동

```bash
<git 절대경로> rev-parse --show-toplevel
```
출력이 `{MAIN_CHECKOUT}` 과 같으면 격리 실패(`NOT_ISOLATED`)다. **아무 파일도 쓰지 않고** 마지막 응답으로
`{TSK} {ID8} - - - failed not-isolated` 한 줄만 출력하고 끝낸다. `.result` 를 쓰면 팀장 체크아웃이
더러워져 다음 시작의 전제 검사가 깨진다.

## 2. 워크트리 부트스트랩

```bash
[ -e .env ] || ln -s {MAIN_CHECKOUT}/.env .env
if [ ! -e .claude/skills/dflow-dev/SKILL.md ]; then
  if [ -e .claude/skills ]; then echo SKILLS_PARTIAL; else mkdir -p .claude && ln -s {MAIN_CHECKOUT}/.claude/skills .claude/skills; fi
fi
grep -q -- '--worker' .claude/skills/dflow-dev/SKILL.md || echo NO_WORKER_FLAG
set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor
```
- `.claude/skills` 는 커밋된 리포면 이미 있고, gitignore 된 심링크로 배포한 리포면 새 워크트리에 없어서 여기서 링크한다.
- `SKILLS_PARTIAL` → `.result` 에 `{TSK} {ID8} - - - failed skills-partial` 를 쓰고 끝낸다.
- `NO_WORKER_FLAG` → `{TSK} {ID8} - - - failed no-worker-flag`. 옛 `/dflow-dev` 는 기본 브랜치를 switch 하다 죽는다.
- doctor 가 exit ≠ 0 → `{TSK} {ID8} - - - failed doctor-<exit>`.

dflow.sh 를 부를 때마다 `set -a; . ./.env; set +a` 를 앞에 붙인다(env 는 Bash 호출 사이에 남지 않는다).
링크한 `.env`·`.claude/skills` 는 커밋하지 않는다.

## 3. 좌석 식별 — claim 전

```bash
printf '%s\n' '{AGENT_ID}' > .dflow-agent
```
워크트리 루트에 쓰고 커밋하지 않는다. `docs/tasks/{TSK}/` 안에 두지 않는다 — claim 전에 그 디렉터리가
생기면 `/dflow-dev` 가 이전 시도의 잔재로 보고 `.prev-<날짜>` 로 옮긴다.

## 4. 실행

**`{ANSWER}` 가 있으면(재개)** 먼저 기존 agent 브랜치로 옮긴다. 이 워크트리는 팀장의 HEAD 에서 새로 만들어졌다.
```bash
<git 절대경로> fetch origin
<git 절대경로> branch -r --list 'origin/agent/{ID8}-*'
<git 절대경로> switch <위에서 나온 이름에서 origin/ 을 뗀 브랜치>
```
그 다음 아래를 실행하면 `/dflow-dev` 가 claimed 재개 판정으로 이어받는다. `{ANSWER}` 는 직전 `blocked`
질문에 대한 담당자 결정이다 — 설계 판단에 쓰고 `docs/tasks/{TSK}/design.md` 에
`- 담당자 결정(blocked 응답): {ANSWER}` 한 줄을 남긴다.

**실행**: Skill 도구로 `/dflow-dev {ID8} --worker {MODEL_FLAG}` 를 실행한다.
Skill 도구가 `dflow-dev` 를 모르면(스킬 없는 워크트리에서 세션이 시작돼 등록되지 않은 경우)
`.claude/skills/dflow-dev/SKILL.md` 를 Read 하고, `$ARGUMENTS` 를 `{ID8} --worker {MODEL_FLAG}` 로 놓고
그 절차를 그대로 따른다. 스킬 등록을 기다리지 않는다.

## 5. 서버 쓰기 범위

`{ID8}` 외의 어떤 주문에도 claim·progress·release·done 을 하지 않는다. `list` 를 부르지 않는다.
조회는 `show {ID8}` 뿐이다.

## 6. 판단 규칙 — 자동 모드

AskUserQuestion 을 쓰지 않는다. 명백한 기본값이 있으면 택하고, 결정을 design.md 또는 커밋 메시지에 한 줄
남긴 뒤 진행한다. 기본값이 없어 담당자 결정이 꼭 필요할 때만 멈춘다.
1. 현재 산출물을 커밋(파일명 명시)하고 agent 브랜치를 push 한다.
2. `.result` 에 `blocked` 줄을 쓴다. 사유 자리에 질문과 선택지를 한 줄로 쓴다(`질문? (A) … / (B) …`).
3. 그 다음은 `{BACKEND}` 로 갈린다.

| `{BACKEND}` | `blocked` 이후 |
|---|---|
| `pane` | 질문을 화면에 출력한 채 멈춘다(세션 유지). 사람이 이 탭에서 답하면 같은 워크트리·브랜치에서 이어 가고, 끝나면 `.result` 를 새 결과로 덮어쓴다 |
| `agent-team` | 같은 줄을 마지막 응답으로 출력하고 **세션을 끝낸다.** 팀장이 사람의 답을 받아 `ANSWER=` 를 붙여 새로 띄운다 |

## 7. 보고 — `.result` 파일 계약

작업을 끝내거나 멈출 때 `docs/tasks/{TSK}/.result` 에 한 줄을 쓰고(디렉터리가 없으면 만든다), **같은 줄을
마지막 응답으로도 출력한다.** 팀장은 이 줄만 파싱한다. 커밋하지 않는다. 사유에 줄바꿈을 넣지 않는다.

```
{TSK} {ID8} <branch|-> <head_sha|-> <done_exit|-> <status> <한 줄 사유 또는 질문>
```

| status | 언제 |
|---|---|
| `done` | Phase 5 까지 마치고 `done --auto-links` 가 exit 0 |
| `skipped` | claim exit 4, spec 부재, 착수 불가 판정 |
| `needs-merge` | 재개 판정이 approved(`/dflow-dev` 「--worker」 C) — 사유 `approved` |
| `blocked` | 6번 판단 규칙 — 사유 자리에 질문과 선택지 |
| `failed` | push 훅 거부, 게이트 실패, Verify 재시도 소진, 부트스트랩 실패 |

`<head_sha>` 는 push 한 agent 브랜치 tip 의 짧은 sha(`<git 절대경로> rev-parse --short HEAD`), `<done_exit>` 는
`dflow.sh done` 의 exit code 다. 해당 없는 칸은 `-`.
````

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: PASS 8건.

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-team/references/worker-prompt.md tests/skills/dflow-team.test.ts
git commit -m "feat(dflow-team): 팀원 프롬프트 정본 — 격리 확인·스킬 부트스트랩·.dflow-agent·.result 계약

팀원은 포인터 한 줄로 이 파일을 읽는다. gitignore 된 심링크 배포 리포는 새 워크트리에 스킬이
없어 메인 체크아웃에서 링크하고, claim 전 docs/tasks 를 만들지 않도록 좌석 식별을 루트에 둔다."
```

---

### Task 4: 백엔드·이벤트 참조 `references/backends.md`, `references/events.md`

**Files:**
- Create: `.claude/skills/dflow-team/references/backends.md`
- Create: `.claude/skills/dflow-team/references/events.md`
- Modify: `tests/skills/dflow-team.test.ts` (describe 블록 추가)

**Interfaces:**
- Consumes: 포인터 형식·`.result` 경로·`.dflow-agent` (Task 3).
- Produces: backends.md 의 절 이름 「pane — Orca」「에이전트 팀」「에이전트 팀 워크트리 정리」 와 events.md 의 이벤트 이름 `team.start` `team.spawn` `team.result` `team.blocked` `team.sweep` `team.stop` — Task 5 SKILL.md 가 이 이름으로 참조한다.

- [ ] **Step 1: 테스트 추가** — `tests/skills/dflow-team.test.ts` 끝에:

```ts
describe('dflow-team backends.md·events.md 계약', () => {
  const b = () => read('references/backends.md');
  const e = () => read('references/events.md');

  it('에이전트 팀 spawn 은 isolation worktree 가 필수이고 이름은 w<slot>-<id8> 이다', () => {
    expect(b()).toContain('`"worktree"` — **필수.**');
    expect(b()).toContain('`w<slot>-<id8>`');
    expect(b()).toContain('`general-purpose`');
  });

  it('Orca spawn·정리 명령이 정본 형식이다', () => {
    expect(b()).toContain('orca worktree create --name dflow-<id8> --agent claude --no-parent --base-branch origin/main');
    expect(b()).toContain('orca worktree rm --worktree');
  });

  it('에이전트 팀 워크트리 정리는 push 확인 뒤 --force 로만 한다', () => {
    expect(b()).toContain('## 에이전트 팀 워크트리 정리');
    expect(b()).toContain('git worktree remove --force');
    expect(b()).toMatch(/rev-parse HEAD[\s\S]*rev-parse origin\/<agent 브랜치>/);
  });

  it('차이표가 기상·blocked·정리를 백엔드별로 가른다', () => {
    for (const row of ['| 완료 기상 |', '| `blocked` 이후 |', '| 정리 |', '| git 호출 |']) expect(b(), row).toContain(row);
  });

  it('tmux 는 v1 미지원으로 명시한다', () => {
    expect(b()).toContain('## pane — tmux (v1 미지원)');
  });

  it('events.md 는 여섯 이벤트와 기록 명령을 담는다', () => {
    for (const ev of ['team.start', 'team.spawn', 'team.result', 'team.blocked', 'team.sweep', 'team.stop']) {
      expect(e(), ev).toContain('`' + ev + '`');
    }
    expect(e()).toContain('>> ~/.dflow/events.jsonl || true');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: 새 describe 6건 FAIL(`ENOENT`), 기존 8건 PASS.

- [ ] **Step 3: `references/backends.md` 작성**

````markdown
# /dflow-team 백엔드 — spawn·정리 명령 정본

SKILL.md §0 이 백엔드를 고른다. 워커 프롬프트·`.result` 계약·`/dflow-dev --worker` 는 백엔드와 무관하게
같다. 백엔드가 가르는 것은 아래 차이표의 항목뿐이다.

## 차이표

| 항목 | pane(Orca) | 에이전트 팀 |
|---|---|---|
| 팀원 정체 | 별도 프로세스의 claude 메인 에이전트 | Agent 도구 팀원(`name` + `isolation: "worktree"`) |
| 워크트리 | `orca worktree create` 가 `origin/main` 기점으로 만든다 | 격리가 팀장의 현재 HEAD 에서 만든다(`/dflow-dev` Phase 0-3 이 agent 브랜치 기점을 다시 명시하므로 무관) |
| 완료 기상 | `.result` 감시 루프의 `RESULT_READY` | 완료 알림 |
| `blocked` 이후 | 팀원은 탭에서 멈춰 기다린다. 슬롯 점유 | 팀원은 종료한다. 슬롯 회수, 답은 팀장 세션으로 |
| 사람의 답 | 그 팀원 탭에 직접 | 팀장 세션에 → `ANSWER=` 를 붙여 재spawn |
| 팀장 세션이 죽으면 | 팀원은 살아남는다 | 팀원도 함께 죽는다(마지막 push 까지만 남는다) |
| 정리 | `orca worktree rm` | 워크트리가 남아 있으면 조건부 `git worktree remove --force` |
| git 호출 | `command -v git` 절대경로 | 같음(두 백엔드 공통) |

## pane — Orca

**spawn**
```bash
orca worktree create --name dflow-<id8> --agent claude --no-parent --base-branch origin/main \
  --prompt '<포인터 한 줄>' --json
```
- 포인터는 SKILL.md §5 의 한 줄 그대로다. 작은따옴표로 감싼다(포인터에는 작은따옴표가 없다).
- 결과 JSON 에서 `result.worktree.path`(팀원 cwd)·워크트리 id·`result.agentTerminalHandle` 을 슬롯 표에
  적는다. 포인터가 첫 입력으로 자동 제출되어 팀원이 바로 착수한다.
- 팀원 화면 보기: `orca terminal read --screen --terminal <handle>`.

**정리**(마감·무응답)
```bash
orca worktree rm --worktree "<워크트리 id>"
orca worktree list        # 누수 확인 — dflow-<id8> 가 남아 있으면 같은 명령으로 지운다
```
미커밋분은 잃는다(워커는 `blocked` 전에 커밋·push 한다).

## pane — tmux (v1 미지원)

v1 은 tmux 를 감지해도 에이전트 팀으로 실행한다. dev-plugin(`~/project/dev-plugin`)의 `hooks/hooks.json`
로드 실패를 고친 뒤 `/team-mode` 인터페이스를 보고 이 절을 순수 가산으로 채운다.

## 에이전트 팀

**spawn** — Agent 도구:

| 파라미터 | 값 |
|---|---|
| `subagent_type` | `general-purpose`(Skill·Agent·Bash 를 포함한 모든 도구) |
| `name` | `w<slot>-<id8>` |
| `isolation` | `"worktree"` — **필수.** 빠뜨리면 팀원이 팀장 체크아웃을 공유해 서로의 브랜치를 덮어쓴다 |
| `model` | `--model` 값(`opus`/`sonnet`). 없으면 생략 |
| `description` | `w<slot> <TSK>` |
| `prompt` | 포인터 한 줄. `blocked` 재개면 둘째 줄에 `ANSWER=<답 한 줄>` |

- 팀원은 백그라운드로 돈다. 끝나면 완료 알림이 오고, 변경이 남았으면 워크트리 경로·브랜치가 함께 온다.
  그 경로를 슬롯 표(또는 blocked 목록)에 적는다.
- 진행 중 팀원 중단: `TaskStop`(이름 `w<slot>-<id8>`).

## 에이전트 팀 워크트리 정리

슬롯 표에 워크트리 경로가 있고 그 경로가 아직 있을 때만 한다(마감, `blocked` 재spawn 직전).
```bash
git -C <워크트리 경로> rev-parse HEAD
git -C <워크트리 경로> rev-parse origin/<agent 브랜치>
```
두 값이 같을 때만(push 안 된 커밋이 없을 때만) 팀장 체크아웃에서:
```bash
git worktree remove --force <워크트리 경로>
```
`--force` 는 미추적 파일(`.result`·`.dflow-agent`·`.env`·`.claude/skills` 링크) 때문에 필요하다. 두 값이
다르면 지우지 않고 경로를 보고한다.
````

- [ ] **Step 4: `references/events.md` 작성**

````markdown
# /dflow-team 이벤트 — `~/.dflow/events.jsonl`

좌석표 설계와 같은 스키마로 한 줄씩 append 한다: `{ts, host, repo, tsk, order, phase, event, agent}` +
이벤트별 추가 필드. 팀장이 쓰며 `agent` 는 `<신원>/lead`, `phase` 는 `team` 이다. 기록 실패는 진행을
막지 않는다.

## 기록 명령

```bash
mkdir -p ~/.dflow && jq -nc \
  --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg host "$(hostname -s)" \
  --arg repo "$(basename "$(git rev-parse --show-toplevel)")" \
  --arg tsk "<TSK 또는 ->" --arg order "<주문 id 또는 ->" --arg event "<이벤트>" --arg agent "<신원>/lead" \
  --argjson extra '<추가 필드 JSON, 없으면 {}>' \
  '{ts:$ts,host:$host,repo:$repo,tsk:$tsk,order:$order,phase:"team",event:$event,agent:$agent} + $extra' \
  >> ~/.dflow/events.jsonl || true
```
`<주문 id>` 는 `dflow.sh show <id8> | jq -r .order.id`(전체 UUID). 없으면 id8.

## 이벤트

| 이벤트 | 시점(SKILL.md) | 추가 필드 |
|---|---|---|
| `team.start` | 시작 §1 | `slots`, `until`, `backend` |
| `team.spawn` | 팀원 spawn §5 | `slot`, `agent_id` |
| `team.result` | 결과 처리 §3 | `slot`, `status`, `note` |
| `team.blocked` | blocked 수신 §6 | `slot`, `note` |
| `team.sweep` | 승인 스윕 §4 | `merged`, `waiting`, `rejected` |
| `team.stop` | 마감 §7 | `done`, `failed`, `blocked` |
````

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: PASS 14건.

- [ ] **Step 6: 커밋**

```bash
git add .claude/skills/dflow-team/references/backends.md .claude/skills/dflow-team/references/events.md tests/skills/dflow-team.test.ts
git commit -m "feat(dflow-team): 백엔드별 spawn·정리 정본과 이벤트 표

Orca pane 과 에이전트 팀은 기상 신호·blocked 이후·정리만 다르다. 차이를 한 표에 모으고,
에이전트 팀은 isolation 을 빠뜨리면 조용히 깨지므로 필수로 못박는다. tmux 는 dev-plugin
수정 전까지 v1 미지원."
```

---

### Task 5: 팀장 절차 `SKILL.md`

**Files:**
- Create: `.claude/skills/dflow-team/SKILL.md`
- Modify: `tests/skills/dflow-team.test.ts` (describe 블록 추가)

**Interfaces:**
- Consumes: 포인터·`.result`·`ANSWER`(Task 3), backends.md 절 이름·events.md 이벤트 이름(Task 4), `/dflow-merge` 반려 목록(Task 2), `poll.sh` exit code(머리말 4~8행: 0 2 3 5 6 7 8 9 10).
- Produces: 사용자가 부르는 `/dflow-team` — Task 6 배포 목록과 Task 7·8 리허설이 쓴다.

- [ ] **Step 1: 테스트 추가** — `tests/skills/dflow-team.test.ts` 끝에:

```ts
describe('dflow-team SKILL.md 계약', () => {
  const s = () => read('SKILL.md');

  it('파일 넷이 정본 위치에 있다', () => {
    for (const rel of ['SKILL.md', 'references/worker-prompt.md', 'references/backends.md', 'references/events.md']) {
      expect(existsSync(join(SKILL_DIR, rel)), rel).toBe(true);
    }
  });

  it('프론트매터에 name·트리거·사용법이 있다', () => {
    const fm = s().match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    expect(fm).toMatch(/^name: dflow-team$/m);
    expect(fm).toContain('"/dflow-team"');
    expect(fm).toContain('사용법 - /dflow-team [--team-size N] --until HH:MM');
  });

  it('SKILL.md 가 쓰는 team.* 이벤트는 events.md 에 전부 정의돼 있다', () => {
    const used = new Set(s().match(/team\.[a-z]+/g) ?? []);
    const events = read('references/events.md');
    expect(used.size).toBeGreaterThanOrEqual(6);
    for (const ev of used) expect(events, ev).toContain('`' + ev + '`');
  });

  it('SKILL.md 가 분기하는 poll exit code 는 poll.sh 머리말이 문서화한 것뿐이다', () => {
    const header = readFileSync(join(ROOT, '.claude/skills/dflow-poll/scripts/poll.sh'), 'utf8')
      .split('\n')
      .slice(0, 12)
      .join(' ');
    const documented = new Set(header.match(/\b\d{1,2}\b/g) ?? []);
    const used = [...s().matchAll(/poll exit (\d{1,2})/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const c of used) expect(documented.has(c), `exit ${c}`).toBe(true);
  });

  it('깨어날 때마다 승인 스윕을 돌고 감시 루프는 RESULT_READY·TICK 을 낸다', () => {
    expect(s()).toContain('깨어날 때마다 먼저 승인 스윕');
    expect(s()).toContain('RESULT_READY');
    expect(s()).toContain('echo TICK');
    expect(s()).toContain('run_in_background');
  });

  it('show 응답의 항목 필드는 .order.item 경로로 읽는다', () => {
    expect(s()).toContain('.order.item.external_ref');
    expect(s()).toContain('.order.item.spec');
    expect(s()).not.toMatch(/`\.item\.(spec|external_ref)`/);
  });

  it('포인터는 절대경로 한 줄이고 MODEL= 을 쓴다', () => {
    expect(s()).toContain(
      '<MAIN_CHECKOUT>/.claude/skills/dflow-team/references/worker-prompt.md 를 읽고 그 규칙대로 실행하라. TSK=<TSK> ID8=<id8> AGENT_ID=<신원>/w<slot> MAIN_CHECKOUT=<MAIN_CHECKOUT> BACKEND=<pane|agent-team> MODEL=<opus|sonnet|default>',
    );
  });

  it('환경 감지는 병렬 포기 분기가 없고 tmux 는 에이전트 팀으로 내려간다', () => {
    expect(s()).toContain('ORCA_WORKTREE_ID');
    expect(s()).toContain('어느 갈래에서도 병렬을 포기하고 종료하지 않는다');
    expect(s()).not.toContain('/dflow-poll 을 쓰라');
  });

  it('에이전트 팀 워크트리가 팀장 git status 를 더럽히지 않게 로컬 exclude 에 넣는다', () => {
    expect(s()).toContain("'**/.claude/worktrees/'");
    expect(s()).toContain('info/exclude');
  });

  it('질문 억제·blocked 통지·금지 규칙이 있다', () => {
    expect(s()).toContain('AskUserQuestion');
    expect(s()).toContain('PushNotification');
    expect(s()).toContain('슬롯을 비우지 않는다');
    expect(s()).toContain('`isolation` 없는 에이전트 팀 spawn');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: 새 describe 10건 FAIL(`ENOENT`), 기존 14건 PASS.

- [ ] **Step 3: `SKILL.md` 작성**

````markdown
---
name: dflow-team
description: D'Flow 에서 내게 배정되고 에이전트 위임(tags:agent)된 ready 작업을 상시 감시해 슬롯 N개의 팀원에게 나눠 동시에 개발시키는 팀장 스킬. 팀원은 자기 서브에이전트를 띄울 수 있는 독립 세션(Orca pane 또는 에이전트 팀 isolation:worktree)이며 각자 워크트리에서 /dflow-dev --worker 를 돌린다. 낮 시간 supervised 전용. 트리거 - "/dflow-team", "팀으로 개발", "팀장 시작", "N건 동시 착수". 사용법 - /dflow-team [--team-size N] --until HH:MM [--interval SEC] [--model opus|sonnet] [--exclude id8,...]
---

# /dflow-team — 팀장 (슬롯 N개 동시 개발)

인자: `$ARGUMENTS`

> **위치 선언**: 설계 정본은 wbs-web 리포 docs/superpowers/specs/2026-09-10-dflow-team-design.md(킷에는
> 미동봉). `/dflow-poll` 이 한 번에 1건만 착수하던 것을 슬롯 N개 동시 착수 + 상시 보충으로 넓힌다.
> 사람이 근처에 있는 낮 시간 supervised 루프다(`--until` 필수). 서버 통신은 dflow.sh 로 하고 exit code 로
> 분기하며, dflow-work 금지사항을 상속한다.
>
> **제1 제약 — 팀원을 단순 서브에이전트로 띄우지 않는다.** 팀원은 `/dflow-dev` 를 실행하고 `/dflow-dev` 는
> Phase 1~4 를 서브에이전트로 쪼갠다. 단순 서브에이전트는 다시 서브에이전트를 못 띄우므로, 팀원은 pane 의
> 별도 프로세스(Orca) 또는 에이전트 팀 팀원(Agent 도구 + `name` + `isolation: "worktree"`)이어야 한다.

참조: `references/backends.md`(백엔드별 spawn·정리·차이표), `references/worker-prompt.md`(팀원 규칙 —
팀장은 포인터로 넘기기만 한다), `references/events.md`(events.jsonl 기록 명령·이벤트 표).

## 옵션

- `--team-size N` 기본 3. 3 을 넘길 때는 사람이 명시한 경우만(슬롯마다 독립 메인 에이전트라 무겁다).
- `--until HH:MM` 필수. 새 배정을 멈추는 시각. 자정 넘김 미지원.
- `--interval SEC` 기본 300. poll.sh 로 전달.
- `--model opus|sonnet` 포인터 `MODEL=` 로 전달. 없으면 `MODEL=default`.
- `--exclude id8,...` 제외 목록의 초기값.

## 팀장이 유지하는 상태 (세션 메모리 — 파일로 쓰지 않는다)

- **슬롯 표**: slot · AGENT_ID · TSK · id8 · 백엔드 핸들(Orca 워크트리 id·터미널 핸들 / 에이전트 이름) ·
  워크트리 경로 · 시작 시각 · 상태(`running`|`blocked`)
- **대기 큐**: ready 인데 슬롯이 없어 못 준 id8(순서 유지). 에이전트 팀 blocked 재개분은 `ANSWER` 와 함께 맨 앞.
- **blocked 목록**(에이전트 팀): id8 · TSK · 브랜치 · 워크트리 경로 · 질문
- **제외 목록**: `--exclude` + 진행 중 + 건너뜀·실패·반려 id8
- 백엔드, 신원 슬러그, `MAIN_CHECKOUT`, 백그라운드 태스크 id 둘(poll·감시 루프)
- **집계**: TSK · id8 · 브랜치 · head · done exit · status · 사유

## 0. 환경 감지 (맨 처음)

```bash
printf 'TERM_PROGRAM=%s ORCA_WORKTREE_ID=%s TMUX=%s\n' "${TERM_PROGRAM-}" "${ORCA_WORKTREE_ID-}" "${TMUX-}"
```
1. `TERM_PROGRAM=Orca` 이거나 `ORCA_WORKTREE_ID` 가 비어 있지 않다 → **pane(Orca)**.
2. 아니고 `TMUX` 가 비어 있지 않다 → **에이전트 팀**. "tmux 감지 — v1 은 에이전트 팀으로 실행(dev-plugin
   수정 후 pane 지원 예정)" 한 줄을 보고한다.
3. 그 외 → **에이전트 팀**. "pane 이 없어 blocked 질문은 이 세션으로 모인다" 한 줄을 보고한다.

어느 갈래에서도 병렬을 포기하고 종료하지 않는다.

## 1. 시작

1. **인자 검사**: `--until` 이 없거나 이미 지난 시각이면 중단.
2. **전제 검사** — 하나라도 실패하면 아무것도 띄우지 않고 중단·보고한다. 먼저 에이전트 팀 격리
   워크트리(`.claude/worktrees/`)가 팀장 체크아웃의 `git status` 에 잡히지 않게 로컬 exclude 에 넣는다
   (커밋하지 않는 로컬 설정이다. 보존된 팀원 워크트리가 다음 시작의 깨끗함 검사를 깨뜨리지 않게 한다).
   ```bash
   ex="$(git rev-parse --git-path info/exclude)"; grep -qxF '**/.claude/worktrees/' "$ex" 2>/dev/null || printf '%s\n' '**/.claude/worktrees/' >> "$ex"
   git rev-parse --show-toplevel        # MAIN_CHECKOUT. cwd 와 다르면(하위 폴더) 중단
   test -f .env && (set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor)
   (set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh me) | jq -r .user_email
   git status --porcelain               # 비어 있어야 한다 — 더러우면 승인 스윕이 위험하다
   test -f .claude/skills/dflow-team/references/worker-prompt.md
   grep -q -- '--worker' .claude/skills/dflow-dev/SKILL.md   # 옛 dflow-dev 면 팀원이 기본 브랜치 switch 에서 죽는다
   test -x .claude/skills/dflow-poll/scripts/poll.sh
   ```
   Orca 면 추가로 `orca worktree create --help | grep -q -- '--prompt'`.
   `user_email` 을 보여 준다 — `DFLOW_PATS` 첫 토큰이 이 신원의 PAT 여야 한다.
3. **신원 슬러그**: `user_email` 의 `@` 앞부분을 소문자로 바꾸고 `[a-z0-9-]` 밖 문자는 `-` 로. 팀장 AGENT_ID 는 `<신원>/lead`.
4. **재기동 대조**(이전 팀장 세션이 죽었을 수 있다): `dflow.sh list --scope claimed` 와
   `git branch -r --list 'origin/agent/*'` 를 본다. Orca 면 `orca worktree list` 로 살아 있는 `dflow-<id8>`
   워크트리도 본다. claimed 인데 살아 있는 팀원이 없는 id8(에이전트 팀이면 claimed 전부)은 "재개 필요 —
   수동 `/dflow-dev <id8>`" 로 보고하고 제외 목록에 넣는다. 자동으로 다시 착수하지 않는다.
5. `team.start`(slots, until, backend) 기록.
6. 승인 스윕(§4).
7. 감시 시작 — poll(§2-1)과 감시 루프(§2-2).

## 2. 감시 — 팀장을 깨우는 두 백그라운드 태스크

팀장은 포그라운드로 기다리지 않는다. 둘 다 **Bash `run_in_background`** 로 띄운다. 셸 `&` 로 띄우면 종료
알림이 오지 않아 루프가 소리 없이 끊긴다.

### 2-1. poll

```bash
.claude/skills/dflow-poll/scripts/poll.sh --require-tag agent --until <HH:MM> --interval <SEC> --exclude <제외목록>
```
`<제외목록>` 은 제외 목록 + 진행 중 슬롯 id8 + 대기 큐 id8 을 쉼표로 이은 것이다. 비면 `--exclude` 를 뺀다.
처리 후 다시 띄운다. 단 exit 8·2·3·5·6·7 이면 다시 띄우지 않는다(§3).

### 2-2. 감시 루프 (재무장 규칙 포함)

pane(Orca) — 진행 중 슬롯마다 `"<워크트리 경로>/docs/tasks/<TSK>/.result|<직전 상태>"` 를 넣는다. 직전
상태는 running 슬롯이면 `-`, blocked 슬롯이면 `blocked` 다.
```bash
end=$(( $(date +%s) + 1800 ))
while [ "$(date +%s)" -lt "$end" ]; do
  hit=""
  for s in "<경로1>|-" "<경로2>|blocked"; do
    f=${s%|*}; prev=${s##*|}
    [ -f "$f" ] || continue
    st=$(awk '{print $6; exit}' "$f")
    [ "$st" != "$prev" ] && hit="$hit $f"
  done
  [ -n "$hit" ] && { echo "RESULT_READY$hit"; exit 0; }
  sleep 20
done
echo TICK
```
진행 중 슬롯이 없거나 백엔드가 에이전트 팀이면 `sleep 1800; echo TICK` 만 띄운다(에이전트 팀은 완료
알림이 따로 온다).

**재무장**: 슬롯 표가 바뀔 때마다(spawn·회수·blocked 전환) 살아 있는 감시 루프를 `TaskStop` 으로 멈추고
새로 띄운다. 루프가 첫 바퀴에 전체 슬롯을 전수 검사하므로 교체 틈에 도착한 `.result` 도 잃지 않는다.

## 3. 이벤트 처리

**깨어날 때마다 먼저 승인 스윕(§4)을 한 번 돈다.** 팀원 작업은 팀장 체크아웃에 state.json 이 없어 poll
exit 9·10 이 오지 않기 때문이다. 스윕 뒤 아래 표대로 처리한다.

| 신호 | 처리 |
|---|---|
| poll exit 0 | stdout 각 줄 `순번<TAB>id8<TAB>이름` 에서 id8 만 쓴다(순번 금지). 진행 중·대기·제외에 없는 id8 마다 `dflow.sh show <id8>`: `.order.item.spec` 이 비면 "spec 부재" 로, `.order.item.external_ref` 가 비면 "TSK 없음" 으로 제외하고 보고한다. 남은 것은 대기 큐 끝에 넣는다. 빈 슬롯만큼 큐 앞에서 spawn(§5). poll 재시작 |
| poll exit 9 | 스윕은 이미 했다. poll 재시작 |
| poll exit 10 | stdout `TSK<TAB>order-id<TAB>review_note` 마다 "반려 — 수동 `/dflow-dev <id8>` 대상: <review_note>" 로 보고하고 제외에 넣는다. poll 재시작 |
| poll exit 8 | 시한. 새 배정을 멈추고 대기 큐는 보고만 하고 비운다. running 슬롯의 결과를 모두 받은 뒤 마감(§7). pane 의 blocked 슬롯은 기다리지 않는다 |
| poll exit 2 · 3 · 5 · 6 · 7 | 사유를 보고하고 poll exit 8 과 같이 마감으로 간다 |
| `RESULT_READY <경로…>`(pane) | 경로마다 한 줄을 파싱해 결과 처리(아래). 감시 루프 재무장 |
| 팀원 완료 알림(에이전트 팀) | 그 슬롯의 `.result` 를 읽는다. 없으면 알림 속 마지막 응답에서 `<TSK> <id8> ` 로 시작하는 줄을 찾는다. 둘 다 없으면 `failed no-result` 로 보고 `show <id8>` 를 붙인다. 알림에 워크트리 경로가 있으면 슬롯 표에 적는다. 결과 처리(아래) |
| `TICK` | 30분 넘게 결과가 없는 running 슬롯이 있으면 `dflow.sh list --scope claimed` 1회로 서버 상태를 확인한다. 2시간 넘으면 무응답(§6). 감시 루프 재무장 |
| 사람이 이 세션에 blocked 답을 줌 | §6 blocked 재개 |

**결과 처리** — `.result` 한 줄 `<TSK> <id8> <branch|-> <head|-> <done_exit|-> <status> <사유…>`. 결과마다
`team.result`(slot, status, note)를 기록하고 집계에 넣는다.

| status | 처리 |
|---|---|
| `done` | 슬롯 해제 |
| `needs-merge` | 슬롯 해제, 승인 스윕(§4)을 한 번 더 |
| `skipped` | 제외 추가, 슬롯 해제 |
| `failed` | 제외 추가, 사유 보고, 슬롯 해제. 자동 재시도 없음. 사유가 `not-isolated` 면 새 spawn 을 멈추고 마감(§7) — 백엔드 결함이다 |
| `blocked` | §6 |

슬롯이 비면 대기 큐 앞에서 바로 spawn(§5). 큐가 비면 poll 이 다음 것을 잡는다.

## 4. 승인 스윕 (팀장 단독)

Skill 도구로 `/dflow-merge` 를 **인자 없이** 실행한다. 로컬 후보에 더해 원격 `origin/agent/*` tip 의
state.json 도 후보로 보고, approved 만 조상 먼저 `--no-ff` 로 머지하며, 반려는 따로 갈라 보고한다.
- 보고의 **반려 목록** id8 은 제외 목록에 넣고 "수동 `/dflow-dev <id8>` 대상" 으로 보고한다.
- `team.sweep`(merged, waiting, rejected 개수)을 기록한다.
- 스윕은 팀장 체크아웃을 기본 브랜치로 switch 한다. 팀원은 각자 워크트리의 agent 브랜치에 있으므로 충돌하지 않는다.

## 5. 팀원 spawn

1. 빈 슬롯 번호(1..N 중 가장 작은 것)를 고르고 `AGENT_ID=<신원>/w<slot>` 을 만든다.
2. `dflow.sh show <id8> | jq -r '.order.item.external_ref // empty'` 의 마지막 `/` 뒤를 TSK 로 쓴다(show 응답은 `{ok, order: {id, status, item, …}, reports, depends_evidence}` 모양이다 — poll.sh 도 `.order.item.tags` 를 쓴다).
3. 포인터 **한 줄**:
   ```
   <MAIN_CHECKOUT>/.claude/skills/dflow-team/references/worker-prompt.md 를 읽고 그 규칙대로 실행하라. TSK=<TSK> ID8=<id8> AGENT_ID=<신원>/w<slot> MAIN_CHECKOUT=<MAIN_CHECKOUT> BACKEND=<pane|agent-team> MODEL=<opus|sonnet|default>
   ```
   경로를 절대경로로 주는 이유: gitignore 된 심링크로 스킬을 배포한 리포는 새 워크트리에 스킬이 없다.
4. `references/backends.md` 의 해당 절(「pane — Orca」 또는 「에이전트 팀」) 명령 그대로 띄운다. 에이전트
   팀은 `isolation: "worktree"` 가 **필수**다.
5. 슬롯 표 기록, 제외 목록에 id8 추가, `team.spawn`(slot, agent_id) 기록, 감시 루프 재무장.

## 6. blocked·무응답

**blocked — pane**: 슬롯 상태를 `blocked` 로 바꾸고 **슬롯을 비우지 않는다.** 살아 있는 팀원과 같은
AGENT_ID 로 다른 작업을 띄우면 좌석표가 한 인물을 두 책상에 그린다. "결정 필요: <질문> — Orca 의
`dflow-<id8>` 탭에서 답하라" 고 보고한다. 팀원이 이어 가 `.result` 가 새 status 로 바뀌면 감시 루프가 알린다.

**blocked — 에이전트 팀**: 팀원은 이미 종료했다. 슬롯을 비우고 blocked 목록에 넣는다. "결정 필요 <id8>:
<질문> — 이 세션에 답을 달라" 고 보고한다.

**공통**: AskUserQuestion 은 쓰지 않는다. `team.blocked`(slot, note)를 기록한다. PushNotification 도구가
있으면(지연 로드면 ToolSearch 로 불러) 질문 요약으로 한 번 알린다.

**blocked 재개(에이전트 팀)** — 사람이 이 세션에서 답을 주면:
1. blocked 목록의 워크트리 경로가 아직 있으면 backends.md 「에이전트 팀 워크트리 정리」 로 먼저 지운다.
   그 워크트리가 agent 브랜치를 잡고 있으면 새 워크트리의 switch 가 `already checked out` 으로 실패한다.
2. 포인터 끝에 줄을 바꿔 `ANSWER=<답 한 줄>` 을 붙여 §5 로 띄운다(빈 슬롯이 없으면 대기 큐 맨 앞).
   재claim 은 없다 — 이미 claimed 다.

**무응답(running 2시간 이상 결과 없음)**: `dflow.sh show <id8>` 로 상태를 본다. pane 은
`orca terminal read --screen --terminal <handle>` 로 화면을 확인해 함께 보고한다. 여전히 claimed 면
워크트리를 정리하고(pane 은 「pane — Orca」 정리, 에이전트 팀은 `TaskStop <이름>` 뒤 「에이전트 팀
워크트리 정리」) "재개 필요 — 수동 `/dflow-dev <id8>`" 로 보고, 제외, 슬롯 해제.

## 7. 마감

1. 새 spawn 을 멈춘다. poll·감시 루프가 살아 있으면 `TaskStop`.
2. 승인 스윕(§4)을 한 번 돈다.
3. 집계 표(TSK · id8 · 브랜치 · head · done exit · status · 사유)를 보고한다. 대기 큐·blocked 목록·"재개 필요" 도 함께.
4. 워크트리를 backends.md 대로 정리한다. **pane 의 blocked 슬롯은 정리하지 않는다**(사람이 그 탭에서 이어받는다).
   **agent 브랜치는 남긴다** — 승인은 사람이 D'Flow 웹에서 하고, 승인 뒤 머지는 다음 `/dflow-team` 의 스윕이나 `/dflow-merge` 가 한다.
5. `team.stop`(done, failed, blocked 개수)을 기록한다.

## 금지

- AskUserQuestion. 판단이 필요하면 보고하고 사람의 답을 기다린다.
- 팀장이 작업을 claim·progress·done 하는 것. 서버 쓰기는 팀원 몫이다(스윕의 머지만 팀장이 한다).
- `isolation` 없는 에이전트 팀 spawn. 팀원을 `name`·`isolation` 없는 단순 서브에이전트로 띄우는 것.
- 팀원 워크트리에서 팀장이 git 을 조작하는 것(backends.md 의 정리 절차는 예외).
- 순번 참조, force push, 훅 우회(SKIP_GUARD).
- 같은 작업의 재spawn. 예외는 에이전트 팀 blocked 재개 하나다.
````

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/skills`
Expected: PASS 32건(Task 1 5 + Task 2 3 + dflow-team 24).

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-team/SKILL.md tests/skills/dflow-team.test.ts
git commit -m "feat(dflow-team): 팀장 절차 — 환경 감지·기상마다 승인 스윕·슬롯 보충·blocked 백엔드별 처리

팀원 작업은 팀장 체크아웃에 state.json 이 없어 poll exit 9·10 이 오지 않으므로 깨어날 때마다
스윕하고 30분 TICK 으로 한가한 구간도 깨운다. blocked 는 pane 이면 슬롯을 잡고(AGENT_ID 중복
방지) 에이전트 팀이면 회수 후 ANSWER 로 재spawn 한다."
```

---

### Task 6: 배포 목록·안내 갱신

**Files:**
- Modify: `scripts/kit-build.sh:12`
- Modify: `kit/install.sh:48`
- Modify: `kit/README.md` (스킬 표)
- Modify: `docs/agent/claude-skill/dflow-skills-guide.md` (`## 자주 겪는 상황` 앞)
- Modify: `tests/skills/dflow-team.test.ts`

**Interfaces:**
- Consumes: 완성된 `.claude/skills/dflow-team/`(Task 3~5).
- Produces: dflow-kit 빌드에 dflow-team 포함.

- [ ] **Step 1: 테스트 추가** — `tests/skills/dflow-team.test.ts` 끝에:

```ts
describe('dflow-team 배포', () => {
  it('kit-build.sh 배포 목록에 dflow-team 이 있다', () => {
    const kit = readFileSync(join(ROOT, 'scripts/kit-build.sh'), 'utf8');
    expect(kit).toMatch(/^SKILLS=".*\bdflow-team\b.*"$/m);
  });

  it('install.sh 안내와 킷 README 표에 dflow-team 이 있다', () => {
    expect(readFileSync(join(ROOT, 'kit/install.sh'), 'utf8')).toMatch(/설치 완료: .*dflow-team/);
    expect(readFileSync(join(ROOT, 'kit/README.md'), 'utf8')).toMatch(/^\| dflow-team \|/m);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team.test.ts`
Expected: 새 2건 FAIL.

- [ ] **Step 3: 네 파일 수정**

(1) `scripts/kit-build.sh` 12행:
```sh
SKILLS="dflow-work dflow-dev dflow-poll dflow-merge dflow-team dflow-export dflow-wbs-nlevel"
```

(2) `kit/install.sh` 48행:
```sh
설치 완료: $TARGET/.claude/skills/ (dflow-work · dflow-dev · dflow-poll · dflow-merge · dflow-team · dflow-export · dflow-wbs-nlevel)
```

(3) `kit/README.md` 스킬 표의 `| dflow-merge |` 행 뒤에:
```markdown
| dflow-team | 팀장 — 에이전트 위임 작업을 슬롯 N개 팀원(Orca pane 또는 에이전트 팀)에게 나눠 동시 개발. 낮 시간 supervised |
```

(4) `docs/agent/claude-skill/dflow-skills-guide.md` 의 `## 자주 겪는 상황` 줄 바로 앞에:
````markdown
## dflow-team — 팀으로 동시 개발

`/dflow-poll` 은 한 번에 한 건씩 착수한다. `/dflow-team` 은 같은 감시를 하면서 ready 작업을 슬롯 N개의
팀원에게 나눠 동시에 돌리고, 끝난 슬롯에 다음 작업을 채운다.

```
나: /dflow-team --team-size 2 --until 18:00
Claude: 백엔드 Orca. 신원 hong. 승인 스윕 — 머지 0, 대기 1. 감시 시작.
Claude: ab12cd34 로그인 화면 → w1 착수, 9f8e7d6c 설비 목록 → w2 착수.
Claude: w1 done(승인 대기로 보고). 대기 큐의 5a4b3c2d → w1 착수.
Claude: 결정 필요: 5a4b3c2d "권한 없는 사용자에게 버튼을 숨길까요, 비활성으로 둘까요?" — dflow-5a4b3c2d 탭에서 답하세요.
```

- Orca 에서 띄우면 팀원마다 탭이 생긴다(선호). 일반 터미널에서는 에이전트 팀으로 뜨고, 질문은 팀장
  세션으로 모인다 — "5a4b3c2d 는 숨김으로" 처럼 답하면 된다.
- 팀장 세션을 닫으면 에이전트 팀 팀원은 함께 멈춘다(push 한 곳까지는 남는다). 오래 돌릴 때는 Orca 가 안전하다.
- 승인은 여전히 D'Flow 웹에서 사람이 한다. 팀장은 깨어날 때마다(최대 30분 간격) 승인된 작업을 main 에 반영한다.

````

- [ ] **Step 4: 통과 확인 + 킷 빌드 검증**

Run: `npx vitest run tests/skills && sh scripts/kit-build.sh "$(mktemp -d)"`
Expected: vitest PASS 34건. kit-build 는 `빌드 완료:` 와 `skills: ... dflow-team ...` 를 출력한다("킷 밖 참조가 남아 있다" 가 나오면 SKILL.md 의 설계 정본 문구가 허용 표현 `wbs-web 리포 docs/superpowers` 를 벗어난 것이다).

- [ ] **Step 5: 커밋**

```bash
git add scripts/kit-build.sh kit/install.sh kit/README.md docs/agent/claude-skill/dflow-skills-guide.md tests/skills/dflow-team.test.ts
git commit -m "chore(kit): dflow-team 을 킷 배포 목록·설치 안내·가이드에 추가

다른 dflow-* 와 같이 dflow-kit 으로 배포한다. 가이드에는 백엔드별로 질문이 어디로 오는지와
에이전트 팀은 팀장과 함께 멈춘다는 점을 적는다."
```

- [ ] **Step 6: 머지 판단** — `npx vitest run tests/skills` 가 초록인지 다시 보고, 사람에게 "feat/dflow-team 을 머지하면 `/dflow-dev --worker`·`/dflow-merge` 변경이 심링크로 모든 리포에 즉시 적용된다" 를 알린 뒤 머지 지시를 받는다. 리허설(Task 7·8)은 머지 뒤 메인 체크아웃 기준으로 한다.

---

### Task 7: Orca 백엔드 리허설 (사람이 대화형 세션에서 수행)

**Files:**
- Modify: `docs/superpowers/specs/2026-09-10-dflow-team-design.md` (§11 끝에 기록 절 추가)

**Interfaces:**
- Consumes: 머지된 dflow-team 과 가산 수정(Task 1~6).
- Produces: 스펙 §11 합격 기준 9항의 판정 기록.

- [ ] **Step 1: mes-base 준비** — mes-base 에는 `.claude/` 가 없다(2026-09-11 확인). mes-runlog 와 같은 심링크 배포로 설치해 "새 워크트리에 스킬이 없다" 경로를 리허설이 그대로 밟게 한다.

```bash
cd ~/project/mes-base
mkdir -p .claude/skills
for s in dflow-work dflow-dev dflow-poll dflow-merge dflow-team; do ln -s /Users/jji/project/wbs-web/.claude/skills/$s .claude/skills/$s; done
grep -qx '.claude/skills/' .gitignore || printf '.claude/skills/\n' >> .gitignore
git add .gitignore && git commit -m "chore: dflow 스킬은 wbs-web 정본 심링크 — 추적 제외"
cp /Users/jji/project/wbs-web/kit/.env.example .env   # 값은 사람이 스테이징 PAT 로 채운다
```

- [ ] **Step 2: 작업 준비** — 스테이징 D'Flow 에서 mes-base 프로젝트에 `agent` 태그가 붙은 독립 ready 작업 3건을 만든다. 그중 1건의 spec 에는 담당자 결정이 필요한 분기를 일부러 남긴다(예: "비권한 사용자에게 버튼을 숨길지 비활성화할지는 정하지 않았다").

- [ ] **Step 3: 실행** — Orca 에서 mes-base 를 열고 `/dflow-team --team-size 2 --until <2시간 뒤>`.

- [ ] **Step 4: 합격 기준 9항 판정**(스펙 §11) — 각 항목을 실제 명령으로 확인한다.
  - 1: 첫 poll 에서 2건 spawn, 3번째는 대기 큐 → 먼저 빈 슬롯에 자동 배정(팀장 보고와 `events.jsonl`).
  - 2: `git branch -r --list 'origin/agent/*'` 에 3개.
  - 3: `git -C ~/project/mes-base branch --show-current` 와 `git status --porcelain` 이 실행 전후 같다(스윕으로 기본 브랜치가 된 것은 정상).
  - 4: `dflow.sh show <id8>` 3건이 각자 reported, 다른 주문 무변화.
  - 5: 결정 분기 작업이 blocked → 그 탭에서 답 → 같은 워크트리·브랜치에서 done.
  - 6: 마감 뒤 `orca worktree list` 에 dflow-* 없음, agent 브랜치 3개는 원격에 남음. 특히 워크트리가 agent 브랜치로 switch 된 상태에서 `orca worktree rm` 이 깨끗이 돌았는지.
  - 7: `/dflow-team` 을 다시 돌리면 스윕이 원격 브랜치 3개를 후보로 잡는다(승인 전이면 대기).
  - 8: `~/.dflow/events.jsonl` 순서 `team.start` → `team.spawn`×2 → `team.result` → `team.spawn` → `team.blocked` → … → `team.stop`, 각 워크트리 루트 `.dflow-agent` 가 `<신원>/w1`·`<신원>/w2`.
  - 9: 각 워크트리 `docs/tasks/<TSK>/.result` 한 줄의 status 가 서버·브랜치 상태와 맞다.
  - 추가: 워커 세션이 `/dflow-dev` 를 Skill 도구로 불렀는지, SKILL.md 직접 읽기 폴백을 탔는지 기록한다(스펙 §3-15).

- [ ] **Step 5: 기록** — 스펙 §11 끝에 `### 11-A. Orca 리허설 기록 (YYYY-MM-DD, mes-base, 스테이징)` 절을 추가하고 9항과 추가 항목의 결과(통과·실패·관찰)를 표로 적는다. 실패 항목은 원인(팀원 transcript: `orca terminal read`, `dflow.sh show`)과 고친 커밋을 함께 적는다. 서버 쓰기 오류가 있었으면 스테이징에서 해당 주문을 release 해 되돌린다.

```bash
git add docs/superpowers/specs/2026-09-10-dflow-team-design.md
git commit -m "docs(spec): /dflow-team Orca 리허설 기록 — 합격 기준 9항 판정"
```

---

### Task 8: 에이전트 팀 백엔드 리허설 (사람이 대화형 세션에서 수행)

**Files:**
- Modify: `docs/superpowers/specs/2026-09-10-dflow-team-design.md` (§11-B 기록 절)
- 조건부 Modify: `.claude/skills/dflow-team/references/worker-prompt.md`, `.claude/skills/dflow-dev/SKILL.md`(「--worker」 E 행), `tests/skills/*.test.ts` — Step 3 예비책을 탈 때만

**Interfaces:**
- Consumes: Task 7 과 같은 준비물(mes-base 심링크 설치, 작업 3건 — 새로 3건 만든다).
- Produces: 스펙 §11 에이전트 팀 추가 6항의 판정 기록. 필요 시 git 경로 예비책 적용.

- [ ] **Step 1: 실행** — Orca 가 아닌 일반 터미널(macOS Terminal)에서 mes-base 를 열고 `/dflow-team --team-size 2 --until <2시간 뒤>`. 시작 보고에 백엔드가 "에이전트 팀" 으로 나오는지 본다.

- [ ] **Step 2: 합격 기준** — Task 7 의 9항(Orca 전용인 6번 `orca worktree rm` 은 「에이전트 팀 워크트리 정리」 로 바꿔 읽는다) + 스펙 §11 추가 6항:
  - A1: 두 팀원이 **서로 다른** `.claude/worktrees/agent-*` 를 받았고 팀장 체크아웃의 브랜치·워킹트리가 불변.
  - A2: 워커와 Phase 서브에이전트가 `command -v git` 절대경로로 `/dflow-dev` 를 완주 — rtk 차단 메시지 "a worktree-isolated agent's git operations must target its own worktree" 가 한 번이라도 나오면 지점을 기록한다.
  - A3: blocked 작업에서 팀원이 **종료**하고 슬롯이 회수돼 다음 작업이 들어간다.
  - A4: 팀장 세션을 의도적으로 닫으면 팀원도 멈추고, 재기동 시 claimed 가 "재개 필요" 로 보고된다.
  - A5: 팀원 종료 뒤 워크트리가 자동 정리됐는지 보존됐는지, `.result` 를 파일과 마지막 응답 중 어디서 읽었는지 기록. 보존됐다면 마감 정리가 깨끗이 도는지.
  - A6: blocked 에 답한 뒤 재spawn 된 워커가 `ANSWER` 를 design.md 에 남기고 같은 agent 브랜치 위에서 이어 간다.

- [ ] **Step 3: 예비책(A2 에서 차단이 나온 경우에만)** — git 경로를 리터럴 `/usr/bin/git` 으로 바꾼다(스펙 §3-5-A 예비책).
  1. `worker-prompt.md` §0 첫 문장을 "모든 git 호출은 절대경로 `/usr/bin/git` 으로 한다" 로 바꾸고, `command -v git` 언급을 지운다.
  2. `/dflow-dev` SKILL.md 「--worker」 E 행의 따옴표 안 문구를 "git 은 절대경로 `/usr/bin/git` 으로 호출한다(bare `git` 금지)" 로 바꾼다. 이 행은 Task 1 이 새로 넣은 줄이므로 fixture 가산성 테스트에 영향이 없다.
  3. 테스트의 `expect(sec).toContain('command -v git')`(dflow-dev-worker)·`expect(p()).toContain('command -v git')`(dflow-team)를 `'/usr/bin/git'` 으로 바꾼다.
  4. `npx vitest run tests/skills` PASS 확인 후 커밋:
  ```bash
  git add .claude/skills/dflow-team/references/worker-prompt.md .claude/skills/dflow-dev/SKILL.md tests/skills/dflow-dev-worker.test.ts tests/skills/dflow-team.test.ts
  git commit -m "fix(dflow-team): git 경로를 /usr/bin/git 리터럴로 — 리허설에서 절대경로도 rtk 에 재작성됨"
  ```
  5. 에이전트 팀 리허설을 다시 돌려 A2 를 재판정한다. 그래도 막히면 rtk 훅 수정(근본 해결)을 사람에게 보고하고 멈춘다.

- [ ] **Step 4: 기록** — 스펙 §11 끝에 `### 11-B. 에이전트 팀 리허설 기록 (YYYY-MM-DD, mes-base, 스테이징)` 절을 추가해 9항·A1~A6 결과를 적는다.

```bash
git add docs/superpowers/specs/2026-09-10-dflow-team-design.md
git commit -m "docs(spec): /dflow-team 에이전트 팀 리허설 기록 — rtk·동반 종료·워크트리 보존 판정"
```

---

## 이 계획 밖 (후속)

- **tmux pane 백엔드**: dev-plugin `hooks/hooks.json` 로드 실패 수정 → `/team-mode` 인터페이스 확인 → backends.md 「pane — tmux」 순수 가산. 그 전까지 tmux 는 에이전트 팀.
- **좌석표 연동**: `.dflow-agent` 를 `heartbeat_agent` 로 읽는 PostToolUse 훅, `blocked` 상태, 팀장 STANDBY 신호 — 좌석표 설계 S1·S2 몫(스펙 §9). `dflow.sh heartbeat` 서브커맨드도 S1.
- **poll exit 9 미러**: 승인 반영 지연(최대 30분)이 실제 문제가 되면 스펙 §4-2 의 기각한 대안을 되살린다.
- **2차 리허설**: 실제 두 신원·두 PC(스펙 §11).

## 자체 검토 (2026-09-11 작성 시점)

**1. 스펙 대비 누락** — §4-0 환경 감지(Task 5 §0), §4-1 전제 검사·재기동 대조(Task 5 §1), §4-2 이벤트 표·스윕 주기·TICK(Task 5 §2·§3), §4-3 백엔드별 spawn(Task 4 backends.md, Task 5 §5), §4-4 마감(Task 5 §7), §5 워커 계약(Task 3), §5-A 행 A~E(Task 1), §6·§6-A 원격 후보·반려 갈래(Task 2), §7 blocked·무응답·세션 소실(Task 5 §1-4·§6), §9-1 `.dflow-agent`(Task 3), §9-3 이벤트(Task 4 events.md), §10 파일 구성·킷(Task 4~6), §11 리허설(Task 7·8), §12 rtk 예비책(Task 8 Step 3). 좌석표 S1·S2 연동과 tmux pane 은 스펙이 이번 범위 밖으로 둔 것이라 후속 절로 뺐다.

**2. 자리표시자 점검** — 파일 내용·테스트 코드·명령은 전부 본문에 있다. `<id8>`·`<TSK>`·`<경로1>` 같은 꺾쇠는 실행 시 값으로 채우는 **절차상의 변수**이지 미작성 부분이 아니다. Task 7·8 은 사람이 수행하는 리허설이라 판정 결과를 적는 기록 절만 비워 둔다.

**3. 이름 일관성** — 포인터 키 `TSK ID8 AGENT_ID MAIN_CHECKOUT BACKEND MODEL ANSWER`, 변수 `{MODEL_FLAG}`(워커가 `MODEL` 에서 만든다), 좌석 파일 `.dflow-agent`, 감시 출력 `RESULT_READY`·`TICK`, 에이전트 이름 `w<slot>-<id8>`, 이벤트 여섯, backends.md 절 이름 「pane — Orca」「에이전트 팀」「에이전트 팀 워크트리 정리」 가 Task 3·4·5·테스트에서 같은 철자로 쓰인다. `/dflow-dev` 표지 「--worker」 A·B·C·E 와 절 제목 `## --worker — 팀원 모드` 는 Task 1 테스트와 Task 8 예비책이 같은 문자열을 쓴다.
