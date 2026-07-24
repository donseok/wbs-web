// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TeamsProvider, useTeamCodes, useTeams } from '@/components/app/TeamsProvider'
import type { Team } from '@/lib/domain/teams'

function Codes() {
  return <span>{useTeamCodes().join(',')}</span>
}
function Progress() {
  return <span>{useTeams().filter(t => t.progressVisible).map(t => t.code).join(',')}</span>
}

describe('TeamsProvider', () => {
  it('provider 없이는 DEFAULT 5팀(테스트 픽스처 호환)', () => {
    expect(renderToStaticMarkup(<Codes />)).toContain('PMO,ERP,MES,가공,MDM')
  })

  it('주입된 팀 목록을 정렬·활성 필터해 반환', () => {
    const teams: Team[] = [
      { id: '2', code: '신팀', sortOrder: 5, active: true, progressVisible: false },
      { id: '1', code: 'PMO', sortOrder: 0, active: true, progressVisible: true },
      { id: '3', code: '구팀', sortOrder: 9, active: false, progressVisible: true },
    ]
    expect(renderToStaticMarkup(<TeamsProvider teams={teams}><Codes /></TeamsProvider>))
      .toContain('PMO,신팀')
    expect(renderToStaticMarkup(<TeamsProvider teams={teams}><Progress /></TeamsProvider>))
      .toContain('>PMO<')
  })
})
