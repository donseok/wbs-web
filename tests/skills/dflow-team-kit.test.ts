// tests/skills/dflow-team-kit.test.ts
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd() // vitest 는 리포 루트에서 돈다(기존 tests/ 관례)

// install.sh 를 실제로 돌리기 위한 최소 가짜 KIT_DIR. kit/skills/ 는 빌드 산출물이라 소스 리포에는 없으므로
// install.sh 가 참조하는 것만 골라 조립한다(.claude/skills/dflow-* 전부가 아니라 install.sh 가 실제로 쓰는
// dflow-work·dflow-poll 만 — dflow-poll 은 install.sh 가 poll.sh 를 chmod +x 하기 때문에 있어야 한다).
function buildFakeKit(): string {
  const kit = mkdtempSync(join(tmpdir(), 'dflow-fake-kit-'))
  cpSync(join(ROOT, 'kit/install.sh'), join(kit, 'install.sh'))
  chmodSync(join(kit, 'install.sh'), 0o755)
  cpSync(join(ROOT, 'kit/worker-allow.json'), join(kit, 'worker-allow.json'))
  mkdirSync(join(kit, 'skills'), { recursive: true })
  cpSync(join(ROOT, '.claude/skills/dflow-work'), join(kit, 'skills/dflow-work'), { recursive: true })
  cpSync(join(ROOT, '.claude/skills/dflow-poll'), join(kit, 'skills/dflow-poll'), { recursive: true })
  return kit
}

// gh·curl·python3 스텁 — 이 PC 에 실제로 있는지와 무관하게 의존 점검을 통과시킨다. git·jq 는 실제 바이너리를 쓴다.
function buildStubBin(): string {
  const bin = mkdtempSync(join(tmpdir(), 'dflow-stub-bin-'))
  for (const name of ['gh', 'curl', 'python3']) {
    const p = join(bin, name)
    writeFileSync(p, '#!/bin/sh\nexit 0\n')
    chmodSync(p, 0o755)
  }
  return bin
}

function runInstall(target: string) {
  const kit = buildFakeKit()
  const bin = buildStubBin()
  try {
    return spawnSync('sh', [join(kit, 'install.sh'), target], {
      encoding: 'utf8',
      env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'dflow-fake-home-')), PATH: `${bin}:${process.env.PATH ?? ''}` },
    })
  } finally {
    rmSync(kit, { recursive: true, force: true })
    rmSync(bin, { recursive: true, force: true })
  }
}

describe('dflow-team 배포·권한 준비(스펙 §8·§10)와 가이드(스펙 §11-1)', () => {
  it('kit-build.sh 배포 목록에 dflow-team 이 있고 권한 목록 파일을 킷에 싣는다', () => {
    const kit = readFileSync(join(ROOT, 'scripts/kit-build.sh'), 'utf8')
    expect(kit).toMatch(/^SKILLS=".*\bdflow-team\b.*"$/m)
    expect(kit).toContain('cp "$ROOT/kit/worker-allow.json" "$OUT/worker-allow.json"')
  })

  it('install.sh 안내와 킷 README 표에 dflow-team 이 있다', () => {
    expect(readFileSync(join(ROOT, 'kit/install.sh'), 'utf8')).toMatch(/설치 완료: .*dflow-team/)
    expect(readFileSync(join(ROOT, 'kit/README.md'), 'utf8')).toMatch(/^\| dflow-team \|/m)
  })

  it('install.sh 는 .dflow·.dflow.local 초안을 만들고 .dflow.local 을 gitignore 에 넣는다', () => {
    const t = readFileSync(join(ROOT, 'kit/install.sh'), 'utf8')
    expect(t).toContain('.dflow.local')
    expect(t).toContain('dflow.local.example')
    expect(t).not.toContain('.env.example')
    expect(readFileSync(join(ROOT, 'scripts/kit-build.sh'), 'utf8')).not.toContain('.env.example')
  })

  it('레거시 대상(.env 에 DFLOW_* 가 있고 .dflow·.dflow.local 이 없음)은 초안을 만들지 않고 안내만 한다', () => {
    const target = mkdtempSync(join(tmpdir(), 'dflow-legacy-target-'))
    try {
      writeFileSync(join(target, '.env'), 'export DFLOW_API_BASE=https://example.invalid\nDFLOW_PATS=x\n')
      const r = runInstall(target)
      expect(r.status, r.stderr).toBe(0)
      expect(existsSync(join(target, '.dflow'))).toBe(false)
      expect(existsSync(join(target, '.dflow.local'))).toBe(false)
      expect(readFileSync(join(target, '.gitignore'), 'utf8')).toContain('.dflow.local')
      expect(r.stdout).toContain('레거시 모드로 남긴다')
      expect(r.stdout).toContain('dflow.example')
      expect(r.stdout).toContain('dflow.local.example')
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
  })

  it('새 대상(.env 없음)은 .dflow·.dflow.local 초안을 둘 다 만든다', () => {
    const target = mkdtempSync(join(tmpdir(), 'dflow-fresh-target-'))
    try {
      const r = runInstall(target)
      expect(r.status, r.stderr).toBe(0)
      expect(existsSync(join(target, '.dflow'))).toBe(true)
      expect(existsSync(join(target, '.dflow.local'))).toBe(true)
      expect(readFileSync(join(target, '.gitignore'), 'utf8')).toContain('.dflow.local')
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
  })

  it('worker-allow.json 은 권한 규칙 문자열 배열이고 git 규칙은 넣지 않는다', () => {
    const j = JSON.parse(readFileSync(join(ROOT, 'kit/worker-allow.json'), 'utf8'))
    expect(Array.isArray(j.allow)).toBe(true)
    // 목록은 리허설 결과대로 비어 있을 수 있다(Task 9: 권한 프롬프트 0건). 표본 하나로 형태 검사가 실제로 돌게 한다
    for (const r of [...j.allow, 'Bash(npm test)']) {
      expect(r).toMatch(/^[A-Za-z]+\(.+\)$/)
      expect(r).not.toMatch(/git /)
    }
  })

  it('install.sh 가 git 절대경로 규칙과 목록을 settings.json permissions.allow 에 합친다', () => {
    const sh = readFileSync(join(ROOT, 'kit/install.sh'), 'utf8')
    expect(sh).toContain('GIT_ABS=$(command -v git)')
    expect(sh).toContain('--slurpfile add "$KIT_DIR/worker-allow.json"')
    expect(sh).not.toContain('agent-team')
    expect(sh).toContain('.permissions.allow = (((.permissions.allow // []) + [$git] + $add[0].allow) | unique)')
  })

  it('가이드에 dflow-team 절과 공지 두 줄(원격 후보 확대, 수동 poll 승인 감지 한계)이 있다', () => {
    const g = readFileSync(join(ROOT, 'docs/agent/claude-skill/dflow-skills-guide.md'), 'utf8')
    expect(g).toContain('## dflow-team: 위임한 작업 여러 건을 동시에')
    expect(g).toContain('인자 없이 부르면 원격 `origin/agent/*` 브랜치까지 후보로 본다')
    expect(g).toContain('승인 감지는 지금 작업트리의 state.json 만 본다')
    expect(g).not.toContain('--team-size')
  })

  it('F1: kit-build.sh 가 .gitattributes 를 복사하고, 킷·설치 대상 모두 스킬 줄끝을 LF 로 고정하며, dflow.sh·heartbeat.sh 가 .env 값의 CR 을 걷어내고, README 에 Windows 절이 있다', () => {
    const kit = readFileSync(join(ROOT, 'scripts/kit-build.sh'), 'utf8')
    expect(kit).toContain('cp "$ROOT/kit/.gitattributes" "$OUT/.gitattributes"')

    expect(readFileSync(join(ROOT, 'kit/.gitattributes'), 'utf8')).toContain('* text=auto eol=lf')

    const inst = readFileSync(join(ROOT, 'kit/install.sh'), 'utf8')
    expect(inst).toContain('.claude/skills/** text eol=lf')
    expect(inst).toContain('git add --renormalize .')

    const hb = readFileSync(join(ROOT, 'kit/hooks/heartbeat.sh'), 'utf8')
    // 토큰 목록 전체(_all)와 키 선택 값(_as)에서 CR 을 걷어낸다 — 고르기 전에 걷어야 prefix 비교가 맞는다
    expect(hb).toContain(`_base=$(printf '%s' "$_base" | tr -d '\\r'); _all=$(printf '%s' "$_all" | tr -d '\\r')`)
    expect(hb).toContain(`_as=$(printf '%s' "\${DFLOW_AS:-}" | tr -d '\\r')`)

    const dflow = readFileSync(join(ROOT, '.claude/skills/dflow-work/scripts/dflow.sh'), 'utf8')
    expect(dflow).toContain("_cr=$(printf '\\r')")
    expect(dflow).toContain('for _v in DFLOW_API_BASE DFLOW_PATS DFLOW_PAT DFLOW_PROJECT_ID DFLOW_PROJECT_MAP DFLOW_AS DFLOW_DEV_BRANCH DFLOW_RELEASE_BRANCH DFLOW_AUTOMERGE; do')
    expect(dflow).toContain(`tr -d '\\\\r'`)

    expect(readFileSync(join(ROOT, 'kit/README.md'), 'utf8')).toMatch(/^## Windows\(Git Bash\)$/m)
  })

  it('F1: dflow.sh doctor 는 CRLF .env 를 읽어도 \\r 없는 출력을 내고 토큰 미설정으로 종료한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dflow-crlf-'))
    const envFile = join(dir, 'env-crlf')
    try {
      writeFileSync(envFile, 'DFLOW_API_BASE=https://example.invalid\r\nDFLOW_PATS=\r\n')
      const r = spawnSync('sh', [join(ROOT, '.claude/skills/dflow-work/scripts/dflow.sh'), 'doctor'], {
        env: { ...process.env, DFLOW_ENV_FILE: envFile, DFLOW_PATS: '', DFLOW_PAT: '', DFLOW_CONFIG_DIR: '/nonexistent-dflow-config' },
        encoding: 'utf8',
      })
      expect(r.stdout).not.toContain('\r')
      expect(r.stdout).toContain('base: https://example.invalid')
      expect(r.status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
