import type { ReadOnlyBotTool, ToolExecutionContext } from '@/lib/ai/tools/types'

export type ChatToolExecutionContext = ToolExecutionContext & {
  /** Tools may ignore this until their underlying adapter supports cancellation. */
  signal?: AbortSignal
}

export type ChatTool = ReadOnlyBotTool<unknown>

export interface ChatToolRegistry {
  get(name: string): ChatTool | undefined
  names(): string[]
}

export function createChatToolRegistry(tools: readonly ChatTool[]): ChatToolRegistry {
  const byName = new Map<string, ChatTool>()
  for (const tool of tools) {
    if (!tool.name || byName.has(tool.name)) throw new Error(`Duplicate or empty chat tool name: ${tool.name}`)
    byName.set(tool.name, tool)
  }
  return Object.freeze({
    get: (name: string) => byName.get(name),
    names: () => [...byName.keys()],
  })
}

export const EMPTY_CHAT_TOOL_REGISTRY: ChatToolRegistry = createChatToolRegistry([])
