import { generateAnswer } from './llm'
import { hasLLM } from './provider'
import { createEnsureGate } from './ensure'
import { createAdminClient } from '@/lib/supabase/admin'
import { splitMinuteBlocks, isMarkableBlock, fnv1a64, type MinuteBlock } from '@/lib/minutes/blocks'
import type { InsightKind } from '@/lib/domain/types'

const KINDS: InsightKind[] = ['decision', 'action', 'deadline', 'risk']
const LABEL_CAP = 120
const ITEMS_CAP = 30
const BLOCK_TEXT_CAP = 800

const SYSTEM = [
  '너는 회의록 분석기다. 번호가 매겨진 블록 목록에서 아래 4종에 해당하는 블록만 골라라.',
  '- decision: 확정된 결정사항',
  '- action: 담당자가 해야 할 액션아이템',
  '- deadline: 구체적 기한/일정 약속',
  '- risk: 리스크/우려/차질 가능성',
  '규칙: 확실한 것만. 최대 20항목. label 은 60자 이내 한 문장 요약.',
  'JSON 배열만 출력한다. 형식: [{"i":블록번호,"k":"decision","label":"..."}]',
  'JSON 외 다른 텍스트를 절대 출력하지 마라.',
].join('\n')

/** LLM 응답 관용 파싱 — 코드펜스/서두 제거 → 첫 '['~마지막 ']' → 검증. 실패 시 null. */
export function parseInsightItems(
  raw: string, blocks: MinuteBlock[],
): { i: number; k: InsightKind; label: string }[] | null {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw.slice(start, end + 1)) } catch { return null }
  if (!Array.isArray(parsed)) return null
  const seen = new Set<string>()
  const out: { i: number; k: InsightKind; label: string }[] = []
  for (const item of parsed) {
    if (out.length >= ITEMS_CAP) break
    if (typeof item !== 'object' || item === null) continue
    const { i, k, label } = item as { i?: unknown; k?: unknown; label?: unknown }
    if (typeof i !== 'number' || !Number.isInteger(i)) continue
    if (typeof k !== 'string' || !KINDS.includes(k as InsightKind)) continue
    if (typeof label !== 'string') continue
    const b = blocks[i]
    if (!b || !isMarkableBlock(b)) continue
    const key = `${i}:${k}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ i, k: k as InsightKind, label: label.slice(0, LABEL_CAP) })
  }
  return out
}

/**
 * 회의록 1건 AI 분류 — delete 후 insert(on conflict do nothing). 스펙 §4.1.
 * 실패는 로그만(행 미기록 = self-heal 재시도 신호). 절대 throw 하지 않는다.
 */
export async function generateMinuteInsights(minuteId: string, bodyMd: string): Promise<void> {
  try {
    if (!hasLLM()) return
    if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return
    if (!bodyMd.trim()) return
    const blocks = splitMinuteBlocks(bodyMd)
    const markable = blocks.filter(isMarkableBlock)
    if (markable.length === 0) return
    const user = markable.map(b => `[${b.index}] ${b.text.slice(0, BLOCK_TEXT_CAP)}`).join('\n')
    const raw = await generateAnswer(SYSTEM, [{ role: 'user', content: user }])
    if (raw === null) return  // LLM 실패/키 없음 — 행 미기록
    const items = parseInsightItems(raw, blocks)
    if (items === null) { console.error('[minutes] 인사이트 파싱 실패(행 미기록)'); return }

    const bodyHash = fnv1a64(bodyMd)
    const rows = items.length
      ? items.map(({ i, k, label }) => ({
          minute_id: minuteId, body_hash: bodyHash, kind: k, label,
          block_index: i, block_hash: blocks[i].hash,
        }))
      : [{ minute_id: minuteId, body_hash: bodyHash, kind: 'none', label: '', block_index: -1, block_hash: '' }]

    const admin = createAdminClient()
    const { error: delErr } = await admin.from('minute_insights').delete().eq('minute_id', minuteId)
    if (delErr) { console.error('[minutes] 인사이트 삭제 실패:', delErr.message); return }
    // 동시 재생성 경합은 unique (minute_id, block_index, kind) + ignoreDuplicates 로 중복 차단
    const { error } = await admin.from('minute_insights')
      .upsert(rows, { onConflict: 'minute_id,block_index,kind', ignoreDuplicates: true })
    if (error) console.error('[minutes] 인사이트 기록 실패:', error.message)
  } catch (e) {
    console.error('[minutes] 인사이트 생성 실패(무시):', e instanceof Error ? e.message : e)
  }
}

// ── 열람 self-heal — 회의록 단위 in-flight dedupe + 60초 쿨다운 (healMissingMinuteEmbeddings 미러).
// 게이트 상태(Map)는 공용 헬퍼(ensure.ts) 클로저에 있고, 모듈 로드 시 1회 생성해
// 기존 모듈 스코프 Map 과 동일한 인스턴스 메모리 수명을 유지한다.
const INSIGHT_LOG_LABEL = '[minutes] 인사이트 ensure 실패(무시):'
const ensureInsightGate = createEnsureGate({ cooldownMs: 60_000, logLabel: INSIGHT_LOG_LABEL })

/**
 * 인사이트가 없거나 stale 이면 생성 시도. 호출측(서버 액션)이 신선하면 아예 부르지 않지만
 * 이중 확인한다. 반환: 'ready'(이미 신선) | 'generated'(지금 생성 성공) | 'unavailable'(실패/쿨다운).
 */
export async function ensureMinuteInsights(
  minuteId: string, bodyMd: string, currentBodyHash: string,
): Promise<'ready' | 'generated' | 'unavailable'> {
  try {
    if (!hasLLM()) return 'unavailable'
    if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return 'unavailable'
    if (!bodyMd.trim()) return 'ready'

    const admin = createAdminClient()
    const fresh = async (): Promise<boolean> => {
      const { data } = await admin.from('minute_insights')
        .select('body_hash').eq('minute_id', minuteId)
      return !!data && data.length > 0 && data.every(r => (r.body_hash as string) === currentBodyHash)
    }
    return await ensureInsightGate(minuteId, {
      fresh,
      generate: () => generateMinuteInsights(minuteId, bodyMd),
    })
  } catch (e) {
    // 게이트 진입 전(클라이언트 생성 등) 실패 방어 — never-throw 계약 유지
    console.error(INSIGHT_LOG_LABEL, e instanceof Error ? e.message : e)
    return 'unavailable'
  }
}
