import type { ToolCall } from '../../../types'
import { Tool } from '../base/Tool'
import { ToolExecutor, type ToolExecutionResult } from './ToolExecutor'
import { ToolCallDeduplicator, type DedupDecision } from './ToolCallDeduplicator'
import { performanceLog } from '../../../utils/performanceLogger'

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
  private readonly concurrencyLimit = 4
  private runningSafeTools = 0
  private safeToolQueue: Array<() => void> = []

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

      const isSafe = this.isConcurrencySafe(toolCall.name)
      const queuedAt = performance.now()
      if (isSafe) await this.acquireSafeSlot()
      const queueMs = isSafe ? Math.round(performance.now() - queuedAt) : 0
      if (queueMs > 0) performanceLog('tool.queue', { toolName: toolCall.name, toolUseId: toolCall.id, queueMs })
      let result: ToolExecutionResult
      const executionStartedAt = performance.now()
      try {
        result = await this.executor.runToolUse(toolCall)
      } finally {
        if (isSafe) this.releaseSafeSlot()
      }
      performanceLog('tool.execution', { toolName: toolCall.name, toolUseId: toolCall.id, queueMs, durationMs: Math.round(performance.now() - executionStartedAt) })
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

  private acquireSafeSlot(): Promise<void> {
    if (this.runningSafeTools < this.concurrencyLimit) {
      this.runningSafeTools++
      return Promise.resolve()
    }
    return new Promise(resolve => {
      this.safeToolQueue.push(() => {
        this.runningSafeTools++
        resolve()
      })
    })
  }

  private releaseSafeSlot(): void {
    this.runningSafeTools = Math.max(0, this.runningSafeTools - 1)
    const next = this.safeToolQueue.shift()
    if (next) next()
  }
}
