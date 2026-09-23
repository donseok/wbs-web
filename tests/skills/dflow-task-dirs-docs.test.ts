// 스킬 문서의 작업 폴더를 <DOCS_DIR>/tasks 로 통일(docs/superpowers/specs/2026-09-23-dflow-task-scaffold-design.md §6).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('스킬 문서의 작업 폴더', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), '.claude/skills', p), 'utf8')
  const FILES = ['dflow-dev/SKILL.md', 'dflow-dev/references/dev-discipline.md', 'dflow-merge/SKILL.md',
    'dflow-team/SKILL.md', 'dflow-team/references/worker-prompt.md', 'dflow-team/references/backends.md',
    'dflow-team/references/events.md', 'dflow-work/SKILL.md', 'dflow-work/README.md',
    'dflow-work/references/troubleshooting.md', 'dflow-work/references/api-contract.md']
  it('고정 경로 docs/tasks 가 남아 있지 않다', () => {
    for (const f of FILES) expect(read(f), f).not.toMatch(/docs\/tasks/)
  })
  it('dflow-dev·dflow-merge·dflow-team 이 <TASKS> 를 정의한다', () => {
    for (const f of ['dflow-dev/SKILL.md', 'dflow-merge/SKILL.md', 'dflow-team/SKILL.md'])
      expect(read(f), f).toContain('작업 폴더 `<TASKS>` 는 `<DOCS_DIR>/tasks` 다')
  })
  it('팀장 exclude 패턴과 backends 필터가 DOCS_DIR 을 덮는다', () => {
    expect(read('dflow-team/SKILL.md')).toContain("'**/tasks/*/.result' '**/tasks/*/.issues'")
    expect(read('dflow-team/references/backends.md')).not.toContain('docs/tasks/<TSK>/(spec')
  })
})
