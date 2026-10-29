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
import type { ApiClientResponse, ImageStreamEvent } from '../services/api'
import { saveGeneratedImages, timestampedImagePath } from '../tools/image/imageStorage'
import { TaskManager } from '../../services/task/TaskManager'
import { PlanModeManager } from '../../services/plan/PlanModeManager'
import { AgentCoordinator } from '../../services/agent/AgentCoordinator'
import {
  getContextWindowForModel,
} from '../../utils/model/modelContextWindows'
import {
  microcompact,
  shouldMicrocompact,
} from '../../services/compact/microcompact'
import { closeDanglingToolCalls as repairDanglingToolCalls } from '../services/api/toolMessageSanitizer'
import {
  buildRollingCompactionInput,
  compactConversation,
  isCompactSummaryMessage,
  replaceWithRollingSummary,
} from '../../services/compact/compact'
import {
  ContextBudgetManager,
  estimateRequestTokens,
  getEffectiveInputWindow,
} from '../../services/context/ContextBudgetManager'
import {
  insertVisualContexts,
  stripVirtualizedImages,
  VisualContextBuilder,
} from '../../services/context/VisualContextBuilder'
import { Tool, BashTool } from '../tools'
import { VSCodeFileSystemAdapter } from '../../adapters/FileSystemAdapter'
import { MCPConnectionManager } from '../../services/mcp/MCPConnectionManager'
import { SkillManager } from '../../services/skill/SkillManager'
import { MemoryManager } from '../../services/memory/MemoryManager'
import { ToolExecutor } from '../tools/execution/ToolExecutor'
import { ToolOrchestrator, type RunToolsOutcome } from '../tools/execution/ToolOrchestrator'
import { performanceLog, performanceSnapshot } from '../../utils/performanceLogger'
import { setToolResultDevMode } from '../tools/execution/toolResultContext'
import {
  DEFAULT_MAX_EXECUTION_SEGMENTS,
  DEFAULT_MAX_ITERATIONS,
  isSuccessfulTermination,
  shouldContinueExecutionSegment,
  type QueryTerminationReason,
} from './termination'
import { createBuiltinToolRegistry } from '../tools/registry/BuiltinToolRegistry'
import type { ToolRegistrySnapshot } from '../tools/registry/ToolRegistry'
import type { ToolCapability, ToolSource } from '../tools/registry/ToolRegistry'
import { RuntimeProfileResolver } from './RuntimeProfileResolver'
import {
  RepetitionDetector,
  hasUnfulfilledActionPromise,
  isDegenerateRepetition,
} from './repetition'

/**
 * QueryEngine 配置
 */
export interface QueryEngineConfig {
  /** 当前会话 ID，用于隔离计划模式状态。 */
  sessionId?: string
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

  /** 子 Agent 只读执行时仅保留读取、搜索和分析工具。 */
  readOnly?: boolean

  /** 本次运行固定使用的工具注册快照。未提供时启用全部可用内置工具。 */
  toolSnapshot?: ToolRegistrySnapshot

  /** 追加到 Evancod 基础系统提示词后的角色或运行约束。 */
  systemPrompt?: string

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
   * 单个执行段的最大迭代次数（可选）
   * 每次 API 轮次（含工具调用）消耗一次迭代。多步任务需要较高的上限，
   * 达到上限后，有未完成结构化任务且本段有进展时会自动进入下一段。默认 100。
   */
  maxIterations?: number

  /**
   * 有进展的结构化任务最多可自动续跑的执行段总数（可选）。
   * 与 maxIterations 共同构成总调用预算；默认 10 段。
   */
  maxExecutionSegments?: number

  /**
   * 是否为开发模式（可选）
   * 控制是否创建调试文件（performance.log、.tmp/evancod-tool-results）
   */
  isDevelopment?: boolean

  /**
   * 压缩时保留的最近消息数量（可选）
   * 默认 10 条，范围 5-50
   * 从 evancod.compactKeepRecentMessages 配置读取
   */
  compactKeepRecentMessages?: number
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
  if (typeof incoming.lastPromptTokens === 'number') {
    merged.lastPromptTokens = incoming.lastPromptTokens
  }
  if (typeof incoming.lastOutputTokens === 'number') {
    merged.lastOutputTokens = incoming.lastOutputTokens
  }
  if (typeof incoming.lastCacheReadTokens === 'number') {
    merged.lastCacheReadTokens = incoming.lastCacheReadTokens
  }
  if (typeof incoming.lastCacheWriteTokens === 'number') {
    merged.lastCacheWriteTokens = incoming.lastCacheWriteTokens
  }
  if (typeof incoming.lastTotalTokens === 'number') {
    merged.lastTotalTokens = incoming.lastTotalTokens
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
  private toolPolicies = new Map<
    string,
    { capabilities: readonly ToolCapability[]; source: ToolSource }
  >()

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
    (response: { requestId: string; answered: boolean; answers?: unknown; reason?: string }) => void
  > = new Map()
  private toolUseNames: Map<string, string> = new Map()
  private permissionRequestTools: Map<string, string> = new Map()
  private permissionStartedAt: Map<string, number> = new Map()
  private permissionTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private sessionAllowedTools: Set<string> = new Set()
  private bashTool!: BashTool
  private toolExecutor?: ToolExecutor
  private toolOrchestrator?: ToolOrchestrator
  private abortController = new AbortController()
  private cancelled = false
  private cancelReason = 'Query cancelled'
  private consecutiveCompactFailures = 0
  private lastTerminationReason: QueryTerminationReason = 'model_completed'

  private readonly contextBudget = new ContextBudgetManager()
  private readonly visualContextBuilder: VisualContextBuilder
  private requestSystemPrompt = ''

  // 性能优化：content_delta / thinking 批量合并
  // 高频事件在微任务队列中累积，每 ~32ms 发送一次合并后的事件，
  // 减少 onAgentEventCallback 的调用次数（链路上接了 recordAgentEvent + postMessage）。
  // 关键事件（message_complete / tool_use_complete / permission_request 等）不合并。
  /**
   * 按上游到达顺序保存增量。正文和思考不能拆成两个独立缓冲区，
   * 否则 flush 时固定的发送顺序会把同一轮的 thinking/text 重新排序。
   */
  private pendingDeltas: Array<{
    type: 'content_delta' | 'thinking'
    text: string
    blockId?: string
  }> = []
  private deltaFlushTimer: ReturnType<typeof setTimeout> | undefined
  private activeThinkingBlockId: string | undefined

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
        this.onAgentEventCallback?.({
          type: 'thinking',
          text: delta.text,
          blockId: delta.blockId,
        })
      }
    }
  }

  /**
   * 累积 content_delta，32ms 后批量发送。
   */
  private emitContentDelta(text: string): void {
    this.activeThinkingBlockId = undefined
    this.enqueueDelta('content_delta', text)
    this.onMessageCallback?.(text, false)
  }

  /**
   * 累积 thinking delta，32ms 后批量发送。
   */
  private emitThinkingDelta(text: string): void {
    this.activeThinkingBlockId ||= `thinking-${this.generateId()}`
    this.enqueueDelta('thinking', text, this.activeThinkingBlockId)
  }

  private enqueueDelta(type: 'content_delta' | 'thinking', text: string, blockId?: string): void {
    if (!text) return

    const last = this.pendingDeltas[this.pendingDeltas.length - 1]
    if (last?.type === type && last.blockId === blockId) {
      last.text += text
    } else {
      this.pendingDeltas.push({ type, text, blockId })
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
    this.visualContextBuilder = new VisualContextBuilder(config.provider, config.model)
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
    // 设置工具结果归档的开发模式标志
    setToolResultDevMode(this.config.isDevelopment ?? false)

    this.fs = new VSCodeFileSystemAdapter()
    const registry = createBuiltinToolRegistry()
    const snapshot =
      this.config.toolSnapshot ||
      new RuntimeProfileResolver(registry).resolve({ readOnly: this.config.readOnly }).toolSnapshot
    const instantiated = snapshot.instantiate({
      sessionId: this.config.sessionId,
      cwd: this.config.cwd,
      provider: this.config.provider,
      model: this.config.model,
      fileSystem: this.fs,
      imageProvider: this.config.imageProvider,
      taskManager: this.config.taskManager,
      planModeManager: this.config.planModeManager,
      agentCoordinator: this.config.agentCoordinator,
      mcpManager: this.config.mcpManager,
      skillManager: this.config.skillManager,
    })
    const planModeDisablesTasks = this.config.permissionMode === 'plan'
    const enabledTools = planModeDisablesTasks
      ? instantiated.tools.filter(tool => !tool.name.startsWith('task_'))
      : instantiated.tools
    this.toolPolicies = new Map(
      snapshot
        .list()
        .filter(registration => !planModeDisablesTasks || !registration.name.startsWith('task_'))
        .map(registration => [
          registration.name,
          { capabilities: registration.capabilities, source: registration.source },
        ])
    )
    this.tools = enabledTools
    for (const warning of instantiated.warnings) {
      if (this.config.verbose) console.warn(`[QueryEngine] ${warning}`)
    }

    // ToolExecutor 需要 Bash 实例处理取消；快照未启用 Bash 时使用不暴露给模型的实例。
    this.bashTool =
      this.tools.find((tool): tool is BashTool => tool instanceof BashTool) ||
      new BashTool(this.config.cwd)

    // if (this.config.verbose) {
    //   console.log(`Initialized ${this.tools.length} tools:`, this.tools.map(t => t.name))
    // }

    this.toolExecutor = new ToolExecutor(this.tools, this.bashTool, this.config.cwd, {
      requestPermission: (toolName, toolUseId, input) =>
        this.requestPermissionIfNeeded(toolName, toolUseId, input),
      requestInteraction: (toolName, toolUseId, input) =>
        this.requestInteraction(toolName, toolUseId, input),
      emitEvent: event => this.onAgentEventCallback?.(event),
      notifyTaskListChange: toolName => this.notifyTaskListChange(toolName),
    })
    this.toolOrchestrator = new ToolOrchestrator(
      this.tools,
      this.toolExecutor,
      () => this.cancelled || this.abortController.signal.aborted
    )
  }

  private buildSystemPrompt(): string {
    const injectedPrompt = this.config.systemPrompt?.trim()
    const planModeNotice =
      this.config.permissionMode === 'plan'
        ? '\n- 当前处于计划权限模式：先调用 enter_plan_mode（如果尚未进入），完成只读分析后调用 exit_plan_mode 提交完整 tasks/steps/risks，等待用户审批；审批前不要调用 write_file/edit_file，且不要调用 task_create、task_update、task_list 或 task_get。\n'
        : ''
    return `你是 Evancod，一个在 VS Code 插件中运行的软件工程 Agent。

工作契约：
- 复杂多步骤、todo list 或多项请求使用 task_create；执行前用 task_update 标记 in_progress，实际实现和验证完成后才能标记 completed，再用 task_list 检查下一项。计划权限模式是例外：计划阶段不使用任何 task 工具。
- 编码前读取、搜索并分析工作区。能从代码、配置、文档、测试或既有模式确认的信息自行确认，不询问用户。
- 只有缺少外部信息，或选择会实质影响公开 API、数据、依赖、兼容性、安全、性能、用户体验、不可逆操作范围或验收标准时，才调用 ask_user_question 集中询问 1-4 个阻塞问题。
- 对局部、可逆、低风险细节遵循项目既有模式。用户要求冲突或不同理解会产生显著不同结果时，不得擅自选择。
- 测试失败、实现不完整、文件缺失或仍有阻塞时，不得声称完成。
- 验证强度必须与实际改动和风险匹配：纯文档或报告只检查文件内容、路径与差异，不运行代码编译、测试、构建或打包；配置、样式和代码改动优先运行受影响范围内最小且充分的检查；只有涉及构建链路、发布产物、跨模块公共契约，或用户明确要求时才运行全量构建/打包。未运行不适用的检查时直接说明“不适用”，不要为了形式完整执行无关命令。
- 工具执行结果会作为上下文回灌。根据结果继续下一步，直到无需再调用工具。
- 对复杂、独立或上下文较重的研究任务，可以使用 agent。要真正并发多个独立的只读 Agent，必须在同一轮响应中一次发出多个 agent 调用；分多轮逐个调用仍是串行。可写 Agent 会串行执行，禁止在共享工作区后台运行。后台 Agent 启动后不要轮询，等待完成通知。
- 用户明确指定某个子 Agent 时，必须把对应定义 ID 传给 subagent_type；该 Agent 失败或超时后不得自行替代执行，应说明原因并询问是否重试。
- 需要生成图片时，必须调用 image_gen 工具，不要在文本中描述或伪造图片结果。${planModeNotice}${this.buildSkillCatalog()}${
      injectedPrompt ? `\n\n当前角色与附加约束：\n${injectedPrompt}` : ''
    }`
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
    this.requestSystemPrompt = this.buildSystemPrompt()
    this.apiClient = createApiClient({
      provider,
      model: this.config.model,
      systemPrompt: this.requestSystemPrompt,
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
  }): boolean {
    const waiter = this.permissionWaiters.get(response.requestId)
    if (!waiter) return false
    this.permissionWaiters.delete(response.requestId)
    const timeout = this.permissionTimeouts.get(response.requestId)
    if (timeout) clearTimeout(timeout)
    this.permissionTimeouts.delete(response.requestId)
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
    waiter(response)
    return true
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
  async query(
    content: string,
    contentBlocks?: ContentBlock[],
    messageId?: string
  ): Promise<Message> {
    const queryStartedAt = performance.now()
    let lastIteration = 0
    let progressSignalCount = 0
    let noProgressTurnCount = 0
    let terminationReason: QueryTerminationReason = 'model_completed'
    performanceLog('query.start', {
      messageLength: content.length,
      messageCount: this.config.messages.length,
      ...performanceSnapshot(),
    })
    try {
      // 重置 abort 状态，允许新的 query
      this.cancelled = false
      this.abortController = new AbortController()
      this.activeThinkingBlockId = undefined

      this.onAgentEventCallback?.({ type: 'status', state: 'running', verb: 'query' })

      if (!this.config.provider) throw new Error('No active provider configured')
      if (!this.apiClient) throw new Error('API client not initialized')

      const userMessage: Message = {
        id: messageId || this.generateId(),
        role: 'user',
        content,
        timestamp: Date.now(),
        contentBlocks,
      }
      this.config.messages.push(userMessage)
      this.onAgentEventCallback?.({ type: 'content_start', blockType: 'text' })

      let totalUsage: TokenUsage | undefined
      try {
        const visualResult = await this.visualContextBuilder.buildPending(
          this.config.messages,
          this.abortController.signal
        )
        this.config.messages = insertVisualContexts(this.config.messages, visualResult.contexts)
        totalUsage = mergeUsage(totalUsage, visualResult.usage)
      } catch (error) {
        // 视觉预处理失败时保留原图，主请求仍可按原有多模态路径继续。
        console.warn('[QueryEngine] Visual context extraction failed, using raw images:', error)
      }

      const ITERATIONS_PER_SEGMENT = Math.max(
        1,
        this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS
      )
      const MAX_EXECUTION_SEGMENTS = Math.max(
        1,
        this.config.maxExecutionSegments ?? DEFAULT_MAX_EXECUTION_SEGMENTS
      )
      const MAX_TOTAL_ITERATIONS = ITERATIONS_PER_SEGMENT * MAX_EXECUTION_SEGMENTS
      let iteration = 0
      let executionSegment = 1
      let segmentProgressSignalCount = 0
      let executionBudgetReached = false
      let finalContent = ''
      // 记录最后一轮是否以工具调用结尾。若循环因触顶而退出且最后一轮是工具调用，
      // 需要补一轮无工具的收尾请求，避免留下空的 assistant 消息、闭环失败。
      let lastTurnHadToolCalls = false
      // 连续「整轮只有重复工具调用」的次数。用于兜底打断探查死循环。
      let consecutiveNoProgressTurns = 0
      let repeatedErrorTurns = 0
      let lastErrorSignature = ''
      // 循环是否被死循环断路器主动打断（而非正常闭环或触顶）
      let loopBroken = false
      let reachedNormalCompletion = false
      let continuationCount = 0
      const MAX_OUTPUT_CONTINUATIONS = 3
      let consecutiveEmptyResponses = 0
      const MAX_EMPTY_RESPONSES = 3
      let taskContinuationCount = 0
      const MAX_TASK_CONTINUATIONS = 8
      let planToolUseRetryCount = 0
      const MAX_PLAN_TOOL_USE_RETRIES = 2
      // exit_plan_mode 在用户批准前会阻塞当前工具调用。批准返回后，模型仍可能
      // 直接输出总结，因此保留本轮查询的强制执行状态，直到至少成功调用一个
      // 写入或执行工具。
      let planExecutionRequired = false
      // 下一次请求强制 tool_choice=required（仅生效一次）：用于复读退化恢复、
      // 以及模型声明了要执行的动作却没有发出工具调用时。
      let forceToolChoiceOnce = false
      let degenerateRetryCount = 0
      const MAX_DEGENERATE_RETRIES = 2
      let promiseNudgeCount = 0
      const MAX_PROMISE_NUDGES = 2
      let taskCompletionReviewRequested = false
      let contextRecoveryAttempted = false
      let taskWorkflowActive =
        isExplicitContinuationRequest(content) &&
        (this.config.taskManager
          ?.listTasks()
          .some(
            task =>
              task.status === 'pending' ||
              task.status === 'in_progress' ||
              task.completion?.state === 'reviewing'
          ) ??
          false)
      const enqueueTaskCompletionReview = () => {
        taskCompletionReviewRequested = true
        taskContinuationCount++
        this.config.messages.push({
          id: this.generateId(),
          role: 'user',
          content:
            '[内部完成复核] 任务列表已全部标记完成，进入最终复核。' +
            '请对照下面的原始要求，结合实际工作区、git diff 和工具结果逐项核对，' +
            '包括上一段回答中提到但尚未执行的验证步骤。' +
            '按改动类型选择最小且充分的验证：纯文档或报告只核对内容、路径和差异；' +
            '代码、配置或样式改动运行受影响范围内的检查；' +
            '仅在构建发布链路、跨模块公共契约受影响或用户明确要求时运行全量构建/打包。\n' +
            '接下来的回复以工具调用开始，二选一：\n' +
            'A. 发现未满足的要求：调用 task_update 将对应任务设为 in_progress，然后直接修复并验证。\n' +
            'B. 全部满足：对 completion.state=reviewing 的任务调用 task_update completed（省略 completionEvidence 自动沿用已存证据），' +
            '该工具调用即完成复核，无需等待额外系统复核器；已 passed 的任务不再提交。' +
            '再调用 task_list，然后给出最终总结。\n\n' +
            this.buildTaskReviewContext(),
          timestamp: Date.now(),
          internal: true,
        })
      }

      // 新一轮用户请求：清空上一轮的工具去重缓存
      this.toolOrchestrator?.resetDedup()

      while (iteration < MAX_TOTAL_ITERATIONS) {
        if (iteration > 0 && iteration % ITERATIONS_PER_SEGMENT === 0) {
          const unfinishedTasksAtCheckpoint =
            this.config.taskManager
              ?.listTasks()
              .filter(
                task =>
                  task.status === 'pending' ||
                  task.status === 'in_progress' ||
                  (task.status === 'completed' && task.completion?.state === 'reviewing')
              ) || []
          const shouldContinue = shouldContinueExecutionSegment({
            taskWorkflowActive,
            unfinishedTaskCount: unfinishedTasksAtCheckpoint.length,
            progressSignals: segmentProgressSignalCount,
            consecutiveNoProgressTurns,
            currentSegment: executionSegment,
            maxSegments: MAX_EXECUTION_SEGMENTS,
          })

          if (!shouldContinue) {
            executionBudgetReached = true
            break
          }

          executionSegment++
          segmentProgressSignalCount = 0
          taskContinuationCount = 0
          this.config.messages.push({
            id: this.generateId(),
            role: 'user',
            content:
              `[内部执行段续跑] 已完成第 ${executionSegment - 1} 个执行段，` +
              `当前仍有 ${unfinishedTasksAtCheckpoint.length} 项任务未完成。` +
              '上一段持续取得了有效工具进展，因此自动进入下一段。' +
              '请从当前 in_progress 任务继续，不要重复已完成步骤，也不要提前总结。',
            timestamp: Date.now(),
            internal: true,
          })
          this.onAgentEventCallback?.({
            type: 'status',
            state: 'running',
            verb: 'segment_continued',
          })
          performanceLog('query.segment.continue', {
            segment: executionSegment,
            iteration,
            unfinishedTasks: unfinishedTasksAtCheckpoint.length,
          })
        }

        this.throwIfCancelled()
        iteration++
        lastIteration = iteration
        const iterationStartedAt = performance.now()
        performanceLog('query.iteration.start', {
          iteration,
          messageCount: this.config.messages.length,
        })

        const toolDefinitions = this.tools.map(tool => tool.getDefinition())
        let requestMessages = this.buildRequestMessages(toolDefinitions)
        let requestBudget = this.assessRequestBudget(requestMessages, toolDefinitions)
        this.emitContextUsage(totalUsage, requestBudget)

        if (
          requestBudget.shouldCompact &&
          this.consecutiveCompactFailures < 3
        ) {
          try {
            this.onAgentEventCallback?.({
              type: 'system_notification',
              subtype: 'compact_started',
              data: { message: '上下文正在压缩' },
            })
            await this.performAutoCompact()
            this.contextBudget.markCompacted()
            this.consecutiveCompactFailures = 0
            requestMessages = this.buildRequestMessages(toolDefinitions)
            requestBudget = this.assessRequestBudget(requestMessages, toolDefinitions)
            this.emitContextUsage(totalUsage, requestBudget)
            this.onAgentEventCallback?.({
              type: 'system_notification',
              subtype: 'compact_complete',
              data: { message: '上下文已自动压缩', success: true },
            })
          } catch (error) {
            this.consecutiveCompactFailures++
            console.error('Auto-compact failed:', error)
            this.onAgentEventCallback?.({
              type: 'system_notification',
              subtype: 'compact_complete',
              data: { message: '上下文压缩失败', success: false },
            })
          }
        }

        if (this.config.verbose) {
          console.log('[QueryEngine] Request context budget:', {
            estimatedTokens: requestBudget.estimatedTokens,
            effectiveWindow: requestBudget.effectiveWindow,
            percentUsed: Math.round(requestBudget.usageRatio * 100),
            serverPromptTokens: totalUsage?.lastPromptTokens,
            messageCount: requestMessages.length,
          })
        }
        let assistantContent = ''

        const imageSavePromises: Promise<void>[] = []

        // 只在上下文确实接近窗口上限时才做有损的 microcompact，且只作用于
        // 「发给 API 的副本」——this.config.messages 始终保留完整历史。
        //
        // 之前的实现从第 2 轮起无条件覆盖 this.config.messages，导致模型刚读过的
        // 文件正文被清空，于是反复重读同一批文件（探查死循环），且被清空的历史
        // 会经 ChatService 写回并持久化，无法恢复。
        const requestBuildStartedAt = performance.now()
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

        const continuingOutput =
          continuationCount > 0 || taskContinuationCount > 0 || promiseNudgeCount > 0
        const apiStartedAt = performance.now()
        // 每次请求单独的 AbortController：检测到复读退化时只中止本次请求，
        // 不影响整个查询的取消状态。用户取消时联动中止。
        const requestController = new AbortController()
        const abortRequest = () => requestController.abort()
        this.abortController.signal.addEventListener('abort', abortRequest, { once: true })
        const repetitionDetector = new RepetitionDetector()
        const toolChoiceRequired =
          this.requiresPlanToolUse() || planExecutionRequired || forceToolChoiceOnce
        forceToolChoiceOnce = false
        let response: ApiClientResponse
        try {
          response = await this.apiClient.sendMessageStream(
            requestMessages,
            (delta: string, type: 'start' | 'delta' | 'end' | 'thinking') => {
              if (this.cancelled || requestController.signal.aborted) return
              if (type === 'start') {
                if (!continuingOutput) {
                  this.onAgentEventCallback?.({ type: 'content_start', blockType: 'text' })
                }
                return
              }

              if (type === 'thinking' || type === 'delta') {
                if (repetitionDetector.push(type, delta)) {
                  console.warn('Detected degenerate repetition in model output, aborting request')
                  requestController.abort()
                  return
                }
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
              signal: requestController.signal,
              toolChoice: toolChoiceRequired ? 'required' : undefined,
              onImageEvent: (event: ImageStreamEvent) => {
                if (this.cancelled) return
                this.handleImageStreamEvent(event, imageSavePromises)
              },
            }
          )
        } catch (error) {
          if (
            isContextWindowError(error) &&
            !contextRecoveryAttempted &&
            !this.abortController.signal.aborted
          ) {
            contextRecoveryAttempted = true
            this.contextBudget.recordContextLimitFailure()
            this.onAgentEventCallback?.({
              type: 'system_notification',
              subtype: 'compact_started',
              data: { message: '上游上下文限制低于配置，正在执行一次紧急压缩' },
            })
            try {
              await this.performAutoCompact()
              this.contextBudget.markCompacted()
              this.onAgentEventCallback?.({
                type: 'system_notification',
                subtype: 'compact_complete',
                data: { message: '紧急压缩完成，正在重试', success: true },
              })
              continue
            } catch (compactError) {
              this.onAgentEventCallback?.({
                type: 'system_notification',
                subtype: 'compact_complete',
                data: { message: '紧急压缩失败', success: false },
              })
              throw compactError
            }
          }
          if (!repetitionDetector.isDetected || this.abortController.signal.aborted) throw error
          response = { content: '', degenerate: true }
        } finally {
          this.abortController.signal.removeEventListener('abort', abortRequest)
        }
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
        this.contextBudget.recordServerUsage(requestBudget.estimatedTokens, response.usage)
        totalUsage = mergeUsage(totalUsage, response.usage)
        this.emitContextUsage(totalUsage)

        // 输出退化为复读：丢弃整段输出，不写入历史（写回会被模型当作上下文继续复读），
        // 用一条中性的恢复指令重发，并强制本次以工具调用开头。
        if (
          response.degenerate ||
          repetitionDetector.isDetected ||
          (response.incomplete && isDegenerateRepetition(assistantContent))
        ) {
          degenerateRetryCount++
          this.flushPendingDeltas()
          this.onAgentEventCallback?.({ type: 'content_discard' })
          if (degenerateRetryCount > MAX_DEGENERATE_RETRIES) {
            throw new Error(
              '模型输出连续陷入重复，已停止本次执行。已完成的工具结果均已保留，可发送“继续”恢复。'
            )
          }
          this.onAgentEventCallback?.({
            type: 'system_notification',
            subtype: 'runtime_notice',
            data: { message: '检测到模型输出重复，已丢弃该段输出并重试', success: true },
          })
          this.config.messages.push({
            id: this.generateId(),
            role: 'user',
            content:
              '[内部恢复] 上一段输出出现重复已被丢弃。请基于已有的工具结果，' +
              '直接调用下一步需要的工具；无需复述计划。',
            timestamp: Date.now(),
            internal: true,
          })
          forceToolChoiceOnce = true
          continue
        }

        // 计划审批依赖 enter/exit_plan_mode 的工具调用。部分 OpenAI 兼容模型或中转层
        // 即使收到 tool_choice=required 仍可能返回纯文本；不能把这类响应当作计划完成。
        if ((this.requiresPlanToolUse() || planExecutionRequired) && !response.toolCalls?.length) {
          planToolUseRetryCount++
          this.flushPendingDeltas()
          if (assistantContent) {
            this.onAgentEventCallback?.({ type: 'content_discard' })
          }
          if (planToolUseRetryCount > MAX_PLAN_TOOL_USE_RETRIES) {
            throw new Error(
              '计划模式要求模型通过工具完成流程，但当前模型连续返回普通文本。请切换支持工具调用的模型后重试。'
            )
          }
          const continuationInstruction = planExecutionRequired
            ? '[内部计划执行约束] 计划已经获得用户批准，不能直接输出总结或结束本轮。' +
              '必须按照已批准计划立即调用至少一个实际执行工具（如 write_file、edit_file、bash、' +
              'copy_file、move_file 或 delete_file），完成文件修改或验证后才能回复。'
            : '[内部计划模式约束] 当前处于计划模式，不能直接输出 Markdown 或普通文本结束。' +
              '必须调用工具继续：需要补充信息时调用 ask_user_question，需要读取项目时调用只读工具，' +
              '计划完成时调用 exit_plan_mode 提交计划并等待用户审批。'
          this.config.messages.push({
            id: this.generateId(),
            role: 'user',
            content: continuationInstruction,
            timestamp: Date.now(),
            internal: true,
          })
          continue
        }

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
            terminationReason = 'output_limit'
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

        if (!response.toolCalls?.length && !assistantContent.trim()) {
          consecutiveEmptyResponses++
          if (consecutiveEmptyResponses > MAX_EMPTY_RESPONSES) {
            throw new Error(`模型连续 ${MAX_EMPTY_RESPONSES + 1} 次返回空响应，已停止本次执行`)
          }
          if (consecutiveEmptyResponses === 1) {
            this.config.messages.push({
              id: this.generateId(),
              role: 'user',
              content:
                '[内部恢复指令] 上一轮模型返回了空响应。请基于已有工具结果继续任务；' +
                '若信息已经足够，立即输出最终结论，不要重复读取已完整返回的文件。',
              timestamp: Date.now(),
              internal: true,
            })
          }
          continue
        }
        consecutiveEmptyResponses = 0

        if (response.toolCalls?.length) {
          lastTurnHadToolCalls = true
          if (
            response.toolCalls.some(
              toolCall => toolCall.name === 'task_create' || toolCall.name === 'task_update'
            )
          ) {
            taskWorkflowActive = true
          }
          const tasksBeforeTools = this.config.taskManager?.listTasks() || []
          const discardsTerminalTaskSummary =
            Boolean(assistantContent) &&
            taskCompletionReviewRequested &&
            response.toolCalls.some(toolCall => toolCall.name === 'task_list') &&
            tasksBeforeTools.length > 0 &&
            tasksBeforeTools.every(
              task => task.status === 'completed' && task.completion?.state === 'passed'
            )
          if (discardsTerminalTaskSummary) {
            // task_list 后还会生成正式回答；隐藏工具调用前抢先输出的完整总结。
            this.flushPendingDeltas()
            this.onAgentEventCallback?.({ type: 'content_discard' })
            assistantContent = ''
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
          this.activeThinkingBlockId = undefined
          const toolsStartedAt = performance.now()
          const {
            results: toolResults,
            noProgress,
            errorSignature,
          } = await this.executeToolCalls(assistantToolCalls)
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
          this.emitContextUsage(totalUsage)

          // exit_plan_mode 只有在用户批准后才会成功返回。此时必须让模型至少
          // 成功调用一次真正的写入/执行工具，避免批准后直接输出空泛总结。
          if (
            this.config.permissionMode === 'plan' &&
            this.config.planModeManager?.getState(this.config.sessionId || '') === 'approved' &&
            toolResults.some(result => result.toolName === 'exit_plan_mode' && !result.isError)
          ) {
            planExecutionRequired = true
            planToolUseRetryCount = 0
          }

          if (
            planExecutionRequired &&
            toolResults.some(result => !result.isError && this.isPlanExecutionTool(result.toolName))
          ) {
            planExecutionRequired = false
            planToolUseRetryCount = 0
          }

          // 兜底断路器：连续多轮都只有重复的只读调用，说明模型在原地打转。
          // 此时不再继续工具循环，直接进入无工具的收尾请求让它给出结论。
          if (noProgress) {
            consecutiveNoProgressTurns++
            noProgressTurnCount = consecutiveNoProgressTurns
            if (consecutiveNoProgressTurns >= 2 && !planExecutionRequired) {
              console.warn('Detected tool-call loop with no progress, forcing final answer')
              this.onAgentEventCallback?.({
                type: 'system_notification',
                subtype: 'runtime_notice',
                data: { message: '检测到重复探查，已中断循环并要求模型给出结论', success: true },
              })
              loopBroken = true
              terminationReason = 'no_progress'
              break
            }
          } else {
            consecutiveNoProgressTurns = 0
            progressSignalCount++
            segmentProgressSignalCount++
          }

          // 相同的一组工具错误连续出现三轮，说明模型没有根据错误调整参数。
          // 不拦截单次或不同错误，避免瞬时失败影响正常自我修复。
          if (errorSignature) {
            if (errorSignature === lastErrorSignature) {
              repeatedErrorTurns++
            } else {
              lastErrorSignature = errorSignature
              repeatedErrorTurns = 1
            }
            if (repeatedErrorTurns >= 3 && !planExecutionRequired) {
              console.warn('Detected repeated identical tool errors, forcing final answer')
              loopBroken = true
              terminationReason = 'no_progress'
              break
            }
          } else {
            repeatedErrorTurns = 0
            lastErrorSignature = ''
          }

          // 最后一个任务工具完成后立即进入内部复核。若等模型下一轮自然收尾，
          // 它会先输出一份对用户可见的总结，复核完成后再输出一次，造成双总结。
          const tasksAfterTools = this.config.taskManager?.listTasks() || []
          if (
            taskWorkflowActive &&
            !taskCompletionReviewRequested &&
            tasksAfterTools.length > 0 &&
            tasksAfterTools.every(task => task.status === 'completed')
          ) {
            enqueueTaskCompletionReview()
          }

          continue
        }

        // 回答末尾声明了"现在运行验证"之类的动作却没有发出工具调用：
        // 这是"说了没做就结束"的典型形态，续跑一次并强制以工具调用开头。
        if (
          promiseNudgeCount < MAX_PROMISE_NUDGES &&
          hasUnfulfilledActionPromise(assistantContent)
        ) {
          promiseNudgeCount++
          this.config.messages.push({
            id: this.generateId(),
            role: 'assistant',
            content: assistantContent,
            timestamp: Date.now(),
          })
          this.config.messages.push({
            id: this.generateId(),
            role: 'user',
            content:
              '[内部续跑] 上一段回答末尾提到了要执行的动作，但没有发出工具调用。' +
              '请直接调用对应的工具完成它。',
            timestamp: Date.now(),
            internal: true,
          })
          forceToolChoiceOnce = true
          continue
        }

        const unfinishedTasks =
          this.config.taskManager
            ?.listTasks()
            .filter(
              task =>
                task.status === 'pending' ||
                task.status === 'in_progress' ||
                (task.status === 'completed' && task.completion?.state === 'reviewing')
            ) || []
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
              '[内部任务续跑] 当前待实现任务 ' +
              unfinishedTasks.filter(task => task.status !== 'completed').length +
              ' 项，待复核任务 ' +
              unfinishedTasks.filter(task => task.completion?.state === 'reviewing').length +
              ' 项。请调用工具继续实现或核查；对于 reviewing 任务，检查工作区和验证结果后再次提交 task_update completed 即可通过复核，' +
              '可省略 completionEvidence 自动沿用已存证据，无需等待额外系统复核器。' +
              '若遇到必须由用户处理的阻塞，直接说明阻塞原因即可。\n\n' +
              this.buildTaskReviewContext(),
            timestamp: Date.now(),
            internal: true,
          })
          continue
        }

        if (taskWorkflowActive && unfinishedTasks.length > 0) {
          terminationReason = 'task_incomplete'
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
          enqueueTaskCompletionReview()
          continue
        }

        finalContent = assistantContent
        if (terminationReason !== 'task_incomplete') {
          terminationReason = taskWorkflowActive ? 'tasks_completed' : 'model_completed'
        }
        reachedNormalCompletion = true
        performanceLog('query.iteration.complete', {
          iteration,
          durationMs: Math.round(performance.now() - iterationStartedAt),
        })
        break
      }

      // 循环未正常闭环（触顶或被死循环断路器打断），且最后一轮以工具调用结尾：
      // 此时 finalContent 仍为空，直接落一条空 assistant 消息会导致闭环失败、
      // 任务面板停在半途。补一轮"无工具"的收尾请求，让模型基于已有结果给出总结。
      if (iteration >= MAX_TOTAL_ITERATIONS && !reachedNormalCompletion) {
        executionBudgetReached = true
      }

      if (planExecutionRequired && executionBudgetReached) {
        throw new Error(
          '计划已批准，但模型未调用任何实际执行工具。请重新发送“继续”，让模型按照批准的计划执行。'
        )
      }

      const needsClosing =
        (executionBudgetReached || loopBroken) && lastTurnHadToolCalls && !finalContent
      if (needsClosing) {
        console.warn('Tool loop ended without a final answer, requesting closing summary')
        this.throwIfCancelled()
        this.onAgentEventCallback?.({ type: 'content_start', blockType: 'text' })
        const closingResponse = await this.apiClient.sendMessageStream(
          this.buildRequestMessages([]),
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
      } else if (executionBudgetReached) {
        console.warn(
          `Reached execution budget (${executionSegment} segments, ${iteration} iterations)`
        )
      }

      if (
        executionBudgetReached &&
        !reachedNormalCompletion &&
        terminationReason !== 'no_progress'
      ) {
        terminationReason = 'max_iterations'
      }

      this.throwIfCancelled()
      // flush 所有待处理的 delta，确保最终内容在 message_complete 前完整发送
      this.flushPendingDeltas()
      this.activeThinkingBlockId = undefined
      const finalMessage: Message = {
        id: this.generateId(),
        role: 'assistant',
        content: finalContent,
        timestamp: Date.now(),
      }
      this.config.messages.push(finalMessage)
      const finalBudget = this.assessRequestBudget(this.buildRequestMessages())
      this.emitContextUsage(totalUsage, finalBudget)

      // 计算上下文窗口使用百分比
      if (totalUsage) {
        const contextWindow = this.getConfiguredContextWindow()

        totalUsage.contextWindow = contextWindow
        totalUsage.effectiveContextWindow = finalBudget.effectiveWindow
        totalUsage.estimatedCurrentTokens = finalBudget.estimatedTokens
        totalUsage.percentUsed = Math.min(Math.round(finalBudget.usageRatio * 100), 100)
      }

      this.lastTerminationReason = terminationReason
      this.onAgentEventCallback?.({
        type: 'message_complete',
        usage: totalUsage,
        terminationReason,
        completed: isSuccessfulTermination(terminationReason),
      })
      this.onCompleteCallback?.(finalMessage)
      performanceLog('query.complete', {
        iterations: iteration,
        durationMs: Math.round(performance.now() - queryStartedAt),
        ...performanceSnapshot(),
      })
      performanceLog('query.termination', {
        terminationReason,
        iteration,
        executionSegment,
        completed: isSuccessfulTermination(terminationReason),
        progressSignals: progressSignalCount,
        noProgressTurns: noProgressTurnCount,
      })
      return finalMessage
    } catch (error) {
      // 错误/取消也要先交付已收到的最后一批增量，避免思考段停留在临时状态。
      this.flushPendingDeltas()
      this.activeThinkingBlockId = undefined
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
      if (this.cancelled || this.abortController.signal.aborted) {
        terminationReason = 'user_cancelled'
      } else if (terminationReason !== 'output_limit') {
        terminationReason = 'provider_error'
      }
      this.lastTerminationReason = terminationReason
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
    this.activeThinkingBlockId = undefined
    this.abortController.abort()
    this.toolExecutor?.cancelAll()
    this.bashTool?.cancelAll()

    for (const [requestId, waiter] of this.permissionWaiters.entries()) {
      this.onAgentEventCallback?.({
        type: 'permission_response',
        requestId,
        approved: false,
        reason,
      })
      waiter({ requestId, approved: false, reason })
    }
    this.permissionWaiters.clear()
    for (const timeout of this.permissionTimeouts.values()) clearTimeout(timeout)
    this.permissionTimeouts.clear()
    this.permissionRequestTools.clear()
    this.permissionStartedAt.clear()
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

  getLastTerminationReason(): QueryTerminationReason {
    return this.lastTerminationReason
  }

  /**
   * 清空消息历史
   * 用于开始新对话
   */
  clearMessages() {
    this.config.messages = []
    this.contextBudget.reset()
  }

  /**
   * 执行工具调用
   * Phase 3 Week 3: 工具调用循环的核心方法
   *
   * @param toolCalls - 工具调用列表
   * @returns Promise<ToolResult[]> 工具执行结果
   */
  private async executeToolCalls(toolCalls: ToolCall[]): Promise<RunToolsOutcome> {
    this.throwIfCancelled()
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
  private buildRequestMessages(toolDefinitions = this.tools.map(tool => tool.getDefinition())): Message[] {
    const messages = stripVirtualizedImages(this.config.messages)
    const effectiveWindow = getEffectiveInputWindow(this.getConfiguredContextWindow())
    const estimated = estimateRequestTokens(
      messages,
      this.requestSystemPrompt,
      toolDefinitions
    )

    if (!shouldMicrocompact(estimated, effectiveWindow)) {
      return messages
    }

    return microcompact(messages, 5)
  }

  private assessRequestBudget(
    messages: Message[],
    toolDefinitions = this.tools.map(tool => tool.getDefinition())
  ) {
    return this.contextBudget.assess({
      messages,
      systemPrompt: this.requestSystemPrompt,
      tools: toolDefinitions,
      configuredWindow: this.getConfiguredContextWindow(),
    })
  }

  /** 在每轮 API/工具结果后更新上下文估算，让长任务在结束前即可看到真实进度。 */
  private emitContextUsage(
    usage: TokenUsage | undefined,
    snapshot = this.assessRequestBudget(this.buildRequestMessages())
  ): void {
    const contextWindow = this.getConfiguredContextWindow()
    const estimatedCurrentTokens = snapshot.estimatedTokens
    this.onAgentEventCallback?.({
      type: 'context_usage',
      usage: {
        ...(usage || {}),
        estimated: true,
        contextWindow,
        effectiveContextWindow: snapshot.effectiveWindow,
        estimatedCurrentTokens,
        percentUsed: Math.min(
          Math.round(snapshot.usageRatio * 100),
          100
        ),
      },
    })
  }

  private getConfiguredContextWindow(): number {
    const configured =
      this.config.provider.modelContextWindows?.[this.config.model] ||
      this.config.provider.autoCompactWindow
    return getContextWindowForModel(this.config.model, configured)
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
    if (this.cancelled || this.abortController.signal.aborted) {
      return Promise.resolve({ approved: false, reason: this.cancelReason })
    }

    const permissionMode = this.config.permissionMode || 'default'

    if (permissionMode === 'plan' && toolName.startsWith('task_')) {
      return Promise.resolve({ approved: false, reason: '计划模式完全不使用 Task 工具' })
    }

    if (
      permissionMode === 'plan' &&
      !this.config.planModeManager?.isToolAllowedInPlanMode(toolName, this.config.sessionId)
    ) {
      return Promise.resolve({
        approved: false,
        reason:
          `计划尚未审批，不能调用 ${toolName}。` +
          '请不要重试写入或执行操作，继续只读分析并调用 exit_plan_mode 提交计划。',
      })
    }

    if (permissionMode === 'bypassPermissions' || this.sessionAllowedTools.has(toolName)) {
      return Promise.resolve({ approved: true })
    }

    const policy = this.toolPolicies.get(toolName)
    const capabilities = new Set(policy?.capabilities || [])
    const isWriteTool = capabilities.has('write')
    const isExecutionTool = capabilities.has('execute')
    const isNetworkTool = capabilities.has('network')
    const isDangerousFileTool = ['delete_file', 'move_file', 'copy_file'].includes(toolName)
    let requiresApproval = false
    if (permissionMode === 'plan') {
      requiresApproval = false
    } else if (permissionMode === 'acceptEdits') {
      requiresApproval = isExecutionTool || isNetworkTool || isDangerousFileTool
    } else {
      requiresApproval = isWriteTool || isExecutionTool || isNetworkTool
    }

    if (!requiresApproval) {
      return Promise.resolve({ approved: true })
    }

    const requestId = this.generateId()
    this.permissionStartedAt.set(requestId, performance.now())
    performanceLog('permission.request', { requestId, toolName, toolUseId })
    this.permissionRequestTools.set(requestId, toolName)
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
        const timeout = this.permissionTimeouts.get(requestId)
        if (timeout) clearTimeout(timeout)
        this.permissionTimeouts.delete(requestId)
        this.permissionRequestTools.delete(requestId)
        this.permissionStartedAt.delete(requestId)
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
            this.permissionTimeouts.delete(requestId)
            performanceLog('permission.timeout', { requestId, toolName })
            this.onAgentEventCallback?.({
              type: 'permission_response',
              requestId,
              approved: false,
              reason: 'Permission request timed out',
            })
            resolve({ approved: false, reason: 'Permission request timed out' })
          }
        },
        5 * 60 * 1000
      )
      this.permissionTimeouts.set(requestId, timeoutId)

      // 先注册 waiter 和超时，再通知 UI，避免快速点击授权时丢失响应。
      this.onAgentEventCallback?.({
        type: 'permission_request',
        requestId,
        toolName,
        toolUseId,
        input,
        description: this.getPermissionDescription(toolName),
      })
    })
  }

  private requiresPlanToolUse(): boolean {
    if (this.config.permissionMode !== 'plan') return false
    return this.config.planModeManager?.getState(this.config.sessionId || '') !== 'approved'
  }

  private isPlanExecutionTool(toolName: string): boolean {
    if (toolName === 'enter_plan_mode' || toolName === 'exit_plan_mode') return false
    const capabilities = new Set(this.toolPolicies.get(toolName)?.capabilities || [])
    return capabilities.has('write') || capabilities.has('execute')
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

  private buildTaskReviewContext(): string {
    const tasks = this.config.taskManager?.listTasks() || []
    if (!tasks.length) return '当前没有结构化任务。'

    return tasks
      .map(task => {
        const requirements = (this.config.taskManager?.getRequirementsForTask(task) || [])
          .map(item => `  - [${item.id}] ${item.sourceText}`)
          .join('\n')
        return [
          `任务 ${task.id}: ${task.subject}`,
          `任务状态: ${task.status}`,
          `完成状态: ${task.completion?.state || 'none'}`,
          '继承的原始要求:',
          requirements || '  - 无',
          '已提交证据（仅作线索，必须自行核查）:',
          JSON.stringify(task.completion?.evidence || [], null, 2),
        ].join('\n')
      })
      .join('\n\n')
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
      maxTokens: 6_000,
    })
    const originalMessages = this.config.messages
    const previousSummaries = originalMessages.filter(isCompactSummaryMessage)
    const conversationMessages = originalMessages.filter(message => !isCompactSummaryMessage(message))
    const compactionMessages = buildRollingCompactionInput(originalMessages)
    const tasks = this.config.taskManager?.listTasks() || []
    if (tasks.length) {
      compactionMessages.push({
        id: `compact-task-state-${Date.now()}`,
        role: 'user',
        content:
          '[压缩前的结构化任务状态，必须原样保留到摘要中；不要把已完成任务改写为待完成。]\n' +
          this.buildTaskReviewContext(),
        timestamp: Date.now(),
        internal: true,
      })
    }
    const summaryInput = microcompact(compactionMessages, 0)
    const { summaryMessage } = await compactConversation(
      summaryInput,
      summaryApiClient,
      summaryModel
    )

    // 保留最近 N 条消息（可配置，默认 10）
    const keepRecentCount = Math.max(
      5,
      Math.min(50, this.config.compactKeepRecentMessages || 10)
    )
    const tools = this.tools.map(tool => tool.getDefinition())
    const beforeTokens = estimateRequestTokens(
      this.buildRequestMessages(tools),
      this.requestSystemPrompt,
      tools
    )
    const targetTokens = getEffectiveInputWindow(this.getConfiguredContextWindow()) * 0.55
    let recentCount = keepRecentCount
    let compactedMessages: Message[] = []
    let afterTokens = Number.POSITIVE_INFINITY

    while (recentCount >= 0) {
      compactedMessages = replaceWithRollingSummary(
        conversationMessages,
        summaryMessage,
        recentCount
      )
      if (tasks.length) {
        compactedMessages.push({
          id: `compact-task-recovery-${Date.now()}`,
          role: 'user',
          content:
            '[压缩后的实时任务状态，以此为准，不要从摘要推测状态。]\n' +
            this.buildTaskReviewContext() +
            '\nreviewing 需要你检查工作区和验证结果，再调用 task_update completed 即可通过复核；' +
            '省略 completionEvidence 会沿用已存证据。无需等待额外系统复核器，已 passed 的任务无需重做。',
          timestamp: Date.now(),
          internal: true,
        })
      }
      this.config.messages = compactedMessages
      afterTokens = estimateRequestTokens(
        this.buildRequestMessages(tools),
        this.requestSystemPrompt,
        tools
      )
      if (afterTokens <= targetTokens || recentCount === 0) break
      recentCount = recentCount <= 2 ? recentCount - 1 : Math.floor(recentCount / 2)
    }

    if (afterTokens >= beforeTokens * 0.9) {
      this.config.messages = originalMessages
      throw new Error(
        `压缩未显著降低请求大小（${beforeTokens} -> ${afterTokens} tokens），已回滚`
      )
    }

    // 压缩后模型可能需要重新读取证据，不能回放已被摘要替换的旧探查结果。
    this.toolOrchestrator?.resetDedup()

    if (this.config.verbose) {
      console.log('[QueryEngine] Auto-compact completed:', {
        originalMessageCount: compactionMessages.length,
        previousSummaryCount: previousSummaries.length,
        keptRecentCount: recentCount,
        newMessageCount: this.config.messages.length,
        beforeTokens,
        afterTokens,
      })
    }
  }
}

function isContextWindowError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /context window|context length|maximum context|too many tokens|input exceeds|input.*too (?:long|large)|token limit/i.test(
    message
  )
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
