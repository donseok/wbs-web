/**
 * 단계 코드·라벨 정본(스펙 2026-09-15 §3.2) — 한 벌만. fp 는 0096 에서 ip 로 이관돼 어휘에 없다.
 * ds(설계 중)는 0107, dd(설계 완료)는 0108 에서 들어왔다(설계 상태 스펙 D6) — 진행 중 단계(ds·ip) 뒤에 끝남·대기 단계(dd·im)가 짝을 이룬다.
 * i18n ko 사전(wbs.stage*)은 이 값과 같아야 한다(tests/domain/stage-labels.test.ts 가 고정).
 * 허브 표·대기 사유 문구처럼 i18n 을 쓰지 않는 서버 문구는 이 모듈을 쓴다.
 */
export const STAGE_CODES = ['as', 'ds', 'dd', 'ip', 'im', 'xx'] as const
export type StageCode = (typeof STAGE_CODES)[number]

/** 사람이 단계 선택(set_stage)·import 로 넣을 수 있는 단계 — dd 는 design_done·design_accept 로만 생긴다(스펙 7절). */
export const HUMAN_STAGE_CODES = ['as', 'ds', 'ip', 'im', 'xx'] as const
export type HumanStageCode = (typeof HUMAN_STAGE_CODES)[number]

export const STAGE_LABEL_KO: Readonly<Record<StageCode, string>> = {
  as: '할당됨', ds: '설계 중', dd: '설계 완료', ip: '작업 중', im: '검수 대기', xx: '완료',
}
export const STAGE_NONE_LABEL_KO = '미착수'

export function isStageCode(v: unknown): v is StageCode {
  return typeof v === 'string' && (STAGE_CODES as readonly string[]).includes(v)
}
export function isHumanStageCode(v: unknown): v is HumanStageCode {
  return typeof v === 'string' && (HUMAN_STAGE_CODES as readonly string[]).includes(v)
}

/** null → 미착수, 모르는 코드 → 코드 그대로(표시 = 로깅 — 감추면 "단계 없음"으로 위장한다). */
export function stageLabelKo(stage: string | null): string {
  if (stage === null) return STAGE_NONE_LABEL_KO
  return isStageCode(stage) ? STAGE_LABEL_KO[stage] : stage
}
