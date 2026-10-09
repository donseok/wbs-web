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
    expect(p).toContain('node .claude/skills/dflow-poll/scripts/poll.mjs --interval 300 --until 18:00 --require-tag agent --actions full')
    expect(p).toContain('`--actions full` 도 표준.')
  })
  it('넷째 칸이 full 이 아니면 사유를 알리고 건너뛴다', () => {
    expect(p).toContain('`순번<TAB>id8<TAB>이름[<TAB>action]`')
    expect(p).toContain('설계 검토·구현자동 작업이라 건너뜁니다')
  })
})

describe('/dflow-work — exit 11·12 와 설계 상태 동사', () => {
  const w = read('.claude/skills/dflow-work/SKILL.md')
  const sc = read('.claude/skills/dflow-work/references/subcommands.md')
  it('exit 표에 11·12 가 있다', () => {
    expect(w).toContain('| 11 | 설계 관문: 409 `design_gate`·`design_not_accepted` (계약 2.11)')
    expect(w).toContain('| 12 | 다른 PC 도는 중: 409 `runner_active` (계약 2.11)')
  })
  it('claim·build-start 범위, design-done·design-reopen, 옛 서버 폴백을 적는다', () => {
    expect(sc).toContain('**설계 상태(계약 2.11)**')
    expect(sc).toContain('`claim <ref> [--design-first] [--scope full|design|build]`')
    expect(sc).toContain('`design-reopen <ref> --reason "<이유>"`')
    expect(sc).toContain('stderr `DESIGN_STATE_UNSUPPORTED` + exit 7')
  })
  it('설계 멈춤은 계약 2.11 이면 design-done, release 는 설계 상태가 있으면 거부된다(D13)', () => {
    expect(sc).toContain('계약 2.11: `dflow.mjs design-done <ref>`')
    expect(sc).toContain('옛 서버: `--phase wait_review` (계약 2.10)')
    expect(sc).toContain('계약 2.11: 설계 상태(검토 대기·승인됨) 있는 주문은 반납 안 됨 (exit 11, 설계 상태 스펙 D13)')
  })
  it('troubleshooting 에 exit 10·11·12 절이 있다', () => {
    const t = read('.claude/skills/dflow-work/references/troubleshooting.md')
    for (const h of ['### exit 10 — 중단됨', '### exit 11 — 설계 관문(계약 2.11)', '### exit 12 — 다른 PC 도는 중(계약 2.11)']) expect(t, h).toContain(h)
    expect(t).toContain('`DESIGN_GATE design_gate order_changed`')
  })
})

describe('api-contract.md — v2.11 목록 셰이프와 mine 의 뜻(deferred C19·최종 리뷰 Minor 4·Important 2)', () => {
  const c = read('.claude/skills/dflow-work/references/api-contract.md')
  it('목록 응답의 추가 칸을 적는다', () => {
    expect(c).toContain('주문에 `claimed_by`(점유 라벨), `item` 에 `project_id`·`stage`· `actual_pct`·`tags`·`depends`·`depends_waived`·`design_mode`')
    expect(c).toContain('v2.11 목록 셰이프(PAT)')
  })
  it('ready 의 mine 은 태그·WP 만, 라벨 없는 claimed 의 mine 은 종전 뜻이다', () => {
    expect(c).toContain('ready 의 `mine` 은 태그·WP 만 봄(담당자는 claim 이 막음)')
    expect(c).toContain('요청에 `agent` 안 보냈고 `lead` 도 아니면, claimed 주문의 `mine` 은 종전 뜻(`claimed_by_user_id` 가 호출자와 같음).')
    expect(c).toContain('상세(show)는 형식 틀린 `agent` 를 보낸 경우도 이 규칙.')
  })
  it('완료 보고의 runner_active 본문 runner 는 실제로 막는 라벨이다(갈래 S A2)', () => {
    expect(c).toContain('완료 보고의 `runner_active` 본문 `runner` = 실제로 막고 있는 라벨')
    const t = read('.claude/skills/dflow-work/references/troubleshooting.md')
    expect(t).toContain('완료 보고의 `RUNNER_ACTIVE <runner>` 라벨 = **실제로 막고 있는 PC·세션**')
    expect(t).not.toContain('막는 세션이 아닐 수 있다')
  })
})
