import { describe, it, expect, vi, beforeEach } from 'vitest'

/** wbs.md 웹 업로드 액션 — 미리보기(자동 부착 판정)·적용(runWbsImport 공유 코어).
 *  계약: 스펙 §업로드 경로 2개 — 웹 경로 = 자동 부착 + 확인(미리보기 카드 → [적용/취소]). */

const { db, requireProjectAdmin, runWbsImport } = vi.hoisted(() => {
  const db = {
    // 테이블별 응답 큐 — agent 라우트 테스트와 동형
    queues: {} as Record<string, Array<{ data?: unknown; error?: { message: string } | null }>>,
  }
  return {
    db,
    requireProjectAdmin: vi.fn(),
    runWbsImport: vi.fn(),
  }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const resp = (db.queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'like', 'limit']) b[k] = () => b
      // ensureAgentProject(applyWbsUpload 의 자동 활성 경로, 2026-08-24)의 insert — 결과를 안 쓰는
      // fire-and-forget 형 호출이라 성공만 흉내낸다. 활성 여부는 agent_projects 큐로 제어한다.
      b.insert = () => Promise.resolve({ data: null, error: null })
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    },
  }),
}))
vi.mock('@/lib/agent/wbsImport', async (orig) => ({
  ...(await orig() as object),
  runWbsImport: (...a: unknown[]) => runWbsImport(...a),
}))

import { previewWbsUpload, applyWbsUpload } from '@/app/actions/wbsMarkdown'

const PID = 'proj-1'
const ADMIN = { ok: true as const, actor: { userId: 'u-admin', isSuperuser: false } }

const PL_MD = `---
module: mes-qa
attach: PH-03/SYS-QA

levels:
  - { name: Phase,     prefix: PH,  progress: rollup, owner: pmo, upload: false }
  - { name: System,    prefix: SYS, progress: rollup, owner: pmo, upload: false }
  - { name: Subsystem, prefix: SUB, progress: rollup }
  - { name: Task,      prefix: TSK, progress: input }
  - { name: SubTask,   prefix: STK, progress: checklist, optional: true, upload: fold }
---

## SUB-QA-JD: 판정
- [ ] TSK-QA-JD-01: 자동판정   w:5  ~2026-12-19
  - [ ] STK-QA-JD-01-1: 룰 리뷰
- [ ] TSK-QA-JD-02: 재판정   w:3  ~2026-12-26
`

const SKEL_MD = `---
module: mes-skel

levels:
  - { name: Phase, prefix: PH,  progress: rollup }
  - { name: Task,  prefix: TSK, progress: input }
---

## PH-01: 분석
- [ ] TSK-AN-01: 분석서   w:5  ~2026-09-30
`

const SERVER_LABELS = ['Phase', 'System', 'Subsystem', 'Task', 'SubTask']

beforeEach(() => {
  db.queues = {}
  requireProjectAdmin.mockReset()
  requireProjectAdmin.mockResolvedValue(ADMIN)
  runWbsImport.mockReset()
})

describe('previewWbsUpload', () => {
  it('관리자 아님 → 거부, DB 접근 없음', async () => {
    requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한이 없습니다.' })
    const r = await previewWbsUpload(PID, PL_MD)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('권한')
  })

  it('PL 파일 — attach 자동 판정 + levels 일치 + 신규/갱신 분류 + fold 건수', async () => {
    db.queues = {
      wbs_items: [
        { data: [{ external_ref: 'mes-skel/SYS-QA' }] },          // attach suffix 해석 (유일)
        { data: [{ external_ref: 'mes-qa/TSK-QA-JD-02' }] },      // 기존 ref 조회 → 1건은 갱신
      ],
      project_settings: [{ data: { level_labels: SERVER_LABELS } }],
    }
    const r = await previewWbsUpload(PID, PL_MD)
    expect(r.ok).toBe(true)
    expect(r).toMatchObject({
      mode: 'pl', module: 'mes-qa', attach: 'PH-03/SYS-QA',
      attachRef: 'mes-skel/SYS-QA', attachFound: true,
      levelsStatus: 'match', foldCount: 1, newCount: 2, updateCount: 1, canApply: true,
    })
    expect(r.counts).toMatchObject({ Subsystem: 1, Task: 2, SubTask: 1 })
  })

  it('attach 노드 없음 → attachFound:false, canApply:false', async () => {
    db.queues = {
      wbs_items: [{ data: [] }, { data: [] }],
      project_settings: [{ data: { level_labels: SERVER_LABELS } }],
    }
    const r = await previewWbsUpload(PID, PL_MD)
    expect(r.ok).toBe(true)
    expect(r.attachFound).toBe(false)
    expect(r.canApply).toBe(false)
  })

  it('levels 불일치 → levelsStatus:mismatch, canApply:false', async () => {
    db.queues = {
      wbs_items: [{ data: [{ external_ref: 'mes-skel/SYS-QA' }] }, { data: [] }],
      project_settings: [{ data: { level_labels: ['Phase', 'Task', 'Activity'] } }],
    }
    const r = await previewWbsUpload(PID, PL_MD)
    expect(r.levelsStatus).toBe('mismatch')
    expect(r.canApply).toBe(false)
  })

  it('골격 파일(attach 없음) → mode:skeleton, levelsStatus:seed', async () => {
    db.queues = { wbs_items: [{ data: [] }] } // 기존 ref 조회만
    const r = await previewWbsUpload(PID, SKEL_MD)
    expect(r).toMatchObject({ mode: 'skeleton', levelsStatus: 'seed', canApply: true })
  })

  it('검증 에러가 있으면 errors 전량 + canApply:false', async () => {
    const bad = PL_MD.replace('## SUB-QA-JD: 판정', '## PH-03: 구축\n\n## SUB-QA-JD: 판정')
    db.queues = {
      wbs_items: [{ data: [{ external_ref: 'mes-skel/SYS-QA' }] }, { data: [] }],
      project_settings: [{ data: { level_labels: SERVER_LABELS } }],
    }
    const r = await previewWbsUpload(PID, bad)
    expect(r.errors?.some(e => e.includes('골격'))).toBe(true)
    expect(r.canApply).toBe(false)
  })
})

describe('applyWbsUpload', () => {
  it('정상 PL — runWbsImport 에 해석된 attachRef·module·levels·노드가 넘어간다', async () => {
    db.queues = {
      wbs_items: [{ data: [{ external_ref: 'mes-skel/SYS-QA' }] }],
      project_settings: [{ data: { level_labels: SERVER_LABELS } }],
      agent_projects: [{ data: { enabled: true } }], // 이미 활성 — ensureAgentProject no-op
    }
    runWbsImport.mockResolvedValue({ ok: true, upserted: 3, skipped: 0, unmatched: [], nonLeafSkipped: [], ordersCreated: 2 })
    const r = await applyWbsUpload(PID, PL_MD)
    expect(r).toMatchObject({ ok: true, upserted: 3, ordersCreated: 2 })
    expect(runWbsImport).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      projectId: PID, module: 'mes-qa', attachRef: 'mes-skel/SYS-QA', actorUserId: 'u-admin',
      nodes: expect.arrayContaining([expect.objectContaining({ id: 'TSK-QA-JD-01', level: 3, weight: 5 })]),
    }))
  })

  it('검증 에러 파일 — runWbsImport 를 호출하지 않는다(fail-closed, 클라이언트 신뢰 안 함)', async () => {
    const bad = PL_MD.replace('- [ ] TSK-QA-JD-02: 재판정', '- [ ] TSK-QA-JD-01: 중복')
    const r = await applyWbsUpload(PID, bad)
    expect(r.ok).toBe(false)
    expect(runWbsImport).not.toHaveBeenCalled()
  })

  it('코어 실패는 메시지 그대로 반환', async () => {
    db.queues = {
      wbs_items: [{ data: [{ external_ref: 'mes-skel/SYS-QA' }] }],
      project_settings: [{ data: { level_labels: SERVER_LABELS } }],
      agent_projects: [{ data: { enabled: true } }],
    }
    runWbsImport.mockResolvedValue({ ok: false, code: 'attach_not_found', message: 'attach 노드가 없습니다' })
    const r = await applyWbsUpload(PID, PL_MD)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('attach')
  })
})
