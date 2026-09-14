import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOOK = join(process.cwd(), 'kit/hooks/heartbeat.sh')
let tmp: string, repo: string, home: string, log: string

function git(...args: string[]) { execFileSync('git', args, { cwd: repo, stdio: 'ignore' }) }
function run(cwd = repo, env: Record<string, string> = {}) {
  execFileSync('sh', [HOOK], {
    cwd, input: JSON.stringify({ cwd, tool_name: 'Bash' }),
    env: { PATH: process.env.PATH ?? '', HOME: home, CURL: join(tmp, 'fakecurl'), NODE_ENV: process.env.NODE_ENV, ...env },
    stdio: ['pipe', 'ignore', 'ignore'],
  })
  // 백그라운드 curl 이 로그를 쓸 시간을 준다
  // 브리프 원안은 0.3 — 이 실행 환경에서는 오차 없이 재현되는 350ms+ 지연이 실측되어(스레드 폴링 타이밍
  // 아님, 여러 차례 독립 측정 동일) 0.3 로는 두 케이스가 확정적으로 깨진다. 0.8 로 올려 여유를 둔다.
  execFileSync('sh', ['-c', 'sleep 0.8'])
}
const sent = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [])

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hb-'))
  repo = join(tmp, 'repo'); home = join(tmp, 'home'); log = join(tmp, 'curl.log')
  mkdirSync(repo); mkdirSync(home)
  writeFileSync(join(tmp, 'fakecurl'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\n`, { mode: 0o755 })
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(repo, '.env'), 'DFLOW_API_BASE=https://x.test\nDFLOW_PATS=dfl_u_abc_secret\n')
  mkdirSync(join(repo, 'docs/tasks/TSK-01'), { recursive: true })
  writeFileSync(join(repo, 'docs/tasks/TSK-01/state.json'), JSON.stringify({ tsk: 'TSK-01', order: '22222222-2222-4222-8222-222222222222', phase: 'build' }))
  writeFileSync(join(repo, 'README'), 'x'); git('add', '.'); git('commit', '-q', '-m', 'init')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('heartbeat.sh — 스펙 §4-2', () => {
  it('.dflow-agent 가 있으면 그 값으로 order 의 heartbeat 를 보낸다(phase 는 state.json)', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    run()
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toContain('/api/v1/agent/work/22222222-2222-4222-8222-222222222222/heartbeat')
    expect(sent()[0]).toContain('"agent":"hong/mbp/w2"')
    expect(sent()[0]).toContain('"phase":"build"')
    expect(sent()[0]).toContain('--max-time 1.5')
  })
  it('.dflow-agent 가 없고 브랜치가 agent/ 로 시작하면 claude-<host> 로 보낸다', () => {
    git('switch', '-q', '-c', 'agent/abcd1234-slug')
    run()
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toMatch(/"agent":"claude-[a-z0-9-]+"/)
  })
  it('.dflow-agent 가 없고 기본 브랜치면 아무것도 보내지 않는다(팀장 세션)', () => {
    run(); expect(sent()).toHaveLength(0)
  })
  it('parked 는 침묵한다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/parked\n')
    run(); expect(sent()).toHaveLength(0)
  })
  it('진행 중 state.json 이 없으면(전부 reported/merged) 보내지 않는다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, 'docs/tasks/TSK-01/state.json'), JSON.stringify({ tsk: 'TSK-01', order: '2'.repeat(8), phase: 'merged' }))
    run(); expect(sent()).toHaveLength(0)
  })
  it('60초 절제: 두 번 연속 실행하면 한 번만 보낸다, 절제 파일이 오래되면 다시 보낸다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    run(); run()
    expect(sent()).toHaveLength(1)
    const stamp = join(home, '.dflow/hb/22222222-2222-4222-8222-222222222222')
    const old = new Date(Date.now() - 120_000)
    utimesSync(stamp, old, old)
    run()
    expect(sent()).toHaveLength(2)
  })
  it('.env 에 API_BASE 나 PAT 가 없으면 보내지 않는다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, '.env'), 'DFLOW_API_BASE=https://x.test\n')
    run(); expect(sent()).toHaveLength(0)
  })
  it('git 리포가 아닌 cwd 에서는 조용히 끝난다', () => {
    const plain = join(tmp, 'plain'); mkdirSync(plain)
    run(plain); expect(sent()).toHaveLength(0)
  })
})
