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
  return spawnSync('sh', ['-c', code], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: home, NODE_ENV: process.env.NODE_ENV } })
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
