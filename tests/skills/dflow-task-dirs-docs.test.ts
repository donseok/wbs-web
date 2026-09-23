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
  it('고정 경로 docs/tasks 가 남아 있지 않다(워커의 옛 팀장 호환 폴백 한 곳만 예외)', () => {
    const FALLBACK = '`docs/tasks/{TSK}`'
    for (const f of FILES) expect(read(f).replaceAll(FALLBACK, ''), f).not.toMatch(/docs\/tasks/)
  })
  it('dflow-dev·dflow-merge·dflow-team 이 <TASKS> 를 정의한다', () => {
    for (const f of ['dflow-dev/SKILL.md', 'dflow-merge/SKILL.md', 'dflow-team/SKILL.md'])
      expect(read(f), f).toContain('작업 폴더 `<TASKS>` 는 `<DOCS_DIR>/tasks` 다')
  })
  it('팀장 exclude 패턴과 backends 필터가 DOCS_DIR 을 덮는다', () => {
    expect(read('dflow-team/SKILL.md')).toContain("'**/tasks/*/.result' '**/tasks/*/.issues'")
    expect(read('dflow-team/references/backends.md')).not.toContain('docs/tasks/<TSK>/(spec')
  })
  it('dflow-dev 가 ready 단일 파일을 격리 예외로 둔다', () => {
    const t = read('dflow-dev/SKILL.md')
    expect(t).toContain('`state.json` 하나만 있고 `phase=ready`')
    expect(t).toMatch(/`phase` 값: `ready`·`design`/)
  })
  it('팀장이 시작할 때 scaffold 를 부른다', () => {
    expect(read('dflow-team/SKILL.md')).toContain('dflow.sh scaffold')
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
  it('워커는 빈 TASK_DIR 을 실패로 끝내지 않고 옛 팀장이 보는 docs/tasks/{TSK} 로 물러선다(버전 차 호환)', () => {
    const w = read('dflow-team/references/worker-prompt.md')
    expect(w).not.toContain('failed no-task-dir')
    expect(w).toContain('**`TASK_DIR` 이 비어 있으면** `{TASK_DIR}` 을 `docs/tasks/{TSK}` 로 보고 계속한다')
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
    expect(t).toContain('printf \'%s\\n\' "$dirs" | {')
    expect(t).toContain('while IFS= read -r d; do set -- "$@" "$d/*/state.json"; done')
    expect(t).not.toContain('done <<EOF')
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

// 스킬 문서의 bash 블록은 목록 들여쓰기째 한 번의 Bash 호출로 붙여 넣어질 수 있다(최종 리뷰 #6).
// 들여쓴 here-doc 은 종결자(`     EOF`)가 인식되지 않아 뒤를 전부 삼키고 exit 0 으로 끝난다.
describe('들여쓴 bash 블록의 붙여넣기 안전성', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), '.claude/skills', p), 'utf8')
  const FILES = ['dflow-dev/SKILL.md', 'dflow-dev/references/dev-discipline.md', 'dflow-merge/SKILL.md',
    'dflow-team/SKILL.md', 'dflow-team/references/worker-prompt.md', 'dflow-team/references/backends.md',
    'dflow-team/references/events.md', 'dflow-work/SKILL.md', 'dflow-work/README.md',
    'dflow-work/references/troubleshooting.md', 'dflow-work/references/api-contract.md']
  it('목록 안(들여쓴) 코드 블록에 here-doc 이 없다', () => {
    for (const f of FILES) {
      for (const m of read(f).matchAll(/^( +)```[a-z]*\n([\s\S]*?)^\1```/gm))
        expect(m[2], `${f}: ${m[2].split('\n')[0]}`).not.toMatch(/<<-?\s*['"]?[A-Za-z_]/)
    }
  })
  it('dflow-merge 로컬 후보 스캔은 리포 최상위에서 돈다(tasks-dirs 는 최상위 기준, $f 는 <W>/<경로> 로 재사용)', () => {
    const local = [...read('dflow-merge/SKILL.md').matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1])
      .find((b) => b.includes('find "$d" -mindepth 2 -maxdepth 2 -name state.json'))!
    expect(local).toBeDefined()
    expect(local.indexOf('cd "$(git rev-parse --show-toplevel)" || exit 1')).toBeGreaterThan(-1)
    expect(local.indexOf('cd "$(git rev-parse --show-toplevel)"')).toBeLessThan(local.indexOf('config tasks-dirs'))
  })
  it('dflow-team LEGACY_REPORTED 는 tasks-dirs 를 리포 최상위 기준으로 찾는다', () => {
    expect(read('dflow-team/SKILL.md')).toContain('find "$(git rev-parse --show-toplevel)/$d" -mindepth 2 -maxdepth 2 -name state.json')
  })
  it('임시 머지 워크트리: $W 를 쓰는 뒤 호출은 가드 줄로 시작한다(빈 $W 면 호출한 체크아웃에서 머지·push·reset 된다)', () => {
    const t = read('dflow-merge/SKILL.md')
    expect(t).toContain('W="$(git rev-parse --show-toplevel)/.claude/worktrees/dflow-merge"; [ -e "$W/.git" ] || { echo NO_MERGE_WT; exit 1; }')
    expect(t).not.toContain('별도 호출로 나누면 그 블록이 만든 실제 경로를 `<W>` 자리에 옮겨 적는다')
  })
})
