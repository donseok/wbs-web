/** 메일 HTML 본문용 이스케이프 — meetingInvite/projectInvite 공용(보안 관련이라 사본 금지). */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
