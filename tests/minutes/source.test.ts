import { describe, expect, it } from 'vitest'
import { fnv1a64, splitMinuteBlocks } from '@/lib/minutes/blocks'
import {
  minuteSourceHref, parseMinuteSourceAnchor, resolveMinuteSourceBlock,
} from '@/lib/minutes/source'

const bodyMd = '# 제목\n\n첫 문단\n\n둘째 문단'
const blocks = splitMinuteBlocks(bodyMd)
const bodyHash = fnv1a64(bodyMd)

describe('minute source deep link', () => {
  it('블록 인덱스와 해시를 URL에 보존한다', () => {
    expect(minuteSourceHref('m1', { blockIndex: 2, blockHash: blocks[2].hash, bodyHash }))
      .toBe(`/minutes/m1?block=2&hash=${blocks[2].hash}&body=${bodyHash}`)
  })

  it('정상 searchParams만 파싱한다', () => {
    expect(parseMinuteSourceAnchor({ block: '2', hash: blocks[2].hash, body: bodyHash }))
      .toEqual({ blockIndex: 2, blockHash: blocks[2].hash, bodyHash })
    expect(parseMinuteSourceAnchor({ block: '-1', hash: blocks[2].hash, body: bodyHash })).toBeNull()
    expect(parseMinuteSourceAnchor({ block: ['2', '3'], hash: blocks[2].hash, body: bodyHash })).toBeNull()
    expect(parseMinuteSourceAnchor({ block: '2', hash: 'not-a-hash', body: bodyHash })).toBeNull()
    expect(parseMinuteSourceAnchor({ block: '2', hash: blocks[2].hash, body: 'not-a-hash' })).toBeNull()
    expect(parseMinuteSourceAnchor({ block: '9007199254740992', hash: blocks[2].hash, body: bodyHash })).toBeNull()
  })

  it('본문·인덱스·블록 해시가 모두 맞는 원문 블록을 찾는다', () => {
    expect(resolveMinuteSourceBlock(blocks, bodyHash, {
      blockIndex: 2, blockHash: blocks[2].hash, bodyHash,
    })).toBe(2)
  })

  it('본문이 바뀌면 같은 원문 텍스트가 유일하게 남아도 추측 재매칭하지 않는다', () => {
    const moved = splitMinuteBlocks('# 새 제목\n\n설명\n\n첫 문단\n\n둘째 문단')
    expect(resolveMinuteSourceBlock(moved, fnv1a64('# 새 제목\n\n설명\n\n첫 문단\n\n둘째 문단'), {
      blockIndex: 2, blockHash: blocks[2].hash, bodyHash,
    })).toBeNull()
  })

  it('원문이 삭제됐거나 같은 내용이 중복되어 모호하면 점프하지 않는다', () => {
    const deletedMd = '# 제목\n\n첫 문단'
    const deleted = splitMinuteBlocks(deletedMd)
    expect(resolveMinuteSourceBlock(deleted, fnv1a64(deletedMd), {
      blockIndex: 2, blockHash: blocks[2].hash, bodyHash,
    })).toBeNull()

    const duplicatedMd = '# 새 제목\n\n둘째 문단\n\n설명\n\n둘째 문단'
    const duplicated = splitMinuteBlocks(duplicatedMd)
    expect(resolveMinuteSourceBlock(duplicated, fnv1a64(duplicatedMd), {
      blockIndex: 99, blockHash: blocks[2].hash, bodyHash,
    })).toBeNull()
  })
})
