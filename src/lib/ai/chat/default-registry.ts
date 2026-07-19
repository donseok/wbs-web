import {
  createCompareWeeklySheetsTool,
  createFindWbsItemsTool,
  createGetAttendanceTool,
  createGetKanbanViewTool,
  createGetMeetingDetailTool,
  createGetMemberWorkloadTool,
  createGetMinuteDetailTool,
  createGetProjectDashboardTool,
  createGetSafeProjectSettingsTool,
  createGetWbsChangeLogTool,
  createGetWbsDependenciesTool,
  createGetWbsItemDetailTool,
  createGetWeeklySheetTool,
  createListAnnouncementsTool,
  createListMeetingsTool,
  createListMembersTool,
  createListMyMeetingsTool,
  createListWbsAttachmentsTool,
  createSearchAnnouncementsTool,
  createSearchMinutesTool,
} from '@/lib/ai/tools'
import { dkbotIndexStatus } from '@/lib/ai/health'
import { createSupabaseCoreBotRepositories } from '@/lib/repositories/supabase'
import type { SupabaseServerClient } from '@/lib/repositories/supabase/common'
import { createChatToolRegistry, type ChatToolRegistry } from './registry'

/** 색인 상태는 부가 정보 — 조회 실패가 설정 답변 자체를 막지 않도록 null로 무해화한다. */
async function safeIndexStatusProbe(projectId: string): Promise<{ freshness: string; indexed: number } | null> {
  try {
    const status = await dkbotIndexStatus(projectId)
    return { freshness: status.freshness, indexed: status.indexed }
  } catch {
    return null
  }
}

/** Composition root only: domain tools and repositories remain independently replaceable. */
export function createDefaultChatToolRegistry(client: SupabaseServerClient): ChatToolRegistry {
  const repositories = createSupabaseCoreBotRepositories(client)
  return createChatToolRegistry([
    createFindWbsItemsTool(repositories.wbs),
    createGetWbsItemDetailTool(repositories.wbs),
    createGetWbsDependenciesTool(repositories.wbs),
    createGetWbsChangeLogTool(repositories.wbs),
    createListWbsAttachmentsTool(repositories.wbs),
    createGetWeeklySheetTool(repositories.weekly),
    createCompareWeeklySheetsTool(repositories.weekly),
    createListMeetingsTool(repositories.meetings),
    createGetMeetingDetailTool(repositories.meetings),
    createListMyMeetingsTool(repositories.meetings),
    createGetAttendanceTool(repositories.attendance),
    createListAnnouncementsTool(repositories.announcements),
    createSearchAnnouncementsTool(repositories.announcements),
    createSearchMinutesTool(repositories.minutes),
    createGetMinuteDetailTool(repositories.minutes),
    createGetKanbanViewTool(repositories.wbs),
    createGetProjectDashboardTool(repositories.wbs, repositories.meetings),
    createListMembersTool(repositories.members),
    createGetMemberWorkloadTool(repositories.members, repositories.wbs),
    createGetSafeProjectSettingsTool(repositories.settings, safeIndexStatusProbe),
  ])
}
