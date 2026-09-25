// 팀장 lease 가 SKILL.md 흐름에 들어갔는지(스펙 2026-09-23-dflow-lead-lease-design.md §8).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SKILL = readFileSync('.claude/skills/dflow-team/SKILL.md', 'utf8')
const HELP = readFileSync('.claude/skills/dflow-team/references/help.md', 'utf8')
// 감시 루프·기상 블록은 2026-09-25 에 scripts/tick.sh·wake.sh 로 옮겼다
const TICK = readFileSync('.claude/skills/dflow-team/scripts/tick.sh', 'utf8')
const WAKE = readFileSync('.claude/skills/dflow-team/scripts/wake.sh', 'utf8')
// 「7. 마감」(잠금·lease 상실 마감 포함)은 2026-09-25 에 references/closing.md 로 옮겼다
const CLOSING = readFileSync('.claude/skills/dflow-team/references/closing.md', 'utf8')
const csection = (from: string, to: string) => CLOSING.slice(CLOSING.indexOf(from), to ? CLOSING.indexOf(to, CLOSING.indexOf(from) + 1) : undefined)
const section = (from: string, to: string) => SKILL.slice(SKILL.indexOf(from), SKILL.indexOf(to, SKILL.indexOf(from) + 1))

describe('dflow-team lease', () => {
  it('전제 검사: 로컬 잠금을 잡은 뒤 lease acquire, 실패하면 잠금을 지우고 멈춘다', () => {
    const s = section('## 1. 시작', '## 2. 기상과 감시')
    const lock = s.indexOf('owner = <신원>/<host>/lead')
    const acq = s.indexOf('dflow.sh lease acquire')
    expect(lock).toBeGreaterThan(-1)
    expect(acq).toBeGreaterThan(lock)
    expect(s).toMatch(/FAIL LEASE/)
    expect(s).toMatch(/rm -rf "\$LOCK"; echo "FAIL LEASE/)
  })
  it('--takeover 는 변수 전개가 아니라 if 분기로 붙인다(zsh 빈 인자)', () => {
    const s = section('## 1. 시작', '## 2. 기상과 감시')
    expect(s).toMatch(/if \[ "\$TAKEOVER" = --takeover \]; then/)
    expect(s).not.toMatch(/lease acquire \$TAKEOVER/)
  })
  it('감시 시작에서 lease keep 을 팀장 PID 로 run_in_background 로 띄운다', () => {
    expect(SKILL).toMatch(/dflow\.sh lease keep --pid <LEAD_PID> --lost-file '<[^>]+>'/)
  })
  it('감시 루프: LEASE_LOST 검사가 STOP_REQUESTED 뒤, 결과 검사 앞', () => {
    const s = TICK.slice(TICK.indexOf('while :; do\n  [ "$(cut'))
    const stop = s.indexOf('echo STOP_REQUESTED')
    const lease = s.indexOf('echo "LEASE_LOST')
    const hit = s.indexOf('RESULT_READY$hit')
    expect(stop).toBeGreaterThan(-1)
    expect(lease).toBeGreaterThan(stop)
    expect(hit).toBeGreaterThan(lease)
  })
  it('기상: watch 에 --holder 를 싣고 keep 의 beat 를 확인한다', () => {
    const s = section('### 2-3. 기상마다 하는 일', '## 3. 결과 처리')
    expect(WAKE).toMatch(/--holder "\$h"/)
    expect(WAKE).toMatch(/LEASE_KEEP_DEAD/)
    expect(s).toMatch(/LEASE_KEEP_DEAD/)
    expect(s).toMatch(/\| `LEASE_LOST/)
  })
  it('--holder 는 먼저 값을 구한 뒤 비어 있지 않을 때만 watch 를 부른다(빈 --holder 로 무필터 조회하지 않는다)', () => {
    const s = WAKE
    const h = s.indexOf('h=$("$DFLOW" lease holder) || h=\'\'')
    const ifn = s.indexOf('if [ -n "$h" ]; then')
    const holderFlag = s.indexOf('--holder "$h"')
    const elseFailed = s.indexOf('echo "HOLDER_FAILED"')
    expect(h).toBeGreaterThan(-1)
    expect(ifn).toBeGreaterThan(h)
    expect(holderFlag).toBeGreaterThan(ifn)
    expect(elseFailed).toBeGreaterThan(holderFlag)
    // watch 호출 자체가 --holder "$(... lease holder)" 처럼 실패를 삼키는 부분 전개로 남아 있지 않다
    expect(s).not.toMatch(/--holder "\$\("\$DFLOW" lease holder\)"/)
    expect(WAKE).toContain('DFLOW="${DFLOW_SH:-.claude/skills/dflow-work/scripts/dflow.sh}"')
    expect(SKILL).toMatch(/`HOLDER_FAILED`[^\n]*watch 를 아예 부르지 않은 것/)
  })
  it('lease 상실 마감은 워커를 건드리지 않고, 6번 블록의 release 가 남의 lease 를 풀지 않는 이유를 적는다', () => {
    const s = csection('**lease 상실 마감**', '')
    expect(s).toMatch(/워커[^\n]*건드리지 않는다/)
    expect(s).toMatch(/holder·generation 이 맞는 행만/)
    expect(s).toMatch(/새 claim·새 spawn·승인 스윕·머지를 하지 않는다/)
  })
  it('정상 마감은 lease release 를 부르고, 실패하면 상태 파일·beat 를 직접 지워 keep 을 멈춘다', () => {
    const s = csection('# /dflow-team 마감', '**잠금 상실 마감**')
    expect(s).toMatch(/dflow\.sh lease release/)
    expect(s).toMatch(
      /dflow\.sh lease release \|\| \{ rm -f "\$\(git rev-parse --git-path dflow-team\.lease\)" "\$\(git rev-parse --git-path dflow-team\.lease\)\.beat"; echo "LEASE_RELEASE_FAILED/,
    )
  })
  it('LEASE_KEEP_DEAD: LEASE_LOST 기상이면 무시하고, 복구 경로(LEASE_OK)는 lease-lost 표식을 지운 뒤 재기동한다', () => {
    const s = section('### 2-3. 기상마다 하는 일', '## 3. 결과 처리')
    // 우선순위: 같은 기상에 LEASE_LOST 와 LEASE_KEEP_DEAD 가 함께 뜨면 LEASE_LOST 를 따르고 이 문단을 건너뛴다
    expect(s).toMatch(/LEASE_LOST[^\n]*(으로|로) 온 것이면[^\n]*건너뛰/)
    expect(s).toMatch(/우선순위는 `LEASE_LOST` 다/)
    // 복구 경로: LEASE_OK 뒤 표식 파일을 지우고 나서 재기동한다(재기동보다 먼저 지운다)
    const deadIdx = s.indexOf('LEASE_KEEP_DEAD')
    const okIdx = s.indexOf('LEASE_OK', deadIdx)
    const rmLeaseLost = s.indexOf('dflow-team.lease-lost', okIdx)
    const restart = s.indexOf('다시 띄운다', rmLeaseLost)
    expect(okIdx).toBeGreaterThan(deadIdx)
    expect(rmLeaseLost).toBeGreaterThan(okIdx)
    expect(restart).toBeGreaterThan(rmLeaseLost)
    expect(s.slice(rmLeaseLost, rmLeaseLost + 120)).toMatch(/남아\s*있으면 먼저 지운/)
  })
  it('기상 표: LEASE_LOST 는 1~5 를 하지 않고 LEASE_KEEP_DEAD 도 무시하며, 목록 머리말은 LEASE_LOST 도 뺀다', () => {
    expect(SKILL).toMatch(/`STALE` 과 `LEASE_LOST` 를 뺀 모든 기상에서는 `LOCK_OK` 뒤에 이어서 이 순서로 한다\./)
    const row = section('### 2-3. 기상마다 하는 일', '## 3. 결과 처리').match(/\| `LEASE_LOST <사유>`.*\|/)?.[0] ?? ''
    expect(row).toMatch(/1~5/)
    expect(row).toMatch(/LEASE_KEEP_DEAD/)
    expect(row).toMatch(/무시/)
  })
  it('help 에 강제 인수가 4열로 있다', () => {
    expect(HELP).toMatch(/--takeover|강제 인수/)
    const row = HELP.split('\n').find((l) => l.includes('--takeover'))
    expect(row, 'takeover 행이 있어야 한다').toBeTruthy()
    expect(row!.split('|').length).toBe(6) // 앞뒤 빈 칸 포함 4열 = | a | b | c | d |
  })
})
