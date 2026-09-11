// tests/skills/dflow-team.test.ts
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd() // vitest 는 리포 루트에서 돈다(기존 tests/ 관례)
const SKILL_DIR = join(ROOT, '.claude', 'skills', 'dflow-team')
const read = (rel: string) => readFileSync(join(SKILL_DIR, rel), 'utf8')

const PLACEHOLDERS = ['{TSK}', '{ID8}', '{AGENT_ID}', '{MAIN_CHECKOUT}', '{BACKEND}', '{MODEL_FLAG}', '{ANSWER}']

describe('dflow-team worker-prompt.md 계약(스펙 §5)', () => {
  const p = () => read('references/worker-prompt.md')

  it('치환 변수 일곱 개와 포인터 키를 표로 설명하고 AGENT_ID 는 신원/host/slot 이다', () => {
    expect(existsSync(join(SKILL_DIR, 'references/worker-prompt.md'))).toBe(true)
    for (const v of PLACEHOLDERS) expect(p(), v).toContain('`' + v + '`')
    for (const k of ['TSK', 'ID8', 'AGENT_ID', 'MAIN_CHECKOUT', 'BACKEND', 'MODEL', 'ANSWER']) {
      expect(p(), k).toContain('| `' + k + '` |')
    }
    expect(p()).toContain('`<신원>/<host>/w<slot>`')
  })

  it('git 은 절대경로로 부르고, 격리는 git-dir 과 git-common-dir 의 물리 경로로 확인한다', () => {
    expect(p()).toContain('command -v git')
    expect(p()).toContain('bare `git` 금지')
    expect(p()).toContain('_gd=$(cd "$(git rev-parse --git-dir)" && pwd -P)')
    expect(p()).toContain('_cd=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)')
    expect(p()).toContain('[ "$_gd" != "$_cd" ] || { echo "NOT_ISOLATED"; exit 1; }')
    expect(p()).toContain('{TSK} {ID8} - - - failed not-isolated')
    expect(p()).toContain('**아무 파일도 쓰지 않고**')
    expect(p()).not.toContain('show-toplevel')
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
    expect(p()).toContain('set -a; . ./.env; set +a; .claude/skills/dflow-work/scripts/dflow.sh doctor; echo "doctor=$?"')
    expect(p()).toContain('git fetch origin && git switch --detach origin/<기본브랜치>')
    expect(p()).toContain('symbolic-ref --short refs/remotes/origin/HEAD')
    expect(p()).toContain('git ls-remote --symref origin HEAD')
    expect(p()).toContain("grep -q -- '--worker' .claude/skills/dflow-dev/SKILL.md || echo NO_WORKER_FLAG")
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

  it('ANSWER 재spawn 은 fetch 뒤 기존 agent 브랜치로 옮기고 결정을 design.md 에 남기며, 의존성은 재개 직후 행 H 가 깐다', () => {
    expect(p()).toContain('git fetch origin\n  git branch -r --list \'origin/agent/{ID8}-*\'')
    expect(p()).toContain('- 담당자 결정(blocked 응답): {ANSWER}')
    expect(p()).toContain('재개로 agent 브랜치에 들어온 직후 설치한다(「--worker」 H)')
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
    expect(p()).toContain('docs/tasks/{TSK}/.result')
  })

  it('blocked 는 커밋·push 뒤 쓰고 이후 동작을 BACKEND 두 값으로 가른다', () => {
    expect(p()).toContain('AskUserQuestion 을 쓰지 않는다')
    expect(p()).toContain('현재 산출물을 커밋·push 한 뒤')
    expect(p()).toMatch(/^\| `pane` \|/m)
    expect(p()).toMatch(/^\| `agent-team` \|/m)
  })

  it('기본 브랜치로 switch 하지 않는다(detach 만 한다)', () => {
    expect(p()).not.toMatch(/switch (main|<기본브랜치>|origin\/main)(\s|$)/m)
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
    expect(fm).toContain('사용법 - /dflow-team [인원] <종료시각> [모델]')
    expect(fm).not.toContain('--worker')
    for (const old of ['--team-size', '--interval SEC', '--exclude id8', '--until HH:MM']) expect(s(), old).not.toContain(old)
  })

  it('인자: 기본 3·상한 4, 종료 시각이 유일한 필수, 300초 고정, 작업 빼기는 agent 태그', () => {
    expect(s()).toContain('**기본 3, 하드 상한 4.**')
    expect(s()).toContain('**종료 시각은 유일한 필수 인자다.** 없으면 아래 사용법을 출력하고 종료한다.')
    expect(s()).toContain('종료시각은 당일 시각만(자정 넘김 불가)')
    expect(s()).toContain('bad "UNTIL_PAST 종료 시각은 당일 시각만(자정 넘김 불가)"')
    expect(s()).toContain('감시 주기는 300초로 고정한다')
    expect(s()).toContain('`agent` 태그를 끈다')
  })

  it('환경 감지는 Orca 면 pane, 그 밖은 에이전트 팀이며 병렬 포기 분기가 없다', () => {
    expect(s()).toContain('ORCA_WORKTREE_ID')
    expect(s()).toContain('v1 은 tmux pane 을 지원하지 않아 에이전트 팀으로 돈다')
    expect(s()).toContain('어느 갈래에서도 병렬 불가로 종료하지 않는다')
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
    expect(s()).toContain(`printf '%s %s %s\\n' "$who/$host/lead" "$(date +%s)" "$PPID" > "$LOCK/owner"`) // 소유는 신원 + 팀장 세션 PID
    expect(s()).toContain('|| { rm -rf "$LOCK"; echo "FAIL LOCK_WRITE $LOCK"; exit 1; }') // owner·beat 쓰기 실패는 방금 만든 잠금을 지우고 실패
    expect(s()).toContain('"$LOCK/beat"')
    expect(s()).toContain('stale "$LOCK" ||') // beat 없는 잠금은 10분 안에는 막 생긴 것으로 본다
    expect(s()).toContain('mv "$LOCK" "$T" 2>/dev/null') // 탈취는 옮긴 뒤 같은 기준으로 다시 확인한다
    expect(s()).toContain('stale "$T" ||')
    expect(s()).not.toContain('kill -0') // 생존은 PID 가 아니라 beat(없으면 잠금 디렉터리 수정 시각)로 본다
    expect(s()).toContain('NOT_DEFAULT_BRANCH')
    expect(s()).toContain('git ls-remote --symref origin HEAD')
    expect(s()).toContain("hostname -s | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9-]/-/g'")
    expect(s()).toContain('mkdir -p ~/.dflow')
  })

  it('전제 검사: 인증은 me 로, api_base 없는 reported 는 거부, 부산물 exclude, 추적 안 된 리포에서만 스킬 패턴, state.json 안내, 수정된 스킬 grep', () => {
    expect(s()).toContain('bad AUTH')
    expect(s()).toContain('종료 코드로 판정하지 않는다')
    expect(s()).toContain('LEGACY_REPORTED')
    expect(s()).toContain('수동 `/dflow-merge` 로 먼저 정리하라')
    for (const p of ["'**/.claude/worktrees/'", "'/.dflow-agent'", "'docs/tasks/*/.result'", "'/.claude/skills'"]) {
      expect(s(), p).toContain(p)
    }
    expect(s()).toContain('git rev-parse --git-path info/exclude')
    expect(s()).toContain('git ls-files .claude/skills')
    expect(s()).toContain('파일명을 명시해 먼저 커밋하라')
    expect(s()).toContain("grep -q -- '--worker' .claude/skills/dflow-dev/SKILL.md")
    expect(s()).toContain("grep -q 'origin/agent/\\*' .claude/skills/dflow-merge/SKILL.md")
    // 킷 복사형은 팀원이 쓰는 origin/<기본브랜치> 의 스킬도 본다
    expect(s()).toContain('git show "origin/$base:.claude/skills/dflow-dev/SKILL.md" 2>/dev/null | grep -q -- \'--worker\'')
    expect(s()).toContain('git show "origin/$base:.claude/skills/dflow-merge/SKILL.md" 2>/dev/null | grep -q \'origin/agent/\\*\'')
    expect(s()).toContain('KIT_NOT_PUSHED')
  })

  it('매 기상 재구성: 정본은 <신원>/<host>/ 워크트리·.result, 보조는 마지막 team.start 이후 lead 이벤트', () => {
    expect(s()).toContain('git worktree list --porcelain')
    expect(s()).toContain('**깨어날 때마다**')
    // 매 기상: 소유(신원 + 세션 PID)를 확인한 뒤에만 beat 를 쓰고, 아니면 잠금 상실
    expect(s()).toContain('{ read -r o_who o_ts o_pid < "$LOCK/owner"; } 2>/dev/null || true')
    expect(s()).toContain('if [ "$o_who" = \'<신원>/<host>/lead\' ] && [ "$o_pid" = "$PPID" ]; then\n  date +%s > "$LOCK/beat"')
    expect(s()).toContain('LOCK_LOST')
    expect(s()).not.toContain('date +%s > "$(git rev-parse --git-path dflow-team.lock)/beat"')
    expect(s()).toContain('case "$a" in "<신원>/<host>/"*) ;; *) continue ;; esac')
    expect(s()).toContain('`<신원>/<host>/parked`')
    expect(s()).toContain('마지막 `team.start` 이후')
    expect(s()).toContain("--arg a '<신원>/<host>/lead'")
  })

  it('재구성 규칙: 슬롯 번호 발급, 살아 있는 팀원 정의, 답을 받은 blocked 는 대기 큐 맨 앞, 고아 스캔', () => {
    expect(s()).toContain('흡수한 번호를 뺀 1..N 중 가장 작은 것')
    expect(s()).toContain('"살아 있는 팀원" 은 spawn 했고 아직 최종 판정')
    expect(s()).toContain('터미널이 떠 있는지로 판단하지 않는다')
    expect(s()).toContain('`team.answer` 에서 복원해 대기 큐 맨 앞에 둔다')
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
    expect(s()).toContain('답을 기다리는 에이전트 팀 `blocked` 마다 `team.blocked`')
    expect(s()).toContain('답을 기다리는 `blocked`·대기 중인 답 어디에도 없는 id8')
  })

  it('권한 모드 안내 한 줄을 백엔드별로 출력한다', () => {
    expect(s()).toContain('팀원은 이 세션의 권한 모드를 물려받으며, 권한 확인이 뜨면 알림 없이 멈춘다')
    expect(s()).toContain('팀원은 권한 확인 생략 모드로 뜬다')
  })

  it('감시 루프: 세대 파일로 교체하고 줄 전체(해시)를 비교하며 TICK 은 예정 시각으로 낸다', () => {
    expect(s()).toContain('git rev-parse --git-path dflow-team.gen')
    expect(s()).toContain('echo STALE')
    expect(s()).toContain('RESULT_READY')
    expect(s()).toContain('echo TICK')
    expect(s()).toContain('[ "$(date +%s)" -ge "$TICK_AT" ]')
    expect(s()).toContain("sum=$(printf '%s\\n' \"$cur\" | cksum | cut -d' ' -f1)")
    expect(s()).toContain('**줄 전체를 비교한다.**')
    expect(s()).toContain('run_in_background')
  })

  it('poll 은 docs/tasks 가 없는 빈 디렉터리를 cwd 로, DFLOW_ENV_FILE 로 .env 를 지정해 띄운다(스펙 §4-5 명령)', () => {
    expect(s()).toContain('mkdir -p "$(git rev-parse --git-path dflow-team-poll)"')
    expect(s()).toContain('POLL_DIR=$(cd "$(git rev-parse --git-path dflow-team-poll)" && pwd)')
    expect(s()).toContain('( cd "$POLL_DIR" && DFLOW_ENV_FILE="<MAIN>/.env" \\')
    expect(s()).toContain('"<MAIN>/.claude/skills/dflow-poll/scripts/poll.sh" --require-tag agent --until <HH:MM> --interval 300 \\')
    expect(s()).toContain('[--exclude <id8,id8>] [--exclude-temp <id8,id8>] )')
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

  it('결과 처리: id8 매칭, suspect 와 두 TICK, TaskStop 회수, 차단기, rate-limit·deps, 즉시 정리', () => {
    expect(s()).toContain('**id8 로** 슬롯 표를 찾는다')
    expect(s()).toContain('**`suspect`**')
    expect(s()).toContain('**두 TICK 연속으로 변하지 않을 때만** `failed no-result`')
    expect(s()).toContain('판정할 때는 먼저 `TaskStop(w<slot>-<id8>)` 으로 팀원을 멈춘 뒤 슬롯을 해제한다')
    expect(s()).toContain('그 id8 을 먼저 진행 중 영구 제외에서 빼고')
    expect(s()).toContain('TaskStop(w<slot>-<id8>)')
    expect(s()).toContain('연속 2건')
    expect(s()).toContain('| `failed rate-limit` |')
    expect(s()).toContain('| `failed deps` |')
    expect(s()).toContain('그 자리에서 정리한다')
  })

  it('생존 증거는 브랜치 tip·서버 progress·미커밋 목록이고 화면은 쓰지 않는다', () => {
    expect(s()).toContain('**화면은 생존 증거로 쓰지 않는다.**')
    expect(s()).toContain('git -C <워크트리> log -1 --format=%ct')
    expect(s()).not.toMatch(/terminal read[^\n]*\| cksum/)
  })

  it('무응답은 보고만 하고 슬롯을 유지하며, 자동 정리는 두 TICK 연속일 때만 한다', () => {
    expect(s()).toContain('"무응답" 으로 보고만 하고 슬롯을 유지한다')
    expect(s()).toContain('**두 TICK 연속으로** 생존 증거가 없을 때만')
    expect(s()).toContain('orca worktree rm --worktree path:<경로>')
  })

  it('blocked: pane 은 슬롯 유지, 에이전트 팀은 회수 뒤 정리 또는 parked, 알림은 한 번', () => {
    expect(s()).toContain('**그 슬롯은 blocked 팀원이 계속 잡으며 다른 작업에 재배정하지 않는다.**')
    expect(s()).toContain('`.dflow-agent` 값을 `<신원>/<host>/parked` 로 바꿔')
    expect(s()).toContain('ANSWER=<담당자 답 한 줄>')
    expect(s()).toContain('`already checked out`')
    expect(s()).toContain('PushNotification')
  })

  it('답 매칭: <id8> <답>, 여럿인데 id8 이 없을 때만 되묻고, 대기 큐 맨 앞, parked 면 사람 확인', () => {
    expect(s()).toContain('`<id8> <답>`')
    expect(s()).toContain('어느 작업의 답인지 되묻는다')
    expect(s()).toContain('**대기 큐 맨 앞**')
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

  it('spawn: 포인터 한 줄, 중복 확인, isolation 필수, team.spawn 필드, 기점 명시, path 선택자', () => {
    expect(s()).toContain(
      '<MAIN_CHECKOUT>/.claude/skills/dflow-team/references/worker-prompt.md 를 읽고 그 규칙대로 실행하라. TSK=<TSK> ID8=<id8> AGENT_ID=<신원>/<host>/w<slot> MAIN_CHECKOUT=<팀장 체크아웃 절대경로> BACKEND=<pane|agent-team> MODEL=<opus|sonnet|default>',
    )
    expect(s()).toContain('그 id8 이 재구성한 슬롯 표에 있으면 띄우지 않는다')
    expect(s()).toContain('`isolation: "worktree"` 는 **필수**')
    expect(s()).toContain('`team.spawn` 에 `slot`·`tsk`·`order`·`id8`·`worktree`·`handle`')
    expect(s()).toContain('--base-branch origin/<기본브랜치> --prompt "<포인터 한 줄>" --json')
    expect(s()).toContain('`--worktree path:<result.worktree.path>`')
  })

  it('마감: 대기 상한 TICK 두 번, 마지막 스윕, 살아 있는 팀원 워크트리 보존, agent 브랜치 남김, team.stop, 소유 판정으로 잠금 해제, 잠금 상실 마감', () => {
    expect(s()).toContain('`TICK` 두 번까지만')
    expect(s()).toContain('마지막 승인 스윕')
    expect(s()).toContain('**살아 있는 팀원의 워크트리는 조건과 무관하게 지우지 않는다.**')
    expect(s()).toContain('**agent 브랜치는 남긴다.**')
    expect(s()).toContain('`team.stop`')
    expect(s()).toContain('[ "$o_pid" = "$PPID" ]; then rm -rf "$LOCK"')
    expect(s()).not.toContain('fromdateiso8601') // events.jsonl 의 team.start 는 새 팀장의 것일 수 있다
    expect(s()).not.toContain('rm -f "$(git rev-parse --git-path dflow-team.lock)"')
    expect(s()).toContain('**잠금 상실 마감**')
  })
})
