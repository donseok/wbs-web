// .dflow·.dflow.local 문서 전환 — 나머지 스킬 문서(Task 6). docs/superpowers/specs/2026-09-23-dflow-config-design.md
import { describe, expect, it } from 'vitest'
import { devAll } from './_dflow-dev'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const DEV = devAll()
const MERGE = read('.claude/skills/dflow-merge/SKILL.md')
describe('나머지 스킬 문서', () => {
  it('dflow-dev·dflow-merge 가 <기본브랜치> 를 개발 브랜치로 정의한다', () => {
    expect(DEV + read('.claude/skills/dflow-dev/references/worker-mode.md')).toContain('`<기본브랜치>` 는 개발 브랜치, 즉 `dflow.mjs branch dev` 의 값이다')
    expect(MERGE).toContain('`<기본브랜치>` = 개발 branch = `dflow.mjs branch dev` 값')
    expect(MERGE).not.toContain('기본브랜치(main)')
  })
  it('dflow-merge 는 api_base 를 dflow.sh config 로 얻는다', () => {
    expect(read('.claude/skills/dflow-merge/references/sweep-scan.md')).toContain('api=$(node .claude/skills/dflow-work/scripts/dflow.mjs config api_base)')
    expect(MERGE).not.toMatch(/\.\s+\.\/\.env/)
  })
  it('바인딩 안내가 .dflow·.dflow.local 을 가리킨다', () => {
    for (const p of ['dflow-dev/SKILL.md', 'dflow-wbs/SKILL.md', 'dflow-export/SKILL.md', 'dflow-work/SKILL.md'])
      expect(p === 'dflow-dev/SKILL.md' ? DEV : read(`.claude/skills/${p}`), p).toContain('project_map')
  })
})
