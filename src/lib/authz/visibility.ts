import { cache } from 'react'
import { createServerClient } from '../supabase/server'
import { getActorForView } from './index'
import { canSeeProject } from '../domain/authz'

/**
 * 현재 사용자에게 숨겨야 하는 비공개 프로젝트(0070) id 집합 — 회의록 달력·검색·탐색기처럼
 * 프로젝트 경계를 넘는 목록 표면이 항목 단위로 거를 때 쓴다.
 *
 * 이것은 노출 억제(UI 숨김)지 보안 경계가 아니다(설계 2026-08-10) — 조회가 실패하면
 * 로그를 남기고 빈 집합으로 진행한다. 여기서 화면을 죽이면 공개 회의록까지 함께 사라져
 * '조용한 빈 화면' 금지 원칙과 충돌한다. 진짜 차단이 필요해지면 RLS 로 올린다.
 */
export const getHiddenProjectIds = cache(async (): Promise<ReadonlySet<string>> => {
  const sb = await createServerClient()
  const [{ data, error }, actor] = await Promise.all([
    sb.from('projects').select('id, is_private').eq('is_private', true),
    getActorForView(),
  ])
  if (error) {
    console.error('[getHiddenProjectIds] 비공개 프로젝트 조회 실패 — 숨김 없이 진행:', error.message)
    return new Set()
  }
  return new Set((data ?? [])
    .filter(p => !canSeeProject(actor, p as { id: string; is_private?: boolean | null }))
    .map(p => p.id as string))
})
