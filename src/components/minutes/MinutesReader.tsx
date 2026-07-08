'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, FileWarning } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useToast } from '@/components/ui/Toast'
import { EmptyState } from '@/components/ui/EmptyState'
import { getMinutesFileUrl } from '@/app/actions/minutes'
import { MinutesChatPanel } from './MinutesChatPanel'

/**
 * 회의록 상세의 클라이언트 셸 — 툴바(다운로드)와 챗 패널만 담당한다.
 *
 * `markdown` 은 서버에서 이미 렌더된 <MarkdownView /> 엘리먼트다. 여기서 `./MarkdownView` 를
 * import 하면(next/dynamic 으로 감싸도 마찬가지다 — dynamic 은 클라이언트 청크를 만들 뿐
 * 모듈을 서버에 남기지 못한다) react-markdown + remark-gfm 이 브라우저 번들로 내려온다.
 * 그래서 엘리먼트를 prop 으로만 받는다. null 이면 비-md 업로드다.
 */
export function MinutesReader({
  projectId,
  minutesId,
  markdown,
  emptyTitle,
  emptyDesc,
}: {
  projectId: string
  minutesId: string
  markdown: ReactNode | null
  emptyTitle: string
  emptyDesc: string
}) {
  const { t } = useLocale()
  const { toast } = useToast()
  const [downloading, setDownloading] = useState(false)

  async function onDownload() {
    if (downloading) return
    setDownloading(true) // await 앞에서 잠근다 — 뒤에 두면 연타로 서명 URL 을 여러 장 발급한다.
    try {
      const { url } = await getMinutesFileUrl(minutesId)
      // getMinutesFileUrl 은 절대 throw 하지 않고 실패를 { url: null } 로 알린다.
      if (!url) {
        toast({ title: t('min.err.downloadFail'), variant: 'error' })
        return
      }
      // 반환값을 검사하지 말 것: 'noopener' 가 지정되면 명세상 window.open 은 성공해도 항상 null 을
      // 돌려준다(HTML §window.open). `if (!w) …` 류의 팝업차단 폴백은 매번 오발동한다.
      // MinutesView.onDownload 와 동일한 근거·동일한 처리.
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      toast({ title: t('min.err.downloadFail'), variant: 'error' })
    } finally {
      setDownloading(false)
    }
  }

  const toolbar = (
    <div className="flex items-center justify-between gap-3">
      <Link href={`/p/${projectId}/minutes`} className="btn btn-ghost h-9">
        <ArrowLeft className="h-4 w-4" /> {t('min.back')}
      </Link>
      <button className="btn btn-ghost h-9" onClick={onDownload} disabled={downloading}>
        <Download className="h-4 w-4" /> {t('min.download')}
      </button>
    </div>
  )

  // 비-md 업로드 — 뷰어도 챗도 열지 않는다(챗 라우트는 content_md 없이 400 을 낸다).
  if (markdown === null) {
    return (
      <div className="space-y-4">
        {toolbar}
        <EmptyState icon={FileWarning} title={emptyTitle} description={emptyDesc} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {toolbar}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <div className="card min-w-0 p-6">{markdown}</div>
        <MinutesChatPanel minutesId={minutesId} />
      </div>
    </div>
  )
}
