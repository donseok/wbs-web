// ---------------------------------------------------------------------------
// 0039 (회의록 탐색기 — minutes.body_preview 생성 컬럼 + minute_favorites) 단독 적용·검증기.
// db push(전체 이력 재조정) 대신 이 마이그레이션 하나만 프로덕션에 적용한다.
//
// 자격증명 우선순위:
//   1) SUPABASE_ACCESS_TOKEN (sbp_...) → Management API REST (/database/query)
//   2) SUPABASE_DB_URL (postgresql://...) → pg 직결
//
// 사용 예:
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-0039.mjs
//
// 멱등: add column if not exists + create table if not exists + drop policy if exists.
// 순서 주의: 이 적용이 끝난 뒤에만 main 머지·푸시(=배포)할 것 — 코드가 body_preview 를
//            조회하므로 역순이면 회의록 목록·트리가 42703 으로 죽는다.
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

const sql = readFileSync(join(root, 'supabase/migrations/0039_minutes_explorer.sql'), 'utf8')

// 컬럼 존재 + 테이블 존재 + RLS 활성까지 확인.
const VERIFY = `select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='minutes' and column_name='body_preview') = 1
  and (select count(*) from pg_tables where schemaname='public' and tablename='minute_favorites') = 1
  and (select rowsecurity from pg_tables where schemaname='public' and tablename='minute_favorites')
  as ok`

// 생성 컬럼이 실 데이터 위에서 실제로 계산되는지 — 표현식 컴파일·계산의 첫 실행 지점.
const SAMPLE = `select count(*) as total,
  count(*) filter (where body_preview is not null) as computed,
  coalesce(max(length(body_preview)), 0) as max_len
  from minutes`

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
    console.log('✓ 0039 적용 완료 — body_preview 컬럼 + minute_favorites 테이블 + RLS 활성.')
    console.log(`  생성 컬럼 계산: ${sample?.computed}/${sample?.total} 행, 최대 길이 ${sample?.max_len}자 (캡 240)`)
  } else {
    console.error('✗ 적용은 됐으나 검증 실패 — 컬럼/테이블/RLS 중 하나가 확인되지 않습니다.')
    process.exitCode = 1
  }
} catch (e) {
  console.error('✗ 적용 실패:', e.message)
  process.exitCode = 1
}
