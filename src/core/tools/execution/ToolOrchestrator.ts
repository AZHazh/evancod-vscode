import type { ToolCall } from '../../../types'
import { Tool } from '../base/Tool'
import { ToolExecutor, type ToolExecutionResult } from './ToolExecutor'

export class ToolOrchestrator {
  constructor(
    private tools: Tool[],
    private executor: ToolExecutor
  ) {}

  async runTools(toolCalls: ToolCall[]): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = []
    let parallelBatch: ToolCall[] = []

    const flushParallelBatch = async () => {
      if (!parallelBatch.length) return
      const batchResults = await Promise.all(parallelBatch.map(toolCall => this.executor.runToolUse(toolCall)))
      results.push(...batchResults)
      parallelBatch = []
    }

    for (const toolCall of toolCalls) {
      if (this.isConcurrencySafe(toolCall.name)) {
        parallelBatch.push(toolCall)
        continue
      }

      await flushParallelBatch()
      results.push(await this.executor.runToolUse(toolCall))
    }

    await flushParallelBatch()
    return results
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
