<script setup lang="ts">
import { computed, ref } from 'vue'
import DiffViewer from '@/components/diff/DiffViewer.vue'
import TerminalChrome from '@/components/terminal/TerminalChrome.vue'
import type { BashRuntimeState, AgentTaskNotification } from '@/types'

const props = defineProps<{
  toolName: string
  toolUseId: string
  input: unknown
  isPending?: boolean
  partialInput?: string
  parentToolUseId?: string
  bash?: BashRuntimeState
  notification?: AgentTaskNotification
  result?: unknown
  resultError?: boolean
}>()

const emit = defineEmits<{
  cancelBash: [toolUseId: string, taskId?: string]
}>()

const expanded = ref(false)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function truncate(value: string, length = 80) {
  return value.length > length ? `${value.slice(0, length)}…` : value
}

const inputRecord = computed(() => (isRecord(props.input) ? props.input : null))
const inputText = computed(() => props.partialInput || JSON.stringify(props.input, null, 2))
const filePath = computed(() => textValue(inputRecord.value?.file_path || inputRecord.value?.path))
const command = computed(() => textValue(inputRecord.value?.command))
const description = computed(() => textValue(inputRecord.value?.description))
const oldString = computed(() => textValue(inputRecord.value?.old_string))
const newString = computed(() => textValue(inputRecord.value?.new_string))
const content = computed(() => textValue(inputRecord.value?.content))
const mcpAction = computed(() => textValue(inputRecord.value?.action))
const mcpServer = computed(() => textValue(inputRecord.value?.server))
const mcpTool = computed(() => textValue(inputRecord.value?.tool))
const mcpUri = computed(() => textValue(inputRecord.value?.uri))
const skillName = computed(() => textValue(inputRecord.value?.skill))
const skillArgs = computed(() => textValue(inputRecord.value?.args))
const bashStatus = computed(() => props.bash?.status || (props.isPending ? 'running' : 'completed'))
const notificationStatus = computed(() => props.notification?.status)
const notificationText = computed(() => props.notification?.summary || props.notification?.result || '')
const status = computed(() => {
  if (props.isPending) return 'pending'
  if (notificationStatus.value === 'failed' || bashStatus.value === 'error' || bashStatus.value === 'timeout') return 'error'
  if (notificationStatus.value === 'stopped' || bashStatus.value === 'cancelled') return 'cancelled'
  return 'success'
})

const title = computed(() => {
  const labels: Record<string, string> = {
    read_file: 'Read',
    edit_file: 'Edit',
    write_file: 'Write',
    bash: 'Bash',
    glob: 'Glob',
    grep: 'Grep',
    agent: 'Agent',
    exit_plan_mode: 'Plan',
    ask_user_question: 'Ask',
    mcp: 'MCP',
    skill: 'Skill',
  }

  return labels[props.toolName] || props.toolName
})

const iconType = computed(() => {
  if (props.toolName === 'read_file') return 'read'
  if (props.toolName === 'write_file') return 'write'
  if (props.toolName === 'edit_file') return 'edit'
  if (props.toolName === 'bash') return 'bash'
  if (props.toolName === 'grep') return 'grep'
  if (props.toolName === 'glob') return 'glob'
  if (props.toolName === 'agent') return 'agent'
  if (props.toolName === 'skill') return 'skill'
  if (props.toolName === 'mcp') return 'mcp'
  if (props.toolName === 'ask_user_question') return 'ask'
  return 'default'
})

const summary = computed(() => {
  if (description.value) return description.value
  if (filePath.value) return filePath.value.split('/').pop() || filePath.value
  if (command.value) return truncate(command.value)
  if (mcpTool.value) return mcpTool.value
  if (mcpAction.value) return mcpAction.value
  if (skillName.value) return skillName.value
  if (notificationText.value) return truncate(notificationText.value)
  return truncate(inputText.value.replace(/\s+/g, ' '))
})

const resultSummary = computed(() => {
  if (status.value === 'pending') return ''
  if (status.value === 'error') return 'Failed'
  if (status.value === 'cancelled') return 'Cancelled'
  if (notificationStatus.value === 'completed') return 'Completed'
  if (bashStatus.value === 'completed') return 'Completed'
  return 'Submitted'
})

const expandable = computed(() => true)

function formatResult(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

const hasResult = computed(() => {
  return props.result !== undefined && ['read_file', 'grep', 'glob'].includes(props.toolName)
})
</script>

<template>
  <div class="tool-call" :class="[`tool-call--${status}`]">
    <button class="tool-call__header" type="button" @click="expanded = !expanded">
      <span class="tool-call__icon" :class="{ 'tool-call__icon--active': status === 'pending' }">
        <!-- Read icon -->
        <svg v-if="iconType === 'read'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 2h10v12H3V2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M5 5h6M5 8h6M5 11h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- Write icon -->
        <svg v-else-if="iconType === 'write'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 2h10v12H3V2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M6 10l1.5-1.5L11 5l-1.5-1.5L6 7v3z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <!-- Edit icon -->
        <svg v-else-if="iconType === 'edit'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 2h10v12H3V2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M5 5h3M5 8h4M5 11h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M10 8l2 2M10 11l2-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- Bash/Terminal icon -->
        <svg v-else-if="iconType === 'bash'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
          <path d="M4 6l2 2-2 2M7 10h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <!-- Grep icon (search/magnifier) -->
        <svg v-else-if="iconType === 'grep'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" stroke-width="1.5"/>
          <path d="M9.5 9.5l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- Glob icon -->
        <svg v-else-if="iconType === 'glob'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" stroke-width="1.5"/>
          <path d="M9.5 9.5l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- Agent icon -->
        <svg v-else-if="iconType === 'agent'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 2l6 4v6l-6 4-6-4V6l6-4z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <!-- Skill icon -->
        <svg v-else-if="iconType === 'skill'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 2l1.5 4.5H14l-3.75 3L12 14l-4-3-4 3 1.75-4.5L2 6.5h4.5L8 2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <!-- MCP icon -->
        <svg v-else-if="iconType === 'mcp'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
          <path d="M8 5v6M5 8h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- Ask icon (chat bubble with question mark) -->
        <svg v-else-if="iconType === 'ask'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6A1.5 1.5 0 0 1 12.5 11H6l-3 3v-3H3.5A1.5 1.5 0 0 1 2 9.5v-6z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M6.5 5.5a1.5 1.5 0 0 1 2.4 1.2c0 1-1.4 1.1-1.4 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <circle cx="7.5" cy="10" r="0.4" fill="currentColor"/>
        </svg>
        <!-- Default icon -->
        <svg v-else viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="8" r="2" fill="currentColor"/>
        </svg>
      </span>
      <span class="tool-call__name">{{ title }}</span>
      <span class="tool-call__summary">{{ summary }}</span>

      <span v-if="status === 'pending'" class="tool-call__pending">
        <span class="tool-call__spinner" />
        Running
      </span>
      <span v-else class="tool-call__result-summary">{{ resultSummary }}</span>
      <span v-if="status === 'error'" class="tool-call__error-icon">!</span>
      <span v-if="expandable" class="tool-call__chevron">
        <svg v-if="expanded" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg v-else viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </button>

    <div v-if="expanded" class="tool-call__body">
      <TerminalChrome
        v-if="toolName === 'bash' && command"
        :command="command"
        :description="description"
        :stdout="bash?.stdout"
        :stderr="bash?.stderr"
        :exit-code="bash?.exitCode"
        :status="bashStatus"
        :task-id="bash?.taskId"
        @cancel="emit('cancelBash', props.toolUseId, bash?.taskId)"
      />

      <DiffViewer v-else-if="toolName === 'edit_file' && (oldString || newString)" :file-path="filePath" :old-text="oldString" :new-text="newString" />
      <DiffViewer v-else-if="toolName === 'write_file' && content" :file-path="filePath" :content="content" />

      <div v-else-if="hasResult" class="tool-result-container" :class="{ 'tool-result-container--error': resultError }">
        <div class="tool-result-header">
          <span>{{ resultError ? '执行错误' : '执行结果' }}</span>
        </div>
        <pre class="tool-result-content">{{ formatResult(result) }}</pre>
      </div>

      <div v-else-if="toolName === 'mcp'" class="tool-summary vertical">
        <div v-if="mcpAction"><span class="summary-label">操作</span><code>{{ mcpAction }}</code></div>
        <div v-if="mcpServer"><span class="summary-label">Server</span><code>{{ mcpServer }}</code></div>
        <div v-if="mcpTool"><span class="summary-label">Tool</span><code>{{ mcpTool }}</code></div>
        <div v-if="mcpUri"><span class="summary-label">URI</span><code>{{ mcpUri }}</code></div>
        <pre class="tool-json compact">{{ inputText }}</pre>
      </div>

      <div v-else-if="toolName === 'skill'" class="tool-summary vertical">
        <div v-if="skillName"><span class="summary-label">Skill</span><code>{{ skillName }}</code></div>
        <div v-if="skillArgs"><span class="summary-label">参数</span><code>{{ skillArgs }}</code></div>
        <pre class="tool-json compact">{{ inputText }}</pre>
      </div>

      <div v-else-if="toolName === 'agent'" class="tool-summary vertical">
        <div v-if="description"><span class="summary-label">任务</span><code>{{ description }}</code></div>
        <div v-if="notification?.taskId"><span class="summary-label">Task</span><code>{{ notification.taskId }}</code></div>
        <div v-if="notification?.usage?.durationMs"><span class="summary-label">耗时</span><code>{{ notification.usage.durationMs }}ms</code></div>
        <pre v-if="notificationText" class="tool-json compact">{{ notificationText }}</pre>
        <pre v-else class="tool-json compact">{{ inputText }}</pre>
      </div>

      <div v-else-if="filePath" class="tool-summary">
        <span class="summary-label">路径</span>
        <code>{{ filePath }}</code>
      </div>

      <pre v-else class="tool-json">{{ inputText }}</pre>
    </div>
  </div>
</template>

<style scoped lang="scss">
.tool-call {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 50%, transparent);
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface-container-lowest);
}

.tool-call--error {
  border-color: color-mix(in srgb, var(--chat-color-error) 45%, var(--chat-color-border));
}

.tool-call__header {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background-color 150ms ease;

  &:hover {
    background: color-mix(in srgb, var(--chat-color-surface-hover) 80%, transparent);
  }
}

.tool-call__icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--chat-color-outline);
  transition: color 200ms ease;

  svg {
    width: 100%;
    height: 100%;
  }
}

.tool-call__icon--active {
  color: var(--chat-color-warning);
}

.tool-call__name {
  flex-shrink: 0;
  color: var(--chat-color-text-secondary);
  font-size: 11px;
  font-weight: 700;
}

.tool-call__summary {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--chat-color-text-tertiary);
  font-family: var(--chat-font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-call__pending,
.tool-call__result-summary {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  color: var(--chat-color-outline);
  font-size: 10px;
}

.tool-call--error .tool-call__result-summary,
.tool-call__error-icon {
  color: var(--chat-color-error);
}

.tool-call__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid color-mix(in srgb, var(--chat-color-outline) 30%, transparent);
  border-top-color: var(--chat-color-outline);
  border-radius: var(--chat-radius-full);
  animation: chat-spin 1s linear infinite;
}

.tool-call__chevron {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: var(--chat-color-outline);

  svg {
    width: 100%;
    height: 100%;
  }
}

.tool-call__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-top: 1px solid color-mix(in srgb, var(--chat-color-border) 60%, transparent);
}

.tool-summary {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--chat-color-text-secondary);
  font-size: 12px;
}

.tool-summary.vertical {
  align-items: flex-start;
  flex-direction: column;
}

.tool-summary.vertical > div {
  display: flex;
  gap: 8px;
  align-items: center;
}

.summary-label {
  color: var(--chat-color-text-tertiary);
  font-size: 11px;
}

code,
.tool-json {
  font-family: var(--chat-font-mono);
  font-size: 11px;
}

.tool-json {
  max-height: 260px;
  overflow: auto;
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface-container-low);
  color: var(--chat-color-text-secondary);
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

.tool-json.compact {
  max-height: 160px;
}

.tool-result-container {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 50%, transparent);
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface-container-low);
}

.tool-result-container--error {
  border-color: color-mix(in srgb, var(--chat-color-error) 50%, transparent);
  background: color-mix(in srgb, var(--chat-color-error-container) 35%, var(--chat-color-surface-container-low));
}

.tool-result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--chat-color-border) 45%, transparent);
  color: var(--chat-color-text-tertiary);
  font-size: 11px;
  font-weight: 600;
}

.tool-result-container--error .tool-result-header {
  color: var(--chat-color-error);
}

.tool-result-content {
  max-height: 320px;
  overflow: auto;
  margin: 0;
  padding: 10px 12px;
  color: var(--chat-color-text-secondary);
  font-family: var(--chat-font-mono);
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 640px) {
  .tool-call__header {
    align-items: flex-start;
  }

  .tool-call__summary {
    display: none;
  }
}
</style>
