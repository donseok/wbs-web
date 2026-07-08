import { notFound } from 'next/navigation'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getMinutesDetail } from '@/lib/data/minutes'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { MarkdownView } from '@/components/minutes/MarkdownView'
import { MinutesReader } from '@/components/minutes/MinutesReader'

export default async function MinutesDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; minutesId: string }>
}) {
  const { projectId, minutesId } = await params
  const [minutes, locale] = await Promise.all([getMinutesDetail(minutesId), getServerLocale()])
  // 다른 프로젝트의 회의록 id 로 들어오는 URL 위조를 막는다. (RLS 는 프로젝트 경계를 보지 않는다 —
  // read_all_minutes 는 인증만 확인하므로, 경로의 projectId 와 행의 project_id 일치는 여기서 강제한다.)
  if (!minutes || minutes.projectId !== projectId) notFound()

  // has_md 는 `content_md is not null` 로 생성되는 컬럼이다(0020_meeting_minutes.sql:60).
  // 따라서 hasMd 를 따로 보지 않고 contentMd 하나만 본다 — 두 값이 어긋날 수 없고, 이 쪽만
  // 타입 좁히기가 된다. 챗 라우트도 정확히 같은 조건(contentMd === null → 400)으로 막는다.
  const { contentMd } = minutes

  return (
    <ProjectPageShell
      hero={
        <PageHero
          eyebrow="MINUTES"
          badge={<HeroBadge>{minutes.teamCode}</HeroBadge>}
          title={minutes.title}
          description={`${minutes.minutesDate} · ${minutes.createdByName ?? '—'}`}
        />
      }
    >
      {/*
       * MarkdownView 는 서버 컴포넌트다. 여기서 엘리먼트로 만들어 클라이언트 셸(MinutesReader)에
       * prop 으로 넘긴다 — 클라이언트가 `import { MarkdownView }` 하는 순간(혹은 next/dynamic 으로
       * 감싸는 순간) react-markdown + remark-gfm 파서 전체가 브라우저 번들로 끌려 내려간다.
       * RSC 페이로드로 넘기면 파서는 서버에만 남고 브라우저는 렌더 결과만 받는다.
       */}
      <MinutesReader
        projectId={projectId}
        minutesId={minutes.id}
        markdown={contentMd === null ? null : <MarkdownView content={contentMd} />}
        emptyTitle={t(locale, 'min.noPreview.title')}
        emptyDesc={t(locale, 'min.noPreview.desc')}
      />
    </ProjectPageShell>
  )
}
