/**
 * 聊天服务 - 会话和消息管理
 *
 * 职责：
 * 1. 管理会话列表和当前活动会话
 * 2. 处理用户消息发送
 * 3. 调用 QueryEngine 与 AI 交互
 * 4. 持久化会话数据到文件系统（Phase 2 Week 3）
 *
 * 设计模式：仓储模式 (Repository Pattern)
 * - 封装数据访问逻辑
 * - 隔离业务逻辑和存储实现
 * - 便于切换存储方式（内存 → 文件 → 数据库）
 */

import * as vscode from 'vscode'
import * as path from 'path'
import type {
  Session,
  Message,
  AttachmentContext,
  AgentTranscriptBlock,
  TokenUsage,
  Provider,
  InlineMessageSegment,
} from '../../types'
import type { AgentServerEvent } from '../../types/messages'
import { ProviderService } from '../provider/ProviderService'
import { TaskManager } from '../task/TaskManager'
import { PlanModeManager } from '../plan/PlanModeManager'
import { AgentCoordinator } from '../agent/AgentCoordinator'
import { MCPConnectionManager } from '../mcp/MCPConnectionManager'
import { SkillManager } from '../skill/SkillManager'
import { MemoryManager } from '../memory/MemoryManager'
import { LLMMemoryExtractor } from '../memory/LLMMemoryExtractor'
import { QueryCancelledError, QueryEngine } from '../../core/engine/QueryEngine'
import {
  DEFAULT_MAX_EXECUTION_SEGMENTS,
  isSuccessfulTermination,
} from '../../core/engine/termination'
import {
  readImageAsBase64,
  saveGeneratedImages,
  timestampedImagePath,
} from '../../core/tools/image/imageStorage'
import { buildOpenAIImageUrl, downloadAsBase64 } from '../../core/tools/image/imageUtils'
import { commandManager } from '../command/CommandManager'
import { SessionPersistenceService } from '../persistence/SessionPersistenceService'
import { TaskNotificationQueue } from '../agent/TaskNotificationQueue'
import { createApiClient } from '../../core/services/api'
import {
  buildRollingCompactionInput,
  compactConversation,
  replaceWithRollingSummary,
} from '../compact/compact'
import type { ToolProfileService } from '../tools/ToolProfileService'
import {
  composeUserPrompt,
  createRequestContext,
  formatRequestContract,
  shouldIncludeRequestContract,
} from './UserPromptComposer'

/**
 * 消息回调类型
 * 用于通知 WebviewManager 更新 UI
 */
export type MessageCallback = (message: Message) => void
export type StreamCallback = (delta: string, isComplete: boolean, sessionId: string) => void
export type AgentEventCallback = (event: AgentServerEvent, sessionId: string) => void

/**
 * 单个会话独占的运行时资源。
 *
 * QueryEngine 和取消控制器不能跟随 UI 的当前会话切换，否则后台会话会被新会话
 * 复用或误停。运行时仅存在于扩展进程内，会话内容仍由 Session 持久化。
 */
interface SessionRuntime {
  engine?: QueryEngine
  activeRequest?: Promise<void>
  requestQueue: Promise<void>
  requestController?: AbortController
  directGenerationController?: AbortController
  isStreaming: boolean
  memoryQuery: string
}

const TEXT_ATTACHMENT_LIMIT = 120_000
const GLOBAL_MODEL_KEY = 'evancod.runtime.model'
const GLOBAL_EFFORT_LEVEL_KEY = 'evancod.runtime.effortLevel'
const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022'
const DEFAULT_EFFORT_LEVEL: 'low' | 'medium' | 'high' | 'max' = 'medium'

export class ChatService {
  private transcriptDeltaBuffers = new Map<string, string>()
  private transcriptDeltaFlushAt = new Map<string, number>()
  private activeThinkingBlockIds = new Map<string, string>()
  /**
   * 会话列表（存储在内存中）
   * 优势：
   * - 读写速度快
   * - 便于实现撤销/重做
   *
   * 劣势：
   * - 插件重启后丢失（需要持久化）
   *
   * 会话持久化由 SessionPersistenceService 写入 Evancod 专属存储目录。
   */
  private sessions: Session[] = []

  /**
   * 当前活动会话 ID
   * null 表示没有活动会话
   */
  private currentSessionId: string | null = null
  /** 用于丢弃并发会话切换中较早的加载结果。 */
  private sessionSwitchGeneration = 0

  /**
   * 是否正在流式接收 AI 响应
   * 用于防止重复发送、显示加载状态等
   */
  private sessionRuntimes = new Map<string, SessionRuntime>()

  private currentModelId: string | null
  private effortLevel: 'low' | 'medium' | 'high' | 'max'
  private permissionMode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' = 'default'
  private persistence: SessionPersistenceService
  private taskNotificationQueue = new TaskNotificationQueue()

  /**
   * 消息回调
   * 用于通知外部消息更新
   */
  private messageCallback?: MessageCallback
  private streamCallback?: StreamCallback
  private agentEventCallback?: AgentEventCallback

  /**
   * 构造函数 - 依赖注入
   *
   * @param context - VSCode 扩展上下文
   * @param providerService - Provider 服务（用于获取 API 配置）
   * @param taskManager - Task 管理服务（用于任务管理工具）
   * @param planModeManager - Plan Mode 管理服务（用于计划模式工具）
   * @param agentCoordinator - Agent 协调器（用于子 Agent 工具）
   * @param mcpManager - MCP 连接管理器（用于 MCP 工具）
   * @param skillManager - Skill 管理器（用于 Skill 工具）
   * @param memoryManager - Memory 管理器（用于记忆系统）
   */
  constructor(
    private context: vscode.ExtensionContext,
    private providerService: ProviderService,
    private taskManager: TaskManager,
    private planModeManager: PlanModeManager,
    private agentCoordinator: AgentCoordinator,
    private mcpManager: MCPConnectionManager,
    private skillManager: SkillManager,
    private memoryManager: MemoryManager,
    private toolProfileService?: ToolProfileService
  ) {
    this.persistence = new SessionPersistenceService(context)
    this.currentModelId = context.globalState.get<string>(GLOBAL_MODEL_KEY) || null
    this.effortLevel = this.readGlobalEffortLevel()
    this.memoryManager.setSemanticExtractor(
      new LLMMemoryExtractor(() => {
        const provider = this.providerService.getActiveProvider()
        if (!provider || provider.apiFormat === 'openai_image') return undefined
        const model = this.getCurrentModel()
        return model ? { provider, model } : undefined
      })
    )
  }

  async initialize(): Promise<void> {
    const data = await this.persistence.load()
    const loadedSessions = Object.values(data.sessions)
    this.sessions = loadedSessions
      .filter(session => this.hasConversationMessages(session))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    this.currentSessionId =
      data.currentSessionId && this.sessions.some(session => session.id === data.currentSessionId)
        ? data.currentSessionId
        : this.sessions[0]?.id || null
    this.taskManager.setCurrentSession(this.currentSessionId)
    if (this.currentSessionId) {
      await this.taskManager.load()
    }

    for (const session of this.sessions) {
      this.expirePendingTranscript(session)
      this.taskNotificationQueue.restore(session)
      // 扩展重启后不可能仍有运行中的请求。只修正内存状态，沿用后续正常保存节奏。
      if (session.activeRun?.status === 'running') {
        session.activeRun.status = 'interrupted'
        session.activeRun.reason = '扩展重启前请求尚未结束，可继续执行。'
        session.activeRun.retryable = true
        session.activeRun.updatedAt = Date.now()
        const requestContext = session.requestContexts?.find(
          context => context.id === session.activeRun?.requestId
        )
        if (requestContext) {
          requestContext.status = 'interrupted'
          requestContext.updatedAt = new Date().toISOString()
        }
      }
      // 性能优化：初始化时计算并缓存消息数量
      if (session.messageCount === undefined) {
        session.messageCount = session.messages.length
      }
    }
    if (this.sessions.length !== loadedSessions.length) {
      this.saveSessions()
    }
    const currentSession = this.getCurrentSession()
    // 兼容持久化全局状态加入前已有的会话配置，并将其升级为全局偏好。
    // 全局状态优先，避免打开扩展时被旧会话覆盖。
    const legacyRuntimeConfig = currentSession?.runtimeConfig
    if (!this.currentModelId && legacyRuntimeConfig?.model) {
      this.currentModelId = legacyRuntimeConfig.model
      this.persistGlobalModel()
    }
    if (this.effortLevel === DEFAULT_EFFORT_LEVEL && legacyRuntimeConfig?.effortLevel) {
      this.effortLevel = legacyRuntimeConfig.effortLevel
      this.persistGlobalEffortLevel()
    }
    const activeRequestContext = currentSession?.requestContexts?.find(
      context => context.id === currentSession.activeRun?.requestId
    )
    this.taskManager.setActiveRequestContext(activeRequestContext)
  }

  async flush(): Promise<void> {
    await this.persistence.flush()
  }

  dispose(): void {
    this.persistence.dispose()
  }

  private saveSessions(immediate = false): void {
    const sessions: Record<string, Session> = {}
    for (const session of this.sessions) {
      if (
        !this.hasConversationMessages(session) &&
        !this.sessionRuntimes.get(session.id)?.activeRequest
      )
        continue
      sessions[session.id] = session
    }

    // 空会话只是当前输入草稿，不能让持久化数据继续指向它。
    const currentSessionId =
      this.currentSessionId && sessions[this.currentSessionId] ? this.currentSessionId : null

    void this.persistence.save(
      {
        sessions,
        currentSessionId,
      },
      immediate
    )
  }

  /**
   * 设置消息回调
   *
   * @param callback - 消息回调函数
   */
  onMessage(callback: MessageCallback) {
    this.messageCallback = callback
  }

  /**
   * 设置流式回调
   *
   * @param callback - 流式回调函数
   */
  onStream(callback: StreamCallback) {
    this.streamCallback = callback
  }

  onAgentEvent(callback: AgentEventCallback) {
    this.agentEventCallback = callback
  }

  /**
   * 获取会话运行时；首次发送消息时才创建，避免历史会话占用引擎资源。
   *
   * @param sessionId - 会话 ID
   * @returns 会话独占的运行时
   */
  private getSessionRuntime(sessionId: string): SessionRuntime {
    let runtime = this.sessionRuntimes.get(sessionId)
    if (!runtime) {
      runtime = {
        requestQueue: Promise.resolve(),
        isStreaming: false,
        memoryQuery: '',
      }
      this.sessionRuntimes.set(sessionId, runtime)
    }
    return runtime
  }

  /**
   * 获取指定会话，不依赖可能随时变化的当前 UI 会话。
   *
   * @param sessionId - 会话 ID
   * @returns 匹配的会话，找不到时返回 null
   */
  private getSession(sessionId: string): Session | null {
    return this.sessions.find(session => session.id === sessionId) || null
  }

  /**
   * 创建新会话
   *
   * 会话创建流程：
   * 1. 生成唯一 ID
   * 2. 获取当前工作目录
   * 3. 初始化空消息列表
   * 4. 添加到会话列表
   * 5. 设置为当前活动会话
   *
   * @returns 新创建的会话对象
   */
  async createNewSession(): Promise<Session> {
    return this.createNewSessionNow()
  }

  private async createNewSessionNow(): Promise<Session> {
    // 空会话只是输入草稿，不进入历史记录。
    this.sessions = this.sessions.filter(
      session =>
        this.hasConversationMessages(session) ||
        Boolean(this.sessionRuntimes.get(session.id)?.activeRequest)
    )
    // 获取工作目录（用于文件操作的相对路径基准）
    const activeFolder =
      vscode.window.activeTextEditor &&
      vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
    const workDir =
      activeFolder?.uri.fsPath ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      process.cwd()

    // 创建会话对象
    const session: Session = {
      id: this.generateId(),
      name: `会话 ${new Date().toLocaleString('zh-CN')}`, // 默认名称：会话 2026/6/27 22:45:30
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      workDir,
      transcript: [],
      agentTaskNotifications: {},
      runtimeConfig: {
        model: this.getCurrentModel(),
        effortLevel: this.effortLevel,
        permissionMode: this.permissionMode,
      },
      messageCount: 0,
    }

    // 添加到会话列表
    this.sessions.push(session)

    // 设置为当前活动会话。新会话也会使尚未完成的历史会话加载失效。
    this.sessionSwitchGeneration++
    this.currentSessionId = session.id
    this.saveSessions()
    await this.refreshCurrentSessionTasks()

    return session
  }

  /**
   * 获取当前活动会话
   *
   * @returns 当前会话对象，如果没有则返回 null
   */
  getCurrentSession(): Session | null {
    if (!this.currentSessionId) return null
    return this.sessions.find(s => s.id === this.currentSessionId) || null
  }

  /**
   * 获取所有会话列表
   *
   * @returns 会话数组
   */
  getSessions(): Session[] {
    return this.sessions.filter(
      session =>
        this.hasConversationMessages(session) ||
        Boolean(this.sessionRuntimes.get(session.id)?.activeRequest)
    )
  }

  /**
   * 判断会话是否仍有顶层请求在执行。
   *
   * @param sessionId - 会话 ID
   * @returns 请求处于执行或收尾阶段时返回 true
   */
  isSessionRunning(sessionId: string): boolean {
    const activeRun = this.getSession(sessionId)?.activeRun
    if (activeRun) return activeRun.status === 'running'
    return Boolean(this.sessionRuntimes.get(sessionId)?.activeRequest)
  }

  private hasConversationMessages(session: Session): boolean {
    return session.messages.some(message => message.role === 'user' || message.role === 'assistant')
  }

  async loadSession(sessionId: string): Promise<Session | null> {
    const session = this.sessions.find(s => s.id === sessionId) || null
    if (!session) return null

    const generation = ++this.sessionSwitchGeneration
    this.currentSessionId = session.id
    this.saveSessions()
    // 先加载任务再通知，避免在任务加载完成前发送空/旧列表
    await this.refreshCurrentSessionTasks()
    // 用户快速选择多个会话时，较早的异步任务加载结果不能覆盖最后一次选择。
    if (generation !== this.sessionSwitchGeneration) return null
    return session
  }

  /**
   * 加载当前会话任务并通知前端。
   *
   * 统一“先加载、再通知”的顺序，避免会话切换/恢复时先发出空任务列表。
   * 加载完成后再次校验 currentSessionId，防止快速切换会话导致旧结果覆盖新会话。
   */
  private async refreshCurrentSessionTasks(): Promise<void> {
    const sessionId = this.currentSessionId
    this.taskManager.setCurrentSession(sessionId)
    if (!sessionId) {
      this.taskManager.notifyTaskList()
      return
    }

    try {
      await this.taskManager.load()
    } catch (err) {
      console.error('Failed to load tasks:', err)
    }

    // 加载期间会话可能已切换，避免用旧会话结果覆盖
    if (this.currentSessionId !== sessionId) return
    const session = this.getCurrentSession()
    const activeRequestContext = session?.requestContexts?.find(
      context => context.id === session.activeRun?.requestId
    )
    this.taskManager.setActiveRequestContext(activeRequestContext)
    this.taskManager.notifyTaskList()
  }

  /**
   * 读盘重显：把 transcript 中的 image_generation block 的磁盘 path 读成 base64，
   * 返回浅拷贝会话（不修改原会话，避免把 base64 写回内存/磁盘）。
   * 发送给 Webview 前调用。
   */
  async hydrateSessionImages(session: Session | null): Promise<Session | null> {
    if (!session?.transcript?.length) return session

    const imageBlocks = session.transcript.filter(
      (block): block is Extract<AgentTranscriptBlock, { type: 'image_generation' }> =>
        block.type === 'image_generation' && !!block.image?.path && !block.image?.base64
    )
    if (imageBlocks.length === 0) return session

    const base64ByPath = new Map<string, string | undefined>()
    await Promise.all(
      imageBlocks.map(async block => {
        const relPath = block.image!.path!
        if (base64ByPath.has(relPath)) return
        base64ByPath.set(relPath, await readImageAsBase64(session.workDir, relPath))
      })
    )

    const transcript = session.transcript.map(block => {
      if (block.type !== 'image_generation' || !block.image?.path || block.image.base64)
        return block
      const base64 = base64ByPath.get(block.image.path)
      if (!base64) return block
      return { ...block, image: { ...block.image, base64 } }
    })

    return { ...session, transcript }
  }

  async deleteSession(sessionId: string): Promise<void> {
    // 删除操作同样会使并发中的历史会话加载失效。
    this.sessionSwitchGeneration++
    await this.stopGeneration(sessionId)

    this.sessions = this.sessions.filter(session => session.id !== sessionId)
    this.sessionRuntimes.delete(sessionId)
    if (this.currentSessionId === sessionId) {
      this.currentSessionId = this.sessions[0]?.id || null
      this.saveSessions()
      // 先加载新当前会话任务再通知，避免发送空/旧列表
      await this.refreshCurrentSessionTasks()
      return
    }
    this.saveSessions()
  }

  getCurrentModel(): string {
    const provider = this.providerService.getActiveProvider()
    return this.currentModelId || provider?.models.main || DEFAULT_MODEL
  }

  setCurrentModel(model: string) {
    if (!model.trim()) {
      throw new Error('模型不能为空')
    }

    this.currentModelId = model.trim()
    this.persistGlobalModel()
    this.invalidateCurrentSessionEngine()
    this.persistRuntimeConfig()
  }

  getRuntimeState() {
    return {
      currentModel: this.getCurrentModel(),
      effortLevel: this.effortLevel,
      permissionMode: this.permissionMode,
    }
  }

  setRuntimeOptions(options: {
    model?: string
    effortLevel?: 'low' | 'medium' | 'high' | 'max'
    permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  }) {
    if (options.model) {
      this.currentModelId = options.model.trim()
      this.persistGlobalModel()
    }

    if (options.effortLevel) {
      this.effortLevel = options.effortLevel
      this.persistGlobalEffortLevel()
    }

    if (options.permissionMode) {
      this.permissionMode = options.permissionMode
    }

    this.invalidateCurrentSessionEngine()
    this.persistRuntimeConfig()
  }

  resetRuntime() {
    this.currentModelId = null
    this.effortLevel = 'medium'
    this.permissionMode = 'default'
    this.invalidateCurrentSessionEngine()
    this.persistRuntimeConfig()
  }

  getSlashCommands() {
    return commandManager.getAllCommands().map(command => ({
      command: `/${command.name}`,
      desc: command.description,
      usage: command.usage,
    }))
  }

  /**
   * 获取所有已启用的 Skill（供前端 /skill-list 弹框展示）。
   *
   * 只暴露展示所需的轻量字段，正文不下发；用户选中后由前端拼成
   * 自然语言指令发送，模型再按需通过 skill 工具加载正文。
   */
  getSkills() {
    return this.skillManager.listEnabledSkills().map(skill => ({
      name: skill.metadata.name,
      description: skill.metadata.description || '',
      trigger: skill.metadata.trigger || `/${skill.metadata.name}`,
      source: skill.source,
    }))
  }

  handlePermissionResponse(response: {
    requestId: string
    sessionId?: string
    approved: boolean
    reason?: string
    updatedInput?: unknown
    rule?: 'once' | 'always'
  }): boolean {
    const runtimes = response.sessionId
      ? ([[response.sessionId, this.sessionRuntimes.get(response.sessionId)]] as const)
      : Array.from(this.sessionRuntimes.entries())
    const match = runtimes.find(([, runtime]) =>
      runtime?.engine?.handlePermissionResponse(response)
    )
    const handled = Boolean(match)
    if (match) this.recordPermissionResponse(match[0], response)
    return handled
  }

  handleInteractionResponse(response: {
    requestId: string
    sessionId?: string
    answered: boolean
    answers?: unknown
    reason?: string
  }): boolean {
    const runtimes = response.sessionId
      ? ([[response.sessionId, this.sessionRuntimes.get(response.sessionId)]] as const)
      : Array.from(this.sessionRuntimes.entries())
    const match = runtimes.find(([, runtime]) =>
      runtime?.engine?.handleInteractionResponse(response)
    )
    const handled = Boolean(match)
    if (match) this.recordInteractionResponse(match[0], response)
    return handled
  }

  cancelBash(toolUseId: string, taskId?: string): boolean {
    return Array.from(this.sessionRuntimes.values()).some(
      runtime => runtime.engine?.cancelBash(toolUseId, taskId) ?? false
    )
  }

  /**
   * 仅停止指定会话的生成任务，不影响其他后台会话。
   *
   * @param sessionId - 要停止的会话；省略时停止当前 UI 会话
   * @returns 被停止的会话
   */
  async stopGeneration(sessionId = this.currentSessionId || undefined): Promise<Session | null> {
    if (!sessionId) return null
    const session = this.getSession(sessionId)
    const runtime = this.sessionRuntimes.get(sessionId)
    const cancelledEngine = runtime?.engine
    const activeRequest = runtime?.activeRequest
    cancelledEngine?.cancel('用户停止生成')
    if (session) void this.planModeManager.completePlan(session.id)
    runtime?.requestController?.abort('用户停止生成')
    runtime?.directGenerationController?.abort('用户停止生成')
    void this.agentCoordinator.cancelAgentsForSession(sessionId, '用户停止生成').catch(error => {
      console.error('Failed to finish cancelling sub agents:', error)
    })

    // 停止必须立即响应。请求与子 Agent 的持久化收尾留在后台完成，不能阻塞
    // chat.stop 的响应；否则不可中断的第三方工具会让 UI 一直显示运行中。
    const releaseCancelledEngine = () => {
      if (runtime && runtime.engine === cancelledEngine) runtime.engine = undefined
    }
    void activeRequest?.then(releaseCancelledEngine, releaseCancelledEngine)

    if (session) {
      this.expirePendingTranscript(session)
      if (session.activeRun?.status === 'running') {
        session.activeRun.status = 'cancelled'
        session.activeRun.reason = '用户停止生成'
        session.activeRun.retryable = false
        session.activeRun.updatedAt = Date.now()
        const requestContext = session.requestContexts?.find(
          context => context.id === session.activeRun?.requestId
        )
        if (requestContext) {
          requestContext.status = 'cancelled'
          requestContext.updatedAt = new Date().toISOString()
        }
      }
      session.updatedAt = Date.now()
      this.saveSessions(true)
    }

    return session
  }

  notifyTaskList(): void {
    this.taskManager.notifyTaskList()
  }

  /**
   * 使缓存的 QueryEngine 失效
   *
   * QueryEngine 在构造时固化了当前激活 Provider 的快照（含 apiFormat）。
   * 当 Provider 配置被修改或切换激活项后，必须调用此方法，
   * 否则下次发消息会复用旧快照，导致仍走旧协议端点。
   */
  invalidateEngine(): void {
    this.invalidateCurrentSessionEngine()
  }

  /** 使当前会话的缓存引擎失效；运行中的引擎保留到本轮结束。 */
  private invalidateCurrentSessionEngine(): void {
    if (!this.currentSessionId) return
    const runtime = this.sessionRuntimes.get(this.currentSessionId)
    if (runtime && !runtime.activeRequest) runtime.engine = undefined
  }

  getMcpManager(): MCPConnectionManager {
    return this.mcpManager
  }

  /**
   * 发送消息到 AI
   *
   * 消息发送流程：
   * 1. 验证当前会话是否存在
   * 2. 创建用户消息并添加到会话
   * 3. 初始化 QueryEngine（如果还未初始化）
   * 4. 调用 QueryEngine.query() 发送消息
   * 5. 接收 AI 响应（流式或一次性）
   * 6. 将 AI 响应添加到会话
   * 7. 更新会话时间戳
   *
   * @param content - 消息内容
   * @param images - 可选的图片附件
   * @throws Error 如果没有活动会话
   *
   * Phase 2 Week 1: 集成 QueryEngine
   * Phase 2 Week 2: 实现真实的 API 调用
   * Phase 2 Week 3: 实现图片上传
   */
  async sendMessage(
    content: string,
    attachments: (string | AttachmentContext)[] = [],
    inlineSegments: InlineMessageSegment[] = [],
    messageId?: string
  ): Promise<void> {
    const sessionId = this.currentSessionId
    if (!sessionId) throw new Error('No active session')
    const runtime = this.getSessionRuntime(sessionId)
    const previousRequest = runtime.activeRequest
    const requestController = new AbortController()
    const request = runtime.requestQueue
      .catch(() => undefined)
      .then(async () => {
        if (previousRequest) {
          await previousRequest.catch(() => undefined)
        }
        if (requestController.signal.aborted) return
        await this.taskManager.runInSession(sessionId, () =>
          this.runMessage(
            sessionId,
            content,
            attachments,
            inlineSegments,
            messageId,
            requestController.signal
          )
        )
      })
    runtime.requestQueue = request
    runtime.activeRequest = request
    runtime.requestController = requestController
    try {
      await request
    } finally {
      if (runtime.activeRequest === request) {
        runtime.activeRequest = undefined
      }
      if (runtime.requestController === requestController) {
        runtime.requestController = undefined
      }
    }
  }

  private async runMessage(
    sessionId: string,
    content: string,
    attachments: (string | AttachmentContext)[] = [],
    inlineSegments: InlineMessageSegment[] = [],
    messageId?: string,
    requestSignal?: AbortSignal
  ): Promise<void> {
    // 1. 验证会话
    const session = this.getSession(sessionId)
    if (!session) {
      throw new Error('No active session')
    }
    const runtime = this.getSessionRuntime(sessionId)

    // Memory 虽在扩展启动后后台加载，但首个 Query 必须等待它就绪，
    // 避免用户刚启动就提问时漏掉项目记忆。
    await this.memoryManager.initialize()
    if (requestSignal?.aborted) return

    const commandResult = await this.resolveSlashCommand(content, session, messageId)
    if (commandResult.handled) {
      this.saveSessions()
      this.agentEventCallback?.(
        { type: 'status', state: 'idle', verb: 'command_completed' },
        session.id
      )
      return
    }

    const attachmentContexts = await this.resolveAttachments(attachments)
    if (requestSignal?.aborted) return
    const interruptedContext = isContinuationMessage(commandResult.content)
      ? this.findInterruptedRequestContext(session)
      : undefined
    const composedPrompt = composeUserPrompt(
      commandResult.content,
      inlineSegments,
      attachmentContexts
    )
    const sourceMessageId = messageId || this.generateId()
    if (!interruptedContext) {
      void this.memoryManager
        .captureUserMessage(content, session.workDir, sourceMessageId)
        .catch(error =>
          console.warn(
            'Memory extraction failed:',
            error instanceof Error ? error.message : 'unknown'
          )
        )
    }
    const requestContext =
      interruptedContext ||
      createRequestContext(
        `request-${sourceMessageId}`,
        sourceMessageId,
        commandResult.content,
        composedPrompt
      )
    if (!interruptedContext) {
      session.requestContexts ||= []
      session.requestContexts.push(requestContext)
    } else {
      requestContext.status = 'active'
      requestContext.updatedAt = new Date().toISOString()
    }
    this.taskManager.setActiveRequestContext(requestContext)
    session.activeRun = {
      id: `run-${sourceMessageId}`,
      requestId: requestContext.id,
      status: 'running',
      phase: 'planning',
      updatedAt: Date.now(),
    }
    this.agentEventCallback?.({ type: 'status', state: 'thinking', verb: 'started' }, session.id)
    const requestContract = shouldIncludeRequestContract(requestContext, {
      continuation: Boolean(interruptedContext),
    })
      ? formatRequestContract(requestContext)
      : ''
    const recoveryInstruction = interruptedContext
      ? '这是对上次中断请求的继续执行。先检查工作区和未完成任务的实际状态，不要重复已完成步骤。'
      : ''
    const messageContent = [composedPrompt.modelContent, recoveryInstruction, requestContract]
      .filter(Boolean)
      .join('\n\n')
    runtime.memoryQuery = commandResult.content
    const userContentBlocks = this.buildUserContentBlocks(messageContent, attachmentContexts, true)

    // 检测是否为 openai_image 格式的 Provider —— 不需要初始化 QueryEngine
    const activeProvider = this.providerService.getActiveProvider()
    const isDirectImageGen = activeProvider?.apiFormat === 'openai_image'

    // 3. 初始化 QueryEngine（openai_image 格式不需要）
    if (!isDirectImageGen) {
      await this.initializeQueryEngine(session, runtime)
    }
    if (requestSignal?.aborted) return

    // 记录是否为本会话第一条用户消息（用于用首条消息内容作为会话标题）
    const isFirstUserMessage = session.messages.length === 0

    // 2. 创建用户消息，先更新 UI；最终以 QueryEngine 的完整消息历史为准
    const displayContent = commandResult.displayContent || commandResult.content
    const userMessage: Message = {
      id: sourceMessageId,
      role: 'user',
      content: displayContent,
      timestamp: Date.now(),
      contentBlocks: userContentBlocks,
      attachments: attachmentContexts,
      inlineSegments,
    }
    session.messages.push(userMessage)

    // 首条消息：用对话内容作为会话标题（替换默认的创建时间标题）
    if (isFirstUserMessage) {
      const title = displayContent.trim().replace(/\s+/g, ' ')
      if (title) {
        session.name = title.length > 100 ? title.slice(0, 100) : title
      }
    }
    session.attachments = attachmentContexts
    this.appendOrUpdateTranscript(session, {
      id: userMessage.id,
      type: 'user_text',
      content: displayContent,
      timestamp: userMessage.timestamp,
      attachments: attachmentContexts,
      inlineSegments,
    })
    session.updatedAt = Date.now()
    session.messageCount = session.messages.length

    // 通知外部（用于更新 UI）
    if (this.messageCallback) {
      this.messageCallback(userMessage)
    }

    // 标记为流式接收中
    runtime.isStreaming = true

    try {
      // openai_image 格式 Provider —— 直接走图片生成路径
      if (isDirectImageGen && activeProvider) {
        const controller = new AbortController()
        runtime.directGenerationController = controller
        try {
          await this.handleDirectImageGeneration(
            commandResult.content,
            session,
            activeProvider,
            controller.signal
          )
        } finally {
          if (runtime.directGenerationController === controller) {
            runtime.directGenerationController = undefined
          }
        }
        requestContext.status = 'completed'
        requestContext.updatedAt = new Date().toISOString()
        if (session.activeRun?.id === `run-${sourceMessageId}`) {
          session.activeRun.status = 'completed'
          session.activeRun.updatedAt = Date.now()
        }
        runtime.isStreaming = false
        return
      }

      // 4. 调用 QueryEngine 发送消息
      const engine = runtime.engine!
      const cancelEngine = () => engine.cancel('用户停止生成')
      if (requestSignal?.aborted) {
        throw new QueryCancelledError('用户停止生成')
      }
      requestSignal?.addEventListener('abort', cancelEngine, { once: true })
      try {
        await engine.query(messageContent, userContentBlocks, sourceMessageId)
      } finally {
        requestSignal?.removeEventListener('abort', cancelEngine)
      }
      const terminationReason = engine.getLastTerminationReason()

      // 5. 用 QueryEngine 的完整消息历史同步会话，保留 toolCalls/tool results
      session.messages = engine.getMessages()
      this.restoreDisplayedCommand(
        session.messages,
        commandResult.content,
        displayContent,
        sourceMessageId
      )
      const persistedUser = session.messages.find(message => message.id === sourceMessageId)
      if (persistedUser) {
        persistedUser.attachments = attachmentContexts
        persistedUser.inlineSegments = inlineSegments
      }
      session.updatedAt = Date.now()
      session.messageCount = session.messages.length
      const unfinishedTasks = this.taskManager
        .listTasks()
        .filter(
          task =>
            task.requestId === requestContext.id &&
            (task.status === 'pending' ||
              task.status === 'in_progress' ||
              task.completion?.state === 'reviewing')
        )
      const completed = unfinishedTasks.length === 0 && isSuccessfulTermination(terminationReason)
      requestContext.status = completed ? 'completed' : 'interrupted'
      requestContext.updatedAt = new Date().toISOString()
      if (session.activeRun?.id === `run-${sourceMessageId}`) {
        session.activeRun.status = completed ? 'completed' : 'interrupted'
        session.activeRun.reason = completed
          ? undefined
          : unfinishedTasks.length
            ? `仍有 ${unfinishedTasks.length} 个任务未完成，可继续执行。`
            : `任务因 ${terminationReason} 停止，可继续执行。`
        session.activeRun.retryable = completed ? undefined : true
        session.activeRun.updatedAt = Date.now()
      }

      const lastMessage = session.messages[session.messages.length - 1]
      if (lastMessage && this.messageCallback) {
        this.messageCallback(lastMessage)
      }
      this.saveSessions()
      if (completed) {
        void this.memoryManager
          .archiveScope('task', requestContext.id, session.workDir)
          .catch(error => console.error('Failed to archive task memory:', error))
        if (lastMessage?.role === 'assistant') {
          void this.memoryManager
            .captureAssistantReply(lastMessage.content, session.workDir, lastMessage.id)
            .catch(error =>
              console.warn(
                'Memory extraction failed:',
                error instanceof Error ? error.message : 'unknown'
              )
            )
        }
      }
    } catch (error) {
      // 错误处理
      console.error('Failed to send message:', error)

      // 先补齐 QueryEngine 里未闭合的 tool_use，再把修复后的完整历史同步回会话。
      // 否则两边状态分叉：会话只多了一条错误消息，而 engine 留着孤儿 tool_use，
      // 之后每次「继续」都会被 API 以 400 拒绝，且损坏的历史还会被持久化。
      if (runtime.engine) {
        runtime.engine.closeDanglingToolCalls()
        session.messages = runtime.engine.getMessages()
        this.restoreDisplayedCommand(
          session.messages,
          commandResult.content,
          displayContent,
          sourceMessageId
        )
        const persistedUser = session.messages.find(message => message.id === sourceMessageId)
        if (persistedUser) {
          persistedUser.attachments = attachmentContexts
          persistedUser.inlineSegments = inlineSegments
        }
      }

      if (error instanceof QueryCancelledError) {
        await this.planModeManager.completePlan(session.id)
        requestContext.status = 'cancelled'
        requestContext.updatedAt = new Date().toISOString()
        if (session.activeRun?.id === `run-${sourceMessageId}`) {
          session.activeRun.status = 'cancelled'
          session.activeRun.reason = error.message
          session.activeRun.retryable = false
          session.activeRun.updatedAt = Date.now()
        }
        this.expirePendingTranscript(session)
        session.updatedAt = Date.now()
        session.messageCount = session.messages.length
        this.saveSessions(true)
        return
      }

      // 添加错误消息
      await this.planModeManager.completePlan(session.id)
      requestContext.status = 'interrupted'
      requestContext.updatedAt = new Date().toISOString()
      if (session.activeRun?.id === `run-${sourceMessageId}`) {
        session.activeRun.status = 'interrupted'
        session.activeRun.reason = error instanceof Error ? error.message : '未知错误'
        session.activeRun.retryable = true
        session.activeRun.updatedAt = Date.now()
      }
      const errorMessage: Message = {
        id: this.generateId(),
        role: 'assistant',
        content: `抱歉，发送消息时出错：${error instanceof Error ? error.message : '未知错误'}`,
        timestamp: Date.now(),
      }
      session.messages.push(errorMessage)
      this.appendOrUpdateTranscript(session, {
        id: errorMessage.id,
        type: 'assistant_text',
        content: errorMessage.content,
        timestamp: errorMessage.timestamp,
        model: this.getCurrentModel(),
      })
      session.updatedAt = Date.now()
      session.messageCount = session.messages.length
      this.saveSessions()

      if (this.messageCallback) {
        this.messageCallback(errorMessage)
      }

      // 发送状态更新事件，通知前端错误已发生，状态变为 idle
      if (this.agentEventCallback) {
        this.agentEventCallback(
          {
            type: 'status',
            state: 'idle',
            verb: 'errored',
          },
          session.id
        )
      }
    } finally {
      // 标记为非流式接收
      runtime.isStreaming = false
      this.saveSessions()
    }
  }

  /**
   * openai_image 格式 Provider 的直接生图路径。
   * 用户输入直接作为 prompt 调用 /v1/images/generations，
   * 通过 image_generation 事件驱动前端骨架屏和图片展示。
   */
  private async handleDirectImageGeneration(
    prompt: string,
    session: Session,
    provider: Provider,
    signal: AbortSignal
  ): Promise<void> {
    const imageId = `imggen-direct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const model = provider.models.main || 'gpt-image-2'
    // 1. 发送骨架屏事件
    const startEvent = {
      type: 'image_generation' as const,
      imageId,
      phase: 'start' as const,
      prompt,
    }
    this.recordAgentEvent(session, startEvent)
    this.agentEventCallback?.(startEvent, session.id)

    try {
      if (!provider.baseUrl) {
        throw new Error(`服务商 "${provider.name}" 未配置 Base URL`)
      }
      if (!provider.apiKey) {
        throw new Error(`服务商 "${provider.name}" 未配置 API Key`)
      }

      const url = buildOpenAIImageUrl(provider.baseUrl)
      const body = {
        model,
        prompt: prompt.trim(),
        n: 1,
        size: '1024x1024',
        quality: 'high',
        response_format: 'url',
      }

      console.log('[ChatService] handleDirectImageGeneration request:', url, JSON.stringify(body))

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      })

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        throw new Error(`图像生成接口返回错误 HTTP ${response.status}：${errText.slice(0, 500)}`)
      }

      const data: any = await response.json()
      const items: any[] = Array.isArray(data?.data) ? data.data : []
      console.log('[ChatService] handleDirectImageGeneration response items:', items.length)

      if (items.length === 0) {
        throw new Error(`接口未返回图片数据。原始响应：${JSON.stringify(data).slice(0, 500)}`)
      }

      // 解析图片：优先 url 下载转 base64，其次 b64_json
      let base64: string | undefined
      const mime = 'image/png'
      for (const item of items) {
        const b64 = typeof item?.b64_json === 'string' && item.b64_json ? item.b64_json : undefined
        const remoteUrl = typeof item?.url === 'string' && item.url ? item.url : undefined
        base64 = remoteUrl ? await downloadAsBase64(remoteUrl, signal) : b64
        if (base64) break
      }

      if (signal.aborted) throw new QueryCancelledError('用户停止生成')

      if (!base64) {
        throw new Error('图片下载失败或接口未返回有效图片数据')
      }

      // 保存到磁盘
      const saved = await saveGeneratedImages(
        session.workDir,
        [{ base64, mime }],
        timestampedImagePath(mime)
      )
      const savedPath = saved.length > 0 ? saved[0].path : undefined
      const name = saved.length > 0 ? saved[0].name : undefined
      if (signal.aborted) throw new QueryCancelledError('用户停止生成')

      // 2. 发送完成事件（图片展示）
      const completeEvent = {
        type: 'image_generation' as const,
        imageId,
        phase: 'complete' as const,
        prompt,
        image: { base64, mime, path: savedPath, name },
      }
      this.recordAgentEvent(session, completeEvent)
      this.agentEventCallback?.(completeEvent, session.id)
    } catch (error) {
      if (signal.aborted) {
        throw new QueryCancelledError('用户停止生成')
      }
      console.error('[ChatService] handleDirectImageGeneration error:', error)
      // 生成失败：发送一条 assistant 错误消息
      const errorMessage: Message = {
        id: this.generateId(),
        role: 'assistant',
        content: `图片生成失败：${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      }
      session.messages.push(errorMessage)
      this.appendOrUpdateTranscript(session, {
        id: errorMessage.id,
        type: 'assistant_text',
        content: errorMessage.content,
        timestamp: errorMessage.timestamp,
        model,
      })
      if (this.messageCallback) {
        this.messageCallback(errorMessage)
      }
    } finally {
      // 3. 发送 message_complete 事件
      this.agentEventCallback?.({ type: 'message_complete' }, session.id)
      session.updatedAt = Date.now()
      session.messageCount = session.messages.length
      this.saveSessions()
    }
  }

  private async resolveSlashCommand(
    content: string,
    session: Session,
    messageId?: string
  ): Promise<{ handled: boolean; content: string; displayContent?: string }> {
    if (/^\/(?:memory|remember)(?:\s|$)/.test(content.trim())) {
      const commandMessage: Message = {
        id: messageId || this.generateId(),
        role: 'user',
        content,
        timestamp: Date.now(),
      }
      session.messages.push(commandMessage)
      this.appendOrUpdateTranscript(session, {
        id: commandMessage.id,
        type: 'user_text',
        content,
        timestamp: commandMessage.timestamp,
      })
      let message: string
      try {
        message = await this.handleMemoryCommand(content.trim(), session.workDir)
      } catch (error) {
        message = `记忆操作失败：${error instanceof Error ? error.message : '未知错误'}`
      }
      const response: Message = {
        id: this.generateId(),
        role: 'assistant',
        content: message,
        timestamp: Date.now(),
      }
      session.messages.push(response)
      this.appendOrUpdateTranscript(session, {
        id: response.id,
        type: 'assistant_text',
        content: response.content,
        timestamp: response.timestamp,
        model: this.getCurrentModel(),
      })
      session.updatedAt = Date.now()
      session.messageCount = session.messages.length
      this.messageCallback?.(response)
      return { handled: true, content }
    }
    const parsedCommand = commandManager.parse(content.trim())
    if (!parsedCommand) {
      return { handled: false, content }
    }

    const result = await commandManager.execute(parsedCommand)

    if (result.success && result.metadata?.action === 'init') {
      try {
        const initialized = await this.memoryManager.initializeProjectMemories(session.workDir)
        const created = initialized.created.length
          ? initialized.created.join('、')
          : '无（基础文件已存在）'
        const sources = initialized.sources.length ? initialized.sources.join('、') : '项目目录结构'
        result.message += `\n\n扩展已完成本地基础初始化。新建文件：${created}。基础信息来源：${sources}。请在这些文件上继续补充，不要重新创建 MEMORY.md。`
      } catch (error) {
        result.message += `\n\n本地基础初始化失败：${error instanceof Error ? error.message : '未知错误'}。请继续使用工具完成初始化，并向用户说明失败原因。`
      }
    }

    if (!result.success || result.sendToAI) {
      return {
        handled: false,
        content: result.message,
        ...(result.sendToAI ? { displayContent: content.trim() } : {}),
      }
    }

    if (result.metadata?.action === 'clear') {
      session.messages = []
      session.transcript = []
      session.tokenUsage = undefined
      session.compactSummary = undefined
      this.getSessionRuntime(session.id).engine = undefined
      session.updatedAt = Date.now()
      session.messageCount = 0
    }

    if (result.metadata?.action === 'new') {
      // 当前 /new 命令本身就在 activeRequest 中，不能等待自己结束。
      await this.createNewSessionNow()
    }

    if (result.metadata?.action === 'compact') {
      const provider = this.providerService.getActiveProvider()
      if (!provider) {
        result.message = '压缩失败：未配置可用 Provider'
      } else {
        try {
          this.agentEventCallback?.(
            {
              type: 'system_notification',
              subtype: 'compact_started',
              data: { message: '上下文正在压缩' },
            },
            session.id
          )

          // 从配置中读取保留消息数量
          const config = vscode.workspace.getConfiguration('evancod')
          const keepRecentMessages = Math.max(
            5,
            Math.min(50, config.get<number>('compactKeepRecentMessages') || 10)
          )

          const summaryModel = provider.models.haiku || this.getCurrentModel()
          const apiClient = createApiClient({
            provider,
            model: summaryModel,
            effortLevel: 'low',
          })
          const { summaryMessage } = await compactConversation(
            buildRollingCompactionInput(this.buildRuntimeMessages(session)),
            apiClient,
            summaryModel
          )

          session.compactSummary = summaryMessage.content
          session.messages = replaceWithRollingSummary(
            session.messages,
            summaryMessage,
            keepRecentMessages
          )
          session.updatedAt = Date.now()
          session.messageCount = session.messages.length
          this.getSessionRuntime(session.id).engine = undefined
          result.message = `已使用模型生成会话摘要并压缩上下文（保留最近 ${keepRecentMessages} 条消息）`

          this.agentEventCallback?.(
            {
              type: 'system_notification',
              subtype: 'compact_complete',
              data: { message: '上下文已自动压缩' },
            },
            session.id
          )
        } catch (error) {
          result.message = `压缩失败：${error instanceof Error ? error.message : '未知错误'}`
          // 通知前端复位压缩状态，避免 UI 永久卡在"正在压缩"
          this.agentEventCallback?.(
            {
              type: 'system_notification',
              subtype: 'compact_complete',
              data: { message: result.message, success: false },
            },
            session.id
          )
        }
      }
    }

    const assistantMessage: Message = {
      id: this.generateId(),
      role: 'assistant',
      content: result.message,
      timestamp: Date.now(),
    }
    session.messages.push(assistantMessage)
    if (session) {
      this.appendOrUpdateTranscript(session, {
        id: assistantMessage.id,
        type: 'assistant_text',
        content: assistantMessage.content,
        timestamp: assistantMessage.timestamp,
        model: this.getCurrentModel(),
      })
      session.updatedAt = Date.now()
      session.messageCount = session.messages.length
    }

    if (this.messageCallback) {
      this.messageCallback(assistantMessage)
    }

    return { handled: true, content }
  }

  private async handleMemoryCommand(command: string, workspace: string): Promise<string> {
    if (command.startsWith('/remember ')) {
      const result = await this.memoryManager.remember(`记住${command.slice(10).trim()}`, workspace)
      return {
        saved: '已保存记忆',
        pending: '已创建待确认候选',
        conflict: '发现冲突，请通过 /memory pending 查看',
        ignored: '请输入要记住的内容',
      }[result]
    }
    const [, action = 'list', ...parts] = command.split(/\s+/)
    const id = parts[0]
    if (action === 'list') {
      const items = this.memoryManager.list({ workspace, status: 'active' })
      return items.length
        ? items
            .map(
              item =>
                `${item.id} [${item.scope}/${item.kind}] ${item.description} · 置信度 ${item.confidence} · ${item.updatedAt}`
            )
            .join('\n')
        : '暂无有效记忆'
    }
    if (action === 'pending') {
      const items = this.memoryManager.pending(workspace)
      return items.length
        ? items
            .map(item => `${item.id} [${item.scope}/${item.kind}] ${item.description}`)
            .join('\n')
        : '暂无待确认候选。用户明确要求“记住”的内容会直接保存，请使用 /memory list 查看。'
    }
    if (action === 'show' && id) {
      const item =
        this.memoryManager.list({ workspace }).find(record => record.id === id) ||
        this.memoryManager.pending(workspace).find(record => record.id === id)
      return item ? JSON.stringify(item, null, 2) : '未找到记忆'
    }
    if (action === 'confirm' && id) {
      await this.memoryManager.confirm(id, workspace)
      return '已确认记忆'
    }
    if (action === 'reject' && id) {
      await this.memoryManager.reject(id, workspace)
      return '已拒绝候选'
    }
    if (action === 'forget' && id) {
      await this.memoryManager.forget(id, workspace)
      return '已停用记忆（历史仍保留）'
    }
    if (action === 'restore' && id) {
      await this.memoryManager.restore(id, workspace)
      return '已恢复上一历史版本'
    }
    if (action === 'edit' && id && parts.length > 1) {
      await this.memoryManager.update(id, { content: parts.slice(1).join(' ') }, workspace)
      return '已修改记忆'
    }
    if (action === 'refresh') {
      await this.memoryManager.maintain(workspace)
      return '索引与过期状态已更新'
    }
    return '用法：/memory [list|pending|show <id>|confirm <id>|reject <id>|forget <id>|restore <id>|edit <id> <内容>|refresh] 或 /remember <内容>'
  }

  private restoreDisplayedCommand(
    messages: Message[],
    internalContent: string,
    displayContent: string,
    messageId?: string
  ): void {
    if (internalContent === displayContent) return

    if (messageId) {
      const sourceMessage = messages.find(message => message.id === messageId)
      if (sourceMessage?.role === 'user') {
        sourceMessage.content = displayContent
        return
      }
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message.role === 'user' && message.content === internalContent) {
        message.content = displayContent
        return
      }
    }
  }

  private buildMessageContent(content: string, attachments: AttachmentContext[]): string {
    const parts = [content]

    const textAttachments = attachments.filter(attachment => attachment.kind === 'text')
    if (textAttachments.length) {
      parts.push(
        textAttachments
          .map(attachment => {
            const suffix = attachment.truncated ? '\n[内容已截断]' : ''
            return `<attachment path="${attachment.path}" name="${attachment.name}">\n${attachment.text || ''}${suffix}\n</attachment>`
          })
          .join('\n\n')
      )
    }

    const nonTextAttachments = attachments.filter(attachment => attachment.kind !== 'text')
    if (nonTextAttachments.length) {
      parts.push(
        `已附加非文本上下文：\n${nonTextAttachments.map(file => `- ${file.path} (${file.kind})`).join('\n')}`
      )
    }

    return parts.join('\n\n')
  }

  private findInterruptedRequestContext(session: Session) {
    const requestId = session.activeRun?.status === 'interrupted' ? session.activeRun.requestId : ''
    if (!requestId) return undefined
    return session.requestContexts?.find(context => context.id === requestId)
  }

  private buildUserContentBlocks(
    content: string,
    attachments: AttachmentContext[],
    contentIncludesTextAttachments = false
  ) {
    const blocks: NonNullable<Message['contentBlocks']> = [
      {
        type: 'text',
        text: contentIncludesTextAttachments
          ? content
          : this.buildMessageContent(
              content,
              attachments.filter(attachment => attachment.kind === 'text')
            ),
      },
    ]

    for (const attachment of attachments) {
      if (attachment.kind === 'image' && attachment.base64 && attachment.mime) {
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: attachment.mime,
            data: attachment.base64,
          },
        })
      }
    }

    return blocks
  }

  private async resolveAttachments(
    attachments: (string | AttachmentContext)[]
  ): Promise<AttachmentContext[]> {
    const results: AttachmentContext[] = []

    for (const attachment of attachments) {
      if (typeof attachment !== 'string') {
        results.push(attachment)
        continue
      }

      const filePath = attachment
      try {
        const uri = vscode.Uri.file(filePath)
        const stat = await vscode.workspace.fs.stat(uri)
        if (stat.type === vscode.FileType.Directory) {
          results.push({ path: filePath, name: this.basename(filePath), kind: 'binary', size: 0 })
          continue
        }

        const bytes = await vscode.workspace.fs.readFile(uri)
        const mime = this.inferMime(filePath)
        const name = this.basename(filePath)

        if (mime.startsWith('image/')) {
          results.push({
            path: filePath,
            name,
            mime,
            kind: 'image',
            base64: Buffer.from(bytes).toString('base64'),
            size: bytes.byteLength,
          })
          continue
        }

        if (this.isTextLike(filePath, mime, bytes)) {
          const truncated = bytes.byteLength > TEXT_ATTACHMENT_LIMIT
          const text = Buffer.from(bytes.slice(0, TEXT_ATTACHMENT_LIMIT)).toString('utf-8')
          results.push({
            path: filePath,
            name,
            mime,
            kind: 'text',
            text,
            size: bytes.byteLength,
            truncated,
            tokenEstimate: Math.ceil(text.length / 4),
          })
          continue
        }

        results.push({ path: filePath, name, mime, kind: 'binary', size: bytes.byteLength })
      } catch (error) {
        results.push({
          path: filePath,
          name: this.basename(filePath),
          kind: 'text',
          text: `无法读取附件：${error instanceof Error ? error.message : '未知错误'}`,
          size: 0,
        })
      }
    }

    return results
  }

  private buildMemoryContext(session: Session): string {
    const memoryQuery = this.getSessionRuntime(session.id).memoryQuery
    const mentionedPath = memoryQuery.match(/(?:src|webview|packages)[\\/][\w./\\-]+/)?.[0]
    const modulePath = mentionedPath
      ? path.resolve(session.workDir, mentionedPath)
      : session.workDir
    const memories = this.memoryManager.retrieve({
      query:
        memoryQuery ||
        session.messages.filter(message => message.role === 'user').at(-1)?.content ||
        '',
      workspace: session.workDir,
      modulePath,
      sessionId: session.id,
    })
    if (!memories.length) {
      return ''
    }
    const memoryText = memories
      .map(memory => {
        return `- scope: ${memory.scope}\n  kind: ${memory.kind}\n  subject: ${memory.subject}\n  content: ${memory.content}`
      })
      .join('\n\n')
    return `<memory_context>\n以下是与当前请求相关的持久化记忆，仅供参考；当前用户要求优先。\n\n${memoryText}\n</memory_context>`
  }

  /**
   * 初始化 QueryEngine
   * 创建 QueryEngine 实例并设置回调
   *
   * Phase 2 Week 2: 集成真实 API
   */
  private async initializeQueryEngine(session: Session, runtime: SessionRuntime) {
    // 获取当前 Provider
    const provider = this.providerService.getActiveProvider()
    if (!provider) {
      throw new Error('No active provider configured. Please add a provider first.')
    }

    const toolProfile = this.toolProfileService?.resolve()
    for (const warning of toolProfile?.warnings || []) {
      console.warn(`[ChatService] ${warning}`)
    }

    // 从配置中读取压缩后需要保留的最近消息数量
    const config = vscode.workspace.getConfiguration('evancod')
    const compactKeepRecentMessages = config.get<number>('compactKeepRecentMessages') || 10
    const maxExecutionSegments = Math.max(
      1,
      Math.min(
        50,
        config.get<number>('maxExecutionSegments') || DEFAULT_MAX_EXECUTION_SEGMENTS
      )
    )

    // 创建 QueryEngine
    const engine = new QueryEngine({
      sessionId: session.id,
      cwd: session.workDir,
      provider,
      model: this.getCurrentModel(),
      effortLevel: this.effortLevel,
      messages: this.buildRuntimeMessages(session),
      verbose: false,
      taskManager: this.taskManager, // 传入 TaskManager
      planModeManager: this.planModeManager, // 传入 PlanModeManager
      agentCoordinator: this.agentCoordinator, // 传入 AgentCoordinator
      mcpManager: this.mcpManager,
      skillManager: this.skillManager,
      memoryManager: this.memoryManager,
      onTaskListChange: () => {
        this.syncActiveRunFromTasks(session)
        this.taskManager.notifyTaskList()
      },
      permissionMode: this.permissionMode,
      imageProvider: this.providerService.getImageProvider() || undefined,
      toolSnapshot: toolProfile?.toolSnapshot,
      isDevelopment: this.context.extensionMode === vscode.ExtensionMode.Development,
      compactKeepRecentMessages,
      maxExecutionSegments,
    })
    runtime.engine = engine

    // 设置流式回调
    engine.onMessage((delta, isComplete) => {
      if (runtime.engine !== engine) return
      if (this.streamCallback) {
        this.streamCallback(delta, isComplete, session.id)
      }
    })

    engine.onAgentEvent((event: AgentServerEvent) => {
      if (runtime.engine !== engine) return
      const recordedEvent = this.recordAgentEvent(session, event)
      this.agentEventCallback?.(recordedEvent, session.id)
    })

    // 设置完成回调
    engine.onComplete(_message => {
      if (runtime.engine !== engine) return
      // 可以在这里做一些清理工作
      console.log('Query completed')
    })

    // 设置错误回调
    engine.onError(error => {
      if (runtime.engine !== engine) return
      console.error('QueryEngine error:', error)
    })
  }

  private persistRuntimeConfig(): void {
    const session = this.getCurrentSession()
    if (!session) return

    session.runtimeConfig = {
      model: this.getCurrentModel(),
      effortLevel: this.effortLevel,
      permissionMode: this.permissionMode,
    }
    session.updatedAt = Date.now()
    this.saveSessions()
  }

  private readGlobalEffortLevel(): 'low' | 'medium' | 'high' | 'max' {
    const value = this.context.globalState.get<string>(GLOBAL_EFFORT_LEVEL_KEY)
    return value === 'low' || value === 'medium' || value === 'high' || value === 'max'
      ? value
      : DEFAULT_EFFORT_LEVEL
  }

  private persistGlobalModel(): void {
    if (!this.currentModelId) return
    void this.context.globalState.update(GLOBAL_MODEL_KEY, this.currentModelId)
  }

  private persistGlobalEffortLevel(): void {
    void this.context.globalState.update(GLOBAL_EFFORT_LEVEL_KEY, this.effortLevel)
  }

  private syncActiveRunFromTasks(session: Session): void {
    if (!session.activeRun || session.activeRun.status !== 'running') return
    const activeTask = this.taskManager.listTasks().find(task => task.status === 'in_progress')
    const tasks = this.taskManager.listTasks()
    session.activeRun.activeTaskId = activeTask?.id
    session.activeRun.phase = activeTask
      ? 'implementing'
      : tasks.length > 0 && tasks.every(task => task.status === 'completed')
        ? 'reviewing'
        : 'planning'
    session.activeRun.updatedAt = Date.now()
    session.updatedAt = Date.now()
    // 沿用现有流式脏标记和延迟保存，不增加写盘频率。
    this.saveSessions()
  }

  private recordPermissionResponse(
    sessionId: string,
    response: { requestId: string; approved: boolean }
  ): void {
    const session = this.getSession(sessionId)
    if (!session?.transcript) return

    const block = session.transcript.find(
      (item): item is Extract<AgentTranscriptBlock, { type: 'permission_request' }> =>
        item.type === 'permission_request' && item.requestId === response.requestId
    )
    if (!block) return

    block.responseState = response.approved ? 'approved' : 'denied'
    block.expired = false
    session.updatedAt = Date.now()
    this.saveSessions(true)
  }

  private recordInteractionResponse(
    sessionId: string,
    response: {
      requestId: string
      answered: boolean
      answers?: unknown
    }
  ): void {
    const session = this.getSession(sessionId)
    if (!session?.transcript) return

    const block = session.transcript.find(
      (item): item is Extract<AgentTranscriptBlock, { type: 'interaction_request' }> =>
        item.type === 'interaction_request' && item.requestId === response.requestId
    )
    if (!block) return

    block.responseState = response.answered ? 'answered' : 'cancelled'
    block.responseAnswers = response.answered ? response.answers : undefined
    session.updatedAt = Date.now()
    this.saveSessions(true)
  }

  private recordAgentEvent(session: Session, event: AgentServerEvent): AgentServerEvent {
    let emittedEvent = event

    const now = Date.now()

    switch (event.type) {
      case 'content_delta':
        if (typeof event.text === 'string') {
          // 正文和思考交错时，每次正文开始都结束当前 thinking 段。
          if (this.activeThinkingBlockIds.has(session.id)) {
            this.finalizeCurrentThinkingSegment(session)
          }
          const existing = session.transcript?.find(
            (block): block is Extract<AgentTranscriptBlock, { type: 'assistant_text' }> =>
              block.type === 'assistant_text' && block.id === 'streaming-assistant'
          )
          this.bufferTranscriptDelta(
            session,
            'streaming-assistant',
            event.text,
            now,
            existing,
            'assistant_text'
          )
        }
        break

      case 'content_discard':
        this.transcriptDeltaBuffers.delete(
          this.transcriptBufferKey(session.id, 'streaming-assistant')
        )
        this.transcriptDeltaFlushAt.delete(
          this.transcriptBufferKey(session.id, 'streaming-assistant')
        )
        session.transcript = (session.transcript || []).filter(
          block => block.id !== 'streaming-assistant'
        )
        break

      case 'tool_use_complete':
        // 工具调用完成时，finalize 当前 thinking 段与文字段，
        // 下一段各自开启新块，保持 transcript 中「文字↔工具」的交错顺序
        this.finalizeCurrentThinkingSegment(session)
        this.finalizeCurrentStreamingAssistant(session)
        this.appendOrUpdateTranscript(session, {
          id: event.toolUseId,
          type: 'tool_use',
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          input: event.input,
          timestamp: now,
          isPending: true,
          parentToolUseId: event.parentToolUseId,
        })
        break

      case 'tool_result':
        this.markToolTranscriptComplete(session, event.toolUseId, event.isError)
        this.appendOrUpdateTranscript(session, {
          id: `${event.toolUseId}:result`,
          type: 'tool_result',
          toolUseId: event.toolUseId,
          // Webview 实时消息仍携带完整结果；持久化 transcript 只保留摘要，
          // 避免同一份工具输出同时存在于 runtime messages 和会话展示状态中。
          content: summarizeToolResult(event.content),
          isError: event.isError,
          outcome: event.outcome,
          timestamp: now,
          parentToolUseId: event.parentToolUseId,
        })
        break

      case 'permission_request':
        emittedEvent = {
          ...event,
          deferred: session.id !== this.currentSessionId || undefined,
          requestedAt: now,
        }
        this.appendOrUpdateTranscript(session, {
          id: event.requestId,
          type: 'permission_request',
          requestId: event.requestId,
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          input: event.input,
          description: event.description,
          deferred: session.id !== this.currentSessionId || undefined,
          requestedAt: now,
          timestamp: now,
          responseState: 'pending',
        })
        break

      case 'permission_response': {
        const block = session.transcript?.find(
          (item): item is Extract<AgentTranscriptBlock, { type: 'permission_request' }> =>
            item.type === 'permission_request' && item.requestId === event.requestId
        )
        if (block) {
          block.responseState = event.approved
            ? 'approved'
            : event.reason?.includes('timed out') || event.reason?.includes('超时')
              ? 'expired'
              : event.reason?.includes('停止') || event.reason?.includes('失效')
                ? 'cancelled'
                : 'denied'
          block.expired = block.responseState === 'expired'
          if (
            session.id !== this.currentSessionId &&
            (block.responseState === 'expired' || block.responseState === 'cancelled')
          ) {
            block.deferred = true
          }
        }
        break
      }

      case 'interaction_request':
        emittedEvent = {
          ...event,
          deferred: session.id !== this.currentSessionId || undefined,
          requestedAt: now,
        }
        this.appendOrUpdateTranscript(session, {
          id: event.requestId,
          type: 'interaction_request',
          requestId: event.requestId,
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          input: event.input,
          description: event.description,
          deferred: session.id !== this.currentSessionId || undefined,
          requestedAt: now,
          timestamp: now,
          responseState: 'pending',
        })
        break

      case 'thinking': {
        const blockId = event.blockId || 'streaming-thinking'
        this.activeThinkingBlockIds.set(session.id, blockId)
        const existing = session.transcript?.find(
          (block): block is Extract<AgentTranscriptBlock, { type: 'thinking' }> =>
            block.type === 'thinking' && block.id === blockId
        )
        this.bufferTranscriptDelta(session, blockId, event.text, now, existing, 'thinking')
        break
      }

      case 'image_generation': {
        const blockId = `imggen:${event.imageId}`
        if (event.phase === 'start') {
          this.appendOrUpdateTranscript(session, {
            id: blockId,
            type: 'image_generation',
            imageId: event.imageId,
            timestamp: now,
            isPending: true,
            prompt: event.prompt,
          })
        } else {
          // 持久化只保留 path/mime/name，剔除 base64（体积大，重开时读盘还原）
          const image = event.image
            ? { path: event.image.path, mime: event.image.mime, name: event.image.name }
            : undefined
          this.appendOrUpdateTranscript(session, {
            id: blockId,
            type: 'image_generation',
            imageId: event.imageId,
            timestamp: now,
            isPending: false,
            prompt: event.prompt,
            image,
          })
        }
        break
      }

      case 'bash_output':
        this.updateBashTranscript(session, event.toolUseId, bash => ({
          ...bash,
          taskId: event.taskId || bash.taskId,
          status: bash.status || 'running',
          stdout: event.stream === 'stdout' ? `${bash.stdout}${event.text}` : bash.stdout,
          stderr: event.stream === 'stderr' ? `${bash.stderr}${event.text}` : bash.stderr,
        }))
        break

      case 'bash_status':
        this.updateBashTranscript(session, event.toolUseId, bash => ({
          ...bash,
          taskId: event.taskId || bash.taskId,
          status: event.status,
          exitCode: event.exitCode,
        }))
        break

      case 'system_notification':
        if (event.subtype === 'task_notification') {
          this.taskNotificationQueue.enqueue(session, event.data, () => this.generateId())
        }
        break

      case 'message_complete': {
        const usage = this.normalizeUsage(event.usage)
        if (usage) {
          session.tokenUsage = this.mergeSessionUsage(session.tokenUsage, usage)
          emittedEvent = { ...event, usage: session.tokenUsage }
        }
        this.finalizeStreamingTranscript(session)
        break
      }

      case 'context_usage': {
        // 这是当前运行的快照，不写入累计消耗；最终 message_complete
        // 仍由 mergeSessionUsage 统一合并，避免每轮快照被重复累加。
        emittedEvent = {
          ...event,
          usage: { ...(session.tokenUsage || {}), ...event.usage },
        }
        break
      }
    }

    session.updatedAt = Date.now()
    // 性能优化：高频事件（content_delta / thinking / bash_output）不再每次都 saveSessions，
    // 避免每个 token 都触发 persistence.scheduleSave 的 clearTimeout + setTimeout。
    // 只在关键节点（tool_use_complete / tool_result / message_complete / permission_request 等）保存。
    // content_delta 和 thinking 的 transcript 更新已在上面写入内存，延迟保存不影响数据正确性
    // （SessionPersistenceService 的延迟保存会在 1s 后统一写盘）。
    if (
      event.type !== 'content_delta' &&
      event.type !== 'thinking' &&
      event.type !== 'bash_output'
    ) {
      this.saveSessions()
    }

    return emittedEvent
  }

  private appendOrUpdateTranscript(session: Session, block: AgentTranscriptBlock): void {
    session.transcript ||= []
    const index = session.transcript.findIndex(item => item.id === block.id)
    if (index === -1) {
      session.transcript.push(block)
      return
    }

    session.transcript.splice(index, 1, block)
  }

  /**
   * 为流式缓冲生成会话级键，避免并行会话共用固定 block ID 时串写。
   *
   * @param sessionId - 会话 ID
   * @param blockId - transcript 块 ID
   * @returns 会话隔离的缓冲键
   */
  private transcriptBufferKey(sessionId: string, blockId: string): string {
    return `${sessionId}:${blockId}`
  }

  private bufferTranscriptDelta(
    session: Session,
    id: string,
    delta: string,
    timestamp: number,
    existing: Extract<AgentTranscriptBlock, { type: 'assistant_text' | 'thinking' }> | undefined,
    blockType: 'assistant_text' | 'thinking'
  ): void {
    const bufferKey = this.transcriptBufferKey(session.id, id)
    const pending = `${this.transcriptDeltaBuffers.get(bufferKey) || ''}${delta}`
    const lastFlush = this.transcriptDeltaFlushAt.get(bufferKey) || 0
    const shouldFlush = !existing || pending.length >= 4096 || timestamp - lastFlush >= 100
    if (!shouldFlush) {
      this.transcriptDeltaBuffers.set(bufferKey, pending)
      return
    }

    this.transcriptDeltaBuffers.delete(bufferKey)
    this.transcriptDeltaFlushAt.set(bufferKey, timestamp)
    this.appendOrUpdateTranscript(session, {
      id,
      type: blockType,
      content: `${existing?.content || ''}${pending}`,
      timestamp: existing?.timestamp || timestamp,
      ...(blockType === 'assistant_text'
        ? { model: session.runtimeConfig?.model || this.getCurrentModel() }
        : {}),
    } as AgentTranscriptBlock)
  }

  private flushTranscriptDelta(session: Session, id: string): void {
    const bufferKey = this.transcriptBufferKey(session.id, id)
    const pending = this.transcriptDeltaBuffers.get(bufferKey)
    if (!pending) return
    const block = session.transcript?.find(
      item => item.id === id && (item.type === 'assistant_text' || item.type === 'thinking')
    ) as Extract<AgentTranscriptBlock, { type: 'assistant_text' | 'thinking' }> | undefined
    if (block) block.content += pending
    this.transcriptDeltaBuffers.delete(bufferKey)
  }

  private markToolTranscriptComplete(session: Session, toolUseId: string, isError: boolean): void {
    const block = session.transcript?.find(
      (item): item is Extract<AgentTranscriptBlock, { type: 'tool_use' }> =>
        item.type === 'tool_use' && item.toolUseId === toolUseId
    )
    if (!block) return
    block.isPending = false
    if (block.toolName === 'bash') {
      block.bash = {
        stdout: block.bash?.stdout || '',
        stderr: block.bash?.stderr || '',
        ...block.bash,
        status: block.bash?.status || (isError ? 'error' : 'completed'),
      }
    }
  }

  private updateBashTranscript(
    session: Session,
    toolUseId: string,
    updater: (
      bash: NonNullable<Extract<AgentTranscriptBlock, { type: 'tool_use' }>['bash']>
    ) => NonNullable<Extract<AgentTranscriptBlock, { type: 'tool_use' }>['bash']>
  ): void {
    const block = session.transcript?.find(
      (item): item is Extract<AgentTranscriptBlock, { type: 'tool_use' }> =>
        item.type === 'tool_use' && item.toolUseId === toolUseId
    )
    if (!block) return
    block.bash = updater(block.bash || { stdout: '', stderr: '' })
    block.isPending = block.bash.status === 'running'
  }

  private finalizeCurrentThinkingSegment(session: Session): void {
    const blockId = this.activeThinkingBlockIds.get(session.id) || 'streaming-thinking'
    this.activeThinkingBlockIds.delete(session.id)
    this.flushTranscriptDelta(session, blockId)
    this.transcriptDeltaFlushAt.delete(this.transcriptBufferKey(session.id, blockId))
    const streamingThinking = session.transcript?.find(
      (block): block is Extract<AgentTranscriptBlock, { type: 'thinking' }> =>
        block.type === 'thinking' && block.id === blockId
    )
    // 旧协议没有 blockId，仍需把固定临时 ID 定型；新协议的 ID 从首个 delta 起就稳定。
    if (blockId === 'streaming-thinking' && streamingThinking && streamingThinking.content.trim()) {
      streamingThinking.id = this.generateId()
    }
  }

  private finalizeCurrentStreamingAssistant(session: Session): void {
    this.flushTranscriptDelta(session, 'streaming-assistant')
    const streaming = session.transcript?.find(
      (block): block is Extract<AgentTranscriptBlock, { type: 'assistant_text' }> =>
        block.type === 'assistant_text' && block.id === 'streaming-assistant'
    )
    // 给当前文字段分配永久 id，下一段文字将开启新块并追加在工具之后，
    // 使后端 transcript 保持「文字↔工具」的原始交错顺序（否则文字会全部
    // 并进最早那个 streaming-assistant 块、重建后跑到所有工具之前）
    if (streaming && streaming.content.trim()) {
      streaming.id = this.generateId()
    }
  }

  private finalizeStreamingTranscript(session: Session): void {
    this.flushTranscriptDelta(session, 'streaming-assistant')
    const streaming = session.transcript?.find(
      (block): block is Extract<AgentTranscriptBlock, { type: 'assistant_text' }> =>
        block.type === 'assistant_text' && block.id === 'streaming-assistant'
    )
    if (streaming) {
      streaming.id = this.generateId()
    }

    // Finalize 最后一段 thinking（如果还在 streaming 状态）
    this.finalizeCurrentThinkingSegment(session)
  }

  private expirePendingTranscript(session: Session): void {
    // 取消/中断时，先把仍处于流式状态的 assistant/thinking 块定型改名。
    // 否则固定 id（streaming-assistant / streaming-thinking）的旧块会残留在
    // transcript 中，下一轮 content_delta 会命中它并把新文字追加到旧位置，
    // 造成回答跑到本轮用户提问之前的顺序错乱。
    this.finalizeStreamingTranscript(session)

    for (const block of session.transcript || []) {
      if (block.type === 'tool_use') {
        block.isPending = false
        if (block.bash?.status === 'running') {
          block.bash.status = 'cancelled'
        }
      }
      if (block.type === 'permission_request' && block.responseState === 'pending') {
        block.expired = true
        block.responseState = 'cancelled'
      }
      if (block.type === 'interaction_request' && block.responseState === 'pending') {
        block.responseState = 'cancelled'
      }
    }
  }

  private normalizeUsage(usage: unknown): TokenUsage | undefined {
    if (!usage || typeof usage !== 'object') return undefined
    return usage as TokenUsage
  }

  private mergeSessionUsage(previous: TokenUsage | undefined, current: TokenUsage): TokenUsage {
    const merged: TokenUsage = { ...current }
    for (const key of [
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
    ] as const) {
      const previousValue = typeof previous?.[key] === 'number' ? (previous[key] as number) : 0
      const currentValue = typeof current[key] === 'number' ? (current[key] as number) : 0
      merged[key] = previousValue + currentValue
    }
    return merged
  }

  private createCompactSummary(session: Session): string {
    const lines = session.messages
      .filter(message => message.role !== 'tool')
      .slice(-30)
      .map(message => `${message.role}: ${message.content.slice(0, 1000)}`)

    return [`会话压缩摘要（${new Date().toISOString()}）`, ...lines].join('\n\n')
  }

  private buildRuntimeMessages(session: Session): Message[] {
    const messages = session.messages.filter(message => message.id !== 'runtime-context')

    // 如果有压缩摘要或记忆，作为 user 消息注入到最前面
    const contextParts: string[] = []

    if (session.compactSummary) {
      const hasSummaryMessage = messages.some(message => message.id.startsWith('compact-boundary-'))
      if (!hasSummaryMessage) {
        contextParts.push(`<compact_summary>\n${session.compactSummary}\n</compact_summary>`)
      }
    }

    const memoryContext = this.buildMemoryContext(session)
    if (memoryContext) {
      contextParts.push(memoryContext)
    }

    if (contextParts.length > 0) {
      messages.unshift({
        id: 'runtime-context',
        role: 'user', // 改为 user，确保不会被 API 客户端过滤
        content: `以下是会话的上下文信息，请参考：\n\n${contextParts.join('\n\n')}`,
        timestamp: Date.now(),
      })
    }

    return messages
  }

  private basename(filePath: string): string {
    return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath
  }

  private inferMime(filePath: string): string {
    const ext = filePath.toLowerCase().split('.').pop() || ''
    const map: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      ts: 'text/typescript',
      tsx: 'text/typescript',
      js: 'text/javascript',
      jsx: 'text/javascript',
      json: 'application/json',
      md: 'text/markdown',
      txt: 'text/plain',
      css: 'text/css',
      html: 'text/html',
      vue: 'text/vue',
      py: 'text/x-python',
      go: 'text/x-go',
      rs: 'text/x-rust',
      java: 'text/x-java-source',
      xml: 'application/xml',
      yaml: 'application/yaml',
      yml: 'application/yaml',
    }
    return map[ext] || 'application/octet-stream'
  }

  private isTextLike(filePath: string, mime: string, bytes: Uint8Array): boolean {
    if (
      mime.startsWith('text/') ||
      ['application/json', 'application/xml', 'application/yaml'].includes(mime)
    ) {
      return true
    }

    const sample = bytes.slice(0, Math.min(bytes.byteLength, 1024))
    return !sample.includes(0)
  }

  /**
   * 生成唯一 ID
   *
   * 格式：时间戳-随机字符串
   * 例如：1703765430123-k2j3h4g5f
   *
   * 优势：
   * - 大概率唯一（时间戳 + 随机数）
   * - 可排序（按时间戳）
   * - 易于调试（可读的时间戳部分）
   *
   * @returns 唯一 ID 字符串
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}

function isContinuationMessage(content: string): boolean {
  return /^(继续|继续执行|继续完成|接着做|接着执行|resume|continue)[。.!！\s]*$/i.test(
    content.trim()
  )
}

const MAX_PERSISTED_TOOL_RESULT_CHARS = 2000

function summarizeToolResult(content: unknown): unknown {
  if (typeof content !== 'string') return content
  const bytes = Buffer.byteLength(content, 'utf8')
  if (content.length <= MAX_PERSISTED_TOOL_RESULT_CHARS) return content

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    parsed = undefined
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>
    const text = typeof record.content === 'string' ? record.content : content
    return {
      success: record.success,
      error: record.error,
      content: `${text.slice(0, MAX_PERSISTED_TOOL_RESULT_CHARS)}\n[工具结果已摘要，原始大小 ${bytes} 字节]`,
      metadata: summarizeMetadata(record.metadata),
    }
  }

  return `${content.slice(0, MAX_PERSISTED_TOOL_RESULT_CHARS)}\n[工具结果已摘要，原始大小 ${bytes} 字节]`
}

function summarizeMetadata(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata
  const record = metadata as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of [
    'path',
    'absolutePath',
    'size',
    'totalBytes',
    'returnedOffset',
    'returnedBytes',
    'truncated',
    'nextRead',
  ]) {
    if (key in record) result[key] = record[key]
  }
  return result
}
