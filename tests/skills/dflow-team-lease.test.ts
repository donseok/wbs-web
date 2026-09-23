// 팀장 lease 가 SKILL.md 흐름에 들어갔는지(스펙 2026-09-23-dflow-lead-lease-design.md §8).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SKILL = readFileSync('.claude/skills/dflow-team/SKILL.md', 'utf8')
const HELP = readFileSync('.claude/skills/dflow-team/references/help.md', 'utf8')
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
    const s = section('### 2-2. 감시 루프', '### 2-3.')
    const stop = s.indexOf('echo STOP_REQUESTED')
    const lease = s.indexOf('echo "LEASE_LOST')
    const hit = s.indexOf('RESULT_READY$hit')
    expect(stop).toBeGreaterThan(-1)
    expect(lease).toBeGreaterThan(stop)
    expect(hit).toBeGreaterThan(lease)
  })
  it('기상: watch 에 --holder 를 싣고 keep 의 beat 를 확인한다', () => {
    const s = section('### 2-3. 기상마다 하는 일', '## 3. 결과 처리')
    expect(s).toMatch(/--holder "\$\(\.claude\/skills\/dflow-work\/scripts\/dflow\.sh lease holder\)"/)
    expect(s).toMatch(/LEASE_KEEP_DEAD/)
    expect(s).toMatch(/\| `LEASE_LOST/)
  })
  it('lease 상실 마감은 워커를 건드리지 않고, 6번 블록의 release 가 남의 lease 를 풀지 않는 이유를 적는다', () => {
    const s = section('**lease 상실 마감**', '## 좌석표 연동')
    expect(s).toMatch(/워커[^\n]*건드리지 않는다/)
    expect(s).toMatch(/holder·generation 이 맞는 행만/)
    expect(s).toMatch(/새 claim·새 spawn·승인 스윕·머지를 하지 않는다/)
  })
  it('정상 마감은 lease release 를 부른다', () => {
    const s = section('## 7. 마감', '**잠금 상실 마감**')
    expect(s).toMatch(/dflow\.sh lease release/)
  })
  it('help 에 강제 인수가 있다', () => {
    expect(HELP).toMatch(/--takeover|강제 인수/)
  })
})
