#!/usr/bin/env node
/**
 * known-good 태그 — 0층 되돌리기 기반
 *
 * 왜 필요한가:
 *   2026-07-27 화면이 깨졌을 때 "어디로 되돌리면 되는지" 아는 사람이 없었다.
 *   최근 30일 origin/main 에 699커밋이 들어왔지만 태그는 0개였다. 그래서 복구에
 *   다른 PC 를 동원해야 했다. 되돌릴 곳이 있어야 롤백이 실제 선택지가 된다.
 *
 * 이 태그가 거짓말을 하면 안 되는 이유:
 *   사고 한복판에서 이 좌표를 믿고 되돌린다. "스모크는 직전 배포를 봤는데 태그는
 *   아직 배포도 안 된 새 커밋에 찍히는" 상황이 실제로 가능하다 — push 직후
 *   Vercel 이 빌드 중일 때 mark:good 을 돌리면 그렇게 된다. 그래서 태그 대상
 *   커밋이 현재 프로덕션 배포보다 **나중**이면 거부한다.
 *
 * 사용:
 *   npm run mark:good
 *   npm run mark:good -- --dry-run
 *   npm run mark:good -- --skip-smoke   (태그의 의미가 사라지므로 권장하지 않음)
 */

import { execFileSync, spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const SKIP_SMOKE = args.includes('--skip-smoke')
const PROD_URL = (process.env.SMOKE_URL || 'https://wbs-web.vercel.app').replace(/\/$/, '')

const C = process.stdout.isTTY
  ? { red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }
  : { red: '', grn: '', yel: '', dim: '', off: '' }

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const die = (msg) => {
  console.error(`${C.red}✗${C.off} ${msg}`)
  process.exit(1)
}

console.log(`${C.dim}origin 최신화…${C.off}`)
try {
  git('fetch', 'origin', 'main', '--tags')
} catch (e) {
  die(`git fetch 실패: ${e.message}`)
}

const sha = git('rev-parse', 'origin/main')
const short = sha.slice(0, 7)
const subject = git('log', '-1', '--pretty=%s', sha)
const commitEpoch = Number(git('log', '-1', '--pretty=%ct', sha)) * 1000

console.log(`대상  ${C.grn}${short}${C.off} ${subject}`)

const existing = git('tag', '--points-at', sha).split('\n').filter((t) => t.startsWith('good-'))
if (existing.length) {
  // 로컬에만 있고 원격에 없는 태그면(직전 push 실패) 다시 밀어준다.
  const remote = git('ls-remote', '--tags', 'origin').split('\n')
  const unpushed = existing.filter((t) => !remote.some((l) => l.endsWith(`refs/tags/${t}`)))
  if (unpushed.length === 0) {
    console.log(`${C.yel}!${C.off} 이미 known-good 입니다: ${existing.join(', ')}`)
    process.exit(0)
  }
  console.log(`${C.yel}!${C.off} 로컬에만 있는 태그를 원격으로 밀어냅니다: ${unpushed.join(', ')}`)
  if (!DRY) for (const t of unpushed) git('push', 'origin', t)
  console.log(`${C.grn}✓${C.off} ${unpushed.join(', ')} 원격 반영`)
  process.exit(0)
}

// ── 태그 대상이 실제로 배포된 커밋인지 ────────────────────────────────
// vercel CLI 는 커밋 SHA 를 노출하지 않는다. 대신 프로덕션 배포의 생성 시각과
// 커밋 시각을 비교한다 — 커밋이 배포보다 나중이면 그 배포에 들어 있을 수 없다.
function productionDeployment() {
  const r = spawnSync('vercel', ['inspect', PROD_URL], { encoding: 'utf8' })
  if (r.status !== 0) return null
  const out = `${r.stdout || ''}${r.stderr || ''}`
  const status = out.match(/^\s+status\s+.*?(Ready|Building|Error|Canceled)/m)?.[1]
  const created = out.match(/^\s+created\s+(.+?)\s*$/m)?.[1]
  const at = created ? Date.parse(created.replace(/\s*\[.*\]\s*$/, '')) : NaN
  return { status, createdAt: Number.isNaN(at) ? null : at, raw: created }
}

const dep = productionDeployment()
if (!dep) {
  console.log(`${C.yel}!${C.off} vercel CLI 로 프로덕션 배포를 확인하지 못했습니다 — 배포 시점 검증을 건너뜁니다`)
} else {
  if (dep.status !== 'Ready') die(`프로덕션 배포 상태가 ${dep.status} 입니다. Ready 가 된 뒤 다시 실행하세요.`)
  if (dep.createdAt != null && commitEpoch > dep.createdAt) {
    die(
      `태그 대상 커밋이 현재 프로덕션 배포보다 나중입니다 — 아직 배포되지 않았습니다.\n` +
        `    커밋   ${new Date(commitEpoch).toLocaleString('ko-KR')}  ${short}\n` +
        `    배포   ${dep.raw}\n` +
        `    배포가 끝난 뒤 다시 실행하세요.`,
    )
  }
  console.log(`${C.dim}프로덕션 배포 Ready — ${dep.raw}${C.off}`)
}

// ── 스모크 ────────────────────────────────────────────────────────────
if (SKIP_SMOKE) {
  console.log(`${C.yel}!${C.off} --skip-smoke: 검증 없이 태그합니다`)
} else {
  console.log(`${C.dim}프로덕션 스모크 실행…${C.off}`)
  const r = spawnSync(process.execPath, ['scripts/smoke-prod.mjs'], { stdio: 'inherit' })
  if (r.status === 2) die('스모크가 네트워크·스크립트 오류로 판정하지 못했습니다. 배포 상태와 무관하므로 다시 실행하세요.')
  if (r.status !== 0) die('스모크 실패 — 태그하지 않습니다. docs/runbook-rollback.md 를 보세요.')
}

// ── 태그 ──────────────────────────────────────────────────────────────
const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
const p = (n) => String(n).padStart(2, '0')
const base = `good-${kst.getUTCFullYear()}${p(kst.getUTCMonth() + 1)}${p(kst.getUTCDate())}-${p(kst.getUTCHours())}${p(kst.getUTCMinutes())}`

// 사고 대응 중엔 같은 분에 여러 번 찍는다. 충돌로 죽어서 좌표를 못 남기면 곤란하다.
const taken = new Set(git('tag', '-l', `${base}*`).split('\n').filter(Boolean))
let tag = base
for (let i = 2; taken.has(tag); i++) tag = `${base}-${i}`

const message = `known-good: 프로덕션 스모크 통과\n\n${short} ${subject}`

if (DRY) {
  console.log(`\n${C.dim}[dry-run] 실행하지 않음:${C.off}`)
  console.log(`  git tag -a ${tag} ${short} -m "…"`)
  console.log(`  git push origin ${tag}`)
  process.exit(0)
}

git('tag', '-a', tag, sha, '-m', message)
try {
  git('push', 'origin', tag)
} catch (e) {
  // 로컬 태그를 남겨두면 다음 실행이 "이미 known-good" 으로 오판한다.
  // (위의 unpushed 복구 경로가 받아주긴 하지만, 실패 흔적을 남기지 않는 쪽이 낫다.)
  try { git('tag', '-d', tag) } catch { /* 정리 실패는 무시 */ }
  die(`태그 push 실패 — 로컬 태그를 되돌렸습니다.\n    ${e.message}`)
}

console.log(`\n${C.grn}✓${C.off} ${tag} → ${short}`)
console.log(`${C.dim}되돌리려면: docs/runbook-rollback.md 3번${C.off}\n`)
