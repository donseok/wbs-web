'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  WBS_FONT_SCALE_DEFAULT,
  WBS_FONT_SCALES,
  WBS_FONT_SCALE_STORAGE_KEY,
  parseWbsFontScale,
  stepWbsFontScale,
  type WbsFontScale,
} from '@/lib/wbsFontScale'

function readStoredScale(): WbsFontScale | null {
  try {
    return parseWbsFontScale(localStorage.getItem(WBS_FONT_SCALE_STORAGE_KEY))
  } catch {
    return null
  }
}

function writeStoredScale(scale: WbsFontScale): void {
  try {
    localStorage.setItem(WBS_FONT_SCALE_STORAGE_KEY, String(scale))
  } catch {
    // 저장 차단은 화면 조절 자체를 막을 이유가 없으므로 현재 세션 상태만 유지한다.
  }
}

/** WBS 표 글자 크기 — SSR 첫 렌더는 100%, 마운트 후 같은 기기의 저장값을 복원한다. */
export function useWbsFontScale() {
  const [scale, setScaleState] = useState<WbsFontScale>(WBS_FONT_SCALE_DEFAULT)
  const hydrated = useRef(false)

  useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true
    const stored = readStoredScale()
    if (stored !== null) setScaleState(stored)
  }, [])

  // 저장 부수효과는 state updater 밖에서 수행해 StrictMode의 updater 재호출에도 한 번만 쓴다.
  const setScale = useCallback((next: WbsFontScale) => {
    if (scale === next) return
    setScaleState(next)
    writeStoredScale(next)
  }, [scale])

  return {
    scale,
    decrease: useCallback(
      () => setScale(stepWbsFontScale(scale, -1)),
      [scale, setScale],
    ),
    increase: useCallback(
      () => setScale(stepWbsFontScale(scale, 1)),
      [scale, setScale],
    ),
    reset: useCallback(() => setScale(WBS_FONT_SCALE_DEFAULT), [setScale]),
    canDecrease: scale > WBS_FONT_SCALES[0],
    canIncrease: scale < WBS_FONT_SCALES[WBS_FONT_SCALES.length - 1],
  }
}
