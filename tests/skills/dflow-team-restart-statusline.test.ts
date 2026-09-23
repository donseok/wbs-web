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
    return spawnSync('sh', [run], { cwd: wt, encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: home, NODE_ENV: process.env.NODE_ENV } })
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
