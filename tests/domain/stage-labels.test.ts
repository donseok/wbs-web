// 단계 라벨 정본(스펙 2026-09-15 §3.2) — 한 벌만. 허브·대기 사유 문구와 i18n 사전이 같은 값을 쓴다.
import { describe, expect, it } from 'vitest'
import {
  HUMAN_STAGE_CODES, STAGE_CODES, STAGE_LABEL_KO, STAGE_NONE_LABEL_KO, isHumanStageCode, isStageCode, stageLabelKo,
} from '@/lib/domain/stageLabels'
import { wbsKo } from '@/lib/i18n/dict/wbs'

describe('단계 라벨 정본 — 한 벌만', () => {
  it('코드는 as·ds·dd·ip·im·xx 여섯 — fp 없음, dd(설계 완료)는 ds 와 ip 사이(0108)', () => {
    expect([...STAGE_CODES]).toEqual(['as', 'ds', 'dd', 'ip', 'im', 'xx'])
    expect(isStageCode('dd')).toBe(true)
    expect(isStageCode('fp')).toBe(false)
    expect(isStageCode(null)).toBe(false)
  })
  it('i18n ko 사전과 같다', () => {
    expect(wbsKo['wbs.stageAs']).toBe(STAGE_LABEL_KO.as)
    expect(wbsKo['wbs.stageDs']).toBe(STAGE_LABEL_KO.ds)
    expect(wbsKo['wbs.stageDd']).toBe(STAGE_LABEL_KO.dd)
    expect(wbsKo['wbs.stageIp']).toBe(STAGE_LABEL_KO.ip)
    expect(wbsKo['wbs.stageIm']).toBe(STAGE_LABEL_KO.im)
    expect(wbsKo['wbs.stageXx']).toBe(STAGE_LABEL_KO.xx)
    expect(wbsKo['wbs.stageNoneOption']).toBe(STAGE_NONE_LABEL_KO)
  })
  it('사람이 고를 수 있는 단계에는 dd 가 없다 — dd 는 design_done·design_accept 로만 생긴다(스펙 7절)', () => {
    expect([...HUMAN_STAGE_CODES]).toEqual(['as', 'ds', 'ip', 'im', 'xx'])
    expect(isHumanStageCode('dd')).toBe(false)
    expect(isHumanStageCode('ds')).toBe(true)
    expect(stageLabelKo('dd')).toBe('설계 완료')
  })
  it('null 은 미착수, 모르는 코드는 코드 그대로(위장 금지)', () => {
    expect(stageLabelKo(null)).toBe('미착수')
    expect(stageLabelKo('zz')).toBe('zz')
    expect(stageLabelKo('im')).toBe('검수 대기')
    expect(stageLabelKo('ds')).toBe('설계 중')
  })
})

describe('i18n en 사전도 모든 단계 키를 가진다', () => {
  it('wbs.stageDs 는 Designing', async () => {
    const { wbsEn } = await import('@/lib/i18n/dict/wbs.en')
    expect(wbsEn['wbs.stageDs']).toBe('Designing')
    expect(wbsEn['wbs.stageDd']).toBe('Design done')
  })
})
