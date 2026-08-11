import type { NextConfig } from "next";

const issueAnalysisTemplate =
  "./src/lib/report/assets/issue-analysis-template.pptx";

const nextConfig: NextConfig = {
  // 상위 홈 디렉터리의 lockfile을 workspace root로 오인하지 않게 서버 추적 기준을 고정한다.
  outputFileTracingRoot: process.cwd(),
  // PPTX 템플릿을 각 Node.js 다운로드 라우트 서버 번들에 포함(런타임 fs 읽기).
  outputFileTracingIncludes: {
    "/api/report": ["./src/lib/report/assets/weekly-template.pptx"],
    // 렌더링 API와 모달 사전 진단 Server Action은 서로 다른 함수로 배포된다.
    "/api/issue-analysis": [issueAnalysisTemplate],
    "/p/[projectId]/issues": [issueAnalysisTemplate],
  },
  async headers() {
    const rules: Awaited<ReturnType<NonNullable<NextConfig["headers"]>>> = [];
    // 스테이징은 검색엔진에 노출하지 않는다 (스펙 §5 — STAGING=1 은 스테이징 배포에만 설정).
    if (process.env.STAGING === "1") {
      rules.push({
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      });
    }
    // 프로덕션 배포에서만 Vercel Toolbar 숨김(공식 x-vercel-skip-toolbar 헤더).
    // Preview 배포의 코멘트/피드백 기능은 유지한다. (BUG-07)
    if (process.env.VERCEL_ENV === "production") {
      rules.push({
        source: "/:path*",
        headers: [{ key: "x-vercel-skip-toolbar", value: "1" }],
      });
    }
    return rules;
  },
};

export default nextConfig;
