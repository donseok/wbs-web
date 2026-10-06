// src/components/agents/LaneBoard.tsx
'use client'
import type { Seat, Seatmap } from '@/lib/domain/seatmap'
import type { SeatState } from '@/lib/domain/seatState'
import { Sprite } from './Sprite'
import { PhaseBadge } from './PhaseBadge'
import { ChatBubble, seatSpeech, useOfficeChatter } from './SeatSpeech'
import { SeatOpsBar, type SeatOpHandler } from './SeatOpsBar'
import { SeatMark, seatMetaLine, seatStateLabel } from './Seat'
import { OwnerTag, ownerLabel } from './OwnerTag'
import { DecisionChip } from './DecisionChip'
import { IconFolded, IconStale, IconWait } from './icons'
import { InputRequestBadge, InputWaitChip } from './InputRequestBadge'
import { assembleLaneSummaryRows, type LaneSummaryRow } from '@/lib/domain/laneSummary'
import css from './seatmap.module.css'

interface LaneDef { key: string; title: string; states: readonly SeatState[]; icon: (() => React.JSX.Element) | null }

/** 처리하는 화면이므로 손대야 할 것이 먼저 온다 — 결재 대기 → 손봐야 함 → 업무 중 → 빈자리·완료. */
const LANES: readonly LaneDef[] = [
  { key: 'wait', title: '결재 대기', states: ['WAIT'], icon: IconWait },
  { key: 'attention', title: '손봐야 함', states: ['BLOCKED', 'STALE', 'OFFLINE', 'REJECTED'], icon: IconStale },
  { key: 'work', title: '업무 중', states: ['ACTIVE'], icon: null },
  { key: 'rest', title: '빈자리 · 완료', states: ['READY', 'DONE'], icon: IconFolded },
]

interface Entry { seat: Seat; floorName: string; zoneLabel: string }

/** 좌석이 설 레인 — 설계 완료·선행 대기(designWait)·검토 대기(reviewWait)·구현 대기(buildWait)는 WAIT 지만 결재할 것이 없어 READY 의 선행 대기 곁(빈자리·완료)에 선다. */
function laneKeyOf(seat: Seat): string | undefined {
  if (seat.designWait || seat.reviewWait || seat.buildWait) return 'rest'
  return LANES.find(l => l.states.includes(seat.state))?.key
}

function collect(map: Seatmap): Entry[] {
  const out: Entry[] = []
  for (const f of map.floors) for (const z of f.zones) for (const s of z.seats) {
    out.push({ seat: s, floorName: f.name, zoneLabel: `${z.code} ${z.name}` })
  }
  return out
}

const HAS_BAR: readonly SeatState[] = ['ACTIVE', 'STALE', 'REJECTED', 'BLOCKED', 'OFFLINE']
/** 말풍선 줄을 두는 카드 — 막대가 있는 좌석과, 승인을 조르는 승인 대기 좌석(2026-09-18). */
const HAS_SAY: readonly SeatState[] = [...HAS_BAR, 'WAIT']

/**
 * 카드 속 말풍선 줄 — 보고·한마디(에이전트 보기와 같은 말). 한 줄 높이를 늘 잡아 두어
 * 말할 때마다 카드 높이가 출렁이지 않게 한다. 꼬리는 왼쪽 캐릭터를 가리킨다.
 */
function LaneSpeech({ seat, nowMs }: { seat: Seat; nowMs: number }) {
  const say = seatSpeech(seat, nowMs, useOfficeChatter())
  return (
    <span className={css.cardSay} data-card-say>
      {say && <ChatBubble key={say.text} {...say} tail="left" lines={1} className="block min-w-0 max-w-full truncate" />}
    </span>
  )
}

/**
 * 레인 요약 구역 — 조정자 킷이 보낸 임시 팀원(레인)의 표시 전용 요약. 터미널 화면은 읽지 않는다.
 * 요약이 없는 레인(옛 PC·형식 오류)도 행은 그리고 「요약 없음」 을 쓴다. 감시자가 하나도 없으면 구역 자체를 그리지 않는다.
 */
function LaneSummaryBoard({ rows, nowMs }: { rows: LaneSummaryRow[]; nowMs: number }) {
  if (rows.length === 0) return null
  return (
    <section className={css.laneSum} data-lane-summary aria-label="레인 요약">
      <div className={css.laneHead}><b>레인 요약</b><span className={css.laneN} data-lane-summary-n>{rows.length}</span></div>
      <ul className={css.laneSumList}>
        {rows.map(row => {
          const s = row.summary
          const waiting = row.inputRequest !== null && row.inputRequest.handled === null
          return (
            <li key={row.key} className={css.laneSumRow} data-lane-summary-row={row.lane} data-input-waiting={waiting ? '1' : undefined}>
              <div className={css.laneSumTop}>
                <b className={css.laneSumName}>{row.lane}</b>
                <span className={css.laneSumState} data-lane-state>{row.state}</span>
                {s?.hold && <span className={css.laneSumHold} data-lane-hold title="보류 사유">보류 · {s.hold}</span>}
                {s?.compactPending && <span className={css.laneSumFlag} data-lane-compact>compact 대기</span>}
                {row.inputRequest && !waiting && <InputWaitChip meta={row.inputRequest} nowMs={nowMs} />}
              </div>
              {row.inputRequest && waiting && <InputRequestBadge seatKey={row.seatKey} meta={row.inputRequest} nowMs={nowMs} />}
              {s ? (
                <>
                  {s.brief && <p className={css.laneSumBrief} data-lane-brief>{s.brief}</p>}
                  <p className={css.laneSumMeta} data-lane-meta>
                    {row.items && <span data-lane-items>진행 {row.items}</span>}
                    {s.branch && <span data-lane-branch className={css.laneSumBranch}>{s.branch}</span>}
                    {row.reportAgo && <span data-lane-report>보고 {row.reportAgo}</span>}
                    {row.instrAgo && <span data-lane-instr>지시 {row.instrAgo}</span>}
                    {s.ctxPct !== null && <span data-lane-ctx>ctx {s.ctxPct}%</span>}
                  </p>
                </>
              ) : (
                <p className={css.laneSumNone} data-lane-summary-none>요약 없음</p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * 상태 레인 보기 — 층·구역을 접고 상태별로 모아 세운다. 승인 대기와 손봐야 할 좌석이 한눈에 오며,
 * 평면도에는 그리지 않는 머지 완료(최근 7일) 좌석의 승인 취소·재작업 요청도 여기서 닿는다.
 */
export function LaneBoard({ map, selectedId, nowMs, busyOrderId, showFloorName, onSelect, onOp }: {
  map: Seatmap; selectedId: string | null; nowMs: number; busyOrderId: string | null
  /** 전체 스튜디오는 층이 여러 개라 카드에 층 이름을 같이 쓴다. */
  showFloorName: boolean
  onSelect: (orderId: string) => void
  onOp: SeatOpHandler
}) {
  const all = collect(map)
  const summaryRows = assembleLaneSummaryRows(map.floors, nowMs)
  return (
    <>
    <LaneSummaryBoard rows={summaryRows} nowMs={nowMs} />
    <div className={css.lanes} aria-label="상태별 좌석">
      {LANES.map(lane => {
        const list = all.filter(e => laneKeyOf(e.seat) === lane.key)
        const Icon = lane.icon
        return (
          <section key={lane.key} className={css.lane} data-lane={lane.key} aria-label={lane.title}>
            <div className={css.laneHead}>
              {Icon && <Icon />}<b>{lane.title}</b><span className={css.laneN} data-lane-n={lane.key}>{list.length}</span>
            </div>
            {list.length === 0 && <p className={css.laneEmpty}>없음</p>}
            {list.map(({ seat, floorName, zoneLabel }) => {
              const owner = ownerLabel(seat)
              return (
              <div key={seat.orderId} className={css.card} data-state={seat.state}
                data-selected={seat.orderId === selectedId ? '1' : undefined} data-owner={owner?.kind}>
                <button type="button" className={css.deskPick}
                  aria-pressed={seat.orderId === selectedId}
                  aria-label={`${seat.code} ${seat.name} ${seatStateLabel(seat)}`}
                  onClick={() => onSelect(seat.orderId)}>
                  <span className={css.cardTop}>
                    <Sprite character={seat.character} anim={seat.anim} />
                    <span className={css.cardText}>
                      <span className={css.cardZone}>{showFloorName ? `${floorName} · ${zoneLabel}` : zoneLabel}</span>
                      <span className={css.deskName}>{seat.code} {seat.name}</span>
                      {owner && <span className="flex min-w-0"><OwnerTag owner={owner} /></span>}
                      <span className={css.cardMeta}><PhaseBadge seat={seat} size="chip" /><DecisionChip count={seat.decisionCount} /><span className={css.deskMeta} data-seat-design-label={seat.design ? String(seat.design.row) : undefined}>{seatMetaLine(seat, nowMs)}</span></span>
                    </span>
                    <SeatMark state={seat.state} anim={seat.anim} reviewWait={seat.reviewWait} buildWait={seat.buildWait} />
                  </span>
                  {HAS_SAY.includes(seat.state) && <LaneSpeech seat={seat} nowMs={nowMs} />}
                  {HAS_BAR.includes(seat.state) && <span className={css.bar}><i style={{ width: `${seat.progress}%` }} /></span>}
                </button>
                <SeatOpsBar seat={seat} busy={busyOrderId === seat.orderId} onOp={onOp} />
              </div>
              )
            })}
          </section>
        )
      })}
    </div>
    </>
  )
}
