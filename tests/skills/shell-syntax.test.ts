import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const DFLOW = join(root, '.claude/skills/dflow-work/scripts/dflow.mjs')
const POLL = join(root, '.claude/skills/dflow-poll/scripts/poll.mjs')
const HOOK = join(root, 'kit/hooks/heartbeat.sh')

describe('스크립트 문법 — 자동 회귀 가드가 없던 파일들', () => {
  // dflow·poll 은 node 판(node --check). heartbeat 훅은 사용자 PC 에 복사되는 sh 스크립트라 sh -n 을 유지한다.
  for (const f of [DFLOW, POLL]) {
    it(`${f.replace(root, '')} 는 node --check 를 통과한다`, () => {
      expect(() => execFileSync(process.execPath, ['--check', f])).not.toThrow()
    })
  }
  it(`${HOOK.replace(root, '')} 는 POSIX sh 로 파싱된다`, () => {
    expect(() => execFileSync('sh', ['-n', HOOK])).not.toThrow()
  })
})

describe('dflow.mjs heartbeat · watch 계약(좌석표 v1 스펙 §4-1)', () => {
  const src = readFileSync(DFLOW, 'utf8')
  it('usage 에 두 서브커맨드가 있다', () => {
    expect(src).toMatch(/heartbeat <ref> \[--phase p\] \[--note q\] \[--agent id\]/)
    // --json 은 응답 본문을 그대로 낸다. 좌석표의 「이어서 시작」 요청(resume_requests)이 실려 오는 길이다.
    expect(src).toMatch(/watch \[--agent id\] \[--slots n\] \[--busy n\] \[--until HH:MM\] \[--project id\] \[--holder h\] \[--require-tag t\] \[--wp W\] \[--json\] \[--stop\]/)
    expect(src).toContain("'--json'")
  })
  it('디스패치에 두 case 가 있고 heartbeat 는 ref 를 요구한다', () => {
    expect(src).toContain("case 'heartbeat': await cmdHeartbeat(args); break;")
    expect(src).toContain("case 'watch': await cmdWatch(args); break;")
    expect(src).toMatch(/async function cmdHeartbeat\(argv\) \{\n  const ref = argv\[0\];\n  if \(ref === undefined\) usage\(\);/)
  })
  it('git 은 DFLOW_GIT 로 주입 가능한 형태로만 부른다(팀장 스킬 후속 커밋과 충돌 방지)', () => {
    // node 판은 git 을 gitOk() 한 곳에서만 부르고, 그 안에서 DFLOW_GIT 을 따른다.
    // 좌석표 신호 구간(heartbeat·watch)만 본다.
    const fn = src.slice(src.indexOf('async function cmdHeartbeat('), src.indexOf('async function cmdDone('))
    expect(fn.length).toBeGreaterThan(0)
    expect(fn).not.toContain("spawnSync('git'")
    expect(src).toContain("process.env.DFLOW_GIT || 'git'")
  })
  it('watch 의 신원 조회 실패(/me)는 exit 3 으로 끝낸다', () => {
    // node 판에는 서브셸이 없어 sh 판의 「부모 셸 종료」 문제가 없다 — watcherIdDefault 가 직접 die(3) 한다.
    expect(src).toContain("if (!email) die(3, '신원 확인 실패(/me)');")
  })
  it('agent_id_default 는 .dflow-agent 첫 줄의 CRLF 를 제거한다(kit/hooks/heartbeat.sh 와 같은 관례)', () => {
    const fn = src.slice(src.indexOf('function agentIdDefault()'), src.indexOf('async function watcherIdDefault()'))
    expect(fn).toContain("replace(/\\r/g, '')")
  })
  it('SKILL.md 가 두 서브커맨드를 설명한다', () => {
    const skill = readFileSync(join(root, '.claude/skills/dflow-work/SKILL.md'), 'utf8')
    expect(skill).toContain('### heartbeat')
    expect(skill).toContain('### watch')
    expect(skill).toContain('DFLOW_WATCH=0')
  })
})
