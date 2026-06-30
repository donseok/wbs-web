'use server'
import { getMembership } from '@/lib/auth'
import { ingestProject } from '@/lib/ai/ingest'

/** DK Bot 의미검색 색인 재생성(관리자 전용). 설정 화면/임포트 후 호출. */
export async function reindexProjectAction(
  projectId: string,
): Promise<{ ok: boolean; error?: string; count?: number; skipped?: boolean }> {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') return { ok: false, error: '권한이 없습니다.' }
  try {
    const r = await ingestProject(projectId)
    return { ok: true, count: r.count, skipped: r.skipped }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '색인에 실패했습니다.' }
  }
}
