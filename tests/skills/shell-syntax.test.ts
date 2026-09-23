import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const DFLOW = join(root, '.claude/skills/dflow-work/scripts/dflow.sh')
const POLL = join(root, '.claude/skills/dflow-poll/scripts/poll.sh')
const HOOK = join(root, 'kit/hooks/heartbeat.sh')

describe('셸 스크립트 문법(sh -n) — 자동 회귀 가드가 없던 파일들', () => {
  for (const f of [DFLOW, POLL, HOOK]) {
    it(`${f.replace(root, '')} 는 POSIX sh 로 파싱된다`, () => {
      expect(() => execFileSync('sh', ['-n', f])).not.toThrow()
    })
  }
})

describe('dflow.sh heartbeat · watch 계약(좌석표 v1 스펙 §4-1)', () => {
  const src = readFileSync(DFLOW, 'utf8')
  it('usage 에 두 서브커맨드가 있다', () => {
    expect(src).toMatch(/heartbeat <ref> \[--phase p\] \[--note "<질문>"\] \[--agent id\]/)
    // --json 은 응답 본문을 그대로 낸다. 좌석표의 「이어서 시작」 요청(resume_requests)이 실려 오는 길이다.
    expect(src).toMatch(/watch \[--agent id\] \[--slots n\] \[--busy n\] \[--until HH:MM\] \[--project id\] \[--holder h\] \[--json\] \[--stop\]/)
    expect(src).toContain("--json)    _raw=1; shift ;;")
  })
  it('디스패치에 두 case 가 있고 heartbeat 는 ref 를 요구한다', () => {
    expect(src).toMatch(/heartbeat\) \[ \$# -ge 1 \] \|\| usage; cmd_heartbeat "\$@" ;;/)
    expect(src).toMatch(/watch\) cmd_watch "\$@" ;;/)
  })
  it('git 은 DFLOW_GIT 로 주입 가능한 형태로만 부른다(팀장 스킬 후속 커밋과 충돌 방지)', () => {
    const fn = src.slice(src.indexOf('# ---- 좌석표 신호'), src.indexOf('cmd_done()'))
    expect(fn).not.toMatch(/(^|[^_A-Z}])git /m)
    expect(fn).toContain('${DFLOW_GIT:-git}')
  })
  it('watch 의 신원 조회 실패는 부모 셸을 종료시킨다(서브셸 die 만으로 끝나지 않는다)', () => {
    expect(src).toMatch(/_agent=\$\(watcher_id_default\) \|\| exit \$\?/)
  })
  it('agent_id_default 는 .dflow-agent 첫 줄의 CRLF 를 제거한다(kit/hooks/heartbeat.sh 와 같은 관례)', () => {
    const fn = src.slice(src.indexOf('agent_id_default()'), src.indexOf('watcher_id_default()'))
    expect(fn).toContain("tr -d '\\r'")
  })
  it('SKILL.md 가 두 서브커맨드를 설명한다', () => {
    const skill = readFileSync(join(root, '.claude/skills/dflow-work/SKILL.md'), 'utf8')
    expect(skill).toContain('### heartbeat')
    expect(skill).toContain('### watch')
    expect(skill).toContain('DFLOW_WATCH=0')
  })
})
