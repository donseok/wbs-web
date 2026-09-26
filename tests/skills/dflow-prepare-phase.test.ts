// Phase 01 준비 단계(prepare, 2026-09-24) — 스킬(state.json 쓰기)·훅(보내는 값)·서버(받는 값)가 같은 이름을 쓰는지 본다.
// 계기: dmes-standard 착수분이 Phase 01 기준선 동안 state.json phase=ready 라 훅이 5분 넘게 한 번도 보내지 않았다.
import { describe, expect, it } from 'vitest'
import { devAll } from './_dflow-dev'
import { readFileSync } from 'node:fs'
import { HEARTBEAT_PHASES } from '@/lib/domain/seatState'
import { stripWorkerBlocks } from './_preserve'

const skill = stripWorkerBlocks(devAll())
const hook = readFileSync('kit/hooks/heartbeat.sh', 'utf8')
const between = (text: string, start: string, end: string) => text.split(start)[1]?.split(end)[0] ?? ''

/** 훅이 진행 중으로 보고 보내는 phase 목록 — case 갈래 한 줄에서 읽는다. */
function hookPhases(): string[] {
  const line = hook.split('\n').find(l => /^\s*[a-z|]*design\|build[a-z|]*\)/.test(l))
  if (!line) throw new Error('훅의 진행 중 phase case 줄을 찾지 못했다')
  return line.trim().split(')')[0].split('|')
}

describe('prepare — 훅·서버·스킬 동기', () => {
  it('훅은 prepare 를 보내고 scaffold 자리표 ready 는 보내지 않는다', () => {
    expect(hookPhases()).toContain('prepare')
    expect(hookPhases()).not.toContain('ready')
  })
  it('훅이 보내는 phase 는 전부 서버가 받는다(HEARTBEAT_PHASES) — 어긋나면 400 으로 신호가 빠진다', () => {
    for (const p of hookPhases()) expect(HEARTBEAT_PHASES, p).toContain(p)
  })
  it('Phase 01 3번(브랜치)에서 state.json phase 를 prepare 로 쓰고, 끝(6번)에서 design 으로 넘긴다', () => {
    const p03 = between(skill, '3. **브랜치를 오케스트레이터가 직접 만든다**', '4. **게이트 기준선 기록**')
    expect(p03).toContain('`phase` 를 `prepare` 로 쓴다')
    expect(p03).toContain('반려 재작업 경로(`phase=rejected`)에서는 쓰지 않는다')
    const p01end = between(skill, '5. spec.md 읽기(필수)', '## Phase 02~05')
    expect(p01end).toContain('`prepare` 이면 `design` 으로 바꾼다')
  })
})
