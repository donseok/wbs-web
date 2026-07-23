// ---------------------------------------------------------------------------
// 0040 (회의록 폴더 — minute_folders + minutes.folder_id + 시드 10구분) 단독 적용·검증기.
// db push(전체 이력 재조정) 대신 이 마이그레이션 하나만 프로덕션에 적용한다.
//
// 자격증명 우선순위:
//   1) SUPABASE_ACCESS_TOKEN (sbp_...) → Management API REST (/database/query)
//   2) SUPABASE_DB_URL (postgresql://...) → pg 직결
//
// 사용 예:
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-0040.mjs
//
// 멱등: create table/index if not exists + where not exists 시드 + drop policy if exists.
// 순서 주의: 이 적용이 끝난 뒤에만 main 머지·푸시(=배포)할 것 — LIST_COLS 가 folder_id 를
//            조회하므로 역순이면 회의록 목록·달력·검색·탐색기 전부 42703 으로 죽는다.
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

const sql = readFileSync(join(root, 'supabase/migrations/0040_minute_folders.sql'), 'utf8')

// 테이블 + RLS + 정책 4개 + 루트 시드 10행 + minutes.folder_id 컬럼까지 확인.
const VERIFY = `select
  (select count(*) from pg_tables where schemaname='public' and tablename='minute_folders') = 1
  and (select rowsecurity from pg_tables where schemaname='public' and tablename='minute_folders')
  and (select count(*) from pg_policies where schemaname='public' and tablename='minute_folders') = 4
  and (select count(*) from minute_folders where parent_id is null) >= 10
  and (select count(*) from information_schema.columns
       where table_schema='public' and table_name='minutes' and column_name='folder_id') = 1
  as ok`

const SAMPLE = `select
  (select count(*) from minute_folders where parent_id is null) as roots,
  (select count(*) from minutes where folder_id is null) as unfiled,
  (select count(*) from minutes) as total`

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
  const ok = await run(VERIFY)
  const sample = await run(SAMPLE)
  return { ok: Array.isArray(ok) && ok[0]?.ok === true, sample: Array.isArray(sample) ? sample[0] : null }
}

async function viaPg(dbUrl) {
  const pg = await import('pg').catch(() => { throw new Error('pg 모듈 없음: npm i --no-save pg') })
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(sql)
    const r = await client.query(VERIFY)
    const s = await client.query(SAMPLE)
    return { ok: r.rows[0]?.ok === true, sample: s.rows[0] ?? null }
  } finally { await client.end() }
}

const token = process.env.SUPABASE_ACCESS_TOKEN || readEnvLocal('SUPABASE_ACCESS_TOKEN')
const dbUrl = process.env.SUPABASE_DB_URL || readEnvLocal('SUPABASE_DB_URL')

if (!token && !dbUrl) {
  console.error('✗ 자격증명 없음. SUPABASE_ACCESS_TOKEN(sbp_...) 또는 SUPABASE_DB_URL 을 주입하세요.')
  process.exit(1)
}

try {
  const { ok, sample } = token ? await viaApi(token) : await viaPg(dbUrl)
  if (ok) {
    console.log('✓ 0040 적용 완료 — minute_folders + RLS 정책 4개 + 시드 + minutes.folder_id.')
    console.log(`  루트 폴더 ${sample?.roots}개 · 미분류 ${sample?.unfiled}/${sample?.total}건`)
  } else {
    console.error('✗ 적용은 됐으나 검증 실패 — 테이블/RLS/정책/시드/컬럼 중 하나가 확인되지 않습니다.')
    process.exitCode = 1
  }
} catch (e) {
  console.error('✗ 적용 실패:', e.message)
  process.exitCode = 1
}
