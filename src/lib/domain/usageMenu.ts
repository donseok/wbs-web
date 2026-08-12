import type { DictKey } from '@/lib/i18n/dict'

/**
 * 사용 현황 집계의 메뉴 정본 목록.
 * 사이드바(projectMenu)와 전역 링크를 반영하되 **메뉴에서 내린 화면도 남긴다** — 이 목록은
 * 현재 메뉴가 아니라 과거 사용 이벤트를 읽는 사전이라, 지우면 지난 기록이 이름을 잃는다.
 * (admin-accounts·wiki 가 그런 항목이다. '고아 엔트리'로 보고 정리하지 말 것.)
 * 여기 없는 경로는 'unknown' 으로
 * 모이며 가까운 메뉴로 추측해 붙이지 않는다(리포의 "모르면 unknown" 관례).
 * labelKey 가 null 인 항목은 i18n 사전이 없는 /admin/* 이다 — 관리자 화면은 한국어 하드코딩.
 */
export interface UsageMenu {
  key: string
  labelKey: DictKey | null
  fallback: string
}

export const USAGE_MENUS: readonly UsageMenu[] = [
  { key: 'dashboard', labelKey: 'nav.dashboard', fallback: '대시보드' },
  { key: 'wbs', labelKey: 'nav.wbsGantt', fallback: 'WBS · 간트' },
  { key: 'kanban', labelKey: 'nav.kanban', fallback: '칸반 보드' },
  { key: 'meetings', labelKey: 'nav.meetings', fallback: '회의일정' },
  { key: 'weekly', labelKey: 'nav.weekly', fallback: '주간업무' },
  { key: 'issues', labelKey: 'nav.issues', fallback: '이슈관리' },
  { key: 'wiki', labelKey: 'nav.wiki', fallback: '프로젝트 Wiki' },
  { key: 'announcements', labelKey: 'nav.announcements', fallback: '공지사항' },
  { key: 'members', labelKey: 'nav.members', fallback: '멤버' },
  { key: 'attendance', labelKey: 'nav.attendance', fallback: '근태현황' },
  { key: 'settings', labelKey: 'nav.settings', fallback: '설정' },
  { key: 'my-meetings', labelKey: 'nav.myMeetings', fallback: '내 회의' },
  { key: 'minutes', labelKey: 'nav.minutes', fallback: '회의록' },
  { key: 'projects', labelKey: 'nav.home', fallback: '홈' },
  { key: 'usage', labelKey: 'nav.usage', fallback: '사용 현황' },
  { key: 'admin-accounts', labelKey: null, fallback: '계정 관리' },
  { key: 'admin-teams', labelKey: null, fallback: '팀 관리' },
  { key: 'admin-llm', labelKey: null, fallback: 'LLM 설정' },
  { key: 'unknown', labelKey: null, fallback: '기타' },
] as const

/** /p/<id>/<seg> 의 seg 로 그대로 쓰는 프로젝트 스코프 키. */
const PROJECT_SEGMENT_KEYS = new Set([
  'dashboard', 'wbs', 'kanban', 'meetings', 'weekly',
  'issues', 'wiki', 'announcements', 'members', 'attendance', 'settings',
])

/** 쿼리스트링·해시·끝 슬래시를 제거한 경로. */
function bare(pathname: string): string {
  const p = pathname.split('?')[0].split('#')[0]
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p
}

/**
 * 경로 → 메뉴 키. 모르면 'unknown'(추측 금지).
 * 신규 메뉴를 사이드바에 추가하고 여기를 안 고치면 tests/domain/usage-menu.test.ts 가 깨진다.
 */
export function resolveMenuKey(pathname: string): string {
  const p = bare(pathname)
  const proj = p.match(/^\/p\/[^/]+\/([^/]+)/)
  if (proj) return PROJECT_SEGMENT_KEYS.has(proj[1]) ? proj[1] : 'unknown'
  if (p === '/projects' || p.startsWith('/projects/')) return 'projects'
  if (p === '/meetings' || p.startsWith('/meetings/')) return 'my-meetings'
  if (p === '/minutes' || p.startsWith('/minutes/')) return 'minutes'
  if (p === '/usage') return 'usage'
  if (p === '/admin/accounts') return 'admin-accounts'
  if (p === '/admin/teams') return 'admin-teams'
  if (p === '/admin/llm-config') return 'admin-llm'
  return 'unknown'
}

/** 저장용 경로 — UUID 를 ':id' 로 접고 200자로 자른다(카디널리티·행 크기 제한). */
export function normalizeUsagePath(pathname: string): string {
  return bare(pathname)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .slice(0, 200)
}

/** 프로젝트 스코프 경로의 프로젝트 id. 전역 경로면 null. */
export function extractProjectId(pathname: string): string | null {
  const m = bare(pathname).match(
    /^\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i,
  )
  return m ? m[1] : null
}

/** 메뉴 키의 표시 라벨. 정의에 없는 키는 키 자체를 돌려준다(임의 한국어 생성 금지). */
export function menuLabel(key: string, translate: (k: DictKey) => string): string {
  const m = USAGE_MENUS.find(x => x.key === key)
  if (!m) return key
  return m.labelKey ? translate(m.labelKey) : m.fallback
}
