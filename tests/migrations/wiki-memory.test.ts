import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsDir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
const sql = readFileSync(`${migrationsDir}0079_wiki_memory.sql`, 'utf8')
const rollback = readFileSync(`${migrationsDir}0079_wiki_memory_rollback.sql`, 'utf8')

function functionSql(name: string, nextMarker = '\ncreate or replace function public.') {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  expect(start, `${name} 함수가 선언돼야 한다`).toBeGreaterThanOrEqual(0)
  const next = sql.indexOf(nextMarker, start + 1)
  return sql.slice(start, next < 0 ? undefined : next)
}

describe('0079 Wiki Memory migration 계약', () => {
  it('wiki_topics를 문서·트리·검증 모델로 확장하고 타 프로젝트 부모를 FK로 차단한다', () => {
    for (const column of [
      'body_md', 'body_updated_at', 'body_updated_by', 'parent_id', 'sort',
      'pinned_order', 'origin', 'document_kind', 'verified_at', 'verified_by', 'review_due_at',
    ]) {
      expect(sql).toMatch(new RegExp(`add column if not exists ${column}\\b`))
    }
    expect(sql).toContain(
      "'overview','decision','how_to','runbook','faq','glossary','reference'",
    )
    expect(sql).toMatch(
      /foreign key \(parent_id, project_id\)[\s\S]*references public\.wiki_topics \(id, project_id\)/,
    )
    expect(sql).toContain('wiki_topics_project_parent_idx')
    expect(sql).toContain('wiki_topics_project_pinned_idx')
    expect(sql).toContain('wiki_topics_project_review_due_idx')
  })

  it('revision은 복합 FK·순번 unique·불변 트리거를 갖는 append-only 원장이다', () => {
    expect(sql).toContain('create table if not exists public.wiki_topic_revisions')
    expect(sql).toContain('unique (topic_id, version_no)')
    expect(sql).toContain('edited_by_name text')
    expect(sql).toMatch(
      /foreign key \(topic_id, project_id\)[\s\S]*references public\.wiki_topics \(id, project_id\)/,
    )
    expect(sql).toContain('wiki_topic_revisions_immutable_trg')
    expect(sql).toContain("raise exception 'WIKI_REVISION_IMMUTABLE'")
  })

  it('기존 AI 지식을 accepted로 보존하며 자동화 플래그나 cron을 켜지 않는다', () => {
    expect(sql).toMatch(
      /add column if not exists review_state text not null default 'accepted'/,
    )
    expect(sql).toContain("check (review_state in ('pending','accepted','rejected'))")
    expect(sql).not.toMatch(/WIKI_SERVICE_ENABLED\s*=\s*true/i)
    expect(sql).not.toMatch(/WIKI_WORKER_ENABLED\s*=\s*true/i)
    expect(sql).not.toMatch(/create\s+extension.*cron|cron\.schedule/i)
  })

  it('질문·피드백은 프로젝트 복합 FK와 제한된 상태/종류를 쓴다', () => {
    expect(sql).toContain('create table if not exists public.wiki_questions')
    expect(sql).toContain("check (status in ('open','answered','closed'))")
    expect(sql).toMatch(/asked_by\s+uuid default auth\.uid\(\) references auth\.users\(id\) on delete set null/)
    expect(sql).toMatch(
      /constraint wiki_questions_topic_project_fk[\s\S]*foreign key \(topic_id, project_id\)/,
    )
    expect(sql).toContain('create table if not exists public.wiki_feedback')
    expect(sql).toContain("feedback_type  text not null check (feedback_type in ('helpful','outdated'))")
    expect(sql).toContain('unique (topic_id, user_id, feedback_type)')
    expect(sql).toMatch(
      /constraint wiki_feedback_topic_project_fk[\s\S]*foreign key \(topic_id, project_id\)/,
    )
  })

  it('usage_events에 호환 기본값과 object metadata를 더한다', () => {
    expect(sql).toContain("add column if not exists event_name text not null default 'page_view'")
    expect(sql).toContain("add column if not exists metadata jsonb not null default '{}'::jsonb")
    expect(sql).toContain("check (jsonb_typeof(metadata) = 'object')")
    expect(sql).toContain('usage_events_event_name_idx')
  })

  it('기존 사용량·세션 집계는 제품 이벤트를 제외하고 rollback에서 0051 의미로 복원한다', () => {
    for (const name of [
      'usage_summary', 'usage_daily_actives', 'usage_menu_ranking',
      'usage_user_rollup', 'usage_sessions',
    ]) {
      expect(sql).toContain(`create or replace function public.${name}(`)
      expect(rollback).toContain(`create or replace function public.${name}(`)
    }
    expect((sql.match(/event_name = 'page_view'/g) ?? []).length).toBeGreaterThanOrEqual(8)
    expect(rollback).not.toContain("event_name = 'page_view'")
    const restoreAt = rollback.indexOf('create or replace function public.usage_summary')
    const dropColumnAt = rollback.indexOf('drop column if exists event_name')
    expect(restoreAt).toBeGreaterThanOrEqual(0)
    expect(restoreAt).toBeLessThan(dropColumnAt)
  })

  it('새 테이블은 RLS·최소 grant를 적용하고 직접 문서 UPDATE는 열지 않는다', () => {
    for (const table of ['wiki_topic_revisions', 'wiki_questions', 'wiki_feedback']) {
      expect(sql).toContain(`alter table public.${table} enable row level security`)
      expect(sql).toContain(`revoke all on table public.${table} from public, anon, authenticated`)
      expect(sql).toContain(`grant all on table public.${table} to service_role`)
    }
    expect(sql).toContain('grant select on table public.wiki_topic_revisions to authenticated')
    expect(sql).not.toMatch(/grant update[\s\S]{0,180}public\.wiki_topics to authenticated/i)
    expect(sql).not.toMatch(/create policy[\s\S]{0,100}wiki_topics[\s\S]{0,80}for update/i)
  })

  it('문서 생성은 멤버·부모 프로젝트·입력 상한을 확인하고 첫 revision을 원자 삽입한다', () => {
    const fn = functionSql('create_wiki_document')
    expect(fn).toContain('public.is_project_member(p_project_id)')
    expect(fn).toMatch(/parent\.id = v_cursor[\s\S]*parent\.project_id = p_project_id/)
    expect(fn).toContain("raise exception 'WIKI_DOCUMENT_PARENT_INVALID'")
    expect(fn).toContain('v_depth > 2')
    expect(fn).toContain('pg_catalog.pg_advisory_xact_lock')
    expect(fn).toContain('char_length(v_title) > 160')
    expect(fn).toContain('char_length(v_body) > 100000')
    expect(fn).toMatch(/insert into public\.wiki_topics[\s\S]*insert into public\.wiki_topic_revisions/)
    expect(fn).toContain('public.wiki_fnv1a64(v_body)')
    expect(fn).toContain("user_row.raw_user_meta_data ->> 'full_name'")
  })

  it('문서 저장은 잠근 대상 프로젝트로 권한을 판정하고 CAS 뒤 revision을 append한다', () => {
    const fn = functionSql('save_wiki_document')
    expect(fn).toMatch(/where topic\.id = p_topic_id\s+for update/)
    expect(fn).toContain('public.is_project_member(v_topic.project_id)')
    expect(fn).toContain('v_topic.body_updated_at is distinct from p_expected_updated_at')
    expect(fn).toContain("raise exception 'WIKI_DOCUMENT_EDIT_CONFLICT'")
    expect(fn).toContain("raise exception 'WIKI_DOCUMENT_DELETE_FORBIDDEN'")
    expect(fn).toMatch(/insert into public\.wiki_topic_revisions[\s\S]*update public\.wiki_topics/)
    expect(fn).toMatch(/verified_at = null,[\s\S]*review_due_at = null/)
  })

  it('복원은 같은 topic/project revision만 허용하고 과거 행을 수정하지 않고 새 버전을 만든다', () => {
    const fn = functionSql('restore_wiki_document_revision')
    expect(fn).toContain('v_topic.body_updated_at is distinct from p_expected_updated_at')
    expect(fn).toMatch(
      /revision\.id = p_revision_id[\s\S]*revision\.topic_id = p_topic_id[\s\S]*revision\.project_id = v_topic\.project_id/,
    )
    expect(fn).toMatch(/insert into public\.wiki_topic_revisions[\s\S]*update public\.wiki_topics/)
    expect(fn).not.toMatch(/update public\.wiki_topic_revisions/)
    expect(fn).toContain("raise exception 'WIKI_DOCUMENT_DELETE_FORBIDDEN'")
  })

  it('검증과 질문 답변은 잠근 대상 행의 프로젝트 멤버만 수행한다', () => {
    const verify = functionSql('verify_wiki_document')
    expect(verify).toMatch(/where topic\.id = p_topic_id\s+for update/)
    expect(verify).toContain('public.is_project_member(v_topic.project_id)')
    expect(verify).toContain('p_review_days < 1 or p_review_days > 365')
    expect(verify).toContain('v_topic.body_updated_at is distinct from p_expected_updated_at')
    expect(verify).toContain("raise exception 'WIKI_DOCUMENT_EDIT_CONFLICT'")
    expect(verify).toMatch(/update public\.wiki_feedback feedback[\s\S]*resolution = 'verified'/)

    const answer = functionSql('answer_wiki_question')
    expect(answer).toMatch(/where question\.id = p_question_id\s+for update/)
    expect(answer).toContain('public.is_project_member(v_question.project_id)')
    expect(answer).toMatch(/topic\.id = v_topic_id and topic\.project_id = v_question\.project_id/)
    expect(answer).toContain("v_question.status <> 'open'")
    expect(answer).toContain("raise exception 'WIKI_QUESTION_NOT_OPEN'")
  })

  it('트리 이동·핀은 관리자 전용 RPC에서 타 프로젝트·순환·깊이를 검증한다', () => {
    const fn = functionSql('move_wiki_document')
    expect(fn).toMatch(/where topic\.id = p_topic_id\s+for update/)
    expect(fn).toContain('public.is_project_admin(v_topic.project_id)')
    expect(fn).toMatch(/topic\.id = v_cursor[\s\S]*topic\.project_id = v_topic\.project_id/)
    expect(fn).toContain('v_depth > 2')
    expect(fn).toContain('pg_catalog.pg_advisory_xact_lock')
    expect(fn).toContain('with recursive descendants as')
    expect(fn).toContain('v_depth + v_descendant_depth > 2')
    expect(fn).toContain("raise exception 'WIKI_DOCUMENT_PARENT_INVALID'")
    expect(fn).toMatch(/set parent_id = p_parent_id,[\s\S]*pinned_order = p_pinned_order/)
  })

  it('항목 리뷰는 프로젝트 관리자와 허용된 전이만 통과하고 감사 이력을 남긴다', () => {
    const fn = functionSql('review_wiki_item')
    expect(fn).toMatch(/where item\.id = p_item_id\s+for update/)
    expect(fn).toContain('public.is_project_admin(v_item.project_id)')
    expect(fn).toContain("v_item.review_state = 'pending' and p_review_state in ('accepted','rejected')")
    expect(fn).toContain("v_item.review_state = 'rejected' and p_review_state = 'pending'")
    expect(fn).toMatch(/insert into public\.wiki_change_events[\s\S]*'review:' \|\| p_review_state/)
  })

  it('피드백은 topic에서 프로젝트를 유도하고 사용자별 동일 신호를 upsert한다', () => {
    const fn = functionSql('submit_wiki_feedback')
    expect(fn).toMatch(/select topic\.project_id into v_project_id[\s\S]*topic\.id = p_topic_id/)
    expect(fn).toContain('public.is_project_member(v_project_id)')
    expect(fn).toContain("p_kind not in ('helpful','outdated')")
    expect(fn).toContain('on conflict (topic_id, user_id, feedback_type) do update')
    expect(fn).toMatch(/resolution = null,[\s\S]*resolved_at = null/)
    expect(fn).toMatch(/p_kind = 'outdated'[\s\S]*review_due_at = least/)
  })

  it('삭제형 주제 병합은 사람 문서나 revision이 있으면 DB에서도 거부한다', () => {
    const fn = functionSql('merge_wiki_topics')
    expect(fn).toContain("v_source.origin = 'manual'")
    expect(fn).toContain("v_target.origin = 'manual'")
    expect(fn).toMatch(/from public\.wiki_topic_revisions revision[\s\S]*p_source_topic_id, p_target_topic_id/)
    expect(fn).toContain("raise exception 'WIKI_MERGE_DOCUMENT_FORBIDDEN'")
  })

  it('모든 definer RPC는 PUBLIC 실행권을 회수하고 authenticated에 명시적으로 연다', () => {
    const signatures = [
      'create_wiki_document(uuid, text, text, text, uuid)',
      'save_wiki_document(uuid, text, text, text, timestamptz)',
      'verify_wiki_document(uuid, integer, timestamptz)',
      'move_wiki_document(uuid, uuid, integer, integer)',
      'restore_wiki_document_revision(uuid, uuid, timestamptz)',
      'create_wiki_question(uuid, uuid, text)',
      'answer_wiki_question(uuid, text, uuid)',
      'review_wiki_item(uuid, text)',
      'submit_wiki_feedback(uuid, text, text)',
    ]
    for (const signature of signatures) {
      expect(sql).toContain(
        `revoke all on function public.${signature}\n  from public, anon, authenticated`,
      )
      expect(sql).toContain(`grant execute on function public.${signature}\n  to authenticated`)
    }
    for (const name of signatures.map((signature) => signature.slice(0, signature.indexOf('(')))) {
      expect(functionSql(name)).toContain("set search_path = ''")
    }
  })

  it('rollback은 데이터 소실을 경고하고 0079 추가물만 역순 제거한다', () => {
    expect(rollback).toMatch(/경고\(데이터 소실\)/)
    expect(rollback).toContain('drop table if exists public.wiki_topic_revisions')
    expect(rollback).toContain('drop table if exists public.wiki_questions')
    expect(rollback).toContain('drop table if exists public.wiki_feedback')
    expect(rollback).toContain('drop column if exists review_state')
    expect(rollback).toContain('drop column if exists event_name')
    expect(rollback).toContain("delete from public.usage_events where event_name <> 'page_view'")
    expect(rollback.indexOf("delete from public.usage_events where event_name <> 'page_view'"))
      .toBeLessThan(rollback.indexOf('drop column if exists event_name'))
    expect(rollback).toContain('drop column if exists body_md')
    expect(rollback).not.toMatch(/drop table if exists public\.wiki_(topics|items|item_sources|change_events)/)
    const mergeRestore = rollback.indexOf('create or replace function public.merge_wiki_topics')
    expect(mergeRestore).toBeGreaterThan(rollback.indexOf('drop column if exists origin'))
    expect(rollback.slice(mergeRestore)).not.toContain('wiki_topic_revisions')
  })
})
