/** 프로파일 기반 익스포트(Plan B §6.5, Task 7 + 리뷰 픽스). */

import * as XLSX from 'xlsx'
import type { ComputedItem } from '@/lib/domain/types'
import type { ExcelProfile } from '@/lib/excel/profile'
import { resolveLegacyLevelLabels } from '@/lib/excel/parseWithProfile'

const STATUS_LABEL: Record<ComputedItem['status'], string> = {
  not_started: '시작전', in_progress: '진행중', delayed: '지연', done: '완료',
}

// export.ts 의 isoToDate 와 동일(중복 — export.ts 무접촉 원칙이라 공유하지 않는다).
function isoToDate(iso: string | null): Date | '' {
  if (!iso) return ''
  return new Date(iso + 'T00:00:00Z')
}

const LEGACY_LEVEL_LABELS = ['Phase', 'Task', 'Activity'] as const

/** 계층 열 라벨 — 3열(columns) 프로파일은 레거시 이름을 쓰고, 그 외(N열/outline)는 일반 라벨.
 *  resolveLegacyLevelLabels 와 동일한 판정을 재사용(§ 라운드트립 규약의 단일 출처). */
function hierarchyLabel(profile: ExcelProfile, depth: number): string {
  if (resolveLegacyLevelLabels(profile)) return LEGACY_LEVEL_LABELS[depth] ?? 'Activity'
  return `Level${depth + 1}`
}

/** 트리를 (항목, 깊이) 페어로 평탄화. sub-act(isOwnerSplit) 자식 여부로만 판단한다 — level 문자열은
 *  N단 프로파일에서 전부 'activity'로 뭉개져 있어(parseWithProfile.linkByDepth) 판별 근거가 될 수 없다
 *  (스펙 §5.2 와 동일 원칙을 익스포트에도 적용).
 *  - expandSubActs=false: sub-act 자식은 숨긴다(부모 행이 대표 — export.ts flatten 과 동일 결과).
 *  - expandSubActs=true : sub-act 자식도 깊이+1 로 펼쳐 낸다.
 *  한 항목의 자식은 전부 isOwnerSplit 이거나 전부 아니다(splitLeafOwners 가 리프만 분리하므로 섞이지
 *  않는다) — 그래서 children[0] 하나만 봐도 충분하다. */
function flattenWithDepth(items: ComputedItem[], expandSubActs: boolean): { item: ComputedItem; depth: number }[] {
  const out: { item: ComputedItem; depth: number }[] = []
  const walk = (ns: ComputedItem[], depth: number) => {
    for (const n of ns) {
      out.push({ item: n, depth })
      const childrenAreSubActs = n.children.length > 0 && n.children[0].isOwnerSplit
      if (childrenAreSubActs && !expandSubActs) continue // 접기 — 숨김
      walk(n.children, depth + 1)
    }
  }
  walk(items, 0)
  return out
}

/** 트리 전체에서 등장하는 팀 코드를 최초 등장 순으로 수집(export.ts resolveTeamColumns 와 동일 의미 —
 *  collapse/expand 무관하게 항상 전체 트리를 본다. 접힌 sub-act 의 담당도 열 후보에 포함되던 기존
 *  동작을 그대로 계승한다). */
function collectTeams(items: ComputedItem[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const walk = (ns: ComputedItem[]) => ns.forEach(n => {
    for (const o of n.owners) if (!seen.has(o.team)) { seen.add(o.team); out.push(o.team) }
    walk(n.children)
  })
  walk(items)
  return out
}

/** WBS 시트의 AOA(행 배열) 생성 — 프로파일이 열 배치를 결정한다(§6.5).
 *  expandSubActs=false 면 기존 buildWbsAoa 의 flatten 접기와 셀 단위로 동일(라운드트립 계약 (a),
 *  시프트가 전혀 없다). expandSubActs=true 면 sub-act 를 계층 열 하나를 "삽입"해 실제 행으로 펼친다.
 *
 *  ── 삽입-시프트 설계(리뷰 픽스, Important #1) ──
 *  최초 구현은 sub-act 를 "마지막 계층 열 + 1" 의 *기존* 위치에 얹었는데, 이건 LEGACY_DCUBE_PROFILE
 *  이 우연히 그 자리를 빈 여백 열로 남겨뒀을 때만 안전했다. 계층 열 바로 다음에 다른 논리 열이 선언된
 *  프로파일(예: hierarchy=[0,1,2], deliverable=3)에서는 sub-act 이름과 산출물 값이 같은 물리 열을
 *  다퉈 — 재감지(detectWorkbook) 시 그 열이 "산출물"인지 "4단 계층 이름"인지 모호해지고, 실제로는
 *  산출물 텍스트가 계층 이름으로 오파싱되는 무증상 손상이 난다.
 *  고쳐 넣은 설계는 배열 삽입(splice)과 동일한 의미다: `insertAt = 마지막 계층 열 + 1` 에 새 열을
 *  "끼워 넣고", `insertAt` 이상인 **모든** 선언 열(logical + teamColumns, 예외 없음)을 +1 만큼 뒤로
 *  민다. 어떤 프로파일이든 충돌이 구조적으로 불가능해지고(밀린 자리는 전부 비어 있던 자리이거나 같이
 *  밀린 다른 선언 열이라 겹칠 수 없다), 계층 열 자체(0..마지막 계층 열)는 항상 insertAt 미만이라
 *  시프트 대상이 아니므로 계층 열의 "연속 구간"이 안 끊긴다 — detectColumnHierarchy(Task3, 규칙3)가
 *  그 연속 구간을 그대로 4열 계층으로 재감지할 수 있다(테스트 (c)).
 *  접기(expandSubActs=false)는 insertAt 자체가 없다(null) → shift 가 항등 함수라 라운드트립 계약
 *  (a)에 전혀 영향이 없다. LEGACY_DCUBE_PROFILE 도 예외가 아니다 — 펼침 모드에선 팀 열(원래 6~10)도
 *  전부 +1 밀린다(insertAt=4 이상이라서). "우연히 안 겹치는 레거시"를 특별 취급하지 않고 모든
 *  프로파일에 같은 규칙을 균일하게 적용한 결과다.
 *
 *  ── 프로파일 밖 팀 동적 확장(리뷰 픽스, Important #2) ──
 *  트리에 등장하지만 profile.teamColumns 에 없는 팀은 조용히 유실시키지 않는다(export.ts
 *  resolveTeamColumns 와 동일 원칙, "조용한 유실 금지"). 시프트가 끝난 좌표계의 맨 끝(선언된 모든 열
 *  다음, 계산 전용 trailing 열보다는 앞)에 열을 추가한다 — collapse/expand 모두 적용.
 *
 *  ── outline 계층 + 펼침(리뷰 픽스, 항목 3) ──
 *  outline 코드 열은 "깊이 = 구분자 수"로 표현되는데, sub-act 는 코드 자릿수를 늘릴 데이터 근거가
 *  없다(splitLeafOwners 가 sub-act 에 부모와 동일한 code 를 승계 — 자릿수 합성은 별도 설계가
 *  필요한 일이라 이 태스크 범위 밖). 예전엔 이 조합에서도 조용히 (틀린 모양의) 결과를 냈는데, 그건
 *  무증상 왕복 오파싱을 낳는다 — 대신 명시적으로 실패를 반환한다. */
export function buildAoaWithProfile(
  items: ComputedItem[],
  profile: ExcelProfile,
  opts: { expandSubActs: boolean },
  projectName = 'WBS',
): { ok: true; aoa: unknown[][] } | { ok: false; error: string } {
  const { expandSubActs } = opts

  if (profile.hierarchy.kind === 'outline' && expandSubActs) {
    return { ok: false, error: '아웃라인 양식의 펼침 익스포트는 아직 지원되지 않습니다' }
  }

  const hierCols = profile.hierarchy.kind === 'columns' ? profile.hierarchy.columns : null
  const outlineCol = profile.hierarchy.kind === 'outline' ? profile.hierarchy.column : null
  // 삽입 지점 — columns 계층 + 펼침일 때만 존재. 계층 열은 전부 insertAt 미만이라 시프트되지 않는다.
  const insertAt = expandSubActs && hierCols ? hierCols[hierCols.length - 1] + 1 : null
  const shift = (c: number): number => (insertAt != null && c >= insertAt) ? c + 1 : c

  const markByKind = new Map<'primary' | 'support', string>()
  for (const [mark, kind] of Object.entries(profile.ownerMarks)) {
    if (!markByKind.has(kind)) markByKind.set(kind, mark)
  }

  // ── 프로파일 선언 열을 전부 시프트 좌표로 변환(접기 모드는 shift 가 항등이라 원본과 동일 값). ──
  const hierColsOut = hierCols ? hierCols.map(shift) : null // 실질적으로 항등(전부 insertAt 미만)
  const outlineColOut = outlineCol != null ? shift(outlineCol) : null
  const extraAxisCol = profile.logical.extraAxis != null ? shift(profile.logical.extraAxis) : null
  const codeCol = profile.logical.code != null ? shift(profile.logical.code) : null
  const nameCol = profile.logical.name != null ? shift(profile.logical.name) : null
  const deliverableCol = profile.logical.deliverable != null ? shift(profile.logical.deliverable) : null
  const startCol = profile.logical.start != null ? shift(profile.logical.start) : null
  const endCol = profile.logical.end != null ? shift(profile.logical.end) : null
  const weightCol = profile.logical.weight != null ? shift(profile.logical.weight) : null
  const actualPctCol = profile.logical.actualPct != null ? shift(profile.logical.actualPct) : null
  const declaredTeamCols: [number, string][] = profile.teamColumns.map(([c, label]) => [shift(c), label])

  const knownCols: number[] = [
    ...(hierColsOut ?? (outlineColOut != null ? [outlineColOut] : [])),
    ...(insertAt != null ? [insertAt] : []),
    ...[extraAxisCol, codeCol, nameCol, deliverableCol, startCol, endCol, weightCol, actualPctCol]
      .filter((c): c is number => c != null),
    ...declaredTeamCols.map(([c]) => c),
  ]
  const maxKnown = knownCols.length ? Math.max(...knownCols) : -1

  // 프로파일 밖 팀 — 시프트된 선언 열 다음(맨 끝)에 등장 순으로 추가. teamColumns=[[c,'*']] 방식은
  // 팀명을 셀 값으로 직접 적는 방식이라 "특정 팀 전용 열"이 아니므로 확장 후보에서 제외한다.
  const declaredTeamCodes = new Set(declaredTeamCols.map(([, label]) => label).filter(l => l !== '*'))
  const extraTeams = collectTeams(items).filter(t => !declaredTeamCodes.has(t))
  const extraTeamCols: [number, string][] = extraTeams.map((team, i) => [maxKnown + 1 + i, team])
  const teamCols = [...declaredTeamCols, ...extraTeamCols]

  const maxCol = maxKnown + extraTeams.length

  // ── 헤더 1행: 프로젝트명 ──
  const header1: unknown[] = [projectName]

  // ── 헤더 2행: 병합 타이틀(담당/산출물/계획) — 기존 buildWbsAoa 의 시각 관례를 그대로 재현.
  // 폭은 계층 열·팀 열·산출물/시작 위치 중 가장 오른쪽까지만(원본이 'end' 위치에서 멈추는 것과 동일). ──
  const header2Bound = Math.max(
    ...(hierColsOut ?? []),
    ...teamCols.map(([c]) => c),
    deliverableCol ?? -1,
    startCol ?? -1,
    endCol ?? -1,
    -1,
  )
  const header2 = new Array(header2Bound + 1).fill('')
  if (hierColsOut) hierColsOut.forEach((c, i) => { header2[c] = hierarchyLabel(profile, i) })
  if (teamCols.length > 0) header2[teamCols[0][0]] = '담당'
  if (deliverableCol != null) header2[deliverableCol] = '산출물'
  if (startCol != null) header2[startCol] = '계획'

  // ── 헤더 3행(profile.headerRow 위치, parseWithProfile 이 실제로 읽는 라벨 행) ──
  // trailing 라벨은 3개뿐이다(계획%/계획대비%/상태) — 데이터 행의 4개(+성과율)와 폭이 다른 기존
  // buildWbsAoa 의 결함을 그대로 재현한다(무접촉 원칙 + 바이트 불변 회귀 기준 때문에 여기서 고치지
  // 않는다 — 계약 (a) 참조).
  const header3 = new Array(maxCol + 4).fill('')
  if (hierColsOut) hierColsOut.forEach((c, i) => { header3[c] = hierarchyLabel(profile, i) })
  else if (outlineColOut != null) header3[outlineColOut] = '코드'
  if (extraAxisCol != null) header3[extraAxisCol] = 'Biz'
  if (codeCol != null) header3[codeCol] = '코드'
  if (nameCol != null) header3[nameCol] = '이름'
  teamCols.forEach(([c, label]) => { header3[c] = label })
  if (deliverableCol != null) header3[deliverableCol] = '산출물'
  if (startCol != null) header3[startCol] = '시작'
  if (endCol != null) header3[endCol] = '종료'
  if (weightCol != null) header3[weightCol] = '가중치'
  if (actualPctCol != null) header3[actualPctCol] = '실적%'
  if (insertAt != null) header3[insertAt] = '세부업무' // 펼침 전용 — 접기 모드는 insertAt 자체가 null
  header3[maxCol + 1] = '계획%'
  header3[maxCol + 2] = '계획대비%'
  header3[maxCol + 3] = '상태'

  const rows: unknown[][] = [header1, header2, header3]

  for (const { item, depth } of flattenWithDepth(items, expandSubActs)) {
    const row = new Array(maxCol + 5).fill('')

    if (extraAxisCol != null) row[extraAxisCol] = item.biz ?? ''
    if (codeCol != null) row[codeCol] = item.code ?? ''

    if (hierColsOut) {
      if (depth < hierColsOut.length) row[hierColsOut[depth]] = item.name
      else if (insertAt != null) row[insertAt] = item.name // depth === hierCols.length(sub-act, 펼침 전용)
    } else if (outlineColOut != null) {
      row[outlineColOut] = item.code ?? ''
      if (nameCol != null) row[nameCol] = item.name
    }

    for (const [col, label] of teamCols) {
      if (label === '*') {
        // 팀명 직접 방식(콤마 분리) — detect.ts 규칙 6 대안 방식의 역변환.
        const teams = item.owners.map(o => o.team)
        if (teams.length > 0) row[col] = teams.join(',')
      } else {
        const owner = item.owners.find(o => o.team === label)
        if (owner) row[col] = markByKind.get(owner.kind) ?? (owner.kind === 'primary' ? '●' : '△')
      }
    }

    if (deliverableCol != null) row[deliverableCol] = item.deliverable ?? ''
    if (startCol != null) row[startCol] = isoToDate(item.plannedStart)
    if (endCol != null) row[endCol] = isoToDate(item.plannedEnd)
    if (weightCol != null) row[weightCol] = item.weight ?? ''
    if (actualPctCol != null) {
      const childrenAreSubActs = item.children.length > 0 && item.children[0].isOwnerSplit
      row[actualPctCol] =
        item.children.length === 0
          ? (item.actualPct ?? '')
          : (!expandSubActs && childrenAreSubActs)
            ? Math.round(item.rolledActualPct) // 접기 모드에서 sub-act 를 대표하는 롤업값(export.ts 와 동일 규약)
            : ''
    }

    // 읽기용 계산 컬럼 — 모든 행에 무조건(리프/상위/sub-act 구분 없이) 싣는다. export.ts 와 동일 규약.
    row[maxCol + 1] = Math.round(item.plannedPct)
    row[maxCol + 2] = Math.round(item.rolledActualPct)
    row[maxCol + 3] = item.achievement == null ? '' : item.achievement
    row[maxCol + 4] = STATUS_LABEL[item.status]

    rows.push(row)
  }

  return { ok: true, aoa: rows }
}

/** WBS + Holiday 시트를 가진 xlsx ArrayBuffer 생성 — buildWbsWorkbook(export.ts)의 프로파일 버전.
 *  시트명은 profile.sheetName/profile.holidaySheetName 을 그대로 쓴다(재임포트 시 프로파일이 찾는
 *  이름과 일치해야 하므로). holidaySheetName 이 null 이면 Holiday 시트를 만들지 않는다.
 *  buildAoaWithProfile 이 실패(outline+펼침)하면 그대로 전파한다. */
export function buildWorkbookWithProfile(
  items: ComputedItem[],
  profile: ExcelProfile,
  holidays: { date: string; name: string }[],
  opts: { expandSubActs: boolean },
  projectName = 'WBS',
): { ok: true; buffer: ArrayBuffer } | { ok: false; error: string } {
  const built = buildAoaWithProfile(items, profile, opts, projectName)
  if (!built.ok) return built

  const wb = XLSX.utils.book_new()
  const wbsSheet = XLSX.utils.aoa_to_sheet(built.aoa, { cellDates: true })
  XLSX.utils.book_append_sheet(wb, wbsSheet, profile.sheetName)

  if (profile.holidaySheetName) {
    const holAoa: unknown[][] = [['날짜', '명칭'], ...holidays.map(h => [isoToDate(h.date), h.name])]
    const holSheet = XLSX.utils.aoa_to_sheet(holAoa, { cellDates: true })
    XLSX.utils.book_append_sheet(wb, holSheet, profile.holidaySheetName)
  }

  return { ok: true, buffer: XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer }
}
