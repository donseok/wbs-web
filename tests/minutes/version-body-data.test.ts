import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mocks.createServerClient,
}))

import { getMinuteVersionBody } from '@/lib/data/minutes'

type QueryResult = {
  data: Record<string, unknown> | null
  error: { message: string } | null
}

function versionQuery(result: QueryResult) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.maybeSingle.mockResolvedValue(result)
  return query
}

describe('getMinuteVersionBody historical metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('불변 버전의 본문과 당시 메타데이터를 함께 매핑하고 minute/version 양쪽으로 범위를 제한한다', async () => {
    const query = versionQuery({
      data: {
        id: 'version-old',
        version_no: 3,
        body_md: '# 당시 본문',
        body_hash: '0123456789abcdef',
        title: '변경 전 주간회의',
        minute_date: '2026-07-01',
        team_code: 'ERP',
        meeting_id: 'meeting-old',
        project_id: 'project-old',
        meeting_occurrence_date: '2026-06-30',
        created_at: '2026-07-01T09:00:00.000Z',
      },
      error: null,
    })
    const client = { from: vi.fn(() => query) }
    mocks.createServerClient.mockResolvedValue(client)

    const result = await getMinuteVersionBody('minute-current', 'version-old')

    expect(result).toEqual({
      id: 'version-old',
      versionNo: 3,
      bodyMd: '# 당시 본문',
      bodyHash: '0123456789abcdef',
      title: '변경 전 주간회의',
      minuteDate: '2026-07-01',
      teamCode: 'ERP',
      meetingId: 'meeting-old',
      projectId: 'project-old',
      meetingOccurrenceDate: '2026-06-30',
      createdAt: '2026-07-01T09:00:00.000Z',
    })
    expect(client.from).toHaveBeenCalledWith('minute_versions')
    expect(query.select).toHaveBeenCalledWith(
      'id, version_no, body_md, body_hash, title, minute_date, team_code, meeting_id, project_id, meeting_occurrence_date, created_at',
    )
    expect(query.eq).toHaveBeenNthCalledWith(1, 'id', 'version-old')
    expect(query.eq).toHaveBeenNthCalledWith(2, 'minute_id', 'minute-current')
    expect(query.maybeSingle).toHaveBeenCalledTimes(1)
  })
})
