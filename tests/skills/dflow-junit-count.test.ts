// tests/skills/dflow-junit-count.test.ts
// junit-count.sh(.claude/skills/dflow-dev/scripts/junit-count.sh) — 콘솔에 총수가 안 나오는 러너(Gradle·Maven)의
// JUnit XML 결과를 합산한다. 한 워커가 gradle testAll 의 json tests 가 null 인 채 막혀 build/test-results 를 perl 로
// 즉석 합산해 3220 을 구한 사고(2026-09-26)를 스크립트로 고정한다. 가짜 Gradle 다중 모듈·Maven 결과를 임시 폴더에
// 만들어 합계·폴더 범위·제외 폴더·failed-file·XML 없음·깨진 XML 을 실제 sh 로 검증한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const SCRIPT = join(ROOT, '.claude/skills/dflow-dev/scripts/junit-count.sh')

function run(cwd: string, args: string[]) {
  const r = spawnSync('sh', [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 30_000 })
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' }
}

let tmp: string
let repo: string
const put = (rel: string, body: string) => {
  mkdirSync(join(repo, rel, '..'), { recursive: true })
  writeFileSync(join(repo, rel), body)
}

const suite = (opts: { name: string; tests: number; failures?: number; errors?: number; skipped?: number; cases: string }) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<testsuite name="${opts.name}" tests="${opts.tests}" failures="${opts.failures ?? 0}" errors="${opts.errors ?? 0}" skipped="${opts.skipped ?? 0}">\n` +
  opts.cases +
  `</testsuite>\n`

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-junit-count-')))
  repo = join(tmp, 'repo')
  mkdirSync(repo)
})
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

describe('junit-count.sh — 기본', () => {
  it('실행 비트가 있다', () => {
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0)
  })
  it('sh -n 으로 문법 검사를 통과한다', () => {
    const r = spawnSync('sh', ['-n', SCRIPT], { encoding: 'utf8' })
    expect(r.status).toBe(0)
  })
})

describe('junit-count.sh — Gradle 다중 모듈 합산', () => {
  beforeEach(() => {
    // 모듈 a: 성공 1, 실패 1, skip 1 (tests=3)
    put(
      'a/build/test-results/test/TEST-a.FooTest.xml',
      suite({
        name: 'a.FooTest', tests: 3, failures: 1, skipped: 1,
        cases:
          '  <testcase classname="a.FooTest" name="ok"/>\n' +
          '  <testcase classname="a.FooTest" name="bad"><failure message="boom">stack</failure></testcase>\n' +
          '  <testcase classname="a.FooTest" name="skippedOne"><skipped/></testcase>\n',
      }),
    )
    // 모듈 b: 성공 1, 에러 1 (tests=2)
    put(
      'b/build/test-results/test/TEST-b.BarTest.xml',
      suite({
        name: 'b.BarTest', tests: 2, errors: 1,
        cases:
          '  <testcase classname="b.BarTest" name="ok"/>\n' +
          '  <testcase classname="b.BarTest" name="broken"><error message="oops">stack</error></testcase>\n',
      }),
    )
  })

  it('두 모듈을 합산해 tests=5 failures=1 errors=1 skipped=1 files=2', () => {
    const r = run(repo, [repo])
    expect(r.code).toBe(0)
    expect(r.out.trim().split('\n')).toEqual([
      'JUNIT_SUMMARY tests=5 failures=1 errors=1 skipped=1 files=2',
    ])
  })

  it('폴더 인자로 범위를 좁히면 그 모듈만 센다', () => {
    const ra = run(repo, [join(repo, 'a')])
    expect(ra.out.trim()).toBe('JUNIT_SUMMARY tests=3 failures=1 errors=0 skipped=1 files=1')
    const rb = run(repo, [join(repo, 'b')])
    expect(rb.out.trim()).toBe('JUNIT_SUMMARY tests=2 failures=0 errors=1 skipped=0 files=1')
  })

  it('폴더를 안 주면 cwd 를 쓴다', () => {
    const r = spawnSync('sh', [SCRIPT], { cwd: repo, encoding: 'utf8', timeout: 30_000 })
    expect(r.status).toBe(0)
    expect((r.stdout || '').trim()).toBe('JUNIT_SUMMARY tests=5 failures=1 errors=1 skipped=1 files=2')
  })

  it('--failed-file 은 <classname>.<name> 을 정렬·중복 제거해 쓴다', () => {
    const ff = join(tmp, 'failed.txt')
    const r = run(repo, ['--failed-file', ff, repo])
    expect(r.code).toBe(0)
    const failed = readFileSync(ff, 'utf8').trim().split('\n')
    expect(failed).toEqual(['a.FooTest.bad', 'b.BarTest.broken'])
  })

  it('--failed-file 뒤에 폴더를 줘도 동작한다(옵션 순서)', () => {
    const ff = join(tmp, 'failed2.txt')
    const r = run(repo, [repo, '--failed-file', ff])
    expect(r.code).toBe(0)
    expect(readFileSync(ff, 'utf8').trim().split('\n')).toEqual(['a.FooTest.bad', 'b.BarTest.broken'])
  })
})

describe('junit-count.sh — Maven', () => {
  it('surefire·failsafe 결과를 센다', () => {
    put(
      'mvnmod/target/surefire-reports/TEST-mvnmod.SurefireTest.xml',
      suite({ name: 'mvnmod.SurefireTest', tests: 1, cases: '  <testcase classname="mvnmod.SurefireTest" name="ok"/>\n' }),
    )
    put(
      'mvnmod/target/failsafe-reports/TEST-mvnmod.FailsafeIT.xml',
      suite({ name: 'mvnmod.FailsafeIT', tests: 1, failures: 1, cases:
        '  <testcase classname="mvnmod.FailsafeIT" name="itFails"><failure message="x">y</failure></testcase>\n' }),
    )
    const r = run(repo, [repo])
    expect(r.code).toBe(0)
    expect(r.out.trim()).toBe('JUNIT_SUMMARY tests=2 failures=1 errors=0 skipped=0 files=2')
  })
})

describe('junit-count.sh — 제외 폴더', () => {
  beforeEach(() => {
    put(
      'a/build/test-results/test/TEST-a.FooTest.xml',
      suite({ name: 'a.FooTest', tests: 1, cases: '  <testcase classname="a.FooTest" name="ok"/>\n' }),
    )
  })
  const excluded = [
    'node_modules/dep/build/test-results/test/TEST-dep.Excluded.xml',
    '.git/build/test-results/test/TEST-git.Excluded.xml',
    '.gradle/build/test-results/test/TEST-gradle.Excluded.xml',
    '.claude/worktrees/w1/build/test-results/test/TEST-wt.Excluded.xml',
  ]
  for (const rel of excluded) {
    it(`${rel.split('/')[0]} 아래는 세지 않는다`, () => {
      put(rel, suite({ name: 'x.Excluded', tests: 99, cases: '  <testcase classname="x.Excluded" name="ok"/>\n' }))
      const r = run(repo, [repo])
      expect(r.code).toBe(0)
      // 제외 폴더의 tests=99 가 섞이면 100이 된다 — 진짜 모듈(a)의 tests=1 만 잡혀야 한다
      expect(r.out.trim()).toBe('JUNIT_SUMMARY tests=1 failures=0 errors=0 skipped=0 files=1')
    })
  }
})

describe('junit-count.sh — XML 없음', () => {
  it('JUNIT_SUMMARY_NONE 과 exit 1', () => {
    mkdirSync(join(repo, 'empty'), { recursive: true })
    const r = run(repo, [join(repo, 'empty')])
    expect(r.code).toBe(1)
    expect(r.out.trim()).toContain('JUNIT_SUMMARY_NONE')
  })
})

describe('junit-count.sh — 깨진 XML 은 건너뛴다', () => {
  it('JUNIT_SKIP 을 stderr 에 내고 나머지는 정상 합산한다(exit 0)', () => {
    put('a/build/test-results/test/TEST-a.FooTest.xml',
      suite({ name: 'a.FooTest', tests: 1, cases: '  <testcase classname="a.FooTest" name="ok"/>\n' }))
    put('broken/build/test-results/test/TEST-broken.Bad.xml', '<?xml version="1.0"?>\n<testsuite name="broken.Bad" tests="1"\n')
    const r = run(repo, [repo])
    expect(r.code).toBe(0)
    expect(r.out.trim()).toBe('JUNIT_SUMMARY tests=1 failures=0 errors=0 skipped=0 files=1')
    expect(r.err).toContain('JUNIT_SKIP')
    expect(r.err).toContain('TEST-broken.Bad.xml')
  })
})

describe('junit-count.sh — --since (수동 escape hatch)', () => {
  // 실측(2026-09-26, GRADLE_USER_HOME 임시·--no-daemon, JUnit 5 최소 프로젝트, Gradle 9.3.1)으로는 표준 전체/모듈
  // test 태스크 재실행에서 옛 XML 이 남거나(클래스 삭제 후 재실행) UP-TO-DATE 인데 XML 이 없는 경우(결과 폴더 삭제 후
  // 무변경 재실행)가 재현되지 않았다 — Gradle 이 출력 디렉터리를 스스로 청소·복구한다. 그래도 --tests 필터 재실행처럼
  // 이 스크립트가 다루지 않는 경우를 위해 수동 필터를 열어 둔다.
  it('epoch 초보다 오래된 XML 은 JUNIT_STALE 로 빼고 합산하지 않는다', () => {
    const p = join(repo, 'a/build/test-results/test/TEST-a.FooTest.xml')
    put('a/build/test-results/test/TEST-a.FooTest.xml',
      suite({ name: 'a.FooTest', tests: 1, cases: '  <testcase classname="a.FooTest" name="ok"/>\n' }))
    const futureEpoch = Math.floor(Date.now() / 1000) + 3600
    const r = run(repo, ['--since', String(futureEpoch), repo])
    expect(r.code).toBe(0)
    expect(r.out.trim()).toBe('JUNIT_SUMMARY tests=0 failures=0 errors=0 skipped=0 files=0')
    expect(r.err).toContain('JUNIT_STALE')
    expect(r.err).toContain(p)
  })
  it('기본값(옵션 없음)은 모두 센다', () => {
    put('a/build/test-results/test/TEST-a.FooTest.xml',
      suite({ name: 'a.FooTest', tests: 1, cases: '  <testcase classname="a.FooTest" name="ok"/>\n' }))
    const r = run(repo, [repo])
    expect(r.out.trim()).toBe('JUNIT_SUMMARY tests=1 failures=0 errors=0 skipped=0 files=1')
  })
  it('epoch 초가 과거면 모두 그대로 센다', () => {
    put('a/build/test-results/test/TEST-a.FooTest.xml',
      suite({ name: 'a.FooTest', tests: 1, cases: '  <testcase classname="a.FooTest" name="ok"/>\n' }))
    const r = run(repo, ['--since', '1', repo])
    expect(r.out.trim()).toBe('JUNIT_SUMMARY tests=1 failures=0 errors=0 skipped=0 files=1')
    expect(r.err).not.toContain('JUNIT_STALE')
  })
  it('--since <파일> 은 그 파일의 mtime 을 기준으로 쓴다', () => {
    const p = join(repo, 'a/build/test-results/test/TEST-a.FooTest.xml')
    put('a/build/test-results/test/TEST-a.FooTest.xml',
      suite({ name: 'a.FooTest', tests: 1, cases: '  <testcase classname="a.FooTest" name="ok"/>\n' }))
    // XML 을 과거로, 마커 파일을 그보다 나중으로 찍는다 — mtime 만으로 오래된 XML 을 판정한다는 뜻을 명확히 한다.
    const past = new Date(Date.now() - 2 * 3600 * 1000)
    utimesSync(p, past, past)
    const marker = join(tmp, 'marker.txt')
    writeFileSync(marker, 'x')
    const r = run(repo, ['--since', marker, repo])
    expect(r.code).toBe(0)
    expect(r.out.trim()).toBe('JUNIT_SUMMARY tests=0 failures=0 errors=0 skipped=0 files=0')
    expect(r.err).toContain('JUNIT_STALE')
    expect(r.err).toContain(p)
  })
  it('--since <파일> 로 준 파일이 XML 보다 오래됐으면 모두 그대로 센다', () => {
    const marker = join(tmp, 'marker-old.txt')
    writeFileSync(marker, 'x')
    const past = new Date(Date.now() - 2 * 3600 * 1000)
    utimesSync(marker, past, past)
    put('a/build/test-results/test/TEST-a.FooTest.xml',
      suite({ name: 'a.FooTest', tests: 1, cases: '  <testcase classname="a.FooTest" name="ok"/>\n' }))
    const r = run(repo, ['--since', marker, repo])
    expect(r.code).toBe(0)
    expect(r.out.trim()).toBe('JUNIT_SUMMARY tests=1 failures=0 errors=0 skipped=0 files=1')
    expect(r.err).not.toContain('JUNIT_STALE')
  })
})
