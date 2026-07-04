<template>
  <div class="agent-list">
    <div class="list-header">
      <h3 class="list-title"><Bot class="title-icon" />Agent 列表</h3>
      <div class="list-actions">
        <Button v-if="agentStore.completedAgents.length > 0" variant="secondary" size="small" @click="handleClearCompleted">
          <template #icon><Trash2 /></template>
          清除已完成
        </Button>
      </div>
    </div>

    <div class="list-stats">
      <div class="stat-item"><span class="stat-label">总计</span><span class="stat-value">{{ agentStore.stats.total }}</span></div>
      <div class="stat-item stat-running"><span class="stat-label">运行中</span><span class="stat-value">{{ agentStore.stats.running }}</span></div>
      <div class="stat-item stat-completed"><span class="stat-label">已完成</span><span class="stat-value">{{ agentStore.stats.completed }}</span></div>
      <div class="stat-item stat-failed"><span class="stat-label">失败</span><span class="stat-value">{{ agentStore.stats.failed }}</span></div>
      <div class="stat-item stat-stopped"><span class="stat-label">停止</span><span class="stat-value">{{ agentStore.stats.stopped }}</span></div>
    </div>

    <div class="list-content">
      <div v-if="agentStore.visibleAgents.length > 0" class="agent-section">
        <h4 class="section-title"><Bot class="section-icon" />后台任务 ({{ agentStore.visibleAgents.length }})</h4>
        <AgentStatus v-for="agent in agentStore.visibleAgents" :key="agent.id" :agent="agent" @view-details="handleViewDetails" />
      </div>

      <div v-if="agentStore.agents.length === 0" class="empty-state">
        <Bot class="empty-icon" />
        <h3 class="empty-title">暂无 Agent</h3>
        <p class="empty-description">当 AI 需要执行独立的研究或分析任务时，会自动创建子 Agent</p>
      </div>
    </div>

    <Modal v-model="showDetailsModal" title="Agent 完整输出" size="large" :show-footer="false">
      <div class="agent-details" v-if="selectedAgent">
        <div class="details-meta">
          <div class="meta-row"><span class="meta-label">Agent ID:</span><span class="meta-value">{{ selectedAgent.id }}</span></div>
          <div class="meta-row"><span class="meta-label">类型:</span><span class="meta-value">{{ selectedAgent.type }}</span></div>
          <div class="meta-row"><span class="meta-label">耗时:</span><span class="meta-value">{{ selectedAgent.duration }}ms</span></div>
        </div>
        <div class="details-output">
          <pre class="output-content">{{ selectedAgent.fullOutput }}</pre>
        </div>
      </div>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Bot, Trash2 } from 'lucide-vue-next'
import { useAgentStore } from '../../stores/agent'
import Button from '../common/Button.vue'
import Modal from '../common/Modal.vue'
import AgentStatus from './AgentStatus.vue'

const agentStore = useAgentStore()
const showDetailsModal = ref(false)
const selectedAgentId = ref<string | null>(null)

const selectedAgent = computed(() => selectedAgentId.value ? agentStore.getAgent(selectedAgentId.value) : null)

function handleViewDetails(agentId: string) {
  selectedAgentId.value = agentId
  showDetailsModal.value = true
}

function handleClearCompleted() {
  agentStore.clearCompleted()
}
</script>

<style scoped>
.agent-list { height: 100%; display: flex; flex-direction: column; padding: 16px; }
.list-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; }
.list-title { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 700; margin: 0; color: var(--color-text-primary); }
.title-icon { width: 20px; height: 20px; color: var(--color-primary); }
.list-actions { display: flex; gap: 8px; }
.list-stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px; }
.stat-item { display: flex; flex-direction: column; align-items: center; padding: 10px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
.stat-running { border-color: var(--vscode-charts-blue); }
.stat-completed { border-color: var(--vscode-charts-green); }
.stat-failed { border-color: var(--vscode-charts-red); }
.stat-stopped { border-color: var(--vscode-charts-yellow, var(--color-border)); }
.stat-label { font-size: 11px; color: var(--color-text-secondary); margin-bottom: 4px; }
.stat-value { font-size: 18px; font-weight: 700; color: var(--color-text-primary); }
.list-content { flex: 1; overflow-y: auto; }
.agent-section { margin-bottom: 20px; }
.section-title { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 700; margin: 0 0 12px 0; color: var(--color-text-primary); }
.section-icon { width: 16px; height: 16px; color: var(--color-primary); }
.spinning { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.empty-state { text-align: center; padding: 48px 24px; }
.empty-icon { width: 56px; height: 56px; margin-bottom: 16px; color: var(--color-text-tertiary); }
.empty-title { font-size: 16px; font-weight: 700; margin: 0 0 8px 0; color: var(--color-text-primary); }
.empty-description { font-size: 13px; color: var(--color-text-secondary); margin: 0; line-height: 1.5; }
.agent-details { display: flex; flex-direction: column; gap: 16px; }
.details-meta { display: flex; flex-direction: column; gap: 8px; padding: 12px; background: var(--color-surface-container); border-radius: var(--radius-lg); }
.meta-row { display: flex; gap: 8px; font-size: 13px; }
.meta-label { color: var(--color-text-secondary); font-weight: 600; }
.meta-value { color: var(--color-text-primary); font-family: var(--vscode-editor-font-family, monospace); }
.details-output { max-height: 500px; overflow-y: auto; }
.output-content { font-size: 12px; font-family: var(--vscode-editor-font-family); color: var(--color-text-primary); background: var(--color-bg-primary); padding: 12px; border-radius: var(--radius-lg); margin: 0; white-space: pre-wrap; word-wrap: break-word; line-height: 1.5; }
</style>
