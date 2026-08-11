// scripts/db-apply.mjs
// 마이그레이션 적용 — 기존 Management API 레시피(apply-0028 계보)의 범용판 (스펙 §7).
// 규칙: staging 리허설 → 검증 → Staging-verified 트레일러 커밋 → prod 적용 → main push.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { PROD_REF, STAGING_REF } from './lib/staging.config.mjs'

const args = process.argv.slice(2)
// 인자 파싱 — 순서 무관·엄밀하게. args.find(!startsWith('--'))는 `--target staging file.sql`
// 순서에서 'staging'을 파일로 잘못 집고 진짜 파일을 조용히 버리는 결함이 있었다(리뷰 지적).
// --target 의 위치를 먼저 고정한 뒤, 그 두 칸(플래그+값)과 다른 '--' 플래그를 모두 제외한
// 나머지가 정확히 1개일 때만 그것을 SQL 파일로 받는다.
const ti = args.indexOf('--target')
const target = ti !== -1 ? args[ti + 1] : undefined
const positionals = args.filter((a, i) => (ti === -1 || (i !== ti && i !== ti + 1)) && !a.startsWith('--'))
const file = positionals.length === 1 ? positionals[0] : undefined
const REFS = { staging: STAGING_REF, prod: PROD_REF }   // allowlist — 이 둘뿐
const usage = '사용법: npm run db:apply -- <sql파일> --target staging|prod'
if (ti === -1 || target === undefined) {
  console.error(`${usage} (--target 플래그가 없거나 값이 없음)`)
  process.exit(1)
}
if (positionals.length !== 1) {
  console.error(`${usage} (SQL 파일 인자가 정확히 1개여야 함 — 현재 ${positionals.length}개: ${JSON.stringify(positionals)})`)
  process.exit(1)
}
if (!REFS[target]) {
  console.error(`${usage} ("${target}"은 staging|prod 중 하나가 아님)`)
  process.exit(1)
}
const ref = REFS[target]
const sql = readFileSync(file, 'utf8')

const raw = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-a', 'supabase', '-w'], { encoding: 'utf8' }).trim()
const token = raw.startsWith('go-keyring-base64:') ? Buffer.from(raw.slice('go-keyring-base64:'.length), 'base64').toString() : raw

const api = async (path, init) => {
  const res = await fetch(`https://api.supabase.com/v1${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`)
  return res.json()
}
const query = (q) => api(`/projects/${ref}/database/query`, { method: 'POST', body: JSON.stringify({ query: q }) })

// 대상 프로젝트명 실조회 — "어디에 적용하는지"를 이름으로 확인시킨다 (§7.1 안전장치)
const proj = await api(`/projects/${ref}`, { method: 'GET' })
console.log(`대상: ${proj.name} (${ref}) / 파일: ${file}`)

if (target === 'prod') {
  // prod 는 --yes 로 생략 불가 — 명시적 확인 문자열만 받는다
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const a = await rl.question(`운영 적용입니다. 스테이징 리허설을 마쳤습니까? 계속하려면 "${ref}" 입력: `)
  rl.close()
  if (a.trim() !== ref) { console.error('중단'); process.exit(1) }
} else {
  // staging 은 sync 와의 동시 실행만 배제 (§7.1)
  const lock = await query(`select count(*)::int as n from staging_ops.sync_lock where started_at > now() - interval '30 min'`)
  if (lock[0]?.n > 0) { console.error('✗ staging:sync 진행 중 — 완료 후 재실행'); process.exit(1) }
}

await query(sql)
console.log(`✓ ${target} 적용 완료 — 검증 쿼리(스키마 조회 등)로 반드시 확인할 것`)
