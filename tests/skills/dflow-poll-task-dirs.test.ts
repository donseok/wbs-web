// poll 승인 감지가 바인딩된 모든 작업 폴더를 본다(docs/superpowers/specs/2026-09-23-dflow-task-scaffold-design.md §6).
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('poll.sh 승인 감지 대상', () => {
  const POLL = readFileSync(join(process.cwd(), '.claude/skills/dflow-poll/scripts/poll.sh'), 'utf8')
  it('고정 경로 docs/tasks 대신 dflow_config_tasks_dirs 를 훑는다', () => {
    expect(POLL).not.toContain('$PWD/docs/tasks')
    expect(POLL).toContain('dflow_config_tasks_dirs')
  })
})

describe('poll.sh 두 작업 폴더 감지', () => {
  const ROOT = process.cwd()
  const POLL_SH = join(ROOT, '.claude/skills/dflow-poll/scripts/poll.sh')
  const DFLOW_CONFIG = join(ROOT, '.claude/skills/dflow-work/scripts/dflow-config.sh')

  const GIT_ENV = {
    PATH: process.env.PATH ?? '', HOME: '/nonexistent', NODE_ENV: process.env.NODE_ENV,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  }

  let tmp: string
  let repo: string
  let stubBinDir: string

  function sh(cwd: string, script: string, env: Record<string, string> = {}) {
    const r = spawnSync('sh', ['-c', script], {
      cwd,
      encoding: 'utf8',
      env: { ...GIT_ENV, ...env } as NodeJS.ProcessEnv,
      timeout: 5000
    })
    return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
  }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dflow-poll-test-'))
    repo = join(tmp, 'repo')
    stubBinDir = join(tmp, 'bin')

    // Initialize git repo
    const r = sh(tmp, `
      git init -q --bare -b main origin.git
      git clone -q origin.git repo 2>/dev/null && cd repo && git checkout -q -b main
      printf 'x\\n' > a.txt && git add a.txt && git commit -qm init && git push -q origin main
      git remote set-head origin main`)
    expect(r.code, r.err).toBe(0)

    // Create stub dflow.sh that returns approval status
    mkdirSync(stubBinDir)
    const dflowStub = join(stubBinDir, 'dflow.sh')
    writeFileSync(dflowStub, `#!/bin/sh
case "$1" in
  show)
    # Return JSON with order.status = "approved" for approval detection
    cat <<'JSON'
{
  "order": {
    "status": "approved"
  },
  "reports": []
}
JSON
    ;;
  list)
    # Return empty list to skip ready scan
    echo "[]"
    ;;
  watch)
    # No-op
    exit 0
    ;;
  *)
    exit 1
    ;;
esac
`)
    chmodSync(dflowStub, 0o755)
  })

  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('두 바인딩 폴더(docs/tasks, docs/mdm/tasks)의 승인을 모두 감지한다', () => {
    // Setup .dflow and .dflow.local with two task folder bindings
    writeFileSync(join(repo, '.dflow'), 'api_base=https://p.test\nproject_id=11111111-1111-4111-8111-111111111111\nrelease_branch=main\n')
    writeFileSync(join(repo, '.dflow.local'), 'pats=dflow_pat_TEST_token\ndev_branch=dev/test\nautomerge=1\nproject_map=docs/mdm=22222222-2222-4222-8222-222222222222\n')

    // Create first task folder structure: docs/tasks/TSK-A/state.json
    mkdirSync(join(repo, 'docs/tasks/TSK-A'), { recursive: true })
    writeFileSync(join(repo, 'docs/tasks/TSK-A/state.json'), JSON.stringify({
      tsk: 'TSK-A',
      order: 'uuid-order-a-1234567890ab',
      api_base: 'https://p.test',
      phase: 'reported'
    }))

    // Create second task folder structure: docs/mdm/tasks/TSK-B/state.json
    mkdirSync(join(repo, 'docs/mdm/tasks/TSK-B'), { recursive: true })
    writeFileSync(join(repo, 'docs/mdm/tasks/TSK-B/state.json'), JSON.stringify({
      tsk: 'TSK-B',
      order: 'uuid-order-b-1234567890cd',
      api_base: 'https://p.test',
      phase: 'reported'
    }))

    // Run poll.sh with stub dflow.sh
    const pollEnv = {
      DFLOW_SH: join(stubBinDir, 'dflow.sh'),
      DFLOW_WATCH: '0',
      DFLOW_CONFIG_DIR: repo,
      PATH: `${stubBinDir}:${GIT_ENV.PATH}`
    }
    const r = sh(repo, `sh '${POLL_SH}' --interval 1 --until none`, pollEnv)

    // poll.sh should exit with code 9 (approval detected) and output both TSK-A and TSK-B
    expect(r.code).toBe(9)
    expect(r.out).toContain('TSK-A')
    expect(r.out).toContain('TSK-B')
  })

  it('무관한 project_map 키가 잘못돼도(BAD_DOCS_DIR) poll 은 멈추지 않고 제대로 바인딩된 폴더의 승인을 감지한다', () => {
    writeFileSync(join(repo, '.dflow'), 'api_base=https://p.test\nproject_id=11111111-1111-4111-8111-111111111111\nrelease_branch=main\n')
    writeFileSync(join(repo, '.dflow.local'), 'pats=dflow_pat_TEST_token\ndev_branch=dev/test\nproject_map=/abs/docs/mdm=22222222-2222-4222-8222-222222222222\n')
    mkdirSync(join(repo, 'docs/tasks/TSK-A'), { recursive: true })
    writeFileSync(join(repo, 'docs/tasks/TSK-A/state.json'), JSON.stringify({
      tsk: 'TSK-A', order: 'uuid-order-a-1234567890ab', api_base: 'https://p.test', phase: 'reported' }))
    const r = sh(repo, `sh '${POLL_SH}' --interval 1 --until none`, {
      DFLOW_SH: join(stubBinDir, 'dflow.sh'), DFLOW_WATCH: '0', DFLOW_CONFIG_DIR: repo, PATH: `${stubBinDir}:${GIT_ENV.PATH}`,
    })
    expect(r.code).toBe(9)
    expect(r.out).toContain('TSK-A')
    // 경고는 시작 때 한 번만 — 매 주기 반복하지 않는다
    expect(r.err.split('BAD_DOCS_DIR /abs/docs/mdm').length - 1).toBe(1)
  })
})
