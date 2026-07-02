// ---------------------------------------------------------------------------
// 공지사항 마이그레이션(0012) 적용기 (node + pg). psql 없이도 동작.
// SUPABASE_DB_URL 을 .env.local(또는 환경변수)에서 읽어 적용·검증한다.
//
// 사용:
//   npm i --no-save pg && node scripts/apply-announcements-migration.mjs
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readEnvLocal(key) {
  try {
    const txt = readFileSync(join(root, '.env.local'), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && m[1] === key) return m[2].replace(/^['"]|['"]$/g, '').trim()
    }
  } catch {
    /* no .env.local */
  }
  return ''
}

const dbUrl = process.env.SUPABASE_DB_URL || readEnvLocal('SUPABASE_DB_URL')
if (!dbUrl) {
  console.error('✗ SUPABASE_DB_URL 이 .env.local 또는 환경변수에 없습니다.')
  console.error('  Dashboard > Project Settings > Database > Connection string > URI 를 .env.local 에 넣으세요.')
  process.exit(1)
}

let pg
try {
  pg = await import('pg')
} catch {
  console.error('✗ pg 모듈이 없습니다. 먼저 실행: npm i --no-save pg')
  process.exit(1)
}

const sql = readFileSync(join(root, 'supabase/migrations/0012_announcements.sql'), 'utf8')
const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

await client.connect()
try {
  await client.query(sql) // 멱등(create … if not exists / drop policy if exists)
  const tbl = await client.query("select to_regclass('public.announcements') as t")
  const seen = await client.query("select to_regclass('public.announcement_seen') as t")
  const pol = await client.query(
    "select count(*)::int as n from pg_policies where tablename in ('announcements', 'announcement_seen')",
  )
  console.log('✓ 적용 완료')
  console.log('  - announcements 테이블:', tbl.rows[0].t ?? '없음')
  console.log('  - announcement_seen 테이블:', seen.rows[0].t ?? '없음')
  console.log('  - RLS 정책 수:', pol.rows[0].n, '(기대: 3)')
} catch (e) {
  console.error('✗ 적용 실패:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
