import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    // 프로덕션 배포에서만 Vercel Toolbar 숨김(공식 x-vercel-skip-toolbar 헤더).
    // Preview 배포의 코멘트/피드백 기능은 유지한다. (BUG-07)
    if (process.env.VERCEL_ENV !== "production") return [];
    return [
      {
        source: "/:path*",
        headers: [{ key: "x-vercel-skip-toolbar", value: "1" }],
      },
    ];
  },
};

export default nextConfig;
