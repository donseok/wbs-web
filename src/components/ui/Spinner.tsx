/**
 * 인라인 스피너 — currentColor 사용, 버튼/인풋 등 텍스트 색을 그대로 따른다.
 * 크기는 className(h-*, w-*)으로 조정 (기본 16px). prefers-reduced-motion 에서는
 * globals 의 animation-duration 0.01ms 규칙으로 회전이 멈춘다.
 */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="로딩 중"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2.5} opacity={0.2} />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
    </svg>
  )
}
