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
// Phase 규율은 Phase 파일로 나뉘었다(서브에이전트는 자기 파일만 읽는다). 줄바꿈 위치는 보지 않는다(flat).
const ref = (f: string) => readFileSync(join(ROOT, '.claude/skills/dflow-dev/references', f), 'utf8')
const PROMPT = ref('phase-prompt.md')
const DESIGN = ref('phase-design.md')
const BUILD = ref('phase-build.md')
const VERIFY = ref('phase-verify.md')
const flat = (s: string) => s.replace(/\s+/g, ' ')
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
    const p05 = between(DISC, '## Phase 05', '## 모델 배정')
    expect(p05).toContain('무인 모드에서는 이 Phase 를 실행하지 않는다')
    expect(p05).toContain('`/dflow-team` 팀원(`/dflow-dev` 「--worker」 I)')
    expect(p05).toContain('Refactor 가 커밋을 남기지 않았으면(고칠 것이 없었다) Refactor 게이트를 돌리지 않는다')
  })
  it('워커 표(worker-mode.md)에 행 I 가 있고, 표지 머리와 끝 문장이 아홉 행을 말한다', () => {
    const sec = ref('worker-mode.md')
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
    const sec = ref('worker-mode.md')
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
  it('Phase 공통 프롬프트(phase-prompt.md)에 heavy 한 줄이 포그라운드 다음에 있고, SKILL 의 트레일러 문단은 표지 블록 E 앞이다', () => {
    const idx = PROMPT.indexOf('5. 무거운 명령:')
    expect(idx).toBeGreaterThan(PROMPT.indexOf('4. 포그라운드:'))
    expect(flat(PROMPT)).toContain('모든 gradlew/mvn 호출(단일 테스트 포함)·의존성 설치는 `.claude/skills/dflow-dev/scripts/heavy.sh` 로 감싸')
    expect(SKILL.indexOf('커밋 규칙에는 **모든 커밋에')).toBeLessThan(SKILL.indexOf('<!-- worker:begin -->\n`--worker` 면 공통 프롬프트에 git 절대경로'))
  })
})

describe('Build 게이트 실패는 1회 재시도한다', () => {
  it('SKILL.md Phase 종료 4번: 곧바로 failed 로 끝내지 않고 같은 Build 서브에이전트에 실패 목록을 넘긴다', () => {
    expect(SKILL).toContain('**Build 게이트가 실패하면 곧바로\n   failed 로 끝내지 않고** 같은 Build 서브에이전트(구현 단위가 여럿이면 마지막 단위)에 실패 목록')
    expect(SKILL).toContain('SendMessage 가 안 되면(이미 회수됐거나 도구가 없다) 같은 Phase·같은 모델의 새 에이전트를 실패 목록과 함께 띄운다')
  })
  it('phase-build.md 에도 같은 규칙이 있다', () => {
    const build = BUILD
    expect(build).toContain('**Build 게이트 실패는 1회 재시도한다.**')
  })
})

describe('변이 검증은 Build 한 곳, Verify 는 감사', () => {
  const build = BUILD
  const verify = VERIFY
  it('Build: 대상 테스트만 fail-fast, heavy.sh 안에서 한 번에, build-log.md 에 기록 표', () => {
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
    expect(build).toContain('research/docs 특례 작업(spec 의 category 가 research/docs. dev-discipline.md 「research/docs 작업 특례」)은 변이할 코드가 없으므로')
    expect(verify).toContain('research/docs 특례 작업은 표 대신 문서 검증 체크리스트를 순회한다')
    expect(SKILL).toContain('research/docs 특례 작업(dev-discipline 「research/docs 작업 특례」)은 표 대신')
  })
  it('재실행 생략은 커밋 밖에 남은 파일(되돌리지 못한 변이)이 없을 때만이다', () => {
    expect(verify).toContain('`git status --porcelain` 도 Task 문서 밖에서 비어 있으면')
    expect(SKILL).toContain('`git status --porcelain` 도 Task 문서 밖에서 비어 있으면')
  })
  it('예상 효과 표가 추정임을 밝힌다(순수 이력이라 rationale.md 로 옮겼다)', () => {
    const eff = ref('rationale.md').split('### 전체 스위트 실행 횟수')[1] ?? ''
    expect(eff).toContain('**추정**')
    expect(eff).toContain('| 합계 | 약 12~17 | 약 2~3 |')
  })
})

describe('토큰 규칙', () => {
  it('dev-discipline 공통 금지와 SKILL.md 공통 프롬프트에 Edit·tail/grep·Agent model·인용 절만 읽기가 있다', () => {
    const ban = DISC.slice(DISC.indexOf('## 공통 금지'))
    for (const s of ['Edit 를 쓴다', '`tail`·`grep`', '`sonnet` 이나 `haiku` 를 적는다', '프롬프트에 인용된 절만 읽는다'])
      expect(ban, s).toContain(s)
    const p = flat(PROMPT)
    for (const s of ['Edit 로 고친다', 'tail·grep 으로 필요한 부분만 본다', 'model(sonnet 또는 haiku)을 적는다'])
      expect(p, s).toContain(s)
    expect(p).toContain('dev-discipline.md 등 다른 문서는 전체를 읽지 말고 이 프롬프트나 그 파일이 인용한 절만 읽는다')
    expect(SKILL).toContain('템플릿을 그대로 보내고 `{…}` 변수만 채운다**')
  })
})

describe('읽기 규율(design.md 는 한 번, 기록은 build-log.md)', () => {
  it('phase-prompt 공통 규칙 2 가 읽기 규율이고 Build·Verify 가 build-log.md 를 쓴다', () => {
    const rule = flat(PROMPT.slice(PROMPT.indexOf('2. 읽기(Build·Verify·Refactor)'), PROMPT.indexOf('3. 병렬 조사')))
    expect(rule).toContain('design.md 전체는 처음 한 번만 Read 하고')
    expect(rule).toContain("grep -n '^## '")
    expect(rule).toContain('build-log.md 에 쓴다')
    expect(rule).toContain('(`## 담당자 확인 필요 결정`·`## 도커 금지로 생략한 검증`)')
    expect(rule).toContain('Read 의 offset·limit')
    expect(rule).toContain('300줄 이하 파일')
    expect(BUILD).toContain('build-log.md `## 설계 이탈`')
    expect(VERIFY).toContain('build-log.md 「변이 검증 기록」 표의 행마다')
    expect(DESIGN).toContain('design.md 에는 설계만 쓴다')
  })
  it('SKILL.md 가 Verify 감사를 build-log.md 에서 하고 공통 프롬프트를 phase-prompt.md 로 보낸다', () => {
    expect(SKILL).toContain('**Verify 의 감사 확인**: build-log.md 「변이 검증 기록」 표')
    expect(SKILL).toContain('`.claude/skills/dflow-dev/references/phase-prompt.md` 의 템플릿')
  })
})

describe('Build 구현 단위(단위마다 서브에이전트, 상한과 인계)', () => {
  const units = BUILD.slice(BUILD.indexOf('## 구현 단위'), BUILD.indexOf('## TDD 와 변이 검증'))
  it('Design 이 표로 정하고(phase-design), Build 단위는 상한·인계로 끝난다(phase-build). 작은 작업은 B1 하나로 종전과 같다', () => {
    expect(DESIGN).toContain('`단위 | 범위(파일·기능) | 새 테스트 | 담당 불변 규칙`')
    expect(DESIGN).toContain('**작은 작업은 표를 생략한다** — 단위 하나(B1)이며 종전 Build 와 같다.')
    expect(between(DISC, '### 구현 단위', '## Phase 05')).toContain('표가 없으면 단위 하나(B1)이며 종전 Build 와 같다')
    expect(units).toContain('**마지막 단위가 연결을 맡는다**')
    expect(units).toContain('**변이 검증 담당**')
    expect(units).toContain('`UNIT_DONE <단위>`')
    expect(units).toContain('`UNIT_HANDOFF <단위>`')
    expect(units).toContain('도구 호출이 약 80회를 넘었거나')
    expect(units).toContain('컨텍스트 250K 토큰(추정)')
    expect(units).toContain('build-log.md `## 인계 <단위>`')
    expect(DESIGN).toContain('design.md 에 `## 구현 단위` 표를 둔다')
    expect(BUILD).toContain('Build 전체는 마지막 단위(연결 테스트 포함)가 끝나야 완료다')
    const model = DISC.split('\n').find((l) => l.startsWith('| Build |')) ?? ''
    expect(model).toContain('구현 단위는 모두 같은 모델')
  })
  it('SKILL.md: 단위 하나면 <TSK>-build 그대로, 여럿이면 <TSK>-build-<단위>, 이어 띄우기는 2회까지, phase 는 build 하나', () => {
    expect(SKILL).toContain('단위가 하나면 `<TSK>-build` 그대로다 — 이름·게이트·재시도가 종전과 같다')
    expect(SKILL).toContain('`<TSK>-build-<단위>`')
    expect(SKILL).toContain('이어 띄우기는 단위마다 2회까지다')
    expect(SKILL).toContain('마지막 단위가 아니면 게이트 없이 곧바로\n  `TaskStop` 하고 다음 단위를 띄운다')
    expect(SKILL).toContain('`build_unit`(선택)은 지금 도는 구현 단위')
    expect(SKILL).toContain('단위가 몇 개든 `phase` 는 Build 동안 `build` 하나다')
    expect(SKILL).toContain('띄우기 직전 state.json 의 `model` 과 `build_unit` 을 쓴다')
  })
  it('재개는 단위 커밋 트레일러(DFlow-Unit)로 끝난 단위를 가린다', () => {
    expect(BUILD).toContain('`--trailer "DFlow-Unit: <단위> done"`')
    expect(BUILD).toContain('`--trailer "DFlow-Unit: <단위> handoff"`')
    expect(SKILL).toContain("git log <기점>..HEAD --grep='DFlow-Unit: <단위> done' --format=%h")
  })
  it('템플릿의 빈 변수 지우기가 정체 문장을 지우지 않는다({UNIT} 은 제 줄에 있다)', () => {
    expect(PROMPT).toContain("Phase 서브에이전트다.\n{UNIT}\n")
    expect(PROMPT).toContain('`{TSK}`·`{PHASE}`·`{TASK_DIR}`·`{ORDER}` 는 늘 값이 있다')
  })
  it('화면 작업의 정의가 Build·Verify 파일과 오케스트레이터 읽기 목록에 있다', () => {
    for (const doc of [BUILD, VERIFY]) expect(flat(doc)).toContain('spec 에 `entry-point` 가 있거나 domain 이 `fullstack`·`frontend`')
    expect(flat(SKILL)).toContain('「화면 작업의 브라우저 E2E」·「도커 사용 규칙」')
  })
})
