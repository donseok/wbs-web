// ---------------------------------------------------------------------------
// 0050 (마이그레이션 적용 원장) 단독 적용·검증기 + **기존 마이그레이션 백필**.
// db push(전체 이력 재조정) 대신 이 마이그레이션 하나만 프로덕션에 적용한다.
//
// 자격증명 우선순위:
//   1) SUPABASE_ACCESS_TOKEN (sbp_...) → Management API REST (/database/query)
//   2) SUPABASE_DB_URL (postgresql://...) → pg 직결
//
// 사용 예:
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-0050.mjs            # 실제 적용
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-0050.mjs --dry-run  # 무엇을 할지만 출력
//
// ⚠️ 이 스크립트는 **원장 테이블 자체가 자기 자신을 첫 행으로 기록**하는 순환을 다룬다.
//    0050 을 적용한 뒤 같은 트랜잭션 밖에서 0050 을 포함한 전 마이그레이션을 백필한다.
//
// ⚠️ 백필의 한계 — 정직하게 적어 둔다:
//    "언제 적용됐는지"는 아무도 기록하지 않았으므로 **알 수 없다.** applied_at 을 지금 시각으로
//    찍으면 거짓이 된다. 그래서 백필 행은 `note` 에 'backfilled — 실제 적용 시각 불명' 을 남기고
//    applied_at 은 백필 시각으로 둔다. **원장의 applied_at 은 0050 이후 적용분부터만 신뢰할 수 있다.**
//
// 멱등: 재실행해도 안전하다(원장은 filename PK 라 on conflict do nothing).
// 롤백: supabase/migrations/0050_migration_ledger_rollback.sql (원장 기록이 전부 소실된다)
// ---------------------------------------------------------------------------
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// 운영 DB 오적용 방지(스펙 §10.11) — ref 하드코딩 금지. 반드시 env 로 받고 화면에 밝힌다.
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF
if (!PROJECT_REF) {
  console.error('SUPABASE_PROJECT_REF 가 필요합니다. 예: SUPABASE_PROJECT_REF=<ref> node scripts/apply-0050.mjs')
  process.exit(1)
}
if (process.env.APPLY_CONFIRM !== PROJECT_REF) {
  console.error(`대상 프로젝트: ${PROJECT_REF}`)
  console.error(`확인을 위해 APPLY_CONFIRM=${PROJECT_REF} 를 함께 지정해 다시 실행하세요.`)
  process.exit(1)
}
const DRY = process.argv.includes('--dry-run')

function readEnvLocal(key) {
  try {
    for (const line of readFileSync(join(root, '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && m[1] === key) return m[2].replace(/^['"]|['"]$/g, '').trim()
    }
  } catch { /* none */ }
  return ''
}

const migDir = join(root, 'supabase/migrations')
const sql = readFileSync(join(migDir, '0050_migration_ledger.sql'), 'utf8')

/** 리포의 정방향 마이그레이션 전량 — 백필 대상. */
function forwardMigrations() {
  const all = readdirSync(migDir).filter(f => f.endsWith('.sql'))
  return all
    .filter(f => !f.endsWith('_rollback.sql'))
    .sort()
    .map(f => ({
      filename: f,
      checksum: createHash('sha256').update(readFileSync(join(migDir, f))).digest('hex'),
      rollback: all.includes(f.replace(/\.sql$/, '_rollback.sql')),
    }))
}

const esc = (s) => `'${String(s).replace(/'/g, "''")}'`

/** 백필 INSERT — filename PK 충돌은 무시(멱등). */
function backfillSql(rows, actor) {
  const values = rows.map(r =>
    `(${esc(r.filename)}, ${esc(actor)}, ${esc(r.checksum)}, ${r.rollback}, ` +
    `${esc('backfilled 2026-07-28 — 실제 적용 시각 불명. applied_at 은 백필 시각이다')})`,
  ).join(',\n    ')
  return `insert into public.migration_ledger
    (filename, applied_by, checksum, rollback_available, note)
  values
    ${values}
  on conflict (filename) do nothing`
}

const VERIFY = `select
  (select count(*) from public.migration_ledger) as recorded,
  (select count(*) from public.migration_ledger where rollback_available) as with_rollback,
  (select count(*) from information_schema.tables
     where table_schema = 'public' and table_name = 'migration_ledger') = 1 as table_exists`

async function viaApi(token, statements) {
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`
  const run = async (query) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`)
    return res.json()
  }
  for (const s of statements) await run(s)
  const v = await run(VERIFY)
  return Array.isArray(v) ? v[0] : null
}

async function viaPg(dbUrl, statements) {
  const pg = await import('pg').catch(() => { throw new Error('pg 모듈 없음: npm i --no-save pg') })
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    for (const s of statements) await client.query(s)
    const r = await client.query(VERIFY)
    return r.rows[0] ?? null
  } finally { await client.end() }
}

const token = process.env.SUPABASE_ACCESS_TOKEN || readEnvLocal('SUPABASE_ACCESS_TOKEN')
const dbUrl = process.env.SUPABASE_DB_URL || readEnvLocal('SUPABASE_DB_URL')
const actor = process.env.LEDGER_ACTOR || 'donseok75@gmail.com'

const rows = forwardMigrations()
const statements = [sql, backfillSql(rows, actor)]

console.log(`정방향 마이그레이션 ${rows.length}개 · 롤백 파일 있는 것 ${rows.filter(r => r.rollback).length}개`)
console.log(`적용자(applied_by) = ${actor}`)

if (DRY) {
  console.log('\n[dry-run] 실행하지 않음. 백필 대상:')
  for (const r of rows) console.log(`  ${r.rollback ? '✓' : '✗'} ${r.filename}  ${r.checksum.slice(0, 12)}…`)
  console.log('\n※ ✗ 는 롤백 파일이 없는 것 — 0050 이후 마이그레이션에는 테스트가 롤백 파일을 강제한다.')
  process.exit(0)
}

if (!token && !dbUrl) {
  console.error('✗ 자격증명 없음. SUPABASE_ACCESS_TOKEN(sbp_...) 또는 SUPABASE_DB_URL 을 주입하세요.')
  process.exit(1)
}

try {
  const v = token ? await viaApi(token, statements) : await viaPg(dbUrl, statements)
  if (!v?.table_exists) {
    console.error('✗ migration_ledger 테이블이 생성되지 않았다.')
    process.exit(1)
  }
  console.log(`\n✓ 적용 완료 — 원장 ${v.recorded}행 (롤백 가능 ${v.with_rollback}행)`)
  if (Number(v.recorded) !== rows.length) {
    console.log(`  ! 리포 파일 ${rows.length}개와 원장 ${v.recorded}행이 다르다 — 이전 백필분이 있거나 파일이 추가됐다.`)
  }
  console.log('  ⚠️ 백필분의 applied_at 은 실제 적용 시각이 아니다(불명). 0050 이후분부터 신뢰할 것.')
} catch (e) {
  console.error(`✗ 실패: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
}
