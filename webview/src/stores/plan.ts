/**
 * Plan Store - 计划状态管理
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type PlanState = 'inactive' | 'planning' | 'approved' | 'rejected'

export interface PlanTask {
  id: string
  subject: string
  description: string
  estimatedTime?: string
  risks?: string[]
}

export interface PlanRisk {
  level: 'low' | 'medium' | 'high'
  description: string
  mitigation: string
}

export interface Plan {
  id: string
  title: string
  description: string
  state: PlanState
  tasks: PlanTask[]
  steps: string[]
  risks: PlanRisk[]
  createdAt: string
  approvedAt?: string
  rejectedReason?: string
  filePath?: string
}

export const usePlanStore = defineStore('plan', () => {
  const activeSessionId = ref<string | null>(null)
  const plansBySession = ref<Record<string, Plan | null>>({})
  const currentPlan = computed(() => {
    const sessionId = activeSessionId.value
    return sessionId ? plansBySession.value[sessionId] || null : null
  })
  const showApprovalDialog = ref(false)

  // 计算属性
  const hasPlan = computed(() => currentPlan.value !== null)

  const isWaitingApproval = computed(() => {
    return currentPlan.value?.state === 'planning'
  })

  const taskCount = computed(() => currentPlan.value?.tasks.length || 0)
  const stepCount = computed(() => currentPlan.value?.steps.length || 0)
  const riskCount = computed(() => currentPlan.value?.risks.length || 0)

  const highRisks = computed(() => {
    return currentPlan.value?.risks.filter(r => r.level === 'high') || []
  })

  /** 切换计划面板当前展示的会话。 */
  function setActiveSession(sessionId: string | null) {
    activeSessionId.value = sessionId
    showApprovalDialog.value = false
  }

  /** 替换指定会话的计划快照。 */
  function setPlan(plan: Plan | null, sessionId?: string) {
    const targetSessionId = sessionId || activeSessionId.value
    if (!targetSessionId) return
    plansBySession.value[targetSessionId] = plan
    showApprovalDialog.value = false
  }

  function approvePlan() {
    if (!currentPlan.value) {
      console.error('[PlanStore] currentPlan 为空，无法批准')
      return
    }

    // 发送批准消息到 Extension
    window.vscode?.postMessage({
      type: 'plan.approve',
      data: {
        planId: currentPlan.value.id,
        sessionId: activeSessionId.value || undefined,
      },
    })

    showApprovalDialog.value = false
  }

  function rejectPlan(reason: string) {
    if (!currentPlan.value) {
      console.error('[PlanStore] currentPlan 为空，无法拒绝')
      return
    }

    // 发送拒绝消息到 Extension
    window.vscode?.postMessage({
      type: 'plan.reject',
      data: {
        planId: currentPlan.value.id,
        sessionId: activeSessionId.value || undefined,
        reason,
      },
    })

    showApprovalDialog.value = false
  }

  function clearPlan() {
    const sessionId = activeSessionId.value
    if (sessionId) plansBySession.value[sessionId] = null
    showApprovalDialog.value = false
  }

  function markAsApproved(planId: string, sessionId?: string) {
    const targetSessionId = sessionId || activeSessionId.value
    const plan = targetSessionId ? plansBySession.value[targetSessionId] : null
    if (plan && plan.id === planId) {
      plan.state = 'approved'
      plan.approvedAt = new Date().toISOString()
    }
  }

  function markAsRejected(planId: string, reason: string, sessionId?: string) {
    const targetSessionId = sessionId || activeSessionId.value
    const plan = targetSessionId ? plansBySession.value[targetSessionId] : null
    if (plan && plan.id === planId) {
      plan.state = 'rejected'
      plan.rejectedReason = reason
    }
  }

  return {
    // 状态
    activeSessionId,
    plansBySession,
    currentPlan,
    showApprovalDialog,

    // 计算属性
    hasPlan,
    isWaitingApproval,
    taskCount,
    stepCount,
    riskCount,
    highRisks,

    // 方法
    setActiveSession,
    setPlan,
    approvePlan,
    rejectPlan,
    clearPlan,
    markAsApproved,
    markAsRejected,
  }
})
