// tests/components/agent-tabs.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const nav = vi.hoisted(() => ({ pathname: '/p/p1/agents' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))
import { AgentTabs } from '@/components/agent-hub/AgentTabs'

let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const tab = (k: string) => host.querySelector(`[data-agent-tab="${k}"]`) as HTMLAnchorElement

describe('AgentTabs', () => {
  it('가상 오피스가 첫 탭, 위임·승인이 둘째 탭이다 — 오피스가 에이전트 메뉴의 기본 화면(2026-09-19)', () => {
    nav.pathname = '/p/p1/agents/office'
    act(() => root.render(<AgentTabs projectId="p1" />))
    const keys = [...host.querySelectorAll('[data-agent-tab]')].map(a => a.getAttribute('data-agent-tab'))
    expect(keys).toEqual(['office', 'hub'])
  })
  it('허브 경로에서는 위임·승인이 활성, 오피스 링크는 /agents/office', () => {
    nav.pathname = '/p/p1/agents'
    act(() => root.render(<AgentTabs projectId="p1" />))
    expect(tab('hub').getAttribute('href')).toBe('/p/p1/agents')
    expect(tab('hub').getAttribute('aria-current')).toBe('page')
    expect(tab('hub').textContent).toBe('위임·승인')
    expect(tab('office').getAttribute('href')).toBe('/p/p1/agents/office')
    expect(tab('office').getAttribute('aria-current')).toBeNull()
    expect(tab('office').textContent).toBe('가상 오피스')
  })
  it('오피스 경로에서는 가상 오피스가 활성', () => {
    nav.pathname = '/p/p1/agents/office'
    act(() => root.render(<AgentTabs projectId="p1" />))
    expect(tab('office').getAttribute('aria-current')).toBe('page')
    expect(tab('hub').getAttribute('aria-current')).toBeNull()
  })
})
