/**
 * 会话持久化服务
 *
 * 职责：
 * 1. 保存会话到本地存储
 * 2. 从本地存储恢复会话
 * 3. 管理会话历史
 * 4. 清理过期会话
 *
 * 存储策略：
 * - 使用 VSCode 的 ExtensionContext.globalState
 * - 自动保存（每次消息后）
 * - 延迟写入（防止频繁 I/O）
 *
 * 数据结构：
 * {
 *   sessions: {
 *     [id]: Session
 *   },
 *   currentSessionId: string
 * }
 */

import * as vscode from 'vscode'
import type { Session, Message } from '../../types'

/**
 * 持久化配置
 */
interface PersistenceConfig {
  /**
   * 自动保存延迟（毫秒）
   * 默认：1000ms
   */
  autoSaveDelay?: number

  /**
   * 最大会话数量
   * 默认：50
   */
  maxSessions?: number

  /**
   * 会话过期时间（天）
   * 默认：30 天
   */
  sessionExpireDays?: number
}

/**
 * 会话数据
 */
export interface SessionData {
  /**
   * 所有会话
   */
  sessions: Record<string, Session>

  /**
   * 当前会话 ID
   */
  currentSessionId: string | null
}

/**
 * 会话持久化服务
 */
export class SessionPersistenceService {
  /**
   * 存储键名
   */
  private readonly STORAGE_KEY = 'evancod.sessions'

  /**
   * 自动保存定时器
   */
  private autoSaveTimer?: NodeJS.Timeout

  /**
   * 待保存的数据
   */
  private pendingData?: SessionData

  /**
   * 配置
   */
  private config: Required<PersistenceConfig>

  /**
   * 构造函数
   *
   * @param context - VSCode 扩展上下文
   * @param config - 持久化配置
   */
  constructor(
    private context: vscode.ExtensionContext,
    config?: PersistenceConfig
  ) {
    this.config = {
      autoSaveDelay: config?.autoSaveDelay || 1000,
      maxSessions: config?.maxSessions || 50,
      sessionExpireDays: config?.sessionExpireDays || 30,
    }
  }

  /**
   * 加载所有会话
   *
   * @returns Promise<SessionData> 会话数据
   */
  async load(): Promise<SessionData> {
    try {
      // 从 globalState 读取
      const data = this.context.globalState.get<SessionData>(this.STORAGE_KEY)

      if (!data) {
        // 首次使用，返回空数据
        return {
          sessions: {},
          currentSessionId: null,
        }
      }

      // 清理过期会话
      const cleaned = this.cleanExpiredSessions(data)

      return cleaned
    } catch (error) {
      console.error('加载会话失败:', error)
      return {
        sessions: {},
        currentSessionId: null,
      }
    }
  }

  /**
   * 保存会话数据
   *
   * @param data - 会话数据
   * @param immediate - 是否立即保存（可选，默认 false）
   */
  async save(data: SessionData, immediate: boolean = false): Promise<void> {
    if (immediate) {
      // 立即保存
      await this.saveImmediate(data)
    } else {
      // 延迟保存
      this.scheduleSave(data)
    }
  }

  /**
   * 立即保存
   */
  private async saveImmediate(data: SessionData): Promise<void> {
    try {
      // 限制会话数量
      const limited = this.limitSessions(data)

      // 保存到 globalState
      await this.context.globalState.update(this.STORAGE_KEY, limited)
    } catch (error) {
      console.error('保存会话失败:', error)
    }
  }

  /**
   * 调度延迟保存
   */
  private scheduleSave(data: SessionData): void {
    // 保存待保存数据
    this.pendingData = data

    // 清除旧的定时器
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer)
    }

    // 创建新的定时器
    this.autoSaveTimer = setTimeout(async () => {
      if (this.pendingData) {
        await this.saveImmediate(this.pendingData)
        this.pendingData = undefined
      }
    }, this.config.autoSaveDelay)
  }

  /**
   * 清理过期会话
   *
   * @param data - 会话数据
   * @returns SessionData 清理后的数据
   */
  private cleanExpiredSessions(data: SessionData): SessionData {
    const now = Date.now()
    const expireMs = this.config.sessionExpireDays * 24 * 60 * 60 * 1000
    const sessions: Record<string, Session> = {}

    // 过滤过期会话
    Object.entries(data.sessions).forEach(([id, session]) => {
      const age = now - session.updatedAt
      if (age < expireMs) {
        sessions[id] = session
      }
    })

    return {
      sessions,
      currentSessionId: data.currentSessionId,
    }
  }

  /**
   * 限制会话数量
   *
   * @param data - 会话数据
   * @returns SessionData 限制后的数据
   */
  private limitSessions(data: SessionData): SessionData {
    const sessions = Object.values(data.sessions)

    // 如果未超过限制，直接返回
    if (sessions.length <= this.config.maxSessions) {
      return data
    }

    // 按更新时间排序
    sessions.sort((a, b) => b.updatedAt - a.updatedAt)

    // 保留最新的 N 个
    const kept = sessions.slice(0, this.config.maxSessions)
    const sessionsMap: Record<string, Session> = {}
    kept.forEach(s => {
      sessionsMap[s.id] = s
    })

    return {
      sessions: sessionsMap,
      currentSessionId: data.currentSessionId,
    }
  }

  /**
   * 导出会话（用于备份）
   *
   * @returns Promise<string> JSON 字符串
   */
  async export(): Promise<string> {
    const data = await this.load()
    return JSON.stringify(data, null, 2)
  }

  /**
   * 导入会话（用于恢复）
   *
   * @param json - JSON 字符串
   * @returns Promise<boolean> 是否成功
   */
  async import(json: string): Promise<boolean> {
    try {
      const data = JSON.parse(json) as SessionData

      // 验证数据结构
      if (!data.sessions || typeof data.sessions !== 'object') {
        return false
      }

      // 保存
      await this.saveImmediate(data)
      return true
    } catch (error) {
      console.error('导入会话失败:', error)
      return false
    }
  }

  /**
   * 清空所有会话
   */
  async clear(): Promise<void> {
    await this.context.globalState.update(this.STORAGE_KEY, undefined)
  }

  async flush(): Promise<void> {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer)
      this.autoSaveTimer = undefined
    }

    if (this.pendingData) {
      const data = this.pendingData
      this.pendingData = undefined
      await this.saveImmediate(data)
    }
  }

  /**
   * 销毁服务（清理资源）
   */
  dispose(): void {
    void this.flush()
  }
}
