export type Level = 'phase' | 'task' | 'activity'
export type TeamCode = 'PMO' | 'DT' | 'ERP' | 'MES'
export type OwnerKind = 'primary' | 'support'
export type Status = 'not_started' | 'in_progress' | 'delayed' | 'done'

export interface WbsRow {
  id: string
  parentId: string | null
  level: Level
  code: string
  sortOrder: number
  name: string
  deliverable: string | null
  plannedStart: string | null   // 'YYYY-MM-DD'
  plannedEnd: string | null
  weight: number | null         // null이면 형제 균등
  actualPct: number | null      // leaf만 의미 있음, 0~100
  owners: { team: TeamCode; kind: OwnerKind }[]
}

export interface ComputedItem extends WbsRow {
  plannedPct: number    // 계산값 0~100
  rolledActualPct: number  // leaf=actualPct, 상위=가중 롤업
  achievement: number | null  // rolledActual/planned, planned=0이면 null
  status: Status
  children: ComputedItem[]
}
