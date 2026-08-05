// 이슈 첨부 업로드 루프 — 브라우저에서만 돈다(createBrowserClient).
//
// 파일 바이트를 서버 액션으로 넘기지 않는 이유: Next 서버 액션 본문 기본 상한 1MB 위에
// Vercel 요청 본문 상한 4.5MB 가 또 있다. 리포의 기존 업로드 3곳이 전부 같은 이유로
// '브라우저가 Storage 에 직접 + 서버는 메타만' 구조다.
//
// 등록 폼(저장 성공 후 일괄)과 수정 폼(고르는 즉시)이 이 함수를 공유한다.
import { recordIssueAttachment } from '@/app/actions/issueAttachments'
import {
  isIssueAttachmentSizeAllowed,
  makeIssueAttachmentPath,
} from '@/lib/domain/issueAttachments'
import { createBrowserClient } from '@/lib/supabase/client'

const BUCKET = 'issue-attachments'

export type UploadResult =
  | { ok: true; doneCount: number }
  | {
      ok: false
      /** 여기까지는 성공했다. 재시도할 때 startAt 으로 그대로 넘기면 중복 업로드가 없다. */
      doneCount: number
      fileName: string
      reason: 'too-large' | 'upload' | 'record'
      error: string
    }

export interface UploadOptions {
  /** 재시도 시작 위치. 이전 실패의 doneCount 를 그대로 준다. */
  startAt?: number
  /** 성공한 개수를 보고한다 — 호출부가 ref 에 담아 재개 지점으로 쓴다. */
  onDone?: (doneCount: number) => void
  /** 경로 타임스탬프. 테스트가 고정할 수 있게 주입받는다. */
  now?: () => number
}

/**
 * 파일을 하나씩 순차로 올린다. 병렬로 하지 않는 이유는 둘이다 —
 * 부분 실패 지점을 특정할 수 있어야 재개가 가능하고, 경로 타임스탬프가 밀리초라
 * 동시 업로드는 같은 경로를 만들 여지가 생긴다(선례 MinuteUploadModal 도 순차다).
 */
export async function uploadIssueAttachments(
  issueId: string,
  files: readonly File[],
  opts: UploadOptions = {},
): Promise<UploadResult> {
  const nowFn = opts.now ?? Date.now
  const sb = createBrowserClient()
  let done = Math.max(0, opts.startAt ?? 0)

  for (let i = done; i < files.length; i++) {
    const f = files[i]!
    if (!isIssueAttachmentSizeAllowed(f.size)) {
      return { ok: false, doneCount: done, fileName: f.name, reason: 'too-large', error: '' }
    }

    const path = makeIssueAttachmentPath(issueId, f.name, nowFn())
    // upsert:false — 같은 경로가 이미 있으면 덮어쓰지 않고 실패한다(재시도 중복 방지의 마지막 방어선).
    const up = await sb.storage.from(BUCKET).upload(path, f, { upsert: false })
    if (up.error) {
      // 올라간 것이 없으므로 지울 것도 없다.
      return { ok: false, doneCount: done, fileName: f.name, reason: 'upload', error: up.error.message }
    }

    const rec = await recordIssueAttachment(issueId, {
      fileName: f.name,          // 원본 이름은 여기에 남는다. 스토리지 키는 ASCII 로 뭉개진다.
      filePath: path,
      size: f.size,
      mime: f.type || 'application/octet-stream',
    })
    if (!rec.ok) {
      // 메타 없는 객체를 남기지 않는다(보상). remove 는 멱등이라 실패해도 재실행이 안전하고,
      // 반환값으로 성공을 판정할 수 없으므로 결과를 보지 않는다.
      await sb.storage.from(BUCKET).remove([path])
      return { ok: false, doneCount: done, fileName: f.name, reason: 'record', error: rec.error ?? '' }
    }

    done = i + 1
    opts.onDone?.(done)
  }
  return { ok: true, doneCount: done }
}
