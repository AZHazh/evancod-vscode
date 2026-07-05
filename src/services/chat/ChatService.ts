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
import type { Session, Message, AttachmentContext, AgentTranscriptBlock, TokenUsage } from '../../types'
import type { AgentServerEvent } from '../../types/messages'
import { ProviderService } from '../provider/ProviderService'
import { TaskManager } from '../task/TaskManager'
import { PlanModeManager } from '../plan/PlanModeManager'
import { AgentCoordinator } from '../agent/AgentCoordinator'
import { MCPConnectionManager } from '../mcp/MCPConnectionManager'
import { SkillManager } from '../skill/SkillManager'
import { MemoryManager } from '../memory/MemoryManager'
import { QueryEngine } from '../../core/engine/QueryEngine'
import { readImageAsBase64 } from '../../core/tools/image/imageStorage'
import { commandManager } from '../command/CommandManager'
import { SessionPersistenceService } from '../persistence/SessionPersistenceService'
import { TaskNotificationQueue } from '../agent/TaskNotificationQueue'

/**
 * 消息回调类型
 * 用于通知 WebviewManager 更新 UI
 */
export type MessageCallback = (message: Message) => void
export type StreamCallback = (delta: string, isComplete: boolean) => void
export type AgentEventCallback = (event: AgentServerEvent) => void

const TEXT_ATTACHMENT_LIMIT = 120_000

export class ChatService {
  /**
   * 会话列表（存储在内存中）
   * 优势：
   * - 读写速度快
   * - 便于实现撤销/重做
   *
   * 劣势：
   * - 插件重启后丢失（需要持久化）
   *
   * TODO Phase 2 Week 3: 实现持久化到 ~/.claude/projects/<workspace>/sessions/
   */
  private sessions: Session[] = []

  /**
   * 当前活动会话 ID
   * null 表示没有活动会话
   */
  private currentSessionId: string | null = null

  /**
   * 是否正在流式接收 AI 响应
   * 用于防止重复发送、显示加载状态等
   */
  private isStreaming = false

  /**
   * QueryEngine 实例
   * 用于与 AI 对话
   */
  private queryEngine?: QueryEngine

  private currentModelId: string | null = null
  private effortLevel: 'low' | 'medium' | 'high' | 'max' = 'medium'
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
    private memoryManager: MemoryManager
  ) {
    this.persistence = new SessionPersistenceService(context)
  }

  async initialize(): Promise<void> {
    const data = await this.persistence.load()
    this.sessions = Object.values(data.sessions).sort((a, b) => b.updatedAt - a.updatedAt)
    this.currentSessionId = data.currentSessionId && data.sessions[data.currentSessionId]
      ? data.currentSessionId
      : this.sessions[0]?.id || null
    this.taskManager.setCurrentSession(this.currentSessionId)

    for (const session of this.sessions) {
      this.expirePendingTranscript(session)
      this.taskNotificationQueue.restore(session)
    }
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
      sessions[session.id] = session
    }

    void this.persistence.save(
      {
        sessions,
        currentSessionId: this.currentSessionId,
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
    // 获取工作目录（用于文件操作的相对路径基准）
    const workDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()

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
    }

    // 添加到会话列表
    this.sessions.push(session)

    // 设置为当前活动会话
    this.currentSessionId = session.id
    this.taskManager.setCurrentSession(session.id)
    await this.taskManager.load()
    this.taskManager.notifyTaskList()
    this.saveSessions()

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
    return this.sessions
  }

  loadSession(sessionId: string): Session | null {
    const session = this.sessions.find(s => s.id === sessionId) || null
    if (!session) return null

    this.currentSessionId = session.id
    this.taskManager.setCurrentSession(session.id)
    this.taskManager.load().catch(err => console.error('Failed to load tasks:', err))
    this.queryEngine = undefined
    this.saveSessions()
    this.taskManager.notifyTaskList()
    return session
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
      if (block.type !== 'image_generation' || !block.image?.path || block.image.base64) return block
      const base64 = base64ByPath.get(block.image.path)
      if (!base64) return block
      return { ...block, image: { ...block.image, base64 } }
    })

    return { ...session, transcript }
  }

  deleteSession(sessionId: string): void {
    this.sessions = this.sessions.filter(session => session.id !== sessionId)
    if (this.currentSessionId === sessionId) {
      this.currentSessionId = this.sessions[0]?.id || null
      this.taskManager.setCurrentSession(this.currentSessionId)
      if (this.currentSessionId) {
        this.taskManager.load().catch(err => console.error('Failed to load tasks:', err))
      }
      this.queryEngine = undefined
      this.taskManager.notifyTaskList()
    }
    this.saveSessions()
  }

  getCurrentModel(): string {
    const provider = this.providerService.getActiveProvider()
    return this.currentModelId || provider?.models.main || 'claude-3-5-sonnet-20241022'
  }

  setCurrentModel(model: string) {
    if (!model.trim()) {
      throw new Error('模型不能为空')
    }

    this.currentModelId = model.trim()
    this.queryEngine = undefined
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
    }

    if (options.effortLevel) {
      this.effortLevel = options.effortLevel
    }

    if (options.permissionMode) {
      this.permissionMode = options.permissionMode
    }

    this.queryEngine = undefined
    this.persistRuntimeConfig()
  }

  resetRuntime() {
    this.currentModelId = null
    this.effortLevel = 'medium'
    this.permissionMode = 'default'
    this.queryEngine = undefined
    this.persistRuntimeConfig()
  }

  getSlashCommands() {
    return commandManager.getAllCommands().map(command => ({
      command: `/${command.name}`,
      desc: command.description,
      usage: command.usage,
    }))
  }

  handlePermissionResponse(response: { requestId: string; approved: boolean; reason?: string; updatedInput?: unknown; rule?: 'once' | 'always' }) {
    this.recordPermissionResponse(response)
    this.queryEngine?.handlePermissionResponse(response)
  }

  cancelBash(toolUseId: string, taskId?: string): boolean {
    return this.queryEngine?.cancelBash(toolUseId, taskId) ?? false
  }

  stopGeneration(): Session | null {
    const session = this.getCurrentSession()
    this.queryEngine?.cancel('用户停止生成')
    this.isStreaming = false

    if (session) {
      this.expirePendingTranscript(session)
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
    this.queryEngine = undefined
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
  async sendMessage(content: string, attachments: (string | AttachmentContext)[] = []): Promise<void> {
    // 1. 验证会话
    const session = this.getCurrentSession()
    if (!session) {
      throw new Error('No active session')
    }

    const commandResult = await this.resolveSlashCommand(content, session)
    if (commandResult.handled) {
      this.saveSessions()
      return
    }

    const attachmentContexts = await this.resolveAttachments(attachments)
    const messageContent = this.buildMessageContent(commandResult.content, attachmentContexts)
    const userContentBlocks = this.buildUserContentBlocks(commandResult.content, attachmentContexts)

    // 3. 初始化 QueryEngine
    if (!this.queryEngine) {
      await this.initializeQueryEngine()
    }

    // 2. 创建用户消息，先更新 UI；最终以 QueryEngine 的完整消息历史为准
    const userMessage: Message = {
      id: this.generateId(),
      role: 'user',
      content: messageContent,
      timestamp: Date.now(),
      contentBlocks: userContentBlocks,
      attachments: attachmentContexts,
    }
    session.messages.push(userMessage)
    session.attachments = attachmentContexts
    this.appendOrUpdateTranscript(session, {
      id: userMessage.id,
      type: 'user_text',
      content: commandResult.content,
      timestamp: userMessage.timestamp,
      attachments: attachmentContexts,
    })
    session.updatedAt = Date.now()

    // 通知外部（用于更新 UI）
    if (this.messageCallback) {
      this.messageCallback(userMessage)
    }

    // 标记为流式接收中
    this.isStreaming = true

    try {
      // 4. 调用 QueryEngine 发送消息
      await this.queryEngine!.query(messageContent, userContentBlocks)

      // 5. 用 QueryEngine 的完整消息历史同步会话，保留 toolCalls/tool results
      session.messages = this.queryEngine!.getMessages()
      session.updatedAt = Date.now()

      const lastMessage = session.messages[session.messages.length - 1]
      if (lastMessage && this.messageCallback) {
        this.messageCallback(lastMessage)
      }
      this.saveSessions()
    } catch (error) {
      // 错误处理
      console.error('Failed to send message:', error)

      // 添加错误消息
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
      this.saveSessions()

      if (this.messageCallback) {
        this.messageCallback(errorMessage)
      }

      // 发送状态更新事件，通知前端错误已发生，状态变为 idle
      if (this.agentEventCallback) {
        this.agentEventCallback({
          type: 'status',
          state: 'idle',
          verb: 'errored',
        })
      }
    } finally {
      // 标记为非流式接收
      this.isStreaming = false
    }
  }

  private async resolveSlashCommand(content: string, session: Session): Promise<{ handled: boolean; content: string }> {
    const parsedCommand = commandManager.parse(content.trim())
    if (!parsedCommand) {
      return { handled: false, content }
    }

    const result = await commandManager.execute(parsedCommand)
    if (!result.success || result.sendToAI) {
      return { handled: false, content: result.message }
    }

    if (result.metadata?.action === 'clear') {
      session.messages = []
      session.transcript = []
      session.tokenUsage = undefined
      session.compactSummary = undefined
      this.queryEngine = undefined
      session.updatedAt = Date.now()
    }

    if (result.metadata?.action === 'new') {
      await this.createNewSession()
    }

    if (result.metadata?.action === 'compact') {
      session.compactSummary = this.createCompactSummary(session)
      session.updatedAt = Date.now()
      result.message = '已压缩当前会话上下文（确定性摘要，未调用模型）'
    }

    const assistantMessage: Message = {
      id: this.generateId(),
      role: 'assistant',
      content: result.message,
      timestamp: Date.now(),
    }
    const activeSession = this.getCurrentSession()
    activeSession?.messages.push(assistantMessage)
    if (activeSession) {
      this.appendOrUpdateTranscript(activeSession, {
        id: assistantMessage.id,
        type: 'assistant_text',
        content: assistantMessage.content,
        timestamp: assistantMessage.timestamp,
        model: this.getCurrentModel(),
      })
      activeSession.updatedAt = Date.now()
    }

    if (this.messageCallback) {
      this.messageCallback(assistantMessage)
    }

    return { handled: true, content }
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
      parts.push(`已附加非文本上下文：\n${nonTextAttachments.map(file => `- ${file.path} (${file.kind})`).join('\n')}`)
    }

    return parts.join('\n\n')
  }

  private buildUserContentBlocks(content: string, attachments: AttachmentContext[]) {
    const blocks: NonNullable<Message['contentBlocks']> = [{ type: 'text', text: this.buildMessageContent(content, attachments.filter(attachment => attachment.kind === 'text')) }]

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

  private async resolveAttachments(attachments: (string | AttachmentContext)[]): Promise<AttachmentContext[]> {
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

  private withMemoryContext(content: string): string {
    const memoryContext = this.buildMemoryContext()
    if (!memoryContext) {
      return content
    }

    return `${content}\n\n${memoryContext}`
  }

  private buildMemoryContext(): string {
    const memories = this.memoryManager.listMemories()
    if (!memories.length) {
      return ''
    }

    const maxLength = 12000
    const memoryText = memories
      .map(memory => {
        const { type, name, description } = memory.metadata
        return `- type: ${type}\n  name: ${name}\n  description: ${description}\n  content:\n${memory.content}`
      })
      .join('\n\n')

    const clippedMemoryText =
      memoryText.length > maxLength
        ? `${memoryText.slice(0, maxLength)}\n\n[Memory context truncated]`
        : memoryText

    return `<memory_context>\n以下是当前项目的持久化记忆，供回答时参考。\n\n${clippedMemoryText}\n</memory_context>`
  }

  /**
   * 初始化 QueryEngine
   * 创建 QueryEngine 实例并设置回调
   *
   * Phase 2 Week 2: 集成真实 API
   */
  private async initializeQueryEngine() {
    // 获取当前 Provider
    const provider = this.providerService.getActiveProvider()
    if (!provider) {
      throw new Error('No active provider configured. Please add a provider first.')
    }

    // 获取当前会话
    const session = this.getCurrentSession()
    if (!session) {
      throw new Error('No active session')
    }

    // 创建 QueryEngine
    this.queryEngine = new QueryEngine({
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
      onTaskListChange: () => this.taskManager.notifyTaskList(),
      permissionMode: this.permissionMode,
    })

    // 设置流式回调
    this.queryEngine.onMessage((delta, isComplete) => {
      if (this.streamCallback) {
        this.streamCallback(delta, isComplete)
      }
    })

    this.queryEngine.onAgentEvent((event: AgentServerEvent) => {
      this.recordAgentEvent(event)
      this.agentEventCallback?.(event)
    })

    // 设置完成回调
    this.queryEngine.onComplete(message => {
      // 可以在这里做一些清理工作
      console.log('Query completed')
    })

    // 设置错误回调
    this.queryEngine.onError(error => {
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

  private recordPermissionResponse(response: { requestId: string; approved: boolean }): void {
    const session = this.getCurrentSession()
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

  private recordAgentEvent(event: AgentServerEvent): void {
    const session = this.getCurrentSession()
    if (!session) return

    const now = Date.now()

    switch (event.type) {
      case 'content_delta':
        if (typeof event.text === 'string') {
          const existing = session.transcript?.find(
            (block): block is Extract<AgentTranscriptBlock, { type: 'assistant_text' }> => block.type === 'assistant_text' && block.id === 'streaming-assistant'
          )
          this.appendOrUpdateTranscript(session, {
            id: 'streaming-assistant',
            type: 'assistant_text',
            content: `${existing?.content || ''}${event.text}`,
            timestamp: existing?.timestamp || now,
            model: this.getCurrentModel(),
          })
        }
        break

      case 'tool_use_complete':
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
          content: event.content,
          isError: event.isError,
          timestamp: now,
          parentToolUseId: event.parentToolUseId,
        })
        break

      case 'permission_request':
        this.appendOrUpdateTranscript(session, {
          id: event.requestId,
          type: 'permission_request',
          requestId: event.requestId,
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          input: event.input,
          description: event.description,
          timestamp: now,
          responseState: 'pending',
        })
        break

      case 'thinking': {
        const existing = session.transcript?.find(
          (block): block is Extract<AgentTranscriptBlock, { type: 'thinking' }> =>
            block.type === 'thinking' && block.id === 'streaming-thinking'
        )
        this.appendOrUpdateTranscript(session, {
          id: 'streaming-thinking',
          type: 'thinking',
          content: `${existing?.content || ''}${event.text}`,
          timestamp: existing?.timestamp || now,
        })
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
          session.tokenUsage = usage
        }
        this.finalizeStreamingTranscript(session)
        break
      }
    }

    session.updatedAt = Date.now()
    this.saveSessions()
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

  private markToolTranscriptComplete(session: Session, toolUseId: string, isError: boolean): void {
    const block = session.transcript?.find(
      (item): item is Extract<AgentTranscriptBlock, { type: 'tool_use' }> => item.type === 'tool_use' && item.toolUseId === toolUseId
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
    updater: (bash: NonNullable<Extract<AgentTranscriptBlock, { type: 'tool_use' }>['bash']>) => NonNullable<Extract<AgentTranscriptBlock, { type: 'tool_use' }>['bash']>
  ): void {
    const block = session.transcript?.find(
      (item): item is Extract<AgentTranscriptBlock, { type: 'tool_use' }> => item.type === 'tool_use' && item.toolUseId === toolUseId
    )
    if (!block) return
    block.bash = updater(block.bash || { stdout: '', stderr: '' })
    block.isPending = block.bash.status === 'running'
  }

  private finalizeStreamingTranscript(session: Session): void {
    const streaming = session.transcript?.find(
      (block): block is Extract<AgentTranscriptBlock, { type: 'assistant_text' }> => block.type === 'assistant_text' && block.id === 'streaming-assistant'
    )
    if (streaming) {
      streaming.id = this.generateId()
    }

    const streamingThinking = session.transcript?.find(
      (block): block is Extract<AgentTranscriptBlock, { type: 'thinking' }> => block.type === 'thinking' && block.id === 'streaming-thinking'
    )
    if (streamingThinking) {
      streamingThinking.id = this.generateId()
    }
  }

  private expirePendingTranscript(session: Session): void {
    for (const block of session.transcript || []) {
      if (block.type === 'tool_use') {
        block.isPending = false
        if (block.bash?.status === 'running') {
          block.bash.status = 'cancelled'
        }
      }
      if (block.type === 'permission_request' && !block.responseState) {
        block.expired = true
      }
    }
  }

  private normalizeUsage(usage: unknown): TokenUsage | undefined {
    if (!usage || typeof usage !== 'object') return undefined
    return usage as TokenUsage
  }

  private createCompactSummary(session: Session): string {
    const lines = session.messages
      .filter(message => message.role !== 'tool')
      .slice(-30)
      .map(message => `${message.role}: ${message.content.slice(0, 1000)}`)

    return [`会话压缩摘要（${new Date().toISOString()}）`, ...lines].join('\n\n')
  }

  private buildRuntimeMessages(session: Session): Message[] {
    const messages = [...session.messages]
    const contextParts = [session.compactSummary ? `<compact_summary>\n${session.compactSummary}\n</compact_summary>` : '', this.buildMemoryContext()]
      .filter(Boolean)
      .join('\n\n')

    if (contextParts) {
      messages.unshift({
        id: 'runtime-context',
        role: 'system',
        content: contextParts,
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
    if (mime.startsWith('text/') || ['application/json', 'application/xml', 'application/yaml'].includes(mime)) {
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
