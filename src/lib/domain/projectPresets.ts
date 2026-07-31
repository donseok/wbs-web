/**
 * 프로젝트 생성 프리셋 (스펙 §8) — 생성 시 1회 project_settings 로 구체화되는 시드.
 * DB 에는 preset_applied 이름만 남고 런타임에 이 상수를 다시 읽는 코드는 없다.
 * 이름은 성격이 아니라 설정 내용을 말한다(§8.2-3).
 */
export interface ProjectPreset {
  /** 설정 화면에 보여줄 정직한 요약 — '3단 WBS · 분류축 사용' 형식 */
  summary: string
  levelLabels: string[]
  maxDepth: number | null
  extraAxisLabel: string | null
  /** 소문자만(§7.4 — isMilestoneLeaf 가 name.toLowerCase() 와 비교). 빈 배열 금지(카드 무증상 소실). */
  milestoneKeywords: string[]
}

export const PRESETS = {
  pi: {
    summary: '3단 WBS · 분류축(Biz) · PI 보고 어휘',
    levelLabels: ['Phase', 'Task', 'Activity'],
    maxDepth: 3,
    extraAxisLabel: 'Biz',
    milestoneKeywords: ['착수보고', '중간보고', '보고회', '마스터 플랜', 'bmt', '최종 선정', '승인', '준공', 'kick-off', '킥오프'],
  },
  swdev: {
    summary: '5단 WBS · 분류축 없음 · 개발 마일스톤 어휘',
    levelLabels: ['단계', '기능', '작업', '세부', '항목'],
    maxDepth: 5,
    extraAxisLabel: null,
    milestoneKeywords: ['킥오프', 'kick-off', '오픈', '릴리스', 'release', '검수', '이행', 'uat', '준공'],
  },
  blank: {
    summary: '깊이 무제한 · 최소 설정',
    levelLabels: ['1단', '2단', '3단'],
    maxDepth: null,
    extraAxisLabel: null,
    milestoneKeywords: ['마일스톤', 'milestone'],
  },
} as const satisfies Record<string, ProjectPreset>
