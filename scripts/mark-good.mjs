#!/usr/bin/env node
/**
 * known-good 태그 — 0층 되돌리기 기반
 *
 * 왜 필요한가:
 *   2026-07-27 화면이 깨졌을 때 "어디로 되돌리면 되는지" 아는 사람이 없었다.
 *   최근 30일 origin/main 에 699커밋이 들어왔지만 태그는 0개였다. 그래서 복구에
 *   다른 PC 를 동원해야 했다. 이 스크립트는 "이 시점은 눈으로 확인했다"를
 *   리포에 남긴다. 되돌릴 곳이 있어야 롤백이 실제 선택지가 된다.
 *
 * 규칙: 스모크를 통과한 커밋만 태그한다. 통과 못 하면 태그하지 않는다.
 *       (--skip-smoke 로 건너뛸 수 있지만, 그러면 태그의 의미가 없다.)
 *
 * 사용:
 *   npm run mark:good              # origin/main HEAD 를 스모크 후 태그+푸시
 *   npm run mark:good -- --dry-run # 무엇을 할지만 출력
 *   npm run mark:good -- --skip-smoke
 */

import { execFileSync, spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const SKIP_SMOKE = args.includes('--skip-smoke')

const C = process.stdout.isTTY
  ? { red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }
  : { red: '', grn: '', yel: '', dim: '', off: '' }

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()

function die(msg) {
  console.error(`${C.red}✗${C.off} ${msg}`)
  process.exit(1)
}

// 프로덕션은 origin/main 이다. 로컬 main 은 뒤처져 있을 수 있으므로 항상 원격 기준.
console.log(`${C.dim}origin 최신화…${C.off}`)
try {
  git('fetch', 'origin', 'main', '--tags')
} catch (e) {
  die(`git fetch 실패: ${e.message}`)
}

const sha = git('rev-parse', 'origin/main')
const short = sha.slice(0, 7)
const subject = git('log', '-1', '--pretty=%s', sha)

console.log(`대상  ${C.grn}${short}${C.off} ${subject}`)

// 이미 known-good 인 커밋이면 중복 태그하지 않는다.
const existing = git('tag', '--points-at', sha)
  .split('\n')
  .filter((t) => t.startsWith('good-'))
if (existing.length) {
  console.log(`${C.yel}!${C.off} 이미 known-good 입니다: ${existing.join(', ')}`)
  process.exit(0)
}

if (!SKIP_SMOKE) {
  console.log(`${C.dim}프로덕션 스모크 실행…${C.off}`)
  const r = spawnSync(process.execPath, ['scripts/smoke-prod.mjs'], { stdio: 'inherit' })
  if (r.status !== 0) {
    die('스모크 실패 — 태그하지 않습니다. docs/runbook-rollback.md 를 보세요.')
  }
} else {
  console.log(`${C.yel}!${C.off} --skip-smoke: 검증 없이 태그합니다`)
}

// 태그명은 정렬하면 시간순이 되도록 UTC+9 로 고정 포맷.
const now = new Date()
const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
const p = (n, w = 2) => String(n).padStart(w, '0')
const tag = `good-${kst.getUTCFullYear()}${p(kst.getUTCMonth() + 1)}${p(kst.getUTCDate())}-${p(kst.getUTCHours())}${p(kst.getUTCMinutes())}`

const message = `known-good: 프로덕션 스모크 통과\n\n${short} ${subject}`

if (DRY) {
  console.log(`\n${C.dim}[dry-run] 실행하지 않음:${C.off}`)
  console.log(`  git tag -a ${tag} ${short} -m "…"`)
  console.log(`  git push origin ${tag}`)
  process.exit(0)
}

git('tag', '-a', tag, sha, '-m', message)
git('push', 'origin', tag)

console.log(`\n${C.grn}✓${C.off} ${tag} → ${short}`)
console.log(`${C.dim}되돌리려면: git switch -c hotfix ${tag}${C.off}\n`)
