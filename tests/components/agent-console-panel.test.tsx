// tests/components/agent-console-panel.test.tsx — 오피스 콘솔 화면 틀과 입력 정리 규칙(2026-10-06).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AgentConsolePanel, type ConsoleTarget } from '@/components/agents/AgentConsolePanel'
import { CONSOLE_TEXT_MAX, consoleTextIssue, normalizeConsoleText } from '@/lib/domain/agentConsole'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const NOW = Date.parse('2026-10-06T09:00:00Z')
const target: ConsoleTarget = { kind: 'team_worker', key: 'hong/mbp/w1', label: '팀원 1' }

let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

type Props = Parameters<typeof AgentConsolePanel>[0]
const render = (over: Partial<Props> = {}) =>
  act(() => root.render(<AgentConsolePanel target={target} nowMs={NOW} canSend canView draft="" onDraftChange={() => {}} {...over} />))
const q = (sel: string) => host.querySelector(sel)
const sendBtn = () => q('[data-console-send]') as HTMLButtonElement

describe('normalizeConsoleText · consoleTextIssue', () => {
  it('줄바꿈·탭은 공백 하나로(접지 않는다), 나머지 제어 문자는 지우고 앞뒤 공백을 자른다', () => {
    expect(normalizeConsoleText('  가\r\n나\n다\r라\t마\u0007바\u009b  ')).toBe('가 나 다 라 마바')
    expect(normalizeConsoleText('a\n\nb')).toBe('a  b')
    expect(normalizeConsoleText('a\u0085b\u2028c\u2029d\vf\fg')).toBe('a b c d f g')
  })
  it('C0·DEL·C1·ESC 는 지우고 C1 바로 뒤(U+00A0)는 남긴다', () => {
    expect(normalizeConsoleText('a\u001b[31mb\u007fc\u0080d\u009fe\u00a0f')).toBe('a[31mbcde\u00a0f')
  })
  it('양방향 재정의·폭 없는 문자·BOM 을 지운다', () => {
    expect(normalizeConsoleText('a\u202eb\u200bc\u2066d\ufeffe')).toBe('abcde')
  })
  it('태그 문자는 지우고 ZWJ 이모지 조합은 남긴다', () => {
    expect(normalizeConsoleText('a\u{E0041}b')).toBe('ab')
    expect(normalizeConsoleText('👨\u200D👩')).toBe('👨\u200D👩')
  })
  it('제어 문자만 있으면 정리 뒤 비어 empty', () => {
    expect(consoleTextIssue(normalizeConsoleText('\u0001\n\t'))).toBe('empty')
  })
  it('빈 글 · 느낌표 · 길이 초과를 거절한다', () => {
    expect(consoleTextIssue('')).toBe('empty')
    expect(consoleTextIssue('빌드 다시 해!')).toBe('bang')
    expect(consoleTextIssue('a'.repeat(CONSOLE_TEXT_MAX))).toBeNull()
    expect(consoleTextIssue('a'.repeat(CONSOLE_TEXT_MAX + 1))).toBe('too_long')
    expect(consoleTextIssue('!' + 'a'.repeat(CONSOLE_TEXT_MAX + 1))).toBe('bang')
  })
  it('길이는 코드포인트로 센다(이모지 하나 = 1)', () => {
    expect(consoleTextIssue('😀'.repeat(CONSOLE_TEXT_MAX))).toBeNull()
  })
})

describe('AgentConsolePanel — 보내기', () => {
  it('본인이 아니면 입력창 대신 안내를 보인다', () => {
    render({ canSend: false })
    expect(q('[data-console-input]')).toBeNull()
    expect(q('[data-console-send-blocked]')?.textContent).toContain('주인 본인만')
  })
  it('onSend 가 없으면(데이터 연결 전) 글이 있어도 잠긴다', () => {
    render({ draft: '상태 알려줘' })
    expect(sendBtn().disabled).toBe(true)
  })
  it('글이 정상이면 열리고 누르면 정리된 본문으로 onSend 를 부른다', () => {
    const sent: string[] = []
    render({ draft: ' 상태\n알려줘 ', onSend: t => { sent.push(t) } })
    expect(sendBtn().disabled).toBe(false)
    act(() => sendBtn().click())
    expect(sent).toEqual(['상태 알려줘'])
  })
  it('길이는 정리 뒤에 잰다 — 2000자 + 꼬리 줄바꿈은 열리고 2001자는 잠근다', () => {
    render({ draft: 'a'.repeat(CONSOLE_TEXT_MAX) + '\n\n', onSend: () => {} })
    expect(sendBtn().disabled).toBe(false)
    render({ draft: 'a'.repeat(CONSOLE_TEXT_MAX + 1), onSend: () => {} })
    expect(sendBtn().disabled).toBe(true)
    expect(q('[data-console-hint]')?.textContent).toContain('넘으면')
    expect(q('[data-console-input]')?.getAttribute('aria-invalid')).toBe('true')
  })
  it('입력하면 onDraftChange 로 원문을 넘긴다', () => {
    const seen: string[] = []
    render({ onDraftChange: t => { seen.push(t) } })
    const ta = q('[data-console-input]') as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => { setter.call(ta, '상태\n알려줘'); ta.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(seen).toEqual(['상태\n알려줘'])
  })
  it('보내는 중에는 잠그고 입력창을 읽기 전용으로 둔다', () => {
    render({ draft: '상태', onSend: () => {}, sending: true })
    expect(sendBtn().disabled).toBe(true)
    expect(sendBtn().textContent).toBe('보내는 중…')
    expect((q('[data-console-input]') as HTMLTextAreaElement).readOnly).toBe(true)
  })
  it('보내기 실패 문구와 맞춤 차단 문구를 보인다', () => {
    render({ sendError: '1분에 5건까지 보낼 수 있습니다.' })
    expect(q('[data-console-send-error]')?.textContent).toBe('1분에 5건까지 보낼 수 있습니다.')
    render({ canSend: false, sendBlockedReason: '옛 형식 팀장에게는 보낼 수 없습니다.' })
    expect(q('[data-console-send-blocked]')?.textContent).toBe('옛 형식 팀장에게는 보낼 수 없습니다.')
  })
  it('느낌표가 있으면 잠그고 이유를 보인다', () => {
    render({ draft: '다시 해!', onSend: () => {} })
    expect(sendBtn().disabled).toBe(true)
    expect(q('[data-console-hint]')?.textContent).toContain('느낌표')
  })
  it('빈 글은 잠그지만 경고하지 않는다', () => {
    render({ draft: '  ', onSend: () => {} })
    expect(sendBtn().disabled).toBe(true)
    expect(q('[data-console-hint]')?.textContent).toContain(`0/${CONSOLE_TEXT_MAX.toLocaleString()}자`)
  })
})

describe('AgentConsolePanel — 전달 상태', () => {
  it('undefined 면 표를 그리지 않는다', () => {
    render()
    expect(q('[data-console-prompts]')).toBeNull()
    expect(q('[data-console-prompts-empty]')).toBeNull()
  })
  it('null 은 조회 실패로 보이고 빈 목록과 구별한다', () => {
    render({ prompts: null })
    expect(q('[data-console-prompts-error]')).not.toBeNull()
    render({ prompts: [] })
    expect(q('[data-console-prompts-empty]')).not.toBeNull()
    expect(q('[data-console-prompts-error]')).toBeNull()
  })
  it('재조회만 실패하면 지난 목록과 실패 문구를 함께 보인다', () => {
    render({ prompts: [{ id: 'a', text: '하나', status: 'pending', reason: null, createdAt: new Date(NOW).toISOString() }], promptsError: '재조회 실패' })
    expect(q('[data-console-prompts-error]')?.textContent).toBe('재조회 실패')
    expect(host.querySelectorAll('[data-console-prompt]')).toHaveLength(1)
  })
  it('모르는 상태·깨진 시각은 알 수 없음·— 로 보인다', () => {
    render({ prompts: [{ id: 'a', text: '하나', status: 'teleported', reason: null, createdAt: 'nope' }] })
    const row = q('[data-console-prompt]')
    expect(row?.getAttribute('data-console-prompt')).toBe('unknown')
    expect(row?.textContent).toContain('알 수 없음')
    expect(row?.textContent).toContain('—')
  })
  it('상태 라벨과 거절 사유를 보인다', () => {
    render({ prompts: [
      { id: 'a', text: '하나', status: 'sent', reason: null, createdAt: new Date(NOW - 60_000).toISOString() },
      { id: 'b', text: '둘', status: 'refused', reason: '입력창 잠김', createdAt: new Date(NOW - 5_000).toISOString() },
    ] })
    const rows = [...host.querySelectorAll('[data-console-prompt]')]
    expect(rows.map(r => r.getAttribute('data-console-prompt'))).toEqual(['sent', 'refused'])
    expect(rows[0].textContent).toContain('전달')
    expect(rows[1].querySelector('[data-console-reason]')?.textContent).toBe('사유: 입력창 잠김')
  })
})

describe('AgentConsolePanel — 최근 화면', () => {
  it('볼 수 없으면 화면 대신 안내하고 찍은 시각도 숨긴다', () => {
    render({ canView: false, screen: { lines: ['x'], capturedAt: new Date(NOW - 60_000).toISOString() } })
    expect(q('[data-console-screen]')).toBeNull()
    expect(q('[data-console-screen-blocked]')).not.toBeNull()
    expect(host.textContent).not.toContain('1분 전')
  })
  it('읽는 중 · 없음 · 빈 줄 · 실패를 구별한다', () => {
    render({ screen: undefined })
    expect(q('[data-console-screen-loading]')).not.toBeNull()
    render({ screen: null })
    expect(q('[data-console-screen-empty]')).not.toBeNull()
    render({ screen: { lines: [], capturedAt: new Date(NOW).toISOString() } })
    expect(q('[data-console-screen-empty]')).not.toBeNull()
    render({ screen: null, screenError: '화면 조회에 실패했습니다.' })
    expect(q('[data-console-screen-error]')?.textContent).toBe('화면 조회에 실패했습니다.')
  })
  it('끝 40줄만 그린다', () => {
    const lines = Array.from({ length: 45 }, (_, i) => `줄${i + 1}`)
    render({ screen: { lines, capturedAt: new Date(NOW - 30_000).toISOString() } })
    const text = q('[data-console-screen]')?.textContent ?? ''
    expect(text.split('\n')).toHaveLength(40)
    expect(text.startsWith('줄6')).toBe(true)
  })
})
