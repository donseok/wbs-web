// tests/skills/dflow-pred-reflected.test.ts
// 행 G 반영 확인의 공용 스크립트(2026-09-23 머지 충돌 §6.2). 임시 git 저장소 + bare origin 에서 실제로 돈다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const SCRIPT = join(ROOT, '.claude/skills/dflow-dev/scripts/pred-reflected.sh')
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}
function sh(cwd: string, script: string) {
  const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', env: GIT_ENV })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
function judge(tsk: string, dev = 'main') {
  const r = spawnSync('sh', [SCRIPT, 'docs/tasks', tsk, dev], { cwd: repo, encoding: 'utf8', env: GIT_ENV })
  return { code: r.status, out: (r.stdout || '').trim() }
}
/** state.json 을 main 에 커밋하고 push 한다. */
const state = (tsk: string, json: Record<string, unknown>) =>
  `mkdir -p docs/tasks/${tsk} && printf '%s' '${JSON.stringify(json)}' > docs/tasks/${tsk}/state.json && git add docs && git commit -qm "chore(${tsk}): state" && git push -q origin main`
/** agent 브랜치를 --no-ff 로 머지한다(제목은 인자 그대로). */
const mergeAs = (title: string, br: string) =>
  `git switch -q -c ${br} && printf '%s\\n' ${br} > ${br.replace('/', '-')}.txt && git add . && git commit -qm feat && git switch -q main && git merge -q --no-ff ${br} -m "${title}" && git push -q origin main`

let tmp: string, repo: string
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-predref-')))
  repo = join(tmp, 'repo')
  const r = sh(tmp, `
    git init -q --bare -b main origin.git
    git clone -q origin.git repo 2>/dev/null
    cd repo && git checkout -q -b main
    printf 'x\\n' > a.txt && git add a.txt && git commit -qm init && git push -q origin main
  `)
  expect(r.code, r.out).toBe(0)
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('pred-reflected.sh', () => {
  it('state.json 이 없으면 NOT_REFLECTED no-state(1)', () => {
    expect(judge('TSK-03-02')).toEqual({ code: 1, out: 'NOT_REFLECTED no-state' })
  })
  it('phase 가 merged 가 아니면 NOT_REFLECTED(1)', () => {
    expect(sh(repo, state('TSK-03-02', { tsk: 'TSK-03-02', order: 'o-2', phase: 'reported' })).code).toBe(0)
    expect(judge('TSK-03-02')).toEqual({ code: 1, out: 'NOT_REFLECTED phase=reported' })
  })
  it('phase=merged + 머지 커밋 제목 → REFLECTED 3(0)', () => {
    expect(sh(repo, `${mergeAs('merge: TSK-03-02 기능 (approved)', 'agent/t2')} && ${state('TSK-03-02', { tsk: 'TSK-03-02', order: 'o-2', phase: 'merged' })}`).code).toBe(0)
    expect(judge('TSK-03-02')).toEqual({ code: 0, out: 'REFLECTED 3' })
  })
  it('head_sha 가 개발 브랜치의 조상이면 REFLECTED 1 — 가장 강한 증거가 먼저', () => {
    const head = sh(repo, 'git rev-parse HEAD').out.trim()
    expect(sh(repo, state('TSK-03-02', { tsk: 'TSK-03-02', order: 'o-2', phase: 'merged', head_sha: head })).code).toBe(0)
    expect(judge('TSK-03-02')).toEqual({ code: 0, out: 'REFLECTED 1' })
  })
  it('DFlow-Order 트레일러 → REFLECTED 2', () => {
    expect(sh(repo, `printf 'y\\n' > t.txt && git add t.txt && git commit -qm "feat: x" -m "DFlow-Order: o-2" && ${state('TSK-03-02', { tsk: 'TSK-03-02', order: 'o-2', phase: 'merged' })}`).code).toBe(0)
    expect(judge('TSK-03-02')).toEqual({ code: 0, out: 'REFLECTED 2' })
  })
  it('TSK-03-1 은 TSK-03-10 머지 제목에 걸리지 않는다', () => {
    expect(sh(repo, `${mergeAs('merge: TSK-03-10 다른 기능 (approved)', 'agent/t10')} && ${state('TSK-03-1', { tsk: 'TSK-03-1', order: 'o-1', phase: 'merged' })}`).code).toBe(0)
    expect(judge('TSK-03-1')).toEqual({ code: 1, out: 'NOT_REFLECTED no-evidence' })
  })
  it('merged 인데 증거가 하나도 없으면 NOT_REFLECTED no-evidence(1) — phase 한 줄만으로는 믿지 않는다', () => {
    expect(sh(repo, state('TSK-03-02', { tsk: 'TSK-03-02', order: 'o-2', phase: 'merged' })).code).toBe(0)
    expect(judge('TSK-03-02')).toEqual({ code: 1, out: 'NOT_REFLECTED no-evidence' })
  })
  it('개발 브랜치가 origin 에 없으면 UNKNOWN(2) — 반영 안 됨으로 단정하지 않는다', () => {
    expect(judge('TSK-03-02', 'develop')).toEqual({ code: 2, out: 'UNKNOWN no-dev-branch origin/develop' })
  })
  it('인자가 셋이 아니면 UNKNOWN usage(2)', () => {
    const r = spawnSync('sh', [SCRIPT, 'docs/tasks'], { cwd: repo, encoding: 'utf8', env: GIT_ENV })
    expect(r.status).toBe(2)
    expect(r.stdout.trim()).toBe('UNKNOWN usage')
  })
  it('POSIX sh 스크립트다(#!/bin/sh, set -u)', () => {
    const src = readFileSync(SCRIPT, 'utf8')
    expect(src.startsWith('#!/bin/sh\n')).toBe(true)
    expect(src).toContain('set -u')
  })
})
