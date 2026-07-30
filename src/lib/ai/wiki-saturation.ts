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

/** 전량 스캔 총 상한. 여기에 닿으면 카운트를 신뢰할 수 없어 게이팅을 끈다. */
export const LIVE_SCAN_CAP = 2_000

/**
 * PostgREST max_rows 하드 캡(supabase/config.toml, 호스티드 동일). 2026-07-30 프로덕션
 * 실측: 명시 limit=2000 요청도 1000행에서 조용히 깎인다(content-range 0-999/1219).
 * 즉 캡보다 큰 limit 한 방은 성립하지 않고, 전량은 range 페이지 순회로만 얻을 수 있다 —
 * limit(2000) 단발이면 rows.length가 2000에 절대 닿지 못해 절단 감시가 사문이 된다.
 */
export const LIVE_SCAN_PAGE = 1_000

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
  const rows: Row[] = []
  const seenIds = new Set<string>()
  let sawShortPage = false
  for (let offset = 0; offset < LIVE_SCAN_CAP; offset += LIVE_SCAN_PAGE) {
    const { data, error } = await admin.from('wiki_items')
      // 리터럴 문자열이어야 한다 — '+' 로 이어붙이면 타입이 string으로 넓어져
      // supabase-js 의 select 파서가 GenericStringError 로 빠진다.
      .select('id, topic_id, kind, knowledge_key, statement, updated_at, wiki_topics!inner(id, title, normalized_title, last_changed_at)')
      .eq('project_id', projectId)
      .in('lifecycle_state', [...WIKI_LIVE_STATES])
      // 재구축이 updated_at 을 대량 동률로 만들므로 id 2차 키가 없으면 페이지 경계에서
      // 같은 행이 중복되거나 빠진다.
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + LIVE_SCAN_PAGE - 1)

    if (error) {
      console.error('[wiki] 포화 스냅샷 조회 실패(게이팅 없이 계속):', error.code ?? 'UNKNOWN')
      return emptySaturationSnapshot()
    }
    const batch = (data ?? []) as Row[]
    // offset 순회는 요청 사이 다른 워커의 쓰기로 전체 순서가 밀릴 수 있다. 밀려서
    // 재등장한 행(중복)은 id 로 걸러 과대집계를 막는다. 반대 방향(행이 앞 페이지 영역으로
    // 당겨져 누락)은 과소집계 = 게이팅이 덜 발동하는 안전한 쪽이고 다음 실행에서 낫는다.
    for (const r of batch) {
      const rowId = String(r.id ?? '')
      if (rowId && seenIds.has(rowId)) continue
      if (rowId) seenIds.add(rowId)
      rows.push(r)
    }
    // 페이지 짧음 판정은 서버가 준 원본 길이 기준이다 — 중복 제거 후 길이로 재면
    // 마지막 페이지가 아닌데 짧아 보일 수 있다.
    if (batch.length < LIVE_SCAN_PAGE) {
      sawShortPage = true
      break
    }
  }

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

  // 마지막 페이지가 짧게 끝났을 때만 전량이다. 짧은 페이지 없이 상한에 닿았다면
  // 뒤에 더 있다는 뜻이므로 카운트를 신뢰하지 않는다(fail-closed).
  const complete = sawShortPage
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
  // 소유 판정: 같은 (kind, facet)이 두 주제 이상에 살아 있으면 소유가 모호하다.
  // facet 은 knowledge_key(`주제:kind:facet`) 구조상 주제 안에서만 유일하므로, 전역
  // (kind, facet) 일치는 소유 증명이 아니다. 모호한 키로 구제하면 무관한 주제의 항목이
  // 포화 주제로 끌려와 두 주제의 이력이 동시에 오염된다 — 단독 소유 키만 근거로 삼는다.
  const topicsByKey = new Map<string, Set<string>>()
  for (const i of items) {
    const key = wikiSaturationKey(i.kind, i.facetPart)
    const owners = topicsByKey.get(key) ?? new Set<string>()
    owners.add(i.topicId)
    topicsByKey.set(key, owners)
  }
  const keyOwner = new Map<string, { id: string; normalizedTitle: string }>()
  for (const i of items) {
    if (!saturatedIds.has(i.topicId)) continue
    const key = wikiSaturationKey(i.kind, i.facetPart)
    if ((topicsByKey.get(key)?.size ?? 0) !== 1) continue
    if (keyOwner.has(key)) continue
    const t = topicMap.get(i.topicId)
    if (t) keyOwner.set(key, { id: t.id, normalizedTitle: t.normalizedTitle })
  }

  return { complete: true, topics, items, saturatedNormalizedTitles, keyOwner }
}
