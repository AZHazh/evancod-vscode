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

const icon = computed(() => {
  if (props.toolName === 'bash') return '⌘'
  if (props.toolName.includes('file') || props.toolName === 'read_file') return '□'
  if (props.toolName === 'glob' || props.toolName === 'grep') return '⌕'
  if (props.toolName === 'agent') return '◇'
  if (props.toolName === 'skill') return '✦'
  if (props.toolName === 'mcp') return '⚙'
  return '•'
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
</script>

<template>
  <div class="tool-call" :class="[`tool-call--${status}`]">
    <button class="tool-call__header" type="button" @click="expanded = !expanded">
      <span class="tool-call__icon">{{ icon }}</span>
      <span class="tool-call__name">{{ title }}</span>
      <span class="tool-call__summary">{{ summary }}</span>

      <span v-if="status === 'pending'" class="tool-call__pending">
        <span class="tool-call__spinner" />
        Running
      </span>
      <span v-else class="tool-call__result-summary">{{ resultSummary }}</span>
      <span v-if="status === 'error'" class="tool-call__error-icon">!</span>
      <span v-if="expandable" class="tool-call__chevron">{{ expanded ? '⌃' : '⌄' }}</span>
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

  &:hover {
    background: color-mix(in srgb, var(--chat-color-surface-hover) 50%, transparent);
  }
}

.tool-call__icon {
  flex-shrink: 0;
  color: var(--chat-color-outline);
  font-size: 14px;
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
  flex-shrink: 0;
  color: var(--chat-color-outline);
  font-size: 14px;
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

@media (max-width: 640px) {
  .tool-call__header {
    align-items: flex-start;
  }

  .tool-call__summary {
    display: none;
  }
}
</style>
