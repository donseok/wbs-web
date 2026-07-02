// i18n 사전 진입점 — 화면별 네임스페이스 파일(dict/*.ts)을 병합한다.
// 각 네임스페이스 파일은 해당 화면 담당만 수정한다(병렬 작업 충돌 방지).
// 키 패리티(ko↔en)는 각 네임스페이스 파일에서 Record<keyof ko, string> 타입으로 강제된다.
import { commonKo, commonEn } from './dict/common'
import { settingsKo, settingsEn } from './dict/settings'
import { dashboardKo, dashboardEn } from './dict/dashboard'
import { membersKo, membersEn } from './dict/members'
import { attendanceKo, attendanceEn } from './dict/attendance'
import { kanbanKo, kanbanEn } from './dict/kanban'
import { wbsKo, wbsEn } from './dict/wbs'
import { homeKo, homeEn } from './dict/home'
import { chatKo, chatEn } from './dict/chat'
import { uiKo, uiEn } from './dict/ui'

export type Locale = 'ko' | 'en'

export const DICT = {
  ko: {
    ...commonKo,
    ...settingsKo,
    ...dashboardKo,
    ...membersKo,
    ...attendanceKo,
    ...kanbanKo,
    ...wbsKo,
    ...homeKo,
    ...chatKo,
    ...uiKo,
  },
  en: {
    ...commonEn,
    ...settingsEn,
    ...dashboardEn,
    ...membersEn,
    ...attendanceEn,
    ...kanbanEn,
    ...wbsEn,
    ...homeEn,
    ...chatEn,
    ...uiEn,
  },
} as const

export type DictKey = keyof (typeof DICT)['ko']

/** 서버 컴포넌트용 번역 — locale은 getServerLocale()(src/lib/i18n/server.ts)로 얻는다. */
export function t(locale: Locale, key: DictKey): string {
  const table = DICT[locale] as Record<string, string>
  return table[key] ?? (DICT.ko as Record<string, string>)[key] ?? key
}
