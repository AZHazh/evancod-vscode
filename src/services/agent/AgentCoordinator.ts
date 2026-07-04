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
import { LocalAgentTaskStore } from '../../tasks/LocalAgentTask'
import { TaskNotificationQueue } from './TaskNotificationQueue'
import { AgentWorktreeManager, type WorktreeLease } from './AgentWorktreeManager'
import type { Message, AgentTaskNotification } from '../../types'
import type { Provider } from '../../types'
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
  /** 运行中的 Agent 列表 */
  private runningAgents: Map<string, RunningAgent> = new Map()

  /** 已完成的 Agent 结果 */
  private completedResults: Map<string, SubAgentResult> = new Map()

  /** Webview 管理器（可选，用于发送消息到 UI） */
  private webviewManager?: IWebviewManager

  private readonly taskStore: LocalAgentTaskStore
  private readonly taskNotificationQueue = new TaskNotificationQueue()
  private readonly worktreeManager = new AgentWorktreeManager()
  private sharedServices?: {
    taskManager?: TaskManager
    planModeManager?: PlanModeManager
    mcpManager?: MCPConnectionManager
    skillManager?: SkillManager
    memoryManager?: MemoryManager
    onTaskListChange?: () => void
    permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
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
    permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
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
      taskManager: this.sharedServices?.taskManager,
      planModeManager: this.sharedServices?.planModeManager,
      agentCoordinator: this,
      mcpManager: this.sharedServices?.mcpManager,
      skillManager: this.sharedServices?.skillManager,
      memoryManager: this.sharedServices?.memoryManager,
      onTaskListChange: this.sharedServices?.onTaskListChange,
      permissionMode: this.sharedServices?.permissionMode,
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
    try {
      // 构造系统提示词
      const systemPrompt = this.buildSystemPrompt(config.type, config.description)

      // 执行查询
      const message = await engine.query(`${systemPrompt}\n\n${config.prompt}`, [])

      // 计算执行时间
      const duration = Date.now() - startTime

      // 提取摘要
      const summary = this.extractSummary(message.content)

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
   * 取消子 Agent
   *
   * @param agentId - Agent ID
   */
  cancelAgent(agentId: string): void {
    const running = this.runningAgents.get(agentId)
    if (!running || running.cancelRequested) return

    running.cancelRequested = true
    running.engine.cancel('Agent cancelled by user')
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
   * 提取摘要
   *
   * 从完整输出中提取关键信息作为摘要
   *
   * @param fullOutput - 完整输出
   * @returns 摘要
   */
  private extractSummary(fullOutput: string): string {
    // 简单实现：取前 500 个字符
    // TODO: 使用更智能的摘要算法
    if (fullOutput.length <= 500) {
      return fullOutput
    }

    return fullOutput.substring(0, 500) + '...\n\n（输出已截断，完整内容请查看 fullOutput）'
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
  }
}
