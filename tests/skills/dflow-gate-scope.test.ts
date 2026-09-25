// tests/skills/dflow-gate-scope.test.ts
// 게이트 범위 판정(.claude/skills/dflow-dev/scripts/gate-scope.sh). 한 모듈만 바꾼 Task 도 게이트마다 전체 스위트를 돌던
// 것을 줄인다(2026-09-26 성능 감사). 리포의 대응표(.dflow-gates)로 바꾼 모듈의 게이트 명령만 내고, 판정이 모호하면
// 전체다. 대응표가 없는 리포는 GATE_SCOPE none — 지금 동작 그대로다. 실제 git 샌드박스에서 sh 로 돌린다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const ROOT = process.cwd()
const SCOPE = join(ROOT, '.claude/skills/dflow-dev/scripts/gate-scope.sh')

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}
function sh(cwd: string, script: string) {
  const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', timeout: 30_000, env: GIT_ENV })
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' }
}

const MAP = [
  '# 게이트 대응표',
  'full\t./gradlew testAll',
  'prepare\tpnpm --filter "web^..." build',
  'docs/\t-',
  'backend/core/\t./gradlew :core:test :api:test',
  'backend/api/\t./gradlew :api:test',
  'frontend/*/src/*\tpnpm --filter web test',
  '',
].join('\n')

let tmp: string
let repo: string
let base: string
const put = (rel: string, body = 'x\n') => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true })
  writeFileSync(join(repo, rel), body)
}
const commit = (msg = 'c') => sh(repo, `git add -A && git commit -qm ${msg}`)
const scope = (extra = '') => sh(repo, `sh '${SCOPE}' --base ${base} --ignore docs/tasks/TSK-01/ ${extra}`)
const lines = (out: string) => out.trim().split('\n').filter((l) => l.startsWith('GATE_SCOPE '))

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-gate-scope-')))
  repo = join(tmp, 'repo')
  mkdirSync(repo)
  expect(sh(repo, 'git init -q -b main').code).toBe(0)
  put('.dflow-gates', MAP)
  put('backend/core/src/A.java')
  put('backend/api/src/B.java')
  put('frontend/web/src/app.ts')
  put('docs/tasks/TSK-01/state.json', '{}\n')
  put('README.md')
  expect(commit('init').code).toBe(0)
  base = sh(repo, 'git rev-parse HEAD').out.trim()
})
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

describe('gate-scope.sh — 대응표가 없으면 지금 동작 그대로', () => {
  it('기점에 .dflow-gates 가 없으면 GATE_SCOPE none(exit 0)', () => {
    sh(repo, 'git rm -q .dflow-gates && git commit -qm rm')
    base = sh(repo, 'git rev-parse HEAD').out.trim()
    put('backend/core/src/A.java', 'changed\n')
    const r = scope()
    expect(r.code).toBe(0)
    expect(lines(r.out)).toEqual(['GATE_SCOPE none'])
  })
  it('실행 비트가 있다', () => {
    expect(statSync(SCOPE).mode & 0o111).not.toBe(0)
  })
})

describe('gate-scope.sh — 모듈 범위', () => {
  it('모듈 하나: 그 줄의 명령만 낸다(prepare·full 줄은 모듈 대응이 아니다)', () => {
    put('backend/api/src/B.java', 'changed\n')
    commit()
    const r = scope()
    expect(r.code).toBe(0)
    expect(lines(r.out)).toEqual(['GATE_SCOPE module ./gradlew :api:test'])
    expect(r.out).not.toContain('pnpm --filter "web^..." build')
  })
  it('두 모듈: 대응표 순서대로, 같은 명령은 한 번만. glob 줄도 맞는다', () => {
    put('frontend/web/src/app.ts', 'changed\n')
    put('backend/core/src/A.java', 'changed\n')
    put('backend/core/src/C.java', 'new\n')
    commit()
    expect(lines(scope().out)).toEqual([
      'GATE_SCOPE module ./gradlew :core:test :api:test',
      'GATE_SCOPE module pnpm --filter web test',
    ])
  })
  it('커밋하지 않은 변경과 추적 안 된 새 파일도 본다', () => {
    put('backend/api/src/New.java', 'untracked\n')
    expect(lines(scope().out)).toEqual(['GATE_SCOPE module ./gradlew :api:test'])
  })
  it('Task 문서 폴더(--ignore)와 - 줄(docs/)의 변경은 범위에서 빠진다', () => {
    put('backend/api/src/B.java', 'changed\n')
    put('docs/tasks/TSK-01/build-log.md', '## 게이트 기록\n')
    put('docs/guide.md', 'doc\n')
    commit()
    expect(lines(scope().out)).toEqual(['GATE_SCOPE module ./gradlew :api:test'])
  })
  it('--ignore 에 절대경로를 줘도 리포 최상위 기준으로 뺀다', () => {
    put('backend/api/src/B.java', 'changed\n')
    put('docs/tasks/TSK-01/design.md', '# d\n')
    commit()
    const r = sh(repo, `sh '${SCOPE}' --base ${base} --ignore '${join(repo, 'docs/tasks/TSK-01')}/'`)
    expect(lines(r.out)).toEqual(['GATE_SCOPE module ./gradlew :api:test'])
  })
  it('삭제한 파일도 그 모듈의 변경이다', () => {
    sh(repo, 'git rm -q backend/core/src/A.java && git commit -qm del')
    expect(lines(scope().out)).toEqual(['GATE_SCOPE module ./gradlew :core:test :api:test'])
  })
  it('모듈을 건너 옮긴 파일은 옛 모듈과 새 모듈을 모두 본다', () => {
    sh(repo, 'git mv backend/core/src/A.java backend/api/src/A.java && git commit -qm mv')
    expect(lines(scope().out)).toEqual([
      'GATE_SCOPE module ./gradlew :core:test :api:test',
      'GATE_SCOPE module ./gradlew :api:test',
    ])
  })
  it('--paths-file 로 예측 범위를 본다(Design 직후, git diff 대신)', () => {
    writeFileSync(join(tmp, 'paths'), 'backend/core/src/A.java\r\n')
    expect(lines(scope(`--paths-file '${tmp}/paths'`).out)).toEqual(['GATE_SCOPE module ./gradlew :core:test :api:test'])
  })
  it('대응표 줄 끝의 CR 을 뗀다(Git Bash autocrlf)', () => {
    writeFileSync(join(tmp, 'crlf'), MAP.replace(/\n/g, '\r\n'))
    put('backend/api/src/B.java', 'changed\n')
    expect(lines(scope(`--map '${tmp}/crlf'`).out)).toEqual(['GATE_SCOPE module ./gradlew :api:test'])
  })
  it('대응표는 기점의 것을 읽는다 — Task 도중 고친 대응표의 명령은 쓰지 않는다', () => {
    // 대응표 변경 자체는 전체로 가므로(아래) 그 판정만 --ignore 로 비켜 두고 어느 대응표를 읽었는지 본다
    put('.dflow-gates', MAP.replace('./gradlew :api:test', 'changed-cmd'))
    put('backend/api/src/B.java', 'changed\n')
    commit()
    expect(lines(scope('--ignore .dflow-gates').out)).toEqual(['GATE_SCOPE module ./gradlew :api:test'])
  })
})

describe('gate-scope.sh — 모호하면 전체', () => {
  it('대응표에 없는 경로가 하나라도 있으면 full 줄의 명령을 낸다', () => {
    put('backend/api/src/B.java', 'changed\n')
    put('tools/gen.sh', 'new\n')
    commit()
    const r = scope()
    expect(r.code).toBe(0)
    expect(lines(r.out)).toEqual(['GATE_SCOPE full ./gradlew testAll'])
    expect(r.err).toContain('GATE_SCOPE_REASON 대응표에 없는 경로: tools/gen.sh')
  })
  it('공용 빌드·설정 파일(모듈 폴더 안의 settings·lockfile 포함)이 바뀌면 전체', () => {
    for (const f of ['backend/core/gradle.properties', 'pnpm-lock.yaml', 'build.gradle.kts', 'gradle/libs.versions.toml']) {
      sh(repo, `git reset -q --hard ${base} && git clean -qfd`)
      put(f, 'changed\n')
      expect(lines(scope().out), f).toEqual(['GATE_SCOPE full ./gradlew testAll'])
    }
  })
  it('.dflow-gates 자신을 고치면 전체다', () => {
    put('.dflow-gates', MAP + 'tools/\t./tools-test\n')
    commit()
    expect(lines(scope().out)).toEqual(['GATE_SCOPE full ./gradlew testAll'])
  })
  it('범위에 남은 코드 경로가 없으면(문서뿐) 전체다', () => {
    put('docs/guide.md', 'doc\n')
    commit()
    expect(lines(scope().out)).toEqual(['GATE_SCOPE full ./gradlew testAll'])
  })
  it('full 줄이 여럿이면 모두 낸다', () => {
    writeFileSync(join(tmp, 'm2'), 'full\t./gradlew testAll\nfull\tpnpm -r test\nbackend/\t./gradlew :api:test\n')
    put('tools/x', 'new\n')
    expect(lines(scope(`--map '${tmp}/m2'`).out)).toEqual(['GATE_SCOPE full ./gradlew testAll', 'GATE_SCOPE full pnpm -r test'])
  })
})

describe('gate-scope.sh — 대응표 형식 오류는 invalid(exit 2)', () => {
  it('full 줄이 없으면 invalid', () => {
    writeFileSync(join(tmp, 'nofull'), 'backend/\t./gradlew :api:test\n')
    const r = scope(`--map '${tmp}/nofull'`)
    expect(r.code).toBe(2)
    expect(lines(r.out)).toEqual(['GATE_SCOPE invalid 대응표에 full 줄이 없음'])
  })
  it('TAB 이 없는 줄이면 invalid', () => {
    writeFileSync(join(tmp, 'notab'), 'full ./gradlew testAll\n')
    const r = scope(`--map '${tmp}/notab'`)
    expect(r.code).toBe(2)
    expect(r.out).toContain('GATE_SCOPE invalid 대응표 1행에 TAB 이 없음')
  })
  it('기점을 모르면 invalid', () => {
    const r = sh(repo, `sh '${SCOPE}' --base deadbeef`)
    expect(r.code).toBe(2)
    expect(r.out).toContain('GATE_SCOPE invalid 기점 deadbeef 를 모름')
  })
})
