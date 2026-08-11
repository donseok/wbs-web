# 스테이징 환경(테스트계) 구축 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영 반영 전 실화면·실데이터 검증이 가능한 무료 스테이징 3계층(스테이징 Supabase + 스테이징 Vercel + 로컬 dev 기본값 전환)을 구축한다.

**Architecture:** Supabase 무료 조직에 스테이징 프로젝트를 만들고 운영→스테이징 단방향 sync 스크립트로 데이터 사본을 유지한다. Vercel에 같은 리포를 연결한 두 번째 프로젝트가 `staging` 브랜치를 상시 배포한다. 마이그레이션은 `db:apply --target staging` 리허설 후 운영 적용하며, pre-push 훅 G4가 이를 강제한다.

**Tech Stack:** Node .mjs 스크립트(리포 관례), pg_dump/psql 17+, Supabase Management API, vitest, POSIX sh(pre-push 훅).

**스펙:** `docs/superpowers/specs/2026-08-11-staging-environment-design.md` — 이 계획의 §번호 인용은 전부 스펙 기준.

## Global Constraints

- `git add -A` 금지 — 항상 파일명 명시(병렬 세션 dirty 파일 오염 방지).
- 커밋 메시지는 한국어, "무엇"보다 "왜". 이 계획의 산출물에는 마이그레이션 파일이 없다(G1 해당 없음).
- 운영 ref `rglfgrwwwwdqejohdnty` 에 대한 쓰기는 **db:apply `--target prod` 경로 하나로만**. sync·테스트가 운영에 쓰는 코드는 절대 금지(§6.2). D-CUBE 데이터 훼손 금지.
- 비밀값(DSN·키)은 키체인 보관, 평문 커밋 금지. ref 자체는 비밀이 아니다(공개 URL에 포함).
- `pg_dump`/`psql`은 **메이저 17 이상** 클라이언트 필수(§6.1 — 하위 버전은 server version mismatch로 거부됨).
- `.gitignore`는 `.env*`를 무시하고 `!.env.local.example`만 예외 — `.env.local.staging`/`.env.local.prod`는 자동으로 커밋 대상에서 빠진다(실측 확인 완료).
- 스테이징 ref는 Task 1에서 확정된다. 코드는 전부 `scripts/lib/staging.config.mjs`에서 읽는다 — ref 하드코딩 산재 금지.
- 페이즈 순서 강제: **A(인프라·데이터 경로) 완주 → B(파이프라인·훅) → C(화면 표시)**. 특히 G4 훅(Task 9)은 db:apply(Task 5)와 runbook(Task 10 초안) 실증 전에 켜면 모든 세션의 마이그레이션 push를 막는다(§13).

---

## 페이즈 A — 인프라와 데이터 경로

### Task 1: Supabase 스테이징 프로젝트 생성 + 좌표 파일

**Files:**
- Create: `scripts/lib/staging.config.mjs`

**Interfaces:**
- Produces: `PROD_REF: string`, `STAGING_REF: string`, `POOLER_HOST: string` — 이후 모든 태스크가 import.

**콘솔 수동 작업이 포함된 태스크다.** 브라우저 단계는 사용자(또는 Claude in Chrome)가 수행하고, 결과값(ref·풀러 호스트·키)을 받아 진행한다.

- [ ] **Step 1: Supabase 무료 조직 + 프로젝트 생성 (대시보드)**

supabase.com 대시보드에서:
1. 조직 드롭다운 → New organization → 이름 `dflow-staging`, 플랜 **Free**.
2. 새 조직에서 New project → 이름 `dflow-staging`, 리전 **ap-northeast-2 (Seoul)**, Postgres **17**, DB 비밀번호는 `openssl rand -base64 24` 결과 사용.
3. 생성 후 기록: **프로젝트 ref**(Settings→General), **anon key·service_role key**(Settings→API Keys), **세션 풀러 호스트**(Connect→Session pooler의 호스트 — `aws-0-ap-northeast-2.pooler.supabase.com` 형태, 화면 표기를 그대로 복사).

- [ ] **Step 2: 생성 직후 수동 체크리스트 적용 (스펙 §4.1 — sync로 복제되지 않는 설정)**

1. Authentication → URL Configuration: Site URL = `http://localhost:3000` (임시 — Task 7에서 스테이징 URL로 교체), Redirect URLs에 `http://localhost:3000/**` 추가.
2. **Auth 이메일 발송 차단**: Authentication → Rate Limits → 이메일 발송 관련 한도를 **0/시간**으로. Authentication → Sign In / Providers → Email에서 **Confirm email 비활성**(autoconfirm). 이유: auth.users에 실사용자 이메일이 복사되므로, 차단하지 않으면 스테이징의 비밀번호 재설정이 실사용자에게 진짜 메일을 보낸다.
3. SQL Editor에서 확장 활성화: `create extension if not exists vector with schema extensions;`

- [ ] **Step 3: 키체인 등록**

세션 풀러 DSN 형식은 `postgresql://postgres.<STAGING_REF>:<비밀번호>@<풀러호스트>:5432/postgres`.

```bash
security add-generic-password -U -s "DFlow Staging DB" -a dflow \
  -w 'postgresql://postgres.<STAGING_REF>:<PASSWORD>@<POOLER_HOST>:5432/postgres'
```

- [ ] **Step 4: 좌표 파일 작성**

```js
// scripts/lib/staging.config.mjs
// 스테이징/운영 프로젝트 좌표. ref 는 비밀이 아니다(프로젝트 URL 에 그대로 들어간다).
// 비밀값(DSN·키)은 키체인("DFlow Staging DB"/"DFlow Prod Reader")에만 둔다.
export const PROD_REF = 'rglfgrwwwwdqejohdnty'
export const STAGING_REF = '<Step 1 의 실제 ref>'
// Supavisor 세션 풀러(IPv4, 5432). 사용자명은 `<롤>.<ref>` 형식.
export const POOLER_HOST = '<Step 1 의 실제 풀러 호스트>'
```

- [ ] **Step 5: 접속 검증**

```bash
STAGING_DSN=$(security find-generic-password -s "DFlow Staging DB" -w)
psql "$STAGING_DSN" -c "select 1 as ok" \
  && psql "$STAGING_DSN" -c "select extname from pg_extension where extname='vector'"
```
Expected: `ok=1`, `vector` 1행. (psql 없으면 `brew install libpq` 후 `export PATH="/opt/homebrew/opt/libpq/bin:$PATH"`.)

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/staging.config.mjs
git commit -m "스테이징 좌표 파일 — ref/풀러 호스트를 단일 정본으로 (비밀값은 키체인)"
```

### Task 2: 운영 읽기 전용 롤 `staging_reader`

**Files:** 없음(운영 DB 1회 작업 + 키체인). 절차는 Task 10의 runbook에 기록된다.

**Interfaces:**
- Produces: 키체인 `"DFlow Prod Reader"` = 운영 읽기 전용 DSN. Task 4(sync)가 소비.

- [ ] **Step 1: 롤 생성 (Management API — 기존 레시피 경로)**

```bash
TOK=$(security find-generic-password -s "Supabase CLI" -a "supabase" -w | sed 's/^go-keyring-base64://' | base64 -d)
PW=$(openssl rand -base64 24 | tr -d '/+=')
curl -s -X POST "https://api.supabase.com/v1/projects/rglfgrwwwwdqejohdnty/database/query" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  --data "{\"query\":\"create role staging_reader login password '$PW'; grant pg_read_all_data to staging_reader;\"}"
```
(스키마 변경이지 데이터 훼손이 아니므로 D-CUBE 보호 규칙과 충돌하지 않는다. 롤백은 `drop role staging_reader;`.)

- [ ] **Step 2: 키체인 등록**

```bash
security add-generic-password -U -s "DFlow Prod Reader" -a dflow \
  -w "postgresql://staging_reader.rglfgrwwwwdqejohdnty:$PW@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres"
```
(운영 풀러 호스트는 운영 대시보드 Connect 화면 표기를 따른다. 커스텀 롤의 풀러 사용자명은 `staging_reader.<ref>`.)

- [ ] **Step 3: 읽기 가능·쓰기 불가 검증**

```bash
PROD_RO=$(security find-generic-password -s "DFlow Prod Reader" -w)
psql "$PROD_RO" -c "select count(*) from public.projects"          # 성공해야 함
psql "$PROD_RO" -c "create table public._writetest(i int)"         # 실패해야 함
```
Expected: count 성공, create는 `permission denied for schema public`.

풀러가 커스텀 롤을 거부하는 경우(드묾): 원인을 runbook에 기록하고 이 태스크를 중단·보고한다. postgres 롤 DSN으로의 대체는 "자격증명 수준 읽기 전용"(§6.2)을 무너뜨리므로 **사용자 승인 없이 하지 않는다**.

### Task 3: `staging-core` 순수 로직 + 테스트 (TDD)

**Files:**
- Create: `scripts/lib/staging-core.mjs`
- Test: `tests/lib/staging-core.test.ts`

**Interfaces:**
- Produces (Task 4·5·6이 소비):
  - `parseDsnRef(dsn: string): string | null` — DSN 사용자명 `<롤>.<ref>` 또는 호스트 `db.<ref>.supabase.co`에서 ref 추출.
  - `assertStagingWritable(dsn: string, cfg: {stagingRef: string, prodRef: string}): void` — 쓰기 대상이 스테이징이 아니면 throw(운영이면 전용 메시지).
  - `authTokenFixSql(): string` — confirmation_token 등 NULL→'' UPDATE문.
  - `detectEnvTarget(envText: string, cfg: {stagingRef: string, prodRef: string}): 'prod' | 'staging' | 'unknown'`
  - `maskDsn(dsn: string): string` — 비밀번호를 `***`로.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/lib/staging-core.test.ts
import { describe, it, expect } from 'vitest'
import {
  parseDsnRef, assertStagingWritable, authTokenFixSql, detectEnvTarget, maskDsn,
} from '../../scripts/lib/staging-core.mjs'

const cfg = { stagingRef: 'stgrefstgrefstgrefst', prodRef: 'rglfgrwwwwdqejohdnty' }
const dsn = (ref: string) => `postgresql://postgres.${ref}:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`

describe('parseDsnRef', () => {
  it('풀러 사용자명에서 ref를 뽑는다', () => {
    expect(parseDsnRef(dsn(cfg.stagingRef))).toBe(cfg.stagingRef)
    expect(parseDsnRef(`postgresql://staging_reader.${cfg.prodRef}:pw@h:5432/postgres`)).toBe(cfg.prodRef)
  })
  it('직결 호스트에서도 ref를 뽑는다', () => {
    expect(parseDsnRef(`postgresql://postgres:pw@db.${cfg.stagingRef}.supabase.co:5432/postgres`)).toBe(cfg.stagingRef)
  })
  it('못 찾으면 null', () => { expect(parseDsnRef('postgresql://x:y@localhost:5432/db')).toBeNull() })
})

describe('assertStagingWritable — 안전장치의 본체(§6.2)', () => {
  it('스테이징 ref면 통과', () => { expect(() => assertStagingWritable(dsn(cfg.stagingRef), cfg)).not.toThrow() })
  it('운영 ref면 무조건 거부', () => { expect(() => assertStagingWritable(dsn(cfg.prodRef), cfg)).toThrow(/운영/) })
  it('ref 판독 불가면 fail-closed', () => { expect(() => assertStagingWritable('postgresql://x:y@localhost/db', cfg)).toThrow() })
})

describe('authTokenFixSql', () => {
  it('공식 확인된 4개 토큰 컬럼을 전부 다룬다', () => {
    const sql = authTokenFixSql()
    for (const col of ['confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change']) {
      expect(sql).toContain(col)
    }
    expect(sql).toMatch(/coalesce/i)
  })
})

describe('detectEnvTarget', () => {
  it('운영 URL이면 prod', () => {
    expect(detectEnvTarget(`NEXT_PUBLIC_SUPABASE_URL=https://${cfg.prodRef}.supabase.co`, cfg)).toBe('prod')
  })
  it('스테이징 URL이면 staging', () => {
    expect(detectEnvTarget(`NEXT_PUBLIC_SUPABASE_URL=https://${cfg.stagingRef}.supabase.co`, cfg)).toBe('staging')
  })
  it('둘 다 아니면 unknown (fail-closed 판정은 호출부 몫)', () => {
    expect(detectEnvTarget('NEXT_PUBLIC_SUPABASE_URL=https://other.supabase.co', cfg)).toBe('unknown')
  })
})

describe('maskDsn', () => {
  it('비밀번호를 가린다', () => {
    expect(maskDsn(dsn(cfg.stagingRef))).not.toContain(':pw@')
    expect(maskDsn(dsn(cfg.stagingRef))).toContain('***')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/staging-core.test.ts`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현**

```js
// scripts/lib/staging-core.mjs
// staging-sync / db-apply / predev 가드가 공유하는 순수 로직.
// 부작용(키체인·psql·fetch)은 여기 두지 않는다 — vitest 로 검증하기 위해서다.

export function parseDsnRef(dsn) {
  const user = dsn.match(/^postgresql:\/\/([^:@/]+)[:@]/)?.[1] ?? ''
  const byUser = user.match(/^[a-z_]+\.([a-z0-9]{20})$/)?.[1]
  if (byUser) return byUser
  const byHost = dsn.match(/@db\.([a-z0-9]{20})\.supabase\.co/)?.[1]
  return byHost ?? null
}

export function assertStagingWritable(dsn, { stagingRef, prodRef }) {
  const ref = parseDsnRef(dsn)
  if (ref === prodRef) throw new Error(`쓰기 대상이 운영(${prodRef})입니다 — staging:sync 는 운영에 쓰지 않습니다. 중단.`)
  if (ref !== stagingRef) throw new Error(`쓰기 대상 ref 판독 실패 또는 allowlist 밖(${ref ?? '판독불가'}) — fail-closed 중단.`)
}

// NULL 토큰 컬럼이면 로그인 시 "Database error querying schema" (공식 트러블슈팅 확인, 스펙 §6.1-3).
export function authTokenFixSql() {
  return `update auth.users set
    confirmation_token = coalesce(confirmation_token, ''),
    recovery_token = coalesce(recovery_token, ''),
    email_change_token_new = coalesce(email_change_token_new, ''),
    email_change = coalesce(email_change, '')`
}

export function detectEnvTarget(envText, { stagingRef, prodRef }) {
  const url = envText.match(/^\s*NEXT_PUBLIC_SUPABASE_URL\s*=\s*(\S+)/m)?.[1] ?? ''
  if (url.includes(prodRef)) return 'prod'
  if (url.includes(stagingRef)) return 'staging'
  return 'unknown'
}

export function maskDsn(dsn) {
  return dsn.replace(/(:\/\/[^:@/]+:)[^@]+@/, '$1***@')
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/staging-core.test.ts`
Expected: PASS 전건.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/staging-core.mjs tests/lib/staging-core.test.ts
git commit -m "스테이징 안전장치 코어 — 운영 쓰기 거부·NULL 토큰 함정을 순수 함수로 (sync 본체보다 먼저 검증)"
```

### Task 4: `staging:sync` — 운영→스테이징 단방향 복제

**Files:**
- Create: `scripts/staging-sync.mjs`
- Modify: `package.json` (scripts에 `"staging:sync": "node scripts/staging-sync.mjs"` 추가)

**Interfaces:**
- Consumes: Task 1 config, Task 3 core(`assertStagingWritable`, `authTokenFixSql`, `maskDsn`), 키체인 "DFlow Prod Reader"/"DFlow Staging DB".
- Produces: CLI `npm run staging:sync [-- --yes]`. 스테이징 `staging_ops.sync_lock` 테이블(Task 5의 db-apply staging 가드가 조회).

- [ ] **Step 1: 구현**

```js
// scripts/staging-sync.mjs
// 운영 → 스테이징 단방향 복제 (스펙 §6). 실행할 때마다 스테이징을 운영 사본으로 초기화(멱등).
// 운영 쪽은 읽기 전용 롤(staging_reader) DSN 만 사용한다 — 쓰기는 자격증명 수준에서 불가.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
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
  const exts = psql(PROD_RO, `select string_agg(extname, ',') from pg_extension`).split(',')
  for (const e of ['vector', 'pg_trgm', 'pgcrypto', 'uuid-ossp']) {
    if (exts.includes(e)) psql(STAGING, `create extension if not exists "${e}" with schema extensions`)
  }
  const pubTables = psql(PROD_RO, `select coalesce(string_agg(quote_ident(schemaname)||'.'||quote_ident(tablename), ','), '')
    from pg_publication_tables where pubname='supabase_realtime'`)

  // 6) 덤프 (운영은 여기까지 — 전부 읽기)
  console.log('pg_dump public (schema+data, custom format)…')
  sh('pg_dump', [PROD_RO, '--schema=public', '-Fc', '--no-owner', '-f', join(tmp, 'public.dump')])
  console.log('pg_dump auth rows / storage buckets…')
  sh('pg_dump', [PROD_RO, '--data-only', '--column-inserts', '-t', 'auth.users', '-t', 'auth.identities', '-f', join(tmp, 'auth.sql')])
  sh('pg_dump', [PROD_RO, '--data-only', '--column-inserts', '-t', 'storage.buckets', '-f', join(tmp, 'buckets.sql')])

  // 7) 스테이징 재구성 — auth 먼저(public 이 auth.users 를 FK 참조, §6.1-3)
  console.log('스테이징 public 재생성…')
  psql(STAGING, `drop schema if exists public cascade; create schema public;
    grant usage, create on schema public to postgres, anon, authenticated, service_role;
    comment on schema public is 'standard public schema'`)
  console.log('auth 교체…')
  // TRUNCATE 는 auth 테이블 소유자(supabase_auth_admin) 권한이 필요할 수 있다.
  // GoTrue 의 FK 는 ON DELETE CASCADE 라 DELETE 로도 identities·sessions·refresh_tokens 가 연쇄 초기화된다(의도).
  psql(STAGING, 'delete from auth.users')
  psqlFile(STAGING, join(tmp, 'auth.sql'))
  psql(STAGING, authTokenFixSql())              // NULL 토큰 → '' (로그인 파손 함정, §6.1-3)
  console.log('public 복원…')
  sh('pg_restore', ['-d', STAGING, '--no-owner', '--role=postgres', join(tmp, 'public.dump')])
  console.log('storage.buckets 교체…')
  psql(STAGING, 'delete from storage.buckets')  // objects 는 복사하지 않으므로 참조 잔존 없음
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
```

- [ ] **Step 2: package.json 스크립트 등록**

`"mark:good"` 줄 아래에 추가: `"staging:sync": "node scripts/staging-sync.mjs",`

- [ ] **Step 3: 안전장치 실증 — 운영 ref 거부 (§12-6)**

키체인을 건드리지 않고 검증한다: 임시로 `STAGING_REF`를 운영 ref로 바꾼 사본 테스트가 아니라, **이미 Task 3 vitest가 거부 로직을 검증**했으므로 여기서는 통합 한 줄만 확인:

```bash
node -e "
import('./scripts/lib/staging-core.mjs').then(m => {
  try { m.assertStagingWritable('postgresql://postgres.rglfgrwwwwdqejohdnty:x@h:5432/postgres', { stagingRef: 'x'.repeat(20), prodRef: 'rglfgrwwwwdqejohdnty' }); console.log('통과되면 안 됨'); process.exit(1) }
  catch (e) { console.log('✓ 운영 거부:', e.message) }
})"
```
Expected: `✓ 운영 거부: …운영…`

- [ ] **Step 4: 실제 sync 1회 실행 (§12-1)**

```bash
npm run staging:sync
```
Expected: 확인 프롬프트 → 행 수 대조 전건 ✓, exit 0. 실패 시 메시지를 그대로 보고(삼키지 않는다).

- [ ] **Step 5: Commit**

```bash
git add scripts/staging-sync.mjs package.json
git commit -m "staging:sync — 운영 사본 단방향 복제 (읽기전용 롤·allowlist·NULL 토큰 보정·활성 접속 가드)"
```

### Task 5: `db:apply` — 마이그레이션 적용 스크립트화

**Files:**
- Create: `scripts/db-apply.mjs`
- Modify: `package.json` (`"db:apply": "node scripts/db-apply.mjs"` 추가)

**Interfaces:**
- Consumes: Task 1 config, 키체인 "Supabase CLI"(Management 토큰, `go-keyring-base64:` 인코딩).
- Produces: CLI `npm run db:apply -- <sql파일> --target staging|prod`. 이후 모든 마이그레이션 작업·G4 절차(§7.1)가 사용.

- [ ] **Step 1: 구현**

```js
// scripts/db-apply.mjs
// 마이그레이션 적용 — 기존 Management API 레시피(apply-0028 계보)의 범용판 (스펙 §7).
// 규칙: staging 리허설 → 검증 → Staging-verified 트레일러 커밋 → prod 적용 → main push.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { PROD_REF, STAGING_REF } from './lib/staging.config.mjs'

const args = process.argv.slice(2)
const file = args.find(a => !a.startsWith('--'))
const target = args[args.indexOf('--target') + 1]
const REFS = { staging: STAGING_REF, prod: PROD_REF }   // allowlist — 이 둘뿐
if (!file || !REFS[target]) {
  console.error('사용법: npm run db:apply -- <sql파일> --target staging|prod')
  process.exit(1)
}
const ref = REFS[target]
const sql = readFileSync(file, 'utf8')

const raw = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-a', 'supabase', '-w'], { encoding: 'utf8' }).trim()
const token = raw.startsWith('go-keyring-base64:') ? Buffer.from(raw.slice('go-keyring-base64:'.length), 'base64').toString() : raw

const api = async (path, init) => {
  const res = await fetch(`https://api.supabase.com/v1${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`)
  return res.json()
}
const query = (q) => api(`/projects/${ref}/database/query`, { method: 'POST', body: JSON.stringify({ query: q }) })

// 대상 프로젝트명 실조회 — "어디에 적용하는지"를 이름으로 확인시킨다 (§7.1 안전장치)
const proj = await api(`/projects/${ref}`, { method: 'GET' })
console.log(`대상: ${proj.name} (${ref}) / 파일: ${file}`)

if (target === 'prod') {
  // prod 는 --yes 로 생략 불가 — 명시적 확인 문자열만 받는다
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const a = await rl.question(`운영 적용입니다. 스테이징 리허설을 마쳤습니까? 계속하려면 "${ref}" 입력: `)
  rl.close()
  if (a.trim() !== ref) { console.error('중단'); process.exit(1) }
} else {
  // staging 은 sync 와의 동시 실행만 배제 (§7.1)
  const lock = await query(`select count(*)::int as n from staging_ops.sync_lock where started_at > now() - interval '30 min'`)
  if (lock[0]?.n > 0) { console.error('✗ staging:sync 진행 중 — 완료 후 재실행'); process.exit(1) }
}

await query(sql)
console.log(`✓ ${target} 적용 완료 — 검증 쿼리(스키마 조회 등)로 반드시 확인할 것`)
```

- [ ] **Step 2: package.json 등록**

`"staging:sync"` 줄 아래: `"db:apply": "node scripts/db-apply.mjs",`

- [ ] **Step 3: 더미 마이그레이션으로 staging 왕복 검증 (§12-4)**

```bash
printf 'create table public._staging_rehearsal_probe(i int);' > /tmp/probe.sql
npm run db:apply -- /tmp/probe.sql --target staging          # 프로젝트명 표기 확인
printf 'drop table public._staging_rehearsal_probe;' > /tmp/probe-rollback.sql
npm run db:apply -- /tmp/probe-rollback.sql --target staging
```
Expected: 두 번 다 `✓ staging 적용 완료`, 대상 이름이 `dflow-staging`으로 표기. **prod 경로는 여기서 실행하지 않는다**(다음 실마이그레이션 때 확인 문자열 절차를 실사용).

- [ ] **Step 4: Commit**

```bash
git add scripts/db-apply.mjs package.json
git commit -m "db:apply — 마이그레이션 적용 파라미터화 (staging 리허설 경로 신설, prod 는 확인 문자열 필수)"
```

### Task 6: 로컬 dev 기본값 전환 — env 스왑 + predev 가드

**Files:**
- Create: `scripts/env-swap.mjs`, `scripts/check-env-target.mjs`
- Create(로컬 전용, 커밋 안 됨): `.env.local.staging`, `.env.local.prod`
- Modify: `package.json`, `.env.local.example`

**Interfaces:**
- Consumes: Task 3 `detectEnvTarget`, Task 1 config.
- Produces: `npm run env:staging` / `npm run env:prod`; `npm run dev`의 `predev` 가드(운영 대상이면 차단, `FORCE_PROD_DEV=1`로만 통과).

- [ ] **Step 1: 스왑·가드 스크립트 구현**

```js
// scripts/env-swap.mjs — .env.local 을 스테이징/운영 소스로 교체한다.
// ⚠ 파일 교체는 이 PC 의 모든 병렬 세션에 즉시 영향을 준다 (CLAUDE.md 명시).
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { PROD_REF, STAGING_REF } from './lib/staging.config.mjs'
import { detectEnvTarget } from './lib/staging-core.mjs'

const target = process.argv[2]
if (!['staging', 'prod'].includes(target)) { console.error('사용법: npm run env:staging | env:prod'); process.exit(1) }
const src = `.env.local.${target}`
if (!existsSync(src)) { console.error(`✗ ${src} 없음 — .env.local.example 을 참고해 만들고 값 채우기`); process.exit(1) }
copyFileSync(src, '.env.local')
const got = detectEnvTarget(readFileSync('.env.local', 'utf8'), { stagingRef: STAGING_REF, prodRef: PROD_REF })
if (got !== target) { console.error(`✗ 전환 검증 실패 — .env.local 이 ${got} 을 가리킴`); process.exit(1) }
console.log(`✓ .env.local → ${target} (${target === 'prod' ? '⚠ 운영 DB — 작업 후 npm run env:staging 복귀' : '스테이징'})`)
```

```js
// scripts/check-env-target.mjs — predev 가드. 운영 DB 를 향한 dev 서버를 무심코 띄우지 못하게 한다.
// 의도적 운영 접속은 FORCE_PROD_DEV=1 로만 통과 (스펙 §9 — 예절이 아니라 기계 가드).
import { readFileSync } from 'node:fs'
import { PROD_REF, STAGING_REF } from './lib/staging.config.mjs'
import { detectEnvTarget } from './lib/staging-core.mjs'

let text = ''
try { text = readFileSync('.env.local', 'utf8') } catch { /* 없으면 unknown 처리 */ }
const target = detectEnvTarget(text, { stagingRef: STAGING_REF, prodRef: PROD_REF })
if (target === 'prod' && process.env.FORCE_PROD_DEV !== '1') {
  console.error('\n████ 차단: .env.local 이 운영 DB 를 가리킵니다 ████')
  console.error('  스테이징으로: npm run env:staging')
  console.error('  의도적 운영 접속: FORCE_PROD_DEV=1 npm run dev (D-CUBE 데이터 훼손 금지)\n')
  process.exit(1)
}
if (target === 'unknown') console.warn('! .env.local 대상 판독 불가 — 스테이징/운영 어느 쪽도 아님 (진행은 허용)')
else console.log(`dev 대상: ${target}`)
```

- [ ] **Step 2: package.json 등록**

```json
"predev": "node scripts/check-env-target.mjs",
"env:staging": "node scripts/env-swap.mjs staging",
"env:prod": "node scripts/env-swap.mjs prod",
```
(`predev`는 npm 표준 pre 훅 — `npm run dev` 전에 자동 실행된다.)

- [ ] **Step 3: 소스 env 파일 생성 (로컬 작업, 커밋 안 됨 — `.env*` gitignore)**

1. `cp .env.local .env.local.prod` — 첫 줄에 `# ⚠ 운영(rglfgrwwwwdqejohdnty) — 사용 후 npm run env:staging 복귀` 주석 추가.
2. `.env.local.staging` 작성: `.env.local.prod` 복사 후 `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`/`SERVICE_ROLE_KEY`를 스테이징 값으로, `GEMINI_API_KEY`는 **신규 발급한 스테이징용 무료 키**로(발급: https://aistudio.google.com/app/apikey — §4.4, 운영 RPM 잠식 방지), 첫 줄 주석 `# 스테이징(<STAGING_REF>)`.
3. `SUPABASE_DB_URL`은 스테이징 파일에서 **제거**(운영 직결 URL 잔존 방지).

- [ ] **Step 4: .env.local.example 안내 갱신**

파일 최상단(1~3행 SUPABASE 블록 위)에 추가:

```
# ── 환경 대상 ────────────────────────────────────────────────────
# 로컬 기본값은 "스테이징"이다. .env.local.staging / .env.local.prod 를 만들어 두고
# npm run env:staging / env:prod 로 전환한다(파일 교체 — 이 PC 의 모든 세션에 영향).
# 운영을 향한 npm run dev 는 predev 가드가 차단한다(FORCE_PROD_DEV=1 로만 통과).
```

- [ ] **Step 5: 가드·스왑 동작 검증 (§12-7)**

```bash
npm run env:prod && npm run dev    # → predev 차단 메시지 + exit 1 확인 (dev 미기동)
npm run env:staging && npm run dev # → "dev 대상: staging" 후 정상 기동, http://localhost:3000 로그인
```
Expected: 순서대로 차단, 기동+본인 계정 로그인 성공(스테이징 사본, §12-1 로그인 선검증). 확인 후 dev 종료.

- [ ] **Step 6: Commit**

```bash
git add scripts/env-swap.mjs scripts/check-env-target.mjs package.json .env.local.example
git commit -m "로컬 dev 기본값을 스테이징으로 — env 스왑 + predev 운영 차단 가드 (D-CUBE 상시 노출 종료)"
```

---

## 페이즈 B — 배포 파이프라인과 훅 (A 완주 후에만)

### Task 7: `staging` 브랜치 + Vercel 스테이징 프로젝트

**Files:** 리포 변경 없음(브랜치 생성 + 콘솔 작업). 검증 §12-2·3.

**Interfaces:**
- Produces: 상시 스테이징 URL(예: `https://dflow-staging.vercel.app`) — Task 12·13과 이후 모든 검증 흐름이 사용. `staging` 브랜치.

- [ ] **Step 1: 브랜치 생성·push**

```bash
git fetch origin && git switch -c staging origin/main && git push -u origin staging && git switch main
```

- [ ] **Step 2: Vercel 프로젝트 생성 (콘솔)**

1. Vercel → Add New → Project → 같은 GitHub 리포 import, 이름 `dflow-staging`.
2. Settings → Environments → Production → Branch Tracking = `staging`.
3. Settings → Git → **Ignored Build Step** = Custom: `[ "$VERCEL_GIT_COMMIT_REF" != "staging" ]`
   (staging 외 브랜치는 exit 0 → 빌드 스킵. 같은 리포 이중 빌드로 Hobby 동시 빌드 1개를 낭비하지 않기 위함, §4.2.)

- [ ] **Step 3: 환경변수 등록 (Production 스코프, §4.4 매트릭스)**

| 변수 | 값 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<STAGING_REF>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 스테이징 anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | 스테이징 service_role key (NEXT_PUBLIC_ 접두 금지) |
| `GEMINI_API_KEY` | 스테이징용 신규 무료 키 (Task 6-Step 3에서 발급한 것) |
| `NEXT_PUBLIC_APP_URL` | `https://dflow-staging.vercel.app` |
| `STAGING` | `1` |
| `CHAT_V2_ENABLED` 등 기능 플래그 | **운영 Vercel env 목록을 열어 그대로 복사** — 단 `SMTP_USER`/`SMTP_PASS`/`MINUTES_API_ENABLED`/`MINUTES_API_SECRET`은 **등록하지 않는다**(§4.4 차단 항목) |

- [ ] **Step 4: 배포 트리거 + Supabase Site URL 교체**

1. Deployments에서 `staging` 브랜치 배포 확인(자동 안 뜨면 빈 커밋 push: `git switch staging && git commit --allow-empty -m "스테이징 최초 배포 트리거" && git push && git switch main`).
2. 스테이징 Supabase → Authentication → URL Configuration: Site URL을 실제 스테이징 URL로 교체, Redirect URLs에 `https://dflow-staging.vercel.app/**` 추가(§14 — Task 1의 임시값 청산).

- [ ] **Step 5: 검증 (§12-2·3)**

```bash
curl -sI https://dflow-staging.vercel.app/login | head -3   # 200 확인
```
브라우저: 스테이징 URL 로그인(본인 계정 — sync 사본) → 대시보드·WBS·회의록·이슈 화면 조회. 로그인 화면에서 **비밀번호 재설정 시도 → 실메일이 오지 않는지 확인**(Auth 발송 차단 검증).

### Task 8: 기존 Vercel 프로젝트 Preview env 연결

**Files:** 없음(콘솔). 검증 §12-8.

- [ ] **Step 1: Preview 스코프 env 등록**

기존(운영) Vercel 프로젝트 → Settings → Environment Variables → **Preview** 스코프에 Task 7-Step 3과 동일한 값 등록(스테이징 Supabase URL/키·GEMINI 스테이징 키·`STAGING=1`·`NEXT_PUBLIC_APP_URL`은 비움). SMTP/MINUTES 계열 제외 동일.

- [ ] **Step 2: Preview 로그인 검증**

```bash
git switch -c probe/preview-env && git commit --allow-empty -m "Preview env 검증용" && git push -u origin HEAD
```
Vercel이 만든 Preview URL 접속 → **로그인 성공** 확인(기존엔 env 0건이라 불가능했다 — G2 실효화의 근거). 확인 후:

```bash
git switch main && git push origin --delete probe/preview-env && git branch -D probe/preview-env
```

### Task 9: pre-push 훅 G4 — 마이그레이션 스테이징 리허설 강제

**Files:**
- Modify: `.githooks/pre-push` (G2 블록의 `fi`(182행 부근, `remote_ref = refs/heads/main` 분기 내부) 바로 앞에 G4 블록 삽입, 헤더 주석 갱신)

**Interfaces:**
- Consumes: 훅 기존 관례 — `$GIT`, `evil_files()`, `$msgs`/`$fail`, fail-closed 패턴, `SKIP_GUARD`.
- Produces: `Staging-verified:` 트레일러 계약(§7.1·7.2) — CLAUDE.md(Task 11)·runbook(Task 10)이 인용.

- [ ] **Step 1: G4 블록 삽입**

G2의 닫는 `fi` 다음, 바깥 `fi`(main 분기 종료) 앞에:

```sh
    # ── G4. 스테이징 DB 리허설 없이 마이그레이션이 main 으로 가는가 ────────
    # 범위가 G1·G2(--not --remotes)와 다른 이유: 표준 흐름에서 마이그레이션 커밋은
    # origin/staging 에 먼저 올라가므로 --not --remotes 로는 main push 시점에 이미
    # 검사망을 빠져나가 있다. 여기서는 "origin/main 에 새로 들어가는 커밋"을 본다.
    # 검사 단위는 커밋이 아니라 push 범위 — 이미 원격에 있는 커밋은 amend 가 불가능해
    # 커밋 단위 강제는 '고칠 수 없는 차단 → SKIP_GUARD 상습화'를 낳는다(G2 헤더 참조).
    # 컷오프 0072: 이미 프로덕션에 적용된 채 병렬 세션에 남아 있는 0069~0071 을
    # 소급 차단하지 않는다.
    if ! g4_range=$($GIT rev-list "$local_oid" --not "refs/remotes/$REMOTE/main" 2>&1); then
      {
        printf '%sG4 범위 계산 실패 — 가드를 신뢰할 수 없습니다%s\n' "$RED" "$OFF"
        printf '   %s%s%s\n' "$DIM" "$g4_range" "$OFF"
        printf '   `git fetch %s` 후 다시 시도하세요.\n' "$REMOTE"
      } >> "$msgs"
      fail=1
    elif [ -n "$g4_range" ]; then
      # 0072 이상 마이그레이션을 건드린 일반 커밋 ("supabase/migrations/" = 20자, 번호는 21~24열)
      g4_hits=$(
        printf '%s\n' "$g4_range" \
          | $GIT log --no-walk --no-merges --name-only --format='%x01%H%x02%s' --stdin 2>/dev/null \
          | awk '
            /^\001/ { if (sha != "" && hit) print sha "\t" subj
                      split(substr($0,2), p, "\002"); sha = p[1]; subj = p[2]; hit = 0; next }
            /^supabase\/migrations\/[0-9][0-9][0-9][0-9]/ { if (substr($0,21,4) + 0 >= 72) hit = 1 }
            END { if (sha != "" && hit) print sha "\t" subj }
          '
      )
      # 머지 커밋 자체 변경(evil merge)도 같은 기준으로 (기존 evil_files 재사용)
      g4_merges=$($GIT rev-list --merges "$local_oid" --not "refs/remotes/$REMOTE/main" 2>/dev/null)
      for sha in $g4_merges; do
        files=$(evil_files "$sha")
        [ -z "$files" ] && continue
        hit=$(printf '%s\n' "$files" | awk '/^supabase\/migrations\/[0-9][0-9][0-9][0-9]/ { if (substr($0,21,4) + 0 >= 72) { print "y"; exit } }')
        [ -z "$hit" ] && continue
        g4_hits="${g4_hits}${g4_hits:+
}$sha	$($GIT log -1 --pretty=%s "$sha") [머지 커밋 자체 변경]"
      done

      if [ -n "$g4_hits" ]; then
        # push 범위 내 아무 커밋의 Staging-verified 트레일러로 통과 (빈 커밋도 인정 — 복구 경로)
        g4_ok=$(printf '%s\n' "$g4_range" \
          | $GIT log --no-walk --format='%(trailers:key=Staging-verified,valueonly)' --stdin 2>/dev/null \
          | tr -d ' \t\r\n')
        if [ -z "$g4_ok" ]; then
          {
            printf '%sG4 스테이징 리허설 기록 없이 마이그레이션이 main 으로 갑니다%s\n' "$RED" "$OFF"
            printf '%s\n' "$g4_hits" | while IFS="$(printf '\t')" read -r sha subj; do
              printf '   %s %s\n' "$(echo "$sha" | cut -c1-7)" "$subj"
            done
            printf '   순서: staging:sync → db:apply --target staging → 검증 → prod (docs/runbook-staging.md)\n\n'
            printf '   %s리허설을 마쳤다면 기록을 남기세요(커밋 시점에, 또는 빈 커밋으로):%s\n' "$GRN" "$OFF"
            printf '     git commit --allow-empty -m "마이그레이션 스테이징 리허설" --trailer "Staging-verified: $(date +%%F) db 리허설 통과"\n'
          } >> "$msgs"
          fail=1
        fi
      fi
    fi
```

훅 헤더의 검사 표 주석(23행 부근 "우회:" 위)에 한 줄 추가: `#   G4: 0072+ 마이그레이션의 main 직행 차단(Staging-verified 트레일러, 범위 단위, --not origin/main)`

- [ ] **Step 2: 픽스처 리허설로 훅 검증**

스크래치 디렉터리에서 가짜 리포로 4개 시나리오를 확인한다:

```bash
cd "$SCRATCHPAD" && rm -rf g4test && mkdir g4test && cd g4test
git init -q --bare origin.git
git clone -q origin.git work && cd work
git commit -q --allow-empty -m init && git push -q origin main
cp -r /Users/jerry/wbs-web/.githooks .githooks && git config core.hooksPath .githooks
mkdir -p supabase/migrations
# ① 트레일러 없는 0072 → 차단
echo 'select 1;' > supabase/migrations/0072_probe.sql
git add supabase/migrations/0072_probe.sql && git commit -q -m "probe"
git push origin main; echo "exit=$?"                      # 기대: G4 메시지 + exit 1
# ② 빈 커밋 트레일러 → 통과 (복구 경로)
git commit -q --allow-empty -m "리허설" --trailer "Staging-verified: 2026-08-11 db 리허설 통과"
git push -q origin main; echo "exit=$?"                   # 기대: 0
# ③ 컷오프 미만(0069) → G4 미발동
echo 'select 1;' > supabase/migrations/0069_old.sql
git add supabase/migrations/0069_old.sql && git commit -q -m "구세대"
git push -q origin main; echo "exit=$?"                   # 기대: 0
# ④ staging 경유 커밋도 main push 때 검사되는가 (--not origin/main 의 존재 이유)
git switch -qc staging && echo 'select 2;' > supabase/migrations/0073_p2.sql
git add supabase/migrations/0073_p2.sql && git commit -q -m "p2" && git push -q origin staging
git switch -q main && git merge -q staging
git push origin main; echo "exit=$?"                      # 기대: G4 차단(트레일러 없음) — --not --remotes 였다면 통과했을 것
```
Expected: 주석의 기대값 그대로. ①·④ 차단 메시지에 복구 명령이 보일 것.

- [ ] **Step 3: G1·G2·G3 회귀 확인**

```bash
cd /Users/jerry/wbs-web && npx vitest run tests/css/breakpoint-safety-net.test.ts
```
Expected: PASS (G3 경로 무손상). G1·G2는 Step 2 픽스처에서 훅이 정상 종료(문법 오류 없음)한 것으로 무손상 확인.

- [ ] **Step 4: Commit**

```bash
git add .githooks/pre-push
git commit -m "훅 G4 — 마이그레이션 스테이징 리허설 강제 (범위 단위 트레일러·0072 컷오프·evil merge 포함, --not origin/main 인 이유는 주석에)"
```

### Task 10: `docs/runbook-staging.md`

**Files:**
- Create: `docs/runbook-staging.md`

- [ ] **Step 1: 작성**

다음 절 구성으로, 스펙과 Task 1~9의 **실측값**(ref·URL·키체인 항목명)을 채워 작성한다:

```markdown
# 스테이징 운영 runbook

## 좌표
- 스테이징 Supabase: <STAGING_REF> (무료 조직 dflow-staging) / 스테이징 URL: https://dflow-staging.vercel.app
- 키체인: "DFlow Staging DB"(스테이징 DSN) · "DFlow Prod Reader"(운영 읽기 전용 staging_reader DSN) · "Supabase CLI"(Management 토큰)
- 좌표 정본: scripts/lib/staging.config.mjs

## 일상 흐름
작업 → staging 머지 & push(전에 origin/main back-merge) → 스테이징 자동 배포 → 검증/UAT
→ main 머지 & push → smoke:prod → mark:good

## 데이터 동기화
npm run staging:sync — 운영→스테이징 단방향, 실행마다 초기화. UAT 진행 중 금지(활성 접속 가드가 묻는다).
첨부파일 실체는 복사되지 않음(404 정상). 실행 전 대규모 테스트·리허설 일정과 조율.

## 마이그레이션 (G4 와 한 몸)
① npm run staging:sync ② npm run db:apply -- <파일> --target staging (커밋 전, 워킹트리 파일로)
③ 검증 후 커밋에 --trailer "Staging-verified: YYYY-MM-DD db 리허설 통과" ④ staging push → 앱 검증
⑤ npm run db:apply -- <파일> --target prod ⑥ main push. 트레일러를 빠뜨렸으면 빈 커밋으로 추가.
트레일러가 증명하는 것은 "DB 리허설 통과"까지다.

## 일시정지 복구
무료 티어는 1주 미사용 시 정지(복구 가능 1년). 대시보드 → 프로젝트 → Restore 버튼. sync·접속 실패 시 첫 의심 대상.

## staging 오염 복구
원칙 revert(쌍이 main 으로 흐르는 것은 수용). 대규모 오염만 전 세션 공지 후 브랜치 재생성(예외 절차).
force push 는 여기서도 금지.

## 재구축 (프로젝트를 날렸을 때)
Task 1~2 수동 체크리스트 재수행(§4.1: Site URL·redirect·이메일 발송 0·autoconfirm·vector 확장) →
키체인 갱신 → staging.config.mjs 의 STAGING_REF 교체 → staging:sync.
staging_reader 재생성 SQL: create role staging_reader login password '<새 비밀번호>'; grant pg_read_all_data to staging_reader;
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbook-staging.md
git commit -m "스테이징 runbook — 좌표·마이그레이션 절차·일시정지/오염/재구축 복구 경로"
```

### Task 11: CLAUDE.md 운영 규칙 갱신

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 갱신 3곳**

① "브랜치" 절 앞(또는 뒤)에 스테이징 흐름 추가:

```markdown
### 스테이징 (2026-08-11 이후 표준)

상시 스테이징: `staging` 브랜치 → dflow-staging.vercel.app (스테이징 Supabase, 운영과 격리).
운영 절차·좌표는 `docs/runbook-staging.md`.

- **새 화면·신규 기능은 스테이징 URL에서 확인 후 main 머지** (관례 — 훅 강제는 아래 둘뿐).
- **마이그레이션은 스테이징 리허설 필수** — `staging:sync` → `db:apply --target staging` → 검증 →
  커밋 트레일러 `Staging-verified:` → staging push → `db:apply --target prod` → main push. G4 훅이 막는다.
- staging push 전 `origin/main` back-merge(각 세션 책임). staging→main 머지 커밋은 정상. force push 금지.
- staging 에는 main 에 갈 커밋만 올린다. 실험은 별도 브랜치 + Preview(이제 Preview 도 로그인 된다).
- 소액 변경(오타·주석·문서)은 종전대로 main 직행 허용.
```

② pre-push 훅 표에 행 추가: `| G4 | 0072+ 마이그레이션의 main 직행 차단(스테이징 리허설 트레일러) | 범위 내 빈 커밋 트레일러로도 인정 |`

③ "데이터" 절 첫 항목 교체 — 기존 `- **운영 D-CUBE 데이터를 훼손하지 않는다.** 로컬 dev 도 프로덕션 Supabase 를 공유한다. 쓰기 검증은 전용 테스트 프로젝트에서.` 를:

```markdown
- **운영 D-CUBE 데이터를 훼손하지 않는다.** 로컬 dev 기본값은 **스테이징 DB**다
  (`npm run env:staging`/`env:prod` 로 전환 — 파일 교체라 이 PC 의 모든 병렬 세션에 즉시 영향,
  운영 전환 후엔 복귀가 예절이고 predev 가드가 잊음을 잡는다). 운영을 향한 `npm run dev` 는
  `FORCE_PROD_DEV=1` 없이는 차단된다. 쓰기 검증은 스테이징에서.
- 마이그레이션은 **스테이징 리허설 후** Supabase Management API 로 적용(`npm run db:apply`).
  `supabase db push` 는 쓰지 않는다.
```
(기존 "마이그레이션 적용은 Management API 경유…" 항목은 위 둘째 줄로 흡수·교체.)

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "운영 규칙에 스테이징 표준 반영 — 로컬 기본값 전환·G4·back-merge 규칙 (근거는 runbook-staging)"
```

---

## 페이즈 C — 화면 표시 (staging 브랜치 경유로 검증)

### Task 12: STAGING noindex 헤더

**Files:**
- Modify: `next.config.ts:16-26` (`headers()` 확장)

- [ ] **Step 1: headers() 수정**

```ts
  async headers() {
    const rules: Awaited<ReturnType<NonNullable<NextConfig["headers"]>>> = [];
    // 스테이징은 검색엔진에 노출하지 않는다 (스펙 §5 — STAGING=1 은 스테이징 배포에만 설정).
    if (process.env.STAGING === "1") {
      rules.push({
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      });
    }
    // 프로덕션 배포에서만 Vercel Toolbar 숨김(공식 x-vercel-skip-toolbar 헤더).
    // Preview 배포의 코멘트/피드백 기능은 유지한다. (BUG-07)
    if (process.env.VERCEL_ENV === "production") {
      rules.push({
        source: "/:path*",
        headers: [{ key: "x-vercel-skip-toolbar", value: "1" }],
      });
    }
    return rules;
  },
```

- [ ] **Step 2: 로컬 확인**

```bash
STAGING=1 npm run build 2>&1 | tail -3   # 빌드 통과 확인 (_workspace 스크래치 ts 로 실패하면 *.buildskip 개명 레시피 적용)
```

- [ ] **Step 3: staging 배포 후 헤더 검증**

```bash
git switch staging && git merge main && git add -u && git commit … # (Task 13 과 함께 push 해도 된다)
```
배포 후:
```bash
curl -sI https://dflow-staging.vercel.app/login | grep -i x-robots-tag   # noindex, nofollow
curl -sI https://<운영 도메인>/login | grep -ci x-robots-tag             # 0 (운영엔 없음)
```

- [ ] **Step 4: Commit** (Step 3 배포 전에 로컬 커밋)

```bash
git add next.config.ts
git commit -m "STAGING=1 이면 전 경로 noindex — 스테이징이 검색엔진에 잡히지 않게"
```

### Task 13: STAGING 배지 + 최종 E2E

**Files:**
- Modify: `src/app/(app)/layout.tsx` (UI 위험 파일 — staging 경유가 곧 검증)

- [ ] **Step 1: 배지 추가**

`(app)/layout.tsx`의 `<UsageTracker />` 다음 줄에:

```tsx
            {process.env.STAGING === "1" && (
              <div className="pointer-events-none fixed bottom-3 right-3 z-[300] rounded-md bg-amber-500/90 px-2.5 py-1 text-xs font-bold tracking-wider text-white shadow-lg">
                STAGING
              </div>
            )}
```
(HeaderChrome 은 건드리지 않는다 — 고정 우하단이라 레이아웃 흐름에 영향 없음. 서버 컴포넌트라 `process.env` 직접 판독 가능. `pointer-events-none` 으로 클릭 방해 없음.)

- [ ] **Step 2: 기존 테스트 회귀**

Run: `npm run test`
Expected: 전건 PASS (배지는 STAGING 미설정 로컬·CI 에선 렌더되지 않는다).

- [ ] **Step 3: Commit + staging 배포·눈확인 (§12-5)**

```bash
git add src/app/\(app\)/layout.tsx
git commit -m "스테이징 화면 식별 배지 — 운영과 동일한 화면을 혼동하지 않게 (STAGING=1 에서만)"
git switch staging && git merge main && git push && git switch main
```
스테이징 URL에서: 우하단 STAGING 배지 표시 + 화면 전반 정상(사이드바·헤더·본문) 눈확인.

- [ ] **Step 4: main 반영 + 운영 확인**

```bash
git push origin main        # staging 경유했으므로 G2 통과(커밋이 이미 origin/staging 에 있음)
npm run smoke:prod          # 배포 후
```
운영 URL에서 배지가 **없는지**, 화면 정상인지 확인 후:

```bash
npm run mark:good
```

- [ ] **Step 5: 잔여 E2E 항목 소탕 (§12 전체 대조)**

§12의 1~8을 하나씩 대조해 미완 항목이 없는지 확인하고, 결과를 짧게 기록(메모리/보고). 특히 §12-3(비밀번호 재설정 무발송)과 §12-6(운영 ref 거부)이 실측으로 남아 있는지 재확인.

---

## Self-review 기록 (계획 작성 시점)

- 스펙 §4.1→Task 1, §4.2→Task 7, §4.3→Task 8, §4.4→Task 7·8, §5→Task 12·13, §6→Task 3·4, §7→Task 5·9, §8→Task 11, §9→Task 6, §10→Task 3·4·5·6 분산, §12→각 태스크 검증 스텝, §13 페이즈·순서 준수, §14→Task 1·7·10. 커버리지 공백 없음.
- G4 삽입 위치는 기존 훅의 `remote_ref = refs/heads/main` 분기 내부 — G2와 같은 조건을 재검사하지 않는다.
- `staging.config.mjs`의 `<...>` 플레이스홀더 2곳은 Task 1 실행 시점에 실값으로 채워진다(의도된 지연 바인딩 — 문서상 placeholder 아님).
