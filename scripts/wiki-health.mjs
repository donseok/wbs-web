#!/usr/bin/env node
/**
 * 위키 재구축 건강검진 — "멈췄는데 아무도 모르는" 상태를 없애기 위한 운영 스크립트
 *
 * 왜 이 스크립트인가:
 *   2026-07-30 에 재구축 잡이 나흘간(07-26~07-30) status='running' 으로 멈춰 있었고,
 *   그 사이 위키의 살아있는 항목이 92건/17주제(회의록 9/42)까지 떨어져 있었다.
 *   그런데 화면·로그·기존 스크립트 어디에도 그 사실이 나타나지 않았다:
 *     - `wiki_project_rebuild_jobs` 는 authenticated 에게 SELECT 정책조차 없어 화면에 못 띄운다
 *     - `smoke:prod` 는 의도적으로 DB 를 보지 않는다(HTTP 산출물만 검사)
 *     - `last_error` 는 safeJobError 가 ':' 앞만 남겨 원인이 지워진다
 *   그래서 service role 로 큐를 직접 읽는 별도 관문이 필요하다.
 *
 * 이 스크립트는 판정만 한다 — 고치지 않는다. 쓰기·DDL 을 하지 않는다.
 * 멈춤이 확인되면 완주 레시피는 README 대신 아래 안내문이 출력한다.
 *
 * 사용:
 *   npm run wiki:health
 *
 * 종료 코드: 0 정상/진행중 / 1 멈춤·불완전(조치 필요) / 2 스크립트·환경 오류(판정 아님)
 */

/** processWikiProjectRebuildStep 이 claim 에 넘기는 lease(초)와 같은 값이어야 한다. */
export const LEASE_SECONDS = 15 * 60

/**
 * 살아있음의 정본은 src/lib/domain/wiki.ts 의 WIKI_LIVE_STATES 다. 이 스크립트는 .mjs 라
 * 값을 복제하는데, 갈라지면 게이트와 판정표가 다른 모집단을 재게 된다.
 */
export const LIVE_STATES = ['active', 'open', 'conflicted']

/** src/lib/domain/wiki.ts 의 WIKI_TOPIC_ITEM_CAP 과 같아야 한다. */
export const TOPIC_ITEM_CAP = 15

/** 주제 입도 요약. 판정 1~5의 원천이다. */
export function summarizeTopicGranularity(items) {
  const byTopic = new Map()
  for (const it of items) {
    const cur = byTopic.get(it.topicId)
    if (cur) cur.n += 1
    else byTopic.set(it.topicId, { title: it.topicTitle, n: 1 })
  }
  let maxSize = 0
  let maxTitle = ''
  let over20 = 0
  let saturated = 0
  let saturatedItems = 0
  let oneItem = 0
  for (const { title, n } of byTopic.values()) {
    if (n > maxSize) { maxSize = n; maxTitle = title }
    if (n >= 20) over20 += 1
    if (n >= TOPIC_ITEM_CAP) { saturated += 1; saturatedItems += n }
    if (n === 1) oneItem += 1
  }
  return { maxSize, maxTitle, over20, saturated, saturatedItems, oneItem, topics: byTopic.size }
}

/**
 * --dump-keys 인자 파싱. 경로 누락을 무음 no-op 으로 흘리면 재구축 전/후 A/B 증거물을
 * 받은 줄 알고 잃는다 — 애매하면 에러로 세운다(fail-closed).
 */
export function parseDumpKeysArg(argv) {
  const eq = argv.find((a) => a.startsWith('--dump-keys='))
  if (eq) {
    const path = eq.slice('--dump-keys='.length)
    return path ? { path } : { error: '--dump-keys= 뒤에 경로가 비어 있다' }
  }
  const idx = argv.indexOf('--dump-keys')
  if (idx === -1) return { path: null }
  const next = argv[idx + 1]
  if (!next || next.startsWith('--')) {
    return { error: '--dump-keys 다음에 저장할 경로가 필요하다' }
  }
  return { path: next }
}

const LEVELS = { ok: 0, progress: 0, unknown: 0, warn: 0, fail: 1 }

/**
 * 재구축 잡 한 행 + 남은 회의록 수로 건강 상태를 판정하는 순수 함수.
 *
 * 판정이 애매하면 정상으로 위장하지 않는다(에러 처리 3원칙). 잡이 없으면 'unknown',
 * done 인데 남은 회의록이 있으면 'fail' 이다 — 후자는 조용히 덜 반영된 상태이고,
 * 화면에는 "위키가 얇다"로만 보여서 4일을 잃은 바로 그 증상이다.
 */
export function classifyRebuildHealth(job, { remaining, now }) {
  if (!job) {
    return {
      level: 'unknown',
      stalled: false,
      reason: '재구축 잡 행이 없다 — 큐가 만들어진 적 없거나 조회에 실패했다',
    }
  }

  const lockAgeSec = job.locked_at
    ? Math.floor((now.getTime() - new Date(job.locked_at).getTime()) / 1000)
    : null

  if (job.status === 'dead_letter') {
    return {
      level: 'fail',
      stalled: true,
      reason: `dead_letter — attempts ${job.attempts}/${job.max_attempts}, last_error=${job.last_error ?? '없음'}`,
      lockAgeSec,
    }
  }

  if (job.status === 'running' && lockAgeSec !== null && lockAgeSec > LEASE_SECONDS) {
    return {
      level: 'fail',
      stalled: true,
      reason: `lease(${LEASE_SECONDS}s) 초과 running — 락 보유 ${lockAgeSec}s. `
        + '워커가 실행 중간에 죽었고 이후 아무도 회수하지 않았다',
      lockAgeSec,
    }
  }

  if (job.attempts >= job.max_attempts) {
    return {
      level: 'fail',
      stalled: true,
      reason: `attempts 소진 ${job.attempts}/${job.max_attempts}, last_error=${job.last_error ?? '없음'}`,
      lockAgeSec,
    }
  }

  if (job.status === 'done' && remaining > 0) {
    return {
      level: 'fail',
      stalled: true,
      reason: `done 인데 커서 뒤에 회의록 ${remaining}건이 남아 있다 — 반영이 불완전하다`,
      lockAgeSec,
    }
  }

  if (job.reset_generation !== job.generation) {
    return {
      level: 'warn',
      stalled: false,
      reason: `리셋 대기 — generation ${job.generation} vs reset_generation ${job.reset_generation}. `
        + '다음 claim 이 커서를 처음으로 되감는다',
      lockAgeSec,
    }
  }

  if (job.status === 'done') {
    return { level: 'ok', stalled: false, reason: '완주 — 남은 회의록 0건', lockAgeSec }
  }

  return {
    level: 'progress',
    stalled: false,
    reason: `${job.status} — 남은 회의록 ${remaining}건, 다음 cron/러너가 이어간다`,
    lockAgeSec,
  }
}

/* ---------------------------------------------------------------- CLI ---- */

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`

async function main() {
  const { readFileSync } = await import('node:fs')
  const envUrl = new URL('../.env.local', import.meta.url)
  try {
    for (const line of readFileSync(envUrl, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (!m || process.env[m[1]]) continue
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
    }
  } catch {
    // env 는 프로세스 환경에 이미 있을 수 있다
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) {
    console.error('환경변수 없음: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(2)
  }

  const dump = parseDumpKeysArg(process.argv)
  if (dump.error) {
    console.error(`인자 오류 — ${dump.error}`)
    process.exit(2)
  }

  const rest = async (path) => {
    const res = await fetch(`${base.replace(/\/$/, '')}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`)
    return res.json()
  }

  /**
   * PostgREST max_rows 하드 캡(supabase/config.toml, 호스티드 동일). limit 파라미터도
   * 이 값으로 깎이므로(2026-07-30 실측: limit=5000 → 1000행) 캡보다 큰 limit 은 성립하지
   * 않고, 전량은 offset 페이지 순회로만 얻는다. 안정 페이지 경계를 위해 호출부는 반드시
   * order 를 명시해야 한다.
   */
  const MAX_ROWS = 1000
  const SCAN_CAP = 5000

  /** cap 도달 시 complete=false — 조용한 절단 금지. */
  const restAll = async (path) => {
    const rows = []
    for (let offset = 0; offset < SCAN_CAP; offset += MAX_ROWS) {
      const batch = await rest(`${path}&limit=${MAX_ROWS}&offset=${offset}`)
      rows.push(...batch)
      if (batch.length < MAX_ROWS) return { rows, complete: true }
    }
    return { rows, complete: false }
  }

  /** 행 대신 총 행수만. content-range 총계는 max_rows 캡과 무관하게 정확하다(실측). */
  const restCount = async (path) => {
    const res = await fetch(`${base.replace(/\/$/, '')}/rest/v1/${path}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
    })
    if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`)
    const total = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '')
    if (!total) throw new Error(`${path} → content-range 에 총계가 없다`)
    return Number(total[1])
  }

  let jobs
  let processing
  let itemsRes
  let sources
  let minutes
  let eventsRes
  let topicCount
  let resetAt

  // 살아있음의 정의를 게이트와 일치시킨다(기존 neq.archived 를 교체).
  const liveFilter = `lifecycle_state=in.(${LIVE_STATES.join(',')})`

  try {
    // 최신 리셋 마커는 별도로 정확히 조회한다 — 무순서 창(서버 캡 1000행)에서 max 를
    // 고르면 마커가 창 밖으로 밀려 세대 경계가 한 세대 전으로 잡힌다(2026-07-30 실측:
    // 원장 2,034행에서 실제 재현). 이벤트는 그 경계 이후만 긁는다.
    const marker = await rest(
      'wiki_change_events?select=created_at'
      + '&idempotency_key=like.wiki-project-reset-v1%3A*'
      + '&order=created_at.desc&limit=1',
    )
    resetAt = marker[0]?.created_at ?? ''

    ;[jobs, processing, itemsRes, sources, minutes, eventsRes, topicCount] = await Promise.all([
      rest('wiki_project_rebuild_jobs?select=*'),
      rest('wiki_processing_jobs?select=id,status,attempts,max_attempts,locked_at,last_error&status=neq.done'),
      restAll(`wiki_items?select=id,topic_id,knowledge_key,wiki_topics!inner(title)&${liveFilter}&order=id.asc`),
      rest('wiki_item_sources?select=minute_id&retracted_at=is.null'),
      rest('minutes?select=id,minute_date,meeting_occurrence_date,created_at&archived_at=is.null&project_id=not.is.null'),
      restAll(
        'wiki_change_events?select=change_type,created_at'
        + (resetAt ? `&created_at=gt.${encodeURIComponent(resetAt)}` : '')
        + '&order=created_at.desc,id.desc',
      ),
      restCount('wiki_topics?select=id'),
    ])
  } catch (err) {
    console.error('조회 실패 —', err instanceof Error ? err.message : err)
    process.exit(2)
  }
  const items = itemsRes.rows
  const events = eventsRes.rows

  const job = jobs[0] ?? null
  const cursor = job?.cursor_observed_sort ? new Date(`${job.cursor_observed_sort}Z`) : null
  const observedSort = (m) => new Date(
    `${(m.meeting_occurrence_date || m.minute_date)}T${new Date(m.created_at).toISOString().slice(11)}`,
  )
  const remaining = cursor === null
    ? minutes.length
    : minutes.filter((m) => observedSort(m) > cursor).length

  const health = classifyRebuildHealth(job, { remaining, now: new Date() })

  const liveMinutes = new Set(sources.map((s) => s.minute_id)).size
  const liveTopics = new Set(items.map((i) => i.topic_id)).size

  const mark = { ok: '✓', progress: '·', warn: '!', fail: '✗', unknown: '?' }[health.level]
  console.log(`\n${mark} 재구축: ${health.level.toUpperCase()} — ${health.reason}`)
  if (job) {
    console.log(`  generation ${job.generation} / reset ${job.reset_generation}`
      + ` · 커서 ${job.cursor_observed_sort ?? '(처음)'}`
      + (health.lockAgeSec === null ? '' : ` · 락 ${health.lockAgeSec}s`))
  }
  console.log(`  회의록 반영 ${liveMinutes} / ${minutes.length} · 살아있는 항목 ${items.length} · 주제 ${liveTopics}`)

  const gran = summarizeTopicGranularity(items.map((i) => ({
    topicId: i.topic_id,
    topicTitle: (Array.isArray(i.wiki_topics) ? i.wiki_topics[0] : i.wiki_topics)?.title ?? '(제목 없음)',
  })))
  const pct = items.length > 0 ? (gran.saturatedItems / items.length * 100).toFixed(1) : '0.0'
  console.log(`  주제 입도: 최대 "${gran.maxTitle}" ${gran.maxSize}`
    + ` · 20건↑ 주제 ${gran.over20} · 상한(${TOPIC_ITEM_CAP})↑ 주제 ${gran.saturated}/${gran.topics}`
    + ` (항목 ${gran.saturatedItems}, ${pct}%)`)
  console.log(`             1항목 주제 ${gran.oneItem} · wiki_topics 총 ${topicCount}행`)
  if (!itemsRes.complete) {
    console.log(`  ⚠ 살아있는 항목이 스캔 상한 ${SCAN_CAP}행에 닿았다 — 입도·키 덤프가 불완전하다`)
  }

  // 이벤트는 세대 리셋에도 삭제되지 않는 누적 원장이라, 마지막 리셋 마커 이후로
  // 서버에서 스코프해 받았다(created_at=gt). 마커 자체(retract 행)도 경계에 걸려 빠진다.
  const gen = {}
  for (const e of events) gen[e.change_type] = (gen[e.change_type] ?? 0) + 1
  console.log(`  변경 이벤트(현 세대): `
    + ['new', 'reaffirm', 'refine', 'supersede', 'conflict', 'retract']
      .map((k) => `${k} ${gen[k] ?? 0}`).join(' · ')
    + (resetAt ? '' : ' · (리셋 마커 없음 — 전량 집계)'))
  if (!eventsRes.complete) {
    console.log(`  ⚠ 현 세대 이벤트가 스캔 상한 ${SCAN_CAP}행에 닿았다 — 분포가 불완전하다`)
  }

  if (dump.path) {
    const { writeFileSync } = await import('node:fs')
    const keys = [...new Set(items.map((i) => i.knowledge_key).filter(Boolean))].sort()
    try {
      writeFileSync(dump.path, keys.join('\n') + '\n', 'utf8')
    } catch (err) {
      // 쓰기 실패를 uncaught 로 흘리면 exit 1 이 되어 '재구축 멈춤' 판정으로 위장된다.
      console.error(`덤프 실패 — ${err instanceof Error ? err.message : err}`)
      process.exit(2)
    }
    console.log(`  knowledge_key ${keys.length}개를 ${dump.path} 에 저장했다`
      + (itemsRes.complete ? '' : ' (⚠ 불완전 — 상한 절단)'))
  }

  if (processing.length > 0) {
    console.log(`\n  미완 처리 잡 ${processing.length}건:`)
    for (const p of processing) {
      console.log(`    #${p.id} ${p.status} ${p.attempts}/${p.max_attempts}`
        + ` ${p.last_error ? `err=${p.last_error}` : ''}`)
    }
  }

  if (health.stalled) {
    console.log('\n  완주시키려면 — 러너를 반복 실행한다(한 라운드가 스텝 2~3건):')
    console.log('    for i in $(seq 1 26); do \\')
    console.log('      npx vitest run --config scripts/wiki-rebuild.vitest.ts \\')
    console.log('        --reporter=verbose --disable-console-intercept || true; sleep 15; done')
    console.log('  도는 동안 회의록의 프로젝트 지정을 바꾸지 말 것 — 커서가 처음으로 되감긴다.')
  }
  console.log('')

  process.exit(LEVELS[health.level] ?? 2)
}

if (isMain) await main()
