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

  // 키워드 검색 질문("지연 단어가 들어간 항목 검색해줘")은 '지연' 같은 의도어가 섞여 있어도
  // 문자열 검색이 본뜻 — 구조화 의도가 가로채기 전에 freeform(키워드 정확 일치 경로)으로 보낸다.
  if (extractSearchKeywords(t).length) return 'freeform'

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

// 패턴 추출("wbs 검색해줘", "어떤 단어가 들어간") 키워드로 쓰기엔 무의미한 일반어.
// 따옴표로 명시 인용한 키워드에는 적용하지 않는다 — 'WBS' 검색은 유효한 요청.
const KEYWORD_STOPWORDS = new Set([
  'wbs', '작업', '항목', '프로젝트', '전체', '단어', '검색', '이름',
  '어떤', '무슨', '해당', '그', '이', '저', '관련',
])

// 키워드 검색 의도 신호. 이 신호가 없으면 추출 자체를 하지 않는다 — 특히 따옴표 인용은
// 변경/생성/일반 대화("담당자를 '김철수'로 변경해줘")에도 흔해서, 게이트 없이 뽑으면
// 무관한 질문이 [키워드 정확 일치] 경로에 갇혀 동문서답을 하게 된다.
const SEARCH_CUE = /들어간|들어가|포함|검색|찾|조회|(?:단어|글자|키워드|문구|용어)\s*(?:가|이|은|는|을|를)?\s*있는/

/**
 * "특정 문자열이 들어간 항목" 류의 키워드 검색 질문에서 검색어를 추출한다(순수 함수).
 * 임베딩 의미검색은 정확 문자열 일치("tft 가 들어간")에 약하므로, 여기서 뽑은 키워드로
 * 팩트시트를 직접 필터해 정확·완전한 목록을 근거([키워드 정확 일치])로 제공한다.
 * 매칭 패턴(SEARCH_CUE 게이트 통과 시에만):
 *  1) 따옴표 인용 — 스마트/괄호형(‘’ “” 「」 『』)은 여닫이가 달라 그대로 짝짓고,
 *     ASCII('/")는 어포스트로피(D'Flow, John's)와 구분하기 위해 공백/문두 뒤에서
 *     같은 종류의 따옴표 짝만 인정한다
 *  2) X (이)라는? 단어/글자/키워드/문구/용어 + 조사? + 들어간/포함/있는
 *  3) 명사 수식어 없이: ASCII 토큰 + 들어간/포함된/포함한 ("tft 들어간 항목") — 한국어
 *     일반 단어("일정이 포함된")의 오탐을 피하려고 영숫자 시작 토큰으로 한정
 *  4) ASCII 토큰 + (으로)? 검색 ("tft로 검색해줘")
 * 반환: 소문자 정규화, 중복 제거. 패턴 추출분만 '~(이)란/라는' 어미 제거 + 불용어 필터.
 * 검색 질문이 아니면 빈 배열.
 */
export function extractSearchKeywords(raw: string): string[] {
  const t = raw.trim()
  if (!SEARCH_CUE.test(t)) return []

  const quoted: string[] = []
  const found: string[] = []
  for (const m of t.matchAll(/[‘“「『]([^’”」』]{1,30})[’”」』]/g)) quoted.push(m[1])
  for (const m of t.matchAll(/(?<=^|\s)(['"])([^'"]{1,30})\1/g)) quoted.push(m[2])
  for (const m of t.matchAll(
    /([A-Za-z0-9가-힣/+.&_-]{1,20})\s*(?:이라는|라는)?\s*(?:단어|글자|키워드|문구|용어)\s*(?:가|이|은|는|을|를|도|만)?\s*(?:들어간|들어가|포함|있는)/g,
  ))
    found.push(m[1])
  for (const m of t.matchAll(
    /([A-Za-z0-9][A-Za-z0-9/+._&-]{1,19})\s*(?:가|이|은|는|을|를|도|만)?\s*(?:들어간|들어가는|포함된|포함한|포함하는)/g,
  ))
    found.push(m[1])
  for (const m of t.matchAll(/([A-Za-z0-9][A-Za-z0-9/+._&-]{1,19})\s*(?:로|으로)?\s*검색/g)) found.push(m[1])

  const seen = new Set<string>()
  const out: string[] = []
  const push = (k: string, fromQuote: boolean): void => {
    let norm = k.trim().toLowerCase()
    // 인용문은 문자 그대로 존중, 패턴 추출분만 붙어 나온 어미('설계란', '품질이라는')를 벗긴다
    if (!fromQuote) norm = norm.replace(/(?:이라는|라는|이란|란)$/, '')
    if (!norm || norm.length < 2 || seen.has(norm)) return
    if (!fromQuote && KEYWORD_STOPWORDS.has(norm)) return
    seen.add(norm)
    out.push(norm)
  }
  for (const k of quoted) push(k, true)
  for (const k of found) push(k, false)
  return out
}

/** 전사(전체 프로젝트) 스코프 의도인가. */
export function isCrossProject(intent: ChatIntent): boolean {
  return intent === 'overview'
}
