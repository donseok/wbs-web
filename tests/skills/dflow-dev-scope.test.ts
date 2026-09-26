// tests/skills/dflow-dev-scope.test.ts — /dflow-dev 실행 범위(--scope design|build|full).
// 설계: docs/superpowers/specs/2026-09-26-dflow-dev-skill-router-design.md §14
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { devOrch, devRouter } from './_dflow-dev'
import { stripWorkerBlocks, workerBlocks } from './_preserve'

const flat = (s: string) => s.replace(/\s+/g, ' ')
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('실행 범위 — 안내 본문', () => {
  const router = flat(devRouter())
  it('사용법·기본값·잘못된 값·--only 와의 관계를 정한다', () => {
    expect(router).toContain('[--scope design|build|full]')
    expect(router).toContain('없으면 state.json `scope`, 그것도 없으면 `full`')
    expect(router).toContain('`--only` 와 함께 오면 사용법을 알리고 멈춘다')
  })
  it('wait_review 는 진행 중 phase 가 아니고 저절로 재개되지 않는다', () => {
    expect(router).toContain('`wait_review` 는 설계만(`--scope design`)으로 설계를 마치고 사람의 설계 검토를 기다리며 멈춘 상태다')
    expect(router).toContain('선행 대기(`wait_pred`)와 달리 저절로 재개되지 않는다')
  })
})

describe('설계만 멈춤(--scope design)', () => {
  const d = flat(devOrch('design'))
  it('build-start 를 부르지 않고 wait_review 로 멈춘다(순서 고정)', () => {
    const sec = d.split('### 설계만 멈춤')[1] ?? ''
    expect(sec).toContain('`build-start` 를 **부르지 않는다**')
    const order = ['design.md 커밋을 확인한다', 'state.json `phase` 를 `wait_review` 로 쓰고', '`progress 25 "설계 완료(검토 대기)"`',
      '`git push origin <agent 브랜치>`', '`dflow.sh heartbeat <ref> --phase wait_review`']
    const idx = order.map((o) => sec.indexOf(o))
    idx.forEach((i, k) => expect(i, order[k]).toBeGreaterThan(-1))
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    expect(sec).toContain('`wait_pred` 를 쓰지 않는 이유')
  })
  it('워커는 design_review 결과로 끝낸다(표지 블록 안)', () => {
    const b = workerBlocks(devOrch('design')).map((x) => x.body).join('\n')
    expect(b).toContain('- design_review`')
    expect(stripWorkerBlocks(devOrch('design'))).not.toContain('design_review')
  })
})

describe('구현부터(--scope build)', () => {
  const s = flat(devOrch('start'))
  it('claim 전에 개발 브랜치의 사람 설계를 읽고 5절을 검사하며, 빠진 절을 채우지 않는다', () => {
    expect(s).toContain('git show origin/<기본브랜치>:<TASKS>/<TSK>/design.md')
    expect(s).toContain('**빠진 절을 스스로 채우지 않는다**')
    const b = workerBlocks(devOrch('start')).map((x) => x.body).join('\n')
    expect(b).toContain('`skipped design_missing`')
    expect(b).toContain('`skipped design_invalid <빠진 절>`')
  })
  it('wait_review 는 범위 build 에서만 이어 가고, 선행 미충족이면 wait_pred 로 바꾸며, Design 게이트를 다시 돈다', () => {
    expect(s).toContain('범위가 `build` 가 아니면 이어 가지 않는다')
    expect(s).toContain('state.json `phase` 를 `wait_pred` 로 바꿔')
    // 행동 검증(2026-09-26): 게이트는 phase 를 바꾸기 전에 돌아야 실패 때 wait_review 가 그대로 남는다
    expect(s).toContain('받아 온 **바로 뒤, 아무것도 커밋하기 전에 Design 게이트를 다시 돈다**')
    expect(s).toContain('`## 선행 기준` 절이 있을 때만 한다')
  })
  it('검토 대기 재개는 origin 의 사람 수정을 받아 오고(갈라지면 멈춤), scope 를 build 로 바꾼다', () => {
    expect(s).toContain('**사람이 고친 설계를 받아 온다.**')
    expect(s).toContain('로컬이 origin 의 조상이면 `git merge --ff-only origin/<그 브랜치>` 로 맞추고')
    expect(s).toContain('둘 다 아니면(갈라짐) 이어 가지 않고')
    expect(s).toContain('state.json `scope` 를 `build` 로 바꾼다')
  })
  it('Design 서브에이전트를 띄우지 않고, 설계 폴더는 재claim 격리하지 않으며, scope 를 state.json 에 적는다', () => {
    expect(flat(devOrch('design'))).toContain('범위가 `build` 면(`orch/start.md` 「구현부터」·「설계 검토 대기」) Design 서브에이전트를 띄우지 않는다')
    const c = flat(devOrch('claim'))
    expect(c).toContain('**구현부터(`--scope build`)의 설계 폴더도 예외다** — 위 scaffold 예외의 「`state.json` 하나만」 조건과 무관하다.')
    expect(c).toContain('같은 쓰기에서 `scope`(`design`|`build`)를 함께 적는다')
  })
})

describe('다른 스킬', () => {
  it('승인 스윕은 wait_review 브랜치를 후보로 잡지 않는다(문서와 스크립트가 같은 필터)', () => {
    const f = 'select(.phase != "merged" and .phase != "wait_pred" and .phase != "wait_review")'
    expect(read('.claude/skills/dflow-merge/SKILL.md')).toContain(f)
    expect(read('.claude/skills/dflow-merge/scripts/sweep-check.sh')).toContain(f)
  })
  it('팀장: 인자로 범위를 정해 team.start·포인터로 넘기고, 워커가 --scope 로 바꾼다', () => {
    const team = flat(read('.claude/skills/dflow-team/SKILL.md'))
    expect(team).toContain('"설계만"·"설계까지" → `design`, "구현부터"·"개발자동" → `build`, 없으면 `full`')
    expect(team).toContain('`team.start`(backend, slots, until, wp, scope)')
    expect(team).toContain('SCOPE=<full|design|build>')
    expect(team).toContain('| `design_review`(설계만 멈춤, `<SCOPE>`=`design`) | 해제 | 없음 |')
    const wp = flat(read('.claude/skills/dflow-team/references/worker-prompt.md'))
    expect(wp).toContain('`/dflow-dev {ID8} --worker {MODEL_FLAG} {SCOPE_FLAG}`')
    expect(wp).toContain('| `{SCOPE_FLAG}` | `SCOPE` |')
    expect(read('.claude/skills/dflow-team/scripts/lead-state.sh')).toContain('scope=\\($st.scope // "-")')
  })
  it('팀장: 범위 build 만 검토 대기 설계를 이어 가고, 좌석 「이어서 시작」 은 범위와 무관하게 build 로 띄운다', () => {
    const sc = flat(read('.claude/skills/dflow-team/references/scope.md'))
    expect(sc).toContain('select(.phase == "wait_review")')
    expect(sc).toContain('`full`·`design` 에서는 1 을 하지 않는다')
    expect(sc).toContain('요청 작업이 검토 대기면 포인터를 `SCOPE=build` 로 띄운다')
    expect(sc).toContain('git -C \'<MAIN>\' cat-file -e "origin/<개발브랜치>:<TASK_DIR>/design.md"')
    expect(flat(read('.claude/skills/dflow-team/references/restart.md'))).toContain('| 4-2 | `local_phase=wait_review` |')
  })
  it('워커 규칙이 --scope 를 따르고 결과 값을 적는다', () => {
    const w = flat(read('.claude/skills/dflow-dev/references/worker-mode.md'))
    expect(w).toContain('`--scope` 는 팀장이 넘긴 그대로 따른다')
  })
})
