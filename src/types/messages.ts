/**
 * 消息类型定义
 *
 * Extension ↔ Webview 通信协议
 *
 * 设计原则：
 * 1. 类型安全 - 使用 TypeScript 联合类型
 * 2. 明确方向 - 区分 Extension → Webview 和 Webview → Extension
 * 3. 统一格式 - 所有消息都有 type 和 data 字段
 *
 * 消息格式：
 * {
 *   type: 'message.type',  // 消息类型（点分命名空间）
 *   data: { ... }          // 消息数据（可选）
 * }
 */

import type { Session, Message, Provider, TaskItem, AgentTaskNotification, GeneratedImageRef } from './index'

export type BashStatus = 'running' | 'completed' | 'error' | 'timeout' | 'cancelled'

export type AgentServerEvent =
  | {
      type: 'content_start'
      blockType: 'text' | 'tool_use'
      toolName?: string
      toolUseId?: string
      parentToolUseId?: string
    }
  | { type: 'content_delta'; text?: string; toolInput?: string }
  | {
      type: 'tool_use_complete'
      toolName: string
      toolUseId: string
      input: unknown
      parentToolUseId?: string
    }
  | {
      type: 'tool_result'
      toolUseId: string
      content: unknown
      isError: boolean
      parentToolUseId?: string
    }
  | {
      type: 'permission_request'
      requestId: string
      toolName: string
      toolUseId?: string
      input: unknown
      description?: string
    }
  | {
      type: 'permission_response'
      requestId: string
      approved: boolean
      reason?: string
      updatedInput?: unknown
      rule?: 'once' | 'always'
    }
  | { type: 'thinking'; text: string }
  | {
      type: 'image_generation'
      /** 用于骨架→成图 upsert 的稳定 ID */
      imageId: string
      /** start：占位骨架；complete：图片就绪 */
      phase: 'start' | 'complete'
      prompt?: string
      image?: GeneratedImageRef
    }
  | { type: 'message_complete'; usage?: unknown }
  | { type: 'status'; state: string; verb?: string }
  | {
      type: 'system_notification'
      subtype: 'task_started' | 'task_progress' | 'task_notification' | 'compact_started' | 'compact_complete'
      message?: string
      data?: AgentTaskNotification | Record<string, unknown>
    }
  | { type: 'bash_output'; toolUseId: string; stream: 'stdout' | 'stderr'; text: string; taskId?: string }
  | { type: 'bash_status'; toolUseId: string; status: BashStatus; exitCode?: number | null; taskId?: string }

/**
 * Extension → Webview 消息类型
 *
 * 这些消息由 Extension 发送，Webview 接收
 */
export type ExtensionToWebviewMessage =
  // === 会话相关 ===
  | {
      type: 'session.restored'
      data: {
        session: Session | null
        sessions: Session[]
      }
    }
  | {
      type: 'session.created'
      data: {
        session: Session
      }
    }
  | {
      type: 'session.updated'
      data: {
        session: Session
      }
    }
  // === 聊天消息相关 ===
  | {
      type: 'chat.messages.update'
      data: {
        messages: Message[]
      }
    }
  | {
      type: 'chat.message.stream'
      data: {
        content: string
        delta: boolean // true: 追加到最后一条消息，false: 新建消息
      }
    }
  | {
      type: 'chat.message.complete'
      data: {
        messageId: string
      }
    }
  | {
      type: 'agent.event'
      data: AgentServerEvent
    }
  // === Provider 相关 ===
  | {
      type: 'provider.list'
      data: {
        providers: Provider[]
        activeId: string | null
      }
    }
  | {
      type: 'provider.created'
      data: {
        provider: Provider
      }
    }
  | {
      type: 'provider.activated'
      data: {
        providerId: string
      }
    }
  // === new-api 同步相关 ===
  | {
      type: 'newapi.sync.preview'
      data: {
        tokens: any[]
        models: string[]
      }
    }
  | {
      type: 'newapi.sync.complete'
      data: {
        count: number
      }
    }
  // === Task 相关 ===
  | {
      type: 'task.created'
      data: {
        task: TaskItem
      }
    }
  | {
      type: 'task.updated'
      data: {
        task: TaskItem
      }
    }
  | {
      type: 'task.list'
      data: {
        tasks: TaskItem[]
      }
    }
  | {
      type: 'task.deleted'
      data: {
        taskId: string
      }
    }
  // === 错误处理 ===
  | {
      type: 'error'
      data: {
        message: string
        code?: string
        context?: any
      }
    }

/**
 * Webview → Extension 消息类型
 *
 * 这些消息由 Webview 发送，Extension 接收
 */
export type WebviewToExtensionMessage =
  // === 初始化 ===
  | {
      type: 'ready'
      data: null
    }
  // === 会话操作 ===
  | {
      type: 'session.new'
      data: null
    }
  | {
      type: 'session.load'
      data: {
        sessionId: string
      }
    }
  | {
      type: 'session.delete'
      data: {
        sessionId: string
      }
    }
  // === 聊天操作 ===
  | {
      type: 'chat.send'
      data: {
        content: string
        images?: string[]
        files?: string[]
      }
    }
  | {
      type: 'chat.stop'
      data: {
        messageId: string
      }
    }
  | {
      type: 'chat.retry'
      data: {
        messageId: string
      }
    }
  | {
      type: 'bash.cancel'
      data: {
        toolUseId: string
        taskId?: string
      }
    }
  // === Provider 操作 ===
  | {
      type: 'provider.list.request'
      data: null
    }
  | {
      type: 'provider.create'
      data: {
        name: string
        type: string
        baseUrl?: string
        apiKey: string
        models: any
      }
    }
  | {
      type: 'provider.update'
      data: {
        id: string
        updates: Partial<Provider>
      }
    }
  | {
      type: 'provider.delete'
      data: {
        id: string
      }
    }
  | {
      type: 'provider.activate'
      data: {
        id: string
      }
    }
  | {
      type: 'provider.test'
      data: {
        id: string
      }
    }
  // === new-api 同步 ===
  | {
      type: 'newapi.sync.start'
      data: {
        siteUrl: string
      }
    }
  | {
      type: 'newapi.sync.import'
      data: {
        tokens: string[]
        mappings: any[]
      }
    }
  // === Task 操作 ===
  | {
      type: 'task.list.request'
      data: null
    }
  | {
      type: 'task.get'
      data: {
        taskId: string
      }
    }

/**
 * 消息桥接器
 *
 * 职责：
 * 1. 类型安全的消息发送和接收
 * 2. 消息路由和处理
 * 3. 错误处理
 *
 * 使用方式：
 * ```typescript
 * // Extension 端
 * const bridge = new MessageBridge(webview)
 * bridge.send({ type: 'session.restored', data: { ... } })
 *
 * // Webview 端
 * const bridge = new MessageBridge(vscode)
 * bridge.send({ type: 'chat.send', data: { content: 'Hello' } })
 * ```
 */

/**
 * 消息处理器类型
 */
export type MessageHandler<T = any> = (message: T) => void | Promise<void>

/**
 * 消息桥接器基类
 */
export abstract class MessageBridge {
  /**
   * 消息处理器映射
   * key: 消息类型
   * value: 处理器函数
   */
  private handlers = new Map<string, MessageHandler[]>()

  /**
   * 发送消息（抽象方法，由子类实现）
   */
  protected abstract doSend(message: any): void

  /**
   * 发送消息
   *
   * @param message - 要发送的消息
   */
  send(message: any): void {
    this.doSend(message)
  }

  /**
   * 注册消息处理器
   *
   * @param type - 消息类型
   * @param handler - 处理器函数
   * @returns 取消注册的函数
   */
  on<T = any>(type: string, handler: MessageHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, [])
    }
    this.handlers.get(type)!.push(handler)

    // 返回取消注册的函数
    return () => {
      const handlers = this.handlers.get(type)
      if (handlers) {
        const index = handlers.indexOf(handler)
        if (index !== -1) {
          handlers.splice(index, 1)
        }
      }
    }
  }

  /**
   * 处理接收到的消息
   *
   * @param message - 接收到的消息
   */
  protected async handleMessage(message: any): Promise<void> {
    const handlers = this.handlers.get(message.type)
    if (handlers) {
      for (const handler of handlers) {
        try {
          await handler(message)
        } catch (error) {
          console.error(`Error handling message ${message.type}:`, error)
        }
      }
    }
  }

  /**
   * 移除指定类型的所有处理器
   *
   * @param type - 消息类型
   */
  off(type: string): void {
    this.handlers.delete(type)
  }

  /**
   * 移除所有处理器
   */
  clear(): void {
    this.handlers.clear()
  }
}
