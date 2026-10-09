// 자동 재시작 안내와 중단 표식 정리 주체(G3) 문장(스펙 §3 G3·§11).
import { describe, expect, it } from 'vitest'
import { devAll } from './_dflow-dev'
import { readFileSync } from 'node:fs'

const HELP = readFileSync('.claude/skills/dflow-team/references/help.md', 'utf8')
const DEV = devAll()
const KIT = readFileSync('kit/README.md', 'utf8')
const HOOK = readFileSync('kit/hooks/heartbeat.sh', 'utf8')

describe('자동 재시작 안내·G3', () => {
  it('help 에 자동 재시작 한 문단이 있다', () => {
    expect(HELP).toContain('- 자동 재시작:')
    expect(HELP).toMatch(/최대 3번/)
    expect(HELP).toMatch(/--resume <id8>/)
  })
  it('dflow-dev 는 "재위임 때 지운다" 대신 팀장이 spawn 직전에 지운다고 적는다', () => {
    expect(DEV).not.toContain('위임받아 이어 갈 때만 그 파일을 지운다')
    // 규칙은 dflow-dev 문서에서 dflow-team restart.md 「중단 표식 정리」 로 옮겨졌다.
    const RESTART = readFileSync('.claude/skills/dflow-team/references/restart.md', 'utf8')
    expect(RESTART).toContain('그래서 팀장이 **모든 spawn(새 작업·재개·재시작) 직전**에 지움.')
    expect(RESTART).toContain('`.order.status` 가 `ready`(새 작업) 또는 `claimed`(재개·재시작)')
    expect(RESTART).toContain('수동 `/dflow-dev` 세션의 표식은 사람이 지움')
  })
  it('kit README 도 같은 뜻으로 고친다', () => {
    expect(KIT).not.toContain('같은 주문을 다시 위임받아 이어 가려면 표식 파일을 지운다.')
    expect(KIT).toContain('`/dflow-team` 팀장은 spawn 직전에 서버 status 로 확인하고 낡은 표식을 지운다')
  })
  it('훅은 표식을 지우지 않는다(G3: 훅은 고치지 않는다)', () => {
    expect(HOOK).not.toMatch(/rm[^\n]*\.cancelled/)
  })
})
