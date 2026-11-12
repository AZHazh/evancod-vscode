<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Bot, ChevronDown, FilePenLine, FilePlus2, FileX2, ShieldCheck, Terminal } from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'
import DiffViewer from '@/components/diff/DiffViewer.vue'

const props = defineProps<{
  requestId: string
  toolName: string
  input: unknown
  description?: string
  deferred?: boolean
  requestedAt?: number
  remainingCount?: number
  responseState?: 'pending' | 'approved' | 'denied' | 'cancelled' | 'expired'
}>()

const chatStore = useChatStore()
const sendPermissionResponse = chatStore.sendPermissionResponse
const detailsExpanded = ref(false)
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
const normalizedToolName = computed(() => props.toolName.toLowerCase())
const isEditLike = computed(() =>
  ['edit_file', 'write_file', 'edit', 'write'].includes(normalizedToolName.value)
)
const isDeleteLike = computed(() => ['delete_file', 'delete'].includes(normalizedToolName.value))
const isWriteLike = computed(() => ['write_file', 'write'].includes(normalizedToolName.value))
const hasDiff = computed(
  () =>
    isEditLike.value &&
    [oldString.value, newString.value, content.value].some(value => value !== undefined)
)
const actionLabel = computed(() => {
  if (isWriteLike.value) return '准备写入文件'
  if (isEditLike.value) return '准备更新文件'
  if (isDeleteLike.value) return '准备删除文件'
  if (command.value) return '准备运行命令'
  return `允许 ${props.toolName} 继续`
})
const actionIcon = computed(() => {
  if (normalizedToolName.value === 'agent') return Bot
  if (isWriteLike.value) return FilePlus2
  if (isEditLike.value) return FilePenLine
  if (isDeleteLike.value) return FileX2
  if (command.value) return Terminal
  return ShieldCheck
})
const summaryText = computed(() => command.value || filePath.value || props.description || '')
const responseState = ref<'pending' | 'approved' | 'denied' | 'cancelled' | 'expired'>(
  props.responseState || 'pending'
)
const submitting = ref(false)
watch(
  () => props.responseState,
  value => {
    responseState.value = value || 'pending'
    submitting.value = false
  }
)
const statusText = computed(() => {
  if (responseState.value === 'approved') return '已授权'
  if (responseState.value === 'denied') return '已拒绝'
  if (responseState.value === 'cancelled') return '已取消'
  if (responseState.value === 'expired') return '已超时'
  return '等待授权'
})
const deferredNotice = computed(() => {
  if (responseState.value === 'expired') return '该请求在你查看其他会话期间未得到处理，现已超时。'
  if (responseState.value === 'cancelled') return '该请求在你查看其他会话期间等待，现已取消或失效。'
  return '该请求在你查看其他会话期间一直等待，可能已经接近超时。'
})
function approvePermission() {
  if (submitting.value) return
  submitting.value = true
  responseState.value = 'approved'
  sendPermissionResponse({ requestId: props.requestId, approved: true })
}

function approveSession() {
  if (submitting.value) return
  submitting.value = true
  responseState.value = 'approved'
  sendPermissionResponse({ requestId: props.requestId, approved: true, rule: 'always' })
}

function denyPermission() {
  if (submitting.value) return
  submitting.value = true
  responseState.value = 'denied'
  sendPermissionResponse({
    requestId: props.requestId,
    approved: false,
    reason: '用户拒绝了工具执行请求',
  })
}
</script>

<template>
  <div class="permission-card" :aria-busy="submitting">
    <div class="permission-card__bar">
      <span class="permission-card__icon" aria-hidden="true">
        <component :is="actionIcon" :size="17" :stroke-width="1.6" />
      </span>
      <div class="permission-card__summary">
        <span class="permission-card__heading">
          <span class="permission-card__label">{{ actionLabel }}</span>
          <span v-if="remainingCount" class="permission-card__queue" role="status">
            +{{ remainingCount }}
          </span>
        </span>
        <span
          v-if="summaryText"
          class="permission-card__subject"
          :class="{ 'permission-card__subject--code': command || filePath }"
          :title="summaryText"
        >
          {{ summaryText }}
        </span>
      </div>
      <button
        class="permission-card__toggle"
        type="button"
        :aria-expanded="detailsExpanded"
        :aria-controls="`permission-details-${requestId}`"
        @click="detailsExpanded = !detailsExpanded"
      >
        {{ detailsExpanded ? '收起' : '详情' }}
        <ChevronDown :size="12" :class="{ 'is-expanded': detailsExpanded }" />
      </button>
      <div v-if="responseState === 'pending'" class="permission-card__actions">
        <button
          class="permission-card__button permission-card__button--primary"
          type="button"
          :disabled="submitting"
          @click="approvePermission"
        >
          允许一次
        </button>
        <button
          class="permission-card__button permission-card__button--session"
          type="button"
          :disabled="submitting"
          @click="approveSession"
        >
          本次会话允许
        </button>
        <button
          class="permission-card__button permission-card__button--danger"
          type="button"
          :disabled="submitting"
          @click="denyPermission"
        >
          拒绝
        </button>
      </div>
      <span v-else class="permission-card__status" role="status">{{ statusText }}</span>
    </div>
    <div
      v-if="detailsExpanded"
      :id="`permission-details-${requestId}`"
      class="permission-card__details"
      role="region"
      aria-label="授权操作详情"
    >
      <p v-if="description" class="permission-card__description">{{ description }}</p>
      <p v-if="deferred" class="permission-card__notice">{{ deferredNotice }}</p>
      <DiffViewer
        v-if="hasDiff"
        :file-path="filePath"
        :old-text="oldString"
        :new-text="newString"
        :content="content"
      />
      <pre v-else-if="command" class="permission-card__code"><code>{{ command }}</code></pre>
      <pre v-else class="permission-card__code"><code>{{ inputText }}</code></pre>
      <details v-if="hasDiff || command" class="permission-card__raw">
        <summary>原始参数</summary>
        <pre class="permission-card__code"><code>{{ inputText }}</code></pre>
      </details>
    </div>
  </div>
</template>

<style scoped lang="scss">
.permission-card {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 18px;
  background:
    radial-gradient(
      ellipse at 0% 0%,
      color-mix(in srgb, var(--chat-color-primary) 10%, transparent),
      transparent 65%
    ) padding-box,
    linear-gradient(
      145deg,
      color-mix(in srgb, var(--chat-color-surface-container-high) 90%, transparent),
      color-mix(in srgb, var(--chat-color-surface-container-lowest) 88%, transparent)
    ) padding-box,
    linear-gradient(
      145deg,
      color-mix(in srgb, var(--chat-color-text-primary) 22%, transparent),
      color-mix(in srgb, var(--chat-color-border) 50%, transparent) 48%,
      color-mix(in srgb, var(--chat-color-text-primary) 10%, transparent)
    ) border-box;
  backdrop-filter: blur(20px) saturate(145%);
  box-shadow:
    0 10px 28px rgba(0, 0, 0, 0.22),
    0 2px 6px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    inset 0 -1px 0 rgba(0, 0, 0, 0.08);

  &::before {
    position: absolute;
    top: 0;
    left: 12%;
    right: 12%;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.22), transparent);
    content: '';
    pointer-events: none;
  }
}

.permission-card__bar {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 12px;
  font-size: 12px;
  line-height: 20px;
}

.permission-card__summary {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.permission-card__icon {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--chat-color-primary) 16%, transparent);
  border-radius: 10px;
  background: linear-gradient(
    145deg,
    color-mix(in srgb, var(--chat-color-primary) 12%, transparent),
    color-mix(in srgb, var(--chat-color-surface) 42%, transparent)
  );
  color: var(--chat-color-primary);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 2px 4px rgba(0, 0, 0, 0.1);
}

.permission-card__heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}

.permission-card__label {
  min-width: 0;
  overflow: hidden;
  color: var(--chat-color-text-secondary);
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-card__subject {
  min-width: 0;
  overflow: hidden;
  color: var(--chat-color-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 18px;
}

.permission-card__subject--code {
  font-family: var(--chat-font-mono);
}

.permission-card__queue {
  flex-shrink: 0;
  color: var(--chat-color-text-tertiary);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
}

.permission-card__toggle,
.permission-card__button {
  display: inline-flex;
  min-height: 27px;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--chat-color-text-secondary);
  font: inherit;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 140ms ease, box-shadow 140ms ease;

  &:hover:not(:disabled) {
    background: var(--chat-color-surface-hover);
    color: var(--chat-color-text-primary);
  }

  &:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, var(--chat-color-primary));
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}

.permission-card__toggle {
  align-self: start;
  padding: 2px 4px;
  font-size: 11px;

  .is-expanded {
    transform: rotate(180deg);
  }
}

.permission-card__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 5px;
  min-height: 27px;
}

.permission-card__button--primary {
  background: #ff7f5f;
  color: #18120f;
  box-shadow: 0 2px 5px rgba(255, 127, 95, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.18);

  &:hover:not(:disabled) {
    background: #ff9478;
    color: #18120f;
  }
}

.permission-card__button--session {
  border-color: color-mix(in srgb, var(--chat-color-text-primary) 9%, transparent);
  background: color-mix(in srgb, var(--chat-color-text-primary) 3%, transparent);
}

.permission-card__button--danger {
  color: var(--chat-color-error);

  &:hover:not(:disabled) {
    background: var(--chat-color-error-container);
    color: var(--chat-color-error);
  }
}

.permission-card__status {
  grid-column: 1 / -1;
  justify-self: end;
  min-height: 27px;
  line-height: 27px;
  color: var(--chat-color-text-secondary);
}

.permission-card__details {
  max-height: min(28vh, 220px);
  overflow: auto;
  padding: 10px;
  border-top: 1px solid var(--chat-color-border);
  color: var(--chat-color-text-primary);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.permission-card__description,
.permission-card__notice {
  margin: 0 0 8px;
  white-space: pre-wrap;
}

.permission-card__notice {
  color: var(--chat-color-text-secondary);
}

.permission-card__code {
  margin: 0;
  font-family: var(--chat-font-mono);
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;

  code {
    font: inherit;
  }
}

.permission-card__raw {
  margin-top: 8px;
  color: var(--chat-color-text-secondary);

  summary {
    width: fit-content;
    cursor: pointer;
  }

  pre {
    margin-top: 6px;
  }
}

.permission-card__details :deep(.diff-viewer__body) {
  max-height: none;
}

@media (max-width: 360px) {
  .permission-card__bar {
    padding: 10px;
    gap: 8px;
  }
  .permission-card__button {
    padding-inline: 7px;
    font-size: 11px;
  }
}
</style>
