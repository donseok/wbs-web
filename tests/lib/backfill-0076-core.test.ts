import { beforeEach, describe, expect, it, vi } from 'vitest'

// Task 9 리뷰 Important 2 — apply 모드에서 롤백 복원용 사전 스냅샷(.pre.json)이 어떤 minutes
// update 보다도 먼저 기록되는지를 검증한다. 러너 파일(scripts/backfill-0076.runner.ts)은
// 톱레벨 describe/it 이 즉시 실 DB 를 부르므로 import 하지 않는다(wiki-rebuild-loop.test.ts 와
// 같은 이유) — admin 클라이언트를 인자로 받는 core 쪽을 가짜 클라이언트로 직접 부른다.
const { calls } = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn((path: unknown) => {
      calls.push(String(path).includes('.pre.json') ? 'fs:pre' : 'fs:post')
    }),
  }
})

import type { SupabaseClient } from '@supabase/supabase-js'
import { runBackfillPass } from '../../scripts/lib/backfill-0076-core'

type QueryResponse = { data?: unknown; error?: { message?: string } | null }

/** thenable query builder — tests/minutes/folder-path.test.ts 관례와 동일. */
function queryBuilder(response: QueryResponse) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (r: (v: unknown) => unknown, j: (r: unknown) => unknown) => Promise<unknown>
  } = {}
  for (const m of ['select', 'not', 'eq', 'update', 'insert', 'is', 'maybeSingle', 'single', 'in']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.then = (resolve, reject) =>
    Promise.resolve({ data: response.data ?? null, error: response.error ?? null }).then(resolve, reject)
  return builder
}

/** 호출 순서대로 응답을 소비하는 가짜 admin — minutes.update 호출만 calls 에 기록한다. */
function fakeAdmin(queue: QueryResponse[]) {
  const from = vi.fn((table: string) => {
    const b = queryBuilder(queue.shift() ?? { data: null, error: null })
    if (table === 'minutes') {
      const origUpdate = b.update as (...args: unknown[]) => unknown
      b.update = vi.fn((...args: unknown[]) => { calls.push('db:update'); return origUpdate(...args) })
    }
    return b
  })
  return { from } as unknown as SupabaseClient
}

beforeEach(() => { calls.length = 0 })

describe('runBackfillPass — apply 순서', () => {
  it('사전 스냅샷(.pre.json) 기록이 첫 minutes update 보다 먼저 일어난다', async () => {
    // 시나리오: 스냅샷에 없는 folder_id(끊긴 체인) — decideBackfillAction 이 unfiled 를 내고,
    // apply 라 update({ folder_id: null }) 가 한 번 호출된다(Critical 1 로 새로 생긴 경로).
    const queue: QueryResponse[] = [
      { data: [{ id: 't1', code: 'PMO', sort_order: 0, active: true, progress_visible: true, project_id: null }] }, // teams
      { data: [] }, // minute_folders (loadFolderSnapshot #1) — 빈 스냅샷
      { data: [{ id: 'm1', team_code: 'PMO', project_id: 'proj-a', folder_id: 'ghost-1' }] }, // minutes select
      { data: null }, // minutes update
      { data: [] }, // minute_folders (VERIFY loadFolderSnapshot)
      { data: [{ id: 'm1', project_id: 'proj-a', folder_id: null }] }, // minutes select (VERIFY)
    ]
    const admin = fakeAdmin(queue)

    const result = await runBackfillPass({ admin, target: 'test', apply: true, actorId: 'actor-uuid' })

    expect(result.unfiled).toBe(1)
    expect(result.log).toEqual([
      { minuteId: 'm1', oldFolderId: 'ghost-1', newFolderId: null, reason: 'broken-chain' },
    ])

    const preIdx = calls.indexOf('fs:pre')
    const updateIdx = calls.indexOf('db:update')
    expect(preIdx).toBeGreaterThanOrEqual(0)
    expect(updateIdx).toBeGreaterThanOrEqual(0)
    expect(preIdx).toBeLessThan(updateIdx)
  })

  it('dry-run 은 사전 스냅샷을 쓰지 않는다(apply 전용)', async () => {
    const queue: QueryResponse[] = [
      { data: [{ id: 't1', code: 'PMO', sort_order: 0, active: true, progress_visible: true, project_id: null }] },
      { data: [] },
      { data: [{ id: 'm1', team_code: 'PMO', project_id: 'proj-a', folder_id: 'ghost-1' }] },
    ]
    const admin = fakeAdmin(queue)

    await runBackfillPass({ admin, target: 'test', apply: false, actorId: 'dry-run-unused' })

    expect(calls).not.toContain('fs:pre')
    expect(calls).not.toContain('db:update')
  })
})
