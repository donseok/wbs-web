// tests/skills/dflow-dev-build-parallel.test.ts
//
// 계약 테스트: Build 구현 단위 병렬 묶음(스펙 docs/superpowers/specs/2026-09-26-build-unit-parallel-design.md).
// 컴파일 범위가 다르고 서로 기대지 않는 단위는 같은 워크트리에서 동시에 돈다. 병렬 단위는 git 에 쓰지 않고,
// 커밋은 묶음이 끝난 뒤 오케스트레이터가 단위마다 한다(트레일러·재개 규칙은 그대로). 묶음 열이 없으면 종전 순차다.
import { describe, expect, it } from 'vitest'
import { devAll } from './_dflow-dev'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const SKILL = devAll()
const ref = (f: string) => read(join('.claude/skills/dflow-dev/references', f))
const DESIGN = ref('phase-design.md')
const BUILD = ref('phase-build.md')
const PROMPT = ref('phase-prompt.md')
const DISC = ref('dev-discipline.md')
const RATIONALE = ref('rationale.md')
const TEAM = read('.claude/skills/dflow-team/SKILL.md')
const TEAM_RATIONALE = read('.claude/skills/dflow-team/references/rationale.md')
const flat = (s: string) => s.replace(/\s+/g, ' ')
const between = (text: string, start: string, end: string) => text.split(start)[1]?.split(end)[0] ?? ''

describe('Design: 구현 단위 표의 묶음 열', () => {
  const table = flat(between(DESIGN, '## 구현 단위 표', '\n## ') || DESIGN.split('## 구현 단위 표')[1] || '')
  it('열에 묶음이 있고, 같은 묶음은 같은 워크트리에서 동시에 돈다', () => {
    expect(DESIGN).toContain('`단위 | 묶음 | 범위(파일·기능) | 새 테스트 | 담당 불변 규칙`')
    expect(table).toContain('같은 묶음 번호의 단위는 같은 워크트리에서 동시에 돈다')
  })
  it('같은 묶음의 조건: 컴파일 범위가 다르고, 서로의 산출물에 기대지 않고, 파일이 겹치지 않는다', () => {
    expect(table).toContain('서로 다른 컴파일 범위')
    expect(table).toContain('서로의 산출물(API·타입·스키마)에 기대지 않는다')
    expect(table).toContain('단위끼리 같은 파일을 고치지 않게 나눈다')
  })
  it('마지막 단위는 혼자 마지막 묶음이고, 묶음 열이 없으면 종전 순차다', () => {
    expect(table).toContain('마지막 단위는 혼자 마지막 묶음이다')
    expect(table).toContain('`묶음` 열이 없거나 비면 단위마다 다른 묶음이다(종전 순차)')
  })
})

describe('Build: 병렬 묶음의 단위는 git 에 쓰지 않고 보고로 넘긴다', () => {
  const par = flat(between(BUILD, '### 병렬 묶음의 단위', '## TDD 와 변이 검증'))
  it('git 쓰기 명령과 build-log.md 쓰기를 하지 않는다(읽기만)', () => {
    expect(par).toContain('git 에 쓰지 않는다')
    expect(par).toContain('`git add`·`git commit`·`git checkout`·`git restore`·`git reset`·`git stash`')
    expect(par).toContain('build-log.md 를 쓰지 않는다')
  })
  it('변이 검증은 자기 몫을 돌리되 git 이 아니라 백업 사본으로 되돌린다', () => {
    expect(par).toContain('백업 사본을 복사해 되돌린다')
  })
  it('보고에 바꾼 파일 전부(추적 안 된 새 파일 포함)와 build-log.md 에 옮길 내용을 담는다', () => {
    expect(par).toContain('추적 안 된 새 파일 포함')
    for (const k of ['`바꾼 파일:`', '`변이 검증 기록:`', '`설계 이탈:`', '`인계:`']) expect(par).toContain(k)
  })
  it('기존 단위 완료·인계 규칙은 순차 단위에 그대로 남는다', () => {
    expect(BUILD).toContain('`--trailer "DFlow-Unit: <단위> done"`')
    expect(BUILD).toContain('단위가 하나여도 `--trailer "DFlow-Unit: <단위> handoff"`')
  })
})

describe('Build: 변이 되돌리기는 백업 사본 방식 하나로 통일한다(순차·병렬 공통)', () => {
  const tdd = flat(between(BUILD, '## TDD 와 변이 검증', '  - **기록**'))
  it('백업은 작업 트리 밖 dflow-bak 에 단위별로 둔다(이름 겹침 방지)', () => {
    expect(tdd).toContain('$(git rev-parse --git-dir)/dflow-bak/<단위>/<파일 경로>')
    expect(tdd).toContain('단위별 하위 폴더라 병렬 단위끼리도 이름이 겹치지 않는다')
  })
  it('되돌린 파일은 mtime 이 새로 찍혀야 한다 — cp -p·touch -r 금지(같으면 Gradle 이 재컴파일을 건너뛴다)', () => {
    expect(tdd).toContain('`cp -p`·`touch -r` 로 mtime 을 맞추지 않는다')
    expect(tdd).toContain('크기·mtime 이 원본과 같으면 Gradle 이 재컴파일을 건너뛴다')
  })
  it('git checkout -- <파일> 은 쓰지 않는다 — 미커밋 구현까지 지운다', () => {
    expect(tdd).toContain('`git checkout --')
    expect(tdd).toContain('<파일>` 은 쓰지 않는다')
    expect(tdd).toContain('그 파일의 미커밋 구현까지 지운다')
  })
  it('git stash 는 쓰지 않는다·변이를 커밋하지 않는다 는 그대로 남는다', () => {
    expect(tdd).toContain('`git stash` 는 쓰지')
    expect(tdd).toContain('않는다(스택이 워크트리 전체에 공유된다)')
    expect(tdd).toContain('변이를 커밋하지 않는다')
  })
  it('trap 으로 중단돼도 되돌리는 셸 예시가 있다', () => {
    expect(BUILD).toContain("trap 'cp \"$BAK\" \"<파일>\"; rm -f \"$BAK\"' EXIT")
  })
  it('병렬 묶음 절은 이 규칙을 가리키기만 하고 중복 서술하지 않는다', () => {
    const par = flat(between(BUILD, '### 병렬 묶음의 단위', '## TDD 와 변이 검증'))
    expect(par).toContain('「TDD 와 변이 검증 > 되돌리기」의 규칙')
    expect(par).not.toContain('.dflow-bak')
  })
})

describe('Phase 프롬프트: {UNIT} 병렬 표기와 커밋 규칙 예외', () => {
  it('{UNIT} 값에 병렬 묶음 표기가 있고, 공통 규칙 1 이 병렬 단위를 예외로 둔다', () => {
    expect(PROMPT).toContain('`구현 단위 <단위>(병렬 묶음 — 커밋·build-log 쓰기 없이 보고로 넘긴다)`')
    expect(flat(PROMPT)).toContain('병렬 묶음의 Build 단위는 phase-build.md 「병렬 묶음의 단위」 대로 커밋하지 않는다')
  })
})

describe('오케스트레이터: 묶음 실행·묶음 커밋·검사', () => {
  const p = flat(SKILL)
  it('build_unit 은 병렬 묶음이면 쉼표로 이은 단위 목록이다', () => {
    expect(SKILL).toContain('`build_unit`(선택)은 지금 도는 구현 단위')
    expect(p).toContain('병렬 묶음이면 동시에 도는 단위를 쉼표로 잇는다(`"B1,B2"`)')
  })
  it('병렬 묶음은 한 메시지에 동시에 띄우고, 모두 보고할 때까지 커밋하지 않는다', () => {
    expect(p).toContain('표의 `묶음` 순서대로 돈다')
    expect(p).toContain('그 단위들을 한 메시지에 동시에 띄우고, 모두 보고할 때까지 커밋하지 않는다')
  })
  it('묶음 검사: 파일 목록이 겹치지 않고 표의 범위 안이며, 커밋 뒤 Task 문서 밖이 깨끗하다', () => {
    expect(p).toContain('단위들의 파일 목록이 서로 겹치지 않는다')
    expect(p).toContain('design.md 표의 그 단위 범위 안이다')
    expect(p).toContain('`git status --porcelain` 이 Task 문서 밖에서 비어 있어야 한다')
  })
  it('커밋은 단위마다 차례로, 종전 트레일러 그대로', () => {
    expect(p).toContain('단위마다 차례로 그 단위 파일만 stage 해 커밋한다')
    expect(p).toContain('`--trailer "DFlow-Unit: <단위> done"`')
  })
  it('인계한 단위는 묶음 커밋 뒤 혼자 이어 띄우고, 실패하면 끝난 형제는 커밋하고 멈춘다', () => {
    expect(p).toContain('인계한 단위는 묶음 커밋 뒤 혼자 이어 띄운다')
    expect(p).toContain('형제의 보고를 기다려 끝난 단위는 커밋한 뒤 Build 실패로 멈춘다')
  })
  it('순차 경로 문구(종전)는 남는다', () => {
    expect(SKILL).toContain('마지막 단위가 아니면 게이트 없이 곧바로\n  `TaskStop` 하고 다음 단위를 띄운다')
  })
})

describe('규율 요약·근거·팀장 주입 문구', () => {
  it('dev-discipline 「구현 단위」 가 묶음을 가리킨다', () => {
    expect(flat(between(DISC, '### 구현 단위', '## Phase 05'))).toContain('같은 `묶음` 의 단위는 동시에 돈다')
  })
  it('rationale 에 순차가 기본인 이유와 병렬 조건이 있다', () => {
    const r = flat(between(RATIONALE, '## 구현 단위 순차와 병렬 묶음', '\n## '))
    expect(r).toContain('순차가 기본인 이유')
    expect(r).toContain('index.lock')
    expect(r).toContain('lint-staged')
  })
  it('팀장의 멈춘 오케스트레이터 주입 문구가 묶음을 안다', () => {
    expect(TEAM).toContain('(구현 단위가 남았으면 다음 단위·묶음을 띄워라)')
    expect(TEAM_RATIONALE).toContain('(구현 단위가 남았으면 다음 단위·묶음을 띄워라)')
  })
})

// 2026-09-26 리뷰 반영 — 재개·공유 자원·마지막 단위 검사·인계 순서
describe('묶음 보강(리뷰 반영)', () => {
  const S = flat(SKILL)
  it('병렬 단위는 보고를 단위 보고 파일에도 쓰고, 재개는 그 파일로 묶음 커밋을 이어 한다', () => {
    expect(flat(BUILD)).toContain('`{TASK_DIR}/unit-report-<단위>.md` 에도 쓴다(git 에는 쓰지 않는다)')
    expect(flat(PROMPT)).toContain('자기 단위 보고 파일(unit-report-<단위>.md)만 쓰고')
    expect(S).toContain('done 트레일러가 없는 묶음 단위에 단위 보고 파일이 있으면 다시 띄우지 않고 그 파일로 위 1~5 를 한다')
    expect(S).toContain('보고 파일이 없는데 그 단위 범위에 커밋되지 않은 변경이 있으면 Build 실패로 멈춘다')
    expect(S).toContain('커밋이 끝나면 단위 보고 파일')
  })
  it('의존성 추가·코드 생성·공용 설정을 바꾸는 단위는 묶지 않는다', () => {
    expect(flat(DESIGN)).toContain('공유 자원을 바꾸는 단위는 어느 묶음에도 넣지 않는다(혼자 한 묶음)')
  })
  it('마지막 단위가 혼자 마지막 묶음이 아니면 순차로 돈다', () => {
    expect(S).toContain('마지막 단위가 혼자 마지막 묶음인지 본다 — 아니면(phase-design.md 「구현 단위」 위반) `묶음` 열을 무시하고 순차로 돈다')
  })
  it('둘 이상 인계하면 차례로 이어 띄운다', () => {
    expect(S).toContain('둘 이상이 인계했으면 표 순서대로 하나씩 차례로 이어 띄운다')
  })
  it('순차 절차의 커밋 확인 문장이 병렬 예외를 가리킨다', () => {
    expect(S).toContain('그 단위 커밋이 있는지 확인한다(병렬 묶음의 단위는 아래 「묶음」')
  })
})
