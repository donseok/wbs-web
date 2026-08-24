// agentOps 영어 사전 — ko 파일과 물리 분리(웹팩이 En 을 클라이언트 공통 청크에 싣지 않도록).
// 키 패리티는 import type 으로만 강제한다 — 값 import 를 넣으면 분리가 무효가 된다.
import type { agentOpsKo } from './agentOps'

export const agentOpsEn: Record<keyof typeof agentOpsKo, string> = {
  'agentops.title': 'Approval Inbox',
  'agentops.desc': 'Review what agents reported and approve or reject. To hand work to an agent, tick "Agent delegation" in the WBS spec panel.',
  'agentops.gotoWbs': 'Go to WBS',
  'agentops.notActivated': 'No work has been handed to agents yet.',
  'agentops.notActivatedDesc': 'Tick "Agent delegation" in a WBS item\'s spec panel — the project activates and an order is issued automatically.',
  'agentops.stoppedChip': 'Agents stopped (enable in Settings)',
  'agentops.pendingChip': 'Awaiting approval',
  'agentops.col.ready': 'Ready',
  'agentops.col.claimed': 'In progress',
  'agentops.col.reported': 'Awaiting approval',
  'agentops.col.done': 'Done / cancelled',
  'agentops.stale': 'No response',
  'agentops.reclaim': 'Reclaim',
  'agentops.approve': 'Approve',
  'agentops.reject': 'Reject',
  'agentops.rejectNote': 'Reject reason (required)',
  'agentops.reports': 'Reports',
  'agentops.links': 'Evidence links',
  'agentops.readyHint': 'To cancel, untick "Agent delegation" in the WBS spec panel.',
  'agentops.empty': 'No orders',
  'agentops.error': 'Failed to load',
  'agentops.actionFailed': 'Action failed',
  'agentops.itemDeleted': '(item deleted)',
}
