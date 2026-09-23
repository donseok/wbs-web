// tests/skills/dflow-team-merge-conflict.test.ts
// 팀장의 머지 충돌 흐름(2026-09-23 §4·§6.3·§7.1·§8) — 문서 계약과 문서 속 jq 를 실제로 돌린다.
// dflow-team.test.ts 는 병행 세션이 자주 고치므로 이 과제의 검사는 이 파일에 모은다.
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const TEAM = read('.claude/skills/dflow-team/SKILL.md')
const MC = read('.claude/skills/dflow-team/references/merge-conflict.md')
const EVENTS = read('.claude/skills/dflow-team/references/events.md')
const BACKENDS = read('.claude/skills/dflow-team/references/backends.md')
const HELP = read('.claude/skills/dflow-team/references/help.md')

describe('SKILL.md — 포인터 절과 바뀐 문구', () => {
  it('「4-1. 머지 충돌 해소」·「5-2. 해소 spawn」 이 merge-conflict.md 를 가리킨다', () => {
    expect(TEAM).toContain('### 4-1. 머지 충돌 해소')
    expect(TEAM).toContain('### 5-2. 해소 spawn')
    expect(TEAM).toContain('cat .claude/skills/dflow-team/references/merge-conflict.md')
    expect(TEAM).toContain('`references/merge-conflict.md`, `references/backends.md` 의')
  })
  it('최종 판정 목록 두 곳에 resolved 가 있다', () => {
    expect(TEAM.split('`needs-merge`·`skipped`·`failed`·`cancelled`·`resolved`)').length - 1).toBe(2)
  })
  it('spawn 우선순위: 재개 → 해소 → 대기 큐', () => {
    expect(TEAM).toContain('**재개 대상을 먼저**(「5-1. 재개 spawn」), 그 다음 **해소 큐**(「5-2. 해소 spawn」), 그 다음 대기 큐')
  })
  it('머지 충돌 bullet 은 해소로 넘기고, 못 푸는 경우만 사람 몫(기존 문구 유지)', () => {
    expect(TEAM).toContain('"머지 실패(충돌)"')
    expect(TEAM).toContain('"사람이 머지해야 함"')
    expect(TEAM).toContain('「4-1. 머지 충돌 해소」 로 넘긴다')
  })
  it('일시 제외 해제: 머지됨·해소 resolved 도 풀고, 선행 미반영도 선행 계열이다', () => {
    expect(TEAM).toContain('"머지됨(승인 전)"·"머지됨" 을 한 건이라도 냈거나 해소 워커가 `resolved` 로 끝났으면')
    expect(TEAM).toMatch(/선행 계열\(선행 미충족·[^)]*선행 미반영\)/)
  })
  it('금지: heartbeat·--resolve 예외, 재spawn 예외는 다섯', () => {
    expect(TEAM).toContain('머지 충돌 표시 heartbeat(`merge_conflict` 설정·해제')
    expect(TEAM).toContain('해소 워커의 `/dflow-merge --resolve` 가 개발 브랜치에 한 건을 머지·push 한다')
    expect(TEAM).toContain('- 같은 작업의 재spawn. 예외는 다섯이다(')
    expect(TEAM).toContain('같은 작업을 다시 띄우는 것은 다섯뿐이다(')
  })
  it('team.sweep 은 resolved 를 함께 센다, 마감은 표시를 지우지 않는다', () => {
    expect(TEAM).toContain('`team.sweep`(merged, waiting, rejected, resolved 개수)을 기록한다.')
    expect(TEAM).toContain('마감은 남은 `merge_conflict` 표시를 지우지 않는다')
  })
  it('해소 워크트리는 부트스트랩 실패 정리 대상이 아니다(branch 칸이 늘 -)', () => {
    expect(TEAM).toContain('(해소 워크트리 `dflow-<id8>-resolve` 는 예외 — 「고아 정리 규칙」 2-1번)')
  })
})

describe('merge-conflict.md — 팀장 쪽 절차', () => {
  it('충돌 접수: mine 확인, resolve-decide.sh, 동시 해소 상한', () => {
    expect(MC).toContain('.claude/skills/dflow-team/scripts/resolve-decide.sh ~/.dflow/events.jsonl')
    expect(MC).toContain('`mine` 이 `true` 가 아니면')
    expect(MC).toContain('`max(1, ⌊인원/2⌋)`')
  })
  it('heartbeat 대리 호출은 전체 UUID 와 --agent <lead> 로 부른다', () => {
    expect(MC).toContain("dflow.sh heartbeat '<order 전체 UUID>' --agent '<신원>/<host>/lead' --phase merge_conflict --note")
    expect(MC).toContain("dflow.sh heartbeat '<order 전체 UUID>' --agent '<신원>/<host>/lead' --clear-merge-conflict")
  })
  it('resolved 는 조상 확인 뒤에만 해제하고, 곧바로 승인 스윕', () => {
    expect(MC).toContain("git merge-base --is-ancestor '<결과 줄 head>' origin/<개발브랜치>")
    expect(MC).toContain('해소 push 확인 불가')
    expect(MC).toContain('곧바로 승인 스윕')
  })
  it('차단기: 내용 실패는 세지도 끊지도 않고, 환경 실패만 센다', () => {
    expect(MC).toContain('`failed gate`·`failed push-race`·`failed push-hook`·`failed push-other`·`failed not-detached`·`failed dirty-dev-state`')
    expect(MC).toContain('세지도 끊지도 않는다')
  })
  it('H 제외, lease 상실 중 spawn 금지', () => {
    expect(MC).toContain('워커 자동 재시작(H)의 대상이 아니다')
    expect(MC).toContain('`team.lost` 를 쓰지 않는다')
    expect(MC).toContain('`LEASE_LOST`')
  })
  it('사람 머지 감지 jq: 마지막 decision 이 cleared 가 아닌 id8 만 낸다', () => {
    const m = MC.match(/jq -rs --arg a '<신원>\/<host>\/lead' --arg r '<MAIN>' '([^']+)'/)
    expect(m).not.toBeNull()
    const line = (id8: string, decision: string, agent = 'hong/mbp/lead') =>
      JSON.stringify({ ts: 't', host: 'mbp', repo: '/r', tsk: `TSK-${id8}`, order: `o-${id8}`, phase: 'team', event: 'team.conflict', agent, id8, decision, files: 'a.ts' })
    const input = [line('aaaa1111', 'queued'), line('bbbb2222', 'human'), line('aaaa1111', 'cleared'), line('cccc3333', 'human', 'kim/pc/lead')].join('\n')
    const out = execFileSync('jq', ['-rs', '--arg', 'a', 'hong/mbp/lead', '--arg', 'r', '/r', m![1]], { input }).toString().trim()
    expect(out).toBe('bbbb2222\tTSK-bbbb2222\to-bbbb2222')
  })
})

describe('events.md — 새 값과 가드', () => {
  const guard = () => {
    const m = EVENTS.match(/'(\{"team\.start":[\s\S]*?EVENT_ARGS_MISSING"\) end)'/)
    if (!m) throw new Error('가드 jq 를 찾지 못했다')
    return m[1]
  }
  const run = (obj: Record<string, unknown>) => {
    try {
      return execFileSync('jq', ['-c', '--arg', 'h', 'mbp', guard()], { input: JSON.stringify(obj), stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
    } catch { return 'EVENT_ARGS_MISSING' }
  }
  const base = { ts: 't', host: 'mbp', repo: '/r', tsk: 'TSK-01-01', order: 'o', phase: 'team', agent: 'hong/mbp/lead' }
  it('team.sweep 은 resolved 가 있어야 붙는다', () => {
    expect(run({ ...base, event: 'team.sweep', merged: 1, waiting: 0, rejected: 0, resolved: 1 })).not.toBe('EVENT_ARGS_MISSING')
    expect(run({ ...base, event: 'team.sweep', merged: 1, waiting: 0, rejected: 0 })).toBe('EVENT_ARGS_MISSING')
  })
  it('team.conflict 는 id8·decision·files 가 있어야 붙는다', () => {
    expect(run({ ...base, event: 'team.conflict', id8: 'aaaa1111', decision: 'queued', files: 'src/a.ts' })).not.toBe('EVENT_ARGS_MISSING')
    expect(run({ ...base, event: 'team.conflict', id8: 'aaaa1111', decision: 'queued' })).toBe('EVENT_ARGS_MISSING')
  })
  it('spawn_kind 는 네 값이고 resolve 를 설명한다', () => {
    expect(EVENTS).toContain('`spawn_kind` 는 네 값 중 하나인 문자열이다')
    expect(EVENTS).toContain('`resolve` 는 「5-2. 해소 spawn」')
    expect(EVENTS).toContain('`new`·`resume`·`readopt`·`resolve` 밖의 값을 쓰지 않는다')
  })
})

describe('backends.md·help.md', () => {
  it('고아 정리 규칙 2-1: 해소 워크트리는 개발 브랜치 조상이면 지운다', () => {
    expect(BACKENDS).toContain('2-1. **해소 워크트리**')
    expect(BACKENDS).toContain('git -C <워크트리> merge-base --is-ancestor HEAD origin/<개발브랜치>')
  })
  it('도움말에 해소 동작과 상한이 있다', () => {
    expect(HELP).toContain('머지 충돌 해소')
    expect(HELP).toContain('3번까지')
  })
})
