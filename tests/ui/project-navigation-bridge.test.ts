import { describe, expect, it } from 'vitest'
import { isGlobalProjectBridge } from '@/components/app/ProjectNavigationContext'

/** 전역 화면 중 프로젝트 문맥(최근 메뉴)을 유지해도 되는 경로 — /usage·/portfolio 와 같은 부류에 /agent-ops 추가 */
describe('isGlobalProjectBridge', () => {
  it('/agent-ops 는 프로젝트 문맥을 유지하는 전역 화면이다', () => {
    expect(isGlobalProjectBridge('/agent-ops')).toBe(true)
  })
  it('/projects 는 문맥을 접는 홈이라 제외', () => {
    expect(isGlobalProjectBridge('/projects')).toBe(false)
  })
})
