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

  it('에이전트 팀 spawn 은 isolation worktree 가 필수이고 이름은 w<slot>-<id8>, 회수는 TaskStop 이다', () => {
    expect(b()).toContain('| `isolation` | `"worktree"`. **필수.**')
    expect(b()).toContain('| `name` | `w<slot>-<id8>` |')
    expect(b()).toContain('`general-purpose`')
    expect(b()).toContain('TaskStop(w<slot>-<id8>)')
  })

  it('Orca spawn 은 origin/<기본브랜치> 기점이고 터미널 핸들이 없으면 화면 없이 git·서버 증거만 쓴다', () => {
    expect(b()).toContain('--base-branch origin/<기본브랜치> --prompt "<포인터 한 줄>" --json')
    expect(b()).not.toContain('origin/main')
    expect(b()).toContain('`result.worktree.path`')
    expect(b()).toContain('`result.agentTerminalHandle`')
    expect(b()).toContain('`result.startupTerminal.handle`')
    expect(b()).toContain('화면 읽기 없이 git·서버 증거만 쓴다')
    expect(b()).not.toContain('워크트리 id')
  })

  it('Orca 정리는 path 선택자를 쓰고 브랜치 보존 규칙을 적으며, 화면은 생존 증거가 아니다', () => {
    expect(b()).toContain('orca worktree rm --worktree path:<경로>')
    expect(b()).toContain('`orca worktree rm --worktree path:<경로> --force`') // 부트스트랩 실패 정리만
    expect(b()).toContain('체크아웃된 로컬 브랜치만 삭제를 시도한다')
    expect(b()).toContain('**화면은 생존 증거로 쓰지 않는다.**')
  })

  it('고아 정리 규칙: 깨끗하고 push 된 것만, 부트스트랩 실패는 알려진 부산물만일 때 --force, 못 지우면 parked, 살아 있는 팀원은 지우지 않고, 생성 브랜치를 정리한다', () => {
    expect(b()).toContain('## 고아 정리 규칙')
    expect(b()).toContain('`<신원>/<host>/`')
    expect(b()).toContain('git worktree remove --force')
    expect(b()).toContain('git -C <워크트리> status --porcelain')
    expect(b()).toMatch(/rev-parse HEAD[\s\S]*rev-parse origin\/<agent 브랜치>/)
    expect(b()).toContain('status --porcelain --untracked-files=all')
    expect(b()).toContain("printf '%s\\n' '<신원>/<host>/parked' > <워크트리>/.dflow-agent")
    expect(b()).toContain('살아 있는 팀원(SKILL.md 「팀장 상태」 정의)의 워크트리는 조건과 무관하게 지우지 않는다')
    // 생성 브랜치 정리: agent/ 가 아니고 origin/<기본브랜치> 의 조상인 생성 브랜치만 지운다
    expect(b()).toContain('**생성 브랜치 정리**')
    expect(b()).toContain("'worktree-<워크트리 디렉터리 이름>' '*dflow-<id8>*'")
    expect(b()).toContain("git branch --format='%(refname:short)' --list 'worktree-agent-*' '*dflow-[0-9a-f]*'") // 이름을 모를 때, Orca 접두 대비
    expect(b()).toContain('case "$br" in agent/*) continue ;; esac')
    expect(b()).toContain('git merge-base --is-ancestor "$br" origin/<기본브랜치> && git branch -D "$br"')
  })

  it('차이표가 기상·blocked·슬롯·회수·정리·git 호출을 백엔드별로 가른다', () => {
    for (const row of ['| 기상 신호 |', '| `blocked` 이후 |', '| 슬롯 점유 |', '| 회수 |', '| 정리 |', '| git 호출 |']) {
      expect(b(), row).toContain(row)
    }
  })

  it('tmux 는 v1 미지원 한 줄만 두고 킷 밖 경로를 적지 않는다', () => {
    expect(b()).toContain('tmux pane 백엔드는 v1 미지원이다')
    expect(b()).not.toContain('~/project/')
    expect(b()).not.toContain('dev-plugin')
  })

  it('events.md 는 일곱 이벤트와 스펙 §9-3 추가 필드를 표로 담는다', () => {
    for (const row of [
      '| `team.start` | 「1. 시작」 4번 | `backend`, `slots`, `until` |',
      '| `team.spawn` | 「5. 팀원 spawn」 6번, 「1. 시작」 4번(이어받은 슬롯 재기록) | `slot`, `id8`, `worktree`, `handle` |',
      '| `team.result` | 「3. 결과 처리」, 「1. 시작」 4번(이어받은 해시 재기록) | `slot`, `id8`, `status`, `worktree`, `hash`, `reason` |',
      '| `team.blocked` | 「3. 결과 처리」·「6. blocked」, 「1. 시작」 4번(이어받은 해시·답 대기 재기록) | `slot`, `id8`, `worktree`, `hash`, `reason` |',
      '| `team.answer` | 「6. blocked」 답 매칭, 「1. 시작」 4번(대기 중인 답 재기록) | `id8`, `answer` |',
      '| `team.sweep` | 「4. 승인 스윕」 | `merged`, `waiting`, `rejected` |',
      '| `team.stop` | 「7. 마감」 | 없음 |',
    ]) expect(e(), row).toContain(row)
  })

  it('기록은 jq -nc 한 줄 append 이고 실패해도 막지 않으며 해시·사유를 jq 인자로 넘긴다', () => {
    expect(e()).toContain('jq -nc')
    expect(e()).toContain('>> ~/.dflow/events.jsonl || echo EVENT_ARGS_MISSING')
    expect(e()).toContain('error("EVENT_ARGS_MISSING")') // 공통 다섯 필드가 비면 줄을 붙이지 않는다
    expect(e()).toContain('phase:"team"')
    expect(e()).toContain("--arg agent '<신원>/<host>/lead'")
    expect(e()).toContain("cksum | cut -d' ' -f1")
    expect(e()).toContain('--arg reason "$reason"')
    expect(e()).toContain('`failed rate-limit`')
  })
})
