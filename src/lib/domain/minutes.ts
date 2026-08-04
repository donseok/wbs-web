import type { ExplorerLeaf, FolderNode, MinuteFolder, TeamCode } from './types'
import { DEFAULT_TEAM_CODES } from './teams'

export const MINUTE_TITLE_MAX = 200
export const MINUTE_BODY_MAX = 100_000          // body_md 실효 한도(자)
export const MINUTE_BODY_FILE_MAX = 1_048_576   // 원시 .md 파일 안전망(1MB)
export const MINUTE_ATTACHMENT_MAX = 20_971_520 // 첨부 개당 20MB(버킷 file_size_limit와 일치)
export const MINUTE_ATTACHMENTS_MAX_COUNT = 10

/** @deprecated 기본 5팀 폴백 — 런타임 기준은 팀 마스터. 호출처에서 활성 팀 목록을 주입할 것. */
export const TEAM_CODES: readonly TeamCode[] = DEFAULT_TEAM_CODES

/* ── 팀 기본 폴더(0043): 루트의 팀코드 동명 시드 폴더는 자동 편철 앵커 ── */

/** 루트 레벨에서 예약된 이름인지 — 사용자 루트 폴더의 생성·개명이 이 이름을 점유(스쿼팅)하면
 *  팀 자동 편철이 하이재킹되므로 서버 액션에서 차단한다.
 *  teamCodes 는 **비활성 포함 전체 등록 팀**(teamsSync) — 비활성 팀 앵커도 보호한다. */
export function isTeamRootName(name: string, teamCodes: readonly string[]): boolean {
  return teamCodes.includes(name.trim())
}

/** 시드 팀 루트 폴더인지(루트 + created_by null) — 개명·삭제 금지 대상.
 *  0043 이후 루트의 created_by null 은 팀 시드뿐이고, 신규 팀 추가 액션도 같은 형태로
 *  생성하므로 이름 목록 대조 없이 판정한다(팀 마스터 변화에 자동 추종).
 *  개명·삭제되면 해당 팀의 자동 편철이 소리 없이 끊긴다. */
export function isTeamRootFolder(
  f: Pick<MinuteFolder, 'name' | 'parentId' | 'createdBy'>,
): boolean {
  return f.parentId === null && f.createdBy === null
}

/* ── 담당 하위 구분(업로드 편철): 팀 루트의 실제 하위 폴더에서 동적 유도 ── */

/** 트리 표시와 동일한 정렬(sort asc → name ko asc) — buildFolderTree 의 bySort 와 일치해야
 *  모달의 하위 구분 탭 순서와 탐색기 트리 순서가 어긋나지 않는다. */
const byFolderOrder = (a: MinuteFolder, b: MinuteFolder) =>
  a.sort - b.sort || a.name.localeCompare(b.name, 'ko')

/** 팀의 시드 루트 폴더 id — 시드(createdBy null) 한정, 동명 사용자 폴더 배제. */
export function teamRootFolderIdOf(folders: MinuteFolder[], team: TeamCode): string | null {
  return folders.find(f => f.parentId === null && f.createdBy === null && f.name === team)?.id ?? null
}

/** 팀 루트의 직계 하위 폴더 — 하위 구분의 원천. 시드·사용자 폴더를 가리지 않으므로 폴더
 *  생성/개명/삭제가 챗 필터 칩·업로드·수정 모달의 하위 구분 옵션에 그대로 반영된다. */
export function teamChildFoldersOf(folders: MinuteFolder[], team: TeamCode): MinuteFolder[] {
  const rootId = teamRootFolderIdOf(folders, team)
  if (!rootId) return []
  return folders.filter(f => f.parentId === rootId).sort(byFolderOrder)
}

/** 폴더 하위 트리 id(자기 자신 포함) — 챗 폴더 필터의 검색 범위. BFS·순환 가드.
 *  부재 id 도 자기 자신 1개로 반환한다 — 빈 배열을 돌려주면 호출부의 "필터 없음" 분기와
 *  구분되지 않아 필터가 소리 없이 전체로 넓어진다(fail-closed). */
export function folderSubtreeIds(
  folders: readonly Pick<MinuteFolder, 'id' | 'parentId'>[], rootId: string,
): string[] {
  const children = new Map<string, string[]>()
  for (const f of folders) {
    if (f.parentId === null) continue
    const arr = children.get(f.parentId)
    if (arr) arr.push(f.id); else children.set(f.parentId, [f.id])
  }
  const out = new Set<string>([rootId])
  const queue = [rootId]
  while (queue.length) {
    for (const c of children.get(queue.pop()!) ?? []) {
      if (!out.has(c)) { out.add(c); queue.push(c) }
    }
  }
  return [...out]
}

/** 팀별 하위 구분 — 팀 루트의 실제 하위 폴더명. 하위 폴더가 없으면(팀 루트 부재 포함)
 *  자기 자신 1개(상위 폴더=하위 폴더).
 *  @deprecated §6 폴더 중심 재편으로 (팀, 하위 구분) 2단 모델이 폐지되어 프로덕션 사용처가 0이다.
 *  편철 폴더는 FolderPickModal 로 직접 고르고 team 은 teamSubOfFolder 로 파생한다. */
export function subgroupsOf(folders: MinuteFolder[], team: TeamCode): string[] {
  const names = teamChildFoldersOf(folders, team).map(f => f.name)
  return names.length > 0 ? names : [team]
}

/** 하위 구분 별칭 — APS 조직은 향후 MES 로 흡수되며 하위명이 생산계획으로 바뀐다(사용자 결정
 *  2026-07-24). 실폴더명 일치가 우선이고 별칭은 동명 폴더가 없을 때만 적용 — 'APS' 폴더가
 *  실제로 생기면 그 폴더가 진실이지, 별칭이 가로채 다른 폴더로 편철하면 안 된다. */
const TEAM_SUB_ALIASES: Record<string, string> = { APS: '생산계획' }

/** 별칭 해소 + 목록 검증 — 해당 팀의 하위 구분이 아니면 null(추측 금지).
 *  @deprecated §6 재편으로 프로덕션 사용처 0. APS→생산계획 별칭 결정을 보존하기 위해 남겨 둔다. */
export function resolveTeamSub(folders: MinuteFolder[], team: TeamCode, sub: string): string | null {
  const names = subgroupsOf(folders, team)
  const trimmed = sub.trim()
  if (names.includes(trimmed)) return trimmed
  const alias = TEAM_SUB_ALIASES[trimmed]
  return alias !== undefined && names.includes(alias) ? alias : null
}

/** (팀, 하위 구분) → 편철 대상 폴더 id. 하위 구분과 동명인 루트 직계 하위 폴더(시드·사용자
 *  불문)가 있으면 그 폴더, 없으면(자기 자신 하위·목록 밖 값 포함) 팀 루트로 — 목록 밖 값을
 *  대표 하위로 수렴시키면 요청과 다른 형제로 오편철되므로 추측 없이 루트로 강등한다.
 *  루트조차 없으면 null(서버 자동 편철 폴백). 루트 매칭만 시드 한정 — 동명 사용자 **루트**
 *  폴더(스쿼팅) 배제.
 *  @deprecated §6 재편으로 프로덕션 사용처 0. **이 함수가 3단 이상 경로를 2단으로 강등시키던
 *  주범**이다(루트 직계 자식 id 를 반환) — 되살리지 말 것. 편철은 폴더를 직접 고르게 한다. */
export function subgroupFolderId(
  folders: MinuteFolder[], team: TeamCode, sub: string,
): string | null {
  const rootId = teamRootFolderIdOf(folders, team)
  if (!rootId) return null
  const name = resolveTeamSub(folders, team, sub)
  if (name === null) return rootId
  const child = folders.find(f => f.parentId === rootId && f.name === name)
  return child?.id ?? rootId
}

/** 폴더 id → (팀, 하위 구분) 역해석 — 모달의 초기값. 조상 체인을 걸어 올라가(순환 가드) 시드
 *  팀 루트에 닿으면, 루트 직전에 지나온 직계 하위 폴더의 이름이 하위 구분. 팀 루트 자체에
 *  편철된 경우는 하위 폴더가 없는 팀만 자기 자신이고, 하위가 있는 팀은 sub null(하위 미지정,
 *  추측 금지): 대표 폴백을 초기 선택으로 쓰면 실소속과 다른 하위가 '선택됨'으로 보이는 허위
 *  표시가 된다. 시드 체인 밖(사용자 루트 폴더 등)은 null. */
export function teamSubOfFolder(
  folders: MinuteFolder[], folderId: string | null,
): { team: TeamCode; sub: string | null } | null {
  if (!folderId) return null
  const byId = new Map(folders.map(f => [f.id, f]))
  const seen = new Set<string>()
  let cur = byId.get(folderId)
  let below: MinuteFolder | undefined            // cur 직전에 지나온 폴더(= cur 의 직계 하위)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    if (isTeamRootFolder(cur)) {
      const team = cur.name                      // 0043 이후 루트 시드 = 팀 루트 — 폴더명이 곧 팀 코드
      if (below) return { team, sub: below.name }
      const rootId = cur.id
      const hasChildren = folders.some(f => f.parentId === rootId)
      return { team, sub: hasChildren ? null : team }
    }
    below = cur
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
  /** 회의 선택 없이도 프로젝트 지식에 귀속할 수 있다. meetingId가 있으면 같은 프로젝트여야 한다. */
  projectId?: string | null
  /** 반복 회의의 실제 개최일. 생략하면 연결된 회의록의 minuteDate를 사용한다. */
  meetingOccurrenceDate?: string | null
}

/** 회의록 입력 검증 — 에러 메시지 또는 null. create/updateMeta/replaceBody 가 공유. */
export function validateMinuteInput(
  input: MinuteInput,
  teamCodes: readonly TeamCode[] = TEAM_CODES,
): string | null {
  const title = input.title.trim()
  if (!title) return '제목을 입력하세요.'
  if (title.length > MINUTE_TITLE_MAX) return `제목은 ${MINUTE_TITLE_MAX}자 이하여야 합니다.`
  if (!DATE_RE.test(input.minuteDate)) return '날짜 형식이 올바르지 않습니다.'
  if (input.meetingOccurrenceDate && !DATE_RE.test(input.meetingOccurrenceDate))
    return '회의 개최일 형식이 올바르지 않습니다.'
  if (!teamCodes.includes(input.teamCode)) return '잘못된 담당입니다.'
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

/** 프로젝트 일괄 지정 1회 상한. 건별로 위키 재적재가 뒤따르는 조작이라 무제한으로 열지 않는다. */
export const MINUTES_PROJECT_BULK_MAX = 200

/** 폴더 이름 정규화 — trim + **NFC**. macOS 에서 만든 한글 폴더명은 NFD 로 들어올 수 있고,
 *  그대로 저장하면 눈에 같은 이름의 폴더가 둘 생긴다(부분 유니크 인덱스도 바이트가 달라
 *  막지 못한다). 저장·비교 경로 전부가 이 함수를 통과해야 한다. */
export function normalizeFolderName(name: string): string {
  return name.trim().normalize('NFC')
}

/** 폴더 이름 검증 — 에러 메시지 또는 null (validateMinuteInput 관례).
 *
 *  ⚠️ 반드시 `normalizeFolderName` 을 거친 값으로 재야 한다. 저장은 NFC 인데 검증만 원문
 *  길이를 재면 경계가 어긋난다 — macOS 에서 만든 한글 이름은 NFD 라 자모가 분해돼 길이가
 *  2~3배로 잡히고, 20자짜리 한글 폴더명이 "60자 초과"로 거절되면서 같은 이름을 외부 API 로
 *  보내면 통과한다(외부 API 는 NFC 후 검증한다). 계약 §4.9 의 "60자 검증도 NFC 이후 길이
 *  기준"을 UI 경로에서도 참으로 만든다. */
export function validateFolderName(name: string): string | null {
  const normalized = normalizeFolderName(name)
  if (!normalized) return '폴더 이름을 입력하세요.'
  if (normalized.length > MINUTE_FOLDER_NAME_MAX) return `폴더 이름은 ${MINUTE_FOLDER_NAME_MAX}자 이하여야 합니다.`
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

/** folderId 서브트리의 높이(자기 자신 포함 단 수). 잎이면 1.
 *  폴더 이동(M4) 판정에 필요하다 — `folderDepthOf(대상) + subtreeHeightOf(이동 폴더) ≤ 5`.
 *  folderDepthOf 만으로는 부족하다: 자손이 함께 내려가므로 3단 폴더를 3단 자리로 끌면 5단을
 *  넘는다. 순환·과깊이는 상한 초과 값으로 수렴시켜 호출부의 검증이 자연히 거부하게 한다. */
export function subtreeHeightOf(folders: MinuteFolder[], folderId: string): number {
  const childrenOf = new Map<string, string[]>()
  for (const f of folders) {
    if (f.parentId === null) continue
    const list = childrenOf.get(f.parentId)
    if (list) list.push(f.id)
    else childrenOf.set(f.parentId, [f.id])
  }
  const seen = new Set<string>()
  let height = 0
  let level = [folderId]
  while (level.length > 0) {
    height += 1
    if (height > MINUTE_FOLDER_DEPTH_MAX) return height   // 순환/과깊이 — 즉시 초과 반환
    const next: string[] = []
    for (const id of level) {
      if (seen.has(id)) continue
      seen.add(id)
      const kids = childrenOf.get(id)
      if (kids) next.push(...kids)
    }
    level = next
  }
  return height
}

/** candidateId 가 ancestorId 의 자손인가(자기 자신은 false). 조상 체인을 올라가며 순환 가드.
 *  M3(사이클 금지) — 폴더를 자기 자손 밑으로 옮기면 그 서브트리가 트리에서 통째로 끊긴다. */
export function isDescendantFolder(
  folders: MinuteFolder[], ancestorId: string, candidateId: string,
): boolean {
  const byId = new Map(folders.map(f => [f.id, f]))
  const seen = new Set<string>()
  let cur = byId.get(candidateId)?.parentId ?? null
  while (cur && !seen.has(cur)) {
    if (cur === ancestorId) return true
    seen.add(cur)
    cur = byId.get(cur)?.parentId ?? null
  }
  return false
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
