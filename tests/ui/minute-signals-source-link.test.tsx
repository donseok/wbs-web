import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { MinuteSignal } from '@/components/dashboard/MinuteSignals'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: {
    href: string
    children: React.ReactNode
  }) => <a href={href} {...rest}>{children}</a>,
}))

import { MinuteSignals } from '@/components/dashboard/MinuteSignals'

describe('MinuteSignals 원문 링크', () => {
  it('화살표에 원문 블록 인덱스와 해시를 포함한다', () => {
    const signal: MinuteSignal = {
      id: 'i1', minuteId: 'm1', bodyHash: '1111111111111111',
      kind: 'decision', label: 'REST 방식 확정', blockIndex: 4,
      blockHash: 'abcdef0123456789', minuteTitle: '주간회의', minuteDate: '2026-07-16',
    }
    const html = renderToStaticMarkup(<MinuteSignals projectId="p1" signals={[signal]} />)

    expect(html).toContain('href="/minutes/m1?block=4&amp;hash=abcdef0123456789&amp;body=1111111111111111"')
    expect(html).toContain('aria-label="주간회의: REST 방식 확정 원문 위치 열기"')
  })
})
