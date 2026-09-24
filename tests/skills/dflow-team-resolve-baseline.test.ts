// tests/skills/dflow-team-resolve-baseline.test.ts
// 해소 워커 「3. 기준선」(2026-09-24 실측: 해소 시도 한 번이 BASE·MERGE_HEAD 단독·merge-base 세 커밋 + 게이트로 전체 시험을
// 4회 돌렸고 baseline.sh 캐시를 쓰지 않았다). 세 측정을 baseline.sh 로 하고, MERGE_HEAD 단독은 워커의 게이트 기록을 먼저
// 쓰며, 「7」 이 옛 "두 번" 과 모순되지 않는지 본다. 3번 측정 블록을 실제 git 샌드박스에서 돌려 재시도가 다시 재지 않는지도 본다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const PROMPT = readFileSync(join(ROOT, '.claude/skills/dflow-team/references/resolve-prompt.md'), 'utf8')
const sec = (from: string, to: string) => PROMPT.slice(PROMPT.indexOf(from), PROMPT.indexOf(to))
const S3 = sec('## 3. 기준선', '## 4. 해소 머지')
const S7 = sec('## 7. 무거운 명령 줄 세우기', '## 해소 규약')
const bashBlocks = (s: string) => [...s.matchAll(/^( *)```bash\n([\s\S]*?)^\1```/gm)].map((m) => m[2].split('\n').map((l) => l.slice(m[1].length)).join('\n'))

describe('resolve-prompt.md 「3. 기준선」 — 세 측정은 baseline.sh 캐시로', () => {
  it('세 커밋 모두 baseline.sh run --base 로 재고, 먼저 list 로 원래 워커의 명령 문자열을 찾는다', () => {
    expect(S3).toContain(".claude/skills/dflow-dev/scripts/baseline.sh list --base '<MB>'")
    for (const b of ["'<MB>'", "'<머지 대상>'", "'<BASE>'"]) {
      expect(S3).toContain(`.claude/skills/dflow-dev/scripts/baseline.sh run --base ${b} --task-dir '{TASK_DIR}' -- '<기준선 명령>'`)
    }
    expect(S3).toContain('**그 문자열과 cwd 를 글자 그대로** 세 커밋 모두에 쓴다')
    // 옛 문구: 각 커밋에서 전체 시험을 맨손으로 돌렸다
    expect(PROMPT).not.toContain('여기서 전체 시험을 돌려 총수만 적는다')
    expect(PROMPT).not.toContain('전체 시험을 한 번 돌려 기록한다')
  })

  it('새로 잰 수는 note 로 더하고, BUSY 는 실패가 아니라 다시 호출한다', () => {
    expect(S3).toContain('baseline.sh note <key> --tests <총수> --failures <실패 수>')
    expect(S3).toContain('`BASELINE_SUMMARY` 가 없으면')
    expect(S3).toMatch(/`BASELINE_BUSY exit=75 …`: 실패가 아니다\. 같은 명령을 다시 호출한다/)
    expect(S3).toContain('`--pool docker`')
  })

  it('MERGE_HEAD 단독 총수는 워커의 게이트 기록(커밋이 맞을 때만)을 먼저 쓴다', () => {
    expect(S3).toContain('`refactor_gate` → `verify_gate` → `build_gate`')
    expect(S3).toContain("git diff --name-only '<기록의 커밋>' '<머지 대상>' -- . ':(exclude){TASK_DIR}'")
    expect(S3).toContain('커밋이 없는 기록은 어느 트리를 잰 것인지 몰라 쓰지 않는다')
    expect(S3).toContain('기준선 출처: 개발 브랜치 <cache|measured> · MERGE_HEAD 단독 <gate-record|cache|measured> · merge-base <cache|measured>')
  })

  it('블록은 git 출력을 명령 치환으로 받지 않는다(「0」)', () => {
    for (const b of bashBlocks(S3)) expect(b).not.toMatch(/\$\(\s*git /)
  })

  it('「7」: 옛 "두 번" 모순을 없애고, baseline.sh 측정은 heavy.sh 로 다시 감싸지 않으며 게이트만 감싼다', () => {
    expect(PROMPT).not.toContain('3번 기준선의 두 번')
    expect(S7).toContain('3번 기준선의 세 측정(개발 브랜치·MERGE_HEAD 단독·merge-base)')
    expect(S7).toContain('**바깥에서 `heavy.sh` 로 다시 감싸지 않는다**')
    expect(S7).toContain('「게이트」 의 전체 시험(캐시를 쓰지 않는다)만')
    expect(S7).toContain('`BASELINE_BUSY`(exit 75)로 끝나면 실패가 아니다')
  })
})

// ---- 샌드박스: 3번 측정 블록을 그대로 돌린다 ---------------------------------------------------------------
const ENV: Record<string, string | undefined> = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', DFLOW_BASELINE_POLL: '0.2',
}
for (const k of Object.keys(ENV)) if (k.startsWith('DFLOW_') && k !== 'DFLOW_BASELINE_POLL') delete ENV[k]

let tmp: string, repo: string
function sh(script: string) {
  const r = spawnSync('bash', ['-c', script], { cwd: repo, encoding: 'utf8', timeout: 60000, env: { ...ENV, DFLOW_HEAVY_DIR: join(tmp, 'heavy') } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
const runs = () => (existsSync(join(tmp, 'runs')) ? readFileSync(join(tmp, 'runs'), 'utf8').trim().split('\n') : [])

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-resolve-bl-')))
  repo = join(tmp, 'repo')
  mkdirSync(repo)
  // MB → (dev 쪽 커밋 = BASE) / (agent 쪽 커밋 = 머지 대상)
  const r = sh(`
    set -e
    git init -q -b dev . && printf '.claude/\\n' > .gitignore && printf 'mb\\n' > a.txt
    git add . && git commit -qm mb && git tag MB
    git switch -q -c agent/abcd1234-x && mkdir -p docs/tasks/TSK-01-01 && printf 'x\\n' > b.txt
    printf '{"phase":"reported"}\\n' > docs/tasks/TSK-01-01/state.json && git add . && git commit -qm agent && git tag HEADTIP
    git switch -q dev && printf 'dev\\n' > c.txt && git add . && git commit -qm dev && git tag BASE
    git switch -q --detach BASE
  `)
  expect(r.code, r.out).toBe(0)
  mkdirSync(join(repo, '.claude'))
  symlinkSync(join(ROOT, '.claude/skills'), join(repo, '.claude/skills'))
})
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

describe('3번 측정 블록 — 샌드박스 실행', { timeout: 60000 }, () => {
  const block = () => {
    const b = bashBlocks(S3).find((x) => x.includes('baseline.sh run --base'))
    expect(b).toBeTruthy()
    return b!
      .replaceAll("'<MB>'", 'MB').replaceAll("'<머지 대상>'", 'HEADTIP').replaceAll("'<BASE>'", 'BASE')
      .replaceAll('{TASK_DIR}', 'docs/tasks/TSK-01-01')
      .replaceAll("'<기준선 명령>'", `'echo "$(git rev-parse --short HEAD)" >> ${'$'}T/runs; echo "Tests 5"'`)
  }

  it('세 커밋을 한 번씩 재고 <BASE> 에서 끝나며, 같은 커밋의 재시도는 다시 재지 않는다(BASELINE_REUSED)', () => {
    const script = `export T='${tmp}'\n${block()}`
    const first = sh(script)
    expect(first.code, first.out).toBe(0)
    expect(runs()).toHaveLength(3)
    expect((first.out.match(/BASELINE_MEASURED exit=0 key=/g) ?? []).length).toBe(3)
    expect(sh('git rev-parse HEAD').out.trim()).toBe(sh('git rev-parse BASE').out.trim())
    // 재시도(같은 MERGE_HEAD·merge-base·BASE): 전체 시험을 다시 돌리지 않는다
    const again = sh(script)
    expect(again.code, again.out).toBe(0)
    expect(runs()).toHaveLength(3)
    expect((again.out.match(/BASELINE_REUSED exit=0/g) ?? []).length).toBe(3)
  })

  it('게이트 기록 재사용 조건: 게이트 뒤 Task 폴더 밖이 바뀌지 않았으면 차분이 비고, 코드가 바뀌었으면 비지 않는다', () => {
    // HEADTIP~0 에서 게이트를 돌았고 그 뒤 state.json 만 커밋했다
    let r = sh(`
      set -e
      git switch -q --detach HEADTIP && printf '{"phase":"reported","verify_gate":{"t":{"tests":5}}}\\n' > docs/tasks/TSK-01-01/state.json
      git commit -qam state && git tag TIP2 && git switch -q --detach BASE
    `)
    expect(r.code, r.out).toBe(0)
    r = sh("git diff --name-only HEADTIP TIP2 -- . ':(exclude)docs/tasks/TSK-01-01'")
    expect(r.code, r.out).toBe(0)
    expect(r.out.trim()).toBe('')
    r = sh("git diff --name-only MB TIP2 -- . ':(exclude)docs/tasks/TSK-01-01'")
    expect(r.out.trim()).toBe('b.txt')
  })
})
