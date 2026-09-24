// tests/skills/dflow-merge-migration.test.ts
// 마이그레이션 버전 관문(2026-09-24 dmes-standard mdm): 병렬 브랜치가 같은 Flyway 버전을 고르면 파일명이 달라 git 충돌 없이
// 머지되고 개발 브랜치에서 Flyway 가 기동에 실패한다. /dflow-merge 가 dflow-merge/scripts/migration-check.sh 로 머지 전에 잡아
// 해소 워커(R9 재채번)로 넘긴다. 문서 계약 + 실제 git 샌드박스.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const SCRIPT = join(ROOT, '.claude/skills/dflow-merge/scripts/migration-check.sh')
const MERGE = readFileSync(join(ROOT, '.claude/skills/dflow-merge/SKILL.md'), 'utf8')
const RESOLVE = readFileSync(join(ROOT, '.claude/skills/dflow-team/references/resolve-prompt.md'), 'utf8')
const DISC = readFileSync(join(ROOT, '.claude/skills/dflow-dev/references/dev-discipline.md'), 'utf8')

const GIT_ENV: Record<string, string | undefined> = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}
delete GIT_ENV.DFLOW_MIGRATION_OUT_OF_ORDER
function sh(cwd: string, script: string, env: Record<string, string> = {}) {
  const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', env: { ...GIT_ENV, S: SCRIPT, ...env } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const SQ = 'api/src/main/resources/db/migration/mdm/sqlite'
const MS = 'api/src/main/resources/db/migration/mdm/mssql'
let tmp: string, repo: string
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-migration-')))
  repo = join(tmp, 'repo')
  const r = sh(tmp, `
    set -e
    git init -q --bare -b main origin.git
    git clone -q origin.git repo 2>/dev/null
    cd repo && git checkout -q -b main
    mkdir -p ${SQ} ${MS}
    for d in ${SQ} ${MS}; do
      printf 'create table a(x int);\\n' > $d/V1__baseline.sql
      printf 'create table b(x int);\\n' > $d/V2__create_mdm_system.sql
      printf 'create table c(x int);\\n' > $d/V3__create_mdm_term_domain_column.sql
      printf 'create table r(x int);\\n' > $d/R__views.sql
    done
    git add . && git commit -qm base && git push -q origin main
    # 같은 기점(V3)에서 갈라진 브랜치들
    git switch -q -c agent/aaaaaaaa-a
    for d in ${SQ} ${MS}; do printf 'create index i on c(x);\\n' > $d/V4__term_abbr_index_relax.sql; done
    printf "flyway target V4__term_abbr_index_relax\\n" > design.md
    git add . && git commit -qm a && git push -q origin agent/aaaaaaaa-a
    git switch -q main && git switch -q -c agent/cccccccc-c
    printf 'x\\n' > c.txt && git add c.txt && git commit -qm c && git push -q origin agent/cccccccc-c
    # 개발 브랜치가 먼저 V4 를 받는다
    git switch -q main
    for d in ${SQ} ${MS}; do printf 'create table l(x int);\\n' > $d/V4__create_mdm_interface_layout.sql; done
    git add . && git commit -qm dev-v4 && git push -q origin main
    # V4 뒤에서 갈라졌지만 V3_1 을 고른 브랜치(역순 도착), V5 를 고른 브랜치(정상)
    git switch -q -c agent/bbbbbbbb-b
    printf 'x;\\n' > ${SQ}/V3_1__hotfix.sql && git add . && git commit -qm b && git push -q origin agent/bbbbbbbb-b
    git switch -q main && git switch -q -c agent/dddddddd-d
    printf 'x;\\n' > ${SQ}/V5__add_col.sql && printf 'x;\\n' > ${MS}/V5__add_col.sql && git add . && git commit -qm d && git push -q origin agent/dddddddd-d
    git switch -q main
  `)
  expect(r.code, r.out).toBe(0)
}, 30000)
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('migration-check.sh — 머지 전 관문(실제 git)', { timeout: 30000 }, () => {
  it('실측 모양: 같은 V4 를 고른 브랜치는 git 충돌 없이 머지된다 — 그래서 관문이 필요하다', () => {
    const r = sh(repo, `git merge --no-ff -q origin/agent/aaaaaaaa-a -m m; echo "merge=$?"; ls ${SQ} | grep -c '^V4__'`)
    expect(r.out).toContain('merge=0')
    expect(r.out).toContain('2\n')
  })
  it('버전 중복(DUP): 폴더마다 잡고, 걸린 브랜치 파일을 MIGRATION_FILES 로 낸다(exit 1)', () => {
    const r = sh(repo, `sh "$S" HEAD origin/agent/aaaaaaaa-a; echo "exit=$?"`)
    expect(r.out).toContain(`MIGRATION_DUP ${SQ} V4 V4__create_mdm_interface_layout.sql,V4__term_abbr_index_relax.sql`)
    expect(r.out).toContain(`MIGRATION_DUP ${MS} V4 V4__create_mdm_interface_layout.sql,V4__term_abbr_index_relax.sql`)
    expect(r.out).toContain(`MIGRATION_FILES ${MS}/V4__term_abbr_index_relax.sql,${SQ}/V4__term_abbr_index_relax.sql`)
    expect(r.out).toContain('exit=1')
  })
  it('역순 도착(ORDER): 개발 브랜치 최대 V4 보다 작은 V3.1 을 더하면 막는다', () => {
    const r = sh(repo, `sh "$S" HEAD origin/agent/bbbbbbbb-b; echo "exit=$?"`)
    expect(r.out).toContain(`MIGRATION_ORDER ${SQ} V3_1__hotfix.sql V3.1 <= V4`)
    expect(r.out).toContain(`MIGRATION_FILES ${SQ}/V3_1__hotfix.sql`)
    expect(r.out).toContain('exit=1')
  })
  it('outOfOrder 를 쓰는 리포는 --allow-out-of-order(또는 DFLOW_MIGRATION_OUT_OF_ORDER=1)로 ORDER 만 끈다. DUP 은 늘 본다', () => {
    expect(sh(repo, `sh "$S" --allow-out-of-order HEAD origin/agent/bbbbbbbb-b; echo "exit=$?"`).out).toBe('MIGRATION_OK\nexit=0\n')
    expect(sh(repo, `sh "$S" HEAD origin/agent/bbbbbbbb-b; echo "exit=$?"`, { DFLOW_MIGRATION_OUT_OF_ORDER: '1' }).out).toBe('MIGRATION_OK\nexit=0\n')
    expect(sh(repo, `sh "$S" --allow-out-of-order HEAD origin/agent/aaaaaaaa-a; echo "exit=$?"`).out).toContain('exit=1')
  })
  it('다음 번호(V5)·마이그레이션 없는 브랜치는 통과한다. 방언 폴더끼리 같은 버전(sqlite·mssql V5)은 중복이 아니다. R__ 는 보지 않는다', () => {
    expect(sh(repo, `sh "$S" HEAD origin/agent/dddddddd-d; echo "exit=$?"`).out).toBe('MIGRATION_OK\nexit=0\n')
    expect(sh(repo, `sh "$S" HEAD origin/agent/cccccccc-c; echo "exit=$?"`).out).toBe('MIGRATION_OK\nexit=0\n')
  })
  it('Flyway 버전 규칙: V04·V4_0·V4.0 은 V4 와 같고, 큰 타임스탬프 버전도 자리수로 바르게 비교한다', () => {
    const r = sh(repo, `
      set -e
      for v in V04__a V4_0__b V4.0__c; do
        git switch -q -c t-$v main && printf 'x;\\n' > ${SQ}/$v.sql && git add . && git commit -qm $v
        sh "$S" main t-$v | head -n 1
      done
      git switch -q -c ts main && printf 'x;\\n' > ${SQ}/V20260924120000__big.sql && git add . && git commit -qm big && git switch -q main && git merge -q --no-ff ts -m ts
      git switch -q -c ts2 HEAD~1 && printf 'x;\\n' > ${SQ}/V9999999999999__less.sql && printf 'x;\\n' > ${MS}/V202609241200001__more.sql && git add . && git commit -qm ts2
      sh "$S" main ts2 || true
    `)
    expect(r.out).toContain(`MIGRATION_DUP ${SQ} V4 V4__create_mdm_interface_layout.sql,V04__a.sql`)
    expect(r.out).toContain(`MIGRATION_DUP ${SQ} V4 V4__create_mdm_interface_layout.sql,V4_0__b.sql`)
    expect(r.out).toContain(`MIGRATION_DUP ${SQ} V4 V4__create_mdm_interface_layout.sql,V4.0__c.sql`)
    // 13자리 < 14자리(개발 브랜치 최대 20260924120000) → 역순, mssql 폴더의 15자리는 정상
    expect(r.out).toContain(`MIGRATION_ORDER ${SQ} V9999999999999__less.sql V9999999999999 <= V20260924120000`)
    expect(r.out).not.toContain('V202609241200001__more.sql V')
  })
  it('개발 브랜치 자체의 중복은 경고(MIGRATION_DEV_DUP)만 하고 이 머지를 막지 않는다', () => {
    const r = sh(repo, `
      printf 'x;\\n' > ${SQ}/V4__oops.sql && git add . && git commit -qm oops
      sh "$S" HEAD origin/agent/cccccccc-c; echo "exit=$?"
    `)
    expect(r.out).toContain(`MIGRATION_DEV_DUP ${SQ} V4 V4__create_mdm_interface_layout.sql,V4__oops.sql`)
    expect(r.out).toContain('MIGRATION_OK')
    expect(r.out).toContain('exit=0')
  })
  it('판정 불가는 exit 2(MIGRATION_CHECK_FAILED) — 호출자는 머지하지 않는다', () => {
    const r = sh(repo, `sh "$S" HEAD origin/agent/nope; echo "exit=$?"`)
    expect(r.out).toContain('MIGRATION_CHECK_FAILED no-ref origin/agent/nope')
    expect(r.out).toContain('exit=2')
  })
})

describe('해소 트리(--staged) — R9 재채번 뒤 게이트가 통과한다', { timeout: 30000 }, () => {
  it('커밋 없이 머지한 트리에서 DUP 을 잡고, git mv 로 V5 로 옮기고 참조를 고치면 통과한다', () => {
    const r = sh(repo, `
      git -c rerere.enabled=true merge --no-ff --no-commit origin/agent/aaaaaaaa-a >/dev/null 2>&1; echo "merge=$?"
      git diff --name-only --diff-filter=U | wc -l | tr -d ' '
      sh "$S" --staged; echo "before=$?"
      for d in ${SQ} ${MS}; do git mv $d/V4__term_abbr_index_relax.sql $d/V5__term_abbr_index_relax.sql; done
      sed -i.bak 's/V4__term_abbr_index_relax/V5__term_abbr_index_relax/' design.md && rm design.md.bak && git add design.md
      sh "$S" --staged; echo "after=$?"
      git grep -n 'V4__term_abbr_index_relax' -- . || echo NO_OLD_REFS
    `)
    expect(r.out).toContain('merge=0')
    expect(r.out).toMatch(/merge=0\n0\n/)                      // 텍스트 충돌 0 — 해소 워커가 files=0 으로 받는다
    expect(r.out).toContain(`MIGRATION_DUP ${SQ} V4`)
    expect(r.out).toContain('before=1')
    expect(r.out).toContain('MIGRATION_OK\nafter=0')
    expect(r.out).toContain('NO_OLD_REFS')
  })
})

describe('문서 계약 — 마이그레이션 버전 관문', () => {
  it('/dflow-merge: 스윕은 머지 전에 검사해 걸리면 머지 실패(충돌)로 해소 워커에 넘긴다', () => {
    expect(MERGE).toContain('\n## 마이그레이션 버전 관문\n')
    expect(MERGE).toContain('.claude/skills/dflow-merge/scripts/migration-check.sh HEAD <머지 대상>')
    expect(MERGE).toContain('머지 실패(충돌) <MIGRATION_FILES 의 파일,…> (마이그레이션 버전)')
    // 관문은 git merge 보다 앞(2단계)이다
    const step2 = MERGE.indexOf('**마이그레이션 버전 관문**: ')
    expect(step2).toBeGreaterThan(0)
    expect(step2).toBeLessThan(MERGE.indexOf('   3. `git merge --no-ff <머지 대상>`.'))
  })
  it('/dflow-merge --resolve: 머지 뒤 --staged 로 찾아 R9 로 풀고, 게이트에서 다시 본다', () => {
    const r = MERGE.slice(MERGE.indexOf('## 해소 머지(`--resolve`)'), MERGE.indexOf('## 금지'))
    const four = r.slice(r.indexOf('4. **머지·해소·stage**'), r.indexOf('5. **게이트**'))
    const five = r.slice(r.indexOf('5. **게이트**'), r.indexOf('6. **기록·커밋**'))
    expect(four).toContain('migration-check.sh --staged')
    expect(four).toContain('R9')
    expect(five).toContain('migration-check.sh --staged')
  })
  it('resolve-prompt: R9 재채번 규약이 있고, blocked 규칙은 이미 적용된 마이그레이션으로 좁혀졌다', () => {
    expect(RESOLVE).toContain('| R9 |')
    expect(RESOLVE).toContain('git mv')
    expect(RESOLVE).not.toContain('마이그레이션 파일이 충돌하거나 번호가 겹친다(적용 이력과 얽혀 번호를 다시 매길 수 없다)')
    const blocked = RESOLVE.slice(RESOLVE.indexOf('### blocked 로 멈추는 경우'), RESOLVE.indexOf('## 게이트'))
    expect(blocked).toContain('R9')
  })
  it('dev-discipline: 버전을 고르기 전에 origin 개발 브랜치를 fetch 해 최대 버전을 본다(완화책)', () => {
    const sec = DISC.slice(DISC.indexOf('## 마이그레이션 버전(Flyway 등 파일명이 곧 버전인 경우)'))
    expect(sec.length).toBeGreaterThan(100)
    expect(sec).toContain('git fetch origin')
    expect(sec).toContain('/dflow-merge')
  })
})
