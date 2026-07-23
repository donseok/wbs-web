import { describe, expect, it } from 'vitest'
import { filenameFromContentDisposition } from '@/components/minutes/download'

describe('filenameFromContentDisposition', () => {
  it('UTF-8 filename*을 일반 filename보다 우선한다', () => {
    const header = "attachment; filename=minutes.zip; filename*=UTF-8''%ED%9A%8C%EC%9D%98%EB%A1%9D_%EC%A0%84%EC%B2%B4.zip"
    expect(filenameFromContentDisposition(header, 'fallback.zip')).toBe('회의록_전체.zip')
  })

  it('filename*이 없으면 quoted filename을 사용한다', () => {
    expect(filenameFromContentDisposition('attachment; filename="minutes-all.zip"', 'fallback.zip'))
      .toBe('minutes-all.zip')
  })

  it('깨진 UTF-8 인코딩은 일반 filename으로 폴백한다', () => {
    const header = "attachment; filename=minutes.zip; filename*=UTF-8''%E0%A4%A"
    expect(filenameFromContentDisposition(header, 'fallback.zip')).toBe('minutes.zip')
  })

  it('헤더나 파일명이 없으면 fallback을 사용한다', () => {
    expect(filenameFromContentDisposition(null, 'fallback.zip')).toBe('fallback.zip')
    expect(filenameFromContentDisposition('attachment', 'fallback.zip')).toBe('fallback.zip')
  })
})
