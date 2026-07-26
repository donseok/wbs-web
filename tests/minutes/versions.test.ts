import { describe, expect, it, vi } from 'vitest'
import { fnv1a64 } from '@/lib/minutes/blocks'
import { ensureCurrentMinuteVersion } from '@/lib/minutes/versions'

type QueryResponse = {
  data?: unknown
  error?: { message?: string; code?: string } | null
}

function queryBuilder(response: QueryResponse) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (
      resolve: (value: { data: unknown; error: QueryResponse['error'] }) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise<unknown>
  } = {}
  for (const method of [
    'select', 'insert', 'update', 'delete', 'eq', 'order', 'limit', 'maybeSingle', 'single',
  ]) {
    builder[method] = vi.fn(() => builder)
  }
  builder.then = (resolve, reject) => Promise.resolve({
    data: response.data ?? null,
    error: response.error ?? null,
  }).then(resolve, reject)
  return builder
}

describe('ensureCurrentMinuteVersion', () => {
  it('최신 hash가 현재 본문과 다르면 기존 버전을 건드리지 않고 새 버전을 append한다', async () => {
    const currentBody = '# 현재 본문\n\n부분 적용 뒤 남은 변경 내용'
    const currentHash = fnv1a64(currentBody)
    const responses: Record<string, QueryResponse[]> = {
      minutes: [{
        data: {
          title: 'ERP 연계 회의',
          minute_date: '2026-07-25',
          team_code: 'ERP',
          meeting_id: 'meeting-1',
          project_id: 'project-1',
          meeting_occurrence_date: '2026-07-24',
        },
      }],
      minute_versions: [
        {
          data: {
            id: 'version-1',
            version_no: 1,
            body_hash: fnv1a64('# 과거 본문'),
          },
        },
        {
          data: {
            id: 'version-1',
            version_no: 1,
            body_hash: fnv1a64('# 과거 본문'),
          },
        },
        {
          data: {
            id: 'version-2',
            version_no: 2,
            body_hash: currentHash,
          },
        },
      ],
    }
    const builders: Record<string, ReturnType<typeof queryBuilder>[]> = {}
    const db = {
      from: vi.fn((table: string) => {
        const builder = queryBuilder((responses[table] ?? []).shift() ?? { data: null })
        ;(builders[table] ??= []).push(builder)
        return builder
      }),
    }

    const result = await ensureCurrentMinuteVersion(
      db as unknown as Parameters<typeof ensureCurrentMinuteVersion>[0],
      {
        minuteId: 'minute-1',
        bodyMd: currentBody,
        createdBy: 'user-1',
        createdByName: '담당자',
        file: null,
      },
    )

    expect(result).toEqual({
      version: { id: 'version-2', versionNo: 2, bodyHash: currentHash },
      error: null,
    })
    expect(db.from).toHaveBeenCalledTimes(4)
    expect(builders.minutes[0].select).toHaveBeenCalledWith(
      'title, minute_date, team_code, meeting_id, project_id, meeting_occurrence_date',
    )
    expect(builders.minute_versions[2].insert).toHaveBeenCalledWith(expect.objectContaining({
      minute_id: 'minute-1',
      version_no: 2,
      body_md: currentBody,
      body_hash: currentHash,
      created_by: 'user-1',
      created_by_name: '담당자',
      title: 'ERP 연계 회의',
      minute_date: '2026-07-25',
      team_code: 'ERP',
      meeting_id: 'meeting-1',
      project_id: 'project-1',
      meeting_occurrence_date: '2026-07-24',
    }))
    for (const builder of [
      builders.minute_versions[0],
      builders.minutes[0],
      builders.minute_versions[1],
    ]) {
      expect(builder.update).not.toHaveBeenCalled()
      expect(builder.delete).not.toHaveBeenCalled()
    }
  })
})
