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
const env = () => ({ PATH: process.env.PATH ?? '', HOME: home, NODE_ENV: process.env.NODE_ENV })

// 2026-09-24: 이 블록은 enabledPlugins 를 모으는 if/for(팀원 전용 설정)부터 시작해 $P 를 정의한 뒤 LIM/jq 로 잇는다.
// jq 호출이 여러 줄이라 [^\n]* 로는 못 자르므로 [\s\S]*? 로 끝 문자열까지 그대로 캡처한다.
function settingsLines(): string {
  const m = B().match(/(if \[ "\$\{DFLOW_WORKER_PLUGINS-\}" = keep \][\s\S]*?> "\$LIM\/<id8>\.settings\.json")/)
  if (!m) throw new Error('statusLine 설정 줄을 찾지 못했다')
  return m[1].replaceAll('<id8>', 'abcd1234')
}
function makeSettings(extraEnv: Record<string, string> = {}) {
  const r = spawnSync('sh', ['-c', settingsLines()], { encoding: 'utf8', env: { ...env(), ...extraEnv } })
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
    expect(s.enabledPlugins).toBeUndefined() // 켜진 플러그인이 없으면(설정 파일도 없으면) 아예 넣지 않는다
  })
  // 2026-09-24: 팀원 전용 설정(enabledPlugins 를 false 로 덮기). 목록을 하드코딩하지 않고 PC 의 설정 파일에서
  // 켜진 플러그인만 모은다.
  it('~/.claude/settings.json 의 켜진 플러그인만 모아 전부 false 로 덮고, 이미 꺼진 것은 넣지 않는다', () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'foo@bar': true, 'baz@qux': false } }))
    const s = makeSettings()
    expect(s.enabledPlugins).toEqual({ 'foo@bar': false })
  })
  it('설정 파일이 깨져 있으면(잘못된 JSON) 그 파일만 건너뛰고 statusLine 자체는 그대로 만들어진다', () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(join(home, '.claude', 'settings.json'), 'not json')
    const s = makeSettings()
    expect(s.statusLine.type).toBe('command')
    expect(s.enabledPlugins).toBeUndefined()
  })
  it('DFLOW_WORKER_PLUGINS=keep 이면 켜진 플러그인이 있어도 enabledPlugins 를 합치지 않는다', () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'foo@bar': true } }))
    const s = makeSettings({ DFLOW_WORKER_PLUGINS: 'keep' })
    expect(s.enabledPlugins).toBeUndefined()
  })
  // .dflow-run 이 실행 시점에 설정 파일을 확인한다. claude 는 없는 설정 파일에서 곧바로 끝나므로(2.1.280:
  // "Settings file not found"), 파일이 없으면 --settings 없이 띄워야 재시작이 전부 첫 화면에서 죽지 않는다.
  function runTail(withSettings: boolean, extraEnv: Record<string, string> = {}) {
    const m = B().match(/cat >> "\$WT\/\.dflow-run" <<'RUNEOF'\n([\s\S]*?)\nRUNEOF/)
    if (!m) throw new Error('.dflow-run 실행 줄을 찾지 못했다')
    const bin = join(tmp, 'bin'); mkdirSync(bin)
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\nprintf \'%s\\n\' "$@"\n'); chmodSync(join(bin, 'claude'), 0o755)
    const wt = join(tmp, 'wt'); mkdirSync(wt); writeFileSync(join(wt, '.dflow-prompt'), 'POINTER\n')
    if (withSettings) makeSettings()
    const run = join(wt, '.dflow-run')
    writeFileSync(run, '#!/bin/sh\n' + m[1].replaceAll('<id8>', 'abcd1234').replaceAll('<모델 플래그>', '--model opus').replaceAll('<EFFORT>', 'high') + '\n'); chmodSync(run, 0o755)
    return spawnSync('sh', [run], { cwd: wt, encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: home, NODE_ENV: process.env.NODE_ENV, ...extraEnv } })
  }
  // 2026-09-24: 팀원 전용 설정(플러그인·MCP 끄기). --mcp-config 는 가변 인자라 바로 뒤 프롬프트까지 먹으므로 쓰지 않는다.
  it('.dflow-run 은 설정 파일이 있으면 --settings 로 싣고, --no-chrome --strict-mcp-config 로 MCP 를 끈다', () => {
    const r = runTail(true)
    expect(r.status).toBe(0)
    const args = r.stdout.trim().split('\n')
    expect(args).toEqual(['--dangerously-skip-permissions', '--settings', join(home, '.dflow/limits/abcd1234.settings.json'), '--no-chrome', '--strict-mcp-config', '--effort', 'high', '--model', 'opus', 'POINTER'])
    expect(args).not.toContain('--mcp-config')
  })
  it('.dflow-run 은 설정 파일이 없으면 --settings 없이 띄우되 MCP 는 여전히 끈다', () => {
    const r = runTail(false)
    expect(r.status).toBe(0)
    expect(r.stdout.trim().split('\n')).toEqual(['--dangerously-skip-permissions', '--no-chrome', '--strict-mcp-config', '--effort', 'high', '--model', 'opus', 'POINTER'])
  })
  // 2026-09-26: worker_keep_plugins·worker_keep_skills 의 auto 가 만든 <id8>.mcp.json·<id8>.chrome 이 있을 때만 달라진다
  it('auto 가 만든 MCP 파일이 있으면 --mcp-config 를 맨 앞에(바로 뒤가 옵션), chrome 표지가 있으면 --no-chrome 을 뺀다', () => {
    const lim = join(home, '.dflow/limits'); mkdirSync(lim, { recursive: true })
    writeFileSync(join(lim, 'abcd1234.mcp.json'), '{"mcpServers":{}}')
    writeFileSync(join(lim, 'abcd1234.chrome'), '')
    const r = runTail(false)
    expect(r.status).toBe(0)
    expect(r.stdout.trim().split('\n')).toEqual(['--dangerously-skip-permissions', '--mcp-config', join(lim, 'abcd1234.mcp.json'), '--strict-mcp-config', '--effort', 'high', '--model', 'opus', 'POINTER'])
  })
  it('DFLOW_WORKER_MCP=keep 이면 --no-chrome --strict-mcp-config 를 붙이지 않는다', () => {
    const r = runTail(false, { DFLOW_WORKER_MCP: 'keep' })
    expect(r.status).toBe(0)
    expect(r.stdout.trim().split('\n')).toEqual(['--dangerously-skip-permissions', '--effort', 'high', '--model', 'opus', 'POINTER'])
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
