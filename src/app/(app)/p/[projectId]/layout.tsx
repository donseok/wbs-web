// 프로젝트 셸. 메뉴는 사이드바로 이동했고, 각 페이지가 자체 PageHero 를 렌더한다.
export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 space-y-5">{children}</div>
}
