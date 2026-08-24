import { describe, expect, it } from 'vitest'
import { isGlobalProjectBridge } from '@/components/app/ProjectNavigationContext'

/** 전역 화면 중 프로젝트 문맥(최근 메뉴)을 유지해도 되는 경로 — /usage·/portfolio 부류.
 *  /agent-ops 는 화면 자체가 없어졌다(2026-08-24 — WBS 명세 패널로 흡수). */
describe('isGlobalProjectBridge', () => {
  it('/usage 는 프로젝트 문맥을 유지하는 전역 화면이다', () => {
    expect(isGlobalProjectBridge('/usage')).toBe(true)
  })
  it('/projects 는 문맥을 접는 홈이라 제외', () => {
    expect(isGlobalProjectBridge('/projects')).toBe(false)
  })
})
