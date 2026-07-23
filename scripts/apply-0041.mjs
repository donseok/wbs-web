// ---------------------------------------------------------------------------
// 0041 (이슈관리 — issues 테이블 + RLS 4정책 + 복합 FK) 단독 적용·검증기.
// db push(전체 이력 재조정) 대신 이 마이그레이션 하나만 프로덕션에 적용한다.
//
// 자격증명 우선순위:
//   1) SUPABASE_ACCESS_TOKEN (sbp_...) → Management API REST (/database/query)
//   2) SUPABASE_DB_URL (postgresql://...) → pg 직결
//
// 사용 예:
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-0041.mjs
//
// 멱등: create table if not exists + create index if not exists + drop policy if exists.
// 순서 주의: 이 적용이 끝난 뒤에만 main 머지·푸시(=배포)할 것 — 역순이면 getIssues 가
//            매 요청 PGRST 오류를 로그에 남긴다(화면은 [] 폴백으로 생존, 0027 교훈).
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

const sql = readFileSync(join(root, 'supabase/migrations/0041_issues.sql'), 'utf8')

// 테이블 + RLS 정책 4개 + 복합 FK 제약 + identity 컬럼까지 확인.
const VERIFY = `select
  (select count(*) from pg_tables where schemaname='public' and tablename='issues') = 1
  and (select rowsecurity from pg_tables where schemaname='public' and tablename='issues')
  and (select count(*) from pg_policies where schemaname='public' and tablename='issues') = 4
  and (select count(*) from pg_constraint where conname='issues_assignee_project_fk') = 1
  and (select count(*) from information_schema.columns
       where table_schema='public' and table_name='issues' and column_name='issue_no'
       and is_identity='YES') = 1
  as ok`

// 정책 이름 4종이 정확한지 별도 확인(이름 드리프트 방지).
const POLICIES = `select array_agg(policyname order by policyname) as names
  from pg_policies where schemaname='public' and tablename='issues'`

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
  const pol = await run(POLICIES)
  return { ok: Array.isArray(ok) && ok[0]?.ok === true, names: Array.isArray(pol) ? pol[0]?.names : null }
}

async function viaPg(dbUrl) {
  const pg = await import('pg').catch(() => { throw new Error('pg 모듈 없음: npm i --no-save pg') })
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(sql)
    const r = await client.query(VERIFY)
    const p = await client.query(POLICIES)
    return { ok: r.rows[0]?.ok === true, names: p.rows[0]?.names ?? null }
  } finally { await client.end() }
}

const token = process.env.SUPABASE_ACCESS_TOKEN || readEnvLocal('SUPABASE_ACCESS_TOKEN')
const dbUrl = process.env.SUPABASE_DB_URL || readEnvLocal('SUPABASE_DB_URL')

if (!token && !dbUrl) {
  console.error('✗ 자격증명 없음. SUPABASE_ACCESS_TOKEN(sbp_...) 또는 SUPABASE_DB_URL 을 주입하세요.')
  process.exit(1)
}

try {
  const { ok, names } = token ? await viaApi(token) : await viaPg(dbUrl)
  if (ok) {
    console.log('✓ 0041 적용 완료 — issues 테이블 + RLS 활성 + 정책 4개 + 복합 FK + identity.')
    // Management API 는 array_agg 를 '{a,b,c}' 문자열로 돌려준다 — 배열/문자열 양쪽 수용.
    console.log(`  정책: ${Array.isArray(names) ? names.join(', ') : String(names ?? '')}`)
  } else {
    console.error('✗ 적용은 됐으나 검증 실패 — 테이블/RLS/정책/FK/identity 중 하나가 확인되지 않습니다.')
    process.exitCode = 1
  }
} catch (e) {
  console.error('✗ 적용 실패:', e.message)
  process.exitCode = 1
}
