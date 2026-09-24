// tests/skills/dflow-dev-background-gate.test.ts
//
// 계약 테스트: 2026-09-24 dmes-standard TSK-03-01 사고 재발 방지 규칙.
// Build 서브에이전트가 변이 검증 스윕을 run_in_background 로 띄운 뒤 완료 알림을 기다리며 턴을 끝냈고,
// 서브에이전트 종료와 함께 백그라운드 프로세스도 사라져 알림이 끝내 오지 않았다. 오케스트레이터(워커
// 세션)는 "완료 알림을 기다리는 중"으로 오판해 47분간 입력 대기로 멈췄다. 이 파일은 그 재발을 막기 위해
// dflow-dev/SKILL.md(Phase 서브에이전트 공통 프롬프트·오케스트레이터 규칙)와 dflow-team/SKILL.md(팀장의
// TICK 무응답 점검)에 넣은 문구를 고정한다.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd() // vitest 는 리포 루트에서 돈다(기존 tests/ 관례)
const dflowDev = () => readFileSync(join(ROOT, '.claude/skills/dflow-dev/SKILL.md'), 'utf8')
const dflowTeam = () => readFileSync(join(ROOT, '.claude/skills/dflow-team/SKILL.md'), 'utf8')
const devDiscipline = () => readFileSync(join(ROOT, '.claude/skills/dflow-dev/references/dev-discipline.md'), 'utf8')

describe('dflow-dev: Phase 서브에이전트 공통 프롬프트의 포그라운드 실행 규칙', () => {
  it('게이트·변이 검증 스윕·테스트를 run_in_background 로 띄우지 않는 문구를 공통 프롬프트에 포함하고 dev-discipline.md 를 가리킨다', () => {
    const skill = dflowDev()
    expect(skill).toContain('**포그라운드 실행 규칙**')
    expect(skill).toContain('(dev-discipline.md 「포그라운드 실행(백그라운드 게이트\n금지)」)')
    expect(skill).toContain('게이트·변이 검증 스윕·테스트를 run_in_background 로 띄우지')
    expect(skill).toContain('말고 포그라운드로 끝까지 돌린다(필요하면 Bash timeout 을 길게 준다)')
    expect(skill).toContain('결과는 보고에 담는다')
    expect(skill).toContain('띄웠다면 그 작업이 끝나 결과를 확인하기 전에는 턴을 끝내지 않는다')
    expect(skill).toContain('dmes-standard TSK-03-01')
  })

  it('dev-discipline.md 가 정본 절을 갖고, 두 소비자(dflow-dev·무인 러너) 공통이라고 밝힌다', () => {
    const doc = devDiscipline()
    expect(doc).toContain('## 포그라운드 실행(백그라운드 게이트 금지)')
    expect(doc).toContain('`run_in_background` 로 띄우지 않는다')
    expect(doc).toContain('그 작업이 끝나 결과를 확인하기 전에는 턴을 끝내지')
    expect(doc).toContain('무인 러너(`claude -p`)도 같은 위험을 안는다')
    expect(doc).toContain('제1 제약')
  })

  it('공통 프롬프트 삽입 지점은 --worker 표지 블록(E) 바로 앞이 아니다(표지 블록 검사 보호)', () => {
    const skill = dflowDev()
    // 「커밋 규칙에는 ...」 문단이 여전히 표지 블록(E) 바로 앞의 마지막 문단이어야
    // tests/skills/dflow-dev-worker.test.ts 의 표지 prev 검사가 깨지지 않는다.
    const idx = skill.indexOf('**포그라운드 실행 규칙**')
    const commitRuleIdx = skill.indexOf('커밋 규칙에는 **모든 커밋에')
    const workerBeginIdx = skill.indexOf('<!-- worker:begin -->\n`--worker` 면 공통 프롬프트에 git 절대경로')
    expect(idx).toBeGreaterThan(-1)
    expect(commitRuleIdx).toBeGreaterThan(idx)
    expect(workerBeginIdx).toBeGreaterThan(commitRuleIdx)
  })
})

describe('dflow-dev: 오케스트레이터가 서브에이전트 종료 뒤 오지 않을 알림을 기다리지 않는다', () => {
  it('Phase 종료마다 오케스트레이터가 하는 목록에 무응답 알림 처리 규칙이 있다', () => {
    const skill = dflowDev()
    expect(skill).toContain(
      '**서브에이전트가 끝났는데(finished) 이 오케스트레이터가 게이트를 아직 직접 돌리지 않았다면**',
    )
    expect(skill).toContain('백그라운드 완료를 기다린다')
    expect(skill).toContain('프로세스\n   (`pgrep` 등)와 산출물(커밋·파일)을 직접 확인한다')
    expect(skill).toContain('그 프로세스가 아직 돌고 있으면 알림을 기다리지 말고')
    expect(skill).toContain('오케스트레이터가 포그라운드에서 그 프로세스가 끝날 때까지 직접 기다린 뒤')
    expect(skill).toContain('오지 않을 알림을 기다리며 입력 대기로 멈추지 않는다')
    expect(skill).toContain('dmes-standard TSK-03-01')
  })
})

describe('dflow-team: TICK 무응답 점검이 서브에이전트 종료 후 정지 패턴을 첫 TICK 에 알아채고 깨운다', () => {
  it('무응답 절 바로 뒤, 대기 중인 팀원 판정보다 앞에 서브에이전트 종료 후 정지 패턴 절이 있다(두 TICK 을 기다리지 않기 위해)', () => {
    const skill = dflowTeam()
    const noResponseIdx = skill.indexOf('- **무응답**: 결과도 알림도 없는 진행 슬롯')
    const patternIdx = skill.indexOf('**서브에이전트 종료 후 정지 패턴(2026-09-24, dmes-standard TSK-03-01)**')
    const waitingIdx = skill.indexOf('**대기 중인 팀원 판정(2026-09-24, doc-level')
    const restartIdx = skill.indexOf('**자동 재시작**:')
    expect(noResponseIdx).toBeGreaterThan(-1)
    expect(patternIdx).toBeGreaterThan(noResponseIdx)
    expect(waitingIdx).toBeGreaterThan(patternIdx)
    expect(restartIdx).toBeGreaterThan(waitingIdx)
  })

  it('두 TICK 이 아니라 무변화 1회째에 판정하고, heartbeat 정지 여부와 무관하다', () => {
    const skill = dflowTeam()
    expect(skill).toContain('무변화 **1 회째** — 두 `TICK` 을 기다리지 않는다')
    expect(skill).toContain('`last_heartbeat_at`\n  이 함께 멈춰 있어도 상관없다')
    expect(skill).toContain('이 판정은 heartbeat 값을 보지 않는다')
  })

  it('finished 알림 + 대기 화면이면 다음 TICK 을 기다리지 않고 그 TICK 에서 곧바로 [팀장 지시] 를 주입한다', () => {
    const skill = dflowTeam()
    expect(skill).toContain('Teammate @<TSK>-<phase> finished')
    expect(skill).toContain('다시는 오지 않을 알림을 기다리는 정지')
    expect(skill).toContain('하고 다음 `TICK` 을 기다리지 않는다 — **이 TICK 에서 곧바로**')
    expect(skill).toContain('send-keys -l --')
    expect(skill).toContain('orca terminal')
    expect(skill).toContain('[팀장 지시] 서브에이전트 @<TSK>-<phase> 는 이미 끝났다(finished)')
    expect(skill).toContain('"사람 확인 필요"로 올린다')
  })

  it('주입이 성공하면 자동 정리·자동 재시작이 걸리지 않고, 실패하면 그 두 경로가 그대로 이어받는다', () => {
    const skill = dflowTeam()
    expect(skill).toContain('**자동 정리·자동 재시작과의 관계**')
    expect(skill).toContain('"두 `TICK` 연속 무변화" 조건이 깨지므로')
    expect(skill).toContain('`cause=no-response`, (나) 2회째)도 걸리지')
    expect(skill).toContain('기존 자동 정리·자동\n  재시작이 그대로 이어받는다(이 절이 그것을 막지 않는다)')
  })
})
