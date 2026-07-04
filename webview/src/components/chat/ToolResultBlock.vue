<script setup lang="ts">
const props = defineProps<{
  content: unknown
  isError: boolean
}>()

function formatContent(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}
</script>

<template>
  <div class="tool-result" :class="{ 'tool-result--error': isError }">
    <div class="tool-result__header">
      <span>{{ isError ? 'Tool error' : 'Tool result' }}</span>
    </div>
    <pre class="tool-result__content">{{ formatContent(props.content) }}</pre>
  </div>
</template>

<style scoped lang="scss">
.tool-result {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 50%, transparent);
  border-radius: var(--chat-radius-lg);
  background: var(--chat-color-surface-container-low);
}

.tool-result--error {
  border-color: color-mix(in srgb, var(--chat-color-error) 50%, transparent);
  background: color-mix(in srgb, var(--chat-color-error-container) 35%, var(--chat-color-surface-container-low));
}

.tool-result__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--chat-color-border) 45%, transparent);
  color: var(--chat-color-text-tertiary);
  font-size: 11px;
  font-weight: 600;
}

.tool-result--error .tool-result__header {
  color: var(--chat-color-error);
}

.tool-result__content {
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
</style>
