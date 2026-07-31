import { createServerClient } from '@/lib/supabase/server'
import type { SupabaseServerClient } from '@/lib/repositories/supabase/common'

/**
 * 프로젝트 설정 로더 (스펙 §7.3) — 전역 캐시가 아니라 주입.
 * 행 없음 = 기본값(fail-safe 계약). 조회 실패 = throw(기본값 위장 금지 — 3원칙).
 * 예외: 행이 없는 프로젝트는 0058 시드나 신규 프리셋 경로 밖의 비정상 케이스뿐이므로,
 * 그때 빈 키워드는 '조용한 기본값'이 아니라 설정 부재의 가시 신호.
 */
export interface ProjectConfig {
  levelLabels: string[]
  maxDepth: number | null
  extraAxisLabel: string | null
  milestoneKeywords: string[]
  excelProfile: Record<string, unknown>
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  levelLabels: ['Phase', 'Task', 'Activity'],
  maxDepth: null,
  extraAxisLabel: null,
  // ⚠️ 스펙 §7.4: 빈 키워드는 마일스톤 카드를 무증상 소실시킨다. 이 기본값은 '설정 행이 없는 프로젝트'의 폴백인데,
  // 0058 시드가 기존 전 프로젝트에 행을 넣었고 신규 프로젝트는 생성 시 프리셋이 행을 만든다(후속 계획) — 즉 이 폴백을
  // 실제로 타는 프로젝트는 시드·프리셋 경로 밖에서 만들어진 비정상 케이스뿐이며, 그때 카드가 비는 것은 '조용한
  // 기본값'이 아니라 설정 부재의 가시 신호로 남긴다.
  milestoneKeywords: [],
  excelProfile: {},
}

export async function getProjectConfig(projectId: string, client?: SupabaseServerClient): Promise<ProjectConfig> {
  const sb = client ?? (await createServerClient())
  const { data, error } = await sb
    .from('project_settings')
    .select('level_labels, max_depth, extra_axis_label, milestone_keywords, excel_profile')
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) throw new Error(`프로젝트 설정 조회 실패: ${error.message}`)
  if (!data) return DEFAULT_PROJECT_CONFIG
  const row = data as {
    level_labels: string[]; max_depth: number | null; extra_axis_label: string | null
    milestone_keywords: string[]; excel_profile: Record<string, unknown>
  }
  return {
    levelLabels: row.level_labels,
    maxDepth: row.max_depth,
    extraAxisLabel: row.extra_axis_label,
    // §7.4 함정 2 — isMilestoneLeaf 는 lowercase 비교. 주입 전에 정규화해 계약을 로더가 보증한다.
    milestoneKeywords: (row.milestone_keywords ?? []).map(k => k.toLowerCase()),
    excelProfile: row.excel_profile ?? {},
  }
}
