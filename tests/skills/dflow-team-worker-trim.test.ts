// 팀원 첫 턴 컨텍스트 줄이기(backends.md 「팀원 워크트리 준비」 → scripts/worker-trim.sh). 모든 줄이기는 .dflow.local 의
// PC별 opt-in 이며, 키가 없으면 종전 설정과 글자 그대로 같아야 한다. dflow-* 와 대상 리포의 프로젝트 스킬은 늘 남는다.
// 근거·실측: .claude/skills/dflow-team/references/rationale.md 「팀원 첫 턴 컨텍스트 줄이기」.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const SCRIPT = join(ROOT, '.claude/skills/dflow-team/scripts/worker-trim.sh')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const B = () => read('.claude/skills/dflow-team/references/backends.md')

let tmp: string, home: string, main: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wtrim-'))
  home = join(tmp, 'home'); main = join(tmp, 'main')
  mkdirSync(home); mkdirSync(main)
})
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

function skill(dir: string, folder: string, name = folder, eol = '\n') {
  mkdirSync(join(dir, folder), { recursive: true })
  writeFileSync(join(dir, folder, 'SKILL.md'), `---${eol}name: ${name}${eol}description: x${eol}---${eol}`)
}
const userSkill = (folder: string, name?: string) => skill(join(home, '.claude/skills'), folder, name)
const projSkill = (folder: string, name?: string, eol?: string) => skill(join(main, '.claude/skills'), folder, name, eol)
// dflow_config_load 가 new 모드로 .dflow.local 을 읽게 두 파일을 둔다(dev_branch 는 필수).
function local(lines: string) {
  writeFileSync(join(main, '.dflow'), 'api_base=https://p.test\n')
  writeFileSync(join(main, '.dflow.local'), 'dev_branch=main\n' + lines)
}
const baseEnv = () => ({ PATH: process.env.PATH ?? '', HOME: home, NODE_ENV: process.env.NODE_ENV })
function trim(p = '{}', env: Record<string, string> = {}) {
  const r = spawnSync('sh', [SCRIPT, main, p], { encoding: 'utf8', env: { ...baseEnv(), ...env } })
  expect(r.status, r.stderr).toBe(0)
  return { out: JSON.parse(r.stdout), err: r.stderr }
}

describe('worker-trim.sh — 값이 없으면 종전과 같다', () => {
  it('.dflow.local 에 키가 없으면 사용자 스킬·플러그인이 있어도 {} 를 낸다', () => {
    userSkill('some-user-skill'); projSkill('proj')
    local('')
    const { out, err } = trim('{"a@m":false}')
    expect(out).toEqual({})
    expect(err).toBe('')
  })
  it('설정 파일도 env 도 없으면 {} 를 낸다(레거시·미설정 리포에서도 죽지 않는다)', () => {
    expect(trim().out).toEqual({})
  })
})

describe('worker_keep_skills — 남길 사용자 스킬만 남긴다', () => {
  it('목록 밖 사용자 스킬은 off, 목록 안·dflow-*·프로젝트 스킬(폴더·머리말 name, CRLF)은 끄지 않고 동기화 스킬을 숨긴다', () => {
    userSkill('keep-me'); userSkill('drop-me'); userSkill('folder-x', 'named-y'); userSkill('dflow-extra')
    userSkill('same-as-proj'); userSkill('same-as-proj-name')
    projSkill('same-as-proj'); projSkill('p2', 'same-as-proj-name', '\r\n')
    local('worker_keep_skills=keep-me\n')
    const { out, err } = trim()
    expect(out.skillOverrides).toEqual({ 'drop-me': 'off', 'folder-x': 'off', 'named-y': 'off' })
    expect(out.syncClaudeAiSkills).toBe(false)
    expect(out.outputStyle).toBeUndefined()
    expect(out.enabledPlugins).toBeUndefined()
    expect(err).toBe('')
  })
  it('none 이면 사용자 스킬을 모두 끈다(경고 없이)', () => {
    userSkill('a1'); userSkill('a2')
    local('worker_keep_skills=none\n')
    const { out, err } = trim()
    expect(out.skillOverrides).toEqual({ a1: 'off', a2: 'off' })
    expect(err).toBe('')
  })
  it('남길 스킬이 이 PC 에 없으면 경고 한 줄만 내고 진행한다', () => {
    userSkill('a1')
    local('worker_keep_skills=not-here, a1\n')
    const { out, err } = trim()
    expect(out.skillOverrides).toBeUndefined() // a1 은 남기고 끌 것이 없다
    expect(out.syncClaudeAiSkills).toBe(false)
    expect(err.trim().split('\n')).toEqual([expect.stringMatching(/^WORKER_SKILL_NOT_FOUND not-here /)])
  })
  it('이미 export 된 env 가 .dflow.local 을 이긴다', () => {
    userSkill('a1'); userSkill('a2')
    local('worker_keep_skills=a1\n')
    expect(trim('{}', { DFLOW_WORKER_KEEP_SKILLS: 'a2' }).out.skillOverrides).toEqual({ a1: 'off' })
  })
})

describe('worker_skills_off — 이름으로 끈다', () => {
  it('적은 이름을 off 로 넣되 dflow-* 와 프로젝트 스킬 이름은 거른다. 동기화 스킬은 건드리지 않는다', () => {
    projSkill('proj-a')
    local('worker_skills_off=builtin-x,proj-a,dflow-dev\n')
    const { out } = trim()
    expect(out.skillOverrides).toEqual({ 'builtin-x': 'off' })
    expect(out.syncClaudeAiSkills).toBeUndefined()
  })
})

describe('worker_keep_plugins — 켜 둘 플러그인', () => {
  it('종전 끄기 맵에서 목록을 빼고 claude.ai 동기화 플러그인을 숨긴다. 켜져 있지 않은 이름은 경고만 낸다', () => {
    local('worker_keep_plugins=a@m,zz@m\n')
    const { out, err } = trim('{"a@m":false,"b@m":false}')
    expect(out.enabledPlugins).toEqual({ 'b@m': false })
    expect(out.syncClaudeAiPlugins).toBe(false)
    expect(err.trim().split('\n')).toEqual([expect.stringMatching(/^WORKER_PLUGIN_NOT_FOUND zz@m /)])
  })
  it('모두 남기면 enabledPlugins 를 빈 맵으로 내 종전 끄기를 통째로 덮는다', () => {
    local('worker_keep_plugins=a@m\n')
    expect(trim('{"a@m":false}').out.enabledPlugins).toEqual({})
  })
  it('none 이면 종전 끄기는 그대로 두고 동기화 플러그인만 더 숨긴다', () => {
    local('worker_keep_plugins=none\n')
    const { out, err } = trim('{"a@m":false}')
    expect(out.enabledPlugins).toEqual({ 'a@m': false }) // 종전 맵 그대로
    expect(out.syncClaudeAiPlugins).toBe(false)
    expect(err).toBe('')
  })
  it('DFLOW_WORKER_PLUGINS=keep(플러그인 전부 유지)이면 동기화 플러그인도 숨기지 않는다', () => {
    local('worker_keep_plugins=none\n')
    expect(trim('{}', { DFLOW_WORKER_PLUGINS: 'keep' }).out).toEqual({})
  })
})

describe('worker_output_style', () => {
  it('값을 outputStyle 로 넣는다. default 는 경고 없이', () => {
    local('worker_output_style=default\n')
    const { out, err } = trim()
    expect(out).toEqual({ outputStyle: 'default' })
    expect(err).toBe('')
  })
  it('스타일 파일이 없으면 경고 한 줄을 내고 값은 그대로 넘긴다. 파일이 있으면 경고하지 않는다', () => {
    local('worker_output_style=mine\n')
    let r = trim()
    expect(r.out.outputStyle).toBe('mine')
    expect(r.err).toMatch(/^WORKER_OUTPUT_STYLE_NOT_FOUND mine /)
    mkdirSync(join(home, '.claude/output-styles'), { recursive: true })
    writeFileSync(join(home, '.claude/output-styles/mine.md'), '---\nname: mine\n---\n')
    r = trim()
    expect(r.err).toBe('')
  })
})

describe('worker-trim.sh — 킷 규칙', () => {
  const S = () => readFileSync(SCRIPT, 'utf8')
  it('내장 스킬을 통째로 끄지 않는다(disableBundledSkills 는 Workflow 도구 설명을 도리어 키운다)', () => {
    expect(S()).not.toContain('disableBundledSkills')
    expect(B()).toContain('`disableBundledSkills` 는\n  쓰지 않는다')
  })
  it('키 넷이 dflow-config.sh 에 개인(personal) 키로 등록돼 있고 예시 파일에 주석으로 있다', () => {
    const lib = join(ROOT, '.claude/skills/dflow-work/scripts/dflow-config.sh')
    const r = spawnSync('sh', ['-c', `. '${lib}'; for k in worker_keep_skills worker_skills_off worker_keep_plugins worker_output_style; do echo "$k $(_dfc_scope $k) $(_dfc_env $k)"; done`], { encoding: 'utf8' })
    expect(r.stdout.trim().split('\n')).toEqual([
      'worker_keep_skills personal DFLOW_WORKER_KEEP_SKILLS',
      'worker_skills_off personal DFLOW_WORKER_SKILLS_OFF',
      'worker_keep_plugins personal DFLOW_WORKER_KEEP_PLUGINS',
      'worker_output_style personal DFLOW_WORKER_OUTPUT_STYLE',
    ])
    const ex = read('.claude/skills/dflow-work/dflow.local.example')
    for (const k of ['worker_keep_skills', 'worker_skills_off', 'worker_keep_plugins', 'worker_output_style']) {
      expect(ex).toContain(`# ${k}=`)
      expect(read('.claude/skills/dflow-team/references/help.md')).toContain(`${k}=`)
    }
  })
})

// backends.md 블록을 잘라 실제로 돌린다(dflow-team-restart-statusline.test.ts 와 같은 방법). cwd 는 리포 루트라
// 블록의 상대 경로 `.claude/skills/dflow-team/scripts/worker-trim.sh` 가 풀린다.
describe('「팀원 워크트리 준비」 블록과의 결합', () => {
  function settings(env: Record<string, string> = {}) {
    const m = B().match(/(if \[ "\$\{DFLOW_WORKER_PLUGINS-\}" = keep \][\s\S]*?> "\$LIM\/<id8>\.settings\.json")/)
    if (!m) throw new Error('팀원 전용 설정 블록을 찾지 못했다')
    const block = m[1].replaceAll('<id8>', 'abcd1234').replaceAll('<MAIN>', main)
    const r = spawnSync('sh', ['-c', block], { cwd: ROOT, encoding: 'utf8', env: { ...baseEnv(), ...env } })
    expect(r.status, r.stderr).toBe(0)
    return JSON.parse(readFileSync(join(home, '.dflow/limits/abcd1234.settings.json'), 'utf8'))
  }
  it('opt-in 키가 없으면 statusLine·훅·enabledPlugins 만 있고 새 키는 없다', () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'foo@bar': true } }))
    userSkill('u1'); local('')
    const s = settings()
    expect(Object.keys(s).sort()).toEqual(['enabledPlugins', 'hooks', 'statusLine'])
    expect(s.enabledPlugins).toEqual({ 'foo@bar': false })
  })
  it('opt-in 키가 있으면 조각이 덮여 합쳐지고 statusLine·훅은 그대로다', () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'foo@bar': true, 'keep@bar': true } }))
    userSkill('u1'); userSkill('u2'); projSkill('proj')
    local('worker_keep_skills=u1\nworker_keep_plugins=keep@bar\nworker_output_style=default\n')
    const s = settings()
    expect(s.statusLine.type).toBe('command')
    expect(s.hooks.PreToolUse[0].matcher).toBe('Bash')
    expect(s.enabledPlugins).toEqual({ 'foo@bar': false })
    expect(s.skillOverrides).toEqual({ u2: 'off' })
    expect(s.syncClaudeAiSkills).toBe(false)
    expect(s.syncClaudeAiPlugins).toBe(false)
    expect(s.outputStyle).toBe('default')
    expect(s.disableBundledSkills).toBeUndefined()
    expect(s.disableAllHooks).toBeUndefined()
  })
  it('zsh(macOS 팀장의 Bash 도구 셸)에서 돌려도 같은 결과다', () => {
    const z = spawnSync('zsh', ['-c', 'exit 0'])
    if (z.status !== 0) return // zsh 가 없는 PC(Linux CI·Windows)는 건너뛴다
    userSkill('u1'); userSkill('u2')
    local('worker_keep_skills=u1\n')
    const m = B().match(/(if \[ "\$\{DFLOW_WORKER_PLUGINS-\}" = keep \][\s\S]*?> "\$LIM\/<id8>\.settings\.json")/)
    const block = m![1].replaceAll('<id8>', 'abcd1234').replaceAll('<MAIN>', main)
    const r = spawnSync('zsh', ['-c', block], { cwd: ROOT, encoding: 'utf8', env: baseEnv() })
    expect(r.status, r.stderr).toBe(0)
    const s = JSON.parse(readFileSync(join(home, '.dflow/limits/abcd1234.settings.json'), 'utf8'))
    expect(s.skillOverrides).toEqual({ u2: 'off' })
  })
})
