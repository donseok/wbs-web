/* ── 주간보고 점검(순수) — 중복·체번·공백 규칙과 수정 편집 생성. I/O 없음. ── */

import {
  CELL_FIELD, WEEKLY_CELL_KEYS, WEEKLY_CELL_LABEL,
  type WeeklyCellEdit, type WeeklyCellKey, type WeeklySheetRow,
} from './weeklySheet'

export type LintKind = 'duplicate' | 'numbering' | 'format'

export interface LintFinding {
  /** 안정 키(React list). 같은 지적이면 재계산해도 같은 값이어야 한다. */
  id: string
  kind: LintKind
  /** 클릭 시 이동할 대표 셀. 중복은 '삭제 대상' 중 sortOrder가 가장 작은 행. */
  rowId: string
  cellKey: WeeklyCellKey
  /** 목록 제목 — 예: `PMO · 금주실적 내용` */
  title: string
  /** 무엇이 문제이고 적용하면 어떻게 되는지 */
  detail: string
  /** 적용할 편집. 기존 배치 편집 단위를 그대로 쓴다. */
  edits: WeeklyCellEdit[]
}

/** 인정하는 글머리 기호. 배열 순서 = 다수결 동수 시 우선순위(- 우선). */
export const BULLETS = ['-', '·', '*', '●'] as const

/** 선두 줄 번호: 숫자 + (. 또는 )) + 뒤따르는 공백(없을 수도). */
const NUM_PREFIX = /^(\d+)([.)])( *)/
/** 글머리 기호로 인정하는 형태 — 기호 뒤에 공백이 반드시 온다.
 *  `-5%` 같은 본문을 기호로 오인해 고쳐 쓰지 않기 위한 보수적 판정. */
const BULLET_PREFIX = /^([-·*●])( +)(?=\S)/

/** 비교 전용 정규화 — 저장 값에는 영향이 없다. 기호·번호를 떼고 공백을 접어,
 *  `- 설계 리뷰 완료`와 `1. 설계  리뷰 완료`를 같은 줄로 보게 한다. */
export function normalizeForCompare(line: string): string {
  let s = line.replace(/　/g, ' ').trim()
  // 기호와 번호가 겹쳐 붙은 경우(`- 1. 항목`)까지 커버하되, 무한 반복은 막는다.
  for (let i = 0; i < 2; i++) {
    const next = s.replace(NUM_PREFIX, '').replace(/^[-·*●] */, '').trimStart()
    if (next === s) break
    s = next
  }
  return s.replace(/\s+/g, ' ').trim()
}

/** 셀 값을 줄 배열로. 빈 문자열은 빈 배열(빈 줄 1개가 아니라). */
const toLines = (content: string): string[] => (content === '' ? [] : content.split('\n'))

/** 지정 인덱스의 줄을 지운 결과. 전부 공백만 남으면 빈 셀로 만든다. */
function removeLines(content: string, drop: ReadonlySet<number>): string {
  const kept = toLines(content).filter((_, i) => !drop.has(i))
  const joined = kept.join('\n')
  return joined.trim() === '' ? '' : joined
}

/** 규칙 ① — 같은 열에서 구분 행을 가로지르는 동일 줄. 같은 셀 안 중복은 대상이 아니다. */
export function lintDuplicates(rows: WeeklySheetRow[]): LintFinding[] {
  const ordered = [...rows].sort((a, b) => a.sortOrder - b.sortOrder)
  const byId = new Map(ordered.map(r => [r.id, r]))
  const out: LintFinding[] = []

  for (const cellKey of WEEKLY_CELL_KEYS) {
    // 정규화 줄 → 등장 위치들. ordered 순회라 배열 앞쪽이 곧 sortOrder가 작은 쪽이다.
    const groups = new Map<string, { rowId: string; line: number }[]>()
    for (const row of ordered) {
      toLines(row[CELL_FIELD[cellKey]]).forEach((raw, line) => {
        const norm = normalizeForCompare(raw)
        if (!norm) return
        const hits = groups.get(norm)
        if (hits) hits.push({ rowId: row.id, line })
        else groups.set(norm, [{ rowId: row.id, line }])
      })
    }

    for (const [norm, hits] of groups) {
      const keepRowId = hits[0].rowId
      const victims = hits.filter(h => h.rowId !== keepRowId)
      if (victims.length === 0) continue // 한 구분 안에서만 반복 — 대상 아님

      // 행별로 지울 줄 번호를 모아 셀당 편집 1개로. victims는 ordered 순서를 물려받는다.
      const dropByRow = new Map<string, Set<number>>()
      for (const v of victims) {
        const s = dropByRow.get(v.rowId)
        if (s) s.add(v.line)
        else dropByRow.set(v.rowId, new Set([v.line]))
      }
      const edits: WeeklyCellEdit[] = [...dropByRow].map(([rowId, drop]) => ({
        rowId, cellKey, content: removeLines(byId.get(rowId)![CELL_FIELD[cellKey]], drop),
      }))

      const keepSection = byId.get(keepRowId)!.section
      const victimSections = [...dropByRow.keys()].map(id => byId.get(id)!.section)
      out.push({
        id: `duplicate:${cellKey}:${norm}`,
        kind: 'duplicate',
        rowId: edits[0].rowId,
        cellKey,
        title: WEEKLY_CELL_LABEL[cellKey],
        detail: `${[keepSection, ...victimSections].join(' · ')}에 같은 줄이 있습니다: "${norm}" — ${victimSections.join(' · ')}에서 이 줄을 지웁니다.`,
        edits,
      })
    }
  }
  return out
}
