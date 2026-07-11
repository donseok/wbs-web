// src/lib/ai/commands/propose.ts
import type { CommandCandidate, CommandProposal, ParsedCommand } from './types'

const fmtDate = (d: string | null) => d ?? '미정'

export function buildProposal(cmd: ParsedCommand, matches: CommandCandidate[]): CommandProposal {
  if (!matches.length) return { kind: 'not_found', targetQuery: cmd.targetQuery }
  if (matches.length > 1) return { kind: 'disambiguate', targetQuery: cmd.targetQuery, candidates: matches }
  const target = matches[0]
  const changes: Extract<CommandProposal, { kind: 'proposal' }>['changes'] = []
  const params: Extract<CommandProposal, { kind: 'proposal' }>['params'] = {}
  if (cmd.action === 'set_actual' || cmd.action === 'complete') {
    const after = cmd.action === 'complete' ? 100 : (cmd.actualPct as number)
    params.actualPct = after
    changes.push({
      field: 'actual_pct', label: '실적',
      before: `${target.displayActual}%`, after: `${after}%`,
    })
  }
  if (cmd.action === 'set_dates') {
    if (cmd.plannedStart !== undefined) {
      params.plannedStart = cmd.plannedStart
      changes.push({ field: 'planned_start', label: '시작일', before: fmtDate(target.plannedStart), after: fmtDate(cmd.plannedStart) })
    }
    if (cmd.plannedEnd !== undefined) {
      params.plannedEnd = cmd.plannedEnd
      changes.push({ field: 'planned_end', label: '종료일', before: fmtDate(target.plannedEnd), after: fmtDate(cmd.plannedEnd) })
    }
  }
  return { kind: 'proposal', action: cmd.action, target, params, changes }
}
