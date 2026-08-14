import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../../src/lib/ai/index/backfill.ts', import.meta.url), 'utf8')

describe('회의록 백필 스코프 — 로더와 같은 규칙을 써야 한다', () => {
  it('열거자가 minutes.project_id 를 읽는다', () => {
    const spec = source.match(/minutes:\s*\{[^}]*\}/)?.[0] ?? ''
    expect(spec).toContain('project_id')
    // meetings 역참조만 있고 자체 컬럼이 없으면 job.projectId 가 null 로 큐잉된다
    expect(spec).not.toMatch(/columns:\s*'id, updated_at, created_at, meetings\(project_id\)'/)
  })

  it('project_id 우선, 없으면 meetings 역참조로 떨어진다 — content.ts:284 와 동일', () => {
    expect(source).toMatch(/row\.project_id[\s\S]{0,80}nestedProjectId\(row\.meetings\)/)
  })
})
