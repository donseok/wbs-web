// src/lib/agent/leadLease.ts
// 팀장 lease 요청 본문 파싱 — 순수. 스펙 docs/superpowers/specs/2026-09-23-dflow-lead-lease-design.md §5.
import { isUuidLike } from '@/lib/domain/agentWork'
import { parseHeavyReport, type HeavyReport } from '@/lib/domain/heavyWork'

export const LEAD_LEASE_MAX_PROJECTS = 20
const LABEL_MAX = 120
/** '<PC ID(uuid)>:<리포 경로 cksum>' — 홈 경로를 서버에 보내지 않으려고 경로는 해시로만 받는다. */
export const HOLDER_RE = /^[0-9a-f-]{36}:[0-9]{1,12}$/

export interface LeaseRef { project_id: string; generation: number }
export type LeaseOp =
  | { op: 'acquire'; projects: string[]; holder: string; host: string; agent: string; takeover: boolean }
  | { op: 'renew'; holder: string; leases: LeaseRef[]; heavy?: HeavyReport; heavyError?: string }
  | { op: 'release'; holder: string; leases: LeaseRef[] }

const label = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length >= 1 && t.length <= LABEL_MAX ? t : null
}

export function parseLeaseBody(raw: unknown): LeaseOp | { error: string } {
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  if (b.op !== 'acquire' && b.op !== 'renew' && b.op !== 'release') {
    return { error: 'op 는 acquire·renew·release 중 하나여야 합니다.' }
  }
  if (typeof b.holder !== 'string' || !HOLDER_RE.test(b.holder)) return { error: 'holder 형식이 올바르지 않습니다.' }
  const holder = b.holder
  if (b.op === 'acquire') {
    const ps = b.projects
    if (!Array.isArray(ps) || ps.length < 1 || ps.length > LEAD_LEASE_MAX_PROJECTS
      || !ps.every(p => typeof p === 'string' && isUuidLike(p))) {
      return { error: `projects 는 1~${LEAD_LEASE_MAX_PROJECTS}개의 uuid 여야 합니다.` }
    }
    const host = label(b.host)
    if (!host) return { error: `host 는 1~${LABEL_MAX}자여야 합니다.` }
    const agent = label(b.agent)
    if (!agent) return { error: `agent 는 1~${LABEL_MAX}자여야 합니다.` }
    if (b.takeover !== undefined && typeof b.takeover !== 'boolean') return { error: 'takeover 는 boolean 이어야 합니다.' }
    return { op: 'acquire', projects: [...new Set(ps as string[])], holder, host, agent, takeover: b.takeover === true }
  }
  const ls = b.leases
  if (!Array.isArray(ls) || ls.length < 1 || ls.length > LEAD_LEASE_MAX_PROJECTS) {
    return { error: `leases 는 1~${LEAD_LEASE_MAX_PROJECTS}개여야 합니다.` }
  }
  const leases: LeaseRef[] = []
  for (const l of ls) {
    const o = (typeof l === 'object' && l !== null ? l : {}) as Record<string, unknown>
    if (typeof o.project_id !== 'string' || !isUuidLike(o.project_id)) return { error: 'leases 의 project_id 가 uuid 가 아닙니다.' }
    if (typeof o.generation !== 'number' || !Number.isInteger(o.generation) || o.generation < 1) {
      return { error: 'leases 의 generation 은 1 이상의 정수여야 합니다.' }
    }
    leases.push({ project_id: o.project_id, generation: o.generation })
  }
  if (b.op === 'release' || b.heavy === undefined || b.heavy === null) return { op: b.op, holder, leases }
  // 무거운 작업 표시(2026-09-26) — 틀려도 renew 는 받아들이고 heavy 만 버린다. 거절하면 팀장 lease_keep 이
  // 3회 만에 LEASE_UNREACHABLE 로 멈춘다(표시 기능 하나가 팀장을 죽이면 안 된다).
  const hv = parseHeavyReport(b.heavy)
  return hv.ok ? { op: 'renew', holder, leases, heavy: hv.value } : { op: 'renew', holder, leases, heavyError: hv.error }
}
