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
  it('팀장이 taskdir 에 order(전체 UUID·id8) 를 넘기고 external_ref 를 넘기지 않는다', () => {
    const t = read('dflow-team/SKILL.md')
    expect(t).toContain('taskdir "$order"')
    expect(t).toContain('taskdir "$id8"')
    expect(t).not.toContain('taskdir <ref>)` 로 이 작업의 작업 폴더')
  })
  it('워커는 빈 TASK_DIR 을 failed no-task-dir 로 끝낸다', () => {
    expect(read('dflow-team/references/worker-prompt.md')).toContain('failed no-task-dir')
  })
  it('팀장 재구성이 tasks-dirs 를 워크트리 반복문 밖에서 한 번만 구한다', () => {
    const t = read('dflow-team/SKILL.md')
    const diIdx = t.indexOf('dirs=$(.claude/skills/dflow-work/scripts/dflow.sh config tasks-dirs)')
    const loopIdx = t.indexOf('git worktree list --porcelain')
    expect(diIdx).toBeGreaterThan(-1)
    expect(loopIdx).toBeGreaterThan(-1)
    expect(diIdx).toBeLessThan(loopIdx)
    expect(t).not.toContain('cd "$w" && .claude/skills/dflow-work/scripts/dflow.sh config tasks-dirs')
  })
  it('merge 의 원격 스캔 pathspec 이 고정 glob 이 아니라 tasks-dirs 별로 구성된다', () => {
    const t = read('dflow-merge/SKILL.md')
    expect(t).not.toContain("'*/tasks/*/state.json'")
    expect(t).toContain('while IFS= read -r d; do set -- "$@" "$d/*/state.json"; done <<EOF')
  })
  it('행 G 의 기본 브랜치 반영 확인이 TASKS 를 줄 사이 변수로 넘기지 않는다', () => {
    const t = read('dflow-dev/SKILL.md')
    expect(t).toContain('git show "origin/<기본브랜치>:$(dirname {TASK_DIR})/<선행TSK>/state.json"')
    expect(t).not.toContain('TASKS=$(dirname {TASK_DIR})')
    expect(t).not.toMatch(/:\$TASKS\//)
  })
  it('팀장 재개 spawn 이 TASK_DIR 을 슬롯 되돌리기보다 먼저 구한다', () => {
    const t = read('dflow-team/SKILL.md')
    const start = t.indexOf('### 5-1. 재개 spawn')
    const section = t.slice(start, t.indexOf('## 6. blocked'))
    const taskDirIdx = section.indexOf('TASK_DIR` 을 구한다')
    const unparkIdx = section.indexOf('.dflow-agent` 를 되돌린다')
    expect(start).toBeGreaterThan(-1)
    expect(taskDirIdx).toBeGreaterThan(-1)
    expect(unparkIdx).toBeGreaterThan(-1)
    expect(taskDirIdx).toBeLessThan(unparkIdx)
  })
})
