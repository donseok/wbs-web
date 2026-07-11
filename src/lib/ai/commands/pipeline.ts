// src/lib/ai/commands/pipeline.ts
// 큐 감지 → 파싱(결정형/LLM) → 대상 매칭 → 제안 생성까지 잇는 순수 오케스트레이터.
// 라우트와 테스트가 공유한다 — 라우트는 인증/데이터 로드 후 이 함수를 호출하는 얇은 접착층.
import type { ComputedItem } from '@/lib/domain/types'
import type { CommandProposal } from './types'
import { isCommandUtterance } from './cue'
import { parseCommand } from './parse'
import { collectCandidates, matchCandidates } from './match'
import { buildProposal } from './propose'

export async function runCommandPipeline(
  message: string,
  items: ComputedItem[],
  targetId?: string,
): Promise<CommandProposal> {
  if (!isCommandUtterance(message)) return { kind: 'not_command' }
  const cmd = await parseCommand(message)
  if (!cmd) {
    return {
      kind: 'error',
      message: '명령을 이해하지 못했어요. 예: "ERP 인터페이스 설계 실적 80으로 올려줘"',
    }
  }
  const all = collectCandidates(items)
  const matches = targetId ? all.filter(c => c.id === targetId) : matchCandidates(cmd.targetQuery, all)
  return buildProposal(cmd, matches)
}
