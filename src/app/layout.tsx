import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { LocaleProvider } from "@/components/providers/LocaleProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { getServerLocale } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "D'Flow — 일하는 방식이 바뀌다",
  description: "WBS · 일정 · 멤버를 하나의 흐름으로. 계획부터 완료까지 투명하게 관리하세요.",
};

// 다크모드 FOUC 방지: 페인트 전에 저장된 테마를 <html>에 반영
const noFlash = `(function(){try{var t=localStorage.getItem('dflow-theme');if(!t){t=document.cookie.match(/(?:^|; )dflow-theme=([^;]+)/)?.[1];}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // 쿠키 기반 locale — 서버 렌더 본문과 클라이언트 크롬이 같은 언어로 시작한다.
  const locale = await getServerLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlash }} />
        {/* Pretendard(dynamic subset) — globals.css 의 @import 에서 옮겨왔다(2026-08-18 성능 감사).
            @import 는 globals.css 를 받은 뒤에야 CDN CSS 를 받는 직렬 차단 체인이지만, head 의
            link 는 HTML 파싱 즉시 globals.css 와 병렬로 내려받는다. preconnect 2건이 DNS+TLS 를
            선워밍하고(css 는 same-origin credentials 없이, 폰트 파일은 crossorigin), 폰트 자체는
            font-display: swap 이라 첫 페인트를 막지 않는다. */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider>
          <LocaleProvider initialLocale={locale}>
            <ToastProvider>{children}</ToastProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
