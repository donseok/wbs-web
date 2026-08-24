import { describe, expect, it } from 'vitest'
import { ITEM_DETAIL_COLUMNS } from '@/lib/agent/depends'

/** PAT 상세 응답(spec.md 캐시 재료)에 사용자 에이전트 프롬프트가 실려야 /dflow-dev 가 지시로 반영한다. */
describe('ITEM_DETAIL_COLUMNS', () => {
  it('agent_prompt 를 포함한다', () => {
    expect(ITEM_DETAIL_COLUMNS.split(',').map(c => c.trim())).toContain('agent_prompt')
  })
})
