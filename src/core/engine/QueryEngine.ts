/**
 * QueryEngine - AI 对话引擎
 *
 * 职责：
 * 1. 管理与 AI 的对话流程
 * 2. 处理用户消息并调用 API
 * 3. 处理流式响应
 * 4. 工具调用和执行
 *
 * 设计说明：
 * 这是一个简化版的 QueryEngine，专门为 VSCode 插件设计。
 * 与 Desktop 版本的区别：
 * - 移除了 Bun 特定 API
 * - 简化了依赖关系
 * - 保留核心对话功能
 * - 逐步添加工具支持
 *
 * 使用流程：
 * 1. 创建 QueryEngine 实例
 * 2. 调用 query() 发送消息
 * 3. 监听 onMessage 事件接收响应
 * 4. 监听 onComplete 事件处理完成
 *
 * Phase 2 Week 1: 基础框架 + 模拟响应 ✅
 * Phase 2 Week 2: 集成真实 API ✅
 * Phase 2 Week 3: 工具调用 ← 当前完成
 */

import type { Message, ToolCall, ContentBlock, TokenUsage } from '../../types'
import type { Provider } from '../../types'
import type { AgentServerEvent } from '../../types/messages'
import { createApiClient } from '../services/api/AnthropicClient'
import { TaskManager } from '../../services/task/TaskManager'
import { PlanModeManager } from '../../services/plan/PlanModeManager'
import { AgentCoordinator } from '../../services/agent/AgentCoordinator'
import {
  Tool,
  FileReadTool,
  FileEditTool,
  FileWriteTool,
  GlobTool,
  GrepTool,
  BashTool,
  ListDirectoryTool,
  FindTool,
  CopyFileTool,
  MoveFileTool,
  DeleteFileTool,
  TaskCreateTool,
  TaskUpdateTool,
  TaskListTool,
  TaskGetTool,
  EnterPlanModeTool,
  ExitPlanModeTool,
  AskUserQuestionTool,
  AgentTool,
  LSPTool,
  WebFetchTool,
  WebSearchTool,
  NotebookEditTool,
  MCPTool,
  SkillTool,
} from '../tools'
import { IFileSystemAdapter, VSCodeFileSystemAdapter } from '../../adapters/FileSystemAdapter'
import { MCPConnectionManager } from '../../services/mcp/MCPConnectionManager'
import { SkillManager } from '../../services/skill/SkillManager'
import { MemoryManager } from '../../services/memory/MemoryManager'
import { ToolExecutor } from '../tools/execution/ToolExecutor'
import { ToolOrchestrator } from '../tools/execution/ToolOrchestrator'

/**
 * QueryEngine 配置
 */
export interface QueryEngineConfig {
  /**
   * 工作目录
   */
  cwd: string

  /**
   * 当前使用的 Provider
   */
  provider: Provider

  /**
   * 当前使用的模型
   * 例如：'claude-3-5-sonnet-20241022'
   */
  model: string

  /**
   * 消息历史
   * 包含用户和助手的所有消息
   */
  messages: Message[]

  /**
   * 详细日志（可选）
   * 用于调试
   */
  verbose?: boolean

  /**
   * Task 管理服务（可选）
   * Phase 6 Week 1: 支持任务管理工具
   */
  taskManager?: TaskManager

  /**
   * Plan Mode 管理服务（可选）
   * Phase 6 Week 2: 支持计划模式工具
   */
  planModeManager?: PlanModeManager

  /**
   * Agent 协调器（可选）
   * Phase 6 Week 3: 支持子 Agent 工具
   */
  agentCoordinator?: AgentCoordinator

  /**
   * MCP 连接管理器（可选）
   * 阶段 6: 支持 MCP 工具
   */
  mcpManager?: MCPConnectionManager

  /**
   * Skill 管理器（可选）
   * 阶段 6: 支持 Skill 工具
   */
  skillManager?: SkillManager

  /**
   * Memory 管理器（可选）
   * 阶段 6: 支持记忆上下文
   */
  memoryManager?: MemoryManager

  /**
   * Task 列表刷新回调（可选）
   */
  onTaskListChange?: () => void

  /**
   * 工具权限模式
   */
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

  /**
   * 推理程度（可选）
   * 用于决定是否启用思考模式及其 budget
   */
  effortLevel?: 'low' | 'medium' | 'high' | 'max'
}

/**
 * 流式消息回调
 */
export type OnMessageCallback = (delta: string, isComplete: boolean) => void

/**
 * 完成回调
 */
export type OnCompleteCallback = (message: Message) => void

/**
 * 错误回调
 */
export type OnErrorCallback = (error: Error) => void

export type OnAgentEventCallback = (event: AgentServerEvent) => void

export class QueryCancelledError extends Error {
  constructor(message = 'Query cancelled') {
    super(message)
    this.name = 'QueryCancelledError'
  }
}

/**
 * QueryEngine 类
 */
function mergeUsage(current: TokenUsage | undefined, next: unknown): TokenUsage | undefined {
  if (!next || typeof next !== 'object') return current
  const incoming = next as TokenUsage
  const merged: TokenUsage = { ...(current || {}) }

  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    const value = incoming[key]
    if (typeof value === 'number') {
      const previous = typeof merged[key] === 'number' ? (merged[key] as number) : 0
      merged[key] = previous + value
    }
  }

  for (const [key, value] of Object.entries(incoming)) {
    if (!(key in merged)) {
      merged[key] = value
    }
  }

  return merged
}

export class QueryEngine {
  /**
   * 配置
   */
  private config: QueryEngineConfig

  /**
   * API 客户端
   * Phase 2 Week 2: 使用真实的 AnthropicClient
   */
  private apiClient?: ReturnType<typeof createApiClient>

  /**
   * 可用工具列表
   * Phase 2 Week 3: 工具系统
   */
  private tools: Tool[] = []

  /**
   * 文件系统适配器
   * 用于工具访问文件系统
   */
  private fs?: VSCodeFileSystemAdapter

  /**
   * 消息回调
   */
  private onMessageCallback?: OnMessageCallback
  private onAgentEventCallback?: OnAgentEventCallback
  private onCompleteCallback?: OnCompleteCallback
  private onErrorCallback?: OnErrorCallback
  private permissionWaiters: Map<string, (response: { requestId: string; approved: boolean; reason?: string; updatedInput?: unknown; rule?: 'once' | 'always' }) => void> = new Map()
  private toolUseNames: Map<string, string> = new Map()
  private permissionRequestTools: Map<string, string> = new Map()
  private sessionAllowedTools: Set<string> = new Set()
  private bashTool!: BashTool
  private toolExecutor?: ToolExecutor
  private toolOrchestrator?: ToolOrchestrator
  private abortController = new AbortController()
  private cancelled = false
  private cancelReason = 'Query cancelled'

  /**
   * 构造函数
   *
   * @param config - QueryEngine 配置
   */
  constructor(config: QueryEngineConfig) {
    this.config = config
    this.initializeApiClient()
    this.initializeTools()
  }

  /**
   * 初始化工具
   * Phase 2 Week 3: 创建基础工具实例
   * Phase 4 Week 1: 添加高级工具
   * Phase 6 Week 1: 添加 Task 工具
   * Phase 6 Week 2: 添加 Plan Mode 工具
   * Phase 6 Week 3: 添加 AskUserQuestion 和 Agent 工具
   * Phase 6.5: 添加 LSP、Web、Notebook 工具
   */
  private initializeTools() {
    // 初始化文件系统适配器
    this.fs = new VSCodeFileSystemAdapter()
    this.bashTool = new BashTool(this.config.cwd)

    // 初始化所有工具
    this.tools = [
      // 基础文件操作（Phase 2 Week 3）
      new FileReadTool(this.config.cwd, this.fs),
      new FileEditTool(this.config.cwd, this.fs),
      new FileWriteTool(this.config.cwd, this.fs),

      // 搜索工具（Phase 2 Week 3）
      new GlobTool(this.config.cwd, this.fs),
      new GrepTool(this.config.cwd, this.fs),

      // 命令执行（Phase 2 Week 3）
      this.bashTool,

      // 高级文件操作（Phase 4 Week 1）
      new ListDirectoryTool(this.config.cwd, this.fs),
      new FindTool(this.config.cwd, this.fs),
      new CopyFileTool(this.config.cwd, this.fs),
      new MoveFileTool(this.config.cwd, this.fs),
      new DeleteFileTool(this.config.cwd, this.fs),

      // LSP 工具（Phase 6.5）
      new LSPTool(),

      // Web 工具（Phase 6.5）
      new WebFetchTool(),
      new WebSearchTool(),

      // Notebook 工具（Phase 6.5）
      new NotebookEditTool(),
    ]

    // 添加 Task 工具（如果提供了 TaskManager）
    if (this.config.taskManager) {
      this.tools.push(
        new TaskCreateTool(this.config.taskManager),
        new TaskUpdateTool(this.config.taskManager),
        new TaskListTool(this.config.taskManager),
        new TaskGetTool(this.config.taskManager)
      )
    }

    // 添加 Plan Mode 工具（如果提供了 PlanModeManager）
    if (this.config.planModeManager) {
      this.tools.push(
        new EnterPlanModeTool(this.config.planModeManager),
        new ExitPlanModeTool(this.config.planModeManager)
      )
    }

    // 添加 AskUserQuestion 工具
    this.tools.push(new AskUserQuestionTool())

    // 添加 Agent 工具（如果提供了 AgentCoordinator）
    if (this.config.agentCoordinator) {
      this.tools.push(
        new AgentTool(
          this.config.agentCoordinator,
          this.config.cwd,
          this.config.provider,
          this.config.model
        )
      )
    }

    // 添加 MCP 工具（如果提供了 MCPConnectionManager）
    if (this.config.mcpManager) {
      this.tools.push(new MCPTool(this.config.mcpManager))
    }

    // 添加 Skill 工具（如果提供了 SkillManager）
    if (this.config.skillManager) {
      this.tools.push(new SkillTool(this.config.skillManager))
    }

    if (this.config.verbose) {
      console.log(`Initialized ${this.tools.length} tools:`, this.tools.map(t => t.name))
    }

    this.toolExecutor = new ToolExecutor(this.tools, this.bashTool, {
      requestPermission: (toolName, toolUseId, input) => this.requestPermissionIfNeeded(toolName, toolUseId, input),
      emitEvent: event => this.onAgentEventCallback?.(event),
      notifyTaskListChange: toolName => this.notifyTaskListChange(toolName),
    })
    this.toolOrchestrator = new ToolOrchestrator(this.tools, this.toolExecutor)
  }

  private buildSystemPrompt(): string {
    return `你是 Evancod，一个在 VS Code 插件中运行的软件工程 Agent。

任务工具契约：
- 对复杂多步骤工作、plan mode、用户明确要求 todo list、或用户一次给出多个任务的请求，主动调用 task_create 创建结构化任务。
- 开始执行某个任务前，必须调用 task_update 将该任务标记为 in_progress。
- 只有工作完全完成时才能将任务标记为 completed；测试失败、实现不完整、文件缺失或仍有阻塞时不能标记 completed。
- 完成任务后，调用 task_list 查找下一项可执行任务或新解锁任务。

工具执行契约：
- 工具执行结果会作为上下文回灌。根据结果继续下一步，直到无需再调用工具。
- 对复杂、独立或上下文较重的研究任务，可以使用 agent。后台 Agent 启动后不要轮询，等待完成通知。`
  }

  /**
   * 初始化 API 客户端
   * 根据 Provider 类型创建对应的客户端
   *
   * Phase 2 Week 2: 支持 Anthropic
   * Phase 3: 支持 Bedrock, Vertex, Azure 等
   */
  private initializeApiClient() {
    const provider = this.config.provider

    if (provider.runtimeKind === 'openai_oauth') {
      throw new Error('OpenAI 官方 OAuth provider 暂不支持 VSCode 插件直连')
    }

    this.apiClient = createApiClient({
      provider,
      model: this.config.model,
      systemPrompt: this.buildSystemPrompt(),
      verbose: this.config.verbose,
      effortLevel: this.config.effortLevel,
    })
  }

  /**
   * 设置消息回调
   * 接收流式响应的每个片段
   *
   * @param callback - 回调函数
   */
  onMessage(callback: OnMessageCallback) {
    this.onMessageCallback = callback
  }

  /**
   * 设置完成回调
   * 在完整消息接收完成后调用
   *
   * @param callback - 回调函数
   */
  onComplete(callback: OnCompleteCallback) {
    this.onCompleteCallback = callback
  }

  /**
   * 设置 Agent 事件回调
   * 在模型/工具运行过程中发出结构化事件
   */
  onError(callback: OnErrorCallback) {
    this.onErrorCallback = callback
  }

  /**
   * 设置 Agent 事件回调
   * 在模型/工具运行过程中发出结构化事件
   */
  onAgentEvent(callback: OnAgentEventCallback) {
    this.onAgentEventCallback = callback
  }

  handlePermissionResponse(response: { requestId: string; approved: boolean; reason?: string; updatedInput?: unknown; rule?: 'once' | 'always' }) {
    const waiter = this.permissionWaiters.get(response.requestId)
    if (!waiter) return
    this.permissionWaiters.delete(response.requestId)
    const toolName = this.permissionRequestTools.get(response.requestId) || this.toolUseNames.get(response.requestId)
    this.permissionRequestTools.delete(response.requestId)
    if (response.approved && response.rule === 'always' && toolName) {
      this.sessionAllowedTools.add(toolName)
    }
    if (toolName === 'exit_plan_mode' && this.config.planModeManager) {
      void (response.approved
        ? this.config.planModeManager.approvePlan(response.requestId)
        : this.config.planModeManager.rejectPlan(response.requestId, response.reason || '用户拒绝了计划'))
    }
    waiter(response)
  }

  /**
   * 发送消息到 AI（支持工具调用）
   *
   * 流程：
   * 1. 验证配置
   * 2. 添加用户消息到历史
   * 3. 调用 API（流式，带工具定义）
   * 4. 处理响应（文本或工具调用）
   * 5. 如果有工具调用：
   *    a. 执行工具
   *    b. 将工具结果添加到历史
   *    c. 再次调用 AI（循环）
   * 6. 返回最终响应
   *
   * Phase 2 Week 1: 基础框架 ✅
   * Phase 2 Week 2: 真实 API 调用 ✅
   * Phase 2 Week 3: 工具系统 ✅
   * Phase 3 Week 3: 工具调用循环 ← 当前实现
   *
   * @param content - 用户消息内容
   * @param images - 可选的图片附件（Phase 3+）
   * @returns Promise<Message> 助手的响应消息
   */
  async query(content: string, contentBlocks?: ContentBlock[]): Promise<Message> {
    try {
      this.throwIfCancelled()
      this.onAgentEventCallback?.({ type: 'status', state: 'running', verb: 'query' })

      if (!this.config.provider) throw new Error('No active provider configured')
      if (!this.apiClient) throw new Error('API client not initialized')

      const userMessage: Message = {
        id: this.generateId(),
        role: 'user',
        content,
        timestamp: Date.now(),
        contentBlocks,
      }
      this.config.messages.push(userMessage)
      this.onAgentEventCallback?.({ type: 'content_start', blockType: 'text' })

      const MAX_ITERATIONS = 10
      let iteration = 0
      let finalContent = ''
      let totalUsage: TokenUsage | undefined

      while (iteration < MAX_ITERATIONS) {
        this.throwIfCancelled()
        iteration++

        const toolDefinitions = this.tools.map(tool => tool.getDefinition())
        let assistantContent = ''

        const response = await this.apiClient.sendMessageStream(
          this.config.messages,
          (delta: string, type: 'start' | 'delta' | 'end' | 'thinking') => {
            if (this.cancelled) return
            if (type === 'start') {
              this.onAgentEventCallback?.({ type: 'content_start', blockType: 'text' })
              return
            }

            if (type === 'thinking') {
              // 思考增量：单独走 thinking 事件，交由 UI 折叠展示
              this.onAgentEventCallback?.({ type: 'thinking', text: delta })
              return
            }

            if (type === 'delta') {
              this.onAgentEventCallback?.({ type: 'content_delta', text: delta })
              this.onMessageCallback?.(delta, false)
              return
            }

            this.onMessageCallback?.('', true)
          },
          toolDefinitions,
          { signal: this.abortController.signal }
        )

        this.throwIfCancelled()
        assistantContent = response.content
        totalUsage = mergeUsage(totalUsage, response.usage)

        if (response.toolCalls?.length) {
          const assistantToolCalls: ToolCall[] = response.toolCalls.map(toolCall => ({
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input,
            status: 'pending',
            startTime: Date.now(),
          }))

          for (const toolCall of assistantToolCalls) {
            this.toolUseNames.set(toolCall.id, toolCall.name)
          }

          this.config.messages.push({
            id: this.generateId(),
            role: 'assistant',
            content: assistantContent,
            timestamp: Date.now(),
            toolCalls: assistantToolCalls,
          })

          this.throwIfCancelled()
          const toolResults = await this.executeToolCalls(assistantToolCalls)
          this.throwIfCancelled()
          for (const result of toolResults) {
            this.throwIfCancelled()
            this.config.messages.push({
              id: this.generateId(),
              role: 'tool',
              content: result.content,
              timestamp: Date.now(),
              toolCallId: result.toolCallId,
              toolName: result.toolName,
            })
          }

          continue
        }

        finalContent = assistantContent
        break
      }

      if (iteration >= MAX_ITERATIONS) {
        console.warn('Reached maximum iterations')
      }

      this.throwIfCancelled()
      const finalMessage: Message = {
        id: this.generateId(),
        role: 'assistant',
        content: finalContent,
        timestamp: Date.now(),
      }
      this.config.messages.push(finalMessage)
      this.onAgentEventCallback?.({ type: 'message_complete', usage: totalUsage })
      this.onCompleteCallback?.(finalMessage)
      return finalMessage
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.onErrorCallback?.(err)
      throw err
    }
  }

  cancel(reason = 'Query cancelled'): void {
    if (this.cancelled) return
    this.cancelled = true
    this.cancelReason = reason
    this.abortController.abort()
    this.toolExecutor?.cancelAll()
    this.bashTool?.cancelAll()

    for (const [requestId, waiter] of this.permissionWaiters.entries()) {
      waiter({ requestId, approved: false, reason })
    }
    this.permissionWaiters.clear()
    this.permissionRequestTools.clear()
    this.onAgentEventCallback?.({ type: 'status', state: 'stopped', verb: 'cancelled' })
  }

  isCancelled(): boolean {
    return this.cancelled
  }

  private throwIfCancelled(): void {
    if (this.cancelled || this.abortController.signal.aborted) {
      throw new QueryCancelledError(this.cancelReason)
    }
  }

  cancelBash(toolUseId: string, taskId?: string): boolean {
    return this.bashTool.cancel(toolUseId, taskId)
  }

  /**
   * 获取消息历史
   *
   * @returns 消息数组
   */
  getMessages(): Message[] {
    return this.config.messages
  }

  /**
   * 清空消息历史
   * 用于开始新对话
   */
  clearMessages() {
    this.config.messages = []
  }

  /**
   * 执行工具调用
   * Phase 3 Week 3: 工具调用循环的核心方法
   *
   * @param toolCalls - 工具调用列表
   * @returns Promise<ToolResult[]> 工具执行结果
   */
  private async executeToolCalls(toolCalls: ToolCall[]): Promise<Array<{ toolCallId: string; toolName: string; content: string }>> {
    if (!this.toolOrchestrator) {
      throw new Error('Tool orchestrator not initialized')
    }

    return this.toolOrchestrator.runTools(toolCalls)
  }

  /**
   * 生成唯一 ID
   *
   * @returns ID 字符串
   */
  private requestPermissionIfNeeded(toolName: string, toolUseId: string, input: unknown): Promise<{ approved: boolean; reason?: string; updatedInput?: unknown }> {
    const permissionMode = this.config.permissionMode || 'default'

    if (permissionMode === 'plan' && !this.config.planModeManager?.isToolAllowedInPlanMode(toolName)) {
      return Promise.resolve({ approved: false, reason: `Plan Mode 不允许使用工具: ${toolName}` })
    }

    if (permissionMode === 'bypassPermissions' || this.sessionAllowedTools.has(toolName)) {
      return Promise.resolve({ approved: true })
    }

    const isEditTool = ['edit_file', 'write_file'].includes(toolName)
    const isDangerousTool = ['bash', 'delete_file', 'move_file', 'copy_file'].includes(toolName)
    const isInteractiveTool = toolName === 'ask_user_question'

    let requiresApproval = false
    if (permissionMode === 'plan') {
      requiresApproval = isInteractiveTool
    } else if (permissionMode === 'acceptEdits') {
      requiresApproval = isDangerousTool || isInteractiveTool
    } else {
      requiresApproval = isEditTool || isDangerousTool || isInteractiveTool
    }

    if (!requiresApproval) {
      return Promise.resolve({ approved: true })
    }

    const requestId = this.generateId()
    this.permissionRequestTools.set(requestId, toolName)
    this.onAgentEventCallback?.({
      type: 'permission_request',
      requestId,
      toolName,
      toolUseId,
      input,
      description: this.getPermissionDescription(toolName),
    })

    return new Promise(resolve => {
      const responder = (response: { requestId: string; approved: boolean; reason?: string; updatedInput?: unknown; rule?: 'once' | 'always' }) => {
        if (response.requestId !== requestId) return
        this.permissionWaiters.delete(requestId)
        resolve({ approved: response.approved, reason: response.reason, updatedInput: response.updatedInput })
      }

      this.permissionWaiters.set(requestId, responder)
      const timeoutId = setTimeout(() => {
        if (this.permissionWaiters.has(requestId)) {
          this.permissionWaiters.delete(requestId)
          this.permissionRequestTools.delete(requestId)
          resolve({ approved: false, reason: 'Permission request timed out' })
        }
      }, 5 * 60 * 1000)

      void timeoutId
    })
  }

  private notifyTaskListChange(toolName: string) {
    if (toolName.startsWith('task_')) {
      this.config.onTaskListChange?.()
    }
  }

  private formatToolResultContent(toolResult: import('../tools/base/Tool').ToolResult): string {
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

  private isDestructiveTool(toolName: string): boolean {
    return ['bash', 'delete_file', 'move_file', 'copy_file'].includes(toolName)
  }

  private getPermissionDescription(toolName: string): string | undefined {
    if (toolName === 'ask_user_question') return '请求用户回答一个问题'
    if (toolName === 'exit_plan_mode') return '提交计划并等待审批'
    if (toolName === 'write_file' || toolName === 'edit_file') return '修改工作区文件'
    if (toolName === 'mcp') return '调用外部 MCP Server 工具或资源'
    if (toolName === 'skill') return '加载并执行 Skill 提示模板'
    return undefined
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  }
}
