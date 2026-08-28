import { stageAtLeast } from './agentWork'

/** satisfied=선행 도달, waiting=아직 미도달, unknown=external_ref 를 못 찾음. */
export type SpecLinkState = 'satisfied' | 'waiting' | 'unknown'

/** 선행 충족 판정에 필요한 최소 정보 — depends 원본 행 전체를 요구하지 않는다(순수·테스트 용이). */
export interface SpecLinkView {
  /** external_ref 해석 결과. 못 찾으면 null(fail-closed 트리거). */
  itemId: string | null
  /** WBS Task 단계('as'|'fp'|'ip'|'im'|'xx'). itemId 는 찾았지만 단계 미지정이면 null. */
  stage: string | null
}

export interface SpecReadiness {
  waitingCount: number
  unknownCount: number
  /** 대기·미상이 모두 0 일 때만 true(fail-closed). 선행이 0건이면 true. */
  ready: boolean
}

/**
 * 명세 depends 링크 하나의 충족 상태를 판정한다.
 *
 * - itemId 가 null(external_ref 해석 실패)이면 stage 와 무관하게 unknown — 모르면 시작 가능으로
 *   위장하지 않는다.
 * - "완료 도달" 여부는 stageAtLeast(stage, 'im')(src/lib/domain/agentWork.ts) 를 그대로 쓴다.
 *   같은 정본이 에이전트 claim 게이트(T15)에도 쓰이므로, 화면 표시와 게이트 판정이 어긋나지 않는다.
 *   (stageTransition.ts 의 REACHED_STAGES 도 같은 판정이지만 그 모듈은 AdminClient/notify 를
 *   물고 있어 클라이언트 컴포넌트에서 import 하면 supabase 서버 코드가 번들에 딸려온다 — 여기선
 *   supabase 를 모르는 agentWork.ts 쪽을 쓴다.)
 */
export function specLinkState(link: SpecLinkView): SpecLinkState {
  if (link.itemId === null) return 'unknown'
  return stageAtLeast(link.stage, 'im') ? 'satisfied' : 'waiting'
}

/**
 * 명세 depends 전체로 "지금 시작할 수 있는가"를 판정한다.
 * waiting·unknown 을 세고, 둘 다 0 일 때만 ready. 선행이 0건이면 ready true.
 */
export function specStartReadiness(links: readonly SpecLinkView[]): SpecReadiness {
  let waitingCount = 0
  let unknownCount = 0

  for (const link of links) {
    const state = specLinkState(link)
    if (state === 'waiting') waitingCount++
    else if (state === 'unknown') unknownCount++
  }

  return {
    waitingCount,
    unknownCount,
    ready: waitingCount === 0 && unknownCount === 0,
  }
}
