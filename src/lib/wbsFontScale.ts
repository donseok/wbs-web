export const WBS_FONT_SCALE_STORAGE_KEY = 'dflow-wbs-font-scale'
export const WBS_FONT_SCALES = [100, 115, 130] as const
export const WBS_FONT_SCALE_DEFAULT = 100

export type WbsFontScale = (typeof WBS_FONT_SCALES)[number]

export function parseWbsFontScale(value: unknown): WbsFontScale | null {
  const numberValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN
  return WBS_FONT_SCALES.find(scale => scale === numberValue) ?? null
}

export function stepWbsFontScale(current: WbsFontScale, direction: 1 | -1): WbsFontScale {
  const index = WBS_FONT_SCALES.indexOf(current)
  const nextIndex = Math.min(WBS_FONT_SCALES.length - 1, Math.max(0, index + direction))
  return WBS_FONT_SCALES[nextIndex]
}

function scaledPx(base: number, scale: WbsFontScale): string {
  return `${Number((base * scale / 100).toFixed(2))}px`
}

function cappedScaledPx(base: number, scale: WbsFontScale, maximum: number): string {
  return `${Number(Math.min(base * scale / 100, maximum).toFixed(2))}px`
}

/** 표 폭은 그대로 두고 텍스트 계층만 같은 비율로 확대하는 CSS 변수 묶음. */
export function wbsFontScaleVariables(scale: WbsFontScale): Record<string, string> {
  return {
    '--wbs-cell-font': scaledPx(12, scale),
    '--wbs-index-font': scaledPx(11, scale),
    '--wbs-head-font': scaledPx(10, scale),
    '--wbs-timeline-font': scaledPx(9.5, scale),
    '--wbs-day-font': scaledPx(9, scale),
    // 고정 폭 상태/구분 열은 내부 패딩까지 있어 상한이 없으면 라벨 자체가 사라진다.
    '--wbs-chip-font': cappedScaledPx(11, scale, 13),
    '--wbs-badge-font': cappedScaledPx(10, scale, 10.5),
    '--wbs-owner-font': scaledPx(10.5, scale),
    '--wbs-owner-mark-font': scaledPx(9, scale),
    '--wbs-bar-font': scaledPx(9, scale),
  }
}
