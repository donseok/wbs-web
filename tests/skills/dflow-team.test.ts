// tests/skills/dflow-team.test.ts
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = process.cwd() // vitest 는 리포 루트에서 돈다(기존 tests/ 관례)
const SKILL_DIR = join(ROOT, '.claude', 'skills', 'dflow-team')
const read = (rel: string) => readFileSync(join(SKILL_DIR, rel), 'utf8')
// 감시 루프(「2-2」)와 기상 블록(「2-3」)은 2026-09-25 에 scripts/tick.sh·wake.sh 로 옮겼다(팀장이 루프를 매번 다시 쓰지 않게)
const tick = () => read('scripts/tick.sh')
const wake = () => read('scripts/wake.sh')

// {ANSWER} 는 tmux 전환(스펙 2026-09-16 §9, 236a3a25)으로 없어졌고 {DEV_BRANCH} 가 .dflow 전환(cdccee70)으로 들어왔다
const PLACEHOLDERS = ['{TSK}', '{ID8}', '{AGENT_ID}', '{MAIN_CHECKOUT}', '{BACKEND}', '{MODEL_FLAG}', '{DEV_BRANCH}']

describe('dflow-work dflow.sh .env 자동 로드', () => {
  // Task 2(.dflow 설정 전환): dflow.sh 는 이제 dflow-config.sh 를 source 해 로드를 위임한다.
  // 레거시 폴백(DFLOW_ENV_FILE, 기본 ./.env)은 dflow-config.sh 에 남아 있고, 동작은
  // tests/skills/dflow-config.test.ts 의 legacy 모드 테스트가 검사한다.
  it('환경에 PAT 가 없으면 DFLOW_ENV_FILE(기본 ./.env) 를 스스로 읽는다', () => {
    const sh = readFileSync(join(ROOT, '.claude/skills/dflow-work/scripts/dflow.sh'), 'utf8')
    expect(sh).toContain('. "$(dirname "$0")/dflow-config.sh"')
    expect(sh).toContain('dflow_config_load || exit 2')
    const lib = readFileSync(join(ROOT, '.claude/skills/dflow-work/scripts/dflow-config.sh'), 'utf8')
    expect(lib).toContain('_dfc_envf:-./.env')
  })
})

describe('dflow-team worker-prompt.md 계약(스펙 §5)', () => {
  const p = () => read('references/worker-prompt.md')

  it('치환 변수 일곱 개와 포인터 키를 표로 설명하고 AGENT_ID 는 신원/host/slot 이다', () => {
    expect(existsSync(join(SKILL_DIR, 'references/worker-prompt.md'))).toBe(true)
    for (const v of PLACEHOLDERS) expect(p(), v).toContain('`' + v + '`')
    for (const k of ['TSK', 'ID8', 'AGENT_ID', 'MAIN_CHECKOUT', 'BACKEND', 'MODEL', 'DEV_BRANCH']) {
      expect(p(), k).toContain('| `' + k + '` |')
    }
    expect(p()).toContain('`<신원>/<host>/w<slot>`')
  })

  it('git 은 절대경로로 부르고, 격리 확인은 git-dir 와 git-common-dir 두 줄 비교 한 호출로 한다', () => {
    expect(p()).toContain('command -v git')
    expect(p()).toContain('bare `git` 금지')
    expect(p()).toContain('git rev-parse --git-dir --git-common-dir')
    expect(p()).toContain('출력 두 줄이 **같으면** 주 워크트리')
    expect(p()).toContain('{TSK} {ID8} - - - failed not-isolated')
    expect(p()).toContain('**아무 파일도 쓰지 않고**')
    expect(p()).not.toContain('show-toplevel')
  })

  it('셸 블록(펜스 안)에 git 을 감싸는 명령 치환이 없다', () => {
    const blocks = [...p().matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1])
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) {
      for (const line of block.split('\n')) {
        expect(line.includes('$(') && line.includes('git'), line).toBe(false)
      }
    }
  })

  it('.dflow-agent 는 격리 확인 직후, 부트스트랩 전에 워크트리 루트에 쓴다', () => {
    const t = p()
    const iso = t.indexOf('NOT_ISOLATED')
    const seat = t.indexOf("printf '%s\\n' '{AGENT_ID}' > .dflow-agent")
    const boot = t.indexOf('ln -s {MAIN_CHECKOUT}/.env .env')
    expect(iso).toBeGreaterThan(-1)
    expect(seat).toBeGreaterThan(iso)
    expect(boot).toBeGreaterThan(seat)
    expect(t).not.toMatch(/docs\/tasks\/\{TSK\}\/\.dflow-agent/)
  })

  it('부트스트랩은 .env·스킬을 링크하고 인증 확인 뒤 origin/<기본브랜치> 로 detach 하며 --worker 를 확인한다', () => {
    expect(p()).toContain('[ -e .env ] || ln -s {MAIN_CHECKOUT}/.env .env')
    expect(p()).toContain('if [ -d .claude/skills ] && [ ! -L .claude/skills ]; then')
    expect(p()).toContain('[ -e ".claude/skills/$s" ] || ln -s "{MAIN_CHECKOUT}/.claude/skills/$s" ".claude/skills/$s"')
    expect(p()).toContain('mkdir -p .claude && ln -s {MAIN_CHECKOUT}/.claude/skills .claude/skills')
    expect(p()).toContain('.claude/skills/dflow-work/scripts/dflow.sh doctor; echo "doctor=$?"')
    expect(p()).not.toContain('. ./.env')
    expect(p()).toContain('git fetch origin && git switch --detach origin/<기본브랜치>')
    // .dflow 전환(2026-09-23): <기본브랜치> 는 팀장이 넘긴 {DEV_BRANCH} 다. 워커는 symbolic-ref·ls-remote 로
    // 다시 해석하지 않는다(dflow-config-docs.test.ts 가 이 계약을 단정한다).
    expect(p()).toContain('`<기본브랜치>` 는 팀장이 넘긴 `{DEV_BRANCH}` 다')
    expect(p()).not.toContain('symbolic-ref --short refs/remotes/origin/HEAD')
    expect(p()).toContain("grep -qE '^<!-- dflow-caps: worker |--worker' .claude/skills/dflow-dev/SKILL.md || echo NO_WORKER_FLAG")
  })

  it('인증은 doctor 종료 코드가 아니라 me 로 판정하고, 의존성은 설치하지 않는다(/dflow-dev 행 H 가 한다)', () => {
    expect(p()).toContain('dflow.sh me >/dev/null || echo AUTH_FAILED')
    expect(p()).toContain('{TSK} {ID8} - - - failed auth')
    expect(p()).toContain('{TSK} {ID8} - - - failed doctor-<exit>')
    expect(p()).toContain('{TSK} {ID8} - - - failed no-skill')
    expect(p()).toContain('{TSK} {ID8} - - - failed detach')
    expect(p()).toContain('「--worker」 H')
    expect(p()).not.toContain('npm ci')
    expect(p().indexOf('AUTH_FAILED')).toBeLessThan(p().indexOf('git switch --detach origin/<기본브랜치>'))
  })

  // ANSWER 재spawn 은 tmux 전환으로 없어졌다(스펙 2026-09-16 §9). 같은 세션이 답을 받아 이어 간다.
  it('blocked 답을 받아 이어 가면 결정을 design.md 에 남긴다', () => {
    expect(p()).toContain('`- 담당자 결정(blocked 응답): <답>`')
  })

  it('/dflow-dev --worker 로 실행하고 Skill 미등록이면 SKILL.md 를 직접 따른다', () => {
    expect(p()).toContain('/dflow-dev {ID8} --worker {MODEL_FLAG}')
    expect(p()).toContain('`.claude/skills/dflow-dev/SKILL.md` 를 Read 해서')
  })

  it('서버 쓰기는 {ID8} 하나뿐이고 list 를 부르지 않는다', () => {
    expect(p()).toContain('`list` 는 호출하지 않는다')
    expect(p()).toContain('`show {ID8}` 뿐이다')
  })

  it('.result 한 줄 형식, status 다섯, skipped 사유와 failed 구분 사유 넷을 담는다', () => {
    expect(p()).toMatch(/^\{TSK\} \{ID8\} <branch\|-> <head_sha\|-> <done_exit\|-> <status> <한 줄 사유 또는 질문>$/m)
    for (const s of ['done', 'skipped', 'needs-merge', 'blocked', 'failed']) expect(p(), s).toContain('| `' + s + '` |')
    for (const r of ['`선행 미승인`', '`선행 승인 대기`', '`선행을 모두 조상으로 갖는 기점 없음`', '`spec 부재`', '`claim-exit-4`']) {
      expect(p(), r).toContain(r)
    }
    for (const r of ['`rate-limit`', '`not-isolated`', '`no-worker-flag`', '`deps`']) expect(p(), r).toContain(r)
    expect(p()).toContain('{TASK_DIR}/.result')
  })

  // BACKEND 는 이제 언제나 pane 이라 백엔드별 표가 없어졌다(스펙 2026-09-16 §9, 236a3a25).
  it('blocked 는 커밋·push 뒤 쓰고 AskUserQuestion 을 쓰지 않는다', () => {
    expect(p()).toContain('AskUserQuestion 을 쓰지 않는다')
    expect(p()).toContain('현재 산출물을 커밋·push 한 뒤')
    expect(p()).not.toContain('agent-team')
  })

  it('팀원은 권한 거부를 우회하지 않고 failed permission 으로 보고한다', () => {
    expect(p()).toContain('**권한 거부**') // 236a3a25: 백엔드 구분이 없어져 '(프로세스)' 가 빠졌다
    expect(p()).toContain('failed permission <거부된 명령의 첫 낱말들>')
    expect(p()).toContain('`permission`(권한 거부')
  })

  it('기본 브랜치로 switch 하지 않는다(detach 만 한다)', () => {
    expect(p()).not.toMatch(/switch (main|<기본브랜치>|origin\/main)(\s|$)/m)
  })

  it('blocked 직전에 좌석표 heartbeat 를 1회 보내고 실패를 무시한다(에이전트 스튜디오 v1 계약)', () => {
    const line = p()
      .split('\n')
      .find((l) => l.includes('dflow.sh heartbeat {ID8} --phase blocked --note'))
    expect(line, 'heartbeat 줄이 있어야 한다').toBeTruthy()
    expect(line!.trimEnd().endsWith('|| :')).toBe(true)
    expect(p()).toContain('`.result` 를 쓰기\n전에 좌석표에 손 든 상태를 알린다')
  })
})

describe('dflow-team SKILL.md 계약(스펙 §4·§7)', () => {
  const s = () => read('SKILL.md')

  it('파일 넷이 정본 위치에 있고 킷 밖 경로와 zsh 에서 깨지는 셸 구문(따옴표 밖 docs/tasks glob, [ \\> ])을 적지 않는다', () => {
    const merge = readFileSync(join(ROOT, '.claude/skills/dflow-merge/SKILL.md'), 'utf8')
    for (const rel of ['SKILL.md', 'references/worker-prompt.md', 'references/backends.md', 'references/events.md']) {
      expect(existsSync(join(SKILL_DIR, rel)), rel).toBe(true)
      expect(read(rel), rel).not.toContain('~/project/')
    }
    for (const [rel, t] of [...['SKILL.md', 'references/worker-prompt.md', 'references/backends.md', 'references/events.md'].map((r) => [r, read(r)]), ['dflow-merge', merge]]) {
      expect(t, rel).not.toMatch(/[^'`]docs\/tasks\/\*/) // 매치가 없으면 zsh 가 no matches found 로 명령 전체를 죽인다
      expect(t, rel).not.toMatch(/\[ [^\]\n]*\\>/) // zsh 는 condition expected 로 실패한다
    }
  })

  it('프론트매터는 새 명령 형태만 쓰고 옛 옵션이 없다', () => {
    const fm = s().match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
    expect(fm).toMatch(/^name: dflow-team$/m)
    expect(fm).toContain('"/dflow-team"')
    expect(fm).toContain('사용법 - /dflow-team [인원] <종료시각|종료 요청 전까지> [모델]')
    expect(fm).not.toContain('--worker')
    for (const old of ['--team-size', '--interval SEC', '--exclude id8', '--until HH:MM']) expect(s(), old).not.toContain(old)
  })

  // 당일 한정(자정 넘김 불가)은 5bf6e07d(여러 날 실행)로, 누락 시 사용법 출력은 87805910(질문)으로,
  // 300초 주기는 ab8ee46b(180초)로 바뀌었다.
  // 하드 상한 6 은 2026-09-24 에 PC 별 상한 min(6, K+2)(capacity.sh max)로 바뀌었다. 6 은 덮어도 넘지 못하는 천장으로 남는다.
  it('인자: 기본 3·상한 min(6, K+2), 종료 시각이 유일한 필수, 180초 고정, 작업 빼기는 agent 태그', () => {
    expect(s()).toContain('**기본 3, 인원 상한은 이 PC 의 `min(6, K+2)`.**')
    expect(s()).toContain('.claude/skills/dflow-team/scripts/capacity.sh max')
    expect(s()).toContain('`DFLOW_TEAM_MAX`(1~6)로 덮는다')
    expect(s()).toContain('**종료 시각은 유일한 필수 인자다.**')
    expect(s()).toContain('poll 조회 주기는 180초(3분)로 고정하고')
    expect(s()).toContain('`agent` 태그를 끈다')
  })

  // 프로세스 백엔드 갈래와 "병렬 불가로 종료하지 않는다" 는 tmux 전환(스펙 2026-09-16 §2·§3)으로 없어졌다.
  it('환경 감지는 Orca 환경변수를 보고 에이전트 팀을 백엔드로 쓰지 않는다', () => {
    expect(s()).toContain('ORCA_WORKTREE_ID')
    expect(s()).not.toContain('에이전트 팀')
  })

  it('전제 검사: 실패하면 종료하는 블록, mkdir 원자 잠금과 beat 70분(beat 없으면 잠금 디렉터리 수정 시각 10분), owner 의 세션 PID, 기본 브랜치 폴백, 신원·host 슬러그, ~/.dflow', () => {
    expect(s()).toContain('[ "$fail" = 0 ] || exit 1')
    expect(s()).toContain("case \"$MAIN\" in *' '*) bad SPACE_IN_PATH ;; esac")
    expect(s()).toContain('LOCK=$(git rev-parse --git-path dflow-team.lock)')
    expect(s()).toContain('mkdir "$LOCK" 2>/dev/null')
    expect(s()).toContain('stale() {') // beat 있으면 70분, 없으면 잠금 디렉터리 수정 시각 10분으로 죽음을 본다
    expect(s()).toContain('b=$(cat "$1/beat" 2>/dev/null || true)')
    expect(s()).toContain('-ge 4200')
    expect(s()).toContain('find "$1" -maxdepth 0 -mmin +10') // beat 없으면 잠금 디렉터리 수정 시각을 본다(macOS·Linux 공통)
    expect(s()).toContain(`printf '%s %s %s\\n' "$who/$host/lead" "$(date +%s)" "$LEAD_PID" > "$LOCK/owner"`) // 소유는 신원 + 팀장 세션 PID(CLAUDE_PID, 없으면 $PPID)
    expect(s()).toContain('|| { rm -rf "$LOCK"; echo "FAIL LOCK_WRITE $LOCK"; exit 1; }') // owner·beat 쓰기 실패는 방금 만든 잠금을 지우고 실패
    expect(s()).toContain('"$LOCK/beat"')
    expect(s()).toContain('stale "$LOCK" ||') // beat 없는 잠금은 10분 안에는 막 생긴 것으로 본다
    expect(s()).toContain('mv "$LOCK" "$T" 2>/dev/null') // 탈취는 옮긴 뒤 같은 기준으로 다시 확인한다
    expect(s()).toContain('stale "$T" ||')
    // 팀장 잠금의 생존은 PID 가 아니라 beat(없으면 잠금 디렉터리 수정 시각)로 본다
    const lockBlock = s().slice(s().indexOf('stale() {'), s().indexOf('PRECHECK_OK'))
    expect(lockBlock).not.toContain('kill -0')
    expect(s()).toContain('bad NO_CLAUDE_CLI') // tmux 팀원은 .dflow-run 의 exec claude 로 뜬다
    // Windows 에서 CLAUDE_PID 가 비어 있으면 fail-closed: $PPID=1 폴백은 모든 팀장을 같은 프로세스로 본다
    expect(s()).toContain('case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) [ -n "${CLAUDE_PID:-}" ] || bad "NO_CLAUDE_PID Windows 의 \\$PPID 는 1 이라 팀장 세션을 가려내지 못한다" ;; esac')
    // LEAD_SKIP_PERMISSIONS 감지(ps -o command=·PRECHECK_OK 의 그 칸)는 스펙 2026-09-16 §9 로 없어졌다
    expect(s()).toContain('NOT_DEFAULT_BRANCH')
    expect(s()).toContain('git ls-remote --symref origin HEAD')
    expect(s()).toContain("hostname | cut -d. -f1 | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9-]/-/g'")
    expect(s()).toContain('mkdir -p ~/.dflow')
  })

  it('전제 검사: 인증은 me 로, api_base 없는 reported 는 거부, 부산물 exclude, 추적 안 된 리포에서만 스킬 패턴, state.json 안내, 수정된 스킬 grep', () => {
    expect(s()).toContain('bad AUTH')
    expect(s()).toContain('종료 코드로 판정하지 않는다')
    expect(s()).toContain('LEGACY_REPORTED')
    expect(s()).toContain('수동 `/dflow-merge` 로 먼저 정리하라')
    // .dflow-pid·.dflow-worker.log 는 .dflow-pane·.dflow-run 으로 바뀌었다(스펙 2026-09-16 §9)
    for (const p of ["'**/.claude/worktrees/'", "'/.dflow-agent'", "'/.dflow-pane'", "'/.dflow-prompt'", "'/.dflow-run'", "'**/tasks/*/.result'", "'/.claude/skills'"]) {
      expect(s(), p).toContain(p)
    }
    // 결정 목록 전송 파일(과제 C) — 커밋하지 않는 워커 부산물이라 .result 와 같은 자리에서 뺀다.
    expect(s()).toMatch(/'[^']*tasks\/\*\/decisions\.json'/)
    expect(s()).toContain('git rev-parse --git-path info/exclude')
    expect(s()).toContain('git ls-files .claude/skills')
    // 킷 복사형 판정은 dflow-dev 로 좁힌다 — 일반 스킬만 추적하는 리포의 KIT_NOT_PUSHED 오탐(2026-09-23)
    expect(s()).toContain('tracked=$(git ls-files .claude/skills/dflow-dev | head -n 1)')
    expect(s()).toContain("sp='/.claude/skills/dflow-*'")
    expect(s()).toContain('파일명을 명시해 먼저 커밋하라')
    // 기능 판정은 본문 문구가 아니라 표식 줄로 한다 — 문서를 압축·개정하다 문구가 빠져도 운영 워커가 멈추지 않게
    expect(s()).toContain("grep -q '^<!-- dflow-caps: worker ' .claude/skills/dflow-dev/SKILL.md || bad OLD_DFLOW_DEV")
    expect(s()).toContain("grep -q '^<!-- dflow-caps: remote-candidates ' .claude/skills/dflow-merge/SKILL.md || bad OLD_DFLOW_MERGE")
    // 킷 복사형은 팀원이 쓰는 origin/<기본브랜치> 의 스킬도 본다. 표식 이전 킷(옛 문구)도 인정한다
    expect(s()).toContain('git show "origin/$base:.claude/skills/dflow-dev/SKILL.md" 2>/dev/null | grep -qE \'^<!-- dflow-caps: worker |--worker\'')
    expect(s()).toContain('git show "origin/$base:.claude/skills/dflow-merge/SKILL.md" 2>/dev/null | grep -qE \'^<!-- dflow-caps: remote-candidates |origin/agent/\\*\'')
    expect(s()).toContain('KIT_NOT_PUSHED')
  })

  it('매 기상 재구성: 정본은 <신원>/<host>/ 워크트리·.result, 보조는 마지막 team.start 이후 lead 이벤트', () => {
    expect(s()).toContain('git worktree list --porcelain')
    expect(s()).toContain('**깨어날 때마다**')
    // 매 기상: 소유(신원 + 세션 PID)를 확인한 뒤에만 beat 를 쓰고, 아니면 잠금 상실
    expect(s()).toContain('{ read -r o_who o_ts o_pid < "$LOCK/owner"; } 2>/dev/null || true')
    expect(wake()).toContain('{ read -r o_who o_ts o_pid < "$LOCK/owner"; } 2>/dev/null || true')
    expect(wake()).toContain('if [ "$o_who" = "$OWNER" ] && [ -n "$LEAD_PID" ] && [ "$o_pid" = "$LEAD_PID" ]; then\n  date +%s > "$LOCK/beat"')
    expect(s()).toContain(".claude/skills/dflow-team/scripts/wake.sh --owner '<신원>/<host>/lead'")
    expect(s()).toContain('LOCK_LOST')
    expect(wake()).toContain('LOCK_LOST')
    expect(s()).not.toContain('date +%s > "$(git rev-parse --git-path dflow-team.lock)/beat"')
    expect(s()).toContain('case "$a" in "<신원>/<host>/"*) ;; *) continue ;; esac')
    expect(s()).toContain('`<신원>/<host>/parked`')
    expect(s()).toContain('마지막 `team.start` 이후')
    expect(s()).toContain("--arg a '<신원>/<host>/lead'")
  })

  // 생존은 .dflow-pid·pstart 대신 .dflow-pane 의 pane_dead 로 본다(146ea66d). blocked 는 재spawn 하지 않아
  // 대기 큐에 넣지 않는다(스펙 2026-09-16 §9).
  it('재구성 규칙: 슬롯 번호 발급, 살아 있는 팀원 정의(tmux 는 pane_dead 생존), 고아 스캔', () => {
    expect(s()).toContain('흡수한 번호를 뺀 1..N 중 가장 작은 것')
    expect(s()).toContain('"살아 있는 팀원" 은 spawn 했고 아직 최종 판정')
    expect(s()).toContain('화면이 떠 있는지로 판단하지 않는다')
    expect(s()).toContain('p=$(head -n 1 "$w/.dflow-pane" 2>/dev/null); alive=-')
    expect(s()).toContain(`d=$("$TM" -L dflow list-panes -t "$p" -F '#{pane_dead}' 2>/dev/null | head -n 1)`)
    expect(s()).toContain('팀장 세션이 새로 떠도 살아 있는 tmux 팀원은 원래 슬롯\n  번호로 흡수한다')
    expect(s()).toContain('**고아 스캔**')
  })

  it('결과 중복 방지: 결과 줄 해시를 경로별 마지막 처리 해시와 비교한다', () => {
    expect(s()).toContain("printf '%s\\n' \"$l\" | cksum | cut -d' ' -f1")
    expect(s()).toContain('경로별 마지막 처리 해시')
    expect(s()).toContain('해시가 다를 때만 처리한다')
  })

  it('재기동 때 이어받은 것(답 대기 blocked 포함)을 team.start 바로 뒤에 다시 기록하고 그 id8 은 재개 필요로 보지 않는다', () => {
    expect(s()).toContain('`team.start` 바로 뒤에')
    expect(s()).toContain('이어받은 팀원이 살아 있지 않은 것으로 보이고 같은 결과가 다시 처리된다')
    expect(s()).toContain('답을 기다리는 `blocked` 마다')
    // 이어받은 슬롯의 재기록은 재개 재시도로 세지 않는다 — spawn_kind 로 가른다.
    expect(s()).toContain('`team.spawn`(`spawn_kind` 는 `readopt`)')
    expect(s()).toContain('답을 기다리는 `blocked`·대기 중인 답 어디에도 없는 id8')
    // 워크트리가 없는 갈래만 자동 재착수에서 뺀다. 남아 있는 갈래는 고아 스캔이 이어받는다.
    expect(s()).toContain('**"멈춤" 표(사유 `워크트리 없음`)**')
  })

  // 백엔드별·LEAD_SKIP_PERMISSIONS 별 두 갈래 안내는 스펙 2026-09-16 §9 로 없어졌다. 팀원은 언제나 생략 모드다.
  it('권한 모드 안내 한 줄을 출력한다(백엔드와 무관하게 생략 모드)', () => {
    expect(s()).toContain('팀원은 **권한 확인 생략 모드로** 돕니다')
    expect(s()).not.toContain('권한 확인이 뜨면 알림 없이 멈춘다')
  })

  it('감시 루프: 세대 파일로 교체하고 줄 전체(해시)를 비교하며 TICK 은 예정 시각으로 낸다', () => {
    expect(s()).toContain('$(git rev-parse --git-path dflow-team.gen)')
    expect(tick()).toContain('git rev-parse --path-format=absolute --git-path dflow-team.gen')
    expect(tick()).toContain('echo STALE')
    expect(tick()).toContain('RESULT_READY')
    expect(tick()).toContain('echo TICK')
    expect(tick()).toContain('[ "$(date +%s)" -ge "$TICK_AT" ]')
    expect(tick()).toContain("sum=$(printf '%s\\n' \"$cur\" | cksum | cut -d' ' -f1)")
    expect(s()).toContain('**줄 전체를 비교한다.**')
    expect(s()).toContain('run_in_background')
    // tmux 팀원은 pane_dead 로 죽음을 감지한다(146ea66d, 종전 PID). 결과 줄이 새로 있으면 RESULT_READY 가 먼저다
    expect(tick()).toContain('[ "$d" = 0 ] || dead="$dead $f"')
    expect(tick()).toContain('[ -n "$hit" ] && { echo "RESULT_READY$hit"; exit 0; }\n  [ -n "$dead" ] && { echo "PANE_DEAD$dead"; exit 0; }')
    // 항목 형식(경로|해시|pane)은 그대로다. 팀장은 스크립트를 한 줄로 부른다
    expect(s()).toContain("-- '<워크트리1>/<TASKS>/<TSK1>/.result|<해시1>|<pane1>' '<워크트리2>/<TASKS>/<TSK2>/.result|-|-'")
    expect(s()).toContain('.claude/skills/dflow-team/scripts/tick.sh [--new-tick] [--may-skip]')
  })

  // DFLOW_ENV_FILE=<MAIN>/.env 는 .dflow 전환(cdccee70)으로 DFLOW_CONFIG_DIR=<MAIN> 이, --interval 300 은 ab8ee46b 로 180 이 됐다.
  it('poll 은 docs/tasks 가 없는 빈 디렉터리를 cwd 로, DFLOW_CONFIG_DIR 로 <MAIN> 설정을 지정해 띄운다(스펙 §4-5 명령)', () => {
    expect(s()).toContain('mkdir -p "$(git rev-parse --git-path dflow-team-poll)"')
    expect(s()).toContain('POLL_DIR=$(cd "$(git rev-parse --git-path dflow-team-poll)" && pwd)')
    expect(s()).toContain('( cd "$POLL_DIR" && DFLOW_CONFIG_DIR="<MAIN>" DFLOW_WATCH=0 \\')
    expect(s()).toContain('"<MAIN>/.claude/skills/dflow-poll/scripts/poll.sh" --require-tag agent --until \'<UNTIL>\' --interval 180 --recheck-cycles 10 \\')
    expect(s()).toContain('--wait-cycles 40 [--wp <WP-02,dict/WP-03>] [--exclude <id8,id8>] [--exclude-temp <id8,id8>] [--exclude-wait <id8,id8>] )')
  })

  it('poll 재기동 조건과 제외 목록: 영구 ∪ 슬롯 id8, 빈 목록은 플래그 생략, 대기 큐 제외 금지, exit 9·10 분기 없음', () => {
    expect(s()).toContain('**재기동 조건**')
    expect(s()).toContain('**영구 제외 ∪ 현재 슬롯의 id8**')
    expect(s()).toContain('**목록이 비면 그 플래그 자체를 생략한다.**')
    expect(s()).toContain('대기 큐는 `--exclude` 에 넣지 않는다')
    expect(s()).not.toMatch(/^\| poll exit (9|10)/m)
  })

  it('SKILL.md 가 쓰는 team.* 이벤트는 events.md 에 전부 정의돼 있다', () => {
    const used = new Set(s().match(/(?<![\w-])team\.[a-z]+/g) ?? [])
    expect(used.size).toBeGreaterThanOrEqual(7)
    for (const ev of used) expect(read('references/events.md'), ev).toContain('`' + ev + '`')
  })

  it('SKILL.md 가 분기하는 poll exit code 는 poll.sh 머리말이 문서화한 것뿐이다', () => {
    const header = readFileSync(join(ROOT, '.claude/skills/dflow-poll/scripts/poll.sh'), 'utf8')
      .split('\n')
      .slice(0, 12)
      .join(' ')
    const documented = new Set(header.match(/\b\d{1,2}\b/g) ?? [])
    const used = [...s().matchAll(/poll exit (\d{1,2})/g)].map((m) => m[1])
    expect(used.length).toBeGreaterThan(0)
    for (const c of used) expect(documented.has(c), `exit ${c}`).toBe(true)
  })

  it('poll exit 0: 영구 제외·슬롯 표와만 다시 대조하고(일시 제외는 보지 않는다) show 는 jq 로 .order.item 경로의 필요한 필드만 뽑는다', () => {
    expect(s()).toContain('영구 제외 목록과 슬롯 표에만 한 번 더 대조해 걸리는 것을 버린다')
    expect(s()).toContain('일시 제외는 대조하지 않는다')
    expect(s()).toContain('id8 마다 마지막 `team.spawn`·`team.blocked`·`team.result` 로 정한다')
    expect(s()).toContain('.order.item.external_ref')
    expect(s()).toContain('.order.item.spec')
    expect(s()).not.toMatch(/`\.item\.(spec|external_ref)`/)
  })

  // PROC_DEAD·.dflow-worker.log 폴백·kill <PID> 는 tmux 전환으로 PANE_DEAD·죽은 pane 화면 폴백·kill-pane 이 됐다(146ea66d).
  it('결과 처리: 경로 매칭, PANE_DEAD 는 .result → 죽은 pane 화면 폴백 → 즉시 failed no-result, kill-pane 회수, 차단기, rate-limit·deps·permission, 즉시 정리', () => {
    expect(s()).toContain('슬롯은 경로(그 슬롯의\n  워크트리)로 찾는다')
    expect(s()).toContain('`PANE_DEAD <경로>`(tmux)')
    expect(s()).toContain('backends.md 「결과 줄과 죽은 pane 폴백」 대로 `capture-pane -p -J -S -`')
    expect(s()).toContain('**곧바로** `failed no-result` 로 판정한다')
    expect(s()).not.toContain('suspect')
    expect(s()).not.toContain('TaskStop(w<slot>-<id8>)')
    expect(s()).toContain('pane 을 `kill-pane -t <pane>` 으로 거두고')
    expect(s()).toContain('그 id8 을 먼저 진행 중 영구 제외에서 빼고')
    expect(s()).toContain('연속 2건')
    expect(s()).toContain('| `failed rate-limit` |')
    expect(s()).toContain('| `failed deps` |')
    expect(s()).toContain('| `failed permission <명령>` |')
    expect(s()).toContain('| `failed no-result`(pane 이 죽었는데 결과 줄 없음) |')
    expect(s()).toContain('그 자리에서 정리한다')
  })

  it('생존 증거는 브랜치 tip·서버 progress·미커밋 목록이고 화면은 쓰지 않는다', () => {
    expect(s()).toContain('**화면은 생존 증거로 쓰지 않는다.**')
    expect(s()).toContain('git -C <워크트리> log -1 --format=%ct')
    expect(s()).not.toMatch(/terminal read[^\n]*\| cksum/)
  })

  it('무응답은 보고만 하고 슬롯을 유지하며, 자동 정리는 두 TICK 연속일 때만 하고 두 백엔드가 같다', () => {
    expect(s()).toContain('"무응답" 으로 보고만 하고 슬롯을 유지한다')
    expect(s()).toContain('**두 TICK 연속으로** 생존 증거가 없을 때만')
    // 2026-09-24부터 Orca 도 orca terminal close 로 팀원을 실제로 멈춘다(예전에는 워크트리 삭제뿐이었다)
    expect(s()).toContain('Orca 는 `orca terminal close\n  --terminal <handle> --tab --json` 으로 팀원을 멈추고 슬롯을 해제하며')
  })

  // 프로세스 팀원의 회수·parked·ANSWER 재spawn 은 스펙 2026-09-16 §9(e9da5a11)로 없어졌다.
  it('blocked: 팀원이 슬롯을 계속 잡고 PushNotification 으로 알린다', () => {
    expect(s()).toContain('**그 슬롯은 blocked 팀원이 계속 잡으며 다른 작업에 재배정하지 않는다.**')
    expect(s()).toContain('PushNotification')
  })

  // 답은 send-keys 로 그 pane 에 넣으므로 대기 큐로 돌리지 않는다(e9da5a11).
  it('답 매칭: <id8> <답>, 여럿인데 id8 이 없을 때만 되묻고, parked 면 사람 확인', () => {
    expect(s()).toContain('`<id8> <답>`')
    expect(s()).toContain('어느 작업의 답인지 되묻는다')
    expect(s()).toContain('"사람 확인 필요"')
  })

  it('승인 스윕: 인자 없는 /dflow-merge, 반려는 수동 대상, 충돌·경합·훅 거부는 되돌림 뒤 보고', () => {
    expect(s()).toContain('`/dflow-merge` 를 **인자 없이** 실행한다')
    expect(s()).toContain('`api_base` 가 없는 로컬 후보는 전제 검사가 시작 전에 막는다')
    expect(s()).toContain('수동 `/dflow-dev <id8>` 대상')
    expect(s()).toContain('`git reset --keep`')
    expect(s()).toContain('"push 실패(경합)"')
    expect(s()).toContain('"push 실패(훅)"')
    expect(s()).toContain('"머지 실패(충돌)"')
    expect(s()).toContain('"사람이 머지해야 함"')
  })

  // 포인터의 BACKEND 는 언제나 pane(e9da5a11)이고 DEV_BRANCH 가 붙었다(cdccee70). nohup claude -p 와 pid 핸들은
  // 스펙 2026-09-16 §9 로 없어지고 tmux:<pane_id> 핸들이 됐다.
  it('spawn: 포인터 한 줄, 중복 확인, tmux 는 git worktree add --detach, team.spawn 필드(tmux 핸들), 기점 명시, path 선택자', () => {
    expect(s()).toContain(
      '<MAIN_CHECKOUT>/.claude/skills/dflow-team/references/worker-prompt.md 를 읽고 그 규칙대로 실행하라. TSK=<TSK> ID8=<id8> AGENT_ID=<신원>/<host>/w<slot> MAIN_CHECKOUT=<팀장 체크아웃 절대경로> BACKEND=pane MODEL=<opus|sonnet|default> DEV_BRANCH=<개발브랜치>',
    )
    expect(s()).toContain('그 id8 이 재구성한 슬롯 표에 있으면 띄우지 않는다')
    expect(s()).toContain('`git worktree add --detach <MAIN>/.claude/worktrees/dflow-<id8> origin/<기본브랜치>`')
    expect(s()).not.toContain('isolation: "worktree"` 는 **필수**')
    expect(s()).toContain('`team.spawn` 에 `slot`·`tsk`·`order`·`id8`·`worktree`·`handle`')
    expect(s()).toContain('`tmux:<pane_id>`')
    // 2026-09-24부터 Orca 도 같은 준비 블록(chmod +x 줄까지)을 쓴 뒤 orca terminal create 로 잇는다
    expect(s()).toContain('orca terminal create --worktree "path:$WT"')
    expect(s()).toContain('--command ./.dflow-run --json')
    expect(s()).toContain('`--worktree "path:$WT"` 선택자를 쓴다')
  })

  it('마감: 대기 상한 TICK 두 번, 마지막 스윕, 살아 있는 팀원 워크트리 보존, agent 브랜치 남김, team.stop, 소유 판정으로 잠금 해제, 잠금 상실 마감', () => {
    expect(s()).toContain('`TICK` 두 번까지만')
    expect(s()).toContain('마지막 승인 스윕')
    expect(s()).toContain('**살아 있는 팀원의 워크트리는 조건과 무관하게 지우지 않는다.**')
    expect(s()).toContain('**agent 브랜치는 남긴다.**')
    expect(s()).toContain('`team.stop`')
    expect(s()).toContain(
      '[ "$o_pid" = "$LEAD_PID" ]; then\n     .claude/skills/dflow-work/scripts/dflow.sh lease release || { rm -f "$(git rev-parse --git-path dflow-team.lease)" "$(git rev-parse --git-path dflow-team.lease).beat"; echo "LEASE_RELEASE_FAILED 3분 뒤 스스로 풀린다"; }\n     rm -f "$(git rev-parse --git-path dflow-team.stop)"',
    )
    expect(s()).not.toContain('fromdateiso8601') // events.jsonl 의 team.start 는 새 팀장의 것일 수 있다
    expect(s()).not.toContain('rm -f "$(git rev-parse --git-path dflow-team.lock)"')
    expect(s()).toContain('**잠금 상실 마감**')
  })

  it('마감의 남은 에이전트 확인: 팀원·손자는 별도 프로세스라 세션 목록에 없고, 잠금 상실 마감은 팀원 pane 을 건드리지 않는다', () => {
    expect(s()).toContain('**남은 에이전트 확인**')
    expect(s()).toContain('ListAgents 를 다시 불러')
    expect(s()).toContain('팀원 pane 은 건드리지 않고') // 146ea66d 계열 tmux 전환: 종전 '팀원 프로세스'
    expect(s()).not.toContain('**손자 정리**')
    expect(s()).not.toContain('is not running (status: completed)')
  })

  // 팀원 프로세스 spawn 의 nohup … & 예외는 스펙 2026-09-16 §9 로 없어졌다(이제 팀원 spawn 에도 & 를 쓰지 않는다).
  it('금지: 팀원을 Agent 도구 서브에이전트로 띄우지 않는다', () => {
    expect(s()).toContain('- 팀원을 Agent 도구 서브에이전트로 띄우는 것')
    expect(s()).toContain('**제1 제약: 팀원을 서브에이전트로 띄우지 않는다.**')
  })

  it('좌석표 v1 계약: 팀장은 watch 를 시작·매 기상·마감에서 보내고 poll 은 DFLOW_WATCH=0 으로 watch 를 끈다', () => {
    const t = s()
    const watchCalls = t.match(/dflow\.sh watch --agent/g) ?? []
    expect(watchCalls.length).toBeGreaterThanOrEqual(3)
    const stopCalls = [...t.matchAll(/dflow\.sh watch --agent[\s\S]{0,200}?--stop\b/g)]
    expect(stopCalls.length).toBeGreaterThanOrEqual(1)
    const slotsCalls = [...t.matchAll(/dflow\.sh watch --agent[\s\S]{0,200}?--slots\b/g)]
    expect(slotsCalls.length).toBeGreaterThanOrEqual(2)
    // DFLOW_CONFIG_DIR 과 같은 줄에 DFLOW_WATCH=0 이 있다(.dflow 전환, 2026-09-23)
    expect(t).toMatch(/DFLOW_CONFIG_DIR="<MAIN>" DFLOW_WATCH=0 \\/)
  })

  it('「좌석표 연동」 절은 70분 STANDBY 계약을 확정하고 team.start 로 대신한다는 옛 문장이 없다', () => {
    const t = s()
    const start = t.indexOf('## 좌석표 연동')
    const end = t.indexOf('## 금지')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const section = t.slice(start, end)
    expect(section).toContain('70분')
    expect(section).not.toContain('그 전에는 `team.start`')
  })

  it('Orca 리허설 반영: 재개 필요 목록은 CL 행만 세고, 기상은 events.md 의 기록 명령을 다시 읽는다', () => {
    expect(s()).toContain(`awk -F'\\t' 'NF>=4 && $2=="CL" {print $4}'`)
    expect(s()).not.toContain(`awk -F'\\t' 'NF>=4 {print $4}'`)
    const start = s().indexOf('### 2-3. 기상마다 하는 일')
    expect(start).toBeGreaterThan(-1)
    expect(s().slice(start, start + 1500)).toContain('기억으로 재구성한 명령은 쓰지 않는다')
    expect(s().slice(start, start + 1500)).toContain('EVENT_ARGS_MISSING')
    // 기상 블록(wake.sh)의 마지막 명령이 events.md 의 기록 명령을 화면에 띄운다(압축 뒤 기억으로 쓰지 않게)
    expect(s().slice(start, start + 2500)).toContain('.claude/skills/dflow-team/scripts/wake.sh')
    expect(wake()).toContain('EVENTS_MD="$HERE/../references/events.md"')
    expect(wake()).toContain("sed -n '/^## 기록 명령/,$p' \"$EVENTS_MD\"")
  })

  it('프로세스 리허설 반영: 압축 뒤 첫 기상은 절차 정본을 다시 읽고, 고아 스캔이 남긴 워크트리는 parked 로 표시한다', () => {
    expect(s()).toContain('**압축 뒤 첫 기상**')
    // 2026-09-25: 재독 세트를 「팀장 상태」「2」「3」 으로 줄이고(그 밖은 그 절차를 처음 탈 때 그 절만 읽는다), 압축 신호를 적었다
    expect(s()).toContain('이 파일의 「팀장 상태」「2. 기상과 감시」「3. 결과 처리」')
    expect(s()).toContain('**압축 신호**')
    expect(s()).toContain('폴링만 이어 가지 않는다')
    expect(s()).toContain('압축 뒤 그 절차를 처음 탈 때 그 절만 `sed`·`cat` 으로\n  읽는다')
    const i = s().indexOf('- **고아 스캔**')
    expect(i).toBeGreaterThan(-1)
    const scan = s().slice(i, i + 3000)
    // 정리 가능·재개 가능·멈춤 셋으로 가른다. parked 는 재개 대상이 아닌 것에만 찍는다.
    expect(scan).toContain('**정리 가능·재개 가능·멈춤** 셋으로 가른다')
    expect(scan).toContain('`.dflow-agent` 를 `parked` 로 바꾸지\n     **않는다**')
    expect(scan).toContain('`<신원>/<host>/parked` 로 바꾼 뒤(「고아 정리\n     규칙」 3번)')
  })

  it('Windows(Git Bash) 이식성: hostname -s·ps -o 직접 호출·pwd -P 비교·$PPID 단독 소유 판정이 없고, uname 분기와 CLAUDE_PID 를 쓴다', () => {
    const sk = s()
    expect(sk).toContain('LEAD_PID=${CLAUDE_PID:-$PPID}')
    expect(sk).not.toContain('"$o_pid" = "$PPID"')
    expect(sk).not.toContain('$(pwd -P)')
    expect(sk).toContain('[ -z "$(git rev-parse --show-prefix)" ] || bad NOT_REPO_ROOT')
    expect(sk).toContain("host=$(hostname | cut -d. -f1 | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9-]/-/g')")
    expect(sk).not.toContain('$(hostname -s')
    expect(sk).not.toContain('"$(ps -o lstart= -p')
    expect(sk).not.toContain('ps -o command= -p "$PPID"')
    expect(sk).toContain('case "$(uname -s)" in')
    expect(sk).toContain('**플랫폼**')
    // pstart·Get-CimInstance(LEAD_SKIP_PERMISSIONS 감지)는 스펙 2026-09-16 §9·§10 으로 없어졌다
    expect(read('references/events.md')).not.toContain('$(hostname -s)')
    expect(read('references/events.md')).toContain('--arg host "$(hostname | cut -d. -f1)"')
  })
})

describe('dflow-team 압축 뒤 복구(2026-09-25)', () => {
  // dmes-standard 실측: 3차 압축 뒤 Skill 도구 재호출로 약 206K자가 통째로 다시 들어왔고, 4차 뒤에는 69턴 동안 재독 없이 폴링만 했다.
  const s = () => read('SKILL.md')
  const rereadCmd = () => {
    const m = s().match(/^ {2}(sed -n '\/\^## 팀장 상태\/[^\n]*SKILL\.md)$/m)
    expect(m, '「팀장 상태」 의 재독 명령 블록').toBeTruthy()
    return m![1]
  }

  it('SKILL.md 머리에서 Skill 도구 재호출을 금지하고 재독 세트로 보낸다', () => {
    const head = s().slice(0, 1500)
    expect(head).toContain('**컨텍스트 압축 뒤에는 Skill 도구로 `/dflow-team` 을 다시 부르지 않는다**')
    expect(head).toContain('`COMPACT_REREAD`')
  })

  it('wake.sh 가 매 기상 같은 재독 명령을 COMPACT_REREAD 줄로 띄운다', () => {
    const w = read('scripts/wake.sh')
    const line = w.split('\n').find((l) => l.includes('echo "COMPACT_REREAD'))
    expect(line).toBeTruthy()
    // echo "…" 안의 \\. 은 셸이 \. 로 푼다
    const printed = spawnSync('bash', ['-c', line!.trim()], { encoding: 'utf8' }).stdout.trim()
    expect(printed.startsWith('COMPACT_REREAD ')).toBe(true)
    expect(printed.endsWith(rereadCmd())).toBe(true)
    expect(printed).toContain('Skill 도구 재호출 금지')
  })

  it('재독 세트는 「팀장 상태」「2」「3」 뿐이고 크기에 상한이 있다(종전 규정 약 89K자)', () => {
    const r = spawnSync('bash', ['-c', rereadCmd()], { cwd: ROOT, encoding: 'utf8' })
    expect(r.status).toBe(0)
    const out = r.stdout
    for (const h of ['## 팀장 상태', '### 2-2. 감시 루프', '### 2-3. 기상마다 하는 일', '## 3. 결과 처리']) expect(out, h).toContain(h)
    for (const h of ['## 1. 시작', '## 5. 팀원 spawn', '## 7. 마감']) expect(out, h).not.toContain('\n' + h + '\n')
    expect(out.length).toBeLessThan(46000)
  })
})
