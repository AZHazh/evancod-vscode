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
  // 状态
  const currentPlan = ref<Plan | null>(null)
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

  // 方法
  function setPlan(plan: Plan) {
    currentPlan.value = plan
    if (plan.state === 'planning') {
      showApprovalDialog.value = true
    }
  }

  function approvePlan() {
    console.log('[PlanStore] approvePlan 被调用')
    if (!currentPlan.value) {
      console.error('[PlanStore] currentPlan 为空，无法批准')
      return
    }

    console.log('[PlanStore] 发送 plan.approve 消息:', currentPlan.value.id)

    // 发送批准消息到 Extension
    window.vscode?.postMessage({
      type: 'plan.approve',
      data: {
        planId: currentPlan.value.id
      }
    })

    console.log('[PlanStore] 关闭审批对话框')
    showApprovalDialog.value = false
  }

  function rejectPlan(reason: string) {
    console.log('[PlanStore] rejectPlan 被调用，原因:', reason)
    if (!currentPlan.value) {
      console.error('[PlanStore] currentPlan 为空，无法拒绝')
      return
    }

    console.log('[PlanStore] 发送 plan.reject 消息:', currentPlan.value.id)

    // 发送拒绝消息到 Extension
    window.vscode?.postMessage({
      type: 'plan.reject',
      data: {
        planId: currentPlan.value.id,
        reason
      }
    })

    console.log('[PlanStore] 关闭审批对话框')
    showApprovalDialog.value = false
  }

  function clearPlan() {
    currentPlan.value = null
    showApprovalDialog.value = false
  }

  function markAsApproved(planId: string) {
    if (currentPlan.value && currentPlan.value.id === planId) {
      currentPlan.value.state = 'approved'
      currentPlan.value.approvedAt = new Date().toISOString()
    }
  }

  function markAsRejected(planId: string, reason: string) {
    if (currentPlan.value && currentPlan.value.id === planId) {
      currentPlan.value.state = 'rejected'
      currentPlan.value.rejectedReason = reason
    }
  }

  return {
    // 状态
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
    setPlan,
    approvePlan,
    rejectPlan,
    clearPlan,
    markAsApproved,
    markAsRejected
  }
})
