import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/0048_wiki_curation.sql', import.meta.url),
  'utf8',
)
const rollback = readFileSync(
  new URL('../../supabase/migrations/0048_wiki_curation_rollback.sql', import.meta.url),
  'utf8',
)

describe('0048 Wiki 큐레이션 migration 계약', () => {
  it('테이블 쓰기 정책을 열지 않고 검증된 RPC로만 사람 개입을 허용한다', () => {
    // 0045의 "쓰기 정책 없음 = service_role 전용"을 유지해야 REST 직접 호출로
    // 임의 lifecycle/statement를 주입할 수 없다.
    expect(migration).not.toMatch(/create policy[\s\S]*on public\.wiki_items/)
    expect(migration).not.toMatch(/grant\s+(insert|update|delete)[\s\S]*wiki_items/)
    expect(migration).toContain('security definer')
    expect(migration).toContain('grant execute on function public.curate_wiki_item(uuid, text, text) to authenticated')
  })

  it('세션과 역할을 DB에서 다시 확인한다 — 앱 게이트만 믿지 않는다', () => {
    expect(migration).toMatch(/v_actor is null or public\.app_role\(\) is null[\s\S]*WIKI_CURATE_FORBIDDEN/)
    expect(migration).toMatch(/public\.app_role\(\) <> 'pmo_admin'[\s\S]*WIKI_MERGE_FORBIDDEN/)
  })

  it('허용된 동작만 수행하고 문장 수정 경로는 만들지 않는다', () => {
    expect(migration).toContain(
      "p_action not in ('resolve','reopen','archive','restore','lock','unlock','confirm')",
    )
    // statement를 바꾸면 "모든 지식은 원문 블록으로 추적된다"는 계약이 깨진다.
    expect(migration).not.toMatch(/update public\.wiki_items[\s\S]{0,200}set statement\s*=/)
  })

  it('숨김은 근거를 지우지 않고 lifecycle만 내린다', () => {
    expect(migration).not.toMatch(/delete from public\.wiki_item_sources/)
    expect(migration).toMatch(/p_action = 'archive'[\s\S]*lifecycle_state = 'archived'/)
  })

  it('충돌 확정은 이후 AI가 다시 덮지 못하게 함께 고정한다', () => {
    expect(migration).toMatch(/p_action = 'confirm'[\s\S]*auto_update_locked = true/)
  })

  it('모든 큐레이션은 actor와 함께 변경 이력에 남는다', () => {
    expect(migration).toContain('add column if not exists actor_id uuid')
    expect(migration).toMatch(/insert into public\.wiki_change_events[\s\S]*'curate'[\s\S]*v_actor/)
    expect(migration).toContain("'new','reaffirm','refine','supersede','reverse','conflict','resolve','retract','curate'")
  })

  it('주제 병합은 knowledge_key까지 정본으로 옮기고 중복 current는 상충으로 보존한다', () => {
    expect(migration).toContain('knowledge_key = left(')
    expect(migration).toContain('wiki_key_slug')
    expect(migration).toMatch(/row_number\(\) over \([\s\S]*partition by w\.kind, w\.knowledge_key/)
    expect(migration).toMatch(/set lifecycle_state = 'conflicted'[\s\S]*ranked\.rn > 1/)
    // 병합은 항목을 지우지 않는다 — 삭제 대상은 비워진 원본 주제 행뿐이다.
    expect(migration).not.toMatch(/delete from public\.wiki_items/)
    expect(migration).toContain('delete from public.wiki_topics where id = p_source_topic_id')
  })

  it('교착을 피하려고 두 주제를 항상 같은 순서로 잠근다', () => {
    expect(migration).toMatch(/for update/)
    expect(migration).toMatch(/order by id\s+for update/)
  })

  it('롤백은 RPC와 CHECK를 되돌리고 운영 데이터 손실 조건을 명시한다', () => {
    expect(rollback).toContain('drop function if exists public.curate_wiki_item(uuid, text, text)')
    expect(rollback).toContain('drop function if exists public.merge_wiki_topics(uuid, uuid)')
    expect(rollback).toMatch(/'new','reaffirm','refine','supersede','reverse','conflict','resolve','retract'\s*\n?\s*\)\)/)
    expect(rollback).toContain('사람이 남긴 정리 이력이 사라진다')
  })
})
