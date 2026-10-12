/**
 * Agent Store - Agent 状态管理
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AgentTaskNotification } from '@/types'

export type AgentType = string
export type AgentStatus = 'running' | 'completed' | 'failed' | 'stopped'

export interface AgentInfo {
  id: string
  type: AgentType
  description: string
  status: AgentStatus
  startTime: string | number
  endTime?: string | number
  duration?: number
  summary?: string
  fullOutput?: string
  error?: string
  toolUseId?: string
  outputFile?: string
}

export const useAgentStore = defineStore('agent', () => {
  const activeSessionId = ref<string | null>(null)
  const agentsBySession = ref<Record<string, AgentInfo[]>>({})
  const agents = computed(() => {
    const sessionId = activeSessionId.value
    return sessionId ? agentsBySession.value[sessionId] || [] : []
  })

  // 计算属性
  const runningAgents = computed(() => {
    return agents.value.filter(a => a.status === 'running')
  })

  const completedAgents = computed(() => {
    return agents.value.filter(a => a.status === 'completed')
  })

  const failedAgents = computed(() => {
    return agents.value.filter(a => a.status === 'failed')
  })

  const stoppedAgents = computed(() => {
    return agents.value.filter(a => a.status === 'stopped')
  })

  const visibleAgents = computed(() => {
    return [...agents.value].sort(
      (a, b) =>
        Number(new Date(b.endTime || b.startTime)) - Number(new Date(a.endTime || a.startTime))
    )
  })

  const stats = computed(() => {
    return {
      total: agents.value.length,
      running: runningAgents.value.length,
      completed: completedAgents.value.length,
      failed: failedAgents.value.length,
      stopped: stoppedAgents.value.length,
    }
  })

  /** 切换 Agent 面板当前展示的会话，不修改其他会话的状态。 */
  function setActiveSession(sessionId: string | null) {
    activeSessionId.value = sessionId
    if (sessionId && !agentsBySession.value[sessionId]) {
      agentsBySession.value[sessionId] = []
    }
  }

  /**
   * 合并指定会话的扩展端快照。
   *
   * transcript 恢复出的旧版完成通知可能没有 sessionId，因此保留快照中未出现的
   * 历史项；相同 ID 始终以扩展端运行快照为准。
   */
  function replaceSessionAgents(sessionId: string, sessionAgents: AgentInfo[]) {
    const merged = new Map(
      (agentsBySession.value[sessionId] || []).map(agent => [agent.id, { ...agent }])
    )
    for (const agent of sessionAgents) {
      merged.set(agent.id, { ...merged.get(agent.id), ...agent })
    }
    agentsBySession.value[sessionId] = Array.from(merged.values())
  }

  /** @returns 指定会话的可变 Agent 列表；没有会话上下文时返回 undefined。 */
  function getSessionAgents(sessionId?: string): AgentInfo[] | undefined {
    const targetSessionId = sessionId || activeSessionId.value
    if (!targetSessionId) return undefined
    return (agentsBySession.value[targetSessionId] ||= [])
  }

  /** 将 Agent 启动事件写入它所属的会话。 */
  function addAgent(agent: AgentInfo, sessionId?: string) {
    const sessionAgents = getSessionAgents(sessionId)
    if (!sessionAgents) return
    const normalized: AgentInfo = {
      ...agent,
      status: agent.status || 'running',
    }
    const index = sessionAgents.findIndex(a => a.id === normalized.id)
    if (index === -1) {
      sessionAgents.push(normalized)
      return
    }
    sessionAgents[index] = { ...sessionAgents[index], ...normalized }
  }

  /** 更新指定会话的 Agent，允许完成事件先于启动事件被前端接收。 */
  function updateAgent(agentId: string, updates: Partial<AgentInfo>, sessionId?: string) {
    const sessionAgents = getSessionAgents(sessionId)
    if (!sessionAgents) return
    const index = sessionAgents.findIndex(a => a.id === agentId)
    if (index !== -1) {
      sessionAgents[index] = { ...sessionAgents[index], ...updates }
      return
    }

    sessionAgents.push({
      id: agentId,
      type: updates.type || 'explore',
      description: updates.description || agentId,
      status: updates.status || 'completed',
      startTime: updates.startTime || Date.now(),
      ...updates,
    })
  }

  /** 将工具通知恢复为对应会话的 Agent 完成状态。 */
  function applyNotification(notification: AgentTaskNotification, sessionId?: string) {
    updateAgent(
      notification.taskId,
      {
        id: notification.taskId,
        toolUseId: notification.toolUseId,
        status: notification.status,
        summary: notification.summary,
        fullOutput: notification.result,
        outputFile: notification.outputFile,
        duration: notification.usage?.durationMs,
        endTime: notification.timestamp || Date.now(),
      },
      sessionId
    )
  }

  /** 批量恢复指定会话持久化的 Agent 通知。 */
  function restoreFromNotifications(
    notifications: Record<string, AgentTaskNotification>,
    sessionId?: string
  ) {
    for (const notification of Object.values(notifications)) {
      applyNotification(notification, sessionId)
    }
  }

  function getAgent(agentId: string): AgentInfo | undefined {
    return agents.value.find(a => a.id === agentId)
  }

  function clearCompleted() {
    const sessionId = activeSessionId.value
    if (!sessionId) return
    agentsBySession.value[sessionId] = agents.value.filter(a => a.status === 'running')
  }

  function clearAll() {
    const sessionId = activeSessionId.value
    if (sessionId) agentsBySession.value[sessionId] = []
  }

  return {
    // 状态
    activeSessionId,
    agentsBySession,
    agents,

    // 计算属性
    runningAgents,
    completedAgents,
    failedAgents,
    stoppedAgents,
    visibleAgents,
    stats,

    // 方法
    setActiveSession,
    replaceSessionAgents,
    addAgent,
    updateAgent,
    applyNotification,
    restoreFromNotifications,
    getAgent,
    clearCompleted,
    clearAll,
  }
})
