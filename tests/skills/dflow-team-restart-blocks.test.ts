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
    const st = join(w, 'docs/tasks/TSK-01/state.json')
    if (phase) writeFileSync(st, JSON.stringify({ phase })); else rmSync(st, { force: true })
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
