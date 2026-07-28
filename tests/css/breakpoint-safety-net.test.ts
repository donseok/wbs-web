import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * globals.css 의 "반응형 display 안전망"(커밋 15e0eef)과 소스 스캔 제외 목록을 감시한다.
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
const WIDTH_TO_PREFIX: Record<string, string> = Object.fromEntries(
  Object.entries(TAILWIND_DEFAULTS).map(([k, v]) => [v, k]),
)

const DISPLAY = 'hidden|flex|grid|block|inline|inline-flex|inline-block|table|contents|flow-root'

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

/** `className={...}` / `className="..."` 의 값을 중괄호 균형을 맞춰 통째로 뽑는다. */
function classNameValues(text: string): { value: string; line: number }[] {
  const out: { value: string; line: number }[] = []
  const re = /className\s*=\s*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    let i = m.index + m[0].length
    const line = text.slice(0, m.index).split('\n').length
    const open = text[i]
    if (open === '"' || open === "'" || open === '`') {
      const end = text.indexOf(open, i + 1)
      if (end === -1) continue
      out.push({ value: text.slice(i + 1, end), line })
      i = end
    } else if (open === '{') {
      // `${}` 보간과 중첩 호출을 포함해 짝이 맞는 `}` 까지 전부 가져온다.
      let depth = 0
      const start = i
      for (; i < text.length; i++) {
        if (text[i] === '{') depth++
        else if (text[i] === '}') {
          depth--
          if (depth === 0) break
        }
      }
      out.push({ value: text.slice(start + 1, i), line })
    }
    re.lastIndex = Math.max(re.lastIndex, i)
  }
  return out
}

describe('반응형 display 안전망 (globals.css, unlayered)', () => {
  it('안전망 블록이 존재한다', () => {
    // 사라졌다면 의도적 제거일 수 있다. 그때는 이 테스트도 같이 지우고,
    // scripts/smoke-prod.mjs 의 안전망 사본·꼬리 검사도 함께 조정할 것.
    expect(netStart, 'globals.css 에서 안전망 블록을 찾지 못했습니다').toBeGreaterThan(-1)
  })

  it('브레이크포인트 5개를 모두 하드코딩하고 있고 값이 Tailwind 기본값과 같다', () => {
    const found = [...net.matchAll(/@media \(min-width:\s*([\d.]+rem)\)/g)].map((m) => m[1])
    expect(found).toEqual(['40rem', '48rem', '64rem', '80rem', '96rem'])
  })

  it('각 @media 블록 안의 클래스 접두어가 그 브레이크포인트와 일치한다', () => {
    // 거의 같은 블록 5개를 손으로 늘어놓은 구조라 복붙 실수가 가장 개연성 높은 결함이다.
    // 64rem 블록에 `.sm\:*` 를 잘못 붙여넣으면 (1) lg:flex 가 구제를 잃고
    // (2) .sm\:flex 가 레이어 밖에서 ≥64rem 전 구간에 강제 적용돼 조용히 깨진다.
    const blocks = [...net.matchAll(/@media \(min-width:\s*([\d.]+rem)\)\s*\{([\s\S]*?)\n\}/g)]
    expect(blocks.length, '안전망 @media 블록 5개를 파싱하지 못했습니다').toBe(5)

    const mismatches: string[] = []
    for (const [, width, body] of blocks) {
      const expected = WIDTH_TO_PREFIX[width]
      // `.sm\:flex` 또는 2xl 이스케이프 `.\32 xl\:flex`
      const prefixes = new Set(
        [...body.matchAll(/\.(\\32 xl|[a-z0-9]+)\\:/g)].map((m) => (m[1] === '\\32 xl' ? '2xl' : m[1])),
      )
      for (const p of prefixes) {
        if (p !== expected) mismatches.push(`@media(min-width:${width}) 안에 .${p}\\:* — ${expected} 여야 함`)
      }
      if (prefixes.size === 0) mismatches.push(`@media(min-width:${width}) 블록에 클래스가 없음`)
    }
    expect(mismatches).toEqual([])
  })

  it('@theme 에 커스텀 브레이크포인트가 생기면 안전망과 desync 된다 — 함께 고칠 것', () => {
    const custom = [...css.matchAll(/--breakpoint-([a-z0-9]+)\s*:\s*([^;]+);/g)]
    for (const [, name, rawValue] of custom) {
      expect(
        TAILWIND_DEFAULTS[name],
        `--breakpoint-${name} 이 새로 정의됐습니다. globals.css 의 안전망 @media 값도 함께 바꾸세요.`,
      ).toBe(rawValue.trim())
    }
  })

  it('각 브레이크포인트 블록이 같은 display 값 집합을 덮는다', () => {
    const blocks = net.split(/@media \(min-width:[^)]+\)\s*\{/).slice(1)
    expect(blocks.length).toBe(5)
    const sets = blocks.map((b) =>
      [...b.matchAll(/display:\s*([a-z-]+);/g)].map((m) => m[1]).sort().join(','),
    )
    expect(new Set(sets).size, `블록별 display 값 집합이 다릅니다: ${JSON.stringify(sets)}`).toBe(1)
  })

  it('상태 변형 display 유틸이 도입되면 안전망이 조용히 이겨버린다 — 사용 금지', () => {
    // unlayered > 모든 named layer 이므로, `hidden lg:flex data-[state=open]:hidden` 같은
    // 조합에서 레이어 안의 data-[] 규칙이 레이어 밖 lg:flex 에 진다. CSS 에러가 아니라
    // 조용한 오작동이라 리뷰에서 놓치기 쉽다. dark: 는 이 리포가 가장 많이 쓰는 변형이라
    // 반드시 포함한다.
    const VARIANT =
      'dark|hover|focus|focus-visible|focus-within|active|open|checked|disabled|visited|print|first|last|odd|even|group-[a-z-]+|peer-[a-z-]+|aria-[a-z-]+|max-(?:sm|md|lg|xl|2xl)'
    const pattern = new RegExp(
      `\\b(?:${VARIANT}):(?:${DISPLAY})\\b|\\b(?:data|has|supports)-\\[[^\\]]+\\]:(?:${DISPLAY})\\b`,
      'g',
    )

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
    // 컨테이너 쿼리 규칙은 레이어 안에 있으므로 레이어 밖 안전망에 진다.
    // 두 종류를 한 className 에 섞는 순간 컨테이너 쿼리가 무시된다.
    // 현재 해당 요소: src/components/app/HeaderAnnouncementTicker.tsx (컨테이너 쿼리만 사용)
    const container = new RegExp(`@\\[[^\\]]+\\]:(?:${DISPLAY})\\b`)
    const responsive = new RegExp(`\\b(?:sm|md|lg|xl|2xl):(?:${DISPLAY})\\b`)

    const offenders: string[] = []
    for (const file of srcFiles()) {
      const text = readFileSync(file, 'utf8')
      for (const { value, line } of classNameValues(text)) {
        if (container.test(value) && responsive.test(value)) {
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

describe('Tailwind 소스 스캔 제외 목록 (@source not)', () => {
  // denylist 라 새 문서 디렉터리가 생기면 다시 샌다. 실제로 docs/tests 의 예시
  // 클래스명이 배포 CSS 에 유령 규칙 79개를 만들고 있었다.
  const excluded = new Set(
    [...css.matchAll(/@source not\s+"\.\.\/\.\.\/([^"]+)"/g)].map((m) => m[1].replace(/\/$/, '')),
  )
  /** 실제로 런타임 마크업을 만드는 소스 루트. 여기만 스캔되면 된다. */
  const SOURCE_ROOTS = new Set(['src', 'public'])

  let tracked: string[] = []
  try {
    // core.quotePath=true(기본)면 한글 경로가 "docs/\355\225\234..." 로 인용돼 나와
    // 최상위 디렉터리 파싱이 `"docs` 로 어긋난다. 이 리포는 한글 파일명을 쓴다.
    tracked = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
  } catch {
    // git 이 없는 환경(배포 아티팩트 등)에서는 이 검사를 건너뛴다.
  }

  it.skipIf(tracked.length === 0)('추적되는 최상위 디렉터리는 소스이거나 제외되어 있다', () => {
    const dirs = new Set(tracked.filter((f) => f.includes('/')).map((f) => f.split('/')[0]))
    const leaked = [...dirs].filter((d) => !SOURCE_ROOTS.has(d) && !excluded.has(d))
    expect(
      leaked,
      '이 디렉터리의 예시 클래스명이 배포 CSS 에 유령 규칙으로 들어갑니다. globals.css 에 @source not 을 추가하거나, 실제 마크업이면 src/ 로 옮기세요.',
    ).toEqual([])
  })

  it.skipIf(tracked.length === 0)('추적되는 최상위 마크다운은 제외되어 있다', () => {
    const mds = tracked.filter((f) => !f.includes('/') && f.endsWith('.md'))
    const leaked = mds.filter((f) => !excluded.has(f))
    expect(leaked, 'globals.css 에 @source not 을 추가하세요.').toEqual([])
  })
})
