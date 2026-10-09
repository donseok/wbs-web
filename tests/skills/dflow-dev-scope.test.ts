// tests/skills/dflow-dev-scope.test.ts — /dflow-dev 실행 범위(--scope)와 설계 상태(계약 2.11)의 워커 문서.
// 설계: docs/superpowers/specs/2026-09-26-design-state-dev-auto-design.md 6절·12절(2.10 의 router 설계 §14 를 대신한다)
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { devOrch, devRouter } from './_dflow-dev'
import { stripWorkerBlocks, workerBlocks } from './_preserve'

const flat = (s: string) => s.replace(/\s+/g, ' ')
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const WORKER_MODE = '.claude/skills/dflow-dev/references/worker-mode.md'

describe('안내 본문(SKILL.md)', () => {
  const router = flat(devRouter())
  it('범위는 가리키기만 하고, 정하는 규칙은 start 「서버 판단」 에 있다', () => {
    expect(router).toContain('[--scope design|build|full]')
    expect(router).toContain('`--only` 와 함께 오면 사용법 알리고 멈춤')
    expect(router).toContain('범위 규칙(서버 판단·`claim_scope`·옛 서버) = `orch/start.md` 「서버 판단」')
  })
  it('wait_review 는 서버 설계 상태가 이어 갈지 정하고, exit 12 는 state.json 을 바꾸지 않고 멈춘다', () => {
    // 상태 값 설명은 SKILL.md 에서 references/state-model.md 로 옮겨졌다(구조 분리)
    const sm = flat(read('.claude/skills/dflow-dev/references/state-model.md'))
    expect(sm).toContain('사람의 「설계 승인」 기다리며 멈춘 상태')
    expect(sm).toContain('이어 갈지 = 서버 설계 상태가 정함')
    expect(sm).toContain('exit 12(다른 PC 가 이어받음)도 그 자리에서 멈춤, state.json 은 안 바꿈')
  })
  it('팀장 인자·2.10 결과 값이 워커 문서에 남지 않는다(D27)', () => {
    for (const t of [devRouter(), ...['start', 'claim', 'design', 'design-first', 'rework', 'close'].map(devOrch), read(WORKER_MODE)])
      expect(t).not.toMatch(/개발자동|구현부터|design_missing|design_invalid|failed diverged/)
  })
})

describe('착수 — 서버 판단(start.md)', () => {
  const s = flat(devOrch('start'))
  it('계약 2.11 이면 show 의 서버 판단으로 먼저 가르고, 옛 서버는 종전 로컬 흐름으로 돈다(스펙 8절)', () => {
    expect(s).toContain('**서버 판단(계약 2.11)** — `dflow.mjs contract-ge 2.11` exit 0 이면')
    expect(s).toContain('계약 2.11 아님(옛 서버) → 이 문단 건너뛰고 종전대로')
    expect(s).toContain('**옛 서버의 설계 검토 대기**(계약 < 2.11, 수동 실행)')
    expect(s).toContain('design.md 를 검토한 뒤 /dflow-dev {TSK} --scope build 로 이어 간다')
    expect(s).toContain('**옛 서버의 범위 build**(계약 < 2.11, 수동 실행)')
    expect(s).toContain('**빠진 절을 스스로 채우지 않음**')
  })
  it('ready 는 --scope 또는 action 으로 범위를 정하고, wait·skip 이면 착수하지 않는다', () => {
    expect(s).toContain('`action` 이 `wait`·`skip` → 착수 안 함. `"{TSK} 지금은 할 일이 없다 — <action_reason>"`')
  })
  it('claimed 는 mine 을 보고, 설계 검토 대기면 멈추며, claim_scope 가 수동 --scope 를 이긴다(Y1·D21)', () => {
    expect(s).toContain('`mine` 거짓 → 이어 가지 않음')
    expect(s).toContain('"원래 PC 의 세션이 살아 있으면 먼저 끄세요"')
    expect(s).toContain('`"{TSK} 설계 검토 대기 — 「설계 승인」을 누르면 이어 간다"`')
    expect(s).toContain('claimed 범위 = 서버 `claim_scope`')
    expect(s).toContain('수동 `--scope` 무시, 그 사실 한 줄 남김')
  })
  it('구현 중 재개는 build-start 로 도는 PC 를 넘겨받는다(P7)', () => {
    expect(s).toContain('그 단계로 가기 전에 `dflow.mjs build-start <ref> --scope <범위>` 먼저 호출')
  })
  it('끝나지 않은 설계 멈춤은 push 를 맞춘 뒤 design-done 을 마저 한다(6.3 W3·L4·Y6)', () => {
    expect(s).toContain('**끝나지 않은 설계 멈춤 이어받기(계약 2.11)**')
    expect(s).toContain('`wait_pred` + 서버 단계(`.order.item.stage`) `ds`')
    expect(s).toContain('로컬이 앞서면 `git push origin <agent 브랜치>`')
    expect(s).toContain('서버에 설계 검토 대기가 없습니다')
  })
  it('승인된 설계는 설계 받기로 이어 가고, 구현자동 착수는 claim 뒤 설계를 받는다', () => {
    expect(s).toContain('**승인된 설계 이어 가기(계약 2.11)**')
    expect(s).toContain('「3」 0 의 switch 뒤, 1 전에 `orch/design.md` 「설계 받기」 수행')
    expect(s).toContain('`## 선행 기준` 절이 있을 때만')
    expect(s).toContain('### 구현자동 착수 (ready, 범위 `build`)')
  })
  it('워커는 알림 대신 결과 줄 표를 쓴다(표지 블록 안)', () => {
    const b = workerBlocks(devOrch('start')).map((x) => x.body).join('\n')
    expect(b).toContain('worker-mode.md 「설계 상태의 결과 줄」')
    expect(stripWorkerBlocks(devOrch('start'))).not.toContain('「설계 상태의 결과 줄」')
  })
})

describe('claim(claim.md)', () => {
  const c = flat(devOrch('claim'))
  it('범위 design·full 은 개발 브랜치의 사람 설계 초안을 확인한다(6.3·L5)', () => {
    expect(c).toContain('**사람 설계 초안 확인(계약 2.11, 범위 `design`·`full`)**')
    expect(c).toContain('`git cat-file -e origin/<기본브랜치>:<TASKS>/<TSK>/design.md`')
  })
  it('계약 2.11 이면 --scope 를 붙이고, CLAIM_SCOPE 를 state.json 에 적으며, exit 11 은 재시도하지 않는다', () => {
    expect(c).toContain('위 명령 끝에 `--scope <범위>`')
    expect(c).toContain('출력 `CLAIM_SCOPE <범위>` 줄 = 서버가 저장한 범위')
    expect(c).toContain('설계 관문 거부 → 아래 재시도 없이 원래 위치로 돌아가')
    expect(c).toContain('같은 쓰기에서 `scope` 기록 — claim 출력 `CLAIM_SCOPE` 값')
  })
  it('범위 build 의 설계 폴더는 격리하지 않는다', () => {
    expect(c).toContain('**범위 `build`(구현자동)의 설계 폴더**')
  })
})

describe('Design(design.md)', () => {
  const d = flat(devOrch('design'))
  it('범위 build 는 설계를 받아 곧바로 게이트를 돌고, 불통이면 design-reopen 으로 되돌린다(6.4)', () => {
    expect(d).toContain('### 설계 받기 (범위 `build`, 계약 2.11)')
    expect(d).toContain('`git merge --ff-only origin/<그 브랜치>`')
    expect(d).toContain('`git show origin/<기본브랜치>:<TASKS>/<TSK>/design.md` 로 받아 worktree 같은 파일에 덮어씀')
    expect(d).toContain('`dflow.mjs design-reopen <ref> --reason "<빠진 절>"`')
    expect(d).toContain('빠진 절을 스스로 채우지 않음')
  })
  it('build-start 에 범위를 붙이고, exit 11·12 행이 있다(Y7)', () => {
    expect(d).toContain('위 호출 = `dflow.mjs build-start <ref> --scope <범위>`')
    expect(d).toContain('반려 재작업(`orch/rework.md`)이면 방식과 무관하게 `rework`')
    expect(d).toContain('| exit 11 + stderr 끝줄 `DESIGN_GATE design_gate order_changed` |')
    // 최종 리뷰 Important 3 — 구현자동(범위 build ∧ human)만 "다시 확정되면" 을 약속하고 워크트리를 버린다
    expect(d).toContain('범위가 `build` 이고 서버 `design_mode` 가 `human` 이면')
    expect(d).toContain('그 밖(full·legacy·rework·review)이면')
    expect(d).toContain('| 그 밖의 exit 11(`DESIGN_GATE <code>`) |')
    expect(d).toContain('| exit 12(`RUNNER_ACTIVE <runner>`) |')
  })
  it('설계만 멈춤은 push 뒤 design-done 으로 끝난다(순서 고정)', () => {
    const sec = d.split('### 설계만 멈춤')[1]?.split('### 승인된 설계 고정')[0] ?? ''
    expect(sec).toContain('`build-start` **호출 금지**')
    const order = ['design.md commit 확인', 'state.json `phase` 를 `wait_review` 로 쓰고', '`progress 25 "설계 완료(검토 대기)"`',
      '`git push origin <agent 브랜치>`', '`dflow.mjs design-done <ref>` 호출', '「설계 승인」을 누르면 팀장이 이어 간다']
    const idx = order.map((o) => sec.indexOf(o))
    idx.forEach((i, k) => expect(i, order[k]).toBeGreaterThan(-1))
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    expect(sec).toContain('그 밖의 이유로 실패하면 4 안 함')
    expect(sec).toContain('`wait_pred` 를 안 쓰는 이유')
    expect(sec).toContain('옛 서버 → `dflow.mjs heartbeat <ref> --phase wait_review` 호출')
  })
  it('설계 받기 게이트 불통은 서버 단계로 갈래를 정하고, design-reopen 은 exit 로 결과가 갈린다(I-1)', () => {
    expect(d).toContain('**이미 `ip` 이상**')
    expect(d).toContain('design-reopen 호출 금지. 서버는 설계 상태 `review`, 또는 `accepted`∧단계 `dd` 일 때만 그 동사를 받음')
    expect(d).toContain('migration 0108_design_state.sql 259-262행')
    expect(d).toContain('**단계가 아직 `ds`·`dd`**: 빠진 절을 적어')
    expect(d).toContain('exit 0 → 서버가 review 는 설계 검토 대기로, human 은 사람 설계 대기로 되돌림')
    expect(d).toContain('exit 6(네트워크) → 다시 부를 수 있는 상태로 알리고 끝')
    expect(d).toContain('그 밖의 exit = 서버 거부')
  })
  it('승인된 설계는 ip 이상에서 고정이고, 「설계 받기」 게이트 불통도 같은 자리로 간다(D24·L3·I-1)', () => {
    expect(d).toContain('### 승인된 설계 고정 (D24, 계약 2.11)')
    expect(d).toContain('`## 도커 금지로 생략한 검증`')
    expect(d).toContain('Design 후퇴하려 해도 후퇴 안 함')
    expect(d).toContain('「설계 받기」 자체의 게이트 불통도 같음')
  })
  it('승인된 설계 고정은 다음 단계 앞에 있고, 다음 단계 뒤에는 절이 없다(M-2)', () => {
    const iFixed = d.indexOf('### 승인된 설계 고정')
    const iNext = d.indexOf('**다음 단계**')
    expect(iFixed).toBeGreaterThan(-1)
    expect(iNext).toBeGreaterThan(-1)
    expect(iFixed).toBeLessThan(iNext)
    expect(d.indexOf('###', iNext)).toBe(-1)
  })
  it('워커는 알림 대신 결과 줄 표를 쓴다(표지 블록 안)', () => {
    const b = workerBlocks(devOrch('design')).map((x) => x.body).join('\n')
    expect(b).toContain('worker-mode.md 「설계 상태의 결과 줄」')
  })
})

describe('설계 선행·재작업·마감', () => {
  const f = flat(devOrch('design-first'))
  it('설계 선행 멈춤은 계약 2.11 에서 design-done 을 부른다(옛 서버는 heartbeat wait_pred)', () => {
    expect(f).toContain('`dflow.mjs heartbeat <ref> --phase wait_pred` 호출')
    expect(f).toContain('계약 2.11(`dflow.mjs contract-ge 2.11` exit 0)이면 heartbeat 대신 `dflow.mjs design-done <ref>` 호출')
    expect(f).toContain('그 밖의 이유로 실패하면 4·5 안 함')
  })
  it('선행 계약 출처에 개발 브랜치의 사람 설계, 계약이 바뀌면 방식별로 되돌린다(6.4)', () => {
    expect(f).toContain('`git cat-file -e origin/<기본브랜치>:<TASKS>/<선행TSK>/design.md`')
    expect(f).toContain('`dflow.mjs design-reopen <ref> --reason "선행 계약 바뀜: <파일…>"`')
    expect(f).toContain('`human`: design.md 안 고치고')
  })
  it('재작업은 claim_scope build 면 Design 없이 승인된 설계로, build-start 는 rework(6.5)', () => {
    const r = flat(devOrch('rework'))
    expect(r).toContain('서버 `claim_scope` = `build`')
    expect(r).toContain('`"{TSK} 는 설계를 바꿔야 합니다: <이유>"`')
    expect(r).toContain('재작업 `build-start` = 방식 무관 `--scope rework`')
  })
  it('마감은 사람 커밋 충돌(Y13)과 done 의 exit 11·12 를 가른다', () => {
    const k = flat(devOrch('close'))
    expect(k).toContain('`"{TSK} 원격 agent 브랜치에 사람 커밋 — 받은 뒤 --resume 하세요"`')
    expect(k).toContain('done exit 12 (stderr 끝줄 `RUNNER_ACTIVE <runner>`)')
    expect(k).toContain('exit 11 (`DESIGN_GATE <code>`) = 서버가 완료 보고 거부')
  })
})

describe('워커 규칙(worker-mode.md·worker-prompt.md)', () => {
  const w = flat(read(WORKER_MODE))
  it('--scope 는 새 claim 의 범위이고, 잡힌 작업은 claim_scope 가 이긴다', () => {
    expect(w).toContain('팀장이 넘긴 `--scope` = 새 claim 의 범위. 이미 잡힌 작업은 서버 `claim_scope` 가 우선')
  })
  it('결과 줄 표가 「그 밖의 워커 규칙」 아래에 있어 워커가 시작 때 함께 읽는다', () => {
    const r = spawnSync('node', [join(process.cwd(), '.claude/skills/dflow-dev/scripts/sections.mjs'), join(process.cwd(), WORKER_MODE), '그 밖의 워커 규칙'], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('### 설계 상태의 결과 줄(계약 2.11)')
  })
  it('결과 줄 표는 한 행 안에 status 와 사유가 짝으로 있다(M-5)', () => {
    const rows = read(WORKER_MODE).split('\n').filter((l) => l.trim().startsWith('|'))
    const pair = (status: string, reason: string) => {
      const hit = rows.some((r) => r.includes(status) && r.includes(reason))
      expect(hit, `${status} / ${reason}`).toBe(true)
    }
    pair('`skipped`', '`<action_reason>`')
    pair('`skipped`', '`다른 PC 도는 중(<runner>)`')
    pair('`failed`', '`방식 확인 필요`')
    pair('`design_review`', '`design-done 미확인`')
    pair('`failed`', '`브랜치 갈라짐 <로컬 sha> <origin sha>`')
    pair('`skipped`', '`fetch 실패`')
    pair('`skipped`', '`push 실패`')
    pair('`skipped`', '`사람 설계 초안 있음`')
    pair('`skipped`', '`설계 관문(<code>)`')
    pair('`skipped`', '`주문이 바뀜`')
    pair('`skipped`', '`design-reopen 미확인`')
    pair('`failed`', '`design-reopen 거부(<code>)`')
    pair('`failed`', '`design-done 거부(<code>)`')
    pair('`failed`', '`design-done <exit>`')
    pair('`failed`', '`설계 게이트 불통(구현 중)`')
    pair('`failed`', '`설계 변경 필요 — <이유>`')
    pair('`failed`', '`원격 agent 브랜치에 사람 커밋 — 받은 뒤 --resume`')
    pair('`failed`', '`완료 보고 거부(<code>)`')
    // 최종 리뷰 Important 3(12절 Y7): build-start 의 order_changed 는 범위로 가른다 — 구현자동(범위 build ∧ human)은
    // design_reopened 로 끝나 팀장이 워크트리를 지우고, full·legacy·rework·review 는 skipped 로 남는다
    const changed = rows.filter((r) => r.includes('`order_changed`'))
    expect(changed.some((r) => r.includes('`design_reopened`') && r.includes('`주문이 바뀜`') && r.includes('`human`'))).toBe(true)
    expect(changed.some((r) => r.includes('`skipped`') && r.includes('`주문이 바뀜`') && !r.includes('방식과 무관'))).toBe(true)
  })
  it('worker-prompt: SCOPE 는 늘 --scope 로 넘기고, 서버 쓰기 범위와 결과 표에 새 동사·status 가 있다', () => {
    const wp = flat(read('.claude/skills/dflow-team/references/worker-prompt.md'))
    expect(wp).toContain('| `{SCOPE_FLAG}` | `SCOPE` | 값 있으면 늘 `--scope <SCOPE>`')
    expect(wp).toContain('`/dflow-dev {ID8} --worker {MODEL_FLAG} {SCOPE_FLAG}`')
    expect(wp).toContain('`design-done {ID8}`·`design-reopen {ID8} --reason …`')
    expect(wp).toContain('| `design_reopened` |')
    expect(wp).not.toContain('design_missing')
  })
})

describe('다른 스킬', () => {
  it('승인 스윕은 wait_review 브랜치를 후보로 잡지 않는다(문서와 스크립트가 같은 필터)', () => {
    const f = 'select(.phase != "merged" and .phase != "wait_pred" and .phase != "wait_review")'
    // 문서의 jq 필터는 references/sweep-scan.md 로, 스크립트는 sweep-check.mjs(node)로 바뀌었다 — 같은 세 phase 를 거른다
    expect(read('.claude/skills/dflow-merge/references/sweep-scan.md')).toContain(f)
    expect(read('.claude/skills/dflow-merge/scripts/sweep-check.mjs')).toContain("phase === 'merged' || phase === 'wait_pred' || phase === 'wait_review'")
  })
  it('팀장: 범위 인자를 받지 않고 작업마다 서버 판단(action)을 포인터 SCOPE 로 넘긴다(D27)', () => {
    const team = flat(read('.claude/skills/dflow-team/SKILL.md'))
    expect(team).toContain('- **설계 방식은 인자 아님**(계약 2.11, 설계 상태 스펙 D27).')
    expect(team).not.toContain('"설계만"·"설계까지" → `design`')
    expect(team).toContain('`team.start`(backend, slots, until, wp, scope)')
    expect(team).toContain('`scope` = 늘 `server`')
    expect(team).toContain('SCOPE=<full|design|build>')
    expect(team).toContain('`SCOPE` = 그 주문의 서버 판단 `action` (계약 2.11)')
    expect(team).toContain('--require-tag agent --lead --until')
    expect(team).not.toContain('scope.md')
    expect(existsSync(join(process.cwd(), '.claude/skills/dflow-team/references/scope.md'))).toBe(false)
    expect(read('.claude/skills/dflow-team/references/help.md')).not.toMatch(/설계만\|구현부터|개발자동/)
    expect(read('.claude/skills/dflow-team/scripts/lead-state.mjs')).toContain("scope=${val(st?.scope, '-')}")
  })
  it('팀장: 결과 표·설계 사전 검사·build 목록·금지 예외 — 긴 절차는 design-state.md(6.2·6.3·6.7·D22·Y11·L11)', () => {
    const team = flat(read('.claude/skills/dflow-team/SKILL.md'))
    // 결과 status 표의 나머지 행은 references/result-handling.md 로 옮겨졌다
    const rh = flat(read('.claude/skills/dflow-team/references/result-handling.md'))
    expect(rh).toContain('| `design_review`(설계 검토 대기로 멈춤) | 해제 | 없음 |')
    expect(rh).toContain('| `design_reopened`(설계 사람에게 되돌림, 계약 2.11) | 해제 | 없음 | 미commit 변경 있어도 지움')
    expect(team).toContain('`주문이 바뀜`')
    expect(team).not.toContain('design_reopened`(설계를 사람에게 되돌렸거나 주문이 바뀜')
    expect(team).toContain('**설계 사전 검사** (계약 2.11)')
    expect(team).toContain('**`build` (계약 2.11) = 「설계 승인」 된 작업 목록.**')
    expect(team).toContain('`RETRY_DUE`')
    expect(team).toContain('예외 넷:')
    expect(team).toContain('| `references/design-state.md` |')
    expect(rh).toContain('`design-done 미확인` 이면 `references/design-state.md` 「3」 먼저')
    // D22·Y9 — 기상 블록·감시 루프도 poll 과 같은 WP 범위를 watch 에 넘긴다
    expect(team).toContain("[--until '<UNTIL>'] [--wp <WP-02,dict/WP-03>] --tm")
    expect(team).toContain("--until-label '<UNTIL_LABEL>' [--wp <WP-02,dict/WP-03>]")
    expect(team).toContain('`wake.mjs`·`tick.mjs` 에도 같은 값 `--wp` 로 넘김')
    const ds = flat(read('.claude/skills/dflow-team/references/design-state.md'))
    expect(ds).toContain('poll 과 같은 거르기(태그 `agent`, `wake.mjs` 의 `--wp`)로 좁힌')
    // 6.2 — fetch 실패면 되돌리지도 띄우지도 않고 그 기상을 넘긴다
    expect(ds).toContain("git -C '<MAIN>' fetch -q origin || echo FETCH_FAIL")
    expect(ds).toContain('이 기상에 `action` 있는 후보 하나도 안 띄움 (모르는 채 띄우지 않음, 제외도 안 함, 다음 기상에 다시 봄)')
    // 6.3 — design-done 미확인은 팀장이 마저 하고, 실패하면 워크트리를 남겨 「멈춤」 에 올린다
    expect(ds).toContain('worktree 지우기 전에 `node .claude/skills/dflow-work/scripts/dflow.mjs design-done <id8>` 호출 (설계 멈춤 이어받기, 스펙 6.3)')
    expect(ds).toContain('worktree 안 지우고 `parked` 로 둠. 다음 기상에 다시 호출. 「멈춤」 표에 사유 `설계 멈춤 미완료`')
    expect(ds).toContain('## 1. 설계 사전 검사')
    expect(ds).toContain('dflow.mjs design-reopen <id8> --reason')
    expect(ds).toContain('`사람 설계 초안 있음 — 방식을 구현자동으로 바꾸거나 초안을 지우라`')
    expect(ds).toContain('「설계 승인」을 누르면 다음 TICK 에 팀장이 구현을 이어 간다')
    expect(ds).toContain('`WARN_RETRY`')
    expect(ds).toContain('`git worktree remove --force <워크트리>`')
    // I-1 — build 목록도 고아 스캔과 같은 RETRY_DUE·WARN_RETRY 신호로 fetch·push 실패의 되풀이를 막는다(EXCLUDE_TEMP 단독 금지)
    expect(ds).toContain('`EXCLUDE_TEMP` 는 만료 없어 가두면 다른 사유(설계 관문 등)까지 영구히 막음 → 쓰지 않음')
    expect(ds).toContain('`WARN_RETRY` → 재개 대상에 안 넣고 「멈춤」(사유 `fetch·push 3회 연속 실패`)')
    expect(ds).toContain('`RETRY_DUE` → 재개 대상에 더함 (고아 스캔과 같은 30분 신호)')
    expect(ds).toContain('재시작 뒤 build 목록 주문은 영구 제외가 비어')
    // 최종 리뷰 Important 1 — 설계 관문·주문이 바뀜·다른 PC 도는 중 skip 도 30분 뒤 다시 띄운다(3회 멈춤은 fetch·push 에만)
    expect(ds).toContain('`BUILD_RETRY_DUE` → 재개 대상에 더함')
    expect(ds).toContain('`RETRY_DUE`·`BUILD_RETRY_DUE` 인 것은 침 → 재시도 기한 되면 그 TICK 안 건너뜀')
    expect(ds).not.toContain('다른 사유의 skip 은 서버 상태가 바뀌어 이 목록을 벗어난다')
    expect(ds).not.toContain('옛 서버만 build-start exit 12 를 받아')
  })
  it('팀장: 이어 가기는 resume.md 「서버 판단 확인」 한 곳이 막고, 원격 재개는 승인 대상뿐이다(Y3·Y5·Y8·Y9·Y10·Y12·D16·L2)', () => {
    const team = flat(read('.claude/skills/dflow-team/SKILL.md'))
    const r = flat(read('.claude/skills/dflow-team/references/resume.md'))
    expect(r).toContain('## 서버 판단 확인 (계약 2.11)')
    expect(r).toContain('**띄우지 않게 막기만 함**')
    expect(r).toContain('새로 여는 길 = **승인** 대상 원격 재개 하나')
    expect(r).toContain('`수동 세션 점유`')
    expect(r).toContain('- **승인** (계약 2.11)')
    expect(r).toContain('`-B` 로 안 덮고 로컬 branch 로 만듦')
    // Y5 — 재개 전에도 선행 반영 사전 검사를 하고, 미반영이면 다음 기상에 다시 본다
    expect(r).toContain('`NOT_REFLECTED` 면 이번 기상 안 띄움 (12절 Y5 — 다음 기상에 다시 봄)')
    // Y10 — 좌석 「이어서 시작」 은 skip 이어도 띄우고, 숨김(거부)은 설계 검토 대기에만
    expect(r).toContain('| 대상이 요청·지목 | 띄움 — `action` 이 `skip`·`wait` 이어도 (사람의 명시 요청, 12절 Y10·Y12.')
    expect(r).toContain('| `design_state` = `review` | 안 띄움. 「멈춤」 에 안 올림')
    expect(team).toContain('`design_state` 가 `review` 면 띄우지 않고 "「설계 승인」 뒤에 이어 갑니다" 한 줄 알림. 그 밖에는 서버 판단이 `skip` 이어도 띄움.')
    // Y12 — 사람의 지목은 action 이 아니라 mine 만 본다(mine 거짓 행 → 요청·지목 행 → action 행 순서)
    const rowMine = r.indexOf('| `mine` 거짓 |'), rowAsk = r.indexOf('| 대상이 요청·지목 |'), rowWait = r.indexOf('| `action` = `wait` |')
    expect(rowMine).toBeGreaterThan(-1)
    expect(rowAsk).toBeGreaterThan(rowMine)
    expect(rowWait).toBeGreaterThan(rowAsk)
    expect(flat(read('.claude/skills/dflow-team/references/args.md'))).toContain('계약 2.11 서버에서 서버 `mine` 이 거짓이면(다른 PC 가 30분 안에 돌렸거나 다른 신원이 잡음) 안 띄움')
    // L2 — 「멈춤」 사유를 마지막 완료 보고로 가른다
    expect(r).toContain('[.reports[]? | select(.kind == "completion")] | last | .review_action // "-"')
    expect(r).toContain('`reject`(반려·재작업 요청)면 `runner` 없을 때 `재작업 대기 — 사람이 /dflow-dev 로 재작업을 돌린다`, 있을 때 `재작업 중(<runner>)`')
    expect(r).toContain('그 밖 = `워크트리 없음 — 구현 중`')
    const rs = flat(read('.claude/skills/dflow-team/references/restart.md'))
    expect(rs).toContain('| 4-2 | `local_phase=wait_review` |')
    expect(rs).toContain('`설계 멈춤 미완료')
    expect(rs).not.toContain('scope.md')
    const da = flat(read('.claude/skills/dflow-team/references/design-ahead.md'))
    expect(da).toContain('서버가 claimed·`mine`·단계 `dd` 로 확인한 것만 셈')
    expect(da).toContain('`<id8> 선행 주문 없음: <ref>`')
    // D16 — 설계만 하는 설계 검토 작업은 설계 선행 상한에 세지 않는다
    expect(da).toContain('설계 검토(`review`) 작업의 설계 선행 = 이 상한과 무관 — poll 이 `action=design` 으로 곧바로 줌')
    expect(da).toContain('구현자동(`human`) = 서버가 선행 풀릴 때까지 `wait` 로 둬 후보에 안 옴')
    expect(team).toContain('`action` 이 `design` 이면 `deps_unmet` 있어도 선행 대기에 안 넣음 (설계만 함, 스펙 6.6)')
  })
})
