import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = join(__dirname, '..', '..')
const team = readFileSync(join(ROOT, '.claude/skills/dflow-team/SKILL.md'), 'utf8')

// 팀장 poll exit 0 의 show 필터(jq 식)를 문서에서 그대로 꺼내 돌린다 — 문서와 동작이 어긋나지 않게.
function filterExpr(): string {
  const m = team.match(/\| jq -c '(\{order: \.order\.id[\s\S]*?\})'/)
  if (!m) throw new Error('show 필터를 찾지 못했다')
  return m[1]
}
function run(show: unknown): { spec_empty: boolean; deps_unmet: string[] } {
  return JSON.parse(execFileSync('jq', ['-c', filterExpr()], { input: JSON.stringify(show) }).toString())
}
const order = (extra: Record<string, unknown>) => ({ order: { id: 'o1', item: { external_ref: 'd/TSK-03-02', spec: '본문' } }, ...extra })

describe('dflow-team — spawn 전 선행 사전 검사(2026-09-19)', () => {
  it('show 필터는 G1(중단 표식 정리)을 위해 status 를 싣는다', () => {
    const r = JSON.parse(execFileSync('jq', ['-c', filterExpr()], { input: JSON.stringify({ order: { id: 'o1', status: 'ready', item: { external_ref: 'd/TSK-03-02', spec: '본문' } } }) }).toString())
    expect(r.status).toBe('ready')
  })
  it('reached 가 거짓인 선행만 deps_unmet 에 담는다', () => {
    const r = run(order({ depends_evidence: [
      { external_ref: 'd/TSK-03-01', reached: false, head_sha: null },
      { external_ref: 'd/TSK-02-01', reached: true, head_sha: 'abc' },
    ] }))
    expect(r.deps_unmet).toEqual(['d/TSK-03-01'])
    expect(r.spec_empty).toBe(false)
  })
  it('승인 대기(reached 참, head_sha 없음)는 거르지 않고 워커 G 에 맡긴다', () => {
    expect(run(order({ depends_evidence: [{ external_ref: 'd/TSK-03-01', reached: true, head_sha: null }] })).deps_unmet).toEqual([])
  })
  it('reached 키가 없는 옛 서버·depends_evidence 없는 응답은 판정 불가로 보고 거르지 않는다', () => {
    expect(run(order({ depends_evidence: [{ external_ref: 'd/TSK-03-01', stage: 'ip' }] })).deps_unmet).toEqual([])
    expect(run(order({})).deps_unmet).toEqual([])
  })
  it('poll exit 0 행이 사전 검사로 spawn 을 막고, 사유가 선행 계열(자동 머지 뒤 해제 대상)로 시작한다', () => {
    expect(team).toContain('`deps_unmet` 이 비어 있지 않으면 띄우지 않고 사유 `선행 미충족(사전 검사: <ref…>)`')
    expect(team).toMatch(/선행 계열\(선행 미충족·/)
  })
  it('state.json merged 기준으로 거르지 않는다(워커 행 B 스택을 막지 않도록)', () => {
    expect(team).toContain('`state.json` 의 `phase=merged` 로 거르지 않는다')
  })
})
