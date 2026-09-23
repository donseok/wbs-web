// tests/skills/dflow-merge-resolve.test.ts
// 머지 충돌 해소(2026-09-23 §5.1) — /dflow-merge 의 충돌 파일 보고와 숨은 플래그 --resolve.
// 문서 문자열 + 임시 git 저장소(가짜 origin)에서 해소 머지의 전제(E4·rerere)를 실제로 돌린다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const MERGE = readFileSync(join(ROOT, '.claude/skills/dflow-merge/SKILL.md'), 'utf8')
const section = (from: string, to: string) => {
  const a = MERGE.indexOf(from); const b = MERGE.indexOf(to, a + 1)
  if (a < 0 || b < 0) throw new Error(`절을 찾지 못했다: ${from}`)
  return MERGE.slice(a, b)
}

describe('/dflow-merge 문서 — 충돌 파일 목록과 --resolve', () => {
  it('--resolve 는 description 사용법에 노출하지 않는다(--on-report 와 같은 취급)', () => {
    const desc = MERGE.split('\n').find(l => l.startsWith('description:')) ?? ''
    expect(desc).not.toContain('--resolve')
    expect(MERGE).toContain('**`--resolve <ref>`(팀장이 띄운 해소 워커 전용)**')
  })
  it('스윕의 충돌 처리: --diff-filter=U 로 파일 목록을 --abort 전에 읽는다', () => {
    const step3 = section('   3. `git merge --no-ff <머지 대상>`.', '   4. state.json 을 `phase=merged` 로')
    expect(step3).toContain('git diff --name-only --diff-filter=U')
    // 코드 블록에서 목록 명령이 --abort 바로 앞 줄이다(뒤에서는 목록이 비어 있다)
    expect(step3).toMatch(/--diff-filter=U[^\n]*\n\s*git merge --abort/)
    expect(step3).toContain('"머지 실패(충돌)"')
    expect(MERGE).toContain('머지 실패(충돌) <파일,…>')
  })
  it('해소 머지 절: 머지 자리는 호출한 워크트리, rerere 는 -c 로만, 트레일러 둘, push 경합 재시도 2회', () => {
    const r = section('## 해소 머지(`--resolve`)', '## 금지')
    expect(r).toContain('머지 자리는 **호출한 워크트리 자신**')
    expect(r).toContain('RESOLVE_NOT_DETACHED')
    expect(r).toContain('RESOLVE_BASE_MOVED')
    expect(r).toContain('git -c rerere.enabled=true merge --no-ff --no-commit <머지 대상>')
    expect(r).toContain('git -c rerere.enabled=true commit')
    expect(r).toContain('--trailer "DFlow-Order: <order>" --trailer "DFlow-Resolve: <n>/3"')
    expect(r).toContain('git push origin HEAD:<기본브랜치>')
    expect(r).toContain('한 세션 안에서 2회까지')
    expect(r).toContain('`dflow-team/references/resolve-prompt.md` 「해소 규약」')
    expect(r).toContain('`dflow-team/references/resolve-prompt.md` 「게이트」')
    expect(r).not.toContain('git config rerere')
  })
  it('금지: --resolve 에서도 agent 브랜치 수정·force push·훅 우회는 금지다', () => {
    const ban = MERGE.slice(MERGE.indexOf('## 금지'))
    expect(ban).toContain('`--resolve` 의 agent 브랜치 수정·rebase')
  })
})

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}
function sh(cwd: string, script: string) {
  const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', env: GIT_ENV })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
let tmp: string, repo: string
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-resolve-')))
  repo = join(tmp, 'repo')
  const r = sh(tmp, `
    git init -q --bare -b main origin.git
    git clone -q origin.git repo 2>/dev/null
    cd repo && git checkout -q -b main
    printf 'base\\n' > f.txt && git add f.txt && git commit -qm init && git push -q origin main
    git switch -q -c agent/aaaaaaaa-x && printf 'agent\\n' > f.txt && git commit -qam feat && git push -q origin agent/aaaaaaaa-x
    git rev-parse HEAD > ../head_sha
    git switch -q main && printf 'main\\n' > f.txt && git commit -qam other && git push -q origin main
    git rev-parse HEAD > ../base_sha
    git switch -q --detach origin/main
  `)
  expect(r.code, r.out).toBe(0)
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('해소 머지의 git 전제 — 임시 저장소', () => {
  it('충돌 파일 목록 명령이 충돌한 파일을 낸다(--abort 전)', () => {
    const r = sh(repo, 'git merge --no-ff origin/agent/aaaaaaaa-x >/dev/null 2>&1; git diff --name-only --diff-filter=U; git merge --abort')
    expect(r.out.trim()).toBe('f.txt')
  })
  it('개발 브랜치 위 머지 커밋에서 풀면 agent 브랜치는 그대로라 2단계 승인 뒤 변경 확인이 통과한다(E4)', () => {
    const r = sh(repo, `
      git -c rerere.enabled=true merge --no-ff --no-commit origin/agent/aaaaaaaa-x >/dev/null 2>&1
      printf 'main\\nagent\\n' > f.txt && git add f.txt
      git -c rerere.enabled=true commit -q -m "merge: TSK-01-01 x (approved) — 충돌 해소" --trailer "DFlow-Order: o-1" --trailer "DFlow-Resolve: 1/3"
      git log -1 --format=%B | grep -c 'DFlow-Resolve: 1/3'
      h=$(cat ../head_sha)
      git merge-base --is-ancestor "$h" origin/agent/aaaaaaaa-x && echo ANCESTOR_OK
      printf 'diff=[%s]\\n' "$(git diff --name-only "$h"..origin/agent/aaaaaaaa-x)"
    `)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('1\n')
    expect(r.out).toContain('ANCESTOR_OK')
    expect(r.out).toContain('diff=[]')
  })
  it('rerere 가 push 경합 뒤 재머지에서 앞서 푼 덩어리를 되살린다(commit 에도 -c 가 붙어야 기록된다)', () => {
    const r = sh(repo, `
      git -c rerere.enabled=true merge --no-ff --no-commit origin/agent/aaaaaaaa-x >/dev/null 2>&1
      printf 'main\\nagent\\n' > f.txt && git add f.txt
      git -c rerere.enabled=true commit -q -m "merge: TSK-01-01 x" --trailer "DFlow-Order: o-1"
      git reset -q --keep "$(cat ../base_sha)"
      git -c rerere.enabled=true merge --no-ff --no-commit origin/agent/aaaaaaaa-x >/dev/null 2>&1
      grep -c '<<<<<<<' f.txt || true
      cat f.txt
    `)
    expect(r.out).toContain('0\nmain\nagent')
  })
})
