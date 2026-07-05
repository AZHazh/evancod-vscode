<script setup lang="ts">
import { ref, computed } from 'vue'
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, Clock, Bot } from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'
import type { AgentTaskNotification, UIMessage } from '@/types'
import ToolCallBlock from './ToolCallBlock.vue'
import Modal from '../common/Modal.vue'

type ToolUseMessage = Extract<UIMessage, { type: 'tool_use' }>

const props = defineProps<{
  toolUseId: string
  description?: string
  notification?: AgentTaskNotification
  input?: unknown
}>()

const chatStore = useChatStore()
const expanded = ref(false)
const showResultModal = ref(false)

// 解析 input 获取 description 和 prompt
const inputRecord = computed(() => {
  if (typeof props.input === 'object' && props.input !== null) {
    return props.input as Record<string, unknown>
  }
  return null
})

const agentDescription = computed(() => {
  return props.description || (inputRecord.value?.description as string) || '执行子任务'
})

const agentPrompt = computed(() => {
  return (inputRecord.value?.prompt as string) || ''
})

const resolvedNotification = computed(() => {
  return props.notification || chatStore.agentTaskNotifications[props.toolUseId]
})

// Agent 状态
const status = computed(() => {
  // 如果有 notification，使用 notification 的状态
  if (resolvedNotification.value) {
    return resolvedNotification.value.status === 'completed' ? 'completed' :
           resolvedNotification.value.status === 'failed' ? 'failed' : 'stopped'
  }
  // 没有 notification 说明还在运行
  return 'running'
})

const statusText = computed(() => {
  const map = {
    running: '执行中',
    completed: '完成',
    failed: '失败',
    stopped: '已停止'
  }
  return map[status.value as keyof typeof map] || status.value
})

const statusIcon = computed(() => {
  const map = {
    running: Clock,
    completed: CheckCircle2,
    failed: XCircle,
    stopped: XCircle
  }
  return map[status.value as keyof typeof map] || Clock
})

// 查看结果
function viewResult() {
  showResultModal.value = true
}

const hasResult = computed(() => {
  return status.value === 'completed' && (resolvedNotification.value?.summary || resolvedNotification.value?.result)
})

// 获取子工具调用列表
const childToolCalls = computed(() => {
  return chatStore.uiMessages.filter(
    (msg): msg is ToolUseMessage =>
      msg.type === 'tool_use' && msg.parentToolUseId === props.toolUseId
  )
})

// 创建一个 Map 来关联 tool_result 到 tool_use（跟 MessageList 逻辑一样）
const toolResultMap = computed(() => {
  const map = new Map<string, { content: unknown; isError: boolean }>()
  chatStore.uiMessages.forEach(msg => {
    if (msg.type === 'tool_result') {
      map.set(msg.toolUseId, { content: msg.content, isError: msg.isError })
    }
  })
  return map
})

// 增强的子工具调用列表，将 tool_result 数据注入到 tool_use 中
const enhancedChildToolCalls = computed(() => {
  return childToolCalls.value.map((msg): ToolUseMessage & { result?: unknown; resultError?: boolean } => {
    const result = toolResultMap.value.get(msg.toolUseId)
    if (result && ['read_file', 'grep', 'glob'].includes(msg.toolName)) {
      return {
        ...msg,
        result: result.content,
        resultError: result.isError
      }
    }
    return msg
  })
})
</script>

<template>
  <div class="agent-card" :class="`agent-card--${status}`">
    <button class="agent-card__header" type="button" @click="expanded = !expanded">
      <div class="agent-card__left">
        <div class="agent-card__icon">
          <Bot class="agent-card__bot-icon" />
        </div>
        <div class="agent-card__info">
          <div class="agent-card__title">
            <span class="agent-card__label">Agent</span>
            <span class="agent-card__name">{{ agentDescription }}</span>
          </div>
          <div class="agent-card__subtitle">{{ agentPrompt.slice(0, 100) }}{{ agentPrompt.length > 100 ? '...' : '' }}</div>
        </div>
      </div>

      <div class="agent-card__right">
        <button
          v-if="hasResult"
          class="agent-card__view-btn"
          type="button"
          @click.stop="viewResult"
        >
          查看结果
        </button>
        <div class="agent-card__status" :class="`agent-card__status--${status}`">
          <component :is="statusIcon" class="agent-card__status-icon" />
          <span>{{ statusText }}</span>
        </div>
        <component :is="expanded ? ChevronUp : ChevronDown" class="agent-card__chevron" />
      </div>
    </button>

    <div v-if="expanded" class="agent-card__body">
      <div class="agent-card__section">
        <div class="agent-card__section-title">任务描述</div>
        <div class="agent-card__section-content">{{ agentPrompt || agentDescription }}</div>
      </div>

      <div v-if="enhancedChildToolCalls.length > 0" class="agent-card__section">
        <div class="agent-card__section-title">工具活动 ({{ enhancedChildToolCalls.length }})</div>
        <div class="agent-card__tools">
          <ToolCallBlock
            v-for="toolCall in enhancedChildToolCalls"
            :key="toolCall.id"
            :tool-name="toolCall.toolName"
            :tool-use-id="toolCall.toolUseId"
            :input="toolCall.input"
            :is-pending="toolCall.isPending"
            :partial-input="toolCall.partialInput"
            :parent-tool-use-id="toolCall.parentToolUseId"
            :bash="toolCall.bash"
            :notification="toolCall.notification"
            :result="'result' in toolCall ? toolCall.result : undefined"
            :result-error="'resultError' in toolCall ? (toolCall.resultError as boolean) : undefined"
            @cancel-bash="chatStore.cancelBash"
          />
        </div>
      </div>

      <div v-else-if="status === 'running'" class="agent-card__section">
        <div class="agent-card__section-title">工具活动</div>
        <div class="agent-card__section-content agent-card__tool-activity">
          暂时还没有工具活动
        </div>
      </div>

      <div v-if="resolvedNotification?.error" class="agent-card__section agent-card__section--error">
        <div class="agent-card__section-title">错误信息</div>
        <div class="agent-card__section-content">{{ resolvedNotification.error }}</div>
      </div>

      <div v-if="resolvedNotification?.usage" class="agent-card__meta">
        <div v-if="resolvedNotification.usage.durationMs" class="agent-card__meta-item">
          <span class="agent-card__meta-label">耗时:</span>
          <span class="agent-card__meta-value">{{ Math.round(resolvedNotification.usage.durationMs / 1000) }}s</span>
        </div>
        <div v-if="resolvedNotification.usage.totalTokens" class="agent-card__meta-item">
          <span class="agent-card__meta-label">Tokens:</span>
          <span class="agent-card__meta-value">{{ resolvedNotification.usage.totalTokens.toLocaleString() }}</span>
        </div>
      </div>
    </div>

    <Modal v-model="showResultModal" title="Agent 执行结果" size="large" :show-footer="false">
      <div class="agent-result-modal">
        <div v-if="resolvedNotification?.summary" class="result-section">
          <div class="result-section-title">执行摘要</div>
          <div class="result-section-content">{{ resolvedNotification.summary }}</div>
        </div>

        <div v-if="resolvedNotification?.result" class="result-section">
          <div class="result-section-title">详细结果</div>
          <pre class="result-section-content result-pre">{{ resolvedNotification.result }}</pre>
        </div>

        <div v-if="resolvedNotification?.usage" class="result-meta">
          <div v-if="resolvedNotification.usage.durationMs" class="result-meta-item">
            <span class="result-meta-label">耗时:</span>
            <span class="result-meta-value">{{ Math.round(resolvedNotification.usage.durationMs / 1000) }}s</span>
          </div>
          <div v-if="resolvedNotification.usage.totalTokens" class="result-meta-item">
            <span class="result-meta-label">Tokens:</span>
            <span class="result-meta-value">{{ resolvedNotification.usage.totalTokens.toLocaleString() }}</span>
          </div>
          <div v-if="resolvedNotification.usage.toolUses" class="result-meta-item">
            <span class="result-meta-label">工具调用:</span>
            <span class="result-meta-value">{{ resolvedNotification.usage.toolUses }}</span>
          </div>
        </div>
      </div>
    </Modal>
  </div>
</template>

<style scoped lang="scss">
.agent-card {
  overflow: hidden;
  border: 1px solid var(--chat-color-border);
  border-radius: var(--chat-radius-lg);
  background: var(--chat-color-surface);
  transition: border-color 200ms ease;
}

.agent-card--running {
  border-color: var(--vscode-charts-blue, #3b82f6);
}

.agent-card--completed {
  border-color: var(--vscode-charts-green, #10b981);
}

.agent-card--failed {
  border-color: var(--vscode-charts-red, #ef4444);
}

.agent-card__header {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background-color 150ms ease;

  &:hover {
    background: color-mix(in srgb, var(--chat-color-surface-hover) 60%, transparent);
  }
}

.agent-card__left {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
  flex: 1;
}

.agent-card__icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--chat-radius-md);
  background: color-mix(in srgb, var(--chat-color-brand) 12%, transparent);
  color: var(--chat-color-brand);

  svg {
    width: 18px;
    height: 18px;
  }
}

.agent-card__bot-icon {
  width: 18px;
  height: 18px;
}

.agent-card__tools {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.agent-card__info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.agent-card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--chat-color-text-primary);
}

.agent-card__label {
  padding: 2px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--chat-color-brand) 15%, transparent);
  color: var(--chat-color-brand);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.agent-card__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-card__subtitle {
  overflow: hidden;
  color: var(--chat-color-text-secondary);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-card__right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.agent-card__view-btn {
  padding: 6px 12px;
  border: 1px solid var(--chat-color-border);
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface-container-low);
  color: var(--chat-color-text-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: all 150ms ease;

  &:hover {
    border-color: var(--chat-color-brand);
    background: color-mix(in srgb, var(--chat-color-brand) 10%, var(--chat-color-surface-container-low));
    color: var(--chat-color-brand);
  }
}

.agent-card__status {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--chat-radius-full);
  font-size: 12px;
  font-weight: 600;
}

.agent-card__status--running {
  background: color-mix(in srgb, var(--vscode-charts-blue, #3b82f6) 15%, transparent);
  color: var(--vscode-charts-blue, #3b82f6);
}

.agent-card__status--completed {
  background: color-mix(in srgb, var(--vscode-charts-green, #10b981) 15%, transparent);
  color: var(--vscode-charts-green, #10b981);
}

.agent-card__status--failed {
  background: color-mix(in srgb, var(--vscode-charts-red, #ef4444) 15%, transparent);
  color: var(--vscode-charts-red, #ef4444);
}

.agent-card__status--stopped {
  background: color-mix(in srgb, var(--vscode-charts-yellow, #f59e0b) 15%, transparent);
  color: var(--vscode-charts-yellow, #f59e0b);
}

.agent-card__status-icon {
  width: 14px;
  height: 14px;
}

.agent-card__chevron {
  width: 20px;
  height: 20px;
  color: var(--chat-color-text-secondary);
  transition: transform 200ms ease;
}

.agent-card__body {
  padding: 0 16px 16px 16px;
  border-top: 1px solid color-mix(in srgb, var(--chat-color-border) 50%, transparent);
  background: color-mix(in srgb, var(--chat-color-surface-container-lowest) 50%, transparent);
}

.agent-card__section {
  margin-top: 12px;

  &:first-child {
    margin-top: 12px;
  }
}

.agent-card__section--error {
  padding: 12px;
  border-radius: var(--chat-radius-md);
  background: color-mix(in srgb, var(--vscode-charts-red, #ef4444) 8%, transparent);
}

.agent-card__section-title {
  margin-bottom: 6px;
  color: var(--chat-color-text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.agent-card__section-content {
  color: var(--chat-color-text-primary);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.agent-card__tool-activity {
  padding: 8px 12px;
  border-radius: var(--chat-radius-md);
  background: color-mix(in srgb, var(--chat-color-surface-container) 60%, transparent);
  color: var(--chat-color-text-secondary);
  font-style: italic;
}

.agent-card__meta {
  display: flex;
  gap: 16px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid color-mix(in srgb, var(--chat-color-border) 30%, transparent);
}

.agent-card__meta-item {
  display: flex;
  gap: 4px;
  font-size: 12px;
}

.agent-card__meta-label {
  color: var(--chat-color-text-secondary);
}

.agent-card__meta-value {
  color: var(--chat-color-text-primary);
  font-weight: 600;
}

// Running 状态下的动画
.agent-card--running .agent-card__status-icon {
  animation: rotate 2s linear infinite;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.agent-result-modal {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.result-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.result-section-title {
  color: var(--chat-color-text-secondary);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.result-section-content {
  color: var(--chat-color-text-primary);
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.result-pre {
  padding: 12px;
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface-container);
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 13px;
  overflow-x: auto;
}

.result-meta {
  display: flex;
  gap: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--chat-color-border);
}

.result-meta-item {
  display: flex;
  gap: 6px;
  font-size: 13px;
}

.result-meta-label {
  color: var(--chat-color-text-secondary);
  font-weight: 600;
}

.result-meta-value {
  color: var(--chat-color-text-primary);
  font-weight: 700;
}
</style>
