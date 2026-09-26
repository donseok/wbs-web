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
    for (const t of [DEV, MERGE]) expect(t).toContain('`<기본브랜치>` 는 개발 브랜치, 즉 `dflow.sh branch dev` 의 값이다')
    expect(MERGE).not.toContain('기본브랜치(main)')
  })
  it('dflow-merge 는 api_base 를 dflow.sh config 로 얻는다', () => {
    expect(MERGE).toContain('api=$(.claude/skills/dflow-work/scripts/dflow.sh config api_base)')
    expect(MERGE).not.toMatch(/\.\s+\.\/\.env/)
  })
  it('바인딩 안내가 .dflow·.dflow.local 을 가리킨다', () => {
    for (const p of ['dflow-dev/SKILL.md', 'dflow-wbs/SKILL.md', 'dflow-export/SKILL.md', 'dflow-work/SKILL.md'])
      expect(p === 'dflow-dev/SKILL.md' ? DEV : read(`.claude/skills/${p}`), p).toContain('project_map')
  })
})
