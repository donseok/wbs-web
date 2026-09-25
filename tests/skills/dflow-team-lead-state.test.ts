// tests/skills/dflow-team-lead-state.test.ts
// 재구성 보조 요약(scripts/lead-state.sh). 2026-09-25: 「팀장 상태」 보조 블록이 마지막 team.start 이후 이벤트를 통째로 출력해
// dmes-standard 에서 133K자까지 불었다. 스크립트가 재구성에 쓰는 값만 요약한다. 「팀장 상태」 보조의 규칙마다 fixture 로 확인한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const SCRIPT = join(ROOT, '.claude/skills/dflow-team/scripts/lead-state.sh')
const A = 'hong/mbp/lead'
const R = '/work/repo'
const WT = (id8: string, sfx = '') => `${R}/.claude/worktrees/dflow-${id8}${sfx}`

let tmp: string, ev: string
beforeEach(() => { tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-lead-state-'))); ev = join(tmp, 'events.jsonl') })
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

let t = 0
const ts = () => `2026-09-24T00:${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t++ % 60).padStart(2, '0')}Z`
type E = Record<string, string>
const line = (e: E, who = A, repo = R) => JSON.stringify({ ts: ts(), host: 'mbp', repo, tsk: '-', order: '-', phase: 'team', agent: who, ...e })
const start = (e: E = {}) => line({ event: 'team.start', backend: 'tmux', slots: '3', until: '18:00', wp: '-', ...e })
const spawnE = (slot: string, id8: string, e: E = {}) => line({ event: 'team.spawn', slot, id8, tsk: `TSK-${id8}`, worktree: WT(id8), handle: `tmux:%${slot}`, spawn_kind: 'new', ...e })
const result = (slot: string, id8: string, status: string, e: E = {}) => line({ event: 'team.result', slot, id8, tsk: `TSK-${id8}`, worktree: WT(id8), hash: `h-${id8}-${t}`, status, reason: 'r', ...e })
const blocked = (slot: string, id8: string, e: E = {}) => line({ event: 'team.blocked', slot, id8, tsk: `TSK-${id8}`, worktree: WT(id8), hash: `hb-${id8}-${t}`, reason: '질문? (A)/(B)', ...e })
const lost = (slot: string, id8: string, next: string) => line({ event: 'team.lost', slot, id8, worktree: WT(id8), cause: 'no-response', next, restart_at: '-' })

function run(lines: string[], args: string[] = ['--agent', A, '--repo', R]) {
  writeFileSync(ev, lines.join('\n') + '\n')
  const r = spawnSync('bash', [SCRIPT, ...args, '--events', ev], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  return r.stdout.trim().split('\n')
}
const get = (out: string[], key: string) => out.filter((l) => l.startsWith(key + ' '))

describe('lead-state.sh — 재구성 보조 요약', () => {
  it('bash 로 파싱되고 실행 권한이 있다', () => {
    expect(spawnSync('bash', ['-n', SCRIPT]).status).toBe(0)
    expect(spawnSync('test', ['-x', SCRIPT]).status).toBe(0)
  })

  it('마지막 team.start 이후만 읽고, 다른 agent·repo 줄은 섞지 않으며, 이벤트 줄 자체는 내지 않는다', () => {
    const out = run([
      start(), spawnE('1', 'old00001'),
      start({ wp: 'WP-02,dict/WP-03' }), spawnE('2', 'new00002'),
      spawnE('3', 'othr0003').replace(A, 'kim/mbp/lead'), line({ event: 'team.spawn', slot: '1', id8: 'repo0004', worktree: '-', handle: '-', spawn_kind: 'new' }, A, '/other'),
    ])
    expect(get(out, 'RUN')[0]).toMatch(/ wp=WP-02,dict\/WP-03$/)
    expect(get(out, 'SLOT').map((l) => l.split(' ')[2])).toEqual(['new00002'])
    expect(get(out, 'EVENTS')).toEqual(['EVENTS window=2 total=4 bad=0'])
    expect(out.join('\n')).not.toContain('"event"')
  })

  it('종료 시각은 마지막 team.extend 가 team.start 보다 우선한다(wp 가 없는 옛 줄은 -)', () => {
    const noWp = JSON.parse(start()); delete noWp.wp
    expect(get(run([JSON.stringify(noWp)]), 'RUN')[0]).toMatch(/ backend=tmux slots=3 until=18:00 until_label=- wp=-$/)
    const out = run([start(), line({ event: 'team.extend', until: '2026-09-25 06:00', until_label: '09-25 06:00' }), line({ event: 'team.extend', until: '2026-09-25 09:00', until_label: '09-25 09:00' })])
    expect(get(out, 'RUN')[0]).toMatch(/ until=2026-09-25 09:00 until_label=09-25 09:00 wp=-$/)
  })

  it('슬롯: 마지막이 spawn·blocked 인 id8 을 그 id8 의 마지막 team.spawn 값으로 잇고, 해소 워커는 워크트리 접미사로 가른다(readopt 뒤에도)', () => {
    const out = run([
      start(),
      spawnE('1', 'aaaa0001'),
      spawnE('2', 'bbbb0002'), blocked('2', 'bbbb0002'),
      spawnE('3', 'cccc0003', { worktree: WT('cccc0003', '-resolve'), spawn_kind: 'resolve' }),
      start(),
      spawnE('3', 'cccc0003', { worktree: WT('cccc0003', '-resolve'), spawn_kind: 'readopt', orig_kind: 'resolve' }),
      spawnE('4', 'dddd0004', { worktree: WT('dddd0004', '-resolve'), spawn_kind: 'readopt' }), // orig_kind 없는 옛 줄도 워크트리로 안다
      spawnE('1', 'eeee0005'), result('1', 'eeee0005', 'done'),
    ])
    const slots = get(out, 'SLOT')
    expect(slots).toContain(`SLOT 3 cccc0003 tsk=TSK-cccc0003 order=- kind=readopt/resolve state=spawn resolve=1 worktree=${WT('cccc0003', '-resolve')} handle=tmux:%3`)
    expect(slots).toContain(`SLOT 4 dddd0004 tsk=TSK-dddd0004 order=- kind=readopt/- state=spawn resolve=1 worktree=${WT('dddd0004', '-resolve')} handle=tmux:%4`)
    expect(slots.some((l) => l.includes('eeee0005'))).toBe(false)
    expect(slots.some((l) => l.includes('aaaa0001'))).toBe(false) // 앞 실행의 줄은 새 team.start 로 잘린다
  })

  it('제외: id8 마다 마지막 spawn·blocked·result·lost 로 정한다(answer 는 바꾸지 않는다)', () => {
    const out = run([
      start(),
      spawnE('1', 'prog0001'),                                             // 진행 중 → 영구
      spawnE('2', 'blok0002'), blocked('2', 'blok0002'), line({ event: 'team.answer', id8: 'blok0002', answer: 'A' }), // blocked → 영구
      result('-', 'skip0003', 'skipped'),                                  // 일시
      result('-', 'wait0004', 'skipped', { reason: '선행 미충족(사전 검사: d/TSK-03-01)' }), // 선행 대기 블록 몫
      result('1', 'rlim0005', 'failed rate-limit'),                        // 제외 없음
      result('1', 'dead0006', 'failed no-result'), result('1', 'canc0007', 'cancelled'), result('1', 'assn0008', 'failed not-assignee'),
      spawnE('3', 'agin0009'), result('3', 'agin0009', 'skipped'), spawnE('3', 'agin0009'), // 일시 제외가 풀려 다시 띄웠다 → 진행 중
      spawnE('1', 'done0010'), result('1', 'done0010', 'done'),
      lost('2', 'lost0011', 'restart'),
    ])
    const perm = get(out, 'EXCLUDE_PERM')[0].split(' ')[1].split(',').sort()
    expect(perm).toEqual(['agin0009', 'assn0008', 'blok0002', 'canc0007', 'dead0006', 'lost0011', 'prog0001'].sort())
    expect(get(out, 'EXCLUDE_TEMP')).toEqual(['EXCLUDE_TEMP skip0003'])
    expect(get(out, 'LOST')).toEqual(['LOST lost0011 cause=no-response next=restart'])
  })

  it('차단기: 끝에서부터 연속한 failed 수. not-assignee·cancelled·해소 내용 실패·next=wait 는 건너뛰고, team.lost 는 1건, 실패 아닌 결과에서 멈춘다', () => {
    const base = [start(), spawnE('1', 'r0000001', { worktree: WT('r0000001', '-resolve'), spawn_kind: 'resolve' })]
    expect(get(run([...base, result('1', 'x0000001', 'done'), result('1', 'x0000002', 'failed deps'), result('1', 'x0000003', 'failed no-result')]), 'BREAKER')).toEqual(['BREAKER 2'])
    expect(get(run([...base, result('1', 'x0000002', 'failed deps'), result('1', 'x0000004', 'failed not-assignee'), result('1', 'x0000005', 'cancelled'), lost('1', 'x0000006', 'wait')]), 'BREAKER')).toEqual(['BREAKER 1'])
    expect(get(run([...base, result('1', 'x0000002', 'failed deps'), lost('1', 'x0000006', 'restart')]), 'BREAKER')).toEqual(['BREAKER 2'])
    // 해소 워커의 내용 실패(failed gate)는 세지도 끊지도 않는다. 환경 실패(failed no-result)는 센다
    expect(get(run([...base, result('1', 'x0000002', 'failed deps'), result('1', 'r0000001', 'failed gate', { worktree: WT('r0000001', '-resolve') })]), 'BREAKER')).toEqual(['BREAKER 1'])
    expect(get(run([...base, result('1', 'x0000002', 'failed deps'), result('1', 'r0000001', 'failed no-result', { worktree: WT('r0000001', '-resolve') })]), 'BREAKER')).toEqual(['BREAKER 2'])
    // blocked·skipped·resolved 는 연속 수를 끊는다
    expect(get(run([...base, result('1', 'x0000002', 'failed deps'), blocked('1', 'x0000007')]), 'BREAKER')).toEqual(['BREAKER 0'])
    expect(get(run([...base, result('1', 'x0000002', 'failed deps'), result('1', 'r0000001', 'resolved')]), 'BREAKER')).toEqual(['BREAKER 0'])
  })

  it('결과 줄 경로(워크트리·TSK)별 마지막 처리 해시를 낸다(blocked 해시 포함, slot - 인 사전 검사 줄은 뺀다)', () => {
    const out = run([
      start(),
      spawnE('1', 'aaaa0001'), blocked('1', 'aaaa0001', { hash: 'H1' }), line({ event: 'team.answer', id8: 'aaaa0001', answer: 'A' }), blocked('1', 'aaaa0001', { hash: 'H2' }),
      result('-', 'skip0003', 'skipped', { worktree: '-', hash: '-' }),
      spawnE('2', 'bbbb0002'), result('2', 'bbbb0002', 'done', { hash: 'H3' }),
    ])
    expect(get(out, 'HASH').sort()).toEqual([`HASH ${WT('aaaa0001')} TSK-aaaa0001 H2 blocked id8=aaaa0001 slot=1`, `HASH ${WT('bbbb0002')} TSK-bbbb0002 H3 done id8=bbbb0002 slot=2`].sort())
  })

  it('답을 기다리는 질문은 마지막 이벤트가 team.blocked 인 id8 이고, 아직 지시를 보내지 않은 이슈는 마지막 team.issue 가 pending 인 것이다', () => {
    const out = run([
      start(),
      spawnE('1', 'aaaa0001'), blocked('1', 'aaaa0001'),
      spawnE('2', 'bbbb0002'), blocked('2', 'bbbb0002'), line({ event: 'team.answer', id8: 'bbbb0002', answer: 'B' }),
      spawnE('3', 'cccc0003'), blocked('3', 'cccc0003'), result('3', 'cccc0003', 'done'),
      line({ event: 'team.issue', id8: 'dddd0004', summary: '포트 충돌', decision: 'pending' }),
      line({ event: 'team.issue', id8: 'eeee0005', summary: 'x', decision: 'pending' }), line({ event: 'team.issue', id8: 'eeee0005', summary: 'x', decision: '계속 진행' }),
      line({ event: 'team.issue', id8: 'dialect', summary: '방언', decision: '사람 판단(자동 되돌리기·재오픈 없음)' }),
    ])
    expect(get(out, 'WAIT_ANSWER')).toEqual(['WAIT_ANSWER aaaa0001 slot=1 질문? (A)/(B)'])
    expect(get(out, 'ISSUE_PENDING')).toEqual(['ISSUE_PENDING dddd0004 포트 충돌'])
  })

  it('--agent 가 없으면 팀장 잠금 owner 첫 칸을 쓰고, 이벤트 파일이 없으면 빈 요약을 낸다', () => {
    const repo = join(tmp, 'lead')
    spawnSync('bash', ['-c', `mkdir -p '${repo}' && cd '${repo}' && git init -q && mkdir -p .git/dflow-team.lock && echo '${A} 1 2' > .git/dflow-team.lock/owner`])
    writeFileSync(ev, [start(), spawnE('1', 'aaaa0001')].map((l) => l.replace(R, repo)).join('\n') + '\n')
    const r = spawnSync('bash', [SCRIPT, '--events', ev], { cwd: repo, encoding: 'utf8' })
    expect(r.stdout).toMatch(/^SLOT 1 aaaa0001 /m)
    const none = spawnSync('bash', [SCRIPT, '--agent', A, '--repo', R, '--events', join(tmp, 'nope.jsonl')], { encoding: 'utf8' })
    expect(none.stdout.trim().split('\n')).toEqual(['RUN start=- backend=- slots=- until=- until_label=- wp=-', 'EVENTS window=0 total=0 bad=0', 'BREAKER 0', 'CONFLICT_CLEARED resolved=0 other=0', 'HASH_OMITTED 0', 'EXCLUDE_PERM -', 'EXCLUDE_TEMP -'])
    expect(readFileSync(SCRIPT, 'utf8')).toContain('실행 내내 쌓인 이벤트를 그대로')
  })

  // 2026-09-25 검토: 결과 수만큼 늘어나는 HASH 가 앞에 있어, 출력이 약 30K자를 넘으면 뒤의 제외·차단기·EVENTS 줄이 잘려 보이지 않았다
  it('크기가 고정된 줄을 먼저 내고, HASH 는 SLOT 의 것은 모두·나머지는 최근 50개만 내며 생략 수를 앞줄에 낸다', () => {
    const lines = [start(), spawnE('1', 'slot0001'), blocked('1', 'slot0001', { hash: 'HOLD' })] // 오래 blocked 인 슬롯
    for (let i = 0; i < 120; i++) { const id = `r${String(i).padStart(7, '0')}`; lines.push(spawnE('2', id), result('2', id, 'done', { hash: `H${i}` })) }
    lines.push(result('2', 'r0000003', 'done', { hash: 'H3b' })) // 오래된 경로를 다시 처리하면 최근이 된다
    lines.push(line({ event: 'team.issue', id8: 'iiii0001', summary: '포트', decision: 'pending' }))
    const out = run(lines)
    const firstVar = out.findIndex((l) => /^(SLOT|LOST|WAIT_ANSWER|HASH|ISSUE_PENDING) /.test(l))
    for (const k of ['RUN', 'EVENTS', 'BREAKER', 'CONFLICT_CLEARED', 'HASH_OMITTED', 'EXCLUDE_PERM', 'EXCLUDE_TEMP']) {
      const i = out.findIndex((l) => l.startsWith(k + ' '))
      expect(i, k).toBeGreaterThanOrEqual(0)
      expect(i, k).toBeLessThan(firstVar)
    }
    const hashes = get(out, 'HASH')
    expect(hashes).toContain(`HASH ${WT('slot0001')} TSK-slot0001 HOLD blocked id8=slot0001 slot=1`)
    expect(hashes.filter((l) => !l.includes('slot0001'))).toHaveLength(50)
    expect(hashes).toContain(`HASH ${WT('r0000003')} TSK-r0000003 H3b done id8=r0000003 slot=2`)
    expect(hashes).toContain(`HASH ${WT('r0000119')} TSK-r0000119 H119 done id8=r0000119 slot=2`)
    expect(hashes.some((l) => l.includes(' H70 '))).toBe(false)
    expect(get(out, 'HASH_OMITTED')).toEqual(['HASH_OMITTED 70'])
    // 생략된 경로는 --hash 로 따로 읽는다
    const one = run(lines, ['--agent', A, '--repo', R, '--hash', WT('r0000010')])
    expect(get(one, 'HASH')).toEqual([`HASH ${WT('r0000010')} TSK-r0000010 H10 done id8=r0000010 slot=2`])
  })

  it('깨진 줄(JSON 이 아니거나 객체가 아닌 줄)만 건너뛰고 그 뒤를 계속 읽으며, 건너뛴 수를 EVENTS 의 bad 로 낸다', () => {
    const out = run([start(), '{"event":"team.spawn", 깨짐', '123', '"x"', '', spawnE('1', 'aaaa0001'), line({ event: 'team.issue', id8: 'dddd0004', summary: '뒤쪽', decision: 'pending' })])
    expect(get(out, 'SLOT').map((l) => l.split(' ')[2])).toEqual(['aaaa0001'])
    expect(get(out, 'ISSUE_PENDING')).toEqual(['ISSUE_PENDING dddd0004 뒤쪽'])
    expect(get(out, 'EVENTS')).toEqual(['EVENTS window=3 total=3 bad=3'])
  })

  it('마지막 team.sweep 이후의 team.conflict cleared 를 해소 워커 resolved 뒤의 것과 그 밖의 것으로 나눠 센다', () => {
    const cleared = (id8: string) => line({ event: 'team.conflict', id8, decision: 'cleared', files: '-' })
    const base = [
      start(),
      result('1', 'old00001', 'resolved', { worktree: WT('old00001', '-resolve') }), cleared('old00001'),
      line({ event: 'team.sweep', merged: '1', waiting: '0', rejected: '0', resolved: '1' }),
    ]
    expect(get(run(base), 'CONFLICT_CLEARED')).toEqual(['CONFLICT_CLEARED resolved=0 other=0'])
    const out = run([
      ...base,
      result('1', 'aaaa0001', 'resolved', { worktree: WT('aaaa0001', '-resolve') }), cleared('aaaa0001'),
      result('2', 'bbbb0002', 'resolved', { worktree: WT('bbbb0002', '-resolve') }), line({ event: 'team.conflict', id8: 'bbbb0002', decision: 'human', files: '-' }), // 조상 확인 실패
      cleared('bbbb0002'), // 뒤에 사람 머지 감지로 푼 것은 resolved 가 아니다
      cleared('cccc0003'), // 사람 머지 감지·해소 건너뜀(REFLECTED)
      start(), // 재시작해도 마지막 스윕 뒤를 센다
      cleared('dddd0004'), result('1', 'dddd0004', 'resolved', { worktree: WT('dddd0004', '-resolve') }), // 기록 순서가 바뀌어도 짝짓는다
    ])
    expect(get(out, 'CONFLICT_CLEARED')).toEqual(['CONFLICT_CLEARED resolved=2 other=2'])
    // 스윕이 한 번도 없으면 처음부터 센다
    expect(get(run([start(), result('1', 'eeee0005', 'resolved'), cleared('eeee0005')]), 'CONFLICT_CLEARED')).toEqual(['CONFLICT_CLEARED resolved=1 other=0'])
  })
})
