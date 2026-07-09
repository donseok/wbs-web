import Link from 'next/link'
import type { ReactNode } from 'react'

const MINUTE_PATH_RE = /\/minutes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

/** 내부 /minutes/<uuid> 경로만 링크화 — 외부 URL·md 링크는 그대로 텍스트(피싱 표면 차단). */
export function linkifyMinutePaths(content: string): ReactNode {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of content.matchAll(MINUTE_PATH_RE)) {
    const i = m.index ?? 0
    if (i > last) parts.push(content.slice(last, i))
    parts.push(
      <Link key={`${i}-${m[0]}`} href={m[0]} className="font-medium text-brand underline underline-offset-2">
        {m[0]}
      </Link>,
    )
    last = i + m[0].length
  }
  if (last < content.length) parts.push(content.slice(last))
  return parts
}
