import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { LocaleProvider } from "@/components/providers/LocaleProvider";

export const metadata: Metadata = {
  title: "DK Flow — 일하는 방식이 바뀌다",
  description: "WBS · 일정 · 멤버를 하나의 흐름으로. 계획부터 완료까지 투명하게 관리하세요.",
};

// 다크모드 FOUC 방지: 페인트 전에 저장된 테마를 <html>에 반영
const noFlash = `(function(){try{var t=localStorage.getItem('dkflow-theme');if(!t){t=document.cookie.match(/(?:^|; )dkflow-theme=([^;]+)/)?.[1];}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlash }} />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider>
          <LocaleProvider>{children}</LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
