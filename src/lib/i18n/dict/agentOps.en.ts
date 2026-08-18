// agentOps 영어 사전 — ko 파일과 물리 분리(웹팩이 En 을 클라이언트 공통 청크에 싣지 않도록).
// 키 패리티는 import type 으로만 강제한다 — 값 import 를 넣으면 분리가 무효가 된다.
import type { agentOpsKo } from './agentOps'

export const agentOpsEn: Record<keyof typeof agentOpsKo, string> = {
  'agentops.title': 'Agent Ops',
  'agentops.desc': 'Issue WBS work to agents, review and approve reports.',
  'agentops.notRegistered': 'Agent loop is not registered for this project.',
  'agentops.register': 'Register loop (superuser)',
  'agentops.unregister': 'Unregister',
  'agentops.issue': 'Issue work',
  'agentops.issueItem': 'Target leaf item',
  'agentops.issueInstructions': 'Instructions',
  'agentops.issuePriority': 'Priority',
  'agentops.issueSubmit': 'Issue',
  'agentops.issueItemPlaceholder': 'WBS item ID (copy from the tree)',
  'agentops.col.ready': 'Ready',
  'agentops.col.claimed': 'In progress',
  'agentops.col.reported': 'Awaiting approval',
  'agentops.col.done': 'Done / cancelled',
  'agentops.stale': 'No response',
  'agentops.reclaim': 'Reclaim',
  'agentops.cancel': 'Cancel',
  'agentops.approve': 'Approve',
  'agentops.reject': 'Reject',
  'agentops.rejectNote': 'Rejection note (required)',
  'agentops.reports': 'Reports',
  'agentops.links': 'Evidence links',
  'agentops.empty': 'No work orders',
  'agentops.error': 'Failed to load',
  'agentops.actionFailed': 'Action failed',
  'agentops.itemDeleted': '(item deleted)',
}
