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
}

export const useTaskStore = defineStore('task', () => {
  // 状态
  const tasks = ref<TaskItem[]>([])
  const loading = ref(false)
  const selectedTaskId = ref<string | null>(null)

  // 计算属性
  const selectedTask = computed(() => {
    if (!selectedTaskId.value) return null
    return tasks.value.find(t => t.id === selectedTaskId.value) || null
  })

  const pendingTasks = computed(() => {
    return tasks.value.filter(t => t.status === 'pending')
  })

  const inProgressTasks = computed(() => {
    return tasks.value.filter(t => t.status === 'in_progress')
  })

  const completedTasks = computed(() => {
    return tasks.value.filter(t => t.status === 'completed')
  })

  const availableTasks = computed(() => {
    return tasks.value.filter(
      t => t.status === 'pending' && t.blockedBy.length === 0
    )
  })

  const stats = computed(() => {
    return {
      total: tasks.value.length,
      pending: pendingTasks.value.length,
      inProgress: inProgressTasks.value.length,
      completed: completedTasks.value.length,
      available: availableTasks.value.length
    }
  })

  // 方法
  function setTasks(newTasks: TaskItem[]) {
    tasks.value = newTasks
  }

  function addTask(task: TaskItem) {
    const existingIndex = tasks.value.findIndex(t => t.id === task.id)
    if (existingIndex === -1) {
      tasks.value.push(task)
      return
    }

    tasks.value[existingIndex] = task
  }

  function updateTask(taskId: string, updates: Partial<TaskItem>) {
    const index = tasks.value.findIndex(t => t.id === taskId)
    if (index !== -1) {
      tasks.value[index] = { ...tasks.value[index], ...updates }
    }
  }

  function removeTask(taskId: string) {
    const index = tasks.value.findIndex(t => t.id === taskId)
    if (index !== -1) {
      tasks.value.splice(index, 1)
    }
  }

  function selectTask(taskId: string | null) {
    selectedTaskId.value = taskId
  }

  function getTaskById(taskId: string): TaskItem | undefined {
    return tasks.value.find(t => t.id === taskId)
  }

  // 请求任务列表
  async function fetchTasks() {
    loading.value = true
    // 发送消息到 Extension
    window.vscode?.postMessage({
      type: 'task.list.request',
      data: null
    })
  }

  return {
    // 状态
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
    setTasks,
    addTask,
    updateTask,
    removeTask,
    selectTask,
    getTaskById,
    fetchTasks
  }
})
