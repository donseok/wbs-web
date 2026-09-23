// 자동 재시작 안내와 중단 표식 정리 주체(G3) 문장(스펙 §3 G3·§11).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const HELP = readFileSync('.claude/skills/dflow-team/references/help.md', 'utf8')
const DEV = readFileSync('.claude/skills/dflow-dev/SKILL.md', 'utf8')
const KIT = readFileSync('kit/README.md', 'utf8')
const HOOK = readFileSync('kit/hooks/heartbeat.sh', 'utf8')

describe('자동 재시작 안내·G3', () => {
  it('help 에 자동 재시작 한 문단이 있다', () => {
    expect(HELP).toContain('- **자동 재시작**:')
    expect(HELP).toMatch(/최대 3번/)
    expect(HELP).toMatch(/--resume <id8>/)
  })
  it('dflow-dev 는 "재위임 때 지운다" 대신 팀장이 spawn 직전에 지운다고 적는다', () => {
    expect(DEV).not.toContain('위임받아 이어 갈 때만 그 파일을 지운다')
    expect(DEV).toContain('`/dflow-team` 팀장이 spawn 직전에 서버 status(`ready`·`claimed`)로 확인하고 지운다')
    expect(DEV).toMatch(/수동 `\/dflow-dev` 세션은 사람이\s+지운다/)
  })
  it('kit README 도 같은 뜻으로 고친다', () => {
    expect(KIT).not.toContain('같은 주문을 다시 위임받아 이어 가려면 표식 파일을 지운다.')
    expect(KIT).toContain('`/dflow-team` 팀장은 spawn 직전에 서버 status 로 확인하고 낡은 표식을 지운다')
  })
  it('훅은 표식을 지우지 않는다(G3: 훅은 고치지 않는다)', () => {
    expect(HOOK).not.toMatch(/rm[^\n]*\.cancelled/)
  })
})
