<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Brain, ChevronRight } from 'lucide-vue-next'
import MarkdownRenderer from '@/components/markdown/MarkdownRenderer.vue'
import { formatElapsed } from '@/utils/formatElapsed'
import { useChatStore } from '@/stores/chat'

const props = withDefaults(
  defineProps<{
    messageId: string
    content: string
    timestamp: number
    endedAt?: number
    isActive?: boolean
  }>(),
  {
    isActive: false,
  }
)

const chatStore = useChatStore()
const emit = defineEmits<{
  (event: 'file-open', path: string): void
}>()

function openFile(path: string) {
  if (path) emit('file-open', path)
}
const expanded = computed({
  get: () => chatStore.isExpandedState(`thinking:${props.messageId}`),
  set: value => chatStore.setExpandedState(`thinking:${props.messageId}`, value),
})
const now = ref(Date.now())
let timer: number | null = null

function startTimer() {
  if (timer !== null) return
  now.value = Date.now()
  timer = window.setInterval(() => {
    now.value = Date.now()
  }, 1000)
}

function stopTimer() {
  if (timer === null) return
  window.clearInterval(timer)
  timer = null
}

watch(
  () => props.isActive,
  isActive => {
    if (isActive) startTimer()
    else stopTimer()
  },
  { immediate: true },
)

function toggleExpanded() {
  expanded.value = !expanded.value
}

const elapsedSeconds = computed(() => {
  if (!props.isActive) {
    return Math.max(0, Math.floor(((props.endedAt ?? props.timestamp) - props.timestamp) / 1000))
  }
  return Math.max(0, Math.floor((now.value - props.timestamp) / 1000))
})

const formattedElapsed = computed(() => formatElapsed(elapsedSeconds.value))
const tokenCount = ref(0)
let countedLength = 0

watch(
  () => props.content,
  content => {
    if (content.length < countedLength) {
      tokenCount.value = estimateTokenCount(content)
      countedLength = content.length
      return
    }

    tokenCount.value += estimateTokenCount(content.slice(countedLength))
    countedLength = content.length
  },
  { immediate: true },
)

function estimateTokenCount(value: string) {
  const cjkCount = (value.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length
  const normalized = value.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').trim()
  const segmentCount = normalized ? normalized.split(/\s+/).filter(Boolean).length : 0

  return Math.max(0, Math.ceil(cjkCount + segmentCount * 1.3))
}

onBeforeUnmount(() => {
  stopTimer()
})
</script>

<template>
  <div class="thinking-block" :class="{ 'thinking-block--active': isActive }">
    <button
      class="thinking-block__toggle"
      type="button"
      :aria-expanded="expanded"
      :aria-controls="`thinking-details-${messageId}`"
      @click="toggleExpanded"
    >
      <span v-if="isActive" class="thinking-block__sparkle" aria-hidden="true">✦</span>
      <Brain v-else :size="14" aria-hidden="true" />
      <span class="thinking-block__label">{{ isActive ? '思考中...' : '已思考' }}</span>
      <template v-if="isActive">
        <span class="thinking-block__meta">{{ formattedElapsed }}</span>
        <span class="thinking-block__meta">↓ {{ tokenCount }} tokens</span>
      </template>
      <ChevronRight
        v-else
        :size="14"
        :class="{ 'thinking-block__chevron--open': expanded }"
        aria-hidden="true"
      />
    </button>

    <div
      v-if="expanded"
      :id="`thinking-details-${messageId}`"
      class="thinking-block__content"
      role="region"
      aria-label="思考内容"
    >
      <MarkdownRenderer
        :content="content"
        variant="compact"
        :show-copy-button="false"
        @file-open="openFile"
      />
      <span v-if="isActive" class="thinking-block__cursor" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.thinking-block {
  margin-bottom: 4px;
  min-width: 0;
  color: var(--chat-color-text-secondary);
  font-size: 12px;
}

.thinking-block__toggle {
  display: flex;
  width: 100%;
  min-height: 32px;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;

  &:hover {
    color: var(--chat-color-text-primary);
  }

  &:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, var(--chat-color-primary));
    outline-offset: 3px;
  }

  > svg {
    flex-shrink: 0;
  }
}

.thinking-block__label {
  flex-shrink: 0;
  margin-right: auto;
}

.thinking-block__sparkle {
  color: #c084fc;
  font-size: 11px;
  line-height: 1;
}

.thinking-block__chevron--open {
  transform: rotate(90deg);
}

.thinking-block__meta {
  color: var(--chat-color-text-tertiary);
  font-size: 11px;
  white-space: nowrap;
}

.thinking-block__content {
  position: relative;
  max-height: 300px;
  margin: 6px 0 4px 6px;
  overflow-y: auto;
  padding: 4px 0 4px 14px;
  border-left: 1px solid var(--chat-color-border);
}

.thinking-block--active {
  .thinking-block__toggle {
    display: inline-flex;
    width: auto;
    min-height: 28px;
    gap: 6px;
    padding: 0 10px;
    border: 1px solid color-mix(in srgb, var(--chat-color-border) 45%, transparent);
    border-radius: var(--chat-radius-full);
    background: color-mix(in srgb, var(--chat-color-surface-container-low) 82%, transparent);
    color: var(--chat-color-text-tertiary);
    font-size: 12px;
    line-height: 1;
    transition: border-color 150ms ease, background 150ms ease, color 150ms ease;

    &:hover {
      border-color: color-mix(in srgb, var(--chat-color-border) 70%, transparent);
      background: var(--chat-color-surface-container-low);
      color: var(--chat-color-text-secondary);
    }
  }

  .thinking-block__label {
    margin-right: 0;
    color: var(--chat-color-text-secondary);
    font-weight: 600;
  }

  .thinking-block__content {
    margin: 6px 0 0;
    padding: 10px;
    border: 1px solid color-mix(in srgb, var(--chat-color-border) 40%, transparent);
    border-radius: var(--chat-radius-md);
    background: var(--chat-color-surface-container-lowest);
    font-size: 11px;
  }
}

.thinking-block__cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 1px;
  vertical-align: middle;
  background: var(--chat-color-text-tertiary);
  animation: chat-cursor-blink 1s step-end infinite;
}
</style>
