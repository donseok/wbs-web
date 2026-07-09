import { chunkMarkdown } from './chunk'
import { embedDocuments } from './embeddings'
import { hasEmbeddings } from './provider'
import { createAdminClient } from '@/lib/supabase/admin'

/** 회의록 1건 인제스트 — delete-and-reinsert. 실패는 로그만(업로드 성공에 영향 없음, self-heal 이 회수). */
export async function ingestMinute(minuteId: string, bodyMd: string): Promise<void> {
  try {
    if (!hasEmbeddings()) return
    if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return
    const chunks = chunkMarkdown(bodyMd)
    const admin = createAdminClient()
    // 본문이 비어도 기존 임베딩은 지운다(교체로 비워진 경우 스테일 방지).
    const { error: delErr } = await admin.from('minute_embeddings').delete().eq('minute_id', minuteId)
    if (delErr) { console.error('[minutes] 임베딩 삭제 실패:', delErr.message); return }
    if (chunks.length === 0) return
    const vectors = await embedDocuments(chunks, 'RETRIEVAL_DOCUMENT')
    if (!vectors) return
    const rows = chunks
      .map((content, i) => ({ content, v: vectors[i], i }))
      .filter((x): x is { content: string; v: number[]; i: number } => x.v !== null)
      .map(({ content, v, i }) => ({ minute_id: minuteId, chunk_index: i, content, embedding: v }))
    if (rows.length === 0) return
    const { error } = await admin.from('minute_embeddings').insert(rows)
    if (error) console.error('[minutes] 임베딩 기록 실패:', error.message)
  } catch (e) {
    console.error('[minutes] 인제스트 실패(무시):', e instanceof Error ? e.message : e)
  }
}

// archive 질의 시 임베딩 없는 회의록을 회의록 단위로 회수(anti-join). ensure-index 계약 미러.
let healInFlight: Promise<void> | null = null
let healLastAttempt = 0
const HEAL_COOLDOWN_MS = 60_000

export async function healMissingMinuteEmbeddings(limit = 3): Promise<void> {
  if (!hasEmbeddings()) return
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return
  if (healInFlight) return healInFlight
  if (Date.now() - healLastAttempt < HEAL_COOLDOWN_MS) return

  healInFlight = (async () => {
    try {
      healLastAttempt = Date.now()
      const admin = createAdminClient()
      // anti-join: 임베딩이 하나도 없는 회의록 (embedded count — 행 수가 회의록 수라 max-rows 캡 무관)
      const { data: all } = await admin.from('minutes')
        .select('id, body_md, minute_embeddings(count)')
        .neq('body_md', '')
        .order('minute_date', { ascending: false }).limit(200)
      const missing = (all ?? [])
        .filter(r => (((r.minute_embeddings as { count: number }[] | undefined)?.[0]?.count) ?? 0) === 0)
        .slice(0, limit)
      for (const r of missing) await ingestMinute(r.id as string, r.body_md as string)
      if (missing.length) console.warn(`[minutes] self-heal 인제스트: ${missing.length}건`)
    } catch (e) {
      console.error('[minutes] self-heal 실패(무시):', e instanceof Error ? e.message : e)
    } finally {
      healInFlight = null
    }
  })()
  return healInFlight
}
