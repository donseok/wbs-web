// 한국어 병합 테이블 — 클라이언트 공통 청크에 정적 포함되는 유일한 사전.
// EN 은 dict.ts 의 지연 등록(registry)으로만 로드된다(../dict.ts 참조).
import { commonKo } from './common'
import { settingsKo } from './settings'
import { dashboardKo } from './dashboard'
import { membersKo } from './members'
import { attendanceKo } from './attendance'
import { announcementsKo } from './announcements'
import { meetingsKo } from './meetings'
import { kanbanKo } from './kanban'
import { wbsKo } from './wbs'
import { homeKo } from './home'
import { chatKo } from './chat'
import { uiKo } from './ui'
import { holidaysKo } from './holidays'
import { minutesKo } from './minutes'
import { issuesKo } from './issues'
import { wikiKo } from './wiki'
import { agentOpsKo } from './agentOps'
import { importWizardKo } from './importWizard'
import { inboxKo } from './inbox'
import { accountKo } from './account'
import { portfolioKo } from './portfolio'

export const KO = {
  ...commonKo,
  ...settingsKo,
  ...dashboardKo,
  ...membersKo,
  ...attendanceKo,
  ...announcementsKo,
  ...meetingsKo,
  ...kanbanKo,
  ...wbsKo,
  ...homeKo,
  ...chatKo,
  ...uiKo,
  ...holidaysKo,
  ...minutesKo,
  ...issuesKo,
  ...wikiKo,
  ...agentOpsKo,
  ...importWizardKo,
  ...inboxKo,
  ...accountKo,
  ...portfolioKo,
} as const
