// 도커 사용 규칙 계약(2026-09-24 dmes-standard 사고: 팀원 6명이 Testcontainers(MSSQL)를 동시에 돌려 RAM 16GB 장비가
// 스왑 17GB·load 52, 한 팀원은 orb start 로 OrbStack 을 스스로 켰다). 같은 날 오전의 인원 기준(4명 이상 금지)은 3명 이하에서
// 워커마다 같은 목적(DB 방언 검증)의 컨테이너를 막지 못해 원칙을 바꿨다: 같은 목적으로 각자 도커를 띄우지 않는다. 꼭 필요한
// 것은 한 곳에 모은다. 워커는 기본 금지, docker 태그 Task 만 허용(포인터 DOCKER=allow), 방언 검증은 머지 뒤 스윕이 한 번
// (dflow-dialect-check.test.ts), 도커 명령은 PC 전역 도커 슬롯(dflow-heavy-semaphore.test.ts). 정본은 dev-discipline.md
// 「도커 사용 규칙」 하나이고, 다른 문서는 가리키기만 한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripWorkerBlocks, workerBlocks } from './_preserve'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const DISC = read('.claude/skills/dflow-dev/references/dev-discipline.md')
const DEV = read('.claude/skills/dflow-dev/SKILL.md')
const TEAM = read('.claude/skills/dflow-team/SKILL.md')
const WORKER = read('.claude/skills/dflow-team/references/worker-prompt.md')
const RESOLVE = read('.claude/skills/dflow-team/references/resolve-prompt.md')
const MC = read('.claude/skills/dflow-team/references/merge-conflict.md')
const HELP = read('.claude/skills/dflow-team/references/help.md')
const OTHERS: [string, string][] = [
  ['dev-discipline', DISC], ['dflow-dev SKILL', DEV], ['worker-prompt', WORKER], ['resolve-prompt', RESOLVE], ['merge-conflict', MC],
  ['backends', read('.claude/skills/dflow-team/references/backends.md')],
  ['restart', read('.claude/skills/dflow-team/references/restart.md')],
  ['help', HELP],
]
const between = (t: string, a: string, b: string) => t.split(a)[1]?.split(b)[0] ?? ''
const count = (t: string, s: string) => t.split(s).length - 1
const RULE = between(DISC, '## 도커 사용 규칙', '## Phase 정의')

describe('dev-discipline 「도커 사용 규칙」(정본)', () => {
  it('서버 프로세스 절 바로 뒤, Phase 정의 앞에 새 절로 있다', () => {
    const iServer = DISC.indexOf('### 서버 프로세스 (정본')
    const iRule = DISC.indexOf('## 도커 사용 규칙 (정본')
    const iDesign = DISC.indexOf('## Phase 정의')
    expect(iServer).toBeGreaterThan(0)
    expect(iRule).toBeGreaterThan(iServer)
    expect(iDesign).toBeGreaterThan(iRule)
    expect(count(DISC, '## 도커 사용 규칙')).toBe(1)
  })
  it('원칙: 같은 목적으로 각자 도커를 띄우지 않고, 꼭 필요한 것은 한 곳에 모은다', () => {
    expect(RULE).toContain('**같은 목적으로 각자 도커를 띄우지 않는다. 꼭 필요한\n것은 한 곳에 모아 쓴다.**')
  })
  it('도커 런타임 기동 금지는 금지 모드·태그·설정과 무관하고 팀장의 방언 검증에도 적용되며, 꺼져 있으면 보고해 팀장 판단을 받는다', () => {
    expect(RULE).toContain('### 도커 런타임을 켜지 않는다 (언제나)')
    expect(RULE).toContain('금지 모드·태그·설정과 **무관하게**')
    expect(RULE).toContain('팀장의 방언\n검증은 꺼져 있는 도커 런타임을 기동하지 않는다')
    for (const c of ['`orb start`', '`open -a Docker`', '`open -a OrbStack`', '`colima start`'])
      expect(RULE, c).toContain(c)
    expect(RULE).toContain('「9. 이슈 보고」')
    expect(RULE).toContain('팀장 판단을 받는다')
  })
  it('워커는 인원과 무관하게 기본 금지, docker 태그만 허용, 방언 검증은 머지 뒤 스윕, 도커 명령은 도커 슬롯, 재사용은 대상 리포를 따른다', () => {
    const who = between(RULE, '### 누가 어디서 도커를 쓰나', '### 금지 모드 판정')
    expect(who).toContain('**워커는 기본적으로 도커를 쓰지 않는다(인원과 무관).**')
    expect(who).toContain('팀원 수 기준은 없어졌다')
    expect(who).toContain('`/dflow-merge` 「방언 검증」')
    expect(who).toContain('`dialect_check`')
    expect(who).toContain('tags 에 `docker` 가 있는 Task')
    expect(who).toContain('`DOCKER=allow`')
    expect(who).toContain('`heavy.sh --pool docker`')
    expect(who).toContain('**도커 명령은 대상 리포가 제공하는 컨테이너 재사용 방식을 따른다**')
  })
  it('금지 모드: DOCKER=allow 가 없으면 워커 기본 금지(옛 NO_DOCKER=0 은 허용이 아니다), 설정 no_docker=1 은 태그도 막는 강제 스위치', () => {
    const judge = between(RULE, '### 금지 모드 판정', '### 금지 모드가 아닐 때')
    expect(judge).toContain('팀장 포인터에 `DOCKER=allow` 가 **없다**')
    expect(judge).toContain('옛 팀장의 `NO_DOCKER=0` 은 허용이 아니다')
    expect(judge).toContain('.claude/skills/dflow-work/scripts/dflow.sh config no_docker')
    expect(judge).toContain('`.dflow.local` 의 `no_docker`(이 PC, `.dflow` 를 덮는다)')
    expect(judge).toContain('`docker` 태그로 허용된 워커와 수동 `/dflow-dev` 도 막는다')
    expect(judge).toContain('`0`·빈 값은 아무것도 풀지 않는다')
    expect(judge).toContain('**판정 결과를 기준선 기록에 한 줄 남긴다.**')
    for (const v of ['"off"', '"banned:spawn"', '"banned:config"', '"banned:spawn+config"']) expect(judge, v).toContain(v)
    expect(judge).toContain('기준선을 다시\n  잰다')
    expect(judge).toContain('「도커 허용 태그」')
    expect(RULE).not.toContain('도커 금지 인원 기준')
  })
  it('금지 모드가 아니면 도커 명령을 heavy.sh --pool docker 로, 기준선은 baseline.sh --pool docker 로 잰다', () => {
    const slot = between(RULE, '### 금지 모드가 아닐 때: 도커 슬롯', '### 금지 모드에서 돌리지 않는 것')
    expect(slot).toContain('`.claude/skills/dflow-dev/scripts/heavy.sh --pool docker <명령>`')
    expect(slot).toContain("`baseline.sh run … --pool docker -- '<명령>'`")
    expect(slot).toContain('바깥에서 `baseline.sh` 를 `heavy.sh --pool docker` 로\n  감싸지 않는다')
    expect(slot).toContain('`HEAVY_DOCKER_BUSY`(exit 75)')
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
    expect(RULE).toContain('`- 금지 모드 출처: <워커 기본(DOCKER=allow 아님) | 설정 no_docker=1 | 둘 다>`')
    expect(RULE).toContain('완료 보고(`done` 요약)에 `도커 금지로 생략: <명령>; …`')
    expect(RULE).toContain('**생략 때문에 수용 기준을 확인할 수 없게 되면 조용히 통과시키지 않는다.**')
    expect(RULE).toContain('`확인하지 못함(도커 금지로 생략: <명령>)`')
    expect(RULE).toContain('확인하지 못한 수용 기준 N건')
    // 방언 검증 스크립트가 세는 문구 — 바꾸지 않는다
    expect(RULE).toContain('`dialect-check.sh`')
    expect(read('.claude/skills/dflow-merge/scripts/dialect-check.sh')).toContain("grep -c '도커 금지로 생략:'")
    expect(read('.claude/skills/dflow-merge/scripts/dialect-check.sh')).toContain("grep -c '확인하지 못한 수용 기준:'")
  })
  it('Phase 02~05 공통 프롬프트에 넣을 문구가 정본에 있고, 금지 모드가 아니면 도커 슬롯·재사용을 말한다', () => {
    expect(RULE).toContain('"도커 금지 모드다. docker·Testcontainers')
    expect(RULE).toContain('정본: dev-discipline.md 「도커 사용')
    expect(RULE).toContain('`heavy.sh --pool docker` 로 감싸고, 대상 리포의 컨테이너 재사용 방식을 따른다')
  })
  it('「무거운 명령 줄 세우기」 에 도커 슬롯과 교착 불변식이 있다', () => {
    const heavy = DISC.slice(DISC.indexOf('## 무거운 명령 줄 세우기'), DISC.indexOf('## 포그라운드 실행'))
    expect(heavy).toContain('**도커 슬롯**')
    expect(heavy).toContain('**교착 불변식: 도커 슬롯을 쥔 쪽은 아무것도 기다리지 않는다.**')
    expect(heavy).toContain('`HEAVY_DOCKER_BUSY`')
  })
})

describe('참조 문서는 정본을 가리키기만 한다', () => {
  it('dflow-dev SKILL.md: 수동 본문(게이트 집행 원칙)과 --worker 절에 한 줄씩, 표지 블록 수는 그대로', () => {
    const manual = stripWorkerBlocks(DEV)
    const gate = between(manual, '## 게이트 집행 원칙', '## 상태 모델')
    expect(gate).toContain('dev-discipline.md 「도커 사용 규칙」')
    expect(gate).toContain('`heavy.sh --pool docker`')
    expect(manual).not.toContain('NO_DOCKER') // 포인터 값은 워커 경로에만 있다
    expect(manual).not.toContain('DOCKER=allow')
    // --worker 절 본문은 references/worker-mode.md 로 옮겼다
    const sec = read('.claude/skills/dflow-dev/references/worker-mode.md')
    expect(sec).toContain('**도커 금지 모드(워커)**')
    expect(sec).toContain('`DOCKER` 값')
    expect(sec).toContain('`allow` 일 때만')
    expect(sec).toContain('dev-discipline.md 「도커 사용 규칙」')
    expect(workerBlocks(DEV)).toHaveLength(8)
  })
  it('worker-prompt: 변수표에 DOCKER(없으면 금지), 「10」 이 정본을 가리킨다', () => {
    expect(WORKER).toContain('| `{DOCKER}` | `DOCKER` |')
    expect(WORKER).toContain('키가 없거나 다른 값이면 도커 금지 모드다')
    expect(WORKER).not.toContain('| `{NO_DOCKER}` |')
    const s10 = WORKER.split('## 10. 도커 사용 규칙')[1] ?? ''
    expect(s10).toContain('`.claude/skills/dflow-dev/references/dev-discipline.md` 「도커 사용 규칙」 이다')
    expect(s10).toContain('워커는 도커를 쓰지 않는 것이 기본이다(인원과 무관)')
    expect(s10).toContain('`heavy.sh --pool docker`')
    expect(s10).toContain('`orb start`')
    expect(s10).toContain('「9」 로 보고한다')
  })
  it('resolve-prompt: 변수표에 DOCKER(없으면 금지), 「도커」 절이 정본을 가리키고 resolution.md 에 기록한다', () => {
    expect(RESOLVE).toContain('| `{DOCKER}` | `DOCKER` |')
    expect(RESOLVE).not.toContain('{NO_DOCKER}')
    const s = RESOLVE.split('\n## 도커\n')[1] ?? ''
    expect(s).toContain('dev-discipline.md` 「도커 사용 규칙」(정본)')
    expect(s).toContain('`resolution.md` 그 시도 절에 `- 도커 금지로 생략: <명령>`')
    // 빈 DOCKER 는 실패 사유가 아니다(금지로 볼 뿐)
    expect(RESOLVE).toContain('`DEV_BRANCH`·`TASK_DIR`·`ORDER` 중 하나라도 비어 있으면')
    expect(RESOLVE).not.toMatch(/DOCKER[^\n]*failed no-dev-branch/)
  })
  it('Testcontainers 찾기 명령 같은 규칙 세부는 정본에만 있다', () => {
    for (const [n, t] of OTHERS.filter(([n]) => n !== 'dev-discipline'))
      expect(t, n).not.toContain("grep -rliE 'testcontainers'")
  })
})

describe('/dflow-team 도커 허용 태그와 포인터', () => {
  const DEF = '**도커 허용 태그: 팀원은 도커를 쓰지 않는 것이 기본이고(인원과 무관), D\'Flow 작업의 tags 에 `docker` 가 있는 Task 의\n  팀원에게만 허용한다.**'
  it('판정은 SKILL.md 「인자」 의 한 줄에서만 정하고, 인원 기준은 어디에도 남지 않는다', () => {
    const args = between(TEAM, '## 인자', '## 팀장 상태')
    expect(count(args, DEF)).toBe(1)
    expect(count(TEAM, DEF)).toBe(1)
    expect(TEAM).not.toContain('도커 금지 인원 기준')
    expect(TEAM).not.toContain('NO_DOCKER=<NO_DOCKER>')
    for (const [n, t] of OTHERS) {
      expect(t, n).not.toContain('도커 금지 인원 기준')
      expect(t, n).not.toContain('NO_DOCKER=<NO_DOCKER>')
    }
    expect(args).toContain('`.claude/skills/dflow-team/scripts/docker-allow.sh <id8>`')
    expect(args).toContain('조회에 실패하면\n  `ban` 이다')
    expect(args).toContain('옛 포인터(`.dflow-prompt`)의 값을 옮겨 쓰지 않는다')
    expect(args).toContain('`no_docker=1` 은 태그가 있어도 막는 강제 스위치')
    expect(args).toContain('도커 명령은 대상 리포가 제공하는 컨테이너 재사용 방식을 따른다')
  })
  it('새 작업·재개 포인터와 해소 포인터 끝에 DOCKER 가 실리고, 매번 docker-allow.sh 로 다시 구한다', () => {
    const spawn = between(TEAM, '## 5. 팀원 spawn', '### 5-1. 재개 spawn')
    expect(spawn).toMatch(/TASK_DIR=<작업 폴더> DOCKER=<allow\|ban>\n/)
    expect(spawn).toContain('.claude/skills/dflow-team/scripts/docker-allow.sh "$order"')
    expect(spawn).toContain('재개(「5-1」)·재시작(restart.md\n     재투입)은 이 형식으로 포인터를 다시 쓰며 그때도 `docker-allow.sh` 로 다시 구하고')
    const resume = between(TEAM, '### 5-1. 재개 spawn', '### 5-2. 해소 spawn')
    expect(resume).toContain(".claude/skills/dflow-team/scripts/docker-allow.sh '<id8>'")
    expect(resume).toContain('`DOCKER` 는 4항 블록의 `docker-allow.sh` 출력이다')
    expect(MC).toMatch(/ON_REPORT=<0\|1> DOCKER=<allow\|ban>\n/)
    const mcSpawn = between(MC, '## 2. 해소 spawn', '5. `team.spawn` 을 기록한다')
    expect(mcSpawn).toMatch(/```bash\n[\s\S]*\.claude\/skills\/dflow-team\/scripts\/docker-allow\.sh '<id8>'[\s\S]*?```/)
  })
  it('help 는 태그·방언 검증·강제 금지를 안내한다', () => {
    expect(HELP).toContain('`docker` 태그')
    expect(HELP).toContain('`dialect_check=<명령>`')
    expect(HELP).toContain('`no_docker=1`')
  })
})

// docker-allow.sh: 서버 tags 로 포인터 값을 정한다. 조회 실패는 금지(fail-closed).
describe('docker-allow.sh — 태그로 허용', () => {
  const SCRIPT = join(process.cwd(), '.claude/skills/dflow-team/scripts/docker-allow.sh')
  let tmp: string
  beforeEach(() => { tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-docker-allow-'))) })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })
  const json = (tags: unknown) => JSON.stringify({ order: { id: 'o-1', status: 'ready', item: { external_ref: 'TSK-01', tags } } })
  const viaStdin = (input: string) => spawnSync('bash', [SCRIPT, '--json'], { input, encoding: 'utf8' })
  function viaShow(body: string, rc = 0) {
    const stub = join(tmp, 'dflow.sh')
    writeFileSync(join(tmp, 'body.json'), body)
    writeFileSync(stub, `#!/bin/sh\n[ "$1" = show ] && [ "$2" = abcd1234 ] || exit 9\ncat '${join(tmp, 'body.json')}'\nexit ${rc}\n`, { mode: 0o755 })
    return spawnSync('bash', [SCRIPT, 'abcd1234'], { encoding: 'utf8', env: { ...process.env, DFLOW_SH: stub } })
  }

  it('bash 로 파싱되고 실행 권한이 있다', () => {
    expect(spawnSync('bash', ['-n', SCRIPT]).status).toBe(0)
    expect(spawnSync('test', ['-x', SCRIPT]).status).toBe(0)
  })
  it('tags 에 docker(대소문자 무시)가 있으면 allow, 없으면 ban', () => {
    expect(viaStdin(json(['agent', 'docker'])).stdout).toBe('DOCKER=allow tag=docker\n')
    expect(viaStdin(json(['agent', 'Docker'])).stdout).toBe('DOCKER=allow tag=docker\n')
    expect(viaStdin(json(['agent'])).stdout).toBe('DOCKER=ban tag=none\n')
    expect(viaStdin(json(null)).stdout).toBe('DOCKER=ban tag=none\n')
    expect(viaStdin(json(['agent', 'dockerfile'])).stdout).toBe('DOCKER=ban tag=none\n')
  })
  it('dflow.sh show 로 서버 tags 를 읽는다', () => {
    const r = viaShow(json(['agent', 'docker']))
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('DOCKER=allow tag=docker\n')
    expect(viaShow(json(['agent'])).stdout).toBe('DOCKER=ban tag=none\n')
  })
  it('조회 실패·빈 응답·주문 없는 응답은 금지다(모르면 금지)', () => {
    for (const r of [viaShow(json(['docker']), 7), viaShow(''), viaShow('{"error":"x"}'), viaStdin('not json')]) {
      expect(r.status).toBe(0)
      expect(r.stdout).toBe('DOCKER=ban show-failed\n')
    }
  })
})
