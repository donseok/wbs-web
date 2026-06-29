import { ImageResponse } from 'next/og'

// 32×32 파비콘 — teal 그라데이션 위 흰색 flow-D 글리프.
export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default async function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          background: 'linear-gradient(135deg, #0f766e 0%, #155e75 48%, #173a63 100%)',
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7.5 5.2V18.8" />
          <path d="M7.5 5.4C13.9 4.8 18.5 7.6 18.5 12C18.5 16.4 13.9 19.2 7.5 18.6" />
        </svg>
      </div>
    ),
    { ...size },
  )
}
