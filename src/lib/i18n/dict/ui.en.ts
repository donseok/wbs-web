// ui 영어 사전 — ko 파일과 물리 분리(웹팩이 En 을 클라이언트 공통 청크에 싣지 않도록).
// 키 패리티는 import type 으로만 강제한다 — 값 import 를 넣으면 분리가 무효가 된다.
import type { uiKo } from './ui'

export const uiEn: Record<keyof typeof uiKo, string> = {
  'ui.loading': 'Loading',
  'ui.progress': 'Progress',
  'ui.heroExpand': 'Expand hero',
  'ui.heroCollapse': 'Collapse hero',
  'ui.toastRegion': 'Notifications',
  'ui.toastDismiss': 'Dismiss notification',
  'ui.memberPicker.viewLabel': 'View',
  'ui.memberPicker.nameOrder': 'By name',
  'ui.memberPicker.categoryOrder': 'By responsibility',
  'ui.memberPicker.unassigned': 'Unassigned',
}
