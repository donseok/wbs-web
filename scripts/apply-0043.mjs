// ---------------------------------------------------------------------------
// 0043 (회의록 폴더 하이어라키 — ERP/MES/MDM 루트 + 시드 재배치 + 미분류 백필) 단독 적용·검증기.
// db push(전체 이력 재조정) 대신 이 마이그레이션 하나만 프로덕션에 적용한다.
//
// 자격증명 우선순위:
//   1) SUPABASE_ACCESS_TOKEN (sbp_...) → Management API REST (/database/query)
//   2) SUPABASE_DB_URL (postgresql://...) → pg 직결
//
// 사용 예:
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-0043.mjs
//
// 순서: 코드 배포 **전에** 적용할 것 — 신버전의 자동 편철·시드 보호 가드가 루트 5축을 전제한다.
// (역순이어도 폴백은 안전: 구버전 코드는 재편 트리를 그대로 렌더, 신버전은 루트 부재 시 null 폴백.
//  단, 코드 선배포 시 시드 루트 생성 전 창구에서 팀코드 동명 사용자 루트 선점 여지가 남는다.)
// 재실행 주의: 구조 단계는 멱등이나 4단계 백필은 재실행 시점의 미분류 잔량도 재편철한다 — 1회성.
// 시드 고정: 재배치·백필은 created_by is null(시드)만 대상 — 동명 사용자 폴더가 있으면 해당
// 단계가 no-op 으로 남고 아래 VERIFY 가 실패한다(하이재킹 대신 소리 내는 실패).
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

const sql = readFileSync(join(root, 'supabase/migrations/0043_minute_folder_hierarchy.sql'), 'utf8')

// 루트 5개(PMO/ERP/MES/가공/MDM) + ERP 자식 3 + MES 자식 5 + 미분류 잔량 0 확인.
const VERIFY = `select
  (select count(*) from minute_folders where parent_id is null and created_by is null) = 5
  and (select array_agg(name order by sort) from minute_folders where parent_id is null and created_by is null)
      = array['PMO','ERP','MES','가공','MDM']
  and (select count(*) from minute_folders c
       join minute_folders p on c.parent_id = p.id and p.name = 'ERP'
       where c.name in ('영업','구매','관리회계')) = 3
  and (select count(*) from minute_folders c
       join minute_folders p on c.parent_id = p.id and p.name = 'MES'
       where c.name in ('품질','생산계획','조업및표준화','물류','설비및L2')) = 5
  and (select count(*) from minutes where folder_id is null) = 0
  as ok`

// 눈 검증용 트리 스냅숏(루트 정렬순 + 자식 수 + 편철 건수).
const TREE = `select f.name, f.sort,
  (select count(*) from minute_folders c where c.parent_id = f.id) as children,
  (select count(*) from minutes m where m.folder_id = f.id) as minutes
  from minute_folders f where f.parent_id is null order by f.sort`

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
  const tree = await run(TREE)
  return { ok: Array.isArray(ok) && ok[0]?.ok === true, tree: Array.isArray(tree) ? tree : [] }
}

async function viaPg(dbUrl) {
  const pg = await import('pg').catch(() => { throw new Error('pg 모듈 없음: npm i --no-save pg') })
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(sql)
    const r = await client.query(VERIFY)
    const t = await client.query(TREE)
    return { ok: r.rows[0]?.ok === true, tree: t.rows }
  } finally { await client.end() }
}

const token = process.env.SUPABASE_ACCESS_TOKEN || readEnvLocal('SUPABASE_ACCESS_TOKEN')
const dbUrl = process.env.SUPABASE_DB_URL || readEnvLocal('SUPABASE_DB_URL')

if (!token && !dbUrl) {
  console.error('✗ 자격증명 없음. SUPABASE_ACCESS_TOKEN(sbp_...) 또는 SUPABASE_DB_URL 을 주입하세요.')
  process.exit(1)
}

try {
  const { ok, tree } = token ? await viaApi(token) : await viaPg(dbUrl)
  for (const row of tree) {
    console.log(`  ${row.name} (sort ${row.sort}) — 하위 ${row.children} · 회의록 ${row.minutes}건`)
  }
  if (ok) {
    console.log('✓ 0043 적용 완료 — 루트 5축(PMO/ERP/MES/가공/MDM) + 재배치 8 + 미분류 백필.')
  } else {
    console.error('✗ 적용은 됐으나 검증 실패 — 루트 구성/재배치/백필 중 하나가 확인되지 않습니다.')
    process.exitCode = 1
  }
} catch (e) {
  console.error('✗ 적용 실패:', e.message)
  process.exitCode = 1
}
