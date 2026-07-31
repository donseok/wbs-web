import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAdmin } from '@/lib/authz'
import { detectWorkbook } from '@/lib/excel/detect'
import { validateProfile, type ExcelProfile } from '@/lib/excel/profile'
import { getProjectConfig } from '@/lib/data/projectConfig'
import { isUuidLike } from '@/lib/domain/agentWork'

/** 가드 실패 사유 → HTTP status. 기존 `/api/import` 의 매핑을 복제한다(원본 파일은 건드리지 않는다).
 *  조회 실패는 거부가 아니라 서버 사정이므로 500(재시도 가능). */
const AUTHZ_STATUS: Record<string, number> = { '로그인 필요': 401, '권한 없음': 403 }

/**
 * 임포트 마법사 1단계 — 업로드된 워크북을 감지만 하고 아무것도 쓰지 않는다(§6.2, DB 쓰기 0).
 * 판정 대상 프로젝트가 본문에 있어 폼을 먼저 읽는다 — 파싱·DB 접근은 가드 통과 후에만 한다.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const file = form.get('file') as File | null
  const projectId = String(form.get('projectId') ?? '')
  if (!file || !projectId) return NextResponse.json({ error: '파일/프로젝트 누락' }, { status: 400 })
  // agent-loop 교훈 — 비 UUID 를 그대로 흘리면 가드·쿼리가 엉뚱한 에러로 새어나간다. 가드보다 먼저 막는다.
  if (!isUuidLike(projectId)) {
    return NextResponse.json({ error: '프로젝트 식별자 형식이 올바르지 않습니다' }, { status: 400 })
  }

  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: AUTHZ_STATUS[g.error] ?? 500 })

  const detected = detectWorkbook(await file.arrayBuffer())
  if (!detected.ok) return NextResponse.json({ error: detected.error }, { status: 400 })

  let config: Awaited<ReturnType<typeof getProjectConfig>>
  try {
    config = await getProjectConfig(projectId)
  } catch (e) {
    // 3원칙 — 조회 실패를 기본값(savedProfile:null)으로 위장하지 않는다. 실제 사유를 그대로 알린다.
    console.error('[import/inspect] 프로젝트 설정 조회 실패:', e)
    const message = e instanceof Error ? e.message : '프로젝트 설정을 확인할 수 없습니다'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  // 감지 결과를 그대로 반환에 쓰되, warnings 는 아래서 덧붙일 수 있어 얕은 복제로 원본 배열을 보존한다.
  const detection = { ...detected.result, warnings: [...detected.result.warnings] }

  let savedProfile: ExcelProfile | null = null
  // '{}' 는 "저장된 프로파일 없음"이다 — 이 경우만 검증을 건너뛴다(정상 상태, 경고 아님).
  if (Object.keys(config.excelProfile).length > 0) {
    const validated = validateProfile(config.excelProfile)
    if (validated.ok) {
      savedProfile = validated.profile
    } else {
      // 검증 실패를 조용히 null 로만 넘기면 손상 사실이 묻힌다 — 침묵 무시 금지.
      detection.warnings.push('저장된 프로파일이 손상됨')
    }
  }

  return NextResponse.json({ ok: true, detection, savedProfile })
}
