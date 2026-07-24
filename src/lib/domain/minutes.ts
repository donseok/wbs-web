import type { ExplorerLeaf, FolderNode, MinuteFolder, TeamCode } from './types'

export const MINUTE_TITLE_MAX = 200
export const MINUTE_BODY_MAX = 100_000          // body_md 실효 한도(자)
export const MINUTE_BODY_FILE_MAX = 1_048_576   // 원시 .md 파일 안전망(1MB)
export const MINUTE_ATTACHMENT_MAX = 20_971_520 // 첨부 개당 20MB(버킷 file_size_limit와 일치)
export const MINUTE_ATTACHMENTS_MAX_COUNT = 10

export const TEAM_CODES: TeamCode[] = ['PMO', 'ERP', 'MES', '가공', 'MDM']

/* ── 팀 기본 폴더(0043): 루트의 팀코드 동명 시드 폴더는 자동 편철 앵커 ── */

/** 루트 레벨에서 예약된 이름인지 — 사용자 루트 폴더의 생성·개명이 이 이름을 점유(스쿼팅)하면
 *  팀 자동 편철이 하이재킹되므로 서버 액션에서 차단한다. */
export function isTeamRootName(name: string): boolean {
  return (TEAM_CODES as readonly string[]).includes(name.trim())
}

/** 시드 팀 루트 폴더인지(루트 + created_by null + 팀코드 동명) — 개명·삭제 금지 대상.
 *  개명·삭제되면 해당 팀의 자동 편철이 소리 없이 끊긴다. */
export function isTeamRootFolder(
  f: Pick<MinuteFolder, 'name' | 'parentId' | 'createdBy'>,
): boolean {
  return f.parentId === null && f.createdBy === null
    && typeof f.name === 'string' && isTeamRootName(f.name)
}

/* ── 담당 하위 구분(업로드 편철): 시드 폴더 트리(0043)와 동일 ── */

/** 팀별 하위 구분 — ERP/MES 는 시드 하위 폴더와 동일, 단독 팀(PMO/가공/MDM)은 자기 자신. */
export const TEAM_SUBGROUPS: Record<TeamCode, readonly string[]> = {
  PMO: ['PMO'],
  ERP: ['영업', '구매', '관리회계'],
  MES: ['품질', '생산계획', '조업및표준화', '물류', '설비및L2'],
  가공: ['가공'],
  MDM: ['MDM'],
}

/** 하위 구분 별칭 — APS 조직은 향후 MES 로 흡수되며 하위명이 생산계획으로 바뀐다(사용자 결정
 *  2026-07-24). 어느 입력 경로로든 'APS' 가 오면 생산계획으로 정규화한다. */
const TEAM_SUB_ALIASES: Record<string, string> = { APS: '생산계획' }

/** 별칭 해소 + 목록 검증 — 해당 팀의 하위 구분이 아니면 null(추측 금지). */
function resolveTeamSub(team: TeamCode, sub: string): string | null {
  const resolved = TEAM_SUB_ALIASES[sub.trim()] ?? sub.trim()
  return TEAM_SUBGROUPS[team].includes(resolved) ? resolved : null
}

/** 하위 구분 정규화 — 별칭 해소 후 해당 팀 목록에 없으면 첫 항목(대표)으로 수렴. */
export function normalizeTeamSub(team: TeamCode, sub: string): string {
  return resolveTeamSub(team, sub) ?? TEAM_SUBGROUPS[team][0]
}

/** 팀 시드 폴더(루트 5축 + 그 시드 하위 구분)인지 — 편철 앵커라 개명·삭제 금지 대상.
 *  하위 구분은 TEAM_SUBGROUPS 하드코딩과 이름 매칭으로 결합되므로 시드 자식의 개명도
 *  루트와 동일하게 막아야 드리프트(조용한 오편철)가 없다. */
export function isTeamSeedFolder(
  folders: MinuteFolder[], f: Pick<MinuteFolder, 'name' | 'parentId' | 'createdBy'>,
): boolean {
  if (isTeamRootFolder(f)) return true
  if (f.createdBy !== null || f.parentId === null) return false
  const parent = folders.find(p => p.id === f.parentId)
  return !!parent && isTeamRootFolder(parent)
}

/** 팀의 시드 루트 폴더 id — 시드(createdBy null) 한정, 동명 사용자 폴더 배제. */
export function teamRootFolderIdOf(folders: MinuteFolder[], team: TeamCode): string | null {
  return folders.find(f => f.parentId === null && f.createdBy === null && f.name === team)?.id ?? null
}

/** (팀, 하위 구분) → 편철 대상 시드 폴더 id. 자기 자신 하위는 팀 루트, 세부 하위는 시드 자식.
 *  자식 미존재(비정상)는 팀 루트로 강등, 루트조차 없으면 null(서버 자동 편철 폴백). 매칭은
 *  시드(createdBy null) 한정 — 동명 사용자 폴더 배제(resolveTeamRootFolderId 와 동일 원칙). */
export function subgroupFolderId(
  folders: MinuteFolder[], team: TeamCode, sub: string,
): string | null {
  const rootId = teamRootFolderIdOf(folders, team)
  if (!rootId) return null
  const name = normalizeTeamSub(team, sub)
  if (name === team) return rootId
  const child = folders.find(f => f.parentId === rootId && f.createdBy === null && f.name === name)
  return child?.id ?? rootId
}

/** 폴더 id → (팀, 하위 구분) 역해석 — 모달의 초기값. 사용자 폴더면 시드 조상까지 걸어 올라가
 *  판정(순환 가드), 시드 체인 밖이면 null. sub 는 실제 시드 하위(또는 자기 자신 팀)에 닿을
 *  때만 채워진다 — ERP/MES **루트** 편철·개명 드리프트는 sub null(하위 미지정, 추측 금지):
 *  대표 폴백을 초기 선택으로 쓰면 실소속과 다른 하위가 '선택됨'으로 보이는 허위 표시가 된다. */
export function teamSubOfFolder(
  folders: MinuteFolder[], folderId: string | null,
): { team: TeamCode; sub: string | null } | null {
  if (!folderId) return null
  const byId = new Map(folders.map(f => [f.id, f]))
  const seen = new Set<string>()
  let cur = byId.get(folderId)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    if (cur.createdBy === null) {
      if (cur.parentId === null) {
        if (isTeamRootName(cur.name)) {
          const team = cur.name as TeamCode
          return { team, sub: resolveTeamSub(team, cur.name) }   // 단독 팀=자기 자신, ERP/MES 루트=null
        }
        return null  // 시드지만 팀 루트가 아님(0043 이전 형태) — 판정 불가
      }
      const parent = byId.get(cur.parentId)
      if (parent && parent.parentId === null && parent.createdBy === null && isTeamRootName(parent.name)) {
        const team = parent.name as TeamCode
        return { team, sub: resolveTeamSub(team, cur.name) }     // 드리프트면 sub null
      }
    }
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface MinuteInput {
  minuteDate: string     // 'YYYY-MM-DD'
  teamCode: TeamCode
  title: string
  bodyMd: string
  meetingId: string | null
}

/** 회의록 입력 검증 — 에러 메시지 또는 null. create/updateMeta/replaceBody 가 공유. */
export function validateMinuteInput(input: MinuteInput): string | null {
  const title = input.title.trim()
  if (!title) return '제목을 입력하세요.'
  if (title.length > MINUTE_TITLE_MAX) return `제목은 ${MINUTE_TITLE_MAX}자 이하여야 합니다.`
  if (!DATE_RE.test(input.minuteDate)) return '날짜 형식이 올바르지 않습니다.'
  if (!TEAM_CODES.includes(input.teamCode)) return '잘못된 담당입니다.'
  if (input.bodyMd.length > MINUTE_BODY_MAX) return '본문은 100,000자 이하여야 합니다.'
  return null
}

/** 원본 표시명과 별개로 Supabase Storage 객체 키에 사용할 ASCII 파일명. */
export function sanitizeFileName(name: string): string {
  const safe = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/\.{2,}/g, '.')

  return safe && !/^[._-]+$/.test(safe) ? safe : 'file'
}

/** Storage 경로가 해당 회의록 전용 접두({minuteId}/)인지 — 타 객체를 가리키는 메타 기록 차단. */
export function isMinuteFilePathValid(minuteId: string, path: string): boolean {
  return path.startsWith(`${minuteId}/`) && !path.includes('..')
}

/** PostgREST or() 필터에 안전하게 삽입할 ILIKE 패턴(큰따옴표 인용 포함).
 *  1단계: LIKE 이스케이프(\, %, _ 를 \ 접두) → 2단계: PostgREST 인용 이스케이프(\ 와 " ). */
export function ilikeOrPattern(needle: string): string {
  const like = needle.replace(/[\\%_]/g, m => `\\${m}`)
  const quoted = like.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"%${quoted}%"`
}

/* ── 트리 뷰: 회의체 추출 (스펙 2026-07-17-minutes-tree-view-design.md) ── */

export const MINUTES_TREE_LIMIT = 1000 // PostgREST max_rows 하드 캡(supabase/config.toml)과 일치 — 초과 값은 성립 불가

// 노이즈 토큰(전체 일치): 날짜형 5패턴(6/8자리·연월일·2자리 연도·월일, 꼬리 요일 괄호 허용) + 회차형 + 요일 괄호 단독
const WEEKDAY_TAIL = '(?:\\((?:월|화|수|목|금|토|일)\\))?'
const NOISE_PATTERNS = [
  new RegExp(`^\\d{6}${WEEKDAY_TAIL}$`),                                    // 260716
  new RegExp(`^\\d{8}${WEEKDAY_TAIL}$`),                                    // 20260716
  new RegExp(`^\\d{4}[.\\-/]\\d{1,2}(?:[.\\-/]\\d{1,2})?${WEEKDAY_TAIL}$`), // 2026-07-16, 2026.07
  new RegExp(`^\\d{2}[.\\-/]\\d{1,2}[.\\-/]\\d{1,2}${WEEKDAY_TAIL}$`),      // 26.07.16
  new RegExp(`^\\d{1,2}[.\\-/]\\d{1,2}${WEEKDAY_TAIL}$`),                   // 7.16, 07-16
  /^\(?제?\d{1,4}차\)?$/,                                                    // 12차, 제3차, (5차)
  /^\((?:월|화|수|목|금|토|일)\)$/,                                          // (수)
]

function isNoiseToken(token: string): boolean {
  return NOISE_PATTERNS.some(re => re.test(token))
}

/** 제목에서 회의체 이름 추출 — `_`·공백 토큰화 후 노이즈(날짜·회차·요일) 제거, 공백 1칸 결합.
 *  전부 제거되어 비면 원제목(trim) 반환. 그룹 키이자 표시명. */
export function meetingBodyOf(title: string): string {
  const trimmed = title.trim()
  const kept = trimmed.split(/[_\s]+/).filter(tok => tok !== '' && !isNoiseToken(tok))
  return kept.length > 0 ? kept.join(' ') : trimmed
}

/* ── 탐색기 v2: 폴더 디렉토리 (스펙 2026-07-23-minutes-folders-design.md) ── */

export const MINUTE_FOLDER_NAME_MAX = 60
export const MINUTE_FOLDER_DEPTH_MAX = 5

/** 폴더 이름 검증 — 에러 메시지 또는 null (validateMinuteInput 관례). */
export function validateFolderName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return '폴더 이름을 입력하세요.'
  if (trimmed.length > MINUTE_FOLDER_NAME_MAX) return `폴더 이름은 ${MINUTE_FOLDER_NAME_MAX}자 이하여야 합니다.`
  return null
}

/** folderId 가 트리에서 몇 단인지(null=0, 루트=1). 순환·끊긴 체인은 상한 초과 값으로 수렴해
 *  호출부의 깊이 검증이 자연히 거부하게 한다(무한 루프 방지 가드). */
export function folderDepthOf(folders: MinuteFolder[], folderId: string | null): number {
  const byId = new Map(folders.map(f => [f.id, f]))
  let depth = 0
  let cur = folderId
  while (cur) {
    depth += 1
    if (depth > MINUTE_FOLDER_DEPTH_MAX) return depth  // 순환/과깊이 — 즉시 초과 반환
    cur = byId.get(cur)?.parentId ?? null
  }
  return depth
}

/** 폴더 + 리프 → 디렉토리 트리. 정렬은 sort asc·name asc(시드 0~9 우선), directLeaves 는 입력
 *  순서 보존(재정렬 없음). 방어: 부모가 목록에 없는 고아·순환 참조 폴더는 루트로 승격(조용히
 *  버리지 않음), 미존재 폴더를 가리키는 리프는 unfiled 로. */
export function buildFolderTree(
  folders: MinuteFolder[], leaves: ExplorerLeaf[],
): { roots: FolderNode[]; unfiled: ExplorerLeaf[] } {
  const nodeById = new Map<string, FolderNode>(
    folders.map(f => [f.id, { folder: f, children: [], directLeaves: [], totalCount: 0 }]))

  // 루트 판정: 부모 없음 / 부모 미존재(고아) / 조상 체인이 순환(자신에게 되돌아옴)
  const isRoot = (f: MinuteFolder): boolean => {
    if (f.parentId === null || !nodeById.has(f.parentId)) return true
    let cur: string | null = f.parentId
    const seen = new Set<string>([f.id])
    while (cur) {
      if (seen.has(cur)) return true  // 순환 절단
      seen.add(cur)
      cur = nodeById.get(cur)?.folder.parentId ?? null
    }
    return false
  }

  const roots: FolderNode[] = []
  for (const f of folders) {
    const node = nodeById.get(f.id)!
    if (isRoot(f)) roots.push(node)
    else nodeById.get(f.parentId!)!.children.push(node)
  }

  const bySort = (a: FolderNode, b: FolderNode) =>
    a.folder.sort - b.folder.sort || a.folder.name.localeCompare(b.folder.name, 'ko')
  const sortRec = (nodes: FolderNode[]) => {
    nodes.sort(bySort)
    for (const n of nodes) sortRec(n.children)
  }
  sortRec(roots)

  const unfiled: ExplorerLeaf[] = []
  for (const l of leaves) {
    const node = l.folderId ? nodeById.get(l.folderId) : undefined
    if (node) node.directLeaves.push(l)
    else unfiled.push(l)
  }

  const sumRec = (node: FolderNode): number => {
    node.totalCount = node.directLeaves.length + node.children.reduce((n, c) => n + sumRec(c), 0)
    return node.totalCount
  }
  for (const r of roots) sumRec(r)

  return { roots, unfiled }
}
