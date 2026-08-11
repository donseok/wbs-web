// scripts/staging-sync.mjs
// 운영 → 스테이징 단방향 복제 (스펙 §6). 실행할 때마다 스테이징을 운영 사본으로 초기화(멱등).
// 운영 쪽은 읽기 전용 롤(staging_reader) DSN 만 사용한다 — 쓰기는 자격증명 수준에서 불가.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { PROD_REF, STAGING_REF } from './lib/staging.config.mjs'
import { assertStagingWritable, authTokenFixSql, maskDsn, parseDsnRef } from './lib/staging-core.mjs'

const cfg = { stagingRef: STAGING_REF, prodRef: PROD_REF }
const YES = process.argv.includes('--yes')
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts })
const keychain = (svc) => sh('security', ['find-generic-password', '-s', svc, '-w']).trim()
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }

// psql 실행 — 실패는 그대로 터뜨린다(에러 처리 3원칙: 삼키지 않는다).
const psql = (dsn, query) => sh('psql', [dsn, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-c', query]).trim()
const psqlFile = (dsn, file) => sh('psql', [dsn, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-f', file])

// 0) 클라이언트 버전 검사 (§6.1 — 17 미만 pg_dump 는 PG17 서버를 거부한다)
const ver = Number(sh('pg_dump', ['--version']).match(/(\d+)\./)?.[1] ?? 0)
if (ver < 17) die(`pg_dump ${ver} < 17 — brew install libpq 후 PATH 에 /opt/homebrew/opt/libpq/bin 추가`)

const PROD_RO = keychain('DFlow Prod Reader')
const STAGING = keychain('DFlow Staging DB')

// 1) 안전장치 — 쓰기 대상 allowlist + 읽기 원본이 운영인지 확인 (fail-closed)
assertStagingWritable(STAGING, cfg)
if (parseDsnRef(PROD_RO) !== PROD_REF) die('원본 DSN 이 운영 ref 가 아닙니다 — 키체인 "DFlow Prod Reader" 확인')

// 2) 대상 실조회 + 확인 (§6.2). 일시정지된 무료 프로젝트면 여기서 접속 실패한다.
let stagingDb
try { stagingDb = psql(STAGING, 'select current_database()') }
catch { die('스테이징 접속 실패 — 무료 티어 1주 미사용 일시정지일 수 있습니다. 대시보드에서 프로젝트를 복구한 뒤 재실행하세요.') }
console.log(`쓰기 대상: ${maskDsn(STAGING)} (ref ${STAGING_REF}, db ${stagingDb})`)
console.log(`읽기 원본: ${maskDsn(PROD_RO)} (ref ${PROD_REF})`)
if (!YES) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const a = await rl.question('스테이징을 운영 사본으로 초기화합니다. 계속하려면 "sync" 입력: ')
  rl.close()
  if (a.trim() !== 'sync') die('중단')
}

// 3) 활성 접속 검사 — UAT·병렬 리허설 진행 중 파괴 방지 (§6.1-1)
const active = Number(psql(STAGING, `select count(*) from pg_stat_activity
  where datname = current_database() and usename = 'authenticator'`))
if (active > 0 && !YES) die(`스테이징에 앱 접속 ${active}건 활성 — UAT 진행 중일 수 있습니다. 조율 후 --yes 로 재실행.`)

// 4) 동시 실행 잠금 — public 밖 스키마라 sync 의 drop 에 살아남는다
psql(STAGING, `create schema if not exists staging_ops;
  create table if not exists staging_ops.sync_lock(started_at timestamptz not null default now(), by text)`)
const locked = psql(STAGING, `select count(*) from staging_ops.sync_lock where started_at > now() - interval '30 min'`)
if (Number(locked) > 0) die('30분 내 시작된 sync/apply 가 있습니다 — 동시 실행 금지. 오래된 잠금이면 staging_ops.sync_lock 을 비우세요.')
psql(STAGING, `insert into staging_ops.sync_lock(by) values ('staging-sync')`)

const tmp = mkdtempSync(join(tmpdir(), 'dflow-sync-'))
try {
  // 5) 사전 점검 — 크기·확장·publication (§6.1-1)
  const sizeMb = Number(psql(PROD_RO, `select ceil(sum(pg_total_relation_size(c.oid))/1048576.0)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','auth') and c.relkind in ('r','i','t','m')`))
  console.log(`운영 public+auth 실측 ${sizeMb}MB`)
  if (sizeMb > 400) die(`무료 500MB 한도 임박(${sizeMb}MB) — 스펙 §2 전제 재검토 필요`)
  // [편차] 브리프는 확장을 무조건 schema extensions 에 생성했으나, 운영 실측상 vector 는 schema
  // public 에 설치돼 있다(pg_dump --schema=public 은 CREATE EXTENSION 문을 담지 않으므로,
  // 덤프가 참조하는 `public.vector` 타입이 미리 그 스키마에 존재해야 pg_restore 가 성공한다).
  // 확장별 실제 스키마를 운영에서 그대로 읽어둔다 — 적용은 7단계, public 재생성 직후에 한다
  // (지금 적용하면 잠시 뒤의 drop schema public cascade 가 확장까지 통째로 지워버린다).
  const extRows = psql(PROD_RO, `select coalesce(string_agg(e.extname||'@'||n.nspname, ','), '')
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname = any(array['vector','pg_trgm','pgcrypto','uuid-ossp'])`)
  const pubTables = psql(PROD_RO, `select coalesce(string_agg(quote_ident(schemaname)||'.'||quote_ident(tablename), ','), '')
    from pg_publication_tables where pubname='supabase_realtime'`)

  // 6) 덤프 (운영은 여기까지 — 전부 읽기)
  console.log('pg_dump public (schema+data, custom format)…')
  sh('pg_dump', [PROD_RO, '--schema=public', '-Fc', '--no-owner', '-f', join(tmp, 'public.dump')])
  console.log('pg_dump auth rows / storage buckets…')
  sh('pg_dump', [PROD_RO, '--data-only', '--column-inserts', '-t', 'auth.users', '-t', 'auth.identities', '-f', join(tmp, 'auth.sql')])
  sh('pg_dump', [PROD_RO, '--data-only', '--column-inserts', '-t', 'storage.buckets', '-f', join(tmp, 'buckets.sql')])

  // 7) 스테이징 재구성 — auth 먼저(public 이 auth.users 를 FK 참조, §6.1-3)
  // [편차] 브리프는 drop 후 즉시 create schema public + grant 를 실행하고 pg_restore 는 원본 그대로
  // 돌리는 순서였다. 실측 결과 두 가지가 막혔다:
  //  (a) PG15+ 의 `-n public` 덤프는 CREATE SCHEMA public 문을 자체 포함한다(pg_restore -l 로 확인).
  //      미리 만들어두면 pg_restore 가 "schema public already exists" 로 실패하고 이후 전 항목이
  //      연쇄 실패한다(실측 42건 에러).
  //  (b) 그렇다고 스키마 생성을 restore 에만 맡기면, restore 안에서 곧바로 이어지는
  //      `public.vector` 타입 참조(§ 위 확장 편차 주석)가 아직 확장을 안 만든 시점이라 실패한다.
  // 따라서 스키마는 우리가 직접 만들고, 그 직후(빈 public 상태에서) 확장을 설치한 다음,
  // pg_restore 에는 TOC 에서 "CREATE SCHEMA public" 항목만 제외한 목록을 넘긴다(-L). 곁들여
  // 우리 접속 롤(postgres)로는 실행 불가능한 `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin`
  // 3건(실측: "permission denied to change default privileges")도 같은 방식으로 제외한다 — 이
  // 문장들은 향후 supabase_admin 이 만들 객체에만 영향을 주므로 생략해도 이번 sync 결과와 무관하다.
  // GRANT/COMMENT(§6.1-2 요건)는 restore 직후에 명시 실행해 유지한다.
  console.log('스테이징 public 재생성…')
  psql(STAGING, 'drop schema if exists public cascade')
  psql(STAGING, 'create schema public')
  for (const row of extRows ? extRows.split(',') : []) {
    const [name, schema] = row.split('@')
    psql(STAGING, `create extension if not exists "${name}" with schema "${schema}"`)
  }
  console.log('auth 교체…')
  // TRUNCATE 는 auth 테이블 소유자(supabase_auth_admin) 권한이 필요할 수 있다.
  // GoTrue 의 FK 는 ON DELETE CASCADE 라 DELETE 로도 identities·sessions·refresh_tokens 가 연쇄 초기화된다(의도).
  psql(STAGING, 'delete from auth.users')
  psqlFile(STAGING, join(tmp, 'auth.sql'))
  psql(STAGING, authTokenFixSql())              // NULL 토큰 → '' (로그인 파손 함정, §6.1-3)
  console.log('public 복원…')
  const toc = sh('pg_restore', ['-l', join(tmp, 'public.dump')])
  const filteredTocPath = join(tmp, 'public.filtered.list')
  writeFileSync(filteredTocPath, toc.split('\n')
    .filter((line) => !/^\d+; \d+ \d+ SCHEMA - public pg_database_owner$/.test(line))
    .filter((line) => !/^\d+; \d+ \d+ DEFAULT ACL public DEFAULT PRIVILEGES FOR (SEQUENCES|FUNCTIONS|TABLES) supabase_admin$/.test(line))
    .join('\n'))
  sh('pg_restore', ['-d', STAGING, '--no-owner', '--role=postgres', '-L', filteredTocPath, join(tmp, 'public.dump')])
  console.log('public 스키마 GRANT 복원…')
  psql(STAGING, `grant usage, create on schema public to postgres, anon, authenticated, service_role;
    comment on schema public is 'standard public schema'`)
  console.log('storage.buckets 교체…')
  // [편차] 브리프에 없던 지뢰: storage 스키마에 `protect_delete` 트리거(supabase_storage_admin 소유)가
  // 걸려 있어 일반 DELETE 는 무조건 거부한다(실측: "Direct deletion from storage tables is not
  // allowed. Use the Storage API instead." / storage.protect_delete() 함수 실측 확인).
  // 세션 GUC storage.allow_delete_query='true' 를 같은 세션에서 먼저 세팅하면 트리거가 통과시킨다
  // (함수 소스 조회로 확인된 공식 우회 경로 — 임의 트리거 우회가 아니라 그 트리거가 제공하는
  // 의도된 스위치다).
  psql(STAGING, `set storage.allow_delete_query = 'true'; delete from storage.buckets`)  // objects 는 복사하지 않으므로 참조 잔존 없음
  psqlFile(STAGING, join(tmp, 'buckets.sql'))

  // 8) realtime publication 재등록 (§6.1-6) — drop cascade 로 멤버십이 사라졌다
  if (pubTables) {
    for (const t of pubTables.split(',')) {
      try { psql(STAGING, `alter publication supabase_realtime add table ${t}`) }
      catch { console.warn(`! publication 추가 실패(${t}) — 이미 등록됐거나 테이블 없음. 계속.`) }
    }
  }

  // 9) 행 수 대조 (§12-1)
  console.log('\n행 수 대조 (운영 → 스테이징):')
  for (const t of ['public.projects', 'public.wbs_items', 'public.minutes', 'public.issues', 'auth.users']) {
    const a = psql(PROD_RO, `select count(*) from ${t}`)
    const b = psql(STAGING, `select count(*) from ${t}`)
    console.log(`  ${t}: ${a} → ${b} ${a === b ? '✓' : '✗ 불일치'}`)
    if (a !== b) process.exitCode = 1
  }
  console.log(process.exitCode ? '\n✗ sync 완료했으나 대조 불일치 — 원인 확인 필요' : '\n✓ sync 완료')
} finally {
  rmSync(tmp, { recursive: true, force: true })
  try { psql(STAGING, 'delete from staging_ops.sync_lock') } catch { console.warn('! 잠금 해제 실패 — staging_ops.sync_lock 수동 확인') }
}
