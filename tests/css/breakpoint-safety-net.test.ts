import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * globals.css 의 "반응형 display 안전망"(커밋 15e0eef)을 감시한다.
 *
 * 배경 — 이 안전망은 근본치료가 아니다:
 *   2026-07-27 사이드바·헤더 실종 회귀의 응급 대응으로 들어갔지만, 이후 조사에서
 *   커밋이 지목한 원인("브라우저가 @layer 안에서 base .hidden 을 반응형보다 우선")은
 *   빌드 산출물로 반증됐다. 픽스 전 CSS 에서도 .hidden 이 .lg:flex 보다 앞이고 같은
 *   레이어·같은 특이성이라 스펙대로면 반응형이 이긴다. Chrome 150 에서 픽스 이전
 *   CSS 를 그대로 로드해도 정상 렌더된다 — 재현이 안 된다.
 *
 *   그래서 안전망은 "검증되지 않은 메커니즘에 대한 검증되지 않은 대증요법"이다.
 *   당장 해가 없어서 남겨두지만, @layer 밖(unlayered)에 있다는 성질 때문에 앞으로
 *   추가되는 모든 레이어드 display 규칙을 무조건 이긴다. 이 테스트는 그 성질이
 *   조용한 버그로 바뀌는 순간을 잡는 것이 목적이다.
 */

const root = fileURLToPath(new URL('../..', import.meta.url))
const css = readFileSync(join(root, 'src/app/globals.css'), 'utf8')

const NET_MARKER = '반응형 display 안전망'
const netStart = css.indexOf(NET_MARKER)
const net = netStart === -1 ? '' : css.slice(netStart)

/** Tailwind v4 기본 브레이크포인트. 안전망이 리터럴로 하드코딩한 값과 같아야 한다. */
const TAILWIND_DEFAULTS: Record<string, string> = {
  sm: '40rem',
  md: '48rem',
  lg: '64rem',
  xl: '80rem',
  '2xl': '96rem',
}

function srcFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry)) out.push(full)
    }
  }
  walk(join(root, 'src'))
  return out
}

describe('반응형 display 안전망 (globals.css, unlayered)', () => {
  it('안전망 블록이 존재한다', () => {
    // 사라졌다면 의도적 제거일 수 있다. 그때는 이 테스트도 같이 지우고,
    // scripts/smoke-prod.mjs 의 안전망 사본 검사도 함께 조정할 것.
    expect(netStart, 'globals.css 에서 안전망 블록을 찾지 못했습니다').toBeGreaterThan(-1)
  })

  it('브레이크포인트 5개를 모두 하드코딩하고 있고 값이 Tailwind 기본값과 같다', () => {
    const found = [...net.matchAll(/@media \(min-width:\s*([\d.]+rem)\)/g)].map((m) => m[1])
    expect(found).toEqual(['40rem', '48rem', '64rem', '80rem', '96rem'])
  })

  it('@theme 에 커스텀 브레이크포인트가 생기면 안전망과 desync 된다 — 함께 고칠 것', () => {
    // unlayered 안전망은 Tailwind 출력을 무조건 이긴다. 따라서 --breakpoint-lg 를
    // 68rem 으로 바꾸면 Tailwind 는 68rem 에서, 안전망은 64rem 에서 토글되고
    // 안전망이 이겨서 전 화면 반응형이 틀린 폭에서 전환된다.
    const custom = [...css.matchAll(/--breakpoint-([a-z0-9]+)\s*:\s*([^;]+);/g)]
    for (const [, name, rawValue] of custom) {
      const value = rawValue.trim()
      expect(
        TAILWIND_DEFAULTS[name],
        `--breakpoint-${name} 이 새로 정의됐습니다. globals.css 의 안전망 @media 값도 함께 바꾸세요.`,
      ).toBe(value)
    }
  })

  it('각 브레이크포인트 블록이 같은 display 값 집합을 덮는다', () => {
    const blocks = net.split(/@media \(min-width:[^)]+\)\s*\{/).slice(1)
    expect(blocks.length).toBe(5)
    const sets = blocks.map((b) =>
      [...b.matchAll(/display:\s*([a-z-]+);/g)].map((m) => m[1]).sort().join(','),
    )
    // 한 블록에만 값이 빠져 있으면 그 폭에서만 조용히 다르게 동작한다.
    expect(new Set(sets).size, `블록별 display 값 집합이 다릅니다: ${JSON.stringify(sets)}`).toBe(1)
  })

  it('상태 변형 display 유틸이 도입되면 안전망이 조용히 이겨버린다 — 사용 금지', () => {
    // unlayered > 모든 named layer 이므로, `hidden lg:flex data-[state=open]:hidden` 같은
    // 조합에서 레이어 안의 data-[] 규칙이 레이어 밖 lg:flex 에 진다. CSS 에러가 아니라
    // 조용한 오작동이라 리뷰에서 놓치기 쉽다.
    const DISPLAY = 'hidden|flex|grid|block|inline|inline-flex|inline-block|table|contents|flow-root'
    const VARIANT = 'hover|focus|active|open|checked|disabled|visited|print|group-[a-z-]+|peer-[a-z-]+|aria-[a-z-]+|max-(?:sm|md|lg|xl|2xl)'
    const pattern = new RegExp(`\\b(?:${VARIANT}):(?:${DISPLAY})\\b|\\b(?:data|has)-\\[[^\\]]+\\]:(?:${DISPLAY})\\b`, 'g')

    const offenders: string[] = []
    for (const file of srcFiles()) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(pattern)) {
        const line = text.slice(0, m.index).split('\n').length
        offenders.push(`${file.replace(root, '')}:${line} — ${m[0]}`)
      }
    }
    expect(
      offenders,
      '레이어 밖 안전망이 이 규칙들을 무력화합니다. 안전망을 제거하거나 다른 방법으로 토글하세요.',
    ).toEqual([])
  })

  it('컨테이너 쿼리 display 와 반응형 display 를 한 요소에 같이 쓰지 않는다', () => {
    // 컨테이너 쿼리 규칙은 Tailwind 출력에서 모든 min-width 블록보다 뒤에 오지만,
    // 레이어 안에 있으므로 레이어 밖 안전망에 진다. 두 종류를 한 className 에
    // 섞는 순간 컨테이너 쿼리가 무시된다.
    // 현재 해당 요소: src/components/app/HeaderAnnouncementTicker.tsx:73
    const DISPLAY = 'hidden|flex|grid|block|inline|inline-flex|inline-block|table|contents'
    const container = new RegExp(`@\\[[^\\]]+\\]:(?:${DISPLAY})\\b`)
    const responsive = new RegExp(`\\b(?:sm|md|lg|xl|2xl):(?:${DISPLAY})\\b`)

    const offenders: string[] = []
    for (const file of srcFiles()) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/className=(?:\{`|["'`])([^`"'}]*)/g)) {
        const cls = m[1]
        if (container.test(cls) && responsive.test(cls)) {
          const line = text.slice(0, m.index).split('\n').length
          offenders.push(`${file.replace(root, '')}:${line}`)
        }
      }
    }
    expect(
      offenders,
      '컨테이너 쿼리 display 가 레이어 밖 안전망에 져서 동작하지 않습니다.',
    ).toEqual([])
  })
})
