import type { MinutesPreset, TeamCode } from '@/lib/domain/types'

/**
 * system 프롬프트에 실을 문서 본문의 문자 상한.
 * 근거: 레포에 LLM 입력 토큰 상한이 어디에도 없다(llm.ts 는 maxOutputTokens:4096 만 고정).
 * util.ts 의 withTimeout(fn, 25_000) 25초가 사실상의 제약이다. 첫 배포에서 실측할 것.
 */
export const MINUTES_CTX_MAX_CHARS = 60_000

const HEAD_RATIO = 0.6

export interface MinutesMeta {
  title: string
  minutesDate: string
  teamCode: TeamCode
  projectName: string
}

/**
 * 상한 초과 시 머리 60% / 꼬리 40% 를 남기고 가운데를 잘라낸다.
 * 문자 기준(토큰 근사 불필요) — 이 함수는 순수하고 결정적이어야 테스트할 수 있다.
 */
export function truncateForContext(
  md: string,
  max = MINUTES_CTX_MAX_CHARS,
): { text: string; truncated: boolean } {
  if (md.length <= max) return { text: md, truncated: false }
  const head = Math.floor(max * HEAD_RATIO)
  const tail = max - head
  const omitted = md.length - max
  const marker = `\n\n…(중략: 원문 ${md.length}자 중 ${omitted}자 생략)…\n\n`
  const text = md.slice(0, head) + marker + md.slice(md.length - tail)
  // 마커까지 붙이고도 원문보다 길어지면 자를 이유가 없다. 없는 '생략 구간'을 모델에게 알리지 않는다.
  if (text.length >= md.length) return { text: md, truncated: false }
  return { text, truncated: true }
}

/** 문서 1개 전용 system 프롬프트. RAG 없음 — 이 문서 밖 지식은 금지한다. */
export function buildMinutesSystemPrompt(meta: MinutesMeta, contentMd: string, truncated: boolean): string {
  const excerpt = truncated
    ? '\n이 문서는 일부 구간이 생략된 발췌본이다. 생략 구간에 대한 질문에는 "원문에서 확인 필요"라고 답한다.'
    : ''
  return `너는 회의록 분석 도우미다. 아래 회의록 하나만 근거로 삼아 한국어로 답한다.
문서에 없는 내용은 추측하지 말고 "회의록에 없습니다"라고 답한다.
표로 정리하는 편이 명확하면 마크다운 표를 쓴다.${excerpt}

[회의록 메타]
- 프로젝트: ${meta.projectName}
- 팀: ${meta.teamCode}
- 회의일: ${meta.minutesDate}
- 제목: ${meta.title}

[회의록 본문]
${contentMd}`
}

const PRESETS: Record<MinutesPreset, string> = {
  summary: '이 회의록을 핵심 위주로 요약해 줘.',
  decisions: '이 회의에서 확정된 결정사항만 불릿으로 정리해 줘.',
  actions: '액션 아이템을 담당자·기한과 함께 표로 정리해 줘.',
  risks: '리스크와 이슈, 미해결 안건을 정리해 줘.',
}

/** 프리셋 키 집합. `v in PRESETS` 를 쓰면 'constructor'/'toString' 같은 프로토타입 키가 통과한다. */
const PRESET_KEYS: ReadonlySet<string> = new Set(Object.keys(PRESETS))

/** 프리셋 버튼 → 사용자 질문 문자열. */
export function presetPrompt(preset: MinutesPreset): string {
  return PRESETS[preset]
}

/** 라우트 입력 검증용 — 신뢰할 수 없는 문자열이 프리셋인지. 자체 키만 인정한다. */
export function isMinutesPreset(v: unknown): v is MinutesPreset {
  return typeof v === 'string' && PRESET_KEYS.has(v)
}
