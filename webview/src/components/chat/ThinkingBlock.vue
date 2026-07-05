<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import MarkdownRenderer from '@/components/markdown/MarkdownRenderer.vue'

const props = withDefaults(
  defineProps<{
    content: string
    timestamp: number
    isActive?: boolean
  }>(),
  {
    isActive: false,
  }
)

const expanded = ref(false)
const now = ref(Date.now())
let timer: number | null = null

if (props.isActive) {
  timer = window.setInterval(() => {
    now.value = Date.now()
  }, 1000)
}

function toggleExpanded() {
  expanded.value = !expanded.value
}

const elapsedSeconds = computed(() => {
  if (!props.isActive) {
    // 当已完成时，计算从 timestamp 开始经过的固定时间
    // 但我们需要知道完成时的时间戳。暂时先返回当前时间差
    return Math.max(0, Math.floor((Date.now() - props.timestamp) / 1000))
  }
  return Math.max(0, Math.floor((now.value - props.timestamp) / 1000))
})
const tokenCount = computed(() => estimateTokenCount(props.content))

function estimateTokenCount(value: string) {
  const cjkCount = (value.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length
  const normalized = value.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').trim()
  const segmentCount = normalized ? normalized.split(/\s+/).filter(Boolean).length : 0

  return Math.max(0, Math.ceil(cjkCount + segmentCount * 1.3))
}

onBeforeUnmount(() => {
  if (timer !== null) {
    window.clearInterval(timer)
  }
})
</script>

<template>
  <div class="thinking-block">
    <button class="thinking-block__toggle" type="button" @click="toggleExpanded">
      <span v-if="isActive" class="thinking-block__sparkle" aria-hidden="true">✦</span>
      <span class="thinking-block__label">思考中{{ isActive ? '...' : '' }}</span>
      <span v-if="!isActive && !expanded" class="thinking-block__icon">▾</span>
      <span v-if="!isActive && expanded" class="thinking-block__icon">▴</span>
      <template v-if="isActive">
        <span class="thinking-block__meta">{{ elapsedSeconds }}s</span>
        <span class="thinking-block__meta">↓ {{ tokenCount }} tokens</span>
      </template>
    </button>

    <div v-if="expanded" class="thinking-block__content">
      <MarkdownRenderer :content="content" variant="compact" :show-copy-button="false" />
      <span v-if="isActive" class="thinking-block__cursor" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.thinking-block {
  margin-bottom: 4px;
}

.thinking-block__toggle {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 45%, transparent);
  border-radius: var(--chat-radius-full);
  background: color-mix(in srgb, var(--chat-color-surface-container-low) 82%, transparent);
  color: var(--chat-color-text-tertiary);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  text-align: left;
  transition: border-color 150ms ease, background 150ms ease, color 150ms ease;

  &:hover {
    border-color: color-mix(in srgb, var(--chat-color-border) 70%, transparent);
    background: var(--chat-color-surface-container-low);
    color: var(--chat-color-text-secondary);
  }
}

.thinking-block__sparkle {
  color: #c084fc;
  font-size: 11px;
  line-height: 1;
}

.thinking-block__label {
  flex-shrink: 0;
  color: var(--chat-color-text-secondary);
  font-weight: 600;
}

.thinking-block__icon {
  color: var(--chat-color-text-tertiary);
  font-size: 18px;
  line-height: 1;
}

.thinking-block__meta {
  color: var(--chat-color-text-tertiary);
  font-size: 11px;
  white-space: nowrap;
}

.thinking-block__content {
  position: relative;
  max-height: 300px;
  margin-top: 6px;
  overflow-y: auto;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 40%, transparent);
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface-container-lowest);
  color: var(--chat-color-text-secondary);
  font-size: 11px;
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
