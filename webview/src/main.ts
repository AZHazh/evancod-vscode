import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/globals.scss'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import { useChatStore } from './stores/chat'
import { useTaskStore } from './stores/task'
import { usePlanStore } from './stores/plan'
import { useAgentStore } from './stores/agent'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.mount('#app')

// 设置消息监听器
window.addEventListener('message', event => {
  const message = event.data

  // 获取 store 实例
  const chatStore = useChatStore()
  const taskStore = useTaskStore()
  const planStore = usePlanStore()
  const agentStore = useAgentStore()

  switch (message.type) {
    case 'session.restored':
    case 'session.created': {
      const sessionId = message.data.session?.id || null
      taskStore.setActiveSession(sessionId)
      agentStore.setActiveSession(sessionId)
      planStore.setActiveSession(sessionId)
      if (sessionId) planStore.setPlan(null, sessionId)
      break
    }

    // ============ Task 相关消息 ============
    case 'task.created': {
      const sessionId = message.data.sessionId || message.data.task.sessionId
      taskStore.addTask(message.data.task, sessionId)
      break
    }

    case 'task.updated': {
      const sessionId = message.data.sessionId || message.data.task.sessionId
      taskStore.updateTask(message.data.task.id, message.data.task, sessionId)
      break
    }

    case 'task.list':
      taskStore.setTasks(message.data.tasks, message.data.sessionId)
      break

    case 'task.deleted':
      taskStore.removeTask(message.data.taskId, message.data.sessionId)
      break

    // ============ Plan 相关消息 ============
    case 'plan.submitted': {
      const sessionId = message.data.sessionId || chatStore.currentSession?.id
      planStore.setPlan(message.data.plan, sessionId)
      if (!sessionId || sessionId === chatStore.currentSession?.id) {
        chatStore.upsertPlanApprovalMessage(message.data.plan)
      }
      break
    }

    case 'plan.approved': {
      const sessionId = message.data.sessionId || chatStore.currentSession?.id
      planStore.markAsApproved(message.data.planId, sessionId)
      if (!sessionId || sessionId === chatStore.currentSession?.id) {
        chatStore.updatePlanApprovalMessage(message.data.planId, plan => {
          plan.state = 'approved'
          plan.approvedAt = new Date().toISOString()
        })
      }
      break
    }

    case 'plan.rejected': {
      const sessionId = message.data.sessionId || chatStore.currentSession?.id
      planStore.markAsRejected(message.data.planId, message.data.reason, sessionId)
      if (!sessionId || sessionId === chatStore.currentSession?.id) {
        chatStore.updatePlanApprovalMessage(message.data.planId, plan => {
          plan.state = 'rejected'
          plan.rejectedReason = message.data.reason
        })
      }
      break
    }

    // ============ Question 相关消息 ============
    case 'question.ask':
      break

    // ============ Agent 相关消息 ============
    case 'session.runtime.snapshot':
      agentStore.replaceSessionAgents(message.data.sessionId, message.data.agents)
      break

    case 'agent.started':
      agentStore.addAgent(
        message.data.agent,
        message.data.sessionId || chatStore.currentSession?.id
      )
      break

    case 'agent.completed':
      agentStore.updateAgent(
        message.data.agent.id,
        {
          status: message.data.agent.success === false ? 'failed' : 'completed',
          summary: message.data.agent.summary,
          fullOutput: message.data.agent.fullOutput,
          error: message.data.agent.error,
          duration: message.data.agent.duration,
          endTime: message.data.agent.endTime || Date.now(),
        },
        message.data.sessionId || chatStore.currentSession?.id
      )
      break
  }
})
