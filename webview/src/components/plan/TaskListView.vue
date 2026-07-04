<template>
  <div class="task-list-view">
    <div v-for="(task, index) in tasks" :key="task.id" class="task-item">
      <div class="task-header">
        <span class="task-number">{{ index + 1 }}</span>
        <h4 class="task-subject">{{ task.subject }}</h4>
      </div>

      <p class="task-description">{{ task.description }}</p>

      <div class="task-meta" v-if="task.estimatedTime || task.risks">
        <div class="meta-badge" v-if="task.estimatedTime">
          <span class="badge-icon">⏱️</span>
          <span class="badge-text">{{ task.estimatedTime }}</span>
        </div>

        <div class="meta-badge risk-badge" v-if="task.risks && task.risks.length > 0">
          <span class="badge-icon">⚠️</span>
          <span class="badge-text">{{ task.risks.length }} 个风险</span>
        </div>
      </div>

      <div class="task-risks" v-if="task.risks && task.risks.length > 0">
        <div class="risk-label">风险提示:</div>
        <ul class="risks-list">
          <li v-for="(risk, riskIndex) in task.risks" :key="riskIndex" class="risk-item">
            {{ risk }}
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PlanTask } from '../../stores/plan'

interface Props {
  tasks: PlanTask[]
}

defineProps<Props>()
</script>

<style scoped>
.task-list-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.task-item {
  padding: 16px;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  transition: border-color 0.2s;
}

.task-item:hover {
  border-color: var(--vscode-focusBorder);
}

.task-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.task-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  font-size: 14px;
  font-weight: 600;
  border-radius: 50%;
  flex-shrink: 0;
}

.task-subject {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: var(--vscode-foreground);
}

.task-description {
  font-size: 13px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.6;
  margin: 0 0 12px 0;
}

.task-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.meta-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  font-size: 12px;
  border-radius: 12px;
}

.risk-badge {
  background: var(--vscode-inputValidation-warningBackground);
  color: var(--vscode-inputValidation-warningForeground);
  border: 1px solid var(--vscode-inputValidation-warningBorder);
}

.badge-icon {
  font-size: 13px;
}

.badge-text {
  font-weight: 500;
}

.task-risks {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--vscode-panel-border);
}

.risk-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--vscode-inputValidation-warningForeground);
  margin-bottom: 6px;
}

.risks-list {
  margin: 0;
  padding-left: 20px;
}

.risk-item {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.5;
  margin-bottom: 4px;
}
</style>
