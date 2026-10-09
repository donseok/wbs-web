// tests/skills/dflow-poll-actions.test.ts — poll.sh 가 서버 판단(action·mine, 계약 2.11)으로 ready 를 고른다(설계 상태 스펙 12절 Y4).
// 가짜 dflow.sh 로 실제 poll.sh 를 돌린다(dflow-poll-exclude-wait.test.ts 와 같은 방식).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const POLL_SH = join(process.cwd(), '.claude/skills/dflow-poll/scripts/poll.mjs')
const ENV = { PATH: process.env.PATH ?? '', HOME: '/nonexistent', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
let tmp: string, cfg: string, bin: string
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-poll-act-')))
  cfg = join(tmp, 'cfg'); bin = join(tmp, 'bin'); mkdirSync(cfg); mkdirSync(bin)
  writeFileSync(join(cfg, '.dflow'), 'api_base=https://p.test\nproject_id=11111111-1111-4111-8111-111111111111\nrelease_branch=main\n')
  writeFileSync(join(cfg, '.dflow.local'), 'pats=dflow_pat_TEST_token\ndev_branch=main\n')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

// list 는 받은 인자를 args 파일에 적고 rows 를 돌려준다. show 가 불리면 shows 에 적는다(새 서버 행은 불리면 안 된다).
function stub(rows: string[]) {
  const f = join(bin, 'dflow.sh')
  writeFileSync(f, `#!/bin/sh
case "$1" in
  list) printf '%s\\n' "$*" >> '${join(tmp, 'args')}'; printf '%s\\n' ${rows.map((r) => `'${r}'`).join(' ')} ;;
  show) echo "$2" >> '${join(tmp, 'shows')}'; printf '{"order":{"id":"x","item":{"tags":["agent"],"external_ref":"M/TSK-02-01"}}}' ;;
  *) exit 0 ;;
esac
`)
  chmodSync(f, 0o755)
  return f
}
function poll(args: string[], rows: string[]) {
  const r = spawnSync('node', [POLL_SH, '--interval', '0', '--until', 'none', ...args], {
    cwd: cfg, encoding: 'utf8', timeout: 20000,
    env: { ...ENV, DFLOW_SH: stub(rows), DFLOW_WATCH: '0', DFLOW_CONFIG_DIR: cfg } as unknown as NodeJS.ProcessEnv,
  })
  return { code: r.status, out: (r.stdout ?? '').trim(), err: r.stderr ?? '' }
}
const listArgs = () => readFileSync(join(tmp, 'args'), 'utf8')
const shows = () => (existsSync(join(tmp, 'shows')) ? readFileSync(join(tmp, 'shows'), 'utf8').trim().split('\n') : [])
const rowNew = (n: number, id8: string, action: string, mine: '1' | '0') => `${n}\tRD\tx\t${id8}\t작업${id8}\t${action}\t${mine}`
const rowOld = (n: number, id8: string) => `${n}\tRD\tx\t${id8}\t작업${id8}\t\t`

describe('poll.sh — 서버 판단으로 고른다(Y4)', { timeout: 30000 }, () => {
  it('새 서버: action ∈ full·design·build ∧ mine=1 인 RD 만, 4번째 칸에 action, show 를 부르지 않는다', () => {
    const r = poll(['--require-tag', 'agent'], [rowNew(1, 'aaaaaaaa', 'wait', '1'), rowNew(2, 'bbbbbbbb', 'design', '1'), rowNew(3, 'cccccccc', 'full', '0')])
    expect(r.code, r.err).toBe(0)
    expect(r.out).toBe('2\tbbbbbbbb\t작업bbbbbbbb\tdesign')
    expect(shows()).toEqual([])
  })
  it('--actions full 이면 design·build 는 고르지 않는다(/dflow-poll 단독)', () => {
    const r = poll(['--actions', 'full'], [rowNew(1, 'aaaaaaaa', 'design', '1'), rowNew(2, 'bbbbbbbb', 'full', '1')])
    expect(r.out).toBe('2\tbbbbbbbb\t작업bbbbbbbb\tfull')
  })
  it('옛 서버(6열 빈 값)는 종전대로 — show 로 거르고 3칸 줄을 낸다', () => {
    const r = poll(['--require-tag', 'agent'], [rowOld(1, 'aaaaaaaa')])
    expect(r.out).toBe('1\taaaaaaaa\t작업aaaaaaaa')
    expect(shows()).toEqual(['aaaaaaaa'])
  })
  it('거르기와 --lead 를 list 에 넘긴다(WP 는 정규화해서)', () => {
    poll(['--require-tag', 'agent', '--wp', 'WP-02', '--lead'], [rowNew(1, 'aaaaaaaa', 'full', '1')])
    expect(listArgs()).toContain('list --scope assigned --require-tag agent --wp WP-2 --lead')
  })
  it('--actions 에 모르는 값은 사용법(exit 2)', () => {
    expect(poll(['--actions', 'weird'], []).code).toBe(2)
    // 고를 판단이 하나도 없으면(빈 값·쉼표뿐) 아무것도 고르지 않는 조용한 감시가 되므로 사용법으로 보낸다(deferred A8)
    expect(poll(['--actions', ''], []).code).toBe(2)
    expect(poll(['--actions', ','], []).code).toBe(2)
  })
})
