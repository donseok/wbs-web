// DK Bot 마스코트 — 곰 얼굴 SVG. 크기는 className(h-_, w-_)으로 조절.
export function BearMascot({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="DK Bot" fill="none">
      {/* 귀 */}
      <circle cx="13" cy="13" r="7.2" fill="#c68a4f" />
      <circle cx="35" cy="13" r="7.2" fill="#c68a4f" />
      <circle cx="13" cy="13" r="3.5" fill="#f0d4ab" />
      <circle cx="35" cy="13" r="3.5" fill="#f0d4ab" />
      {/* 머리 */}
      <circle cx="24" cy="27" r="16.5" fill="#d99f60" />
      {/* 주둥이 */}
      <ellipse cx="24" cy="32" rx="9.6" ry="7.2" fill="#f7e8d2" />
      {/* 볼터치 */}
      <ellipse cx="13.8" cy="30.5" rx="2.4" ry="1.7" fill="#e89a86" opacity="0.55" />
      <ellipse cx="34.2" cy="30.5" rx="2.4" ry="1.7" fill="#e89a86" opacity="0.55" />
      {/* 눈 + 하이라이트 */}
      <ellipse cx="18.2" cy="24" rx="2.3" ry="2.7" fill="#2b2420" />
      <ellipse cx="29.8" cy="24" rx="2.3" ry="2.7" fill="#2b2420" />
      <circle cx="19" cy="23" r="0.85" fill="#fff" />
      <circle cx="30.6" cy="23" r="0.85" fill="#fff" />
      {/* 코 + 입 */}
      <ellipse cx="24" cy="29.6" rx="2.5" ry="1.9" fill="#2b2420" />
      <path
        d="M24 31.4v2.1M24 33.5q-2.7 1.7-4.7-.2M24 33.5q2.7 1.7 4.7-.2"
        stroke="#2b2420"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
    </svg>
  )
}
