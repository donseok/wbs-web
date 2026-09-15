// 단계 라벨 정본(스펙 2026-09-15 §3.2) — 한 벌만. 허브·대기 사유 문구와 i18n 사전이 같은 값을 쓴다.
import { describe, expect, it } from 'vitest'
import { STAGE_CODES, STAGE_LABEL_KO, STAGE_NONE_LABEL_KO, isStageCode, stageLabelKo } from '@/lib/domain/stageLabels'
import { wbsKo } from '@/lib/i18n/dict/wbs'

describe('단계 라벨 정본 — 한 벌만', () => {
  it('코드는 as·ip·im·xx 넷 — fp 없음', () => {
    expect([...STAGE_CODES]).toEqual(['as', 'ip', 'im', 'xx'])
    expect(isStageCode('fp')).toBe(false)
    expect(isStageCode('im')).toBe(true)
    expect(isStageCode(null)).toBe(false)
  })
  it('i18n ko 사전과 같다', () => {
    expect(wbsKo['wbs.stageAs']).toBe(STAGE_LABEL_KO.as)
    expect(wbsKo['wbs.stageIp']).toBe(STAGE_LABEL_KO.ip)
    expect(wbsKo['wbs.stageIm']).toBe(STAGE_LABEL_KO.im)
    expect(wbsKo['wbs.stageXx']).toBe(STAGE_LABEL_KO.xx)
    expect(wbsKo['wbs.stageNoneOption']).toBe(STAGE_NONE_LABEL_KO)
  })
  it('null 은 미착수, 모르는 코드는 코드 그대로(위장 금지)', () => {
    expect(stageLabelKo(null)).toBe('미착수')
    expect(stageLabelKo('zz')).toBe('zz')
    expect(stageLabelKo('im')).toBe('검수 대기')
  })
})
