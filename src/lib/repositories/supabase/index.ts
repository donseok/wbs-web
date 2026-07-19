import type { CoreBotRepositories } from '@/lib/repositories/types'
import type { SupabaseServerClient } from './common'
import { createSupabaseAnnouncementRepository } from './announcements'
import { createSupabaseAttendanceRepository } from './attendance'
import { createSupabaseMeetingRepository } from './meetings'
import { createSupabaseMemberRepository } from './members'
import { createSupabaseMinutesRepository } from './minutes'
import { createSupabaseProjectSettingsRepository } from './settings'
import { createSupabaseWbsRepository } from './wbs'
import { createSupabaseWeeklyRepository } from './weekly'

/**
 * The request boundary owns client creation. This factory only adapts an
 * already-authenticated, request-scoped client and therefore preserves RLS.
 */
export function createSupabaseCoreBotRepositories(
  client: SupabaseServerClient,
): CoreBotRepositories {
  return {
    wbs: createSupabaseWbsRepository(client),
    weekly: createSupabaseWeeklyRepository(client),
    meetings: createSupabaseMeetingRepository(client),
    attendance: createSupabaseAttendanceRepository(client),
    announcements: createSupabaseAnnouncementRepository(client),
    minutes: createSupabaseMinutesRepository(client),
    members: createSupabaseMemberRepository(client),
    settings: createSupabaseProjectSettingsRepository(client),
  }
}

export { createSupabaseAnnouncementRepository } from './announcements'
export { createSupabaseAttendanceRepository } from './attendance'
export { createSupabaseMeetingRepository } from './meetings'
export { createSupabaseMemberRepository } from './members'
export { createSupabaseMinutesRepository } from './minutes'
export { createSupabaseProjectSettingsRepository } from './settings'
export { createSupabaseWbsRepository } from './wbs'
export { createSupabaseWeeklyRepository } from './weekly'
