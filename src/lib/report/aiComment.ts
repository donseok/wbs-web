// ============================================================================
// AI 종합 코멘트 슬라이드 변환(순수) — 캐시된 주간 브리핑(project_ai_briefs kind='weekly')을
// 주간보고 PPT 마지막 슬라이드 1장으로 바꾼다. LLM 호출 없음(캐시 읽기 전용 경로).
// 좌셀 = 'AI 종합 코멘트'(헤드라인 + 진행 현황), 우셀 = '주요 리스크·제언'(리스크 + 권고 + 생성 정보).
// 줄 마커는 templateFill/subLineText 규칙: 무마커 → '    - ', '.' → 8칸 들여쓴 상세.
// ============================================================================

export interface ExtraSlideCell {
  title: string                                   // 행0 헤더 라벨(전주/금주 라벨 자리 대체)
  groups: { phase: string; items: string[] }[]    // 콘텐츠 셀 그룹(볼드 불릿 헤더 + 상세 줄)
}

export interface ExtraNarrativeSlide {
  left: ExtraSlideCell
  right: ExtraSlideCell
}

/** 섹션 제목 → 좌/우 셀 배치. 진행 현황=좌, 리스크·권고=우, 미분류=좌(정보 유실 금지). */
const isRightSection = (name: string) => /리스크|권고|제언/.test(name)

interface Section { name: string; items: string[] }

/** 브리핑 본문(마크다운)을 '## 섹션' 단위로 분해 — 불릿/일반 줄은 '.' 상세 마커로 통일. */
export function splitBriefSections(bodyMd: string): Section[] {
  const sections: Section[] = []
  let current: Section | null = null
  for (const rawLine of bodyMd.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const header = line.match(/^#{1,6}\s*(.+)$/)
    if (header) {
      current = { name: header[1].trim(), items: [] }
      sections.push(current)
      continue
    }
    const text = line.replace(/^[-*]\s+/, '')
    if (!current) { current = { name: '', items: [] }; sections.push(current) }
    current.items.push(`. ${text}`)
  }
  return sections.filter(s => s.name || s.items.length)
}

/**
 * 캐시된 브리핑 → PPT 추가 슬라이드 셀 구성. generatedAt 은 표시용 문자열(호출측 KST 포맷).
 * 헤드라인이 비어 있으면(수치 검증기가 제거한 경우 등) 좌셀 헤더는 '이번 주 요약'으로 폴백.
 */
export function briefToExtraSlide(
  brief: { headline: string; bodyMd: string }, generatedAt: string,
): ExtraNarrativeSlide {
  const sections = splitBriefSections(brief.bodyMd)
  const leftGroups: { phase: string; items: string[] }[] = []
  const rightGroups: { phase: string; items: string[] }[] = []
  const headlineGroup = { phase: brief.headline.trim() || '이번 주 요약', items: [] as string[] }
  leftGroups.push(headlineGroup)
  for (const s of sections) {
    if (!s.name) { headlineGroup.items.push(...s.items); continue } // 섹션 없는 서두 줄 → 헤드라인 하위
    if (isRightSection(s.name)) rightGroups.push({ phase: s.name, items: s.items })
    else leftGroups.push({ phase: s.name, items: s.items })
  }
  rightGroups.push({ phase: '생성 정보', items: [`. ${generatedAt} 생성 · 수치는 대시보드 기준`] })
  return {
    left: { title: 'AI 종합 코멘트', groups: leftGroups },
    right: { title: '주요 리스크·제언', groups: rightGroups },
  }
}
