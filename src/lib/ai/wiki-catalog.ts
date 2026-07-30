// 추출 프롬프트에 붙는 기존 지식 카탈로그의 조립 규칙. I/O 없는 순수 함수다.
//
// 왜 따로 떼는가: 여기서 지켜야 하는 것(예산 상한, (kind,facet) distinct, 결정적 정렬,
// 포화 주제 제외)이 전부 문자열 조립 규칙이라 supabase 목 없이 테스트할 수 있어야 한다.
// wiki-ingest.ts는 이미 1,200줄이 넘어 여기에 더 얹으면 읽을 수 없다.
import {
  isAgendaStyleWikiTopic,
  isSaturatedWikiTopic,
  wikiSaturationKey,
} from '@/lib/domain/wiki'

/**
 * 주제 창 상한. 60이던 값을 올린다 — 이 설계의 목적이 주제를 잘게 만드는 것이고,
 * 60은 이미 살아있는 주제 62개를 담지 못했다. 살아있는 주제만 싣기 때문에 창을 넓혀도
 * 죽은 이름이 들어오지 않는다.
 */
export const CATALOG_TOPIC_LIMIT = 160
export const CATALOG_ITEM_LIMIT = 40
export const CATALOG_STATEMENT_CAP = 90
export const CATALOG_FACETS_PER_TOPIC = 12

/**
 * 프롬프트가 커지면 gemini-3.5-flash가 출력 예산 4,096 토큰을 thinking에 써 본문이 잘리고
 * LLM_OUTPUT_INVALID가 되며, 회의록 1건이 0건이 되고 재구축 큐 전체가 멈춘다(f74fc5a).
 * 측정 대상은 반환 문자열 전량이다 — 부분 합으로 재면 테스트와 구현이 어긋난다.
 */
export const CATALOG_CHAR_BUDGET = 6_000

/** 예산이 아무리 빠듯해도 이 아래로는 줄이지 않는다. 0으로 만들면 이력 보호가 사라진다. */
const FACETS_FLOOR = 2
const ITEM_LINES_FLOOR = 10
const TOPIC_LINE_FLOOR = 20

/**
 * 스펙 §8 축소 순서. 무한정 자라는 항(포화 목록 = 12 × 포화주제수)을 먼저 조이고,
 * 상한이 박힌 항목 줄(비포화 재사용 신호)은 그 다음에만 깎는다 — 순서를 뒤집으면
 * 재사용 신호가 불필요하게 잘려 파편화 해소라는 목적을 예산 압박 상황에서 역행한다.
 * facet 2(FACETS_FLOOR)는 일반 단이 아니라 주제 줄 절단 이후의 최후 수단이다.
 */
const LADDER: ReadonlyArray<readonly [perTopic: number, itemCount: number]> = [
  [CATALOG_FACETS_PER_TOPIC, CATALOG_ITEM_LIMIT],
  [8, CATALOG_ITEM_LIMIT],
  [4, CATALOG_ITEM_LIMIT],
  [4, 20],
  [4, ITEM_LINES_FLOOR],
]

export interface CatalogTopic {
  id: string
  title: string
  normalizedTitle: string
  liveCount: number
  lastChangedAt: string
}

export interface CatalogItem {
  topicId: string
  topicTitle: string
  kind: string
  facetPart: string
  statement: string
  updatedAt: string
}

export interface BuiltCatalog {
  text: string
  warnings: string[]
}

const HEADER = '[기존 프로젝트 지식] — 같은 대상이면 아래 topic/knowledgeKey를 그대로 재사용하라.'
const SATURATED_HEADER = '[포화 주제] — 아래 주제는 이미 커서 새 대상을 더 받지 않는다.'

/** 이번 회의록 본문에 등장하는 facet 어절 수. 많을수록 이번 회의가 다룰 대상에 가깝다. */
function overlapScore(facetPart: string, haystack: string): number {
  if (!haystack) return 0
  const tokens = facetPart.split('-').filter((t) => t.length >= 2)
  let hit = 0
  for (const token of tokens) if (haystack.includes(token)) hit += 1
  return hit
}

function assemble(
  topicLine: string | null,
  itemLines: string[],
  saturatedLines: string[],
): string {
  if (!topicLine && itemLines.length === 0 && saturatedLines.length === 0) return ''
  return [
    '',
    HEADER,
    topicLine ?? '',
    ...itemLines,
    saturatedLines.length > 0 ? SATURATED_HEADER : '',
    ...saturatedLines,
    '',
  ].filter(Boolean).join('\n')
}

export function buildWikiCatalogText(args: {
  topics: CatalogTopic[]
  items: CatalogItem[]
  bodyMd: string
  gatingEnabled: boolean
}): BuiltCatalog {
  const warnings: string[] = []
  const haystack = args.bodyMd.toLowerCase()

  // 목차형 주제는 어느 절에도 싣지 않는다. 카탈로그로 다시 흘리면 흡인체가 되살아난다.
  const usable = args.topics.filter(
    (t) => Boolean(t.title) && !isAgendaStyleWikiTopic(t.title),
  )
  const saturatedIds = new Set(
    args.gatingEnabled
      ? usable.filter((t) => isSaturatedWikiTopic(t.liveCount)).map((t) => t.id)
      : [],
  )

  // 살아있는 항목이 0건인 주제는 재사용 후보가 아니다. 2차 정렬 키(id)가 없으면
  // 리셋이 last_changed_at을 전부 같은 값으로 찍은 직후 창 선택이 비결정적이 된다.
  const advertised = usable
    .filter((t) => t.liveCount > 0 && !saturatedIds.has(t.id))
    .sort((a, b) => (
      b.lastChangedAt.localeCompare(a.lastChangedAt) || a.id.localeCompare(b.id)
    ))
    .slice(0, CATALOG_TOPIC_LIMIT)

  // 정렬 동률 대비: 재구축이 updated_at을 대량 동률로 만들고, 같은 facet이 kind만 달라
  // 공존하는 것은 정상 상태다(wikiSaturationKey 참조). kind·topicId 까지 걸어야 DB 반환
  // 순서와 무관하게 결정적이다.
  const topicIds = new Set(usable.map((t) => t.id))
  const liveItems = args.items
    .filter((i) => topicIds.has(i.topicId))
    .sort((a, b) => (
      b.updatedAt.localeCompare(a.updatedAt)
      || a.facetPart.localeCompare(b.facetPart)
      || a.kind.localeCompare(b.kind)
      || a.topicId.localeCompare(b.topicId)
    ))

  // 포화 주제별 (kind, facet) distinct. 같은 facet이 kind만 달라 여러 항목으로 존재한다.
  // 절의 주제 순서는 주제 줄과 같은 (last_changed_at desc, id asc) — 입력 순서에 기대면
  // 리셋 직후 비결정적이 된다.
  const saturatedTopics = usable
    .filter((t) => saturatedIds.has(t.id))
    .sort((a, b) => (
      b.lastChangedAt.localeCompare(a.lastChangedAt) || a.id.localeCompare(b.id)
    ))
  const saturatedFacets = new Map<string, { title: string; entries: string[] }>()
  for (const topic of saturatedTopics) {
    const seen = new Set<string>()
    const entries = liveItems
      .filter((i) => i.topicId === topic.id)
      .filter((i) => {
        const key = wikiSaturationKey(i.kind, i.facetPart)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => (
        overlapScore(b.facetPart, haystack) - overlapScore(a.facetPart, haystack)
        || b.updatedAt.localeCompare(a.updatedAt)
        || a.facetPart.localeCompare(b.facetPart)
        || a.kind.localeCompare(b.kind)
      ))
      .map((i) => `${i.kind}/${i.facetPart}`)
    if (entries.length > 0) saturatedFacets.set(topic.id, { title: topic.title, entries })
  }

  const renderTopicLine = (count: number): string | null => {
    const names = advertised.slice(0, count).map((t) => t.title)
    return names.length > 0 ? `기존 주제: ${names.join(' / ')}` : null
  }
  // 규칙 5(스펙 §7.3): 창은 전체 최신순으로 뜨고, 그 창에서 포화 소속을 뺀다.
  // 비포화 풀에서 창을 다시 채우면(리필) §8의 순변화 산식이 깨지고 프롬프트가 설계보다
  // 커져 예산 사다리가 상시 발동한다.
  const renderItemLines = (count: number): string[] => liveItems
    .slice(0, count)
    .filter((i) => !saturatedIds.has(i.topicId))
    .map((i) => (
      `- topic="${i.topicTitle}" kind=${i.kind} knowledgeKey="${i.facetPart}"`
      + ` :: ${i.statement.slice(0, CATALOG_STATEMENT_CAP)}`
    ))
  const renderSaturated = (perTopic: number): string[] => [...saturatedFacets.values()]
    .map((v) => `포화 "${v.title}" 기존대상: ${v.entries.slice(0, perTopic).join(', ')}`)

  let topicCount = advertised.length
  for (const [perTopic, itemCount] of LADDER) {
    const text = assemble(
      renderTopicLine(topicCount), renderItemLines(itemCount), renderSaturated(perTopic),
    )
    if (text.length <= CATALOG_CHAR_BUDGET) {
      if (perTopic !== CATALOG_FACETS_PER_TOPIC || itemCount !== CATALOG_ITEM_LIMIT) {
        warnings.push(
          `[wiki] 카탈로그 예산 축소: facet ${perTopic}/주제, 항목 ${itemCount}줄`,
        )
      }
      return { text, warnings }
    }
  }

  // 사다리를 다 내려도 넘으면 주제 줄을 앞에서부터 자른다(§8 ③, facet 4 유지).
  while (topicCount > TOPIC_LINE_FLOOR) {
    topicCount = Math.max(TOPIC_LINE_FLOOR, Math.floor(topicCount / 2))
    const text = assemble(
      renderTopicLine(topicCount), renderItemLines(ITEM_LINES_FLOOR), renderSaturated(4),
    )
    if (text.length <= CATALOG_CHAR_BUDGET) {
      warnings.push(`[wiki] 카탈로그 예산 축소: 주제 줄 ${topicCount}개로 절단`)
      return { text, warnings }
    }
  }

  // 최후 수단(§8 ④): 포화 목록을 주제당 하한까지 내린다. 그래도 넘으면 예산을 넘긴 채
  // 보낸다 — 목록을 0으로 만들면 이력 보호가 사라져 프롬프트 초과보다 나쁘다.
  // 조용히 넘기지 않고 알린다.
  const text = assemble(
    renderTopicLine(topicCount), renderItemLines(ITEM_LINES_FLOOR), renderSaturated(FACETS_FLOOR),
  )
  if (text.length <= CATALOG_CHAR_BUDGET) {
    warnings.push(`[wiki] 카탈로그 예산 축소: 포화 목록 주제당 ${FACETS_FLOOR}개(최후 수단)`)
    return { text, warnings }
  }
  warnings.push(
    `[wiki] 카탈로그 예산 ${CATALOG_CHAR_BUDGET}자 초과(${text.length}자) — `
    + `포화 목록을 주제당 ${FACETS_FLOOR}개로 유지한 채 전송한다`,
  )
  return { text, warnings }
}
