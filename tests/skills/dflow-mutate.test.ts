// tests/skills/dflow-mutate.test.ts
// mutate.sh — 변이 기록 파일(*.mut: 파일 경로·찾을 원문·치환문·대상 테스트)대로 변이를 넣고 테스트를 돌린 뒤 백업 사본으로
// 되돌리는 드라이버. Verify 가 변이 위치를 찾느라 소스를 다시 읽지 않게 한다(2026-09-26 TSK-08-05 Verify 약 23분).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const MUTATE = join(ROOT, '.claude/skills/dflow-dev/scripts/mutate.sh')
const REF = (f: string) => readFileSync(join(ROOT, '.claude/skills/dflow-dev/references', f), 'utf8')
const flat = (s: string) => s.replace(/\s+/g, ' ')

let repo: string
const SRC = 'def f(x):\n    return x + 1\n'
const git = (...a: string[]) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' })
function mut(id: string, body: string) {
  mkdirSync(join(repo, 'muts'), { recursive: true })
  writeFileSync(join(repo, 'muts', `${id}.mut`), body)
}
function run(args: string[]) {
  const r = spawnSync('sh', [MUTATE, ...args], { cwd: repo, encoding: 'utf8', timeout: 30000 })
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' }
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-mutate-')))
  git('init', '-q')
  mkdirSync(join(repo, 'src'))
  writeFileSync(join(repo, 'src/a.py'), SRC)
  git('add', '.')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'i')
})
afterEach(() => rmSync(repo, { recursive: true, force: true }))

describe('mutate.sh', { timeout: 30000 }, () => {
  it('잡힘·안 잡힘·원문 없음을 가르고, 파일을 원래대로 되돌리며 요약 줄을 낸다', () => {
    mut('M1', "rule: 1 을 더한다\nfile: src/a.py\ntest: grep -q 'x + 1' src/a.py\n--- find\n    return x + 1\n--- replace\n    return x + 2\n")
    mut('M2', 'rule: 안 잡힘\nfile: src/a.py\ntest: true\n--- find\ndef f(x):\n--- replace\ndef f(x):  # m\n')
    mut('M3', 'rule: 원문 없음\nfile: src/a.py\ntest: true\n--- find\nnothing\n--- replace\nx\n')
    const r = run(['run', 'muts'])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^MUTATION_RESULT M1 caught rc=1 sec=\d+ e2e=no log=\S+M1\.log$/m)
    expect(r.out).toMatch(/^MUTATION_RESULT M2 survived rc=0 /m)
    expect(r.out).toContain('MUTATION_RESULT M3 anchor count=0 file=src/a.py')
    expect(r.out.trim().split('\n').pop()).toBe('MUTATION_SUMMARY total=3 caught=1 survived=1 anchor=1 busy=0')
    expect(readFileSync(join(repo, 'src/a.py'), 'utf8')).toBe(SRC)
    expect(git('status', '--porcelain', 'src').stdout).toBe('')
  })

  it('--ids 로 고른 변이만 돌리고, 없는 ID 는 형식 오류(exit 2)', () => {
    mut('M1', 'rule: r\nfile: src/a.py\ntest: false\n--- find\n    return x + 1\n--- replace\n    return 0\n')
    mut('M2', 'rule: r\nfile: src/a.py\ntest: false\n--- find\ndef f(x):\n--- replace\ndef g(x):\n')
    const r = run(['run', 'muts', '--ids', 'M2'])
    expect(r.out).not.toContain('M1')
    expect(r.out).toContain('MUTATION_SUMMARY total=1 caught=1')
    const bad = run(['run', 'muts', '--ids', 'M9'])
    expect(bad.code).toBe(2)
    expect(bad.err).toContain('MUTATION_BAD M9')
  })

  it('원문이 두 번 나오면 넣지 않는다(anchor count=2)', () => {
    writeFileSync(join(repo, 'src/a.py'), SRC + SRC)
    mut('M1', 'rule: r\nfile: src/a.py\ntest: false\n--- find\n    return x + 1\n--- replace\n    return 0\n')
    expect(run(['run', 'muts']).out).toContain('MUTATION_RESULT M1 anchor count=2')
    expect(readFileSync(join(repo, 'src/a.py'), 'utf8')).toBe(SRC + SRC)
  })

  it('되돌린 파일은 mtime 이 새로 찍힌다(Gradle 이 재컴파일을 건너뛰지 않게)', async () => {
    const before = statSync(join(repo, 'src/a.py')).mtimeMs
    await new Promise((r) => setTimeout(r, 1100))
    mut('M1', 'rule: r\nfile: src/a.py\ntest: true\n--- find\n    return x + 1\n--- replace\n    return 0\n')
    run(['run', 'muts'])
    expect(readFileSync(join(repo, 'src/a.py'), 'utf8')).toBe(SRC)
    expect(statSync(join(repo, 'src/a.py')).mtimeMs).toBeGreaterThan(before)
  })

  it('중단(TERM)돼도 되돌리고, 남은 사본은 다음 실행이 먼저 되돌리며 MUTATION_RERUN_NEEDED 를 낸다', async () => {
    mut('M1', 'rule: r\nfile: src/a.py\ntest: sleep 20\n--- find\n    return x + 1\n--- replace\n    return 0\n')
    const p = spawn('sh', [MUTATE, 'run', 'muts'], { cwd: repo, stdio: 'ignore' })
    const t0 = Date.now()
    while (!readFileSync(join(repo, 'src/a.py'), 'utf8').includes('return 0')) {
      if (Date.now() - t0 > 10000) throw new Error('변이가 들어가지 않음')
      await new Promise((r) => setTimeout(r, 50))
    }
    p.kill('SIGTERM')
    await new Promise((r) => p.on('close', r))
    expect(readFileSync(join(repo, 'src/a.py'), 'utf8')).toBe(SRC)
    // 사본이 남은 상황(예: kill -9)을 흉내 낸다
    const bak = join(repo, '.git/dflow-bak/mutate/src')
    mkdirSync(bak, { recursive: true })
    writeFileSync(join(bak, 'a.py'), SRC)
    writeFileSync(join(repo, 'src/a.py'), 'mutated\n')
    mut('M1', 'rule: r\nfile: src/a.py\ntest: true\n--- find\n    return x + 1\n--- replace\n    return 0\n')
    const r = run(['run', 'muts'])
    expect(r.out).toContain('MUTATION_RESTORED src/a.py')
    expect(r.out).toContain('MUTATION_RERUN_NEEDED')
    expect(readFileSync(join(repo, 'src/a.py'), 'utf8')).toBe(SRC)
    expect(existsSync(join(bak, 'a.py'))).toBe(false)
  })

  it('형식 오류: 표지·필드가 없으면 exit 2, 리포 최상위가 아니면 exit 2', () => {
    mut('M1', 'rule: r\nfile: src/a.py\n--- find\nx\n--- replace\ny\n')
    const r = run(['run', 'muts'])
    expect(r.code).toBe(2)
    expect(r.err).toContain('test: 없음')
    const sub = spawnSync('sh', [MUTATE, 'run', '../muts'], { cwd: join(repo, 'src'), encoding: 'utf8' })
    expect(sub.status).toBe(2)
    expect(sub.stderr).toContain('리포 최상위에서 부른다')
  })
})

describe('변이 기록을 패치 형태로 남기고 Verify 는 드라이버로 다시 넣는다(문서 계약)', () => {
  it('phase-build: 변이마다 {TASK_DIR}/mutations/<ID>.mut 을 커밋하고 표의 변이 칸은 ID 로 시작한다', () => {
    const b = flat(REF('phase-build.md'))
    expect(b).toContain('`<TASKS>/<TSK>/mutations/<ID>.mut`')
    expect(b).toContain('`scripts/mutate.sh run`')
    expect(b).toContain('변이 칸은 ID 로 시작한다')
  })
  it('phase-verify: 기록 파일을 드라이버에 넣고 위치를 찾으려 소스를 다시 읽지 않는다, E2E 변이는 1행까지', () => {
    const v = flat(REF('phase-verify.md'))
    expect(v).toContain('`heavy.sh mutate.sh run <TASKS>/<TSK>/mutations --ids <고른 ID>`')
    expect(v).toContain('변이 위치를 찾으려고 소스를 다시 읽거나 조사 에이전트를 띄우지 않는다')
    expect(v).toContain('E2E 변이 행(`e2e: yes`)은 다시 넣는 행 전체에서 1행까지다')
  })
})
