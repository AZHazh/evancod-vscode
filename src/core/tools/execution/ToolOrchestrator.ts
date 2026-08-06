import type { ToolCall } from '../../../types'
import { Tool } from '../base/Tool'
import { ToolExecutor, type ToolExecutionResult } from './ToolExecutor'
import { ToolCallDeduplicator, type DedupDecision } from './ToolCallDeduplicator'

export interface RunToolsOutcome {
  results: ToolExecutionResult[]
  /**
   * 本轮所有工具调用都是重复调用（无实质进展）。
   * QueryEngine 据此判断模型是否陷入探查死循环。
   */
  noProgress: boolean
}

export class ToolOrchestrator {
  private deduplicator = new ToolCallDeduplicator()

  constructor(
    private tools: Tool[],
    private executor: ToolExecutor
  ) {}

  async runTools(toolCalls: ToolCall[]): Promise<RunToolsOutcome> {
    const results: ToolExecutionResult[] = []
    const decisions: DedupDecision[] = []
    let parallelBatch: ToolCall[] = []

    const runOne = async (toolCall: ToolCall): Promise<ToolExecutionResult> => {
      const decision = this.deduplicator.inspect(toolCall)
      decisions.push(decision)

      // 重复的只读调用：回放缓存或直接拦截，不再真正执行
      if (decision.kind !== 'execute') {
        const content = decision.content
        const contentBlocks = decision.kind === 'replay' ? decision.contentBlocks : undefined
        this.executor.emitCachedResult(toolCall, content)
        return { toolCallId: toolCall.id, toolName: toolCall.name, content, contentBlocks }
      }

      const result = await this.executor.runToolUse(toolCall)
      this.deduplicator.record(toolCall, result.content, result.contentBlocks)
      return result
    }

    const flushParallelBatch = async () => {
      if (!parallelBatch.length) return
      const batchResults = await Promise.all(parallelBatch.map(runOne))
      results.push(...batchResults)
      parallelBatch = []
    }

    for (const toolCall of toolCalls) {
      if (this.isConcurrencySafe(toolCall.name)) {
        parallelBatch.push(toolCall)
        continue
      }

      await flushParallelBatch()
      results.push(await runOne(toolCall))
    }

    await flushParallelBatch()
    return { results, noProgress: this.deduplicator.isNoProgress(decisions) }
  }

  /**
   * 重置去重缓存。新一轮用户请求开始时调用。
   */
  resetDedup(): void {
    this.deduplicator.reset()
  }

  private isConcurrencySafe(toolName: string): boolean {
    const tool = this.tools.find(candidate => candidate.name === toolName)
    const maybeSafe = tool as Tool & { isConcurrencySafe?: boolean }
    if (typeof maybeSafe?.isConcurrencySafe === 'boolean') {
      return maybeSafe.isConcurrencySafe
    }

    return ['read_file', 'glob', 'grep', 'list_directory', 'find', 'task_list', 'task_get'].includes(toolName)
  }
}
