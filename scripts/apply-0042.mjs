// ---------------------------------------------------------------------------
// 0042 (이슈 담당자 다중화 — issue_assignees 조인 테이블 + RLS 3정책 + 복합 FK 2개 + 백필)
// 단독 적용·검증기. db push(전체 이력 재조정) 대신 이 마이그레이션 하나만 프로덕션에 적용한다.
//
// 자격증명 우선순위:
//   1) SUPABASE_ACCESS_TOKEN (sbp_...) → Management API REST (/database/query)
//   2) SUPABASE_DB_URL (postgresql://...) → pg 직결
//
// 사용 예:
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-0042.mjs            # 적용 + 검증
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-0042.mjs --backfill # 백필만 재실행
//
// 멱등: create table/index if not exists + drop policy if exists + 백필 on conflict do nothing.
// 순서 주의(0042 헤더): 적용 → 곧바로 main 푸시(=배포) → 배포 Ready 확인 후 --backfill 1회 —
//            적용~배포 창에서 구 코드가 assignee_member_id 에 쓴 신규 지정을 조인 테이블로 회수한다.
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

const sql = readFileSync(join(root, 'supabase/migrations/0042_issue_multi_assignees.sql'), 'utf8')

// 0042 의 '4) 백필' 과 동일한 문장 — 배포 직후 창 회수 재실행용(멱등).
const BACKFILL = `insert into issue_assignees (issue_id, member_id, project_id)
select id, assignee_member_id, project_id
from issues
where assignee_member_id is not null
on conflict do nothing`

// 테이블 + RLS + 정책 3개 + 복합 FK 2개 + 전제 유니크 인덱스까지 확인.
const VERIFY = `select
  (select count(*) from pg_tables where schemaname='public' and tablename='issue_assignees') = 1
  and (select rowsecurity from pg_tables where schemaname='public' and tablename='issue_assignees')
  and (select count(*) from pg_policies where schemaname='public' and tablename='issue_assignees') = 3
  and (select count(*) from pg_constraint where conname='issue_assignees_issue_project_fk') = 1
  and (select count(*) from pg_constraint where conname='issue_assignees_member_project_fk') = 1
  and (select count(*) from pg_indexes where schemaname='public' and indexname='issues_id_project_uidx') = 1
  as ok`

// 백필 정합: 단일 담당자가 있는 이슈 수 <= 조인 행 보유 이슈 수(새 코드 운영 후엔 조인이 더 많을 수 있다).
const COUNTS = `select
  (select count(*) from issues where assignee_member_id is not null) as col_n,
  (select count(distinct issue_id) from issue_assignees) as join_n,
  (select count(*) from issue_assignees) as rows_n`

async function viaApi(token, backfillOnly) {
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
  if (backfillOnly) {
    await run(BACKFILL)
    const c = await run(COUNTS)
    return { ok: true, counts: Array.isArray(c) ? c[0] : null }
  }
  await run(sql)
  const ok = await run(VERIFY)
  const c = await run(COUNTS)
  return { ok: Array.isArray(ok) && ok[0]?.ok === true, counts: Array.isArray(c) ? c[0] : null }
}

const backfillOnly = process.argv.includes('--backfill')
const token = process.env.SUPABASE_ACCESS_TOKEN || readEnvLocal('SUPABASE_ACCESS_TOKEN')

if (!token) {
  console.error('✗ 자격증명 없음. SUPABASE_ACCESS_TOKEN(sbp_...)을 주입하세요.')
  process.exit(1)
}

try {
  const { ok, counts } = await viaApi(token, backfillOnly)
  if (backfillOnly) {
    console.log('✓ 0042 백필 재실행 완료.')
  } else if (ok) {
    console.log('✓ 0042 적용 완료 — issue_assignees + RLS 활성 + 정책 3개 + 복합 FK 2개 + 유니크 인덱스.')
  } else {
    console.error('✗ 적용은 됐으나 검증 실패 — 테이블/RLS/정책/FK/인덱스 중 하나가 확인되지 않습니다.')
    process.exitCode = 1
  }
  if (counts) {
    console.log(`  백필 정합: 컬럼 담당 이슈 ${counts.col_n} · 조인 담당 이슈 ${counts.join_n} · 조인 행 ${counts.rows_n}`)
  }
} catch (e) {
  console.error('✗ 적용 실패:', e.message)
  process.exitCode = 1
}
