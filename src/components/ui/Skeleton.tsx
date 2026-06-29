/**
 * 스켈레톤 플레이스홀더 — 토큰 기반 은은한 shimmer.
 *
 * shimmer 키프레임은 컴포넌트가 자급한다(전역 CSS 미수정). React 19 가
 * `<style precedence>` 를 <head> 로 끌어올리며 중복을 제거하므로, 여러 개를
 * 렌더해도 스타일은 한 번만 주입된다. prefers-reduced-motion 에서는 애니메이션을 끈다.
 */

const SHIMMER_CSS = `
.dflow-skeleton {
  position: relative;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-line) 70%, transparent);
}
.dflow-skeleton::after {
  content: "";
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--color-surface) 60%, transparent),
    transparent
  );
  animation: dflow-shimmer 1.6s ease-in-out infinite;
}
@keyframes dflow-shimmer {
  100% { transform: translateX(100%); }
}
@media (prefers-reduced-motion: reduce) {
  .dflow-skeleton::after { animation: none; }
}
`

const HAS_RADIUS = /(?:^|\s)rounded(?:-|\s|$)/

/** 단일 스켈레톤 블록. 크기/모양은 className(h-*, w-*, rounded-*)으로 지정. */
export function Skeleton({ className = '' }: { className?: string }) {
  const radius = HAS_RADIUS.test(className) ? '' : 'rounded-lg'
  return (
    <>
      <style href="dflow-skeleton" precedence="default">{SHIMMER_CSS}</style>
      <div className={`dflow-skeleton ${radius} ${className}`} aria-hidden />
    </>
  )
}

/** SectionCard 형태의 합성 스켈레톤 — 헤더(아이콘+제목) + 본문 라인들. */
export function CardSkeleton({ lines = 4, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`card p-5 sm:p-6 ${className}`}>
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-2.5 w-20 rounded" />
          <Skeleton className="h-3.5 w-40 rounded" />
        </div>
      </div>
      <div className="mt-5 space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={`h-3 rounded ${i === lines - 1 ? 'w-1/2' : 'w-full'}`} />
        ))}
      </div>
    </div>
  )
}

/** KpiCard 형태의 합성 스켈레톤 — 라벨/값/보조 + 아이콘 자리. */
export function KpiSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`kpi-card ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2.5">
          <Skeleton className="h-2.5 w-24 rounded" />
          <Skeleton className="h-7 w-16 rounded-lg" />
          <Skeleton className="h-2.5 w-20 rounded" />
        </div>
        <Skeleton className="h-9 w-9 rounded-xl" />
      </div>
    </div>
  )
}
