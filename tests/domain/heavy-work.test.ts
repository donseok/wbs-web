// tests/domain/heavy-work.test.ts — 무거운 작업 표시(docs/superpowers/specs/2026-09-26-heavy-work-office-bubble-design.md)
import { describe, expect, it } from 'vitest'
import { heavyGauge, heavyLabel, parseHeavyReport, seatHeavyOf } from '@/lib/domain/heavyWork'

describe('heavyLabel — 명령을 사람 말로', () => {
  const cases: Array<[string, string, 'run' | 'hold']> = [
    ['hold e2e', 'E2E 서버', 'hold'],
    ['npx stryker run', '변이 검증', 'run'],
    ['./gradlew pitest', '변이 검증', 'run'],
    ['node scripts/mutation-sweep.mjs', '변이 검증', 'run'],
    ['./gradlew mssqlMigrationTest', 'MSSQL 마이그레이션 시험', 'run'],
    ['npx playwright test', 'E2E 스모크', 'run'],
    ['npm run smoke:prod', 'E2E 스모크', 'run'],
    ['npm ci', '의존성 설치', 'run'],
    ['pnpm install --frozen-lockfile', '의존성 설치', 'run'],
    ['./gradlew build --refresh-dependencies', '의존성 설치', 'run'],
    ['./gradlew testAll -x mssqlMigrationTest', '전체 테스트', 'run'],
    ['npm run test', '전체 테스트', 'run'],
    ['npx vitest run', '전체 테스트', 'run'],
    ['./gradlew :core:test --tests FooTest', '테스트 실행', 'run'],
    ['npx vitest related src/a.ts --run', '테스트 실행', 'run'],
    ['./gradlew build', 'Gradle 빌드', 'run'],
    ['./gradlew assemble', 'Gradle 빌드', 'run'],
    ['mvn -q package', 'Maven 빌드', 'run'],
    ['npm run build', '빌드', 'run'],
    ['npx tsc --noEmit', '빌드', 'run'],
    ['docker compose up -d', '도커 작업', 'run'],
    ['python train.py', '무거운 명령', 'run'],
    ['', '무거운 명령', 'run'],
  ]
  for (const [cmd, want, kind] of cases) it(`${cmd || '(빈 명령)'} → ${want}`, () => expect(heavyLabel(cmd, kind)).toBe(want))
})

describe('parseHeavyReport — renew 본문의 heavy', () => {
  const order = { id8: 'abcdef12', state: 'run', kind: 'run', pool: 'general', since: 1790000000, pos: null, n: 1, cmd: 'npm test' }
  const pc = { k: 2, held: 1, waiting: 0, load: 3.5, cpus: 10 }
  it('형식이 맞으면 그대로', () => {
    expect(parseHeavyReport({ pc, orders: [order] })).toEqual({ ok: true, value: { pc, orders: [order] } })
  })
  it('PC 값은 null 을 허용한다(load·cpus 를 못 읽은 PC)', () => {
    const r = parseHeavyReport({ pc: { k: 2, held: 0, waiting: 0, load: null, cpus: null }, orders: [] })
    expect(r.ok).toBe(true)
  })
  it.each([
    ['id8 이 8자리 16진수가 아님', { pc, orders: [{ ...order, id8: 'ABCDEF12' }] }],
    ['state 가 모르는 값', { pc, orders: [{ ...order, state: 'sleep' }] }],
    ['cmd 가 200자 초과', { pc, orders: [{ ...order, cmd: 'x'.repeat(201) }] }],
    ['orders 가 50개 초과', { pc, orders: Array.from({ length: 51 }, () => order) }],
    ['pc 가 없음', { orders: [] }],
    ['음수 held', { pc: { ...pc, held: -1 }, orders: [] }],
    ['배열이 아님', { pc, orders: {} }],
  ])('%s → 거절', (_why, raw) => expect(parseHeavyReport(raw).ok).toBe(false))
})

describe('seatHeavyOf — 좌석에 보일 무거운 작업', () => {
  const U = '30f56117-f8d8-4f33-9d0a-d5b2fa0191dd', P = '11111111-1111-4111-8111-111111111111'
  const raw = { state: 'run', kind: 'run', pool: 'general', since: 1790000000, pos: null, n: 2, cmd: 'npm test', by: U }
  const live = [{ user_id: U, project_id: P }]
  it('claimed 이고 by 의 lease 가 살아 있으면 라벨·경과 기준·외 건수', () => {
    expect(seatHeavyOf(raw, { status: 'claimed', projectId: P }, live)).toEqual({
      state: 'run', label: '전체 테스트', cmd: 'npm test', sinceMs: 1790000000_000, pos: null, more: 1, docker: false,
    })
  })
  it('lease 가 죽었으면(팀장이 사라짐) null — 남은 값은 믿지 않는다', () => {
    expect(seatHeavyOf(raw, { status: 'claimed', projectId: P }, [])).toBeNull()
    expect(seatHeavyOf(raw, { status: 'claimed', projectId: P }, [{ user_id: U, project_id: 'other' }])).toBeNull()
  })
  it('claimed 가 아니면 null', () => {
    expect(seatHeavyOf(raw, { status: 'reported', projectId: P }, live)).toBeNull()
  })
  it('값이 없거나 깨졌으면 null', () => {
    expect(seatHeavyOf(null, { status: 'claimed', projectId: P }, live)).toBeNull()
    expect(seatHeavyOf({ ...raw, state: 'x' }, { status: 'claimed', projectId: P }, live)).toBeNull()
    expect(seatHeavyOf({ ...raw, by: 1 }, { status: 'claimed', projectId: P }, live)).toBeNull()
  })
  it('대기·도커', () => {
    const w = seatHeavyOf({ ...raw, state: 'wait', pos: 3, n: 1, pool: 'docker' }, { status: 'claimed', projectId: P }, live)
    expect(w).toEqual(expect.objectContaining({ state: 'wait', pos: 3, more: 0, docker: true }))
  })
})

describe('heavyGauge — 팀장 칩의 PC 부하', () => {
  it('슬롯·대기·load 를 한 줄로, 슬롯이 다 찼거나 load 가 코어 수를 넘으면 hot', () => {
    expect(heavyGauge({ k: 2, held: 2, waiting: 3, load: 7.14, cpus: 10 })).toEqual({ text: '🔥 2/2 · ⏳ 3 · load 7.1', hot: true })
    expect(heavyGauge({ k: 2, held: 1, waiting: 0, load: 12, cpus: 10 })).toEqual({ text: '🔥 1/2 · load 12', hot: true })
    expect(heavyGauge({ k: 2, held: 1, waiting: 0, load: 3, cpus: 10 })).toEqual({ text: '🔥 1/2 · load 3', hot: false })
  })
  it('아무것도 안 돌면 null(칩을 어지럽히지 않는다)', () => {
    expect(heavyGauge({ k: 2, held: 0, waiting: 0, load: 1.2, cpus: 10 })).toBeNull()
    expect(heavyGauge(null)).toBeNull()
    expect(heavyGauge({ nope: 1 })).toBeNull()
  })
})
