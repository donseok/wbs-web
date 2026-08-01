'use client'

import { ProjectMemberMultiPicker } from '@/components/members/MemberPicker'
import type { ProjectMember } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'

export function MeetingAttendeePicker({
  members, selected, onChange,
}: {
  members: ProjectMember[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const { t } = useLocale()

  return (
    <ProjectMemberMultiPicker
      members={members}
      selected={selected}
      onChange={onChange}
      searchPlaceholder={t('meet.attendeeSearch')}
      selectedSuffix={t('meet.attendeeSelected')}
      missingEmailWarning={t('meet.form.noEmailWarn')}
    />
  )
}
