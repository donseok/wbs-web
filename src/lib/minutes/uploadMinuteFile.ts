// 회의록 파일 1개 업로드 단위 — 브라우저에서만 돈다(Storage 직접 업로드).
//
// 파일 바이트를 서버 액션으로 넘기지 않는 이유: Next 서버 액션 본문 기본 상한 1MB 위에
// Vercel 요청 본문 상한 4.5MB 가 또 있다. 리포의 업로드 경로가 전부 같은 이유로
// '브라우저가 Storage 에 직접 + 서버는 메타만' 구조다.
//
// "경로 생성 → upload(upsert:false) → 메타 기록 → 실패 시 보상 remove" 가 이미 4벌
// (등록 모달·본문 교체·이슈 첨부·WBS 산출물) 있었다. 5벌째를 만들지 않으려고 뽑았다.
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordMinuteFile } from '@/app/actions/minutes'
import { sanitizeFileName } from '@/lib/domain/minutes'
import { errMsg } from '@/lib/domain/format'

const BUCKET = 'minutes'

export type UploadMinuteFileResult =
  | { ok: true; filePath: string }
  | {
      ok: false
      /** 'upload' = 객체가 올라가지 않았다(지울 것 없음) / 'record' = 올라갔고 보상 삭제를 마쳤다. */
      reason: 'upload' | 'record'
      error: string
    }

export interface UploadMinuteFileOptions {
  /** 경로 타임스탬프. 테스트가 고정할 수 있게 주입받는다. */
  now?: () => number
}

/**
 * 파일 하나를 올리고 메타까지 기록한다. 부분 성공을 남기지 않는 것이 이 함수의 계약이다 —
 * 메타 기록이 실패하면 방금 올린 객체를 지우고(고아 방지) 실패로 돌려준다.
 *
 * 업로드도 서버 액션도 결과 객체가 아니라 reject 로 실패할 수 있다(네트워크 단절·배포 교체).
 * 예외를 그대로 흘리면 호출부가 아무 표시 없이 끝나고 저장 버튼이 잠긴 채 남는다.
 */
export async function uploadMinuteFile(
  sb: SupabaseClient,
  minuteId: string,
  role: 'body' | 'attachment',
  file: File,
  opts: UploadMinuteFileOptions = {},
): Promise<UploadMinuteFileResult> {
  const now = opts.now ?? Date.now
  // 첫 세그먼트가 minuteId 라는 규약을 서버 액션(isMinuteFilePathValid)이 검증한다.
  const filePath = `${minuteId}/${now()}-${sanitizeFileName(file.name)}`

  let uploadErr: string | null = null
  try {
    // upsert:false — 같은 경로가 이미 있으면 덮어쓰지 않고 실패한다.
    const up = await sb.storage.from(BUCKET).upload(filePath, file, { upsert: false })
    uploadErr = up.error ? up.error.message : null
  } catch (cause) {
    uploadErr = errMsg(cause)
  }
  if (uploadErr !== null) return { ok: false, reason: 'upload', error: uploadErr }

  let recordErr: string | null = null
  try {
    const rec = await recordMinuteFile(minuteId, {
      role,
      fileName: file.name,   // 원본 이름은 여기에 남는다. 스토리지 키는 ASCII 로 뭉개진다.
      filePath,
      size: file.size,
      mime: file.type || 'application/octet-stream',
    })
    recordErr = rec.ok ? null : (rec.error ?? '')
  } catch (cause) {
    recordErr = errMsg(cause)
  }
  if (recordErr !== null) {
    // remove 는 멱등이고 반환값으로 성공을 판정할 수 없으므로 결과를 보지 않는다.
    try { await sb.storage.from(BUCKET).remove([filePath]) } catch { /* 고아만 남는다 */ }
    return { ok: false, reason: 'record', error: recordErr }
  }

  return { ok: true, filePath }
}
