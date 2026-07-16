// ---------------------------------------------------------------------------
// 0028 (팀 편집자 산출물 편집 컬럼 가드 확장) 단독 적용·검증기.
// db push(전체 이력 재조정) 대신 이 마이그레이션 하나만 프로덕션에 적용한다.
//
// 자격증명 우선순위:
//   1) SUPABASE_ACCESS_TOKEN (sbp_...) → Management API REST (/database/query)
//   2) SUPABASE_DB_URL (postgresql://...) → pg 직결
//
// 사용 예:
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-0028.mjs
//   SUPABASE_DB_URL=postgresql://... node scripts/apply-0028.mjs   (npm i --no-save pg 필요)
//
// 멱등: create or replace function — 여러 번 실행해도 안전.
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT_REF = 'rglfgrwwwwdqejohdnty'

function readEnvLocal(key) {
  try {
    for (const line of readFileSync(join(root, '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && m[1] === key) return m[2].replace(/^['"]|['"]$/g, '').trim()
    }
  } catch { /* none */ }
  return ''
}

const sql = readFileSync(join(root, 'supabase/migrations/0028_team_editor_deliverable.sql'), 'utf8')

// 적용 후 가드 본문이 실제로 deliverable 을 화이트리스트에 넣었는지 확인하는 쿼리.
const VERIFY = `select pg_get_functiondef(p.oid) like '%- ''deliverable''%' as ok
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'guard_team_editor_actual_only'`

async function viaApi(token) {
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
  await run(sql)
  const rows = await run(VERIFY)
  return Array.isArray(rows) && rows[0]?.ok === true
}

async function viaPg(dbUrl) {
  const pg = await import('pg').catch(() => { throw new Error('pg 모듈 없음: npm i --no-save pg') })
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(sql)
    const r = await client.query(VERIFY)
    return r.rows[0]?.ok === true
  } finally { await client.end() }
}

const token = process.env.SUPABASE_ACCESS_TOKEN || readEnvLocal('SUPABASE_ACCESS_TOKEN')
const dbUrl = process.env.SUPABASE_DB_URL || readEnvLocal('SUPABASE_DB_URL')

if (!token && !dbUrl) {
  console.error('✗ 자격증명 없음. SUPABASE_ACCESS_TOKEN(sbp_...) 또는 SUPABASE_DB_URL 을 주입하세요.')
  process.exit(1)
}

try {
  const ok = token ? await viaApi(token) : await viaPg(dbUrl)
  if (ok) {
    console.log('✓ 0028 적용 완료 — guard_team_editor_actual_only 가 deliverable 을 허용합니다.')
  } else {
    console.error('✗ 적용은 됐으나 검증 실패 — 가드 본문에 deliverable 화이트리스트가 확인되지 않습니다.')
    process.exitCode = 1
  }
} catch (e) {
  console.error('✗ 적용 실패:', e.message)
  process.exitCode = 1
}
