import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 파일 1개를 Storage 에 올리고 메타까지 기록하는 공용 단위.
 *
 * 왜 뽑았나: "경로 생성 → upload(upsert:false) → 메타 기록 → 실패 시 보상 remove" 가 리포에
 * 이미 4벌(등록 모달·본문 교체·이슈 첨부·WBS 산출물) 있었다. 상세 화면의 나중 첨부 추가가
 * 5벌째가 되지 않게 등록 모달과 뷰어가 이 함수를 공유한다.
 *
 * 등록 모달의 재개 로직(progressRef)과 body 전용 버전 커밋 경로는 건드리지 않는다 —
 * 모달은 자기 for 루프를 유지하고 각 회차만 이 함수에 위임한다.
 */

const recordMinuteFile = vi.fn()
vi.mock('@/app/actions/minutes', () => ({
  recordMinuteFile: (...a: unknown[]) => recordMinuteFile(...(a as [])),
}))

import { uploadMinuteFile } from '@/lib/minutes/uploadMinuteFile'

/** Storage 호출을 기록하는 가짜 클라이언트. */
function fakeStorage(opts: {
  uploadError?: { message: string } | null
  uploadThrows?: unknown
} = {}) {
  // 시그니처를 제네릭으로 박아 둬야 mock.calls[0] 를 인덱싱할 수 있다(빈 튜플이면 TS2493).
  const upload = vi.fn<
    (path: string, file: File, opts: { upsert: boolean }) => Promise<{ error: { message: string } | null }>
  >(async () => {
    if (opts.uploadThrows) throw opts.uploadThrows
    return { error: opts.uploadError ?? null }
  })
  const remove = vi.fn(async () => ({ error: null }))
  const bucket = vi.fn(() => ({ upload, remove }))
  return { client: { storage: { from: bucket } }, upload, remove, bucket }
}

const file = (name: string, size = 2048, type = 'application/pdf') =>
  ({ name, size, type }) as File

beforeEach(() => {
  vi.clearAllMocks()
  recordMinuteFile.mockResolvedValue({ ok: true })
})

describe('uploadMinuteFile', () => {
  it('minutes 버킷의 {minuteId}/ 접두 경로에 올린다', async () => {
    const st = fakeStorage()
    const res = await uploadMinuteFile(st.client as never, 'min-1', 'attachment', file('도면.pdf'), {
      now: () => 1700000000000,
    })

    expect(res.ok).toBe(true)
    expect(st.bucket).toHaveBeenCalledWith('minutes')
    // 한글은 ASCII 안전명으로 뭉개진다(sanitizeFileName) — 원본은 file_name 컬럼이 보관한다.
    const [path] = st.upload.mock.calls[0]!
    expect(path).toBe('min-1/1700000000000-_.pdf')
  })

  // 같은 경로가 이미 있으면 덮어쓰지 않고 실패해야 한다 — 남의 첨부를 조용히 지우는 길을 막는다.
  it('upsert:false 로 올린다', async () => {
    const st = fakeStorage()
    await uploadMinuteFile(st.client as never, 'min-1', 'attachment', file('a.pdf'))

    expect(st.upload.mock.calls[0]![2]).toEqual({ upsert: false })
  })

  // 스토리지 키는 ASCII 로 뭉개지지만 사람이 보는 이름은 원본이어야 한다.
  it('메타에는 원본 파일명을 남긴다', async () => {
    const st = fakeStorage()
    await uploadMinuteFile(st.client as never, 'min-1', 'attachment', file('견적서 최종.xlsx'), {
      now: () => 1700000000000,
    })

    expect(recordMinuteFile).toHaveBeenCalledWith('min-1', {
      role: 'attachment',
      fileName: '견적서 최종.xlsx',
      filePath: 'min-1/1700000000000-_.xlsx',
      size: 2048,
      mime: 'application/pdf',
    })
  })

  it('업로드가 실패하면 메타를 기록하지 않는다', async () => {
    const st = fakeStorage({ uploadError: { message: '용량 초과' } })

    const res = await uploadMinuteFile(st.client as never, 'min-1', 'attachment', file('a.pdf'))

    expect(res).toEqual({ ok: false, reason: 'upload', error: '용량 초과' })
    expect(recordMinuteFile).not.toHaveBeenCalled()
    expect(st.remove).not.toHaveBeenCalled()   // 올라간 게 없으니 지울 것도 없다
  })

  // 메타 없는 객체는 화면에 뜨지 않으면서 용량만 먹는다(고아). 보상 삭제로 정리한다.
  it('메타 기록이 실패하면 방금 올린 객체를 지운다', async () => {
    const st = fakeStorage()
    recordMinuteFile.mockResolvedValue({ ok: false, error: '권한 없음' })

    const res = await uploadMinuteFile(st.client as never, 'min-1', 'attachment', file('a.pdf'), {
      now: () => 1700000000000,
    })

    expect(res).toEqual({ ok: false, reason: 'record', error: '권한 없음' })
    expect(st.remove).toHaveBeenCalledWith(['min-1/1700000000000-a.pdf'])
  })

  // 네트워크 단절·배포 교체 때 결과 객체가 아니라 reject 로 온다. 예외를 흘리면
  // 호출부가 아무 표시 없이 끝나고 버튼이 잠긴 채 남는다.
  it('업로드가 예외로 실패해도 결과 객체로 돌려준다', async () => {
    const st = fakeStorage({ uploadThrows: new Error('network') })

    const res = await uploadMinuteFile(st.client as never, 'min-1', 'attachment', file('a.pdf'))

    expect(res).toEqual({ ok: false, reason: 'upload', error: 'network' })
  })

  it('메타 기록이 예외로 실패해도 보상 삭제 후 결과 객체로 돌려준다', async () => {
    const st = fakeStorage()
    recordMinuteFile.mockRejectedValue(new Error('서버 액션 끊김'))

    const res = await uploadMinuteFile(st.client as never, 'min-1', 'attachment', file('a.pdf'))

    expect(res).toEqual({ ok: false, reason: 'record', error: '서버 액션 끊김' })
    expect(st.remove).toHaveBeenCalled()
  })
})
