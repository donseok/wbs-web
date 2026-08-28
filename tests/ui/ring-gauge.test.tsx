import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RingGauge } from '@/components/dashboard/RingGauge'

const arcOf = (html: string) => html.match(/stroke-dasharray="([\d.]+) ([\d.]+)"/)

describe('RingGauge', () => {
  const size = 132, stroke = 12, c = 2 * Math.PI * ((size - stroke) / 2)

  it('50% 는 둘레의 절반만큼 호를 그리고, 래퍼가 접근성 이름을 갖는다(svg 는 숨김)', () => {
    const html = renderToStaticMarkup(<RingGauge pct={50} size={size} stroke={stroke} label="해결률 50%" />)
    const m = arcOf(html)!
    expect(Number(m[1])).toBeCloseTo(c / 2, 1)
    expect(Number(m[1]) + Number(m[2])).toBeCloseTo(c, 1)
    expect(html).toMatch(/<div[^>]*role="img" aria-label="해결률 50%"/)
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/)
    expect(html).toContain('-rotate-90')
  })

  it('null·0 은 트랙만 — 호 원(circle 2개째)이 없다', () => {
    for (const pct of [null, 0]) {
      const html = renderToStaticMarkup(<RingGauge pct={pct} size={34} stroke={5} label="x" />)
      expect((html.match(/<circle/g) ?? []).length).toBe(1)
    }
  })

  it('100 은 둘레 전체, 100 초과·음수는 클램프', () => {
    expect(Number(arcOf(renderToStaticMarkup(<RingGauge pct={100} size={size} stroke={stroke} label="x" />))![1])).toBeCloseTo(c, 1)
    expect(Number(arcOf(renderToStaticMarkup(<RingGauge pct={140} size={size} stroke={stroke} label="x" />))![1])).toBeCloseTo(c, 1)
    expect((renderToStaticMarkup(<RingGauge pct={-5} size={size} stroke={stroke} label="x" />).match(/<circle/g) ?? []).length).toBe(1)
  })

  it('극단값(5% 미만·95% 초과)은 각진 캡 — 둥근 캡이 호를 부풀리지 않게', () => {
    expect(renderToStaticMarkup(<RingGauge pct={2} size={34} stroke={5} label="x" />)).toContain('stroke-linecap="butt"')
    expect(renderToStaticMarkup(<RingGauge pct={98} size={34} stroke={5} label="x" />)).toContain('stroke-linecap="butt"')
    expect(renderToStaticMarkup(<RingGauge pct={50} size={34} stroke={5} label="x" />)).toContain('stroke-linecap="round"')
  })

  it('중앙 콘텐츠는 겹쳐 그려지되 낭독에서는 숨긴다(래퍼 라벨이 값을 나른다)', () => {
    const html = renderToStaticMarkup(<RingGauge pct={36} size={size} stroke={stroke} label="해결률 36%"><b>36%</b></RingGauge>)
    expect(html).toMatch(/<div class="absolute inset-0[^"]*" aria-hidden="true"><b>36%<\/b><\/div>/)
  })
})
