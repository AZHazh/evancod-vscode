<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, CircleCheck, CircleX, FilePenLine, FilePlus2, Folder, ShieldCheck, X } from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'
import QuestionCard from '@/components/agent/QuestionCard.vue'
import DiffViewer from '@/components/diff/DiffViewer.vue'
import TerminalChrome from '@/components/terminal/TerminalChrome.vue'

interface QuestionOption {
  label: string
  description: string
  preview?: string
}

interface Question {
  id: string
  question: string
  options: QuestionOption[]
  allowMultiple?: boolean
  allowCustomInput?: boolean
}

const props = defineProps<{
  requestId: string
  toolName: string
  input: unknown
  description?: string
  responseState?: 'pending' | 'approved' | 'denied'
}>()

const chatStore = useChatStore()
const sendPermissionResponse = chatStore.sendPermissionResponse
const inputText = computed(() => JSON.stringify(props.input, null, 2))
const inputRecord = computed(() =>
  typeof props.input === 'object' && props.input !== null && !Array.isArray(props.input)
    ? (props.input as Record<string, unknown>)
    : null
)
const command = computed(() =>
  typeof inputRecord.value?.command === 'string' ? inputRecord.value.command : ''
)
const filePath = computed(() =>
  typeof inputRecord.value?.file_path === 'string' ? inputRecord.value.file_path : undefined
)
const oldString = computed(() =>
  typeof inputRecord.value?.old_string === 'string' ? inputRecord.value.old_string : undefined
)
const newString = computed(() =>
  typeof inputRecord.value?.new_string === 'string' ? inputRecord.value.new_string : undefined
)
const content = computed(() =>
  typeof inputRecord.value?.content === 'string' ? inputRecord.value.content : undefined
)
const isEditLike = computed(() =>
  ['edit_file', 'write_file', 'Edit', 'Write'].includes(props.toolName)
)
const normalizedToolName = computed(() => props.toolName.toLowerCase())
const isWriteLike = computed(
  () => normalizedToolName.value === 'write_file' || normalizedToolName.value === 'write'
)
const fileActionLabel = computed(() => (isWriteLike.value ? 'Write' : 'Edit'))
const toolNameDisplay = computed(() => {
  const labels: Record<string, string> = {
    edit_file: 'Edit',
    write_file: 'Write',
    bash: 'Bash',
    ask_user_question: 'Ask',
  }
  return labels[props.toolName] || props.toolName
})
const systemIdentity = computed(() =>
  isEditLike.value ? `Evancod ${fileActionLabel.value}` : toolNameDisplay.value
)
const responseState = ref<'pending' | 'approved' | 'denied'>(props.responseState || 'pending')
watch(
  () => props.responseState,
  value => {
    responseState.value = value || 'pending'
  }
)
const statusText = computed(() => {
  if (responseState.value === 'approved') return '已授权'
  if (responseState.value === 'denied') return '已拒绝'
  return isEditLike.value ? '等待审批' : 'awaiting approval'
})
const statusClass = computed(() => responseState.value)
const question = computed<Question | null>(() => {
  if (props.toolName !== 'ask_user_question' || !inputRecord.value) {
    return null
  }

  const input = inputRecord.value as Partial<Question>
  if (!input.question || !Array.isArray(input.options)) {
    return null
  }

  return {
    id: props.requestId,
    question: input.question,
    options: input.options,
    allowMultiple: input.allowMultiple,
    allowCustomInput: input.allowCustomInput,
  }
})

function approvePermission() {
  responseState.value = 'approved'
  sendPermissionResponse({ requestId: props.requestId, approved: true })
}

function approveSession() {
  responseState.value = 'approved'
  sendPermissionResponse({ requestId: props.requestId, approved: true, rule: 'always' })
}

function denyPermission() {
  responseState.value = 'denied'
  sendPermissionResponse({
    requestId: props.requestId,
    approved: false,
    reason: '用户拒绝了工具执行请求',
  })
}

function submitQuestion(answer: { selectedOptions: string[]; customInput?: string }) {
  responseState.value = 'approved'
  sendPermissionResponse({ requestId: props.requestId, approved: true, updatedInput: { answer } })
}
</script>

<template>
  <div class="permission-card" :class="[`permission-card--${responseState}`, { 'permission-card--ask': question }]">
    <QuestionCard
      v-if="question"
      :question="question"
      :response-state="responseState"
      @submit="submitQuestion"
      @cancel="denyPermission"
    />

    <template v-else>
      <div class="permission-card__header">
        <component
          :is="isWriteLike ? FilePlus2 : FilePenLine"
          v-if="isEditLike"
          class="permission-card__file-icon"
          :class="`permission-card__file-icon--${responseState}`"
        />
        <div v-else class="permission-card__icon-wrap" :class="`permission-card__icon-wrap--${responseState}`">
          <CircleCheck v-if="responseState === 'approved'" class="permission-card__header-status-icon" />
          <CircleX v-else-if="responseState === 'denied'" class="permission-card__header-status-icon" />
          <span v-else>!</span>
        </div>
        <div class="permission-card__main">
          <div class="permission-card__title-row">
            <span class="permission-card__title"
              >允许 {{ systemIdentity }}{{ filePath ? ` ${filePath.split('/').pop()}?` : '' }}</span
            >
            <span class="permission-card__badge" :class="`permission-card__badge--${statusClass}`">
              <component :is="responseState === 'denied' ? CircleX : responseState === 'approved' ? CircleCheck : null" v-if="responseState !== 'pending'" class="permission-card__badge-icon" />
              <span v-else class="permission-card__badge-dot" /> {{ statusText }}
            </span>
          </div>
          <div v-if="description && !isEditLike" class="permission-card__description">
            {{ description }}
          </div>
        </div>
      </div>

      <div class="permission-card__body">
        <div v-if="isEditLike && filePath" class="permission-card__path-row" :title="filePath">
          <Folder class="permission-card__path-icon" />
          <span>{{ filePath }}</span>
        </div>
        <DiffViewer
          v-if="isEditLike && (oldString || newString || content)"
          :file-path="filePath"
          :old-text="oldString"
          :new-text="newString"
          :content="content"
        />
        <TerminalChrome
          v-else-if="toolName === 'bash' && command"
          :command="command"
          :description="description"
          status="running"
        />
        <div v-else class="permission-card__detail-row">
          <span>Input</span>
          <code>{{ inputText }}</code>
        </div>
      </div>

      <div v-if="responseState === 'pending'" class="permission-card__actions">
        <button class="chat-button chat-button--primary" type="button" @click="approvePermission">
          <Check class="chat-button__icon" />允许
        </button>
        <button class="chat-button chat-button--ghost" type="button" @click="approveSession">
          <ShieldCheck class="chat-button__icon" />本次会话允许
        </button>
        <button class="chat-button chat-button--danger" type="button" @click="denyPermission">
          <X class="chat-button__icon" />拒绝
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.permission-card {
  overflow: hidden;
  border: 1px solid var(--chat-color-warning);
  border-radius: var(--chat-radius-lg);
  background: var(--chat-color-surface-container-lowest);
}

.permission-card--approved {
  border-color: color-mix(in srgb, #69f08d 45%, var(--chat-color-border));
}

.permission-card--denied {
  border-color: color-mix(in srgb, var(--chat-color-error) 45%, var(--chat-color-border));
}

.permission-card--ask {
  border-color: var(--chat-color-secondary);
}

.permission-card__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--chat-color-surface-container-lowest);
}

.permission-card__file-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  color: var(--chat-color-warning);
  stroke-width: 2;
}

.permission-card__file-icon--approved {
  color: #69f08d;
}

.permission-card__file-icon--denied {
  color: var(--chat-color-error);
}

.permission-card__file-icon--pending {
  color: var(--chat-color-warning);
}

.permission-card__icon-wrap {
  display: flex;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: var(--chat-radius-md);
  background: color-mix(in srgb, var(--chat-color-warning) 10%, transparent);
  color: var(--chat-color-warning);
  font-weight: 800;
}

.permission-card__icon-wrap--approved {
  background: color-mix(in srgb, #69f08d 12%, transparent);
  color: #69f08d;
}

.permission-card__icon-wrap--denied {
  background: color-mix(in srgb, var(--chat-color-error) 12%, transparent);
  color: var(--chat-color-error);
}

.permission-card__header-status-icon {
  width: 18px;
  height: 18px;
}

.permission-card__main {
  min-width: 0;
  flex: 1;
}

.permission-card__title-row {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.permission-card__title {
  min-width: 0;
  overflow: hidden;
  color: var(--chat-color-text-primary);
  font-size: 14px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-card__description {
  margin-top: 2px;
  overflow: hidden;
  color: var(--chat-color-text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-card__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--chat-radius-full);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.permission-card__badge--pending {
  background: color-mix(in srgb, var(--chat-color-warning) 15%, transparent);
  color: var(--chat-color-warning);
}

.permission-card__badge--approved {
  background: color-mix(in srgb, #69f08d 16%, transparent);
  color: #69f08d;
}

.permission-card__badge--denied {
  background: color-mix(in srgb, var(--chat-color-error) 16%, transparent);
  color: var(--chat-color-error);
}

.permission-card__badge-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}

.permission-card__badge-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--chat-radius-full);
  background: var(--chat-color-warning);
  animation: chat-pulse-dot 1.4s ease-in-out infinite;
}

.permission-card__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 16px 12px;
}

.permission-card__path-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface-container);
  color: var(--chat-color-text-secondary);
  font-family: var(--chat-font-mono);
  font-size: 12px;
}

.permission-card__path-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-card__path-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--chat-color-text-tertiary);
}

.permission-card__detail-row {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface-container);
  color: var(--chat-color-text-secondary);
  font-family: var(--chat-font-mono);
  font-size: 12px;
}

.permission-card__detail-row code {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-card__raw-toggle {
  margin-top: 8px;
  border: 0;
  background: transparent;
  color: var(--chat-color-text-accent);
  cursor: pointer;
  font-size: 11px;

  &:hover {
    text-decoration: underline;
  }
}

.permission-card__raw {
  max-height: 220px;
  overflow: auto;
  margin: 8px 0 0;
  padding: 10px 12px;
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-terminal-bg);
  color: var(--chat-color-terminal-fg);
  font-family: var(--chat-font-mono);
  font-size: 11px;
  line-height: 1.3;
  white-space: pre-wrap;
  word-break: break-word;
}

.permission-card__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 20%, transparent);
  background: var(--chat-color-surface-container-low);
}

.chat-button {
  display: inline-flex;
  height: 32px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--chat-radius-md);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease,
    transform 0.16s ease;

  &:hover {
    transform: translateY(-1px);
  }
}

.chat-button__icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.chat-button--primary {
  background: #ff7f5f;
  color: #18120f;

  &:hover {
    background: #ff9478;
    box-shadow: 0 6px 16px color-mix(in srgb, #ff7f5f 25%, transparent);
  }
}

.chat-button--ghost {
  border-color: color-mix(in srgb, var(--chat-color-border) 60%, transparent);
  background: var(--chat-color-surface-container-lowest);
  color: var(--chat-color-text-secondary);

  &:hover {
    border-color: color-mix(in srgb, var(--chat-color-text-secondary) 45%, transparent);
    background: var(--chat-color-surface-hover);
    color: var(--chat-color-text-primary);
  }
}

.chat-button--danger {
  border-color: color-mix(in srgb, var(--chat-color-error) 35%, transparent);
  background: color-mix(in srgb, var(--chat-color-error-container) 45%, var(--chat-color-surface));
  color: var(--chat-color-error);

  &:hover {
    border-color: color-mix(in srgb, var(--chat-color-error) 55%, transparent);
    background: color-mix(
      in srgb,
      var(--chat-color-error-container) 70%,
      var(--chat-color-surface)
    );
  }
}
</style>
