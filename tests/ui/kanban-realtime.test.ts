// 칸반 실시간 배선 — 에이전트 done 보고가 카드를 새로고침 없이 옮기도록 0098 채널 재조회를 둔다(2026-09-18).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(process.cwd(), 'src/app/(app)/p/[projectId]/kanban/page.tsx'), 'utf8')

describe('칸반 페이지 — 실시간 재조회', () => {
  it('WbsRealtimeRefresh 를 그 프로젝트로 건다', () => {
    expect(src).toMatch(/<WbsRealtimeRefresh projectId=\{projectId\}/)
  })
  it('대시보드 기본값(10초)보다 짧은 창을 쓴다 — 조작 화면이다', () => {
    expect(src).toMatch(/delayMs=\{1_500\}/)
    expect(src).toMatch(/maxWaitMs=\{5_000\}/)
  })
})
