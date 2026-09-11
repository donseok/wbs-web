// tests/skills/dflow-team.test.ts
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd() // vitest 는 리포 루트에서 돈다(기존 tests/ 관례)
const SKILL_DIR = join(ROOT, '.claude', 'skills', 'dflow-team')
const read = (rel: string) => readFileSync(join(SKILL_DIR, rel), 'utf8')

const PLACEHOLDERS = ['{TSK}', '{ID8}', '{AGENT_ID}', '{MAIN_CHECKOUT}', '{BACKEND}', '{MODEL_FLAG}', '{ANSWER}']

describe('dflow-team worker-prompt.md 계약(스펙 §5)', () => {
  const p = () => read('references/worker-prompt.md')

  it('치환 변수 일곱 개와 포인터 키를 표로 설명하고 AGENT_ID 는 신원/host/slot 이다', () => {
    expect(existsSync(join(SKILL_DIR, 'references/worker-prompt.md'))).toBe(true)
    for (const v of PLACEHOLDERS) expect(p(), v).toContain('`' + v + '`')
    for (const k of ['TSK', 'ID8', 'AGENT_ID', 'MAIN_CHECKOUT', 'BACKEND', 'MODEL', 'ANSWER']) {
      expect(p(), k).toContain('| `' + k + '` |')
    }
    expect(p()).toContain('`<신원>/<host>/w<slot>`')
  })

  it('git 은 절대경로로 부르고, 격리는 git-dir 과 git-common-dir 의 물리 경로로 확인한다', () => {
    expect(p()).toContain('command -v git')
    expect(p()).toContain('bare `git` 금지')
    expect(p()).toContain('_gd=$(cd "$(git rev-parse --git-dir)" && pwd -P)')
    expect(p()).toContain('_cd=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)')
    expect(p()).toContain('[ "$_gd" != "$_cd" ] || { echo "NOT_ISOLATED"; exit 1; }')
    expect(p()).toContain('{TSK} {ID8} - - - failed not-isolated')
    expect(p()).toContain('**아무 파일도 쓰지 않고**')
    expect(p()).not.toContain('show-toplevel')
  })

  it('.dflow-agent 는 격리 확인 직후, 부트스트랩 전에 워크트리 루트에 쓴다', () => {
    const t = p()
    const iso = t.indexOf('NOT_ISOLATED')
    const seat = t.indexOf("printf '%s\\n' '{AGENT_ID}' > .dflow-agent")
    const boot = t.indexOf('ln -s {MAIN_CHECKOUT}/.env .env')
    expect(iso).toBeGreaterThan(-1)
    expect(seat).toBeGreaterThan(iso)
    expect(boot).toBeGreaterThan(seat)
    expect(t).not.toMatch(/docs\/tasks\/\{TSK\}\/\.dflow-agent/)
  })

  it('부트스트랩은 .env·스킬을 링크하고 인증 확인 뒤 origin/<기본브랜치> 로 detach 하며 --worker 를 확인한다', () => {
    expect(p()).toContain('[ -e .env ] || ln -s {MAIN_CHECKOUT}/.env .env')
    expect(p()).toContain('if [ -d .claude/skills ] && [ ! -L .claude/skills ]; then')
    expect(p()).toContain('[ -e ".claude/skills/$s" ] || ln -s "{MAIN_CHECKOUT}/.claude/skills/$s" ".claude/skills/$s"')
    expect(p()).toContain('mkdir -p .claude && ln -s {MAIN_CHECKOUT}/.claude/skills .claude/skills')
    expect(p()).toContain('set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor; echo "doctor=$?"')
    expect(p()).toContain('git fetch origin && git switch --detach origin/<기본브랜치>')
    expect(p()).toContain('symbolic-ref --short refs/remotes/origin/HEAD')
    expect(p()).toContain('git ls-remote --symref origin HEAD')
    expect(p()).toContain("grep -q -- '--worker' .claude/skills/dflow-dev/SKILL.md || echo NO_WORKER_FLAG")
  })

  it('인증은 doctor 종료 코드가 아니라 me 로 판정하고, 의존성은 설치하지 않는다(/dflow-dev 행 H 가 한다)', () => {
    expect(p()).toContain('dflow.sh me >/dev/null || echo AUTH_FAILED')
    expect(p()).toContain('{TSK} {ID8} - - - failed auth')
    expect(p()).toContain('{TSK} {ID8} - - - failed doctor-<exit>')
    expect(p()).toContain('{TSK} {ID8} - - - failed no-skill')
    expect(p()).toContain('{TSK} {ID8} - - - failed detach')
    expect(p()).toContain('「--worker」 H')
    expect(p()).not.toContain('npm ci')
    expect(p().indexOf('AUTH_FAILED')).toBeLessThan(p().indexOf('git switch --detach origin/<기본브랜치>'))
  })

  it('ANSWER 재spawn 은 fetch 뒤 기존 agent 브랜치로 옮기고 결정을 design.md 에 남기며, 의존성은 재개 직후 행 H 가 깐다', () => {
    expect(p()).toContain('git fetch origin\n  git branch -r --list \'origin/agent/{ID8}-*\'')
    expect(p()).toContain('- 담당자 결정(blocked 응답): {ANSWER}')
    expect(p()).toContain('재개로 agent 브랜치에 들어온 직후 설치한다(「--worker」 H)')
  })

  it('/dflow-dev --worker 로 실행하고 Skill 미등록이면 SKILL.md 를 직접 따른다', () => {
    expect(p()).toContain('/dflow-dev {ID8} --worker {MODEL_FLAG}')
    expect(p()).toContain('`.claude/skills/dflow-dev/SKILL.md` 를 Read 해서')
  })

  it('서버 쓰기는 {ID8} 하나뿐이고 list 를 부르지 않는다', () => {
    expect(p()).toContain('`list` 는 호출하지 않는다')
    expect(p()).toContain('`show {ID8}` 뿐이다')
  })

  it('.result 한 줄 형식, status 다섯, skipped 사유와 failed 구분 사유 넷을 담는다', () => {
    expect(p()).toMatch(/^\{TSK\} \{ID8\} <branch\|-> <head_sha\|-> <done_exit\|-> <status> <한 줄 사유 또는 질문>$/m)
    for (const s of ['done', 'skipped', 'needs-merge', 'blocked', 'failed']) expect(p(), s).toContain('| `' + s + '` |')
    for (const r of ['`선행 미승인`', '`선행 승인 대기`', '`선행을 모두 조상으로 갖는 기점 없음`', '`spec 부재`', '`claim-exit-4`']) {
      expect(p(), r).toContain(r)
    }
    for (const r of ['`rate-limit`', '`not-isolated`', '`no-worker-flag`', '`deps`']) expect(p(), r).toContain(r)
    expect(p()).toContain('docs/tasks/{TSK}/.result')
  })

  it('blocked 는 커밋·push 뒤 쓰고 이후 동작을 BACKEND 두 값으로 가른다', () => {
    expect(p()).toContain('AskUserQuestion 을 쓰지 않는다')
    expect(p()).toContain('현재 산출물을 커밋·push 한 뒤')
    expect(p()).toMatch(/^\| `pane` \|/m)
    expect(p()).toMatch(/^\| `agent-team` \|/m)
  })

  it('기본 브랜치로 switch 하지 않는다(detach 만 한다)', () => {
    expect(p()).not.toMatch(/switch (main|<기본브랜치>|origin\/main)(\s|$)/m)
  })
})
