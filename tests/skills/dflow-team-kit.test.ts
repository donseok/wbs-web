// tests/skills/dflow-team-kit.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd() // vitest 는 리포 루트에서 돈다(기존 tests/ 관례)

describe('dflow-team 배포·권한 준비(스펙 §8·§10)와 가이드(스펙 §11-1)', () => {
  it('kit-build.sh 배포 목록에 dflow-team 이 있고 권한 목록 파일을 킷에 싣는다', () => {
    const kit = readFileSync(join(ROOT, 'scripts/kit-build.sh'), 'utf8')
    expect(kit).toMatch(/^SKILLS=".*\bdflow-team\b.*"$/m)
    expect(kit).toContain('cp "$ROOT/kit/agent-team-allow.json" "$OUT/agent-team-allow.json"')
  })

  it('install.sh 안내와 킷 README 표에 dflow-team 이 있다', () => {
    expect(readFileSync(join(ROOT, 'kit/install.sh'), 'utf8')).toMatch(/설치 완료: .*dflow-team/)
    expect(readFileSync(join(ROOT, 'kit/README.md'), 'utf8')).toMatch(/^\| dflow-team \|/m)
  })

  it('agent-team-allow.json 은 권한 규칙 문자열 배열이고 git 규칙은 넣지 않는다', () => {
    const j = JSON.parse(readFileSync(join(ROOT, 'kit/agent-team-allow.json'), 'utf8'))
    expect(Array.isArray(j.allow)).toBe(true)
    for (const r of j.allow) {
      expect(r).toMatch(/^[A-Za-z]+\(.+\)$/)
      expect(r).not.toMatch(/git /)
    }
  })

  it('install.sh 가 git 절대경로 규칙과 목록을 settings.json permissions.allow 에 합친다', () => {
    const sh = readFileSync(join(ROOT, 'kit/install.sh'), 'utf8')
    expect(sh).toContain('GIT_ABS=$(command -v git)')
    expect(sh).toContain('--slurpfile add "$KIT_DIR/agent-team-allow.json"')
    expect(sh).toContain('.permissions.allow = (((.permissions.allow // []) + [$git] + $add[0].allow) | unique)')
  })

  it('가이드에 dflow-team 절과 공지 두 줄(원격 후보 확대, 수동 poll 승인 감지 한계)이 있다', () => {
    const g = readFileSync(join(ROOT, 'docs/agent/claude-skill/dflow-skills-guide.md'), 'utf8')
    expect(g).toContain('## dflow-team: 위임한 작업 여러 건을 동시에')
    expect(g).toContain('인자 없이 부르면 원격 `origin/agent/*` 브랜치까지 후보로 본다')
    expect(g).toContain('승인 감지는 지금 작업트리의 state.json 만 본다')
    expect(g).not.toContain('--team-size')
  })
})
