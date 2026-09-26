// tests/skills/dflow-dev-split.test.ts — /dflow-dev 스킬 문서 분할(안내 본문 + 단계 파일) 불변식.
// 설계: docs/superpowers/specs/2026-09-26-dflow-dev-skill-router-design.md §8·§9
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { devFiles, devOrch, devRouter, orchOrder, ROUTES, routeText } from './_dflow-dev'
import { firstLostLine, workerBlocks } from './_preserve'

const ROOT = process.cwd()
const DEV_DIR = join(ROOT, '.claude/skills/dflow-dev')
const presplit = readFileSync(join(ROOT, 'tests/skills/fixtures/dflow-dev.SKILL.presplit.md'), 'utf8').replace(/\n$/, '').split('\n')
const moveMap = readFileSync(join(ROOT, 'tests/skills/fixtures/dflow-dev.move-map.txt'), 'utf8')
  .split('\n').filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => {
    const m = l.match(/^(\d+)-(\d+) (\S+)$/)
    if (!m) throw new Error(`이동 지도 형식 오류: ${l}`)
    return { from: Number(m[1]), to: Number(m[2]), file: m[3] }
  })

/**
 * 분할 뒤 정리(중복 정본화·근거 이관·포인터 교체)로 지우거나 바꾼 분할 전 줄. 이 밖의 줄은 이동 지도의 대상 파일에
 * 같은 순서로 남아야 한다. 이 목록이 분할 뒤 무엇을 지웠는지의 감사 기록이다 — 줄마다 이유를 주석으로 단다.
 */
const CHANGED_SPLIT: readonly string[] = [
  // worker-mode.md 를 통째로 읽지 않고 절만 읽는다
  '> `--worker` 면 **지금 `.claude/skills/dflow-dev/references/worker-mode.md` 를 Read 한다** — 아홉 행과 워커 규칙이 그 파일에',
  '> 있고, 아래 절차가 행 A 부터 곧바로 가리킨다.',
  // 착수 때 dev-discipline 일괄 읽기를 없앤다(단계 지도 규율 열로)
  '> **시작할 때 읽는 것**: **`.claude/skills/dflow-dev/references/dev-discipline.md`** 의 「게이트 기준선」(「기준선 캐시」·',
  '> 「게이트 범위 대응표(.dflow-gates)」·「강제 재실행」·「게이트 기록」·「부하 민감 테스트(타이밍·성능)의 단독 재실행」·「research/docs 작업 특례」 포함)·「화면 작업의 브라우저 E2E」·「도커 사용 규칙」·「Phase 정의」·「Phase 05 — Refactor」·「모델 배정」·「무거운 명령 줄',
  '> 세우기」·「포그라운드 실행(백그라운드 게이트 금지)」·「공통 금지」 절을 읽고 그대로 따른다. 「공용 결정 기록(decisions.md)의',
  '> 번호」·「마이그레이션 버전」 은 그 일이 생길 때 읽는다. Phase 서브에이전트에게 주는 문구는 `references/phase-prompt.md` 다.',
  '> 규칙의 이유·사고 이력은 `references/rationale.md` 에 있다(실행 중에는 읽지 않는다).',
  // 게이트별 세부는 orch/design·build·verify 의 게이트 절이 정본이다
  '  전체 스위트는 **Build 게이트에서 한 번** 돈다. Verify·Refactor 게이트는 그 Phase 가 코드를 바꿨을 때만 다시 돌고,',
  '  아니면 Build 게이트 결과를 그대로 쓴다(아래 「Phase 종료마다」 1번). 게이트 명령은 `heavy.sh` 로 감싼다.',
  '  **리포에 게이트 대응표(`.dflow-gates`)가 있으면** Build 게이트는 이 Task 가 바꾼 모듈의 명령만 돌고, 전체 스위트는',
  '  Verify 게이트에서 한 번 돈다(dev-discipline 「게이트 범위 대응표(.dflow-gates)」). 대응표가 없으면 위 그대로다.',
  '  게이트를 돌릴 때마다 build-log.md `## 게이트 기록` 에 한 줄을 남긴다(dev-discipline 「게이트 기록」).',
  // 파일 분할로 상대 위치가 다른 파일이 됐다
  '  `model`(선택)은 **지금 도는 Phase 서브에이전트의 모델**이다(아래 Phase 02~05). heartbeat 훅이 서버로 실어 좌석표 명찰이',
  '   ready → 착수 가능 판정(2번) 후 claim / claimed → **반려 판정 먼저(아래), 아니면** 재개 판정(위 상태 모델) /',
  '   `origin/agent/<주문id8>-*`) tip 의 state.json 이 `phase=wait_pred` 면 claim·격리를 하지 않고 아래 「설계 선행」 3 으로 간다(반려',
  '   모듈 명령의 기준선은 여기서 재지 않고 Design 게이트 뒤에 잰다(아래 「Phase 종료마다」 1번).',
  '2. **Design 게이트 뒤**(Phase 02~05 「Phase 종료마다」 1번): `dflow.sh build-start <ref>` 의 결과로 가른다. 모드와 무관하게 늘 부른다.',
  '   6. 2 의 표대로 `build-start` 를 다시 부른다. exit 0 이면 「Phase 종료마다」 1번의 Design 게이트 뒤 모듈 기준선부터 이어 Build 로 간다.',
  '  세 번째 인계는 Build 실패다(아래 4번). 둘 다 아닌 보고는 opus 단위면 Build 실패이고, sonnet 단위면 아래 「승급」 이다.',
  '- 마지막 단위가 끝나면 Build 게이트를 돈다(아래 1번). Build 게이트 재시도(아래 4번)는 마지막 단위의 에이전트에 이어 붙인다.',
  '  Verify 실패 — 아래 4번). SendMessage 가 안 되면 sonnet 작성자를 새로 띄우고 `{AUDIT_FINDINGS}` 에 지적을 넣는다. 이 왕복은 Verify',
  '- Verify 재시도(아래 4번)는 작성자에게만 이어 붙이고 감사자는 다시 띄우지 않는다.',
  '1. 게이트 집행(위 원칙 — 직접 실행).',
  '   state.json `model`)은 위 「승급」 2·3 과 같다. 위 부하 민감 단독 재실행이 먼저다(통과하면 재시도도 승급도 없다). 마지막 단위',
  '   이미 끝나 있고 남은 작업이 없으면 위 「게이트 집행 원칙」대로 게이트를 오케스트레이터가 바로 직접',
  '   감사 셋의 보고를 받아 위 「Verify」 절차(지적 전달·최종 `PHASE_RESULT`)를 마친 뒤에 게이트를 돈다. 구현 단위가 여럿이면 마지막이 아닌 단위에서는',
]

describe('이동 지도(분할 전 SKILL.md → 안내 본문·단계 파일)', () => {
  it('분할 전 모든 줄이 정확히 한 범위에 속한다', () => {
    let next = 1
    for (const r of moveMap) {
      expect(r.from, `${r.from}-${r.to}`).toBe(next)
      expect(r.to).toBeGreaterThanOrEqual(r.from)
      next = r.to + 1
    }
    expect(next - 1).toBe(presplit.length)
  })

  it('각 범위의 줄이 대상 파일에 같은 순서로 남아 있다(CHANGED_SPLIT 제외)', () => {
    for (const r of moveMap) {
      const target = readFileSync(join(DEV_DIR, r.file), 'utf8')
      const range = presplit.slice(r.from - 1, r.to).join('\n')
      expect(firstLostLine(range, target, CHANGED_SPLIT), `${r.from}-${r.to} → ${r.file}`).toBeNull()
    }
  })

  it('CHANGED_SPLIT 줄은 분할 전 원문에 있고 지금 어느 파일에도 없다', () => {
    const now = Object.values(devFiles()).join('\n').split('\n')
    for (const l of CHANGED_SPLIT) {
      expect(presplit, l).toContain(l)
      expect(now, l).not.toContain(l)
    }
  })
})

describe('단계 지도와 단계 파일', () => {
  const router = devRouter()
  const order = orchOrder(router)

  it('fail-closed 순서의 파일과 orch 폴더의 파일이 같다', () => {
    const onDisk = readdirSync(join(DEV_DIR, 'references/orch')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
    expect([...order].sort()).toEqual([...onDisk].sort())
  })

  it('안내 본문과 단계 파일이 가리키는 orch/ 파일은 모두 있다', () => {
    for (const [name, text] of Object.entries(devFiles()))
      for (const m of text.matchAll(/`orch\/([a-z-]+)\.md`/g)) expect(existsSync(join(DEV_DIR, 'references/orch', `${m[1]}.md`)), `${name} → ${m[1]}`).toBe(true)
  })

  it('단계 지도의 모든 파일이 표에 나온다', () => {
    const table = router.split('## 단계 지도')[1]?.split('## 압축 뒤')[0] ?? ''
    for (const n of order) expect(table, n).toContain(`\`orch/${n}.md\``)
  })

  it('단계 파일마다 머리 안내와 「다음 단계」 가 있다', () => {
    for (const n of order) {
      const t = devOrch(n)
      expect(t, n).toMatch(/^# \/dflow-dev 단계 — /)
      expect(t, n).toContain('SKILL.md 「단계 지도」 가 가리킬 때 읽는다')
      expect(t, n).toContain('**다음 단계**:')
    }
  })

  it('압축 뒤 복구 규칙이 안내 본문에 있다', () => {
    expect(router).toContain('## 압축 뒤')
    expect(router).toContain('압축 요약의 기억으로 단계 절차를 대신하지 않는다')
  })

  it('caps 표식과 진입 표지 블록은 안내 본문에 남는다(팀장 precheck)', () => {
    expect(router).toMatch(/^<!-- dflow-caps: worker /m)
    expect(workerBlocks(router)[0].body).toContain('`--worker` 는 `/dflow-team` 팀장 전용 플래그다')
  })

  it('경로 텍스트: 각 경로가 자기 핵심 절차에 닿는다', () => {
    expect(routeText('manual')).toContain('## Phase 01-가 — 승인 스윕')
    expect(routeText('worker')).not.toContain('## Phase 01-가 — 승인 스윕')
    expect(routeText('resume')).toContain('3. **재개**(Phase 01 1번 「설계 선행 재개」)')
    expect(routeText('rework')).toContain('**재개가 아니라 재작업이다.**')
    for (const r of Object.keys(ROUTES) as (keyof typeof ROUTES)[]) expect(routeText(r), r).toContain('## Phase 06 — 마감')
  })
})

describe('규율 절 읽기(sections.sh)와 안내 본문 크기', () => {
  const SEC = join(DEV_DIR, 'scripts/sections.sh')
  const run = (...args: string[]) => {
    const r = spawnSync('bash', [SEC, ...args], { encoding: 'utf8' })
    return { code: r.status, out: r.stdout }
  }
  const tmp = mkdtempSync(join(tmpdir(), 'sections-'))
  const md = join(tmp, 'a.md')
  writeFileSync(md, ['# 문서', '머리', '## 가 절 (정본)', '가 본문', '```bash', '# 코드 속 주석', '```', '### 가 하위', '하위 본문', '## 나 절', '나 본문', ''].join('\n'))

  it('## 절은 딸린 ### 까지, = 를 붙이면 제목 본문만, 코드 펜스 속 # 은 제목이 아니다', () => {
    const a = run(md, '가 절')
    expect(a.code).toBe(0)
    expect(a.out).toContain('# 코드 속 주석')
    expect(a.out).toContain('하위 본문')
    expect(a.out).not.toContain('나 본문')
    const own = run(md, '=가 절')
    expect(own.out).toContain('가 본문')
    expect(own.out).not.toContain('하위 본문')
  })

  it('못 찾은 제목은 SECTION_MISSING 과 exit 3, 찾은 절은 그대로 낸다', () => {
    const r = run(md, '나 절', '없는 절')
    expect(r.code).toBe(3)
    expect(r.out).toContain('나 본문')
    expect(r.out).toContain('SECTION_MISSING 없는 절')
    expect(run('/no/such/file.md', '가').code).toBe(2)
  })

  it('단계 지도 규율 열과 조건부 절 이름은 dev-discipline.md 에서 모두 찾힌다', () => {
    const router = devRouter()
    const map = router.split('## 단계 지도')[1]?.split('## 압축 뒤')[0] ?? ''
    const names = [...map.matchAll(/\|([^|\n]*)\|\s*$/gm)].flatMap((m) => [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]))
      .concat([...(map.split('- 조건이 있는 절은')[1]?.split('- 이전 단계')[0] ?? '').matchAll(/(?:이면|면|더하면) `([^`]+)`/g)].map((m) => m[1]))
    expect(names.length).toBeGreaterThan(15)
    const disc = join(DEV_DIR, 'references/dev-discipline.md')
    for (const n of new Set(names)) expect(run(disc, n).code, n).toBe(0)
  })

  it('착수 때 dev-discipline 을 한꺼번에 읽게 하는 옛 지시가 없다', () => {
    for (const [name, text] of Object.entries(devFiles())) expect(text, name).not.toContain('시작할 때 읽는 것')
  })

  it('안내 본문은 9,000자를 넘지 않는다 — 넘으면 단계 파일로 옮긴다(09-25 에 줄였다가 하루 만에 다시 불었다)', () => {
    expect([...devRouter()].length).toBeLessThanOrEqual(9000)
  })
})
