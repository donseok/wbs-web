# WBS-AI PM · 코어 원장 + 작업 루프 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WBS 원장과 AI 작업 루프의 서버 측을 만든다 — 작업을 발행하고, 러너가 원자적으로 claim해 결과를 보고하고, 사람이 승인하면 진척이 롤업되며, 안전장치 S1~S6이 실제로 작동함을 테스트로 증명한다.

**Architecture:** Fastify 서버 하나. 공개 평면(사람)과 내부 평면(러너)을 라우트 프리픽스와 인증 방식으로 물리 분리한다. 도메인 로직(진척 롤업·상태 전이·보고 검증)은 DB를 모르는 순수 함수로 두고, DB 접근은 Kysely 쿼리로 명시한다. 동시성은 애플리케이션 락이 아니라 `SELECT ... FOR UPDATE SKIP LOCKED` + 단조 증가 fencing 토큰으로 해결한다.

**Tech Stack:** Node 22 · TypeScript · Fastify 5 · Kysely + mysql2 · MariaDB 11.8 · vitest · @node-rs/argon2

**설계 정본:** `docs/superpowers/specs/2026-08-05-wbs-ai-pm-design.md` (v2)

## Global Constraints

- **DB는 MariaDB 11.8 Community.** `SKIP LOCKED`가 필요하므로 10.6 미만은 불가.
- **모든 시각은 UTC로 저장한다.** 컬럼 타입은 `DATETIME(3)`. `TIMESTAMP`를 쓰지 않는다 — 세션 타임존 자동 변환이 날짜를 하루씩 어긋나게 한다.
- **ID는 애플리케이션에서 생성한다.** `crypto.randomUUID()` → `CHAR(36)`.
- **상태 값은 `ENUM`으로 강제한다.** `CHECK`에 의존하지 않는다.
- **코어 소스는 모듈을 참조하지 않는다.** `src/core/**`에 `mod_` 문자열이 등장하면 위반이며 Task 13이 이를 검사한다.
- **러너 API는 공개 평면에서 404여야 한다.** Task 6이 이를 검사한다.
- **`progress`는 0~99만 허용한다.** 100은 사람 승인 전용이며, 0과 하향 보고는 거부한다.
- **테스트는 실제 MariaDB에 붙는다.** SQLite 대체나 mock DB를 쓰지 않는다 — `SKIP LOCKED`와 트랜잭션 격리가 이 설계의 핵심이라 인메모리 대체물로는 검증되지 않는다.
- 신규 저장소 루트 기준 경로다. 이 계획은 `wbs-ai-pm` 저장소에서 실행한다.

---

## File Structure


| 경로                              | 책임                |
| ------------------------------- | ----------------- |
| `src/db/schema.ts`              | Kysely 테이블 타입 정의  |
| `src/db/connection.ts`          | 커넥션 풀 생성          |
| `src/db/migrate.ts`             | 마이그레이션 러너         |
| `migrations/*.sql`              | 순수 SQL 마이그레이션     |
| `src/core/domain/rollup.ts`     | 진척 롤업 (순수)        |
| `src/core/domain/report.ts`     | 보고 검증 규칙 (순수)     |
| `src/core/domain/transition.ts` | 주문 상태 전이 (순수)     |
| `src/core/repo/workOrders.ts`   | 주문 claim/보고/회수 쿼리 |
| `src/core/repo/wbs.ts`          | WBS 항목 쿼리         |
| `src/core/auth/runnerToken.ts`  | 러너 토큰 발급·검증       |
| `src/core/auth/session.ts`      | 사람 세션             |
| `src/routes/internal/agent.ts`  | 러너 API (내부 평면)    |
| `src/routes/public/approval.ts` | 승인 API (공개 평면)    |
| `src/server.ts`                 | Fastify 조립·평면 분리  |
| `tests/**`                      | 위 각 단위의 테스트       |


---

### Task 1: 프로젝트 스캐폴딩과 DB 연결

**Files:**

- Create: `package.json` · `tsconfig.json` · `vitest.config.ts` · `docker-compose.yml` · `src/db/connection.ts` · `src/db/schema.ts` · `src/db/migrate.ts` · `migrations/0001_core.sql`
- Test: `tests/db/connection.test.ts`

**Interfaces:**

- Consumes: 없음 (첫 태스크)
- Produces: `getDb(): Kysely<DB>` · `runMigrations(dir: string): Promise<void>` · `DB` 타입

- [ ] **Step 1: 저장소와 의존성 준비**

```bash
mkdir -p wbs-ai-pm && cd wbs-ai-pm && git init
npm init -y
npm i fastify kysely mysql2 @node-rs/argon2
npm i -D typescript vitest @types/node tsx
npx tsc --init --target es2022 --module nodenext --moduleResolution nodenext --strict --outDir dist --rootDir .
```

- [ ] **Step 2: vitest 설정 — 파일 병렬 실행을 끈다**

`vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 테스트가 하나의 실제 MariaDB 를 공유한다. 파일 병렬 실행을 켜두면
    // 마이그레이션이 서로를 덮치고, claim 경합 테스트가 남의 주문을 집는다.
    fileParallelism: false,
    hookTimeout: 30_000,
  },
})
```

- [ ] **Step 3: 로컬 MariaDB 기동 파일 작성**

`docker-compose.yml`:

```yaml
services:
  db:
    image: mariadb:11.8
    environment:
      MARIADB_ROOT_PASSWORD: devroot
      MARIADB_DATABASE: wbsaipm
    command: >
      --character-set-server=utf8mb4
      --collation-server=utf8mb4_unicode_ci
      --default-time-zone=+00:00
    ports: ["3307:3306"]
```

Run: `docker compose up -d`

- [ ] **Step 3: 실패하는 테스트 작성**

`tests/db/connection.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { getDb } from '../../src/db/connection.js'
import { sql } from 'kysely'

describe('db connection', () => {
  it('세션 타임존이 UTC 다', async () => {
    const db = getDb()
    const r = await sql<{ tz: string }>`select @@session.time_zone as tz`.execute(db)
    expect(r.rows[0].tz).toBe('+00:00')
  })
})
```

- [ ] **Step 4: 실패 확인**

Run: `npx vitest run tests/db/connection.test.ts`
Expected: FAIL — `Cannot find module '../../src/db/connection.js'`

- [ ] **Step 5: 최소 구현**

`src/db/schema.ts`:

```typescript
export interface DB {}
```

`src/db/connection.ts`:

```typescript
import { Kysely, MysqlDialect } from 'kysely'
import { createPool } from 'mysql2'
import type { DB } from './schema.js'

let db: Kysely<DB> | undefined

export function getDb(): Kysely<DB> {
  if (db) return db
  db = new Kysely<DB>({
    dialect: new MysqlDialect({
      pool: createPool({
        host: process.env.DB_HOST ?? '127.0.0.1',
        port: Number(process.env.DB_PORT ?? 3307),
        user: process.env.DB_USER ?? 'root',
        password: process.env.DB_PASSWORD ?? 'devroot',
        database: process.env.DB_NAME ?? 'wbsaipm',
        timezone: 'Z',
        connectionLimit: 10,
      }),
    }),
  })
  return db
}
```

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/db/connection.test.ts`
Expected: PASS

- [ ] **Step 7: 마이그레이션 러너 구현**

`src/db/migrate.ts`:

```typescript
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'kysely'
import { getDb } from './connection.js'

export async function runMigrations(dir: string): Promise<void> {
  const db = getDb()
  await sql`create table if not exists schema_migrations (
    name varchar(255) primary key,
    applied_at datetime(3) not null
  ) engine=innodb`.execute(db)

  const applied = new Set(
    (await sql<{ name: string }>`select name from schema_migrations`.execute(db)).rows.map(r => r.name),
  )

  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue
    const body = readFileSync(join(dir, file), 'utf8')
    for (const stmt of body.split(';').map(s => s.trim()).filter(Boolean)) {
      await sql.raw(stmt).execute(db)
    }
    await sql`insert into schema_migrations (name, applied_at) values (${file}, utc_timestamp(3))`.execute(db)
  }
}
```

- [ ] **Step 8: 커밋**

```bash
git add package.json tsconfig.json vitest.config.ts docker-compose.yml src/db tests/db
git commit -m "feat: 프로젝트 스캐폴딩과 UTC 고정 DB 커넥션"
```

---

### Task 2: 코어 스키마

**Files:**

- Create: `migrations/0001_core.sql`
- Modify: `src/db/schema.ts`
- Test: `tests/db/migrate.test.ts`

**Interfaces:**

- Consumes: `runMigrations`, `getDb` (Task 1)
- Produces: 테이블 `projects` · `users` · `project_members` · `wbs_items` · `task_types`. Kysely 타입 `ProjectsTable` · `WbsItemsTable` · `TaskTypesTable` · `UsersTable` · `ProjectMembersTable`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/migrate.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { sql } from 'kysely'
import { getDb } from '../../src/db/connection.js'
import { runMigrations } from '../../src/db/migrate.js'

describe('core schema', () => {
  beforeAll(async () => { await runMigrations('migrations') })

  it('wbs_items 에 level 컬럼이 없다', async () => {
    const r = await sql<{ COLUMN_NAME: string }>`
      select COLUMN_NAME from information_schema.columns
      where table_schema = database() and table_name = 'wbs_items'`.execute(getDb())
    const cols = r.rows.map(x => x.COLUMN_NAME)
    expect(cols).toContain('parent_id')
    expect(cols).not.toContain('level')
  })

  it('시각 컬럼이 DATETIME 이고 TIMESTAMP 가 아니다', async () => {
    const r = await sql<{ DATA_TYPE: string }>`
      select DATA_TYPE from information_schema.columns
      where table_schema = database() and table_name = 'wbs_items' and COLUMN_NAME = 'created_at'`.execute(getDb())
    expect(r.rows[0].DATA_TYPE).toBe('datetime')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/db/migrate.test.ts`
Expected: FAIL — `wbs_items` 테이블 없음

- [ ] **Step 3: 마이그레이션 작성**

`migrations/0001_core.sql`:

```sql
create table users (
  id char(36) primary key,
  email varchar(255) not null unique,
  name varchar(100) not null,
  password_hash varchar(255) not null,
  created_at datetime(3) not null
) engine=innodb;

create table projects (
  id char(36) primary key,
  name varchar(200) not null,
  created_at datetime(3) not null
) engine=innodb;

create table project_members (
  project_id char(36) not null,
  user_id char(36) not null,
  role enum('admin','member') not null,
  primary key (project_id, user_id),
  foreign key (project_id) references projects(id),
  foreign key (user_id) references users(id)
) engine=innodb;

create table task_types (
  id char(36) primary key,
  project_id char(36) not null,
  name varchar(100) not null,
  ai_executable tinyint(1) not null default 0,
  unique key uk_task_type (project_id, name),
  foreign key (project_id) references projects(id)
) engine=innodb;

create table wbs_items (
  id char(36) primary key,
  project_id char(36) not null,
  parent_id char(36) null,
  external_code varchar(100) null,
  name varchar(500) not null,
  task_type_id char(36) null,
  assignee_id char(36) null,
  planned_start date null,
  planned_end date null,
  actual_pct decimal(5,1) not null default 0.0,
  archived tinyint(1) not null default 0,
  created_at datetime(3) not null,
  updated_at datetime(3) not null,
  unique key uk_external (project_id, external_code),
  key idx_parent (parent_id),
  foreign key (project_id) references projects(id),
  foreign key (parent_id) references wbs_items(id),
  foreign key (task_type_id) references task_types(id),
  foreign key (assignee_id) references users(id)
) engine=innodb;
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/db/migrate.test.ts`
Expected: PASS

- [ ] **Step 5: Kysely 타입 반영**

`src/db/schema.ts`:

```typescript
export interface UsersTable {
  id: string; email: string; name: string; password_hash: string; created_at: Date
}
export interface ProjectsTable { id: string; name: string; created_at: Date }
export interface ProjectMembersTable { project_id: string; user_id: string; role: 'admin' | 'member' }
export interface TaskTypesTable { id: string; project_id: string; name: string; ai_executable: number }
export interface WbsItemsTable {
  id: string; project_id: string; parent_id: string | null; external_code: string | null
  name: string; task_type_id: string | null; assignee_id: string | null
  planned_start: Date | null; planned_end: Date | null
  actual_pct: number; archived: number; created_at: Date; updated_at: Date
}
export interface DB {
  users: UsersTable; projects: ProjectsTable; project_members: ProjectMembersTable
  task_types: TaskTypesTable; wbs_items: WbsItemsTable
}
```

- [ ] **Step 6: 커밋**

```bash
git add migrations/0001_core.sql src/db/schema.ts tests/db/migrate.test.ts
git commit -m "feat: 코어 스키마 — level 컬럼 없이 parent_id 로 N단"
```

---

### Task 3: 진척 롤업 (순수 함수)

**Files:**

- Create: `src/core/domain/rollup.ts`
- Test: `tests/core/domain/rollup.test.ts`

**Interfaces:**

- Consumes: 없음 (DB를 모른다)
- Produces: `type RollupNode = { id: string; parentId: string | null; actualPct: number }` · `rollup(nodes: RollupNode[]): Map<string, number>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/core/domain/rollup.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { rollup, type RollupNode } from '../../../src/core/domain/rollup.js'

describe('rollup', () => {
  it('리프 값은 그대로 둔다', () => {
    const nodes: RollupNode[] = [{ id: 'a', parentId: null, actualPct: 40 }]
    expect(rollup(nodes).get('a')).toBe(40)
  })

  it('부모는 리프의 단순 평균이다', () => {
    const nodes: RollupNode[] = [
      { id: 'p', parentId: null, actualPct: 0 },
      { id: 'c1', parentId: 'p', actualPct: 100 },
      { id: 'c2', parentId: 'p', actualPct: 0 },
    ]
    expect(rollup(nodes).get('p')).toBe(50)
  })

  it('임의 깊이에서 동작한다', () => {
    const nodes: RollupNode[] = [
      { id: 'r', parentId: null, actualPct: 0 },
      { id: 'm', parentId: 'r', actualPct: 0 },
      { id: 'l1', parentId: 'm', actualPct: 30 },
      { id: 'l2', parentId: 'm', actualPct: 70 },
    ]
    const out = rollup(nodes)
    expect(out.get('m')).toBe(50)
    expect(out.get('r')).toBe(50)
  })

  it('소수 첫째 자리로 반올림한다', () => {
    const nodes: RollupNode[] = [
      { id: 'p', parentId: null, actualPct: 0 },
      { id: 'c1', parentId: 'p', actualPct: 33 },
      { id: 'c2', parentId: 'p', actualPct: 33 },
      { id: 'c3', parentId: 'p', actualPct: 34 },
    ]
    expect(rollup(nodes).get('p')).toBe(33.3)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/core/domain/rollup.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/core/domain/rollup.ts`:

```typescript
export type RollupNode = { id: string; parentId: string | null; actualPct: number }

export function rollup(nodes: RollupNode[]): Map<string, number> {
  const children = new Map<string, RollupNode[]>()
  for (const n of nodes) {
    if (n.parentId === null) continue
    const list = children.get(n.parentId) ?? []
    list.push(n)
    children.set(n.parentId, list)
  }

  const result = new Map<string, number>()

  function visit(node: RollupNode): number {
    const kids = children.get(node.id)
    if (!kids || kids.length === 0) {
      result.set(node.id, node.actualPct)
      return node.actualPct
    }
    const sum = kids.reduce((acc, k) => acc + visit(k), 0)
    const avg = Math.round((sum / kids.length) * 10) / 10
    result.set(node.id, avg)
    return avg
  }

  for (const n of nodes) if (n.parentId === null) visit(n)
  return result
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/core/domain/rollup.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/domain/rollup.ts tests/core/domain/rollup.test.ts
git commit -m "feat: 진척 롤업 — 임의 깊이, 소수 1자리"
```

---

### Task 4: 작업 루프 스키마

**Files:**

- Create: `migrations/0002_work_loop.sql`
- Modify: `src/db/schema.ts`
- Test: `tests/db/work-loop-schema.test.ts`

**Interfaces:**

- Consumes: Task 2의 테이블
- Produces: 테이블 `runners` · `work_orders` · `work_reports`. 타입 `RunnersTable` · `WorkOrdersTable` · `WorkReportsTable`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/work-loop-schema.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { sql } from 'kysely'
import { getDb } from '../../src/db/connection.js'
import { runMigrations } from '../../src/db/migrate.js'

describe('work loop schema', () => {
  beforeAll(async () => { await runMigrations('migrations') })

  it('work_orders 에 claim_count 와 fencing_token 이 있다', async () => {
    const r = await sql<{ COLUMN_NAME: string }>`
      select COLUMN_NAME from information_schema.columns
      where table_schema = database() and table_name = 'work_orders'`.execute(getDb())
    const cols = r.rows.map(x => x.COLUMN_NAME)
    expect(cols).toContain('claim_count')
    expect(cols).toContain('fencing_token')
    expect(cols).toContain('lease_expires_at')
  })

  it('work_reports.kind 에 failure 가 포함된다', async () => {
    const r = await sql<{ COLUMN_TYPE: string }>`
      select COLUMN_TYPE from information_schema.columns
      where table_schema = database() and table_name = 'work_reports' and COLUMN_NAME = 'kind'`.execute(getDb())
    expect(r.rows[0].COLUMN_TYPE).toContain('failure')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/db/work-loop-schema.test.ts`
Expected: FAIL — `work_orders` 없음

- [ ] **Step 3: 마이그레이션 작성**

`migrations/0002_work_loop.sql`:

```sql
create table runners (
  id char(36) primary key,
  name varchar(100) not null unique,
  owner_user_id char(36) not null,
  token_hash varchar(255) not null,
  revoked tinyint(1) not null default 0,
  created_at datetime(3) not null,
  foreign key (owner_user_id) references users(id)
) engine=innodb;
-- owner_user_id 가 S6(자기 승인 기록)의 근거다. 이것 없이는 "승인자와 러너
-- 운영자가 같은 사람인가"를 판정할 수 없고, self_approved 는 항상 참이 된다.

create table work_orders (
  id char(36) primary key,
  project_id char(36) not null,
  wbs_item_id char(36) not null,
  status enum('ready','claimed','reported','approved','blocked','cancelled') not null default 'ready',
  claim_count int not null default 0,
  max_claims int not null default 3,
  fencing_token bigint not null default 0,
  claimed_by char(36) null,
  lease_expires_at datetime(3) null,
  self_approved tinyint(1) not null default 0,
  created_at datetime(3) not null,
  updated_at datetime(3) not null,
  key idx_queue (project_id, status),
  foreign key (project_id) references projects(id),
  foreign key (wbs_item_id) references wbs_items(id),
  foreign key (claimed_by) references runners(id)
) engine=innodb;

create table work_reports (
  id char(36) primary key,
  work_order_id char(36) not null,
  runner_id char(36) not null,
  fencing_token bigint not null,
  kind enum('progress','completion','failure') not null,
  percent decimal(5,1) null,
  summary text null,
  artifact_url varchar(1000) null,
  created_at datetime(3) not null,
  key idx_order (work_order_id),
  foreign key (work_order_id) references work_orders(id),
  foreign key (runner_id) references runners(id)
) engine=innodb;
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/db/work-loop-schema.test.ts`
Expected: PASS

- [ ] **Step 5: Kysely 타입 추가**

`src/db/schema.ts` 에 추가:

```typescript
export interface RunnersTable {
  id: string; name: string; owner_user_id: string
  token_hash: string; revoked: number; created_at: Date
}
export interface WorkOrdersTable {
  id: string; project_id: string; wbs_item_id: string
  status: 'ready' | 'claimed' | 'reported' | 'approved' | 'blocked' | 'cancelled'
  claim_count: number; max_claims: number; fencing_token: number
  claimed_by: string | null; lease_expires_at: Date | null
  self_approved: number; created_at: Date; updated_at: Date
}
export interface WorkReportsTable {
  id: string; work_order_id: string; runner_id: string; fencing_token: number
  kind: 'progress' | 'completion' | 'failure'
  percent: number | null; summary: string | null; artifact_url: string | null; created_at: Date
}
```

그리고 `DB` 인터페이스에 `runners`·`work_orders`·`work_reports` 를 추가한다.

- [ ] **Step 6: 커밋**

```bash
git add migrations/0002_work_loop.sql src/db/schema.ts tests/db/work-loop-schema.test.ts
git commit -m "feat: 작업 루프 스키마 — claim_count 와 fencing_token 을 처음부터"
```

---

### Task 5: 러너 토큰 발급·검증

**Files:**

- Create: `src/core/auth/runnerToken.ts`
- Test: `tests/core/auth/runnerToken.test.ts`

**Interfaces:**

- Consumes: `getDb` (Task 1), `runners` 테이블 (Task 4)
- Produces: `issueRunnerToken(name: string, ownerUserId: string): Promise<{ runnerId: string; token: string }>` · `verifyRunnerToken(token: string): Promise<string | null>` (러너 id 또는 null) · `revokeRunner(runnerId: string): Promise<void>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/core/auth/runnerToken.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { runMigrations } from '../../../src/db/migrate.js'
import { issueRunnerToken, verifyRunnerToken, revokeRunner } from '../../../src/core/auth/runnerToken.js'
import { getDb } from '../../../src/db/connection.js'

async function makeOwner(): Promise<string> {
  const id = crypto.randomUUID()
  await getDb().insertInto('users').values({
    id, email: `${id}@t.local`, name: 'owner', password_hash: 'x', created_at: new Date(),
  }).execute()
  return id
}

describe('runner token', () => {
  beforeAll(async () => { await runMigrations('migrations') })

  it('원문 토큰을 저장하지 않는다', async () => {
    const { runnerId, token } = await issueRunnerToken(`r-${crypto.randomUUID()}`, await makeOwner())
    const row = await getDb().selectFrom('runners').select('token_hash')
      .where('id', '=', runnerId).executeTakeFirstOrThrow()
    expect(row.token_hash).not.toContain(token)
  })

  it('발급된 토큰이 검증된다', async () => {
    const { runnerId, token } = await issueRunnerToken(`r-${crypto.randomUUID()}`, await makeOwner())
    expect(await verifyRunnerToken(token)).toBe(runnerId)
  })

  it('잘못된 토큰은 null 이다', async () => {
    expect(await verifyRunnerToken('wrong-token')).toBeNull()
  })

  it('폐기된 러너의 토큰은 거부된다', async () => {
    const { runnerId, token } = await issueRunnerToken(`r-${crypto.randomUUID()}`, await makeOwner())
    await revokeRunner(runnerId)
    expect(await verifyRunnerToken(token)).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/core/auth/runnerToken.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/core/auth/runnerToken.ts`:

```typescript
import { randomBytes, randomUUID } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'
import { getDb } from '../../db/connection.js'

// 토큰 형식: "<runnerId>.<secret>" — id 를 앞에 두어 조회가 O(1) 이 된다.
// 전수 대조를 하면 러너가 늘수록 검증 비용이 선형으로 커진다.

export async function issueRunnerToken(
  name: string, ownerUserId: string,
): Promise<{ runnerId: string; token: string }> {
  const runnerId = randomUUID()
  const secret = randomBytes(32).toString('base64url')
  await getDb().insertInto('runners').values({
    id: runnerId, name, owner_user_id: ownerUserId,
    token_hash: await hash(secret), revoked: 0, created_at: new Date(),
  }).execute()
  return { runnerId, token: `${runnerId}.${secret}` }
}

export async function verifyRunnerToken(token: string): Promise<string | null> {
  const sep = token.indexOf('.')
  if (sep <= 0) return null
  const runnerId = token.slice(0, sep)
  const secret = token.slice(sep + 1)

  const row = await getDb().selectFrom('runners')
    .select(['id', 'token_hash', 'revoked'])
    .where('id', '=', runnerId).executeTakeFirst()
  if (!row || row.revoked === 1) return null

  try {
    return (await verify(row.token_hash, secret)) ? row.id : null
  } catch {
    return null
  }
}

export async function revokeRunner(runnerId: string): Promise<void> {
  await getDb().updateTable('runners').set({ revoked: 1 }).where('id', '=', runnerId).execute()
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/core/auth/runnerToken.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/auth/runnerToken.ts tests/core/auth/runnerToken.test.ts
git commit -m "feat: 러너 토큰 — argon2 해시 저장, 폐기 경로 포함"
```

---

### Task 6: 평면 분리 — 러너 API 는 공개 경로에서 404

**Files:**

- Create: `src/server.ts` · `src/routes/internal/agent.ts`
- Test: `tests/routes/plane-isolation.test.ts`

**Interfaces:**

- Consumes: `verifyRunnerToken` (Task 5)
- Produces: `buildServer(opts: { plane: 'public' | 'internal' }): FastifyInstance`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/routes/plane-isolation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildServer } from '../../src/server.js'

describe('plane isolation', () => {
  it('공개 평면에서 러너 API 는 404 다', async () => {
    const app = buildServer({ plane: 'public' })
    const res = await app.inject({ method: 'GET', url: '/api/v1/agent/work' })
    expect(res.statusCode).toBe(404)
  })

  it('내부 평면에서 토큰 없으면 401 이다', async () => {
    const app = buildServer({ plane: 'internal' })
    const res = await app.inject({ method: 'GET', url: '/api/v1/agent/work' })
    expect(res.statusCode).toBe(401)
  })

  it('내부 평면에서 잘못된 토큰은 401 이다', async () => {
    const app = buildServer({ plane: 'internal' })
    const res = await app.inject({
      method: 'GET', url: '/api/v1/agent/work',
      headers: { authorization: 'Bearer nope' },
    })
    expect(res.statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/routes/plane-isolation.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/routes/internal/agent.ts`:

```typescript
import type { FastifyInstance } from 'fastify'
import { verifyRunnerToken } from '../../core/auth/runnerToken.js'

export async function agentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    const auth = req.headers.authorization
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined
    const runnerId = token ? await verifyRunnerToken(token) : null
    if (!runnerId) return reply.code(401).send({ error: 'unauthorized' })
    ;(req as { runnerId?: string }).runnerId = runnerId
  })

  app.get('/api/v1/agent/work', async () => ({ orders: [] }))
}
```

`src/server.ts`:

```typescript
import Fastify, { type FastifyInstance } from 'fastify'
import { agentRoutes } from './routes/internal/agent.js'

export function buildServer(opts: { plane: 'public' | 'internal' }): FastifyInstance {
  const app = Fastify({ logger: false })
  // 러너 라우트는 내부 평면에만 등록한다. 등록되지 않으면 Fastify 가 404 를 낸다 —
  // 프록시 설정이 아니라 서버 구성 자체가 경계를 강제한다.
  if (opts.plane === 'internal') app.register(agentRoutes)
  return app
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/routes/plane-isolation.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/server.ts src/routes/internal/agent.ts tests/routes/plane-isolation.test.ts
git commit -m "feat: 평면 분리 — 러너 라우트를 공개 서버에 등록하지 않는다"
```

---

### Task 7: claim-next — 원자성·claim_count·fencing

**Files:**

- Create: `src/core/repo/workOrders.ts`
- Modify: `src/routes/internal/agent.ts`
- Test: `tests/core/repo/claim.test.ts`

**Interfaces:**

- Consumes: `getDb` (Task 1), `work_orders` (Task 4)
- Produces: `claimNext(projectId: string, runnerId: string, leaseMinutes: number): Promise<{ orderId: string; wbsItemId: string; fencingToken: number } | null>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/core/repo/claim.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { runMigrations } from '../../../src/db/migrate.js'
import { claimNext } from '../../../src/core/repo/workOrders.js'
import { getDb } from '../../../src/db/connection.js'
import { seedProjectWithOrders } from '../../helpers/seed.js'

describe('claimNext', () => {
  beforeAll(async () => { await runMigrations('migrations') })

  it('claim 하면 claim_count 가 증가한다', async () => {
    const { projectId, runnerId } = await seedProjectWithOrders(1)
    const c = await claimNext(projectId, runnerId, 30)
    expect(c).not.toBeNull()
    const row = await getDb().selectFrom('work_orders').select(['claim_count', 'status'])
      .where('id', '=', c!.orderId).executeTakeFirstOrThrow()
    expect(row.claim_count).toBe(1)
    expect(row.status).toBe('claimed')
  })

  it('fencing 토큰이 claim 마다 증가한다', async () => {
    const { projectId, runnerId } = await seedProjectWithOrders(1)
    const first = await claimNext(projectId, runnerId, 30)
    await getDb().updateTable('work_orders')
      .set({ status: 'ready', claimed_by: null }).where('id', '=', first!.orderId).execute()
    const second = await claimNext(projectId, runnerId, 30)
    expect(second!.fencingToken).toBeGreaterThan(first!.fencingToken)
  })

  it('동시 claim 이 같은 주문을 두 번 주지 않는다', async () => {
    const { projectId, runnerId } = await seedProjectWithOrders(1)
    const [a, b] = await Promise.all([
      claimNext(projectId, runnerId, 30),
      claimNext(projectId, runnerId, 30),
    ])
    const got = [a, b].filter(Boolean)
    expect(got.length).toBe(1)
  })

  it('큐가 비면 null 이다', async () => {
    const { projectId, runnerId } = await seedProjectWithOrders(0)
    expect(await claimNext(projectId, runnerId, 30)).toBeNull()
  })
})
```

- [ ] **Step 2: 시드 헬퍼 작성**

`tests/helpers/seed.ts`:

```typescript
import { randomUUID } from 'node:crypto'
import { getDb } from '../../src/db/connection.js'
import { issueRunnerToken } from '../../src/core/auth/runnerToken.js'

export async function seedProjectWithOrders(orderCount: number) {
  const db = getDb()
  const now = new Date()

  const ownerId = randomUUID()
  await db.insertInto('users').values({
    id: ownerId, email: `${ownerId}@t.local`, name: 'runner-owner',
    password_hash: 'x', created_at: now,
  }).execute()

  const projectId = randomUUID()
  await db.insertInto('projects').values({ id: projectId, name: `p-${projectId}`, created_at: now }).execute()

  const itemId = randomUUID()
  await db.insertInto('wbs_items').values({
    id: itemId, project_id: projectId, parent_id: null, external_code: null,
    name: 'leaf', task_type_id: null, assignee_id: null,
    planned_start: null, planned_end: null, actual_pct: 0, archived: 0,
    created_at: now, updated_at: now,
  }).execute()

  for (let i = 0; i < orderCount; i++) {
    await db.insertInto('work_orders').values({
      id: randomUUID(), project_id: projectId, wbs_item_id: itemId,
      status: 'ready', claim_count: 0, max_claims: 3, fencing_token: 0,
      claimed_by: null, lease_expires_at: null, self_approved: 0,
      created_at: now, updated_at: now,
    }).execute()
  }

  const { runnerId } = await issueRunnerToken(`runner-${randomUUID()}`, ownerId)
  return { projectId, itemId, runnerId, ownerId }
}
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/core/repo/claim.test.ts`
Expected: FAIL — `claimNext` 없음

- [ ] **Step 4: 구현**

`src/core/repo/workOrders.ts`:

```typescript
import { sql } from 'kysely'
import { getDb } from '../../db/connection.js'

export async function claimNext(
  projectId: string, runnerId: string, leaseMinutes: number,
): Promise<{ orderId: string; wbsItemId: string; fencingToken: number } | null> {
  return getDb().transaction().execute(async trx => {
    // SKIP LOCKED 가 핵심이다. 이게 없으면 러너들이 같은 1위를 두고 줄을 선다.
    const picked = await sql<{ id: string; wbs_item_id: string }>`
      select id, wbs_item_id from work_orders
      where project_id = ${projectId}
        and status = 'ready'
        and claim_count < max_claims
      order by created_at asc
      limit 1
      for update skip locked
    `.execute(trx)

    const row = picked.rows[0]
    if (!row) return null

    await sql`
      update work_orders
      set status = 'claimed',
          claim_count = claim_count + 1,
          fencing_token = fencing_token + 1,
          claimed_by = ${runnerId},
          lease_expires_at = date_add(utc_timestamp(3), interval ${leaseMinutes} minute),
          updated_at = utc_timestamp(3)
      where id = ${row.id}
    `.execute(trx)

    const after = await sql<{ fencing_token: number }>`
      select fencing_token from work_orders where id = ${row.id}
    `.execute(trx)

    return {
      orderId: row.id,
      wbsItemId: row.wbs_item_id,
      fencingToken: Number(after.rows[0].fencing_token),
    }
  })
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/core/repo/claim.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/core/repo/workOrders.ts tests/core/repo/claim.test.ts tests/helpers/seed.ts
git commit -m "feat: claim-next — SKIP LOCKED 원자 claim, claim_count 와 fencing 동시 증가"
```

---

### Task 8: 보고 검증 규칙 (순수) — S2

**Files:**

- Create: `src/core/domain/report.ts`
- Test: `tests/core/domain/report.test.ts`

**Interfaces:**

- Consumes: 없음 (순수)
- Produces: `type ReportInput = { kind: 'progress' | 'completion' | 'failure'; percent: number | null }` · `type ReportVerdict = { ok: true } | { ok: false; reason: string }` · `validateReport(input: ReportInput, currentPct: number): ReportVerdict`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/core/domain/report.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { validateReport } from '../../../src/core/domain/report.js'

describe('validateReport', () => {
  it('progress 0 은 거부한다', () => {
    const v = validateReport({ kind: 'progress', percent: 0 }, 40)
    expect(v).toEqual({ ok: false, reason: 'progress_zero_forbidden' })
  })

  it('하향 보고는 거부한다', () => {
    const v = validateReport({ kind: 'progress', percent: 30 }, 40)
    expect(v).toEqual({ ok: false, reason: 'progress_regression_forbidden' })
  })

  it('progress 100 은 거부한다 — 100 은 사람 승인 전용', () => {
    const v = validateReport({ kind: 'progress', percent: 100 }, 40)
    expect(v).toEqual({ ok: false, reason: 'progress_must_be_below_100' })
  })

  it('상향 progress 는 허용한다', () => {
    expect(validateReport({ kind: 'progress', percent: 60 }, 40)).toEqual({ ok: true })
  })

  it('같은 값 재보고는 허용한다', () => {
    expect(validateReport({ kind: 'progress', percent: 40 }, 40)).toEqual({ ok: true })
  })

  it('failure 는 percent 를 요구하지 않는다', () => {
    expect(validateReport({ kind: 'failure', percent: null }, 40)).toEqual({ ok: true })
  })

  it('failure 에 percent 를 실으면 거부한다', () => {
    const v = validateReport({ kind: 'failure', percent: 0 }, 40)
    expect(v).toEqual({ ok: false, reason: 'failure_must_not_carry_percent' })
  })

  it('completion 은 percent 를 요구한다', () => {
    const v = validateReport({ kind: 'completion', percent: null }, 40)
    expect(v).toEqual({ ok: false, reason: 'completion_requires_percent' })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/core/domain/report.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/core/domain/report.ts`:

```typescript
export type ReportInput = { kind: 'progress' | 'completion' | 'failure'; percent: number | null }
export type ReportVerdict = { ok: true } | { ok: false; reason: string }

export function validateReport(input: ReportInput, currentPct: number): ReportVerdict {
  if (input.kind === 'failure') {
    // 실패는 사유를 남기는 채널이지 실적 채널이 아니다.
    // percent 를 허용하면 0 이 실려 들어와 기존 실적을 덮어쓴다.
    return input.percent === null
      ? { ok: true }
      : { ok: false, reason: 'failure_must_not_carry_percent' }
  }

  if (input.percent === null) {
    return { ok: false, reason: input.kind === 'completion' ? 'completion_requires_percent' : 'progress_requires_percent' }
  }
  if (input.percent === 0) return { ok: false, reason: 'progress_zero_forbidden' }
  if (input.percent >= 100) return { ok: false, reason: 'progress_must_be_below_100' }
  if (input.percent < currentPct) return { ok: false, reason: 'progress_regression_forbidden' }
  return { ok: true }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/core/domain/report.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/domain/report.ts tests/core/domain/report.test.ts
git commit -m "feat: 보고 검증 S2 — progress 0·하향·100 거부, failure 는 percent 불가"
```

---

### Task 9: 보고 엔드포인트 — fencing 검증 포함 (S4)

**Files:**

- Modify: `src/core/repo/workOrders.ts` · `src/routes/internal/agent.ts`
- Test: `tests/routes/report.test.ts`

**Interfaces:**

- Consumes: `validateReport` (Task 8), `claimNext` (Task 7)
- Produces: `submitReport(args: { orderId: string; runnerId: string; fencingToken: number; kind: 'progress'|'completion'|'failure'; percent: number|null; summary: string|null; artifactUrl: string|null }): Promise<{ ok: true } | { ok: false; code: number; reason: string }>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/routes/report.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { runMigrations } from '../../src/db/migrate.js'
import { claimNext, submitReport } from '../../src/core/repo/workOrders.js'
import { seedProjectWithOrders } from '../helpers/seed.js'
import { getDb } from '../../src/db/connection.js'

describe('submitReport', () => {
  beforeAll(async () => { await runMigrations('migrations') })

  it('정상 progress 를 수락하고 wbs 실적에 반영한다', async () => {
    const { projectId, itemId, runnerId } = await seedProjectWithOrders(1)
    const c = (await claimNext(projectId, runnerId, 30))!
    const r = await submitReport({
      orderId: c.orderId, runnerId, fencingToken: c.fencingToken,
      kind: 'progress', percent: 40, summary: 'half', artifactUrl: null,
    })
    expect(r.ok).toBe(true)
    const item = await getDb().selectFrom('wbs_items').select('actual_pct')
      .where('id', '=', itemId).executeTakeFirstOrThrow()
    expect(Number(item.actual_pct)).toBe(40)
  })

  it('옛 fencing 토큰의 보고를 거부한다', async () => {
    const { projectId, runnerId } = await seedProjectWithOrders(1)
    const first = (await claimNext(projectId, runnerId, 30))!
    await getDb().updateTable('work_orders')
      .set({ status: 'ready', claimed_by: null }).where('id', '=', first.orderId).execute()
    await claimNext(projectId, runnerId, 30) // fencing 증가

    const r = await submitReport({
      orderId: first.orderId, runnerId, fencingToken: first.fencingToken,
      kind: 'progress', percent: 50, summary: null, artifactUrl: null,
    })
    expect(r).toEqual({ ok: false, code: 409, reason: 'stale_fencing_token' })
  })

  it('progress 0 을 거부한다', async () => {
    const { projectId, runnerId } = await seedProjectWithOrders(1)
    const c = (await claimNext(projectId, runnerId, 30))!
    const r = await submitReport({
      orderId: c.orderId, runnerId, fencingToken: c.fencingToken,
      kind: 'progress', percent: 0, summary: null, artifactUrl: null,
    })
    expect(r).toEqual({ ok: false, code: 422, reason: 'progress_zero_forbidden' })
  })

  it('failure 는 실적을 건드리지 않는다', async () => {
    const { projectId, itemId, runnerId } = await seedProjectWithOrders(1)
    const c = (await claimNext(projectId, runnerId, 30))!
    await submitReport({
      orderId: c.orderId, runnerId, fencingToken: c.fencingToken,
      kind: 'progress', percent: 40, summary: null, artifactUrl: null,
    })
    await submitReport({
      orderId: c.orderId, runnerId, fencingToken: c.fencingToken,
      kind: 'failure', percent: null, summary: 'build failed', artifactUrl: null,
    })
    const item = await getDb().selectFrom('wbs_items').select('actual_pct')
      .where('id', '=', itemId).executeTakeFirstOrThrow()
    expect(Number(item.actual_pct)).toBe(40)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/routes/report.test.ts`
Expected: FAIL — `submitReport` 없음

- [ ] **Step 3: 구현**

`src/core/repo/workOrders.ts` 에 추가:

```typescript
import { randomUUID } from 'node:crypto'
import { validateReport } from '../domain/report.js'

export async function submitReport(args: {
  orderId: string; runnerId: string; fencingToken: number
  kind: 'progress' | 'completion' | 'failure'
  percent: number | null; summary: string | null; artifactUrl: string | null
}): Promise<{ ok: true } | { ok: false; code: number; reason: string }> {
  return getDb().transaction().execute(async trx => {
    const order = await trx.selectFrom('work_orders')
      .select(['id', 'wbs_item_id', 'fencing_token', 'claimed_by', 'status'])
      .where('id', '=', args.orderId).forUpdate().executeTakeFirst()
    if (!order) return { ok: false as const, code: 404, reason: 'order_not_found' }
    if (order.claimed_by !== args.runnerId) return { ok: false as const, code: 403, reason: 'not_claim_owner' }

    // 잠들었다 깨어난 러너의 뒤늦은 보고를 여기서 막는다.
    if (Number(order.fencing_token) !== args.fencingToken) {
      return { ok: false as const, code: 409, reason: 'stale_fencing_token' }
    }

    const item = await trx.selectFrom('wbs_items').select('actual_pct')
      .where('id', '=', order.wbs_item_id).executeTakeFirstOrThrow()

    const verdict = validateReport({ kind: args.kind, percent: args.percent }, Number(item.actual_pct))
    if (!verdict.ok) return { ok: false as const, code: 422, reason: verdict.reason }

    await trx.insertInto('work_reports').values({
      id: randomUUID(), work_order_id: args.orderId, runner_id: args.runnerId,
      fencing_token: args.fencingToken, kind: args.kind, percent: args.percent,
      summary: args.summary, artifact_url: args.artifactUrl, created_at: new Date(),
    }).execute()

    if (args.kind !== 'failure') {
      await trx.updateTable('wbs_items')
        .set({ actual_pct: args.percent!, updated_at: new Date() })
        .where('id', '=', order.wbs_item_id).execute()
    }
    if (args.kind === 'completion') {
      await trx.updateTable('work_orders')
        .set({ status: 'reported', updated_at: new Date() })
        .where('id', '=', args.orderId).execute()
    }
    return { ok: true as const }
  })
}
```

`src/routes/internal/agent.ts` 에 라우트 추가:

```typescript
  app.post<{ Params: { id: string }; Body: {
    fencingToken: number; kind: 'progress' | 'completion' | 'failure'
    percent?: number | null; summary?: string | null; artifactUrl?: string | null
  } }>('/api/v1/agent/work/:id/report', async (req, reply) => {
    const runnerId = (req as { runnerId?: string }).runnerId!
    const r = await submitReport({
      orderId: req.params.id, runnerId, fencingToken: req.body.fencingToken,
      kind: req.body.kind, percent: req.body.percent ?? null,
      summary: req.body.summary ?? null, artifactUrl: req.body.artifactUrl ?? null,
    })
    return r.ok ? { ok: true } : reply.code(r.code).send({ error: r.reason })
  })
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/routes/report.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/repo/workOrders.ts src/routes/internal/agent.ts tests/routes/report.test.ts
git commit -m "feat: 보고 엔드포인트 — fencing 검증으로 뒤늦은 보고 차단(S4)"
```

---

### Task 10: lease 회수와 claim 상한 → blocked (S3·S4)

**Files:**

- Modify: `src/core/repo/workOrders.ts`
- Test: `tests/core/repo/reclaim.test.ts`

**Interfaces:**

- Consumes: `claimNext` (Task 7)
- Produces: `reclaimExpired(now: Date): Promise<number>` (회수 건수) · `claimNext` 가 상한 도달 시 `blocked` 로 전이

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/core/repo/reclaim.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { runMigrations } from '../../../src/db/migrate.js'
import { claimNext, reclaimExpired } from '../../../src/core/repo/workOrders.js'
import { seedProjectWithOrders } from '../../helpers/seed.js'
import { getDb } from '../../../src/db/connection.js'

describe('lease 회수와 claim 상한', () => {
  beforeAll(async () => { await runMigrations('migrations') })

  it('만료된 lease 를 ready 로 되돌린다', async () => {
    const { projectId, runnerId } = await seedProjectWithOrders(1)
    const c = (await claimNext(projectId, runnerId, 30))!
    await getDb().updateTable('work_orders')
      .set({ lease_expires_at: new Date(Date.now() - 60_000) })
      .where('id', '=', c.orderId).execute()

    expect(await reclaimExpired(new Date())).toBe(1)
    const row = await getDb().selectFrom('work_orders').select(['status', 'claimed_by'])
      .where('id', '=', c.orderId).executeTakeFirstOrThrow()
    expect(row.status).toBe('ready')
    expect(row.claimed_by).toBeNull()
  })

  it('claim 상한에 도달하면 blocked 이 되고 큐에서 빠진다', async () => {
    const { projectId, runnerId } = await seedProjectWithOrders(1)
    // max_claims 기본 3. 침묵 실패를 3회 흉내낸다 — 보고는 한 건도 없다.
    for (let i = 0; i < 3; i++) {
      const c = await claimNext(projectId, runnerId, 30)
      expect(c).not.toBeNull()
      await getDb().updateTable('work_orders')
        .set({ lease_expires_at: new Date(Date.now() - 60_000) })
        .where('id', '=', c!.orderId).execute()
      await reclaimExpired(new Date())
    }
    expect(await claimNext(projectId, runnerId, 30)).toBeNull()

    const rows = await getDb().selectFrom('work_orders').select(['status', 'claim_count'])
      .where('project_id', '=', projectId).execute()
    expect(rows[0].status).toBe('blocked')
    expect(rows[0].claim_count).toBe(3)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/core/repo/reclaim.test.ts`
Expected: FAIL — `reclaimExpired` 없음

- [ ] **Step 3: 구현**

`src/core/repo/workOrders.ts` 에 추가:

```typescript
export async function reclaimExpired(now: Date): Promise<number> {
  const r = await sql<{ affected: number }>`
    update work_orders
    set status = case when claim_count >= max_claims then 'blocked' else 'ready' end,
        claimed_by = null,
        lease_expires_at = null,
        updated_at = utc_timestamp(3)
    where status = 'claimed' and lease_expires_at is not null and lease_expires_at < ${now}
  `.execute(getDb())
  return Number(r.numAffectedRows ?? 0)
}
```

그리고 `claimNext` 의 조회 조건 `claim_count < max_claims` 가 상한 도달분을 이미 제외한다. 회수 시점에 `blocked` 로 확정하는 것이 위 `case` 문이다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/core/repo/reclaim.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/repo/workOrders.ts tests/core/repo/reclaim.test.ts
git commit -m "feat: lease 회수와 claim 상한 — 침묵 실패도 세어 blocked 으로 보낸다(S3)"
```

---

### Task 11: 사람 세션 인증

**Files:**

- Create: `src/core/auth/session.ts` · `migrations/0003_sessions.sql`
- Modify: `src/db/schema.ts`
- Test: `tests/core/auth/session.test.ts`

**Interfaces:**

- Consumes: `users` (Task 2)
- Produces: `login(email: string, password: string): Promise<string | null>` (세션 토큰) · `resolveSession(token: string): Promise<string | null>` (user id) · `logout(token: string): Promise<void>`

- [ ] **Step 1: 마이그레이션 작성**

`migrations/0003_sessions.sql`:

```sql
create table sessions (
  id char(36) primary key,
  user_id char(36) not null,
  token_hash varchar(255) not null,
  expires_at datetime(3) not null,
  created_at datetime(3) not null,
  foreign key (user_id) references users(id)
) engine=innodb;
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/core/auth/session.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { hash } from '@node-rs/argon2'
import { runMigrations } from '../../../src/db/migrate.js'
import { login, resolveSession, logout } from '../../../src/core/auth/session.js'
import { getDb } from '../../../src/db/connection.js'

async function makeUser(password: string) {
  const id = randomUUID()
  const email = `${id}@test.local`
  await getDb().insertInto('users').values({
    id, email, name: 'tester', password_hash: await hash(password), created_at: new Date(),
  }).execute()
  return { id, email }
}

describe('session', () => {
  beforeAll(async () => { await runMigrations('migrations') })

  it('올바른 비밀번호로 로그인된다', async () => {
    const u = await makeUser('correct-horse')
    const token = await login(u.email, 'correct-horse')
    expect(token).not.toBeNull()
    expect(await resolveSession(token!)).toBe(u.id)
  })

  it('틀린 비밀번호는 null 이다', async () => {
    const u = await makeUser('correct-horse')
    expect(await login(u.email, 'wrong')).toBeNull()
  })

  it('로그아웃하면 세션이 죽는다', async () => {
    const u = await makeUser('correct-horse')
    const token = (await login(u.email, 'correct-horse'))!
    await logout(token)
    expect(await resolveSession(token)).toBeNull()
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/core/auth/session.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 구현**

`src/core/auth/session.ts`:

```typescript
import { randomBytes, randomUUID } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'
import { getDb } from '../../db/connection.js'

const SESSION_DAYS = 14

export async function login(email: string, password: string): Promise<string | null> {
  const user = await getDb().selectFrom('users').select(['id', 'password_hash'])
    .where('email', '=', email).executeTakeFirst()
  if (!user) return null
  let ok = false
  try { ok = await verify(user.password_hash, password) } catch { ok = false }
  if (!ok) return null

  const sessionId = randomUUID()
  const secret = randomBytes(32).toString('base64url')
  await getDb().insertInto('sessions').values({
    id: sessionId, user_id: user.id, token_hash: await hash(secret),
    expires_at: new Date(Date.now() + SESSION_DAYS * 86_400_000), created_at: new Date(),
  }).execute()
  return `${sessionId}.${secret}`
}

export async function resolveSession(token: string): Promise<string | null> {
  const sep = token.indexOf('.')
  if (sep <= 0) return null
  const row = await getDb().selectFrom('sessions').select(['user_id', 'token_hash', 'expires_at'])
    .where('id', '=', token.slice(0, sep)).executeTakeFirst()
  if (!row || row.expires_at.getTime() < Date.now()) return null
  try {
    return (await verify(row.token_hash, token.slice(sep + 1))) ? row.user_id : null
  } catch { return null }
}

export async function logout(token: string): Promise<void> {
  const sep = token.indexOf('.')
  if (sep <= 0) return
  await getDb().deleteFrom('sessions').where('id', '=', token.slice(0, sep)).execute()
}
```

`src/db/schema.ts` 에 `SessionsTable` 을 추가하고 `DB` 에 `sessions` 를 넣는다:

```typescript
export interface SessionsTable {
  id: string; user_id: string; token_hash: string; expires_at: Date; created_at: Date
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/core/auth/session.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: 커밋**

```bash
git add migrations/0003_sessions.sql src/core/auth/session.ts src/db/schema.ts tests/core/auth/session.test.ts
git commit -m "feat: 사람 세션 인증 — argon2, 세션 토큰 해시 저장"
```

---

### Task 12: 승인 — S1 과 S6

**Files:**

- Create: `src/core/repo/approval.ts` · `src/routes/public/approval.ts`
- Modify: `src/server.ts`
- Test: `tests/core/repo/approval.test.ts`

**Interfaces:**

- Consumes: `submitReport` (Task 9), `resolveSession` (Task 11), `rollup` (Task 3)
- Produces: `approve(args: { orderId: string; approverId: string }): Promise<{ ok: true; selfApproved: boolean } | { ok: false; code: number; reason: string }>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/core/repo/approval.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { runMigrations } from '../../../src/db/migrate.js'
import { claimNext, submitReport } from '../../../src/core/repo/workOrders.js'
import { approve } from '../../../src/core/repo/approval.js'
import { seedProjectWithOrders } from '../../helpers/seed.js'
import { getDb } from '../../../src/db/connection.js'

async function makeUser() {
  const id = randomUUID()
  await getDb().insertInto('users').values({
    id, email: `${id}@t.local`, name: 'u', password_hash: 'x', created_at: new Date(),
  }).execute()
  return id
}

describe('approve', () => {
  beforeAll(async () => { await runMigrations('migrations') })

  it('승인하면 100% 가 되고 상태가 approved 다', async () => {
    const { projectId, itemId, runnerId } = await seedProjectWithOrders(1)
    const approver = await makeUser()
    await getDb().updateTable('wbs_items').set({ assignee_id: approver }).where('id', '=', itemId).execute()

    const c = (await claimNext(projectId, runnerId, 30))!
    await submitReport({
      orderId: c.orderId, runnerId, fencingToken: c.fencingToken,
      kind: 'completion', percent: 99, summary: 'done', artifactUrl: 'https://example/pr/1',
    })

    const r = await approve({ orderId: c.orderId, approverId: approver })
    expect(r.ok).toBe(true)

    const item = await getDb().selectFrom('wbs_items').select('actual_pct')
      .where('id', '=', itemId).executeTakeFirstOrThrow()
    expect(Number(item.actual_pct)).toBe(100)
  })

  it('보고되지 않은 주문은 승인할 수 없다', async () => {
    const { projectId, itemId, runnerId } = await seedProjectWithOrders(1)
    const approver = await makeUser()
    await getDb().updateTable('wbs_items').set({ assignee_id: approver }).where('id', '=', itemId).execute()
    const c = (await claimNext(projectId, runnerId, 30))!
    const r = await approve({ orderId: c.orderId, approverId: approver })
    expect(r).toEqual({ ok: false, code: 409, reason: 'not_reported' })
  })

  it('러너 소유자가 승인하면 self_approved 로 기록된다', async () => {
    const { projectId, itemId, runnerId, ownerId } = await seedProjectWithOrders(1)
    // 담당자와 러너 소유자가 같은 사람인 경우 — 2~5명 팀의 실제 모습이다
    await getDb().updateTable('wbs_items').set({ assignee_id: ownerId }).where('id', '=', itemId).execute()
    const c = (await claimNext(projectId, runnerId, 30))!
    await submitReport({
      orderId: c.orderId, runnerId, fencingToken: c.fencingToken,
      kind: 'completion', percent: 99, summary: null, artifactUrl: null,
    })
    const r = await approve({ orderId: c.orderId, approverId: ownerId })
    expect(r).toEqual({ ok: true, selfApproved: true })

    const row = await getDb().selectFrom('work_orders').select('self_approved')
      .where('id', '=', c.orderId).executeTakeFirstOrThrow()
    expect(row.self_approved).toBe(1)
  })

  it('제3자가 승인하면 self_approved 가 아니다', async () => {
    const { projectId, itemId, runnerId } = await seedProjectWithOrders(1)
    const approver = await makeUser() // 러너 소유자가 아닌 사람
    await getDb().updateTable('wbs_items').set({ assignee_id: approver }).where('id', '=', itemId).execute()
    const c = (await claimNext(projectId, runnerId, 30))!
    await submitReport({
      orderId: c.orderId, runnerId, fencingToken: c.fencingToken,
      kind: 'completion', percent: 99, summary: null, artifactUrl: null,
    })
    expect(await approve({ orderId: c.orderId, approverId: approver })).toEqual({ ok: true, selfApproved: false })
  })

  it('담당자가 아니면 거부한다', async () => {
    const { projectId, itemId, runnerId } = await seedProjectWithOrders(1)
    const owner = await makeUser()
    const stranger = await makeUser()
    await getDb().updateTable('wbs_items').set({ assignee_id: owner }).where('id', '=', itemId).execute()
    const c = (await claimNext(projectId, runnerId, 30))!
    await submitReport({
      orderId: c.orderId, runnerId, fencingToken: c.fencingToken,
      kind: 'completion', percent: 99, summary: null, artifactUrl: null,
    })
    const r = await approve({ orderId: c.orderId, approverId: stranger })
    expect(r).toEqual({ ok: false, code: 403, reason: 'not_assignee' })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/core/repo/approval.test.ts`
Expected: FAIL — `approve` 없음

- [ ] **Step 3: 구현**

`src/core/repo/approval.ts`:

```typescript
import { getDb } from '../../db/connection.js'
import { rollup, type RollupNode } from '../domain/rollup.js'

export async function approve(args: { orderId: string; approverId: string }):
  Promise<{ ok: true; selfApproved: boolean } | { ok: false; code: number; reason: string }> {
  return getDb().transaction().execute(async trx => {
    const order = await trx.selectFrom('work_orders')
      .select(['id', 'wbs_item_id', 'project_id', 'status'])
      .where('id', '=', args.orderId).forUpdate().executeTakeFirst()
    if (!order) return { ok: false as const, code: 404, reason: 'order_not_found' }
    if (order.status !== 'reported') return { ok: false as const, code: 409, reason: 'not_reported' }

    const item = await trx.selectFrom('wbs_items').select(['assignee_id'])
      .where('id', '=', order.wbs_item_id).executeTakeFirstOrThrow()
    if (item.assignee_id !== args.approverId) {
      return { ok: false as const, code: 403, reason: 'not_assignee' }
    }

    // 자기 승인을 금지하지 않는다 — 2~5명 팀에서 금지하면 1인 운영이 막힌다.
    // 대신 기록해서 목록 화면에 드러낸다. 통제 없는 승인과 보이는 승인은 다르다.
    // 판정 기준: 이 주문에 보고한 러너 중 하나라도 승인자가 소유한 러너인가.
    const owners = await trx.selectFrom('work_reports')
      .innerJoin('runners', 'runners.id', 'work_reports.runner_id')
      .select('runners.owner_user_id')
      .where('work_reports.work_order_id', '=', args.orderId)
      .execute()
    const selfApproved = owners.some(o => o.owner_user_id === args.approverId)

    await trx.updateTable('wbs_items')
      .set({ actual_pct: 100, updated_at: new Date() })
      .where('id', '=', order.wbs_item_id).execute()

    await trx.updateTable('work_orders')
      .set({ status: 'approved', self_approved: selfApproved ? 1 : 0, updated_at: new Date() })
      .where('id', '=', args.orderId).execute()

    // 부모 롤업
    const all = await trx.selectFrom('wbs_items')
      .select(['id', 'parent_id', 'actual_pct'])
      .where('project_id', '=', order.project_id).where('archived', '=', 0).execute()
    const nodes: RollupNode[] = all.map(r => ({
      id: r.id, parentId: r.parent_id, actualPct: Number(r.actual_pct),
    }))
    const computed = rollup(nodes)
    for (const n of nodes) {
      const v = computed.get(n.id)
      if (v !== undefined && v !== n.actualPct) {
        await trx.updateTable('wbs_items').set({ actual_pct: v, updated_at: new Date() })
          .where('id', '=', n.id).execute()
      }
    }

    return { ok: true as const, selfApproved }
  })
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/core/repo/approval.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 승인 라우트와 CSRF**

`src/routes/public/approval.ts`:

```typescript
import type { FastifyInstance } from 'fastify'
import { resolveSession } from '../../core/auth/session.js'
import { approve } from '../../core/repo/approval.js'

export async function approvalRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/api/orders/:id/approve', async (req, reply) => {
    // CSRF: 상태 변경 요청은 동일 출처에서만 받는다.
    const site = req.headers['sec-fetch-site']
    if (site !== undefined && site !== 'same-origin') {
      return reply.code(403).send({ error: 'cross_site_forbidden' })
    }
    const token = (req.cookies as Record<string, string> | undefined)?.session
    const userId = token ? await resolveSession(token) : null
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const r = await approve({ orderId: req.params.id, approverId: userId })
    return r.ok ? { ok: true, selfApproved: r.selfApproved } : reply.code(r.code).send({ error: r.reason })
  })
}
```

`src/server.ts` 에서 공개 평면에만 등록한다:

```typescript
import { approvalRoutes } from './routes/public/approval.js'
// ...
  if (opts.plane === 'public') app.register(approvalRoutes)
```

`@fastify/cookie` 를 설치하고 등록한다: `npm i @fastify/cookie`

- [ ] **Step 6: 커밋**

```bash
git add src/core/repo/approval.ts src/routes/public/approval.ts src/server.ts tests/core/repo/approval.test.ts
git commit -m "feat: 승인 — 담당자만, 100% 는 승인 전용(S1), 자기 승인은 기록(S6)"
```

---

### Task 13: 모듈 경계 정적 테스트

**Files:**

- Create: `tests/architecture/module-boundary.test.ts`
- Test: 자기 자신

**Interfaces:**

- Consumes: 없음 (파일시스템만 읽는다)
- Produces: 없음 (가드 테스트)

- [ ] **Step 1: 테스트 작성**

`tests/architecture/module-boundary.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const p = join(dir, entry)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
  })
}

describe('module boundary', () => {
  it('코어 소스는 모듈을 참조하지 않는다', () => {
    const offenders = walk('src/core')
      .filter(f => readFileSync(f, 'utf8').includes('mod_'))
    expect(offenders).toEqual([])
  })

  it('코어 도메인은 DB 를 모른다', () => {
    const offenders = walk('src/core/domain')
      .filter(f => {
        const body = readFileSync(f, 'utf8')
        return body.includes('kysely') || body.includes('getDb')
      })
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: 실행하여 통과 확인**

Run: `npx vitest run tests/architecture/module-boundary.test.ts`
Expected: PASS (2 tests) — 위반이 있으면 어느 파일인지 목록으로 나온다

- [ ] **Step 3: 전체 테스트 실행**

Run: `npx vitest run`
Expected: 전 테스트 PASS

- [ ] **Step 4: 커밋**

```bash
git add tests/architecture/module-boundary.test.ts
git commit -m "test: 모듈 경계를 문서가 아니라 테스트로 강제한다"
```

---

## 이 계획이 끝나면 증명되는 것

스펙 §11의 1차 완료 조건 중 **4개**가 여기서 충족된다.


| 완료 조건                         | 충족 태스크    |
| ----------------------------- | --------- |
| 2. S2 — `progress 0`·하향 보고 거부 | Task 8·9  |
| 3. S3 — claim 상한 → `blocked`  | Task 10   |
| 4. S4 — 옛 fencing 토큰 보고 거부    | Task 9·10 |
| 5. 경계 — 공개 경로에서 러너 API 404    | Task 6    |


**남는 조건 둘은 후속 계획이 담당한다** — 조건 1(성공 경로 E2E)은 러너 클라이언트 계획, 조건 6(복구 리허설)은 배포·운영 계획.

## 후속 계획 (이 계획이 돌아간 뒤 작성)


| 계획          | 범위                                                              | 선행   |
| ----------- | --------------------------------------------------------------- | ---- |
| P2 러너 클라이언트 | 맥북 러너: claim → Claude Code 구동 → PR 생성 → 보고. 타임아웃·워크트리 정리·디스크 하한 | 이 계획 |
| P3 웹 UI     | WBS 트리 화면, 작업 목록, 승인 화면, 로그인. `self_approved` 표시                | 이 계획 |
| P4 엑셀 임포트   | 프로필, 계층 3방식 파서, 병합 셀 forward-fill, 재임포트 행 매칭                    | P3   |
| P5 배포·운영    | 맥미니 설치, Tailscale/Cloudflare 평면, 백업·복구 리허설, macOS 무인 운영         | P2   |


계획을 나눈 이유는 각각이 **독립적으로 동작하는 소프트웨어**를 내놓기 때문이다. 이 계획만 끝나도 서버는 돌고, API로 루프 전체를 검증할 수 있다.