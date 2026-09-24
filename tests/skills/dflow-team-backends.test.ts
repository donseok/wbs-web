// tests/skills/dflow-team-backends.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd() // vitest 는 리포 루트에서 돈다(기존 tests/ 관례)
const SKILL_DIR = join(ROOT, '.claude', 'skills', 'dflow-team')
const read = (rel: string) => readFileSync(join(SKILL_DIR, rel), 'utf8')

describe('dflow-team backends.md·events.md 계약(스펙 §3-5·§4-2·§4-6·§4-8·§4-9·§9-3·§10)', () => {
  const b = () => read('references/backends.md')
  const e = () => read('references/events.md')

  // 2026-09-16 tmux 전환(스펙 2026-09-16-dflow-team-tmux-pane-design.md §9)으로 프로세스 백엔드
  // (nohup claude -p·pstart·.dflow-pid·.dflow-worker.log·LEAD_SKIP_PERMISSIONS)가 없어졌다. 그 단정은 지우고,
  // 같은 규칙이 tmux 로 옮겨 간 것(절 제목·회수·결과 줄 폴백·handle)은 현행 리터럴로 본다.
  it('tmux spawn 은 git worktree add --detach 로 워크트리를 만들고, 회수는 kill-pane, 결과 줄 폴백은 capture-pane 이다', () => {
    expect(b()).toContain('## pane(tmux)')
    expect(b()).toContain('git fetch -q origin && git worktree prune && git worktree add --detach "$WT" origin/<기본브랜치> || echo SPAWN_FAILED_WORKTREE')
    expect(b()).toContain('`--dangerously-skip-permissions`')
    expect(b()).toContain('| 회수 | `"$TM" -L dflow kill-pane -t <pane>`')
    expect(b()).toContain("\"$TM\" -L dflow capture-pane -p -J -S - -t <pane> 2>/dev/null | grep -E '^<TSK> <id8> ' | tail -n 1")
    expect(b()).toContain('`handle` 은 `tmux:<pane_id>` 다') // team.spawn 의 handle
    expect(b()).not.toContain('isolation')
    expect(b()).not.toContain('TaskStop')
  })

  // 2026-09-24 Orca spawn 전환(리허설 Orca 1.4.210·Claude Code 2.1.281): orca worktree create 를 버리고
  // git worktree add(tmux 와 같은 준비 블록)+ orca terminal create 조합으로 바꿨다.
  it('Orca spawn 은 tmux 와 같은 준비 블록(chmod +x 줄까지)을 그대로 쓰고, orca terminal create --worktree path: 와 ./.dflow-run 을 쓴다', () => {
    expect(b()).toContain('## pane(Orca)')
    expect(b()).toContain('`chmod +x\n"$WT/.dflow-run"` 줄까지 두 백엔드가 글자 그대로 같다')
    expect(b()).toContain('orca terminal create --worktree "path:$WT"')
    expect(b()).toContain('--command ./.dflow-run --json')
    expect(b()).not.toContain('orca worktree create --name dflow-<id8> --agent claude --no-parent')
    expect(b()).not.toContain('--base-branch origin/<기본브랜치> --prompt "<포인터 한 줄>" --json')
  })

  it('Orca 핸들은 result.terminal.handle 을 먼저 보고, 옛 런타임 폴백(agentTerminalHandle·startupTerminal.handle)을 남기며, .dflow-pane 에 쓴다', () => {
    expect(b()).toContain(`H=$(printf '%s' "$R" | jq -r '.result.terminal.handle // .result.agentTerminalHandle // "-"')`)
    expect(b()).toContain('`result.agentTerminalHandle`')
    expect(b()).toContain('`result.startupTerminal.handle`')
    expect(b()).toContain('printf \'%s\\n\' "$H" > "$WT/.dflow-pane"')
    expect(b()).toContain('화면 읽기 없이 git·서버 증거만 쓴다')
    expect(b()).not.toContain('워크트리 id')
    // events.md·SKILL.md 가 이미 정한 raw 핸들 형식을 그대로 쓴다 (orca: 접두를 붙이지 않는다)
    expect(b()).toContain('`orca:` 접두 없음')
  })

  it('Orca 폴더 신뢰 확인은 화면을 읽기만 하고 키를 보내지 않으며, I trust this folder 면 사람 확인 필요로 보고한다', () => {
    expect(b()).toContain('**폴더 신뢰 확인**: tmux 처럼 spawn 직후 화면을 최대 10 회(1초 간격) 읽어 가려낸다')
    expect(b()).toContain('orca terminal read --terminal "$H"')
    expect(b()).toContain('TRUST_NEEDS_HUMAN $H')
    expect(b()).toContain('**키를 보내는 방법은\n실측하지 않았으므로 보내지 않는다.**')
  })

  it('Orca 정리는 orca worktree list --json 유무로 옛/새 방식을 갈라 orca worktree rm 또는 git worktree remove --force 를 고른다', () => {
    expect(b()).toContain('orca worktree list --json 2>/dev/null | jq -e --arg p "<경로>" \'[.result.worktrees[]?.path] | index($p) != null\'')
    expect(b()).toContain('orca worktree rm --worktree path:<경로>')
    expect(b()).toContain('git worktree remove --force "<경로>"')
    expect(b()).toContain('"Orca 정리 명령"은 「pane(Orca)」 「정리」의') // 고아 정리 규칙이 이 줄임말을 쓴다
    expect(b()).toContain('Orca 는 Orca 정리 명령에 `--force` 를 붙인다') // 부트스트랩 실패 정리
    expect(b()).toContain('체크아웃된 로컬 브랜치만 삭제를 시도하고')
    expect(b()).toContain('**화면은 생존 증거로 쓰지 않는다.**')
  })

  it('팀원 전용 설정(플러그인·MCP 끄기)은 플러그인 이름을 하드코딩하지 않고, MCP 는 --no-chrome --strict-mcp-config 로 끄며 --mcp-config 는 쓰지 않는다', () => {
    expect(b()).toContain('enabledPlugins')
    expect(b()).toContain('DFLOW_WORKER_PLUGINS')
    expect(b()).toContain('DFLOW_WORKER_MCP')
    expect(b()).toContain('set -- --no-chrome --strict-mcp-config')
    expect(b()).toContain('`--mcp-config` 는 쓰지 않는다')
    // exec 줄 자체(가변 인자 문제가 나는 자리)에는 --mcp-config 를 쓰지 않는다. 설명 문장의 언급만 있다.
    const runTail = b().match(/cat >> "\$WT\/\.dflow-run" <<'RUNEOF'\n([\s\S]*?)\nRUNEOF/)![1]
    expect(runTail).not.toContain('--mcp-config')
    // 목록을 하드코딩하지 않는다: 특정 플러그인 이름을 문서에 적지 않는다
    expect(b()).not.toMatch(/vercel@/)
    expect(b()).not.toContain('claude-in-chrome@')
    expect(b()).toContain('--setting-sources')
    expect(b()).toContain('전역 `~/.claude/settings.json` 자체는 읽기만 하고 건드리지 않는다')
  })

  it('ORCA_AGENT_TEAMS_TEAM_ID 가 있을 때만 ORCA_*·TMUX 를 벗기고 PATH 의 shim 을 뺀다', () => {
    expect(b()).toContain('if [ -n "${ORCA_AGENT_TEAMS_TEAM_ID-}" ]; then')
    expect(b()).toContain(`for v in $(env | sed -n 's/^\\(ORCA_[A-Z0-9_]*\\)=.*/\\1/p'); do unset "$v"; done\n  unset TMUX TMUX_PANE`)
    expect(b()).toContain('**`ORCA_*`·`TMUX`·`TMUX_PANE` 벗기기와 PATH 의 shim 제거는 `ORCA_AGENT_TEAMS_TEAM_ID` 가 있을 때만 한다**')
  })

  it('결과 처리 회수는 tmux kill-pane, Orca orca terminal close --tab 이며 ptyKilled:false 는 실패가 아니다', () => {
    expect(b()).toContain('| 회수 | 결과 줄 처리 뒤 `kill-pane -t <pane>` | 결과 줄 처리 뒤 `orca terminal close --terminal <handle> --tab --json`')
  })

  it('고아 정리 규칙: 깨끗하고 push 된 것만, 부트스트랩 실패는 알려진 부산물만일 때 --force, 못 지우면 parked, 살아 있는 팀원은 지우지 않고, 생성 브랜치를 정리한다', () => {
    expect(b()).toContain('## 고아 정리 규칙')
    expect(b()).toContain('`<신원>/<host>/`')
    expect(b()).toContain('git worktree remove --force')
    expect(b()).toContain('git -C <워크트리> status --porcelain')
    expect(b()).toMatch(/rev-parse HEAD[\s\S]*rev-parse origin\/<agent 브랜치>/)
    expect(b()).toContain('status --porcelain --untracked-files=all')
    expect(b()).toContain("printf '%s\\n' '<신원>/<host>/parked' > <워크트리>/.dflow-agent")
    // parked 표시는 3번(남기는 모든 경우)에 있고, 살아 있는 팀원(4번)은 제외한다
    expect(b()).toMatch(/3\. 하나라도 거짓이면[\s\S]{0,700}printf '%s\\n' '<신원>\/<host>\/parked'/)
    expect(b()).toContain('살아 있는 팀원의 워크트리(4번)가\n   아니면 `.dflow-agent` 값을 `parked` 로 바꿔') // 11c08854 에서 줄바꿈만 바뀌었다
    expect(b()).toContain('살아 있는 팀원(SKILL.md 「팀장 상태」 정의)의 워크트리는 조건과 무관하게 지우지 않는다')
    // 생성 브랜치 정리: agent/ 가 아니고 origin/<기본브랜치> 의 조상인 생성 브랜치만 지운다
    expect(b()).toContain('**생성 브랜치 정리**')
    expect(b()).toContain("git branch --format='%(refname:short)' --list '*dflow-<id8>*'")
    expect(b()).toContain("git branch --format='%(refname:short)' --list '*dflow-[0-9a-f]*'") // id8 을 모를 때, Orca 접두 대비
    expect(b()).toContain('두 백엔드 모두 생성 브랜치가 없으므로')
    expect(b()).toContain('case "$br" in agent/*) continue ;; esac')
    expect(b()).toContain('git merge-base --is-ancestor "$br" origin/<기본브랜치> && git branch -D "$br"')
  })

  // 2026-09-24: agent 브랜치가 이미 머지·삭제돼 원격에 없어도 --no-ff 머지의 조상 관계로 정리할 수 있게 한 대안 조건
  it('고아 정리 규칙 2번은 원격 agent 브랜치가 없어도 HEAD 가 기본 브랜치의 조상이면 정리하는 대안 조건을 둔다', () => {
    expect(b()).toContain('if git -C <워크트리> rev-parse -q --verify "origin/<agent 브랜치>" >/dev/null; then')
    expect(b()).toContain('git -C <워크트리> merge-base --is-ancestor HEAD "origin/<기본브랜치>"')
    expect(b()).toContain('**대안 조건**(둘째 갈래, 2026-09-24 추가)')
    expect(b()).toContain('`/dflow-merge` 는 `--no-ff` 고정이라 머지된 작업의 HEAD 는 기본')
  })

  it('차이표가 기상·blocked·슬롯·회수·정리·git 호출을 백엔드별로 가른다', () => {
    for (const row of ['| 기상 신호 |', '| `blocked` 이후 |', '| 슬롯 점유 |', '| 회수 |', '| 팀장 세션이 죽으면 |', '| 정리 |', '| 팀원 화면 |', '| git 호출 |']) {
      expect(b(), row).toContain(row)
    }
    expect(b()).toContain('| 항목 | pane(tmux) | pane(Orca) |')
  })

  it('플랫폼 차이 절: Windows(Git Bash) 는 uname 분기·CLAUDE_PID·복사본 링크로 같은 절차를 돈다', () => {
    expect(b()).toContain('## 플랫폼 차이')
    expect(b()).toContain('| 팀장 세션 PID | `CLAUDE_PID`(= `$PPID`) |')
    expect(b()).toContain('NO_CLAUDE_PID') // CLAUDE_PID 없으면 전제 검사가 fail-closed 로 막는다(SKILL.md 와 같은 사실)
    expect(b()).toContain('`ln -s` 가 복사본을 만든다')
    expect(b()).not.toContain('ps -o lstart= -p "$(cat .dflow-pid)"')
    expect(b()).toContain('\\.claude/skills(/dflow-(dev|work)(/.*)?)?')
  })

  it('킷 밖 경로를 적지 않는다', () => {
    expect(b()).not.toContain('~/project/')
    expect(b()).not.toContain('dev-plugin')
  })

  it('events.md 는 일곱 이벤트와 스펙 §9-3 추가 필드를 표로 담는다', () => {
    for (const row of [
      '| `team.start` | 「1. 시작」 5번 | `backend`, `slots`, `until`, `wp` |', // wp 는 87805910
      '| `team.spawn` | 「5. 팀원 spawn」 6번, 「5-1. 재개 spawn」 7번, 「1. 시작」 5번(이어받은 슬롯 재기록) | `slot`, `id8`, `worktree`, `handle`, `spawn_kind` |',
      '| `team.result` | 「3. 결과 처리」, 「1. 시작」 5번(이어받은 해시 재기록) | `slot`, `id8`, `status`, `worktree`, `hash`, `reason` |',
      '| `team.blocked` | 「3. 결과 처리」·「6. blocked」, 「1. 시작」 5번(이어받은 해시·답 대기 재기록) | `slot`, `id8`, `worktree`, `hash`, `reason` |',
      '| `team.answer` | 「6. blocked」 답 매칭, 「1. 시작」 5번(대기 중인 답 재기록) | `id8`, `answer` |',
      '| `team.sweep` | 「4. 승인 스윕」 | `merged`, `waiting`, `rejected`, `resolved` |', // resolved 는 2026-09-23 머지 충돌 해소
      '| `team.stop` | 「7. 마감」 | 없음 |',
    ]) expect(e(), row).toContain(row)
  })

  it('기록은 jq -nc 한 줄 append 이고 실패해도 막지 않으며 해시·사유를 jq 인자로 넘긴다', () => {
    expect(e()).toContain('jq -nc')
    expect(e()).toContain('>> ~/.dflow/events.jsonl || echo EVENT_ARGS_MISSING')
    expect(e()).toContain('error("EVENT_ARGS_MISSING")') // 공통 다섯 필드가 비면 줄을 붙이지 않는다
    // 가드는 이벤트별 추가 필드·phase·host 도 본다(압축 뒤 기억으로 쓴 줄을 거른다)
    expect(e()).toContain('"team.result":["slot","id8","status","worktree","hash","reason"]')
    expect(e()).toContain('"team.stop":[]')
    expect(e()).toContain('.phase == "team" and .host == $h')
    // 첫 jq(줄 생성)와 둘째 jq(가드)는 파이프가 아니라 && 로 잇는다: 첫 jq 의 컴파일 오류도 EVENT_ARGS_MISSING 으로 모인다
    expect(e()).toContain('line=$(jq -nc')
    expect(e()).toContain(`&& printf '%s\\n' "$line" | jq -c --arg h`)
    expect(e()).not.toMatch(/agent\}' \\\n\s*\| jq -c/)
    expect(e()).toContain('($k == "reason" or .[$k] != "")') // 추가 필드의 빈 문자열 거부, reason 만 예외
    expect(e()).toContain('--arg h "$(hostname | cut -d. -f1)"')
    expect(e()).toContain('phase:"team"')
    expect(e()).toContain("--arg agent '<신원>/<host>/lead'")
    expect(e()).toContain("cksum | cut -d' ' -f1")
    expect(e()).toContain('--arg reason "$reason"')
    expect(e()).toContain('`failed rate-limit`')
    expect(e()).toContain('`failed permission`')
    expect(e()).toContain('`backend` 는 `tmux` 또는 `orca`')
    expect(e()).toContain('`tmux:<pane_id>`')
    expect(e()).not.toContain('agent-team')
  })
})
