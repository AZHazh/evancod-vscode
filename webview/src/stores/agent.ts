/**
 * Agent Store - Agent 状态管理
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AgentTaskNotification } from '@/types'

export type AgentType = 'explore' | 'analyze' | 'research'
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
  // 状态
  const agents = ref<AgentInfo[]>([])

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
    return [...agents.value].sort((a, b) => Number(new Date(b.endTime || b.startTime)) - Number(new Date(a.endTime || a.startTime)))
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

  // 方法
  function addAgent(agent: AgentInfo) {
    const normalized: AgentInfo = {
      ...agent,
      status: agent.status || 'running',
    }
    const index = agents.value.findIndex(a => a.id === normalized.id)
    if (index === -1) {
      agents.value.push(normalized)
      return
    }
    agents.value[index] = { ...agents.value[index], ...normalized }
  }

  function updateAgent(agentId: string, updates: Partial<AgentInfo>) {
    const index = agents.value.findIndex(a => a.id === agentId)
    if (index !== -1) {
      agents.value[index] = { ...agents.value[index], ...updates }
      return
    }

    agents.value.push({
      id: agentId,
      type: updates.type || 'explore',
      description: updates.description || agentId,
      status: updates.status || 'completed',
      startTime: updates.startTime || Date.now(),
      ...updates,
    })
  }

  function applyNotification(notification: AgentTaskNotification) {
    updateAgent(notification.taskId, {
      id: notification.taskId,
      toolUseId: notification.toolUseId,
      status: notification.status,
      summary: notification.summary,
      fullOutput: notification.result,
      outputFile: notification.outputFile,
      duration: notification.usage?.durationMs,
      endTime: notification.timestamp || Date.now(),
    })
  }

  function restoreFromNotifications(notifications: Record<string, AgentTaskNotification>) {
    for (const notification of Object.values(notifications)) {
      applyNotification(notification)
    }
  }

  function getAgent(agentId: string): AgentInfo | undefined {
    return agents.value.find(a => a.id === agentId)
  }

  function clearCompleted() {
    agents.value = agents.value.filter(a => a.status === 'running')
  }

  function clearAll() {
    agents.value = []
  }

  return {
    // 状态
    agents,

    // 计算属性
    runningAgents,
    completedAgents,
    failedAgents,
    stoppedAgents,
    visibleAgents,
    stats,

    // 方法
    addAgent,
    updateAgent,
    applyNotification,
    restoreFromNotifications,
    getAgent,
    clearCompleted,
    clearAll
  }
})
