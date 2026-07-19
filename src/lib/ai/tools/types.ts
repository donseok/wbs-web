import type {
  BotSource,
  PageContextV1,
} from '@/lib/ai/chat/protocol'
import type { RepositoryErrorCode } from '@/lib/repositories/types'

export type { BotSource } from '@/lib/ai/chat/protocol'

export const BOT_READ_CAPABILITIES = [
  'wbs:read',
  'weekly:read',
  'meetings:read',
  'attendance:read',
  'announcements:read',
  'minutes:read',
  'kanban:read',
  'dashboard:read',
  'members:read',
  'settings:read',
] as const

export type BotReadCapability = (typeof BOT_READ_CAPABILITIES)[number]

export type CoreBotToolName =
  | 'find_wbs_items'
  | 'get_wbs_item_detail'
  | 'get_wbs_dependencies'
  | 'get_wbs_change_log'
  | 'list_wbs_attachments'
  | 'get_weekly_sheet'
  | 'compare_weekly_sheets'
  | 'list_meetings'
  | 'get_meeting_detail'
  | 'list_my_meetings'
  | 'get_attendance'
  | 'list_announcements'
  | 'search_announcements'
  | 'search_minutes'
  | 'get_minute_detail'
  | 'get_kanban_view'
  | 'get_project_dashboard'
  | 'list_members'
  | 'get_member_workload'
  | 'get_safe_project_settings'

export interface ToolExecutionContext {
  userId: string
  role: string | null
  teamId: string | null
  capabilities: readonly string[]
  allowedProjectIds: readonly string[]
  pageContext: PageContextV1 | null
  now: string
  timezone: 'Asia/Seoul'
}

export interface ToolResult<T> {
  status: 'ok' | 'partial'
  facts: Record<string, string | number | boolean | null>
  records: T[]
  sources: BotSource[]
  asOf: string
  truncated: boolean
  warnings: string[]
}

export type ToolErrorCode = 'INVALID_ARGUMENT' | 'ACCESS_DENIED' | 'DATA_SOURCE_ERROR'

export interface ToolExecutionError {
  code: ToolErrorCode
  message: string
  retryable: boolean
  /** Internal, storage-neutral operation code. It is safe for structured logs. */
  repositoryErrorCode?: RepositoryErrorCode
}

export type ToolExecutionResult<T> =
  | { ok: true; result: ToolResult<T> }
  | { ok: false; error: ToolExecutionError }

/** Runtime arguments remain unknown until each tool applies its own whitelist. */
export interface ReadOnlyBotTool<TRecord = unknown> {
  name: CoreBotToolName
  requiredCapability: BotReadCapability
  execute(args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult<TRecord>>
}
