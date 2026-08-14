const STOP_WORDS = new Set([
  '현재', '프로젝트', '지식', '위키', 'wiki', '어떻게', '무엇', '뭐', '어떤', '대한',
  '관련', '알려줘', '알려주세요', '인가요', '있나요', '인가', '사항', '내용', '최근',
  '아직', '확정된', '남아있는', '남은', '우리', '핵심', '결정', '결정사항', '합의',
  '리스크', '위험', '액션', '조치', '질문', '미답', '열린', '해결되지', '않은',
  '변경', '바뀐', '업데이트',
  'what', 'which', 'are', 'is', 'the', 'a', 'an', 'our', 'project', 'wiki', 'knowledge',
  'key', 'current', 'confirmed', 'decision', 'decisions', 'agreement', 'agreements',
  'risk', 'risks', 'action', 'actions', 'task', 'tasks', 'question', 'questions',
  'open', 'unanswered', 'unresolved', 'remain', 'remaining', 'changed', 'change',
  'recent', 'recently', 'updated', 'updates', 'please', 'tell', 'show', 'me',
])

/** 자연어 원문 전체를 `%문장%`로 찾지 않고, 의미가 있을 법한 짧은 검색 단위만 만든다. */
export function wikiAskTokens(question: string): string[] {
  const normalized = question
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_-]+/gu, ' ')
    .trim()
  const out: string[] = []
  for (const raw of normalized.split(/\s+/)) {
    const token = raw.replace(/(?:은|는|이|가|을|를|의|에|로|으로|에서|와|과|인가요|나요|까요)$/u, '')
    if (token.length < 2 || token.length > 40 || STOP_WORDS.has(token.toLowerCase())) continue
    if (!out.some((item) => item.toLocaleLowerCase() === token.toLocaleLowerCase())) out.push(token)
    if (out.length >= 5) break
  }
  return out
}
