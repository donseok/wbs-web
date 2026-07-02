'use client'

import type { CSSProperties } from 'react'
import { useLocale } from '@/components/providers/LocaleProvider'

/**
 * D'Flow 브랜드 마크.
 *
 * - `BrandGlyph` : teal 그라데이션 라운드 스퀘어 + 흰색 "flow-D" 글리프 (단독 사용 / 파비콘 / 컴팩트).
 * - `BrandMark`  : 글리프 + 선택적 워드마크("D'Flow") + 선택적 태그라인("일하는 방식이 바뀌다").
 *
 * 그라데이션/흰색은 로고 고유색이므로 토큰(var(--gradient-primary)) 위에서만 헥스가 아닌 토큰으로 참조.
 * 32–40px에서 크리스프하게 읽히도록 stroke 기반으로 설계.
 */

/** 흐름(flow)을 형상화한 D 글리프 — 좌측 spine + 흐르는 bowl + 내부 물결 액센트. */
function FlowGlyph({ size, accent }: { size: number; accent: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* D 의 spine */}
      <path d="M7.5 5.2V18.8" />
      {/* D 의 bowl — 흐르는 곡선 */}
      <path d="M7.5 5.4C13.9 4.8 18.5 7.6 18.5 12C18.5 16.4 13.9 19.2 7.5 18.6" />
      {/* 내부 물결 (작은 크기에서는 생략) */}
      {accent && <path d="M10.4 12q1-1.3 2 0t2 0" strokeWidth={1.6} opacity={0.6} />}
    </svg>
  )
}

/** 텍스트 없는 라운드 스퀘어 마크. 파비콘/컴팩트 자리/사이드바 등에서 사용. */
export function BrandGlyph({ size = 40, className = '' }: { size?: number; className?: string }) {
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.3),
    backgroundImage: 'var(--gradient-primary)',
    boxShadow: 'var(--shadow-sm)',
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center text-white ${className}`}
      style={style}
      aria-hidden
    >
      <FlowGlyph size={Math.round(size * 0.56)} accent={size >= 28} />
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
