// tests/skills/dflow-timeout-guard.test.ts
// timeout-guard.sh — 긴 명령을 timeout 없이(또는 백그라운드로) 부르지 못하게 막는 PreToolUse(Bash) 가드 훅.
// 설계 docs/superpowers/specs/2026-09-26-dflow-perf-audit-kit-design.md 「① 백그라운드 정지 방지」.
// 스크립트에 훅 JSON 을 넣어 exit 코드를 보고(2 = 거부), backends.md 「팀원 워크트리 준비」 블록이 만든 설정 파일의
// 훅 명령을 그대로 돌려 연결까지 확인한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const GUARD = join(ROOT, '.claude/skills/dflow-dev/scripts/timeout-guard.sh')
const B = () => readFileSync(join(ROOT, '.claude/skills/dflow-team/references/backends.md'), 'utf8')

type Input = { command: string; timeout?: number; run_in_background?: boolean }
const hookJson = (i: Input, tool = 'Bash') => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: i })
function guard(i: Input, env: Record<string, string> = {}) {
  const r = spawnSync('/bin/sh', [GUARD], { input: hookJson(i), encoding: 'utf8', env: { ...process.env, ...env } })
  return { code: r.status, err: r.stderr }
}

describe('timeout-guard.sh 판정', () => {
  it('실행 비트가 있다(훅 명령이 -x 로 확인한다)', () => {
    expect(statSync(GUARD).mode & 0o111).not.toBe(0)
  })

  it.each([
    // 인자 자리 — 명령이 아니다
    'sed -n 1,40p .claude/skills/dflow-dev/scripts/heavy.sh',
    'grep -n acquire .claude/skills/dflow-dev/scripts/heavy.sh',
    'cat ../x/heavy.sh',
    'ls ./gradlew; chmod +x gradlew',
    'echo "a; ./gradlew test"',
    // 제외 하위 명령
    '.claude/skills/dflow-dev/scripts/heavy.sh status',
    'heavy.sh --pool docker status',
    'heavy.sh snapshot 2>&1 | head',
    'heavy.sh release',
    'bash .claude/skills/dflow-dev/scripts/heavy.sh status',
    'baseline.sh key x',
    'npx playwright install chromium',
    // heredoc 본문(커밋 메시지)은 명령이 아니다
    "git commit -F - <<'EOF'\n./gradlew test 를 고친다\nEOF",
    "git commit -m \"$(cat <<'EOF'\n./gradlew test 를 고친다\nEOF\n)\"",
  ])('허용: %s', (command) => {
    expect(guard({ command }).code).toBe(0)
  })

  it.each([
    ['heavy.sh ./gradlew test', 300000],
    ['cd api && ../gradlew test', 600000],
    ['.claude/skills/dflow-dev/scripts/heavy.sh wait j-1', 300000],
  ] as const)('허용(timeout 충분): %s timeout=%d', (command, timeout) => {
    expect(guard({ command, timeout }).code).toBe(0)
  })

  it.each([
    "./gradlew :api:bootRun --no-daemon --args='--server.port=18080'",
    "cd api && ./gradlew bootRun --args='--server.port=18081' > /tmp/api.log 2>&1",
    "nohup ./gradlew :api:bootRun --no-daemon --args='--server.port=18080' > /tmp/api.log 2>&1",
    'nohup java -jar build/libs/api.war --server.port=18080 > /tmp/api.log 2>&1',
    'java -jar build/libs/api.war --server.port=18080',
    'next dev --port 3001',
    'pnpm dev',
    'npm run dev',
  ])('허용(E2E 서버 기동을 백그라운드로): %s', (command) => {
    expect(guard({ command, run_in_background: true }).code).toBe(0)
  })

  it('허용: 포그라운드라도 & 로 띄우는 서버 기동(e2e.md 형태, nohup 을 붙여도 같다)', () => {
    expect(guard({ command: "./gradlew :api:bootRun --no-daemon --args='--server.port=18080' > /tmp/l 2>&1 &" }).code).toBe(0)
    expect(guard({ command: "nohup ./gradlew :api:bootRun --no-daemon --args='--server.port=18080' > /tmp/l 2>&1 &" }).code).toBe(0)
  })

  it.each([
    '( cd apps/api && ./gradlew bootRun ) &',
    '(cd x && ./gradlew bootRun) &',
    '{ ./gradlew bootRun > log 2>&1; } &',
  ])('허용: 괄호·중괄호로 묶어 백그라운드로 띄우는 서버 기동: %s', (command) => {
    expect(guard({ command }).code).toBe(0)
  })

  it('거부: 서버 기동이 아닌 명령을 괄호로 묶어 백그라운드로 띄워도 막힌다', () => {
    const r = guard({ command: '( ./gradlew test ) &' })
    expect(r.code).toBe(2)
    expect(r.err).toContain('timeout 을 300000~600000 으로 주고 다시 호출하라')
  })

  it('거부: nohup 은 예외가 아니다 — 뒤가 서버 기동 형태가 아니면 백그라운드·& 로 불러도 막힌다', () => {
    const bg = guard({ command: 'nohup ./gradlew test > /tmp/x.log 2>&1', timeout: 600000, run_in_background: true })
    expect(bg.code).toBe(2)
    expect(bg.err).toContain('run_in_background')
    expect(guard({ command: 'nohup ./gradlew test > /tmp/x.log 2>&1 &' }).code).toBe(2)
    expect(guard({ command: 'nohup heavy.sh ./gradlew test', run_in_background: true }).code).toBe(2)
  })

  it.each([
    'heavy.sh ./gradlew test',
    '.claude/skills/dflow-dev/scripts/heavy.sh acquire e2e-TSK-01',
    'heavy.sh --detach ./gradlew test',
    'heavy.sh --exclusive ./gradlew perfTest',
    'heavy.sh wait j-1',
    '.claude/skills/dflow-dev/scripts/baseline.sh run -- ./gradlew test',
    '.claude/skills/dflow-dev/scripts/deps.sh',
    './gradlew test',
    '../gradlew test',
    'cd api && ../gradlew test',
    'DFLOW_HEAVY_WAIT=90 ./gradlew test',
    'FOO=1 BAR=2 mvn -q verify',
    './mvnw verify',
    'npx playwright test',
    'pnpm exec playwright test',
    'pnpm --filter web exec playwright test',
    'yarn playwright test',
    'if true; then ./gradlew test; fi',
    'for m in a b; do ./gradlew :$m:test; done',
    "bash -lc './gradlew test'",
    'X=$(./gradlew -q properties)',
    'nohup ./gradlew test', // & 없는 nohup 은 그대로 막힌다
    "./gradlew :api:bootRun --no-daemon", // & 없는 포그라운드 서버 기동
  ])('거부(timeout 없음): %s', (command) => {
    const r = guard({ command })
    expect(r.code).toBe(2)
    expect(r.err).toContain('timeout 을 300000~600000 으로 주고 다시 호출하라')
    expect(r.err).toContain('heavy.sh --detach')
    expect(r.err).toContain('heavy.sh wait <id>')
  })

  it('거부: timeout 120000(기본값)과 299999', () => {
    expect(guard({ command: './gradlew test', timeout: 120000 }).code).toBe(2)
    expect(guard({ command: './gradlew test', timeout: 299999 }).code).toBe(2)
    expect(guard({ command: './gradlew test', timeout: 120000 }).err).toContain('지금 timeout 120000')
  })

  it.each([
    './gradlew test',
    'heavy.sh ./gradlew test',
    'npx playwright test',
    './gradlew bootWar && java -jar build/libs/api.war', // bootWar 빌드는 서버 기동이 아니다(설계 ④)
  ])('거부(대상을 run_in_background 로): %s', (command) => {
    const r = guard({ command, timeout: 600000, run_in_background: true })
    expect(r.code).toBe(2)
    expect(r.err).toContain('run_in_background')
  })

  it('거부 이유는 우회 형태(nohup 등)를 안내하지 않는다', () => {
    expect(guard({ command: './gradlew test' }).err).not.toContain('nohup')
    expect(guard({ command: './gradlew test', run_in_background: true }).err).not.toContain('nohup')
    // nohup 을 거친 일반 명령에 run_in_background 를 안내하면 그대로 백그라운드 테스트가 되어 원래 문제로 돌아간다
    expect(guard({ command: 'nohup ./gradlew test' }).err).not.toContain('run_in_background')
    // 서버 기동(bootRun)만 안내한다
    expect(guard({ command: './gradlew :api:bootRun --no-daemon' }).err).toContain('run_in_background: true')
  })

  it('Bash 가 아닌 도구·깨진 입력·빈 명령은 통과한다', () => {
    const run = (input: string) => spawnSync('/bin/sh', [GUARD], { input, encoding: 'utf8' }).status
    expect(run(hookJson({ command: './gradlew test' }, 'Read'))).toBe(0)
    expect(run('not json')).toBe(0)
    expect(run(hookJson({ command: '' }))).toBe(0)
  })

  it('jq 가 없으면 그대로 통과한다(fail-open)', () => {
    // /bin 이 /usr/bin 과 같은 곳(Ubuntu·Git Bash)이 있으므로 sh·cat 만 링크한 임시 폴더를 PATH 로 쓴다.
    const bin = mkdtempSync(join(tmpdir(), 'tg-bin-'))
    try {
      for (const t of ['sh', 'cat']) {
        const w = spawnSync('/bin/sh', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim()
        symlinkSync(w, join(bin, t))
      }
      const r = spawnSync('/bin/sh', [GUARD], { input: hookJson({ command: './gradlew test' }), encoding: 'utf8', env: { PATH: bin } })
      expect(r.status).toBe(0)
    } finally { rmSync(bin, { recursive: true, force: true }) }
  })
})

describe('팀원 전용 설정의 훅 등록(backends.md 「팀원 워크트리 준비」)', () => {
  let tmp: string, home: string
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'tg-')); home = join(tmp, 'home'); mkdirSync(home) })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  // dflow-team-restart-statusline.test.ts 와 같은 방법으로 블록을 잘라 돌린다.
  function settings() {
    const m = B().match(/(if \[ "\$\{DFLOW_WORKER_PLUGINS-\}" = keep \][\s\S]*?> "\$LIM\/<id8>\.settings\.json")/)
    if (!m) throw new Error('팀원 전용 설정 블록을 찾지 못했다')
    const r = spawnSync('sh', ['-c', m[1].replaceAll('<id8>', 'abcd1234')], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: home } })
    expect(r.status, r.stderr).toBe(0)
    return JSON.parse(readFileSync(join(home, '.dflow/limits/abcd1234.settings.json'), 'utf8'))
  }

  it('설정 파일에 PreToolUse(matcher Bash, type command, timeout 5) 훅이 있고 가드형 명령이다', () => {
    const s = settings()
    expect(s.statusLine.type).toBe('command') // 기존 statusLine 은 그대로
    const pre = s.hooks.PreToolUse
    expect(pre).toHaveLength(1)
    expect(pre[0].matcher).toBe('Bash')
    expect(pre[0].hooks).toHaveLength(1)
    const h = pre[0].hooks[0]
    expect(h.type).toBe('command')
    expect(h.timeout).toBe(5)
    expect(h.command).toBe(
      'if [ -x "${CLAUDE_PROJECT_DIR-}/.claude/skills/dflow-dev/scripts/timeout-guard.sh" ]; then /bin/sh "${CLAUDE_PROJECT_DIR-}/.claude/skills/dflow-dev/scripts/timeout-guard.sh"; else cat >/dev/null 2>&1 || :; fi',
    )
  })

  it('훅 명령은 프로젝트에 스크립트가 있으면 거부(exit 2)를 그대로 전하고, 없으면 stdin 을 비우고 통과한다', () => {
    const cmd = settings().hooks.PreToolUse[0].hooks[0].command
    const input = hookJson({ command: './gradlew test' })
    const withScript = spawnSync('sh', ['-c', cmd], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT } })
    expect(withScript.status).toBe(2)
    expect(withScript.stderr).toContain('timeout-guard:')
    const empty = join(tmp, 'proj'); mkdirSync(empty)
    const without = spawnSync('sh', ['-c', cmd], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: empty } })
    expect(without.status).toBe(0)
    expect(without.stderr).toBe('')
  })

  it('backends.md 가 전역 설정에 훅을 넣지 않는다고 적는다', () => {
    expect(B()).toContain('**timeout 가드 훅**')
    expect(B()).toContain('전역 `~/.claude/settings.json` 에는\n  넣지 않는다')
  })
})
