// src/components/agents/icons.tsx
// 좌석표 아이콘 I1(라인) — 1.6px 획. 앱의 나머지 화면이 쓰는 lucide-react 와 같은 결이라 오피스만 겉돌지 않는다.
// 옛 판은 무응답 `!`·결정 대기 `?`·끊김이라는 한글 두 글자로 표지를 대신했고, 접힌 구역 세 종류를
// Armchair 하나로 표현했다. 여섯 자리를 각자 다른 그림으로 가른다.
import type React from 'react'

const Line = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)

/** 무응답 — 느낌표 동그라미. */
export const IconStale = () => <Line><circle cx="12" cy="12" r="8.5" /><path d="M12 8v4.6" /><path d="M12 15.9h.01" /></Line>
/** 끊김 — 플러그가 빠진 표시. */
export const IconOffline = () => (
  <Line><path d="M9.4 4.5v4.2M14.6 4.5v4.2" /><path d="M6.6 8.7h10.8v2.6a5.4 5.4 0 0 1-5.4 5.4 5.4 5.4 0 0 1-5.4-5.4z" /><path d="M12 16.7V20" /><path d="M4 4l16 16" /></Line>
)
/** 결정 대기 — 물음표 동그라미. 스프라이트의 말풍선과 같은 뜻. */
export const IconBlocked = () => (
  <Line><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.4a2.5 2.5 0 0 1 4.9.6c0 1.7-2.5 2.1-2.5 3.6" /><path d="M12 16.9h.01" /></Line>
)
/** 승인 대기 — 시계. */
export const IconWait = () => <Line><circle cx="12" cy="12" r="8.5" /><path d="M12 7.2V12l3 1.8" /></Line>
/** 반려·재작업 — 되돌리는 화살표. */
export const IconRejected = () => <Line><path d="M3.6 12a8.4 8.4 0 1 0 2.5-6" /><path d="M3.4 3.6v4.6h4.6" /></Line>
/** 접힌 구역 — 의자. */
export const IconFolded = () => (
  <Line><path d="M5 11V7.6a1.8 1.8 0 0 1 3.6 0V11" /><path d="M15.4 11V7.6a1.8 1.8 0 0 1 3.6 0V11" /><path d="M4.2 11h15.6v4.6a1.6 1.6 0 0 1-1.6 1.6H5.8a1.6 1.6 0 0 1-1.6-1.6z" /><path d="M6.6 17.2V19.4M17.4 17.2V19.4" /></Line>
)

/** 평면도 — 통로 양쪽 두 줄. */
export const IconFloorView = () => (
  <Line><rect x="3" y="3.5" width="18" height="17" rx="2" /><path d="M12 3.5v17" /><path d="M3 9h6M15 9h6M3 15h6M15 15h6" /></Line>
)
/** 상태 레인 — 길이가 다른 세 칼럼. */
export const IconLaneView = () => (
  <Line><rect x="3" y="3.5" width="5" height="17" rx="1.6" /><rect x="9.5" y="3.5" width="5" height="12" rx="1.6" /><rect x="16" y="3.5" width="5" height="8" rx="1.6" /></Line>
)
/** 에이전트 — 모니터 앞의 사람(작업 PC 와 자리). */
export const IconAgentView = () => (
  <Line><rect x="3" y="4" width="18" height="11" rx="1.8" /><path d="M9 20h6M12 15v5" /><circle cx="12" cy="8.6" r="2" /><path d="M8.5 13a3.5 3.5 0 0 1 7 0" /></Line>
)

/** 승인 — 체크. op 아이콘은 획이 굵다(작게 그려도 읽혀야 한다). */
export const IconApprove = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11" /></svg>
)
/** 반려 — 가위표. */
export const IconReject = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 5.5 5 19.5M5 5.5l14 14" /></svg>
)
/** 승인 취소 — 왼쪽으로 되돌리기. */
export const IconUnapprove = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.6 12a8.4 8.4 0 1 0 2.5-6" /><path d="M3.4 3.6v4.6h4.6" /></svg>
)
/** 재작업 요청 — 오른쪽으로 다시 보내기. */
export const IconRework = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.4 12a8.4 8.4 0 1 1-2.5-6" /><path d="M20.6 3.6v4.6H16" /></svg>
)
/** 회수 — 정지 사각형. */
export const IconRelease = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
)
/** 이어서 시작 — 재생 삼각형에 이어 붙이는 획. 회수(정지)와 한눈에 갈라져야 한다. */
export const IconResume = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 5.5v13" /><path d="M9.5 6.6l9 5.4-9 5.4z" /></svg>
)
/** 잡담 켬/끔 — 말풍선 두 개(주고받는 말). 보기 전환 아이콘과 같은 1.6px 라인. */
export const IconChat = () => (
  <Line><path d="M4 5.5h10a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 14 13.5H8.5L5.5 16v-2.5H4A1.5 1.5 0 0 1 2.5 12V7A1.5 1.5 0 0 1 4 5.5z" /><path d="M18 9.5h2a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-1.5V20l-3-2.5H11" /></Line>
)
