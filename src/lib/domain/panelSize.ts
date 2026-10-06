// 에이전트 보기 상세 카드·최근 화면 상자의 크기 조절 규칙(2026-10-06). 화면 코드와 분리한 순수 함수라 단위 시험으로 닫는다.
// 저장소(localStorage)는 막힌 환경이 흔하므로 읽기·쓰기를 모두 try/catch 로 감싸고, 실패하면 기본값으로 정상 표시한다.

/** 오른쪽 상세 카드 폭 기준. LEFT_BASIS·GAP 은 RosterBoard 왼쪽 열의 flex-basis(520px)와 gap-4(16px)와 같은 값이다. */
export const PANEL_WIDTH = {
  min: 280,
  default: 340,
  maxRatio: 0.6,
  step: 20,
  leftBasis: 520,
  gap: 16,
  storageKey: 'dflow.roster.detailWidth',
} as const

/** 최근 화면 상자 높이 기준. 기본 상한은 종전 max-h-80(320px)이다. */
export const SCREEN_HEIGHT = {
  min: 96,
  default: 320,
  maxRatio: 0.8,
  step: 24,
} as const

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/**
 * 카드 폭을 하한·상한 안으로 맞춘다. 상한은 화면 폭의 60% 와, 왼쪽 열이 한 줄에 남을 폭(보드 폭 − 536px) 중 작은 값이다
 * (그보다 넓히면 카드가 아래로 떨어진다). 상한이 하한보다 작아지면 하한이 이긴다.
 */
export function clampPanelWidth(width: number, viewportWidth: number, boardWidth: number | null): number {
  const byViewport = viewportWidth * PANEL_WIDTH.maxRatio
  const byBoard = boardWidth === null ? Infinity : boardWidth - PANEL_WIDTH.leftBasis - PANEL_WIDTH.gap
  const max = Math.max(PANEL_WIDTH.min, Math.floor(Math.min(byViewport, byBoard)))
  return Math.round(Math.min(max, Math.max(PANEL_WIDTH.min, width)))
}

/** 이 보드 폭에서 카드가 왼쪽 열 아래로 내려가는 배치인지. 내려간 배치에서는 손잡이를 숨긴다. */
export function isPanelStacked(boardWidth: number, panelWidth: number): boolean {
  return boardWidth < PANEL_WIDTH.leftBasis + PANEL_WIDTH.gap + panelWidth
}

/** 저장된 폭. 없거나 숫자가 아니면 null(= 기본 폭). */
export function readStoredPanelWidth(storage: StorageLike | null = defaultStorage()): number | null {
  try {
    const raw = storage?.getItem(PANEL_WIDTH.storageKey)
    if (raw == null) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

/** 폭을 저장한다. null 이면 저장값을 지워 기본 폭으로 되돌린다. 실패는 삼킨다. */
export function writeStoredPanelWidth(width: number | null, storage: StorageLike | null = defaultStorage()): void {
  try {
    if (width === null) storage?.removeItem(PANEL_WIDTH.storageKey)
    else storage?.setItem(PANEL_WIDTH.storageKey, String(width))
  } catch {
    // 저장소가 막힌 환경 — 이번 방문에서만 바뀐 폭을 쓴다.
  }
}

/** 최근 화면 상자 높이를 하한·상한(화면 높이의 80%) 안으로 맞춘다. */
export function clampScreenHeight(height: number, viewportHeight: number): number {
  const max = Math.max(SCREEN_HEIGHT.min, Math.floor(viewportHeight * SCREEN_HEIGHT.maxRatio))
  return Math.round(Math.min(max, Math.max(SCREEN_HEIGHT.min, height)))
}
