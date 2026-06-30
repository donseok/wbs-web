'use server'
import { getMembership } from '@/lib/auth'
import { ingestProject } from '@/lib/ai/ingest'

/** DK Bot 의미검색 색인 재생성(관리자 전용). 설정 화면/임포트 후 호출. */
export async function reindexProjectAction(projectId: string): Promise<{
  ok: boolean
  error?: string
  count?: number
  skipped?: boolean
  reason?: string
  skippedItems?: number
}> {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') return { ok: false, error: '권한이 없습니다.' }
  try {
    const r = await ingestProject(projectId)
    return { ok: true, count: r.count, skipped: r.skipped, reason: r.reason, skippedItems: r.skippedItems }
  } catch (e) {
    // 원문 DB/PostgREST 메시지를 클라이언트로 흘리지 않는다(상세는 서버 로그에만).
    console.error('[dkbot] reindexProjectAction 오류:', e instanceof Error ? e.message : e)
    return { ok: false, error: '색인에 실패했습니다.' }
  }
}
