import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getComputedWbs } from '@/lib/data/wbs'
import { listProjects } from '@/app/actions/project'
import { buildWbsWorkbook } from '@/lib/excel/export'
import { buildWorkbookWithProfile } from '@/lib/excel/exportWithProfile'
import { activeTeamCodesSync } from '@/lib/teams/master'
import { seoulToday } from '@/lib/domain/dates'
import { getProjectConfig } from '@/lib/data/projectConfig'
import { validateProfile, LEGACY_DCUBE_PROFILE } from '@/lib/excel/profile'

// 현재 WBS를 xlsx로 내보낸다(읽기 전용 — 로그인 사용자 누구나). 임포트 포맷과 라운드트립.
export async function GET(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: '프로젝트 누락' }, { status: 400 })

  const [{ items, holidays }, projects] = await Promise.all([getComputedWbs(projectId), listProjects()])
  const project = (projects as { id: string; name: string }[]).find(p => p.id === projectId)
  const name = project?.name ?? 'WBS'

  // 기본 경로는 바이트 불변(D-CUBE 회귀 기준) — 절대 건드리지 않는다. `?expand=1` 일 때만 프로파일
  // 기반 신 경로(Task 7, §6.5)로 분기한다. 스펙 §6.5의 "기본값을 펼침으로"는 마법사(Task 8) 다운로드
  // 버튼에서 구현하고, 이 구 버튼 경로는 운영 산출물 급변을 막기 위해 접기를 유지한다 — 브리프가 명시한
  // 절충이며 스펙 문면과의 편차는 최종 리뷰 의제로 남긴다.
  const expand = req.nextUrl.searchParams.get('expand') === '1'
  let buf: ArrayBuffer
  if (expand) {
    let profile = LEGACY_DCUBE_PROFILE
    let config: Awaited<ReturnType<typeof getProjectConfig>>
    try {
      config = await getProjectConfig(projectId)
    } catch (e) {
      // 3원칙 — 조회 실패를 LEGACY 폴백으로 위장하지 않는다(import/inspect 라우트와 동일 관례).
      console.error('[export] 프로젝트 설정 조회 실패:', e)
      const message = e instanceof Error ? e.message : '프로젝트 설정을 확인할 수 없습니다'
      return NextResponse.json({ error: message }, { status: 500 })
    }
    // '{}' = 저장된 프로파일 없음(정상) → LEGACY_DCUBE_PROFILE. 검증 실패(손상)는 조회 실패와 달리
    // 읽기 전용 다운로드에는 사용자에게 알릴 채널이 없어(바이너리 응답) 로깅으로 표시하고 LEGACY 로
    // fail-open 한다(쓰기 경로가 아니라 운영 데이터 훼손 위험은 없다).
    if (Object.keys(config.excelProfile).length > 0) {
      const validated = validateProfile(config.excelProfile)
      if (validated.ok) profile = validated.profile
      else console.error('[export] 저장된 프로파일이 손상됨 — LEGACY_DCUBE_PROFILE 로 폴백:', validated.error)
    }
    const built = buildWorkbookWithProfile(
      items, profile, holidays.map(d => ({ date: d, name: '' })), { expandSubActs: true }, name,
    )
    // outline+펼침처럼 명시적으로 미지원인 조합 — 무증상 오파싱 대신 400 으로 정직하게 알린다.
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 })
    buf = built.buffer
  } else {
    buf = buildWbsWorkbook(items, holidays.map(d => ({ date: d, name: '' })), name, activeTeamCodesSync())
  }
  const today = seoulToday()
  const filename = `WBS_${name}_${today}.xlsx`.replace(/[^\w가-힣.\-]+/g, '_')

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="wbs_export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  })
}
