import { describe, it, expect } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import Link from 'next/link'
import { linkifyMinutePaths } from '@/components/minutes/linkify'

const UUID_A = '123e4567-e89b-42d3-a456-426614174000'
const UUID_B = 'abcdef01-2345-4678-9abc-def012345678'

function asArray(node: React.ReactNode): React.ReactNode[] {
  return Array.isArray(node) ? node : [node]
}

describe('linkifyMinutePaths', () => {
  it('내부 /minutes/<uuid> 경로를 Link 로 감싼다', () => {
    const parts = asArray(linkifyMinutePaths(`출처: /minutes/${UUID_A} 참고`))
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('출처: ')
    const link = parts[1] as ReactElement<{ href: string }>
    expect(isValidElement(link)).toBe(true)
    expect(link.type).toBe(Link)
    expect(link.props.href).toBe(`/minutes/${UUID_A}`)
    expect(parts[2]).toBe(' 참고')
  })

  it('여러 경로를 각각 링크화한다', () => {
    const parts = asArray(linkifyMinutePaths(`/minutes/${UUID_A} 그리고 /minutes/${UUID_B}`))
    const links = parts.filter(p => isValidElement(p))
    expect(links).toHaveLength(2)
  })

  it('외부 URL 은 텍스트로 남긴다', () => {
    const text = '참고: https://evil.example.com/minutes/123'
    const parts = asArray(linkifyMinutePaths(text))
    expect(parts).toHaveLength(1)
    expect(parts[0]).toBe(text)
  })

  it('경로가 없으면 원문 그대로 반환한다', () => {
    const parts = asArray(linkifyMinutePaths('일반 텍스트'))
    expect(parts).toHaveLength(1)
    expect(parts[0]).toBe('일반 텍스트')
  })
})
