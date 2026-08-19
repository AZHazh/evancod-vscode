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
 * - 增量持久化（只保存变更会话）
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
import * as fs from 'fs/promises'
import * as path from 'path'
import type { Session, Message } from '../../types'
import { performanceLog, performanceSnapshot } from '../../utils/performanceLogger'

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

interface SessionIndex {
  version: 2
  currentSessionId: string | null
  sessionIds: string[]
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
   * 性能优化：缓存上次保存的会话数据快照，用于增量比对
   */
  private lastSavedSnapshot?: Map<string, string>
  private lastSavedCurrentSessionId?: string | null
  private saveInFlight?: Promise<void>
  private queuedSaveData?: SessionData
  private readonly fileStorageDir?: string

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
    this.fileStorageDir = context.globalStorageUri?.fsPath
      ? path.join(context.globalStorageUri.fsPath, 'sessions')
      : undefined
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
      if (this.fileStorageDir) {
        const fileData = await this.loadFromFiles()
        if (fileData) return fileData
      }

      // 从 globalState 读取
      const stored = this.context.globalState.get<SessionData | SessionIndex>(this.STORAGE_KEY)

      if (isSessionIndex(stored)) {
        const entries = await Promise.all(
          stored.sessionIds.map(async id => [id, this.context.globalState.get<Session>(this.sessionStorageKey(id))] as const)
        )
        const sessions: Record<string, Session> = {}
        for (const [id, session] of entries) {
          if (session) sessions[id] = session
        }
        const cleaned = this.cleanExpiredSessions({ sessions, currentSessionId: stored.currentSessionId })
        this.lastSavedSnapshot = new Map(Object.entries(cleaned.sessions).map(([id, session]) => [id, this.createSessionSnapshot(session)]))
        this.lastSavedCurrentSessionId = cleaned.currentSessionId
        return cleaned
      }

      const data = stored as SessionData | undefined

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
   * 立即保存（增量优化版本）
   */
  private async saveImmediate(data: SessionData): Promise<void> {
    this.queuedSaveData = data
    if (this.saveInFlight) return this.saveInFlight

    this.saveInFlight = (async () => {
      while (this.queuedSaveData) {
        const next = this.queuedSaveData
        this.queuedSaveData = undefined
        await this.writeSnapshot(next)
      }
    })().finally(() => {
      this.saveInFlight = undefined
    })
    return this.saveInFlight
  }

  private async writeSnapshot(data: SessionData): Promise<void> {
    const startedAt = performance.now()
    try {
      // 限制会话数量
      const limited = this.limitSessions(data)

      // 性能优化：增量持久化 - 只序列化变更的会话
      const currentSnapshot = new Map<string, string>()
      const changedSessions: Record<string, Session> = {}
      let hasChanges = false

      for (const [id, session] of Object.entries(limited.sessions)) {
        // 创建会话的轻量级快照（仅包含关键变更字段）
        const snapshot = this.createSessionSnapshot(session)
        currentSnapshot.set(id, snapshot)

        // 比对快照，只保存变更的会话
        if (!this.lastSavedSnapshot || this.lastSavedSnapshot.get(id) !== snapshot) {
          changedSessions[id] = session
          hasChanges = true
        }
      }

      // 检测删除的会话
      if (this.lastSavedSnapshot) {
        for (const oldId of this.lastSavedSnapshot.keys()) {
          if (!currentSnapshot.has(oldId)) {
            hasChanges = true
            break
          }
        }
      }

      // 如果没有变更且 currentSessionId 也没变，跳过保存
      if (!hasChanges && this.lastSavedSnapshot &&
          limited.currentSessionId === this.lastSavedCurrentSessionId) {
      performanceLog('persistence.skip', {
          backend: this.fileStorageDir ? 'filesystem' : 'globalState',
          sessionCount: Object.keys(limited.sessions).length,
          durationMs: Math.round(performance.now() - startedAt),
          ...performanceSnapshot(),
        })
        return
      }

      const previousIds = this.lastSavedSnapshot ? Array.from(this.lastSavedSnapshot.keys()) : []
      const removedIds = previousIds.filter(id => !currentSnapshot.has(id))
      const index: SessionIndex = {
        version: 2,
        currentSessionId: limited.currentSessionId,
        sessionIds: Object.keys(limited.sessions),
      }
      if (this.fileStorageDir) {
        await this.writeFileSnapshot(changedSessions, removedIds, index)
      } else {
        // 兼容没有 globalStorageUri 的测试宿主和旧环境。
        await Promise.all([
          ...Object.entries(changedSessions).map(([id, session]) =>
            this.context.globalState.update(this.sessionStorageKey(id), session)
          ),
          ...removedIds.map(id => this.context.globalState.update(this.sessionStorageKey(id), undefined)),
        ])
        await this.context.globalState.update(this.STORAGE_KEY, index)
      }

      // 更新快照
      this.lastSavedSnapshot = currentSnapshot
      this.lastSavedCurrentSessionId = limited.currentSessionId
      performanceLog('persistence.save', {
        backend: this.fileStorageDir ? 'filesystem' : 'globalState',
        sessionCount: Object.keys(limited.sessions).length,
        changedSessionCount: Object.keys(changedSessions).length,
        durationMs: Math.round(performance.now() - startedAt),
        ...performanceSnapshot(),
      })
    } catch (error) {
      performanceLog('persistence.error', {
        backend: this.fileStorageDir ? 'filesystem' : 'globalState',
        durationMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.message : String(error),
        ...performanceSnapshot(),
      })
      console.error('保存会话失败:', error)
    }
  }

  private sessionStorageKey(id: string): string {
    return `${this.STORAGE_KEY}.${id}`
  }

  private sessionFilePath(id: string): string {
    return path.join(this.fileStorageDir!, `session-${encodeURIComponent(id)}.json`)
  }

  private indexFilePath(): string {
    return path.join(this.fileStorageDir!, 'index.json')
  }

  private async loadFromFiles(): Promise<SessionData | undefined> {
    try {
      const index = JSON.parse(await fs.readFile(this.indexFilePath(), 'utf8')) as SessionIndex
      if (!isSessionIndex(index)) return undefined
      const entries = await Promise.all(
        index.sessionIds.map(async id => {
          try {
            return [id, JSON.parse(await fs.readFile(this.sessionFilePath(id), 'utf8')) as Session] as const
          } catch {
            return [id, undefined] as const
          }
        })
      )
      const sessions: Record<string, Session> = {}
      for (const [id, session] of entries) {
        if (session) sessions[id] = session
      }
      const cleaned = this.cleanExpiredSessions({ sessions, currentSessionId: index.currentSessionId })
      this.lastSavedSnapshot = new Map(Object.entries(cleaned.sessions).map(([id, session]) => [id, this.createSessionSnapshot(session)]))
      this.lastSavedCurrentSessionId = cleaned.currentSessionId
      return cleaned
    } catch {
      return undefined
    }
  }

  private async writeFileSnapshot(
    changedSessions: Record<string, Session>,
    removedIds: string[],
    index: SessionIndex
  ): Promise<void> {
    await fs.mkdir(this.fileStorageDir!, { recursive: true })
    await Promise.all(
      Object.entries(changedSessions).map(async ([id, session]) => {
        const target = this.sessionFilePath(id)
        const temporary = `${target}.${process.pid}.tmp`
        await fs.writeFile(temporary, JSON.stringify(session), 'utf8')
        await fs.rename(temporary, target)
      })
    )
    await Promise.all(removedIds.map(async id => {
      try {
        await fs.unlink(this.sessionFilePath(id))
      } catch {
        // 文件已不存在时视为删除完成。
      }
    }))
    const indexPath = this.indexFilePath()
    const temporaryIndex = `${indexPath}.${process.pid}.tmp`
    await fs.writeFile(temporaryIndex, JSON.stringify(index), 'utf8')
    await fs.rename(temporaryIndex, indexPath)
  }

  /**
   * 创建会话快照（用于增量比对）
   *
   * 性能优化修复：原快照只含 updatedAt / messageCount / transcriptLength / name，
   * 但流式过程中 transcript 的 length 不变（同一个 streaming-assistant block 被 splice 替换），
   * 只有 content 变了，导致快照不变 → 增量比对认为「没变化」→ 跳过保存（数据丢失 bug）。
   * 现在加入 transcript 最后一个 block 的 content 长度和 id，确保流式更新能被检测到。
   */
  private createSessionSnapshot(session: Session): string {
    // 轻量指纹：取 transcript 末尾 block 的 id + content 长度，足以检测流式追加
    const transcript = session.transcript
    const lastBlock = transcript && transcript.length > 0 ? transcript[transcript.length - 1] : undefined
    const lastBlockId = lastBlock?.id ?? ''
    // 用 content 长度而非完整 content，避免大字符串序列化开销
    const lastBlockContentLen = lastBlock && 'content' in lastBlock && typeof lastBlock.content === 'string'
      ? lastBlock.content.length
      : 0

    return JSON.stringify({
      updatedAt: session.updatedAt,
      messageCount: session.messageCount ?? session.messages.length,
      transcriptLength: session.transcript?.length ?? 0,
      lastBlockId,
      lastBlockContentLen,
      name: session.name,
    })
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
    if (this.fileStorageDir) {
      try {
        const index = JSON.parse(await fs.readFile(this.indexFilePath(), 'utf8')) as SessionIndex
        if (isSessionIndex(index)) {
          await Promise.all(index.sessionIds.map(id => fs.unlink(this.sessionFilePath(id)).catch(() => undefined)))
        }
        await fs.unlink(this.indexFilePath()).catch(() => undefined)
      } catch {
        // 存储目录尚未创建时无需清理。
      }
    }
    const stored = this.context.globalState.get<SessionIndex>(this.STORAGE_KEY)
    if (isSessionIndex(stored)) {
      await Promise.all(stored.sessionIds.map(id => this.context.globalState.update(this.sessionStorageKey(id), undefined)))
    }
    await this.context.globalState.update(this.STORAGE_KEY, undefined)
    this.lastSavedSnapshot = undefined
    this.lastSavedCurrentSessionId = undefined
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

function isSessionIndex(value: unknown): value is SessionIndex {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<SessionIndex>
  return record.version === 2 && Array.isArray(record.sessionIds)
}
