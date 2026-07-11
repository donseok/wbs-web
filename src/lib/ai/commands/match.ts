// src/lib/ai/commands/match.ts
import type { ComputedItem } from '@/lib/domain/types'
import type { CommandCandidate } from './types'

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')

export function collectCandidates(items: ComputedItem[]): CommandCandidate[] {
  const out: CommandCandidate[] = []
  const walk = (nodes: ComputedItem[], phaseName: string) => {
    for (const n of nodes) {
      const ph = n.level === 'phase' ? n.name : phaseName
      if (n.children.length) {
        walk(n.children, ph)
      } else {
        out.push({
          id: n.id,
          name: n.name,
          phaseName: ph,
          ownersText: n.owners.map(o => o.team).join('·') || '미배정',
          currentActual: n.actualPct,
          displayActual: Math.round(n.rolledActualPct),
          plannedStart: n.plannedStart,
          plannedEnd: n.plannedEnd,
        })
      }
    }
  }
  walk(items, '')
  return out
}

export function matchCandidates(query: string, all: CommandCandidate[]): CommandCandidate[] {
  const q = norm(query)
  if (!q) return []
  // 정확 일치는 원문(trim만) 비교 — 정규화 비교는 부분일치 단계에서만 적용한다.
  // (정규화 비교를 여기서 쓰면 "ERP 인터페이스 설계"가 "ERP 인터페이스 설계 검토"를 배제하지 못하는
  // 케이스와 반대로, 공백만 다른 여러 후보를 모두 "정확 일치"로 오판하는 문제가 생긴다.)
  const exact = all.filter(c => c.name.trim() === query.trim())
  if (exact.length) return exact.slice(0, 5)
  return all.filter(c => norm(c.name).includes(q) || q.includes(norm(c.name))).slice(0, 5)
}
