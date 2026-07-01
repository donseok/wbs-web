// ============================================================================
// 자가 치유(self-heal) 색인 — 의미검색 시점에 프로젝트 색인이 비어 있으면 1회 자동 색인한다.
// 데이터가 임베딩 키 설정 이전에 임포트됐거나(과거 색인 skip) 수동 재색인을 안 했을 때,
// 사용자가 챗봇에 질문하는 것만으로 pgvector 색인이 채워지도록 하는 안전망.
// (정상 경로는 임포트 후 자동 색인 + 관리자 수동 재색인. 이건 그 둘의 누락을 메운다.)
// ============================================================================

import { hasEmbeddings } from './provider'
import { createAdminClient } from '@/lib/supabase/admin'
import { ingestProject } from './ingest'

// 워밍된 인스턴스 내 동시 요청 dedupe + 실패 시 재시도 폭주 방지용 쿨다운.
const inFlight = new Map<string, Promise<void>>()
const lastAttempt = new Map<string, number>()
const COOLDOWN_MS = 60_000

/**
 * 프로젝트 색인이 비어 있으면 색인을 채운다(멱등·베스트에포트). 이미 색인돼 있거나 키/권한이
 * 없으면 즉시 반환. 어떤 실패도 throw 하지 않는다(챗봇 답변 경로를 절대 막지 않음).
 */
export async function ensureProjectIndexed(projectId: string | null): Promise<void> {
  if (!projectId || !hasEmbeddings()) return
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return

  const running = inFlight.get(projectId)
  if (running) return running
  if (Date.now() - (lastAttempt.get(projectId) ?? 0) < COOLDOWN_MS) return

  const task = (async () => {
    try {
      const admin = createAdminClient()
      const { count, error } = await admin
        .from('wbs_embeddings')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
      // 테이블 없음(마이그레이션 미적용) or 이미 색인 있음 → 스킵.
      if (error || (count ?? 0) > 0) return
      lastAttempt.set(projectId, Date.now())
      const r = await ingestProject(projectId)
      console.warn(`[dkbot] 자동 색인 완료: project=${projectId.slice(0, 8)} indexed=${r.count} skipped=${r.skippedItems ?? 0}`)
    } catch (e) {
      console.error('[dkbot] 자동 색인 실패(무시):', e instanceof Error ? e.message : e)
    } finally {
      inFlight.delete(projectId)
    }
  })()
  inFlight.set(projectId, task)
  return task
}
