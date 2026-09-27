// tests/skills/dflow-design-state-docs.test.ts — 설계 상태(계약 2.11)의 /dflow-poll·/dflow-work 문서.
// 설계: docs/superpowers/specs/2026-09-26-design-state-dev-auto-design.md 6.5·6.7·7절·12절(Review Focus 5)
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const flat = (s: string) => s.replace(/\s+/g, ' ')
const read = (p: string) => flat(readFileSync(join(process.cwd(), p), 'utf8'))

describe('/dflow-poll — full 만 착수한다(스펙 7절)', () => {
  const p = read('.claude/skills/dflow-poll/SKILL.md')
  it('기동 줄에 --actions full 이 표준이다', () => {
    expect(p).toContain('poll.sh --interval 300 --until 18:00 --require-tag agent --actions full')
    expect(p).toContain('`--actions full` 도 표준이다')
  })
  it('넷째 칸이 full 이 아니면 사유를 알리고 건너뛴다', () => {
    expect(p).toContain('`순번<TAB>id8<TAB>이름[<TAB>action]`')
    expect(p).toContain('설계 검토·구현자동 작업이라 건너뜁니다')
  })
})

describe('/dflow-work — exit 11·12 와 설계 상태 동사', () => {
  const w = read('.claude/skills/dflow-work/SKILL.md')
  it('exit 표에 11·12 가 있다', () => {
    expect(w).toContain('11 설계 관문 — 409 `design_gate`·`design_not_accepted`(계약 2.11)')
    expect(w).toContain('12 다른 PC 도는 중 — 409 `runner_active`(계약 2.11)')
  })
  it('claim·build-start 범위, design-done·design-reopen, 옛 서버 폴백을 적는다', () => {
    expect(w).toContain('**설계 상태(계약 2.11)**')
    expect(w).toContain('`claim <ref> [--design-first] [--scope full|design|build]`')
    expect(w).toContain('`design-reopen <ref> --reason "<이유>"`')
    expect(w).toContain('`DESIGN_STATE_UNSUPPORTED` 에 exit 7')
  })
  it('설계 멈춤은 계약 2.11 이면 design-done, release 는 설계 상태가 있으면 거부된다(D13)', () => {
    expect(w).toContain('계약 2.11 이면 `dflow.sh design-done <ref>`, 옛 서버면 `--phase wait_review`(계약 2.10)')
    expect(w).toContain('설계 상태(검토 대기·승인됨)가 있는 주문은 반납하지 않는다(exit 11')
  })
  it('troubleshooting 에 exit 10·11·12 절이 있다', () => {
    const t = read('.claude/skills/dflow-work/references/troubleshooting.md')
    for (const h of ['### exit 10 — 중단됨', '### exit 11 — 설계 관문(계약 2.11)', '### exit 12 — 다른 PC 도는 중(계약 2.11)']) expect(t, h).toContain(h)
    expect(t).toContain('`DESIGN_GATE design_gate order_changed`')
  })
})
