// 자동 재시작이 SKILL.md 흐름에 들어갔는지(스펙 2026-09-23-worker-auto-restart-design.md §4·§5·§8).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const S = readFileSync('.claude/skills/dflow-team/SKILL.md', 'utf8')
const section = (from: string, to: string) => { const i = S.indexOf(from); expect(i, from).toBeGreaterThan(-1); return S.slice(i, S.indexOf(to, i + 1)) }

describe('dflow-team 자동 재시작 흐름', () => {
  it('참조와 압축 뒤 첫 기상에 restart.md 가 있다', () => {
    expect(S).toContain('`references/restart.md`(자동 재시작 판정·재투입·rate-limit 대기·중단 표식 정리)')
    expect(S).toContain('「7. 마감」 과 `references/events.md`, `references/restart.md`(전부), `references/backends.md` 의')
  })
  it('팀장 상태: 차단기는 team.lost 도 세고, 제외·고아 스캔 다섯째 조건·멈춤 사유를 더한다', () => {
    const st = section('## 팀장 상태', '## 두 번째 팀장')
    expect(st).toContain('`team.lost` 는 `cause` 와 무관하게 실패 1건으로 센다')
    expect(st).toMatch(/- \*\*`team\.lost`\*\*:[^\n]*영구 제외/)
    expect(st).toContain('`PARKED`·`RL_WAIT`·`RL_DUE` 가 아니다')
    for (const r of ['`pane 죽음`', '`rate-limit 반복`', '`rate-limit 대기(<HH:MM>)`', '`중단 표식 불일치`', '`서버 <status>`', '`서버 조회 실패`']) expect(st, r).toContain(r)
  })
  it('poll 재기동 조건에 rate-limit 보류가 있다', () => {
    expect(section('### 2-1. poll', '### 2-2.')).toContain('rate-limit 보류(`references/restart.md` 「이벤트로 본 상태」)가 없을 때만 띄운다')
  })
  it('기상 4번: 재시작 대기 목록이 새 작업보다 먼저, 보류 중에는 아무것도 띄우지 않는다', () => {
    const s = section('### 2-3. 기상마다 하는 일', '## 3. 결과 처리')
    expect(s).toContain('재시작 대기 목록(`references/restart.md` 「이벤트로 본 상태」 의 `RESTART_DUE`)도 재개 대상이며')
    expect(s).toContain('rate-limit 보류 중에는 재개·새 작업 모두 띄우지 않는다')
  })
  it('기상 표: PANE_DEAD 는 127 만 failed no-result, TICK 은 restart.md 판정', () => {
    const s = section('### 2-3. 기상마다 하는 일', '## 3. 결과 처리')
    expect(s).toMatch(/\| `PANE_DEAD <경로…>` \(tmux\) \|[^\n]*`references\/restart\.md` 「판정」[^\n]*127/)
    expect(s).toMatch(/\| `TICK` \|[^\n]*`references\/restart\.md` 「판정」/)
  })
  it('show 필터가 status 를 싣는다(G1 의 ready 갈래)', () => {
    expect(S).toContain("jq -c '{order: .order.id, status: .order.status, ref: .order.item.external_ref,")
    const m = S.match(/\| jq -c '(\{order: \.order\.id[\s\S]*?\})'/)
    const out = JSON.parse(execFileSync('jq', ['-c', m![1]], { input: JSON.stringify({ order: { id: 'o1', status: 'ready', item: { external_ref: 'd/TSK-01', spec: 'x' } } }) }).toString())
    expect(out.status).toBe('ready')
  })
  it('결과 처리: PANE_DEAD 는 127 을 먼저 보고, 그 밖은 restart.md 로 간다', () => {
    const s = section('## 3. 결과 처리', '## 4. 승인 스윕')
    const i127 = s.indexOf('`127`(`claude` 를 찾지 못함)이면 **곧바로** `failed no-result` 로 판정한다')
    expect(i127).toBeGreaterThan(-1)
    expect(s.indexOf('그 밖이면 `references/restart.md` 「판정」 으로 간다')).toBeGreaterThan(i127)
  })
  it('status 표: failed no-result 는 127 에만, failed rate-limit 는 재시작·보류 대상이 아니다', () => {
    const s = section('## 3. 결과 처리', '## 4. 승인 스윕')
    expect(s).toMatch(/\| `failed no-result`\(pane 이 죽었는데 결과 줄 없음\) \|[^\n]*127 이 아닌 죽음은[^\n]*restart\.md/)
    expect(s).toMatch(/\| `failed rate-limit` \|[^\n]*자동 재시작·보류 대상이 아니다/)
  })
  it('차단기와 무응답: team.lost 를 세고, tmux 무응답은 자동 재시작이 대신하며 Orca 는 관문 전 그대로', () => {
    const s = section('## 3. 결과 처리', '## 4. 승인 스윕')
    expect(s).toContain('`team.lost`(모든 `cause`)도 실패 1건으로 센다')
    expect(s).toContain('**자동 재시작**')
    expect(s).toMatch(/tmux 갈래는[^\n]*`references\/restart\.md`/)
    expect(s).toMatch(/Orca 는 관문 전이라/)
    // 기존 문구 유지
    expect(s).toContain('"무응답" 으로 보고만 하고 슬롯을 유지한다')
    expect(s).toContain('**두 TICK 연속으로** 생존 증거가 없을 때만')
  })
  it('5·5-1 은 띄우기 직전에 표식을 정리하고, 실패하면 띄우지 않는다', () => {
    const s5 = section('## 5. 팀원 spawn', '### 5-1. 재개 spawn')
    expect(s5).toContain('5. **띄우기 직전** `references/restart.md` 「중단 표식 정리」 블록을 돈다')
    expect(s5).toContain('`CANCEL_MARK_RM_FAILED` 면 띄우지 않고')
    const s51 = section('### 5-1. 재개 spawn', '## 6. blocked')
    expect(s51).toContain('- **재시작**: `references/restart.md` 「재투입」')
    expect(s51).toContain('6. **띄운다.** 먼저 `references/restart.md` 「중단 표식 정리」 블록을 돈다')
  })
  it('같은 작업 재spawn 예외가 넷이고 마감은 재시작 대기를 멈춤 표에 적는다', () => {
    expect(S).toContain('같은 작업을 다시 띄우는 것은 넷뿐이다.')
    expect(S).toContain('- 같은 작업의 재spawn. 예외는 넷이다.')
    expect(section('## 7. 마감', '**잠금 상실 마감**')).toContain('`references/restart.md` 「마감·lease·잠금」 대로')
  })
})
