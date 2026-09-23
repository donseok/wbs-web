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
    expect(t).not.toContain('taskdir <ref>)` 로 이 작업의 작업 폴더')
  })
  it('taskdir 를 부르는 블록마다 넘기는 변수를 같은 블록 첫머리에서 자리표시로 묶는다', () => {
    const t = read('dflow-team/SKILL.md')
    const blocks = [...t.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1])
      .filter((b) => b.includes('dflow.sh taskdir'))
    const vars = blocks.map((b) => /dflow\.sh taskdir "\$(\w+)"/.exec(b)?.[1])
    expect(vars.sort()).toEqual(['id8', 'order'])
    for (const b of blocks) {
      const v = /dflow\.sh taskdir "\$(\w+)"/.exec(b)![1]
      const bind = b.indexOf(`${v}='<${v}>'`)
      expect(bind, b).toBeGreaterThan(-1)
      expect(bind, b).toBeLessThan(b.indexOf('dflow.sh taskdir'))
      expect(b, b).toMatch(/echo ".*rc=\$rc"/)
    }
  })
  it('작업 폴더를 훑는 다른 블록도 앞 블록의 셸 변수에 기대지 않는다', () => {
    const bashBlocks = (t: string) => [...t.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1])
    // dflow-merge 로컬 후보 스캔: $api 를 같은 블록에서 구한다(원격 스캔 블록과 별도 호출)
    const local = bashBlocks(read('dflow-merge/SKILL.md'))
      .find((b) => b.includes('find "$d" -mindepth 2 -maxdepth 2 -name state.json'))!
    expect(local).toBeDefined()
    expect(local.indexOf('api=$(.claude/skills/dflow-work/scripts/dflow.sh config api_base); api=${api%/}'))
      .toBeGreaterThan(-1)
    expect(local.indexOf('api=$(')).toBeLessThan(local.indexOf('--arg api "$api"'))
    // dflow-team 문제 기록: $reason 을 같은 블록에서 .result 첫 줄로부터 구한다(기록 명령과 별도 호출)
    const issues = bashBlocks(read('dflow-team/SKILL.md')).find((b) => b.includes('docs/dflow-team/issues.md'))!
    expect(issues).toBeDefined()
    const bind = issues.indexOf('reason=$(')
    expect(bind).toBeGreaterThan(-1)
    expect(bind).toBeLessThan(issues.indexOf('"$reason"'))
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
  it('작업 폴더 값이 별도 Bash 호출을 건너 셸 변수로 전달되지 않는다(5·5-1 은 출력값을 플레이스홀더로 옮겨 쓴다)', () => {
    const t = read('dflow-team/SKILL.md')
    // 「5. 팀원 spawn」: 3번(TASK_DIR 을 구하는 곳) 이후, 4번 포인터부터는 $TASK_DIR 을 다시 쓰지 않는다
    const spawnStart = t.indexOf('## 5. 팀원 spawn')
    const spawnStep4 = t.indexOf('4. 포인터 **한 줄**을 만든다', spawnStart)
    const spawnEnd = t.indexOf('### 5-1. 재개 spawn')
    expect(spawnStep4).toBeGreaterThan(-1)
    expect(t.slice(spawnStep4, spawnEnd)).not.toMatch(/\$TASK_DIR\b/)
    expect(t.slice(spawnStep4, spawnEnd)).toContain('TASK_DIR=<작업 폴더>')

    // 「5-1. 재개 spawn」: 4번(TASK_DIR 을 구하는 곳) 이후, 5번부터는 $task_dir 을 다시 쓰지 않는다
    const resumeStep5 = t.indexOf('5. **슬롯을 정하고 `.dflow-agent` 를 되돌린다.**', spawnEnd)
    const resumeEnd = t.indexOf('## 6. blocked')
    expect(resumeStep5).toBeGreaterThan(-1)
    expect(t.slice(resumeStep5, resumeEnd)).not.toMatch(/\$task_dir\b/)
    expect(t.slice(resumeStep5, resumeEnd)).toContain('<4항에서 출력된 작업 폴더>')
  })
})
