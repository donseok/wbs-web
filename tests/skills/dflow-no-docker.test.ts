// 도커 사용 규칙 계약(2026-09-24 dmes-standard 사고: 팀원 6명이 Testcontainers(MSSQL)를 동시에 돌려 RAM 16GB 장비가
// 스왑 17GB·load 52, 한 팀원은 orb start 로 OrbStack 을 스스로 켰다). 정본은 dev-discipline.md 「도커 사용 규칙」 하나이고,
// 다른 문서는 가리키기만 한다. 금지 모드 = 팀장 포인터 NO_DOCKER=1(인원 기준) 또는 설정 no_docker=1(dflow-config.test.ts).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripWorkerBlocks, workerBlocks } from './_preserve'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const DISC = read('.claude/skills/dflow-dev/references/dev-discipline.md')
const DEV = read('.claude/skills/dflow-dev/SKILL.md')
const TEAM = read('.claude/skills/dflow-team/SKILL.md')
const WORKER = read('.claude/skills/dflow-team/references/worker-prompt.md')
const RESOLVE = read('.claude/skills/dflow-team/references/resolve-prompt.md')
const MC = read('.claude/skills/dflow-team/references/merge-conflict.md')
const OTHERS: [string, string][] = [
  ['dev-discipline', DISC], ['dflow-dev SKILL', DEV], ['worker-prompt', WORKER], ['resolve-prompt', RESOLVE], ['merge-conflict', MC],
  ['backends', read('.claude/skills/dflow-team/references/backends.md')],
  ['restart', read('.claude/skills/dflow-team/references/restart.md')],
  ['help', read('.claude/skills/dflow-team/references/help.md')],
]
const between = (t: string, a: string, b: string) => t.split(a)[1]?.split(b)[0] ?? ''
const count = (t: string, s: string) => t.split(s).length - 1
const RULE = between(DISC, '## 도커 사용 규칙', '## Phase 02 — Design')

describe('dev-discipline 「도커 사용 규칙」(정본)', () => {
  it('서버 프로세스 절 바로 뒤, Phase 02 앞에 새 절로 있다', () => {
    const iServer = DISC.indexOf('### 서버 프로세스 (정본')
    const iRule = DISC.indexOf('## 도커 사용 규칙 (정본')
    const iDesign = DISC.indexOf('## Phase 02 — Design')
    expect(iServer).toBeGreaterThan(0)
    expect(iRule).toBeGreaterThan(iServer)
    expect(iDesign).toBeGreaterThan(iRule)
    expect(count(DISC, '## 도커 사용 규칙')).toBe(1)
  })
  it('도커 런타임 기동 금지는 금지 모드·인원·설정과 무관하고, 꺼져 있으면 보고해 팀장 판단을 받는다', () => {
    expect(RULE).toContain('### 도커 런타임을 켜지 않는다 (언제나)')
    expect(RULE).toContain('금지 모드·인원·설정과 **무관하게**')
    for (const c of ['`orb start`', '`open -a Docker`', '`open -a OrbStack`', '`colima start`'])
      expect(RULE, c).toContain(c)
    expect(RULE).toContain('「9. 이슈 보고」')
    expect(RULE).toContain('팀장 판단을 받는다')
  })
  it('금지 모드는 spawn NO_DOCKER=1 또는 설정 no_docker=1 이고, 출처를 기준선 기록에 남긴다', () => {
    expect(RULE).toContain('`NO_DOCKER=1`')
    expect(RULE).toContain('.claude/skills/dflow-work/scripts/dflow.sh config no_docker')
    expect(RULE).toContain('`.dflow.local` 의 `no_docker`(이 PC, `.dflow` 를 덮는다)')
    expect(RULE).toContain('**판정 결과를 기준선 기록에 한 줄 남긴다.**')
    for (const v of ['"off"', '"banned:spawn"', '"banned:config"', '"banned:spawn+config"']) expect(RULE, v).toContain(v)
    expect(RULE).toContain('기준선을 다시\n  잰다')
    // 인원 기준값은 팀장 SKILL.md 한 곳에서만 정한다 — 정본은 이름으로 가리킨다
    expect(RULE).toContain('「도커 금지 인원 기준」')
  })
  it('금지 모드에서 빼는 명령: mssql·container·testcontainers 태스크, docker·docker compose·orb, Testcontainers 클래스', () => {
    for (const c of ['`mssql`', '`container`', '`testcontainers`', '`docker compose`', '`orb`', 'Testcontainers 를 쓰는 테스트 클래스', '`mssqlMigrationTest`'])
      expect(RULE, c).toContain(c)
    expect(RULE).toContain('**명령행 수단만 쓴다.** Gradle `-x <태스크>`')
    expect(RULE).toContain('빌드 파일·테스트 코드를 고쳐 빼지 않는다')
    expect(RULE).toContain('**기준선과 게이트는 같은 제외를 적용한 같은 명령 줄로 돈다.**')
  })
  it('게이트는 나머지로 판정하고, 생략은 design.md·done 요약에 남기며, 확인하지 못한 수용 기준을 조용히 통과시키지 않는다', () => {
    expect(RULE).toContain('게이트는 생략한 명령을 뺀 나머지로 판정한다')
    expect(RULE).toContain('`## 도커 금지로 생략한 검증`')
    expect(RULE).toContain('`- 도커 금지로 생략: <명령>`')
    expect(RULE).toContain('완료 보고(`done` 요약)에 `도커 금지로 생략: <명령>; …`')
    expect(RULE).toContain('**생략 때문에 수용 기준을 확인할 수 없게 되면 조용히 통과시키지 않는다.**')
    expect(RULE).toContain('`확인하지 못함(도커 금지로 생략: <명령>)`')
    expect(RULE).toContain('확인하지 못한 수용 기준 N건')
  })
  it('Phase 02~05 공통 프롬프트에 넣을 문구가 정본에 있다', () => {
    expect(RULE).toContain('"도커 금지 모드다. docker·Testcontainers')
    expect(RULE).toContain('정본: dev-discipline.md 「도커 사용')
  })
})

describe('참조 문서는 정본을 가리키기만 한다', () => {
  it('dflow-dev SKILL.md: 수동 본문(게이트 집행 원칙)과 --worker 절에 한 줄씩, 표지 블록 수는 그대로', () => {
    const manual = stripWorkerBlocks(DEV)
    const gate = between(manual, '## 게이트 집행 원칙', '## 상태 모델')
    expect(gate).toContain('dev-discipline.md 「도커 사용 규칙」')
    expect(manual).not.toContain('NO_DOCKER') // 포인터 값은 워커 경로에만 있다
    const sec = workerBlocks(DEV).at(-1)?.body ?? ''
    expect(sec).toContain('**도커 금지 모드(워커)**')
    expect(sec).toContain('`NO_DOCKER`')
    expect(sec).toContain('dev-discipline.md 「도커 사용 규칙」')
    expect(workerBlocks(DEV)).toHaveLength(8)
  })
  it('worker-prompt: 변수표에 NO_DOCKER, 「10」 이 정본을 가리킨다', () => {
    expect(WORKER).toContain('| `{NO_DOCKER}` | `NO_DOCKER` |')
    const s10 = WORKER.split('## 10. 도커 사용 규칙')[1] ?? ''
    expect(s10).toContain('`.claude/skills/dflow-dev/references/dev-discipline.md` 「도커 사용 규칙」 이다')
    expect(s10).toContain('`orb start`')
    expect(s10).toContain('「9」 로 보고한다')
  })
  it('resolve-prompt: 변수표에 NO_DOCKER(없으면 0), 「도커」 절이 정본을 가리키고 resolution.md 에 기록한다', () => {
    expect(RESOLVE).toContain('| `{NO_DOCKER}` | `NO_DOCKER` |')
    const s = RESOLVE.split('\n## 도커\n')[1] ?? ''
    expect(s).toContain('dev-discipline.md` 「도커 사용 규칙」(정본)')
    expect(s).toContain('`resolution.md` 그 시도 절에 `- 도커 금지로 생략: <명령>`')
    // 빈 NO_DOCKER 는 실패 사유가 아니다(옛 팀장 포인터)
    expect(RESOLVE).toContain('`DEV_BRANCH`·`TASK_DIR`·`ORDER` 중 하나라도 비어 있으면')
    expect(RESOLVE).not.toMatch(/NO_DOCKER[^\n]*failed no-dev-branch/)
  })
  it('Testcontainers 찾기 명령 같은 규칙 세부는 정본에만 있다', () => {
    for (const [n, t] of OTHERS.filter(([n]) => n !== 'dev-discipline'))
      expect(t, n).not.toContain("grep -rliE 'testcontainers'")
  })
})

describe('/dflow-team 인원 기준과 포인터', () => {
  const DEF = '**도커 금지 인원 기준: 인원이 4명 이상이면 팀원의 도커 실행을 금지한다.**'
  it('기준값은 SKILL.md 「인자」 의 한 줄에서만 정한다', () => {
    const args = between(TEAM, '## 인자', '## 팀장 상태')
    expect(count(args, DEF)).toBe(1)
    expect(count(TEAM, DEF)).toBe(1)
    expect(count(TEAM, '4명 이상')).toBe(1)
    for (const [n, t] of OTHERS) {
      expect(t, n).not.toContain('4명 이상')
      expect(t, n).not.toContain('도커 금지 인원 기준: 인원이')
    }
    // 6 으로 자른 뒤의 인원, 압축 뒤 team.start 의 slots 로 복원, 설정 키는 인원과 무관한 스위치
    expect(args).toContain('6 으로 자른 뒤의 인원으로 판정해 `<NO_DOCKER>`')
    expect(args).toContain('압축 뒤에는 `team.start` 의 `slots` 로\n  다시 구한다')
    expect(args).toContain('`no_docker=1` 이며 워커가 스스로 읽는다')
  })
  it('새 작업 포인터와 해소 포인터 끝에 NO_DOCKER 가 실리고, 재개·재시작·해소가 같은 값을 받는다', () => {
    const spawn = between(TEAM, '## 5. 팀원 spawn', '### 5-1. 재개 spawn')
    expect(spawn).toMatch(/TASK_DIR=<작업 폴더> NO_DOCKER=<NO_DOCKER>\n/)
    expect(spawn).toContain('재개(「5-1」)·재시작(restart.md 재투입)은\n     이 형식으로 포인터를 다시 쓰고')
    expect(MC).toMatch(/ON_REPORT=<0\|1> NO_DOCKER=<NO_DOCKER>\n/)
  })
})
