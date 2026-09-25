import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, utimesSync, copyFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOOK = join(process.cwd(), 'kit/hooks/heartbeat.sh')
let tmp: string, repo: string, home: string, log: string

function git(...args: string[]) { execFileSync('git', args, { cwd: repo, stdio: 'ignore' }) }
function run(cwd = repo, env: Record<string, string> = {}, shell = 'sh') {
  execFileSync(shell, [HOOK], {
    cwd, input: JSON.stringify({ cwd, tool_name: 'Bash' }),
    env: { PATH: process.env.PATH ?? '', HOME: home, CURL: join(tmp, 'fakecurl'), NODE_ENV: process.env.NODE_ENV, ...env },
    stdio: ['pipe', 'ignore', 'ignore'],
  })
  // 백그라운드 curl 이 로그를 쓸 시간을 준다
  // 브리프 원안은 0.3 — 이 실행 환경에서는 오차 없이 재현되는 350ms+ 지연이 실측되어(스레드 폴링 타이밍
  // 아님, 여러 차례 독립 측정 동일) 0.3 로는 두 케이스가 확정적으로 깨진다. 0.8 로 올려 여유를 둔다.
  execFileSync('sh', ['-c', 'sleep 0.8'])
}
const sent = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [])
/** stdout 을 받는 실행 — 중단 신호(continue:false JSON)를 확인할 때 쓴다. 전송은 동기라 기다릴 필요가 없다. */
function runOut(env: Record<string, string> = {}, cwd = repo) {
  return execFileSync('sh', [HOOK], {
    cwd, input: JSON.stringify({ cwd, tool_name: 'Bash' }), encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: home, CURL: join(tmp, 'fakecurl'), NODE_ENV: process.env.NODE_ENV, ...env },
    stdio: ['pipe', 'pipe', 'ignore'],
  })
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hb-'))
  repo = join(tmp, 'repo'); home = join(tmp, 'home'); log = join(tmp, 'curl.log')
  mkdirSync(repo); mkdirSync(home)
  // 가짜 curl — 인자를 로그에 남기고, FAKE_HB_CODE 가 있으면 훅의 -w '\n%{http_code}' 꼴(본문, 줄바꿈, 코드)로 답한다.
  // FAKE_HB_FAIL 이면 네트워크 실패처럼 출력 없이 28(타임아웃)로 끝난다.
  writeFileSync(join(tmp, 'fakecurl'), [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> "${log}"`,
    '[ -n "${FAKE_HB_FAIL:-}" ] && exit 28',
    '[ -n "${FAKE_HB_CODE:-}" ] && printf \'%s\\n%s\' "${FAKE_HB_BODY:-}" "$FAKE_HB_CODE"',
    'exit 0', '',
  ].join('\n'), { mode: 0o755 })
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(repo, '.env'), 'DFLOW_API_BASE=https://x.test\nDFLOW_PATS=dfl_u_abc_secret\n')
  mkdirSync(join(repo, 'docs/tasks/TSK-01'), { recursive: true })
  writeFileSync(join(repo, 'docs/tasks/TSK-01/state.json'), JSON.stringify({ tsk: 'TSK-01', order: '22222222-2222-4222-8222-222222222222', phase: 'build' }))
  writeFileSync(join(repo, 'README'), 'x'); git('add', '.'); git('commit', '-q', '-m', 'init')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('heartbeat.sh — 스펙 §4-2', () => {
  it('.dflow-agent 가 있으면 그 값으로 order 의 heartbeat 를 보낸다(phase 는 state.json)', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    run()
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toContain('/api/v1/agent/work/22222222-2222-4222-8222-222222222222/heartbeat')
    expect(sent()[0]).toContain('"agent":"hong/mbp/w2"')
    expect(sent()[0]).toContain('"phase":"build"')
    expect(sent()[0]).toContain('--max-time 1.5')
  })
  it('state.json 에 model 이 있으면 싣고, 없으면 싣지 않는다(0100 — Phase 서브에이전트 모델)', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    run()
    expect(sent()[0]).not.toContain('"model"')
    writeFileSync(join(repo, 'docs/tasks/TSK-01/state.json'), JSON.stringify({ tsk: 'TSK-01', order: '22222222-2222-4222-8222-222222222222', phase: 'verify', model: 'haiku' }))
    rmSync(join(home, '.dflow/hb'), { recursive: true, force: true }) // 60초 절제 우회
    run()
    expect(sent()[1]).toContain('"model":"haiku"')
    expect(sent()[1]).toContain('"phase":"verify"')
  })
  it('.dflow-agent 가 없고 브랜치가 agent/ 로 시작하면 claude-<host> 로 보낸다', () => {
    git('switch', '-q', '-c', 'agent/abcd1234-slug')
    run()
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toMatch(/"agent":"claude-[a-z0-9-]+"/)
  })
  it('.dflow-agent 가 없고 기본 브랜치면 아무것도 보내지 않는다(팀장 세션)', () => {
    run(); expect(sent()).toHaveLength(0)
  })
  it('parked 는 침묵한다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/parked\n')
    run(); expect(sent()).toHaveLength(0)
  })
  it('진행 중 state.json 이 없으면(전부 reported/merged) 보내지 않는다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, 'docs/tasks/TSK-01/state.json'), JSON.stringify({ tsk: 'TSK-01', order: '2'.repeat(8), phase: 'merged' }))
    run(); expect(sent()).toHaveLength(0)
  })
  // 2026-09-24 dmes-standard: Phase 01(claim·기준선) 동안 state.json 이 scaffold 값 ready 라 5분 넘게 신호가 없었다.
  // /dflow-dev 가 claim 뒤 phase=prepare 를 쓰고, 훅은 prepare 만 더 받는다(ready 는 여전히 받지 않는다).
  it('phase=prepare(Phase 01 준비)면 보낸다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, 'docs/tasks/TSK-01/state.json'), JSON.stringify({ tsk: 'TSK-01', order: '22222222-2222-4222-8222-222222222222', phase: 'prepare' }))
    run()
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toContain('/api/v1/agent/work/22222222-2222-4222-8222-222222222222/heartbeat')
    expect(sent()[0]).toContain('"phase":"prepare"')
  })
  it('scaffold 자리표(phase=ready)는 더 최근이어도 고르지 않는다 — prepare 인 주문에만 보낸다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, 'docs/tasks/TSK-01/state.json'), JSON.stringify({ tsk: 'TSK-01', order: '22222222-2222-4222-8222-222222222222', phase: 'prepare' }))
    const old = new Date(Date.now() - 600_000)
    utimesSync(join(repo, 'docs/tasks/TSK-01/state.json'), old, old)
    mkdirSync(join(repo, 'docs/tasks/TSK-02'), { recursive: true })
    writeFileSync(join(repo, 'docs/tasks/TSK-02/state.json'), JSON.stringify({ tsk: 'TSK-02', order: '33333333-3333-4333-8333-333333333333', phase: 'ready' }))
    run()
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toContain('/22222222-2222-4222-8222-222222222222/heartbeat')
    expect(sent().join('\n')).not.toContain('33333333-3333-4333-8333-333333333333')
  })
  it('ready 만 있으면(주문 전 자리표) 보내지 않는다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, 'docs/tasks/TSK-01/state.json'), JSON.stringify({ tsk: 'TSK-01', order: '22222222-2222-4222-8222-222222222222', phase: 'ready' }))
    run(); expect(sent()).toHaveLength(0)
  })
  it('60초 절제: 두 번 연속 실행하면 한 번만 보낸다, 절제 파일이 오래되면 다시 보낸다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    run(); run()
    expect(sent()).toHaveLength(1)
    const stamp = join(home, '.dflow/hb/22222222-2222-4222-8222-222222222222')
    const old = new Date(Date.now() - 120_000)
    utimesSync(stamp, old, old)
    run()
    expect(sent()).toHaveLength(2)
  })
  it('.env 에 API_BASE 나 PAT 가 없으면 보내지 않는다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, '.env'), 'DFLOW_API_BASE=https://x.test\n')
    run(); expect(sent()).toHaveLength(0)
  })
  it('git 리포가 아닌 cwd 에서는 조용히 끝난다', () => {
    const plain = join(tmp, 'plain'); mkdirSync(plain)
    run(plain); expect(sent()).toHaveLength(0)
  })
  // 키 선택(docs/superpowers/specs/2026-09-18-dflow-key-select-design.md §5)
  const TWO = 'DFLOW_PATS=dflow_pat_AAAAAAAAAAAA_s1,dflow_pat_BBBBBBBBBBBB_s2\n'
  it('DFLOW_AS 가 있으면 그 prefix 의 토큰으로 보낸다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, '.env'), `DFLOW_API_BASE=https://x.test\n${TWO}DFLOW_AS=BBBBBBBBBBBB\n`)
    run()
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toContain('Bearer dflow_pat_BBBBBBBBBBBB_s2')
  })
  it('DFLOW_AS 가 어느 토큰과도 안 맞으면 보내지 않는다 — 첫 토큰으로 물러서지 않는다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, '.env'), `DFLOW_API_BASE=https://x.test\n${TWO}DFLOW_AS=ZZZZZZZZZZZZ\n`)
    run(); expect(sent()).toHaveLength(0)
  })
  it('DFLOW_AS 가 없으면 지금처럼 첫 토큰으로 보낸다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, '.env'), `DFLOW_API_BASE=https://x.test\n${TWO}`)
    run()
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toContain('Bearer dflow_pat_AAAAAAAAAAAA_s1')
  })
  it('DFLOW_PAT 단일 토큰에도 DFLOW_AS 를 적용한다 — prefix 가 다르면 보내지 않는다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, '.env'), 'DFLOW_API_BASE=https://x.test\nDFLOW_PAT=dflow_pat_AAAAAAAAAAAA_s1\nDFLOW_AS=BBBBBBBBBBBB\n')
    run(); expect(sent()).toHaveLength(0)
  })
  it('.env 가 CRLF 여도 DFLOW_AS 를 맞춘다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, '.env'), `DFLOW_API_BASE=https://x.test\r\n${TWO.replace('\n', '\r\n')}DFLOW_AS=BBBBBBBBBBBB\r\n`)
    run()
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toContain('Bearer dflow_pat_BBBBBBBBBBBB_s2')
  })
  it.skipIf(!existsSync('/bin/dash'))('dash(POSIX sh) 에서도 DFLOW_PATS 없이 DFLOW_PAT 만 있으면 exit 0 으로 heartbeat 를 보낸다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, '.env'), 'DFLOW_API_BASE=https://x.test\nDFLOW_PAT=dfl_u_abc_secret\n')
    run(repo, {}, '/bin/dash')
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toContain('/api/v1/agent/work/22222222-2222-4222-8222-222222222222/heartbeat')
  })
  const installLib = () => {
    const d = join(repo, '.claude/skills/dflow-work/scripts'); mkdirSync(d, { recursive: true })
    copyFileSync(join(process.cwd(), '.claude/skills/dflow-work/scripts/dflow-config.sh'), join(d, 'dflow-config.sh'))
  }
  it('새 방식: 리포에 dflow-config.sh 가 있으면 .dflow·.dflow.local 로 인증한다(.env 는 읽지 않는다)', () => {
    installLib()
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, '.dflow'), 'api_base=https://new.test\n')
    writeFileSync(join(repo, '.dflow.local'), 'pat=dflow_pat_NNNNNNNNNNNN_s9\ndev_branch=main\n')
    run()
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toContain('https://new.test/api/v1/agent/work/22222222-2222-4222-8222-222222222222/heartbeat')
    expect(sent()[0]).toContain('Bearer dflow_pat_NNNNNNNNNNNN_s9')
  })
  it('새 방식 설정이 깨졌으면(.dflow.local 없음) 보내지 않고 조용히 끝낸다', () => {
    installLib()
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    writeFileSync(join(repo, '.dflow'), 'api_base=https://new.test\n')
    run()                                   // execFileSync 는 exit 0 이 아니면 던진다
    expect(sent()).toHaveLength(0)
  })
})

// 2026-09-19 중단 설계 §3 — 사람이 D'Flow 에서 중단하면 서버가 409 code=cancelled 를 준다. 그때만 세운다(fail-open).
describe('heartbeat.sh — 중단 신호', () => {
  const ORDER = '22222222-2222-4222-8222-222222222222'
  const STATE = () => join(repo, 'docs/tasks/TSK-01/state.json')
  const MARK = () => join(home, `.dflow/hb/${ORDER}.cancelled`)
  const CANCELLED = { FAKE_HB_CODE: '409', FAKE_HB_BODY: '{"error":"작업이 중단되었습니다.","code":"cancelled"}' }
  const phase = () => JSON.parse(readFileSync(STATE(), 'utf8')).phase
  const rearm = () => rmSync(join(home, `.dflow/hb/${ORDER}`), { force: true }) // 60초 절제 우회
  beforeEach(() => { writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n') })

  it('409 cancelled 면 continue:false 로 세우고, 표식 파일을 남기고, state.json 을 phase=cancelled 로 바꾼다', () => {
    const out = runOut(CANCELLED)
    expect(JSON.parse(out)).toEqual({
      continue: false, stopReason: "D'Flow 에서 이 작업이 중단되었습니다(22222222). 더 진행하지 말고 멈추세요.",
    })
    expect(existsSync(MARK())).toBe(true)
    expect(phase()).toBe('cancelled')
    expect(JSON.parse(readFileSync(STATE(), 'utf8')).order).toBe(ORDER) // 다른 필드는 그대로
  })
  it('표식이 있으면 60초 절제와 무관하게 매 호출 다시 세우고, 서버에는 보내지 않는다', () => {
    runOut(CANCELLED)
    expect(sent()).toHaveLength(1)
    // 절제 파일이 방금 찍혔지만(60초 안) 표식 판정이 먼저 돈다 — 서브에이전트 밖 부모 세션도 다음 도구에서 선다.
    const out = runOut()
    expect(JSON.parse(out).continue).toBe(false)
    expect(sent()).toHaveLength(1)
  })
  it('phase 가 이미 cancelled 인 state.json 도 표식 검사 대상이다(진행 중 목록에서는 빠진다)', () => {
    mkdirSync(join(home, '.dflow/hb'), { recursive: true })
    writeFileSync(MARK(), '')
    writeFileSync(STATE(), JSON.stringify({ tsk: 'TSK-01', order: ORDER, phase: 'cancelled' }))
    expect(JSON.parse(runOut()).continue).toBe(false)
    expect(sent()).toHaveLength(0)
  })
  it('표식이 없는 cancelled state.json 은 진행 중이 아니므로 조용히 끝난다', () => {
    writeFileSync(STATE(), JSON.stringify({ tsk: 'TSK-01', order: ORDER, phase: 'cancelled' }))
    expect(runOut(CANCELLED)).toBe('')
    expect(sent()).toHaveLength(0)
  })
  it('표식이 있어도 다른 주문의 것이면 이 작업을 세우지 않는다', () => {
    mkdirSync(join(home, '.dflow/hb'), { recursive: true })
    writeFileSync(join(home, '.dflow/hb/33333333-3333-4333-8333-333333333333.cancelled'), '')
    expect(runOut({ FAKE_HB_CODE: '200', FAKE_HB_BODY: '{"ok":true}' })).toBe('')
    expect(sent()).toHaveLength(1)
  })
  it('그 밖의 결과는 fail-open — 200·다른 409·5xx·네트워크 실패는 무출력, 표식·phase 불변', () => {
    const cases: Record<string, string>[] = [
      { FAKE_HB_CODE: '200', FAKE_HB_BODY: '{"ok":true}' },
      { FAKE_HB_CODE: '409', FAKE_HB_BODY: '{"error":"x","code":"conflict"}' },
      { FAKE_HB_CODE: '409', FAKE_HB_BODY: 'not json' },
      { FAKE_HB_CODE: '500', FAKE_HB_BODY: '{"code":"cancelled"}' },
      { FAKE_HB_FAIL: '1' },
    ]
    for (const env of cases) {
      rearm()
      expect(runOut(env), JSON.stringify(env)).toBe('')
      expect(existsSync(MARK())).toBe(false)
      expect(phase()).toBe('build')
    }
    expect(sent()).toHaveLength(cases.length)
  })
  it.skipIf(!existsSync('/bin/dash'))('dash(POSIX sh) 에서도 409 cancelled 면 세운다', () => {
    const out = execFileSync('/bin/dash', [HOOK], {
      cwd: repo, input: JSON.stringify({ cwd: repo, tool_name: 'Bash' }), encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: home, CURL: join(tmp, 'fakecurl'), NODE_ENV: process.env.NODE_ENV, ...CANCELLED },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    expect(JSON.parse(out).continue).toBe(false)
    expect(phase()).toBe('cancelled')
  })
})

// project_map 리포는 state.json 을 <DOCS_DIR>/tasks 에 둔다(작업 폴더 scaffold 스펙 §3, 최종 리뷰 #1).
// docs/tasks 만 보면 그런 리포에서 훅이 침묵해 좌석표 신호도 중단 정지도 없다.
describe('heartbeat.sh — <DOCS_DIR>/tasks 작업 폴더', () => {
  const MDM = '33333333-3333-4333-8333-333333333333'
  const MSTATE = () => join(repo, 'docs/mdm/tasks/TSK-02/state.json')
  beforeEach(() => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    rmSync(join(repo, 'docs/tasks'), { recursive: true, force: true })   // docs/tasks 가 없는 리포
    mkdirSync(join(repo, 'docs/mdm/tasks/TSK-02'), { recursive: true })
    writeFileSync(MSTATE(), JSON.stringify({ tsk: 'TSK-02', order: MDM, phase: 'build' }))
  })
  for (const shell of ['sh', 'zsh']) {
    it(`docs/mdm/tasks 의 진행 중 state.json 으로 heartbeat 를 보낸다(${shell}, docs/tasks 없음)`, () => {
      run(repo, {}, shell)
      expect(sent()).toHaveLength(1)
      expect(sent()[0]).toContain(`/api/v1/agent/work/${MDM}/heartbeat`)
    })
  }
  it('docs/tasks 와 docs/mdm/tasks 가 둘 다 있으면 최신 진행 중 state.json 을 고른다', () => {
    mkdirSync(join(repo, 'docs/tasks/TSK-01'), { recursive: true })
    const old = join(repo, 'docs/tasks/TSK-01/state.json')
    writeFileSync(old, JSON.stringify({ tsk: 'TSK-01', order: '22222222-2222-4222-8222-222222222222', phase: 'build' }))
    const t = new Date(Date.now() - 600_000); utimesSync(old, t, t)
    run()
    expect(sent()[0]).toContain(`/api/v1/agent/work/${MDM}/heartbeat`)
  })
  it('docs/mdm/tasks 작업도 409 cancelled 면 세우고 phase=cancelled 로 바꾼다', () => {
    const out = runOut({ FAKE_HB_CODE: '409', FAKE_HB_BODY: '{"code":"cancelled"}' })
    expect(JSON.parse(out).continue).toBe(false)
    expect(existsSync(join(home, `.dflow/hb/${MDM}.cancelled`))).toBe(true)
    expect(JSON.parse(readFileSync(MSTATE(), 'utf8')).phase).toBe('cancelled')
  })
})

// 사용자 체크아웃은 docs 아래 폴더를 다른 프로젝트로 심볼릭 링크해 둔다(예 docs/mdm → mdm 프로젝트). glob 처럼 따라간다.
describe('heartbeat.sh — 심볼릭 링크된 <DOCS_DIR>', () => {
  it('docs/mdm 이 리포 밖 디렉터리를 가리키는 링크여도 그 아래 state.json 으로 보낸다', () => {
    const MDM = '44444444-4444-4444-8444-444444444444'
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    rmSync(join(repo, 'docs/tasks'), { recursive: true, force: true })
    const ext = join(tmp, 'mdm-docs'); mkdirSync(join(ext, 'tasks/TSK-09'), { recursive: true })
    writeFileSync(join(ext, 'tasks/TSK-09/state.json'), JSON.stringify({ tsk: 'TSK-09', order: MDM, phase: 'design' }))
    symlinkSync(ext, join(repo, 'docs/mdm'))
    for (const shell of ['sh', 'zsh']) {
      rmSync(join(home, '.dflow/hb'), { recursive: true, force: true })
      run(repo, {}, shell)
      expect(sent().at(-1), shell).toContain(`/api/v1/agent/work/${MDM}/heartbeat`)
    }
  })
})

// 절제 앞당김 — 같은 세션(session_id)이 60초 안에 다시 부르면 작업 폴더(docs) 스캔 없이 끝낸다.
// 중단 표식이 하나라도 있으면 앞당긴 절제를 쓰지 않는다(표식 검사는 매 호출). 주문이 바뀌면(브랜치 전환) 곧바로 보낸다.
describe('heartbeat.sh — 세션 절제(스캔 전)', () => {
  const ORDER = '22222222-2222-4222-8222-222222222222'
  const SID = '9f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f'
  const CANCELLED = { FAKE_HB_CODE: '409', FAKE_HB_BODY: '{"code":"cancelled"}' }
  let findLog: string
  function runS(env: Record<string, string> = {}) {
    return execFileSync('sh', [HOOK], {
      cwd: repo, input: JSON.stringify({ cwd: repo, tool_name: 'Bash', session_id: SID }), encoding: 'utf8',
      env: { PATH: `${join(tmp, 'bin')}:${process.env.PATH ?? ''}`, HOME: home, CURL: join(tmp, 'fakecurl'), NODE_ENV: process.env.NODE_ENV, ...env },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
  }
  const docsScans = () => (existsSync(findLog) ? readFileSync(findLog, 'utf8') : '').split('\n').filter(l => l.includes('/docs'))
  beforeEach(() => {
    // find 를 감싸 호출 인자를 남긴다 — 작업 폴더 스캔은 <top>/docs 를 넘기는 find 다.
    const realFind = execFileSync('sh', ['-c', 'command -v find'], { encoding: 'utf8' }).trim()
    findLog = join(tmp, 'find.log')
    mkdirSync(join(tmp, 'bin'))
    writeFileSync(join(tmp, 'bin/find'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${findLog}"\nexec "${realFind}" "$@"\n`, { mode: 0o755 })
  })

  it('같은 세션이 60초 안에 다시 부르면 작업 폴더를 스캔하지 않고 끝낸다. 절제 파일이 오래되면 다시 보낸다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    runS()
    expect(sent()).toHaveLength(1)
    expect(docsScans().length).toBeGreaterThan(0)          // 첫 호출은 스캔한다
    rmSync(findLog)
    runS()
    expect(sent()).toHaveLength(1)
    expect(docsScans()).toEqual([])                        // 두 번째는 스캔 전에 끝난다
    const old = new Date(Date.now() - 120_000)
    utimesSync(join(home, '.dflow/hb', ORDER), old, old)
    runS()
    expect(sent()).toHaveLength(2)
  })
  it('세션 절제 중에도 중단 표식이 생기면 매 호출 다시 세우고, 서버에는 보내지 않는다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    expect(JSON.parse(runS(CANCELLED)).continue).toBe(false)
    expect(sent()).toHaveLength(1)
    expect(JSON.parse(runS()).continue).toBe(false)
    expect(JSON.parse(runS()).continue).toBe(false)
    expect(sent()).toHaveLength(1)
  })
  it('다른 주문의 낡은 표식만 있어도 스캔은 하되(표식 검사), 이 주문은 절제한다', () => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n')
    mkdirSync(join(home, '.dflow/hb'), { recursive: true })
    writeFileSync(join(home, '.dflow/hb/33333333-3333-4333-8333-333333333333.cancelled'), '')
    expect(runS()).toBe('')
    expect(runS()).toBe('')
    expect(sent()).toHaveLength(1)
  })
  it('수동 세션이 60초 안에 다른 주문으로 옮기면(브랜치 전환) 새 주문으로 곧바로 보낸다', () => {
    git('switch', '-q', '-c', 'agent/22222222-slug')
    runS()
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toContain(`/work/${ORDER}/heartbeat`)
    git('switch', '-q', '-c', 'agent/33333333-slug')
    mkdirSync(join(repo, 'docs/tasks/TSK-02'), { recursive: true })
    writeFileSync(join(repo, 'docs/tasks/TSK-02/state.json'), JSON.stringify({ tsk: 'TSK-02', order: '33333333-3333-4333-8333-333333333333', phase: 'prepare' }))
    runS()
    expect(sent()).toHaveLength(2)
    expect(sent()[1]).toContain('/work/33333333-3333-4333-8333-333333333333/heartbeat')
  })
})

// 사용 토큰(0104) — 훅이 대화 기록을 셸로 합쳐 싣는다. 계산은 백그라운드라 캐시 파일이 생긴 뒤의 다음 전송에 실린다.
describe('heartbeat.sh — 사용 토큰(0104)', () => {
  const ORDER = '22222222-2222-4222-8222-222222222222'
  const SID = '52b91445-2c69-487c-a73c-885a77849c54'
  const line = (id: string, model: string, u: [number, number, number, number], ts = '2026-09-24T01:00:00.000Z', type = 'assistant') =>
    JSON.stringify({ type, timestamp: ts, message: { id, model, usage: { input_tokens: u[0], output_tokens: u[1], cache_creation_input_tokens: u[2], cache_read_input_tokens: u[3] } } })
  let transcript: string
  function runTok(extra: Record<string, unknown> = {}) {
    execFileSync('sh', [HOOK], {
      cwd: repo, input: JSON.stringify({ cwd: repo, tool_name: 'Bash', transcript_path: transcript, session_id: SID, ...extra }),
      env: { PATH: process.env.PATH ?? '', HOME: home, CURL: join(tmp, 'fakecurl'), NODE_ENV: process.env.NODE_ENV },
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    execFileSync('sh', ['-c', 'sleep 0.8'])
  }
  const cache = () => join(home, '.dflow/hb', `${ORDER}.tok.${SID}`)
  const age = () => { const old = new Date(Date.now() - 120_000); utimesSync(join(home, '.dflow/hb', ORDER), old, old) }
  const body = (n: number) => JSON.parse(sent()[n].match(/--data (\{.*\}) https?:/)![1])

  beforeEach(() => {
    writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w1\n')
    const proj = join(tmp, 'proj'); mkdirSync(join(proj, SID, 'subagents'), { recursive: true })
    transcript = join(proj, `${SID}.jsonl`)
    writeFileSync(transcript, [
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      // 같은 id 가 스트리밍으로 두 줄 — 마지막 줄(output 266)만 센다
      line('m1', 'claude-opus-4-8', [2, 16, 100, 1000]),
      line('m1', 'claude-opus-4-8', [2, 266, 100, 1000]),
      line('m2', 'claude-opus-4-8', [3, 10, 0, 2000]),
      line('s1', '<synthetic>', [0, 0, 0, 0]),
    ].join('\n') + '\n' + '{"type":"assistant","message":{"id":"partial"')   // 쓰는 중인 끝 줄 — 줄바꿈 없음
    writeFileSync(join(proj, SID, 'subagents', 'agent-a1.jsonl'), line('h1', 'claude-haiku-4-5', [4, 120, 0, 900]) + '\n')
  })

  it('첫 전송은 토큰 없이 보내고 백그라운드가 캐시를 만든다. 다음 전송에 모델별 누적이 실린다', () => {
    runTok()
    expect(sent()).toHaveLength(1)
    expect(body(0).tokens).toBeUndefined()
    expect(existsSync(cache())).toBe(true)
    age(); runTok()
    const t = body(1).tokens
    expect(t.session).toBe(SID)
    const by = Object.fromEntries(t.models.map((m: { model: string }) => [m.model, m]))
    expect(Object.keys(by).sort()).toEqual(['claude-haiku-4-5', 'claude-opus-4-8'])
    expect(by['claude-opus-4-8']).toMatchObject({ input: 5, output: 276, cache_creation: 100, cache_read: 3000 })
    expect(by['claude-haiku-4-5']).toMatchObject({ input: 4, output: 120, cache_creation: 0, cache_read: 900 })
  })

  it('수동 세션(.dflow-agent 없음)은 이 주문을 처음 본 뒤의 줄만 센다', () => {
    rmSync(join(repo, '.dflow-agent'))
    git('switch', '-q', '-c', 'agent/22222222-slug')
    // 처음 본 시각(지금) 이전 줄(2020년)은 세지 않고, 이후 줄(2999년 — 지금보다 뒤)만 센다
    writeFileSync(transcript, [
      line('old', 'claude-opus-4-8', [9, 9, 9, 9], '2020-01-01T00:00:00.000Z'),
      line('new', 'claude-opus-4-8', [1, 2, 3, 4], '2999-01-01T00:00:00.000Z'),
    ].join('\n') + '\n')
    rmSync(join(tmp, 'proj', SID, 'subagents'), { recursive: true })
    runTok()
    expect(readFileSync(`${cache()}.since`, 'utf8').trim()).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
    age(); runTok()
    const t = body(1).tokens
    expect(t.models).toEqual([{ model: 'claude-opus-4-8', input: 1, output: 2, cache_creation: 3, cache_read: 4 }])
  })

  it('transcript_path·session_id 가 없거나 이상하면 토큰 없이 평소대로 보낸다', () => {
    runTok({ session_id: '../../etc' })
    expect(sent()).toHaveLength(1)
    expect(body(0).tokens).toBeUndefined()
    expect(existsSync(join(home, '.dflow/hb', `${ORDER}.tok...`))).toBe(false)
  })

  // 증분 계산 — 지난번에 읽은 바이트 위치(<캐시>.idx)와 id 별 usage(<캐시>.map)를 두고 새로 붙은 부분만 읽는다.
  const readCache = () => JSON.parse(readFileSync(cache(), 'utf8'))
  const byModel = (c: { models: { model: string }[] }) => Object.fromEntries(c.models.map(m => [m.model, m]))
  const dropState = () => { rmSync(`${cache()}.idx`, { force: true }); rmSync(`${cache()}.map`, { force: true }) }

  it('증분 계산 결과가 처음부터 다시 읽은 결과와 같다(경계에 걸친 id·끝 줄 완성·새 서브에이전트)', () => {
    runTok()
    expect(existsSync(`${cache()}.idx`)).toBe(true)
    expect(byModel(readCache())['claude-opus-4-8']).toMatchObject({ input: 5, output: 276 })
    // 쓰는 중이던 끝 줄을 마저 쓰고, 지난번에 센 m2 의 뒤 줄(더 큰 output)과 새 m3 을 붙인다
    writeFileSync(transcript, readFileSync(transcript, 'utf8')
      + ',"model":"claude-opus-4-8","usage":{"input_tokens":7,"output_tokens":8,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}},"type":"assistant","timestamp":"2026-09-24T01:00:00.000Z"}\n'
      + line('m2', 'claude-opus-4-8', [3, 50, 0, 2000]) + '\n'
      + line('m3', 'claude-opus-4-8', [1, 1, 1, 1]) + '\n')
    writeFileSync(join(tmp, 'proj', SID, 'subagents', 'agent-a2.jsonl'), line('n1', 'claude-sonnet-4-6', [5, 6, 7, 8]) + '\n')
    age(); runTok()
    const inc = readCache()
    const by = byModel(inc)
    expect(by['claude-opus-4-8']).toMatchObject({ input: 13, output: 325, cache_creation: 101, cache_read: 3001 })
    expect(by['claude-haiku-4-5']).toMatchObject({ input: 4, output: 120, cache_creation: 0, cache_read: 900 })
    expect(by['claude-sonnet-4-6']).toMatchObject({ input: 5, output: 6, cache_creation: 7, cache_read: 8 })
    dropState(); age(); runTok()
    expect(readCache()).toEqual(inc)
  })

  it('이미 읽은 부분은 다시 읽지 않는다(크기가 같으면 새로 읽을 것이 없다)', () => {
    runTok()
    const before = readCache()
    // 지문 영역(앞 256바이트) 밖의 m2 줄 숫자를 같은 길이로 바꾼다 — 증분이면 보이지 않는다
    const src = readFileSync(transcript, 'utf8')
    const at = src.indexOf('"id":"m2"')
    expect(at).toBeGreaterThan(256)
    writeFileSync(transcript, src.replace('"input_tokens":3,', '"input_tokens":9,'))
    age(); runTok()
    expect(readCache()).toEqual(before)
  })

  it('대화 기록이 줄었으면(compact 등) 처음부터 다시 센다', () => {
    runTok()
    writeFileSync(transcript, line('z1', 'claude-opus-4-8', [1, 1, 1, 1]) + '\n')
    age(); runTok()
    const by = byModel(readCache())
    expect(by['claude-opus-4-8']).toMatchObject({ input: 1, output: 1, cache_creation: 1, cache_read: 1 })
    expect(by['claude-haiku-4-5']).toMatchObject({ input: 4, output: 120 })
  })

  it('대화 기록이 다른 파일로 바뀌었으면(앞머리 지문이 다르면) 크기가 커도 처음부터 다시 센다', () => {
    runTok()
    const pad = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(2000) } })
    writeFileSync(transcript, [pad, line('z1', 'claude-opus-4-8', [2, 2, 2, 2])].join('\n') + '\n')
    age(); runTok()
    expect(byModel(readCache())['claude-opus-4-8']).toMatchObject({ input: 2, output: 2, cache_creation: 2, cache_read: 2 })
  })

  it('서브에이전트 기록이 사라졌으면 처음부터 다시 센다', () => {
    runTok()
    rmSync(join(tmp, 'proj', SID, 'subagents', 'agent-a1.jsonl'))
    age(); runTok()
    expect(byModel(readCache())['claude-haiku-4-5']).toBeUndefined()
  })

  it('캐시가 깨져 있으면 싣지 않는다(전송은 그대로)', () => {
    mkdirSync(join(home, '.dflow/hb'), { recursive: true })
    writeFileSync(cache(), '{not json')
    runTok()
    expect(sent()).toHaveLength(1)
    expect(body(0).tokens).toBeUndefined()
  })
})
