import { describe, expect, it } from 'vitest'

// 0076 백필 러너의 per-minute 판정만 떼어 검사한다(scripts/backfill-0076.runner.ts 자체는 실
// DB 를 부르므로 import 하지 않는다 — wiki-rebuild-loop.test.ts 와 같은 관례).
import { buildFolderSnapshot } from '@/lib/minutes/folders'
import { decideBackfillAction } from '../../scripts/lib/backfill-0076-decide'

const PROJECT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PROJECT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

// 미지정(전역) 트리: PMO 루트 → 품질 하위.
// 프로젝트 A 트리: PMO 루트만 존재(하위 없음) — resolve 대상이 이 밑에 새로 생겨야 한다.
const snap = buildFolderSnapshot([
  { id: 'root-global-pmo', name: 'PMO', parentId: null, createdBy: null, projectId: null },
  { id: 'child-global-quality', name: '품질', parentId: 'root-global-pmo', createdBy: null, projectId: null },
  { id: 'root-a-pmo', name: 'PMO', parentId: null, createdBy: null, projectId: PROJECT_A },
  { id: 'child-a-quality', name: '품질', parentId: 'root-a-pmo', createdBy: null, projectId: PROJECT_A },
])

describe('decideBackfillAction', () => {
  it('폴더가 없는 회의록은 kept — 미분류를 그대로 둔다', () => {
    const got = decideBackfillAction(snap, { id: 'm1', projectId: PROJECT_A, folderId: null })
    expect(got).toEqual({ action: 'kept' })
  })

  it('폴더가 이미 목표 프로젝트 소속이면 kept — 재실행 멱등', () => {
    const got = decideBackfillAction(
      snap, { id: 'm2', projectId: PROJECT_A, folderId: 'child-a-quality' },
    )
    expect(got).toEqual({ action: 'kept' })
  })

  it('전역 트리에 편철된 회의록은 그 경로를 resolve 대상으로 낸다', () => {
    const got = decideBackfillAction(
      snap, { id: 'm3', projectId: PROJECT_A, folderId: 'child-global-quality' },
    )
    expect(got).toEqual({ action: 'resolve', path: ['PMO', '품질'] })
  })

  it('다른 프로젝트 트리에 편철돼 있으면(재소속 후) 새 프로젝트 경로로 resolve 한다', () => {
    const got = decideBackfillAction(
      snap, { id: 'm4', projectId: PROJECT_B, folderId: 'child-a-quality' },
    )
    expect(got).toEqual({ action: 'resolve', path: ['PMO', '품질'] })
  })

  it('끊긴 체인(스냅샷에 없는 folder_id)은 unfiled — 추측하지 않는다', () => {
    const got = decideBackfillAction(
      snap, { id: 'm5', projectId: PROJECT_A, folderId: 'ghost-folder-id' },
    )
    expect(got).toEqual({ action: 'unfiled' })
  })
})
