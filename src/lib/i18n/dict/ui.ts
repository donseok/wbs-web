// ui 화면 사전 — 이 파일은 ui 영역 담당만 수정한다.
// en은 Record<keyof ko, string> 타입으로 ko와의 키 패리티를 컴파일 타임에 강제한다.
export const uiKo = {
  'ui.loading': '로딩 중',
  'ui.progress': '진척',
  'ui.heroExpand': '히어로 펼치기',
  'ui.heroCollapse': '히어로 접기',
  'ui.toastRegion': '알림',
  'ui.toastDismiss': '알림 닫기',
} as const

export const uiEn: Record<keyof typeof uiKo, string> = {
  'ui.loading': 'Loading',
  'ui.progress': 'Progress',
  'ui.heroExpand': 'Expand hero',
  'ui.heroCollapse': 'Collapse hero',
  'ui.toastRegion': 'Notifications',
  'ui.toastDismiss': 'Dismiss notification',
}
