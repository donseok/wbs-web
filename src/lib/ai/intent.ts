// ============================================================================
// 한국어 의도 분류 (순수 함수). 빠른 질문 칩 + 흔한 자유 질문을 구조화 의도로 매핑.
// 매칭되지 않으면 'freeform' → 의미검색(pgvector) + LLM 으로 답한다.
// ============================================================================

export type ChatIntent =
  | 'overview' // 전체/전사 프로젝트 현황
  | 'delayed' // 지연된 작업
  | 'this_week' // 이번 주 작업
  | 'this_week_start' // 이번 주 시작 예정
  | 'by_team' // 담당(팀)별 업무
  | 'completed' // 완료된 작업
  | 'weekly_summary' // 주간 요약/보고
  | 'project_status' // 현재 프로젝트 현황/공정률
  | 'freeform' // 그 외 → 의미검색 + LLM

/** 패널에 노출되는 빠른 질문 칩 (이미지와 동일 순서). */
export const QUICK_SUGGESTIONS: readonly string[] = [
  '전체 프로젝트 현황 알려줘',
  '지연된 작업이 뭐야?',
  '이번 주 작업 알려줘',
  '멤버별 업무 정리해줘',
  '완료된 작업 목록 보여줘',
]

const has = (s: string, ...keys: string[]): boolean => keys.some(k => s.includes(k))

const WEEK_WORDS = ['이번 주', '이번주', '금주', '이주']

/** 전사(여러 프로젝트) 스코프 신호: '전사' 또는 (전체/모든/모두 + '프로젝트'). */
function isCrossProjectQuery(t: string): boolean {
  return has(t, '전사') || (has(t, '전체', '모든', '모두') && has(t, '프로젝트'))
}

/** 질문 문장 → 의도. 우선순위 순서대로 검사한다. */
export function classifyIntent(raw: string): ChatIntent {
  const t = raw.toLowerCase().trim()
  const hasWeek = has(t, ...WEEK_WORDS)

  // 1) 이번 주 "시작" 예정 — 주차어 + 시작
  if (hasWeek && has(t, '시작')) return 'this_week_start'

  // 2) 주간 요약/보고
  if (has(t, '주간 요약', '주간요약') || (has(t, '주간', '한 주', '한주') && has(t, '요약', '보고', '정리', '리포트', '리뷰')))
    return 'weekly_summary'

  // 3) 전사 현황 — '전체 프로젝트 …'는 완료/지연 키워드보다 우선(전사 스코프가 이김)
  if (isCrossProjectQuery(t)) return 'overview'

  // 4) 지연 (지체/밀림)
  if (has(t, '지연', '지체', '딜레이', '밀린', '밀려', '늦어', '늦은', '늦고', 'delay')) return 'delayed'

  // 5) 완료 — '미완료'는 제외
  if (!has(t, '미완료', '안 끝', '안끝', '안 완료') && has(t, '완료', '끝난', '끝낸', '마친', '마무리', 'done', '종료된'))
    return 'completed'

  // 6) 이번 주 작업
  if (hasWeek) return 'this_week'

  // 7) 담당(팀)/멤버별
  if (has(t, '멤버별', '담당자별', '담당별', '팀별', '인원별', '사람별', '분담', '워크로드', '업무 정리', '누가 무슨', '누가 뭐'))
    return 'by_team'

  // 8) 현재 프로젝트 현황/공정률
  if (has(t, '현황', '공정률', '공정율', '진척', '진행률', '진행 상황', '진행상황', '어디까지', '얼마나 됐', '상태'))
    return 'project_status'

  return 'freeform'
}

/** 의도가 의미검색(pgvector) 컨텍스트를 필요로 하는가. 구조화로 충분한 의도는 생략해 비용을 아낀다. */
export function needsSemantic(intent: ChatIntent): boolean {
  return intent === 'freeform'
}

/** 전사(전체 프로젝트) 스코프 의도인가. */
export function isCrossProject(intent: ChatIntent): boolean {
  return intent === 'overview'
}
