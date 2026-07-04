<template>
  <div class="agent-status" :class="`status-${agent.status}`">
    <div class="status-header">
      <div class="status-left">
        <component :is="getTypeIcon(agent.type)" class="agent-icon" />
        <div class="agent-info">
          <div class="agent-type">{{ getTypeText(agent.type) }}</div>
          <div class="agent-id">{{ agent.id }}</div>
          <div v-if="agent.toolUseId" class="agent-id">tool {{ agent.toolUseId }}</div>
        </div>
      </div>
      <div class="status-badge" :class="`badge-${agent.status}`">
        <component :is="getStatusIcon(agent.status)" class="badge-icon" />
        {{ getStatusText(agent.status) }}
      </div>
    </div>

    <div class="status-description">{{ agent.description }}</div>

    <div class="status-meta">
      <div class="meta-item"><span class="meta-label">开始时间:</span><span class="meta-value">{{ formatTime(agent.startTime) }}</span></div>
      <div class="meta-item" v-if="agent.duration"><span class="meta-label">耗时:</span><span class="meta-value">{{ formatDuration(agent.duration) }}</span></div>
      <div class="meta-item" v-if="agent.outputFile"><span class="meta-label">输出:</span><span class="meta-value output-path">{{ agent.outputFile }}</span></div>
    </div>

    <div class="status-progress" v-if="agent.status === 'running'">
      <div class="progress-bar"><div class="progress-fill"></div></div>
      <div class="progress-text">执行中...</div>
    </div>

    <div class="status-result" v-if="agent.status === 'completed' && agent.summary">
      <div class="result-label">结果摘要:</div>
      <div class="result-content">{{ agent.summary }}</div>
      <Button v-if="agent.fullOutput" variant="secondary" size="small" @click="$emit('view-details', agent.id)">查看完整输出</Button>
    </div>

    <div class="status-error" v-if="agent.status === 'failed' && agent.error">
      <div class="error-label">错误信息:</div>
      <div class="error-content">{{ agent.error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BookOpen, Bot, CheckCircle2, CircleX, LoaderCircle, Microscope, Search } from 'lucide-vue-next'
import Button from '../common/Button.vue'
import type { AgentInfo, AgentType } from '../../stores/agent'

interface Props { agent: AgentInfo }
defineProps<Props>()
defineEmits<{ 'view-details': [agentId: string] }>()

function getTypeIcon(type: AgentType) {
  const icons = { explore: Search, analyze: Microscope, research: BookOpen }
  return icons[type] || Bot
}

function getTypeText(type: AgentType): string {
  const texts = { explore: '探索型 Agent', analyze: '分析型 Agent', research: '研究型 Agent' }
  return texts[type] || type
}

function getStatusIcon(status: string) {
  const icons = { running: LoaderCircle, completed: CheckCircle2, failed: CircleX, stopped: CircleX }
  return icons[status as keyof typeof icons] || Bot
}

function getStatusText(status: string): string {
  const texts = { running: '执行中', completed: '已完成', failed: '失败', stopped: '已停止' }
  return texts[status as keyof typeof texts] || status
}

function formatTime(time: string | number): string {
  return new Date(time).toLocaleTimeString('zh-CN')
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} 分 ${seconds % 60} 秒`
}
</script>

<style scoped>
.agent-status { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 12px; }
.agent-status.status-running { border-color: var(--vscode-charts-blue); }
.agent-status.status-completed { border-color: var(--vscode-charts-green); }
.agent-status.status-failed { border-color: var(--vscode-charts-red); }
.agent-status.status-stopped { border-color: var(--vscode-charts-yellow, var(--color-border)); }
.status-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
.status-left { display: flex; gap: 12px; align-items: center; min-width: 0; }
.agent-icon { width: 28px; height: 28px; color: var(--color-primary); }
.agent-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.agent-type { font-size: 14px; font-weight: 700; color: var(--color-text-primary); }
.agent-id { font-size: 11px; font-family: var(--vscode-editor-font-family, monospace); color: var(--color-text-secondary); }
.status-badge { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: var(--radius-full); font-size: 12px; font-weight: 600; color: white; }
.badge-icon { width: 13px; height: 13px; }
.badge-running { background: var(--vscode-charts-blue); }
.badge-running .badge-icon { animation: spin 1s linear infinite; }
.badge-completed { background: var(--vscode-charts-green); }
.badge-failed { background: var(--vscode-charts-red); }
.badge-stopped { background: var(--vscode-charts-yellow, var(--color-text-secondary)); color: var(--vscode-editor-background); }
.status-description { font-size: 13px; color: var(--color-text-secondary); line-height: 1.5; margin-bottom: 12px; }
.status-meta { display: flex; flex-direction: column; gap: 6px; font-size: 12px; margin-bottom: 12px; }
.meta-item { display: flex; gap: 4px; min-width: 0; }
.meta-label { color: var(--color-text-secondary); }
.meta-value { color: var(--color-text-primary); font-weight: 600; min-width: 0; }
.output-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--vscode-editor-font-family, monospace); }
.status-progress { margin-top: 12px; }
.progress-bar { height: 5px; background: var(--color-surface-container); border-radius: var(--radius-full); overflow: hidden; margin-bottom: 6px; }
.progress-fill { height: 100%; background: var(--color-primary); animation: progress 2s ease-in-out infinite; }
@keyframes progress { 0% { width: 0%; } 50% { width: 70%; } 100% { width: 100%; } }
@keyframes spin { to { transform: rotate(360deg); } }
.progress-text { font-size: 12px; color: var(--color-text-secondary); text-align: center; }
.status-result, .status-error { margin-top: 12px; padding: 12px; border-radius: var(--radius-lg); }
.status-result { background: var(--color-surface-container); }
.status-error { background: var(--vscode-inputValidation-errorBackground, var(--color-surface-container)); border: 1px solid var(--vscode-inputValidation-errorBorder, var(--color-error)); }
.result-label, .error-label { font-size: 12px; font-weight: 700; margin-bottom: 6px; }
.result-label { color: var(--color-text-secondary); }
.error-label { color: var(--vscode-inputValidation-errorForeground, var(--color-error)); }
.result-content, .error-content { font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; margin-bottom: 8px; }
.result-content { color: var(--color-text-primary); }
.error-content { color: var(--vscode-inputValidation-errorForeground, var(--color-error)); }
</style>
