// tests/skills/dflow-dev-worker.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dropRanges, firstLostLine, parseFixture, stripWorkerBlocks, workerBlocks } from './_preserve'

// fixture 갱신 절차
// 1. fixture 는 `git show <sha>:<경로>` 로 뜬 수정 전 원문이며, 첫 줄 머리 주석에 그 sha 와 경로가 있다.
//    손으로 쓰거나 고치지 않는다. 뜨는 명령은 계획서 Task 1 Step 1 이다.
// 2. 머지 직전(계획서 Task 10)에는 `git log --oneline <sha>..<머지 대상 브랜치 머지 전 tip> -- <경로>` 로
//    원문이 바뀌었는지 본다. 바뀌었으면 그 tip 의 원문으로 fixture 를 다시 떠서(머리 주석 sha 도 그 tip) 이
//    테스트를 돌리고 커밋한다. 옛 fixture 로는 머지 충돌을 한쪽으로 풀다 잃은 다른 세션의 수정을 잡지 못한다.
// 3. 머지 뒤 누가 이 스킬의 표지 블록 밖 원문을 고치면 이 테스트가 빨개진다. 의도다. 고치는 사람이 그
//    원문 줄을 CHANGED 에 이유 주석과 함께 더하고 스펙 §6-1 수정 목록도 갱신해 변경을 기록한다.

const ROOT = process.cwd() // vitest 는 리포 루트에서 돈다(기존 tests/ 관례)
const skill = readFileSync(join(ROOT, '.claude/skills/dflow-dev/SKILL.md'), 'utf8')
const fixture = parseFixture(readFileSync(join(ROOT, 'tests/skills/fixtures/dflow-dev.SKILL.orig.md'), 'utf8'))
const orig = fixture.text
const manual = stripWorkerBlocks(skill)
const between = (text: string, start: string, end: string) => text.split(start)[1]?.split(end)[0] ?? ''

/** 스펙 §6-1 수정 목록으로 의도적으로 바꾸는 원문 줄. 이 밖의 원문 줄은 같은 순서로 남아야 한다. */
const CHANGED = [
  // 1. 상태 모델: state.json 스키마에 api_base
  '  `{ "tsk", "order", "phase", "baseline": {"failures": N, "tests": M}, "last": {"phase","event"} }`',
  // 2. Phase 0-가 1~5번은 CHANGED_RANGES 로 통째로 바꾼다
  // 3. Phase 0 2번 spec 검사: show 응답의 spec 경로는 .order.item.spec
  '   - **spec 검사**: show 의 `item.spec` 이 비어 있으면 착수 불가 — 제목만으로 요구사항을',
  // 4·5. Phase 0 2번: claim 전 기점 이동·실패 복귀, exit 4 재시도에서 merge 삭제
  '   판정 통과 후 claim. exit 4(선행·상태로 인한 진행 불가 — 서버 403 `dependency_not_met`',
  '   재매핑 포함)면 fetch/merge 후 1회 재시도, 그래도 4 면 중단·보고. 우회 금지.',
  // 6. Phase 0 3번 기점 문구: HEAD 가 이미 기점에 있다. 스택 기록의 branch_base 는 커밋 sha, api_base 함께 기록
  '   기점 규칙:',
  '     브랜치 위**에 만들고, state.json 에 `branch_base` 와 `risk`(선행 반려 시 재작업)를 기록한다.',
  '   git fetch origin && git switch -c agent/<주문id8>-<slug> <기점>',
  // 1·6. Phase 0 4번 기준선 기록: api_base 가 없으면 함께 기록(state.json 을 처음 쓰는 곳의 본문 지시)
  '4. **게이트 기준선 기록**: dev-discipline 의 기준선 절차 실행, state.json 에 저장.',
  // 7. Phase 5 4번: reported state.json 커밋·push 와 안내 문구
  '4. state.json `phase=reported`. 사용자에게 **"승인 대기로 보고했습니다"** 로 전달(완료 아님).',
  '   다음 `/dflow-dev` 호출의 Phase 0-가 스윕이 자동으로 처리한다(수동으로 지금 당장 머지만 하고',
  '   싶으면 `/dflow-merge` 를 여전히 따로 쓸 수 있다).',
  // 9. Phase 번호 01 기반 전환(16f1573d, 2026-09-17): 제목과 본문 상호 참조의 번호만 바뀐다
  '## Phase 0-가 — 승인 스윕(머지, 오케스트레이터 본인)',
  '## Phase 0 — Claim·브랜치·기준선 (오케스트레이터 본인)',
  '   reported → 종료 / approved → 위 Phase 0-가 스윕이 이미 처리했어야 함(로컬 state.json 이 없는',
  '   - 재작업 완료 후 마감은 Phase 5 그대로(`done --auto-links`) — state 는 다시 `reported`.',
  '       거짓이면 선행이 main 미반영 상태. **Phase 0-가 4번과 같은 절차로 지금 직접 머지한다**',
  '## Phase 1~4 — Design → Build → Verify → Refactor',
  '## Phase 5 — 마감 (오케스트레이터 본인)',
] as const

/**
 * 스펙 §6-1 수정 목록 2번: 줄 묶음으로 바꾸는 원문. [시작 줄, 범위 뒤 첫 줄(남는 줄)].
 * Phase 0-가 1~5번(60~79행)은 코드 펜스처럼 다른 곳에도 있는 줄을 품어 CHANGED 한 줄 목록으로 적을 수 없다.
 */
const CHANGED_RANGES = [
  [
    '1. **후보 식별**: 대상 저장소의 `docs/tasks/*/state.json` 중 `phase=reported` 전부.',
    '6. **집계 보고**: 머지됨 / 승인 대기 / 건너뜀(사유) 을 한 줄씩 — 원래 요청받은 작업으로 넘어가기 전.',
  ],
] as const

describe('/dflow-dev 원문 보존(스펙 §6-1)', () => {
  it('CHANGED 와 CHANGED_RANGES 밖의 원문 줄은 표지 블록을 뺀 본문에 같은 순서로 남아 있다', () => {
    expect(firstLostLine(dropRanges(orig, CHANGED_RANGES), manual, CHANGED)).toBeNull()
  })

  it('CHANGED 줄과 범위 경계 줄은 fixture 에 정확히 한 번씩 있다(fixture 가 낡지 않았다)', () => {
    const lines = orig.split('\n')
    for (const l of [...CHANGED, ...CHANGED_RANGES.flat()]) expect(lines.filter((x) => x === l).length, l).toBe(1)
  })

  it('CHANGED 줄과 범위 시작 줄은 현재 파일에 남아 있지 않다(목록이 실제 수정과 일치한다)', () => {
    const lines = skill.split('\n')
    for (const l of [...CHANGED, ...CHANGED_RANGES.map(([start]) => start)]) expect(lines, l).not.toContain(l)
  })

  it('description 사용법과 표지 블록 밖에는 --worker 가 없다', () => {
    const fm = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
    expect(fm).not.toContain('--worker')
    expect(manual).not.toContain('--worker')
  })
})

describe('/dflow-dev 원문 수정(스펙 §6-2, 수동·워커 공통)', () => {
  it('상태 모델: state.json 에 api_base 를 두고 처음 쓰는 곳(3번 스택 기록·4번 기준선 본문)과 반려 재작업에서 채운다', () => {
    const model = between(manual, '## 상태 모델', '## Phase 01-가')
    expect(model).toContain('"api_base"')
    expect(model).toContain('끝 `/` 를 뺀 값')
    expect(model).toContain('Phase 01 에서 state.json 을 처음 쓰는 곳')
    expect(model).toContain('반려 재작업이 기존 state.json 에 `phase=rejected` 를 쓸 때')
    const p03 = between(manual, '3. **브랜치를 오케스트레이터가 직접 만든다**', '4. **게이트 기준선 기록**')
    expect(p03).toContain('`branch_base`(기점 커밋 sha)·`risk`(선행 반려 시 재작업)와 `api_base`(상태 모델)를 기록한다')
    expect(manual).toContain('state.json 에 저장(`api_base` 가 아직 없으면 함께 기록한다. 상태 모델).')
  })

  it('Phase 0-가: 후보를 로컬 + 원격으로 넓히고 판정~뒷정리는 /dflow-merge 2~5번에 맡긴다', () => {
    const sweep = between(manual, '## Phase 01-가', '## Phase 01 — Claim·브랜치·기준선')
    expect(sweep).toContain('`origin/agent/*`')
    expect(sweep).toContain('"건너뜀(다른 D\'Flow)"')
    expect(sweep).toContain('로컬이든 원격이든')
    expect(sweep).toContain('같은 order 가 로컬과 원격에 모두 있으면 로컬 후보 하나로 합친다')
    expect(sweep).toContain('`origin/agent/<id8>-<slug>`')
    expect(sweep).toContain('`/dflow-merge` SKILL.md(`.claude/skills/dflow-merge/SKILL.md`) 2~5번을 그대로 따른다')
    expect(sweep).not.toContain('git merge --no-ff') // 머지 절차를 두 곳에 적지 않는다
    expect(sweep).not.toContain('phase=rejected')
  })

  it('Phase 0 2번: spec 은 .order.item.spec 에서 읽고, 원래 위치를 기록하고 기점으로 옮긴 뒤 claim 하며, 실패하면 기록한 위치로 돌아간다', () => {
    const p02 = between(manual, '2. **착수 가능 판정', '3. **브랜치를 오케스트레이터가 직접 만든다**')
    expect(p02).toContain('show 의 `.order.item.spec` 이 비어 있으면')
    expect(p02).not.toContain('show 의 `item.spec`')
    expect(p02).toContain('기점 이동이 실패하면 claim 하지 않고 중단·보고한다')
    expect(p02).toContain('git symbolic-ref -q --short HEAD || git rev-parse HEAD')
    expect(p02).toContain('git switch --detach <기점>')
    expect(p02).toContain('`origin/<기본브랜치>` 여도 detach 한다')
    expect(p02).toContain('git merge-base --is-ancestor <선행 head_sha> <기점>')
    expect(p02).toContain('선행을 모두 조상으로 갖는 기점 없음')
    expect(p02).toContain('git switch <기록한 브랜치>')
    expect(p02).toContain('git switch --detach <기록한 sha>')
    expect(p02).toContain('`git switch -` 는 쓰지 않는다')
  })

  it('exit 4 재시도는 merge 없이 기점을 다시 정하고, 3번은 옮겨 둔 기점에서 브랜치를 만든다', () => {
    const p02 = between(manual, '2. **착수 가능 판정', '3. **브랜치를 오케스트레이터가 직접 만든다**')
    const p03 = between(manual, '3. **브랜치를 오케스트레이터가 직접 만든다**', '4. **게이트 기준선 기록**')
    expect(p02).toContain('`git fetch origin` 뒤 기점을 다시 정해')
    expect(p02).not.toContain('fetch/merge')
    expect(p03).toContain('git switch -c agent/<주문id8>-<slug> <기점>')
    expect(p03).not.toContain('git fetch origin && git switch -c')
  })

  it('Phase 5 4번: reported 를 커밋·push 하고 안내 문구가 실제 반영 경로와 맞는다', () => {
    const p5 = between(manual, '## Phase 06', '## --only 옵션')
    expect(p5).toContain('그 파일을 파일명을 명시해 커밋한 뒤 `git push origin <agent 브랜치>` 한다')
    expect(p5).toContain('"승인 대기로 보고했습니다"')
    expect(p5).toContain('둘 다 원격 agent 브랜치까지 본다')
    expect(p5).toContain('현재 작업트리의 state.json 만 보므로')
  })
})

describe('/dflow-dev --worker 표지 블록(스펙 §6-3)', () => {
  const EXPECTED: { prev?: string; next?: string; tag: string }[] = [
    { prev: '인자: `$ARGUMENTS` (`<순번|TSK-ID>` + 옵션)', tag: '팀장 전용' },
    { prev: '## Phase 01-가 — 승인 스윕(머지, 오케스트레이터 본인)', tag: '「--worker」 A' },
    { prev: '   작업이라 스윕이 못 봤을 수 있다 — 그 경우 지금 즉시 같은 머지 절차를 이 ref 하나로 실행 후 종료).', tag: '「--worker」 C' },
    { prev: '       있다). 머지 후 이어서 진행.', tag: '「--worker」 B' },
    { prev: '          남긴다** — 서버가 못 막는 우회를 스킬이 최소한 드러낸다.', tag: '「--worker」 G' },
    { prev: '   `git branch --show-current` 가 `agent/` 로 시작하는지 확인하고, 아니면 중단한다.', tag: '「--worker」 H' },
    { prev: '기본 브랜치 반영 확인이 이 트레일러를 증거로 쓴다.', tag: '「--worker」 E' },
    { next: '## --only 옵션', tag: '## --worker 팀원 모드 (팀장 전용)' },
  ]
  const section = () => workerBlocks(skill).at(-1)?.body ?? ''

  it('표지는 짝이 맞고 여덟 블록이 정한 자리에 정한 순서로 있다', () => {
    const blocks = workerBlocks(skill)
    expect(blocks).toHaveLength(EXPECTED.length)
    EXPECTED.forEach((e, i) => {
      if (e.prev) expect(blocks[i].prev, e.tag).toBe(e.prev)
      if (e.next) expect(blocks[i].next, e.tag).toBe(e.next)
      expect(blocks[i].body, e.tag).toContain(e.tag)
    })
  })

  it('--worker 절이 행 A~H 와 핵심 규칙을 담는다', () => {
    const sec = section()
    for (const row of ['| A |', '| B |', '| C |', '| D |', '| E |', '| F |', '| G |', '| H |']) expect(sec, row).toContain(row)
    expect(sec).toContain('**팀장 전용, 사람이 직접 쓰지 않는다.**')
    expect(sec).toContain('기점을 그 `head_sha` 로 잡고')
    expect(sec).toContain('branch_base')
    expect(sec).toContain('needs-merge approved')
    expect(sec).toContain('AskUserQuestion 을 쓰지 않는다')
    expect(sec).toContain('command -v git')
    expect(sec).toContain('`skipped 선행 미승인`')
    expect(sec).toContain('`skipped 선행 승인 대기`')
    expect(sec).toContain('행 A·B·C 뿐')
    expect(sec).toContain('위 여덟 행')
    expect(sec).toContain('.claude/skills/dflow-team/references/worker-prompt.md')
  })

  it('행 H: 생성 또는 재개로 agent 브랜치에 들어온 직후 lockfile 로 고른 관리자로 설치하고 실패하면 failed deps 다', () => {
    const sec = section()
    expect(sec).toContain('생성 또는 재개로 agent 브랜치에 들어온 직후, 4번 기준선과 Phase 02~05 게이트 전')
    expect(sec).toContain('npm ci')
    // 인라인 설치 블록은 21f5764f 에서 scripts/deps.sh 로 옮겼다. 같은 규칙을 그 스크립트에서 본다
    // (npm 경로의 실행 검사는 tests/skills/dflow-lead-worktree.test.ts).
    expect(sec).toContain('.claude/skills/dflow-dev/scripts/deps.sh')
    const deps = readFileSync(join(ROOT, '.claude/skills/dflow-dev/scripts/deps.sh'), 'utf8')
    expect(deps).toContain('[ -f package.json ] || {')
    expect(deps).toContain('[ -e node_modules ] && {')
    expect(deps).toContain('pnpm install --frozen-lockfile')
    expect(deps).toContain('yarn install --frozen-lockfile')
    expect(sec).toContain('failed deps')
    const h = workerBlocks(skill).find((b) => b.body.includes('「--worker」 H'))
    expect(h?.next).toBe('4. **게이트 기준선 기록**: dev-discipline 의 기준선 절차 실행, state.json 에 저장(`api_base` 가 아직 없으면 함께 기록한다. 상태 모델).')
  })

  it('--worker 절은 기본 브랜치를 switch 하지 않는다', () => {
    const sec = section()
    expect(sec).not.toBe('')
    expect(sec).not.toMatch(/git switch (<기본브랜치>|main)(\s|$)/m)
  })
})
