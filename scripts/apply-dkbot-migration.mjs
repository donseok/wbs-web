// ---------------------------------------------------------------------------
// DK Bot pgvector 마이그레이션 적용기 (node + pg). psql 없이도 동작.
// SUPABASE_DB_URL 을 .env.local(또는 환경변수)에서 읽어 0010 마이그레이션을 적용·검증한다.
//
// 사용:
//   npm i --no-save pg && node scripts/apply-dkbot-migration.mjs
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

const sql = readFileSync(join(root, 'supabase/migrations/0010_dkbot_pgvector.sql'), 'utf8')
const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

await client.connect()
try {
  await client.query(sql) // 멱등(create … if not exists / create or replace)
  const tbl = await client.query("select to_regclass('public.wbs_embeddings') as t")
  const fn = await client.query("select count(*)::int as n from pg_proc where proname = 'match_wbs_documents'")
  const ext = await client.query("select count(*)::int as n from pg_extension where extname = 'vector'")
  console.log('✓ 적용 완료')
  console.log('  - vector 확장:', ext.rows[0].n > 0 ? 'OK' : '없음')
  console.log('  - wbs_embeddings 테이블:', tbl.rows[0].t ?? '없음')
  console.log('  - match_wbs_documents 함수:', fn.rows[0].n > 0 ? 'OK' : '없음')
} catch (e) {
  console.error('✗ 적용 실패:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
