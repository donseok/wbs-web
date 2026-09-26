import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * storage.objects RLS 정책의 정본과 staging:sync 의 재적용 계약.
 *
 * 2026-09-27 사고: 스테이징에서 첨부 업로드가
 * `new row violates row-level security policy for table "objects"` 로 전부 실패했다.
 * 실측하니 스테이징의 storage.objects 는 **RLS on + 정책 0건**(운영은 9건)이었다.
 * Postgres 는 RLS 가 켜져 있고 허용 정책이 없으면 전면 거부하므로, 회의록 본문 .md·회의록
 * 첨부·이슈 첨부·WBS 산출물까지 **모든 업로드가 원래 불가능**했다(스테이징 minutes 버킷
 * 객체 수 0 / 운영 26).
 *
 * 왜 사라지는가: `staging:sync` 는 `drop schema if exists public cascade` 로 public 을
 * 재생성한다. 9건 중 7건이 public 의 함수·테이블(can_attach·can_edit_issue·app_role·
 * minute_versions)을 참조하므로 **cascade 로 함께 삭제된다.** 한 번 복구해도 다음 sync 에서
 * 다시 사라진다 — 그래서 sync 가 끝날 때 반드시 재적용해야 한다.
 *
 * 이 테스트는 정책 정본 파일이 9건을 멱등하게 정의하는지, 그리고 sync 가 **public 재생성
 * 이후에** 그것을 재적용하는지를 못 박는다(순서가 뒤바뀌면 cascade 가 다시 지운다).
 */

const policies = readFileSync(
  new URL('../../supabase/storage-policies.sql', import.meta.url),
  'utf8',
)
const syncScript = readFileSync(
  new URL('../../scripts/staging-sync.mjs', import.meta.url),
  'utf8',
)

/** 운영 실측(2026-09-27)으로 확인된 9건 — 3버킷 × SELECT/INSERT/DELETE. */
const EXPECTED = [
  'deliverables read', 'deliverables insert', 'deliverables delete',
  'issue-attachments read', 'issue-attachments insert', 'issue-attachments delete',
  'minutes bucket read', 'minutes bucket insert', 'minutes bucket delete',
] as const

describe('storage.objects 정책 정본', () => {
  it.each(EXPECTED)('%s 정책을 storage.objects 에 만든다', name => {
    expect(policies).toContain(`create policy "${name}" on storage.objects`)
  })

  // SQL Editor·db:apply 반복 실행이 안전해야 한다(운영에 이미 있는 9건과 같은 정의다).
  it.each(EXPECTED)('%s 는 drop policy if exists 가 선행한다 — 멱등', name => {
    const drop = policies.indexOf(`drop policy if exists "${name}" on storage.objects`)
    const create = policies.indexOf(`create policy "${name}" on storage.objects`)
    expect(drop).toBeGreaterThanOrEqual(0)
    expect(create).toBeGreaterThan(drop)
  })

  // 업로드가 막혔던 지점 — 이 세 INSERT 정책이 없으면 브라우저 직접 업로드가 전부 거부된다.
  it('세 버킷 모두 INSERT 정책을 가진다', () => {
    for (const bucket of ['deliverables', 'issue-attachments', 'minutes']) {
      expect(policies).toMatch(new RegExp(`for insert[\\s\\S]{0,200}${bucket}`))
    }
  })

  it('authenticated 롤에만 부여한다 — anon 에게 열지 않는다', () => {
    expect(policies).toContain('to authenticated')
    expect(policies).not.toContain('to anon')
  })
})

describe('staging:sync 는 public 재생성 뒤 스토리지 정책을 되살린다', () => {
  it('정책 정본 파일을 적용한다', () => {
    expect(syncScript).toContain('storage-policies.sql')
  })

  // 순서가 핵심이다 — public 을 drop cascade 하기 전에 적용하면 그 cascade 가 다시 지운다.
  it('drop schema public cascade 보다 뒤에서 적용한다', () => {
    const dropCascade = syncScript.indexOf('drop schema if exists public cascade')
    const apply = syncScript.indexOf('storage-policies.sql')
    expect(dropCascade).toBeGreaterThanOrEqual(0)
    expect(apply).toBeGreaterThan(dropCascade)
  })

  // 정책이 참조하는 public 객체(can_attach 등)가 먼저 복원돼 있어야 create 가 성공한다.
  it('public 복원(pg_restore) 보다 뒤에서 적용한다', () => {
    const restore = syncScript.lastIndexOf("'pg_restore'")
    const apply = syncScript.indexOf('storage-policies.sql')
    expect(restore).toBeGreaterThanOrEqual(0)
    expect(apply).toBeGreaterThan(restore)
  })
})
