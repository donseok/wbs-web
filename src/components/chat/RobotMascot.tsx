// DK Bot 마스코트 — 귀여운 로봇 얼굴 SVG. 크기는 className(h-_, w-_)으로 조절.
// FAB·헤더 모두 어두운 배경 위에 올라가므로 밝은 메탈 헤드 + 브랜드 틸(#32b6ab) 포인트로 구성.
export function RobotMascot({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="DK Bot" fill="none">
      {/* 안테나 */}
      <path d="M24 9.5V5.5" stroke="#9fb2c4" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="24" cy="4" r="2.7" fill="#32b6ab" />
      <circle cx="23.1" cy="3.3" r="0.95" fill="#bff4ec" />
      {/* 옆 볼트(귀) */}
      <rect x="3.6" y="20" width="4.8" height="9.2" rx="2.4" fill="#cdd7e2" />
      <rect x="39.6" y="20" width="4.8" height="9.2" rx="2.4" fill="#cdd7e2" />
      {/* 머리 그림자 + 본체 */}
      <rect x="8" y="10.5" width="32" height="29" rx="10.5" fill="#d5dde8" />
      <rect x="8" y="9.5" width="32" height="29" rx="10.5" fill="#eef2f7" />
      {/* 상단 하이라이트(광택) */}
      <ellipse cx="24" cy="15" rx="10.5" ry="3" fill="#ffffff" opacity="0.55" />
      {/* 얼굴 바이저(스크린) */}
      <rect x="11.5" y="17.5" width="25" height="11" rx="5.5" fill="#151b24" />
      {/* 눈 + 하이라이트 */}
      <ellipse cx="19" cy="23" rx="2.5" ry="3" fill="#63e6d8" />
      <ellipse cx="29" cy="23" rx="2.5" ry="3" fill="#63e6d8" />
      <circle cx="19.9" cy="21.8" r="0.95" fill="#ffffff" />
      <circle cx="29.9" cy="21.8" r="0.95" fill="#ffffff" />
      {/* 볼터치 */}
      <ellipse cx="15" cy="32.6" rx="1.9" ry="1.3" fill="#32b6ab" opacity="0.5" />
      <ellipse cx="33" cy="32.6" rx="1.9" ry="1.3" fill="#32b6ab" opacity="0.5" />
      {/* 미소 */}
      <path d="M20.8 32.6q3.2 2.8 6.4 0" stroke="#63e6d8" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
