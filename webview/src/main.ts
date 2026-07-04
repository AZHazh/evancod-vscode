import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/globals.scss'
import { useTaskStore } from './stores/task'
import { usePlanStore } from './stores/plan'
import { useAgentStore } from './stores/agent'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.mount('#app')

// 设置消息监听器
window.addEventListener('message', (event) => {
  const message = event.data
  console.log('[Main] 收到消息:', message.type, message)

  // 获取 store 实例
  const taskStore = useTaskStore()
  const planStore = usePlanStore()
  const agentStore = useAgentStore()

  switch (message.type) {
    // ============ Task 相关消息 ============
    case 'task.created':
      taskStore.addTask(message.data.task)
      break

    case 'task.updated':
      taskStore.updateTask(message.data.task.id, message.data.task)
      break

    case 'task.list':
      taskStore.setTasks(message.data.tasks)
      break

    case 'task.deleted':
      taskStore.removeTask(message.data.taskId)
      break

    // ============ Plan 相关消息 ============
    case 'plan.submitted':
      console.log('[Main] 处理 plan.submitted')
      planStore.setPlan(message.data.plan)
      planStore.showApprovalDialog = true
      console.log('[Main] planStore.showApprovalDialog =', planStore.showApprovalDialog)
      console.log('[Main] planStore.currentPlan =', planStore.currentPlan)
      break

    case 'plan.approved':
      planStore.markAsApproved(message.data.planId)
      break

    case 'plan.rejected':
      planStore.markAsRejected(message.data.planId, message.data.reason)
      break

    // ============ Question 相关消息 ============
    case 'question.ask':
      console.log('Question asked:', message.data.question)
      break

    // ============ Agent 相关消息 ============
    case 'agent.started':
      agentStore.addAgent(message.data.agent)
      break

    case 'agent.completed':
      agentStore.updateAgent(message.data.agent.id, {
        status: message.data.agent.success === false ? 'failed' : 'completed',
        summary: message.data.agent.summary,
        fullOutput: message.data.agent.fullOutput,
        error: message.data.agent.error,
        duration: message.data.agent.duration,
        endTime: message.data.agent.endTime || Date.now()
      })
      break
  }
})
