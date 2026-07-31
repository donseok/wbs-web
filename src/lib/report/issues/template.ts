import 'server-only'

import { open } from 'node:fs/promises'
import path from 'node:path'

export const ISSUE_ANALYSIS_TEMPLATE_RELATIVE_PATH =
  'src/lib/report/assets/issue-analysis-template.pptx'

export const ISSUE_ANALYSIS_TEMPLATE_PATH = path.join(
  process.cwd(),
  ISSUE_ANALYSIS_TEMPLATE_RELATIVE_PATH,
)

export type IssueAnalysisTemplateStatus = 'ready' | 'missing' | 'protected'
export type IssueAnalysisTemplateCode =
  | 'TEMPLATE_READY'
  | 'TEMPLATE_MISSING'
  | 'TEMPLATE_PROTECTED'

export interface IssueAnalysisTemplateDiagnostic {
  status: IssueAnalysisTemplateStatus
  code: IssueAnalysisTemplateCode
  message: string
  path: string
}

/** OOXML(PPTX/ZIP) 파일의 최소 매직 바이트 검사. */
export function hasZipHeader(header: Uint8Array): boolean {
  return header.length >= 4
    && header[0] === 0x50
    && header[1] === 0x4b
    && (
      (header[2] === 0x03 && header[3] === 0x04)
      || (header[2] === 0x05 && header[3] === 0x06)
      || (header[2] === 0x07 && header[3] === 0x08)
    )
}

/**
 * 실제 파일 IO 없이 헤더를 진단하는 순수 함수.
 *
 * Document Safer 같은 DRM 래퍼와 그 밖의 비-OOXML 파일은 렌더러가 안전하게 열 수
 * 없으므로 모두 protected 로 분류한다. 보호 해제된 정상 PPTX 를 자산 경로에 배치해야
 * 자동 작성 기능을 활성화할 수 있다.
 */
export function classifyIssueAnalysisTemplateHeader(
  header: Uint8Array | null,
  filePath = ISSUE_ANALYSIS_TEMPLATE_PATH,
): IssueAnalysisTemplateDiagnostic {
  if (header === null) {
    return {
      status: 'missing',
      code: 'TEMPLATE_MISSING',
      message: `이슈 분석서 템플릿이 없습니다: ${ISSUE_ANALYSIS_TEMPLATE_RELATIVE_PATH}`,
      path: filePath,
    }
  }
  if (!hasZipHeader(header)) {
    return {
      status: 'protected',
      code: 'TEMPLATE_PROTECTED',
      message: '이슈 분석서 템플릿이 DRM으로 보호되었거나 유효한 PPTX(OOXML)가 아닙니다. 보호 해제된 원본이 필요합니다.',
      path: filePath,
    }
  }
  return {
    status: 'ready',
    code: 'TEMPLATE_READY',
    message: '이슈 분석서 템플릿을 사용할 수 있습니다.',
    path: filePath,
  }
}

/** 예상 런타임 경로의 템플릿 존재 여부와 OOXML 헤더를 명시적으로 진단한다. */
export async function diagnoseIssueAnalysisTemplate(
  filePath = ISSUE_ANALYSIS_TEMPLATE_PATH,
): Promise<IssueAnalysisTemplateDiagnostic> {
  let handle
  try {
    handle = await open(filePath, 'r')
    const buffer = Buffer.alloc(32)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return classifyIssueAnalysisTemplateHeader(buffer.subarray(0, bytesRead), filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return classifyIssueAnalysisTemplateHeader(null, filePath)
    }
    throw error
  } finally {
    await handle?.close()
  }
}
