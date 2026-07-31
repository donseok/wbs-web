import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LEGACY_DCUBE_PROFILE } from '@/lib/excel/profile'
import type { DetectionResult } from '@/lib/excel/detect'

// 라우트 mock 관례(tests/agent/work-routes.test.ts, tests/actions/authz-gate-wbs.test.ts 참고) —
// 가드·감지·설정 조회를 각각 mock 해 라우트의 배선(순서·상태코드·에러 위장 금지)만 검증한다.
const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  detectWorkbook: vi.fn(),
  getProjectConfig: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: mocks.requireProjectAdmin }))
vi.mock('@/lib/excel/detect', () => ({ detectWorkbook: mocks.detectWorkbook }))
vi.mock('@/lib/data/projectConfig', () => ({ getProjectConfig: mocks.getProjectConfig }))

import { POST } from '@/app/api/import/inspect/route'

// UUID 형식 픽스처(agent-loop 교훈 — 'p1' 같은 비-UUID 를 쓰지 않는다).
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR = { userId: 'u1', teamCode: 'PMO', teamId: 't1', isSuperuser: false, projectRoles: new Map() }
const FILE = new Blob(['x'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

function req(fields: Record<string, string | Blob>): Parameters<typeof POST>[0] {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return { formData: async () => form } as unknown as Parameters<typeof POST>[0]
}

function detectionResult(overrides: Partial<DetectionResult> = {}): DetectionResult {
  return {
    sheetNames: ['WBS'],
    profile: LEGACY_DCUBE_PROFILE,
    confidence: { header: 1, hierarchy: 1, logical: 1 },
    preview: { headers: [], rows: [] },
    warnings: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
  mocks.detectWorkbook.mockReturnValue({ ok: true, result: detectionResult() })
  mocks.getProjectConfig.mockResolvedValue({
    levelLabels: [], maxDepth: null, extraAxisLabel: null, milestoneKeywords: [], excelProfile: {},
  })
})

describe('POST /api/import/inspect', () => {
  it.each([
    ['file 누락', { projectId: PROJECT_ID }],
    ['projectId 누락', { file: FILE }],
  ] as const)('%s → 400, 가드 호출 없음', async (_name, fields) => {
    const res = await POST(req(fields as Record<string, string | Blob>))
    expect(res.status).toBe(400)
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })

  it('비 UUID projectId → 400, 가드 호출 없음', async () => {
    const res = await POST(req({ file: FILE, projectId: 'p1' }))
    expect(res.status).toBe(400)
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })

  it('미인가(관리자 아님) → 403, 감지·설정 조회 없음', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: '권한 없음' })
    expect(mocks.detectWorkbook).not.toHaveBeenCalled()
    expect(mocks.getProjectConfig).not.toHaveBeenCalled()
  })

  it('비로그인 → 401', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '로그인 필요' })
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    expect(res.status).toBe(401)
  })

  it('권한 조회 실패 → 500(거부가 아니라 서버 사정)', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    expect(res.status).toBe(500)
  })

  it('시트 없음 — detectWorkbook 오류를 그대로 400, 설정 조회는 하지 않는다', async () => {
    mocks.detectWorkbook.mockReturnValue({ ok: false, error: '시트가 없습니다' })
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: '시트가 없습니다' })
    expect(mocks.getProjectConfig).not.toHaveBeenCalled()
  })

  it('정상 감지 + 저장된 프로파일 없음(={}) → savedProfile null, DB 쓰기 없음', async () => {
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.detection.profile).toEqual(LEGACY_DCUBE_PROFILE)
    expect(body.savedProfile).toBeNull()
  })

  it('저장된 프로파일이 유효하면 validateProfile 통과분을 savedProfile 로 반환한다', async () => {
    mocks.getProjectConfig.mockResolvedValue({
      levelLabels: [], maxDepth: null, extraAxisLabel: null, milestoneKeywords: [],
      excelProfile: LEGACY_DCUBE_PROFILE as unknown as Record<string, unknown>,
    })
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    const body = await res.json()
    expect(body.savedProfile).toEqual(LEGACY_DCUBE_PROFILE)
    expect(body.detection.warnings).not.toContain('저장된 프로파일이 손상됨')
  })

  it('저장된 프로파일이 손상되었으면 savedProfile null + 경고 추가(침묵 무시 금지)', async () => {
    mocks.getProjectConfig.mockResolvedValue({
      levelLabels: [], maxDepth: null, extraAxisLabel: null, milestoneKeywords: [],
      excelProfile: { version: 2 },
    })
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.savedProfile).toBeNull()
    expect(body.detection.warnings).toContain('저장된 프로파일이 손상됨')
  })

  it('설정 조회 실패 → 500, 원래 에러 메시지를 위장하지 않고 그대로 전달', async () => {
    mocks.getProjectConfig.mockRejectedValue(new Error('프로젝트 설정 조회 실패: db down'))
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: '프로젝트 설정 조회 실패: db down' })
  })
})
