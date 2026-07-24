import 'server-only'

// ============================================================================
// 팀 기준정보 런타임 캐시 — lib/ai/llm-override.ts 와 동일한 검증된 패턴.
// 동기 소비처(레이아웃·AI 도구·레포 매핑)가 많아 동기 접근자 + TTL 백그라운드 갱신.
// service_role 로 읽는 이유: 캐시는 프로세스 전역이라 사용자 세션 컨텍스트가 없다(읽기 전용 select).
// ============================================================================

import { activeCodes, DEFAULT_TEAMS, type Team } from '@/lib/domain/teams'
import type { TeamCode } from '@/lib/domain/types'
import { createAdminClient } from '@/lib/supabase/admin'

const TTL_MS = 60_000
const LOAD_TIMEOUT_MS = 3_000
/** 로드 실패 후 재시도 간격 — 실패에 TTL 전체를 물리면 stale 구간이 불필요하게 길어진다. */
const RETRY_MS = 10_000

let cache: readonly Team[] = DEFAULT_TEAMS
/** 한 번이라도 DB 로드에 성공했는가 — 실패 시 '직전 유효값 보존 vs 기본 5팀'을 가르는 기준. */
let everLoaded = false
let nextRefreshAt = 0
/** 로드 직렬화 큐 — 동시 로드가 끝나는 순서에 따라 옛 스냅샷이 캐시를 덮는 것을 막는다. */
let queue: Promise<unknown> = Promise.resolve()
let background: Promise<unknown> | null = null

async function fetchTeams(): Promise<readonly Team[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('teams')
    .select('id, code, sort_order, active, progress_visible')
    .order('sort_order')
    .order('code')
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const teams = rows
    .filter(r => typeof r.code === 'string' && (r.code as string).trim() !== '')
    .map(r => ({
      id: String(r.id),
      code: (r.code as string).trim(),
      sortOrder: Number(r.sort_order ?? 0),
      active: r.active !== false,
      progressVisible: r.progress_visible !== false,
    }))
  // 빈 목록은 폴백 유지 — teams 테이블이 비는 건 정상 상태가 아니다(전 화면 팀 축 소실 방지).
  if (teams.length === 0) throw new Error('teams 테이블이 비어 있습니다')
  return teams
}

/** 남은 타이머는 반드시 해제한다 — 안 하면 Node 프로세스가 타임아웃까지 종료되지 않는다. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`팀 마스터 로드 ${ms}ms 초과`)), ms)
  })
  return Promise.race([promise, guard]).finally(() => { if (timer) clearTimeout(timer) })
}

/** 성공하면 캐시 교체 후 true. 절대 throw 하지 않는다(큐가 실패로 고착되지 않도록). */
async function load(): Promise<boolean> {
  try {
    cache = await withTimeout(fetchTeams(), LOAD_TIMEOUT_MS)
    everLoaded = true
    nextRefreshAt = Date.now() + TTL_MS
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 직전 유효값을 버리지 않는다 — DB 순단 한 번으로 팀 목록이 기본 5팀으로 되돌아가면
    // 관리자가 추가한 팀이 화면·검증에서 조용히 사라진다.
    if (!everLoaded) console.error('[teams] 최초 팀 마스터 로드 실패 — 기본 5팀으로 기동:', message)
    else console.error('[teams] 팀 마스터 갱신 실패 — 직전 값을 유지합니다:', message)
    nextRefreshAt = Date.now() + RETRY_MS
    return false
  }
}

/** DB 즉시 재조회 + 캐시 교체. 팀 관리 액션 저장 후 await 한다.
 *  진행 중 로드에 편승하지 않고 큐에 이어 붙이는 이유는 llm-override 의 동명 함수 주석 참조
 *  (편승하면 저장 직후 캐시가 옛 값으로 확정된 채 TTL 을 탄다). */
export function refreshTeams(): Promise<boolean> {
  const next = queue.then(load, load)
  queue = next.then(() => {}, () => {})
  return next
}

/** 전체 팀(비활성 포함, sort_order 정렬). TTL 만료 시 백그라운드 갱신만 트리거. */
export function teamsSync(): readonly Team[] {
  if (!background && Date.now() >= nextRefreshAt) {
    background = refreshTeams().catch(() => false).finally(() => { background = null })
  }
  return cache
}

/** 활성 팀 코드(정렬됨) — 탭·필터·검증 공용. */
export function activeTeamCodesSync(): TeamCode[] {
  return activeCodes(teamsSync())
}

/** 비활성 포함 등록 여부 — 기존 데이터 표시·시드 폴더 앵커 보호·엑셀 임포트 검증용. */
export function isRegisteredTeamCode(code: string): boolean {
  return teamsSync().some(t => t.code === code)
}

/** 활성 팀 여부 — 신규 입력 검증용(비활성 팀으로의 새 등록은 거부). */
export function isActiveTeamCode(code: string): boolean {
  return teamsSync().some(t => t.active && t.code === code)
}

// 모듈 초기화에서 최초 1회를 await 한다. lazy 면 콜드스타트 인스턴스의 첫 요청들이
// 폴백 5팀으로 렌더된다(관리자가 추가한 팀이 순간적으로 사라져 보임).
await refreshTeams()
