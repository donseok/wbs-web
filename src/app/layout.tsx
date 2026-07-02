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
