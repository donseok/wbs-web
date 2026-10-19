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
      for (const k of ['select', 'eq', 'in', 'like', 'limit', 'not', 'order', 'range']) b[k] = () => b
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
    runWbsImport.mockResolvedValue({ ok: true, upserted: 3, skipped: 0, unmatched: [], nonLeafSkipped: [], ordersCreated: 2, delegationCancelled: 0, delegationCancelFailed: [] })
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

  // L7(리뷰 수정 1회차) — 코어의 취소 건수·실패 ref 를 버리지 않고 그대로 돌려준다(웹 업로드도 PAT 응답과
  // 같은 정보를 사용자에게 보여줘야 한다 — "새 칸은 PAT 응답에만"은 레거시 v1 API 규칙이지 서버 액션엔 해당 없음).
  it('L7 — 코어가 돌려준 취소 건수·실패 ref 를 그대로 담는다', async () => {
    db.queues = {
      wbs_items: [{ data: [{ external_ref: 'mes-skel/SYS-QA' }] }],
      project_settings: [{ data: { level_labels: SERVER_LABELS } }],
      agent_projects: [{ data: { enabled: true } }],
    }
    runWbsImport.mockResolvedValue({
      ok: true, upserted: 3, skipped: 0, unmatched: [], nonLeafSkipped: [], ordersCreated: 2,
      delegationCancelled: 2, delegationCancelFailed: ['TSK-QA-JD-02'],
    })
    const r = await applyWbsUpload(PID, PL_MD)
    expect(r).toMatchObject({ ok: true, delegationCancelled: 2, delegationCancelFailed: ['TSK-QA-JD-02'] })
  })

  it('L7 — 취소 0건·실패 없음이면 그 두 칸을 응답에 싣지 않는다', async () => {
    db.queues = {
      wbs_items: [{ data: [{ external_ref: 'mes-skel/SYS-QA' }] }],
      project_settings: [{ data: { level_labels: SERVER_LABELS } }],
      agent_projects: [{ data: { enabled: true } }],
    }
    runWbsImport.mockResolvedValue({
      ok: true, upserted: 3, skipped: 0, unmatched: [], nonLeafSkipped: [], ordersCreated: 2,
      delegationCancelled: 0, delegationCancelFailed: [],
    })
    const r = await applyWbsUpload(PID, PL_MD)
    expect(r).not.toHaveProperty('delegationCancelled')
    expect(r).not.toHaveProperty('delegationCancelFailed')
  })
})

// ── 기존 3~4단(classic) 형식 — 2026-10-19 화면 직접 업로드 ─────────────────────────────
// 파서 동등성은 tests/lib/wbsmd-classic.test.ts 가 맡는다. 여기는 형식 분기·module·서버 재검증·N단 경계를 본다.

const CLASSIC_MD = `# WBS - 시험

## WP-01: 초기화
- schedule: 2026-11-02 ~ 2026-11-06

### TSK-01-01: 저장소 구성
- category: infra
- status: [ ]
- priority: critical
- schedule: 2026-11-02 ~ 2026-11-03
- depends: -

### TSK-01-02: 설정 모듈
- category: dev
- status: [ ]
- priority: high
- schedule: 2026-11-04 ~ 2026-11-06
- depends: TSK-01-01
`

type Row = { external_ref: string; level_idx: number | null; stub_for: string | null }
const row = (external_ref: string, level_idx: number | null = null, stub_for: string | null = null): Row =>
  ({ external_ref, level_idx, stub_for })

describe('previewWbsUpload — classic(기존 3~4단)', () => {
  it('관리자 아님 → 거부, DB 접근 없음', async () => {
    requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한이 없습니다.' })
    db.queues = { wbs_items: [{ data: [row('oranda/WP-01')] }] }
    const r = await previewWbsUpload(PID, CLASSIC_MD)
    expect(r).toEqual({ ok: false, error: '권한이 없습니다.' })
    expect(db.queues.wbs_items).toHaveLength(1) // 큐를 건드리지 않았다
  })

  it('module 미지정 → 기존 형식 행의 module 최빈값을 제안(N단·스텁 행 제외) + 신규/갱신은 module/ID 로', async () => {
    db.queues = { wbs_items: [{ data: [
      row('oranda/WP-01'), row('oranda/TSK-01-01'), row('other/TSK-09-01'),
      row('zzz/TSK-01-01.stub.a', null, 'zzz/TSK-00-01'), row('zzz/TSK-01-02.stub.b', null, 'zzz/TSK-00-01'),
      row('zzz/TSK-01-03.stub.c', null, 'zzz/TSK-00-01'),
    ] }] }
    const r = await previewWbsUpload(PID, CLASSIC_MD)
    expect(r).toMatchObject({
      ok: true, format: 'classic', module: 'oranda', moduleSuggested: 'oranda',
      newCount: 1, updateCount: 2, errors: [], warnings: [], canApply: true,
    })
    expect(r.counts).toEqual({ WP: 1, TSK: 2 })
    expect(r.mode).toBeUndefined() // N단 전용 칸은 비운다
  })

  it('module 지정 → 그 값으로 신규/갱신을 다시 계산한다', async () => {
    db.queues = { wbs_items: [{ data: [row('oranda/WP-01'), row('oranda/TSK-01-01'), row('other/TSK-01-02')] }] }
    const r = await previewWbsUpload(PID, CLASSIC_MD, { module: ' other ' })
    expect(r).toMatchObject({ module: 'other', moduleSuggested: 'oranda', newCount: 2, updateCount: 1, canApply: true })
  })

  it('제안할 module 이 없으면 빈칸 + 필수 에러, 신규/갱신은 계산하지 않는다', async () => {
    db.queues = { wbs_items: [{ data: [] }] }
    const r = await previewWbsUpload(PID, CLASSIC_MD)
    expect(r).toMatchObject({ ok: true, format: 'classic', module: '', moduleSuggested: null, canApply: false })
    expect(r.errors?.some(e => e.includes('module 을 입력하세요'))).toBe(true)
    expect(r.newCount).toBeUndefined()
  })

  it('module 형식 위반 → 에러', async () => {
    db.queues = { wbs_items: [{ data: [] }] }
    const r = await previewWbsUpload(PID, CLASSIC_MD, { module: 'mes/qa' })
    expect(r.errors?.some(e => e.includes('module 형식'))).toBe(true)
    expect(r.canApply).toBe(false)
  })

  it('적용 코어(toRpcNode)가 거부할 priority·schedule 을 미리보기 에러로 보여 준다', async () => {
    db.queues = { wbs_items: [{ data: [] }] }
    const bad = CLASSIC_MD.replace('- priority: critical', '- priority: P1').replace('2026-11-04 ~ 2026-11-06', '11/4 ~ 11/6')
    const r = await previewWbsUpload(PID, bad, { module: 'oranda' })
    expect(r.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('허용 밖 priority 라벨: P1 (TSK-01-01)'),
      expect.stringContaining('schedule 형식 오류: 11/4 ~ 11/6 (TSK-01-02)'),
    ]))
    expect(r.canApply).toBe(false)
  })

  it('ID 중복 → 에러(뒤 노드가 앞 노드를 조용히 덮는 것을 막는다)', async () => {
    db.queues = { wbs_items: [{ data: [] }] }
    const dup = CLASSIC_MD.replace('### TSK-01-02: 설정 모듈', '### TSK-01-01: 설정 모듈')
    const r = await previewWbsUpload(PID, dup, { module: 'oranda' })
    expect(r.errors).toContain('ID 중복: TSK-01-01')
    expect(r.canApply).toBe(false)
  })

  it('N단(level_idx 있는) 노드와 external_ref 가 겹치면 에러 — 덮으면 단계·부착점이 망가진다', async () => {
    db.queues = { wbs_items: [{ data: [row('mes-qa/TSK-01-01', 3), row('mes-qa/SUB-QA', 2)] }] }
    const r = await previewWbsUpload(PID, CLASSIC_MD, { module: 'mes-qa' })
    expect(r.errors?.some(e => e.includes('N단(levels 계약) 노드 1건') && e.includes('TSK-01-01'))).toBe(true)
    expect(r.canApply).toBe(false)
  })

  it('N단 노드가 있지만 겹치지 않으면 경고만(적용 가능)', async () => {
    db.queues = { wbs_items: [{ data: [row('mes-qa/TSK-QA-01', 3)] }] }
    const r = await previewWbsUpload(PID, CLASSIC_MD, { module: 'oranda' })
    expect(r.errors).toEqual([])
    expect(r.warnings?.some(w => w.includes('N단(levels 계약) 노드가 있습니다'))).toBe(true)
    expect(r.canApply).toBe(true)
  })

  it('기존 ref 는 페이지로 끝까지 읽는다(1000건 다음 페이지의 갱신도 센다)', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => row(`bulk/R-${i}`))
    db.queues = { wbs_items: [{ data: page1 }, { data: [row('oranda/TSK-01-02')] }] }
    const r = await previewWbsUpload(PID, CLASSIC_MD, { module: 'oranda' })
    expect(r).toMatchObject({ updateCount: 1, newCount: 2, moduleSuggested: 'bulk' })
    expect(db.queues.wbs_items).toHaveLength(0)
  })

  it('기존 ref 조회 실패 → ok:false(빈 결과로 위장하지 않는다)', async () => {
    db.queues = { wbs_items: [{ error: { message: 'boom' } }] }
    const r = await previewWbsUpload(PID, CLASSIC_MD, { module: 'oranda' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('기존 노드 조회 실패')
  })
})

describe('previewWbsUpload — unknown 형식', () => {
  it('N단 검증 에러를 그대로 두고 맨 앞에 받는 형식 안내를 덧붙인다', async () => {
    db.queues = { wbs_items: [{ data: [] }] }
    const r = await previewWbsUpload(PID, '# 메모\n\n## SUB-QA: 판정\n- [ ] TSK-QA-01: 자동판정\n')
    expect(r.format).toBe('unknown')
    expect(r.errors?.[0]).toContain('받는 형식은 두 가지입니다')
    expect(r.errors?.some(e => e.startsWith('levels 검증 실패'))).toBe(true)
    expect(r.canApply).toBe(false)
  })

  it('N단 파일은 format:nlevel 로 표시하고 안내를 붙이지 않는다', async () => {
    db.queues = { wbs_items: [{ data: [] }] }
    const r = await previewWbsUpload(PID, SKEL_MD)
    expect(r.format).toBe('nlevel')
    expect(r.errors?.some(e => e.includes('받는 형식은'))).toBe(false)
  })
})

describe('applyWbsUpload — classic(기존 3~4단)', () => {
  const OK_RESULT = { ok: true, upserted: 3, skipped: 0, unmatched: [], nonLeafSkipped: [], ordersCreated: 2, delegationCancelled: 0, delegationCancelFailed: [] }

  it('module 없이 적용 → 거부, 서버가 다시 제안하지 않는다(runWbsImport 미호출)', async () => {
    db.queues = { wbs_items: [{ data: [row('oranda/WP-01')] }] }
    const r = await applyWbsUpload(PID, CLASSIC_MD)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('module 이 필요합니다')
    expect(runWbsImport).not.toHaveBeenCalled()
  })

  it('module 형식 위반 → 거부', async () => {
    const r = await applyWbsUpload(PID, CLASSIC_MD, { module: '../x' })
    expect(r).toEqual({ ok: false, error: 'module 형식이 올바르지 않습니다.' })
    expect(runWbsImport).not.toHaveBeenCalled()
  })

  it('정상 — levels=null·attachRef=null 로 코어를 탄다(API 라우트의 levels 없는 호출과 같음)', async () => {
    db.queues = {
      wbs_items: [{ data: [row('oranda/WP-01')] }],
      agent_projects: [{ data: { enabled: true } }],
    }
    runWbsImport.mockResolvedValue(OK_RESULT)
    const r = await applyWbsUpload(PID, CLASSIC_MD, { module: 'oranda' })
    expect(r).toMatchObject({ ok: true, upserted: 3, ordersCreated: 2, taskCount: 2 })
    expect(runWbsImport).toHaveBeenCalledTimes(1)
    const args = runWbsImport.mock.calls[0][1] as { levels: unknown; attachRef: unknown; module: string; nodes: Array<Record<string, unknown>> }
    expect(args).toMatchObject({ projectId: PID, module: 'oranda', actorUserId: 'u-admin', levels: null, attachRef: null })
    expect(args.nodes.map(n => `${n.kind}:${n.id}<${n.parent_id}>`)).toEqual(['wp:WP-01<null>', 'task:TSK-01-01<WP-01>', 'task:TSK-01-02<WP-01>'])
    expect(args.nodes[2]).toMatchObject({ depends: ['TSK-01-01'], priority: 'high', schedule: '2026-11-04 ~ 2026-11-06' })
    expect(args.nodes[0]).not.toHaveProperty('level') // v2.1 노드 — N단 키를 싣지 않는다
  })

  it('서버 재검증 — 미리보기를 건너뛰어도 N단 노드와 겹치면 거부(fail-closed)', async () => {
    db.queues = { wbs_items: [{ data: [row('mes-qa/WP-01', 3)] }] }
    const r = await applyWbsUpload(PID, CLASSIC_MD, { module: 'mes-qa' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('N단(levels 계약) 노드')
    expect(runWbsImport).not.toHaveBeenCalled()
  })

  it('서버 재검증 — 코어가 거부할 노드가 있으면 거부', async () => {
    db.queues = { wbs_items: [{ data: [] }] }
    const r = await applyWbsUpload(PID, CLASSIC_MD.replace('- priority: high', '- priority: urgent'), { module: 'oranda' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('허용 밖 priority 라벨: urgent')
    expect(runWbsImport).not.toHaveBeenCalled()
  })

  it('기존 ref 조회 실패 → 쓰기 전에 중단', async () => {
    db.queues = { wbs_items: [{ error: { message: 'boom' } }] }
    const r = await applyWbsUpload(PID, CLASSIC_MD, { module: 'oranda' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('기존 노드 조회 실패')
    expect(runWbsImport).not.toHaveBeenCalled()
  })
})
