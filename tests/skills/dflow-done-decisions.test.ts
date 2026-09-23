// dflow.sh done --decisions(과제 C, 스펙 §5). dflow.sh 를 가짜 curl 로 실제 실행해 본문·호출·경고를 본다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AGENT_DECISIONS_MAX, AGENT_DECISION_ON_REJECT_MAX, AGENT_DECISION_OPTION_MAX, AGENT_DECISION_OPTIONS_MAX,
  AGENT_DECISION_OPTIONS_MIN, AGENT_DECISION_QUESTION_MAX, AGENT_DECISION_RATIONALE_MAX,
} from '@/lib/domain/agentWork'

const ROOT = process.cwd()
const DFLOW = join(ROOT, '.claude/skills/dflow-work/scripts/dflow.sh')
const TOKEN = `dflow_pat_AAAAAAAAAAAA_${'x'.repeat(24)}`
const PID = '11111111-1111-4111-8111-111111111111'
const WORK_ID = '99999999-9999-4999-8999-999999999999'

// 가짜 curl: api_raw 의 호출 꼴(-sS -o file -w fmt -X M -H … [--data json] url)을 흉내 낸다.
// 모든 호출 URL 을 CALLS_FILE 에, report 본문을 BODY_FILE 에 남긴다. report 응답은 FAKE_REPORT_BODY 로 바꾼다.
function fakeCurl() {
  return `#!/bin/sh
out=''; data=''; url=''
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -X|-H|-w) shift 2 ;;
    --data) data="$2"; shift 2 ;;
    -sS) shift ;;
    *) url="$1"; shift ;;
  esac
done
printf '%s\\n' "$url" >> "$CALLS_FILE"
code=200; body='{}'
case "$url" in
  *"/agent/work/${WORK_ID}/report")
    printf '%s' "$data" > "$BODY_FILE"
    body="\${FAKE_REPORT_BODY:-}"
    [ -n "$body" ] || body='{"ok":true,"status":"reported","decisions_recorded":0}' ;;
esac
printf '%s' "$body" > "$out"; printf '%s' "$code"
`
}

let tmp: string, repo: string
const callsFile = () => join(tmp, 'calls.txt')
const bodyFile = () => join(tmp, 'body.json')

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('sh', [DFLOW, ...args], {
    encoding: 'utf8', cwd: repo,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PATH: `${join(tmp, 'bin')}:${process.env.PATH ?? ''}`,
      HOME: join(tmp, 'home'), XDG_CACHE_HOME: join(tmp, 'cache'),
      DFLOW_ENV_FILE: join(tmp, 'no-such-env'), DFLOW_CONFIG_DIR: join(tmp, 'no-config'),
      DFLOW_API_BASE: 'https://x.test', DFLOW_PATS: TOKEN, DFLOW_PROJECT_ID: PID,
      CALLS_FILE: callsFile(), BODY_FILE: bodyFile(),
      ...env,
    },
  })
}
const sentBody = () => JSON.parse(readFileSync(bodyFile(), 'utf8')) as Record<string, unknown>
const D = (key: string, over: Record<string, unknown> = {}) => ({
  key, question: '넣는가?', options: ['아니오', '예'], chosen: 0, rationale: '근거', on_reject: '방향', ...over,
})
function decisionsFile(v: unknown, raw?: string) {
  const f = join(tmp, 'decisions.json')
  writeFileSync(f, raw ?? JSON.stringify(v))
  return f
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dflow-done-dec-'))
  mkdirSync(join(tmp, 'bin')); mkdirSync(join(tmp, 'home'))
  writeFileSync(join(tmp, 'bin/curl'), fakeCurl(), { mode: 0o755 })
  // cmd_done 은 실제 git 으로 브랜치·push 도달을 확인한다 — 로컬 저장소 + 로컬 bare 원격.
  repo = join(tmp, 'repo'); mkdirSync(repo)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 'test@test.local'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo })
  writeFileSync(join(repo, 'f.txt'), 'x')
  execFileSync('git', ['add', 'f.txt'], { cwd: repo })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo })
  const bare = join(tmp, 'origin.git')
  execFileSync('git', ['init', '-q', '--bare', bare])
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: repo })
  execFileSync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: repo })
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('done --decisions — 본문', () => {
  it('플래그 순서와 무관하게 결정 목록을 trim 해 싣는다', () => {
    const f = decisionsFile([D('D1', { question: '  넣는가?  ' }), D('D2', { chosen: 1 })])
    const sum = '끝 — 확인 필요 결정 2건: 넣는가; 넣는가'
    for (const args of [['--decisions', f, '--auto-links'], ['--auto-links', '--decisions', f]]) {
      const r = run(['done', WORK_ID, sum, ...args], { FAKE_REPORT_BODY: '{"ok":true,"status":"reported","decisions_recorded":2}' })
      expect(r.status, r.stderr).toBe(0)
      const b = sentBody()
      expect((b.decisions as unknown[]).length).toBe(2)
      expect((b.decisions as Array<Record<string, unknown>>)[0].question).toBe('넣는가?')
      expect(b.evidence).toHaveProperty('head_sha')
      expect(r.stderr).not.toContain('DECISIONS_')
      expect(r.stderr).not.toContain('서버가 결정 목록')
    }
  })
  it('--decisions 가 없으면 본문에 decisions 키가 없다(제출 안 됨)', () => {
    expect(run(['done', WORK_ID, '끝', '--auto-links']).status).toBe(0)
    expect(sentBody()).not.toHaveProperty('decisions')
    expect(run(['done', WORK_ID, '끝']).status).toBe(0)
    expect(sentBody()).not.toHaveProperty('decisions')
  })
  it('[] 는 0건 명시로 싣고 접미사가 없어도 경고하지 않는다', () => {
    const r = run(['done', WORK_ID, '끝', '--decisions', decisionsFile([])])
    expect(r.status).toBe(0)
    expect(sentBody().decisions).toEqual([])
    expect(r.stderr).not.toContain('DECISIONS_')
    expect(r.stderr).not.toContain('서버가 결정 목록')
  })
  it('모르는 플래그는 usage(exit 2) — 보고하지 않는다', () => {
    const r = run(['done', WORK_ID, '끝', '--decision', 'x'])
    expect(r.status).toBe(2)
    expect(existsSync(callsFile())).toBe(false)
  })
})

describe('done --decisions — 선검사는 push 확인·네트워크보다 먼저', () => {
  it('형식 위반은 exit 2 와 서버와 같은 사유 — push 되지 않은 HEAD 에서도 push 오류보다 먼저, curl 호출 없음', () => {
    writeFileSync(join(repo, 'g.txt'), 'y')
    execFileSync('git', ['add', 'g.txt'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'unpushed'], { cwd: repo })
    const r = run(['done', WORK_ID, '끝', '--decisions', decisionsFile([D('D1', { chosen: 2 })])])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('DECISIONS_INVALID decisions[0].chosen이 options 범위를 벗어났습니다.')
    expect(r.stderr).not.toContain('git push')
    expect(existsSync(callsFile())).toBe(false)
  })
  it('형식이 맞아도 push 확인은 그대로 한다', () => {
    writeFileSync(join(repo, 'g.txt'), 'y')
    execFileSync('git', ['add', 'g.txt'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'unpushed'], { cwd: repo })
    const r = run(['done', WORK_ID, '끝', '--decisions', decisionsFile([])])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('git push')
    expect(existsSync(callsFile())).toBe(false)
  })
  it('파일 없음·JSON 아님·빈 파일은 exit 2', () => {
    expect(run(['done', WORK_ID, '끝', '--decisions', join(tmp, 'nope.json')]).stderr).toContain('DECISIONS_FILE')
    expect(run(['done', WORK_ID, '끝', '--decisions', decisionsFile(null, '[{')]).stderr).toContain('DECISIONS_JSON')
    const empty = run(['done', WORK_ID, '끝', '--decisions', decisionsFile(null, '')])
    expect(empty.status).toBe(2)
    expect(empty.stderr).toContain('DECISIONS_JSON')
    expect(existsSync(callsFile())).toBe(false)
  })
  it.each([
    ['배열 아님', { a: 1 }, 'decisions는 배열이어야 합니다.'],
    ['21건', Array.from({ length: 21 }, (_, i) => D(`D${i + 1}`)), 'decisions는 20건 이하여야 합니다.'],
    ['알 수 없는 필드', [D('D1', { note: 'x' })], 'decisions[0]에 알 수 없는 필드: note'],
    ['key 형식', [D('D0')], 'decisions[0].key는 D1~D99 형식이어야 합니다.'],
    ['key 중복', [D('D1'), D('D1')], 'decisions[1].key가 중복됩니다: D1'],
    ['공백만 있는 question', [D('D1', { question: '   ' })], 'decisions[0].question은 1~300자여야 합니다.'],
    ['한글 301자 question', [D('D1', { question: '가'.repeat(301) })], 'decisions[0].question은 1~300자여야 합니다.'],
    ['선택지 1개', [D('D1', { options: ['a'] })], 'decisions[0].options는 2~6개여야 합니다.'],
    ['공백 선택지', [D('D1', { options: ['a', ' '] })], 'decisions[0].options[1]는 1~200자여야 합니다.'],
    ['chosen 문자열', [D('D1', { chosen: '아니오' })], 'decisions[0].chosen은 정수여야 합니다.'],
    ['on_reject 없음', [{ key: 'D1', question: 'q', options: ['a', 'b'], chosen: 0, rationale: 'r' }], 'decisions[0].on_reject는 1~500자여야 합니다.'],
  ])('%s → exit 2', (_n, v, msg) => {
    const r = run(['done', WORK_ID, '끝', '--decisions', decisionsFile(v)])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain(`DECISIONS_INVALID ${msg}`)
  })
  it('한글 300자·이모지 300자 question 은 통과 — 서버와 같은 코드포인트 경계', () => {
    for (const q of ['가'.repeat(300), '😀'.repeat(300)]) {
      const r = run(['done', WORK_ID, '끝 — 확인 필요 결정 1건: q', '--decisions', decisionsFile([D('D1', { question: q })])])
      expect(r.status, r.stderr).toBe(0)
    }
  })
})

describe('done --decisions — 경고(보고는 계속)', () => {
  it('요약의 N 과 목록 건수가 다르면 DECISIONS_COUNT_MISMATCH', () => {
    const r = run(['done', WORK_ID, '끝 — 확인 필요 결정 3건: a; b; c', '--decisions', decisionsFile([D('D1'), D('D2')])])
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('DECISIONS_COUNT_MISMATCH 요약은 3건, 목록은 2건')
  })
  it('목록이 있는데 접미사가 없으면 DECISIONS_SUFFIX_MISSING', () => {
    const r = run(['done', WORK_ID, '끝', '--decisions', decisionsFile([D('D1')])])
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('DECISIONS_SUFFIX_MISSING')
  })
  it('구 서버(응답에 decisions_recorded 없음)면 경고하고 exit 0', () => {
    const r = run(['done', WORK_ID, '끝', '--decisions', decisionsFile([])], { FAKE_REPORT_BODY: '{"ok":true,"status":"reported"}' })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('서버가 결정 목록을 모릅니다(계약 < 2.6) — 요약 접미사로만 전달됐습니다.')
  })
  it('--decisions 없이 구 서버에 보고하면 그 경고를 내지 않는다', () => {
    const r = run(['done', WORK_ID, '끝'], { FAKE_REPORT_BODY: '{"ok":true,"status":"reported"}' })
    expect(r.status).toBe(0)
    expect(r.stderr).not.toContain('서버가 결정 목록을 모릅니다')
  })
})

describe('상한·계약 버전 — 서버 상수와 같다', () => {
  const src = readFileSync(DFLOW, 'utf8')
  const v = (name: string) => Number((src.match(new RegExp(`^${name}=(\\d+)$`, 'm')) ?? [])[1])
  it('셸 상한 변수 = agentWork.ts 상수', () => {
    expect(v('DECISIONS_MAX')).toBe(AGENT_DECISIONS_MAX)
    expect(v('DECISION_OPTIONS_MIN')).toBe(AGENT_DECISION_OPTIONS_MIN)
    expect(v('DECISION_OPTIONS_MAX')).toBe(AGENT_DECISION_OPTIONS_MAX)
    expect(v('DECISION_QUESTION_MAX')).toBe(AGENT_DECISION_QUESTION_MAX)
    expect(v('DECISION_OPTION_MAX')).toBe(AGENT_DECISION_OPTION_MAX)
    expect(v('DECISION_RATIONALE_MAX')).toBe(AGENT_DECISION_RATIONALE_MAX)
    expect(v('DECISION_ON_REJECT_MAX')).toBe(AGENT_DECISION_ON_REJECT_MAX)
  })
  it('CONTRACT_VERSION = 서버 AGENT_CONTRACT_VERSION = 계약 문서 머리말', () => {
    const cli = (src.match(/^CONTRACT_VERSION=([\d.]+)$/m) ?? [])[1]
    const server = (readFileSync(join(ROOT, 'src/lib/agent/externalApi.ts'), 'utf8').match(/AGENT_CONTRACT_VERSION = '([\d.]+)'/) ?? [])[1]
    const doc = readFileSync(join(ROOT, '.claude/skills/dflow-work/references/api-contract.md'), 'utf8')
    expect(cli).toBe('2.7')
    expect(server).toBe(cli)
    expect(doc).toContain(`# D'Flow Agent API 계약 v${cli}`)
    expect(doc).toContain('## v2.6 변경점')
  })
  it('usage 가 --decisions 를 안내한다', () => {
    expect(src).toContain('done <ref> <요약> [--auto-links] [--decisions <file>]')
  })
})
