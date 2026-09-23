// 작업 폴더 역매핑(docs/superpowers/specs/2026-09-23-dflow-task-scaffold-design.md §3).
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LIB = join(process.cwd(), '.claude/skills/dflow-work/scripts/dflow-config.sh')
const DFLOW = join(process.cwd(), '.claude/skills/dflow-work/scripts/dflow.sh')
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

function lib(script: string, env: Record<string, string>) {
  const r = spawnSync('sh', ['-c', `. '${LIB}'; ${script}`], {
    encoding: 'utf8', env: { PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV, ...env } as NodeJS.ProcessEnv,
  })
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
}

describe('dflow_config_docs_dir', () => {
  it('project_map 의 키를 돌려준다(끝 / 와 공백 제거)', () => {
    const r = lib(`dflow_config_docs_dir ${B}`, { DFLOW_PROJECT_MAP: `docs/c10=${A}, docs/mdm/ = ${B}\r` })
    expect(r.code, r.err).toBe(0); expect(r.out).toBe('docs/mdm\n')
  })
  it('매핑이 없고 project_id 와 같으면 docs', () => {
    const r = lib(`dflow_config_docs_dir ${A}`, { DFLOW_PROJECT_ID: A })
    expect(r.code, r.err).toBe(0); expect(r.out).toBe('docs\n')
  })
  it('project_map 이 project_id 보다 우선한다', () => {
    const r = lib(`dflow_config_docs_dir ${A}`, { DFLOW_PROJECT_ID: A, DFLOW_PROJECT_MAP: `docs/c10=${A}` })
    expect(r.out).toBe('docs/c10\n')
  })
  it('바인딩 밖이면 PROJECT_MISMATCH 로 return 2', () => {
    const r = lib(`dflow_config_docs_dir ${C}`, { DFLOW_PROJECT_ID: A, DFLOW_PROJECT_MAP: `docs/c10=${B}` })
    expect(r.code).toBe(2); expect(r.err).toContain('PROJECT_MISMATCH'); expect(r.out).toBe('')
  })
  it('같은 UUID 가 다른 키로 두 번이면 AMBIGUOUS_DOCS_DIR', () => {
    const r = lib(`dflow_config_docs_dir ${B}`, { DFLOW_PROJECT_MAP: `docs/a=${B},docs/b=${B}` })
    expect(r.code).toBe(2); expect(r.err).toContain('AMBIGUOUS_DOCS_DIR')
  })
  it('같은 키·같은 UUID 중복은 하나로 본다', () => {
    const r = lib(`dflow_config_docs_dir ${B}`, { DFLOW_PROJECT_MAP: `docs/a=${B},docs/a/=${B}` })
    expect(r.code, r.err).toBe(0); expect(r.out).toBe('docs/a\n')
  })
  it('인자가 없으면 return 2', () => {
    expect(lib('dflow_config_docs_dir', { DFLOW_PROJECT_ID: A }).code).toBe(2)
  })
})

describe('dflow_config_tasks_dirs', () => {
  it('project_id 는 docs/tasks, map 키마다 <키>/tasks', () => {
    const r = lib('dflow_config_tasks_dirs', { DFLOW_PROJECT_ID: A, DFLOW_PROJECT_MAP: `docs/mdm/=${B},docs/c10=${C}` })
    expect(r.out).toBe('docs/c10/tasks\ndocs/mdm/tasks\ndocs/tasks\n')
  })
  it('바인딩이 없으면 빈 출력', () => {
    expect(lib('dflow_config_tasks_dirs', {}).out).toBe('')
  })
})

describe('dflow.sh config docs-dir|tasks-dirs', () => {
  const run = (args: string[]) => spawnSync('sh', [DFLOW, ...args], {
    encoding: 'utf8', cwd: mkdtempSync(join(tmpdir(), 'dflow-td-')),
    env: {
      PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV, HOME: '/nonexistent',
      DFLOW_ENV_FILE: '/nonexistent/.env', DFLOW_CONFIG_DIR: '/nonexistent',
      DFLOW_PROJECT_MAP: `docs/mdm=${B}`,
    } as NodeJS.ProcessEnv,
  })
  it('docs-dir 는 해석 결과를, 실패는 exit 2 를 낸다', () => {
    const ok = run(['config', 'docs-dir', B]); expect(ok.status, ok.stderr).toBe(0); expect(ok.stdout).toBe('docs/mdm\n')
    const bad = run(['config', 'docs-dir', C]); expect(bad.status).toBe(2); expect(bad.stderr).toContain('PROJECT_MISMATCH')
  })
  it('tasks-dirs 는 목록을 낸다', () => {
    const r = run(['config', 'tasks-dirs']); expect(r.stdout).toBe('docs/mdm/tasks\n')
  })
})

// project_map 키 검증(최종 리뷰 #5·#8). 키는 리포 최상위 기준 상대경로다 — 절대경로·'..'·빈 키는
// 원격 스캔의 git diff 를 exit 128 로 죽이고(후보 0건) claim 이 리포 밖에 폴더를 만든다.
describe('project_map 키 검증 — BAD_DOCS_DIR', () => {
  const BAD = ['/Users/me/repo/docs/mdm', '../other', 'docs/../x', 'docs/..', '..', '', '/']
  for (const k of BAD) {
    it(`키 '${k}' 면 docs_dir·tasks_dirs 는 BAD_DOCS_DIR 로 return 2`, () => {
      const env = { DFLOW_PROJECT_ID: A, DFLOW_PROJECT_MAP: `docs/ok=${C},${k}=${B}` }
      const d = lib(`dflow_config_docs_dir ${B}`, env)
      expect(d.code).toBe(2); expect(d.err).toContain('BAD_DOCS_DIR'); expect(d.out).toBe('')
      // 다른 프로젝트를 물어도 설정이 깨졌으면 멈춘다 — 조용히 일부만 쓰지 않는다
      expect(lib(`dflow_config_docs_dir ${A}`, env).code).toBe(2)
      const t = lib('dflow_config_tasks_dirs', env)
      expect(t.code).toBe(2); expect(t.err).toContain('BAD_DOCS_DIR'); expect(t.out).toBe('')
    })
  }
  it('projects 는 잘못된 키의 UUID 를 바인딩하지 않고 BAD_DOCS_DIR 를 알린다(나머지는 그대로)', () => {
    const r = lib('dflow_config_projects', { DFLOW_PROJECT_ID: A, DFLOW_PROJECT_MAP: `docs/ok=${C},/abs/docs=${B}` })
    expect(r.code).toBe(0); expect(r.err).toContain('BAD_DOCS_DIR /abs/docs')
    expect(r.out).toBe(`${A}\n${C}\n`)
  })
  it('정상 키(점이 든 이름·끝 /)는 그대로 통과한다', () => {
    const r = lib('dflow_config_tasks_dirs', { DFLOW_PROJECT_MAP: `docs/a..b/=${B},docs/.x=${C}` })
    expect(r.code, r.err).toBe(0); expect(r.err).toBe(''); expect(r.out).toBe('docs/.x/tasks\ndocs/a..b/tasks\n')
  })
  it('dflow.sh config tasks-dirs 는 잘못된 키면 exit 2', () => {
    const r = spawnSync('sh', [DFLOW, 'config', 'tasks-dirs'], {
      encoding: 'utf8', cwd: mkdtempSync(join(tmpdir(), 'dflow-td-')),
      env: {
        PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV, HOME: '/nonexistent',
        DFLOW_ENV_FILE: '/nonexistent/.env', DFLOW_CONFIG_DIR: '/nonexistent', DFLOW_PROJECT_MAP: `/abs/docs=${B}`,
      } as NodeJS.ProcessEnv,
    })
    expect(r.status).toBe(2); expect(r.stderr).toContain('BAD_DOCS_DIR'); expect(r.stdout).toBe('')
  })
})
