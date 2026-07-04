<template>
  <div class="plan-preview">
    <div class="preview-header">
      <h2 class="plan-title">{{ plan.title }}</h2>
      <span class="plan-status" :class="`status-${plan.state}`">
        {{ statusText }}
      </span>
    </div>

    <div class="plan-meta">
      <div class="meta-item">
        <span class="meta-label">创建时间:</span>
        <span class="meta-value">{{ formatDate(plan.createdAt) }}</span>
      </div>
      <div class="meta-item" v-if="plan.approvedAt">
        <span class="meta-label">批准时间:</span>
        <span class="meta-value">{{ formatDate(plan.approvedAt) }}</span>
      </div>
    </div>

    <div class="plan-description">
      <h3 class="section-title">📋 描述</h3>
      <p class="description-text">{{ plan.description }}</p>
    </div>

    <div class="plan-stats">
      <div class="stat-card">
        <span class="stat-icon">📝</span>
        <div class="stat-content">
          <span class="stat-label">任务</span>
          <span class="stat-value">{{ plan.tasks.length }}</span>
        </div>
      </div>
      <div class="stat-card">
        <span class="stat-icon">🔧</span>
        <div class="stat-content">
          <span class="stat-label">步骤</span>
          <span class="stat-value">{{ plan.steps.length }}</span>
        </div>
      </div>
      <div class="stat-card">
        <span class="stat-icon">⚠️</span>
        <div class="stat-content">
          <span class="stat-label">风险</span>
          <span class="stat-value">{{ plan.risks.length }}</span>
        </div>
      </div>
    </div>

    <div class="plan-tasks" v-if="plan.tasks.length > 0">
      <h3 class="section-title">📝 任务列表</h3>
      <TaskListView :tasks="plan.tasks" />
    </div>

    <div class="plan-steps" v-if="plan.steps.length > 0">
      <h3 class="section-title">🔧 执行步骤</h3>
      <ol class="steps-list">
        <li v-for="(step, index) in plan.steps" :key="index" class="step-item">
          {{ step }}
        </li>
      </ol>
    </div>

    <div class="plan-risks" v-if="plan.risks.length > 0">
      <h3 class="section-title">⚠️ 风险评估</h3>
      <RiskAssessment :risks="plan.risks" />
    </div>

    <div class="plan-rejected" v-if="plan.rejectedReason">
      <h3 class="section-title">❌ 拒绝原因</h3>
      <p class="rejected-reason">{{ plan.rejectedReason }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Plan } from '../../stores/plan'
import TaskListView from './TaskListView.vue'
import RiskAssessment from './RiskAssessment.vue'

interface Props {
  plan: Plan
}

const props = defineProps<Props>()

const statusText = computed(() => {
  const statusMap = {
    inactive: '未激活',
    planning: '🔄 等待审批',
    approved: '✅ 已批准',
    rejected: '❌ 已拒绝'
  }
  return statusMap[props.plan.state] || props.plan.state
})

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>

<style scoped>
.plan-preview {
  padding: 20px;
  max-width: 900px;
  margin: 0 auto;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 2px solid var(--vscode-panel-border);
}

.plan-title {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
  color: var(--vscode-foreground);
}

.plan-status {
  padding: 6px 12px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 500;
}

.plan-status.status-planning {
  background: var(--vscode-charts-blue);
  color: white;
}

.plan-status.status-approved {
  background: var(--vscode-charts-green);
  color: white;
}

.plan-status.status-rejected {
  background: var(--vscode-charts-red);
  color: white;
}

.plan-meta {
  display: flex;
  gap: 24px;
  margin-bottom: 24px;
  font-size: 13px;
}

.meta-item {
  display: flex;
  gap: 6px;
}

.meta-label {
  color: var(--vscode-descriptionForeground);
}

.meta-value {
  color: var(--vscode-foreground);
  font-weight: 500;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin: 24px 0 12px 0;
  color: var(--vscode-foreground);
}

.plan-description {
  margin-bottom: 24px;
}

.description-text {
  font-size: 14px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.6;
  margin: 0;
}

.plan-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
}

.stat-icon {
  font-size: 24px;
}

.stat-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.stat-value {
  font-size: 20px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.plan-tasks,
.plan-steps,
.plan-risks,
.plan-rejected {
  margin-bottom: 24px;
}

.steps-list {
  margin: 0;
  padding-left: 24px;
}

.step-item {
  font-size: 14px;
  color: var(--vscode-foreground);
  line-height: 1.8;
  margin-bottom: 8px;
}

.rejected-reason {
  padding: 12px;
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  border-radius: 6px;
  color: var(--vscode-inputValidation-errorForeground);
  font-size: 14px;
  margin: 0;
}
</style>
