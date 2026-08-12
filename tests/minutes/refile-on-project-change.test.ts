import { describe, it, expect, vi } from 'vitest'

// teams/master 모듈 초기화 부작용 차단 — folder-path.test.ts 와 동일 관례.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))

import { refileMinuteAfterProjectChange, buildFolderSnapshot } from '@/lib/minutes/folders'

type QueryResponse = { data?: unknown; error?: { message?: string; code?: string } | null }

/** thenable query builder — folder-path.test.ts 관례와 동일(update 만 추가). */
function queryBuilder(response: QueryResponse) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (r: (v: unknown) => unknown, j: (r: unknown) => unknown) => Promise<unknown>
  } = {}
  for (const m of ['select', 'insert', 'update', 'eq', 'is', 'in', 'maybeSingle', 'single']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.then = (resolve, reject) =>
    Promise.resolve({ data: response.data ?? null, error: response.error ?? null }).then(resolve, reject)
  return builder
}

/** minute_folders/minutes 응답을 호출 순서대로 소비하는 가짜 클라이언트. */
function fakeDb(queue: QueryResponse[]) {
  const builders: ReturnType<typeof queryBuilder>[] = []
  const from = vi.fn(() => {
    const b = queryBuilder(queue.shift() ?? { data: null, error: null })
    builders.push(b)
    return b
  })
  return { db: { from } as never, builders, from }
}

const P1 = 'aaaaaaaa-0000-0000-0000-000000000001'

describe('refileMinuteAfterProjectChange', () => {
  it('기존 경로를 새 프로젝트 트리에 만들어 folder_id 를 옮긴다', async () => {
    // 스냅샷: 전역 PMO/주간회의 + P1 PMO 루트(주간회의 하위는 아직 없음). old = 전역 주간회의.
    const snapshot = buildFolderSnapshot([
      { id: 'g-pmo', name: 'PMO', parentId: null, createdBy: null, projectId: null },
      { id: 'g-weekly', name: '주간회의', parentId: 'g-pmo', createdBy: 'u9', projectId: null },
      { id: 'p1-pmo', name: 'PMO', parentId: null, createdBy: null, projectId: P1 },
    ])
    const { db, builders } = fakeDb([
      { data: { id: 'p1-weekly' } },      // insert 주간회의 under p1-pmo
      { data: [{ id: 'm1' }] },           // minutes.update — CAS 매치(1행)
    ])
    await refileMinuteAfterProjectChange(db, {
      minuteId: 'm1', teamCode: 'PMO', oldFolderId: 'g-weekly', newProjectId: P1,
      actorId: 'u1', activeTeamCodes: ['PMO'], snapshot,
    })
    expect(builders[0].insert).toHaveBeenCalledWith({
      name: '주간회의', parent_id: 'p1-pmo', created_by: 'u1', project_id: P1,
    })
    expect(builders[1].update).toHaveBeenCalledWith({ folder_id: 'p1-weekly' })
    // compare-and-set — 계산 근거였던 oldFolderId 가 그대로일 때만 쓴다
    expect(builders[1].eq).toHaveBeenCalledWith('id', 'm1')
    expect(builders[1].eq).toHaveBeenCalledWith('folder_id', 'g-weekly')
  })

  it('미분류(oldFolderId null)는 재편철하지 않는다 — 미분류 유지', async () => {
    const { db, from } = fakeDb([])
    await refileMinuteAfterProjectChange(db, {
      minuteId: 'm1', teamCode: 'PMO', oldFolderId: null, newProjectId: P1,
      actorId: 'u1', activeTeamCodes: ['PMO'],
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('경로 확보 실패(no_team_root — 비활성 팀 등)면 미분류로 강등하고 로그만 남긴다', async () => {
    // P1 트리에 PMO 루트가 없고, activeTeamCodes 에도 PMO 가 없어 지연 생성도 하지 않는다.
    const snapshot = buildFolderSnapshot([
      { id: 'g-pmo', name: 'PMO', parentId: null, createdBy: null, projectId: null },
      { id: 'g-weekly', name: '주간회의', parentId: 'g-pmo', createdBy: 'u9', projectId: null },
    ])
    const { db, builders } = fakeDb([{ data: [{ id: 'm1' }] }])   // minutes.update 만, CAS 매치
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await refileMinuteAfterProjectChange(db, {
      minuteId: 'm1', teamCode: 'PMO', oldFolderId: 'g-weekly', newProjectId: P1,
      actorId: 'u1', activeTeamCodes: [], snapshot,
    })
    expect(builders[0].update).toHaveBeenCalledWith({ folder_id: null })
    spy.mockRestore()
  })

  it('동시에 다른 요청이 명시적으로 폴더를 옮겼으면(CAS 0행) 덮어쓰지 않는다', async () => {
    // 재편철 계산의 근거였던 oldFolderId('g-weekly')가 그 사이 바뀌어 .eq('folder_id', ...) 가
    // 0행에 매치 — DB 에러가 아니므로 이 경로가 없으면 "성공했지만 틀린" 쓰기가 조용히 일어난다.
    const snapshot = buildFolderSnapshot([
      { id: 'g-pmo', name: 'PMO', parentId: null, createdBy: null, projectId: null },
      { id: 'g-weekly', name: '주간회의', parentId: 'g-pmo', createdBy: 'u9', projectId: null },
      { id: 'p1-pmo', name: 'PMO', parentId: null, createdBy: null, projectId: P1 },
      { id: 'p1-weekly', name: '주간회의', parentId: 'p1-pmo', createdBy: 'u1', projectId: P1 },
    ])
    const { db, builders } = fakeDb([{ data: [] }])   // update — CAS 불일치(0행)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    await expect(refileMinuteAfterProjectChange(db, {
      minuteId: 'm1', teamCode: 'PMO', oldFolderId: 'g-weekly', newProjectId: P1,
      actorId: 'u1', activeTeamCodes: ['PMO'], snapshot,
    })).resolves.toBeUndefined()
    expect(builders[0].update).toHaveBeenCalledWith({ folder_id: 'p1-weekly' })
    expect(builders[0].eq).toHaveBeenCalledWith('folder_id', 'g-weekly')
    expect(errSpy).not.toHaveBeenCalled()          // DB 에러가 아니다 — 정상 no-op
    expect(infoSpy).toHaveBeenCalledWith('[minutes] 재편철 건너뜀(동시 이동 감지):', 'm1')
    errSpy.mockRestore(); infoSpy.mockRestore()
  })
})
