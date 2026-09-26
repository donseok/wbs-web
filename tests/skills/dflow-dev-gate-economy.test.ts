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
    expect(heavy).toContain('90초 + 측정 시간이면 된다')
    expect(heavy).toContain('`DFLOW_BASELINE_WAIT` 를 줄인다')
    expect(DISC).toContain('한 호출의 총 대기는 90초 + 측정 시간 이하다')
    expect(heavy).not.toContain('합친 것보다 넉넉히 준다')
  })
  it('Phase 공통 프롬프트(phase-prompt.md)에 heavy 한 줄이 포그라운드 다음에 있고, SKILL 의 트레일러 문단은 표지 블록 E 앞이다', () => {
    const idx = PROMPT.indexOf('5. 무거운 명령:')
    expect(idx).toBeGreaterThan(PROMPT.indexOf('4. 포그라운드:'))
    expect(flat(PROMPT)).toContain('모든 gradlew/mvn 호출(단일 테스트 포함)·의존성 설치는 `.claude/skills/dflow-dev/scripts/heavy.sh` 로 감싸')
    expect(SKILL.indexOf('커밋 규칙에는 **모든 커밋에')).toBeLessThan(SKILL.indexOf('<!-- worker:begin -->\n`--worker` 면 공통 프롬프트에 git 절대경로'))
  })
})

describe('Task 브랜치는 개발 브랜치를 다시 머지하지 않는다(2026-09-26 감사: 워커 재머지 13건)', () => {
  const sec = flat(between(DISC, '## 개발 브랜치 재머지', '## 공통 금지'))
  it('금지 사유를 나열하고, 선행 코드가 꼭 필요할 때만 한 번 허용한다', () => {
    expect(sec).toContain('**개발 브랜치를 다시 머지하지 않는다.**')
    expect(sec).toContain('이유 없는 최신화("push 전 최신화"·"done 전 최신화")')
    expect(sec).toContain('재개한 세션의 따라잡기')
    expect(sec).toContain('**허용(유일)**: Task 가 코드상 의존하는 선행이 개발 브랜치에 막 들어왔고')
    expect(sec).toContain('한 Task 에서 한 번을 넘기지 않는다')
  })
  it('허용된 재머지는 새 기점으로 기준선을 다시 재고 gate-scope 도 새 기점으로 돈다', () => {
    expect(sec).toContain('`branch_base`·`baseline.base` 를 그 sha 로 바꾼다')
    expect(sec).toContain('새 기점의 기준선을 **이 작업 트리에서 재지 않는다**')
    expect(sec).toContain('`git worktree add --detach <임시 폴더> <새 기점>`')
    expect(sec).toContain('`baseline.sh list --base <새 기점>`')
    expect(sec).toContain('`gate-scope.sh --base <새 기점>`')
  })
  it('공통 금지와 워커 판단 규칙이 이 절을 가리킨다', () => {
    expect(DISC).toContain('- 개발 브랜치 재머지(허용 조건 밖) — 「개발 브랜치 재머지」.')
    const wp = readFileSync(join(ROOT, '.claude/skills/dflow-team/references/worker-prompt.md'), 'utf8')
    expect(flat(wp)).toContain('**개발 브랜치를 다시 머지하지 않는다**')
    expect(flat(wp)).toContain('dev-discipline 「개발 브랜치 재머지」')
  })
})

describe('총수는 합계 줄로 읽는다(스위트를 나눠 도는 리포 스크립트)', () => {
  it('첫 요약을 총수로 읽지 않고, 합계 줄이 있으면 그 줄을, 없으면 모든 요약의 합을 쓴다', () => {
    const base = flat(between(DISC, '## 게이트 기준선', '### 기준선 캐시'))
    expect(base).toContain('**총수는 합계 줄로 읽는다.**')
    expect(base).toContain('리포 스크립트가 합계 줄을 내면 그 줄을 총수·실패 수로 읽고, 합계 줄이 없으면 모든 요약의 수를 더한다')
    expect(base).toContain('기준선(`baseline.sh note --tests`)과 게이트는 같은 방법으로 읽는다')
  })
  it('콘솔에 총수가 안 나오는 러너는 junit-count.sh 로 세고, 모듈/full 범위와 --failed-file 을 명시한다', () => {
    const base = flat(between(DISC, '## 게이트 기준선', '### 기준선 캐시'))
    expect(base).toContain('**콘솔에 총수가 나오지 않는 러너(Gradle·Maven)는 명령이 끝난 직후 `junit-count.sh [<모듈 폴더>…]` 로 센다.**')
    expect(base).toContain('모듈 게이트면 대응표의 그 모듈 폴더만 넘기고, full 이면 리포 최상위에서 센다')
    expect(base).toContain('기준선과 게이트는 같은 폴더 인자로 센다')
    expect(base).toContain('실패 이름은 `--failed-file` 로 뽑아 `baseline.sh note` 에 넘긴다')
  })
})

describe('게이트 명령은 필요한 의존만 빌드하고 Task 도중에 바꾸지 않는다(2026-09-26 성능 감사)', () => {
  const base = between(DISC, '## 게이트 기준선', '### 기준선 캐시')
  it('단위 게이트는 의존 패키지만 빌드하고, 전체 라이브러리 빌드는 E2E 같은 명령에만 둔다', () => {
    expect(base).toContain('**게이트 명령은 필요한 의존만 빌드한다.**')
    expect(base).toContain('`pnpm --filter "<패키지>^..." build && pnpm --filter <패키지> test`')
  })
  it('기준선과 게이트는 같은 명령이고 좁히는 것은 새 Task 부터다', () => {
    expect(base).toContain('**기준선과 게이트는 같은 명령이고, Task 도중에 바꾸지 않는다.**')
    expect(flat(base)).toContain('더 좁은 명령으로 바꾸는 것은 새 Task 부터 한다')
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
  it('Build: Gradle 변이 스크립트는 데몬을 재사용하고, E2E 서버 bootRun 의 --no-daemon 만 예외로 남는다', () => {
    expect(build).toContain('**Gradle 변이 스크립트는 데몬을 재사용한다(`--no-daemon` 을 쓰지 않는다).**')
    expect(flat(build)).toContain('E2E 서버의 `bootRun --no-daemon`(e2e.md)은 오래 떠 있는 서버가 공용 데몬을 붙잡지 않게 하려는 것이라 유지한다')
    expect(ref('e2e.md')).toContain('./gradlew :api:bootRun --no-daemon')
  })
  it('Verify: 전체 스위트를 다시 돌리지 않고, 코드를 고쳤을 때만 게이트가 돈다', () => {
    expect(verify).toContain('전체 스위트를 다시 돌리지 않는다')
    expect(verify).toContain('「변이 검증 기록」 표의 의심 행 전부와 표본 2행만')
    expect(verify).toContain('**화면 작업이면 E2E 를 돌린다**')
    expect(verify).toContain('`git diff --name-only <Build 게이트 sha>..HEAD`')
    expect(SKILL).toContain('`git diff --name-only <Build 게이트 sha>..HEAD`')
    expect(SKILL).toContain('state.json 의 `build_gate`')
  })
  it('대응표(.dflow-gates)가 있으면 뒤집힌다: Build 게이트는 영향 모듈, 전체는 Verify 게이트가 한 번(서브에이전트는 여전히 안 돈다)', () => {
    expect(flat(verify)).toContain('**리포에 게이트 대응표(`.dflow-gates`)가 있으면** Build 게이트는 바꾼 모듈만 돌았을 수 있다')
    expect(flat(verify)).toContain('**오케스트레이터의 Verify 게이트가 한 번** 돈다 — 머지 전 최종 증거다. 당신은 여전히 전체 스위트를 돌리지 않는다')
    expect(flat(SKILL)).toContain('**대응표가 있고 `build_gate.scope` 가 `module` 이면 Verify 게이트는 재실행을 생략하지 않고 `full` 명령을 한 번 돈다**')
    expect(flat(SKILL)).toContain('`build_gate.scope` 가 `full` 이면 위 생략 규칙 그대로다')
    expect(flat(build)).toContain('전체 스위트 대신 프롬프트의 좁힌 명령에 든 모듈 게이트 명령으로 넘어간다')
    expect(flat(PROMPT)).toContain('예측 범위의 모듈 게이트 명령(`GATE_SCOPE module` 줄)도 넣고')
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
    expect(VERIFY).toContain('build-log.md 「변이 검증 기록」 표의 의심 행 전부와 표본 2행만')
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
    expect(DESIGN).toContain('`단위 | 묶음 | 범위(파일·기능) | 새 테스트 | 담당 불변 규칙`')
    expect(DESIGN).toContain('**작업 전체가 도구 호출 약 120회 안에 끝날 것으로 보이면 표를 생략한다** — 단위 하나(B1)이며 종전 Build 와 같다.')
    expect(between(DISC, '### 구현 단위', '## Phase 05')).toContain('표가 없으면 단위 하나(B1)이며 종전 Build 와 같다')
    expect(units).toContain('**마지막 단위가 연결을 맡는다**')
    expect(units).toContain('**변이 검증 담당**')
    expect(units).toContain('`UNIT_DONE <단위>`')
    expect(units).toContain('`UNIT_HANDOFF <단위>`')
    expect(units).toContain('도구 호출이 약 120회를 넘었거나')
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
    // 이어 띄우기 2회는 세션 기억이 아니라 인계 트레일러로 센다(재개해도 이어진다). 단위 하나짜리도 트레일러를 붙인다
    expect(SKILL).toContain("git log <기점>..HEAD --grep='DFlow-Unit: <단위> handoff' --format=%h` 줄 수로 센다")
    expect(BUILD).toContain('단위가 하나여도 `--trailer "DFlow-Unit: <단위> handoff"`')
  })
  it('Build 게이트 재시도는 단위 범위 제한을 풀고, 재시도 중 인계는 단위 상한에 들며, 회수는 -c<n> 을 포함한 이름으로 한다', () => {
    expect(flat(SKILL)).toContain('"재시도 때는 단위 범위 제한 없이 Build 전체를 고친다" 를 넘겨')
    expect(flat(SKILL)).toContain('재시도 중 인계(`UNIT_HANDOFF`)는 단위 상한 2회에 포함하고')
    expect(BUILD).toContain('다른 단위의 파일은 고치지 않는다(Build 게이트 재시도 때는 Build 전체를 고친다)')
    expect(SKILL).toContain('Build 는 띄울 때 붙인 이름 그대로(`-c<n>` 포함) 회수하고')
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

describe('게이트 범위 대응표(.dflow-gates) — 2026-09-26 성능 감사', () => {
  const sec = flat(between(DISC, '### 게이트 범위 대응표(.dflow-gates)', '### 강제 재실행'))
  it('대응표가 없으면 절 전체를 건너뛴다(지금 동작 그대로)', () => {
    expect(sec).toContain('**대응표가 없으면 이 절 전체를 건너뛴다**')
    expect(flat(SKILL)).toContain('대응표가 없으면 위 그대로다')
    expect(flat(SKILL)).toContain('`none` 이면 위 그대로, `invalid` 면 사유를 한 줄 보고하고 위 그대로다')
  })
  it('형식: full·prepare 예약어, - 줄, 의존 모듈은 명령이 포함, 리포 최상위 cwd', () => {
    expect(sec).toContain('`full<TAB><명령>` — 전체 게이트 명령(예약어')
    expect(sec).toContain('`prepare<TAB><명령>` — 새 워크트리의 의존성 설치 직후 한 번 돌리는 준비 빌드(예약어')
    expect(sec).toContain('**모듈 명령은 그 모듈에 의존하는 모듈의 테스트까지 스스로 포함한다**')
    expect(sec).toContain('명령은 리포 최상위에서 돈다')
    expect(sec).toContain('.claude/skills/dflow-dev/scripts/gate-scope.sh --base <기점> --ignore <TASKS>/<TSK>/')
    // 복합 명령(`A && B`)도 한 슬롯에서 통째로 돌고 로그·rc 가 맞게 bash -c 로 감싼다
    expect(sec).toContain("게이트는 `heavy.sh bash -c '<명령>'` 으로 감싸 한 슬롯에서 통째로 돈다")
    expect(flat(between(DISC, '### 게이트 기록', '### research/docs 작업 특례'))).toContain("heavy.sh bash -c '<게이트 명령>'")
    expect(flat(SKILL)).toContain("`heavy.sh bash -c '<명령>'` 으로 감싸 돌고(복합 명령도 한 슬롯에서)")
  })
  it('모듈 기준선은 Design 게이트 직후(트리가 기점과 코드가 같을 때)만 잰다', () => {
    expect(sec).toContain('**모듈 명령의 기준선은 Design 게이트 통과 직후, 첫 Build 단위를 띄우기 전에 잰다**')
    expect(sec).toContain('아니면 (Build 뒤 재개 등) 모듈 기준선을 재지 않는다')
    expect(flat(SKILL)).toContain('**Design 게이트 뒤(대응표가 있을 때만)**')
    expect(flat(SKILL)).toContain('`"base": "<기점 sha>"`')
  })
  it('Build 게이트: 기준선 없는 모듈 명령이 하나라도 있으면 전체, Verify 게이트: 모듈 범위였으면 전체 한 번', () => {
    expect(sec).toContain('기준선이 없는 명령이 하나라도 있으면(예측 밖 모듈을 건드렸다) `full` 명령으로 돈다')
    expect(sec).toContain('`full` 명령을 **재실행 생략 없이 한 번** 돈다 — 머지 전 최종 증거다')
    expect(sec).toContain('같은 트리의 전체 실행을 두 번 하지 않는다')
  })
  it('강제 재실행은 부분 실행 상태가 남았을 때만, 근거는 mtime 을 새로 찍는 되돌리기', () => {
    const force = flat(between(DISC, '### 강제 재실행', '### 게이트 기록'))
    expect(force).toContain('**변이 드라이버가 부분 실행 상태를 남겼을 때만** 쓴다')
    expect(force).toContain('그 밖에는 Gradle 의 UP-TO-DATE 를 믿는다')
    expect(force).toContain('phase-build.md 「되돌리기(백업 사본으로 통일)」')
    expect(flat(BUILD)).toContain('**강제 재실행(`--rerun-tasks`·`cleanTest`)은 부분 실행 상태가 남았을 때만 쓴다**')
  })
  it('게이트 기록: 오케스트레이터가 build-log.md 표에 명령·범위·경과·부하·결과를 한 줄씩', () => {
    const log = flat(between(DISC, '### 게이트 기록', '### research/docs 작업 특례'))
    expect(log).toContain('`<TASKS>/<TSK>/build-log.md` 의 `## 게이트 기록` 표에 한 줄을 더한다')
    for (const col of ['| 시각 |', '| Phase |', '| 명령 |', '| 범위 |', '| 경과 |', '| 부하 |', '| 결과 |']) expect(log).toContain(col)
    expect(log).toContain('sysctl -n vm.loadavg')
    expect(log).toContain('/proc/loadavg')
    expect(log).toContain('`HEAVY_BUSY`(exit 75)로 돌지 못한 호출은 적지 않는다')
    expect(flat(SKILL)).toContain('**게이트 기록**: 위 게이트 명령과 모듈 기준선 측정을 돌릴 때마다 build-log.md `## 게이트 기록`')
  })
  it('예시 파일과 .dflow 안내가 있고, 킷 문서에 특정 프로젝트 이름이 없다', () => {
    const ex = ref('dflow-gates.example')
    expect(ex).toMatch(/^full\t/m)
    expect(ex).toMatch(/^prepare\t/m)
    expect(readFileSync(join(ROOT, '.claude/skills/dflow-work/dflow.example'), 'utf8')).toContain('.dflow-gates')
    for (const doc of [sec, ex]) {
      expect(doc).not.toContain('dmes')
      expect(doc).not.toContain('@dk-oasis')
    }
  })
})

// 2026-09-26 병렬성·토큰 개선(설계 docs/superpowers/specs/2026-09-26-dflow-parallel-token-design.md 개선 1~3)
describe('Verify 는 읽기 전용 감사자 셋과 작성자 하나', () => {
  it('phase-verify: 작성자만 작업 트리를 고치고, 첫 보고는 VERIFY_EXEC, 지적 왕복은 재시도에 세지 않는다', () => {
    const v = flat(VERIFY)
    expect(v).toContain('**Verify 는 읽기 전용 감사자 셋과 작성자 하나(당신)로 나뉜다.**')
    expect(v).toContain('작업 트리를 고치는 것은 당신 혼자다')
    expect(v).toContain('`VERIFY_EXEC done` 또는 `VERIFY_EXEC fail` 로 보고한다')
    expect(v).toContain('`수용`·`기각(사유)` 을 판정하고')
    expect(v).toContain('감사 지적을 받아 처리하는 왕복은 재시도에 세지 않는다')
  })
  it('SKILL.md: 넷을 한 메시지에 띄우고, 감사자는 sonnet 읽기 전용, VERIFY_EXEC 로 작성자를 회수하지 않는다', () => {
    const k = flat(SKILL)
    expect(k).toContain('**Verify 는 읽기 전용 감사자 셋과 작성자 하나를 한 메시지에 동시에 띄운다**')
    expect(k).toContain('`<TSK>-audit-spec`·`<TSK>-audit-review`·`<TSK>-audit-tests`')
    expect(k).toContain('`model: "sonnet"`')
    expect(k).toContain('**이 보고로 회수하지 않는다.**')
    expect(k).toContain('Verify 작성자의 `VERIFY_EXEC` 는 게이트 시점이 아니다')
    expect(k).toContain('**같은 작성자에게 SendMessage 로**')
    expect(k).toContain('이 왕복은 Verify 재시도 1회에 세지 않는다')
    expect(k).toContain('Verify 재시도(아래 4번)는 작성자에게만 이어 붙이고 감사자는 다시 띄우지 않는다')
  })
  it('감사 템플릿: 커밋된 내용만 읽고(diff 를 파일마다), 쓰기 금지, 역할 셋, 호출 약 40회, 보고 첫 줄', () => {
    const t = flat(PROMPT.slice(PROMPT.indexOf('## 감사 템플릿'), PROMPT.indexOf('## 규칙의 정본')))
    expect(t).toContain('소스·테스트는 작업 트리에서 Read 하지 말고 커밋된 내용만 읽는다')
    expect(t).toContain('`git diff --stat {BASE}..{BUILD_HEAD}`')
    expect(t).toContain('`git show {BUILD_HEAD}:<경로>`')
    expect(t).toContain('{WORKER_LINES}')
    for (const r of ['- spec:', '- review:', '- tests:']) expect(t, r).toContain(r)
    expect(t).toContain('도구 호출은 약 40회 안에서 끝낸다')
    expect(t).toContain('`AUDIT_RESULT {ROLE} <지적 수>`')
  })
  it('모델 배정표: 감사자도 sonnet(haiku 금지 유지)', () => {
    const row = DISC.split('\n').find((l) => l.startsWith('| Verify |')) ?? ''
    expect(row).toContain('작성자와 감사자 셋 모두')
    expect(row).toContain('haiku 는 쓰지 않는다')
  })
})

describe('Verify 변이 재실행은 표본 감사', () => {
  it('의심 행 전부 + 서로 다른 규칙의 표본 2행, 어긋나면 전수', () => {
    const v = flat(VERIFY)
    expect(v).toContain('잡은 테스트 칸이 비었거나 `-` 인 행')
    expect(v).toContain('`안 잡힘(보강함)` 행(보강한 테스트가 실제로 잡는지)')
    expect(v).toContain('서로 다른 불변 규칙의 행 2개를 고른다')
    expect(v).toContain('고른 행과 고른 이유를 보고에 적는다')
    expect(v).toContain('**표본이 하나라도 기록과 다르게 나오면(안 잡힘) 표본 감사를 버리고 남은 행을 모두 다시 넣는다.**')
    expect(v).not.toContain('「변이 검증 기록」 표의 행마다')
  })
})

describe('구현 단위 크기(50~100회, 상한 120회, 전체 120회 이하면 단위 1개)', () => {
  it('Design·Build·SKILL.md 가 같은 수치를 쓰고 80회가 남지 않는다', () => {
    expect(DESIGN).toContain('도구 호출 약 50~100회에 끝날 크기로(50회 미만으로 예상되는 단위는 이웃 단위와 합친다)')
    expect(BUILD).toContain('도구 호출이 약 120회를 넘었거나')
    expect(SKILL).toContain('단위 상한(도구 호출 약 120회·컨텍스트 250K 추정)')
    for (const f of [DESIGN, BUILD, SKILL]) expect(f).not.toContain('80회')
  })
  it('rationale 이 곡선 근거를 남기고 "제곱에 비례" 를 단정하지 않는다', () => {
    const r = ref('rationale.md')
    expect(r).toContain('W ≈ 0.028M × calls + 0.000024 × calls²')
    expect(r).not.toContain('누적은 호출 수의 제곱에 비례한다.')
  })
})
