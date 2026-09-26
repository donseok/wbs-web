// tests/skills/dflow-dev-model-trial.test.ts
//
// 계약 테스트: 2026-09-26 dmes-standard 7건 분석(advisor 82회·회당 약 2분·가중 +14%)에서 나온 세 가지 개정을 고정한다.
// 1) advisor 호출을 실행 모델별로(phase-prompt.md {MODEL} 줄·공통 규칙 9, 감사 템플릿은 막혔을 때만)
// 2) Build 모델 시험 스위치(.dflow.local build_model_trial*, build-trial.sh 의 결정적 판정, state.json·build-log 기록)
// 3) sonnet Build 실패 시 opus 승급(게이트 재시도·단위 막힘 — 횟수는 늘리지 않는다)
// 이유·수치의 정본은 .claude/skills/dflow-dev/references/rationale.md 「advisor 호출 정책·Build 모델 시험·opus 승급(2026-09-26)」.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { devAll } from './_dflow-dev'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const SK = (p: string) => readFileSync(join(ROOT, '.claude/skills', p), 'utf8')
const flat = (s: string) => s.replace(/\s+/g, ' ')
const between = (text: string, start: string, end: string) => text.split(start)[1]?.split(end)[0] ?? ''
const SKILL = devAll()
const DISC = SK('dflow-dev/references/dev-discipline.md')
const PROMPT = SK('dflow-dev/references/phase-prompt.md')
const BUILD = SK('dflow-dev/references/phase-build.md')
const RAT = SK('dflow-dev/references/rationale.md')
const TRIAL = join(ROOT, '.claude/skills/dflow-dev/scripts/build-trial.sh')
const LIB = join(ROOT, '.claude/skills/dflow-work/scripts/dflow-config.sh')
const DFLOW = join(ROOT, '.claude/skills/dflow-work/scripts/dflow.sh')

let tmp: string
beforeEach(() => { tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-trial-'))) })
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

// 설정 파일 없는 빈 폴더(DFLOW_CONFIG_DIR)에서 돌린다 — 판정은 export 된 env 로만 한다.
function trial(ref: string, base: string, env: Record<string, string> = {}) {
  const r = spawnSync('sh', [TRIAL, ref, base], {
    cwd: tmp, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: '/nonexistent', DFLOW_CONFIG_DIR: tmp, ...env } as NodeJS.ProcessEnv,
  })
  return { code: r.status, out: (r.stdout ?? '').trim(), err: r.stderr ?? '' }
}
const bucketOf = (tsk: string) => {
  const r = spawnSync('sh', ['-c', `printf %s '${tsk}' | cksum`], { encoding: 'utf8' })
  return Number(r.stdout.trim().split(/\s+/)[0]) % 100
}
const ON = { DFLOW_BUILD_MODEL_TRIAL: 'sonnet' }

describe('build-trial.sh — Build 모델 시험 판정', () => {
  it('기본은 꺼짐(build_model_trial 이 비면 disabled)', () => {
    const r = trial('TSK-02-05', 'opus')
    expect(r.code).toBe(0); expect(r.out).toMatch(/^BUILD_TRIAL off reason=disabled /)
  })
  it('sonnet 밖의 값은 꺼짐 — haiku 로 Build 를 돌리지 않는다', () => {
    expect(trial('TSK-02-05', 'opus', { DFLOW_BUILD_MODEL_TRIAL: 'haiku', DFLOW_BUILD_MODEL_TRIAL_RATE: '100' }).out)
      .toMatch(/^BUILD_TRIAL off reason=unsupported /)
  })
  it('배정이 opus 인 작업만 대상이다(sonnet 배정은 base 로 꺼짐, 전체 id 의 opus 는 대상)', () => {
    expect(trial('TSK-02-05', 'sonnet', { ...ON, DFLOW_BUILD_MODEL_TRIAL_RATE: '100' }).out).toMatch(/^BUILD_TRIAL off reason=base /)
    expect(trial('TSK-02-05', 'claude-opus-4-1', { ...ON, DFLOW_BUILD_MODEL_TRIAL_RATE: '100' }).out)
      .toMatch(/^BUILD_TRIAL on model=sonnet reason=rate /)
  })
  it('비율은 printf %s <TSK> | cksum 의 첫 값 mod 100 < rate 로 결정적이다(경계 포함, 모듈 접두는 떼고 잰다)', () => {
    const b = bucketOf('TSK-02-05')
    const at = (rate: number, ref = 'TSK-02-05') => trial(ref, 'opus', { ...ON, DFLOW_BUILD_MODEL_TRIAL_RATE: String(rate) }).out
    expect(at(b)).toBe(`BUILD_TRIAL off reason=rate bucket=${b}`)
    expect(at(b + 1)).toBe(`BUILD_TRIAL on model=sonnet reason=rate bucket=${b}`)
    expect(at(b + 1)).toBe(at(b + 1)) // 재개해도 같다
    expect(at(b + 1, 'dict/TSK-02-05')).toBe(at(b + 1))
    expect(at(0)).toMatch(/ off reason=rate /)
    expect(at(100)).toMatch(/ on model=sonnet reason=rate /)
  })
  it('비율이 0~100 정수가 아니면 꺼짐(bad-rate)', () => {
    for (const v of ['', 'abc', '101', '-1', '12.5'])
      expect(trial('TSK-02-05', 'opus', { ...ON, DFLOW_BUILD_MODEL_TRIAL_RATE: v }).out).toMatch(/^BUILD_TRIAL off reason=bad-rate /)
  })
  it('목록이 있으면 목록 우선 — 비율 100 이어도 목록 밖은 꺼짐, 비율 0 이어도 목록 안은 켜짐', () => {
    const t = (ref: string, list: string, rate = '0') =>
      trial(ref, 'opus', { ...ON, DFLOW_BUILD_MODEL_TRIAL_RATE: rate, DFLOW_BUILD_MODEL_TRIAL_TASKS: list }).out
    expect(t('TSK-02-05', 'TSK-03-01', '100')).toMatch(/^BUILD_TRIAL off reason=not-listed /)
    expect(t('TSK-02-05', 'TSK-03-01,TSK-02-05')).toMatch(/^BUILD_TRIAL on model=sonnet reason=list /)
    expect(t('TSK-02-05', 'TSK-02')).toMatch(/ on .*reason=list /) // TSK 접두
    expect(t('TSK-02-05', 'TSK-02-0')).toMatch(/ off reason=not-listed /) // 칸 단위 접두만
    expect(t('TSK-02-05', 'WP-2')).toMatch(/ on .*reason=list /) // poll --wp 와 같이 번호 앞 0 무시
    expect(t('TSK-02-05', 'WP-03')).toMatch(/ off reason=not-listed /)
    expect(t('dict/TSK-02-05', 'dict/WP-02')).toMatch(/ on .*reason=list /)
    expect(t('TSK-02-05', 'dict/WP-02')).toMatch(/ off reason=not-listed /) // 모듈 접두 항목은 모듈까지 같아야 한다
    expect(t('mdm/TSK-02-05', 'dict/WP-02')).toMatch(/ off reason=not-listed /)
  })
  it('.dflow.local 의 키를 읽는다(dflow-config.sh 경유)', () => {
    writeFileSync(join(tmp, '.dflow'), 'api_base=https://p.test\nproject_id=11111111-1111-4111-8111-111111111111\n')
    writeFileSync(join(tmp, '.dflow.local'), 'dev_branch=dev/me\nbuild_model_trial=sonnet\nbuild_model_trial_tasks=WP-02\n')
    expect(trial('TSK-02-05', 'opus').out).toMatch(/^BUILD_TRIAL on model=sonnet reason=list /)
  })
  it('인자가 틀리면 exit 2', () => {
    expect(trial('', 'opus').code).toBe(2)
  })
})

describe('설정 키 — build_model_trial* 는 개인 설정', () => {
  const load = (dot: string, local: string, show: string) => {
    writeFileSync(join(tmp, '.dflow'), dot); writeFileSync(join(tmp, '.dflow.local'), local)
    const r = spawnSync('sh', ['-c', `. '${LIB}'; dflow_config_load || exit $?; ${show}`], {
      encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: '/nonexistent', DFLOW_CONFIG_DIR: tmp } as NodeJS.ProcessEnv })
    return { code: r.status, out: (r.stdout ?? '').trim(), err: r.stderr ?? '' }
  }
  const DOT = 'api_base=https://p.test\nproject_id=11111111-1111-4111-8111-111111111111\n'
  it('.dflow.local 의 세 키를 DFLOW_BUILD_MODEL_TRIAL* 로 낸다', () => {
    const r = load(DOT, 'dev_branch=dev/me\nbuild_model_trial=sonnet\nbuild_model_trial_rate=30\nbuild_model_trial_tasks=TSK-02-05,WP-03\n',
      'echo "$DFLOW_BUILD_MODEL_TRIAL|$DFLOW_BUILD_MODEL_TRIAL_RATE|$DFLOW_BUILD_MODEL_TRIAL_TASKS"')
    expect(r.code, r.err).toBe(0); expect(r.err).not.toContain('UNKNOWN_KEY')
    expect(r.out).toBe('sonnet|30|TSK-02-05,WP-03')
  })
  it('.dflow(프로젝트 공통)에 적으면 PERSONAL_KEY_IN_DFLOW', () => {
    const r = load(DOT + 'build_model_trial=sonnet\n', 'dev_branch=dev/me\n', 'echo ok')
    expect(r.code).toBe(2); expect(r.err).toContain('PERSONAL_KEY_IN_DFLOW build_model_trial')
  })
  it('dflow.sh config 로 값을 확인할 수 있다', () => {
    writeFileSync(join(tmp, '.dflow'), DOT); writeFileSync(join(tmp, '.dflow.local'), 'dev_branch=dev/me\nbuild_model_trial_rate=40\n')
    const r = spawnSync('sh', [DFLOW, 'config', 'build_model_trial_rate'], {
      encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: '/nonexistent', DFLOW_CONFIG_DIR: tmp } as NodeJS.ProcessEnv })
    expect(r.status, r.stderr).toBe(0); expect(r.stdout.trim()).toBe('40')
  })
  it('dflow.local.example 이 세 키를 주석 예시로 싣고 정본 절을 가리킨다', () => {
    const ex = SK('dflow-work/dflow.local.example')
    for (const k of ['# build_model_trial=sonnet', '# build_model_trial_rate=', '# build_model_trial_tasks='])
      expect(ex).toContain(k)
    expect(ex).toContain('「Build 모델 시험(build_model_trial)」')
    expect(flat(SK('dflow-work/SKILL.md'))).toContain('`build_model_trial`·`build_model_trial_rate`· `build_model_trial_tasks`')
  })
})

describe('advisor 호출 — 기본은 막혔을 때만, 정해진 시점은 Build sonnet 시험 단위만(phase-prompt.md)', () => {
  it('템플릿이 {UNIT} 다음 줄에 실행 모델을 알리고, {MODEL}·{ADVISOR_POLICY} 는 늘 값이 있는 변수다', () => {
    expect(PROMPT).toContain('Phase 서브에이전트다.\n{UNIT}\n당신의 실행 모델은 {MODEL} 이다.\n')
    expect(PROMPT).toContain('`{MODEL}`·`{ADVISOR_POLICY}` 도 늘 값이 있다')
    const row = PROMPT.split('\n').find((l) => l.startsWith('| `{MODEL}` |')) ?? ''
    expect(row).toContain('Agent 호출의 `model` 과 같은 값(state.json `model`')
    const pol = PROMPT.split('\n').find((l) => l.startsWith('| `{ADVISOR_POLICY}` |')) ?? ''
    expect(pol).toContain('**Build sonnet 시험 단위**(state.json `build_model_trial` 이 true 이고 sonnet 으로 도는 Build 단위')
    expect(pol).toContain('만 `착수 전·막혔을 때·완료 전`')
    expect(pol).toContain('그 밖(모든 Design·Verify·Refactor, 원래 배정의 Build, 승급한 opus)은 `막혔을 때만`')
  })
  it('공통 규칙 9: 도구가 있을 때만, 하네스 지시보다 우선, {ADVISOR_POLICY} 로 시점을 정하고 호출 수를 보고한다', () => {
    const r9 = flat(between(PROMPT, '9. advisor:', '\n보고\n'))
    expect(r9).toContain('advisor 도구가 있을 때만 적용한다')
    expect(r9).toContain('이 규칙이 하네스의 일반 advisor 지시(착수 전·완료 전 호출 등)보다 우선한다')
    expect(r9).toContain('이번 호출 시점은 `{ADVISOR_POLICY}` 다')
    expect(r9).toContain('`막혔을 때만` 이면 막혔을 때만 부른다 — 같은 오류가 되풀이될 때, 게이트·테스트가 풀리지 않을 때, 설계와 코드가 충돌해 방향을 바꿔야 할 때')
    expect(r9).toContain('착수 전·완료 전 정기 호출은 하지 않는다')
    expect(r9).toContain('`착수 전·막혔을 때·완료 전` 이면 코드 작성 착수 전 1회, 막혔을 때, 완료 보고 전 1회 부른다')
    expect(r9).toContain('부른 횟수는 보고에 적는다')
    expect(r9).not.toContain('sonnet·haiku 면 정해진 시점') // 모델별 강제 호출(첫 안)은 폐기
    const tpl = between(PROMPT, '## 템플릿', '## 감사 템플릿')
    expect(tpl.indexOf('9. advisor:')).toBeGreaterThan(tpl.indexOf('8. 대상 리포의 공용 결정 기록'))
    expect(tpl.indexOf('9. advisor:')).toBeLessThan(tpl.indexOf('\n보고\n'))
    expect(flat(tpl)).toContain('`advisor <누적 호출 수>`(부르지 않았으면 0)')
    expect(r9).toContain('이 에이전트가 지금까지 부른 누적 횟수다(SendMessage 로 이어 받은 뒤의 보고도 처음부터 센다)')
    expect(PROMPT).toContain('| 9 advisor | dev-discipline.md 「advisor 호출(실행 모델별)」 |')
  })
  it('감사 템플릿: 막혔을 때만, 판단이 서지 않으면 advisor 대신 지적으로, 보고에 호출 수 한 줄', () => {
    const audit = flat(between(PROMPT, '## 감사 템플릿', '## 규칙의 정본'))
    expect(audit).toContain('advisor 는 도구가 있을 때만, 막혔을 때만 부른다(짧은 읽기 전용 감사다)')
    expect(audit).toContain('읽기로 판단이 서지 않으면 advisor 를 부르지 말고 지적으로 올리고 끝낸다')
    expect(audit).toContain('하네스의 일반 advisor 지시보다 우선한다')
    expect(audit).toContain('- 마지막 줄 바로 앞: `advisor <호출 수>`(부르지 않았으면 0). - 마지막 줄: 못 본 범위')
    expect(audit).not.toContain('착수 전 1회')
  })
  it('dev-discipline 「advisor 호출(실행 모델별)」 표와 기록 규칙', () => {
    const sec = between(DISC, '### advisor 호출(실행 모델별)', '\n## ')
    expect(sec).toContain('**이 규칙이 하네스의 일반 advisor 지시(착수 전·완료 전\n호출 등)보다 우선한다.**')
    const rows = sec.split('\n').filter((l) => l.startsWith('| '))
    const base = rows.find((l) => l.startsWith('| 기본')) ?? ''
    expect(base).toContain('모든 Design·Verify(작성자)·Refactor, 원래 배정의 Build(opus·sonnet), 승급한 opus, 게이트 재시도 에이전트')
    expect(base).toContain('`막혔을 때만`')
    const trialRow = rows.find((l) => l.includes('**Build sonnet 시험 단위**')) ?? ''
    expect(trialRow).toContain('`착수 전·막혔을 때·완료 전`')
    expect(trialRow).toContain('코드 작성 착수 전 1회, 막혔을 때, 완료 보고 전 1회')
    expect(rows.find((l) => l.startsWith('| Verify 감사자'))).toContain('막혔을 때만')
    // 호출 수는 작성자·Build 단위 몫과 감사자 몫을 따로
    const f = flat(sec)
    expect(f).toContain('작성자·Build 단위 몫과 감사자 몫을 따로 옮긴다')
    expect(f).toContain('state.json `verify_advisor` `{"writer":<작성자>,"audit":<감사자 셋의 합>}`')
    expect(flat(SKILL)).toContain('`verify_advisor.audit` 에 감사 보고의 advisor 호출 수를 더한다')
    expect(flat(SKILL)).toContain('`verify_advisor.writer` 에 덮어쓴다(보고가 누적 값이다')
    expect(flat(SKILL)).toContain('같은 에이전트가 SendMessage 로 다시 보고하면 더하지 않고 덮어쓴다')
    expect(f).toContain('**누적** 횟수라, 같은 에이전트의 다음 보고는 덮어쓴다')
  })
  it('SKILL.md 가 {ADVISOR_POLICY} 채우는 규칙을 싣고, 승급·재시도 에이전트는 막혔을 때만이다', () => {
    const s = flat(SKILL)
    expect(s).toContain('프롬프트의 `{ADVISOR_POLICY}` 는 Build sonnet 시험 단위(state.json `build_model_trial` 이 true 이고 sonnet 으로 도는 단위)만 `착수 전·막혔을 때·완료 전`, 그 밖의 모든 Phase 에이전트는 `막혔을 때만` 이다')
    expect(s).toContain('승급한 에이전트와 게이트 재시도 에이전트는 시험 단위가 아니므로 `{ADVISOR_POLICY}` 를 `막혔을 때만` 으로 채운다')
  })
})

describe('Build 모델 시험 — 배정·기록', () => {
  it('배정표 Build 행이 두 예외를 가리키고 haiku 금지를 유지한다', () => {
    const row = DISC.split('\n').find((l) => l.startsWith('| Build |')) ?? ''
    expect(row).toContain('「Build 모델 시험(build_model_trial)」(켰을 때만)')
    expect(row).toContain('「sonnet Build 의 opus 승급」')
    expect(row).toContain('**haiku 금지**')
    // Design·Verify 배정은 그대로
    expect(DISC.split('\n').find((l) => l.startsWith('| Verify |'))).toContain('**처음부터 sonnet**')
    expect(DISC.split('\n').find((l) => l.startsWith('| Design |'))).toContain('복잡도 점수 3점↑ opus, 미만 sonnet')
  })
  it('판정은 Phase 01 에서 한 번, state.json 에 적고 재개는 다시 판정하지 않는다', () => {
    const p5 = flat(between(SKILL, '5. spec.md 읽기(필수)', '6. **준비 끝 표시**'))
    expect(p5).toContain('state.json 에 `build_model_trial` 이 없을 때만 `.claude/skills/dflow-dev/scripts/build-trial.sh <external_ref> <build_model_base>`')
    expect(p5).toContain('있으면(재개) 다시 판정하지 않는다')
    const sec = flat(between(DISC, '### Build 모델 시험(build_model_trial)', '### sonnet Build 의 opus 승급'))
    expect(sec).toContain('**판정은 Phase 01 에서 한 번만**')
    expect(sec).toContain('`build_model_base`(배정표가 정한 Build 모델)와 `build_model_trial` (`true`|`false`)')
    expect(sec).toContain('**목록이 있으면 목록만 보고, 없으면 비율**')
    expect(sec).toContain('`printf %s <TSK> | cksum` 의 첫 값 mod 100 이 rate 보다 작으면 켠다')
    expect(sec).toContain('Design·Verify 의 모델 배정은 바꾸지 않는다')
    expect(flat(SKILL)).toContain('`build_model_base`·`build_model_trial`(Phase 01 5번)')
  })
  it('build-log.md `## 실행 모델` 표의 열과 비교 지표의 출처가 정해져 있다', () => {
    const sec = between(DISC, '### Build 모델 시험(build_model_trial)', '### sonnet Build 의 opus 승급')
    for (const col of ['| 단위 |', '| 에이전트 |', '| 모델 |', '| 시험 |', '| 승급 |', '| 결과 |', '| 경과 |', '| 토큰 |', '| advisor |'])
      expect(sec).toContain(col)
    expect(sec).toContain('`sonnet→opus(<사유>)`')
    const f = flat(sec)
    expect(f).toContain('게이트 신규 실패 수는 `## 게이트 기록`·state.json `build_gate.new_failures`')
    expect(f).toContain('Verify 지적 수는 state.json `verify_findings`')
    // Verify 감사 파일은 지워지므로 받는 즉시 수를 남긴다
    expect(flat(SKILL)).toContain('같은 때 state.json `verify_findings.<역할>` 에 지적 수를')
  })
})

describe('sonnet Build 의 opus 승급 — 기존 재시도·인계 상한과 맞물림', () => {
  const s = flat(SKILL)
  it('(a) 게이트 1차 실패: sonnet 에이전트에 이어 붙이지 않고 opus 새 에이전트, 횟수는 그대로, 부하 민감 단독 재실행이 먼저', () => {
    expect(s).toContain('**그 에이전트가 sonnet 이면 이어 붙이지 않는다** — TaskStop 한 뒤 opus 새 에이전트 `<TSK>-build-retry`')
    expect(s).toContain('이 opus 재시도가 1회 재시도 자리를 대신한다(횟수는 늘지 않는다)')
    expect(s).toContain('위 부하 민감 단독 재실행이 먼저다(통과하면 재시도도 승급도 없다)')
    expect(s).toContain('마지막 단위 에이전트가 이미 opus 면(승급했거나 원래 opus) 종전대로 이어 붙인다')
    expect(s).toContain('(Build 에서 그 모델이 sonnet 이었으면 위대로 opus 새 에이전트다.)')
    expect(PROMPT).toContain('`구현 단위 <마지막 단위>(Build 게이트 재시도 — 단위 범위 제한 없이 Build 전체를 고친다)`')
    expect(flat(BUILD)).toContain('그 에이전트가 sonnet 이면 이어 붙이지 않고 opus 새 에이전트가 이 재시도를 맡는다')
  })
  it('(b) 단위 막힘: 두 번째 인계 또는 초록 없이 끝남 → 이어받기를 opus, 인계 상한 2회는 그대로', () => {
    expect(s).toContain('같은 단위의 두 번째 인계(`UNIT_HANDOFF`)이거나, 새·관련 테스트 초록 없이 끝났을 때')
    expect(s).toContain('인계 상한(단위마다 2회)은 그대로이고 승급은 그 자리의 모델만 바꾼다')
    expect(s).toContain('인계가 이미 2회면(이 커밋이 세 번째가 된다) 바꾸지 않고 Build 실패다')
    expect(s).toContain('그 단위가 끝나면 남은 단위는 원래 모델로 돌아간다')
    expect(SKILL).toContain('이어 띄우기는 단위마다 2회까지다')
  })
  it('opus 단위는 종전대로 — 둘 다 아닌 보고는 Build 실패', () => {
    expect(s).toContain('둘 다 아닌 보고는 opus 단위면 Build 실패이고, sonnet 단위면 아래 「승급」 이다')
    expect(s).toContain('한 단위가 Build 실패(세 번째 인계, opus 단위의 둘 다 아닌 보고)면')
    expect(flat(DISC)).toContain('opus 단위는 종전대로다 — 둘 다 아닌 보고는 Build 실패이고, 관련 테스트가 빨간 `UNIT_DONE` 도 종전처럼 다룬다')
    expect(flat(DISC)).not.toContain('opus 단위가 초록 없이 끝나면')
  })
  it('초록 없이 끝난 sonnet 단위는 인계 커밋으로 바꿔 트레일러 하나를 쓰고 승급 표식을 남긴다', () => {
    expect(s).toContain('`--trailer "DFlow-Unit: <단위> handoff" --trailer "DFlow-Escalate: <단위> 초록 없이 끝남"`')
    expect(s).toContain('범위 밖에 커밋되지 않은 변경이 남으면 Build 실패다')
  })
  it('재개 함정: 단위 모델은 state.json model 이 아니라 트레일러로 정한다', () => {
    const d = flat(between(DISC, '### sonnet Build 의 opus 승급', '### advisor 호출'))
    expect(d).toContain('**모델은 git 으로 정한다(재개 포함)**')
    expect(d).toContain('state.json `model`(승급 뒤에는 opus 로 남아 있다)에서 읽지 않는다')
    expect(d).toContain('인계 트레일러 (`DFlow-Unit: <단위> handoff`)가 2개 이상이거나 `DFlow-Escalate: <단위>` 트레일러가 있으면 opus 다')
    expect(d).toContain("`--grep='DFlow-Escalate: <단위> '` 줄 수로 센다 — 단위 이름 뒤 공백까지 넣어야 `B1` 이 `B10` 을 잡지 않는다")
    expect(s).toContain('단위를 띄울 때의 모델은 state.json `model` 이 아니라 git 트레일러로 정한다(재개도 같다')
  })
  it('재개 함정: done 커밋 뒤에 승급 인계가 쌓인 단위는 끝난 단위가 아니다(가장 최근 트레일러가 done 일 때만)', () => {
    expect(SKILL).toContain("git log <기점>..HEAD --grep='DFlow-Unit: <단위> done' --format=%h") // 종전 문구 유지
    expect(s).toContain('그 단위의 **가장 최근** `DFlow-Unit` 트레일러가 `done` 이면 끝난 단위다')
    expect(s).toContain("--grep='DFlow-Unit: <단위> ' --format=%B | sed -n 's/^DFlow-Unit: <단위> //p'` 가 `done`")
    expect(s).toContain('에이전트가 이미 `done` 커밋을 남겼으면 되돌리지 않고 그 위에 이 커밋을 쌓는다')
  })
  it('기록: state.json model·build-log 승급 칸·progress 메모(새 서버 계약 없이), progress 는 model 을 바꾸기 전에', () => {
    expect(s).toContain('"escalated: sonnet→opus <단위>(<사유>)"')
    expect(s).toContain('state.json `model` 을 바꾸기 **전에** 보낸다')
    expect(s).toContain('state.json `model` 을 opus 로 쓰고 이어받기 `<TSK>-build-<단위>-c<n>` 을 opus 로 띄운다')
    expect(s).not.toContain('sonnet 승격') // 용어는 승급
  })
})

describe('rationale — 수치 근거', () => {
  it('advisor 실측과 시험·승급 이유를 싣는다', () => {
    const sec = flat(between(RAT, '## advisor 호출 정책·Build 모델 시험·opus 승급(2026-09-26)', '## e2e.md'))
    for (const k of ['advisor 가 82회', '회당 약 2분', '약 1만 토큰', '약 15만 토큰', '23M(+14%)', 'Opus Build 단위 26개가 약 52회',
      'Sonnet Build 단위 11개는 약 7회', 'Sonnet Verify 7건은 12회', '완료 전 호출의 절반'])
      expect(sec).toContain(k)
    expect(sec).toContain('haiku 는 여전히 Build·Verify 에 쓰지 않는다')
    for (const k of ['코드 품질 때문에 생긴 게이트 실패·Verify 실패·반려는 0건', 'sonnet 작업 3건 포함', '모두 환경·', '건당 +11~15분, +1.3~2.2M'])
      expect(sec).toContain(k)
  })
})

describe('읽기 전용 조사 서브에이전트 — 위치 조사는 haiku 기본, 해석·판단은 sonnet', () => {
  it('phase-prompt 공통 규칙 6 과 dev-discipline 공통 금지가 같은 구분을 싣는다', () => {
    const r6 = flat(between(PROMPT, '6. 토큰:', '7. 금지:'))
    expect(r6).toContain('읽기 전용 조사 서브에이전트(공통 규칙 3)를 띄울 때는 Agent 호출에 model 을 적는다')
    expect(r6).toContain('파일·선례·위치 찾기 같은 위치 조사는 `haiku`(기본), 조사 결과를 해석·판단해야 하는 조사(설계 대안 비교, 코드 의미 검토)는 `sonnet`')
    expect(r6).not.toContain('sonnet 또는 haiku')
    const ban = flat(DISC.slice(DISC.indexOf('## 공통 금지')))
    expect(ban).toContain('파일·선례·위치 찾기 같은 읽기 전용 위치 조사는 `haiku` 가 기본이고(Design·Build·Verify 어디서 띄우든 같다)')
    expect(ban).toContain('조사 결과를 해석·판단해야 하는 조사(설계 대안 비교, 코드 의미 검토)는 `sonnet` 을 적는다')
    // 공통 규칙 3 의 예(Explore)는 그대로
    expect(flat(PROMPT)).toContain('새 읽기 전용 서브에이전트(예: Explore)를 띄워 조사 질문만 명시한다')
  })
  it('바꾸지 않는 것: Verify 감사자 sonnet, 배정표 haiku 금지(실행 모델)', () => {
    expect(SKILL).toContain('`model: "sonnet"` 을 준다')
    expect(flat(DISC)).toContain('Verify 감사자 셋은 조사가 아니라 감사라 이 규칙 밖이다(sonnet')
    expect(flat(DISC)).toContain('이 표의 haiku 금지는 Phase 실행 모델의 규칙이다')
    expect(DISC.split('\n').find((l) => l.startsWith('| Design |'))).toContain('**haiku 금지**')
    const sec = flat(between(RAT, '## advisor 호출 정책·Build 모델 시험·opus 승급(2026-09-26)', '## e2e.md'))
    for (const k of ['Explore 21개가 모두 sonnet', '작업당 3~8분이 임계 경로', '생길 자리가 없다'])
      expect(sec).toContain(k)
  })
})
