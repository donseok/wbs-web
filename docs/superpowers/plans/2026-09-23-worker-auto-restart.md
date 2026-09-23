# 팀원 자동 재시작 (과제 H + G 중단 표식) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/dflow-team` 팀장이 결과 없이 멈춘 팀원(무응답·pane 죽음·rate-limit)을 원인별로 가려 같은 워크트리·같은 슬롯에서 다시 띄우고, 재시도 상한 3 을 고아 재개와 나눠 쓰며, 낡은 `.cancelled` 표식이 재시작을 막지 않게 spawn 직전에 지운다.

**Architecture:** 코드가 아니라 스킬 문서(팀장 절차의 실행체)를 바꾼다. 새 절차·셸 블록은 새 참조 파일 `references/restart.md` 한 곳에 모으고, `SKILL.md` 에는 그 파일을 부르는 짧은 문장만 기존 줄 옆에 넣는다(다른 세션이 `SKILL.md`·`dflow.sh` 를 병행 수정 중이라 머지 충돌을 줄인다). 손실은 새 이벤트 `team.lost` 로 적어 `team.result` 가 재시도 카운터를 0 으로 되돌리지 않게 한다. tmux 팀원의 `.dflow-run` 은 `--settings` 로 statusLine 을 붙여 `rate_limits` 를 `~/.dflow/limits/<id8>.json` 에 남기고, 팀장은 그것으로 한도 해제 시각을 정한다.

**Tech Stack:** Markdown 스킬 문서 · POSIX sh + jq + tmux · Claude Code CLI 2.1.280(`--settings <file-or-json>`) · vitest(`npx vitest run <path>`)

**Spec:** `docs/superpowers/specs/2026-09-23-worker-auto-restart-design.md`

## Global Constraints

- 작업 위치: 워크트리 `/Users/jji/project/wbs-web-restart`(브랜치 `feat/worker-auto-restart`, 기점 `origin/staging`). 메인 체크아웃 `/Users/jji/project/wbs-web` 는 건드리지 않는다.
- 반영은 이 브랜치 → `origin/staging` 머지·push 까지다. main push·dflow-kit 재빌드는 하지 않는다. `kit/` 안 파일 수정은 한다.
- `git add -A` 금지. 파일명을 명시해 stage 한다. 마이그레이션은 없다.
- 커밋 메시지는 한국어("무엇"보다 "왜"), 끝 두 줄은 `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` 과 `Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA`.
- 스펙 §11: **스크립트를 새로 만들지 않는다.** statusLine 명령은 `.dflow-run` 이 가리키는 설정 파일 안의 한 줄 `jq` 다.
- 스펙 G3: **heartbeat 훅(`kit/hooks/heartbeat.sh`)은 고치지 않는다.** `tests/skills/heartbeat-hook.test.ts` 는 손대지 않고 그대로 통과해야 한다.
- 스펙 U2: 오피스 「자동 재시작 예정 시각」 표시·서버·마이그레이션은 범위 밖이다. 팀장 텍스트 보고에만 싣는다.
- 셸 블록은 sh·bash·zsh 에서 모두 파싱돼야 한다(`tests/skills/dflow-team-shell-blocks.test.ts`). zsh 는 따옴표 없는 변수를 단어로 나누지 않으므로 `$VAR` 로 인자 개수를 바꾸지 않는다. `${V:+a "$V"}` 꼴 금지. `hostname -s` 금지(`hostname | cut -d. -f1`).
- 이벤트는 `references/events.md` 의 가드를 통과해야 한다. 모르는 값은 `""` 가 아니라 `-`.
- 에러 3원칙: 조회 실패를 "없음"으로 위장하지 않는다(`show` 실패는 `SHOW_FAILED`, 재시작 없음), 쓰기 전 선행 조회 실패면 중단, 가드는 fail-closed.
- 테스트는 실제 `~/.dflow` 를 건드리지 않는다. 셸 블록을 실행하는 테스트는 모두 `HOME` 을 임시 디렉터리로 준다. 서버를 부르는 줄(`dflow.sh show`)은 가짜 스크립트로 바꾸거나 떼어 내고 돌린다.
- SKILL.md·backends.md 를 고치기 전에 바꾸는 문구를 `grep -rn '<문구>' tests/skills/` 로 찾아, 기존 테스트가 잡는 부분 문자열(`dflow-team.test.ts` 의 `'**곧바로** \`failed no-result\` 로 판정한다'`, `'| \`failed no-result\`(pane 이 죽었는데 결과 줄 없음) |'`, `'"무응답" 으로 보고만 하고 슬롯을 유지한다'`, `'**두 TICK 연속으로** 생존 증거가 없을 때만'`, `'「2. 기상과 감시」「3. 결과 처리」「6. blocked」「7. 마감」 과 \`references/events.md\`'`)을 깨지 않는다.
- 기존 줄의 대규모 재배치 금지. 기존 문장 끝에 덧붙이거나 새 줄·새 항목을 넣는다.

## Review Focus

- **`show` 실패·점유 변동이 재시작으로 새지 않는가**: `show` 가 실패하거나 오류 JSON(`{"ok":false}`)을 주거나, 주문이 `claimed`+`mine`+이 PC 가 아니면 절대 재투입하지 않아야 한다. → Task 2 테스트 `판정 블록: show 실패·빈 출력·오류 JSON 은 SHOW_FAILED`.
- **`team.lost` 가 재시도 카운터를 끊지 않는가**: `resume` 사이에 `team.lost` 가 끼어도 2, `team.start` 로 끊기지 않고, `readopt` 는 세지 않으며, `team.result` 뒤만 0. 상한 3 이면 `park` 이고 다음 팀장 시작의 고아 스캔이 `PARKED` 를 다시 재개하지 않는다. → Task 2 테스트 `재시도 수(SKILL.md 블록)`·`이벤트로 본 상태`.
- **낡은 `.cancelled` 표식 정리가 fail-closed 인가**: `ready`·`claimed` 에서만 지우고, 지우지 못하면 `CANCEL_MARK_RM_FAILED` 로 spawn 하지 않는다. `cancelled`·`reported` 주문의 표식은 남긴다. → Task 2 테스트 `중단 표식 정리`, Task 3 테스트 `5·5-1 은 띄우기 직전에 표식을 정리한다`.
- **statusLine 설정이 팀원을 죽이지 않는가**: `--settings` 파일이 깨지면 모든 tmux 팀원이 첫 화면에서 죽고, 새 규칙에서는 그것이 재시작 반복 → 전원 `park` 로 번진다. 설정 파일은 유효 JSON 이고, 그 statusLine 명령은 샘플 입력으로 한도 파일을 쓰며, **설정 파일이 없으면 `.dflow-run` 은 `--settings` 없이 띄운다**(claude 는 없는 설정 파일에서 곧바로 끝난다). 한도 파일이 없거나 깨져도 판정은 "한도 아님"이지 오류가 아니다. → Task 4 테스트 전부 + Task 2 `한도 판정` 의 깨진 파일 사례.
- **rate-limit 대기 슬롯이 무응답으로 두 번 세지지 않는가**: 마지막 이벤트가 `team.lost cause=rate-limit next=wait` 인 슬롯은 「판정」 을 건너뛰고 「rate-limit 대기」 만 따른다. 그 사이 pane 이 죽어도 `restart_at` 까지 기다린다. → Task 2 테스트 `restart.md 계약: rate-limit 대기 슬롯은 판정을 건너뛴다`.

## 미결 처리

스펙 §14 와 이 워크트리 판에서 드러난 빈 곳을 아래 기본안으로 정한다.

- §14-1 한도 화면 문구: **화면 판정을 끈다.** `restart.md` 의 `LIMIT_SCREEN_RE=''` 가 기본값이며, 실측(캡처) 전에는 채우지 않는다. 한도 출처는 statusLine 덤프 하나이고, 화면 fixture·정규식 확정은 범위 밖이다.
- §14-2 statusLine 이 한도 중에 갱신되는지: 미실측 그대로 statusLine 덤프를 채택한다. 갱신되지 않으면 한도를 못 알아채 무응답 재시작으로 가고, 거듭 죽으면 상한 3 에서 `park` 로 멈춘다(최악이 "멈춤"이지 폭주가 아니다).
- §14-3 한도 중 팀장 기상·`send-keys '계속'` 대안: 범위 밖. 재시작만 한다.
- §14-4 모델별 한도: H10 그대로 **전면 보류**(보수안). 모델별 보류는 사례를 본 뒤.
- §14-5 Orca 관문: **Orca 재투입 비활성.** Orca 는 분류·알림·`--resume` 재시작 명령 안내까지만 하고 `team.lost` 를 기록하지 않는다. `orca terminal close/create` 는 실행 절차에 넣지 않는다. 실측은 범위 밖.
- §14-6 `show` 연속 실패: 같은 슬롯이 두 TICK 연속 측정 실패면 「멈춤」 표에 사유 `서버 조회 실패` 로 **보고만** 하고 슬롯은 유지한다.
- §14-7 줄 번호: 이 계획의 모든 인용은 이 워크트리(origin/staging, lease 포함) 판에서 다시 확인했다. 수정 위치는 줄 번호가 아니라 인용한 문자열로 찾는다.
- 스펙 빈 곳 ①(5-1 항 번호): 이 판의 「5-1」 은 6항이 띄우기, 7항이 옛 `.result` 삭제, 8항이 `team.spawn` 이다. 표식 정리는 스펙의 "7항 직전" 이 아니라 **6항(띄우기) 직전**에 둔다. 「5」 는 5항 직전.
- 스펙 빈 곳 ②(새 작업의 status): poll exit 0 의 show 필터가 `.order.status` 를 내지 않아 G1 의 `ready` 갈래에 값이 없다. 필터에 `status: .order.status` 를 더한다.
- 스펙 빈 곳 ③(`park` 재개): 스펙 §5-3 의 고아 스캔 다섯째 조건은 rate-limit 대기만 막는다. `rate-limit 반복`·`중단 표식 불일치` 로 `park` 한 작업은 재시도가 3 미만이라 다음 팀장 시작 때 다시 재개된다(H5 무력화). 다섯째 조건을 **마지막 이벤트가 `team.lost` 이고 `PARKED`·`RL_WAIT`·`RL_DUE` 면 재개하지 않는다** 로 넓힌다.
- 스펙 빈 곳 ④(`failed rate-limit` 결과 줄): §4-1 대로 재시작 판정은 결과 줄이 없을 때만 한다. 결과 줄을 쓴 `failed rate-limit` 은 status 표의 현행 처리 그대로이며 자동 재시작·보류 대상이 아니다(`team.result` 가 카운터를 되돌려 무한 반복할 수 있다).
- 스펙 빈 곳 ⑤(정체 슬롯): 원인 분류는 **정체 슬롯**(pane 죽음, 또는 생존 증거가 직전 TICK 과 같음)에만 한다. 움직이는 워커를 한도로 분류하지 않고, 결과 보고 직전의 정상 전이(`reported`)를 "점유 변동" 으로 멈추지 않는다.
- 스펙 빈 곳 ⑥(대기 중 증거 저장): rate-limit 감지 때의 생존 증거를 `team.lost` 의 **선택 필드 `evidence`**(세 증거를 이은 cksum)로 남긴다. 가드는 필수 필드만 보므로 통과한다. 컨텍스트 압축 뒤에도 재측정 비교가 된다.
- 스펙 빈 곳 ⑧(상한 횟수): 재시도 수 3 이면 `park` 이므로 자동 재시작은 3번이고 **네 번째 손실**에서 멈춘다. 스펙 §12 의 "세 번 연속 죽이면 멈춤" 은 하나 모자라며, 리허설(Task 6 Step 3)은 네 번째 kill 로 확인한다.
- 스펙 빈 곳 ⑨(점유 변동): 「판정」 3번(서버 `claimed`·`mine`·이 PC 가 아님)은 `team.lost` 를 쓰지 않고 「멈춤」 보고만 한다(현행 무응답 정리와 같은 영속 범위). `park` 이벤트는 4번(G2)과 상한·rate-limit 반복에만 쓴다.
- 스펙 빈 곳 ⑦(거두기 순서): pane 을 거두고 `.dflow-agent` 를 `parked` 로 바꾼 **뒤에** `team.lost` 를 쓴다. 기록 뒤 거두기 전에 끊기면 살아 있는 pane 옆에 재투입이 겹친다. 거두기 뒤 기록 전에 끊기면 고아 스캔이 평범한 재개로 잇는다.

---

## 파일 구조

| 파일 | 책임 | Task |
|---|---|---|
| `.claude/skills/dflow-team/references/events.md` | `team.lost` 행·필드 설명·가드 `$req`·기록 조각 | 1 |
| `tests/skills/dflow-team-restart-events.test.ts` (신규) | 표 행·가드 실행 | 1 |
| `.claude/skills/dflow-team/references/restart.md` (신규) | 판정·한도·카운터·재투입·rate-limit 대기·표식 정리·Orca·마감 — 새 절차 전부 | 2 |
| `tests/skills/fixtures/limits/*.json` (신규 4개) | statusLine 덤프 fixture | 2 |
| `tests/skills/dflow-team-restart-blocks.test.ts` (신규) | restart.md 블록 실행·문서 계약 | 2 |
| `tests/skills/dflow-team-shell-blocks.test.ts` | `DOCS` 에 restart.md 추가 | 2 |
| `.claude/skills/dflow-team/SKILL.md` | restart.md 를 부르는 문장, show 필터 `status`, 표식 정리 호출, 차단기·제외·고아 스캔·재기동 조건 | 3 |
| `tests/skills/dflow-team-restart-flow.test.ts` (신규) | SKILL.md 흐름 계약 | 3 |
| `tests/skills/dflow-team-depends-precheck.test.ts` | show 필터의 `status` | 3 |
| `.claude/skills/dflow-team/references/backends.md` | `.dflow-run` statusLine 설정, Orca 낡은 줄 | 4 |
| `tests/skills/dflow-team-restart-statusline.test.ts` (신규) | 설정 파일·statusLine 명령 실행 | 4 |
| `.claude/skills/dflow-team/references/help.md` · `.claude/skills/dflow-dev/SKILL.md` · `kit/README.md` | 사용자 안내·G3 문장 | 5 |
| `tests/skills/dflow-team-restart-docs.test.ts` (신규) | 안내 문장 계약 | 5 |

Task 의존: 1 → 2(restart.md 가 events.md 의 조각을 부른다) → 3(SKILL.md 가 restart.md 의 절 이름을 부른다). 4 는 2 뒤(Task 2 의 한도 블록으로 교차 검증), 5 는 독립이라 1 과 병렬로 해도 된다. 6·7 은 컨트롤러가 모두 끝난 뒤 한다.

절 이름은 이 계획에 고정한다(다른 Task 가 문자열로 부른다): restart.md 의 `## 요약` · `## 이벤트로 본 상태` · `## 판정` · `## 한도 판정` · `## 재시작 후보를 띄울지` · `## 재투입` · `## rate-limit 대기` · `## 중단 표식 정리` · `## Orca` · `## 마감·lease·잠금` · `## 알림 한 줄`.

---

### Task 0: 워크트리 준비 (컨트롤러가 직접)

- [ ] **Step 1: 워크트리·브랜치 확인**

```bash
git -C /Users/jji/project/wbs-web-restart branch --show-current   # feat/worker-auto-restart
git -C /Users/jji/project/wbs-web-restart fetch -q origin
git -C /Users/jji/project/wbs-web-restart log --oneline -1 origin/staging
ls /Users/jji/project/wbs-web-restart/node_modules/.bin/vitest || (cd /Users/jji/project/wbs-web-restart && npm ci --silent)
```

- [ ] **Step 2: 기준선**

Run: `cd /Users/jji/project/wbs-web-restart && npx vitest run tests/skills 2>&1 | tail -5`
Expected: 실패 0. 실패가 있으면 기록해 두고 이 계획의 변경과 구분한다.

---

### Task 1: 이벤트 `team.lost` — events.md

**Files:**
- Modify: `.claude/skills/dflow-team/references/events.md` (머리 문단, 이벤트 표, 필드 설명, 제외 목록 문장, 가드 `$req`, 기록 조각 추가)
- Test: `tests/skills/dflow-team-restart-events.test.ts` (신규)

**Interfaces:**
- Produces: 이벤트 `team.lost`, 필수 추가 필드 `slot`·`id8`·`worktree`·`cause`(`no-response`|`pane-dead`|`rate-limit`)·`next`(`restart`|`wait`|`park`)·`restart_at`(epoch 초 문자열 또는 `-`), 선택 필드 `evidence`(cksum 문자열 또는 `-`). 가드 `$req` 항목 `"team.lost":["slot","id8","worktree","cause","next","restart_at"]`. events.md 「기록 명령」 절 안의 ` ```text ` 조각(두 줄) — 기록 블록의 넷째·다섯째 줄을 이것으로 바꾸고 `--arg event` 를 `team.lost` 로 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/skills/dflow-team-restart-events.test.ts`:

```ts
// team.lost 이벤트(스펙 2026-09-23-worker-auto-restart-design.md §5-1): 표·가드·기록 조각을 문서에서 꺼내 그대로 돌린다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EV = () => readFileSync(join(process.cwd(), '.claude/skills/dflow-team/references/events.md'), 'utf8')
let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'lost-')) })
afterEach(() => { rmSync(home, { recursive: true, force: true }) })

function recordBlock(): string[] {
  const ev = EV()
  const m = ev.slice(ev.indexOf('## 기록 명령')).match(/```bash\n(mkdir -p ~\/\.dflow && line=\$\(jq -nc[\s\S]*?)```/)
  if (!m) throw new Error('기록 블록을 찾지 못했다')
  return m[1].trimEnd().split('\n')
}
function lostFragment(): string[] {
  const m = EV().match(/```text\n( {2}--arg slot [^\n]*--arg cause [^\n]*\n {2}'\{ts:[^\n]*\n)```/)
  if (!m) throw new Error('team.lost 조각을 찾지 못했다')
  return m[1].trimEnd().split('\n')
}
// events.md 의 안내대로: 기록 블록의 추가 인자 줄과 객체 줄을 조각으로 바꾸고 event 이름을 바꾼다.
function lostCommand(over: (code: string) => string = (c) => c): string {
  const lines = recordBlock()
  const at = lines.findIndex((l) => l.trimStart().startsWith('--arg slot'))
  if (at < 0) throw new Error('추가 인자 줄이 없다')
  lines.splice(at, 2, ...lostFragment())
  const code = lines.join('\n')
    .replace("--arg event 'team.result'", "--arg event 'team.lost'")
    .replace(/'<[^'\n]*>'/g, "'X'")
  return over(code)
}
function run(code: string) {
  return spawnSync('sh', ['-c', code], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: home } })
}
const lines = () => {
  const f = join(home, '.dflow', 'events.jsonl')
  return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
}

describe('team.lost 이벤트', () => {
  it('이벤트 표에 행이 있고 가드 $req 에 필수 필드가 있다', () => {
    expect(EV()).toContain('| `team.lost` | 「3. 결과 처리」 재시작 판정(`references/restart.md`) | `slot`, `id8`, `worktree`, `cause`, `next`, `restart_at` |')
    expect(EV()).toContain('"team.lost":["slot","id8","worktree","cause","next","restart_at"]')
  })
  it('필드 값 목록과 evidence 선택 필드를 적는다', () => {
    const e = EV()
    expect(e).toContain('`no-response` · `pane-dead` · `rate-limit`')
    expect(e).toContain('`restart` · `wait` · `park`')
    expect(e).toMatch(/`evidence`[^\n]*선택/)
    expect(e).toMatch(/`team\.lost`[\s\S]{0,200}`team\.result` 를 쓰지 않는다/)
  })
  it('제외 목록 규칙에 team.lost 가 들어간다', () => {
    expect(EV()).toContain('마지막 `team.spawn`·`team.blocked`·`team.result`·`team.lost` 로 정한다')
  })
  it('조각대로 만든 완전한 team.lost 줄은 가드를 통과해 붙는다', () => {
    const r = run(lostCommand((c) => c
      .replace("--arg cause 'X'", "--arg cause 'pane-dead'")
      .replace("--arg next 'X'", "--arg next 'restart'")
      .replace("--arg restart_at 'X'", "--arg restart_at '-'")))
    expect(r.stdout).not.toContain('EVENT_ARGS_MISSING')
    const [l] = lines()
    expect(l).toMatchObject({ event: 'team.lost', phase: 'team', cause: 'pane-dead', next: 'restart', restart_at: '-', evidence: 'X' })
  })
  it('restart_at 이 비면 EVENT_ARGS_MISSING 이고 줄을 붙이지 않는다', () => {
    const r = run(lostCommand((c) => c.replace("--arg restart_at 'X'", "--arg restart_at ''")))
    expect(r.stdout).toContain('EVENT_ARGS_MISSING')
    expect(lines()).toEqual([])
  })
  it('cause 인자를 빠뜨리면(첫 jq 컴파일 오류) EVENT_ARGS_MISSING 이다', () => {
    const r = run(lostCommand((c) => c.replace("--arg cause 'X' ", '')))
    expect(r.stdout).toContain('EVENT_ARGS_MISSING')
    expect(lines()).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team-restart-events.test.ts`
Expected: FAIL (표 행 없음, `team.lost 조각을 찾지 못했다`)

- [ ] **Step 3: events.md 머리 문단**

`재구성(SKILL.md 「팀장 상태」)이 \`team.start\` 이후의 \`team.spawn\`·\`team.result\`·\`team.blocked\`·` 로 시작하는 문장 끝(`\`team.answer\` 를 보조 정본으로 읽는다.`)에 이어 붙인다:

```markdown
자동 재시작(`references/restart.md`)은 `team.lost` 를 `team.start` 로 자르지 않고 읽는다.
```

- [ ] **Step 4: 이벤트 표에 행 추가**

`| \`team.stop\` | 「7. 마감」 | 없음 |` 줄 **바로 위**에 넣는다:

```markdown
| `team.lost` | 「3. 결과 처리」 재시작 판정(`references/restart.md`) | `slot`, `id8`, `worktree`, `cause`, `next`, `restart_at` |
```

- [ ] **Step 5: 필드 설명 추가**

`- \`team.answer\`: \`answer\` 는 사람이 준 답 한 줄이다.` 로 시작하는 항목 **바로 위**에 넣는다:

```markdown
- `team.lost`: 결과 줄 없이 멈춘 팀원을 자동 재시작 판정(`references/restart.md`)이 처리한 기록이다. **이 손실에는
  `team.result` 를 쓰지 않는다.** 재시도 수가 마지막 `team.result` 에서 0 으로 돌아가므로(SKILL.md 「팀장 상태」 고아
  스캔 2번), `team.result` 를 쓰면 상한 3 이 영영 닿지 않는다.
  `cause` 는 `no-response` · `pane-dead` · `rate-limit` 중 하나다. `next` 는 `restart` · `wait` · `park` 중 하나이며
  `restart` 는 같은 기상에 곧바로 재투입, `wait` 는 차단기·rate-limit 대기로 미룸, `park` 는 멈춤이다.
  `restart_at` 은 재투입을 다시 볼 시각(epoch 초 문자열)이고 정해지지 않았으면 `-` 다. `restart`·`park` 는 늘 `-` 다.
  `evidence` 는 선택 필드이며 rate-limit 감지 때의 생존 증거 요약(restart.md 「rate-limit 대기」)이다. 없으면 `-`.
  기본 필드 `tsk`·`order` 도 채운다.
```

- [ ] **Step 6: 제외 목록 문장 수정**

`- 제외 목록은 id8 마다 마지막 \`team.spawn\`·\`team.blocked\`·\`team.result\` 로 정한다. 마지막이 \`team.spawn\` 이나` 줄과 그다음 두 줄을 아래로 바꾼다:

```markdown
- 제외 목록은 id8 마다 마지막 `team.spawn`·`team.blocked`·`team.result`·`team.lost` 로 정한다. 마지막이 `team.spawn` 이나
  `team.blocked` 면 진행 중(영구 제외), `team.result` 면 그 `status` 의 제외 칸(SKILL.md 「3. 결과 처리」), `team.lost` 면
  진행 중(영구 제외, restart.md 「이벤트로 본 상태」)이다. `team.answer` 는 제외를 바꾸지 않는다.
```

- [ ] **Step 7: 가드 `$req` 에 추가**

기록 블록의 가드 객체에서 `"team.extend":["until","until_label"],` 을 `"team.extend":["until","until_label"],"team.lost":["slot","id8","worktree","cause","next","restart_at"],` 로 바꾼다(한 줄 안의 문자열 치환, 줄 수 불변).

- [ ] **Step 8: 기록 조각 추가**

기록 블록(` ```bash ` … `>> ~/.dflow/events.jsonl || echo EVENT_ARGS_MISSING` … ` ``` `) **바로 아래**에 넣는다:

````markdown
`team.lost` 는 위 블록의 `--arg event` 를 `'team.lost'` 로 쓰고, 넷째·다섯째 줄(추가 인자 줄과 객체 줄)을 아래 두 줄로
바꾼다. `cause`·`next`·`restart_at` 의 값은 restart.md 가 정한다.
```text
  --arg slot '<slot 또는 ->' --arg id8 '<id8>' --arg worktree '<워크트리 또는 ->' --arg cause '<no-response|pane-dead|rate-limit>' --arg next '<restart|wait|park>' --arg restart_at '<epoch 초 또는 ->' --arg evidence '<생존 증거 요약 또는 ->' \
  '{ts:$ts,host:$host,repo:$repo,tsk:$tsk,order:$order,phase:"team",event:$event,agent:$agent} + {slot:$slot,id8:$id8,worktree:$worktree,cause:$cause,next:$next,restart_at:$restart_at,evidence:$evidence}') \
```
````

- [ ] **Step 9: 통과 확인**

Run: `npx vitest run tests/skills/dflow-team-restart-events.test.ts tests/skills/dflow-team-backends.test.ts tests/skills/dflow-team-shell-blocks.test.ts`
Expected: PASS (backends 테스트의 일곱 행·가드 문자열 검사도 그대로 통과)

- [ ] **Step 10: 커밋**

```bash
cd /Users/jji/project/wbs-web-restart
git add .claude/skills/dflow-team/references/events.md tests/skills/dflow-team-restart-events.test.ts
git commit -F - <<'EOF'
feat(dflow-team): 자동 재시작 손실을 team.lost 로 적는다

team.result 는 재개 재시도 수를 0 으로 되돌리므로, 멈춘 팀원을 다시 띄울 때 결과로 적으면
상한 3 이 영영 닿지 않는다. 손실 전용 이벤트와 가드 필드를 둔다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
EOF
```

---

### Task 2: 절차 정본 — `references/restart.md`

**Files:**
- Create: `.claude/skills/dflow-team/references/restart.md`
- Create: `tests/skills/fixtures/limits/five-hour-full.json`, `both-full.json`, `below.json`, `no-field.json`
- Create: `tests/skills/dflow-team-restart-blocks.test.ts`
- Modify: `tests/skills/dflow-team-shell-blocks.test.ts` (`DOCS` 배열)

**Interfaces:**
- Consumes: Task 1 의 `team.lost` 필드·조각. SKILL.md 「팀장 상태」 고아 스캔 2번의 재시도 블록(`tries=` 를 출력, 이미 있음).
- Produces (SKILL.md·backends.md 가 부른다):
  - `## 이벤트로 본 상태` 블록 → 탭 구분 줄 `<RESTART_DUE|RL_WAIT|RL_DUE|PARKED>\t<id8>\t<cause>\t<restart_at>\t<worktree>\t<evidence>\t<slot>`
  - `## 판정` 블록 → `gate=<{"id","status","mine","same_host"} JSON 또는 SHOW_FAILED>`, `local_phase=<phase 또는 ->`, (tmux 면) `dead_status=<숫자 또는 빈 값>`
  - `## 한도 판정` 블록 → `LIMIT_NONE` 또는 `LIMIT_HIT source=<statusline|screen> restart_at=<epoch 초>`. 입력 파일 `~/.dflow/limits/<id8>.json` = `{"at": <epoch>, "rate_limits": {<창>: {"used_percentage": n, "resets_at": epoch}} | null}`
  - `## 재시작 후보를 띄울지` 의 거두기 블록 → `REAPED <pane>`
  - `## rate-limit 대기` 블록 둘 → `evidence=<cksum>`, `rl=<n>`
  - `## 중단 표식 정리` 블록 → `STALE_CANCEL_MARK_REMOVED <order>` | `CANCEL_MARK_RM_FAILED <order>` | 출력 없음

- [ ] **Step 1: fixture 작성**

`tests/skills/fixtures/limits/five-hour-full.json`:
```json
{"at": 1790000000, "rate_limits": {"five_hour": {"used_percentage": 100, "resets_at": 4102444800}, "seven_day": {"used_percentage": 40, "resets_at": 4102531200}}}
```
`tests/skills/fixtures/limits/both-full.json`:
```json
{"at": 1790000000, "rate_limits": {"five_hour": {"used_percentage": 100, "resets_at": 4102531200.7}, "seven_day": {"used_percentage": 100, "resets_at": 4102444800}}}
```
`tests/skills/fixtures/limits/below.json`:
```json
{"at": 1790000000, "rate_limits": {"five_hour": {"used_percentage": 99, "resets_at": 4102444800}, "seven_day": {"used_percentage": 100, "resets_at": 1000000000}}}
```
`tests/skills/fixtures/limits/no-field.json`:
```json
{"at": 1790000000, "rate_limits": null}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/skills/dflow-team-restart-blocks.test.ts`:

```ts
// 자동 재시작 절차(restart.md)의 셸 블록을 문서에서 꺼내 그대로 돌린다(스펙 2026-09-23-worker-auto-restart-design.md).
// HOME 은 늘 임시 디렉터리다 — 실제 ~/.dflow 를 건드리지 않는다. 서버 호출은 가짜 dflow.sh 로 바꾼다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const R = () => readFileSync(join(ROOT, '.claude/skills/dflow-team/references/restart.md'), 'utf8')
const SKILL = () => readFileSync(join(ROOT, '.claude/skills/dflow-team/SKILL.md'), 'utf8')
const FIX = join(ROOT, 'tests/skills/fixtures/limits')
const FAR = 4102444800 // 2100-01-01

function section(md: string, heading: string): string {
  const i = md.indexOf(`\n${heading}\n`)
  if (i < 0) throw new Error(`절 없음: ${heading}`)
  const rest = md.slice(i + heading.length + 2)
  const end = rest.search(/\n## /)
  return end < 0 ? rest : rest.slice(0, end)
}
function block(heading: string, n = 0): string {
  const all = [...section(R(), heading).matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1])
  if (!all[n]) throw new Error(`블록 없음: ${heading}#${n}`)
  return all[n]
}

let tmp: string, home: string
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'restart-')); home = join(tmp, 'home'); mkdirSync(home) })
afterEach(() => {
  const hb = join(home, '.dflow', 'hb')
  if (existsSync(hb)) chmodSync(hb, 0o755)
  rmSync(tmp, { recursive: true, force: true })
})
const sh = (code: string) => spawnSync('sh', ['-c', code], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: home } })
const lead = (code: string) => code.replaceAll("'<신원>/<host>/lead'", "'me/h/lead'").replaceAll("'<MAIN>'", "'/r'")
function events(rows: Record<string, unknown>[]) {
  mkdirSync(join(home, '.dflow'), { recursive: true })
  const base = { ts: '2026-09-23T00:00:00Z', host: 'h', phase: 'team', agent: 'me/h/lead', repo: '/r', tsk: 'TSK-01', order: '-' }
  writeFileSync(join(home, '.dflow', 'events.jsonl'), rows.map((r) => JSON.stringify({ ...base, ...r })).join('\n') + '\n')
}
const spawnEv = (id8: string, kind: string) => ({ event: 'team.spawn', id8, slot: '1', worktree: '/w', handle: '-', spawn_kind: kind })
const lostEv = (id8: string, cause: string, next: string, restart_at = '-') => ({ event: 'team.lost', id8, slot: '1', worktree: `/w/${id8}`, cause, next, restart_at, evidence: '-' })
const resultEv = (id8: string) => ({ event: 'team.result', id8, slot: '1', status: 'done', worktree: '/w', hash: '1', reason: '' })

describe('한도 판정', () => {
  function limit(id8: string, o: { file?: string; raw?: string; screen?: string; re?: string } = {}): string {
    const dir = join(home, '.dflow', 'limits'); mkdirSync(dir, { recursive: true })
    if (o.file) copyFileSync(join(FIX, o.file), join(dir, `${id8}.json`))
    if (o.raw !== undefined) writeFileSync(join(dir, `${id8}.json`), o.raw)
    const tm = join(tmp, 'faketm'); const scr = join(tmp, 'screen.txt')
    writeFileSync(scr, o.screen ?? ''); writeFileSync(tm, `#!/bin/sh\ncat '${scr}'\n`); chmodSync(tm, 0o755)
    let code = block('## 한도 판정')
      .replace("id8='<id8>'", `id8='${id8}'`)
      .replace("pane='<pane id 또는 ->'", "pane='%9'")
      .replace("TM='<진짜 tmux 절대경로 또는 빈 값>'", `TM='${tm}'`)
    if (o.re !== undefined) code = code.replace("LIMIT_SCREEN_RE=''", `LIMIT_SCREEN_RE='${o.re}'`)
    const r = sh(code)
    expect(r.status).toBe(0)
    return r.stdout.trim()
  }
  it('한 창이 100% 이고 해제가 미래면 그 시각 + 10분', () => {
    expect(limit('a1', { file: 'five-hour-full.json' })).toBe(`LIMIT_HIT source=statusline restart_at=${FAR + 600}`)
  })
  it('둘 다 100% 면 가장 늦은 해제 시각을 쓰고, 소수 시각은 내림한다', () => {
    expect(limit('a2', { file: 'both-full.json' })).toBe(`LIMIT_HIT source=statusline restart_at=${4102531200 + 600}`)
  })
  it('100% 미만이거나 해제 시각이 지났으면 한도가 아니다', () => {
    expect(limit('a3', { file: 'below.json' })).toBe('LIMIT_NONE')
  })
  it('필드가 없거나 파일이 없거나 깨졌으면 오류가 아니라 LIMIT_NONE', () => {
    expect(limit('a4', { file: 'no-field.json' })).toBe('LIMIT_NONE')
    expect(limit('a5')).toBe('LIMIT_NONE')
    expect(limit('a6', { raw: 'not json{' })).toBe('LIMIT_NONE')
    expect(limit('a7', { raw: '{"rate_limits": 3}' })).toBe('LIMIT_NONE')
  })
  it('화면 판정은 기본으로 꺼져 있다: 한도 문구가 화면에 있어도 LIMIT_NONE', () => {
    expect(block('## 한도 판정')).toContain("LIMIT_SCREEN_RE=''")
    expect(section(R(), '## 한도 판정')).toMatch(/실측[^\n]*전에는[^\n]*채우지 않는다/)
    expect(limit('a8', { screen: 'You have hit your limit · limit resets 3pm' })).toBe('LIMIT_NONE')
  })
  it('화면 판정을 켜면 문구로 한도를 보고 감지 + 60분을 쓴다', () => {
    const out = limit('a9', { screen: 'limit resets 3pm', re: 'limit resets' })
    const m = out.match(/^LIMIT_HIT source=screen restart_at=(\d+)$/)
    expect(m).not.toBeNull()
    const now = Math.floor(Date.now() / 1000)
    expect(Number(m![1])).toBeGreaterThanOrEqual(now + 3500)
    expect(Number(m![1])).toBeLessThanOrEqual(now + 3700)
  })
})

describe('판정 블록(재시작 전제 H2·G2)', () => {
  function gate(show: string | null, phase?: string): string {
    const fake = join(tmp, 'fakedflow')
    writeFileSync(fake, show === null ? '#!/bin/sh\nexit 3\n' : `#!/bin/sh\ncat <<'J'\n${show}\nJ\n`); chmodSync(fake, 0o755)
    const w = join(tmp, 'wt'); mkdirSync(join(w, 'docs/tasks/TSK-01'), { recursive: true })
    if (phase) writeFileSync(join(w, 'docs/tasks/TSK-01/state.json'), JSON.stringify({ phase }))
    const code = block('## 판정')
      .replace('.claude/skills/dflow-work/scripts/dflow.sh', fake)
      .replace("w='<워크트리>'", `w='${w}'`).replace("id8='<id8>'", "id8='a1b2c3d4'").replace("tsk='<TSK>'", "tsk='TSK-01'")
      .replace("TM='<진짜 tmux 절대경로 또는 빈 값>'", "TM=''").replace("pane='<pane id 또는 ->'", "pane='-'")
      .replace("'claude-<host>'", "'claude-h'")
    return sh(code).stdout
  }
  it('claimed·mine·같은 host 를 JSON 으로 낸다', () => {
    const out = gate(JSON.stringify({ order: { id: 'o1', status: 'claimed', mine: true, claimed_by: 'Claude-H' } }), 'build')
    expect(out).toContain('gate={"id":"o1","status":"claimed","mine":true,"same_host":true}')
    expect(out).toContain('local_phase=build')
  })
  it('show 실패·빈 출력·오류 JSON 은 SHOW_FAILED — 살아 있는 주문으로 읽지 않는다', () => {
    expect(gate(null)).toContain('gate=SHOW_FAILED')
    expect(gate('')).toContain('gate=SHOW_FAILED')
    expect(gate('{"ok":false,"error":"x"}')).toContain('gate=SHOW_FAILED')
  })
  it('state.json 이 cancelled 면 local_phase=cancelled, 없으면 -', () => {
    const show = JSON.stringify({ order: { id: 'o1', status: 'claimed', mine: true, claimed_by: 'claude-h' } })
    expect(gate(show, 'cancelled')).toContain('local_phase=cancelled')
    expect(gate(show)).toContain('local_phase=-')
  })
})

describe('이벤트로 본 상태', () => {
  it('마지막 이벤트가 team.lost 인 id8 만 네 상태로 가르고, team.start 로 자르지 않으며 다른 repo 는 뺀다', () => {
    events([
      lostEv('a1', 'no-response', 'restart'),
      { event: 'team.start', backend: 'tmux', slots: 3, until: 'none', wp: '-' },
      lostEv('a2', 'rate-limit', 'wait', String(FAR)),
      lostEv('a3', 'rate-limit', 'wait', '1000000000'),
      lostEv('a4', 'pane-dead', 'park'),
      lostEv('a5', 'no-response', 'wait'),
      lostEv('a6', 'pane-dead', 'restart'), spawnEv('a6', 'resume'),
      { ...lostEv('a7', 'pane-dead', 'restart'), repo: '/other' },
    ])
    const out = sh(lead(block('## 이벤트로 본 상태'))).stdout.trim().split('\n').map((l) => l.split('\t').slice(0, 2).join(' ')).sort()
    expect(out).toEqual(['PARKED a4', 'RESTART_DUE a1', 'RESTART_DUE a5', 'RL_DUE a3', 'RL_WAIT a2'])
  })
})

describe('카운터', () => {
  function tries(rows: Record<string, unknown>[]): string {
    const m = SKILL().match(/(jq -r --arg a '<신원>\/<host>\/lead' --arg r '<MAIN>' --arg i "\$id8" \\\n[\s\S]*?print "tries=" n\+0\}')/)
    if (!m) throw new Error('재시도 블록을 찾지 못했다')
    events(rows)
    return sh(lead(`id8='a1'\n${m[1]}`)).stdout.trim()
  }
  it('재시도 수(SKILL.md 블록): team.lost 는 세지도 끊지도 않고, readopt 는 세지 않으며, team.start 로 끊기지 않는다', () => {
    expect(tries([spawnEv('a1', 'resume'), lostEv('a1', 'pane-dead', 'restart'), spawnEv('a1', 'resume')])).toBe('tries=2')
    expect(tries([spawnEv('a1', 'resume'), resultEv('a1')])).toBe('tries=0')
    expect(tries([spawnEv('a1', 'resume'), spawnEv('a1', 'readopt')])).toBe('tries=1')
    expect(tries([spawnEv('a1', 'resume'), { event: 'team.start', backend: 'tmux', slots: 3, until: 'none', wp: '-' }, spawnEv('a1', 'resume')])).toBe('tries=2')
  })
  it('rate-limit 횟수: 마지막 team.result 이후 cause=rate-limit 인 team.lost 만 센다', () => {
    const code = lead(block('## rate-limit 대기', 1)).replace("id8='<id8>'", "id8='a1'")
    events([lostEv('a1', 'rate-limit', 'wait', '1'), spawnEv('a1', 'resume'), lostEv('a1', 'rate-limit', 'wait', '2')])
    expect(sh(code).stdout.trim()).toBe('rl=2')
    events([lostEv('a1', 'rate-limit', 'wait', '1'), resultEv('a1'), lostEv('a1', 'rate-limit', 'wait', '2'), lostEv('a1', 'no-response', 'restart')])
    expect(sh(code).stdout.trim()).toBe('rl=1')
  })
})

describe('중단 표식 정리(G1)', () => {
  const ORDER = '11111111-2222-3333-4444-555555555555'
  function clean(st: string): string {
    return sh(block('## 중단 표식 정리').replace("order='<주문 전체 UUID>'", `order='${ORDER}'`).replace("st='<show 의 .order.status>'", `st='${st}'`)).stdout.trim()
  }
  const mark = () => { const d = join(home, '.dflow', 'hb'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, `${ORDER}.cancelled`), ''); return join(d, `${ORDER}.cancelled`) }
  it('ready·claimed 면 지우고 STALE_CANCEL_MARK_REMOVED', () => {
    for (const st of ['ready', 'claimed']) {
      const m = mark()
      expect(clean(st)).toBe(`STALE_CANCEL_MARK_REMOVED ${ORDER}`)
      expect(existsSync(m)).toBe(false)
    }
  })
  it('cancelled·reported 면 지우지 않고 아무것도 출력하지 않는다', () => {
    for (const st of ['cancelled', 'reported']) {
      const m = mark()
      expect(clean(st)).toBe('')
      expect(existsSync(m)).toBe(true)
    }
  })
  it('표식이 없으면 출력이 없다', () => { expect(clean('claimed')).toBe('') })
  it.skipIf(process.getuid?.() === 0)('지우지 못하면 CANCEL_MARK_RM_FAILED', () => {
    const m = mark(); chmodSync(join(home, '.dflow', 'hb'), 0o555)
    expect(clean('claimed')).toBe(`CANCEL_MARK_RM_FAILED ${ORDER}`)
    expect(existsSync(m)).toBe(true)
  })
})

describe('restart.md 계약', () => {
  it('절 이름이 고정돼 있다', () => {
    for (const h of ['## 요약', '## 이벤트로 본 상태', '## 판정', '## 한도 판정', '## 재시작 후보를 띄울지', '## 재투입', '## rate-limit 대기', '## 중단 표식 정리', '## Orca', '## 마감·lease·잠금', '## 알림 한 줄']) {
      expect(R(), h).toContain(`\n${h}\n`)
    }
  })
  it('rate-limit 대기 슬롯은 판정을 건너뛴다', () => {
    expect(section(R(), '## 판정')).toMatch(/`RL_WAIT`·`RL_DUE`[^\n]*이 절을 건너뛰고/)
  })
  it('원인 분류 순서: show 실패 → cancelled → 점유 변동 → 표식 불일치 → 한도 → pane 죽음(127 먼저) → 무응답', () => {
    const s = section(R(), '## 판정')
    const at = (t: string) => { const i = s.indexOf(t); expect(i, t).toBeGreaterThan(-1); return i }
    const order = ['| 1 | `gate=SHOW_FAILED`', '| 2 |', '| 3 |', '| 4 | `local_phase=cancelled`', '| 5 | 「한도 판정」', '| 6 |', '| 7 |', '| 8 |', '| 9 |']
    for (let k = 1; k < order.length; k++) expect(at(order[k])).toBeGreaterThan(at(order[k - 1]))
    expect(s).toMatch(/\| 6 \|[^\n]*127/)
  })
  it('재시작 후보: 상한이면 park 이고 team.result 를 쓰지 않으며, 거두기를 기록보다 먼저 한다', () => {
    const s = section(R(), '## 재시작 후보를 띄울지')
    expect(s).toMatch(/≥ 3[^\n]*`park`/)
    expect(s).toMatch(/`team\.result` 를 쓰지 않는다/)
    expect(s.indexOf('REAPED')).toBeGreaterThan(-1)
    expect(s).toMatch(/거두기[^\n]*먼저/)
    expect(s).toMatch(/워크트리를 지우지 않는다/)
  })
  it('재투입은 5-1 을 타고 claim 하지 않으며 6항 직전에 표식을 정리한다', () => {
    const s = section(R(), '## 재투입')
    expect(s).toContain('「5-1. 재개 spawn」')
    expect(s).toMatch(/claim[^\n]*하지 않는다/)
    expect(s).toMatch(/6항[^\n]*직전[^\n]*「중단 표식 정리」/)
    expect(s).toContain('`spawn_kind=resume`')
  })
  it('Orca 는 관문 전이라 재투입하지 않고 team.lost 를 기록하지 않으며, orca terminal 명령은 실행 블록에 없다', () => {
    const s = section(R(), '## Orca')
    expect(s).toMatch(/team\.lost` 는 기록하지 않는다/)
    expect(s).toContain('/dflow-team <종료시각> --resume <id8>')
    const bash = [...R().matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n')
    expect(bash).not.toMatch(/orca terminal (create|close)/)
  })
  it('LEASE_LOST·LOCK_LOST·STALE·마감 중에는 판정하지 않는다', () => {
    const s = section(R(), '## 마감·lease·잠금')
    for (const t of ['`LEASE_LOST`', '`LOCK_LOST`', '`STALE`', '「7. 마감」']) expect(s, t).toContain(t)
    expect(s).toMatch(/재시작하지 않는다/)
  })
})
```

- [ ] **Step 3: shell-blocks 테스트에 문서 추가**

`tests/skills/dflow-team-shell-blocks.test.ts` 의 `DOCS` 배열에서 `'.claude/skills/dflow-team/references/events.md',` 줄 **바로 아래**에 넣는다:

```ts
  '.claude/skills/dflow-team/references/restart.md',
```

- [ ] **Step 4: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team-restart-blocks.test.ts tests/skills/dflow-team-shell-blocks.test.ts`
Expected: FAIL (ENOENT — restart.md 없음)

- [ ] **Step 5: restart.md 작성**

`.claude/skills/dflow-team/references/restart.md` 를 아래 내용 그대로 만든다:

````markdown
# /dflow-team 자동 재시작: 멈춘 팀원을 원인별로 다시 띄운다

스펙 `docs/superpowers/specs/2026-09-23-worker-auto-restart-design.md`(과제 H·G). SKILL.md 「2-3」「3. 결과 처리」
「5. 팀원 spawn」「5-1. 재개 spawn」「7. 마감」 이 이 문서를 부른다. 블록은 events.md 의 기록 명령처럼 **그대로**
쓰고 기억으로 재구성하지 않는다. 이벤트는 events.md 「기록 명령」 의 블록과 `team.lost` 조각으로만 기록한다.

## 요약

- 자동 재시작 대상은 셋이다. **무응답**(생존 증거가 두 TICK 연속 무변화), **pane 죽음**(tmux, 결과 줄 없음,
  `pane_dead_status` 가 127 이 아님), **rate-limit**(한도 해제 뒤 1회).
- 권한 거부·`blocked`·`cancelled`·그 밖 `failed…`(결과 줄이 있는 것 전부)·127·서버가 `claimed`+`mine`+이 PC 가
  아님·워크트리 `state.json` 이 `cancelled` 는 재시작하지 않고 사람에게 알린다.
- 재시도는 고아 재개와 같은 카운터를 쓴다(상한 3, SKILL.md 「팀장 상태」 고아 스캔 2번). 손실은 `team.result`
  가 아니라 `team.lost` 로 적는다. `team.result` 는 카운터를 0 으로 되돌린다.
- 재투입은 「5-1. 재개 spawn」 그대로다. 같은 워크트리, 같은 슬롯 번호, claim 하지 않음.
- Orca 는 실측 관문 전이라 재투입하지 않는다(「Orca」).
- 화면(tmux `capture-pane`, Orca `orca terminal read`)은 생존 판정에 쓰지 않는다. 결과 줄 폴백과, 켜 두었을 때의
  한도 문구 판정에만 쓴다.

## 이벤트로 본 상태

id8 마다 마지막 `team.spawn`·`team.blocked`·`team.result`·`team.lost` 를 본다. `team.start` 로 자르지 않는다.
이유: 팀장을 다시 띄워도 재시작 대기와 rate-limit 대기가 이어져야 한다. 매 기상의 재구성에서 한 번 돈다.
```bash
jq -r --arg a '<신원>/<host>/lead' --arg r '<MAIN>' \
  'select(.agent == $a and .repo == $r and (.id8 // "-") != "-")
   | select(.event == "team.spawn" or .event == "team.blocked" or .event == "team.result" or .event == "team.lost")
   | [.id8, .event, (.cause // "-"), (.next // "-"), (.restart_at // "-"), (.worktree // "-"), (.evidence // "-"), (.slot // "-")]
   | @tsv' ~/.dflow/events.jsonl 2>/dev/null \
  | awk -F '\t' '{ last[$1] = $0 } END { for (k in last) print last[k] }' \
  | awk -F '\t' -v now="$(date +%s)" '$2 == "team.lost" {
      if ($4 == "park") s = "PARKED"
      else if ($3 == "rate-limit" && $4 == "wait") s = (($5 != "-") && ($5 + 0 > now + 0)) ? "RL_WAIT" : "RL_DUE"
      else s = "RESTART_DUE"
      print s "\t" $1 "\t" $3 "\t" $5 "\t" $6 "\t" $7 "\t" $8 }'
```
출력 줄은 `<상태>\t<id8>\t<cause>\t<restart_at>\t<worktree>\t<evidence>\t<slot>` 이며 마지막 이벤트가 `team.lost` 인
id8 만 나온다.

| 상태 | 뜻 | 처리 |
|---|---|---|
| `RESTART_DUE` | `next` 가 `restart`(기록 뒤 spawn 전에 끊김) 또는 `wait`(차단기·보류로 미룸) | **재시작 대기 목록**. SKILL.md 「2-3」 4번의 재개 대상이며 새 작업보다 먼저다. 「재투입」 으로 띄운다 |
| `RL_WAIT` | rate-limit 대기, `restart_at` 전 | 「rate-limit 대기」. 무응답 판정에서 뺀다 |
| `RL_DUE` | rate-limit 대기, `restart_at` 이 지났다 | 「rate-limit 대기」 의 재측정 |
| `PARKED` | `next=park` | 「멈춤」 표에 둔다. 자동으로 다시 띄우지 않는다 |

- 네 상태의 id8 은 모두 **영구 제외(진행 중)** 다. poll `--exclude` 에 넣는다.
- `RL_WAIT`·`RL_DUE` 가 하나라도 있으면 **rate-limit 보류**다. 새 작업·재개·재시작 spawn 을 모두 하지 않고 poll 도
  다시 띄우지 않는다. 이유: 한도는 계정 단위라 팀장·팀원이 같은 로그인이면 누구를 띄워도 같은 벽에 선다. 예외는
  `RL_DUE` 슬롯 자신의 재투입 하나다(보류를 푸는 길이다).
- 고아 스캔 "재개 가능" 의 다섯째 조건: 그 id8 이 `PARKED`·`RL_WAIT`·`RL_DUE` 면 재개하지 않는다. `RL_DUE` 는
  「rate-limit 대기」 가 재측정한 뒤 띄운다. `RESTART_DUE` 는 재개 가능이며, 고아 스캔의 "재개 가능" 과 id8 으로
  합쳐 한 번만 띄운다.

## 판정

**언제**: `TICK` 기상(결과 줄 없는 진행 슬롯 전부. `blocked` 는 뺀다)과 `PANE_DEAD` 기상(그 슬롯. `.result` 도 죽은
pane 화면 폴백의 결과 줄도 없을 때만). 그 밖의 기상과 「마감·lease·잠금」 의 경우에는 판정하지 않는다.

**먼저**: 그 id8 이 「이벤트로 본 상태」 에서 `RL_WAIT`·`RL_DUE` 면 이 절을 건너뛰고 「rate-limit 대기」 만 따른다.
그 사이 pane 이 죽어도 여기서 재시작하지 않는다. 같은 한도를 두 번 세지 않기 위해서다.

**정체 슬롯만 가른다**: (가) pane 이 죽었다, 또는 (나) 생존 증거(SKILL.md 「3. 결과 처리」 의 셋)가 직전 TICK 과
같다. 정체가 아닌 슬롯은 판정하지 않는다. 이유: 움직이는 워커를 한도로 분류하거나, 결과 보고 직전의 정상
전이(`reported`)를 점유 변동으로 멈추지 않게 한다. 중단(`cancelled`) 처리는 종전대로 정체와 무관하게 한다.

정체 슬롯마다 아래 블록을 한 번 돈다(한 번의 Bash 호출).
```bash
w='<워크트리>'; id8='<id8>'; tsk='<TSK>'; TM='<진짜 tmux 절대경로 또는 빈 값>'; pane='<pane id 또는 ->'
g=$( (.claude/skills/dflow-work/scripts/dflow.sh show "$id8") 2>/dev/null \
  | jq -c --arg h 'claude-<host>' 'select((.order.id // "") != "") | .order
      | {id, status, mine, same_host: (((.claimed_by // "") | ascii_downcase) == $h)}' 2>/dev/null )
[ -n "$g" ] || g=SHOW_FAILED
printf 'gate=%s\n' "$g"
p=$(jq -r '.phase // "-"' "$w/docs/tasks/$tsk/state.json" 2>/dev/null) || p=-
printf 'local_phase=%s\n' "${p:--}"
if [ "$pane" != - ] && [ -n "$TM" ]; then
  printf 'dead_status=%s\n' "$("$TM" -L dflow display-message -p -t "$pane" '#{pane_dead_status}' 2>/dev/null)"
fi
```
위에서부터 보고 처음 맞는 줄에서 멈춘다. "(나) 1회째" 는 이번 TICK 이 그 슬롯의 첫 무변화 TICK 이라는 뜻이다.

| 순서 | 조건 | 분류 | (나) 1회째 | (가), 또는 (나) 2회째 |
|---|---|---|---|---|
| 1 | `gate=SHOW_FAILED` | 측정 실패 | 아무것도 하지 않는다 | (나)는 아무것도 하지 않는다. (가)는 「재시작 후보를 띄울지」 의 거두기 블록만 돌고 감시 루프의 `set --` 에서 뺀다(죽은 pane 이 20초마다 다시 깨우지 않게). 다음 기상의 고아 스캔이 다시 본다. 같은 슬롯이 두 TICK 연속 측정 실패면 「멈춤」 표에 사유 `서버 조회 실패` 로 보고한다(슬롯 유지) |
| 2 | `status` 가 `cancelled` | 중단 | SKILL.md 「3. 결과 처리」 의 중단 처리 | 같다. 재시작 없음 |
| 3 | `status` 가 `claimed` 가 아님, 또는 `mine` 이 거짓, 또는 `same_host` 가 거짓 | 점유 변동 | 보고만 한다 | 거두기 → 슬롯 해제 → 「멈춤」(사유 `서버 <status>` 또는 `다른 PC claim`). **이벤트는 쓰지 않는다** |
| 4 | `local_phase=cancelled` | 표식 불일치 | 보고만 한다 | 거두기 → `team.lost`(`next=park`) → 「멈춤」(사유 `중단 표식 불일치`). 사람이 phase 를 되돌릴지 판단한다 |
| 5 | 「한도 판정」 이 `LIMIT_HIT` | rate-limit | 「rate-limit 대기」 의 감지(두 TICK 을 기다리지 않는다) | 같다 |
| 6 | (가)이고 `dead_status=127` | 환경 결함 | — | 현행 `failed no-result`(SKILL.md 「3. 결과 처리」). 재시작 없음. `claude` 를 찾지 못한 것이라 다시 띄워도 같은 자리에서 죽는다 |
| 7 | (가) 그 밖 | pane 죽음 | — | 재시작 후보(`cause=pane-dead`) |
| 8 | (나) 2회째 | 무응답 | — | 재시작 후보(`cause=no-response`) |
| 9 | (나) 1회째 | 무응답 1회 | 현행 "무응답" 보고만 한다 | — |

4번의 `team.lost` 는 (가)면 `cause=pane-dead`, (나)면 `cause=no-response`, `restart_at` 은 `-` 다. `park` 로 적는
이유: 서버는 여전히 `claimed`·`mine` 이라 적지 않으면 다음 팀장 시작의 고아 스캔이 재시도 3 미만으로 보고 같은 작업을
다시 띄운다. 3번은 적지 않는다. 고아 스캔은 `claimed`+`mine`+이 PC 가 아니면 어차피 재개하지 않으며, 「이벤트로 본
상태」 는 `team.start` 로 자르지 않으므로 `park` 를 적으면 claim 전에 죽은 `ready` 작업이 이 팀장에게 영영 보이지 않게 된다.

## 한도 판정

출처는 tmux 팀원의 statusLine 덤프 `~/.dflow/limits/<id8>.json` 이다(backends.md 「pane(tmux)」 의 `.dflow-run`
설정이 쓴다. 워크트리 밖이라 `git status` 를 더럽히지 않는다). 어느 창이든 `used_percentage >= 100` 이고 해제
시각이 미래면 한도이며, 해제 시각은 그런 창의 `resets_at` 중 가장 늦은 것이다. `restart_at` = 해제 시각 + 600초.
유예 10분을 두는 이유: Claude Code 가 한도 해제 뒤 스스로 이어 가면 그 사이에 워커가 돈다.
화면 문구 판정(`LIMIT_SCREEN_RE`)은 **꺼져 있다.** 실제 한도 화면 문장과 시각 형식을 캡처로 확인하는 실측(스펙
§14-1) 전에는 채우지 않는다. 켜면 문구가 보일 때 `restart_at` = 감지 + 3600초(시각을 읽지 않는 폴백)다.
Orca 팀원은 `.dflow-run` 을 쓰지 않아 덤프가 없으므로 늘 `LIMIT_NONE` 이다.
```bash
id8='<id8>'; pane='<pane id 또는 ->'; TM='<진짜 tmux 절대경로 또는 빈 값>'
LIMIT_SCREEN_RE=''   # 끔. 실측(스펙 §14-1) 전에는 채우지 않는다
f="$HOME/.dflow/limits/$id8.json"; now=$(date +%s)
lim=$(jq -r --argjson now "$now" '[(.rate_limits // {}) | to_entries[] | .value
    | select(((.used_percentage // 0) >= 100) and ((.resets_at // 0) > $now)) | .resets_at]
    | if length == 0 then "none" else (max | floor | tostring) end' "$f" 2>/dev/null) || lim=none
[ -n "$lim" ] || lim=none
if [ "$lim" = none ] && [ -n "$LIMIT_SCREEN_RE" ] && [ "$pane" != - ] && [ -n "$TM" ]; then
  if "$TM" -L dflow capture-pane -p -J -S -40 -t "$pane" 2>/dev/null | grep -Eq "$LIMIT_SCREEN_RE"; then lim=screen; fi
fi
case "$lim" in
  none) echo LIMIT_NONE ;;
  screen) echo "LIMIT_HIT source=screen restart_at=$((now + 3600))" ;;
  *) echo "LIMIT_HIT source=statusline restart_at=$((lim + 600))" ;;
esac
```
파일이 없거나 깨졌으면 `LIMIT_NONE` 이다. 한도를 모르는 것은 한도가 아닌 것으로 본다. 그 워커는 무응답 규칙으로
가고, 거듭 죽으면 재시도 상한에서 멈춘다.

## 재시작 후보를 띄울지

재시도 수는 SKILL.md 「팀장 상태」 고아 스캔 2번 블록의 `tries=` 로 잰다(공식을 바꾸지 않는다).

| 조건 | `team.lost` 의 `next` | 처리 |
|---|---|---|
| `tries` ≥ 3 | `park` | 「멈춤」(사유 `재시도 상한`). `team.result` 를 쓰지 않는다. 쓰면 다음 팀장 시작의 고아 스캔이 재시도 0 으로 읽고 또 재개한다 |
| 차단기가 걸렸거나 rate-limit 보류 중이고, 이번이 그 TICK 의 시험 1건이 아니다 | `wait`(`restart_at` 은 `-`) | 슬롯만 해제한다. 다음 기상에 `RESTART_DUE` 로 다시 본다 |
| 그 밖 | `restart` | 같은 기상 안에서 「재투입」 |

차례(세 갈래 공통):
1. **거두기**를 먼저 한다. tmux 는 아래 블록이다. `REAPED <pane>` 이 나와야 다음으로 간다.
   ```bash
   TM='<진짜 tmux 절대경로>'; w='<워크트리>'; pane='<pane id>'
   "$TM" -L dflow kill-pane -t "$pane" 2>/dev/null || :
   "$TM" -L dflow select-layout -t dflow tiled 2>/dev/null || :
   printf '%s\n' '<신원>/<host>/parked' > "$w/.dflow-agent" && echo "REAPED $pane"
   ```
2. 그 다음 `team.lost` 를 기록한다(events.md 조각. `slot` 은 그 슬롯 번호, `worktree` 는 워크트리 절대경로).
   거두기를 기록보다 먼저 하는 이유: 기록 뒤 거두기 전에 컨텍스트가 끊기면 다음 기상이 `RESTART_DUE` 로 보고
   살아 있는 pane 옆에 같은 작업을 겹쳐 띄운다. 거두기 뒤 기록 전에 끊기면 고아 스캔이 평범한 재개로 잇는다.
3. `restart` 면 「재투입」, `wait` 면 슬롯 해제, `park` 면 「멈춤」 표와 「알림 한 줄」 의 상한 줄.

**워크트리를 지우지 않는다.** 깨끗하고 push 된 워크트리도 그대로 둔다. 지우면 5-1 이 원격 브랜치에서 다시 만들어야
하고 그 사이 미추적 `.issues` 를 잃는다. 이 절은 SKILL.md 「3. 결과 처리」 의 무응답 자동 정리(tmux 갈래)와
`failed no-result` 행의 "고아 정리 규칙을 따른다" 를 재시작 후보에 한해 대신한다.

## 재투입

SKILL.md 「5-1. 재개 spawn」 을 그대로 따르고 아래만 다르다.
1. 1항의 손실 보고 한 줄은 「알림 한 줄」 의 재시작 줄로 바꾼다. 워크트리가 있으므로 "잃는 것" 은 늘 `없음` 이다.
2. 3항: 있는 워크트리를 그대로 쓴다.
3. 4항: 슬롯은 `.dflow-prompt` 의 `AGENT_ID` 번호다. 방금 거둬 비었으므로 대개 같은 번호이고, 이미 찼으면 발급
   규칙으로 새로 낸다.
4. 6항(띄우기) **직전**에 「중단 표식 정리」 블록을 돈다. `st` 는 「판정」 블록의 `gate` 의 `status`(= `claimed`)다.
   `CANCEL_MARK_RM_FAILED` 면 띄우지 않고 「멈춤」(사유 `중단 표식 삭제 실패`)으로 보고한다.
5. claim 은 하지 않는다. 주문은 `claimed`·`mine` 이며(「판정」 이 확인했다), 이어받은 `/dflow-dev --worker` 가 재claim
   을 건너뛴다.
6. 8항의 `team.spawn` 은 `spawn_kind=resume` 이다. 재시도 수가 이 값으로 늘어난다. `team.lost` 는 이미 앞에서 기록했다.

## rate-limit 대기

생존 증거 요약(`evidence`)은 SKILL.md 「3. 결과 처리」 의 세 증거를 이은 cksum 이다.
```bash
w='<워크트리>'; id8='<id8>'
e1=$(git -C "$w" log -1 --format=%ct 2>/dev/null)
e2=$( (.claude/skills/dflow-work/scripts/dflow.sh show "$id8") 2>/dev/null \
  | jq -r '[([.reports[]?] | last | .created_at // "-"), (.order.last_heartbeat_at // "-"), (.order.heartbeat_phase // "-")] | join(",")' 2>/dev/null )
e3=$(git -C "$w" status --porcelain 2>/dev/null | cksum | cut -d' ' -f1)
printf 'evidence=%s\n' "$(printf '%s|%s|%s\n' "$e1" "${e2:-SHOW_FAILED}" "$e3" | cksum | cut -d' ' -f1)"
```
rate-limit 횟수는 마지막 `team.result` 이후 `cause=rate-limit` 인 `team.lost` 수다. `team.start` 로 자르지 않는다.
```bash
id8='<id8>'
jq -r --arg a '<신원>/<host>/lead' --arg r '<MAIN>' --arg i "$id8" \
  'select(.agent == $a and .repo == $r and (.id8 // "") == $i)
   | select(.event == "team.result" or (.event == "team.lost" and .cause == "rate-limit"))
   | .event' ~/.dflow/events.jsonl 2>/dev/null \
  | awk '/team\.result/{n=0; next} {n++} END{print "rl=" n+0}'
```

| 때 | 처리 |
|---|---|
| 감지(「판정」 5번) | 위 블록으로 `evidence` 를 잰다. `team.lost`(`cause=rate-limit`, `next=wait`, `restart_at`=「한도 판정」 값, `evidence`)를 기록한다. **pane 이 살아 있으면 죽이지 않고 슬롯을 그대로 쥔다**(자동 이어 가기를 없애지 않는다). pane 이 죽어 있으면 거두기 블록을 돌고 감시 루프의 `set --` 에서 뺀다. 보류가 시작된다. 「알림 한 줄」 의 rate-limit 줄 |
| `RL_WAIT` 인 기상 | 그 슬롯은 무응답 판정에서 뺀다. `PANE_DEAD` 로 와도 거두기만 하고 `restart_at` 까지 기다린다 |
| `RL_DUE` 이고 pane 이 살아 있음 | `evidence` 를 다시 잰다. **이벤트의 `evidence` 와 다르면** 워커가 스스로 이어 간 것이다. `team.spawn`(`spawn_kind=readopt`, 같은 `slot`·`worktree`·`handle`)으로 진행 중에 되돌린다. `readopt` 는 재시도로 세지 않는다. **같으면** 아래 "재투입 판정" |
| `RL_DUE` 이고 pane 이 죽었거나 `.dflow-agent` 가 `parked` | 증거를 재지 않고 곧바로 "재투입 판정". 자동 이어 가기가 없다 |
| 재투입 판정 | `rl` ≥ 2 면 거두기 → `team.lost`(`cause=rate-limit`, `next=park`) → 「멈춤」(사유 `rate-limit 반복`). `tries` ≥ 3 이면 같은 차례로 사유 `재시도 상한`. 그 밖이면 거두기 → 「재투입」(차단기가 걸렸으면 그 TICK 의 시험 1건으로만). 이때 `team.lost` 를 새로 쓰지 않는다(감지 때 이미 썼다. 다시 쓰면 `rl` 이 부풀어 한 번 만에 멈춘다) |
| 보류 해제 | `RL_WAIT`·`RL_DUE` 가 모두 없어지면 보류가 풀린다. SKILL.md 「2-1」 재기동 조건을 다시 본다 |

## 중단 표식 정리

heartbeat 훅은 `~/.dflow/hb/<주문>.cancelled` 가 있으면 첫 도구 호출에서 세션을 세운다. 훅은 표식을 지우지 않으므로
팀장이 **모든 spawn(새 작업·재개·재시작) 직전**에 지운다. 조건은 그 기상에서 이미 받은 `show` 의 `.order.status` 가
`ready`(새 작업) 또는 `claimed`(재개·재시작)인 것이다. 서버가 살아 있다고 말하는 주문의 표식은 낡은 것이다(스테이징·
운영 UUID 가 겹친 경우가 대표적이다). `show` 를 받지 못했으면 spawn 자체를 하지 않는다.
```bash
order='<주문 전체 UUID>'; st='<show 의 .order.status>'
case "$st" in
  ready|claimed)
    m="$HOME/.dflow/hb/$order.cancelled"
    if [ -e "$m" ]; then
      rm -f "$m" 2>/dev/null
      if [ -e "$m" ]; then echo "CANCEL_MARK_RM_FAILED $order"; else echo "STALE_CANCEL_MARK_REMOVED $order"; fi
    fi ;;
esac
```
- `STALE_CANCEL_MARK_REMOVED` 가 나오면 보고에 한 줄 적는다.
- `CANCEL_MARK_RM_FAILED` 면 **띄우지 않는다.** 띄우면 첫 도구 호출에서 선다.
- 워크트리 `state.json` 이 `cancelled` 인 경우는 여기서 고치지 않는다(「판정」 4번이 「멈춤」 으로 보낸다).
- 수동 `/dflow-dev` 세션의 표식은 사람이 지운다.

## Orca

Orca 는 **재투입하지 않는다**(실측 관문 전). 관문은 셋이다: `orca terminal close --terminal <핸들>` 이 팀원 claude 를
실제로 끝내는가, `orca terminal create --worktree path:<워크트리> --command './.dflow-run' --json` 으로 띄운 세션이
권한 확인 생략 모드로 돌고 포인터가 첫 입력으로 들어가며 폴더 신뢰 확인을 넘기는가, 새 탭의 핸들을 JSON 으로
받는가. 셋을 확인하기 전에는 이 명령들을 실행 절차에 쓰지 않는다.
관문 전 Orca 는 「판정」 의 1~4번과 9번까지만 하고, (나) 2회째 무응답이면 SKILL.md 「3. 결과 처리」 의 Orca 무응답
처리를 그대로 한 뒤 한 줄을 더한다: `<TSK> <id8> 재시작하려면 그 탭을 닫고 /dflow-team <종료시각> --resume <id8>`.
**`team.lost` 는 기록하지 않는다.** 관문 전 동작은 현행과 같아야 하기 때문이다.

## 마감·lease·잠금

| 상황 | 동작 |
|---|---|
| `LEASE_LOST` 기상 | 판정하지 않는다. 떠 있는 워커는 건드리지 않는다. 대기 중인 재시작은 버린다(같은 체크아웃의 다음 팀장이 고아 스캔으로 잇는다) |
| `LOCK_LOST` | 판정하지 않는다. 재시작하지 않는다 |
| `STALE` 기상 | 판정하지 않는다 |
| 한 기상 안에서 거두기 뒤 lease 상실 | 재투입은 거두기와 같은 기상 안에서 끝낸다. 방금 띄운 워커는 "하던 작업을 끝낸다" 규칙에 들어간다 |
| 「7. 마감」 | 재시작하지 않는다. `RESTART_DUE`·`RL_WAIT`·`RL_DUE` 는 「멈춤」 표에 사유(`무응답`·`pane 죽음`·`rate-limit 대기(<HH:MM>)`)와 재시작 명령 `/dflow-team <종료시각> --resume <id8>` 을 적는다 |
| 다른 clone·다른 PC 의 새 팀장 | 이벤트는 `agent`+`repo` 단위라 넘어가지 않는다. 새 팀장은 「멈춤」(사유 `워크트리 없음`)으로 올리고, 복구는 사람의 `--resume` 이다 |

## 알림 한 줄

| 분류 | 한 줄 |
|---|---|
| 재시작 | `<TSK> <id8> 재시작(<무응답|pane 죽음|rate-limit>, <tries+1>/3) — 워크트리 <경로> 이어받음` |
| rate-limit 대기 | `<TSK> <id8> 사용량 한도 — <HH:MM> 이후 다시 봅니다. 그때까지 새 배정 보류` |
| 상한·반복 | `<TSK> <id8> 멈춤(<재시도 상한|rate-limit 반복>) — 재시작 명령: /dflow-team <종료시각> --resume <id8>` |
| 표식 정리 | `<TSK> <id8> 낡은 중단 표식을 지웠다(STALE_CANCEL_MARK_REMOVED)` |
| 그 밖 멈춤 | SKILL.md 「팀장 상태」 의 「멈춤」 표에 사유를 적는다 |
````

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/skills/dflow-team-restart-blocks.test.ts tests/skills/dflow-team-shell-blocks.test.ts`
Expected: PASS. `카운터` 의 재시도 블록 테스트는 SKILL.md 의 기존 블록을 쓰므로 이 Task 에서 이미 통과한다.

- [ ] **Step 7: 커밋**

```bash
cd /Users/jji/project/wbs-web-restart
git add .claude/skills/dflow-team/references/restart.md \
  tests/skills/fixtures/limits/five-hour-full.json tests/skills/fixtures/limits/both-full.json \
  tests/skills/fixtures/limits/below.json tests/skills/fixtures/limits/no-field.json \
  tests/skills/dflow-team-restart-blocks.test.ts tests/skills/dflow-team-shell-blocks.test.ts
git commit -F - <<'EOF'
feat(dflow-team): 자동 재시작 절차를 restart.md 한 곳에 둔다

멈춘 팀원을 원인별로 가르는 판정·한도 판정·재투입·rate-limit 대기·낡은 중단 표식 정리를
새 참조 파일에 모은다. SKILL.md 는 병렬 세션이 고치고 있어 여기서는 부르기만 한다.
화면 문구 판정과 Orca 재투입은 실측 전이라 꺼 둔다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
EOF
```

---

### Task 3: 팀장 흐름 연결 — `SKILL.md`

**Files:**
- Modify: `.claude/skills/dflow-team/SKILL.md` (참조 문단, 압축 뒤 첫 기상, 「팀장 상태」 차단기·제외·고아 스캔·멈춤 사유, 「2-1」 재기동 조건, 「2-3」 4번·기상 표 두 행·show 필터, 「3. 결과 처리」 PANE_DEAD 항목·status 표 두 행·차단기·무응답, 「5」 5항·재spawn 문단, 「5-1」 대상·6항, 「7. 마감」 3번, 「금지」)
- Modify: `tests/skills/dflow-team-depends-precheck.test.ts`
- Test: `tests/skills/dflow-team-restart-flow.test.ts` (신규)

**Interfaces:**
- Consumes: Task 2 의 절 이름(`「판정」`·`「한도 판정」`·`「재시작 후보를 띄울지」`·`「재투입」`·`「rate-limit 대기」`·`「중단 표식 정리」`·`「이벤트로 본 상태」`·`「Orca」`·`「마감·lease·잠금」`), 상태 이름 `RESTART_DUE`·`RL_WAIT`·`RL_DUE`·`PARKED`, 출력 `CANCEL_MARK_RM_FAILED`.
- Produces: show 필터 출력에 `status` 키(`{order, status, ref, spec_empty, deps_unmet}`).

모든 수정은 인용한 문자열을 Edit 의 `old_string` 으로 찾는다. 줄 번호를 쓰지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/skills/dflow-team-restart-flow.test.ts`:

```ts
// 자동 재시작이 SKILL.md 흐름에 들어갔는지(스펙 2026-09-23-worker-auto-restart-design.md §4·§5·§8).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const S = readFileSync('.claude/skills/dflow-team/SKILL.md', 'utf8')
const section = (from: string, to: string) => { const i = S.indexOf(from); expect(i, from).toBeGreaterThan(-1); return S.slice(i, S.indexOf(to, i + 1)) }

describe('dflow-team 자동 재시작 흐름', () => {
  it('참조와 압축 뒤 첫 기상에 restart.md 가 있다', () => {
    expect(S).toContain('`references/restart.md`(자동 재시작 판정·재투입·rate-limit 대기·중단 표식 정리)')
    expect(S).toContain('「7. 마감」 과 `references/events.md`, `references/restart.md`(전부), `references/backends.md` 의')
  })
  it('팀장 상태: 차단기는 team.lost 도 세고, 제외·고아 스캔 다섯째 조건·멈춤 사유를 더한다', () => {
    const st = section('## 팀장 상태', '## 두 번째 팀장')
    expect(st).toContain('`team.lost` 는 `cause` 와 무관하게 실패 1건으로 센다')
    expect(st).toMatch(/- \*\*`team\.lost`\*\*:[^\n]*영구 제외/)
    expect(st).toContain('`PARKED`·`RL_WAIT`·`RL_DUE` 가 아니다')
    for (const r of ['`pane 죽음`', '`rate-limit 반복`', '`rate-limit 대기(<HH:MM>)`', '`중단 표식 불일치`', '`서버 <status>`', '`서버 조회 실패`']) expect(st, r).toContain(r)
  })
  it('poll 재기동 조건에 rate-limit 보류가 있다', () => {
    expect(section('### 2-1. poll', '### 2-2.')).toContain('rate-limit 보류(`references/restart.md` 「이벤트로 본 상태」)가 없을 때만 띄운다')
  })
  it('기상 4번: 재시작 대기 목록이 새 작업보다 먼저, 보류 중에는 아무것도 띄우지 않는다', () => {
    const s = section('### 2-3. 기상마다 하는 일', '## 3. 결과 처리')
    expect(s).toContain('재시작 대기 목록(`references/restart.md` 「이벤트로 본 상태」 의 `RESTART_DUE`)도 재개 대상이며')
    expect(s).toContain('rate-limit 보류 중에는 재개·새 작업 모두 띄우지 않는다')
  })
  it('기상 표: PANE_DEAD 는 127 만 failed no-result, TICK 은 restart.md 판정', () => {
    const s = section('### 2-3. 기상마다 하는 일', '## 3. 결과 처리')
    expect(s).toMatch(/\| `PANE_DEAD <경로…>` \(tmux\) \|[^\n]*`references\/restart\.md` 「판정」[^\n]*127/)
    expect(s).toMatch(/\| `TICK` \|[^\n]*`references\/restart\.md` 「판정」/)
  })
  it('show 필터가 status 를 싣는다(G1 의 ready 갈래)', () => {
    expect(S).toContain("jq -c '{order: .order.id, status: .order.status, ref: .order.item.external_ref,")
    const m = S.match(/\| jq -c '(\{order: \.order\.id[\s\S]*?\})'/)
    const out = JSON.parse(execFileSync('jq', ['-c', m![1]], { input: JSON.stringify({ order: { id: 'o1', status: 'ready', item: { external_ref: 'd/TSK-01', spec: 'x' } } }) }).toString())
    expect(out.status).toBe('ready')
  })
  it('결과 처리: PANE_DEAD 는 127 을 먼저 보고, 그 밖은 restart.md 로 간다', () => {
    const s = section('## 3. 결과 처리', '## 4. 승인 스윕')
    const i127 = s.indexOf('`127`(`claude` 를 찾지 못함)이면 **곧바로** `failed no-result` 로 판정한다')
    expect(i127).toBeGreaterThan(-1)
    expect(s.indexOf('그 밖이면 `references/restart.md` 「판정」 으로 간다')).toBeGreaterThan(i127)
  })
  it('status 표: failed no-result 는 127 에만, failed rate-limit 는 재시작·보류 대상이 아니다', () => {
    const s = section('## 3. 결과 처리', '## 4. 승인 스윕')
    expect(s).toMatch(/\| `failed no-result`\(pane 이 죽었는데 결과 줄 없음\) \|[^\n]*127 이 아닌 죽음은[^\n]*restart\.md/)
    expect(s).toMatch(/\| `failed rate-limit` \|[^\n]*자동 재시작·보류 대상이 아니다/)
  })
  it('차단기와 무응답: team.lost 를 세고, tmux 무응답은 자동 재시작이 대신하며 Orca 는 관문 전 그대로', () => {
    const s = section('## 3. 결과 처리', '## 4. 승인 스윕')
    expect(s).toContain('`team.lost`(모든 `cause`)도 실패 1건으로 센다')
    expect(s).toContain('**자동 재시작**')
    expect(s).toMatch(/tmux 갈래는[^\n]*`references\/restart\.md`/)
    expect(s).toMatch(/Orca 는 관문 전이라/)
    // 기존 문구 유지
    expect(s).toContain('"무응답" 으로 보고만 하고 슬롯을 유지한다')
    expect(s).toContain('**두 TICK 연속으로** 생존 증거가 없을 때만')
  })
  it('5·5-1 은 띄우기 직전에 표식을 정리하고, 실패하면 띄우지 않는다', () => {
    const s5 = section('## 5. 팀원 spawn', '### 5-1. 재개 spawn')
    expect(s5).toContain('5. **띄우기 직전** `references/restart.md` 「중단 표식 정리」 블록을 돈다')
    expect(s5).toContain('`CANCEL_MARK_RM_FAILED` 면 띄우지 않고')
    const s51 = section('### 5-1. 재개 spawn', '## 6. blocked')
    expect(s51).toContain('- **재시작**: `references/restart.md` 「재투입」')
    expect(s51).toContain('6. **띄운다.** 먼저 `references/restart.md` 「중단 표식 정리」 블록을 돈다')
  })
  it('같은 작업 재spawn 예외가 넷이고 마감은 재시작 대기를 멈춤 표에 적는다', () => {
    expect(S).toContain('같은 작업을 다시 띄우는 것은 넷뿐이다.')
    expect(S).toContain('- 같은 작업의 재spawn. 예외는 넷이다.')
    expect(section('## 7. 마감', '**잠금 상실 마감**')).toContain('`references/restart.md` 「마감·lease·잠금」 대로')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team-restart-flow.test.ts`
Expected: FAIL

- [ ] **Step 3: 참조·압축 뒤 첫 기상**

(1) `(팀원 규칙. 팀장은 포인터로 넘기기만 한다), \`references/events.md\`(events.jsonl 이벤트 표·기록 명령).` 을 아래로 바꾼다:

```markdown
(팀원 규칙. 팀장은 포인터로 넘기기만 한다), `references/events.md`(events.jsonl 이벤트 표·기록 명령),
`references/restart.md`(자동 재시작 판정·재투입·rate-limit 대기·중단 표식 정리).
```

(2) `「2. 기상과 감시」「3. 결과 처리」「6. blocked」「7. 마감」 과 \`references/events.md\`, \`references/backends.md\` 의` 를 아래로 바꾼다:

```markdown
「2. 기상과 감시」「3. 결과 처리」「6. blocked」「7. 마감」 과 `references/events.md`, `references/restart.md`(전부), `references/backends.md` 의
```

- [ ] **Step 4: 「팀장 상태」 — 차단기·제외·고아 스캔·멈춤 사유**

(1) `\`failed not-assignee\`·\`cancelled\` 는 세지도 끊지도 않고 건너뛴다)` 를 아래로 바꾼다(같은 줄 안):

```markdown
`failed not-assignee`·`cancelled` 는 세지도 끊지도 않고 건너뛴다. `team.lost` 는 `cause` 와 무관하게 실패 1건으로 센다)
```

(2) `- \`team.blocked\` 중 그 뒤에 같은 id8 의 \`team.answer\` 가 없는 것이 답을 기다리는 질문이다.` 줄 **바로 위**에 넣는다:

```markdown
- **`team.lost`**: id8 의 마지막 이벤트(`team.spawn`·`team.blocked`·`team.result`·`team.lost` 중)가 `team.lost` 면 영구 제외
  (진행 중)다. 재시작 대기 목록·rate-limit 대기·보류는 `references/restart.md` 「이벤트로 본 상태」 블록으로 복원한다.
  이 블록은 `team.start` 로 자르지 않는다.
```

(3) `     - 그 id8 의 재개 재시도가 상한(3)에 닿지 않았다.` 줄 **바로 아래**에 넣는다(들여쓰기 5칸 유지):

```markdown
     - 그 id8 이 `references/restart.md` 「이벤트로 본 상태」 에서 `PARKED`·`RL_WAIT`·`RL_DUE` 가 아니다. 이유: 자동
       재시작이 멈춤으로 내린 작업(`park`)과 한도 대기 중인 작업을 팀장을 다시 띄울 때마다 되살리지 않는다.
       `RESTART_DUE` 는 재개 가능이며 재시작 대기 목록과 id8 으로 합쳐 한 번만 띄운다.
```

(4) `사유는 \`미커밋 보존\`·\`서버 미claim\`·\`다른 PC claim\`·\`재시도 상한\`·\`워크트리 없음\`·\`무응답\`, 또는 결과 줄의` 를 아래로 바꾼다:

```markdown
  사유는 `미커밋 보존`·`서버 미claim`·`다른 PC claim`·`재시도 상한`·`워크트리 없음`·`무응답`·`pane 죽음`·`rate-limit 반복`·
  `rate-limit 대기(<HH:MM>)`·`중단 표식 불일치`·`중단 표식 삭제 실패`·`서버 <status>`·`서버 조회 실패`(`references/restart.md`), 또는 결과 줄의
```

- [ ] **Step 5: 「2-1」 재기동 조건**

`**재기동 조건**: 빈 슬롯이 있고, 대기 큐가 비었고, 차단기가 풀려 있을 때만 띄운다.` 를 아래로 바꾼다:

```markdown
**재기동 조건**: 빈 슬롯이 있고, 대기 큐가 비었고, 차단기가 풀려 있고, rate-limit 보류(`references/restart.md` 「이벤트로 본 상태」)가 없을 때만 띄운다.
```

- [ ] **Step 6: 「2-3」 — 4번·기상 표·show 필터**

(1) `   않은 \`--resume\` 지목분이다.` 를 아래로 바꾼다:

```markdown
   않은 `--resume` 지목분이다. 재시작 대기 목록(`references/restart.md` 「이벤트로 본 상태」 의 `RESTART_DUE`)도 재개 대상이며
   새 작업보다 먼저다. rate-limit 보류 중에는 재개·새 작업 모두 띄우지 않는다(`RL_DUE` 슬롯 자신의 재투입만 예외).
```

(2) 기상 표의 `| \`PANE_DEAD <경로…>\` (tmux) | 경로마다 「3. 결과 처리」. \`.result\` 가 있으면 그 줄, 없으면 죽은 pane 화면 폴백, 그것도 없으면 \`failed no-result\` |` 를 아래로 바꾼다:

```markdown
| `PANE_DEAD <경로…>` (tmux) | 경로마다 「3. 결과 처리」. `.result` 가 있으면 그 줄, 없으면 죽은 pane 화면 폴백, 그것도 없으면 `references/restart.md` 「판정」(`pane_dead_status` 127 이면 `failed no-result`) |
```

(3) 기상 표의 `TICK` 행에서 `무응답 슬롯의 생존 증거를 잰다(「3. 결과 처리」).` 를 아래로 바꾼다(같은 행 안):

```markdown
무응답 슬롯의 생존 증거를 잰다(「3. 결과 처리」). 결과 줄 없는 정체 슬롯과 재시작 대기 목록은 `references/restart.md` 「판정」·「rate-limit 대기」 를 탄다.
```

(4) show 필터의 `  | jq -c '{order: .order.id, ref: .order.item.external_ref, spec_empty: ((.order.item.spec // "") | length == 0),` 를 아래로 바꾼다:

```bash
  | jq -c '{order: .order.id, status: .order.status, ref: .order.item.external_ref, spec_empty: ((.order.item.spec // "") | length == 0),
```

- [ ] **Step 7: 「3. 결과 처리」 — PANE_DEAD 항목**

아래 세 줄을

```markdown
  폴백으로만 온다). 그것도 없으면 **곧바로** `failed no-result` 로 판정한다(hash `-`). 기다리지 않는 이유:
  프로세스가 없으므로 더 올 결과가 없다. 그때는 `#{pane_dead_status}` 도 함께 읽어 보고에 적는다. `127` 이면
  `claude` 를 찾지 못한 것이다.
```

아래로 바꾼다:

```markdown
  폴백으로만 온다). 그것도 없으면 `#{pane_dead_status}` 를 읽는다(`references/restart.md` 「판정」 블록의 `dead_status`).
  `127`(`claude` 를 찾지 못함)이면 **곧바로** `failed no-result` 로 판정한다(hash `-`). 다시 띄워도 같은 자리에서 죽는
  환경 결함이기 때문이다. 그 밖이면 `references/restart.md` 「판정」 으로 간다(재시작 후보). 기다리지 않는 이유:
  프로세스가 없으므로 더 올 결과가 없다.
```

- [ ] **Step 8: 「3. 결과 처리」 — status 표 두 행**

(1) `failed rate-limit` 행 끝의 `차단기 계산에 넣는다 |` 를 아래로 바꾼다(`| \`failed rate-limit\` |` 로 시작하는 행 안에서만):

```markdown
차단기 계산에 넣는다. 워커가 결과 줄을 쓴 경우라 자동 재시작·보류 대상이 아니다. 결과 줄 없이 한도에 선 워커는 `references/restart.md` 「rate-limit 대기」 가 다룬다 |
```

(2) `failed no-result` 행의 `| 서버에 claimed 면 **"멈춤" 표**에 넣는다(사유는 그 status). 차단기 계산 |` 를 아래로 바꾼다(`| \`failed no-result\`(pane 이 죽었는데 결과 줄 없음) |` 로 시작하는 행 안에서만):

```markdown
| 서버에 claimed 면 **"멈춤" 표**에 넣는다(사유는 그 status). 차단기 계산. `pane_dead_status` 127 일 때만 이 행이다. 127 이 아닌 죽음은 이 행이 아니라 `references/restart.md` 의 재시작 판정으로 간다(워크트리를 지우지 않는다) |
```

- [ ] **Step 9: 「3. 결과 처리」 — 차단기·무응답**

(1) `  푼다. 이유: 사용량 한도나 환경 결함에 걸린 채 대기 큐 전체를 소진하지 않게 한다.` 를 아래로 바꾼다:

```markdown
  푼다. 이유: 사용량 한도나 환경 결함에 걸린 채 대기 큐 전체를 소진하지 않게 한다.
  자동 재시작의 `team.lost`(모든 `cause`)도 실패 1건으로 센다(`references/restart.md`). 걸린 동안의 시험 1건은
  재시작 대기가 새 작업보다 먼저다.
```

(2) 무응답 항목 끝의 `  (사유 \`무응답\`).` 줄 **바로 아래**에 넣는다:

```markdown
- **자동 재시작**: 위 자동 정리의 tmux 갈래는 `references/restart.md` 「판정」 이 대신한다. 두 TICK 연속 무변화(또는 결과
  없는 pane 죽음)면 원인을 가려, 재시작 후보는 워크트리를 지우지 않고 pane 만 거둔 뒤 `team.lost` 를 기록하고 같은 기상
  안에 「5-1. 재개 spawn」 으로 다시 띄운다(재시도 상한 3 은 고아 재개와 공유). 영구 제외는 `team.lost` 가 대신한다.
  Orca 는 관문 전이라 위 자동 정리를 그대로 하고 `references/restart.md` 「Orca」 의 한 줄을 더한다.
```

- [ ] **Step 10: 「5. 팀원 spawn」**

(1) `5. backends.md 의 해당 절 명령 그대로 띄운다.` 를 아래로 바꾼다:

```markdown
5. **띄우기 직전** `references/restart.md` 「중단 표식 정리」 블록을 돈다(`order` 는 show 필터의 `order`, `st` 는 `status`).
   `CANCEL_MARK_RM_FAILED` 면 띄우지 않고 그 id8 을 일시 제외에 넣어 사유를 보고한다. 이어서 backends.md 의 해당 절 명령 그대로 띄운다.
```

(2) `같은 작업을 다시 띄우는 것은 셋뿐이다.` 를 `같은 작업을 다시 띄우는 것은 넷뿐이다.` 로 바꾸고, 같은 문단의 `\`--resume\` 으로 사람이 지목한\n작업이다.` 를 아래로 바꾼다:

```markdown
`--resume` 으로 사람이 지목한
작업, 자동 재시작(`references/restart.md`)이 다시 띄우는 작업이다.
```

같은 문단의 `뒤의 둘은 이 절이 아니라 「5-1. 재개 spawn」 의 절차로 띄운다.` 는 `뒤의 셋은 이 절이 아니라 「5-1. 재개 spawn」 의 절차로 띄운다.` 로 바꾼다.

- [ ] **Step 11: 「5-1. 재개 spawn」**

(1) `- **지목**: 「인자」 의 \`--resume <id8>\`.` 로 시작하는 항목 **바로 위**에 넣는다:

```markdown
- **재시작**: `references/restart.md` 「재투입」. 결과 줄 없이 멈춘 팀원을 팀장이 그 자리에서 다시 띄운다. 이미 서버
  claim 을 잡고 있어 대기 큐보다 먼저 띄우며, 재시도 상한 3 을 자동 갈래와 나눠 쓴다. 차단기·rate-limit 보류의 통제를 받는다.
```

(2) `6. **띄운다.** 백엔드별 명령은 5번 5항과 같다.` 를 아래로 바꾼다:

```markdown
6. **띄운다.** 먼저 `references/restart.md` 「중단 표식 정리」 블록을 돈다(`st` 는 재개 판정이 받은 show 의 `status`,
   곧 `claimed`). `CANCEL_MARK_RM_FAILED` 면 띄우지 않고 「멈춤」 표(사유 `중단 표식 삭제 실패`)에 넣는다. 백엔드별 명령은 5번 5항과 같다.
```

- [ ] **Step 12: 「7. 마감」·「금지」**

(1) `   대기 큐·남은 슬롯과 **"멈춤" 표**(「팀장 상태」 — 재시작 명령 칸까지)도 함께 적는다.` 를 아래로 바꾼다:

```markdown
   대기 큐·남은 슬롯과 **"멈춤" 표**(「팀장 상태」 — 재시작 명령 칸까지)도 함께 적는다. 재시작 대기와 rate-limit 대기는
   `references/restart.md` 「마감·lease·잠금」 대로 사유와 재시작 명령을 적는다(마감 중에는 재시작하지 않는다).
```

(2) `- 같은 작업의 재spawn. 예외는 셋이다.` 를 `- 같은 작업의 재spawn. 예외는 넷이다.` 로 바꾸고, 같은 항목의 `(뒤의 둘은 「5-1. 재개 spawn」)` 을 `와 자동 재시작 작업(\`references/restart.md\`)(뒤의 셋은 「5-1. 재개 spawn」)` 으로 바꾼다.

- [ ] **Step 13: depends-precheck 테스트에 status 확인 추가**

`tests/skills/dflow-team-depends-precheck.test.ts` 의 `describe(` 블록 안 첫 `it(` **앞**에 넣는다:

```ts
  it('show 필터는 G1(중단 표식 정리)을 위해 status 를 싣는다', () => {
    const r = JSON.parse(execFileSync('jq', ['-c', filterExpr()], { input: JSON.stringify({ order: { id: 'o1', status: 'ready', item: { external_ref: 'd/TSK-03-02', spec: '본문' } } }) }).toString())
    expect(r.status).toBe('ready')
  })
```

- [ ] **Step 14: 통과 확인**

Run: `npx vitest run tests/skills/dflow-team-restart-flow.test.ts tests/skills/dflow-team.test.ts tests/skills/dflow-team-depends-precheck.test.ts tests/skills/dflow-team-lease.test.ts tests/skills/dflow-team-shell-blocks.test.ts tests/skills/dflow-team-restart-blocks.test.ts`
Expected: PASS. `dflow-team.test.ts` 가 깨지면 바꾼 문구가 기존 부분 문자열을 지웠는지 `grep -n` 으로 확인하고, 문구를 되살려 고친다(기존 테스트를 느슨하게 만들지 않는다).

- [ ] **Step 15: 커밋**

```bash
cd /Users/jji/project/wbs-web-restart
git add .claude/skills/dflow-team/SKILL.md tests/skills/dflow-team-restart-flow.test.ts tests/skills/dflow-team-depends-precheck.test.ts
git commit -F - <<'EOF'
feat(dflow-team): 멈춘 팀원을 팀장이 그 자리에서 다시 띄운다

지금은 무응답·pane 죽음 뒤 팀장을 다시 시작하거나 사람이 --resume 을 줄 때만 재개돼,
밤새 도는 팀장이 죽은 워커의 작업을 아침까지 붙잡는다. SKILL.md 의 판정 자리에서
restart.md 를 부르고, spawn 직전에 낡은 중단 표식을 지운다. 기존 문장은 옮기지 않았다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
EOF
```

---

### Task 4: tmux 팀원의 statusLine 덤프 — `backends.md`

**Files:**
- Modify: `.claude/skills/dflow-team/references/backends.md` (「pane(tmux)」 spawn 블록의 `.dflow-run` 작성부와 설명, 「pane(Orca)」 첫 문장)
- Test: `tests/skills/dflow-team-restart-statusline.test.ts` (신규)

**Interfaces:**
- Consumes: Task 2 의 `## 한도 판정` 블록(교차 검증).
- Produces: `.dflow-run` 끝의 실행 줄(설정 파일이 있을 때만 `--settings`), `~/.dflow/limits/<id8>.settings.json`(`{"statusLine":{"type":"command","command":…}}`)과, 팀원 claude 가 도는 동안 statusLine 이 쓰는 `~/.dflow/limits/<id8>.json`(`{"at": <epoch>, "rate_limits": <입력의 .rate_limits 또는 null>}`).

- [ ] **Step 1: CLI 확인(사전 조건)**

Run: `claude --version && claude --help | grep -- '--settings <file-or-json>'`
Expected: `2.1.280 (Claude Code)` 이상, `--settings <file-or-json>   Path to a settings JSON file or a JSON` 줄. 없으면 이 Task 를 멈추고 보고한다(팀원이 전부 첫 화면에서 죽는다).

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/skills/dflow-team-restart-statusline.test.ts`:

```ts
// tmux 팀원의 statusLine 이 rate_limits 를 워크트리 밖에 덤프하는지(스펙 §6-2). 설정이 깨지면 팀원이 전부 죽으므로
// 설정 파일의 유효성과 명령의 실제 동작을 둘 다 확인한다. HOME 은 임시 디렉터리다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const B = () => readFileSync(join(ROOT, '.claude/skills/dflow-team/references/backends.md'), 'utf8')
const R = () => readFileSync(join(ROOT, '.claude/skills/dflow-team/references/restart.md'), 'utf8')
let tmp: string, home: string
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'sl-')); home = join(tmp, 'home'); mkdirSync(home) })
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })
const env = () => ({ PATH: process.env.PATH ?? '', HOME: home })

function settingsLines(): string {
  const m = B().match(/^(LIM="\$HOME\/\.dflow\/limits"; mkdir -p "\$LIM"\njq -n --arg f "\$LIM\/<id8>\.json" [^\n]*> "\$LIM\/<id8>\.settings\.json")$/m)
  if (!m) throw new Error('statusLine 설정 줄을 찾지 못했다')
  return m[1].replaceAll('<id8>', 'abcd1234')
}
function makeSettings() {
  const r = spawnSync('sh', ['-c', settingsLines()], { encoding: 'utf8', env: env() })
  expect(r.status, r.stderr).toBe(0)
  return JSON.parse(readFileSync(join(home, '.dflow/limits/abcd1234.settings.json'), 'utf8'))
}
function runStatusLine(input: string) {
  const s = makeSettings()
  return spawnSync('sh', ['-c', s.statusLine.command], { input, encoding: 'utf8', env: env() })
}
const limitsFile = () => join(home, '.dflow/limits/abcd1234.json')

describe('statusLine 덤프', () => {
  it('설정 파일은 유효 JSON 이고 statusLine command 를 갖는다', () => {
    const s = makeSettings()
    expect(s.statusLine.type).toBe('command')
    expect(typeof s.statusLine.command).toBe('string')
    expect(s.statusLine.command).toContain(join(home, '.dflow/limits/abcd1234.json'))
  })
  // .dflow-run 이 실행 시점에 설정 파일을 확인한다. claude 는 없는 설정 파일에서 곧바로 끝나므로(2.1.280:
  // "Settings file not found"), 파일이 없으면 --settings 없이 띄워야 재시작이 전부 첫 화면에서 죽지 않는다.
  function runTail(withSettings: boolean) {
    const m = B().match(/cat >> "\$WT\/\.dflow-run" <<'RUNEOF'\n([\s\S]*?)\nRUNEOF/)
    if (!m) throw new Error('.dflow-run 실행 줄을 찾지 못했다')
    const bin = join(tmp, 'bin'); mkdirSync(bin)
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\nprintf \'%s\\n\' "$@"\n'); chmodSync(join(bin, 'claude'), 0o755)
    const wt = join(tmp, 'wt'); mkdirSync(wt); writeFileSync(join(wt, '.dflow-prompt'), 'POINTER\n')
    if (withSettings) makeSettings()
    const run = join(wt, '.dflow-run')
    writeFileSync(run, '#!/bin/sh\n' + m[1].replaceAll('<id8>', 'abcd1234').replaceAll('<모델 플래그>', '--model opus') + '\n'); chmodSync(run, 0o755)
    return spawnSync('sh', [run], { cwd: wt, encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: home } })
  }
  it('.dflow-run 은 설정 파일이 있으면 --settings 로 싣는다', () => {
    const r = runTail(true)
    expect(r.status).toBe(0)
    const args = r.stdout.trim().split('\n')
    expect(args).toEqual(['--dangerously-skip-permissions', '--settings', join(home, '.dflow/limits/abcd1234.settings.json'), '--model', 'opus', 'POINTER'])
  })
  it('.dflow-run 은 설정 파일이 없으면 --settings 없이 띄운다', () => {
    const r = runTail(false)
    expect(r.status).toBe(0)
    expect(r.stdout.trim().split('\n')).toEqual(['--dangerously-skip-permissions', '--model', 'opus', 'POINTER'])
  })
  it('명령은 입력의 rate_limits 를 한도 파일에 쓰고 한 줄을 출력한다', () => {
    const r = runStatusLine(JSON.stringify({ model: { id: 'x' }, rate_limits: { five_hour: { used_percentage: 100, resets_at: 4102444800 } } }))
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('dflow')
    const j = JSON.parse(readFileSync(limitsFile(), 'utf8'))
    expect(j.rate_limits.five_hour.resets_at).toBe(4102444800)
    expect(typeof j.at).toBe('number')
  })
  it('rate_limits 가 없는 입력이면 null 로 쓰고, 한도 판정은 LIMIT_NONE 이다', () => {
    runStatusLine(JSON.stringify({ model: { id: 'x' } }))
    expect(JSON.parse(readFileSync(limitsFile(), 'utf8')).rate_limits).toBeNull()
    const sec = R().slice(R().indexOf('\n## 한도 판정\n'))
    const code = sec.match(/```bash\n([\s\S]*?)```/)![1]
      .replace("id8='<id8>'", "id8='abcd1234'").replace("pane='<pane id 또는 ->'", "pane='-'").replace("TM='<진짜 tmux 절대경로 또는 빈 값>'", "TM=''")
    expect(spawnSync('sh', ['-c', code], { encoding: 'utf8', env: env() }).stdout.trim()).toBe('LIMIT_NONE')
  })
  it('깨진 입력이면 한도 파일을 남기지 않는다(임시 파일에서 끝난다)', () => {
    runStatusLine('not json')
    expect(existsSync(limitsFile())).toBe(false)
  })
  it('덤프는 워크트리 밖(~/.dflow/limits)이다 — git status 를 더럽히지 않는다', () => {
    expect(B()).toMatch(/워크트리 밖[^\n]*`~\/\.dflow\/limits/)
  })
  it('Orca 절의 낡은 첫 문장을 고쳤다', () => {
    expect(B()).not.toContain('tmux 를 찾지 못한 Orca 환경에서만 이 백엔드로 온다')
    expect(B()).toContain('Orca 안에서 띄운 팀장은 이 백엔드를 먼저 고른다')
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team-restart-statusline.test.ts`
Expected: FAIL (`statusLine 설정 줄을 찾지 못했다`)

- [ ] **Step 4: spawn 블록 수정**

「pane(tmux)」 spawn 블록에서 아래 한 줄을

```bash
printf 'exec claude --dangerously-skip-permissions %s "$(cat .dflow-prompt)"\n' '<모델 플래그>' >> "$WT/.dflow-run"
```

아래 여섯 줄로 바꾼다(모든 줄은 들여쓰기 없이 줄 머리에서 시작한다):

```bash
LIM="$HOME/.dflow/limits"; mkdir -p "$LIM"
jq -n --arg f "$LIM/<id8>.json" '{statusLine: {type: "command", command: ("jq -c \"{at: (now | floor), rate_limits: (.rate_limits // null)}\" > \"" + $f + ".tmp\" && mv -f \"" + $f + ".tmp\" \"" + $f + "\"; printf dflow")}}' > "$LIM/<id8>.settings.json"
cat >> "$WT/.dflow-run" <<'RUNEOF'
S="$HOME/.dflow/limits/<id8>.settings.json"
[ -f "$S" ] && exec claude --dangerously-skip-permissions --settings "$S" <모델 플래그> "$(cat .dflow-prompt)"
exec claude --dangerously-skip-permissions <모델 플래그> "$(cat .dflow-prompt)"
RUNEOF
```
`<id8>`·`<모델 플래그>` 는 팀장이 글자 그대로 바꿔 쓴다(heredoc 은 따옴표로 막아 `$S`·`$HOME` 이 팀원 실행 시점에 풀린다).
설정 파일 경로를 실행 시점에 다시 만들고 없으면 `--settings` 없이 띄우는 이유: Claude Code 2.1.280 은 없는 설정 파일을
받으면 `Settings file not found` 로 곧바로 끝난다. 팀장의 Bash 호출은 변수를 이어받지 않으므로 「5-1」 이 `.dflow-run` 을
다시 쓸 때 `LIM` 줄을 빠뜨리면 경로가 비고, 그러면 재시작한 팀원이 전부 첫 화면에서 죽어 상한 3 에서 멈춘다.

- [ ] **Step 5: 설명 추가**

같은 블록 아래 설명 목록의 첫 항목(`- **전용 소켓 \`-L dflow\`**` 로 시작) **바로 위**에 넣는다:

```markdown
- **statusLine 덤프**: `--settings` 로 붙인 statusLine 이 입력 JSON 의 `.rate_limits`(구독자일 때 `five_hour`·`seven_day`
  마다 `used_percentage`·`resets_at`)를 `~/.dflow/limits/<id8>.json` 에 쓴다. 팀장은 이것으로 한도와 해제 시각을
  정한다(`references/restart.md` 「한도 판정」). 워크트리 밖(`~/.dflow/limits`)에 쓰는 이유: 워크트리 안에 쓰면
  `git status --porcelain` 이 더러워져 `DIRTY` 검사와 「고아 정리 규칙」 2번이 깨진다. 임시 파일에 쓰고 옮기는 이유: 깨진
  입력이 반쯤 쓴 파일을 남기지 않게 한다. 팀원 pane 에서는 사람의 statusLine 설정이 이것으로 덮인다(표시는 `dflow`).
  「5-1. 재개 spawn」 도 `.dflow-run` 을 이 블록대로 새로 쓰므로 재개·재시작 팀원도 덤프를 남긴다. 파일은 지우지 않는다
  (작고, 같은 id8 을 다시 띄우면 덮어쓴다).
```

- [ ] **Step 6: 「pane(Orca)」 첫 문장**

`tmux 를 찾지 못한 Orca 환경에서만 이 백엔드로 온다. 그런 조합이 실제로 있는지는 확인된 바 없다.` 를 아래로 바꾼다:

```markdown
Orca 안에서 띄운 팀장은 이 백엔드를 먼저 고른다(SKILL.md 「0. 환경 감지」). 자동 재시작의 재투입(`orca terminal close`·
`orca terminal create`)은 실측 관문 전이라 쓰지 않는다(`references/restart.md` 「Orca」). Orca 팀원은 `.dflow-run` 을 쓰지 않아
statusLine 덤프가 없다.
```

- [ ] **Step 7: 통과 확인**

Run: `npx vitest run tests/skills/dflow-team-restart-statusline.test.ts tests/skills/dflow-team-backends.test.ts tests/skills/dflow-team-shell-blocks.test.ts tests/skills/dflow-team.test.ts`
Expected: PASS

- [ ] **Step 8: 실제 CLI 로 설정 파일 수용 확인**

```bash
cd /Users/jji/project/wbs-web-restart
T=$(mktemp -d)
HOME=$T sh -c 'LIM="$HOME/.dflow/limits"; mkdir -p "$LIM"
jq -n --arg f "$LIM/smoke.json" '"'"'{statusLine: {type: "command", command: ("jq -c \"{at: (now | floor), rate_limits: (.rate_limits // null)}\" > \"" + $f + ".tmp\" && mv -f \"" + $f + ".tmp\" \"" + $f + "\"; printf dflow")}}'"'"' > "$LIM/smoke.settings.json"; jq . "$LIM/smoke.settings.json" >/dev/null && echo SETTINGS_JSON_OK'
claude --settings "$T/.dflow/limits/smoke.settings.json" -p 'ok 한 단어로만 답하라' --max-turns 1
rm -rf "$T"
```
Expected: `SETTINGS_JSON_OK`, 그리고 claude 가 설정 오류 없이 `ok` 로 답한다(설정 로드 실패면 오류 문구가 나온다). 실패하면 Step 4 를 되돌리고 보고한다.

- [ ] **Step 9: 커밋**

```bash
cd /Users/jji/project/wbs-web-restart
git add .claude/skills/dflow-team/references/backends.md tests/skills/dflow-team-restart-statusline.test.ts
git commit -F - <<'EOF'
feat(dflow-team): tmux 팀원이 사용량 한도 상태를 워크트리 밖에 남긴다

한도에 걸린 워커는 결과 줄을 쓰지 못해 팀장이 해제 시각을 알 길이 없다. statusLine 입력의
rate_limits 를 ~/.dflow/limits 에 덤프해 팀장이 해제 뒤에 한 번만 다시 띄우게 한다.
Orca 절의 "tmux 가 없을 때만" 문장은 환경 감지 순서와 달라 고친다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
EOF
```

---

### Task 5: 안내 문장 — help.md·dflow-dev·kit README (G3)

**Files:**
- Modify: `.claude/skills/dflow-team/references/help.md` (「여러 날 무인으로 돌릴 때」)
- Modify: `.claude/skills/dflow-dev/SKILL.md` (중단 표식 문장)
- Modify: `kit/README.md` (「중단」 문단 끝 문장)
- Test: `tests/skills/dflow-team-restart-docs.test.ts` (신규)

**Interfaces:**
- Consumes: 없음(문장만). Task 1 과 병렬 가능.
- Produces: 없음.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/skills/dflow-team-restart-docs.test.ts`:

```ts
// 자동 재시작 안내와 중단 표식 정리 주체(G3) 문장(스펙 §3 G3·§11).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const HELP = readFileSync('.claude/skills/dflow-team/references/help.md', 'utf8')
const DEV = readFileSync('.claude/skills/dflow-dev/SKILL.md', 'utf8')
const KIT = readFileSync('kit/README.md', 'utf8')
const HOOK = readFileSync('kit/hooks/heartbeat.sh', 'utf8')

describe('자동 재시작 안내·G3', () => {
  it('help 에 자동 재시작 한 문단이 있다', () => {
    expect(HELP).toContain('- **자동 재시작**:')
    expect(HELP).toMatch(/최대 3번/)
    expect(HELP).toMatch(/--resume <id8>/)
  })
  it('dflow-dev 는 "재위임 때 지운다" 대신 팀장이 spawn 직전에 지운다고 적는다', () => {
    expect(DEV).not.toContain('위임받아 이어 갈 때만 그 파일을 지운다')
    expect(DEV).toContain('`/dflow-team` 팀장이 spawn 직전에 서버 status(`ready`·`claimed`)로 확인하고 지운다')
    expect(DEV).toMatch(/수동 `\/dflow-dev` 세션은 사람이\s+지운다/)
  })
  it('kit README 도 같은 뜻으로 고친다', () => {
    expect(KIT).not.toContain('같은 주문을 다시 위임받아 이어 가려면 표식 파일을 지운다.')
    expect(KIT).toContain('`/dflow-team` 팀장은 spawn 직전에 서버 status 로 확인하고 낡은 표식을 지운다')
  })
  it('훅은 표식을 지우지 않는다(G3: 훅은 고치지 않는다)', () => {
    expect(HOOK).not.toMatch(/rm[^\n]*\.cancelled/)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team-restart-docs.test.ts`
Expected: FAIL (앞의 세 개)

- [ ] **Step 3: help.md**

`- 사용량 한도나 환경 문제로 실패가 2건 이어지면 새 배정을 멈추고 30분마다 1건만 시험한다.` 줄 **바로 아래**에 넣는다:

```markdown
- **자동 재시작**: 팀원이 결과 없이 멈추면(1시간 가까이 진척 없음, 또는 터미널 화면에서 팀원 프로세스가 죽음) 팀장이
  같은 워크트리·같은 자리에서 다시 띄운다. 한 작업당 최대 3번이며, 넘으면 「멈춤」 표에 올리고
  `/dflow-team <종료시각> --resume <id8>` 명령을 적어 준다. 사용량 한도에 걸리면 한도가 풀린 뒤 한 번만 다시 띄우고,
  그때까지 새 배정을 멈춘다. 권한 거부·질문(`blocked`)·중단은 다시 띄우지 않고 알린다. Orca 탭은 아직 자동으로
  다시 띄우지 않으며 재시작 명령만 알려 준다.
```

- [ ] **Step 4: dflow-dev SKILL.md**

아래 두 줄의 문장 조각

```markdown
  세션을 세운다(`continue:false`). 표식이 남은 동안 훅은 도구를 부를 때마다 다시 세우므로, 같은 주문을 다시
  위임받아 이어 갈 때만 그 파일을 지운다. `cancelled` 는 진행 중 phase 가 아니다 — 스윕·재개 판정은 건너뛴다.
```

을 아래로 바꾼다:

```markdown
  세션을 세운다(`continue:false`). 표식이 남은 동안 훅은 도구를 부를 때마다 다시 세운다. 그 파일은
  `/dflow-team` 팀장이 spawn 직전에 서버 status(`ready`·`claimed`)로 확인하고 지운다. 수동 `/dflow-dev` 세션은 사람이
  지운다. `cancelled` 는 진행 중 phase 가 아니다 — 스윕·재개 판정은 건너뛴다.
```

- [ ] **Step 5: kit/README.md**

`약 1분(절제 간격)이다. 네트워크 실패·다른 409·5xx 는 지금처럼 무시한다. 같은 주문을 다시 위임받아 이어 가려면 표식 파일을 지운다.` 에서 마지막 문장 `같은 주문을 다시 위임받아 이어 가려면 표식 파일을 지운다.` 를 아래로 바꾼다:

```markdown
`/dflow-team` 팀장은 spawn 직전에 서버 status 로 확인하고 낡은 표식을 지운다(서버가 `ready`·`claimed` 라고 말하는 주문의
표식). 수동 `/dflow-dev` 세션에서 같은 주문을 이어 가려면 사람이 표식 파일을 지운다.
```

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/skills/dflow-team-restart-docs.test.ts tests/skills/heartbeat-hook.test.ts tests/skills/dflow-dev-worker.test.ts tests/skills/dflow-team-kit.test.ts tests/skills/dflow-team-shell-blocks.test.ts`
Expected: PASS (heartbeat-hook 은 손대지 않았으므로 그대로 통과)

- [ ] **Step 7: 커밋**

```bash
cd /Users/jji/project/wbs-web-restart
git add .claude/skills/dflow-team/references/help.md .claude/skills/dflow-dev/SKILL.md kit/README.md tests/skills/dflow-team-restart-docs.test.ts
git commit -F - <<'EOF'
docs(dflow): 중단 표식은 팀장이 spawn 직전에 지운다고 고친다

"재위임 때 지운다" 는 문장과 달리 표식을 지우는 코드가 없었고, 재위임은 새 주문이라 애초에
겹치지 않는다. 실제로 겹치는 스테이징·운영 UUID 는 팀장이 서버 status 로 가려 지운다.
훅은 매 도구 호출마다 도는 곳이라 네트워크를 타지 않게 그대로 둔다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
EOF
```

---

### Task 6: 스테이징 리허설 (컨트롤러가 직접, 터미널)

스킬만 바뀌므로 서버 반영 없이 이 워크트리를 팀장 체크아웃으로 쓴다. 대상은 스테이징 D'Flow 의 `agent` 태그가 켜진 ready 작업 1건이다(없으면 사람에게 한 건 켜 달라고 요청하고, 그동안 Step 4 만 먼저 한다). 브라우저는 필요 없다.

- [ ] **Step 1: 준비**

```bash
cd /Users/jji/project/wbs-web-restart
ls .dflow .dflow.local >/dev/null && .claude/skills/dflow-work/scripts/dflow.sh config api_base   # 스테이징 URL 인지 확인
```
`.dflow.local` 이 없으면 메인 체크아웃의 것을 복사하지 말고, `lead-worktree.sh` 규칙대로 사람에게 확인받는다. 운영 URL 이면 멈춘다.

- [ ] **Step 2: pane 죽음 → 같은 슬롯·같은 워크트리 재투입**

`/dflow-team 1명 <1시간 뒤>` 로 팀장을 띄우고 팀원이 Phase 01 에 들어가면 다른 터미널에서:
```bash
TMUX= tmux -L dflow list-panes -a -F '#{pane_id} #{pane_title}'
TMUX= tmux -L dflow kill-pane -t <팀원 pane id>
```
Expected: 20초 안에 `PANE_DEAD` 기상 → 보고에 `재시작(pane 죽음, 1/3) — 워크트리 … 이어받음`. 확인:
```bash
jq -c 'select(.event == "team.lost" or .event == "team.spawn") | {event, id8, slot, cause, next, spawn_kind}' ~/.dflow/events.jsonl | tail -n 3
```
마지막 두 줄이 `team.lost`(`pane-dead`, `restart`) → `team.spawn`(`resume`, 같은 `slot`) 순서다.

- [ ] **Step 3: 상한 → 멈춤, 팀장 재시작 뒤에도 재개하지 않음**

Step 2 의 kill 을 두 번 더 한다(재시도 2/3, 3/3). 네 번째 kill 뒤 보고가 `멈춤(재시도 상한)` 이고 `.dflow-agent` 가 `…/parked`, 마지막 `team.lost` 의 `next` 가 `park` 다. "팀장 종료" 로 마감한 뒤 같은 인자로 팀장을 다시 띄우면 시작 보고의 「멈춤」 표에 그 id8 이 있고 재개하지 않는다.

- [ ] **Step 4: 낡은 중단 표식 정리**

새 ready 작업(또는 `--resume <id8>` 로 Step 3 의 작업)을 띄우기 전에:
```bash
mkdir -p ~/.dflow/hb && touch ~/.dflow/hb/<그 주문 전체 UUID>.cancelled
```
Expected: 보고에 `STALE_CANCEL_MARK_REMOVED <UUID>` 한 줄, 팀원이 첫 도구 호출에서 서지 않고 진행한다. 표식 파일이 없어졌다.

- [ ] **Step 5: 무응답(선택, 시간이 되면)**

```bash
pgrep -f "dflow-<id8>"                 # 팀원 claude PID
kill -STOP <팀원 claude PID>
```
실제 TICK 두 번(약 60분)을 기다린다. 세대 파일을 고쳐 TICK 을 앞당기지 않는다: 떠 있는 감시 루프의 `TICK_AT` 은
리터럴이라 파일을 고쳐도 앞당겨지지 않고, 세대를 올리면 옛 루프가 `STALE` 로 끝날 뿐이다. Expected: 첫 TICK 은 "무응답"
보고만, 둘째 TICK 에 `재시작(무응답, n/3)` 이고 멈춘 프로세스의 pane 은 거둬져 있다. 시간이 없으면 이 Step 은 건너뛰고
보고에 "무응답 경로는 문서 테스트로만 확인" 이라 적는다.

- [ ] **Step 6: 정리와 기록**

마감 뒤 `TMUX= tmux -L dflow list-panes -a` 가 비었는지, `git worktree list` 에 남은 `dflow-<id8>` 가 「멈춤」 표와 맞는지 본다. 결과(통과·실패·발견)를 Task 7 의 머지 커밋 메시지 본문에 한 줄씩 적는다. 실패가 있으면 해당 Task 로 돌아가 고치고 Task 6 을 다시 한다.

---

### Task 7: 통합·staging 반영 (컨트롤러가 직접)

- [ ] **Step 1: 전체 테스트**

Run: `cd /Users/jji/project/wbs-web-restart && npx vitest run tests/skills 2>&1 | tail -8`
Expected: 실패 0(Task 0 기준선의 기존 실패가 있었다면 그것만 남는다).

- [ ] **Step 2: origin/staging 을 받아 합친다**

```bash
cd /Users/jji/project/wbs-web-restart
git fetch -q origin
git merge --no-edit origin/staging
```
충돌이 `SKILL.md`·`backends.md`·`events.md` 에 나면: 상대편(병렬 세션)의 문장을 모두 살리고, 이 계획의 삽입 문장만 다시 넣는다. 해결 뒤 Step 1 을 다시 돈다.

- [ ] **Step 3: main back-merge 확인(프로젝트 규칙)**

```bash
git merge-base --is-ancestor origin/main HEAD && echo MAIN_INCLUDED || git merge --no-edit origin/main
```
Expected: `MAIN_INCLUDED` 또는 충돌 없는 머지. 머지했으면 Step 1 을 다시 돈다.

- [ ] **Step 4: staging push**

```bash
git push origin HEAD:staging
```
pre-push 훅 G1~G4 가 돈다(마이그레이션·UI 파일 없음). force push 금지. 거부되면(원격이 앞섬) Step 2 부터 다시.

- [ ] **Step 5: 브랜치 push(기록용)**

```bash
git push -u origin feat/worker-auto-restart
```

- [ ] **Step 6: 보고**

staging 커밋 해시, Task 6 리허설 결과, 남은 미결(§14-1 화면 문구·§14-2 statusLine 갱신·§14-3 한도 중 팀장 기상·§14-5 Orca 관문 실측)을 보고한다. main·킷 반영은 제안하지 않는다(별도 지시).

---

## 실행 기록

- Task 0: 기준선 `npx vitest run tests/skills` 21 파일·276 건 통과(실패 0).
- Task 2: 계획의 `판정 블록` 테스트 헬퍼 `gate()` 가 같은 임시 워크트리를 재사용해, 앞 호출이 쓴 `state.json`(cancelled)이 "없으면 `-`" 사례에 남았다. 테스트 결함이므로 `phase` 가 없을 때 `state.json` 을 지우도록 헬퍼만 고쳤다(restart.md 블록은 계획 그대로).
- Task 3 Step 12(1): 「7. 마감」 3번의 인용 문장이 이 판에서는 같은 줄에 `이유: 마감 뒤에 남는 …` 로 이어져 있어, 새 문장을 그 이유 문장 **뒤**(4번 앞)에 붙였다(이유 문장을 쪼개지 않는다).
- Task 3 Step 12(2): 계획의 치환(`와 자동 재시작 작업(…)`)은 앞 낱말 "작업" 과 이어 "작업와" 가 되므로, `, 자동 재시작(`references/restart.md`)이 다시 띄우는 작업(뒤의 셋은 …)` 으로 적었다(뜻 동일).
- Task 3 Step 11: 「5-1」 의 "대상은 둘이다." 는 이미 항목이 셋(자동·요청·지목)이었고 재시작이 더해져 넷이므로 "대상은 넷이다." 로 고쳤다(계획에 없던 한 낱말).
