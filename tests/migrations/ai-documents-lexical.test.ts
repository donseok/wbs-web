import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/0083_ai_documents_lexical.sql', import.meta.url), 'utf8')
const rollback = readFileSync(
  new URL('../../supabase/migrations/0083_ai_documents_lexical_rollback.sql', import.meta.url), 'utf8')

describe('0083 어휘 검색 마이그레이션 계약', () => {
  it('pg_trgm 을 설치한다', () => {
    expect(migration).toMatch(/create extension if not exists pg_trgm/i)
  })

  it('gin_trgm_ops GIN 인덱스를 title 과 content 에 만든다', () => {
    expect(migration).toMatch(/using gin \(title gin_trgm_ops\)/i)
    expect(migration).toMatch(/using gin \(content gin_trgm_ops\)/i)
  })

  it('랭킹에 word_similarity 를 쓴다 — similarity 는 길이 편향이 있다', () => {
    expect(migration).toMatch(/word_similarity/)
  })

  it('결과 상한을 서버에서 강제한다 — LIMIT NULL 방지', () => {
    expect(migration).toMatch(/least\(coalesce\(match_count/i)
  })

  it('anon 에게 실행 권한을 주지 않는다', () => {
    expect(migration).toMatch(/revoke all on function[\s\S]*from public, anon/i)
  })

  it('프로젝트 스코프가 NULL 일 때 전체 허용으로 새지 않는다', () => {
    expect(migration).toMatch(/p_project_ids is not null and d\.project_id = any\(p_project_ids\)/i)
  })

  it('롤백은 인덱스와 함수만 되돌리고 데이터를 지우지 않는다', () => {
    expect(rollback).toMatch(/drop function if exists public\.match_ai_documents_lexical/i)
    expect(rollback).toMatch(/drop index if exists/i)
    expect(rollback).not.toMatch(/delete from|truncate|drop table/i)
  })
})
