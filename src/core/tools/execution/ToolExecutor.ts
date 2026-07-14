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
  /**
   * 结构化内容块（可选）。当工具结果含图片时，携带 Anthropic 风格的
   * tool_result blocks（text + image），供 QueryEngine 存入 tool 消息，
   * 使模型能以 vision 方式"看见"图片，而非回灌 base64 文本。
   */
  contentBlocks?: unknown[]
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
      // 发送给前端的内容保留完整 metadata（含仅供 Webview 的预览数据，如图片 base64）
      const webviewContent = this.formatToolResultContent(toolResult, { forWebview: true })
      // 回灌给 LLM 的内容剔除 _webviewOnly 与 image（大体积 base64），避免灌入模型上下文
      const llmContent = this.formatToolResultContent(toolResult, { forWebview: false })
      // 若结果含图片，构造 vision block：文本占位 + image block，让模型真正"看见"图片
      const contentBlocks = this.buildVisionBlocks(toolResult, llmContent)
      this.callbacks.emitEvent({ type: 'tool_result', toolUseId: id, content: webviewContent, isError: !toolResult.success })
      this.callbacks.notifyTaskListChange(name)
      return { toolCallId: id, toolName: name, content: llmContent, contentBlocks }
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

  private formatToolResultContent(toolResult: ToolResult, options?: { forWebview?: boolean }): string {
    if (toolResult.metadata) {
      let metadata = toolResult.metadata
      // image 已由 buildVisionBlocks 单独转为 vision block，前端预览走 _webviewOnly.previews，
      // 两条通道都不需要 metadata.image 的裸 base64，一律剔除避免重复的大体积数据。
      if (metadata.image !== undefined) {
        const { image, ...rest } = metadata
        metadata = rest
      }
      // 回灌 LLM 时额外剔除 _webviewOnly（仅供前端展示的大体积数据，如图片 base64）
      if (!options?.forWebview && metadata._webviewOnly !== undefined) {
        const { _webviewOnly, ...rest } = metadata
        metadata = rest
      }
      return JSON.stringify({
        success: toolResult.success,
        content: toolResult.content,
        error: toolResult.error,
        metadata,
      })
    }

    return toolResult.success ? toolResult.content || 'Success' : `Error: ${toolResult.error}`
  }

  /**
   * 若工具结果 metadata 含 image（base64 + mime），构造 Anthropic 风格的
   * tool_result content blocks：一个 text 占位块 + 一个 image 块。
   * 这样模型能以 vision 方式"看见"图片，而不是收到裸 base64 文本。
   *
   * @param toolResult 工具执行结果
   * @param llmText    已剔除大体积数据的文本内容（作为 text 占位块）
   * @returns 含图片时返回 blocks 数组，否则返回 undefined
   */
  private buildVisionBlocks(toolResult: ToolResult, llmText: string): unknown[] | undefined {
    const image = toolResult.metadata?.image as { base64?: string; mime?: string } | undefined
    if (!image?.base64 || !image?.mime) {
      return undefined
    }

    return [
      { type: 'text', text: llmText },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mime,
          data: image.base64,
        },
      },
    ]
  }
}
