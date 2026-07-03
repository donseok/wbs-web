import type { ParsedWbs } from './parse'
import type { Level, TeamCode, OwnerKind } from '@/lib/domain/types'

export interface ImportItem {
  tempId: string; parentTempId: string | null; level: Level
  code: string; sortOrder: number; name: string; biz: string | null; deliverable: string | null
  plannedStart: string | null; plannedEnd: string | null
  weight: number | null; actualPct: number | null
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
      name: r.name, biz: r.biz, deliverable: r.deliverable, plannedStart: s, plannedEnd: e,
      weight: r.weight, actualPct: r.actualPct, owners: r.owners,
    })
  })

  if (errors.length) return { ok: false, errors }
  return { ok: true, items }
}

/**
 * 복수 담당 말단 항목을 담당별 sub-activity 로 분리한다.
 * 엑셀 원본 행(이름·일정·가중치·실적·담당 표기)은 그대로 두고, 그 아래에 팀당 1개의
 * activity 를 생성해 팀별 일정·실적을 따로 관리할 수 있게 한다.
 * - sub-act 이름은 "{원본 작업명} ({팀} 주관/지원)" — 리프 이름만 소비하는 하류(DK Bot
 *   검색·색인, 주간보고 행, 알림, 대시보드/칸반)에서 작업 식별이 가능해야 하기 때문.
 *   biz·산출물도 같은 이유로 승계한다.
 * - 일정·실적 승계(→ 롤업 결과가 원본과 동일), 가중치 null(형제 균등), 담당 1팀.
 * - 자식이 있는 항목의 복수 담당은 표시용이므로 분리하지 않는다.
 * - 말단 phase 는 분리하지 않는다 — phase 직속 activity 는 엑셀 3단 형식으로 내보낼 자리가
 *   없어(D열 행이 Task 없이 등장) 재임포트가 검증 오류로 실패한다.
 * - 재번호된 sortOrder 가 문서 순서를 보존한다(형제 정렬은 sortOrder 기준).
 */
export function splitLeafOwners(items: ImportItem[]): ImportItem[] {
  const hasChild = new Set(items.map(i => i.parentTempId).filter(Boolean))
  const out: ImportItem[] = []
  for (const it of items) {
    out.push(it)
    if (it.level === 'phase' || hasChild.has(it.tempId) || it.owners.length < 2) continue
    it.owners.forEach((o, i) => {
      out.push({
        tempId: `${it.tempId}s${i}`,
        parentTempId: it.tempId,
        level: 'activity',
        code: it.code,
        sortOrder: 0, // 아래에서 문서 순서로 전체 재번호
        name: `${it.name} (${o.team} ${o.kind === 'primary' ? '주관' : '지원'})`,
        biz: it.biz,
        deliverable: it.deliverable,
        plannedStart: it.plannedStart,
        plannedEnd: it.plannedEnd,
        weight: null,
        actualPct: it.actualPct,
        owners: [o],
      })
    })
  }
  return out.map((it, i) => ({ ...it, sortOrder: i }))
}
