/**
 * Task Store - 任务状态管理
 *
 * 职责：
 * - 管理任务列表状态
 * - 处理任务的增删改查
 * - 与 Extension 通信获取任务数据
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface TaskItem {
  id: string
  sessionId?: string
  subject: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'deleted'
  activeForm?: string
  owner?: string
  blocks: string[]
  blockedBy: string[]
  createdAt: string
  updatedAt: string
  metadata?: Record<string, any>
  requestId?: string
  requirementIds?: string[]
  referenceIds?: string[]
  completion?: {
    state: 'none' | 'reviewing' | 'passed' | 'failed'
    issues?: string[]
  }
}

export const useTaskStore = defineStore('task', () => {
  const activeSessionId = ref<string | null>(null)
  const tasksBySession = ref<Record<string, TaskItem[]>>({})
  const loadingBySession = ref<Record<string, boolean>>({})
  const selectedTaskIdBySession = ref<Record<string, string | null>>({})
  const tasks = computed(() => {
    const sessionId = activeSessionId.value
    return sessionId ? tasksBySession.value[sessionId] || [] : []
  })
  const loading = computed(() => {
    const sessionId = activeSessionId.value
    return sessionId ? loadingBySession.value[sessionId] || false : false
  })
  const selectedTaskId = computed(() => {
    const sessionId = activeSessionId.value
    return sessionId ? selectedTaskIdBySession.value[sessionId] || null : null
  })

  // 计算属性
  const selectedTask = computed(() => {
    if (!selectedTaskId.value) return null
    return tasks.value.find(t => t.id === selectedTaskId.value) || null
  })

  const pendingTasks = computed(() => {
    return tasks.value.filter(t => t.status === 'pending')
  })

  const inProgressTasks = computed(() => {
    return tasks.value.filter(
      t => t.status === 'in_progress' || t.completion?.state === 'reviewing'
    )
  })

  const completedTasks = computed(() => {
    return tasks.value.filter(t => t.status === 'completed' && t.completion?.state !== 'reviewing')
  })

  const availableTasks = computed(() => {
    return tasks.value.filter(t => t.status === 'pending' && t.blockedBy.length === 0)
  })

  const stats = computed(() => {
    return {
      total: tasks.value.length,
      pending: pendingTasks.value.length,
      inProgress: inProgressTasks.value.length,
      completed: completedTasks.value.length,
      available: availableTasks.value.length,
    }
  })

  /** 切换任务面板当前展示的会话，不清理其他会话任务。 */
  function setActiveSession(sessionId: string | null) {
    activeSessionId.value = sessionId
    if (!sessionId) return
    tasksBySession.value[sessionId] ||= []
    selectedTaskIdBySession.value[sessionId] ??= null
  }

  /** @returns 指定会话的任务列表；没有会话上下文时返回 undefined。 */
  function getSessionTasks(sessionId?: string): TaskItem[] | undefined {
    const targetSessionId = sessionId || activeSessionId.value
    if (!targetSessionId) return undefined
    return (tasksBySession.value[targetSessionId] ||= [])
  }

  /** 使用服务端列表替换指定会话的任务快照。 */
  function setTasks(newTasks: TaskItem[], sessionId?: string) {
    const targetSessionId = sessionId || activeSessionId.value
    if (!targetSessionId) return
    // 兜底过滤 deleted 任务，避免历史 deleted 任务被恢复显示
    tasksBySession.value[targetSessionId] = newTasks.filter(t => t.status !== 'deleted')
    loadingBySession.value[targetSessionId] = false
  }

  /** 将新增任务写入其所属会话。 */
  function addTask(task: TaskItem, sessionId?: string) {
    const sessionTasks = getSessionTasks(sessionId || task.sessionId)
    if (!sessionTasks) return
    // deleted 任务视为移除
    if (task.status === 'deleted') {
      removeTask(task.id, sessionId || task.sessionId)
      return
    }

    const existingIndex = sessionTasks.findIndex(t => t.id === task.id)
    if (existingIndex === -1) {
      sessionTasks.push(task)
      return
    }

    sessionTasks[existingIndex] = task
  }

  /** 更新指定会话中的任务。 */
  function updateTask(taskId: string, updates: Partial<TaskItem>, sessionId?: string) {
    const sessionTasks = getSessionTasks(sessionId || updates.sessionId)
    if (!sessionTasks) return
    // 更新为 deleted 时直接移除，而不是保留一条 deleted 记录
    if (updates.status === 'deleted') {
      removeTask(taskId, sessionId || updates.sessionId)
      return
    }

    const index = sessionTasks.findIndex(t => t.id === taskId)
    if (index !== -1) {
      sessionTasks[index] = { ...sessionTasks[index], ...updates }
    }
  }

  /** 从指定会话移除任务。 */
  function removeTask(taskId: string, sessionId?: string) {
    const targetSessionId = sessionId || activeSessionId.value
    const sessionTasks = getSessionTasks(targetSessionId || undefined)
    if (!targetSessionId || !sessionTasks) return
    const index = sessionTasks.findIndex(t => t.id === taskId)
    if (index !== -1) {
      sessionTasks.splice(index, 1)
    }
    // 若删除的是当前选中任务，清空选中
    if (selectedTaskIdBySession.value[targetSessionId] === taskId) {
      selectedTaskIdBySession.value[targetSessionId] = null
    }
  }

  function selectTask(taskId: string | null) {
    const sessionId = activeSessionId.value
    if (sessionId) selectedTaskIdBySession.value[sessionId] = taskId
  }

  function getTaskById(taskId: string): TaskItem | undefined {
    return tasks.value.find(t => t.id === taskId)
  }

  // 请求任务列表
  async function fetchTasks() {
    const sessionId = activeSessionId.value
    if (!sessionId) return
    loadingBySession.value[sessionId] = true
    // 发送消息到 Extension
    window.vscode?.postMessage({
      type: 'task.list.request',
      data: { sessionId },
    })
  }

  return {
    // 状态
    activeSessionId,
    tasksBySession,
    tasks,
    loading,
    selectedTaskId,

    // 计算属性
    selectedTask,
    pendingTasks,
    inProgressTasks,
    completedTasks,
    availableTasks,
    stats,

    // 方法
    setActiveSession,
    setTasks,
    addTask,
    updateTask,
    removeTask,
    selectTask,
    getTaskById,
    fetchTasks,
  }
})
