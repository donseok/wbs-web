// 프로젝트의 살아있는 위키 항목을 한 번 전량 조회해 포화 스냅샷을 만든다.
//
// 왜 전량인가: 카탈로그의 기존 항목 쿼리는 updated_at desc limit 40이고, 그 40행 창에서
// 주제별로 세면 살아있는 68건인 '데이터 관리'가 12건으로 보인다(2026-07-30 실측).
// 표본으로 세면 어떤 주제도 상한에 닿지 않아 게이팅이 무음 no-op이 된다. 살아있는 55건인
// '생산 및 부자재 관리'는 그 창에 0행이라 facet 목록까지 빈 채로 나간다.
//
// 왜 JS 집계인가: PostgREST 집계 함수가 이 프로젝트에서 비활성이다
// (select=topic_id,count() → PGRST123). supabase-js로 GROUP BY도 못 한다.
// 행을 받아 앱에서 세는 것은 getWikiOverview(src/lib/data/wiki.ts)가 이미 쓰는 관용구다.
import { createAdminClient } from '@/lib/supabase/admin'
import {
  WIKI_LIVE_STATES,
  isSaturatedWikiTopic,
  wikiSaturationKey,
} from '@/lib/domain/wiki'
import type { CatalogItem, CatalogTopic } from '@/lib/ai/wiki-catalog'

/**
 * PostgREST 기본 max-rows가 1000이다. 명시 limit 없이 긁으면 조용히 1000행에서 잘려
 * 포화 주제가 비포화로 보인다. 상한을 그보다 크게 두고, 닿으면 게이팅을 끈다.
 */
export const LIVE_SCAN_CAP = 2_000

export interface WikiSaturationSnapshot {
  /** false면 카운트를 신뢰할 수 없다 — 게이팅을 켜지 않는다. */
  complete: boolean
  topics: CatalogTopic[]
  items: CatalogItem[]
  saturatedNormalizedTitles: Set<string>
  /** `kind:facet` → 그 대상을 이미 담고 있는 포화 주제. 코드 구제의 근거다. */
  keyOwner: Map<string, { id: string; normalizedTitle: string }>
}

export function emptySaturationSnapshot(): WikiSaturationSnapshot {
  return {
    complete: false,
    topics: [],
    items: [],
    saturatedNormalizedTitles: new Set(),
    keyOwner: new Map(),
  }
}

type Row = Record<string, unknown>

function facetOf(knowledgeKey: string): string {
  return knowledgeKey.split(':').slice(2).join(':')
}

export async function loadWikiSaturation(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<WikiSaturationSnapshot> {
  const { data, error } = await admin.from('wiki_items')
    // 리터럴 문자열이어야 한다 — '+' 로 이어붙이면 타입이 string으로 넓어져
    // supabase-js 의 select 파서가 GenericStringError 로 빠진다.
    .select('topic_id, kind, knowledge_key, statement, updated_at, wiki_topics!inner(id, title, normalized_title, last_changed_at)')
    .eq('project_id', projectId)
    .in('lifecycle_state', [...WIKI_LIVE_STATES])
    .order('updated_at', { ascending: false })
    .limit(LIVE_SCAN_CAP)

  if (error) {
    console.error('[wiki] 포화 스냅샷 조회 실패(게이팅 없이 계속):', error.code ?? 'UNKNOWN')
    return emptySaturationSnapshot()
  }
  const rows = (data ?? []) as Row[]

  const topicMap = new Map<string, CatalogTopic>()
  const items: CatalogItem[] = []
  for (const r of rows) {
    const raw = r.wiki_topics
    const t = (Array.isArray(raw) ? raw[0] : raw) as Row | undefined
    if (!t) continue
    const id = String(t.id ?? '')
    const title = String(t.title ?? '')
    if (!id || !title) continue
    const existing = topicMap.get(id)
    if (existing) existing.liveCount += 1
    else {
      topicMap.set(id, {
        id,
        title,
        normalizedTitle: String(t.normalized_title ?? ''),
        liveCount: 1,
        lastChangedAt: String(t.last_changed_at ?? ''),
      })
    }
    items.push({
      topicId: id,
      topicTitle: title,
      kind: String(r.kind ?? ''),
      facetPart: facetOf(String(r.knowledge_key ?? '')),
      statement: String(r.statement ?? ''),
      updatedAt: String(r.updated_at ?? ''),
    })
  }

  const complete = rows.length < LIVE_SCAN_CAP
  if (!complete) {
    console.warn(
      `[wiki] 살아있는 항목이 스캔 상한 ${LIVE_SCAN_CAP}에 닿았다 — `
      + '포화 카운트를 신뢰할 수 없어 게이팅을 켜지 않는다',
    )
    return { ...emptySaturationSnapshot(), topics: [...topicMap.values()], items }
  }

  const topics = [...topicMap.values()]
  const saturatedNormalizedTitles = new Set<string>()
  const saturatedIds = new Set<string>()
  for (const t of topics) {
    if (!isSaturatedWikiTopic(t.liveCount)) continue
    saturatedNormalizedTitles.add(t.normalizedTitle)
    saturatedIds.add(t.id)
  }
  const keyOwner = new Map<string, { id: string; normalizedTitle: string }>()
  for (const i of items) {
    if (!saturatedIds.has(i.topicId)) continue
    const key = wikiSaturationKey(i.kind, i.facetPart)
    if (keyOwner.has(key)) continue
    const t = topicMap.get(i.topicId)
    if (t) keyOwner.set(key, { id: t.id, normalizedTitle: t.normalizedTitle })
  }

  return { complete: true, topics, items, saturatedNormalizedTitles, keyOwner }
}
