import type { ParsedWbs } from './parse'
import type { Level, TeamCode, OwnerKind } from '@/lib/domain/types'

export interface ImportItem {
  tempId: string; parentTempId: string | null; level: Level
  code: string; sortOrder: number; name: string; biz: string | null; deliverable: string | null
  plannedStart: string | null; plannedEnd: string | null
  owners: { team: TeamCode; kind: OwnerKind }[]
}
export interface ImportError { excelRow: number; message: string }

export function validateAndLink(
  parsed: ParsedWbs,
): { ok: true; items: ImportItem[] } | { ok: false; errors: ImportError[] } {
  const errors: ImportError[] = []
  const items: ImportItem[] = []
  let lastPhase: string | null = null
  let lastTask: string | null = null
  let order = 0

  parsed.rows.forEach((r, i) => {
    const { plannedStart: s, plannedEnd: e } = r
    if ((s && !e) || (!s && e)) errors.push({ excelRow: r.excelRow, message: '시작/종료일 중 하나만 입력됨' })
    if (s && e && s > e) errors.push({ excelRow: r.excelRow, message: '시작일이 종료일보다 늦음' })

    const tempId = `t${i}`
    let parentTempId: string | null = null
    if (r.level === 'phase') { lastPhase = tempId; lastTask = null }
    else if (r.level === 'task') {
      if (!lastPhase) errors.push({ excelRow: r.excelRow, message: 'Task의 상위 Phase 없음' })
      parentTempId = lastPhase; lastTask = tempId
    } else {
      if (!lastTask) errors.push({ excelRow: r.excelRow, message: 'Activity의 상위 Task 없음' })
      parentTempId = lastTask
    }
    items.push({
      tempId, parentTempId, level: r.level, code: r.code, sortOrder: order++,
      name: r.name, biz: r.biz, deliverable: r.deliverable, plannedStart: s, plannedEnd: e, owners: r.owners,
    })
  })

  if (errors.length) return { ok: false, errors }
  return { ok: true, items }
}
