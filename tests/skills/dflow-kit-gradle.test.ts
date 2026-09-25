// tests/skills/dflow-kit-gradle.test.ts
// install.sh 의 Gradle 권장 설정 점검·--gradle-pc(리포 동반·단독)·/dflow-team 전제 검사 경고를 검증한다.
// 설계: docs/superpowers/specs/2026-09-26-dflow-perf-audit-kit-design.md ⑥
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd() // vitest 는 리포 루트에서 돈다(기존 tests/ 관례)
const KEYS = ['org.gradle.caching', 'org.gradle.workers.max', 'org.gradle.daemon.idletimeout']

// install.sh 를 실제로 돌리기 위한 최소 가짜 KIT_DIR. dflow-team 스킬(gradle-check.sh 포함)·gradle 원본·hooks 까지 싣는다.
function buildFakeKit(): string {
  const kit = mkdtempSync(join(tmpdir(), 'dflow-fake-kit-gradle-'))
  cpSync(join(ROOT, 'kit/install.sh'), join(kit, 'install.sh'))
  chmodSync(join(kit, 'install.sh'), 0o755)
  cpSync(join(ROOT, 'kit/worker-allow.json'), join(kit, 'worker-allow.json'))
  mkdirSync(join(kit, 'gradle'), { recursive: true })
  cpSync(join(ROOT, 'kit/gradle/dflow-test-jvm.gradle'), join(kit, 'gradle/dflow-test-jvm.gradle'))
  mkdirSync(join(kit, 'hooks'), { recursive: true })
  cpSync(join(ROOT, 'kit/hooks/heartbeat.sh'), join(kit, 'hooks/heartbeat.sh'))
  chmodSync(join(kit, 'hooks/heartbeat.sh'), 0o755)
  mkdirSync(join(kit, 'skills'), { recursive: true })
  cpSync(join(ROOT, '.claude/skills/dflow-work'), join(kit, 'skills/dflow-work'), { recursive: true })
  cpSync(join(ROOT, '.claude/skills/dflow-poll'), join(kit, 'skills/dflow-poll'), { recursive: true })
  cpSync(join(ROOT, '.claude/skills/dflow-team'), join(kit, 'skills/dflow-team'), { recursive: true })
  chmodSync(join(kit, 'skills/dflow-team/scripts/gradle-check.sh'), 0o755)
  return kit
}

// gh·curl·python3 스텁 — 이 PC 에 실제로 있는지와 무관하게 의존 점검을 통과시킨다. git·jq 는 실제 바이너리를 쓴다.
function buildStubBin(): string {
  const bin = mkdtempSync(join(tmpdir(), 'dflow-stub-bin-gradle-'))
  for (const name of ['gh', 'curl', 'python3']) {
    const p = join(bin, name)
    writeFileSync(p, '#!/bin/sh\nexit 0\n')
    chmodSync(p, 0o755)
  }
  return bin
}

// install.sh <target> [args...] 로 돌린다(리포 동반 모드).
function runInstall(target: string, args: string[] = [], extraEnv: Record<string, string> = {}) {
  return runInstallRaw([target, ...args], extraEnv)
}

// install.sh 를 인자 그대로 돌린다 — 리포 없는 단독 모드(install.sh --gradle-pc) 를 시험하려고 target 을 강제하지 않는다.
// cwd 를 주면 그 폴더에서 돌린다(단독 모드가 현재 폴더를 건드리지 않는지 확인할 때 쓴다).
function runInstallRaw(args: string[], extraEnv: Record<string, string> = {}, cwd?: string) {
  const kit = buildFakeKit()
  const bin = buildStubBin()
  try {
    return spawnSync('sh', [join(kit, 'install.sh'), ...args], {
      encoding: 'utf8',
      cwd,
      env: {
        ...process.env,
        HOME: mkdtempSync(join(tmpdir(), 'dflow-fake-home-gradle-')),
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        ...extraEnv,
      },
    })
  } finally {
    rmSync(kit, { recursive: true, force: true })
    rmSync(bin, { recursive: true, force: true })
  }
}

function makeTarget(): string {
  const target = mkdtempSync(join(tmpdir(), 'dflow-gradle-target-'))
  spawnSync('git', ['init', '-q'], { cwd: target })
  return target
}

// SKILL.md 전제 검사 블록에서 gradle-check.sh 를 부르는 조각만 그대로 뽑아 낸다(손으로 베낀 사본이 아니라 실제 문서
// 텍스트를 실행한다 — 나중에 SKILL.md 가 바뀌면 이 시험도 따라 깨진다).
function extractGradleWarnFragment(): string {
  const skill = readFileSync(join(ROOT, '.claude/skills/dflow-team/SKILL.md'), 'utf8')
  const m = skill.match(/\n {3}if \[ -x \.claude\/skills\/dflow-team\/scripts\/gradle-check\.sh \][\s\S]*?\n {3}fi\n/)
  if (!m) throw new Error('SKILL.md 에서 gradle-check.sh 전제 검사 조각을 찾지 못했다')
  return m[0]
    .split('\n')
    .map((l) => (l.startsWith('   ') ? l.slice(3) : l))
    .join('\n')
}

describe('gradle-check.sh — 탐색·판정 전용(파일을 고치지 않는다)', () => {
  it('gradlew·settings.gradle(.kts) 가 있는 폴더를 빌드 루트로 찾고, node_modules 는 내려가지 않는다', () => {
    const repo = mkdtempSync(join(tmpdir(), 'dflow-gc-repo-'))
    try {
      writeFileSync(join(repo, 'gradlew'), '')
      writeFileSync(join(repo, 'settings.gradle'), "include 'moduleB'\n")
      mkdirSync(join(repo, 'moduleB'))
      writeFileSync(join(repo, 'moduleB/settings.gradle.kts'), '')
      writeFileSync(join(repo, 'moduleB/gradle.properties'), KEYS.map((k) => `${k}=x`).join('\n') + '\n')
      mkdirSync(join(repo, 'node_modules/ignored-gradle'), { recursive: true })
      writeFileSync(join(repo, 'node_modules/ignored-gradle/settings.gradle'), '')

      const r = spawnSync('sh', [join(ROOT, '.claude/skills/dflow-team/scripts/gradle-check.sh'), repo], { encoding: 'utf8' })
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain(`NOFILE ${repo}`)
      expect(r.stdout).toContain(`OK ${join(repo, 'moduleB')}`)
      expect(r.stdout).not.toContain('node_modules')

      // 파일을 고치지 않는다
      expect(existsSync(join(repo, 'gradle.properties'))).toBe(false)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('다른 체크아웃(자체 .git 이 있는 하위 폴더 — 예: /dflow-team 팀원 워크트리)은 건드리지 않는다', () => {
    // 옛 방식 팀원 워크트리는 <리포>/dflow-<id8>/ 에 만들어지고(precheck.md 「공유 info/exclude」), 그 폴더는
    // 자기 .git(워크트리 gitdir 포인터 파일)을 갖는다. 그 안의 gradlew 는 다른 리포에 속하므로 보고도 쓰기도 안 한다.
    const repo = mkdtempSync(join(tmpdir(), 'dflow-gc-worktree-'))
    try {
      writeFileSync(join(repo, 'gradlew'), '')
      const worktree = join(repo, 'dflow-abc12345')
      mkdirSync(worktree)
      writeFileSync(join(worktree, '.git'), 'gitdir: /somewhere/else/.git/worktrees/dflow-abc12345\n')
      writeFileSync(join(worktree, 'gradlew'), '')

      const r = spawnSync('sh', [join(ROOT, '.claude/skills/dflow-team/scripts/gradle-check.sh'), repo], { encoding: 'utf8' })
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain(`NOFILE ${repo}`)
      expect(r.stdout).not.toContain(worktree)
      expect(existsSync(join(worktree, 'gradle.properties'))).toBe(false)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('Gradle 리포가 아니면 아무것도 내지 않고 exit 0', () => {
    const repo = mkdtempSync(join(tmpdir(), 'dflow-gc-nogradle-'))
    try {
      const r = spawnSync('sh', [join(ROOT, '.claude/skills/dflow-team/scripts/gradle-check.sh'), repo], { encoding: 'utf8' })
      expect(r.status).toBe(0)
      expect(r.stdout.trim()).toBe('')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('키 일부가 빠지면 MISSING 을 빠진 키만 담아 낸다', () => {
    const repo = mkdtempSync(join(tmpdir(), 'dflow-gc-missing-'))
    try {
      writeFileSync(join(repo, 'gradlew'), '')
      writeFileSync(join(repo, 'gradle.properties'), 'org.gradle.caching=true\n')
      const r = spawnSync('sh', [join(ROOT, '.claude/skills/dflow-team/scripts/gradle-check.sh'), repo], { encoding: 'utf8' })
      expect(r.stdout).toContain(`MISSING ${repo} org.gradle.workers.max,org.gradle.daemon.idletimeout`)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})

describe('install.sh — Gradle 리포 설정(정본)', () => {
  it('gradle.properties 가 없으면 권장 3키로 새로 만든다', () => {
    const target = makeTarget()
    try {
      writeFileSync(join(target, 'gradlew'), '')
      const r = runInstall(target)
      expect(r.status, r.stderr).toBe(0)
      const props = readFileSync(join(target, 'gradle.properties'), 'utf8')
      for (const k of KEYS) expect(props).toMatch(new RegExp(`^${k.replace(/\./g, '\\.')}=`, 'm'))
      expect(r.stdout).toContain('생성:')
      expect(r.stdout).toContain('git add')
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
  })

  it('gradle.properties 가 있고 키가 빠지면 고치지 않고 붙일 줄만 안내한다', () => {
    const target = makeTarget()
    try {
      writeFileSync(join(target, 'gradlew'), '')
      const original = 'org.gradle.caching=true\n# 사람이 남긴 주석\n'
      writeFileSync(join(target, 'gradle.properties'), original)
      const r = runInstall(target)
      expect(r.status, r.stderr).toBe(0)
      // 파일은 그대로다
      expect(readFileSync(join(target, 'gradle.properties'), 'utf8')).toBe(original)
      expect(r.stdout).toContain('고치지 않았다')
      expect(r.stdout).toContain('org.gradle.workers.max=3')
      expect(r.stdout).toContain('org.gradle.daemon.idletimeout=600000')
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
  })

  it('이미 있는 키는 값이 달라도 건드리지 않는다 — OK 로 판정해 "확인" 한 줄만 내고 파일은 그대로다', () => {
    const target = makeTarget()
    try {
      writeFileSync(join(target, 'gradlew'), '')
      const original = KEYS.map((k) => `${k}=custom-value`).join('\n') + '\n'
      writeFileSync(join(target, 'gradle.properties'), original)
      const r = runInstall(target)
      expect(r.status, r.stderr).toBe(0)
      expect(readFileSync(join(target, 'gradle.properties'), 'utf8')).toBe(original)
      expect(r.stdout).toContain('Gradle 권장 설정 점검')
      expect(r.stdout).toContain('확인:')
      expect(r.stdout).toContain('이미 있다')
      // OK 뿐이므로 새로 만들거나 붙일 줄 안내는 없다
      expect(r.stdout).not.toContain('생성:')
      expect(r.stdout).not.toContain('고치지 않았다')
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
  })

  it('includeBuild 로 딸린 하위 모듈(별도 settings.gradle.kts) 도 루트마다 따로 검사한다', () => {
    const target = makeTarget()
    try {
      writeFileSync(join(target, 'gradlew'), '')
      mkdirSync(join(target, 'buildSrcLike'))
      writeFileSync(join(target, 'buildSrcLike/settings.gradle.kts'), '')
      const r = runInstall(target)
      expect(r.status, r.stderr).toBe(0)
      expect(existsSync(join(target, 'gradle.properties'))).toBe(true)
      expect(existsSync(join(target, 'buildSrcLike/gradle.properties'))).toBe(true)
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
  })

  it('Gradle 리포가 아니면 점검 안내를 내지 않는다', () => {
    const target = makeTarget()
    try {
      const r = runInstall(target)
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).not.toContain('Gradle 권장 설정 점검')
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
  })

  it('gradle-check.sh 의 실행 권한이 빠져 있어도(예: 압축·복사 과정에서 손실) sh 로 직접 불러 건너뛰지 않는다', () => {
    const target = makeTarget()
    const kit = buildFakeKit()
    const bin = buildStubBin()
    try {
      writeFileSync(join(target, 'gradlew'), '')
      chmodSync(join(kit, 'skills/dflow-team/scripts/gradle-check.sh'), 0o644) // 실행 비트 없음
      const r = spawnSync('sh', [join(kit, 'install.sh'), target], {
        encoding: 'utf8',
        env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'dflow-fake-home-noexec-')), PATH: `${bin}:${process.env.PATH ?? ''}` },
      })
      expect(r.status, r.stderr).toBe(0)
      expect(existsSync(join(target, 'gradle.properties'))).toBe(true)
    } finally {
      rmSync(target, { recursive: true, force: true })
      rmSync(kit, { recursive: true, force: true })
      rmSync(bin, { recursive: true, force: true })
    }
  })
})

describe('install.sh --gradle-pc(리포와 함께) — 이 PC 안전망', () => {
  it('GRADLE_USER_HOME 에 없는 키만 덧붙이고, 있는 키는 보존하며, 키마다 한 줄씩 알린다', () => {
    const target = makeTarget()
    const guh = mkdtempSync(join(tmpdir(), 'dflow-guh-'))
    try {
      writeFileSync(join(guh, 'gradle.properties'), 'org.gradle.workers.max=99\n')
      const r = runInstall(target, ['--gradle-pc'], { GRADLE_USER_HOME: guh })
      expect(r.status, r.stderr).toBe(0)
      const props = readFileSync(join(guh, 'gradle.properties'), 'utf8')
      expect(props).toContain('org.gradle.workers.max=99') // 기존 값 보존(다른 값이라도 안 건드림)
      expect(props).toContain('org.gradle.caching=true')
      expect(props).toContain('org.gradle.daemon.idletimeout=600000')
      expect(r.stdout).toContain('우선 적용')
      expect(r.stdout).toContain('건너뜀')
      expect(r.stdout).toContain('org.gradle.workers.max')
      expect(r.stdout).toContain('설치:')
    } finally {
      rmSync(target, { recursive: true, force: true })
      rmSync(guh, { recursive: true, force: true })
    }
  })

  it('기존 gradle.properties 가 줄바꿈 없이 끝나도 값이 이어붙지 않는다', () => {
    const target = makeTarget()
    const guh = mkdtempSync(join(tmpdir(), 'dflow-guh-nonl-'))
    try {
      writeFileSync(join(guh, 'gradle.properties'), 'org.gradle.workers.max=99') // 끝에 개행 없음
      const r = runInstall(target, ['--gradle-pc'], { GRADLE_USER_HOME: guh })
      expect(r.status, r.stderr).toBe(0)
      const props = readFileSync(join(guh, 'gradle.properties'), 'utf8')
      expect(props).not.toContain('org.gradle.workers.max=99org.gradle.caching')
      expect(props.split('\n')).toContain('org.gradle.workers.max=99')
      expect(props.split('\n')).toContain('org.gradle.caching=true')
      expect(props.split('\n')).toContain('org.gradle.daemon.idletimeout=600000')
    } finally {
      rmSync(target, { recursive: true, force: true })
      rmSync(guh, { recursive: true, force: true })
    }
  })

  it('init 스크립트는 C1 과 함께 ReservedCodeCacheSize=240m 을 넣되 리포 값이 있으면 덮지 않는다(CodeCache 부족 사고)', () => {
    const g = readFileSync(join(ROOT, 'kit/gradle/dflow-test-jvm.gradle'), 'utf8')
    expect(g).toContain("task.jvmArgs('-XX:TieredStopAtLevel=1')")
    expect(g).toContain("def hasCodeCache = task.allJvmArgs.any { it.startsWith('-XX:ReservedCodeCacheSize') }")
    expect(g).toContain("task.jvmArgs('-XX:ReservedCodeCacheSize=240m')")
    const readme = readFileSync(join(ROOT, 'kit/README.md'), 'utf8')
    expect(readme).toContain("jvmArgs '-XX:TieredStopAtLevel=1', '-XX:ReservedCodeCacheSize=240m'")
    expect(readme).toContain('**`-XX:ReservedCodeCacheSize=240m` 을 빼지 않는다**')
  })

  it('GRADLE_USER_HOME 이 없으면 만들고, init.d/dflow-test-jvm.gradle 을 설치한다', () => {
    const target = makeTarget()
    const guh = mkdtempSync(join(tmpdir(), 'dflow-guh2-'))
    rmSync(guh, { recursive: true, force: true }) // 존재하지 않는 폴더에서 시작
    try {
      const r = runInstall(target, ['--gradle-pc'], { GRADLE_USER_HOME: guh })
      expect(r.status, r.stderr).toBe(0)
      expect(existsSync(join(guh, 'gradle.properties'))).toBe(true)
      expect(existsSync(join(guh, 'init.d/dflow-test-jvm.gradle'))).toBe(true)
    } finally {
      rmSync(target, { recursive: true, force: true })
      rmSync(guh, { recursive: true, force: true })
    }
  })

  it('init 파일이 이미 있으면 한 번만 설치하고(덮어쓰지 않고) 건너뛴다고 알린다', () => {
    const target = makeTarget()
    const guh = mkdtempSync(join(tmpdir(), 'dflow-guh3-'))
    try {
      mkdirSync(join(guh, 'init.d'), { recursive: true })
      writeFileSync(join(guh, 'init.d/dflow-test-jvm.gradle'), '// 사람이 손댄 버전\n')
      const r = runInstall(target, ['--gradle-pc'], { GRADLE_USER_HOME: guh })
      expect(r.status, r.stderr).toBe(0)
      expect(readFileSync(join(guh, 'init.d/dflow-test-jvm.gradle'), 'utf8')).toBe('// 사람이 손댄 버전\n')
      expect(r.stdout).toContain('이미 있다')
    } finally {
      rmSync(target, { recursive: true, force: true })
      rmSync(guh, { recursive: true, force: true })
    }
  })

  it('GRADLE_USER_HOME 이 없으면 ~/.gradle 을 쓴다(HOME 기준)', () => {
    const target = makeTarget()
    const kit = buildFakeKit()
    const bin = buildStubBin()
    const home = mkdtempSync(join(tmpdir(), 'dflow-fake-home-default-guh-'))
    try {
      const r = spawnSync('sh', [join(kit, 'install.sh'), target, '--gradle-pc'], {
        encoding: 'utf8',
        env: { ...process.env, HOME: home, GRADLE_USER_HOME: '', PATH: `${bin}:${process.env.PATH ?? ''}` },
      })
      expect(r.status, r.stderr).toBe(0)
      expect(existsSync(join(home, '.gradle/gradle.properties'))).toBe(true)
      expect(existsSync(join(home, '.gradle/init.d/dflow-test-jvm.gradle'))).toBe(true)
    } finally {
      rmSync(target, { recursive: true, force: true })
      rmSync(kit, { recursive: true, force: true })
      rmSync(bin, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('install.sh --gradle-pc(단독, 리포 없이) — 심링크 배포 리포 안전망', () => {
  it('install.sh --gradle-pc 단독 호출은 리포 인자 없이 ~/.gradle 만 건드린다', () => {
    const guh = mkdtempSync(join(tmpdir(), 'dflow-guh-standalone-'))
    try {
      const r = runInstallRaw(['--gradle-pc'], { GRADLE_USER_HOME: guh })
      expect(r.status, r.stderr).toBe(0)
      expect(existsSync(join(guh, 'gradle.properties'))).toBe(true)
      expect(existsSync(join(guh, 'init.d/dflow-test-jvm.gradle'))).toBe(true)
      // 리포 관련 산출물(스킬 복사·.dflow 초안·완료 안내)은 전혀 없다
      expect(r.stdout).not.toContain('설치 완료:')
      expect(r.stdout).not.toContain('.dflow 초안')
      expect(r.stdout).not.toContain('권한 준비')
    } finally {
      rmSync(guh, { recursive: true, force: true })
    }
  })

  it('단독 모드는 현재 폴더가 심링크 배포 리포여도 그 폴더를 전혀 건드리지 않는다', () => {
    // 심링크 배포 리포를 흉내: .claude/skills/dflow-dev 가 다른 폴더를 가리키는 심링크인 리포 안에서
    // install.sh --gradle-pc(단독, 인자에 리포 경로 없음)를 그 리포를 cwd 로 두고 돌린다. TARGET 을 전혀
    // 참조하지 않는 코드 경로이므로 심링크뿐 아니라 .dflow·settings.json 도 생기지 않아야 한다(기본값을 "." 로
    // 바꾸는 미래의 회귀도 이 시험이 잡는다).
    const fakeRepo = mkdtempSync(join(tmpdir(), 'dflow-symlink-repo-'))
    const guh = mkdtempSync(join(tmpdir(), 'dflow-guh-standalone2-'))
    try {
      mkdirSync(join(fakeRepo, '.claude/skills'), { recursive: true })
      const linkTarget = mkdtempSync(join(tmpdir(), 'dflow-link-target-'))
      mkdirSync(linkTarget, { recursive: true })
      symlinkSync(linkTarget, join(fakeRepo, '.claude/skills/dflow-dev'))
      expect(lstatSync(join(fakeRepo, '.claude/skills/dflow-dev')).isSymbolicLink()).toBe(true)

      const r = runInstallRaw(['--gradle-pc'], { GRADLE_USER_HOME: guh }, fakeRepo)
      expect(r.status, r.stderr).toBe(0)
      expect(lstatSync(join(fakeRepo, '.claude/skills/dflow-dev')).isSymbolicLink()).toBe(true)
      expect(existsSync(join(fakeRepo, '.dflow'))).toBe(false)
      expect(existsSync(join(fakeRepo, '.claude/settings.json'))).toBe(false)
      expect(existsSync(join(fakeRepo, 'gradle.properties'))).toBe(false)
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true })
      rmSync(guh, { recursive: true, force: true })
    }
  })

  it('install.sh <리포> --gradle-pc(리포 동반) 사용법도 여전히 동작한다(하위 호환)', () => {
    const target = makeTarget()
    const guh = mkdtempSync(join(tmpdir(), 'dflow-guh-combo-'))
    try {
      const r = runInstall(target, ['--gradle-pc'], { GRADLE_USER_HOME: guh })
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain('설치 완료:')
      expect(existsSync(join(guh, 'init.d/dflow-test-jvm.gradle'))).toBe(true)
    } finally {
      rmSync(target, { recursive: true, force: true })
      rmSync(guh, { recursive: true, force: true })
    }
  })
})

describe('install.sh 인자 처리 — --hooks 하위 호환 + 다중 옵션', () => {
  it('기존 사용법 install.sh <리포> --hooks 는 그대로 동작하고 훅 파일을 실제로 설치한다', () => {
    const target = makeTarget()
    const kit = buildFakeKit()
    const bin = buildStubBin()
    const home = mkdtempSync(join(tmpdir(), 'dflow-fake-home-hooks-'))
    try {
      const r = spawnSync('sh', [join(kit, 'install.sh'), target, '--hooks'], {
        encoding: 'utf8',
        env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` },
      })
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain('훅 복사')
      expect(existsSync(join(home, '.dflow/hooks/heartbeat.sh'))).toBe(true)
    } finally {
      rmSync(target, { recursive: true, force: true })
      rmSync(kit, { recursive: true, force: true })
      rmSync(bin, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('--hooks 와 --gradle-pc 를 함께, 순서 무관하게 줄 수 있다', () => {
    const target = makeTarget()
    const guh = mkdtempSync(join(tmpdir(), 'dflow-guh4-'))
    try {
      const r = runInstall(target, ['--gradle-pc', '--hooks'], { GRADLE_USER_HOME: guh })
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain('훅 복사')
      expect(existsSync(join(guh, 'init.d/dflow-test-jvm.gradle'))).toBe(true)
    } finally {
      rmSync(target, { recursive: true, force: true })
      rmSync(guh, { recursive: true, force: true })
    }
  })

  it('옵션 없이 target 만 주면 예전과 같이 동작한다(Gradle·hooks 모두 건너뜀)', () => {
    const target = makeTarget()
    try {
      const r = runInstall(target)
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).not.toContain('훅 복사')
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
  })

  it('옵션이 대상보다 먼저 와도 동작한다: install.sh --gradle-pc <리포>', () => {
    const target = makeTarget()
    const guh = mkdtempSync(join(tmpdir(), 'dflow-guh5-'))
    try {
      const r = runInstallRaw(['--gradle-pc', target], { GRADLE_USER_HOME: guh })
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain('설치 완료:')
      expect(existsSync(join(guh, 'init.d/dflow-test-jvm.gradle'))).toBe(true)
    } finally {
      rmSync(target, { recursive: true, force: true })
      rmSync(guh, { recursive: true, force: true })
    }
  })

  it('옵션이 대상보다 먼저 와도 동작한다: install.sh --hooks <리포> --gradle-pc', () => {
    const target = makeTarget()
    const kit = buildFakeKit()
    const bin = buildStubBin()
    const home = mkdtempSync(join(tmpdir(), 'dflow-fake-home-optfirst-'))
    const guh = mkdtempSync(join(tmpdir(), 'dflow-guh6-'))
    try {
      const r = spawnSync('sh', [join(kit, 'install.sh'), '--hooks', target, '--gradle-pc'], {
        encoding: 'utf8',
        env: { ...process.env, HOME: home, GRADLE_USER_HOME: guh, PATH: `${bin}:${process.env.PATH ?? ''}` },
      })
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain('훅 복사')
      expect(existsSync(join(home, '.dflow/hooks/heartbeat.sh'))).toBe(true)
      expect(existsSync(join(guh, 'init.d/dflow-test-jvm.gradle'))).toBe(true)
    } finally {
      rmSync(target, { recursive: true, force: true })
      rmSync(kit, { recursive: true, force: true })
      rmSync(bin, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
      rmSync(guh, { recursive: true, force: true })
    }
  })
})

describe('/dflow-team 전제 검사 — Gradle 권장 설정 경고(시작을 막지 않는다)', () => {
  it('SKILL.md 전제 검사 블록이 gradle-check.sh 를 불러 WARN GRADLE_TUNING 을 내고 fail 을 건드리지 않는다', () => {
    const frag = extractGradleWarnFragment()
    expect(frag).toContain('gradle-check.sh')
    expect(frag).toContain('WARN GRADLE_TUNING')
    expect(frag).not.toContain('bad ')
  })

  it('SKILL.md 에서 그대로 뽑은 조각이 문법상 유효하고, 실제로 WARN 줄을 낸다(NOFILE·MISSING 둘 다)', () => {
    const repo = mkdtempSync(join(tmpdir(), 'dflow-precheck-frag-'))
    try {
      mkdirSync(join(repo, '.claude/skills/dflow-team/scripts'), { recursive: true })
      cpSync(join(ROOT, '.claude/skills/dflow-team/scripts/gradle-check.sh'), join(repo, '.claude/skills/dflow-team/scripts/gradle-check.sh'))
      chmodSync(join(repo, '.claude/skills/dflow-team/scripts/gradle-check.sh'), 0o755)

      // NOFILE 케이스
      writeFileSync(join(repo, 'gradlew'), '')
      const frag = extractGradleWarnFragment()
      const script = `MAIN="${repo}"\n${frag}`
      const r = spawnSync('sh', ['-c', script], { cwd: repo, encoding: 'utf8' })
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain('WARN GRADLE_TUNING')
      expect(r.stdout).toContain('gradle.properties 없음')

      // MISSING 케이스 — 경로에 공백이 있어도(${grest% *}/${grest##* } 를 쓴 파싱) 루트를 온전히 뽑는다
      rmSync(join(repo, 'gradlew'))
      const spaced = join(repo, 'has space')
      mkdirSync(spaced)
      writeFileSync(join(spaced, 'gradlew'), '')
      writeFileSync(join(spaced, 'gradle.properties'), 'org.gradle.caching=true\n')
      const script2 = `MAIN="${repo}"\n${frag}`
      const r2 = spawnSync('sh', ['-c', script2], { cwd: repo, encoding: 'utf8' })
      expect(r2.status, r2.stderr).toBe(0)
      expect(r2.stdout).toContain(`WARN GRADLE_TUNING ${spaced} `)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('precheck.md 에 WARN GRADLE_TUNING 처리 안내가 있다', () => {
    const doc = readFileSync(join(ROOT, '.claude/skills/dflow-team/references/precheck.md'), 'utf8')
    expect(doc).toContain('WARN GRADLE_TUNING')
    expect(doc).toContain('시작을 막지 않는다')
  })

  it('SKILL.md 참조 표에 precheck.md 가 WARN 때도 읽는 문서로 올라 있다', () => {
    const skill = readFileSync(join(ROOT, '.claude/skills/dflow-team/SKILL.md'), 'utf8')
    expect(skill).toMatch(/references\/precheck\.md.*WARN GRADLE_TUNING/)
  })
})

describe('kit-build.sh — kit/gradle 원본을 킷에 싣는다', () => {
  it('kit-build.sh 가 dflow-test-jvm.gradle 을 $OUT/gradle 로 복사한다', () => {
    const kb = readFileSync(join(ROOT, 'scripts/kit-build.sh'), 'utf8')
    expect(kb).toContain('kit/gradle/dflow-test-jvm.gradle')
    expect(kb).toContain('$OUT/gradle')
  })
})

describe('kit/README.md — Gradle 권장 설정 절', () => {
  it('두 층(리포 설정·--gradle-pc)과 단독 모드·되돌리는 법을 설명한다', () => {
    const readme = readFileSync(join(ROOT, 'kit/README.md'), 'utf8')
    expect(readme).toMatch(/^## Gradle 권장 설정$/m)
    expect(readme).toContain('--gradle-pc')
    expect(readme).toContain('되돌리는 법')
    expect(readme).toContain('org.gradle.caching=true')
    expect(readme).toContain('심링크')
  })
})
