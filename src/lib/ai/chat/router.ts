import { isCommandUtterance } from '@/lib/ai/commands/cue'
import { classifyIntent } from '@/lib/ai/intent'
import type { CoreBotToolName } from '@/lib/ai/tools/types'
import type {
  BotDomain,
  BotEntityRef,
  ChatRequestV2,
  PageContextV1,
} from './protocol'

export type PhaseOneToolName = CoreBotToolName

export interface RoutedToolCall {
  id: string
  tool: PhaseOneToolName
  domain: BotDomain
  args: Record<string, unknown>
}

export type DeterministicRoute =
  | {
      kind: 'command'
      domains: BotDomain[]
      calls: []
      reason: string
      message: string
    }
  | {
      kind: 'clarify'
      domains: BotDomain[]
      calls: []
      reason: string
      message: string
    }
  | {
      /** The Phase 1 endpoint must return 501 before streaming so the client uses the legacy bot. */
      kind: 'legacy'
      domains: BotDomain[]
      calls: []
      reason: string
      message: string
    }
  | {
      kind: 'tools'
      domains: BotDomain[]
      calls: RoutedToolCall[]
      reason: string
      statusMessage: string
    }

/** v2가 직접 처리하는 읽기 도메인의 단일 원천(리뷰 M-3). 라우팅 필터·문맥 승격·후속 대화 상속이 전부 이 집합에서 파생된다. */
const V2_READ_DOMAINS = [
  'wbs', 'weekly', 'meetings', 'attendance',
  'announcements', 'minutes', 'kanban', 'dashboard', 'members', 'settings',
] as const

type V2ReadDomain = (typeof V2_READ_DOMAINS)[number]

const V2_READ_DOMAIN_SET: ReadonlySet<BotDomain> = new Set<BotDomain>(V2_READ_DOMAINS)

const DOMAIN_TERMS: ReadonlyArray<{ domain: BotDomain; pattern: RegExp }> = [
  {
    domain: 'attendance',
    pattern: /근태|연차|반차|휴가|재택|출장|결근|병가|공가|출근|휴무/,
  },
  {
    domain: 'weekly',
    pattern: /주간\s*(?:업무|시트|보고)|(?:금주|차주|이번\s*주|지난\s*주|전주)\s*(?:업무|이슈|계획|실적|비교)|주차\s*(?:업무|이슈|계획|실적|비교)/,
  },
  {
    domain: 'meetings',
    pattern: /회의(?!록)|회의체|회의실|미팅|참석자/,
  },
  {
    domain: 'wbs',
    pattern: /\bwbs\b|간트|작업|공정[률율]|진척|실적[률율]|선행|후행|의존성|크리티컬|산출물|변경\s*이력|첨부(?:파일)?|지연/iu,
  },
  // '회의록'은 meetings 패턴의 (?!록)와 상보적으로 분리된다.
  { domain: 'minutes', pattern: /회의록|의사록/ },
  { domain: 'announcements', pattern: /공지/ },
  {
    domain: 'members',
    pattern: /멤버|구성원|인원\s*구성|직책|직함|워크로드|업무량|팀\s*구성|누가\s*(?:무슨|뭐|어떤)/,
  },
  { domain: 'kanban', pattern: /칸반|카드/ },
  {
    domain: 'dashboard',
    pattern: /대시보드|공정\s*현황|프로젝트\s*현황|예상\s*완료|마일스톤|\bSPI\b/i,
  },
  { domain: 'settings', pattern: /프로젝트\s*설정|기준일|공휴일|색인\s*(?:상태|현황)/ },
]

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function kstToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)
}

function addDays(iso: string, amount: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + amount))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return addDays(iso, -(day === 0 ? 6 : day - 1))
}

function validIsoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function explicitDates(message: string, today: string): string[] {
  const found: Array<{ index: number; value: string }> = []
  for (const match of message.matchAll(/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g)) {
    if (match.index === undefined) continue
    const value = validIsoDate(Number(match[1]), Number(match[2]), Number(match[3]))
    if (value) found.push({ index: match.index, value })
  }
  for (const match of message.matchAll(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일/g)) {
    if (match.index === undefined) continue
    const value = validIsoDate(
      Number(match[1] ?? today.slice(0, 4)), Number(match[2]), Number(match[3]),
    )
    if (value) found.push({ index: match.index, value })
  }
  return found.sort((left, right) => left.index - right.index).map(item => item.value)
}

function monthRange(year: number, month: number): { from: string; to: string } | null {
  if (!Number.isInteger(year) || month < 1 || month > 12) return null
  const from = validIsoDate(year, month, 1)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const to = validIsoDate(year, month, lastDay)
  return from && to ? { from, to } : null
}

function shiftedMonthRange(today: string, offset: number): { from: string; to: string } {
  const [year, month] = today.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1))
  return monthRange(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1)!
}

function explicitMonthRange(message: string, today: string): { from: string; to: string } | null {
  const match = message.match(/(?:(\d{4})년\s*)?(\d{1,2})월(?!\s*\d{1,2}\s*일)/)
  if (!match) return null
  return monthRange(Number(match[1] ?? today.slice(0, 4)), Number(match[2]))
}

function explicitDomains(message: string): BotDomain[] {
  return DOMAIN_TERMS.filter(x => x.pattern.test(message)).map(x => x.domain)
}

function usefulContextDomain(context: PageContextV1 | undefined): BotDomain | null {
  if (!context) return null
  // kanban·dashboard도 전용 도구가 생겨 더 이상 wbs로 강등하지 않는다.
  return V2_READ_DOMAIN_SET.has(context.domain) ? context.domain : null
}

function selectedProjectFilter(input: ChatRequestV2): string | null {
  // typed PageContextV1.selectedProjectId 계약(리뷰 M-4). 'all'은 클라이언트가 null로 정규화한다.
  const value = input.pageContext?.selectedProjectId
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && normalized.toLowerCase() !== 'all' ? normalized : null
}

function directProjectHint(input: ChatRequestV2): string | null {
  return input.pageContext?.projectId ?? input.projectId ?? selectedProjectFilter(input)
}

function projectHint(input: ChatRequestV2): string | null {
  const direct = directProjectHint(input)
  if (direct) return direct
  const priorDomains = conversationDomains(input)
  return input.conversationState?.lastEntities.find(entity =>
    !!entity.projectId && (!priorDomains.length || priorDomains.includes(entityDomain(entity.type) ?? 'unknown')),
  )?.projectId ?? null
}

function stringFilter(context: PageContextV1 | undefined, key: string): string | undefined {
  const value = context?.filters?.[key]
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized && normalized.toLowerCase() !== 'all' ? normalized : undefined
}

const WBS_STATUSES = new Set(['not_started', 'in_progress', 'delayed', 'done'])

function wbsStatusFrom(message: string, context: PageContextV1 | undefined): string | undefined {
  const filtered = stringFilter(context, 'status')
  if (filtered && WBS_STATUSES.has(filtered)) return filtered
  if (/시작\s*전|미착수/.test(message)) return 'not_started'
  if (/진행\s*중/.test(message)) return 'in_progress'
  if (/지연/.test(message)) return 'delayed'
  if (!/미완료|미\s*완료|완료\s*예정/.test(message) && /완료/.test(message)) return 'done'
  return undefined
}

function teamFrom(message: string, context: PageContextV1 | undefined): string | undefined {
  const filtered = stringFilter(context, 'team')
  if (filtered) return filtered
  return message.match(/(?:^|\s)(PMO|ERP|MES|가공)(?:\s|$)/i)?.[1]?.toUpperCase()
}

function attendanceTypesFrom(message: string): string[] | undefined {
  if (/반반차/.test(message)) return ['quarter']
  if (/반차/.test(message)) return ['half']
  if (/연차/.test(message)) return ['annual']
  if (/공가/.test(message)) return ['official']
  if (/재택/.test(message)) return ['remote']
  if (/출장/.test(message)) return ['trip']
  if (/병가/.test(message)) return ['sick']
  if (/결근/.test(message)) return ['absent']
  if (/정상\s*근무|출근/.test(message)) return ['work']
  if (/휴가/.test(message)) return ['annual', 'half', 'quarter', 'sick']
  return undefined
}

/** Only explicit search text is sent to repository filters; a natural-language question is not a DB search needle. */
function explicitSearchQuery(input: ChatRequestV2): string | undefined {
  const pageSearch = input.pageContext?.search?.trim()
  if (pageSearch) return pageSearch.slice(0, 500)
  const quoted = input.message.match(/[‘“「『]([^’”」』]{1,100})[’”」』]/)?.[1]
    ?? input.message.match(/(?:^|\s)(['"])([^'"]{1,100})\1/)?.[2]
  if (quoted) return quoted.trim()
  const named = input.message.match(/^(.{1,100}?)\s*(?:작업|항목|회의|업무)(?:을|를)?\s*(?:찾|검색|조회)/)?.[1]?.trim()
  return named || undefined
}

function requestedRange(message: string, context: PageContextV1 | undefined, now: Date): { from: string; to: string } {
  const today = kstToday(now)
  const dates = explicitDates(message, today)
  if (dates.length >= 2) {
    const [left, right] = dates
    return left <= right ? { from: left, to: right } : { from: right, to: left }
  }
  if (dates.length === 1) return { from: dates[0], to: dates[0] }
  const explicitMonth = explicitMonthRange(message, today)
  if (explicitMonth) return explicitMonth
  if (/내일/.test(message)) {
    const tomorrow = addDays(today, 1)
    return { from: tomorrow, to: tomorrow }
  }
  if (/어제/.test(message)) {
    const yesterday = addDays(today, -1)
    return { from: yesterday, to: yesterday }
  }
  if (/오늘/.test(message)) return { from: today, to: today }
  if (/지난\s*주|전주/.test(message)) {
    const monday = addDays(mondayOf(today), -7)
    return { from: monday, to: addDays(monday, 6) }
  }
  if (/다음\s*주|차주/.test(message)) {
    const monday = addDays(mondayOf(today), 7)
    return { from: monday, to: addDays(monday, 6) }
  }
  if (/이번\s*주|금주|주간/.test(message)) {
    const monday = mondayOf(today)
    return { from: monday, to: addDays(monday, 6) }
  }
  if (/지난\s*달|전월/.test(message)) return shiftedMonthRange(today, -1)
  if (/다음\s*달|익월/.test(message)) return shiftedMonthRange(today, 1)
  if (/이번\s*달|금월/.test(message)) {
    return shiftedMonthRange(today, 0)
  }
  const from = context?.range?.from
  const to = context?.range?.to
  if (from && to) return { from, to }
  const base = context?.date ?? today
  return { from: base, to: base }
}

function hasRequestedRangeCue(message: string, now: Date): boolean {
  const today = kstToday(now)
  return explicitDates(message, today).length > 0
    || explicitMonthRange(message, today) !== null
    || /오늘|내일|어제|지난\s*주|전주|다음\s*주|차주|이번\s*주|금주|지난\s*달|전월|다음\s*달|익월|이번\s*달|금월/.test(message)
}

function wbsDateMode(message: string): 'overlap' | 'starts' | 'ends' {
  if (/시작|착수/.test(message)) return 'starts'
  if (/종료|완료\s*예정|마감|끝나는?/.test(message)) return 'ends'
  return 'overlap'
}

function entityDomain(type: BotEntityRef['type']): BotDomain | null {
  if (type === 'wbs_item') return 'wbs'
  if (type === 'weekly_report' || type === 'weekly_row') return 'weekly'
  if (type === 'meeting' || type === 'meeting_occurrence') return 'meetings'
  if (type === 'attendance_record') return 'attendance'
  if (type === 'announcement') return 'announcements'
  if (type === 'minute' || type === 'minute_block') return 'minutes'
  if (type === 'member' || type === 'team') return 'members'
  return null
}

function normalizedReadDomain(domain: BotDomain): BotDomain | null {
  return V2_READ_DOMAIN_SET.has(domain) ? domain : null
}

/** A follow-up may inherit one prior domain, or the domain tied to its most recent entity. */
function conversationDomains(input: ChatRequestV2): BotDomain[] {
  const lastDomains = uniq((input.conversationState?.lastDomains ?? [])
    .map(normalizedReadDomain)
    .filter((domain): domain is BotDomain => domain !== null))
  if (lastDomains.length === 1) return lastDomains
  const related = input.conversationState?.lastEntities
    .map(entity => entityDomain(entity.type))
    .find((domain): domain is BotDomain => domain !== null && lastDomains.includes(domain))
  return related ? [related] : []
}

function referencedEntity(input: ChatRequestV2, types: BotEntityRef['type'][]): BotEntityRef | null {
  const selected = input.pageContext?.selectedEntity
  if (selected && types.includes(selected.type)) return selected
  const currentProjectId = projectHint(input)
  const prior = input.conversationState?.lastEntities.find(e =>
    types.includes(e.type) && (!currentProjectId || !e.projectId || e.projectId === currentProjectId),
  )
  return prior ?? null
}

function wbsCall(input: ChatRequestV2, now: Date): RoutedToolCall {
  const message = input.message
  const projectId = projectHint(input)
  const entity = referencedEntity(input, ['wbs_item'])
  const common = { projectId }
  const status = wbsStatusFrom(message, input.pageContext)
  if (entity && /변경\s*이력|누가\s*(?:바꿨|수정)|최근\s*변경/.test(message)) {
    return { id: 'call_wbs_change_log', tool: 'get_wbs_change_log', domain: 'wbs', args: { ...common, itemId: entity.id, limit: 50 } }
  }
  if (entity && /첨부|파일/.test(message)) {
    return { id: 'call_wbs_attachments', tool: 'list_wbs_attachments', domain: 'wbs', args: { ...common, itemId: entity.id, limit: 50 } }
  }
  if (entity && /선행|후행|의존|크리티컬|예상\s*지연/.test(message)) {
    return { id: 'call_wbs_dependencies', tool: 'get_wbs_dependencies', domain: 'wbs', args: { ...common, itemId: entity.id } }
  }
  if (entity && /이\s*작업|이\s*항목|상세|자세히|세부|내용|일정|담당|상태|실적|산출물/.test(message)) {
    return { id: 'call_wbs_detail', tool: 'get_wbs_item_detail', domain: 'wbs', args: { ...common, itemId: entity.id } }
  }
  const range = hasRequestedRangeCue(message, now)
    ? requestedRange(message, input.pageContext, now)
    : null
  return {
    id: 'call_wbs_find',
    tool: 'find_wbs_items',
    domain: 'wbs',
    args: {
      ...common,
      ...(explicitSearchQuery(input) ? { query: explicitSearchQuery(input) } : {}),
      limit: 50,
      ...(teamFrom(message, input.pageContext) ? { team: teamFrom(message, input.pageContext) } : {}),
      ...(status ? { status } : {}),
      ...(range ? { ...range, dateMode: wbsDateMode(message) } : {}),
    },
  }
}

function weeklyCall(input: ChatRequestV2, now: Date): RoutedToolCall {
  const today = kstToday(now)
  const currentWeekStart = mondayOf(today)
  const explicitWeekStarts = explicitDates(input.message, today).map(mondayOf)
  const contextualWeekStart = input.pageContext?.weekStart ?? currentWeekStart
  const mentionsCurrentWeek = /이번\s*주|금주/.test(input.message)
  const mentionsPriorWeek = /지난\s*주|전주/.test(input.message)
  const comparison = /비교|차이|달라|변화/.test(input.message)
  const weekStart = explicitWeekStarts[0] ?? (mentionsPriorWeek
    ? addDays(currentWeekStart, -7)
    : mentionsCurrentWeek ? currentWeekStart : contextualWeekStart)
  const filters = {
    ...(teamFrom(input.message, input.pageContext) ? { team: teamFrom(input.message, input.pageContext) } : {}),
    ...(stringFilter(input.pageContext, 'section') ? { section: stringFilter(input.pageContext, 'section') } : {}),
    ...(explicitSearchQuery(input) ? { query: explicitSearchQuery(input) } : {}),
    limit: 50,
  }
  if (comparison) {
    const explicitComparisonWeeks = explicitWeekStarts.slice(0, 2).sort()
    const toWeekStart = explicitComparisonWeeks.length >= 2
      ? explicitComparisonWeeks[1]
      : explicitWeekStarts[0]
        ?? (mentionsCurrentWeek || mentionsPriorWeek ? currentWeekStart : contextualWeekStart)
    const fromWeekStart = explicitComparisonWeeks.length >= 2
      ? explicitComparisonWeeks[0]
      : addDays(toWeekStart, -7)
    return {
      id: 'call_weekly_compare',
      tool: 'compare_weekly_sheets',
      domain: 'weekly',
      args: {
        projectId: projectHint(input),
        fromWeekStart,
        toWeekStart,
        ...filters,
      },
    }
  }
  return {
    id: 'call_weekly_sheet',
    tool: 'get_weekly_sheet',
    domain: 'weekly',
    args: {
      projectId: projectHint(input),
      weekStart,
      ...filters,
    },
  }
}

function meetingsCall(input: ChatRequestV2, now: Date): RoutedToolCall {
  const entity = referencedEntity(input, ['meeting', 'meeting_occurrence'])
  if (entity && /이\s*회의|그\s*회의|상세|자세히|세부|내용|참석자|장소|어디/.test(input.message)) {
    return {
      id: 'call_meeting_detail',
      tool: 'get_meeting_detail',
      domain: 'meetings',
      args: {
        projectId: projectHint(input),
        meetingId: entity.id,
        ...(entity.qualifier?.occurrenceDate ? { occurrenceDate: entity.qualifier.occurrenceDate } : {}),
      },
    }
  }
  const range = requestedRange(input.message, input.pageContext, now)
  const globalMeetings = input.pageContext?.domain === 'meetings' && !input.pageContext.projectId
  if (globalMeetings || /내\s*회의/.test(input.message) || !projectHint(input)) {
    // A selected global-meeting project is an entity-detail hint, not a sticky list filter.
    const listProjectId = input.pageContext?.projectId ?? input.projectId
    return {
      id: 'call_my_meetings',
      tool: 'list_my_meetings',
      domain: 'meetings',
      args: {
        ...range,
        ...(listProjectId ? { projectId: listProjectId } : {}),
        ...(explicitSearchQuery(input) ? { query: explicitSearchQuery(input) } : {}),
        ...(stringFilter(input.pageContext, 'category') ? { category: stringFilter(input.pageContext, 'category') } : {}),
        limit: 50,
      },
    }
  }
  return {
    id: 'call_meetings',
    tool: 'list_meetings',
    domain: 'meetings',
    args: {
      projectId: projectHint(input), ...range, limit: 50,
      ...(explicitSearchQuery(input) ? { query: explicitSearchQuery(input) } : {}),
    },
  }
}

function attendanceCall(input: ChatRequestV2, now: Date): RoutedToolCall {
  const range = requestedRange(input.message, input.pageContext, now)
  const types = attendanceTypesFrom(input.message)
  return {
    id: 'call_attendance',
    tool: 'get_attendance',
    domain: 'attendance',
    args: {
      projectId: projectHint(input),
      ...range,
      ...(teamFrom(input.message, input.pageContext) ? { team: teamFrom(input.message, input.pageContext) } : {}),
      ...(stringFilter(input.pageContext, 'memberId') ? { memberId: stringFilter(input.pageContext, 'memberId') } : {}),
      ...(types ? { types } : {}),
      limit: 50,
    },
  }
}

const ANNOUNCEMENT_CATEGORIES = new Set(['general', 'important', 'event'])

function announcementCategoryFrom(message: string, context: PageContextV1 | undefined): string | undefined {
  const filtered = stringFilter(context, 'category')
  if (filtered && ANNOUNCEMENT_CATEGORIES.has(filtered)) return filtered
  if (/중요\s*공지/.test(message)) return 'important'
  if (/이벤트/.test(message)) return 'event'
  return undefined
}

function announcementsCall(input: ChatRequestV2, now: Date): RoutedToolCall {
  const projectId = projectHint(input)
  const query = explicitSearchQuery(input)
  const category = announcementCategoryFrom(input.message, input.pageContext)
  if (query) {
    return {
      id: 'call_announcements_search', tool: 'search_announcements', domain: 'announcements',
      args: { projectId, query, ...(category ? { category } : {}), limit: 50 },
    }
  }
  const pinnedOnly = /고정|필독/.test(input.message)
  const activeOn = /게시\s*중|현재|오늘/.test(input.message) ? kstToday(now) : undefined
  return {
    id: 'call_announcements', tool: 'list_announcements', domain: 'announcements',
    args: {
      projectId,
      ...(pinnedOnly ? { pinnedOnly: true } : {}),
      ...(category ? { category } : {}),
      ...(activeOn ? { activeOn } : {}),
      limit: 50,
    },
  }
}

function minutesCall(input: ChatRequestV2, now: Date): RoutedToolCall {
  const entity = referencedEntity(input, ['minute', 'minute_block'])
  if (entity && /상세|자세히|세부|내용|본문|결정|액션|위험|요약/.test(input.message)) {
    return {
      id: 'call_minute_detail', tool: 'get_minute_detail', domain: 'minutes',
      args: { minuteId: entity.id },
    }
  }
  const projectId = projectHint(input)
  const team = teamFrom(input.message, input.pageContext)
  const range = hasRequestedRangeCue(input.message, now)
    ? requestedRange(input.message, input.pageContext, now)
    : null
  const query = explicitSearchQuery(input)
  return {
    id: 'call_minutes_search', tool: 'search_minutes', domain: 'minutes',
    args: {
      ...(projectId ? { projectId } : {}),
      ...(query ? { query } : {}),
      ...(team ? { team } : {}),
      ...(range ? { from: range.from, to: range.to } : {}),
      limit: 50,
    },
  }
}

function membersCall(input: ChatRequestV2): RoutedToolCall {
  const projectId = projectHint(input)
  const team = teamFrom(input.message, input.pageContext)
  // '멤버별/담당자별 업무'는 개인 담당 스키마가 없어 팀 단위 워크로드로 정직하게 답한다(설계 §9.1).
  if (/워크로드|업무량|(?:팀|멤버|담당자?|인원|사람)별\s*(?:업무|작업)|누가\s*(?:무슨|뭐|어떤)/.test(input.message)) {
    return {
      id: 'call_member_workload', tool: 'get_member_workload', domain: 'members',
      args: { projectId, ...(team ? { team } : {}) },
    }
  }
  const role = /관리자|어드민/i.test(input.message) ? 'admin' : undefined
  return {
    id: 'call_members', tool: 'list_members', domain: 'members',
    args: { projectId, ...(team ? { team } : {}), ...(role ? { role } : {}), limit: 50 },
  }
}

const KANBAN_VIEWS = new Set(['phase', 'owner', 'status'])

function kanbanCall(input: ChatRequestV2): RoutedToolCall {
  const projectId = projectHint(input)
  const pageView = input.pageContext?.view
  const view = typeof pageView === 'string' && KANBAN_VIEWS.has(pageView)
    ? pageView
    : /담당|팀별/.test(input.message) ? 'owner'
      : /단계|페이즈|phase/i.test(input.message) ? 'phase'
        : 'status'
  const status = wbsStatusFrom(input.message, input.pageContext)
  const team = teamFrom(input.message, input.pageContext)
  return {
    id: 'call_kanban', tool: 'get_kanban_view', domain: 'kanban',
    args: { projectId, view, ...(team ? { team } : {}), ...(status ? { status } : {}) },
  }
}

function dashboardCall(input: ChatRequestV2): RoutedToolCall {
  return {
    id: 'call_dashboard', tool: 'get_project_dashboard', domain: 'dashboard',
    args: { projectId: projectHint(input) },
  }
}

function settingsCall(input: ChatRequestV2): RoutedToolCall {
  return {
    id: 'call_settings', tool: 'get_safe_project_settings', domain: 'settings',
    args: { projectId: projectHint(input) },
  }
}

function statusFor(domains: BotDomain[]): string {
  const labels: Partial<Record<BotDomain, string>> = {
    wbs: 'WBS', weekly: '주간업무', meetings: '회의', attendance: '근태',
    announcements: '공지', minutes: '회의록', kanban: '칸반',
    dashboard: '대시보드', members: '멤버', settings: '설정',
  }
  return `${domains.map(d => labels[d] ?? d).join('·')} 데이터를 확인하고 있습니다.`
}

/**
 * Phase 1 routing is deliberately deterministic: explicit domain nouns win over generic words such as
 * "현황" or "이번 주", then the current page is used only as a tie-breaker.
 */
export function routeChatRequest(input: ChatRequestV2, now = new Date()): DeterministicRoute {
  if (isCommandUtterance(input.message)) {
    return {
      kind: 'command', domains: [], calls: [], reason: 'write_command',
      message: '변경 명령은 기존 확인형 명령 경로에서만 처리할 수 있어요. 변경 내용을 다시 입력해 확인 카드를 사용해 주세요.',
    }
  }

  const explicit = explicitDomains(input.message)
  const legacyIntent = classifyIntent(input.message)
  // 포트폴리오(전사·전체 프로젝트) 질문은 프로젝트 목록 도구가 v2 범위 밖이라 항상 레거시.
  const portfolioIntent = /전사|(?:전체|모든|모두)\s*프로젝트/.test(input.message)
  // 일반어 기반 레거시 의도는 명시 도메인 명사가 전혀 없을 때만 적용한다(명시 명사 우선 원칙).
  // 예전의 memberBreakdown/워크로드 게이트는 members 도구가 흡수했다.
  if (
    portfolioIntent
    || (!explicit.length && (
      legacyIntent === 'overview'
      || legacyIntent === 'by_team'
      || legacyIntent === 'weekly_summary'
    ))
  ) {
    return {
      kind: 'legacy', domains: [], calls: [], reason: `legacy_intent:${portfolioIntent ? 'portfolio' : legacyIntent}`,
      message: '이 질문은 기존 DK Bot에서 답변합니다.',
    }
  }

  const contextual = usefulContextDomain(input.pageContext)
  const conversational = conversationDomains(input)
  const domains = uniq(explicit.length ? explicit : contextual ? [contextual] : conversational)
    .filter((d): d is V2ReadDomain => V2_READ_DOMAIN_SET.has(d))
    .slice(0, 3)

  if (!domains.length) {
    return {
      kind: 'legacy', domains: [], calls: [], reason: `unsupported_page:${input.pageContext?.domain ?? 'none'}`,
      message: '이 페이지나 질문은 기존 DK Bot에서 답변합니다.',
    }
  }


  if (
    domains.includes('attendance')
    && domains.includes('meetings')
    && /참석자|참여자|참석\s*(?:인원|멤버)/.test(input.message)
  ) {
    return {
      kind: 'legacy', domains, calls: [], reason: 'unsupported_meeting_attendance_intersection',
      message: '회의 참석자와 근태를 교차 확인하는 질문은 기존 DK Bot에서 답변합니다.',
    }
  }

  if (
    domains.includes('meetings')
    && /참석자|참여자|상세|자세히|세부|회의\s*내용|회의\s*안건/.test(input.message)
    && !referencedEntity(input, ['meeting', 'meeting_occurrence'])
  ) {
    return {
      kind: 'clarify', domains, calls: [], reason: 'meeting_selection_required',
      message: '상세 내용이나 참석자를 확인할 회의를 먼저 선택해 주세요.',
    }
  }

  if (
    domains.includes('minutes')
    && /(?:이|그|해당)\s*회의록/.test(input.message)
    && !referencedEntity(input, ['minute', 'minute_block'])
  ) {
    return {
      kind: 'clarify', domains, calls: [], reason: 'minute_selection_required',
      message: '상세 내용을 확인할 회의록을 먼저 선택해 주세요.',
    }
  }

  // 내 회의(전역)와 회의록 보관함(전역)은 프로젝트 없이도 조회 가능한 유일한 도메인이다.
  const supportsProjectlessMeetings = domains.length === 1
    && (domains[0] === 'meetings' || domains[0] === 'minutes')
  if (!projectHint(input) && !supportsProjectlessMeetings) {
    if (!contextual) {
      return {
        kind: 'legacy', domains, calls: [], reason: 'legacy_project_scope',
        message: '이 질문은 기존 DK Bot에서 답변합니다.',
      }
    }
    return {
      kind: 'clarify', domains, calls: [], reason: 'project_required',
      message: '확인할 프로젝트를 선택한 뒤 다시 질문해 주세요.',
    }
  }
  if (
    domains.includes('wbs')
    && /변경\s*이력|누가\s*(?:바꿨|수정)|최근\s*변경|첨부|파일/.test(input.message)
    && !referencedEntity(input, ['wbs_item'])
  ) {
    return {
      kind: 'clarify', domains, calls: [], reason: 'wbs_item_required',
      message: '변경 이력이나 첨부파일을 확인할 WBS 작업을 먼저 선택해 주세요.',
    }
  }

  const calls = domains.map(domain => {
    if (domain === 'wbs') return wbsCall(input, now)
    if (domain === 'weekly') return weeklyCall(input, now)
    if (domain === 'meetings') return meetingsCall(input, now)
    if (domain === 'attendance') return attendanceCall(input, now)
    if (domain === 'announcements') return announcementsCall(input, now)
    if (domain === 'minutes') return minutesCall(input, now)
    if (domain === 'members') return membersCall(input)
    if (domain === 'kanban') return kanbanCall(input)
    if (domain === 'dashboard') return dashboardCall(input)
    return settingsCall(input)
  })
  return {
    kind: 'tools', domains, calls,
    reason: explicit.length ? 'explicit_domain_terms' : contextual ? 'page_context' : 'conversation_state',
    statusMessage: statusFor(domains),
  }
}

// capability의 단일 원천은 각 도구 객체의 requiredCapability다(리뷰 M-3).
// 라우터는 도구를 호출하지 않으므로 별도 capability 표를 유지하지 않는다.

/** 플래너 게이트 입력(설계 §7.1) — 명시 도메인 수와 현재 페이지 도메인의 v2 지원 여부. */
export function planningSignals(input: ChatRequestV2): {
  explicitDomainCount: number
  pageDomainSupported: boolean
} {
  return {
    explicitDomainCount: explicitDomains(input.message).length,
    pageDomainSupported: input.pageContext
      ? V2_READ_DOMAIN_SET.has(input.pageContext.domain)
      : false,
  }
}
