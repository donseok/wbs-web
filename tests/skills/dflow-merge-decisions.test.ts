// tests/skills/dflow-merge-decisions.test.ts
// 공용 결정 기록(decisions.md)의 번호를 머지 때 매긴다(2026-09-24 dmes-standard: 병렬 워커가 같은 D-020 을 골라 머지마다 충돌).
// 워커는 임시 ID D-<TSK>-<n> 을 쓰고, /dflow-merge 가 dflow-merge/scripts/decisions.sh 로 충돌을 풀고 번호를 매긴다.
// 문서 계약 + 실제 git 샌드박스(가짜 origin)에서 스크립트를 돌린다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const SCRIPT = join(ROOT, '.claude/skills/dflow-merge/scripts/decisions.sh')
const DLOG = join(ROOT, '.claude/skills/dflow-wbs/scripts/decision-log.py')
const MERGE = readFileSync(join(ROOT, '.claude/skills/dflow-merge/SKILL.md'), 'utf8')
const DISC = readFileSync(join(ROOT, '.claude/skills/dflow-dev/references/dev-discipline.md'), 'utf8')
const WORKER = readFileSync(join(ROOT, '.claude/skills/dflow-team/references/worker-prompt.md'), 'utf8')
const RESOLVE = readFileSync(join(ROOT, '.claude/skills/dflow-team/references/resolve-prompt.md'), 'utf8')
const TEAM = readFileSync(join(ROOT, '.claude/skills/dflow-team/SKILL.md'), 'utf8')

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}
function sh(cwd: string, script: string) {
  const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', env: { ...GIT_ENV, S: SCRIPT, DLOG } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

// 블록 한 개. 필드 줄(Phase·Reversible)이 블록끼리 같아야 union 이 섞는 모양이 재현된다.
const block = (id: string, ts: string) =>
  `\n## ${id} (${ts})\n- **Phase**: design\n- **Decision needed**: ${id} 질문\n- **Decision made**: ${id} 결정\n- **Rationale**: ${id} 근거\n- **Reversible**: yes\n`
const HEAD = '# Decisions Log — project\n\n> Append-only audit trail.\n'
const BASE_DOC = HEAD + block('D-001', '2026-09-20T00:00:00Z') + block('D-002', '2026-09-21T00:00:00Z')

let tmp: string, repo: string
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-decisions-')))
  repo = join(tmp, 'repo')
  const r = sh(tmp, `
    set -e
    git init -q --bare -b main origin.git
    git clone -q origin.git repo 2>/dev/null
    cd repo && git checkout -q -b main
    mkdir -p docs/mdm && printf '%b' ${JSON.stringify(BASE_DOC)} > docs/mdm/decisions.md
    printf 'x\\n' > a.txt && git add a.txt docs && git commit -qm init && git push -q origin main
    # A: TSK-01-02 — 임시 ID 둘, design.md 가 둘 다 참조
    git switch -q -c agent/aaaaaaaa-a
    printf '%b' ${JSON.stringify(block('D-TSK-01-02-1', '2026-09-24T01:00:00Z') + block('D-TSK-01-02-2', '2026-09-24T02:00:00Z'))} >> docs/mdm/decisions.md
    mkdir -p docs/tasks/TSK-01-02 && printf '결정 근거: decisions.md D-TSK-01-02-1~D-TSK-01-02-2\\n' > docs/tasks/TSK-01-02/design.md
    git add docs && git commit -qm a && git push -q origin agent/aaaaaaaa-a
    # B: TSK-02-03 — 같은 기점에서 임시 ID 하나
    git switch -q main && git switch -q -c agent/bbbbbbbb-b
    printf '%b' ${JSON.stringify(block('D-TSK-02-03-1', '2026-09-24T03:00:00Z'))} >> docs/mdm/decisions.md
    mkdir -p docs/tasks/TSK-02-03 && printf '근거 D-TSK-02-03-1 (D-TSK-02-03-10 은 없는 ID)\\n' > docs/tasks/TSK-02-03/design.md
    git add docs && git commit -qm b && git push -q origin agent/bbbbbbbb-b
    # C: TSK-03-01 — A 위에 쌓인 스택. 선행 A 의 임시 ID 를 참조하고 자기 것도 하나 더한다
    git switch -q -c agent/cccccccc-c agent/aaaaaaaa-a
    printf '%b' ${JSON.stringify(block('D-TSK-03-01-1', '2026-09-24T04:00:00Z'))} >> docs/mdm/decisions.md
    mkdir -p docs/tasks/TSK-03-01 && printf '선행 결정 D-TSK-01-02-1 을 따른다. 내 결정 D-TSK-03-01-1\\n' > docs/tasks/TSK-03-01/design.md
    git add docs && git commit -qm c && git push -q origin agent/cccccccc-c
    git switch -q main
  `)
  expect(r.code, r.out).toBe(0)
}, 30000)
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

// /dflow-merge 3단계 그대로: 머지 → 충돌이면 decisions.md 만 스크립트로 풀고, 남은 충돌이 없으면 커밋 → 번호 매김
const mergeStep = (ref: string, tsk: string) => `
  git merge --no-ff ${ref} -m "merge: ${tsk} x (approved)" -m "DFlow-Order: o-${tsk}" >/dev/null 2>&1 || {
    sh "$S" merge-conflicts
    left=$(git diff --name-only --diff-filter=U | paste -sd, -)
    if [ -n "$left" ]; then echo "LEFT=$left"; git merge --abort; exit 3; fi
    git commit -q --no-edit --cleanup=strip
  }
  sh "$S" renumber --tsk ${tsk} --order o-${tsk}
`
const doc = () => readFileSync(join(repo, 'docs/mdm/decisions.md'), 'utf8')
const validate = () => sh(repo, 'python3 "$DLOG" validate --target docs/mdm')

describe('decisions.sh — 머지 때 번호 매김(실제 git)', { timeout: 30000 }, () => {
  it('두 병렬 브랜치를 차례로 머지하면 decisions.md 충돌을 기계적으로 풀고 D-003·D-004·D-005 를 매긴다', () => {
    const a = sh(repo, mergeStep('origin/agent/aaaaaaaa-a', 'TSK-01-02'))
    expect(a.code, a.out).toBe(0)
    expect(a.out).toContain('RENUMBERED D-TSK-01-02-1=D-003 docs/mdm/decisions.md')
    expect(a.out).toContain('RENUMBERED D-TSK-01-02-2=D-004 docs/mdm/decisions.md')
    expect(a.out).toMatch(/COMMITTED [0-9a-f]{40}/)
    const b = sh(repo, mergeStep('origin/agent/bbbbbbbb-b', 'TSK-02-03'))
    expect(b.code, b.out).toBe(0)
    expect(b.out).toContain('DECISIONS_RESOLVED docs/mdm/decisions.md')   // 둘 다 끝에 덧붙여 충돌했다
    expect(b.out).toContain('RENUMBERED D-TSK-02-03-1=D-005 docs/mdm/decisions.md')
    // 블록 본문이 섞이지 않는다 — 원래 블록 그대로(본문 속 자기 임시 ID 참조도 치환)에 Temp ID 줄만 더해진다
    const numbered = (temp: string, num: string, ts: string) =>
      block(num, ts).replace(`## ${num} (${ts})\n`, `## ${num} (${ts})\n- **Temp ID**: ${temp}\n`)
    const want = HEAD + block('D-001', '2026-09-20T00:00:00Z') + block('D-002', '2026-09-21T00:00:00Z')
      + numbered('D-TSK-01-02-1', 'D-003', '2026-09-24T01:00:00Z')
      + numbered('D-TSK-01-02-2', 'D-004', '2026-09-24T02:00:00Z')
      + numbered('D-TSK-02-03-1', 'D-005', '2026-09-24T03:00:00Z')
    expect(doc()).toBe(want)
    // decision-log.py validate(동결된 dflow-wbs)는 규칙 변경 없이 통과한다
    const v = validate()
    expect(v.code, v.out).toBe(0)
    expect(v.out).toContain('"entry_count": 5')
    // 참조 치환: 전체 토큰만 바꾼다(D-TSK-02-03-10 은 D-TSK-02-03-1 의 접두 일치로 바뀌지 않는다)
    expect(readFileSync(join(repo, 'docs/tasks/TSK-01-02/design.md'), 'utf8')).toBe('결정 근거: decisions.md D-003~D-004\n')
    expect(readFileSync(join(repo, 'docs/tasks/TSK-02-03/design.md'), 'utf8')).toBe('근거 D-005 (D-TSK-02-03-10 은 없는 ID)\n')
    // 머지 커밋 메시지에 충돌 주석이 남지 않고 트레일러가 실린다. 번호 매김 커밋에도 트레일러
    const log = sh(repo, `git log -3 --format='%s|%(trailers:key=DFlow-Order,valueonly,separator=)' ; git log -2 --format=%B -n 1 HEAD~1`)
    expect(log.out).toContain('chore(TSK-02-03): 결정 번호 매김 (D-TSK-02-03-1→D-005)|o-TSK-02-03')
    expect(log.out).toContain('merge: TSK-02-03 x (approved)|o-TSK-02-03')
    expect(log.out).not.toContain('# Conflicts')
  })

  it('다시 돌리면 아무것도 하지 않는다(NO_TEMP_IDS, 커밋 없음). 임시 ID 가 없는 머지도 같다', () => {
    const r = sh(repo, `
      sh "$S" renumber; h1=$(git rev-parse HEAD)
      ${mergeStep('origin/agent/aaaaaaaa-a', 'TSK-01-02')}
      h2=$(git rev-parse HEAD); sh "$S" renumber; h3=$(git rev-parse HEAD)
      [ "$h2" = "$h3" ] && echo SECOND_RUN_NOOP
    `)
    expect(r.code, r.out).toBe(0)
    expect(r.out.split('\n')[0]).toBe('NO_TEMP_IDS')
    expect(r.out).toContain('SECOND_RUN_NOOP')
    expect(r.out.match(/NO_TEMP_IDS/g)?.length).toBe(2)
  })

  it('스택 후손이 선행의 임시 ID 를 참조해 두었으면, 선행이 번호를 받은 뒤에도 Temp ID 줄로 찾아 치환한다', () => {
    const r = sh(repo, mergeStep('origin/agent/aaaaaaaa-a', 'TSK-01-02') + mergeStep('origin/agent/cccccccc-c', 'TSK-03-01'))
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('RENUMBERED D-TSK-03-01-1=D-005 docs/mdm/decisions.md')
    expect(readFileSync(join(repo, 'docs/tasks/TSK-03-01/design.md'), 'utf8')).toBe('선행 결정 D-003 을 따른다. 내 결정 D-005\n')
    expect(doc()).toContain('## D-003 (2026-09-24T01:00:00Z)\n- **Temp ID**: D-TSK-01-02-1\n')
    expect(validate().code).toBe(0)
  })

  it('같은 임시 ID 머리가 둘이면 그 ID 만 건너뛰고(RENUMBER_DUP) 나머지는 매긴다 — 개발 브랜치의 잘못 하나가 모든 머지를 막지 않는다', () => {
    const r = sh(repo, `
      printf '%b' ${JSON.stringify(block('D-TSK-09-09-1', '2026-09-24T05:00:00Z') + block('D-TSK-09-09-1', '2026-09-24T06:00:00Z') + block('D-TSK-09-09-2', '2026-09-24T07:00:00Z'))} >> docs/mdm/decisions.md
      git commit -qam dup
      sh "$S" renumber; echo "exit=$?"
    `)
    expect(r.out).toContain('RENUMBER_DUP D-TSK-09-09-1')
    expect(r.out).toContain('RENUMBERED D-TSK-09-09-2=D-003 docs/mdm/decisions.md')
    expect(r.out).toContain('exit=0')
    expect(doc().match(/^## D-TSK-09-09-1 /gm)?.length).toBe(2)
  })

  it('.claude/ 아래 추적 파일(킷 복사형 리포의 스킬 문서·결정 기록 이름의 파일)은 건드리지 않는다', () => {
    const r = sh(repo, `
      mkdir -p .claude/skills/x && printf '예: D-TSK-01-02-1\\n' > .claude/skills/x/SKILL.md
      printf '## D-TSK-01-02-9 (2026-09-24T00:00:00Z)\\n- **Phase**: design\\n' > .claude/skills/x/decisions.md
      git add .claude && git commit -qm kit
      ${mergeStep('origin/agent/aaaaaaaa-a', 'TSK-01-02')}
      cat .claude/skills/x/SKILL.md .claude/skills/x/decisions.md
    `)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('RENUMBERED D-TSK-01-02-1=D-003 docs/mdm/decisions.md')
    expect(r.out).toContain('예: D-TSK-01-02-1\n## D-TSK-01-02-9 (2026-09-24T00:00:00Z)')
    expect(r.out).not.toContain('D-TSK-01-02-9=')
  })
  it('스택 후손이 다른 병렬 브랜치 뒤에 머지돼 decisions.md 가 충돌해도 선행 블록을 다시 붙이지 않고 자기 블록만 더한다', () => {
    const r = sh(repo, mergeStep('origin/agent/aaaaaaaa-a', 'TSK-01-02') + mergeStep('origin/agent/bbbbbbbb-b', 'TSK-02-03')
      + mergeStep('origin/agent/cccccccc-c', 'TSK-03-01'))
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('RENUMBERED D-TSK-03-01-1=D-006 docs/mdm/decisions.md')
    const d = doc()
    expect(d.match(/^## /gm)?.length).toBe(6)            // D-001~D-006, 선행 A 블록이 중복되지 않는다
    expect(d.match(/^- \*\*Temp ID\*\*: D-TSK-01-02-1$/gm)?.length).toBe(1)
    expect(readFileSync(join(repo, 'docs/tasks/TSK-03-01/design.md'), 'utf8')).toBe('선행 결정 D-003 을 따른다. 내 결정 D-006\n')
    const v = validate()
    expect(v.code, v.out).toBe(0)
    expect(v.out).toContain('"entry_count": 6')
  })
  it('커밋이 실패하면(RENUMBER_FAILED) 자기가 고친 파일을 되돌려 트리를 깨끗이 남긴다 — 호출자가 머지를 이어 가도 섞이지 않는다', () => {
    const r = sh(repo, `
      git merge -q --no-ff origin/agent/aaaaaaaa-a -m ma
      h=$(git rev-parse HEAD)
      printf '#!/bin/sh\\nexit 1\\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
      sh "$S" renumber --tsk TSK-01-02; echo "exit=$?"
      printf 'porcelain=[%s]\\n' "$(git status --porcelain)"
      [ "$(git rev-parse HEAD)" = "$h" ] && echo HEAD_SAME
      grep -c '^## D-TSK-01-02-' docs/mdm/decisions.md
    `)
    expect(r.out).toContain('RENUMBER_FAILED commit')
    expect(r.out).toContain('exit=1')
    expect(r.out).toContain('porcelain=[]')
    expect(r.out).toContain('HEAD_SAME')
    expect(r.out).toContain('\n2\n')
  })
  it('트리가 깨끗하지 않으면 손대지 않는다(RENUMBER_DIRTY, exit 1)', () => {
    const r = sh(repo, `printf 'y\\n' >> a.txt; sh "$S" renumber; echo "exit=$?"; git status --porcelain`)
    expect(r.out).toContain('RENUMBER_DIRTY')
    expect(r.out).toContain('exit=1')
    expect(r.out).toContain(' M a.txt')
  })

  it('merge-conflicts 는 decisions.md 만 풀고 다른 충돌은 그대로 둔다. 기존 블록을 고친 쪽은 풀지 않는다', () => {
    const r = sh(repo, `
      git switch -q -c agent/dddddddd-d origin/main
      printf 'agent\\n' > a.txt
      sed -i.bak 's/D-001 결정/D-001 결정(고침)/' docs/mdm/decisions.md && rm docs/mdm/decisions.md.bak
      printf '%b' ${JSON.stringify(block('D-TSK-04-01-1', '2026-09-24T08:00:00Z'))} >> docs/mdm/decisions.md
      git commit -qam d
      git switch -q main
      printf 'main\\n' > a.txt && printf '%b' ${JSON.stringify(block('D-003', '2026-09-24T09:00:00Z'))} >> docs/mdm/decisions.md && git commit -qam m
      git merge --no-ff agent/dddddddd-d >/dev/null 2>&1
      sh "$S" merge-conflicts
      git diff --name-only --diff-filter=U | sort | paste -sd, -
      git merge --abort
    `)
    expect(r.out).toContain('DECISIONS_LEFT docs/mdm/decisions.md edited-existing-block')
    expect(r.out).toContain('a.txt,docs/mdm/decisions.md')
  })

  it('판단 근거: merge=union 은 필드 줄을 공유하는 두 블록을 섞는다 — 그래서 권장하지 않고, 걸려 있으면 UNION_SET 로 알린다', () => {
    const r = sh(repo, `
      printf 'docs/**/decisions.md merge=union\\n' > .gitattributes && git add .gitattributes && git commit -qm attr
      git merge -q --no-ff origin/agent/aaaaaaaa-a -m ma
      git merge -q --no-ff origin/agent/bbbbbbbb-b -m mb; echo "merge=$?"
      sh "$S" renumber
    `)
    expect(r.out).toContain('merge=0')   // 충돌 없이 들어온다
    const d = doc()
    // D-TSK-01-02-2 블록의 "- **Reversible**: yes" 가 뒤 블록과 합쳐져 사라지고, 두 머리 사이 빈 줄도 없어진다
    const blk = d.slice(d.indexOf('D-TSK-01-02-2'), d.indexOf('D-TSK-02-03-1'))
    expect(blk).not.toContain('- **Reversible**: yes')
    expect(r.out).toContain('UNION_SET docs/mdm/decisions.md')
  })
})

describe('문서 계약 — 결정 번호는 머지 때 매긴다', () => {
  it('dev-discipline 에 임시 ID 규칙이 있다(Phase 서브에이전트가 읽는 정본)', () => {
    const sec = DISC.slice(DISC.indexOf('## 공용 결정 기록(decisions.md)의 번호'))
    expect(sec.length).toBeGreaterThan(100)
    expect(sec).toContain('`D-<TSK>-<n>`')
    expect(sec).toContain('## D-TSK-02-02-1 (2026-09-24T03:00:00Z)')
    expect(sec).toContain('**전역 번호 D-NNN 을 새로 매기지 않는다.**')
    expect(sec).toContain('Task 전체에서')
    expect(sec).toContain('`/dflow-merge`')
  })
  it('worker-prompt 「6」 은 D1·D2 와 D-NNN 이 다르다고 알리고 dev-discipline 을 가리킨다', () => {
    const six = WORKER.slice(WORKER.indexOf('## 6. 판단 규칙'), WORKER.indexOf('## 7. 보고'))
    expect(six).toContain('dev-discipline 「공용 결정 기록(decisions.md)의 번호」')
    expect(six).toContain('`D-NNN` 과 다르다')
  })
  it('/dflow-merge 가 머지 직후 번호를 매기고, 충돌하면 decisions.md 만 스크립트로 푼다. union 은 권하지 않는다', () => {
    expect(MERGE).toContain('.claude/skills/dflow-merge/scripts/decisions.sh merge-conflicts')
    expect(MERGE).toContain('.claude/skills/dflow-merge/scripts/decisions.sh renumber --tsk <TSK> --order <order>')
    expect(MERGE).toContain('git commit --no-edit --cleanup=strip')
    expect(MERGE).toContain('\n## 결정 번호 매김\n')
    expect(MERGE).toContain('`merge=union` 을 걸지 않는다')
    // 해소 경로에서도 머지 커밋 뒤 state.json 커밋 전에 번호를 매긴다
    const r = MERGE.slice(MERGE.indexOf('## 해소 머지(`--resolve`)'), MERGE.indexOf('## 금지'))
    expect(r.indexOf('decisions.sh renumber')).toBeGreaterThan(r.indexOf('6. **기록·커밋**'))
    expect(r.indexOf('decisions.sh renumber')).toBeLessThan(r.indexOf('7. **state.json**'))
  })
  it('resolve-prompt: decisions.md 충돌은 손으로 번호를 매기지 않는다', () => {
    expect(RESOLVE).toContain('decisions.sh merge-conflicts')
    expect(RESOLVE).toContain('번호를 손으로 매기지 않는다')
  })
  it('팀장 준비: union 대신 스크립트가 푼다는 안내가 있다', () => {
    expect(TEAM).toContain('decisions.md')
    expect(TEAM).toContain('merge=union')
  })
})
