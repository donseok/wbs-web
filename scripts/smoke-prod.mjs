#!/usr/bin/env node
/**
 * 배포 후 프로덕션 스모크 — 2층 관문
 *
 * 왜 이런 검사인가:
 *   2026-07-27 사이드바·헤더가 프로덕션에서 사라진 회귀는 build·tsc·eslint·vitest
 *   2438건을 전부 통과했다. 깨진 트리를 복원해 재빌드한 뒤 Chrome 150 에서 열어도
 *   정상 렌더된다 — 즉 재현 가능한 오라클이 없다. 그래서 "레이아웃이 옳은가"를
 *   판정하려 들지 않는다. 대신 그 증상을 만들어낼 수 있는 **전달 계층의 손상**만
 *   확실하게 잡는다: CSS 가 잘려서 도착하거나, 파스가 중단되거나, 있어야 할 규칙이
 *   빠진 경우. 이건 오라클이 확실하고 오탐이 없다.
 *
 * 사용:
 *   npm run smoke:prod
 *   SMOKE_URL=https://wbs-web.vercel.app npm run smoke:prod
 *
 * 종료 코드: 0 정상 / 1 실패(롤백 검토) / 2 스크립트 자체 오류
 */

const BASE = (process.env.SMOKE_URL || 'https://wbs-web.vercel.app').replace(/\/$/, '')
const TIMEOUT_MS = 20_000

const C = process.stdout.isTTY
  ? { red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }
  : { red: '', grn: '', yel: '', dim: '', off: '' }

const failures = []
const warnings = []

function ok(label, detail = '') {
  console.log(`  ${C.grn}✓${C.off} ${label}${detail ? ` ${C.dim}${detail}${C.off}` : ''}`)
}
function bad(label, detail) {
  console.log(`  ${C.red}✗${C.off} ${label}${detail ? ` ${C.dim}${detail}${C.off}` : ''}`)
  failures.push(detail ? `${label} — ${detail}` : label)
}
function warn(label, detail) {
  console.log(`  ${C.yel}!${C.off} ${label}${detail ? ` ${C.dim}${detail}${C.off}` : ''}`)
  warnings.push(detail ? `${label} — ${detail}` : label)
}

async function get(url) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'manual' })
    const buf = Buffer.from(await res.arrayBuffer())
    return { status: res.status, headers: res.headers, buf, text: buf.toString('utf8') }
  } finally {
    clearTimeout(t)
  }
}

/**
 * 문자열·주석을 건너뛰며 중괄호 균형을 센다.
 * 잘린 스타일시트는 반드시 depth > 0 으로 끝난다 — 절단 탐지의 핵심.
 */
function braceBalance(css) {
  let depth = 0
  let min = 0
  let i = 0
  const n = css.length
  while (i < n) {
    const ch = css[i]
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      if (end === -1) return { depth, min, unterminatedComment: true }
      i = end + 2
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      i++
      while (i < n && css[i] !== quote) {
        if (css[i] === '\\') i++
        i++
      }
      i++
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth < min) min = depth
    }
    i++
  }
  return { depth, min, unterminatedComment: false }
}

function countOccurrences(hay, needle) {
  let n = 0
  let from = 0
  for (;;) {
    const at = hay.indexOf(needle, from)
    if (at === -1) return n
    n++
    from = at + needle.length
  }
}

async function main() {
  console.log(`\n${C.dim}프로덕션 스모크 — ${BASE}${C.off}\n`)

  // ── 1. 로그인 페이지 도달성 ──────────────────────────────────────────
  console.log('로그인 페이지')
  let html
  try {
    const res = await get(`${BASE}/login`)
    if (res.status !== 200) {
      bad('HTTP 200', `실제 ${res.status}`)
      return
    }
    html = res.text
    ok('HTTP 200', `${res.buf.length.toLocaleString()} bytes`)
  } catch (e) {
    bad('페이지 응답', String(e?.message || e))
    return
  }

  // 인증 뒤 화면(사이드바)은 여기서 볼 수 없다. 로그인 폼이 실제로 조립됐는지만 본다.
  for (const [label, marker] of [
    ['이메일 입력란', 'id="email"'],
    ['비밀번호 입력란', 'id="password"'],
    ['제출 버튼', 'type="submit"'],
  ]) {
    if (html.includes(marker)) ok(label)
    else bad(label, `마커 ${marker} 없음`)
  }

  // ── 2. CSS 전달 무결성 ──────────────────────────────────────────────
  console.log('\nCSS 전달 무결성')
  const hrefs = [...new Set(html.match(/\/_next\/static\/css\/[a-f0-9]+\.css/g) || [])]
  if (hrefs.length === 0) {
    bad('스타일시트 링크', 'HTML 에서 CSS 링크를 찾지 못함')
    return
  }
  ok('스타일시트 링크', `${hrefs.length}개 — ${hrefs.join(', ')}`)

  let combined = ''
  for (const href of hrefs) {
    let res
    try {
      res = await get(`${BASE}${href}`)
    } catch (e) {
      bad(`${href} 수신`, String(e?.message || e))
      continue
    }
    if (res.status !== 200) {
      bad(`${href} HTTP 200`, `실제 ${res.status}`)
      continue
    }
    combined += res.text

    // 절단 탐지 ①: 선언된 길이와 실제 수신 바이트 일치
    const declared = res.headers.get('content-length')
    if (declared != null && Number(declared) !== res.buf.length) {
      bad('전송 완결성', `content-length ${declared} ≠ 수신 ${res.buf.length}`)
    } else {
      ok('전송 완결성', `${res.buf.length.toLocaleString()} bytes`)
    }

    // 절단 탐지 ②: 중괄호 균형. 잘린 CSS 는 반드시 여기서 걸린다.
    const { depth, min, unterminatedComment } = braceBalance(res.text)
    if (unterminatedComment) bad('CSS 파스', '닫히지 않은 주석 — 파일이 잘렸을 가능성')
    else if (depth !== 0) bad('CSS 중괄호 균형', `최종 depth=${depth} (0 이어야 함) — 잘린 스타일시트`)
    else if (min < 0) bad('CSS 중괄호 균형', `min depth=${min} — 손상된 스타일시트`)
    else ok('CSS 중괄호 균형', 'depth 0')
  }

  if (!combined) {
    bad('CSS 본문', '수신된 CSS 가 없음')
    return
  }

  // ── 3. 사라졌던 그 규칙들이 실제로 배포본에 있는가 ───────────────────
  console.log('\n레이아웃 급소 규칙')
  const required = [
    ['base .hidden', '.hidden{display:none}'],
    ['사이드바 표시 규칙 lg:flex', '.lg\\:flex{display:flex}'],
    ['헤더 로고 표시 규칙 sm:flex', '.sm\\:flex{display:flex}'],
  ]
  for (const [label, needle] of required) {
    const n = countOccurrences(combined, needle)
    if (n === 0) bad(label, `규칙 없음 (${needle})`)
    else ok(label, `${n}회`)
  }

  // 안전망(15e0eef)은 Tailwind 출력과 같은 규칙을 @layer 밖에 한 벌 더 둔다.
  // 따라서 lg:flex 는 2회 이상이어야 한다. 1회면 안전망이 소실된 것 —
  // 이 파일 꼬리가 유실되는 부류의 손상을 정확히 짚어낸다.
  const lgFlex = countOccurrences(combined, '.lg\\:flex{display:flex}')
  if (lgFlex >= 2) ok('반응형 display 안전망', `사본 ${lgFlex - 1}개 존재`)
  else warn('반응형 display 안전망', `사본 없음 (lg:flex ${lgFlex}회) — globals.css 꼬리 유실 의심`)

  // 안전망의 마지막 규칙. 존재하면 스타일시트 꼬리까지 온전히 도착했다는 뜻.
  if (combined.includes('.\\32 xl\\:hidden{display:none}')) ok('안전망 마지막 규칙 도달')
  else warn('안전망 마지막 규칙', '.\\32 xl\\:hidden 없음 — 꼬리 확인 필요')
}

try {
  await main()
} catch (e) {
  console.error(`\n${C.red}스모크 스크립트 오류:${C.off} ${e?.stack || e}`)
  process.exit(2)
}

console.log('')
if (failures.length) {
  console.log(`${C.red}실패 ${failures.length}건${C.off}`)
  for (const f of failures) console.log(`  · ${f}`)
  console.log(`\n${C.yel}→ 롤백 절차: docs/runbook-rollback.md${C.off}\n`)
  process.exit(1)
}
if (warnings.length) {
  console.log(`${C.yel}경고 ${warnings.length}건 (차단하지 않음)${C.off}`)
  for (const w of warnings) console.log(`  · ${w}`)
}
console.log(`${C.grn}스모크 통과${C.off}\n`)
