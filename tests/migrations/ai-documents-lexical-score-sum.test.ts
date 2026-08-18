import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/0086_ai_documents_lexical_score_sum.sql', import.meta.url), 'utf8')
const rollback = readFileSync(
  new URL('../../supabase/migrations/0086_ai_documents_lexical_score_sum_rollback.sql', import.meta.url), 'utf8')

/** 설명용 `-- ...` 줄 주석을 걷어낸다 — 마이그레이션 본문이 이전 판본(max)을 설명하려고
 * 주석에서 인용하는 것과, 실행되는 SQL 이 실제로 그 함수를 쓰는 것을 구분해야 한다. */
function stripLineComments(sql: string): string {
  return sql.split('\n').map(line => line.replace(/--.*$/, '')).join('\n')
}
const migrationCode = stripLineComments(migration)
const rollbackCode = stripLineComments(rollback)

describe('0086 어휘 점수 sum 전환 마이그레이션 계약', () => {
  it('점수식이 sum(...) over(partition by d.id) 다 — max(...) 는 없어야 한다', () => {
    expect(migrationCode).toMatch(/sum\(greatest\(\s*word_similarity\(t, d\.title\),\s*word_similarity\(t, d\.content\)\s*\)\)\s*over\s*\(partition by d\.id\)/i)
    expect(migrationCode).not.toMatch(/max\(greatest\(/i)
  })

  it('프로젝트 스코프가 NULL 일 때 전체 허용으로 새지 않는다(0083/0084 와 동일 계약)', () => {
    expect(migration).toMatch(/p_project_ids is not null and d\.project_id = any\(p_project_ids\)/i)
    expect(migration).toMatch(/p_include_global and d\.project_id is null/i)
  })

  it('바깥 정렬의 첫 키가 similarity desc 다 — 누적 점수가 실제로 순위에 반영된다', () => {
    expect(migration).toMatch(/order by s\.similarity desc, s\.occurred_on desc nulls last/i)
  })

  it('안쪽은 distinct on (d.id) 로 문서당 한 행만 낸다(0084 와 동일)', () => {
    expect(migration).toMatch(/select distinct on \(d\.id\)/i)
  })

  it('결과 상한을 서버에서 강제한다 — LIMIT NULL 방지', () => {
    expect(migration).toMatch(/least\(coalesce\(match_count/i)
  })

  it('anon 에게 실행 권한을 주지 않는다', () => {
    expect(migration).toMatch(/revoke all on function[\s\S]*from public, anon/i)
  })

  it('롤백은 max(...) 판본(0084)으로 되돌릴 뿐 sum 은 남기지 않고, 데이터는 지우지 않는다', () => {
    expect(rollbackCode).toMatch(/max\(greatest\(/i)
    expect(rollbackCode).not.toMatch(/sum\(greatest\(/i)
    expect(rollback).not.toMatch(/delete from|truncate|drop table/i)
  })
})
