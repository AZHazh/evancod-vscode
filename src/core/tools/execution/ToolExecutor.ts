import type { AgentServerEvent } from '../../../types/messages'
import type { ToolCall } from '../../../types'
import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { BashTool, type BashExecutionContext } from './BashTool'

export interface ToolPermissionResult {
  approved: boolean
  reason?: string
  updatedInput?: unknown
}

export interface ToolExecutorCallbacks {
  requestPermission: (toolName: string, toolUseId: string, input: unknown) => Promise<ToolPermissionResult>
  emitEvent: (event: AgentServerEvent) => void
  notifyTaskListChange: (toolName: string) => void
}

export interface ToolExecutionResult {
  toolCallId: string
  toolName: string
  content: string
}

export class ToolExecutor {
  private activeToolUseIds = new Set<string>()

  constructor(
    private tools: Tool[],
    private bashTool: BashTool,
    private callbacks: ToolExecutorCallbacks
  ) {}

  async runToolUse(toolCall: ToolCall): Promise<ToolExecutionResult> {
    const { id, name, input } = toolCall
    const tool = this.tools.find(candidate => candidate.name === name)

    if (!tool) {
      return this.emitErrorResult(id, name, `Tool "${name}" not found`)
    }

    const schemaError = this.validateInput(tool.getDefinition(), input)
    if (schemaError) {
      return this.emitErrorResult(id, name, schemaError)
    }

    const permission = await this.callbacks.requestPermission(name, id, input)
    if (!permission.approved) {
      return this.emitErrorResult(id, name, permission.reason || 'Permission denied')
    }

    const executionInput = this.resolveExecutionInput(name, input, permission.updatedInput)

    this.callbacks.emitEvent({
      type: 'content_start',
      blockType: 'tool_use',
      toolName: name,
      toolUseId: id,
    })
    this.callbacks.emitEvent({
      type: 'tool_use_complete',
      toolName: name,
      toolUseId: id,
      input: executionInput,
    })

    try {
      this.activeToolUseIds.add(id)
      const toolResult = await this.executeTool(tool, name, id, executionInput)
      const content = this.formatToolResultContent(toolResult)
      this.callbacks.emitEvent({ type: 'tool_result', toolUseId: id, content, isError: !toolResult.success })
      this.callbacks.notifyTaskListChange(name)
      return { toolCallId: id, toolName: name, content }
    } catch (error) {
      const content = `Error: ${error instanceof Error ? error.message : '未知错误'}`
      this.callbacks.emitEvent({ type: 'tool_result', toolUseId: id, content, isError: true })
      this.callbacks.notifyTaskListChange(name)
      return { toolCallId: id, toolName: name, content }
    } finally {
      this.activeToolUseIds.delete(id)
    }
  }

  cancelAll(): void {
    for (const toolUseId of this.activeToolUseIds) {
      this.bashTool.cancel(toolUseId)
    }
    this.bashTool.cancelAll()
  }

  private async executeTool(tool: Tool, toolName: string, toolUseId: string, input: unknown): Promise<ToolResult> {
    if (toolName !== 'bash') {
      return tool.execute(input, { toolUseId })
    }

    const context: BashExecutionContext = {
      toolUseId,
      onOutput: event => this.callbacks.emitEvent({
        type: 'bash_output',
        toolUseId: event.toolUseId,
        taskId: event.taskId,
        stream: event.stream,
        text: event.text,
      }),
      onStatus: event => this.callbacks.emitEvent({
        type: 'bash_status',
        toolUseId: event.toolUseId,
        taskId: event.taskId,
        status: event.status,
        exitCode: event.exitCode,
      }),
    }

    return this.bashTool.execute(input as any, context)
  }

  private emitErrorResult(toolUseId: string, toolName: string, error: string): ToolExecutionResult {
    const content = JSON.stringify({ success: false, error })
    this.callbacks.emitEvent({ type: 'tool_result', toolUseId, content, isError: true })
    return { toolCallId: toolUseId, toolName, content }
  }

  private resolveExecutionInput(toolName: string, input: unknown, updatedInput: unknown): unknown {
    if (toolName === 'ask_user_question' && updatedInput && typeof updatedInput === 'object') {
      return { ...(input as Record<string, unknown>), ...(updatedInput as Record<string, unknown>) }
    }

    return updatedInput ?? input
  }

  private validateInput(definition: ToolDefinition, input: unknown): string | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return `Invalid input for ${definition.name}: expected object`
    }

    const record = input as Record<string, unknown>
    for (const requiredKey of definition.input_schema.required || []) {
      if (!(requiredKey in record)) {
        return `Invalid input for ${definition.name}: missing required field "${requiredKey}"`
      }
    }

    for (const [key, parameter] of Object.entries(definition.input_schema.properties)) {
      if (!(key in record) || record[key] === undefined || record[key] === null) continue
      if (!this.matchesType(record[key], parameter.type)) {
        return `Invalid input for ${definition.name}: field "${key}" must be ${parameter.type}`
      }
    }

    return null
  }

  private matchesType(value: unknown, type: string): boolean {
    if (type === 'array') return Array.isArray(value)
    if (type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value)
    return typeof value === type
  }

  private formatToolResultContent(toolResult: ToolResult): string {
    if (toolResult.metadata) {
      return JSON.stringify({
        success: toolResult.success,
        content: toolResult.content,
        error: toolResult.error,
        metadata: toolResult.metadata,
      })
    }

    return toolResult.success ? toolResult.content || 'Success' : `Error: ${toolResult.error}`
  }
}
