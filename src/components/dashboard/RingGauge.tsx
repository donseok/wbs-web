import type { ReactNode } from 'react'

/**
 * 링 게이지(자체 SVG, 서버 렌더 가능). pct null 이면 트랙만 — 0% 와 '대상 없음'을 구분한다.
 * 색은 Tailwind stroke-* 토큰 클래스(라이트/다크 자동). 중앙 콘텐츠는 children 으로 겹친다.
 */
export function RingGauge({ pct, size, stroke, toneClass = 'stroke-done', trackClass = 'stroke-line', label, children }: {
  pct: number | null
  size: number
  stroke: number
  toneClass?: string
  trackClass?: string
  /** 접근성 라벨 — 값을 글로도 나른다(색·각도만으로 읽히지 않게). */
  label: string
  children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = pct === null ? 0 : Math.max(0, Math.min(100, pct))
  const dash = (c * v) / 100
  // 둥근 캡은 양끝에 stroke/2 씩 호를 더 그려 1% 가 6% 처럼, 99% 가 꽉 찬 원처럼 보인다 — 극단값은 각진 캡.
  const cap = v >= 5 && v <= 95 ? 'round' : 'butt'
  // 접근성 이름은 래퍼 하나에만 — 중앙 텍스트(children)까지 두 번 읽히지 않게 svg 는 숨긴다.
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={trackClass} strokeWidth={stroke} />
        {pct !== null && v > 0 && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={toneClass} strokeWidth={stroke}
            strokeLinecap={cap} strokeDasharray={`${dash.toFixed(2)} ${(c - dash).toFixed(2)}`} />
        )}
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center text-center" aria-hidden="true">{children}</div>}
    </div>
  )
}
