// tests/skills/dflow-lead-lease.test.ts
// 팀장 lease CLI(docs/superpowers/specs/2026-09-23-dflow-lead-lease-design.md §6). dflow.sh 를 가짜 curl 로 실제 실행한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const DFLOW = join(ROOT, '.claude/skills/dflow-work/scripts/dflow.sh')
const TOKEN = `dflow_pat_AAAAAAAAAAAA_${'x'.repeat(24)}` // 가짜. 실제 키가 아니다
const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'

// FAKE_MODE 로 응답을 바꾼다: ok(기본) | held | lost | down
const FAKE_CURL = `#!/bin/sh
out=''; data=''
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    --data) data="$2"; shift ;;
    -w|-X|-H) shift ;;
  esac
  shift
done
[ "\${FAKE_MODE:-ok}" = down ] && exit 7
printf '%s\\n' "$data" >> "$FAKE_LOG"
op=$(printf '%s' "$data" | jq -r '.op // empty')
code=200
case "$op" in
  acquire)
    if [ "\${FAKE_MODE:-ok}" = held ]; then code=409
      body='{"error":"x","code":"lead_lease_held","held":[{"project_id":"${P1}","host":"other","agent":"hong/other/lead","expires_at":"2026-09-23T00:02:00Z"}]}'
    else body=$(printf '%s' "$data" | jq -c '{ok:true, leases:[.projects[] | {project_id:., generation:7, expires_at:"2026-09-23T00:03:00Z"}]}'); fi ;;
  renew)
    if [ "\${FAKE_MODE:-ok}" = lost ]; then body='{"ok":true,"expires_at":null,"lost":["${P1}"]}'
    else body='{"ok":true,"expires_at":"2026-09-23T00:03:00Z","lost":[]}'; fi ;;
  release) body='{"ok":true,"released":1}' ;;
  *) body='{"ok":true,"user_email":"hong@example.com","expires_at":"2026-09-23T01:00:00Z","resume_requests":[]}' ;;
esac
printf '%s' "$body" > "$out"; printf '%s' "$code"
`

let tmp: string, repo: string, log: string
const envFor = (env: Record<string, string>) => ({
  NODE_ENV: process.env.NODE_ENV,
  PATH: `${join(tmp, 'bin')}:${process.env.PATH ?? ''}`, HOME: join(tmp, 'home'),
  XDG_CACHE_HOME: join(tmp, 'cache'), FAKE_LOG: log,
  DFLOW_ENV_FILE: join(tmp, 'no-such-env'), DFLOW_CONFIG_DIR: join(tmp, 'no-config'),
  DFLOW_API_BASE: 'https://x.test', DFLOW_PATS: TOKEN, DFLOW_PROJECT_MAP: `a=${P1},b=${P2}`,
  DFLOW_LEASE_INTERVAL: '1', DFLOW_LEASE_STEP: '1', ...env,
})
function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('sh', [DFLOW, ...args], { cwd: repo, encoding: 'utf8', env: envFor(env) })
}
const sent = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
const stateFile = () => join(repo, '.git', 'dflow-team.lease')

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dflow-lease-'))
  repo = join(tmp, 'repo'); log = join(tmp, 'curl.log')
  mkdirSync(join(tmp, 'bin')); mkdirSync(join(tmp, 'home')); mkdirSync(repo)
  writeFileSync(join(tmp, 'bin/curl'), FAKE_CURL, { mode: 0o755 })
  writeFileSync(log, '')
  spawnSync('git', ['init', '-q'], { cwd: repo })
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('lease holder', () => {
  it('machine-id 를 만들고(600) <uuid>:<cksum> 를 찍는다. 두 번째 호출도 같은 값', () => {
    const a = run(['lease', 'holder']); const b = run(['lease', 'holder'])
    expect(a.status).toBe(0)
    expect(a.stdout.trim()).toMatch(/^[0-9a-f-]{36}:[0-9]{1,12}$/)
    expect(b.stdout).toBe(a.stdout)
    const f = join(tmp, 'home/.dflow/machine-id')
    expect(statSync(f).mode & 0o777).toBe(0o600)
  })
})

describe('lease acquire', () => {
  it('바인딩 프로젝트 전부를 한 번에 요청하고 상태 파일을 쓴다', () => {
    const r = run(['lease', 'acquire'])
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('LEASE_OK 2')
    const body = sent().find(b => b.op === 'acquire')
    expect(body.projects.sort()).toEqual([P1, P2].sort())
    expect(body.takeover).toBe(false)
    expect(body.agent).toMatch(/^hong\/[a-z0-9-]+\/lead$/)
    expect(readFileSync(stateFile(), 'utf8').trim().split('\n').sort()).toEqual([`${P1} 7`, `${P2} 7`].sort())
    expect(statSync(stateFile()).mode & 0o777).toBe(0o600)
  })
  it('--takeover 는 takeover:true 로 보낸다', () => {
    run(['lease', 'acquire', '--takeover'])
    expect(sent().find(b => b.op === 'acquire').takeover).toBe(true)
  })
  it('막히면 exit 4 와 LEAD_LEASE_HELD 줄, 상태 파일은 없다', () => {
    const r = run(['lease', 'acquire'], { FAKE_MODE: 'held' })
    expect(r.status).toBe(4)
    expect(r.stdout.trim()).toBe(`LEAD_LEASE_HELD ${P1} other hong/other/lead 2026-09-23T00:02:00Z`)
    expect(existsSync(stateFile())).toBe(false)
  })
  it('바인딩이 없으면 exit 2', () => {
    const r = run(['lease', 'acquire'], { DFLOW_PROJECT_MAP: '' })
    expect(r.status).toBe(2)
  })
})

describe('lease renew·release', () => {
  it('renew — 상태 파일의 generation 으로 보내고 LEASE_OK', () => {
    run(['lease', 'acquire'])
    const r = run(['lease', 'renew'])
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('LEASE_OK')
    expect(sent().find(b => b.op === 'renew').leases).toEqual(expect.arrayContaining([{ project_id: P1, generation: 7 }]))
  })
  it('renew — lost 면 exit 4 + LEASE_LOST', () => {
    run(['lease', 'acquire'])
    const r = run(['lease', 'renew'], { FAKE_MODE: 'lost' })
    expect(r.status).toBe(4)
    expect(r.stdout.trim()).toBe(`LEASE_LOST ${P1}`)
  })
  it('renew — 상태 파일이 없으면 exit 2 + LEASE_NONE', () => {
    const r = run(['lease', 'renew'])
    expect(r.status).toBe(2)
    expect(r.stdout.trim()).toBe('LEASE_NONE')
  })
  it('release — 보내고 상태 파일을 지운다. 두 번째는 LEASE_NONE', () => {
    run(['lease', 'acquire'])
    expect(run(['lease', 'release']).stdout.trim()).toBe('LEASE_RELEASED 1')
    expect(existsSync(stateFile())).toBe(false)
    const again = run(['lease', 'release'])
    expect(again.status).toBe(0)
    expect(again.stdout.trim()).toBe('LEASE_NONE')
  })
})

// 무거운 작업 표시(docs/superpowers/specs/2026-09-26-heavy-work-office-bubble-design.md §2-3). heavy.sh 는 실물을 쓰고
// 슬롯 폴더는 HOME(임시)의 ~/.dflow/locks/heavy 다.
describe('lease renew — 무거운 작업(heavy)', () => {
  const heavyDir = () => join(tmp, 'home/.dflow/locks/heavy')
  const slot = (name: string, o: Record<string, string | number>) => {
    mkdirSync(join(heavyDir(), name), { recursive: true })
    writeFileSync(join(heavyDir(), name, 'owner'),
      Object.entries({ pstart: '-', host: 'h', kind: 'run', ...o }).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
  }
  const renewBody = () => sent().filter(b => b.op === 'renew').at(-1)
  const WT = () => join(tmp, 'repo/.claude/worktrees/dflow-abcdef12')

  it('팀원 워크트리의 슬롯을 id8 로 싣고, 명령의 워크트리·홈 경로와 비밀 값은 가린다', () => {
    run(['lease', 'acquire'])
    const home = join(tmp, 'home')
    slot('slot-1', { pid: process.pid, start: 1790000000, cwd: `${WT()}/sub`,
      cmd: `${WT()}/gradlew test --init ${home}/x.gradle MY_TOKEN=abc` })
    const r = run(['lease', 'renew'])
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('LEASE_OK')
    const hv = renewBody().heavy
    expect(hv.pc).toEqual(expect.objectContaining({ held: 1, waiting: 0 }))
    expect(typeof hv.pc.k).toBe('number')
    expect(hv.orders).toEqual([{ id8: 'abcdef12', state: 'run', kind: 'run', pool: 'general', since: 1790000000, pos: null, n: 1,
      cmd: './gradlew test --init ~/x.gradle MY_TOKEN=***' }])
    expect(JSON.stringify(renewBody())).not.toContain(tmp)
  })

  it('팀원 워크트리가 아닌 슬롯(다른 리포·사람 세션)은 주문에 싣지 않고 PC 요약에만 든다', () => {
    run(['lease', 'acquire'])
    slot('slot-1', { pid: process.pid, start: 1, cwd: '/elsewhere/proj', cmd: 'npm test' })
    run(['lease', 'renew'])
    expect(renewBody().heavy.orders).toEqual([])
    expect(renewBody().heavy.pc.held).toBe(1)
  })

  it('같은 워크트리에 둘이면(병렬 묶음·E2E 서버) 실행을 대기보다, 먼저 시작한 것을 앞세우고 n 에 건수', () => {
    run(['lease', 'acquire'])
    const now = Math.floor(Date.now() / 1000)
    slot('slot-1', { pid: process.pid, start: now - 10, cwd: WT(), cmd: 'npm run build' })
    slot('slot-2', { pid: process.pid, start: now - 100, kind: 'hold', cwd: `${WT()}-resolve`, cmd: 'hold e2e' })
    writeFileSync(join(heavyDir(), `wait-${process.pid}`), `pid=${process.pid}\npool=general\nstart=${now}\npstart=-\ncwd=${WT()}\ncmd=npm test\n`)
    run(['lease', 'renew'])
    const o = renewBody().heavy.orders
    expect(o).toHaveLength(1)
    expect(o[0]).toEqual(expect.objectContaining({ id8: 'abcdef12', state: 'run', kind: 'hold', since: now - 100, n: 3 }))
  })

  it('대기만 있으면 state=wait 와 PC 전체 일반 풀 대기 순번(pos)', () => {
    run(['lease', 'acquire'])
    const w = (pid: number, start: number, cwd: string) =>
      writeFileSync(join(heavyDir(), `wait-${pid}`), `pid=${pid}\npool=general\nstart=${start}\npstart=-\ncwd=${cwd}\ncmd=npm test\n`)
    mkdirSync(heavyDir(), { recursive: true })
    w(process.pid, 200, WT())
    w(process.ppid, 100, '/elsewhere')
    run(['lease', 'renew'])
    expect(renewBody().heavy.orders).toEqual([expect.objectContaining({ id8: 'abcdef12', state: 'wait', pos: 2, n: 1 })])
    expect(renewBody().heavy.pc.waiting).toBe(2)
  })

  it('heavy.sh 가 없거나 깨져도 renew 는 LEASE_OK — heavy 만 빠진다(lease 를 잃지 않는다)', () => {
    run(['lease', 'acquire'])
    const gone = run(['lease', 'renew'], { DFLOW_HEAVY_SH: join(tmp, 'no-such-heavy.sh') })
    expect(gone.stdout.trim()).toBe('LEASE_OK')
    expect(renewBody().heavy).toBeUndefined()
    const bad = join(tmp, 'bad-heavy.sh')
    writeFileSync(bad, '#!/bin/sh\necho "PC\tnot\tjson{"\nexit 3\n', { mode: 0o755 })
    const broken = run(['lease', 'renew'], { DFLOW_HEAVY_SH: bad })
    expect(broken.status).toBe(0)
    expect(broken.stdout.trim()).toBe('LEASE_OK')
    expect(renewBody().heavy).toBeUndefined()
    const garbage = join(tmp, 'garbage-heavy.sh')
    writeFileSync(garbage, '#!/bin/sh\nprintf "%s" "{{{"\n', { mode: 0o755 })
    expect(run(['lease', 'renew'], { DFLOW_HEAVY_SH: garbage }).stdout.trim()).toBe('LEASE_OK')
  })
})

describe('lease keep', () => {
  it('팀장 PID 가 없으면 release 하고 0 으로 끝난다', () => {
    run(['lease', 'acquire'])
    const r = run(['lease', 'keep', '--pid', '999999', '--lost-file', join(tmp, 'lost')])
    expect(r.status).toBe(0)
    expect(sent().some(b => b.op === 'release')).toBe(true)
    expect(existsSync(stateFile())).toBe(false)
  })
  it('상태 파일이 없어지면 0 으로 끝난다(정상 마감의 release 뒤)', () => {
    const r = run(['lease', 'keep', '--pid', String(process.pid), '--lost-file', join(tmp, 'lost')])
    expect(r.status).toBe(0)
    expect(existsSync(join(tmp, 'lost'))).toBe(false)
  })
  it('lost 면 표식 파일에 LEASE_LOST 를 쓰고 4', () => {
    run(['lease', 'acquire'])
    const r = run(['lease', 'keep', '--pid', String(process.pid), '--lost-file', join(tmp, 'lost')], { FAKE_MODE: 'lost' })
    expect(r.status).toBe(4)
    expect(readFileSync(join(tmp, 'lost'), 'utf8').trim()).toBe(`LEASE_LOST ${P1}`)
  })
  it('네트워크가 3회 연속 실패하면 LEASE_UNREACHABLE 을 쓰고 6', () => {
    run(['lease', 'acquire'])
    const r = run(['lease', 'keep', '--pid', String(process.pid), '--lost-file', join(tmp, 'lost')], { FAKE_MODE: 'down' })
    expect(r.status).toBe(6)
    expect(readFileSync(join(tmp, 'lost'), 'utf8')).toMatch(/^LEASE_UNREACHABLE rc=6/)
  })
  it('SIGTERM 을 받으면 release 하고 끝난다(세션 종료가 백그라운드 태스크를 거둘 때)', async () => {
    run(['lease', 'acquire'])
    const child = spawn('sh', [DFLOW, 'lease', 'keep', '--pid', String(process.pid), '--lost-file', join(tmp, 'lost')], {
      cwd: repo, env: envFor({}),
    })
    await new Promise(r => setTimeout(r, 1500))   // 첫 갱신까지
    child.kill('SIGTERM')
    const code = await new Promise<number | null>(r => child.on('exit', c => r(c)))
    expect(code).toBe(0)
    expect(sent().some(b => b.op === 'release')).toBe(true)
    expect(existsSync(stateFile())).toBe(false)
  })
  it('성공한 갱신마다 beat 파일을 쓴다', () => {
    run(['lease', 'acquire'])
    // 한 번 갱신한 뒤 PID 를 죽은 것으로 보이게: 존재하지 않는 PID 는 첫 검사에서 바로 끝나므로, 여기서는 renew 를 직접 부른다.
    run(['lease', 'renew'])
    expect(Number(readFileSync(`${stateFile()}.beat`, 'utf8'))).toBeGreaterThan(0)
  })

  // Windows(Git Bash/MSYS): CLAUDE_PID 는 네이티브 Windows PID 라 MSYS 의 kill -0 이 못 알아본다.
  // uname -s 를 MINGW/MSYS/CYGWIN 으로 흉내 내고, ps -W 의 WINPID 열로 한 번 더 찾는지 검사한다.
  const FAKE_UNAME = `#!/bin/sh\nprintf 'MINGW64_NT-10.0\\n'\n`
  const FAKE_PS_WITH_WINPID = `#!/bin/sh
cat <<'EOF'
      PID    PPID    PGID   WINPID   TTY        UID    STIME COMMAND
    12345   67890   12345   424242  ?        1000  10:00:00 /usr/bin/bash
EOF
`
  it('Windows 흉내: kill -0 실패해도 ps -W 의 WINPID 로 살아있으면 먼저 반납하지 않고 renew 로 간다', () => {
    run(['lease', 'acquire'])
    writeFileSync(join(tmp, 'bin/uname'), FAKE_UNAME, { mode: 0o755 })
    writeFileSync(join(tmp, 'bin/ps'), FAKE_PS_WITH_WINPID, { mode: 0o755 })
    const r = run(['lease', 'keep', '--pid', '424242', '--lost-file', join(tmp, 'lost')], { FAKE_MODE: 'lost' })
    expect(r.status).toBe(4)
    expect(readFileSync(join(tmp, 'lost'), 'utf8').trim()).toBe(`LEASE_LOST ${P1}`)
    expect(sent().some(b => b.op === 'release')).toBe(false)
  })
  it('Windows 흉내: ps -W 목록에 없는 PID 는 죽은 것으로 보고 즉시 반납한다', () => {
    run(['lease', 'acquire'])
    writeFileSync(join(tmp, 'bin/uname'), FAKE_UNAME, { mode: 0o755 })
    writeFileSync(join(tmp, 'bin/ps'), FAKE_PS_WITH_WINPID, { mode: 0o755 })
    const r = run(['lease', 'keep', '--pid', '999999', '--lost-file', join(tmp, 'lost')])
    expect(r.status).toBe(0)
    expect(sent().some(b => b.op === 'release')).toBe(true)
    expect(existsSync(stateFile())).toBe(false)
  })
})

describe('watch --holder', () => {
  it('본문에 holder 를 싣는다', () => {
    const h = run(['lease', 'holder']).stdout.trim()
    run(['watch', '--agent', 'hong/mbp/lead', '--holder', h, '--json'])
    expect(sent().find(b => b.agent === 'hong/mbp/lead').holder).toBe(h)
  })
})
