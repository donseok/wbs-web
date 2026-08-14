import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/0085_ai_document_chunks_embedding_guard.sql', import.meta.url), 'utf8')
const rollback = readFileSync(
  new URL('../../supabase/migrations/0085_ai_document_chunks_embedding_guard_rollback.sql', import.meta.url), 'utf8')

describe('0085 임베딩 클로버 방지 마이그레이션 계약', () => {
  it('replace_ai_document_chunks 를 create or replace 로 고친다(0031 재정의)', () => {
    expect(migration).toMatch(/create or replace function public\.replace_ai_document_chunks/i)
  })

  it('새 임베딩이 null 이고 content_hash 가 그대로면 기존 embedding 을 지킨다', () => {
    expect(migration).toMatch(
      /when excluded\.embedding is null and ai_documents\.content_hash = excluded\.content_hash/i,
    )
    expect(migration).toMatch(/then ai_documents\.embedding/i)
  })

  it('content_hash 가 바뀌면(본문 변경) null 로 덮어쓴다 — 옛 임베딩을 새 본문에 붙이지 않는다', () => {
    expect(migration).toMatch(/else excluded\.embedding\s*\n?\s*end/i)
  })

  it('advisory lock·chunk 연속성 검증·꼬리 삭제 등 0031 의 나머지 계약은 그대로 유지한다', () => {
    expect(migration).toMatch(/pg_advisory_xact_lock/i)
    expect(migration).toMatch(/AI_DOCUMENT_CHUNKS_NON_CONTIGUOUS/)
    expect(migration).toMatch(/chunk_no >= v_count/i)
  })

  it('service_role 외 실행 권한을 주지 않는다', () => {
    expect(migration).toMatch(
      /revoke all on function public\.replace_ai_document_chunks\([\s\S]*?\) from public, anon, authenticated/i,
    )
    expect(migration).toMatch(
      /grant execute on function public\.replace_ai_document_chunks\([\s\S]*?\) to service_role/i,
    )
  })

  it('롤백은 함수를 0031 판본으로 되돌릴 뿐(null 보호 제거) truncate/drop table 은 하지 않는다', () => {
    expect(rollback).toMatch(/create or replace function public\.replace_ai_document_chunks/i)
    expect(rollback).not.toMatch(
      /when excluded\.embedding is null and ai_documents\.content_hash = excluded\.content_hash/i,
    )
    // 함수 안의 delete는 0031부터 있던 같은 엔티티 꼬리 청크 정리(chunk_no >= v_count로 스코프됨)라
    // 마이그레이션 롤백에 의한 데이터 소실이 아니다 — truncate/drop table만 금지 대상이다.
    expect(rollback).not.toMatch(/truncate|drop table/i)
  })
})
