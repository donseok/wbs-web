/** WBS 항목에 적용 가능한 쓰기 명령 액션 */
export type CommandAction = 'set_actual' | 'set_dates' | 'complete'

/** 사용자 발화에서 파싱한 명령 정보 */
export interface ParsedCommand {
  /** 적용할 액션 */
  action: CommandAction
  /** 사용자가 말한 대상 표현 (WBS 검색 쿼리) */
  targetQuery: string
  /** set_actual 전용: 실적 퍼센티지 (0~100) */
  actualPct?: number
  /** set_dates 전용: 계획 시작일 (YYYY-MM-DD 형식 또는 null) */
  plannedStart?: string | null
  /** set_dates 전용: 계획 종료일 (YYYY-MM-DD 형식 또는 null) */
  plannedEnd?: string | null
}

/** 명령 대상으로 후보된 WBS 항목 */
export interface CommandCandidate {
  /** WBS 항목 고유 ID */
  id: string
  /** 항목명 */
  name: string
  /** 상위 페이즈명 */
  phaseName: string
  /** 담당자 텍스트 표현 */
  ownersText: string
  /** 원시 actualPct 값 (낙관적 잠금용) */
  currentActual: number | null
  /** 표시용 실적 (Math.round 적용값) */
  displayActual: number
  /** 계획 시작일 (YYYY-MM-DD 또는 null) */
  plannedStart: string | null
  /** 계획 종료일 (YYYY-MM-DD 또는 null) */
  plannedEnd: string | null
}

/** 명령 파싱 후 생성되는 제안 또는 오류 결과 */
export type CommandProposal =
  | {
      /** 적용 가능한 제안 */
      kind: 'proposal'
      /** 적용할 액션 */
      action: CommandAction
      /** 대상 WBS 항목 */
      target: CommandCandidate
      /** 서버 액션에 전달할 원시 값 (표시 문자열 역파싱 금지) */
      params: {
        actualPct?: number
        plannedStart?: string | null
        plannedEnd?: string | null
      }
      /** 각 필드별 변경 사항 (이전값/이후값/라벨) */
      changes: {
        field: 'actual_pct' | 'planned_start' | 'planned_end'
        label: string
        before: string
        after: string
      }[]
    }
  | {
      /** 대상이 모호한 경우: 여러 후보 제시 */
      kind: 'disambiguate'
      targetQuery: string
      candidates: CommandCandidate[]
    }
  | {
      /** 대상이 존재하지 않음 */
      kind: 'not_found'
      targetQuery: string
    }
  | {
      /** 명령이 아닌 일반 질문/조회 */
      kind: 'not_command'
    }
  | {
      /** 파싱 중 발생한 오류 */
      kind: 'error'
      message: string
    }
