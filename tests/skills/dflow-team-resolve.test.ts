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
