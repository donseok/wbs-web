// 영어 병합 테이블 — 클라이언트에서는 dict.ts 의 ensureEnLoaded() 가 동적 import 로,
// 서버에서는 server.ts 가 정적 import 로 등록한다. 이 모듈을 클라이언트 코드에서
// 정적 import 하면 분리가 무효가 되므로 금지.
import type { DictKey } from '../dict'
import { commonEn } from './common.en'
import { settingsEn } from './settings.en'
import { dashboardEn } from './dashboard.en'
import { membersEn } from './members.en'
import { attendanceEn } from './attendance.en'
import { announcementsEn } from './announcements.en'
import { meetingsEn } from './meetings.en'
import { kanbanEn } from './kanban.en'
import { wbsEn } from './wbs.en'
import { homeEn } from './home.en'
import { chatEn } from './chat.en'
import { uiEn } from './ui.en'
import { holidaysEn } from './holidays.en'
import { minutesEn } from './minutes.en'
import { issuesEn } from './issues.en'
import { wikiEn } from './wiki.en'
import { importWizardEn } from './importWizard.en'
import { inboxEn } from './inbox.en'
import { accountEn } from './account.en'
import { portfolioEn } from './portfolio.en'

export const EN: Record<DictKey, string> = {
  ...commonEn,
  ...settingsEn,
  ...dashboardEn,
  ...membersEn,
  ...attendanceEn,
  ...announcementsEn,
  ...meetingsEn,
  ...kanbanEn,
  ...wbsEn,
  ...homeEn,
  ...chatEn,
  ...uiEn,
  ...holidaysEn,
  ...minutesEn,
  ...issuesEn,
  ...wikiEn,
  ...importWizardEn,
  ...inboxEn,
  ...accountEn,
  ...portfolioEn,
}
