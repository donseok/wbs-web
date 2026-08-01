import { describe, expect, it } from 'vitest'
import {
  readElementTransform,
  withElementTransform,
  withoutConnectorTargets,
} from '@/lib/report/issues/slideXml'

const SHAPE = [
  '<p:sp><p:nvSpPr><p:cNvPr id="108" name="사각형 1"/></p:nvSpPr>',
  '<p:spPr><a:xfrm><a:off x="2221139" y="3650411"/><a:ext cx="971550" cy="390144"/></a:xfrm></p:spPr>',
  '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>견적관리</a:t></a:r></a:p></p:txBody></p:sp>',
].join('')

const CONNECTOR = [
  '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="101" name="직선 연결선 5"/>',
  '<p:cNvCxnSpPr><a:stCxn id="102" idx="2"/><a:endCxn id="120" idx="0"/></p:cNvCxnSpPr></p:nvCxnSpPr>',
  '<p:spPr><a:xfrm><a:off x="2721005" y="3100573"/><a:ext cx="0" cy="2461491"/></a:xfrm></p:spPr></p:cxnSp>',
].join('')

describe('readElementTransform', () => {
  it('shape의 EMU 좌표를 그대로 읽는다', () => {
    expect(readElementTransform(SHAPE)).toEqual({
      x: 2_221_139, y: 3_650_411, cx: 971_550, cy: 390_144,
    })
  })

  it('좌표 구조가 없으면 throw한다', () => {
    expect(() => readElementTransform('<p:sp></p:sp>')).toThrow('좌표')
  })

  it('withElementTransform 왕복이 일치한다', () => {
    const moved = withElementTransform(SHAPE, { x: 10, y: 20, cx: 30, cy: 40 })
    expect(readElementTransform(moved)).toEqual({ x: 10, y: 20, cx: 30, cy: 40 })
  })
})

describe('withoutConnectorTargets', () => {
  it('삭제된 도형을 가리키는 stCxn/endCxn 참조를 제거한다', () => {
    const detached = withoutConnectorTargets(CONNECTOR)
    expect(detached).not.toContain('stCxn')
    expect(detached).not.toContain('endCxn')
    expect(detached).toContain('cNvCxnSpPr')
    expect(readElementTransform(detached).cy).toBe(2_461_491)
  })

  it('참조가 없는 커넥터는 그대로 둔다', () => {
    const plain = CONNECTOR.replace(/<a:stCxn[^>]*\/>|<a:endCxn[^>]*\/>/g, '')
    expect(withoutConnectorTargets(plain)).toBe(plain)
  })
})
