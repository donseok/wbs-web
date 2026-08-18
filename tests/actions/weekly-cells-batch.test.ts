import { describe, it, expect, vi, beforeEach } from 'vitest'

// saveWeeklyCells 의 배치 왕복 구조를 본다 — 행 단위 그룹핑(같은 행 여러 셀 = 1 update),
// 청크 병렬 실행(동시성 상한), 진성 DB 에러의 청크 경계 중단, goneRowIds 부분 실패 시맨틱.
// 가드 배선(거부 시 DB 무접촉)은 tests/actions/authz-gate-collab.test.ts 가 본다.
const { requireProjectMember, requireProjectAdmin, requireSuperuser, resolveProjectId, getActor } = vi.hoisted(() => ({
  requireProjectMember: vi.fn(), requireProjectAdmin: vi.fn(), requireSuperuser: vi.fn(), resolveProjectId: vi.fn(), getActor: vi.fn(),
}))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => { throw new Error('mock 미설정 상태로 createServerClient 호출') }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectMember, requireProjectAdmin, requireSuperuser, resolveProjectId, getActor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { saveWeeklyCells } from '@/app/actions/weekly'
import { WEEKLY_CELL_MAX, type WeeklyCellEdit } from '@/lib/domain/weeklySheet'

const MEMBER = {
  userId: 'u1', teamCode: 'PMO', teamId: 't1', isSuperuser: false,
  projectRoles: new Map([['p1', 'member' as const]]),
}
// 구현 상수의 거울값 — src/app/actions/weekly.ts 의 BATCH_UPDATE_CONCURRENCY/BATCH_MAX 와 함께 바꾼다.
const CONCURRENCY = 8
const BATCH_MAX = 500

interface UpdateCall { rowId: string; payload: Record<string, unknown> }
interface UpdateResult { data: { id: string }[] | null; error: { message: string } | null; rejectWith?: string }

/**
 * 액션이 쓰는 두 쿼리 모양만 흉내낸다:
 *  - 소속 확인: from().select().in().eq() → { data: allowedIds, error }
 *  - 행 저장:  from().update(payload).eq('id', rowId).select('id') → updateResult(rowId)
 * update 정착은 매크로태스크로 미뤄, 같은 청크의 update 들이 전부 출발한 뒤에 끝나게 한다
 * (동시성 관측용 active/maxActive 트래킹의 전제).
 */
function makeSb(opts: {
  allowedIds?: string[]
  scopeError?: string
  updateResult?: (rowId: string, payload: Record<string, unknown>) => UpdateResult
}) {
  const track = { active: 0, maxActive: 0, updateCalls: [] as UpdateCall[] }
  const sb = {
    from: vi.fn(() => {
      let isUpdate = false
      let payload: Record<string, unknown> = {}
      let rowId = ''
      const b: Record<string, unknown> = {
        select: vi.fn(() => b),
        in: vi.fn(() => b),
        update: vi.fn((p: Record<string, unknown>) => { isUpdate = true; payload = p; return b }),
        eq: vi.fn((col: string, v: string) => { if (isUpdate && col === 'id') rowId = v; return b }),
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          if (!isUpdate) {
            resolve(opts.scopeError
              ? { data: null, error: { message: opts.scopeError } }
              : { data: (opts.allowedIds ?? []).map(id => ({ id })), error: null })
            return
          }
          track.updateCalls.push({ rowId, payload })
          track.active += 1
          track.maxActive = Math.max(track.maxActive, track.active)
          setTimeout(() => {
            track.active -= 1
            const r = opts.updateResult?.(rowId, payload) ?? { data: [{ id: rowId }], error: null }
            if (r.rejectWith) reject(new Error(r.rejectWith))
            else resolve({ data: r.data, error: r.error })
          }, 0)
        },
      }
      return b
    }),
  }
  return { sb, track }
}

const edit = (rowId: string, cellKey: WeeklyCellEdit['cellKey'], content = 'x'): WeeklyCellEdit =>
  ({ rowId, cellKey, content })

beforeEach(() => {
  createServerClient.mockReset()
  createServerClient.mockImplementation(async () => { throw new Error('mock 미설정 상태로 createServerClient 호출') })
  requireProjectMember.mockReset()
  requireProjectMember.mockResolvedValue({ ok: true, actor: MEMBER })
})

describe('행 단위 그룹핑 — 같은 행의 여러 셀은 update 1회로 합친다', () => {
  it('행 2개·셀 4개 배치가 update 2회(+소속 확인 1회)로 끝난다', async () => {
    const { sb, track } = makeSb({ allowedIds: ['r1', 'r2'] })
    createServerClient.mockResolvedValue(sb as never)
    const res = await saveWeeklyCells('p1', [
      edit('r1', 'this_content', 'a'),
      edit('r1', 'this_issue', 'b'),
      edit('r1', 'next_content', 'c'),
      edit('r2', 'next_issue', 'd'),
    ])
    expect(res).toEqual({ ok: true })
    // 종전엔 1(소속)+4(셀별) = 5 왕복 — 그룹핑 후 1+2 = 3 왕복.
    expect(track.updateCalls).toHaveLength(2)
    expect(sb.from).toHaveBeenCalledTimes(3)
    const r1 = track.updateCalls.find(c => c.rowId === 'r1')!
    expect(r1.payload).toMatchObject({ this_content: 'a', this_issue: 'b', next_content: 'c' })
    expect(r1.payload).not.toHaveProperty('next_issue')
    expect(typeof r1.payload.updated_at).toBe('string') // 수동 updated_at 유지(트리거 없음)
    const r2 = track.updateCalls.find(c => c.rowId === 'r2')!
    expect(r2.payload).toMatchObject({ next_issue: 'd' })
  })

  it('같은 (행,셀) 중복은 마지막 값이 이긴다(last-wins dedupe 보존)', async () => {
    const { sb, track } = makeSb({ allowedIds: ['r1'] })
    createServerClient.mockResolvedValue(sb as never)
    const res = await saveWeeklyCells('p1', [
      edit('r1', 'this_content', '먼저'),
      edit('r1', 'this_content', '나중'),
    ])
    expect(res).toEqual({ ok: true })
    expect(track.updateCalls).toHaveLength(1)
    expect(track.updateCalls[0].payload.this_content).toBe('나중')
  })
})

describe('청크 병렬 — 동시성 상한 안에서 병렬, 상한 밖은 다음 파도', () => {
  it('행 12개는 동시 8개까지만 나란히 나간다(12개 전부 동시 아님·직렬 1개도 아님)', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `r${String(i + 1).padStart(2, '0')}`)
    const { sb, track } = makeSb({ allowedIds: ids })
    createServerClient.mockResolvedValue(sb as never)
    const res = await saveWeeklyCells('p1', ids.map(id => edit(id, 'this_content')))
    expect(res).toEqual({ ok: true })
    expect(track.updateCalls).toHaveLength(12)
    expect(track.maxActive).toBe(CONCURRENCY)
  })
})

describe('진성 DB 에러 — 기존 계약(즉시 중단·롤백 없음·ok:false+error) 유지, 중단 단위만 청크', () => {
  it('첫 청크에서 에러가 나면 그 error 로 반환하고 다음 청크는 시작하지 않는다', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `r${String(i + 1).padStart(2, '0')}`)
    const { sb, track } = makeSb({
      allowedIds: ids,
      updateResult: rowId => rowId === 'r03'
        ? { data: null, error: { message: 'boom' } }
        : { data: [{ id: rowId }], error: null },
    })
    createServerClient.mockResolvedValue(sb as never)
    const res = await saveWeeklyCells('p1', ids.map(id => edit(id, 'this_content')))
    expect(res).toEqual({ ok: false, error: 'boom' })
    // 같은 청크(첫 8행)는 이미 출발했을 수 있다(비원자·멱등 재시도 계약) — 2번째 청크는 미출발.
    expect(track.updateCalls).toHaveLength(CONCURRENCY)
    expect(track.updateCalls.map(c => c.rowId)).toEqual(ids.slice(0, CONCURRENCY))
  })

  it('전송 계층 예외(rejection)도 ok:false 로 흡수한다 — 액션이 throw 로 새지 않는다', async () => {
    const { sb } = makeSb({
      allowedIds: ['r1'],
      updateResult: () => ({ data: null, error: null, rejectWith: 'conn reset' }),
    })
    createServerClient.mockResolvedValue(sb as never)
    const res = await saveWeeklyCells('p1', [edit('r1', 'this_content')])
    expect(res).toEqual({ ok: false, error: 'conn reset' })
  })
})

describe('goneRowIds — 부분 실패 시맨틱(살아있는 행은 성공, 삭제된 행만 스킵) 보존', () => {
  it('소속 아닌 행은 update 없이 goneRowIds 로 스킵한다', async () => {
    const { sb, track } = makeSb({ allowedIds: ['r1'] })
    createServerClient.mockResolvedValue(sb as never)
    const res = await saveWeeklyCells('p1', [
      edit('r1', 'this_content', 'a'),
      edit('r2', 'this_content', 'b'),
      edit('r2', 'this_issue', 'c'),
    ])
    expect(res).toEqual({ ok: true, goneRowIds: ['r2'] }) // 여러 셀이어도 행당 1회
    expect(track.updateCalls.map(c => c.rowId)).toEqual(['r1'])
  })

  it('update 가 0행에 닿으면(그 사이 삭제) 그 행만 goneRowIds 로 스킵하고 나머지는 저장한다', async () => {
    const { sb, track } = makeSb({
      allowedIds: ['r1', 'r2', 'r3'],
      updateResult: rowId => rowId === 'r2'
        ? { data: [], error: null }
        : { data: [{ id: rowId }], error: null },
    })
    createServerClient.mockResolvedValue(sb as never)
    const res = await saveWeeklyCells('p1', [
      edit('r1', 'this_content'), edit('r2', 'this_content'), edit('r3', 'this_content'),
    ])
    expect(res).toEqual({ ok: true, goneRowIds: ['r2'] })
    expect(track.updateCalls).toHaveLength(3)
  })

  it('전부 성공이면 goneRowIds 없이 { ok: true } 만 돌려준다', async () => {
    const { sb } = makeSb({ allowedIds: ['r1'] })
    createServerClient.mockResolvedValue(sb as never)
    const res = await saveWeeklyCells('p1', [edit('r1', 'this_content')])
    expect(res).toEqual({ ok: true })
  })
})

describe('검증·가드 로직 보존 — DB 도달 전에 자른다', () => {
  it('빈 배치는 no-op 성공이고 DB 클라이언트를 만들지 않는다', async () => {
    const res = await saveWeeklyCells('p1', [])
    expect(res).toEqual({ ok: true })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('BATCH_MAX 초과는 dedupe 전 원본 길이로 거부한다', async () => {
    const edits = Array.from({ length: BATCH_MAX + 1 }, () => edit('r1', 'this_content'))
    const res = await saveWeeklyCells('p1', edits)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('초과')
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('잘못된 cellKey(구조 열 포함)는 거부한다', async () => {
    const res = await saveWeeklyCells('p1', [edit('r1', 'sort_order' as never)])
    expect(res).toEqual({ ok: false, error: '잘못된 셀입니다.' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('CELL_MAX 초과 내용은 거부한다', async () => {
    const res = await saveWeeklyCells('p1', [edit('r1', 'this_content', 'x'.repeat(WEEKLY_CELL_MAX + 1))])
    expect(res.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('소속 확인 조회가 실패하면 쓰지 않고 중단한다(3원칙 ② fail-closed)', async () => {
    const { sb, track } = makeSb({ scopeError: 'db down' })
    createServerClient.mockResolvedValue(sb as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await saveWeeklyCells('p1', [edit('r1', 'this_content')])
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '대상을 확인할 수 없어 저장을 중단했습니다.' })
    expect(track.updateCalls).toHaveLength(0)
  })
})
