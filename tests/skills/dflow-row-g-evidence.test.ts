// tests/skills/dflow-row-g-evidence.test.ts
// 2026-09-22 결함 고정: /dflow-dev 「--worker」 행 G 의 기본 브랜치 반영 확인이 트레일러 하나에만 기대던 것을
// head_sha 조상 확인 · 트레일러 · 머지 커밋 제목 세 증거로 넓히고, 트레일러 부착을 커밋 규칙으로 못 박은 변경.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd() // vitest 는 리포 루트에서 돈다(기존 tests/ 관례)
const dev = readFileSync(join(ROOT, '.claude/skills/dflow-dev/SKILL.md'), 'utf8')
const discipline = readFileSync(join(ROOT, '.claude/skills/dflow-dev/references/dev-discipline.md'), 'utf8')
const merge = readFileSync(join(ROOT, '.claude/skills/dflow-merge/SKILL.md'), 'utf8')

describe('행 G 기본 브랜치 반영 확인: head_sha 조상 확인을 첫 증거로 받아들인다', () => {
  it('head_sha 가 origin/<기본브랜치> 의 조상인지를 git merge-base --is-ancestor 로 본다', () => {
    expect(dev).toContain('git merge-base --is-ancestor <head_sha> origin/<기본브랜치>')
    expect(dev).toContain('증거 1')
  })

  it('트레일러(증거 2)·머지 커밋 제목(증거 3)도 여전히 본다', () => {
    expect(dev).toContain("git log origin/<기본브랜치> --grep='DFlow-Order: <그 order>' --format=%h")
    expect(dev).toContain('증거 2')
    expect(dev).toContain("git log origin/<기본브랜치> --merges --grep='^merge: <선행TSK> ' --format=%h")
    expect(dev).toContain('증거 3')
  })

  it('판정은 phase=merged AND (증거 중 하나) 이고, head_sha 가 가장 강한 증거라고 적는다', () => {
    expect(dev).toContain('판정은 `phase=merged` **AND** (아래 세 증거 중 하나라도 참) 이다')
    expect(dev).toContain('**첫 증거가 가장 강하다**')
    expect(dev).toContain('head_sha` 가 없으면 첫 증거는 판정 불가로 건너뛰고 나머지 둘로 본다')
  })

  it('공백 경고(2026-09-17)와 자동 머지의 unapproved 설명을 그대로 남긴다', () => {
    expect(dev).toContain('트레일러 패턴(증거 2)의 콜론 뒤 **공백을 반드시 넣고 따옴표로 감싼다.**')
    expect(dev).toContain('(2026-09-17 실측: 공백 없는 패턴 0 건, 공백 있는 패턴 2 건).')
    expect(dev).toContain('팀장의 자동 머지(`DFLOW_AUTOMERGE=1`)가 승인 전에 머지한 선행도 `phase` 는 `merged` 이고 `unapproved: true` 가')
    expect(dev).toContain('`unapproved` 는 이 판정에서 보지 않는다.')
  })

  it('넓히는 근거로 2026-09-22 mdm-dict-v2 실측(선행 4건 머지·트레일러 0건·후속 3건 막힘)을 남긴다', () => {
    expect(dev).toContain('2026-09-22 mdm-dict-v2 실측')
    expect(dev).toContain('TSK-03-07·03-09·03-11·03-12')
    expect(dev).toContain('TSK-03-10·03-13·04-01')
  })
})

describe('커밋 규칙: 모든 커밋에 DFlow-Order 트레일러를 붙인다', () => {
  it('dev-discipline.md 가 Design·Build·Verify·Refactor·Phase 06 전부에 트레일러 부착을 못 박는다', () => {
    expect(discipline).toContain('모든 커밋에 `--trailer "DFlow-Order: <주문 UUID>"` 를 붙인다')
    expect(discipline).toContain('워커·수동 경로 모두 예외 없다')
  })

  it('/dflow-dev SKILL.md 공통 프롬프트 절이 트레일러 규칙을 가리킨다', () => {
    expect(dev).toContain('모든 커밋에 `--trailer "DFlow-Order: <주문 UUID>"` 를 붙이는 것')
    expect(dev).toContain('Design·Build·Verify·Refactor·Phase 06 마감 커밋 전부')
  })

  it('/dflow-merge 의 자동 머지 커밋이 트레일러를 붙인다 — git merge 는 --trailer 를 모르므로 둘째 -m 을 쓴다', () => {
    expect(merge).toContain('git merge --no-ff <머지 대상> -m "merge: <TSK> <제목> (approved)" -m "DFlow-Order: <order>"')
    expect(merge).toContain('git merge 는 --trailer 를 모른다')
  })

  it('/dflow-merge 가 충돌을 손으로 풀어 커밋하는 경로에도 같은 트레일러를 요구한다(이 경로는 git commit --trailer)', () => {
    expect(merge).toContain('손으로 풀어 `git merge --abort` 대신 직접 `git commit` 으로 머지를 완성하는 경로')
    expect(merge).toContain('**트레일러 고정**')
    expect(merge).toContain('git commit --trailer')
    expect(merge).toContain('어느 경로든 결과 메시지에 이 트레일러가 실려야 하는 것은 같다')
  })
})
