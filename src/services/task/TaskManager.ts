/**
 * TaskManager - 任务管理服务
 *
 * 职责：
 * 1. 创建、更新、查询、删除任务
 * 2. 管理任务依赖关系（blocks/blockedBy）
 * 3. 任务持久化到工作区 .evancod/tasks.json
 * 4. 任务状态验证和约束检查
 *
 * 使用场景：
 * - AI Agent 拆解复杂任务
 * - 追踪任务执行进度
 * - 展示任务列表和依赖关系
 * - 用户手动查看和管理任务
 *
 * 设计原则：
 * - 任务 ID 全局唯一（UUID）
 * - blockedBy 为空才能开始执行
 * - 删除任务时自动解除依赖关系
 * - 任务持久化延迟写入（debounce）
 */

import * as vscode from 'vscode'
import { TaskStore } from '../../tasks/TaskStore'
import type { TaskItem, TaskStatus, TaskList } from '../../types'

// 前向声明，避免循环依赖
interface IWebviewManager {
  sendTaskCreated(task: TaskItem): void
  sendTaskUpdated(task: TaskItem): void
  sendTaskDeleted(taskId: string): void
  sendTaskList(tasks: TaskItem[]): void
}

export class TaskManager {
  /** 工作区存储适配器 */
  private workspaceState: vscode.Memento

  private readonly taskStore: TaskStore

  /** 内存中的任务列表 */
  private tasks: Map<string, TaskItem> = new Map()

  /** 持久化延迟定时器 */
  private saveTimer?: NodeJS.Timeout

  /** 延迟写入时间（毫秒） */
  private readonly SAVE_DELAY = 1000

  /** Webview 管理器（可选，用于发送消息到 UI） */
  private webviewManager?: IWebviewManager

  /** 当前会话 ID，用于按对话隔离任务 */
  private currentSessionId: string | null = null

  /**
   * 构造函数
   *
   * @param context - VSCode Extension Context
   */
  constructor(private context: vscode.ExtensionContext) {
    this.workspaceState = context.workspaceState
    this.taskStore = new TaskStore(context, this.resolveTaskListId())
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

  setCurrentSession(sessionId: string | null): void {
    this.currentSessionId = sessionId
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId
  }

  private isTaskInCurrentSession(task: TaskItem): boolean {
    return !!this.currentSessionId && task.sessionId === this.currentSessionId
  }

  private listCurrentSessionTasks(includeDeleted = true): TaskItem[] {
    return Array.from(this.tasks.values()).filter((task) =>
      this.isTaskInCurrentSession(task) && (includeDeleted || task.status !== 'deleted')
    )
  }

  private resolveTaskListId(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) return 'default'

    return Buffer.from(workspaceFolder.uri.fsPath).toString('base64url')
  }

  /**
   * 加载任务列表
   *
   * 从持久化存储中恢复任务
   *
   * @returns 任务列表
   */
  async load(): Promise<TaskItem[]> {
    try {
      let tasks = await this.taskStore.load()

      if (!tasks.length) {
        const legacyTaskList = this.workspaceState.get<TaskList>('tasks')
        tasks = legacyTaskList?.tasks || []
        if (tasks.length) {
          await this.taskStore.saveTasks(tasks)
        }
      }

      this.tasks.clear()
      for (const task of tasks) {
        this.tasks.set(task.id, task)
      }

      return tasks
    } catch (error) {
      console.error('Failed to load tasks:', error)
      return []
    }
  }

  /**
   * 创建新任务
   *
   * @param params - 任务参数
   * @returns 创建的任务
   */
  async createTask(params: {
    subject: string
    description: string
    activeForm?: string
    owner?: string
    blockedBy?: string[]
    metadata?: Record<string, any>
  }): Promise<TaskItem> {
    // 生成唯一 ID
    const id = await this.taskStore.nextTaskId()
    const now = new Date().toISOString()

    // 验证 blockedBy 任务是否存在
    if (params.blockedBy && params.blockedBy.length > 0) {
      for (const taskId of params.blockedBy) {
        const blockedByTask = this.tasks.get(taskId)
        if (!blockedByTask || !this.isTaskInCurrentSession(blockedByTask)) {
          throw new Error(`Blocked-by task not found: ${taskId}`)
        }
      }
    }

    // 创建任务
    const task: TaskItem = {
      id,
      sessionId: this.currentSessionId || undefined,
      subject: params.subject,
      description: params.description,
      status: 'pending',
      activeForm: params.activeForm,
      owner: params.owner,
      blocks: [],
      blockedBy: params.blockedBy || [],
      createdAt: now,
      updatedAt: now,
      metadata: params.metadata
    }

    // 保存到内存
    this.tasks.set(id, task)

    // 更新 blockedBy 任务的 blocks 字段
    if (params.blockedBy && params.blockedBy.length > 0) {
      for (const blockedByTaskId of params.blockedBy) {
        const blockedByTask = this.tasks.get(blockedByTaskId)
        if (blockedByTask && this.isTaskInCurrentSession(blockedByTask)) {
          blockedByTask.blocks.push(id)
          blockedByTask.updatedAt = now
        }
      }
    }

    // 延迟持久化
    this.scheduleSave()

    // 发送消息到 Webview
    if (this.webviewManager) {
      this.webviewManager.sendTaskCreated(task)
    }

    return task
  }

  /**
   * 更新任务
   *
   * @param taskId - 任务 ID
   * @param updates - 更新内容
   * @returns 更新后的任务
   */
  async updateTask(
    taskId: string,
    updates: {
      subject?: string
      description?: string
      status?: TaskStatus
      activeForm?: string
      owner?: string
      addBlocks?: string[]
      addBlockedBy?: string[]
      metadata?: Record<string, any>
    }
  ): Promise<TaskItem> {
    const task = this.tasks.get(taskId)
    if (!task || !this.isTaskInCurrentSession(task)) {
      throw new Error(`Task not found: ${taskId}`)
    }

    const now = new Date().toISOString()

    // 更新基本字段
    if (updates.subject !== undefined) {
      task.subject = updates.subject
    }
    if (updates.description !== undefined) {
      task.description = updates.description
    }
    if (updates.status !== undefined) {
      // 状态验证
      this.validateStatusTransition(task.status, updates.status)
      task.status = updates.status
    }
    if (updates.activeForm !== undefined) {
      task.activeForm = updates.activeForm
    }
    if (updates.owner !== undefined) {
      task.owner = updates.owner
    }

    // 添加 blocks 依赖
    if (updates.addBlocks && updates.addBlocks.length > 0) {
      for (const blockTaskId of updates.addBlocks) {
        const blockTask = this.tasks.get(blockTaskId)
        if (!blockTask || !this.isTaskInCurrentSession(blockTask)) {
          throw new Error(`Block task not found: ${blockTaskId}`)
        }
        if (!task.blocks.includes(blockTaskId)) {
          task.blocks.push(blockTaskId)

          // 更新被阻塞任务的 blockedBy 字段
          if (!blockTask.blockedBy.includes(taskId)) {
            blockTask.blockedBy.push(taskId)
            blockTask.updatedAt = now
          }
        }
      }
    }

    // 添加 blockedBy 依赖
    if (updates.addBlockedBy && updates.addBlockedBy.length > 0) {
      for (const blockedByTaskId of updates.addBlockedBy) {
        const blockedByTask = this.tasks.get(blockedByTaskId)
        if (!blockedByTask || !this.isTaskInCurrentSession(blockedByTask)) {
          throw new Error(`Blocked-by task not found: ${blockedByTaskId}`)
        }
        if (!task.blockedBy.includes(blockedByTaskId)) {
          task.blockedBy.push(blockedByTaskId)

          // 更新阻塞任务的 blocks 字段
          if (!blockedByTask.blocks.includes(taskId)) {
            blockedByTask.blocks.push(taskId)
            blockedByTask.updatedAt = now
          }
        }
      }
    }

    // 合并元数据
    if (updates.metadata) {
      task.metadata = { ...task.metadata, ...updates.metadata }
    }

    task.updatedAt = now

    // 延迟持久化
    this.scheduleSave()

    // 发送消息到 Webview
    if (this.webviewManager) {
      this.webviewManager.sendTaskUpdated(task)
    }

    return task
  }

  /**
   * 获取单个任务
   *
   * @param taskId - 任务 ID
   * @returns 任务对象
   */
  getTask(taskId: string): TaskItem | undefined {
    const task = this.tasks.get(taskId)
    return task && this.isTaskInCurrentSession(task) ? task : undefined
  }

  /**
   * 获取所有任务
   *
   * @returns 任务列表
   */
  listTasks(): TaskItem[] {
    return this.listCurrentSessionTasks()
  }

  /**
   * 按状态过滤任务
   *
   * @param status - 任务状态
   * @returns 符合条件的任务列表
   */
  listTasksByStatus(status: TaskStatus): TaskItem[] {
    return this.listCurrentSessionTasks().filter((task) => task.status === status)
  }

  /**
   * 获取可执行的任务（状态为 pending 且没有被阻塞）
   *
   * @returns 可执行的任务列表
   */
  listAvailableTasks(): TaskItem[] {
    return this.listCurrentSessionTasks().filter(
      (task) => task.status === 'pending' && task.blockedBy.length === 0
    )
  }

  notifyTaskList(): void {
    this.webviewManager?.sendTaskList(this.listTasks())
  }

  /**
   * 删除任务
   *
   * 删除任务时会自动解除依赖关系：
   * - 从所有 blockedBy 任务的 blocks 中移除
   * - 从所有 blocks 任务的 blockedBy 中移除
   *
   * @param taskId - 任务 ID
   */
  async deleteTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task || !this.isTaskInCurrentSession(task)) {
      throw new Error(`Task not found: ${taskId}`)
    }

    const now = new Date().toISOString()

    // 解除 blockedBy 依赖
    for (const blockedByTaskId of task.blockedBy) {
      const blockedByTask = this.tasks.get(blockedByTaskId)
      if (blockedByTask) {
        blockedByTask.blocks = blockedByTask.blocks.filter((id) => id !== taskId)
        blockedByTask.updatedAt = now
      }
    }

    // 解除 blocks 依赖
    for (const blockTaskId of task.blocks) {
      const blockTask = this.tasks.get(blockTaskId)
      if (blockTask) {
        blockTask.blockedBy = blockTask.blockedBy.filter((id) => id !== taskId)
        blockTask.updatedAt = now
      }
    }

    // 从内存中删除
    this.tasks.delete(taskId)

    // 延迟持久化
    this.scheduleSave()

    // 发送消息到 Webview
    if (this.webviewManager) {
      this.webviewManager.sendTaskDeleted(taskId)
    }
  }

  /**
   * 清空所有任务
   */
  async clearAllTasks(): Promise<void> {
    this.tasks.clear()
    await this.saveImmediate()
  }

  /**
   * 验证状态转换是否合法
   *
   * 合法的状态转换：
   * - pending -> in_progress
   * - pending -> deleted
   * - in_progress -> completed
   * - in_progress -> pending (回退)
   * - in_progress -> deleted
   * - completed -> deleted
   * - deleted 不能转换到其他状态
   *
   * @param from - 原状态
   * @param to - 目标状态
   */
  private validateStatusTransition(from: TaskStatus, to: TaskStatus): void {
    if (from === to) {
      return
    }

    // deleted 状态不能转换
    if (from === 'deleted') {
      throw new Error('Cannot change status of a deleted task')
    }

    // 定义合法的转换
    const validTransitions: Record<TaskStatus, TaskStatus[]> = {
      pending: ['in_progress', 'deleted'],
      in_progress: ['completed', 'pending', 'deleted'],
      completed: ['deleted'],
      deleted: []
    }

    const allowed = validTransitions[from] || []
    if (!allowed.includes(to)) {
      throw new Error(`Invalid status transition: ${from} -> ${to}`)
    }
  }

  /**
   * 延迟持久化
   *
   * 使用 debounce 策略，避免频繁写入文件
   */
  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }

    this.saveTimer = setTimeout(() => {
      this.saveImmediate()
    }, this.SAVE_DELAY)
  }

  /**
   * 立即持久化
   */
  private async saveImmediate(): Promise<void> {
    try {
      const tasks = Array.from(this.tasks.values())
      await this.taskStore.saveTasks(tasks)
      await this.workspaceState.update('tasks', {
        tasks,
        lastUpdated: new Date().toISOString(),
      } satisfies TaskList)
    } catch (error) {
      console.error('Failed to save tasks:', error)
    }
  }

  /**
   * 销毁服务
   *
   * 清理定时器，立即持久化
   */
  async dispose(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    await this.saveImmediate()
  }
}
