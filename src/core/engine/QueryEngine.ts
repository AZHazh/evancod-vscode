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
import { createApiClient } from '../services/api'
import type { ImageStreamEvent } from '../services/api'
import { saveGeneratedImages, timestampedImagePath } from '../tools/image/imageStorage'
import { TaskManager } from '../../services/task/TaskManager'
import { PlanModeManager } from '../../services/plan/PlanModeManager'
import { AgentCoordinator } from '../../services/agent/AgentCoordinator'
import {
  getContextWindowForModel,
  getEffectiveContextWindow,
} from '../../utils/model/modelContextWindows'
import {
  microcompact,
  shouldMicrocompact,
  estimateMessagesTokens,
} from '../../services/compact/microcompact'
import { closeDanglingToolCalls as repairDanglingToolCalls } from '../services/api/toolMessageSanitizer'
import { compactConversation } from '../../services/compact/compact'
import { shouldAutoCompact } from '../../services/compact/autoCompact'
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
  ImageGenTool,
} from '../tools'
import { IFileSystemAdapter, VSCodeFileSystemAdapter } from '../../adapters/FileSystemAdapter'
import { MCPConnectionManager } from '../../services/mcp/MCPConnectionManager'
import { SkillManager } from '../../services/skill/SkillManager'
import { MemoryManager } from '../../services/memory/MemoryManager'
import { ToolExecutor } from '../tools/execution/ToolExecutor'
import { ToolOrchestrator, type RunToolsOutcome } from '../tools/execution/ToolOrchestrator'
import { performanceLog, performanceSnapshot } from '../../utils/performanceLogger'

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

  /**
   * 专用生图服务商（可选）
   * apiFormat 为 openai_image 的 Provider，用于调用 /v1/images/generations
   */
  imageProvider?: Provider

  /**
   * 工具调用循环的最大迭代次数（可选）
   * 每次 API 轮次（含工具调用）消耗一次迭代。多步任务需要较高的上限，
   * 否则会在闭环前被截断。默认 100。
   */
  maxIterations?: number
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

  for (const key of [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
  ] as const) {
    const value = incoming[key]
    if (typeof value === 'number') {
      const previous = typeof merged[key] === 'number' ? (merged[key] as number) : 0
      merged[key] = previous + value
    }
  }

  // 记录最后一次请求的实际 input tokens（不累加）
  if (typeof incoming.inputTokens === 'number') {
    merged.lastPromptTokens = incoming.inputTokens
  }

  for (const [key, value] of Object.entries(incoming)) {
    if (!(key in merged)) {
      merged[key] = value
    }
  }

  return merged
}

function isExplicitContinuationRequest(content: string): boolean {
  const normalized = content.trim().toLowerCase()
  return /^(继续|继续执行|接着|接着做|往下做|continue|resume)[\s，。,.!！?？]*/.test(normalized)
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
  private permissionWaiters: Map<
    string,
    (response: {
      requestId: string
      approved: boolean
      reason?: string
      updatedInput?: unknown
      rule?: 'once' | 'always'
    }) => void
  > = new Map()
  private interactionWaiters: Map<
    string,
    (response: {
      requestId: string
      answered: boolean
      answers?: unknown
      reason?: string
    }) => void
  > = new Map()
  private toolUseNames: Map<string, string> = new Map()
  private permissionRequestTools: Map<string, string> = new Map()
  private permissionStartedAt: Map<string, number> = new Map()
  private sessionAllowedTools: Set<string> = new Set()
  private bashTool!: BashTool
  private toolExecutor?: ToolExecutor
  private toolOrchestrator?: ToolOrchestrator
  private abortController = new AbortController()
  private cancelled = false
  private cancelReason = 'Query cancelled'
  private consecutiveCompactFailures = 0

  // 性能优化：content_delta / thinking 批量合并
  // 高频事件在微任务队列中累积，每 ~32ms 发送一次合并后的事件，
  // 减少 onAgentEventCallback 的调用次数（链路上接了 recordAgentEvent + postMessage）。
  // 关键事件（message_complete / tool_use_complete / permission_request 等）不合并。
  /**
   * 按上游到达顺序保存增量。正文和思考不能拆成两个独立缓冲区，
   * 否则 flush 时固定的发送顺序会把同一轮的 thinking/text 重新排序。
   */
  private pendingDeltas: Array<{ type: 'content_delta' | 'thinking'; text: string }> = []
  private deltaFlushTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * 立即 flush 所有待处理的 delta 事件，保证顺序：在发送关键事件前先 flush。
   */
  private flushPendingDeltas(): void {
    if (this.deltaFlushTimer) {
      clearTimeout(this.deltaFlushTimer)
      this.deltaFlushTimer = undefined
    }
    const pending = this.pendingDeltas
    this.pendingDeltas = []
    for (const delta of pending) {
      if (delta.type === 'content_delta') {
        this.onAgentEventCallback?.({ type: 'content_delta', text: delta.text })
      } else {
        this.onAgentEventCallback?.({ type: 'thinking', text: delta.text })
      }
    }
  }

  /**
   * 累积 content_delta，32ms 后批量发送。
   */
  private emitContentDelta(text: string): void {
    this.enqueueDelta('content_delta', text)
    this.onMessageCallback?.(text, false)
  }

  /**
   * 累积 thinking delta，32ms 后批量发送。
   */
  private emitThinkingDelta(text: string): void {
    this.enqueueDelta('thinking', text)
  }

  private enqueueDelta(type: 'content_delta' | 'thinking', text: string): void {
    if (!text) return

    const last = this.pendingDeltas[this.pendingDeltas.length - 1]
    if (last?.type === type) {
      last.text += text
    } else {
      this.pendingDeltas.push({ type, text })
    }

    if (!this.deltaFlushTimer) {
      this.deltaFlushTimer = setTimeout(() => {
        this.deltaFlushTimer = undefined
        this.flushPendingDeltas()
      }, 32)
    }
  }

  /**
   * 构造函数
   *
   * @param config - QueryEngine 配置
   */
  constructor(config: QueryEngineConfig) {
    this.config = config
    this.closeDanglingToolCalls()
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

      // 图像生成工具（使用当前服务商凭证调用图像 API）
      new ImageGenTool(this.config.cwd, this.config.provider, this.config.imageProvider),
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

    // if (this.config.verbose) {
    //   console.log(`Initialized ${this.tools.length} tools:`, this.tools.map(t => t.name))
    // }

    this.toolExecutor = new ToolExecutor(this.tools, this.bashTool, {
      requestPermission: (toolName, toolUseId, input) =>
        this.requestPermissionIfNeeded(toolName, toolUseId, input),
      requestInteraction: (toolName, toolUseId, input) =>
        this.requestInteraction(toolName, toolUseId, input),
      emitEvent: event => this.onAgentEventCallback?.(event),
      notifyTaskListChange: toolName => this.notifyTaskListChange(toolName),
    })
    this.toolOrchestrator = new ToolOrchestrator(this.tools, this.toolExecutor)
  }

  private buildSystemPrompt(): string {
    return `你是 Evancod，一个在 VS Code 插件中运行的软件工程 Agent。

任务工具契约：
- 对复杂多步骤工作、plan mode、用户明确要求 todo list、或用户一次给出多个任务的请求，主动调用 task_create 创建结构化任务。
- 编码前先使用读取、搜索和分析工具调查工作区；能从代码、配置、文档、测试或既有模式确认的信息，不要询问用户。
- 在第一次修改文件前，先检查是否存在高影响未决选择；若存在，先调用 ask_user_question 获取用户决策，再开始编辑。
- 当继续执行所需的信息无法从工作区获得，或存在多种合理实现/技术选择且选择会实质影响公开 API、数据结构、依赖、兼容性、安全性、性能、用户体验、破坏性操作范围或验收标准时，必须调用 ask_user_question，不得自行假设。
- 用户要求互相冲突、需求边界不清且不同理解会产生显著不同结果、需要用户提供外部业务规则/环境信息/凭证，或即将进行不可逆操作但范围不明确时，也必须调用 ask_user_question。
- 对局部、可逆、低风险的实现细节，优先遵循项目既有模式自行决定；用户已明确授权自行选择时不要重复询问。
- 需要澄清时直接调用 ask_user_question，不要先用普通文本提问。一次集中询问 1-4 个真正阻塞的问题；收到回答后立即结合答案继续原任务。
- 判断示例：仓库中没有既有约定而 Cookie 与 JWT 会改变认证架构时必须询问；“用什么命名/放哪个相邻目录”可遵循现有代码自行决定；删除或迁移数据但用户未给出范围时必须询问；API 地址可以从配置或环境文件安全确认时先读取，不要询问。
- 开始执行某个任务前，必须调用 task_update 将该任务标记为 in_progress。
- 只有工作完全完成时才能将任务标记为 completed；测试失败、实现不完整、文件缺失或仍有阻塞时不能标记 completed。
- 完成任务后，调用 task_list 查找下一项可执行任务或新解锁任务。

工具执行契约：
- 工具执行结果会作为上下文回灌。根据结果继续下一步，直到无需再调用工具。
- 对复杂、独立或上下文较重的研究任务，可以使用 agent。后台 Agent 启动后不要轮询，等待完成通知。
- 需要生成图片时，必须调用 image_gen 工具，不要在文本中描述或伪造图片结果。${this.buildSkillCatalog()}`
  }

  /**
   * 构建 Skill 索引（渐进式披露）。
   *
   * 只把每个已启用 Skill 的名称与描述注入系统提示，作为「目录」。
   * 真正的正文按需通过 skill 工具加载（skill 工具支持 {"skill":"<name>"}
   * 加载单个技能，或 {"skill":"list"} 返回完整清单）。
   *
   * 这样做的目的：
   * - 用户问「有哪些 skill」时，模型看索引即可直接回答，不必反复查找目录（避免死循环）。
   * - 每轮请求只多一份短索引，token 开销随技能数线性但可控。
   */
  private buildSkillCatalog(): string {
    const skillManager = this.config.skillManager
    if (!skillManager) return ''

    const skills = skillManager.listEnabledSkills()
    if (skills.length === 0) return ''

    const lines = skills.map(skill => {
      const origin = skill.source === 'workspace' ? '工作区' : '全局'
      return `- ${skill.metadata.name}（${origin}）：${skill.metadata.description || '无描述'}`
    })

    return `

可用 Skill 目录（共 ${skills.length} 个）：
${lines.join('\n')}

Skill 使用契约：
- 用户询问「有哪些 skill / 技能」时，直接依据上面的目录回答，不要用 bash、glob 等工具去磁盘查找。
- 需要执行某个 Skill 时，调用 skill 工具并传入其名称（如 {"skill":"${skills[0].metadata.name}"}）加载正文后再照做。
- 需要完整清单时，可调用 {"skill":"list"}。`
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

  handlePermissionResponse(response: {
    requestId: string
    approved: boolean
    reason?: string
    updatedInput?: unknown
    rule?: 'once' | 'always'
  }) {
    const waiter = this.permissionWaiters.get(response.requestId)
    if (!waiter) return
    this.permissionWaiters.delete(response.requestId)
    const toolName =
      this.permissionRequestTools.get(response.requestId) ||
      this.toolUseNames.get(response.requestId)
    this.permissionRequestTools.delete(response.requestId)
    const permissionStartedAt = this.permissionStartedAt.get(response.requestId)
    this.permissionStartedAt.delete(response.requestId)
    performanceLog('permission.response', {
      requestId: response.requestId,
      approved: response.approved,
      durationMs: permissionStartedAt
        ? Math.round(performance.now() - permissionStartedAt)
        : undefined,
    })
    if (response.approved && response.rule === 'always' && toolName) {
      this.sessionAllowedTools.add(toolName)
    }
    if (toolName === 'exit_plan_mode' && this.config.planModeManager) {
      void (response.approved
        ? this.config.planModeManager.approvePlan(response.requestId)
        : this.config.planModeManager.rejectPlan(
            response.requestId,
            response.reason || '用户拒绝了计划'
          ))
    }
    waiter(response)
  }

  handleInteractionResponse(response: {
    requestId: string
    answered: boolean
    answers?: unknown
    reason?: string
  }): boolean {
    const waiter = this.interactionWaiters.get(response.requestId)
    if (!waiter) return false
    this.interactionWaiters.delete(response.requestId)
    waiter(response)
    return true
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
    const queryStartedAt = performance.now()
    let lastIteration = 0
    let progressSignalCount = 0
    let noProgressTurnCount = 0
    performanceLog('query.start', {
      messageLength: content.length,
      messageCount: this.config.messages.length,
      ...performanceSnapshot(),
    })
    try {
      // 重置 abort 状态，允许新的 query
      this.cancelled = false
      this.abortController = new AbortController()

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

      const MAX_ITERATIONS = this.config.maxIterations ?? 100
      let iteration = 0
      let finalContent = ''
      let totalUsage: TokenUsage | undefined
      // 记录最后一轮是否以工具调用结尾。若循环因触顶而退出且最后一轮是工具调用，
      // 需要补一轮无工具的收尾请求，避免留下空的 assistant 消息、闭环失败。
      let lastTurnHadToolCalls = false
      // 连续「整轮只有重复工具调用」的次数。用于兜底打断探查死循环。
      let consecutiveNoProgressTurns = 0
      // 循环是否被死循环断路器主动打断（而非正常闭环或触顶）
      let loopBroken = false
      let continuationCount = 0
      const MAX_OUTPUT_CONTINUATIONS = 3
      let taskContinuationCount = 0
      const MAX_TASK_CONTINUATIONS = 8
      let taskCompletionReviewRequested = false
      let taskWorkflowActive =
        isExplicitContinuationRequest(content) &&
        (this.config.taskManager
          ?.listTasks()
          .some(task => task.status === 'pending' || task.status === 'in_progress') ??
          false)

      // 新一轮用户请求：清空上一轮的工具去重缓存
      this.toolOrchestrator?.resetDedup()

      while (iteration < MAX_ITERATIONS) {
        this.throwIfCancelled()
        iteration++
        lastIteration = iteration
        const iterationStartedAt = performance.now()
        performanceLog('query.iteration.start', {
          iteration,
          messageCount: this.config.messages.length,
        })

        // 检查是否需要自动压缩
        if (totalUsage?.lastPromptTokens) {
          const currentTokens = totalUsage.lastPromptTokens
          if (
            shouldAutoCompact(currentTokens, this.config.model, this.consecutiveCompactFailures)
          ) {
            try {
              this.onAgentEventCallback?.({
                type: 'system_notification',
                subtype: 'compact_started',
                data: { message: '上下文正在压缩' },
              })
              await this.performAutoCompact()
              this.consecutiveCompactFailures = 0
              this.onAgentEventCallback?.({
                type: 'system_notification',
                subtype: 'compact_complete',
                data: { message: '上下文已自动压缩', success: true },
              })
            } catch (error) {
              this.consecutiveCompactFailures++
              console.error('Auto-compact failed:', error)
              // 压缩失败也要通知前端复位状态，避免 UI 永久停在"正在压缩"
              this.onAgentEventCallback?.({
                type: 'system_notification',
                subtype: 'compact_complete',
                data: { message: '上下文压缩失败', success: false },
              })
              // 继续执行，不中断工具循环
            }
          }
        }

        const toolDefinitions = this.tools.map(tool => tool.getDefinition())
        let assistantContent = ''

        const imageSavePromises: Promise<void>[] = []

        // 只在上下文确实接近窗口上限时才做有损的 microcompact，且只作用于
        // 「发给 API 的副本」——this.config.messages 始终保留完整历史。
        //
        // 之前的实现从第 2 轮起无条件覆盖 this.config.messages，导致模型刚读过的
        // 文件正文被清空，于是反复重读同一批文件（探查死循环），且被清空的历史
        // 会经 ChatService 写回并持久化，无法恢复。
        const requestBuildStartedAt = performance.now()
        const requestMessages = this.buildRequestMessages()
        const serializedAt = performance.now()
        const serializedRequest = JSON.stringify(requestMessages)
        const requestStats = summarizeMessages(requestMessages)
        performanceLog('query.iteration.request', {
          iteration,
          messageCount: requestStats.messageCount,
          textBytes: requestStats.textBytes,
          toolResultCount: requestStats.toolResultCount,
          toolResultBytes: requestStats.toolResultBytes,
          imageCount: requestStats.imageCount,
          buildDurationMs: Math.round(serializedAt - requestBuildStartedAt),
          serializationDurationMs: Math.round(performance.now() - serializedAt),
          serializedBytes: Buffer.byteLength(serializedRequest, 'utf8'),
        })

        const continuingOutput = continuationCount > 0 || taskContinuationCount > 0
        const apiStartedAt = performance.now()
        const response = await this.apiClient.sendMessageStream(
          requestMessages,
          (delta: string, type: 'start' | 'delta' | 'end' | 'thinking') => {
            if (this.cancelled) return
            if (type === 'start') {
              if (!continuingOutput) {
                this.onAgentEventCallback?.({ type: 'content_start', blockType: 'text' })
              }
              return
            }

            if (type === 'thinking') {
              // 思考增量：单独走 thinking 事件，交由 UI 折叠展示
              // 性能优化：批量合并，每 32ms 发送一次
              this.emitThinkingDelta(delta)
              return
            }

            if (type === 'delta') {
              // 性能优化：批量合并 content_delta，每 32ms 发送一次
              this.emitContentDelta(delta)
              return
            }

            this.onMessageCallback?.('', true)
          },
          toolDefinitions,
          {
            signal: this.abortController.signal,
            onImageEvent: (event: ImageStreamEvent) => {
              if (this.cancelled) return
              this.handleImageStreamEvent(event, imageSavePromises)
            },
          }
        )
        const responseBytes =
          Buffer.byteLength(response.content || '', 'utf8') +
          Buffer.byteLength(JSON.stringify(response.toolCalls || []), 'utf8')
        performanceLog('query.api.complete', {
          iteration,
          durationMs: Math.round(performance.now() - apiStartedAt),
          toolCallCount: response.toolCalls?.length || 0,
          contentLength: response.content?.length || 0,
          responseBytes,
        })

        // 等待原生生图的落盘 + complete 事件全部发出，避免 message_complete 抢先
        if (imageSavePromises.length > 0) {
          await Promise.all(imageSavePromises)
        }

        this.throwIfCancelled()
        assistantContent = response.content
        totalUsage = mergeUsage(totalUsage, response.usage)

        if (response.incomplete) {
          if (response.toolCalls?.length) {
            console.warn('Discarding tool calls from an incomplete model response')
          }

          if (assistantContent) {
            this.config.messages.push({
              id: this.generateId(),
              role: 'assistant',
              content: assistantContent,
              timestamp: Date.now(),
            })
          }

          continuationCount++
          if (continuationCount > MAX_OUTPUT_CONTINUATIONS) {
            throw new Error(
              '模型输出连续 ' +
                MAX_OUTPUT_CONTINUATIONS +
                ' 次被截断（' +
                (response.stopReason || '流未完整结束') +
                '），已保留现有进度，请再次发送“继续”恢复执行。'
            )
          }

          if (assistantContent) {
            this.config.messages.push({
              id: this.generateId(),
              role: 'user',
              content:
                '[内部续跑指令] 上一段输出因长度限制或流中断而未完成。请从中断处直接继续，' +
                '不要重复已经完成的分析或工具调用；继续推进当前任务，直到真正完成。',
              timestamp: Date.now(),
              internal: true,
            })
          }
          continue
        }

        continuationCount = 0

        if (response.toolCalls?.length) {
          lastTurnHadToolCalls = true
          if (
            response.toolCalls.some(
              toolCall => toolCall.name === 'task_create' || toolCall.name === 'task_update'
            )
          ) {
            taskWorkflowActive = true
          }
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
          // 工具执行器会同步发出 permission/tool_use 事件。先冲刷当前 API
          // 响应的正文和思考增量，避免 32ms 缓冲在工具事件之后才到达，
          // 从而把本应位于回答前的 thinking 渲染到会话末尾。
          this.flushPendingDeltas()
          const toolsStartedAt = performance.now()
          const { results: toolResults, noProgress } =
            await this.executeToolCalls(assistantToolCalls)
          performanceLog('query.tools.complete', {
            iteration,
            toolCallCount: assistantToolCalls.length,
            toolNames: assistantToolCalls.map(call => call.name),
            durationMs: Math.round(performance.now() - toolsStartedAt),
            ...performanceSnapshot(),
          })
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
              // 工具结果的结构化 blocks（如图片 vision block）必须一起保留，
              // 否则 ToolExecutor 构造的图片块在回灌时被丢弃，模型看不到图片。
              contentBlocks: result.contentBlocks as ContentBlock[] | undefined,
            })
          }

          // 兜底断路器：连续多轮都只有重复的只读调用，说明模型在原地打转。
          // 此时不再继续工具循环，直接进入无工具的收尾请求让它给出结论。
          if (noProgress) {
            consecutiveNoProgressTurns++
            noProgressTurnCount = consecutiveNoProgressTurns
            if (consecutiveNoProgressTurns >= 2) {
              console.warn('Detected tool-call loop with no progress, forcing final answer')
              this.onAgentEventCallback?.({
                type: 'system_notification',
                subtype: 'compact_complete',
                data: { message: '检测到重复探查，已中断循环并要求模型给出结论', success: true },
              })
              loopBroken = true
              break
            }
          } else {
            consecutiveNoProgressTurns = 0
            progressSignalCount++
          }

          continue
        }

        const unfinishedTasks =
          this.config.taskManager
            ?.listTasks()
            .filter(task => task.status === 'pending' || task.status === 'in_progress') || []
        if (
          taskWorkflowActive &&
          unfinishedTasks.length > 0 &&
          taskContinuationCount < MAX_TASK_CONTINUATIONS
        ) {
          if (assistantContent) {
            this.config.messages.push({
              id: this.generateId(),
              role: 'assistant',
              content: assistantContent,
              timestamp: Date.now(),
            })
          }

          taskContinuationCount++
          this.config.messages.push({
            id: this.generateId(),
            role: 'user',
            content:
              '[内部任务续跑指令] 当前任务列表仍有 ' +
              unfinishedTasks.length +
              ' 项未完成。不要结束回答；检查任务状态，从当前 in_progress 或下一项可执行任务继续，' +
              '完成实现与验证并更新任务状态。只有全部任务完成或存在必须由用户处理的真实阻塞时才能停止。',
            timestamp: Date.now(),
            internal: true,
          })
          continue
        }

        if (taskWorkflowActive && unfinishedTasks.length > 0) {
          console.warn(
            'Task continuation limit reached with unfinished tasks:',
            unfinishedTasks.map(task => ({ id: task.id, status: task.status }))
          )
        }

        // 任务刚全部清零时不能立即结束。模型经常会先把最后一个 task 标记 completed，
        // 随后用一句“现在进行最终编译/验证”结束当前 turn；此时任务列表虽是 7/7，
        // 但承诺的收尾动作尚未执行。强制增加一次复核轮，让模型真正运行最终验证、
        // 检查 task_list 并给出完整总结。复核只触发一次，避免正常完成后循环。
        if (taskWorkflowActive && unfinishedTasks.length === 0 && !taskCompletionReviewRequested) {
          if (assistantContent) {
            this.config.messages.push({
              id: this.generateId(),
              role: 'assistant',
              content: assistantContent,
              timestamp: Date.now(),
            })
          }

          taskCompletionReviewRequested = true
          taskContinuationCount++
          this.config.messages.push({
            id: this.generateId(),
            role: 'user',
            content:
              '[内部完成复核指令] 任务列表已全部完成，但当前工作流还不能立即结束。' +
              '检查上一段回答中是否还有“现在验证、接下来编译、最后确认”等尚未执行的承诺；' +
              '实际运行适用的最终编译、测试或构建，调用 task_list 确认所有任务状态，' +
              '然后再给出最终总结。如果验证失败，继续修复并重新验证；不要只描述将要执行的动作。',
            timestamp: Date.now(),
            internal: true,
          })
          continue
        }

        finalContent = assistantContent
        performanceLog('query.iteration.complete', {
          iteration,
          durationMs: Math.round(performance.now() - iterationStartedAt),
        })
        break
      }

      // 循环未正常闭环（触顶或被死循环断路器打断），且最后一轮以工具调用结尾：
      // 此时 finalContent 仍为空，直接落一条空 assistant 消息会导致闭环失败、
      // 任务面板停在半途。补一轮"无工具"的收尾请求，让模型基于已有结果给出总结。
      const needsClosing =
        (iteration >= MAX_ITERATIONS || loopBroken) && lastTurnHadToolCalls && !finalContent
      if (needsClosing) {
        console.warn('Tool loop ended without a final answer, requesting closing summary')
        this.throwIfCancelled()
        this.onAgentEventCallback?.({ type: 'content_start', blockType: 'text' })
        const closingResponse = await this.apiClient.sendMessageStream(
          this.buildRequestMessages(),
          (delta: string, type: 'start' | 'delta' | 'end' | 'thinking') => {
            if (this.cancelled) return
            if (type === 'start') {
              this.onAgentEventCallback?.({ type: 'content_start', blockType: 'text' })
              return
            }
            if (type === 'thinking') {
              this.emitThinkingDelta(delta)
              return
            }
            if (type === 'delta') {
              this.emitContentDelta(delta)
              return
            }
            this.onMessageCallback?.('', true)
          },
          // 不传工具定义，强制模型给出文本收尾而非继续调用工具
          [],
          { signal: this.abortController.signal }
        )
        this.throwIfCancelled()
        finalContent = closingResponse.content
        totalUsage = mergeUsage(totalUsage, closingResponse.usage)
      } else if (iteration >= MAX_ITERATIONS) {
        console.warn(`Reached maximum iterations (${MAX_ITERATIONS})`)
      }

      this.throwIfCancelled()
      // flush 所有待处理的 delta，确保最终内容在 message_complete 前完整发送
      this.flushPendingDeltas()
      const finalMessage: Message = {
        id: this.generateId(),
        role: 'assistant',
        content: finalContent,
        timestamp: Date.now(),
      }
      this.config.messages.push(finalMessage)

      // 计算上下文窗口使用百分比
      if (totalUsage) {
        const contextWindow = getContextWindowForModel(this.config.model)
        const effectiveWindow = getEffectiveContextWindow(this.config.model)

        totalUsage.contextWindow = contextWindow
        // 用最后一次 API 的 prompt tokens，而非累计的 inputTokens
        const currentTokens = totalUsage.lastPromptTokens || totalUsage.inputTokens || 0
        totalUsage.estimatedCurrentTokens = currentTokens
        totalUsage.percentUsed = Math.min(Math.round((currentTokens / effectiveWindow) * 100), 100)
      }

      this.onAgentEventCallback?.({ type: 'message_complete', usage: totalUsage })
      this.onCompleteCallback?.(finalMessage)
      performanceLog('query.complete', {
        iterations: iteration,
        durationMs: Math.round(performance.now() - queryStartedAt),
        ...performanceSnapshot(),
      })
      performanceLog('query.termination', {
        terminationReason: 'completed',
        iteration,
        completed: true,
        progressSignals: progressSignalCount,
        noProgressTurns: noProgressTurnCount,
      })
      return finalMessage
    } catch (error) {
      performanceLog('query.error', {
        durationMs: Math.round(performance.now() - queryStartedAt),
        error: error instanceof Error ? error.message : String(error),
        ...performanceSnapshot(),
      })
      // 关键：本轮可能在 push 了带 toolCalls 的 assistant 消息之后、push 工具结果
      // 之前就中断（用户点停止 / 网络错误 / 429）。此时历史里留下没有配对结果的
      // tool_use，而 QueryEngine 跨请求复用同一份 messages，导致之后每次请求都被
      // API 以 400 拒绝——表现为「会话断掉后再也无法继续」。这里立即补齐。
      this.closeDanglingToolCalls()

      const err =
        this.cancelled || this.abortController.signal.aborted
          ? new QueryCancelledError(this.cancelReason)
          : error instanceof Error
            ? error
            : new Error(String(error))
      const terminationReason =
        this.cancelled || this.abortController.signal.aborted ? 'user_cancelled' : 'provider_error'
      performanceLog('query.termination', {
        terminationReason,
        iteration: lastIteration,
        completed: false,
        progressSignals: progressSignalCount,
        noProgressTurns: noProgressTurnCount,
      })
      this.onErrorCallback?.(err)
      throw err
    }
  }

  /**
   * 补齐历史中未闭合的 tool_use，使会话在下一次请求时本身就是合法的。
   * 供中断路径与 ChatService 的错误处理调用。
   */
  closeDanglingToolCalls(): boolean {
    try {
      return repairDanglingToolCalls(this.config.messages)
    } catch (error) {
      console.error('[QueryEngine] 修复未闭合工具调用失败:', error)
      return false
    }
  }

  /**
   * 处理原生生图流事件（路线二）。
   * - start：立即发骨架事件（前端展示占位）。
   * - complete：写盘（output/imagegen/），再发带 path + base64 的完成事件。
   *   base64 仅供前端展示，不进入消息内容/LLM 上下文；持久化只保留 path。
   */
  private handleImageStreamEvent(event: ImageStreamEvent, savePromises: Promise<void>[]): void {
    if (event.phase === 'start') {
      this.onAgentEventCallback?.({
        type: 'image_generation',
        imageId: event.imageId,
        phase: 'start',
      })
      return
    }

    // phase === 'complete'
    if (!event.base64) return
    const base64 = event.base64
    const mime = event.mime || 'image/png'

    const savePromise = (async () => {
      let savedPath: string | undefined
      let name: string | undefined
      try {
        const saved = await saveGeneratedImages(
          this.config.cwd,
          [{ base64, mime }],
          timestampedImagePath(mime)
        )
        if (saved.length > 0) {
          savedPath = saved[0].path
          name = saved[0].name
        }
      } catch (error) {
        console.error('[QueryEngine] 保存生成图片失败:', error)
      }

      if (this.cancelled) return
      this.onAgentEventCallback?.({
        type: 'image_generation',
        imageId: event.imageId,
        phase: 'complete',
        image: { base64, mime, path: savedPath, name },
      })
    })()

    savePromises.push(savePromise)
  }

  cancel(reason = 'Query cancelled'): void {
    if (this.cancelled) return
    this.cancelled = true
    this.cancelReason = reason
    // flush 残留 delta，避免取消后定时器仍然触发
    this.flushPendingDeltas()
    this.abortController.abort()
    this.toolExecutor?.cancelAll()
    this.bashTool?.cancelAll()

    for (const [requestId, waiter] of this.permissionWaiters.entries()) {
      waiter({ requestId, approved: false, reason })
    }
    this.permissionWaiters.clear()
    this.permissionRequestTools.clear()
    for (const [requestId, waiter] of this.interactionWaiters.entries()) {
      waiter({ requestId, answered: false, reason })
    }
    this.interactionWaiters.clear()
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
    return [...this.config.messages]
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
  private async executeToolCalls(toolCalls: ToolCall[]): Promise<RunToolsOutcome> {
    if (!this.toolOrchestrator) {
      throw new Error('Tool orchestrator not initialized')
    }

    return this.toolOrchestrator.runTools(toolCalls)
  }

  /**
   * 构建发给 API 的消息副本。
   *
   * this.config.messages 是会话的真实历史，必须保持完整（它会被 ChatService
   * 写回 session 并持久化）。只有在估算 token 接近有效窗口时，才对副本做
   * 有损的 microcompact，避免模型丢失刚获取的工具结果而重复调用。
   */
  private buildRequestMessages(): Message[] {
    const effectiveWindow = getEffectiveContextWindow(this.config.model)
    const estimated = estimateMessagesTokens(this.config.messages)

    if (!shouldMicrocompact(estimated, effectiveWindow)) {
      return this.config.messages
    }

    return microcompact(this.config.messages, 5)
  }

  /**
   * 生成唯一 ID
   *
   * @returns ID 字符串
   */
  private requestPermissionIfNeeded(
    toolName: string,
    toolUseId: string,
    input: unknown
  ): Promise<{ approved: boolean; reason?: string; updatedInput?: unknown }> {
    const permissionMode = this.config.permissionMode || 'default'

    if (
      permissionMode === 'plan' &&
      !this.config.planModeManager?.isToolAllowedInPlanMode(toolName)
    ) {
      return Promise.resolve({ approved: false, reason: `Plan Mode 不允许使用工具: ${toolName}` })
    }

    if (permissionMode === 'bypassPermissions' || this.sessionAllowedTools.has(toolName)) {
      return Promise.resolve({ approved: true })
    }

    const isEditTool = ['edit_file', 'write_file'].includes(toolName)
    const isDangerousTool = ['bash', 'delete_file', 'move_file', 'copy_file'].includes(toolName)
    let requiresApproval = false
    if (permissionMode === 'plan') {
      requiresApproval = false
    } else if (permissionMode === 'acceptEdits') {
      requiresApproval = isDangerousTool
    } else {
      requiresApproval = isEditTool || isDangerousTool
    }

    if (!requiresApproval) {
      return Promise.resolve({ approved: true })
    }

    const requestId = this.generateId()
    this.permissionStartedAt.set(requestId, performance.now())
    performanceLog('permission.request', { requestId, toolName, toolUseId })
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
      const responder = (response: {
        requestId: string
        approved: boolean
        reason?: string
        updatedInput?: unknown
        rule?: 'once' | 'always'
      }) => {
        if (response.requestId !== requestId) return
        this.permissionWaiters.delete(requestId)
        resolve({
          approved: response.approved,
          reason: response.reason,
          updatedInput: response.updatedInput,
        })
      }

      this.permissionWaiters.set(requestId, responder)
      const timeoutId = setTimeout(
        () => {
          if (this.permissionWaiters.has(requestId)) {
            this.permissionWaiters.delete(requestId)
            this.permissionRequestTools.delete(requestId)
            this.permissionStartedAt.delete(requestId)
            performanceLog('permission.timeout', { requestId, toolName })
            resolve({ approved: false, reason: 'Permission request timed out' })
          }
        },
        5 * 60 * 1000
      )

      void timeoutId
    })
  }

  private requestInteraction(
    toolName: string,
    toolUseId: string,
    input: unknown
  ): Promise<{ approved: boolean; reason?: string; updatedInput?: unknown }> {
    if (toolName !== 'ask_user_question') {
      return Promise.resolve({ approved: true })
    }

    const requestId = this.generateId()
    this.onAgentEventCallback?.({
      type: 'interaction_request',
      requestId,
      toolName,
      toolUseId,
      input,
      description: '需要用户提供信息后才能继续',
    })

    return new Promise(resolve => {
      this.interactionWaiters.set(requestId, response => {
        if (!response.answered) {
          resolve({ approved: false, reason: response.reason || '用户取消了问题' })
          return
        }
        resolve({ approved: true, updatedInput: { answers: response.answers } })
      })
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
    if (toolName === 'exit_plan_mode') return '提交计划并等待审批'
    if (toolName === 'write_file' || toolName === 'edit_file') return '修改工作区文件'
    if (toolName === 'mcp') return '调用外部 MCP Server 工具或资源'
    if (toolName === 'skill') return '加载并执行 Skill 提示模板'
    return undefined
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  }

  /**
   * 执行自动压缩
   * 生成摘要并替换消息数组
   */
  private async performAutoCompact(): Promise<void> {
    if (!this.apiClient) {
      throw new Error('API client not initialized')
    }

    // 生成摘要：优先使用 Haiku 模型降低压缩成本
    const summaryModel = this.config.provider.models.haiku || this.config.model
    const summaryApiClient = createApiClient({
      provider: this.config.provider,
      model: summaryModel,
      effortLevel: 'low',
    })
    const { summaryMessage } = await compactConversation(
      this.config.messages,
      summaryApiClient,
      summaryModel
    )

    // 保留最近 10 条消息
    const keepRecentCount = 10
    const recentMessages = this.config.messages.slice(-keepRecentCount)

    // 替换消息数组：摘要 + 最近消息
    this.config.messages = [summaryMessage, ...recentMessages]
  }
}

function summarizeMessages(messages: unknown[]): {
  messageCount: number
  textBytes: number
  toolResultCount: number
  toolResultBytes: number
  imageCount: number
} {
  let textBytes = 0
  let toolResultCount = 0
  let toolResultBytes = 0
  let imageCount = 0
  for (const message of messages) {
    const record = message as { role?: string; content?: unknown }
    const content = record?.content
    if (record.role === 'tool') {
      toolResultCount++
      toolResultBytes +=
        typeof content === 'string'
          ? Buffer.byteLength(content, 'utf8')
          : Buffer.byteLength(JSON.stringify(content ?? ''), 'utf8')
    }
    if (typeof content === 'string') {
      textBytes += Buffer.byteLength(content, 'utf8')
      continue
    }
    if (!Array.isArray(content)) continue
    for (const block of content) {
      const item = block as {
        type?: string
        text?: string
        content?: unknown
        source?: { data?: string }
      }
      if (item.type === 'tool_result' && record.role !== 'tool') {
        toolResultCount++
        const serialized =
          typeof item.content === 'string' ? item.content : JSON.stringify(item.content ?? '')
        toolResultBytes += Buffer.byteLength(serialized, 'utf8')
      } else if (item.type === 'image' || item.source?.data) {
        imageCount++
      } else if (typeof item.text === 'string') {
        textBytes += Buffer.byteLength(item.text, 'utf8')
      }
    }
  }
  return { messageCount: messages.length, textBytes, toolResultCount, toolResultBytes, imageCount }
}
