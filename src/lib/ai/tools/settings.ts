import { settingsHref } from '@/lib/ai/chat/deep-links'
import type { ProjectSettingsRepository } from '@/lib/repositories/types'
import {
  checkProjectAccess,
  invalidArgument,
  isRecord,
  readRequiredString,
  repositoryFailure,
  repositoryScopeViolation,
  todayInSeoul,
} from './common'
import type { BotSource, ReadOnlyBotTool } from './types'

const SETTINGS_CAPABILITY = 'settings:read' as const
const HOLIDAY_RECORD_LIMIT = 20

export interface ProjectSettingsHolidayRecord {
  date: string
}

/** 색인 상태는 부가 정보 — 실패해도 설정 답변 자체를 막지 않는다. */
export type IndexStatusProbe = (
  projectId: string,
) => Promise<{ freshness: string; indexed: number } | null>

/** 공휴일 레코드는 오늘 기준 향후 일자 우선, 모자라면 최근 과거로 보충해 상위 20개만 노출한다. */
function selectHolidays(holidays: readonly string[], today: string): string[] {
  const upcoming = holidays.filter(date => date >= today).sort()
  const recentPast = holidays.filter(date => date < today).sort().reverse()
  const selected = upcoming.slice(0, HOLIDAY_RECORD_LIMIT)
  for (const date of recentPast) {
    if (selected.length >= HOLIDAY_RECORD_LIMIT) break
    selected.push(date)
  }
  return selected.sort()
}

// indexStatus 주입 지점: default-registry 배선(오케스트레이터 소유)에서
// src/lib/ai/index의 색인 최신성 조회를 이 파라미터로 넘긴다. 미주입이면 색인 facts는 생략된다.
export function createGetSafeProjectSettingsTool(
  repository: ProjectSettingsRepository,
  indexStatus?: IndexStatusProbe,
): ReadOnlyBotTool<ProjectSettingsHolidayRecord> {
  return {
    name: 'get_safe_project_settings',
    requiredCapability: SETTINGS_CAPABILITY,
    async execute(args, context) {
      if (!isRecord(args)) return invalidArgument()
      const projectId = readRequiredString(args.projectId)
      if (!projectId) return invalidArgument()
      const denied = checkProjectAccess(context, projectId, SETTINGS_CAPABILITY)
      if (denied) return denied

      const repoResult = await repository.getSafeSettings(projectId)
      if (!repoResult.ok) return repositoryFailure(repoResult)
      if (!repoResult.data) {
        return {
          ok: true,
          result: {
            status: 'ok',
            facts: { projectFound: false },
            records: [],
            sources: [],
            asOf: context.now,
            truncated: false,
            warnings: [],
          },
        }
      }
      const snapshot = repoResult.data
      if (snapshot.projectId !== projectId) return repositoryScopeViolation()

      const indexInfo = indexStatus
        ? await indexStatus(projectId).catch(() => null)
        : undefined

      const facts: Record<string, string | number | boolean | null> = {
        projectFound: true,
        // 'name'은 WBS 라벨('작업명')이 선점 — 기존 projectName('프로젝트') 키를 재사용한다.
        projectName: snapshot.name,
        startDate: snapshot.startDate,
        endDate: snapshot.endDate,
        baseDate: snapshot.baseDate,
        holidayCount: snapshot.holidays.length,
        wbsItemCount: snapshot.wbsItemCount,
        memberCount: snapshot.memberCount,
      }
      if (indexInfo) {
        facts.indexFreshness = indexInfo.freshness
        facts.indexedDocuments = indexInfo.indexed
      }

      const today = todayInSeoul(context.now)
      const records: ProjectSettingsHolidayRecord[] = selectHolidays(snapshot.holidays, today)
        .map(date => ({ date }))
      const truncated = snapshot.holidays.length > records.length

      const sources: BotSource[] = [{
        id: `settings:${projectId}`,
        domain: 'settings',
        entityType: 'project',
        entityId: projectId,
        projectId,
        title: '프로젝트 설정',
        href: settingsHref(projectId),
        updatedAt: snapshot.updatedAt,
      }]
      const warnings: string[] = []
      if (truncated) {
        warnings.push(`공휴일 ${snapshot.holidays.length}건 중 ${records.length}건만 반환했습니다.`)
      }
      if (indexStatus && indexInfo === null) {
        warnings.push('색인 상태 정보를 확인할 수 없어 색인 관련 항목은 생략했습니다.')
      }

      return {
        ok: true,
        result: {
          status: truncated ? 'partial' : 'ok',
          facts,
          records,
          sources,
          asOf: context.now,
          truncated,
          warnings,
        },
      }
    },
  }
}
