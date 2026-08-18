/**
 * 두 다리(벡터·어휘) 결과의 RRF 융합 + 청크 → 문서 접기.
 *
 * 왜 RRF 인가: 코사인 유사도(0~1)와 trigram word_similarity 는 척도가 달라
 * 직접 더할 수 없다. RRF 는 점수 대신 순위만 쓰므로 정규화가 필요 없고
 * 튜닝 상수가 k 하나다.
 *
 * 왜 새 함수인가: 기존 mergeHybridResults(hybrid.ts:191)는 가중합이고
 * dedup 키에 chunkNo 가 들어 있다. 챗봇이 그 함수를 공유하므로 교체하면
 * 챗봇 검색 결과가 함께 바뀐다. 회귀 위험을 격리하려고 따로 만든다.
 */

import { stripLeadingMeta } from './searchView'

export const RRF_K = 60
const DEFAULT_LIMIT = 20

export interface FusionCandidate {
  domain: string
  entityType: string
  entityId: string
  projectId: string | null
  chunkNo: number
  title: string
  content: string
  href: string
  occurredOn: string | null
}

export interface FusedDocument extends FusionCandidate {
  score: number
  matchedBy: Array<'vector' | 'lexical'>
}

/** 청크가 아니라 문서를 가리키는 키 — chunkNo 를 뺀다. */
function documentKey(candidate: FusionCandidate): string {
  return [
    candidate.projectId ?? 'global',
    candidate.domain,
    candidate.entityType,
    candidate.entityId,
  ].join('\u001f') // 구분자 없이 이으면 서로 다른 튜플이 같은 키가 된다
}

export function fuseSearchResults(
  vector: readonly FusionCandidate[],
  lexical: readonly FusionCandidate[],
  limit: number = DEFAULT_LIMIT,
): FusedDocument[] {
  const merged = new Map<string, FusedDocument>()

  // 다리별 최고 점수를 추적해야 "최고 청크만" 규칙을 지킬 수 있다.
  const legScores = new WeakMap<FusedDocument, { vector: number; lexical: number }>()
  function legScore(doc: FusedDocument, kind: 'vector' | 'lexical'): number {
    return legScores.get(doc)?.[kind] ?? 0
  }
  function setLegScore(doc: FusedDocument, kind: 'vector' | 'lexical', value: number): void {
    const current = legScores.get(doc) ?? { vector: 0, lexical: 0 }
    current[kind] = value
    legScores.set(doc, current)
  }
  function adoptBetterChunk(doc: FusedDocument, candidate: FusionCandidate): void {
    doc.chunkNo = candidate.chunkNo
    doc.content = candidate.content
  }

  const absorb = (list: readonly FusionCandidate[], kind: 'vector' | 'lexical') => {
    list.forEach((candidate, index) => {
      const contribution = 1 / (RRF_K + index + 1)
      const key = documentKey(candidate)
      const existing = merged.get(key)
      if (!existing) {
        const created: FusedDocument = { ...candidate, score: contribution, matchedBy: [kind] }
        merged.set(key, created)
        // 첫 삽입에서도 다리별 점수를 기록해야 한다. 안 하면 다음 청크가 legScore 0 을
        // 읽어 `contribution > 0` 이 항상 참이 되고, 최고점 교체가 아니라 합산이 된다 —
        // §5.4 가 금지한 길이 편향이 그대로 되살아난다.
        setLegScore(created, kind, contribution)
        return
      }
      // 문서 점수는 최고 청크 점수다. 합산하면 청크가 많은 긴 문서가 유리해져
      // similarity() 에서 배제한 길이 편향이 다른 경로로 되살아난다.
      const sameLeg = existing.matchedBy.includes(kind)
      if (sameLeg) {
        // 같은 다리의 다른 청크 — 더 높은 쪽만 남긴다.
        if (contribution > legScore(existing, kind)) {
          existing.score = existing.score - legScore(existing, kind) + contribution
          setLegScore(existing, kind, contribution)
          adoptBetterChunk(existing, candidate)
        }
        return
      }
      existing.matchedBy.push(kind)
      setLegScore(existing, kind, contribution)
      existing.score += contribution
    })
  }

  absorb(vector, 'vector')
  absorb(lexical, 'lexical')

  // Math.max 는 인자에 NaN 이 있으면 NaN 을 돌려주고, slice(0, NaN) 은 빈 배열이 된다 —
  // 잘못된 입력이 "결과 없음" 으로 위장되므로 유한수가 아니면 기본값으로 떨어진다.
  const bounded = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : DEFAULT_LIMIT
  return [...merged.values()]
    .map(doc => ({ ...doc, matchedBy: [...doc.matchedBy].sort() }))
    .sort((a, b) =>
      b.score - a.score
      || (b.occurredOn ?? '').localeCompare(a.occurredOn ?? '')
      || a.entityId.localeCompare(b.entityId))
    .slice(0, bounded)
}

/**
 * 융합에서 "최고 청크"로 뽑힌 청크가 머리말(제목·메타·수평선)뿐이면, 같은 문서의 후보 중
 * 본문이 있는 첫 청크로 교체한다. RPC 가 chunk_no 오름차순으로 반환해 동점에서 chunk 0
 * (머리말)이 항상 이기는데, 청크 하나만으로는 문서에 본문이 있는지 알 수 없어 융합 단계에서
 * 걸러낼 수 없었다 — 그래서 후보 풀 전체를 다시 받아 여기서 교체한다.
 * 대체 후보가 없으면 그대로 둔다(머리말이라도 보이는 게 낫다 — snippetOf 의 폴백과 동일 원칙).
 */
export function preferBodyChunk(
  results: FusedDocument[],
  candidates: readonly FusionCandidate[],
): FusedDocument[] {
  return results.map(doc => {
    if (stripLeadingMeta(doc.content) !== '') return doc
    const key = documentKey(doc)
    const replacement = candidates.find(candidate =>
      documentKey(candidate) === key && stripLeadingMeta(candidate.content) !== '')
    if (!replacement) return doc
    return { ...doc, content: replacement.content, chunkNo: replacement.chunkNo }
  })
}
