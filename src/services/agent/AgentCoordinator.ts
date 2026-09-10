/**
 * AgentCoordinator - 子 Agent 协调器
 *
 * 职责：
 * 1. 创建和管理子 Agent 生命周期
 * 2. 调度子 Agent 执行任务
 * 3. 收集子 Agent 结果
 * 4. 提供前台和后台执行模式
 *
 * 使用场景：
 * - 主 Agent 需要执行独立的研究任务
 * - 并行执行多个子任务
 * - 隔离执行上下文，避免污染主对话
 *
 * 设计原则：
 * - 每个子 Agent 有独立的上下文
 * - 子 Agent 不能修改主 Agent 的状态
 * - 子 Agent 的结果摘要返回给主 Agent
 * - 支持前台（阻塞）和后台（非阻塞）执行
 *
 * 子 Agent 类型：
 * - explore: 探索型 Agent，用于代码库研究、文件搜索
 * - analyze: 分析型 Agent，用于代码分析、依赖分析
 * - research: 研究型 Agent，用于查找文档、最佳实践
 */

import * as vscode from 'vscode'
import { QueryCancelledError, QueryEngine, QueryEngineConfig } from '../../core/engine/QueryEngine'
import { createApiClient } from '../../core/services/api'
import { LocalAgentTaskStore } from '../../tasks/LocalAgentTask'
import { TaskNotificationQueue } from './TaskNotificationQueue'
import { AgentWorktreeManager, type WorktreeLease } from './AgentWorktreeManager'
import type { PermissionMode, Provider } from '../../types'
import type { AgentServerEvent } from '../../types/messages'
import type { TaskManager } from '../task/TaskManager'
import type { PlanModeManager } from '../plan/PlanModeManager'
import type { MCPConnectionManager } from '../mcp/MCPConnectionManager'
import type { SkillManager } from '../skill/SkillManager'
import type { MemoryManager } from '../memory/MemoryManager'

// 前向声明，避免循环依赖
interface IWebviewManager {
  sendAgentStarted(agent: any): void
  sendAgentCompleted(result: SubAgentResult): void
  sendAgentEvent(event: AgentServerEvent): void
}

/**
 * 子 Agent 类型
 */
export type AgentType = 'explore' | 'analyze' | 'research'

/**
 * 子 Agent 执行模式
 */
export type ExecutionMode = 'foreground' | 'background'

/**
 * 子 Agent 配置
 */
export interface SubAgentConfig {
  /** Agent ID */
  id: string

  /** Agent 类型 */
  type: AgentType

  /** Agent 描述 */
  description: string

  /** 任务提示词 */
  prompt: string

  /** 执行模式 */
  mode: ExecutionMode

  /** 工作目录 */
  cwd: string

  /** Provider 配置 */
  provider: Provider

  /** 模型 */
  model: string

  /** 是否详细输出 */
  verbose?: boolean

  /** 发起该 Agent 工具调用的 toolUseId */
  toolUseId?: string

  /** 可选 Agent 名称 */
  name?: string

  /** 可选团队名称，用于 UI 分组 */
  teamName?: string

  /** 隔离模式 */
  isolation?: 'none' | 'worktree'
}

/**
 * 子 Agent 结果
 */
export interface SubAgentResult {
  /** Agent ID */
  id: string

  /** 是否成功 */
  success: boolean

  /** 结果摘要 */
  summary: string

  /** 完整输出（可选） */
  fullOutput?: string

  /** 错误信息（如果失败） */
  error?: string

  /** 执行时间（毫秒） */
  duration: number

  /** 是否被取消 */
  cancelled?: boolean
}

/**
 * 运行中的子 Agent
 */
interface RunningAgent {
  id: string
  config: SubAgentConfig
  engine: QueryEngine
  startTime: number
  promise: Promise<SubAgentResult>
  cancelRequested: boolean
  finalized: boolean
  worktree?: WorktreeLease
  effectiveCwd: string
}

export class AgentCoordinator {
  private static readonly AGENT_TIMEOUT_MS = 10 * 60 * 1000
  /** 运行中的 Agent 列表 */
  private runningAgents: Map<string, RunningAgent> = new Map()

  /** 已完成的 Agent 结果 */
  private completedResults: Map<string, SubAgentResult> = new Map()

  /** Webview 管理器（可选，用于发送消息到 UI） */
  private webviewManager?: IWebviewManager

  private readonly taskStore: LocalAgentTaskStore
  private readonly taskNotificationQueue = new TaskNotificationQueue()
  private readonly worktreeManager = new AgentWorktreeManager()
  private readonly permissionRequests = new Map<
    string,
    { agentId: string; engine: QueryEngine }
  >()
  private readonly interactionRequests = new Map<
    string,
    { agentId: string; engine: QueryEngine }
  >()
  private sharedServices?: {
    taskManager?: TaskManager
    planModeManager?: PlanModeManager
    mcpManager?: MCPConnectionManager
    skillManager?: SkillManager
    memoryManager?: MemoryManager
    onTaskListChange?: () => void
    getPermissionMode?: () => PermissionMode
  }

  /**
   * 构造函数
   *
   * @param context - VSCode Extension Context
   */
  constructor(private context: vscode.ExtensionContext) {
    this.taskStore = new LocalAgentTaskStore(context)
  }

  /**
   * 设置 Webview 管理器
   * 用于发送消息到 UI
   *
   * @param manager - Webview 管理器实例
   */
  setWebviewManager(manager: IWebviewManager): void {
    this.webviewManager = manager
  }

  setSharedServices(services: {
    taskManager?: TaskManager
    planModeManager?: PlanModeManager
    mcpManager?: MCPConnectionManager
    skillManager?: SkillManager
    memoryManager?: MemoryManager
    onTaskListChange?: () => void
    getPermissionMode?: () => PermissionMode
  }): void {
    this.sharedServices = services
  }

  async restorePersistedTasks(): Promise<void> {
    const tasks = await this.taskStore.list()
    for (const task of tasks) {
      if (task.status === 'running') {
        await this.taskStore.update(task.id, {
          status: 'stopped',
          completedAt: new Date().toISOString(),
          error: 'Agent was interrupted by VS Code reload before completion.',
        })
        continue
      }

      if (task.status === 'completed' || task.status === 'failed') {
        const fullOutput = await this.taskStore.readOutput(task.id)
        this.completedResults.set(task.id, {
          id: task.id,
          success: task.status === 'completed',
          summary: task.summary || (task.status === 'completed' ? 'Agent 执行完成' : 'Agent 执行失败'),
          fullOutput,
          error: task.error,
          duration: task.durationMs || 0,
        })
      }
    }
  }

  /**
   * 启动子 Agent
   *
   * @param config - 子 Agent 配置
   * @returns 子 Agent 结果（前台模式）或 Agent ID（后台模式）
   */
  async startAgent(config: SubAgentConfig): Promise<SubAgentResult | string> {
    const worktree = config.isolation === 'worktree'
      ? await this.worktreeManager.prepare({ agentId: config.id, cwd: config.cwd })
      : undefined
    const effectiveCwd = worktree?.worktreePath || config.cwd

    // 创建 QueryEngine
    const engineConfig: QueryEngineConfig = {
      cwd: effectiveCwd,
      provider: config.provider,
      model: config.model,
      messages: [],
      verbose: config.verbose || false,
      // explore/analyze/research 子 Agent 是只读调查者，不能接管主任务或递归派生 Agent。
      skillManager: this.sharedServices?.skillManager,
      memoryManager: this.sharedServices?.memoryManager,
      permissionMode: 'default',
      readOnly: true,
      maxIterations: 30,
    }

    const engine = new QueryEngine(engineConfig)

    // 记录开始时间
    const startTime = Date.now()
    const startedAt = new Date(startTime).toISOString()

    await this.taskStore.create({
      id: config.id,
      toolUseId: config.toolUseId,
      type: config.type,
      description: config.description,
      prompt: config.prompt,
      cwd: effectiveCwd,
      model: config.model,
      status: 'running',
      startedAt,
      updatedAt: startedAt,
    })

    const emitSubAgentEvent = async (event: AgentServerEvent) => {
      await this.taskStore.appendTranscript(config.id, {
        timestamp: new Date().toISOString(),
        event,
      })
    }
    engine.onAgentEvent(event => {
      void emitSubAgentEvent(event)
      if (event.type === 'permission_request') {
        this.permissionRequests.set(event.requestId, { agentId: config.id, engine })
        this.webviewManager?.sendAgentEvent({
          ...event,
          description: event.description
            ? `子 Agent「${config.description}」：${event.description}`
            : `子 Agent「${config.description}」请求执行 ${event.toolName}`,
        })
      } else if (event.type === 'interaction_request') {
        this.interactionRequests.set(event.requestId, { agentId: config.id, engine })
        this.webviewManager?.sendAgentEvent({
          ...event,
          description: `子 Agent「${config.description}」需要用户输入`,
        })
      } else if (
        event.type === 'tool_use_complete' ||
        event.type === 'tool_result'
      ) {
        this.webviewManager?.sendAgentEvent({
          ...event,
          parentToolUseId: event.parentToolUseId || config.toolUseId,
        })
      } else if (event.type === 'bash_output' || event.type === 'bash_status') {
        this.webviewManager?.sendAgentEvent(event)
      } else if (event.type === 'permission_response') {
        this.webviewManager?.sendAgentEvent(event)
      }
    })

    // 创建执行 Promise
    const promise = this.executeAgent(config, engine, startTime)

    // 保存到运行中列表
    const runningAgent: RunningAgent = {
      id: config.id,
      config,
      engine,
      startTime,
      promise,
      cancelRequested: false,
      finalized: false,
      worktree,
      effectiveCwd,
    }
    this.runningAgents.set(config.id, runningAgent)

    // 发送启动消息到 Webview
    if (this.webviewManager) {
      this.webviewManager.sendAgentStarted({
        id: config.id,
        type: config.type,
        description: config.description,
        mode: config.mode,
        isolation: config.isolation || 'none',
        cwd: effectiveCwd,
        startTime
      })
    }

    // 根据执行模式返回
    if (config.mode === 'foreground') {
      // 前台模式：等待完成
      const result = await promise
      await this.finalizeAgent(config, result)

      return result
    } else {
      // 后台模式：立即返回 Agent ID
      promise.then((result) => {
        void this.finalizeAgent(config, result)
      })
      return config.id
    }
  }

  /**
   * 执行子 Agent
   *
   * @param config - 子 Agent 配置
   * @param engine - QueryEngine 实例
   * @param startTime - 开始时间
   * @returns 子 Agent 结果
   */
  private async executeAgent(
    config: SubAgentConfig,
    engine: QueryEngine,
    startTime: number
  ): Promise<SubAgentResult> {
    const timeout = setTimeout(() => {
      engine.cancel(`子 Agent 执行超过 ${AgentCoordinator.AGENT_TIMEOUT_MS / 60_000} 分钟，已自动停止`)
    }, AgentCoordinator.AGENT_TIMEOUT_MS)
    try {
      // 构造系统提示词
      const systemPrompt = this.buildSystemPrompt(config.type, config.description)

      // 执行查询
      const message = await engine.query(`${systemPrompt}\n\n${config.prompt}`, [])

      // 为主 Agent 生成一份保留结论与证据的语义摘要。完整输出仍单独保存，
      // 避免为了节省上下文而把关键结论简单截掉，导致主 Agent 重复调查。
      const summary = await this.summarizeResult(config, message.content)
      const duration = Date.now() - startTime

      return {
        id: config.id,
        success: true,
        summary,
        fullOutput: message.content,
        duration
      }
    } catch (error) {
      const duration = Date.now() - startTime
      if (error instanceof QueryCancelledError || engine.isCancelled()) {
        return {
          id: config.id,
          success: false,
          cancelled: true,
          summary: 'Agent 已停止',
          error: error instanceof Error ? error.message : 'Agent 已停止',
          duration,
        }
      }

      return {
        id: config.id,
        success: false,
        summary: 'Agent 执行失败',
        error: error instanceof Error ? error.message : String(error),
        duration
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private async finalizeAgent(config: SubAgentConfig, result: SubAgentResult): Promise<void> {
    const running = this.runningAgents.get(config.id)
    if (running?.finalized) return
    if (running) running.finalized = true

    const finalStatus = running?.cancelRequested || result.cancelled ? 'stopped' : result.success ? 'completed' : 'failed'
    const finalResult: SubAgentResult = {
      ...result,
      success: finalStatus === 'completed',
      cancelled: finalStatus === 'stopped' ? true : result.cancelled,
      summary: finalStatus === 'stopped' ? result.summary || 'Agent 已停止' : result.summary,
      error: finalStatus === 'stopped' ? result.error || 'Agent 已停止' : result.error,
    }

    this.completedResults.set(config.id, finalResult)

    const outputText = finalResult.success ? finalResult.fullOutput || finalResult.summary : finalResult.error || finalResult.summary
    const outputFile = await this.taskStore.writeOutput(config.id, outputText || '')
    const completedAt = new Date().toISOString()

    await this.taskStore.update(config.id, {
      status: finalStatus,
      summary: finalResult.summary,
      outputFile,
      completedAt,
      durationMs: finalResult.duration,
      error: finalResult.error,
    })

    let cleanupWarning: string | undefined
    if (running?.worktree) {
      cleanupWarning = await this.worktreeManager.cleanup(running.worktree)
      if (cleanupWarning) {
        await this.taskStore.update(config.id, {
          error: finalResult.error ? `${finalResult.error}\n\n${cleanupWarning}` : cleanupWarning,
        })
      }
    }

    this.runningAgents.delete(config.id)
    this.clearPermissionRequests(config.id)
    this.clearInteractionRequests(config.id)

    if (!this.webviewManager) return

    this.webviewManager.sendAgentCompleted(finalResult)
    const notification = this.taskNotificationQueue.buildAgentNotification({
      taskId: finalResult.id,
      toolUseId: config.toolUseId,
      status: finalStatus,
      summary: finalResult.summary,
      result: finalResult.success ? finalResult.fullOutput : finalResult.error,
      outputFile,
      usage: {
        durationMs: finalResult.duration,
      },
      description: config.description,
      error: cleanupWarning ? (finalResult.error ? `${finalResult.error}\n\n${cleanupWarning}` : cleanupWarning) : finalResult.error,
      cwd: running?.effectiveCwd || config.cwd,
      isolation: config.isolation || 'none',
      worktreePath: running?.worktree?.worktreePath,
    })
    if (notification) {
      this.webviewManager.sendAgentEvent({
        type: 'system_notification',
        subtype: 'task_notification',
        message: `Agent "${config.description}" ${finalStatus}`,
        data: notification,
      })
    }
  }

  /**
   * 获取子 Agent 结果
   *
   * @param agentId - Agent ID
   * @returns 子 Agent 结果，如果还在运行则返回 null
   */
  getAgentResult(agentId: string): SubAgentResult | null {
    return this.completedResults.get(agentId) || null
  }

  /**
   * 等待子 Agent 完成
   *
   * @param agentId - Agent ID
   * @returns 子 Agent 结果
   */
  async waitForAgent(agentId: string): Promise<SubAgentResult> {
    // 检查是否已完成
    const completed = this.completedResults.get(agentId)
    if (completed) {
      return completed
    }

    // 检查是否正在运行
    const running = this.runningAgents.get(agentId)
    if (running) {
      return await running.promise
    }

    throw new Error(`Agent not found: ${agentId}`)
  }

  /**
   * 列出所有运行中的 Agent
   *
   * @returns Agent ID 列表
   */
  listRunningAgents(): string[] {
    return Array.from(this.runningAgents.keys())
  }

  /**
   * 列出所有已完成的 Agent
   *
   * @returns Agent ID 列表
   */
  listCompletedAgents(): string[] {
    return Array.from(this.completedResults.keys())
  }

  /**
   * 将权限响应路由到发起请求的子 Agent。
   *
   * @returns 是否命中了子 Agent 的待处理权限请求
   */
  handlePermissionResponse(response: {
    requestId: string
    approved: boolean
    reason?: string
    updatedInput?: unknown
    rule?: 'once' | 'always'
  }): boolean {
    const request = this.permissionRequests.get(response.requestId)
    if (!request) return false

    this.permissionRequests.delete(response.requestId)
    return request.engine.handlePermissionResponse(response)
  }

  handleInteractionResponse(response: {
    requestId: string
    answered: boolean
    answers?: unknown
    reason?: string
  }): boolean {
    const request = this.interactionRequests.get(response.requestId)
    if (!request) return false

    this.interactionRequests.delete(response.requestId)
    request.engine.handleInteractionResponse(response)
    return true
  }

  /**
   * 取消子 Agent
   *
   * @param agentId - Agent ID
   */
  cancelAgent(agentId: string, reason = 'Agent cancelled by user'): void {
    const running = this.runningAgents.get(agentId)
    if (!running || running.cancelRequested) return

    running.cancelRequested = true
    running.engine.cancel(reason)
    this.clearPermissionRequests(agentId)
    this.clearInteractionRequests(agentId)
  }

  /**
   * 取消并等待当前所有子 Agent 完成清理。
   */
  async cancelAllAgents(reason = 'Agent cancelled by user'): Promise<void> {
    const runningAgents = Array.from(this.runningAgents.values())
    for (const running of runningAgents) {
      this.cancelAgent(running.id, reason)
    }

    await Promise.allSettled(
      runningAgents.map(async running => {
        const result = await running.promise
        await this.finalizeAgent(running.config, result)
      })
    )
  }

  private clearPermissionRequests(agentId: string): void {
    for (const [requestId, request] of this.permissionRequests) {
      if (request.agentId === agentId) {
        this.permissionRequests.delete(requestId)
      }
    }
  }

  private clearInteractionRequests(agentId: string): void {
    for (const [requestId, request] of this.interactionRequests) {
      if (request.agentId === agentId) {
        this.interactionRequests.delete(requestId)
      }
    }
  }

  /**
   * 清理已完成的 Agent 结果
   *
   * @param agentId - Agent ID（可选，不提供则清理所有）
   */
  clearResults(agentId?: string): void {
    if (agentId) {
      this.completedResults.delete(agentId)
    } else {
      this.completedResults.clear()
    }
  }

  /**
   * 构造系统提示词
   *
   * @param type - Agent 类型
   * @param description - Agent 描述
   * @returns 系统提示词
   */
  private buildSystemPrompt(type: AgentType, description: string): string {
    const basePrompt = `你是一个专门的子 Agent，负责执行特定的任务。\n\n任务描述：${description}\n\n`

    const typePrompts: Record<AgentType, string> = {
      explore: `你的角色是探索型 Agent。
- 使用文件搜索工具（glob、grep、find）查找相关文件
- 使用文件读取工具（read_file）查看文件内容
- 分析代码库结构和组织方式
- 找出关键文件和模块
- 总结发现的内容`,

      analyze: `你的角色是分析型 Agent。
- 使用代码分析工具（analyze_ast、analyze_dependencies）分析代码
- 理解代码结构、依赖关系、设计模式
- 识别潜在问题和改进点
- 提供分析报告`,

      research: `你的角色是研究型 Agent。
- 查找相关文档和最佳实践
- 理解技术概念和实现方式
- 提供建议和指导
- 总结研究发现`
    }

    return basePrompt + typePrompts[type]
  }

  /**
   * 将子 Agent 的完整报告压缩为可直接交给主 Agent 继续工作的语义摘要。
   *
   * 短报告无需二次改写；长报告优先使用低成本模型提炼。摘要失败时返回
   * 完整报告，而不是做有损的字符截断，确保主 Agent 不会因证据缺失而重做。
   */
  private async summarizeResult(config: SubAgentConfig, fullOutput: string): Promise<string> {
    const normalizedOutput = fullOutput.trim()
    if (!normalizedOutput) return '子 Agent 已完成，但没有返回文本结果。'
    if (normalizedOutput.length <= 1200) return normalizedOutput

    const summaryModel = config.provider.models.haiku?.trim() || config.model
    const summaryClient = createApiClient({
      provider: config.provider,
      model: summaryModel,
      systemPrompt: `你负责把子 Agent 的执行报告整理成供主 Agent 直接继续工作的高保真摘要。

要求：
- 只依据报告内容，不补充、猜测或美化事实。
- 优先保留最终结论、根因、已完成工作、验证结果、失败信息和未解决事项。
- 保留关键文件路径、符号名、命令、错误文本、配置值和其他可复查证据。
- 明确区分已验证事实、推断和建议；任务未完成时必须明确说明阻塞点。
- 删除重复的探索过程、寒暄和无助于后续行动的细节。
- 摘要必须自包含，使主 Agent 无需重新读取相同文件或重复相同调查。
- 使用简体中文和清晰的小标题；不要输出前言，也不要声称查看了原报告之外的内容。`,
      maxTokens: 1800,
      temperature: 0.2,
      effortLevel: 'low',
    })

    try {
      const summary = await summaryClient.sendMessage([
        {
          id: `agent-summary-${config.id}`,
          role: 'user',
          content: `子 Agent 任务：${config.description}\n\n任务指令：\n${config.prompt}\n\n完整执行报告：\n${normalizedOutput}`,
          timestamp: Date.now(),
        },
      ])
      const normalizedSummary = summary.trim()
      if (normalizedSummary) return normalizedSummary
      console.warn(`[AgentCoordinator] Agent ${config.id} 摘要模型返回空内容，使用完整输出`)
    } catch (error) {
      console.warn(
        `[AgentCoordinator] Agent ${config.id} 语义摘要生成失败，使用完整输出:`,
        error
      )
    }

    return `摘要生成失败，以下为子 Agent 的完整结果：\n\n${normalizedOutput}`
  }

  /**
   * 销毁协调器
   */
  dispose(): void {
    // 取消所有运行中的 Agent
    for (const agentId of this.runningAgents.keys()) {
      this.cancelAgent(agentId)
    }

    this.runningAgents.clear()
    this.completedResults.clear()
    this.permissionRequests.clear()
    this.interactionRequests.clear()
  }
}
