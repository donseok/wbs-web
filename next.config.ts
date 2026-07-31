import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 상위 홈 디렉터리의 lockfile을 workspace root로 오인하지 않게 서버 추적 기준을 고정한다.
  outputFileTracingRoot: process.cwd(),
  // PPTX 템플릿을 각 Node.js 다운로드 라우트 서버 번들에 포함(런타임 fs 읽기).
  outputFileTracingIncludes: {
    "/api/report": ["./src/lib/report/assets/weekly-template.pptx"],
    "/api/issue-analysis": ["./src/lib/report/assets/issue-analysis-template.pptx"],
  },
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
