<template>
  <div class="risk-assessment">
    <div v-for="(risk, index) in risks" :key="index" class="risk-item" :class="`risk-${risk.level}`">
      <div class="risk-header">
        <span class="risk-icon">{{ getRiskIcon(risk.level) }}</span>
        <span class="risk-level">{{ getRiskLevelText(risk.level) }}</span>
      </div>

      <h4 class="risk-description">{{ risk.description }}</h4>

      <div class="risk-mitigation">
        <div class="mitigation-label">缓解措施:</div>
        <p class="mitigation-text">{{ risk.mitigation }}</p>
      </div>
    </div>

    <div v-if="risks.length === 0" class="no-risks">
      <span class="no-risks-icon">✅</span>
      <p class="no-risks-text">此计划未发现明显风险</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PlanRisk } from '../../stores/plan'

interface Props {
  risks: PlanRisk[]
}

defineProps<Props>()

function getRiskIcon(level: string): string {
  const icons = {
    low: '🟢',
    medium: '🟡',
    high: '🔴'
  }
  return icons[level as keyof typeof icons] || '⚠️'
}

function getRiskLevelText(level: string): string {
  const texts = {
    low: '低风险',
    medium: '中风险',
    high: '高风险'
  }
  return texts[level as keyof typeof texts] || level
}
</script>

<style scoped>
.risk-assessment {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.risk-item {
  padding: 16px;
  border-radius: 8px;
  border: 2px solid;
}

.risk-item.risk-low {
  background: var(--vscode-input-background);
  border-color: var(--vscode-charts-green);
}

.risk-item.risk-medium {
  background: var(--vscode-inputValidation-warningBackground);
  border-color: var(--vscode-inputValidation-warningBorder);
}

.risk-item.risk-high {
  background: var(--vscode-inputValidation-errorBackground);
  border-color: var(--vscode-inputValidation-errorBorder);
}

.risk-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.risk-icon {
  font-size: 20px;
}

.risk-level {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.risk-item.risk-low .risk-level {
  color: var(--vscode-charts-green);
}

.risk-item.risk-medium .risk-level {
  color: var(--vscode-inputValidation-warningForeground);
}

.risk-item.risk-high .risk-level {
  color: var(--vscode-inputValidation-errorForeground);
}

.risk-description {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 12px 0;
  color: var(--vscode-foreground);
  line-height: 1.4;
}

.risk-mitigation {
  padding: 12px;
  background: var(--vscode-editor-background);
  border-radius: 6px;
}

.mitigation-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 6px;
}

.mitigation-text {
  font-size: 13px;
  color: var(--vscode-foreground);
  line-height: 1.5;
  margin: 0;
}

.no-risks {
  text-align: center;
  padding: 32px 16px;
}

.no-risks-icon {
  font-size: 48px;
  display: block;
  margin-bottom: 12px;
}

.no-risks-text {
  font-size: 14px;
  color: var(--vscode-descriptionForeground);
  margin: 0;
}
</style>
