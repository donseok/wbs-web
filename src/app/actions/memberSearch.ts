'use server'
import { createServerClient } from '@/lib/supabase/server'
import { requireProjectAdmin } from '@/lib/authz'
import { sortByKoreanName } from '@/lib/domain/nameSort'
import type { TeamCode } from '@/lib/domain/types'

export interface MemberCandidate {
  name: string
  email: string | null
  teamCode: TeamCode | null
  title: string | null
  roleLabel: string | null
}

export interface MemberSearchResult {
  ok: boolean
  error?: string
  candidates?: MemberCandidate[]
}

const CANDIDATE_LOOKUP_FAILED = '멤버 후보를 조회할 수 없습니다.'
// dedupe·정렬 뒤에도 8명을 채울 수 있도록 여유 있게 가져온다.
const FETCH_LIMIT = 30
const MAX_CANDIDATES = 8

/** ilike 패턴 메타문자를 리터럴로 — 사용자가 친 % _ \ 가 와일드카드로 새지 않게. */
function escapeIlike(q: string): string {
  return q.replace(/[\\%_]/g, ch => '\\' + ch)
}

/**
 * 멤버 추가 다이얼로그의 이름 자동완성 후보 — 기존 로스터(project_members)에서 검색한다.
 *
 * 프라이버시 경계: 일반 관리자는 자기가 역할을 가진 프로젝트들의 로스터만 본다.
 * 슈퍼유저만 전체 로스터. 응답에는 후보 필드만 싣고 어느 프로젝트 소속인지는 싣지 않는다.
 */
export async function searchMemberCandidates(
  projectId: string,
  query: string,
): Promise<MemberSearchResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  const q = query.trim()
  if (q.length < 2) return { ok: true, candidates: [] }

  const sb = await createServerClient()
  let sel = sb
    .from('project_members')
    .select('id, name, email, title, role_label, created_at, teams(code)')
    .ilike('name', `%${escapeIlike(q)}%`)
  if (!g.actor.isSuperuser) {
    sel = sel.in('project_id', [...g.actor.projectRoles.keys()])
  }
  // created_at ASC, id ASC — 같은 이메일 중 첫 등장 행이 정본(validateMemberIdentity 와 같은 규칙).
  const { data, error } = await sel
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(FETCH_LIMIT)
  if (error) {
    console.error('[searchMemberCandidates] 멤버 후보 조회 실패:', error.message)
    return { ok: false, error: CANDIDATE_LOOKUP_FAILED }
  }

  const seenEmails = new Set<string>()
  const candidates: MemberCandidate[] = []
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const email = (r.email as string | null) ?? null
    if (email) {
      const key = email.toLowerCase()
      if (seenEmails.has(key)) continue
      seenEmails.add(key)
    }
    const team = r.teams as { code: TeamCode } | { code: TeamCode }[] | null
    candidates.push({
      name: r.name as string,
      email,
      teamCode: (Array.isArray(team) ? team[0]?.code : team?.code) ?? null,
      title: (r.title as string) ?? null,
      roleLabel: (r.role_label as string) ?? null,
    })
  }

  return {
    ok: true,
    candidates: sortByKoreanName(candidates, c => c.name).slice(0, MAX_CANDIDATES),
  }
}
