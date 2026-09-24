// tests/skills/dflow-dev-gate-economy.test.ts
//
// 계약 테스트: 2026-09-24 워커 점검에서 한 Task 가 전체 스위트를 12~17회 돌렸고, heavy.sh 밖의 Gradle 실행 때문에
// JVM 이 최대 10개까지 동시에 떴으며, haiku Verify 의 54% 가 변이 검증·E2E 를 건너뛴 부실 PASS 로 sonnet 재시도가 됐다.
// 이 파일은 그 개정(Verify 모델 sonnet, 워커 Refactor 생략, Gradle 은 단일 테스트도 heavy, Build 게이트 재시도,
// 변이 검증 Build 일원화·Verify 는 감사)의 문구를 dflow-dev SKILL.md 와 dev-discipline.md 에 고정한다.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { workerBlocks } from './_preserve'

const ROOT = process.cwd() // vitest 는 리포 루트에서 돈다(기존 tests/ 관례)
const SKILL = readFileSync(join(ROOT, '.claude/skills/dflow-dev/SKILL.md'), 'utf8')
const DISC = readFileSync(join(ROOT, '.claude/skills/dflow-dev/references/dev-discipline.md'), 'utf8')
const between = (text: string, start: string, end: string) => text.split(start)[1]?.split(end)[0] ?? ''

describe('Verify 모델은 처음부터 sonnet', () => {
  it('모델 배정표의 Verify 행이 sonnet 이고 haiku 승격 규칙이 없다', () => {
    const row = DISC.split('\n').find((l) => l.startsWith('| Verify |')) ?? ''
    expect(row).toContain('**처음부터 sonnet**')
    expect(row).toContain('haiku 는 쓰지 않는다')
    expect(DISC).not.toContain('haiku, 재시도(수정 포함) 시 sonnet 승격')
  })
  it('SKILL.md 도 Verify 재시도를 sonnet 승격으로 적지 않는다', () => {
    expect(SKILL).not.toContain('sonnet 승격')
  })
})

describe('워커는 Refactor 를 건너뛴다', () => {
  it('dev-discipline Phase 05 가 워커를 무인 모드로 묶고, supervised 는 커밋이 없으면 게이트를 생략한다', () => {
    const p05 = between(DISC, '## Phase 05', '## 전체 스위트 실행 횟수')
    expect(p05).toContain('무인 모드에서는 이 Phase 를 실행하지 않는다')
    expect(p05).toContain('`/dflow-team` 팀원(`/dflow-dev` 「--worker」 I)')
    expect(p05).toContain('Refactor 가 커밋을 남기지 않았으면(고칠 것이 없었다) Refactor 게이트를 돌리지 않는다')
  })
  it('SKILL.md 워커 표에 행 I 가 있고, 표지 머리와 끝 문장이 아홉 행을 말한다', () => {
    const sec = workerBlocks(SKILL).at(-1)?.body ?? ''
    const rowI = sec.split('\n').find((l) => l.startsWith('| I |')) ?? ''
    expect(rowI).toContain('Phase 05 Refactor')
    expect(rowI).toContain('**실행하지 않는다.**')
    expect(SKILL).toContain('아홉 행(A~I)')
    expect(sec).toContain('행 I 의 Refactor 생략')
    expect(SKILL).toContain('Refactor 가 커밋을 남기지 않았으면 Refactor 게이트를 돌리지 않는다')
  })
})

describe('heavy.sh 적용 범위: Gradle·Maven 은 단일 테스트도 감싼다', () => {
  const heavy = between(DISC, '## 무거운 명령 줄 세우기', '## 포그라운드 실행')
  it('감쌀 명령에 모든 gradlew·mvn 호출(단일 테스트 포함)·변이 검증·의존성 설치가 있고, 예외는 JS 러너 단일 파일·린트뿐이다', () => {
    expect(heavy).toContain('**모든 `gradlew`·`mvn` 호출(단일 테스트 포함)**')
    expect(heavy).toContain('변이 검증(스크립트 전체를 한 번)')
    expect(heavy).toContain('의존성 설치')
    expect(heavy).toContain('**JS 러너(vitest·jest 등)의 단일 테스트 파일 실행과 린트**만')
    expect(heavy).not.toContain('단일 테스트 파일·린트처럼 짧고 가벼운 명령은')
  })
  it('기준선은 baseline.sh 가 스스로 heavy 를 쓰므로 heavy.sh 를 붙이지 않는다(25행·57행 상충 해소)', () => {
    const base = between(DISC, '## 게이트 기준선', '### 기준선 캐시')
    expect(base).toContain('`--` 뒤 명령에 `heavy.sh` 를 붙이지 않고')
    expect(base).toContain('게이트·Build·변이 검증·E2E 의')
    expect(base).not.toContain('전체 테스트는 `heavy.sh` 로 감싸 돌린다')
  })
  it('DEPS_BUSY(exit 75)는 실패가 아니라 다시 부른다 — 정본·워커 행 H·deps 블록', () => {
    expect(heavy).toContain('`DEPS_BUSY <폴더>` 와 exit 75')
    const sec = workerBlocks(SKILL).at(-1)?.body ?? ''
    expect(sec).toContain('`DEPS_BUSY <폴더>`(exit 75)는 실패가 아니다')
    expect(sec).toContain('# 75(DEPS_BUSY)면 잠시 뒤 다시 부른다')
  })
  it('Bash timeout 은 대기 상한 + 명령 시간이되 10분을 넘지 않고, baseline.sh 는 공유 마감이다', () => {
    expect(heavy).toContain('**10분(600000ms)을 넘기지 않는다**')
    expect(heavy).toContain('`DFLOW_HEAVY_WAIT` 를 줄여')
    expect(heavy).toContain('240초 + 측정 시간이면 된다')
    expect(heavy).toContain('`DFLOW_BASELINE_WAIT` 를 줄인다')
    expect(DISC).toContain('한 호출의 총 대기는 240초 + 측정 시간 이하다')
    expect(heavy).not.toContain('합친 것보다 넉넉히 준다')
  })
  it('Phase 공통 프롬프트에 heavy 한 줄이 있고 트레일러 문단 앞에 있다(표지 블록 E 보호)', () => {
    const idx = SKILL.indexOf('공통 프롬프트에는 **무거운 명령 규칙**도 한 줄 넣는다')
    expect(idx).toBeGreaterThan(SKILL.indexOf('**포그라운드 실행 규칙**'))
    expect(idx).toBeLessThan(SKILL.indexOf('커밋 규칙에는 **모든 커밋에'))
    expect(SKILL).toContain('모든 gradlew/mvn 호출(단일 테스트 포함)·의존성 설치는 `.claude/skills/dflow-dev/scripts/heavy.sh` 로 감싸')
  })
})

describe('Build 게이트 실패는 1회 재시도한다', () => {
  it('SKILL.md Phase 종료 4번: 곧바로 failed 로 끝내지 않고 같은 Build 서브에이전트에 실패 목록을 넘긴다', () => {
    expect(SKILL).toContain('**Build 게이트가 실패하면 곧바로\n   failed 로 끝내지 않고** 같은 Build 서브에이전트에 실패 목록')
    expect(SKILL).toContain('SendMessage 가 안 되면(이미 회수됐거나 도구가 없다) 같은 Phase·같은 모델의 새 에이전트를 실패 목록과 함께 띄운다')
  })
  it('dev-discipline Build 절에도 같은 규칙이 있다', () => {
    const build = between(DISC, '## Phase 03', '## Phase 04')
    expect(build).toContain('**Build 게이트 실패는 1회 재시도한다.**')
  })
})

describe('변이 검증은 Build 한 곳, Verify 는 감사', () => {
  const build = between(DISC, '## Phase 03', '## Phase 04')
  const verify = between(DISC, '## Phase 04', '## Phase 05')
  it('Build: 대상 테스트만 fail-fast, heavy.sh 안에서 한 번에, design.md 에 기록 표', () => {
    expect(build).toContain('**변이 검증은 Build 한 곳에서만 돌린다**')
    expect(build).toContain('vitest\n    `--bail=1`, jest `--bail`, Gradle `test --fail-fast --tests <클래스>`')
    expect(build).toContain('`## 변이 검증 기록`')
    expect(build).toContain('`불변 규칙 | 변이 | 잡은 테스트 | 결과`')
    expect(build).toContain('`git stash` 는 쓰지 않는다')
    expect(build).toContain('Build 서브에이전트는 전체 스위트를 돌리지 않는다')
    expect(build).toContain('`--findRelatedTests')
  })
  it('Verify: 전체 스위트를 다시 돌리지 않고, 코드를 고쳤을 때만 게이트가 돈다', () => {
    expect(verify).toContain('전체 스위트를 다시 돌리지 않는다')
    expect(verify).toContain('「변이 검증 기록」 표의 행마다')
    expect(verify).toContain('**화면 작업이면 E2E 를 돌린다**')
    expect(verify).toContain('`git diff --name-only <Build 게이트 sha>..HEAD`')
    expect(SKILL).toContain('`git diff --name-only <Build 게이트 sha>..HEAD`')
    expect(SKILL).toContain('state.json 의 `build_gate`')
  })
  it('research/docs 특례 작업은 기록 표 대신 문서 검증 체크리스트를 쓴다(Build·Verify·오케스트레이터 감사 셋 다)', () => {
    expect(build).toContain('research/docs 특례 작업(「research/docs 작업 특례」)은 변이할 코드가 없으므로')
    expect(verify).toContain('research/docs 특례\n   작업은 표 대신 문서 검증 체크리스트를 순회한다')
    expect(SKILL).toContain('research/docs 특례 작업(dev-discipline 「research/docs 작업 특례」)은 표 대신')
  })
  it('재실행 생략은 커밋 밖에 남은 파일(되돌리지 못한 변이)이 없을 때만이다', () => {
    expect(verify).toContain('`git status --porcelain` 도 Task 문서 밖에서 비어 있으면')
    expect(SKILL).toContain('`git status --porcelain` 도 Task 문서 밖에서 비어 있으면')
  })
  it('예상 효과 표가 추정임을 밝힌다', () => {
    const eff = between(DISC, '## 전체 스위트 실행 횟수', '## 모델 배정')
    expect(eff).toContain('**추정**')
    expect(eff).toContain('| 합계 | 약 12~17 | 약 2~3 |')
  })
})

describe('토큰 규칙', () => {
  it('dev-discipline 공통 금지와 SKILL.md 공통 프롬프트에 Edit·tail/grep·Agent model·인용 절만 읽기가 있다', () => {
    const ban = DISC.slice(DISC.indexOf('## 공통 금지'))
    for (const s of ['Edit 를 쓴다', '`tail`·`grep`', '`sonnet` 이나 `haiku` 를 적는다', '프롬프트에 인용된 절만 읽는다'])
      expect(ban, s).toContain(s)
    const idx = SKILL.indexOf('공통 프롬프트에는 **토큰 규칙**도 넣는다')
    expect(idx).toBeGreaterThan(-1)
    expect(idx).toBeLessThan(SKILL.indexOf('커밋 규칙에는 **모든 커밋에'))
    expect(SKILL).toContain('dev-discipline.md 는 전체를 읽지 말고 이\n프롬프트가 인용한 절만 읽는다')
  })
})
