// poll.sh 선행 대기(--exclude-wait) — 일시 제외(--exclude-temp)보다 오래 붙든다(2026-09-24: 선행 미충족 Task 를
// 30분마다 풀어 같은 Task 를 13~16회 다시 검사했다). 가짜 dflow.sh 로 몇 번째 주기에 풀리는지 실제로 돌려 본다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const POLL_SH = join(process.cwd(), '.claude/skills/dflow-poll/scripts/poll.sh')
const ENV = {
  PATH: process.env.PATH ?? '', HOME: '/nonexistent',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}

let tmp: string
let cfg: string
let bin: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-poll-wait-')))
  cfg = join(tmp, 'cfg'); bin = join(tmp, 'bin')
  mkdirSync(cfg); mkdirSync(bin)
  writeFileSync(join(cfg, '.dflow'), 'api_base=https://p.test\nproject_id=11111111-1111-4111-8111-111111111111\nrelease_branch=main\n')
  writeFileSync(join(cfg, '.dflow.local'), 'pats=dflow_pat_TEST_token\ndev_branch=main\n')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

// list 는 ready(RD) 줄들을 돌려주고 부른 횟수를 센다. poll 은 주기마다 list 를 한 번 부른다.
function stub(rows: string[]) {
  const f = join(bin, 'dflow.sh')
  writeFileSync(f, `#!/bin/sh
case "$1" in
  list) echo x >> '${join(tmp, 'calls')}'; printf '%s\\n' ${rows.map((r) => `'${r}'`).join(' ')} ;;
  *) exit 0 ;;
esac
`)
  chmodSync(f, 0o755)
  return f
}
const row = (n: number, id8: string) => `${n}\tRD\tx\t${id8}\t작업${id8}`
const calls = () => readFileSync(join(tmp, 'calls'), 'utf8').trim().split('\n').length

function poll(args: string[], rows: string[]) {
  const r = spawnSync('sh', [POLL_SH, '--interval', '0', '--until', 'none', ...args], {
    cwd: cfg, encoding: 'utf8', timeout: 20000,
    env: { ...ENV, DFLOW_SH: stub(rows), DFLOW_WATCH: '0', DFLOW_CONFIG_DIR: cfg } as NodeJS.ProcessEnv,
  })
  return { code: r.status, out: (r.stdout ?? '').trim(), err: r.stderr ?? '' }
}

describe('poll.sh --exclude-wait(선행 대기)', { timeout: 30000 }, () => {
  it('일시 제외가 풀려도 선행 대기는 그대로 붙든다', () => {
    const r = poll(['--exclude-temp', 'aaaa1111', '--recheck-cycles', '1', '--exclude-wait', 'bbbb2222', '--wait-cycles', '5'],
      [row(1, 'aaaa1111'), row(2, 'bbbb2222')])
    expect(r.code, r.err).toBe(0)
    expect(r.out).toBe('1\taaaa1111\t작업aaaa1111')
    expect(calls()).toBe(2)
    expect(r.err).toContain('일시성 제외 해제(재검사 유도): aaaa1111')
    expect(r.err).not.toContain('선행 대기 해제')
  })

  it('선행 대기는 --wait-cycles 주기가 지난 뒤에야 풀려 다시 돌려준다(안전망 재검사)', () => {
    const r = poll(['--exclude-wait', 'bbbb2222', '--wait-cycles', '3', '--recheck-cycles', '1'], [row(2, 'bbbb2222')])
    expect(r.code, r.err).toBe(0)
    expect(r.out).toBe('2\tbbbb2222\t작업bbbb2222')
    expect(calls()).toBe(4)
    expect(r.err).toContain('선행 대기 해제(안전망 재검사): bbbb2222')
  })

  it('--wait-cycles 는 숫자만 받는다', () => {
    const r = poll(['--wait-cycles', 'x'], [])
    expect(r.code).toBe(2)
    expect(r.err).toContain('--exclude-wait id8,id8')
  })
})
