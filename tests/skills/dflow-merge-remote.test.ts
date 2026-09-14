// tests/skills/dflow-merge-remote.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { firstLostLine, parseFixture } from './_preserve'

// fixture 갱신 절차
// 1. fixture 는 `git show <sha>:<경로>` 로 뜬 수정 전 원문이며, 첫 줄 머리 주석에 그 sha 와 경로가 있다.
//    손으로 쓰거나 고치지 않는다. 뜨는 명령은 계획서 Task 2 Step 1 이다.
// 2. 머지 직전(계획서 Task 10)에는 `git log --oneline <sha>..<머지 대상 브랜치 머지 전 tip> -- <경로>` 로
//    원문이 바뀌었는지 본다. 바뀌었으면 그 tip 의 원문으로 fixture 를 다시 떠서(머리 주석 sha 도 그 tip) 이
//    테스트를 돌리고 커밋한다. 옛 fixture 로는 머지 충돌을 한쪽으로 풀다 잃은 다른 세션의 수정을 잡지 못한다.
// 3. 머지 뒤 누가 이 스킬 원문을 고치면 이 테스트가 빨개진다. 의도다. 고치는 사람이 그 원문 줄을
//    CHANGED 에 이유 주석과 함께 더하고 스펙 §6-1 수정 목록도 갱신해 변경을 기록한다.

const ROOT = process.cwd() // vitest 는 리포 루트에서 돈다(기존 tests/ 관례)
const skill = readFileSync(join(ROOT, '.claude/skills/dflow-merge/SKILL.md'), 'utf8')
const orig = parseFixture(readFileSync(join(ROOT, 'tests/skills/fixtures/dflow-merge.SKILL.orig.md'), 'utf8')).text

/** 스펙 §6-1 수정 목록으로 의도적으로 바꾸는 원문 줄. 이 밖의 원문 줄은 같은 순서로 남아야 한다. */
const CHANGED = [
  // 1. 인자 설명: 원격 후보를 포함한다
  '인자: `$ARGUMENTS` (선택 — ref 목록. 없으면 로컬 reported 전체가 후보)',
  // 2. 후보 식별(1번): 원격 후보·api_base 필터·전체 UUID 조회·show jq 축약
  '   인 작업 전부. 각각 `dflow.sh show <ref>` 로 서버 상태 확인.',
  // 3. 판정 보고(2번): 승인 대기·반려·건너뜀 갈래
  '2. **판정 — approved 만 진행**: `status=approved` 가 아니면 건너뛰고 "승인 대기"로 보고.',
  // 6. 순서(3번): 스택 판정을 브랜치 tip 이 아니라 state.json branch_base 로
  '3. **순서 — 스택은 조상 먼저**: 대상이 여럿이면 `git merge-base --is-ancestor A B` 로 조상',
  // 4. 머지(4번): 머지 대상, 충돌 되돌림, merged 커밋을 push 전에(5번에서 옮겨 온다), push 실패 되돌림
  '   git merge --no-ff agent/<id8>-<slug> -m "merge: <TSK> <제목> (approved)"',
  '   - state.json `phase=merged` 갱신 → 기본브랜치에 커밋(파일명 명시).',
  // 4. 머지(4번): 훅 거부는 스윕 전체가 아니라 그 작업(과 후손)만 멈춘다
  '   우회 금지, 중단·보고.',
  // 5. 뒷정리(5번): 로컬 브랜치 삭제의 not found·checked out 건너뛰기
  '   - 머지된 `agent/` 브랜치 삭제(로컬 + 원격). 아직 미승인 후손 스택 브랜치는 **삭제·rebase',
  // 3. 판정 보고(6번): 갈래별 목록
  '6. **보고**: 머지된 목록 / 승인 대기로 남은 목록 / 건너뛴 목록(사유)을 표로.',
] as const

describe('/dflow-merge 원문 보존(스펙 §6-1)', () => {
  it('CHANGED 밖의 원문 줄은 같은 순서로 남아 있다', () => {
    expect(firstLostLine(orig, skill, CHANGED)).toBeNull()
  })

  it('CHANGED 줄은 fixture 에 정확히 한 번씩 있다(fixture 가 낡지 않았다)', () => {
    const lines = orig.split('\n')
    for (const l of CHANGED) expect(lines.filter((x) => x === l).length, l).toBe(1)
  })

  it('CHANGED 줄은 현재 파일에 남아 있지 않다(목록이 실제 수정과 일치한다)', () => {
    const lines = skill.split('\n')
    for (const l of CHANGED) expect(lines, l).not.toContain(l)
  })
})

describe('/dflow-merge 수정(스펙 §6-4)', () => {
  it('원격 후보: origin/agent/* 의 state.json 을 git diff 로 찾아 git show 로 읽고 merged 가 아니면 후보다', () => {
    expect(skill).toContain("git branch -r --list 'origin/agent/*'") // 팀장 전제 검사가 grep 하는 바이트열 포함
    expect(skill).toContain("`git diff --name-only origin/<기본브랜치>...<ref> -- 'docs/tasks/*/state.json'`")
    expect(skill).toContain('`git show <ref>:<경로>`')
    expect(skill).toContain('`git show` 에는 glob 을 쓰지 않는다')
    expect(skill).toContain('**`phase` 가 `merged` 가 아니면\n     전부 후보**')
    expect(skill).toContain('`origin/agent/<id8>-<slug>`')
  })

  it('같은 order 는 로컬 후보로 합친 뒤 api_base 가 다르면 로컬이든 원격이든 건너뛰고, 원격은 값이 없어도 건너뛰며, 값 없는 로컬만 지금처럼 판정한다', () => {
    expect(skill).toContain('같은 order 가 로컬과 원격에 모두 있으면 로컬 후보 하나로 합쳐 로컬 규칙으로')
    expect(skill).toContain('`api_base` 는 값이 있는 쪽을 쓰고')
    expect(skill).toContain('증적 head_sha 를 포함하는 쪽')
    expect(skill).toContain('순서는 중복 제거 → `api_base` 필터다')
    expect(skill).toContain('[$ref, .tsk, .order, .phase, (if (.api_base // "") == "" then "none"') // 원격 스캔도 값 없음을 가른다
    expect(skill).toContain('`api_base` 가 현재 `DFLOW_API_BASE`(끝 `/` 제거)와 다르면')
    expect(skill).toContain('로컬이든 원격이든 "건너뜀(다른 D\'Flow)" 로 보고한다')
    expect(skill).toContain('원격 후보는 값이 없어도 건너뛴다')
    expect(skill).toContain('값이 없는 로컬 후보')
    expect(skill).not.toContain('필터를 걸지 않는다')
  })

  it('show 는 전체 UUID 로 부르고 jq 로 status 와 마지막 completion 리포트(증적 head_sha 포함)만 뽑는다', () => {
    expect(skill).toContain('서버 조회는 state.json 의 전체 UUID 로 한다')
    expect(skill).toContain('.order.status')
    expect(skill).toContain('select(.kind == "completion")')
    expect(skill).toContain('head_sha: .evidence.head_sha')
  })

  it('판정 보고는 승인 대기·반려·서버 상태·조회 실패를 가르고 반려는 state.json 을 고치지 않는다', () => {
    expect(skill).toContain('"반려: 재작업 필요 (<review_note>)"')
    expect(skill).toContain('`review_action=reject`')
    expect(skill).toContain('반려는 로컬 후보도 state.json 을 고치지 않고 보고만 한다')
    expect(skill).toContain('`status=reported`: "승인 대기"')
    expect(skill).toContain('"건너뜀(서버 <status>)"')
    expect(skill).toContain('404(dflow.sh exit 7)')
    expect(skill).toContain('"건너뜀(조회 실패)"')
  })

  it('순서는 branch_base 와 차분 백스톱으로, 승인 뒤 변경과 확인 불가는 건너뛰고, 충돌은 merge --abort, merged 커밋은 push 전에, push 실패는 reset --keep 뒤 경합·훅으로 가른다', () => {
    expect(skill).toContain('후보 state.json 의 `branch_base` 로 조상')
    expect(skill).toContain('`git merge-base --is-ancestor <branch_base> <그 후보의 머지 대상>`')
    expect(skill).toContain('"건너뜀(기점 미반영)"')
    expect(skill).toContain("`git diff --name-only origin/<기본브랜치>...<그 후보의 머지 대상> -- 'docs/tasks/*/state.json'`")
    expect(skill).toContain('그 작업 외의 state.json 이 있으면')
    expect(skill).toContain('git diff --name-only <증적 head_sha>..<머지 대상>')
    expect(skill).toContain('git merge-base --is-ancestor <증적 head_sha> <머지 대상>')
    expect(skill).toContain('"건너뜀(승인 뒤 변경)"')
    expect(skill).toContain('"건너뜀(승인 뒤 변경 확인 불가)"')
    expect(skill).toContain('`git merge --abort`')
    expect(skill).toContain('"머지 실패(충돌)"')
    expect(skill).toContain('이 커밋을 **push 전에**')
    expect(skill).toContain('`git reset --keep <기록한 HEAD>`')
    expect(skill).toContain('`non-fast-forward` 나 `fetch first`')
    expect(skill).toContain('"push 실패(경합)"')
    expect(skill).toContain('"push 실패(훅)"')
    expect(skill).toContain('그 작업과 그 후손')
    expect(skill).not.toContain('훅에 거부되든 경합으로 거부되든')
    expect(skill).toContain('`origin` 으로 리셋하지 않는다')
    expect(skill).toMatch(/git merge --no-ff <머지 대상>[\s\S]*git add docs\/tasks\/<TSK>\/state\.json[\s\S]*\n {3}git push origin <기본브랜치>\n/)
  })

  it('뒷정리: 로컬 브랜치가 없거나 다른 워크트리가 잡고 있으면 건너뛰고 보고한다', () => {
    expect(skill).toContain('(not found)')
    expect(skill).toContain('(checked out)')
    expect(skill).toContain('건너뛰고 보고한다')
  })
})
