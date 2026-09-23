// poll 승인 감지가 바인딩된 모든 작업 폴더를 본다(docs/superpowers/specs/2026-09-23-dflow-task-scaffold-design.md §6).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('poll.sh 승인 감지 대상', () => {
  const POLL = readFileSync(join(process.cwd(), '.claude/skills/dflow-poll/scripts/poll.sh'), 'utf8')
  it('고정 경로 docs/tasks 대신 dflow_config_tasks_dirs 를 훑는다', () => {
    expect(POLL).not.toContain('$PWD/docs/tasks')
    expect(POLL).toContain('dflow_config_tasks_dirs')
  })
})
