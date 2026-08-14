import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('0084 마이그레이션 — 어휘 검색 토큰 배열화', () => {
  const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
  const forward = readFileSync(join(migrationsDir, '0084_ai_documents_lexical_tokens.sql'), 'utf8')
  const rollback = readFileSync(join(migrationsDir, '0084_ai_documents_lexical_tokens_rollback.sql'), 'utf8')

  it('p_tokens text[] 시그니처를 정의한다', () => {
    expect(forward).toContain('p_tokens text[]')
    expect(forward).toContain('match_count int default 20')
    expect(forward).not.toContain('p_query text')
  })

  it('unnest join 으로 토큰을 바깥에서 매칭한다', () => {
    // GIN 인덱스를 타려면 unnest가 바깥에 있어야 함
    expect(forward).toContain('from unnest(')
    expect(forward).toContain('join public.ai_documents d')
    // word_similarity 는 각 토큰마다 계산
    expect(forward).toContain('word_similarity(t, d.title)')
    expect(forward).toContain('word_similarity(t, d.content)')
  })

  it('토큰 상한과 빈 배열 가드를 넣는다', () => {
    // 상한 8개
    expect(forward).toContain('p_tokens[1:8]')
    // 빈 배열 가드
    expect(forward).toContain('array_length(p_tokens, 1) > 0')
  })

  it('스코프 격리 where 절을 유지한다', () => {
    // NULL/빈 스코프는 "전 프로젝트" 가 아님
    expect(forward).toContain('p_project_ids is not null and d.project_id = any(p_project_ids)')
    expect(forward).toContain('p_include_global and d.project_id is null')
  })

  it('반환 컬럼은 0083 과 동일 19개다', () => {
    const columns = [
      'd.id', 'd.project_id', 'd.domain', 'd.entity_type', 'd.entity_id', 'd.chunk_no',
      'd.index_version', 'd.title', 'd.content', 'd.content_hash', 'd.href', 'd.team',
      'd.occurred_on', 'd.source_updated_at', 'd.embedding_model', 'd.embedding_dimensions',
      'd.chunker_version', 'd.indexed_at', 'similarity',
    ]
    for (const col of columns) {
      expect(forward).toContain(col)
    }
  })

  it('GIN 인덱스를 탈 수 있도록 <% 연산자를 사용한다', () => {
    expect(forward).toContain('t <% d.title')
    expect(forward).toContain('t <% d.content')
  })

  it('anon 을 revoke 하고 authenticated/service_role 에만 grant 한다', () => {
    expect(forward).toContain('revoke all on function public.match_ai_documents_lexical')
    expect(forward).toContain('from public, anon')
    expect(forward).toContain('grant execute on function public.match_ai_documents_lexical')
    expect(forward).toContain('to authenticated, service_role')
  })

  it('롤백은 0083 의 p_query 판본을 복원한다', () => {
    expect(rollback).toContain('p_query text')
    expect(rollback).not.toContain('p_tokens text[]')
    // 0083 스타일 word_similarity 단일 호출
    expect(rollback).toContain('word_similarity(p_query, d.title)')
    expect(rollback).toContain('word_similarity(p_query, d.content)')
    // 0083 스타일 from 절
    expect(rollback).toContain('from public.ai_documents d')
    expect(rollback).not.toContain('from unnest(')
  })
})
