import { beforeEach, describe, expect, it, vi } from 'vitest'

const { upload, remove, recordIssueAttachment } = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  recordIssueAttachment: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ storage: { from: () => ({ upload, remove }) } }),
}))
vi.mock('@/app/actions/issueAttachments', () => ({ recordIssueAttachment }))

import { uploadIssueAttachments } from '@/lib/issues/uploadIssueAttachments'

const ISSUE = 'i1'
const file = (name: string) => new File(['x'], name, { type: 'text/plain' })
const FILES = [file('a.txt'), file('b.txt'), file('c.txt')]

/** 경로의 타임스탬프를 고정해 단정을 안정시킨다. */
const now = () => 1_700_000_000_000

beforeEach(() => {
  upload.mockReset(); remove.mockReset(); recordIssueAttachment.mockReset()
  upload.mockResolvedValue({ error: null })
  remove.mockResolvedValue({ data: [], error: null })
  recordIssueAttachment.mockResolvedValue({ ok: true })
})

describe('uploadIssueAttachments', () => {
  it('파일을 순서대로 올리고 메타를 기록한다', async () => {
    const res = await uploadIssueAttachments(ISSUE, FILES, { now })
    expect(res.ok).toBe(true)
    expect(upload).toHaveBeenCalledTimes(3)
    expect(recordIssueAttachment).toHaveBeenCalledTimes(3)
  })

  it('경로는 이슈 접두를 갖는다 — 스토리지 정책이 첫 세그먼트를 이슈 id 로 읽는다', async () => {
    await uploadIssueAttachments(ISSUE, [FILES[0]!], { now })
    expect(upload).toHaveBeenCalledWith(`${ISSUE}/1700000000000-a.txt`, FILES[0], { upsert: false })
  })

  it('원본 파일명을 메타에 남긴다 — 스토리지 키는 ASCII 로 뭉개진다', async () => {
    const korean = file('회의 자료.txt')
    await uploadIssueAttachments(ISSUE, [korean], { now })
    expect(recordIssueAttachment).toHaveBeenCalledWith(
      ISSUE,
      expect.objectContaining({ fileName: '회의 자료.txt' }),
    )
  })

  it('중간에 실패하면 어디까지 됐는지 알려준다', async () => {
    upload.mockResolvedValueOnce({ error: null })
    upload.mockResolvedValueOnce({ error: { message: '네트워크' } })
    const res = await uploadIssueAttachments(ISSUE, FILES, { now })
    expect(res).toMatchObject({ ok: false, doneCount: 1, fileName: 'b.txt' })
  })

  it('재개하면 이미 올린 파일을 다시 올리지 않는다 — 중복 업로드 방지', async () => {
    // 2번째에서 실패 → 사용자가 재시도. 1번째가 또 올라가면 첨부가 중복된다.
    upload.mockResolvedValueOnce({ error: null })
    upload.mockResolvedValueOnce({ error: { message: '네트워크' } })
    const first = await uploadIssueAttachments(ISSUE, FILES, { now })
    expect(first.ok).toBe(false)

    upload.mockReset(); upload.mockResolvedValue({ error: null })
    const again = await uploadIssueAttachments(ISSUE, FILES, { now, startAt: (first as { doneCount: number }).doneCount })
    expect(again.ok).toBe(true)
    expect(upload).toHaveBeenCalledTimes(2)
    expect(upload).not.toHaveBeenCalledWith(expect.stringContaining('a.txt'), expect.anything(), expect.anything())
  })

  it('메타 기록이 실패하면 방금 올린 객체를 지운다 — 고아를 남기지 않는다', async () => {
    recordIssueAttachment.mockResolvedValueOnce({ ok: false, error: '거부' })
    const res = await uploadIssueAttachments(ISSUE, [FILES[0]!], { now })
    expect(res.ok).toBe(false)
    expect(remove).toHaveBeenCalledWith([`${ISSUE}/1700000000000-a.txt`])
  })

  it('업로드 자체가 실패하면 지울 것이 없으므로 remove 를 부르지 않는다', async () => {
    upload.mockResolvedValue({ error: { message: '네트워크' } })
    await uploadIssueAttachments(ISSUE, [FILES[0]!], { now })
    expect(remove).not.toHaveBeenCalled()
  })

  it('진행 상황을 성공한 개수로만 보고한다', async () => {
    const seen: number[] = []
    upload.mockResolvedValueOnce({ error: null })
    upload.mockResolvedValueOnce({ error: { message: '네트워크' } })
    await uploadIssueAttachments(ISSUE, FILES, { now, onDone: n => seen.push(n) })
    expect(seen).toEqual([1])
  })

  it('상한을 넘는 파일은 올리지 않고 즉시 실패한다', async () => {
    const big = new File([''], 'big.bin')
    Object.defineProperty(big, 'size', { value: 52_428_801 })
    const res = await uploadIssueAttachments(ISSUE, [big], { now })
    expect(res).toMatchObject({ ok: false, reason: 'too-large' })
    expect(upload).not.toHaveBeenCalled()
  })
})
