// poll.sh 필터 캐시 — --require-tag·--wp 필터에서 떨어진 후보의 show 결과를 짧은 TTL(주기 수 × interval) 동안 재사용한다.
// list 응답(/work/mine)에는 tags 도 updated_at 도 없어 무효화 키가 없다. 그래서 TTL 로만 묶고, 통과(태그 있음)는 캐시하지
// 않는다 — 팀장 show 필터는 태그를 다시 보지 않으므로, 통과를 캐시하면 사람이 태그를 뗀 작업을 띄운다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const POLL_SH = join(process.cwd(), '.claude/skills/dflow-poll/scripts/poll.sh')
const ENV = {
  PATH: process.env.PATH ?? '', HOME: '/nonexistent',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}

let tmp: string
let cfg: string
let bin: string
let cache: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-poll-cache-')))
  cfg = join(tmp, 'cfg'); bin = join(tmp, 'bin'); cache = join(tmp, 'xdg')
  mkdirSync(cfg); mkdirSync(bin)
  writeFileSync(join(cfg, '.dflow'), 'api_base=https://p.test\nproject_id=11111111-1111-4111-8111-111111111111\nrelease_branch=main\n')
  writeFileSync(join(cfg, '.dflow.local'), 'pats=dflow_pat_TEST_token\ndev_branch=main\n')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

// 가짜 dflow.sh. list 는 부른 횟수를 적고 ready 줄을 낸다. show <id8> 는 부른 id 를 적고 규칙대로 답한다.
//   tagfrom-<id8> = N  → list 가 N번 이상 불린 뒤부터 tags 에 agent 가 붙는다(파일이 없으면 끝내 안 붙는다)
//   failuntil-<id8> = N → list 가 N번 불리기 전까지 조회 실패. failmode-<id8> 가 json 이면 exit 0 + 오류 JSON, 아니면 exit 7
//   ref-<id8>      → external_ref(없으면 m/TSK-01-01)
function stub(rows: string[]) {
  const f = join(bin, 'dflow.sh')
  writeFileSync(f, `#!/bin/sh
T='${tmp}'
case "$1" in
  list) echo x >> "$T/list"; printf '%s\\n' ${rows.map((r) => `'${r}'`).join(' ')} ;;
  show)
    echo "$2" >> "$T/show"
    n=$(wc -l < "$T/list" | tr -d ' ')
    if [ -f "$T/failuntil-$2" ] && [ "$n" -lt "$(cat "$T/failuntil-$2")" ]; then
      if [ "$(cat "$T/failmode-$2" 2>/dev/null)" = json ]; then echo '{"error":"x"}'; exit 0; fi
      echo 'boom' >&2; exit 7
    fi
    tags='"x"'
    if [ -f "$T/tagfrom-$2" ] && [ "$n" -ge "$(cat "$T/tagfrom-$2")" ]; then tags='"x","agent"'; fi
    ref=$(cat "$T/ref-$2" 2>/dev/null || echo m/TSK-01-01)
    printf '{"order":{"id":"%s-0000-4000-8000-000000000000","status":"ready","item":{"tags":[%s],"external_ref":"%s"}}}\\n' "$2" "$tags" "$ref" ;;
  *) exit 0 ;;
esac
`)
  chmodSync(f, 0o755)
  return f
}
const row = (n: number, id8: string) => `${n}\tRD\tx\t${id8}\t작업${id8}`
const lines = (name: string) => (existsSync(join(tmp, name)) ? readFileSync(join(tmp, name), 'utf8').trim().split('\n').filter(Boolean) : [])
const shows = (id8?: string) => lines('show').filter((l) => !id8 || l === id8).length
const reset = () => { for (const n of ['list', 'show']) rmSync(join(tmp, n), { force: true }) }
const put = (name: string, v: string) => writeFileSync(join(tmp, name), v)

function poll(args: string[], rows: string[], xdg: string = cache) {
  const r = spawnSync('sh', [POLL_SH, '--interval', '1', '--until', 'none', ...args], {
    cwd: cfg, encoding: 'utf8', timeout: 25000,
    env: { ...ENV, DFLOW_SH: stub(rows), DFLOW_WATCH: '0', DFLOW_CONFIG_DIR: cfg, XDG_CACHE_HOME: xdg } as NodeJS.ProcessEnv,
  })
  return { code: r.status, out: (r.stdout ?? '').trim(), err: r.stderr ?? '' }
}

describe('poll.sh 필터 캐시', { timeout: 40000 }, () => {
  it('떨어진 후보는 매 주기 show 하지 않고, 나중에 붙은 태그는 TTL 안에 잡는다', () => {
    put('tagfrom-aaaa1111', '4')
    const r = poll(['--require-tag', 'agent', '--tag-cache-cycles', '3'], [row(1, 'aaaa1111')])
    expect(r.code, r.err).toBe(0)
    expect(r.out).toBe('1\taaaa1111\t작업aaaa1111')
    const list = lines('list').length
    expect(list).toBeGreaterThanOrEqual(4)
    expect(list).toBeLessThanOrEqual(4 + 3 + 1) // 태그가 붙은 주기 + TTL 주기 + 여유 1
    expect(shows()).toBeLessThan(list) // 캐시가 없으면 list 와 같다
    expect(shows()).toBeGreaterThanOrEqual(2)
  })

  it('--tag-cache-cycles 0 이면 예전처럼 매 주기 show 한다', () => {
    put('tagfrom-aaaa1111', '3')
    const r = poll(['--require-tag', 'agent', '--tag-cache-cycles', '0'], [row(1, 'aaaa1111')])
    expect(r.code, r.err).toBe(0)
    expect(lines('list').length).toBe(3)
    expect(shows()).toBe(3)
  })

  it('캐시 폴더를 쓸 수 없으면 시작 때 한 번 알리고 캐시 없이 돈다', () => {
    put('tagfrom-aaaa1111', '3')
    const r = poll(['--require-tag', 'agent'], [row(1, 'aaaa1111')], '/nonexistent/xdg')
    expect(r.code, r.err).toBe(0)
    expect(shows()).toBe(3)
    expect(r.err.split('필터 캐시 끔').length - 1).toBe(1)
  })

  it('조회 실패(exit 7)는 캐시하지 않고 다음 주기에 다시 show 한다', () => {
    put('failuntil-aaaa1111', '3'); put('tagfrom-aaaa1111', '3')
    const r = poll(['--require-tag', 'agent', '--tag-cache-cycles', '5'], [row(1, 'aaaa1111')])
    expect(r.code, r.err).toBe(0)
    expect(lines('list').length).toBe(3)
    expect(shows()).toBe(3)
  })

  it('주문 없는 응답(오류 JSON)도 "태그 없음" 으로 캐시하지 않는다', () => {
    put('failuntil-aaaa1111', '3'); put('failmode-aaaa1111', 'json'); put('tagfrom-aaaa1111', '3')
    const r = poll(['--require-tag', 'agent', '--tag-cache-cycles', '5'], [row(1, 'aaaa1111')])
    expect(r.code, r.err).toBe(0)
    expect(lines('list').length).toBe(3)
    expect(shows()).toBe(3)
  })

  it('통과는 캐시하지 않는다 — 태그를 뗀 작업은 다음 poll 에서 다시 show 해 떨어뜨린다', () => {
    put('tagfrom-aaaa1111', '1')
    const r1 = poll(['--require-tag', 'agent', '--tag-cache-cycles', '5'], [row(1, 'aaaa1111')])
    expect(r1.out).toBe('1\taaaa1111\t작업aaaa1111')
    reset(); rmSync(join(tmp, 'tagfrom-aaaa1111')); put('tagfrom-bbbb2222', '1')
    const r2 = poll(['--require-tag', 'agent', '--tag-cache-cycles', '5'], [row(1, 'aaaa1111'), row(2, 'bbbb2222')])
    expect(r2.code, r2.err).toBe(0)
    expect(r2.out).toBe('2\tbbbb2222\t작업bbbb2222')
    expect(shows('aaaa1111')).toBe(1)
  })

  it('캐시된 탈락도 지금 필터로 다시 판정한다 — 지금 통과할 값이면 캐시를 믿지 않고 show 한다', () => {
    put('tagfrom-aaaa1111', '1'); put('ref-aaaa1111', 'm/TSK-01-02'); put('tagfrom-bbbb2222', '1'); put('ref-bbbb2222', 'm/TSK-02-01')
    // 1회차: --wp WP-02 → aaaa1111(WP-01) 은 떨어져 캐시되고 bbbb2222 가 나온다
    const r1 = poll(['--require-tag', 'agent', '--wp', 'WP-02', '--tag-cache-cycles', '5'], [row(1, 'aaaa1111'), row(2, 'bbbb2222')])
    expect(r1.out).toBe('2\tbbbb2222\t작업bbbb2222')
    reset()
    // 2회차: --wp WP-01 → 캐시된 aaaa1111 은 지금 필터로는 통과할 값이라 다시 show 해 확인하고 낸다
    const r2 = poll(['--require-tag', 'agent', '--wp', 'WP-01', '--tag-cache-cycles', '5'], [row(1, 'aaaa1111')])
    expect(r2.code, r2.err).toBe(0)
    expect(r2.out).toBe('1\taaaa1111\t작업aaaa1111')
    expect(shows('aaaa1111')).toBe(1)
  })

  it('필터가 없으면 show 도 캐시도 쓰지 않는다', () => {
    const r = poll([], [row(1, 'aaaa1111')])
    expect(r.code, r.err).toBe(0)
    expect(shows()).toBe(0)
    expect(r.err).not.toContain('필터 캐시')
  })

  it('--tag-cache-cycles 는 숫자만 받는다', () => {
    const r = poll(['--tag-cache-cycles', 'x'], [])
    expect(r.code).toBe(2)
    expect(r.err).toContain('--tag-cache-cycles N')
  })
})
