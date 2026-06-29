import { ImageResponse } from 'next/og'

// 180×180 Apple touch icon — full-bleed teal 그라데이션 + 흰색 flow-D 글리프 (iOS 가 모서리를 마스킹).
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default async function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0f766e 0%, #155e75 48%, #173a63 100%)',
        }}
      >
        <svg
          width="120"
          height="120"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth={2.1}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7.5 5.2V18.8" />
          <path d="M7.5 5.4C13.9 4.8 18.5 7.6 18.5 12C18.5 16.4 13.9 19.2 7.5 18.6" />
          <path d="M10.4 12q1-1.3 2 0t2 0" strokeWidth={1.5} opacity={0.6} />
        </svg>
      </div>
    ),
    { ...size },
  )
}
