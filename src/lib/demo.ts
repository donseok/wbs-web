// TEMPORARY DEMO MODE — lets you log in and browse the real app pages WITHOUT
// a live Supabase project. Enabled only when NEXT_PUBLIC_DEMO_MODE=1 (off by
// default). Reads the real WBS.xlsx and assigns sample actuals. Auth is bypassed
// and writes are no-ops. DO NOT enable this in production. Remove once Supabase
// is wired up.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseWbsWorkbook } from '@/lib/excel/parse'
import { validateAndLink } from '@/lib/excel/validate'
import { computeTree } from '@/lib/domain/rollup'
import type { AttendanceRecord, ComputedItem, Membership, ProjectMember, WbsRow } from '@/lib/domain/types'

export const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === '1'
export const DEMO_PROJECT_ID = 'demo'
export const DEMO_TODAY = '2026-09-15'
export const DEMO_MEMBERSHIP: Membership = {
  role: 'pmo_admin',
  teamCode: 'PMO',
  teamId: 'demo',
}
export const DEMO_PROJECT = {
  id: DEMO_PROJECT_ID,
  name: 'D-CUBE PI Master Plan 수립 (데모)',
  description: '계획부터 완료까지 투명하게 — WBS·일정·멤버·근태를 하나의 흐름으로 관리하는 데모 워크스페이스입니다.',
  start_date: '2026-06-29',
  end_date: '2027-01-04',
  created_at: '2026-06-29T00:00:00.000Z',
}

export const DEMO_MEMBERS: ProjectMember[] = [
  { id: 'm1', projectId: DEMO_PROJECT_ID, name: '이돈석', email: 'lee@dcube.io', teamCode: 'PMO', role: 'admin', title: 'PM / 프로젝트 총괄', createdAt: '2026-06-29T00:00:00Z' },
  { id: 'm2', projectId: DEMO_PROJECT_ID, name: '장한솔', email: 'jang@dcube.io', teamCode: 'PMO', role: 'admin', title: 'PMO 매니저', createdAt: '2026-06-29T00:00:00Z' },
  { id: 'm3', projectId: DEMO_PROJECT_ID, name: '조한운', email: 'cho@dcube.io', teamCode: 'DT', role: 'contributor', title: '데이터 전환 리드', createdAt: '2026-06-30T00:00:00Z' },
  { id: 'm4', projectId: DEMO_PROJECT_ID, name: '박서연', email: 'park@dcube.io', teamCode: 'DT', role: 'contributor', title: '인프라 엔지니어', createdAt: '2026-07-01T00:00:00Z' },
  { id: 'm5', projectId: DEMO_PROJECT_ID, name: '김민재', email: 'kim@dcube.io', teamCode: 'ERP', role: 'contributor', title: 'ERP 컨설턴트', createdAt: '2026-07-01T00:00:00Z' },
  { id: 'm6', projectId: DEMO_PROJECT_ID, name: '최유진', email: 'choi@dcube.io', teamCode: 'ERP', role: 'contributor', title: 'FI/CO 모듈', createdAt: '2026-07-02T00:00:00Z' },
  { id: 'm7', projectId: DEMO_PROJECT_ID, name: '윤도현', email: 'yoon@dcube.io', teamCode: 'MES', role: 'contributor', title: 'MES 개발', createdAt: '2026-07-02T00:00:00Z' },
  { id: 'm8', projectId: DEMO_PROJECT_ID, name: 'Nguyen Van A', email: 'nguyen@dcube.io', teamCode: 'MES', role: 'contributor', title: 'SW 개발 (베트남)', createdAt: '2026-07-03T00:00:00Z' },
]

// DEMO_TODAY(2026-09-15) 주변 9월 근태 샘플
export const DEMO_ATTENDANCE: AttendanceRecord[] = [
  { id: 'a1', projectId: DEMO_PROJECT_ID, memberId: 'm3', date: '2026-09-14', type: 'trip', note: '부산공장 현장 점검' },
  { id: 'a2', projectId: DEMO_PROJECT_ID, memberId: 'm3', date: '2026-09-15', type: 'trip', note: '부산공장 현장 점검' },
  { id: 'a3', projectId: DEMO_PROJECT_ID, memberId: 'm4', date: '2026-09-15', type: 'remote', note: null },
  { id: 'a4', projectId: DEMO_PROJECT_ID, memberId: 'm5', date: '2026-09-11', type: 'annual', note: '개인 연차' },
  { id: 'a5', projectId: DEMO_PROJECT_ID, memberId: 'm6', date: '2026-09-15', type: 'half', note: '오후 반차' },
  { id: 'a6', projectId: DEMO_PROJECT_ID, memberId: 'm7', date: '2026-09-10', type: 'sick', note: '병가' },
  { id: 'a7', projectId: DEMO_PROJECT_ID, memberId: 'm8', date: '2026-09-15', type: 'remote', note: '시차 근무' },
  { id: 'a8', projectId: DEMO_PROJECT_ID, memberId: 'm2', date: '2026-09-16', type: 'trip', note: '본사 보고' },
  { id: 'a9', projectId: DEMO_PROJECT_ID, memberId: 'm1', date: '2026-09-18', type: 'annual', note: null },
]

const SAMPLE_ACTUALS = [100, 90, 70, 45, 20, 0]

export async function loadDemoWbs(): Promise<{ items: ComputedItem[]; holidays: string[]; today: string }> {
  const buf = await readFile(path.join(process.cwd(), 'docs/WBS-original.xlsx'))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const parsed = parseWbsWorkbook(ab)
  const res = validateAndLink(parsed)
  if (!res.ok) throw new Error('데모 데이터 검증 실패: ' + JSON.stringify(res.errors))

  const parentIds = new Set(res.items.map(i => i.parentTempId).filter(Boolean) as string[])
  let leafIdx = 0
  const rows: WbsRow[] = res.items.map(it => {
    const isLeaf = !parentIds.has(it.tempId)
    return {
      id: it.tempId,
      parentId: it.parentTempId,
      level: it.level,
      code: it.code,
      sortOrder: it.sortOrder,
      name: it.name,
      biz: it.biz,
      deliverable: it.deliverable,
      plannedStart: it.plannedStart,
      plannedEnd: it.plannedEnd,
      // 파싱값 우선, 없으면 기존 폴백(null=균등)
      weight: it.weight ?? null,
      // leaf: 파싱값 있으면 사용, 없으면 샘플 실적(데모가 0%로 죽지 않게). non-leaf는 null.
      actualPct: isLeaf
        ? (it.actualPct ?? SAMPLE_ACTUALS[leafIdx++ % SAMPLE_ACTUALS.length])
        : null,
      owners: it.owners,
    }
  })
  const holidays = new Set(parsed.holidays.map(h => h.date))
  return { items: computeTree(rows, DEMO_TODAY, holidays), holidays: [...holidays], today: DEMO_TODAY }
}
