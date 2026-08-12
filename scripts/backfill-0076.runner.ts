// 0076 폴더 백필 — 프로젝트 배정된 회의록의 기존 편철(대개 미지정/전역 트리)을
// 그 프로젝트 전용 트리로 이식한다. 일회성 운영 러너(wiki-rebuild.runner.ts 전례).
//
// 실행(dry-run):  BACKFILL_TARGET=staging npx vitest run --config scripts/backfill-0076.vitest.ts --reporter=verbose
// 실행(적용):     BACKFILL_TARGET=staging BACKFILL_APPLY=1 BACKFILL_ACTOR=<uuid> \
//                   npx vitest run --config scripts/backfill-0076.vitest.ts --reporter=verbose
// TARGET=prod 는 스테이징 검증 완료 후에만. 환경키는 .env.local.<target> 에서 읽는다.
//
// 실행 본체는 scripts/lib/backfill-0076-core.ts 로 옮겼다 — 이 파일은 env 로딩 + admin
// 클라이언트 생성만 하는 얇은 vitest 트리거다(fixture 로 core 를 직접 테스트하기 위함).
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { runBackfillPass } from './lib/backfill-0076-core'

function envOf(target: string): { url: string; key: string } {
  const envUrl = new URL(`../.env.local.${target}`, import.meta.url)
  let raw: string
  try {
    raw = readFileSync(envUrl, 'utf8')
  } catch (e) {
    // Task 9 리뷰 Important 3 — 원본 ENOENT 를 그대로 흘려보내지 않는다. env-swap.mjs
    // ("✗ .env.local.<target> 없음 — .env.local.example 을 참고해 만들고 값 채우기")와
    // 같은 스타일로, 어디를 봐야 하는지 경로까지 짚어 준다.
    throw new Error(
      `${envUrl.pathname} 파일이 없습니다 — .env.local.example 을 참고해 리포 루트에 `
      + `.env.local.${target} 을 만들고 값을 채우세요(npm run env:${target} 이 읽는 것과 같은 `
      + `파일입니다). 원본 에러: ${(e as Error).message}`,
    )
  }
  const pick = (k: string) => raw.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"(.*)"$/, '$1')
  const url = pick('NEXT_PUBLIC_SUPABASE_URL')
  const key = pick('SUPABASE_SERVICE_ROLE_KEY') ?? pick('SUPABASE_SERVICE_ROLE')
  if (!url || !key) {
    throw new Error(`${envUrl.pathname} 에서 NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY 를 찾지 못했습니다`)
  }
  return { url, key }
}

describe('0076 폴더 백필', () => {
  it('프로젝트 있는 회의록의 편철을 프로젝트 트리로 이식한다', async () => {
    const target = process.env.BACKFILL_TARGET
    if (!target) { console.log('BACKFILL_TARGET 미지정 — skip'); return }
    const apply = process.env.BACKFILL_APPLY === '1'
    // 브리핑 "주의" — literal 'backfill-0076' 는 uuid 가 아니라 auth.users FK(created_by) 위반.
    // dry-run(create:false) 은 폴더를 만들지 않으므로 actorId 가 실제로 쓰이지 않지만,
    // apply 에서만 필수로 강제해 dry-run 확인 없이 실 운영자 uuid 를 요구하지 않게 한다.
    const actorId = apply
      ? (process.env.BACKFILL_ACTOR ?? (() => { throw new Error('apply 모드에는 BACKFILL_ACTOR(uuid) 가 필요합니다') })())
      : 'dry-run-unused'
    const { url, key } = envOf(target)
    const admin = createClient(url, key, { auth: { persistSession: false } })

    const result = await runBackfillPass({ admin, target, apply, actorId })
    expect(result.log.length).toBe(result.moved + result.unfiled + result.kept)
  }, 120_000)
})
