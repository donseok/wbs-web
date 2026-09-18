import { describe, expect, it } from 'vitest'
import { resumeHostFromClaimLabel } from '@/lib/domain/agentWork'

describe('resumeHostFromClaimLabel — 재개 요청이 지목할 PC', () => {
  it('단독 러너 라벨에서 claude- 접두어를 뗀다', () => {
    expect(resumeHostFromClaimLabel('claude-Jji-MacBookPro')).toBe('jji-macbookpro')
  })
  it('팀원 라벨은 둘째 칸이 호스트다', () => {
    expect(resumeHostFromClaimLabel('jjinie73/jji-mac/w2')).toBe('jji-mac')
  })
  it('watch 가 보내는 host 와 같은 슬러그 규칙을 쓴다', () => {
    // dflow.sh: slug() = 소문자 + [a-z0-9-] 밖은 '-'
    expect(resumeHostFromClaimLabel('claude-Host_A.local')).toBe('host-a-local')
  })
  it('호스트를 못 읽으면 null 이다 — 아무 PC 나 가져가게 두지 않는다', () => {
    expect(resumeHostFromClaimLabel(null)).toBeNull()
    expect(resumeHostFromClaimLabel('   ')).toBeNull()
    expect(resumeHostFromClaimLabel('claude-')).toBeNull()
    expect(resumeHostFromClaimLabel('who/ /w1')).toBeNull()
  })
})
