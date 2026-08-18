// ui 화면 사전 — 이 파일은 ui 영역 담당만 수정한다.
// en은 Record<keyof ko, string> 타입으로 ko와의 키 패리티를 컴파일 타임에 강제한다.
export const uiKo = {
  'ui.loading': '로딩 중',
  'ui.progress': '진척',
  'ui.heroExpand': '히어로 펼치기',
  'ui.heroCollapse': '히어로 접기',
  'ui.toastRegion': '알림',
  'ui.toastDismiss': '알림 닫기',
  'ui.memberPicker.viewLabel': '보기 방식',
  'ui.memberPicker.nameOrder': '이름순',
  'ui.memberPicker.categoryOrder': '담당 카테고리별',
  'ui.memberPicker.unassigned': '담당 미지정',
} as const
