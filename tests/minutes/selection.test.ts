import { describe, expect, it } from 'vitest'
import { fnv1a64, splitMinuteBlocks } from '@/lib/minutes/blocks'
import {
  MINUTE_SELECTION_MIN_CHARS,
  matchMinuteSelection,
  minuteSelectionKeyHash,
  normalizeSelectionText,
  stripSelectionWhitespace,
} from '@/lib/minutes/selection'

const BODY = [
  '# 주간회의',
  '',
  '첫 번째 문단은 인터페이스 전송 누락 위험을 다룬다.',
  '',
  '- [x] 재처리 여부 확인',
  '- 인터페이스 보완 방안 협의',
  '',
  '| 시스템 | 상태 |',
  '| --- | --- |',
  '| CRM | 지연 |',
].join('\n')
const blocks = splitMinuteBlocks(BODY)
// blocks: 0=heading, 1=paragraph, 2=list, 3=table

describe('normalizeSelectionText', () => {
  it('CRLF·줄 내 공백 압축·빈 줄 제거로 정규화한다', () => {
    expect(normalizeSelectionText('  가  나\r\n\r\n다  \n')).toBe('가 나\n다')
  })
  it('공백뿐인 선택은 빈 문자열이 된다', () => {
    expect(normalizeSelectionText(' \n\t ')).toBe('')
  })
})

describe('stripSelectionWhitespace / minuteSelectionKeyHash', () => {
  it('NBSP 포함 모든 공백을 제거한다', () => {
    expect(stripSelectionWhitespace('가 나 다\n라')).toBe('가나다라')
  })
  it('키 해시는 공백 제거 텍스트의 fnv1a64다', () => {
    expect(minuteSelectionKeyHash('가 나\n다')).toBe(fnv1a64('가나다'))
  })
})

describe('matchMinuteSelection', () => {
  it('단일 블록 안 부분 선택을 인정하고 정규화 발췌를 돌려준다', () => {
    const res = matchMinuteSelection(
      blocks, 1, blocks[1].hash, 1, blocks[1].hash, '전송 누락  위험을 다룬다',
    )
    expect(res).toEqual({ ok: true, excerpt: '전송 누락 위험을 다룬다' })
  })
  it('여러 블록에 걸친 선택(문단→목록)을 인정한다', () => {
    const raw = '누락 위험을 다룬다.\n재처리 여부 확인'
    const res = matchMinuteSelection(blocks, 1, blocks[1].hash, 2, blocks[2].hash, raw)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.excerpt).toBe('누락 위험을 다룬다.\n재처리 여부 확인')
  })
  it('표 셀을 가로지르는 선택(탭·개행 차이)을 공백 제거 대조로 흡수한다', () => {
    const res = matchMinuteSelection(blocks, 3, blocks[3].hash, 3, blocks[3].hash, 'CRM\t지연')
    expect(res.ok).toBe(true)
  })
  it('원문에 없는 텍스트는 text 사유로 거절한다', () => {
    const res = matchMinuteSelection(blocks, 1, blocks[1].hash, 1, blocks[1].hash, '존재하지 않는 문장')
    expect(res).toEqual({ ok: false, reason: 'text' })
  })
  it('시작 블록 안에서 끝나는 선택이 끝 블록을 부풀려 주장하면 거절한다', () => {
    // '전송 누락 위험' 은 블록 1 안에서 끝난다 — endIndex=2 주장에서 끝 블록에 걸치지 않음
    const res = matchMinuteSelection(blocks, 1, blocks[1].hash, 2, blocks[2].hash, '전송 누락 위험')
    expect(res).toEqual({ ok: false, reason: 'text' })
  })
  it('블록 해시 불일치·범위 역전·비존재 블록은 anchor 사유로 거절한다', () => {
    expect(matchMinuteSelection(blocks, 1, 'f'.repeat(16), 1, blocks[1].hash, '위험을 다룬다').ok).toBe(false)
    expect(matchMinuteSelection(blocks, 2, blocks[2].hash, 1, blocks[1].hash, '위험을 다룬다').ok).toBe(false)
    expect(matchMinuteSelection(blocks, 99, blocks[1].hash, 99, blocks[1].hash, '위험을 다룬다').ok).toBe(false)
  })
  it('공백뿐인 선택은 empty 사유로 거절한다', () => {
    const res = matchMinuteSelection(blocks, 1, blocks[1].hash, 1, blocks[1].hash, ' \n ')
    expect(res).toEqual({ ok: false, reason: 'empty' })
  })
  it('같은 문구가 반복돼도 시작·끝 블록에 걸치는 매치를 찾는다', () => {
    const dupBody = '확인 필요.\n\n확인 필요. 추가 조치가 있다.'
    const dup = splitMinuteBlocks(dupBody)
    const res = matchMinuteSelection(dup, 1, dup[1].hash, 1, dup[1].hash, '확인 필요. 추가')
    expect(res.ok).toBe(true)
  })
  it('두 블록에 걸친다고 주장하지만 한 블록 분량뿐인 반복 문구는 거절한다', () => {
    const dupBody = '확인 필요.\n\n확인 필요. 추가 조치가 있다.'
    const dup = splitMinuteBlocks(dupBody)
    const res = matchMinuteSelection(dup, 0, dup[0].hash, 1, dup[1].hash, '확인 필요.')
    expect(res).toEqual({ ok: false, reason: 'text' })
  })
  it('MINUTE_SELECTION_MIN_CHARS 상수를 노출한다(버블 게이트 공유)', () => {
    expect(MINUTE_SELECTION_MIN_CHARS).toBe(5)
  })
})
