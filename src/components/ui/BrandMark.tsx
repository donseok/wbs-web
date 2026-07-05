'use client'

import { useLocale } from '@/components/providers/LocaleProvider'

/**
 * D'Flow 브랜드 마크.
 *
 * - `BrandGlyph` : 앱 로고(/logo.png)를 라운드 스퀘어로 렌더 — 로그인 페이지 로고와 동일.
 * - `BrandMark`  : 로고 글리프 + 선택적 워드마크("D'Flow") + 선택적 태그라인("일하는 방식이 바뀌다").
 *
 * 로고는 로그인 페이지와 동일한 원본 에셋(public/logo.png)을 사용해 브랜드 일관성을 맞춘다.
 */

/** 앱 로고(/logo.png) 라운드 스퀘어 마크. 헤더/컴팩트 자리에서 사용 — 로그인 로고와 동일. */
export function BrandGlyph({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`relative inline-flex shrink-0 overflow-hidden ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), boxShadow: 'var(--shadow-sm)' }}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="" width={size} height={size} className="block scale-[1.06]" />
    </span>
  )
}

/**
 * 글리프 + 워드마크. 기본은 글리프만, `withWordmark` 로 "D'Flow" 텍스트, `tagline` 으로 한 줄 태그라인.
 * 워드마크 텍스트 색은 토큰(text-ink/ink-subtle)이라 라이트/다크 모두 대응.
 */
export function BrandMark({
  size = 40,
  withWordmark = false,
  tagline = false,
  className = '',
}: {
  size?: number
  withWordmark?: boolean
  tagline?: boolean
  className?: string
}) {
  const { t } = useLocale()
  if (!withWordmark) return <BrandGlyph size={size} className={className} />

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <BrandGlyph size={size} />
      <span className="leading-tight">
        <span className="block font-bold tracking-tight text-ink" style={{ fontSize: Math.round(size * 0.4) }}>
          D&apos;Flow
        </span>
        {tagline && (
          <span className="block text-ink-subtle" style={{ fontSize: Math.round(size * 0.26) }}>
            {t('brand.tagline')}
          </span>
        )}
      </span>
    </span>
  )
}
