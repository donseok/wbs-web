// @vitest-environment jsdom
// 결정 목록 표시 부품(과제 C, 스펙 §7). 에이전트 입력이므로 텍스트로만 그린다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DecisionList } from '@/components/agent-hub/DecisionList'
import type { AgentDecision } from '@/lib/domain/agentWork'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const D2: AgentDecision = {
  key: 'D2', question: '판정 로직을 이 Task 에서 넣는가?',
  options: ['넣지 않는다(spec 제약 우선)', '넣는다(선행 배정 우선)', '반만 넣는다'], chosen: 0,
  rationale: 'spec 본문이 넣지 않는다고 적었다.', on_reject: '판정 로직을 verdict.ts 로 옮긴다.',
}

let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

describe('DecisionList', () => {
  it('결정마다 번호·질문·택한 것(굵게)·다른 선택지·근거·반려 시 방향을 보이고 머리에 출처를 적는다', () => {
    act(() => root.render(<DecisionList decisions={{ state: 'ok', items: [D2] }} />))
    expect(host.textContent).toContain('에이전트가 적은 결정 1건')
    const li = host.querySelector('[data-decision="D2"]')!
    expect(li.textContent).toContain('판정 로직을 이 Task 에서 넣는가?')
    expect(li.querySelector('[data-decision-chosen]')!.textContent).toBe('넣지 않는다(spec 제약 우선)')
    expect([...li.querySelectorAll('[data-decision-other]')].map(e => e.textContent)).toEqual(['넣는다(선행 배정 우선)', '반만 넣는다'])
    expect(li.textContent).toContain('spec 본문이 넣지 않는다고 적었다.')
    expect(li.textContent).toContain('판정 로직을 verdict.ts 로 옮긴다.')
  })
  it('에이전트가 적은 HTML·마크다운은 글자 그대로 보이고 요소가 생기지 않는다', () => {
    const evil = { ...D2, rationale: '<script>alert(1)</script> **굵게** <img src=x onerror=alert(1)>' }
    act(() => root.render(<DecisionList decisions={{ state: 'ok', items: [evil] }} />))
    expect(host.querySelector('script')).toBeNull()
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('strong')).toBeNull()
    expect(host.textContent).toContain('<script>alert(1)</script> **굵게** <img src=x onerror=alert(1)>')
  })
  it('0건([])은 아무것도 그리지 않는다', () => {
    act(() => root.render(<DecisionList decisions={{ state: 'ok', items: [] }} />))
    expect(host.innerHTML).toBe('')
  })
  it('미제출(null)은 0건이 아니라 따로 알린다', () => {
    act(() => root.render(<DecisionList decisions={{ state: 'none' }} />))
    expect(host.querySelector('[data-decisions="none"]')!.textContent).toBe('결정 목록 미제출(구버전 보고) — 요약을 확인하세요')
  })
  it('형식 오류는 따로 알리고 로그를 남긴다', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => root.render(<DecisionList decisions={{ state: 'invalid' }} />))
    expect(host.querySelector('[data-decisions="invalid"]')!.textContent).toBe('결정 목록을 읽지 못했습니다 — 요약을 확인하세요')
    expect(spy).toHaveBeenCalled()
  })
})
