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
  it('해소 규약 R1~R9, blocked 기준, 금지, 게이트, 결과 줄 표가 있다', () => {
    for (const r of ['| R1 |', '| R2 |', '| R3 |', '| R4 |', '| R5 |', '| R6 |', '| R7 |', '| R8 |', '| R9 |']) expect(PROMPT).toContain(r)
    expect(PROMPT).toContain('## 해소 규약')
    expect(PROMPT).toContain('### blocked 로 멈추는 경우')
    expect(PROMPT).toContain('## 게이트')
    expect(PROMPT).toContain('**기준선 대비 신규 실패 0 + 시험 총수가 하한(개발 브랜치 총수 + (MERGE_HEAD 단독 총수 − merge-base\n총수) − 계획 삭제 수) 이상**')
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
  // 2026-09-25: 해소 워커가 worker-prompt.md 전체(15K자)를 cat 하던 것을 쓰는 절만 sed 로 읽게 줄였다
  it('worker-prompt.md 를 통째로 읽지 않고 「0」「1」·「2」「3」·「7-1」 을 쓰는 자리에서 절 범위로 읽는다', () => {
    expect(PROMPT).not.toMatch(/cat [^\n]*worker-prompt\.md/)
    const WP = join(ROOT, '.claude/skills/dflow-team/references/worker-prompt.md')
    const cmds = [...PROMPT.matchAll(/sed -n '([^']+)' \{MAIN_CHECKOUT\}\/\.claude\/skills\/dflow-team\/references\/worker-prompt\.md/g)].map((m) => m[1])
    expect(cmds).toHaveLength(3)
    const got = cmds.map((c) => execFileSync('sed', ['-n', c, WP], { encoding: 'utf8' }))
    expect(got[0]).toMatch(/^## 0\. git 호출 규칙/)
    expect(got[0]).toContain('## 1. 격리 확인')
    expect(got[0]).not.toContain('## 2. 좌석 식별')
    expect(got[1]).toMatch(/^## 2\. 좌석 식별/)
    expect(got[1]).toContain('## 3. 워크트리 부트스트랩')
    expect(got[1]).not.toContain('## 4. 실행')
    expect(got[2]).toMatch(/^## 7-1\. 문제 기록/)
    expect(got[2]).not.toContain('## 8.')
  })
  it('해소 머지 절차는 dflow-merge 의 references/resolve.md 「해소 머지」 를 가리킨다', () => {
    expect(PROMPT).toContain('`.claude/skills/dflow-merge/references/resolve.md` 「해소 머지」')
    expect(PROMPT).not.toContain('`/dflow-merge` 「해소 머지」')
  })
  it('H(워커 자동 재시작)의 대상이 아니라고 적는다', () => {
    expect(PROMPT).toContain('워커 자동 재시작(H)의 대상이 아니다')
  })
})

describe('resolve-prompt.md 「게이트」 판정 블록 — 하한 = 개발 브랜치 + (MERGE_HEAD 단독 − merge-base) − 계획 삭제(2026-09-24)', () => {
  type V = number | string
  const gate = ({ dev, head, base, drop = 0, total, fail }: { dev: V, head: V, base: V, drop?: V, total: V, fail: V }) => {
    const sec = PROMPT.slice(PROMPT.indexOf('## 게이트'), PROMPT.indexOf('## 기록'))
    const m = sec.match(/```bash\n([\s\S]*?)```/)
    if (!m) throw new Error('게이트 블록을 찾지 못했다')
    const put = (s: string, k: string, v: V) => {
      if (!s.includes(k)) throw new Error(`자리표시 없음: ${k}`)
      return s.replace(k, `'${v}'`)
    }
    let script = put(m[1], "'<개발 브랜치 총수>'", dev)
    script = put(script, "'<MERGE_HEAD 단독 총수>'", head)
    script = put(script, "'<merge-base 총수>'", base)
    script = put(script, "'<계획 삭제 수, 없으면 0>'", drop)
    script = put(script, "'<머지 결과 총수>'", total)
    script = put(script, "'<기준선 대비 신규 실패 수>'", fail)
    return spawnSync('sh', ['-c', script], { encoding: 'utf8' }).stdout.trim()
  }
  it('회귀(dmes-standard 실측 모양): 개발 브랜치 1373 · 브랜치 687(merge-base 624, 63건 추가) — 브랜치 시험 63건이 사라지면 떨어진다', () => {
    // 옛 식 max(개발 브랜치, MERGE_HEAD 단독) = 1373 은 결과 1373 을 통과시켰다
    expect(1373 >= Math.max(1373, 687)).toBe(true)
    expect(gate({ dev: 1373, head: 687, base: 624, total: 1373, fail: 0 })).toBe('GATE_FAIL new=0 total=1373 need=1436')
    expect(gate({ dev: 1373, head: 687, base: 624, total: 1436, fail: 0 })).toBe('GATE_PASS need=1436 total=1436')
  })
  it('결과 총수가 MERGE_HEAD 단독 총수보다 적으면 개발 브랜치 총수를 넘어도 실패(옛 계약 유지)', () => {
    expect(gate({ dev: 10, head: 12, base: 10, total: 11, fail: 0 })).toBe('GATE_FAIL new=0 total=11 need=12')
  })
  it('개발 브랜치가 merge-base 뒤에 시험을 지웠으면 하한도 그만큼 낮다', () => {
    // merge-base 10, 개발 브랜치가 2건 지워 8, 브랜치가 2건 더해 12 → 머지 결과 10 이 맞다
    expect(gate({ dev: 8, head: 12, base: 10, total: 10, fail: 0 })).toBe('GATE_PASS need=10 total=10')
  })
  it('브랜치가 스스로 지운 시험은 (MERGE_HEAD − merge-base) 에 이미 빠져 있다', () => {
    expect(gate({ dev: 20, head: 9, base: 10, total: 19, fail: 0 })).toBe('GATE_PASS need=19 total=19')
  })
  it('계획 삭제 수만큼 하한이 낮아진다', () => {
    expect(gate({ dev: 100, head: 30, base: 20, drop: 3, total: 107, fail: 0 })).toBe('GATE_PASS need=107 total=107')
    expect(gate({ dev: 100, head: 30, base: 20, drop: 0, total: 107, fail: 0 })).toBe('GATE_FAIL new=0 total=107 need=110')
  })
  it('신규 실패가 있으면 총수와 무관하게 실패', () => {
    expect(gate({ dev: 10, head: 12, base: 10, total: 20, fail: 1 })).toBe('GATE_FAIL new=1 total=20 need=12')
  })
  it('fail-closed: 값이 비었거나 숫자가 아니면(자리표시 남음 포함) 통과시키지 않는다', () => {
    expect(gate({ dev: 10, head: 12, base: '', total: 99, fail: 0 })).toBe('GATE_FAIL invalid base_total=')
    expect(gate({ dev: 10, head: 12, base: '<merge-base 총수>', total: 99, fail: 0 })).toMatch(/^GATE_FAIL invalid base_total=/)
    expect(gate({ dev: 10, head: 12, base: 10, drop: '-3', total: 99, fail: 0 })).toBe('GATE_FAIL invalid planned_drop=-3')
    expect(gate({ dev: 10, head: 12, base: 10, total: 99, fail: 'x' })).toBe('GATE_FAIL invalid new_fail=x')
  })
  it('기준선 절이 MERGE_HEAD 단독과 merge-base 를 재고, 명령 치환 없이 merge-base 를 단독으로 부른다', () => {
    const sec = PROMPT.slice(PROMPT.indexOf('## 3. 기준선'), PROMPT.indexOf('## 4. 해소 머지'))
    expect(sec).toContain("git branch -r --list 'origin/agent/{ID8}-*'")
    expect(sec).toContain("git merge-base '<BASE>' '<머지 대상>'")
    expect(sec).toContain("git switch --detach '<MB>'")
    expect(sec).toContain('**merge-base 총수**')
    const block = sec.match(/```bash\n([\s\S]*?)```/)?.[1] ?? ''
    expect(block).toContain('git merge-base')
    expect(block).not.toMatch(/\$\(\s*git /)
    expect(sec).toContain('스위트(또는 모듈·시험 파일)별로도')
  })
  it('통과 문구·resolution.md 기록 줄·결과 줄이 새 식을 말한다', () => {
    expect(PROMPT).not.toContain('max(개발 브랜치 총수, MERGE_HEAD 단독 총수)')
    expect(PROMPT).toContain('`게이트: 개발 브랜치 <dev_total> · MERGE_HEAD 단독 <head_total> · merge-base <base_total> · 계획 삭제 <planned_drop> · 하한 <need> · 결과 <total>`')
    expect(PROMPT).toContain('tests=<통과/총수> need=<하한>')
    expect(readFileSync(join(ROOT, '.claude/skills/dflow-merge/SKILL.md'), 'utf8')).toContain('tests=<통과/총수> need=<하한>`')
    // 계획 삭제는 이 브랜치가 이미 지운 시험을 넣지 않는다(이중 차감 방지)
    expect(PROMPT).toContain('이 브랜치 커밋이 이미 지운 시험은 넣지 않는다')
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

describe('리뷰 minor(2026-09-23) — 결과 줄 전체 sha, blocked RUNNING 의 전제', () => {
  it('결과 줄 head 는 전체 sha 이고 팀장 조상 확인도 전체 sha 로 한다', () => {
    const merge = readFileSync(join(ROOT, '.claude/skills/dflow-merge/SKILL.md'), 'utf8')
    const mc = readFileSync(join(ROOT, '.claude/skills/dflow-team/references/merge-conflict.md'), 'utf8')
    expect(PROMPT).toContain('`head` 칸에 push 한 머지 커밋의 **전체 sha**')
    expect(merge).toContain('`RESOLVE_PUSHED <머지 커밋 전체 sha> base=')
    expect(merge).not.toContain('git rev-parse --short HEAD~1')
    expect(mc).toContain('`<결과 줄 head>` 는 결과 줄 넷째 칸의 **전체 sha** 다')
  })
  it('resolve-decide.sh 의 blocked RUNNING 은 무응답 규칙에 기댄다고 적는다', () => {
    expect(readFileSync(DECIDE, 'utf8')).toContain('팀장의 무응답 규칙')
  })
})
