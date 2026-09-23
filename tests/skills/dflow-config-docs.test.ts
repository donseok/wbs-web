// .dflow 전환 뒤 스킬 문서가 지켜야 할 계약(docs/superpowers/specs/2026-09-23-dflow-config-design.md §7).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const TEAM = read('.claude/skills/dflow-team/SKILL.md')
const WORKER = read('.claude/skills/dflow-team/references/worker-prompt.md')
const BACKENDS = read('.claude/skills/dflow-team/references/backends.md')

describe('dflow-team 문서', () => {
  it('어느 셸 블록도 .env 를 source 하지 않는다 — dflow.sh 가 스스로 읽는다', () => {
    for (const [n, t] of [['TEAM', TEAM], ['WORKER', WORKER], ['BACKENDS', BACKENDS]]) {
      expect(t, n).not.toMatch(/\.\s+\.\/\.env/)
      expect(t, n).not.toContain('DFLOW_ENV_FILE="<MAIN>/.env"')
    }
  })
  it('전제 검사는 개발 브랜치를 dflow.sh branch dev 로 얻고 원격 존재를 확인한다', () => {
    expect(TEAM).toContain('base=$(.claude/skills/dflow-work/scripts/dflow.sh branch dev)')
    expect(TEAM).toContain('bad "NO_REMOTE_DEV_BRANCH $base"')
    expect(TEAM).not.toContain('base=$(git symbolic-ref --short refs/remotes/origin/HEAD')
  })
  it('poll 은 DFLOW_CONFIG_DIR 로 설정 위치를 받는다', () => {
    expect(TEAM).toContain('DFLOW_CONFIG_DIR="<MAIN>" DFLOW_WATCH=0')
  })
  it('자동 머지는 dflow.sh config automerge 로 읽는다', () => {
    expect(TEAM).toContain('[ "$(.claude/skills/dflow-work/scripts/dflow.sh config automerge)" = 1 ]')
  })
  it('워커에 개발 브랜치를 명시해서 넘기고, 워커는 다시 해석하지 않는다', () => {
    expect(TEAM).toContain('DEV_BRANCH=<개발브랜치>')
    expect(WORKER).toContain('| `{DEV_BRANCH}` | `DEV_BRANCH` |')
    expect(WORKER).toContain('`<기본브랜치>` 는 팀장이 넘긴 `{DEV_BRANCH}` 다')
    expect(WORKER).not.toContain('git symbolic-ref --short refs/remotes/origin/HEAD')
  })
  it('워크트리에는 .dflow.local 을 링크하고(레거시는 .env), 정리 규칙이 그 링크를 부산물로 본다', () => {
    expect(BACKENDS).toContain('ln -s "<MAIN>/.dflow.local" "$WT/.dflow.local"')
    expect(WORKER).toContain('ln -s {MAIN_CHECKOUT}/.dflow.local .dflow.local')
    expect(BACKENDS).toMatch(/\\\.dflow\\\.local/)
  })
  it('키 저장은 새 방식이면 .dflow.local 의 as', () => {
    expect(TEAM).toContain(`printf '\\nas=%s\\n' '<prefix>' >> .dflow.local`)
  })
})
