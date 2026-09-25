import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// 팀장(OLD_DFLOW_DEV·OLD_DFLOW_MERGE·KIT_NOT_PUSHED)과 워커(NO_WORKER_FLAG)는 스킬 지원 여부를
// SKILL.md 의 표식 줄로 판정한다. 본문 문구를 grep 하던 시절에는 문서를 고치다 문구가 빠지면
// 테스트는 전부 통과하는데 운영의 모든 워커가 멈췄다. 표식은 frontmatter 바로 다음 줄에 둔다.
const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const grepOk = (pattern: string, file: string, extended = false) => {
  try {
    execFileSync('grep', [extended ? '-qE' : '-q', pattern, join(root, file)])
    return true
  } catch {
    return false
  }
}

describe('dflow-caps 표식', () => {
  const cases = [
    { file: '.claude/skills/dflow-dev/SKILL.md', cap: 'worker' },
    { file: '.claude/skills/dflow-merge/SKILL.md', cap: 'remote-candidates' },
  ]
  for (const { file, cap } of cases) {
    it(`${file} 는 frontmatter 바로 다음 줄에 ${cap} 표식을 둔다`, () => {
      const lines = read(file).split('\n')
      const close = lines.indexOf('---', 1)
      expect(close).toBeGreaterThan(0)
      expect(lines[close + 1]).toMatch(new RegExp(`^<!-- dflow-caps: ${cap} .*-->$`))
    })
  }

  it('팀장·워커의 판정 명령이 실제 파일에서 통과한다', () => {
    expect(grepOk('^<!-- dflow-caps: worker ', '.claude/skills/dflow-dev/SKILL.md')).toBe(true)
    expect(grepOk('^<!-- dflow-caps: remote-candidates ', '.claude/skills/dflow-merge/SKILL.md')).toBe(true)
    expect(grepOk('^<!-- dflow-caps: worker |--worker', '.claude/skills/dflow-dev/SKILL.md', true)).toBe(true)
    expect(grepOk('^<!-- dflow-caps: remote-candidates |origin/agent/\\*', '.claude/skills/dflow-merge/SKILL.md', true)).toBe(true)
  })

  it('팀장 전제 검사는 본문 문구가 아니라 표식으로 판정한다', () => {
    const team = read('.claude/skills/dflow-team/SKILL.md')
    expect(team).not.toContain("grep -q -- '--worker' .claude/skills/dflow-dev/SKILL.md")
    expect(team).not.toContain("grep -q 'origin/agent/\\*' .claude/skills/dflow-merge/SKILL.md")
  })
})
