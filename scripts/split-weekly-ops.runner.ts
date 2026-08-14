// 주간업무 구분 '조업및표준화' → '조업' + '표준화' 데이터 이관 (일회성 운영 러너).
// 스키마 변경이 없어 마이그레이션 파일이 아니다 — backfill-0076.runner.ts 전례를 따른다.
//
// 실행(dry-run):  SPLIT_TARGET=staging npx vitest run --config scripts/split-weekly-ops.vitest.ts --reporter=verbose
// 실행(적용):     SPLIT_TARGET=staging SPLIT_APPLY=1 npx vitest run --config scripts/split-weekly-ops.vitest.ts --reporter=verbose
// TARGET=prod 는 스테이징 검증 완료 후에만. 환경키는 .env.local.<target> 에서 읽는다.
//
// 되돌리기: outputs/weekly-ops-split-<target>.pre.json 이 원본 4셀을, .post.json 이 새로 만든
// '표준화' 행 id 를 담는다. 되돌리려면 post 의 id 를 지우고 pre 의 4셀·section 을 되쓰면 된다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { buildSplitPlan, type SplitCells, type SplitSourceRow } from './lib/split-weekly-ops-core'

const MERGED = '조업및표준화'
const OPS = '조업'
const STANDARD = '표준화'
/** 이관 후의 구분 목록 — src/lib/domain/weeklySheet.ts 의 WEEKLY_SECTIONS 와 같아야 한다.
 *  러너가 도메인 모듈을 import 하지 않는 것은 의도다: 코드가 먼저 바뀌든 나중에 바뀌든
 *  이 스크립트가 쓰는 값이 흔들리지 않아야 한다(실행 시점의 상수에 끌려다니면 재현이 안 된다). */
const SECTIONS_AFTER = [
  'PMO', '영업', '구매', '관리회계', '품질', '생산계획',
  '조업', '표준화', '물류', '설비및L2', '가공',
]
const sortOrderOf = (section: string) => SECTIONS_AFTER.indexOf(section) + 1

function envOf(target: string): { url: string; key: string } {
  const envUrl = new URL(`../.env.local.${target}`, import.meta.url)
  let raw: string
  try {
    raw = readFileSync(envUrl, 'utf8')
  } catch (e) {
    throw new Error(
      `${envUrl.pathname} 파일이 없습니다 — .env.local.example 을 참고해 리포 루트에 `
      + `.env.local.${target} 을 만들고 값을 채우세요. 원본 에러: ${(e as Error).message}`,
    )
  }
  const pick = (k: string) => raw.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"(.*)"$/, '$1')
  const url = pick('NEXT_PUBLIC_SUPABASE_URL')
  const key = pick('SUPABASE_SERVICE_ROLE_KEY') ?? pick('SUPABASE_SERVICE_ROLE')
  if (!url || !key) {
    throw new Error(`${envUrl.pathname} 에서 NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY 를 찾지 못했습니다`)
  }
  return { url, key }
}

function writeArtifact(name: string, payload: unknown) {
  mkdirSync(new URL('../outputs/', import.meta.url), { recursive: true })
  const path = new URL(`../outputs/${name}`, import.meta.url)
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`  · 산출물: outputs/${name}`)
}

type RowRecord = {
  id: string; report_id: string; section: string; sort_order: number
  this_content: string; this_issue: string; next_content: string; next_issue: string
}

/** 이관 대상과, 각 보고서에 이미 있는 '표준화'/'조업' 행을 함께 읽는다.
 *  이미 있는 행을 모르고 insert 하면 같은 구분 행이 둘 생긴다(무해하지만 시트가 지저분해진다). */
async function loadState(admin: SupabaseClient) {
  const { data: rows, error } = await admin
    .from('weekly_report_rows')
    .select('id, report_id, section, sort_order, this_content, this_issue, next_content, next_issue')
    .in('section', [MERGED, OPS, STANDARD])
  if (error) throw new Error(`행 조회 실패: ${error.message}`)
  const all = (rows ?? []) as RowRecord[]

  const reportIds = [...new Set(all.map(r => r.report_id))]
  const reports = new Map<string, { weekStart: string; projectId: string }>()
  if (reportIds.length) {
    const { data, error: e2 } = await admin
      .from('weekly_reports').select('id, week_start, project_id').in('id', reportIds)
    if (e2) throw new Error(`보고서 조회 실패: ${e2.message}`)
    for (const r of (data ?? []) as { id: string; week_start: string; project_id: string }[]) {
      reports.set(r.id, { weekStart: r.week_start, projectId: r.project_id })
    }
  }
  return { all, reports }
}

describe('주간업무 조업/표준화 분리 이관', () => {
  it('조업및표준화 행을 조업으로 바꾸고 표준화 행을 만든다', async () => {
    const target = process.env.SPLIT_TARGET
    if (!target) { console.log('SPLIT_TARGET 미지정 — skip'); return }
    const apply = process.env.SPLIT_APPLY === '1'
    const { url, key } = envOf(target)
    const admin = createClient(url, key, { auth: { persistSession: false } })

    console.log(`\n▣ 대상=${target}  모드=${apply ? '적용' : 'dry-run'}  (${url})`)

    const { all, reports } = await loadState(admin)
    const merged = all.filter(r => r.section === MERGED)
    const existingStandard = new Map(all.filter(r => r.section === STANDARD).map(r => [r.report_id, r]))

    if (merged.length === 0) {
      // 멱등 — 이미 이관된 DB 에 다시 돌려도 아무 일도 하지 않는다.
      console.log(`  · '${MERGED}' 행 0건 — 이미 이관됐거나 대상이 없습니다. 아무것도 하지 않습니다.`)
      expect(all.filter(r => r.section === MERGED)).toHaveLength(0)
      return
    }

    const sources: SplitSourceRow[] = merged.map(r => ({
      id: r.id,
      reportId: r.report_id,
      weekStart: reports.get(r.report_id)?.weekStart ?? '(주차 미상)',
      sortOrder: r.sort_order,
      thisContent: r.this_content ?? '',
      thisIssue: r.this_issue ?? '',
      nextContent: r.next_content ?? '',
      nextIssue: r.next_issue ?? '',
    }))
    const plan = buildSplitPlan(sources).sort((a, b) => a.weekStart.localeCompare(b.weekStart))

    console.log(`  · 대상 ${plan.length}행`)
    for (const p of plan) {
      const chars = (c: SplitCells) => Object.values(c).join('').length
      const dup = existingStandard.has(p.reportId) ? ' ⚠이미 표준화 행 있음' : ''
      console.log(
        `    ${p.weekStart}  원본 ${chars(p.before)}자 → 조업 ${chars(p.ops)}자 / 표준화 ${chars(p.standard)}자`
        + `${p.standardIsEmpty ? ' (머리글 없음 — 전량 조업)' : ''}${dup}`,
      )
    }

    // 원본 스냅샷은 dry-run 에서도 남긴다 — 적용 직전에 사람이 눈으로 대조할 자료가 된다.
    writeArtifact(`weekly-ops-split-${target}.pre.json`, {
      target, capturedAt: new Date().toISOString(),
      rows: plan.map(p => ({
        rowId: p.rowId, reportId: p.reportId, weekStart: p.weekStart,
        section: MERGED, sortOrder: p.sortOrder, cells: p.before,
      })),
    })

    if (!apply) {
      console.log('  · dry-run — DB 는 건드리지 않았습니다. SPLIT_APPLY=1 로 다시 실행하세요.\n')
      expect(plan.length).toBeGreaterThan(0)
      return
    }

    const created: { reportId: string; weekStart: string; rowId: string; reused: boolean }[] = []
    for (const p of plan) {
      // ① 옛 행을 조업으로. 내용은 조업 몫만 남는다.
      const { error } = await admin.from('weekly_report_rows').update({
        section: OPS, sort_order: sortOrderOf(OPS), ...p.ops, updated_at: new Date().toISOString(),
      }).eq('id', p.rowId)
      if (error) throw new Error(`[${p.weekStart}] 조업 행 갱신 실패: ${error.message}`)

      // ② 표준화 행. 이미 있으면(백필이 먼저 돌았다면) 그 행을 채우고, 없으면 새로 만든다.
      const reuse = existingStandard.get(p.reportId)
      if (reuse) {
        const busy = [reuse.this_content, reuse.this_issue, reuse.next_content, reuse.next_issue]
          .some(v => (v ?? '').trim() !== '')
        if (busy) {
          // 사람이 이미 손으로 옮겨 적은 경우 — 덮어쓰지 않는다. 남은 조업 몫은 그대로 두고 보고만 한다.
          console.log(`    ⚠ ${p.weekStart}: 표준화 행에 이미 내용이 있어 건너뜁니다(수기 확인 필요).`)
          created.push({ reportId: p.reportId, weekStart: p.weekStart, rowId: reuse.id, reused: true })
          continue
        }
        const { error: e } = await admin.from('weekly_report_rows').update({
          sort_order: sortOrderOf(STANDARD), ...p.standard, updated_at: new Date().toISOString(),
        }).eq('id', reuse.id)
        if (e) throw new Error(`[${p.weekStart}] 표준화 행 갱신 실패: ${e.message}`)
        created.push({ reportId: p.reportId, weekStart: p.weekStart, rowId: reuse.id, reused: true })
      } else {
        const { data, error: e } = await admin.from('weekly_report_rows').insert({
          report_id: p.reportId, section: STANDARD, module: '',
          sort_order: sortOrderOf(STANDARD), ...p.standard,
        }).select('id').single()
        if (e) throw new Error(`[${p.weekStart}] 표준화 행 생성 실패: ${e.message}`)
        created.push({ reportId: p.reportId, weekStart: p.weekStart, rowId: (data as { id: string }).id, reused: false })
      }
    }

    // ③ 보고서 updated_at 을 건드린다 — 챗봇 RAG 재색인 스캐너가 weekly_reports.updated_at 만
    //    보기 때문에(ai/index/backfill.ts), 행만 고치면 색인은 무기한 '## 조업및표준화'를 물고 있다.
    const touched = [...new Set(plan.map(p => p.reportId))]
    const { error: e3 } = await admin.from('weekly_reports')
      .update({ updated_at: new Date().toISOString() }).in('id', touched)
    if (e3) throw new Error(`보고서 updated_at 갱신 실패: ${e3.message}`)

    // ④ 구분 마스터(0058 시드) 도 맞춘다. 지금 이 컬럼을 읽는 코드는 없지만(P4 미구현),
    //    갈라진 채 두면 마스터를 켜는 순간 화면이 조용히 옛 10구분으로 되돌아간다.
    const projectIds = [...new Set(touched.map(id => reports.get(id)?.projectId).filter(Boolean))] as string[]
    const { data: settings, error: e4 } = await admin.from('project_settings')
      .select('project_id, weekly_sections').in('project_id', projectIds)
    if (e4) throw new Error(`project_settings 조회 실패: ${e4.message}`)
    for (const s of (settings ?? []) as { project_id: string; weekly_sections: string[] | null }[]) {
      if (!s.weekly_sections?.includes(MERGED)) continue
      const { error: e5 } = await admin.from('project_settings')
        .update({ weekly_sections: SECTIONS_AFTER }).eq('project_id', s.project_id)
      if (e5) throw new Error(`project_settings 갱신 실패(${s.project_id}): ${e5.message}`)
      console.log(`  · project_settings.weekly_sections 갱신: ${s.project_id}`)
    }

    writeArtifact(`weekly-ops-split-${target}.post.json`, {
      target, appliedAt: new Date().toISOString(), created, touchedReports: touched, projectIds,
    })

    // 검증 — 이관 후 '조업및표준화' 행은 0건이어야 한다.
    const after = await loadState(admin)
    const leftover = after.all.filter(r => r.section === MERGED)
    console.log(`  · 적용 완료: 조업 ${plan.length}행 갱신 / 표준화 ${created.length}행 확보 / 잔여 ${MERGED} ${leftover.length}건\n`)
    expect(leftover).toHaveLength(0)
    expect(created).toHaveLength(plan.length)
  }, 120_000)
})
