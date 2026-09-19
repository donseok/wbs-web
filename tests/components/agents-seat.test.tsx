// tests/components/agents-seat.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Sprite } from '@/components/agents/Sprite'
import { SeatCard, seatMetaLine, STATE_LABEL } from '@/components/agents/Seat'
import { ZoneBlock } from '@/components/agents/ZoneBlock'
import { FloorCard } from '@/components/agents/FloorCard'
import type { Floor, Seat, Zone } from '@/lib/domain/seatmap'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const NOW = Date.parse('2026-09-14T09:00:00Z')
const seat = (over: Partial<Seat> = {}): Seat => ({
  orderId: '11111111-1111-4111-8111-111111111111', id8: '11111111', projectId: 'p1', itemId: 'i1',
  code: 'TSK-04-02', name: '주문 상세', state: 'ACTIVE', phase: 'build', anim: 'typing', character: 'cat',
  agent: 'hong/mbp/w1', progress: 60, lastSignalAt: new Date(NOW - 42_000).toISOString(),
  heartbeatAt: new Date(NOW - 42_000).toISOString(), heartbeatPhase: 'build', note: null, rejected: false, reviewNote: null, waitReason: null, canManage: true, assigneeMine: false, ...over,
})

let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Sprite', () => {
  it('캐릭터·동작으로 배경 이미지와 프레임 수 클래스를 정한다', () => {
    act(() => root.render(<Sprite character="cat" anim="idle_coffee" />))
    const el = host.querySelector('[data-sprite]') as HTMLElement
    expect(el.style.backgroundImage).toContain('/sprites/cat/idle_coffee.png')
    expect(el.dataset.frames).toBe('6')
    expect(el.style.getPropertyValue('--frames')).toBe('6')
    expect(el.style.getPropertyValue('--fps')).toBe('2')
  })
  it('empty 는 공용 빈 의자 1프레임', () => {
    act(() => root.render(<Sprite character="cat" anim="empty" />))
    const el = host.querySelector('[data-sprite]') as HTMLElement
    expect(el.style.backgroundImage).toContain('/sprites/empty.png')
    expect(el.dataset.frames).toBe('1')
  })
  it('되감기는 stale 에만 붙는다 — 다른 동작은 양 끝이 극단이 아니라 주기만 두 배가 된다', () => {
    act(() => root.render(<Sprite character="cat" anim="stale" />))
    expect((host.querySelector('[data-sprite]') as HTMLElement).dataset.alt).toBe('1')
    for (const a of ['typing', 'blocked', 'idle_look', 'rejected'] as const) {
      act(() => root.render(<Sprite character="cat" anim={a} />))
      expect((host.querySelector('[data-sprite]') as HTMLElement).dataset.alt).toBeUndefined()
    }
  })
  it('글자가 그려진 세 동작만 좌우 반전을 되돌린다', () => {
    for (const a of ['blocked', 'stale', 'rejected'] as const) {
      act(() => root.render(<Sprite character="cat" anim={a} />))
      expect((host.querySelector('[data-sprite]') as HTMLElement).dataset.glyph).toBe('1')
    }
    act(() => root.render(<Sprite character="cat" anim="typing" />))
    expect((host.querySelector('[data-sprite]') as HTMLElement).dataset.glyph).toBeUndefined()
  })
  it('done 은 작업한 캐릭터의 기지개 시트 가운데 장에 멈추고, waiting 은 두리번 시트 실루엣이다(안 A)', () => {
    act(() => root.render(<Sprite character="cat" anim="done" />))
    const d = host.querySelector('[data-sprite]') as HTMLElement
    expect(d.style.backgroundImage).toContain('/sprites/cat/idle_stretch.png')
    expect(d.dataset.still).toBe('1')
    expect(d.dataset.anim).toBe('done')
    expect(d.style.getPropertyValue('--pose-frame')).toBe('2') // 5장 중 가운데
    act(() => root.render(<Sprite character="dog" anim="waiting" />))
    const w = host.querySelector('[data-sprite]') as HTMLElement
    expect(w.style.backgroundImage).toContain('/sprites/dog/idle_look.png')
    expect(w.dataset.ghost).toBe('1')
    expect(w.dataset.still).toBeUndefined()
    expect(w.dataset.frames).toBe('6')
  })
  it('reduceMotion 이면 정지 표식', () => {
    act(() => root.render(<Sprite character="cat" anim="typing" reduceMotion />))
    expect((host.querySelector('[data-sprite]') as HTMLElement).dataset.still).toBe('1')
  })
})

describe('SeatCard', () => {
  it('책상 버튼에 코드·이름·메타·상태가 있고 클릭하면 orderId 로 선택된다', () => {
    let picked = ''
    act(() => root.render(<SeatCard seat={seat()} side="left" selected={false} nowMs={NOW} busy={false} onSelect={id => { picked = id }} onOp={() => {}} />))
    const btn = host.querySelector('button') as HTMLButtonElement
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(btn.textContent).toContain('TSK-04-02')
    expect(btn.textContent).toContain('주문 상세')
    expect(btn.textContent).toContain('hong/mbp/w1 · 42초 전')
    expect((host.querySelector('[data-state]') as HTMLElement).dataset.state).toBe('ACTIVE')
    act(() => btn.click())
    expect(picked).toBe('11111111-1111-4111-8111-111111111111')
  })
  it('상태 표지는 아이콘 하나로 갈렸다 — BLOCKED 는 질문도 같이 보인다', () => {
    act(() => root.render(<SeatCard seat={seat({ state: 'BLOCKED', note: '어느 DB?' })} side="right" selected nowMs={NOW} busy={false} onSelect={() => {}} onOp={() => {}} />))
    expect((host.querySelector('[data-mark]') as HTMLElement).dataset.mark).toBe('BLOCKED')
    expect(host.textContent).toContain('어느 DB?')
    act(() => root.render(<SeatCard seat={seat({ state: 'STALE' })} side="right" selected={false} nowMs={NOW} busy={false} onSelect={() => {}} onOp={() => {}} />))
    expect((host.querySelector('[data-mark]') as HTMLElement).dataset.mark).toBe('STALE')
    act(() => root.render(<SeatCard seat={seat({ state: 'OFFLINE' })} side="right" selected={false} nowMs={NOW} busy={false} onSelect={() => {}} onOp={() => {}} />))
    expect((host.querySelector('[data-mark]') as HTMLElement).dataset.mark).toBe('OFFLINE')
    // 빈자리에는 표지가 없다
    act(() => root.render(<SeatCard seat={seat({ state: 'READY' })} side="left" selected={false} nowMs={NOW} busy={false} onSelect={() => {}} onOp={() => {}} />))
    expect(host.querySelector('[data-mark]')).toBeNull()
  })

  it('상태에 맞는 결재 버튼이 좌석에 붙는다 — 승인 대기는 승인·반려, 업무 중은 회수, 빈자리는 없다', () => {
    const seen: string[] = []
    act(() => root.render(<SeatCard seat={seat({ state: 'WAIT' })} side="left" selected={false} nowMs={NOW} busy={false} onSelect={() => {}} onOp={(_s, k) => { seen.push(k) }} />))
    expect([...host.querySelectorAll('[data-seat-op]')].map(b => (b as HTMLElement).dataset.seatOp)).toEqual(['approve', 'reject'])
    act(() => (host.querySelector('[data-seat-op="approve"]') as HTMLButtonElement).click())
    expect(seen).toEqual(['approve'])
    act(() => root.render(<SeatCard seat={seat({ state: 'ACTIVE' })} side="left" selected={false} nowMs={NOW} busy={false} onSelect={() => {}} onOp={() => {}} />))
    expect([...host.querySelectorAll('[data-seat-op]')].map(b => (b as HTMLElement).dataset.seatOp)).toEqual(['release'])
    act(() => root.render(<SeatCard seat={seat({ state: 'READY' })} side="left" selected={false} nowMs={NOW} busy={false} onSelect={() => {}} onOp={() => {}} />))
    expect(host.querySelectorAll('[data-seat-op]')).toHaveLength(0)
  })

  it('완료는 체크 표지, 선행 대기는 모래시계 표지 — 다른 사유의 READY 는 표지가 없다', () => {
    act(() => root.render(<SeatCard seat={seat({ state: 'DONE', anim: 'done' })} side="left" selected={false} nowMs={NOW} busy={false} onSelect={() => {}} onOp={() => {}} />))
    expect(host.querySelector('[data-mark="DONE"]')).not.toBeNull()
    act(() => root.render(<SeatCard seat={seat({ state: 'READY', anim: 'waiting', waitReason: { kind: 'dependency', label: '선행 대기', text: '' } })} side="left" selected={false} nowMs={NOW} busy={false} onSelect={() => {}} onOp={() => {}} />))
    expect(host.querySelector('[data-mark="waiting"]')?.getAttribute('title')).toBe('선행 대기')
    act(() => root.render(<SeatCard seat={seat({ state: 'READY', anim: 'empty', waitReason: { kind: 'pickup', label: '착수 대기', text: '' } })} side="left" selected={false} nowMs={NOW} busy={false} onSelect={() => {}} onOp={() => {}} />))
    expect(host.querySelector('[data-mark]')).toBeNull()
  })
  it('처리 중이면 결재 바가 잠긴다', () => {
    act(() => root.render(<SeatCard seat={seat({ state: 'WAIT' })} side="left" selected={false} nowMs={NOW} busy onSelect={() => {}} onOp={() => {}} />))
    for (const b of host.querySelectorAll('[data-seat-op]')) expect((b as HTMLButtonElement).disabled).toBe(true)
  })

  it('자격이 없으면 결재 버튼이 비활성이고 이유가 붙는다 — 반려는 담당자 본인도 할 수 있다', () => {
    act(() => root.render(<SeatCard seat={seat({ state: 'WAIT', canManage: false, assigneeMine: false })} side="left" selected={false} nowMs={NOW} busy={false} onSelect={() => {}} onOp={() => {}} />))
    expect((host.querySelector('[data-seat-op="approve"]') as HTMLButtonElement).disabled).toBe(true)
    expect((host.querySelector('[data-seat-op="approve"]') as HTMLButtonElement).title).toContain('권한이 없습니다')
    act(() => root.render(<SeatCard seat={seat({ state: 'WAIT', canManage: false, assigneeMine: true })} side="left" selected={false} nowMs={NOW} busy={false} onSelect={() => {}} onOp={() => {}} />))
    expect((host.querySelector('[data-seat-op="approve"]') as HTMLButtonElement).disabled).toBe(true)
    expect((host.querySelector('[data-seat-op="reject"]') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('seatMetaLine · STATE_LABEL', () => {
  it('상태별 문구', () => {
    expect(seatMetaLine(seat(), NOW)).toBe('hong/mbp/w1 · 42초 전')
    expect(seatMetaLine(seat({ state: 'STALE' }), NOW)).toBe('hong/mbp/w1 · 무응답 42초 전')
    expect(seatMetaLine(seat({ state: 'OFFLINE', phase: 'build' }), NOW)).toBe('build 에서 끊김 · 42초 전')
    expect(seatMetaLine(seat({ state: 'WAIT' }), NOW)).toBe('승인 대기')
    expect(seatMetaLine(seat({ state: 'READY', agent: null }), NOW)).toBe('미착수')
    expect(seatMetaLine(seat({ state: 'READY', agent: null, waitReason: { kind: 'agent_off', label: '에이전트 꺼짐', text: '…' } }), NOW)).toBe('에이전트 꺼짐')
    expect(seatMetaLine(seat({ state: 'BLOCKED' }), NOW)).toBe('hong/mbp/w1 · 결정 대기')
    expect(STATE_LABEL.REJECTED).toBe('반려 · 재작업')
  })
})

const zone = (over: Partial<Zone>): Zone => ({ key: 'z', code: 'WP-04', name: '주문 관리', seats: [], summary: { work: 0, wait: 0, ready: 0, done: 0 }, ...over })
const emptySeat = (n: number): Seat => seat({ orderId: `e${n}`, id8: `e${n}`, code: `TSK-05-0${n}`, name: `빈 항목 ${n}`, state: 'READY', phase: 'design', anim: 'empty', agent: null, progress: 0, lastSignalAt: null, heartbeatAt: null, heartbeatPhase: null })
const floor = (zones: Zone[]): Floor => ({ id: 'p1', name: 'mes-base', zones, seatCount: zones.reduce((n, z) => n + z.seats.length, 0), doneCount: 0, watchers: [] })

describe('ZoneBlock', () => {
  it('onFold 가 있으면 접기 버튼을 그리고 누르면 호출된다', () => {
    let folded = 0
    act(() => root.render(<ZoneBlock zone={zone({ seats: [emptySeat(1)], summary: { work: 0, wait: 0, ready: 1, done: 0 } })} selectedId={null} nowMs={NOW} busyOrderId={null} onSelect={() => {}} onOp={() => {}} onFold={() => { folded++ }} />))
    const fold = host.querySelector('button[aria-label="구역 접기"]') as HTMLButtonElement
    expect(fold).not.toBeNull()
    act(() => fold.click())
    expect(folded).toBe(1)
  })
  it('onFold 가 없으면 접기 버튼이 없다', () => {
    act(() => root.render(<ZoneBlock zone={zone({ seats: [seat()], summary: { work: 1, wait: 0, ready: 0, done: 0 } })} selectedId={null} nowMs={NOW} busyOrderId={null} onSelect={() => {}} onOp={() => {}} />))
    expect(host.querySelector('button[aria-label="구역 접기"]')).toBeNull()
  })
})

describe('FloorCard — 모든 구역은 기본 펼침이고, 접으면 아이콘이 된다(2026-09-19)', () => {
  const busy = zone({ key: 'a', code: 'WP-04', name: '주문 관리', seats: [seat({ state: 'WAIT', phase: 'reported', anim: 'idle_coffee' })], summary: { work: 0, wait: 1, ready: 0, done: 0 } })
  const empty = zone({ key: 'b', code: 'WP-05', name: '재고 관리', seats: [emptySeat(1), emptySeat(2)], summary: { work: 0, wait: 0, ready: 2, done: 0 } })
  const foldOf = (code: string) => [...host.querySelectorAll('button[aria-label="구역 접기"]')].find(b => b.parentElement?.textContent?.includes(code)) as HTMLButtonElement

  it('빈 구역도 처음부터 책상을 그린다 — 접힌 구역 아이콘 줄이 없다', () => {
    act(() => root.render(<FloorCard floor={floor([busy, empty])} selectedId={null} nowMs={NOW} busyOrderId={null} onSelect={() => {}} onOp={() => {}} />))
    expect(host.querySelector('button[aria-label^="TSK-04-02"]')).not.toBeNull()
    expect(host.querySelector('button[aria-label^="TSK-05-01"]')).not.toBeNull()
    expect(host.querySelector('button[aria-expanded="false"]')).toBeNull()
    expect(host.querySelector('[aria-label="접힌 구역"]')).toBeNull()
  })
  it('빈 구역을 접으면 빈자리 수를 단 아이콘이 되고, 아이콘을 누르면 다시 펼쳐진다', () => {
    act(() => root.render(<FloorCard floor={floor([busy, empty])} selectedId={null} nowMs={NOW} busyOrderId={null} onSelect={() => {}} onOp={() => {}} />))
    act(() => foldOf('WP-05').click())
    expect(host.querySelector('button[aria-label^="TSK-05-01"]')).toBeNull()
    const icon = host.querySelector('button[aria-expanded="false"]') as HTMLButtonElement
    expect(icon.getAttribute('aria-label')).toContain('WP-05')
    expect(icon.getAttribute('aria-label')).toContain('2 빈자리')
    expect(icon.textContent).toContain('2')
    act(() => icon.click())
    expect(host.querySelector('button[aria-label^="TSK-05-01"]')).not.toBeNull()
    expect(host.querySelector('button[aria-expanded="false"]')).toBeNull()
  })
  it('빈 구역의 좌석이 선택되어 있으면 펼쳐져 있다', () => {
    act(() => root.render(<FloorCard floor={floor([busy, empty])} selectedId="e2" nowMs={NOW} busyOrderId={null} onSelect={() => {}} onOp={() => {}} />))
    expect(host.querySelector('button[aria-label^="TSK-05-02"]')).not.toBeNull()
    expect(host.querySelector('button[aria-expanded="false"]')).toBeNull()
  })
  it('접힌 구역 아이콘은 빈 구역 empty, 승인 대기 구역 wait, 진행 중 구역 work 표시가 붙는다', () => {
    const working = zone({ key: 'c', code: 'WP-06', name: '출하', seats: [seat({ orderId: 'w1', id8: 'w1', code: 'TSK-06-01' })], summary: { work: 1, wait: 0, ready: 0, done: 0 } })
    act(() => root.render(<FloorCard floor={floor([busy, working, empty])} selectedId={null} nowMs={NOW} busyOrderId={null} onSelect={() => {}} onOp={() => {}} />))
    // 펼쳐진 구역마다 접기 버튼이 있다(빈 구역 포함)
    expect(host.querySelectorAll('button[aria-label="구역 접기"]')).toHaveLength(3)
    act(() => (host.querySelector('button[data-floor-fold-all]') as HTMLButtonElement).click())
    const icons = [...host.querySelectorAll('button[aria-expanded="false"]')] as HTMLButtonElement[]
    const byCode = (code: string) => icons.find(b => (b.getAttribute('aria-label') || '').startsWith(code))!
    expect(byCode('WP-04').dataset.kind).toBe('wait')
    expect(byCode('WP-04').getAttribute('aria-label')).toContain('1 승인 대기')
    expect(byCode('WP-06').dataset.kind).toBe('work')
    expect(byCode('WP-06').getAttribute('aria-label')).toContain('1 진행')
    expect(byCode('WP-05').dataset.kind).toBe('empty')
    act(() => byCode('WP-04').click())
    expect(host.querySelector('button[aria-label^="TSK-04-02"]')).not.toBeNull()
  })
})

describe('FloorCard — 접기는 선택을 풀고, 층 단위 모두 펼치기/접기', () => {
  const busy = zone({ key: 'a', code: 'WP-04', name: '주문 관리', seats: [seat({ state: 'WAIT', phase: 'reported', anim: 'idle_coffee' })], summary: { work: 0, wait: 1, ready: 0, done: 0 } })
  const empty = zone({ key: 'b', code: 'WP-05', name: '재고 관리', seats: [emptySeat(1), emptySeat(2)], summary: { work: 0, wait: 0, ready: 2, done: 0 } })
  const foldOf = (code: string) => [...host.querySelectorAll('button[aria-label="구역 접기"]')].find(b => b.parentElement?.textContent?.includes(code)) as HTMLButtonElement
  it('선택된 좌석이 든 구역을 접으면 onSelect(null) 이 불리고, 선택이 풀리면 아이콘으로 접힌다', () => {
    const onSelect = vi.fn()
    act(() => root.render(<FloorCard floor={floor([busy, empty])} selectedId="e2" nowMs={NOW} busyOrderId={null} onSelect={onSelect} onOp={() => {}} />))
    act(() => foldOf('WP-05').click())
    expect(onSelect).toHaveBeenCalledWith(null)
    act(() => root.render(<FloorCard floor={floor([busy, empty])} selectedId={null} nowMs={NOW} busyOrderId={null} onSelect={onSelect} onOp={() => {}} />))
    expect(host.querySelector('button[aria-label^="TSK-05-02"]')).toBeNull()
    expect(host.querySelector('button[aria-expanded="false"]')).not.toBeNull()
  })
  it('선택이 없는 구역을 접을 때는 onSelect 를 부르지 않는다', () => {
    const onSelect = vi.fn()
    act(() => root.render(<FloorCard floor={floor([busy, empty])} selectedId={null} nowMs={NOW} busyOrderId={null} onSelect={onSelect} onOp={() => {}} />))
    act(() => foldOf('WP-04').click())
    expect(onSelect).not.toHaveBeenCalled()
  })
  it('모두 접기 → 전 구역 아이콘(선택도 해제), 모두 펼치기 → 전 구역 책상', () => {
    const onSelect = vi.fn()
    act(() => root.render(<FloorCard floor={floor([busy, empty])} selectedId="e2" nowMs={NOW} busyOrderId={null} onSelect={onSelect} onOp={() => {}} />))
    act(() => (host.querySelector('button[data-floor-fold-all]') as HTMLButtonElement).click())
    expect(onSelect).toHaveBeenCalledWith(null)
    act(() => root.render(<FloorCard floor={floor([busy, empty])} selectedId={null} nowMs={NOW} busyOrderId={null} onSelect={onSelect} onOp={() => {}} />))
    expect(host.querySelectorAll('button[aria-expanded="false"]')).toHaveLength(2)
    expect(host.querySelectorAll('button[aria-label="구역 접기"]')).toHaveLength(0)
    act(() => (host.querySelector('button[data-floor-expand-all]') as HTMLButtonElement).click())
    expect(host.querySelectorAll('button[aria-expanded="false"]')).toHaveLength(0)
    expect(host.querySelectorAll('button[aria-label="구역 접기"]')).toHaveLength(2)
    expect(host.querySelector('button[aria-label^="TSK-05-01"]')).not.toBeNull()
  })
})
