#!/usr/bin/env node
/**
 * 배포 후 프로덕션 스모크 — 2층 관문
 *
 * 왜 이런 검사인가:
 *   2026-07-27 사이드바·헤더가 프로덕션에서 사라진 회귀는 build·tsc·eslint·vitest
 *   2438건을 전부 통과했다. 깨진 트리를 복원해 재빌드한 뒤 Chrome 150 에서 열어도
 *   정상 렌더된다 — 즉 재현 가능한 오라클이 없다. 그래서 "레이아웃이 옳은가"를
 *   판정하려 들지 않는다. 대신 그 증상을 만들어낼 수 있는 **배포 산출물의 손실**만
 *   잡는다: 잘려서 도착하거나, 파스가 중단되거나, 있어야 할 구조가 빠진 경우.
 *
 * 설계 원칙 — 애매하면 실패시킨다:
 *   초기 판본은 "안전망 소실"을 경고로만 처리해 exit 0 을 냈다. 그러면 이 스크립트가
 *   막으려던 바로 그 사고(globals.css 꼬리 소실)가 초록으로 통과하고 known-good
 *   태그까지 찍힌다. 경고는 정보용이고, 화면에 영향이 가는 손실은 전부 실패다.
 *
 * 사용:
 *   npm run smoke:prod
 *   SMOKE_URL=http://127.0.0.1:4599 npm run smoke:prod
 *
 * 종료 코드: 0 정상 / 1 실패(롤백 검토) / 2 스크립트·네트워크 오류(배포 판정 아님)
 */

const BASE = (process.env.SMOKE_URL || 'https://wbs-web.vercel.app').replace(/\/$/, '')
const TIMEOUT_MS = 20_000
const RETRIES = 3

/**
 * 구조 하한선. 프로덕션 실측값(2026-07-28: 118,906 bytes / 규칙 1,701 / 커스텀
 * 프로퍼티 485 / @property 71 / @keyframes 9)에 여유를 둔 값이다.
 * "규칙 3개가 존재하는가"만 보면 그 3개를 비켜 간 대량 손실을 전부 놓친다 —
 * 실제로 :root 디자인 토큰 5KB 를 중괄호 균형이 맞게 도려내도 통과했다.
 * CSS 가 정당하게 크게 줄었다면 이 값을 함께 내리고 그 이유를 커밋에 남길 것.
 */
const FLOOR = {
  cssBytes: 90_000,
  rules: 1_300,
  customProps: 380,
  atProperty: 50,
  keyframes: 6,
}

const C = process.stdout.isTTY
  ? { red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }
  : { red: '', grn: '', yel: '', dim: '', off: '' }

const failures = []

const ok = (l, d = '') => console.log(`  ${C.grn}✓${C.off} ${l}${d ? ` ${C.dim}${d}${C.off}` : ''}`)
const bad = (l, d) => {
  console.log(`  ${C.red}✗${C.off} ${l}${d ? ` ${C.dim}${d}${C.off}` : ''}`)
  failures.push(d ? `${l} — ${d}` : l)
}
const skip = (l, d) => console.log(`  ${C.dim}－ ${l}${d ? ` ${d}` : ''}${C.off}`)

class NetworkError extends Error {}

/** 망 문제로 정상 배포를 롤백시키지 않도록 재시도한다. 끝내 실패하면 exit 2. */
async function get(url) {
  let last
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url, { signal: ctl.signal, redirect: 'manual' })
      const buf = Buffer.from(await res.arrayBuffer())
      return { status: res.status, headers: res.headers, buf, text: buf.toString('utf8') }
    } catch (e) {
      last = e
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 1000 * attempt))
    } finally {
      clearTimeout(t)
    }
  }
  throw new NetworkError(`${url} — ${RETRIES}회 시도 실패: ${last?.message || last}`)
}

/**
 * 중괄호 균형. 잘린 스타일시트는 depth > 0 으로 끝난다.
 *
 * 백슬래시 이스케이프를 문자열 **밖에서도** 건너뛰어야 한다. Tailwind 는
 * `.a\'b` 처럼 따옴표를 이스케이프한 선택자를 낼 수 있는데, 그걸 문자열 시작으로
 * 오인하면 그 지점부터 EOF 까지 중괄호를 하나도 세지 않아 무조건 depth 0 —
 * 즉 이 함수가 통째로 실명한다.
 */
function braceBalance(css) {
  let depth = 0
  let min = 0
  let i = 0
  const n = css.length
  while (i < n) {
    const ch = css[i]
    if (ch === '\\') { i += 2; continue }
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
    else if (ch === '}') { depth--; if (depth < min) min = depth }
    i++
  }
  return { depth, min, unterminatedComment: false }
}

const count = (hay, needle) => {
  let n = 0, from = 0
  for (;;) {
    const at = hay.indexOf(needle, from)
    if (at === -1) return n
    n++
    from = at + needle.length
  }
}
const countRe = (hay, re) => (hay.match(re) || []).length

async function main() {
  console.log(`\n${C.dim}프로덕션 스모크 — ${BASE}${C.off}\n`)

  // ── 1. 로그인 페이지 ────────────────────────────────────────────────
  console.log('로그인 페이지')
  const page = await get(`${BASE}/login`)
  if (page.status !== 200) {
    bad('HTTP 200', `실제 ${page.status}`)
    return
  }
  const html = page.text
  ok('HTTP 200', `${page.buf.length.toLocaleString()} bytes`)

  // 인증 뒤 화면(사이드바)은 여기서 볼 수 없다. 로그인 폼 조립만 확인한다.
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

  let css = ''
  for (const href of hrefs) {
    const res = await get(`${BASE}${href}`)
    if (res.status !== 200) {
      bad(`${href} HTTP 200`, `실제 ${res.status}`)
      continue
    }
    css += res.text

    // content-length 는 **전송된(압축된)** 바이트다. fetch 는 자동 압축해제하므로
    // 압축 응답에서는 구조적으로 불일치한다 — 비교하면 정상 배포를 롤백시킨다.
    // 비압축이고 헤더가 있을 때만 비교하고, 없으면 "확인 못 함"이라고 말한다.
    const declared = res.headers.get('content-length')
    const encoded = res.headers.get('content-encoding')
    if (encoded) skip('전송 완결성 비교 생략', `content-encoding: ${encoded}`)
    else if (declared == null) skip('전송 완결성 비교 생략', 'content-length 헤더 없음')
    else if (Number(declared) !== res.buf.length) bad('전송 완결성', `content-length ${declared} ≠ 수신 ${res.buf.length}`)
    else ok('전송 완결성', `${res.buf.length.toLocaleString()} bytes`)

    const { depth, min, unterminatedComment } = braceBalance(res.text)
    if (unterminatedComment) bad('CSS 파스', '닫히지 않은 주석 — 파일이 잘렸을 가능성')
    else if (depth !== 0) bad('CSS 중괄호 균형', `최종 depth=${depth} — 잘린 스타일시트`)
    else if (min < 0) bad('CSS 중괄호 균형', `min depth=${min} — 손상된 스타일시트`)
    else ok('CSS 중괄호 균형', 'depth 0')
  }
  if (!css) { bad('CSS 본문', '수신된 CSS 가 없음'); return }

  // ── 3. 구조 하한선 ──────────────────────────────────────────────────
  // 중괄호 균형만으로는 "규칙 경계에서 깔끔하게 잘린" 손실과 "중간 구간 절제"를
  // 잡지 못한다(둘 다 depth 0 이다). 실측 기반 하한선으로 대량 손실을 잡는다.
  console.log('\n구조 하한선')
  const metrics = [
    ['CSS 크기', Buffer.byteLength(css), FLOOR.cssBytes, 'bytes'],
    ['규칙 수', count(css, '}'), FLOOR.rules, '개'],
    ['커스텀 프로퍼티', countRe(css, /--[a-z0-9-]+\s*:/g), FLOOR.customProps, '개'],
    ['@property', countRe(css, /@property/g), FLOOR.atProperty, '개'],
    ['@keyframes', countRe(css, /@keyframes/g), FLOOR.keyframes, '개'],
  ]
  for (const [label, actual, floor, unit] of metrics) {
    if (actual < floor) bad(label, `${actual.toLocaleString()}${unit} < 하한 ${floor.toLocaleString()}${unit} — 대량 손실`)
    else ok(label, `${actual.toLocaleString()}${unit}`)
  }

  // @layer 이름이 한 글자만 깨져도 브라우저는 그 블록 전체를 버린다.
  // 중괄호 개수는 그대로라 균형 검사로는 절대 안 잡히는 손상이다.
  for (const layer of ['properties', 'theme', 'base', 'components', 'utilities']) {
    if (css.includes(`@layer ${layer}{`) || css.includes(`@layer ${layer} {`)) ok(`@layer ${layer}`)
    else bad(`@layer ${layer}`, '레이어 블록 소실 — 해당 레이어 전량 무효')
  }

  // ── 4. 레이아웃 급소 ────────────────────────────────────────────────
  console.log('\n레이아웃 급소')
  for (const [label, needle] of [
    ['base .hidden', '.hidden{display:none}'],
    ['사이드바 lg:flex', '.lg\\:flex{display:flex}'],
    ['헤더 로고 sm:flex', '.sm\\:flex{display:flex}'],
  ]) {
    const n = count(css, needle)
    if (n === 0) bad(label, `규칙 없음 (${needle})`)
    else ok(label, `${n}회`)
  }

  // 안전망은 Tailwind 출력과 같은 규칙을 @layer 밖에 한 벌 더 둔다. 사본이 없다는
  // 것은 globals.css 꼬리가 배포본에서 사라졌다는 뜻 — 2026-07-27 사고와 같은
  // 증상이 나는 조건이다. 경고가 아니라 실패로 다룬다.
  const lgFlex = count(css, '.lg\\:flex{display:flex}')
  if (lgFlex >= 2) ok('반응형 display 안전망', `사본 ${lgFlex - 1}개`)
  else bad('반응형 display 안전망', `사본 없음(lg:flex ${lgFlex}회) — globals.css 꼬리 소실`)

  // 안전망의 마지막 규칙. 스타일시트 꼬리까지 온전히 도착했다는 증거.
  if (css.includes('.\\32 xl\\:hidden{display:none}')) ok('CSS 꼬리 도달', '안전망 마지막 규칙 존재')
  else bad('CSS 꼬리 도달', '.\\32 xl\\:hidden 없음 — 꼬리가 잘렸다')
}

let exitCode = 0
try {
  await main()
} catch (e) {
  if (e instanceof NetworkError) {
    console.error(`\n${C.yel}네트워크 오류 — 배포 결함 판정 아님:${C.off} ${e.message}`)
    console.error(`${C.dim}망 상태를 확인하고 다시 실행하세요. 이 결과로 롤백하지 마세요.${C.off}\n`)
    process.exit(2)
  }
  console.error(`\n${C.red}스모크 스크립트 오류:${C.off} ${e?.stack || e}`)
  process.exit(2)
}

console.log('')
if (failures.length) {
  console.log(`${C.red}실패 ${failures.length}건${C.off}`)
  for (const f of failures) console.log(`  · ${f}`)
  console.log(`\n${C.yel}→ 롤백 절차: docs/runbook-rollback.md${C.off}\n`)
  exitCode = 1
} else {
  console.log(`${C.grn}스모크 통과${C.off}\n`)
}
process.exit(exitCode)
