// tests/skills/dflow-team-extend.test.ts
// 실행 중 종료 시각 연장·.vitest 부산물·not-assignee(2026-09-19 mdm-dict-v2 실측).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const team = readFileSync(join(ROOT, '.claude/skills/dflow-team/SKILL.md'), 'utf8')
const events = readFileSync(join(ROOT, '.claude/skills/dflow-team/references/events.md'), 'utf8')
const prompt = readFileSync(join(ROOT, '.claude/skills/dflow-team/references/worker-prompt.md'), 'utf8')

describe('실행 중 연장', () => {
  it('연장은 team.extend 로 기록하고 team.start 를 새로 쓰지 않는다', () => {
    expect(team).toContain('`team.extend`(until, until_label)를 기록한다')
    expect(team).toContain('**`team.start` 를 새로 쓰지 않는다.**')
    expect(events).toContain('| `team.extend` | 「인자」 실행 중 연장 | `until`, `until_label` |')
    expect(events).toContain('"team.extend":["until","until_label"]')
  })
  it('재구성은 마지막 team.extend 를 team.start 보다 우선한다', () => {
    expect(team).toContain('종료 시각(`<UNTIL>`·`<UNTIL_LABEL>`)은 **마지막 `team.extend`** 의 `until`·`until_label` 이고')
  })
  it('옛 poll 의 exit 8 은 연장된 시각과 대조해 무시하고, 마감 중 연장은 마감을 취소한다', () => {
    expect(team).toContain('먼저 지금 시각이 현재 `<UNTIL>`(연장 반영) 전인지 본다')
    expect(team).toContain('**마감 중에 연장하면 마감을 취소한다.**')
  })
})

describe('워커 부산물과 배정 불일치', () => {
  it('.vitest/ 를 공유 exclude 에 넣는다', () => {
    expect(team).toContain(`for p in '**/.claude/worktrees/' '/dflow-*/' '.vitest/' '/.dflow-agent'`)
  })
  it('failed not-assignee 는 영구 제외이되 차단기에 세지 않고, 푼 작업은 poll 이 돌려준 것만 띄운다', () => {
    expect(team).toContain('| `failed not-assignee` | 해제 | 영구 제외 |')
    expect(team).toContain('**차단기 계산에 넣지 않는다**')
    expect(team).toContain('**푼 작업을 팀장이 직접 띄우지 않는다.**')
    expect(prompt).toContain('`not-assignee`(claim 이 `not_assignee` 로 거부됨')
  })
})
